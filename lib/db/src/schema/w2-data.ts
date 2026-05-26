import { pgTable, text, serial, integer, numeric, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const w2DataTable = pgTable("w2_data", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull(),
  documentId: integer("document_id"),
  taxYear: integer("tax_year").notNull(),
  employerName: text("employer_name"),
  employerEin: text("employer_ein"),
  employeeSSN: text("employee_ssn"),
  wagesBox1: numeric("wages_box1", { precision: 12, scale: 2 }),
  federalTaxWithheldBox2: numeric("federal_tax_withheld_box2", { precision: 12, scale: 2 }),
  socialSecurityWagesBox3: numeric("social_security_wages_box3", { precision: 12, scale: 2 }),
  socialSecurityTaxBox4: numeric("social_security_tax_box4", { precision: 12, scale: 2 }),
  medicareWagesBox5: numeric("medicare_wages_box5", { precision: 12, scale: 2 }),
  medicareTaxBox6: numeric("medicare_tax_box6", { precision: 12, scale: 2 }),
  stateTaxWithheldBox17: numeric("state_tax_withheld_box17", { precision: 12, scale: 2 }),
  stateWagesBox16: numeric("state_wages_box16", { precision: 12, scale: 2 }),
  stateCode: text("state_code"),
  /** K1 MFJ sub-gap — which spouse this W-2 belongs to ("taxpayer" or "spouse").
   *  Used only for MFJ per-spouse Sch SE Line 9 SS wage base computation.
   *  Default "taxpayer". Ignored for non-MFJ filing statuses. */
  spouse: text("spouse").notNull().default("taxpayer"),
  /** Per-field bounding boxes in 0-1000 normalized image coordinates (set when AI extracted from image/PDF) */
  fieldBoxes: jsonb("field_boxes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertW2DataSchema = createInsertSchema(w2DataTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertW2Data = z.infer<typeof insertW2DataSchema>;
export type W2Data = typeof w2DataTable.$inferSelect;
