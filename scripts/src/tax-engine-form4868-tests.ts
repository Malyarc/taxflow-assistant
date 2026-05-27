/**
 * C8 — Form 4868 (Application for Automatic Extension) — hand-calc'd tests.
 *
 * Pure engine; no API required.
 *
 * Each test case hand-calcs the expected Form 4868 line values against the
 * IRS Form 4868 (2024) instructions. The engine function under test reads
 * only `federalTaxLiability` and `federalRefundOrOwed` from
 * ComputedTaxReturn; we stub other fields via cast.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-form4868-tests.ts
 */
import { calculateForm4868 } from "../../artifacts/api-server/src/lib/form4868";
import type { ComputedTaxReturn } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

/** Minimal stub — only fields read by calculateForm4868 are exercised. */
function stub(args: {
  federalTaxLiability: number;
  federalRefundOrOwed: number;
  taxYear?: number;
}): ComputedTaxReturn {
  return {
    taxYear: args.taxYear ?? 2024,
    federalTaxLiability: args.federalTaxLiability,
    federalRefundOrOwed: args.federalRefundOrOwed,
  } as unknown as ComputedTaxReturn;
}

// ── Case 1: Balance-due — no overrides ────────────────────────────────────
// Hand-calc: federalTaxLiability $50,000, federalRefundOrOwed −$10,000
//   (payments $40,000, owed $10,000).
//   Line 4 = 50,000
//   Line 5 = 50,000 + (−10,000) = 40,000
//   Line 6 = max(0, 50,000 − 40,000) = 10,000
//   Line 7 = default = Line 6 = 10,000
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 50000, federalRefundOrOwed: -10000 }),
  });
  check("Case 1 Line 4 (balance due)", r.estimatedTotalTax, 50000);
  check("Case 1 Line 5 (balance due)", r.totalPayments, 40000);
  check("Case 1 Line 6 (balance due)", r.balanceDue, 10000);
  check("Case 1 Line 7 (default = Line 6)", r.amountBeingPaid, 10000);
  checkBool("Case 1 outOfCountry default", r.outOfCountry, false);
  checkBool("Case 1 form1040NrNoWithholding default", r.form1040NrNoWithholding, false);
}

// ── Case 2: Refund — Line 6 floors at $0 ──────────────────────────────────
// Hand-calc: federalTaxLiability $30,000, federalRefundOrOwed +$5,000
//   (payments $35,000, refund $5,000).
//   Line 4 = 30,000
//   Line 5 = 30,000 + 5,000 = 35,000
//   Line 6 = max(0, 30,000 − 35,000) = 0
//   Line 7 = 0 (no balance to pay)
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 30000, federalRefundOrOwed: 5000 }),
  });
  check("Case 2 Line 4 (refund)", r.estimatedTotalTax, 30000);
  check("Case 2 Line 5 (refund)", r.totalPayments, 35000);
  check("Case 2 Line 6 (refund → 0)", r.balanceDue, 0);
  check("Case 2 Line 7 (refund → 0)", r.amountBeingPaid, 0);
}

// ── Case 3: Refund, CPA still wants to send money (rare; for safe harbor) ─
// Same engine state as Case 2; CPA overrides amountBeingPaid to $1,000.
//   Line 4 = 30,000, Line 5 = 35,000, Line 6 = 0
//   Line 7 = override = 1,000
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 30000, federalRefundOrOwed: 5000 }),
    input: { amountBeingPaid: 1000 },
  });
  check("Case 3 Line 7 (override > Line 6)", r.amountBeingPaid, 1000);
  check("Case 3 Line 6 (unchanged)", r.balanceDue, 0);
}

// ── Case 4: Estimated tax already paid (CPA hasn't entered in adjustments) ─
// federalTaxLiability $20,000, federalRefundOrOwed −$10,000 (payments
// $10,000 via withholding, $10k owed). CPA says client also paid $5k of
// quarterly estimated tax that we don't have in the engine yet.
//   Line 4 = 20,000
//   Line 5 = 10,000 + 5,000 = 15,000
//   Line 6 = max(0, 20,000 − 15,000) = 5,000
//   Line 7 = default = 5,000
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 20000, federalRefundOrOwed: -10000 }),
    input: { estimatedTaxAlreadyPaid: 5000 },
  });
  check("Case 4 Line 4 (est-tax-paid)", r.estimatedTotalTax, 20000);
  check("Case 4 Line 5 (est-tax-paid)", r.totalPayments, 15000);
  check("Case 4 Line 6 (est-tax-paid)", r.balanceDue, 5000);
  check("Case 4 Line 7 (default = Line 6)", r.amountBeingPaid, 5000);
}

// ── Case 5: Partial payment — CPA pays less than Line 6 ───────────────────
// federalTaxLiability $20,000, federalRefundOrOwed −$15,000 (owed $15k).
// CPA decides to pay only $10k now (will accrue interest on $5k).
//   Line 4 = 20,000
//   Line 5 = 20,000 + (−15,000) = 5,000
//   Line 6 = 15,000
//   Line 7 = override = 10,000
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 20000, federalRefundOrOwed: -15000 }),
    input: { amountBeingPaid: 10000 },
  });
  check("Case 5 Line 4 (partial)", r.estimatedTotalTax, 20000);
  check("Case 5 Line 5 (partial)", r.totalPayments, 5000);
  check("Case 5 Line 6 (partial)", r.balanceDue, 15000);
  check("Case 5 Line 7 (partial override)", r.amountBeingPaid, 10000);
}

