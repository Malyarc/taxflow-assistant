/**
 * T1.5 #2 — Golden-test pack from IRS worked examples (the strongest authoritative oracle).
 *
 * Each block pins the engine to an IRS-PUBLISHED worked example or to a canonical
 * scenario hand-calc'd line-by-line against the published form/worksheet. Where a
 * value is the IRS's OWN printed figure it is marked [IRS-PUBLISHED]; everything
 * else is [HAND-CALC] against the cited rule. Run in CI via the no-API battery.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-golden-irs-examples-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { irsTaxTableTax } from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.02): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

function run(partial: Partial<TaxReturnInputs> & { client: TaxReturnInputs["client"] }) {
  return computeTaxReturnPure({
    w2s: [], form1099s: [], adjustments: [], taxYear: partial.client.taxYear ?? 2024,
    ...partial,
  } as TaxReturnInputs);
}

// ════════════════════════════════════════════════════════════════════════════
// A — SOCIAL SECURITY TAXABILITY · Pub 915 Social Security Benefits Worksheet.
//   [IRS-PUBLISHED] the exact filled-in examples (hand-reconciled to the rule).
// ════════════════════════════════════════════════════════════════════════════
{
  // Ex 1 (single): $28,990 other income + $5,980 SS → provisional $31,980 (50% tier)
  //   taxable = min(50%×5,980, 50%×(31,980−25,000)) = min(2,990, 3,490) = $2,990.
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024, socialSecurityBenefits: 5980 },
    w2s: [{ taxYear: 2024, wagesBox1: 28990, federalTaxWithheldBox2: 0 }] });
  check("[IRS] Pub915 Ex1 single → taxable SS $2,990", Number(r.socialSecurityTaxable), 2990);
}
{
  // Ex 3 (MFJ, SSEB $10,000 treated as SS): $40,500 other → provisional $45,500 (85% tier)
  //   taxable = min(85%×10,000, 85%×(45,500−44,000) + min(50%×10,000, 50%×(44,000−32,000)))
  //           = min(8,500, 1,275 + 5,000) = $6,275.
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024, socialSecurityBenefits: 10000 },
    w2s: [{ taxYear: 2024, wagesBox1: 40500, federalTaxWithheldBox2: 0 }] });
  check("[IRS] Pub915 Ex3 MFJ → taxable SS $6,275", Number(r.socialSecurityTaxable), 6275);
}
{
  // Ex 4 (MFS lived together): $8,000 wages + $4,000 SS → 85% forced (base 0)
  //   taxable = min(85%×4,000, 85%×10,000) = $3,400.
  const r = run({ client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024, socialSecurityBenefits: 4000, mfsLivedApartAllYear: false },
    w2s: [{ taxYear: 2024, wagesBox1: 8000, federalTaxWithheldBox2: 0 }] });
  check("[IRS] Pub915 Ex4 MFS-together → taxable SS $3,400", Number(r.socialSecurityTaxable), 3400);
}

// ════════════════════════════════════════════════════════════════════════════
// B — EITC · Pub 596 EIC Table + Rev. Proc. 2023-34 (TY2024).
//   [IRS-PUBLISHED] max-credit plateau values (1ch 4,213 / 2ch 6,960 / 3ch 7,830;
//   0ch 632). On the plateau the EIC-table value == the formula max, so the
//   engine matches to the dollar. (SUB-GAP: in the phase-in/out REGIONS the
//   engine uses the exact §32 formula, not the $50-band EIC-table midpoint, so it
//   can differ by ≤ ~$1 — e.g. 1ch $12,025 = formula $4,088.50 vs EIC table
//   $4,089. Documented in docs/accuracy/golden-test-pack.md.)
// ════════════════════════════════════════════════════════════════════════════
function eitc(wages: number, kids: number, status: string): number {
  const r = run({ client: { filingStatus: status, state: "FL", taxYear: 2024, eitcQualifyingChildren: kids, dependentsUnder17: kids },
    w2s: [{ taxYear: 2024, wagesBox1: wages, federalTaxWithheldBox2: 0 }] });
  return (r.eitc as { appliedCredit: number }).appliedCredit;
}
check("[IRS] EITC 2024 plateau single 1 child = $4,213", eitc(18225, 1, "single"), 4213);
check("[IRS] EITC 2024 plateau single 2 children = $6,960", eitc(18225, 2, "single"), 6960);
check("[IRS] EITC 2024 plateau single 3 children = $7,830", eitc(18225, 3, "single"), 7830);
check("[IRS] EITC 2024 plateau MFJ 0 children = $632", eitc(15225, 0, "married_filing_jointly"), 632);
// Phase-in band: engine uses the §32 formula (34% × 12,025 = $4,088.50).
//   EIC TABLE prints $4,089 (formula at the $12,025 band midpoint, rounded). The
//   ≤$0.50 gap is the documented EIC-table sub-gap; this pins current behavior.
check("EITC 2024 1ch $12,025 = §32 formula $4,088.50 (EIC table $4,089; ≤$1 sub-gap)", eitc(12025, 1, "single"), 4088.5);

// ════════════════════════════════════════════════════════════════════════════
// C — TAX TABLE · Form 1040 Tax Table (i1040tt 2024). [IRS-PUBLISHED] values
//   (full coverage in tax-engine-tax-table-mode-tests.ts; a cross-check here).
// ════════════════════════════════════════════════════════════════════════════
check("[IRS] Tax table 2024 single $50,000 row = $6,059", irsTaxTableTax(50000, "single", 2024), 6059);
check("[IRS] Tax table 2024 MFJ $50,000 row = $5,539", irsTaxTableTax(50000, "married_filing_jointly", 2024), 5539);

// ════════════════════════════════════════════════════════════════════════════
// D — SELF-EMPLOYMENT TAX · Schedule SE (2024). [HAND-CALC]
//   net × 0.9235 = SE income; 12.4% SS up to the $168,600 base + 2.9% Medicare.
// ════════════════════════════════════════════════════════════════════════════
{
  // $50,000 net: 50,000×0.9235 = 46,175 (< base) × 15.3% = $7,064.78.
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 50000 }] });
  check("[Sch SE] $50k net → SE tax $7,064.78", Number(r.selfEmploymentTax), 7064.78, 0.5);
}
{
  // $200,000 net: 200,000×0.9235 = 184,700. SS capped: 168,600×12.4% = 20,906.40;
  //   Medicare 184,700×2.9% = 5,356.30 → SE tax $26,262.70.
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200000 }] });
  check("[Sch SE] $200k net (SS-capped) → SE tax $26,262.70", Number(r.selfEmploymentTax), 26262.70, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// E — CHILD TAX CREDIT / ACTC · Schedule 8812 (2024). [HAND-CALC]
//   MFJ $40,000 earned, 2 kids <17. taxable 40,000−29,200 = 10,800; tax
//   10%×10,800 = $1,080. CTC $4,000; nonref limited to $1,080 → unused $2,920.
//   ACTC = min($2,920, 15%×(40,000−2,500)=5,625, $1,700×2=$3,400 cap) = $2,920.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = run({ client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 0 }] });
  check("[Sch 8812] MFJ $40k 2 kids → ACTC $2,920", Number(r.additionalChildTaxCredit), 2920);
}

// ════════════════════════════════════════════════════════════════════════════
// F — QDCGT WORKSHEET · Qualified Dividends & Capital Gain Tax Worksheet (2024).
//   [HAND-CALC] 0% bracket top single = $47,025.
// ════════════════════════════════════════════════════════════════════════════
{
  // single $40k LTCG only: taxable 40,000−14,600 = 25,400; all in 0% bracket → $0.
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    adjustments: [{ adjustmentType: "long_term_capital_gain", amount: 40000, isApplied: true }] });
  check("[QDCGT] single $40k LTCG only → federal tax $0 (0% bracket)", Number(r.federalTaxLiability), 0);
}
{
  // single $100k LTCG only: taxable 100,000−14,600 = 85,400; 0% to 47,025, then
  //   15%×(85,400−47,025)=15%×38,375 = $5,756.25.
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    adjustments: [{ adjustmentType: "long_term_capital_gain", amount: 100000, isApplied: true }] });
  check("[QDCGT] single $100k LTCG only → federal tax $5,756.25", Number(r.federalTaxLiability), 5756.25, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// G — EDUCATION (AOC) · Form 8863 (2024). [HAND-CALC]
//   100% of first $2,000 + 25% of next $2,000 = $2,500 max, below the $80k single
//   MAGI phase-out. $4,000 qualified expenses, 1 student.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0 }],
    adjustments: [{ adjustmentType: "qualified_education_expenses_aoc", amount: 4000, isApplied: true }] });
  const ec = r.educationCredits as { aocRefundable: number; aocNonRefundable: number };
  check("[Form 8863] AOC $4k expenses → total credit $2,500 max", ec.aocRefundable + ec.aocNonRefundable, 2500);
  check("[Form 8863] AOC 40% refundable = $1,000", ec.aocRefundable, 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// H — DEPENDENT CARE · Form 2441 (2024). [HAND-CALC]
//   AGI > $43,000 → 20% rate; 1 dependent → $3,000 expense limit. $5,000 spent →
//   min($5,000, $3,000) × 20% = $600.
// ════════════════════════════════════════════════════════════════════════════
{
  const r = run({ client: { filingStatus: "single", state: "FL", taxYear: 2024, dependentsForCareCredit: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 0 }],
    adjustments: [{ adjustmentType: "dependent_care_expenses", amount: 5000, isApplied: true }] });
  check("[Form 2441] $5k expense, 1 dep, AGI $60k → credit $600", (r.dependentCareCredit as { appliedCredit: number }).appliedCredit, 600);
}

console.log(`\nT1.5 #2 — Golden-test pack from IRS worked examples (Pub 915 / Pub 596 / Sch SE/8812/2441/8863 / QDCGT):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
