/**
 * Single source of truth for tax return calculation + persistence.
 *
 * Used both by the explicit POST /clients/:id/tax-return route and by every
 * mutation that should auto-recalculate (client patch, W-2 add/edit/delete,
 * adjustment add/edit/delete, AI W-2 extraction).
 *
 * Behavior:
 *   - If a tax return already exists for the client, preserves the user's last
 *     manual settings (taxYear, useItemizedDeductions, additionalIncome=0 default).
 *   - If no return exists, creates one using the client's taxYear and defaults.
 *   - Always upserts (one row per client).
 */

import { eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  w2DataTable,
  adjustmentsTable,
  taxReturnsTable,
} from "@workspace/db";
import { runTaxCalculation } from "./taxCalculator";
import { logger } from "./logger";

export interface RecalcOverrides {
  taxYear?: number;
  additionalIncome?: number;
  additionalDeductions?: number;
  useItemizedDeductions?: boolean;
}

function toNum(val: string | null | undefined): number {
  if (val == null) return 0;
  return Number(val) || 0;
}

export async function recalculateAndUpsertTaxReturn(
  clientId: number,
  overrides: RecalcOverrides = {},
): Promise<typeof taxReturnsTable.$inferSelect | null> {
  // Load client (required)
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  if (!client) {
    logger.warn({ clientId }, "recalculateAndUpsertTaxReturn: client not found");
    return null;
  }

  // Existing return (if any) supplies defaults for fields we haven't been told about
  const [existing] = await db
    .select()
    .from(taxReturnsTable)
    .where(eq(taxReturnsTable.clientId, clientId));

  // Tax year resolution:
  //   1. Explicit override from /tax-return POST
  //   2. Client's current taxYear (source of truth — recalcs follow client edits)
  //   3. Fall back to existing tax return's year only if client.taxYear is missing
  const taxYear = overrides.taxYear ?? client.taxYear ?? existing?.taxYear ?? new Date().getFullYear() - 1;
  const additionalIncome = overrides.additionalIncome ?? 0;
  const useItemizedDeductions =
    overrides.useItemizedDeductions ?? Boolean(existing?.itemizedDeductions);
  const additionalDeductions =
    overrides.additionalDeductions ?? toNum(existing?.itemizedDeductions);

  // Sum W-2 totals
  const w2Records = await db
    .select()
    .from(w2DataTable)
    .where(eq(w2DataTable.clientId, clientId));
  const totalWages = w2Records.reduce((s, r) => s + toNum(r.wagesBox1), 0);
  const totalFederalWithheld = w2Records.reduce(
    (s, r) => s + toNum(r.federalTaxWithheldBox2),
    0,
  );
  const totalStateWithheld = w2Records.reduce(
    (s, r) => s + toNum(r.stateTaxWithheldBox17),
    0,
  );
  // Use the client's state of residence to determine state tax brackets.
  // Falls back to a W-2's stateCode only if client.state is missing/empty.
  // Use || (not ??) so empty strings also fall back.
  // Note: this is a simplification — multi-state filings (resident + non-resident)
  // are not supported. For most single-state filers this is correct.
  const stateCode =
    (client.state && client.state.trim()) ||
    w2Records.find((r) => r.stateCode)?.stateCode ||
    "";

  // Apply CPA-authored adjustments (only "applied" ones)
  const adjustments = await db
    .select()
    .from(adjustmentsTable)
    .where(eq(adjustmentsTable.clientId, clientId));
  const applied = adjustments.filter((a) => a.isApplied);

  const sumByType = (type: string) =>
    applied
      .filter((a) => a.adjustmentType === type)
      .reduce((s, a) => s + toNum(a.amount), 0);

  const deductionAdjustments = sumByType("deduction");
  const creditAdjustments = sumByType("credit");
  const additionalIncomeAdjustments = sumByType("additional_income");
  const withholdingAdjustments = sumByType("withholding_adjustment");
  const otherDeductions = sumByType("other");

  const totalAdditionalIncome = additionalIncome + additionalIncomeAdjustments;
  const aboveTheLineAdjustments = deductionAdjustments + otherDeductions;
  const itemizedDeductions = additionalDeductions;

  const result = runTaxCalculation({
    totalWages,
    additionalIncome: totalAdditionalIncome,
    filingStatus: client.filingStatus,
    stateCode: stateCode ?? "CA",
    useItemizedDeductions,
    itemizedDeductions,
    adjustments: aboveTheLineAdjustments,
    taxYear,
  });

  const federalRefundOrOwed =
    totalFederalWithheld +
    withholdingAdjustments -
    result.federalTaxLiability +
    creditAdjustments;
  const stateRefundOrOwed = totalStateWithheld - result.stateTaxLiability;

  const payload = {
    clientId,
    taxYear: result.taxYear,
    filingStatus: client.filingStatus,
    totalIncome: String(result.totalIncome),
    adjustedGrossIncome: String(result.adjustedGrossIncome),
    standardDeduction: String(result.standardDeduction),
    itemizedDeductions: useItemizedDeductions ? String(itemizedDeductions) : null,
    taxableIncome: String(result.taxableIncome),
    federalTaxLiability: String(result.federalTaxLiability),
    federalTaxWithheld: String(totalFederalWithheld + withholdingAdjustments),
    federalRefundOrOwed: String(federalRefundOrOwed),
    stateTaxLiability: String(result.stateTaxLiability),
    stateTaxWithheld: String(totalStateWithheld),
    stateRefundOrOwed: String(stateRefundOrOwed),
    effectiveTaxRate: String(result.effectiveTaxRate),
  };

  if (existing) {
    const [updated] = await db
      .update(taxReturnsTable)
      .set({ ...payload, updatedAt: new Date() })
      .where(eq(taxReturnsTable.clientId, clientId))
      .returning();
    return updated;
  }
  const [created] = await db.insert(taxReturnsTable).values(payload).returning();
  return created;
}

/**
 * Fire-and-forget recalc — for use after non-blocking mutations where we
 * don't want to slow down the request response. Errors are logged.
 */
export function recalculateInBackground(clientId: number): void {
  recalculateAndUpsertTaxReturn(clientId).catch((err) => {
    logger.error({ err, clientId }, "Background tax-return recalc failed");
  });
}
