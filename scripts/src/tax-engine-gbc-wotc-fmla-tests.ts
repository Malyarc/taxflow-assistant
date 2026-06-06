/**
 * §51 WOTC + §45S FMLA general business credits — hand-calc'd tests (P2).
 *
 * Pure engine; no API required. Both are CPA-supplied general-business-credit
 * amounts (Form 5884 / Form 8994 — they need employee/wage data the individual
 * engine doesn't model). The engine applies them through the SAME §38(c) limit as
 * §41, against the REMAINING GBC room after §41, and carries the excess (§39).
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

// ── Summary ──
console.log(`\n== §51 WOTC + §45S FMLA GBC ==  PASS: ${PASS.length}  FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log("ALL WOTC/FMLA GBC ASSERTIONS PASS");
