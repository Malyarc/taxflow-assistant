/**
 * Single source of truth for tax return calculation + persistence.
 *
 * Layered:
 *   - computeTaxReturn(): pure calculation (no DB writes). Used by both the
 *     persistent recalc path and the on-demand "/preview" endpoint.
 *   - recalculateAndUpsertTaxReturn(): wraps compute + writes the result row.
 *   - recalculateInBackground(): fire-and-forget version used by mutation routes.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  clientsTable,
  w2DataTable,
  adjustmentsTable,
  taxReturnsTable,
} from "@workspace/db";
import {
  runTaxCalculation,
  calculateChildTaxCredit,
  type CtcCalculation,
} from "./taxCalculator";
import { logger } from "./logger";

export interface RecalcOverrides {
  taxYear?: number;
  additionalIncome?: number;
  additionalDeductions?: number;
  useItemizedDeductions?: boolean;
}

function toNum(val: string | null | undefined): number {
  if (val == null) return 0;
  return Number(val) || 0;
}

export interface ComputedTaxReturn {
  /** Tax year actually computed for */
  taxYear: number;
  filingStatus: string;
  stateCode: string;
  totalIncome: number;
  adjustedGrossIncome: number;
  standardDeduction: number;
  itemizedDeductions: number | null;
  taxableIncome: number;
  federalTaxLiability: number;
  federalTaxWithheld: number;
  federalRefundOrOwed: number;
  stateTaxLiability: number;
  stateTaxWithheld: number;
  stateRefundOrOwed: number;
  effectiveTaxRate: number;
  /** Sum of CPA-authored "credit" adjustments applied (manual entries) */
  manualCreditsApplied: number;
  /** Auto-computed Child Tax Credit + Credit for Other Dependents */
  childTaxCredit: CtcCalculation;
  /** Number of W-2s included in the total wages */
  w2Count: number;
}

/**
 * Pure compute — no DB writes. Loads client/W-2/adjustments, computes the
 * full tax return, and returns numeric results. Same logic used by the
 * persistent recalc path and the preview endpoint.
 */
