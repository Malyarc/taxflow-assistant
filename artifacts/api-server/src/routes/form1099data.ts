import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, form1099DataTable } from "@workspace/db";
import {
  ListForm1099DataParams,
  CreateForm1099DataParams,
  CreateForm1099DataBody,
  UpdateForm1099DataParams,
  UpdateForm1099DataBody,
  DeleteForm1099DataParams,
} from "@workspace/api-zod";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";

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
  const [record] = await db
    .insert(form1099DataTable)
    .values(insertData as typeof form1099DataTable.$inferInsert)
    .returning();
  await recalculateAfterMutation(params.data.clientId);
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
  const updateData = stringifyNumerics({ ...parsed.data, updatedAt: new Date() });
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
  await recalculateAfterMutation(params.data.clientId);
  res.json(mapRecord(record));
});

router.delete("/clients/:clientId/form1099data/:form1099Id", async (req, res): Promise<void> => {
  const params = DeleteForm1099DataParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .delete(form1099DataTable)
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
  await recalculateAfterMutation(params.data.clientId);
  res.sendStatus(204);
});

export default router;
