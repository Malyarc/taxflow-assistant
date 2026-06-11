/**
 * T2.2 D2 — Prior-year roll-forward ("proforma").
 *
 * Copies a client's per-year INPUT rows from tax year N−1 into year N so the
 * CPA doesn't re-key the recurring profile: W-2 employers, 1099 payers, K-1
 * entities, rental properties, and account balances. Dollar amounts copy
 * as prior-year ESTIMATES (classic proforma semantics — they make the
 * projection meaningful and get replaced as documents arrive). Every copied
 * row is flagged `proforma: true`: the organizer treats proforma rows as NOT
 * received, and any CPA update clears the flag (the PATCH routes set
 * proforma=false) — so rolling forward never marks documents as "on file".
 *
 * Carryforwards are NOT copied here — the pipeline already auto-seeds every
 * engine carryforward (capital loss, §469 PAL, NOL, charitable, AMT credit,
 * FTC, §163(j), §179, GBC, adoption) from the persisted year-N−1 return row
 * (`synthesizePriorYearCarryforwards`). The route reports what will seed.
 * The per-property rental `suspendedLossCarryforward` is deliberately NOT
 * rolled either: the engine releases that column under §469(g) on disposal
 * while the aggregate auto-seed flows the SAME dollars through the active
 * §469 path — pre-arming both would deduct the loss twice in a disposal
 * year. The CPA sets the per-property figure deliberately at disposal time.
 *
 * NOT rolled: capital transactions (one-time events), tax documents, and any
 * rental property marked fullyDisposedThisYear in the prior year (it's sold).
 * The Schedule C asset register is already all-years (nothing to copy).
 *
 * This module is the PURE row-mapping layer (unit-testable without a DB);
 * the route owns the transaction. Mappers destructure id/createdAt/updatedAt
 * off the prior row and spread the REST, so NEW schema columns roll forward
 * automatically — only the keys explicitly overridden below are reset.
 */

import type {
  W2Data, InsertW2Data,
  Form1099Data, InsertForm1099Data,
  ScheduleK1Data, InsertScheduleK1Data,
  RentalProperty, InsertRentalProperty,
  AssetBalance, InsertAssetBalance,
} from "@workspace/db";

/** W-2: keep employer identity + amounts; detach from the prior-year source document. */
export function rollForwardW2(row: W2Data, toYear: number): InsertW2Data {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
  return {
    ...rest,
    taxYear: toYear,
    documentId: null,
    fieldBoxes: null,
    // T1.0j — the jsonb select type is `unknown`; re-assert the insert shape
    // (Box 12 code/amount pairs roll forward as estimates like the dollar boxes).
    box12Codes: (row.box12Codes ?? null) as InsertW2Data["box12Codes"],
    proforma: true,
  };
}

/** 1099: keep payer identity + amounts; detach from the prior-year source document. */
export function rollForward1099(row: Form1099Data, toYear: number): InsertForm1099Data {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
  return { ...rest, taxYear: toYear, documentId: null, fieldBoxes: null, proforma: true };
}

/**
 * K-1: the new year OPENS at the prior year's ENDING basis (§705/§1367 roll);
 * per-year facts (ending basis, distributions, separately-stated deductions)
 * reset until the new K-1 arrives.
 */
export function rollForwardK1(row: ScheduleK1Data, toYear: number): InsertScheduleK1Data {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
  return {
    ...rest,
    taxYear: toYear,
    basisAtYearStart: row.basisAtYearEnd ?? row.basisAtYearStart,
    basisAtYearEnd: null,
    distributions: null,
    separatelyStatedDeductions: null,
    proforma: true,
  };
}

/** A property sold in the prior year does not roll into the new one. */
export function shouldRollRentalProperty(row: Pick<RentalProperty, "fullyDisposedThisYear">): boolean {
  return !row.fullyDisposedThisYear;
}

/**
 * Rental: structural fields + prior P&L as estimates. The disposal flag and
 * the per-property suspended-loss column are per-year facts that reset — see
 * the module doc for why pre-arming suspendedLossCarryforward would
 * double-deduct against the engine's aggregate §469 auto-seed.
 */
export function rollForwardRental(row: RentalProperty, toYear: number): InsertRentalProperty {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
  return {
    ...rest,
    taxYear: toYear,
    fullyDisposedThisYear: false,
    suspendedLossCarryforward: null,
    proforma: true,
  };
}

/** Asset balance: the prior year-end balance is the new year's opening baseline. */
export function rollForwardAssetBalance(row: AssetBalance, toYear: number): InsertAssetBalance {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = row;
  return { ...rest, taxYear: toYear, proforma: true };
}
