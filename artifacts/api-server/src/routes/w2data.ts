import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, w2DataTable, clientsTable, taxDocumentsTable } from "@workspace/db";
import {
  ListW2DataParams,
  CreateW2DataParams,
  CreateW2DataBody,
  UpdateW2DataParams,
  UpdateW2DataBody,
  DeleteW2DataParams,
} from "@workspace/api-zod";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";
import { writeAudit } from "../lib/auditLog";
import { validateW2 } from "../lib/w2Validation";
import { encryptField, decryptField, isDecryptErrorSentinel } from "../lib/fieldCrypto";

const router: IRouter = Router();

// Validation flags for all W-2s belonging to a client (mismatch SSNs, off-by-amount
// withholding, year mismatch with client's filing year, etc.)
router.get("/clients/:clientId/w2data/flags", async (req, res): Promise<void> => {
  const params = ListW2DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const records = (await db
    .select()
    .from(w2DataTable)
    .where(eq(w2DataTable.clientId, params.data.clientId)))
    .map((r) => {
      // Null a decrypt-error sentinel so the duplicate-SSN cross-check doesn't
      // treat every unreadable W-2 as sharing one identical SSN (false flags).
      const ssn = decryptField(r.employeeSSN);
      return { ...r, employeeSSN: isDecryptErrorSentinel(ssn) ? null : ssn };
    });
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, params.data.clientId));

  const knownSsns = records.map((r) => r.employeeSSN).filter((s): s is string => !!s);

  const out = records.map((r) => ({
    w2Id: r.id,
    flags: validateW2(
      {
        taxYear: r.taxYear,
        employerName: r.employerName,
        employerEin: r.employerEin,
        employeeSSN: r.employeeSSN,
        wagesBox1: r.wagesBox1,
        federalTaxWithheldBox2: r.federalTaxWithheldBox2,
        socialSecurityWagesBox3: r.socialSecurityWagesBox3,
        socialSecurityTaxBox4: r.socialSecurityTaxBox4,
        medicareWagesBox5: r.medicareWagesBox5,
        medicareTaxBox6: r.medicareTaxBox6,
        stateTaxWithheldBox17: r.stateTaxWithheldBox17,
        stateWagesBox16: r.stateWagesBox16,
        stateCode: r.stateCode,
      },
      {
        clientTaxYear: client?.taxYear,
        clientState: client?.state,
        knownSsns: knownSsns.filter((s) => s !== r.employeeSSN),
      },
    ),
  }));
  res.json(out);
});

router.get("/clients/:clientId/w2data", async (req, res): Promise<void> => {
  const params = ListW2DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const records = await db
    .select()
    .from(w2DataTable)
    .where(eq(w2DataTable.clientId, params.data.clientId));

  // Convert numeric strings to numbers for response
  const mapped = records.map((r) => ({
    ...r,
    employeeSSN: decryptField(r.employeeSSN),
    wagesBox1: r.wagesBox1 != null ? Number(r.wagesBox1) : null,
    federalTaxWithheldBox2: r.federalTaxWithheldBox2 != null ? Number(r.federalTaxWithheldBox2) : null,
    socialSecurityWagesBox3: r.socialSecurityWagesBox3 != null ? Number(r.socialSecurityWagesBox3) : null,
    socialSecurityTaxBox4: r.socialSecurityTaxBox4 != null ? Number(r.socialSecurityTaxBox4) : null,
    medicareWagesBox5: r.medicareWagesBox5 != null ? Number(r.medicareWagesBox5) : null,
    medicareTaxBox6: r.medicareTaxBox6 != null ? Number(r.medicareTaxBox6) : null,
    stateTaxWithheldBox17: r.stateTaxWithheldBox17 != null ? Number(r.stateTaxWithheldBox17) : null,
    stateWagesBox16: r.stateWagesBox16 != null ? Number(r.stateWagesBox16) : null,
  }));
  res.json(mapped);
});

router.post("/clients/:clientId/w2data", async (req, res): Promise<void> => {
  const params = CreateW2DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateW2DataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const insertData: Record<string, unknown> = { ...parsed.data, clientId: params.data.clientId };
  const numericFields = ["wagesBox1","federalTaxWithheldBox2","socialSecurityWagesBox3","socialSecurityTaxBox4","medicareWagesBox5","medicareTaxBox6","stateTaxWithheldBox17","stateWagesBox16"];
  for (const field of numericFields) {
    if (insertData[field] != null) insertData[field] = String(insertData[field]);
  }
  if (insertData.employeeSSN != null) insertData.employeeSSN = encryptField(insertData.employeeSSN as string);
  const [record] = await db.insert(w2DataTable).values(insertData as typeof w2DataTable.$inferInsert).returning();
  await writeAudit({ clientId: params.data.clientId, action: "create", entityType: "w2", entityId: record.id, after: record });
  await recalculateAfterMutation(params.data.clientId);
  const r = record;
  res.status(201).json({
    ...r,
    employeeSSN: decryptField(r.employeeSSN),
    wagesBox1: r.wagesBox1 != null ? Number(r.wagesBox1) : null,
    federalTaxWithheldBox2: r.federalTaxWithheldBox2 != null ? Number(r.federalTaxWithheldBox2) : null,
    socialSecurityWagesBox3: r.socialSecurityWagesBox3 != null ? Number(r.socialSecurityWagesBox3) : null,
    socialSecurityTaxBox4: r.socialSecurityTaxBox4 != null ? Number(r.socialSecurityTaxBox4) : null,
    medicareWagesBox5: r.medicareWagesBox5 != null ? Number(r.medicareWagesBox5) : null,
    medicareTaxBox6: r.medicareTaxBox6 != null ? Number(r.medicareTaxBox6) : null,
    stateTaxWithheldBox17: r.stateTaxWithheldBox17 != null ? Number(r.stateTaxWithheldBox17) : null,
    stateWagesBox16: r.stateWagesBox16 != null ? Number(r.stateWagesBox16) : null,
  });
});

