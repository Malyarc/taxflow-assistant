/**
 * C9 — PA local EIT BULK registry tests (DCED PSD-code-keyed lookup).
 * C10 — OH SDIT BULK registry tests (tax.ohio.gov SDIT-code-keyed lookup).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/tax-engine-c9-c10-bulk-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  calculateFlatRateLocalTax,
  localityCodesForState,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import {
  PA_EIT_REGISTRY_COUNT,
  lookupPaLocalEit,
} from "../../artifacts/api-server/src/lib/paEitRates";
import {
  OH_SCHOOL_DISTRICT_REGISTRY_COUNT,
  lookupOhSchoolDistrict,
} from "../../artifacts/api-server/src/lib/ohSchoolDistricts";

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

function paLocalCalc(code: string, wages: number) {
  return calculateFlatRateLocalTax({
    localityCode: code, residentState: "PA", federalAgi: wages,
    totalWages: wages, filingStatus: "single", taxYear: 2024,
  });
}
function ohLocalCalc(code: string, wages: number, ohTraditionalBase?: number) {
  return calculateFlatRateLocalTax({
    localityCode: code, residentState: "OH", federalAgi: wages,
    totalWages: wages, filingStatus: "single", taxYear: 2024,
    ohTraditionalBase,
  });
}

// ── C9 — PA bulk registry sanity ───────────────────────────────────────────
section("C9 — PA bulk registry sanity");

header("PA registry has ≥ 150 entries");
{
  checkTruthy("C9 bulk", `PA_EIT_REGISTRY_COUNT = ${PA_EIT_REGISTRY_COUNT}`, PA_EIT_REGISTRY_COUNT >= 150, true);
}

header("PA localityCodesForState returns ≥ 150 PA entries");
{
  const count = localityCodesForState("PA").length;
  checkTruthy("C9 list", `≥ 150 PA codes (got ${count})`, count >= 150, true);
}

header("C9 bulk-1 — King of Prussia (Act 32 default 1%) × $90k → $900");
{
  const r = paLocalCalc("PA-KING_OF_PRUSSIA", 90_000);
  check("C9 bulk-1", "$900", r?.netLocalTax ?? -1, 900);
}

header("C9 bulk-2 — Williamsport (1.5%) × $60k → $900");
{
  const r = paLocalCalc("PA-WILLIAMSPORT", 60_000);
  check("C9 bulk-2", "$900", r?.netLocalTax ?? -1, 900);
}

header("C9 bulk-3 — State College (1.25%) × $50k → $625");
{
  const r = paLocalCalc("PA-STATE_COLLEGE", 50_000);
  check("C9 bulk-3", "$625", r?.netLocalTax ?? -1, 625);
}

header("C9 bulk-4 — Johnstown (2.0%) × $45k → $900");
{
  const r = paLocalCalc("PA-JOHNSTOWN", 45_000);
  check("C9 bulk-4", "$900", r?.netLocalTax ?? -1, 900);
}

header("C9 bulk-5 — Easton (1.95%) × $80k → $1,560");
{
  const r = paLocalCalc("PA-EASTON", 80_000);
  check("C9 bulk-5", "$1,560", r?.netLocalTax ?? -1, 1560);
}

header("C9 bulk-6 — Mount Lebanon (Act 32 default) × $100k → $1,000");
{
  const r = paLocalCalc("PA-MOUNT_LEBANON", 100_000);
  check("C9 bulk-6", "$1,000", r?.netLocalTax ?? -1, 1000);
}

header("C9 bulk-7 — Sharon (1.75%) × $40k → $700");
{
  const r = paLocalCalc("PA-SHARON", 40_000);
  check("C9 bulk-7", "$700", r?.netLocalTax ?? -1, 700);
}

header("C9 bulk-8 — Levittown (1.25%) × $70k → $875");
{
  const r = paLocalCalc("PA-LEVITTOWN", 70_000);
  check("C9 bulk-8", "$875", r?.netLocalTax ?? -1, 875);
}

header("C9 bulk-9 — Hermitage (1.5%) × $55k → $825");
{
  const r = paLocalCalc("PA-HERMITAGE", 55_000);
  check("C9 bulk-9", "$825", r?.netLocalTax ?? -1, 825);
}

header("C9 bulk-10 — Dunmore (3.0%) × $50k → $1,500");
{
  const r = paLocalCalc("PA-DUNMORE", 50_000);
  check("C9 bulk-10", "$1,500", r?.netLocalTax ?? -1, 1500);
}

header("C9 bulk-11 — PSD-code lookup (510101 = Philadelphia)");
{
  const r = paLocalCalc("PA-PSD-510101", 80_000);
  check("C9 bulk-11 PSD", "$3,000 (Philly 3.75%)", r?.netLocalTax ?? -1, 3000);
}

header("C9 bulk-12 — Phantom code rejected when not in registry");
{
  const r = paLocalCalc("PA-NONEXISTENT_TOWN", 50_000);
  checkTruthy("C9 bulk-12", "null for unknown muni", r == null, true);
}

header("C9 bulk-13 — State mismatch rejected (PA muni for NY resident)");
{
  const r = calculateFlatRateLocalTax({
    localityCode: "PA-WILLIAMSPORT", residentState: "NY", federalAgi: 50_000,
    totalWages: 50_000, filingStatus: "single", taxYear: 2024,
  });
  checkTruthy("C9 bulk-13", "null for wrong state", r == null, true);
}

header("C9 bulk-14 — lookupPaLocalEit returns full entry by name");
{
  const entry = lookupPaLocalEit("PA-PITTSBURGH");
  checkTruthy("C9 lookup", "entry returned", entry != null, true);
  check("C9 lookup", "Pittsburgh combinedRate = 0.03", entry?.combinedRate ?? -1, 0.03, 0.001);
}

// ── C10 — OH SDIT bulk registry sanity ─────────────────────────────────────
section("C10 — OH SDIT bulk registry sanity");

header("OH SD registry has ≥ 200 entries");
{
  checkTruthy("C10 bulk", `OH_SCHOOL_DISTRICT_REGISTRY_COUNT = ${OH_SCHOOL_DISTRICT_REGISTRY_COUNT}`, OH_SCHOOL_DISTRICT_REGISTRY_COUNT >= 200, true);
}

header("OH localityCodesForState returns ≥ 200 entries (cities + SDs)");
{
  const count = localityCodesForState("OH").length;
  checkTruthy("C10 list", `≥ 200 OH codes (got ${count})`, count >= 200, true);
}

header("C10 bulk-1 — Olentangy LSD (earned-income 0.75%) × $80k = $600");
{
  // SD code 1151
  const r = ohLocalCalc("OH-SD-1151", 80_000);
  check("C10 bulk-1", "Olentangy = $600", r?.netLocalTax ?? -1, 600);
}

header("C10 bulk-2 — Pickerington LSD (earned-income 1%) × $60k = $600");
{
  const r = ohLocalCalc("OH-SD-1160", 60_000);
  check("C10 bulk-2", "Pickerington = $600", r?.netLocalTax ?? -1, 600);
}

header("C10 bulk-3 — Liberty-Union Thurston LSD (1.75% TRADITIONAL) × $70k = $1,225 (uses federalAgi − OH std ded base)");
{
  // OH has no std ded for individual filer; OH uses personal exemption (handled via state-tax not std-ded).
  // OH std ded = 0 → traditional base ≈ federal AGI = $70k. 1.75% × $70k = $1,225.
  const r = ohLocalCalc("OH-SD-1105", 70_000);
  check("C10 bulk-3", "Liberty-Union = $1,225", r?.netLocalTax ?? -1, 1225);
}

header("C10 bulk-4 — Liberty-Union with CPA-supplied ohTraditionalBase = $60k → $1,050");
{
  // Hand-calc: 1.75% × $60,000 = $1,050.
  const r = ohLocalCalc("OH-SD-1105", 70_000, 60_000);
  check("C10 bulk-4", "Liberty-Union ohTraditionalBase = $1,050", r?.netLocalTax ?? -1, 1050);
}

header("C10 bulk-5 — Worthington CSD (1% earned-income, NEW 2024) × $90k = $900");
{
  const r = ohLocalCalc("OH-SD-1222", 90_000);
  check("C10 bulk-5", "Worthington = $900", r?.netLocalTax ?? -1, 900);
}

header("C10 bulk-6 — No-SDIT district (Hilliard CSD 8201) × $100k = $0");
{
  const r = ohLocalCalc("OH-SD-8201", 100_000);
  check("C10 bulk-6", "Hilliard no SDIT = $0", r?.netLocalTax ?? -1, 0);
}

header("C10 bulk-7 — Granville EVSD (0.75% earned-income) × $80k = $600");
{
  const r = ohLocalCalc("OH-SD-7301", 80_000);
  check("C10 bulk-7", "Granville = $600", r?.netLocalTax ?? -1, 600);
}

header("C10 bulk-8 — Indian Lake LSD (1.5% traditional) × $50k = $750");
{
  const r = ohLocalCalc("OH-SD-8901", 50_000);
  check("C10 bulk-8", "Indian Lake = $750", r?.netLocalTax ?? -1, 750);
}

header("C10 bulk-9 — Madison-Plains LSD (1.75% traditional) × $40k = $700");
{
  const r = ohLocalCalc("OH-SD-1114", 40_000);
  check("C10 bulk-9", "Madison-Plains = $700", r?.netLocalTax ?? -1, 700);
}

header("C10 bulk-10 — Name-keyed lookup (OH-SD-OLENTANGY_LSD)");
{
  const r = ohLocalCalc("OH-SD-OLENTANGY_LSD", 80_000);
  check("C10 bulk-10 name", "Olentangy by name = $600", r?.netLocalTax ?? -1, 600);
}

header("C10 bulk-11 — Phantom SD code returns null");
{
  const r = ohLocalCalc("OH-SD-9999X", 80_000);
  checkTruthy("C10 bulk-11", "null for unknown SD", r == null, true);
}

header("C10 bulk-12 — State mismatch (OH SD for PA resident) → null");
{
  const r = calculateFlatRateLocalTax({
    localityCode: "OH-SD-1151", residentState: "PA", federalAgi: 80_000,
    totalWages: 80_000, filingStatus: "single", taxYear: 2024,
  });
  checkTruthy("C10 bulk-12", "null for wrong state", r == null, true);
}

header("C10 bulk-13 — lookupOhSchoolDistrict returns base info");
{
  const entry = lookupOhSchoolDistrict("OH-SD-1151");
  checkTruthy("C10 lookup", "entry returned", entry != null, true);
  check("C10 lookup", "Olentangy rate = 0.0075", entry?.rate ?? -1, 0.0075, 0.0001);
}

// ── E2E pipeline tests for bulk lookups ───────────────────────────────────
section("E2E pipeline — bulk PA + OH SD codes flow through computeTaxReturnPure");

header("E2E C9 bulk: PA resident with State College locality → $625 local tax");
{
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 50_000, stateCode: "PA" } as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [],
    taxYear: 2024,
    client: {
      filingStatus: "single", state: "PA", taxYear: 2024,
      localityCode: "PA-STATE_COLLEGE",
    } as TaxReturnInputs["client"],
  };
  const r = computeTaxReturnPure(inputs);
  check("E2E C9 bulk", "State College tax = $625",
    (r as unknown as { localTaxLiability: number }).localTaxLiability, 625);
}

header("E2E C10 bulk: OH resident with Liberty-Union (1.75% traditional) → $1,400");
{
  // Hand-calc: AGI $80k, traditional base = federalAgi − OH std ded (0) = $80k. 1.75% × $80k = $1,400.
  const inputs: TaxReturnInputs = {
    w2s: [{ taxYear: 2024, wagesBox1: 80_000, stateCode: "OH" } as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [],
    taxYear: 2024,
    client: {
      filingStatus: "single", state: "OH", taxYear: 2024,
      localityCode: "OH-SD-1105",
    } as TaxReturnInputs["client"],
  };
  const r = computeTaxReturnPure(inputs);
  check("E2E C10 bulk", "Liberty-Union tax = $1,400",
    (r as unknown as { localTaxLiability: number }).localTaxLiability, 1400);
}

console.log(`\nPASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  [${f.rule}] ${f.label}  expected=${f.expected}  actual=${f.actual}`);
  }
  process.exit(1);
}
console.log("\nALL C9 + C10 BULK TESTS PASS");
