/**
 * Schedule K-1 CRUD routes.
 *
 * Per-K-1 rows for partnership (1065) and S-corp (1120-S) pass-through
 * entities. When present for a client's tax year, the engine sums per-K-1
 * income across the boxes and flows the totals through the appropriate
 * schedules (Sch E Part II, Sch B, Sch D, Sch SE, §199A).
 */
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, scheduleK1DataTable } from "@workspace/db";
import {
  ListScheduleK1sParams,
  CreateScheduleK1Params,
  CreateScheduleK1Body,
  UpdateScheduleK1Params,
  UpdateScheduleK1Body,
  DeleteScheduleK1Params,
} from "@workspace/api-zod";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";
import { writeAudit } from "../lib/auditLog";

const router: IRouter = Router();

const NUMERIC_FIELDS = [
  "box1OrdinaryIncome",
  "box2RentalRealEstate",
  "box3OtherRentalIncome",
  "interestIncome",
  "ordinaryDividends",
  "qualifiedDividends",
  "royalties",
  "netShortTermCapitalGain",
  "netLongTermCapitalGain",
  "selfEmploymentEarnings",
  "section199aQbi",
  "section199aW2Wages",
  "section199aUbia",
  "basisAtYearStart",
  "basisAtYearEnd",
  "atRiskAmount",
] as const;

/** Convert numeric DB strings to JS numbers for response. */
function mapK1(r: typeof scheduleK1DataTable.$inferSelect) {
  const out: Record<string, unknown> = { ...r };
  for (const f of NUMERIC_FIELDS) {
    const v = (r as Record<string, unknown>)[f];
    if (v != null) out[f] = Number(v as string);
  }
  return out;
}

router.get("/clients/:clientId/k1s", async (req, res): Promise<void> => {
  const params = ListScheduleK1sParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const records = await db
    .select()
    .from(scheduleK1DataTable)
    .where(eq(scheduleK1DataTable.clientId, params.data.clientId));
  res.json(records.map(mapK1));
});

router.post("/clients/:clientId/k1s", async (req, res): Promise<void> => {
  const params = CreateScheduleK1Params.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateScheduleK1Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const insertData: Record<string, unknown> = { ...parsed.data, clientId: params.data.clientId };
  for (const f of NUMERIC_FIELDS) {
    if (insertData[f] != null) insertData[f] = String(insertData[f]);
  }
  const [record] = await db
    .insert(scheduleK1DataTable)
    .values(insertData as typeof scheduleK1DataTable.$inferInsert)
    .returning();
  await writeAudit({
    clientId: params.data.clientId,
    action: "create",
    entityType: "adjustment",
    entityId: record.id,
    after: record,
    source: "schedule K-1 created",
  });
  await recalculateAfterMutation(params.data.clientId);
  res.status(201).json(mapK1(record));
});

router.patch("/clients/:clientId/k1s/:k1Id", async (req, res): Promise<void> => {
  const params = UpdateScheduleK1Params.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateScheduleK1Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  for (const f of NUMERIC_FIELDS) {
    if (updateData[f] != null) updateData[f] = String(updateData[f]);
  }
  const [before] = await db
    .select()
    .from(scheduleK1DataTable)
    .where(
      and(
        eq(scheduleK1DataTable.id, params.data.k1Id),
        eq(scheduleK1DataTable.clientId, params.data.clientId),
      ),
    );
  const [record] = await db
    .update(scheduleK1DataTable)
    .set(updateData)
    .where(
      and(
        eq(scheduleK1DataTable.id, params.data.k1Id),
        eq(scheduleK1DataTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "K-1 not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "update",
    entityType: "adjustment",
    entityId: record.id,
    before,
    after: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.json(mapK1(record));
});

router.delete("/clients/:clientId/k1s/:k1Id", async (req, res): Promise<void> => {
  const params = DeleteScheduleK1Params.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .delete(scheduleK1DataTable)
    .where(
      and(
        eq(scheduleK1DataTable.id, params.data.k1Id),
        eq(scheduleK1DataTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "K-1 not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "delete",
    entityType: "adjustment",
    entityId: record.id,
    before: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.sendStatus(204);
});

export default router;
