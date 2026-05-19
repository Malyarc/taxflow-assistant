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
  calculateNiit,
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
  getStateRetirementExemption,
  calculatePassiveActivityLossAllowance,
  getFederalStandardDeduction,
  type MultiStateTaxResult,
  type PassiveActivityLossResult,
  type CtcCalculation,
  type SeTaxCalculation,
  type NiitCalculation,
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
// Both work.
type Numish = string | number | null | undefined;
function toNum(val: Numish): number {
  if (val == null) return 0;
  return Number(val) || 0;
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
}

export interface W2Fact {
  taxYear?: number | null;
  wagesBox1?: Numish;
  federalTaxWithheldBox2?: Numish;
  stateTaxWithheldBox17?: Numish;
  stateCode?: string | null;
}

export interface Form1099Fact {
  taxYear?: number | null;
  formType: string; // "nec" | "misc" | "int" | "div" | "b" | "r" | "g" | "k"
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
 * Complete inputs for the pure engine. The adapter (DB-backed) constructs
 * these by loading the relevant rows; Haven (or tests) build them by hand.
 */
export interface TaxReturnInputs {
  client: ClientFacts;
  w2s: W2Fact[];
  form1099s: Form1099Fact[];
  adjustments: AdjustmentFact[];
  /** The resolved tax year. Engine does NOT re-resolve from client.taxYear. */
  taxYear: number;
  overrides?: RecalcOverrides;
  /** Legacy single-number itemized deductions fallback (existing tax_return row) */
  existingItemizedFallback?: Numish;
}

// ── 1099 summary ────────────────────────────────────────────────────────────

export interface Form1099Summary {
  /** Self-employment income (1099-NEC) */
  seIncome: number;
  /** Ordinary interest (1099-INT minus tax-exempt portion) */
  interestIncome: number;
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

  return {
    seIncome,
    interestIncome,
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
  };
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
  /** Detailed breakdowns for transparency */
  detail: {
    se: SeTaxCalculation;
    niit: NiitCalculation;
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

  const additionalIncome = overrides.additionalIncome ?? 0;
  const useItemizedDeductionsOverride = overrides.useItemizedDeductions;
  const additionalDeductions =
    overrides.additionalDeductions ?? toNum(inputs.existingItemizedFallback);

  // ── W-2 aggregation (filter to tax year) ──
  const w2Records = w2s.filter((r) => (r.taxYear ?? taxYear) === taxYear);
  const totalWages = w2Records.reduce((s, r) => s + toNum(r.wagesBox1), 0);
  const w2FederalWithheld = w2Records.reduce((s, r) => s + toNum(r.federalTaxWithheldBox2), 0);
  const w2StateWithheld = w2Records.reduce((s, r) => s + toNum(r.stateTaxWithheldBox17), 0);

  // ── 1099 aggregation (filter to tax year) + summary ──
  const form1099Records = form1099s.filter((r) => (r.taxYear ?? taxYear) === taxYear);
  const form1099Summary = summarize1099s(form1099Records);

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
  const amtPreferences = sumByType("amt_preferences");

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
  // Credits
  const dependentCareExpensesAdj = sumByType("dependent_care_expenses");
  const llcExpensesAdj = sumByType("qualified_education_expenses_llc");
  const saversContributionsAdj = sumByType("retirement_contributions_savers");

  // Phase 1.5
  const educatorExpensesAdj = sumByType("educator_expenses");
  const studentLoanInterestAdj = sumByType("student_loan_interest");
  const foreignTaxPaidAdj = sumByType("foreign_tax_paid");
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
  const scheduleERentalIncomeAdj = sumByType("schedule_e_rental_income");
  const scheduleERentalExpensesAdj = sumByType("schedule_e_rental_expenses");
  const scheduleEMacrsDepreciationAdj = sumByType("schedule_e_macrs_depreciation");
  const scheduleEPassiveLossCarryforwardAdj = sumByType("schedule_e_passive_loss_carryforward");

  // ── Step 1: Schedule C — net SE income before SE tax ─────────────────
  const grossSeIncome = seIncomeFromAdj + form1099Summary.seIncome;
  const scheduleCExpenses = Math.min(
    Math.max(0, scheduleCExpensesInput),
    Math.max(0, grossSeIncome),
  );
  const netSeIncome = Math.max(0, grossSeIncome - scheduleCExpenses);

  const se = calculateSelfEmploymentTax(netSeIncome, taxYear);

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

  const qualifiedDividends = form1099Summary.qualifiedDividends; // always >= 0
  // Subtract prior-year carryforwards (entered as positive numbers → applied as losses)
  let netSTCG = form1099Summary.shortTermCapitalGains - stcgCarryforward;
  let netLTCG = form1099Summary.longTermCapitalGains - ltcgCarryforward;

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
    capitalLossDeducted;
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
    agi: Math.max(0, totalIncomeProvisional - (deductionAdjustments + otherDeductions + se.deductibleHalf + educatorDeduction + Math.min(hsaContributionAdj, 10000))),
    filingStatus: client.filingStatus,
    taxYear,
  });
  const hsaDeduction = retirementForLimits.hsaDeductible;

