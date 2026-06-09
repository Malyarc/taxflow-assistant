import { pgTable, text, serial, integer, numeric, timestamp, unique, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const taxReturnsTable = pgTable(
  "tax_returns",
  {
    id: serial("id").primaryKey(),
    // Deep-audit DB finding: FK + cascade so deleting a client cleans up
    // their tax returns (currently the soft-delete pattern is documented
    // as a future hardening — this FK ensures correctness when deletes
    // happen).
    clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status"),
    totalIncome: numeric("total_income", { precision: 12, scale: 2 }),
    adjustedGrossIncome: numeric("adjusted_gross_income", { precision: 12, scale: 2 }),
    standardDeduction: numeric("standard_deduction", { precision: 12, scale: 2 }),
    itemizedDeductions: numeric("itemized_deductions", { precision: 12, scale: 2 }),
    taxableIncome: numeric("taxable_income", { precision: 12, scale: 2 }),
    federalTaxLiability: numeric("federal_tax_liability", { precision: 12, scale: 2 }),
    /** FORM-02 — total non-refundable credits applied (income-tax offset).
     *  federalTaxLiability is pre-credit; Form 1040-X Lines 8/10/16 net this out. */
    totalNonRefundableApplied: numeric("total_non_refundable_applied", { precision: 12, scale: 2 }),
    federalTaxWithheld: numeric("federal_tax_withheld", { precision: 12, scale: 2 }),
    federalRefundOrOwed: numeric("federal_refund_or_owed", { precision: 12, scale: 2 }),
    stateTaxLiability: numeric("state_tax_liability", { precision: 12, scale: 2 }),
    stateTaxWithheld: numeric("state_tax_withheld", { precision: 12, scale: 2 }),
    stateRefundOrOwed: numeric("state_refund_or_owed", { precision: 12, scale: 2 }),
    effectiveTaxRate: numeric("effective_tax_rate", { precision: 6, scale: 4 }),
    // Additional federal calc components (added with AMT/NIIT/QBI/SE/ACTC support)
    selfEmploymentTax: numeric("self_employment_tax", { precision: 12, scale: 2 }),
    qbiDeduction: numeric("qbi_deduction", { precision: 12, scale: 2 }),
    amtTax: numeric("amt_tax", { precision: 12, scale: 2 }),
    niitTax: numeric("niit_tax", { precision: 12, scale: 2 }),
    additionalMedicareTax: numeric("additional_medicare_tax", { precision: 12, scale: 2 }),
    additionalChildTaxCredit: numeric("additional_child_tax_credit", { precision: 12, scale: 2 }),
    capitalGainsTax: numeric("capital_gains_tax", { precision: 12, scale: 2 }),
    preferentialIncome: numeric("preferential_income", { precision: 12, scale: 2 }),
    // Schedule A line items
    medicalDeductible: numeric("medical_deductible", { precision: 12, scale: 2 }),
    saltDeductible: numeric("salt_deductible", { precision: 12, scale: 2 }),
    mortgageDeductible: numeric("mortgage_deductible", { precision: 12, scale: 2 }),
    charitableDeductible: numeric("charitable_deductible", { precision: 12, scale: 2 }),
    // Above-the-line deductions
    hsaDeduction: numeric("hsa_deduction", { precision: 12, scale: 2 }),
    iraDeduction: numeric("ira_deduction", { precision: 12, scale: 2 }),
    sehiDeduction: numeric("sehi_deduction", { precision: 12, scale: 2 }),
    homeSaleGrossGain: numeric("home_sale_gross_gain", { precision: 14, scale: 2 }),
    homeSaleSection121Exclusion: numeric("home_sale_section_121_exclusion", { precision: 14, scale: 2 }),
    homeSaleTaxableGain: numeric("home_sale_taxable_gain", { precision: 14, scale: 2 }),
    /** K10 — Total SS benefits received (Form 1040 Line 6a). */
    socialSecurityBenefits: numeric("social_security_benefits", { precision: 12, scale: 2 }),
    /** K10 — Taxable portion of SS (Form 1040 Line 6b). */
    socialSecurityTaxable: numeric("social_security_taxable", { precision: 12, scale: 2 }),
    /** K9 — FEIE §911 excluded amount (Form 2555 Line 45). */
    feieTotalExclusion: numeric("feie_total_exclusion", { precision: 12, scale: 2 }),
    /** K4 — NOL carryforward deducted this year (capped at 80% of taxable income). */
    nolDeduction: numeric("nol_deduction", { precision: 14, scale: 2 }),
    /** K4 — Unused NOL carryforward for next tax year. */
    nolCarryforwardRemaining: numeric("nol_carryforward_remaining", { precision: 14, scale: 2 }),
    /**
     * E2 — Form 8801 AMT credit carryforward (IRC §53). Unused minimum-tax
     * credit at end of this year, carried to next year. Auto-loaded in the
     * pipeline as a synthetic `amt_credit_carryforward` adjustment.
     */
    amtCreditCarryforwardRemaining: numeric("amt_credit_carryforward_remaining", { precision: 14, scale: 2 }),
    /** E2 — Form 8801 minimum-tax credit applied against regular tax this year. */
    amtCreditApplied: numeric("amt_credit_applied", { precision: 14, scale: 2 }),
  /** P2-3 — Form 1116 Schedule B / §904(c) unused foreign tax credit carried
   *  forward to next year. Auto-loaded by the pipeline as a synthetic
   *  `foreign_tax_credit_carryforward` adjustment. */
  foreignTaxCreditCarryforwardRemaining: numeric("foreign_tax_credit_carryforward_remaining", { precision: 14, scale: 2 }),
  /** P2-13 — Form 8839 / §23(c) unused nonrefundable adoption credit carried
   *  forward to next year (5-year life). Auto-loaded by the pipeline as a
   *  synthetic `adoption_credit_carryforward` adjustment. */
  adoptionCreditCarryforwardRemaining: numeric("adoption_credit_carryforward_remaining", { precision: 14, scale: 2 }),
  /** P2 — §163(d)(2) disallowed investment interest carried forward indefinitely.
   *  Auto-loaded by the pipeline as a synthetic `investment_interest_carryforward`. */
  investmentInterestCarryforwardRemaining: numeric("investment_interest_carryforward_remaining", { precision: 14, scale: 2 }),
  /** P2 — §39 §41 R&D general-business-credit carried forward (§38-disallowed).
   *  Auto-loaded by the pipeline as a synthetic `rd_credit_carryforward`. */
  rdCreditCarryforwardRemaining: numeric("rd_credit_carryforward_remaining", { precision: 14, scale: 2 }),
  /** P2 — §39 §51 WOTC + §45S FMLA general-business-credit carried forward
   *  (§38-disallowed). Auto-loaded by the pipeline as a synthetic
   *  `general_business_credit_carryforward` adjustment (mirrors the §41 R&D one). */
  otherGeneralBusinessCreditCarryforwardRemaining: numeric("other_general_business_credit_carryforward_remaining", { precision: 14, scale: 2 }),
  /** P2 — §179(b)(3)(B) income-limit carryforward from the Schedule C asset-
   *  register calculator. Auto-loaded by the pipeline as a synthetic
   *  `schedule_c_section179_carryforward` adjustment (mirrors the §41/§51 ones). */
  scheduleCSection179CarryforwardRemaining: numeric("schedule_c_section179_carryforward_remaining", { precision: 14, scale: 2 }),
    /**
     * E2 — Form 8801 minimum-tax credit generated this year (IRC §53(b)).
     * Simplified model: equals `amtTax` (treats all AMT as deferral). CPA can
     * override the carryforward directly via the `amt_credit_carryforward`
     * adjustment for unusual cases where AMT was driven by exclusion items
     * (state-tax preference only, etc.) that don't generate credit.
     */
    amtCreditGenerated: numeric("amt_credit_generated", { precision: 14, scale: 2 }),
    /**
     * E3 — Cash charitable contribution carryforward (IRC §170(d)(1)).
     * Excess of (current-year cash + unused prior carryforward) above the
     * 60% AGI cap, carried forward to next year (5-year life per IRS rule —
     * we don't track vintage). Property-charitable carryforward (30% AGI
     * cap path) is NOT yet modeled.
     */
    charitableCarryforwardCashRemaining: numeric("charitable_carryforward_cash_remaining", { precision: 14, scale: 2 }),
    /** K7 — §1202 QSBS gross gain (gross long-term capital gain on QSBS sale). */
    qsbsGrossGain: numeric("qsbs_gross_gain", { precision: 14, scale: 2 }),
    /** K7 — §1202 excluded amount. */
    qsbsSection1202Exclusion: numeric("qsbs_section_1202_exclusion", { precision: 14, scale: 2 }),
    /** K7 — §1202 taxable remainder added to LTCG. */
    qsbsTaxableGain: numeric("qsbs_taxable_gain", { precision: 14, scale: 2 }),
    // Credits
    eitc: numeric("eitc", { precision: 12, scale: 2 }),
    aocCredit: numeric("aoc_credit", { precision: 12, scale: 2 }),
    aocRefundablePortion: numeric("aoc_refundable_portion", { precision: 12, scale: 2 }),
    llcCredit: numeric("llc_credit", { precision: 12, scale: 2 }),
    saversCredit: numeric("savers_credit", { precision: 12, scale: 2 }),
    dependentCareCredit: numeric("dependent_care_credit", { precision: 12, scale: 2 }),
    // Schedule C
    scheduleCExpenses: numeric("schedule_c_expenses", { precision: 12, scale: 2 }),
    // Phase 1.5: above-the-line deductions
    educatorExpensesDeduction: numeric("educator_expenses_deduction", { precision: 12, scale: 2 }),
    studentLoanInterestDeduction: numeric("student_loan_interest_deduction", { precision: 12, scale: 2 }),
    // Phase 1.5: credits
    foreignTaxCredit: numeric("foreign_tax_credit", { precision: 12, scale: 2 }),
    residentialEnergyCredits: numeric("residential_energy_credits", { precision: 12, scale: 2 }),
    /** Net Premium Tax Credit (Form 8962). Positive = refundable; negative = excess advance owed (capped). */
    premiumTaxCredit: numeric("premium_tax_credit", { precision: 12, scale: 2 }),
    // Phase 2b: Capital loss against ordinary income + carryforwards
    /** Capital loss deducted against ordinary income (Schedule D Line 21), $3k/$1.5k cap */
    capitalLossDeducted: numeric("capital_loss_deducted", { precision: 12, scale: 2 }),
    /** Short-term capital loss carryforward to next tax year */
    capitalLossCarryforwardShort: numeric("capital_loss_carryforward_short", { precision: 12, scale: 2 }),
    /** Long-term capital loss carryforward to next tax year */
    capitalLossCarryforwardLong: numeric("capital_loss_carryforward_long", { precision: 12, scale: 2 }),
    /** Net capital gain or loss (Schedule D Line 16), post-netting */
    netCapitalGainLoss: numeric("net_capital_gain_loss", { precision: 12, scale: 2 }),
    /** State retirement-income exemption (PA, IL, MS exempt qualified retirement) */
    stateRetirementExemption: numeric("state_retirement_exemption", { precision: 12, scale: 2 }),
    // Phase 2e: Schedule E rental real estate
    /** Schedule E gross net (rental income - expenses - depreciation - prior carryforward) */
    scheduleERentalGrossNet: numeric("schedule_e_rental_gross_net", { precision: 12, scale: 2 }),
    /** Net rental amount applied to AGI (after §469 PAL limit) */
    scheduleERentalAppliedToAgi: numeric("schedule_e_rental_applied_to_agi", { precision: 12, scale: 2 }),
    /** §469 passive loss allowance applied this year */
    scheduleEPalAllowance: numeric("schedule_e_pal_allowance", { precision: 12, scale: 2 }),
    /** §469 passive loss suspended to next year */
    scheduleEPassiveLossSuspended: numeric("schedule_e_passive_loss_suspended", { precision: 12, scale: 2 }),
    // Phase B+: Schedule K-1 passive bucket carryforward
    /** §469 K-1 passive activity loss suspended to next year (no $25k allowance — non-rental-RE passive). */
    k1PassiveLossSuspended: numeric("k1_passive_loss_suspended", { precision: 12, scale: 2 }),
    // Phase B+: Local income tax (NYC + E14 MD/OH/IN)
    /** Net local-jurisdiction income tax. Null when no local jurisdiction applies. */
    localTaxLiability: numeric("local_tax_liability", { precision: 12, scale: 2 }),
    /** The local jurisdiction code this tax was computed for ("NYC", "MD-MONTGOMERY", etc.). */
    localTaxJurisdiction: text("local_tax_jurisdiction"),
    /** E13 — Number of wash sales auto-detected by the engine this tax year (excludes broker-reported "W"). */
    washSalesDetected: integer("wash_sales_detected").notNull().default(0),
    /** E13 — Total $ of capital loss disallowed by auto wash-sale detection (per IRC §1091). */
    washSaleLossDisallowed: numeric("wash_sale_loss_disallowed", { precision: 14, scale: 2 }).notNull().default("0"),
    /** E12 — Tax computed for the prior resident state (formerState) on its pro-rated AGI. 0 when full-year. */
    formerStateTax: numeric("former_state_tax", { precision: 14, scale: 2 }).notNull().default("0"),
    /** E12 — Two-letter code of the prior resident state (formerState). Null when full-year. */
    formerStateCode: text("former_state_code"),
    /** E12 — Days resident in formerState (Jan 1 to changeDate). 0 when full-year. */
    daysFormerStateResident: integer("days_former_state_resident").notNull().default(0),
    /** E12 — Days resident in currentState (changeDate to Dec 31). 0 when full-year. */
    daysCurrentStateResident: integer("days_current_state_resident").notNull().default(0),
    /**
     * C5 — §1031 like-kind exchange (real-property only, post-TCJA).
     * Realized gain across all 1031 exchanges this year (gross gain
     * that would have been recognized in a fully-taxable sale).
     */
    section1031RealizedGain: numeric("section_1031_realized_gain", { precision: 14, scale: 2 }).notNull().default("0"),
    /** C5 — Boot received (cash + non-like-kind property) across all 1031 exchanges. */
    section1031BootReceived: numeric("section_1031_boot_received", { precision: 14, scale: 2 }).notNull().default("0"),
    /** C5 — Recognized gain = min(realized, boot). Added to LTCG this year. */
    section1031RecognizedGain: numeric("section_1031_recognized_gain", { precision: 14, scale: 2 }).notNull().default("0"),
    /** C5 — Deferred gain = realized − recognized. Carries to replacement-property basis. */
    section1031DeferredGain: numeric("section_1031_deferred_gain", { precision: 14, scale: 2 }).notNull().default("0"),
    /**
     * C6 — ISO disqualifying disposition ordinary-income recharacterization.
     * Aggregated across all ISO sales this year that failed the dual
     * 2yr-from-grant + 1yr-from-exercise holding tests (IRC §421(b)/§422).
     * CPA computes per-grant from FMV-at-exercise less strike, capped at
     * (sale price − strike) if a loss. Flows to ordinary income (Form 1040
     * Line 1h "other earned income"). NOT subject to FICA per IRS Notice
     * 2002-47.
     */
    isoDisqualifyingDispositionOrdinary: numeric("iso_disqualifying_disposition_ordinary", { precision: 14, scale: 2 }).notNull().default("0"),
    /**
     * C6 — §423 ESPP disqualifying disposition ordinary-income
     * recharacterization. Aggregated across all ESPP sales this year that
     * failed dual 2yr-from-grant + 1yr-from-purchase tests. CPA computes
     * = FMV-at-purchase − purchase-price (full discount + interim
     * appreciation). Flows to ordinary income. NOT subject to FICA per
     * Rev Rul 71-52 (for §423-qualified plans).
     */
    esppDisqualifyingDispositionOrdinary: numeric("espp_disqualifying_disposition_ordinary", { precision: 14, scale: 2 }).notNull().default("0"),
    /**
     * C7 — §163(j) business-interest-expense gross (CPA-entered, before limit).
     * Source: `section_163j_business_interest_expense` adjustment(s).
     */
    section163jBusinessInterestExpense: numeric("section_163j_business_interest_expense", { precision: 14, scale: 2 }).notNull().default("0"),
    /**
     * C7 — §163(j) allowed business interest deduction this year.
     * = min(gross + prior-year carryforward, 30% × ATI + biz interest income + floor-plan).
     * Subtracted from ordinary income.
     */
    section163jAllowedDeduction: numeric("section_163j_allowed_deduction", { precision: 14, scale: 2 }).notNull().default("0"),
    /**
     * C7 — §163(j) disallowed business interest carried to next year
     * (IRC §163(j)(2) — indefinite carryforward, no time limit, no AGI test).
     */
    section163jDisallowedCarryforward: numeric("section_163j_disallowed_carryforward", { precision: 14, scale: 2 }).notNull().default("0"),
    /**
     * C7 — §461(l) excess business loss disallowed and added back (TCJA).
     * TY2024 threshold: $305,000 single / $610,000 MFJ. CPA pre-computes
     * the excess and enters via `section_461l_excess_loss_addback`
     * adjustment. Disallowed amount carries forward as NOL the following
     * year (CPA enters via `nol_carryforward` next year).
     */
    section461lExcessLossAddback: numeric("section_461l_excess_loss_addback", { precision: 14, scale: 2 }).notNull().default("0"),
    // SCH1 (migration 0015) — surface the T1.1 engine outputs as persisted
    // columns so the results view can disclose them. Additive, nullable-default.
    // T1.1c — state individual-mandate (shared-responsibility) penalty.
    stateIndividualMandatePenalty: numeric("state_individual_mandate_penalty", { precision: 14, scale: 2 }).notNull().default("0"),
    // T1.1a — unrecaptured §1250 gain (25% max rate, Sch D line 19).
    unrecapturedSection1250Gain: numeric("unrecaptured_section_1250_gain", { precision: 14, scale: 2 }).notNull().default("0"),
    // T1.1a — 28%-rate gain: collectibles + taxable §1202 (Sch D line 18).
    collectibles28RateGain: numeric("collectibles_28_rate_gain", { precision: 14, scale: 2 }).notNull().default("0"),
    // T1.2 — Schedule H household-employment tax (FICA + FUTA), Sch 2 line 9.
    householdEmploymentTax: numeric("household_employment_tax", { precision: 14, scale: 2 }).notNull().default("0"),
    /**
     * C4 — Form 1040-X amended-return support.
     *
     * Snapshot of the computed-return values at the moment the CPA
     * marked the original as "filed" (via /lock-as-filed). When
     * non-null, the tax_returns row is treated as the AMENDED state
     * (col c of Form 1040-X); this column is col a; the difference
     * is col b. When NULL, no amendment is in progress.
     *
     * Stored as a JSONB snapshot of the relevant computed fields so
     * future schema changes to tax_returns don't invalidate frozen
     * "originally filed" values. Shape is documented in
     * `lib/form1040x.ts` (FiledSnapshot type).
     */
    originalSnapshot: jsonb("original_snapshot"),
    /** C4 — Form 1040-X Part III explanation. */
    amendmentExplanation: text("amendment_explanation"),
    /** C4 — Timestamp the original snapshot was captured. Null when no amendment in progress. */
    amendmentLockedAt: timestamp("amendment_locked_at", { withTimezone: true }),
    /**
     * DB-02/03 (#14) — precomputed firm-wide planning-ranking columns. Written at
     * recalc time (taxReturnPipeline) by running the planning detectors ONCE per
     * client recalc, so the firm-wide hit-list + dashboard Top-10 widget can rank
     * with a single indexed `ORDER BY planning_score DESC LIMIT n` instead of
     * running the planning engine for every client on every request. Null until
     * the first recalc populates them (or if planning eval failed for the row).
     */
    planningScore: numeric("planning_score", { precision: 14, scale: 2 }),
    /** #14 — Client's federal marginal rate at this return (a planningScore weight); stored for display + audit. */
    planningMarginalRate: numeric("planning_marginal_rate", { precision: 5, scale: 4 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    // One return per (client, year) — enables multi-year tracking
    clientYearUnique: unique("tax_returns_client_year_unique").on(table.clientId, table.taxYear),
    // Deep-audit DB finding: composite index for the dominant query
    // shape — "fetch this client's return for this tax year". The unique
    // constraint above auto-creates an index, but Postgres uses unique-
    // index lookups slightly differently than a plain composite. Explicit
    // index here documents the intent.
    clientYearIdx: index("tax_returns_client_year_idx").on(table.clientId, table.taxYear),
    // DB-03: supports the peer-benchmark AGI-band cohort query (and any analytic
    // read filtering/ordering by AGI). Becomes (firm_id, agi) once tenancy lands.
    agiIdx: index("tax_returns_agi_idx").on(table.adjustedGrossIncome),
    // DB-02/03 (#14): the firm-wide hit-list / dashboard widget rank by
    // `ORDER BY planning_score DESC LIMIT n`. Index it so that's an index scan,
    // not a full-table sort. Becomes (firm_id, planning_score) once tenancy lands.
    planningScoreIdx: index("tax_returns_planning_score_idx").on(table.planningScore),
  }),
);

export const insertTaxReturnSchema = createInsertSchema(taxReturnsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaxReturn = z.infer<typeof insertTaxReturnSchema>;
export type TaxReturn = typeof taxReturnsTable.$inferSelect;
