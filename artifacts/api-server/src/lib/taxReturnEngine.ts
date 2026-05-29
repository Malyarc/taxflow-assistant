/**
 * Pure tax return engine — Haven-portable.
 *
 * NO database access. NO Drizzle imports. Just plain objects in, ComputedTaxReturn out.
 * The Drizzle/Express adapter lives in taxReturnPipeline.ts.
 *
 * This boundary exists so the engine can drop into any TypeScript codebase
 * (Haven App, other CPA tools, batch processors) without dragging the
 * persistence layer.
 *
 * Input philosophy:
 *   - Fact types (ClientFacts, W2Fact, etc.) define exactly the fields the
 *     engine reads. Drizzle row types satisfy these (structural typing).
 *   - Numeric fields accept `string | number | null | undefined` because
 *     Drizzle `numeric()` columns are typed as strings. Haven can pass
 *     plain numbers — both work.
 *
 * Adding new features: extend the relevant Fact interface (additive), wire
 * into the orchestration below. The pipeline adapter inherits the new fields
 * automatically from Drizzle row types.
 */

import {
  runTaxCalculation,
  calculateChildTaxCredit,
  calculateSelfEmploymentTax,
  calculateSehiDeduction,
  calculateSocialSecurityTaxability,
  calculateFeie,
  calculateNiit,
  calculateAdditionalMedicareTax,
  calculateQbi,
  calculateAmt,
  calculateFederalTaxWithCapitalGains,
  calculateScheduleA,
  calculateEitc,
  nycEitcRateForAgi,
  calculateEducationCredits,
  calculateRetirementDeductions,
  calculateSaversCredit,
  calculateDependentCareCredit,
  calculateEducatorExpenses,
  calculateStudentLoanInterest,
  calculateForeignTaxCredit,
  calculateResidentialEnergyCredits,
  calculatePremiumTaxCredit,
  calculateStateTax,
  calculateMultiStateTax,
  calculateStateEitc,
  calculateStateCtc,
  calculateStateAdditionalCredits,
  getStateRetirementExemption,
  calculatePassiveActivityLossAllowance,
  calculateMacrsDepreciation,
  getFederalStandardDeduction,
  type MultiStateTaxResult,
  type StateEitcCalculation,
  type PassiveActivityLossResult,
  type CtcCalculation,
  type SeTaxCalculation,
  type SehiCalculation,
  type SsTaxabilityCalculation,
  type FeieCalculation,
  type NiitCalculation,
  type AdditionalMedicareTaxCalculation,
  type QbiCalculation,
  type AmtCalculation,
  type CapitalGainsCalculation,
  type ScheduleACalculation,
  type EitcCalculation,
  type EducationCreditsCalculation,
  type RetirementDeductionsCalculation,
  type SaversCreditCalculation,
  type DependentCareCreditCalculation,
  type EducatorExpensesCalculation,
  type StudentLoanInterestCalculation,
  type ForeignTaxCreditCalculation,
  type ResidentialEnergyCreditsCalculation,
  type PremiumTaxCreditCalculation,
} from "./taxCalculator";

// ── Loose numeric coercion ──────────────────────────────────────────────────
// Drizzle numeric() columns are strings; Haven might pass plain numbers.
// Both work. Non-finite results are logged to surface silent-zero bugs
// (e.g. an AI extraction stored `"$1,200.00"` instead of `1200.00`).
type Numish = string | number | null | undefined;
function toNum(val: Numish): number {
  if (val == null) return 0;
  const n = Number(val);
  if (!Number.isFinite(n)) {
    // Surface this — silent-zero in money math is the worst class of
    // bug we have. Engine still returns 0 to avoid breaking the pipeline.
    // eslint-disable-next-line no-console
    console.warn(`toNum: non-finite value coerced to 0`, { value: String(val).slice(0, 64) });
    return 0;
  }
  return n;
}

// ── Fact types — exactly the fields the engine reads ────────────────────────
// These are intentionally permissive so any source (Drizzle, Prisma, raw API,
// hand-built test fixture) can satisfy them.

/**
 * Client facts read by the engine. Drizzle's `Client` row satisfies this
 * via structural typing.
 */
export interface ClientFacts {
  filingStatus: string;
  state?: string | null;
  taxYear?: number | null;
  dependentsUnder17?: number | null;
  otherDependents?: number | null;
  dependentsForCareCredit?: number | null;
  taxpayerAge?: number | null;
  spouseAge?: number | null;
  spouseEarnedIncome?: Numish;
  hsaIsFamilyCoverage?: boolean | null;
  iraCoveredByWorkplacePlan?: boolean | null;
  eligibleEducatorCount?: number | null;
  acaAnnualPremium?: Numish;
  acaAnnualSlcsp?: Numish;
  acaAdvanceAptc?: Numish;
  acaHouseholdSize?: number | null;
  rentalActiveParticipant?: boolean | null;
  rentalRealEstateProfessional?: boolean | null;
  /** Local income tax jurisdiction code (currently "NYC"). Null = no local PIT. */
  localityCode?: string | null;
  /** K10 — Total SS benefits (Box 5 SSA-1099 + RRB-1099). Null/0 = no SS. */
  socialSecurityBenefits?: Numish;
  /** K10 — MFS lived apart from spouse all year (per Pub 915 — true = single-rules
   *  thresholds; false = MFS-with-spouse, $0 threshold → 85% taxable). */
  mfsLivedApartAllYear?: boolean | null;
  /** K8 — Form 8615 kiddie-tax filer flag. When true and unearned income
   *  > $2,600, the excess is taxed at parent's marginal rate. */
  isKiddieTaxFiler?: boolean | null;
  /** K8 — Parent's top marginal rate (decimal: 0.10/0.12/0.22/0.24/0.32/0.35/0.37). */
  parentsTopMarginalRate?: Numish;
  /**
   * E6 — Pub 525 tax-benefit rule for 1099-G state refund.
   * When true, the prior year's return itemized (Sched A > std ded) so
   * any state refund this year is federal-taxable. When false/null, the
   * client used the standard deduction last year and state refunds are
   * excluded from this year's federal taxable income.
   *
   * Pipeline auto-derives this from prior-year tax_returns row (itemized
   * deductions present + > std ded). Treats null as "default exclusion"
   * (tax-friendly) when no prior-year data is available.
   */
  priorYearItemized?: boolean | null;
  /**
   * E12 — Part-year residency flags. When residencyChangedInYear=true AND
   * both formerState + residencyChangeDate are set, the engine pro-rates
   * AGI by days and computes resident-state tax for each period
   * independently.
   */
  residencyChangedInYear?: boolean | null;
  formerState?: string | null;
  residencyChangeDate?: string | null;
  /**
   * Phase H — H9. Client-context fields that personalize planning
   * recommendations. The tax engine itself doesn't use these (calculation
   * is identical regardless), but the planning layer reads them and the
   * AI memo synthesis passes them as prompt context.
   */
  riskTolerance?: string | null;
  targetRetirementAge?: number | null;
  estatePlanStage?: string | null;
  planningGoals?: string | null;
}

export interface W2Fact {
  taxYear?: number | null;
  wagesBox1?: Numish;
  federalTaxWithheldBox2?: Numish;
  /** W-2 Box 3 — Social Security wages. Used for Sch SE Part I Line 9 (SS
   *  wage base shared across W-2 + SE). Falls back to Box 1 when absent. */
  socialSecurityWagesBox3?: Numish;
  /** W-2 Box 5 — Medicare wages (no cap). Used for Form 8959 Additional
   *  Medicare tax. Falls back to Box 1 when absent. */
  medicareWagesBox5?: Numish;
  stateTaxWithheldBox17?: Numish;
  stateCode?: string | null;
  /** K1 MFJ sub-gap — which spouse this W-2 belongs to. Default "taxpayer".
   *  Drives per-spouse Sch SE Line 9 SS wage base computation for MFJ. */
  spouse?: "taxpayer" | "spouse" | string | null;
}

export interface Form1099Fact {
  taxYear?: number | null;
  formType: string; // "nec" | "misc" | "int" | "div" | "b" | "r" | "g" | "k"
  payerName?: string | null;
  /** K1 MFJ sub-gap — which spouse this 1099 belongs to. Default "taxpayer".
   *  Drives per-spouse SE attribution (1099-NEC primarily) for MFJ. */
  spouse?: "taxpayer" | "spouse" | string | null;
  // form-specific fields, all coerced via toNum
  nonemployeeCompensation?: Numish;
  interestIncome?: Numish;
  taxExemptInterest?: Numish;
  ordinaryDividends?: Numish;
  qualifiedDividends?: Numish;
  totalCapitalGainDistribution?: Numish;
  shortTermGainLoss?: Numish;
  longTermGainLoss?: Numish;
  taxableAmount?: Numish;
  grossDistribution?: Numish;
  unemploymentCompensation?: Numish;
  stateLocalRefund?: Numish;
  grossPaymentAmount?: Numish;
  rents?: Numish;
  royalties?: Numish;
  otherIncome?: Numish;
  fishingBoatProceeds?: Numish;
  medicalAndHealthcare?: Numish;
  federalTaxWithheld?: Numish;
  stateTaxWithheld?: Numish;
}

export interface AdjustmentFact {
  adjustmentType: string;
  amount: Numish;
  isApplied?: boolean | null;
}

export interface RecalcOverrides {
  taxYear?: number;
  additionalIncome?: number;
  additionalDeductions?: number;
  useItemizedDeductions?: boolean;
}

/**
 * Schedule D / Form 8949 per-transaction fact.
 *
 * When the engine receives any capitalTransactions for the tax year,
 * the per-transaction aggregate replaces the 1099-B-derived ST/LT
 * cap-gain totals. 1099-DIV box 2a cap-gain distributions remain
 * additive to LT (they're separate from 8949 transactions).
 *
 * Per Form 8949: gainLoss = proceeds − costBasis + adjustmentAmount.
 * Wash-sale-disallowed amounts come in through adjustmentAmount with
 * adjustmentCode = "W" (broker-reported in 1099-B Box 1g).
 *
 * formBox: A/B/C = short-term, D/E/F = long-term.
 */
export interface CapitalTransactionFact {
  taxYear: number;
  description?: string | null;
  dateAcquired?: string | null;
  dateSold?: string | null;
  proceeds?: Numish;
  costBasis?: Numish;
  adjustmentCode?: string | null;
  adjustmentAmount?: Numish;
  washSaleDisallowed?: Numish;
  /** E13 — TRUE when engine identified the wash sale (vs broker-reported "W"). */
  washSaleAutoDetected?: boolean | null;
  formBox?: "A" | "B" | "C" | "D" | "E" | "F" | string | null;
}

/**
 * Per-property rental real estate (Schedule E) fact.
 *
 * When the engine receives any rentalProperties for the tax year, it uses
 * them for Schedule E aggregation (sum of per-property income, expenses,
 * and computed MACRS depreciation) and ignores the legacy aggregate
 * `schedule_e_rental_*` adjustments. If the array is empty/absent the
 * legacy adjustment-based path runs unchanged.
 */
export interface RentalPropertyFact {
  taxYear: number;
  address?: string | null;
  propertyType?: "residential" | "commercial" | string | null;
  basis?: Numish;
  placedInServiceYear?: number | null;
  placedInServiceMonth?: number | null;
  isActiveParticipant?: boolean | null;
  rentalIncome?: Numish;
  totalExpenses?: Numish;
  /**
   * C11 — Optional 2-letter state code for the property's physical location.
   * When the filer is part-year (E12) and full-source allocation marker is
   * enabled (`part_year_use_full_source_allocation`), rental net income flows
   * to the state where the property sits, not pro-rata-by-days. Most real-
   * estate sourcing rules require this (situs-of-property rule).
   */
  sourceState?: string | null;
}

/**
 * Per-K-1 (partnership 1065 / S-corp 1120-S) pass-through fact.
 *
 * When the engine receives any K-1 rows for the tax year, it sums per-K-1
 * income across the boxes and flows them into the appropriate schedules:
 *   - Active K-1 Box 1 / Box 3 ordinary → Sch E Part II → 1040 Line 8
 *   - Passive K-1 Box 1 / Box 3 + ALL Box 2 (RE) → K-1 passive bucket
 *     (no $25k allowance — net loss fully suspended → carryforward)
 *   - Box 5 / 6a / 6b / 7 → Sch B / Sch E Part I
 *   - Box 8 / 9a → Sch D (cross-nets with other 8949 transactions)
 *   - Box 14A (1065 only) → Schedule SE
 *   - §199A (Box 20 Z on 1065 / Box 17 V on 1120-S) → §199A calc
 *
 * Known simplifications (per CLAUDE.md):
 *   - §199A W-2-wage + UBIA limits not enforced
 *   - SSTB phase-out not modeled
 *   - Basis / at-risk limits stored but not enforced
 */
export interface ScheduleK1Fact {
  taxYear: number;
  entityName?: string | null;
  entityEin?: string | null;
  entityType?: "partnership" | "s_corp" | string | null;
  activityType?: "active" | "passive" | string | null;
  box1OrdinaryIncome?: Numish;
  box2RentalRealEstate?: Numish;
  box3OtherRentalIncome?: Numish;
  interestIncome?: Numish;
  ordinaryDividends?: Numish;
  qualifiedDividends?: Numish;
  royalties?: Numish;
  netShortTermCapitalGain?: Numish;
  netLongTermCapitalGain?: Numish;
  selfEmploymentEarnings?: Numish;
  section199aQbi?: Numish;
  section199aW2Wages?: Numish;
  section199aUbia?: Numish;
  basisAtYearStart?: Numish;
  basisAtYearEnd?: Numish;
  atRiskAmount?: Numish;
  /**
   * C11 — Optional 2-letter state code for the K-1's pass-through state.
   * When the filer is part-year (E12) and full-source allocation marker is
   * enabled (`part_year_use_full_source_allocation`), K-1 income flows to
   * the source state rather than pro-rata-by-days. Real K-1 sourcing per
   * NY IT-203 / CA 540NR Schedule CA pattern.
   */
  sourceState?: string | null;
}

/**
 * Phase H — H5. Per-account asset balance fact (IRA / Roth / 401(k) / HSA /
 * employer stock / etc.). Used by H6 Form 8606 + H1 NUA / Mega-Backdoor
 * Roth detectors. Drizzle row satisfies via structural typing.
 */
export interface AssetBalanceFact {
  taxYear: number;
  assetType: string;
  accountName: string;
  balance?: Numish;
  costBasis?: Numish;
  afterTaxBasis?: Numish;
  nuaEligible?: boolean | null;
}

/**
 * Complete inputs for the pure engine. The adapter (DB-backed) constructs
 * these by loading the relevant rows; Haven (or tests) build them by hand.
 */
export interface TaxReturnInputs {
  client: ClientFacts;
  w2s: W2Fact[];
  form1099s: Form1099Fact[];
  adjustments: AdjustmentFact[];
  /** Optional per-property Schedule E rental real estate (overrides aggregate adjustments). */
  rentalProperties?: RentalPropertyFact[];
  /** Optional Schedule D / Form 8949 per-transaction rows (overrides 1099-B aggregates). */
  capitalTransactions?: CapitalTransactionFact[];
  /** Optional Schedule K-1 rows (partnership + S-corp pass-through). */
  scheduleK1?: ScheduleK1Fact[];
  /** Phase H — H5. Optional per-account asset balances. Used by H6 + H1 detectors. */
  assetBalances?: AssetBalanceFact[];
  /** The resolved tax year. Engine does NOT re-resolve from client.taxYear. */
  taxYear: number;
  overrides?: RecalcOverrides;
  /** Legacy single-number itemized deductions fallback (existing tax_return row) */
  existingItemizedFallback?: Numish;
}

// ── 1099 summary ────────────────────────────────────────────────────────────

/** Schedule B Part I (interest) and Part II (dividends) per-payer detail */
export interface ScheduleBPayer {
  payerName: string;
  interestIncome: number;
  taxExemptInterest: number;
  ordinaryDividends: number;
  qualifiedDividends: number;
  totalCapitalGainDistribution: number;
  federalWithheld: number;
}

export interface Form1099Summary {
  /** Self-employment income (1099-NEC) */
  seIncome: number;
  /** Ordinary interest (1099-INT minus tax-exempt portion) */
  interestIncome: number;
  /** Tax-exempt interest (1099-INT Box 8 — excluded from AGI; used for K10
   *  Pub 915 SS taxability provisional-income calc). */
  taxExemptInterest: number;
  /** Ordinary (non-qualified) dividends from 1099-DIV */
  ordinaryDividends: number;
  /** Qualified dividends — LTCG rates */
  qualifiedDividends: number;
  /** Long-term capital gains (1099-B + 1099-DIV cap gain distribution) */
  longTermCapitalGains: number;
  /** Short-term capital gains (1099-B) */
  shortTermCapitalGains: number;
  /** Retirement income (1099-R taxable amount) */
  retirementIncome: number;
  /** E5 — IRC §72(t) early-withdrawal penalty (10% on code "1", 25% on code "S"). Added to total federal liability on Sched 2 Line 8. */
  earlyWithdrawalPenalty: number;
  /** Unemployment + state refund (1099-G) */
  unemploymentIncome: number;
  /** E6 — 1099-G Box 1 only (unemployment comp). IRC §85 fully federal-taxable. */
  unemploymentCompensationOnly: number;
  /** E6 — 1099-G Box 2 only (state/local refund). Pub 525 tax-benefit rule applies. */
  stateLocalRefundOnly: number;
  /** 1099-K gross payment (treated as additional income unless adjusted) */
  paymentCardIncome: number;
  /** 1099-MISC: rents + royalties + other income */
  miscIncome: number;
  /** 1099-MISC Box 1 rents only (subset of miscIncome) — NIIT NII base */
  rents: number;
  /** 1099-MISC Box 2 royalties only (subset of miscIncome) — NIIT NII base */
  royalties: number;
  /** Federal withholding across all 1099s */
  federalWithheld: number;
  /** State withholding across all 1099s */
  stateWithheld: number;
  /** Total ordinary income from all 1099 sources (excludes LTCG/qualifed dividends) */
  totalOrdinaryIncome: number;
  /** All investment income (drives NIIT) */
  totalInvestmentIncome: number;
  /** Number of 1099 records included */
  recordCount: number;
  /** Schedule B Part I/II per-payer breakdown — interest & dividend payers (1099-INT, 1099-DIV) */
  scheduleBPayers: ScheduleBPayer[];
  /** Whether Schedule B is REQUIRED to be filed (interest > $1,500 OR ordinary dividends > $1,500) */
  scheduleBRequired: boolean;
}

