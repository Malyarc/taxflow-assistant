/**
 * Schedule C depreciable-asset CRUD routes.
 *
 * When asset rows exist for a client's tax year, the pipeline maps them into
 * TaxReturnInputs.scheduleCAssets and the engine computes §179 + bonus + MACRS
 * (computeScheduleCAssetDepreciation), folding the total into the SE-base-reducing
 * schedule_c_depreciation. Every mutation triggers a recalc.
 */
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, scheduleCAssetsTable } from "@workspace/db";
import {
  ListScheduleCAssetsParams,
  CreateScheduleCAssetParams,
  CreateScheduleCAssetBody,
  UpdateScheduleCAssetParams,
  UpdateScheduleCAssetBody,
  DeleteScheduleCAssetParams,
} from "@workspace/api-zod";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";
import { writeAudit } from "../lib/auditLog";

const router: IRouter = Router();

/** Convert the numeric DB string (cost) to a JS number for the response. */
function mapAsset(r: typeof scheduleCAssetsTable.$inferSelect) {
  return { ...r, cost: r.cost != null ? Number(r.cost) : 0 };
}

router.get("/clients/:clientId/schedule-c-assets", async (req, res): Promise<void> => {
  const params = ListScheduleCAssetsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const records = await db
    .select()
    .from(scheduleCAssetsTable)
    .where(eq(scheduleCAssetsTable.clientId, params.data.clientId));
  res.json(records.map(mapAsset));
});

router.post("/clients/:clientId/schedule-c-assets", async (req, res): Promise<void> => {
  const params = CreateScheduleCAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateScheduleCAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const insertData: Record<string, unknown> = { ...parsed.data, clientId: params.data.clientId };
  if (insertData.cost != null) insertData.cost = String(insertData.cost); // numeric stored as string
  if (insertData.businessUsePct != null) insertData.businessUsePct = String(insertData.businessUsePct); // T1.2 §280F numeric
  const [record] = await db
    .insert(scheduleCAssetsTable)
    .values(insertData as typeof scheduleCAssetsTable.$inferInsert)
    .returning();
  await writeAudit({
    clientId: params.data.clientId,
    action: "create",
    entityType: "schedule_c_asset",
    entityId: record.id,
    after: record,
    source: "schedule C asset created",
  });
  await recalculateAfterMutation(params.data.clientId);
  res.status(201).json(mapAsset(record));
});

router.patch("/clients/:clientId/schedule-c-assets/:assetId", async (req, res): Promise<void> => {
  const params = UpdateScheduleCAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateScheduleCAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (updateData.cost != null) updateData.cost = String(updateData.cost);
  if (updateData.businessUsePct != null) updateData.businessUsePct = String(updateData.businessUsePct); // T1.2 §280F numeric
  const [before] = await db
    .select()
    .from(scheduleCAssetsTable)
    .where(
      and(
        eq(scheduleCAssetsTable.id, params.data.assetId),
        eq(scheduleCAssetsTable.clientId, params.data.clientId),
      ),
    );
  const [record] = await db
    .update(scheduleCAssetsTable)
    .set(updateData)
    .where(
      and(
        eq(scheduleCAssetsTable.id, params.data.assetId),
        eq(scheduleCAssetsTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "Schedule C asset not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "update",
    entityType: "schedule_c_asset",
    entityId: record.id,
    before,
    after: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.json(mapAsset(record));
});

router.delete("/clients/:clientId/schedule-c-assets/:assetId", async (req, res): Promise<void> => {
  const params = DeleteScheduleCAssetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .delete(scheduleCAssetsTable)
    .where(
      and(
        eq(scheduleCAssetsTable.id, params.data.assetId),
        eq(scheduleCAssetsTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "Schedule C asset not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "delete",
    entityType: "schedule_c_asset",
    entityId: record.id,
    before: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.sendStatus(204);
});

export default router;
