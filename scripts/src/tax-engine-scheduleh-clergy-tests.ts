/**
 * T1.2 — Schedule H (household employment tax) + clergy housing SE edge —
 * hand-calc'd against IRS Schedule H / Pub 926 and IRC §107/§1402(a)(8).
 *
 * Pure engine; no API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-scheduleh-clergy-tests.ts
 *
 * Schedule H (2024): FICA when cash wages ≥ $2,700 → 12.4% SS (to $168,600) +
 *   2.9% Medicare; +0.9% over $200k; FUTA 0.6% on first $7,000 when wages ≥$1,000.
 * Clergy: housing allowance is income-tax-EXEMPT (§107) but SE-taxable (§1402(a)(8)).
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { calculateScheduleH } from "../../artifacts/api-server/src/lib/scheduleH";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.02): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

// ── PART 1 — calculateScheduleH (pure) ──────────────────────────────────────

// SH1 — $25,000 cash wages (2024). FICA = 25,000·0.153 = $3,825; FUTA =
//   7,000·0.006 = $42 → total $3,867. (SS 3,100 + Medicare 725 + FUTA 42.)
{
  const r = calculateScheduleH({ cashWages: 25000, taxYear: 2024 });
  check("SH1 total", r.total, 3867);
  check("SH1 social security", r.socialSecurityTax, 3100);
  check("SH1 medicare", r.medicareTax, 725);
  check("SH1 FUTA", r.futaTax, 42);
}
// SH2 — $2,000 (below the $2,700 FICA threshold) → no FICA; FUTA only = $12.
{
  const r = calculateScheduleH({ cashWages: 2000, taxYear: 2024 });
  check("SH2 no FICA below threshold", r.socialSecurityTax + r.medicareTax, 0);
  check("SH2 FUTA only", r.total, 12);
}
// SH3 — $800 (below the $1,000 FUTA trigger) → nothing.
{
  const r = calculateScheduleH({ cashWages: 800, taxYear: 2024 });
  check("SH3 below all thresholds", r.total, 0);
}
// SH4 — $250,000 wages: SS capped at the $168,600 base; +0.9% over $200k.
//   SS=168,600·0.124=$20,906.40; Medicare=250,000·0.029=$7,250; addl=50,000·0.009=$450;
//   FUTA=$42 → total $28,648.40.
{
  const r = calculateScheduleH({ cashWages: 250000, taxYear: 2024 });
  check("SH4 SS capped at wage base", r.socialSecurityTax, 20906.40);
  check("SH4 additional Medicare over $200k", r.additionalMedicareTax, 450);
  check("SH4 total", r.total, 28648.40);
}
// SH5 — 2025 threshold $2,800: $2,750 wages → no FICA, FUTA $16.50.
{
  const r = calculateScheduleH({ cashWages: 2750, taxYear: 2025 });
  check("SH5 below 2025 FICA threshold", r.socialSecurityTax, 0);
  check("SH5 FUTA only", r.total, 16.5);
}

// ── PART 2 — End-to-end via computeTaxReturnPure ────────────────────────────

function baseInputs(extra: Partial<TaxReturnInputs> = {}, wages = 40000): TaxReturnInputs {
  const client = {
    id: 1, firstName: "T", lastName: "T12", email: "t@e.com", phone: null,
    filingStatus: "single", state: "FL", taxYear: 2024,
    dependentsUnder17: 0, otherDependents: 0, dependentsForCareCredit: 0,
    taxpayerAge: 45, spouseAge: null, spouseEarnedIncome: null,
    hsaIsFamilyCoverage: false, iraCoveredByWorkplacePlan: false,
    eligibleEducatorCount: 0, acaAnnualPremium: null, acaAnnualSlcsp: null,
    acaAdvanceAptc: null, acaHouseholdSize: null,
    rentalActiveParticipant: true, rentalRealEstateProfessional: false,
    localityCode: null, socialSecurityBenefits: null,
    mfsLivedApartAllYear: false, isKiddieTaxFiler: false,
    parentsTopMarginalRate: null, priorYearItemized: null,
    residencyChangedInYear: false, formerState: null, residencyChangeDate: null,
    notes: null, createdAt: new Date(), updatedAt: new Date(),
  };
  const w2 = {
    id: 1, clientId: 1, taxYear: 2024, documentId: null,
    employerName: "Emp", employerEin: null,
    wagesBox1: String(wages), federalWithholdingBox2: "0",
    socialSecurityWagesBox3: String(wages), socialSecurityTaxBox4: "0",
    medicareWagesBox5: String(wages), medicareTaxBox6: "0",
    socialSecurityTipsBox7: "0", allocatedTipsBox8: "0",
    dependentCareBenefitsBox10: "0", nonqualifiedPlansBox11: "0",
    box12aCode: null, box12aAmount: "0", box12bCode: null, box12bAmount: "0",
    box12cCode: null, box12cAmount: "0", box12dCode: null, box12dAmount: "0",
    statutoryEmployeeBox13: false, retirementPlanBox13: false, thirdPartySickPayBox13: false,
    box14Description: null, box14Amount: "0",
    stateBox15: "FL", stateWagesBox16: String(wages), stateTaxBox17: "0",
    localWagesBox18: "0", localTaxBox19: "0", localityNameBox20: null,
    spouse: null, createdAt: new Date(), updatedAt: new Date(),
  };
  return {
    client: client as TaxReturnInputs["client"],
    w2s: [w2 as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [], adjustments: [], taxYear: 2024, ...extra,
  };
}
function adj(type: string, amount: number): TaxReturnInputs["adjustments"][number] {
  return {
    id: Math.floor(Math.random() * 1e9), clientId: 1, adjustmentType: type,
    amount: String(amount), description: `t ${type}`, category: null,
    isApplied: true, createdAt: new Date(), updatedAt: new Date(),
  } as unknown as TaxReturnInputs["adjustments"][number];
}

// E1 — Schedule H: $25k household wages adds $3,867 to total federal liability.
{
  const base = computeTaxReturnPure(baseInputs());
  const r = computeTaxReturnPure(baseInputs({ adjustments: [adj("household_employee_cash_wages", 25000)] }));
  check("E1 Schedule H tax reported", r.scheduleH.total, 3867);
  check("E1 Schedule H raises federal liability by $3,867", r.federalTaxLiability - base.federalTaxLiability, 3867);
  check("E1 Schedule H does not touch AGI", r.adjustedGrossIncome, base.adjustedGrossIncome);
}

// E2 — Clergy housing allowance: SE-taxed but income-tax-EXEMPT.
//   $40k W-2 minister salary + $30k housing. SE = 30,000·0.9235·0.153 = $4,238.87.
//   Housing is NOT in AGI; AGI = 40,000 − half-SE 2,119.43 = $37,880.57.
{
  const base = computeTaxReturnPure(baseInputs());
  const r = computeTaxReturnPure(baseInputs({ adjustments: [adj("clergy_housing_allowance", 30000)] }));
  check("E2 clergy housing → SE tax", r.selfEmploymentTax, 4238.87, 0.5);
  check("E2 housing EXCLUDED from AGI (only half-SE reduces it)", r.adjustedGrossIncome, 37880.57, 1);
  check("E2 housing did NOT add $30k to AGI", r.adjustedGrossIncome < base.adjustedGrossIncome ? 1 : 0, 1);
  check("E2 base (no clergy) has no SE tax", base.selfEmploymentTax, 0);
}

console.log(`\nT1.2 — Schedule H + clergy housing tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
process.exit(FAIL.length > 0 ? 1 : 0);
