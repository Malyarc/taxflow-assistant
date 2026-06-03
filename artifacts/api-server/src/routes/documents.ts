import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, taxDocumentsTable, w2DataTable, form1099DataTable, clientsTable } from "@workspace/db";
import {
  ListDocumentsParams,
  UploadDocumentParams,
  UploadDocumentBody,
  DeleteDocumentParams,
  ApproveExtractionParams,
  ApproveExtractionBody,
  RejectExtractionParams,
  RejectExtractionBody,
} from "@workspace/api-zod";
import {
  extractTextFromBase64,
  extractW2DataFromText,
  extractW2DataFromFile,
  extract1099DataFromFile,
  detectMimeType,
  isVisualMimeType,
  validateAndResolveMimeType,
} from "../lib/documentExtractor";
import { encryptField } from "../lib/fieldCrypto";
import { consentRequired, hasValidConsent, AI_EXTRACTION_SCOPE } from "../lib/consentGate";
import { logger } from "../lib/logger";
import { setSecureDownloadHeaders } from "../lib/httpSecurity";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";
import { writeAudit } from "../lib/auditLog";

/**
 * Hard cap on uploaded file size to defeat unauthenticated cost-DoS via the
 * AI extraction path. ~6MB base64 ≈ 4.5MB raw — enough for any realistic
 * scanned W-2/1099 PDF; refuses obvious abuse. The Express body limit is
 * 20MB; this is the per-document tighter cap.
 */
const MAX_UPLOAD_BASE64_BYTES = 8_000_000;

/**
 * Hard cap on pending_review docs per client to defeat queue blow-up via
 * unauthenticated burst uploads.
 */
const MAX_PENDING_PER_CLIENT = 50;

const router: IRouter = Router();

router.get("/clients/:clientId/documents", async (req, res): Promise<void> => {
  const params = ListDocumentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // SEC-01: project away `fileContent` — the full base64 of the uploaded
  // W-2/1099 (SSN/EIN/amounts), which the list view never reads (the POST
  // handler already strips it, and previews use the dedicated /content
  // endpoint). Returning it bloats every list response by megabytes/doc and
  // widens the plaintext-PII surface in browser/proxy caches.
  const documents = await db
    .select({
      id: taxDocumentsTable.id,
      clientId: taxDocumentsTable.clientId,
      documentType: taxDocumentsTable.documentType,
      fileName: taxDocumentsTable.fileName,
      status: taxDocumentsTable.status,
      extractedText: taxDocumentsTable.extractedText,
      linkedRecordId: taxDocumentsTable.linkedRecordId,
      linkedRecordType: taxDocumentsTable.linkedRecordType,
      rejectionReason: taxDocumentsTable.rejectionReason,
      createdAt: taxDocumentsTable.createdAt,
    })
    .from(taxDocumentsTable)
    .where(eq(taxDocumentsTable.clientId, params.data.clientId));
  res.json(documents);
});

