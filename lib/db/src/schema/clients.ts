import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  filingStatus: text("filing_status").notNull().default("single"),
  state: text("state").notNull(),
  taxYear: integer("tax_year").notNull(),
  /** Number of qualifying children under 17 with SSN (drives Child Tax Credit). */
  dependentsUnder17: integer("dependents_under_17").notNull().default(0),
  /** Other qualifying dependents (drives the $500 Credit for Other Dependents). */
  otherDependents: integer("other_dependents").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
