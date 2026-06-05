/**
 * P2-1 — Form 8582 per-activity passive-loss worksheet. Hand-calc'd. NO API.
 *
 * The §469(i) $25k allowance is a single PER-TAXPAYER cap; Form 8582 nets the
 * activities, applies the allowance, then ratably allocates the suspended loss
 * back to each loss activity by its share of gross loss (Worksheet 5). The
 * aggregate tax result is unchanged — these tests verify the allocation is exact
 * and consistent with the aggregate PAL result.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-form8582-tests.ts
 */
import { computeTaxReturnPure, type TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }

type Prop = { taxYear: number; address: string; rentalIncome: number; totalExpenses: number; basis?: number; placedInServiceYear?: number; placedInServiceMonth?: number; propertyType?: string };
const run = (filingStatus: string, wages: number, props: Prop[], rep = false): ReturnType<typeof computeTaxReturnPure> =>
  computeTaxReturnPure({
    client: { filingStatus, state: "FL", taxYear: 2024, rentalActiveParticipant: true, rentalRealEstateProfessional: rep },
    w2s: [{ taxYear: 2024, wagesBox1: wages, stateCode: "FL" }],
    form1099s: [], adjustments: [],
    rentalProperties: props,
    taxYear: 2024,
  } as TaxReturnInputs);

// ════════════════════════════════════════════════════════════════════════════
// 1. Mid-phase-out: 2 loss + 1 income property; allowance partially phased out
// ════════════════════════════════════════════════════════════════════════════
header("Mid-phase-out: ratable suspended-loss allocation");
{
  // MFJ MAGI $130k → allowance = 25k − (130k−100k)×0.5 = $10k.
  // A net −20k, B net −10k, C net +12k → aggregate −18k.
  // allowed loss = min(18k, 10k) = 10k; suspended = 8k.
  // Allocate 8k to A/B by gross-loss share: A 8k×20/30=5,333.33; B 8k×10/30=2,666.67.
  const r = run("married_filing_jointly", 130000, [
    { taxYear: 2024, address: "A", rentalIncome: 10000, totalExpenses: 30000 },
    { taxYear: 2024, address: "B", rentalIncome: 5000, totalExpenses: 15000 },
    { taxYear: 2024, address: "C", rentalIncome: 20000, totalExpenses: 8000 },
  ]);
  check("aggregate net = −$18,000", r.scheduleERentalGrossNet, -18000, 1);
  check("PAL allowance after phase-out = $10,000", r.passiveActivityLoss?.allowanceAfterPhaseOut ?? -1, 10000, 1);
  check("PAL allowed = $10,000", r.passiveActivityLoss?.allowedThisYear ?? -1, 10000, 1);
  check("PAL suspended = $8,000", r.passiveActivityLoss?.suspendedToNextYear ?? -1, 8000, 1);
  const a = r.form8582!.activities;
  check("A suspended $5,333.33", a[0].suspendedToNextYear, 5333.333, 0.01);
  check("B suspended $2,666.67", a[1].suspendedToNextYear, 2666.667, 0.01);
  check("C suspended $0 (income)", a[2].suspendedToNextYear, 0, 0.01);
  check("A allowed (signed) −$14,666.67", a[0].allowedThisYear, -14666.667, 0.01);
  check("C allowed +$12,000", a[2].allowedThisYear, 12000, 0.01);
  // INVARIANT: allocated allowed sums to the aggregate allowed (−$10k); suspended to $8k.
  const sumAllowed = a.reduce((s, x) => s + x.allowedThisYear, 0);
  const sumSusp = a.reduce((s, x) => s + x.suspendedToNextYear, 0);
  check("Σ allowed = −$10,000 (= aggregate)", sumAllowed, -10000, 0.01);
  check("Σ suspended = $8,000 (= aggregate)", sumSusp, 8000, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Fully suspended (MAGI > $150k → allowance $0)
// ════════════════════════════════════════════════════════════════════════════
header("Fully suspended: MAGI over the phase-out ceiling");
{
  // MFJ MAGI $200k → allowance $0. A −20k, B −10k → all $30k suspended.
  const r = run("married_filing_jointly", 200000, [
    { taxYear: 2024, address: "A", rentalIncome: 10000, totalExpenses: 30000 },
    { taxYear: 2024, address: "B", rentalIncome: 5000, totalExpenses: 15000 },
  ]);
  check("PAL allowed = $0", r.passiveActivityLoss?.allowedThisYear ?? -1, 0, 1);
  check("PAL suspended = $30,000", r.passiveActivityLoss?.suspendedToNextYear ?? -1, 30000, 1);
  const a = r.form8582!.activities;
  check("A suspended $20,000 (full)", a[0].suspendedToNextYear, 20000, 1);
  check("B suspended $10,000 (full)", a[1].suspendedToNextYear, 10000, 1);
  check("A allowed $0", a[0].allowedThisYear, 0, 1);
  check("total suspended $30,000", r.form8582!.totalSuspended, 30000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Net rental income → no suspension, all allowed
// ════════════════════════════════════════════════════════════════════════════
header("Net income: no PAL, all activities allowed");
{
  const r = run("married_filing_jointly", 130000, [
    { taxYear: 2024, address: "A", rentalIncome: 30000, totalExpenses: 10000 }, // +20k
    { taxYear: 2024, address: "B", rentalIncome: 5000, totalExpenses: 15000 },  // −10k
  ]);
  // aggregate +10k → no PAL; both allowed at their net, 0 suspended.
  check("aggregate net = +$10,000", r.scheduleERentalGrossNet, 10000, 1);
  check("no PAL result (null)", r.passiveActivityLoss === null ? 1 : 0, 1);
  check("total suspended $0", r.form8582!.totalSuspended, 0, 1);
  check("A allowed +$20,000", r.form8582!.activities[0].allowedThisYear, 20000, 1);
  check("B allowed −$10,000 (offset by A's income)", r.form8582!.activities[1].allowedThisYear, -10000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. Real-estate professional → full deduction, no suspension
// ════════════════════════════════════════════════════════════════════════════
header("Real-estate professional: no $25k cap");
{
  const r = run("married_filing_jointly", 200000, [
    { taxYear: 2024, address: "A", rentalIncome: 10000, totalExpenses: 30000 },
    { taxYear: 2024, address: "B", rentalIncome: 5000, totalExpenses: 15000 },
  ], true);
  check("REP allowed = $30,000 (full loss)", r.passiveActivityLoss?.allowedThisYear ?? -1, 30000, 1);
  check("REP suspended = $0", r.passiveActivityLoss?.suspendedToNextYear ?? -1, 0, 1);
  check("8582 total suspended $0", r.form8582!.totalSuspended, 0, 1);
  check("A allowed −$20,000 (full)", r.form8582!.activities[0].allowedThisYear, -20000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Per-property MACRS flows into the net
// ════════════════════════════════════════════════════════════════════════════
header("Per-property MACRS reduces the property net");
{
  // Residential, basis $275,000, placed Jan 2024 → MACRS yr-1 (mid-month, 3.485%)
  // = $9,583.75. Net = income $20,000 − expenses $8,000 − $9,583.75 = $2,416.25.
  const r = run("single", 80000, [
    { taxYear: 2024, address: "A", rentalIncome: 20000, totalExpenses: 8000, basis: 275000, placedInServiceYear: 2024, placedInServiceMonth: 1, propertyType: "residential" },
  ]);
  check("property net = $2,416.25 (income − expenses − MACRS)", r.form8582!.activities[0].netIncome, 2416.25, 0.5);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log(f); process.exit(1); }
console.log("ALL FORM 8582 TESTS GREEN");
