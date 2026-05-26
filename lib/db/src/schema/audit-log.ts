import { pgTable, text, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

/**
 * Audit log — append-only record of every mutation to client-scoped data.
 *
 * Required for CPA-firm compliance (the Option A use case). Every POST,
 * PATCH, DELETE on clients / W-2 / 1099 / adjustments / tax_returns /
 * tax_documents writes a row here. Auth is not yet built, so actorUserId
 * is nullable; when the multi-user model lands, the route writes the
 * authenticated user's id.
 *
 * `entityType` is one of: "client", "w2", "form1099", "adjustment",
 * "tax_return", "tax_document".
 *
 * `action` is one of: "create", "update", "delete".
 *
 * `beforeJson` and `afterJson` capture row snapshots at the time of the
 * mutation. For creates: beforeJson NULL, afterJson = inserted row. For
 * updates: both. For deletes: beforeJson = pre-delete row, afterJson NULL.
 *
 * Never delete or update rows in this table. SQL grants should enforce
 * append-only at the DB level once the auth model is in (CPA firms expect
 * this for audit defense).
 */
export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  /**
   * Client this audit entry pertains to. Set to NULL when the client is
   * deleted (NOT cascaded — that would wipe the forensic trail). Audit
   * rows persist past client deletion; the snapshot in `beforeJson`
   * carries the historical client identity.
   *
   * Pre-2026-05-23 this used `onDelete: "cascade"` which destroyed
   * evidence on client delete — that integrity bug is fixed here.
   */
  clientId: integer("client_id")
    .references(() => clientsTable.id, { onDelete: "set null" }),
  /** Authenticated user id at time of mutation. Nullable until auth lands. */
  actorUserId: integer("actor_user_id"),
  /** "create" | "update" | "delete" */
  action: text("action").notNull(),
  /** "client" | "w2" | "form1099" | "adjustment" | "tax_return" | "tax_document" */
  entityType: text("entity_type").notNull(),
  /** Primary key of the affected row (0 for creates that haven't yet been assigned an id). */
  entityId: integer("entity_id").notNull(),
  /** Snapshot of the row before the mutation. NULL for creates. */
  beforeJson: jsonb("before_json"),
  /** Snapshot of the row after the mutation. NULL for deletes. */
  afterJson: jsonb("after_json"),
  /** Optional free-text reason / source (e.g. "AI extraction from W-2.pdf"). */
  source: text("source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  // Deep-audit DB finding: per-client list query (newest first, limit 200)
  // is the dominant audit-log read. composite (clientId, createdAt DESC)
  // is what Postgres needs to skip the full table sort.
  clientCreatedIdx: index("audit_log_client_created_idx").on(table.clientId, table.createdAt),
  // Forensic queries: "show all updates to W-2 row 12345" → entityType + entityId.
  entityIdx: index("audit_log_entity_idx").on(table.entityType, table.entityId),
}));

export const insertAuditLogSchema = createInsertSchema(auditLogTable, {
  action: z.enum(["create", "update", "delete"]),
  entityType: z.enum([
    "client", "w2", "form1099", "adjustment", "tax_return", "tax_document",
    // Added 2026-05-23: prior to this commit, capital_transaction, rental_property,
    // and schedule_k1 mutations were logged under entityType="adjustment", which
    // collided with adjustments-table rows of the same id and corrupted the audit
    // identity invariant (entityType, entityId) → unique row.
    "capital_transaction", "rental_property", "schedule_k1",
  ]),
});
export type AuditLogRow = typeof auditLogTable.$inferSelect;
export type NewAuditLogRow = typeof auditLogTable.$inferInsert;
