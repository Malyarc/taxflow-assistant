/**
 * §1244 ordinary-loss detector (G1.40) — H2 engine-verified wiring (P2-15 / PLAN-Q2).
 *
 * Pure engine; no API required. The §1244 election recharacterizes a capital
 * loss (which releases only $3k/yr against ordinary income) into an ORDINARY
 * loss deductible in full this year. The detector now attaches an engine-verified
 * what-if measuring the CURRENT-YEAR refund delta of that election; the engine
 * captures the real bracket/NOL limits the fixed 17% rate-spread heuristic can't.
 *
 * Hand-calc (TY2024, single, $150k W-2, $40k LT capital-loss carryforward):
 *   Baseline: $40k cap loss → $3k offsets ordinary → AGI $147,000 → taxable
 *     $132,400 (− $14,600 std). Tax: 1,160 + 4,266 + 11,742.50 + 31,875×24% =
 *     $24,818.50.
 *   Scenario (§1244): cap loss → $0, + $40k ordinary deduction → AGI $110,000 →
 *     taxable $95,400. Tax: 1,160 + 4,266 + 48,250×22% = $16,041.
 *   Current-year delta = 24,818.50 − 16,041 = $8,777.50.
 *   Heuristic estSavings stays $40,000 × 0.17 = $6,800 (lifetime rate-spread).
 *
 * The detector's what-if is also cross-checked against an INDEPENDENT engine run
 * of the same mutations — proving the wiring, not just a number.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-section1244-whatif-tests.ts
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
function checkRange(label: string, actual: number, lo: number, hi: number): void {
  if (actual >= lo && actual <= hi) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected [${lo}, ${hi}], got ${actual}`);
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

const CLIENT = { filingStatus: "single", state: "FL", taxYear: 2024 };
const clientFacts = { filingStatus: "single" } as unknown as ClientFacts;

function mk(adjustments: AdjustmentFact[]): TaxReturnInputs {
  return {
    client: CLIENT,
    w2s: [{ taxYear: 2024, wagesBox1: 150000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [], adjustments, taxYear: 2024,
  } as unknown as TaxReturnInputs;
}

// ── W1 — engine-verified §1244 what-if (with baselineInputs) ──
header("W1: §1244 what-if delta = engine current-year benefit");
{
  const baselineAdj = [A("capital_loss_carryforward_long", 40000)];
  const baseline = mk(baselineAdj);
  const baselineComputed = computeTaxReturnPure(baseline);

  // Independent engine run of the SAME mutations the detector applies:
  //   cap_loss_long → 0, + $40k ordinary `deduction`.
  const scenario = mk([A("capital_loss_carryforward_long", 0), A("deduction", 40000)]);
  const scenarioComputed = computeTaxReturnPure(scenario);
  const independentDelta =
    (scenarioComputed.federalRefundOrOwed + scenarioComputed.stateRefundOrOwed) -
    (baselineComputed.federalRefundOrOwed + baselineComputed.stateRefundOrOwed);

  // Sanity: independent delta matches the hand-calc ($8,777.50).
  checkRange("W1 independent engine delta ≈ $8,777.50", independentDelta, 8700, 8850);

  const hits = evaluatePlanningOpportunities({
    client: clientFacts, computed: baselineComputed, adjustments: baselineAdj, baselineInputs: baseline,
  });
  const hit = hits.find((h) => h.strategyId === "G1.40") ?? null;
  checkBool("W1 G1.40 fires", hit != null, true);
  if (hit) {
    check("W1 estSavings = heuristic $6,800 (0.17 spread preserved)", hit.estSavings, 6800);
    checkBool("W1 whatIf attached", hit.whatIf != null, true);
    if (hit.whatIf) {
      checkEq("W1 whatIf semantics", hit.whatIf.semantics, "savings");
      // The detector's what-if must equal the independent engine run (proves wiring).
      check("W1 whatIf delta == independent engine delta", hit.whatIf.delta.combinedRefundDelta, independentDelta, 1);
      checkRange("W1 whatIf delta ≈ $8,777.50", hit.whatIf.delta.combinedRefundDelta, 8700, 8850);
    }
    annotateVerifiedSavings([hit]);
    checkEq("W1 savingsSource engine-verified", hit.savingsSource, "engine-verified");
    check("W1 verifiedSavings = |delta|", hit.verifiedSavings ?? -1, Math.round(Math.abs(independentDelta)), 1);
  }
}

// ── W2 — no baselineInputs → heuristic only (whatIf undefined, estimate) ──
header("W2: no baselineInputs → heuristic fallback (no what-if)");
{
  const adj = [A("capital_loss_carryforward_long", 40000)];
  const computed = computeTaxReturnPure(mk(adj));
  const hits = evaluatePlanningOpportunities({ client: clientFacts, computed, adjustments: adj });
  const hit = hits.find((h) => h.strategyId === "G1.40") ?? null;
  checkBool("W2 G1.40 fires", hit != null, true);
  if (hit) {
    check("W2 estSavings = heuristic $6,800", hit.estSavings, 6800);
    checkBool("W2 whatIf undefined (no baseline)", hit.whatIf == null, true);
    annotateVerifiedSavings([hit]);
    checkEq("W2 savingsSource estimate", hit.savingsSource, "estimate");
  }
}

// ── W3 — MFJ cap $100k: recharacterizable capped at the loss when < cap ──
// MFJ $250k W-2 + $90k LT cap-loss CF: recharacterizable = min(90k, 100k) = 90k.
//   heuristic estSavings = 90,000 × 0.17 = $15,300. what-if = full-$90k ordinary
//   deduction vs $3k cap offset → engine delta (cross-checked independently).
header("W3: MFJ $90k loss < $100k cap — full recharacterization");
{
  const mkMfj = (adjustments: AdjustmentFact[]): TaxReturnInputs => ({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [], adjustments, taxYear: 2024,
  } as unknown as TaxReturnInputs);
  const baselineAdj = [A("capital_loss_carryforward_long", 90000)];
  const baseline = mkMfj(baselineAdj);
  const baselineComputed = computeTaxReturnPure(baseline);
  const scenarioComputed = computeTaxReturnPure(mkMfj([A("capital_loss_carryforward_long", 0), A("deduction", 90000)]));
  const independentDelta =
    (scenarioComputed.federalRefundOrOwed + scenarioComputed.stateRefundOrOwed) -
    (baselineComputed.federalRefundOrOwed + baselineComputed.stateRefundOrOwed);
  const clientMfj = { filingStatus: "married_filing_jointly" } as unknown as ClientFacts;
  const hits = evaluatePlanningOpportunities({
    client: clientMfj, computed: baselineComputed, adjustments: baselineAdj, baselineInputs: baseline,
  });
  const hit = hits.find((h) => h.strategyId === "G1.40") ?? null;
  checkBool("W3 G1.40 fires", hit != null, true);
  if (hit) {
    check("W3 estSavings = $15,300 (90k × 0.17)", hit.estSavings, 15300);
    check("W3 inputs.ordinaryCap = $100k (MFJ)", Number(hit.inputs?.ordinaryCap ?? 0), 100000);
    checkBool("W3 whatIf attached", hit.whatIf != null, true);
    if (hit.whatIf) {
      check("W3 whatIf delta == independent engine delta", hit.whatIf.delta.combinedRefundDelta, independentDelta, 1);
      checkBool("W3 whatIf delta positive (a saving)", hit.whatIf.delta.combinedRefundDelta > 0, true);
    }
  }
}

// ── Summary ──
console.log(`\n== §1244 (G1.40) H2 wiring ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL §1244 H2-WIRING ASSERTIONS PASS");
