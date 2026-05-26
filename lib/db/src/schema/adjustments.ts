import { pgTable, text, serial, integer, numeric, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const adjustmentsTable = pgTable("adjustments", {
  id: serial("id").primaryKey(),
  // Deep-audit DB finding: FK + cascade so deleting a client cleans up adjustments.
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  adjustmentType: text("adjustment_type").notNull().default("deduction"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description").notNull(),
  category: text("category"),
  isApplied: boolean("is_applied").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  // Deep-audit DB finding: index on clientId (the dominant filter). The
  // engine loads ALL of a client's adjustments (across years) and filters
  // by isApplied + tax-year in code, so a single-column index is sufficient.
  clientIdx: index("adjustments_client_id_idx").on(table.clientId),
}));

export const insertAdjustmentSchema = createInsertSchema(adjustmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAdjustment = z.infer<typeof insertAdjustmentSchema>;
export type Adjustment = typeof adjustmentsTable.$inferSelect;
