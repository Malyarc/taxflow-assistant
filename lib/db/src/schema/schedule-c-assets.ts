/**
 * Schedule C depreciable assets — the per-asset register that feeds the engine's
 * computeScheduleCAssetDepreciation (Form 4562: §179 + §168(k) bonus + MACRS).
 *
 * One row per asset-per-tax-year. When rows exist for a client+taxYear, the
 * pipeline maps them into TaxReturnInputs.scheduleCAssets; the engine computes
 * §179 (with the §179(b)(3) business-income limit) + bonus + personal-property
 * MACRS and folds the total into the SE-base-reducing schedule_c_depreciation.
 * Depreciation is computed at calc time (never stored) so it recomputes correctly
 * across tax years (multi-year MACRS) without stale data.
 */
import { pgTable, text, serial, integer, numeric, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const scheduleCAssetsTable = pgTable("schedule_c_assets", {
  id: serial("id").primaryKey(),
  // FK + cascade so deleting a client cleans up its assets.
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  taxYear: integer("tax_year").notNull(),

  /** Human label for the asset list (e.g. "Delivery van", "Laptop"). */
  description: text("description").notNull().default(""),
  /** Acquisition cost = depreciable basis (assumes basis = cost). */
  cost: numeric("cost", { precision: 14, scale: 2 }).notNull().default("0"),
  /** GDS recovery period in years: 3 / 5 / 7 / 10 / 15 / 20. */
  recoveryYears: integer("recovery_years").notNull().default(5),
  /** Calendar year placed in service. */
  placedInServiceYear: integer("placed_in_service_year").notNull(),
  /** Calendar quarter placed in service (1-4) — drives the §168(d)(3) mid-quarter test. */
  placedInServiceQuarter: integer("placed_in_service_quarter"),
  /** Elect §179 full expensing (acquisition year only). */
  section179: boolean("section_179").notNull().default(false),
  /** Apply §168(k) bonus to the basis (acquisition year only). */
  bonus: boolean("bonus").notNull().default(false),
  /** OBBBA post-1/19/2025 property → 100% bonus (else the conservative year default). */
  bonusFullObbba: boolean("bonus_full_obbba").notNull().default(false),
  /** Optional CPA notes. */
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  clientYearIdx: index("schedule_c_assets_client_year_idx").on(table.clientId, table.taxYear),
}));

export const insertScheduleCAssetSchema = createInsertSchema(scheduleCAssetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScheduleCAsset = z.infer<typeof insertScheduleCAssetSchema>;
export type ScheduleCAssetRow = typeof scheduleCAssetsTable.$inferSelect;
