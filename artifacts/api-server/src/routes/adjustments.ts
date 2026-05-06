import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, adjustmentsTable } from "@workspace/db";
import {
  ListAdjustmentsParams,
  CreateAdjustmentParams,
  CreateAdjustmentBody,
  UpdateAdjustmentParams,
  UpdateAdjustmentBody,
  DeleteAdjustmentParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/clients/:clientId/adjustments", async (req, res): Promise<void> => {
  const params = ListAdjustmentsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const adjustments = await db
    .select()
    .from(adjustmentsTable)
    .where(eq(adjustmentsTable.clientId, params.data.clientId));
  res.json(adjustments);
});

router.post("/clients/:clientId/adjustments", async (req, res): Promise<void> => {
  const params = CreateAdjustmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateAdjustmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [adjustment] = await db
    .insert(adjustmentsTable)
    .values({ ...parsed.data, clientId: params.data.clientId, amount: String(parsed.data.amount) })
    .returning();
  res.status(201).json(adjustment);
});

router.patch("/clients/:clientId/adjustments/:adjustmentId", async (req, res): Promise<void> => {
  const params = UpdateAdjustmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAdjustmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.amount !== undefined) {
    updateData.amount = String(parsed.data.amount);
  }
  const [adjustment] = await db
    .update(adjustmentsTable)
    .set(updateData)
    .where(
      and(
        eq(adjustmentsTable.id, params.data.adjustmentId),
        eq(adjustmentsTable.clientId, params.data.clientId)
      )
    )
    .returning();
  if (!adjustment) {
    res.status(404).json({ error: "Adjustment not found" });
    return;
  }
  res.json(adjustment);
});

router.delete("/clients/:clientId/adjustments/:adjustmentId", async (req, res): Promise<void> => {
  const params = DeleteAdjustmentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [adjustment] = await db
    .delete(adjustmentsTable)
    .where(
      and(
        eq(adjustmentsTable.id, params.data.adjustmentId),
        eq(adjustmentsTable.clientId, params.data.clientId)
      )
    )
    .returning();
  if (!adjustment) {
    res.status(404).json({ error: "Adjustment not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
