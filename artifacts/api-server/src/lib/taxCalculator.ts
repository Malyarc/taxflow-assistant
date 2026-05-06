/**
 * 2024 federal + state tax calculator.
 *
 * Federal: real 2024 IRS brackets and standard deductions (Rev. Proc. 2023-34).
 * State:   real 2024 brackets/std deductions for all 41 income-tax states + DC.
 *
 * Limitations (read before treating output as authoritative):
 *   - Federal: no AMT, no QBI, no EITC, no CTC math (use Adjustments tab for credits).
 *   - State: no state credits, exemptions, or local taxes (NYC, MD counties, OH cities). See stateTaxData.ts.
 *   - Calculator is for estimation; actual filings need professional software.
 */

import {
  STATE_TAX_DATA,
  type StateBracket,
  type StateFilingStatus,
} from "./stateTaxData";

// ── Federal: 2024 brackets (IRS Rev. Proc. 2023-34) ──────────────────────────
const FEDERAL_BRACKETS_2024: Record<string, StateBracket[]> = {
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
};

const FEDERAL_STANDARD_DEDUCTIONS_2024: Record<string, number> = {
  single: 14600,
  married_filing_jointly: 29200,
  married_filing_separately: 14600,
  head_of_household: 21900,
  qualifying_widow: 29200,
};

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

export function calculateFederalTax(taxableIncome: number, filingStatus: string): number {
  const brackets = FEDERAL_BRACKETS_2024[filingStatus] ?? FEDERAL_BRACKETS_2024.single;
  return Math.max(0, applyBrackets(taxableIncome, brackets));
}

export function getFederalStandardDeduction(filingStatus: string): number {
  return FEDERAL_STANDARD_DEDUCTIONS_2024[filingStatus] ?? FEDERAL_STANDARD_DEDUCTIONS_2024.single;
}

/**
 * Pick the best-fit bracket set from the state data, falling back to single
 * for MFS/HoH and to MFJ for QW when the state doesn't publish separate ones.
 */
function pickStateBrackets(
  state: NonNullable<(typeof STATE_TAX_DATA)[string]["brackets"]>,
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
  state: NonNullable<(typeof STATE_TAX_DATA)[string]["standardDeduction"]>,
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
 * Compute state tax liability using real 2024 brackets.
 * Pass federal AGI; the state-specific standard deduction is applied internally.
 */
export function calculateStateTax(
  federalAgi: number,
  stateCode: string,
  filingStatus: string,
): number {
  const info = STATE_TAX_DATA[stateCode.toUpperCase()];
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
}

export function runTaxCalculation(params: {
  totalWages: number;
  additionalIncome: number;
  filingStatus: string;
  stateCode: string;
  useItemizedDeductions: boolean;
  itemizedDeductions: number;
  adjustments: number;
}): TaxCalculationResult {
  const {
    totalWages,
    additionalIncome,
    filingStatus,
    stateCode,
    useItemizedDeductions,
    itemizedDeductions,
    adjustments,
  } = params;

  const totalIncome = totalWages + additionalIncome;
  const adjustedGrossIncome = Math.max(0, totalIncome - adjustments);
  const fedStdDeduction = getFederalStandardDeduction(filingStatus);
  const fedDeduction = useItemizedDeductions
    ? Math.max(itemizedDeductions, fedStdDeduction)
    : fedStdDeduction;
  const taxableIncome = Math.max(0, adjustedGrossIncome - fedDeduction);

  const federalTaxLiability = calculateFederalTax(taxableIncome, filingStatus);
  const stateTaxLiability = calculateStateTax(adjustedGrossIncome, stateCode, filingStatus);

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
  };
}

// Backwards-compat alias used by existing routes.
export function getStandardDeduction(filingStatus: string): number {
  return getFederalStandardDeduction(filingStatus);
}
