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
  calculateNiit,
  calculateAdditionalMedicareTax,
  calculateQbi,
  calculateAmt,
  calculateFederalTaxWithCapitalGains,
  calculateScheduleA,
  calculateEitc,
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
}

export interface Form1099Fact {
  taxYear?: number | null;
  formType: string; // "nec" | "misc" | "int" | "div" | "b" | "r" | "g" | "k"
  payerName?: string | null;
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
  /** Unemployment + state refund (1099-G) */
  unemploymentIncome: number;
  /** 1099-K gross payment (treated as additional income unless adjusted) */
  paymentCardIncome: number;
  /** 1099-MISC: rents + royalties + other income */
  miscIncome: number;
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
  const unemploymentIncome = gRecords.reduce(
    (s, r) => s + toNum(r.unemploymentCompensation) + toNum(r.stateLocalRefund),
    0,
  );
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
    unemploymentIncome,
    paymentCardIncome,
    miscIncome,
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
  /** K6 — §121 home-sale gross gain on primary residence (from
   *  `home_sale_gross_gain_primary_residence` adjustment). */
  homeSaleGrossGain: number;
  /** K6 — §121 excluded amount ($250k single/HoH/MFS / $500k MFJ/QSS). */
  homeSaleSection121Exclusion: number;
  /** K6 — §121 taxable remainder added to LTCG. */
  homeSaleTaxableGain: number;
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

  // ── 1099 aggregation (filter to tax year) + summary ──
  const form1099Records = form1099s.filter((r) => (r.taxYear ?? taxYear) === taxYear);
  const baseForm1099Summary = summarize1099s(form1099Records);

  // ── Schedule D per-transaction override ──
  // When capital_transactions exist for this tax year, the per-transaction
  // aggregate replaces the 1099-B-derived ST/LT cap-gain totals. 1099-DIV
  // box 2a capital-gain distributions remain additive to LT (they're not
  // Form 8949 transactions).
  const capTxnsForYear = (inputs.capitalTransactions ?? []).filter((t) => t.taxYear === taxYear);
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
  // Above-the-line
  const hsaContributionAdj = sumByType("hsa_contribution");
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

  // Sch SE Part I Line 9: for single/HoH/MFS/QSS filers, W-2 SS wages
  // already paid into the SS system reduce the SS wage base available
  // for SE income. Without this, combined W-2 + SE filers over-pay the
  // SS portion (deep-audit gap K1, closed in this commit).
  //
  // For MFJ we cannot apply this safely: the engine sums W-2 wages
  // household-wide but the IRS Sch SE rule is per-spouse — each spouse
  // files their own Sch SE and subtracts only their own W-2 SS wages.
  // Without per-spouse W-2/SE attribution, the conservative behavior is
  // to leave the SS base un-reduced for MFJ (mirrors the old engine
  // behavior — correct for the common case where the SE earner is the
  // lower-W-2 spouse, slightly over-charges only the case where the
  // single SE+W-2 earner is over the SS cap). Tracked as MFJ sub-gap.
  const seW2SsWages = client.filingStatus === "married_filing_jointly"
    ? 0
    : w2SocialSecurityWages;
  const se = calculateSelfEmploymentTax(seTaxBase, taxYear, seW2SsWages);

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

  // K-1 net ST/LT capital gain (Box 8 / 9a) joins the cap-gain netting
  // alongside 1099-B-derived gains. Subtract prior-year loss carryforwards.
  // Home-sale taxable remainder is long-term (primary-residence ownership > 2y per §121).
  let netSTCG = form1099Summary.shortTermCapitalGains + k1Stcg - stcgCarryforward;
  let netLTCG = form1099Summary.longTermCapitalGains + k1Ltcg - ltcgCarryforward + homeSaleTaxableGain;

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

