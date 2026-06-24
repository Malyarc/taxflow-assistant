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
  // AZ ties its std deduction to the FEDERAL §63 amount (A.R.S. §43-1041) →
  // tracks the OBBBA-boosted 2025/2026 values. MN REMOVED — it has its own,
  // lower, MN-indexed std deduction (Minn. Stat. §290.0123), NOT the federal
  // amount; applying FED_STD_DEDUCTION_2025 over-deducted ~$800. (Audit S2/S9.)
  "AZ", "CO", "ID", "IA", "MO", "MT", "NM", "ND", "SC",
]);

// K10 state-SS exclusion — states that TAX Social Security benefits (the
// federally-taxable portion). Federal AGI includes the federally-taxable
// portion of SS; states NOT in this set exempt SS from their state-tax base.
// Source: Tax Foundation state-by-state SS taxation table (TY2024 current).
// KS REMOVED (T1.0e #1, 2026-06-11): SB 1 (2024 Special Session) makes Social
//   Security 100% exempt from Kansas income tax beginning TY2024 for ALL
//   taxpayers regardless of income (KLRD SB 1 summary; K.S.A. 79-32,117(c)(xx)
//   as amended) — the old $75k-AGI cliff is repealed.
// Member states all carry income-tested partial exemptions, now MODELED as
// dedicated branches in calculateStateTax (T1.0e #13, each cited inline):
//   CT — 100% exempt below $75k single/MFS / $100k MFJ-QW-HoH; ≤25% taxed above.
//   WV — HB 4880 35/65/100% decreasing modification (2024/2025/2026).
//   NM — §7-2-5.14 full exemption at/below $100k/$150k/$75k AGI (cliff).
//   CO — 65+ full subtraction; 55-64 $20k pension cap (TY2025+ full ≤$75k/$95k).
//   VT — full below $50k/$65k AGI; linear phase-out over the next $10k.
//   MN — M1M simplified method: full below $84,490/$108,320/$54,160 (2024),
//        −10% per $4,000 ($2,000 MFS) of excess.
//   RI — full modification at full retirement age below the indexed AGI limit.
//   UT — credit-based offset (modeled as a credit in calculateStateTax).
//   MT — SS flows per federal (no broad threshold exemption) — taxed as-is.
export const STATES_TAXING_SS = new Set([
  "CO", "CT", "MN", "MT", "NM", "RI", "UT", "VT",
]);

