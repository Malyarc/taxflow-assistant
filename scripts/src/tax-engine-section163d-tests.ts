/**
 * §163(d) investment interest expense + §163(d)(4)(B) election — hand-calc'd (P2-15c).
 *
 * Pure engine; no API required. The engine now models the investment-interest
 * itemized deduction (Form 4952), capped at net investment income, with the
 * §163(d)(4)(B) election to treat QDIV/LTCG as ordinary investment income (raising
 * the cap + re-bucketing that amount to ordinary rates). Detector G1.93 is H2-wired.
 *
 * NII (§163(d)(4)) = ordinary investment income: interest + NON-qualified dividends
 * + net STCG + royalties (investment expenses treated as 0 — documented sub-gap).
 * The elected amount STAYS in the §1411 NIIT base (the election is a §163(d)
 * characterization, not §1411).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-section163d-tests.ts
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
  else FAIL.push(`X ${label}: expected ${expected}±${tol}, got ${actual}`);
}
function checkEq<T>(label: string, actual: T, expected: T): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

// Single TY2024, W-2 $300k, $30k mortgage interest (clearly itemizes), $10k interest
// income (= base NII), $40k QDIV + $60k LTCG (preferential $100k), $50k investment
// interest expense. State = FL (no state income tax) to isolate the federal math.
function mk(extra: AdjustmentFact[]): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [
      { taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 10000 },
      { taxYear: 2024, formType: "div", payerName: "Broker", ordinaryDividends: 40000, qualifiedDividends: 40000 },
    ],
    adjustments: [A("mortgage_interest", 30000), A("long_term_capital_gain", 60000), ...extra],
    taxYear: 2024,
  } as unknown as TaxReturnInputs;
}

// ── IIE-1 — §163(d)(1) deduction capped at base NII (no election) ──
// baseNII = $10k interest. allowed = min($50k, $10k) = $10k. disallowed = $40k.
// Itemized = $30k mortgage + $10k invInt = $40k. Preferential $100k unchanged.
header("IIE-1: §163(d)(1) deduction capped at NII (no election)");
{
  const r = computeTaxReturnPure(mk([A("investment_interest_expense", 50000)]));
  check("IIE-1 invInt deduction = $10k (= base NII)", r.investmentInterestDeduction, 10000);
  check("IIE-1 invInt disallowed = $40k (carryforward)", r.investmentInterestDisallowed, 40000);
  check("IIE-1 election amount = 0", r.investmentInterestElectionAmount, 0);
  check("IIE-1 preferential income = $100k (unchanged)", r.preferentialIncome, 100000);
  check("IIE-1 itemized = $30k mortgage + $10k invInt", r.itemizedDeductions ?? -1, 40000);
}

// ── IIE-2 — the §163(d)(4)(B) election frees the disallowed interest ──
// Elect $40k: NII = $10k + $40k = $50k → allowed = min($50k, $50k) = $50k, disallowed 0.
// Preferential = $100k − $40k = $60k. Itemized = $30k + $50k = $80k.
// Clean δ=E case (itemizes anyway) → election saves $40k × 15% preferential = $6,000.
header("IIE-2: §163(d)(4)(B) election frees disallowed interest");
{
  const noElect = computeTaxReturnPure(mk([A("investment_interest_expense", 50000)]));
  const elect = computeTaxReturnPure(mk([A("investment_interest_expense", 50000), A("investment_interest_election_amount", 40000)]));
  check("IIE-2 invInt deduction = $50k (all freed)", elect.investmentInterestDeduction, 50000);
  check("IIE-2 invInt disallowed = 0", elect.investmentInterestDisallowed, 0);
  check("IIE-2 election amount = $40k", elect.investmentInterestElectionAmount, 40000);
  check("IIE-2 preferential = $60k ($100k − $40k elected)", elect.preferentialIncome, 60000);
  check("IIE-2 itemized = $30k + $50k", elect.itemizedDeductions ?? -1, 80000);
  // Election saves the 15% preferential rate on the elected $40k (freed deduction
  // offsets it in ordinary income); both are under the $518,900 single LTCG breakpoint.
  const electionDelta = elect.federalRefundOrOwed - noElect.federalRefundOrOwed;
  check("IIE-2 election refund delta ≈ $6,000 ($40k × 15%)", electionDelta, 6000, 60);
  // The elected amount stays in the §1411 NIIT base → NIIT unchanged by the election.
  check("IIE-2 NIIT unchanged by election (elected stays in §1411 base)", elect.niitTax, noElect.niitTax, 1);
}

// ── IIE-3 — std-deduction client: §163(d) deduction is computed but UNUSED ──
// W-2 $300k, NO mortgage/other itemized, $10k interest, $5k invInt. allowed = $5k,
// but $5k itemized < $14,600 std → std taken → ZERO benefit (delta vs no invInt = 0).
header("IIE-3: investment interest wasted against the standard deduction");
{
  const stdBase = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 10000 }],
    adjustments: [] as AdjustmentFact[],
    taxYear: 2024,
  } as unknown as TaxReturnInputs;
  const noInvInt = computeTaxReturnPure(stdBase);
  const withInvInt = computeTaxReturnPure({ ...stdBase, adjustments: [A("investment_interest_expense", 5000)] } as TaxReturnInputs);
  check("IIE-3 invInt deduction computed = $5k (allowed)", withInvInt.investmentInterestDeduction, 5000);
  checkBool("IIE-3 std taken (itemized null) → invInt unused", withInvInt.itemizedDeductions == null, true);
  check("IIE-3 no tax benefit (refund delta = 0)", withInvInt.federalRefundOrOwed - noInvInt.federalRefundOrOwed, 0, 1);
}

// ── IIE-4 — election capped at available preferential income ──
// Elect $200k when only $100k preferential exists → engine caps at $100k.
header("IIE-4: election capped at available preferential");
{
  const r = computeTaxReturnPure(mk([A("investment_interest_expense", 200000), A("investment_interest_election_amount", 200000)]));
  check("IIE-4 election capped at $100k preferential", r.investmentInterestElectionAmount, 100000);
  check("IIE-4 preferential floored at 0", r.preferentialIncome, 0);
}

// ── IIE-5 — detector G1.93 engine-verified (with baselineInputs) ──
// Recommended election = min(preferential $100k, disallowed $40k) = $40k. The
// detector's what-if must match an independent elect-vs-no-elect engine run.
header("IIE-5: G1.93 engine-verified what-if + independent cross-check");
{
  const baselineInputs = mk([A("investment_interest_expense", 50000)]);
  const computed = computeTaxReturnPure(baselineInputs);
  const noElect = computed;
  const elect = computeTaxReturnPure(mk([A("investment_interest_expense", 50000), A("investment_interest_election_amount", 40000)]));
  const independentDelta = elect.federalRefundOrOwed - noElect.federalRefundOrOwed;

  const client = { filingStatus: "single" } as unknown as ClientFacts;
  const hits = evaluatePlanningOpportunities({
    client, computed, adjustments: baselineInputs.adjustments, baselineInputs,
  });
  const hit = hits.find((h) => h.strategyId === "G1.93") ?? null;
  checkBool("IIE-5 G1.93 fires", hit != null, true);
  if (hit) {
    check("IIE-5 recommendedElection = $40k (disallowed)", Number(hit.inputs?.recommendedElection ?? 0), 40000);
    checkBool("IIE-5 whatIf attached", hit.whatIf != null, true);
    if (hit.whatIf) {
      check("IIE-5 whatIf delta == independent engine run", hit.whatIf.delta.combinedRefundDelta, independentDelta, 1);
      check("IIE-5 whatIf delta ≈ $6,000", hit.whatIf.delta.combinedRefundDelta, 6000, 60);
    }
    annotateVerifiedSavings([hit]);
    checkEq("IIE-5 savingsSource engine-verified", hit.savingsSource, "engine-verified");
    check("IIE-5 verifiedSavings ≈ $6,000", hit.verifiedSavings ?? -1, 6000, 60);
  }
}

// ── Summary ──
console.log(`\n== §163(d) investment interest + election ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL §163(d) ASSERTIONS PASS");
