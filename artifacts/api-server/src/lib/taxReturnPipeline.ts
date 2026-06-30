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
  assetBalancesTable,
  scheduleCAssetsTable,
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
  type AssetBalanceFact,
  type TaxReturnInputs,
} from "./taxReturnEngine";
import { logger } from "./logger";
import { evaluatePlanningOpportunities, federalMarginalRate, planningScore } from "./planningEngine";

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
  AssetBalanceFact,
  TaxReturnInputs,
};

/**
 * T1.0j (M-4) — year-scoped adjustments. An adjustment row applies to the
 * computed year when its `tax_year` is NULL (legacy/manual rows: every year —
 * preserves ALL pre-existing behavior) OR equals the year being computed.
 * PURE — shared by the pipeline and every route that loads adjustments for a
 * year-scoped computation (planning, Form 8606/8990, roll-forward report).
 */
export function adjustmentAppliesToYear(
  adj: { taxYear?: number | null },
  taxYear: number,
): boolean {
  return adj.taxYear == null || adj.taxYear === taxYear;
}

/** T1.0j (M-4) — convenience array filter over `adjustmentAppliesToYear`. */
export function filterAdjustmentsForYear<T extends { taxYear?: number | null }>(
  rows: T[],
  taxYear: number,
): T[] {
  return rows.filter((a) => adjustmentAppliesToYear(a, taxYear));
}

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
): Promise<{
  result: ComputedTaxReturn;
  client: typeof clientsTable.$inferSelect;
  inputs: TaxReturnInputs;
} | null> {
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) return null;

  // Tax year resolution: explicit override > client.taxYear (NOT NULL in the
  // schema, so the old `existing?.taxYear` tail was dead) > prior calendar year.
  const taxYear =
    overrides.taxYear ?? client.taxYear ?? new Date().getFullYear() - 1;

  // The existing return MUST be scoped to the resolved tax year. Selecting by
  // clientId alone returned an arbitrary row (the index hands back the LOWEST
  // tax year for a multi-year client), and existing.itemizedDeductions then
  // leaked into `existingItemizedFallback` for a DIFFERENT year — forcing a
  // standard-deduction year to itemize the other year's total and silently
  // persisting an understated tax. (Confirmed end-to-end, full-app audit 2026-06-30.)
  const [existing] = await db
    .select()
    .from(taxReturnsTable)
    .where(and(eq(taxReturnsTable.clientId, clientId), eq(taxReturnsTable.taxYear, taxYear)));

  // W-2s for the requested year only
  // Code-quality optimization: load all per-year tables in parallel.
  // Previously these were 6 sequential awaits → ~6× the network RTT.
  // Promise.all collapses to a single roundtrip per query batch on the
  // pool. These queries are independent so there's no ordering risk.
  const [
    w2Records,
    form1099Records,
    allAdjustmentRows,
    rentalProperties,
    capitalTransactions,
    scheduleK1,
    assetBalances,
    scheduleCAssetRows,
  ] = await Promise.all([
    db.select().from(w2DataTable).where(
      and(eq(w2DataTable.clientId, clientId), eq(w2DataTable.taxYear, taxYear)),
    ),
    db.select().from(form1099DataTable).where(
      and(eq(form1099DataTable.clientId, clientId), eq(form1099DataTable.taxYear, taxYear)),
    ),
    // Adjustments: load all rows, then filter to the computed year below
    // (T1.0j M-4: tax_year IS NULL = every year [all legacy rows]; a non-null
    // tax_year applies only to that year). Engine additionally filters by
    // isApplied. Auto-loaded synthetic carryforwards added downstream via
    // synthesizePriorYearCarryforwards.
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
    // Phase H — H5. Asset balances for this tax year. Used by H6 (Form 8606
    // IRA basis), H1 NUA / Mega-Backdoor Roth detectors.
    db.select().from(assetBalancesTable).where(
      and(
        eq(assetBalancesTable.clientId, clientId),
        eq(assetBalancesTable.taxYear, taxYear),
      ),
    ),
    // Schedule C asset register — loaded for ALL years (NOT taxYear-filtered):
    // multi-year MACRS needs prior-year assets, and the engine safely skips any
    // placed in a FUTURE year (placedInServiceYear > taxYear).
    db.select().from(scheduleCAssetsTable).where(eq(scheduleCAssetsTable.clientId, clientId)),
  ]);

  // T1.0j (M-4) — keep only the adjustments that apply to THIS tax year
  // (NULL tax_year = all years; non-null = that year only). Done BEFORE the
  // carryforward synthesis so a year-tagged manual carryforward for a
  // DIFFERENT year can't suppress this year's auto-load.
  const adjustments = filterAdjustmentsForYear(allAdjustmentRows, taxYear);

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
  const inputs: TaxReturnInputs = {
    client: { ...(client as ClientFacts), priorYearItemized: priorYearItemizedDerived } as ClientFacts,
    w2s: w2Records as W2Fact[],
    form1099s: form1099Records as Form1099Fact[],
    adjustments: [...adjustments, ...synthesizedAdjustments] as AdjustmentFact[],
    rentalProperties: rentalProperties as RentalPropertyFact[],
    capitalTransactions: capitalTransactions as CapitalTransactionFact[],
    scheduleK1: scheduleK1 as ScheduleK1Fact[],
    assetBalances: assetBalances as AssetBalanceFact[],
    // Map the asset-register rows → the engine's ScheduleCAsset shape (numeric
    // coercion + recoveryYears/quarter union narrowing).
    scheduleCAssets: scheduleCAssetRows.map((a) => ({
      cost: Number(a.cost),
      recoveryYears: Number(a.recoveryYears) as 3 | 5 | 7 | 10 | 15 | 20,
      placedInServiceYear: a.placedInServiceYear,
      placedInServiceQuarter:
        a.placedInServiceQuarter != null ? (Number(a.placedInServiceQuarter) as 1 | 2 | 3 | 4) : undefined,
      section179: a.section179,
      bonus: a.bonus,
      bonusFullObbba: a.bonusFullObbba,
      isPassengerAuto: a.isPassengerAuto,
      businessUsePct: a.businessUsePct != null ? Number(a.businessUsePct) : undefined,
      gvwrOver6000: a.gvwrOver6000,
    })),
    taxYear,
    overrides,
    existingItemizedFallback: existing?.itemizedDeductions ?? undefined,
  };
  const result = computeTaxReturnPure(inputs);

  return { result, client, inputs };
}

