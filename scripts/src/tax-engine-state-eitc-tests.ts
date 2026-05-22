/**
 * BP4 — State EITC tests for CO, IL, NJ, MA, MN.
 *
 * Sources (verified May 2026):
 *   CO 2024 = 50% of federal EITC.  HB24-1134 one-time bump (TY2025 = 35%,
 *             TY2026+ baseline = 25%).  Source: DR 0104CR rev 09/30/24 Line 5.
 *   IL 2024 = 20% of federal EITC.  PA 102-0700 (bumped 18→20% in TY2023).
 *             Source: Schedule IL-E/EITC (R-12/24) Step 4 Line 7.
 *   NJ 2024 = 40% of federal EITC (since TY2020).  Source: nj.gov/treasury/taxation/eitc.
 *   MA 2024 = 40% of federal EITC (Ch. 50 Acts 2023 bumped 30→40% in TY2023).
 *             Source: mass.gov/info-details/massachusetts-earned-income-tax-credit-eitc.
 *   MN 2024 = Working Family Credit (Schedule M1CWFC). INDEPENDENT calc:
 *             base = 4% × min(earned, $9,220);
 *             child add-ons: +$970 (1) / +$2,210 (2) / +$2,630 (3+);
 *             phase-out: 12% × (max(earned, AGI) − threshold),
 *               threshold = $31,090 non-MFJ / $36,880 MFJ;
 *             investment-income limit $11,600.
 *
 * Hand-calc strategy: for piggyback states, assert
 * `stateEitc.credit ≈ rate × eitc.appliedCredit` so the test is robust to
 * federal-EITC value drift across runs.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-state-eitc-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

function eitcEligibleScenario(state: string): TaxReturnInputs {
  // Single filer, age 30, 2 qualifying children, $20k earned income → solid
  // federal EITC base. The exact federal-EITC value is whatever the engine
  // computes; we assert state credit as a multiple of that.
  return {
    client: { filingStatus: "single", state, taxYear: 2024, dependentsUnder17: 2, taxpayerAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 20000, federalTaxWithheldBox2: 0, stateCode: state }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CO 2024 = 50% of federal EITC
// ════════════════════════════════════════════════════════════════════════════
header("CO 2024 = 50% of federal EITC (HB24-1134 one-time bump)");
{
  const r = computeTaxReturnPure(eitcEligibleScenario("CO"));
  const fedEitc = r.eitc.appliedCredit;
  check("Federal EITC > 0 (scenario qualifies)", fedEitc > 0 ? 1 : 0, 1, 0);
  check("CO state EITC = 50% × federal", r.stateEitc.credit, fedEitc * 0.50, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// IL 2024 = 20% of federal EITC
// ════════════════════════════════════════════════════════════════════════════
header("IL 2024 = 20% of federal EITC (Schedule IL-E/EITC Line 7)");
{
  const r = computeTaxReturnPure(eitcEligibleScenario("IL"));
  const fedEitc = r.eitc.appliedCredit;
  check("Federal EITC > 0", fedEitc > 0 ? 1 : 0, 1, 0);
  check("IL state EITC = 20% × federal", r.stateEitc.credit, fedEitc * 0.20, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// NJ 2024 = 40% of federal EITC
// ════════════════════════════════════════════════════════════════════════════
header("NJ 2024 = 40% of federal EITC");
{
  const r = computeTaxReturnPure(eitcEligibleScenario("NJ"));
  const fedEitc = r.eitc.appliedCredit;
  check("Federal EITC > 0", fedEitc > 0 ? 1 : 0, 1, 0);
  check("NJ state EITC = 40% × federal", r.stateEitc.credit, fedEitc * 0.40, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// MA 2024 = 40% of federal EITC
// ════════════════════════════════════════════════════════════════════════════
header("MA 2024 = 40% of federal EITC");
{
  const r = computeTaxReturnPure(eitcEligibleScenario("MA"));
  const fedEitc = r.eitc.appliedCredit;
  check("Federal EITC > 0", fedEitc > 0 ? 1 : 0, 1, 0);
  check("MA state EITC = 40% × federal", r.stateEitc.credit, fedEitc * 0.40, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// CO 2025 = 35% (HB24-1134 schedule: post-bump rate)
// ════════════════════════════════════════════════════════════════════════════
header("CO 2025 = 35% of federal EITC (HB24-1134 post-bump rate)");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "CO", taxYear: 2025, dependentsUnder17: 2, taxpayerAge: 30 },
    w2s: [{ taxYear: 2025, wagesBox1: 20000, federalTaxWithheldBox2: 0, stateCode: "CO" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2025,
  };
  const r = computeTaxReturnPure(inputs);
  const fedEitc = r.eitc.appliedCredit;
  check("Federal EITC > 0", fedEitc > 0 ? 1 : 0, 1, 0);
  check("CO 2025 state EITC = 35% × federal", r.stateEitc.credit, fedEitc * 0.35, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// MN 2024 Working Family Credit — independent calc
// ════════════════════════════════════════════════════════════════════════════

// MN Test 1 — 1 kid, earned $9,220, AGI $9,220 (peak base) — no phase-out
// Hand-calc:
//   Base = 4% × $9,220 = $368.80
//   1-kid addition = $970
//   Gross = $1,338.80
//   Phase-out base = $9,220 < $31,090 → no phase-out
//   Credit = $1,338.80
header("MN 2024 Test 1 — 1 child, earned $9,220, no phase-out");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "MN", taxYear: 2024, dependentsUnder17: 1, taxpayerAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 9220, federalTaxWithheldBox2: 0, stateCode: "MN" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("MN WFC = $1,338.80 (base $368.80 + 1-kid $970)", r.stateEitc.credit, 1338.80, 1);
}

// MN Test 2 — 2 kids, earned $9,220, AGI $9,220
// Hand-calc: base $368.80 + 2-kid $2,210 = $2,578.80; no phase-out
header("MN 2024 Test 2 — 2 children, earned $9,220, no phase-out");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "MN", taxYear: 2024, dependentsUnder17: 2, taxpayerAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 9220, federalTaxWithheldBox2: 0, stateCode: "MN" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("MN WFC = $2,578.80 (base $368.80 + 2-kid $2,210)", r.stateEitc.credit, 2578.80, 1);
}

// MN Test 3 — 1 kid, earned $35k → phase-out kicks in
// Hand-calc:
//   Base = 4% × $9,220 = $368.80 (earned > cap)
//   1-kid = $970
//   Gross = $1,338.80
//   Phase-out base = $35,000; excess = $35,000 − $31,090 = $3,910
//   Phase-out = 12% × $3,910 = $469.20
//   Credit = max(0, $1,338.80 − $469.20) = $869.60
header("MN 2024 Test 3 — 1 child, earned $35k, partial phase-out");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "MN", taxYear: 2024, dependentsUnder17: 1, taxpayerAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 35000, federalTaxWithheldBox2: 0, stateCode: "MN" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("MN WFC = $869.60 ($1,338.80 gross − $469.20 phase-out)", r.stateEitc.credit, 869.60, 1);
}

// MN Test 4 — MFJ, 2 kids, $30k earned → MFJ threshold $36,880 → no phase-out
// Hand-calc: base $368.80 + 2-kid $2,210 = $2,578.80; AGI $30k < MFJ threshold
header("MN 2024 Test 4 — MFJ, 2 children, earned $30k, no phase-out (MFJ threshold)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "MN", taxYear: 2024, dependentsUnder17: 2, taxpayerAge: 30, spouseAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 30000, federalTaxWithheldBox2: 0, stateCode: "MN" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("MN WFC MFJ = $2,578.80 (no phase-out below MFJ threshold)", r.stateEitc.credit, 2578.80, 1);
}

// MN Test 5 — Investment income $12,000 > $11,600 limit → MN WFC = $0
// Use 1099-INT to push investment income over the cap.
header("MN 2024 Test 5 — investment income exceeds $11,600 limit → $0");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "MN", taxYear: 2024, dependentsUnder17: 2, taxpayerAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 20000, federalTaxWithheldBox2: 0, stateCode: "MN" }],
    form1099s: [{ taxYear: 2024, formType: "int", interestIncome: 12000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("MN WFC = $0 (investment income > cap)", r.stateEitc.credit, 0, 0.01);
}

// MN Test 6 — 0 kids: base only, no add-on
// Single, 0 kids, age 30, $9,220 W-2 → base = $368.80 only
header("MN 2024 Test 6 — 0 children, base only ($368.80)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "MN", taxYear: 2024, dependentsUnder17: 0, taxpayerAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 9220, federalTaxWithheldBox2: 0, stateCode: "MN" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("MN WFC = $368.80 (base only, 0 kids)", r.stateEitc.credit, 368.80, 1);
}

// MN Test 7 — 3+ kids add-on
// 3 kids, earned $9,220 → base $368.80 + 3-kid $2,630 = $2,998.80
header("MN 2024 Test 7 — 3 children, $9,220 earned, max base + 3+ add-on");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "MN", taxYear: 2024, dependentsUnder17: 3, taxpayerAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 9220, federalTaxWithheldBox2: 0, stateCode: "MN" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("MN WFC = $2,998.80 (base + 3-kid $2,630)", r.stateEitc.credit, 2998.80, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Negative test — non-EITC-eligible scenario (high AGI) returns $0 for all
// piggyback states (cascades from federal ineligibility).
// ════════════════════════════════════════════════════════════════════════════
header("Piggyback states return $0 when federal EITC ineligible (high AGI)");
for (const state of ["CO", "IL", "NJ", "MA"]) {
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state, taxYear: 2024, dependentsUnder17: 0, taxpayerAge: 30 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: state }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check(`${state}: high-AGI filer → state EITC = $0`, r.stateEitc.credit, 0, 0.01);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────────────");
console.log(`PASS: ${PASS.length}`);
for (const p of PASS) console.log("  " + p);
if (FAIL.length > 0) {
  console.log(`\nFAIL: ${FAIL.length}`);
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
}
console.log(`\nAll ${PASS.length} state-EITC assertions passed.`);