router.post("/clients/:clientId/documents", async (req, res): Promise<void> => {
  const params = UploadDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UploadDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Defeat cost-DoS via large uploads (per-file cap, smaller than the
  // global Express 20MB body limit).
  if ((parsed.data.fileContent ?? "").length > MAX_UPLOAD_BASE64_BYTES) {
    res.status(413).json({ error: `File too large (max ${Math.floor(MAX_UPLOAD_BASE64_BYTES / 1_000_000)}MB after base64 encoding)` });
    return;
  }

  // Deep-audit security finding: validate file content matches the
  // claimed extension (magic-bytes sniffing). Rejects malicious uploads
  // that pretend to be PDFs / images.
  try {
    validateAndResolveMimeType(parsed.data.fileContent, parsed.data.fileName);
  } catch (err) {
    res.status(415).json({
      error: err instanceof Error ? err.message : "Unsupported file type",
    });
    return;
  }

  // Defeat queue blow-up via burst uploads — refuse if this client already
  // has many unreviewed docs sitting in the queue.
  const pending = await db.select().from(taxDocumentsTable)
    .where(and(
      eq(taxDocumentsTable.clientId, params.data.clientId),
      eq(taxDocumentsTable.status, "pending_review"),
    ));
  if (pending.length >= MAX_PENDING_PER_CLIENT) {
    res.status(429).json({ error: `Too many pending documents (max ${MAX_PENDING_PER_CLIENT}); review or delete existing ones first` });
    return;
  }

  // P0-2 — §7216 consent gate. AI extraction transmits the document to Google
  // Gemini, a "disclosure of tax return information" under Treas. Reg.
  // §301.7216-3. Fail closed: refuse without a recorded, unexpired taxpayer
  // consent. (Enforced in the prod posture; see consentRequired().)
  if (consentRequired() && !(await hasValidConsent(params.data.clientId, AI_EXTRACTION_SCOPE))) {
    res.status(403).json({
      error:
        "Taxpayer §7216 consent is required before this document can be sent to the AI provider for extraction. " +
        "Record consent via POST /clients/:clientId/disclosure-consents first.",
      code: "CONSENT_REQUIRED",
    });
    return;
  }

  // Insert document in processing state. Extraction runs asynchronously; on
  // completion the row flips to `pending_review` (CPA must approve before the
  // extracted values land in w2_data / form_1099_data) or `failed`.
  const [doc] = await db
    .insert(taxDocumentsTable)
    .values({
      clientId: params.data.clientId,
      documentType: parsed.data.documentType,
      fileName: parsed.data.fileName,
      fileContent: parsed.data.fileContent,
      status: "processing",
    })
    .returning();

  await writeAudit({
    clientId: params.data.clientId,
    action: "create",
    entityType: "tax_document",
    entityId: doc.id,
    after: { id: doc.id, fileName: doc.fileName, documentType: doc.documentType, status: doc.status },
    source: "document upload",
  });

  // Fire-and-forget extraction. Errors are caught and persisted as `failed`.
  (async () => {
    try {
      // P0-2 defense-in-depth — re-verify §7216 consent at the actual
      // transmission point, so any future path that reaches the Gemini calls
      // without the handler gate above still fails closed.
      if (consentRequired() && !(await hasValidConsent(params.data.clientId, AI_EXTRACTION_SCOPE))) {
        await db.update(taxDocumentsTable).set({ status: "failed" }).where(eq(taxDocumentsTable.id, doc.id));
        logger.warn({ docId: doc.id }, "Extraction aborted at transmission — §7216 consent not present");
        return;
      }
      const mimeType = detectMimeType(parsed.data.fileName);
      const isVisual = isVisualMimeType(mimeType);
      const extractedText = isVisual
        ? `[${mimeType}: ${parsed.data.fileName}]`
        : await extractTextFromBase64(parsed.data.fileContent, parsed.data.fileName);
      let extractedData: Record<string, unknown> = {};
      let fieldBoxes: Record<string, unknown> = {};

      if (parsed.data.documentType === "w2") {
        if (isVisual) {
          const { data, boxes } = await extractW2DataFromFile(parsed.data.fileContent, mimeType);
          extractedData = data as Record<string, unknown>;
          fieldBoxes = boxes as Record<string, unknown>;
        } else {
          extractedData = (await extractW2DataFromText(extractedText)) as Record<string, unknown>;
        }
      } else if (parsed.data.documentType === "form_1099" && isVisual) {
        const { data, boxes } = await extract1099DataFromFile(parsed.data.fileContent, mimeType);
        extractedData = data as Record<string, unknown>;
        fieldBoxes = boxes as Record<string, unknown>;
      }

      const payload = {
        text: extractedText.slice(0, 2000),
        data: extractedData,
        boxes: fieldBoxes,
      };

      await db
        .update(taxDocumentsTable)
        .set({
          status: "pending_review",
          extractedText: JSON.stringify(payload),
        })
        .where(eq(taxDocumentsTable.id, doc.id));
    } catch (err) {
      logger.error({ err, docId: doc.id, fileName: parsed.data.fileName }, "AI extraction failed");
      await db
        .update(taxDocumentsTable)
        .set({ status: "failed" })
        .where(eq(taxDocumentsTable.id, doc.id));
    }
  })();

  // Strip fileContent (potentially large base64 blob) from the response —
  // the frontend never reads it (next refetch hits a separate /content
  // endpoint). This both halves the bytes-on-wire and shrinks the log /
  // cache surface for PII-carrying uploads.
  const { fileContent: _omitContent, ...docMeta } = doc;
  res.status(201).json(docMeta);
});

/**
 * Stream the raw file content (image/PDF/text) for preview in the UI.
 * Used by both the simple preview iframe and the BoundedDocumentViewer.
 */
router.get("/clients/:clientId/documents/:documentId/content", async (req, res): Promise<void> => {
  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [doc] = await db
    .select()
    .from(taxDocumentsTable)
    .where(
      and(
        eq(taxDocumentsTable.id, params.data.documentId),
        eq(taxDocumentsTable.clientId, params.data.clientId),
      ),
    );
  if (!doc || !doc.fileContent) {
    res.status(404).json({ error: "Document content not found" });
    return;
  }
  const mimeType = detectMimeType(doc.fileName);
  const buffer = Buffer.from(doc.fileContent, "base64");
  setSecureDownloadHeaders(res, {
    fileName: doc.fileName,
    contentType: mimeType,
    disposition: "inline",
    length: buffer.length,
  });
  res.setHeader("Cache-Control", "private, max-age=300");
  res.send(buffer);
});

router.delete("/clients/:clientId/documents/:documentId", async (req, res): Promise<void> => {
  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [doc] = await db
    .delete(taxDocumentsTable)
    .where(
      and(
        eq(taxDocumentsTable.id, params.data.documentId),
        eq(taxDocumentsTable.clientId, params.data.clientId),
      )
    )
    .returning();
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "delete",
    entityType: "tax_document",
    entityId: doc.id,
    before: { id: doc.id, fileName: doc.fileName, status: doc.status, linkedRecordId: doc.linkedRecordId },
  });
  // Recalc in case the doc was linked to a w2/1099 (cascades aren't wired, but the recalc
  // is cheap and keeps the tax return consistent if downstream logic ever does delete).
  // Await (and let recalculateAfterMutation log its own failures) instead of
  // a fire-and-forget empty .catch() that silently dropped recalc errors —
  // matches every other mutation route (BE-08).
  await recalculateAfterMutation(params.data.clientId);
  res.sendStatus(204);
});

