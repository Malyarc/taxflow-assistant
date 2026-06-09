// ───────────────────────────────────────────────────────────────────────────
// Schedule H — Household Employment Taxes (T1.2)
//
// A taxpayer who pays a household employee (nanny, housekeeper, in-home aide…)
// cash wages at or above the annual threshold owes the employer + employee share
// of Social Security & Medicare (FICA) plus federal unemployment (FUTA). Reported
// on Schedule H → Schedule 2 line 9 → added to total tax (an employment tax, NOT
// offset by non-refundable income-tax credits).
//
// Pure module (no Date/random/DB) — part of the Haven migration seam.
//
// Primary sources (IRS Schedule H + Pub 926):
//   • FICA: when cash wages ≥ the annual threshold ($2,700 for 2024, $2,800 for
//     2025), the FULL cash wages are subject to 12.4% Social Security (up to the
//     SS wage base) + 2.9% Medicare = 15.3%.
//   • Additional Medicare: 0.9% on cash wages over $200,000 (employer must
//     withhold; flat threshold, not filing-status indexed).
//   • FUTA: 0.6% net rate (after the 5.4% state credit) on the first $7,000 of
//     cash wages per employee, owed when total household cash wages ≥ $1,000 in
//     any calendar quarter.
//
// Scope (documented sub-gaps): aggregate single-employee model (multi-employee
// per-$7,000 FUTA bases + per-state credit-reduction states are the CPA's
// refinement); assumes the full 5.4% FUTA state credit (net 0.6%).
// ───────────────────────────────────────────────────────────────────────────

import { SS_WAGE_BASE, resolveTaxYear, type TaxYear } from "./taxCalculator";

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Annual cash-wage threshold that triggers FICA (SSA-indexed).
const SS_MEDICARE_THRESHOLD: Record<TaxYear, number> = {
  2024: 2700,
  2025: 2800,
  2026: 2800, // PROVISIONAL — confirm the SSA 2026 household-employee threshold.
};
const FUTA_WAGE_BASE = 7000;
const FUTA_NET_RATE = 0.006; // 6.0% gross − 5.4% max state credit
const FUTA_TRIGGER = 1000; // FUTA owed if cash wages ≥ $1,000 in any quarter
const ADDL_MEDICARE_THRESHOLD = 200000;

export interface ScheduleHResult {
  /** Total Schedule H tax (FICA + FUTA + additional Medicare). */
  total: number;
  socialSecurityTax: number;
  medicareTax: number;
  additionalMedicareTax: number;
  futaTax: number;
  /** True when cash wages met the FICA threshold. */
  ficaApplies: boolean;
  cashWages: number;
}

const EMPTY: ScheduleHResult = {
  total: 0, socialSecurityTax: 0, medicareTax: 0, additionalMedicareTax: 0,
  futaTax: 0, ficaApplies: false, cashWages: 0,
};

/**
 * Compute Schedule H household employment tax.
 *
 * @param cashWages       total cash wages paid to household employee(s).
 * @param taxYear         tax year.
 * @param futaWagesOverride  optional FUTA-eligible wage base (multi-employee:
 *                        sum of min($7,000, each employee's wages)).
 */
export function calculateScheduleH(params: {
  cashWages: number;
  taxYear: number;
  futaWagesOverride?: number;
}): ScheduleHResult {
  const cashWages = Math.max(0, num(params.cashWages));
  if (cashWages <= 0) return { ...EMPTY };
  const year = resolveTaxYear(params.taxYear);
  const threshold = SS_MEDICARE_THRESHOLD[year];
  const ssWageBase = SS_WAGE_BASE[year];

  let socialSecurityTax = 0;
  let medicareTax = 0;
  let additionalMedicareTax = 0;
  const ficaApplies = cashWages >= threshold;
  if (ficaApplies) {
    socialSecurityTax = round2(Math.min(cashWages, ssWageBase) * 0.124);
    medicareTax = round2(cashWages * 0.029);
    additionalMedicareTax = round2(Math.max(0, cashWages - ADDL_MEDICARE_THRESHOLD) * 0.009);
  }

  const futaWages =
    params.futaWagesOverride != null && params.futaWagesOverride > 0
      ? num(params.futaWagesOverride)
      : Math.min(cashWages, FUTA_WAGE_BASE);
  const futaTax = cashWages >= FUTA_TRIGGER ? round2(futaWages * FUTA_NET_RATE) : 0;

  const total = round2(socialSecurityTax + medicareTax + additionalMedicareTax + futaTax);
  return { total, socialSecurityTax, medicareTax, additionalMedicareTax, futaTax, ficaApplies, cashWages };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