router.patch("/clients/:clientId/w2data/:w2Id", async (req, res): Promise<void> => {
  const params = UpdateW2DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateW2DataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
    // T2.2 — a CPA edit makes a roll-forward proforma row REAL (the organizer
  // then counts it as received).
  const updateData: Record<string, unknown> = { ...parsed.data, proforma: false, updatedAt: new Date() };
  const numericFields = ["wagesBox1","federalTaxWithheldBox2","socialSecurityWagesBox3","socialSecurityTaxBox4","medicareWagesBox5","medicareTaxBox6","stateTaxWithheldBox17","stateWagesBox16"];
  for (const field of numericFields) {
    if (updateData[field] != null) updateData[field] = String(updateData[field]);
  }
  if (updateData.employeeSSN != null) updateData.employeeSSN = encryptField(updateData.employeeSSN as string);
  const [before] = await db
    .select()
    .from(w2DataTable)
    .where(and(eq(w2DataTable.id, params.data.w2Id), eq(w2DataTable.clientId, params.data.clientId)));
  const [record] = await db
    .update(w2DataTable)
    .set(updateData)
    .where(and(eq(w2DataTable.id, params.data.w2Id), eq(w2DataTable.clientId, params.data.clientId)))
    .returning();
  if (!record) {
    res.status(404).json({ error: "W-2 record not found" });
    return;
  }
  await writeAudit({ clientId: params.data.clientId, action: "update", entityType: "w2", entityId: record.id, before, after: record });
  await recalculateAfterMutation(params.data.clientId);
  const r = record;
  res.json({
    ...r,
    employeeSSN: decryptField(r.employeeSSN),
    wagesBox1: r.wagesBox1 != null ? Number(r.wagesBox1) : null,
    federalTaxWithheldBox2: r.federalTaxWithheldBox2 != null ? Number(r.federalTaxWithheldBox2) : null,
    socialSecurityWagesBox3: r.socialSecurityWagesBox3 != null ? Number(r.socialSecurityWagesBox3) : null,
    socialSecurityTaxBox4: r.socialSecurityTaxBox4 != null ? Number(r.socialSecurityTaxBox4) : null,
    medicareWagesBox5: r.medicareWagesBox5 != null ? Number(r.medicareWagesBox5) : null,
    medicareTaxBox6: r.medicareTaxBox6 != null ? Number(r.medicareTaxBox6) : null,
    stateTaxWithheldBox17: r.stateTaxWithheldBox17 != null ? Number(r.stateTaxWithheldBox17) : null,
    stateWagesBox16: r.stateWagesBox16 != null ? Number(r.stateWagesBox16) : null,
  });
});

router.delete("/clients/:clientId/w2data/:w2Id", async (req, res): Promise<void> => {
  const params = DeleteW2DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Delete the W-2 AND clear any source document's back-pointer to it in one
  // transaction. tax_documents.linkedRecordId/linkedRecordType is a polymorphic
  // pointer with no FK, so a bare delete would leave the approved document
  // pointing at a now-deleted W-2 (dangling pointer). The durable fix is the
  // two-nullable-FK refactor; clearing the pointer here keeps it consistent.
  const record = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(w2DataTable)
      .where(and(eq(w2DataTable.id, params.data.w2Id), eq(w2DataTable.clientId, params.data.clientId)))
      .returning();
    if (!deleted) return null;
    await tx
      .update(taxDocumentsTable)
      .set({ linkedRecordId: null, linkedRecordType: null })
      .where(and(
        eq(taxDocumentsTable.clientId, params.data.clientId),
        eq(taxDocumentsTable.linkedRecordType, "w2"),
        eq(taxDocumentsTable.linkedRecordId, params.data.w2Id),
      ));
    return deleted;
  });
  if (!record) {
    res.status(404).json({ error: "W-2 record not found" });
    return;
  }
  await writeAudit({ clientId: params.data.clientId, action: "delete", entityType: "w2", entityId: record.id, before: record });
  // Pin the recompute to the deleted W-2's tax year (not the client default).
  await recalculateAfterMutation(params.data.clientId, record.taxYear);
  res.sendStatus(204);
});

export default router;
