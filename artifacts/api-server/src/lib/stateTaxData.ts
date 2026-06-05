/**
 * State income tax data — year-keyed brackets and standard deductions.
 *
 * SOURCES: State Department of Revenue official tables and Tax Foundation summaries.
 *   - 2024: real published brackets (TY2024 IRS conformity year)
 *   - 2025: real where states have published (CA, IN, KY, LA, MS, IA), otherwise 2024 brackets
 *           with federal-conforming standard deductions updated to 2025 values.
 *           UPDATE THESE VALUES AS STATES PUBLISH OFFICIAL 2025 TABLES.
 *
 * APPROXIMATIONS (read before using for anything real):
 *   - State taxable income = (federal AGI - state standard deduction). Real state calcs
 *     often start with federal AGI then apply state-specific modifications (e.g. state-tax-exempt
 *     bond interest, federal-tax-paid deduction in a few states, retirement-income exemptions, etc.)
 *     We do not model those.
 *   - Personal exemptions (state-specific, ~$1k-$5k per person) are NOT modeled. A few states
 *     use exemptions instead of (or alongside) a standard deduction.
 *   - State tax credits (EITC, CTC, etc.) are NOT modeled. Use the Adjustments tab as a workaround.
 *   - MFS brackets default to Single; HoH defaults to Single; QW defaults to MFJ unless the
 *     state publishes separate brackets.
 *   - Local/city taxes (e.g. NYC, San Francisco) are NOT included.
 *
 * Filing-status keys match the OpenAPI enum: single | married_filing_jointly |
 * married_filing_separately | head_of_household | qualifying_widow.
 */

export interface StateBracket {
  upTo: number; // upper bound for this bracket; Infinity for the top bracket
  rate: number; // marginal rate (e.g. 0.05 = 5%)
}

export type StateFilingStatus =
  | "single"
  | "married_filing_jointly"
  | "married_filing_separately"
  | "head_of_household"
  | "qualifying_widow";

export interface StateBrackets {
  single: StateBracket[];
  married_filing_jointly: StateBracket[];
  married_filing_separately?: StateBracket[];
  head_of_household?: StateBracket[];
  qualifying_widow?: StateBracket[];
}

export interface StateStandardDeduction {
  single: number;
  married_filing_jointly: number;
  married_filing_separately?: number;
  head_of_household?: number;
  qualifying_widow?: number;
}

import type { TaxYear } from "./taxYears";

export interface StateTaxInfo {
  name: string;
  hasIncomeTax: boolean;
  brackets?: StateBrackets;
  standardDeduction?: StateStandardDeduction;
  /** Per-filer personal exemption (e.g. VT $4,850/filer). Subtracts from state taxable income. */
  personalExemption?: StateStandardDeduction;
  /**
   * C3 follow-up (2026-05-27 PM) — Per-dependent personal exemption amount
   * (e.g. IL $2,775/dep, NJ $1,500/dep). Multiplied by `options.dependentCount`
   * in `calculateStateTax` and added to the filer/spouse exemption. Subject
   * to the same AGI cliff as personalExemption.
   */
  personalExemptionPerDependent?: number;
  /**
   * AGI cliff above which the personal exemption is reduced to $0 (per state
   * statute — e.g. IL-1040 Line 10b: AGI > $250k single / $500k MFJ → exemption = $0).
   * Each filing-status entry is the federal AGI threshold; > threshold means
   * exemption is entirely lost. This is a CLIFF, not a gradual phase-out.
   * For states with gradual phase-out (CT pension exemption, etc.), use a
   * dedicated handler — this field only encodes the cliff pattern.
   */
  personalExemptionAgiCliff?: StateStandardDeduction;
  /** Surtax on income above a threshold, e.g. MA "millionaire's tax". Applied on AGI. */
  surtax?: { threshold: number; rate: number };
  notes?: string;
}

const FED_STD_DEDUCTION_2024 = {
  single: 14600,
  married_filing_jointly: 29200,
  married_filing_separately: 14600,
  head_of_household: 21900,
  qualifying_widow: 29200,
};

// TY2025 std ded AS AMENDED BY OBBBA (P.L. 119-21) — matches the core engine's
// FEDERAL_STANDARD_DEDUCTIONS[2025]. Federal-conforming states use this so the
// invariant `AGI − stateStdDed = federalTaxableIncome` still holds (CLAUDE.md #4).
const FED_STD_DEDUCTION_2025 = {
  single: 15750,
  married_filing_jointly: 31500,
  married_filing_separately: 15750,
  head_of_household: 23625,
  qualifying_widow: 31500,
};

// TY2026 std ded per Rev. Proc. 2025-32 (matches core FEDERAL_STANDARD_DEDUCTIONS[2026]).
const FED_STD_DEDUCTION_2026 = {
  single: 16100,
  married_filing_jointly: 32200,
  married_filing_separately: 16100,
  head_of_household: 24150,
  qualifying_widow: 32200,
};

// States whose standard deduction is explicitly tied to the federal value (auto-updates each year).
// Iowa was added 2026-05 — its 2023+ tax reform replaced the historical small IA std deduction
// with conformity to the federal standard deduction (IA Code §422.9).
const FED_CONFORMING_STD_DED_STATES = new Set([
  "CO", "ID", "IA", "MN", "MO", "MT", "NM", "ND", "SC",
]);

