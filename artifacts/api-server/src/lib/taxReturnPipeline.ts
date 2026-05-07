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
  calculateSelfEmploymentTax,
  calculateNiit,
  calculateQbi,
  calculateAmt,
  calculateFederalTax,
  type CtcCalculation,
  type SeTaxCalculation,
  type NiitCalculation,
  type QbiCalculation,
  type AmtCalculation,
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
  /** QBI deduction (Section 199A), reduces taxable income further */
  qbiDeduction: number;
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
  /** Self-employment tax (15.3% on net SE earnings) */
  selfEmploymentTax: number;
  /** Net Investment Income Tax (3.8% IRC §1411) */
  niitTax: number;
  /** AMT delta — additional tax beyond regular tax. Often $0. */
  amtTax: number;
  /** Refundable portion of CTC (Additional Child Tax Credit) */
  additionalChildTaxCredit: number;
  /** Detailed breakdowns for transparency */
  detail: {
    se: SeTaxCalculation;
    niit: NiitCalculation;
    qbi: QbiCalculation;
    amt: AmtCalculation;
  };
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

  // ── New adjustment types (added with SE/NIIT/QBI/AMT support) ──
  const seIncome = sumByType("self_employment_income");
  const investmentIncome = sumByType("investment_income");
  const qbiIncome = sumByType("qbi_income");
  const amtPreferences = sumByType("amt_preferences");

  // SE tax — applies before AGI is finalized (1/2 deductible above the line)
  const se = calculateSelfEmploymentTax(seIncome, taxYear);

  const totalAdditionalIncome = additionalIncome + additionalIncomeAdjustments + seIncome + investmentIncome;
  const aboveTheLineAdjustments = deductionAdjustments + otherDeductions + se.deductibleHalf;
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

  // QBI deduction reduces taxable income further (capped at 20% of taxable income before QBI)
  const qbi = calculateQbi({
    qbiIncome,
    taxableIncomeBeforeQbi: calc.taxableIncome,
  });
  const taxableAfterQbi = Math.max(0, calc.taxableIncome - qbi.finalDeduction);
  // Recompute federal tax with the lower taxable income (only if QBI applies)
  const regularFederalTax = qbi.finalDeduction > 0
    ? calculateFederalTax(taxableAfterQbi, client.filingStatus, taxYear)
    : calc.federalTaxLiability;

  // AMT — alternative computation; final regular tax = max(regular, regular + AMT delta)
  const amt = calculateAmt({
    taxableIncome: taxableAfterQbi,
    amtPreferences,
    filingStatus: client.filingStatus,
    regularTax: regularFederalTax,
    taxYear,
  });

  // NIIT — 3.8% on lesser of (investment income, AGI over threshold)
  const niit = calculateNiit({
    investmentIncome,
    modifiedAgi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
  });

  // Total federal liability before credits = regular + AMT + NIIT + SE
  const totalFederalLiability =
    regularFederalTax + amt.amtTax + niit.niitTax + se.seTaxTotal;

  // CTC: refundable split based on tax owed before CTC.
  // Tax-before-credit reference for CTC is regular + AMT (NIIT/SE don't reduce by CTC).
  const earnedIncome = totalWages + Math.max(0, seIncome - se.deductibleHalf);
  const ctc = calculateChildTaxCredit({
    qualifyingChildren: client.dependentsUnder17 ?? 0,
    otherDependents: client.otherDependents ?? 0,
    agi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    taxYear,
    taxBeforeCredit: regularFederalTax + amt.amtTax,
    earnedIncome,
  });

  const federalRefundOrOwed =
    totalFederalWithheld +
    withholdingAdjustments -
    totalFederalLiability +
    creditAdjustments +
    ctc.appliedCredit; // appliedCredit already includes refundable portion
  const stateRefundOrOwed = totalStateWithheld - calc.stateTaxLiability;

  // Effective tax rate uses the full federal + state liability (before credits)
  const totalTaxBurden = totalFederalLiability + calc.stateTaxLiability;
  const effectiveRate = calc.totalIncome > 0 ? totalTaxBurden / calc.totalIncome : 0;

  const result: ComputedTaxReturn = {
    taxYear: calc.taxYear,
    filingStatus: client.filingStatus,
    stateCode,
    totalIncome: calc.totalIncome,
    adjustedGrossIncome: calc.adjustedGrossIncome,
    standardDeduction: calc.standardDeduction,
    itemizedDeductions: useItemizedDeductions ? itemizedDeductions : null,
    qbiDeduction: qbi.finalDeduction,
    taxableIncome: taxableAfterQbi,
    federalTaxLiability: totalFederalLiability,
    federalTaxWithheld: totalFederalWithheld + withholdingAdjustments,
    federalRefundOrOwed,
    stateTaxLiability: calc.stateTaxLiability,
    stateTaxWithheld: totalStateWithheld,
    stateRefundOrOwed,
    effectiveTaxRate: effectiveRate,
    manualCreditsApplied: creditAdjustments,
    childTaxCredit: ctc,
    selfEmploymentTax: se.seTaxTotal,
    niitTax: niit.niitTax,
    amtTax: amt.amtTax,
    additionalChildTaxCredit: ctc.refundableActc,
    detail: { se, niit, qbi, amt },
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

  // Multi-year: look up by (clientId, taxYear) composite, not just clientId.
  // This means each client can have one row per tax year, not one row total.
  const [existing] = await db
    .select()
    .from(taxReturnsTable)
    .where(
      and(
        eq(taxReturnsTable.clientId, clientId),
        eq(taxReturnsTable.taxYear, result.taxYear),
      ),
    );

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
    selfEmploymentTax: result.selfEmploymentTax != null ? String(result.selfEmploymentTax) : null,
    qbiDeduction: result.qbiDeduction != null ? String(result.qbiDeduction) : null,
    amtTax: result.amtTax != null ? String(result.amtTax) : null,
    niitTax: result.niitTax != null ? String(result.niitTax) : null,
    additionalChildTaxCredit: result.additionalChildTaxCredit != null ? String(result.additionalChildTaxCredit) : null,
  };

  if (existing) {
    const [updated] = await db
      .update(taxReturnsTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(
        and(
          eq(taxReturnsTable.clientId, clientId),
          eq(taxReturnsTable.taxYear, result.taxYear),
        ),
      )
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
export function recalculateInBackground(clientId: number, taxYear?: number): void {
  recalculateAndUpsertTaxReturn(clientId, taxYear ? { taxYear } : {}).catch((err) => {
    logger.error({ err, clientId, taxYear }, "Background tax-return recalc failed");
  });
}