export function summarize1099s(records: Form1099Fact[]): Form1099Summary {
  const necRecords = records.filter((r) => r.formType === "nec");
  const miscRecords = records.filter((r) => r.formType === "misc");
  const intRecords = records.filter((r) => r.formType === "int");
  const divRecords = records.filter((r) => r.formType === "div");
  const bRecords = records.filter((r) => r.formType === "b");
  const rRecords = records.filter((r) => r.formType === "r");
  const gRecords = records.filter((r) => r.formType === "g");
  const kRecords = records.filter((r) => r.formType === "k");

  const seIncome = necRecords.reduce((s, r) => s + toNum(r.nonemployeeCompensation), 0);

  // Interest: total minus tax-exempt portion
  const interestIncome = intRecords.reduce(
    (s, r) => s + Math.max(0, toNum(r.interestIncome) - toNum(r.taxExemptInterest)),
    0,
  );
  // Tax-exempt interest (1099-INT Box 8) — excluded from AGI but informs the
  // Pub 915 SS taxability provisional-income calculation (K10).
  const taxExemptInterest = intRecords.reduce(
    (s, r) => s + toNum(r.taxExemptInterest), 0);

  const qualifiedDividends = divRecords.reduce((s, r) => s + toNum(r.qualifiedDividends), 0);
  // Ordinary dividends per IRS Form 1040 = box 1a - box 1b (qualified portion subtracted)
  const ordinaryDividends = divRecords.reduce(
    (s, r) => s + Math.max(0, toNum(r.ordinaryDividends) - toNum(r.qualifiedDividends)),
    0,
  );
  const cgDistributions = divRecords.reduce((s, r) => s + toNum(r.totalCapitalGainDistribution), 0);

  // 1099-B: short-term and long-term gain/loss
  const stcgFromB = bRecords.reduce((s, r) => s + toNum(r.shortTermGainLoss), 0);
  const ltcgFromB = bRecords.reduce((s, r) => s + toNum(r.longTermGainLoss), 0);

  const longTermCapitalGains = ltcgFromB + cgDistributions;
  const shortTermCapitalGains = stcgFromB;

  const retirementIncome = rRecords.reduce(
    (s, r) => s + toNum(r.taxableAmount ?? r.grossDistribution),
    0,
  );

  // E5 — IRC §72(t) Early-Withdrawal Additional Tax (Form 5329 / Sched 2 Line 8).
  // 10% penalty applies on the TAXABLE portion of an early distribution
  // (before age 59½). The distribution code (Box 7) determines penalty:
  //   - "1": Early, no known exception → 10% penalty
  //   - "S": SIMPLE IRA early w/in first 2 years → 25% penalty (IRC §72(t)(6))
  //   - "2", "3", "4", "G", "7", "T", "Q", "H", "U", "M", "N", "R": no penalty
  //   - Other / blank: conservatively no auto-penalty; CPA override via
  //     adjustment.
  // Note: trusts the code as reported on 1099-R Box 7. If client turned
  // 59½ mid-year and broker should have re-coded but didn't, CPA fixes
  // by editing the 1099-R record. We don't auto-derive from taxpayerAge —
  // distribution-date is what matters, not year-end age.
  let earlyWithdrawalPenalty = 0;
  for (const r of rRecords) {
    const code = ((r as { distributionCode?: string | null }).distributionCode ?? "").trim();
    const taxable = toNum(r.taxableAmount ?? r.grossDistribution);
    if (taxable <= 0) continue;
    if (code === "1") {
      earlyWithdrawalPenalty += taxable * 0.10;
    } else if (code === "S") {
      // SIMPLE IRA in first 2 years of participation: 25% (IRC §72(t)(6)).
      earlyWithdrawalPenalty += taxable * 0.25;
    }
    // All other codes: 0 penalty. CPA can add a manual additional-tax
    // adjustment for unusual scenarios (e.g., code 8 excess contribs).
  }
  // E6 — IRC §85 (unemployment fully federal-taxable) + Pub 525 tax-benefit
  // rule for state refunds. We split the 1099-G fields here so the caller
  // can apply the tax-benefit rule (state refund only taxable if prior year
  // itemized). The two totals are summed downstream only if/when the rule
  // confirms taxability.
  const unemploymentCompensationOnly = gRecords.reduce(
    (s, r) => s + toNum(r.unemploymentCompensation), 0);
  const stateLocalRefundOnly = gRecords.reduce(
    (s, r) => s + toNum(r.stateLocalRefund), 0);
  // Backwards-compat: original `unemploymentIncome` field totals BOTH so
  // existing call sites that don't apply the tax-benefit rule see the
  // legacy behavior. Code that wants Pub 525 should use the split fields.
  const unemploymentIncome = unemploymentCompensationOnly + stateLocalRefundOnly;
  const paymentCardIncome = kRecords.reduce((s, r) => s + toNum(r.grossPaymentAmount), 0);
  const miscIncome = miscRecords.reduce(
    (s, r) =>
      s +
      toNum(r.rents) +
      toNum(r.royalties) +
      toNum(r.otherIncome) +
      toNum(r.fishingBoatProceeds) +
      toNum(r.medicalAndHealthcare),
    0,
  );
  // 1099-MISC Box 1 (rents) and Box 2 (royalties) split out of miscIncome so
  // the NIIT base (§1411 investment income) can include them specifically —
  // miscIncome also contains other/fishing/medical, which are NOT NII.
  const rents = miscRecords.reduce((s, r) => s + toNum(r.rents), 0);
  const royalties = miscRecords.reduce((s, r) => s + toNum(r.royalties), 0);

  const federalWithheld = records.reduce((s, r) => s + toNum(r.federalTaxWithheld), 0);
  const stateWithheld = records.reduce((s, r) => s + toNum(r.stateTaxWithheld), 0);

  // Ordinary income from 1099s: includes everything taxed at ordinary rates
  // (NEC handled separately — flows through SE tax pipeline; NEC also shows up as ordinary income).
  // STCG is taxed at ordinary rates but gets stacked separately in the calc.
  const totalOrdinaryIncome =
    seIncome + miscIncome + interestIncome + ordinaryDividends + retirementIncome +
    unemploymentIncome + paymentCardIncome;

  // Investment income for NIIT: interest + dividends (all) + capital gains (all)
  const totalInvestmentIncome =
    interestIncome + ordinaryDividends + qualifiedDividends + longTermCapitalGains + shortTermCapitalGains;

  // ── Schedule B per-payer aggregation ──
  // Group 1099-INT and 1099-DIV records by payerName for Schedule B reporting.
  // Schedule B is REQUIRED when interest > $1,500 OR ordinary dividends > $1,500.
  const payerMap = new Map<string, ScheduleBPayer>();
  const ensurePayer = (name: string | null | undefined): ScheduleBPayer => {
    const key = (name && name.trim()) || "(Unspecified Payer)";
    let p = payerMap.get(key);
    if (!p) {
      p = {
        payerName: key,
        interestIncome: 0,
        taxExemptInterest: 0,
        ordinaryDividends: 0,
        qualifiedDividends: 0,
        totalCapitalGainDistribution: 0,
        federalWithheld: 0,
      };
      payerMap.set(key, p);
    }
    return p;
  };

  for (const r of intRecords) {
    const p = ensurePayer(r.payerName);
    p.interestIncome += Math.max(0, toNum(r.interestIncome) - toNum(r.taxExemptInterest));
    p.taxExemptInterest += toNum(r.taxExemptInterest);
    p.federalWithheld += toNum(r.federalTaxWithheld);
  }
  for (const r of divRecords) {
    const p = ensurePayer(r.payerName);
    p.qualifiedDividends += toNum(r.qualifiedDividends);
    p.ordinaryDividends += Math.max(0, toNum(r.ordinaryDividends) - toNum(r.qualifiedDividends));
    p.totalCapitalGainDistribution += toNum(r.totalCapitalGainDistribution);
    p.federalWithheld += toNum(r.federalTaxWithheld);
  }

  const scheduleBPayers = [...payerMap.values()].sort((a, b) =>
    a.payerName.localeCompare(b.payerName),
  );
  // Schedule B required when interest > $1,500 OR dividends > $1,500
  // Note: this uses ordinary dividends as reported on 1099-DIV Box 1a (which
  // INCLUDES qualified dividends per IRS Sched B instructions)
  const totalOrdinaryDivsForSchedB = ordinaryDividends + qualifiedDividends;
  const scheduleBRequired = interestIncome > 1500 || totalOrdinaryDivsForSchedB > 1500;

  return {
    seIncome,
    interestIncome,
    taxExemptInterest,
    ordinaryDividends,
    qualifiedDividends,
    longTermCapitalGains,
    shortTermCapitalGains,
    retirementIncome,
    earlyWithdrawalPenalty,
    unemploymentIncome,
    unemploymentCompensationOnly,
    stateLocalRefundOnly,
    paymentCardIncome,
    miscIncome,
    rents,
    royalties,
    federalWithheld,
    stateWithheld,
    totalOrdinaryIncome,
    totalInvestmentIncome,
    recordCount: records.length,
    scheduleBPayers,
    scheduleBRequired,
  };
}

/**
 * Schedule K-1 aggregate summary — totals across all K-1 rows for the year.
 *
 * Reported for UI/diagnostics. K-1 amounts have already been folded into
 * AGI / Schedule D / Schedule SE / §199A by the time the engine returns.
 *
 * `k1PassiveLossSuspended` — net K-1 passive loss carrying forward to
 * next year (driven by IRS Pub 925 §469 framework; persists via the
 * `k1_passive_loss_carryforward` adjustment type).
 */
export interface ScheduleK1Summary {
  k1Count: number;
  partnershipCount: number;
  sCorpCount: number;
  totalActiveOrdinaryIncome: number;
  totalPassiveBucketNetApplied: number;
  k1PassiveLossSuspended: number;
  totalInterestIncome: number;
  totalOrdinaryDividends: number;
  totalQualifiedDividends: number;
  totalRoyalties: number;
  totalShortTermCapitalGain: number;
  totalLongTermCapitalGain: number;
  totalSelfEmploymentEarnings: number;
  totalQbiContribution: number;
}

// ── ComputedTaxReturn ───────────────────────────────────────────────────────

export interface ComputedTaxReturn {
  /** Tax year actually computed for */
  taxYear: number;
  filingStatus: string;
  stateCode: string;
  totalIncome: number;
  adjustedGrossIncome: number;
  standardDeduction: number;
  itemizedDeductions: number | null;
  /** QBI deduction (Section 199A), reduces taxable income further */
  qbiDeduction: number;
  taxableIncome: number;
  federalTaxLiability: number;
  federalTaxWithheld: number;
  federalRefundOrOwed: number;
  stateTaxLiability: number;
  stateTaxWithheld: number;
  stateRefundOrOwed: number;
  effectiveTaxRate: number;
  /** Sum of CPA-authored "credit" adjustments applied (manual entries) */
  manualCreditsApplied: number;
  /** Auto-computed Child Tax Credit + Credit for Other Dependents */
  childTaxCredit: CtcCalculation;
  /** Self-employment tax (15.3% on net SE earnings) */
  selfEmploymentTax: number;
  /** Net Investment Income Tax (3.8% IRC §1411) */
  niitTax: number;
  /** Additional Medicare Tax (0.9% Form 8959, IRC §3101(b)(2)/§1401(b)(2))
   *  on Medicare wages + SE net above filing-status threshold */
  additionalMedicareTax: number;
  /** AMT delta — additional tax beyond regular tax. Often $0. */
  amtTax: number;
  /** Refundable portion of CTC (Additional Child Tax Credit) */
  additionalChildTaxCredit: number;
  /** Federal tax owed on long-term capital gains + qualified dividends (preferential rate) */
  capitalGainsTax: number;
  /** Long-term capital gains + qualified dividends (preferential-rate income) */
  preferentialIncome: number;
  /** Summary of all 1099 records included in this return */
  form1099Summary: Form1099Summary;
  // ── Phase 1 line items ─────────────────────────────────────────────────
  scheduleA: ScheduleACalculation;
  scheduleCExpenses: number;
  retirementDeductions: RetirementDeductionsCalculation;
  eitc: EitcCalculation;
  educationCredits: EducationCreditsCalculation;
  saversCredit: SaversCreditCalculation;
  dependentCareCredit: DependentCareCreditCalculation;
  // ── Phase 1.5 line items ───────────────────────────────────────────────
  educatorExpenses: EducatorExpensesCalculation;
  studentLoanInterest: StudentLoanInterestCalculation;
  foreignTaxCredit: ForeignTaxCreditCalculation;
  residentialEnergyCredits: ResidentialEnergyCreditsCalculation;
  premiumTaxCredit: PremiumTaxCreditCalculation;
  /** K5 — Self-Employed Health Insurance deduction (Form 7206), above-the-line.
   *  Computed from `self_employed_health_insurance_premiums` adjustment, capped
   *  at (net SE earnings − half-SE). */
  sehi: SehiCalculation;
  /** K10 — Total SS benefits (Form 1040 Line 6a, gross). */
  socialSecurityBenefits: number;
  /** K10 — Taxable portion of SS (Form 1040 Line 6b), per Pub 915. */
  socialSecurityTaxable: number;
  /** K10 — Detailed Pub 915 worksheet for transparency. */
  socialSecurityTaxabilityDetail: SsTaxabilityCalculation;
  /** K9 — Foreign Earned Income Exclusion detail (Form 2555). */
  feie: FeieCalculation;
  /** K4 — NOL carryforward applied this year (capped at 80% of taxable income). */
  nolDeduction: number;
  /** K4 — NOL carryforward remaining for next tax year. */
  nolCarryforwardRemaining: number;
  /** E2 — Form 8801 minimum-tax credit applied against regular tax this year. */
  amtCreditApplied: number;
  /** E2 — Form 8801 minimum-tax credit generated by this year's AMT (simplified: equals amtTax). */
  amtCreditGenerated: number;
  /** E2 — Form 8801 unused minimum-tax credit carried forward to next year. */
  amtCreditCarryforwardRemaining: number;
  /**
   * E3 — Cash charitable contribution carried forward to next tax year
   * (IRC §170(d)(1) — excess above 60% AGI cap, up to 5 years).
   * Sum of (current-year excess + unused prior-year carryforward).
   */
  charitableCarryforwardCashRemaining: number;
  /**
   * E5 — IRC §72(t) early-withdrawal additional tax on the taxable portion
   * of 1099-R distributions with Box 7 code "1" (10%) or "S" (25%).
   * Added to total federal liability on Sched 2 Line 8.
   */
  earlyWithdrawalPenalty: number;
  /**
   * E4 — IRC §4973(g) 6% excise on HSA contributions above the §223
   * annual limit. Total = employee `hsa_contribution` + employer
   * `hsa_employer_contribution` adjustments. Reported on Form 5329 Part VII.
   */
  hsaExcessExcise: number;
  /**
   * E7 — §179 expense election applied this year (Form 4562 Line 12).
   * Capped at min(elected, §179 cap with phase-out, net SE income).
   */
  section179Applied: number;
  /**
   * E7 — §179 elected amount not used this year (exceeded net SE income).
   * Carries forward to next year per IRC §179(b)(3)(B). CPA tracks
   * externally for now (no auto-pipeline carryforward yet).
   */
  section179Carryforward: number;
  /**
   * E7 — Bonus depreciation applied this year per IRC §168(k):
   * 60% × basis for TY2024, 40% TY2025. No income limit.
   */
  bonusDepreciationApplied: number;
  /** K7 — §1202 QSBS gross gain on sale of qualifying stock. */
  qsbsGrossGain: number;
  /** K7 — §1202 excluded amount (capped at max($10M, 10×basis)). */
  qsbsSection1202Exclusion: number;
  /** K7 — §1202 taxable remainder added to LTCG. */
  qsbsTaxableGain: number;
  /** K6 — §121 home-sale gross gain on primary residence (from
   *  `home_sale_gross_gain_primary_residence` adjustment). */
  homeSaleGrossGain: number;
  /** K6 — §121 excluded amount ($250k single/HoH/MFS / $500k MFJ/QSS). */
  homeSaleSection121Exclusion: number;
  /** K6 — §121 taxable remainder added to LTCG. */
  homeSaleTaxableGain: number;
  /**
   * C5 — §1031 like-kind exchange (real-property only post-TCJA).
   * Realized gain across all 1031 exchanges. Source: sum of
   * `section_1031_realized_gain` adjustments.
   */
  section1031RealizedGain: number;
  /** C5 — Boot received in cash + non-like-kind property. Source: sum of `section_1031_boot_received` adjustments. */
  section1031BootReceived: number;
  /** C5 — Recognized gain = min(realized, boot). Added to LTCG (long-term per §1031 holding intent). */
  section1031RecognizedGain: number;
  /** C5 — Deferred gain = realized − recognized. Carries to replacement-property basis (informational; not tracked across years). */
  section1031DeferredGain: number;
  /**
   * C6 — ISO disqualifying-disposition ordinary income (IRC §421(b)/§422).
   * Source: `iso_disqualifying_disposition_ordinary` adjustment(s). Flows to
   * ordinary income. NOT FICA-taxed per IRS Notice 2002-47.
   */
  isoDisqualifyingDispositionOrdinary: number;
  /**
   * C6 — §423 ESPP disqualifying-disposition ordinary income.
   * Source: `espp_disqualifying_disposition_ordinary` adjustment(s).
   * Flows to ordinary income. NOT FICA-taxed (§423 special rule).
   */
  esppDisqualifyingDispositionOrdinary: number;
  /** C7 — §163(j) gross business interest expense entered by CPA. */
  section163jBusinessInterestExpense: number;
  /**
   * C7 — §163(j) allowed deduction this year (after 30% × ATI cap).
   * Subtracted from ordinary income (acts as a business deduction).
   */
  section163jAllowedDeduction: number;
  /** C7 — §163(j) disallowed amount carried to next year (indefinite). */
  section163jDisallowedCarryforward: number;
  /**
   * C7 — §461(l) excess business loss addback (TCJA). Positive value
   * added to ordinary income (reverses a prior over-deduction).
   * CPA-supplied.
   */
  section461lExcessLossAddback: number;
  // ── Phase 2 line items ─────────────────────────────────────────────────
  /** Capital loss deducted against ordinary income (Schedule D Line 21, $3k/$1.5k cap) */
  capitalLossDeducted: number;
  /** Short-term capital loss carryforward to next tax year (preserves character per Pub 550) */
  capitalLossCarryforwardShort: number;
  /** Long-term capital loss carryforward to next tax year */
  capitalLossCarryforwardLong: number;
  /** Net capital gain or loss (Schedule D Line 16, can be negative) — after netting + cross-netting */
  netCapitalGainLoss: number;
  /** State retirement-income exemption applied (PA, IL, MS subtract qualified retirement) */
  stateRetirementExemption: number;
  /** State EITC — refundable. CA (approximate per FTB 3514) + NY (30% of federal). */
  stateEitc: StateEitcCalculation;
  /** Multi-state breakdown — resident state tax (after credit), non-resident state taxes, reciprocity status */
  multiState: MultiStateTaxResult;
  /** Schedule E rental real estate — gross net (income - expenses - depreciation - prior carryforward) */
  scheduleERentalGrossNet: number;
  /** Schedule E rental income applied to AGI (after §469 PAL limit if loss) */
  scheduleERentalAppliedToAgi: number;
  /** §469 passive activity loss allowance result (null if no rental loss) */
  passiveActivityLoss: PassiveActivityLossResult | null;
  /** Schedule E passive loss suspended to next year */
  scheduleEPassiveLossSuspended: number;
  /** Schedule K-1 (partnership + S-corp) aggregate summary */
  scheduleK1: ScheduleK1Summary;
  /** Local-jurisdiction income tax (NYC for now). Zero when no local jurisdiction applies. */
  localTaxLiability: number;
  /** The local jurisdiction this tax was computed for ("NYC", etc.). Null when none. */
  localTaxJurisdiction: string | null;
  /** Detailed breakdowns for transparency */
  detail: {
    se: SeTaxCalculation;
    niit: NiitCalculation;
    additionalMedicare: AdditionalMedicareTaxCalculation;
    qbi: QbiCalculation;
    amt: AmtCalculation;
    capitalGains: CapitalGainsCalculation;
  };
  /** Number of W-2s included in the total wages */
  w2Count: number;
  /** Number of 1099 records included */
  form1099Count: number;
  /**
   * E13 — Number of wash sales identified by the engine (per IRC §1091).
   * Excludes broker-reported wash sales (adjustmentCode "W") which are
   * honored as-is. Set on the loss-row that was disallowed.
   */
  washSalesDetected: number;
  /**
   * E13 — Total $ of capital loss disallowed by auto wash-sale detection.
   * Each detected wash sale reverses the loss by incrementing the row's
   * adjustmentAmount; the replacement transaction's costBasis is increased
   * by the same amount per IRC §1091(d) (basis adjustment + holding-period
   * tack-on for the replacement shares).
   */
  washSaleLossDisallowed: number;
  /**
   * E12 — Part-year residency tax (former state). 0 when full-year resident.
   */
  formerStateTax: number;
  /**
   * E12 — Two-letter code of the prior resident state, or null when full-year.
   */
  formerStateCode: string | null;
  /**
   * E12 — Days resident in former state (Jan 1 to changeDate). 0 when full-year.
   */
  daysFormerStateResident: number;
  /**
   * E12 — Days resident in current state (changeDate to Dec 31). 0 when full-year.
   */
  daysCurrentStateResident: number;
}

