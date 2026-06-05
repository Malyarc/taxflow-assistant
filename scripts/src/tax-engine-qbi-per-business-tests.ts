/**
 * FED-04 / P2-4 — Form 8995-A per-business §199A wage/UBIA limit.
 *
 * Direct calculateQbi unit tests (precise per-business math) + engine
 * integration (the limit flowing through computeTaxReturnPure). NO API.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-qbi-per-business-tests.ts
 */
import { calculateQbi } from "../../artifacts/api-server/src/lib/taxCalculator";
import { computeTaxReturnPure, type TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }

// ════════════════════════════════════════════════════════════════════════════
// 1. Per-business limit < aggregate (the headline fix). Single, TY2024.
//    Business A: QBI $100k, wages $400k (limit $200k ≫ tentative $20k → no bind).
//    Business B: QBI $200k, wages $20k (limit $10k binds hard).
//    taxable before QBI $285,400 (> band end $241,950 → excessRatio = 1).
//    Per-business: A $20k + B $10k = $30k.  Capped at 20%×285,400 = $57,080 → $30k.
// ════════════════════════════════════════════════════════════════════════════
header("Per-business: high-wage A cannot rescue low-wage B");
{
  const q = calculateQbi({
    qbiIncome: 300000,
    taxableIncomeBeforeQbi: 285400,
    netCapitalGain: 0,
    filingStatus: "single",
    taxYear: 2024,
    perBusiness: [
      { qbiIncome: 100000, w2Wages: 400000, ubia: 0, label: "A" },
      { qbiIncome: 200000, w2Wages: 20000, ubia: 0, label: "B" },
    ],
  });
  check("final deduction $30,000 (per-business)", q.finalDeduction, 30000);
  check("A deductible $20,000 (unlimited by its own wages)", q.perBusiness?.[0].deductibleAmount ?? -1, 20000);
  check("B deductible $10,000 (50% of $20k wages)", q.perBusiness?.[1].deductibleAmount ?? -1, 10000);
  checkBool("A limit did NOT bind", q.perBusiness?.[0].limitApplied ?? true, false);
  checkBool("B limit DID bind", q.perBusiness?.[1].limitApplied ?? false, true);
}

// ── 2. Same inputs, AGGREGATE path (no perBusiness) → $57,080 (the OLD, wrong,
//    over-stated value: A's huge wages rescue B). Proves the fix changed it. ──
header("Aggregate path over-states (the bug per-business fixes)");
{
  const q = calculateQbi({
    qbiIncome: 300000,
    taxableIncomeBeforeQbi: 285400,
    netCapitalGain: 0,
    w2Wages: 420000, // aggregate of $400k + $20k
    ubia: 0,
    filingStatus: "single",
    taxYear: 2024,
  });
  // Aggregate limit = max(0.5×420k, 0.25×420k) = $210k ≫ tentative $60k → no
  // wage reduction; capped by 20%×285,400 = $57,080.
  check("aggregate final deduction $57,080 (over-stated)", q.finalDeduction, 57080);
}

// ── 3. Single business == aggregate (backward-compat invariant) ────────────
header("Single business reproduces aggregate exactly");
{
  const single = { qbiIncome: 100000, taxableIncomeBeforeQbi: 250000, netCapitalGain: 0, filingStatus: "single", taxYear: 2024 } as const;
  const agg = calculateQbi({ ...single, w2Wages: 30000, ubia: 0 });
  const per = calculateQbi({ ...single, w2Wages: 30000, ubia: 0, perBusiness: [{ qbiIncome: 100000, w2Wages: 30000, ubia: 0 }] });
  // tentative 20k; limit max(15k,7.5k)=15k; excessRatio 1 → reduction 5k → 15k.
  check("aggregate = $15,000", agg.finalDeduction, 15000);
  check("per-business (1 biz) = $15,000 (identical)", per.finalDeduction, 15000);
}

// ── 4. Business with NO wage data stays unlimited (escape preserved) ───────
header("No-wage business → unlimited 20% (escape)");
{
  const q = calculateQbi({
    qbiIncome: 100000, taxableIncomeBeforeQbi: 250000, netCapitalGain: 0,
    filingStatus: "single", taxYear: 2024,
    perBusiness: [{ qbiIncome: 100000, w2Wages: 0, ubia: 0 }],
  });
  check("final = $20,000 (full 20%, no limit applied)", q.finalDeduction, 20000);
  checkBool("limit not applied (no wage data)", q.perBusiness?.[0].limitApplied ?? true, false);
}

