// 2024 Federal tax brackets
const FEDERAL_BRACKETS_2024: Record<string, Array<{ min: number; max: number; rate: number }>> = {
  single: [
    { min: 0, max: 11600, rate: 0.10 },
    { min: 11600, max: 47150, rate: 0.12 },
    { min: 47150, max: 100525, rate: 0.22 },
    { min: 100525, max: 191950, rate: 0.24 },
    { min: 191950, max: 243725, rate: 0.32 },
    { min: 243725, max: 609350, rate: 0.35 },
    { min: 609350, max: Infinity, rate: 0.37 },
  ],
  married_filing_jointly: [
    { min: 0, max: 23200, rate: 0.10 },
    { min: 23200, max: 94300, rate: 0.12 },
    { min: 94300, max: 201050, rate: 0.22 },
    { min: 201050, max: 383900, rate: 0.24 },
    { min: 383900, max: 487450, rate: 0.32 },
    { min: 487450, max: 731200, rate: 0.35 },
    { min: 731200, max: Infinity, rate: 0.37 },
  ],
  married_filing_separately: [
    { min: 0, max: 11600, rate: 0.10 },
    { min: 11600, max: 47150, rate: 0.12 },
    { min: 47150, max: 100525, rate: 0.22 },
    { min: 100525, max: 191950, rate: 0.24 },
    { min: 191950, max: 243725, rate: 0.32 },
    { min: 243725, max: 365600, rate: 0.35 },
    { min: 365600, max: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { min: 0, max: 16550, rate: 0.10 },
    { min: 16550, max: 63100, rate: 0.12 },
    { min: 63100, max: 100500, rate: 0.22 },
    { min: 100500, max: 191950, rate: 0.24 },
    { min: 191950, max: 243700, rate: 0.32 },
    { min: 243700, max: 609350, rate: 0.35 },
    { min: 609350, max: Infinity, rate: 0.37 },
  ],
  qualifying_widow: [
    { min: 0, max: 23200, rate: 0.10 },
    { min: 23200, max: 94300, rate: 0.12 },
    { min: 94300, max: 201050, rate: 0.22 },
    { min: 201050, max: 383900, rate: 0.24 },
    { min: 383900, max: 487450, rate: 0.32 },
    { min: 487450, max: 731200, rate: 0.35 },
    { min: 731200, max: Infinity, rate: 0.37 },
  ],
};

// 2024 Standard deductions
const STANDARD_DEDUCTIONS_2024: Record<string, number> = {
  single: 14600,
  married_filing_jointly: 29200,
  married_filing_separately: 14600,
  head_of_household: 21900,
  qualifying_widow: 29200,
};

// Approximate state tax rates (flat rate approximation for common states)
const STATE_TAX_RATES: Record<string, number> = {
  AL: 0.05, AK: 0.00, AZ: 0.025, AR: 0.047, CA: 0.093, CO: 0.044,
  CT: 0.069, DE: 0.066, FL: 0.00, GA: 0.055, HI: 0.11, ID: 0.058,
  IL: 0.0495, IN: 0.0315, IA: 0.06, KS: 0.057, KY: 0.045, LA: 0.042,
  ME: 0.075, MD: 0.0575, MA: 0.05, MI: 0.0425, MN: 0.0985, MS: 0.05,
  MO: 0.054, MT: 0.069, NE: 0.068, NV: 0.00, NH: 0.00, NJ: 0.0897,
  NM: 0.059, NY: 0.0685, NC: 0.0499, ND: 0.029, OH: 0.04, OK: 0.05,
  OR: 0.099, PA: 0.0307, RI: 0.0599, SC: 0.07, SD: 0.00, TN: 0.00,
  TX: 0.00, UT: 0.0485, VT: 0.0875, VA: 0.0575, WA: 0.00, WV: 0.065,
  WI: 0.0765, WY: 0.00, DC: 0.0895,
};

export function calculateFederalTax(taxableIncome: number, filingStatus: string): number {
  const brackets = FEDERAL_BRACKETS_2024[filingStatus] ?? FEDERAL_BRACKETS_2024.single;
  let tax = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= bracket.min) break;
    const taxableInBracket = Math.min(taxableIncome, bracket.max) - bracket.min;
    tax += taxableInBracket * bracket.rate;
  }
  return Math.max(0, tax);
}

export function calculateStateTax(taxableIncome: number, stateCode: string): number {
  const rate = STATE_TAX_RATES[stateCode.toUpperCase()] ?? 0.05;
  return Math.max(0, taxableIncome * rate);
}

export function getStandardDeduction(filingStatus: string): number {
  return STANDARD_DEDUCTIONS_2024[filingStatus] ?? STANDARD_DEDUCTIONS_2024.single;
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
  const { totalWages, additionalIncome, filingStatus, stateCode, useItemizedDeductions, itemizedDeductions, adjustments } = params;

  const totalIncome = totalWages + additionalIncome;
  const adjustedGrossIncome = Math.max(0, totalIncome - adjustments);
  const standardDeduction = getStandardDeduction(filingStatus);
  const deduction = useItemizedDeductions ? Math.max(itemizedDeductions, standardDeduction) : standardDeduction;
  const taxableIncome = Math.max(0, adjustedGrossIncome - deduction);

  const federalTaxLiability = calculateFederalTax(taxableIncome, filingStatus);
  const stateTaxLiability = calculateStateTax(taxableIncome, stateCode);

  const effectiveTaxRate = totalIncome > 0 ? (federalTaxLiability + stateTaxLiability) / totalIncome : 0;

  return {
    totalIncome,
    adjustedGrossIncome,
    standardDeduction: deduction,
    taxableIncome,
    federalTaxLiability,
    stateTaxLiability,
    effectiveTaxRate,
  };
}