/**
 * Approve an AI-extracted document. The CPA has reviewed (and possibly edited)
 * the extracted fields and confirmed they should be written to the income
 * record. We insert into w2_data or form_1099_data with an explicit audit
 * source so the audit log distinguishes "AI extraction (CPA-approved)" from
 * "manual entry" and from machine writes.
 */
router.post("/clients/:clientId/documents/:documentId/approve", async (req, res): Promise<void> => {
  const params = ApproveExtractionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = ApproveExtractionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [doc] = await db
    .select()
    .from(taxDocumentsTable)
    .where(
      and(
        eq(taxDocumentsTable.id, params.data.documentId),
        eq(taxDocumentsTable.clientId, params.data.clientId),
      ),
    );
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (doc.status !== "pending_review") {
    res.status(400).json({ error: `Document is in '${doc.status}' state; only 'pending_review' can be approved` });
    return;
  }

  // Pull the per-field boxes from the extraction payload so the committed
  // record carries them too (for any future "view source position" UI).
  let fieldBoxes: Record<string, unknown> | null = null;
  if (doc.extractedText) {
    try {
      const payload = JSON.parse(doc.extractedText) as { boxes?: Record<string, unknown> };
      if (payload.boxes && Object.keys(payload.boxes).length > 0) fieldBoxes = payload.boxes;
    } catch {
      // ignore malformed payload — no boxes
    }
  }

  const numericToString = (v: number | null | undefined): string | undefined =>
    v != null ? String(v) : undefined;

  const auditSource = `AI extraction from ${doc.fileName}`;

  if (parsed.data.recordType === "w2") {
    // Insert the income record AND flip the document to `approved` atomically.
    // Without a transaction, a failure between the two writes could orphan the
    // W-2 row while leaving the document `pending_review` (re-approvable →
    // double-counted income).
    const { record, updatedDoc } = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(w2DataTable)
        .values({
          clientId: params.data.clientId,
          documentId: doc.id,
          taxYear: parsed.data.taxYear,
          employerName: parsed.data.employerName ?? undefined,
          employerEin: parsed.data.employerEin ?? undefined,
          employeeSSN: encryptField(parsed.data.employeeSSN) ?? undefined,
          wagesBox1: numericToString(parsed.data.wagesBox1),
          federalTaxWithheldBox2: numericToString(parsed.data.federalTaxWithheldBox2),
          socialSecurityWagesBox3: numericToString(parsed.data.socialSecurityWagesBox3),
          socialSecurityTaxBox4: numericToString(parsed.data.socialSecurityTaxBox4),
          medicareWagesBox5: numericToString(parsed.data.medicareWagesBox5),
          medicareTaxBox6: numericToString(parsed.data.medicareTaxBox6),
          stateTaxWithheldBox17: numericToString(parsed.data.stateTaxWithheldBox17),
          stateWagesBox16: numericToString(parsed.data.stateWagesBox16),
          stateCode: parsed.data.stateCode ?? undefined,
          fieldBoxes,
        })
        .returning();
      const [doc2] = await tx
        .update(taxDocumentsTable)
        .set({
          status: "approved",
          linkedRecordId: inserted.id,
          linkedRecordType: "w2",
        })
        .where(eq(taxDocumentsTable.id, doc.id))
        .returning();
      return { record: inserted, updatedDoc: doc2 };
    });
    await writeAudit({
      clientId: params.data.clientId,
      action: "create",
      entityType: "w2",
      entityId: record.id,
      after: record,
      source: auditSource,
    });
    await writeAudit({
      clientId: params.data.clientId,
      action: "update",
      entityType: "tax_document",
      entityId: doc.id,
      before: { status: doc.status, linkedRecordId: doc.linkedRecordId },
      after: { status: updatedDoc.status, linkedRecordId: updatedDoc.linkedRecordId, linkedRecordType: updatedDoc.linkedRecordType },
      source: auditSource,
    });
    await recalculateAfterMutation(params.data.clientId);
    res.json(updatedDoc);
    return;
  }

  // form1099
  if (parsed.data.recordType === "form1099") {
    if (!parsed.data.formType) {
      res.status(400).json({ error: "formType is required when recordType is form1099" });
      return;
    }
    // Capture the narrowed (non-null) formType — TS narrowing from the guard
    // above does not propagate into the transaction closure below.
    const formType = parsed.data.formType;
    // Insert the 1099 record AND approve the document atomically (see W-2 note).
    const { record, updatedDoc } = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(form1099DataTable)
        .values({
          clientId: params.data.clientId,
          documentId: doc.id,
          taxYear: parsed.data.taxYear,
          formType,
          payerName: parsed.data.payerName ?? undefined,
          payerTin: encryptField(parsed.data.payerTin) ?? undefined,
          recipientTin: encryptField(parsed.data.recipientTin) ?? undefined,
          federalTaxWithheld: numericToString(parsed.data.federalTaxWithheld),
          stateTaxWithheld: numericToString(parsed.data.stateTaxWithheld),
          stateCode: parsed.data.stateCode ?? undefined,
          nonemployeeCompensation: numericToString(parsed.data.nonemployeeCompensation),
          rents: numericToString(parsed.data.rents),
          royalties: numericToString(parsed.data.royalties),
          otherIncome: numericToString(parsed.data.otherIncome),
          fishingBoatProceeds: numericToString(parsed.data.fishingBoatProceeds),
          medicalAndHealthcare: numericToString(parsed.data.medicalAndHealthcare),
          interestIncome: numericToString(parsed.data.interestIncome),
          earlyWithdrawalPenalty: numericToString(parsed.data.earlyWithdrawalPenalty),
          usTreasuryInterest: numericToString(parsed.data.usTreasuryInterest),
          taxExemptInterest: numericToString(parsed.data.taxExemptInterest),
          ordinaryDividends: numericToString(parsed.data.ordinaryDividends),
          qualifiedDividends: numericToString(parsed.data.qualifiedDividends),
          totalCapitalGainDistribution: numericToString(parsed.data.totalCapitalGainDistribution),
          nondividendDistributions: numericToString(parsed.data.nondividendDistributions),
          proceeds: numericToString(parsed.data.proceeds),
          costBasis: numericToString(parsed.data.costBasis),
          shortTermGainLoss: numericToString(parsed.data.shortTermGainLoss),
          longTermGainLoss: numericToString(parsed.data.longTermGainLoss),
          grossDistribution: numericToString(parsed.data.grossDistribution),
          taxableAmount: numericToString(parsed.data.taxableAmount),
          distributionCode: parsed.data.distributionCode ?? undefined,
          iraSepSimple: parsed.data.iraSepSimple ?? undefined,
          unemploymentCompensation: numericToString(parsed.data.unemploymentCompensation),
          stateLocalRefund: numericToString(parsed.data.stateLocalRefund),
          grossPaymentAmount: numericToString(parsed.data.grossPaymentAmount),
          fieldBoxes,
        })
        .returning();
      const [doc2] = await tx
        .update(taxDocumentsTable)
        .set({
          status: "approved",
          linkedRecordId: inserted.id,
          linkedRecordType: "form1099",
        })
        .where(eq(taxDocumentsTable.id, doc.id))
        .returning();
      return { record: inserted, updatedDoc: doc2 };
    });
    await writeAudit({
      clientId: params.data.clientId,
      action: "create",
      entityType: "form1099",
      entityId: record.id,
      after: record,
      source: auditSource,
    });
    await writeAudit({
      clientId: params.data.clientId,
      action: "update",
      entityType: "tax_document",
      entityId: doc.id,
      before: { status: doc.status, linkedRecordId: doc.linkedRecordId },
      after: { status: updatedDoc.status, linkedRecordId: updatedDoc.linkedRecordId, linkedRecordType: updatedDoc.linkedRecordType },
      source: auditSource,
    });
    await recalculateAfterMutation(params.data.clientId);
    res.json(updatedDoc);
    return;
  }

  res.status(400).json({ error: `Unsupported recordType: ${parsed.data.recordType}` });
});