/**
 * H2 — Load just the assembled TaxReturnInputs for a client, without running
 * the engine. Used by the what-if endpoint: it needs the baseline inputs to
 * apply mutations against, then runs the engine itself via
 * runWhatIfScenario / runWhatIfScenarios.
 *
 * Same data path as `computeTaxReturn`: prior-year carryforwards are
 * synthesized, prior-year-itemized derived, and tax year resolved identically
 * so the baseline matches the persisted return exactly.
 */
export async function loadTaxReturnInputs(
  clientId: number,
  overrides: RecalcOverrides = {},
): Promise<{ inputs: TaxReturnInputs; client: typeof clientsTable.$inferSelect } | null> {
  const compute = await computeTaxReturn(clientId, overrides);
  if (!compute) return null;
  return { inputs: compute.inputs, client: compute.client };
}

/**
 * Auto-load prior-year carryforwards as synthetic adjustments.
 *
 * Exported for the T2.2 roll-forward endpoint, which reports the same list
 * (single source of truth for "what will auto-seed in year N").
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
export async function synthesizePriorYearCarryforwards(
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
  // Engine applies it against (regular tax − other nonrefundable credits) −
  // tentative minimum tax (§53(c); zero when AMT binds this year).
  // F-3 (audit 2026-06-11): the persisted amtCreditCarryforwardRemaining is
  // now the §53(d) DEFERRAL-ITEM-ONLY credit (Form 8801 Part I — exclusion-
  // item AMT such as the SALT/std-ded addbacks generates NO credit). Rows
  // computed BEFORE the F-3 fix may carry the old inflated 100%-of-AMT value
  // until their year is recalculated; a CPA can override via a manual
  // `amt_credit_carryforward` adjustment as before.
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

  // P2-3 — Form 1116 Schedule B / §904(c) foreign-tax-credit carryover
  // (1-back / 10-forward). Auto-load the prior-year unused FTC; the engine
  // folds it into this year's combined foreign tax before the §904 limit.
  const ftcCarry = Number(priorReturn.foreignTaxCreditCarryforwardRemaining ?? 0);
  if (ftcCarry > 0 && !hasManualOverride("foreign_tax_credit_carryforward")) {
    synthetic.push({
      adjustmentType: "foreign_tax_credit_carryforward",
      amount: ftcCarry,
      isApplied: true,
    });
  }

  // P2-13 — §23 adoption credit carryforward (5-year life, §23(c)). Auto-load
  // the prior-year unused nonrefundable portion as the
  // `adoption_credit_carryforward` adjustment so the engine applies it against
  // this year's income tax before the §23 credit re-derives the carryforward.
  const adoptionCarry = Number(priorReturn.adoptionCreditCarryforwardRemaining ?? 0);
  if (adoptionCarry > 0 && !hasManualOverride("adoption_credit_carryforward")) {
    synthetic.push({
      adjustmentType: "adoption_credit_carryforward",
      amount: adoptionCarry,
      isApplied: true,
    });
  }

  // P2 — §163(d)(2) investment-interest carryforward (indefinite). Auto-load the
  // prior-year disallowed amount; the engine adds it to this year's investment
  // interest expense before re-applying the net-investment-income cap.
  const invIntCarry = Number(priorReturn.investmentInterestCarryforwardRemaining ?? 0);
  if (invIntCarry > 0 && !hasManualOverride("investment_interest_carryforward")) {
    synthetic.push({
      adjustmentType: "investment_interest_carryforward",
      amount: invIntCarry,
      isApplied: true,
    });
  }

  // P2 — §39 §41 R&D general-business-credit carryforward (1-back/20-forward).
  // Auto-load the prior-year §38-disallowed credit; the engine adds it to this
  // year's §41 credit before the §38(c) liability limit.
  const rdCarry = Number(priorReturn.rdCreditCarryforwardRemaining ?? 0);
  if (rdCarry > 0 && !hasManualOverride("rd_credit_carryforward")) {
    synthetic.push({
      adjustmentType: "rd_credit_carryforward",
      amount: rdCarry,
      isApplied: true,
    });
  }

  // P2 — §39 §51 WOTC + §45S FMLA general-business-credit carryforward
  // (1-back/20-forward). Auto-load the prior-year §38-disallowed credit; the
  // engine adds it to this year's §51/§45S credits before the §38(c) limit
  // (mirrors the §41 R&D carryforward above).
  const otherGbcCarry = Number(priorReturn.otherGeneralBusinessCreditCarryforwardRemaining ?? 0);
  if (otherGbcCarry > 0 && !hasManualOverride("general_business_credit_carryforward")) {
    synthetic.push({
      adjustmentType: "general_business_credit_carryforward",
      amount: otherGbcCarry,
      isApplied: true,
    });
  }

  // P2 — §179(b)(3)(B) Schedule C asset §179 income-limit carryforward (indefinite).
  // Auto-load the prior-year income-disallowed §179; the asset calculator adds it
  // to this year's §179 available before the income limit (mirrors the §41/§51
  // carryforwards above; deductible even with no new assets this year).
  const schCS179Carry = Number(priorReturn.scheduleCSection179CarryforwardRemaining ?? 0);
  if (schCS179Carry > 0 && !hasManualOverride("schedule_c_section179_carryforward")) {
    synthetic.push({
      adjustmentType: "schedule_c_section179_carryforward",
      amount: schCS179Carry,
      isApplied: true,
    });
  }

  // CF2 (audit 2026-06-08) — NOL carryforward (§172, indefinite, 80%-of-taxable
  // limited). The engine WRITES nolCarryforwardRemaining each year but it was the
  // only indefinite carryforward NOT auto-loaded (every sibling above is) — a
  // silent multi-year loss + a trap for the multi-year planning projections.
  const nolCarry = Number(priorReturn.nolCarryforwardRemaining ?? 0);
  if (nolCarry > 0 && !hasManualOverride("nol_carryforward")) {
    synthetic.push({
      adjustmentType: "nol_carryforward",
      amount: nolCarry,
      isApplied: true,
    });
  }

  // T1.0c #4(ii) — §199A(c)(2)(B) net qualified-business-LOSS carryforward.
  // A year whose combined QBI netted NEGATIVE produced a $0 deduction plus
  // qbiLossCarryforwardRemaining; that loss is treated as a loss from a
  // separate qualified trade/business in the NEXT year (reduces next year's
  // combined QBI). Auto-load it like every sibling carryforward above.
  const qbiLossCarry = Number(priorReturn.qbiLossCarryforwardRemaining ?? 0);
  if (qbiLossCarry > 0 && !hasManualOverride("qbi_loss_carryforward")) {
    synthetic.push({
      adjustmentType: "qbi_loss_carryforward",
      amount: qbiLossCarry,
      isApplied: true,
    });
  }

  // CF2 — §163(j)(2) disallowed business-interest carryforward (indefinite).
  // Same gap: the engine writes section163jDisallowedCarryforward but didn't
  // auto-load it; the engine adds it to this year's business interest before
  // re-applying the ATI-30% cap.
  const s163jCarry = Number(priorReturn.section163jDisallowedCarryforward ?? 0);
  if (s163jCarry > 0 && !hasManualOverride("section_163j_carryforward_from_prior")) {
    synthetic.push({
      adjustmentType: "section_163j_carryforward_from_prior",
      amount: s163jCarry,
      isApplied: true,
    });
  }

  // FC-11 — §25D(c) residential clean energy credit carryforward (unlimited
  // life). Auto-load the prior-year unused §25D; the engine applies it AFTER
  // the CTC (Form 5695 credit-limit-worksheet ordering) and re-derives the
  // remaining carryforward. A pre-2026 carryforward keeps applying in TY2026+
  // even though OBBBA §70506 terminated the credit for NEW post-2025
  // expenditures (the carryforward rule in §25D(c) was not amended).
  const cleanEnergyCarry = Number(priorReturn.residentialCleanEnergyCarryforward ?? 0);
  if (cleanEnergyCarry > 0 && !hasManualOverride("residential_clean_energy_carryforward")) {
    synthetic.push({
      adjustmentType: "residential_clean_energy_carryforward",
      amount: cleanEnergyCarry,
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

  // #14 (DB-02/03) — precompute the firm-wide planning-ranking columns ONCE here,
  // per recalc, so the hit-list + dashboard Top-10 can rank by a single indexed
  // `ORDER BY planning_score DESC LIMIT n` instead of running the planning engine
  // for every client on every request. Computed WITHOUT baselineInputs (no
  // what-if re-runs) to match the hit-list's own scoring and keep this write path
  // light. ISOLATED: a planning-eval failure must never block persisting the
  // return itself (the row's primary job) — fall back to null planning columns.
  let planningScoreValue: string | null = null;
  let planningMarginalRateValue: string | null = null;
  try {
    const hits = evaluatePlanningOpportunities({
      client: computed.client,
      computed: result,
      adjustments: computed.inputs.adjustments,
    });
    const fedRate = federalMarginalRate(result);
    planningMarginalRateValue = String(fedRate);
    planningScoreValue = String(Math.round(planningScore({ hits, federalMarginalRate: fedRate })));
  } catch (err) {
    logger.warn({ err, clientId }, "Planning-score precompute failed; persisting return with null planning columns");
  }

  // Multi-year: keyed by the (clientId, taxYear) composite unique constraint,
  // so each client can have one row per tax year (not one row total).

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
    // Clamp to the effective_tax_rate numeric(6,4) range. A degenerate return
    // (tiny income + fixed mandate/SE/carryforward taxes) can produce a rate ≥ 100,
    // which would overflow the column and throw — failing (and silently swallowing,
    // per recalculateAfterMutation) the WHOLE recalc, leaving the row stale.
    effectiveTaxRate: String(Math.max(-9.9999, Math.min(99.9999, result.effectiveTaxRate))),
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
    // C6 — ESPP / ISO disqualifying disposition ordinary comp income
    isoDisqualifyingDispositionOrdinary: String(result.isoDisqualifyingDispositionOrdinary),
    esppDisqualifyingDispositionOrdinary: String(result.esppDisqualifyingDispositionOrdinary),
    // C7 — §163(j) business interest limit + §461(l) excess loss
    section163jBusinessInterestExpense: String(result.section163jBusinessInterestExpense),
    section163jAllowedDeduction: String(result.section163jAllowedDeduction),
    section163jDisallowedCarryforward: String(result.section163jDisallowedCarryforward),
    section461lExcessLossAddback: String(result.section461lExcessLossAddback),
    // SCH1 — persist the T1.1 disclosure scalars for the results view.
    stateIndividualMandatePenalty: String(result.stateIndividualMandatePenalty),
    unrecapturedSection1250Gain: String(result.unrecapturedSection1250Gain),
    collectibles28RateGain: String(result.collectibles28RateGain),
    householdEmploymentTax: String(result.scheduleH.total),
    // T1.0b (audit 2026-06-11) — payment-side credits: F-5 Schedule 3 line 11
    // excess-SS withholding + F-6 Form 8959 Part IV Additional-Medicare
    // withholding (1040 line 25c). Both already inside federalRefundOrOwed.
    excessSocialSecurityCredit: String(result.excessSocialSecurityCredit),
    additionalMedicareWithholding: String(result.additionalMedicareWithholding),
    socialSecurityBenefits: String(result.socialSecurityBenefits),
    socialSecurityTaxable: String(result.socialSecurityTaxable),
    feieTotalExclusion: String(result.feie.totalExclusion),
    nolDeduction: String(result.nolDeduction),
    nolCarryforwardRemaining: String(result.nolCarryforwardRemaining),
    qbiLossCarryforwardRemaining: String(result.qbiLossCarryforward),
    amtCreditApplied: String(result.amtCreditApplied),
    amtCreditGenerated: String(result.amtCreditGenerated),
    amtCreditCarryforwardRemaining: String(result.amtCreditCarryforwardRemaining),
    foreignTaxCreditCarryforwardRemaining: String(result.foreignTaxCreditCarryforwardRemaining),
    adoptionCreditCarryforwardRemaining: String(result.adoptionCreditCarryforwardRemaining),
    investmentInterestCarryforwardRemaining: String(result.investmentInterestDisallowed),
    rdCreditCarryforwardRemaining: String(result.rdCreditCarryforwardRemaining),
    otherGeneralBusinessCreditCarryforwardRemaining: String(result.otherGeneralBusinessCreditCarryforward),
    scheduleCSection179CarryforwardRemaining: String(result.scheduleCAssetDepreciation?.section179Carryforward ?? 0),
    totalNonRefundableApplied: String(result.totalNonRefundableApplied),
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
    // FC-11 — §25D(c) unused-credit carryforward (auto-loaded next year).
    residentialCleanEnergyCarryforward: String(result.residentialCleanEnergyCarryforward),
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
    // #14 — precomputed planning-ranking columns (see the computation above).
    planningScore: planningScoreValue,
    planningMarginalRate: planningMarginalRateValue,
  };

  // Atomic upsert on the (clientId, taxYear) unique constraint. Replaces a
  // non-atomic SELECT-then-INSERT/UPDATE that could race two concurrent
  // recalcs for the same client+year into a unique violation (spurious 500)
  // or a silently-stale row (BE-02). Concurrent UPDATEs are last-write-wins,
  // which is safe here: the recalc is deterministic from persisted inputs.
  const [row] = await db
    .insert(taxReturnsTable)
    .values(payload)
    .onConflictDoUpdate({
      target: [taxReturnsTable.clientId, taxReturnsTable.taxYear],
      set: { ...payload, updatedAt: new Date() },
    })
    .returning();
  return row;
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
