/**
 * T2.2 D1 — MFJ-vs-MFS filing-status optimizer tests.
 *
 * Pure (no API). HAND-CALC'D headline values against the 2024 brackets +
 * Schedule A medical 7.5%-AGI floor + the §63(c)(6)(A) itemized coupling.
 * The doubled-bracket symmetry (MFJ == 2×MFS for equal earners) and a genuine
 * MFS-win (high medical on the lower-income spouse) are both pinned.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-filing-status-optimizer-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { optimizeFilingStatus } from "../../artifacts/api-server/src/lib/filingStatusOptimizer";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkStr(label: string, actual: string, expected: string): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected "${expected}", got "${actual}"`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

function optimize(inputs: TaxReturnInputs) {
  const ret = computeTaxReturnPure(inputs);
  return optimizeFilingStatus({ jointInputs: inputs, jointReturn: ret });
}

// ════════════════════════════════════════════════════════════════════════════
// S1 — Symmetric two-earner couple ($80k each, tagged), FL. MFJ == MFS exactly.
//   MFJ $160k: std $29,200 → taxable $130,800 → 2,320 + 71,100×12% + 36,500×22%
//     = 2,320 + 8,532 + 8,030 = $18,882.
//   Each MFS $80k: std $14,600 → taxable $65,400 → 1,160 + 35,550×12% +
//     18,250×22% = 1,160 + 4,266 + 4,015 = $9,441 → combined $18,882.
//   The doubled-bracket symmetry holds to the dollar → recommend MFJ (tie), $0.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [
      { taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 10000, spouse: "taxpayer" },
      { taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 10000, spouse: "spouse" },
    ],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const o = optimize(inputs)!;
  checkTrue("S1 optimizer applies (MFJ baseline)", o !== null);
  check("S1 MFJ net tax $18,882", o.mfj.netTaxAfterCredits, 18882);
  check("S1 MFS taxpayer net $9,441", o.mfs.taxpayer.netTaxAfterCredits, 9441);
  check("S1 MFS spouse net $9,441", o.mfs.spouse.netTaxAfterCredits, 9441);
  check("S1 MFS combined net $18,882 (= MFJ)", o.mfs.combinedNetTaxAfterCredits, 18882);
  checkStr("S1 recommend MFJ (tie)", o.recommendation, "mfj");
  check("S1 savings $0", o.savings, 0);
  checkTrue("S1 spouse tags present", o.assumptions.spouseTagsPresent);
  checkTrue("S1 no itemized coupling (both standard)", !o.assumptions.itemizedCouplingApplied);
  // Identity: combined = taxpayer + spouse.
  check("S1 combined = taxpayer + spouse", o.mfs.combinedNetTaxAfterCredits,
    o.mfs.taxpayer.netTaxAfterCredits + o.mfs.spouse.netTaxAfterCredits);
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — MFS WINS: A $70k (mortgage $25k), B $35k (medical $30k), FL. Both itemize
//   independently (no coupling penalty); B's lower 7.5%-floor frees more medical.
//   MFJ $105k: medical floor 7.5%×105k=7,875 → 22,125; + mortgage 25,000 =
//     47,125 itemized → taxable 57,875 → 2,320 + 34,675×12% = $6,481.
//   MFS-A $70k: itemize mortgage 25,000 → taxable 45,000 → 1,160 + 33,400×12%
//     = $5,168.  MFS-B $35k: medical floor 7.5%×35k=2,625 → 27,375 → taxable
//     7,625 → 10% = $762.50.  Combined MFS = $5,930.50 → MFS saves $550.50.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [
      { taxYear: 2024, wagesBox1: 70000, federalTaxWithheldBox2: 0, spouse: "taxpayer" },
      { taxYear: 2024, wagesBox1: 35000, federalTaxWithheldBox2: 0, spouse: "spouse" },
    ],
    form1099s: [],
    adjustments: [
      { adjustmentType: "mortgage_interest", amount: 25000, isApplied: true, spouse: "taxpayer" },
      { adjustmentType: "medical_expenses", amount: 30000, isApplied: true, spouse: "spouse" },
    ],
    taxYear: 2024,
  };
  const o = optimize(inputs)!;
  check("S2 MFJ net tax $6,481", o.mfj.netTaxAfterCredits, 6481);
  check("S2 MFS-A net $5,168", o.mfs.taxpayer.netTaxAfterCredits, 5168);
  check("S2 MFS-B net $762.50", o.mfs.spouse.netTaxAfterCredits, 762.5);
  check("S2 MFS combined $5,930.50", o.mfs.combinedNetTaxAfterCredits, 5930.5);
  checkStr("S2 recommend MFS", o.recommendation, "mfs");
  check("S2 savings $550.50", o.savings, 550.5);
  checkTrue("S2 no coupling (both itemize independently)", !o.assumptions.itemizedCouplingApplied);
  checkTrue("S2 both MFS returns itemize", o.mfs.taxpayer.itemized && o.mfs.spouse.itemized);
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — MFJ WINS + §63(c)(6)(A) coupling. A $220k, B $30k (medical $22k), FL.
//   MFJ $250k: medical floor 7.5%×250k=18,750 → $3,250 deductible; alone < std
//     $29,200 → standard → taxable 220,800.
//   MFJ 2024 tax: 2,320 + 71,100×12% + 107,650×22% + 18,850×24% =
//     2,320 + 8,532 + 23,683 + 4,524 = $39,059 (engine rounds line-by-line).
//   On MFS, B itemizes the medical but A has nothing → §63(c)(6)(A) forces A to
//   itemize $0, blowing up A's taxable. MFS loses badly → recommend MFJ.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [
      { taxYear: 2024, wagesBox1: 220000, federalTaxWithheldBox2: 40000, spouse: "taxpayer" },
      { taxYear: 2024, wagesBox1: 30000, federalTaxWithheldBox2: 2000, spouse: "spouse" },
    ],
    form1099s: [],
    adjustments: [{ adjustmentType: "medical_expenses", amount: 22000, isApplied: true, spouse: "spouse" }],
    taxYear: 2024,
  };
  const o = optimize(inputs)!;
  checkStr("S3 recommend MFJ", o.recommendation, "mfj");
  checkTrue("S3 §63(c)(6)(A) coupling applied (one itemizes → both forced)", o.assumptions.itemizedCouplingApplied);
  checkTrue("S3 MFS combined > MFJ (coupling penalty)", o.mfs.combinedNetTaxAfterCredits > o.mfj.netTaxAfterCredits);
  check("S3 positive savings from MFJ", o.savings, o.mfs.combinedNetTaxAfterCredits - o.mfj.netTaxAfterCredits);
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — No spouse tags: all income defaults to the primary taxpayer; the spouse
//   MFS return is empty. The optimizer flags the assumption.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 150000, federalTaxWithheldBox2: 20000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const o = optimize(inputs)!;
  checkTrue("S4 spouseTagsPresent = false", !o.assumptions.spouseTagsPresent);
  checkTrue("S4 a note warns about the untagged split",
    o.assumptions.notes.some((n) => n.includes("No per-spouse income tags")));
  check("S4 spouse MFS return has $0 income", o.mfs.spouse.totalIncome, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — Null gate: non-MFJ baselines return null.
// ════════════════════════════════════════════════════════════════════════════
{
  for (const fs of ["single", "head_of_household", "married_filing_separately"]) {
    const inputs: TaxReturnInputs = {
      client: { filingStatus: fs, state: "FL", taxYear: 2024 },
      w2s: [{ taxYear: 2024, wagesBox1: 80000 }],
      form1099s: [],
      adjustments: [],
      taxYear: 2024,
    };
    checkTrue(`S5 ${fs} → null (not MFJ)`, optimize(inputs) === null);
  }
}

console.log(`\nT2.2 — MFJ-vs-MFS filing-status optimizer:`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
