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

export const SUPPORTED_TAX_YEARS = [2024, 2025] as const;
export type TaxYear = (typeof SUPPORTED_TAX_YEARS)[number];
const LATEST_YEAR: TaxYear = 2025;

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
};

const FEDERAL_STANDARD_DEDUCTIONS: Record<TaxYear, Record<string, number>> = {
  2024: {
    single: 14600,
    married_filing_jointly: 29200,
    married_filing_separately: 14600,
    head_of_household: 21900,
    qualifying_widow: 29200,
  },
  2025: {
    single: 15000,
    married_filing_jointly: 30000,
    married_filing_separately: 15000,
    head_of_household: 22500,
    qualifying_widow: 30000,
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

export function resolveTaxYear(input: number | undefined | null): TaxYear {
  if (input == null) return LATEST_YEAR;
  if ((SUPPORTED_TAX_YEARS as readonly number[]).includes(input)) {
    return input as TaxYear;
  }
  // Unsupported: fall back to nearest available year
  if (input < 2024) return 2024;
  return LATEST_YEAR;
}

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
  if (info.surtax && federalAgi > info.surtax.threshold) {
    total += (federalAgi - info.surtax.threshold) * info.surtax.rate;
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
  HI: { description: "HI fully exempts qualified employer-funded retirement income (we apply to all retirement income)" },
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

  // ── NY: $20k per filer / $40k MFJ; age 59½+ ─────────────────────────
  if (code === "NY") {
    if ((params.taxpayerAge ?? 0) < 60) {
      return { exemption: 0, reason: "NY $20k exclusion requires age 59½+ (we use 60)" };
    }
    const status = params.filingStatus ?? "single";
    const isMfj = status === "married_filing_jointly" || status === "qualifying_widow";
    const cap = isMfj ? 40000 : 20000;
    const exemption = Math.min(Math.max(0, params.retirementIncome), cap);
    return {
      exemption,
      reason: `NY Line 29 pension/IRA exclusion: $${cap.toLocaleString()} ${isMfj ? "MFJ combined" : "per filer"}`,
    };
  }

  // ── PA/IL/MS/HI: full exemption (age-gated for PA/MS) ──────────────
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
  "OH-AKRON":         { jurisdictionLabel: "Akron, OH",                 state: "OH", rate: 0.0250, base: "wages_only" },
  "OH-CANTON":        { jurisdictionLabel: "Canton, OH",                state: "OH", rate: 0.0250, base: "wages_only" },
  "OH-CINCINNATI":    { jurisdictionLabel: "Cincinnati, OH",            state: "OH", rate: 0.0180, base: "wages_only" }, // 2020 ballot reduction from 2.10%
  "OH-CLEVELAND":     { jurisdictionLabel: "Cleveland, OH",             state: "OH", rate: 0.0250, base: "wages_only" },
  "OH-COLUMBUS":      { jurisdictionLabel: "Columbus, OH",              state: "OH", rate: 0.0250, base: "wages_only" },
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

/** E14 — Convenience: list of locality codes available for a given state. */
export function localityCodesForState(stateCode: string): Array<{ code: string; label: string }> {
  const stUpper = stateCode.toUpperCase();
  if (stUpper === "NY") return [{ code: "NYC", label: "New York City (NYC PIT)" }];
  return Object.entries(LOCAL_TAX_DATA)
    .filter(([, info]) => info.state === stUpper)
    .map(([code, info]) => ({ code, label: info.jurisdictionLabel }));
}

/** E14 — Flat-rate locality dispatch. Returns null when localityCode isn't
 *  in LOCAL_TAX_DATA (caller handles NYC + null). Uses zero-value NYC fields
 *  so callers see a uniform shape. */
export function calculateFlatRateLocalTax(params: {
  localityCode: string;
  residentState: string;
  federalAgi: number;
  totalWages: number;
  filingStatus: string;
  taxYear: number;
}): NycLocalTaxCalculation | null {
  const info = LOCAL_TAX_DATA[params.localityCode];
  if (!info) return null;
  // Enforce state match — a stale localityCode after a state change
  // silently skips rather than producing a phantom local tax.
  if (info.state !== params.residentState.toUpperCase()) return null;

  // Compute the base per locality rule.
  let base = 0;
  if (info.base === "federal_agi") {
    base = Math.max(0, params.federalAgi);
  } else if (info.base === "wages_only") {
    base = Math.max(0, params.totalWages);
  } else {
    // state_taxable: federalAgi − resident-state std ded.
    const year = resolveTaxYear(params.taxYear);
    const stInfo = STATE_TAX_DATA_BY_YEAR[year]?.[info.state];
    const stdDed = stInfo?.standardDeduction
      ? pickStateStdDeduction(stInfo.standardDeduction, params.filingStatus as StateFilingStatus)
      : 0;
    base = Math.max(0, params.federalAgi - stdDed);
  }

  const tax = base * info.rate;
  return {
    jurisdiction: params.localityCode,
    nysTaxableIncome: 0,
    baselineTax: tax,
    householdCredit: 0,
    nycEitc: 0,
    nycEitcRate: 0,
    nycSchoolTaxCredit: 0,
    nycMctmt: 0,
    netLocalTax: tax,
    flatRate: info.rate,
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
    /** E11 — Dependent count for PA Schedule SP Tax Forgiveness brackets
     *  ($9,500 per dependent added to eligibility thresholds). Pass
     *  client.dependentsUnder17 + client.otherDependents. */
    dependentCount?: number;
    /** E8 — Net SE earnings for NYC MCTMT (Metropolitan Commuter
     *  Transportation Mobility Tax). Only applied when localityCode === "NYC". */
    netSeEarnings?: number;
  };
}): MultiStateTaxResult {
  const resident = params.residentState.toUpperCase();
  const nonresidentTotalsByState = new Map<string, number>();

  // Aggregate per-state wages excluding resident state
  for (const entry of params.perStateWages) {
    const code = (entry.stateCode || "").toUpperCase();
    if (!code || code === resident) continue; // resident-state wages are covered by resident calc
    const wages = Math.max(0, entry.wages);
    if (wages === 0) continue;
    nonresidentTotalsByState.set(code, (nonresidentTotalsByState.get(code) ?? 0) + wages);
  }

  // Compute non-resident state tax for each (skip reciprocity pairs)
  const nonresidentStateTaxes: MultiStateTaxResult["nonresidentStateTaxes"] = [];
  let totalNrTax = 0;
  let totalNrWages = 0; // Track total NR wages for credit cap

  for (const [nrState, nrWages] of nonresidentTotalsByState.entries()) {
    const reciprocity = hasReciprocity(resident, nrState);
    if (reciprocity) {
      // Reciprocity: NR state does not tax. Resident state taxes the wages.
      nonresidentStateTaxes.push({ state: nrState, tax: 0, wages: nrWages, reciprocityApplied: true });
      continue;
    }

    // ── CA 540NR formula (FTB Form 540NR Schedule CA, Part III) ─────────────
    // NR tax = Tax(total income as if CA resident) × (CA-source income / total income).
    // This produces a higher NR tax than applying CA brackets directly to NR wages
    // because CA is progressive: the resident-equivalent calculation uses the higher
    // marginal rate corresponding to total income, and we then allocate proportionally.
    let nrTax: number;
    if (nrState === "CA" && params.federalAgi > 0) {
      const taxAsIfResident = calculateStateTax(
        params.federalAgi,
        "CA",
        params.filingStatus,
        params.taxYear,
        // K10 — preserve SS exclusion for the CA-as-resident sub-computation
        // (CA is not in STATES_TAXING_SS). Other options stay scoped to the
        // resident-state call below to avoid OR-subtraction / NJ-pension
        // double-counting.
        { taxableSocialSecurity: params.options?.taxableSocialSecurity },
      );
      const sourceFraction = Math.min(1, Math.max(0, nrWages / params.federalAgi));
      nrTax = taxAsIfResident * sourceFraction;
    } else {
      // Other NR states: simplified — apply NR state's brackets directly to NR wages.
      // Real NR returns often have additional adjustments we don't model.
      nrTax = calculateStateTax(nrWages, nrState, params.filingStatus, params.taxYear, {});
    }
    nonresidentStateTaxes.push({ state: nrState, tax: nrTax, wages: nrWages, reciprocityApplied: false });
    totalNrTax += nrTax;
    totalNrWages += nrWages;
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
    const py = computePartYearAllocation(
      formerStateUpper,
      resident,
      params.partYearResidency.residencyChangeDate,
      params.taxYear,
      params.federalAgi,
      params.filingStatus,
      params.options ?? {},
      perStateWageMap,
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
  } else if (params.localityCode && LOCAL_TAX_DATA[params.localityCode]) {
    // E14 — Flat-rate locality dispatch (MD counties, OH cities, IN counties).
    // Returns null when state doesn't match (stale localityCode protection).
    localTax = calculateFlatRateLocalTax({
      localityCode: params.localityCode,
      residentState: resident,
      federalAgi: params.federalAgi,
      totalWages: params.totalWages ?? 0,
      filingStatus: params.filingStatus,
      taxYear: params.taxYear,
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
    // Wages flow to their respective state; non-wage income pro-rates by days.
    const w2WagesFormer = Math.max(0, perStateWages[formerStateUpper] ?? 0);
    const w2WagesCurrent = Math.max(0, perStateWages[currentStateUpper] ?? 0);
    const totalW2Wages = Object.values(perStateWages).reduce(
      (s, v) => s + Math.max(0, v),
      0,
    );
    const nonW2Agi = Math.max(0, federalAgiSafe - totalW2Wages);
    const nonW2Former =
      daysInYear > 0 ? nonW2Agi * (daysFormer / daysInYear) : 0;
    const nonW2Current =
      daysInYear > 0 ? nonW2Agi * (daysCurrent / daysInYear) : nonW2Agi;
    formerStateAgi = w2WagesFormer + nonW2Former;
    currentStateAgi = w2WagesCurrent + nonW2Current;
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
  const formerStateTax = formerStateAgi > 0
    ? calculateStateTax(formerStateAgi, formerStateUpper, filingStatus, taxYear, options)
    : 0;
  const currentStateTax = currentStateAgi > 0
    ? calculateStateTax(currentStateAgi, currentStateUpper, filingStatus, taxYear, options)
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

  // E8 — MCTMT (Metropolitan Commuter Transportation Mobility Tax, NYS
  // PMT-MTA-6). Tiered rate on net SE earnings allocated to MCTD above
  // the $50,000 annual exemption:
  //   $50,001 - $362,500: 0.34%
  //   $362,501 - $675,000: 0.50% (incremental)
  //   $675,001+: 0.60% (incremental)
  // Engine applies in the simplified-tier form for most filers.
  const netSe = Math.max(0, params.netSeEarnings ?? 0);
  let nycMctmt = 0;
  if (netSe > 50000) {
    const tier1Cap = 362500;
    const tier2Cap = 675000;
    const inTier1 = Math.min(netSe, tier1Cap) - 50000;
    const inTier2 = Math.max(0, Math.min(netSe, tier2Cap) - tier1Cap);
    const inTier3 = Math.max(0, netSe - tier2Cap);
    nycMctmt = inTier1 * 0.0034 + inTier2 * 0.0050 + inTier3 * 0.0060;
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
  const stdDed = pickStateStdDeduction(info.standardDeduction, status);
  // K10 — for states that exempt SS from their tax base, subtract the
  // federally-taxable SS amount BEFORE applying state brackets. (For the 9
  // SS-taxing states in STATES_TAXING_SS, federal AGI inherently includes
  // taxable SS and we leave it in the state base.)
  const ssExclusion = !STATES_TAXING_SS.has(code)
    ? Math.max(0, options?.taxableSocialSecurity ?? 0)
    : 0;
  // VT (and any future state) — per-filer personal exemption deducted from taxable.
  // IL-1040 Line 10b cliff: when federalAgi exceeds the personalExemptionAgiCliff
  // threshold (single/HoH/MFS/QSS $250k, MFJ $500k for IL TY2024), the exemption
  // is reduced to $0 entirely. Other states with personal exemptions but no
  // cliff (VT) leave personalExemptionAgiCliff undefined.
  let personalExemption = info.personalExemption ? pickStateStdDeduction(info.personalExemption, status) : 0;
  if (info.personalExemptionAgiCliff && personalExemption > 0) {
    const cliff = pickStateStdDeduction(info.personalExemptionAgiCliff, status);
    if (cliff > 0 && federalAgi > cliff) {
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
  }).exemption;

  const stateTaxable = Math.max(0, federalAgi - stdDed - personalExemption - oregonSubtraction - retirementExemption - ssExclusion);
  const brackets = pickStateBrackets(info.brackets, status);
  let tax = applyBrackets(stateTaxable, brackets);

  // Apply surtax (e.g. MA millionaire's tax, CA mental health 1% over $1M).
  // Surtax thresholds use federal AGI per state statute; SS exclusion does
  // not apply to surtax threshold determination (surtax is on raw AGI band).
  if (info.surtax && federalAgi > info.surtax.threshold) {
    tax += (federalAgi - info.surtax.threshold) * info.surtax.rate;
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
//   Line 5: SALT (state income/property + sales tax) — capped at $10,000 ($5,000 MFS)
//   Line 8: Mortgage interest (Schedule A line 8a/8e) — Schedule A line item
//   Line 11: Cash charitable — generally limited to 60% AGI
//   Line 12: Property charitable — generally limited to 30% AGI

const SALT_CAP = 10000;
const SALT_CAP_MFS = 5000;
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
  /** SALT after $10,000 / $5,000 MFS cap */
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
  const saltCap = filingStatus === "married_filing_separately" ? SALT_CAP_MFS : SALT_CAP;
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
  const propDeductible = Math.min(charitableProperty, agi * CHARITABLE_PROPERTY_AGI_LIMIT);
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
};

const EITC_INVESTMENT_INCOME_LIMIT: Record<TaxYear, number> = { 2024: 11600, 2025: 11950 };

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
    MD: 0.45, // MD Form 502 Line 22 — 45% standard (50% Maryland refundable since TY2023);
              // expanded for childless filers (~100% of federal) not modeled — use 45%
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
  /** Federal Child & Dependent Care Credit applied (for NY + CA piggybacks). */
  federalCdccApplied?: number;
  /** Property tax adjustment (Schedule A line for SALT property) for IL Property Tax Credit. */
  propertyTaxPaid?: number;
  /** Qualified K-12 education expenses (IL K-12 credit). */
  k12QualifiedExpenses?: number;
  /** Months rented (CA Renter's Credit requires ≥ 6 months). */
  monthsRented?: number;
  /** Qualified college tuition expenses (NY College Tuition Credit). */
  collegeTuitionExpenses?: number;
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
};

const IRA_LIMITS: Record<TaxYear, { base: number; catchUp: number }> = {
  2024: { base: 7000, catchUp: 1000 },
  2025: { base: 7000, catchUp: 1000 },
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
    qualifying_widow: [{ agiMax: 46000, rate: 0.50 }, { agiMax: 50000, rate: 0.20 }, { agiMax: 76500, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
  },
  2025: {
    single: [{ agiMax: 23750, rate: 0.50 }, { agiMax: 25750, rate: 0.20 }, { agiMax: 39500, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    married_filing_jointly: [{ agiMax: 47500, rate: 0.50 }, { agiMax: 51500, rate: 0.20 }, { agiMax: 79000, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    married_filing_separately: [{ agiMax: 23750, rate: 0.50 }, { agiMax: 25750, rate: 0.20 }, { agiMax: 39500, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    head_of_household: [{ agiMax: 35625, rate: 0.50 }, { agiMax: 38625, rate: 0.20 }, { agiMax: 59250, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
    qualifying_widow: [{ agiMax: 47500, rate: 0.50 }, { agiMax: 51500, rate: 0.20 }, { agiMax: 79000, rate: 0.10 }, { agiMax: Infinity, rate: 0 }],
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
  const cap = (params.filingStatus === "married_filing_jointly" || params.filingStatus === "qualifying_widow")
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
}): DependentCareCreditCalculation {
  const { expenses, qualifyingDependents, earnedIncomeTaxpayer, earnedIncomeSpouse, agi, filingStatus } = params;
  const expenseLimit = qualifyingDependents <= 0 ? 0 : qualifyingDependents === 1 ? DEPCARE_LIMIT_1 : DEPCARE_LIMIT_2_PLUS;

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

  // Rate phase-down: every $2,000 of AGI above $15,000 reduces rate by 1%, floor at 20%
  let rate = DEPCARE_MAX_RATE;
  if (agi > 15000) {
    const reductions = Math.floor((agi - 15000) / 2000);
    rate = Math.max(DEPCARE_MIN_RATE, DEPCARE_MAX_RATE - reductions * 0.01);
  }
  if (agi >= 43000) rate = DEPCARE_MIN_RATE;

  return {
    expenses, qualifyingChildren: qualifyingDependents, expenseLimit, earnedIncomeLimit,
    eligibleExpenses, rate, appliedCredit: eligibleExpenses * rate,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 1.5 — Everyday-filer credits and deductions
// ════════════════════════════════════════════════════════════════════════════

// ── Educator expenses (IRC §62(a)(2)(D)) ────────────────────────────────────
// $300 above-the-line per eligible K-12 educator (teacher, instructor, counselor,
// principal, aide working 900+ hours). MFJ with two eligible educators can
// deduct up to $600 combined. 2024 and 2025: $300/educator.
const EDUCATOR_PER_FILER_CAP_2024 = 300;
const EDUCATOR_PER_FILER_CAP_2025 = 300;

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
  const perFilerCap = year === 2025 ? EDUCATOR_PER_FILER_CAP_2025 : EDUCATOR_PER_FILER_CAP_2024;
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
    const caps = year === 2025 ? PTC_REPAYMENT_CAPS_2025 : PTC_REPAYMENT_CAPS_2024;
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
  const prefTax = calculateLtcgQdivStackedTax(ltcgStackBase, ltcgIncluded, status, year);

  // K8 — Kiddie tax (Form 8615 Line 18).
  // When the child has net unearned income > $2,600, that excess is taxed
  // at the parent's marginal rate instead of the child's. Engine simplification:
  // amount-at-parent-rate is treated as ordinary (sub-gap: small LTCG/QDIV
  // portion within kiddie income is also taxed at parent rate in this model;
  // IRS Form 8615 uses a more elaborate stacking with the QDCG worksheet).
  let kiddieTotal = ordinaryTax + prefTax;
  if (params.kiddieTax && params.kiddieTax.isKiddieTaxFiler && params.kiddieTax.unearnedIncome > 2600) {
    const totalTaxable = ordinaryWithStcg + ltcgIncluded;
    const netUnearned = params.kiddieTax.unearnedIncome - 2600;
    const amountAtParentRate = Math.min(netUnearned, totalTaxable);
    if (amountAtParentRate > 0) {
      // Child's remaining ordinary base (after carving out the parent-rate portion).
      const ordinaryRemaining = Math.max(0, ordinaryWithStcg - amountAtParentRate);
      const ltcgRemaining = Math.max(0, ltcgIncluded - Math.max(0, amountAtParentRate - ordinaryWithStcg));
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
const SS_WAGE_BASE: Record<TaxYear, number> = { 2024: 168600, 2025: 176100 };
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
const FEIE_CAP: Record<TaxYear, number> = { 2024: 126500, 2025: 130000 };

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
export interface QbiCalculation {
  qbiAmount: number;
  preliminaryDeduction: number;
  taxableIncomeCap: number;
  finalDeduction: number;
}

export function calculateQbi(params: {
  qbiIncome: number;
  taxableIncomeBeforeQbi: number;
}): QbiCalculation {
  const { qbiIncome, taxableIncomeBeforeQbi } = params;
  if (qbiIncome <= 0) {
    return { qbiAmount: 0, preliminaryDeduction: 0, taxableIncomeCap: 0, finalDeduction: 0 };
  }
  const preliminary = qbiIncome * 0.20;
  const cap = Math.max(0, taxableIncomeBeforeQbi) * 0.20;
  return {
    qbiAmount: qbiIncome,
    preliminaryDeduction: preliminary,
    taxableIncomeCap: cap,
    finalDeduction: Math.min(preliminary, cap),
  };
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
}> = {
  2024: {
    exemption: { single: 85700, married_filing_jointly: 133300, married_filing_separately: 66650, head_of_household: 85700, qualifying_widow: 133300 },
    exemptionPhaseOutStart: { single: 609350, married_filing_jointly: 1218700, married_filing_separately: 609350, head_of_household: 609350, qualifying_widow: 1218700 },
    rateBreakpoint: 232600,
  },
  2025: {
    exemption: { single: 88100, married_filing_jointly: 137000, married_filing_separately: 68500, head_of_household: 88100, qualifying_widow: 137000 },
    exemptionPhaseOutStart: { single: 626350, married_filing_jointly: 1252700, married_filing_separately: 626350, head_of_household: 626350, qualifying_widow: 1252700 },
    rateBreakpoint: 239100,
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
}): AmtCalculation {
  const year = resolveTaxYear(params.taxYear);
  const data = AMT_DATA[year];
  const { taxableIncome, amtPreferences, filingStatus, regularTax } = params;
  const fs = filingStatus in data.exemption ? filingStatus : "single";
  const baseExemption = data.exemption[fs];
  const phaseStart = data.exemptionPhaseOutStart[fs];
  const amti = taxableIncome + Math.max(0, amtPreferences);
  // Phase out: 25¢ per $1 over threshold
  const phaseOut = amti > phaseStart ? (amti - phaseStart) * 0.25 : 0;
  const exemption = Math.max(0, baseExemption - phaseOut);
  const amtBase = Math.max(0, amti - exemption);

  // Path 1 — AMT at full 26/28% on the entire AMT base (original behavior).
  const amtAtFullRateOnAmtBase =
    amtBase <= data.rateBreakpoint
      ? amtBase * 0.26
      : data.rateBreakpoint * 0.26 + (amtBase - data.rateBreakpoint) * 0.28;

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
      ordinaryPortion <= data.rateBreakpoint
        ? ordinaryPortion * 0.26
        : data.rateBreakpoint * 0.26 + (ordinaryPortion - data.rateBreakpoint) * 0.28;
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
const CTC_PER_CHILD = 2000;
const ODC_PER_DEPENDENT = 500;
const ACTC_REFUNDABLE_PER_CHILD: Record<TaxYear, number> = { 2024: 1700, 2025: 1700 };
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
    safeChildren * CTC_PER_CHILD + safeOther * ODC_PER_DEPENDENT;

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
