import { pgTable, text, serial, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const adjustmentsTable = pgTable("adjustments", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  adjustmentType: text("adjustment_type").notNull().default("deduction"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description").notNull(),
  category: text("category"),
  isApplied: boolean("is_applied").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAdjustmentSchema = createInsertSchema(adjustmentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAdjustment = z.infer<typeof insertAdjustmentSchema>;
export type Adjustment = typeof adjustmentsTable.$inferSelect;