// ── E13 — Auto wash-sale detection ──────────────────────────────────────────
//
// IRC §1091(a): loss on the sale of stock or securities is DISALLOWED when
// the taxpayer acquires substantially identical stock or securities within
// 30 days before OR 30 days after the sale (a 61-day window centered on
// the sale date).
//
// IRC §1091(d): the disallowed loss is ADDED to the basis of the replacement
// shares, and the replacement shares' holding period TACKS ON to include the
// original shares' holding period.
//
// Engine algorithm (operates on the year's CapitalTransactionFact[]):
//
//  1. For each LOSS sale S (proceeds + adjustmentAmount − costBasis < 0):
//     - SKIP if S.adjustmentCode already contains "W" (broker-reported);
//       we honor those as-is, no double-counting.
//     - SKIP if S.dateSold is missing (can't compute the 61-day window).
//
//  2. Look for a REPLACEMENT purchase by scanning the SAME tax year's
//     transactions for another row T where:
//       - same `description` (case-insensitive, trimmed = same security)
//       - T !== S (skip self)
//       - T.dateAcquired is non-null and falls within
//         [S.dateSold − 30 days, S.dateSold + 30 days] inclusive
//     The candidate with the EARLIEST dateAcquired wins (deterministic).
//
//  3. When a replacement is found:
//       - Disallowed amount = |loss| (full disallowance — partial-wash math
//         based on share counts not modeled, sub-gap documented).
//       - S.adjustmentAmount += disallowedAmount  (loss reversed on Form 8949)
//       - S.washSaleAutoDetected = true
//       - T.costBasis += disallowedAmount         (§1091(d) basis add)
//
//  4. §1091(d) holding-period tack-on: when T's `formBox` would now reflect a
//     longer holding period due to the original shares' acquisition, the box
//     could shift from C → F etc. Engine does NOT auto-flip formBox (the CPA
//     verifies via the Schedule D tab); documented sub-gap.
//
// Known sub-gaps:
//   - Replacement shares bought-and-held within the year (never sold) are
//     INVISIBLE to the detector (schema models dispositions only). CPAs
//     enter those wash sales manually via adjustmentCode = "W".
//   - Partial wash (rebought fewer replacement shares than sold) — engine
//     fully disallows; should be share-proportional.
//   - Cross-account wash (broker A sells, broker B buys) — only detected
//     when both brokers' transactions are entered into capital_transactions.
//   - Formal §1091(d) holding-period flip from ST to LT on the replacement
//     row is not auto-applied to formBox.

function txnGainLossRaw(t: CapitalTransactionFact): number {
  return toNum(t.proceeds) - toNum(t.costBasis) + toNum(t.adjustmentAmount);
}

function normalizeSecurity(desc: string | null | undefined): string {
  return (desc ?? "").trim().toLowerCase();
}

function parseISO(d: string | null | undefined): Date | null {
  if (!d) return null;
  // Accept ISO date or full timestamp; reject obviously bad strings.
  const ms = Date.parse(d);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

const ONE_DAY_MS = 86400000;

export interface WashSaleDetectionResult {
  /** Transactions post-detection: loss rows have adjustmentAmount + washSaleAutoDetected updated; replacements have costBasis increased. */
  adjustedTransactions: CapitalTransactionFact[];
  /** Number of LOSS rows that were disallowed by auto-detection. */
  washSalesDetected: number;
  /** Total $ disallowed (sum of |loss| reversed across all detections). */
  washSaleLossDisallowed: number;
}

/** E13 — Auto wash-sale detector. See module-level comment above for
 *  algorithm + scope. Returns a NEW array; does not mutate the inputs. */
export function detectWashSales(
  transactions: CapitalTransactionFact[],
): WashSaleDetectionResult {
  // Deep-clone the rows so we can mutate without affecting the caller.
  const rows: CapitalTransactionFact[] = transactions.map((t) => ({ ...t }));

  let detected = 0;
  let totalDisallowed = 0;

  // Performance optimization (code-quality audit): group rows by security
  // key up-front so the inner loop only scans matching-security rows
  // instead of all rows. Drops worst-case from O(n²) to O(n × max-group)
  // — typically O(n) since most descriptions have few replicas.
  const bySecurity = new Map<string, number[]>(); // key → indices
  for (let i = 0; i < rows.length; i++) {
    const k = normalizeSecurity(rows[i].description);
    if (!k) continue;
    let bucket = bySecurity.get(k);
    if (!bucket) {
      bucket = [];
      bySecurity.set(k, bucket);
    }
    bucket.push(i);
  }

  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    // Skip non-loss rows.
    if (txnGainLossRaw(s) >= 0) continue;
    // Skip broker-reported wash sales (honored as-is).
    if ((s.adjustmentCode ?? "").toUpperCase().includes("W")) continue;
    const sSold = parseISO(s.dateSold ?? null);
    if (!sSold) continue;
    const sKey = normalizeSecurity(s.description);
    if (!sKey) continue;
    const candidates = bySecurity.get(sKey);
    if (!candidates) continue;

    // Find earliest replacement purchase in the 61-day window.
    const windowStart = sSold.getTime() - 30 * ONE_DAY_MS;
    const windowEnd = sSold.getTime() + 30 * ONE_DAY_MS;
    const sAcq = parseISO(s.dateAcquired ?? null);
    const sAcqMs = sAcq ? sAcq.getTime() : null;
    let bestIdx = -1;
    let bestAcqMs = Infinity;
    for (const j of candidates) {
      if (j === i) continue;
      const t = rows[j];
      // Security match already enforced by the bucket; no need to re-normalize.
      const tAcq = parseISO(t.dateAcquired ?? null);
      if (!tAcq) continue;
      const acqMs = tAcq.getTime();
      if (acqMs < windowStart || acqMs > windowEnd) continue;
      // Skip same-day-acquired rows — most commonly these are tax-lot splits
      // of a single economic purchase, not a replacement buy. Trade-off:
      // misses the rare case of two separate same-day purchases; CPAs handle
      // those manually via adjustmentCode = "W".
      if (sAcqMs != null && acqMs === sAcqMs) continue;
      // Earliest dateAcquired wins (deterministic).
      if (acqMs < bestAcqMs) {
        bestAcqMs = acqMs;
        bestIdx = j;
      }
    }
    if (bestIdx === -1) continue;

    const loss = -txnGainLossRaw(s); // positive disallowed amount
    // 1) Reverse the loss on Form 8949 via column g (adjustmentAmount).
    s.adjustmentAmount = toNum(s.adjustmentAmount) + loss;
    s.washSaleDisallowed = toNum(s.washSaleDisallowed) + loss;
    // Preserve existing adjustment code(s); add "W" only if not present.
    const code = (s.adjustmentCode ?? "").toUpperCase();
    if (!code.includes("W")) {
      s.adjustmentCode = code.length > 0 ? code + "W" : "W";
    }
    s.washSaleAutoDetected = true;
    // 2) §1091(d) basis adjustment on the replacement transaction.
    const replacement = rows[bestIdx];
    replacement.costBasis = toNum(replacement.costBasis) + loss;

    detected += 1;
    totalDisallowed += loss;
  }

  return {
    adjustedTransactions: rows,
    washSalesDetected: detected,
    washSaleLossDisallowed: totalDisallowed,
  };
}

// ── Pure engine ─────────────────────────────────────────────────────────────

/**
 * Pure compute — no DB, no I/O. Inputs in, ComputedTaxReturn out.
 *
 * The DB-backed adapter (`computeTaxReturn` in taxReturnPipeline.ts) calls
 * this. Haven calls this directly with its own data layer.
 *
 * IMPORTANT: Critical invariants preserved here (see CLAUDE.md):
 *   1. AGI = Form 1040 Line 9 (includes LTCG + QDIV + STCG)
 *   2. Credits apply in IRS Schedule 3 order (CTC → Foreign tax → Dep care →
 *      Education → Saver's → Energy)
 *   3. IRA / SLI MAGI bootstrap (per Pub 590-A / Pub 970)
 *   4. State tax computed before Oregon fed-tax subtraction (recomputed for OR)
 *   5. Dep care MFJ taxpayer earned income = household − spouseEarnedIncome
 */
