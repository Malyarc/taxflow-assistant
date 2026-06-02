/**
 * C9 — PA local Earned Income Tax (Act 511 / Act 32) tests
 * C10 — Ohio School District Income Tax (Form SD-100) tests
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  LOCAL_TAX_DATA,
  localityCodesForState,
  calculateFlatRateLocalTax,
} from "../../artifacts/api-server/src/lib/taxCalculator";

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

function localCalc(code: string, wages: number, state: string) {
  return calculateFlatRateLocalTax({
    localityCode: code,
    residentState: state,
    federalAgi: wages,
    totalWages: wages,
    filingStatus: "single",
    taxYear: 2024,
  });
}

// ── C9 — PA local EIT ─────────────────────────────────────────────────────
section("C9 — PA local EIT (Act 511 / Act 32)");

header("PA registry contains 13 inline + ~165 bulk = ~177 PA jurisdictions");
{
  const paCount = localityCodesForState("PA").length;
  // C9 bulk shipped 2026-05-27: 13 inline + ~164 bulk-registry-net-of-overlap.
  // Expect: ≥ 150 (allows future additions without breaking this test).
  checkTruthy("C9 count", `≥ 150 PA jurisdictions (got ${paCount})`, paCount >= 150, true);
}

header("C9-1 Philadelphia 3.75% × $80k W-2 = $3,000");
{
  const r = localCalc("PA-PHILADELPHIA", 80_000, "PA");
  check("C9-1", "Phila tax = $3,000", r?.netLocalTax ?? -1, 3000);
}

header("C9-2 Pittsburgh 3% × $60k = $1,800");
{
  const r = localCalc("PA-PITTSBURGH", 60_000, "PA");
  check("C9-2", "Pittsburgh tax = $1,800", r?.netLocalTax ?? -1, 1800);
}

header("C9-3 Allentown 1.975% × $50k = $987.50");
{
  const r = localCalc("PA-ALLENTOWN", 50_000, "PA");
  check("C9-3", "Allentown tax = $987.50", r?.netLocalTax ?? -1, 987.50);
}

header("C9-4 Erie 1.95% × $70k = $1,365");
{
  const r = localCalc("PA-ERIE", 70_000, "PA");
  check("C9-4", "Erie tax = $1,365", r?.netLocalTax ?? -1, 1365);
}

header("C9-5 Scranton 3.4% × $55k = $1,870");
{
  const r = localCalc("PA-SCRANTON", 55_000, "PA");
  check("C9-5", "Scranton tax = $1,870", r?.netLocalTax ?? -1, 1870);
}

header("C9-6 PA-ACT32-DEFAULT 1% × $50k = $500");
{
  const r = localCalc("PA-ACT32-DEFAULT", 50_000, "PA");
  check("C9-6", "PA Act 32 default tax = $500", r?.netLocalTax ?? -1, 500);
}

header("C9-7 PA-ACT32-DEFAULT skipped for NY resident — phantom rejection");
{
  const r = localCalc("PA-ACT32-DEFAULT", 50_000, "NY");
  checkTruthy("C9-7", "null for wrong state", r == null, true);
}

header("C9 E2E: PA client with Philly EIT — local tax flows through pipeline");
{
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 80_000, stateCode: "PA" } as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [],
    taxYear: 2024,
    client: {
      filingStatus: "single", state: "PA", taxYear: 2024,
      localityCode: "PA-PHILADELPHIA",
    } as TaxReturnInputs["client"],
  };
  const r = computeTaxReturnPure(inputs);
  // Philly EIT 3.75% × $80k = $3,000 reported as separate localTaxLiability.
  check("C9 E2E", "Philly local tax = $3,000",
    (r as unknown as { localTaxLiability: number }).localTaxLiability, 3000);
}

// ── C10 — OH School District Income Tax ──────────────────────────────────
section("C10 — Ohio School District Income Tax (Form SD-100)");

header("OH registry contains 25 inline + ~226 bulk SDs (post C10-bulk shipping)");
{
  const ohCount = localityCodesForState("OH").length;
  // C10 bulk shipped 2026-05-27: 25 inline (10 cities + 15 inline SDs) + 226
  // bulk-registry-net-of-overlap. Expect: ≥ 200 (allows future additions).
  checkTruthy("C10 count", `≥ 200 OH jurisdictions (got ${ohCount})`, ohCount >= 200, true);
}

header("C10-1 Olentangy LSD 0.75% × $80k = $600");
{
  const r = localCalc("OH-SD-OLENTANGY", 80_000, "OH");
  check("C10-1", "Olentangy SDIT = $600", r?.netLocalTax ?? -1, 600);
}

header("C10-2 Pickerington LSD 1% × $60k = $600");
{
  const r = localCalc("OH-SD-PICKERINGTON", 60_000, "OH");
  check("C10-2", "Pickerington SDIT = $600", r?.netLocalTax ?? -1, 600);
}

header("C10-3 Liberty-Union 1.75% × $50k = $875");
{
  const r = localCalc("OH-SD-LIBERTY-UNION", 50_000, "OH");
  check("C10-3", "Liberty-Union SDIT = $875", r?.netLocalTax ?? -1, 875);
}

header("C10-4 Mason (no SDIT) = $0");
{
  const r = localCalc("OH-SD-MASON", 100_000, "OH");
  check("C10-4", "Mason SDIT = $0", r?.netLocalTax ?? -1, 0);
}

header("C10-5 Tri-Valley 1.25% × $45k = $562.50");
{
  const r = localCalc("OH-SD-TRI-VALLEY", 45_000, "OH");
  check("C10-5", "Tri-Valley SDIT = $562.50", r?.netLocalTax ?? -1, 562.50);
}

header("LOCAL_TAX_DATA total ≥ 70");
{
  const totalCount = Object.keys(LOCAL_TAX_DATA).length;
  // 24 MD + 10 OH cities + 10 IN + 13 PA + 15 OH SDs + 5 KY (#7) = 77
  check("Growth", `total local jurisdictions = ${totalCount}`, totalCount, 77);
}

header("C10 E2E: OH client with Olentangy SDIT — local tax flows through");
{
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 80_000, stateCode: "OH" } as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [],
    taxYear: 2024,
    client: {
      filingStatus: "single", state: "OH", taxYear: 2024,
      localityCode: "OH-SD-OLENTANGY",
    } as TaxReturnInputs["client"],
  };
  const r = computeTaxReturnPure(inputs);
  // Olentangy SDIT 0.75% × $80k = $600
  check("C10 E2E", "Olentangy local tax = $600",
    (r as unknown as { localTaxLiability: number }).localTaxLiability, 600);
}

console.log(`\nPASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  [${f.rule}] ${f.label}  expected=${f.expected}  actual=${f.actual}`);
  }
  process.exit(1);
}
console.log("\nALL C9 + C10 LOCAL TAX TESTS PASS");
