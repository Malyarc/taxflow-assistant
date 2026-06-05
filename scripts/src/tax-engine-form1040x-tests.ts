/**
 * C4 — Form 1040-X (Amended Return) — hand-calc'd tests.
 *
 * Pure engine; no API required.
 *
 * Tests `computeAmendmentDiff()` and `captureFiledSnapshot()` against
 * hand-calculated values for representative amendment scenarios.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-form1040x-tests.ts
 */
import {
  captureFiledSnapshot,
  computeAmendmentDiff,
  type FiledSnapshot,
} from "../../artifacts/api-server/src/lib/form1040x";
import type { ComputedTaxReturn } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

function checkStr(label: string, actual: string | null, expected: string | null): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

interface FlatComputed {
  taxYear: number;
  adjustedGrossIncome: number;
  standardDeduction: number;
  itemizedDeductions: number;
  qbiDeduction: number;
  taxableIncome: number;
  federalTaxLiability: number;
  federalTaxWithheld: number;
  federalRefundOrOwed: number;
  selfEmploymentTax: number;
  niitTax: number;
  amtTax: number;
  additionalMedicareTax: number;
  eitc: number;
  additionalChildTaxCredit: number;
  aocRefundablePortion: number;
  premiumTaxCredit: number;
  stateTaxLiability: number;
  stateTaxWithheld: number;
  stateRefundOrOwed: number;
  totalNonRefundableApplied: number;
  // P2-7 credit-component detail (optional in older fixtures → default 0).
  capitalGainsTax: number;
  dependentCareCredit: number;
  saversCredit: number;
  foreignTaxCredit: number;
  residentialEnergyCredits: number;
  aocCredit: number;
  llcCredit: number;
}

function stub(args: Partial<FlatComputed> & { taxYear?: number } = {}): ComputedTaxReturn {
  const blank: FlatComputed = {
    taxYear: args.taxYear ?? 2024,
    adjustedGrossIncome: 0, standardDeduction: 0, itemizedDeductions: 0,
    qbiDeduction: 0, taxableIncome: 0,
    federalTaxLiability: 0, federalTaxWithheld: 0, federalRefundOrOwed: 0,
    selfEmploymentTax: 0, niitTax: 0, amtTax: 0, additionalMedicareTax: 0,
    eitc: 0, additionalChildTaxCredit: 0, aocRefundablePortion: 0, premiumTaxCredit: 0,
    stateTaxLiability: 0, stateTaxWithheld: 0, stateRefundOrOwed: 0,
    totalNonRefundableApplied: 0,
    capitalGainsTax: 0, dependentCareCredit: 0, saversCredit: 0,
    foreignTaxCredit: 0, residentialEnergyCredits: 0, aocCredit: 0, llcCredit: 0,
  };
  return { ...blank, ...args } as unknown as ComputedTaxReturn;
}

function findLine(lines: ReturnType<typeof computeAmendmentDiff>["lines"], ref: string) {
  const l = lines.find((x) => x.lineRef === ref);
  if (!l) throw new Error(`Line ${ref} not found`);
  return l;
}

// ── Case 1: Basic AGI change ──────────────────────────────────────────────
// Original AGI $100,000; amended AGI $110,000.
//   Line 1 (a) = 100,000; (c) = 110,000; (b) = +10,000.
{
  const original = stub({ adjustedGrossIncome: 100000, standardDeduction: 14600 });
  const amended = stub({ adjustedGrossIncome: 110000, standardDeduction: 14600 });
  const snap = captureFiledSnapshot(original);
  const form = computeAmendmentDiff({ current: amended, snapshot: snap });
  const l1 = findLine(form.lines, "1");
  check("Case 1 Line 1 (a) original AGI", l1.original, 100000);
  check("Case 1 Line 1 (c) amended AGI", l1.amended, 110000);
  check("Case 1 Line 1 (b) net change", l1.netChange, 10000);
}

