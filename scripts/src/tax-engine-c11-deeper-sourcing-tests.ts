/**
 * C11 deeper — Per-K-1, per-rental, per-intangible part-year sourcing.
 *
 * Extends C11 (per-W-2 sourcing) to also source K-1 income (by
 * sourceState) and rental net income (by property's state) to the
 * specific state. Intangibles still pro-rate by days (resident-state
 * standard sourcing rule).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/tax-engine-c11-deeper-sourcing-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { calculateMultiStateTax } from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: Array<{ rule: string; label: string; expected: number | string; actual: number | string }> = [];

function check(rule: string, label: string, actual: number, expected: number, tol = 1) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected, actual });
}
function checkTruthy(rule: string, label: string, actual: boolean, expected: boolean) {
  if (actual === expected) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected: String(expected), actual: String(actual) });
}
function header(t: string) { console.log(`\n── ${t} ──`); }
function section(t: string) { console.log(`\n========== ${t} ==========`); }

// ── C11 deeper — direct unit tests on calculateMultiStateTax ──────────────
section("C11 deeper — Per-state K-1 + rental + intangible sourcing (OPT-IN)");

header("C11d+1 — K-1 sourced to former state (CA), wages to current (NY), no intangibles");
{
  // CA→NY 2024-04-01. W-2 $80k (stateCode NY). K-1 net $30k sourced to CA.
  // Total AGI = $110k. With full source allocation:
  //   Wages: $80k → NY, $0 → CA
  //   K-1: $30k → CA
  //   No non-W-2-non-K-1 income → no pro-rata residual
  //   Total: CA $30k, NY $80k
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 110_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 80_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
    options: {
      perStateOtherSourced: { CA: 30_000 },
    },
  });
  check("C11d+1", "formerStateAgi (CA) = $30,000", r.partYearResidency?.formerStateAgi ?? -1, 30_000);
  check("C11d+1", "currentStateAgi (NY) = $80,000", r.partYearResidency?.currentStateAgi ?? -1, 80_000);
}

header("C11d+2 — Rental net sourced to TX, wages to NY, third-state income pro-rates");
{
  // CA→NY 2024-04-01. W-2 $90k (NY). Rental net $15k in TX (a no-tax third state
  // that is neither the former CA nor the current NY residence state).
  // CORRECTED (R3-C3): a part-year resident is taxed on WORLDWIDE income during
  // each residence period, so the $15k TX rental must NOT be dropped — it
  // pro-rates by residence days into BOTH the CA and NY residence periods. (The
  // old treatment subtracted it from the pro-rata pool and allocated it to
  // "neither," under-taxing $15k: the periods summed to only $90k of the $105k
  // federal AGI.)
  // Hand-calc (2024 leap year, 366 days; CA period Jan 1–Mar 31 = 91 days,
  //   NY period Apr 1–Dec 31 = 275 days):
  //   Wages: $90k → NY (current), $0 → CA (former)
  //   Third-state $15k pro-rates: CA = 15,000 × (91/366) = $3,729.51;
  //                               NY = 15,000 × (275/366) = $11,270.49
  //   CA AGI = 0 + 3,729.51                       = $3,729.51
  //   NY AGI = 90,000 + 11,270.49                 = $101,270.49
  //   Sum = $3,729.51 + $101,270.49 = $105,000 = federalAgi  ✓ (no income lost)
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 105_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 90_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
    options: {
      perStateOtherSourced: { TX: 15_000 },
    },
  });
  check("C11d+2", "formerStateAgi (CA) = $3,729.51", r.partYearResidency?.formerStateAgi ?? -1, 3729.51);
  check("C11d+2", "currentStateAgi (NY) = $101,270.49", r.partYearResidency?.currentStateAgi ?? -1, 101_270.49);
}

header("C11d+3 — K-1 sourced to current state (NY) + W-2 to NY → all $110k to NY");
{
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 110_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 80_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
    options: {
      perStateOtherSourced: { NY: 30_000 },
    },
  });
  check("C11d+3", "formerStateAgi (CA) = $0", r.partYearResidency?.formerStateAgi ?? -1, 0);
  check("C11d+3", "currentStateAgi (NY) = $110,000", r.partYearResidency?.currentStateAgi ?? -1, 110_000);
}

header("C11d+4 — Mixed: W-2 to NY $80k + K-1 to CA $20k + intangibles $30k (pro-rata)");
{
  // Total AGI = $130k = $80k W-2 + $20k K-1 + $30k intangibles.
  // With full source allocation:
  //   W-2 $80k → NY, $0 → CA
  //   K-1 $20k → CA
  //   Intangibles $30k → pro-rate 91/366 days: $7,459 to CA, $22,541 to NY
  //   CA = $0 + $20k + $7,459 = $27,459
  //   NY = $80k + $0 + $22,541 = $102,541
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 130_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 80_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
    options: {
      perStateOtherSourced: { CA: 20_000 },
    },
  });
  check("C11d+4", "formerStateAgi (CA) ≈ $27,459",
    r.partYearResidency?.formerStateAgi ?? -1, 27_459, 5);
  check("C11d+4", "currentStateAgi (NY) ≈ $102,541",
    r.partYearResidency?.currentStateAgi ?? -1, 102_541, 5);
}

header("C11d-1 — Full source allocation OFF: pro-rata default (existing C11 behavior unchanged)");
{
  // No perStateOtherSourced → engine falls back to pure pro-rata even
  // when sourceState is set on facts.
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 130_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 80_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
    // options.perStateOtherSourced NOT set → 50k non-wage all pro-rates
  });
  // 50k non-wage × 91/366 = 12,432 CA, 37,568 NY
  // CA = $0 + 12_432 = $12,432
  // NY = $80k + 37_568 = $117,568
  check("C11d-1", "formerStateAgi (CA) ≈ $12,432",
    r.partYearResidency?.formerStateAgi ?? -1, 12_432, 5);
  check("C11d-1", "currentStateAgi (NY) ≈ $117,568",
    r.partYearResidency?.currentStateAgi ?? -1, 117_568, 5);
}

// ── C11 deeper — end-to-end via computeTaxReturnPure ─────────────────────
section("C11 deeper — E2E via computeTaxReturnPure with adjustment marker");

header("C11d E2E+1 — Adjustment `part_year_use_full_source_allocation` enables K-1 source-state allocation");
{
  // Setup: PY filer CA→NY 2024-04-01. W-2 $80k (NY). K-1 $40k sourced to CA.
  // With the full marker: NY $80k, CA $40k.
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 80_000, stateCode: "NY" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [
      { adjustmentType: "part_year_use_full_source_allocation", amount: 1, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    scheduleK1: [{
      taxYear: 2024,
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: 40_000,
      sourceState: "CA",
    } as TaxReturnInputs["scheduleK1"][number]],
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
  // CA tax is computed on $40k → should be > $0.
  const formerTax = (r as unknown as { formerStateTax: number }).formerStateTax;
  checkTruthy("C11d E2E+1 CA tax fires", `formerStateTax > 0 (got ${formerTax.toFixed(0)})`, formerTax > 0, true);
}

header("C11d E2E+2 — Rental source-state allocation (positive net after MACRS)");
{
  // PY filer CA→NY 2024-04-01. W-2 $60k (NY). Rental in CA: $30k income,
  // $5k expenses, basis $100k (MACRS ~$3,636/yr residential 27.5y) → net ~$21k.
  // With full marker: CA source rental net ~$21k → CA tax > 0.
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 60_000, stateCode: "NY" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [
      { adjustmentType: "part_year_use_full_source_allocation", amount: 1, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    rentalProperties: [{
      taxYear: 2024,
      address: "123 Main St, San Jose, CA",
      propertyType: "residential",
      basis: 100_000,
      placedInServiceYear: 2020,
      placedInServiceMonth: 6,
      isActiveParticipant: true,
      rentalIncome: 30_000,
      totalExpenses: 5_000,
      sourceState: "CA",
    } as TaxReturnInputs["rentalProperties"][number]],
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
  // CA rental net positive → CA tax > 0
  const formerTax = (r as unknown as { formerStateTax: number }).formerStateTax;
  checkTruthy("C11d E2E+2 CA tax fires from rental", `formerStateTax > 0 (got ${formerTax.toFixed(0)})`, formerTax > 0, true);
}

header("C11d E2E-1 — Without `part_year_use_full_source_allocation`: pure pro-rata (K-1 sourceState ignored)");
{
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 80_000, stateCode: "NY" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [], // no marker
    scheduleK1: [{
      taxYear: 2024,
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: 40_000,
      sourceState: "CA",
    } as TaxReturnInputs["scheduleK1"][number]],
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
  // Without the marker, K-1 sourceState is ignored — all $120k pro-rated by
  // days. CA AGI ≈ $30k. CA tax fires moderately.
  const formerTax = (r as unknown as { formerStateTax: number }).formerStateTax;
  checkTruthy("C11d E2E-1 baseline behavior", `formerStateTax > 0 (got ${formerTax.toFixed(0)})`, formerTax > 0, true);
}

header("C11d E2E+3 — Backward compat: `part_year_use_w2_source` still works (no K-1 sourcing)");
{
  // Filer uses old marker — engine still sources wages by W-2 but ignores
  // K-1 sourceState.
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 80_000, stateCode: "NY" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [
      { adjustmentType: "part_year_use_w2_source", amount: 1, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    scheduleK1: [{
      taxYear: 2024,
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: 40_000,
      sourceState: "CA",
    } as TaxReturnInputs["scheduleK1"][number]],
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
  // With w2_source only: wages $80k → NY; K-1 $40k pro-rated by days
  // (sourceState ignored). CA ~ $40k × 91/366 = $9,945.
  const formerTax = (r as unknown as { formerStateTax: number }).formerStateTax;
  checkTruthy("C11d E2E+3 backward-compat", `formerStateTax > 0 (got ${formerTax.toFixed(0)})`, formerTax > 0, true);
}

header("C11d E2E+4 — Both markers set: full source allocation wins");
{
  // Both `_w2_source` and `_full_source_allocation` set → engine uses full.
  // Verify K-1 sourceState is respected.
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 80_000, stateCode: "NY" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [
      { adjustmentType: "part_year_use_w2_source", amount: 1, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      { adjustmentType: "part_year_use_full_source_allocation", amount: 1, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    scheduleK1: [{
      taxYear: 2024,
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: 40_000,
      sourceState: "CA",
    } as TaxReturnInputs["scheduleK1"][number]],
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
  // With full marker: NY $80k, CA $40k. CA tax > the pro-rata baseline.
  const formerTax = (r as unknown as { formerStateTax: number }).formerStateTax;
  checkTruthy("C11d E2E+4", `formerStateTax > 0 (got ${formerTax.toFixed(0)})`, formerTax > 0, true);
}

header("C11d E2E+5 — K-1 without sourceState → falls through to pro-rata");
{
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 80_000, stateCode: "NY" } as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [
      { adjustmentType: "part_year_use_full_source_allocation", amount: 1, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    scheduleK1: [{
      taxYear: 2024,
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: 40_000,
      // no sourceState — falls through to pro-rata
    } as TaxReturnInputs["scheduleK1"][number]],
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
  // K-1 $40k pro-rated by days (no sourceState). CA ≈ $40k × 91/366 = $9,945.
  // CA tax fires moderately.
  const formerTax = (r as unknown as { formerStateTax: number }).formerStateTax;
  checkTruthy("C11d E2E+5 K-1 no source", `formerStateTax > 0 (got ${formerTax.toFixed(0)})`, formerTax > 0, true);
}

// ── Boundary cases ──────────────────────────────────────────────────────
section("C11 deeper — Boundary + defensive cases");

header("C11d boundary-1 — Empty perStateOtherSourced behaves as undefined");
{
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 100_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 100_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
    options: {
      perStateOtherSourced: {},
    },
  });
  // All $100k W-2 → NY; non-wage income = $0 → no pro-rata residual.
  check("C11d boundary-1", "formerStateAgi (CA) = $0", r.partYearResidency?.formerStateAgi ?? -1, 0);
  check("C11d boundary-1", "currentStateAgi (NY) = $100,000", r.partYearResidency?.currentStateAgi ?? -1, 100_000);
}

header("C11d boundary-2 — Negative K-1 sourced income (loss) → reduces source-state AGI");
{
  // K-1 loss of $5k sourced to CA. Total AGI $105k = $110k − $5k loss.
  // With full source: CA = $0 wages + (−$5k K-1 sourced; engine uses Math.max(0,...)
  // for situsSourcedTotal subtraction). Engine clamps negative source-state to 0.
  // This documents that the engine doesn't currently propagate K-1 losses
  // to source-state allocation (sub-gap — conservative).
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 105_000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 110_000 }],
    partYearResidency: {
      formerState: "CA",
      residencyChangeDate: "2024-04-01",
      useW2SourceAllocation: true,
    },
    options: {
      perStateOtherSourced: { CA: -5_000 },
    },
  });
  // Engine clamps: CA = max(0, -5k) = $0. Subtraction of situsSourcedTotal
  // also clamps: max(0, -5k) = 0. So nonW2NonSitusAgi = max(0, $105k − $110k − 0) = 0.
  // CA = 0 wages + 0 situs + 0 pro-rata = $0
  // NY = $110k wages + 0 situs + 0 pro-rata = $110k
  // Total AGI ($105k) ≠ formerAgi + currentAgi ($110k) — the K-1 loss is
  // effectively dropped. Engine sub-gap (conservative).
  check("C11d boundary-2", "formerStateAgi (CA) = $0 (loss clamped)", r.partYearResidency?.formerStateAgi ?? -1, 0);
  check("C11d boundary-2", "currentStateAgi (NY) = $110,000", r.partYearResidency?.currentStateAgi ?? -1, 110_000);
}

console.log(`\nPASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  [${f.rule}] ${f.label}  expected=${f.expected}  actual=${f.actual}`);
  }
  process.exit(1);
}
console.log("\nALL C11 DEEPER SOURCING TESTS PASS");
