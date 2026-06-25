/**
 * ROUND-4 IRS VERIFICATION — golden tests + regressions from the deep
 * primary-source re-verification of the calculator engine (2026-06-25).
 *
 * Every expected value below is HAND-DERIVED from the IRS published worksheet /
 * schedule FIRST, then confirmed to match `computeTaxReturnPure`. (Per the house
 * rule: hand-calc before asserting; the calculator is usually right when a test
 * disagrees — but here both agree.)
 *
 * EXCESS-SS-1 (a real bug found this round by the AMT/NIIT/SE verification agent,
 *   hand-adjudicated + fixed): the excess-Social-Security credit (Sch 3 line 11)
 *   must cap EACH employer's Box 4 at the per-employer SS max BEFORE summing — a
 *   single employer's over-withholding is recovered from the employer (Form 843),
 *   NOT creditable on the 1040 (IRS Topic 608 / Pub 505 Worksheet 3-3: "...not
 *   counting more than $<max> for each employer"). 2024 per-employer max =
 *   6.2% × $168,600 = $10,453.20.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-irs-golden-v2-tests.ts
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

const w2 = (employerName: string, box1: number, box4: number, spouse: "taxpayer" | "spouse" = "taxpayer") =>
  ({ taxYear: 2024, wagesBox1: box1, socialSecurityTaxBox4: box4, employerName, stateCode: "FL", spouse });

const ltTxn = (proceeds: number, basis: number, gainClass: string | null = null, u1250?: number) =>
  ({ taxYear: 2024, description: "lot", formBox: "F", proceeds: String(proceeds),
     costBasis: String(basis), gainClass, unrecaptured1250Amount: u1250 != null ? String(u1250) : null });

function excessSs(w2s: any[]): number {
  return computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s, form1099s: [], adjustments: [], taxYear: 2024,
  } as TaxReturnInputs).excessSocialSecurityCredit;
}

// ════════════════════════════════════════════════════════════════════════════
// EXCESS-SS-1 — per-employer cap before summing (Sch 3 line 11 / Pub 505 WS 3-3).
// 2024 per-employer SS max withheld = $10,453.20.
// ════════════════════════════════════════════════════════════════════════════
header("EXCESS-SS-1 — excess Social Security credit caps each employer at $10,453.20");
{
  // Two employers, employer A over-withheld $12,000 (> $10,453.20 cap) + B $3,000.
  // A is capped to $10,453.20; total capped $13,453.20 − $10,453.20 = $3,000.00.
  // (The bug summed the full $12,000 → wrong $4,546.80, over-refunding A's $1,546.80
  //  over-collection, which is recoverable only from employer A via Form 843.)
  check("A=$12,000 (over cap) + B=$3,000 → $3,000.00 (A capped)", excessSs([w2("A", 130000, 12000), w2("B", 50000, 3000)]), 3000.0);
  // Control 1 — both within cap: $9,000 + $4,000 → $13,000 − $10,453.20 = $2,546.80.
  check("A=$9,000 + B=$4,000 (both within cap) → $2,546.80", excessSs([w2("A", 145000, 9000), w2("B", 60000, 4000)]), 2546.80);
  // Control 2 — a SINGLE employer over-withholding is NOT creditable here ($0).
  check("single employer A=$12,000 over-withheld → $0 (Form 843, not the 1040)", excessSs([w2("A", 130000, 12000)]), 0);
  // Control 3 — same employer, two W-2s aggregate then cap (one employer → $0).
  check("same employer A two W-2s $6,000+$6,000 → $0 (one employer, aggregate)", excessSs([w2("A", 70000, 6000), w2("A", 70000, 6000)]), 0);
  // Control 4 — no excess (combined under the annual max).
  check("A=$5,000 + B=$4,000 (under annual max) → $0", excessSs([w2("A", 80000, 5000), w2("B", 60000, 4000)]), 0);
}

// ════════════════════════════════════════════════════════════════════════════
// §1(h) SCHEDULE D TAX WORKSHEET — the interleaving 25%/§1250 + 28% layers.
// This is the single most error-prone path in the engine (misread 3× historically
// per CLAUDE.md). These lock two end-to-end values hand-worked through the
// published 47-line worksheet (i1040sd) and confirmed against the engine.
// ════════════════════════════════════════════════════════════════════════════
header("§1(h) — Schedule D Tax Worksheet interleave, two end-to-end locks");
{
  // Example A — single 2024, taxable $150,000 = ordinary $50k + §1250 $30k +
  //   collectibles-28% $20k + plain LTCG $50k. Wages $64,600 (= $50k taxable
  //   ordinary + $14,600 std ded) + $100k preferential gains → taxable $150,000,
  //   AGI $164,600 (< $200k NIIT threshold → no NIIT). The §1250/28% layers are
  //   ABSORBED at ordinary rates (10/12/22/24%) below the 24%-bracket top — NOT
  //   flat 25/28% (the old flat model over-taxed this case by $2,100).
  //   Worksheet result = federal income tax $24,553.00.
  const a = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [w2("X", 64600, 4005.2)] as any, form1099s: [], adjustments: [], taxYear: 2024,
    capitalTransactions: [ltTxn(50000, 0), ltTxn(30000, 0, "section1250", 30000), ltTxn(20000, 0, "collectible")],
  } as TaxReturnInputs);
  check("Ex-A taxable income = $150,000", a.taxableIncome, 150000);
  check("Ex-A no NIIT (AGI $164,600 < $200k)", a.niitTax, 0);
  check("Ex-A federal income tax = $24,553 (interleaved, not flat 25/28)", a.federalTaxLiability, 24553);
  check("Ex-A §1250 25% bucket reported = $30,000", a.unrecapturedSection1250Gain, 30000);
  check("Ex-A 28% bucket reported = $20,000", a.collectibles28RateGain, 20000);

  // Example B — single 2024, taxable $350,000 = ordinary $250k + §1250 $40k +
  //   28% $30k + plain LTCG $30k. Here there's NO ordinary-rate room below the
  //   25%/28% maxima, so the layers DO bind: ordinary tax on $250k $57,874.75 +
  //   15% × $30k plain + 25% × $40k §1250 + 28% × $30k collectibles = $80,774.75
  //   (income tax only). On top, NIIT 3.8% × $100k = $3,800 + Add'l Medicare
  //   0.9% × ($264,600 − $200k) = $581.40 (asserted separately).
  const b = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [w2("X", 264600, 10453.2)] as any, form1099s: [], adjustments: [], taxYear: 2024,
    capitalTransactions: [ltTxn(30000, 0), ltTxn(40000, 0, "section1250", 40000), ltTxn(30000, 0, "collectible")],
  } as TaxReturnInputs);
  check("Ex-B taxable income = $350,000", b.taxableIncome, 350000);
  check("Ex-B income tax (fed − NIIT − Add'l-Med − AMT) = $80,774.75",
    b.federalTaxLiability - b.niitTax - b.additionalMedicareTax - b.amtTax, 80774.75);
  check("Ex-B NIIT = 3.8% × $100k = $3,800", b.niitTax, 3800);
  check("Ex-B Add'l Medicare = 0.9% × ($264,600 − $200k) = $581.40", b.additionalMedicareTax, 581.4);
}

// ════════════════════════════════════════════════════════════════════════════
// SS TAXABILITY — Pub 915 Worksheet 1 (deterministic 18-line worksheet).
// ════════════════════════════════════════════════════════════════════════════
header("SS taxability — Pub 915 Worksheet 1");
{
  // Single, $30,000 taxable interest + $12,000 SS benefits, 2024.
  //   Provisional = $30,000 + 50%×$12,000 = $36,000. Base1 $25,000, base2 $34,000.
  //   L10 = 36,000−25,000 = 11,000; L11 = 9,000; L12 = 9,000; L13 = 4,500;
  //   L14 = min(6,000, 4,500) = 4,500; L15 = (11,000−9,000)×85% = 1,700;
  //   L16 = 6,200; L17 = 85%×12,000 = 10,200; taxable SS = min = $6,200.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, socialSecurityBenefits: "12000" } as any,
    w2s: [], form1099s: [{ formType: "int", interestIncome: 30000, payerName: "Bank", stateCode: "FL" }] as any,
    adjustments: [], taxYear: 2024,
  } as TaxReturnInputs);
  check("Pub 915 single $30k other + $12k SS → taxable SS $6,200", r.socialSecurityTaxable, 6200);
  check("Pub 915 AGI = $30,000 interest + $6,200 taxable SS = $36,200", r.adjustedGrossIncome, 36200);
}

// ════════════════════════════════════════════════════════════════════════════
// KIDDIE TAX — Form 8615 (child unearned income taxed at parent's rate).
// ════════════════════════════════════════════════════════════════════════════
header("Kiddie tax — Form 8615");
{
  // Dependent child, 2024, $12,000 interest, no earned income. Parent top rate 24%.
  //   Dependent std ded (no earned income) = $1,300 → taxable $10,700.
  //   Form 8615: net unearned over $2,600 = $9,400 @ parent 24% = $2,256;
  //   remaining $1,300 @ child 10% = $130; total = $2,386.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, isKiddieTaxFiler: true, parentsTopMarginalRate: "0.24" } as any,
    w2s: [], form1099s: [{ formType: "int", interestIncome: 12000, payerName: "Bank", stateCode: "FL" }] as any,
    adjustments: [], taxYear: 2024,
  } as TaxReturnInputs);
  check("Form 8615 dependent taxable income = $10,700 ($12k − $1,300 std)", r.taxableIncome, 10700);
  check("Form 8615 kiddie tax = $9,400@24% + $1,300@10% = $2,386", r.federalTaxLiability, 2386);
}

// ════════════════════════════════════════════════════════════════════════════
// EITC — single, no qualifying children, 2024 (plateau max).
// ════════════════════════════════════════════════════════════════════════════
header("EITC — single, no children, 2024");
{
  // Earned $9,000 (between earned-income amount $8,260 and phase-out start $10,330),
  //   AGI $9,000 (below phase-out start) → plateau max credit = $632.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 } as any,
    w2s: [w2("X", 9000, 558)] as any, form1099s: [], adjustments: [], taxYear: 2024,
  } as TaxReturnInputs);
  check("EITC single no kids, earned $9,000 → plateau max $632", (r.eitc as any).appliedCredit, 632);
}

// ── Summary ──
console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) { for (const f of failures) console.log(f); process.exit(1); }
console.log("ALL ROUND-4 IRS-VERIFICATION ASSERTIONS PASS");
