/**
 * Schedule E rental real estate — per-property tracking.
 *
 * One row per property-per-year (denormalized for simplicity). Property
 * identity is implicit: CPAs name them by `address`. When a CPA rolls forward
 * to a new tax year they create new rows (copy the structural fields, update
 * income/expense fields for the new year).
 *
 * Engine logic (taxReturnEngine.ts): when rows exist for client+taxYear,
 * the engine sums per-property income, expenses, and computed MACRS
 * depreciation to derive Schedule E net (replacing the legacy aggregate
 * adjustment-based path). When no rows exist, the legacy adjustment path
 * still runs.
 *
 * MACRS depreciation is computed at calc time from basis + placedInService +
 * propertyType; not stored. Lets us recompute correctly across tax years
 * without stale data.
 */
import { pgTable, text, serial, integer, numeric, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const rentalPropertiesTable = pgTable("rental_properties", {
  id: serial("id").primaryKey(),
  // Deep-audit DB finding: FK + cascade so deleting a client cleans up rentals.
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  taxYear: integer("tax_year").notNull(),

  // ── Property identity ────────────────────────────────────────────────
  /** Address — used as the human label in lists. */
  address: text("address").notNull(),
  /** "residential" (27.5-year MACRS) or "commercial" (39-year MACRS). */
  propertyType: text("property_type").notNull().default("residential"),

  // ── MACRS inputs ────────────────────────────────────────────────────
  /** Depreciable basis = cost − land value. Land is not depreciable. */
  basis: numeric("basis", { precision: 14, scale: 2 }),
  /** Year placed in service (e.g., 2018) */
  placedInServiceYear: integer("placed_in_service_year"),
  /** Month placed in service (1–12) — mid-month convention */
  placedInServiceMonth: integer("placed_in_service_month"),

  // ── Days flag (1099-style — used to flag dwelling-unit / personal-use scenarios) ──
  /** Fair-rental-value days (Schedule E asks this). */
  fairRentalDays: integer("fair_rental_days"),
  /** Personal-use days. If >14 days AND >10% of fair-rental days, vacation-home limits apply. */
  personalUseDays: integer("personal_use_days"),

  // ── §469 active participation ────────────────────────────────────────
  /** Active participant (qualifies for the $25k loss allowance, vs purely passive). */
  isActiveParticipant: boolean("is_active_participant").notNull().default(true),

  // ── Current-year P&L ────────────────────────────────────────────────
  /** Rental income (rent received in the year, before any expenses). */
  rentalIncome: numeric("rental_income", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Total expenses excluding depreciation (engine computes depreciation). */
  totalExpenses: numeric("total_expenses", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Optional CPA notes. */
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  // Deep-audit DB finding: composite (clientId, taxYear) for engine load.
  clientYearIdx: index("rental_properties_client_year_idx").on(table.clientId, table.taxYear),
}));

export const insertRentalPropertySchema = createInsertSchema(rentalPropertiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRentalProperty = z.infer<typeof insertRentalPropertySchema>;
export type RentalProperty = typeof rentalPropertiesTable.$inferSelect;