/**
 * Reject an AI-extracted document. No income record is created; the doc moves
 * to `rejected` status. CPAs use this when extraction quality was too poor to
 * salvage (or the document was the wrong type entirely).
 */
router.post("/clients/:clientId/documents/:documentId/reject", async (req, res): Promise<void> => {
  const params = RejectExtractionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // body is optional; default to empty
  const parsed = RejectExtractionBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [doc] = await db
    .select()
    .from(taxDocumentsTable)
    .where(
      and(
        eq(taxDocumentsTable.id, params.data.documentId),
        eq(taxDocumentsTable.clientId, params.data.clientId),
      ),
    );
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  if (doc.status !== "pending_review") {
    res.status(400).json({ error: `Document is in '${doc.status}' state; only 'pending_review' can be rejected` });
    return;
  }

  const [updatedDoc] = await db
    .update(taxDocumentsTable)
    .set({
      status: "rejected",
      rejectionReason: parsed.data.reason ?? null,
    })
    .where(eq(taxDocumentsTable.id, doc.id))
    .returning();

  await writeAudit({
    clientId: params.data.clientId,
    action: "update",
    entityType: "tax_document",
    entityId: doc.id,
    before: { status: doc.status, rejectionReason: doc.rejectionReason },
    after: { status: updatedDoc.status, rejectionReason: updatedDoc.rejectionReason },
    source: parsed.data.reason ? `CPA rejection: ${parsed.data.reason}` : "CPA rejection",
  });

  res.json(updatedDoc);
});

export default router;
