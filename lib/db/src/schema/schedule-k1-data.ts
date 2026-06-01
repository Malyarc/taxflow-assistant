/**
 * Schedule K-1 — per-K-1 tracking for partnership (Form 1065) and
 * S-corp (Form 1120-S) pass-throughs.
 *
 * One row per K-1 per tax year. When rows exist for a client+taxYear, the
 * engine sums per-K-1 income across the boxes and flows them to:
 *   - Schedule E Part II → 1040 Line 8 (ordinary biz income, royalties)
 *   - Schedule B (interest, ordinary + qualified dividends)
 *   - Schedule D (ST/LT capital gains)
 *   - Schedule SE (partnership Box 14A self-employment earnings only;
 *     S-corp K-1 income is NOT subject to SE tax)
 *   - §199A QBI calc (Box 20 Z on 1065 / Box 17 V on 1120-S)
 *   - §469 PAL: passive K-1 losses are netted within the K-1 passive bucket;
 *     a net passive loss carries forward as `k1_passive_loss_carryforward`
 *     (NO $25k special allowance — that is rental-RE active-participation only)
 *
 * Not modeled (intentional simplification, documented in CLAUDE.md known limits):
 *   - §199A W-2-wage + UBIA limit (only binds above the income threshold)
 *   - §199A SSTB phase-out
 *   - Basis / at-risk limits (we store the fields, but enforce neither)
 *   - Cross-bucketing of K-1 passive vs. rental-RE passive under Form 8582
 *     (currently keep K-1 and rental-RE in separate passive buckets)
 *
 * Sources: 1065 K-1 instructions, 1120-S K-1 instructions, Form 8995-A
 * instructions, IRS Pub 541, IRS Pub 925 (§469).
 */
import { pgTable, text, serial, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const scheduleK1DataTable = pgTable("schedule_k1_data", {
  id: serial("id").primaryKey(),
  // Deep-audit DB finding: FK + cascade so deleting a client cleans up K-1s.
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  taxYear: integer("tax_year").notNull(),

  // ── Entity identity ────────────────────────────────────────────────
  /** Entity name — human label (e.g. "Acme LLC"). */
  entityName: text("entity_name").notNull(),
  /** EIN of the issuing entity (XX-XXXXXXX). Nullable: some K-1s omit. */
  entityEin: text("entity_ein"),
  /** "partnership" (1065 K-1) | "s_corp" (1120-S K-1). */
  entityType: text("entity_type").notNull().default("partnership"),

  // ── §469 classification (CPA's material-participation judgment) ────
  /** "active" | "passive". */
  activityType: text("activity_type").notNull().default("active"),

  // ── Income/loss boxes (per-K-1; engine sums across rows) ───────────
  /** 1065 Box 1 / 1120-S Box 1 — ordinary business income (loss) → Sch E Part II. */
  box1OrdinaryIncome: numeric("box1_ordinary_income", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Box 2 — net rental real estate income (loss). Passive; runs through rental bucket. */
  box2RentalRealEstate: numeric("box2_rental_real_estate", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Box 3 — other net rental income (loss). Passive; runs through K-1 passive bucket. */
  box3OtherRentalIncome: numeric("box3_other_rental_income", { precision: 14, scale: 2 }).notNull().default("0"),
  /**
   * 1065 Box 4 (4a services + 4b capital) — guaranteed payments to a partner
   * under §707(c). Ordinary income to the partner (Sch E Part II → 1040 Line 8),
   * EXCLUDED from QBI per §199A(c)(4), and SE-taxable for a service partner.
   * Box 14A on a real 1065 K-1 already INCLUDES the guaranteed payment, so the
   * engine takes max(Box 14A, Box 4) for the SE base — GP is captured even if
   * Box 14A is left blank, and not double-counted when Box 14A includes it.
   * S-corp K-1s have no guaranteed payments (leave $0).
   */
  box4GuaranteedPayments: numeric("box4_guaranteed_payments", { precision: 14, scale: 2 }).notNull().default("0"),
  /** 1065 Box 5 / 1120-S Box 4 — interest income. */
  interestIncome: numeric("interest_income", { precision: 14, scale: 2 }).notNull().default("0"),
  /** 1065 Box 6a / 1120-S Box 5a — ordinary dividends. */
  ordinaryDividends: numeric("ordinary_dividends", { precision: 14, scale: 2 }).notNull().default("0"),
  /** 1065 Box 6b / 1120-S Box 5b — qualified dividends (LTCG rate). */
  qualifiedDividends: numeric("qualified_dividends", { precision: 14, scale: 2 }).notNull().default("0"),
  /** 1065 Box 7 / 1120-S Box 6 — royalties. */
  royalties: numeric("royalties", { precision: 14, scale: 2 }).notNull().default("0"),
  /** 1065 Box 8 / 1120-S Box 7 — net short-term capital gain (loss). */
  netShortTermCapitalGain: numeric("net_short_term_capital_gain", { precision: 14, scale: 2 }).notNull().default("0"),
  /** 1065 Box 9a / 1120-S Box 8a — net long-term capital gain (loss). */
  netLongTermCapitalGain: numeric("net_long_term_capital_gain", { precision: 14, scale: 2 }).notNull().default("0"),

  // ── Self-employment (partnership K-1 only) ─────────────────────────
  /** 1065 Box 14A — self-employment earnings (loss). S-corp K-1: leave $0. */
  selfEmploymentEarnings: numeric("self_employment_earnings", { precision: 14, scale: 2 }).notNull().default("0"),

  // ── §199A flow-through (1065 Box 20 code Z / 1120-S Box 17 code V) ──
  /** Qualified business income reported on the K-1 statement. */
  section199aQbi: numeric("section_199a_qbi", { precision: 14, scale: 2 }).notNull().default("0"),
  /** W-2 wages of the pass-through (stored; wage limit not currently enforced). */
  section199aW2Wages: numeric("section_199a_w2_wages", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Unadjusted basis immediately after acquisition (stored; UBIA limit not enforced). */
  section199aUbia: numeric("section_199a_ubia", { precision: 14, scale: 2 }).notNull().default("0"),

  // ── Basis & at-risk (CPA judgment fields — stored, not enforced) ───
  /** Outside (1065) or stock+debt (1120-S) basis at year start. */
  basisAtYearStart: numeric("basis_at_year_start", { precision: 14, scale: 2 }),
  /** Basis at year end. */
  basisAtYearEnd: numeric("basis_at_year_end", { precision: 14, scale: 2 }),
  /** Amount at risk per §465. */
  atRiskAmount: numeric("at_risk_amount", { precision: 14, scale: 2 }),

  /** Optional CPA notes. */
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  // Deep-audit DB finding: composite (clientId, taxYear) for engine load.
  clientYearIdx: index("schedule_k1_data_client_year_idx").on(table.clientId, table.taxYear),
}));

export const insertScheduleK1DataSchema = createInsertSchema(scheduleK1DataTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScheduleK1Data = z.infer<typeof insertScheduleK1DataSchema>;
export type ScheduleK1Data = typeof scheduleK1DataTable.$inferSelect;