// K10 state-SS exclusion — states that TAX Social Security benefits (the
// federally-taxable portion). Federal AGI includes the federally-taxable
// portion of SS; states NOT in this set exempt SS from their state-tax base.
// Source: Tax Foundation state-by-state SS taxation table (TY2024 current).
// CT: phases out — full exclusion below $75k single / $100k MFJ; partial up
//   to higher AGI; we approximate as fully-taxing (conservative — over-taxes
//   CT filers below $75k single). Sub-gap documented.
// All other 41 jurisdictions (40 states + DC) exempt SS at the state level.
export const STATES_TAXING_SS = new Set([
  "CO", "CT", "KS", "MN", "MT", "NM", "RI", "UT", "VT",
]);

// ── Multi-state reciprocity agreements ─────────────────────────────────────
// If filer resides in a STATE and works in a state listed in their value array,
// the WORK state does NOT tax the wages — only the resident state taxes them.
// Sources: state DOR reciprocity bulletins (current as of TY2024).
// Note: most agreements require the filer to file a non-resident certificate
// with their employer (e.g., NJ-165, PA Form REV-419, IL IL-W-5-NR). We
// assume that paperwork is filed correctly.
export const STATE_RECIPROCITY: Record<string, readonly string[]> = {
  DC: ["MD", "VA"],
  IL: ["IA", "KY", "MI", "WI"],
  IN: ["KY", "MI", "OH", "PA", "WI"],
  IA: ["IL"],
  KY: ["IL", "IN", "MI", "OH", "VA", "WV", "WI"],
  MD: ["DC", "PA", "VA", "WV"],
  MI: ["IL", "IN", "KY", "MN", "OH", "WI"],
  MN: ["MI", "ND"],
  MT: ["ND"],
  NJ: ["PA"],
  ND: ["MN", "MT"],
  OH: ["IN", "KY", "MI", "PA", "WV"],
  PA: ["IN", "MD", "NJ", "OH", "VA", "WV"],
  VA: ["DC", "KY", "MD", "PA", "WV"],
  WV: ["KY", "MD", "OH", "PA", "VA"],
  WI: ["IL", "IN", "KY", "MI"],
};

/**
 * Returns true if a resident of `residentState` who works in `workState`
 * is covered by a reciprocity agreement (workState does not tax).
 */
export function hasReciprocity(residentState: string, workState: string): boolean {
  const list = STATE_RECIPROCITY[residentState.toUpperCase()];
  if (!list) return false;
  return list.includes(workState.toUpperCase());
}

// Helper for flat-rate states: build a single-bracket structure.
const flat = (rate: number): StateBracket[] => [{ upTo: Infinity, rate }];

