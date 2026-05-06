import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, taxReturnsTable, clientsTable, w2DataTable, adjustmentsTable } from "@workspace/db";
import {
  GetTaxReturnParams,
  CalculateTaxReturnParams,
  CalculateTaxReturnBody,
  UpdateTaxReturnParams,
  UpdateTaxReturnBody,
} from "@workspace/api-zod";
import { runTaxCalculation, getStandardDeduction } from "../lib/taxCalculator";

const router: IRouter = Router();

function toNum(val: string | null | undefined): number {
  if (val == null) return 0;
  return Number(val) || 0;
}

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

  // Load client info
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  // Load W-2 records
  const w2Records = await db.select().from(w2DataTable).where(eq(w2DataTable.clientId, params.data.clientId));
  const totalWages = w2Records.reduce((sum, r) => sum + toNum(r.wagesBox1), 0);
  const totalFederalWithheld = w2Records.reduce((sum, r) => sum + toNum(r.federalTaxWithheldBox2), 0);
  const totalStateWithheld = w2Records.reduce((sum, r) => sum + toNum(r.stateTaxWithheldBox17), 0);
  const stateCode = w2Records.find((r) => r.stateCode)?.stateCode ?? client.state;

  // Load applied adjustments
  const adjustments = await db
    .select()
    .from(adjustmentsTable)
    .where(eq(adjustmentsTable.clientId, params.data.clientId));

  const appliedAdjustments = adjustments.filter((a) => a.isApplied);
  const deductionAdjustments = appliedAdjustments
    .filter((a) => a.adjustmentType === "deduction")
    .reduce((sum, a) => sum + toNum(a.amount), 0);
  const creditAdjustments = appliedAdjustments
    .filter((a) => a.adjustmentType === "credit")
    .reduce((sum, a) => sum + toNum(a.amount), 0);
  const additionalIncomeAdjustments = appliedAdjustments
    .filter((a) => a.adjustmentType === "additional_income")
    .reduce((sum, a) => sum + toNum(a.amount), 0);
  const withholdingAdjustments = appliedAdjustments
    .filter((a) => a.adjustmentType === "withholding_adjustment")
    .reduce((sum, a) => sum + toNum(a.amount), 0);
  const otherDeductions = appliedAdjustments
    .filter((a) => a.adjustmentType === "other")
    .reduce((sum, a) => sum + toNum(a.amount), 0);

  const additionalIncome = (parsed.data.additionalIncome ?? 0) + additionalIncomeAdjustments;
  // Above-the-line adjustments (reduce AGI regardless of itemizing).
  const aboveTheLineAdjustments = deductionAdjustments + otherDeductions;
  // Itemized (Schedule A) deductions — only applied when itemizing.
  const itemizedDeductions = parsed.data.additionalDeductions ?? 0;

  const result = runTaxCalculation({
    totalWages,
    additionalIncome,
    filingStatus: client.filingStatus,
    stateCode: stateCode ?? "CA",
    useItemizedDeductions: parsed.data.useItemizedDeductions ?? false,
    itemizedDeductions,
    adjustments: aboveTheLineAdjustments,
  });

  const federalRefundOrOwed = totalFederalWithheld + withholdingAdjustments - result.federalTaxLiability + creditAdjustments;
  const stateRefundOrOwed = totalStateWithheld - result.stateTaxLiability;

  const payload = {
    clientId: params.data.clientId,
    taxYear: parsed.data.taxYear,
    filingStatus: client.filingStatus,
    totalIncome: String(result.totalIncome),
    adjustedGrossIncome: String(result.adjustedGrossIncome),
    standardDeduction: String(result.standardDeduction),
    itemizedDeductions: parsed.data.useItemizedDeductions ? String(itemizedDeductions) : null,
    taxableIncome: String(result.taxableIncome),
    federalTaxLiability: String(result.federalTaxLiability),
    federalTaxWithheld: String(totalFederalWithheld + withholdingAdjustments),
    federalRefundOrOwed: String(federalRefundOrOwed),
    stateTaxLiability: String(result.stateTaxLiability),
    stateTaxWithheld: String(totalStateWithheld),
    stateRefundOrOwed: String(stateRefundOrOwed),
    effectiveTaxRate: String(result.effectiveTaxRate),
  };

  // Upsert the tax return
  const [existing] = await db
    .select()
    .from(taxReturnsTable)
    .where(eq(taxReturnsTable.clientId, params.data.clientId));

  let taxReturn;
  if (existing) {
    [taxReturn] = await db
      .update(taxReturnsTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(taxReturnsTable.clientId, params.data.clientId))
      .returning();
  } else {
    [taxReturn] = await db.insert(taxReturnsTable).values(payload).returning();
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
