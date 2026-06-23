import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Disclosure & use ledger (T0.2 C1) — an APPEND-ONLY, hash-chained record of
 * every §7216/§6713 disclosure or use of tax-return information (a document
 * sent to the LLM, an export/download, an outreach email, a third-party share,
 * and consent capture/revocation).
 *
 * Distinct from `audit_log` (which snapshots every DB mutation): this ledger
 * is the COMPLIANCE proof that disclosures were authorized + accounted for,
 * and it is TAMPER-EVIDENT — each row's `entryHash` chains the previous row's
 * hash (see lib/disclosureLedger.ts). A retroactive edit/reorder/deletion
 * breaks the chain and is caught by re-running `verifyLedger`.
 *
 * Hashing invariant: `entryHash` is computed over the EXACT stored field values
 * (incl. `occurredAt` as the literal ISO string — stored as text, NOT a
 * timestamp, so re-serialization can't drift the hash) plus `prevHash`. Append
 * ordering is serialized with a Postgres advisory lock (see
 * lib/disclosureLedgerStore.ts) so concurrent appends can't fork the chain.
 *
 * NEVER update or delete rows here; client deletion sets clientId NULL (the
 * forensic trail survives), same as audit_log.
 */
export const disclosureLedgerTable = pgTable(
  "disclosure_ledger",
  {
    id: serial("id").primaryKey(),
    /**
     * Client whose info was disclosed/used (NULL for firm-wide events).
     * IMMUTABLE + intentionally NOT a foreign key: the chain hash covers this
     * value, so it must never be mutated after write. A FK with onDelete
     * set-null/cascade would rewrite or remove it when the client is deleted and
     * BREAK the chain. The disclosure record therefore PERSISTS with its
     * original clientId even after the client row is gone (the correct §7216
     * forensic behavior — you can't erase the record of a past disclosure).
     */
    clientId: integer("client_id"),
    /** ai_disclosure | export | email | third_party_share | consent_recorded | consent_revoked */
    action: text("action").notNull(),
    /** Recipient, e.g. "google_gemini" | "csv_download" | "client_portal". */
    recipient: text("recipient").notNull(),
    /** Free-text purpose. */
    purpose: text("purpose").notNull(),
    /** Consent scope relied upon, or "n/a". */
    scope: text("scope").notNull(),
    /** Acting principal (user/system). */
    actor: text("actor").notNull(),
    /** ISO timestamp the event occurred — the EXACT hashed string (text, not timestamp). */
    occurredAt: text("occurred_at").notNull(),
    /** Hash of the previous entry (genesis = 64 zeros for the first). */
    prevHash: text("prev_hash").notNull(),
    /** HMAC/SHA-256 over (prevHash || canonical(record)). */
    entryHash: text("entry_hash").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    // Per-client ledger read (chronological by id, which is monotonic).
    clientIdx: index("disclosure_ledger_client_idx").on(table.clientId, table.id),
    // Integrity: no two entries can share a chain hash.
    entryHashIdx: uniqueIndex("disclosure_ledger_entry_hash_idx").on(table.entryHash),
  }),
);

export const insertDisclosureLedgerSchema = createInsertSchema(disclosureLedgerTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDisclosureLedger = z.infer<typeof insertDisclosureLedgerSchema>;
export type DisclosureLedgerRow = typeof disclosureLedgerTable.$inferSelect;

/**
 * Single-row (id = 1) committed checkpoint of the chain HEAD — the external
 * anchor that makes TAIL-truncation detectable (internal chain verification
 * alone can't catch deletion of the most-recent rows). Advanced MONOTONICALLY
 * and atomically inside the same advisory-locked append transaction:
 * entryCount := prev + 1, headHash := the new entry's hash. `verifyLedger`
 * rejects any chain shorter than entryCount or whose head ≠ headHash, so a
 * `DELETE FROM disclosure_ledger WHERE id > N` is caught.
 *
 * (An attacker who can write BOTH this row and the ledger could still rewind
 * both consistently — the fully attacker-proof anchor is an append-only EXTERNAL
 * sink / signed receipt, tracked as the real-PII hardening in MASTER-TODO C1.)
 */
export const disclosureLedgerCheckpointTable = pgTable("disclosure_ledger_checkpoint", {
  id: integer("id").primaryKey(), // always 1
  entryCount: integer("entry_count").notNull(),
  headHash: text("head_hash").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type DisclosureLedgerCheckpointRow = typeof disclosureLedgerCheckpointTable.$inferSelect;
