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
  type PerBusinessQbiLimit,
  qbiPhaseInBand,
  resolveTaxYear,
  calculateObbbaSchedule1ADeductions,
  type ObbbaSchedule1ADeductions,
  calculateAmt,
  computeForm8801CreditGeneration,
  type Form8801GenerationResult,
  SS_WAGE_BASE,
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
  calculateAdoptionCredit,
  calculateRdCredit,
  calculateStateTax,
  calculateMultiStateTax,
  calculateStateEitc,
  calculateStateCtc,
  calculateStateAdditionalCredits,
  calculateNycUbt,
  getStateRetirementExemption,
  calculatePassiveActivityLossAllowance,
  computeForm8582Breakdown,
  type Form8582Breakdown,
  calculateMacrsDepreciation,
  computeScheduleCAssetDepreciation,
  type ScheduleCAsset,
  type ScheduleCAssetDepreciationResult,
  getFederalStandardDeduction,
  getDependentStandardDeductionBase,
  getSaltCap,
  type TaxYear,
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
  type AdoptionCreditCalculation,
  type RdCreditCalculation,
} from "./taxCalculator";
import {
  computeForm4797,
  type BusinessPropertySaleFact,
  type Form4797Result,
} from "./form4797";
import {
  calculateStateIndividualMandatePenalty,
  caFilingThreshold,
  STATES_WITH_INDIVIDUAL_MANDATE,
  type StateMandateResult,
} from "./stateMandate";
import { calculateScheduleH, type ScheduleHResult } from "./scheduleH";

// ── Loose numeric coercion ──────────────────────────────────────────────────
// Drizzle numeric() columns are strings; Haven might pass plain numbers.
// Both work. Non-finite results are logged to surface silent-zero bugs
// (e.g. an AI extraction stored `"$1,200.00"` instead of `1200.00`).
type Numish = string | number | null | undefined;
// No real individual-return dollar figure approaches this; it is far above the
// DB numeric(12,2) column ceiling yet far below the point where summing/scaling
// a handful of them overflows a float64 to ±Infinity. Clamping here keeps
// `computeTaxReturnPure` TOTAL (it can never emit NaN/Infinity) even if called
// directly with garbage — the Haven-portable backstop. The API layer rejects
// out-of-range inputs with a clean 400 (openapi min/max); this is belt-and-
// suspenders so the pure seam degrades safely instead of producing Infinity.
// (Audit 2026-06-08 SEC1 — fuzzing found two -1e308 wages summing to -Infinity.)
const MAX_MONEY = 1e13;
// Exported so sibling modules (entityChoice, clientOrganizer, …) coerce raw DB
// values with the SAME hardened clamp instead of growing unclamped copies.
export function toNum(val: Numish): number {
  if (val == null) return 0;
  const n = Number(val);
  if (!Number.isFinite(n)) return 0; // NaN/Infinity garbage → 0
  if (n > MAX_MONEY) return MAX_MONEY;
  if (n < -MAX_MONEY) return -MAX_MONEY;
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
  /** E1 — count of EITC qualifying children (§32(c)(3): under 19, or under 24 if
   *  a full-time student, or any age if permanently disabled — a WIDER set than
   *  the CTC's under-17). When null, defaults to dependentsUnder17 (backward
   *  compatible); the CPA sets it when there are qualifying children aged 17-23. */
  eitcQualifyingChildren?: number | null;
  taxpayerAge?: number | null;
  spouseAge?: number | null;
  /** FED-05 — legally blind at year end → extra std-ded box per IRC §63(f)(2). */
  taxpayerBlind?: boolean | null;
  spouseBlind?: boolean | null;
  spouseEarnedIncome?: Numish;
  hsaIsFamilyCoverage?: boolean | null;
  iraCoveredByWorkplacePlan?: boolean | null;
  /** E4 — §219(g)(7): taxpayer NOT covered by a workplace plan but SPOUSE is.
   *  Triggers the higher MFJ/QSS IRA-deduction phase-out band. */
  iraSpouseCoveredByWorkplacePlan?: boolean | null;
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
  /** E3b — can be claimed as a dependent on another return → IRC §63(c)(5)
   *  limited standard deduction (greater of the floor or earned income + $450,
   *  capped at the regular amount). A kiddie-tax filer IS a dependent by
   *  definition, so isKiddieTaxFiler also triggers the limit. */
  claimedAsDependent?: boolean | null;
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
  /** F-5 — employer name (W-2 box c). Used ONLY to count DISTINCT employers
   *  for the Schedule 3 line 11 excess-SS credit (≥2 employers required;
   *  a single employer's over-withholding is recovered from the employer,
   *  not on the 1040 — IRS Topic 608). Unnamed W-2s count as distinct. */
  employerName?: string | null;
  wagesBox1?: Numish;
  federalTaxWithheldBox2?: Numish;
  /** W-2 Box 3 — Social Security wages. Used for Sch SE Part I Line 9 (SS
   *  wage base shared across W-2 + SE). Falls back to Box 1 when absent. */
  socialSecurityWagesBox3?: Numish;
  /** F-5 — W-2 Box 4: Social Security tax withheld. Drives the Schedule 3
   *  line 11 excess-SS refundable credit (2+ employers, total over the year's
   *  6.2% × wage-base maximum). */
  socialSecurityTaxBox4?: Numish;
  /** W-2 Box 5 — Medicare wages (no cap). Used for Form 8959 Additional
   *  Medicare tax. Falls back to Box 1 when absent. */
  medicareWagesBox5?: Numish;
  /** F-6 — W-2 Box 6: Medicare tax withheld. Form 8959 Part IV reconciles
   *  the Additional-Medicare portion (Box 6 − 1.45% × Box 5) into federal
   *  income tax withholding (1040 line 25c). */
  medicareTaxBox6?: Numish;
  stateTaxWithheldBox17?: Numish;
  stateCode?: string | null;
  /** K1 MFJ sub-gap — which spouse this W-2 belongs to. Default "taxpayer".
   *  Drives per-spouse Sch SE Line 9 SS wage base computation for MFJ (and
   *  per-spouse excess-SS Schedule 3 line 11 — F-5). */
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
  /** 1099-INT Box 3 — interest on US Savings Bonds + Treasury obligations.
   *  Federally TAXABLE (Schedule B line 1), state-exempt. Disjoint from Box 1. */
  usTreasuryInterest?: Numish;
  taxExemptInterest?: Numish;
  /** A2 — 1099-INT Box 2: penalty on early withdrawal of savings (a forfeited-
   *  interest penalty on breaking a CD early). An ABOVE-THE-LINE deduction
   *  (Schedule 1 line 18, §62(a)(9)) — distinct from the 1099-R §72(t) penalty. */
  earlyWithdrawalPenalty?: Numish;
  ordinaryDividends?: Numish;
  qualifiedDividends?: Numish;
  totalCapitalGainDistribution?: Numish;
  shortTermGainLoss?: Numish;
  longTermGainLoss?: Numish;
  taxableAmount?: Numish;
  grossDistribution?: Numish;
  /** 1099-R Box 7 distribution code — drives the E5 §72(t) early-withdrawal
   *  additional tax ("1" → 10%, "S" → 25% SIMPLE in first 2 years). */
  distributionCode?: string | null;
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
  /** E2 — which spouse this adjustment belongs to ("taxpayer" | "spouse").
   *  Used (today) for MFJ per-spouse Sch SE Line-9 attribution of a
   *  `self_employment_income` adjustment so the right spouse's W-2 SS wages
   *  credit against the SE SS base. Absent → the conservative default. */
  spouse?: string | null;
}

export interface RecalcOverrides {
  taxYear?: number;
  additionalIncome?: number;
  additionalDeductions?: number;
  useItemizedDeductions?: boolean;
  /**
   * FS-1 (T1.0h) — TRUE forced itemizing: claim the itemized total EVEN WHEN it
   * is below the standard deduction. The plain `useItemizedDeductions: true`
   * override still takes max(itemized, std) downstream, which cannot express
   * the §63(c)(6)(A) MFS coupling (when one spouse itemizes, the other's std
   * deduction is $0 — they must claim their actual Schedule A total, often ~$0).
   * Implies `useItemizedDeductions`. Used by the filing-status optimizer.
   */
  forceItemized?: boolean;
  /**
   * FS-4 (T1.0h) — force the STANDARD deduction even when the Schedule A total
   * is larger (the other legal §63(c)(6) MFS pair: both spouses take std).
   * Ignored when `forceItemized` is set. The legacy `useItemizedDeductions:
   * false` override is deliberately NOT this (it only holds when there is
   * nothing to itemize — historical contract, don't change it).
   */
  forceStandardDeduction?: boolean;
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
  /** Shares/units in this lot — enables proportional partial-wash disallowance. */
  quantity?: Numish;
  /** Brokerage account label (reporting only; detector is account-agnostic). */
  account?: string | null;
  adjustmentCode?: string | null;
  adjustmentAmount?: Numish;
  washSaleDisallowed?: Numish;
  /** E13 — TRUE when engine identified the wash sale (vs broker-reported "W"). */
  washSaleAutoDetected?: boolean | null;
  formBox?: "A" | "B" | "C" | "D" | "E" | "F" | string | null;
  /**
   * PREP-B1 — 2-letter state code for the SITUS of the underlying real/tangible
   * property. When set and the `nonresident_source_allocation` marker is on, the
   * gain (max(0, proceeds − costBasis + adjustmentAmount)) is sourced to that
   * state as non-resident income (real-property gains follow situs). Intangible
   * gains (stocks/bonds) follow the owner's domicile (4 U.S.C. §114(a)) and must
   * NOT be given a situs.
   */
  propertyStateSitus?: string | null;
  /**
   * T1.1a — Special LTCG rate character (IRC §1(h)). Only meaningful on a
   * LONG-TERM lot (formBox D/E/F). Routes this lot's gain into the Schedule D
   * Tax Worksheet's special-rate buckets instead of the default 0/15/20%:
   *   - "collectible"  → 28%-rate gain (§1(h)(4): art, metals, coins, gems…)
   *   - "section1202"  → the taxable §1202 §1(h)(7) portion (28%-rate gain)
   *   - "section1250"  → unrecaptured §1250 gain (25% max). When the whole lot
   *                      gain is depreciation recapture, leave
   *                      `unrecaptured1250Amount` unset (defaults to the gain);
   *                      when only PART is recapture and the rest is true
   *                      appreciation taxed at 0/15/20, set the §1250 portion
   *                      explicitly via `unrecaptured1250Amount`.
   * A net LTCG loss in the bucket contributes nothing (floored at 0). Bounded to
   * the return's net LTCG downstream. The proper channel for depreciated business
   * property is `form4797` (T1.1b); this is the direct-8949-entry convenience.
   */
  gainClass?: "section1250" | "collectible" | "section1202" | string | null;
  /** T1.1a — explicit unrecaptured §1250 portion of THIS lot's gain (≤ gain).
   *  Used with gainClass "section1250" for a partial-recapture lot. */
  unrecaptured1250Amount?: Numish;
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
  /**
   * T1.2 §469(g) — the property was FULLY DISPOSED in a taxable transaction to an
   * unrelated party this year. Its current-year net AND its accumulated suspended
   * passive losses (`suspendedLossCarryforward`) are then RELEASED — freely
   * deductible against ordinary income, NOT subject to the $25k §469(i) cap.
   */
  fullyDisposedThisYear?: boolean | null;
  /**
   * T1.2 — this property's accumulated suspended passive loss carried in from
   * prior years (a positive number). Released in full when fullyDisposedThisYear;
   * otherwise informational (the active-property path uses the aggregate
   * `schedule_e_passive_loss_carryforward` adjustment).
   */
  suspendedLossCarryforward?: Numish;
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
 * Modeled (session-1 K-1 depth):
 *   - §199A(b)(2)(B) W-2-wage / UBIA limit (when the K-1 supplies positive
 *     section199aW2Wages / section199aUbia; aggregate across K-1s — sub-gap)
 *   - §199A(d)(2) per-business SSTB phase-out (via isSstb)
 *   - §707(c) guaranteed payments (box4GuaranteedPayments) → AGI + SE, non-QBI
 *   - §704(d)/§1366(d) basis + §465 at-risk loss limits (via basisAtYearStart /
 *     atRiskAmount) cap the active Box 1 loss; excess suspended (carryforward)
 * Remaining simplifications:
 *   - wage/UBIA limit is aggregate, not per-business (Form 8995-A)
 *   - basis/at-risk keyed to basisAtYearStart (not reduced by distributions)
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
  /** 1065 Box 4 (§707(c)) guaranteed payments. Ordinary income to the partner
   *  (Sch E Part II); EXCLUDED from QBI per §199A(c)(4); SE-taxable for a
   *  service partner. Engine takes max(Box 14A, Box 4) for the SE base. */
  box4GuaranteedPayments?: Numish;
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
  /** §199A(d)(2) specified service trade or business — per-business SSTB
   *  phase-out applies to this K-1's QBI above the §199A income band. */
  isSstb?: boolean | null;
  basisAtYearStart?: Numish;
  basisAtYearEnd?: Numish;
  atRiskAmount?: Numish;
  /** P2-6 (b) — current-year distributions (1065 Box 19 / 1120-S Box 16D). Per
   *  §1367/§1368, distributions reduce outside basis BEFORE losses, so they
   *  shrink the basis available to absorb the Box 1 ordinary loss. */
  distributions?: Numish;
  /** P2-6 (b) — separately-stated DEDUCTIONS that also draw down basis before
   *  the Box 1 loss (e.g. §179, charitable, investment interest). Enter as a
   *  positive number; reduces the loss-absorbing basis. */
  separatelyStatedDeductions?: Numish;
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
  /**
   * P2 — Optional Schedule C asset register (Form 4562). The engine computes
   * §179 (with the §179(b)(3) business-income limit) + §168(k) bonus + MACRS and
   * folds the total into the SE-base-reducing `schedule_c_depreciation` total.
   * Inert when omitted/empty. (Migration-seam contract addition — keep PURE.)
   */
  scheduleCAssets?: ScheduleCAsset[];
  /**
   * T1.1b — Optional Form 4797 business-property dispositions (§1231/§1245/§1250).
   * Net §1231 gain → Schedule D (LTCG + 25%/28% character); net §1231 loss +
   * depreciation recapture → ordinary income. Inert when omitted/empty.
   * (Migration-seam contract addition — keep PURE.)
   */
  form4797?: BusinessPropertySaleFact[];
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
  /** Taxable interest (1099-INT Box 1 + Box 3 Treasury — Form 1040 line 2b) */
  interestIncome: number;
  /** Tax-exempt interest (1099-INT Box 8 — excluded from AGI; used for K10
   *  Pub 915 SS taxability provisional-income calc). */
  taxExemptInterest: number;
  /** US Savings Bond / Treasury interest (1099-INT Box 3) — a SUBSET already
   *  included in `interestIncome` (federally taxable). Surfaced separately so
   *  the state-tax base can subtract it (state-exempt by federal preemption). */
  usTreasuryInterest: number;
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
  /** F-10 — taxable 1099-R amounts whose Box 7 carries distribution code "D"
   *  (non-qualified annuity, e.g. "D", "7D", "1D"). §1411(c)(1)(A)(i) puts
   *  gross income from annuities OTHER than §401/§403/§408 qualified plans in
   *  the NIIT base; the Form 8960 instructions + Pub 575 say: "if code 'D' is
   *  shown in box 7 of Form 1099-R, include on Form 8960, line 3, the taxable
   *  amount". A SUBSET of retirementIncome (all other 1099-R income stays out
   *  of NII as §1411(c)(5) qualified-plan distributions). */
  nonQualifiedAnnuityIncome: number;
  /** E5 — IRC §72(t) early-withdrawal penalty (10% on code "1", 25% on code "S"). Added to total federal liability on Sched 2 Line 8. */
  earlyWithdrawalPenalty: number;
  /** A2 — 1099-INT Box 2 penalty on early withdrawal of SAVINGS (forfeited CD
   *  interest). An ABOVE-THE-LINE DEDUCTION (Schedule 1 line 18, §62(a)(9)) —
   *  the OPPOSITE of the §72(t) penalty above. Reduces AGI. */
  interestEarlyWithdrawalPenalty: number;
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
  // Match the form code case-INSENSITIVELY. The manual-create path stores
  // lowercase ("int"), but the AI document-approve path's ApproveExtractionBody
  // enum is UPPERCASE ("INT"); a strict `=== "int"` silently dropped every
  // AI-approved 1099 (all its income vanished from the return). Normalizing on
  // read fixes any already-stored uppercase rows too. (Audit 2026-06-08 F1.)
  const ft = (r: Form1099Fact) => (r.formType ?? "").toLowerCase();
  const necRecords = records.filter((r) => ft(r) === "nec");
  const miscRecords = records.filter((r) => ft(r) === "misc");
  const intRecords = records.filter((r) => ft(r) === "int");
  const divRecords = records.filter((r) => ft(r) === "div");
  const bRecords = records.filter((r) => ft(r) === "b");
  const rRecords = records.filter((r) => ft(r) === "r");
  const gRecords = records.filter((r) => ft(r) === "g");
  const kRecords = records.filter((r) => ft(r) === "k");

  const seIncome = necRecords.reduce((s, r) => s + toNum(r.nonemployeeCompensation), 0);

