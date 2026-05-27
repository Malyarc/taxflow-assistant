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
  rentalPropertiesTable,
  capitalTransactionsTable,
  scheduleK1DataTable,
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
  type RentalPropertyFact,
  type CapitalTransactionFact,
  type ScheduleK1Fact,
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
  RentalPropertyFact,
  CapitalTransactionFact,
  ScheduleK1Fact,
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
  // Code-quality optimization: load all per-year tables in parallel.
  // Previously these were 6 sequential awaits → ~6× the network RTT.
  // Promise.all collapses to a single roundtrip per query batch on the
  // pool. These queries are independent so there's no ordering risk.
  const [
    w2Records,
    form1099Records,
    adjustments,
    rentalProperties,
    capitalTransactions,
    scheduleK1,
  ] = await Promise.all([
    db.select().from(w2DataTable).where(
      and(eq(w2DataTable.clientId, clientId), eq(w2DataTable.taxYear, taxYear)),
    ),
    db.select().from(form1099DataTable).where(
      and(eq(form1099DataTable.clientId, clientId), eq(form1099DataTable.taxYear, taxYear)),
    ),
    // Adjustments: load all-years; engine filters by isApplied. Auto-loaded
    // synthetic carryforwards added downstream via synthesizePriorYearCarryforwards.
    db.select().from(adjustmentsTable).where(eq(adjustmentsTable.clientId, clientId)),
    db.select().from(rentalPropertiesTable).where(
      and(
        eq(rentalPropertiesTable.clientId, clientId),
        eq(rentalPropertiesTable.taxYear, taxYear),
      ),
    ),
    db.select().from(capitalTransactionsTable).where(
      and(
        eq(capitalTransactionsTable.clientId, clientId),
        eq(capitalTransactionsTable.taxYear, taxYear),
      ),
    ),
    db.select().from(scheduleK1DataTable).where(
      and(
        eq(scheduleK1DataTable.clientId, clientId),
        eq(scheduleK1DataTable.taxYear, taxYear),
      ),
    ),
  ]);

  // Auto-load capital-loss + §469 PAL carryforwards from the prior tax year.
  // We synthesize "virtual" adjustment rows IFF the user has NOT manually
  // entered a corresponding carryforward adjustment for the current year.
  // Manual adjustment always overrides — if a CPA explicitly enters $0 as the
  // carryforward, that suppresses the auto-load. This matches IRS expectation
  // that carryforwards roll from Pub 550 Schedule D / Pub 925 §469 worksheet.
  const synthesizedAdjustments = await synthesizePriorYearCarryforwards(
    clientId,
    taxYear,
    adjustments as AdjustmentFact[],
  );

  // E6 — Pub 525 / IRC §111 tax-benefit rule. Derive whether the prior
  // year's return itemized — if so, this year's state refund is federal-
  // taxable; if not (std ded last year), state refund is excluded. We read
  // the prior-year tax_returns row and compare itemizedDeductions to the
  // standard deduction. CPAs may override by setting priorYearItemized
  // explicitly on the client record (when migrating from another system
  // mid-stream and the prior return isn't in TaxFlow).
  let priorYearItemizedDerived: boolean | null = null;
  if (client.priorYearItemized != null) {
    priorYearItemizedDerived = client.priorYearItemized;
  } else {
    const [priorReturnForBenefit] = await db
      .select()
      .from(taxReturnsTable)
      .where(
        and(
          eq(taxReturnsTable.clientId, clientId),
          eq(taxReturnsTable.taxYear, taxYear - 1),
        ),
      );
    if (priorReturnForBenefit) {
      const itemized = Number(priorReturnForBenefit.itemizedDeductions ?? 0);
      const std = Number(priorReturnForBenefit.standardDeduction ?? 0);
      priorYearItemizedDerived = itemized > std;
    }
  }

  // Drizzle rows satisfy the engine's Fact types via structural typing.
  const result = computeTaxReturnPure({
    client: { ...(client as ClientFacts), priorYearItemized: priorYearItemizedDerived } as ClientFacts,
    w2s: w2Records as W2Fact[],
    form1099s: form1099Records as Form1099Fact[],
    adjustments: [...adjustments, ...synthesizedAdjustments] as AdjustmentFact[],
    rentalProperties: rentalProperties as RentalPropertyFact[],
    capitalTransactions: capitalTransactions as CapitalTransactionFact[],
    scheduleK1: scheduleK1 as ScheduleK1Fact[],
    taxYear,
    overrides,
    existingItemizedFallback: existing?.itemizedDeductions,
  });

  return { result, client };
}

