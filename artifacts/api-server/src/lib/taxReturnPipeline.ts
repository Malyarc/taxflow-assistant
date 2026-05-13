/**
 * Single source of truth for tax return calculation + persistence.
 *
 * Layered:
 *   - computeTaxReturn(): pure calculation (no DB writes). Used by both the
 *     persistent recalc path and the on-demand "/preview" endpoint.
 *   - recalculateAndUpsertTaxReturn(): wraps compute + writes the result row.
 *   - recalculateInBackground(): fire-and-forget version used by mutation routes.
 */

import { eq, and } from "drizzle-orm";
import {
  db,
  clientsTable,
  w2DataTable,
  form1099DataTable,
  adjustmentsTable,
  taxReturnsTable,
} from "@workspace/db";
import {
  runTaxCalculation,
  calculateChildTaxCredit,
  calculateSelfEmploymentTax,
  calculateNiit,
  calculateQbi,
  calculateAmt,
  calculateFederalTax,
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
  getFederalStandardDeduction,
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
import { logger } from "./logger";

export interface RecalcOverrides {
  taxYear?: number;
  additionalIncome?: number;
  additionalDeductions?: number;
  useItemizedDeductions?: boolean;
}

function toNum(val: string | null | undefined): number {
  if (val == null) return 0;
  return Number(val) || 0;
}

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

function summarize1099s(records: Array<typeof form1099DataTable.$inferSelect>): Form1099Summary {
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
  /** Schedule A computed total + per-line breakdown */
  scheduleA: ScheduleACalculation;
  /** Schedule C expenses (subtracted from gross SE income before SE tax) */
  scheduleCExpenses: number;
  /** Above-the-line HSA + IRA deductions (with phase-outs) */
  retirementDeductions: RetirementDeductionsCalculation;
  /** EITC (refundable) */
  eitc: EitcCalculation;
  /** Education credits (AOC + LLC, mixed refundable/non-refundable) */
  educationCredits: EducationCreditsCalculation;
  /** Saver's Credit (non-refundable) */
  saversCredit: SaversCreditCalculation;
  /** Dependent Care Credit (non-refundable) */
  dependentCareCredit: DependentCareCreditCalculation;
  // ── Phase 1.5 line items ───────────────────────────────────────────────
  /** Above-the-line educator expenses deduction ($300/educator) */
  educatorExpenses: EducatorExpensesCalculation;
  /** Above-the-line student loan interest deduction ($2,500 cap, MAGI phase-out) */
  studentLoanInterest: StudentLoanInterestCalculation;
  /** Foreign tax credit (simplified path or full Form 1116) */
  foreignTaxCredit: ForeignTaxCreditCalculation;
  /** Residential energy credits (§25D + §25C + §30C) */
  residentialEnergyCredits: ResidentialEnergyCreditsCalculation;
  /** Premium Tax Credit (Form 8962) — net refundable / excess repayment */
  premiumTaxCredit: PremiumTaxCreditCalculation;
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

/**
 * Pure compute — no DB writes. Loads client/W-2/adjustments, computes the
 * full tax return, and returns numeric results. Same logic used by the
 * persistent recalc path and the preview endpoint.
 */
export async function computeTaxReturn(
  clientId: number,
  overrides: RecalcOverrides = {},
): Promise<{ result: ComputedTaxReturn; client: typeof clientsTable.$inferSelect } | null> {
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) return null;

  const [existing] = await db
    .select()
    .from(taxReturnsTable)
    .where(eq(taxReturnsTable.clientId, clientId));

  // Tax year resolution: explicit override > client.taxYear > existing.taxYear
  const taxYear =
    overrides.taxYear ?? client.taxYear ?? existing?.taxYear ?? new Date().getFullYear() - 1;
  const additionalIncome = overrides.additionalIncome ?? 0;
  const useItemizedDeductionsOverride = overrides.useItemizedDeductions;
  const additionalDeductions =
    overrides.additionalDeductions ?? toNum(existing?.itemizedDeductions);

  // W-2s for the requested year only
  const w2Records = await db
    .select()
    .from(w2DataTable)
    .where(
      and(eq(w2DataTable.clientId, clientId), eq(w2DataTable.taxYear, taxYear)),
    );
  const totalWages = w2Records.reduce((s, r) => s + toNum(r.wagesBox1), 0);
  const w2FederalWithheld = w2Records.reduce(
    (s, r) => s + toNum(r.federalTaxWithheldBox2),
    0,
  );
  const w2StateWithheld = w2Records.reduce(
    (s, r) => s + toNum(r.stateTaxWithheldBox17),
    0,
  );

  // 1099s for the requested year only
  const form1099Records = await db
    .select()
    .from(form1099DataTable)
    .where(
      and(eq(form1099DataTable.clientId, clientId), eq(form1099DataTable.taxYear, taxYear)),
    );
  const form1099Summary = summarize1099s(form1099Records);

  const totalFederalWithheld = w2FederalWithheld + form1099Summary.federalWithheld;
  const totalStateWithheld = w2StateWithheld + form1099Summary.stateWithheld;

  const stateCode =
    (client.state && client.state.trim()) ||
    w2Records.find((r) => r.stateCode)?.stateCode ||
    "";

  // CPA-authored adjustments (only "applied" ones)
  const adjustments = await db
    .select()
    .from(adjustmentsTable)
    .where(eq(adjustmentsTable.clientId, clientId));
  const applied = adjustments.filter((a) => a.isApplied);

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

  // Income / SE / investment / QBI / AMT adjustment types (existing)
  const seIncomeFromAdj = sumByType("self_employment_income");
  const investmentIncomeFromAdj = sumByType("investment_income");
  const qbiIncome = sumByType("qbi_income");
  const amtPreferences = sumByType("amt_preferences");

  // ── Phase 1 adjustment types ─────────────────────────────────────────
  // Schedule A inputs
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
  const aocExpensesAdj = sumByType("qualified_education_expenses_aoc");
  const llcExpensesAdj = sumByType("qualified_education_expenses_llc");
  const saversContributionsAdj = sumByType("retirement_contributions_savers");

  // ── Phase 1.5 adjustment types ───────────────────────────────────────
  const educatorExpensesAdj = sumByType("educator_expenses");
  const studentLoanInterestAdj = sumByType("student_loan_interest");
  const foreignTaxPaidAdj = sumByType("foreign_tax_paid");
  const residentialCleanEnergyAdj = sumByType("residential_clean_energy");
  const energyEfficientHomeAdj = sumByType("energy_efficient_home");
  const energyEfficientHeatpumpAdj = sumByType("energy_efficient_heatpump");
  const evChargerPropertyAdj = sumByType("ev_charger_property");

  // ── Step 1: Schedule C — net SE income before SE tax ─────────────────
  // Real Schedule C subtracts expenses from gross 1099-NEC income.
  // Cap expenses at gross (no NOL — that's Phase 2).
  const grossSeIncome = seIncomeFromAdj + form1099Summary.seIncome;
  const scheduleCExpenses = Math.min(
    Math.max(0, scheduleCExpensesInput),
    Math.max(0, grossSeIncome),
  );
  const netSeIncome = Math.max(0, grossSeIncome - scheduleCExpenses);

  // SE tax — computed on net SE earnings; 1/2 deductible above the line
  const se = calculateSelfEmploymentTax(netSeIncome, taxYear);

  // ── Step 2: Total income (Form 1040 Line 9) ─────────────────────────
  // ALL income flows in (LTCG + QDIV are part of AGI per Line 9; they get
  // taxed at preferential rates downstream).
  const longTermGains = form1099Summary.longTermCapitalGains;
  const shortTermGains = form1099Summary.shortTermCapitalGains;
  const qualifiedDividends = form1099Summary.qualifiedDividends;

  const ordinaryAdditionalIncome =
    additionalIncome +
    additionalIncomeAdjustments +
    investmentIncomeFromAdj +
    netSeIncome + // net of Schedule C expenses (was gross before)
    form1099Summary.interestIncome +
    form1099Summary.ordinaryDividends + // non-qualified portion
    form1099Summary.retirementIncome +
    form1099Summary.unemploymentIncome +
    form1099Summary.paymentCardIncome +
    form1099Summary.miscIncome +
    Math.max(0, longTermGains) +
    Math.max(0, qualifiedDividends) +
    Math.max(0, shortTermGains);

  const totalIncomeProvisional = totalWages + ordinaryAdditionalIncome;

  // ── Step 3: Above-the-line deductions ───────────────────────────────
  // SE half + HSA + Educator (deterministic, no AGI phase-out) + legacy "deduction"/"other"
  // + Student Loan Interest (MAGI phase-out before IRA) + IRA (MAGI phase-out before IRA).
  //
  // Order for MAGI bootstrap (per IRS Pub 590-A / Pub 970 ch. 4):
  //   1. Compute deterministic deductions first (SE/2, HSA, educator, legacy).
  //   2. SLI MAGI ≈ AGI excluding SLI itself; approximated as AGI before SLI and IRA.
  //   3. IRA MAGI ≈ AGI excluding IRA itself; we fold SLI in (real Form 1040
  //      worksheet uses iterative; this matches Pub 590-A's simplifying approach).

  const ageTaxpayer = client.taxpayerAge ?? 0;

  // Educator — no AGI phase-out, deterministic
  const educatorExpenses = calculateEducatorExpenses({
    expenses: educatorExpensesAdj,
    eligibleEducatorCount: client.eligibleEducatorCount ?? 0,
    taxYear,
  });
  const educatorDeduction = educatorExpenses.deductible;

  // First pass — provisional AGI for HSA upper-bound (HSA has no AGI phase-out
  // but the call signature requires AGI; provisional value is fine).
  const retirementForLimits = calculateRetirementDeductions({
    hsaContribution: hsaContributionAdj,
    hsaIsFamilyCoverage: client.hsaIsFamilyCoverage ?? false,
    iraContribution: iraTraditionalAdj,
    iraCoveredByWorkplacePlan: client.iraCoveredByWorkplacePlan ?? false,
    age: ageTaxpayer,
    agi: Math.max(0, totalIncomeProvisional - (deductionAdjustments + otherDeductions + se.deductibleHalf + educatorDeduction + Math.min(hsaContributionAdj, /*upper-bound*/ 10000))),
    filingStatus: client.filingStatus,
    taxYear,
  });
  const hsaDeduction = retirementForLimits.hsaDeductible;

  // Deterministic above-the-line subtotal — used as the MAGI baseline for SLI.
  const aboveTheLineDeterministic =
    deductionAdjustments + otherDeductions + se.deductibleHalf + hsaDeduction + educatorDeduction;

  // Student loan interest — phase-out by MAGI ≈ AGI before SLI.
  // Approximation: AGI before SLI but excluding IRA (matches Pub 970 worksheet's
  // first-pass ordering: compute SLI first, then IRA using AGI that includes SLI).
  const magiForSli = Math.max(0, totalIncomeProvisional - aboveTheLineDeterministic);
  const studentLoanInterest = calculateStudentLoanInterest({
    interestPaid: studentLoanInterestAdj,
    magi: magiForSli,
    filingStatus: client.filingStatus,
    taxYear,
  });
  const sliDeduction = studentLoanInterest.deductible;

  // IRA — phase-out by MAGI ≈ AGI before IRA. AGI before IRA includes SLI.
  const aboveTheLineExcludingIra = aboveTheLineDeterministic + sliDeduction;
  const agiBeforeIra = Math.max(0, totalIncomeProvisional - aboveTheLineExcludingIra);

  // Recompute IRA deduction with the precise pre-IRA AGI
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
  // Compute Schedule A using AGI (medical 7.5% threshold uses AGI)
  // Use a provisional AGI = totalIncome - aboveTheLine for the medical threshold;
  // the final AGI will match this once we compute it below.
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

  // Determine effective itemized total: max of Schedule A computed and legacy override.
  // Legacy: tax_returns.itemized_deductions (manual single number) — preserved for backward compat.
  const itemizedTotal = Math.max(scheduleA.totalItemized, additionalDeductions);

  // Use itemized if:
  //   - explicitly forced via override, OR
  //   - itemized auto-wins (> standard deduction)
  // Fall back to standard if neither.
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

  // QBI deduction reduces taxable income further (capped at 20% of taxable income before QBI)
  const qbi = calculateQbi({
    qbiIncome,
    taxableIncomeBeforeQbi: calc.taxableIncome,
  });
  const taxableAfterQbi = Math.max(0, calc.taxableIncome - qbi.finalDeduction);

  // ── Step 6: Federal tax (ordinary + preferential) ──────────────────
  const preferentialIncome = Math.max(0, longTermGains) + Math.max(0, qualifiedDividends);
  const ordinaryPortionOfTaxable = Math.max(0, taxableAfterQbi - preferentialIncome);

  const capGains = calculateFederalTaxWithCapitalGains({
    ordinaryTaxableIncome: ordinaryPortionOfTaxable,
    longTermGains: Math.max(0, longTermGains),
    qualifiedDividends: Math.max(0, qualifiedDividends),
    shortTermGains: 0, // STCG already inside ordinaryPortionOfTaxable
    filingStatus: client.filingStatus,
    taxYear,
  });
  const regularFederalTax = capGains.totalFederalTax;

  // AMT delta
  const amt = calculateAmt({
    taxableIncome: taxableAfterQbi,
    amtPreferences,
    filingStatus: client.filingStatus,
    regularTax: regularFederalTax,
    taxYear,
  });

  // NIIT — uses AGI (= MAGI for our simplified model)
  const totalInvestmentIncomeForNiit = investmentIncomeFromAdj + form1099Summary.totalInvestmentIncome;
  const niit = calculateNiit({
    investmentIncome: totalInvestmentIncomeForNiit,
    modifiedAgi: calc.adjustedGrossIncome,
    filingStatus: client.filingStatus,
  });

  // ── Oregon federal-tax-paid subtraction (Form 40 Line 13) ──
  // OR recomputes state tax with federal income tax (regular + AMT) subtracted
  // from state taxable income, capped and phased out by AGI.
  // We override `calc.stateTaxLiability` after federal tax is known.
  let stateTaxLiability = calc.stateTaxLiability;
  if ((stateCode ?? "").toUpperCase() === "OR") {
    const federalIncomeTaxForOr = regularFederalTax + amt.amtTax;
    stateTaxLiability = calculateStateTax(
      calc.adjustedGrossIncome,
      stateCode ?? "OR",
      client.filingStatus,
      taxYear,
      { federalIncomeTaxPaid: federalIncomeTaxForOr },
    );
  }

  // Total federal liability (gross — before credits applied)
  const totalFederalLiability =
    regularFederalTax + amt.amtTax + niit.niitTax + se.seTaxTotal;

  // ── Step 7: Non-refundable credits in IRS Form 1040 / Schedule 3 order ──
  // Form 1040 Line 19: Child Tax Credit & Credit for Other Dependents
  // Form 1040 Line 20: Schedule 3 Part I (nonrefundable) subtotal:
  //   Line 1  — Foreign tax credit
  //   Line 2  — Credit for child and dependent care expenses
  //   Line 3  — Education credits (Form 8863, nonrefundable portion only)
  //   Line 4  — Retirement savings contributions credit (Saver's, Form 8880)
  //   Line 5a — Residential clean energy credit (§25D, Form 5695)
  //   Line 5b — Energy efficient home improvement credit (§25C, Form 5695)
  //   Line 6  — Other credits incl. alternative fuel vehicle refueling (§30C, Form 8911)
  // Each is capped at the remaining "income tax" (regular + AMT, NOT SE/NIIT).
  const incomeTaxOnly = regularFederalTax + amt.amtTax;
  let availableForNonRefundable = incomeTaxOnly;

  // CTC nonrefundable (Line 19). The refundable ACTC portion is separate.
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

  // ── Schedule 3 Line 1: Foreign Tax Credit ──
  const foreignTaxCredit = calculateForeignTaxCredit({
    foreignTaxPaid: foreignTaxPaidAdj,
    filingStatus: client.filingStatus,
  });
  const foreignTaxApplied = Math.min(foreignTaxCredit.credit, availableForNonRefundable);
  availableForNonRefundable = Math.max(0, availableForNonRefundable - foreignTaxApplied);

  // ── Schedule 3 Line 2: Dependent Care Credit (Form 2441) ──
  // MFJ earned-income limit: lesser of taxpayer's and spouse's individual earned income.
  // Bug fix: previously passed combined household earned income as `earnedIncomeTaxpayer`,
  // overstating the limit when spouse outearned taxpayer.
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

  // ── Schedule 3 Line 3: Education credits (Form 8863) ──
  //   AOC: 60% non-refundable + 40% refundable (refundable split applied below)
  //   LLC: 100% non-refundable
  // AOC expenses are per-student; each adjustment row = one student's expenses.
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

  // ── Schedule 3 Line 4: Saver's Credit (Form 8880) ──
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

  // ── Schedule 3 Line 5a/5b + Line 6: Residential energy + EV charger ──
  const residentialEnergy = calculateResidentialEnergyCredits({
    cleanEnergySpend: residentialCleanEnergyAdj,
    efficientHomeSpend: energyEfficientHomeAdj,
    heatPumpSpend: energyEfficientHeatpumpAdj,
    evChargerSpend: evChargerPropertyAdj,
  });
  // §25D first (Line 5a), then §25C (Line 5b), then §30C (Line 6)
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

  // ── Step 8: Refundable credits + Premium Tax Credit reconciliation ───
  // EITC — refundable, uses earned income + AGI
  const eitcInvestmentIncome = totalInvestmentIncomeForNiit;
  const eitc = calculateEitc({
    filingStatus: client.filingStatus,
    qualifyingChildren: client.dependentsUnder17 ?? 0,
    earnedIncome: earnedIncomeHousehold,
    agi: calc.adjustedGrossIncome,
    investmentIncome: eitcInvestmentIncome,
    taxYear,
  });

  // Premium Tax Credit (Form 8962, Sched 3 Line 8 refundable; Sched 2 Line 2 excess repayment)
  // MAGI for PTC ≈ AGI (approximation; real MAGI adds back tax-exempt interest +
  // foreign earned income exclusion + non-taxable Social Security — not modeled).
  // Household size defaults to filer + dependents if not explicitly set.
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
  // Positive netPtc → refundable credit. Negative → additional tax owed (Sched 2).
  const netPremiumTaxCreditRefundable = Math.max(0, premiumTaxCredit.netPtc);
  const excessAdvanceAptcOwed = Math.max(0, -premiumTaxCredit.netPtc);

  // Total credits applied (for refund/owe formula)
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

  // Excess advance APTC owed flows into total liability (Schedule 2 Line 2 additional tax).
  const totalFederalLiabilityWithRepayment = totalFederalLiability + excessAdvanceAptcOwed;

  // Final refund/owe formula:
  //   refund = withheld + manual_credit_adj + (computed credits) - liability
  //   liability now includes SE + NIIT + AMT + regular fed tax + excess APTC repayment.
  //   Non-refundable credits cap themselves at incomeTaxOnly (above), so
  //   they can't over-refund.
  const federalRefundOrOwed =
    totalFederalWithheld +
    withholdingAdjustments +
    creditAdjustments +
    totalCreditsAppliedForRefund -
    totalFederalLiabilityWithRepayment;

  const stateRefundOrOwed = totalStateWithheld - stateTaxLiability;

  // Effective tax rate uses the full federal + state liability (before credits)
  const totalTaxBurden = totalFederalLiabilityWithRepayment + stateTaxLiability;
  const effectiveRate = calc.totalIncome > 0 ? totalTaxBurden / calc.totalIncome : 0;

  const result: ComputedTaxReturn = {
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
    detail: { se, niit, qbi, amt, capitalGains: capGains },
    w2Count: w2Records.length,
    form1099Count: form1099Records.length,
  };

  return { result, client };
}

export async function recalculateAndUpsertTaxReturn(
  clientId: number,
  overrides: RecalcOverrides = {},
): Promise<typeof taxReturnsTable.$inferSelect | null> {
  const computed = await computeTaxReturn(clientId, overrides);
  if (!computed) {
    logger.warn({ clientId }, "recalculateAndUpsertTaxReturn: client not found");
    return null;
  }
  const { result } = computed;

  // Multi-year: look up by (clientId, taxYear) composite, not just clientId.
  // This means each client can have one row per tax year, not one row total.
  const [existing] = await db
    .select()
    .from(taxReturnsTable)
    .where(
      and(
        eq(taxReturnsTable.clientId, clientId),
        eq(taxReturnsTable.taxYear, result.taxYear),
      ),
    );

  // Education credits split: aocCredit = total AOC applied (refundable + non-refundable AOC);
  // aocRefundablePortion separated for display.
  const aocCreditTotal = result.educationCredits.aocApplied;
  const aocRefundable = result.educationCredits.aocRefundable;
  const llcCreditTotal = result.educationCredits.llcApplied;

  const payload = {
    clientId,
    taxYear: result.taxYear,
    filingStatus: result.filingStatus,
    totalIncome: String(result.totalIncome),
    adjustedGrossIncome: String(result.adjustedGrossIncome),
    standardDeduction: String(result.standardDeduction),
    itemizedDeductions: result.itemizedDeductions != null ? String(result.itemizedDeductions) : null,
    taxableIncome: String(result.taxableIncome),
    federalTaxLiability: String(result.federalTaxLiability),
    federalTaxWithheld: String(result.federalTaxWithheld),
    federalRefundOrOwed: String(result.federalRefundOrOwed),
    stateTaxLiability: String(result.stateTaxLiability),
    stateTaxWithheld: String(result.stateTaxWithheld),
    stateRefundOrOwed: String(result.stateRefundOrOwed),
    effectiveTaxRate: String(result.effectiveTaxRate),
    selfEmploymentTax: result.selfEmploymentTax != null ? String(result.selfEmploymentTax) : null,
    qbiDeduction: result.qbiDeduction != null ? String(result.qbiDeduction) : null,
    amtTax: result.amtTax != null ? String(result.amtTax) : null,
    niitTax: result.niitTax != null ? String(result.niitTax) : null,
    additionalChildTaxCredit: result.additionalChildTaxCredit != null ? String(result.additionalChildTaxCredit) : null,
    capitalGainsTax: result.capitalGainsTax != null ? String(result.capitalGainsTax) : null,
    preferentialIncome: result.preferentialIncome != null ? String(result.preferentialIncome) : null,
    // Phase 1: Schedule A breakdown
    medicalDeductible: String(result.scheduleA.medicalDeductible),
    saltDeductible: String(result.scheduleA.saltDeductible),
    mortgageDeductible: String(result.scheduleA.mortgageDeductible),
    charitableDeductible: String(result.scheduleA.charitableDeductible),
    // Phase 1: Above-the-line
    hsaDeduction: String(result.retirementDeductions.hsaDeductible),
    iraDeduction: String(result.retirementDeductions.iraDeductible),
    // Phase 1: Credits
    eitc: String(result.eitc.appliedCredit),
    aocCredit: String(aocCreditTotal),
    aocRefundablePortion: String(aocRefundable),
    llcCredit: String(llcCreditTotal),
    saversCredit: String(result.saversCredit.appliedCredit),
    dependentCareCredit: String(result.dependentCareCredit.appliedCredit),
    // Phase 1: Schedule C
    scheduleCExpenses: String(result.scheduleCExpenses),
    // Phase 1.5: Above-the-line deductions
    educatorExpensesDeduction: String(result.educatorExpenses.deductible),
    studentLoanInterestDeduction: String(result.studentLoanInterest.deductible),
    // Phase 1.5: Credits
    foreignTaxCredit: String(result.foreignTaxCredit.credit),
    residentialEnergyCredits: String(result.residentialEnergyCredits.total),
    premiumTaxCredit: String(result.premiumTaxCredit.netPtc),
  };

  if (existing) {
    const [updated] = await db
      .update(taxReturnsTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(
        and(
          eq(taxReturnsTable.clientId, clientId),
          eq(taxReturnsTable.taxYear, result.taxYear),
        ),
      )
      .returning();
    return updated;
  }
  const [created] = await db.insert(taxReturnsTable).values(payload).returning();
  return created;
}

/**
 * Fire-and-forget recalc — for use after non-blocking mutations where we
 * don't want to slow down the request response. Errors are logged.
 */
export function recalculateInBackground(clientId: number, taxYear?: number): void {
  recalculateAndUpsertTaxReturn(clientId, taxYear ? { taxYear } : {}).catch((err) => {
    logger.error({ err, clientId, taxYear }, "Background tax-return recalc failed");
  });
}
