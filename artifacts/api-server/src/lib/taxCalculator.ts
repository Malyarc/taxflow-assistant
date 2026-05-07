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

/**
 * Compute state tax liability using brackets for the given year.
 * Pass federal AGI; the state-specific standard deduction is applied internally.
 */
export function calculateStateTax(
  federalAgi: number,
  stateCode: string,
  filingStatus: string,
  taxYear: number,
): number {
  const year = resolveTaxYear(taxYear);
  const yearData = STATE_TAX_DATA_BY_YEAR[year];
  const info = yearData[stateCode.toUpperCase()];
  if (!info || !info.hasIncomeTax || !info.brackets || !info.standardDeduction) {
    return 0;
  }
  const status = filingStatus as StateFilingStatus;
  const stdDed = pickStateStdDeduction(info.standardDeduction, status);
  const stateTaxable = Math.max(0, federalAgi - stdDed);
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
