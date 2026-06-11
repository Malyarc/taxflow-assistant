/**
 * Phase H — H5: client asset balance tracking.
 *
 * One row per (client, tax_year, asset_account). Used by:
 *   - H6 Form 8606: traditional_ira after_tax_basis drives §408(d)(2)
 *     pro-rata exclusion on Roth conversions.
 *   - H1 NUA (G1.15): employer_stock_in_401k cost_basis enables LTCG-vs-
 *     ordinary play on lump-sum distribution.
 *   - H1 Mega-Backdoor Roth (G1.16): 401k_after_tax balance + plan
 *     in-service withdrawal flag.
 *   - Future: RMD planning, Roth conversion sizing, estate planning.
 *
 * Engine reads these via ClientFacts.assetBalances. When unpopulated,
 * detectors that need asset data emit lower-confidence "needs data"
 * hits rather than fire blind.
 */
import { pgTable, text, serial, integer, numeric, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

export const assetBalancesTable = pgTable("client_asset_balances", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
  taxYear: integer("tax_year").notNull(),

  /**
   * Asset category. Engine-visible enum; new values can be added but
   * never repurposed (existing rows reference them).
   *
   * - traditional_ira         pre-tax IRA (Form 5498 box 1)
   * - roth_ira                Roth IRA (Form 5498 box 10)
   * - sep_ira                 SEP-IRA (Form 5498 box 7)
   * - simple_ira              SIMPLE IRA (Form 5498 box 8)
   * - 401k_traditional        pre-tax 401(k) elective deferrals + employer match
   * - 401k_roth               designated Roth 401(k)
   * - 401k_after_tax          after-tax 401(k) contributions (for Mega-Backdoor Roth)
   * - employer_stock_in_401k  NUA-eligible employer stock in a qualified plan
   * - hsa                     Health Savings Account
   * - 529                     529 college-savings plan
   * - brokerage_taxable       taxable brokerage (cost basis tracked separately per lot)
   * - espp_shares             ESPP shares — costBasis = discounted purchase price;
   *                           afterTaxBasis (repurposed) = ordinary income already
   *                           recognized at purchase (15% lookback discount). Drives
   *                           disqualifying-disposition ordinary-income classification.
   * - iso_amt_credit_shares   ISO shares held past disqualifying window — costBasis is
   *                           regular-tax basis, afterTaxBasis is AMT basis. The
   *                           difference is the AMT credit basis recovered as §53
   *                           credit when regular tax > AMT in a future year.
   * - restricted_stock_pre_83b  Restricted stock where the client did NOT make a §83(b)
   *                           election — costBasis = FMV at GRANT date (recorded for
   *                           tracking); ordinary income recognized at VEST per Treas.
   *                           Reg. §1.83-1. Pre-vest balance shows the stock at risk.
   * - crypto                  Crypto (BTC / ETH / etc.). costBasis tracked. IRS treats
   *                           as property (Notice 2014-21); each disposition = taxable
   *                           event. Held > 1 year = LTCG.
   * - real_estate             investment property (separate from rental-properties table)
   * - primary_residence       owner-occupied home (FMV)
   * - other                   catch-all
   */
  assetType: text("asset_type").notNull(),
  /** Human-readable account name (e.g., "Vanguard IRA", "Fidelity 401(k)"). */
  accountName: text("account_name").notNull(),
  /** Current balance / fair market value at year-end. */
  balance: numeric("balance", { precision: 16, scale: 2 }).notNull().default("0"),
  /** Cost basis (for brokerage, employer stock, real estate). */
  costBasis: numeric("cost_basis", { precision: 16, scale: 2 }),
  /**
   * After-tax basis (nondeductible IRA contributions for traditional_ira;
   * after-tax 401(k) contributions for 401k_after_tax). Drives Form 8606
   * §408(d)(2) pro-rata math on Roth conversions.
   */
  afterTaxBasis: numeric("after_tax_basis", { precision: 16, scale: 2 }),
  /**
   * For NUA-eligible employer stock: whether the plan permits a lump-sum
   * distribution with NUA election. CPAs check plan document.
   */
  nuaEligible: boolean("nua_eligible").notNull().default(false),
  /** T2.2 — roll-forward proforma estimate flag (see w2-data.ts). */
  proforma: boolean("proforma").notNull().default(false),

  /** Optional CPA notes (account number partial / institution / restrictions). */
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => ({
  clientYearIdx: index("client_asset_balances_client_year_idx").on(table.clientId, table.taxYear),
}));

export const insertAssetBalanceSchema = createInsertSchema(assetBalancesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAssetBalance = z.infer<typeof insertAssetBalanceSchema>;
export type AssetBalance = typeof assetBalancesTable.$inferSelect;
