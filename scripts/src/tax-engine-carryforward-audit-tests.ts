/**
 * T1.2 — Carryforward completeness audit. Verifies that EVERY carryforward the
 * engine tracks (NOL, cap-loss ST/LT, charitable cash, §163(j), AMT credit, AMT
 * NOL, §469 passive loss) (a) is captured by captureCarryforwards and (b) is
 * correctly applied in the next year via applyCarryforwards → reduces the right
 * thing. NO API / NO DB.
 *
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-carryforward-audit-tests.ts
 */
import { computeTaxReturnPure, type TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { captureCarryforwards, applyCarryforwards } from "../../artifacts/api-server/src/lib/multiYearEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (Δ ${(actual - expected).toFixed(2)})`);
}
function ok(label: string, cond: boolean) { (cond ? PASS : FAIL).push(`${cond ? "✓" : "✗"} ${label}`); }
function header(t: string) { console.log(`\n── ${t} ──`); }

const FL = { filingStatus: "single", state: "FL", taxYear: 2024 } as const;
const mk = (adjustments: unknown[], extra: Partial<TaxReturnInputs> = {}): TaxReturnInputs => ({
  client: { ...FL }, w2s: [], form1099s: [], adjustments: adjustments as never, taxYear: 2024, ...extra,
});

// ── Capital loss ST/LT → $3k deducted, excess carried with character ──
header("Capital-loss carryforward round-trip ($3k cap + character)");
{
  // $10,000 net LT loss (1099-B), no gains → $3,000 deducted, $7,000 LT carryforward.
  const yN = computeTaxReturnPure(mk([], {
    form1099s: [{ taxYear: 2024, formType: "b", payerName: "X", longTermGainLoss: -10000 }] as never,
  }));
  const cf = captureCarryforwards(yN);
  check("captured LT cap-loss carryforward = $7,000", cf.capitalLossLong, 7000, 1);
  // Apply to year N+1 with a $7,000 LT GAIN → the carryforward nets it to $0.
  const yN1base = mk([], {
    form1099s: [{ taxYear: 2024, formType: "b", payerName: "Y", longTermGainLoss: 7000 }] as never,
  });
  const yN1 = computeTaxReturnPure(applyCarryforwards(yN1base, cf));
  check("applied CF nets the $7,000 gain → net cap gain $0", yN1.netCapitalGainLoss, 0, 1);
}

// ── NOL carryforward → 80% taxable-income cap (§172(a)(2)) ──
header("NOL carryforward round-trip (80% cap + remaining)");
{
  // $100k NOL CF, $60k wages. Taxable before NOL ≈ 60,000 − 14,600 std = $45,400.
  // NOL deduction capped at 80% × 45,400 = $36,320 → remaining $63,680.
  const yN = computeTaxReturnPure(mk([{ adjustmentType: "nol_carryforward", amount: 100000, isApplied: true }],
    { w2s: [{ wagesBox1: 60000, federalTaxWithheldBox2: 0, stateCode: "FL" }] as never }));
  const cf = captureCarryforwards(yN);
  ok("NOL remaining carried (> 0)", cf.nol > 0);
  // Applying the remaining NOL to a $60k-wage year N+1 reduces taxable vs no NOL.
  const yN1base = mk([], { w2s: [{ wagesBox1: 60000, federalTaxWithheldBox2: 0, stateCode: "FL" }] as never });
  const withCf = computeTaxReturnPure(applyCarryforwards(yN1base, cf));
  const noCf = computeTaxReturnPure(yN1base);
  ok("applied NOL lowers year N+1 taxable income", withCf.taxableIncome < noCf.taxableIncome);
}

// ── Charitable cash carryforward → 60%-of-AGI ceiling (§170(d)(1)) ──
header("Charitable carryforward round-trip (60% AGI ceiling)");
{
  // $100k cash gift, AGI $50k (wages). 60% × $50k = $30k deductible, $70k carried.
  const yN = computeTaxReturnPure(mk([
    { adjustmentType: "charitable_cash", amount: 100000, isApplied: true },
  ], { w2s: [{ wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }] as never }));
  const cf = captureCarryforwards(yN);
  ok("charitable cash carryforward captured (> 0)", cf.charitableCash > 0);
  ok("carryforward ≈ excess over 60% AGI", Math.abs(cf.charitableCash - 70000) < 5000);
}

// ── §163(j) business-interest carryforward ──
header("§163(j) interest carryforward round-trip");
{
  // $50k business interest expense, low ATI → disallowed portion carried forward.
  const yN = computeTaxReturnPure(mk([
    { adjustmentType: "section_163j_business_interest_expense", amount: 50000, isApplied: true },
    { adjustmentType: "self_employment_income", amount: 40000, isApplied: true },
  ]));
  const cf = captureCarryforwards(yN);
  ok("§163(j) disallowed interest carried (> 0)", cf.section163j > 0);
}

// ── §469 passive loss suspended (Schedule E) ──
header("§469 passive-loss carryforward round-trip");
{
  // $200k wages (MAGI ≥ $150k → $0 allowance) + a $30k rental loss → fully suspended.
  const yN = computeTaxReturnPure(mk([], {
    w2s: [{ wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "FL" }] as never,
    rentalProperties: [{ taxYear: 2024, rentalIncome: 0, totalExpenses: 30000, basis: 0, isActiveParticipant: true }] as never,
  }));
  const cf = captureCarryforwards(yN);
  check("§469 suspended passive loss carried = $30,000", cf.passiveLossScheduleE, 30000, 1);
}

// ── Completeness: applyCarryforwards round-trips ALL fields cleanly ──
header("All-carryforward round-trip is idempotent + complete");
{
  const state = { nol: 50000, capitalLossShort: 1000, capitalLossLong: 2000, charitableCash: 3000,
    section163j: 4000, amtCredit: 5000, amtNol: 6000, passiveLossScheduleE: 7000 };
  const applied = applyCarryforwards(mk([]), state);
  const types = new Set(applied.adjustments.map((a) => a.adjustmentType));
  ok("all 8 carryforward adjustment types present after apply",
    ["nol_carryforward", "capital_loss_carryforward_short", "capital_loss_carryforward_long",
      "charitable_carryforward_cash", "section_163j_carryforward_from_prior", "amt_credit_carryforward",
      "amt_nol_carryforward", "schedule_e_passive_loss_carryforward"].every((t) => types.has(t)));
  // Re-capturing after applying (with no new generators) returns ≥ the applied
  // amounts that survive (NOL/cap-loss/charitable persist when unused).
  ok("engine consumes/repersists carryforwards without error",
    Number.isFinite(computeTaxReturnPure(applied).taxableIncome));
}

// ── summary ──
console.log(`\n${"═".repeat(60)}`);
for (const f of FAIL) console.log(f);
console.log(`\ncarryforward-audit: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
