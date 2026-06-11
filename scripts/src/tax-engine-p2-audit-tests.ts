/**
 * Deep-audit regression suite — FEATURE INTERACTIONS across the P2 additions.
 *
 * The per-feature unit suites test each P2 item in isolation; these lock the
 * INTERACTIONS (where bugs hide), each hand-verified against IRS/state rules
 * during the 2026-06 deep audit. The audit also caught + fixed a real
 * §199A loss-netting bug (locked in tax-engine-qbi-per-business-tests.ts).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-p2-audit-tests.ts
 */
import { computeTaxReturnPure, type TaxReturnInputs, type AdjustmentFact } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

// S1 — §1202 50% exclusion (P2-6) + MN resident (P2-2): the §57(a)(7) preference
// feeds MN AMT, but MN's 9.85% regular tax exceeds the 6.75% AMT here → no delta.
header("S1: §1202 50% + MN AMT (no delta — regular > tentative)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "MN", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [A("qsbs_gross_gain", 5_000_000), A("qsbs_adjusted_basis", 0), A("qsbs_exclusion_pct", 50)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("AGI = $2.5M (50% of $5M taxable)", r.adjustedGrossIncome, 2_500_000, 1);
  check("§1202 excluded $2.5M", r.qsbsSection1202Exclusion, 2_500_000, 1);
  check("§1202 taxable $2.5M", r.qsbsTaxableGain, 2_500_000, 1);
}

// S2 — QBI per-business (P2-4) + NOL + SSTB: SSTB phased to $0 (taxable > band),
// non-SSTB wage-limited to $25k. NOL $50k fully used (< 80% of taxable).
header("S2: QBI per-business + NOL + SSTB");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [], adjustments: [A("nol_carryforward", 50000)],
    scheduleK1: [
      { taxYear: 2024, entityType: "s_corp", activityType: "active", box1OrdinaryIncome: 300000, section199aQbi: 300000, section199aW2Wages: 50000 },
      { taxYear: 2024, entityType: "s_corp", activityType: "active", isSstb: true, box1OrdinaryIncome: 100000, section199aQbi: 100000, section199aW2Wages: 100000 },
    ],
    taxYear: 2024,
  } as TaxReturnInputs);
  // RE-DERIVED 2026-06-11 (T1.0c #3): the §172 NOL is a Sch 1 line 8a AGI
  // deduction — AGI = 400,000 − 50,000 = 350,000. The 80% cap base (taxable
  // w/o NOL/QBI = 385,400) is unaffected, so the NOL is still fully used; the
  // QBI numbers are unchanged (post-NOL taxable 335,400 is still above the
  // single SSTB band top of $241,950 → SSTB $0, non-SSTB wage-limited $25k).
  check("AGI $350k (post-NOL — Sch 1 line 8a)", r.adjustedGrossIncome, 350000, 1);
  check("NOL deduction $50k", r.nolDeduction, 50000, 1);
  check("QBI = $25k (non-SSTB wage-limited; SSTB → $0)", r.qbiDeduction, 25000, 1);
  check("perBusiness non-SSTB $25k", r.qbiPerBusiness?.[0].deductibleAmount ?? -1, 25000, 1);
  check("perBusiness SSTB $0", r.qbiPerBusiness?.[1].deductibleAmount ?? -1, 0, 1);
}

// S3 — FTC carryforward (P2-3) + CTC: multiple nonrefundable credits. §904 limit
// binds; the combined (current + carryover) excess re-carries.
header("S3: FTC carryover + CTC ordering");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 12000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("foreign_tax_paid", 4000), A("foreign_source_taxable_income", 20000), A("foreign_tax_credit_carryforward", 3000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("federal income tax $10,432", r.federalTaxLiability, 10432, 1);
  check("FTC credit $2,297.80 (§904 limit on combined $7k)", r.foreignTaxCredit.credit, 2297.80, 0.5);
  check("FTC carryforward $4,702.20", r.foreignTaxCreditCarryforwardRemaining, 4702.20, 0.5);
  check("CTC $4,000 (2 kids, no phase-out)", r.childTaxCredit.appliedCredit, 4000, 1);
}

