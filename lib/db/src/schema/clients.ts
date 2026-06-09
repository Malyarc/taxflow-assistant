import { pgTable, text, serial, integer, numeric, boolean, timestamp, index } from "drizzle-orm/pg-core";
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
  /** E1 — count of EITC qualifying children (§32(c)(3): <19, or <24 student —
   *  wider than the CTC's <17). NULL → engine defaults to dependentsUnder17. */
  eitcQualifyingChildren: integer("eitc_qualifying_children"),
  /** Other qualifying dependents (drives the $500 Credit for Other Dependents). */
  otherDependents: integer("other_dependents").notNull().default(0),
  /** Children eligible for dependent care credit (age 12 and under at year end) */
  dependentsForCareCredit: integer("dependents_for_care_credit").notNull().default(0),
  /** Taxpayer age at year end (drives IRA/HSA catch-up contributions) */
  taxpayerAge: integer("taxpayer_age"),
  /** Spouse age at year end (for joint catch-ups) */
  spouseAge: integer("spouse_age"),
  /** Taxpayer is legally blind at year end — extra std-ded box per IRC §63(f)(2). */
  taxpayerBlind: boolean("taxpayer_blind").notNull().default(false),
  /** Spouse is legally blind at year end (MFJ/QSS) — extra std-ded box per IRC §63(f)(2). */
  spouseBlind: boolean("spouse_blind").notNull().default(false),
  /** Earned income of spouse (for dependent care credit limit) */
  spouseEarnedIncome: numeric("spouse_earned_income", { precision: 12, scale: 2 }),
  /** HSA family coverage flag (vs self-only) — drives contribution limit */
  hsaIsFamilyCoverage: boolean("hsa_is_family_coverage").notNull().default(false),
  /** Whether taxpayer is covered by a workplace retirement plan — drives IRA deduction phase-out */
  iraCoveredByWorkplacePlan: boolean("ira_covered_by_workplace_plan").notNull().default(false),
  // E4 (migration 0016) — §219(g)(7): taxpayer not covered but spouse is.
  iraSpouseCoveredByWorkplacePlan: boolean("ira_spouse_covered_by_workplace_plan").notNull().default(false),
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
  /** K10 — Social Security benefits received (Box 5 of SSA-1099 + RRB-1099).
   *  Used for the Pub 915 worksheet to determine 0/50/85% taxable portion.
   *  Null/0 = no SS benefits. */
  socialSecurityBenefits: numeric("social_security_benefits", { precision: 12, scale: 2 }),
  /** K10 — For MFS filers only: TRUE if the filer lived APART from their
   *  spouse for the entire tax year. Default FALSE (the conservative
   *  default — MFS-with-spouse means $0 SS-taxability threshold and 85%
   *  of SS is taxable). Per Pub 915. */
  mfsLivedApartAllYear: boolean("mfs_lived_apart_all_year").notNull().default(false),
  /** K8 — Kiddie tax (Form 8615): TRUE if the return is for a child whose
   *  unearned income > $2,600 (TY2024) is taxed at the parent's marginal
   *  rate. CPA confirms eligibility (child < age 18, or 18-23 if full-time
   *  student dependent on parents). */
  isKiddieTaxFiler: boolean("is_kiddie_tax_filer").notNull().default(false),
  /** E3b — IRC §63(c)(5): this taxpayer can be claimed as a dependent on another
   *  return → limited standard deduction (greater of the floor or earned income
   *  + $450, capped at the regular amount). isKiddieTaxFiler also implies this. */
  claimedAsDependent: boolean("claimed_as_dependent").notNull().default(false),
  /** K8 — Parent's top marginal rate for the Form 8615 computation
   *  (0.10 / 0.12 / 0.22 / 0.24 / 0.32 / 0.35 / 0.37). Required when
   *  isKiddieTaxFiler = TRUE. */
  parentsTopMarginalRate: numeric("parents_top_marginal_rate", { precision: 5, scale: 4 }),
  /** E6 — Pub 525 / IRC §111 tax-benefit rule. When NULL, pipeline auto-
   *  derives from prior-year tax_returns (itemized > std ded). Explicit
   *  true/false overrides — used when migrating in mid-stream and prior
   *  return wasn't computed in TaxFlow. Defaults NULL (auto-derive). */
  priorYearItemized: boolean("prior_year_itemized"),
  /** E12 — Part-year residency. TRUE when filer moved between states during
   *  the tax year. When TRUE, formerState + residencyChangeDate must also
   *  be set; engine pro-rates AGI by days and computes resident-state tax
   *  for each period independently. */
  residencyChangedInYear: boolean("residency_changed_in_year").notNull().default(false),
  /** E12 — Two-letter code of the state the filer was resident in BEFORE
   *  the move. (clients.state = current resident state after the move.) */
  formerState: text("former_state"),
  /** E12 — ISO date (YYYY-MM-DD) of residency change. Filer was former-
   *  state resident from Jan 1 to this date (exclusive); current-state
   *  resident from this date (inclusive) to Dec 31. */
  residencyChangeDate: text("residency_change_date"),
  /** Phase H — H9. Client-context fields that personalize planning
   *  recommendations (especially the AI memo). All optional; absent =
   *  CPA hasn't gathered the data yet. */
  /** "conservative" | "moderate" | "aggressive" — drives e.g. how
   *  aggressively to recommend Roth conversions, charitable bunching,
   *  illiquid investments. */
  riskTolerance: text("risk_tolerance"),
  /** Target retirement age (integer years). Used by retirement-strategy
   *  detectors to evaluate time-horizon-sensitive recommendations
   *  (Roth conversion runway, RMD planning, etc.). */
  targetRetirementAge: integer("target_retirement_age"),
  /** "none" | "will_only" | "trust_in_place" | "complex". Drives
   *  estate-tax / gifting strategy recommendations. */
  estatePlanStage: text("estate_plan_stage"),
  /** Free-text client-specific planning goals (e.g., "buy a house in 2
   *  years", "fund child's college via 529", "early retirement at 55").
   *  Passed to the AI memo synthesis prompt. */
  planningGoals: text("planning_goals"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  // DB-06/DB-08: GET /clients + /dashboard/recent-clients ORDER BY updated_at DESC
  // — without this every list/dashboard load is a full seq-scan + sort.
  updatedAtIdx: index("clients_updated_at_idx").on(table.updatedAt),
  // DB-04: speed up find-by-email. NON-unique on purpose — the data already has
  // duplicate emails (test rows), and the correct long-term model is a per-firm
  // unique index (firm_id, lower(email)) once tenancy lands. Dedup before UNIQUE.
  emailIdx: index("clients_email_idx").on(table.email),
}));

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
