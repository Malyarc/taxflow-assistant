/**
 * Phase H — H5: client asset balance CRUD routes.
 *
 * Per-account asset tracking (IRA / Roth / 401(k) / HSA / 529 / etc.).
 * Used by H6 Form 8606 (IRA basis), H1 NUA (employer stock), and
 * H1 Mega-Backdoor Roth (after-tax 401(k)).
 *
 * Engine read path: ClientFacts.assetBalances is populated by
 * loadTaxReturnInputs when present; detectors that depend on asset
 * data check for the relevant entries (e.g., G1.16 Mega-Backdoor Roth
 * needs a 401k_after_tax row).
 */
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, assetBalancesTable } from "@workspace/db";
import {
  ListAssetBalancesParams,
  CreateAssetBalanceParams,
  CreateAssetBalanceBody,
  UpdateAssetBalanceParams,
  UpdateAssetBalanceBody,
  DeleteAssetBalanceParams,
} from "@workspace/api-zod";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";
import { writeAudit } from "../lib/auditLog";

const router: IRouter = Router();

/** Coerce numeric DB strings to JS numbers for response. */
function mapAsset(r: typeof assetBalancesTable.$inferSelect) {
  return {
    ...r,
    balance: r.balance != null ? Number(r.balance) : 0,
    costBasis: r.costBasis != null ? Number(r.costBasis) : null,
    afterTaxBasis: r.afterTaxBasis != null ? Number(r.afterTaxBasis) : null,
  };
}

router.get("/clients/:clientId/asset-balances", async (req, res): Promise<void> => {
  const params = ListAssetBalancesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const records = await db
    .select()
    .from(assetBalancesTable)
    .where(eq(assetBalancesTable.clientId, params.data.clientId));
  res.json(records.map(mapAsset));
});

router.post("/clients/:clientId/asset-balances", async (req, res): Promise<void> => {
  const params = CreateAssetBalanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateAssetBalanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const insertData: Record<string, unknown> = {
    ...parsed.data,
    clientId: params.data.clientId,
  };
  // Numeric DB columns are stored as strings — coerce.
  for (const f of ["balance", "costBasis", "afterTaxBasis"]) {
    if (insertData[f] != null) insertData[f] = String(insertData[f]);
  }
  const [record] = await db
    .insert(assetBalancesTable)
    .values(insertData as typeof assetBalancesTable.$inferInsert)
    .returning();
  await writeAudit({
    clientId: params.data.clientId,
    action: "create",
    entityType: "asset_balance",
    entityId: record.id,
    after: record,
    source: "asset balance created",
  });
  await recalculateAfterMutation(params.data.clientId);
  res.status(201).json(mapAsset(record));
});

router.patch("/clients/:clientId/asset-balances/:assetId", async (req, res): Promise<void> => {
  const params = UpdateAssetBalanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAssetBalanceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  for (const f of ["balance", "costBasis", "afterTaxBasis"]) {
    if (updateData[f] != null) updateData[f] = String(updateData[f]);
  }
  const [before] = await db
    .select()
    .from(assetBalancesTable)
    .where(
      and(
        eq(assetBalancesTable.id, params.data.assetId),
        eq(assetBalancesTable.clientId, params.data.clientId),
      ),
    );
  const [record] = await db
    .update(assetBalancesTable)
    .set(updateData)
    .where(
      and(
        eq(assetBalancesTable.id, params.data.assetId),
        eq(assetBalancesTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "Asset balance not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "update",
    entityType: "asset_balance",
    entityId: record.id,
    before,
    after: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.json(mapAsset(record));
});

router.delete("/clients/:clientId/asset-balances/:assetId", async (req, res): Promise<void> => {
  const params = DeleteAssetBalanceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .delete(assetBalancesTable)
    .where(
      and(
        eq(assetBalancesTable.id, params.data.assetId),
        eq(assetBalancesTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "Asset balance not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "delete",
    entityType: "asset_balance",
    entityId: record.id,
    before: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.sendStatus(204);
});

export default router;
