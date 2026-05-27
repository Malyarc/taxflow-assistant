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
  | "tax_document"
  // Added 2026-05-23: these used to log under "adjustment", colliding
  // with adjustments-table rows of the same id. Now distinct.
  | "capital_transaction"
  | "rental_property"
  | "schedule_k1"
  // Phase H — H5 client asset balances.
  | "asset_balance";

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

/**
 * PII redaction (deep-audit security finding). Audit log snapshots can contain
 * SSNs, EINs, bank account numbers. We mask these BEFORE persisting so that:
 *   - DB dumps / backups don't carry plaintext PII unnecessarily
 *   - Future read-side rendering still shows the right "shape" of the change
 *     without leaking the full number
 *
 * Format: keep last 4 digits, mask the rest. "123456789" → "*****6789".
 * Special-case the SSN dashed form "123-45-6789" → "***-**-6789".
 * Other long numeric strings (account, EIN, routing) get a generic
 * last-4-only mask.
 *
 * Fields redacted by key match (case-insensitive substring):
 *   ssn, tin, ein, taxId, accountNumber, routingNumber, bankAccount,
 *   employeeSSN, taxpayerSSN, spouseSSN
 *
 * NOTE: This is a conservative redaction. CPAs reviewing the audit log will
 * see "*****6789" instead of the full SSN — they have access to the live
 * client row for the full value. Forensic queries (e.g., "did anyone edit
 * SSN field?") still work via the field key in beforeJson/afterJson.
 */
const SENSITIVE_FIELD_PATTERNS = [
  /ssn$/i,
  /tin$/i,
  /ein$/i,
  /taxid$/i,
  /accountnumber$/i,
  /routingnumber$/i,
  /bankaccount/i,
];

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((p) => p.test(key));
}

function maskSensitiveValue(value: unknown): unknown {
  if (typeof value !== "string") return value; // non-string sensitive values leave as-is (null, undefined, number)
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  // SSN dashed form (123-45-6789) → ***-**-6789
  if (/^\d{3}-\d{2}-\d{4}$/.test(trimmed)) {
    return "***-**-" + trimmed.slice(-4);
  }
  // Bare digit run (9–17 digits typical for SSN/account/EIN/routing) → mask all but last 4
  if (/^\d{4,}$/.test(trimmed)) {
    if (trimmed.length <= 4) return "****"; // too short to keep last 4
    return "*".repeat(trimmed.length - 4) + trimmed.slice(-4);
  }
  // Mixed string — mask middle (defensive)
  if (trimmed.length > 4) {
    return trimmed.slice(0, 1) + "*".repeat(trimmed.length - 2) + trimmed.slice(-1);
  }
  return "*".repeat(trimmed.length);
}

export function redactPii(
  obj: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!obj || typeof obj !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isSensitiveKey(k)) {
      out[k] = maskSensitiveValue(v);
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      // Recurse into nested objects (e.g., audit snapshots that wrap a row).
      out[k] = redactPii(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function writeAudit(params: AuditWriteParams): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      clientId: params.clientId,
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      // Redact SSN/EIN/account fields before persisting (deep-audit finding).
      beforeJson: redactPii(params.before),
      afterJson: redactPii(params.after),
      source: params.source ?? null,
    });
  } catch (err) {
    logger.error({ err, params: { ...params, before: undefined, after: undefined } }, "writeAudit failed (route response not affected)");
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
