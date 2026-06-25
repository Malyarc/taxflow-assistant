/**
 * G1.30 ACA Premium Tax Credit (§36B) detector — engine-verified promotion (P2-14).
 *
 * Pure engine; no API required. Verifies the detector now reports the engine's
 * ACTUAL Form 8962 reconciliation (`computed.premiumTaxCredit`) when the client
 * has Marketplace coverage, while preserving the forward-looking SE-income
 * heuristic when no 1095-A data is present.
 *
 * Hand-calc'd PTC (TY2024, single, household 1; engine FPL_GUIDELINE_BY_PTC_YEAR
 * 2024 base = $14,580 [2023 HHS guidelines]; repayment caps Rev. Proc. 2023-34):
 *   MAGI $36,450 → fplFraction = 36,450 / 14,580 = 2.50 exactly.
 *   applicableFigure at 2.50 = 0.04 (band 2.50–3.00 starts at 0.04).
 *   expectedContribution = 36,450 × 0.04 = $1,458.
 *   SLCSP $8,000 → ptcUncapped = 8,000 − 1,458 = $6,542; computedPtc = min(premium, 6,542).
 *   Repayment cap (single, 2.0–3.0 band, TY2024) = $950.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-ptc-detector-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type AdjustmentFact,
  type ClientFacts,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  evaluatePlanningOpportunities,
  annotateVerifiedSavings,
} from "../../artifacts/api-server/src/lib/planningEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function checkEq<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

/** Build a single-filer TY2024 return + run the G1.30 detector. */
function runG130(args: {
  wages?: number;
  acaAnnualPremium?: number;
  acaAnnualSlcsp?: number;
  acaAdvanceAptc?: number;
  adjustments?: AdjustmentFact[];
}) {
  const adjustments = args.adjustments ?? [];
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single", state: "FL", taxYear: 2024,
      acaAnnualPremium: args.acaAnnualPremium ?? null,
      acaAnnualSlcsp: args.acaAnnualSlcsp ?? null,
      acaAdvanceAptc: args.acaAdvanceAptc ?? null,
      acaHouseholdSize: 1,
    },
    w2s: args.wages ? [{ taxYear: 2024, wagesBox1: args.wages, federalTaxWithheldBox2: 0, stateCode: "FL" }] : [],
    form1099s: [], adjustments, taxYear: 2024,
  } as unknown as TaxReturnInputs;
  const computed = computeTaxReturnPure(inputs);
  const client = { filingStatus: "single" } as unknown as ClientFacts;
  const hit = evaluatePlanningOpportunities({ client, computed, adjustments }).find((h) => h.strategyId === "G1.30") ?? null;
  return { computed, hit };
}

// ── PTC-A — clawback (capped): MAGI $36,450, SLCSP 8k, premium 7k, advance 9k.
//   computedPtc = min(7000, 6542) = 6542 · netPtc = 6542 − 9000 = −2458,
//   capped to −$950 (single, 2.0–3.0 band). |netPtc| = 950.
header("PTC-A: engine-verified clawback (capped at $950)");
{
  const { computed, hit } = runG130({ wages: 36450, acaAnnualPremium: 7000, acaAnnualSlcsp: 8000, acaAdvanceAptc: 9000 });
  const ptc = computed.premiumTaxCredit;
  check("PTC-A engine fplFraction", ptc.fplFraction, 2.5, 0.001);
  check("PTC-A engine applicableFigure", ptc.applicableFigure, 0.04, 0.0001);
  check("PTC-A engine expectedContribution", ptc.expectedContribution, 1458);
  check("PTC-A engine computedPtc", ptc.computedPtc, 6542);
  check("PTC-A engine netPtc (capped)", ptc.netPtc, -950);
  check("PTC-A engine repaymentCap", ptc.repaymentCap ?? -1, 950); // null = no-cap sentinel (T1.0d #14)
  checkBool("PTC-A G1.30 fires", hit != null, true);
  if (hit) {
    checkEq("PTC-A savingsSource", hit.savingsSource, "engine-verified");
    check("PTC-A verifiedSavings = |netPtc| = 950", hit.verifiedSavings ?? -1, 950);
    check("PTC-A estSavings (not $1k heuristic)", hit.estSavings, 950);
    check("PTC-A inputs.netPtc", Number(hit.inputs?.netPtc ?? 0), -950);
    check("PTC-A inputs.repaymentCap", Number(hit.inputs?.repaymentCap ?? 0), 950);
    annotateVerifiedSavings([hit]);
    checkEq("PTC-A engine-verified preserved post-annotate", hit.savingsSource, "engine-verified");
    check("PTC-A verifiedSavings preserved", hit.verifiedSavings ?? -1, 950);
  }
}

