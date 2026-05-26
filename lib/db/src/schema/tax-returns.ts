import { pgTable, text, serial, integer, numeric, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taxReturnsTable = pgTable(
  "tax_returns",
  {
    id: serial("id").primaryKey(),
    clientId: integer("client_id").notNull(),
    taxYear: integer("tax_year").notNull(),
    filingStatus: text("filing_status"),
    totalIncome: numeric("total_income", { precision: 12, scale: 2 }),
    adjustedGrossIncome: numeric("adjusted_gross_income", { precision: 12, scale: 2 }),
    standardDeduction: numeric("standard_deduction", { precision: 12, scale: 2 }),
    itemizedDeductions: numeric("itemized_deductions", { precision: 12, scale: 2 }),
    taxableIncome: numeric("taxable_income", { precision: 12, scale: 2 }),
    federalTaxLiability: numeric("federal_tax_liability", { precision: 12, scale: 2 }),
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
    // Phase B+: Local income tax (NYC for now)
    /** Net local-jurisdiction income tax (e.g. NYC personal income tax). Null when no local jurisdiction applies. */
    localTaxLiability: numeric("local_tax_liability", { precision: 12, scale: 2 }),
    /** The local jurisdiction this tax was computed for ("NYC", etc.). */
    localTaxJurisdiction: text("local_tax_jurisdiction"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    // One return per (client, year) — enables multi-year tracking
    clientYearUnique: unique("tax_returns_client_year_unique").on(table.clientId, table.taxYear),
  }),
);

export const insertTaxReturnSchema = createInsertSchema(taxReturnsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTaxReturn = z.infer<typeof insertTaxReturnSchema>;
export type TaxReturn = typeof taxReturnsTable.$inferSelect;