const STATE_TAX_DATA_2024: Record<string, StateTaxInfo> = {
  // ── No income tax (or wages-exempt) ──────────────────────────────────────
  AK: { name: "Alaska", hasIncomeTax: false },
  FL: { name: "Florida", hasIncomeTax: false },
  NV: { name: "Nevada", hasIncomeTax: false },
  NH: { name: "New Hampshire", hasIncomeTax: false, notes: "Taxes interest/dividends only (3% in 2024); $0 on wages." },
  SD: { name: "South Dakota", hasIncomeTax: false },
  TN: { name: "Tennessee", hasIncomeTax: false },
  TX: { name: "Texas", hasIncomeTax: false },
  WA: { name: "Washington", hasIncomeTax: false, notes: "7% capital-gains tax >$262k exists; no wage tax." },
  WY: { name: "Wyoming", hasIncomeTax: false },

  // ── Flat-rate states ─────────────────────────────────────────────────────
  AZ: {
    name: "Arizona", hasIncomeTax: true,
    brackets: { single: flat(0.025), married_filing_jointly: flat(0.025) },
    standardDeduction: { single: 14600, married_filing_jointly: 29200, head_of_household: 21900 },
  },
  CO: {
    name: "Colorado", hasIncomeTax: true,
    brackets: { single: flat(0.044), married_filing_jointly: flat(0.044) },
    standardDeduction: { single: FED_STD_DEDUCTION_2024.single, married_filing_jointly: FED_STD_DEDUCTION_2024.married_filing_jointly, head_of_household: FED_STD_DEDUCTION_2024.head_of_household, married_filing_separately: FED_STD_DEDUCTION_2024.married_filing_separately, qualifying_widow: FED_STD_DEDUCTION_2024.qualifying_widow },
    notes: "CO uses federal taxable income as the starting point.",
  },
  GA: {
    name: "Georgia", hasIncomeTax: true,
    brackets: { single: flat(0.0539), married_filing_jointly: flat(0.0539) },
    standardDeduction: { single: 12000, married_filing_jointly: 24000, head_of_household: 12000, married_filing_separately: 12000 },
    notes: "GA switched to flat 5.39% for TY2024.",
  },
  ID: {
    name: "Idaho", hasIncomeTax: true,
    brackets: { single: flat(0.058), married_filing_jointly: flat(0.058) },
    standardDeduction: { single: FED_STD_DEDUCTION_2024.single, married_filing_jointly: FED_STD_DEDUCTION_2024.married_filing_jointly, head_of_household: FED_STD_DEDUCTION_2024.head_of_household, married_filing_separately: FED_STD_DEDUCTION_2024.married_filing_separately, qualifying_widow: FED_STD_DEDUCTION_2024.qualifying_widow },
  },
  IL: {
    name: "Illinois", hasIncomeTax: true,
    brackets: { single: flat(0.0495), married_filing_jointly: flat(0.0495) },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    // Personal exemption per IL-1040 2024 Line 10b: $2,775 per person.
    // We apply single = $2,775; MFJ = $5,550 (×2). Dependent exemptions
    // ($2,775 each) NOT modeled — CPA can enter manually as a deduction
    // override. AGI CLIFF: IL-1040 2024 Line 10b instructions state the
    // exemption is reduced to $0 (cliff, not gradual phase-out) when:
    //   - Federal AGI > $250,000 (single, HoH, MFS, QSS)
    //   - Federal AGI > $500,000 (MFJ)
    // Engine applies this cliff via personalExemptionAgiCliff below.
    personalExemption: { single: 2775, married_filing_jointly: 5550, head_of_household: 2775, married_filing_separately: 2775, qualifying_widow: 5550 },
    // C3 follow-up (2026-05-27 PM): $2,775 per dependent now modeled.
    personalExemptionPerDependent: 2775,
    personalExemptionAgiCliff: { single: 250000, married_filing_jointly: 500000, head_of_household: 250000, married_filing_separately: 250000, qualifying_widow: 250000 },
    notes: "IL flat 4.95% with $2,775 personal exemption (filer/spouse + each dependent); cliffs to $0 at AGI > $250k single / $500k MFJ per IL-1040 Line 10b. Dependents added 2026-05-27 PM (C3 finding 9.2).",
  },
  IN: {
    name: "Indiana", hasIncomeTax: true,
    brackets: { single: flat(0.0305), married_filing_jointly: flat(0.0305) },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    // IC 6-3-1-3.5(a): $1,000 personal exemption per filer ($2,000 MFJ) + $1,000
    // per dependent (IT-40 Schedule 3). Amounts are statutory (same 2024/2025).
    personalExemption: { single: 1000, married_filing_jointly: 2000, head_of_household: 1000, married_filing_separately: 1000, qualifying_widow: 2000 },
    personalExemptionPerDependent: 1000,
    notes: "IN: $1,000/filer ($2,000 MFJ) + $1,000/dependent (IC 6-3-1-3.5(a)). Local county taxes also apply. Sub-gaps: additional $1,500/qualifying-child (IT-40 Sched 3 Line 3), $3,000/adopted-child, and age-65+/blind add-ons not modeled.",
  },
  KY: {
    name: "Kentucky", hasIncomeTax: true,
    brackets: { single: flat(0.04), married_filing_jointly: flat(0.04) },
    standardDeduction: { single: 3160, married_filing_jointly: 3160 },
  },
  MA: {
    name: "Massachusetts", hasIncomeTax: true,
    brackets: { single: flat(0.05), married_filing_jointly: flat(0.05) },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    surtax: { threshold: 1053750, rate: 0.04 },
    notes: "5% flat + 4% surtax on AGI over $1,053,750 (2024 'millionaire's tax'). MA uses personal exemptions, not std deduction.",
  },
  MI: {
    name: "Michigan", hasIncomeTax: true,
    brackets: { single: flat(0.0425), married_filing_jointly: flat(0.0425) },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    notes: "MI: $5,600 personal exemption (not modeled).",
  },
  MS: {
    name: "Mississippi", hasIncomeTax: true,
    // 2024: 4.7% on income over $10,000 (first $10k exempt for everyone — modeled as deduction)
    brackets: {
      single: [{ upTo: Infinity, rate: 0.047 }],
      married_filing_jointly: [{ upTo: Infinity, rate: 0.047 }],
    },
    standardDeduction: { single: 12300, married_filing_jointly: 24600, head_of_household: 18300 },
    notes: "First $10k of taxable income is exempt; we fold this into a higher std deduction approximation.",
  },
  NC: {
    name: "North Carolina", hasIncomeTax: true,
    brackets: { single: flat(0.045), married_filing_jointly: flat(0.045) },
    standardDeduction: { single: 12750, married_filing_jointly: 25500, head_of_household: 19125, married_filing_separately: 12750 },
  },
  PA: {
    name: "Pennsylvania", hasIncomeTax: true,
    brackets: { single: flat(0.0307), married_filing_jointly: flat(0.0307) },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    notes: "PA has no standard deduction or personal exemption.",
  },
  UT: {
    name: "Utah", hasIncomeTax: true,
    brackets: { single: flat(0.0455), married_filing_jointly: flat(0.0455) },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    notes: "UT: taxpayer credit replaces std deduction (not modeled).",
  },

  // ── Progressive states ───────────────────────────────────────────────────
  AL: {
    name: "Alabama", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 500, rate: 0.02 }, { upTo: 3000, rate: 0.04 }, { upTo: Infinity, rate: 0.05 }],
      married_filing_jointly: [{ upTo: 1000, rate: 0.02 }, { upTo: 6000, rate: 0.04 }, { upTo: Infinity, rate: 0.05 }],
    },
    standardDeduction: { single: 3000, married_filing_jointly: 8500, head_of_household: 5200, married_filing_separately: 4250 },
    notes: "AL std deduction phases out at higher AGI; we use the maximum.",
  },
  AR: {
    name: "Arkansas", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 4500, rate: 0.02 }, { upTo: 8900, rate: 0.04 }, { upTo: Infinity, rate: 0.039 }],
      married_filing_jointly: [{ upTo: 4500, rate: 0.02 }, { upTo: 8900, rate: 0.04 }, { upTo: Infinity, rate: 0.039 }],
    },
    standardDeduction: { single: 2340, married_filing_jointly: 4680 },
    notes: "AR top rate 3.9% as of TY2024; complex bracket switching above $89,600 — using simplified version.",
  },
  CA: {
    name: "California", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 10756, rate: 0.01 },
        { upTo: 25499, rate: 0.02 },
        { upTo: 40245, rate: 0.04 },
        { upTo: 55866, rate: 0.06 },
        { upTo: 70606, rate: 0.08 },
        { upTo: 360659, rate: 0.093 },
        { upTo: 432787, rate: 0.103 },
        { upTo: 721314, rate: 0.113 },
        { upTo: Infinity, rate: 0.123 },
      ],
      married_filing_jointly: [
        { upTo: 21512, rate: 0.01 },
        { upTo: 50998, rate: 0.02 },
        { upTo: 80490, rate: 0.04 },
        { upTo: 111732, rate: 0.06 },
        { upTo: 141212, rate: 0.08 },
        { upTo: 721318, rate: 0.093 },
        { upTo: 865574, rate: 0.103 },
        { upTo: 1442628, rate: 0.113 },
        { upTo: Infinity, rate: 0.123 },
      ],
      head_of_household: [
        { upTo: 21527, rate: 0.01 },
        { upTo: 51000, rate: 0.02 },
        { upTo: 65744, rate: 0.04 },
        { upTo: 81364, rate: 0.06 },
        { upTo: 96107, rate: 0.08 },
        { upTo: 490493, rate: 0.093 },
        { upTo: 588593, rate: 0.103 },
        { upTo: 980987, rate: 0.113 },
        { upTo: Infinity, rate: 0.123 },
      ],
    },
    standardDeduction: { single: 5540, married_filing_jointly: 11080, head_of_household: 11080, married_filing_separately: 5540 },
    surtax: { threshold: 1000000, rate: 0.01 },
    notes: "Mental Health Services 1% surtax on income over $1M is applied on top.",
  },
  CT: {
    name: "Connecticut", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 10000, rate: 0.02 },
        { upTo: 50000, rate: 0.045 },
        { upTo: 100000, rate: 0.055 },
        { upTo: 200000, rate: 0.06 },
        { upTo: 250000, rate: 0.065 },
        { upTo: 500000, rate: 0.069 },
        { upTo: Infinity, rate: 0.0699 },
      ],
      married_filing_jointly: [
        { upTo: 20000, rate: 0.02 },
        { upTo: 100000, rate: 0.045 },
        { upTo: 200000, rate: 0.055 },
        { upTo: 400000, rate: 0.06 },
        { upTo: 500000, rate: 0.065 },
        { upTo: 1000000, rate: 0.069 },
        { upTo: Infinity, rate: 0.0699 },
      ],
    },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    notes: "CT has personal exemption + tax credit phase-outs (not modeled).",
  },
  DC: {
    name: "District of Columbia", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 10000, rate: 0.04 },
        { upTo: 40000, rate: 0.06 },
        { upTo: 60000, rate: 0.065 },
        { upTo: 250000, rate: 0.085 },
        { upTo: 500000, rate: 0.0925 },
        { upTo: 1000000, rate: 0.0975 },
        { upTo: Infinity, rate: 0.1075 },
      ],
      married_filing_jointly: [
        { upTo: 10000, rate: 0.04 },
        { upTo: 40000, rate: 0.06 },
        { upTo: 60000, rate: 0.065 },
        { upTo: 250000, rate: 0.085 },
        { upTo: 500000, rate: 0.0925 },
        { upTo: 1000000, rate: 0.0975 },
        { upTo: Infinity, rate: 0.1075 },
      ],
    },
    standardDeduction: { single: 14600, married_filing_jointly: 29200, head_of_household: 21900, married_filing_separately: 14600 },
  },
  DE: {
    name: "Delaware", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 2000, rate: 0 },
        { upTo: 5000, rate: 0.022 },
        { upTo: 10000, rate: 0.039 },
        { upTo: 20000, rate: 0.048 },
        { upTo: 25000, rate: 0.052 },
        { upTo: 60000, rate: 0.0555 },
        { upTo: Infinity, rate: 0.066 },
      ],
      married_filing_jointly: [
        { upTo: 2000, rate: 0 },
        { upTo: 5000, rate: 0.022 },
        { upTo: 10000, rate: 0.039 },
        { upTo: 20000, rate: 0.048 },
        { upTo: 25000, rate: 0.052 },
        { upTo: 60000, rate: 0.0555 },
        { upTo: Infinity, rate: 0.066 },
      ],
    },
    standardDeduction: { single: 3250, married_filing_jointly: 6500 },
  },
  HI: {
    name: "Hawaii", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 2400, rate: 0.014 },
        { upTo: 4800, rate: 0.032 },
        { upTo: 9600, rate: 0.055 },
        { upTo: 14400, rate: 0.064 },
        { upTo: 19200, rate: 0.068 },
        { upTo: 24000, rate: 0.072 },
        { upTo: 36000, rate: 0.076 },
        { upTo: 48000, rate: 0.079 },
        { upTo: 150000, rate: 0.0825 },
        { upTo: 175000, rate: 0.09 },
        { upTo: 200000, rate: 0.1 },
        { upTo: Infinity, rate: 0.11 },
      ],
      married_filing_jointly: [
        { upTo: 4800, rate: 0.014 },
        { upTo: 9600, rate: 0.032 },
        { upTo: 19200, rate: 0.055 },
        { upTo: 28800, rate: 0.064 },
        { upTo: 38400, rate: 0.068 },
        { upTo: 48000, rate: 0.072 },
        { upTo: 72000, rate: 0.076 },
        { upTo: 96000, rate: 0.079 },
        { upTo: 300000, rate: 0.0825 },
        { upTo: 350000, rate: 0.09 },
        { upTo: 400000, rate: 0.1 },
        { upTo: Infinity, rate: 0.11 },
      ],
    },
    standardDeduction: { single: 4400, married_filing_jointly: 8800, head_of_household: 6424, married_filing_separately: 4400 },
  },
  IA: {
    name: "Iowa", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 6210, rate: 0.044 }, { upTo: 31050, rate: 0.0482 }, { upTo: Infinity, rate: 0.057 }],
      married_filing_jointly: [{ upTo: 12420, rate: 0.044 }, { upTo: 62100, rate: 0.0482 }, { upTo: Infinity, rate: 0.057 }],
    },
    // IA TY2023+ reform conforms IA's standard deduction to the federal value (IA Code §422.9).
    // build2025Data() auto-bumps to the 2025 federal std ded via FED_CONFORMING_STD_DED_STATES.
    standardDeduction: { ...FED_STD_DEDUCTION_2024 },
    notes: "IA top rate 5.7% for 2024 (becomes flat 3.8% in 2025). Std deduction mirrors federal (post-2023 reform).",
  },
  KS: {
    name: "Kansas", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 15000, rate: 0.031 }, { upTo: 30000, rate: 0.0525 }, { upTo: Infinity, rate: 0.057 }],
      married_filing_jointly: [{ upTo: 30000, rate: 0.031 }, { upTo: 60000, rate: 0.0525 }, { upTo: Infinity, rate: 0.057 }],
    },
    standardDeduction: { single: 3500, married_filing_jointly: 8000, head_of_household: 6000 },
  },
  LA: {
    name: "Louisiana", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 12500, rate: 0.0185 }, { upTo: 50000, rate: 0.035 }, { upTo: Infinity, rate: 0.0425 }],
      married_filing_jointly: [{ upTo: 25000, rate: 0.0185 }, { upTo: 100000, rate: 0.035 }, { upTo: Infinity, rate: 0.0425 }],
    },
    standardDeduction: { single: 4500, married_filing_jointly: 9000 },
    notes: "LA TY2024 rates; switched to 3% flat for 2025.",
  },
  ME: {
    name: "Maine", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 26050, rate: 0.058 }, { upTo: 61600, rate: 0.0675 }, { upTo: Infinity, rate: 0.0715 }],
      married_filing_jointly: [{ upTo: 52100, rate: 0.058 }, { upTo: 123250, rate: 0.0675 }, { upTo: Infinity, rate: 0.0715 }],
    },
    standardDeduction: { single: 14600, married_filing_jointly: 29200, head_of_household: 21900, married_filing_separately: 14600 },
  },
  MD: {
    name: "Maryland", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 1000, rate: 0.02 },
        { upTo: 2000, rate: 0.03 },
        { upTo: 3000, rate: 0.04 },
        { upTo: 100000, rate: 0.0475 },
        { upTo: 125000, rate: 0.05 },
        { upTo: 150000, rate: 0.0525 },
        { upTo: 250000, rate: 0.055 },
        { upTo: Infinity, rate: 0.0575 },
      ],
      married_filing_jointly: [
        { upTo: 1000, rate: 0.02 },
        { upTo: 2000, rate: 0.03 },
        { upTo: 3000, rate: 0.04 },
        { upTo: 150000, rate: 0.0475 },
        { upTo: 175000, rate: 0.05 },
        { upTo: 225000, rate: 0.0525 },
        { upTo: 300000, rate: 0.055 },
        { upTo: Infinity, rate: 0.0575 },
      ],
    },
    standardDeduction: { single: 2700, married_filing_jointly: 5450 },
    notes: "MD also has county/Baltimore-City local income taxes (~2-3% added) — NOT modeled.",
  },
  MN: {
    name: "Minnesota", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 31690, rate: 0.0535 }, { upTo: 104090, rate: 0.068 }, { upTo: 193240, rate: 0.0785 }, { upTo: Infinity, rate: 0.0985 }],
      married_filing_jointly: [{ upTo: 46330, rate: 0.0535 }, { upTo: 184040, rate: 0.068 }, { upTo: 321450, rate: 0.0785 }, { upTo: Infinity, rate: 0.0985 }],
    },
    standardDeduction: { single: 14575, married_filing_jointly: 29150, head_of_household: 21900, married_filing_separately: 14575 },
  },
  MO: {
    name: "Missouri", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 1273, rate: 0 },
        { upTo: 2546, rate: 0.02 },
        { upTo: 3819, rate: 0.025 },
        { upTo: 5092, rate: 0.03 },
        { upTo: 6365, rate: 0.035 },
        { upTo: 7638, rate: 0.04 },
        { upTo: 8911, rate: 0.045 },
        { upTo: Infinity, rate: 0.048 },
      ],
      married_filing_jointly: [
        { upTo: 1273, rate: 0 },
        { upTo: 2546, rate: 0.02 },
        { upTo: 3819, rate: 0.025 },
        { upTo: 5092, rate: 0.03 },
        { upTo: 6365, rate: 0.035 },
        { upTo: 7638, rate: 0.04 },
        { upTo: 8911, rate: 0.045 },
        { upTo: Infinity, rate: 0.048 },
      ],
    },
    standardDeduction: { single: 14600, married_filing_jointly: 29200, head_of_household: 21900, married_filing_separately: 14600 },
    notes: "MO mirrors federal std deduction.",
  },
  MT: {
    name: "Montana", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 20500, rate: 0.047 }, { upTo: Infinity, rate: 0.059 }],
      married_filing_jointly: [{ upTo: 41000, rate: 0.047 }, { upTo: Infinity, rate: 0.059 }],
    },
    standardDeduction: { single: 14600, married_filing_jointly: 29200, head_of_household: 21900, married_filing_separately: 14600 },
    notes: "MT TY2024 reform: 2 brackets, federal std deduction.",
  },
  NE: {
    name: "Nebraska", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 3700, rate: 0.0246 },
        { upTo: 22170, rate: 0.0351 },
        { upTo: 35730, rate: 0.0501 },
        { upTo: Infinity, rate: 0.0584 },
      ],
      married_filing_jointly: [
        { upTo: 7390, rate: 0.0246 },
        { upTo: 44360, rate: 0.0351 },
        { upTo: 71460, rate: 0.0501 },
        { upTo: Infinity, rate: 0.0584 },
      ],
    },
    standardDeduction: { single: 8300, married_filing_jointly: 16600, head_of_household: 12150, married_filing_separately: 8300 },
  },
  NJ: {
    name: "New Jersey", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 20000, rate: 0.014 },
        { upTo: 35000, rate: 0.0175 },
        { upTo: 40000, rate: 0.035 },
        { upTo: 75000, rate: 0.05525 },
        { upTo: 500000, rate: 0.0637 },
        { upTo: 1000000, rate: 0.0897 },
        { upTo: Infinity, rate: 0.1075 },
      ],
      married_filing_jointly: [
        { upTo: 20000, rate: 0.014 },
        { upTo: 50000, rate: 0.0175 },
        { upTo: 70000, rate: 0.0245 },
        { upTo: 80000, rate: 0.035 },
        { upTo: 150000, rate: 0.05525 },
        { upTo: 500000, rate: 0.0637 },
        { upTo: 1000000, rate: 0.0897 },
        { upTo: Infinity, rate: 0.1075 },
      ],
    },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    // C3 follow-up (2026-05-27 PM): NJ personal exemption now modeled.
    // TY2024 per N.J.S.A. 54A:3-1:
    //   - $1,000 per filer (single)
    //   - $2,000 per couple (MFJ — both spouses)
    //   - $1,500 per dependent (qualifying child or other dependent)
    //   - Additional $1,000 for filer/spouse 65+, blind, or disabled (NOT MODELED — defer)
    //   - Additional $1,500 for full-time college student dependent (NOT MODELED — defer)
    personalExemption: {
      single: 1000,
      married_filing_jointly: 2000,
      head_of_household: 1000,
      married_filing_separately: 1000,
      qualifying_widow: 2000,
    },
    personalExemptionPerDependent: 1500,
    notes: "NJ uses personal exemptions ($1,000/filer + $2,000 MFJ + $1,500/dep TY2024 per N.J.S.A. 54A:3-1), not std deduction. Sub-gaps: additional $1,000 age 65+/blind/disabled and $1,500 student-dep not modeled.",
  },
  NM: {
    name: "New Mexico", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 5500, rate: 0.017 },
        { upTo: 16500, rate: 0.032 },
        { upTo: 33500, rate: 0.047 },
        { upTo: 210000, rate: 0.049 },
        { upTo: Infinity, rate: 0.059 },
      ],
      married_filing_jointly: [
        { upTo: 8000, rate: 0.017 },
        { upTo: 25000, rate: 0.032 },
        { upTo: 50000, rate: 0.047 },
        { upTo: 315000, rate: 0.049 },
        { upTo: Infinity, rate: 0.059 },
      ],
    },
    standardDeduction: { single: 14600, married_filing_jointly: 29200, head_of_household: 21900, married_filing_separately: 14600 },
  },
  NY: {
    name: "New York", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 8500, rate: 0.04 },
        { upTo: 11700, rate: 0.045 },
        { upTo: 13900, rate: 0.0525 },
        { upTo: 80650, rate: 0.055 },
        { upTo: 215400, rate: 0.06 },
        { upTo: 1077550, rate: 0.0685 },
        { upTo: 5000000, rate: 0.0965 },
        { upTo: 25000000, rate: 0.103 },
        { upTo: Infinity, rate: 0.109 },
      ],
      married_filing_jointly: [
        { upTo: 17150, rate: 0.04 },
        { upTo: 23600, rate: 0.045 },
        { upTo: 27900, rate: 0.0525 },
        { upTo: 161550, rate: 0.055 },
        { upTo: 323200, rate: 0.06 },
        { upTo: 2155350, rate: 0.0685 },
        { upTo: 5000000, rate: 0.0965 },
        { upTo: 25000000, rate: 0.103 },
        { upTo: Infinity, rate: 0.109 },
      ],
      head_of_household: [
        { upTo: 12800, rate: 0.04 },
        { upTo: 17650, rate: 0.045 },
        { upTo: 20900, rate: 0.0525 },
        { upTo: 107650, rate: 0.055 },
        { upTo: 269300, rate: 0.06 },
        { upTo: 1616450, rate: 0.0685 },
        { upTo: 5000000, rate: 0.0965 },
        { upTo: 25000000, rate: 0.103 },
        { upTo: Infinity, rate: 0.109 },
      ],
    },
    standardDeduction: { single: 8000, married_filing_jointly: 16050, head_of_household: 11200, married_filing_separately: 8000 },
    notes: "NYC and Yonkers have additional local income taxes — NOT modeled.",
  },
  ND: {
    name: "North Dakota", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 47150, rate: 0 }, { upTo: 238200, rate: 0.0195 }, { upTo: Infinity, rate: 0.025 }],
      married_filing_jointly: [{ upTo: 78775, rate: 0 }, { upTo: 289975, rate: 0.0195 }, { upTo: Infinity, rate: 0.025 }],
    },
    standardDeduction: { single: 14600, married_filing_jointly: 29200, head_of_household: 21900, married_filing_separately: 14600 },
    notes: "ND uses 0% bracket for low income; mirrors federal std deduction.",
  },
  OH: {
    name: "Ohio", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 26050, rate: 0 },
        { upTo: 100000, rate: 0.0275 },
        { upTo: Infinity, rate: 0.035 },
      ],
      married_filing_jointly: [
        { upTo: 26050, rate: 0 },
        { upTo: 100000, rate: 0.0275 },
        { upTo: Infinity, rate: 0.035 },
      ],
    },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    notes: "OH 2024: 2.75% above $26,050; 3.5% above $100,000. Personal exemption ~$2,400 (not modeled). Local city income taxes are common.",
  },
  OK: {
    name: "Oklahoma", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 1000, rate: 0.0025 },
        { upTo: 2500, rate: 0.0075 },
        { upTo: 3750, rate: 0.0175 },
        { upTo: 4900, rate: 0.0275 },
        { upTo: 7200, rate: 0.0375 },
        { upTo: Infinity, rate: 0.0475 },
      ],
      married_filing_jointly: [
        { upTo: 2000, rate: 0.0025 },
        { upTo: 5000, rate: 0.0075 },
        { upTo: 7500, rate: 0.0175 },
        { upTo: 9800, rate: 0.0275 },
        { upTo: 12200, rate: 0.0375 },
        { upTo: Infinity, rate: 0.0475 },
      ],
    },
    standardDeduction: { single: 6350, married_filing_jointly: 12700, head_of_household: 9350 },
  },
  OR: {
    name: "Oregon", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 4300, rate: 0.0475 },
        { upTo: 10750, rate: 0.0675 },
        { upTo: 125000, rate: 0.0875 },
        { upTo: Infinity, rate: 0.099 },
      ],
      married_filing_jointly: [
        { upTo: 8600, rate: 0.0475 },
        { upTo: 21500, rate: 0.0675 },
        { upTo: 250000, rate: 0.0875 },
        { upTo: Infinity, rate: 0.099 },
      ],
    },
    standardDeduction: { single: 2745, married_filing_jointly: 5495, head_of_household: 4420 },
  },
  RI: {
    name: "Rhode Island", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 77450, rate: 0.0375 }, { upTo: 176050, rate: 0.0475 }, { upTo: Infinity, rate: 0.0599 }],
      married_filing_jointly: [{ upTo: 77450, rate: 0.0375 }, { upTo: 176050, rate: 0.0475 }, { upTo: Infinity, rate: 0.0599 }],
    },
    standardDeduction: { single: 10550, married_filing_jointly: 21150, head_of_household: 15850, married_filing_separately: 10575 },
  },
  SC: {
    name: "South Carolina", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 3460, rate: 0 }, { upTo: 17330, rate: 0.03 }, { upTo: Infinity, rate: 0.064 }],
      married_filing_jointly: [{ upTo: 3460, rate: 0 }, { upTo: 17330, rate: 0.03 }, { upTo: Infinity, rate: 0.064 }],
    },
    standardDeduction: { single: 14600, married_filing_jointly: 29200, head_of_household: 21900, married_filing_separately: 14600 },
    notes: "SC top rate dropped to 6.4% for 2024; mirrors federal std deduction.",
  },
  VT: {
    name: "Vermont", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 45400, rate: 0.0335 },
        { upTo: 110050, rate: 0.066 },
        { upTo: 229550, rate: 0.076 },
        { upTo: Infinity, rate: 0.0875 },
      ],
      married_filing_jointly: [
        { upTo: 75850, rate: 0.0335 },
        { upTo: 183400, rate: 0.066 },
        { upTo: 279450, rate: 0.076 },
        { upTo: Infinity, rate: 0.0875 },
      ],
    },
    standardDeduction: { single: 7400, married_filing_jointly: 14850, head_of_household: 11150, married_filing_separately: 7400 },
    // VT Form IN-111 Line 5b — personal exemption per filer (taxpayer + spouse).
    // Dependents not yet wired (would need to pass dependent count into state calc).
    personalExemption: { single: 4850, married_filing_jointly: 9700, head_of_household: 4850, married_filing_separately: 4850 },
    notes: "VT std ded matches official 2024 values + per-filer personal exemption $4,850/$9,700 (Form IN-111 Line 5b). NOT MODELED: dependent personal exemption ($4,850/dependent) and taxable Social Security exclusion (Schedule IN-112 Part II Line 9).",
  },
  VA: {
    name: "Virginia", hasIncomeTax: true,
    brackets: {
      single: [{ upTo: 3000, rate: 0.02 }, { upTo: 5000, rate: 0.03 }, { upTo: 17000, rate: 0.05 }, { upTo: Infinity, rate: 0.0575 }],
      married_filing_jointly: [{ upTo: 3000, rate: 0.02 }, { upTo: 5000, rate: 0.03 }, { upTo: 17000, rate: 0.05 }, { upTo: Infinity, rate: 0.0575 }],
    },
    standardDeduction: { single: 8500, married_filing_jointly: 17000, head_of_household: 8500, married_filing_separately: 8500 },
  },
  WV: {
    name: "West Virginia", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 10000, rate: 0.0222 },
        { upTo: 25000, rate: 0.0296 },
        { upTo: 40000, rate: 0.0333 },
        { upTo: 60000, rate: 0.0444 },
        { upTo: Infinity, rate: 0.0482 },
      ],
      married_filing_jointly: [
        { upTo: 10000, rate: 0.0222 },
        { upTo: 25000, rate: 0.0296 },
        { upTo: 40000, rate: 0.0333 },
        { upTo: 60000, rate: 0.0444 },
        { upTo: Infinity, rate: 0.0482 },
      ],
    },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    notes: "WV: $2,000 personal exemption per filer (not modeled).",
  },
  WI: {
    name: "Wisconsin", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 14320, rate: 0.0354 },
        { upTo: 28640, rate: 0.0465 },
        { upTo: 315310, rate: 0.053 },
        { upTo: Infinity, rate: 0.0765 },
      ],
      married_filing_jointly: [
        { upTo: 19090, rate: 0.0354 },
        { upTo: 38190, rate: 0.0465 },
        { upTo: 420420, rate: 0.053 },
        { upTo: Infinity, rate: 0.0765 },
      ],
    },
    standardDeduction: { single: 13230, married_filing_jointly: 24490, head_of_household: 17090, married_filing_separately: 12575 },
    notes: "WI std deduction phases out at higher AGI; we use the maximum (low-income) value.",
  },
};

