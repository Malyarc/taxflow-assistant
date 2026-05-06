import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, taxDocumentsTable, w2DataTable } from "@workspace/db";
import {
  ListDocumentsParams,
  UploadDocumentParams,
  UploadDocumentBody,
  DeleteDocumentParams,
} from "@workspace/api-zod";
import {
  extractTextFromBase64,
  extractW2DataFromText,
  extractW2DataFromFile,
  detectMimeType,
  isVisualMimeType,
} from "../lib/documentExtractor";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/clients/:clientId/documents", async (req, res): Promise<void> => {
  const params = ListDocumentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const documents = await db
    .select()
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

  // Insert document in pending state
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

  // Run AI extraction asynchronously, then update
  (async () => {
    try {
      const mimeType = detectMimeType(parsed.data.fileName);
      const isVisual = isVisualMimeType(mimeType);
      const extractedText = isVisual
        ? `[${mimeType}: ${parsed.data.fileName}]`
        : await extractTextFromBase64(parsed.data.fileContent, parsed.data.fileName);
      let extractedData: Record<string, unknown> = {};

      if (parsed.data.documentType === "w2") {
        extractedData = (isVisual
          ? await extractW2DataFromFile(parsed.data.fileContent, mimeType)
          : await extractW2DataFromText(extractedText)) as Record<string, unknown>;

        // Auto-create a W-2 record with extracted data
        await db.insert(w2DataTable).values({
          clientId: params.data.clientId,
          documentId: doc.id,
          taxYear: new Date().getFullYear() - 1,
          employerName: extractedData.employerName as string | undefined,
          employerEin: extractedData.employerEin as string | undefined,
          employeeSSN: extractedData.employeeSSN as string | undefined,
          wagesBox1: extractedData.wagesBox1 != null ? String(extractedData.wagesBox1) : undefined,
          federalTaxWithheldBox2: extractedData.federalTaxWithheldBox2 != null ? String(extractedData.federalTaxWithheldBox2) : undefined,
          socialSecurityWagesBox3: extractedData.socialSecurityWagesBox3 != null ? String(extractedData.socialSecurityWagesBox3) : undefined,
          socialSecurityTaxBox4: extractedData.socialSecurityTaxBox4 != null ? String(extractedData.socialSecurityTaxBox4) : undefined,
          medicareWagesBox5: extractedData.medicareWagesBox5 != null ? String(extractedData.medicareWagesBox5) : undefined,
          medicareTaxBox6: extractedData.medicareTaxBox6 != null ? String(extractedData.medicareTaxBox6) : undefined,
          stateTaxWithheldBox17: extractedData.stateTaxWithheldBox17 != null ? String(extractedData.stateTaxWithheldBox17) : undefined,
          stateWagesBox16: extractedData.stateWagesBox16 != null ? String(extractedData.stateWagesBox16) : undefined,
          stateCode: extractedData.stateCode as string | undefined,
        });
      }

      await db
        .update(taxDocumentsTable)
        .set({
          status: "extracted",
          extractedText: JSON.stringify({ text: extractedText.slice(0, 2000), data: extractedData }),
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

  res.status(201).json(doc);
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
        eq(taxDocumentsTable.clientId, params.data.clientId)
      )
    )
    .returning();
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
