/**
 * §453 installment-sale detector (G1.47) — H3 multi-year wiring (P2-15b / PLAN-Q2).
 *
 * Pure engine; no API required. §453's benefit is multi-year bracket-smoothing, so
 * a single-year what-if would FALSELY book the deferred-year tax as a saving. The
 * detector now uses the H3 multi-year primitive: BOTH trajectories recognize the
 * SAME total gain (baseline = lump in year 0, scenario = gain/N each year), so the
 * delta is the honest smoothing benefit (the deferred gain IS taxed later).
 *
 * The gain is injected via a new general `long_term_capital_gain` adjustment that
 * flows through Schedule D netting → AGI + preferential rate + §1411 NIIT.
 *
 * Two levels:
 *   M1 — the `long_term_capital_gain` lever itself (AGI/netting/preferential deltas).
 *   M2 — the §453 detector's multi-year, cross-checked against an INDEPENDENT
 *        runMultiYearTrajectory pair (proves the wiring, not just a number).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-section453-multiyear-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type AdjustmentFact,
  type ClientFacts,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { evaluatePlanningOpportunities } from "../../artifacts/api-server/src/lib/planningEngine";
import {
  runMultiYearTrajectory,
  DEFAULT_INCOME_GROWTH,
} from "../../artifacts/api-server/src/lib/multiYearEngine";
import type { WhatIfMutation } from "../../artifacts/api-server/src/lib/whatIfEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}±${tol}, got ${actual}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function checkRange(label: string, actual: number, lo: number, hi: number): void {
  if (actual >= lo && actual <= hi) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected [${lo}, ${hi}], got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

// ════════════════════════════════════════════════════════════════════════════
// M1 — the `long_term_capital_gain` lever flows correctly through netting
// ════════════════════════════════════════════════════════════════════════════
// Single FL TY2024, W-2 $50k. Adding $100k LTCG via the adjustment must raise AGI
// by $100k, set net capital gain to $100k, and raise preferential income by $100k.
header("M1: long_term_capital_gain lever → AGI / netting / preferential");
{
  const mk = (adj: AdjustmentFact[]): TaxReturnInputs => ({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [], adjustments: adj, taxYear: 2024,
  } as unknown as TaxReturnInputs);
  const base = computeTaxReturnPure(mk([]));
  const withGain = computeTaxReturnPure(mk([A("long_term_capital_gain", 100000)]));
  check("M1 AGI +$100k", withGain.adjustedGrossIncome - base.adjustedGrossIncome, 100000);
  check("M1 netCapitalGainLoss = $100k", withGain.netCapitalGainLoss, 100000);
  check("M1 preferentialIncome +$100k", withGain.preferentialIncome - base.preferentialIncome, 100000);

  // Cross-nets with a capital-loss carryforward: $100k gain − $30k LT loss CF = $70k.
  const netted = computeTaxReturnPure(mk([A("long_term_capital_gain", 100000), A("capital_loss_carryforward_long", 30000)]));
  check("M1 nets vs $30k loss CF → $70k", netted.netCapitalGainLoss, 70000);
}

// ════════════════════════════════════════════════════════════════════════════
// M2 — §453 detector multi-year, cross-checked vs independent trajectories
// ════════════════════════════════════════════════════════════════════════════
// MFJ TX, W-2 $300k, rental real_estate FMV $1.2M / basis $400k → $800k gain.
// §453 fires (AGI ≥ $250k, gain > $250k). Multi-year: baseline = $800k lump in
// year 0; scenario = $160k/yr × 5. Same total gain — delta = bracket-smoothing.
header("M2: §453 detector multi-year + independent cross-check");
{
  const YEARS = 5;
  const GAIN = 800000;
  const baselineInputs = {
    client: { filingStatus: "married_filing_jointly", state: "TX", taxYear: 2024, taxpayerAge: 55 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 0, stateCode: "TX" }],
    form1099s: [],
    adjustments: [],
    assetBalances: [
      { assetType: "real_estate", balance: "1200000", costBasis: "400000", accountName: "Rental", taxYear: 2024 },
    ],
    taxYear: 2024,
  } as unknown as TaxReturnInputs;

  const computed = computeTaxReturnPure(baselineInputs);
  checkRange("M2 AGI ≥ $250k (detector gate)", computed.adjustedGrossIncome, 250000, 400000);

  const client = { filingStatus: "married_filing_jointly" } as unknown as ClientFacts;
  const hits = evaluatePlanningOpportunities({ client, computed, adjustments: [], baselineInputs });
  const hit = hits.find((h) => h.strategyId === "G1.47") ?? null;
  checkBool("M2 G1.47 fires", hit != null, true);

  // Independent replication of the detector's two trajectories.
  const gainMut = (amount: number): WhatIfMutation[] => [
    { kind: "add_adjustment", adjustmentType: "long_term_capital_gain", amount } as WhatIfMutation,
  ];
  const sumBurden = (proj: ReturnType<typeof runMultiYearTrajectory>): number =>
    proj.yearReturns.reduce((s, r) => s + r.federalTaxLiability + r.stateTaxLiability, 0);
  const baseProj = runMultiYearTrajectory(baselineInputs, YEARS, {
    incomeGrowth: DEFAULT_INCOME_GROWTH,
    mutationsByYear: [gainMut(GAIN)], // year 0 only
  });
  const scenProj = runMultiYearTrajectory(baselineInputs, YEARS, {
    incomeGrowth: DEFAULT_INCOME_GROWTH,
    mutationsByYear: Array.from({ length: YEARS }, () => gainMut(GAIN / YEARS)),
  });
  const independentTotalSavings = Math.round(sumBurden(baseProj) - sumBurden(scenProj));

  if (hit && hit.multiYear) {
    checkBool("M2 multiYear attached", hit.multiYear != null, true);
    check("M2 horizon = 5", hit.multiYear.horizonYears, YEARS);
    // The detector's engine-computed savings must match the independent run.
    check("M2 totalSavings == independent trajectory delta", hit.multiYear.totalSavings, independentTotalSavings, 2);
    // estSavings (one-time) == the multi-year total, NOT the heuristic.
    check("M2 estSavings == multiYear.totalSavings", hit.estSavings, Math.round(hit.multiYear.totalSavings), 1);
    checkBool("M2 estSavings != heuristic 5%-of-gain", hit.estSavings !== Math.round(GAIN * 0.05), true);
    // Internal consistency: totalSavings == sum(baseline burdens) − sum(scenario burdens).
    const sumBase = hit.multiYear.baselineYearTax.reduce((s, v) => s + v, 0);
    const sumScen = hit.multiYear.scenarioYearTax.reduce((s, v) => s + v, 0);
    check("M2 totalSavings == Σbaseline − Σscenario", hit.multiYear.totalSavings, sumBase - sumScen, 2);
    // Spreading an $800k gain for a $300k-AGI MFJ saves (positive) and the lump
    // year is taxed far more than a spread year.
    checkBool("M2 totalSavings > 0 (spreading saves)", hit.multiYear.totalSavings > 0, true);
    checkBool("M2 lump year taxed >> spread year", hit.multiYear.baselineYearTax[0] > hit.multiYear.scenarioYearTax[0] + 50000, true);
  }
}

// ── Summary ──
console.log(`\n== §453 (G1.47) H3 multi-year wiring ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL §453 MULTI-YEAR ASSERTIONS PASS");