export function computeTaxReturnPure(inputs: TaxReturnInputs): ComputedTaxReturn {
  const { client, w2s, form1099s, adjustments, taxYear, overrides = {} } = inputs;
  const rentalProperties = inputs.rentalProperties ?? [];

  const additionalIncome = overrides.additionalIncome ?? 0;
  const useItemizedDeductionsOverride = overrides.useItemizedDeductions;
  const additionalDeductions =
    overrides.additionalDeductions ?? toNum(inputs.existingItemizedFallback);

  // ── W-2 aggregation (filter to tax year) ──
  const w2Records = w2s.filter((r) => (r.taxYear ?? taxYear) === taxYear);
  const totalWages = w2Records.reduce((s, r) => s + toNum(r.wagesBox1), 0);
  const w2FederalWithheld = w2Records.reduce((s, r) => s + toNum(r.federalTaxWithheldBox2), 0);
  const w2StateWithheld = w2Records.reduce((s, r) => s + toNum(r.stateTaxWithheldBox17), 0);
  // Box 3 (SS wages) and Box 5 (Medicare wages) — fall back to Box 1 when
  // the more-precise box is missing. Box 3 feeds Sch SE Part I Line 9 (SS
  // wage base shared with SE). Box 5 feeds Form 8959 Additional Medicare.
  const w2SocialSecurityWages = w2Records.reduce(
    (s, r) => s + (r.socialSecurityWagesBox3 != null ? toNum(r.socialSecurityWagesBox3) : toNum(r.wagesBox1)),
    0,
  );
  const w2MedicareWages = w2Records.reduce(
    (s, r) => s + (r.medicareWagesBox5 != null ? toNum(r.medicareWagesBox5) : toNum(r.wagesBox1)),
    0,
  );
  // K1 MFJ sub-gap — per-spouse W-2 SS wages for proper Sch SE Part I Line 9.
  // Each spouse files their own Sch SE; each subtracts only their own W-2
  // SS wages from the $168,600 SS wage base. Treats missing spouse field
  // as "taxpayer" (the conservative default).
  const w2SsByTaxpayer = w2Records
    .filter((r) => (r.spouse ?? "taxpayer") === "taxpayer")
    .reduce((s, r) => s + (r.socialSecurityWagesBox3 != null ? toNum(r.socialSecurityWagesBox3) : toNum(r.wagesBox1)), 0);
  const w2SsBySpouse = w2Records
    .filter((r) => r.spouse === "spouse")
    .reduce((s, r) => s + (r.socialSecurityWagesBox3 != null ? toNum(r.socialSecurityWagesBox3) : toNum(r.wagesBox1)), 0);

  // ── 1099 aggregation (filter to tax year) + summary ──
  const form1099Records = form1099s.filter((r) => (r.taxYear ?? taxYear) === taxYear);
  const baseForm1099Summary = summarize1099s(form1099Records);

  // ── Schedule D per-transaction override ──
  // When capital_transactions exist for this tax year, the per-transaction
  // aggregate replaces the 1099-B-derived ST/LT cap-gain totals. 1099-DIV
  // box 2a capital-gain distributions remain additive to LT (they're not
  // Form 8949 transactions).
  //
  // E13 — Auto wash-sale detection runs FIRST on the raw rows. The
  // resulting adjusted rows are then aggregated into ST/LT. Broker-reported
  // wash sales (adjustmentCode "W") are honored unchanged; auto-detected
  // ones get their loss reversed via adjustmentAmount, with the disallowed
  // amount added to the replacement transaction's costBasis (§1091(d)).
  const rawCapTxnsForYear = (inputs.capitalTransactions ?? []).filter((t) => t.taxYear === taxYear);
  const washSaleResult = detectWashSales(rawCapTxnsForYear);
  const capTxnsForYear = washSaleResult.adjustedTransactions;
  let form1099Summary: Form1099Summary;
  if (capTxnsForYear.length > 0) {
    const cgDistributions = form1099Records
      .filter((r) => r.formType === "div")
      .reduce((s, r) => s + toNum(r.totalCapitalGainDistribution), 0);
    const txnGainLoss = (t: CapitalTransactionFact) =>
      toNum(t.proceeds) - toNum(t.costBasis) + toNum(t.adjustmentAmount);
    const stTransactions = capTxnsForYear.filter((t) =>
      ["A", "B", "C"].includes((t.formBox ?? "A").toUpperCase()),
    );
    const ltTransactions = capTxnsForYear.filter((t) =>
      ["D", "E", "F"].includes((t.formBox ?? "").toUpperCase()),
    );
    const stcgFromTxns = stTransactions.reduce((s, t) => s + txnGainLoss(t), 0);
    const ltcgFromTxns = ltTransactions.reduce((s, t) => s + txnGainLoss(t), 0);
    const newStcg = stcgFromTxns;
    const newLtcg = ltcgFromTxns + cgDistributions;
    form1099Summary = {
      ...baseForm1099Summary,
      shortTermCapitalGains: newStcg,
      longTermCapitalGains: newLtcg,
      totalInvestmentIncome:
        baseForm1099Summary.interestIncome +
        baseForm1099Summary.ordinaryDividends +
        baseForm1099Summary.qualifiedDividends +
        newStcg +
        newLtcg,
    };
  } else {
    form1099Summary = baseForm1099Summary;
  }

  const totalFederalWithheld = w2FederalWithheld + form1099Summary.federalWithheld;
  const totalStateWithheld = w2StateWithheld + form1099Summary.stateWithheld;

  const stateCode =
    (client.state && client.state.trim()) ||
    w2Records.find((r) => r.stateCode)?.stateCode ||
    "";

  // ── Adjustment aggregation ──
  const applied = adjustments.filter((a) => a.isApplied !== false);

  const sumByType = (type: string) =>
    applied
      .filter((a) => a.adjustmentType === type)
      .reduce((s, a) => s + toNum(a.amount), 0);

  // Original adjustment types
  const deductionAdjustments = sumByType("deduction");
  const creditAdjustments = sumByType("credit");
  const additionalIncomeAdjustments = sumByType("additional_income");
  const withholdingAdjustments = sumByType("withholding_adjustment");
  const otherDeductions = sumByType("other");

  // E7 — §179 expense election + §168(k) bonus depreciation. Both reduce
  // business income (effectively additional deductions). Apply caps + phase-out:
  //   - §179 cap TY2024: $1,160,000 (Rev. Proc. 2023-34)
  //   - §179 phase-out: dollar-for-dollar above $2,890,000 of qualified property
  //   - §179 income limit: can't exceed net business income (no NOL via §179)
  //   - Bonus depreciation: 60% × cost basis TY2024, 40% TY2025 (no income limit)
  // CPA enters the elected §179 amount and the cost basis of bonus-eligible
  // property; engine computes the actual deduction.
  const section179ElectedAdj = sumByType("section_179_expense_election");
  const bonusDeprBasisAdj = sumByType("bonus_depreciation_basis");
  const SECTION_179_CAPS: Record<number, { cap: number; phaseStart: number }> = {
    2024: { cap: 1160000, phaseStart: 2890000 },
    2025: { cap: 1220000, phaseStart: 3050000 }, // Rev. Proc. 2024-40
  };
  const BONUS_DEPR_RATES: Record<number, number> = {
    2024: 0.60,
    2025: 0.40,
  };
  const s179Cfg = SECTION_179_CAPS[taxYear] ?? SECTION_179_CAPS[2024];
  // Phase-out: §179 limit reduced $-for-$ when total qualified property
  // purchases (approximated as §179 elected + bonus depr basis) exceed
  // the phase-out threshold.
  const totalQualifiedPropertyApprox = section179ElectedAdj + bonusDeprBasisAdj;
  const s179PhaseOut = Math.max(0, totalQualifiedPropertyApprox - s179Cfg.phaseStart);
  const s179EffectiveCap = Math.max(0, s179Cfg.cap - s179PhaseOut);
  // §179 applied = min(elected, cap, net business income) — income limit
  // applied later when we have net SE earnings; for now use the cap.
  const section179Preliminary = Math.min(section179ElectedAdj, s179EffectiveCap);
  // Bonus depreciation: % × basis. No income limit.
  const bonusDepreciationApplied = bonusDeprBasisAdj *
    (BONUS_DEPR_RATES[taxYear] ?? BONUS_DEPR_RATES[2024]);

  // Income / SE / investment / QBI / AMT
  const seIncomeFromAdj = sumByType("self_employment_income");
  const investmentIncomeFromAdj = sumByType("investment_income");
  const qbiIncome = sumByType("qbi_income");
  // BP3 — AMT preference detail. The legacy `amt_preferences` catch-all
  // continues to work (any preference the engine doesn't model explicitly).
  // BP3 adds two explicit components:
  //   amt_iso_bargain_element   — Form 6251 line 2k. FMV at exercise minus
  //                               strike, for ISOs HELD past calendar year-end
  //                               (disqualifying-disposition same-year sales
  //                               are ordinary income, not an AMT preference).
  //   amt_state_tax_addback_override — Form 6251 line 2g override. Auto-derived
  //                               from the itemized SALT deduction we already
  //                               compute (state income/property/sales tax,
  //                               capped at $10k post-TCJA); this override
  //                               replaces the auto value for unusual cases.
  const amtPreferencesLegacy = sumByType("amt_preferences");
  const amtIsoBargainElement = sumByType("amt_iso_bargain_element");
  const amtStateTaxAddbackOverride = sumByType("amt_state_tax_addback_override");

  // Phase 1: Schedule A inputs
  const medicalExpensesAdj = sumByType("medical_expenses");
  const stateIncomeTaxAdj = sumByType("state_income_tax");
  const statePropertyTaxAdj = sumByType("state_property_tax");
  const stateSalesTaxAdj = sumByType("state_sales_tax");
  const mortgageInterestAdj = sumByType("mortgage_interest");
  const charitableCashAdj = sumByType("charitable_cash");
  const charitablePropertyAdj = sumByType("charitable_property");
  // E3 — Prior-year cash charitable carryforward (IRC §170(d)(1)).
  // Auto-loaded by pipeline from prior tax_returns.charitableCarryforwardCashRemaining;
  // CPA can override via `charitable_carryforward_cash` adjustment.
  const charitableCarryforwardCashAdj = sumByType("charitable_carryforward_cash");
  // Above-the-line
  const hsaContributionAdj = sumByType("hsa_contribution");
  // E4 — HSA employer contribution (W-2 Box 12 code W). Counts against
  // the §223 annual limit but is NOT deductible on Schedule 1. Engine
  // reduces the deductible cap for the employee's contribution by this
  // amount and flags any total > limit as excess subject to 6% excise.
  const hsaEmployerContributionAdj = sumByType("hsa_employer_contribution");
  const iraTraditionalAdj = sumByType("ira_contribution_traditional");
  const iraRothAdj = sumByType("ira_contribution_roth"); // not deductible, counts for saver's
  // Schedule C
  const scheduleCExpensesInput = sumByType("schedule_c_expenses");
  // K5: Self-Employed Health Insurance premiums (Form 7206) — above-the-line.
  // Capped at (net SE earnings − half-SE) by the engine; the CPA-entered
  // adjustment represents gross premiums paid for the year.
  const sehiPremiumsAdj = sumByType("self_employed_health_insurance_premiums");
  // K6: §121 home-sale exclusion — gross long-term capital gain on the sale
  // of a primary residence (sale price − adjusted basis − selling expenses).
  // Engine applies the $250k single/HoH/MFS / $500k MFJ-or-QSS cap; any
  // taxable remainder is added to LTCG. CPA is responsible for verifying
  // the 2-of-5 ownership-and-use test (Pub 523). QSS receives $500k under
  // the 2-year-post-spouse-death rule — engine doesn't enforce that timing
  // (sub-gap; CPA can split the gain into a separate LTCG entry if QSS no
  // longer qualifies).
  const homeSaleGrossGainAdj = sumByType("home_sale_gross_gain_primary_residence");
  // K9: FEIE §911 foreign earned income exclusion (Form 2555). Two
  // adjustments — primary filer + (MFJ-only) spouse. Engine caps each at
  // the per-spouse annual exclusion ($126,500 TY2024 / $130,000 TY2025).
  // Eligibility (bona fide residence / 330-day physical presence test) is
  // the CPA's responsibility — engine assumes the adjustment is valid.
  const feieTaxpayerAdj = sumByType("foreign_earned_income");
  const feieSpouseAdj = sumByType("foreign_earned_income_spouse");
  // K4: NOL carryforward (post-TCJA 80% taxable income limit, IRC §172(a)(2)).
  // CPA enters prior-year NOL available. Engine caps deduction at 80% of
  // taxable income computed without the NOL. Unused remainder carries to
  // next year (engine returns nolCarryforwardRemaining for transparency).
  const nolCarryforwardAdj = sumByType("nol_carryforward");
  // K7: §1202 QSBS exclusion. CPA enters gross gain on QSBS sale + adjusted
  // basis. Engine excludes min(gross, max(10_000_000, 10 × basis)). Remainder
  // flows to LTCG. Defaults to 100% post-2010-09-27 acquisitions (most
  // common case). For 75% / 50% (older acquisitions) CPA can pre-adjust the
  // entered gain (multiply by 1.33 or 2.0 respectively). Tracked sub-gap.
  const qsbsGrossGainAdj = sumByType("qsbs_gross_gain");
  const qsbsAdjustedBasisAdj = sumByType("qsbs_adjusted_basis");
  // C5 — §1031 like-kind exchange (post-TCJA: real property only).
  // CPA enters two adjustments per exchange (or aggregated across multiple
  // exchanges this year):
  //   - section_1031_realized_gain: gross gain that would be recognized
  //     in a fully-taxable sale (FMV of relinquished − adjusted basis).
  //   - section_1031_boot_received: cash + non-like-kind property received
  //     (plus net mortgage relief if relinquished mortgage > replacement).
  // Engine recognizes min(realized, boot); the rest defers (carries to
  // replacement-property basis). Recognized gain flows to LTCG (§1031
  // requires investment intent → long-term character).
  // CPA confirms: like-kind classification, 45-day identification,
  // 180-day acquisition, qualified-intermediary use. Engine assumes
  // those eligibility tests are satisfied.
  const section1031RealizedGainAdj = sumByType("section_1031_realized_gain");
  const section1031BootReceivedAdj = sumByType("section_1031_boot_received");
  // C6 — ISO + ESPP disqualifying-disposition ordinary income.
  // Both are pure ordinary-income additions (no FICA, no special bucketing).
  // CPA computes the recharacterized comp income per holding-test failure
  // (Pub 525 + Form 3921/3922 instructions) and enters as a single
  // aggregated adjustment per stock-type. The corresponding cost-basis
  // upward adjustment on the related 1099-B is the CPA's responsibility
  // (Form 8949 code "B" + column g) — engine does not auto-adjust the
  // 1099-B side, since the engine processes per-transaction capital
  // transactions independently of these adjustments.
  const isoDisqualifyingDispositionOrdinaryAdj = sumByType("iso_disqualifying_disposition_ordinary");
  const esppDisqualifyingDispositionOrdinaryAdj = sumByType("espp_disqualifying_disposition_ordinary");
  // C7 — §163(j) business interest limit (post-TCJA: 30% × ATI cap).
  //
  // Engine model: CPA enters the gross business interest expense + any
  // prior-year carryforward + any biz interest income that increases the
  // allowance. Engine applies the 30% × ATI cap and surfaces the allowed
  // deduction (subtracted from ordinary income) + disallowed carryforward.
  //
  // ATI proxy: we approximate ATI ≈ AGI minus net cap gains, before the
  // §163(j) deduction itself. Real ATI (per §163(j)(8)) is taxable income
  // without §163(j), NOL, or §199A QBI — plus addbacks for depreciation /
  // amortization / depletion (pre-2022 only; post-2022 reversed). The
  // engine doesn't track depreciation separately at this layer, so AGI
  // less LTCG/QDIV is a workable proxy at moderate-to-high incomes.
  // Tracked sub-gap. Real-property-trade-or-business election and the
  // small-business gross-receipts exception ($30M TY2024) are the CPA's
  // responsibility — engine assumes §163(j) applies if the CPA enters
  // any business interest expense.
  const section163jBusinessInterestExpenseAdj = sumByType("section_163j_business_interest_expense");
  const section163jBusinessInterestIncomeAdj = sumByType("section_163j_business_interest_income");
  const section163jCarryforwardFromPriorAdj = sumByType("section_163j_carryforward_from_prior");
  const section163jFloorPlanInterestAdj = sumByType("section_163j_floor_plan_financing_interest");
  // C7 — §461(l) excess business loss addback (TCJA, TY2024 thresholds
  // $305k single / $610k MFJ). CPA computes the aggregate net business
  // loss (Sched C + Sched E + K-1 active losses after §469 PAL), subtracts
  // the threshold, and enters the positive excess here. Engine adds it
  // back to ordinary income (reversing the over-deduction). Disallowed
  // carries forward as an NOL — CPA enters via `nol_carryforward` next
  // year. Engine does NOT compute the aggregate biz-loss itself in this
  // MVP because the loss-aggregation crosses Sched C / E / K-1 buckets
  // that the engine processes in separate stages.
  const section461lExcessLossAddbackAdj = sumByType("section_461l_excess_loss_addback");
  // Credits
  const dependentCareExpensesAdj = sumByType("dependent_care_expenses");
  const llcExpensesAdj = sumByType("qualified_education_expenses_llc");
  const saversContributionsAdj = sumByType("retirement_contributions_savers");

  // Phase 1.5
  const educatorExpensesAdj = sumByType("educator_expenses");
  const studentLoanInterestAdj = sumByType("student_loan_interest");
  const foreignTaxPaidAdj = sumByType("foreign_tax_paid");
  /**
   * Foreign-source taxable income (Form 1116 Line 17 input). When supplied
   * along with foreign_tax_paid > the simplified limit ($300 single / $600 MFJ),
   * the engine applies the real Form 1116 limit:
   *   credit = min(paid, foreignSourceTaxableIncome / totalTaxableIncome × preCreditUsTax)
   * If absent, the engine falls back to the approximate (credit ≈ paid).
   */
  const foreignSourceTaxableIncomeAdj = sumByType("foreign_source_taxable_income");
  const residentialCleanEnergyAdj = sumByType("residential_clean_energy");
  const energyEfficientHomeAdj = sumByType("energy_efficient_home");
  const energyEfficientHeatpumpAdj = sumByType("energy_efficient_heatpump");
  const evChargerPropertyAdj = sumByType("ev_charger_property");

  // Phase 2b: Capital loss carryforward from prior years (preserves short/long character)
  // User enters via adjustment types; engine adds to current year's netting.
  // (Auto-loading from prior-year tax_returns row is a future enhancement.)
  const stcgCarryforward = sumByType("capital_loss_carryforward_short");
  const ltcgCarryforward = sumByType("capital_loss_carryforward_long");

  // Phase 2e: Schedule E rental real estate
  // ── Schedule E rental real estate ──
  // When per-property rows exist for this tax year, use them as the source of
  // truth (sum income, expenses, and computed MACRS). Otherwise fall back to
  // the legacy aggregate adjustment types.
  const propertiesForYear = rentalProperties.filter((p) => p.taxYear === taxYear);
  let scheduleERentalIncomeAdj: number;
  let scheduleERentalExpensesAdj: number;
  let scheduleEMacrsDepreciationAdj: number;
  if (propertiesForYear.length > 0) {
    scheduleERentalIncomeAdj = propertiesForYear.reduce((s, p) => s + toNum(p.rentalIncome), 0);
    scheduleERentalExpensesAdj = propertiesForYear.reduce((s, p) => s + toNum(p.totalExpenses), 0);
    scheduleEMacrsDepreciationAdj = propertiesForYear.reduce((s, p) => {
      const basis = toNum(p.basis);
      const placedYear = p.placedInServiceYear ?? 0;
      const placedMonth = p.placedInServiceMonth ?? 0;
      if (basis <= 0 || placedYear <= 0 || placedMonth < 1 || placedMonth > 12) return s;
      const dep = calculateMacrsDepreciation({
        basis,
        propertyType: p.propertyType === "commercial" ? "commercial" : "residential",
        monthPlacedInService: placedMonth,
        yearPlacedInService: placedYear,
        taxYear,
      });
      return s + dep.currentYearDepreciation;
    }, 0);
  } else {
    scheduleERentalIncomeAdj = sumByType("schedule_e_rental_income");
    scheduleERentalExpensesAdj = sumByType("schedule_e_rental_expenses");
    scheduleEMacrsDepreciationAdj = sumByType("schedule_e_macrs_depreciation");
  }
  const scheduleEPassiveLossCarryforwardAdj = sumByType("schedule_e_passive_loss_carryforward");

  // ── Phase B+: Schedule K-1 (partnership 1065 + S-corp 1120-S) ──
  // Pass-through entities. Per-K-1 box income is summed for the year and
  // flows to the appropriate schedules:
  //   - Active K-1 Box 1 / Box 3 ordinary → Sch E Part II → 1040 Line 8
  //   - Passive K-1 Box 1 / Box 3 + ALL Box 2 (RE) → K-1 passive bucket
  //     (NO $25k allowance — that is rental-RE active-participation only).
  //     Net K-1 passive loss is fully suspended → carries forward as the
  //     `k1_passive_loss_carryforward` adjustment.
  //   - Box 5/6a/6b/7 → Sch B / Sch E Part I
  //   - Box 8 / 9a → cross-nets with other 8949 capital gains/losses
  //   - Box 14A (1065 only) → Schedule SE
  //   - §199A QBI (Box 20 Z / Box 17 V) → §199A calc
  // Known limits (also in CLAUDE.md): no W-2-wage / UBIA cap, no SSTB
  // phase-out, no basis or at-risk enforcement (CPA judgment).
  const k1sForYear = (inputs.scheduleK1 ?? []).filter((k) => k.taxYear === taxYear);
  const k1IsActive = (k: ScheduleK1Fact) => (k.activityType ?? "active") !== "passive";
  const k1IsPassive = (k: ScheduleK1Fact) => (k.activityType ?? "active") === "passive";
  const sumK1Where = (
    pred: (k: ScheduleK1Fact) => boolean,
    pick: (k: ScheduleK1Fact) => Numish,
  ) => k1sForYear.filter(pred).reduce((s, k) => s + toNum(pick(k)), 0);

  const k1ActiveOrdinary =
    sumK1Where(k1IsActive, (k) => k.box1OrdinaryIncome) +
    sumK1Where(k1IsActive, (k) => k.box3OtherRentalIncome);
  // K-1 passive bucket (current year, BEFORE prior-year carryforward):
  // passive Box 1, ALL Box 2 (rental real estate held through a pass-through
  // entity is always passive at the K-1 holder level — the $25k allowance
  // only applies to direct rental ownership), passive Box 3.
  const k1PassiveCurrentYear =
    sumK1Where(k1IsPassive, (k) => k.box1OrdinaryIncome) +
    sumK1Where(() => true, (k) => k.box2RentalRealEstate) +
    sumK1Where(k1IsPassive, (k) => k.box3OtherRentalIncome);
  const k1InterestIncome = sumK1Where(() => true, (k) => k.interestIncome);
  const k1OrdinaryDividends = sumK1Where(() => true, (k) => k.ordinaryDividends);
  const k1QualifiedDividends = sumK1Where(() => true, (k) => k.qualifiedDividends);
  const k1Royalties = sumK1Where(() => true, (k) => k.royalties);
  const k1Stcg = sumK1Where(() => true, (k) => k.netShortTermCapitalGain);
  const k1Ltcg = sumK1Where(() => true, (k) => k.netLongTermCapitalGain);
  // Partnership Box 14A only — S-corp K-1 income isn't subject to SE tax
  // (shareholders take W-2 wages for services; their distributive share is
  // investment-type income, not SE earnings).
  const k1SelfEmploymentEarnings = sumK1Where(
    (k) => (k.entityType ?? "partnership") === "partnership",
    (k) => k.selfEmploymentEarnings,
  );
  const k1QbiContribution = sumK1Where(() => true, (k) => k.section199aQbi);

  // K-1 passive bucket netting: subtract prior-year suspended K-1 passive
  // loss (carryforward adjustment), then if net is income flow to AGI;
  // if net is loss, fully suspend (no allowance bucket for non-rental-RE
  // passive activity at the individual level).
  const k1PassiveLossCarryforwardAdj = sumByType("k1_passive_loss_carryforward");
  const k1PassiveAfterCarry = k1PassiveCurrentYear - k1PassiveLossCarryforwardAdj;
  const k1PassiveAppliedToAgi = k1PassiveAfterCarry > 0 ? k1PassiveAfterCarry : 0;
  const k1PassiveLossSuspended = k1PassiveAfterCarry < 0 ? -k1PassiveAfterCarry : 0;

  // ── Step 1: Schedule C — net SE income before SE tax ─────────────────
  // Schedule C net SE income flows BOTH to AGI (as ordinary income) and to
  // Schedule SE. K-1 partnership Box 14A SE earnings flow ONLY to Schedule
  // SE: the underlying income is already in AGI via K-1 Box 1 →
  // Schedule E Part II (k1ActiveOrdinary). Adding K-1 SE to netSeIncome
  // would double-count, so we keep a separate SE-tax base.
  const grossSeIncome = seIncomeFromAdj + form1099Summary.seIncome;
  const scheduleCExpenses = Math.min(
    Math.max(0, scheduleCExpensesInput),
    Math.max(0, grossSeIncome),
  );
  const netSeIncome = Math.max(0, grossSeIncome - scheduleCExpenses);
  // SE-tax base = Schedule C net + K-1 partnership Box 14A SE earnings
  // (K-1 SE loss nets against positive amounts; floor at 0).
  const seTaxBase = Math.max(0, netSeIncome + k1SelfEmploymentEarnings);

  // Sch SE Part I Line 9: each spouse files their own Sch SE; each subtracts
  // only their own W-2 SS wages from the SS wage base. For single/HoH/MFS/QSS
  // there is one filer — straightforward path. For MFJ we group SE income
  // and W-2 SS wages by spouse and call calculateSelfEmploymentTax once per
  // spouse, then sum.
  //
  // Per-spouse SE income (1099-NEC by spouse field; Sch C adjustments default
  // to taxpayer, since `self_employment_income` adjustments don't carry a
  // spouse field today — sub-sub-gap documented in CLAUDE.md).
  let se: ReturnType<typeof calculateSelfEmploymentTax>;
  const isMfjForSe = client.filingStatus === "married_filing_jointly" ||
                     client.filingStatus === "qualifying_widow";
  // Per-spouse attribution only kicks in when the CPA has explicitly tagged
  // at least one record with spouse="spouse". Without any explicit
  // attribution, fall back to the pre-K1-MFJ behavior (no Line 9 applied)
  // — correct for the common case where the SE earner is the lower-W-2
  // spouse. This prevents the engine from over-consuming the SS cap on
  // implicit-default "all-taxpayer" attribution.
  const hasExplicitSpouseAttribution =
    w2Records.some((r) => r.spouse === "spouse") ||
    form1099Records.some((r) => r.spouse === "spouse");
  if (isMfjForSe && hasExplicitSpouseAttribution) {
    // K1 MFJ sub-gap closure (2026-05-26).
    const necRecordsForYear = form1099Records.filter((r) =>
      r.formType === "nec" && (r.taxYear ?? taxYear) === taxYear);
    const necSeIncomeTaxpayer = necRecordsForYear
      .filter((r) => (r.spouse ?? "taxpayer") === "taxpayer")
      .reduce((s, r) => s + toNum(r.nonemployeeCompensation), 0);
    const necSeIncomeSpouse = necRecordsForYear
      .filter((r) => r.spouse === "spouse")
      .reduce((s, r) => s + toNum(r.nonemployeeCompensation), 0);
    // self_employment_income adjustments + K-1 partnership Box 14A default to
    // taxpayer attribution. Schedule C expenses split is the same — apportion
    // to taxpayer's gross.
    const grossSeTaxpayer = seIncomeFromAdj + necSeIncomeTaxpayer;
    const grossSeSpouse = necSeIncomeSpouse;
    const taxpayerScheduleCExpenses = Math.min(
      Math.max(0, scheduleCExpensesInput),
      Math.max(0, grossSeTaxpayer),
    );
    const taxpayerNetSe = Math.max(0, grossSeTaxpayer - taxpayerScheduleCExpenses);
    const spouseNetSe = Math.max(0, grossSeSpouse);
    const seTaxBaseTaxpayer = Math.max(0, taxpayerNetSe + k1SelfEmploymentEarnings);
    const seTaxBaseSpouse = Math.max(0, spouseNetSe);

    const seTaxpayer = calculateSelfEmploymentTax(seTaxBaseTaxpayer, taxYear, w2SsByTaxpayer);
    const seSpouse = calculateSelfEmploymentTax(seTaxBaseSpouse, taxYear, w2SsBySpouse);
    // Combine the two Sch SE results into a single SeTaxCalculation.
    se = {
      seIncomeReported: seTaxpayer.seIncomeReported + seSpouse.seIncomeReported,
      netSeEarnings: seTaxpayer.netSeEarnings + seSpouse.netSeEarnings,
      socialSecurityPortion: seTaxpayer.socialSecurityPortion + seSpouse.socialSecurityPortion,
      medicarePortion: seTaxpayer.medicarePortion + seSpouse.medicarePortion,
      seTaxTotal: seTaxpayer.seTaxTotal + seSpouse.seTaxTotal,
      deductibleHalf: seTaxpayer.deductibleHalf + seSpouse.deductibleHalf,
      ssBaseAvailableForSe: seTaxpayer.ssBaseAvailableForSe + seSpouse.ssBaseAvailableForSe,
    };
  } else if (isMfjForSe) {
    // MFJ without explicit spouse attribution — pre-K1-MFJ behavior:
    // pass 0 to calculateSelfEmploymentTax (no Line 9 applied). The CPA
    // can opt in to per-spouse Sch SE by tagging at least one W-2 or
    // 1099-NEC with spouse="spouse".
    se = calculateSelfEmploymentTax(seTaxBase, taxYear, 0);
  } else {
    // Single, HoH, MFS, QSS — single filer; original Sch SE Line 9 path.
    se = calculateSelfEmploymentTax(seTaxBase, taxYear, w2SocialSecurityWages);
  }

  // K5 — SEHI deduction (Form 7206). Cap = net SE − half-SE. Adjustment is
  // gross premiums; engine applies the cap. Goes above-the-line (subtracts
  // from AGI alongside half-SE). Eligibility (employer plan availability)
  // is the CPA's responsibility — engine assumes the adjustment is valid.
  const sehi = calculateSehiDeduction({
    premiumsPaid: sehiPremiumsAdj,
    seNetEarnings: se.netSeEarnings,
    halfSeDeduction: se.deductibleHalf,
  });

  // ── Step 2: Total income (Form 1040 Line 9) ─────────────────────────
  //
  // Capital gain/loss netting per Schedule D (IRC §1211, §1212):
  //   1. Net within holding period (within-year gains/losses combined)
  //   2. Apply prior-year carryforwards (preserve short/long character)
  //   3. Cross-net: if STCG > 0 and LTCG < 0, long loss offsets short gain
  //      (or vice versa). Excess preserves its original character.
  //   4. If net total is positive → flows to AGI as ordinary (STCG) + preferential (LTCG)
  //   5. If net total is negative → up to $3,000 ($1,500 MFS) against ordinary
  //      income; excess carries to next year preserving short/long character.

  // K-1 qualified dividends (Box 6b / Box 5b) join the qual-div total.
  const qualifiedDividends = form1099Summary.qualifiedDividends + k1QualifiedDividends;
  // K6 — §121 home-sale exclusion. Gross LT gain from `home_sale_gross_gain_primary_residence`
  // adjustment; engine applies the $250k / $500k cap by filing status; remainder
  // flows to LTCG. CPA confirms the 2-of-5 ownership-and-use test (Pub 523).
  const homeSaleGrossGain = Math.max(0, homeSaleGrossGainAdj);
  const section121Cap = (client.filingStatus === "married_filing_jointly" ||
                         client.filingStatus === "qualifying_widow") ? 500000 : 250000;
  const homeSaleSection121Exclusion = Math.min(homeSaleGrossGain, section121Cap);
  const homeSaleTaxableGain = Math.max(0, homeSaleGrossGain - section121Cap);

  // K7 — §1202 QSBS exclusion. Computed before LTCG netting so the taxable
  // remainder can join LTCG. Exclusion = min(gross, max($10M, 10×basis)).
  // Engine assumes 100% post-2010-09-27 acquisition (most common case);
  // for older 75%/50% acquisitions the CPA can pre-multiply the entered gross.
  const qsbsGrossGain = Math.max(0, qsbsGrossGainAdj);
  const qsbsAdjustedBasis = Math.max(0, qsbsAdjustedBasisAdj);
  const qsbsCap = Math.max(10_000_000, 10 * qsbsAdjustedBasis);
  const qsbsSection1202Exclusion = Math.min(qsbsGrossGain, qsbsCap);
  const qsbsTaxableGain = Math.max(0, qsbsGrossGain - qsbsCap);

  // C5 — §1031 like-kind exchange: recognized = min(realized, boot).
  // Both inputs floor at 0 to defend against malformed adjustments. If
  // there's no exchange (realized = 0), all three downstream values are 0.
  const section1031RealizedGain = Math.max(0, section1031RealizedGainAdj);
  const section1031BootReceived = Math.max(0, section1031BootReceivedAdj);
  const section1031RecognizedGain = Math.min(section1031RealizedGain, section1031BootReceived);
  const section1031DeferredGain = Math.max(0, section1031RealizedGain - section1031RecognizedGain);

  // C6 — ISO + ESPP disqualifying-disposition ordinary income.
  // Defensive floor at 0 (a legitimate disqualifying disposition can never
  // have negative compensation income — if sale price < strike for ISO,
  // ordinary income is capped at 0 per §422(c)(2) "Lesser of" rule which
  // the CPA hand-applies before entering the adjustment).
  const isoDisqualifyingDispositionOrdinary = Math.max(0, isoDisqualifyingDispositionOrdinaryAdj);
  const esppDisqualifyingDispositionOrdinary = Math.max(0, esppDisqualifyingDispositionOrdinaryAdj);

  // C7 — §461(l) excess business loss addback.
  //
  // C3 follow-up (2026-05-27 PM): engine now AUTO-AGGREGATES net business
  // loss across Sch C / Sch E rental / K-1 active when CPA hasn't supplied
  // the explicit `section_461l_excess_loss_addback` adjustment. The §461(l)
  // threshold TY2024:
  //   - Single/HoH/MFS/QSS: $305,000
  //   - MFJ:                $610,000
  // (Rev. Proc. 2023-34. TY2025 indexed amounts ~$320k / $640k — engine
  // uses TY2024 for both years pending Rev. Proc. 2024-40 confirmation.)
  //
  // Aggregate net biz loss includes:
  //   1. Sch C loss = max(0, scheduleCExpensesInput − grossSeIncome)
  //   2. Sch E rental loss (PRE-PAL) = max(0, -grossRentalNet)
  //      NOTE: §469 PAL suspension may reduce the actual deductible loss;
  //      engine over-aggregates here (sub-gap — conservative result).
  //   3. K-1 active trade-or-business loss = max(0, -k1ActiveOrdinary)
  //
  // CPA-supplied `section_461l_excess_loss_addback` adjustment STILL WINS
  // when set. Engine auto-computes the addback only when not supplied.
  //
  // Sub-gaps (documented):
  //   * No spouse aggregation for MFJ — engine treats both spouses' losses
  //     under one threshold ($610k) which is correct for federal §461(l)
  //     (the threshold is per-RETURN, not per-spouse).
  //   * §469 PAL interaction — engine uses pre-PAL rental net; technically
  //     §461(l) should apply to post-PAL allowable losses only. For most
  //     cases this is fine because high-AGI filers (where §461(l) binds)
  //     usually have PAL fully suspended anyway.
  //   * Active K-1 losses from S-corp shareholders/partners hitting basis
  //     or at-risk limits should be excluded; engine doesn't model these.
  const SECTION_461L_THRESHOLD_TY2024: Record<string, number> = {
    single: 305_000,
    head_of_household: 305_000,
    married_filing_separately: 305_000,
    qualifying_widow: 610_000,
    married_filing_jointly: 610_000,
  };
  // §461(l) auto-aggregation: compute when CPA didn't supply an explicit addback.
  let section461lAutoAddback = 0;
  if (section461lExcessLossAddbackAdj <= 0) {
    const schCLoss = Math.max(0, scheduleCExpensesInput - grossSeIncome);
    // Rental: compute pre-PAL net (income − expenses − MACRS) from properties / aggregate adjustments.
    // grossRentalNet isn't yet computed; use the inputs we know.
    const aggregateRentalIncome = scheduleERentalIncomeAdj;
    const aggregateRentalExpenses = scheduleERentalExpensesAdj + scheduleEMacrsDepreciationAdj;
    const rentalNetPrePal = aggregateRentalIncome - aggregateRentalExpenses;
    const rentalLossPrePal = Math.max(0, -rentalNetPrePal);
    const k1ActiveLoss = Math.max(0, -k1ActiveOrdinary);
    const aggregateBizLoss = schCLoss + rentalLossPrePal + k1ActiveLoss;
    const threshold =
      SECTION_461L_THRESHOLD_TY2024[client.filingStatus] ?? 305_000;
    if (aggregateBizLoss > threshold) {
      section461lAutoAddback = aggregateBizLoss - threshold;
    }
  }
  const section461lExcessLossAddback = Math.max(
    section461lExcessLossAddbackAdj,
    section461lAutoAddback,
  );

  // K-1 net ST/LT capital gain (Box 8 / 9a) joins the cap-gain netting
  // alongside 1099-B-derived gains. Subtract prior-year loss carryforwards.
  // Home-sale taxable remainder (K6) and QSBS taxable remainder (K7) are
  // long-term per §121 (2-of-5 ownership) and §1202 (5-year holding).
  let netSTCG = form1099Summary.shortTermCapitalGains + k1Stcg - stcgCarryforward;
  let netLTCG = form1099Summary.longTermCapitalGains + k1Ltcg - ltcgCarryforward + homeSaleTaxableGain + qsbsTaxableGain + section1031RecognizedGain;

  // Cross-netting per Schedule D Lines 7, 15, 16
  if (netSTCG > 0 && netLTCG < 0) {
    const ltLoss = -netLTCG;
    if (ltLoss >= netSTCG) {
      netLTCG = netLTCG + netSTCG; netSTCG = 0;
    } else {
      netSTCG = netSTCG + netLTCG; netLTCG = 0;
    }
  } else if (netSTCG < 0 && netLTCG > 0) {
    const stLoss = -netSTCG;
    if (stLoss >= netLTCG) {
      netSTCG = netSTCG + netLTCG; netLTCG = 0;
    } else {
      netLTCG = netLTCG + netSTCG; netSTCG = 0;
    }
  }

  const netCapitalTotal = netSTCG + netLTCG;

  let capitalLossDeducted = 0;          // Schedule D Line 21 — against ordinary income
  let capitalLossCarryforwardShort = 0; // To next year, preserves short character
  let capitalLossCarryforwardLong = 0;  // To next year, preserves long character
  let stcgInOrdinary = 0;               // Positive STCG flowing to AGI (taxed ordinary)
  let ltcgPreferential = 0;             // Positive LTCG flowing to preferential calc

  if (netCapitalTotal >= 0) {
    // Net gain (or zero) — positive components flow as today
    stcgInOrdinary = Math.max(0, netSTCG);
    ltcgPreferential = Math.max(0, netLTCG);
  } else {
    // Net loss — $3k cap ($1,500 MFS) against ordinary income, rest carries forward
    const isMfs = client.filingStatus === "married_filing_separately";
    const cap = isMfs ? 1500 : 3000;
    capitalLossDeducted = Math.min(Math.abs(netCapitalTotal), cap);
    const excess = Math.max(0, Math.abs(netCapitalTotal) - cap);
    // Apportion excess per IRS Pub 550: short losses fully used first against $3k,
    // then long. Track remaining for carryforward.
    if (excess > 0) {
      // Compute what's left of each after the $3k consumption
      // After cross-netting, both same sign (negative) or one is zero
      const shortLossRemaining = Math.max(0, -netSTCG);
      const longLossRemaining = Math.max(0, -netLTCG);
      // $3k consumed short first, then long (per Pub 550 worksheet)
      let consumed = cap;
      const shortConsumed = Math.min(consumed, shortLossRemaining);
      consumed -= shortConsumed;
      const longConsumed = Math.min(consumed, longLossRemaining);
      capitalLossCarryforwardShort = Math.max(0, shortLossRemaining - shortConsumed);
      capitalLossCarryforwardLong = Math.max(0, longLossRemaining - longConsumed);
    }
  }

  // Legacy names (retained for downstream code that referenced them)
  const longTermGains = ltcgPreferential;
  const shortTermGains = stcgInOrdinary;

  // ── Phase 2e: Schedule E rental net income/loss + §469 PAL limit ──
  // Step 1: Compute gross rental position (income - expenses - depreciation)
  // Step 2: Add prior-year suspended passive losses (carryforward)
  // Step 3: Apply §469 PAL limit (uses provisional AGI as MAGI)
  // Step 4: Net deductible position flows to AGI; suspended losses tracked
  const grossRentalNet =
    scheduleERentalIncomeAdj -
    scheduleERentalExpensesAdj -
    scheduleEMacrsDepreciationAdj -
    scheduleEPassiveLossCarryforwardAdj;

  // K9 — FEIE §911. Compute exclusion before income aggregation so we can
  // both add the gross foreign income to AGI and subtract the excluded
  // portion. Stacking rule (Foreign Earned Income Tax Worksheet) is applied
  // at the federal-tax-computation step (passed via feieExclusion).
  const feie = calculateFeie({
    taxpayerForeignEarnedIncome: feieTaxpayerAdj,
    spouseForeignEarnedIncome: feieSpouseAdj,
    filingStatus: client.filingStatus,
    taxYear,
  });
  const feieGrossForeignIncome = feie.taxpayerForeignIncome + feie.spouseForeignIncome;
  const feieExclusion = feie.totalExclusion;
  // K7 QSBS variables are declared above (next to K6 home-sale) so they can
  // join LTCG netting.

  // Provisional AGI (before applying rental net) — used as MAGI for §469
  // phase-out and as initial AGI before any rental adjustment.
  // K-1 income flows here: active ordinary (Sch E Part II), passive-bucket
  // net applied (after carryforward netting), interest, ord div, royalties.
  // (K-1 qualified dividends and K-1 cap gains already folded above.)
  //
  // FEIE: foreign earned income flows into ordinary, then the excluded
  // portion is subtracted. Net effect: only the non-excludable portion of
  // foreign income is in AGI. The federal-tax calc applies the IRS stacking
  // rule to compute tax at the marginal rate that WOULD have applied
  // including the excluded amount.
  //
  // QSBS: the post-exclusion taxable remainder of QSBS gain is added to
  // LTCG (via the LTCG netting variables) — not in ordinary income.
  // E6 — Pub 525 tax-benefit rule (IRC §111). 1099-G state refund is only
  // federal-taxable when prior year itemized (Sched A > std ded). Unemployment
  // is always fully federal-taxable per IRC §85. Pipeline auto-derives the
  // priorYearItemized flag from prior tax_returns row when available; in
  // pure-function mode (no DB), CPAs explicitly set it on ClientFacts.
  // Null/undefined defaults to false (tax-friendly: exclude state refund
  // until evidence of prior itemization).
  const priorYearItemized = client.priorYearItemized === true;
  const taxableStateRefund = priorYearItemized
    ? form1099Summary.stateLocalRefundOnly
    : 0;
  const taxableUnemploymentAndRefund =
    form1099Summary.unemploymentCompensationOnly + taxableStateRefund;

  // ── C7 — §163(j) business interest limit ──
  //
  // C3 follow-up (2026-05-27 PM): refined ATI to closer match IRC §163(j)(8)
  // post-CARES (TY2022+) definition. ATI = taxable income computed WITHOUT
  // considering:
  //   (a) business interest expense / income (§163(j) deduction)
  //   (b) NOL deduction (§172)
  //   (c) QBI deduction (§199A)
  //   (For TY ≤ 2021 only — not relevant for our supported years — also
  //   add back depreciation/amortization/depletion.)
  //
  // Engine refinement: subtract the greater of (std ded) or (itemized-input
  // approximation) from the gross-AGI total. This better approximates
  // "taxable income" since the IRS literal §163(j)(8) definition is the
  // taxable-income line BEFORE §163(j)/NOL/QBI are applied.
  //
  // Remaining sub-gap: itemized-input approximation only sums the major
  // Sched A line-item adjustments (medical / SALT capped / mortgage int /
  // charitable). It doesn't yet honor the charitable %-of-AGI cap or the
  // medical 7.5%-of-AGI floor — the Sched A computation downstream is
  // more precise. This is acceptable as a §163(j) refinement.
  const fedStdDedTY2024: Record<string, number> = {
    single: 14_600,
    married_filing_jointly: 29_200,
    married_filing_separately: 14_600,
    head_of_household: 21_900,
    qualifying_widow: 29_200,
  };
  const fedStdDedTY2025: Record<string, number> = {
    single: 15_000,
    married_filing_jointly: 30_000,
    married_filing_separately: 15_000,
    head_of_household: 22_500,
    qualifying_widow: 30_000,
  };
  const fedStdDedForAti =
    (taxYear === 2025 ? fedStdDedTY2025 : fedStdDedTY2024)[client.filingStatus] ?? 14_600;
  // Approximate itemized total from Sched A inputs available at this point
  // in the pipeline. Sched A object hasn't been computed yet but the
  // line-item adjustments are summed earlier; use them directly with the
  // $10k SALT cap.
  const itemizedApproxForAti =
    Math.max(0, medicalExpensesAdj) +
    Math.min(10_000, stateIncomeTaxAdj + statePropertyTaxAdj + stateSalesTaxAdj) +
    Math.max(0, mortgageInterestAdj) +
    Math.max(0, charitableCashAdj) +
    Math.max(0, charitablePropertyAdj);
  const dedForAti = Math.max(fedStdDedForAti, itemizedApproxForAti);
  const ati163jProxy = Math.max(
    0,
    totalWages +
      additionalIncome +
      additionalIncomeAdjustments +
      investmentIncomeFromAdj +
      netSeIncome +
      form1099Summary.interestIncome +
      form1099Summary.ordinaryDividends +
      form1099Summary.retirementIncome +
      taxableUnemploymentAndRefund +
      form1099Summary.paymentCardIncome +
      form1099Summary.miscIncome +
      ltcgPreferential +
      qualifiedDividends +
      stcgInOrdinary -
      capitalLossDeducted +
      k1ActiveOrdinary +
      k1PassiveAppliedToAgi +
      k1InterestIncome +
      k1OrdinaryDividends +
      k1Royalties +
      feieGrossForeignIncome -
      feieExclusion +
      isoDisqualifyingDispositionOrdinary +
      esppDisqualifyingDispositionOrdinary -
      dedForAti,   // C3 refinement: subtract std/itemized to approximate
                    // "taxable income before §163(j)/NOL/QBI".
  );
  const section163jGross = Math.max(0, section163jBusinessInterestExpenseAdj);
  const section163jCarryforwardFromPrior = Math.max(0, section163jCarryforwardFromPriorAdj);
  const section163jBusinessInterestIncome = Math.max(0, section163jBusinessInterestIncomeAdj);
  const section163jFloorPlanInterest = Math.max(0, section163jFloorPlanInterestAdj);
  // §163(j)(1): allowance = (biz interest income) + (floor plan financing
  // interest) + (30% × ATI). Items NOT subject to the 30% cap are added
  // directly. Items subject (gross interest + carryforward) cap at 30% ATI.
  const cappedPortion = section163jGross + section163jCarryforwardFromPrior;
  const cappedAllowance = 0.30 * ati163jProxy;
  const cappedAllowed = Math.min(cappedPortion, cappedAllowance);
  const section163jAllowedDeduction =
    cappedAllowed + section163jBusinessInterestIncome + section163jFloorPlanInterest;
  const section163jDisallowedCarryforward = Math.max(0, cappedPortion - cappedAllowed);
  // Track gross for transparency (the CPA-entered input).
  const section163jBusinessInterestExpense = section163jGross;

  const ordinaryAdditionalIncomeBeforeRental =
    additionalIncome +
    additionalIncomeAdjustments +
    investmentIncomeFromAdj +
    netSeIncome +
    form1099Summary.interestIncome +
    form1099Summary.ordinaryDividends +
    form1099Summary.retirementIncome +
    taxableUnemploymentAndRefund +
    form1099Summary.paymentCardIncome +
    form1099Summary.miscIncome +
    ltcgPreferential +
    qualifiedDividends +
    stcgInOrdinary -
    capitalLossDeducted +
    k1ActiveOrdinary +
    k1PassiveAppliedToAgi +
    k1InterestIncome +
    k1OrdinaryDividends +
    k1Royalties +
    feieGrossForeignIncome -  // K9 — add gross foreign earned income
    feieExclusion +           // K9 — subtract FEIE excluded portion
    isoDisqualifyingDispositionOrdinary +    // C6 — ISO disqualifying disposition comp income
    esppDisqualifyingDispositionOrdinary +   // C6 — §423 ESPP disqualifying disposition comp income
    section461lExcessLossAddback -           // C7 — §461(l) excess business loss addback (positive add)
    section163jAllowedDeduction;             // C7 — §163(j) allowed business interest (deduction)
  const provisionalAgiForPal = Math.max(0, totalWages + ordinaryAdditionalIncomeBeforeRental);

  let rentalNetAppliedToAgi = 0;
  let passiveLossAllowance: PassiveActivityLossResult | null = null;
  if (grossRentalNet >= 0) {
    // Net income: flows directly to AGI (no PAL limit on income)
    rentalNetAppliedToAgi = grossRentalNet;
  } else {
    // Net loss: apply §469 PAL limit ($25k allowance or fully suspended)
    passiveLossAllowance = calculatePassiveActivityLossAllowance({
      rentalLoss: Math.abs(grossRentalNet),
      modifiedAgi: provisionalAgiForPal,
      filingStatus: client.filingStatus,
      isActiveParticipant: client.rentalActiveParticipant ?? true,
      isRealEstateProfessional: client.rentalRealEstateProfessional ?? false,
    });
    rentalNetAppliedToAgi = -passiveLossAllowance.allowedThisYear; // negative = reduces AGI
  }

  const ordinaryAdditionalIncome = ordinaryAdditionalIncomeBeforeRental + rentalNetAppliedToAgi;

  const totalIncomeProvisional = totalWages + ordinaryAdditionalIncome;

  // ── Step 3: Above-the-line deductions ───────────────────────────────
  const ageTaxpayer = client.taxpayerAge ?? 0;

  const educatorExpenses = calculateEducatorExpenses({
    expenses: educatorExpensesAdj,
    eligibleEducatorCount: client.eligibleEducatorCount ?? 0,
    taxYear,
  });
  const educatorDeduction = educatorExpenses.deductible;

  const retirementForLimits = calculateRetirementDeductions({
    hsaContribution: hsaContributionAdj,
    hsaEmployerContribution: hsaEmployerContributionAdj,
    hsaIsFamilyCoverage: client.hsaIsFamilyCoverage ?? false,
    iraContribution: iraTraditionalAdj,
    iraCoveredByWorkplacePlan: client.iraCoveredByWorkplacePlan ?? false,
    age: ageTaxpayer,
    agi: Math.max(0, totalIncomeProvisional - (deductionAdjustments + otherDeductions + se.deductibleHalf + sehi.deduction + educatorDeduction + Math.min(hsaContributionAdj, 10000))),
    filingStatus: client.filingStatus,
    taxYear,
  });
  const hsaDeduction = retirementForLimits.hsaDeductible;

  // E7 — Apply §179 income limit. Can't exceed net business (SE) income;
  // any unused §179 amount carries forward (CPA tracks externally for now).
  const section179Applied = Math.min(section179Preliminary, Math.max(0, se.netSeEarnings));
  const section179Carryforward = Math.max(0, section179Preliminary - section179Applied);
  const aboveTheLineDeterministic =
    deductionAdjustments + otherDeductions + se.deductibleHalf + hsaDeduction + educatorDeduction + sehi.deduction +
    // E7 — §179 + bonus depreciation. Both reduce taxable income.
    section179Applied + bonusDepreciationApplied;

  const magiForSli = Math.max(0, totalIncomeProvisional - aboveTheLineDeterministic);
  const studentLoanInterest = calculateStudentLoanInterest({
    interestPaid: studentLoanInterestAdj,
    magi: magiForSli,
    filingStatus: client.filingStatus,
    taxYear,
  });
  const sliDeduction = studentLoanInterest.deductible;

  const aboveTheLineExcludingIra = aboveTheLineDeterministic + sliDeduction;
  const agiBeforeIra = Math.max(0, totalIncomeProvisional - aboveTheLineExcludingIra);

  const retirement = calculateRetirementDeductions({
    hsaContribution: hsaContributionAdj,
    hsaEmployerContribution: hsaEmployerContributionAdj,
    hsaIsFamilyCoverage: client.hsaIsFamilyCoverage ?? false,
    iraContribution: iraTraditionalAdj,
    iraCoveredByWorkplacePlan: client.iraCoveredByWorkplacePlan ?? false,
    age: ageTaxpayer,
    agi: agiBeforeIra,
    filingStatus: client.filingStatus,
    taxYear,
  });
  const iraDeduction = retirement.iraDeductible;

  const aboveTheLineAdjustments = aboveTheLineExcludingIra + iraDeduction;

  // ── K10 — Social Security taxability (Pub 915 Worksheet) ──────────
  // SS benefits are NOT currently in totalIncomeProvisional. We compute the
  // taxable portion using "AGI excluding SS" = the existing provisionalAgi
  // (which is built from W-2, 1099, K-1, etc. — none containing SS), then
  // fold the taxable portion into both ordinaryAdditionalIncome and
  // totalIncomeProvisional so that AGI / taxable income / federal-tax
  // pipeline downstream sees the full picture.
  //
  // Sub-gap (documented): SLI/IRA deductions above were computed against
  // AGI WITHOUT taxable SS. The Pub 915 worksheet line 6 intentionally
  // excludes SLI (so SS taxability uses pre-SLI AGI), but IRA's own
  // Pub 590-A MAGI includes taxable SS. Our engine takes a single pass
  // (SLI/IRA at pre-SS AGI), which slightly over-deducts SLI/IRA for
  // filers whose taxable SS would push them into a phase-out band.
  const agiExcludingSs = Math.max(0, totalIncomeProvisional - aboveTheLineAdjustments);
  const ssTaxability = calculateSocialSecurityTaxability({
    ssBenefits: toNum(client.socialSecurityBenefits),
    agiExcludingSs,
    taxExemptInterest: form1099Summary.taxExemptInterest,
    filingStatus: client.filingStatus,
    mfsLivedApartAllYear: client.mfsLivedApartAllYear ?? false,
  });
  const taxableSocialSecurity = ssTaxability.taxableAmount;

  // Final ordinaryAdditionalIncome and totalIncomeProvisional include
  // taxable SS as ordinary income (Form 1040 Line 6b → flows to Line 9).
  const ordinaryAdditionalIncomeWithSs = ordinaryAdditionalIncome + taxableSocialSecurity;
  const totalIncomeProvisionalWithSs = totalIncomeProvisional + taxableSocialSecurity;

  // ── Step 4: Schedule A itemized vs Standard ────────────────────────
  const provisionalAgi = Math.max(0, totalIncomeProvisionalWithSs - aboveTheLineAdjustments);

  const scheduleA = calculateScheduleA({
    agi: provisionalAgi,
    filingStatus: client.filingStatus,
    taxYear,
    inputs: {
      medicalExpenses: medicalExpensesAdj,
      stateIncomeTax: stateIncomeTaxAdj,
      statePropertyTax: statePropertyTaxAdj,
      stateSalesTax: stateSalesTaxAdj,
      mortgageInterest: mortgageInterestAdj,
      charitableCash: charitableCashAdj,
      charitableProperty: charitablePropertyAdj,
      charitableCarryforwardCash: charitableCarryforwardCashAdj,
    },
  });

  const itemizedTotal = Math.max(scheduleA.totalItemized, additionalDeductions);
  const stdDed = getFederalStandardDeduction(client.filingStatus, taxYear);
  const useItemizedDeductions =
    useItemizedDeductionsOverride === true
      ? true
      : useItemizedDeductionsOverride === false && additionalDeductions === 0 && scheduleA.totalItemized === 0
        ? false
        : itemizedTotal > stdDed;

  // ── Step 5: Run base tax calc (federal AGI + taxable + state) ──────
  // additionalIncome now includes the taxable portion of Social Security
  // (K10) — Form 1040 Line 6b flows into Line 9 total income → AGI.
  const calc = runTaxCalculation({
    totalWages,
    additionalIncome: ordinaryAdditionalIncomeWithSs,
    filingStatus: client.filingStatus,
    stateCode: stateCode ?? "CA",
    useItemizedDeductions,
    itemizedDeductions: itemizedTotal,
    adjustments: aboveTheLineAdjustments,
    taxYear,
    // Age-65 / blind add-on inputs (IRS Form 1040 Std Ded Chart).
    taxpayerAge: client.taxpayerAge,
    spouseAge: client.spouseAge,
  });

  // K-1 §199A QBI (Box 20 Z on 1065 / Box 17 V on 1120-S) joins the QBI base.
  // Wage/UBIA limit not enforced (only binds above the income threshold) —
  // see CLAUDE.md known limitations.
  //
  // C3 follow-up (2026-05-27 PM) — QBI auto-default:
  //   * Sch C net (after half-SE adjustment) defaults into QBI when CPA
  //     hasn't explicitly set `qbi_income` adjustment.
  //   * K-1 Box 1 active ordinary defaults to QBI when K-1.section199aQbi
  //     not populated AND activityType is "active".
  //   * SSTB flag (`qbi_sstb_flag` adjustment, amount > 0): when AGI is over
  //     the §199A phase-in cap ($191,950 single / $383,900 MFJ TY2024;
  //     $241,950 / $483,900 with $50k/$100k phase-in band), SSTB filers
  //     get a phased-out 20%. Non-SSTB high-income filers are NOT
  //     phased out at the engine level (wage/UBIA limit applied externally
  //     — sub-gap).
  //   * Explicit `qbi_income` adjustment (when > 0) STILL wins as override
  //     for cases where CPA wants to enter a different number (e.g., partial
  //     QBI eligibility, REIT/PTP dividends, etc.).
  //
  // Closes Tier-1 finding 4.1 / 6.1 from the C3 shadow-CPA validation.
  let qbiIncomeEffective = qbiIncome;
  if (qbiIncomeEffective <= 0) {
    // Default Sch C contribution: net SE (incl. K-1 partnership 14A passes
    // through separately via k1SelfEmploymentEarnings — that piece is
    // NOT QBI-eligible at the Sch C level; it's QBI via the K-1 row).
    const schCQbi = Math.max(0, netSeIncome - se.deductibleHalf);
    qbiIncomeEffective = schCQbi;
  }
  // K-1 default: when section199aQbi unset for active K-1, use Box 1.
  let k1QbiContributionEffective = k1QbiContribution;
  if (k1QbiContributionEffective <= 0 && k1sForYear.length > 0) {
    let k1QbiAutoSum = 0;
    for (const k of k1sForYear) {
      const explicitQbi = toNum(k.section199aQbi);
      if (explicitQbi > 0) continue; // already counted in k1QbiContribution
      const isActive = (k.activityType ?? "active") !== "passive";
      if (!isActive) continue; // passive K-1 income isn't QBI for the holder
      const box1 = toNum(k.box1OrdinaryIncome);
      const box2 = toNum(k.box2RentalRealEstate);
      const box3 = toNum(k.box3OtherRentalIncome);
      // QBI candidate: active ordinary + active other rental (Box 3 from
      // 1065 = guaranteed payments to partners EXCLUDED; non-self-rental
      // INCLUDED). Box 2 (rental RE) excluded — typically passive at
      // the holder level even when active at the partnership level.
      const qbiCandidate = Math.max(0, box1 + box3 + box2);
      // For S-corp K-1: reduce by reasonable compensation (W-2) the
      // shareholder receives from the same S-corp — sub-gap, not modeled
      // because we don't have linkage between W-2 and S-corp K-1 records.
      k1QbiAutoSum += qbiCandidate;
    }
    k1QbiContributionEffective += k1QbiAutoSum;
  }

  // SSTB phase-in (§199A(d)(3)). Phase-in band TY2024:
  //   Single: $191,950 to $241,950 (50k band)
  //   MFJ:    $383,900 to $483,900 (100k band)
  // SSTB filers above the top of band → QBI deduction = $0.
  // Non-SSTB filers above top of band → wage/UBIA limit (NOT modeled).
  const sstbFlagSet = sumByType("qbi_sstb_flag") > 0;
  const QBI_PHASEIN_2024: Record<string, { start: number; end: number }> = {
    single: { start: 191_950, end: 241_950 },
    married_filing_separately: { start: 95_975, end: 120_975 },
    head_of_household: { start: 191_950, end: 241_950 },
    married_filing_jointly: { start: 383_900, end: 483_900 },
    qualifying_widow: { start: 383_900, end: 483_900 },
  };
  const QBI_PHASEIN_2025: Record<string, { start: number; end: number }> = {
    // Rev. Proc. 2024-40 inflation adjustments
    single: { start: 197_300, end: 247_300 },
    married_filing_separately: { start: 98_650, end: 123_650 },
    head_of_household: { start: 197_300, end: 247_300 },
    married_filing_jointly: { start: 394_600, end: 494_600 },
    qualifying_widow: { start: 394_600, end: 494_600 },
  };
  const phaseIn =
    (taxYear === 2025 ? QBI_PHASEIN_2025 : QBI_PHASEIN_2024)[client.filingStatus] ??
    (taxYear === 2025 ? QBI_PHASEIN_2025 : QBI_PHASEIN_2024).single;
  let sstbPhaseFraction = 1;
  if (sstbFlagSet) {
    if (calc.adjustedGrossIncome >= phaseIn.end) {
      sstbPhaseFraction = 0;
    } else if (calc.adjustedGrossIncome > phaseIn.start) {
      sstbPhaseFraction =
        (phaseIn.end - calc.adjustedGrossIncome) / (phaseIn.end - phaseIn.start);
    }
  }

  // K4 — NOL carryforward (post-TCJA 80% limit, IRC §172(a)(2)). Computed
  // BEFORE QBI (FED-04) so the §199A 20%-of-taxable-income cap is keyed to
  // POST-NOL taxable income (the NOL is subtracted in arriving at §63 taxable
  // income / Form 8995 Line 11). The 80% NOL limit itself stays on pre-NOL,
  // pre-QBI taxable income per §172(a)(2) ("without regard to §§172/199A/250").
  // Unused NOL carries to next year. Engine returns transparency fields.
  const nolCarryforwardAvailable = Math.max(0, nolCarryforwardAdj);
  const nolLimit = 0.80 * Math.max(0, calc.taxableIncome);
  const nolDeduction = Math.min(nolCarryforwardAvailable, Math.max(0, nolLimit));
  const nolCarryforwardRemaining = Math.max(0, nolCarryforwardAvailable - nolDeduction);
  const taxableAfterNol = Math.max(0, calc.taxableIncome - nolDeduction);

  const qbiCombinedIncome =
    (qbiIncomeEffective + k1QbiContributionEffective) * sstbPhaseFraction;
  const qbi = calculateQbi({
    qbiIncome: qbiCombinedIncome,
    // FED-04: cap base is POST-NOL taxable income, per Form 8995 Line 11.
    taxableIncomeBeforeQbi: taxableAfterNol,
    // §199A(e)(3): the taxable-income limit is 20% of (taxable income − net
    // capital gain), where net capital gain = preferential LTCG + qualified
    // dividends. Omitting it lets QBI wrongly shelter preferential-rate income.
    netCapitalGain: ltcgPreferential + qualifiedDividends,
  });

  const taxableAfterQbi = Math.max(0, taxableAfterNol - qbi.finalDeduction);

  // ── Step 6: Federal tax (ordinary + preferential) ──────────────────
  // Use post-netting LTCG (not raw 1099-B value) for preferential calculation.
  const preferentialIncome = ltcgPreferential + qualifiedDividends;
  const ordinaryPortionOfTaxable = Math.max(0, taxableAfterQbi - preferentialIncome);

  // K8 — Kiddie tax (Form 8615) child unearned income.
  // Unearned for our engine = interest + ordinary divs + qualified divs +
  // post-netting LTCG (positive) + post-netting STCG (positive). The
  // engine's $2,600 threshold is the TY2024 net-unearned figure
  // ($1,300 std + $1,300 at child rate).
  const kiddieUnearnedIncome = client.isKiddieTaxFiler
    ? Math.max(0, form1099Summary.interestIncome + form1099Summary.ordinaryDividends +
                  qualifiedDividends + Math.max(0, ltcgPreferential) + Math.max(0, stcgInOrdinary) +
                  k1InterestIncome + k1OrdinaryDividends)
    : 0;
  const capGains = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: ordinaryPortionOfTaxable,
    longTermGains: ltcgPreferential,
    qualifiedDividends,
    shortTermGains: 0, // post-netting STCG already in ordinaryPortionOfTaxable
    filingStatus: client.filingStatus,
    taxYear,
    // K9 — FEIE stacking rule: tax computed at the marginal rate that
    // would have applied if FEIE were not excluded.
    feieExclusion,
    // K8 — Form 8615 kiddie tax (when applicable).
    kiddieTax: client.isKiddieTaxFiler
      ? {
          isKiddieTaxFiler: true,
          unearnedIncome: kiddieUnearnedIncome,
          parentsTopMarginalRate: toNum(client.parentsTopMarginalRate),
        }
      : undefined,
  });
  const regularFederalTax = capGains.totalFederalTax;

  // BP3 — auto-derive Form 6251 line 2g SALT addback when itemizing.
  // SALT deducted on Schedule A reduced regular-tax base; it is disallowed
  // for AMT (Form 6251 line 2g). The auto value uses our computed
  // saltDeductible (state income/property/sales tax, $10k cap post-TCJA).
  // The `amt_state_tax_addback_override` adjustment, when > 0, replaces the
  // auto value (rare cases — different AMT SALT figure than Schedule A).
  // When taking the standard deduction, no SALT was deducted → addback = 0.
  const autoSaltAddback = useItemizedDeductions ? scheduleA.saltDeductible : 0;
  const saltAddbackForAmt = amtStateTaxAddbackOverride > 0
    ? amtStateTaxAddbackOverride
    : autoSaltAddback;
  // Total Form 6251 AMTI adjustment = legacy catch-all + ISO bargain + SALT addback
  const totalAmtPreferences = amtPreferencesLegacy + amtIsoBargainElement + saltAddbackForAmt;

  const amt = calculateAmt({
    taxableIncome: taxableAfterQbi,
    amtPreferences: totalAmtPreferences,
    // K3 — Form 6251 Part III: preserve LTCG/QDIV preferential rates inside AMT.
    // Closed 2026-05-24; previously the engine over-charged AMT on
    // high-LTCG + AMT-binding filers by taxing LTCG at 26/28%.
    ltcgPlusQdiv: preferentialIncome,
    filingStatus: client.filingStatus,
    regularTax: regularFederalTax,
    taxYear,
  });

  // ── §1411 Net Investment Income (NIIT) base ─────────────────────────────
  // §1411(c)(1): NII = portfolio income (interest, dividends, royalties) +
  // rents + income from passive activities + net gain on the disposition of
  // property. Income from a NON-passive trade or business is EXCLUDED, so
  // active K-1 ordinary (k1ActiveOrdinary) and Schedule C (netSeIncome) are
  // intentionally omitted. Rental real estate is passive (→ NII) for the
  // ordinary landlord; a real-estate professional's rental is non-passive and
  // excluded via client.rentalRealEstateProfessional. Capital LOSSES reduce
  // NII only to zero (floored below).
  //
  // Built from the engine's component buckets — NOT form1099Summary.total-
  // InvestmentIncome, which is 1099-only and omitted K-1 portfolio/passive
  // income, 1099-MISC rents/royalties, passive Sch E rental, and the post-
  // netting gains (§121 remainder, §1031 recognized, QSBS, K-1 Box 8/9a,
  // capital-transaction detail). Closes audit findings H-2 and M-1.
  const niitRentalIsNonPassive = client.rentalRealEstateProfessional === true;
  const totalInvestmentIncomeForNiit = Math.max(
    0,
    investmentIncomeFromAdj +
      // Portfolio income — always NII (1099 + K-1). Dividend terms mirror the
      // AGI income assembly above (1099 non-qualified + combined qualified +
      // K-1 Box 6a) so NII stays consistent with the dividends already in AGI.
      form1099Summary.interestIncome +
      form1099Summary.ordinaryDividends +
      qualifiedDividends +
      k1InterestIncome +
      k1OrdinaryDividends +
      form1099Summary.royalties +
      k1Royalties +
      // Rents — passive for the ordinary landlord; excluded for RE professionals:
      (niitRentalIsNonPassive ? 0 : form1099Summary.rents + Math.max(0, rentalNetAppliedToAgi)) +
      // Passive pass-through income (engine already segregates active vs passive):
      Math.max(0, k1PassiveAppliedToAgi) +
      // Net gain on disposition: post-netting positive LTCG + STCG (already
      // folds in 1099-B, K-1 Box 8/9a, §121 remainder, §1031 recognized, QSBS):
      ltcgPreferential +
      stcgInOrdinary,
  );
  const niit = calculateNiit({
    investmentIncome: totalInvestmentIncomeForNiit,
    // FED-03 — §1411(d): NIIT MAGI = AGI + the §911(a)(1) FEIE add-back. The
    // §911(d)(6) net-down for deductions allocable to excluded income is not
    // modeled (sub-gap), so we add back the gross exclusion — exact for the
    // common full-exclusion / no-allocable-deduction expat case.
    modifiedAgi: calc.adjustedGrossIncome + feieExclusion,
    filingStatus: client.filingStatus,
  });

  // ── State tax (multi-state with resident credit + reciprocity) ──
  // Always recompute (not just for OR) because state retirement-income
  // exemptions (PA, IL, MS), per-W-2 state allocation, and reciprocity
  // agreements all need full info that runTaxCalculation didn't have.
  const stateUpper = (stateCode ?? "").toUpperCase();
  const federalIncomeTaxForOr = stateUpper === "OR" ? regularFederalTax + amt.amtTax : undefined;

  // Aggregate W-2 wages by stateCode for non-resident allocation
  const perStateWages = new Map<string, number>();
  for (const w of w2Records) {
    const code = (w.stateCode || stateUpper || "").toUpperCase();
    if (!code) continue;
    perStateWages.set(code, (perStateWages.get(code) ?? 0) + toNum(w.wagesBox1));
  }
  const perStateWagesArr = [...perStateWages.entries()].map(([code, wages]) => ({ stateCode: code, wages }));

  // NYC household credit (line 48) lookup uses item H + 1 (+ 1 if MFJ).
  // We approximate item H count from dependentsUnder17 + otherDependents.
  const localDependentCount =
    1 +
    (client.filingStatus === "married_filing_jointly" || client.filingStatus === "qualifying_widow" ? 1 : 0) +
    (client.dependentsUnder17 ?? 0) +
    (client.otherDependents ?? 0);

  // E12 — Part-year residency: pass when client has residency change set.
  // Engine pro-rates AGI by days and computes both states' resident tax.
  //
  // C11 — Two opt-in source-allocation markers:
  //   * `part_year_use_w2_source` — wages sourced per W-2 stateCode
  //   * `part_year_use_full_source_allocation` — ALSO sources K-1 income
  //     (by `sourceState`) and rental net income (by `RentalPropertyFact.sourceState`
  //     or `state` field if no sourceState), and intangibles (interest/div/
  //     STCG/LTCG) to the resident state by days.
  const useW2SourceAllocation =
    sumByType("part_year_use_w2_source") > 0 ||
    sumByType("part_year_use_full_source_allocation") > 0;
  const useFullSourceAllocation =
    sumByType("part_year_use_full_source_allocation") > 0;
  const partYearResidencyArg = (
    client.residencyChangedInYear === true &&
    client.formerState &&
    client.residencyChangeDate &&
    client.formerState.toUpperCase() !== (stateCode ?? "").toUpperCase()
  )
    ? {
        formerState: client.formerState,
        residencyChangeDate: client.residencyChangeDate,
        useW2SourceAllocation,
      }
    : undefined;

  // C11 deeper — When full source allocation is enabled and the filer is
  // part-year, aggregate K-1 income by sourceState + rental net income by
  // sourceState. These flow to their source-state share rather than
  // pro-rata-by-days (standard NY IT-203 / CA 540NR sourcing rule).
  let perStateOtherSourced: Record<string, number> | undefined;
  if (useFullSourceAllocation && partYearResidencyArg) {
    perStateOtherSourced = {};
    // K-1 sourcing: sum each K-1's net income (Box 1 + Box 2 + Box 3 +
    // interest/div/royalties/STCG/LTCG) to its sourceState.
    for (const k of inputs.scheduleK1 ?? []) {
      if (k.taxYear !== taxYear) continue;
      const src = (k.sourceState ?? "").toUpperCase();
      if (!src) continue; // No source → fall through to pro-rata
      const k1NetIncome =
        toNum(k.box1OrdinaryIncome) +
        toNum(k.box2RentalRealEstate) +
        toNum(k.box3OtherRentalIncome) +
        toNum(k.interestIncome) +
        toNum(k.ordinaryDividends) +
        toNum(k.royalties) +
        toNum(k.netShortTermCapitalGain) +
        toNum(k.netLongTermCapitalGain);
      if (k1NetIncome === 0) continue;
      perStateOtherSourced[src] =
        (perStateOtherSourced[src] ?? 0) + k1NetIncome;
    }
    // Rental sourcing: rental net = income − expenses − MACRS. Source to
    // the rental property's state field.
    for (const p of inputs.rentalProperties ?? []) {
      if (p.taxYear !== taxYear) continue;
      const src = (p.sourceState ?? "").toUpperCase();
      if (!src) continue; // No source → fall through to pro-rata
      const propIncome = toNum(p.rentalIncome);
      const propExpenses = toNum(p.totalExpenses);
      let propDepreciation = 0;
      if (
        toNum(p.basis) > 0 &&
        (p.placedInServiceYear ?? 0) > 0 &&
        (p.placedInServiceMonth ?? 0) >= 1 &&
        (p.placedInServiceMonth ?? 0) <= 12
      ) {
        const dep = calculateMacrsDepreciation({
          basis: toNum(p.basis),
          propertyType:
            p.propertyType === "commercial" ? "commercial" : "residential",
          monthPlacedInService: p.placedInServiceMonth ?? 1,
          yearPlacedInService: p.placedInServiceYear ?? taxYear,
          taxYear,
        });
        propDepreciation = dep.currentYearDepreciation;
      }
      const netRental = propIncome - propExpenses - propDepreciation;
      if (netRental === 0) continue;
      perStateOtherSourced[src] =
        (perStateOtherSourced[src] ?? 0) + netRental;
    }
  }

  const multiState = calculateMultiStateTax({
    residentState: stateCode ?? "CA",
    federalAgi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    taxYear,
    perStateWages: perStateWagesArr,
    localityCode: client.localityCode ?? null,
    localDependentCount,
    // E14 — Total W-2 wages for OH municipal income tax base.
    totalWages,
    // E12 — Part-year residency split (when set).
    partYearResidency: partYearResidencyArg,
    options: {
      federalIncomeTaxPaid: federalIncomeTaxForOr,
      retirementIncomeForExemption: form1099Summary.retirementIncome,
      taxpayerAge: client.taxpayerAge ?? undefined,
      // NJ pension-exclusion phase-out tests against NJ gross income; for
      // K10 NJ explicitly excludes taxable SS from NJ gross. Use
      // (federal AGI − taxable SS) so NJ filers with retirement income +
      // SS don't phase out at the lower NJ income they actually report.
      njGrossIncomeApprox: Math.max(0, calc.adjustedGrossIncome - taxableSocialSecurity),
      // K10 — taxable SS excluded from state base for the 41 jurisdictions
      // not in STATES_TAXING_SS (40 states + DC). For the 9 SS-taxing
      // states (CO/CT/KS/MN/MT/NM/RI/UT/VT), federal AGI inherently
      // includes taxable SS and the state tax base inherits it.
      taxableSocialSecurity,
      // G4 — WA 7% LTCG excise (RCW 82.87). Only applied when resident
      // state is WA. Threshold = $262k TY2024.
      longTermCapitalGains: ltcgPreferential,
      // G5 — federal AMT preferences total for CA AMT (Schedule P 540).
      // Only applied when resident state is CA. SALT addback + ISO bargain
      // + legacy catch-all.
      amtPreferences: totalAmtPreferences,
      // E11 — Dependent count for PA Schedule SP Tax Forgiveness bracket
      // adjustment ($9,500 per dependent). Only applied when resident is PA.
      dependentCount: (client.dependentsUnder17 ?? 0) + (client.otherDependents ?? 0),
      // E8 — Net SE earnings for NYC MCTMT. Only applied when
      // localityCode === "NYC".
      netSeEarnings: se.netSeEarnings,
      // STL-02 — net Schedule-C/1099-NEC profit (line 31) for PA local EIT /
      // OH SDIT earned-income base (legally includes SE net profit).
      netSeProfit: netSeIncome,
      // C10 — Optional CPA-supplied OH IT-1040 Line 3 for SDIT traditional
      // base. Read via adjustment marker `oh_sdit_traditional_base`. Only
      // applied for OH SDIT-traditional districts.
      ohTraditionalBase: sumByType("oh_sdit_traditional_base") > 0
        ? sumByType("oh_sdit_traditional_base")
        : undefined,
      // C11 deeper — Per-state K-1 + rental sourcing (only used when
      // `part_year_use_full_source_allocation` is enabled AND filer is part-year).
      perStateOtherSourced,
    },
  });
  // State + local: state tax is reported separately; local (NYC) is its own line.
  const stateTaxLiability = multiState.totalStateTax;
  const localTaxLiability = multiState.localTax?.netLocalTax ?? 0;

  // Form 8959 Additional Medicare Tax — 0.9% on Medicare wages + SE net
  // above filing-status threshold ($200k single/HoH/QSS, $250k MFJ,
  // $125k MFS). Reported on Sch 2 Line 11 — not offset by non-refundable
  // credits. Closes deep-audit gap K2.
  const additionalMedicare = calculateAdditionalMedicareTax({
    medicareWages: w2MedicareWages,
    seNetEarnings: se.netSeEarnings,
    filingStatus: client.filingStatus,
  });

  const totalFederalLiability =
    regularFederalTax + amt.amtTax + niit.niitTax + se.seTaxTotal + additionalMedicare.additionalMedicareTax +
    // E5 — IRC §72(t) early-withdrawal additional tax (Sched 2 Line 8).
    // Not offset by non-refundable credits per §72(t) statute.
    form1099Summary.earlyWithdrawalPenalty +
    // E4 — IRC §4973(g) 6% excise on HSA contributions over the annual cap.
    // Reported on Form 5329 Part VII. Not offset by non-refundable credits.
    retirement.hsaExcessExcise;

  // ── Step 7: Non-refundable credits in IRS Sched 3 order ──
  const incomeTaxOnly = regularFederalTax + amt.amtTax;
  let availableForNonRefundable = incomeTaxOnly;

  const earnedIncomeHousehold = totalWages + Math.max(0, netSeIncome - se.deductibleHalf);
  const ctc = calculateChildTaxCredit({
    qualifyingChildren: client.dependentsUnder17 ?? 0,
    otherDependents: client.otherDependents ?? 0,
    agi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    taxYear,
    taxBeforeCredit: availableForNonRefundable,
    earnedIncome: earnedIncomeHousehold,
  });
  availableForNonRefundable = Math.max(0, availableForNonRefundable - ctc.nonRefundablePortion);

  const foreignTaxCredit = calculateForeignTaxCredit({
    foreignTaxPaid: foreignTaxPaidAdj,
    filingStatus: client.filingStatus,
    // Form 1116 limit inputs — only meaningful when foreignTaxPaid exceeds the
    // simplified $300/$600 limit. Otherwise the calculator ignores them.
    // totalTaxableIncome is Form 1040 Line 15 (taxable income).
    // preCreditUsTax is the federal income tax before any credits
    // (= 1040 Line 16 + Line 17 = regular tax + AMT).
    foreignSourceTaxableIncome: foreignSourceTaxableIncomeAdj > 0 ? foreignSourceTaxableIncomeAdj : undefined,
    totalTaxableIncome: taxableAfterQbi,
    preCreditUsTax: incomeTaxOnly,
  });
  const foreignTaxApplied = Math.min(foreignTaxCredit.credit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - foreignTaxApplied);

  const isMfj =
    client.filingStatus === "married_filing_jointly" ||
    client.filingStatus === "qualifying_widow";
  const spouseEarnedIncome = isMfj ? toNum(client.spouseEarnedIncome ?? null) : 0;
  const taxpayerEarnedIncomeOnly = isMfj
    ? Math.max(0, earnedIncomeHousehold - spouseEarnedIncome)
    : earnedIncomeHousehold;
  const dependentCareCredit = calculateDependentCareCredit({
    expenses: dependentCareExpensesAdj,
    qualifyingDependents: client.dependentsForCareCredit ?? 0,
    earnedIncomeTaxpayer: taxpayerEarnedIncomeOnly,
    earnedIncomeSpouse: spouseEarnedIncome,
    agi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    // §21(e)(2): MFS may claim only if treated as not married (lived apart).
    mfsLivedApart: client.mfsLivedApartAllYear ?? false,
  });
  const depCareApplied = Math.min(dependentCareCredit.appliedCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - depCareApplied);

  // Education credits — AOC per-student
  const aocExpensesPerStudent: number[] = [];
  for (const a of applied) {
    if (a.adjustmentType === "qualified_education_expenses_aoc") {
      aocExpensesPerStudent.push(toNum(a.amount));
    }
  }
  const educationCredits = calculateEducationCredits({
    agi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    aocExpenses: aocExpensesPerStudent,
    llcExpenses: llcExpensesAdj,
  });
  const aocNonRefundableApplied = Math.min(educationCredits.aocNonRefundable, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - aocNonRefundableApplied);
  const llcApplied = Math.min(educationCredits.llcApplied, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - llcApplied);

  // Saver's Credit (Sched 3 Line 4)
  const totalRetirementContribsForSavers =
    iraTraditionalAdj + iraRothAdj + saversContributionsAdj;
  const saversCredit = calculateSaversCredit({
    filingStatus: client.filingStatus,
    agi: calc.adjustedGrossIncome,
    retirementContributions: totalRetirementContribsForSavers,
    taxYear,
  });
  const saversApplied = Math.min(saversCredit.appliedCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - saversApplied);

  // Residential energy + EV charger
  const residentialEnergy = calculateResidentialEnergyCredits({
    cleanEnergySpend: residentialCleanEnergyAdj,
    efficientHomeSpend: energyEfficientHomeAdj,
    heatPumpSpend: energyEfficientHeatpumpAdj,
    evChargerSpend: evChargerPropertyAdj,
  });
  const cleanEnergyApplied = Math.min(residentialEnergy.cleanEnergyCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - cleanEnergyApplied);
  const efficientHomeApplied = Math.min(residentialEnergy.efficientHomeCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - efficientHomeApplied);
  const heatPumpApplied = Math.min(residentialEnergy.heatPumpCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - heatPumpApplied);
  const evChargerApplied = Math.min(residentialEnergy.evChargerCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - evChargerApplied);
  const residentialEnergyApplied =
    cleanEnergyApplied + efficientHomeApplied + heatPumpApplied + evChargerApplied;

  // E2 — Form 8801 Minimum-Tax Credit (IRC §53). Sched 3 Line 6b on TY2024.
  // Carryforward from prior years can offset regular tax DOWN TO the level
  // of tentative minimum tax (Form 6251 Line 8 = amt.amtBeforeRegular).
  // Three caps stack:
  //   (a) the carryforward balance itself,
  //   (b) the spread between this year's regular tax and TMT (the IRC §53(c)
  //       limit — when AMT binds this year, this is 0 → no credit applies),
  //   (c) the remaining `availableForNonRefundable` (can't reduce below $0).
  // Simplified §53(b) generation: amtTax generated this year flows to next
  // year's carryforward in full. CPAs can override via the
  // `amt_credit_carryforward` adjustment for exclusion-item-only AMT
  // (state-tax addback dominates → little credit truly generated).
  const amtCreditCarryforwardIn = sumByType("amt_credit_carryforward");
  const amtCreditApplicable = Math.max(0, regularFederalTax - amt.amtBeforeRegular);
  const amtCreditApplied = Math.min(
    amtCreditCarryforwardIn,
    amtCreditApplicable,
    availableForNonRefundable,
  );
  availableForNonRefundable = Math.max(0, availableForNonRefundable - amtCreditApplied);
  const amtCreditGenerated = amt.amtTax;
  const amtCreditCarryforwardRemaining = Math.max(
    0,
    amtCreditCarryforwardIn + amtCreditGenerated - amtCreditApplied,
  );

  // ── Step 8: Refundable credits + PTC reconciliation ───
  // FED-06 — §32(i)(2) EITC disqualifying-investment-income cliff. Unlike the
  // §1411 NIIT base, §32(i)(2)(B) COUNTS tax-exempt interest, so add it back.
  // The remaining components (taxable interest + dividends, net capital gain,
  // passive/non-business rents & royalties) are shared with the NIIT base, and
  // ordinary-course-of-business rents that §32(i)(2)(C) excludes are already
  // out of that base (RE-pro rents excluded) — so it matches §32(i).
  const eitcDisqualifyingIncome =
    totalInvestmentIncomeForNiit + form1099Summary.taxExemptInterest;
  const eitc = calculateEitc({
    filingStatus: client.filingStatus,
    qualifyingChildren: client.dependentsUnder17 ?? 0,
    earnedIncome: earnedIncomeHousehold,
    agi: calc.adjustedGrossIncome,
    investmentIncome: eitcDisqualifyingIncome,
    taxYear,
  });

  // G1 — NYC EITC sliding scale (NY IT-215 Line 26). Refundable; applied
  // against NYC local tax. Excess refundable portion (when NYC EITC > NYC
  // tax) flows to stateRefundOrOwed alongside state EITC.
  let nycEitcCredit = 0;
  let nycEitcRate = 0;
  let nycEitcRefundableExcess = 0;
  let localTaxLiabilityAfterNycEitc = localTaxLiability;
  if (multiState.localTax && eitc.appliedCredit > 0) {
    nycEitcRate = nycEitcRateForAgi(calc.adjustedGrossIncome);
    nycEitcCredit = eitc.appliedCredit * nycEitcRate;
    if (nycEitcCredit > localTaxLiability) {
      nycEitcRefundableExcess = nycEitcCredit - localTaxLiability;
      localTaxLiabilityAfterNycEitc = 0;
    } else {
      localTaxLiabilityAfterNycEitc = localTaxLiability - nycEitcCredit;
    }
    // Reflect on the multiState.localTax breakdown for transparency.
    multiState.localTax.nycEitc = nycEitcCredit;
    multiState.localTax.nycEitcRate = nycEitcRate;
    multiState.localTax.netLocalTax = localTaxLiabilityAfterNycEitc;
  }

  const acaHouseholdSizeDefault =
    1 +
    (isMfj ? 1 : 0) +
    (client.dependentsUnder17 ?? 0) +
    (client.otherDependents ?? 0);
  const acaHouseholdSize = client.acaHouseholdSize ?? acaHouseholdSizeDefault;
  const premiumTaxCredit = calculatePremiumTaxCredit({
    annualPremium: toNum(client.acaAnnualPremium ?? null),
    annualSlcsp: toNum(client.acaAnnualSlcsp ?? null),
    advanceAptc: toNum(client.acaAdvanceAptc ?? null),
    modifiedAgi: calc.adjustedGrossIncome,
    householdSize: acaHouseholdSize,
    filingStatus: client.filingStatus,
    taxYear,
  });
  const netPremiumTaxCreditRefundable = Math.max(0, premiumTaxCredit.netPtc);
  const excessAdvanceAptcOwed = Math.max(0, -premiumTaxCredit.netPtc);

  const totalNonRefundableApplied =
    ctc.nonRefundablePortion +
    foreignTaxApplied +
    depCareApplied +
    aocNonRefundableApplied +
    llcApplied +
    saversApplied +
    residentialEnergyApplied +
    amtCreditApplied;
  const totalRefundableCreditsApplied =
    ctc.refundableActc +
    educationCredits.aocRefundable +
    eitc.appliedCredit +
    netPremiumTaxCreditRefundable;
  const totalCreditsAppliedForRefund =
    totalNonRefundableApplied + totalRefundableCreditsApplied;

  const totalFederalLiabilityWithRepayment = totalFederalLiability + excessAdvanceAptcOwed;

  const federalRefundOrOwed =
    totalFederalWithheld +
    withholdingAdjustments +
    creditAdjustments +
    totalCreditsAppliedForRefund -
    totalFederalLiabilityWithRepayment;

  // ── State EITC (CA + NY) — refundable, applied to state refund/owed ──
  // Investment income for state EITC eligibility uses 1099-INT/DIV ordinary + qualified
  // (per FTB 3514: line 11 = interest, dividends, capital gains; line 19 = passive activity)
  const investmentIncomeForStateEitc =
    form1099Summary.interestIncome +
    form1099Summary.ordinaryDividends +
    Math.max(0, form1099Summary.shortTermCapitalGains) +
    Math.max(0, form1099Summary.longTermCapitalGains);
  const stateEitc = calculateStateEitc({
    state: stateUpper,
    federalEitcApplied: eitc.appliedCredit,
    federalEitcEligible: eitc.eligible,
    agi: calc.adjustedGrossIncome,
    earnedIncome: earnedIncomeHousehold,
    investmentIncome: investmentIncomeForStateEitc,
    qualifyingChildren: client.dependentsUnder17 ?? 0,
    taxYear: calc.taxYear,
    filingStatus: client.filingStatus,
  });

  // State EITC is refundable — adds to the state refund (or reduces the owed).
  // G1 — refundable NYC EITC excess (when NYC EITC > NYC tax) flows to
  // the state-side refund. State EITC also goes here.
  // G2 — MN refundable CTC ($1,750/child, joint M1CWFC phase-out) is a
  // separate refundable credit that adds to the state refund.
  const mnCtcRefundable = stateEitc.mnCtc ?? 0;

  // E9 — State Child Tax Credits (CA YCTC / CO Family Affordability /
  // NJ CTC / IL CTC / NM CITC / VT CTC). Refundable, added to state refund.
  // CA YCTC requires CalEITC eligibility — we approximate as
  // (CA state EITC > 0 → eligible).
  const caEitcEligibleForYctc = stateUpper === "CA" && stateEitc.credit > 0;
  const stateCtc = calculateStateCtc({
    state: stateUpper,
    agi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    childrenUnder6: 0, // simplified — we don't track per-child age in current schema
    childrenUnder17: client.dependentsUnder17 ?? 0,
    federalCtcApplied: ctc.nonRefundablePortion + ctc.refundableActc,
    caEitcEligible: caEitcEligibleForYctc,
    taxYear: calc.taxYear,
  });
  const stateCtcRefundable = stateCtc.credit;
  // E8 — NYC School Tax Credit (IT-201 Line 69) is REFUNDABLE at state
  // level. Add to state refund alongside state EITC and CTCs.
  const nycSchoolTaxCreditRefundable = multiState.localTax?.nycSchoolTaxCredit ?? 0;

  // C2 — State Additional Credits (NY/CA/IL + MA/NJ/OH/PA/VA/GA/MI non-EITC/CTC credits).
  // Refundable portion adds to state refund; nonRefundable reduces
  // state tax liability (capped at 0).
  // For MA LIC, OH JFC, PA Sched SP, VA LITC, GA LIC the credit references the
  // pre-additional state tax liability — pass it explicitly.
  const taxpayerEarnedIncomeForOh = isMfj
    ? Math.max(0, earnedIncomeHousehold - spouseEarnedIncome)
    : earnedIncomeHousehold;
  const stateAdditionalCredits = calculateStateAdditionalCredits({
    state: stateUpper,
    taxYear: calc.taxYear,
    agi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    dependentsUnder17: client.dependentsUnder17 ?? 0,
    otherDependents: client.otherDependents ?? 0,
    federalCdccApplied: dependentCareCredit.appliedCredit,
    propertyTaxPaid: sumByType("state_property_tax"),
    k12QualifiedExpenses: sumByType("k12_education_expenses"),
    monthsRented: sumByType("ca_renter_months"),
    collegeTuitionExpenses: sumByType("college_tuition_qualified"),
    // Annual rent for MA Circuit Breaker (renter pathway) + NJ Property Tax Credit (renter pathway)
    annualRentPaid: sumByType("annual_rent_paid"),
    // Age inputs for MA Circuit Breaker, GA Retirement Exclusion, OH Senior Citizen, NJ Senior
    taxpayerAge: client.taxpayerAge ?? undefined,
    spouseAge: client.spouseAge ?? undefined,
    // OH Joint Filing Credit needs each spouse with earned income > $500
    spouseQualifyingIncome: spouseEarnedIncome,
    taxpayerQualifyingIncome: taxpayerEarnedIncomeForOh,
    // Pre-credit state tax for MA LIC, OH JFC, PA Sched SP, VA LITC, GA LIC
    preCreditStateTaxLiability: stateTaxLiability,
    // Retirement income (1099-R distributions + pension)
    retirementIncome: form1099Summary.retirementIncome,
    // MA Circuit Breaker — assessed home value + ½ water/sewer
    maAssessedHomeValue: sumByType("ma_assessed_home_value"),
    maWaterSewerHalf: sumByType("ma_water_sewer_half"),
    // MA Lead Paint Removal Credit
    maLeadPaintRemovalCost: sumByType("ma_lead_paint_removal_cost"),
    // PA Schedule SP eligibility income override (otherwise AGI)
    paEligibilityIncome: sumByType("pa_eligibility_income") > 0
      ? sumByType("pa_eligibility_income")
      : undefined,
    // GA Disabled Person Home Purchase retrofit cost
    gaDisabledHomePurchaseCost: sumByType("ga_disabled_home_purchase_cost"),
    // MI Home Heating Credit cost + household resources
    miHomeHeatingCost: sumByType("mi_home_heating_cost"),
    miHouseholdResources: sumByType("mi_household_resources") > 0
      ? sumByType("mi_household_resources")
      : undefined,
  });
  const stateAdditionalRefundable = stateAdditionalCredits.totalRefundable;
  const stateAdditionalNonRefundable = stateAdditionalCredits.totalNonRefundable;
  // Reduce state tax by nonrefundable (capped at 0).
  const stateTaxLiabilityAfterAdditional = Math.max(
    0,
    stateTaxLiability - stateAdditionalNonRefundable,
  );

  const stateRefundOrOwed = totalStateWithheld - stateTaxLiabilityAfterAdditional + stateEitc.credit + mnCtcRefundable + nycEitcRefundableExcess + stateCtcRefundable + nycSchoolTaxCreditRefundable + stateAdditionalRefundable;

  const totalTaxBurden = totalFederalLiabilityWithRepayment + stateTaxLiabilityAfterAdditional - stateEitc.credit - stateCtcRefundable - nycSchoolTaxCreditRefundable - stateAdditionalRefundable;
  const effectiveRate = calc.totalIncome > 0 ? totalTaxBurden / calc.totalIncome : 0;

  // ── Compute state retirement exemption (for transparency in result) ──
  // Pass filing status + NJ-gross approximation so NJ/NY rules apply correctly.
  // NJ gross income ≈ federal AGI minus Social Security; we don't model SS as a
  // separate stream yet, so the approximation is federal AGI (conservative — may
  // over-phase-out NJ filers with significant SS income).
  const stateRetirementExemptionInfo = getStateRetirementExemption({
    stateCode: stateUpper,
    retirementIncome: form1099Summary.retirementIncome,
    filingStatus: client.filingStatus,
    taxpayerAge: client.taxpayerAge ?? undefined,
    njGrossIncomeApprox: calc.adjustedGrossIncome,
  });

  return {
    taxYear: calc.taxYear,
    filingStatus: client.filingStatus,
    stateCode,
    totalIncome: calc.totalIncome,
    adjustedGrossIncome: calc.adjustedGrossIncome,
    standardDeduction: calc.standardDeduction,
    itemizedDeductions: useItemizedDeductions ? itemizedTotal : null,
    qbiDeduction: qbi.finalDeduction,
    taxableIncome: taxableAfterQbi,
    federalTaxLiability: totalFederalLiabilityWithRepayment,
    federalTaxWithheld: totalFederalWithheld + withholdingAdjustments,
    federalRefundOrOwed,
    stateTaxLiability,
    stateTaxWithheld: totalStateWithheld,
    stateRefundOrOwed,
    effectiveTaxRate: effectiveRate,
    manualCreditsApplied: creditAdjustments,
    childTaxCredit: ctc,
    selfEmploymentTax: se.seTaxTotal,
    niitTax: niit.niitTax,
    additionalMedicareTax: additionalMedicare.additionalMedicareTax,
    amtTax: amt.amtTax,
    additionalChildTaxCredit: ctc.refundableActc,
    capitalGainsTax: capGains.preferentialRateTax,
    preferentialIncome,
    form1099Summary,
    scheduleA,
    scheduleCExpenses,
    retirementDeductions: retirement,
    eitc,
    educationCredits,
    saversCredit,
    dependentCareCredit,
    educatorExpenses,
    studentLoanInterest,
    foreignTaxCredit,
    residentialEnergyCredits: residentialEnergy,
    premiumTaxCredit,
    sehi,
    socialSecurityBenefits: ssTaxability.ssBenefits,
    socialSecurityTaxable: taxableSocialSecurity,
    socialSecurityTaxabilityDetail: ssTaxability,
    homeSaleGrossGain,
    homeSaleSection121Exclusion,
    homeSaleTaxableGain,
    section1031RealizedGain,
    section1031BootReceived,
    section1031RecognizedGain,
    section1031DeferredGain,
    isoDisqualifyingDispositionOrdinary,
    esppDisqualifyingDispositionOrdinary,
    section163jBusinessInterestExpense,
    section163jAllowedDeduction,
    section163jDisallowedCarryforward,
    section461lExcessLossAddback,
    feie,
    nolDeduction,
    nolCarryforwardRemaining,
    amtCreditApplied,
    amtCreditGenerated,
    amtCreditCarryforwardRemaining,
    charitableCarryforwardCashRemaining: scheduleA.charitableCarryforwardCashRemaining,
    earlyWithdrawalPenalty: form1099Summary.earlyWithdrawalPenalty,
    hsaExcessExcise: retirement.hsaExcessExcise,
    section179Applied,
    section179Carryforward,
    bonusDepreciationApplied,
    qsbsGrossGain,
    qsbsSection1202Exclusion,
    qsbsTaxableGain,
    capitalLossDeducted,
    capitalLossCarryforwardShort,
    capitalLossCarryforwardLong,
    netCapitalGainLoss: netCapitalTotal,
    stateRetirementExemption: stateRetirementExemptionInfo.exemption,
    stateEitc,
    multiState,
    scheduleERentalGrossNet: grossRentalNet,
    scheduleERentalAppliedToAgi: rentalNetAppliedToAgi,
    passiveActivityLoss: passiveLossAllowance,
    scheduleEPassiveLossSuspended: passiveLossAllowance?.suspendedToNextYear ?? 0,
    localTaxLiability: localTaxLiabilityAfterNycEitc,
    localTaxJurisdiction: multiState.localTax ? multiState.localTax.jurisdiction : null,
    scheduleK1: {
      k1Count: k1sForYear.length,
      partnershipCount: k1sForYear.filter((k) => (k.entityType ?? "partnership") === "partnership").length,
      sCorpCount: k1sForYear.filter((k) => k.entityType === "s_corp").length,
      totalActiveOrdinaryIncome: k1ActiveOrdinary,
      totalPassiveBucketNetApplied: k1PassiveAppliedToAgi,
      k1PassiveLossSuspended,
      totalInterestIncome: k1InterestIncome,
      totalOrdinaryDividends: k1OrdinaryDividends,
      totalQualifiedDividends: k1QualifiedDividends,
      totalRoyalties: k1Royalties,
      totalShortTermCapitalGain: k1Stcg,
      totalLongTermCapitalGain: k1Ltcg,
      totalSelfEmploymentEarnings: k1SelfEmploymentEarnings,
      totalQbiContribution: k1QbiContribution,
    },
    detail: { se, niit, additionalMedicare, qbi, amt, capitalGains: capGains },
    w2Count: w2Records.length,
    form1099Count: form1099Records.length,
    // E13 — Auto wash-sale detection results (0 when no capital_transactions
    // or no detected matches).
    washSalesDetected: washSaleResult.washSalesDetected,
    washSaleLossDisallowed: washSaleResult.washSaleLossDisallowed,
    // E12 — Part-year residency breakdown (0 / null when full-year resident).
    formerStateTax: multiState.partYearResidency?.formerStateTax ?? 0,
    formerStateCode: multiState.partYearResidency?.formerState ?? null,
    daysFormerStateResident: multiState.partYearResidency?.daysFormer ?? 0,
    daysCurrentStateResident: multiState.partYearResidency?.daysCurrent ?? 0,
  };
}
