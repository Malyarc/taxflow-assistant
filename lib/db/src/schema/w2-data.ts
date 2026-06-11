import { pgTable, text, serial, integer, numeric, timestamp, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";
import { taxDocumentsTable } from "./tax-documents";

export const w2DataTable = pgTable(
  "w2_data",
  {
    id: serial("id").primaryKey(),
    // Deep-audit DB finding: FK + cascade to clients (deletes clean up W-2s).
    clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    // Deep-audit DB finding: FK with set-null so deleting the source document
    // doesn't cascade-delete the W-2 row (CPA might have approved the data
    // already; we just lose the link to the source PDF/image).
    documentId: integer("document_id").references(() => taxDocumentsTable.id, { onDelete: "set null" }),
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
    /**
     * T1.0j (M-5) — W-2 extraction depth. Box 10 dependent-care benefits.
     * PERSISTED ONLY for now: the engine has no dependent-care-benefits concept
     * yet (the §21 credit reads the `dependent_care_expenses` adjustment; a DCB
     * exclusion/Form 2441 Part III model is a documented follow-up). Captured so
     * the CPA sees it and nothing is silently lost.
     */
    dependentCareBenefitsBox10: numeric("dependent_care_benefits_box10", { precision: 12, scale: 2 }),
    /** T1.0j (M-5) — Box 12 codes (a–d) as an array of { code, amount } pairs,
     *  e.g. [{"code":"D","amount":23000},{"code":"W","amount":4150}]. Persisted
     *  for CPA reference; not yet auto-wired into the engine. */
    box12Codes: jsonb("box12_codes"),
    /** T1.0j (M-5) — Box 13 "Retirement plan" checkbox. NULL = not extracted.
     *  At document-approve, TRUE suggests setting the client's
     *  iraCoveredByWorkplacePlan flag (drives the §219(g) IRA phase-out) —
     *  applied only when the client flag is currently false (never overwrites). */
    retirementPlanBox13: boolean("retirement_plan_box13"),
    /** T1.0j (M-5) — Boxes 18–20 local wages / local income tax / locality name.
     *  Persisted for CPA reference (the engine's local tax model is driven by
     *  client.localityCode, not per-W-2 boxes). */
    localWagesBox18: numeric("local_wages_box18", { precision: 12, scale: 2 }),
    localTaxBox19: numeric("local_tax_box19", { precision: 12, scale: 2 }),
    localityNameBox20: text("locality_name_box20"),
    /** K1 MFJ sub-gap — which spouse this W-2 belongs to ("taxpayer" or "spouse").
     *  Used only for MFJ per-spouse Sch SE Line 9 SS wage base computation.
     *  Default "taxpayer". Ignored for non-MFJ filing statuses. */
    spouse: text("spouse").notNull().default("taxpayer"),
    /** T2.2 — TRUE when this row is a roll-forward proforma ESTIMATE (copied
     *  from the prior year, no document behind it). The organizer treats
     *  proforma rows as NOT received; any CPA update clears the flag. */
    proforma: boolean("proforma").notNull().default(false),
    /** Per-field bounding boxes in 0-1000 normalized image coordinates (set when AI extracted from image/PDF) */
    fieldBoxes: jsonb("field_boxes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    // Deep-audit DB finding: composite (clientId, taxYear) is the dominant
    // query — every engine load filters by both. Indexing the pair gives
    // the planner a tight nested-loop join with tax_returns.
    clientYearIdx: index("w2_data_client_year_idx").on(table.clientId, table.taxYear),
    documentIdx: index("w2_data_document_id_idx").on(table.documentId),
  }),
);

export const insertW2DataSchema = createInsertSchema(w2DataTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertW2Data = z.infer<typeof insertW2DataSchema>;
export type W2Data = typeof w2DataTable.$inferSelect;