// ── 2025 state data ─────────────────────────────────────────────────────────
// Strategy: clone 2024 data; auto-update standard deductions for federal-conforming
// states; apply known 2025 rate changes (some states reduced or restructured rates).
function build2025Data(): Record<string, StateTaxInfo> {
  const data: Record<string, StateTaxInfo> = {};
  for (const [code, info] of Object.entries(STATE_TAX_DATA_2024)) {
    let next = { ...info };
    // Federal-conforming standard deduction → bumps to 2025 federal values
    if (FED_CONFORMING_STD_DED_STATES.has(code) && next.standardDeduction) {
      next = { ...next, standardDeduction: { ...FED_STD_DEDUCTION_2025 } };
    }
    data[code] = next;
  }

  // ── Known 2025 changes (apply over 2024 baseline) ──────────────────────
  // Indiana reduced flat rate to 3.0% for 2025
  data.IN = {
    ...data.IN,
    brackets: { single: flat(0.03), married_filing_jointly: flat(0.03) },
  };
  // Kentucky reduced flat rate to 3.5% for 2025
  data.KY = {
    ...data.KY,
    brackets: { single: flat(0.035), married_filing_jointly: flat(0.035) },
    standardDeduction: { single: 3270, married_filing_jointly: 3270 },
  };
  // Mississippi reduced flat rate to 4.4% for 2025
  data.MS = {
    ...data.MS,
    brackets: { single: flat(0.044), married_filing_jointly: flat(0.044) },
  };
  // Louisiana switched to flat 3% for 2025
  data.LA = {
    ...data.LA,
    brackets: { single: flat(0.03), married_filing_jointly: flat(0.03) },
    standardDeduction: { single: 12500, married_filing_jointly: 25000, head_of_household: 12500, married_filing_separately: 12500 },
    notes: "LA TY2025: switched to flat 3% with $12,500/$25,000 std deduction.",
  };
  // Iowa moved to flat 3.8% for 2025
  data.IA = {
    ...data.IA,
    brackets: { single: flat(0.038), married_filing_jointly: flat(0.038) },
  };
  // North Carolina reduced flat rate to 4.25% for 2025
  data.NC = {
    ...data.NC,
    brackets: { single: flat(0.0425), married_filing_jointly: flat(0.0425) },
  };
  // Utah reduced flat rate to 4.50% for 2025
  data.UT = {
    ...data.UT,
    brackets: { single: flat(0.045), married_filing_jointly: flat(0.045) },
  };
  // Georgia reduced flat rate to 5.19% for 2025
  data.GA = {
    ...data.GA,
    brackets: { single: flat(0.0519), married_filing_jointly: flat(0.0519) },
  };
  // California TY2025 brackets (inflation-adjusted ~3%)
  data.CA = {
    ...data.CA,
    brackets: {
      single: [
        { upTo: 11079, rate: 0.01 },
        { upTo: 26264, rate: 0.02 },
        { upTo: 41452, rate: 0.04 },
        { upTo: 57544, rate: 0.06 },
        { upTo: 72728, rate: 0.08 },
        { upTo: 371458, rate: 0.093 },
        { upTo: 445770, rate: 0.103 },
        { upTo: 742953, rate: 0.113 },
        { upTo: Infinity, rate: 0.123 },
      ],
      married_filing_jointly: [
        { upTo: 22158, rate: 0.01 },
        { upTo: 52528, rate: 0.02 },
        { upTo: 82904, rate: 0.04 },
        { upTo: 115088, rate: 0.06 },
        { upTo: 145456, rate: 0.08 },
        { upTo: 742916, rate: 0.093 },
        { upTo: 891540, rate: 0.103 },
        { upTo: 1485906, rate: 0.113 },
        { upTo: Infinity, rate: 0.123 },
      ],
    },
    standardDeduction: { single: 5707, married_filing_jointly: 11414, head_of_household: 11414, married_filing_separately: 5707 },
  };

  return data;
}

