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
 *   - State: no state credits, exemptions, or local taxes (NYC, MD counties, OH cities).
 *   - Calculator is for estimation; actual filings need professional software.
 */

import {
  STATE_TAX_DATA_BY_YEAR,
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
//   - HI/NJ/NY: partial exemptions with caps — NOT modeled, flagged below
const STATE_RETIREMENT_EXEMPTION_RULES: Record<string, { ageMin?: number; description: string }> = {
  PA: { ageMin: 60, description: "PA fully exempts qualified retirement income at age 59½+ (we use 60)" },
  IL: { description: "IL fully exempts qualified retirement income (no age requirement)" },
  MS: { ageMin: 60, description: "MS fully exempts qualified retirement income at age 59½+ (we use 60)" },
};

export function getStateRetirementExemption(params: {
  stateCode: string;
  retirementIncome: number;
  taxpayerAge?: number;
}): { exemption: number; reason?: string } {
  const cfg = STATE_RETIREMENT_EXEMPTION_RULES[params.stateCode.toUpperCase()];
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

export interface MultiStateTaxResult {
  /** Resident state's tax liability (after credit for NR tax paid) */
  residentStateTax: number;
  /** Tax paid to each non-resident state */
  nonresidentStateTaxes: Array<{ state: string; tax: number; wages: number; reciprocityApplied: boolean }>;
  /** Total state tax across all states (= resident after credit + sum of NR taxes) */
  totalStateTax: number;
  /** Credit applied at resident state for taxes paid to non-resident states */
  residentCreditApplied: number;
  /** Resident state's tax BEFORE applying the credit (informational) */
  residentStateTaxBeforeCredit: number;
}

export function calculateMultiStateTax(params: {
  residentState: string;
  federalAgi: number;
  filingStatus: string;
  taxYear: number;
  /** Per-state W-2 wage allocation (one entry per W-2 stateCode). Unallocated wages stay with resident state. */
  perStateWages: PerStateWageAllocation[];
  options?: {
    federalIncomeTaxPaid?: number;
    retirementIncomeForExemption?: number;
    taxpayerAge?: number;
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
    // NR state taxes its source wages. We use NR state's bracket on those wages
    // (simplified — real NR returns often have additional adjustments).
    const nrTax = calculateStateTax(nrWages, nrState, params.filingStatus, params.taxYear, {
      // NR state does NOT apply resident-state retirement exemption or OR fed subtraction
    });
    nonresidentStateTaxes.push({ state: nrState, tax: nrTax, wages: nrWages, reciprocityApplied: false });
    totalNrTax += nrTax;
    totalNrWages += nrWages;
  }

  // Resident state tax on worldwide AGI (full computation, with state-specific options)
  const residentTaxFull = calculateStateTax(
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
  const residentCreditApplied = Math.min(totalNrTax, residentCreditCap);
  const residentStateTax = Math.max(0, residentTaxFull - residentCreditApplied);

  return {
    residentStateTax,
    nonresidentStateTaxes,
    totalStateTax: residentStateTax + totalNrTax,
    residentCreditApplied,
    residentStateTaxBeforeCredit: residentTaxFull,
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
    /** Taxpayer age — gates state retirement exemption (PA, MS require 59½+) */
    taxpayerAge?: number;
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

  // PA / IL / MS: subtract qualified retirement income (age-gated for PA, MS)
  const retirementExemption = getStateRetirementExemption({
    stateCode: code,
    retirementIncome: options?.retirementIncomeForExemption ?? 0,
    taxpayerAge: options?.taxpayerAge,
  }).exemption;

  const stateTaxable = Math.max(0, federalAgi - stdDed - oregonSubtraction - retirementExemption);
  const brackets = pickStateBrackets(info.brackets, status);
  let tax = applyBrackets(stateTaxable, brackets);

  // Apply surtax (e.g. MA millionaire's tax, CA mental health 1% over $1M)
  if (info.surtax && federalAgi > info.surtax.threshold) {
    tax += (federalAgi - info.surtax.threshold) * info.surtax.rate;
  }
  return Math.max(0, tax);
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
  const fedStdDeduction = getFederalStandardDeduction(filingStatus, year);
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
  /** Charitable deductible (cash + property, with AGI limits) */
  charitableDeductible: number;
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
  const { medicalExpenses = 0, stateIncomeTax = 0, statePropertyTax = 0, stateSalesTax = 0, mortgageInterest = 0, charitableCash = 0, charitableProperty = 0 } = inputs;

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

  // Charitable contributions with AGI limits
  const cashDeductible = Math.min(charitableCash, agi * CHARITABLE_CASH_AGI_LIMIT);
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
  iraContribution: number;
  iraLimit: number;
  iraDeductible: number;
  iraPhaseOutFraction: number;
}

export function calculateRetirementDeductions(params: {
  hsaContribution: number;
  hsaIsFamilyCoverage: boolean;
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
  const hsaDeductible = Math.min(Math.max(0, params.hsaContribution), hsaLimit);

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
// Above the threshold, real Form 1116 limits credit to (foreign source income
// / total taxable income) × US tax. We don't model the Form 1116 limitation;
// we apply the full foreign-tax-paid amount and flag the approximation.
const FTC_SIMPLIFIED_LIMIT_SINGLE = 300;
const FTC_SIMPLIFIED_LIMIT_MFJ = 600;

export interface ForeignTaxCreditCalculation {
  foreignTaxPaid: number;
  filingStatus: string;
  simplifiedLimit: number;
  usedSimplifiedPath: boolean;
  exceededSimplifiedLimit: boolean;
  credit: number;
}

export function calculateForeignTaxCredit(params: {
  foreignTaxPaid: number;
  filingStatus: string;
}): ForeignTaxCreditCalculation {
  const isMfj =
    params.filingStatus === "married_filing_jointly" ||
    params.filingStatus === "qualifying_widow";
  const simplifiedLimit = isMfj ? FTC_SIMPLIFIED_LIMIT_MFJ : FTC_SIMPLIFIED_LIMIT_SINGLE;
  const amount = Math.max(0, params.foreignTaxPaid);
  const exceededSimplifiedLimit = amount > simplifiedLimit;

  return {
    foreignTaxPaid: amount,
    filingStatus: params.filingStatus,
    simplifiedLimit,
    usedSimplifiedPath: !exceededSimplifiedLimit,
    exceededSimplifiedLimit,
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
export function calculateFederalTaxWithCapitalGains(params: {
  ordinaryTaxableIncome: number;
  longTermGains: number;
  qualifiedDividends: number;
  shortTermGains: number;
  filingStatus: string;
  taxYear: number;
}): CapitalGainsCalculation {
  const year = resolveTaxYear(params.taxYear);
  const status = params.filingStatus in FEDERAL_BRACKETS[year] ? params.filingStatus : "single";
  const ltcgIncluded = Math.max(0, params.longTermGains) + Math.max(0, params.qualifiedDividends);
  const ordinaryWithStcg = Math.max(0, params.ordinaryTaxableIncome) + Math.max(0, params.shortTermGains);

  // Ordinary tax on the ordinary-income portion (incl. STCG)
  const ordinaryTax = calculateFederalTax(ordinaryWithStcg, status, year);

  // Preferential tax: LTCG/qualified dividends "stack" on top of ordinary income.
  // For each LTCG bracket, the portion of LTCG that falls in [max(ordinaryWithStcg, prevCap), bracketCap]
  // is taxed at that bracket's rate.
  const ltcgBrackets = LTCG_BRACKETS[year][status];
  let prefTax = 0;
  let prevCap = 0;
  let ltcgRemaining = ltcgIncluded;
  for (const bracket of ltcgBrackets) {
    if (ltcgRemaining <= 0) break;
    // The taxable portion within this bracket is the slice above max(ordinaryWithStcg, prevCap)
    const lower = Math.max(ordinaryWithStcg, prevCap);
    const upper = Math.min(ordinaryWithStcg + ltcgIncluded, bracket.upTo);
    const slice = Math.max(0, upper - lower);
    if (slice > 0) {
      prefTax += slice * bracket.rate;
      ltcgRemaining -= slice;
    }
    prevCap = bracket.upTo;
  }

  return {
    ordinaryTaxableIncome: params.ordinaryTaxableIncome,
    longTermGains: params.longTermGains,
    shortTermGains: params.shortTermGains,
    qualifiedDividends: params.qualifiedDividends,
    preferentialRateTax: prefTax,
    totalFederalTax: ordinaryTax + prefTax,
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
}

export function calculateSelfEmploymentTax(
  seIncome: number,
  taxYear: number,
): SeTaxCalculation {
  const year = resolveTaxYear(taxYear);
  if (seIncome <= 0) {
    return { seIncomeReported: seIncome, netSeEarnings: 0, socialSecurityPortion: 0, medicarePortion: 0, seTaxTotal: 0, deductibleHalf: 0 };
  }
  // Form Schedule SE: net SE earnings = gross × 92.35%
  const netSeEarnings = seIncome * SE_NET_EARNINGS_FACTOR;
  // Below the SS wage base threshold: charged 12.4% SS + 2.9% Medicare on full net earnings.
  // Above: only Medicare applies on the excess.
  const ssBase = SS_WAGE_BASE[year];
  const ssPortion = Math.min(netSeEarnings, ssBase) * SS_RATE;
  const medicarePortion = netSeEarnings * MEDICARE_RATE;
  const seTaxTotal = ssPortion + medicarePortion;
  return {
    seIncomeReported: seIncome,
    netSeEarnings,
    socialSecurityPortion: ssPortion,
    medicarePortion,
    seTaxTotal,
    deductibleHalf: seTaxTotal / 2,
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
}

export function calculateAmt(params: {
  taxableIncome: number;
  amtPreferences: number;
  filingStatus: string;
  regularTax: number;
  taxYear: number;
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
  const amtBeforeRegular =
    amtBase <= data.rateBreakpoint
      ? amtBase * 0.26
      : data.rateBreakpoint * 0.26 + (amtBase - data.rateBreakpoint) * 0.28;
  const amtTax = Math.max(0, amtBeforeRegular - regularTax);
  return { amti, exemption, amtBeforeRegular, regularTax, amtTax };
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
