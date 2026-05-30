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

console.log(`\nForm 1040-X (C4) tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
