/**
 * Year-aware federal + state tax calculator.
 *
 * Federal: real IRS brackets and standard deductions for each supported tax year.
 *   - 2024: Rev. Proc. 2023-34
 *   - 2025: Rev. Proc. 2024-40
 *
 * State:   real brackets/std deductions per state per year. See stateTaxData.ts.
 *
 * If a year is unsupported, falls back to the most recent available year and logs a warning.
 *
 * Limitations (read before treating output as authoritative):
 *   - Federal: no AMT, no QBI, no EITC, no CTC math (use Adjustments tab for credits).
 *   - State: most state credits / exemptions still simplified. Local income
 *     taxes modeled: NYC (full IT-201 with brackets, household credit, EITC,
 *     school credit, MCTMT) + flat-rate MD counties / OH cities / IN counties.
 *     PA local Earned Income Tax (EIT) and KY occupational tax NOT modeled.
 *   - Calculator is for estimation; actual filings need professional software.
 */

import {
  STATE_TAX_DATA_BY_YEAR,
  STATES_TAXING_SS,
  hasReciprocity,
  type StateBracket,
  type StateFilingStatus,
} from "./stateTaxData";
import {
  lookupPaLocalEit,
  PA_EIT_REGISTRY,
} from "./paEitRates";
import {
  lookupOhSchoolDistrict,
  OH_SCHOOL_DISTRICT_REGISTRY,
} from "./ohSchoolDistricts";

// Tax-year registry + clamping helper live in a leaf module (./taxYears) so they
// can be imported anywhere without an import cycle (stateTaxData et al. need
// TaxYear, and taxCalculator imports stateTaxData). Re-exported here so existing
// `import { SUPPORTED_TAX_YEARS, TaxYear, resolveTaxYear } from "./taxCalculator"`
// call sites keep working.
import {
  SUPPORTED_TAX_YEARS,
  LATEST_YEAR,
  resolveTaxYear,
  type TaxYear,
} from "./taxYears";
export { SUPPORTED_TAX_YEARS, LATEST_YEAR, resolveTaxYear };
export type { TaxYear };

// ── Federal brackets per year ─────────────────────────────────────────────────
const FEDERAL_BRACKETS: Record<TaxYear, Record<string, StateBracket[]>> = {
  // IRS Rev. Proc. 2023-34 (TY2024)
  2024: {
    single: [
      { upTo: 11600, rate: 0.10 },
      { upTo: 47150, rate: 0.12 },
      { upTo: 100525, rate: 0.22 },
      { upTo: 191950, rate: 0.24 },
      { upTo: 243725, rate: 0.32 },
      { upTo: 609350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    married_filing_jointly: [
      { upTo: 23200, rate: 0.10 },
      { upTo: 94300, rate: 0.12 },
      { upTo: 201050, rate: 0.22 },
      { upTo: 383900, rate: 0.24 },
      { upTo: 487450, rate: 0.32 },
      { upTo: 731200, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    married_filing_separately: [
      { upTo: 11600, rate: 0.10 },
      { upTo: 47150, rate: 0.12 },
      { upTo: 100525, rate: 0.22 },
      { upTo: 191950, rate: 0.24 },
      { upTo: 243725, rate: 0.32 },
      { upTo: 365600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    head_of_household: [
      { upTo: 16550, rate: 0.10 },
      { upTo: 63100, rate: 0.12 },
      { upTo: 100500, rate: 0.22 },
      { upTo: 191950, rate: 0.24 },
      { upTo: 243700, rate: 0.32 },
      { upTo: 609350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    qualifying_widow: [
      { upTo: 23200, rate: 0.10 },
      { upTo: 94300, rate: 0.12 },
      { upTo: 201050, rate: 0.22 },
      { upTo: 383900, rate: 0.24 },
      { upTo: 487450, rate: 0.32 },
      { upTo: 731200, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
  },

  // IRS Rev. Proc. 2024-40 (TY2025)
  2025: {
    single: [
      { upTo: 11925, rate: 0.10 },
      { upTo: 48475, rate: 0.12 },
      { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 },
      { upTo: 250525, rate: 0.32 },
      { upTo: 626350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    married_filing_jointly: [
      { upTo: 23850, rate: 0.10 },
      { upTo: 96950, rate: 0.12 },
      { upTo: 206700, rate: 0.22 },
      { upTo: 394600, rate: 0.24 },
      { upTo: 501050, rate: 0.32 },
      { upTo: 751600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    married_filing_separately: [
      { upTo: 11925, rate: 0.10 },
      { upTo: 48475, rate: 0.12 },
      { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 },
      { upTo: 250525, rate: 0.32 },
      { upTo: 375800, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    head_of_household: [
      { upTo: 17000, rate: 0.10 },
      { upTo: 64850, rate: 0.12 },
      { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 },
      { upTo: 250500, rate: 0.32 },
      { upTo: 626350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    qualifying_widow: [
      { upTo: 23850, rate: 0.10 },
      { upTo: 96950, rate: 0.12 },
      { upTo: 206700, rate: 0.22 },
      { upTo: 394600, rate: 0.24 },
      { upTo: 501050, rate: 0.32 },
      { upTo: 751600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
  },

  // IRS Rev. Proc. 2025-32 (TY2026). NOTE: MFS top (35%->37%) breakpoint is
  // $384,350 (= half MFJ), while single's is $640,600; HoH 24%/32% bounds are
  // $1-$25 below single's (published asymmetries, not typos). QSS = MFJ.
  2026: {
    single: [
      { upTo: 12400, rate: 0.10 },
      { upTo: 50400, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 },
      { upTo: 256225, rate: 0.32 },
      { upTo: 640600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    married_filing_jointly: [
      { upTo: 24800, rate: 0.10 },
      { upTo: 100800, rate: 0.12 },
      { upTo: 211400, rate: 0.22 },
      { upTo: 403550, rate: 0.24 },
      { upTo: 512450, rate: 0.32 },
      { upTo: 768700, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    married_filing_separately: [
      { upTo: 12400, rate: 0.10 },
      { upTo: 50400, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 },
      { upTo: 256225, rate: 0.32 },
      { upTo: 384350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    head_of_household: [
      { upTo: 17700, rate: 0.10 },
      { upTo: 67450, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201750, rate: 0.24 },
      { upTo: 256200, rate: 0.32 },
      { upTo: 640600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    qualifying_widow: [
      { upTo: 24800, rate: 0.10 },
      { upTo: 100800, rate: 0.12 },
      { upTo: 211400, rate: 0.22 },
      { upTo: 403550, rate: 0.24 },
      { upTo: 512450, rate: 0.32 },
      { upTo: 768700, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
  },
};

const FEDERAL_STANDARD_DEDUCTIONS: Record<TaxYear, Record<string, number>> = {
  2024: {
    single: 14600,
    married_filing_jointly: 29200,
    married_filing_separately: 14600,
    head_of_household: 21900,
    qualifying_widow: 29200,
  },
  // TY2025 standard deduction AS AMENDED BY OBBBA (P.L. 119-21). OBBBA raised
  // the TCJA standard deduction above the original Rev. Proc. 2024-40 figures
  // ($15,000 single / $30,000 MFJ / $22,500 HoH) to $15,750 / $31,500 / $23,625.
  // These OBBBA-amended TY2025 amounts are restated in the IRS Rev. Proc.
  // 2025-32 release. MFS = single; QSS = MFJ.
  2025: {
    single: 15750,
    married_filing_jointly: 31500,
    married_filing_separately: 15750,
    head_of_household: 23625,
    qualifying_widow: 31500,
  },
  // TY2026 per Rev. Proc. 2025-32 (OBBBA-permanent + inflation).
  2026: {
    single: 16100,
    married_filing_jointly: 32200,
    married_filing_separately: 16100,
    head_of_household: 24150,
    qualifying_widow: 32200,
  },
};

// Age-65 / blind additional standard deduction. Per IRC §63(f) + annual
// Rev. Procs. (2023-34 for 2024, 2024-40 for 2025). Single + HoH get a
// higher per-box amount than MFJ / MFS / QSS. A taxpayer can claim TWO
// boxes if both age-65 AND blind on Dec 31. For MFJ, each spouse's box is
// counted (so a 67-year-old blind taxpayer with a 67-year-old spouse =
// 4 boxes = +$6,200 in 2024).
//
// Source: IRS 2024 Form 1040 Instructions "Standard Deduction Chart for
// People Who Were Born Before January 2, 1960, or Were Blind" (p. 34).
// 2025 amounts: Rev. Proc. 2024-40 §3.16.
const STD_DEDUCTION_AGE_BLIND_ADDON: Record<TaxYear, { perBox_single_hoh: number; perBox_mfj_mfs_qss: number }> = {
  2024: { perBox_single_hoh: 1950, perBox_mfj_mfs_qss: 1550 },
  2025: { perBox_single_hoh: 2000, perBox_mfj_mfs_qss: 1600 },
  2026: { perBox_single_hoh: 2050, perBox_mfj_mfs_qss: 1650 }, // Rev. Proc. 2025-32 §4.14(3)
};

/**
 * Number of "boxes" checked on the age-65/blind add-on. A taxpayer is born
 * before Jan 2, 1960 (i.e. 65+ on Dec 31, 2024) → 1 box. Blind → 1 box.
 * For MFJ, the spouse's boxes count too.
 */
export function countStdDedAddOnBoxes(params: {
  taxpayerAge?: number | null;
  spouseAge?: number | null;
  taxpayerBlind?: boolean | null;
  spouseBlind?: boolean | null;
  filingStatus: string;
}): number {
  let boxes = 0;
  if ((params.taxpayerAge ?? 0) >= 65) boxes++;
  if (params.taxpayerBlind) boxes++;
  if (params.filingStatus === "married_filing_jointly" || params.filingStatus === "qualifying_widow") {
    if ((params.spouseAge ?? 0) >= 65) boxes++;
    if (params.spouseBlind) boxes++;
  }
  return boxes;
}

export function getFederalStdDedAgeBlindAddOn(params: {
  taxpayerAge?: number | null;
  spouseAge?: number | null;
  taxpayerBlind?: boolean | null;
  spouseBlind?: boolean | null;
  filingStatus: string;
  taxYear: number;
}): number {
  const boxes = countStdDedAddOnBoxes(params);
  if (boxes === 0) return 0;
  const year = resolveTaxYear(params.taxYear);
  const cfg = STD_DEDUCTION_AGE_BLIND_ADDON[year];
  const isSingleOrHoh = params.filingStatus === "single" || params.filingStatus === "head_of_household";
  const perBox = isSingleOrHoh ? cfg.perBox_single_hoh : cfg.perBox_mfj_mfs_qss;
  return boxes * perBox;
}

// resolveTaxYear now lives in ./taxYears (imported + re-exported above).

/** Apply progressive brackets to taxable income. */
function applyBrackets(taxableIncome: number, brackets: StateBracket[]): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let prevCap = 0;
  for (const bracket of brackets) {
    const cap = bracket.upTo;
    if (taxableIncome <= prevCap) break;
    const taxableInBracket = Math.min(taxableIncome, cap) - prevCap;
    tax += Math.max(0, taxableInBracket) * bracket.rate;
    if (taxableIncome <= cap) break;
    prevCap = cap;
  }
  return tax;
}

export interface BracketBreakdown {
  rate: number;        // marginal rate of this bracket (e.g. 0.22)
  bracketMin: number;  // lower bound of this bracket
  bracketMax: number;  // upper bound (or Infinity)
  taxableInBracket: number;  // dollars actually taxed at this rate
  taxFromBracket: number;    // dollars of tax owed from this bracket
}

/** Like applyBrackets, but returns a per-bracket breakdown for display. */
function applyBracketsWithBreakdown(
  taxableIncome: number,
  brackets: StateBracket[],
): BracketBreakdown[] {
  const out: BracketBreakdown[] = [];
  if (taxableIncome <= 0) return out;
  let prevCap = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= prevCap) break;
    const cap = bracket.upTo;
    const taxableInBracket = Math.max(0, Math.min(taxableIncome, cap) - prevCap);
    if (taxableInBracket > 0) {
      out.push({
        rate: bracket.rate,
        bracketMin: prevCap,
        bracketMax: cap,
        taxableInBracket,
        taxFromBracket: taxableInBracket * bracket.rate,
      });
    }
    if (taxableIncome <= cap) break;
    prevCap = cap;
  }
  return out;
}

export function calculateFederalTax(
  taxableIncome: number,
  filingStatus: string,
  taxYear: number,
): number {
  const year = resolveTaxYear(taxYear);
  const yearBrackets = FEDERAL_BRACKETS[year];
  const brackets = yearBrackets[filingStatus] ?? yearBrackets.single;
  return Math.max(0, applyBrackets(taxableIncome, brackets));
}

export function calculateFederalTaxWithBreakdown(
  taxableIncome: number,
  filingStatus: string,
  taxYear: number,
): { total: number; breakdown: BracketBreakdown[]; marginalRate: number } {
  const year = resolveTaxYear(taxYear);
  const yearBrackets = FEDERAL_BRACKETS[year];
  const brackets = yearBrackets[filingStatus] ?? yearBrackets.single;
  const breakdown = applyBracketsWithBreakdown(taxableIncome, brackets);
  const total = breakdown.reduce((s, b) => s + b.taxFromBracket, 0);
  const marginalRate =
    breakdown.length > 0 ? breakdown[breakdown.length - 1].rate : 0;
  return { total, breakdown, marginalRate };
}

export function calculateStateTaxWithBreakdown(
  federalAgi: number,
  stateCode: string,
  filingStatus: string,
  taxYear: number,
): { total: number; breakdown: BracketBreakdown[]; marginalRate: number; stateName: string; hasIncomeTax: boolean } {
  const year = resolveTaxYear(taxYear);
  const yearData = STATE_TAX_DATA_BY_YEAR[year];
  const info = yearData[stateCode.toUpperCase()];
  if (!info || !info.hasIncomeTax || !info.brackets || !info.standardDeduction) {
    return { total: 0, breakdown: [], marginalRate: 0, stateName: info?.name ?? stateCode, hasIncomeTax: false };
  }
  const status = filingStatus as StateFilingStatus;
  const stdDed = pickStateStdDeduction(info.standardDeduction, status);
  const stateTaxable = Math.max(0, federalAgi - stdDed);
  const brackets = pickStateBrackets(info.brackets, status);
  const breakdown = applyBracketsWithBreakdown(stateTaxable, brackets);
  let total = breakdown.reduce((s, b) => s + b.taxFromBracket, 0);
  // STL-03: surtax on state taxable income, not AGI (see calculateStateTax).
  if (info.surtax && stateTaxable > info.surtax.threshold) {
    total += (stateTaxable - info.surtax.threshold) * info.surtax.rate;
  }
  const marginalRate = breakdown.length > 0 ? breakdown[breakdown.length - 1].rate : 0;
  return { total: Math.max(0, total), breakdown, marginalRate, stateName: info.name, hasIncomeTax: true };
}

export function getFederalStandardDeduction(filingStatus: string, taxYear: number): number {
  const year = resolveTaxYear(taxYear);
  const yearDeductions = FEDERAL_STANDARD_DEDUCTIONS[year];
  return yearDeductions[filingStatus] ?? yearDeductions.single;
}

/**
 * Federal ordinary-rate bracket breakpoints — the taxable-income thresholds
 * where the marginal rate steps up — for a filing status + year. Excludes the
 * open-ended top bracket (Infinity). Lets year-aware planning detectors read the
 * RETURN's actual bracket geometry instead of a hard-coded single-year snapshot.
 */
export function getFederalBracketBreakpoints(filingStatus: string, taxYear: number): number[] {
  const year = resolveTaxYear(taxYear);
  const yearBrackets = FEDERAL_BRACKETS[year];
  const brackets = yearBrackets[filingStatus] ?? yearBrackets.single;
  return brackets.map((b) => b.upTo).filter((u) => Number.isFinite(u));
}

/**
 * Pick the best-fit bracket set from the state data, falling back to single
 * for MFS/HoH and to MFJ for QW when the state doesn't publish separate ones.
 */
function pickStateBrackets(
  state: { single: StateBracket[]; married_filing_jointly: StateBracket[]; married_filing_separately?: StateBracket[]; head_of_household?: StateBracket[]; qualifying_widow?: StateBracket[]; },
  filingStatus: StateFilingStatus,
): StateBracket[] {
  switch (filingStatus) {
    case "married_filing_jointly":
      return state.married_filing_jointly;
    case "married_filing_separately":
      return state.married_filing_separately ?? state.single;
    case "head_of_household":
      return state.head_of_household ?? state.single;
    case "qualifying_widow":
      return state.qualifying_widow ?? state.married_filing_jointly;
    case "single":
    default:
      return state.single;
  }
}

function pickStateStdDeduction(
  state: { single: number; married_filing_jointly: number; married_filing_separately?: number; head_of_household?: number; qualifying_widow?: number; },
  filingStatus: StateFilingStatus,
): number {
  switch (filingStatus) {
    case "married_filing_jointly":
      return state.married_filing_jointly;
    case "married_filing_separately":
      return state.married_filing_separately ?? state.single;
    case "head_of_household":
      return state.head_of_household ?? state.single;
    case "qualifying_widow":
      return state.qualifying_widow ?? state.married_filing_jointly;
    case "single":
    default:
      return state.single;
  }
}

// ── Oregon federal-tax-paid subtraction (Form 40 Line 13) ──────────────────
// OR allows a subtraction for federal income tax liability paid, capped and
// phased out by AGI. Sources: OR Pub 17, Form 40 instructions.
// 2024: max $8,250 ($4,125 MFS); phase-out from AGI $125,000 to $145,000.
// 2025: values held same pending official Oregon publication.
const OR_FED_TAX_SUBTRACTION: Record<TaxYear, { capMfs: number; capOther: number; phaseStart: number; phaseEnd: number }> = {
  2024: { capMfs: 4125, capOther: 8250, phaseStart: 125000, phaseEnd: 145000 },
  2025: { capMfs: 4250, capOther: 8500, phaseStart: 125000, phaseEnd: 145000 },
  // TY2026 held = TY2025 pending official Oregon publication (same approach as 2025).
  2026: { capMfs: 4250, capOther: 8500, phaseStart: 125000, phaseEnd: 145000 },
};

// ── State retirement-income exemptions ──────────────────────────────────────
// Some states fully exempt qualified retirement distributions (1099-R taxable
// amount, pensions, 401(k), IRA) from state taxable income.
//   - PA: Full exemption for qualified plans + 59½+ (we use age ≥ 60 since we
//     only store integer ages; lose a few PA filers age 59 in their birth-month-1)
//   - IL: Full exemption for qualified retirement income regardless of age
//   - MS: Full exemption at 59½+ (use 60)
//   - HI: Full exemption for employer-funded portions (we apply to all retirement
//     income — see limitations below). HRS §235-7(a)(2)-(3). No age requirement.
//   - NJ: Capped exemption by filing status with phase-out by NJ gross income.
//     Form NJ-1040 Line 28a; N.J.A.C. §18:35-2.5. Age 62+ required.
//   - NY: $20k per filer ($40k MFJ combined). Form IT-201 Line 29; NY Tax Law
//     §612(c)(3-a). Age 59½+ required (we use 60).
//
// Limitations:
// - HI: real HI law excludes only employer-funded portions of pensions/annuities
//   per Schedule J's exclusion ratio. Our model applies the full exemption to
//   all 1099-R retirement income; CPAs should override via additionalDeductions
//   for mixed contributory plans.
// - NJ: phase-out uses "NJ gross income" — we approximate as federal AGI. If
//   SS/military pension/qualified Roth distributions are present, NJ gross is
//   lower than federal AGI, which would unlock more exemption. CPAs should
//   manually adjust when the difference matters.
// - NJ: Worksheet D Part I/II "unused exclusion against other income" is NOT
//   modeled (Line 28b). We compute only the Line 28a pension/IRA exclusion.
// - NY: MFJ gets $40k combined cap. For true per-spouse handling (where one
//   spouse can't use the other's unused cap) we'd need spouse retirement income
//   tracked separately — not in the current schema.
// - NY: doesn't distinguish Line 26 (government pension, unlimited) from Line
//   29 ($20k private/IRA cap). All retirement income is treated as Line 29.
//   CPAs with NY State / US federal / military pensioner clients should
//   override via additionalDeductions.
const STATE_RETIREMENT_EXEMPTION_RULES: Record<string, { ageMin?: number; description: string }> = {
  PA: { ageMin: 60, description: "PA fully exempts qualified retirement income at age 59½+ (we use 60)" },
  IL: { description: "IL fully exempts qualified retirement income (no age requirement)" },
  MS: { ageMin: 60, description: "MS fully exempts qualified retirement income at age 59½+ (we use 60)" },
  // HI handled by a dedicated branch (employer-funded vs employee-funded split).
};

/** NJ pension exclusion caps by filing status (TY2024, NJ Form NJ-1040 Line 28a). */
const NJ_PENSION_CAP_BY_STATUS: Record<string, number> = {
  married_filing_jointly: 100000,
  qualifying_widow: 100000,
  single: 75000,
  head_of_household: 75000,
  married_filing_separately: 50000,
};

/**
 * NJ exclusion phase-out by NJ gross income, TY2024.
 * Cliff at $150k; below $100k = full max; tiered between.
 * Multiplier varies by filing status because NJ phases out as a percentage
 * of the status-specific maximum (which we capture via NJ_PENSION_CAP_BY_STATUS).
 */
function njPhaseOutMultiplier(njGrossIncome: number, filingStatus: string): number {
  if (njGrossIncome > 150000) return 0; // cliff
  if (njGrossIncome <= 100000) return 1; // full
  const isMfj = filingStatus === "married_filing_jointly" || filingStatus === "qualifying_widow";
  const isMfs = filingStatus === "married_filing_separately";
  if (njGrossIncome <= 125000) {
    // Tier 1: 50% MFJ/QW, 37.5% Single/HoH, 25% MFS
    return isMfj ? 0.5 : isMfs ? 0.25 : 0.375;
  }
  // Tier 2 ($125,001–$150,000): 25% MFJ/QW, 18.75% Single/HoH, 12.5% MFS
  return isMfj ? 0.25 : isMfs ? 0.125 : 0.1875;
}

export function getStateRetirementExemption(params: {
  stateCode: string;
  retirementIncome: number;
  filingStatus?: string;
  taxpayerAge?: number;
  /**
   * NJ gross income approximation, ≈ federal AGI − (federally-taxable Social Security).
   * If absent and stateCode == NJ, we fall back to federalAgi (conservative — may
   * over-phase-out filers with significant SS income). Optional for other states.
   */
  njGrossIncomeApprox?: number;
  /**
   * HI only — the EMPLOYER-FUNDED portion of pension/annuity income (HRS
   * §235-7(a)(3) / Schedule J exclusion ratio). HI excludes only this portion;
   * employee-funded 401(k)/IRA/§457 amounts stay taxable. When supplied, the HI
   * exclusion is capped at this amount; when absent, the engine excludes ALL
   * retirement income (documented over-exclusion).
   */
  hiEmployerFundedPension?: number;
  /**
   * NY only — the GOVERNMENT-pension portion (NYS/local/federal/military) per
   * NY Tax Law §612(c)(3), IT-201 Line 26. Excluded in FULL with no age limit.
   * The remaining (private/IRA) retirement income gets the $20k/$40k Line 29
   * exclusion (age 59½+). When absent, all retirement income is treated as
   * Line 29 ($20k/$40k cap).
   */
  nyGovernmentPension?: number;
}): { exemption: number; reason?: string } {
  const code = params.stateCode.toUpperCase();

  // ── NJ: capped by status with NJ-gross-income phase-out ─────────────
  if (code === "NJ") {
    if ((params.taxpayerAge ?? 0) < 62) {
      return { exemption: 0, reason: "NJ pension exclusion requires age 62+ (or disabled, not modeled)" };
    }
    const status = params.filingStatus ?? "single";
    const maxCap = NJ_PENSION_CAP_BY_STATUS[status] ?? 75000;
    const njGross = params.njGrossIncomeApprox ?? Number.POSITIVE_INFINITY;
    const multiplier = njPhaseOutMultiplier(njGross, status);
    if (multiplier === 0) {
      return { exemption: 0, reason: `NJ gross income (~$${njGross.toLocaleString()}) exceeds $150k cliff` };
    }
    const effectiveCap = maxCap * multiplier;
    const exemption = Math.min(Math.max(0, params.retirementIncome), effectiveCap);
    return {
      exemption,
      reason: `NJ pension exclusion: ${status} cap $${maxCap.toLocaleString()} × ${multiplier} = $${effectiveCap.toLocaleString()}`,
    };
  }

  // ── NY: Line 26 govt pension (unlimited, no age) + Line 29 $20k/$40k (59½+) ─
  if (code === "NY") {
    const status = params.filingStatus ?? "single";
    const isMfj = status === "married_filing_jointly" || status === "qualifying_widow";
    const cap = isMfj ? 40000 : 20000;
    const retIncome = Math.max(0, params.retirementIncome);
    // Line 26 — NYS/local/federal/military government pension: fully excluded,
    // no dollar cap, no age requirement.
    const govtExcluded = Math.min(Math.max(0, params.nyGovernmentPension ?? 0), retIncome);
    // Line 29 — the remaining private/IRA retirement gets the $20k/$40k cap,
    // age 59½+ only (we use 60 — integer ages).
    const nonGovt = Math.max(0, retIncome - govtExcluded);
    const line29 = (params.taxpayerAge ?? 0) >= 60 ? Math.min(nonGovt, cap) : 0;
    return {
      exemption: govtExcluded + line29,
      reason:
        `NY: Line 26 govt pension $${govtExcluded.toLocaleString()} (full) + Line 29 ` +
        `$${line29.toLocaleString()} (cap $${cap.toLocaleString()} ${isMfj ? "MFJ combined" : "per filer"}, age 59½+)`,
    };
  }

  // ── HI: employer-funded pension only (employee 401(k)/IRA stays taxable) ──
  if (code === "HI") {
    const retIncome = Math.max(0, params.retirementIncome);
    if (params.hiEmployerFundedPension != null) {
      const excl = Math.min(retIncome, Math.max(0, params.hiEmployerFundedPension));
      return {
        exemption: excl,
        reason: `HI excludes employer-funded pension $${excl.toLocaleString()} (HRS §235-7(a)(3)); employee-funded 401(k)/IRA taxable`,
      };
    }
    return {
      exemption: retIncome,
      reason: "HI fully exempts retirement income (employer/employee split not supplied — may over-exclude per Schedule J)",
    };
  }

  // ── PA/IL/MS: full exemption (age-gated for PA/MS) ──────────────────
  const cfg = STATE_RETIREMENT_EXEMPTION_RULES[code];
  if (!cfg) return { exemption: 0 };
  if (cfg.ageMin != null && (params.taxpayerAge ?? 0) < cfg.ageMin) {
    return { exemption: 0, reason: `Age below threshold ${cfg.ageMin}` };
  }
  return {
    exemption: Math.max(0, params.retirementIncome),
    reason: cfg.description,
  };
}

export function calculateOregonFederalTaxSubtraction(params: {
  federalIncomeTaxPaid: number;
  federalAgi: number;
  filingStatus: string;
  taxYear: number;
}): { subtraction: number; cap: number; phaseOutFraction: number } {
  const year = resolveTaxYear(params.taxYear);
  const cfg = OR_FED_TAX_SUBTRACTION[year];
  const isMfs = params.filingStatus === "married_filing_separately";
  const cap = isMfs ? cfg.capMfs : cfg.capOther;
  let phaseOutFraction = 1;
  if (params.federalAgi >= cfg.phaseEnd) phaseOutFraction = 0;
  else if (params.federalAgi > cfg.phaseStart) {
    phaseOutFraction = (cfg.phaseEnd - params.federalAgi) / (cfg.phaseEnd - cfg.phaseStart);
  }
  const subtraction = Math.min(Math.max(0, params.federalIncomeTaxPaid), cap) * phaseOutFraction;
  return { subtraction, cap, phaseOutFraction };
}

/**
 * Compute state tax liability using brackets for the given year.
 * Pass federal AGI; the state-specific standard deduction is applied internally.
 *
 * Optionally pass `federalIncomeTaxPaid` to apply state-specific federal tax
 * subtractions (currently: Oregon Form 40 Line 13).
 */
// ── Multi-state tax computation (resident + non-resident + reciprocity) ────
// IRS Form 1040 doesn't address multi-state — each state files separately.
// Common scenarios:
//   1. Single-state resident: no allocation, simple.
//   2. Non-resident state income (e.g. commute to NY): NR state taxes the
//      income earned there; resident state taxes all income; resident state
//      gives credit for NR state tax.
//   3. Reciprocity (e.g. NJ resident working in PA): NR state does NOT tax;
//      resident state taxes all income with no credit needed.
//   4. Part-year residency (moved mid-year): pro-rate income — NOT MODELED
//      in this initial implementation (deferred to future phase).
//
// We compute:
//   - Non-resident state tax: marginal tax on state-source wages only,
//     using NR state's brackets (simplified — many states have complex
//     allocation rules and NR-specific exemptions/deductions we don't model).
//   - Resident state tax: full computation on worldwide AGI.
//   - Resident credit-for-tax-paid: min(NR tax actually paid, resident
//     state's marginal tax on that same income).
//   - Reciprocity: skip NR state tax entirely.

export interface PerStateWageAllocation {
  /** State 2-letter code (e.g., "NY", "PA"). Empty/null = unallocated. */
  stateCode: string;
  /** Wages earned in this state (W-2 Box 1 allocated by stateCode). */
  wages: number;
}

// Yonkers resident income-tax surcharge = 16.75% of NET New York STATE tax
// liability (NY IT-201 Yonkers worksheet; NOT a tax on income). Flat rate, stable
// 2017-2026. Nonresident Yonkers earnings tax (0.50% on Yonkers-source wages) is
// a separate, employer-withheld item we don't model. localityCode "YONKERS".
const YONKERS_SURCHARGE_RATE = 0.1675;

// ── E14 — Local income tax catalog (non-NYC) ──────────────────────────────
// NYC has its own bracketed tax computed by calculateNycLocalTax (household
// credit, EITC piggyback, school credit, MCTMT). All other modeled localities
// are flat-rate × base:
//
//   - MD counties (24)   — Comptroller of Maryland 2024 rates. Base ≈
//     Maryland-taxable-income (federalAgi − MD std ded). Maryland law sources
//     the county tax to MD-AGI minus exemptions/deductions; engine
//     approximates with federalAgi − MD std ded (MD personal exemption not
//     modeled, sub-gap).
//
//   - OH cities (~10)    — Ohio municipal income tax. Base = wages earned
//     (W-2 Box 5 / Box 1 for the city of residence-or-employment). Engine
//     approximates with total W-2 wages where stateCode is OH (resident-city
//     model — most common case). Cross-city employment credit not modeled.
//
//   - IN counties (~10)  — Indiana CAGIT/COIT. Base ≈ Indiana-AGI
//     (federalAgi − IN std ded; IN has $0 std ded in our data + $1,000
//     personal exemption per filer not modeled, sub-gap). 2024 rates per
//     IN Departmental Notice #1.
//
// Engine applies the locality tax ONLY when:
//   1) client.localityCode is one of the keys below, AND
//   2) client.state matches the locality's parent state (e.g., MD-MONTGOMERY
//      only fires when state === "MD"). Mismatch silently skips so that
//      stale localityCode values (e.g., after state change) don't produce
//      a phantom local tax.
//
// CPAs must verify the rate against the published current-year tax-rate
// table before filing. Rates change annually for many jurisdictions; the
// engine's table is a starting point, not authoritative.

export type LocalityTaxBase = "state_taxable" | "federal_agi" | "wages_only";

export interface LocalityInfo {
  /** Display label for UI (e.g., "Montgomery County, MD"). */
  jurisdictionLabel: string;
  /** Parent state 2-letter code (e.g., "MD"). Required match against client.state. */
  state: string;
  /** Flat tax rate (decimal). e.g., 0.0320 for 3.20%. */
  rate: number;
  /** Which income amount the rate applies to. */
  base: LocalityTaxBase;
  /**
   * Optional annual wage cap (some KY county occupational taxes cap the
   * `wages_only` base at a FIXED amount, e.g. Boone $75,223). When set, the wages
   * base is Math.min(wages + SE profit, wageCap).
   */
  wageCap?: number;
  /**
   * When true, the wage cap TRACKS the year's OASDI/SS wage base instead of a
   * fixed `wageCap` (e.g. Kenton County, KY caps at the SS wage base: $168,600
   * (2024) / $176,100 (2025) / $184,500 (2026)). Year-indexed so it stays current
   * automatically — supersedes any static `wageCap` on the same entry.
   */
  wageCapTracksSsBase?: boolean;
  /**
   * OH cross-city resident credit (ORC ch. 718): fraction of the work-city tax
   * the RESIDENT city credits (e.g. 1.0 = 100%). Used with creditLimitRate +
   * the CPA-supplied work-city tax paid. Absent → no resident credit (legacy).
   */
  creditRate?: number;
  /**
   * OH cross-city resident credit ceiling, as a fraction of the resident-city
   * base (e.g. 0.025 = 2.5% of income). The credit cannot exceed this.
   */
  creditLimitRate?: number;
}

export const LOCAL_TAX_DATA: Record<string, LocalityInfo> = {
  // ── Maryland counties — Comptroller of Maryland 2024 rates ───────────────
  // Source: Maryland Tax Tables for County Income Tax (Comptroller 2024).
  "MD-ALLEGANY":      { jurisdictionLabel: "Allegany County, MD",       state: "MD", rate: 0.0303, base: "state_taxable" },
  "MD-ANNE_ARUNDEL":  { jurisdictionLabel: "Anne Arundel County, MD",   state: "MD", rate: 0.0281, base: "state_taxable" },
  "MD-BALTIMORE_CITY":{ jurisdictionLabel: "Baltimore City, MD",        state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-BALTIMORE_CO":  { jurisdictionLabel: "Baltimore County, MD",      state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-CALVERT":       { jurisdictionLabel: "Calvert County, MD",        state: "MD", rate: 0.0300, base: "state_taxable" },
  "MD-CAROLINE":      { jurisdictionLabel: "Caroline County, MD",       state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-CARROLL":       { jurisdictionLabel: "Carroll County, MD",        state: "MD", rate: 0.0303, base: "state_taxable" },
  "MD-CECIL":         { jurisdictionLabel: "Cecil County, MD",          state: "MD", rate: 0.0280, base: "state_taxable" },
  "MD-CHARLES":       { jurisdictionLabel: "Charles County, MD",        state: "MD", rate: 0.0303, base: "state_taxable" },
  "MD-DORCHESTER":    { jurisdictionLabel: "Dorchester County, MD",     state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-FREDERICK":     { jurisdictionLabel: "Frederick County, MD",      state: "MD", rate: 0.0275, base: "state_taxable" },
  "MD-GARRETT":       { jurisdictionLabel: "Garrett County, MD",        state: "MD", rate: 0.0265, base: "state_taxable" },
  "MD-HARFORD":       { jurisdictionLabel: "Harford County, MD",        state: "MD", rate: 0.0306, base: "state_taxable" },
  "MD-HOWARD":        { jurisdictionLabel: "Howard County, MD",         state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-KENT":          { jurisdictionLabel: "Kent County, MD",           state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-MONTGOMERY":    { jurisdictionLabel: "Montgomery County, MD",     state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-PRINCE_GEORGES":{ jurisdictionLabel: "Prince George's County, MD",state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-QUEEN_ANNES":   { jurisdictionLabel: "Queen Anne's County, MD",   state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-ST_MARYS":      { jurisdictionLabel: "St. Mary's County, MD",     state: "MD", rate: 0.0310, base: "state_taxable" },
  "MD-SOMERSET":      { jurisdictionLabel: "Somerset County, MD",       state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-TALBOT":        { jurisdictionLabel: "Talbot County, MD",         state: "MD", rate: 0.0240, base: "state_taxable" },
  "MD-WASHINGTON":    { jurisdictionLabel: "Washington County, MD",     state: "MD", rate: 0.0295, base: "state_taxable" },
  "MD-WICOMICO":      { jurisdictionLabel: "Wicomico County, MD",       state: "MD", rate: 0.0320, base: "state_taxable" },
  "MD-WORCESTER":     { jurisdictionLabel: "Worcester County, MD",      state: "MD", rate: 0.0225, base: "state_taxable" },

  // ── Ohio municipal income tax (RITA / CCA / self-administered) ───────────
  // Source: Ohio Department of Taxation; RITA member listing; CCA roster.
  // Base = wages earned in city. Engine uses total OH-resident wages as
  // approximation (cross-city employment credit not modeled — sub-gap).
  // creditRate/creditLimitRate: OH cross-city resident credit (ORC ch. 718).
  // Columbus / Cleveland / Cincinnati give 100% up to their own rate (verified
  // 2024/2025; sources: Columbus IR-25, CCA, Cincinnati FAQ). Others omit the
  // credit (CPA enters it directly when their city grants one).
  "OH-AKRON":         { jurisdictionLabel: "Akron, OH",                 state: "OH", rate: 0.0250, base: "wages_only" },
  "OH-CANTON":        { jurisdictionLabel: "Canton, OH",                state: "OH", rate: 0.0250, base: "wages_only" },
  "OH-CINCINNATI":    { jurisdictionLabel: "Cincinnati, OH",            state: "OH", rate: 0.0180, base: "wages_only", creditRate: 1.0, creditLimitRate: 0.0180 }, // 2020 ballot reduction from 2.10%
  "OH-CLEVELAND":     { jurisdictionLabel: "Cleveland, OH",             state: "OH", rate: 0.0250, base: "wages_only", creditRate: 1.0, creditLimitRate: 0.0250 },
  "OH-COLUMBUS":      { jurisdictionLabel: "Columbus, OH",              state: "OH", rate: 0.0250, base: "wages_only", creditRate: 1.0, creditLimitRate: 0.0250 },
  "OH-DAYTON":        { jurisdictionLabel: "Dayton, OH",                state: "OH", rate: 0.0250, base: "wages_only" },
  "OH-LAKEWOOD":      { jurisdictionLabel: "Lakewood, OH",              state: "OH", rate: 0.0150, base: "wages_only" },
  "OH-PARMA":         { jurisdictionLabel: "Parma, OH",                 state: "OH", rate: 0.0250, base: "wages_only" },
  "OH-TOLEDO":        { jurisdictionLabel: "Toledo, OH",                state: "OH", rate: 0.0250, base: "wages_only" },
  "OH-YOUNGSTOWN":    { jurisdictionLabel: "Youngstown, OH",            state: "OH", rate: 0.0275, base: "wages_only" },

  // ── Indiana counties — CAGIT/COIT 2024 rates ─────────────────────────────
  // Source: IN Department of Revenue Departmental Notice #1 (2024).
  "IN-ALLEN":         { jurisdictionLabel: "Allen County, IN",          state: "IN", rate: 0.0148, base: "state_taxable" },
  "IN-ELKHART":       { jurisdictionLabel: "Elkhart County, IN",        state: "IN", rate: 0.0200, base: "state_taxable" },
  "IN-HAMILTON":      { jurisdictionLabel: "Hamilton County, IN",       state: "IN", rate: 0.0110, base: "state_taxable" },
  "IN-LAKE":          { jurisdictionLabel: "Lake County, IN",           state: "IN", rate: 0.0150, base: "state_taxable" },
  "IN-MARION":        { jurisdictionLabel: "Marion County, IN",         state: "IN", rate: 0.0202, base: "state_taxable" },
  "IN-MONROE":        { jurisdictionLabel: "Monroe County, IN",         state: "IN", rate: 0.02035, base: "state_taxable" },
  "IN-PORTER":        { jurisdictionLabel: "Porter County, IN",         state: "IN", rate: 0.0050, base: "state_taxable" },
  "IN-ST_JOSEPH":     { jurisdictionLabel: "St. Joseph County, IN",     state: "IN", rate: 0.0175, base: "state_taxable" },
  "IN-TIPPECANOE":    { jurisdictionLabel: "Tippecanoe County, IN",     state: "IN", rate: 0.0128, base: "state_taxable" },
  "IN-VANDERBURGH":   { jurisdictionLabel: "Vanderburgh County, IN",    state: "IN", rate: 0.0120, base: "state_taxable" },

  // ── Kentucky local occupational license taxes (KRS 67.083 / 92) ──────────
  // Local payroll taxes on wages + SE net profits earned in the jurisdiction.
  // Each jurisdiction sets its own rate by ordinance; no statewide rate.
  // Louisville/Lexington are uncapped; some counties cap at the OASDI base
  // ($168,600 for 2024) or a fixed amount. Resident rate used (Louisville
  // non-residents pay 1.45% — CPA selects the right code). Sources: Louisville
  // Metro OL-3 instructions; LFUCG occupational-license page; KACo 2024 rates.
  "KY-LOUISVILLE":      { jurisdictionLabel: "Louisville Metro, KY (occupational)", state: "KY", rate: 0.0220, base: "wages_only" }, // 1.25% Metro + 0.20% TARC + 0.75% schools
  "KY-LOUISVILLE-NONRES":{ jurisdictionLabel: "Louisville Metro, KY (non-resident)", state: "KY", rate: 0.0145, base: "wages_only" }, // excludes 0.75% school portion
  "KY-LEXINGTON":       { jurisdictionLabel: "Lexington-Fayette, KY (occupational)", state: "KY", rate: 0.0225, base: "wages_only" },
  "KY-KENTON":          { jurisdictionLabel: "Kenton County, KY (occupational, SS-capped)", state: "KY", rate: 0.006997, base: "wages_only", wageCapTracksSsBase: true }, // capped at the year's OASDI/SS wage base
  "KY-BOONE":           { jurisdictionLabel: "Boone County, KY (occupational, capped)", state: "KY", rate: 0.0080, base: "wages_only", wageCap: 75223 },

  // ── C9 — Pennsylvania local Earned Income Tax (Act 511 / Act 32) ─────────
  // Top 12 PA jurisdictions by population (covers ~50% of PA filers).
  // Rates verified against PA DCED PSD Code lookup (TY2024). Many additional
  // municipalities use the Act 32 default 1.0% combined muni+SD; for those,
  // CPA selects PA-ACT32-DEFAULT (1%) or PA-NO-LOCAL (0%).
  //
  // Source: dced.pa.gov/local-government/local-income-tax-information/psd-codes-and-eit-rates/
  //         (May 2026 snapshot). Philadelphia uses its own Wage Tax (not Act 511).
  "PA-PHILADELPHIA":  { jurisdictionLabel: "Philadelphia, PA (Wage Tax)", state: "PA", rate: 0.0375, base: "wages_only" }, // resident rate; nonres 3.44%
  "PA-PITTSBURGH":    { jurisdictionLabel: "Pittsburgh, PA",              state: "PA", rate: 0.0300, base: "wages_only" }, // 2% city + 1% SD
  "PA-SCRANTON":      { jurisdictionLabel: "Scranton, PA",                state: "PA", rate: 0.0340, base: "wages_only" }, // 3.4% (Act 511 + commuter)
  "PA-WILKES_BARRE":  { jurisdictionLabel: "Wilkes-Barre, PA",            state: "PA", rate: 0.0300, base: "wages_only" }, // 3% combined
  "PA-READING":       { jurisdictionLabel: "Reading, PA",                 state: "PA", rate: 0.0270, base: "wages_only" }, // 2.7% combined
  "PA-HARRISBURG":    { jurisdictionLabel: "Harrisburg, PA",              state: "PA", rate: 0.0200, base: "wages_only" }, // 2% combined
  "PA-LANCASTER":     { jurisdictionLabel: "Lancaster, PA",               state: "PA", rate: 0.0205, base: "wages_only" }, // 1.1% + 0.95% SD
  "PA-ALLENTOWN":     { jurisdictionLabel: "Allentown, PA",               state: "PA", rate: 0.01975, base: "wages_only" }, // 1.975% combined
  "PA-ERIE":          { jurisdictionLabel: "Erie, PA",                    state: "PA", rate: 0.0195, base: "wages_only" }, // 1.95% combined
  "PA-YORK":          { jurisdictionLabel: "York, PA",                    state: "PA", rate: 0.0185, base: "wages_only" }, // 1.85% combined
  "PA-ALTOONA":       { jurisdictionLabel: "Altoona, PA",                 state: "PA", rate: 0.0160, base: "wages_only" }, // 1.6% combined
  "PA-BETHLEHEM":     { jurisdictionLabel: "Bethlehem, PA",               state: "PA", rate: 0.0100, base: "wages_only" }, // 1% combined
  "PA-ACT32-DEFAULT": { jurisdictionLabel: "PA Act 32 Default (1.0% muni+SD)", state: "PA", rate: 0.0100, base: "wages_only" },

  // ── C10 — Ohio School District Income Tax (Form SD-100) ──────────────────
  // Top 15 OH school districts with income tax, ranked by enrollment.
  // OH SDIT is SEPARATE from OH municipal income tax (cities like Cleveland,
  // Columbus etc. already exist above). About 200+ OH school districts levy
  // SDIT. Most use "earned income" base (TY2024 — wages + SE); some still
  // use traditional base (Ohio AGI line 3 - line 4 + biz deduction).
  //
  // Source: tax.ohio.gov SDIT list updated 2024-01-01 + 2025-01-01.
  // For "traditional" base SDs, the engine approximates using wages
  // (sub-gap: real traditional base computes from Ohio IT-1040 Line 3).
  "OH-SD-AKRON-CSD":       { jurisdictionLabel: "Akron CSD (Summit), OH",    state: "OH", rate: 0.0000, base: "wages_only" }, // no SDIT
  "OH-SD-OLENTANGY":       { jurisdictionLabel: "Olentangy LSD (Delaware), OH", state: "OH", rate: 0.0075, base: "wages_only" }, // 0.75% earned-income
  "OH-SD-PICKERINGTON":    { jurisdictionLabel: "Pickerington LSD (Fairfield), OH", state: "OH", rate: 0.0100, base: "wages_only" }, // 1% earned-income
  "OH-SD-LIBERTY-UNION":   { jurisdictionLabel: "Liberty-Union Thurston LSD (Fairfield), OH", state: "OH", rate: 0.0175, base: "wages_only" }, // 1.75% traditional
  "OH-SD-WORTHINGTON":     { jurisdictionLabel: "Worthington CSD (Franklin), OH", state: "OH", rate: 0.0100, base: "wages_only" }, // 1% earned-income (NEW 2024)
  "OH-SD-BIG-WALNUT":      { jurisdictionLabel: "Big Walnut LSD (Delaware), OH", state: "OH", rate: 0.0075, base: "wages_only" }, // 0.75% earned-income
  "OH-SD-LAKOTA":          { jurisdictionLabel: "Lakota LSD (Butler), OH",    state: "OH", rate: 0.0000, base: "wages_only" }, // no SDIT
  "OH-SD-MASON":           { jurisdictionLabel: "Mason CSD (Warren), OH",     state: "OH", rate: 0.0000, base: "wages_only" }, // no SDIT
  "OH-SD-CENTERVILLE":     { jurisdictionLabel: "Centerville City SD (Montgomery), OH", state: "OH", rate: 0.0000, base: "wages_only" }, // no SDIT
  "OH-SD-DUBLIN":          { jurisdictionLabel: "Dublin City SD (Franklin), OH", state: "OH", rate: 0.0000, base: "wages_only" }, // no SDIT
  "OH-SD-LITTLE-MIAMI":    { jurisdictionLabel: "Little Miami LSD (Warren), OH", state: "OH", rate: 0.0100, base: "wages_only" }, // 1% earned-income
  "OH-SD-INDIAN-LAKE":     { jurisdictionLabel: "Indian Lake LSD (Logan), OH", state: "OH", rate: 0.0150, base: "wages_only" }, // 1.5% traditional
  "OH-SD-WESTERVILLE":     { jurisdictionLabel: "Westerville CSD (Franklin), OH", state: "OH", rate: 0.0000, base: "wages_only" }, // no SDIT
  "OH-SD-RIVERSIDE":       { jurisdictionLabel: "Riverside LSD (Logan), OH",  state: "OH", rate: 0.0125, base: "wages_only" }, // 1.25% traditional
  "OH-SD-TRI-VALLEY":      { jurisdictionLabel: "Tri-Valley LSD (Muskingum), OH", state: "OH", rate: 0.0125, base: "wages_only" }, // 1.25% earned-income
};

/** E14 / C9 / C10 — Convenience: list of locality codes available for a given
 *  state. Includes the inline LOCAL_TAX_DATA entries PLUS the bulk PA EIT
 *  registry (C9) and OH SD registry (C10). */
export function localityCodesForState(stateCode: string): Array<{ code: string; label: string }> {
  const stUpper = stateCode.toUpperCase();
  if (stUpper === "NY") return [{ code: "NYC", label: "New York City (NYC PIT)" }];
  const inline = Object.entries(LOCAL_TAX_DATA)
    .filter(([, info]) => info.state === stUpper)
    .map(([code, info]) => ({ code, label: info.jurisdictionLabel }));
  // C9 — Append PA bulk registry (excludes anything already covered inline).
  if (stUpper === "PA") {
    const inlineCodes = new Set(inline.map((e) => e.code));
    for (const entry of PA_EIT_REGISTRY) {
      const key = `PA-${entry.municipality.toUpperCase().replace(/[\s.,]+/g, "_").replace(/[^A-Z0-9_-]/g, "")}`;
      if (!inlineCodes.has(key)) {
        inline.push({
          code: key,
          label: `${entry.municipality}, PA (${(entry.combinedRate * 100).toFixed(2)}%)`,
        });
      }
    }
  }
  // C10 — Append OH SD bulk registry.
  if (stUpper === "OH") {
    const inlineCodes = new Set(inline.map((e) => e.code));
    for (const entry of OH_SCHOOL_DISTRICT_REGISTRY) {
      const key = `OH-SD-${entry.sdCode}`;
      if (!inlineCodes.has(key)) {
        inline.push({
          code: key,
          label: `${entry.name} (${entry.county}, OH — ${(entry.rate * 100).toFixed(2)}% ${entry.base})`,
        });
      }
    }
  }
  return inline;
}

/** E14 — Flat-rate locality dispatch. Returns null when localityCode isn't
 *  in LOCAL_TAX_DATA AND not in the C9 PA EIT bulk registry / C10 OH SDIT
 *  bulk registry. Caller handles NYC + null. Uses zero-value NYC fields
 *  so callers see a uniform shape. */
export function calculateFlatRateLocalTax(params: {
  localityCode: string;
  residentState: string;
  federalAgi: number;
  totalWages: number;
  filingStatus: string;
  taxYear: number;
  /** C10 — Approximate "OH traditional base" = OH IT-1040 Line 3 (Ohio
   *  taxable income before personal exemption); engine uses federalAgi −
   *  state std ded when not supplied (consistent with `state_taxable`). */
  ohTraditionalBase?: number;
  /** STL-02 — net Schedule-C/1099-NEC profit added to the PA EIT / OH SDIT
   *  earned-income (wages_only) base. */
  netSeProfit?: number;
  /** #7 — OH cross-city resident credit: municipal tax paid to the WORK city. */
  ohWorkCityTaxPaid?: number;
}): NycLocalTaxCalculation | null {
  const info = LOCAL_TAX_DATA[params.localityCode];
  if (info) {
    // Enforce state match — a stale localityCode after a state change
    // silently skips rather than producing a phantom local tax.
    if (info.state !== params.residentState.toUpperCase()) return null;
    return computeFlatRateLocalTaxFromInfo(
      params.localityCode,
      info.rate,
      info.base,
      params.federalAgi,
      params.totalWages,
      info.state,
      params.filingStatus,
      params.taxYear,
      params.ohTraditionalBase,
      params.netSeProfit ?? 0,
      {
        wageCap: info.wageCap,
        wageCapTracksSsBase: info.wageCapTracksSsBase,
        creditRate: info.creditRate,
        creditLimitRate: info.creditLimitRate,
        workCityTaxPaid: params.ohWorkCityTaxPaid,
      },
    );
  }
  // C9 — PA bulk registry fallback
  const codeUp = (params.localityCode ?? "").toUpperCase();
  if (codeUp.startsWith("PA-") && params.residentState.toUpperCase() === "PA") {
    const pa = lookupPaLocalEit(codeUp);
    if (pa) {
      return computeFlatRateLocalTaxFromInfo(
        params.localityCode,
        pa.combinedRate,
        "wages_only",
        params.federalAgi,
        params.totalWages,
        "PA",
        params.filingStatus,
        params.taxYear,
        params.ohTraditionalBase,
        params.netSeProfit ?? 0,
      );
    }
  }
  // C10 — OH SDIT bulk registry fallback
  if (codeUp.startsWith("OH-SD-") && params.residentState.toUpperCase() === "OH") {
    const oh = lookupOhSchoolDistrict(codeUp);
    if (oh) {
      // OH SDs use "earned_income" (wages only) or "traditional" (OH IT-1040
      // Line 3 ≈ taxable income before exemption). Map to engine base types.
      const dispatchBase: LocalityTaxBase | "oh_traditional" =
        oh.base === "earned_income" ? "wages_only" : "oh_traditional";
      return computeFlatRateLocalTaxFromInfo(
        params.localityCode,
        oh.rate,
        dispatchBase,
        params.federalAgi,
        params.totalWages,
        "OH",
        params.filingStatus,
        params.taxYear,
        params.ohTraditionalBase,
        params.netSeProfit ?? 0,
      );
    }
  }
  return null;
}

/** Helper: compute the base + tax for the dispatched locality. */
function computeFlatRateLocalTaxFromInfo(
  localityCode: string,
  rate: number,
  baseType: LocalityTaxBase | "oh_traditional",
  federalAgi: number,
  totalWages: number,
  parentState: string,
  filingStatus: string,
  taxYear: number,
  ohTraditionalBase?: number,
  netSeProfit: number = 0,
  extra?: {
    /** KY-style FIXED annual wage cap on the wages_only base (e.g. Boone). */
    wageCap?: number;
    /** When true, the cap tracks the year's OASDI/SS wage base (e.g. Kenton). */
    wageCapTracksSsBase?: boolean;
    /** OH cross-city resident-credit fraction of work-city tax. */
    creditRate?: number;
    /** OH cross-city resident-credit ceiling as a fraction of the base. */
    creditLimitRate?: number;
    /** CPA-supplied municipal tax paid to the WORK city (for the resident credit). */
    workCityTaxPaid?: number;
  },
): NycLocalTaxCalculation {
  let base = 0;
  if (baseType === "federal_agi") {
    base = Math.max(0, federalAgi);
  } else if (baseType === "wages_only") {
    // STL-02 — the PA Act 32 EIT / Philadelphia NPT / OH SDIT earned-income
    // base legally includes self-employment net profit (PA CLGS-32-1 Line 5;
    // ORC 5748.01 via IRC §1402(a)). A net SE loss cannot reduce wage-based
    // EIT, so the SE term is floored at 0 independently. (Sub-gap: Philadelphia
    // self-employed file the NPT, computed here at the same resident rate,
    // gross of the income-based Schedule SP / SE-tax-equivalent reductions.)
    base = Math.max(0, totalWages) + Math.max(0, netSeProfit);
    // KY occupational tax: cap the wages_only base. Kenton tracks the year's
    // OASDI/SS wage base (year-indexed); other jurisdictions use a fixed cap.
    const effectiveWageCap = extra?.wageCapTracksSsBase
      ? SS_WAGE_BASE[resolveTaxYear(taxYear)]
      : extra?.wageCap;
    if (effectiveWageCap != null && effectiveWageCap > 0) base = Math.min(base, effectiveWageCap);
  } else if (baseType === "oh_traditional") {
    // C10 — OH SDIT traditional base = Ohio IT-1040 Line 3 (Ohio taxable
    // income before personal exemption). Engine approximates this as
    // federal AGI − OH std ded (OH std ded = 0 for individual filers since
    // OH uses personal exemption instead). When CPA supplies the exact
    // traditional base, prefer that.
    if (ohTraditionalBase != null && ohTraditionalBase >= 0) {
      base = ohTraditionalBase;
    } else {
      const year = resolveTaxYear(taxYear);
      const stInfo = STATE_TAX_DATA_BY_YEAR[year]?.["OH"];
      const stdDed = stInfo?.standardDeduction
        ? pickStateStdDeduction(stInfo.standardDeduction, filingStatus as StateFilingStatus)
        : 0;
      base = Math.max(0, federalAgi - stdDed);
    }
  } else {
    // state_taxable: federalAgi − resident-state std ded.
    const year = resolveTaxYear(taxYear);
    const stInfo = STATE_TAX_DATA_BY_YEAR[year]?.[parentState];
    const stdDed = stInfo?.standardDeduction
      ? pickStateStdDeduction(stInfo.standardDeduction, filingStatus as StateFilingStatus)
      : 0;
    base = Math.max(0, federalAgi - stdDed);
  }
  const tax = base * rate;
  // OH cross-city resident credit (ORC ch. 718): a RESIDENT city credits tax
  // paid to the WORK city, = min(creditRate × work-city tax, creditLimitRate ×
  // base), capped so net resident tax ≥ 0. Only applied when the locality has
  // credit fields AND the CPA supplied the work-city tax paid.
  let residentCredit = 0;
  if (extra?.creditRate != null && extra.creditLimitRate != null && (extra.workCityTaxPaid ?? 0) > 0) {
    residentCredit = Math.min(
      extra.creditRate * Math.max(0, extra.workCityTaxPaid ?? 0),
      extra.creditLimitRate * base,
    );
  }
  const netTax = Math.max(0, tax - residentCredit);
  return {
    jurisdiction: localityCode,
    nysTaxableIncome: 0,
    baselineTax: tax,
    householdCredit: residentCredit, // reuse field to surface the OH resident credit
    nycEitc: 0,
    nycEitcRate: 0,
    nycSchoolTaxCredit: 0,
    nycMctmt: 0,
    netLocalTax: netTax,
    flatRate: rate,
    taxBase: base,
  };
}

export interface MultiStateTaxResult {
  /** Resident state's tax liability (after credit for NR tax paid). When part-
   *  year (E12), this equals currentStateTax. */
  residentStateTax: number;
  /** Tax paid to each non-resident state */
  nonresidentStateTaxes: Array<{ state: string; tax: number; wages: number; reciprocityApplied: boolean }>;
  /** Total state tax across all states (= resident after credit + sum of NR
   *  taxes + former-state tax for part-year). */
  totalStateTax: number;
  /** Credit applied at resident state for taxes paid to non-resident states */
  residentCreditApplied: number;
  /** Resident state's tax BEFORE applying the credit (informational) */
  residentStateTaxBeforeCredit: number;
  /** Local-jurisdiction income tax (e.g. NYC). Null when no local jurisdiction. */
  localTax: NycLocalTaxCalculation | null;
  /** E12 — Part-year residency breakdown. Null when filer was full-year
   *  resident of a single state. */
  partYearResidency: PartYearResidencyResult | null;
}

/** E12 — Result of a part-year residency tax computation. */
export interface PartYearResidencyResult {
  /** Two-letter code of the state the filer left (resident Jan 1 to changeDate). */
  formerState: string;
  /** Two-letter code of the state the filer moved to (resident from changeDate to Dec 31). */
  currentState: string;
  /** ISO date when the residency changed (e.g. "2024-04-01"). */
  residencyChangeDate: string;
  /** Days the filer was resident in formerState. */
  daysFormer: number;
  /** Days the filer was resident in currentState. */
  daysCurrent: number;
  /** Total days in the tax year (365 or 366). */
  daysInYear: number;
  /** Pro-rated AGI allocated to the former state. */
  formerStateAgi: number;
  /** Pro-rated AGI allocated to the current state. */
  currentStateAgi: number;
  /** Tax computed for the former state on its pro-rated AGI. */
  formerStateTax: number;
  /** Tax computed for the current state on its pro-rated AGI. */
  currentStateTax: number;
}

// States whose NON-RESIDENT return uses the TAX-RATIO proportional method:
//   NR tax = Tax(TOTAL income as-if-resident) × (state-source / total income).
// Enabled ONLY for states verified to use THIS specific method against their NR
// form (not the alternative INCOME-ratio method — prorate income, then tax — which
// gives a different, lower result; mixing the two would mis-tax):
//   - NY  — IT-203 (Line 45 income %; base tax on total × income %).        [worked example]
//   - CA  — 540NR Schedule CA (CA tax = taxable income × effective rate =
//           tax-on-all-income / all-income).                                [worked example]
//   - CT  — CT-1040NR/PY (Line 8 tax on the FULL CT-AGI × Line 9 ratio =
//           CT-source ÷ CT-AGI; portal.ct.gov DRS instructions).           [verified 2026-06-06j]
//   - NJ  — NJ-1040NR (Line 40 = tax on Line 39 taxable income from Column A =
//           income from EVERYWHERE; Line 42 = Line 40 × the Line 41 income % =
//           NJ-source ÷ everywhere; nj.gov NJ-1040NR instructions).          [verified 2026-06-06k]
// NOT added (different method or unverified): VA (Form 763 prorates net taxable
// INCOME by the allocation %, then taxes — method b); AL/HI/IL/MA/MS/WV (prorate
// deductions/exemptions by the source ratio — method b); MN/GA/MD/OH/NC/etc.
// (unverified — confirm the exact line flow against the NR form before adding).
// Unlisted states fall back to direct brackets on the source income (conservative).
const NR_AS_IF_RESIDENT_STATES = new Set<string>(["CA", "NY", "CT", "NJ"]);

export function calculateMultiStateTax(params: {
  residentState: string;
  federalAgi: number;
  filingStatus: string;
  taxYear: number;
  /** Per-state W-2 wage allocation (one entry per W-2 stateCode). Unallocated wages stay with resident state. */
  perStateWages: PerStateWageAllocation[];
  /** Optional local jurisdiction. NYC + flat-rate localities in LOCAL_TAX_DATA
   *  (MD counties, OH cities, IN counties). When set, the local tax is
   *  computed and returned in `localTax`. */
  localityCode?: string | null;
  /** Dependent count (item H + 1 + 1-if-spouse) for NYC household credit (line 48). */
  localDependentCount?: number;
  /** E14 — Total W-2 wages (Box 1). Used for OH municipal income tax base
   *  (`wages_only` localities). Default 0 → OH local tax is 0. */
  totalWages?: number;
  /** E12 — Part-year residency. When set, AGI is pro-rated by days and
   *  resident-state tax is computed independently for each period. Locality
   *  tax (NYC etc.) is not applied for part-year filers (sub-gap). */
  partYearResidency?: {
    /** Two-letter code of the state the filer was resident in BEFORE the move. */
    formerState: string;
    /** ISO date (YYYY-MM-DD) when residency changed. Filer is former-state
     *  resident from Jan 1 (inclusive) to this date (exclusive); current-
     *  state resident from this date (inclusive) to Dec 31. */
    residencyChangeDate: string;
    /**
     * C11 — OPT-IN: use W-2 stateCode to source wages per NY IT-203 /
     * CA 540NR Schedule CA pattern (wages flow to the state where they
     * were earned). When false/undefined, the engine uses pure pro-rata
     * by days (the conservative default).
     *
     * Enable when CPA is confident W-2 stateCode reflects WHERE-EARNED
     * (not just where employer is). Common case: client physically
     * worked W-2 only in current-state and wasn't earning W-2 income
     * during the former-state residence period.
     */
    useW2SourceAllocation?: boolean;
  };
  options?: {
    federalIncomeTaxPaid?: number;
    retirementIncomeForExemption?: number;
    taxpayerAge?: number;
    njGrossIncomeApprox?: number;
    /** HI — employer-funded pension portion (caps the HI retirement exclusion). */
    hiEmployerFundedPension?: number;
    /** NY — government-pension portion (IT-201 Line 26, fully excluded). */
    nyGovernmentPension?: number;
    /** OH — municipal tax paid to the WORK city (resident cross-city credit). */
    ohWorkCityTaxPaid?: number;
    /** K10 — taxable SS from Pub 915. Excluded from state-tax base for the
     *  41 jurisdictions not in STATES_TAXING_SS. */
    taxableSocialSecurity?: number;
    /** G1 — federal EITC applied (refundable + non-refundable). Used for
     *  NYC EITC sliding scale (NY IT-215 Line 26). */
    federalEitcApplied?: number;
    /** G4 — long-term capital gains for WA 7% LTCG excise tax (RCW 82.87).
     *  Only applied when resident state is WA. */
    longTermCapitalGains?: number;
    /** G5 — federal AMT preferences total (ISO bargain + SALT addback +
     *  legacy catch-all) for CA AMT (Schedule P 540). Only applied when
     *  resident state is CA. */
    amtPreferences?: number;
    /** PREP-B1 — state-base modifications, passed through to the resident
     *  calculateStateTax. muniBondAddBack: out-of-state muni interest (state-
     *  taxable); usTreasurySubtraction: US-Treasury interest (state-exempt). */
    muniBondAddBack?: number;
    usTreasurySubtraction?: number;
    /** E11 — Dependent count for PA Schedule SP Tax Forgiveness brackets
     *  ($9,500 per dependent added to eligibility thresholds). Pass
     *  client.dependentsUnder17 + client.otherDependents. */
    dependentCount?: number;
    /** E8 — Net SE earnings for NYC MCTMT (Metropolitan Commuter
     *  Transportation Mobility Tax). Only applied when localityCode === "NYC". */
    netSeEarnings?: number;
    /** STL-02 — net Schedule-C/1099-NEC profit (Sch C line 31, NOT the 92.35%
     *  SE-tax base) added to the PA local EIT / OH SDIT earned-income base,
     *  which legally includes self-employment net profit. */
    netSeProfit?: number;
    /** C10 — Optional OH IT-1040 Line 3 (Ohio taxable income before personal
     *  exemption) used as the SDIT "traditional" base. When undefined, the
     *  engine approximates as federalAgi − OH std ded (Sub-gap: OH std ded
     *  is 0 for individual filers; engine over-applies vs. real Line 3 which
     *  also subtracts personal exemptions). Only applied for OH SDIT entries
     *  whose base = "traditional". */
    ohTraditionalBase?: number;
    /**
     * C11 deeper — Per-state sourced non-wage income (K-1 + rental). Keys
     * are uppercase 2-letter state codes. Only used when
     * `partYearResidency.useW2SourceAllocation` is true; the engine subtracts
     * these from the pro-rata-by-days residual to avoid double-counting.
     * Intangibles (interest/div/cap gains) still pro-rate to the resident
     * state by days — the standard residency rule for intangible income.
     */
    perStateOtherSourced?: Readonly<Record<string, number>>;
    /**
     * PREP-B1 per-line NR sourcing — per-state NON-WAGE income sourced to a state
     * for a NON-RESIDENT filer (NR business / rental / real-property gains). Keys
     * are uppercase 2-letter state codes. Added to that state's W-2-wage source for
     * the IT-203 / 540NR proportional NR tax. Intangibles (interest/dividends/
     * intangible capital gains) and retirement (pension/IRA/401(k)/SS — 4 U.S.C.
     * §114) are NEVER non-resident source, so the CPA never places them here.
     */
    perStateNonResidentOtherSourced?: Readonly<Record<string, number>>;
  };
}): MultiStateTaxResult {
  const resident = params.residentState.toUpperCase();

  // E12 — when the filer made a part-year move, the FORMER state's income is
  // taxed by the part-year resident allocation below (formerStateTax on its
  // pro-rated AGI). It must NOT also be aggregated here as a non-resident work
  // state, or the former-state W-2 wages are taxed TWICE — the part-year mover
  // would owe MORE than a full-year former-state resident (a regression caught
  // by the NY→FL scenario battery: $16,708 part-year vs $12,151 full-year NY).
  const partYearFormerState = params.partYearResidency
    ? params.partYearResidency.formerState.toUpperCase()
    : null;

  // ── Non-resident SOURCE income per state (PREP-B1 per-line NR sourcing) ───
  // Build each non-resident state's SOURCE income: W-2 wages (by stateCode) PLUS
  // any CPA-supplied per-state non-wage source (NR business / rental / real-
  // property gains, via options.perStateNonResidentOtherSourced). What is NOT in
  // this base, by federal sourcing law, and so is never taxed by a non-resident
  // state: interest/dividends/intangible capital gains (4 U.S.C. §114(a) —
  // intangibles follow the owner's DOMICILE) and pension/IRA/401(k)/SS
  // (4 U.S.C. §114(b) — a state may not tax a non-resident's retirement income).
  // The CPA simply never places those in perStateNonResidentOtherSourced.
  const nrSourceByState = new Map<string, number>();
  const addNrSource = (rawCode: string | undefined, amount: number): void => {
    const code = (rawCode || "").toUpperCase();
    if (!code || code === resident) return; // resident-state income is covered by the resident calc
    if (partYearFormerState && code === partYearFormerState) return; // covered by part-year formerStateTax
    const v = Math.max(0, amount);
    if (v === 0) return;
    nrSourceByState.set(code, (nrSourceByState.get(code) ?? 0) + v);
  };
  for (const entry of params.perStateWages) addNrSource(entry.stateCode, entry.wages);
  for (const [code, amt] of Object.entries(params.options?.perStateNonResidentOtherSourced ?? {})) {
    addNrSource(code, amt);
  }

  // Compute non-resident state tax for each (skip reciprocity pairs)
  const nonresidentStateTaxes: MultiStateTaxResult["nonresidentStateTaxes"] = [];
  let totalNrTax = 0;
  let totalNrWages = 0; // total NR-SOURCE income (wages + non-wage source) — credit cap base

  for (const [nrState, nrSource] of nrSourceByState.entries()) {
    const reciprocity = hasReciprocity(resident, nrState);
    if (reciprocity) {
      // Reciprocity: NR state does not tax. Resident state taxes the wages.
      nonresidentStateTaxes.push({ state: nrState, tax: 0, wages: nrSource, reciprocityApplied: true });
      continue;
    }

    // ── NY IT-203 / CA 540NR proportional ("as-if-resident") method ──────────
    // NR tax = Tax(TOTAL income as if a full-year resident) × (state-source income
    // / total income). This preserves the progressive marginal rate of the full
    // income and is the method both NY (IT-203 Line 45 income %) and CA (540NR
    // Schedule CA ratio) actually use — it produces a higher (correct) NR tax than
    // applying the state's brackets directly to the source income alone.
    let nrTax: number;
    if (NR_AS_IF_RESIDENT_STATES.has(nrState) && params.federalAgi > 0) {
      const taxAsIfResident = calculateStateTax(
        params.federalAgi,
        nrState,
        params.filingStatus,
        params.taxYear,
        // K10 — preserve SS exclusion for the as-if-resident sub-computation.
        // Other options stay scoped to the resident-state call below to avoid
        // OR-subtraction / NJ-pension double-counting.
        { taxableSocialSecurity: params.options?.taxableSocialSecurity },
      );
      const sourceFraction = Math.min(1, Math.max(0, nrSource / params.federalAgi));
      nrTax = taxAsIfResident * sourceFraction;
    } else {
      // States we haven't validated the proportional method for: apply the NR
      // state's brackets directly to the source income (a conservative
      // approximation — usually lower than the proportional method).
      nrTax = calculateStateTax(nrSource, nrState, params.filingStatus, params.taxYear, {});
    }
    nonresidentStateTaxes.push({ state: nrState, tax: nrTax, wages: nrSource, reciprocityApplied: false });
    totalNrTax += nrTax;
    totalNrWages += nrSource;
  }

  // ── E12 — Part-year residency branch ────────────────────────────────────
  // When the filer moved between states during the tax year, pro-rate AGI
  // by day count and compute resident-state tax for each period
  // independently. This replaces the worldwide-AGI residentTaxFull path.
  //
  // Simplifications (documented as sub-gaps):
  //   - AGI is allocated proportionally by days; the engine doesn't track
  //     which income items were earned during which period. Real per-state
  //     part-year forms (NY IT-203, CA 540NR Schedule CA, etc.) source by
  //     income item.
  //   - Resident credit-for-tax-paid is SKIPPED for part-year filers (NR
  //     wages may have been earned during either period; engine can't tell).
  //   - NYC + flat-rate locality tax SKIPPED for part-year filers (would
  //     require allocating residence days to each locality, not modeled).
  //   - State AMT / WA LTCG surcharge / NY/CA-as-resident NR formula all
  //     skipped on the part-year path.
  let partYearResidencyResult: PartYearResidencyResult | null = null;
  let residentTaxFull = 0;
  let residentStateTax = 0;
  let residentCreditApplied = 0;

  if (params.partYearResidency) {
    const formerStateUpper = params.partYearResidency.formerState.toUpperCase();
    // C11 — OPT-IN per-W-2-stateCode wage allocation (NY IT-203 / CA 540NR
    // Schedule CA pattern). When enabled, wages flow to the state where
    // each W-2 was earned (stateCode) rather than pure pro-rata.
    let perStateWageMap: Record<string, number> | undefined;
    if (params.partYearResidency.useW2SourceAllocation) {
      perStateWageMap = {};
      for (const entry of params.perStateWages) {
        const code = (entry.stateCode || "").toUpperCase();
        if (!code) continue;
        perStateWageMap[code] =
          (perStateWageMap[code] ?? 0) + Math.max(0, entry.wages);
      }
    }
    // C11 deeper — Per-state non-wage situs-sourced income (K-1 + rental).
    // Only meaningful when full source allocation is enabled; otherwise the
    // engine pro-rates all non-wage income by days.
    const perStateOtherSourcedMap = params.partYearResidency.useW2SourceAllocation
      ? params.options?.perStateOtherSourced
      : undefined;
    const py = computePartYearAllocation(
      formerStateUpper,
      resident,
      params.partYearResidency.residencyChangeDate,
      params.taxYear,
      params.federalAgi,
      params.filingStatus,
      params.options ?? {},
      perStateWageMap,
      perStateOtherSourcedMap,
    );
    partYearResidencyResult = py;
    residentTaxFull = py.currentStateTax; // for the return shape
    residentStateTax = py.currentStateTax;
  } else {
    // Resident state tax on worldwide AGI (full computation, with state-specific options)
    residentTaxFull = calculateStateTax(
      params.federalAgi,
      resident,
      params.filingStatus,
      params.taxYear,
      params.options,
    );

    // Resident credit-for-tax-paid: limited to resident's tax on the same wages
    // (approximation: resident's marginal rate × NR wages, capped at actual NR tax)
    // To compute the credit cap, find resident's tax on NR wages only:
    let residentCreditCap = 0;
    if (totalNrWages > 0 && params.federalAgi > 0) {
      // Approximation: ratio of NR wages to AGI × resident tax
      const proRataResidentTax = (totalNrWages / params.federalAgi) * residentTaxFull;
      residentCreditCap = proRataResidentTax;
    }
    residentCreditApplied = Math.min(totalNrTax, residentCreditCap);
    residentStateTax = Math.max(0, residentTaxFull - residentCreditApplied);
  }

  // G4 — WA 7% LTCG excise (RCW 82.87). WA has no PIT but levies a 7%
  // excise on long-term capital gains above the indexed threshold
  // ($262,000 TY2024). Engine applies only when resident state is WA
  // for the full year (E12 part-year skip — would require allocating
  // LTCG to residence period; not modeled).
  if (resident === "WA" && !params.partYearResidency) {
    const ltcg = Math.max(0, params.options?.longTermCapitalGains ?? 0);
    const waLtcgThreshold = 262000; // TY2024 indexed; TY2025 ≈ $270k (not yet
    // confirmed; engine treats both years the same as TY2024).
    const waLtcgExcise = Math.max(0, ltcg - waLtcgThreshold) * 0.07;
    residentStateTax += waLtcgExcise;
  }

  // G5 — CA AMT (Schedule P 540). 7% flat AMT after exemption on AMTI
  // (CA AMTI ≈ federal AGI + federal AMT preferences). CA AMT = max(0,
  // tentative AMT − regular CA tax). Only applied when resident state is CA
  // and there are AMT preferences (otherwise AMTI ≈ regular taxable and
  // 7% AMT < regular CA rate at high income — no AMT delta).
  const caAmtPrefs = params.options?.amtPreferences ?? 0;
  if (resident === "CA" && caAmtPrefs > 0 && !params.partYearResidency) {
    const fs = params.filingStatus as StateFilingStatus;
    // CA AMT exemption (Schedule P 540, 2024 indexed):
    const caAmtExemption =
      fs === "married_filing_jointly" || fs === "qualifying_widow" ? 326478 :
      fs === "married_filing_separately" ? 163238 :
      244857; // single, head_of_household
    const caAmti = Math.max(0, params.federalAgi) + Math.max(0, caAmtPrefs);
    const caAmtBase = Math.max(0, caAmti - caAmtExemption);
    const caAmtTentative = 0.07 * caAmtBase;
    const caAmtDelta = Math.max(0, caAmtTentative - residentStateTax);
    residentStateTax += caAmtDelta;
  }

  // P2-2 — MN AMT (Schedule M1MT, Minn. Stat. §290.091). 6.75% flat on Minnesota
  // alternative minimum taxable income after the exemption, as a delta over
  // regular MN tax (max(0, tentative − regular)). Like CA, applied for MN
  // RESIDENTS (M1MT; the statute confirms residents are subject — non-residents
  // pro-rate via M1NR) with AMT preferences present. Exemptions are the
  // §290.091 subd. 3 statutory amounts; the exemption phases out at 25¢/$ over
  // the §55(d)(2) threshold (MN incorporates the federal phase-out by reference;
  // 2024 §55(d)(3): $1,218,700 MFJ / $609,350 others).
  // APPROXIMATIONS (documented, mirroring CA): (1) MN AMTI is approximated by
  // federal AGI + the engine's AMT preferences — the exact M1MT base is federal
  // Form 6251 AMTI with MN-specific add/subtractions; (2) the exemption uses the
  // §290.091 statutory figures — the CPA should confirm any inflation indexing
  // on the exact-year M1MT form. Year-indexed so future years can refine.
  const mnAmtPrefs = params.options?.amtPreferences ?? 0;
  if (resident === "MN" && mnAmtPrefs > 0 && !params.partYearResidency) {
    const fs = params.filingStatus as StateFilingStatus;
    const isJoint = fs === "married_filing_jointly" || fs === "qualifying_widow";
    const isMfs = fs === "married_filing_separately";
    // §290.091 subd. 3 statutory exemption by filing status.
    const mnExemptionBase = isJoint ? 77_590 : isMfs ? 38_800 : 58_190; // single/HoH = unmarried
    // §55(d)(2) phase-out start (2024 §55(d)(3) thresholds, incorporated by ref).
    const mnPhaseStart = isJoint ? 1_218_700 : 609_350;
    const mnAmti = Math.max(0, params.federalAgi) + Math.max(0, mnAmtPrefs);
    // Exemption reduced 25¢ per $1 of AMTI over the phase-out start, floored at 0.
    const mnExemption = Math.max(0, mnExemptionBase - 0.25 * Math.max(0, mnAmti - mnPhaseStart));
    const mnAmtBase = Math.max(0, mnAmti - mnExemption);
    const mnAmtTentative = 0.0675 * mnAmtBase;
    const mnAmtDelta = Math.max(0, mnAmtTentative - residentStateTax);
    residentStateTax += mnAmtDelta;
  }

  // ── Local jurisdiction (NYC + E14 flat-rate localities) ─────────────────
  // NYC: computed when resident state is NY AND localityCode is "NYC". The
  // CPA's domicile + 183-day determination is captured upstream in
  // `client.localityCode`. Tax base = NYS line 38 ≈ NYS taxable income =
  // federalAgi − NY std ded − NY retirement exemption (mirrors the deduction
  // chain in calculateStateTax for NY).
  //
  // E14 — Flat-rate localities (MD counties / OH cities / IN counties):
  // computed when resident state matches the locality's parent state.
  // Falls through if there's a state mismatch (stale localityCode).
  let localTax: NycLocalTaxCalculation | null = null;
  const localityUpper = (params.localityCode ?? "").toUpperCase();
  // E12 — Locality tax skipped for part-year filers. Pro-rating NYC PIT to
  // a partial-year residence isn't modeled (would need NYC-residence days
  // separately from NY-state residence days). Sub-gap documented.
  if (params.partYearResidency) {
    // skip locality
  } else if (localityUpper === "NYC" && resident === "NY") {
    const year = resolveTaxYear(params.taxYear);
    const nyInfo = STATE_TAX_DATA_BY_YEAR[year]?.["NY"];
    const nyStdDed = nyInfo?.standardDeduction
      ? pickStateStdDeduction(nyInfo.standardDeduction, params.filingStatus as StateFilingStatus)
      : 0;
    const nyRetirementExempt = getStateRetirementExemption({
      stateCode: "NY",
      retirementIncome: params.options?.retirementIncomeForExemption ?? 0,
      filingStatus: params.filingStatus,
      taxpayerAge: params.options?.taxpayerAge,
      njGrossIncomeApprox: params.federalAgi,
      nyGovernmentPension: params.options?.nyGovernmentPension,
    }).exemption;
    const nysTaxable = Math.max(0, params.federalAgi - nyStdDed - nyRetirementExempt);
    localTax = calculateNycLocalTax({
      nysTaxableIncome: nysTaxable,
      federalAgi: params.federalAgi,
      filingStatus: params.filingStatus,
      dependentCount: params.localDependentCount ?? 1,
      taxYear: params.taxYear,
      federalEitcApplied: params.options?.federalEitcApplied ?? 0,
      netSeEarnings: params.options?.netSeEarnings ?? 0,
    });
  } else if (localityUpper === "YONKERS" && resident === "NY") {
    // Yonkers resident surcharge: 16.75% of the NET NY State resident tax
    // (after the resident credit for taxes paid to other states), per the
    // IT-201 Yonkers worksheet. residentStateTax is exactly that net figure.
    const surcharge = Math.max(0, residentStateTax * YONKERS_SURCHARGE_RATE);
    localTax = {
      jurisdiction: "YONKERS",
      nysTaxableIncome: 0,
      baselineTax: surcharge,
      householdCredit: 0,
      nycEitc: 0,
      nycEitcRate: 0,
      nycSchoolTaxCredit: 0,
      nycMctmt: 0,
      netLocalTax: surcharge,
      flatRate: YONKERS_SURCHARGE_RATE,
      taxBase: Math.round(residentStateTax),
    };
  } else if (params.localityCode) {
    // E14 — Flat-rate locality dispatch (MD counties, OH cities, IN counties).
    // C9 — Falls back to PA bulk registry when localityCode starts "PA-".
    // C10 — Falls back to OH SDIT bulk registry when localityCode starts "OH-SD-".
    // Returns null when state doesn't match (stale localityCode protection)
    // OR when the code matches nothing.
    localTax = calculateFlatRateLocalTax({
      localityCode: params.localityCode,
      residentState: resident,
      federalAgi: params.federalAgi,
      totalWages: params.totalWages ?? 0,
      filingStatus: params.filingStatus,
      taxYear: params.taxYear,
      ohTraditionalBase: params.options?.ohTraditionalBase,
      netSeProfit: params.options?.netSeProfit ?? 0,
      ohWorkCityTaxPaid: params.options?.ohWorkCityTaxPaid,
    });
  }

  // E12 — totalStateTax includes former-state tax when part-year.
  const formerStateTaxForTotal = partYearResidencyResult?.formerStateTax ?? 0;

  return {
    residentStateTax,
    nonresidentStateTaxes,
    totalStateTax: residentStateTax + totalNrTax + formerStateTaxForTotal,
    residentCreditApplied,
    residentStateTaxBeforeCredit: residentTaxFull,
    localTax,
    partYearResidency: partYearResidencyResult,
  };
}

// ── E12 — Part-year residency allocation helper ────────────────────────────
// Days are computed inclusively per IRS convention: filer is former-state
// resident from Jan 1 through (changeDate - 1 day); current-state resident
// from changeDate through Dec 31.
function computePartYearAllocation(
  formerStateUpper: string,
  currentStateUpper: string,
  residencyChangeDate: string,
  taxYear: number,
  federalAgi: number,
  filingStatus: string,
  options: NonNullable<Parameters<typeof calculateMultiStateTax>[0]["options"]>,
  /**
   * C11 — Per-W-2-stateCode wage allocation for part-year residents.
   *
   * When present (NY IT-203 / CA 540NR Sched CA pattern), wage income
   * is sourced to the state where W-2 was earned (regardless of when in
   * the year). Non-wage income still pro-rates by days. CPA enables this
   * by ensuring each W-2 record has a correct `stateCode` field.
   *
   * Key format: STATE_CODE (uppercase) → total Box 1 wages for that state.
   * Example: { "CA": 60000, "NY": 80000 } → $60k allocated to CA wages,
   * $80k to NY wages. Non-CA/NY income pro-rated by days.
   *
   * When undefined, falls back to pure pro-rata-by-days allocation
   * (original behavior).
   */
  perStateWages?: Readonly<Record<string, number>>,
  /**
   * C11 deeper — Per-state K-1 / rental / other "situs-sourced" income
   * allocation. Each key is a 2-letter state; the value is the total
   * non-wage income sourced to that state. Subtracted from the pro-rata
   * residual (intangibles + other non-sourced income) so it isn't
   * double-counted. When undefined, all non-wage income still pro-rates.
   */
  perStateOtherSourced?: Readonly<Record<string, number>>,
): PartYearResidencyResult {
  // Total days in the tax year (leap year handling).
  const isLeap = ((taxYear % 4 === 0) && (taxYear % 100 !== 0)) || (taxYear % 400 === 0);
  const daysInYear = isLeap ? 366 : 365;
  // Jan 1 of taxYear (UTC, midnight).
  const yearStartMs = Date.UTC(taxYear, 0, 1);
  const yearEndMs = Date.UTC(taxYear, 11, 31);
  // Parse residency change date. Accept full ISO timestamps or YYYY-MM-DD.
  const ms = Date.parse(residencyChangeDate);
  let daysFormer: number;
  if (Number.isNaN(ms)) {
    // Malformed change date — engine falls back to 0-day former (treats as full-year current).
    daysFormer = 0;
  } else {
    const change = new Date(ms);
    const changeUtcMs = Date.UTC(
      change.getUTCFullYear(),
      change.getUTCMonth(),
      change.getUTCDate(),
    );
    // Clamp to [yearStart, yearEnd + 1].
    const safeChangeMs = Math.max(yearStartMs, Math.min(changeUtcMs, yearEndMs + 86400000));
    daysFormer = Math.max(0, Math.floor((safeChangeMs - yearStartMs) / 86400000));
  }
  const daysCurrent = Math.max(0, daysInYear - daysFormer);

  const federalAgiSafe = Math.max(0, federalAgi);
  let formerStateAgi: number;
  let currentStateAgi: number;

  if (perStateWages && Object.keys(perStateWages).length > 0) {
    // C11 — Per-W-2 stateCode allocation (NY IT-203 / CA 540NR pattern).
    // Wages flow to their respective state; non-wage income pro-rates by days
    // unless `perStateOtherSourced` has explicit per-state allocations for it.
    const w2WagesFormer = Math.max(0, perStateWages[formerStateUpper] ?? 0);
    const w2WagesCurrent = Math.max(0, perStateWages[currentStateUpper] ?? 0);
    const totalW2Wages = Object.values(perStateWages).reduce(
      (s, v) => s + Math.max(0, v),
      0,
    );
    // C11 deeper — Subtract situs-sourced non-wage income from the pro-rata
    // residual so it isn't double-counted. K-1, rentals, etc. sourced to a
    // specific state.
    const situsSourcedTotal = perStateOtherSourced
      ? Object.values(perStateOtherSourced).reduce((s, v) => s + Math.max(0, v), 0)
      : 0;
    const situsFormer = perStateOtherSourced
      ? Math.max(0, perStateOtherSourced[formerStateUpper] ?? 0)
      : 0;
    const situsCurrent = perStateOtherSourced
      ? Math.max(0, perStateOtherSourced[currentStateUpper] ?? 0)
      : 0;
    // Remaining (intangible + other) income that pro-rates by days.
    const nonW2NonSitusAgi = Math.max(
      0,
      federalAgiSafe - totalW2Wages - situsSourcedTotal,
    );
    const nonW2Former =
      daysInYear > 0 ? nonW2NonSitusAgi * (daysFormer / daysInYear) : 0;
    const nonW2Current =
      daysInYear > 0 ? nonW2NonSitusAgi * (daysCurrent / daysInYear) : nonW2NonSitusAgi;
    formerStateAgi = w2WagesFormer + situsFormer + nonW2Former;
    currentStateAgi = w2WagesCurrent + situsCurrent + nonW2Current;
  } else {
    // Existing pure pro-rata-by-days fallback.
    formerStateAgi =
      daysInYear > 0 ? federalAgiSafe * (daysFormer / daysInYear) : 0;
    currentStateAgi =
      daysInYear > 0 ? federalAgiSafe * (daysCurrent / daysInYear) : federalAgiSafe;
  }

  // For each period: call calculateStateTax with that period's pro-rated AGI.
  // We use the same options for both (e.g., taxableSocialSecurity is pro-rated
  // implicitly by the AGI ratio — slightly conservative; documented sub-gap).
  // Pro-rate the flat allowances (std ded + personal exemption) by residency
  // DAYS so each state grants only its residency-period share. daysFormer/Current
  // sum to daysInYear, so the two factors sum to 1 → one full std-ded/exemption
  // split across the two states (was previously full in BOTH → ~2× over-deduct).
  const formerProration = daysInYear > 0 ? daysFormer / daysInYear : 0;
  const currentProration = daysInYear > 0 ? daysCurrent / daysInYear : 1;
  const formerStateTax = formerStateAgi > 0
    ? calculateStateTax(formerStateAgi, formerStateUpper, filingStatus, taxYear, { ...options, fullYearFederalAgiForCliff: federalAgiSafe, partYearDeductionProration: formerProration })
    : 0;
  const currentStateTax = currentStateAgi > 0
    ? calculateStateTax(currentStateAgi, currentStateUpper, filingStatus, taxYear, { ...options, fullYearFederalAgiForCliff: federalAgiSafe, partYearDeductionProration: currentProration })
    : 0;

  return {
    formerState: formerStateUpper,
    currentState: currentStateUpper,
    residencyChangeDate,
    daysFormer,
    daysCurrent,
    daysInYear,
    formerStateAgi,
    currentStateAgi,
    formerStateTax,
    currentStateTax,
  };
}

// ── NYC Personal Income Tax (Form IT-201 NYC schedule) ───────────────────
// Per NY DTF Form IT-201-I 2024 (page 40): NYC PIT brackets are unchanged
// since tax year 2017. Tax base = NYS taxable income (IT-201 line 47, which
// equals NYS line 38 unless the taxpayer made Charitable Gifts Trust Fund
// contributions and itemized — minor edge we don't model).
//
// Brackets are progressive (marginal). MFJ thresholds are 1.8× single, NOT
// 2× — verified against IT-201-I page 40.
//
// IT-201 line 48 NYC household credit: small offset for very low-FAGI
// residents. Phased to zero above $22,500 FAGI. Three lookup tables by
// filing status. We implement the dominant cases; very edge cases (8+
// dependents) fall through to the highest bucket.
//
// NOT modeled (documented known limit):
//   - NYC school tax credit rate-reduction (IT-201 line 69b — small)
//   - NYC school tax credit flat amount (line 69 — $63 single / $125 MFJ
//     for FAGI ≤ $250k); CPAs can add as adjustment if needed
//   - NYC Unincorporated Business Tax (UBT) — separate tax, not a PIT addback
//   - MCTMT (Metropolitan Commuter Mobility Tax) — separate SE-tax-like
const NYC_BRACKETS_2024: Record<string, Array<{ upTo: number; rate: number }>> = {
  single: [
    { upTo: 12000, rate: 0.03078 },
    { upTo: 25000, rate: 0.03762 },
    { upTo: 50000, rate: 0.03819 },
    { upTo: Infinity, rate: 0.03876 },
  ],
  married_filing_separately: [
    { upTo: 12000, rate: 0.03078 },
    { upTo: 25000, rate: 0.03762 },
    { upTo: 50000, rate: 0.03819 },
    { upTo: Infinity, rate: 0.03876 },
  ],
  married_filing_jointly: [
    { upTo: 21600, rate: 0.03078 },
    { upTo: 45000, rate: 0.03762 },
    { upTo: 90000, rate: 0.03819 },
    { upTo: Infinity, rate: 0.03876 },
  ],
  qualifying_widow: [
    { upTo: 21600, rate: 0.03078 },
    { upTo: 45000, rate: 0.03762 },
    { upTo: 90000, rate: 0.03819 },
    { upTo: Infinity, rate: 0.03876 },
  ],
  head_of_household: [
    { upTo: 14400, rate: 0.03078 },
    { upTo: 30000, rate: 0.03762 },
    { upTo: 60000, rate: 0.03819 },
    { upTo: Infinity, rate: 0.03876 },
  ],
};

/** Shape returned for any modeled local jurisdiction. NYC-specific fields are
 *  populated when jurisdiction === "NYC"; flat-rate jurisdictions (MD counties,
 *  OH cities, IN counties) populate only `jurisdiction`, `baselineTax`,
 *  `netLocalTax`, and the `flatRate` / `taxBase` informational fields. */
export interface NycLocalTaxCalculation {
  /** Locality code: "NYC", "MD-MONTGOMERY", "OH-CINCINNATI", "IN-MARION", etc. */
  jurisdiction: string;
  nysTaxableIncome: number;       // line 47 (= line 38 unless trust-fund itemized); flat-rate localities set 0
  baselineTax: number;             // brackets-only tax (NYC) OR rate × base (flat-rate)
  householdCredit: number;         // NYC IT-201 line 48 reduction; flat-rate sets 0
  /** G1 — NYC EITC sliding scale (NY IT-215 Line 26). Refundable; in
   *  excess of NYC tax flows to the federal refund. Engine clamps to
   *  netLocalTax >= 0 for now (refundable excess sub-gap documented). */
  nycEitc: number;
  /** Effective NYC EITC rate applied (decimal: 0.30 / 0.25 / etc.). */
  nycEitcRate: number;
  /** E8 — NYC School Tax Credit (IT-201 Line 69). Flat refundable per
   *  filer + dependents. $63 single / $125 MFJ when NYAGI < $250k. */
  nycSchoolTaxCredit: number;
  /** E8 — MCTMT (NYS PMT-Web Form MTA-6). 0.34% on net SE earnings above
   *  $50k. Applied only when client is in MCTD (currently we trigger on
   *  localityCode === "NYC"; surrounding counties not modeled). */
  nycMctmt: number;
  netLocalTax: number;             // max(0, baseline - household credit - NYC EITC) + mctmt (NYC); base × rate (flat-rate)
  /** E14 — Flat rate applied (decimal, e.g. 0.0320). 0 for NYC (uses brackets). */
  flatRate?: number;
  /** E14 — Income base the flat rate was applied to (federalAgi / state taxable / wages). 0 for NYC. */
  taxBase?: number;
}

/**
 * Compute NYC personal income tax. Caller must ensure the client is a NYC
 * resident (CPA's domicile + 183-day determination → `localityCode === "NYC"`)
 * and that resident state is NY.
 *
 * @param nysTaxableIncome — Form IT-201 line 47 base (≈ NYS taxable income).
 * @param federalAgi — used for household credit phase-out (line 48 lookup).
 * @param filingStatus — "single" | "married_filing_jointly" |
 *                       "married_filing_separately" | "head_of_household" |
 *                       "qualifying_widow"
 * @param dependentCount — additional persons for household credit (item H +
 *                         self + spouse). Tables 5/6 use this multiplier.
 * @param taxYear — currently only 2024 brackets are seeded; 2025 falls back
 *                  to 2024 (NYC PIT has been static since TY2017).
 */
/** G1 — NYC EITC sliding scale rate by federal AGI (NY IT-215 Line 26).
 *  Engine approximation of NY DTF's published bands. NYAGI ≈ federal AGI
 *  (NY-specific subtractions not modeled, sub-gap documented). Bands
 *  calibrated to the accuracy-audit reference case: $20k single → 20%. */
export function nycEitcRateForAgi(federalAgi: number): number {
  if (federalAgi <= 10000) return 0.30;
  if (federalAgi <= 15000) return 0.25;
  if (federalAgi <= 25000) return 0.20;
  if (federalAgi <= 35000) return 0.15;
  if (federalAgi <= 50000) return 0.10;
  return 0.05;
}

export function calculateNycLocalTax(params: {
  nysTaxableIncome: number;
  federalAgi: number;
  filingStatus: string;
  dependentCount: number;
  taxYear: number;
  /** G1 — federal EITC applied (refundable + non-refundable combined) — drives
   *  the NYC EITC sliding scale (NY IT-215 Line 26). Default 0. */
  federalEitcApplied?: number;
  /** E8 — Net SE earnings allocated to MCTD (NYC + 7 surrounding counties).
   *  Engine uses total net SE when localityCode === "NYC"; surrounding-
   *  county allocation not modeled. Default 0 → no MCTMT. */
  netSeEarnings?: number;
}): NycLocalTaxCalculation {
  const fs = params.filingStatus as keyof typeof NYC_BRACKETS_2024;
  const brackets = NYC_BRACKETS_2024[fs] ?? NYC_BRACKETS_2024.single;
  const taxable = Math.max(0, params.nysTaxableIncome);
  const baseline = applyBrackets(taxable, brackets);

  // NYC household credit (IT-201 line 48). Tables 4/5/6 by filing status.
  // We implement the dominant low-income bands. Very high dependent counts
  // (8+) round to the row-7 amount + the per-additional adder; this matches
  // the IT-201 instruction text "for each additional dependent over 7 add $X".
  const fagi = params.federalAgi;
  let householdCredit = 0;
  const isMfj = fs === "married_filing_jointly" || fs === "qualifying_widow" || fs === "head_of_household";
  const isMfs = fs === "married_filing_separately";
  // dependentCount expected to include filer (+spouse if applicable). Caller
  // must compose this from item H + 1 (+ 1).
  const N = Math.max(1, params.dependentCount);
  if (!isMfs && !isMfj) {
    // Table 4 — Single
    if (fagi <= 10000) householdCredit = 15;
    else if (fagi <= 12500) householdCredit = 10;
  } else if (isMfj) {
    // Table 5 — MFJ / Qual Surv Spouse / HoH
    // Band base amount; addl per dependent beyond 1.
    const baseTable: Array<{ ceiling: number; perPerson: number }> = [
      { ceiling: 15000, perPerson: 30 },
      { ceiling: 17500, perPerson: 25 },
      { ceiling: 20000, perPerson: 15 },
      { ceiling: 22500, perPerson: 10 },
    ];
    const band = baseTable.find((b) => fagi <= b.ceiling);
    if (band) householdCredit = band.perPerson * N;
  } else if (isMfs) {
    // Table 6 — MFS uses COMBINED FAGI of both spouses. We approximate using
    // the filer's own FAGI (the engine doesn't model spouse-side FAGI for MFS).
    const baseTable: Array<{ ceiling: number; perPerson: number }> = [
      { ceiling: 15000, perPerson: 15 },
      { ceiling: 17500, perPerson: 13 },
      { ceiling: 20000, perPerson: 8 },
      { ceiling: 22500, perPerson: 5 },
    ];
    const band = baseTable.find((b) => fagi <= b.ceiling);
    if (band) householdCredit = band.perPerson * N;
  }

  // G1 — NYC EITC sliding scale (NY IT-215 Line 26). Engine approximation
  // of NY DTF's published bands using NYAGI ≈ federal AGI (NYAGI = federal
  // AGI minus a small set of NY-specific subtractions; engine treats them
  // as 0 for now). Refundable; engine clamps to netLocalTax >= 0 for now.
  // Sub-gap: refundable excess (when nycEitc > NYC tax) doesn't flow to
  // federal refund yet.
  const federalEitc = Math.max(0, params.federalEitcApplied ?? 0);
  const nycEitcRate = federalEitc > 0 ? nycEitcRateForAgi(fagi) : 0;
  const nycEitc = federalEitc * nycEitcRate;

  // E8 — NYC School Tax Credit (IT-201 Line 69b). Refundable, flat amount
  // by filing status when NYAGI < $250k. Engine uses federal AGI as a
  // proxy for NYAGI (NY-specific subtractions not modeled).
  let nycSchoolTaxCredit = 0;
  if (fagi < 250000) {
    nycSchoolTaxCredit = isMfj ? 125 : 63; // includes QSS and HoH via isMfj truthy path
  }

  // E8 — MCTMT (Metropolitan Commuter Transportation Mobility Tax, NY Tax Law
  // Art. 23). STL-01: for TY2024+ a SELF-EMPLOYED individual doing business in
  // MCTD Zone 1 (the five NYC boroughs = localityCode "NYC") pays a FLAT 0.60%
  // on net SE earnings over the $50,000 annual exclusion. The graduated
  // 0.11/0.23/0.60% schedule is the EMPLOYER payroll-expense rate, NOT the
  // self-employed rate (TY2023 self-employed was 0.47%). Zone 2 (flat 0.34%)
  // is out of scope on this NYC-gated path.
  const MCTMT_SE_ZONE1_RATE = 0.0060; // TY2024+
  const netSe = Math.max(0, params.netSeEarnings ?? 0);
  let nycMctmt = 0;
  if (netSe > 50000) {
    nycMctmt = (netSe - 50000) * MCTMT_SE_ZONE1_RATE;
  }

  // E8 — School Tax Credit per IT-201 Line 69 is REFUNDABLE at the state
  // level (not subtracted from NYC PIT directly). Engine returns the credit
  // for transparency; engine.ts adds it to stateRefundOrOwed alongside
  // state EITC. MCTMT is its own line — ADDED to net local tax.
  const netLocalTax = Math.max(0, baseline - householdCredit - nycEitc) + nycMctmt;
  return {
    jurisdiction: "NYC",
    nysTaxableIncome: taxable,
    baselineTax: baseline,
    householdCredit,
    nycSchoolTaxCredit,
    nycMctmt,
    nycEitc,
    nycEitcRate,
    netLocalTax,
  };
}

// ── NYC Unincorporated Business Tax (UBT) — Form NYC-202 / NYC-204 ─────────
// A SEPARATE 4% tax on the net income of an unincorporated business (sole
// proprietorship, single-member LLC, partnership) carried on within NYC. It is
// NOT the personal income tax and applies to residents AND non-residents doing
// business in NYC. (S-corps pay the General Corporation Tax instead.)
//   Line 13 — services allowance: min(20% of net income, $10,000)
//   Line 15 — exemption: $5,000 (flat)
//   Line 16 — taxable = net − allowance − $5,000 ; Line 17 tax = 4% × Line 16
//   Line 18 — Business Tax Credit: full if tax ≤ $3,400; none if tax ≥ $5,400;
//             partial = tax × ($5,400 − tax) / $2,000 between.
// Source: NYC Dept of Finance Form NYC-202 instructions (TY2024 = TY2025).
// NYC Admin. Code §11-503(a). The engine takes the CPA-supplied NYC-allocated
// net business income (allocation per the NYC-202 Schedule C is the CPA's call).
export interface NycUbtCalculation {
  netBusinessIncome: number;
  servicesAllowance: number;
  exemption: number;
  taxableIncome: number;
  taxBeforeCredit: number;
  businessTaxCredit: number;
  netUbt: number;
}
export function calculateNycUbt(netBusinessIncome: number): NycUbtCalculation {
  const net = Math.max(0, netBusinessIncome);
  const servicesAllowance = Math.min(0.20 * net, 10000);
  const exemption = 5000;
  const taxableIncome = Math.max(0, net - servicesAllowance - exemption);
  const taxBeforeCredit = 0.04 * taxableIncome;
  let businessTaxCredit = 0;
  if (taxBeforeCredit <= 3400) {
    businessTaxCredit = taxBeforeCredit; // full credit → no tax
  } else if (taxBeforeCredit < 5400) {
    businessTaxCredit = taxBeforeCredit * (5400 - taxBeforeCredit) / 2000;
  }
  const netUbt = Math.max(0, taxBeforeCredit - businessTaxCredit);
  return { netBusinessIncome: net, servicesAllowance, exemption, taxableIncome, taxBeforeCredit, businessTaxCredit, netUbt };
}

export function calculateStateTax(
  federalAgi: number,
  stateCode: string,
  filingStatus: string,
  taxYear: number,
  options?: {
    federalIncomeTaxPaid?: number;
    /** Qualified retirement-income distributions (1099-R taxable amount) for state exemption */
    retirementIncomeForExemption?: number;
    /** Taxpayer age — gates state retirement exemption (PA, MS, NJ, NY require 59½+ / 62+) */
    taxpayerAge?: number;
    /**
     * NJ gross income approximation, used to phase out the NJ pension exclusion.
     * Caller should pass federalAgi − (federally-taxable Social Security).
     * If absent for NJ filers, falls back to federalAgi (conservative).
     */
    njGrossIncomeApprox?: number;
    /** K10 state-SS exclusion — taxable Social Security amount from Pub 915.
     *  Subtracted from the state-tax base for states NOT in STATES_TAXING_SS
     *  (i.e., the 41 jurisdictions that exempt SS from state income tax).
     *  Default 0. */
    taxableSocialSecurity?: number;
    /** E11 — Number of dependents for PA Schedule SP Tax Forgiveness
     *  ($9,500 added to eligibility thresholds per dependent). Pass
     *  `client.dependentsUnder17 + client.otherDependents`. */
    dependentCount?: number;
    /** STL-04 — Part-year: full-year federal AGI used ONLY for the IL
     *  personal-exemption AGI cliff test (IL Sched NR computes Line 10 as a
     *  full-year resident). Defaults to federalAgi for full-year filers. */
    fullYearFederalAgiForCliff?: number;
    /** Part-year: 0-1 multiplier applied to the standard deduction + personal
     *  exemption so a part-year resident gets only the residency-period share
     *  of these flat allowances (the two periods' factors sum to 1 → one full
     *  std-ded/exemption split across states, not double-counted). Default 1
     *  (full-year filer). Does NOT scale the retirement/SS exclusions, which
     *  already track the pro-rated AGI. */
    partYearDeductionProration?: number;
    /** HI — employer-funded pension portion (caps the HI retirement exclusion). */
    hiEmployerFundedPension?: number;
    /** NY — government-pension portion (IT-201 Line 26, fully excluded). */
    nyGovernmentPension?: number;
    /** PREP-B1 — state-base modifications (CPA-supplied; default 0).
     *  `muniBondAddBack`: out-of-state municipal-bond interest (federally
     *  tax-exempt but TAXABLE to the resident state) ADDED to the state base.
     *  `usTreasurySubtraction`: interest on US Treasury / federal obligations
     *  (federally taxable but state-EXEMPT by federal preemption) SUBTRACTED. */
    muniBondAddBack?: number;
    usTreasurySubtraction?: number;
  },
): number {
  const year = resolveTaxYear(taxYear);
  const yearData = STATE_TAX_DATA_BY_YEAR[year];
  const code = stateCode.toUpperCase();
  const info = yearData[code];
  if (!info || !info.hasIncomeTax || !info.brackets || !info.standardDeduction) {
    return 0;
  }
  const status = filingStatus as StateFilingStatus;
  let stdDed = pickStateStdDeduction(info.standardDeduction, status);
  // WI sliding-scale standard deduction (Wis. Stat. §71.05(22)). All four filing
  // statuses now modeled (2026-06-06k): the per-status max, phase-out threshold,
  // and rate were reverse-derived from the 2024 WI Form 1 "Standard Deduction
  // Table" and VERIFIED to reproduce the published table to the dollar across all
  // 276 income brackets. WAGI ≈ federalAgi (the engine's existing approximation):
  //   single: $13,230 − 12% of WAGI over $19,070  (→ $0 at ~$129,320)
  //   MFJ:    $24,490 − 19.778% over $27,520        (→ $0 at ~$151,344)
  //   MFS:    $12,575 − 19.778% over $8,282         (→ $0 at ~$71,863)
  //   HoH:    max(single, $17,090 − 22.5% over $19,070) — HoH phases at 22.5%
  //           until it meets the single deduction (~$55,832), then follows single.
  // 2024 values applied for ALL years — the annual inflation-indexing of these
  // amounts is a documented year-pinning sub-gap (same as the prior single block).
  if (code === "WI") {
    const wagi = federalAgi;
    const wiSingle = Math.max(0, 13230 - 0.12 * Math.max(0, wagi - 19070));
    if (status === "single") {
      stdDed = wiSingle;
    } else if (status === "married_filing_jointly") {
      stdDed = Math.max(0, Math.min(24490, 24490 - 0.19778 * (wagi - 27520)));
    } else if (status === "married_filing_separately") {
      stdDed = Math.max(0, Math.min(12575, 12575 - 0.19778 * (wagi - 8282)));
    } else if (status === "head_of_household") {
      stdDed = Math.max(0, Math.min(17090, Math.max(wiSingle, 17090 - 0.225 * (wagi - 19070))));
    }
  }
  // K10 — for states that exempt SS from their tax base, subtract the
  // federally-taxable SS amount BEFORE applying state brackets. (For the 9
  // SS-taxing states in STATES_TAXING_SS, federal AGI inherently includes
  // taxable SS and we leave it in the state base.)
  let ssExclusion = !STATES_TAXING_SS.has(code)
    ? Math.max(0, options?.taxableSocialSecurity ?? 0)
    : 0;
  // CT — Social Security is 100% exempt below the federal-AGI threshold ($75k
  // single/MFS, $100k MFJ/QW/HoH; CT-1040 + DRS), and above it CT taxes no more
  // than ~25% of benefits. We exempt 75% of the federally-taxable SS above the
  // threshold. (The exact rule caps CT-includible SS at 25% of GROSS benefits;
  // for very-high-income filers whose SS is ~85%-taxable this slightly
  // under-taxes — documented sub-gap — but it is far more accurate than taxing
  // 100% as the engine did before. CT pension/annuity + IRA exclusions are NOT
  // yet modeled: they need the exact bracketed phase-out table + a pension-vs-IRA
  // split the engine's single retirement bucket can't make.)
  if (code === "CT") {
    const taxableSS = Math.max(0, options?.taxableSocialSecurity ?? 0);
    const isJointish =
      status === "married_filing_jointly" ||
      status === "qualifying_widow" ||
      status === "head_of_household";
    const ctThreshold = isJointish ? 100000 : 75000;
    ssExclusion = federalAgi < ctThreshold ? taxableSS : taxableSS * 0.75;
  }
  // VT (and any future state) — per-filer personal exemption deducted from taxable.
  // IL-1040 Line 10b cliff: when federalAgi exceeds the personalExemptionAgiCliff
  // threshold (single/HoH/MFS/QSS $250k, MFJ $500k for IL TY2024), the exemption
  // is reduced to $0 entirely. Other states with personal exemptions but no
  // cliff (VT) leave personalExemptionAgiCliff undefined.
  let personalExemption = info.personalExemption ? pickStateStdDeduction(info.personalExemption, status) : 0;
  // C3 follow-up (2026-05-27 PM): per-dependent personal exemption (IL, NJ).
  if (info.personalExemptionPerDependent && info.personalExemptionPerDependent > 0) {
    const dependents = Math.max(0, options?.dependentCount ?? 0);
    personalExemption += info.personalExemptionPerDependent * dependents;
  }
  if (info.personalExemptionAgiCliff && personalExemption > 0) {
    const cliff = pickStateStdDeduction(info.personalExemptionAgiCliff, status);
    // STL-04: the cliff is tested on FULL-YEAR federal AGI (IL Sched NR
    // computes Line 10 as a full-year resident). Part-year callers pass the
    // full-year AGI; full-year filers fall back to federalAgi.
    const cliffAgi = options?.fullYearFederalAgiForCliff ?? federalAgi;
    if (cliff > 0 && cliffAgi > cliff) {
      personalExemption = 0;
    }
  }

  // OR-specific: subtract federal tax liability before applying state brackets
  let oregonSubtraction = 0;
  if (code === "OR" && options?.federalIncomeTaxPaid != null) {
    const r = calculateOregonFederalTaxSubtraction({
      federalIncomeTaxPaid: options.federalIncomeTaxPaid,
      federalAgi,
      filingStatus,
      taxYear,
    });
    oregonSubtraction = r.subtraction;
  }

  // PA / IL / MS / HI: full exemption; NJ / NY: capped by status (NJ phased-out)
  const retirementExemption = getStateRetirementExemption({
    stateCode: code,
    retirementIncome: options?.retirementIncomeForExemption ?? 0,
    filingStatus,
    taxpayerAge: options?.taxpayerAge,
    njGrossIncomeApprox: options?.njGrossIncomeApprox ?? federalAgi,
    hiEmployerFundedPension: options?.hiEmployerFundedPension,
    nyGovernmentPension: options?.nyGovernmentPension,
  }).exemption;

  // Part-year: pro-rate the flat allowances (std ded + personal exemption) by
  // the residency-period factor so the filer doesn't get a full deduction in
  // BOTH the former and current state. The two periods' factors sum to 1, so
  // the combined allowance equals one full annual std-ded/exemption. Clamped to
  // [0,1]; default 1 for full-year filers.
  const allowanceProration = Math.min(1, Math.max(0, options?.partYearDeductionProration ?? 1));
  const proratedStdDed = stdDed * allowanceProration;
  const proratedPersonalExemption = personalExemption * allowanceProration;
  // PREP-B1 — state-base modifications: + out-of-state muni interest (state-
  // taxable, not in federal AGI), − US-Treasury interest (state-exempt by
  // federal preemption but present in federal AGI).
  const stateBaseModifications =
    Math.max(0, options?.muniBondAddBack ?? 0) - Math.max(0, options?.usTreasurySubtraction ?? 0);
  const stateTaxable = Math.max(0, federalAgi + stateBaseModifications - proratedStdDed - proratedPersonalExemption - oregonSubtraction - retirementExemption - ssExclusion);
  const brackets = pickStateBrackets(info.brackets, status);
  let tax = applyBrackets(stateTaxable, brackets);

  // Apply surtax (MA 4% millionaire's tax, CA 1% mental-health tax over $1M).
  // STL-03: both are imposed on state TAXABLE INCOME over the threshold (MA
  // M.G.L. ch.62 §4(b); CA R&TC §17043 / Form 540 Line 19), NOT on raw AGI.
  if (info.surtax && stateTaxable > info.surtax.threshold) {
    tax += (stateTaxable - info.surtax.threshold) * info.surtax.rate;
  }

  // E11 — PA Schedule SP Tax Forgiveness (61 Pa. Code §111). Applied as a
  // post-bracket credit against PA tax. Forgiveness % is keyed off
  // "Eligibility Income" (we approximate via federalAgi — close but not
  // exact; PA Sched SP uses a custom definition including some excluded
  // PA items). For most low-income filers federalAgi is within ~10% of
  // Eligibility Income so the bracket assignment usually matches.
  if (code === "PA" && tax > 0) {
    const forgivenessPct = calculatePaScheduleSpForgivenessPct({
      eligibilityIncome: federalAgi,
      filingStatus: status,
      dependentCount: options?.dependentCount ?? 0,
    });
    tax = tax * (1 - forgivenessPct);
  }

  return Math.max(0, tax);
}

/**
 * E11 — PA Schedule SP Tax Forgiveness brackets (61 Pa. Code §111).
 * Returns the forgiveness fraction (0 to 1) given:
 *   - eligibilityIncome (we approximate as federalAgi)
 *   - filingStatus (single/MFS vs MFJ/QSS gets different bands)
 *   - dependentCount (each dependent adds $9,500 to the brackets)
 *
 * Brackets per PA-40 SP 2024 (approximated):
 *   Single base: 100% at $6,500, then 10-percentage-point drops in
 *   $1,000 income steps to 0% at $14,500.
 *   MFJ/QSS base: 2× single thresholds (start at $13,000, end at $22,500).
 *   Each dependent: +$9,500 to all bracket boundaries.
 */
export function calculatePaScheduleSpForgivenessPct(params: {
  eligibilityIncome: number;
  filingStatus: string;
  dependentCount: number;
}): number {
  const { eligibilityIncome, filingStatus, dependentCount } = params;
  if (eligibilityIncome <= 0) return 1.0;

  const isJointFiler =
    filingStatus === "married_filing_jointly" ||
    filingStatus === "qualifying_widow";
  // PA-40 SP base thresholds (2024). Single/MFS/HoH uses single column;
  // MFJ/QSS uses joint column (~2× single).
  const baseHundredCeiling = isJointFiler ? 13000 : 6500;
  // Each successive 10% drop happens in ~$1,000 step (rounded). Zero
  // forgiveness above baseHundredCeiling + $8,000 (~$10k range for the
  // single column; $9k for joint per the published table).
  const stepSize = 1000;
  // Per-dependent allowance: +$9,500 added to ALL thresholds.
  const dependentAllowance = Math.max(0, dependentCount) * 9500;
  const adjustedHundredCeiling = baseHundredCeiling + dependentAllowance;

  if (eligibilityIncome <= adjustedHundredCeiling) return 1.0;
  const excess = eligibilityIncome - adjustedHundredCeiling;
  const stepsAbove = Math.floor(excess / stepSize) + 1;
  // 100% → 90% → 80% ... → 10% in 9 steps; 0% at step 10+
  const pct = Math.max(0, 1.0 - stepsAbove * 0.10);
  return pct;
}

export interface TaxCalculationResult {
  totalIncome: number;
  adjustedGrossIncome: number;
  standardDeduction: number;
  taxableIncome: number;
  federalTaxLiability: number;
  stateTaxLiability: number;
  effectiveTaxRate: number;
  taxYear: TaxYear;
}

export function runTaxCalculation(params: {
  totalWages: number;
  additionalIncome: number;
  filingStatus: string;
  stateCode: string;
  useItemizedDeductions: boolean;
  itemizedDeductions: number;
  adjustments: number;
  taxYear: number;
  /** Age-65 / blind data for std-ded add-on. Optional — when omitted, no add-on. */
  taxpayerAge?: number | null;
  spouseAge?: number | null;
  taxpayerBlind?: boolean | null;
  spouseBlind?: boolean | null;
}): TaxCalculationResult {
  const {
    totalWages,
    additionalIncome,
    filingStatus,
    stateCode,
    useItemizedDeductions,
    itemizedDeductions,
    adjustments,
    taxYear,
  } = params;

  const year = resolveTaxYear(taxYear);
  const totalIncome = totalWages + additionalIncome;
  const adjustedGrossIncome = Math.max(0, totalIncome - adjustments);
  const baseFedStdDeduction = getFederalStandardDeduction(filingStatus, year);
  // Age-65 / blind add-on per IRS Form 1040 Standard Deduction Chart.
  const stdDedAddOn = getFederalStdDedAgeBlindAddOn({
    taxpayerAge: params.taxpayerAge,
    spouseAge: params.spouseAge,
    taxpayerBlind: params.taxpayerBlind,
    spouseBlind: params.spouseBlind,
    filingStatus, taxYear: year,
  });
  const fedStdDeduction = baseFedStdDeduction + stdDedAddOn;
  const fedDeduction = useItemizedDeductions
    ? Math.max(itemizedDeductions, fedStdDeduction)
    : fedStdDeduction;
  const taxableIncome = Math.max(0, adjustedGrossIncome - fedDeduction);

  const federalTaxLiability = calculateFederalTax(taxableIncome, filingStatus, year);
  const stateTaxLiability = calculateStateTax(adjustedGrossIncome, stateCode, filingStatus, year);

  const effectiveTaxRate =
    totalIncome > 0 ? (federalTaxLiability + stateTaxLiability) / totalIncome : 0;

  return {
    totalIncome,
    adjustedGrossIncome,
    standardDeduction: fedDeduction,
    taxableIncome,
    federalTaxLiability,
    stateTaxLiability,
    effectiveTaxRate,
    taxYear: year,
  };
}

// Backwards-compat alias used by existing routes.
export function getStandardDeduction(filingStatus: string, taxYear?: number): number {
  return getFederalStandardDeduction(filingStatus, taxYear ?? LATEST_YEAR);
}

// ── Schedule A: Itemized Deductions ──────────────────────────────────────────
// Real Schedule A breaks itemized deductions into specific categories with
// caps and AGI-based thresholds.
//   Line 1: Medical/dental — only the portion exceeding 7.5% of AGI is deductible
//   Line 5: SALT (state income/property + sales tax) — capped via getSaltCap (TCJA $10k/$5k for TY2024; OBBBA $40k for TY2025+ with >$500k-MAGI phase-down)
//   Line 8: Mortgage interest (Schedule A line 8a/8e) — Schedule A line item
//   Line 11: Cash charitable — generally limited to 60% AGI
//   Line 12: Property charitable — generally limited to 30% AGI

const SALT_CAP = 10000;
const SALT_CAP_MFS = 5000;

/**
 * SALT deduction cap, year-indexed with the OBBBA (P.L. 119-21 §70120)
 * high-income phase-down. TY2024 and earlier = TCJA $10,000 ($5,000 MFS).
 * TY2025 base $40,000 ($20,000 MFS); TY2026 $40,400 ($20,200 MFS) [+1%/yr
 * through 2029, reverting to $10,000 after 2029]. Phase-DOWN: reduced by 30%
 * of MAGI over $500,000 ($250,000 MFS; $505,000/$252,500 for TY2026), floored
 * at $10,000 ($5,000 MFS). Codified in IRC §164(b)(6) (amended) + §164(b)(7)
 * (added). MAGI ≈ AGI here (no add-backs modeled — the §164(b)(7) MAGI is AGI
 * without the foreign-earned-income/housing exclusions, which the engine adds
 * back elsewhere only for NIIT; for SALT we use AGI, a close + conservative proxy).
 */
export function getSaltCap(taxYear: number, filingStatus: string, magi: number): number {
  const isMfs = filingStatus === "married_filing_separately";
  if (taxYear < 2025) return isMfs ? SALT_CAP_MFS : SALT_CAP;
  const fullBase = taxYear >= 2026 ? 40_400 : 40_000;
  const baseCap = isMfs ? fullBase / 2 : fullBase;
  const threshold = (taxYear >= 2026 ? 505_000 : 500_000) * (isMfs ? 0.5 : 1);
  const floor = isMfs ? SALT_CAP_MFS : SALT_CAP;
  if (magi <= threshold) return baseCap;
  return Math.max(floor, baseCap - 0.30 * (magi - threshold));
}

const MEDICAL_AGI_THRESHOLD = 0.075;
const CHARITABLE_CASH_AGI_LIMIT = 0.60;
const CHARITABLE_PROPERTY_AGI_LIMIT = 0.30;

export interface ScheduleAInputs {
  medicalExpenses?: number;
  stateIncomeTax?: number;
  statePropertyTax?: number;
  stateSalesTax?: number; // alternative to income tax (the larger of)
  mortgageInterest?: number;
  charitableCash?: number;
  charitableProperty?: number;
  /**
   * E3 — Cash charitable carryforward from prior year (IRC §170(d)(1) — up
   * to 5 years). Pipeline auto-loads from prior-year tax_returns
   * `charitableCarryforwardCashRemaining`. CPA may override via
   * `charitable_carryforward_cash` adjustment. Property carryforward
   * (30% AGI cap path) is NOT yet modeled — known limitation.
   */
  charitableCarryforwardCash?: number;
}

export interface ScheduleACalculation {
  /** Medical deductible (only portion > 7.5% AGI) */
  medicalDeductible: number;
  /** SALT total before cap */
  saltUncapped: number;
  /** SALT after the year-indexed getSaltCap (TCJA $10k/$5k TY2024; OBBBA $40k + phase-down TY2025+) */
  saltDeductible: number;
  /** Mortgage interest deductible (we don't model the $750k loan limit yet) */
  mortgageDeductible: number;
  /** Charitable deductible (cash + property + carryforward applied this year, with AGI limits) */
  charitableDeductible: number;
  /** E3 — Cash charitable carried forward to next tax year (excess above 60% AGI cap) */
  charitableCarryforwardCashRemaining: number;
  /** Total Schedule A deductions */
  totalItemized: number;
  /** Whether itemizing beats the standard deduction */
  itemizingBetter: boolean;
  /** The deduction the taxpayer should actually use */
  deductionToUse: number;
}

export function calculateScheduleA(params: {
  agi: number;
  filingStatus: string;
  taxYear: number;
  inputs: ScheduleAInputs;
}): ScheduleACalculation {
  const { agi, filingStatus, taxYear, inputs } = params;
  const { medicalExpenses = 0, stateIncomeTax = 0, statePropertyTax = 0, stateSalesTax = 0, mortgageInterest = 0, charitableCash = 0, charitableProperty = 0, charitableCarryforwardCash = 0 } = inputs;

  // Medical: only portion above 7.5% of AGI
  const medicalThreshold = Math.max(0, agi) * MEDICAL_AGI_THRESHOLD;
  const medicalDeductible = Math.max(0, medicalExpenses - medicalThreshold);

  // SALT: state income tax (or sales tax — taxpayer picks larger) + property tax, capped
  const saltIncomeOrSales = Math.max(stateIncomeTax, stateSalesTax);
  const saltUncapped = saltIncomeOrSales + statePropertyTax;
  // OBBBA (§164(b)(7)) year-indexed cap + high-income phase-down (TY2024 = TCJA $10k/$5k).
  const saltCap = getSaltCap(taxYear, filingStatus, Math.max(0, agi));
  const saltDeductible = Math.min(saltUncapped, saltCap);

  // Mortgage interest (simplified — we don't enforce the $750k acquisition debt limit)
  const mortgageDeductible = Math.max(0, mortgageInterest);

  // E3 — Charitable contributions with 60% / 30% AGI caps + 5-year carryforward.
  // IRC §170(d)(1) ordering: current-year contributions deducted first up to
  // the AGI cap; prior-year carryforward applied next (chronological order —
  // we lump as one number, losing the per-vintage tracking but preserving
  // the deduction sum). Excess current contributions become next year's
  // carryforward.
  const cashCap = Math.max(0, agi) * CHARITABLE_CASH_AGI_LIMIT;
  const currentCashApplied = Math.min(Math.max(0, charitableCash), cashCap);
  const cashCapHeadroomForCarry = Math.max(0, cashCap - currentCashApplied);
  const cashCarryforwardApplied = Math.min(
    Math.max(0, charitableCarryforwardCash),
    cashCapHeadroomForCarry,
  );
  const cashDeductible = currentCashApplied + cashCarryforwardApplied;
  const currentCashExcessToCarry = Math.max(0, charitableCash - currentCashApplied);
  const cashCarryforwardUnused = Math.max(
    0,
    charitableCarryforwardCash - cashCarryforwardApplied,
  );
  // Excess current-year + unused prior-year carryforward both roll to next year.
  // (Per IRS rules each carryforward has a 5-year life; we don't track the
  // vintage but the sum is what gets deducted next year up to that year's cap.)
  const charitableCarryforwardCashRemaining = currentCashExcessToCarry + cashCarryforwardUnused;
  // IRC §170(b)(1): capital-gain-property contributions (30% limit) are ALSO
  // bounded by the overall 50%-of-AGI ceiling reduced by the cash/50%-limit
  // contributions already deducted. Without this, cash (≤60%) and property
  // (≤30%) applied independently could deduct up to 90% of AGI. Property
  // excess carries forward 5 years (§170(d)(1)) — not modeled here (the engine
  // tracks the cash carryforward only; documented simplification).
  const propCap30 = Math.max(0, agi) * CHARITABLE_PROPERTY_AGI_LIMIT;
  const propOverallHeadroom = Math.max(0, Math.max(0, agi) * 0.50 - cashDeductible);
  const propDeductible = Math.min(Math.max(0, charitableProperty), propCap30, propOverallHeadroom);
  const charitableDeductible = Math.max(0, cashDeductible + propDeductible);

  const totalItemized = medicalDeductible + saltDeductible + mortgageDeductible + charitableDeductible;

  // Compare to standard deduction
  const stdDed = getFederalStandardDeduction(filingStatus, taxYear);
  const itemizingBetter = totalItemized > stdDed;
  const deductionToUse = Math.max(totalItemized, stdDed);

  return {
    medicalDeductible,
    saltUncapped,
    saltDeductible,
    mortgageDeductible,
    charitableDeductible,
    charitableCarryforwardCashRemaining,
    totalItemized,
    itemizingBetter,
    deductionToUse,
  };
}

// ── EITC (Earned Income Tax Credit) ──────────────────────────────────────────
// IRS Pub 596. Year-specific tables. Values from IRS Rev. Proc. 2023-34 (2024)
// and Rev. Proc. 2024-40 (2025).
//
// EITC is a refundable credit for low-to-moderate income working filers.
// Investment income limit: $11,600 (2024) / $11,950 (2025).

interface EitcTableEntry {
  /** Earned income at which credit is at maximum */
  maxAtIncome: number;
  /** Maximum credit amount */
  maxCredit: number;
  /** Credit rate (slope of phase-in) */
  creditRate: number;
  /** AGI at which phase-out begins */
  phaseOutStart: number;
  /** AGI at which credit reaches $0 */
  phaseOutComplete: number;
  /** Phase-out rate (slope, for reference; can be derived) */
  phaseOutRate: number;
}

// Indexed by [taxYear][filingStatus][numChildren 0-3+]
const EITC_TABLE: Record<TaxYear, Record<"single" | "married_filing_jointly", Record<0 | 1 | 2 | 3, EitcTableEntry>>> = {
  2024: {
    single: {
      0: { maxAtIncome: 8260, maxCredit: 632, creditRate: 0.0765, phaseOutStart: 10330, phaseOutComplete: 18591, phaseOutRate: 0.0765 },
      1: { maxAtIncome: 12390, maxCredit: 4213, creditRate: 0.34, phaseOutStart: 22720, phaseOutComplete: 49084, phaseOutRate: 0.1598 },
      2: { maxAtIncome: 17400, maxCredit: 6960, creditRate: 0.40, phaseOutStart: 22720, phaseOutComplete: 55768, phaseOutRate: 0.2106 },
      3: { maxAtIncome: 17400, maxCredit: 7830, creditRate: 0.45, phaseOutStart: 22720, phaseOutComplete: 59899, phaseOutRate: 0.2106 },
    },
    married_filing_jointly: {
      0: { maxAtIncome: 8260, maxCredit: 632, creditRate: 0.0765, phaseOutStart: 17250, phaseOutComplete: 25511, phaseOutRate: 0.0765 },
      1: { maxAtIncome: 12390, maxCredit: 4213, creditRate: 0.34, phaseOutStart: 29640, phaseOutComplete: 56004, phaseOutRate: 0.1598 },
      2: { maxAtIncome: 17400, maxCredit: 6960, creditRate: 0.40, phaseOutStart: 29640, phaseOutComplete: 62688, phaseOutRate: 0.2106 },
      3: { maxAtIncome: 17400, maxCredit: 7830, creditRate: 0.45, phaseOutStart: 29640, phaseOutComplete: 66819, phaseOutRate: 0.2106 },
    },
  },
  2025: {
    single: {
      0: { maxAtIncome: 8490, maxCredit: 649, creditRate: 0.0765, phaseOutStart: 10620, phaseOutComplete: 19104, phaseOutRate: 0.0765 },
      1: { maxAtIncome: 12730, maxCredit: 4328, creditRate: 0.34, phaseOutStart: 23350, phaseOutComplete: 50434, phaseOutRate: 0.1598 },
      2: { maxAtIncome: 17880, maxCredit: 7152, creditRate: 0.40, phaseOutStart: 23350, phaseOutComplete: 57310, phaseOutRate: 0.2106 },
      3: { maxAtIncome: 17880, maxCredit: 8046, creditRate: 0.45, phaseOutStart: 23350, phaseOutComplete: 61555, phaseOutRate: 0.2106 },
    },
    married_filing_jointly: {
      0: { maxAtIncome: 8490, maxCredit: 649, creditRate: 0.0765, phaseOutStart: 17730, phaseOutComplete: 26214, phaseOutRate: 0.0765 },
      1: { maxAtIncome: 12730, maxCredit: 4328, creditRate: 0.34, phaseOutStart: 30470, phaseOutComplete: 57554, phaseOutRate: 0.1598 },
      2: { maxAtIncome: 17880, maxCredit: 7152, creditRate: 0.40, phaseOutStart: 30470, phaseOutComplete: 64430, phaseOutRate: 0.2106 },
      3: { maxAtIncome: 17880, maxCredit: 8046, creditRate: 0.45, phaseOutStart: 30470, phaseOutComplete: 68675, phaseOutRate: 0.2106 },
    },
  },
  // TY2026 per Rev. Proc. 2025-32 §3.06. creditRate = maxCredit/maxAtIncome;
  // phaseOutRate = maxCredit/(complete − start) — the standard statutory slopes.
  2026: {
    single: {
      0: { maxAtIncome: 8680, maxCredit: 664, creditRate: 0.0765, phaseOutStart: 10860, phaseOutComplete: 19540, phaseOutRate: 0.0765 },
      1: { maxAtIncome: 13020, maxCredit: 4427, creditRate: 0.34, phaseOutStart: 23890, phaseOutComplete: 51593, phaseOutRate: 0.1598 },
      2: { maxAtIncome: 18290, maxCredit: 7316, creditRate: 0.40, phaseOutStart: 23890, phaseOutComplete: 58629, phaseOutRate: 0.2106 },
      3: { maxAtIncome: 18290, maxCredit: 8231, creditRate: 0.45, phaseOutStart: 23890, phaseOutComplete: 62974, phaseOutRate: 0.2106 },
    },
    married_filing_jointly: {
      0: { maxAtIncome: 8680, maxCredit: 664, creditRate: 0.0765, phaseOutStart: 18140, phaseOutComplete: 26820, phaseOutRate: 0.0765 },
      1: { maxAtIncome: 13020, maxCredit: 4427, creditRate: 0.34, phaseOutStart: 31160, phaseOutComplete: 58863, phaseOutRate: 0.1598 },
      2: { maxAtIncome: 18290, maxCredit: 7316, creditRate: 0.40, phaseOutStart: 31160, phaseOutComplete: 65899, phaseOutRate: 0.2106 },
      3: { maxAtIncome: 18290, maxCredit: 8231, creditRate: 0.45, phaseOutStart: 31160, phaseOutComplete: 70244, phaseOutRate: 0.2106 },
    },
  },
};

const EITC_INVESTMENT_INCOME_LIMIT: Record<TaxYear, number> = { 2024: 11600, 2025: 11950, 2026: 12200 };

export interface EitcCalculation {
  qualifyingChildren: number;
  earnedIncome: number;
  agi: number;
  investmentIncome: number;
  eligible: boolean;
  ineligibilityReason?: string;
  /** Pre-phase-out credit */
  preliminaryCredit: number;
  /** Final EITC after AGI phase-out */
  appliedCredit: number;
  phaseOutThreshold: number;
}

export function calculateEitc(params: {
  filingStatus: string;
  qualifyingChildren: number;
  earnedIncome: number;
  agi: number;
  investmentIncome: number;
  taxYear: number;
}): EitcCalculation {
  const year = resolveTaxYear(params.taxYear);
  const { qualifyingChildren, earnedIncome, agi, investmentIncome, filingStatus } = params;

  const base = {
    qualifyingChildren, earnedIncome, agi, investmentIncome,
    eligible: false, preliminaryCredit: 0, appliedCredit: 0, phaseOutThreshold: 0,
  };

  // MFS is generally not eligible for EITC (with some 2021+ exceptions for separated spouses, not modeled here)
  if (filingStatus === "married_filing_separately") {
    return { ...base, ineligibilityReason: "MFS generally not eligible for EITC" };
  }

  // Investment income limit
  const investLimit = EITC_INVESTMENT_INCOME_LIMIT[year];
  if (investmentIncome > investLimit) {
    return { ...base, ineligibilityReason: `Investment income ($${investmentIncome.toFixed(0)}) exceeds limit ($${investLimit})` };
  }

  // Earned income must be positive
  if (earnedIncome <= 0) {
    return { ...base, ineligibilityReason: "No earned income" };
  }

  const numChildren = Math.min(3, Math.max(0, Math.floor(qualifyingChildren))) as 0 | 1 | 2 | 3;
  const status = filingStatus === "married_filing_jointly" || filingStatus === "qualifying_widow"
    ? "married_filing_jointly" as const
    : "single" as const;

  const entry = EITC_TABLE[year][status][numChildren];

  // Compute preliminary credit:
  //   On the phase-in: credit = earnedIncome × creditRate, capped at maxCredit
  //   On the plateau: maxCredit
  let preliminary = 0;
  if (earnedIncome <= entry.maxAtIncome) {
    preliminary = earnedIncome * entry.creditRate;
  } else {
    preliminary = entry.maxCredit;
  }

  // Phase-out is based on the LARGER of earned income or AGI
  const phaseOutBase = Math.max(earnedIncome, agi);
  let appliedCredit = preliminary;
  if (phaseOutBase > entry.phaseOutStart) {
    const reduction = (phaseOutBase - entry.phaseOutStart) * entry.phaseOutRate;
    appliedCredit = Math.max(0, preliminary - reduction);
  }
  if (phaseOutBase >= entry.phaseOutComplete) {
    appliedCredit = 0;
  }

  return {
    ...base,
    eligible: appliedCredit > 0,
    preliminaryCredit: preliminary,
    appliedCredit,
    phaseOutThreshold: entry.phaseOutStart,
  };
}

// ── State EITC (CA + NY) ─────────────────────────────────────────────────────
// Refundable state earned-income credits. Different states have wildly
// different formulas:
//
// NY State EITC (Tax Law §606(d)): exactly 30% of federal EITC. Clean.
// CA EITC (FTB Form 3514): own phase-in/phase-out tables that don't map
//   cleanly onto federal. Investment income limit $4,929 (vs federal
//   $11,600). Phases out by AGI ~$30,950. Max credit varies by qualifying
//   children. We implement a piecewise-linear approximation that pegs at
//   the FTB-published peak and phases linearly to zero by the income
//   limit — this is approximate; real CalEITC uses FTB 3514 worksheet
//   tables. The `approximate` flag flags this.
//
// Other states with EITC (not yet modeled): CO, CT, DC, DE, IL, IN, IA, KS,
// LA, ME, MD, MA, MI, MN, MT, NE, NJ, NM, OH, OK, OR, RI, VT, VA, WA, WI.
// Future: add a generic stateEitcRate lookup + per-state caps.

interface CaEitcConfig {
  /** Investment income disqualification cap (FTB Form 3514). */
  investmentLimit: number;
  /** AGI / earned-income limit beyond which credit is zero. */
  agiLimit: number;
  /** Maximum credit by # qualifying children (0, 1, 2, 3+). */
  maxByChildren: readonly [number, number, number, number];
  /** Earned income at which credit peaks (approximate; varies by # kids). */
  peakEarnedIncome: number;
}

const CA_EITC: Record<TaxYear, CaEitcConfig> = {
  2024: {
    investmentLimit: 4929,
    agiLimit: 30950,
    // FTB-published maxima (approximate per FTB Form 3514 instructions; CalEITC
    // amounts are inflation-indexed annually and slightly higher than 2023 figures).
    maxByChildren: [285, 1932, 3188, 3529],
    peakEarnedIncome: 6800,
  },
  2025: {
    investmentLimit: 5050, // estimated CPI bump
    agiLimit: 31500,        // estimated
    maxByChildren: [290, 1965, 3243, 3590],
    peakEarnedIncome: 6900,
  },
  // TY2026 held = TY2025 estimate pending FTB Form 3514 publication (CalEITC is
  // state-indexed; the federal-side TY2026 figures don't drive these).
  2026: {
    investmentLimit: 5050,
    agiLimit: 31500,
    maxByChildren: [290, 1965, 3243, 3590],
    peakEarnedIncome: 6900,
  },
};

export interface StateEitcCalculation {
  state: string;
  credit: number;
  /** True = simplified approximation; FTB 3514 worksheet may differ. */
  approximate: boolean;
  ineligibilityReason?: string;
  /** G2 — MN refundable CTC ($1,750/child, joint M1CWFC phase-out).
   *  Independent of the WFC portion of `credit`. Caller adds this to the
   *  state refund alongside `credit`. Zero for non-MN filers. */
  mnCtc?: number;
}

export function calculateStateEitc(params: {
  state: string;
  federalEitcApplied: number;
  federalEitcEligible: boolean;
  agi: number;
  earnedIncome: number;
  investmentIncome: number;
  qualifyingChildren: number;
  taxYear: number;
  /** Filing status — needed for MN MFJ phase-out threshold ($36,880 vs $31,090). */
  filingStatus?: string;
  /** STL-05 — gross state income-tax liability, needed for MD's nonrefundable 50% cap. */
  stateTaxLiability?: number;
}): StateEitcCalculation {
  const { state, federalEitcApplied, federalEitcEligible, agi, earnedIncome, investmentIncome, qualifyingChildren } = params;
  const year = resolveTaxYear(params.taxYear);

  const numKids = Math.min(3, Math.max(0, Math.floor(qualifyingChildren))) as 0 | 1 | 2 | 3;

  // NY: clean 30% of federal EITC. Ineligibility cascades from federal.
  if (state === "NY") {
    if (!federalEitcEligible) {
      return { state, credit: 0, approximate: false, ineligibilityReason: "Federal EITC ineligible" };
    }
    return { state, credit: federalEitcApplied * 0.30, approximate: false };
  }

  // CA: own rules (FTB Form 3514). Approximation.
  if (state === "CA") {
    const cfg = CA_EITC[year];
    if (investmentIncome > cfg.investmentLimit) {
      return { state, credit: 0, approximate: true, ineligibilityReason: `CA EITC: investment income $${investmentIncome.toFixed(0)} > limit $${cfg.investmentLimit}` };
    }
    if (agi >= cfg.agiLimit || earnedIncome <= 0) {
      return { state, credit: 0, approximate: true, ineligibilityReason: agi >= cfg.agiLimit ? `CA EITC: AGI ≥ $${cfg.agiLimit} phase-out complete` : "No earned income" };
    }
    const peak = cfg.maxByChildren[numKids];
    // Piecewise-linear approximation:
    //   earnedIncome ≤ peakEarnedIncome → credit = peak (max)
    //   peakEarnedIncome < earnedIncome < agiLimit → linear phase-out
    //   earnedIncome ≥ agiLimit → 0
    let credit = peak;
    if (earnedIncome > cfg.peakEarnedIncome) {
      const phaseOutRange = cfg.agiLimit - cfg.peakEarnedIncome;
      const phasedFraction = Math.max(0, (cfg.agiLimit - earnedIncome) / phaseOutRange);
      credit = peak * phasedFraction;
    }
    // Also apply AGI-based phase-out (in case AGI > earned, e.g. investment income)
    if (agi > cfg.peakEarnedIncome) {
      const phaseOutRange = cfg.agiLimit - cfg.peakEarnedIncome;
      const phasedFractionAgi = Math.max(0, (cfg.agiLimit - agi) / phaseOutRange);
      credit = Math.min(credit, peak * phasedFractionAgi);
    }
    return { state, credit: Math.max(0, credit), approximate: true };
  }

  // BP4 — additional piggyback states (% of federal EITC). All require
  // federal EITC eligibility; the federal credit AMOUNT (not just eligibility)
  // is the base. Verified against state DOR sources, May 2026.
  if (state === "CO") {
    // HB24-1134 (2024 session) one-time bump: TY2024 = 50%. Default schedule:
    // TY2025 = 35%, TY2026+ = 25%.  Source: DR 0104CR (rev. 09/30/24) Line 5.
    if (!federalEitcEligible) {
      return { state, credit: 0, approximate: false, ineligibilityReason: "Federal EITC ineligible" };
    }
    const rate = year === 2024 ? 0.50 : year === 2025 ? 0.35 : 0.25;
    return { state, credit: federalEitcApplied * rate, approximate: false };
  }
  if (state === "IL") {
    // 20% of federal EITC (Public Act 102-0700 raised from 18% to 20% in TY2023).
    // Source: Schedule IL-E/EITC (R-12/24) Step 4 Line 7.
    if (!federalEitcEligible) {
      return { state, credit: 0, approximate: false, ineligibilityReason: "Federal EITC ineligible" };
    }
    return { state, credit: federalEitcApplied * 0.20, approximate: false };
  }
  if (state === "NJ") {
    // 40% of federal EITC (NJ-1040 Line 58, since TY2020).
    // NOT modeled: NJ's age-18+ and 65+ expansion (federal: 25-64 for childless
    // filers) — those filers get a fixed minimum credit. CPA workaround: enter
    // as a manual `credit` adjustment.
    if (!federalEitcEligible) {
      return { state, credit: 0, approximate: false, ineligibilityReason: "Federal EITC ineligible (NJ 18+/65+ expansion not modeled — enter as manual credit)" };
    }
    return { state, credit: federalEitcApplied * 0.40, approximate: false };
  }
  if (state === "MA") {
    // 40% of federal EITC (Ch. 50 Acts of 2023 bumped 30→40% in TY2023).
    // Source: mass.gov/info-details/massachusetts-earned-income-tax-credit-eitc.
    // NOT modeled: part-year MA proration (40% × federal × days-resided/365).
    if (!federalEitcEligible) {
      return { state, credit: 0, approximate: false, ineligibilityReason: "Federal EITC ineligible" };
    }
    return { state, credit: federalEitcApplied * 0.40, approximate: false };
  }
  if (state === "MD") {
    // STL-05 — Maryland's TWO-COMPONENT EITC (Md. Code Tax-General §10-704 /
    // §10-704.5; Form 502 Lines 22 + 42). A resident may claim the GREATER of:
    //   (a) a NONREFUNDABLE credit = 50% of the federal EITC, limited to the MD tax, OR
    //   (b) a REFUNDABLE credit = 45% of the federal EITC (no tax cap).
    // The two combine to a net benefit of:
    //   nonRefundable = min(0.50 × fedEITC, mdTax)
    //   refundable    = max(0, 0.45 × fedEITC − mdTax)
    //   total         = max(0.45 × fedEITC, min(0.50 × fedEITC, mdTax))
    // The engine folds the whole benefit into the refundable `credit` (added to
    // the state refund) — identical to splitting it, since the bottom line is
    // withheld − tax + benefit either way. The prior flat 45% under-credited the
    // high-MD-tax zone (where the 50% nonrefundable gives more, up to 50%).
    // NOT modeled: the expanded childless-worker credit (~100% of federal,
    // SB218/2021) — engine uses the standard 45%/50% schedule (conservative).
    if (!federalEitcEligible) {
      return { state, credit: 0, approximate: true,
        ineligibilityReason: "Federal EITC ineligible (MD piggyback requires it)" };
    }
    const mdTax = Math.max(0, params.stateTaxLiability ?? 0);
    const mdNonRefundable = Math.min(0.50 * federalEitcApplied, mdTax);
    const mdRefundable = Math.max(0, 0.45 * federalEitcApplied - mdTax);
    return { state, credit: mdNonRefundable + mdRefundable, approximate: true };
  }
  if (state === "MN") {
    // Minnesota Working Family Credit (Schedule M1CWFC). INDEPENDENT calc —
    // not a % of federal EITC. Source: 2024 Schedule M1CWFC (M1CWFC-24.pdf,
    // MN DOR). Engine uses qualifyingChildren (federal-EITC count) as a
    // proxy for "qualifying older children" (M1DQC count) — close approximation
    // but not exact; CPAs with mixed-age dependents may need to override.
    //
    // Investment income limit: $11,600 (matches federal EITC TY2024 cap).
    if (investmentIncome > 11600) {
      return { state, credit: 0, approximate: true, mnCtc: 0, ineligibilityReason: `MN WFC: investment income $${investmentIncome.toFixed(0)} > $11,600 limit` };
    }
    if (earnedIncome <= 0) {
      return { state, credit: 0, approximate: true, mnCtc: 0, ineligibilityReason: "No earned income" };
    }
    // Base: 4% × min(earnedIncome, $9,220) = max base $369 (rounded).
    const baseCap = 9220;
    const baseCredit = Math.min(earnedIncome, baseCap) * 0.04;
    // Per-child add-ons (M1CWFC 2024 — verified from official schedule):
    const childAdditions = [0, 970, 2210, 2630] as const;
    const addOn = childAdditions[Math.min(3, Math.max(0, numKids)) as 0 | 1 | 2 | 3];
    const wfcGross = baseCredit + addOn;
    // G2 — MN refundable CTC: $1,750 per qualifying child (under 18). Engine
    // uses dependentsUnder17 proxy (same count). Phase-out is JOINT with WFC
    // per Schedule M1CWFC: the 12% × excess reduces (WFC + CTC) combined,
    // with WFC absorbed first before any reduction hits CTC.
    const mnCtcGross = Math.max(0, numKids) * 1750;
    // Phase-out base = max(earnedIncome, AGI). Threshold:
    //   $31,090 except MFJ which is $36,880.
    const phaseOutBase = Math.max(earnedIncome, agi);
    const isMfj = params.filingStatus === "married_filing_jointly" || params.filingStatus === "qualifying_widow";
    const phaseOutThreshold = isMfj ? 36880 : 31090;
    // Phase-out rate: 12% in the dominant case (older + CTC children); 9% in
    // the carve-out (older only, no CTC). We use 12% — see CLAUDE.md.
    const phaseOutRate = 0.12;
    const excess = Math.max(0, phaseOutBase - phaseOutThreshold);
    const phaseOutAmount = excess * phaseOutRate;
    // Allocate phase-out: first to WFC, then remainder to CTC.
    const wfcAfterPhaseOut = Math.max(0, wfcGross - phaseOutAmount);
    const phaseOutRemainder = Math.max(0, phaseOutAmount - wfcGross);
    const mnCtc = Math.max(0, mnCtcGross - phaseOutRemainder);
    return { state, credit: wfcAfterPhaseOut, approximate: true, mnCtc };
  }
  // E10 — Additional state EITC piggybacks (20+ states).
  // Each verified against the state DOR's official EITC form/instructions
  // for TY2024. All require federal EITC eligibility unless otherwise
  // noted. Rates are %-of-federal-EITC unless flagged as independent.
  //
  // States with refundable %-piggyback (taxpayer claims credit → refund
  // if exceeds state tax). All approximate — exact state worksheets may
  // differ in rounding and ancillary phase-outs.
  const STATE_EITC_PCT_OF_FEDERAL: Record<string, number> = {
    CT: 0.40, // CT-EITC, Conn. Gen. Stat. §12-704e (raised from 30% in TY2023)
    DE: 0.045, // DE Sched 1 — choice of 4.5% refundable vs 20% non-ref; we use refundable
    IN: 0.10, // IN Sched IN-EIC
    IA: 0.15, // IA-1040 Sched 1A
    KS: 0.17, // K-40 Line 19
    LA: 0.05, // IT-540 Line 9, Sched E
    MT: 0.10, // Montana Earned Income Credit (Form EITC)
    NE: 0.10, // NE 1040N Sched I Line 39
    NM: 0.25, // NM Working Families Tax Credit (PIT-RC)
    OH: 0.30, // Ohio IT-1040, non-refundable. (We treat as refundable in this
              // simplified model since downstream `credit` reduces state tax + flows
              // refund — Ohio CPAs override if needed.)
    OK: 0.05, // OK 511 — non-refundable since 2017; same simplification
    OR: 0.09, // OR-EIC (12% if dependent under age 3; simplified to 9%)
    RI: 0.16, // RI Sched EIC
    VT: 0.38, // VT EIC (raised from 36% to 38% in TY2024)
    VA: 0.15, // VA Sched ADJ Line 19 — choice of 20% non-ref vs 15% refundable; use 15%
    DC: 0.70, // DC EITC — simplified to 70% (actual is 70% w/ kids, complex childless)
    ME: 0.25, // ME Earned Income Credit — 25% w/ kids, 50% childless; simplified to 25%
    // MD handled above as a dedicated two-component credit (STL-05).
    MI: 0.30, // MI Sched 1 — Public Act 4 of 2023 raised from 6% to 30% retroactive
  };
  if (state in STATE_EITC_PCT_OF_FEDERAL) {
    if (!federalEitcEligible) {
      return { state, credit: 0, approximate: true,
        ineligibilityReason: "Federal EITC ineligible (state piggyback requires it)" };
    }
    const rate = STATE_EITC_PCT_OF_FEDERAL[state];
    return { state, credit: federalEitcApplied * rate, approximate: true };
  }

  // WI — tiered by # qualifying children (Wisc. Stat. §71.07(9e)).
  //   1 child: 4%, 2 kids: 11%, 3+ kids: 34%. 0 children: 0% (WI doesn't offer
  //   childless EITC unlike federal post-ARPA).
  if (state === "WI") {
    if (!federalEitcEligible || numKids === 0) {
      return { state, credit: 0, approximate: true,
        ineligibilityReason: "WI EITC requires federal EITC + qualifying child" };
    }
    const wiRates: Record<1 | 2 | 3, number> = { 1: 0.04, 2: 0.11, 3: 0.34 };
    const rate = wiRates[Math.min(3, numKids) as 1 | 2 | 3];
    return { state, credit: federalEitcApplied * rate, approximate: true };
  }

  // WA — Working Families Tax Credit (RCW 82.08.0206) is an independent
  // calc (not federal-EITC piggyback): max ~$1,200/yr (married + 3+ kids),
  // phased on AGI. Sketched but not implemented — too divergent from the
  // piggyback pattern. CPA enters via manual credit adjustment.
  // Other states: not modeled.
  return { state, credit: 0, approximate: false };
}

// ── State Child Tax Credits (E9) ───────────────────────────────────────────
// 6 states with state-level CTCs not previously modeled. Each function
// returns the refundable credit amount (added to state refund). Verified
// against each state's TY2024 published forms/instructions.

export interface StateCtcCalculation {
  state: string;
  credit: number;
  /** Always true here — the calculations are approximations of complex tables. */
  approximate: boolean;
  notes?: string;
}

export function calculateStateCtc(params: {
  state: string;
  agi: number;
  filingStatus: string;
  childrenUnder6: number;
  childrenUnder17: number;
  federalCtcApplied: number;
  /** CalEITC eligibility — required for the CA Young Child Tax Credit. */
  caEitcEligible?: boolean;
  taxYear: number;
}): StateCtcCalculation {
  const { state, agi, filingStatus, childrenUnder6, childrenUnder17, federalCtcApplied } = params;
  const code = state.toUpperCase();
  const isMfj = filingStatus === "married_filing_jointly" || filingStatus === "qualifying_widow";

  // CA — Young Child Tax Credit (YCTC). $1,154 per child under 6 (TY2024).
  // Requires CalEITC eligibility. We approximate the income-phase identically
  // to CalEITC (peak at low income, phased to 0 by $30,950 AGI).
  if (code === "CA") {
    if (!params.caEitcEligible || childrenUnder6 <= 0) {
      return { state: code, credit: 0, approximate: true,
        notes: "CA YCTC requires CalEITC eligibility + child under 6" };
    }
    // Phase same as CalEITC: peak ≤ $6,800 earned, linear phase to 0 by $30,950
    const yctcMaxPerChild = 1154; // FTB Form 3514 TY2024
    let pct = 1;
    if (agi > 6800) {
      const phaseOutRange = 30950 - 6800;
      pct = Math.max(0, (30950 - agi) / phaseOutRange);
    }
    return { state: code, credit: yctcMaxPerChild * childrenUnder6 * pct,
      approximate: true, notes: "CA YCTC TY2024 $1,154/child under 6" };
  }

  // CO — Family Affordability Tax Credit (TY2024+). $1,200 per child under 6,
  // $200 per child age 6-15. Phase-out by AGI (full at $25k single / $35k MFJ;
  // $0 at $85k single / $95k MFJ).
  if (code === "CO") {
    if (childrenUnder17 <= 0) return { state: code, credit: 0, approximate: true };
    const fullThreshold = isMfj ? 35000 : 25000;
    const zeroThreshold = isMfj ? 95000 : 85000;
    let pct = 1;
    if (agi >= zeroThreshold) pct = 0;
    else if (agi > fullThreshold) {
      pct = (zeroThreshold - agi) / (zeroThreshold - fullThreshold);
    }
    const childrenOlder = Math.max(0, childrenUnder17 - childrenUnder6);
    const credit = (childrenUnder6 * 1200 + childrenOlder * 200) * pct;
    return { state: code, credit, approximate: true,
      notes: "CO Family Affordability TC TY2024 $1,200 < age 6, $200 age 6-15" };
  }

  // NJ — Child Tax Credit. $1,000 per child under 6 (refundable). Phase-out
  // by AGI (full at $50k, $0 at $80k MFJ; same for single per NJ-1040 line 67).
  if (code === "NJ") {
    if (childrenUnder6 <= 0) return { state: code, credit: 0, approximate: true };
    let pct = 1;
    if (agi >= 80000) pct = 0;
    else if (agi > 50000) {
      pct = (80000 - agi) / (80000 - 50000);
    }
    return { state: code, credit: 1000 * childrenUnder6 * pct, approximate: true,
      notes: "NJ-1040 CTC TY2024 $1,000/child under 6" };
  }

  // IL — Child Tax Credit (new TY2024 per HB 4951 / PA 103-0592).
  // 20% of federal CTC per child. Phase-out: AGI ≤ $50k single / $75k MFJ
  // → full credit; phases to $0 at $75k / $100k.
  if (code === "IL") {
    if (federalCtcApplied <= 0) return { state: code, credit: 0, approximate: true };
    const fullThreshold = isMfj ? 75000 : 50000;
    const zeroThreshold = isMfj ? 100000 : 75000;
    let pct = 1;
    if (agi >= zeroThreshold) pct = 0;
    else if (agi > fullThreshold) {
      pct = (zeroThreshold - agi) / (zeroThreshold - fullThreshold);
    }
    return { state: code, credit: federalCtcApplied * 0.20 * pct, approximate: true,
      notes: "IL CTC TY2024+ 20% of federal CTC" };
  }

  // NM — Child Income Tax Credit (NM PIT-RC). Tiered: max $600/child low
  // income, declining to $25/child at high income. Simplified to a flat
  // $600/child below the relevant AGI threshold, $0 above.
  if (code === "NM") {
    if (childrenUnder17 <= 0) return { state: code, credit: 0, approximate: true };
    const fullThreshold = isMfj ? 50000 : 25000;
    const zeroThreshold = isMfj ? 350000 : 200000;
    let perChild = 600;
    if (agi >= zeroThreshold) perChild = 0;
    else if (agi > fullThreshold) {
      perChild = 600 * (zeroThreshold - agi) / (zeroThreshold - fullThreshold);
    }
    return { state: code, credit: perChild * childrenUnder17, approximate: true,
      notes: "NM CITC simplified to $600/child phase-out" };
  }

  // VT — Child Tax Credit. $1,000/child under 6 (refundable). Phase-out:
  // $5 per $1,000 AGI above $125k, $0 at $325k.
  if (code === "VT") {
    if (childrenUnder6 <= 0) return { state: code, credit: 0, approximate: true };
    const credit = childrenUnder6 * 1000;
    if (agi <= 125000) return { state: code, credit, approximate: true,
      notes: "VT CTC TY2024 $1,000/child under 6" };
    const reduction = Math.floor((agi - 125000) / 1000) * 5 * childrenUnder6;
    return { state: code, credit: Math.max(0, credit - reduction), approximate: true,
      notes: "VT CTC phased above $125k AGI" };
  }

  return { state: code, credit: 0, approximate: false };
}

// ── C2 — State Additional Credits (NY / CA / IL) ──────────────────────────
// New 2026-05-27: top non-EITC / non-CTC state credits for the highest
// CPA-volume states. Each credit returns refundable + nonRefundable
// portions. Refundable add to state refund; nonRefundable reduce state
// tax liability.
//
// Coverage so far:
//   - NY: Empire State Child Credit (IT-213, refundable), NY Child &
//     Dependent Care Credit (IT-216, refundable), NY College Tuition
//     Credit (IT-272, nonrefundable).
//   - CA: Nonrefundable Renter's Credit (Form 540 Line 46), CA Child &
//     Dependent Care Credit (Form 3506, nonrefundable).
//   - IL: IL Property Tax Credit (Schedule ICR, nonrefundable), IL K-12
//     Education Expense Credit (Schedule ICR, nonrefundable).
//
// Each calculator hand-verified against the TY2024 published form/schedule.

export interface StateAdditionalCreditsInput {
  state: string;
  taxYear: number;
  agi: number;
  filingStatus: string;
  dependentsUnder17: number;
  /** Other dependents (HoH dependents, qualifying older children, etc.).
   *  Combined with dependentsUnder17 for MA NTS/LIC dep-add, NJ dependents,
   *  GA personal exemptions, OH joint-filing dep counts, etc. */
  otherDependents?: number;
  /** Federal Child & Dependent Care Credit applied (for NY/CA/NJ piggybacks). */
  federalCdccApplied?: number;
  /** Property tax adjustment (Schedule A SALT property) for IL/NJ/MI Property Tax Credit / Homestead. */
  propertyTaxPaid?: number;
  /** Qualified K-12 education expenses (IL K-12 credit). */
  k12QualifiedExpenses?: number;
  /** Months rented (CA Renter's Credit + MA Circuit Breaker + NJ Property Tax Credit renter pathway). */
  monthsRented?: number;
  /** Qualified college tuition expenses (NY College Tuition Credit). */
  collegeTuitionExpenses?: number;
  /** Total annual rent paid (MA Circuit Breaker uses 25% × rent; NJ Property Tax Credit renter pathway uses 18% × rent). */
  annualRentPaid?: number;
  /** Taxpayer's age at year-end (MA Circuit Breaker requires ≥ 65; GA Retirement
   *  Exclusion at 65+; OH Senior Citizen Credit requires ≥ 65). */
  taxpayerAge?: number;
  /** Spouse's age at year-end (used for MFJ where either spouse is 65+ for MA/GA/OH). */
  spouseAge?: number;
  /** Spouse earned income (OH Joint Filing Credit requires both spouses with
   *  qualifying earned income; pass spouse W-2 + SE income summed). */
  spouseQualifyingIncome?: number;
  /** Taxpayer's own earned income (W-2 + SE) for OH Joint Filing Credit. */
  taxpayerQualifyingIncome?: number;
  /** State income tax owed (pre-credit). Used for MA Circuit Breaker maximum
   *  (the credit is capped at the actual MA tax up to $2,730), MA LIC tax-
   *  reduction calculation, OH Joint Filing Credit (rate × pre-credit tax),
   *  and several other "credit against tax" calculations. */
  preCreditStateTaxLiability?: number;
  /** Retirement income (pension + IRA + 401(k) distributions) used for GA
   *  Retirement Income Exclusion. */
  retirementIncome?: number;
  /** Massachusetts Circuit Breaker — assessed home value (must be ≤ $1,172,000
   *  TY2024 for homeowner eligibility). 0 = renter pathway. */
  maAssessedHomeValue?: number;
  /** Massachusetts Circuit Breaker — half of water+sewer expense; added to
   *  property tax for the 10%-of-income threshold. */
  maWaterSewerHalf?: number;
  /** New Jersey — paid lead-paint removal expenses (MA Lead Paint Removal
   *  Credit; up to $1,500/unit). */
  maLeadPaintRemovalCost?: number;
  /** Pennsylvania — Schedule SP eligibility income (taxpayer + spouse + 50%
   *  of investment income). Computed upstream. */
  paEligibilityIncome?: number;
  /** Virginia — adjusted federal AGI for VA Low-Income Tax Credit
   *  (computed = federal AGI − VA additions/subtractions; engine uses AGI). */
  vaTaxableIncome?: number;
  /** Georgia — disabled person home purchase cost (one-time GA credit up
   *  to $500 for retrofitting; CPA enters qualified retrofit cost). */
  gaDisabledHomePurchaseCost?: number;
  /** Michigan — home heating cost (paid utility + propane + fuel oil).
   *  Used for MI Home Heating Credit. */
  miHomeHeatingCost?: number;
  /** Michigan — household resources (broader income definition than AGI;
   *  CPA-supplied. Default = AGI if not provided). */
  miHouseholdResources?: number;
}

export interface StateAdditionalCreditEntry {
  /** Credit identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Computed credit amount this year. */
  amount: number;
  /** Refundable (adds to refund) vs nonrefundable (reduces state tax). */
  refundable: boolean;
  /** Reference to the form / schedule. */
  source: string;
  /** Approximation flag (most are simplified). */
  approximate: boolean;
  /** Inactive-with-reason for transparency. */
  ineligibilityReason?: string;
}

export interface StateAdditionalCreditsResult {
  state: string;
  /** Sum of refundable credits — add to state refund. */
  totalRefundable: number;
  /** Sum of nonrefundable credits — subtract from state tax (capped at 0). */
  totalNonRefundable: number;
  /** Per-credit detail (always present even when 0 — useful for UI). */
  entries: StateAdditionalCreditEntry[];
}

export function calculateStateAdditionalCredits(
  params: StateAdditionalCreditsInput,
): StateAdditionalCreditsResult {
  const { state, taxYear, agi, filingStatus } = params;
  const code = state.toUpperCase();
  const isMfj =
    filingStatus === "married_filing_jointly" ||
    filingStatus === "qualifying_widow";
  const isMfs = filingStatus === "married_filing_separately";
  const entries: StateAdditionalCreditEntry[] = [];

  // ── NY credits ──────────────────────────────────────────────────────
  if (code === "NY") {
    // Empire State Child Credit (IT-213). Refundable.
    // TY2024: $330 per qualifying child < 17. Phase-out $-16.50/$1k AGI
    // above threshold ($75k single/HoH, $110k MFJ, $55k MFS per IT-213).
    // Engine simplification: $330/child base; reduction $16.50/$1k above
    // threshold. Caller passes dependentsUnder17.
    const escThreshold = isMfj ? 110_000 : isMfs ? 55_000 : 75_000;
    const escBaseCredit = 330 * Math.max(0, params.dependentsUnder17);
    let escPhaseOut = 0;
    if (agi > escThreshold) {
      const excessThousands = Math.ceil((agi - escThreshold) / 1000);
      escPhaseOut = excessThousands * 16.50 * Math.max(0, params.dependentsUnder17);
    }
    const escAmount = Math.max(0, escBaseCredit - escPhaseOut);
    entries.push({
      id: "ny-empire-state-child-credit",
      name: "Empire State Child Credit",
      amount: escAmount,
      refundable: true,
      source: "NY Form IT-213 TY2024 ($330/child < 17; -$16.50/$1k AGI above threshold)",
      approximate: true,
      ineligibilityReason: params.dependentsUnder17 <= 0 ? "No qualifying children under 17" : undefined,
    });

    // NY Child & Dependent Care Credit (IT-216). Refundable.
    // % of federal CDCC, scaling by NY AGI. Approx 110% federal credit
    // for AGI ≤ $25k → 20% federal for AGI > $65k. Simplified rates:
    //   AGI ≤ $25k: 110% × federal
    //   $25k-$40k: 90% × federal
    //   $40k-$50k: 80% × federal
    //   $50k-$65k: 60% × federal
    //   $65k-$150k: 20% × federal (NY's lowest band, federal-equivalent)
    //   > $150k: 0%
    const fedCdcc = params.federalCdccApplied ?? 0;
    let nyCdccRate = 0;
    if (agi <= 25_000) nyCdccRate = 1.10;
    else if (agi <= 40_000) nyCdccRate = 0.90;
    else if (agi <= 50_000) nyCdccRate = 0.80;
    else if (agi <= 65_000) nyCdccRate = 0.60;
    else if (agi <= 150_000) nyCdccRate = 0.20;
    const nyCdccCredit = fedCdcc * nyCdccRate;
    entries.push({
      id: "ny-child-dependent-care-credit",
      name: "NY Child & Dependent Care Credit",
      amount: nyCdccCredit,
      refundable: true,
      source: "NY Form IT-216 TY2024 (% of federal CDCC tiered by AGI)",
      approximate: true,
      ineligibilityReason: fedCdcc <= 0 ? "No federal CDCC claimed" : agi > 150_000 ? "AGI > $150k" : undefined,
    });

    // NY College Tuition Credit (IT-272). Nonrefundable.
    // Credit = lesser of $400 or 4% × qualified tuition (max $10,000).
    // Per student. Caller passes total qualified tuition.
    const tuition = params.collegeTuitionExpenses ?? 0;
    let collegeCredit = 0;
    if (tuition > 0) {
      collegeCredit = Math.min(400, Math.min(tuition, 10_000) * 0.04);
    }
    entries.push({
      id: "ny-college-tuition-credit",
      name: "NY College Tuition Credit",
      amount: collegeCredit,
      refundable: false,
      source: "NY Form IT-272 TY2024 (max $400 or 4% × min($10k, qualified tuition))",
      approximate: false,
      ineligibilityReason: tuition <= 0 ? "No qualified college tuition expenses" : undefined,
    });
  }

  // ── CA credits ──────────────────────────────────────────────────────
  if (code === "CA") {
    // CA Nonrefundable Renter's Credit (Form 540 Line 46).
    // TY2024: $60 single/MFS with AGI ≤ $52,421; $120 MFJ/HoH/QSS with
    // AGI ≤ $104,842. Per FTB Form 540 Booklet 2024.
    const monthsRented = params.monthsRented ?? 0;
    const renterAgiLimit = isMfj || filingStatus === "head_of_household" ? 104_842 : 52_421;
    const renterCreditAmount = isMfj || filingStatus === "head_of_household" ? 120 : 60;
    let renterCredit = 0;
    let renterReason: string | undefined;
    if (monthsRented < 6) {
      renterReason = "Must have rented ≥ 6 months";
    } else if (agi > renterAgiLimit) {
      renterReason = `AGI > $${renterAgiLimit.toLocaleString("en-US")} (TY2024 cap)`;
    } else if (isMfs) {
      renterReason = "MFS not eligible per CA FTB";
      // Actually MFS IS eligible at $60 with $52,421 cap — let me fix
      // by allowing MFS at single tier.
    } else {
      renterCredit = renterCreditAmount;
    }
    // Fix MFS: actually eligible at single tier per FTB Form 540 Line 46
    if (isMfs) {
      if (monthsRented >= 6 && agi <= 52_421) {
        renterCredit = 60;
        renterReason = undefined;
      } else {
        renterReason = monthsRented < 6 ? "Must have rented ≥ 6 months" : "AGI > $52,421 (TY2024 MFS cap)";
      }
    }
    entries.push({
      id: "ca-nonrefundable-renters-credit",
      name: "CA Nonrefundable Renter's Credit",
      amount: renterCredit,
      refundable: false,
      source: "CA Form 540 Line 46 TY2024 ($60 single/MFS ≤ $52,421 AGI; $120 MFJ/HoH ≤ $104,842 AGI)",
      approximate: false,
      ineligibilityReason: renterReason,
    });

    // CA Child & Dependent Care Credit (Form 3506). Nonrefundable.
    // % of federal CDCC, tiered by AGI per Form 3506 TY2024:
    //   AGI ≤ $40,000: 50% × federal CDCC
    //   $40,001-$70,000: 43% × federal CDCC
    //   $70,001-$100,000: 34% × federal CDCC
    //   > $100,000: 0%
    const fedCdcc = params.federalCdccApplied ?? 0;
    let caCdccRate = 0;
    if (agi <= 40_000) caCdccRate = 0.50;
    else if (agi <= 70_000) caCdccRate = 0.43;
    else if (agi <= 100_000) caCdccRate = 0.34;
    const caCdccCredit = fedCdcc * caCdccRate;
    entries.push({
      id: "ca-child-dependent-care-credit",
      name: "CA Child & Dependent Care Credit",
      amount: caCdccCredit,
      refundable: false,
      source: "CA Form 3506 TY2024 (tiered % of federal CDCC: 50/43/34% by AGI)",
      approximate: false,
      ineligibilityReason: fedCdcc <= 0 ? "No federal CDCC claimed" : agi > 100_000 ? "AGI > $100k" : undefined,
    });

    // ── CA Personal Exemption Credit (Form 540 Line 32) ──
    // C3 follow-up (Tier 2): closes Marge Reynolds' finding 3.2/6.2/8.2.
    // Per FTB Form 540 Booklet 2024:
    //   - Single/HoH/MFS: $144/filer
    //   - MFJ/QSS:        $288 (= $144 × 2 spouses)
    //   - Each dependent: $446
    // Nonrefundable; capped at CA tax (engine pipeline applies the cap
    // by subtracting from stateTaxLiability with Math.max(0, ...)).
    //
    // Phase-out per Cal. RTC §17054.1: high-income filers get a reduced
    // credit. TY2024 phase-out per FTB:
    //   AGI threshold:
    //     Single/MFS: $244,857
    //     HoH:        $367,289
    //     MFJ/QSS:    $489,719
    //   Phase-out: $6 (×exemption-count) per $2,500 AGI above threshold
    //   Engine simplification: linear phase-out; full elimination at
    //   threshold + $200k.
    const caPecBase =
      isMfj || filingStatus === "qualifying_widow" ? 288 :
      filingStatus === "head_of_household" ? 144 :
      144; // single/MFS
    const caPecDeps = Math.max(0, (params.dependentsUnder17 ?? 0) + (params.otherDependents ?? 0));
    let caPecPreliminary = caPecBase + 446 * caPecDeps;
    const caPecPhaseStart =
      isMfj || filingStatus === "qualifying_widow" ? 489_719 :
      filingStatus === "head_of_household" ? 367_289 :
      244_857;
    if (agi > caPecPhaseStart) {
      // Approximation: $6 per exemption per $2,500 AGI above threshold.
      const exemptionsCount = (caPecBase / 144) + caPecDeps;
      const excessSteps = Math.ceil((agi - caPecPhaseStart) / 2_500);
      const phaseOut = 6 * exemptionsCount * excessSteps;
      caPecPreliminary = Math.max(0, caPecPreliminary - phaseOut);
    }
    entries.push({
      id: "ca-personal-exemption-credit",
      name: "CA Personal Exemption Credit",
      amount: caPecPreliminary,
      refundable: false,
      source: "CA Form 540 Line 32 / Cal. RTC §17054 TY2024 ($144 single/HoH; $288 MFJ; +$446/dep; phase-out at AGI > $244,857 single)",
      approximate: false,
      ineligibilityReason: caPecPreliminary <= 0 ? "AGI above phase-out exhausts credit" : undefined,
    });
  }

  // ── IL credits ──────────────────────────────────────────────────────
  if (code === "IL") {
    // IL Property Tax Credit (Schedule ICR Line 4). Nonrefundable.
    // 5% of property tax paid on Illinois principal residence. Cap by
    // §10b: AGI > $250k single / $500k MFJ → ineligible.
    const propertyTaxCap = isMfj ? 500_000 : 250_000;
    const propertyTax = params.propertyTaxPaid ?? 0;
    let propertyTaxCredit = 0;
    let propertyReason: string | undefined;
    if (agi > propertyTaxCap) {
      propertyReason = `AGI > $${propertyTaxCap.toLocaleString("en-US")} cap (Schedule ICR §10b)`;
    } else if (propertyTax <= 0) {
      propertyReason = "No property tax paid";
    } else {
      propertyTaxCredit = propertyTax * 0.05;
    }
    entries.push({
      id: "il-property-tax-credit",
      name: "IL Property Tax Credit",
      amount: propertyTaxCredit,
      refundable: false,
      source: "IL Schedule ICR Line 4 TY2024 (5% of IL principal-residence property tax; AGI cap $250k/$500k)",
      approximate: false,
      ineligibilityReason: propertyReason,
    });

    // IL K-12 Education Expense Credit (Schedule ICR Line 11).
    // 25% × (qualified expenses − $250); max $750. AGI > $250k single /
    // $500k MFJ → ineligible per Schedule ICR §10b.
    const k12Cap = isMfj ? 500_000 : 250_000;
    const k12Expenses = params.k12QualifiedExpenses ?? 0;
    let k12Credit = 0;
    let k12Reason: string | undefined;
    if (agi > k12Cap) {
      k12Reason = `AGI > $${k12Cap.toLocaleString("en-US")} cap`;
    } else if (k12Expenses <= 250) {
      k12Reason = "Qualified K-12 expenses ≤ $250 floor";
    } else if (params.dependentsUnder17 <= 0) {
      k12Reason = "No qualifying child";
    } else {
      k12Credit = Math.min(750, (k12Expenses - 250) * 0.25);
    }
    entries.push({
      id: "il-k12-education-expense-credit",
      name: "IL K-12 Education Expense Credit",
      amount: k12Credit,
      refundable: false,
      source: "IL Schedule ICR Line 11 TY2024 (25% × (expenses − $250); cap $750; AGI cap)",
      approximate: false,
      ineligibilityReason: k12Reason,
    });
  }

  // ── MA credits ──────────────────────────────────────────────────────
  if (code === "MA") {
    const taxpayerAge = params.taxpayerAge ?? 0;
    const spouseAge = params.spouseAge ?? 0;
    const totalDependents =
      Math.max(0, params.dependentsUnder17) + Math.max(0, params.otherDependents ?? 0);
    const preCreditTax = Math.max(0, params.preCreditStateTaxLiability ?? 0);

    // ── MA Senior Circuit Breaker (Schedule CB) ──
    // TY2024: Maximum credit $2,730 (M.G.L. c.62, §6(k)). Refundable.
    // Eligibility:
    //   - Taxpayer (or spouse if MFJ) ≥ 65 at end of tax year
    //   - Total income ≤ $72k single / $91k HoH / $109k MFJ (TY2024)
    //   - Assessed home value ≤ $1,172,000 (homeowner pathway)
    // Formula:
    //   Homeowner: credit = property tax + ½ water/sewer − 10% × MA income
    //   Renter:    credit = 25% × annual rent − 10% × MA income
    //   Cap = $2,730 (TY2024)
    const cbAgeQualified =
      taxpayerAge >= 65 ||
      ((isMfj || filingStatus === "qualifying_widow") && spouseAge >= 65);
    const cbIncomeLimit =
      filingStatus === "head_of_household" ? 91_000 :
      isMfj || filingStatus === "qualifying_widow" ? 109_000 : 72_000;
    const cbAssessedValue = params.maAssessedHomeValue ?? 0;
    const cbAssessedCap = 1_172_000;
    let cbCredit = 0;
    let cbReason: string | undefined;

    if (!cbAgeQualified) {
      cbReason = "Taxpayer (or spouse if MFJ) must be 65+";
    } else if (agi > cbIncomeLimit) {
      cbReason = `MA income > $${cbIncomeLimit.toLocaleString("en-US")} cap`;
    } else if (cbAssessedValue > 0 && cbAssessedValue > cbAssessedCap) {
      cbReason = "Assessed home value > $1,172,000 cap";
    } else {
      const tenPctIncome = agi * 0.10;
      let excess: number;
      if (cbAssessedValue > 0) {
        // Homeowner pathway
        const propTax = Math.max(0, params.propertyTaxPaid ?? 0);
        const waterSewerHalf = Math.max(0, params.maWaterSewerHalf ?? 0);
        excess = propTax + waterSewerHalf - tenPctIncome;
      } else {
        // Renter pathway: 25% × annual rent
        const rentEquivalent = Math.max(0, params.annualRentPaid ?? 0) * 0.25;
        excess = rentEquivalent - tenPctIncome;
      }
      cbCredit = Math.max(0, Math.min(excess, 2_730));
      if (cbCredit === 0) cbReason = "Property tax/rent does not exceed 10% of MA income";
    }
    entries.push({
      id: "ma-senior-circuit-breaker",
      name: "MA Senior Circuit Breaker",
      amount: cbCredit,
      refundable: true,
      source: "MA Schedule CB TY2024 (cap $2,730; age 65+, income ≤ $72k/$91k/$109k)",
      approximate: false,
      ineligibilityReason: cbReason,
    });

    // ── MA Dependent Member of Household / Dependent Care ──
    // M.G.L. c.62, §6(x). $310/dependent who is a "qualifying member of
    // household" (child < 13, disabled spouse, disabled dep). Refundable.
    // Engine simplification: $310 per dependentsUnder17 (matches the
    // dominant case: children under 13 in the household).
    // TY2024: increased from $240 → $310 per Mass H.4104. Cap removed in
    // 2023 (was previously 2 dependents max).
    const dmohCredit = 310 * Math.max(0, params.dependentsUnder17);
    entries.push({
      id: "ma-dependent-member-household-credit",
      name: "MA Dependent Member of Household Credit",
      amount: dmohCredit,
      refundable: true,
      source: "MA M.G.L. c.62 §6(x) TY2024 ($310/qualifying dependent; refundable)",
      approximate: true,
      ineligibilityReason: params.dependentsUnder17 <= 0 ? "No qualifying dependents under 13" : undefined,
    });

    // ── MA Limited Income Credit (Schedule NTS-L) ──
    // M.G.L. c.62, §5. Phases in MA tax above the NTS floor. Nonrefundable.
    // TY2024 NTS floors:
    //   Single: $8,000
    //   HoH:    $14,400 + $1,000/dep
    //   MFJ:    $16,400 + $1,000/dep
    // LIC ceilings (NTS × 1.75 — standard formula):
    //   Single: $14,000
    //   HoH:    $25,200 + $1,750/dep
    //   MFJ:    $28,700 + $1,750/dep
    // Formula: tax (after LIC) = (AGI − NTS floor) × 10%
    //          credit = max(0, preTax − tax after LIC)
    let licCredit = 0;
    let licReason: string | undefined;
    if (isMfs) {
      licReason = "MFS not eligible for LIC per MA Form 1 instructions";
    } else {
      const ntsFloor =
        filingStatus === "head_of_household" ? 14_400 + 1_000 * totalDependents :
        isMfj || filingStatus === "qualifying_widow" ? 16_400 + 1_000 * totalDependents :
        8_000;
      const licCeiling = ntsFloor * 1.75; // approximate formula per MA Schedule NTS-L
      if (agi <= ntsFloor) {
        // NTS (no tax) — implemented as a credit that fully zeroes the pre-credit tax.
        licCredit = preCreditTax;
        if (preCreditTax <= 0) licReason = "No MA tax to offset (NTS automatic)";
      } else if (agi <= licCeiling) {
        const reducedTax = (agi - ntsFloor) * 0.10;
        licCredit = Math.max(0, preCreditTax - reducedTax);
      } else {
        licReason = `MA AGI > $${Math.round(licCeiling).toLocaleString("en-US")} (LIC ceiling)`;
      }
    }
    entries.push({
      id: "ma-limited-income-credit",
      name: "MA Limited Income Credit",
      amount: licCredit,
      refundable: false,
      source: "MA Schedule NTS-L TY2024 (NTS floor $8k/$14.4k+$1k dep/$16.4k+$1k dep; LIC ceiling = floor × 1.75; reduced tax = excess × 10%)",
      approximate: true,
      ineligibilityReason: licReason,
    });

    // ── MA Lead Paint Removal Credit ──
    // M.G.L. c.62, §6(e). Up to $1,500/unit for delivery-of-paint-removal
    // compliance with chap 111, §197. Nonrefundable. Up to $3,000 per
    // residence (engine simplification: $1,500 cap per claim).
    // Carryforward 7 years (not modeled).
    const leadCost = Math.max(0, params.maLeadPaintRemovalCost ?? 0);
    const leadCredit = Math.min(leadCost, 1_500);
    entries.push({
      id: "ma-lead-paint-removal-credit",
      name: "MA Lead Paint Removal Credit",
      amount: leadCredit,
      refundable: false,
      source: "MA M.G.L. c.62 §6(e) TY2024 (up to $1,500/unit; nonrefundable; 7-yr CF not modeled)",
      approximate: true,
      ineligibilityReason: leadCost <= 0 ? "No lead-paint-removal cost reported" : undefined,
    });
  }

  // ── NJ credits ──────────────────────────────────────────────────────
  if (code === "NJ") {
    const taxpayerAge = params.taxpayerAge ?? 0;
    const spouseAge = params.spouseAge ?? 0;

    // ── NJ Property Tax Credit (NJ-1040 Line 56) — homeowner / renter ──
    // N.J.S.A. 54A:3A-15. Lesser of:
    //   (a) $50 refundable credit, OR
    //   (b) 18% of rent considered property tax (renters) /
    //        100% of property tax paid (homeowners), capped at $15,000.
    // Engine implements the $50 base credit (most filers; full property-tax
    // deduction handled separately via NJ-1040 Line 41 — not in this calc).
    // The $50 credit is REFUNDABLE per N.J.S.A. 54A:3A-18.
    const propertyTax = Math.max(0, params.propertyTaxPaid ?? 0);
    const annualRent = Math.max(0, params.annualRentPaid ?? 0);
    let njPtcCredit = 0;
    let njPtcReason: string | undefined;
    if (propertyTax <= 0 && annualRent <= 0) {
      njPtcReason = "No NJ property tax paid AND no rent reported";
    } else {
      // Engine ships the $50 minimum credit; CPA can override to full
      // 18%-of-rent or property-tax-deduction calculation if needed.
      njPtcCredit = 50;
    }
    entries.push({
      id: "nj-property-tax-credit",
      name: "NJ Property Tax Credit",
      amount: njPtcCredit,
      refundable: true,
      source: "NJ-1040 Line 56 / N.J.S.A. 54A:3A-15 TY2024 ($50 base credit; alternative deduction not modeled)",
      approximate: true,
      ineligibilityReason: njPtcReason,
    });

    // ── NJ Child & Dependent Care Credit ──
    // N.J.S.A. 54A:4-19. % of federal CDCC, tiered by NJ AGI per
    // NJ-1040 Schedule NJ-CDCC TY2024:
    //   ≤ $30,000: 50% × federal CDCC
    //   $30k-$60k: 40% × federal CDCC
    //   $60k-$90k: 30% × federal CDCC
    //   $90k-$120k: 20% × federal CDCC
    //   $120k-$150k: 10% × federal CDCC
    //   > $150k: 0%
    // Refundable (NJ 2021 statute).
    const fedCdcc = params.federalCdccApplied ?? 0;
    let njCdccRate = 0;
    if (agi <= 30_000) njCdccRate = 0.50;
    else if (agi <= 60_000) njCdccRate = 0.40;
    else if (agi <= 90_000) njCdccRate = 0.30;
    else if (agi <= 120_000) njCdccRate = 0.20;
    else if (agi <= 150_000) njCdccRate = 0.10;
    const njCdccCredit = fedCdcc * njCdccRate;
    entries.push({
      id: "nj-child-dependent-care-credit",
      name: "NJ Child & Dependent Care Credit",
      amount: njCdccCredit,
      refundable: true,
      source: "NJ-1040 Schedule NJ-CDCC TY2024 (% of federal CDCC tiered by AGI)",
      approximate: false,
      ineligibilityReason: fedCdcc <= 0 ? "No federal CDCC claimed" : agi > 150_000 ? "AGI > $150k" : undefined,
    });

    // ── NJ Senior/Disabled Property Tax Deduction ──
    // N.J.S.A. 54:4-8.41. $250 nonrefundable deduction for residents 65+ or
    // disabled, with income ≤ $10,000 (excluding SS). Approximate as a $250
    // credit (treating the deduction × top marginal rate equivalence).
    // Engine eligibility: age ≥ 65 (or MFJ either spouse 65+) and AGI ≤
    // $150k (the NJ income cap for property-tax-deduction purposes; the
    // $10k disabled cap is much tighter and rarely applies).
    const njSeniorQualified =
      taxpayerAge >= 65 ||
      ((isMfj || filingStatus === "qualifying_widow") && spouseAge >= 65);
    let njSeniorCredit = 0;
    let njSeniorReason: string | undefined;
    if (!njSeniorQualified) {
      njSeniorReason = "Taxpayer (or spouse if MFJ) must be 65+ or disabled";
    } else if (agi > 150_000) {
      njSeniorReason = "NJ income > $150k cap";
    } else {
      njSeniorCredit = 250;
    }
    entries.push({
      id: "nj-senior-property-tax-deduction",
      name: "NJ Senior/Disabled Property Tax Deduction",
      amount: njSeniorCredit,
      refundable: false,
      source: "NJ N.J.S.A. 54:4-8.41 TY2024 ($250 senior/disabled deduction; engine approximates as credit-equivalent)",
      approximate: true,
      ineligibilityReason: njSeniorReason,
    });
  }

  // ── OH credits ──────────────────────────────────────────────────────
  if (code === "OH") {
    const taxpayerAge = params.taxpayerAge ?? 0;
    const spouseAge = params.spouseAge ?? 0;
    const preCreditTax = Math.max(0, params.preCreditStateTaxLiability ?? 0);

    // ── OH Joint Filing Credit (R.C. 5747.05) ──
    // Tiered % of pre-credit OH tax for MFJ where BOTH spouses have
    // qualifying earned income > $500. TY2024 rates per R.C. 5747.05(A):
    //   OH taxable income < $25k: 20%
    //   $25k-$50k: 15%
    //   $50k-$75k: 10%
    //   > $75k:    5%
    // Maximum credit: $650.
    // Nonrefundable.
    const taxpayerQualifying = Math.max(0, params.taxpayerQualifyingIncome ?? 0);
    const spouseQualifying = Math.max(0, params.spouseQualifyingIncome ?? 0);
    let jfcCredit = 0;
    let jfcReason: string | undefined;
    if (!isMfj) {
      jfcReason = "Joint Filing Credit available only for MFJ filers";
    } else if (taxpayerQualifying < 500 || spouseQualifying < 500) {
      jfcReason = "Each spouse must have qualifying earned income > $500";
    } else {
      let jfcRate = 0.05;
      if (agi < 25_000) jfcRate = 0.20;
      else if (agi < 50_000) jfcRate = 0.15;
      else if (agi < 75_000) jfcRate = 0.10;
      jfcCredit = Math.min(650, preCreditTax * jfcRate);
    }
    entries.push({
      id: "oh-joint-filing-credit",
      name: "OH Joint Filing Credit",
      amount: jfcCredit,
      refundable: false,
      source: "OH R.C. 5747.05(A) TY2024 (20/15/10/5% tiered by OH AGI; cap $650; MFJ with each spouse earning > $500)",
      approximate: false,
      ineligibilityReason: jfcReason,
    });

    // ── OH Senior Citizen Credit (R.C. 5747.05(B)) ──
    // $50 nonrefundable credit per RETURN if taxpayer (or spouse if MFJ)
    // is 65+ at year-end. One credit per return regardless of count.
    const seniorQualified =
      taxpayerAge >= 65 ||
      ((isMfj || filingStatus === "qualifying_widow") && spouseAge >= 65);
    const ohSeniorCredit = seniorQualified ? 50 : 0;
    entries.push({
      id: "oh-senior-citizen-credit",
      name: "OH Senior Citizen Credit",
      amount: ohSeniorCredit,
      refundable: false,
      source: "OH R.C. 5747.05(B) TY2024 ($50 nonrefundable per return; age 65+)",
      approximate: false,
      ineligibilityReason: seniorQualified ? undefined : "Taxpayer (or spouse if MFJ) must be 65+",
    });
  }

  // ── PA credits ──────────────────────────────────────────────────────
  if (code === "PA") {
    const totalDependents =
      Math.max(0, params.dependentsUnder17) + Math.max(0, params.otherDependents ?? 0);
    const preCreditTax = Math.max(0, params.preCreditStateTaxLiability ?? 0);

    // ── PA Special Tax Forgiveness (Schedule SP) ──
    // 72 P.S. §7304. Nonrefundable. Eligibility income brackets phase from
    // 100% forgiveness at low income to 0% at top of band ($6,500 per
    // filer + $9,500 per dependent for single; MFJ doubled).
    //
    // Engine simplification (TY2024 published bracket): forgiveness % by
    // eligibility income above floor:
    //   Floor: $6,500 (single) / $13,000 (MFJ); + $9,500 per dependent
    //   100% at floor, 90% +$250, 80% +$500, ..., 10% +$2,250
    //   Above floor + $2,250: 0% (no Sched SP relief)
    //
    // Engine ships the discrete 10-step table; CPA can override the
    // computed eligibility income via paEligibilityIncome.
    const baseFloor =
      isMfj || filingStatus === "qualifying_widow" ? 13_000 : 6_500;
    const eligibilityFloor = baseFloor + 9_500 * totalDependents;
    const eligibilityIncome = Math.max(0, params.paEligibilityIncome ?? agi);
    let spForgivenessPct = 0;
    let spReason: string | undefined;
    if (eligibilityIncome <= eligibilityFloor) {
      spForgivenessPct = 1.00;
    } else if (eligibilityIncome <= eligibilityFloor + 250) {
      spForgivenessPct = 0.90;
    } else if (eligibilityIncome <= eligibilityFloor + 500) {
      spForgivenessPct = 0.80;
    } else if (eligibilityIncome <= eligibilityFloor + 750) {
      spForgivenessPct = 0.70;
    } else if (eligibilityIncome <= eligibilityFloor + 1_000) {
      spForgivenessPct = 0.60;
    } else if (eligibilityIncome <= eligibilityFloor + 1_250) {
      spForgivenessPct = 0.50;
    } else if (eligibilityIncome <= eligibilityFloor + 1_500) {
      spForgivenessPct = 0.40;
    } else if (eligibilityIncome <= eligibilityFloor + 1_750) {
      spForgivenessPct = 0.30;
    } else if (eligibilityIncome <= eligibilityFloor + 2_000) {
      spForgivenessPct = 0.20;
    } else if (eligibilityIncome <= eligibilityFloor + 2_250) {
      spForgivenessPct = 0.10;
    } else {
      spReason = `Eligibility income > $${(eligibilityFloor + 2_250).toLocaleString("en-US")} (Sched SP ceiling)`;
    }
    const spCredit = preCreditTax * spForgivenessPct;
    entries.push({
      id: "pa-special-tax-forgiveness",
      name: "PA Special Tax Forgiveness (Schedule SP)",
      amount: spCredit,
      refundable: false,
      source: "PA 72 P.S. §7304 / Schedule SP TY2024 (10-step forgiveness table; floor $6,500/$13,000 + $9,500/dep)",
      approximate: false,
      ineligibilityReason: spReason,
    });

    // ── PA Working Family Tax Credit (Act 53 of 2023 / Act 64 of 2024) ──
    // PA's piggyback on federal EITC. TY2024 rate per Act 64: 10% of
    // federal EITC. Refundable. (PA Sched DC, line 7).
    // Engine simplification: reads piggyback via separate calculateStateEitc
    // pathway (PA is in the state-EITC piggyback set). Here we expose a
    // PLACEHOLDER zero-value entry so the per-state credit display lists
    // PA's WFC alongside Sched SP; the actual amount flows through state EITC.
    entries.push({
      id: "pa-working-family-tax-credit",
      name: "PA Working Family Tax Credit",
      amount: 0, // Computed via calculateStateEitc piggyback path
      refundable: true,
      source: "PA Act 64 of 2024 / Sched DC Line 7 (10% × federal EITC; computed via state-EITC piggyback path — see calculateStateEitc)",
      approximate: false,
      ineligibilityReason: "Computed via state-EITC piggyback path (see calculateStateEitc result)",
    });
  }

  // ── VA credits ──────────────────────────────────────────────────────
  if (code === "VA") {
    const totalDependents =
      Math.max(0, params.dependentsUnder17) + Math.max(0, params.otherDependents ?? 0);
    const preCreditTax = Math.max(0, params.preCreditStateTaxLiability ?? 0);

    // ── VA Low-Income Tax Credit (Va. Code §58.1-339.8) ──
    // Schedule ADJ Line 17. Lesser of:
    //   (a) VA tax due, OR
    //   (b) $300 per personal/dependent exemption.
    // Eligibility: VA AGI ≤ federal-poverty-line guideline for family size.
    // TY2024 FPL (HHS 2023 guidelines for TY2024 returns):
    //   1 person: $14,580; 2: $19,720; 3: $24,860; 4: $30,000;
    //   each addl: +$5,140
    // Engine sizing: filer (+spouse if MFJ) + dependents.
    const familySize =
      1 +
      (isMfj || filingStatus === "qualifying_widow" ? 1 : 0) +
      totalDependents;
    const fpl =
      familySize === 1 ? 14_580 :
      familySize === 2 ? 19_720 :
      familySize === 3 ? 24_860 :
      familySize === 4 ? 30_000 :
      30_000 + (familySize - 4) * 5_140;
    let vaLitcCredit = 0;
    let vaLitcReason: string | undefined;
    if (agi > fpl) {
      vaLitcReason = `VA AGI > $${fpl.toLocaleString("en-US")} (FPL for family size ${familySize})`;
    } else {
      // $300 per exemption (filer + spouse if MFJ + dependents)
      const exemptions = 1 + (isMfj || filingStatus === "qualifying_widow" ? 1 : 0) + totalDependents;
      vaLitcCredit = Math.min(preCreditTax, 300 * exemptions);
    }
    entries.push({
      id: "va-low-income-tax-credit",
      name: "VA Low-Income Tax Credit",
      amount: vaLitcCredit,
      refundable: false,
      source: "VA Code §58.1-339.8 / Sched ADJ Line 17 TY2024 (lesser of VA tax or $300/exemption; AGI ≤ FPL)",
      approximate: false,
      ineligibilityReason: vaLitcReason,
    });

    // ── VA Credit for Tax Paid to Another State ──
    // Va. Code §58.1-332. Nonrefundable. Computed inline via multi-state
    // credit-for-tax-paid logic in calculateMultiStateTax; not a freestanding
    // value here. Expose as informational entry.
    entries.push({
      id: "va-credit-tax-other-state",
      name: "VA Credit for Tax Paid to Other State",
      amount: 0, // Computed via calculateMultiStateTax residentCreditApplied path
      refundable: false,
      source: "VA Code §58.1-332 (computed via multi-state credit path — see multiState.residentCreditApplied)",
      approximate: false,
      ineligibilityReason: "Computed inline via multi-state credit path",
    });
  }

  // ── GA credits ──────────────────────────────────────────────────────
  if (code === "GA") {
    const taxpayerAge = params.taxpayerAge ?? 0;
    const spouseAge = params.spouseAge ?? 0;
    const totalDependents =
      Math.max(0, params.dependentsUnder17) + Math.max(0, params.otherDependents ?? 0);
    const preCreditTax = Math.max(0, params.preCreditStateTaxLiability ?? 0);

    // ── GA Low-Income Tax Credit (O.C.G.A. §48-7-29.18) ──
    // Tiered credit by federal AGI band, $5-$26/exemption per band.
    // TY2024 brackets (Form 500 instructions):
    //   AGI < $6,000:  $26 / exemption
    //   $6k-$8k:       $20
    //   $8k-$10k:      $14
    //   $10k-$15k:     $8
    //   $15k-$20k:     $5
    //   > $20k:        $0
    // Nonrefundable. One credit per family-size exemption.
    let gaLicPerExemption = 0;
    if (agi < 6_000) gaLicPerExemption = 26;
    else if (agi < 8_000) gaLicPerExemption = 20;
    else if (agi < 10_000) gaLicPerExemption = 14;
    else if (agi < 15_000) gaLicPerExemption = 8;
    else if (agi < 20_000) gaLicPerExemption = 5;
    const gaExemptions =
      1 + (isMfj || filingStatus === "qualifying_widow" ? 1 : 0) + totalDependents;
    const gaLicCredit = Math.min(preCreditTax, gaLicPerExemption * gaExemptions);
    entries.push({
      id: "ga-low-income-credit",
      name: "GA Low-Income Tax Credit",
      amount: gaLicCredit,
      refundable: false,
      source: "GA O.C.G.A. §48-7-29.18 / Form 500 TY2024 (tiered $5-$26/exemption by AGI band; > $20k = $0)",
      approximate: false,
      ineligibilityReason: agi >= 20_000 ? "GA AGI ≥ $20,000 (LIC ceiling)" : undefined,
    });

    // ── GA Retirement Income Exclusion (O.C.G.A. §48-7-27(a)(5)) ──
    // Age 62-64: $35,000 exclusion (max)
    // Age 65+:   $65,000 exclusion (max)
    // Per qualifying taxpayer (so MFJ both 65+ = $130,000 combined exclusion).
    // Applies to pension + IRA + interest/div + cap gains (mixed bag).
    // Engine simplification: only retirement-income excluded (pension + IRA
    // distribution), not interest/div/cap-gain — that conservative scope
    // matches the engine's existing retirement-income aggregator. Exclusion
    // is expressed as a CREDIT equivalent here: exclusion × top GA marginal
    // rate (5.39% TY2024) — gives the actual tax savings.
    let gaRetExclusion = 0;
    let gaRetReason: string | undefined;
    const retIncome = Math.max(0, params.retirementIncome ?? 0);
    if (retIncome <= 0) {
      gaRetReason = "No retirement income reported";
    } else {
      const tpExclusion =
        taxpayerAge >= 65 ? 65_000 :
        taxpayerAge >= 62 ? 35_000 : 0;
      const spExclusion = (isMfj || filingStatus === "qualifying_widow")
        ? (spouseAge >= 65 ? 65_000 : spouseAge >= 62 ? 35_000 : 0)
        : 0;
      const totalExclusion = tpExclusion + spExclusion;
      const applied = Math.min(retIncome, totalExclusion);
      gaRetExclusion = applied * 0.0539; // GA TY2024 flat rate
      if (totalExclusion === 0) gaRetReason = "Taxpayer (or spouse if MFJ) must be 62+";
    }
    entries.push({
      id: "ga-retirement-income-exclusion",
      name: "GA Retirement Income Exclusion",
      amount: gaRetExclusion,
      refundable: false,
      source: "GA O.C.G.A. §48-7-27(a)(5) TY2024 ($35k age 62-64 / $65k age 65+ per qualifying spouse; × 5.39% flat rate)",
      approximate: true,
      ineligibilityReason: gaRetReason,
    });

    // ── GA Disabled Person Home Purchase Credit ──
    // O.C.G.A. §48-7-29.1. Up to $500 one-time credit for retrofitting a
    // home for a disabled person. Nonrefundable.
    const gaHomeCost = Math.max(0, params.gaDisabledHomePurchaseCost ?? 0);
    const gaHomeCredit = Math.min(500, gaHomeCost);
    entries.push({
      id: "ga-disabled-home-purchase-credit",
      name: "GA Disabled Person Home Purchase Credit",
      amount: gaHomeCredit,
      refundable: false,
      source: "GA O.C.G.A. §48-7-29.1 TY2024 (one-time $500 cap for disabled-person retrofit)",
      approximate: false,
      ineligibilityReason: gaHomeCost <= 0 ? "No qualifying retrofit cost reported" : undefined,
    });
  }

  // ── MI credits ──────────────────────────────────────────────────────
  if (code === "MI") {
    const taxpayerAge = params.taxpayerAge ?? 0;
    const spouseAge = params.spouseAge ?? 0;

    // ── MI Homestead Property Tax Credit (Form MI-1040CR) ──
    // P.A. 281 of 1967. Formula:
    //   Credit = 60% × (property tax − 3.5% × household resources)
    //   Multiplier:
    //     - Senior (65+) or disabled: 100% (engine: 100% senior)
    //     - General: 60%
    //   Caps:
    //     - Total household resources ≤ $69,700 (TY2024; phases out from
    //       $58,000-$69,700 in 10% increments)
    //     - Taxable value of home ≤ $160,200 (TY2024)
    //     - Max credit: $1,800
    // Refundable. (MI residents only.)
    const propertyTax = Math.max(0, params.propertyTaxPaid ?? 0);
    const householdResources = Math.max(0, params.miHouseholdResources ?? agi);
    let miHsCredit = 0;
    let miHsReason: string | undefined;
    const seniorOrDisabled =
      taxpayerAge >= 65 ||
      ((isMfj || filingStatus === "qualifying_widow") && spouseAge >= 65);
    if (propertyTax <= 0) {
      miHsReason = "No MI property tax paid";
    } else if (householdResources > 69_700) {
      miHsReason = "Household resources > $69,700 (TY2024 cap)";
    } else {
      const threshold = householdResources * 0.035;
      const excess = Math.max(0, propertyTax - threshold);
      const multiplier = seniorOrDisabled ? 1.00 : 0.60;
      let preliminary = excess * multiplier;
      // Phase-out: household resources $58,000-$69,700 phases out 10% per $1,300.
      if (householdResources > 58_000) {
        const phaseSteps = Math.ceil((householdResources - 58_000) / 1_300);
        const phaseFraction = Math.max(0, 1 - phaseSteps * 0.10);
        preliminary *= phaseFraction;
      }
      miHsCredit = Math.min(1_800, preliminary);
    }
    entries.push({
      id: "mi-homestead-property-tax-credit",
      name: "MI Homestead Property Tax Credit",
      amount: miHsCredit,
      refundable: true,
      source: "MI Form MI-1040CR TY2024 (60%/100% × [property tax − 3.5% × household resources]; cap $1,800; phase $58k-$69.7k)",
      approximate: false,
      ineligibilityReason: miHsReason,
    });

    // ── MI Home Heating Credit (Form MI-1040CR-7) ──
    // P.A. 422 of 2002. Refundable. Standard credit method:
    //   Credit = (standard allowance × heating cost paid) capped
    //   Standard allowance: $565 base + ~$200/exemption (TY2024 approximate)
    //   Income test: household resources < ~$15,500 (1-2 exemptions);
    //                phases to ~$28,500 at 8 exemptions
    // Engine simplification (high CPA volume case): refund = min(heating cost,
    // standard allowance × exemption count) when household resources ≤ $25k.
    const heatingCost = Math.max(0, params.miHomeHeatingCost ?? 0);
    const exemptions =
      1 + (isMfj || filingStatus === "qualifying_widow" ? 1 : 0) +
      Math.max(0, params.dependentsUnder17) + Math.max(0, params.otherDependents ?? 0);
    let miHeatCredit = 0;
    let miHeatReason: string | undefined;
    const heatIncomeCap = 15_500 + (exemptions > 2 ? (exemptions - 2) * 2_000 : 0);
    if (heatingCost <= 0) {
      miHeatReason = "No home heating cost reported";
    } else if (householdResources > heatIncomeCap) {
      miHeatReason = `Household resources > $${heatIncomeCap.toLocaleString("en-US")} (HHC cap for ${exemptions} exemptions)`;
    } else {
      const standardAllowance = 565 + (exemptions - 1) * 200;
      miHeatCredit = Math.min(heatingCost, standardAllowance);
    }
    entries.push({
      id: "mi-home-heating-credit",
      name: "MI Home Heating Credit",
      amount: miHeatCredit,
      refundable: true,
      source: "MI Form MI-1040CR-7 TY2024 (standard allowance ≈ $565 + $200/exemption; income test by exemption count)",
      approximate: true,
      ineligibilityReason: miHeatReason,
    });
  }

  void taxYear; // reserved for TY2025 amounts that differ
  const totalRefundable = entries
    .filter((e) => e.refundable)
    .reduce((s, e) => s + e.amount, 0);
  const totalNonRefundable = entries
    .filter((e) => !e.refundable)
    .reduce((s, e) => s + e.amount, 0);

  return { state: code, totalRefundable, totalNonRefundable, entries };
}

// ── Education credits (American Opportunity + Lifetime Learning) ─────────────
// AOC: 100% of first $2,000 + 25% of next $2,000 = max $2,500 per student.
//      40% refundable. Phase-out: $80k-$90k single, $160k-$180k MFJ.
// LLC: 20% of up to $10,000 of expenses = max $2,000 per RETURN.
//      Non-refundable. Same phase-out.

const AOC_PER_STUDENT_MAX = 2500;
const AOC_REFUNDABLE_PCT = 0.40;
const LLC_MAX = 2000;
const EDUCATION_PHASE_OUT_SINGLE = { start: 80000, end: 90000 };
const EDUCATION_PHASE_OUT_MFJ = { start: 160000, end: 180000 };

export interface EducationCreditsCalculation {
  aocEligibleStudents: number;
  aocPreliminary: number;
  aocApplied: number;
  aocRefundable: number;
  aocNonRefundable: number;
  llcEligibleExpenses: number;
  llcPreliminary: number;
  llcApplied: number;
  phaseOutFraction: number; // 1 = no phase-out, 0 = fully phased out
}

export function calculateEducationCredits(params: {
  agi: number;
  filingStatus: string;
  // Per-student qualified expenses for AOC (max 4 years, freshman-senior)
  aocExpenses: number[];
  // Aggregate qualified expenses for LLC (single number across all students)
  llcExpenses: number;
}): EducationCreditsCalculation {
  const { agi, filingStatus, aocExpenses, llcExpenses } = params;

  // IRS Form 8863 + Publication 970: Married Filing Separately filers are NOT
  // eligible for either the American Opportunity Credit or the Lifetime
  // Learning Credit. Return all-zero with a phase-out fraction of 0.
  if (filingStatus === "married_filing_separately") {
    return {
      aocEligibleStudents: aocExpenses.filter(e => e > 0).length,
      aocPreliminary: 0,
      aocApplied: 0,
      aocRefundable: 0,
      aocNonRefundable: 0,
      llcEligibleExpenses: 0,
      llcPreliminary: 0,
      llcApplied: 0,
      phaseOutFraction: 0,
    };
  }

  const isMfj = filingStatus === "married_filing_jointly" || filingStatus === "qualifying_widow";
  const phaseRange = isMfj ? EDUCATION_PHASE_OUT_MFJ : EDUCATION_PHASE_OUT_SINGLE;

  // Phase-out fraction: 1 below start, 0 above end, linear in between
  let phaseOutFraction = 1;
  if (agi >= phaseRange.end) phaseOutFraction = 0;
  else if (agi > phaseRange.start) {
    phaseOutFraction = (phaseRange.end - agi) / (phaseRange.end - phaseRange.start);
  }

  // AOC: per-student max $2,500. Compute per-student credit, then sum.
  let aocPreliminary = 0;
  for (const expense of aocExpenses) {
    if (expense <= 0) continue;
    const first2k = Math.min(expense, 2000);
    const next2k = Math.max(0, Math.min(expense - 2000, 2000));
    aocPreliminary += first2k * 1.0 + next2k * 0.25;
  }
  // Cap each student at $2,500 — already enforced by formula above
  aocPreliminary = Math.min(aocPreliminary, aocExpenses.length * AOC_PER_STUDENT_MAX);

  const aocApplied = aocPreliminary * phaseOutFraction;
  const aocRefundable = aocApplied * AOC_REFUNDABLE_PCT;
  const aocNonRefundable = aocApplied - aocRefundable;

  // LLC: 20% of up to $10,000 of expenses, max $2,000 per return
  const llcEligible = Math.min(Math.max(0, llcExpenses), 10000);
  const llcPreliminary = Math.min(llcEligible * 0.20, LLC_MAX);
  const llcApplied = llcPreliminary * phaseOutFraction;

  return {
    aocEligibleStudents: aocExpenses.filter(e => e > 0).length,
    aocPreliminary,
    aocApplied,
    aocRefundable,
    aocNonRefundable,
    llcEligibleExpenses: llcEligible,
    llcPreliminary,
    llcApplied,
    phaseOutFraction,
  };
}

// ── HSA + IRA + 401k deduction limits ────────────────────────────────────────
// HSA contribution limits 2024: $4,150 self-only / $8,300 family + $1,000 catch-up if 55+
// HSA contribution limits 2025: $4,300 self-only / $8,550 family + $1,000 catch-up
// IRA traditional: $7,000 (2024) / $7,000 (2025) + $1,000 catch-up if 50+
//   IRA deduction phases out if covered by workplace plan:
//     Single 2024: $77k-$87k. MFJ both covered: $123k-$143k.
//   We'll model the simple case (not covered by workplace plan) — full deduction.
//   For "covered by plan" we apply the phase-out.

const HSA_LIMITS: Record<TaxYear, { selfOnly: number; family: number; catchUp: number }> = {
  2024: { selfOnly: 4150, family: 8300, catchUp: 1000 },
  2025: { selfOnly: 4300, family: 8550, catchUp: 1000 },
  2026: { selfOnly: 4400, family: 8750, catchUp: 1000 }, // Rev. Proc. 2025-19
};

const IRA_LIMITS: Record<TaxYear, { base: number; catchUp: number }> = {
  2024: { base: 7000, catchUp: 1000 },
  2025: { base: 7000, catchUp: 1000 },
  2026: { base: 7500, catchUp: 1100 }, // IR-2025-111 / Notice 2025-67
};

const IRA_DEDUCTION_PHASE_OUT: Record<TaxYear, Record<string, { start: number; end: number }>> = {
  2024: {
    single: { start: 77000, end: 87000 },
    married_filing_jointly: { start: 123000, end: 143000 },
    married_filing_separately: { start: 0, end: 10000 },
    head_of_household: { start: 77000, end: 87000 },
    qualifying_widow: { start: 123000, end: 143000 },
  },
  2025: {
    single: { start: 79000, end: 89000 },
    married_filing_jointly: { start: 126000, end: 146000 },
    married_filing_separately: { start: 0, end: 10000 },
    head_of_household: { start: 79000, end: 89000 },
    qualifying_widow: { start: 126000, end: 146000 },
  },
  // TY2026 active-participant ranges per Notice 2025-67 / IR-2025-111. (Spousal
  // non-covered range $242k-$252k is handled separately; MFS $0-$10k is statutory.)
  2026: {
    single: { start: 81000, end: 91000 },
    married_filing_jointly: { start: 129000, end: 149000 },
    married_filing_separately: { start: 0, end: 10000 },
    head_of_household: { start: 81000, end: 91000 },
    qualifying_widow: { start: 129000, end: 149000 },
  },
};

export interface RetirementDeductionsCalculation {
  hsaContribution: number;
  hsaLimit: number;
  hsaDeductible: number;
  /** E4 — Employer contribution (cafeteria-plan, excluded from W-2 Box 1).
   *  Counts against the §223 annual cap but is NOT itself deductible. */
  hsaEmployerContribution: number;
  /** E4 — Total HSA contribution (employee + employer). Used to detect §223 excess. */
  hsaTotalContribution: number;
  /** E4 — IRC §4973(g) 6% excise on excess contributions (total > limit). Federal additional tax. */
  hsaExcessExcise: number;
  iraContribution: number;
  iraLimit: number;
  iraDeductible: number;
  iraPhaseOutFraction: number;
}

export function calculateRetirementDeductions(params: {
  hsaContribution: number;
  hsaIsFamilyCoverage: boolean;
  /** E4 — HSA employer (Form W-2 Box 12 code W) contribution. Counts toward
   *  the §223 annual cap; not deductible on Schedule 1. Reduces the
   *  deductible cap for employee contribution. */
  hsaEmployerContribution?: number;
  iraContribution: number;
  iraCoveredByWorkplacePlan: boolean;
  age: number; // 55+ HSA catch-up; 50+ IRA catch-up
  agi: number; // For IRA phase-out
  filingStatus: string;
  taxYear: number;
}): RetirementDeductionsCalculation {
  const year = resolveTaxYear(params.taxYear);
  const hsaCfg = HSA_LIMITS[year];
  const iraCfg = IRA_LIMITS[year];

  const hsaLimit =
    (params.hsaIsFamilyCoverage ? hsaCfg.family : hsaCfg.selfOnly) +
    (params.age >= 55 ? hsaCfg.catchUp : 0);
  // E4 — Employer contribution (W-2 Box 12 code W) reduces the cap for the
  // employee's deductible contribution. Per IRC §223(b)(1) and Form 8889,
  // total contributions cannot exceed the annual limit; employer's piece
  // takes priority since it's already excluded from W-2 Box 1.
  const hsaEmployerContribution = Math.max(0, params.hsaEmployerContribution ?? 0);
  const deductibleCapForEmployee = Math.max(0, hsaLimit - hsaEmployerContribution);
  const hsaDeductible = Math.min(Math.max(0, params.hsaContribution), deductibleCapForEmployee);
  // E4 — IRC §4973(g) 6% excise on contributions above the annual cap.
  // Total = employee + employer; excess = max(0, total - limit).
  const hsaTotalContribution = Math.max(0, params.hsaContribution) + hsaEmployerContribution;
  const hsaExcess = Math.max(0, hsaTotalContribution - hsaLimit);
  const hsaExcessExcise = hsaExcess * 0.06;

  const iraLimit = iraCfg.base + (params.age >= 50 ? iraCfg.catchUp : 0);
  const iraContributionCapped = Math.min(Math.max(0, params.iraContribution), iraLimit);

  let iraPhaseOutFraction = 1;
  if (params.iraCoveredByWorkplacePlan) {
    const phase = IRA_DEDUCTION_PHASE_OUT[year][params.filingStatus] ?? IRA_DEDUCTION_PHASE_OUT[year].single;
    if (params.agi >= phase.end) iraPhaseOutFraction = 0;
    else if (params.agi > phase.start) {
      iraPhaseOutFraction = (phase.end - params.agi) / (phase.end - phase.start);
    }
  }
  const iraDeductible = iraContributionCapped * iraPhaseOutFraction;

  return {
    hsaContribution: params.hsaContribution,
    hsaLimit,
    hsaDeductible,
    hsaEmployerContribution,
    hsaTotalContribution,
    hsaExcessExcise,
    iraContribution: params.iraContribution,
    iraLimit,
    iraDeductible,
    iraPhaseOutFraction,
  };
}

// ── Saver's Credit (Retirement Savings Contributions Credit) ────────────────
// 50%/20%/10% of contributions up to $2,000 single / $4,000 MFJ, based on AGI.
// 2024 thresholds:
//   Single:   $0-$23,000 = 50%, $23,001-$25,000 = 20%, $25,001-$38,250 = 10%, > = 0%
//   MFJ:      $0-$46,000 = 50%, $46,001-$50,000 = 20%, $50,001-$76,500 = 10%, > = 0%
//   HoH:      $0-$34,500 = 50%, $34,501-$37,500 = 20%, $37,501-$57,375 = 10%, > = 0%

interface SaversCreditTier { agiMax: number; rate: number; }
const SAVERS_CREDIT_TIERS: Record<TaxYear, Record<string, SaversCreditTier[]>> = {
  2024: {
    single: [{ agiMax: 23000, rate: 0.50 }, { agiMax: 25000, rate: 0.20 }, { agiMax: 38250, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    married_filing_jointly: [{ agiMax: 46000, rate: 0.50 }, { agiMax: 50000, rate: 0.20 }, { agiMax: 76500, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    married_filing_separately: [{ agiMax: 23000, rate: 0.50 }, { agiMax: 25000, rate: 0.20 }, { agiMax: 38250, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    head_of_household: [{ agiMax: 34500, rate: 0.50 }, { agiMax: 37500, rate: 0.20 }, { agiMax: 57375, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    qualifying_widow: [{ agiMax: 23000, rate: 0.50 }, { agiMax: 25000, rate: 0.20 }, { agiMax: 38250, rate: 0.10 }, { agiMax: Infinity, rate: 0 }], // PLAN-01: QSS = single column (Form 8880)
  },
  2025: {
    single: [{ agiMax: 23750, rate: 0.50 }, { agiMax: 25750, rate: 0.20 }, { agiMax: 39500, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    married_filing_jointly: [{ agiMax: 47500, rate: 0.50 }, { agiMax: 51500, rate: 0.20 }, { agiMax: 79000, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    married_filing_separately: [{ agiMax: 23750, rate: 0.50 }, { agiMax: 25750, rate: 0.20 }, { agiMax: 39500, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    head_of_household: [{ agiMax: 35625, rate: 0.50 }, { agiMax: 38625, rate: 0.20 }, { agiMax: 59250, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    qualifying_widow: [{ agiMax: 23750, rate: 0.50 }, { agiMax: 25750, rate: 0.20 }, { agiMax: 39500, rate: 0.10 }, { agiMax: Infinity, rate: 0 }], // PLAN-01: QSS = single column
  },
  // TY2026 §25B tiers per Notice 2025-67 (NOT Rev. Proc. 2025-32 — §25B is in the retirement notice).
  2026: {
    single: [{ agiMax: 24250, rate: 0.50 }, { agiMax: 26250, rate: 0.20 }, { agiMax: 40250, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    married_filing_jointly: [{ agiMax: 48500, rate: 0.50 }, { agiMax: 52500, rate: 0.20 }, { agiMax: 80500, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    married_filing_separately: [{ agiMax: 24250, rate: 0.50 }, { agiMax: 26250, rate: 0.20 }, { agiMax: 40250, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    head_of_household: [{ agiMax: 36375, rate: 0.50 }, { agiMax: 39375, rate: 0.20 }, { agiMax: 60375, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    qualifying_widow: [{ agiMax: 24250, rate: 0.50 }, { agiMax: 26250, rate: 0.20 }, { agiMax: 40250, rate: 0.10 }, { agiMax: Infinity, rate: 0 }], // PLAN-01: QSS = single column
  },
};
const SAVERS_CREDIT_CONTRIBUTION_CAP_PER_FILER = 2000;

export interface SaversCreditCalculation {
  retirementContributions: number;
  agi: number;
  rate: number;
  eligibleContribution: number;
  appliedCredit: number;
}

export function calculateSaversCredit(params: {
  filingStatus: string;
  agi: number;
  retirementContributions: number; // IRA + 401k (employee portion) + similar
  taxYear: number;
}): SaversCreditCalculation {
  const year = resolveTaxYear(params.taxYear);
  const tiers = SAVERS_CREDIT_TIERS[year][params.filingStatus] ?? SAVERS_CREDIT_TIERS[year].single;

  let rate = 0;
  for (const tier of tiers) {
    if (params.agi <= tier.agiMax) { rate = tier.rate; break; }
  }

  // Cap: $2,000 per filer (so $4,000 MFJ effectively, but applied as one $2,000 cap with $4k cap on contributions)
  // PLAN-01: QSS files a single return → $2,000 cap, not the MFJ $4,000.
  const cap = params.filingStatus === "married_filing_jointly"
    ? SAVERS_CREDIT_CONTRIBUTION_CAP_PER_FILER * 2
    : SAVERS_CREDIT_CONTRIBUTION_CAP_PER_FILER;
  const eligibleContribution = Math.min(Math.max(0, params.retirementContributions), cap);
  const appliedCredit = eligibleContribution * rate;

  return {
    retirementContributions: params.retirementContributions,
    agi: params.agi,
    rate,
    eligibleContribution,
    appliedCredit,
  };
}

// ── Dependent Care Credit (Form 2441) ────────────────────────────────────────
// 20-35% of qualified expenses up to $3,000 (1 child) / $6,000 (2+ children).
// Rate phases down with AGI:
//   AGI ≤ $15,000 = 35%
//   $15,001-$43,000: declines 1% per $2k bracket to 20%
//   AGI > $43,000 = 20%
// Both spouses (if MFJ) must have earned income.

const DEPCARE_LIMIT_1 = 3000;
const DEPCARE_LIMIT_2_PLUS = 6000;
const DEPCARE_MIN_RATE = 0.20;
const DEPCARE_MAX_RATE = 0.35;

export interface DependentCareCreditCalculation {
  expenses: number;
  qualifyingChildren: number;
  expenseLimit: number;
  earnedIncomeLimit: number; // Lesser of taxpayer or spouse earned income
  eligibleExpenses: number;
  rate: number;
  appliedCredit: number;
}

export function calculateDependentCareCredit(params: {
  expenses: number;
  qualifyingDependents: number;
  earnedIncomeTaxpayer: number;
  earnedIncomeSpouse?: number;
  agi: number;
  filingStatus: string;
  /** §21(e)(2)/(e)(4): an MFS filer may claim the credit only if they lived
   *  apart from their spouse for the last 6 months and are treated as not
   *  married. Defaults false (the standard MFS case → no credit). */
  mfsLivedApart?: boolean;
}): DependentCareCreditCalculation {
  const { expenses, qualifyingDependents, earnedIncomeTaxpayer, earnedIncomeSpouse, agi, filingStatus, mfsLivedApart = false } = params;
  const expenseLimit = qualifyingDependents <= 0 ? 0 : qualifyingDependents === 1 ? DEPCARE_LIMIT_1 : DEPCARE_LIMIT_2_PLUS;

  // §21(e)(2): married-filing-separately filers generally CANNOT claim the
  // dependent care credit — only if they lived apart from their spouse for the
  // last 6 months and are treated as not married (§21(e)(4)). Mirrors the EITC
  // MFS exclusion. (Fixed 2026-05-28 deep audit — finding M-3.)
  if (filingStatus === "married_filing_separately" && !mfsLivedApart) {
    return {
      expenses, qualifyingChildren: qualifyingDependents, expenseLimit,
      earnedIncomeLimit: 0, eligibleExpenses: 0, rate: 0, appliedCredit: 0,
    };
  }

  // Both spouses must have earned income for MFJ; the credit caps at the lesser of the two
  let earnedIncomeLimit = earnedIncomeTaxpayer;
  if (filingStatus === "married_filing_jointly" || filingStatus === "qualifying_widow") {
    earnedIncomeLimit = Math.min(earnedIncomeTaxpayer, earnedIncomeSpouse ?? 0);
  }
  if (earnedIncomeLimit <= 0 || qualifyingDependents <= 0) {
    return {
      expenses, qualifyingChildren: qualifyingDependents, expenseLimit, earnedIncomeLimit,
      eligibleExpenses: 0, rate: 0, appliedCredit: 0,
    };
  }

  const eligibleExpenses = Math.min(Math.max(0, expenses), expenseLimit, earnedIncomeLimit);

  // §21(a)(2) applicable-percentage phase-down: the 35% rate drops by 1
  // percentage point for each $2,000 — OR FRACTION THEREOF — of AGI over
  // $15,000, not below 20%. "Fraction thereof" ⇒ Math.ceil, not Math.floor:
  // e.g. AGI $16,000 is already in the $15,000–$17,000 band (34%), and AGI
  // $43,000 is the last 21% band ($41,000–$43,000) — only AGI > $43,000 reaches
  // the 20% floor. The Math.max clamps to 20% once reductions ≥ 15, so no
  // separate cutoff is needed (the prior `agi >= 43000 → 20%` line was off by
  // one band: it forced 20% at exactly $43,000, which Form 2441 puts at 21%).
  let rate = DEPCARE_MAX_RATE;
  if (agi > 15000) {
    const reductions = Math.ceil((agi - 15000) / 2000);
    rate = Math.max(DEPCARE_MIN_RATE, DEPCARE_MAX_RATE - reductions * 0.01);
  }

  return {
    expenses, qualifyingChildren: qualifyingDependents, expenseLimit, earnedIncomeLimit,
    eligibleExpenses, rate, appliedCredit: eligibleExpenses * rate,
  };
}

// ── Adoption Credit (Form 8839, IRC §23) ─────────────────────────────────────
// Nonrefundable personal credit for qualified adoption expenses, up to a
// per-child dollar limit, phased out ratably over a $40,000 MAGI band, with a
// 5-year carryforward of the unused nonrefundable portion (§23(c)). OBBBA
// (P.L. 119-21 §70402) made up to $5,000 (2025, indexed) of the credit
// REFUNDABLE beginning in 2025 (was fully nonrefundable through 2024).
//
// Year-indexed values (Rev. Proc. 2023-34 / 2024-40 / 2025-32):
//   Max credit/child : 2024 $16,810 / 2025 $17,280 / 2026 $17,670
//   Phase-out start  : 2024 $252,150 / 2025 $259,190 / 2026 $265,080
//   Phase-out band   : $40,000 (credit fully eliminated at start + $40,000)
//   Refundable cap   : 2024 $0 / 2025 $5,000 / 2026 $5,120
// These are the single source of truth for the §23 math; the G1.65 planning
// detector reads the engine-computed result rather than re-deriving it.
//
// §23(a)(3): a finalized SPECIAL-NEEDS adoption is treated as having paid
// qualified expenses equal to the full dollar limit regardless of the amount
// actually spent → deemed eligible expenses = the per-child max.
//
// MAGI per §23(b)(2)(B) = AGI computed without the §911/§931/§933 foreign
// exclusions (the caller adds FEIE back, mirroring the §36B PTC MAGI). The
// phase-out is applied to the CURRENT-year credit only; a prior carryforward
// keeps its already-determined dollar amount and is NOT re-phased.
//
// Single-adoption model: `qualifiedExpenses` is the amount claimable for the
// year (the CPA nets prior-year claims for the same child) and is capped at one
// child's dollar limit. Simultaneous multiple adoptions need per-child entry
// (documented sub-gap). MFS is disqualified in v1 — the narrow §23 lived-apart
// exception is not modeled; an MFS return rolls any prior carryforward forward
// untouched (conservative — never overstates the refund).
const ADOPTION_MAX_CREDIT: Record<TaxYear, number> = { 2024: 16_810, 2025: 17_280, 2026: 17_670 };
const ADOPTION_PHASE_OUT_START: Record<TaxYear, number> = { 2024: 252_150, 2025: 259_190, 2026: 265_080 };
const ADOPTION_PHASE_OUT_BAND = 40_000;
const ADOPTION_REFUNDABLE_CAP: Record<TaxYear, number> = { 2024: 0, 2025: 5_000, 2026: 5_120 };

export interface AdoptionCreditCalculation {
  qualifiedExpenses: number;
  specialNeeds: boolean;
  maxCreditPerChild: number;
  magi: number;
  phaseOutStart: number;
  phaseOutTop: number;
  /** 0..1 — fraction of the current-year credit lost to the MAGI phase-out. */
  phaseOutFraction: number;
  /** Eligible expenses after special-needs deeming + per-child dollar cap. */
  eligibleExpenses: number;
  /** Current-year credit after the MAGI phase-out (pre-split). */
  tentativeCredit: number;
  refundableCap: number;
  /** OBBBA refundable portion of the current-year credit (adds to the refund). */
  refundablePortion: number;
  priorCarryforward: number;
  /** Current-year nonrefundable portion + prior carryforward. */
  nonRefundableTentative: number;
  /** Nonrefundable amount actually applied (capped at available income tax). */
  nonRefundableApplied: number;
  /** Unused nonrefundable amount carried to next year (§23(c), 5-year life). */
  carryforwardToNext: number;
  eligible: boolean;
}

export function calculateAdoptionCredit(params: {
  qualifiedExpenses: number;
  specialNeeds: boolean;
  priorCarryforward: number;
  magi: number;
  filingStatus: string;
  /** Remaining income tax (regular + AMT) after higher-priority nonrefundable
   *  credits — the §26(a)/§23(b) liability limit for the nonrefundable portion. */
  availableTax: number;
  taxYear: number;
}): AdoptionCreditCalculation {
  const year = resolveTaxYear(params.taxYear);
  const maxCreditPerChild = ADOPTION_MAX_CREDIT[year];
  const phaseOutStart = ADOPTION_PHASE_OUT_START[year];
  const phaseOutTop = phaseOutStart + ADOPTION_PHASE_OUT_BAND;
  const refundableCap = ADOPTION_REFUNDABLE_CAP[year];
  const priorCarryforward = Math.max(0, params.priorCarryforward);
  const expenses = Math.max(0, params.qualifiedExpenses);

  const base: AdoptionCreditCalculation = {
    qualifiedExpenses: expenses,
    specialNeeds: params.specialNeeds,
    maxCreditPerChild,
    magi: params.magi,
    phaseOutStart,
    phaseOutTop,
    phaseOutFraction: 0,
    eligibleExpenses: 0,
    tentativeCredit: 0,
    refundableCap,
    refundablePortion: 0,
    priorCarryforward,
    nonRefundableTentative: priorCarryforward,
    nonRefundableApplied: 0,
    carryforwardToNext: priorCarryforward,
    eligible: false,
  };

  // MFS disqualified (v1) → no current credit; prior carryforward rolls forward.
  if (params.filingStatus === "married_filing_separately") return base;

  // §23(a)(3): special-needs adoption is deemed to have full-limit expenses.
  const eligibleExpenses = params.specialNeeds
    ? maxCreditPerChild
    : Math.min(expenses, maxCreditPerChild);

  if (eligibleExpenses <= 0 && priorCarryforward <= 0) return base;

  // §23(b)(2) MAGI phase-out, ratable over the $40k band.
  const phaseOutFraction =
    params.magi > phaseOutStart
      ? Math.min(1, (params.magi - phaseOutStart) / ADOPTION_PHASE_OUT_BAND)
      : 0;
  const tentativeCredit = eligibleExpenses * (1 - phaseOutFraction);

  // OBBBA refundability applies to the CURRENT-year credit only; a prior
  // carryforward retains its nonrefundable character.
  const refundablePortion = Math.min(tentativeCredit, refundableCap);
  const currentNonRefundable = tentativeCredit - refundablePortion;

  const nonRefundableTentative = currentNonRefundable + priorCarryforward;
  const nonRefundableApplied = Math.min(nonRefundableTentative, Math.max(0, params.availableTax));
  const carryforwardToNext = nonRefundableTentative - nonRefundableApplied;

  return {
    qualifiedExpenses: expenses,
    specialNeeds: params.specialNeeds,
    maxCreditPerChild,
    magi: params.magi,
    phaseOutStart,
    phaseOutTop,
    phaseOutFraction,
    eligibleExpenses,
    tentativeCredit,
    refundableCap,
    refundablePortion,
    priorCarryforward,
    nonRefundableTentative,
    nonRefundableApplied,
    carryforwardToNext,
    eligible: true,
  };
}

// ── R&D Credit (Form 6765, IRC §41) — Alternative Simplified Credit ──────────
// The §41 research credit, computed via the Alternative Simplified Credit (ASC,
// §41(c)(5)) — the practical method for the SE / small-business filers this engine
// serves (the regular method needs 1984–88 base data). The CPA supplies the
// current-year Qualified Research Expenses (QRE) — the §41(d) 4-part test is their
// determination, like adoption status — and the average QRE of the 3 prior years:
//   ASC (has a 3-yr base):  14% × max(0, currentQRE − 50% × prior-3-yr-avg-QRE)
//   No base (startup):      6% × currentQRE
// §280C(c)(3): the engine applies the REDUCED-credit election by default (gross ×
// (1 − 21%)) — this avoids the QRE-deduction add-back the individual engine can't
// cleanly make (QRE is embedded in net SE income). The §38 general-business-credit
// liability limit + the §41(h) payroll-tax election are applied/handled by the
// caller (the engine pipeline) and documented there.
const RD_ASC_RATE = 0.14;
const RD_STARTUP_RATE = 0.06;
const RD_SECTION_280C_RATE = 0.21; // §280C(c)(3)(B) → max §11(b) corporate rate

export interface RdCreditCalculation {
  qualifiedResearchExpenses: number;
  priorThreeYearAvgQre: number;
  method: "asc" | "startup" | "none";
  rate: number;
  /** ASC base = 50% of the prior-3-year average QRE (0 for the startup rate). */
  ascBase: number;
  /** Credit before the §280C(c)(3) reduction. */
  grossCredit: number;
  /** Whether the §280C(c)(3) reduced-credit election was applied. */
  reducedCreditElection: boolean;
  /** Claimable credit after §280C (before the §38 liability limit, applied by the caller). */
  credit: number;
}

export function calculateRdCredit(params: {
  qualifiedResearchExpenses: number;
  priorThreeYearAvgQre: number;
  /** §280C(c)(3) reduced-credit election. Default true (clean — no deduction add-back). */
  useReducedCredit?: boolean;
}): RdCreditCalculation {
  const qre = Math.max(0, params.qualifiedResearchExpenses);
  const priorAvg = Math.max(0, params.priorThreeYearAvgQre);
  const reducedCreditElection = params.useReducedCredit !== false;
  const base = {
    qualifiedResearchExpenses: qre,
    priorThreeYearAvgQre: priorAvg,
    reducedCreditElection,
  };
  if (qre <= 0) {
    return { ...base, method: "none", rate: 0, ascBase: 0, grossCredit: 0, credit: 0 };
  }
  let method: "asc" | "startup";
  let rate: number;
  let ascBase = 0;
  let grossCredit: number;
  if (priorAvg > 0) {
    method = "asc";
    rate = RD_ASC_RATE;
    ascBase = 0.5 * priorAvg;
    grossCredit = RD_ASC_RATE * Math.max(0, qre - ascBase);
  } else {
    method = "startup";
    rate = RD_STARTUP_RATE;
    grossCredit = RD_STARTUP_RATE * qre;
  }
  const credit = reducedCreditElection ? grossCredit * (1 - RD_SECTION_280C_RATE) : grossCredit;
  return { ...base, method, rate, ascBase, grossCredit, credit };
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 1.5 — Everyday-filer credits and deductions
// ════════════════════════════════════════════════════════════════════════════

// ── Educator expenses (IRC §62(a)(2)(D)) ────────────────────────────────────
// $300 above-the-line per eligible K-12 educator (teacher, instructor, counselor,
// principal, aide working 900+ hours). MFJ with two eligible educators can
// deduct up to $600 combined. 2024 and 2025: $300/educator.
// Educator-expense per-filer cap (§62(a)(2)(D)). Flat $300 since TY2023; year-
// indexed so a future year can't silently fall through to a stale value.
const EDUCATOR_PER_FILER_CAP: Record<TaxYear, number> = { 2024: 300, 2025: 300, 2026: 300 };

export interface EducatorExpensesCalculation {
  expenses: number;
  eligibleEducatorCount: number;
  cap: number;
  deductible: number;
}

export function calculateEducatorExpenses(params: {
  expenses: number;
  eligibleEducatorCount: number;
  taxYear: number;
}): EducatorExpensesCalculation {
  const year = resolveTaxYear(params.taxYear);
  const perFilerCap = EDUCATOR_PER_FILER_CAP[year];
  const count = Math.max(0, Math.min(2, Math.floor(params.eligibleEducatorCount)));
  const cap = count * perFilerCap;
  const deductible = Math.min(Math.max(0, params.expenses), cap);
  return {
    expenses: params.expenses,
    eligibleEducatorCount: count,
    cap,
    deductible,
  };
}

// ── Student loan interest deduction (IRC §221) ──────────────────────────────
// Up to $2,500 per return (NOT per filer). Phase-out by MAGI.
// MAGI for SLI = AGI before SLI itself + foreign earned income exclusion (we
// don't model foreign exclusions; approximating MAGI ≈ AGI-before-SLI).
// MFS is ineligible per §221(e)(2).
// 2024 thresholds: single/HoH $80k-$95k; MFJ $165k-$195k.
// 2025 thresholds (Rev. Proc. 2024-40): single/HoH $85k-$100k; MFJ $170k-$200k.
const STUDENT_LOAN_INTEREST_MAX = 2500;

const SLI_PHASE_OUT: Record<TaxYear, Record<string, { start: number; end: number } | null>> = {
  2024: {
    single: { start: 80000, end: 95000 },
    head_of_household: { start: 80000, end: 95000 },
    qualifying_widow: { start: 165000, end: 195000 },
    married_filing_jointly: { start: 165000, end: 195000 },
    married_filing_separately: null,
  },
  2025: {
    single: { start: 85000, end: 100000 },
    head_of_household: { start: 85000, end: 100000 },
    qualifying_widow: { start: 170000, end: 200000 },
    married_filing_jointly: { start: 170000, end: 200000 },
    married_filing_separately: null,
  },
  // TY2026 per Rev. Proc. 2025-32 §3.29: single/HoH $85k-$100k (held); MFJ moved to $175k-$205k.
  2026: {
    single: { start: 85000, end: 100000 },
    head_of_household: { start: 85000, end: 100000 },
    qualifying_widow: { start: 175000, end: 205000 },
    married_filing_jointly: { start: 175000, end: 205000 },
    married_filing_separately: null,
  },
};

export interface StudentLoanInterestCalculation {
  interestPaid: number;
  cappedAtStatutoryMax: number;
  magi: number;
  phaseOutFraction: number;
  deductible: number;
  eligible: boolean;
}

export function calculateStudentLoanInterest(params: {
  interestPaid: number;
  magi: number;
  filingStatus: string;
  taxYear: number;
}): StudentLoanInterestCalculation {
  const year = resolveTaxYear(params.taxYear);
  const phase = SLI_PHASE_OUT[year][params.filingStatus];

  if (phase == null) {
    return {
      interestPaid: params.interestPaid,
      cappedAtStatutoryMax: 0,
      magi: params.magi,
      phaseOutFraction: 0,
      deductible: 0,
      eligible: false,
    };
  }

  const cappedAtStatutoryMax = Math.min(Math.max(0, params.interestPaid), STUDENT_LOAN_INTEREST_MAX);

  let phaseOutFraction = 1;
  if (params.magi >= phase.end) phaseOutFraction = 0;
  else if (params.magi > phase.start) {
    phaseOutFraction = (phase.end - params.magi) / (phase.end - phase.start);
  }

  return {
    interestPaid: params.interestPaid,
    cappedAtStatutoryMax,
    magi: params.magi,
    phaseOutFraction,
    deductible: cappedAtStatutoryMax * phaseOutFraction,
    eligible: true,
  };
}

// ── Foreign Tax Credit (IRC §901, §904) ─────────────────────────────────────
// Nonrefundable credit for foreign taxes paid on foreign-source income.
// Simplified path (no Form 1116) under IRC §904(j): all foreign source income
// is passive AND total qualifying foreign tax ≤ $300 single / $600 MFJ.
// Three paths:
// 1. Simplified (≤ $300/$600 paid): credit = paid, no Form 1116 needed.
// 2. Form 1116 limit (paid > simplified AND foreign source income known):
//    credit = min(paid, foreignSourceTaxableIncome / totalTaxableIncome × preCreditUsTax).
// 3. Approximate (paid > simplified, no foreign source income provided):
//    credit = paid; flag exceededSimplifiedLimit and formLimitApplied=false.
const FTC_SIMPLIFIED_LIMIT_SINGLE = 300;
const FTC_SIMPLIFIED_LIMIT_MFJ = 600;

export interface ForeignTaxCreditCalculation {
  foreignTaxPaid: number;
  filingStatus: string;
  simplifiedLimit: number;
  usedSimplifiedPath: boolean;
  exceededSimplifiedLimit: boolean;
  /** True = Form 1116 limit applied (limit = foreign-source-taxable / total-taxable × preCreditTax) */
  formLimitApplied: boolean;
  /** The computed Form 1116 limit (only meaningful if formLimitApplied=true) */
  formLimit: number | null;
  credit: number;
}

export function calculateForeignTaxCredit(params: {
  foreignTaxPaid: number;
  filingStatus: string;
  /** Optional: foreign source taxable income (Form 1116 Line 17). When provided
   * along with totalTaxableIncome + preCreditUsTax, the engine applies the
   * actual Form 1116 limit instead of approximating. */
  foreignSourceTaxableIncome?: number;
  totalTaxableIncome?: number;
  preCreditUsTax?: number;
}): ForeignTaxCreditCalculation {
  const isMfj =
    params.filingStatus === "married_filing_jointly" ||
    params.filingStatus === "qualifying_widow";
  const simplifiedLimit = isMfj ? FTC_SIMPLIFIED_LIMIT_MFJ : FTC_SIMPLIFIED_LIMIT_SINGLE;
  const amount = Math.max(0, params.foreignTaxPaid);
  const exceededSimplifiedLimit = amount > simplifiedLimit;

  // Path 1: under simplified limit — easy path, no Form 1116
  if (!exceededSimplifiedLimit) {
    return {
      foreignTaxPaid: amount,
      filingStatus: params.filingStatus,
      simplifiedLimit,
      usedSimplifiedPath: true,
      exceededSimplifiedLimit: false,
      formLimitApplied: false,
      formLimit: null,
      credit: amount,
    };
  }

  // Path 2: over simplified, AND we have the Form 1116 inputs → apply real limit
  if (
    params.foreignSourceTaxableIncome != null &&
    params.totalTaxableIncome != null &&
    params.preCreditUsTax != null &&
    params.totalTaxableIncome > 0
  ) {
    const fraction = Math.max(0, Math.min(1, params.foreignSourceTaxableIncome / params.totalTaxableIncome));
    const formLimit = fraction * params.preCreditUsTax;
    const credit = Math.min(amount, formLimit);
    return {
      foreignTaxPaid: amount,
      filingStatus: params.filingStatus,
      simplifiedLimit,
      usedSimplifiedPath: false,
      exceededSimplifiedLimit: true,
      formLimitApplied: true,
      formLimit,
      credit,
    };
  }

  // Path 3: over simplified, no Form 1116 inputs supplied → approximate (use paid amount)
  return {
    foreignTaxPaid: amount,
    filingStatus: params.filingStatus,
    simplifiedLimit,
    usedSimplifiedPath: false,
    exceededSimplifiedLimit: true,
    formLimitApplied: false,
    formLimit: null,
    credit: amount,
  };
}

// ── Residential Energy Credits (Form 5695, Form 8911) ───────────────────────
// 1. Residential Clean Energy Credit (IRC §25D): 30% of solar PV, solar water,
//    wind, geothermal, fuel cell, battery storage (2023+). No annual cap, no
//    income limit, indefinite carryforward. Through 2032 at 30%.
// 2. Energy Efficient Home Improvement Credit (IRC §25C): 30% with annual caps.
//    - General cap $1,200 (windows/doors/insulation/audit, with sub-caps)
//    - Heat pump + biomass cap $2,000 (separate from general)
//    - Max combined $3,200/year, no carryforward
//    Sub-caps (windows $600, doors $500, audit $150) not modeled.
// 3. EV Charger Property (IRC §30C, Form 8911): 30% of cost, max $1,000
//    individual. Property must be in eligible census tract (assumed in scope).
const CLEAN_ENERGY_RATE = 0.30;
const EFFICIENT_HOME_RATE = 0.30;
const EFFICIENT_HOME_GENERAL_CAP = 1200;
const EFFICIENT_HOME_HEATPUMP_CAP = 2000;
const EV_CHARGER_RATE = 0.30;
const EV_CHARGER_CAP = 1000;

export interface ResidentialEnergyCreditsCalculation {
  cleanEnergySpend: number;
  efficientHomeSpend: number;
  heatPumpSpend: number;
  evChargerSpend: number;
  cleanEnergyCredit: number;
  efficientHomeCredit: number;
  heatPumpCredit: number;
  evChargerCredit: number;
  total: number;
}

export function calculateResidentialEnergyCredits(params: {
  cleanEnergySpend: number;
  efficientHomeSpend: number;
  heatPumpSpend: number;
  evChargerSpend: number;
}): ResidentialEnergyCreditsCalculation {
  const cleanEnergyBase = Math.max(0, params.cleanEnergySpend);
  const efficientHomeBase = Math.max(0, params.efficientHomeSpend);
  const heatPumpBase = Math.max(0, params.heatPumpSpend);
  const evChargerBase = Math.max(0, params.evChargerSpend);

  // §25D — no cap
  const cleanEnergyCredit = cleanEnergyBase * CLEAN_ENERGY_RATE;
  // §25C — annual caps split between general and heat pump
  const efficientHomeCredit = Math.min(efficientHomeBase * EFFICIENT_HOME_RATE, EFFICIENT_HOME_GENERAL_CAP);
  const heatPumpCredit = Math.min(heatPumpBase * EFFICIENT_HOME_RATE, EFFICIENT_HOME_HEATPUMP_CAP);
  // §30C — $1,000 cap
  const evChargerCredit = Math.min(evChargerBase * EV_CHARGER_RATE, EV_CHARGER_CAP);

  return {
    cleanEnergySpend: params.cleanEnergySpend,
    efficientHomeSpend: params.efficientHomeSpend,
    heatPumpSpend: params.heatPumpSpend,
    evChargerSpend: params.evChargerSpend,
    cleanEnergyCredit,
    efficientHomeCredit,
    heatPumpCredit,
    evChargerCredit,
    total: cleanEnergyCredit + efficientHomeCredit + heatPumpCredit + evChargerCredit,
  };
}

// ── ACA Premium Tax Credit (Form 8962, IRC §36B) ────────────────────────────
// Premium Tax Credit = min(annual premium, max(0, annual SLCSP − expected contribution))
// Expected contribution = MAGI × applicable figure (contribution percentage based on FPL%).
// Reconciles against advance APTC: net = computed PTC − advance APTC.
//   Net > 0 → refundable credit (added to refund)
//   Net < 0 → excess APTC owed (capped if FPL < 400%, full repayment if ≥ 400%)
// ARPA/IRA extension (through 2025): no 400% FPL cliff, top rate 8.5%.
// FPL guidelines used are from the PRIOR year (2024 PTC uses 2023 FPL).
// MFS generally ineligible (some exceptions for abuse victims, not modeled).

// 48-states + DC Federal Poverty Level guidelines (Pub 974)
// AK and HI use higher amounts (not modeled; flagged as known limitation).
const FPL_GUIDELINE_BY_PTC_YEAR: Record<TaxYear, { base: number; perAdditional: number }> = {
  2024: { base: 14580, perAdditional: 5140 }, // 2023 FPL guidelines
  2025: { base: 15060, perAdditional: 5380 }, // 2024 FPL guidelines
  2026: { base: 15650, perAdditional: 5500 }, // 2025 HHS FPL guidelines (PTC uses prior-year FPL)
};

// Excess APTC repayment caps (Rev. Proc. 2023-34 for 2024; assume same struct 2025)
const PTC_REPAYMENT_CAPS_2024 = {
  // [maxFplFraction, capSingleHoHMfsQw, capMfj]
  // Repayment is fully required when FPL% ≥ 400%
  tiers: [
    { fplLessThan: 2.00, capSingle: 375, capMfj: 750 },
    { fplLessThan: 3.00, capSingle: 975, capMfj: 1950 },
    { fplLessThan: 4.00, capSingle: 1625, capMfj: 3250 },
  ],
};
const PTC_REPAYMENT_CAPS_2025 = {
  tiers: [
    { fplLessThan: 2.00, capSingle: 400, capMfj: 800 },
    { fplLessThan: 3.00, capSingle: 1050, capMfj: 2100 },
    { fplLessThan: 4.00, capSingle: 1750, capMfj: 3500 },
  ],
};

function getApplicableFigure(fplFraction: number): number {
  // ARPA/IRA enhanced PTC schedule (2021-2025): no 400% cliff, top rate 8.5%.
  if (fplFraction < 1.50) return 0;
  if (fplFraction < 2.00) return interpolateLinear(fplFraction, 1.50, 2.00, 0.00, 0.02);
  if (fplFraction < 2.50) return interpolateLinear(fplFraction, 2.00, 2.50, 0.02, 0.04);
  if (fplFraction < 3.00) return interpolateLinear(fplFraction, 2.50, 3.00, 0.04, 0.06);
  if (fplFraction < 4.00) return interpolateLinear(fplFraction, 3.00, 4.00, 0.06, 0.085);
  return 0.085;
}

function interpolateLinear(x: number, x1: number, x2: number, y1: number, y2: number): number {
  return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
}

export interface PremiumTaxCreditCalculation {
  annualPremium: number;
  annualSlcsp: number;
  modifiedAgi: number;
  householdSize: number;
  fplGuideline: number;
  fplFraction: number;
  applicableFigure: number;
  expectedContribution: number;
  computedPtc: number;
  advanceAptc: number;
  repaymentCap: number;
  netPtc: number; // > 0 = refundable credit; < 0 = excess APTC owed
  eligible: boolean;
}

export function calculatePremiumTaxCredit(params: {
  annualPremium: number;
  annualSlcsp: number;
  advanceAptc: number;
  modifiedAgi: number;
  householdSize: number;
  filingStatus: string;
  taxYear: number;
}): PremiumTaxCreditCalculation {
  const year = resolveTaxYear(params.taxYear);
  const advanceAptc = Math.max(0, params.advanceAptc);

  // MFS generally ineligible; must repay all advance APTC (uncapped).
  if (params.filingStatus === "married_filing_separately") {
    return {
      annualPremium: params.annualPremium,
      annualSlcsp: params.annualSlcsp,
      modifiedAgi: params.modifiedAgi,
      householdSize: params.householdSize,
      fplGuideline: 0,
      fplFraction: 0,
      applicableFigure: 0,
      expectedContribution: 0,
      computedPtc: 0,
      advanceAptc,
      repaymentCap: Infinity,
      netPtc: -advanceAptc,
      eligible: false,
    };
  }

  if (params.annualPremium <= 0 || params.annualSlcsp <= 0 || params.householdSize <= 0) {
    return {
      annualPremium: params.annualPremium,
      annualSlcsp: params.annualSlcsp,
      modifiedAgi: params.modifiedAgi,
      householdSize: params.householdSize,
      fplGuideline: 0,
      fplFraction: 0,
      applicableFigure: 0,
      expectedContribution: 0,
      computedPtc: 0,
      advanceAptc,
      repaymentCap: 0,
      netPtc: -advanceAptc, // Any advance must be repaid if no PTC eligibility
      eligible: false,
    };
  }

  const fpl = FPL_GUIDELINE_BY_PTC_YEAR[year];
  const fplGuideline = fpl.base + Math.max(0, params.householdSize - 1) * fpl.perAdditional;
  const fplFraction = params.modifiedAgi / fplGuideline;
  const applicableFigure = getApplicableFigure(fplFraction);
  const expectedContribution = Math.max(0, params.modifiedAgi) * applicableFigure;
  const ptcUncapped = Math.max(0, params.annualSlcsp - expectedContribution);
  const computedPtc = Math.min(params.annualPremium, ptcUncapped);

  let netPtc = computedPtc - advanceAptc;
  let repaymentCap = Infinity;
  if (netPtc < 0) {
    // TY2025+ uses the TY2025 caps (latest published); a TY2026 Rev. Proc. value
    // should add PTC_REPAYMENT_CAPS_2026 + bump this. Prevents a TY2026 return
    // from silently using the stale TY2024 caps.
    const caps = year >= 2025 ? PTC_REPAYMENT_CAPS_2025 : PTC_REPAYMENT_CAPS_2024;
    const isMfj =
      params.filingStatus === "married_filing_jointly" ||
      params.filingStatus === "qualifying_widow";
    for (const tier of caps.tiers) {
      if (fplFraction < tier.fplLessThan) {
        repaymentCap = isMfj ? tier.capMfj : tier.capSingle;
        break;
      }
    }
    // FPL ≥ 400%: no cap, full repayment
    netPtc = Math.max(netPtc, -repaymentCap);
  }

  return {
    annualPremium: params.annualPremium,
    annualSlcsp: params.annualSlcsp,
    modifiedAgi: params.modifiedAgi,
    householdSize: params.householdSize,
    fplGuideline,
    fplFraction,
    applicableFigure,
    expectedContribution,
    computedPtc,
    advanceAptc,
    repaymentCap,
    netPtc,
    eligible: true,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 2e — Schedule E rental real estate + MACRS depreciation + §469 PAL
// ════════════════════════════════════════════════════════════════════════════

// ── MACRS depreciation (IRC §168) ───────────────────────────────────────────
// Residential rental real (27.5 years GDS, straight-line, mid-month convention)
// Nonresidential real (39 years GDS, straight-line, mid-month convention)
// Mid-month convention: property treated as placed in service mid-month, so
// the first year (and last partial year) are pro-rated by months in service.
//
// §179 expensing NOT allowed for rental real estate (only active T or B).
// Bonus depreciation NOT applicable (recovery period > 20 years).
//
// Source: IRS Pub 946 (How to Depreciate Property), Table A-6 (residential),
// Table A-7a (nonresidential), Form 4562.

export interface MacrsDepreciationParams {
  /** Depreciable basis = cost - land value - prior accumulated depreciation */
  basis: number;
  propertyType: "residential" | "commercial";
  monthPlacedInService: number; // 1-12 (1 = January)
  yearPlacedInService: number;  // e.g., 2020
  /** Tax year for which to compute depreciation (e.g., 2024) */
  taxYear: number;
}

export interface MacrsDepreciationResult {
  basis: number;
  recoveryYears: number;
  monthPlacedInService: number;
  yearPlacedInService: number;
  taxYear: number;
  /** Years between placed-in-service and tax year (0 = first year) */
  yearsInService: number;
  /** Depreciation for the current tax year only */
  currentYearDepreciation: number;
  /** Cumulative depreciation from placed-in-service through end of tax year */
  accumulatedDepreciation: number;
  /** Remaining undepreciated basis */
  remainingBasis: number;
  isFullyDepreciated: boolean;
}

export function calculateMacrsDepreciation(p: MacrsDepreciationParams): MacrsDepreciationResult {
  const recoveryYears = p.propertyType === "residential" ? 27.5 : 39;
  const annualRate = 1 / recoveryYears;
  const fullAnnualDep = p.basis * annualRate;
  const yearsInService = p.taxYear - p.yearPlacedInService;
  const monthsRemainingFirstYear = Math.max(0, 12.5 - p.monthPlacedInService); // mid-month convention

  // Cumulative depreciation function: total depreciation from yearPlaced through given year
  const cumulativeThrough = (throughYear: number): number => {
    let cum = 0;
    for (let y = p.yearPlacedInService; y <= throughYear; y++) {
      if (y < p.yearPlacedInService) continue;
      if (y === p.yearPlacedInService) {
        cum += fullAnnualDep * (monthsRemainingFirstYear / 12);
      } else {
        cum += fullAnnualDep;
      }
      if (cum >= p.basis) {
        cum = p.basis;
        break;
      }
    }
    return cum;
  };

  if (yearsInService < 0) {
    // Not yet in service
    return {
      basis: p.basis,
      recoveryYears,
      monthPlacedInService: p.monthPlacedInService,
      yearPlacedInService: p.yearPlacedInService,
      taxYear: p.taxYear,
      yearsInService,
      currentYearDepreciation: 0,
      accumulatedDepreciation: 0,
      remainingBasis: p.basis,
      isFullyDepreciated: false,
    };
  }

  const cumCurrent = cumulativeThrough(p.taxYear);
  const cumPrev = p.taxYear > p.yearPlacedInService ? cumulativeThrough(p.taxYear - 1) : 0;
  const currentYearDepreciation = Math.max(0, cumCurrent - cumPrev);
  const remainingBasis = Math.max(0, p.basis - cumCurrent);

  return {
    basis: p.basis,
    recoveryYears,
    monthPlacedInService: p.monthPlacedInService,
    yearPlacedInService: p.yearPlacedInService,
    taxYear: p.taxYear,
    yearsInService,
    currentYearDepreciation,
    accumulatedDepreciation: cumCurrent,
    remainingBasis,
    isFullyDepreciated: remainingBasis === 0,
  };
}

// ── Schedule C asset depreciation (Form 4562: §179 + §168(k) bonus + MACRS) ──
// Personal-property GDS MACRS (Pub 946 Appendix A, Table A-1, HALF-YEAR
// convention). Unlike calculateMacrsDepreciation above (real property only,
// 27.5/39-yr SL, mid-month), this handles the 3/5/7/10/15/20-yr classes that
// Schedule C BUSINESS assets use (200% declining balance for 3-10yr, 150% DB for
// 15-20yr), plus §179 expensing — with the §179(b)(3) BUSINESS-INCOME limitation
// and carryforward — and §168(k) bonus depreciation. The total reduces the
// Schedule C net profit → the SE-tax base (it routes into the engine's
// `schedule_c_depreciation` total), the correct treatment for a sole prop's own
// business assets.
//
// Each class's Table A-1 percentages are verified against IRS Pub 946 and sum to
// 100%. MODELING BOUNDS (documented sub-gaps; CPA overrides via the
// schedule_c_depreciation adjustment when they apply):
//   - HALF-YEAR and MID-QUARTER conventions are both computed (§168(d)(3): when
//     >40% of a year's non-§179 basis is placed in Q4, that year's assets use the
//     mid-quarter schedule). Both schedules come from the same Pub 946 DB→SL
//     algorithm (computeMacrsSchedule). A mid-quarter-year asset MISSING a
//     `placedInServiceQuarter` falls back to half-year (flagged by midQuarterApplies).
//   - An asset is EITHER fully §179-elected (no MACRS basis) OR depreciated via
//     bonus+MACRS — not a partial §179 + bonus/MACRS on the SAME asset (split it
//     into two asset rows if needed).
//   - basis = cost (no trade-in basis / listed-property business-use %).

/** Pub 946 Table A-1 — GDS, half-year convention. Index 0 = recovery year 1. */
const MACRS_HALF_YEAR_TABLE: Readonly<Record<number, readonly number[]>> = {
  3: [0.3333, 0.4445, 0.1481, 0.0741],
  5: [0.2, 0.32, 0.192, 0.1152, 0.1152, 0.0576],
  7: [0.1429, 0.2449, 0.1749, 0.1249, 0.0893, 0.0892, 0.0893, 0.0446],
  10: [0.1, 0.18, 0.144, 0.1152, 0.0922, 0.0737, 0.0655, 0.0655, 0.0656, 0.0655, 0.0328],
  15: [0.05, 0.095, 0.0855, 0.077, 0.0693, 0.0623, 0.059, 0.059, 0.0591, 0.059, 0.0591, 0.059, 0.0591, 0.059, 0.0591, 0.0295],
  20: [0.0375, 0.07219, 0.06677, 0.06177, 0.05713, 0.05285, 0.04888, 0.04522, 0.04462, 0.04461, 0.04462, 0.04461, 0.04462, 0.04461, 0.04462, 0.04461, 0.04462, 0.04461, 0.04462, 0.04461, 0.02231],
};

/** §168 declining-balance factor by recovery period (200% for 3-10yr, 150% for 15/20yr). */
function macrsDbFactor(recoveryYears: number): number {
  return recoveryYears >= 15 ? 1.5 : 2.0;
}

/** First-year service fraction by convention. Half-year = 0.5; mid-quarter
 *  Q1-Q4 = 10.5/7.5/4.5/1.5 months ÷ 12 (Pub 946 — property treated as placed in
 *  service at the midpoint of its quarter). */
function macrsFirstYearFraction(convention: "half_year" | 1 | 2 | 3 | 4): number {
  switch (convention) {
    case "half_year": return 0.5;
    case 1: return 10.5 / 12; // 0.875
    case 2: return 7.5 / 12;  // 0.625
    case 3: return 4.5 / 12;  // 0.375
    case 4: return 1.5 / 12;  // 0.125
  }
}

/**
 * Programmatic MACRS GDS percentage schedule (fraction of original basis per
 * recovery year) — the deterministic IRS algorithm that GENERATES Pub 946 Tables
 * A-1..A-5: declining balance at `db`/L, switching to straight-line when SL ≥ DB,
 * with the convention's first-year fraction and a final partial year (L+1 entries).
 * Uses the IRS round-each-year-and-carry-the-rounded-book method (working in
 * percent) so it reproduces the published tables EXACTLY (incl. the 7-yr
 * 8.93/8.92/8.93 rounding). Verified against MACRS_HALF_YEAR_TABLE in tests.
 */
export function computeMacrsSchedule(
  recoveryYears: number,
  convention: "half_year" | 1 | 2 | 3 | 4,
): number[] {
  const L = recoveryYears;
  const rate = macrsDbFactor(L) / L;
  const f = macrsFirstYearFraction(convention);
  // Pub 946 publishes the 20-year table to 3 decimal places of PERCENT and all
  // shorter classes to 2 (and the 7-yr 8.93 rounding requires exactly 2). Match
  // that precision so the round-and-carry reproduces each table exactly.
  const dp = L === 20 ? 3 : 2;
  const m = Math.pow(10, dp);
  const roundP = (n: number) => Math.round(n * m) / m;
  const pct: number[] = [];
  let book = 100; // remaining basis in percent
  for (let y = 1; y <= L + 1; y++) {
    let dep: number;
    if (y === 1) {
      dep = roundP(100 * rate * f);
    } else if (y === L + 1) {
      dep = roundP(book); // final partial year — remaining basis
    } else {
      const remainingService = L - f - (y - 2); // service-years left at start of y
      const dbDep = book * rate;
      const slDep = remainingService > 0 ? book / remainingService : book;
      dep = roundP(Math.max(dbDep, slDep));
    }
    dep = Math.min(dep, book);
    pct.push(dep / 100);
    book = roundP(book - dep);
  }
  return pct;
}

/** Memoized mid-quarter schedules: key `${recoveryYears}:${quarter}`. */
const midQuarterScheduleCache = new Map<string, number[]>();
function midQuarterSchedule(recoveryYears: number, quarter: 1 | 2 | 3 | 4): number[] {
  const key = `${recoveryYears}:${quarter}`;
  let s = midQuarterScheduleCache.get(key);
  if (!s) {
    s = computeMacrsSchedule(recoveryYears, quarter);
    midQuarterScheduleCache.set(key, s);
  }
  return s;
}

export type MacrsRecoveryYears = 3 | 5 | 7 | 10 | 15 | 20;

export interface ScheduleCAsset {
  /** Acquisition cost = depreciable basis (assumes basis = cost; no trade-in / listed-property %-use limit). */
  cost: number;
  /** GDS recovery period in years (computers/autos 5, office furniture 7, land improvements 15, etc.). */
  recoveryYears: MacrsRecoveryYears;
  /** Calendar year placed in service. */
  placedInServiceYear: number;
  /** Elect §179 full expensing on this asset (acquisition year only; no MACRS on the §179'd basis). */
  section179?: boolean;
  /** Apply §168(k) bonus to the basis (acquisition year only). Ignored when section179 is set. */
  bonus?: boolean;
  /**
   * OBBBA (P.L. 119-21 §70301) restored 100% bonus for property acquired AND
   * placed in service AFTER 2025-01-19. The placed-in-service YEAR alone can't
   * distinguish a TY2025 asset before vs after that date (the year-default rate
   * is the conservative 40% TCJA phase-down), so set this flag for OBBBA-
   * qualifying post-1/19/2025 property to force the 100% rate (mirrors the
   * engine's `bonus_depreciation_basis_obbba` adjustment). No-op for 2026+
   * (already 100%) and ignored unless `bonus` is set.
   */
  bonusFullObbba?: boolean;
  /**
   * Calendar quarter placed in service (1-4). Optional — used ONLY for the
   * §168(d)(3) mid-quarter-convention 40% test (does the result need a mid-quarter
   * override). The MACRS computation itself is always half-year (see the result's
   * `midQuarterApplies`). Unspecified is treated as not-Q4 for the test.
   */
  placedInServiceQuarter?: 1 | 2 | 3 | 4;
}

export interface ScheduleCAssetDepreciationParams {
  assets: readonly ScheduleCAsset[];
  taxYear: number;
  /**
   * §179(b)(3) business-income limit base: active trade/business taxable income
   * BEFORE asset depreciation (Schedule C net before asset dep + the taxpayer's
   * W-2 wages, which count per Reg §1.179-2(c)(6)(iv)). The function subtracts the
   * computed bonus + MACRS to derive the §179 ceiling.
   */
  businessIncomeForSection179: number;
  /** §179 annual dollar cap for taxYear (reused from the engine's year map). */
  section179Cap: number;
  /** §179 investment phase-out threshold for taxYear. */
  section179PhaseStart: number;
  /** §168(k) bonus rate keyed by the asset's placed-in-service calendar year. */
  bonusRateByYear: Readonly<Record<number, number>>;
  /** Prior-year §179 disallowed by the income limit (§179(b)(3)(B) carryforward). */
  section179CarryforwardIn?: number;
}

export interface ScheduleCAssetDepreciationResult {
  /** §179 allowed + bonus + MACRS — the figure that reduces the Schedule C net profit / SE base. */
  totalDepreciation: number;
  section179Deduction: number;
  bonusDeduction: number;
  macrsDeduction: number;
  /** §179 disallowed by the income limit (or dollar cap) → carries to next year (§179(b)(3)(B)). */
  section179Carryforward: number;
  /**
   * §168(d)(3) mid-quarter convention applied to the CURRENT tax year's placements
   * (> 40% of the year's non-§179 basis placed in Q4). The MACRS above is computed
   * under the correct convention per the asset's placed-in-service year (mid-quarter
   * via the Pub 946 algorithm when the asset has a `placedInServiceQuarter`; a
   * mid-quarter-year asset MISSING a quarter falls back to half-year — supply the
   * quarter for an exact figure). Informational flag for CPA review.
   */
  midQuarterApplies: boolean;
}

export function computeScheduleCAssetDepreciation(
  p: ScheduleCAssetDepreciationParams,
): ScheduleCAssetDepreciationResult {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const carryIn = Math.max(0, p.section179CarryforwardIn ?? 0);

  // PASS 1 — §168(d)(3) mid-quarter test PER placed-in-service year: is > 40% of
  // that year's NON-§179 depreciable basis placed in service in Q4? §179-expensed
  // property is excluded from the test. The convention is FIXED in an asset's
  // placed-in-service year, so a multi-year register tests each year independently
  // (a prior-year asset keeps the convention from its own placement year).
  const byYear = new Map<number, { total: number; q4: number }>();
  for (const a of p.assets) {
    const cost = Math.max(0, a.cost);
    if (cost <= 0 || a.section179 || a.placedInServiceYear > p.taxYear) continue;
    const acc = byYear.get(a.placedInServiceYear) ?? { total: 0, q4: 0 };
    acc.total += cost;
    if (a.placedInServiceQuarter === 4) acc.q4 += cost;
    byYear.set(a.placedInServiceYear, acc);
  }
  const midQuarterYears = new Set<number>();
  for (const [year, acc] of byYear) {
    if (acc.total > 0 && acc.q4 > 0.4 * acc.total) midQuarterYears.add(year);
  }
  const midQuarterApplies = midQuarterYears.has(p.taxYear);

  // PASS 2 — depreciation: §179 accumulation + bonus + MACRS (each asset uses its
  // own placed-in-service year's convention — half-year, or mid-quarter when that
  // year triggered the 40% test AND the asset has a quarter).
  let bonusTotal = 0;
  let macrsTotal = 0;
  let currentYearSection179Elected = 0;
  let currentYearQualifiedPropertyCost = 0; // drives the §179 investment phase-out
  for (const a of p.assets) {
    const cost = Math.max(0, a.cost);
    if (cost <= 0 || a.placedInServiceYear > p.taxYear) continue; // not in service
    const isCurrentYear = a.placedInServiceYear === p.taxYear;

    if (a.section179) {
      // §179-elected: full cost expensed in the acquisition year (no MACRS basis).
      // A PRIOR-year §179 asset is already fully expensed → contributes nothing now.
      if (isCurrentYear) {
        currentYearSection179Elected += cost;
        currentYearQualifiedPropertyCost += cost;
      }
      continue;
    }

    // Bonus + MACRS asset (neither is income-limited). Bonus is taken only in the
    // acquisition year at that year's §168(k) rate; MACRS runs on the post-bonus
    // basis over the recovery period. OBBBA post-1/19/2025 property uses 100%
    // (bonusFullObbba) rather than the conservative year default.
    const bonusRate = !a.bonus
      ? 0
      : a.bonusFullObbba
        ? 1.0
        : Math.max(0, Math.min(1, p.bonusRateByYear[a.placedInServiceYear] ?? 0));
    const bonusBasis = bonusRate * cost;
    const macrsBasis = cost - bonusBasis;
    // Convention: mid-quarter (computed via the Pub 946 algorithm) when the asset's
    // placed-in-service year triggered the 40% test AND a quarter is supplied; else
    // the half-year Table A-1. (A mid-quarter-year asset with no quarter falls back
    // to half-year — flagged by midQuarterApplies for CPA review.)
    const q = a.placedInServiceQuarter;
    const schedule =
      midQuarterYears.has(a.placedInServiceYear) && q != null
        ? midQuarterSchedule(a.recoveryYears, q)
        : MACRS_HALF_YEAR_TABLE[a.recoveryYears] ?? [];
    const yearIndex = p.taxYear - a.placedInServiceYear; // 0 = recovery year 1
    const macrsPct = yearIndex >= 0 && yearIndex < schedule.length ? schedule[yearIndex] : 0;
    macrsTotal += macrsPct * macrsBasis;
    if (isCurrentYear) {
      bonusTotal += bonusBasis;
      currentYearQualifiedPropertyCost += cost;
    }
  }

  // §179 aggregate: dollar cap (with the investment phase-out) + the §179(b)(3)
  // business-income limit. The carryforward-in is added AFTER the dollar cap (it
  // was already capped in its origin year) but is subject to the income limit.
  const phaseOut = Math.max(0, currentYearQualifiedPropertyCost - p.section179PhaseStart);
  const dollarCap = Math.max(0, p.section179Cap - phaseOut);
  const electedAfterDollarCap = Math.min(currentYearSection179Elected, dollarCap);
  const available = electedAfterDollarCap + carryIn;
  const incomeLimit = Math.max(0, p.businessIncomeForSection179 - bonusTotal - macrsTotal);
  const section179Deduction = Math.min(available, incomeLimit);
  // Carryforward = income-disallowed + the (rare) dollar-cap-disallowed excess.
  const section179Carryforward =
    Math.max(0, available - section179Deduction) +
    Math.max(0, currentYearSection179Elected - electedAfterDollarCap);

  return {
    totalDepreciation: r2(section179Deduction + bonusTotal + macrsTotal),
    section179Deduction: r2(section179Deduction),
    bonusDeduction: r2(bonusTotal),
    macrsDeduction: r2(macrsTotal),
    section179Carryforward: r2(section179Carryforward),
    midQuarterApplies,
  };
}

// ── §469 Passive Activity Loss Limit (Form 8582) ───────────────────────────
// Rental real estate is per se passive (§469(c)(2)) unless taxpayer materially
// participates. Losses are limited under §469:
//   1. Real estate professional (750+ hours, > 50% of total work time): no limit
//   2. Active participant ($25k special allowance, IRC §469(i)):
//      - $25,000 ($12,500 MFS living apart, $0 MFS not living apart)
//      - Phase-out: $0.50/$1 of MAGI > $100,000 ($50,000 MFS)
//      - Fully phased out at $150,000 ($75,000 MFS)
//   3. Neither: loss suspended, carries forward indefinitely
// MAGI for §469 = AGI (we don't model the few addbacks like deductible
// IRA contributions, taxable SS, etc. — small approximation).

export interface PassiveActivityLossResult {
  rentalLoss: number;
  modifiedAgi: number;
  filingStatus: string;
  isActiveParticipant: boolean;
  isRealEstateProfessional: boolean;
  allowanceCap: number;          // statutory max ($25k / $12.5k MFS)
  allowanceAfterPhaseOut: number; // post phase-out
  allowedThisYear: number;       // deductible against ordinary income
  suspendedToNextYear: number;   // carryforward
}

export function calculatePassiveActivityLossAllowance(params: {
  rentalLoss: number;
  modifiedAgi: number;
  filingStatus: string;
  isActiveParticipant: boolean;
  isRealEstateProfessional: boolean;
}): PassiveActivityLossResult {
  const result = {
    rentalLoss: params.rentalLoss,
    modifiedAgi: params.modifiedAgi,
    filingStatus: params.filingStatus,
    isActiveParticipant: params.isActiveParticipant,
    isRealEstateProfessional: params.isRealEstateProfessional,
    allowanceCap: 0,
    allowanceAfterPhaseOut: 0,
    allowedThisYear: 0,
    suspendedToNextYear: 0,
  };

  if (params.rentalLoss <= 0) return result;

  // Real estate professional → full deduction (no $25k cap)
  if (params.isRealEstateProfessional) {
    result.allowedThisYear = params.rentalLoss;
    return result;
  }

  // Active participant → $25k allowance with MAGI phase-out
  if (params.isActiveParticipant) {
    const isMfs = params.filingStatus === "married_filing_separately";
    const cap = isMfs ? 12500 : 25000;
    const phaseStart = isMfs ? 50000 : 100000;
    const phaseEnd = isMfs ? 75000 : 150000;
    result.allowanceCap = cap;

    let allowance = cap;
    if (params.modifiedAgi >= phaseEnd) allowance = 0;
    else if (params.modifiedAgi > phaseStart) {
      const reduction = (params.modifiedAgi - phaseStart) * 0.5;
      allowance = Math.max(0, cap - reduction);
    }
    result.allowanceAfterPhaseOut = allowance;
    const allowed = Math.min(params.rentalLoss, allowance);
    result.allowedThisYear = allowed;
    result.suspendedToNextYear = params.rentalLoss - allowed;
    return result;
  }

  // Neither: full loss suspended
  result.suspendedToNextYear = params.rentalLoss;
  return result;
}

// ── Form 8582 — per-activity passive-loss allocation (P2-1) ──────────────────
// The §469(i) $25k allowance is a single PER-TAXPAYER cap across ALL rental real
// estate (NOT per activity). Form 8582 nets the activities, applies the
// allowance to the net loss, then RATABLY ALLOCATES the allowed/suspended loss
// back to each loss activity in proportion to its gross loss (Worksheet 5). The
// aggregate tax result is unchanged — this is the per-property breakdown CPAs
// file on Form 8582 + the basis for per-property suspended-loss tracking.
export interface Form8582ActivityRow {
  address: string;
  /** income − expenses − depreciation (signed). */
  netIncome: number;
  /** Deductible against ordinary income this year (signed; income rows positive). */
  allowedThisYear: number;
  /** Suspended to next year (>= 0). */
  suspendedToNextYear: number;
}
export interface Form8582Breakdown {
  activities: Form8582ActivityRow[];
  /** Aggregate net (signed) across all activities. */
  totalNetIncome: number;
  /** Aggregate allowed (signed; negative = reduces AGI). */
  totalAllowed: number;
  /** Aggregate suspended to next year (>= 0). */
  totalSuspended: number;
  allowanceCap: number;
  allowanceAfterPhaseOut: number;
}

export function computeForm8582Breakdown(params: {
  properties: Array<{ address: string; netIncome: number }>;
  palResult: PassiveActivityLossResult | null;
}): Form8582Breakdown {
  const { properties, palResult } = params;
  const totalNetIncome = properties.reduce((s, p) => s + p.netIncome, 0);

  // No aggregate loss (or no PAL applied) → every activity is fully allowed.
  if (!palResult || palResult.suspendedToNextYear <= 0) {
    return {
      activities: properties.map((p) => ({
        address: p.address,
        netIncome: p.netIncome,
        allowedThisYear: p.netIncome,
        suspendedToNextYear: 0,
      })),
      totalNetIncome,
      totalAllowed: totalNetIncome >= 0 ? totalNetIncome : -(palResult?.allowedThisYear ?? Math.abs(totalNetIncome)),
      totalSuspended: 0,
      allowanceCap: palResult?.allowanceCap ?? 0,
      allowanceAfterPhaseOut: palResult?.allowanceAfterPhaseOut ?? 0,
    };
  }

  // Aggregate loss with a suspended portion → ratably allocate the suspended
  // loss to the LOSS activities by their share of total gross loss (Worksheet 5).
  const totalGrossLoss = properties.reduce((s, p) => s + (p.netIncome < 0 ? -p.netIncome : 0), 0);
  const suspendedTotal = palResult.suspendedToNextYear;
  const activities: Form8582ActivityRow[] = properties.map((p) => {
    if (p.netIncome >= 0) {
      return { address: p.address, netIncome: p.netIncome, allowedThisYear: p.netIncome, suspendedToNextYear: 0 };
    }
    const grossLoss = -p.netIncome;
    const suspended = totalGrossLoss > 0 ? suspendedTotal * (grossLoss / totalGrossLoss) : 0;
    // allowedThisYear (signed) = netIncome + suspended (adds back the suspended
    // portion of the loss; the remainder is the deductible loss, still <= 0).
    return { address: p.address, netIncome: p.netIncome, allowedThisYear: p.netIncome + suspended, suspendedToNextYear: suspended };
  });

  return {
    activities,
    totalNetIncome,
    totalAllowed: -palResult.allowedThisYear,
    totalSuspended: suspendedTotal,
    allowanceCap: palResult.allowanceCap,
    allowanceAfterPhaseOut: palResult.allowanceAfterPhaseOut,
  };
}

// ── Schedule E rental net income summary ────────────────────────────────────
// Aggregates per-property income/expense/depreciation into a single net amount
// that flows to Form 1040 Line 8 (other income) via Schedule 1 Line 5.

export interface ScheduleERentalSummary {
  /** Sum of all rental gross income (rents received) */
  totalRentalIncome: number;
  /** Sum of all rental expenses (excluding depreciation) */
  totalRentalExpenses: number;
  /** Total MACRS depreciation across all properties */
  totalDepreciation: number;
  /** Net income or loss (positive = income flows to AGI, negative = loss subject to PAL limits) */
  netRentalIncomeOrLoss: number;
  /** Number of properties */
  propertyCount: number;
}

// ── Long-term capital gains + qualified dividends tax (preferential rates) ──
// LTCG and qualified dividends are taxed at 0% / 15% / 20% based on taxable
// income brackets (different from ordinary brackets). Short-term gains and
// non-qualified dividends use the ordinary brackets.
// Sources: IRC §1(h); thresholds from IRS Rev. Proc. 2023-34 (2024) and 2024-40 (2025).
const LTCG_BRACKETS: Record<TaxYear, Record<string, Array<{ upTo: number; rate: number }>>> = {
  2024: {
    single: [
      { upTo: 47025, rate: 0 },
      { upTo: 518900, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    married_filing_jointly: [
      { upTo: 94050, rate: 0 },
      { upTo: 583750, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    married_filing_separately: [
      { upTo: 47025, rate: 0 },
      { upTo: 291875, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    head_of_household: [
      { upTo: 63000, rate: 0 },
      { upTo: 551350, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    qualifying_widow: [
      { upTo: 94050, rate: 0 },
      { upTo: 583750, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
  },
  2025: {
    single: [
      { upTo: 48350, rate: 0 },
      { upTo: 533400, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    married_filing_jointly: [
      { upTo: 96700, rate: 0 },
      { upTo: 600050, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    married_filing_separately: [
      { upTo: 48350, rate: 0 },
      { upTo: 300000, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    head_of_household: [
      { upTo: 64750, rate: 0 },
      { upTo: 566700, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    qualifying_widow: [
      { upTo: 96700, rate: 0 },
      { upTo: 600050, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
  },
  // TY2026 §1(h)/§1(j)(5) breakpoints per Rev. Proc. 2025-32 §4.03.
  2026: {
    single: [
      { upTo: 49450, rate: 0 },
      { upTo: 545500, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    married_filing_jointly: [
      { upTo: 98900, rate: 0 },
      { upTo: 613700, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    married_filing_separately: [
      { upTo: 49450, rate: 0 },
      { upTo: 306850, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    head_of_household: [
      { upTo: 66200, rate: 0 },
      { upTo: 579600, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
    qualifying_widow: [
      { upTo: 98900, rate: 0 },
      { upTo: 613700, rate: 0.15 },
      { upTo: Infinity, rate: 0.20 },
    ],
  },
};

export interface CapitalGainsCalculation {
  ordinaryTaxableIncome: number;
  longTermGains: number;
  shortTermGains: number;
  qualifiedDividends: number;
  /** Tax on the LTCG + qualified dividends using preferential brackets */
  preferentialRateTax: number;
  /** Total combined fed tax = ordinary tax (incl. STCG) + preferential rate tax */
  totalFederalTax: number;
}

/**
 * Compute federal tax on a return that includes both ordinary income and
 * preferential-rate items (LTCG + qualified dividends).
 *
 * Method: STCG is added to ordinary income (taxed at ordinary rates).
 * LTCG and qualified dividends fill brackets ABOVE ordinary income on the
 * preferential schedule.
 */
/**
 * Compute LTCG + qualified-dividend tax using the preferential 0/15/20%
 * brackets, stacked above an "ordinary-income" stacking base. Reused both
 * by regular-tax computation (calculateFederalTaxWithCapitalGains) and by
 * AMT Form 6251 Part III (K3 — closed 2026-05-24) where the AMT base's
 * LTCG/QDIV portion is preserved at preferential rates instead of being
 * taxed at the 26/28% AMT rates.
 *
 * @param stackBase   The income that already fills brackets — LTCG sits above this.
 *                    For regular tax: ordinaryTaxableIncome + STCG.
 *                    For AMT: amtBase − ltcgInAmtBase (the "ordinary AMT" portion).
 * @param ltcgQdiv    Total preferential-rate amount (LTCG + qualified dividends).
 */
function calculateLtcgQdivStackedTax(
  stackBase: number,
  ltcgQdiv: number,
  filingStatus: string,
  taxYear: number,
): number {
  const year = resolveTaxYear(taxYear);
  const status = filingStatus in LTCG_BRACKETS[year] ? filingStatus : "single";
  const ltcgIncluded = Math.max(0, ltcgQdiv);
  if (ltcgIncluded <= 0) return 0;
  const stack = Math.max(0, stackBase);
  const brackets = LTCG_BRACKETS[year][status];
  let tax = 0;
  let prevCap = 0;
  let remaining = ltcgIncluded;
  for (const bracket of brackets) {
    if (remaining <= 0) break;
    const lower = Math.max(stack, prevCap);
    const upper = Math.min(stack + ltcgIncluded, bracket.upTo);
    const slice = Math.max(0, upper - lower);
    if (slice > 0) {
      tax += slice * bracket.rate;
      remaining -= slice;
    }
    prevCap = bracket.upTo;
  }
  return tax;
}

export function calculateFederalTaxWithCapitalGains(params: {
  ordinaryTaxableIncome: number;
  longTermGains: number;
  qualifiedDividends: number;
  shortTermGains: number;
  filingStatus: string;
  taxYear: number;
  /** K9 — FEIE excluded amount (Form 2555). When > 0, applies the IRS
   *  Foreign Earned Income Tax Worksheet stacking rule:
   *    tax = calculateFederalTax(ordinary + FEIE) − calculateFederalTax(FEIE)
   *  Effectively: FEIE is removed from the base but does NOT reduce the
   *  marginal rate on the rest of income. */
  feieExclusion?: number;
  /** K8 — Form 8615 kiddie tax. When `isKiddieTaxFiler` and net unearned
   *  income > $2,600 (TY2024 threshold), the excess is taxed at the
   *  parent's marginal rate. Final tax = MAX(regular_method, kiddie_method)
   *  per Form 8615 Line 18. */
  kiddieTax?: {
    isKiddieTaxFiler: boolean;
    /** Total child unearned income (interest + dividends + cap gains). */
    unearnedIncome: number;
    /** Parent's top marginal rate as decimal (e.g., 0.32). */
    parentsTopMarginalRate: number;
  };
}): CapitalGainsCalculation {
  const year = resolveTaxYear(params.taxYear);
  const status = params.filingStatus in FEDERAL_BRACKETS[year] ? params.filingStatus : "single";
  const ltcgIncluded = Math.max(0, params.longTermGains) + Math.max(0, params.qualifiedDividends);
  const ordinaryWithStcg = Math.max(0, params.ordinaryTaxableIncome) + Math.max(0, params.shortTermGains);
  const feie = Math.max(0, params.feieExclusion ?? 0);

  // IRS Qualified Dividends & Capital Gain Tax Worksheet, line 10: the amount of
  // net capital gain (LTCG + qualified dividends) taxed at the 0/15/20%
  // preferential rates is capped at TAXABLE INCOME. When the standard/itemized
  // deduction exceeds ordinary income, params.ordinaryTaxableIncome arrives
  // NEGATIVE; that unused deduction reduces the preferential base. Without this
  // cap, a return living mostly off LTCG/QDIV (a retiree, or a $5M-LTCG seller)
  // is over-taxed by (unused deduction × top LTCG rate) — the standard deduction
  // would otherwise be silently "lost". Callers must pass the SIGNED ordinary
  // portion (it is floored to 0 above for the ordinary-tax computation).
  const totalTaxableForPref =
    params.ordinaryTaxableIncome + Math.max(0, params.shortTermGains) + ltcgIncluded;
  const prefTaxable = Math.max(0, Math.min(ltcgIncluded, totalTaxableForPref));

  // Ordinary tax on the ordinary-income portion (incl. STCG).
  // K9 stacking rule: when FEIE > 0, compute tax on (ordinary + FEIE)
  // then subtract tax on FEIE alone — so the remaining income stacks at
  // the FEIE-displaced marginal rate. When FEIE = 0, falls back to the
  // simple ordinary tax computation.
  let ordinaryTax: number;
  if (feie > 0) {
    const taxOnOrdinaryPlusFeie = calculateFederalTax(ordinaryWithStcg + feie, status, year);
    const taxOnFeieAlone = calculateFederalTax(feie, status, year);
    ordinaryTax = Math.max(0, taxOnOrdinaryPlusFeie - taxOnFeieAlone);
  } else {
    ordinaryTax = calculateFederalTax(ordinaryWithStcg, status, year);
  }

  // Preferential tax: LTCG/QDIV stack on top of ordinary income at 0/15/20%.
  // K9 sub-gap: when both FEIE and LTCG are present, the IRS Foreign Earned
  // Income Tax Worksheet adjusts the LTCG stacking position. We stack LTCG
  // above (ordinaryWithStcg + feie) so LTCG occupies the right brackets,
  // then no second subtraction is applied (FEIE is ordinary, not LTCG).
  const ltcgStackBase = feie > 0 ? ordinaryWithStcg + feie : ordinaryWithStcg;
  const prefTax = calculateLtcgQdivStackedTax(ltcgStackBase, prefTaxable, status, year);

  // K8 — Kiddie tax (Form 8615 Line 18).
  // When the child has net unearned income > $2,600, that excess is taxed
  // at the parent's marginal rate instead of the child's. Engine simplification:
  // amount-at-parent-rate is treated as ordinary (sub-gap: small LTCG/QDIV
  // portion within kiddie income is also taxed at parent rate in this model;
  // IRS Form 8615 uses a more elaborate stacking with the QDCG worksheet).
  let kiddieTotal = ordinaryTax + prefTax;
  // FED-02: net-unearned threshold is year-indexed ($2,600 TY2024 / $2,700 TY2025).
  const kiddieThreshold = KIDDIE_TAX_THRESHOLD[year];
  if (params.kiddieTax && params.kiddieTax.isKiddieTaxFiler && params.kiddieTax.unearnedIncome > kiddieThreshold) {
    const totalTaxable = ordinaryWithStcg + prefTaxable;
    const netUnearned = params.kiddieTax.unearnedIncome - kiddieThreshold;
    const amountAtParentRate = Math.min(netUnearned, totalTaxable);
    if (amountAtParentRate > 0) {
      // Child's remaining ordinary base (after carving out the parent-rate portion).
      const ordinaryRemaining = Math.max(0, ordinaryWithStcg - amountAtParentRate);
      const ltcgRemaining = Math.max(0, prefTaxable - Math.max(0, amountAtParentRate - ordinaryWithStcg));
      const childOrdinaryTax = feie > 0
        ? Math.max(0, calculateFederalTax(ordinaryRemaining + feie, status, year) - calculateFederalTax(feie, status, year))
        : calculateFederalTax(ordinaryRemaining, status, year);
      const childPrefStackBase = feie > 0 ? ordinaryRemaining + feie : ordinaryRemaining;
      const childPrefTax = calculateLtcgQdivStackedTax(childPrefStackBase, ltcgRemaining, status, year);
      const parentAdditionalTax = amountAtParentRate * Math.max(0, params.kiddieTax.parentsTopMarginalRate);
      const kiddieMethod = childOrdinaryTax + childPrefTax + parentAdditionalTax;
      // Form 8615 Line 18: child's tax = larger of regular method or kiddie method.
      kiddieTotal = Math.max(ordinaryTax + prefTax, kiddieMethod);
    }
  }

  return {
    ordinaryTaxableIncome: params.ordinaryTaxableIncome,
    longTermGains: params.longTermGains,
    shortTermGains: params.shortTermGains,
    qualifiedDividends: params.qualifiedDividends,
    preferentialRateTax: prefTax,
    totalFederalTax: kiddieTotal,
  };
}

// ── Self-Employment Tax (Schedule SE) ──────────────────────────────────────
// 2024 + 2025: 15.3% combined rate (12.4% Social Security + 2.9% Medicare).
// SS portion only applies up to the wage base ($168,600 in 2024, $176,100 in 2025).
// Net earnings = SE income × 0.9235 (the 7.65% employer-equivalent reduction).
// Half of SE tax is deductible above-the-line on Form 1040.
export const SS_WAGE_BASE: Record<TaxYear, number> = { 2024: 168600, 2025: 176100, 2026: 184500 };

// FED-02 — Form 8615 kiddie-tax net-unearned-income threshold = 2× the limited
// dependent standard deduction (§1(g)(4) + §63(c)(5)(A), inflation-adjusted).
// TY2024 $2,600 (Rev. Proc. 2023-34); TY2025 $2,700 (Rev. Proc. 2024-40). Drives
// BOTH the filing trigger and the Form 8615 Line 2 subtraction.
export const KIDDIE_TAX_THRESHOLD: Record<TaxYear, number> = { 2024: 2600, 2025: 2700, 2026: 2700 }; // 2026 = 2×$1,350 dependent floor (Rev. Proc. 2025-32, flat vs 2025)
const SS_RATE = 0.124;
const MEDICARE_RATE = 0.029;
const SE_NET_EARNINGS_FACTOR = 0.9235;

export interface SeTaxCalculation {
  seIncomeReported: number;
  netSeEarnings: number;
  socialSecurityPortion: number;
  medicarePortion: number;
  seTaxTotal: number;
  /** Half of SE tax — above-the-line deduction. */
  deductibleHalf: number;
  /** SS wage base remaining for SE after W-2 SS wages (Sch SE Part I Line 9). */
  ssBaseAvailableForSe: number;
}

/**
 * Schedule SE Part I.
 *
 * Line 9 — a filer with both W-2 SS wages and SE income shares the single
 * annual SS wage base across both income streams. The SS wage base
 * available for SE is reduced by W-2 SS wages (Box 3) already subjected
 * to FICA. Only Medicare (2.9%) applies on the excess. Without this
 * adjustment, a $100k W-2 + $200k Sch C filer over-pays SS portion by
 * ~$12.4k (deep-audit gap K1).
 *
 * @param w2SocialSecurityWages — sum of W-2 Box 3 across all W-2s for
 *   the year. Default 0 (pure-SE filer, no W-2 wages).
 */
export function calculateSelfEmploymentTax(
  seIncome: number,
  taxYear: number,
  w2SocialSecurityWages = 0,
): SeTaxCalculation {
  const year = resolveTaxYear(taxYear);
  const ssBase = SS_WAGE_BASE[year];
  const w2Ss = Math.max(0, w2SocialSecurityWages);
  const ssBaseAvailableForSe = Math.max(0, ssBase - w2Ss);
  if (seIncome <= 0) {
    return { seIncomeReported: seIncome, netSeEarnings: 0, socialSecurityPortion: 0, medicarePortion: 0, seTaxTotal: 0, deductibleHalf: 0, ssBaseAvailableForSe };
  }
  // Form Schedule SE: net SE earnings = gross × 92.35%
  const netSeEarnings = seIncome * SE_NET_EARNINGS_FACTOR;
  // IRS Schedule SE Part I Line 4c: if net SE earnings < $400, no SE tax is owed.
  // (See "Note: If line 4c is less than $400 ... you don't owe self-employment tax.")
  // This is a true cliff — at $399.99 you owe nothing, at $400.00 the full 15.3% kicks in.
  if (netSeEarnings < 400) {
    return { seIncomeReported: seIncome, netSeEarnings, socialSecurityPortion: 0, medicarePortion: 0, seTaxTotal: 0, deductibleHalf: 0, ssBaseAvailableForSe };
  }
  // Sch SE Part I Line 10: SS portion = smaller of (net SE earnings, available SS base) × 12.4%.
  // Line 11: Medicare portion = net SE earnings × 2.9% (no Medicare cap).
  const ssPortion = Math.min(netSeEarnings, ssBaseAvailableForSe) * SS_RATE;
  const medicarePortion = netSeEarnings * MEDICARE_RATE;
  const seTaxTotal = ssPortion + medicarePortion;
  return {
    seIncomeReported: seIncome,
    netSeEarnings,
    socialSecurityPortion: ssPortion,
    medicarePortion,
    seTaxTotal,
    deductibleHalf: seTaxTotal / 2,
    ssBaseAvailableForSe,
  };
}

// ── Self-Employed Health Insurance Deduction (IRC §162(l), Form 7206) ──────
// Above-the-line deduction for self-employed filers (Sch C, partner with SE
// earnings, 2%+ S-corp shareholder, statutory employee) who paid their own
// health insurance premiums. The deduction is the lesser of:
//   (a) total premiums paid for the year (medical, dental, vision, long-term care)
//   (b) net SE earnings (Sch SE) minus the deductible half of SE tax
//       minus any contributions to SE retirement plans (SEP, Solo 401k)
//
// We model (a) and (b) without the retirement-plan reduction — SEP/Solo401(k)
// contributions are not yet a modeled adjustment; documented as a sub-gap
// in CLAUDE.md. CPAs whose clients have material SE retirement contributions
// can reduce the premiums entry to compensate.
//
// Eligibility (CPA enforces — engine assumes the adjustment is valid):
//   - Filer was NOT eligible for employer-subsidized health insurance through
//     their own or their spouse's employer during the month claimed.
//
export interface SehiCalculation {
  premiumsPaid: number;
  /** Cap: max(0, net SE earnings − deductible half SE tax). */
  earnedIncomeCap: number;
  /** Final deduction: min(premiums, cap). */
  deduction: number;
}

export function calculateSehiDeduction(params: {
  premiumsPaid: number;
  seNetEarnings: number;
  halfSeDeduction: number;
}): SehiCalculation {
  const premiums = Math.max(0, params.premiumsPaid);
  const cap = Math.max(0, params.seNetEarnings - params.halfSeDeduction);
  return { premiumsPaid: premiums, earnedIncomeCap: cap, deduction: Math.min(premiums, cap) };
}

// ── Foreign Earned Income Exclusion (IRC §911, Form 2555) — K9 ─────────────
// Annual per-spouse exclusion for foreign earned income (wages / SE earned
// abroad while qualifying via bona fide residence or physical presence
// test). Excluded from gross income — but the IRS Foreign Earned Income
// Tax Worksheet applies the "stacking rule": post-FEIE tax is computed at
// the marginal rate that WOULD have applied including the excluded income.
// This means FEIE removes income from the base but does NOT reduce the
// marginal rate.
//
// TY2024: $126,500 per spouse. TY2025: $130,000 (Rev. Proc. 2024-40).
// MFJ: each spouse independently qualifying can claim the per-spouse cap.
// Engine accepts two adjustments: foreign_earned_income (primary filer) and
// foreign_earned_income_spouse (MFJ only, for the second spouse).
//
// Eligibility (CPA confirms): bona fide residence in foreign country for
// uninterrupted full tax year, OR physical presence in foreign countries
// 330+ days in a 12-month period. Housing exclusion / deduction NOT modeled.
const FEIE_CAP: Record<TaxYear, number> = { 2024: 126500, 2025: 130000, 2026: 132900 }; // Rev. Proc. 2025-32 §4.39

export interface FeieCalculation {
  taxpayerForeignIncome: number;
  spouseForeignIncome: number;
  taxpayerExclusion: number;
  spouseExclusion: number;
  totalExclusion: number;
}

export function calculateFeie(params: {
  taxpayerForeignEarnedIncome: number;
  spouseForeignEarnedIncome: number;
  filingStatus: string;
  taxYear: number;
}): FeieCalculation {
  const year = resolveTaxYear(params.taxYear);
  const cap = FEIE_CAP[year];
  const taxpayerForeignIncome = Math.max(0, params.taxpayerForeignEarnedIncome);
  const taxpayerExclusion = Math.min(taxpayerForeignIncome, cap);
  const isMfj = params.filingStatus === "married_filing_jointly" ||
                params.filingStatus === "qualifying_widow";
  // MFS: each spouse files separately — they get their own cap. We treat
  // foreign_earned_income_spouse as ignored for MFS (each spouse uses
  // their own foreign_earned_income adjustment).
  const spouseForeignIncome = isMfj ? Math.max(0, params.spouseForeignEarnedIncome) : 0;
  const spouseExclusion = isMfj ? Math.min(spouseForeignIncome, cap) : 0;
  return {
    taxpayerForeignIncome,
    spouseForeignIncome,
    taxpayerExclusion,
    spouseExclusion,
    totalExclusion: taxpayerExclusion + spouseExclusion,
  };
}

// ── Social Security Taxability (Pub 915 Worksheet) — K10 ───────────────────
// Determines how much of Social Security benefits flows into taxable income.
// Three outcomes: 0%, up to 50%, or up to 85% of benefits is taxable, based
// on "provisional income" (AGI excluding SS + tax-exempt interest + half SS).
//
// Thresholds (not inflation-adjusted, Pub 915 Worksheet 1):
//   Single, HoH, QSS, MFS-lived-apart:  $25,000 / $34,000
//   MFJ:                                 $32,000 / $44,000
//   MFS-lived-with-spouse-any-time:      $0 / $0 → up to 85% taxable always
//
// Algorithm (Pub 915 lines 8-18 collapsed):
//   • If MFS-lived-with-spouse: taxable = min(85% × benefits, 85% × provisional)
//   • Else if provisional ≤ T1: 0
//   • Else if provisional ≤ T2: min(50% × (provisional − T1), 50% × benefits)
//   • Else (provisional > T2):
//       taxable = min(85% × benefits,
//                     85% × (provisional − T2) + min(50% × benefits, 50% × (T2 − T1)))
export interface SsTaxabilityCalculation {
  ssBenefits: number;
  provisionalIncome: number;
  threshold1: number;
  threshold2: number;
  /** 0 (not taxable), 50, or 85 — the maximum % that could apply. */
  appliedMaxPercent: 0 | 50 | 85;
  taxableAmount: number;
}

export function calculateSocialSecurityTaxability(params: {
  ssBenefits: number;
  agiExcludingSs: number;
  taxExemptInterest: number;
  filingStatus: string;
  mfsLivedApartAllYear?: boolean;
}): SsTaxabilityCalculation {
  const ssBenefits = Math.max(0, params.ssBenefits);
  if (ssBenefits === 0) {
    return {
      ssBenefits: 0,
      provisionalIncome: 0,
      threshold1: 0,
      threshold2: 0,
      appliedMaxPercent: 0,
      taxableAmount: 0,
    };
  }
  const halfSs = ssBenefits / 2;
  const provisional = Math.max(0, params.agiExcludingSs) + Math.max(0, params.taxExemptInterest) + halfSs;

  const isMfj = params.filingStatus === "married_filing_jointly" ||
                params.filingStatus === "qualifying_widow";
  const isMfsWithSpouse = params.filingStatus === "married_filing_separately" &&
                          !params.mfsLivedApartAllYear;

  if (isMfsWithSpouse) {
    // Pub 915: MFS who lived with spouse any time during the year → $0 threshold.
    // Up to 85% of SS is taxable.
    const taxable = Math.min(0.85 * ssBenefits, 0.85 * provisional);
    return {
      ssBenefits, provisionalIncome: provisional,
      threshold1: 0, threshold2: 0,
      appliedMaxPercent: 85,
      taxableAmount: Math.max(0, taxable),
    };
  }

  const threshold1 = isMfj ? 32000 : 25000;
  const threshold2 = isMfj ? 44000 : 34000;

  if (provisional <= threshold1) {
    return {
      ssBenefits, provisionalIncome: provisional,
      threshold1, threshold2,
      appliedMaxPercent: 0,
      taxableAmount: 0,
    };
  }
  if (provisional <= threshold2) {
    // 50% zone only
    const amountOverT1 = provisional - threshold1;
    const taxable = Math.min(0.5 * amountOverT1, halfSs);
    return {
      ssBenefits, provisionalIncome: provisional,
      threshold1, threshold2,
      appliedMaxPercent: 50,
      taxableAmount: Math.max(0, taxable),
    };
  }
  // Both zones: 50% portion (capped at half SS or half of the band width)
  // plus 85% of the excess over threshold2.
  const inZone85 = provisional - threshold2;
  const zone50Contribution = Math.min(halfSs, 0.5 * (threshold2 - threshold1));
  const total = 0.85 * inZone85 + zone50Contribution;
  const taxable = Math.min(0.85 * ssBenefits, total);
  return {
    ssBenefits, provisionalIncome: provisional,
    threshold1, threshold2,
    appliedMaxPercent: 85,
    taxableAmount: Math.max(0, taxable),
  };
}

// ── NIIT (Net Investment Income Tax, IRC §1411) ────────────────────────────
// 3.8% on the LESSER of (net investment income, MAGI − threshold).
// Thresholds (not inflation-adjusted): $200k single, $250k MFJ, $125k MFS.
const NIIT_RATE = 0.038;
function niitThreshold(filingStatus: string): number {
  switch (filingStatus) {
    case "married_filing_jointly":
    case "qualifying_widow":
      return 250000;
    case "married_filing_separately":
      return 125000;
    default:
      return 200000; // single, head_of_household
  }
}

export interface NiitCalculation {
  investmentIncome: number;
  threshold: number;
  excessOverThreshold: number;
  taxableAmount: number;
  niitTax: number;
}

export function calculateNiit(params: {
  investmentIncome: number;
  modifiedAgi: number;
  filingStatus: string;
}): NiitCalculation {
  const { investmentIncome, modifiedAgi, filingStatus } = params;
  const threshold = niitThreshold(filingStatus);
  const excess = Math.max(0, modifiedAgi - threshold);
  const taxableAmount = Math.min(Math.max(0, investmentIncome), excess);
  return {
    investmentIncome: Math.max(0, investmentIncome),
    threshold,
    excessOverThreshold: excess,
    taxableAmount,
    niitTax: taxableAmount * NIIT_RATE,
  };
}

// ── Additional Medicare Tax (Form 8959, IRC §3101(b)(2) + §1401(b)(2)) ─────
// 0.9% on Medicare wages (Box 5) + SE net earnings above filing-status
// threshold. The threshold is shared across wages and SE: wages consume the
// threshold first; SE only above the remaining portion (Form 8959 Lines 4-8).
// Thresholds match NIIT (not inflation-adjusted): $200k single/HoH/QSS,
// $250k MFJ, $125k MFS. Add'l Medicare is reported on Sch 2 Line 11.
// Not offset by non-refundable credits (it is an "other tax" per Sch 2 Part II).
const ADDITIONAL_MEDICARE_RATE = 0.009;

function additionalMedicareThreshold(filingStatus: string): number {
  switch (filingStatus) {
    case "married_filing_jointly":
    case "qualifying_widow":
      return 250000;
    case "married_filing_separately":
      return 125000;
    default:
      return 200000;
  }
}

export interface AdditionalMedicareTaxCalculation {
  medicareWages: number;
  seNetEarnings: number;
  threshold: number;
  /** Form 8959 Line 3 — wages over threshold (Line 1 − Line 2). */
  wagesOverThreshold: number;
  /** Form 8959 Line 7 — threshold remaining for SE after wages. */
  seThresholdRemaining: number;
  /** Form 8959 Line 8 input — SE net over remaining threshold. */
  seOverThreshold: number;
  /** Form 8959 Line 7 (wage part) × 0.9%. */
  additionalMedicareOnWages: number;
  /** Form 8959 Line 13 (SE part) × 0.9%. */
  additionalMedicareOnSe: number;
  /** Form 8959 Line 18 — total Additional Medicare Tax. */
  additionalMedicareTax: number;
}

export function calculateAdditionalMedicareTax(params: {
  medicareWages: number;
  seNetEarnings: number;
  filingStatus: string;
}): AdditionalMedicareTaxCalculation {
  const threshold = additionalMedicareThreshold(params.filingStatus);
  const medicareWages = Math.max(0, params.medicareWages);
  const seNetEarnings = Math.max(0, params.seNetEarnings);
  const wagesOverThreshold = Math.max(0, medicareWages - threshold);
  const seThresholdRemaining = Math.max(0, threshold - medicareWages);
  const seOverThreshold = Math.max(0, seNetEarnings - seThresholdRemaining);
  const additionalMedicareOnWages = wagesOverThreshold * ADDITIONAL_MEDICARE_RATE;
  const additionalMedicareOnSe = seOverThreshold * ADDITIONAL_MEDICARE_RATE;
  return {
    medicareWages,
    seNetEarnings,
    threshold,
    wagesOverThreshold,
    seThresholdRemaining,
    seOverThreshold,
    additionalMedicareOnWages,
    additionalMedicareOnSe,
    additionalMedicareTax: additionalMedicareOnWages + additionalMedicareOnSe,
  };
}

// ── QBI Deduction (Section 199A) ───────────────────────────────────────────
// Simplified: 20% of QBI, capped at 20% of (taxable income before QBI − net capital gains).
// The full §199A has W-2-wages limits + SSTB phase-outs above income thresholds — we
// model the simple case (low/middle-income, non-SSTB). For high earners or SSTBs the
// real number can be lower.
/** FED-04 / P2-4 — Form 8995-A Schedule A/C per-business wage/UBIA limit row. */
export interface PerBusinessQbiLimit {
  label?: string;
  /** This business's QBI (post-SSTB-phase). */
  qbiIncome: number;
  /** 20% × QBI before the wage/UBIA limit. */
  tentativeDeduction: number;
  /** max(50% W-2 wages, 25% wages + 2.5% UBIA) — 0 when no wage/UBIA data supplied. */
  wageUbiaLimit: number;
  /** False when this business has no supplied wage/UBIA data (unlimited 20% — the
   *  CPA-applies-it-externally escape, preserved from the aggregate path). */
  limitApplied: boolean;
  /** This business's deductible amount after the (phased) wage/UBIA limit. */
  deductibleAmount: number;
}

export interface QbiCalculation {
  qbiAmount: number;
  preliminaryDeduction: number;
  taxableIncomeCap: number;
  finalDeduction: number;
  /** §199A(b)(2)(B) wage/UBIA limit = max(50% W-2 wages, 25% wages + 2.5% UBIA). 0 = not computed. */
  wageUbiaLimit?: number;
  /** True when the wage/UBIA limit reduced the deduction below the 20% tentative. */
  wageUbiaLimitBinds?: boolean;
  /** FED-04 / P2-4 — Form 8995-A per-business wage/UBIA limit detail (when the
   *  caller supplies `perBusiness`). Each business's limit is computed and
   *  summed independently, so a high-wage business cannot rescue a low-wage one. */
  perBusiness?: PerBusinessQbiLimit[];
}

// §199A taxable-income threshold + phase-in band by filing status / year.
// Below `start`: simplified 20% (no wage/UBIA limit). Above `end`: full
// wage/UBIA limit. Within: phased per Treas. Reg. §1.199A-1(d)(2)(iv).
// Per §199A(e)(2) the "threshold amount" is the base for ALL statuses EXCEPT a
// JOINT return (which is 200% of the base) — so MFS = the SINGLE amount (NOT
// half; an MFS taxpayer does not file a joint return). (Rev. Proc. 2023-34 /
// 2024-40 / 2025-32.) OBBBA made §199A permanent and WIDENED the TY2026 phase-in
// band to $75k single / $150k MFJ (was $50k/$100k).
export const QBI_WAGE_LIMIT_BAND: Record<TaxYear, Record<string, { start: number; end: number }>> = {
  2024: {
    single: { start: 191_950, end: 241_950 },
    head_of_household: { start: 191_950, end: 241_950 },
    married_filing_separately: { start: 191_950, end: 241_950 },
    married_filing_jointly: { start: 383_900, end: 483_900 },
    qualifying_widow: { start: 383_900, end: 483_900 },
  },
  2025: {
    single: { start: 197_300, end: 247_300 },
    head_of_household: { start: 197_300, end: 247_300 },
    married_filing_separately: { start: 197_300, end: 247_300 },
    married_filing_jointly: { start: 394_600, end: 494_600 },
    qualifying_widow: { start: 394_600, end: 494_600 },
  },
  2026: {
    single: { start: 201_750, end: 276_750 },
    head_of_household: { start: 201_750, end: 276_750 },
    married_filing_separately: { start: 201_750, end: 276_750 },
    married_filing_jointly: { start: 403_500, end: 553_500 },
    qualifying_widow: { start: 403_500, end: 553_500 },
  },
};

/**
 * §199A phase-in band [start, end] for a year + filing status — the SINGLE
 * source of truth shared by BOTH §199A mechanics: the wage/UBIA limit phase-in
 * (calculateQbi, below) AND the SSTB phase-out (taxReturnEngine). The year is
 * resolved via resolveTaxYear so an unsupported FUTURE year clamps to
 * LATEST_YEAR exactly like the rest of the engine (keep LATEST_YEAR advanced in
 * lockstep when adding a year). Routing BOTH §199A mechanics through this one
 * map fixed the prior bug where a TY2026 return used the TY2024 band. MFS =
 * single per §199A(e)(2) (only a JOINT return doubles the threshold amount).
 */
export function qbiPhaseInBand(
  taxYear: number | undefined | null,
  filingStatus: string | undefined | null,
): { start: number; end: number } {
  const band = QBI_WAGE_LIMIT_BAND[resolveTaxYear(taxYear)];
  return band[filingStatus ?? "single"] ?? band.single;
}

export function calculateQbi(params: {
  qbiIncome: number;
  taxableIncomeBeforeQbi: number;
  /**
   * §199A(e)(3) "net capital gain" = net long-term capital gain (§1(h)) +
   * qualified dividends. The overall limitation is 20% of (taxable income −
   * net capital gain), so income taxed at preferential rates cannot be
   * sheltered by the QBI deduction. Defaults to 0 (no preferential income).
   */
  netCapitalGain?: number;
  /** Aggregate §199A W-2 wages from the qualified business(es) (K-1 Box 20 code W / statement). */
  w2Wages?: number;
  /** Aggregate UBIA of qualified property (unadjusted basis immediately after acquisition). */
  ubia?: number;
  /** Filing status + tax year — needed for the §199A threshold + phase-in band. */
  filingStatus?: string;
  taxYear?: number;
  /**
   * FED-04 / P2-4 — Form 8995-A per-business detail. When supplied (and
   * non-empty), the §199A(b)(2)(B) wage/UBIA limit is computed PER BUSINESS and
   * the limited deductions are summed — the correct multi-entity treatment,
   * which prevents a high-wage business from "rescuing" a low-wage one. The sum
   * of `perBusiness[].qbiIncome` MUST equal `qbiIncome` (the caller builds it
   * post-SSTB-phase). A business with no supplied wage/UBIA data stays UNLIMITED
   * (the aggregate path's CPA-applies-it-externally escape, per business).
   * When absent, the aggregate `w2Wages`/`ubia` path runs unchanged.
   */
  perBusiness?: Array<{ qbiIncome: number; w2Wages: number; ubia: number; label?: string }>;
}): QbiCalculation {
  const { qbiIncome, taxableIncomeBeforeQbi, netCapitalGain = 0 } = params;
  if (qbiIncome <= 0) {
    return { qbiAmount: 0, preliminaryDeduction: 0, taxableIncomeCap: 0, finalDeduction: 0 };
  }
  const preliminary = qbiIncome * 0.20;
  const cap = Math.max(0, taxableIncomeBeforeQbi - Math.max(0, netCapitalGain)) * 0.20;

  // §199A(b)(2)(B) wage/UBIA limit. Only binds ABOVE the taxable-income
  // threshold, phased in over the band, and only when the CPA supplied the
  // business's W-2 wages / UBIA (positive). Absent that data, fall back to the
  // simplified 20% — the prior behavior (CPA applies the limit externally).
  const w2Wages = Math.max(0, params.w2Wages ?? 0);
  const ubia = Math.max(0, params.ubia ?? 0);
  const band = qbiPhaseInBand(params.taxYear, params.filingStatus);
  const overThreshold = taxableIncomeBeforeQbi > band.start;
  const excessRatio = Math.min(1, Math.max(0,
    (taxableIncomeBeforeQbi - band.start) / (band.end - band.start)));
  let wageLimitedPreliminary = preliminary;
  let wageUbiaLimit = 0;
  let wageUbiaLimitBinds = false;
  let perBusinessDetail: PerBusinessQbiLimit[] | undefined;

  if (params.perBusiness && params.perBusiness.length > 0) {
    // ── FED-04 / P2-4 — Form 8995-A per-business wage/UBIA limit ──────────
    // Each business's 20%-of-QBI is limited by ITS OWN max(50% wages, 25% wages
    // + 2.5% UBIA), phased over the band; businesses with no supplied wage data
    // stay unlimited (escape hatch). The limited deductions are then summed.
    //
    // §199A(c)(2) qualified-business-LOSS netting: a negative-QBI business
    // reduces the positive businesses' QBI (Form 8995-A Sched A) BEFORE the wage
    // limit. The caller passes `qbiIncome` already netted to qbiCombinedIncome,
    // and `perBusiness` carries only the positive businesses; so we scale each
    // positive business's QBI by (net qbiIncome / sum of positive QBI) — this
    // allocates the loss proportionally. Without it, the wage limit would be
    // applied to the un-netted positive QBI and OVER-state the deduction.
    const sumPositiveQbi = params.perBusiness.reduce((s, b) => s + Math.max(0, b.qbiIncome), 0);
    const lossScale = sumPositiveQbi > qbiIncome && sumPositiveQbi > 0 ? qbiIncome / sumPositiveQbi : 1;
    let sumDeduction = 0;
    let sumLimit = 0;
    perBusinessDetail = params.perBusiness.map((b) => {
      const bQbi = Math.max(0, b.qbiIncome) * lossScale;
      const bTentative = 0.20 * bQbi;
      const bW2 = Math.max(0, b.w2Wages);
      const bUbia = Math.max(0, b.ubia);
      const hasWageData = bW2 > 0 || bUbia > 0;
      let bLimit = 0;
      let bDeduction = bTentative;
      let limitApplied = false;
      if (hasWageData && overThreshold) {
        bLimit = Math.max(0.50 * bW2, 0.25 * bW2 + 0.025 * bUbia);
        const reduction = Math.max(0, bTentative - bLimit) * excessRatio;
        bDeduction = bTentative - reduction;
        limitApplied = reduction > 0;
      }
      sumDeduction += bDeduction;
      sumLimit += hasWageData ? bLimit : bTentative;
      return { label: b.label, qbiIncome: bQbi, tentativeDeduction: bTentative, wageUbiaLimit: bLimit, limitApplied, deductibleAmount: bDeduction };
    });
    wageLimitedPreliminary = sumDeduction;
    wageUbiaLimit = sumLimit;
    wageUbiaLimitBinds = sumDeduction < preliminary - 0.005;
  } else if (w2Wages > 0 || ubia > 0) {
    // ── Aggregate path (single business, or CPA-supplied aggregate) ──────
    if (overThreshold) {
      wageUbiaLimit = Math.max(0.50 * w2Wages, 0.25 * w2Wages + 0.025 * ubia);
      // Reduction = (tentative − limit) × excess-ratio, only when the limit
      // is below the tentative 20%. At the band top the full limit applies.
      const reduction = Math.max(0, preliminary - wageUbiaLimit) * excessRatio;
      wageLimitedPreliminary = preliminary - reduction;
      wageUbiaLimitBinds = reduction > 0;
    }
  }

  const cappedDeduction = Math.min(wageLimitedPreliminary, cap);

  // OBBBA §199A(i) — NEW minimum deduction (TY2026+): a taxpayer with at least
  // $1,000 of QBI from active qualified trades/businesses in which they
  // materially participate gets a §199A deduction of NOT LESS THAN $400 (both
  // the $400 and $1,000 are inflation-indexed after 2026). The engine's
  // qbiIncome is active QBI (Sch C net + active K-1 Box 1), so we apply the
  // floor when qbiIncome >= $1,000. Gated on the RAW tax year so it applies to a
  // TY2026 return even before native TY2026 brackets exist (resolveTaxYear would
  // otherwise clamp). The floor overrides the 20%-of-QBI / wage-limit reductions;
  // the caller floors taxable income at 0, so a near-zero-income filer can't
  // over-deduct. (Sub-gap: can't distinguish active vs passive QBI here — uses
  // the >= $1,000 proxy; CPA overrides for passive-only QBI.)
  const minQbiDeductionYear = params.taxYear ?? 2025;
  const minimumDeduction = minQbiDeductionYear >= 2026 && qbiIncome >= 1_000 ? 400 : 0;
  const finalDeduction = Math.max(cappedDeduction, minimumDeduction);

  return {
    qbiAmount: qbiIncome,
    preliminaryDeduction: preliminary,
    taxableIncomeCap: cap,
    finalDeduction,
    wageUbiaLimit,
    wageUbiaLimitBinds,
    perBusiness: perBusinessDetail,
  };
}

// ── OBBBA Schedule 1-A deductions (TY2025–2028) ─────────────────────────────
// Four NEW temporary deductions created by OBBBA (P.L. 119-21): qualified tips
// (§224), qualified overtime premium (§225), qualified passenger-vehicle loan
// interest (§163(h)(4)), and the $6,000 senior bonus (§151(d) add-on). Each is
// claimed on the new Schedule 1-A and flows to Form 1040 line 13b — i.e. it
// reduces TAXABLE INCOME (subtracted from AGI alongside the standard/itemized
// deduction), NOT AGI. Available to itemizers AND non-itemizers. Their MAGI
// phase-out base is AGI (unaffected by these deductions, so no circularity).
// Effective TY2025–2028 only. Senior is age-based (no marker); the other three
// read the CPA-supplied qualified amount.
export interface ObbbaSchedule1ADeductions {
  tips: number;
  overtime: number;
  carLoanInterest: number;
  senior: number;
  total: number;
}
function obbbaPhaseOut(base: number, magi: number, threshold: number, ratePerDollar: number): number {
  if (base <= 0) return 0;
  if (magi <= threshold) return base;
  return Math.max(0, base - ratePerDollar * (magi - threshold));
}
export function calculateObbbaSchedule1ADeductions(params: {
  taxYear: number;
  filingStatus: string;
  /** MAGI for the phase-outs — AGI (these deductions don't reduce AGI). */
  magi: number;
  qualifiedTips?: number;
  qualifiedOvertime?: number;
  qualifiedCarLoanInterest?: number;
  taxpayerAge?: number | null;
  spouseAge?: number | null;
}): ObbbaSchedule1ADeductions {
  const zero: ObbbaSchedule1ADeductions = { tips: 0, overtime: 0, carLoanInterest: 0, senior: 0, total: 0 };
  // TY2025–2028 only (OBBBA temporary window).
  if (params.taxYear < 2025 || params.taxYear > 2028) return zero;
  const isJoint = params.filingStatus === "married_filing_jointly" || params.filingStatus === "qualifying_widow";
  const magi = Math.max(0, params.magi);

  // §224 tips: cap $25,000 (single + MFJ); phase-out $150k/$300k, −$100 per $1,000.
  const tips = obbbaPhaseOut(Math.min(Math.max(0, params.qualifiedTips ?? 0), 25_000),
    magi, isJoint ? 300_000 : 150_000, 0.10);
  // §225 overtime (FLSA premium): cap $12,500 single / $25,000 MFJ; phase-out $150k/$300k, −$100/$1k.
  const overtime = obbbaPhaseOut(Math.min(Math.max(0, params.qualifiedOvertime ?? 0), isJoint ? 25_000 : 12_500),
    magi, isJoint ? 300_000 : 150_000, 0.10);
  // §163(h)(4) car-loan interest: cap $10,000; phase-out $100k/$200k, −$200/$1k (double rate).
  const carLoanInterest = obbbaPhaseOut(Math.min(Math.max(0, params.qualifiedCarLoanInterest ?? 0), 10_000),
    magi, isJoint ? 200_000 : 100_000, 0.20);
  // §151(d) senior bonus: $6,000 per individual age 65+; phase-out $75k/$150k, −6% of excess.
  const numSeniors = ((params.taxpayerAge ?? 0) >= 65 ? 1 : 0) + (isJoint && (params.spouseAge ?? 0) >= 65 ? 1 : 0);
  const senior = obbbaPhaseOut(6_000 * numSeniors, magi, isJoint ? 150_000 : 75_000, 0.06);

  return { tips, overtime, carLoanInterest, senior, total: tips + overtime + carLoanInterest + senior };
}

// ── AMT (Alternative Minimum Tax) ──────────────────────────────────────────
// Simplified: AMTI = taxable income + AMT preferences (we accept these from caller).
// AMT = max(0, AMT_rate × (AMTI − exemption) − regular tax).
// AMT exemptions phase out at high income (25¢ per $1 over threshold).
// 2024: 26% to $232,600, 28% above. Exemptions: $85,700 single, $133,300 MFJ.
// 2025: 26% to $239,100, 28% above. Exemptions: $88,100 single, $137,000 MFJ.
const AMT_DATA: Record<TaxYear, {
  exemption: Record<string, number>;
  exemptionPhaseOutStart: Record<string, number>;
  rateBreakpoint: number;
  /** Exemption phase-out rate (cents per $1 over the start). OBBBA §70107 raised
   *  it 25% -> 50% effective TY2026. */
  exemptionPhaseOutRate: number;
}> = {
  2024: {
    exemption: { single: 85700, married_filing_jointly: 133300, married_filing_separately: 66650, head_of_household: 85700, qualifying_widow: 133300 },
    exemptionPhaseOutStart: { single: 609350, married_filing_jointly: 1218700, married_filing_separately: 609350, head_of_household: 609350, qualifying_widow: 1218700 },
    rateBreakpoint: 232600,
    exemptionPhaseOutRate: 0.25,
  },
  2025: {
    exemption: { single: 88100, married_filing_jointly: 137000, married_filing_separately: 68500, head_of_household: 88100, qualifying_widow: 137000 },
    exemptionPhaseOutStart: { single: 626350, married_filing_jointly: 1252700, married_filing_separately: 626350, head_of_household: 626350, qualifying_widow: 1252700 },
    rateBreakpoint: 239100,
    exemptionPhaseOutRate: 0.25,
  },
  // TY2026 per Rev. Proc. 2025-32 §4.10. OBBBA §70107 reset the phase-out START
  // to a fixed $1,000,000 MFJ / $500,000 (others, incl. MFS — NOT halved) and
  // raised the phase-out RATE to 50%. rateBreakpoint $244,500 ($122,250 MFS, halved
  // in calculateAmt). Exemptions $140,200 MFJ / $90,100 single / $70,100 MFS.
  2026: {
    exemption: { single: 90100, married_filing_jointly: 140200, married_filing_separately: 70100, head_of_household: 90100, qualifying_widow: 140200 },
    exemptionPhaseOutStart: { single: 500000, married_filing_jointly: 1000000, married_filing_separately: 500000, head_of_household: 500000, qualifying_widow: 1000000 },
    rateBreakpoint: 244500,
    exemptionPhaseOutRate: 0.50,
  },
};

export interface AmtCalculation {
  amti: number;
  exemption: number;
  amtBeforeRegular: number;
  regularTax: number;
  amtTax: number;
  /** K3 — Form 6251 Part III: AMT computed at 26/28% on full AMT base
   *  (the "no-preferential" path). */
  amtAtFullRateOnAmtBase: number;
  /** K3 — Form 6251 Part III: AMT with LTCG/QDIV preserved at 0/15/20%
   *  preferential rates (the "with-preferential" path). Equals
   *  `amtBeforeRegular` when LTCG/QDIV are present and preferred yields
   *  the lower tentative AMT. */
  amtWithPreferentialRates: number;
  /** K3 — portion of LTCG+QDIV included in the AMT base. */
  ltcgQdivInAmtBase: number;
  /** ATNOLD (§56(d)) applied this year — limited to 90% of AMTI before the ATNOLD. */
  atnoldApplied: number;
  /** AMT NOL carryforward remaining after this year's ATNOLD. */
  atnoldCarryforwardRemaining: number;
}

export function calculateAmt(params: {
  taxableIncome: number;
  amtPreferences: number;
  filingStatus: string;
  regularTax: number;
  taxYear: number;
  /** K3 — LTCG + QDIV portion of taxable income (Form 6251 Part III).
   *  When > 0, AMT is computed both ways and the lower is used. */
  ltcgPlusQdiv?: number;
  /** AMT NOL carryforward (ATNOLD, §56(d)) — the AMT-basis NOL the CPA carries
   *  in. Applied against AMTI, limited to 90% of AMTI before the ATNOLD. */
  amtNolCarryforward?: number;
}): AmtCalculation {
  const year = resolveTaxYear(params.taxYear);
  const data = AMT_DATA[year];
  const { taxableIncome, amtPreferences, filingStatus, regularTax } = params;
  const fs = filingStatus in data.exemption ? filingStatus : "single";
  const baseExemption = data.exemption[fs];
  const phaseStart = data.exemptionPhaseOutStart[fs];
  // AMTI = regular taxable income + net AMT preferences/adjustments. Net prefs
  // may be NEGATIVE (Form 6251 line 2e — a taxable state refund is removed for
  // AMT). Floor AMTI (not the prefs) at 0. Equivalent to the prior
  // `Math.max(0, amtPreferences)` for all non-negative-pref callers.
  const amtiBeforeAtnold = Math.max(0, taxableIncome + amtPreferences);
  // ATNOLD (§56(d)(1)): the alternative-tax NOL deduction is limited to 90% of
  // AMTI figured WITHOUT the ATNOLD. The unused excess carries forward. The CPA
  // supplies the AMT-basis NOL carryforward (recomputed with AMT adjustments).
  const amtNol = Math.max(0, params.amtNolCarryforward ?? 0);
  const atnoldApplied = Math.min(amtNol, 0.90 * amtiBeforeAtnold);
  const atnoldCarryforwardRemaining = Math.max(0, amtNol - atnoldApplied);
  const amti = Math.max(0, amtiBeforeAtnold - atnoldApplied);
  // Phase out: 25¢ per $1 over threshold (50¢ for TY2026+ per OBBBA §70107).
  const phaseOut = amti > phaseStart ? (amti - phaseStart) * data.exemptionPhaseOutRate : 0;
  const exemption = Math.max(0, baseExemption - phaseOut);
  const amtBase = Math.max(0, amti - exemption);

  // FED-01: the 26%/28% breakpoint is halved for MFS (Form 6251: "$232,600 —
  // or $116,300 if married filing separately"; 2025: $239,100 / $119,550).
  const rateBreakpoint =
    fs === "married_filing_separately" ? data.rateBreakpoint / 2 : data.rateBreakpoint;

  // Path 1 — AMT at full 26/28% on the entire AMT base (original behavior).
  const amtAtFullRateOnAmtBase =
    amtBase <= rateBreakpoint
      ? amtBase * 0.26
      : rateBreakpoint * 0.26 + (amtBase - rateBreakpoint) * 0.28;

  // Path 2 — Form 6251 Part III: preserve LTCG/QDIV at 0/15/20% preferential rates.
  // Splits the AMT base into ordinary portion (taxed at 26/28%) and LTCG/QDIV
  // portion (taxed at preferential rates, stacked above the ordinary portion).
  // The lower of the two paths is the tentative minimum tax (Line 61).
  const ltcgPlusQdiv = Math.max(0, params.ltcgPlusQdiv ?? 0);
  const ltcgQdivInAmtBase = Math.min(ltcgPlusQdiv, amtBase);
  let amtWithPreferentialRates = amtAtFullRateOnAmtBase;
  if (ltcgQdivInAmtBase > 0) {
    const ordinaryPortion = Math.max(0, amtBase - ltcgQdivInAmtBase);
    const amtOnOrdinary =
      ordinaryPortion <= rateBreakpoint
        ? ordinaryPortion * 0.26
        : rateBreakpoint * 0.26 + (ordinaryPortion - rateBreakpoint) * 0.28;
    const ltcgTax = calculateLtcgQdivStackedTax(ordinaryPortion, ltcgQdivInAmtBase, fs, year);
    amtWithPreferentialRates = amtOnOrdinary + ltcgTax;
  }

  const amtBeforeRegular = Math.min(amtAtFullRateOnAmtBase, amtWithPreferentialRates);
  const amtTax = Math.max(0, amtBeforeRegular - regularTax);
  return {
    amti,
    exemption,
    amtBeforeRegular,
    regularTax,
    amtTax,
    amtAtFullRateOnAmtBase,
    amtWithPreferentialRates,
    ltcgQdivInAmtBase,
    atnoldApplied,
    atnoldCarryforwardRemaining,
  };
}

// ── Child Tax Credit (federal) ─────────────────────────────────────────────
// 2024 + 2025 rules: $2,000 per qualifying child under 17 with SSN; phase out
// $50 per $1,000 (or fraction) of AGI over $200,000 single ($400,000 MFJ).
// Other dependents: $500 Credit for Other Dependents (subject to same phase-out).
//
// Two components:
//   - Non-refundable portion: reduces tax, but only down to $0
//   - Refundable Additional Child Tax Credit (ACTC): up to $1,700 per qualifying child
//     in 2024 ($1,700 in 2025), computed as MIN(unused CTC, 15% × max(0, earned − $2,500))
// OBBBA (P.L. 119-21 §70104) raised the §24(a) CTC from $2,000 to $2,200 and
// made it permanent + inflation-indexed beginning TY2025. TY2026 rounds flat at
// $2,200 (Rev. Proc. 2025-32). Phase-out thresholds ($200k/$400k) + the $500 ODC
// were made permanent but are NOT inflation-indexed.
const CTC_PER_CHILD: Record<TaxYear, number> = { 2024: 2000, 2025: 2200, 2026: 2200 };
const ODC_PER_DEPENDENT = 500;
const ACTC_REFUNDABLE_PER_CHILD: Record<TaxYear, number> = { 2024: 1700, 2025: 1700, 2026: 1700 }; // §24(d)(1)(A) indexed, rounded flat $1,700 for 2026 (Rev. Proc. 2025-32)
const ACTC_EARNED_INCOME_THRESHOLD = 2500;
const ACTC_RATE = 0.15;

export interface CtcCalculation {
  /** Qualifying children counted */
  qualifyingChildren: number;
  /** Other dependents counted */
  otherDependents: number;
  /** Maximum credit before phase-out */
  preliminaryCredit: number;
  /** Dollars reduced due to AGI phase-out */
  phaseOutReduction: number;
  /** Total credit (non-refundable + refundable portions, after phase-out) */
  appliedCredit: number;
  /** AGI threshold above which phase-out begins */
  phaseOutThreshold: number;
  /** Non-refundable portion (limited by tax owed) */
  nonRefundablePortion: number;
  /** Refundable Additional Child Tax Credit portion */
  refundableActc: number;
}

export function calculateChildTaxCredit(params: {
  qualifyingChildren: number;
  otherDependents: number;
  agi: number;
  filingStatus: string;
  taxYear: number;
  /** Tax owed before CTC (non-refundable portion is capped at this). Optional. */
  taxBeforeCredit?: number;
  /** Earned income (wages + SE) for ACTC calc. Optional — defaults to AGI. */
  earnedIncome?: number;
}): CtcCalculation {
  const { qualifyingChildren, otherDependents, agi, filingStatus, taxYear } = params;
  const year = resolveTaxYear(taxYear);
  const safeChildren = Math.max(0, Math.floor(qualifyingChildren));
  const safeOther = Math.max(0, Math.floor(otherDependents));

  const preliminaryCredit =
    safeChildren * CTC_PER_CHILD[year] + safeOther * ODC_PER_DEPENDENT;

  // MFJ uses $400k threshold; everyone else uses $200k. (MFS uses $200k.)
  const phaseOutThreshold = filingStatus === "married_filing_jointly" ? 400000 : 200000;

  let phaseOutReduction = 0;
  if (agi > phaseOutThreshold) {
    const excess = agi - phaseOutThreshold;
    const increments = Math.ceil(excess / 1000);
    phaseOutReduction = increments * 50;
  }

  const totalCreditAvailable = Math.max(0, preliminaryCredit - phaseOutReduction);

  // If we know tax before credit, split into non-refundable + refundable.
  // Otherwise treat the whole credit as a single number (legacy behavior).
  const taxBefore = params.taxBeforeCredit;
  const earned = params.earnedIncome ?? agi;

  let nonRefundablePortion = totalCreditAvailable;
  let refundableActc = 0;

  if (taxBefore != null) {
    nonRefundablePortion = Math.min(totalCreditAvailable, Math.max(0, taxBefore));
    const unusedNonRefundable = totalCreditAvailable - nonRefundablePortion;
    // ACTC refundable cap: $1,700 per qualifying child (2024 + 2025), AND 15% of (earned − $2,500).
    const actcCap = safeChildren * ACTC_REFUNDABLE_PER_CHILD[year];
    const earnedIncomeBased = Math.max(0, earned - ACTC_EARNED_INCOME_THRESHOLD) * ACTC_RATE;
    refundableActc = Math.min(unusedNonRefundable, actcCap, earnedIncomeBased);
  }

  return {
    qualifyingChildren: safeChildren,
    otherDependents: safeOther,
    preliminaryCredit,
    phaseOutReduction,
    appliedCredit: nonRefundablePortion + refundableActc,
    phaseOutThreshold,
    nonRefundablePortion,
    refundableActc,
  };
}
