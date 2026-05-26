/**
 * Unified 1099 form data — supports the 8 most common types:
 *   NEC, MISC, INT, DIV, B, R, G, K
 *
 * One table with all possible columns; per-form fields are NULL when not
 * applicable. The `formType` column discriminates which fields apply.
 */
import { pgTable, text, serial, integer, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const form1099DataTable = pgTable("form_1099_data", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  documentId: integer("document_id"),
  taxYear: integer("tax_year").notNull(),
  /** Which 1099 subtype: nec, misc, int, div, b, r, g, k */
  formType: text("form_type").notNull(),

  // ── Common identifying fields ────────────────────────────────────────
  payerName: text("payer_name"),
  payerTin: text("payer_tin"),
  recipientTin: text("recipient_tin"),

  // ── Common withholding ────────────────────────────────────────────────
  federalTaxWithheld: numeric("federal_tax_withheld", { precision: 12, scale: 2 }),
  stateTaxWithheld: numeric("state_tax_withheld", { precision: 12, scale: 2 }),
  stateCode: text("state_code"),

  // ── 1099-NEC: Nonemployee compensation ──────────────────────────────
  nonemployeeCompensation: numeric("nonemployee_compensation", { precision: 12, scale: 2 }),

  // ── 1099-MISC: Miscellaneous income ─────────────────────────────────
  rents: numeric("rents", { precision: 12, scale: 2 }),
  royalties: numeric("royalties", { precision: 12, scale: 2 }),
  otherIncome: numeric("other_income", { precision: 12, scale: 2 }),
  fishingBoatProceeds: numeric("fishing_boat_proceeds", { precision: 12, scale: 2 }),
  medicalAndHealthcare: numeric("medical_and_healthcare", { precision: 12, scale: 2 }),

  // ── 1099-INT: Interest income ────────────────────────────────────────
  interestIncome: numeric("interest_income", { precision: 12, scale: 2 }),
  earlyWithdrawalPenalty: numeric("early_withdrawal_penalty", { precision: 12, scale: 2 }),
  usTreasuryInterest: numeric("us_treasury_interest", { precision: 12, scale: 2 }),
  taxExemptInterest: numeric("tax_exempt_interest", { precision: 12, scale: 2 }),

  // ── 1099-DIV: Dividends ─────────────────────────────────────────────
  ordinaryDividends: numeric("ordinary_dividends", { precision: 12, scale: 2 }),
  qualifiedDividends: numeric("qualified_dividends", { precision: 12, scale: 2 }),
  totalCapitalGainDistribution: numeric("total_capital_gain_distribution", { precision: 12, scale: 2 }),
  nondividendDistributions: numeric("nondividend_distributions", { precision: 12, scale: 2 }),

  // ── 1099-B: Brokerage / capital gains ───────────────────────────────
  proceeds: numeric("proceeds", { precision: 12, scale: 2 }),
  costBasis: numeric("cost_basis", { precision: 12, scale: 2 }),
  shortTermGainLoss: numeric("short_term_gain_loss", { precision: 12, scale: 2 }),
  longTermGainLoss: numeric("long_term_gain_loss", { precision: 12, scale: 2 }),

  // ── 1099-R: Retirement distributions ────────────────────────────────
  grossDistribution: numeric("gross_distribution", { precision: 12, scale: 2 }),
  taxableAmount: numeric("taxable_amount", { precision: 12, scale: 2 }),
  distributionCode: text("distribution_code"),
  iraSepSimple: text("ira_sep_simple"),

  // ── 1099-G: Government payments ─────────────────────────────────────
  unemploymentCompensation: numeric("unemployment_compensation", { precision: 12, scale: 2 }),
  stateLocalRefund: numeric("state_local_refund", { precision: 12, scale: 2 }),

  // ── 1099-K: Payment card / third-party network ──────────────────────
  grossPaymentAmount: numeric("gross_payment_amount", { precision: 12, scale: 2 }),

  /** Per-field bounding boxes from AI extraction (0–1000 normalized image coords) */
  fieldBoxes: jsonb("field_boxes"),

  /** K1 MFJ sub-gap — which spouse this 1099 belongs to ("taxpayer" or "spouse").
   *  Used only for MFJ per-spouse SE attribution (1099-NEC primarily). Default
   *  "taxpayer". Ignored for non-MFJ filing statuses. */
  spouse: text("spouse").notNull().default("taxpayer"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertForm1099DataSchema = createInsertSchema(form1099DataTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertForm1099Data = z.infer<typeof insertForm1099DataSchema>;
export type Form1099Data = typeof form1099DataTable.$inferSelect;
