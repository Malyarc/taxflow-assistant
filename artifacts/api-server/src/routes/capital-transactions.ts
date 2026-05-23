/**
 * Schedule D / Form 8949 per-transaction CRUD routes.
 *
 * When transactions exist for a client's tax year, the engine uses them as
 * the source of truth for Schedule D aggregation (replacing the 1099-B
 * summary line on form_1099_data). 1099-DIV box 2a capital-gain
 * distributions are NOT overridden — they're a separate stream.
 */
import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, capitalTransactionsTable } from "@workspace/db";
import {
  ListCapitalTransactionsParams,
  CreateCapitalTransactionParams,
  CreateCapitalTransactionBody,
  UpdateCapitalTransactionParams,
  UpdateCapitalTransactionBody,
  DeleteCapitalTransactionParams,
} from "@workspace/api-zod";
import { recalculateAfterMutation } from "../lib/taxReturnPipeline";
import { writeAudit } from "../lib/auditLog";

const router: IRouter = Router();

function mapRow(r: typeof capitalTransactionsTable.$inferSelect) {
  return {
    ...r,
    proceeds: Number(r.proceeds),
    costBasis: Number(r.costBasis),
    adjustmentAmount: Number(r.adjustmentAmount),
    washSaleDisallowed: Number(r.washSaleDisallowed),
  };
}

router.get("/clients/:clientId/capital-transactions", async (req, res): Promise<void> => {
  const params = ListCapitalTransactionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const records = await db
    .select()
    .from(capitalTransactionsTable)
    .where(eq(capitalTransactionsTable.clientId, params.data.clientId));
  res.json(records.map(mapRow));
});

router.post("/clients/:clientId/capital-transactions", async (req, res): Promise<void> => {
  const params = CreateCapitalTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateCapitalTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const insertData: Record<string, unknown> = { ...parsed.data, clientId: params.data.clientId };
  for (const f of ["proceeds", "costBasis", "adjustmentAmount", "washSaleDisallowed"]) {
    if (insertData[f] != null) insertData[f] = String(insertData[f]);
  }
  const [record] = await db
    .insert(capitalTransactionsTable)
    .values(insertData as typeof capitalTransactionsTable.$inferInsert)
    .returning();
  await writeAudit({
    clientId: params.data.clientId,
    action: "create",
    entityType: "capital_transaction",
    entityId: record.id,
    after: record,
    source: "capital transaction created",
  });
  await recalculateAfterMutation(params.data.clientId);
  res.status(201).json(mapRow(record));
});

router.patch("/clients/:clientId/capital-transactions/:transactionId", async (req, res): Promise<void> => {
  const params = UpdateCapitalTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCapitalTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  for (const f of ["proceeds", "costBasis", "adjustmentAmount", "washSaleDisallowed"]) {
    if (updateData[f] != null) updateData[f] = String(updateData[f]);
  }
  const [before] = await db
    .select()
    .from(capitalTransactionsTable)
    .where(
      and(
        eq(capitalTransactionsTable.id, params.data.transactionId),
        eq(capitalTransactionsTable.clientId, params.data.clientId),
      ),
    );
  const [record] = await db
    .update(capitalTransactionsTable)
    .set(updateData)
    .where(
      and(
        eq(capitalTransactionsTable.id, params.data.transactionId),
        eq(capitalTransactionsTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "Capital transaction not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "update",
    entityType: "capital_transaction",
    entityId: record.id,
    before,
    after: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.json(mapRow(record));
});

router.delete("/clients/:clientId/capital-transactions/:transactionId", async (req, res): Promise<void> => {
  const params = DeleteCapitalTransactionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .delete(capitalTransactionsTable)
    .where(
      and(
        eq(capitalTransactionsTable.id, params.data.transactionId),
        eq(capitalTransactionsTable.clientId, params.data.clientId),
      ),
    )
    .returning();
  if (!record) {
    res.status(404).json({ error: "Capital transaction not found" });
    return;
  }
  await writeAudit({
    clientId: params.data.clientId,
    action: "delete",
    entityType: "capital_transaction",
    entityId: record.id,
    before: record,
  });
  await recalculateAfterMutation(params.data.clientId);
  res.sendStatus(204);
});

export default router;