// ── Case 6: Boolean flags ─────────────────────────────────────────────────
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 1000, federalRefundOrOwed: 0 }),
    input: { outOfCountry: true, form1040NrNoWithholding: true },
  });
  checkBool("Case 6 outOfCountry flag passes through", r.outOfCountry, true);
  checkBool("Case 6 1040-NR no-withholding flag", r.form1040NrNoWithholding, true);
}

// ── Case 7: Rounding (Line 4 rounds to nearest dollar) ────────────────────
// $50,000.49 rounds down to 50,000; $50,000.51 rounds up to 50,001.
{
  const r1 = calculateForm4868({
    ret: stub({ federalTaxLiability: 50000.49, federalRefundOrOwed: -50000.49 }),
  });
  // Line 4 rounds to 50000. Line 5 = round(50000.49 + (-50000.49)) = round(0) = 0.
  check("Case 7a Line 4 rounds down", r1.estimatedTotalTax, 50000);
  check("Case 7a Line 5 ~ 0", r1.totalPayments, 0);

  const r2 = calculateForm4868({
    ret: stub({ federalTaxLiability: 50000.51, federalRefundOrOwed: 0 }),
  });
  check("Case 7b Line 4 rounds up", r2.estimatedTotalTax, 50001);
}

// ── Case 8: Negative tax (defensive — engine should never produce, but ────
// the calculator must floor to $0 for safety).
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: -5, federalRefundOrOwed: 0 }),
  });
  check("Case 8 Line 4 floors at 0 (negative input)", r.estimatedTotalTax, 0);
}

// ── Case 9: Zero tax ──────────────────────────────────────────────────────
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 0, federalRefundOrOwed: 0 }),
  });
  check("Case 9 Line 4 (zero tax)", r.estimatedTotalTax, 0);
  check("Case 9 Line 5 (zero tax)", r.totalPayments, 0);
  check("Case 9 Line 6 (zero tax)", r.balanceDue, 0);
  check("Case 9 Line 7 (zero tax)", r.amountBeingPaid, 0);
}

// ── Case 10: Real-world MFJ scenario, balance due near 90% safe harbor ───
// Federal tax $42,500. Withholding gave back federalRefundOrOwed = −$8,500
// (owed $8,500, so payments = $42,500 - $8,500 = $34,000). CPA wants to
// pay 90% of total ($38,250) to meet safe harbor and avoid late-pay
// penalty. The 90%-of-total = $38,250 = $42,500 × 0.90; pay-with-extension
// = $38,250 − $34,000 already withheld = $4,250.
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 42500, federalRefundOrOwed: -8500 }),
    input: { amountBeingPaid: 4250 },
  });
  check("Case 10 Line 4 (MFJ near safe-harbor)", r.estimatedTotalTax, 42500);
  check("Case 10 Line 5 (MFJ near safe-harbor)", r.totalPayments, 34000);
  check("Case 10 Line 6 (MFJ near safe-harbor)", r.balanceDue, 8500);
  check("Case 10 Line 7 (90% safe harbor)", r.amountBeingPaid, 4250);
  // Verify a safe-harbor invariant: with $4,250 paid by Apr 15 +
  // $34,000 withholding = $38,250 = 90% of $42,500. CPA can document
  // this to defend against §6651(a)(2) penalty.
  const totalPaidByApril15 = r.totalPayments + r.amountBeingPaid;
  check("Case 10 safe-harbor invariant: 90% of total",
    totalPaidByApril15, 42500 * 0.9);
}

// ── Case 11: TY2025 — taxYear pass-through ────────────────────────────────
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 10000, federalRefundOrOwed: 0, taxYear: 2025 }),
  });
  check("Case 11 taxYear pass-through", r.taxYear, 2025);
}

// ── Case 12: amountBeingPaid override capped at 0 if negative ────────────
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 10000, federalRefundOrOwed: -10000 }),
    input: { amountBeingPaid: -500 },
  });
  // -500 floors to 0 (the round helper does max(0, round(n)))
  check("Case 12 negative amountBeingPaid floors at 0", r.amountBeingPaid, 0);
}

// ── Case 13: estimatedTaxAlreadyPaid > balance — Line 6 still floors at 0 ─
// federalTaxLiability $5,000, federalRefundOrOwed −$5,000 (owed $5k).
// CPA passes $10k estimated already paid → Line 5 = $0 + $10k = $10k.
// Line 6 = max(0, $5k − $10k) = $0. Line 7 = 0.
{
  const r = calculateForm4868({
    ret: stub({ federalTaxLiability: 5000, federalRefundOrOwed: -5000 }),
    input: { estimatedTaxAlreadyPaid: 10000 },
  });
  check("Case 13 Line 5 (est-tax > balance)", r.totalPayments, 10000);
  check("Case 13 Line 6 (est-tax > balance → 0)", r.balanceDue, 0);
  check("Case 13 Line 7 (est-tax > balance → 0)", r.amountBeingPaid, 0);
}

// ── Print results ────────────────────────────────────────────────────────
console.log(`\nForm 4868 (C8) tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
