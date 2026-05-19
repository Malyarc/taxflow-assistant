/**
 * Drizzle/Express adapter for the tax return engine.
 *
 * Layered:
 *   - taxReturnEngine.ts: pure compute, no DB, no I/O. Haven-portable.
 *   - This file: loads inputs from Drizzle, calls the pure engine, writes the result.
 *
 *   - computeTaxReturn(): DB-backed wrapper that loads rows and calls
 *     computeTaxReturnPure(). Used by both the persistent recalc path and the
 *     on-demand "/preview" endpoint.
 *   - recalculateAndUpsertTaxReturn(): wraps compute + writes the result row.
 *   - recalculateInBackground(): fire-and-forget version used by mutation routes.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  clientsTable,
  w2DataTable,
  form1099DataTable,
  adjustmentsTable,
  taxReturnsTable,
} from "@workspace/db";
import {
  computeTaxReturnPure,
  type ComputedTaxReturn,
  type RecalcOverrides,
  type Form1099Summary,
  type ClientFacts,
  type W2Fact,
  type Form1099Fact,
  type AdjustmentFact,
  type TaxReturnInputs,
} from "./taxReturnEngine";
import { logger } from "./logger";

// Re-export engine types for backward-compatible imports from this module.
export type {
  ComputedTaxReturn,
  RecalcOverrides,
  Form1099Summary,
  ClientFacts,
  W2Fact,
  Form1099Fact,
  AdjustmentFact,
  TaxReturnInputs,
};

/**
 * DB-backed compute. Loads client / W-2s / 1099s / adjustments, calls the pure
 * engine, returns the result + raw client row (some callers need it for routing).
 *
 * For pure invocation (no DB), call computeTaxReturnPure() directly with
 * inputs you've assembled yourself.
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

  // W-2s for the requested year only
  const w2Records = await db
    .select()
    .from(w2DataTable)
    .where(
      and(eq(w2DataTable.clientId, clientId), eq(w2DataTable.taxYear, taxYear)),
    );

  // 1099s for the requested year only
  const form1099Records = await db
    .select()
    .from(form1099DataTable)
    .where(
      and(eq(form1099DataTable.clientId, clientId), eq(form1099DataTable.taxYear, taxYear)),
    );

  // CPA-authored adjustments (all of them — engine filters by isApplied)
  const adjustments = await db
    .select()
    .from(adjustmentsTable)
    .where(eq(adjustmentsTable.clientId, clientId));

  // Drizzle rows satisfy the engine's Fact types via structural typing.
  const result = computeTaxReturnPure({
    client: client as ClientFacts,
    w2s: w2Records as W2Fact[],
    form1099s: form1099Records as Form1099Fact[],
    adjustments: adjustments as AdjustmentFact[],
    taxYear,
    overrides,
    existingItemizedFallback: existing?.itemizedDeductions,
  });

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

  // Education credits split: aocCredit = total AOC applied (refundable + non-refundable AOC);
  // aocRefundablePortion separated for display.
  const aocCreditTotal = result.educationCredits.aocApplied;
  const aocRefundable = result.educationCredits.aocRefundable;
  const llcCreditTotal = result.educationCredits.llcApplied;

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
    capitalGainsTax: result.capitalGainsTax != null ? String(result.capitalGainsTax) : null,
    preferentialIncome: result.preferentialIncome != null ? String(result.preferentialIncome) : null,
    // Phase 1: Schedule A breakdown
    medicalDeductible: String(result.scheduleA.medicalDeductible),
    saltDeductible: String(result.scheduleA.saltDeductible),
    mortgageDeductible: String(result.scheduleA.mortgageDeductible),
    charitableDeductible: String(result.scheduleA.charitableDeductible),
    // Phase 1: Above-the-line
    hsaDeduction: String(result.retirementDeductions.hsaDeductible),
    iraDeduction: String(result.retirementDeductions.iraDeductible),
    // Phase 1: Credits
    eitc: String(result.eitc.appliedCredit),
    aocCredit: String(aocCreditTotal),
    aocRefundablePortion: String(aocRefundable),
    llcCredit: String(llcCreditTotal),
    saversCredit: String(result.saversCredit.appliedCredit),
    dependentCareCredit: String(result.dependentCareCredit.appliedCredit),
    // Phase 1: Schedule C
    scheduleCExpenses: String(result.scheduleCExpenses),
    // Phase 1.5: Above-the-line deductions
    educatorExpensesDeduction: String(result.educatorExpenses.deductible),
    studentLoanInterestDeduction: String(result.studentLoanInterest.deductible),
    // Phase 1.5: Credits
    foreignTaxCredit: String(result.foreignTaxCredit.credit),
    residentialEnergyCredits: String(result.residentialEnergyCredits.total),
    premiumTaxCredit: String(result.premiumTaxCredit.netPtc),
    // Phase 2b: Capital loss + state retirement exemption
    capitalLossDeducted: String(result.capitalLossDeducted),
    capitalLossCarryforwardShort: String(result.capitalLossCarryforwardShort),
    capitalLossCarryforwardLong: String(result.capitalLossCarryforwardLong),
    netCapitalGainLoss: String(result.netCapitalGainLoss),
    stateRetirementExemption: String(result.stateRetirementExemption),
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
