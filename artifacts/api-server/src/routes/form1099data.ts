import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, form1099DataTable, taxDocumentsTable } from "@workspace/db";
import {
  ListForm1099DataParams,
  CreateForm1099DataParams,
  CreateForm1099DataBody,
  UpdateForm1099DataParams,
  UpdateForm1099DataBody,
  DeleteForm1099DataParams,
} from "@workspace/api-zod";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";
import { writeAudit } from "../lib/auditLog";
import { encryptField, decryptField } from "../lib/fieldCrypto";
import { setNoStorePii } from "../lib/httpSecurity";

const router: IRouter = Router();

const NUMERIC_FIELDS = [
  "federalTaxWithheld", "stateTaxWithheld",
  "nonemployeeCompensation", "rents", "royalties", "otherIncome",
  "fishingBoatProceeds", "medicalAndHealthcare",
  "interestIncome", "earlyWithdrawalPenalty", "usTreasuryInterest", "taxExemptInterest",
  "ordinaryDividends", "qualifiedDividends", "totalCapitalGainDistribution", "nondividendDistributions",
  "proceeds", "costBasis", "shortTermGainLoss", "longTermGainLoss",
  "grossDistribution", "taxableAmount",
  "unemploymentCompensation", "stateLocalRefund",
  "grossPaymentAmount",
];

function mapRecord(r: typeof form1099DataTable.$inferSelect) {
  const out: Record<string, unknown> = { ...r };
  for (const f of NUMERIC_FIELDS) {
    const v = (r as Record<string, unknown>)[f];
    out[f] = v != null ? Number(v) : null;
  }
  // P0-5 — decrypt PII for the response.
  out.payerTin = decryptField(r.payerTin);
  out.recipientTin = decryptField(r.recipientTin);
  return out;
}

function stringifyNumerics(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  for (const f of NUMERIC_FIELDS) {
    if (out[f] != null) out[f] = String(out[f]);
  }
  return out;
}

router.get("/clients/:clientId/form1099data", async (req, res): Promise<void> => {
  const params = ListForm1099DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const records = await db
    .select()
    .from(form1099DataTable)
    .where(eq(form1099DataTable.clientId, params.data.clientId));
  setNoStorePii(res); // response carries decrypted payer/recipient TINs
  res.json(records.map(mapRecord));
});

router.post("/clients/:clientId/form1099data", async (req, res): Promise<void> => {
  const params = CreateForm1099DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateForm1099DataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const insertData = stringifyNumerics({ ...parsed.data, clientId: params.data.clientId });
  if (insertData.payerTin != null) insertData.payerTin = encryptField(insertData.payerTin as string);
  if (insertData.recipientTin != null) insertData.recipientTin = encryptField(insertData.recipientTin as string);
  const [record] = await db
    .insert(form1099DataTable)
    .values(insertData as typeof form1099DataTable.$inferInsert)
    .returning();
  await writeAudit({ clientId: params.data.clientId, action: "create", entityType: "form1099", entityId: record.id, after: record });
  await recalculateAfterMutation(params.data.clientId);
  setNoStorePii(res); // response carries decrypted payer/recipient TINs
  res.status(201).json(mapRecord(record));
});

router.patch("/clients/:clientId/form1099data/:form1099Id", async (req, res): Promise<void> => {
  const params = UpdateForm1099DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateForm1099DataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
    // T2.2 — a CPA edit makes a roll-forward proforma row REAL (the organizer
  // then counts it as received).
  const updateData = stringifyNumerics({ ...parsed.data, proforma: false, updatedAt: new Date() });
  if (updateData.payerTin != null) updateData.payerTin = encryptField(updateData.payerTin as string);
  if (updateData.recipientTin != null) updateData.recipientTin = encryptField(updateData.recipientTin as string);
  const [before] = await db
    .select()
    .from(form1099DataTable)
    .where(and(eq(form1099DataTable.id, params.data.form1099Id), eq(form1099DataTable.clientId, params.data.clientId)));
  const [record] = await db
    .update(form1099DataTable)
    .set(updateData)
    .where(
      and(
        eq(form1099DataTable.id, params.data.form1099Id),
        eq(form1099DataTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "1099 record not found" });
    return;
  }
  await writeAudit({ clientId: params.data.clientId, action: "update", entityType: "form1099", entityId: record.id, before, after: record });
  await recalculateAfterMutation(params.data.clientId);
  setNoStorePii(res); // response carries decrypted payer/recipient TINs
  res.json(mapRecord(record));
});

router.delete("/clients/:clientId/form1099data/:form1099Id", async (req, res): Promise<void> => {
  const params = DeleteForm1099DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Delete the 1099 AND clear any source document's back-pointer to it in one
  // transaction. tax_documents.linkedRecordId/linkedRecordType is a polymorphic
  // pointer with no FK, so a bare delete would leave the approved document
  // pointing at a now-deleted 1099 (dangling pointer). The durable fix is the
  // two-nullable-FK refactor; clearing the pointer here keeps it consistent.
  const record = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(form1099DataTable)
      .where(
        and(
          eq(form1099DataTable.id, params.data.form1099Id),
          eq(form1099DataTable.clientId, params.data.clientId),
        ),
      )
      .returning();
    if (!deleted) return null;
    await tx
      .update(taxDocumentsTable)
      .set({ linkedRecordId: null, linkedRecordType: null })
      .where(and(
        eq(taxDocumentsTable.clientId, params.data.clientId),
        eq(taxDocumentsTable.linkedRecordType, "form1099"),
        eq(taxDocumentsTable.linkedRecordId, params.data.form1099Id),
      ));
    return deleted;
  });
  if (!record) {
    res.status(404).json({ error: "1099 record not found" });
    return;
  }
  await writeAudit({ clientId: params.data.clientId, action: "delete", entityType: "form1099", entityId: record.id, before: record });
  // Pin the recompute to the deleted 1099's tax year (not the client default).
  await recalculateAfterMutation(params.data.clientId, record.taxYear);
  res.sendStatus(204);
});

export default router;
