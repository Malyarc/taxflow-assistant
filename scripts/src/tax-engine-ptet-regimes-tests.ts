/**
 * G1.2 — STATE_PTET_REGIMES table + rate-aware PTET valuation tests.
 *
 * Covers the 2026-06-06g change that replaced the flat PTET_ELECTING_STATES set
 * with a per-state STATE_PTET_REGIMES table (state -> { hasPtet, topPtetRate,
 * notes }) and made detectPtetElection value the SALT-cap workaround at the
 * state's REAL PTET rate:
 *
 *   ptetPayable    = active K-1 income × state PTET rate
 *   recoverableSalt = min(stranded SALT, ptetPayable)   ← rate now bounds recovery
 *   estSavings     = recoverableSalt × federal marginal rate
 *
 * Discipline (same as the rest of the engine): every expected value is
 * hand-calc'd against the rule (here, pure arithmetic on the published state
 * rate) before asserting, with the trace left as a comment.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-ptet-regimes-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  evaluatePlanningOpportunities,
  STATE_PTET_REGIMES,
} from "../../artifacts/api-server/src/lib/planningEngine";
import type { OpportunityHit } from "@workspace/planning-strategies";

const PASS: string[] = [];
const FAIL: Array<{ rule: string; label: string; expected: number | string; actual: number | string; delta?: number; cite?: string }> = [];

function check(rule: string, label: string, actual: number, expected: number, tol = 1, cite = ""): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected, actual, delta: Math.round((actual - expected) * 100) / 100, cite });
}
function checkTruthy(rule: string, label: string, actual: boolean, expected: boolean, cite = ""): void {
  if (actual === expected) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected: String(expected), actual: String(actual), cite });
}
function header(t: string): void { console.log(`\n-- ${t} --`); }
function section(t: string): void { console.log(`\n========== ${t} ==========`); }

function runPlanning(inputs: Partial<TaxReturnInputs> & { client: TaxReturnInputs["client"] }): OpportunityHit[] {
  const computed = computeTaxReturnPure({
    w2s: [], form1099s: [], adjustments: [],
    taxYear: inputs.client.taxYear ?? 2024,
    ...inputs,
  });
  return evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments ?? [],
  });
}
function findHit(hits: OpportunityHit[], id: string): OpportunityHit | undefined {
  return hits.find((h) => h.strategyId === id);
}

// ============================================================================
// Part 1 — STATE_PTET_REGIMES table integrity
// ============================================================================
section("STATE_PTET_REGIMES table integrity");

// All 50 states + DC are listed (self-documenting; the yearly freshness review
// is a scan of this one table).
const ALL_JURISDICTIONS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];
header("Every jurisdiction present; counts correct");
check("TBL", "51 jurisdictions listed (50 states + DC)", Object.keys(STATE_PTET_REGIMES).length, 51, 0);
{
  const missing = ALL_JURISDICTIONS.filter((s) => !(s in STATE_PTET_REGIMES));
  checkTruthy("TBL", `no jurisdiction missing (missing: ${missing.join(",") || "none"})`, missing.length === 0, true);
}

// The 36 states with an enacted elective PTET (AICPA tracker, verified 2026-06).
const EXPECTED_PTET_STATES = [
  "AL","AZ","AR","CA","CO","CT","GA","HI","ID","IL","IN","IA","KS","KY","LA",
  "MD","MA","MI","MN","MS","MO","MT","NE","NJ","NM","NY","NC","OH","OK","OR",
  "RI","SC","UT","VA","WV","WI",
];
header("36 PTET states; the rest have no PTET");
{
  const ptetTrue = Object.entries(STATE_PTET_REGIMES).filter(([, r]) => r.hasPtet).map(([s]) => s).sort();
  check("TBL", "exactly 36 states have hasPtet=true", ptetTrue.length, 36, 0);
  checkTruthy("TBL", "the hasPtet set equals the verified PTET list",
    ptetTrue.join(",") === [...EXPECTED_PTET_STATES].sort().join(","), true);
}

// Invariants: every PTET state has a sane positive rate; every non-PTET state
// has rate 0. (Top U.S. individual-rate ceiling ≈ 13.3% CA → 0.15 sanity bound.)
header("rate invariants (PTET rate in (0, 0.15]; non-PTET rate = 0)");
{
  let badPtet = 0, badNon = 0;
  for (const [, r] of Object.entries(STATE_PTET_REGIMES)) {
    if (r.hasPtet) { if (!(r.topPtetRate > 0 && r.topPtetRate <= 0.15)) badPtet++; }
    else { if (r.topPtetRate !== 0) badNon++; }
  }
  check("TBL", "all PTET states have 0 < rate <= 0.15", badPtet, 0, 0);
  check("TBL", "all non-PTET states have rate = 0", badNon, 0, 0);
}

// Spot-check the economically-significant rates against statute/DOR (these are
// the states where the detector actually fires post-OBBBA).
header("spot-check verified rates");
const SPOT: Array<[string, number, string]> = [
  ["CA", 0.093, "R&TC §19900 — flat 9.3% (NOT the 13.3% top)"],
  ["NY", 0.109, "Tax Law Art. 24-A — graduated, top 10.9%"],
  ["NJ", 0.109, "N.J.S.A. 54A:12 BAIT — top 10.9%"],
  ["MN", 0.0985, "Minn. Stat. §289A.08 — top 9.85%"],
  ["OR", 0.099, "ORS 314.778 — top 9.9%"],
  ["HI", 0.11, "Act 50 (2023) — top 11%"],
  ["CT", 0.0699, "Conn. Gen. Stat. §12-699 — 6.99%"],
  ["WI", 0.079, "Wis. Stat. §71.21(6) — 7.9% entity rate"],
  ["IL", 0.0495, "35 ILCS 5/201(p) — 4.95%"],
  ["MA", 0.05, "Ch. 63D — 5% (surtax not at entity)"],
  ["VA", 0.0575, "Va. Code §58.1-390.3 — 5.75%"],
  ["AZ", 0.025, "A.R.S. §43-1014 — flat 2.5% TY2023+ (was 4.5%)"],
  ["OH", 0.03, "R.C. §5747.38 — 3% TY2023+ (was 5%)"],
  ["CO", 0.044, "SALT Parity Act — 4.40% TY2024"],
];
for (const [s, rate, cite] of SPOT) {
  check("TBL", `${s} topPtetRate = ${rate}`, STATE_PTET_REGIMES[s].topPtetRate, rate, 1e-9, cite);
}

// Non-PTET jurisdictions explicitly false (income-tax states without a PTET +
// no-income-tax states).
header("non-PTET jurisdictions are explicitly hasPtet=false");
for (const s of ["PA", "DE", "ND", "VT", "ME", "DC", "TX", "FL", "WA", "NH", "TN"]) {
  checkTruthy("TBL", `${s} hasPtet = false`, STATE_PTET_REGIMES[s].hasPtet, false);
}

// ============================================================================
// Part 2 — Rate-aware valuation: the PTET rate BOUNDS recovery
// ============================================================================
section("Rate-aware PTET valuation");

// --- PTET-rate-1 — CA rate BINDS (low flat 9.3% caps recovery below stranded) ---
// MFJ CA TY2024, K-1 active S-corp Box 1 = $300k, SALT uncapped = state_income
// $60k + property $20k = $80k → TCJA cap $10k. No mortgage → std ded chosen.
// Hand-calc:
//   strandedSalt = $80,000 − $10,000 = $70,000.
//   ptetPayable  = $300,000 × 9.3% (CA flat PTET) = $27,900.
//   recoverable  = min($70,000, $27,900) = $27,900  ← CA's 9.3% rate binds.
//   fedRate: AGI $300k; std ded MFJ 2024 $29,200 (> $10k SALT itemized);
//     pre-QBI taxable $270,800; QBI = min(20%×$300k=$60k, 20%×$270,800=$54,160)
//     = $54,160 (no wage limit — K-1 supplies no W-2 wages/UBIA); post-QBI
//     taxable $216,640 → MFJ 24% bracket ($201,050-$383,900) → 0.24.
//   estSavings = $27,900 × 0.24 = $6,696.
header("PTET-rate-1 — CA 9.3% binds: recover $27,900 (not $70k stranded) @ 24% = $6,696");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "CA S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 300000,
    }] as unknown as TaxReturnInputs["scheduleK1"],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 60000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 20000, isApplied: true },
    ] as unknown as TaxReturnInputs["adjustments"],
  });
  const hit = findHit(hits, "G1.2");
  checkTruthy("PTET-rate-1", "G1.2 fires (CA has PTET)", hit != null, true);
  if (hit) {
    check("PTET-rate-1", "statePtetRate = 0.093", Number(hit.inputs.statePtetRate), 0.093, 1e-9);
    check("PTET-rate-1", "strandedSalt = $70,000", Number(hit.inputs.strandedSalt), 70000, 1);
    check("PTET-rate-1", "ptetPayable = $27,900 ($300k × 9.3%)", Number(hit.inputs.ptetPayable), 27900, 1);
    check("PTET-rate-1", "recoverableSalt = $27,900 (rate binds, < $70k stranded)", Number(hit.inputs.recoverableSalt), 27900, 1);
    check("PTET-rate-1", "federalMarginalRate = 0.24", Number(hit.inputs.federalMarginalRate), 0.24, 0.001);
    check("PTET-rate-1", "estSavings = $6,696", hit.estSavings, 6696, 2, "$27,900 × 24%");
    // self-consistency: estSavings == round(recoverable × marginal)
    check("PTET-rate-1", "estSavings self-consistent",
      hit.estSavings, Math.round(Number(hit.inputs.recoverableSalt) * Number(hit.inputs.federalMarginalRate)), 1);
  }
}

// --- PTET-rate-2 — NY rate does NOT bind (high 10.9% → stranded binds) ---
// Single NY TY2024, K-1 active $400k, SALT uncapped = income $30k + property
// $10k = $40k → cap $10k. No mortgage.
// Hand-calc:
//   strandedSalt = $40,000 − $10,000 = $30,000.
//   ptetPayable  = $400,000 × 10.9% (NY top) = $43,600.
//   recoverable  = min($30,000, $43,600) = $30,000  ← stranded binds (rate high).
//   estSavings   = $30,000 × federal marginal rate.
// (Marginal asserted via self-consistency — independent of the bracket math.)
header("PTET-rate-2 — NY 10.9% does NOT bind: recover full $30k stranded");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "NY", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "NY S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 400000,
    }] as unknown as TaxReturnInputs["scheduleK1"],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 30000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 10000, isApplied: true },
    ] as unknown as TaxReturnInputs["adjustments"],
  });
  const hit = findHit(hits, "G1.2");
  checkTruthy("PTET-rate-2", "G1.2 fires (NY has PTET)", hit != null, true);
  if (hit) {
    check("PTET-rate-2", "statePtetRate = 0.109", Number(hit.inputs.statePtetRate), 0.109, 1e-9);
    check("PTET-rate-2", "strandedSalt = $30,000", Number(hit.inputs.strandedSalt), 30000, 1);
    check("PTET-rate-2", "ptetPayable = $43,600 ($400k × 10.9%)", Number(hit.inputs.ptetPayable), 43600, 1);
    check("PTET-rate-2", "recoverableSalt = $30,000 (stranded binds)", Number(hit.inputs.recoverableSalt), 30000, 1);
    check("PTET-rate-2", "estSavings self-consistent (recoverable × marginal)",
      hit.estSavings, Math.round(Number(hit.inputs.recoverableSalt) * Number(hit.inputs.federalMarginalRate)), 1);
  }
}

// ============================================================================
// Part 3 — Suppression for non-PTET states (the hasPtet gate)
// ============================================================================
section("Non-PTET states suppress G1.2");

// --- PTET-supp-1 — PA (income tax, NO PTET) suppresses even with stranded SALT ---
// PA has a 3.07% flat income tax but has NOT enacted a SALT-cap PTET — a prime
// gotcha. K-1 active $400k + $50k SALT (stranded $40k) must still suppress.
header("PTET-supp-1 — PA (income tax, no PTET regime) suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "PA", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "PA S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 400000,
    }] as unknown as TaxReturnInputs["scheduleK1"],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 30000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 20000, isApplied: true },
    ] as unknown as TaxReturnInputs["adjustments"],
  });
  checkTruthy("PTET-supp-1", "no G1.2 for PA (no PTET regime)", findHit(hits, "G1.2") == null, true);
}

// --- PTET-supp-2 — DE (income tax, no PTET) suppresses ---
header("PTET-supp-2 — DE (income tax, no PTET) suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "DE", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "DE S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 300000,
    }] as unknown as TaxReturnInputs["scheduleK1"],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 25000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 10000, isApplied: true },
    ] as unknown as TaxReturnInputs["adjustments"],
  });
  checkTruthy("PTET-supp-2", "no G1.2 for DE (no PTET regime)", findHit(hits, "G1.2") == null, true);
}

// --- PTET-supp-3 — TX (no income tax at all) suppresses ---
header("PTET-supp-3 — TX (no income tax) suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "TX", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "TX S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 400000,
    }] as unknown as TaxReturnInputs["scheduleK1"],
    adjustments: [
      { adjustmentType: "state_property_tax", amount: 40000, isApplied: true },
    ] as unknown as TaxReturnInputs["adjustments"],
  });
  checkTruthy("PTET-supp-3", "no G1.2 for TX (no income tax → no PTET)", findHit(hits, "G1.2") == null, true);
}

// ============================================================================
// RESULTS
// ============================================================================
console.log(`\nPASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  [${f.rule}] ${f.label}`);
    console.log(`      expected=${f.expected}  actual=${f.actual}  delta=${f.delta ?? ""}`);
    if (f.cite) console.log(`      cite: ${f.cite}`);
  }
  process.exit(1);
}
console.log("\nALL PTET-REGIME ASSERTIONS PASS");