export async function computeTaxReturn(
  clientId: number,
  overrides: RecalcOverrides = {},
): Promise<{ result: ComputedTaxReturn; client: typeof clientsTable.$inferSelect } | null> {
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) return null;

  const [existing] = await db
    .select()
    .from(taxReturnsTable)
    .where(eq(taxReturnsTable.clientId, clientId));

  // Tax year resolution: explicit override > client.taxYear > existing.taxYear
  const taxYear =
    overrides.taxYear ?? client.taxYear ?? existing?.taxYear ?? new Date().getFullYear() - 1;
  const additionalIncome = overrides.additionalIncome ?? 0;
  const useItemizedDeductions =
    overrides.useItemizedDeductions ?? Boolean(existing?.itemizedDeductions);
  const additionalDeductions =
    overrides.additionalDeductions ?? toNum(existing?.itemizedDeductions);

  // W-2s for the requested year only
  const w2Records = await db
    .select()
    .from(w2DataTable)
    .where(
      and(eq(w2DataTable.clientId, clientId), eq(w2DataTable.taxYear, taxYear)),
    );
  const totalWages = w2Records.reduce((s, r) => s + toNum(r.wagesBox1), 0);
  const totalFederalWithheld = w2Records.reduce(
    (s, r) => s + toNum(r.federalTaxWithheldBox2),
    0,
  );
  const totalStateWithheld = w2Records.reduce(
    (s, r) => s + toNum(r.stateTaxWithheldBox17),
    0,
  );

  const stateCode =
    (client.state && client.state.trim()) ||
    w2Records.find((r) => r.stateCode)?.stateCode ||
    "";

  // CPA-authored adjustments (only "applied" ones)
  const adjustments = await db
    .select()
    .from(adjustmentsTable)
    .where(eq(adjustmentsTable.clientId, clientId));
  const applied = adjustments.filter((a) => a.isApplied);

  const sumByType = (type: string) =>
    applied
      .filter((a) => a.adjustmentType === type)
      .reduce((s, a) => s + toNum(a.amount), 0);

  const deductionAdjustments = sumByType("deduction");
  const creditAdjustments = sumByType("credit");
  const additionalIncomeAdjustments = sumByType("additional_income");
  const withholdingAdjustments = sumByType("withholding_adjustment");
  const otherDeductions = sumByType("other");

  const totalAdditionalIncome = additionalIncome + additionalIncomeAdjustments;
  const aboveTheLineAdjustments = deductionAdjustments + otherDeductions;
  const itemizedDeductions = additionalDeductions;

  const calc = runTaxCalculation({
    totalWages,
    additionalIncome: totalAdditionalIncome,
    filingStatus: client.filingStatus,
    stateCode: stateCode ?? "CA",
    useItemizedDeductions,
    itemizedDeductions,
    adjustments: aboveTheLineAdjustments,
    taxYear,
  });

  const ctc = calculateChildTaxCredit({
    qualifyingChildren: client.dependentsUnder17 ?? 0,
    otherDependents: client.otherDependents ?? 0,
    agi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    taxYear,
  });

  const federalRefundOrOwed =
    totalFederalWithheld +
    withholdingAdjustments -
    calc.federalTaxLiability +
    creditAdjustments +
    ctc.appliedCredit;
  const stateRefundOrOwed = totalStateWithheld - calc.stateTaxLiability;

  const result: ComputedTaxReturn = {
    taxYear: calc.taxYear,
    filingStatus: client.filingStatus,
    stateCode,
    totalIncome: calc.totalIncome,
    adjustedGrossIncome: calc.adjustedGrossIncome,
    standardDeduction: calc.standardDeduction,
    itemizedDeductions: useItemizedDeductions ? itemizedDeductions : null,
    taxableIncome: calc.taxableIncome,
    federalTaxLiability: calc.federalTaxLiability,
    federalTaxWithheld: totalFederalWithheld + withholdingAdjustments,
    federalRefundOrOwed,
    stateTaxLiability: calc.stateTaxLiability,
    stateTaxWithheld: totalStateWithheld,
    stateRefundOrOwed,
    effectiveTaxRate: calc.effectiveTaxRate,
    manualCreditsApplied: creditAdjustments,
    childTaxCredit: ctc,
    w2Count: w2Records.length,
  };

  return { result, client };
}

export async function recalculateAndUpsertTaxReturn(
  clientId: number,
  overrides: RecalcOverrides = {},
): Promise<typeof taxReturnsTable.$inferSelect | null> {
  const computed = await computeTaxReturn(clientId, overrides);
  if (!computed) {
    logger.warn({ clientId }, "recalculateAndUpsertTaxReturn: client not found");
    return null;
  }
  const { result } = computed;

  const [existing] = await db
    .select()
    .from(taxReturnsTable)
    .where(eq(taxReturnsTable.clientId, clientId));

  const payload = {
    clientId,
    taxYear: result.taxYear,
    filingStatus: result.filingStatus,
    totalIncome: String(result.totalIncome),
    adjustedGrossIncome: String(result.adjustedGrossIncome),
    standardDeduction: String(result.standardDeduction),
    itemizedDeductions: result.itemizedDeductions != null ? String(result.itemizedDeductions) : null,
    taxableIncome: String(result.taxableIncome),
    federalTaxLiability: String(result.federalTaxLiability),
    federalTaxWithheld: String(result.federalTaxWithheld),
    federalRefundOrOwed: String(result.federalRefundOrOwed),
    stateTaxLiability: String(result.stateTaxLiability),
    stateTaxWithheld: String(result.stateTaxWithheld),
    stateRefundOrOwed: String(result.stateRefundOrOwed),
    effectiveTaxRate: String(result.effectiveTaxRate),
  };

  if (existing) {
    const [updated] = await db
      .update(taxReturnsTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(taxReturnsTable.clientId, clientId))
      .returning();
    return updated;
  }
  const [created] = await db.insert(taxReturnsTable).values(payload).returning();
  return created;
}

/**
 * Fire-and-forget recalc — for use after non-blocking mutations where we
 * don't want to slow down the request response. Errors are logged.
 */
export function recalculateInBackground(clientId: number): void {
  recalculateAndUpsertTaxReturn(clientId).catch((err) => {
    logger.error({ err, clientId }, "Background tax-return recalc failed");
  });
}