  // Taxable interest = 1099-INT Box 1 + Box 3 (US Savings Bond / Treasury
  // obligation interest — federally TAXABLE, reported on Sch B line 1; only
  // state-exempt). Box 8 (tax-exempt interest) is a DISJOINT box on the form
  // and is summed separately below for the Pub 915 SS provisional-income calc
  // — it must NOT be netted out of Box 1 (doing so silently understated taxable
  // interest on every brokerage 1099-INT carrying muni interest).
  const interestIncome = intRecords.reduce(
    (s, r) => s + Math.max(0, toNum(r.interestIncome)) + Math.max(0, toNum(r.usTreasuryInterest)),
    0,
  );
  // A2 — 1099-INT Box 2 early-withdrawal-of-savings penalty → above-the-line
  // deduction (§62(a)(9)). Only on 1099-INT (the 1099-R field carries the
  // separate §72(t) additional tax).
  const interestEarlyWithdrawalPenalty = intRecords.reduce(
    (s, r) => s + Math.max(0, toNum(r.earlyWithdrawalPenalty)), 0);
  // Tax-exempt interest (1099-INT Box 8) — excluded from AGI but informs the
  // Pub 915 SS taxability provisional-income calculation (K10).
  const taxExemptInterest = intRecords.reduce(
    (s, r) => s + toNum(r.taxExemptInterest), 0);
  // 1099-INT Box 3 (US Savings Bond / Treasury) — federally taxable (already in
  // interestIncome above) but state-exempt; surfaced for the state subtraction.
  const usTreasuryInterest = intRecords.reduce(
    (s, r) => s + Math.max(0, toNum(r.usTreasuryInterest)), 0);

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
  // F-10 — non-qualified annuity income (1099-R Box 7 code "D", alone or as
  // the second character of a combo like "7D"/"1D"). The ONLY 1099-R income
  // routed into the §1411 NII base (Form 8960 line 3); qualified-plan
  // distributions stay excluded under §1411(c)(5). Per the Form 8960
  // instructions / Pub 575: code D identifies "annuity payments from
  // nonqualified annuities that may be subject to tax under section 1411."
  const nonQualifiedAnnuityIncome = rRecords.reduce((s, r) => {
    const code = (r.distributionCode ?? "").trim().toUpperCase();
    if (!code.includes("D")) return s;
    return s + Math.max(0, toNum(r.taxableAmount ?? r.grossDistribution));
  }, 0);

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
    const code = (r.distributionCode ?? "").trim();
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
    // Box 1 + Box 3 (Treasury) = taxable interest; Box 8 is DISJOINT tax-exempt
    // (tracked separately, shown on the workpaper as a note — must NOT net out
    // of Box 1). Matches the taxable-interest total + @workspace/validation.
    p.interestIncome += Math.max(0, toNum(r.interestIncome)) + Math.max(0, toNum(r.usTreasuryInterest));
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
    usTreasuryInterest,
    ordinaryDividends,
    qualifiedDividends,
    longTermCapitalGains,
    shortTermCapitalGains,
    retirementIncome,
    nonQualifiedAnnuityIncome,
    earlyWithdrawalPenalty,
    interestEarlyWithdrawalPenalty,
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
  /** 1065 Box 4 §707(c) guaranteed payments — ordinary income, non-QBI. */
  totalGuaranteedPayments: number;
  totalPassiveBucketNetApplied: number;
  k1PassiveLossSuspended: number;
  /** §704(d)/§1366(d) basis + §465 at-risk loss disallowed this year (carryforward). */
  k1BasisAtRiskLossSuspended: number;
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
  /** FED-04 / P2-4 — Form 8995-A per-business §199A wage/UBIA limit detail.
   *  null when there is no QBI. One entry per qualified business (Sch C + each
   *  K-1), each limited independently then summed. */
  qbiPerBusiness: PerBusinessQbiLimit[] | null;
  taxableIncome: number;
  /** T2.1 — OBBBA Schedule 1-A deduction detail (tips §224 / overtime §225 /
   *  car-loan §163(h)(4) / senior §151(d)). Subtracted from taxable income
   *  (Form 1040 line 13b), NOT from AGI. All-zero outside TY2025–2028 or when
   *  none claimed. Exposed so the workpaper packet can render Schedule 1-A
   *  and the reconciliation worksheet can tie the taxable-income chain. */
  obbbaSchedule1A: ObbbaSchedule1ADeductions;
  federalTaxLiability: number;
  federalTaxWithheld: number;
  federalRefundOrOwed: number;
  /** Pre-additional-credit state tax (multiState.totalStateTax). The state
   *  refund nets the additional-credit package below off this first. */
  stateTaxLiability: number;
  stateTaxWithheld: number;
  stateRefundOrOwed: number;
  /** T2.1 — state additional-credit package (the 31-credit state set, e.g. MA
   *  Circuit Breaker / NJ property tax / OH JFC): nonrefundable portion
   *  reduces state tax (floored at 0); refundable portion adds to the state
   *  refund. Exposed so the workpaper reconciliation ties to the cent. */
  stateAdditionalCreditsNonRefundable: number;
  stateAdditionalCreditsRefundable: number;
  /** T2.1 — refundable state child tax credit (CA YCTC / CO / NJ / IL / NM / VT). */
  stateChildTaxCredit: number;
  /** T2.1 — NYC EITC in excess of NYC tax, refunded via the state refund. */
  nycEitcRefundableExcess: number;
  /** T1.1c — state individual health-coverage mandate (shared-responsibility)
   *  penalty (CA/NJ/RI/DC/MA). 0 for non-mandate states or full coverage.
   *  Raises the amount owed (reduces stateRefundOrOwed) and the effective rate. */
  stateIndividualMandatePenalty: number;
  /** T1.1c — full mandate-penalty breakdown (method, flat/percentage/cap). */
  stateMandate: StateMandateResult;
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
  /** F-6 — Form 8959 Part IV (lines 19–24): Additional-Medicare-Tax
   *  WITHHOLDING = max(0, total W-2 Box 6 − 1.45% × total Box 5). Included in
   *  federal income tax withholding (1040 line 25c) — a PAYMENT, already
   *  folded into `federalTaxWithheld` + `federalRefundOrOwed`. */
  additionalMedicareWithholding: number;
  /** F-5 — Excess Social Security withholding credit (1040 Schedule 3
   *  line 11): per-person (taxpayer/spouse) W-2 Box 4 over the year's 6.2% ×
   *  wage-base maximum, when that person had 2+ employers. A REFUNDABLE
   *  payment-side credit — added into `federalRefundOrOwed`, NOT a liability
   *  offset. */
  excessSocialSecurityCredit: number;
  /** T1.2 — Schedule H household employment tax (FICA + FUTA on a nanny /
   *  household employee's cash wages). Schedule 2 line 9. 0 when none. */
  scheduleH: ScheduleHResult;
  /** AMT delta — additional tax beyond regular tax. Often $0. */
  amtTax: number;
  /** Refundable portion of CTC (Additional Child Tax Credit) */
  additionalChildTaxCredit: number;
  /** Federal tax owed on long-term capital gains + qualified dividends (preferential rate) */
  capitalGainsTax: number;
  /** Long-term capital gains + qualified dividends (preferential-rate income),
   *  net of any §163(d)(4)(B) elected amount re-bucketed to ordinary rates. */
  preferentialIncome: number;
  /** §163(d) investment interest deduction allowed this year (Schedule A,
   *  Form 4952) — capped at net investment income (+ any elected amount). */
  investmentInterestDeduction: number;
  /** §163(d)(2) investment interest disallowed → carries forward indefinitely. */
  investmentInterestDisallowed: number;
  /** §163(d)(4)(B) QDIV/LTCG amount elected as ordinary investment income. */
  investmentInterestElectionAmount: number;
  /** T1.1a — unrecaptured §1250 gain taxed at the 25% maximum rate (Schedule D
   *  line 19; a subset of preferentialIncome). 0 when none. */
  unrecapturedSection1250Gain: number;
  /** T1.1a — 28%-rate gain: collectibles + taxable §1202 (Schedule D line 18;
   *  a subset of preferentialIncome). 0 when none. */
  collectibles28RateGain: number;
  /** T1.1b — Form 4797 (Sales of Business Property) breakdown, or null when no
   *  business-property dispositions were supplied. */
  form4797: Form4797Result | null;
  /** Summary of all 1099 records included in this return */
  form1099Summary: Form1099Summary;
  // ── Phase 1 line items ─────────────────────────────────────────────────
  scheduleA: ScheduleACalculation;
  scheduleCExpenses: number;
  /** T2.2 — SIGNED Schedule C net profit (gross SE income − expenses −
   *  depreciation incl. the asset register; before the SE floor). THE seam for
   *  consumers that need "the business's bottom line" (entity-choice) — when
   *  the engine's Sch C composition evolves, this evolves with it. */
  netScheduleCProfit: number;
  /** P2 — Schedule C depreciation reducing the SE base = the manual
   *  `schedule_c_depreciation` adjustment + the asset-register calculator total. */
  scheduleCDepreciation: number;
  /** P2 — breakdown of the Schedule C asset-register depreciation (Form 4562:
   *  §179 + bonus + MACRS), or null when no `scheduleCAssets` were supplied. */
  scheduleCAssetDepreciation: ScheduleCAssetDepreciationResult | null;
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
  /** FC-11 — §25D residential clean energy credit APPLIED this year (after
   *  the CTC in credit ordering, per the Form 5695 credit-limit worksheet;
   *  includes any prior-year §25D(c) carryforward consumed). */
  residentialCleanEnergyApplied: number;
  /** FC-11 — unused §25D credit carried to next year under §25D(c)
   *  (current-year credit + carryforward-in − applied). Auto-seeded next year
   *  as the `residential_clean_energy_carryforward` adjustment. */
  residentialCleanEnergyCarryforward: number;
  premiumTaxCredit: PremiumTaxCreditCalculation;
  /** P2-13 — Adoption Credit (Form 8839, IRC §23): nonrefundable + OBBBA
   *  refundable split, MAGI phase-out, and the §23(c) 5-year carryforward. */
  adoptionCredit: AdoptionCreditCalculation;
  /** P2-13 — unused nonrefundable §23 adoption credit carried to next year. */
  adoptionCreditCarryforwardRemaining: number;
  /** P2-15c — R&D Credit (Form 6765 / §41) ASC computation. */
  rdCredit: RdCreditCalculation;
  /** P2-15c — §41 credit applied this year (after the §38 GBC liability limit). */
  rdCreditApplied: number;
  /** P2-15c — §41 credit carried forward (§39) — disallowed by the §38 limit. */
  rdCreditCarryforwardRemaining: number;
  /** P2 — §51 WOTC + §45S FMLA general business credits applied (CPA-supplied,
   *  under the §38 limit, after §41). */
  otherGeneralBusinessCreditApplied: number;
  /** P2 — §51/§45S GBC carried forward (§39) — disallowed by the §38 limit. */
  otherGeneralBusinessCreditCarryforward: number;
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
  /** ATNOLD (§56(d)) applied against AMTI this year (capped at 90% of AMTI). */
  amtNolDeduction: number;
  /** ATNOLD AMT-basis NOL carryforward remaining for next tax year. */
  amtNolCarryforwardRemaining: number;
  /** E2 — Form 8801 minimum-tax credit applied against regular tax this year. */
  amtCreditApplied: number;
  /** E2/F-3 — Form 8801 minimum-tax credit generated by this year's AMT.
   *  §53(d) "adjusted net minimum tax" = AMT minus the net minimum tax on
   *  EXCLUSION items (Form 8801 Part I recompute) — only the deferral-item
   *  AMT (ISO bargain, depreciation timing, ATNOLD) generates credit. */
  amtCreditGenerated: number;
  /** F-3 — Form 8801 Part I detail behind amtCreditGenerated (exclusion-only
   *  AMTI / TMT / net minimum tax on exclusion items). Null when no AMT. */
  form8801Generation: Form8801GenerationResult | null;
  /** E2 — Form 8801 unused minimum-tax credit carried forward to next year. */
  amtCreditCarryforwardRemaining: number;
  /** P2-3 — Form 1116 Schedule B / §904(c) unused foreign tax credit carried
   *  forward to next year (combined current + prior in excess of the §904 limit).
   *  10-year forward life; vintage not tracked. */
  foreignTaxCreditCarryforwardRemaining: number;
  /** FORM-02 — total non-refundable credits applied against income tax this
   *  year (CTC-nonref + FTC + dependent-care + AOC-nonref + LLC + savers +
   *  residential energy + AMT credit). federalTaxLiability is PRE-credit, so
   *  Form 1040-X Lines 8/10/16 subtract this to get tax net of credits. */
  totalNonRefundableApplied: number;
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
  /** §163(j)(3) small-business exemption — TRUE when 3-yr avg gross receipts ≤ §448(c) threshold. */
  section163jSmallBusinessExempt: boolean;
  /** §448(c) 3-prior-year average gross receipts entered by CPA (0 = not provided). */
  section163jGrossReceipts: number;
  /** §448(c) gross-receipts threshold for the tax year ($30M 2024 / $31M 2025 / $32M 2026). */
  section163jGrossReceiptsThreshold: number;
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
  /** P2-1 — Form 8582 per-activity worksheet: per-property net + ratably-
   *  allocated allowed/suspended loss. null when no per-property rows. */
  form8582: Form8582Breakdown | null;
  /** Schedule E passive loss suspended to next year */
  scheduleEPassiveLossSuspended: number;
  /** T1.2 §469(g) — suspended passive loss RELEASED this year by a fully-taxable
   *  disposition of a rental property (freely deductible, no $25k cap). 0 when none. */
  section469gReleasedLoss: number;
  /** Schedule K-1 (partnership + S-corp) aggregate summary */
  scheduleK1: ScheduleK1Summary;
  /** Local-jurisdiction income tax (NYC PIT + flat localities + NYC UBT). Zero when none. */
  localTaxLiability: number;
  /** The local jurisdiction this tax was computed for ("NYC", etc.). Null when none. */
  localTaxJurisdiction: string | null;
  /** #7 — NYC Unincorporated Business Tax (4% on NYC business income, after the
   *  services allowance, $5k exemption, and sliding Business Tax Credit). */
  nycUbt: number;
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
//  3. When replacement(s) are found:
//       - PARTIAL WASH: when the loss row and its replacement(s) supply share
//         `quantity`, disallowed = |loss| × min(replShares, soldShares)/soldShares
//         (capped at 100%). Replacement capacity is consumed greedily so one
//         rebuy isn't double-counted across multiple losses. When no quantity is
//         supplied, the loss is fully disallowed (legacy).
//       - S.adjustmentAmount += disallowedAmount  (loss reversed on Form 8949)
//       - S.washSaleAutoDetected = true
//       - replacement.costBasis += disallowedAmount (§1091(d) basis add, split
//         across consumed replacements proportional to shares)
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
//   - Cross-account wash IS handled (the detector is account-agnostic, matching
//     by security across all rows) — but both brokers' transactions must be
//     entered, since the engine can't see a buy it wasn't given.
//   - Partial-wash consumption matches a loss against multiple in-window
//     replacements, but does not re-flow a partially-used replacement's
//     leftover shares to a LATER-dated loss processed earlier in the array
//     (rows are processed in input order, earliest-replacement-first within
//     each loss). Adequate for typical broker-ordered data.

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

  // Remaining replacement capacity per row, for proportional partial-wash
  // consumption. A row with a positive `quantity` can absorb only that many
  // washed shares total (across ALL loss sales); a row without a quantity has
  // unlimited capacity (legacy full-wash). The detector is account-agnostic —
  // it never keys on `account`, so cross-account washes (broker A sells, broker
  // B buys the same security) are matched whenever both rows are present.
  const remainingReplQty: number[] = rows.map((r) => {
    const q = toNum(r.quantity);
    return q > 0 ? q : Number.POSITIVE_INFINITY;
  });

  // §1091(d)/§1223(3) holding-period tack: flip a replacement's formBox ST→LT
  // when its own holding + the washed lot's holding crosses one year and the
  // replacement is itself sold this year.
  const ST_TO_LT: Record<string, "D" | "E" | "F"> = { A: "D", B: "E", C: "F" };
  const applyHoldingTack = (
    repl: CapitalTransactionFact, washedAcqMs: number, washedSoldMs: number,
  ): void => {
    const replAcq = parseISO(repl.dateAcquired ?? null);
    const replSold = parseISO(repl.dateSold ?? null);
    const fb = (repl.formBox ?? "").toUpperCase();
    if (!replAcq || !replSold || !(fb in ST_TO_LT)) return;
    const tackedDays =
      (replSold.getTime() - replAcq.getTime() + washedSoldMs - washedAcqMs) / ONE_DAY_MS;
    if (tackedDays > 365) repl.formBox = ST_TO_LT[fb];
  };

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

    // Gather in-window replacement purchases, earliest dateAcquired first.
    const windowStart = sSold.getTime() - 30 * ONE_DAY_MS;
    const windowEnd = sSold.getTime() + 30 * ONE_DAY_MS;
    const sAcq = parseISO(s.dateAcquired ?? null);
    const sAcqMs = sAcq ? sAcq.getTime() : null;
    const inWindow: { idx: number; acqMs: number }[] = [];
    for (const j of candidates) {
      if (j === i) continue;
      const tAcq = parseISO(rows[j].dateAcquired ?? null);
      if (!tAcq) continue;
      const acqMs = tAcq.getTime();
      if (acqMs < windowStart || acqMs > windowEnd) continue;
      // Skip same-day-acquired rows — usually tax-lot splits of one economic
      // purchase, not a replacement buy. CPAs handle the rare real case via "W".
      if (sAcqMs != null && acqMs === sAcqMs) continue;
      inWindow.push({ idx: j, acqMs });
    }
    if (inWindow.length === 0) continue;
    inWindow.sort((a, b) => a.acqMs - b.acqMs);

    const loss = -txnGainLossRaw(s); // positive total loss
    const soldQty = toNum(s.quantity);
    const proportional = soldQty > 0;
    let disallowed = 0;
    const used: { idx: number; consumed: number }[] = [];

    if (proportional) {
      // Partial wash (§1091): disallow loss × (replacement shares acquired in
      // window) / (shares sold), capped at 100%. Consume replacement capacity
      // greedily (earliest first) so one rebuy isn't counted against two losses.
      let remainingToCover = soldQty;
      for (const cand of inWindow) {
        if (remainingToCover <= 0) break;
        const avail = remainingReplQty[cand.idx];
        if (!(avail > 0)) continue;
        const consume = Math.min(remainingToCover, avail);
        remainingReplQty[cand.idx] -= consume;
        remainingToCover -= consume;
        used.push({ idx: cand.idx, consumed: consume });
      }
      const totalConsumed = soldQty - remainingToCover;
      if (totalConsumed <= 0) continue; // replacements exhausted → no wash
      disallowed = loss * Math.min(1, totalConsumed / soldQty);
    } else {
      // Legacy (no quantity): first replacement, FULL disallowance, no consumption.
      disallowed = loss;
      used.push({ idx: inWindow[0].idx, consumed: 0 });
    }
    if (disallowed <= 0) continue;

    // 1) Reverse the (possibly partial) disallowed loss on Form 8949 column g.
    s.adjustmentAmount = toNum(s.adjustmentAmount) + disallowed;
    s.washSaleDisallowed = toNum(s.washSaleDisallowed) + disallowed;
    const code = (s.adjustmentCode ?? "").toUpperCase();
    if (!code.includes("W")) s.adjustmentCode = code.length > 0 ? code + "W" : "W";
    s.washSaleAutoDetected = true;

    // 2) §1091(d) basis add, distributed across the consumed replacements
    //    (proportional to consumed shares; legacy = all to the one replacement).
    //    3) holding-period tack applied to each.
    const consumedTotal = used.reduce((sum, u) => sum + u.consumed, 0);
    for (const u of used) {
      const repl = rows[u.idx];
      const share = proportional && consumedTotal > 0 ? u.consumed / consumedTotal : 1;
      repl.costBasis = toNum(repl.costBasis) + disallowed * share;
      if (sAcq) applyHoldingTack(repl, sAcq.getTime(), sSold.getTime());
    }

    detected += 1;
    totalDisallowed += disallowed;
  }

  return {
    adjustedTransactions: rows,
    washSalesDetected: detected,
    washSaleLossDisallowed: totalDisallowed,
  };
}

// ── Pure engine ─────────────────────────────────────────────────────────────

// Year-indexed structural limits used inside computeTaxReturnPure. Hoisted to
// module scope (were declared inline, rebuilt on every engine call) and typed
// `Record<TaxYear, …>` (were `Record<number, …>`) so a missing supported-year
// entry is a TYPE ERROR, not a silent runtime `undefined`. All four are indexed
// via resolveTaxYear(taxYear) → a supported TaxYear, so every key is present.

// §179 expensing cap + phase-out start.
//   - §179 cap TY2024: $1,220,000 (Rev. Proc. 2023-34 §3.27); phase-out $-for-$
//     above $3,050,000 of qualified property. (Corrected 2026-06-06i — the prior
//     $1,160,000 / $2,890,000 were the stale TY2023 figures.)
//   - OBBBA (P.L. 119-21 §70306) raised §179 to $2.5M cap / $4M phase-out for
//     property placed in service in TY beginning after 2024-12-31 (TY2025+),
//     then inflation-indexed: TY2026 $2.56M / $4.09M (Rev. Proc. 2025-32).
export const SECTION_179_CAPS: Record<TaxYear, { cap: number; phaseStart: number }> = {
  2024: { cap: 1220000, phaseStart: 3050000 },
  2025: { cap: 2500000, phaseStart: 4000000 },
  2026: { cap: 2560000, phaseStart: 4090000 },
};
// Bonus depreciation rate × cost basis (no income limit). OBBBA (§70301)
// restored 100% bonus depreciation PERMANENTLY for property acquired AND placed
// in service after 2025-01-19. TY2026 is 100%. TY2025 is dual-rate by
// acquisition date: 40% (TCJA phase-down) for property acquired on/before
// 2025-01-19, 100% after — the engine has no acquisition-date field, so TY2025
// keeps the conservative 40% default (CPA overrides for post-1/19 property);
// documented limitation.
const BONUS_DEPR_RATES: Record<TaxYear, number> = {
  2024: 0.60,
  2025: 0.40,
  2026: 1.00,
};
// §168(k) bonus rate by ACQUISITION (placed-in-service) calendar year — broader
// than BONUS_DEPR_RATES (which is Record<TaxYear>, supported years only) because
// the Schedule C asset calculator must reconstruct the bonus taken on PRIOR-year
// assets to derive their remaining MACRS basis. TCJA phase-down: 50% (2015-2017,
// PATH Act) → 100% (2018-2022) → 80% (2023) → 60% (2024) → 40% (2025 TCJA; OBBBA
// restored 100% for post-1/19/2025 but the engine keeps the conservative 40%
// default, matching BONUS_DEPR_RATES) → 100% (2026+, OBBBA §70301 permanent).
// Years outside this range default to 0 in the calculator (a pre-2015 asset is
// fully depreciated for the common 3/5/7-yr classes; enter remaining basis if not).
const BONUS_RATE_BY_ACQUISITION_YEAR: Readonly<Record<number, number>> = {
  2015: 0.5, 2016: 0.5, 2017: 0.5,
  2018: 1.0, 2019: 1.0, 2020: 1.0, 2021: 1.0, 2022: 1.0,
  2023: 0.8, 2024: 0.6, 2025: 0.4,
  2026: 1.0, 2027: 1.0, 2028: 1.0, 2029: 1.0, 2030: 1.0,
};
// §461(l)(3)(B) excess-business-loss threshold, inflation-indexed: TY2024
// $305k/$610k; TY2025 $313k/$626k (Rev. Proc. 2024-40). TY2026 not yet
// published — held at TY2025.
const SECTION_461L_THRESHOLDS: Record<TaxYear, Record<string, number>> = {
  2024: { single: 305_000, head_of_household: 305_000, married_filing_separately: 305_000, qualifying_widow: 610_000, married_filing_jointly: 610_000 },
  2025: { single: 313_000, head_of_household: 313_000, married_filing_separately: 313_000, qualifying_widow: 626_000, married_filing_jointly: 626_000 },
  2026: { single: 313_000, head_of_household: 313_000, married_filing_separately: 313_000, qualifying_widow: 626_000, married_filing_jointly: 626_000 },
};
// §448(c) gross-receipts small-business threshold for the §163(j) exemption
// (Rev. Proc. 2023-34 / 2024-40 / 2025-32): TY2024 $30M · TY2025 $31M · TY2026 $32M.
const SECTION_448C_THRESHOLD: Record<TaxYear, number> = {
  2024: 30_000_000, 2025: 31_000_000, 2026: 32_000_000,
};

