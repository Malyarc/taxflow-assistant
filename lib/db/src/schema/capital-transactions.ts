/**
 * Schedule D / Form 8949 per-transaction tracking.
 *
 * Each row is one disposition of a capital asset. When rows exist for a
 * client's tax year, the engine uses them as the source of truth for
 * Schedule D aggregation (replacing the 1099-B summary line on form_1099_data).
 *
 * Form 8949 column mapping:
 *   (a) description          → description
 *   (b) dateAcquired         → dateAcquired (text — supports "VARIOUS", "INHERITED")
 *   (c) dateSold             → dateSold (ISO date)
 *   (d) proceeds             → proceeds
 *   (e) cost or other basis  → costBasis
 *   (f) adjustment code(s)   → adjustmentCode (e.g. "W", "B", "WD", multiple letters allowed)
 *   (g) adjustment amount    → adjustmentAmount (positive; offsets the loss)
 *   (h) gain or (loss)       → computed: proceeds − costBasis + adjustmentAmount
 *
 * formBox routes the row to the right Form 8949 Part I/II box:
 *   A = ST, 1099-B received, basis reported to IRS  (= isCovered)
 *   B = ST, 1099-B received, basis NOT reported to IRS  (noncovered)
 *   C = ST, no 1099-B
 *   D = LT, 1099-B received, basis reported to IRS
 *   E = LT, 1099-B received, basis NOT reported to IRS
 *   F = LT, no 1099-B
 *
 * Wash-sale disallowance (IRC §1091): broker-reported via 1099-B Box 1g
 * and column (f) code "W". `washSaleDisallowed` carries the amount for
 * downstream UI/reporting; the gainLoss already incorporates it via
 * `adjustmentAmount`.
 *
 * E13 — Auto wash-sale detection (in-pipeline): the engine scans the
 * year's transactions and identifies a loss sale + a same-security
 * purchase within ±30 days (61-day window per IRC §1091(a)). For each
 * detected case the engine reverses the loss (increments adjustmentAmount
 * by |loss|), increases the replacement transaction's costBasis by the
 * disallowed amount per IRC §1091(d), and sets `washSaleAutoDetected =
 * true` for the loss row. Broker-reported wash sales (adjustmentCode
 * already contains "W") are honored as-is and NOT re-processed by
 * auto-detection. Note: detection uses the dateAcquired of OTHER
 * dispositions to infer the rebuy — when replacement shares are bought-
 * and-held in the same year (never sold), the auto-detector cannot see
 * them; CPAs should enter those wash sales manually via adjustmentCode
 * = "W" + washSaleDisallowed (documented sub-gap).
 *
 * Source: IRS Form 8949 instructions, Pub 550, Schedule D instructions.
 */
import { pgTable, text, serial, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const capitalTransactionsTable = pgTable("capital_transactions", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  taxYear: integer("tax_year").notNull(),

  /** Description of property — Form 8949 column (a). E.g. "100 sh AAPL". */
  description: text("description").notNull(),
  /** ISO date of acquisition, or "VARIOUS" / "INHERITED" sentinel. */
  dateAcquired: text("date_acquired"),
  /** ISO date of sale/disposition. */
  dateSold: text("date_sold"),

  /** Proceeds from sale (Form 8949 column d). */
  proceeds: numeric("proceeds", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Cost or other basis (column e). */
  costBasis: numeric("cost_basis", { precision: 14, scale: 2 }).notNull().default("0"),

  /** Adjustment code(s) — Form 8949 column f. E.g. "W" for wash sale. */
  adjustmentCode: text("adjustment_code"),
  /** Adjustment amount — Form 8949 column g (positive). */
  adjustmentAmount: numeric("adjustment_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Portion of adjustmentAmount attributable to wash-sale disallowance (informational). */
  washSaleDisallowed: numeric("wash_sale_disallowed", { precision: 14, scale: 2 }).notNull().default("0"),
  /** E13 — TRUE when the wash sale was identified by the engine (not by the
   *  1099-B broker). Distinguishes auto-detected from broker-reported for UI
   *  and audit trail. Set on the LOSS row that was disallowed. */
  washSaleAutoDetected: boolean("wash_sale_auto_detected").notNull().default(false),

  /** Form 8949 box: A/B/C (short-term) or D/E/F (long-term). */
  formBox: text("form_box").notNull().default("A"),

  /** 1099-B Box 12: basis reported to IRS (covered security). */
  isCovered: boolean("is_covered").notNull().default(true),
  /** Did the taxpayer receive a 1099-B for this transaction? */
  received1099B: boolean("received_1099b").notNull().default(true),

  /** Optional CPA notes. */
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCapitalTransactionSchema = createInsertSchema(capitalTransactionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCapitalTransaction = z.infer<typeof insertCapitalTransactionSchema>;
export type CapitalTransaction = typeof capitalTransactionsTable.$inferSelect;
