/**
 * Audit-log helpers — append-only logging of client-scoped mutations.
 *
 * For Option A (CPA-tool overlay) compliance. Every POST/PATCH/DELETE on
 * client-scoped resources writes a row to `audit_log`. Reads (GETs) do NOT
 * write audit entries — that would explode the log.
 *
 * Usage from a route:
 *   await writeAudit({
 *     clientId,
 *     action: "update",
 *     entityType: "w2",
 *     entityId: row.id,
 *     before: rowBeforeUpdate,
 *     after: rowAfterUpdate,
 *   });
 *
 * Errors are logged but NOT propagated to the response — the route succeeds
 * even if audit write fails (we don't want to wedge the API on audit infra
 * problems). When auth lands, that policy should be revisited (failing to
 * audit is itself an issue for compliance).
 */

import { db, auditLogTable } from "@workspace/db";
import { logger } from "./logger";
import { desc, eq } from "drizzle-orm";

export type AuditAction = "create" | "update" | "delete";
export type AuditEntityType =
  | "client"
  | "w2"
  | "form1099"
  | "adjustment"
  | "tax_return"
  | "tax_document";

export interface AuditWriteParams {
  clientId: number;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: number;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  actorUserId?: number | null;
  source?: string | null;
}

export async function writeAudit(params: AuditWriteParams): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      clientId: params.clientId,
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      beforeJson: params.before ?? null,
      afterJson: params.after ?? null,
      source: params.source ?? null,
    });
  } catch (err) {
    logger.error({ err, params }, "writeAudit failed (route response not affected)");
  }
}

/** List audit-log entries for a client, newest first. Capped at `limit`. */
export async function listAuditForClient(clientId: number, limit = 200) {
  return db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.clientId, clientId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
}
