/**
 * C11 — Per-state part-year residency (NY IT-203 + CA 540NR Sched CA pattern).
 *
 * Tests the OPT-IN per-W-2-stateCode wage allocation. When `useW2SourceAllocation`
 * is true on partYearResidency, wages flow to the state where each W-2 was
 * earned rather than pure pro-rata by days. Non-wage income still pro-rates.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/tax-engine-c11-part-year-w2-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { calculateMultiStateTax } from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: Array<{ rule: string; label: string; expected: number | string; actual: number | string }> = [];

function check(rule: string, label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected, actual });
}
function checkTruthy(rule: string, label: string, actual: boolean, expected: boolean) {
  if (actual === expected) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected: String(expected), actual: String(actual) });
}
function header(t: string) { console.log(`\n── ${t} ──`); }
function section(t: string) { console.log(`\n========== ${t} ==========`); }

// ── C11 — direct unit tests on calculateMultiStateTax ────────────────────
section("C11 — Per-W-2 wage allocation (OPT-IN)");

header("C11+1 — CA→NY on Apr 1, W-2 stateCode=NY $120k, useW2Source=true → all $120k to NY");
{
  // Without useW2Source: pro-rata $29,836 to CA / $90,164 to NY.
  // With useW2Source: $0 to CA (no CA W-2) / $120k to NY (all W-2 there).
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 120_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 120_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
  });
  check("C11+1", "formerStateAgi (CA) = $0",
    r.partYearResidency?.formerStateAgi ?? -1, 0);
  check("C11+1", "currentStateAgi (NY) = $120,000",
    r.partYearResidency?.currentStateAgi ?? -1, 120_000);
  check("C11+1", "formerStateTax (CA) = $0",
    r.partYearResidency?.formerStateTax ?? -1, 0);
}

header("C11+2 — CA→NY on Apr 1, W-2 stateCode=CA $40k + W-2 stateCode=NY $80k, useW2Source=true");
{
  // Per W-2 allocation: $40k → CA, $80k → NY.
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 120_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [
      { stateCode: "CA", wages: 40_000 },
      { stateCode: "NY", wages: 80_000 },
    ],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
  });
  check("C11+2", "formerStateAgi (CA) = $40,000",
    r.partYearResidency?.formerStateAgi ?? -1, 40_000);
  check("C11+2", "currentStateAgi (NY) = $80,000",
    r.partYearResidency?.currentStateAgi ?? -1, 80_000);
}

header("C11+3 — Mixed wages + non-W-2: $80k W-2 to NY + $40k LTCG → NY gets $80k W-2 + days-prorated $40k LTCG");
{
  // Total AGI $120k = $80k W-2 + $40k non-W-2 (LTCG).
  // With useW2Source=true:
  //   Wage portion: $80k all to NY (current state), $0 to CA.
  //   Non-W-2 ($40k) pro-rated 91/366 = $9,945 to CA, $30,055 to NY.
  //   Totals: CA $9,945; NY $80k + $30,055 = $110,055.
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 120_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 80_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
  });
  check("C11+3", "formerStateAgi (CA) ≈ $9,945 (non-W-2 days pro-rata)",
    r.partYearResidency?.formerStateAgi ?? -1, 9945, 5);
  check("C11+3", "currentStateAgi (NY) ≈ $110,055 ($80k W-2 + $30,055 non-W-2)",
    r.partYearResidency?.currentStateAgi ?? -1, 110_055, 5);
}

header("C11-1 — Without useW2SourceAllocation: pure pro-rata default unchanged");
{
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 120_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 120_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      // useW2SourceAllocation NOT set → falls back to pure pro-rata
    },
  });
  // Pro-rata: $120k × 91/366 = $29,836 to CA / $90,164 to NY
  check("C11-1", "formerStateAgi pure pro-rata = $29,836",
    r.partYearResidency?.formerStateAgi ?? -1, 29836, 2);
  check("C11-1", "currentStateAgi pure pro-rata = $90,164",
    r.partYearResidency?.currentStateAgi ?? -1, 90163.93, 2);
}

// ── C11 — end-to-end via computeTaxReturnPure with adjustment marker ─────
section("C11 — E2E via computeTaxReturnPure with adjustment marker");

header("C11 E2E+1 — Adjustment 'part_year_use_w2_source' enables per-W-2 allocation");
{
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 120_000, stateCode: "NY" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [
      { adjustmentType: "part_year_use_w2_source", amount: 1, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    taxYear: 2024,
    client: {
      filingStatus: "single",
      state: "NY",
      taxYear: 2024,
      residencyChangedInYear: true,
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
    } as TaxReturnInputs["client"],
  };
  const r = computeTaxReturnPure(inputs);
  // With marker: all wages to NY → CA former tax = $0.
  check("C11 E2E+1", "formerStateAgi (CA) = $0",
    (r as unknown as { formerStateTax: number }).formerStateTax, 0, 0.5);
}

header("C11 E2E-1 — Without marker: pure pro-rata default fires");
{
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 120_000, stateCode: "NY" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
    client: {
      filingStatus: "single",
      state: "NY",
      taxYear: 2024,
      residencyChangedInYear: true,
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
    } as TaxReturnInputs["client"],
  };
  const r = computeTaxReturnPure(inputs);
  // Without marker: pro-rata $29,836 to CA → former tax > $0
  const formerTax = (r as unknown as { formerStateTax: number }).formerStateTax;
  checkTruthy("C11 E2E-1", `formerStateTax > 0 (got ${formerTax.toFixed(0)})`, formerTax > 0, true);
}

console.log(`\nPASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  [${f.rule}] ${f.label}  expected=${f.expected}  actual=${f.actual}`);
  }
  process.exit(1);
}
console.log("\nALL C11 PART-YEAR W-2 TESTS PASS");