/**
 * Auto-load prior-year carryforwards as synthetic adjustments.
 *
 * For tax year N, we look up the stored tax_returns row for year N-1 and pull
 * forward:
 *   - capital_loss_carryforward_short  (Sched D, preserves short character per Pub 550)
 *   - capital_loss_carryforward_long
 *   - schedule_e_passive_loss_carryforward (§469 suspended loss)
 *
 * If the user has already manually created a non-zero adjustment of the
 * matching type for year N, we DO NOT auto-load (manual override).
 * If the user has manually created a $0 adjustment, that's also a manual
 * override (suppresses auto-load).
 *
 * Returns synthetic AdjustmentFact rows (in-memory only; never written to DB).
 */
async function synthesizePriorYearCarryforwards(
  clientId: number,
  currentYear: number,
  existingAdjustments: AdjustmentFact[],
): Promise<AdjustmentFact[]> {
  const [priorReturn] = await db
    .select()
    .from(taxReturnsTable)
    .where(
      and(
        eq(taxReturnsTable.clientId, clientId),
        eq(taxReturnsTable.taxYear, currentYear - 1),
      ),
    );
  if (!priorReturn) return []; // No prior year row → no carryforward to load

  const synthetic: AdjustmentFact[] = [];
  // Manual override semantics: if the CPA has explicitly entered an applied
  // adjustment of the matching type (even $0), do NOT auto-load.
  const hasManualOverride = (type: string) =>
    existingAdjustments.some((a) => a.adjustmentType === type && a.isApplied);

  const stcgCarry = Number(priorReturn.capitalLossCarryforwardShort ?? 0);
  if (stcgCarry > 0 && !hasManualOverride("capital_loss_carryforward_short")) {
    synthetic.push({
      adjustmentType: "capital_loss_carryforward_short",
      amount: stcgCarry,
      isApplied: true,
    });
  }

  const ltcgCarry = Number(priorReturn.capitalLossCarryforwardLong ?? 0);
  if (ltcgCarry > 0 && !hasManualOverride("capital_loss_carryforward_long")) {
    synthetic.push({
      adjustmentType: "capital_loss_carryforward_long",
      amount: ltcgCarry,
      isApplied: true,
    });
  }

  const palCarry = Number(priorReturn.scheduleEPassiveLossSuspended ?? 0);
  if (palCarry > 0 && !hasManualOverride("schedule_e_passive_loss_carryforward")) {
    synthetic.push({
      adjustmentType: "schedule_e_passive_loss_carryforward",
      amount: palCarry,
      isApplied: true,
    });
  }

  const k1Carry = Number(priorReturn.k1PassiveLossSuspended ?? 0);
  if (k1Carry > 0 && !hasManualOverride("k1_passive_loss_carryforward")) {
    synthetic.push({
      adjustmentType: "k1_passive_loss_carryforward",
      amount: k1Carry,
      isApplied: true,
    });
  }

  // E2 — Form 8801 minimum-tax credit carryforward (IRC §53). Synthesize
  // the prior-year ending balance as a current-year input adjustment.
  // Engine applies it against the spread between regular tax and tentative
  // minimum tax (when AMT doesn't bind this year).
  const amtCreditCarry = Number(priorReturn.amtCreditCarryforwardRemaining ?? 0);
  if (amtCreditCarry > 0 && !hasManualOverride("amt_credit_carryforward")) {
    synthetic.push({
      adjustmentType: "amt_credit_carryforward",
      amount: amtCreditCarry,
      isApplied: true,
    });
  }

  // E3 — Cash charitable carryforward (IRC §170(d)(1), 5-year life).
  // Auto-loaded as `charitable_carryforward_cash` adjustment so the engine's
  // Schedule A path applies it against the 60% AGI cap.
  const charityCarry = Number(priorReturn.charitableCarryforwardCashRemaining ?? 0);
  if (charityCarry > 0 && !hasManualOverride("charitable_carryforward_cash")) {
    synthetic.push({
      adjustmentType: "charitable_carryforward_cash",
      amount: charityCarry,
      isApplied: true,
    });
  }

  return synthetic;
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
    additionalMedicareTax: result.additionalMedicareTax != null ? String(result.additionalMedicareTax) : null,
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
    sehiDeduction: String(result.sehi.deduction),
    homeSaleGrossGain: String(result.homeSaleGrossGain),
    homeSaleSection121Exclusion: String(result.homeSaleSection121Exclusion),
    homeSaleTaxableGain: String(result.homeSaleTaxableGain),
    // C5 — §1031 like-kind exchange breakdown
    section1031RealizedGain: String(result.section1031RealizedGain),
    section1031BootReceived: String(result.section1031BootReceived),
    section1031RecognizedGain: String(result.section1031RecognizedGain),
    section1031DeferredGain: String(result.section1031DeferredGain),
    socialSecurityBenefits: String(result.socialSecurityBenefits),
    socialSecurityTaxable: String(result.socialSecurityTaxable),
    feieTotalExclusion: String(result.feie.totalExclusion),
    nolDeduction: String(result.nolDeduction),
    nolCarryforwardRemaining: String(result.nolCarryforwardRemaining),
    amtCreditApplied: String(result.amtCreditApplied),
    amtCreditGenerated: String(result.amtCreditGenerated),
    amtCreditCarryforwardRemaining: String(result.amtCreditCarryforwardRemaining),
    charitableCarryforwardCashRemaining: String(result.charitableCarryforwardCashRemaining),
    qsbsGrossGain: String(result.qsbsGrossGain),
    qsbsSection1202Exclusion: String(result.qsbsSection1202Exclusion),
    qsbsTaxableGain: String(result.qsbsTaxableGain),
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
    // Phase 2e: Schedule E rental real estate
    scheduleERentalGrossNet: String(result.scheduleERentalGrossNet),
    scheduleERentalAppliedToAgi: String(result.scheduleERentalAppliedToAgi),
    scheduleEPalAllowance: result.passiveActivityLoss?.allowanceAfterPhaseOut != null ? String(result.passiveActivityLoss.allowanceAfterPhaseOut) : null,
    scheduleEPassiveLossSuspended: String(result.scheduleEPassiveLossSuspended),
    // Phase B+: K-1 passive bucket carryforward
    k1PassiveLossSuspended: String(result.scheduleK1.k1PassiveLossSuspended),
    // Phase B+: Local PIT (NYC, MD/OH/IN per E14)
    localTaxLiability: String(result.localTaxLiability),
    localTaxJurisdiction: result.localTaxJurisdiction,
    // E13: Auto wash-sale detection summary
    washSalesDetected: result.washSalesDetected,
    washSaleLossDisallowed: String(result.washSaleLossDisallowed),
    // E12: Part-year residency breakdown
    formerStateTax: String(result.formerStateTax),
    formerStateCode: result.formerStateCode,
    daysFormerStateResident: result.daysFormerStateResident,
    daysCurrentStateResident: result.daysCurrentStateResident,
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
 * Synchronous post-mutation recalc — awaits the recalc + upsert before
 * resolving so that the next read sees fresh data.
 *
 * Previously this was fire-and-forget (`recalculateInBackground`) which
 * caused races where a POST → immediate GET could read stale values. The
 * recalc is fast enough (sub-100ms in practice) that the slight added
 * latency on mutation endpoints is worth the correctness guarantee.
 *
 * Errors are caught + logged here (matching the prior behavior) so a calc
 * failure doesn't 500 the mutation, but the row write is preserved.
 */
export async function recalculateAfterMutation(clientId: number, taxYear?: number): Promise<void> {
  try {
    await recalculateAndUpsertTaxReturn(clientId, taxYear ? { taxYear } : {});
  } catch (err) {
    logger.error({ err, clientId, taxYear }, "Post-mutation tax-return recalc failed");
  }
}

/** @deprecated Use `await recalculateAfterMutation()` instead. Retained for backwards compat. */
export function recalculateInBackground(clientId: number, taxYear?: number): void {
  void recalculateAfterMutation(clientId, taxYear);
}