/**
 * Pure compute — no DB, no I/O. Inputs in, ComputedTaxReturn out.
 *
 * The DB-backed adapter (`computeTaxReturn` in taxReturnPipeline.ts) calls
 * this. Haven calls this directly with its own data layer.
 *
 * IMPORTANT: Critical invariants preserved here (see CLAUDE.md):
 *   1. AGI = Form 1040 Line 9 (includes LTCG + QDIV + STCG)
 *   2. Credits apply in IRS Schedule-8812-worksheet order: the Schedule-3
 *      personal credits FIRST (Foreign tax → Dep care → Education → Saver's →
 *      Energy → Adoption), THEN the CTC (its limit = tax after those; unused
 *      nonrefundable portion spills to the refundable ACTC), then §53 / §38. (C1)
 *   3. IRA / SLI MAGI bootstrap (per Pub 590-A / Pub 970)
 *   4. State tax computed before Oregon fed-tax subtraction (recomputed for OR)
 *   5. Dep care MFJ taxpayer earned income = household − spouseEarnedIncome
 */
export function computeTaxReturnPure(inputs: TaxReturnInputs): ComputedTaxReturn {
  const { client, w2s, form1099s, adjustments, taxYear, overrides = {} } = inputs;
  // Year used to index §179/bonus/§461(l)/§448(c) maps below. Clamp to the
  // supported range (resolveTaxYear: <2024→2024, >LATEST→latest) so these maps
  // resolve IDENTICALLY to every other year-indexed value in the engine. Multi-
  // year planning projects taxYear past LATEST_YEAR (e.g. a 5-year Roth ladder),
  // and out-of-range years previously fell back to ad-hoc, mutually inconsistent
  // defaults (§179→2024, §461(l)→2025, §448(c)→2024) — a drift hazard the engine
  // was burned by twice. Do NOT reassign the RAW `taxYear`: the OBBBA Schedule
  // 1-A window + QBI $400-floor gates intentionally test the raw year.
  const resolvedMapYear = resolveTaxYear(taxYear);
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

  // F-5 (audit 2026-06-11) — Excess Social Security withholding credit
  // (1040 Schedule 3 line 11). When ONE PERSON had TWO OR MORE employers and
  // their combined W-2 Box 4 exceeds the year's maximum (6.2% × the SS wage
  // base: $10,453.20 TY2024 / $10,918.20 TY2025 / $11,439.00 TY2026), the
  // excess is a REFUNDABLE payment-side credit. Per the Schedule 3 line 11
  // instructions + IRS Topic 608 + Pub 505: the credit requires 2+ employers
  // for that person — if any single employer over-withheld, the employee
  // recovers it from the employer (Form 843 if refused), NOT on the 1040.
  // MFJ: each spouse's own employers/Box 4 are figured SEPARATELY (Pub 505) —
  // we group by the W-2 `spouse` tag (default "taxpayer").
  // Employer count = distinct employerName values; unnamed W-2s each count as
  // a distinct employer (two W-2 records are overwhelmingly two employers;
  // duplicate same-employer W-2s carry the same name and collapse to one).
  const ssMaxWithholding = 0.062 * SS_WAGE_BASE[resolvedMapYear];
  const excessSsForPerson = (records: W2Fact[]): number => {
    if (records.length < 2) return 0;
    const named = new Set<string>();
    let unnamed = 0;
    for (const r of records) {
      const name = (r.employerName ?? "").trim().toLowerCase();
      if (name) named.add(name);
      else unnamed += 1;
    }
    if (named.size + unnamed < 2) return 0;
    const totalBox4 = records.reduce((s, r) => s + Math.max(0, toNum(r.socialSecurityTaxBox4)), 0);
    return Math.max(0, totalBox4 - ssMaxWithholding);
  };
  const excessSocialSecurityCredit =
    excessSsForPerson(w2Records.filter((r) => (r.spouse ?? "taxpayer") === "taxpayer")) +
    excessSsForPerson(w2Records.filter((r) => r.spouse === "spouse"));

  // F-6 (audit 2026-06-11) — Form 8959 Part IV withholding reconciliation.
  // Employers MUST withhold the 0.9% Additional Medicare Tax on wages over
  // $200,000 (per employer); that withholding rides inside W-2 Box 6 (Medicare
  // tax withheld), NOT Box 2. Form 8959 Part IV: line 19 = total Box 6 across
  // W-2s; line 20 = total Box 5; line 21 = line 20 × 1.45%; line 22 = line 19
  // − line 21 = "Additional Medicare Tax withholding"; line 24 → "include this
  // amount with federal income tax withholding on Form 1040, line 25c"
  // (Instructions for Form 8959). Computed on the AGGREGATE per the form (not
  // per-W-2). Only W-2s that actually carry a Box 6 value join the
  // reconciliation — a record with Box 6 missing (data not entered) must not
  // erode another employer's excess via its 1.45% × Box 5 term.
  const w2sWithBox6 = w2Records.filter((r) => r.medicareTaxBox6 != null);
  const totalMedicareTaxBox6 = w2sWithBox6.reduce((s, r) => s + Math.max(0, toNum(r.medicareTaxBox6)), 0);
  const totalMedicareWagesForPartIV = w2sWithBox6.reduce(
    (s, r) => s + (r.medicareWagesBox5 != null ? toNum(r.medicareWagesBox5) : toNum(r.wagesBox1)),
    0,
  );
  const additionalMedicareWithholding = Math.max(
    0,
    totalMedicareTaxBox6 - 0.0145 * Math.max(0, totalMedicareWagesForPartIV),
  );

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
  // T1.1a — per-transaction special LTCG rate amounts (§1(h)): unrecaptured
  // §1250 (25% bucket) and 28%-rate gain (collectibles + §1202). Accumulated
  // GROSS here from tagged long-term lots; bounded to the return's net LTCG at
  // the federal-tax computation. Combined there with the aggregate adjustments
  // and the Form 4797 output (T1.1b).
  let capTxnUnrecaptured1250 = 0;
  let capTxnCollectibles28 = 0;
  let form1099Summary: Form1099Summary;
  if (capTxnsForYear.length > 0) {
    const cgDistributions = form1099Records
      .filter((r) => (r.formType ?? "").toLowerCase() === "div")
      .reduce((s, r) => s + toNum(r.totalCapitalGainDistribution), 0);
    const txnGainLoss = (t: CapitalTransactionFact) =>
      toNum(t.proceeds) - toNum(t.costBasis) + toNum(t.adjustmentAmount);
    const stTransactions = capTxnsForYear.filter((t) =>
      ["A", "B", "C"].includes((t.formBox ?? "A").toUpperCase()),
    );
    const ltTransactions = capTxnsForYear.filter((t) =>
      ["D", "E", "F"].includes((t.formBox ?? "").toUpperCase()),
    );
    for (const t of ltTransactions) {
      const gain = txnGainLoss(t);
      if (gain <= 0) continue; // only a net-gain lot contributes to a special bucket
      const cls = (t.gainClass ?? "").toLowerCase();
      if (cls === "section1250") {
        const explicit = toNum(t.unrecaptured1250Amount);
        capTxnUnrecaptured1250 += explicit > 0 ? Math.min(explicit, gain) : gain;
      } else if (cls === "collectible" || cls === "section1202") {
        capTxnCollectibles28 += gain;
      }
    }
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
  //   - §179 cap TY2024: $1,220,000 (Rev. Proc. 2023-34)
  //   - §179 phase-out: dollar-for-dollar above $3,050,000 of qualified property
  //   - §179 income limit: can't exceed net business income (no NOL via §179)
  //   - Bonus depreciation: 60% × cost basis TY2024, 40% TY2025 (no income limit)
  // CPA enters the elected §179 amount and the cost basis of bonus-eligible
  // property; engine computes the actual deduction.
  const section179ElectedAdj = sumByType("section_179_expense_election");
  const bonusDeprBasisAdj = sumByType("bonus_depreciation_basis");
  // P2-6 (c) — TY2025 bonus-depreciation DUAL RATE by acquisition date. OBBBA
  // (§70301) restored 100% bonus for property acquired AND placed in service
  // AFTER 2025-01-19; property acquired on/before that date keeps the TCJA 40%
  // phase-down. The engine has no acquisition-date field on the aggregate
  // `bonus_depreciation_basis` (year-default rate), so the CPA enters the cost
  // basis of POST-1/19/2025 property via `bonus_depreciation_basis_obbba`,
  // which gets 100% in TY2025+ (and the year rate in earlier years as a
  // defensive fallback — pre-OBBBA years had no 100% option).
  const bonusDeprBasisObbbaAdj = sumByType("bonus_depreciation_basis_obbba");
  // SECTION_179_CAPS / BONUS_DEPR_RATES are module-scope (typed Record<TaxYear>).
  const s179Cfg = SECTION_179_CAPS[resolvedMapYear];
  // Phase-out: §179 limit reduced $-for-$ when total qualified property
  // purchases (approximated as §179 elected + bonus depr basis) exceed
  // the phase-out threshold.
  const totalQualifiedPropertyApprox = section179ElectedAdj + bonusDeprBasisAdj + bonusDeprBasisObbbaAdj;
  const s179PhaseOut = Math.max(0, totalQualifiedPropertyApprox - s179Cfg.phaseStart);
  const s179EffectiveCap = Math.max(0, s179Cfg.cap - s179PhaseOut);
  // §179 applied = min(elected, cap, net business income) — income limit
  // applied later when we have net SE earnings; for now use the cap.
  const section179Preliminary = Math.min(section179ElectedAdj, s179EffectiveCap);
  // Bonus depreciation: % × basis. No income limit. P2-6 (c): the OBBBA
  // post-1/19/2025 basis gets 100% in TY2025+ (the year-default rate otherwise).
  const obbbaBonusRate = resolvedMapYear >= 2025 ? 1.0 : BONUS_DEPR_RATES[resolvedMapYear];
  const bonusDepreciationApplied =
    bonusDeprBasisAdj * BONUS_DEPR_RATES[resolvedMapYear] +
    bonusDeprBasisObbbaAdj * obbbaBonusRate;

  // Income / SE / investment / QBI / AMT
  const seIncomeFromAdj = sumByType("self_employment_income");
  // E2 — split the SE-income adjustment by the optional `spouse` tag so MFJ
  // per-spouse Sch SE can credit the right spouse's W-2 SS wages. Untagged →
  // taxpayer (the spouse-tagged subset is carved out).
  const seIncomeFromAdjSpouse = applied
    .filter((a) => a.adjustmentType === "self_employment_income" && a.spouse === "spouse")
    .reduce((s, a) => s + toNum(a.amount), 0);
  const seAdjHasSpouseTag = applied.some(
    (a) => a.adjustmentType === "self_employment_income" && (a.spouse === "spouse" || a.spouse === "taxpayer"));
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
  //   amt_depreciation_adjustment — Form 6251 line 2i. The MACRS-vs-ADS
  //                               post-1986 depreciation difference (regular
  //                               depreciation − AMT/ADS depreciation). Usually
  //                               POSITIVE early (add to AMTI) and NEGATIVE in
  //                               later reversal years; the engine honors both
  //                               (AMTI, not the prefs, is floored at 0).
  //   amt_nol_carryforward       — ATNOLD (§56(d)). The AMT-basis NOL the CPA
  //                               carries in; applied against AMTI, capped at
  //                               90% of AMTI before the ATNOLD.
  const amtPreferencesLegacy = sumByType("amt_preferences");
  const amtIsoBargainElement = sumByType("amt_iso_bargain_element");
  const amtStateTaxAddbackOverride = sumByType("amt_state_tax_addback_override");
  const amtDepreciationAdjustment = sumByType("amt_depreciation_adjustment");
  const amtNolCarryforward = Math.max(0, sumByType("amt_nol_carryforward"));

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
  // P2 — Schedule C asset DEPRECIATION (Form 4562 → Sch C line 13: §179 + bonus +
  // MACRS on the sole-prop's own business assets). UNLIKE the above-the-line
  // `section_179_expense_election` / `bonus_depreciation_basis` (kept for rental /
  // pass-through contexts), this reduces the Schedule C NET PROFIT → and therefore
  // the SE-tax base, §199A QBI, earned income, and local EIT (the CPA supplies the
  // computed Form 4562 figure). Floored at 0; can drive a Schedule C loss.
  // The asset-register calculator's output (computeScheduleCAssetDepreciation,
  // below — after grossSeIncome is known for the §179 income limit) is ADDED to
  // this manual figure to form scheduleCDepreciationAdj.
  const scheduleCDepreciationManual = Math.max(0, sumByType("schedule_c_depreciation"));
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
  // P2-15b — general long-term capital gain not already captured by a 1099-B /
  // Schedule D transaction or a more specific adjustment. Flows into the same
  // Schedule D netting (cross-nets with STCG, the $3k offset + carryforward) and
  // therefore into AGI, the preferential-rate calc, the §1411 NIIT base, and the
  // §199A(e)(3) QBI cap. CPA-enterable (e.g. installment-sale recognized gain)
  // and the lever the §453 installment-sale planning what-if injects per year.
  const longTermCapitalGainAdj = sumByType("long_term_capital_gain");
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
  // Tracked sub-gap. Real-property-trade-or-business election is the CPA's
  // responsibility. The §163(j)(3) small-business gross-receipts EXEMPTION is
  // now auto-detected: when the CPA supplies section_163j_gross_receipts (the
  // 3-prior-year average per §448(c)) ≤ the year's threshold, §163(j) does NOT
  // apply and all business interest is allowed (see section163jSmallBusinessExempt).
  const section163jBusinessInterestExpenseAdj = sumByType("section_163j_business_interest_expense");
  const section163jBusinessInterestIncomeAdj = sumByType("section_163j_business_interest_income");
  const section163jCarryforwardFromPriorAdj = sumByType("section_163j_carryforward_from_prior");
  const section163jFloorPlanInterestAdj = sumByType("section_163j_floor_plan_financing_interest");
  const section163jGrossReceiptsAdj = sumByType("section_163j_gross_receipts");
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
  // P2-3 — FTC carryover (Form 1116 Schedule B, §904(c): 1-year back / 10-year
  // forward). Prior-year unused foreign tax auto-loaded by the pipeline from
  // tax_returns.foreignTaxCreditCarryforwardRemaining as a synthetic
  // `foreign_tax_credit_carryforward` adjustment; CPA can override directly.
  // The combined (current + carryover) foreign tax is run through the §904
  // limit; the excess over the limit becomes next year's carryforward.
  const foreignTaxCreditCarryforwardAdj = sumByType("foreign_tax_credit_carryforward");
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
  // P2-1 — per-property net (income − expenses − MACRS) for the Form 8582
  // per-activity worksheet. Empty when no per-property rows (legacy aggregate).
  const perPropertyNets: Array<{ address: string; netIncome: number }> = [];
  // T1.2 §469(g) — a fully-disposed property's current-year net + its accumulated
  // suspended passive loss are RELEASED (freely deductible, no $25k cap) and held
  // OUT of the active-property §469 path.
  let disposedRentalNet = 0;         // disposed properties' current-year net (±)
  let disposedSuspendedReleased = 0; // their accumulated suspended carryforward (≥0)
  if (propertiesForYear.length > 0) {
    const propMacrs = (p: RentalPropertyFact): number => {
      const basis = toNum(p.basis);
      const placedYear = p.placedInServiceYear ?? 0;
      const placedMonth = p.placedInServiceMonth ?? 0;
      if (basis > 0 && placedYear > 0 && placedMonth >= 1 && placedMonth <= 12) {
        return calculateMacrsDepreciation({
          basis,
          propertyType: p.propertyType === "commercial" ? "commercial" : "residential",
          monthPlacedInService: placedMonth,
          yearPlacedInService: placedYear,
          taxYear,
        }).currentYearDepreciation;
      }
      return 0;
    };
    let inc = 0;
    let exp = 0;
    let depTotal = 0;
    propertiesForYear.forEach((p, idx) => {
      const pDep = propMacrs(p);
      const pNet = toNum(p.rentalIncome) - toNum(p.totalExpenses) - pDep;
      if (p.fullyDisposedThisYear) {
        disposedRentalNet += pNet;
        disposedSuspendedReleased += Math.max(0, toNum(p.suspendedLossCarryforward));
      } else {
        inc += toNum(p.rentalIncome);
        exp += toNum(p.totalExpenses);
        depTotal += pDep;
        perPropertyNets.push({
          address: p.address?.trim() || `Property ${idx + 1}`,
          netIncome: pNet,
        });
      }
    });
    scheduleERentalIncomeAdj = inc;
    scheduleERentalExpensesAdj = exp;
    scheduleEMacrsDepreciationAdj = depTotal;
  } else {
    scheduleERentalIncomeAdj = sumByType("schedule_e_rental_income");
    scheduleERentalExpensesAdj = sumByType("schedule_e_rental_expenses");
    scheduleEMacrsDepreciationAdj = sumByType("schedule_e_macrs_depreciation");
  }
  // §469(g) net effect on AGI = disposed current-year net (±) − released suspended
  // loss (≥0). Both flow fully to ordinary income with NO §469 limitation. (Minor
  // documented sub-gap: this release is added AFTER the active-property §469 MAGI,
  // so it doesn't lower that phase-out base.)
  const section469gReleasedLoss = disposedSuspendedReleased;
  const section469gAgiEffect = disposedRentalNet - disposedSuspendedReleased;
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

  // §704(d) / §1366(d) basis limit + §465 at-risk limit on ACTIVE K-1 ordinary
  // (Box 1) LOSSES. A partner/shareholder may deduct a distributive-share loss
  // only up to outside basis (§704(d) partnership / §1366(d) S-corp stock+debt),
  // then only up to the amount at risk (§465); the disallowed excess is
  // suspended and carries forward (the CPA re-enters it in the year basis or
  // at-risk is restored). Enforced only when the CPA supplied basisAtYearStart
  // and/or atRiskAmount (null = not tracked → unlimited, the prior behavior).
  // Box 1 INCOME (≥ 0) is never limited. Passive K-1 losses are already fully
  // suspended by §469 (the passive bucket below), so this targets the active
  // Box 1 loss that otherwise flows freely to AGI. Sub-gap: the limit is keyed
  // to basisAtYearStart (the basis available to absorb losses); it does not
  // model basis consumed by distributions / separately-stated deductions.
  let k1BasisAtRiskLossSuspended = 0;
  const k1ActiveBox1Capped = k1sForYear.filter(k1IsActive).reduce((s, k) => {
    const box1 = toNum(k.box1OrdinaryIncome);
    if (box1 >= 0) return s + box1;
    const tracksBasis = k.basisAtYearStart != null;
    const tracksAtRisk = k.atRiskAmount != null;
    if (!tracksBasis && !tracksAtRisk) return s + box1; // not tracked → unlimited
    // P2-6 (b) — §1367/§1368 ordering: distributions + separately-stated
    // deductions reduce outside basis BEFORE the Box 1 ordinary loss, so the
    // basis available to absorb the loss is beginning basis net of both. (The
    // engine doesn't yet model excess-distribution gain when distributions
    // exceed basis — a further sub-gap; basis floors at 0 here.)
    const basisDrawdown = Math.max(0, toNum(k.distributions)) + Math.max(0, toNum(k.separatelyStatedDeductions));
    const basisLimit = tracksBasis ? Math.max(0, toNum(k.basisAtYearStart) - basisDrawdown) : Infinity;
    const atRiskLimit = tracksAtRisk ? Math.max(0, toNum(k.atRiskAmount)) : Infinity;
    const allowedMag = Math.min(Math.abs(box1), basisLimit, atRiskLimit);
    k1BasisAtRiskLossSuspended += Math.abs(box1) - allowedMag;
    return s - allowedMag;
  }, 0);
  const k1ActiveOrdinary =
    k1ActiveBox1Capped +
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

  // M9b (audit 2026-06-11) — the official Schedule B $1,500 filing trigger
  // counts K-1 portfolio interest (Box 5) and box-1a dividends (Boxes 6a+6b)
  // alongside the 1099-INT/DIV amounts (Schedule B instructions: list
  // interest/dividends received as a nominee or through a partnership/S corp).
  // summarize1099s only sees 1099 records, so widen the flag here once the
  // K-1 portfolio sums exist. (The engine's ordinary/qualified K-1 dividend
  // buckets mirror the 1099 split: ordinary = the non-qualified remainder.)
  form1099Summary.scheduleBRequired =
    form1099Summary.scheduleBRequired ||
    form1099Summary.interestIncome + k1InterestIncome > 1500 ||
    form1099Summary.ordinaryDividends +
      form1099Summary.qualifiedDividends +
      k1OrdinaryDividends +
      k1QualifiedDividends >
      1500;
  const k1Stcg = sumK1Where(() => true, (k) => k.netShortTermCapitalGain);
  const k1Ltcg = sumK1Where(() => true, (k) => k.netLongTermCapitalGain);
  // 1065 Box 4 guaranteed payments (§707(c)) — ordinary income to the partner
  // on Schedule E Part II. Always ordinary (never passive-bucketed) and
  // EXCLUDED from QBI per §199A(c)(4) (the QBI auto-default below reads Box 1/
  // 2/3, never Box 4). S-corp K-1s have no guaranteed payments, so summing all
  // rows is safe.
  const k1GuaranteedPayments = sumK1Where(() => true, (k) => k.box4GuaranteedPayments);
  // Partnership SE base. S-corp K-1 income isn't subject to SE tax (shareholders
  // take W-2 wages for services; their distributive share is investment-type).
  // Per partnership K-1, SE = max(Box 14A, Box 4 guaranteed payments): a real
  // 1065 K-1 reports Box 14A INCLUSIVE of the guaranteed payment, so max() does
  // NOT double-count when Box 14A is entered, and still captures the GP as SE
  // income when the CPA enters only Box 4 (Box 14A left blank). Box 14A may be a
  // loss (negative); GP is normally ≥ 0, so max() floors the SE contribution at
  // the GP for a service partner.
  const k1SelfEmploymentEarnings = k1sForYear
    .filter((k) => (k.entityType ?? "partnership") === "partnership")
    .reduce(
      (s, k) => s + Math.max(toNum(k.selfEmploymentEarnings), toNum(k.box4GuaranteedPayments)),
      0,
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
  // T1.2 — digital-asset ordinary income (IRS Notice 2014-21 + Rev. Rul. 2023-14):
  //  • Staking rewards → ordinary income at FMV when dominion & control is gained
  //    (NOT self-employment — passive staking is not a trade/business).
  //  • Mining rewards as a trade/business → ordinary income SUBJECT to SE tax
  //    (hobby mining: the CPA uses additional_income instead). Both establish basis
  //    = the FMV included. Their later disposition rides the capital-transaction path.
  const cryptoStakingIncome = Math.max(0, sumByType("crypto_staking_income"));
  const cryptoMiningIncome = Math.max(0, sumByType("crypto_mining_income"));
  const grossSeIncome = seIncomeFromAdj + form1099Summary.seIncome + cryptoMiningIncome;
  // P2 (2026-06-06h) — Schedule C asset-level depreciation (Form 4562 → Sch C
  // line 13): §179 (with the §179(b)(3) business-income limit + carryforward) +
  // §168(k) bonus + personal-property MACRS, computed from the per-asset register
  // and folded into the SE-base-reducing schedule_c_depreciation total. Inert when
  // no assets are supplied (totalDepreciation 0 → scheduleCDepreciationAdj ==
  // the manual figure, unchanged). The §179 income-limit base is the active-T/B
  // taxable income BEFORE asset depreciation: Schedule C net (gross − expenses −
  // any manual depreciation) + W-2 wages (Reg §1.179-2(c)(6)(iv)).
  const scheduleCAssetList = inputs.scheduleCAssets ?? [];
  // §179(b)(3)(B) carryforward of a PRIOR year's income-disallowed §179 — auto-
  // seeded by the pipeline as `schedule_c_section179_carryforward` from the prior
  // return (the §41/§51 GBC pattern). Added to this year's §179 available before
  // the income limit; deductible even with no new assets (so the calculator runs
  // when assets OR a carryforward is present).
  const scheduleCSection179CarryforwardIn = Math.max(0, sumByType("schedule_c_section179_carryforward"));
  const scheduleCAssetDepreciation: ScheduleCAssetDepreciationResult | null =
    scheduleCAssetList.length > 0 || scheduleCSection179CarryforwardIn > 0
      ? computeScheduleCAssetDepreciation({
          assets: scheduleCAssetList,
          taxYear: resolvedMapYear,
          businessIncomeForSection179:
            grossSeIncome - Math.max(0, scheduleCExpensesInput) - scheduleCDepreciationManual + totalWages,
          section179Cap: SECTION_179_CAPS[resolvedMapYear].cap,
          section179PhaseStart: SECTION_179_CAPS[resolvedMapYear].phaseStart,
          bonusRateByYear: BONUS_RATE_BY_ACQUISITION_YEAR,
          section179CarryforwardIn: scheduleCSection179CarryforwardIn,
        })
      : null;
  const scheduleCDepreciationAdj =
    scheduleCDepreciationManual + (scheduleCAssetDepreciation?.totalDepreciation ?? 0);
  const scheduleCExpenses = Math.min(
    Math.max(0, scheduleCExpensesInput),
    Math.max(0, grossSeIncome),
  );
  // §461(l) Sch-C-loss-flow fix: the SIGNED Schedule C net (can be NEGATIVE)
  // flows to AGI so a Schedule C LOSS offsets other income — capped downstream
  // by the §461(l) excess-business-loss addback (line ~1912). `netSeIncome`
  // stays floored at 0 for everything a loss may NOT reduce: the SE-tax base,
  // QBI, local EIT, and earned income. Uses the uncapped scheduleCExpensesInput
  // so expenses > gross also produce a deductible loss, consistent with the
  // §461(l) schCLoss derivation below. `Math.max(0, scheduleCNetSigned)` is
  // arithmetically identical to the prior `grossSeIncome - scheduleCExpenses`.
  const scheduleCNetSigned = grossSeIncome - Math.max(0, scheduleCExpensesInput) - scheduleCDepreciationAdj;
  const netSeIncome = Math.max(0, scheduleCNetSigned);
  // T1.2 — Clergy housing/parsonage allowance (IRC §107 + §1402(a)(8)). EXCLUDED
  // from income tax (never enters AGI) but INCLUDED in the SE-tax base — a minister
  // is self-employed for SE-tax purposes. The minister's W-2 box-1 wages are taxed
  // & SE-taxable separately; this adjustment carries only the income-tax-exempt
  // housing piece (the common gap where it otherwise escapes SE tax entirely).
  const clergyHousingAllowance = Math.max(0, sumByType("clergy_housing_allowance"));
  // T1.2 SE edges:
  //  • Statutory employee (W-2 Box 13): income + expenses go on Schedule C, but
  //    the net is NOT in the SE base (FICA was already withheld on the W-2). It
  //    IS ordinary income (AGI), QBI-eligible, and earned income.
  //  • Church employee income (Sch SE Line 5a): wages of a church/§3121(w)-electing
  //    org that opted OUT of employer FICA → the employee owes SE tax on it. It is
  //    ordinary income (AGI) + earned income, NOT QBI. ($108.28-to-$400 special
  //    floor is a documented sub-gap — the engine uses the $400 Sch SE floor.)
  const statutoryEmployeeIncome = Math.max(0, sumByType("statutory_employee_income"));
  const churchEmployeeIncome = Math.max(0, sumByType("church_employee_income"));
  // T1.2 — SE NON-FARM OPTIONAL METHOD (Sch SE Part II). A taxpayer with low/
  // negative actual net SE may ELECT to report ⅔ of gross nonfarm SE income (up
  // to the year cap) as net SE earnings, to earn SS credits / qualify for EITC/
  // ACTC. Election adjustment `se_optional_method_nonfarm` carries the GROSS
  // nonfarm SE income. Eligible only if actual net SE < the year threshold AND
  // < 72.189% of gross. Raises the SE base + earned income (NOT AGI — the actual
  // Sch C net still flows to AGI). 2024/2025 figures per Sch SE instructions.
  const seOptionalNonfarmGross = Math.max(0, sumByType("se_optional_method_nonfarm"));
  const SE_OPTIONAL_METHOD: Record<number, { netThreshold: number; maxReport: number }> = {
    2024: { netThreshold: 7493, maxReport: 6920 },
    2025: { netThreshold: 7840, maxReport: 7240 },
    2026: { netThreshold: 7840, maxReport: 7240 }, // 2026 not yet published — hold 2025.
  };
  let seOptionalReported = 0;
  if (seOptionalNonfarmGross > 0) {
    const cfg = SE_OPTIONAL_METHOD[taxYear] ?? SE_OPTIONAL_METHOD[2024];
    if (netSeIncome < cfg.netThreshold && netSeIncome < 0.72189 * seOptionalNonfarmGross) {
      seOptionalReported = Math.min((2 / 3) * seOptionalNonfarmGross, cfg.maxReport);
    }
  }
  // The optional method REPLACES actual net SE in the SE base + earned income.
  const seBaseScheduleC = seOptionalReported > 0 ? seOptionalReported : netSeIncome;
  // T1.2 (church $108.28 floor, independent review 2026-06-09) — church-employee
  // income (Sch SE Line 5a) is SE-taxed from $108.28 income / $100 net earnings,
  // NOT the regular $400 floor. Lower the floor on the church-bearing SE base so a
  // standalone church wage below $433 is no longer wrongly exempt.
  const churchSeFloor = churchEmployeeIncome >= 108.28 ? 100 : 400;
  // SE-tax base = Schedule C net (or optional-method reported) + K-1 partnership
  // Box 14A SE earnings + clergy housing allowance + church-employee income.
  const seTaxBase = Math.max(0, seBaseScheduleC + k1SelfEmploymentEarnings + clergyHousingAllowance + churchEmployeeIncome);

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
    form1099Records.some((r) => r.spouse === "spouse") ||
    // E2 — a spouse-tagged SE-income adjustment opts the return into per-spouse
    // Sch SE (so a same-spouse high-W-2 + Sch C no longer over-taxes the SE SS
    // base, and a spouse-attributed Sch C is taxed on its own base).
    seAdjHasSpouseTag;
  if (isMfjForSe && hasExplicitSpouseAttribution) {
    // K1 MFJ sub-gap closure (2026-05-26).
    const necRecordsForYear = form1099Records.filter((r) =>
      (r.formType ?? "").toLowerCase() === "nec" && (r.taxYear ?? taxYear) === taxYear);
    const necSeIncomeTaxpayer = necRecordsForYear
      .filter((r) => (r.spouse ?? "taxpayer") === "taxpayer")
      .reduce((s, r) => s + toNum(r.nonemployeeCompensation), 0);
    const necSeIncomeSpouse = necRecordsForYear
      .filter((r) => r.spouse === "spouse")
      .reduce((s, r) => s + toNum(r.nonemployeeCompensation), 0);
    // self_employment_income adjustments + K-1 partnership Box 14A default to
    // taxpayer attribution. Schedule C expenses split is the same — apportion
    // to taxpayer's gross.
    // E2 — the SE-income adjustment is attributed by its spouse tag (untagged →
    // taxpayer). seIncomeFromAdjSpouse is the spouse-tagged subset.
    // T1.2 (HIGH-2, independent review 2026-06-09) — crypto-mining income (a
    // trade/business, SE-taxable) defaults to the taxpayer like seIncomeFromAdj;
    // it was in the single-filer grossSeIncome but was being dropped from the
    // MFJ per-spouse SE base → mining escaped SE tax on MFJ returns.
    const grossSeTaxpayer = (seIncomeFromAdj - seIncomeFromAdjSpouse) + necSeIncomeTaxpayer + cryptoMiningIncome;
    const grossSeSpouse = necSeIncomeSpouse + seIncomeFromAdjSpouse;
    const taxpayerScheduleCExpenses = Math.min(
      Math.max(0, scheduleCExpensesInput),
      Math.max(0, grossSeTaxpayer),
    );
    const taxpayerNetSe = Math.max(0, grossSeTaxpayer - taxpayerScheduleCExpenses);
    const spouseNetSe = Math.max(0, grossSeSpouse);
    // T1.2 (HIGH-3, independent review 2026-06-09) — apply the SE non-farm optional
    // method (Sch SE Part II) to the taxpayer's base on MFJ too (the election
    // defaults to the taxpayer); the per-spouse branch was using the actual net,
    // silently dropping the election (which exists to buy SS credits / EITC).
    const taxpayerSeBaseSchedC = seOptionalReported > 0 ? seOptionalReported : taxpayerNetSe;
    const seTaxBaseTaxpayer = Math.max(0, taxpayerSeBaseSchedC + k1SelfEmploymentEarnings + clergyHousingAllowance + churchEmployeeIncome);
    const seTaxBaseSpouse = Math.max(0, spouseNetSe);

    const seTaxpayer = calculateSelfEmploymentTax(seTaxBaseTaxpayer, taxYear, w2SsByTaxpayer, churchSeFloor);
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
    se = calculateSelfEmploymentTax(seTaxBase, taxYear, 0, churchSeFloor);
  } else {
    // Single, HoH, MFS, QSS — single filer; original Sch SE Line 9 path.
    se = calculateSelfEmploymentTax(seTaxBase, taxYear, w2SocialSecurityWages, churchSeFloor);
  }

  // K5 — SEHI deduction (Form 7206). Cap = net SE − half-SE. Adjustment is
  // gross premiums; engine applies the cap. Goes above-the-line (subtracts
  // from AGI alongside half-SE). Eligibility (employer plan availability)
  // is the CPA's responsibility — engine assumes the adjustment is valid.
  //
  // P2-3 note — there is NO SEHI CARRYFORWARD in the law. §162(l)(2)(A) limits
  // the above-the-line SEHI deduction to the trade/business's earned income
  // (net SE − half-SE); premiums in EXCESS of that cap are NOT deductible as
  // SEHI and do NOT carry to a later year. They are instead deductible (same
  // year) as itemized medical on Schedule A subject to the 7.5%-of-AGI floor
  // (§213) — the CPA enters that via Schedule A, not a carryforward. (The
  // P2-3 task title paired "FTC carryforward + SEHI carryforward"; only the FTC
  // §904(c) carryover is a real carryforward, shipped above.)
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

  // K7 / P2-6 (a) — §1202 QSBS exclusion with acquisition-date EXCLUSION
  // PERCENTAGE. The per-issuer cap (greater of $10M or 10× basis) bounds the
  // ELIGIBLE gain; the exclusion percentage — 50% (acquired before 2009-02-18),
  // 75% (2009-02-18 to 2010-09-27), or 100% (after 2010-09-27) — then applies to
  // that capped eligible gain. The CPA supplies the percentage via the
  // `qsbs_exclusion_pct` adjustment (50/75/100); absent/0 defaults to 100%
  // (the post-9/27/2010 common case — unchanged from before).
  //   excluded  = pct × min(gross, cap)
  //   taxable   = gross − excluded   (over-cap excess + the non-excluded %)
  const qsbsGrossGain = Math.max(0, qsbsGrossGainAdj);
  const qsbsAdjustedBasis = Math.max(0, qsbsAdjustedBasisAdj);
  const qsbsExclusionPctAdj = sumByType("qsbs_exclusion_pct");
  const qsbsExclusionPct = qsbsExclusionPctAdj > 0 ? Math.min(100, qsbsExclusionPctAdj) / 100 : 1.0;
  const qsbsCap = Math.max(10_000_000, 10 * qsbsAdjustedBasis);
  const qsbsCappedEligible = Math.min(qsbsGrossGain, qsbsCap);
  const qsbsSection1202Exclusion = qsbsExclusionPct * qsbsCappedEligible;
  const qsbsTaxableGain = Math.max(0, qsbsGrossGain - qsbsSection1202Exclusion);
  // §57(a)(7) AMT preference — 7% of the EXCLUDED gain is an AMT preference for
  // 50%/75%-exclusion stock (NOT for 100% post-9/27/2010 stock, which carries no
  // preference). Added to the Form 6251 preference total below.
  // Sub-gap (documented): the TAXABLE §1202 remainder is "28%-rate gain" (§1(h))
  // — taxed at a maximum 28% rate. The engine routes it to ordinary LTCG
  // (0/15/20%), so for a top-bracket seller the engine slightly UNDER-taxes the
  // taxable §1202 remainder. A dedicated 28%-rate bucket is the remaining gap.
  const qsbs1202AmtPreference = qsbsExclusionPct < 1.0 ? 0.07 * qsbsSection1202Exclusion : 0;

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
  //   * Active K-1 losses are already net of the §704(d)/§1366(d) basis +
  //     §465 at-risk limit (k1ActiveOrdinary uses the capped loss), so the
  //     §461(l) aggregation correctly excludes basis/at-risk-disallowed losses.
  // SECTION_461L_THRESHOLDS is module-scope (typed Record<TaxYear>).
  const section461lThreshold = SECTION_461L_THRESHOLDS[resolvedMapYear];
  // §461(l) auto-aggregation: compute when CPA didn't supply an explicit addback.
  let section461lAutoAddback = 0;
  if (section461lExcessLossAddbackAdj <= 0) {
    const schCLoss = Math.max(0, scheduleCExpensesInput + scheduleCDepreciationAdj - grossSeIncome);
    // Rental: compute pre-PAL net (income − expenses − MACRS) from properties / aggregate adjustments.
    // grossRentalNet isn't yet computed; use the inputs we know.
    const aggregateRentalIncome = scheduleERentalIncomeAdj;
    const aggregateRentalExpenses = scheduleERentalExpensesAdj + scheduleEMacrsDepreciationAdj;
    const rentalNetPrePal = aggregateRentalIncome - aggregateRentalExpenses;
    const rentalLossPrePal = Math.max(0, -rentalNetPrePal);
    const k1ActiveLoss = Math.max(0, -k1ActiveOrdinary);
    // Sub-gap (independent review 2026-06-08): a net §1231 loss from Form 4797
    // (`form4797.ordinaryComponent` < 0) is also an excess-business-loss
    // component under §461(l)(3)(B), but form4797 is computed below (line ~2170)
    // so it is NOT in this auto-aggregation. Direction is conservative (under-
    // addback → never over-taxes). A CPA supplies the figure via the explicit
    // `section_461l_excess_loss_addback` override (which always wins above).
    const aggregateBizLoss = schCLoss + rentalLossPrePal + k1ActiveLoss;
    const threshold =
      section461lThreshold[client.filingStatus] ?? section461lThreshold.single;
    if (aggregateBizLoss > threshold) {
      section461lAutoAddback = aggregateBizLoss - threshold;
    }
  }
  const section461lExcessLossAddback = Math.max(
    section461lExcessLossAddbackAdj,
    section461lAutoAddback,
  );

  // T1.1b — Form 4797 (Sales of Business Property). Net §1231 gain joins the
  // Schedule D netting as LTCG (carrying any unrecaptured §1250 25% character);
  // depreciation recapture + a net §1231 loss + the §1231(c) 5-year lookback
  // recharacterization flow to ordinary income below. Inert when no rows.
  // Sub-gap (independent review 2026-06-08): the net §1231 gain flows into the
  // §1411 NIIT base unconditionally (via netLTCG → ltcgPreferential). A §1231
  // gain on property used in a NON-passive trade/business is excluded from NII
  // (§1411(c)(1)); the engine has no active/passive flag on a 4797 disposition,
  // so it over-includes (conservative — over-states NIIT, never under-taxes),
  // consistent with the engine's existing NIIT posture (§1031/§121/QSBS gains).
  const form4797 = computeForm4797(
    (inputs.form4797 ?? []).filter((s) => s.taxYear === taxYear),
    Math.max(0, sumByType("section_1231_lookback_loss")),
  );

  // K-1 net ST/LT capital gain (Box 8 / 9a) joins the cap-gain netting
  // alongside 1099-B-derived gains. Subtract prior-year loss carryforwards.
  // Home-sale taxable remainder (K6) and QSBS taxable remainder (K7) are
  // long-term per §121 (2-of-5 ownership) and §1202 (5-year holding).
  let netSTCG = form1099Summary.shortTermCapitalGains + k1Stcg - stcgCarryforward;
  let netLTCG = form1099Summary.longTermCapitalGains + k1Ltcg - ltcgCarryforward + homeSaleTaxableGain + qsbsTaxableGain + section1031RecognizedGain + Math.max(0, longTermCapitalGainAdj) + form4797.netSection1231LtcgGain;

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

  // ── §163(d) Investment interest expense + §163(d)(4)(B) election (Form 4952) ──
  // Investment interest (margin interest on debt to carry investment property)
  // is an ITEMIZED deduction allowed only up to NET INVESTMENT INCOME; the excess
  // carries forward indefinitely (§163(d)(2)). NII here = ordinary investment
  // income: interest + NON-qualified dividends + net STCG + royalties (investment
  // expenses netting is a documented sub-gap → treated as 0). The §163(d)(4)(B)
  // ELECTION lets the taxpayer treat up to `investment_interest_election_amount`
  // of QDIV/net-LTCG as investment income — which (a) raises the NII cap (frees
  // more interest deduction) and (b) re-buckets that amount from preferential to
  // ORDINARY rates (the cost of the election). The elected amount STAYS in the
  // §1411 NIIT base (the election is a §163(d) characterization, not a §1411 one),
  // so the NIIT base below keeps reading the pre-election `ltcgPreferential`.
  // Gated entirely on the adjustments — both 0 ⇒ no change to any existing return.
  // §163(d)(2): prior-year disallowed investment interest carries forward
  // INDEFINITELY and is added to the current year's investment interest expense.
  // The pipeline auto-seeds it as `investment_interest_carryforward` from the
  // prior return; a CPA can also enter it directly.
  const investmentInterestExpenseAdj = Math.max(
    0,
    sumByType("investment_interest_expense") + sumByType("investment_interest_carryforward"),
  );
  const nonQualifiedDividends = Math.max(
    0,
    (form1099Summary.ordinaryDividends + k1OrdinaryDividends) -
      (form1099Summary.qualifiedDividends + k1QualifiedDividends),
  );
  const baseNetInvestmentIncome = Math.max(
    0,
    form1099Summary.interestIncome + k1InterestIncome +
      nonQualifiedDividends +
      form1099Summary.royalties + k1Royalties +
      Math.max(0, stcgInOrdinary),
  );
  const preferentialAvailableForElection = Math.max(0, ltcgPreferential) + qualifiedDividends;
  const investmentInterestElectionAmount = Math.min(
    Math.max(0, sumByType("investment_interest_election_amount")),
    preferentialAvailableForElection,
  );
  const investmentInterestNiiWithElection = baseNetInvestmentIncome + investmentInterestElectionAmount;
  const allowedInvestmentInterest = Math.min(investmentInterestExpenseAdj, investmentInterestNiiWithElection);
  const investmentInterestDisallowed = Math.max(0, investmentInterestExpenseAdj - allowedInvestmentInterest);
  // Re-bucket the elected amount out of the preferential buckets (LTCG first,
  // then QDIV) so it is taxed at ordinary rates by calculateFederalTaxWithCapitalGains.
  const electFromLtcg = Math.min(investmentInterestElectionAmount, Math.max(0, ltcgPreferential));
  const electFromQdiv = investmentInterestElectionAmount - electFromLtcg;
  const ltcgPreferentialAfterElection = Math.max(0, ltcgPreferential - electFromLtcg);
  const qualifiedDividendsAfterElection = Math.max(0, qualifiedDividends - electFromQdiv);

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
  // Std-ded for the ATI proxy — route through the canonical year-indexed helper
  // (supports TY2024/2025/2026). The old inline two-year map silently used the
  // TY2024 value for a TY2026 return AND held STALE pre-OBBBA TY2025 values
  // ($15,000 vs the corrected $15,750) — same fall-through class as the QBI band.
  const fedStdDedForAti = getFederalStandardDeduction(client.filingStatus, taxYear);
  // Approximate itemized total from Sched A inputs available at this point in the
  // pipeline. Uses the YEAR-INDEXED SALT cap (TCJA $10k TY2024; OBBBA $40k TY2025
  // / $40.4k TY2026 + §164(b)(7) >$500k phase-down) instead of a stale $10k
  // hardcode. AGI proper isn't computed yet here, so the phase-down MAGI is
  // approximated from the major income components.
  const magiProxyForSaltCap = Math.max(
    0,
    totalWages + netSeIncome + additionalIncome + investmentIncomeFromAdj,
  );
  const saltCapForAti = getSaltCap(taxYear, client.filingStatus, magiProxyForSaltCap);
  const itemizedApproxForAti =
    Math.max(0, medicalExpensesAdj) +
    Math.min(saltCapForAti, stateIncomeTaxAdj + statePropertyTaxAdj + stateSalesTaxAdj) +
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
      k1GuaranteedPayments +
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
  // §163(j)(3) small-business exemption: a taxpayer that meets the §448(c)
  // gross-receipts test (3-prior-year average ≤ the inflation-adjusted
  // threshold) is NOT subject to §163(j) — all business interest is allowed.
  // SECTION_448C_THRESHOLD is module-scope (typed Record<TaxYear>). Auto-detected
  // only when the CPA supplies a positive gross-receipts figure; 0/absent
  // preserves prior behavior (engine applies the 30% §163(j) cap).
  const section163jGrossReceipts = Math.max(0, section163jGrossReceiptsAdj);
  const section163jGrossReceiptsThreshold = SECTION_448C_THRESHOLD[resolvedMapYear];
  const section163jSmallBusinessExempt =
    section163jGrossReceipts > 0 && section163jGrossReceipts <= section163jGrossReceiptsThreshold;

  // §163(j)(1): allowance = (biz interest income) + (floor plan financing
  // interest) + (30% × ATI). Items NOT subject to the 30% cap are added
  // directly. Items subject (gross interest + carryforward) cap at 30% ATI.
  // When the small-business exemption applies, the 30% cap is lifted — the
  // cap-subject portion (current gross + prior carryforward) is fully allowed
  // and nothing carries forward.
  const cappedPortion = section163jGross + section163jCarryforwardFromPrior;
  const cappedAllowance = section163jSmallBusinessExempt ? cappedPortion : 0.30 * ati163jProxy;
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
    scheduleCNetSigned +   // §461(l) fix: signed Sch C net (loss flows to AGI; §461(l) addback below caps it)
    statutoryEmployeeIncome +  // T1.2 — statutory-employee Sch C net (ordinary income, no SE tax)
    churchEmployeeIncome +     // T1.2 — church-employee wages (ordinary income + SE tax via seTaxBase)
    cryptoStakingIncome +      // T1.2 — crypto staking rewards (ordinary, not SE; Rev. Rul. 2023-14)
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
    k1GuaranteedPayments +   // 1065 Box 4 §707(c) — ordinary income, not QBI
    k1PassiveAppliedToAgi +
    k1InterestIncome +
    k1OrdinaryDividends +
    k1Royalties +
    feieGrossForeignIncome -  // K9 — add gross foreign earned income
    feieExclusion +           // K9 — subtract FEIE excluded portion
    isoDisqualifyingDispositionOrdinary +    // C6 — ISO disqualifying disposition comp income
    esppDisqualifyingDispositionOrdinary +   // C6 — §423 ESPP disqualifying disposition comp income
    section461lExcessLossAddback -           // C7 — §461(l) excess business loss addback (positive add)
    section163jAllowedDeduction +            // C7 — §163(j) allowed business interest (deduction)
    form4797.ordinaryComponent;              // T1.1b — Form 4797 ordinary (recapture + §1231(c) lookback + net §1231 loss, signed)
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
      mfsLivedApartAllYear: client.mfsLivedApartAllYear ?? false,
    });
    rentalNetAppliedToAgi = -passiveLossAllowance.allowedThisYear; // negative = reduces AGI
  }

  // P2-1 — Form 8582 per-activity worksheet (only when per-property rows exist).
  // The aggregate tax result is unchanged; this ratably allocates the allowed /
  // suspended loss back to each property for the CPA's Form 8582 + per-property
  // suspended-loss visibility. Per-property carryforward STORAGE (release on
  // disposition) is the remaining increment — the aggregate
  // `schedule_e_passive_loss_carryforward` continues to drive the tax result.
  const form8582: Form8582Breakdown | null =
    perPropertyNets.length > 0
      ? computeForm8582Breakdown({ properties: perPropertyNets, palResult: passiveLossAllowance })
      : null;

  const ordinaryAdditionalIncome = ordinaryAdditionalIncomeBeforeRental + rentalNetAppliedToAgi + section469gAgiEffect;

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
    iraSpouseCoveredByWorkplacePlan: client.iraSpouseCoveredByWorkplacePlan ?? false,
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
    section179Applied + bonusDepreciationApplied +
    // A2 — 1099-INT Box 2 early-withdrawal-of-savings penalty (§62(a)(9)).
    form1099Summary.interestEarlyWithdrawalPenalty;

  // ── IRA deduction FIRST. Its Pub 590-A MAGI excludes BOTH the IRA and the
  //    student-loan-interest deductions, so it is independent of the SLI figure
  //    (the SLI add-back cancels its own subtraction) — no circular dependency.
  //    Computing it before §221 lets the SLI MAGI below subtract the IRA
  //    deduction, as the AGI definition requires.
  //
  // C4 (audit 2026-06-08) — MAGI for the traditional-IRA-deduction phase-out
  // (Pub 590-A Worksheet 1-1) = AGI without the IRA deduction, with the SLI
  // deduction and the §911 FEIE/foreign-housing exclusion ADDED BACK. Excluding
  // both IRA and SLI from the subtraction yields exactly that.
  const agiExcludingIraAndSli = Math.max(0, totalIncomeProvisional - aboveTheLineDeterministic);
  const magiForIra = agiExcludingIraAndSli + feieExclusion;

  const retirement = calculateRetirementDeductions({
    hsaContribution: hsaContributionAdj,
    hsaEmployerContribution: hsaEmployerContributionAdj,
    hsaIsFamilyCoverage: client.hsaIsFamilyCoverage ?? false,
    iraContribution: iraTraditionalAdj,
    iraCoveredByWorkplacePlan: client.iraCoveredByWorkplacePlan ?? false,
    iraSpouseCoveredByWorkplacePlan: client.iraSpouseCoveredByWorkplacePlan ?? false,
    age: ageTaxpayer,
    agi: magiForIra,
    filingStatus: client.filingStatus,
    taxYear,
  });
  const iraDeduction = retirement.iraDeductible;

  // ── §221 student-loan-interest MAGI (Pub 970 Worksheet 4-1) = AGI figured
  //    WITHOUT the SLI deduction (i.e. NET of the IRA deduction), PLUS the §911
  //    FEIE/foreign-housing exclusion added back. Subtracting iraDeduction here
  //    is the correctness fix: previously SLI MAGI omitted it, so a deductible
  //    IRA inflated MAGI and over-phased-out §221 near the $80k/$165k band
  //    (single $90k SE + $4k IRA + $1,500 SLI → $1,135.83 instead of $1,500).
  //    Filers without a deductible IRA are unaffected (iraDeduction = 0).
  const magiForSli = Math.max(0, totalIncomeProvisional - aboveTheLineDeterministic - iraDeduction) + feieExclusion;
  const studentLoanInterest = calculateStudentLoanInterest({
    interestPaid: studentLoanInterestAdj,
    magi: magiForSli,
    filingStatus: client.filingStatus,
    taxYear,
  });
  const sliDeduction = studentLoanInterest.deductible;

  const aboveTheLineExcludingIra = aboveTheLineDeterministic + sliDeduction;
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

  // §163(d) investment interest is a Schedule A line — fold the allowed amount
  // into the itemized total (it only benefits the client if they itemize).
  const scheduleAItemizedWithInvInt = scheduleA.totalItemized + allowedInvestmentInterest;
  const itemizedTotal = Math.max(scheduleAItemizedWithInvInt, additionalDeductions);
  // E3b — a dependent / kiddie-tax filer gets the IRC §63(c)(5) limited std
  // deduction. earnedIncome = wages + net SE profit. Used for BOTH the
  // itemize-vs-standard decision here AND runTaxCalculation below (same value).
  const claimedAsDependent = Boolean(client.claimedAsDependent || client.isKiddieTaxFiler);
  const earnedIncomeForStdDed = totalWages + seBaseScheduleC + statutoryEmployeeIncome + churchEmployeeIncome;
  const stdDed = claimedAsDependent
    ? getDependentStandardDeductionBase(client.filingStatus, taxYear, earnedIncomeForStdDed)
    : getFederalStandardDeduction(client.filingStatus, taxYear);
  // FS-1/FS-4 — the filing-status optimizer's forced deduction modes (see
  // RecalcOverrides). forceItemized wins over forceStandardDeduction.
  const forceItemized = overrides.forceItemized === true;
  const forceStandard = !forceItemized && overrides.forceStandardDeduction === true;
  const useItemizedDeductions =
    forceItemized
      ? true
      : forceStandard
        ? false
        : useItemizedDeductionsOverride === true
          ? true
          : useItemizedDeductionsOverride === false && additionalDeductions === 0 && scheduleAItemizedWithInvInt === 0
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
    taxpayerBlind: client.taxpayerBlind,
    spouseBlind: client.spouseBlind,
    // E3b — §63(c)(5) dependent std-deduction limit.
    claimedAsDependent,
    earnedIncome: earnedIncomeForStdDed,
    // FS-1 — skip the max-with-std protection (forced MFS itemizer gets
    // exactly their itemized total, even when below std / $0).
    forceItemized,
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
    // §1.199A-3(b)(1)(vi): only the ½-SE deduction ATTRIBUTABLE to the qualified
    // trade/business reduces its QBI. A clergy housing allowance is in the SE
    // base but is NOT Sch-C QBI income, so the clergy-attributable share of
    // ½-SE must NOT reduce Sch-C QBI. Exclude it (no-op when there's no clergy
    // allowance — clergyHousingAllowance/seTaxBase = 0 → identical to before).
    const clergyShareOfSe = Math.min(1, seTaxBase > 0 ? clergyHousingAllowance / seTaxBase : 0);
    const schCQbi = Math.max(0, netSeIncome - se.deductibleHalf * (1 - clergyShareOfSe));
    qbiIncomeEffective = schCQbi;
    // Sub-gap (independent review 2026-06-08): when K-1 partnership SE earnings
    // (k1SelfEmploymentEarnings) coexist, the FULL ½-SE still over-reduces Sch-C
    // QBI by the K-1's share. The general fix (subtract only the Sch-C share,
    // netSeIncome/seTaxBase) is deferred because the K-1's own ½-SE is not yet
    // netted into its QBI — a half-done generalization would UNDER-reduce total
    // QBI (under-taxation). Current state is conservative (over-reduces). Only
    // the clergy share is carved out here (the new, common, zero-K-1 path).
  }
  // T1.2 (HIGH-1, independent review 2026-06-09) — statutory-employee Sch C net is
  // §199A-eligible (§1.199A-3; no ½-SE to subtract) and is a SEPARATE income stream
  // from the Sch C / explicit qbi_income, so it is ALWAYS added on top — not gated
  // behind the qbi_income<=0 auto-default (which a CPA-supplied qbi_income would
  // otherwise skip, silently dropping the statutory QBI).
  qbiIncomeEffective += statutoryEmployeeIncome;
  // K-1 default: when section199aQbi unset for active K-1, use Box 1.
  // Per-business SSTB (§199A(d)(2)): track the SSTB portion of K-1 QBI
  // (k1QbiSstbPortion) so the §199A(d)(3) phase-out below applies ONLY to
  // SSTB QBI, per K-1 via k.isSstb. k1QbiContributionEffective itself is the
  // total and its computation is unchanged (backward-compatible).
  let k1QbiContributionEffective = k1QbiContribution;
  let k1QbiSstbPortion = 0;
  // SSTB portion of the explicit K-1 QBI:
  for (const k of k1sForYear) {
    const explicitQbi = toNum(k.section199aQbi);
    if (explicitQbi > 0 && k.isSstb === true) k1QbiSstbPortion += explicitQbi;
  }
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
      if (k.isSstb === true) k1QbiSstbPortion += qbiCandidate;
    }
    k1QbiContributionEffective += k1QbiAutoSum;
  }

  // SSTB phase-in (§199A(d)(3)). Phase-in band TY2024:
  //   Single: $191,950 to $241,950 (50k band)
  //   MFJ:    $383,900 to $483,900 (100k band)
  // SSTB QBI above the top of band → $0; within band → linear phase-out;
  // non-SSTB QBI is unaffected. SSTB is PER-BUSINESS: the Sch C via the
  // `qbi_sstb_flag` adjustment, each K-1 via k.isSstb (k1QbiSstbPortion above).
  const schCIsSstb = sumByType("qbi_sstb_flag") > 0;
  // SSTB phase-in band — routed through the SINGLE source of truth in
  // taxCalculator (qbiPhaseInBand), shared with the §199A wage/UBIA limit so the
  // two §199A mechanics can never diverge by year or filing status. This block
  // previously held a DUPLICATE TY2024/2025-only map selected by
  // `taxYear === 2025 ? … : 2024`, so a TY2026 return silently used the TY2024
  // band (and MFS used a non-statutory half-threshold). The canonical map is
  // keyed through the latest supported year; MFS = single per §199A(e)(2).
  const phaseIn = qbiPhaseInBand(taxYear, client.filingStatus);
  // The SSTB phase-out fraction is computed AFTER the NOL step below, keyed on
  // post-NOL, pre-QBI taxable income (the §199A(e)(2) "threshold amount" base) —
  // NOT AGI. See the detailed note at its computation site.

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

  // §199A(e)(2): the SSTB phase-out is keyed to TAXABLE INCOME computed without
  // regard to §199A (Form 8995-A "taxable income before the QBI deduction" =
  // post-NOL, pre-QBI taxable income) — NOT AGI. This MUST use the same base as
  // the §199A(b)(2)(B) wage/UBIA limit (calculateQbi's taxableIncomeBeforeQbi =
  // taxableAfterNol, below) so the two §199A mechanics can never diverge. Keying
  // off AGI (which exceeds taxable income by the std/itemized + OBBBA deductions)
  // phased SSTB owners — doctors, lawyers, consultants, financial advisors — out
  // of the deduction too early, under-stating QBI and over-stating their tax.
  // Computed unconditionally; APPLIED only to the SSTB QBI portion (0 for non-
  // SSTB returns), so it is a no-op when no business is an SSTB.
  let sstbPhaseFraction = 1;
  if (taxableAfterNol >= phaseIn.end) {
    sstbPhaseFraction = 0;
  } else if (taxableAfterNol > phaseIn.start) {
    sstbPhaseFraction =
      (phaseIn.end - taxableAfterNol) / (phaseIn.end - phaseIn.start);
  }

  // Per-business SSTB split: the Sch C QBI is SSTB when schCIsSstb; each K-1's
  // SSTB QBI is in k1QbiSstbPortion. Phase-out applies to the SSTB portion only;
  // the non-SSTB portion keeps full QBI (subject to the wage/UBIA limit below).
  // Equivalent to the prior whole-QBI × fraction for the pure-Sch-C-SSTB case.
  const totalQbiRaw = qbiIncomeEffective + k1QbiContributionEffective;
  const sstbQbiPortion = (schCIsSstb ? Math.max(0, qbiIncomeEffective) : 0) + k1QbiSstbPortion;
  const nonSstbQbiPortion = totalQbiRaw - sstbQbiPortion;
  const qbiCombinedIncome = nonSstbQbiPortion + sstbQbiPortion * sstbPhaseFraction;
  // K-1 §199A wage/UBIA limit inputs — aggregate the CPA-supplied §199A W-2
  // wages + UBIA across the year's K-1s. Positive values opt into the engine
  // applying the §199A(b)(2)(B) limit above the income threshold; 0/absent
  // preserves the simplified 20% (CPA applies the limit externally).
  const k1Section199aW2Wages = k1sForYear.reduce(
    (s, k) => s + Math.max(0, toNum(k.section199aW2Wages)), 0);
  const k1Section199aUbia = k1sForYear.reduce(
    (s, k) => s + Math.max(0, toNum(k.section199aUbia)), 0);

  // FED-04 / P2-4 — Form 8995-A per-business wage/UBIA limit. Build one entry per
  // qualified business (Sch C + each K-1 with positive QBI), each carrying its
  // POST-SSTB-phase QBI and its OWN §199A W-2 wages / UBIA, so the wage/UBIA
  // limit is applied per business and the limited deductions summed — the
  // correct §199A(b)(1)/Form 8995-A treatment. The sum of per-business QBI
  // equals qbiCombinedIncome by construction, so a single business (or a return
  // with no supplied wage data) reproduces the aggregate path EXACTLY. Sch C
  // §199A wages/UBIA come from optional `qbi_w2_wages`/`qbi_ubia` adjustments
  // (a sole prop WITH employees); default 0 → Sch C stays unlimited (escape).
  const phaseQbi = (raw: number, isSstb: boolean) => (isSstb ? raw * sstbPhaseFraction : raw);
  const qbiBusinesses: Array<{ qbiIncome: number; w2Wages: number; ubia: number; label?: string }> = [];
  if (qbiIncomeEffective > 0) {
    qbiBusinesses.push({
      qbiIncome: phaseQbi(qbiIncomeEffective, schCIsSstb),
      w2Wages: Math.max(0, sumByType("qbi_w2_wages")),
      ubia: Math.max(0, sumByType("qbi_ubia")),
      label: "Schedule C",
    });
  }
  {
    // Mirror the aggregate effective-QBI logic per K-1: explicit §199A QBI wins;
    // otherwise the Box 1/2/3 auto-default applies only when NO K-1 supplied an
    // explicit figure (matches k1QbiContributionEffective above).
    const useK1Auto = k1QbiContribution <= 0;
    for (const k of k1sForYear) {
      const explicitQbi = toNum(k.section199aQbi);
      let raw = 0;
      if (explicitQbi > 0) raw = explicitQbi;
      else if (useK1Auto && (k.activityType ?? "active") !== "passive") {
        raw = Math.max(0, toNum(k.box1OrdinaryIncome) + toNum(k.box2RentalRealEstate) + toNum(k.box3OtherRentalIncome));
      }
      if (raw <= 0) continue;
      qbiBusinesses.push({
        qbiIncome: phaseQbi(raw, k.isSstb === true),
        w2Wages: Math.max(0, toNum(k.section199aW2Wages)),
        ubia: Math.max(0, toNum(k.section199aUbia)),
        label: k.entityName ?? undefined,
      });
    }
  }

  const qbi = calculateQbi({
    qbiIncome: qbiCombinedIncome,
    // FED-04: cap base is POST-NOL taxable income, per Form 8995 Line 11.
    taxableIncomeBeforeQbi: taxableAfterNol,
    // §199A(e)(3): the taxable-income limit is 20% of (taxable income − net
    // capital gain), where net capital gain = preferential LTCG + qualified
    // dividends. Omitting it lets QBI wrongly shelter preferential-rate income.
    netCapitalGain: ltcgPreferential + qualifiedDividends,
    // §199A(b)(2)(B) wage/UBIA limit (K-1 depth) — only binds above the threshold.
    // Aggregate values kept for the no-perBusiness fallback path; perBusiness
    // (when non-empty) supersedes them with the per-business §199A(b)(1) limit.
    w2Wages: k1Section199aW2Wages,
    ubia: k1Section199aUbia,
    perBusiness: qbiBusinesses,
    filingStatus: client.filingStatus,
    taxYear,
  });

  const taxableAfterQbi = Math.max(0, taxableAfterNol - qbi.finalDeduction);

  // OBBBA Schedule 1-A deductions (TY2025–2028): tips §224 / overtime §225 /
  // car-loan interest §163(h)(4) / senior §151(d). Flow to Form 1040 line 13b —
  // they reduce TAXABLE income (subtracted from AGI alongside the std/itemized
  // deduction + QBI), NOT AGI; their MAGI phase-out base is AGI (no circularity).
  // They offset the ORDINARY portion (the preferential LTCG/QDIV is preserved).
  const obbbaDeductions = calculateObbbaSchedule1ADeductions({
    taxYear,
    filingStatus: client.filingStatus,
    magi: calc.adjustedGrossIncome,
    qualifiedTips: sumByType("qualified_tips"),
    qualifiedOvertime: sumByType("qualified_overtime"),
    qualifiedCarLoanInterest: sumByType("qualified_car_loan_interest"),
    taxpayerAge: client.taxpayerAge,
    spouseAge: client.spouseAge,
  });
  const taxableAfterObbba = Math.max(0, taxableAfterQbi - obbbaDeductions.total);

  // ── Step 6: Federal tax (ordinary + preferential) ──────────────────
  // Use post-netting LTCG (not raw 1099-B value) for preferential calculation.
  // AFTER the §163(d)(4)(B) election: the elected QDIV/LTCG has been re-bucketed
  // to ordinary rates, so the preferential income (and the ordinary portion that
  // derives from it) reflect the election.
  const preferentialIncome = ltcgPreferentialAfterElection + qualifiedDividendsAfterElection;
  // SIGNED ordinary portion (may be NEGATIVE when the std/itemized deduction +
  // QBI + OBBBA deductions exceed ordinary income — e.g. a return living mostly
  // off LTCG/QDIV). calculateFederalTaxWithCapitalGains floors this to 0 for the
  // ordinary-tax computation but needs the negative to apply the QDCGT line-10
  // cap (preferential income is limited to taxable income). Do NOT Math.max(0)
  // here or the unused deduction is lost and the return is over-taxed.
  const ordinaryPortionOfTaxable = taxableAfterObbba - preferentialIncome;

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
  // T1.1a — assemble the Schedule D Tax Worksheet special-rate buckets from all
  // three channels: per-transaction tags (capTxn*), aggregate adjustments, and
  // the Form 4797 output (T1.1b — `form4797.unrecaptured1250Gain`). Each is a
  // SUBSET of the net long-term gain, so bound the total to the post-election
  // net LTCG (never letting §1250/28% consume the QDIV portion, which is always
  // 0/15/20). When a capital loss / §163(d)(4)(B) election erodes net LTCG below
  // the sum of the two buckets, the loss offsets the 28% gain FIRST and only the
  // excess reduces the §1250 pool (IRS 28%-Rate-Gain + Unrecaptured-§1250
  // worksheets, Sched D lines 18/19 — taxpayer-favorable since 28% > 25%). So
  // §1250 takes first claim on the available LTCG; collectibles get the remainder.
  const rawUnrecaptured1250 =
    capTxnUnrecaptured1250 +
    Math.max(0, sumByType("unrecaptured_section_1250_gain")) +
    Math.max(0, form4797.unrecaptured1250Gain);
  const rawCollectibles28 =
    capTxnCollectibles28 + Math.max(0, sumByType("collectibles_28_rate_gain"));
  const ltAvailableForSpecial = Math.max(0, ltcgPreferentialAfterElection);
  // F3 (audit 2026-06-08) — apply the worksheet's LOSS ABSORPTION explicitly, not
  // just a min(raw, netLTCG) bound. A net STCL + LT loss carryover offsets the
  // 28% bucket FIRST, then spills onto §1250 (28%-Rate-Gain + Unrecaptured-§1250
  // worksheets). The prior bound let a plain 0/15/20 gain "shield" the special
  // buckets from the loss (over-charging — e.g. §1250 $30k + collectible $20k +
  // plain $50k − $40k loss gave §1250 $30k/28% $20k instead of the correct
  // §1250 $10k/28% $0). totalLtLossAbsorbed = the loss the LT pool absorbed,
  // computed as the gross POSITIVE LT gain minus the surviving net LTCG. Using
  // max(0,·) on each component UNDER-counts the gross when a component is itself
  // net (so it can only UNDER-state the loss → over-charge, the safe direction).
  const grossPositiveLt =
    Math.max(0, form1099Summary.longTermCapitalGains) + Math.max(0, k1Ltcg) +
    homeSaleTaxableGain + qsbsTaxableGain + section1031RecognizedGain +
    Math.max(0, longTermCapitalGainAdj) + Math.max(0, form4797.netSection1231LtcgGain);
  const totalLtLossAbsorbed = Math.max(0, grossPositiveLt - ltAvailableForSpecial);
  const loss28 = Math.min(totalLtLossAbsorbed, rawCollectibles28);
  const collectibles28AfterLoss = rawCollectibles28 - loss28;
  const unrecaptured1250AfterLoss = Math.max(0, rawUnrecaptured1250 - (totalLtLossAbsorbed - loss28));
  // Then cap at the available net LTCG (§1250 takes first claim; QDIV stays 0/15/20).
  const unrecaptured1250Bounded = Math.min(unrecaptured1250AfterLoss, ltAvailableForSpecial);
  const collectibles28Bounded = Math.min(
    collectibles28AfterLoss,
    Math.max(0, ltAvailableForSpecial - unrecaptured1250Bounded),
  );
  const capGains = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: ordinaryPortionOfTaxable,
    longTermGains: ltcgPreferentialAfterElection,
    qualifiedDividends: qualifiedDividendsAfterElection,
    shortTermGains: 0, // post-netting STCG already in ordinaryPortionOfTaxable
    filingStatus: client.filingStatus,
    taxYear,
    // T1.1a — unrecaptured §1250 (25% cap) + 28%-rate gain buckets.
    unrecaptured1250Gain: unrecaptured1250Bounded,
    collectibles28Gain: collectibles28Bounded,
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
  // saltDeductible (state income/property/sales tax — year-indexed getSaltCap:
  // TCJA $10k for TY2024; OBBBA $40k for TY2025+ with the >$500k-MAGI phase-down).
  // The `amt_state_tax_addback_override` adjustment, when > 0, replaces the
  // auto value (rare cases — different AMT SALT figure than Schedule A).
  // When taking the standard deduction, no SALT was deducted → addback = 0.
  const autoSaltAddback = useItemizedDeductions ? scheduleA.saltDeductible : 0;
  const saltAddbackForAmt = amtStateTaxAddbackOverride > 0
    ? amtStateTaxAddbackOverride
    : autoSaltAddback;
  // Form 6251 line 2e — a taxable state/local refund (§111) included in regular
  // taxable income is NOT income for AMT (the underlying state-tax deduction was
  // never allowed for AMT, so refunding it can't be AMT income). Remove it from
  // the AMT base as a NEGATIVE adjustment. (Only nonzero when the filer itemized
  // last year → taxableStateRefund > 0.)
  // Total Form 6251 AMTI adjustment = legacy catch-all + ISO bargain + SALT
  // addback (line 2g) + MACRS-vs-ADS depreciation (line 2i, ±) − taxable state
  // refund (line 2e) + §57(a)(7) 7%-of-excluded §1202 QSBS preference (50%/75%).
  // NOTE: this shared total feeds BOTH the federal AMT and the CA/MN state-AMT
  // approximation (Schedule P 540 etc.), so it deliberately EXCLUDES the
  // federal standard-deduction addback (which is federal-specific — the states
  // add back their OWN std deduction). The std-ded addback is folded in only
  // for the federal `calculateAmt` call below.
  const totalAmtPreferences =
    amtPreferencesLegacy + amtIsoBargainElement + saltAddbackForAmt +
    amtDepreciationAdjustment - taxableStateRefund + qsbs1202AmtPreference;
  // Form 6251 line 2a — the standard deduction is NOT allowed for AMT
  // (IRC §56(b)(1)(E)): a non-itemizer adds it back to reach AMTI. (Line 2a is
  // EITHER the std deduction (non-itemizers) OR the SALT addback (itemizers,
  // line 2g) — mutually exclusive, which is why this is gated on
  // !useItemizedDeductions and saltAddbackForAmt is already 0 for them.)
  // Uses calc.standardDeduction so the §63(f) age-65/blind add-ons are included.
  // FEDERAL-ONLY (not shared with the state-AMT base). (Audit 2026-06-08 F2 —
  // std-deduction filers who hit AMT had federal AMTI understated by the full
  // standard deduction.)
  const stdDeductionAddbackForAmt = useItemizedDeductions ? 0 : calc.standardDeduction;
  // F-4 (audit 2026-06-11) — 2025 Form 6251 line 1b: the OBBBA §151(d) enhanced
  // senior deduction ($6,000 per 65+ individual, Schedule 1-A) is "treated as a
  // personal exemption" (OBBBA §70103 places it in §151(d)) and §56(b)(1)(E)
  // disallows §151 personal-exemption deductions for AMT — so it is ADDED BACK
  // to AMTI (the 2025 Form 6251 split line 1 into 1a/1b for exactly this
  // add-back; 2025 Instructions for Form 6251, What's New). The OTHER three
  // OBBBA Schedule 1-A deductions (tips §224 / overtime §225 / car-loan
  // interest §163(h)(4)) are NOT §151 deductions and have no §56(b) add-back —
  // they reduce AMTI like any other deduction. FEDERAL-ONLY (the state-AMT
  // approximation keeps the shared totalAmtPreferences — states add back their
  // own items). Inert for TY2024 / non-senior returns (senior = 0).
  const seniorDeductionAddbackForAmt = obbbaDeductions.senior;
  const federalAmtPreferences =
    totalAmtPreferences + stdDeductionAddbackForAmt + seniorDeductionAddbackForAmt;

  const amt = calculateAmt({
    taxableIncome: taxableAfterObbba,
    amtPreferences: federalAmtPreferences,
    // K3 — Form 6251 Part III: preserve LTCG/QDIV preferential rates inside AMT.
    // Closed 2026-05-24; previously the engine over-charged AMT on
    // high-LTCG + AMT-binding filers by taxing LTCG at 26/28%.
    ltcgPlusQdiv: preferentialIncome,
    // T1.1a — Form 6251 Part III also taxes unrecaptured §1250 at 25% and the
    // 28%-rate gain at 28% (not 0/15/20%). Pass the same bounded buckets the
    // regular-tax Schedule D worksheet used, so AMT doesn't under-state TMT.
    unrecaptured1250Gain: unrecaptured1250Bounded,
    collectibles28Gain: collectibles28Bounded,
    // T1.0(l) — Form 6251 Part III reads the regular Schedule D Tax Worksheet's
    // line 13/10/14/21 amounts (its lines 13/15/20/27) to position the AMT
    // 0%/15% zones on the REGULAR stack and to carve out ANCG + §1250 (not
    // collectibles). Only produced when the special buckets ran the worksheet.
    // NOT passed when FEIE > 0: the worksheet lines are FEIE-inflated and AMT
    // doesn't model FEIE — the simplified Part III path is closer there.
    schedDWorksheet: feieExclusion > 0 ? undefined : capGains.schedDWorksheet,
    // ATNOLD (§56(d)) — AMT-basis NOL carryforward, capped at 90% of AMTI.
    amtNolCarryforward,
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
  // FC-12 — the structured investment-income components, SHARED between the
  // §1411 NIIT base and the §32(i) EITC disqualifying-income base (which adds
  // tax-exempt interest and skips the two §1411-only items — see the EITC
  // block below).
  const investmentIncomeStructuredComponents =
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
    // Rents — passive for the ordinary landlord; excluded for RE professionals.
    // T1.2 (MEDIUM-1, independent review 2026-06-09) — a FULLY-DISPOSED passive
    // rental's positive current-year operating net flows to AGI via
    // section469gAgiEffect (not rentalNetAppliedToAgi), so it must be added to
    // the §1411 NII base too (it's net investment income up to disposition).
    // Only the positive net is NII; a §469(g)-released loss stays out (floored).
    (niitRentalIsNonPassive ? 0 : form1099Summary.rents + Math.max(0, rentalNetAppliedToAgi) + Math.max(0, disposedRentalNet)) +
    // Passive pass-through income (engine already segregates active vs passive):
    Math.max(0, k1PassiveAppliedToAgi) +
    // Net gain on disposition: post-netting positive LTCG + STCG (already
    // folds in 1099-B, K-1 Box 8/9a, §121 remainder, §1031 recognized, QSBS):
    ltcgPreferential +
    stcgInOrdinary;
  // §1411(c)(1): a §1231 gain from a NON-passive (materially-participated)
  // trade/business is NOT net investment income. Excluded when the CPA flags
  // the Form 4797 disposition `nonPassive` (default off → conservatively
  // included, matching the ordinary-landlord rental treatment above).
  // Audit 2026-06-08 C2: cap the exclusion at the net disposition gain
  // actually in the NII base. Without the cap, a separate capital loss that
  // eroded post-netting LTCG below the gross §1231 figure let the GROSS
  // subtraction drive the base negative and (after the max(0,…) floor) wipe
  // out unrelated NII (interest/dividends) → under-stated NIIT. The §1231
  // gain can never have contributed more than the surviving net disposition
  // gain. (Residual sub-gap: when OTHER long-term gain also survives, the
  // exact §1231-vs-other loss split isn't tracked — this cap over-includes,
  // the safe NIIT direction.)
  // FC-12 note: this carve is §1411-ONLY — §32(i)(2)(D) counts capital gain
  // net income (§1222(9)) regardless of passivity, so the EITC base uses the
  // components total WITHOUT this subtraction.
  const nonPassiveSection1231NiitCarve = Math.min(
    form4797.nonPassiveSection1231Gain,
    Math.max(0, ltcgPreferential + stcgInOrdinary),
  );
  // The generic `investment_income` adjustment is the §1411 CATCH-ALL (its
  // label is "Investment Income (NIIT)") — per §1411(c)(1)(A)(i) it may carry
  // ANNUITY income, which §32(i) does not count, so it joins the NIIT base
  // only (FC-12).
  const totalInvestmentIncomeForNiit = Math.max(
    0,
    investmentIncomeFromAdj + investmentIncomeStructuredComponents +
      // F-10 — non-qualified annuity income (1099-R Box 7 code "D").
      // §1411(c)(1)(A)(i) includes gross income from annuities other than
      // §401/§403/§408 qualified plans; Form 8960 line 3 + Pub 575: include
      // the Box 2a taxable amount when Box 7 shows code D. All OTHER 1099-R
      // income stays excluded (§1411(c)(5) qualified-plan distributions).
      // §1411-ONLY: §32(i) does NOT count annuities, so this term joins the
      // NIIT base here, never the shared structured components (FC-12).
      form1099Summary.nonQualifiedAnnuityIncome -
      // F-8 — Form 8960 line 5a is the net gain OR LOSS as included in AGI
      // (1040 line 7), i.e. AFTER the §1211(b) $3,000/$1,500 limitation — so
      // the ALLOWED net capital loss (capitalLossDeducted, a positive number
      // capped at 3,000/1,500) REDUCES the other investment income. In the
      // net-loss branch ltcgPreferential = stcgInOrdinary = 0, so the capital
      // component is exactly −capitalLossDeducted; total NII stays floored at
      // 0 by the surrounding Math.max (NIIT cannot go negative). §1411-ONLY:
      // §32(i)(2)(D) counts capital-GAIN net income (a positive-only concept),
      // so the EITC base never subtracts the allowed loss (FC-12).
      capitalLossDeducted -
      nonPassiveSection1231NiitCarve,
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
        // PREP-B1 (lane C) — opt-in IT-203/540NR income-% method for the resident-
        // period tax in method-(a) states.
        incomePctMethod: sumByType("part_year_income_pct_method") > 0,
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

  // PREP-B1 — FULL-YEAR NON-RESIDENT per-type source allocation. When the CPA sets
  // the `nonresident_source_allocation` marker on a FULL-YEAR resident (NOT part-year
  // — the part-year path uses perStateOtherSourced above), aggregate the filer's
  // out-of-state BUSINESS + REAL-PROPERTY income by sourceState. This populates the
  // calculateMultiStateTax `perStateNonResidentOtherSourced` option, so a non-resident
  // state with K-1 business / rental real-estate source (but no wages there) is taxed
  // via the IT-203/540NR method-(a) states or the conservative direct-bracket fallback.
  // Per 4 U.S.C. §114 ONLY business income (K-1 Box 1) + rental real estate (K-1 Box
  // 2/3 + rentalProperties net) are NR-sourceable; the K-1's interest/dividends/
  // royalties/STCG/LTCG are intangibles (§114(a)) and retirement is §114(b) — NEVER
  // auto-sourced. Source states equal to the resident state are skipped (covered by
  // the resident calc). The amount is the SOURCE attribution only; it does not change
  // federal AGI (which already includes the income).
  let perStateNonResidentOtherSourced: Record<string, number> | undefined;
  if (sumByType("nonresident_source_allocation") > 0 && !partYearResidencyArg) {
    perStateNonResidentOtherSourced = {};
    const residentCode = (stateCode ?? "").toUpperCase();
    const addNr = (src: string | null | undefined, amount: number): void => {
      const c = (src ?? "").toUpperCase();
      if (!c || c === residentCode || amount <= 0) return;
      perStateNonResidentOtherSourced![c] = (perStateNonResidentOtherSourced![c] ?? 0) + amount;
    };
    for (const k of inputs.scheduleK1 ?? []) {
      if (k.taxYear !== taxYear) continue;
      // Business (Box 1) + rental real estate (Box 2/3) only — NOT the K-1's
      // intangible interest/dividends/royalties/cap-gains (§114(a)).
      addNr(
        k.sourceState,
        toNum(k.box1OrdinaryIncome) + toNum(k.box2RentalRealEstate) + toNum(k.box3OtherRentalIncome),
      );
    }
    for (const p of inputs.rentalProperties ?? []) {
      if (p.taxYear !== taxYear) continue;
      const propIncome = toNum(p.rentalIncome);
      const propExpenses = toNum(p.totalExpenses);
      let propDepreciation = 0;
      if (
        toNum(p.basis) > 0 &&
        (p.placedInServiceYear ?? 0) > 0 &&
        (p.placedInServiceMonth ?? 0) >= 1 &&
        (p.placedInServiceMonth ?? 0) <= 12
      ) {
        propDepreciation = calculateMacrsDepreciation({
          basis: toNum(p.basis),
          propertyType: p.propertyType === "commercial" ? "commercial" : "residential",
          monthPlacedInService: p.placedInServiceMonth ?? 1,
          yearPlacedInService: p.placedInServiceYear ?? taxYear,
          taxYear,
        }).currentYearDepreciation;
      }
      addNr(p.sourceState, propIncome - propExpenses - propDepreciation);
    }
    // PREP-B1 (lane C) — real-property capital GAIN by situs. A disposition of
    // real/tangible property physically located in a state is NR-sourced to that
    // state (situs rule); the CPA tags it with `propertyStateSitus`. Intangible
    // gains (stocks/bonds) carry no situs and are never sourced (§114(a)). The
    // sourced amount is the positive per-transaction gain (proceeds − basis +
    // adjustment); the gain is already in federal AGI via Schedule D.
    for (const t of inputs.capitalTransactions ?? []) {
      if (t.taxYear !== taxYear) continue;
      const situs = (t.propertyStateSitus ?? "").toUpperCase();
      if (!situs) continue;
      const gain = toNum(t.proceeds) - toNum(t.costBasis) + toNum(t.adjustmentAmount);
      addNr(situs, Math.max(0, gain));
    }
    if (Object.keys(perStateNonResidentOtherSourced).length === 0) {
      perStateNonResidentOtherSourced = undefined;
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
      // #6 — HI employer-funded pension cap + NY govt-pension full exclusion
      // (CPA-supplied portions; absent → prior behavior).
      hiEmployerFundedPension: sumByType("hi_employer_funded_pension") > 0
        ? sumByType("hi_employer_funded_pension") : undefined,
      nyGovernmentPension: sumByType("ny_government_pension") > 0
        ? sumByType("ny_government_pension") : undefined,
      // CT — non-Roth IRA portion of the retirement bucket (Pension & Annuity
      // Worksheet Line 4b → phased-in 50/75/100% IRA rate). Absent → the whole
      // bucket is pension/annuity (100% base).
      ctIraDistribution: sumByType("ct_ira_distribution") > 0
        ? sumByType("ct_ira_distribution") : undefined,
      // PREP-B1 — full-year non-resident per-type source (K-1 business + rental real
      // estate by sourceState), opt-in via the nonresident_source_allocation marker.
      perStateNonResidentOtherSourced,
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
      // T1.2 — federal tentative minimum tax (Form 6251 line 7) for the CT AMT
      // lesser-of(19%×TMT, 5.5%×AMTI) test.
      federalTentativeMinimumTax: amt.amtBeforeRegular,
      // T1.2 — federal AMT base (Form 6251 line 6 = AMTI − exemption) for the CO
      // AMT (§39-22-105(2)) + CT's 5.5% prong (year/status-accurate, not an AGI proxy).
      federalAmtBase: Math.max(0, amt.amti - amt.exemption),
      // PREP-B1 — state-base modifications: out-of-state muni interest is
      // state-taxable (added); US-Treasury interest is state-exempt (subtracted).
      // CPA-supplied via adjustments; 0 → undefined → no-op.
      muniBondAddBack: sumByType("out_of_state_muni_interest") || undefined,
      // US-Treasury interest is state-exempt: the CPA `us_treasury_interest`
      // adjustment PLUS any 1099-INT Box 3 (now folded into federal taxable
      // interest) — both must be subtracted from the state base.
      usTreasurySubtraction:
        (sumByType("us_treasury_interest") + form1099Summary.usTreasuryInterest) || undefined,
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
      // #7 — OH cross-city resident credit: CPA-supplied municipal tax paid to
      // the WORK city (credited against the resident city's tax).
      ohWorkCityTaxPaid: sumByType("oh_work_city_tax_paid") > 0
        ? sumByType("oh_work_city_tax_paid")
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

  // T1.2 — Schedule H household employment tax (FICA + FUTA on nanny/household
  // employee cash wages). Driven by the `household_employee_cash_wages`
  // adjustment (+ optional `household_employee_futa_wages` override). Schedule 2
  // line 9 — an employment tax, NOT offset by non-refundable income-tax credits.
  const scheduleH: ScheduleHResult = calculateScheduleH({
    cashWages: sumByType("household_employee_cash_wages"),
    taxYear,
    futaWagesOverride: sumByType("household_employee_futa_wages") || undefined,
  });

  const totalFederalLiability =
    regularFederalTax + amt.amtTax + niit.niitTax + se.seTaxTotal + additionalMedicare.additionalMedicareTax +
    // E5 — IRC §72(t) early-withdrawal additional tax (Sched 2 Line 8).
    // Not offset by non-refundable credits per §72(t) statute.
    form1099Summary.earlyWithdrawalPenalty +
    // E4 — IRC §4973(g) 6% excise on HSA contributions over the annual cap.
    // Reported on Form 5329 Part VII. Not offset by non-refundable credits.
    retirement.hsaExcessExcise +
    // T1.2 — Schedule H household employment tax (Sched 2 line 9).
    scheduleH.total;

  const isMfj =
    client.filingStatus === "married_filing_jointly" ||
    client.filingStatus === "qualifying_widow";

  // ── ACA Premium Tax Credit reconciliation (Form 8962) ──
  // Computed BEFORE the nonrefundable-credit cascade because the excess-APTC
  // repayment (Schedule 2 line 2) is part of Form 1040 line 18 — the base the
  // personal credits offset (FC-09, see Step 7 below).
  const acaHouseholdSizeDefault =
    1 +
    (isMfj ? 1 : 0) +
    (client.dependentsUnder17 ?? 0) +
    (client.otherDependents ?? 0);
  const acaHouseholdSize = client.acaHouseholdSize ?? acaHouseholdSizeDefault;
  // FC-23 — §36B(d)(2)(B) household-income MAGI = AGI + tax-exempt interest
  // (§36B(d)(2)(B)(iii)) + the NONTAXABLE portion of Social Security
  // (§36B(d)(2)(B)(ii), gross benefits less the Pub 915 taxable amount —
  // the taxable portion is already inside AGI) + the §911 FEIE exclusion
  // (§36B(d)(2)(B)(i)). Dependents'-own-income inclusion is not modeled.
  const nontaxableSocialSecurity = Math.max(0, ssTaxability.ssBenefits - taxableSocialSecurity);
  const ptcMagi =
    calc.adjustedGrossIncome +
    form1099Summary.taxExemptInterest +
    nontaxableSocialSecurity +
    feieExclusion;
  const premiumTaxCredit = calculatePremiumTaxCredit({
    annualPremium: toNum(client.acaAnnualPremium ?? null),
    annualSlcsp: toNum(client.acaAnnualSlcsp ?? null),
    advanceAptc: toNum(client.acaAdvanceAptc ?? null),
    modifiedAgi: ptcMagi,
    householdSize: acaHouseholdSize,
    filingStatus: client.filingStatus,
    taxYear,
  });
  const netPremiumTaxCreditRefundable = Math.max(0, premiumTaxCredit.netPtc);
  const excessAdvanceAptcOwed = Math.max(0, -premiumTaxCredit.netPtc);

  // ── Step 7: Non-refundable credits in IRS Sched 3 order ──
  const incomeTaxOnly = regularFederalTax + amt.amtTax;
  // FC-09 — the nonrefundable-credit base is Form 1040 line 18 = line 16
  // (tax) + Schedule 2 line 3 (AMT + the EXCESS-APTC REPAYMENT, Sch 2 line 2).
  // §36B(f)(2)(A) makes the repayment an increase in chapter-1 tax and it is
  // not in the §26(b)(2) exclusion list, so every personal-credit limit
  // worksheet (2441, 8863, 8880, 5695, 8839, Sch 8812 CLW-A, 3800) starts
  // from line 18 — credits DO offset the clawback. (SE tax/NIIT/Additional
  // Medicare/§72(t)/§4973(g)/Sch H stay outside the base per §26(b).)
  let availableForNonRefundable = incomeTaxOnly + excessAdvanceAptcOwed;

  const earnedIncomeHousehold = totalWages + Math.max(0, netSeIncome - se.deductibleHalf);
  // C1 (audit 2026-06-08): the CTC is computed/applied AFTER the Schedule-3
  // personal credits (FTC, dependent care, education, Saver's, energy, adoption)
  // — see below. Per the Schedule 8812 Credit Limit Worksheet, the CTC's
  // nonrefundable limit = tax AFTER those credits, so they get first claim on
  // the tax; the CTC fills the residual and its UNUSED nonrefundable portion
  // spills to the refundable ACTC. Applying the CTC first (the prior behavior)
  // let it absorb all the tax and WASTE the non-carryforward dependent-care /
  // education credits.

  // ── EITC (computed early — the FC-13 ACTC Part II-B alternative needs it
  // before the CTC; nothing in the EITC depends on the credit cascade) ──
  // FED-06 — §32(i)(2) EITC disqualifying-investment-income cliff. Unlike the
  // §1411 NIIT base, §32(i)(2)(B) COUNTS tax-exempt interest, so add it back.
  // FC-12 — two deliberate divergences from the NIIT base:
  //   (a) the generic `investment_income` (NIIT) catch-all adjustment is
  //       EXCLUDED — §1411(c)(1)(A)(i) includes ANNUITY income in NII but
  //       §32(i)(2) does not, and the catch-all is the engine's only annuity
  //       path (all §32(i) components — interest, dividends, rents,
  //       royalties, gains, passive income — flow in via their structured
  //       buckets). 1099-R retirement distributions were never in either base.
  //   (b) the non-passive §1231 carve does NOT apply — §32(i)(2)(D) counts
  //       "capital gain net income" (§1222(9)) regardless of passivity, so
  //       the gross components (before the §1411-only carve) are used.
  const eitcDisqualifyingIncome =
    Math.max(0, investmentIncomeStructuredComponents) + form1099Summary.taxExemptInterest;
  const eitc = calculateEitc({
    filingStatus: client.filingStatus,
    // E1 — EITC qualifying children (§32(c)(3): <19, or <24 student) is a WIDER
    // set than the CTC's <17. Default to dependentsUnder17 when not specified.
    qualifyingChildren: client.eitcQualifyingChildren ?? client.dependentsUnder17 ?? 0,
    earnedIncome: earnedIncomeHousehold,
    agi: calc.adjustedGrossIncome,
    investmentIncome: eitcDisqualifyingIncome,
    taxYear,
    // FC-12 — §32(c)(1)(C) Form 2555 bar: any positive foreign_earned_income
    // adjustment means the FEIE is being claimed → no EITC.
    claimsForeignEarnedIncomeExclusion: feieGrossForeignIncome > 0,
    // FC-12 — §32(c)(1)(A)(ii)(II) 25–64 age window for childless claimants
    // (either spouse satisfies it on a joint return; null ages preserve the
    // pre-gate behavior — the engine can't verify what it isn't told).
    taxpayerAge: client.taxpayerAge ?? null,
    spouseAge: client.spouseAge ?? null,
  });

  // P2-3 — combine current-year foreign tax with the prior-year §904(c)
  // carryover before applying the Form 1116 limit. The §904 limit is computed
  // on the combined amount; the excess becomes next year's carryforward.
  const foreignTaxCombinedPaid = Math.max(0, foreignTaxPaidAdj) + Math.max(0, foreignTaxCreditCarryforwardAdj);
  const foreignTaxCredit = calculateForeignTaxCredit({
    foreignTaxPaid: foreignTaxCombinedPaid,
    filingStatus: client.filingStatus,
    // Form 1116 limit inputs — only meaningful when foreignTaxPaid exceeds the
    // simplified $300/$600 limit. Otherwise the calculator ignores them.
    // totalTaxableIncome is Form 1040 Line 15 (taxable income).
    // preCreditUsTax is the federal income tax before any credits
    // (= 1040 Line 16 + Line 17 = regular tax + AMT).
    foreignSourceTaxableIncome: foreignSourceTaxableIncomeAdj > 0 ? foreignSourceTaxableIncomeAdj : undefined,
    totalTaxableIncome: taxableAfterObbba,
    preCreditUsTax: incomeTaxOnly,
  });
  const foreignTaxApplied = Math.min(foreignTaxCredit.credit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - foreignTaxApplied);
  // P2-3 — §904(c) carryforward to next year = combined foreign tax in excess of
  // the §904 limit (= combined − the limited credit). Keyed to the §904 limit,
  // NOT the engine's credit-ordering room (a sub-gap for the rare case where
  // other nonrefundable credits fully absorb the tax). 10-year vintage not
  // tracked (consistent with the charitable 5-year carryforward).
  const foreignTaxCreditCarryforwardRemaining = Math.max(0, foreignTaxCombinedPaid - foreignTaxCredit.credit);

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
    // FC-14 — §25A(d)(3) MAGI = AGI + the §911/§931/§933 exclusions (Form
    // 8863 lines 3/14). The engine's AGI excludes the FEIE (K9), so add it
    // back here — same pattern as NIIT/IRA/SLI/adoption.
    agi: calc.adjustedGrossIncome + feieExclusion,
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
    // FC-14 — §25B(e) MAGI = AGI + the §911/§931/§933 exclusions.
    agi: calc.adjustedGrossIncome + feieExclusion,
    retirementContributions: totalRetirementContribsForSavers,
    taxYear,
    // FC-15 — §25B(c)(2)(B): a filer claimed as a dependent on another
    // return is ineligible. (The §25B(c)(2)(A) full-time-student bar has no
    // engine field — CPA-verified, documented in the Form 8880 workpaper.)
    claimedAsDependent: client.claimedAsDependent ?? false,
  });
  const saversApplied = Math.min(saversCredit.appliedCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - saversApplied);

  // Residential energy + EV charger. FC-02: the calculator zeroes §25C/§25D
  // for TY2026+ (OBBBA §§70505–70506 terminations).
  const residentialEnergy = calculateResidentialEnergyCredits({
    cleanEnergySpend: residentialCleanEnergyAdj,
    efficientHomeSpend: energyEfficientHomeAdj,
    heatPumpSpend: energyEfficientHeatpumpAdj,
    evChargerSpend: evChargerPropertyAdj,
    taxYear,
  });
  // FC-11 — ONLY §25C (line 5b) and §30C stay ahead of the CTC: the Schedule
  // 8812 Credit Limit Worksheet A line 2 subtracts "Schedule 3, lines 1–4,
  // 5b, 6c, 6g, 6h" — §25C is line 5b, but the §25D residential clean energy
  // credit (line 5a) is NOT in that list. §25D's own Form 5695 credit-limit
  // worksheet subtracts Form 1040 line 19 (the CTC), i.e. §25D sequences
  // AFTER the CTC, with its excess carried forward under §25D(c) — applied
  // below the CTC. (Applying §25D first let it eat the tax, shrink the CTC's
  // nonrefundable slice, and inflate the refundable ACTC — converting a
  // carryforward-only credit into current refundable cash.)
  const efficientHomeApplied = Math.min(residentialEnergy.efficientHomeCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - efficientHomeApplied);
  const heatPumpApplied = Math.min(residentialEnergy.heatPumpCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - heatPumpApplied);
  const evChargerApplied = Math.min(residentialEnergy.evChargerCredit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - evChargerApplied);

  // P2-13 — Adoption Credit (Form 8839, IRC §23) — Sched 3 Line 6c. Applied
  // after the other pre-CTC personal credits (which mostly don't carry
  // forward) so they absorb tax first; the §23 credit takes the remaining room
  // and carries any unused nonrefundable portion forward 5 years (§23(c)). The
  // OBBBA refundable portion (TY2025+) is added to the refundable-credit total
  // below. Placed before the §53 AMT credit so §53(c)'s own limit nets §23 out.
  // MAGI = AGI + FEIE add-back per §23(b)(2)(B) (mirrors the §36B PTC MAGI).
  const adoptionCredit = calculateAdoptionCredit({
    qualifiedExpenses: sumByType("qualified_adoption_expenses"),
    specialNeeds: sumByType("adoption_special_needs") > 0,
    priorCarryforward: sumByType("adoption_credit_carryforward"),
    magi: calc.adjustedGrossIncome + feieExclusion,
    filingStatus: client.filingStatus,
    availableTax: availableForNonRefundable,
    taxYear,
  });
  availableForNonRefundable = Math.max(0, availableForNonRefundable - adoptionCredit.nonRefundableApplied);

  // FC-13 — Schedule 8812 Part II-B inputs (3+ qualifying children): the
  // refundable ACTC floor is the LARGER of the 15% formula and (SS/Medicare
  // taxes paid − EIC). Line 21+22 equivalent: employee FICA modeled from W-2
  // boxes 3/5 (6.2% of SS wages capped at the year's wage base — per-spouse
  // for MFJ, which also nets out the Sch 3 line 11 excess-SS subtraction of
  // line 24 — plus 1.45% of Medicare wages) + the Form 8959 0.9% Additional
  // Medicare liability + the Schedule 1 line 15 deductible ½ SE tax.
  // (Sch 2 lines 5/6/13 unreported/uncollected FICA are not modeled.)
  const ssWageBaseForActc = SS_WAGE_BASE[resolvedMapYear];
  const employeeSsTaxForActc = isMfj
    ? 0.062 * (Math.min(w2SsByTaxpayer, ssWageBaseForActc) + Math.min(w2SsBySpouse, ssWageBaseForActc))
    : 0.062 * Math.min(w2SocialSecurityWages, ssWageBaseForActc);
  const ssMedicareTaxesPaidForActc =
    employeeSsTaxForActc +
    0.0145 * w2MedicareWages +
    additionalMedicare.additionalMedicareTax +
    se.deductibleHalf;

  // C1 — Child Tax Credit (Schedule 8812), applied here AFTER the Schedule-3
  // personal credits (FTC/dep-care/education/Saver's/§25C-§30C energy/adoption)
  // per the Credit Limit Worksheet: `taxBeforeCredit` is the tax remaining
  // after those, so the CTC fills only the residual and the maximum amount
  // spills to the refundable ACTC. (The §25D clean-energy credit, the §53 AMT
  // credit + §38 GBC below are NOT subtracted in the CTC limit worksheet —
  // Sch 8812 CLW subtracts Schedule 3 lines 1–4, 5b, 6c, 6g, 6h but NOT 5a/
  // 6a/6b — so the CTC takes priority over them; they apply against what's
  // left after the CTC.)
  const ctc = calculateChildTaxCredit({
    qualifyingChildren: client.dependentsUnder17 ?? 0,
    otherDependents: client.otherDependents ?? 0,
    // FC-14 — §24(b)(1) MAGI = AGI + the §911/§931/§933 exclusions (Sch 8812
    // lines 2a–2d): the engine's AGI excludes the FEIE, so add it back.
    agi: calc.adjustedGrossIncome + feieExclusion,
    filingStatus: client.filingStatus,
    taxYear,
    taxBeforeCredit: availableForNonRefundable,
    earnedIncome: earnedIncomeHousehold,
    // FC-13 — Part II-B alternative (only consulted for 3+ children).
    socialSecurityMedicareTaxesPaid: ssMedicareTaxesPaidForActc,
    eitcApplied: eitc.appliedCredit,
  });
  availableForNonRefundable = Math.max(0, availableForNonRefundable - ctc.nonRefundablePortion);

  // FC-11 — §25D Residential Clean Energy Credit (Sch 3 line 5a), applied
  // AFTER the CTC (see the ordering note above). §25D(c) carryforward:
  // prior-year unused credit (auto-seeded by the pipeline or CPA-entered as
  // `residential_clean_energy_carryforward`) adds to this year's credit; the
  // portion the remaining tax can't absorb carries to next year. A pre-2026
  // carryforward SURVIVES the OBBBA §70506 termination (OBBBA did not amend
  // §25D(c); only post-2025 EXPENDITURES lose the credit — IRS OBBB FAQ /
  // CRS IN12611), which is why the carryforward is added OUTSIDE the
  // calculator's TY2026 zeroing.
  const cleanEnergyCarryforwardIn = Math.max(0, sumByType("residential_clean_energy_carryforward"));
  const cleanEnergyAvailable = residentialEnergy.cleanEnergyCredit + cleanEnergyCarryforwardIn;
  const cleanEnergyApplied = Math.min(cleanEnergyAvailable, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - cleanEnergyApplied);
  const residentialCleanEnergyCarryforward = Math.max(0, cleanEnergyAvailable - cleanEnergyApplied);
  const residentialEnergyApplied =
    cleanEnergyApplied + efficientHomeApplied + heatPumpApplied + evChargerApplied;

  // FC-08/F-2 (audit 2026-06-11) — the §38(c) and §53(c) limits are NET-of-
  // credit limits, and the FORM ordering is §38 (Schedule 3 line 6a, Form
  // 3800) BEFORE §53 (Schedule 3 line 6b, Form 8801):
  //   • §38(c)(1): the GBC may not exceed "net income tax" minus the greater
  //     of TMT or 25% of "net regular tax liability" over $25,000 — where BOTH
  //     net amounts are reduced by the credits allowable under subparts A
  //     (§§21–26 personal credits incl. CTC/§25D/adoption) and B (§27 FTC),
  //     but NOT by the §53 credit (subpart G). (Form 3800 Part II nets the FTC
  //     + "certain allowable credits" out of lines 11/13.)
  //   • §53(c): the MTC may not exceed regular tax reduced by "the credits
  //     allowable under subparts A, B, D, E, and F" — subpart D IS the §38
  //     GBC, so the §53 limit nets the GBC out → §53 is applied AFTER §38.
  //     (Form 8801 Part II mirrors this: "regular income tax liability minus
  //     allowable credits" = 1040 line 16 + Sch 2 line 1z MINUS 1040 line 19
  //     and Schedule 3 lines 1 through 6z — including the 6a GBC, excluding
  //     only the 6b MTC itself and Form 8912.)
  // The personal credits applied above (subparts A + B, incl. the post-CTC
  // §25D) feed both limits:
  const personalCreditsApplied =
    foreignTaxApplied +
    depCareApplied +
    aocNonRefundableApplied +
    llcApplied +
    saversApplied +
    residentialEnergyApplied +
    adoptionCredit.nonRefundableApplied +
    ctc.nonRefundablePortion;

  // P2-15c — R&D Credit (Form 6765 / §41), the general business credit. ASC
  // method (14% over 50% of the prior-3-yr QRE avg; 6% startup) with the
  // §280C(c)(3) reduced election applied by default. Subject to the §38(c)(1)
  // general-business-credit liability limit (see FC-08 above): NET income tax
  // − max(TMT, 25% of NET regular tax liability over $25,000). The excess
  // carries forward (§39, 1-back/20-forward; not vintage-tracked, consistent
  // with the other carryforwards). The §41(h) payroll-tax election (qualified
  // small business → offsets the employer OASDI share, not income tax) is OUT
  // of the individual income-tax engine's scope — documented.
  const rdCredit = calculateRdCredit({
    qualifiedResearchExpenses: sumByType("qualified_research_expenses"),
    priorThreeYearAvgQre: sumByType("qualified_research_expenses_prior_avg"),
  });
  // §39 prior-year general-business-credit carryforward (the §38-disallowed §41
  // credit from a prior year — auto-seeded by the pipeline as `rd_credit_carryforward`).
  // Added to this year's §41 credit before the §38(c) liability limit.
  const rdCreditCarryforwardIn = Math.max(0, sumByType("rd_credit_carryforward"));
  const rdCreditAvailable = rdCredit.credit + rdCreditCarryforwardIn;
  // FC-08 — §38(c)(1)/(2): "net income tax" = (regular tax + AMT) − subpart
  // A/B credits; "net regular tax liability" = regular tax − subpart A/B
  // credits. The engine previously used GROSS incomeTaxOnly for both, which
  // over-allowed the GBC below the statutory floor whenever personal/FTC
  // credits were present.
  const netIncomeTaxFor38 = Math.max(0, incomeTaxOnly - personalCreditsApplied);
  const netRegularTaxFor38 = Math.max(0, regularFederalTax - personalCreditsApplied);
  const section38Limit = Math.max(
    0,
    netIncomeTaxFor38 -
      Math.max(amt.amtBeforeRegular, 0.25 * Math.max(0, netRegularTaxFor38 - 25_000)),
  );
  const rdCreditApplied = Math.min(rdCreditAvailable, availableForNonRefundable, section38Limit);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - rdCreditApplied);
  const rdCreditCarryforwardRemaining = Math.max(0, rdCreditAvailable - rdCreditApplied);

  // P2 — Other CPA-supplied general business credits: §51 Work Opportunity Tax
  // Credit + §45S Employer Paid Family & Medical Leave Credit. Both require
  // employee/wage-level data the individual engine doesn't model, so the CPA
  // supplies the computed credit (Form 5884 / Form 8994); the engine applies it
  // through the SAME §38(c) limit as §41 — against the REMAINING GBC room after
  // §41 — and carries forward the excess (§39). Reported aggregate.
  const wotcCredit = Math.max(0, sumByType("wotc_credit"));
  const fmlaCredit = Math.max(0, sumByType("fmla_credit"));
  // §39 prior-year §51/§45S general-business-credit carryforward (the §38-
  // disallowed credit from a prior year — auto-seeded by the pipeline as
  // `general_business_credit_carryforward`). Added to this year's §51/§45S
  // credits before the §38(c) liability limit (mirrors the §41 rd carryforward).
  const otherGbcCarryforwardIn = Math.max(0, sumByType("general_business_credit_carryforward"));
  const otherGbcAvailable = wotcCredit + fmlaCredit + otherGbcCarryforwardIn;
  const otherGbcApplied = Math.min(
    otherGbcAvailable,
    availableForNonRefundable,
    Math.max(0, section38Limit - rdCreditApplied),
  );
  availableForNonRefundable = Math.max(0, availableForNonRefundable - otherGbcApplied);
  const otherGbcCarryforwardRemaining = Math.max(0, otherGbcAvailable - otherGbcApplied);

  // E2/F-2 — Form 8801 Minimum-Tax Credit (IRC §53). Schedule 3 line 6b —
  // applied LAST among the nonrefundable credits, AFTER the §38 GBC (line 6a),
  // per the §53(c) subpart-D netting + the Form 8801 Part II "regular tax
  // liability minus allowable credits" line (see the FC-08/F-2 citation block
  // above). Three caps stack:
  //   (a) the carryforward balance itself,
  //   (b) the §53(c) limit: (regular tax − ALL other nonrefundable credits
  //       applied this year) − TMT (Form 6251 line 9 = amt.amtBeforeRegular).
  //       Subtracting the credits keeps the §53 credit from pushing net income
  //       tax BELOW TMT (F-2 — the engine previously used GROSS regular tax,
  //       over-applying by up to min(otherCredits, regular − TMT)). When AMT
  //       binds this year, regular < TMT → limit 0 → no credit applies.
  //   (c) the remaining `availableForNonRefundable` (can't reduce below $0).
  const amtCreditCarryforwardIn = sumByType("amt_credit_carryforward");
  const creditsBeforeSection53 = personalCreditsApplied + rdCreditApplied + otherGbcApplied;
  const amtCreditApplicable = Math.max(
    0,
    regularFederalTax - creditsBeforeSection53 - amt.amtBeforeRegular,
  );
  const amtCreditApplied = Math.min(
    amtCreditCarryforwardIn,
    amtCreditApplicable,
    availableForNonRefundable,
  );
  availableForNonRefundable = Math.max(0, availableForNonRefundable - amtCreditApplied);
  // F-3 — §53(b)/(d) generation: ONLY the deferral-item AMT generates a
  // minimum-tax credit. Form 8801 Part I recomputes a "net minimum tax on
  // exclusion items" (the §56(b)(1) personal/itemized adjustments + the
  // §57(a)(7) QSBS preference cause PERMANENT differences and generate no
  // credit); the credit generated = AMT − that. The engine's preference
  // components classify as:
  //   EXCLUSION — SALT addback (2g/2a), standard-deduction addback (2a),
  //     OBBBA senior addback (line 1b, §56(b)(1)(E)), the state-refund
  //     removal (2b, NEGATIVE), the §57(a)(7) QSBS 7% preference, and the
  //     legacy `amt_preferences` catch-all (unclassifiable → treated as
  //     exclusion, the conservative direction: generates NO credit; CPAs
  //     enter ISO/depreciation via their dedicated adjustments or override
  //     next year's `amt_credit_carryforward`).
  //   DEFERRAL — ISO bargain element (2i), the MACRS-vs-ADS depreciation
  //     adjustment (2l, ±), and the ATNOLD (omitted from the exclusion run —
  //     see computeForm8801CreditGeneration).
  const exclusionPreferencesForAmt =
    amtPreferencesLegacy +
    saltAddbackForAmt -
    taxableStateRefund +
    qsbs1202AmtPreference +
    stdDeductionAddbackForAmt +
    seniorDeductionAddbackForAmt;
  const form8801Generation =
    amt.amtTax > 0
      ? computeForm8801CreditGeneration({
          taxableIncome: taxableAfterObbba,
          exclusionPreferences: exclusionPreferencesForAmt,
          amtTax: amt.amtTax,
          regularTax: regularFederalTax,
          filingStatus: client.filingStatus,
          taxYear,
          ltcgPlusQdiv: preferentialIncome,
          unrecaptured1250Gain: unrecaptured1250Bounded,
          collectibles28Gain: collectibles28Bounded,
        })
      : null;
  const amtCreditGenerated = form8801Generation?.adjustedNetMinimumTax ?? 0;
  const amtCreditCarryforwardRemaining = Math.max(
    0,
    amtCreditCarryforwardIn + amtCreditGenerated - amtCreditApplied,
  );

  // ── Step 8: Refundable credits (EITC computed above, pre-CTC — its
  // appliedCredit feeds the Schedule 8812 Part II-B ACTC alternative) ───

  // G1 — NYC EITC sliding scale (NY IT-215 Line 26). Refundable; applied
  // against NYC local tax. Excess refundable portion (when NYC EITC > NYC
  // tax) flows to stateRefundOrOwed alongside state EITC.
  let nycEitcCredit = 0;
  let nycEitcRate = 0;
  let nycEitcRefundableExcess = 0;
  let localTaxLiabilityAfterNycEitc = localTaxLiability;
  // L1b (audit 2026-06-08) — the NYC EIC reduces NYC local tax ONLY. Gate on the
  // NYC locality; without this the credit was wrongly subtracted from EVERY
  // locality's tax (MD counties, PA EIT, OH SDIT, …) for any EITC claimant.
  if (multiState.localTax && eitc.appliedCredit > 0 && (client.localityCode ?? "").toUpperCase() === "NYC") {
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

  // #7 — NYC Unincorporated Business Tax (separate 4% business-level tax on
  // NYC-allocated net unincorporated business income; CPA supplies the amount
  // via the `nyc_ubt_business_income` adjustment). Added to the total local
  // tax burden. Applies independent of resident locality (NYC residents AND
  // non-residents doing business in NYC).
  const nycUbtCalc = calculateNycUbt(sumByType("nyc_ubt_business_income"));
  const nycUbt = nycUbtCalc.netUbt;
  const localTaxLiabilityWithUbt = localTaxLiabilityAfterNycEitc + nycUbt;

  const totalNonRefundableApplied =
    ctc.nonRefundablePortion +
    foreignTaxApplied +
    depCareApplied +
    aocNonRefundableApplied +
    llcApplied +
    saversApplied +
    residentialEnergyApplied +
    adoptionCredit.nonRefundableApplied +
    rdCreditApplied +
    otherGbcApplied +
    amtCreditApplied;
  const totalRefundableCreditsApplied =
    ctc.refundableActc +
    educationCredits.aocRefundable +
    eitc.appliedCredit +
    netPremiumTaxCreditRefundable +
    adoptionCredit.refundablePortion;
  const totalCreditsAppliedForRefund =
    totalNonRefundableApplied + totalRefundableCreditsApplied;

  const totalFederalLiabilityWithRepayment = totalFederalLiability + excessAdvanceAptcOwed;

  const federalRefundOrOwed =
    totalFederalWithheld +
    // F-6 — Form 8959 Part IV line 24: Additional-Medicare-Tax withholding
    // (W-2 Box 6 over 1.45% × Box 5) is "include[d] with federal income tax
    // withholding on Form 1040 line 25c" — a PAYMENT (the liability side is
    // additionalMedicareTax above; without this credit the engine overstated
    // the balance due by the employer's mandatory 0.9% withholding).
    additionalMedicareWithholding +
    withholdingAdjustments +
    creditAdjustments +
    // F-5 — Schedule 3 line 11 excess-SS withholding (2+ employers): a
    // refundable payment-side credit (1040 line 31 via Schedule 3 Part II).
    excessSocialSecurityCredit +
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
    // E1 — state EITC piggybacks the federal qualifying-children count.
    qualifyingChildren: client.eitcQualifyingChildren ?? client.dependentsUnder17 ?? 0,
    taxYear: calc.taxYear,
    filingStatus: client.filingStatus,
    stateTaxLiability, // STL-05 — MD's 50% nonrefundable cap is limited to MD tax
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

  // T1.1c — State individual health-coverage mandate penalty (CA/NJ/RI/DC/MA).
  // Assessed on residents who lack minimum essential coverage. Driven by the
  // `months_without_minimum_coverage` adjustment (0–12); inert at 0 / non-mandate
  // states. Assumes the whole household is uninsured for those months (per-person
  // partial coverage is a documented refinement). The percentage method's filing
  // threshold uses each state's published value (NJ gross-income threshold;
  // federal standard deduction proxy for CA/RI/DC — a CPA can refine via their
  // form software since this is an Option-A overlay).
  // Compute the penalty inputs (filing threshold, household) ONLY when a mandate
  // actually applies — the overwhelming-majority path (covered / non-mandate
  // state) skips the getFederalStandardDeduction call entirely.
  const monthsWithoutCoverage = sumByType("months_without_minimum_coverage");
  const stateUpperForMandate = stateCode.toUpperCase();
  let stateMandate: StateMandateResult = {
    penalty: 0, state: stateCode, method: "none", flatAmount: 0,
    percentageAmount: 0, bronzeCapAmount: 0, monthsUninsured: 0,
  };
  if (monthsWithoutCoverage > 0 && STATES_WITH_INDIVIDUAL_MANDATE.has(stateUpperForMandate)) {
    const mandateIsJoint =
      client.filingStatus === "married_filing_jointly" || client.filingStatus === "qualifying_widow";
    const mandateDependents = toNum(client.dependentsUnder17) + toNum(client.otherDependents);
    // Percentage-method filing threshold (audit M4): NJ uses its own gross-income
    // threshold; CA uses the household-size-dependent FTB 3853 threshold; RI/DC
    // froze the 2018 FEDERAL methodology, whose filing threshold = the federal
    // standard deduction (post-TCJA exemption = $0), so the std-ded value is the
    // correct federal filing threshold for those two.
    const mandateFilingThreshold =
      stateUpperForMandate === "NJ"
        ? (client.filingStatus === "single" || client.filingStatus === "married_filing_separately" ? 10000 : 20000)
        : stateUpperForMandate === "CA"
          ? caFilingThreshold(client.filingStatus, mandateDependents, taxYear)
          : getFederalStandardDeduction(client.filingStatus, taxYear);
    stateMandate = calculateStateIndividualMandatePenalty({
      state: stateCode,
      filingStatus: client.filingStatus,
      uninsuredAdults: 1 + (mandateIsJoint ? 1 : 0),
      uninsuredChildren: toNum(client.dependentsUnder17),
      householdIncome: calc.adjustedGrossIncome,
      filingThreshold: mandateFilingThreshold,
      monthsUninsured: monthsWithoutCoverage,
      householdSize: (mandateIsJoint ? 2 : 1) + toNum(client.dependentsUnder17) + toNum(client.otherDependents),
      taxYear,
    });
  }
  const stateIndividualMandatePenalty = stateMandate.penalty;

  const stateRefundOrOwed = totalStateWithheld - stateTaxLiabilityAfterAdditional + stateEitc.credit + mnCtcRefundable + nycEitcRefundableExcess + stateCtcRefundable + nycSchoolTaxCreditRefundable + stateAdditionalRefundable - stateIndividualMandatePenalty;

  const totalTaxBurden = totalFederalLiabilityWithRepayment + stateTaxLiabilityAfterAdditional - stateEitc.credit - stateCtcRefundable - nycSchoolTaxCreditRefundable - stateAdditionalRefundable + stateIndividualMandatePenalty;
  // Guard against a sub-dollar denominator (e.g. a fuzz/degenerate $0.0000…1
  // income) blowing the ratio up to an absurd magnitude. No meaningful
  // effective rate exists below $1 of income. (Audit 2026-06-08 P1.)
  const effectiveRate = calc.totalIncome >= 1 ? totalTaxBurden / calc.totalIncome : 0;

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
    hiEmployerFundedPension: sumByType("hi_employer_funded_pension") > 0
      ? sumByType("hi_employer_funded_pension") : undefined,
    nyGovernmentPension: sumByType("ny_government_pension") > 0
      ? sumByType("ny_government_pension") : undefined,
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
    qbiPerBusiness: qbi.perBusiness ?? null,
    taxableIncome: taxableAfterObbba,
    obbbaSchedule1A: obbbaDeductions,
    federalTaxLiability: totalFederalLiabilityWithRepayment,
    // F-6 — 1040 line 25 total withholding includes the Form 8959 Part IV
    // Additional-Medicare withholding (line 25c per the 8959 instructions).
    federalTaxWithheld: totalFederalWithheld + withholdingAdjustments + additionalMedicareWithholding,
    federalRefundOrOwed,
    stateTaxLiability,
    stateTaxWithheld: totalStateWithheld,
    stateRefundOrOwed,
    stateAdditionalCreditsNonRefundable: stateAdditionalNonRefundable,
    stateAdditionalCreditsRefundable: stateAdditionalRefundable,
    stateChildTaxCredit: stateCtcRefundable,
    nycEitcRefundableExcess,
    stateIndividualMandatePenalty,
    stateMandate,
    effectiveTaxRate: effectiveRate,
    manualCreditsApplied: creditAdjustments,
    childTaxCredit: ctc,
    selfEmploymentTax: se.seTaxTotal,
    scheduleH,
    niitTax: niit.niitTax,
    additionalMedicareTax: additionalMedicare.additionalMedicareTax,
    additionalMedicareWithholding,
    excessSocialSecurityCredit,
    amtTax: amt.amtTax,
    additionalChildTaxCredit: ctc.refundableActc,
    capitalGainsTax: capGains.preferentialRateTax,
    preferentialIncome,
    investmentInterestDeduction: allowedInvestmentInterest,
    investmentInterestDisallowed,
    investmentInterestElectionAmount,
    unrecapturedSection1250Gain: unrecaptured1250Bounded,
    collectibles28RateGain: collectibles28Bounded,
    form4797: form4797.assetCount > 0 ? form4797 : null,
    form1099Summary,
    scheduleA,
    scheduleCExpenses,
    netScheduleCProfit: scheduleCNetSigned,
    scheduleCDepreciation: scheduleCDepreciationAdj,
    scheduleCAssetDepreciation,
    retirementDeductions: retirement,
    eitc,
    educationCredits,
    saversCredit,
    dependentCareCredit,
    educatorExpenses,
    studentLoanInterest,
    foreignTaxCredit,
    residentialEnergyCredits: residentialEnergy,
    residentialCleanEnergyApplied: cleanEnergyApplied,
    residentialCleanEnergyCarryforward,
    premiumTaxCredit,
    adoptionCredit,
    adoptionCreditCarryforwardRemaining: adoptionCredit.carryforwardToNext,
    rdCredit,
    rdCreditApplied,
    rdCreditCarryforwardRemaining,
    otherGeneralBusinessCreditApplied: otherGbcApplied,
    otherGeneralBusinessCreditCarryforward: otherGbcCarryforwardRemaining,
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
    section163jSmallBusinessExempt,
    section163jGrossReceipts,
    section163jGrossReceiptsThreshold,
    section461lExcessLossAddback,
    feie,
    nolDeduction,
    nolCarryforwardRemaining,
    amtNolDeduction: amt.atnoldApplied,
    amtNolCarryforwardRemaining: amt.atnoldCarryforwardRemaining,
    amtCreditApplied,
    amtCreditGenerated,
    form8801Generation,
    amtCreditCarryforwardRemaining,
    foreignTaxCreditCarryforwardRemaining,
    totalNonRefundableApplied,
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
    form8582,
    scheduleEPassiveLossSuspended: passiveLossAllowance?.suspendedToNextYear ?? 0,
    section469gReleasedLoss,
    localTaxLiability: localTaxLiabilityWithUbt,
    localTaxJurisdiction: multiState.localTax ? multiState.localTax.jurisdiction : (nycUbt > 0 ? "NYC-UBT" : null),
    nycUbt,
    scheduleK1: {
      k1Count: k1sForYear.length,
      partnershipCount: k1sForYear.filter((k) => (k.entityType ?? "partnership") === "partnership").length,
      sCorpCount: k1sForYear.filter((k) => k.entityType === "s_corp").length,
      totalActiveOrdinaryIncome: k1ActiveOrdinary,
      totalGuaranteedPayments: k1GuaranteedPayments,
      totalPassiveBucketNetApplied: k1PassiveAppliedToAgi,
      k1PassiveLossSuspended,
      k1BasisAtRiskLossSuspended,
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
