/**
 * ROUND-5 FULL-APP AUDIT — uncommon / interaction-heavy golden regression locks
 * (2026-06-25). Each expected value is HAND-DERIVED from the IRS rule FIRST, then
 * confirmed against computeTaxReturnPure. These pin the hard corners where engine
 * bugs hide (cross-tax interactions), complementing the common-path golden suites.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-irs-golden-v3-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) passed++;
  else { failed++; failures.push(`  X ${label}: expected ${expected}±${tol}, got ${actual}`); }
}
function header(t: string): void { console.log(`\n-- ${t} --`); }
const run = (i: any) => computeTaxReturnPure(i as TaxReturnInputs);

// ════════════════════════════════════════════════════════════════════════════
// EXCESS-SS (MFJ per-spouse) — the per-employer cap is applied PER SPOUSE, then
// each spouse's excess is summed. Pooling across spouses would over-refund.
// 2024 per-person SS max withheld = 6.2% × $168,600 = $10,453.20.
// ════════════════════════════════════════════════════════════════════════════
header("EXCESS-SS MFJ — per-spouse, not pooled");
{
  // Each spouse has 2 employers each withholding $6,200 → $12,400/spouse.
  // Per spouse excess = $12,400 − $10,453.20 = $1,946.80; ×2 spouses = $3,893.60.
  // (Pooling all 4 W-2s would give $24,800 − $10,453.20 = $14,346.80 — WRONG.)
  const w2 = (n: string, sp: "taxpayer" | "spouse") =>
    ({ taxYear: 2024, wagesBox1: 100000, socialSecurityWagesBox3: 100000, socialSecurityTaxBox4: 6200, employerName: n, stateCode: "FL", spouse: sp });
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [w2("A", "taxpayer"), w2("B", "taxpayer"), w2("C", "spouse"), w2("D", "spouse")], form1099s: [], adjustments: [], taxYear: 2024 });
  check("MFJ excess-SS = 2 × ($12,400 − $10,453.20) = $3,893.60", r.excessSocialSecurityCredit, 3893.60);
}

// ════════════════════════════════════════════════════════════════════════════
// SS BENEFIT TAXABILITY (Pub 915) — the two boundary regimes.
// ════════════════════════════════════════════════════════════════════════════
header("SS taxability — MFS-lived-with-spouse 85% + single 85% cap");
{
  // MFS who lived WITH spouse: base amounts = $0 → 85% from the first dollar.
  // SS $20,000 + $10,000 interest. Provisional $20,000. taxable = min(0.85×20k,
  // 0.85×(20k−0)) = $17,000.
  const r1 = run({ client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024, socialSecurityBenefits: 20000, mfsLivedApartAllYear: false },
    w2s: [], form1099s: [{ formType: "int", interestIncome: 10000 }], adjustments: [], taxYear: 2024 });
  check("MFS-lived-with-spouse: 85% of $20k SS = $17,000 taxable", r1.socialSecurityTaxable, 17000);

  // Single, SS $30,000 + a $50,000 pension distribution drives provisional far
  // over $34,000 → the 85% ceiling binds: taxable = 0.85 × $30,000 = $25,500.
  // AGI = $50,000 + $25,500 = $75,500.
  const r2 = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024, socialSecurityBenefits: 30000 },
    w2s: [], form1099s: [{ formType: "r", grossDistribution: 50000, taxableAmount: 50000 }], adjustments: [], taxYear: 2024 });
  check("Single 85% cap: taxable SS = $25,500", r2.socialSecurityTaxable, 25500);
  check("Single AGI = $50k dist + $25.5k SS = $75,500", r2.adjustedGrossIncome, 75500);
}

// ════════════════════════════════════════════════════════════════════════════
// CAPITAL LOSS — Schedule D netting + §1211(b) $3,000 / $1,500-MFS ordinary
// offset + character-preserving carryforward.
// ════════════════════════════════════════════════════════════════════════════
header("Capital loss — netting + $3k/$1.5k-MFS offset + carryforward");
{
  // STCL −$10,000 nets with LTCG +$4,000 → net STCL −$6,000. $3,000 offsets
  // ordinary income; $3,000 short-term loss carries forward.
  const tx = [{ proceeds: 0, costBasis: 10000, formBox: "A", taxYear: 2024 }, { proceeds: 14000, costBasis: 10000, formBox: "D", taxYear: 2024 }];
  const r = run({ client: { filingStatus: "single", state: "TX", taxYear: 2024 }, w2s: [{ wagesBox1: 80000 }], form1099s: [], capitalTransactions: tx, adjustments: [], taxYear: 2024 });
  check("Single: $3,000 ordinary offset", r.capitalLossDeducted, 3000);
  check("Single: $3,000 ST carryforward", (r as any).capitalLossCarryforwardShort, 3000);
  const rM = run({ client: { filingStatus: "married_filing_separately", state: "TX", taxYear: 2024 }, w2s: [{ wagesBox1: 80000 }], form1099s: [], capitalTransactions: tx, adjustments: [], taxYear: 2024 });
  check("MFS: $1,500 ordinary offset", rM.capitalLossDeducted, 1500);
  check("MFS: $4,500 ST carryforward", (rM as any).capitalLossCarryforwardShort, 4500);
}

// ════════════════════════════════════════════════════════════════════════════
// FEIE (§911) × SE tax × Additional Medicare × NIIT — the stacking corners.
// FEIE excludes for INCOME tax but NOT SE tax (§1402); NIIT MAGI adds FEIE back
// (§1411(d)); Form 8959 0.9% applies to SE earnings over the threshold.
// ════════════════════════════════════════════════════════════════════════════
header("FEIE × SE × Add'l-Medicare × NIIT stacking");
{
  // SE NEC $250,000 → SE net earnings $230,875 (×0.9235). FEIE $126,500.
  //  SE tax = 12.4%×min($230,875,$168,600) + 2.9%×$230,875
  //         = $20,906.40 + $6,695.375 = $27,601.775  (FEIE does NOT reduce it).
  //  Add'l Medicare = 0.9% × ($230,875 − $200,000) = $277.875.
  //  NIIT = 3.8% × $50,000 NII (MAGI incl. FEIE add-back ≫ $200k) = $1,900.
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 }, w2s: [],
    form1099s: [{ formType: "nec", nonemployeeCompensation: 250000 }, { formType: "int", interestIncome: 50000 }],
    adjustments: [{ adjustmentType: "foreign_earned_income", amount: 126500, isApplied: true }], taxYear: 2024 });
  check("SE tax unreduced by FEIE = $27,601.78", r.selfEmploymentTax, 27601.775, 0.02);
  check("Add'l Medicare on SE = $277.88", r.additionalMedicareTax, 277.875, 0.02);
  check("NIIT = 3.8% × $50k (MAGI incl. FEIE add-back) = $1,900", r.niitTax, 1900);
}

// ════════════════════════════════════════════════════════════════════════════
// KIDDIE TAX (Form 8615) — TY2025 threshold is $2,700 (was $2,600 in 2024).
// ════════════════════════════════════════════════════════════════════════════
header("Kiddie tax — TY2025 $2,700 threshold");
{
  // 2025 dependent, $12,000 interest, no earned income; parent top rate 24%.
  //  Dependent std ded (no earned income) = $1,350 → taxable $10,650.
  //  Net unearned over $2,700 = $12,000 − $2,700 = $9,300 @ parent 24% = $2,232;
  //  remaining $10,650 − $9,300 = $1,350 @ child 10% = $135; total = $2,367.
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2025, isKiddieTaxFiler: true, parentsTopMarginalRate: "0.24" },
    w2s: [], form1099s: [{ formType: "int", interestIncome: 12000 }], adjustments: [], taxYear: 2025 });
  check("Form 8615 TY2025 dependent taxable = $10,650", r.taxableIncome, 10650);
  check("Form 8615 TY2025 kiddie tax = $9,300@24% + $1,350@10% = $2,367", r.federalTaxLiability, 2367);
}

// ── Summary ──
console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) { for (const f of failures) console.log(f); process.exit(1); }
console.log("ALL ROUND-5 UNCOMMON-SCENARIO GOLDEN ASSERTIONS PASS");