// ── Case 2: Total tax decrease → refund increase ──────────────────────────
// Original: tax $20,000, withholding $20,000 → owed $0.
// Amended: tax $18,000, withholding $20,000 → refund $2,000.
//   Line 10 net change = 18000 - 20000 = -2000.
//   netFederalRefundChange = 2000 - 0 = +2000.
{
  const original = stub({ federalTaxLiability: 20000, federalTaxWithheld: 20000, federalRefundOrOwed: 0 });
  const amended = stub({ federalTaxLiability: 18000, federalTaxWithheld: 20000, federalRefundOrOwed: 2000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  const l10 = findLine(form.lines, "10");
  check("Case 2 Line 10 net change (tax decrease)", l10.netChange, -2000);
  check("Case 2 net federal refund change", form.netFederalRefundChange, 2000);
}

// ── Case 3: Refund → Owed swap ────────────────────────────────────────────
// Original: refund $1,000. Amended: owed $2,000.
//   net change = -2000 - 1000 = -3000 (refund became owed by $3k total swing).
{
  const original = stub({ federalTaxLiability: 5000, federalTaxWithheld: 6000, federalRefundOrOwed: 1000 });
  const amended = stub({ federalTaxLiability: 8000, federalTaxWithheld: 6000, federalRefundOrOwed: -2000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  check("Case 3 net federal refund change (refund→owed)", form.netFederalRefundChange, -3000);
}

// ── Case 4: Owed → Refund swap ────────────────────────────────────────────
// Original: owed $5,000. Amended: refund $1,000.
//   netFederalRefundChange = 1000 - (-5000) = +6000.
{
  const original = stub({ federalTaxLiability: 25000, federalTaxWithheld: 20000, federalRefundOrOwed: -5000 });
  const amended = stub({ federalTaxLiability: 19000, federalTaxWithheld: 20000, federalRefundOrOwed: 1000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  check("Case 4 net federal refund change (owed→refund)", form.netFederalRefundChange, 6000);
}

// ── Case 5: Identical returns — all zeros ─────────────────────────────────
{
  const ret = stub({
    adjustedGrossIncome: 80000,
    standardDeduction: 14600,
    taxableIncome: 65400,
    federalTaxLiability: 9000,
    federalTaxWithheld: 10000,
    federalRefundOrOwed: 1000,
  });
  const form = computeAmendmentDiff({ current: ret, snapshot: captureFiledSnapshot(ret) });
  for (const l of form.lines) {
    check(`Case 5 Line ${l.lineRef} netChange (identical)`, l.netChange, 0);
  }
  check("Case 5 net federal refund change (identical)", form.netFederalRefundChange, 0);
  check("Case 5 net state refund change (identical)", form.netStateRefundChange, 0);
}

// ── Case 6: Std → Itemized switch ─────────────────────────────────────────
// Original: std deduction $14,600. Amended: itemized $18,000.
// Line 2 picks max(std, itemized): original = 14,600; amended = 18,000.
//   netChange = +3,400.
{
  const original = stub({ standardDeduction: 14600, itemizedDeductions: 0 });
  const amended = stub({ standardDeduction: 14600, itemizedDeductions: 18000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  const l2 = findLine(form.lines, "2");
  check("Case 6 Line 2 (a) original deduction (std)", l2.original, 14600);
  check("Case 6 Line 2 (c) amended deduction (itemized)", l2.amended, 18000);
  check("Case 6 Line 2 (b) net change std→itemized", l2.netChange, 3400);
}

// ── Case 7: Other taxes (SE) change ──────────────────────────────────────
// Original SE tax $10,000; amended SE $12,000. Other taxes (Line 9) net = +2,000.
{
  const original = stub({
    federalTaxLiability: 30000,
    selfEmploymentTax: 10000,
    federalTaxWithheld: 25000,
    federalRefundOrOwed: -5000,
  });
  const amended = stub({
    federalTaxLiability: 32000,
    selfEmploymentTax: 12000,
    federalTaxWithheld: 25000,
    federalRefundOrOwed: -7000,
  });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  const l9 = findLine(form.lines, "9");
  check("Case 7 Line 9 (a) original other taxes", l9.original, 10000);
  check("Case 7 Line 9 (c) amended other taxes", l9.amended, 12000);
  check("Case 7 Line 9 (b) net change", l9.netChange, 2000);
}

// ── Case 8: Rounding — engine rounds to nearest dollar ────────────────────
{
  const original = stub({ adjustedGrossIncome: 50000.49 });
  const amended = stub({ adjustedGrossIncome: 50000.51 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  const l1 = findLine(form.lines, "1");
  // round(50000.49) = 50000; round(50000.51) = 50001; net = +1
  check("Case 8 Line 1 (a) rounds .49 down", l1.original, 50000);
  check("Case 8 Line 1 (c) rounds .51 up", l1.amended, 50001);
  check("Case 8 Line 1 (b) net = +1", l1.netChange, 1);
}

// ── Case 9: State refund delta ────────────────────────────────────────────
{
  const original = stub({ stateRefundOrOwed: 500 });
  const amended = stub({ stateRefundOrOwed: -200 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  check("Case 9 net state refund change", form.netStateRefundChange, -700);
}

// ── Case 10: Locked-at + explanation pass-through ────────────────────────
{
  const ret = stub({ adjustedGrossIncome: 50000 });
  const lockedAt = "2026-05-26T19:30:00.000Z";
  const form = computeAmendmentDiff({
    current: ret,
    snapshot: captureFiledSnapshot(ret),
    explanation: "Corrected 1099-DIV for ACME Corp",
    lockedAt,
  });
  checkStr("Case 10 lockedAt pass-through", form.lockedAt, lockedAt);
  checkStr("Case 10 explanation pass-through", form.explanation, "Corrected 1099-DIV for ACME Corp");
}

// ── Case 11: Snapshot schema version + capture ──────────────────────────
{
  const ret = stub({ adjustedGrossIncome: 75000.50, federalTaxLiability: 8000 });
  const snap: FiledSnapshot = captureFiledSnapshot(ret);
  check("Case 11 schemaVersion", snap.schemaVersion, 1);
  check("Case 11 snapshot AGI preserves cents", snap.fields.adjustedGrossIncome, 75000.50);
  check("Case 11 snapshot federalTax", snap.fields.federalTaxLiability, 8000);
}

// ── Case 12: Refundable credits net change (EITC + ACTC + AOCRef + PTC) ──
// Original: EITC $0, ACTC $1700, AOCRef $1000, PTC $500 → ref total = 3200.
// Amended:  EITC $400, ACTC $1700, AOCRef $1000, PTC $500 → ref total = 3600.
//   Line 13 (EITC) net = +400; Line 14 (other refundable) net = 0.
// Note: engine puts EITC on its own line (13), the rest on Line 14.
{
  const original = stub({ eitc: 0, additionalChildTaxCredit: 1700, aocRefundablePortion: 1000, premiumTaxCredit: 500 });
  const amended = stub({ eitc: 400, additionalChildTaxCredit: 1700, aocRefundablePortion: 1000, premiumTaxCredit: 500 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  const l13 = findLine(form.lines, "13");
  const l14 = findLine(form.lines, "14");
  check("Case 12 Line 13 (EITC) net change", l13.netChange, 400);
  check("Case 12 Line 14 (other refundable) net change", l14.netChange, 0);
}

// ── Case 13: Negative PTC (excess advance APTC) — Line 14 floors PTC at 0 ─
// Original: net PTC +800. Amended: net PTC −1200 (CPA discovered too much advance taken).
// Line 14 PTC contribution: max(0, PTC).
//   Original Line 14 includes +800 PTC; Amended includes 0.
//   Net Line 14 change for PTC component: -800.
{
  const original = stub({ premiumTaxCredit: 800 });
  const amended = stub({ premiumTaxCredit: -1200 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  const l14 = findLine(form.lines, "14");
  check("Case 13 Line 14 PTC clamp at 0 (was 800, now 0)", l14.netChange, -800);
}

// ── Case 14: Total payments (Line 16) self-consistency ───────────────────
// Line 16 = federalTaxLiability + federalRefundOrOwed.
// Original: tax 30k, refund 5k → payments 35k.
// Amended:  tax 32k, refund 3k → payments 35k.
//   Line 16 net = 0 (no actual additional payment — only tax computation changed).
{
  const original = stub({ federalTaxLiability: 30000, federalRefundOrOwed: 5000 });
  const amended = stub({ federalTaxLiability: 32000, federalRefundOrOwed: 3000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  const l16 = findLine(form.lines, "16");
  check("Case 14 Line 16 self-consistency", l16.netChange, 0);
  check("Case 14 net federal refund change reflects tax delta", form.netFederalRefundChange, -2000);
}

// ── Case 15: Tax year pass-through ────────────────────────────────────────
{
  const ret = stub({ taxYear: 2025 });
  const form = computeAmendmentDiff({ current: ret, snapshot: captureFiledSnapshot(ret) });
  check("Case 15 taxYear pass-through", form.taxYear, 2025);
}

// ── Print results ─────────────────────────────────────────────────────────
// ── FORM-02: non-refundable credit changes flow to Lines 8/10/16 ──────────
// Filed: regular tax $20,000, withholding $20,000, no credits → liability
// $20,000, refund/owed $0. Amend to add a $3,000 foreign tax credit (a
// NON-refundable credit) → engine federalTaxLiability stays $20,000 (it's
// PRE-credit), totalNonRefundableApplied $3,000, federalRefundOrOwed +$3,000.
// Pre-fix the breakdown showed Line 10 net $0 (contradicting the +$3,000
// headline); post-fix Line 10 "Total tax" drops $3,000 and the form foots.
{
  const filed = stub({ federalTaxLiability: 20000, federalTaxWithheld: 20000, federalRefundOrOwed: 0, totalNonRefundableApplied: 0 });
  const amended = stub({ federalTaxLiability: 20000, federalTaxWithheld: 20000, federalRefundOrOwed: 3000, totalNonRefundableApplied: 3000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(filed) });
  check("FORM-02 Line 10 total tax original = $20,000", findLine(form.lines, "10").original, 20000);
  check("FORM-02 Line 10 total tax amended = $17,000 (net of $3k FTC)", findLine(form.lines, "10").amended, 17000);
  check("FORM-02 Line 10 net change = -$3,000", findLine(form.lines, "10").netChange, -3000);
  check("FORM-02 Line 16 total payments unchanged (FTC is not a payment)", findLine(form.lines, "16").netChange, 0);
  check("FORM-02 headline net refund change = +$3,000", form.netFederalRefundChange, 3000);
  // Form foots: (Line 16 − Line 10) = refund/owed in each column.
  check("FORM-02 footing: amended payments − tax = $3,000 refund", findLine(form.lines, "16").amended - findLine(form.lines, "10").amended, 3000);
  check("FORM-02 footing: original payments − tax = $0", findLine(form.lines, "16").original - findLine(form.lines, "10").original, 0);
}

// ── FORM-03: settlement chain (Lines 17-20) reconciles on every swap ──────
// The amendment's bottom line is Line 20 (refund) − Line 19 (owe), which by
// construction must equal the headline netFederalRefundChange. Prior code put
// each return's STANDALONE owe/refund on Lines 19/20 so the breakdown failed
// to foot on a refund↔owed swap.
//
// Hand-calc, Case 3 reprise (original refund $1,000 → amended owed $2,000):
//   cTotalTax       = 8,000 (amended tax, no non-ref credits)
//   cTotalPayments  = 8,000 + (−2,000) = 6,000
//   origOverpayment = max(0, +1,000) = 1,000   (Line 17)
//   origBalancePaid = max(0, −1,000) = 0        (Line 18)
//   available       = 6,000 + 0 − 1,000 = 5,000
//   Line 19 owe     = max(0, 8,000 − 5,000) = 3,000
//   Line 20 refund  = max(0, 5,000 − 8,000) = 0
//   Line 20 − Line 19 = −3,000 = netFederalRefundChange ✓
{
  const original = stub({ federalTaxLiability: 5000, federalTaxWithheld: 6000, federalRefundOrOwed: 1000 });
  const amended = stub({ federalTaxLiability: 8000, federalTaxWithheld: 6000, federalRefundOrOwed: -2000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  check("FORM-03 Case3 Line 17 orig overpayment", findLine(form.lines, "17").amended, 1000);
  check("FORM-03 Case3 Line 18 orig balance paid", findLine(form.lines, "18").amended, 0);
  check("FORM-03 Case3 Line 19 amount you owe", findLine(form.lines, "19").amended, 3000);
  check("FORM-03 Case3 Line 20 refund", findLine(form.lines, "20").amended, 0);
  check("FORM-03 Case3 reconciles (L20−L19 == headline)",
    findLine(form.lines, "20").amended - findLine(form.lines, "19").amended, form.netFederalRefundChange);
  // Settlement lines carry no col-b "change".
  check("FORM-03 Case3 Line 19 netChange pinned 0", findLine(form.lines, "19").netChange, 0);
  check("FORM-03 Case3 Line 20 netChange pinned 0", findLine(form.lines, "20").netChange, 0);
}

// Case 4 reprise (original owed $5,000 → amended refund $1,000):
//   cTotalTax=19,000; cTotalPayments=20,000; origBalancePaid=5,000 (Line 18);
//   available=20,000+5,000=25,000; Line 20 refund=max(0,25,000−19,000)=6,000;
//   Line 19 owe=0; L20−L19=+6,000=netFederalRefundChange ✓
{
  const original = stub({ federalTaxLiability: 25000, federalTaxWithheld: 20000, federalRefundOrOwed: -5000 });
  const amended = stub({ federalTaxLiability: 19000, federalTaxWithheld: 20000, federalRefundOrOwed: 1000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  check("FORM-03 Case4 Line 17 orig overpayment", findLine(form.lines, "17").amended, 0);
  check("FORM-03 Case4 Line 18 orig balance paid", findLine(form.lines, "18").amended, 5000);
  check("FORM-03 Case4 Line 19 amount you owe", findLine(form.lines, "19").amended, 0);
  check("FORM-03 Case4 Line 20 refund", findLine(form.lines, "20").amended, 6000);
  check("FORM-03 Case4 reconciles (L20−L19 == headline)",
    findLine(form.lines, "20").amended - findLine(form.lines, "19").amended, form.netFederalRefundChange);
}

// Case 2 reprise (owed $0 → refund $2,000): Line 20 = 2,000, Line 19 = 0.
{
  const original = stub({ federalTaxLiability: 20000, federalTaxWithheld: 20000, federalRefundOrOwed: 0 });
  const amended = stub({ federalTaxLiability: 18000, federalTaxWithheld: 20000, federalRefundOrOwed: 2000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  check("FORM-03 Case2 Line 20 refund", findLine(form.lines, "20").amended, 2000);
  check("FORM-03 Case2 Line 19 owe", findLine(form.lines, "19").amended, 0);
  check("FORM-03 Case2 reconciles",
    findLine(form.lines, "20").amended - findLine(form.lines, "19").amended, form.netFederalRefundChange);
}

// FORM-02 reprise (non-refundable $3k FTC added): Line 10 drops $3k, the
// settlement shows a $3,000 additional refund (Line 20), Line 19 = 0.
{
  const filed = stub({ federalTaxLiability: 20000, federalTaxWithheld: 20000, federalRefundOrOwed: 0, totalNonRefundableApplied: 0 });
  const amended = stub({ federalTaxLiability: 20000, federalTaxWithheld: 20000, federalRefundOrOwed: 3000, totalNonRefundableApplied: 3000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(filed) });
  check("FORM-03 FTC Line 20 refund", findLine(form.lines, "20").amended, 3000);
  check("FORM-03 FTC Line 19 owe", findLine(form.lines, "19").amended, 0);
  check("FORM-03 FTC reconciles",
    findLine(form.lines, "20").amended - findLine(form.lines, "19").amended, form.netFederalRefundChange);
}

// Compound: non-refundable credits + SE other-tax + owed→less-owed swap.
// Original: federalTaxLiability $50,000 (regular+AMT $38k + SE $12k), non-ref
//   $5,000, withheld $30k, ACTC $4k → net tax (Line 10) $45,000; standalone
//   payments $34,000; owed $11,000 (refundOrOwed −11,000).
// Amended:  federalTaxLiability $44,000 (regular+AMT $34k + SE $10k), non-ref
//   $5,000, withheld $30k, ACTC $4k → net tax $39,000; payments $34,000;
//   owed $5,000 (refundOrOwed −5,000).
//   netFederalRefundChange = −5,000 − (−11,000) = +6,000.
//   cTotalTax=39,000; cTotalPayments=34,000; origBalancePaid=11,000 (Line 18);
//   available=34,000+11,000=45,000; Line 20 refund=45,000−39,000=6,000.
{
  const original = stub({
    federalTaxLiability: 50000, selfEmploymentTax: 12000, totalNonRefundableApplied: 5000,
    federalTaxWithheld: 30000, additionalChildTaxCredit: 4000, federalRefundOrOwed: -11000,
  });
  const amended = stub({
    federalTaxLiability: 44000, selfEmploymentTax: 10000, totalNonRefundableApplied: 5000,
    federalTaxWithheld: 30000, additionalChildTaxCredit: 4000, federalRefundOrOwed: -5000,
  });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  check("FORM-03 Compound Line 10 original total tax", findLine(form.lines, "10").original, 45000);
  check("FORM-03 Compound Line 10 amended total tax", findLine(form.lines, "10").amended, 39000);
  check("FORM-03 Compound Line 10 net change", findLine(form.lines, "10").netChange, -6000);
  check("FORM-03 Compound Line 18 tax paid with original", findLine(form.lines, "18").amended, 11000);
  check("FORM-03 Compound Line 20 refund", findLine(form.lines, "20").amended, 6000);
  check("FORM-03 Compound Line 19 owe", findLine(form.lines, "19").amended, 0);
  check("FORM-03 Compound headline +6,000", form.netFederalRefundChange, 6000);
  check("FORM-03 Compound reconciles",
    findLine(form.lines, "20").amended - findLine(form.lines, "19").amended, form.netFederalRefundChange);
  // Line 16 standalone footing preserved (FORM-02 invariant): payments − tax = owed.
  check("FORM-03 Compound Line 16 amended footing", findLine(form.lines, "16").amended - findLine(form.lines, "10").amended, -5000);
}

// ════════════════════════════════════════════════════════════════════════════
// P2-7 — amendment depth: Line 6/7 breakout, credit detail, state lines
// ════════════════════════════════════════════════════════════════════════════
function findIn(arr: ReturnType<typeof computeAmendmentDiff>["creditDetail"], ref: string) {
  const l = arr.find((x) => x.lineRef === ref);
  if (!l) throw new Error(`detail line ${ref} not found`);
  return l;
}

// ── P2-7 Case A — Line 6 (tax) / Line 7 (nonref credits) / Line 8 footing ──
// Original: federalTaxLiability $30,000 (engine total, pre-nonref, bundles
// other taxes); SE tax $5,000 → other taxes $5,000; nonref credits $4,000;
// capital-gains tax $3,000 (a component of the income tax).
//   Line 6 (a) = 30,000 − 5,000 = 25,000.  Line 7 (a) = 4,000.  Line 8 (a) = 21,000.
// Amended: federalTaxLiability $32,000; SE tax $5,000; nonref credits $4,500.
//   Line 6 (c) = 27,000 (+2,000).  Line 7 (c) = 4,500 (+500).  Line 8 (c) = 22,500 (+1,500).
{
  const original = stub({ federalTaxLiability: 30000, selfEmploymentTax: 5000, totalNonRefundableApplied: 4000, capitalGainsTax: 3000 });
  const amended = stub({ federalTaxLiability: 32000, selfEmploymentTax: 5000, totalNonRefundableApplied: 4500, capitalGainsTax: 3000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  const l6 = findLine(form.lines, "6");
  const l7 = findLine(form.lines, "7");
  const l8 = findLine(form.lines, "8");
  check("P2-7 A Line 6 (a) tax pre-credit", l6.original, 25000);
  check("P2-7 A Line 6 (c) tax pre-credit", l6.amended, 27000);
  check("P2-7 A Line 6 net change", l6.netChange, 2000);
  check("P2-7 A Line 7 (a) nonref credits", l7.original, 4000);
  check("P2-7 A Line 7 net change", l7.netChange, 500);
  check("P2-7 A Line 8 footing (a) = L6 − L7", l8.original, l6.original - l7.original);
  check("P2-7 A Line 8 footing (c) = L6 − L7", l8.amended, l6.amended - l7.amended);
  check("P2-7 A Line 8 net change", l8.netChange, 1500);
  // capital-gains tax surfaces as detail line 6a (= $3,000) but is NOT
  // subtracted anywhere — Line 6/8 are unaffected (no double-count).
  check("P2-7 A detail 6a cap-gains tax", findIn(form.creditDetail, "6a").original, 3000);
}

// ── P2-7 Case B — nonrefundable-credit component detail ───────────────────
// Original: dependent care $1,200; FTC $800; AOC total $2,500 w/ $1,000
// refundable → AOC nonref $1,500. Amended: dependent care removed ($0); FTC
// dropped to $500; AOC unchanged.
{
  const original = stub({ dependentCareCredit: 1200, foreignTaxCredit: 800, aocCredit: 2500, aocRefundablePortion: 1000 });
  const amended = stub({ dependentCareCredit: 0, foreignTaxCredit: 500, aocCredit: 2500, aocRefundablePortion: 1000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  check("P2-7 B detail dependent-care (7a) net", findIn(form.creditDetail, "7a").netChange, -1200);
  check("P2-7 B detail FTC (7e) net", findIn(form.creditDetail, "7e").netChange, -300);
  check("P2-7 B detail AOC nonref (7b) original", findIn(form.creditDetail, "7b").original, 1500);
  check("P2-7 B detail AOC nonref (7b) net (unchanged)", findIn(form.creditDetail, "7b").netChange, 0);
  // saver's / energy / LLC / cap-gains all $0 → excluded from the breakdown.
  checkBool("P2-7 B saver's excluded", form.creditDetail.some((d) => d.lineRef === "7d"), false);
  check("P2-7 B detail count = 3", form.creditDetail.length, 3, 0);
}

// ── P2-7 Case C — amended STATE return summary lines ──────────────────────
// Original: state tax $4,000, withheld $4,500, refund $500.
// Amended: state tax $4,800, withheld $4,500, owed $300 (refundOrOwed −300).
{
  const original = stub({ stateTaxLiability: 4000, stateTaxWithheld: 4500, stateRefundOrOwed: 500 });
  const amended = stub({ stateTaxLiability: 4800, stateTaxWithheld: 4500, stateRefundOrOwed: -300 });
  const form = computeAmendmentDiff({ current: amended, snapshot: captureFiledSnapshot(original) });
  check("P2-7 C S1 state tax net (+800)", findIn(form.stateLines, "S1").netChange, 800);
  check("P2-7 C S2 state withheld net (0)", findIn(form.stateLines, "S2").netChange, 0);
  check("P2-7 C S3 state refund/owed net (−800)", findIn(form.stateLines, "S3").netChange, -800);
  check("P2-7 C net state refund change", form.netStateRefundChange, -800);
}

// ── P2-7 Case D — identical amendment: every new line/detail nets 0 ───────
{
  const ret = stub({
    federalTaxLiability: 28000, selfEmploymentTax: 3000, totalNonRefundableApplied: 3500,
    dependentCareCredit: 600, foreignTaxCredit: 400, saversCredit: 200,
    stateTaxLiability: 3000, stateTaxWithheld: 3200, stateRefundOrOwed: 200,
  });
  const form = computeAmendmentDiff({ current: ret, snapshot: captureFiledSnapshot(ret) });
  check("P2-7 D Line 6 nets 0 (identical)", findLine(form.lines, "6").netChange, 0);
  check("P2-7 D Line 7 nets 0 (identical)", findLine(form.lines, "7").netChange, 0);
  let allZero = true;
  for (const d of form.creditDetail) if (d.netChange !== 0) allZero = false;
  for (const s of form.stateLines) if (s.netChange !== 0) allZero = false;
  checkBool("P2-7 D all credit-detail + state lines net 0", allZero, true);
}

// ── P2-7 Case E — backward-compat: a pre-P2-7 snapshot (no new fields) ────
// A snapshot captured before P2-7 lacks the new fields; num() coerces them to
// 0, so the credit detail is empty and Line 6/7/8 still foot.
{
  const legacySnapshot = captureFiledSnapshot(stub({ federalTaxLiability: 20000, totalNonRefundableApplied: 2000 }));
  // Simulate an OLD snapshot by stripping the P2-7 fields from the captured one.
  const stripped = JSON.parse(JSON.stringify(legacySnapshot));
  delete stripped.fields.capitalGainsTax;
  delete stripped.fields.dependentCareCredit;
  delete stripped.fields.foreignTaxCredit;
  delete stripped.fields.aocCredit;
  delete stripped.fields.aocRefundablePortion;
  const amended = stub({ federalTaxLiability: 22000, totalNonRefundableApplied: 2000 });
  const form = computeAmendmentDiff({ current: amended, snapshot: stripped });
  check("P2-7 E legacy Line 6 (a) = 20,000", findLine(form.lines, "6").original, 20000);
  check("P2-7 E legacy Line 8 footing", findLine(form.lines, "8").original, 18000);
  check("P2-7 E legacy credit detail empty (all 0 components)", form.creditDetail.length, 0, 0);
}

console.log(`\nForm 1040-X (C4) tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