// S4 — Form 8582 (P2-1) + NIIT: rental loss fully suspended (MAGI > $150k); NIIT
// $0 (MAGI < $250k threshold despite $50k investment income).
header("S4: Form 8582 suspension + NIIT threshold");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024, rentalActiveParticipant: true },
    w2s: [{ taxYear: 2024, wagesBox1: 130000, stateCode: "CA" }],
    form1099s: [{ taxYear: 2024, formType: "div", qualifiedDividends: 50000, ordinaryDividends: 50000 }],
    adjustments: [],
    rentalProperties: [
      { taxYear: 2024, address: "A", rentalIncome: 10000, totalExpenses: 30000 },
      { taxYear: 2024, address: "B", rentalIncome: 20000, totalExpenses: 8000 },
    ],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("AGI $180k (suspended loss doesn't reduce AGI)", r.adjustedGrossIncome, 180000, 1);
  check("NIIT $0 (MAGI < $250k)", r.niitTax, 0, 1);
  check("Form 8582 suspended $8,000", r.form8582?.totalSuspended ?? -1, 8000, 1);
  check("PAL allowed $0 (MAGI > $150k)", r.passiveActivityLoss?.allowedThisYear ?? -1, 0, 1);
}

// S7 — K-1 basis (P2-6) at-risk tighter than basis-after-distributions.
header("S7: K-1 at-risk limit < basis-after-distributions");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, stateCode: "FL" }],
    form1099s: [], adjustments: [],
    scheduleK1: [{ taxYear: 2024, entityType: "partnership", activityType: "active", box1OrdinaryIncome: -60000, basisAtYearStart: 50000, atRiskAmount: 30000, distributions: 10000 }],
    taxYear: 2024,
  } as TaxReturnInputs);
  // basis $50k − dist $10k = $40k; at-risk $30k → allowed min($60k,$40k,$30k) = $30k.
  check("AGI $170k (only $30k loss allowed)", r.adjustedGrossIncome, 170000, 1);
  check("suspended $30k (at-risk binds)", r.scheduleK1.k1BasisAtRiskLossSuspended, 30000, 1);
}

// E3 — FTC carryforward forces Form 1116 even when current-year tax < simplified $300.
header("E3: FTC carryover defeats the $300 simplified election");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("foreign_tax_paid", 200), A("foreign_tax_credit_carryforward", 5000), A("foreign_source_taxable_income", 10000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  // combined $5,200 > $300 → Form 1116; §904 limit $1,620.73 binds → carry $3,579.27.
  check("FTC credit $1,620.73 (§904 limit)", r.foreignTaxCredit.credit, 1620.73, 0.5);
  check("FTC carryforward $3,579.27", r.foreignTaxCreditCarryforwardRemaining, 3579.27, 0.5);
}

// E5 — Form 8582 single property, allowance partially phased out.
header("E5: Form 8582 single property, partial allowance");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024, rentalActiveParticipant: true },
    w2s: [{ taxYear: 2024, wagesBox1: 140000, stateCode: "FL" }],
    form1099s: [], adjustments: [],
    rentalProperties: [{ taxYear: 2024, address: "Solo", rentalIncome: 5000, totalExpenses: 30000 }],
    taxYear: 2024,
  } as TaxReturnInputs);
  // net −$25k; allowance = $25k − ($140k−$100k)×0.5 = $5k → allowed $5k, suspended $20k.
  check("PAL allowed $5,000", r.passiveActivityLoss?.allowedThisYear ?? -1, 5000, 1);
  check("Form 8582 suspended $20,000", r.form8582?.totalSuspended ?? -1, 20000, 1);
  check("single activity carries all $20,000", r.form8582?.activities[0].suspendedToNextYear ?? -1, 20000, 1);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log(f); process.exit(1); }
console.log("ALL P2 DEEP-AUDIT INTERACTION TESTS GREEN");
