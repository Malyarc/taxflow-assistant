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

  const taxReturns = await db.select().from(taxReturnsTable);
  const completedReturns = taxReturns.filter((r) => r.federalRefundOrOwed != null);
  const pendingReturns = Number(clientCount?.count ?? 0) - completedReturns.length;

  const refunds = completedReturns.filter((r) => Number(r.federalRefundOrOwed) > 0);
  const owed = completedReturns.filter((r) => Number(r.federalRefundOrOwed) < 0);

  const totalRefunds = refunds.reduce((sum, r) => sum + Number(r.federalRefundOrOwed), 0);
  const totalOwed = owed.reduce((sum, r) => sum + Math.abs(Number(r.federalRefundOrOwed)), 0);
  const averageRefund = refunds.length > 0 ? totalRefunds / refunds.length : null;

  res.json({
    totalClients: Number(clientCount?.count ?? 0),
    pendingReturns: Math.max(0, pendingReturns),
    completedReturns: completedReturns.length,
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
