import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, taxReturnsTable } from "@workspace/db";
import {
  GetTaxReturnParams,
  CalculateTaxReturnParams,
  CalculateTaxReturnBody,
  UpdateTaxReturnParams,
  UpdateTaxReturnBody,
} from "@workspace/api-zod";
import { recalculateAndUpsertTaxReturn } from "../lib/taxReturnPipeline";

const router: IRouter = Router();

function mapReturn(r: typeof taxReturnsTable.$inferSelect) {
  return {
    ...r,
    totalIncome: r.totalIncome != null ? Number(r.totalIncome) : null,
    adjustedGrossIncome: r.adjustedGrossIncome != null ? Number(r.adjustedGrossIncome) : null,
    standardDeduction: r.standardDeduction != null ? Number(r.standardDeduction) : null,
    itemizedDeductions: r.itemizedDeductions != null ? Number(r.itemizedDeductions) : null,
    taxableIncome: r.taxableIncome != null ? Number(r.taxableIncome) : null,
    federalTaxLiability: r.federalTaxLiability != null ? Number(r.federalTaxLiability) : null,
    federalTaxWithheld: r.federalTaxWithheld != null ? Number(r.federalTaxWithheld) : null,
    federalRefundOrOwed: r.federalRefundOrOwed != null ? Number(r.federalRefundOrOwed) : null,
    stateTaxLiability: r.stateTaxLiability != null ? Number(r.stateTaxLiability) : null,
    stateTaxWithheld: r.stateTaxWithheld != null ? Number(r.stateTaxWithheld) : null,
    stateRefundOrOwed: r.stateRefundOrOwed != null ? Number(r.stateRefundOrOwed) : null,
    effectiveTaxRate: r.effectiveTaxRate != null ? Number(r.effectiveTaxRate) : null,
  };
}

router.get("/clients/:clientId/tax-return", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [taxReturn] = await db
    .select()
    .from(taxReturnsTable)
    .where(eq(taxReturnsTable.clientId, params.data.clientId));
  if (!taxReturn) {
    res.status(404).json({ error: "Tax return not found" });
    return;
  }
  res.json(mapReturn(taxReturn));
});

router.post("/clients/:clientId/tax-return", async (req, res): Promise<void> => {
  const params = CalculateTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CalculateTaxReturnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const taxReturn = await recalculateAndUpsertTaxReturn(params.data.clientId, {
    taxYear: parsed.data.taxYear,
    additionalIncome: parsed.data.additionalIncome ?? 0,
    additionalDeductions: parsed.data.additionalDeductions ?? 0,
    useItemizedDeductions: parsed.data.useItemizedDeductions ?? false,
  });

  if (!taxReturn) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(mapReturn(taxReturn));
});

router.patch("/clients/:clientId/tax-return", async (req, res): Promise<void> => {
  const params = UpdateTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTaxReturnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  const numericFields = ["totalIncome","adjustedGrossIncome","standardDeduction","itemizedDeductions","taxableIncome","federalTaxLiability","federalTaxWithheld","federalRefundOrOwed","stateTaxLiability","stateTaxWithheld","stateRefundOrOwed"];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (numericFields.includes(k) && v != null) {
      updateData[k] = String(v);
    } else {
      updateData[k] = v;
    }
  }

  const [taxReturn] = await db
    .update(taxReturnsTable)
    .set(updateData)
    .where(eq(taxReturnsTable.clientId, params.data.clientId))
    .returning();
  if (!taxReturn) {
    res.status(404).json({ error: "Tax return not found" });
    return;
  }
  res.json(mapReturn(taxReturn));
});

export default router;