  const aboveTheLineDeterministic =
    deductionAdjustments + otherDeductions + se.deductibleHalf + hsaDeduction + educatorDeduction;

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

  // ── Step 4: Schedule A itemized vs Standard ────────────────────────
  const provisionalAgi = Math.max(0, totalIncomeProvisional - aboveTheLineAdjustments);

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
  const calc = runTaxCalculation({
    totalWages,
    additionalIncome: ordinaryAdditionalIncome,
    filingStatus: client.filingStatus,
    stateCode: stateCode ?? "CA",
    useItemizedDeductions,
    itemizedDeductions: itemizedTotal,
    adjustments: aboveTheLineAdjustments,
    taxYear,
  });

  const qbi = calculateQbi({
    qbiIncome,
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

  const amt = calculateAmt({
    taxableIncome: taxableAfterQbi,
    amtPreferences,
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

  const multiState = calculateMultiStateTax({
    residentState: stateCode ?? "CA",
    federalAgi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
    taxYear,
    perStateWages: perStateWagesArr,
    options: {
      federalIncomeTaxPaid: federalIncomeTaxForOr,
      retirementIncomeForExemption: form1099Summary.retirementIncome,
      taxpayerAge: client.taxpayerAge ?? undefined,
    },
  });
  const stateTaxLiability = multiState.totalStateTax;

  const totalFederalLiability =
    regularFederalTax + amt.amtTax + niit.niitTax + se.seTaxTotal;

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

  const stateRefundOrOwed = totalStateWithheld - stateTaxLiability;

  const totalTaxBurden = totalFederalLiabilityWithRepayment + stateTaxLiability;
  const effectiveRate = calc.totalIncome > 0 ? totalTaxBurden / calc.totalIncome : 0;

  // ── Compute state retirement exemption (for transparency in result) ──
  const stateRetirementExemptionInfo = getStateRetirementExemption({
    stateCode: stateUpper,
    retirementIncome: form1099Summary.retirementIncome,
    taxpayerAge: client.taxpayerAge ?? undefined,
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
    capitalLossDeducted,
    capitalLossCarryforwardShort,
    capitalLossCarryforwardLong,
    netCapitalGainLoss: netCapitalTotal,
    stateRetirementExemption: stateRetirementExemptionInfo.exemption,
    multiState,
    scheduleERentalGrossNet: grossRentalNet,
    scheduleERentalAppliedToAgi: rentalNetAppliedToAgi,
    passiveActivityLoss: passiveLossAllowance,
    scheduleEPassiveLossSuspended: passiveLossAllowance?.suspendedToNextYear ?? 0,
    detail: { se, niit, qbi, amt, capitalGains: capGains },
    w2Count: w2Records.length,
    form1099Count: form1099Records.length,
  };
}
