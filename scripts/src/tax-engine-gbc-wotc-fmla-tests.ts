/**
 * §51 WOTC + §45S FMLA general business credits — hand-calc'd tests (P2).
 *
 * Pure engine; no API required. Both are CPA-supplied general-business-credit
 * amounts (Form 5884 / Form 8994 — they need employee/wage data the individual
 * engine doesn't model). The engine applies them through the SAME §38(c) limit as
 * §41, against the REMAINING GBC room after §41, and carries the excess (§39).
 *
 * W4-W6 (2026-06-06g) cover the §39 carryforward roll-forward parity with §41/
 * §163(d): the §38-disallowed §51/§45S excess persists
 * (tax_returns.other_general_business_credit_carryforward_remaining) and the
 * pipeline re-seeds it as a `general_business_credit_carryforward` adjustment
 * that the engine adds to next year's §51/§45S credits BEFORE the §38(c) limit.
 * Tested at the engine level by feeding year-N's carryforward output as year-N+1's
 * input (the persist→seed mirror is a 1-line mechanical copy of the §41 path).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-gbc-wotc-fmla-tests.ts
 */
import { computeTaxReturnPure, type TaxReturnInputs, type AdjustmentFact } from "../../artifacts/api-server/src/lib/taxReturnEngine";

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
function header(t: string) { console.log(`\n-- ${t} --`); }
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

// SE filer net $300k, FL. Income tax is high enough that a modest GBC isn't §38-
// limited, but the §41 $47,400 case showed the §38 limit (regular − TMT) ≈ $12,973.
function mk(adj: AdjustmentFact[]): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [A("self_employment_income", 300000), ...adj],
    taxYear: 2024,
  } as unknown as TaxReturnInputs;
}

// ── W1: WOTC alone, under the §38 limit → fully applied ──
header("W1: §51 WOTC $5,000 applied");
{
  const noGbc = computeTaxReturnPure(mk([]));
  const r = computeTaxReturnPure(mk([A("wotc_credit", 5000)]));
  check("W1 otherGBC applied $5,000", r.otherGeneralBusinessCreditApplied, 5000);
  check("W1 carryforward 0", r.otherGeneralBusinessCreditCarryforward, 0);
  check("W1 refund delta = $5,000", r.federalRefundOrOwed - noGbc.federalRefundOrOwed, 5000);
}

// ── W2: WOTC + FMLA aggregate, under the §38 limit ──
header("W2: §51 $5,000 + §45S $3,000 = $8,000 applied");
{
  const noGbc = computeTaxReturnPure(mk([]));
  const r = computeTaxReturnPure(mk([A("wotc_credit", 5000), A("fmla_credit", 3000)]));
  check("W2 otherGBC applied $8,000", r.otherGeneralBusinessCreditApplied, 8000);
  check("W2 refund delta = $8,000", r.federalRefundOrOwed - noGbc.federalRefundOrOwed, 8000);
}

// ── W3: §41 takes the §38 room first; §51/§45S get the remainder + carry forward ──
// §41 ASC $8,848 applied first; WOTC $5,000 against the remaining §38 room → part
// applied, the rest carries forward (§39). Conservation: applied + cf = $5,000.
header("W3: §38 ordering — §41 first, then WOTC against the remainder");
{
  const r = computeTaxReturnPure(mk([
    A("qualified_research_expenses", 100000), A("qualified_research_expenses_prior_avg", 40000),
    A("wotc_credit", 5000),
  ]));
  check("W3 §41 applied $8,848 (priority)", r.rdCreditApplied, 8848);
  checkBool("W3 §38 limit binds WOTC (applied < $5,000)", r.otherGeneralBusinessCreditApplied < 5000, true);
  checkBool("W3 WOTC partially applied (> 0)", r.otherGeneralBusinessCreditApplied > 0, true);
  check("W3 conservation: applied + carryforward = $5,000",
    r.otherGeneralBusinessCreditApplied + r.otherGeneralBusinessCreditCarryforward, 5000, 1);
}

// ── W4: §39 carryforward-IN under the limit is applied like a current credit ──
// A prior-year §38-disallowed §51/§45S credit, re-seeded as
// `general_business_credit_carryforward`, is added to otherGbcAvailable before
// the §38 limit. $4,000 < §38 limit → fully applied (cf. W1's $5,000).
header("W4: §39 carryforward-in $4,000 applied (under §38 limit)");
{
  const noGbc = computeTaxReturnPure(mk([]));
  const r = computeTaxReturnPure(mk([A("general_business_credit_carryforward", 4000)]));
  check("W4 carryforward-in applied $4,000", r.otherGeneralBusinessCreditApplied, 4000);
  check("W4 nothing re-carried", r.otherGeneralBusinessCreditCarryforward, 0);
  check("W4 refund delta = $4,000", r.federalRefundOrOwed - noGbc.federalRefundOrOwed, 4000);
}

// ── W5: carryforward-in aggregates with current §51/§45S (under the limit) ──
// $3,000 prior carryforward + $5,000 current WOTC = $8,000, all under the limit.
header("W5: §39 carryforward $3,000 + current WOTC $5,000 = $8,000 applied");
{
  const r = computeTaxReturnPure(mk([
    A("general_business_credit_carryforward", 3000),
    A("wotc_credit", 5000),
  ]));
  check("W5 aggregate applied $8,000", r.otherGeneralBusinessCreditApplied, 8000);
  check("W5 nothing re-carried", r.otherGeneralBusinessCreditCarryforward, 0);
}

// ── W6: full year-N → year-N+1 roll-forward with §39 re-carry ──
// The §38(c) limit is shared by §41 and §51/§45S. Measure it via the §41 path
// (a huge §41 credit is applied exactly up to the limit — independently hand-
// calc'd in tax-engine-section41-rd-tests.ts).
header("W6: year-N disallows excess → persists → year-N+1 applies the carryforward");
{
  const measuredLimit = computeTaxReturnPure(mk([
    A("qualified_research_expenses", 500000),
    A("qualified_research_expenses_prior_avg", 0),
  ])).rdCreditApplied;
  checkBool("W6 §38(c) limit measured > 0", measuredLimit > 0, true);

  // Year N: WOTC = limit + $9,000 → applied = limit exactly, $9,000 disallowed →
  // carried forward (§39). (No §41 this year, so §51/§45S get the full limit.)
  const yearN = computeTaxReturnPure(mk([A("wotc_credit", measuredLimit + 9000)]));
  check("W6 year-N applied = §38(c) limit", yearN.otherGeneralBusinessCreditApplied, measuredLimit);
  check("W6 year-N carryforward = $9,000 (the §38-disallowed excess)", yearN.otherGeneralBusinessCreditCarryforward, 9000);

  // Year N+1: the pipeline persists yearN's carryforward and re-seeds it as a
  // `general_business_credit_carryforward` adjustment. Simulate that with NO new
  // credit → the rolled-forward amount is applied (min of the amount and limit).
  const rolled = yearN.otherGeneralBusinessCreditCarryforward;
  const yearN1 = computeTaxReturnPure(mk([A("general_business_credit_carryforward", rolled)]));
  check("W6 year-N+1 applies min(rolled, limit)", yearN1.otherGeneralBusinessCreditApplied, Math.min(rolled, measuredLimit));
  check("W6 year-N+1 conservation (applied + re-carry = rolled)",
    yearN1.otherGeneralBusinessCreditApplied + yearN1.otherGeneralBusinessCreditCarryforward, rolled);
}

// ── Summary ──
console.log(`\n== §51 WOTC + §45S FMLA GBC ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL WOTC/FMLA GBC ASSERTIONS PASS");
