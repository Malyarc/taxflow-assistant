/**
 * G-4 — Quarterly Estimate Autopilot tests.
 *
 * PURE (no API). Builds TaxReturnInputs, runs the engine + computeForm2210 to
 * anchor the §6654 safe-harbor target, then asserts HAND-CALC'd values for the
 * autopilot's own logic: YTD annualization (×12/months), the safe-harbor target +
 * basis (90%-current vs 100%/110%-prior with the $150k / $75k-MFS trigger), the
 * even four-voucher split, the still-open re-split after a payment shortfall/
 * overage, the §6654(c)(2) statutory due dates, the voucher-status classification
 * vs an as-of date, the "due next" selection, and the IRS-Direct-Pay reminders.
 *
 * The engine's exact rounding for SE/QBI is verified independently below (so the
 * Hand-calc comments cite the engine-confirmed anchors): single $120k W-2 → 2024
 * tax $18,339 (90% = $16,505); single $120k net-SE → §6654 tax $29,067 (90% =
 * $26,160). Statutory dates here are NOT §7503-weekend-rolled (documented).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-quarterly-autopilot-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type ComputedTaxReturn,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  runQuarterlyAutopilot,
  quarterlyDueDates,
} from "../../artifacts/api-server/src/lib/quarterlyAutopilot";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  cond ? PASS.push(`✓ ${label}`) : FAIL.push(`✗ ${label}`);
}
function checkStr(label: string, actual: string, expected: string): void {
  actual === expected ? PASS.push(`✓ ${label}`) : FAIL.push(`✗ ${label}: expected "${expected}", got "${actual}"`);
}

// ── Shared fixtures ───────────────────────────────────────────────────────────
// Single FL self-employed, $120k net SE → §6654 tax $29,067, 90% harbor $26,160,
// no withholding → base voucher = round(26160/4) = $6,540 each (Q4 takes the
// rounding remainder, which is 0 here: 6540×4 = 26160).
const seInputs: TaxReturnInputs = {
  client: { filingStatus: "single", state: "FL", taxYear: 2024 },
  w2s: [],
  form1099s: [],
  adjustments: [{ adjustmentType: "self_employment_income", amount: 120000 }],
  taxYear: 2024,
};
const seReturn: ComputedTaxReturn = computeTaxReturnPure(seInputs);

// Empty FL baseline used for FEED scenarios (the feed supplies all income).
const feedBaseInputs: TaxReturnInputs = {
  client: { filingStatus: "single", state: "FL", taxYear: 2024 },
  w2s: [],
  form1099s: [],
  adjustments: [],
  taxYear: 2024,
};
const feedBaseReturn: ComputedTaxReturn = computeTaxReturnPure(feedBaseInputs);

// ════════════════════════════════════════════════════════════════════════════
// G1 — Statutory §6654(c)(2) due dates (no §7503 roll applied; documented).
//   2024: Apr 15, Jun 15, Sep 15 of 2024; Jan 15 of 2025.
// ════════════════════════════════════════════════════════════════════════════
{
  const d = quarterlyDueDates(2024);
  checkTrue("G1 four due dates", d.length === 4);
  checkStr("G1 Q1 due 2024-04-15", d[0], "2024-04-15");
  checkStr("G1 Q2 due 2024-06-15", d[1], "2024-06-15");
  checkStr("G1 Q3 due 2024-09-15", d[2], "2024-09-15");
  checkStr("G1 Q4 due 2025-01-15 (next year)", d[3], "2025-01-15");
  // Year roll: TY2025 Q4 is Jan 15 2026.
  checkStr("G1 TY2025 Q4 due 2026-01-15", quarterlyDueDates(2025)[3], "2026-01-15");
}

// ════════════════════════════════════════════════════════════════════════════
// G2 — Baseline (no feed), no prior year → 90%-current harbor; even four-way
//   split; all four OPEN as of a January as-of date.
//   target = $26,160; toCover = 26160 − 0 W/H = 26160; per quarter = $6,540.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2024-01-10",
  });
  check("G2 projectedAnnualTax $29,067", r.projectedAnnualTax, 29067);
  check("G2 safeHarborTarget $26,160 (90% of 29,067)", r.safeHarborTarget, 26160);
  checkStr("G2 basis 90%_current", r.safeHarborBasis, "90%_current");
  check("G2 four vouchers", r.vouchers.length, 4);
  check("G2 Q1 amount $6,540", r.vouchers[0].amount, 6540);
  check("G2 Q2 amount $6,540", r.vouchers[1].amount, 6540);
  check("G2 Q3 amount $6,540", r.vouchers[2].amount, 6540);
  check("G2 Q4 amount $6,540 (remainder)", r.vouchers[3].amount, 6540);
  check("G2 totalRequired $26,160", r.totalRequired, 26160);
  check("G2 totalPaidToDate $0", r.totalPaidToDate, 0);
  check("G2 remainingToPay $26,160", r.remainingToPay, 26160);
  // As of Jan 10, every quarter is open; the soonest (Q1) is "due", rest "upcoming".
  checkStr("G2 Q1 status due", r.vouchers[0].status, "due");
  checkStr("G2 Q2 status upcoming", r.vouchers[1].status, "upcoming");
  checkStr("G2 Q4 status upcoming", r.vouchers[3].status, "upcoming");
  checkTrue("G2 nextVoucher = Q1", r.nextVoucher?.quarter === 1);
  // 4 reminders: Q1 due + Q2/Q3/Q4 heads-up.
  check("G2 four reminders", r.reminders.length, 4);
  checkTrue("G2 reminder cites IRS Direct Pay", r.reminders[0].includes("IRS Direct Pay"));
  checkTrue("G2 reminder cites the $ amount", r.reminders[0].includes("$6,540"));
}

// ════════════════════════════════════════════════════════════════════════════
// G3 — Prior-year harbor BINDS (100%). Prior tax $20,000 (< 90%-current $26,160)
//   with prior AGI $110,000 (< $150k → 100%). target = $20,000.
//   toCover = $20,000; per quarter = round(20000/4) = $5,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2024-01-10",
    priorYearTax: 20000,
    priorYearAgi: 110000,
  });
  check("G3 safeHarborTarget $20,000 (100% prior < 90% current)", r.safeHarborTarget, 20000);
  checkStr("G3 basis 100%_prior", r.safeHarborBasis, "100%_prior");
  check("G3 Q1 amount $5,000", r.vouchers[0].amount, 5000);
  check("G3 totalRequired $20,000", r.totalRequired, 20000);
}

// ════════════════════════════════════════════════════════════════════════════
// G4 — Prior-year AGI > $150k → 110% harbor (§6654(d)(1)(C)). Prior tax $20,000,
//   prior AGI $200,000 → harbor 110% × 20,000 = $22,000 (still < 90%-current).
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2024-01-10",
    priorYearTax: 20000,
    priorYearAgi: 200000,
  });
  check("G4 safeHarborTarget $22,000 (110% × prior)", r.safeHarborTarget, 22000);
  checkStr("G4 basis 110%_prior", r.safeHarborBasis, "110%_prior");
  check("G4 Q1 amount $5,500 (22000/4)", r.vouchers[0].amount, 5500);
}

// ════════════════════════════════════════════════════════════════════════════
// G5 — MFS 110% trigger is HALVED to $75,000 (§6654(d)(1)(C)).
//   MFS, prior tax $5,000. AGI $80,000 (> $75k MFS) → 110% → $5,500.
//   AGI $70,000 (< $75k) → 100% → $5,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const mfsInputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [{ adjustmentType: "self_employment_income", amount: 120000 }],
    taxYear: 2024,
  };
  const mfsReturn = computeTaxReturnPure(mfsInputs);
  const over = runQuarterlyAutopilot({
    baselineInputs: mfsInputs,
    baselineReturn: mfsReturn,
    asOfDate: "2024-01-10",
    priorYearTax: 5000,
    priorYearAgi: 80000,
  });
  checkStr("G5 MFS AGI $80k → 110%_prior", over.safeHarborBasis, "110%_prior");
  check("G5 MFS target $5,500 (110% × 5,000)", over.safeHarborTarget, 5500);
  const under = runQuarterlyAutopilot({
    baselineInputs: mfsInputs,
    baselineReturn: mfsReturn,
    asOfDate: "2024-01-10",
    priorYearTax: 5000,
    priorYearAgi: 70000,
  });
  checkStr("G5 MFS AGI $70k → 100%_prior", under.safeHarborBasis, "100%_prior");
  check("G5 MFS target $5,000 (100% × 5,000)", under.safeHarborTarget, 5000);
}

// ════════════════════════════════════════════════════════════════════════════
// G6 — FEED ANNUALIZATION. Empty baseline; feed = 6 months of $60,000 net SE.
//   Annualized ×(12/6)=×2 → $120,000 net SE → SAME as seReturn → §6654 tax
//   $29,067, harbor $26,160. Confirms the ×12/months annualization + projection.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: feedBaseInputs,
    baselineReturn: feedBaseReturn,
    asOfDate: "2024-07-15",
    feed: { asOfDate: "2024-06-30", ytdNetSelfEmployment: 60000, monthsElapsed: 6 },
  });
  check("G6 projectedAnnualIncome $120,000 (60k × 12/6)", r.projectedAnnualIncome, 120000);
  check("G6 projectedAnnualTax $29,067", r.projectedAnnualTax, 29067);
  check("G6 safeHarborTarget $26,160", r.safeHarborTarget, 26160);
  check("G6 totalRequired $26,160 (year total NOT inflated)", r.totalRequired, 26160);
}

// ════════════════════════════════════════════════════════════════════════════
// G7 — FEED: 3 months of $30,000 wages + $4,500 W/H → ×4 → $120,000 wages +
//   $18,000 W/H → 2024 tax $18,339, harbor $16,505; W/H $18,000 ≥ $16,505 →
//   withholding COVERS the harbor → $0 estimates, single "no estimates" reminder.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: feedBaseInputs,
    baselineReturn: feedBaseReturn,
    asOfDate: "2024-04-30",
    feed: { asOfDate: "2024-03-31", ytdWages: 30000, ytdFederalWithheld: 4500, monthsElapsed: 3 },
  });
  check("G7 projectedAnnualIncome $120,000 (30k × 4)", r.projectedAnnualIncome, 120000);
  check("G7 safeHarborTarget $16,505 (90% of 18,339)", r.safeHarborTarget, 16505);
  check("G7 totalRequired $0 (W/H $18k covers harbor)", r.totalRequired, 0);
  check("G7 remainingToPay $0", r.remainingToPay, 0);
  checkTrue("G7 nextVoucher null", r.nextVoucher === null);
  check("G7 single reminder", r.reminders.length, 1);
  checkTrue("G7 reminder says no estimates required", r.reminders[0].includes("no quarterly estimated payments are required"));
}

// ════════════════════════════════════════════════════════════════════════════
// G8 — PAYMENT + STATUS. target $26,160, base $6,540 each. As-of 2024-05-01:
//   Q1 (Apr 15) PASSED, Q2/Q3/Q4 open. Q1 paid $6,540 in full.
//   → Q1 paid, Q2 due, Q3/Q4 upcoming. nextVoucher = Q2.
//   openRequirement = 26160 − Q1base 6540 − paidOnOpen 0 = 19620 over 3 = $6,540.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2024-05-01",
    paymentsByQuarter: [6540, 0, 0, 0],
  });
  checkStr("G8 Q1 status paid", r.vouchers[0].status, "paid");
  check("G8 Q1 remainingDue $0", r.vouchers[0].remainingDue, 0);
  checkStr("G8 Q2 status due", r.vouchers[1].status, "due");
  checkStr("G8 Q3 status upcoming", r.vouchers[2].status, "upcoming");
  check("G8 Q2 amount $6,540", r.vouchers[1].amount, 6540);
  checkTrue("G8 nextVoucher = Q2", r.nextVoucher?.quarter === 2);
  check("G8 totalPaidToDate $6,540", r.totalPaidToDate, 6540);
  check("G8 remainingToPay $19,620", r.remainingToPay, 19620);
  check("G8 totalRequired stays $26,160", r.totalRequired, 26160);
}

// ════════════════════════════════════════════════════════════════════════════
// G9 — PASSED-QUARTER UNDERPAYMENT → OVERDUE (not silently re-piled). As-of
//   2024-05-01, Q1 PASSED with only $4,000 of its $6,540 paid.
//   → Q1 OVERDUE, remainingDue = 6540 − 4000 = $2,540. Open Q2/Q3/Q4 stay at base
//   $6,540 (openRequirement = 26160 − 6540 − 0 = 19620 / 3). Year total unchanged.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2024-05-01",
    paymentsByQuarter: [4000, 0, 0, 0],
  });
  checkStr("G9 Q1 OVERDUE", r.vouchers[0].status, "overdue");
  check("G9 Q1 remainingDue $2,540", r.vouchers[0].remainingDue, 2540);
  checkStr("G9 Q2 due (soonest open)", r.vouchers[1].status, "due");
  check("G9 Q2 amount $6,540 (open base unchanged)", r.vouchers[1].amount, 6540);
  check("G9 totalRequired $26,160 (NOT inflated by the missed quarter)", r.totalRequired, 26160);
  // nextVoucher prefers the soonest OPEN unpaid (Q2), even though Q1 is overdue.
  checkTrue("G9 nextVoucher = Q2 (soonest open)", r.nextVoucher?.quarter === 2);
  // An overdue reminder is emitted for Q1.
  checkTrue("G9 a reminder flags Q1 OVERDUE", r.reminders.some((s) => s.includes("Q1") && s.includes("OVERDUE")));
}

// ════════════════════════════════════════════════════════════════════════════
// G10 — OPEN-QUARTER OVERPAYMENT shrinks the remaining open vouchers (catch-up
//   re-split). As-of 2024-08-01, Q1+Q2 PASSED+paid $6,540 each ($13,080). Q3
//   (open) prepaid $10,000. openRequirement = 26160 − passedBase 13080 −
//   paidOnOpen 10000 = $3,080 over Q3,Q4 → $1,540 each share.
//   Q3 amount = 1540 + its $10,000 payment = $11,540, remainingDue $1,540.
//   Q4 amount $1,540. remainingToPay = 26160 − 23080 paid = $3,080.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2024-08-01",
    paymentsByQuarter: [6540, 6540, 10000, 0],
  });
  check("G10 Q3 amount $11,540 (share + its payment)", r.vouchers[2].amount, 11540);
  check("G10 Q3 remainingDue $1,540", r.vouchers[2].remainingDue, 1540);
  check("G10 Q4 amount $1,540 (catch-up share)", r.vouchers[3].amount, 1540);
  check("G10 totalPaidToDate $23,080", r.totalPaidToDate, 23080);
  check("G10 remainingToPay $3,080", r.remainingToPay, 3080);
  check("G10 totalRequired $26,160", r.totalRequired, 26160);
}

// ════════════════════════════════════════════════════════════════════════════
// G11 — ALL FOUR OVERDUE (past every due date, nothing paid). As-of 2026-03-01.
//   Each $6,540 overdue; nextVoucher = soonest overdue (Q1).
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2026-03-01",
  });
  checkTrue("G11 all four overdue", r.vouchers.every((v) => v.status === "overdue"));
  checkTrue("G11 nextVoucher = Q1 (soonest overdue)", r.nextVoucher?.quarter === 1);
  checkStr("G11 nextVoucher status overdue", r.nextVoucher?.status ?? "", "overdue");
  check("G11 remainingToPay $26,160", r.remainingToPay, 26160);
}

// ════════════════════════════════════════════════════════════════════════════
// G12 — FULLY PAID. All four installments paid $6,540 each. No next voucher;
//   the "all paid" reminder fires.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2026-03-01",
    paymentsByQuarter: [6540, 6540, 6540, 6540],
  });
  checkTrue("G12 all four paid", r.vouchers.every((v) => v.status === "paid"));
  checkTrue("G12 nextVoucher null", r.nextVoucher === null);
  check("G12 remainingToPay $0", r.remainingToPay, 0);
  check("G12 totalPaidToDate $26,160", r.totalPaidToDate, 26160);
  checkTrue("G12 'paid in full' reminder", r.reminders.some((s) => s.includes("paid in full")));
}

// ════════════════════════════════════════════════════════════════════════════
// G13 — PURITY / DETERMINISM. The same args yield byte-identical results, and
//   the as-of date is purely a PARAMETER (no wall clock). Also assert all output
//   numbers are finite (Haven-portable totality).
// ════════════════════════════════════════════════════════════════════════════
{
  const args = {
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2024-05-01",
    paymentsByQuarter: [6540, 0, 0, 0],
  };
  const r1 = runQuarterlyAutopilot(args);
  const r2 = runQuarterlyAutopilot(args);
  checkTrue("G13 deterministic (same JSON twice)", JSON.stringify(r1) === JSON.stringify(r2));
  checkTrue(
    "G13 all voucher numbers finite",
    r1.vouchers.every(
      (v) => Number.isFinite(v.amount) && Number.isFinite(v.remainingDue) && Number.isFinite(v.alreadyPaid),
    ),
  );
  checkTrue(
    "G13 headline numbers finite",
    [r1.safeHarborTarget, r1.projectedAnnualTax, r1.totalRequired, r1.remainingToPay].every(Number.isFinite),
  );
  checkTrue("G13 assumptions disclosed", r1.assumptions.length >= 3);
  // The as-of date echoes back unchanged (it's a pure parameter).
  checkStr("G13 asOfDate echoed", r1.asOfDate, "2024-05-01");
}

// ════════════════════════════════════════════════════════════════════════════
// G14 — ROUNDING REMAINDER lands on Q4. Construct a target whose /4 is not whole:
//   prior tax $10,002 binds (100%, AGI < $150k) → toCover $10,002.
//   perQuarter = round(10002/4) = round(2500.5) = 2500 (banker-ish round-half;
//   JS Math.round(2500.5)=2501). Q4 remainder = 10002 − perQuarter×3.
//   Assert the four sum EXACTLY to $10,002 regardless of the per-quarter rounding.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = runQuarterlyAutopilot({
    baselineInputs: seInputs,
    baselineReturn: seReturn,
    asOfDate: "2024-01-10",
    priorYearTax: 10002,
    priorYearAgi: 100000,
  });
  check("G14 target $10,002", r.safeHarborTarget, 10002);
  const sum = r.vouchers.reduce((s, v) => s + v.amount, 0);
  check("G14 four vouchers sum EXACTLY to $10,002", sum, 10002);
  check("G14 totalRequired $10,002", r.totalRequired, 10002);
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
