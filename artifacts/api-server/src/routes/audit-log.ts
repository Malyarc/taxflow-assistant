/**
 * GET /api/clients/:clientId/audit-log — list audit-log entries for a client.
 *
 * Returns newest-first, capped at `limit` (default 200, max 1000) via query.
 * No mutation endpoints — the table is append-only.
 */

import { Router, type IRouter } from "express";
import { listAuditForClient } from "../lib/auditLog";

const router: IRouter = Router();

router.get("/clients/:clientId/audit-log", async (req, res): Promise<void> => {
  const clientIdRaw = req.params.clientId;
  const clientId = Number(clientIdRaw);
  if (!Number.isFinite(clientId) || clientId <= 0 || !Number.isInteger(clientId)) {
    res.status(400).json({ error: "Invalid clientId" });
    return;
  }
  const limitRaw = req.query.limit;
  let limit = 200;
  if (typeof limitRaw === "string") {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && n >= 1 && n <= 1000) limit = Math.floor(n);
  }
  const rows = await listAuditForClient(clientId, limit);
  res.json(rows);
});

export default router;