const STATE_TAX_DATA_2025: Record<string, StateTaxInfo> = build2025Data();

// TY2026 state data: hold the 2025 state brackets (most states have not yet
// published 2026 brackets) but bump federal-conforming-std-ded states to the
// 2026 federal value, mirroring build2025Data(). Documented approximation —
// state-specific 2026 bracket inflation is a future refresh.
function build2026Data(): Record<string, StateTaxInfo> {
  const data: Record<string, StateTaxInfo> = {};
  for (const [code, info] of Object.entries(STATE_TAX_DATA_2025)) {
    let next = { ...info };
    if (FED_CONFORMING_STD_DED_STATES.has(code) && next.standardDeduction) {
      next = { ...next, standardDeduction: { ...FED_STD_DEDUCTION_2026 } };
    }
    data[code] = next;
  }
  return data;
}

const STATE_TAX_DATA_2026: Record<string, StateTaxInfo> = build2026Data();

export const STATE_TAX_DATA_BY_YEAR: Record<TaxYear, Record<string, StateTaxInfo>> = {
  2024: STATE_TAX_DATA_2024,
  2025: STATE_TAX_DATA_2025,
  2026: STATE_TAX_DATA_2026,
};

// Backwards-compat: default to 2024 for any code that imports STATE_TAX_DATA directly.
export const STATE_TAX_DATA = STATE_TAX_DATA_2024;
