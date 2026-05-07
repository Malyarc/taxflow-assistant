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
    additionalChildTaxCredit: numeric("additional_child_tax_credit", { precision: 12, scale: 2 }),
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