// ── Multi-state reciprocity agreements ─────────────────────────────────────
// If filer resides in a STATE and works in a state listed in their value array,
// the WORK state does NOT tax the wages — only the resident state taxes them.
// Sources: state DOR reciprocity bulletins (current as of TY2024).
// Note: most agreements require the filer to file a non-resident certificate
// with their employer (e.g., NJ-165, PA Form REV-419, IL IL-W-5-NR). We
// assume that paperwork is filed correctly.
export const STATE_RECIPROCITY: Record<string, readonly string[]> = {
  // T1.0f #27 (2026-06-11) — AZ Form WEC: nonresident employees who are
  // residents of CALIFORNIA, INDIANA, OREGON, or VIRGINIA are exempt from AZ
  // withholding on AZ wages (azdor.gov "Withholding Exceptions" + Form WEC
  // instructions). Strictly these are credit-coordination regimes (the AZ
  // 140NR allows a credit for resident-state tax — the "reverse credit" rule
  // for CA), but the net wage result matches reciprocity: AZ collects ~$0 and
  // the resident state taxes the wages in full with no resident credit. The
  // reverse direction (e.g. AZ resident working in CA) is NOT reciprocal.
  CA: ["AZ"],
  DC: ["MD", "VA"],
  IL: ["IA", "KY", "MI", "WI"],
  IN: ["AZ", "KY", "MI", "OH", "PA", "WI"],
  IA: ["IL"],
  KY: ["IL", "IN", "MI", "OH", "VA", "WV", "WI"],
  MD: ["DC", "PA", "VA", "WV"],
  MI: ["IL", "IN", "KY", "MN", "OH", "WI"],
  MN: ["MI", "ND"],
  MT: ["ND"],
  NJ: ["PA"],
  ND: ["MN", "MT"],
  OH: ["IN", "KY", "MI", "PA", "WV"],
  OR: ["AZ"],
  PA: ["IN", "MD", "NJ", "OH", "VA", "WV"],
  VA: ["AZ", "DC", "KY", "MD", "PA", "WV"],
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
    // TY2024 = 4.25% (temporary TABOR-surplus reduction, SB24-228; CO DR 0104
    // 2024 booklet). The 4.40% statutory base is restored for 2025 in
    // build2025Data (the temp reduction is TABOR-surplus-conditional each year).
    brackets: { single: flat(0.0425), married_filing_jointly: flat(0.0425) },
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
    // TY2024 = 5.695% flat (H.521, retroactive to 1/1/2024). TY2025 → 5.3% (HB40),
    // applied in build2025Data. Idaho State Tax Commission rate schedule.
    brackets: { single: flat(0.05695), married_filing_jointly: flat(0.05695) },
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
    // T1.0e #16 (2026-06-11) — decomposed the old folded "std deduction"
    // ($12,300/$24,600/$18,300) into its REAL components per MS DOR
    // (dor.ms.gov/individual/tax-rates):
    //   * 0% on the first $10,000 of TAXABLE income — a real bracket now, and
    //     it does NOT double for MFJ (same $10k band for every status; the old
    //     fold-in wrongly doubled it to $20k for MFJ).
    //   * Std deduction $2,300 single/MFS, $4,600 MFJ, $3,400 HoH.
    //   * Personal exemption $6,000 single/MFS, $12,000 MFJ/QSS, $8,000 HoH,
    //     + $1,500 per dependent (MS Form 80-100 exemption table).
    brackets: {
      single: [{ upTo: 10000, rate: 0 }, { upTo: Infinity, rate: 0.047 }],
      married_filing_jointly: [{ upTo: 10000, rate: 0 }, { upTo: Infinity, rate: 0.047 }],
    },
    standardDeduction: { single: 2300, married_filing_jointly: 4600, head_of_household: 3400, married_filing_separately: 2300 },
    personalExemption: { single: 6000, married_filing_jointly: 12000, head_of_household: 8000, married_filing_separately: 6000, qualifying_widow: 12000 },
    personalExemptionPerDependent: 1500,
    notes: "MS: 0% on first $10,000 of taxable income (single band, all statuses), 4.7% above (TY2024); std ded $2,300/$4,600/$3,400 + exemptions $6,000/$12,000/$8,000 + $1,500/dep (MS DOR).",
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
    // T1.0e #1 (2026-06-11) — SB 1 (2024 Special Session, signed 6/21/2024;
    // KLRD bill summary + kslegislature.gov enrolled text) RETROACTIVE to
    // TY2024: two brackets — 5.2% on the first $23,000 single ($46,000 MFJ),
    // 5.58% above. (The old 3.1/5.25/5.7% three-bracket schedule is repealed.)
    // MFS/HoH use the single column per K.S.A. 79-32,110 ("all other
    // individuals" = the married-filing-jointly column doubles only for joint).
    brackets: {
      single: [{ upTo: 23000, rate: 0.052 }, { upTo: Infinity, rate: 0.0558 }],
      married_filing_jointly: [{ upTo: 46000, rate: 0.052 }, { upTo: Infinity, rate: 0.0558 }],
    },
    // SB 1 std ded (TY2024+): $3,605 single / $8,240 MFJ / $6,180 HoH (MFS =
    // half the joint amount, $4,120, per K.S.A. 79-32,119).
    standardDeduction: { single: 3605, married_filing_jointly: 8240, head_of_household: 6180, married_filing_separately: 4120 },
    // SB 1 personal exemption (TY2024+): $9,160 per TAXPAYER ($18,320 MFJ —
    // both spouses) + $2,320 for EACH dependent (K.S.A. 79-32,121 as amended).
    personalExemption: { single: 9160, married_filing_jointly: 18320, head_of_household: 9160, married_filing_separately: 9160, qualifying_widow: 18320 },
    personalExemptionPerDependent: 2320,
    notes: "KS SB 1 (2024): 5.2%/5.58% two-bracket, std ded $3,605/$8,240/$6,180, personal exemption $9,160/filer + $2,320/dependent; Social Security 100% exempt TY2024+ (KS removed from STATES_TAXING_SS).",
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
    // T1.0e #6 (2026-06-11) — TY2024 uses the PRE-HB-252 five-bracket law
    // (§7-2-7 before L.2024 ch.67): single 1.7% ≤$5.5k / 3.2% ≤$11k / 4.7%
    // ≤$16k / 4.9% ≤$210k / 5.9% above; MFJ 1.7% ≤$8k / 3.2% ≤$16k / 4.7%
    // ≤$24k / 4.9% ≤$315k / 5.9%. The engine previously mixed the 2025 law's
    // $16.5k/$33.5k middle thresholds into 2024 (under-tax ~$117 @ $50k).
    // HB 252's NEW six-bracket structure (1.5%/3.2%/4.3%/4.7%/4.9%/5.9%,
    // effective 1/1/2025) is applied in build2025Data — verified vs LegiScan
    // HB 252 enrolled text + NM governor's signing release (tax.newmexico.gov).
    brackets: {
      single: [
        { upTo: 5500, rate: 0.017 },
        { upTo: 11000, rate: 0.032 },
        { upTo: 16000, rate: 0.047 },
        { upTo: 210000, rate: 0.049 },
        { upTo: Infinity, rate: 0.059 },
      ],
      married_filing_jointly: [
        { upTo: 8000, rate: 0.017 },
        { upTo: 16000, rate: 0.032 },
        { upTo: 24000, rate: 0.047 },
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
    // TY2024 top rate = 6.2% (SC DOR SC1040TT). TY2025 → 6.0% (effective 7/1/2025),
    // applied in build2025Data. Brackets (0% ≤$3,460, 3% ≤$17,330) inflation-indexed.
    brackets: {
      single: [{ upTo: 3460, rate: 0 }, { upTo: 17330, rate: 0.03 }, { upTo: Infinity, rate: 0.062 }],
      married_filing_jointly: [{ upTo: 3460, rate: 0 }, { upTo: 17330, rate: 0.03 }, { upTo: Infinity, rate: 0.062 }],
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
    // VT Form IN-111 Line 5b — personal exemption per filer (taxpayer + spouse)
    // AND per dependent (same $4,850 each; VT gives the dependent exemption at the
    // same amount as the personal exemption, applied via personalExemptionPerDependent).
    personalExemption: { single: 4850, married_filing_jointly: 9700, head_of_household: 4850, married_filing_separately: 4850 },
    personalExemptionPerDependent: 4850,
    notes: "VT std ded matches official 2024 values + per-filer personal exemption $4,850/$9,700 AND per-dependent exemption $4,850 (Form IN-111 Line 5b). SS exclusion (32 V.S.A. §5830e — full ≤$50k/$65k AGI, linear phase over the next $10k) MODELED in calculateStateTax (T1.0e #13, 2026-06-11).",
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
    // T1.0e #4 (2026-06-11) — TY2024 = the HB 2526 (2023) rates, top 5.12%:
    // 2.36/3.15/3.54/4.72/5.12%. The 4% trigger cut + SB 2033's extra 2%
    // BOTH took effect 1/1/2025 (top 4.82%) — EY Tax Alert 2024-2154 + WV Tax
    // Division "About the Income Tax Rate Cut". The engine wrongly held the
    // 2025 rates in the 2024 slot (≈6% under-tax); 2025 rates are applied in
    // build2025Data. Next trigger window: January 2027.
    brackets: {
      single: [
        { upTo: 10000, rate: 0.0236 },
        { upTo: 25000, rate: 0.0315 },
        { upTo: 40000, rate: 0.0354 },
        { upTo: 60000, rate: 0.0472 },
        { upTo: Infinity, rate: 0.0512 },
      ],
      married_filing_jointly: [
        { upTo: 10000, rate: 0.0236 },
        { upTo: 25000, rate: 0.0315 },
        { upTo: 40000, rate: 0.0354 },
        { upTo: 60000, rate: 0.0472 },
        { upTo: Infinity, rate: 0.0512 },
      ],
    },
    standardDeduction: { single: 0, married_filing_jointly: 0 },
    notes: "WV TY2024: HB 2526 rates (top 5.12%); TY2025+ 2.22/2.96/3.33/4.44/4.82 via build2025Data. $2,000 personal exemption per filer (not modeled).",
  },
  WI: {
    name: "Wisconsin", hasIncomeTax: true,
    brackets: {
      single: [
        { upTo: 14320, rate: 0.035 },
        { upTo: 28640, rate: 0.044 },
        { upTo: 315310, rate: 0.053 },
        { upTo: Infinity, rate: 0.0765 },
      ],
      married_filing_jointly: [
        { upTo: 19090, rate: 0.035 },
        { upTo: 38190, rate: 0.044 },
        { upTo: 420420, rate: 0.053 },
        { upTo: Infinity, rate: 0.0765 },
      ],
    },
    standardDeduction: { single: 13230, married_filing_jointly: 24490, head_of_household: 17090, married_filing_separately: 12575 },
    notes: "WI sliding-scale std deduction: ALL 4 statuses modeled in calculateStateTax (2026-06-06k) — single $13,230−12%/$19,070; MFJ $24,490−19.778%/$27,520; MFS $12,575−19.778%/$8,282; HoH max(single, $17,090−22.5%/$19,070). Reverse-derived from + verified to reproduce the 2024 WI Form 1 Standard Deduction Table to the dollar (Wis. Stat. §71.05(22)). 2024 values applied for all years (indexing is a year-pinning sub-gap). HoH/MFS use single brackets (separate pre-existing WI-bracket sub-gap).",
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
  // Kentucky 2025 = 4.0% flat (UNCHANGED from 2024 — HB1 of the 2025 session cut
  // the rate to 3.5% only "for taxable years beginning on or after 2026-01-01",
  // applied in build2026Data). The prior code wrongly applied the 2026 3.5% rate
  // to 2025. KY indexes its std deduction → $3,270 for 2025. (Audit S11.)
  data.KY = {
    ...data.KY,
    brackets: { single: flat(0.04), married_filing_jointly: flat(0.04) },
    standardDeduction: { single: 3270, married_filing_jointly: 3270 },
  };
  // Mississippi reduced the rate to 4.4% for 2025 (2022 phase-down schedule).
  // The $10,000 0% band is preserved (it is statutory, not part of the cut).
  data.MS = {
    ...data.MS,
    brackets: {
      single: [{ upTo: 10000, rate: 0 }, { upTo: Infinity, rate: 0.044 }],
      married_filing_jointly: [{ upTo: 10000, rate: 0 }, { upTo: Infinity, rate: 0.044 }],
    },
  };
  // Louisiana switched to flat 3% for 2025. T1.0e #8 (2026-06-11): the LDR
  // income-tax-reform FAQ sets the new combined personal-exemption/standard
  // deduction at $12,500 single/MFS and **$25,000 for JOINT, HEAD OF
  // HOUSEHOLD, and SURVIVING SPOUSE** (revenue.louisiana.gov FAQ; RIB 25-012).
  // The prior override wrongly gave HoH only $12,500. CPI-indexed from 2026
  // (2026 holds the 2025 values pending LDR publication — documented).
  data.LA = {
    ...data.LA,
    brackets: { single: flat(0.03), married_filing_jointly: flat(0.03) },
    standardDeduction: { single: 12500, married_filing_jointly: 25000, head_of_household: 25000, married_filing_separately: 12500, qualifying_widow: 25000 },
    notes: "LA TY2025: flat 3% with $12,500 single/MFS, $25,000 MFJ/HoH/QSS combined exemption-deduction (LDR FAQ).",
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
  // Idaho reduced flat rate to 5.3% for 2025 (HB40, retroactive to 1/1/2025)
  data.ID = {
    ...data.ID,
    brackets: { single: flat(0.053), married_filing_jointly: flat(0.053) },
  };
  // Colorado: 4.40% for TY2025 — VERIFIED 2026-06-11 (T1.0e #3) against the
  // official 2025 DR 0104 booklet (tax.colorado.gov Book104_2025.pdf,
  // 10/29/25): "the income tax rate is 4.4%" for TY2025 filers. The SB24-228
  // TABOR temporary reduction did NOT trigger for 2025 — the certified net
  // excess revenue (~$293.3M) fell below the $300M trigger (CO Fiscal
  // Institute / LCS forecasts). (An earlier audit claim of 4.25% for 2025 was
  // REFUTED by the DOR form.) 2026 also defaults to 4.40% — no 2026 trigger
  // certification published; re-check when the FY2025-26 surplus certifies.
  data.CO = {
    ...data.CO,
    brackets: { single: flat(0.044), married_filing_jointly: flat(0.044) },
  };
  // West Virginia TY2025: the certified 4% trigger cut + SB 2033's extra 2%
  // both effective 1/1/2025 → 2.22/2.96/3.33/4.44/4.82 (EY Tax Alert
  // 2024-2154; WV Tax Division). TY2024 keeps the HB 2526 rates (top 5.12%).
  data.WV = {
    ...data.WV,
    brackets: {
      single: [
        { upTo: 10000, rate: 0.0222 }, { upTo: 25000, rate: 0.0296 },
        { upTo: 40000, rate: 0.0333 }, { upTo: 60000, rate: 0.0444 },
        { upTo: Infinity, rate: 0.0482 },
      ],
      married_filing_jointly: [
        { upTo: 10000, rate: 0.0222 }, { upTo: 25000, rate: 0.0296 },
        { upTo: 40000, rate: 0.0333 }, { upTo: 60000, rate: 0.0444 },
        { upTo: Infinity, rate: 0.0482 },
      ],
    },
    notes: "WV TY2025: trigger 4% + SB 2033 2% cuts (top 4.82%). TY2026: SB 392 5% cut to top 4.58% — see build2026Data. $2,000/filer exemption not modeled.",
  };
  // New Mexico TY2025+ (HB 252, L.2024 ch.67, eff. 1/1/2025): SIX brackets —
  // 1.5%/3.2%/4.3%/4.7%/4.9%/5.9%. Single ≤$5.5k/$16.5k/$33.5k/$66.5k/$210k;
  // MFJ/HoH/QSS ≤$8k/$25k/$50k/$100k/$315k. Verified vs the HB 252 enrolled
  // text (LegiScan) + NM governor's signing release (tax.newmexico.gov).
  data.NM = {
    ...data.NM,
    brackets: {
      single: [
        { upTo: 5500, rate: 0.015 },
        { upTo: 16500, rate: 0.032 },
        { upTo: 33500, rate: 0.043 },
        { upTo: 66500, rate: 0.047 },
        { upTo: 210000, rate: 0.049 },
        { upTo: Infinity, rate: 0.059 },
      ],
      married_filing_jointly: [
        { upTo: 8000, rate: 0.015 },
        { upTo: 25000, rate: 0.032 },
        { upTo: 50000, rate: 0.043 },
        { upTo: 100000, rate: 0.047 },
        { upTo: 315000, rate: 0.049 },
        { upTo: Infinity, rate: 0.059 },
      ],
    },
    notes: "NM TY2025+: HB 252 six-bracket structure (1.5%-5.9%).",
  };
  // Hawaii TY2025 (Act 46 SLH 2024 — "Green Affordability Plan II"): massive
  // bracket widening. Single: 1.4% ≤$9,600 / 3.2% ≤$14,400 / 5.5% ≤$19,200 /
  // 6.4% ≤$24,000 / 6.8% ≤$36,000 / 7.2% ≤$48,000 / 7.6% ≤$125,000 / 7.9%
  // ≤$175,000 / 8.25% ≤$225,000 / 9% ≤$275,000 / 10% ≤$325,000 / 11% above.
  // MFJ = 2× single. Verified vs HI DOTAX "Tax Rate Schedules For Taxable
  // Years Beginning After December 31, 2024" + DOTAX Ann. 2024-03. Further
  // widening lands TY2027/2029; std-ded steps TY2026/2028/2030 (build2026Data).
  data.HI = {
    ...data.HI,
    brackets: {
      single: [
        { upTo: 9600, rate: 0.014 },
        { upTo: 14400, rate: 0.032 },
        { upTo: 19200, rate: 0.055 },
        { upTo: 24000, rate: 0.064 },
        { upTo: 36000, rate: 0.068 },
        { upTo: 48000, rate: 0.072 },
        { upTo: 125000, rate: 0.076 },
        { upTo: 175000, rate: 0.079 },
        { upTo: 225000, rate: 0.0825 },
        { upTo: 275000, rate: 0.09 },
        { upTo: 325000, rate: 0.10 },
        { upTo: Infinity, rate: 0.11 },
      ],
      married_filing_jointly: [
        { upTo: 19200, rate: 0.014 },
        { upTo: 28800, rate: 0.032 },
        { upTo: 38400, rate: 0.055 },
        { upTo: 48000, rate: 0.064 },
        { upTo: 72000, rate: 0.068 },
        { upTo: 96000, rate: 0.072 },
        { upTo: 250000, rate: 0.076 },
        { upTo: 350000, rate: 0.079 },
        { upTo: 450000, rate: 0.0825 },
        { upTo: 550000, rate: 0.09 },
        { upTo: 650000, rate: 0.10 },
        { upTo: Infinity, rate: 0.11 },
      ],
    },
    notes: "HI TY2025: Act 46 widened brackets (1.4% band to $9,600 single; 11% starts $325,000). Std ded doubles TY2026.",
  };
  // Maryland TY2025 (HB 352 — Budget Reconciliation and Financing Act of
  // 2025; MD Comptroller tax alert / RSM state tax alert): two NEW top
  // brackets — 6.25% above $500k single ($600k MFJ) and 6.5% above $1M
  // ($1.2M MFJ) — and the std deduction becomes a flat $3,350 single/MFS /
  // $6,700 MFJ/HoH/QSS (the old 15%-of-AGI phase-in is repealed; COLA-indexed
  // after 2025). The 2% capital-gains surtax on federal AGI > $350k is wired
  // in calculateMultiStateTax (it taxes GAINS, not taxable income).
  data.MD = {
    ...data.MD,
    brackets: {
      single: [
        { upTo: 1000, rate: 0.02 },
        { upTo: 2000, rate: 0.03 },
        { upTo: 3000, rate: 0.04 },
        { upTo: 100000, rate: 0.0475 },
        { upTo: 125000, rate: 0.05 },
        { upTo: 150000, rate: 0.0525 },
        { upTo: 250000, rate: 0.055 },
        { upTo: 500000, rate: 0.0575 },
        { upTo: 1000000, rate: 0.0625 },
        { upTo: Infinity, rate: 0.065 },
      ],
      married_filing_jointly: [
        { upTo: 1000, rate: 0.02 },
        { upTo: 2000, rate: 0.03 },
        { upTo: 3000, rate: 0.04 },
        { upTo: 150000, rate: 0.0475 },
        { upTo: 175000, rate: 0.05 },
        { upTo: 225000, rate: 0.0525 },
        { upTo: 300000, rate: 0.055 },
        { upTo: 600000, rate: 0.0575 },
        { upTo: 1200000, rate: 0.0625 },
        { upTo: Infinity, rate: 0.065 },
      ],
    },
    standardDeduction: { single: 3350, married_filing_jointly: 6700, head_of_household: 6700, married_filing_separately: 3350, qualifying_widow: 6700 },
    notes: "MD TY2025 (HB 352): 6.25%/$500k + 6.5%/$1M new brackets ($600k/$1.2M MFJ); flat std ded $3,350/$6,700; 2% cap-gains surtax >$350k AGI in calculateMultiStateTax. County local taxes separate.",
  };
  // Maine TY2025 std deduction — T1.0e #8 REFUTED-as-instructed (2026-06-11):
  // Maine did NOT conform to OBBBA's higher federal std ded for 2025 (fixed-
  // date conformity; MRS Oct-2025 Tax Alert + the 2025 Form 1040ME general
  // instructions publish **$15,000 single/MFS / $30,000 MFJ / $22,500 HoH**
  // — the PRE-OBBBA federal values). ME is therefore NOT added to
  // FED_CONFORMING_STD_DED_STATES (that would auto-apply the OBBBA $15,750);
  // explicit MRS-published values are pinned per year instead.
  data.ME = {
    ...data.ME,
    standardDeduction: { single: 15000, married_filing_jointly: 30000, head_of_household: 22500, married_filing_separately: 15000, qualifying_widow: 30000 },
    notes: "ME TY2025 std ded $15,000/$30,000/$22,500 (MRS 1040ME instructions — Maine did NOT conform to OBBBA's $15,750). TY2026 decoupled + ME-indexed (build2026Data).",
  };
  // DC TY2025 (D.C. Law 26-89 — Income and Franchise Tax Conformity and
  // Revision Temporary Amendment Act of 2025): DC DECOUPLED from the OBBBA
  // federal std ded and set its own basic standard deduction — $15,000
  // single/MFS, $30,000 MFJ, $22,500 HoH (COLA-indexed after 2025). Do NOT
  // add DC to the federal-conforming set. (Congressional-disapproval fight
  // (H.J.Res.142) pending; OTR's 2025 D-40 booklet applies these values.)
  data.DC = {
    ...data.DC,
    standardDeduction: { single: 15000, married_filing_jointly: 30000, head_of_household: 22500, married_filing_separately: 15000, qualifying_widow: 30000 },
    notes: "DC TY2025: Law 26-89 std ded $15,000/$30,000/$22,500 (decoupled from OBBBA).",
  };
  // Virginia TY2025+ (HB 1600 budget, signed 5/2/2025; tax.virginia.gov "New
  // Virginia Tax Laws for July 1, 2025"): std ded raised to $8,750 single /
  // $17,500 MFJ (extended through 2026+). The same act raised the VA EITC
  // refundable option 15% → 20% (year-indexed in calculateStateEitc).
  data.VA = {
    ...data.VA,
    standardDeduction: { single: 8750, married_filing_jointly: 17500, head_of_household: 8750, married_filing_separately: 8750 },
    notes: "VA TY2025+: std ded $8,750/$17,500 (HB 1600).",
  };
  // South Carolina reduced the top rate to 6.0% effective 7/1/2025 (SC DOR).
  data.SC = {
    ...data.SC,
    brackets: {
      single: [{ upTo: 3460, rate: 0 }, { upTo: 17330, rate: 0.03 }, { upTo: Infinity, rate: 0.06 }],
      married_filing_jointly: [{ upTo: 3460, rate: 0 }, { upTo: 17330, rate: 0.03 }, { upTo: Infinity, rate: 0.06 }],
    },
  };
  // Nebraska reduced the top rate to 5.20% for 2025 (LB754; lower rates unchanged).
  data.NE = {
    ...data.NE,
    brackets: {
      single: [
        { upTo: 3700, rate: 0.0246 }, { upTo: 22170, rate: 0.0351 },
        { upTo: 35730, rate: 0.0501 }, { upTo: Infinity, rate: 0.052 },
      ],
      married_filing_jointly: [
        { upTo: 7390, rate: 0.0246 }, { upTo: 44360, rate: 0.0351 },
        { upTo: 71460, rate: 0.0501 }, { upTo: Infinity, rate: 0.052 },
      ],
    },
  };
  // Ohio reduced the top rate to 3.125% for 2025 (HB96, retroactive to 1/1/2025).
  data.OH = {
    ...data.OH,
    brackets: {
      single: [{ upTo: 26050, rate: 0 }, { upTo: 100000, rate: 0.0275 }, { upTo: Infinity, rate: 0.03125 }],
      married_filing_jointly: [{ upTo: 26050, rate: 0 }, { upTo: 100000, rate: 0.0275 }, { upTo: Infinity, rate: 0.03125 }],
    },
  };
  // Missouri TY2025 (R2-S-MO): top rate dropped 4.8%→4.7% (SB3 of 2022, revenue
  // trigger met; EY Tax Alert 2024-2158) AND the brackets re-indexed to $1,313
  // increments. VERIFIED vs the MO DOR 2025 Tax Chart (dor.mo.gov): top bracket
  // = "$256 plus 4.7% of excess over $9,191" — the cumulative tax through the
  // 4.5% band on $1,313 steps hand-calcs to exactly $256.035. MO has no
  // single/joint distinction; std ded follows federal (FED_CONFORMING set).
  data.MO = {
    ...data.MO,
    brackets: {
      single: [
        { upTo: 1313, rate: 0 }, { upTo: 2626, rate: 0.02 }, { upTo: 3939, rate: 0.025 },
        { upTo: 5252, rate: 0.03 }, { upTo: 6565, rate: 0.035 }, { upTo: 7878, rate: 0.04 },
        { upTo: 9191, rate: 0.045 }, { upTo: Infinity, rate: 0.047 },
      ],
      married_filing_jointly: [
        { upTo: 1313, rate: 0 }, { upTo: 2626, rate: 0.02 }, { upTo: 3939, rate: 0.025 },
        { upTo: 5252, rate: 0.03 }, { upTo: 6565, rate: 0.035 }, { upTo: 7878, rate: 0.04 },
        { upTo: 9191, rate: 0.045 }, { upTo: Infinity, rate: 0.047 },
      ],
    },
    notes: "MO TY2025: top rate 4.7% (SB3 trigger), $1,313-step brackets; std ded mirrors federal.",
  };
  // Oregon TY2025 (R2-S-OR): brackets + std ded were one year stale (2024
  // values flowed through unchanged). VERIFIED vs OR-40 2025: the joint tax-
  // computation line "$3,756 plus 8.75% over $50,000" reconstructs to thresholds
  // $8,800/$22,200 (the old $8,600/$21,500 gives $3,773 — wrong). Single = half.
  // Std ded $2,835/$5,670/$4,560 (OR DoR 2025; Oregon does not conform to federal).
  data.OR = {
    ...data.OR,
    brackets: {
      single: [
        { upTo: 4400, rate: 0.0475 }, { upTo: 11100, rate: 0.0675 },
        { upTo: 125000, rate: 0.0875 }, { upTo: Infinity, rate: 0.099 },
      ],
      married_filing_jointly: [
        { upTo: 8800, rate: 0.0475 }, { upTo: 22200, rate: 0.0675 },
        { upTo: 250000, rate: 0.0875 }, { upTo: Infinity, rate: 0.099 },
      ],
    },
    standardDeduction: { single: 2835, married_filing_jointly: 5670, head_of_household: 4560, married_filing_separately: 2835 },
    notes: "OR TY2025: inflation-indexed brackets ($4,400/$11,100 single; $8,800/$22,200 MFJ) + std ded $2,835/$5,670/$4,560.",
  };
  // Minnesota 2025 std deduction (MN-indexed, NOT federal — MN was removed from
  // the conforming set; audit S2): $14,950 single / $29,900 MFJ / $22,500 HoH.
  // (The 2024 brackets are cloned — MN bracket inflation is a documented sub-gap.)
  data.MN = {
    ...data.MN,
    standardDeduction: { single: 14950, married_filing_jointly: 29900, head_of_household: 22500, married_filing_separately: 14950 },
  };
  // Massachusetts 4% surtax threshold indexes annually: 2025 = $1,083,150
  // (was $1,053,750 in 2024; Mass. Const. Amend. Art. XLIV). (Audit S8.)
  data.MA = {
    ...data.MA,
    surtax: { threshold: 1083150, rate: 0.04 },
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
  // Ohio moves to a single flat 2.75% (over $26,050) for 2026 (HB96).
  data.OH = {
    ...data.OH,
    brackets: {
      single: [{ upTo: 26050, rate: 0 }, { upTo: Infinity, rate: 0.0275 }],
      married_filing_jointly: [{ upTo: 26050, rate: 0 }, { upTo: Infinity, rate: 0.0275 }],
    },
  };
  // Kentucky reduced the flat rate to 3.5% effective 1/1/2026 (HB1, 2025 session);
  // KY-indexed std deduction $3,360. (Audit S11.)
  data.KY = {
    ...data.KY,
    brackets: { single: flat(0.035), married_filing_jointly: flat(0.035) },
    standardDeduction: { single: 3360, married_filing_jointly: 3360 },
  };
  // ── T1.0e #12 — TY2026 statutory cuts batch (2026-06-11), each verified
  // against Tax Foundation "State Tax Changes Taking Effect January 1, 2026"
  // + the cited state statute/DOR source. ─────────────────────────────────
  // Indiana: 3.0% → 2.95% (HB 1001-2023 phase-down; 2.9% scheduled 2027).
  data.IN = {
    ...data.IN,
    brackets: { single: flat(0.0295), married_filing_jointly: flat(0.0295) },
  };
  // Mississippi: 4.4% → 4.0% (the 2022 phase-down's final scheduled step;
  // HB 1 of 2025 continues cuts after 2026). $10k 0% band preserved.
  data.MS = {
    ...data.MS,
    brackets: {
      single: [{ upTo: 10000, rate: 0 }, { upTo: Infinity, rate: 0.04 }],
      married_filing_jointly: [{ upTo: 10000, rate: 0 }, { upTo: Infinity, rate: 0.04 }],
    },
  };
  // North Carolina: 4.25% → 3.99% (final step of S.L. 2023-134 phasedown).
  data.NC = {
    ...data.NC,
    brackets: { single: flat(0.0399), married_filing_jointly: flat(0.0399) },
  };
  // Nebraska: top 5.20% → 4.55% (LB 754 path; 3.99% by 2027). Lower brackets
  // unchanged.
  data.NE = {
    ...data.NE,
    brackets: {
      single: [
        { upTo: 3700, rate: 0.0246 }, { upTo: 22170, rate: 0.0351 },
        { upTo: 35730, rate: 0.0501 }, { upTo: Infinity, rate: 0.0455 },
      ],
      married_filing_jointly: [
        { upTo: 7390, rate: 0.0246 }, { upTo: 44360, rate: 0.0351 },
        { upTo: 71460, rate: 0.0501 }, { upTo: Infinity, rate: 0.0455 },
      ],
    },
  };
  // Georgia: 4.99% flat for TY2026. HB 463 (signed by Gov. Kemp 2026-05-11,
  // effective 7/1/2026 retroactive to 1/1/2026) accelerated the rate to 4.99%,
  // superseding the HB 1015/HB 111 trigger schedule's 5.09% for 2026 (further
  // 0.125%/yr cuts to a 3.99% floor pending revenue triggers). Verified vs the
  // Governor's office press release + BDO/Paylocity 2026 tax alerts.
  // (audit 2026-06-23 — was 5.09%, the pre-HB-463 figure.) NOTE: HB 463 also
  // raises the GA std deduction for 2026 — verify the exact amount vs the DOR
  // 2026 booklet before changing the conforming std-ded handling.
  data.GA = {
    ...data.GA,
    brackets: { single: flat(0.0499), married_filing_jointly: flat(0.0499) },
  };
  // Montana (HB 337, L.2025 ch.227 — NOT SB 323, which died): for tax years
  // beginning after 12/31/2025 the lower 4.7% bracket WIDENS to $47,500
  // single / $95,000 MFJ (from $20,500/$41,000) and the top rate drops
  // 5.9% → 5.65% (5.4% in 2027). Verified vs the HB 337 enrolled text
  // (MCA 15-30-2103 as amended) + revenue.mt.gov HB-337 notice.
  data.MT = {
    ...data.MT,
    brackets: {
      single: [{ upTo: 47500, rate: 0.047 }, { upTo: Infinity, rate: 0.0565 }],
      married_filing_jointly: [{ upTo: 95000, rate: 0.047 }, { upTo: Infinity, rate: 0.0565 }],
    },
    notes: "MT TY2026 (HB 337): 4.7% ≤ $47,500/$95,000; 5.65% above (5.4% in 2027). Federal std deduction.",
  };
  // Oklahoma (HB 2764, signed 5/28/2025, eff. TY2026): six brackets
  // consolidated to three + the 0% band, top 4.75% → 4.5%. Single/MFS:
  // 0% ≤$3,750 / 2.5% ≤$4,900 / 3.5% ≤$7,200 / 4.5% above. MFJ/HoH/QSS:
  // 0% ≤$7,500 / 2.5% ≤$9,800 / 3.5% ≤$14,400 / 4.5% above. Verified vs the
  // OTC "Summary of 2025 Tax Legislation" + the 2026 OW-2 withholding tables
  // (2.5/3.5/4.5 rate set). Future 0.25% trigger cuts possible.
  data.OK = {
    ...data.OK,
    brackets: {
      single: [
        { upTo: 3750, rate: 0 },
        { upTo: 4900, rate: 0.025 },
        { upTo: 7200, rate: 0.035 },
        { upTo: Infinity, rate: 0.045 },
      ],
      married_filing_jointly: [
        { upTo: 7500, rate: 0 },
        { upTo: 9800, rate: 0.025 },
        { upTo: 14400, rate: 0.035 },
        { upTo: Infinity, rate: 0.045 },
      ],
      head_of_household: [
        { upTo: 7500, rate: 0 },
        { upTo: 9800, rate: 0.025 },
        { upTo: 14400, rate: 0.035 },
        { upTo: Infinity, rate: 0.045 },
      ],
      qualifying_widow: [
        { upTo: 7500, rate: 0 },
        { upTo: 9800, rate: 0.025 },
        { upTo: 14400, rate: 0.035 },
        { upTo: Infinity, rate: 0.045 },
      ],
    },
    notes: "OK TY2026 (HB 2764): 0%/2.5%/3.5%/4.5% consolidated brackets; HoH/QSS use the joint column per 68 O.S. §2355.",
  };
  // Hawaii TY2026 (Act 46 SLH 2024 step 2): std deduction doubles to $8,000
  // single/MFS / $16,000 MFJ-QSS / $12,000 HoH (HI DOTAX FAQ "2026 tax year
  // standard deduction amounts"; further steps 2028/2030). Brackets hold the
  // TY2025 Act 46 schedule (next widening is TY2027).
  data.HI = {
    ...data.HI,
    standardDeduction: { single: 8000, married_filing_jointly: 16000, head_of_household: 12000, married_filing_separately: 8000, qualifying_widow: 16000 },
    notes: "HI TY2026: Act 46 std ded $8,000/$16,000/$12,000; brackets hold TY2025 (next widening TY2027).",
  };
  // Maine TY2026 (MRS "2026 individual income tax rate schedules" release —
  // tax years beginning in 2026): ME-indexed (decoupled) std ded $15,300 /
  // $30,600 / $22,950 / $15,300 MFS; brackets single <$27,400 / <$64,850
  // (MFJ exactly 2×: <$54,800 / <$129,700), HoH <$41,100 / <$97,300.
  data.ME = {
    ...data.ME,
    brackets: {
      single: [{ upTo: 27400, rate: 0.058 }, { upTo: 64850, rate: 0.0675 }, { upTo: Infinity, rate: 0.0715 }],
      married_filing_jointly: [{ upTo: 54800, rate: 0.058 }, { upTo: 129700, rate: 0.0675 }, { upTo: Infinity, rate: 0.0715 }],
      head_of_household: [{ upTo: 41100, rate: 0.058 }, { upTo: 97300, rate: 0.0675 }, { upTo: Infinity, rate: 0.0715 }],
    },
    standardDeduction: { single: 15300, married_filing_jointly: 30600, head_of_household: 22950, married_filing_separately: 15300, qualifying_widow: 30600 },
    notes: "ME TY2026: MRS-published indexed brackets + std ded $15,300/$30,600/$22,950 (decoupled from federal).",
  };
  // DC TY2026: Law 26-89 indexes the new $15,000/$30,000/$22,500 basic std
  // ded by COLA for tax years after 2025 — official 2026 amounts not yet
  // published; HOLD the 2025 values (documented; slight over-tax once the
  // COLA lands). 2025 values flow through from build2025Data automatically.
  //
  // West Virginia TY2026 (SB 392, signed 3/31/2026, eff. 6/12/2026 RETROACTIVE
  // to 1/1/2026 — W. Va. Code §11-21-4j): a 5% across-the-board cut from the
  // 2025 rates → 2.11/2.81/3.16/4.22/4.58% at the same $10k/$25k/$40k/$60k
  // thresholds (Bloomberg Tax + Paylocity alerts quoting the enrolled rate
  // table: $211 + 2.81% > $10k; $632.50 + 3.16% > $25k; $1,106.50 + 4.22%
  // > $40k; $1,950.50 + 4.58% > $60k — bracket math hand-verified). Added
  // 2026-06-11; the prior "next trigger window Jan 2027" note was stale.
  data.WV = {
    ...data.WV,
    brackets: {
      single: [
        { upTo: 10000, rate: 0.0211 }, { upTo: 25000, rate: 0.0281 },
        { upTo: 40000, rate: 0.0316 }, { upTo: 60000, rate: 0.0422 },
        { upTo: Infinity, rate: 0.0458 },
      ],
      married_filing_jointly: [
        { upTo: 10000, rate: 0.0211 }, { upTo: 25000, rate: 0.0281 },
        { upTo: 40000, rate: 0.0316 }, { upTo: 60000, rate: 0.0422 },
        { upTo: Infinity, rate: 0.0458 },
      ],
    },
    notes: "WV TY2026 (SB 392): 2.11/2.81/3.16/4.22/4.58% retroactive to 1/1/2026. $2,000/filer exemption not modeled.",
  };
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