  // Provisional AGI (before applying rental net) — used as MAGI for §469
  // phase-out and as initial AGI before any rental adjustment.
  // K-1 income flows here: active ordinary (Sch E Part II), passive-bucket
  // net applied (after carryforward netting), interest, ord div, royalties.
  // (K-1 qualified dividends and K-1 cap gains already folded above.)
  const ordinaryAdditionalIncomeBeforeRental =
    additionalIncome +
    additionalIncomeAdjustments +
    investmentIncomeFromAdj +
    netSeIncome +
    form1099Summary.interestIncome +
    form1099Summary.ordinaryDividends +
    form1099Summary.retirementIncome +
    form1099Summary.unemploymentIncome +
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
    k1Royalties;
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
    hsaIsFamilyCoverage: client.hsaIsFamilyCoverage ?? false,
    iraContribution: iraTraditionalAdj,
    iraCoveredByWorkplacePlan: client.iraCoveredByWorkplacePlan ?? false,
    age: ageTaxpayer,
    agi: Math.max(0, totalIncomeProvisional - (deductionAdjustments + otherDeductions + se.deductibleHalf + sehi.deduction + educatorDeduction + Math.min(hsaContributionAdj, 10000))),
    filingStatus: client.filingStatus,
    taxYear,
  });
  const hsaDeduction = retirementForLimits.hsaDeductible;

  const aboveTheLineDeterministic =
    deductionAdjustments + otherDeductions + se.deductibleHalf + hsaDeduction + educatorDeduction + sehi.deduction;

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
  const qbi = calculateQbi({
    qbiIncome: qbiIncome + k1QbiContribution,
    taxableIncomeBeforeQbi: calc.taxableIncome,
  });
  const taxableAfterQbi = Math.max(0, calc.taxableIncome - qbi.finalDeduction);

  // ── Step 6: Federal tax (ordinary + preferential) ──────────────────
  // Use post-netting LTCG (not raw 1099-B value) for preferential calculation.
  const preferentialIncome = ltcgPreferential + qualifiedDividends;
  const ordinaryPortionOfTaxable = Math.max(0, taxableAfterQbi - preferentialIncome);

  const capGains = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: ordinaryPortionOfTaxable,
    longTermGains: ltcgPreferential,
    qualifiedDividends,
    shortTermGains: 0, // post-netting STCG already in ordinaryPortionOfTaxable
    filingStatus: client.filingStatus,
    taxYear,
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

  const totalInvestmentIncomeForNiit = investmentIncomeFromAdj + form1099Summary.totalInvestmentIncome;
  const niit = calculateNiit({
    investmentIncome: totalInvestmentIncomeForNiit,
    modifiedAgi: calc.adjustedGrossIncome,
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

  const multiState = calculateMultiStateTax({
    residentState: stateCode ?? "CA",
    federalAgi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    taxYear,
    perStateWages: perStateWagesArr,
    localityCode: client.localityCode ?? null,
    localDependentCount,
    options: {
      federalIncomeTaxPaid: federalIncomeTaxForOr,
      retirementIncomeForExemption: form1099Summary.retirementIncome,
      taxpayerAge: client.taxpayerAge ?? undefined,
      // NJ pension-exclusion phase-out tests against NJ gross income; we use
      // federal AGI as the approximation (SS not modeled as separate stream).
      njGrossIncomeApprox: calc.adjustedGrossIncome,
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
    regularFederalTax + amt.amtTax + niit.niitTax + se.seTaxTotal + additionalMedicare.additionalMedicareTax;

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

  // ── Step 8: Refundable credits + PTC reconciliation ───
  const eitc = calculateEitc({
    filingStatus: client.filingStatus,
    qualifyingChildren: client.dependentsUnder17 ?? 0,
    earnedIncome: earnedIncomeHousehold,
    agi: calc.adjustedGrossIncome,
    investmentIncome: totalInvestmentIncomeForNiit,
    taxYear,
  });

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
    residentialEnergyApplied;
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
  const stateRefundOrOwed = totalStateWithheld - stateTaxLiability + stateEitc.credit;

  const totalTaxBurden = totalFederalLiabilityWithRepayment + stateTaxLiability - stateEitc.credit;
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
    localTaxLiability,
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
  };
}
