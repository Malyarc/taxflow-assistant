/**
 * T2.2 D2 — Prior-year roll-forward ("proforma").
 *
 * Copies a client's per-year INPUT rows from tax year N−1 into year N so the
 * CPA doesn't re-key the recurring profile: W-2 employers, 1099 payers, K-1
 * entities, rental properties, and account balances. Dollar amounts copy
 * as prior-year ESTIMATES (classic proforma semantics — they make the
 * projection meaningful and get replaced as documents arrive; the organizer
 * tracks which documents are still outstanding).
 *
 * Carryforwards are NOT copied here — the pipeline already auto-seeds every
 * engine carryforward (capital loss, §469 PAL, NOL, charitable, AMT credit,
 * FTC, §163(j), §179, GBC, adoption) from the persisted year-N−1 return row
 * (`synthesizePriorYearCarryforwards`). The route reports what will seed.
 *
 * NOT rolled: capital transactions (one-time events), tax documents, and any
 * rental property marked fullyDisposedThisYear in the prior year (it's sold).
 * The Schedule C asset register is already all-years (nothing to copy).
 *
 * This module is the PURE row-mapping layer (unit-testable without a DB);
 * the route owns the transaction. Mappers destructure-and-spread the full
 * prior row so NEW schema columns roll forward automatically — only the
 * keys named below are reset.
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
  const { id, createdAt, updatedAt, documentId, fieldBoxes, ...rest } = row;
  void id; void createdAt; void updatedAt; void documentId; void fieldBoxes;
  return { ...rest, taxYear: toYear, documentId: null, fieldBoxes: null };
}

/** 1099: keep payer identity + amounts; detach from the prior-year source document. */
export function rollForward1099(row: Form1099Data, toYear: number): InsertForm1099Data {
  const { id, createdAt, updatedAt, documentId, fieldBoxes, ...rest } = row;
  void id; void createdAt; void updatedAt; void documentId; void fieldBoxes;
  return { ...rest, taxYear: toYear, documentId: null, fieldBoxes: null };
}

/**
 * K-1: the new year OPENS at the prior year's ENDING basis (§705/§1367 roll);
 * per-year facts (ending basis, distributions, separately-stated deductions)
 * reset until the new K-1 arrives.
 */
export function rollForwardK1(row: ScheduleK1Data, toYear: number): InsertScheduleK1Data {
  const { id, createdAt, updatedAt, basisAtYearStart, basisAtYearEnd, ...rest } = row;
  void id; void createdAt; void updatedAt;
  return {
    ...rest,
    taxYear: toYear,
    basisAtYearStart: basisAtYearEnd ?? basisAtYearStart,
    basisAtYearEnd: null,
    distributions: null,
    separatelyStatedDeductions: null,
  };
}

/** A property sold in the prior year does not roll into the new one. */
export function shouldRollRentalProperty(row: Pick<RentalProperty, "fullyDisposedThisYear">): boolean {
  return !row.fullyDisposedThisYear;
}

/**
 * Rental: structural fields + prior P&L as estimates. The disposal flag is a
 * per-year fact (always false in the new year); the per-property suspended-
 * loss column copies as CPA-maintained data (the ENGINE's aggregate §469
 * carryforward auto-seeds separately from the prior return row).
 */
export function rollForwardRental(row: RentalProperty, toYear: number): InsertRentalProperty {
  const { id, createdAt, updatedAt, fullyDisposedThisYear, ...rest } = row;
  void id; void createdAt; void updatedAt; void fullyDisposedThisYear;
  return { ...rest, taxYear: toYear, fullyDisposedThisYear: false };
}

/** Asset balance: the prior year-end balance is the new year's opening baseline. */
export function rollForwardAssetBalance(row: AssetBalance, toYear: number): InsertAssetBalance {
  const { id, createdAt, updatedAt, ...rest } = row;
  void id; void createdAt; void updatedAt;
  return { ...rest, taxYear: toYear };
}