// ── 5. Mid-band phase-in (excessRatio 0.5), single business ────────────────
header("Mid-band phase-in per business");
{
  // taxable $216,950 = exact mid-band → excessRatio 0.5.
  const q = calculateQbi({
    qbiIncome: 100000, taxableIncomeBeforeQbi: 216950, netCapitalGain: 0,
    filingStatus: "single", taxYear: 2024,
    perBusiness: [{ qbiIncome: 100000, w2Wages: 20000, ubia: 0 }],
  });
  // tentative 20k; limit 10k; reduction = (20k-10k)×0.5 = 5k → 15k. cap 20%×216,950=43,390.
  check("final = $15,000 (mid-band)", q.finalDeduction, 15000);
}

// ── 6. UBIA path per business (25% wages + 2.5% UBIA beats 50% wages) ───────
header("UBIA path per business");
{
  const q = calculateQbi({
    qbiIncome: 100000, taxableIncomeBeforeQbi: 250000, netCapitalGain: 0,
    filingStatus: "single", taxYear: 2024,
    perBusiness: [{ qbiIncome: 100000, w2Wages: 10000, ubia: 1000000 }],
  });
  // limit = max(5k, 2.5k + 25k = 27.5k) = 27.5k ≥ tentative 20k → no bind → 20k.
  check("final = $20,000 (UBIA lifts limit above tentative)", q.finalDeduction, 20000);
}

// ════════════════════════════════════════════════════════════════════════════
// ENGINE INTEGRATION — the per-business limit flowing through computeTaxReturnPure
// ════════════════════════════════════════════════════════════════════════════
header("Engine: two S-corp K-1s, per-business limit → $30,000");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      { taxYear: 2024, entityType: "s_corp", activityType: "active", entityName: "A Corp",
        box1OrdinaryIncome: 100000, section199aQbi: 100000, section199aW2Wages: 400000, section199aUbia: 0 },
      { taxYear: 2024, entityType: "s_corp", activityType: "active", entityName: "B Corp",
        box1OrdinaryIncome: 200000, section199aQbi: 200000, section199aW2Wages: 20000, section199aUbia: 0 },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  // AGI $300k (S-corp K-1 not SE-taxed); taxable before QBI = 300k − 14,600 = 285,400.
  check("AGI $300,000", r.adjustedGrossIncome, 300000, 1);
  check("QBI deduction $30,000 (per-business 8995-A)", r.qbiDeduction, 30000, 1);
  check("qbiPerBusiness has 2 rows", r.qbiPerBusiness?.length ?? 0, 2);
  check("A row deductible $20,000", r.qbiPerBusiness?.[0].deductibleAmount ?? -1, 20000, 1);
  check("B row deductible $10,000", r.qbiPerBusiness?.[1].deductibleAmount ?? -1, 10000, 1);
}

header("Engine: SSTB business phased out + non-SSTB wage-limited (above band)");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      { taxYear: 2024, entityType: "s_corp", activityType: "active", entityName: "NonSSTB",
        box1OrdinaryIncome: 200000, section199aQbi: 200000, section199aW2Wages: 100000, section199aUbia: 0 },
      { taxYear: 2024, entityType: "s_corp", activityType: "active", entityName: "SSTB", isSstb: true,
        box1OrdinaryIncome: 200000, section199aQbi: 200000, section199aW2Wages: 100000, section199aUbia: 0 },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  // AGI $400k; taxable before QBI = 385,400 > band end $241,950 → SSTB phased to $0.
  // Non-SSTB: QBI $200k, tentative $40k, limit max(0.5×100k,...) = $50k → no bind → $40k.
  // SSTB: phased QBI $0 → $0. Total QBI deduction = $40,000.
  check("QBI deduction $40,000 (SSTB→$0, non-SSTB wage-OK)", r.qbiDeduction, 40000, 1);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log(f); process.exit(1); }
console.log("ALL QBI PER-BUSINESS TESTS GREEN");
