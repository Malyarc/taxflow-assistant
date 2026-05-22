import { pgTable, text, serial, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
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
  /** Children eligible for dependent care credit (age 12 and under at year end) */
  dependentsForCareCredit: integer("dependents_for_care_credit").notNull().default(0),
  /** Taxpayer age at year end (drives IRA/HSA catch-up contributions) */
  taxpayerAge: integer("taxpayer_age"),
  /** Spouse age at year end (for joint catch-ups) */
  spouseAge: integer("spouse_age"),
  /** Earned income of spouse (for dependent care credit limit) */
  spouseEarnedIncome: numeric("spouse_earned_income", { precision: 12, scale: 2 }),
  /** HSA family coverage flag (vs self-only) — drives contribution limit */
  hsaIsFamilyCoverage: boolean("hsa_is_family_coverage").notNull().default(false),
  /** Whether taxpayer is covered by a workplace retirement plan — drives IRA deduction phase-out */
  iraCoveredByWorkplacePlan: boolean("ira_covered_by_workplace_plan").notNull().default(false),
  /** Count of eligible K-12 educators (0/1/2). Each eligible educator gets a $300 above-the-line deduction. */
  eligibleEducatorCount: integer("eligible_educator_count").notNull().default(0),
  /** ACA: Form 1095-A annual premium total. Required for PTC reconciliation. */
  acaAnnualPremium: numeric("aca_annual_premium", { precision: 12, scale: 2 }),
  /** ACA: Second Lowest Cost Silver Plan benchmark (annual). Required for PTC reconciliation. */
  acaAnnualSlcsp: numeric("aca_annual_slcsp", { precision: 12, scale: 2 }),
  /** ACA: Advance Premium Tax Credit payments received during the year. */
  acaAdvanceAptc: numeric("aca_advance_aptc", { precision: 12, scale: 2 }),
  /** ACA: Household size for FPL determination. Defaults to filer + dependents if null. */
  acaHouseholdSize: integer("aca_household_size"),
  /** §469 active participation flag for rental real estate (enables $25k special allowance) */
  rentalActiveParticipant: boolean("rental_active_participant").notNull().default(true),
  /** §469 real estate professional flag (750+ hours, >50% time → no PAL limit) */
  rentalRealEstateProfessional: boolean("rental_real_estate_professional").notNull().default(false),
  /** Local income tax jurisdiction (CPA's domicile + 183-day determination). Currently supported: "NYC". Null = no local income tax. */
  localityCode: text("locality_code"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