// ── PTC-B — additional PTC owed: MAGI $36,450, SLCSP 8k, premium 9k, advance 4k.
//   computedPtc = min(9000, 6542) = 6542 · netPtc = 6542 − 4000 = +2542 (no cap).
header("PTC-B: engine-verified additional PTC (netPtc > 0)");
{
  const { computed, hit } = runG130({ wages: 36450, acaAnnualPremium: 9000, acaAnnualSlcsp: 8000, acaAdvanceAptc: 4000 });
  check("PTC-B engine netPtc", computed.premiumTaxCredit.netPtc, 2542);
  checkBool("PTC-B G1.30 fires", hit != null, true);
  if (hit) {
    checkEq("PTC-B savingsSource", hit.savingsSource, "engine-verified");
    check("PTC-B verifiedSavings = netPtc = 2542", hit.verifiedSavings ?? -1, 2542);
    check("PTC-B estSavings", hit.estSavings, 2542);
    check("PTC-B inputs.netPtc", Number(hit.inputs?.netPtc ?? 0), 2542);
  }
}

// ── PTC-C — perfectly reconciled (advance = computedPtc): netPtc 0 → engine path
//   suppressed (|netPtc| < 1); no SE income → heuristic doesn't fire → no hit.
header("PTC-C: perfectly reconciled → no G1.30 hit");
{
  const { computed, hit } = runG130({ wages: 36450, acaAnnualPremium: 9000, acaAnnualSlcsp: 8000, acaAdvanceAptc: 6542 });
  check("PTC-C engine netPtc = 0", computed.premiumTaxCredit.netPtc, 0);
  checkBool("PTC-C no G1.30 hit (nothing to reconcile)", hit == null, true);
}

// ── PTC-D — heuristic FALLBACK preserved: SE $80k, NO Marketplace data.
//   Engine-verified path skipped (annualPremium 0) → SE-income heuristic fires
//   with the fixed $1,000 estimate, tagged `estimate` after annotate.
header("PTC-D: heuristic fallback preserved (SE income, no 1095-A)");
{
  const { computed, hit } = runG130({ adjustments: [A("self_employment_income", 80000)] });
  checkBool("PTC-D no Marketplace data on engine PTC", computed.premiumTaxCredit.annualPremium === 0, true);
  checkBool("PTC-D G1.30 heuristic fires", hit != null, true);
  if (hit) {
    check("PTC-D estSavings = $1,000 heuristic", hit.estSavings, 1000);
    annotateVerifiedSavings([hit]);
    checkEq("PTC-D savingsSource = estimate", hit.savingsSource, "estimate");
  }
}

// ── PTC-E — §36B optimizer: engine-verified IRA-contribution mitigation ──
// The PTC-A clawback scenario + baselineInputs → the optimizer what-if runs. A
// $7,000 deductible traditional IRA lowers MAGI (fplFraction 2.50 → ~2.02), raising
// the PTC + giving an income-tax deduction. The what-if delta must match an
// independent +$7k-IRA engine run, and (post-annotate) becomes the headline.
header("PTC-E: §36B optimizer (IRA-contribution what-if, baselineInputs)");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, acaAnnualPremium: 7000, acaAnnualSlcsp: 8000, acaAdvanceAptc: 9000, acaHouseholdSize: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 36450, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [], adjustments: [], taxYear: 2024,
  } as unknown as TaxReturnInputs;
  const computed = computeTaxReturnPure(inputs);
  const client = { filingStatus: "single" } as unknown as ClientFacts;
  const hit = evaluatePlanningOpportunities({ client, computed, adjustments: [], baselineInputs: inputs }).find((h) => h.strategyId === "G1.30") ?? null;

  // Independent: the same return + a $7,000 traditional IRA contribution.
  const withIra = computeTaxReturnPure({ ...inputs, adjustments: [A("ira_contribution_traditional", 7000)] } as TaxReturnInputs);
  const independentDelta = (withIra.federalRefundOrOwed + withIra.stateRefundOrOwed) - (computed.federalRefundOrOwed + computed.stateRefundOrOwed);

  checkBool("PTC-E G1.30 fires", hit != null, true);
  if (hit) {
    checkBool("PTC-E optimizer what-if attached", hit.whatIf != null, true);
    if (hit.whatIf) {
      check("PTC-E what-if delta == independent +$7k-IRA run", hit.whatIf.delta.combinedRefundDelta, independentDelta, 1);
      checkBool("PTC-E optimizer benefit > 0", hit.whatIf.delta.combinedRefundDelta > 0, true);
    }
    annotateVerifiedSavings([hit]);
    checkEq("PTC-E savingsSource engine-verified", hit.savingsSource, "engine-verified");
    check("PTC-E verifiedSavings = |optimizer delta|", hit.verifiedSavings ?? -1, Math.round(Math.abs(independentDelta)), 1);
  }
}

// ── Summary ──
console.log(`\n== ACA PTC G1.30 detector ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL PTC DETECTOR ASSERTIONS PASS");
