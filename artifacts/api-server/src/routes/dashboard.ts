import { Router, type IRouter } from "express";
import { desc, sql, inArray } from "drizzle-orm";
import { db, clientsTable, taxReturnsTable, taxDocumentsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const [clientCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(clientsTable);

  // "Processed" = anything that has reached an end state for the CPA workflow.
  // Pre-2026-05-23 this used eq(status, "extracted") which was the LEGACY status
  // before the review-gate landed; the current pipeline emits
  //   processing → pending_review → approved | rejected | failed
  // so the legacy filter permanently returned 0. Treat both as processed for
  // backward compatibility with any historical rows.
  const [docCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(taxDocumentsTable)
    .where(inArray(taxDocumentsTable.status, ["approved", "extracted", "pending_review", "rejected"]));

  // DB-07: aggregate in SQL instead of loading the entire tax_returns table
  // (the widest table in the schema, with two jsonb columns) into JS just to
  // count rows and sum one column. One indexed scan, no row transfer.
  const col = taxReturnsTable.federalRefundOrOwed;
  const [agg] = await db
    .select({
      // "Completed" = DISTINCT clients with at least one computed return. Counting
      // rows here double-counted multi-year clients (e.g. a client with both a
      // TY2024 and TY2025 row counted twice), pushing completedReturns above
      // totalClients so `pendingReturns = max(0, totalClients - completed)` was
      // pinned to 0 by the clamp — masking the true pending count.
      completed: sql<number>`count(distinct ${taxReturnsTable.clientId}) filter (where ${col} is not null)`,
      refundCount: sql<number>`count(*) filter (where ${col} > 0)`,
      totalRefunds: sql<number>`coalesce(sum(${col}) filter (where ${col} > 0), 0)`,
      totalOwed: sql<number>`coalesce(sum(-${col}) filter (where ${col} < 0), 0)`,
    })
    .from(taxReturnsTable);

  const totalClients = Number(clientCount?.count ?? 0);
  const completedReturns = Number(agg?.completed ?? 0);
  const refundCount = Number(agg?.refundCount ?? 0);
  const totalRefunds = Number(agg?.totalRefunds ?? 0);
  const totalOwed = Number(agg?.totalOwed ?? 0);
  const averageRefund = refundCount > 0 ? totalRefunds / refundCount : null;

  res.json({
    totalClients,
    pendingReturns: Math.max(0, totalClients - completedReturns),
    completedReturns,
    totalRefunds,
    totalOwed,
    documentsProcessed: Number(docCount?.count ?? 0),
    averageRefund,
  });
});

router.get("/dashboard/recent-clients", async (_req, res): Promise<void> => {
  const clients = await db
    .select()
    .from(clientsTable)
    .orderBy(desc(clientsTable.updatedAt))
    .limit(10);
  res.json(clients);
});

export default router;
