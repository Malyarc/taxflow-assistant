/**
 * Disclosure ledger — the DB-coupled append + read layer (T0.2 C1). The pure,
 * Haven-portable hash-chain logic lives in `disclosureLedger.ts`; this module
 * persists it.
 *
 * APPEND SERIALIZATION: a hash chain requires each new entry to read the CURRENT
 * head's hash and link to it. Two concurrent appends that both read the same
 * head would FORK the chain. We serialize appends with a Postgres
 * transaction-scoped advisory lock (`pg_advisory_xact_lock`) — held until the
 * insert commits — so appends are strictly ordered and the chain can never
 * fork. The head + a monotonic entry count are committed to a single-row
 * CHECKPOINT in the SAME transaction, which makes tail-truncation detectable.
 * Verified by the concurrency + truncation integration tests.
 *
 * FAIL MODE: best-effort (logs on failure, never throws to the caller), matching
 * `writeAudit`, so a ledger-infra hiccup can't wedge an export/extraction in the
 * demo. A real-PII deployment should revisit this toward fail-closed (no
 * disclosure without a recorded ledger entry); a swallowed unique-violation
 * (pg code 23505) would mean a genuine fork and should ESCALATE, not just log —
 * tracked in MASTER-TODO C1.
 *
 * SCALE: `verifyGlobalLedger` re-hashes the whole (append-only, never-pruned)
 * chain — inherently O(n). The per-client read path (`loadClientLedger`) does
 * NOT re-hash; it returns the O(1) checkpoint summary. A long-lived real
 * deployment should add suffix-since-checkpoint verification + ensure
 * `PG_POOL_MAX` exceeds the peak concurrent-append depth (blocked appends hold a
 * pooled connection while waiting on the advisory lock) — MASTER-TODO C1.
 */
import { db, disclosureLedgerTable, disclosureLedgerCheckpointTable } from "@workspace/db";
import { sql, eq, asc } from "drizzle-orm";
import { logger } from "./logger";
import {
  computeEntryHash,
  verifyLedger,
  GENESIS_HASH,
  type DisclosureRecord,
  type LedgerEntry,
  type LedgerVerification,
  type LedgerAnchor,
} from "./disclosureLedger";

// Fixed advisory-lock key ("LEDG") — every append takes this one global lock.
const LEDGER_LOCK_KEY = 0x4c454447; // 1279607879
const CHECKPOINT_ID = 1;

/** Server-held HMAC secret. Unset (demo) → unkeyed SHA-256 (corruption-evident,
 *  not attacker-proof). Set in any real-PII deployment. NOTE: enabling the key
 *  later changes the hash regime — demo-era (SHA-256) rows then fail HMAC
 *  verification by design; treat that as a new chain segment. */
function ledgerSecret(): string {
  return (process.env.DISCLOSURE_LEDGER_KEY ?? "").trim();
}

type RecordDisclosureInput = {
  clientId: number | null;
  action: DisclosureRecord["action"];
  recipient: string;
  purpose: string;
  scope?: string;
  actor?: string;
  /** ISO string; defaults to now() (the impure boundary lives here, not in the pure core). */
  occurredAt?: string;
};

/** Append one disclosure/use event to the chain. Best-effort (never throws). */
export async function recordDisclosure(input: RecordDisclosureInput): Promise<void> {
  const record: DisclosureRecord = {
    clientId: input.clientId ?? null,
    action: input.action,
    recipient: input.recipient,
    purpose: input.purpose,
    scope: input.scope ?? "n/a",
    actor: input.actor ?? "system",
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
  try {
    await db.transaction(async (tx) => {
      // Serialize appends — held until commit, so no two appends interleave.
      await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);
      // The CHECKPOINT is the authoritative, monotonic head — derive prevHash +
      // count from it (NOT from select count(*), which would let a post-
      // truncation append silently "heal" the checkpoint to the truncated state).
      const [cp] = await tx
        .select()
        .from(disclosureLedgerCheckpointTable)
        .where(eq(disclosureLedgerCheckpointTable.id, CHECKPOINT_ID));
      const prevHash = cp?.headHash ?? GENESIS_HASH;
      const prevCount = cp?.entryCount ?? 0;
      const entryHash = computeEntryHash(prevHash, record, ledgerSecret());
      await tx.insert(disclosureLedgerTable).values({ ...record, prevHash, entryHash });
      await tx
        .insert(disclosureLedgerCheckpointTable)
        .values({ id: CHECKPOINT_ID, entryCount: prevCount + 1, headHash: entryHash, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: disclosureLedgerCheckpointTable.id,
          set: { entryCount: prevCount + 1, headHash: entryHash, updatedAt: new Date() },
        });
    });
  } catch (err) {
    logger.error(
      { err, action: record.action, clientId: record.clientId },
      "Disclosure ledger append failed (best-effort — disclosure proceeded unlogged)",
    );
  }
}

function rowToEntry(r: typeof disclosureLedgerTable.$inferSelect): LedgerEntry {
  return {
    clientId: r.clientId,
    action: r.action as DisclosureRecord["action"],
    recipient: r.recipient,
    purpose: r.purpose,
    scope: r.scope,
    actor: r.actor,
    occurredAt: r.occurredAt,
    prevHash: r.prevHash,
    entryHash: r.entryHash,
  };
}

async function readAnchor(): Promise<LedgerAnchor | undefined> {
  const [cp] = await db
    .select()
    .from(disclosureLedgerCheckpointTable)
    .where(eq(disclosureLedgerCheckpointTable.id, CHECKPOINT_ID));
  return cp ? { count: cp.entryCount, head: cp.headHash } : undefined;
}

/** Verify the WHOLE chain (it is global) AGAINST the committed checkpoint, so
 *  both interior tampering AND tail-truncation are caught. O(n). */
export async function verifyGlobalLedger(): Promise<{ verification: LedgerVerification; entries: LedgerEntry[] }> {
  const [rows, anchor] = await Promise.all([
    db.select().from(disclosureLedgerTable).orderBy(asc(disclosureLedgerTable.id)),
    readAnchor(),
  ]);
  const entries = rows.map(rowToEntry);
  return { verification: verifyLedger(entries, ledgerSecret(), anchor), entries };
}

/** This client's disclosure rows (display) PLUS the O(1) checkpoint summary (the
 *  committed head + count). Does NOT re-hash the whole chain — use
 *  verifyGlobalLedger / GET /disclosure-ledger/verify for the cryptographic check. */
export async function loadClientLedger(
  clientId: number,
): Promise<{ rows: LedgerEntry[]; checkpoint: LedgerAnchor | null }> {
  const [clientRows, anchor] = await Promise.all([
    db
      .select()
      .from(disclosureLedgerTable)
      .where(eq(disclosureLedgerTable.clientId, clientId))
      .orderBy(asc(disclosureLedgerTable.id)),
    readAnchor(),
  ]);
  return { rows: clientRows.map(rowToEntry), checkpoint: anchor ?? null };
}
