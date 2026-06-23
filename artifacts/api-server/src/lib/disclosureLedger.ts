/**
 * §7216 / §6713 disclosure & use ledger — the PURE, tamper-evident hash-chain
 * core (T0.2 C1).
 *
 * Every disclosure or use of tax-return information (sending a document to the
 * LLM, an export/download, an outreach email, a third-party share) appends a
 * record to an append-only chain. Each entry carries the hash of the previous
 * entry, so any retroactive edit, reorder, INTERIOR deletion, or insertion
 * breaks the chain and is caught by `verifyLedger`.
 *
 * TAIL-TRUNCATION caveat: deleting the most-RECENT entries leaves a valid
 * shorter prefix that `verifyLedger` alone cannot detect (internal-consistency
 * only). To catch that, pass an external `expected` head/count anchor —
 * persisted in the separate `disclosure_ledger_checkpoint` row, advanced
 * atomically with each append (see disclosureLedgerStore.ts). The fully
 * attacker-proof form is an append-only EXTERNAL sink / signed receipt
 * (real-PII hardening, tracked in MASTER-TODO C1).
 *
 * KEYED by design: the chain hash is an HMAC under a server-held secret
 * (`secret` arg). An UNKEYED SHA-256 chain only resists accidental corruption —
 * an attacker who can write the DB AND knows the algorithm could recompute the
 * whole suffix after a tampering point. The HMAC makes that infeasible without
 * the key. With no key configured (demo) it falls back to plain SHA-256
 * (corruption-evident, not attacker-proof), mirroring the PII_ENCRYPTION_KEY
 * passthrough convention — real-PII deployments MUST set the key.
 *
 * PURE + Haven-portable: NO Date / Math.random / DB / network. `occurredAt` is a
 * caller-supplied ISO string; node:crypto hashing is deterministic.
 */
import { createHash, createHmac } from "node:crypto";

/** The hashed payload of one disclosure/use event. */
export interface DisclosureRecord {
  /** Client whose tax-return info was disclosed/used (null for firm-wide). */
  clientId: number | null;
  /** What happened. */
  action:
    | "ai_disclosure"        // sent to the LLM (Gemini) for extraction/synthesis
    | "export"               // CSV/JSON/TXT/PDF generated or downloaded
    | "email"                // outreach/communication containing return info
    | "third_party_share"    // shared with another party/service
    | "consent_recorded"     // a §7216 consent was captured
    | "consent_revoked";     // a §7216 consent was revoked
  /** Who/what received it, e.g. "google_gemini", "csv_download", "client_portal". */
  recipient: string;
  /** Free-text purpose, e.g. "W-2 extraction" / "tax-return summary CSV". */
  purpose: string;
  /** The consent scope this disclosure relied on (or "n/a"). */
  scope: string;
  /** The acting principal (user/system), e.g. "system" until auth lands. */
  actor: string;
  /** ISO timestamp the event occurred (caller-supplied — keeps this pure). */
  occurredAt: string;
}

export interface LedgerEntry extends DisclosureRecord {
  /** Hash of the previous entry (GENESIS_HASH for the first). */
  prevHash: string;
  /** HMAC/SHA-256 over (prevHash || canonical(record)). */
  entryHash: string;
}

export interface LedgerVerification {
  valid: boolean;
  /** Index of the first broken entry, or null when valid. */
  brokenAt: number | null;
  reason: string | null;
  entryCount: number;
}

/** The chain anchor — a fixed, non-secret 64-hex constant. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * The EXACT set of fields the chain hash covers, in order. `satisfies` makes a
 * typo or a non-existent key a compile error; the `canonical-covers-every-field`
 * guard test asserts no DisclosureRecord field is silently left UNhashed (so a
 * future field added to the record can't become silently mutable post-write).
 * Bump the "v1" tag in canonicalDisclosure if this set ever changes.
 */
export const HASHED_FIELDS = [
  "clientId",
  "action",
  "recipient",
  "purpose",
  "scope",
  "actor",
  "occurredAt",
] as const satisfies readonly (keyof DisclosureRecord)[];

/** Deterministic, injection-safe serialization of the hashed fields. JSON array
 *  of independently-quoted/escaped values in a fixed order — no separator can be
 *  smuggled to collide two distinct records; clientId is normalized so 0 vs null
 *  never coerce-collide. */
export function canonicalDisclosure(r: DisclosureRecord): string {
  return JSON.stringify([
    "v1",
    ...HASHED_FIELDS.map((f) => (f === "clientId" ? (r.clientId == null ? null : Number(r.clientId)) : r[f])),
  ]);
}

/** The chain hash of one entry. HMAC when `secret` is non-empty, else SHA-256. */
export function computeEntryHash(prevHash: string, r: DisclosureRecord, secret = ""): string {
  const data = `${prevHash}\n${canonicalDisclosure(r)}`;
  return secret
    ? createHmac("sha256", secret).update(data).digest("hex")
    : createHash("sha256").update(data).digest("hex");
}

/** Append one record onto a chain head, returning the new entry. */
export function appendDisclosure(prevHash: string, r: DisclosureRecord, secret = ""): LedgerEntry {
  return { ...r, prevHash, entryHash: computeEntryHash(prevHash, r, secret) };
}

/** Build a full chain from records (genesis-anchored). */
export function buildLedger(records: readonly DisclosureRecord[], secret = ""): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let prev = GENESIS_HASH;
  for (const r of records) {
    const entry = appendDisclosure(prev, r, secret);
    out.push(entry);
    prev = entry.entryHash;
  }
  return out;
}

/** An externally-committed anchor (the checkpoint) used to detect TAIL-truncation
 *  — internal verification alone cannot. */
export interface LedgerAnchor {
  /** Total entries the chain is expected to hold. */
  count: number;
  /** entryHash of the expected head (or GENESIS_HASH for an empty chain). */
  head: string;
}

/** Re-derive every entry's hash and verify the linkage. Detects any payload
 *  edit (hash mismatch), reorder/insertion/INTERIOR deletion (linkage break), or
 *  a recomputed-suffix attack when `secret` is set (the attacker lacks the key).
 *  Pass `anchor` (the committed checkpoint) to also catch TAIL-truncation: a
 *  chain shorter than `anchor.count` or whose head ≠ `anchor.head` is rejected.
 *  Hash comparisons use `!==` deliberately — no secret-dependent value is ever
 *  string-compared (the HMAC key only feeds createHmac), so constant-time
 *  comparison buys nothing here. */
export function verifyLedger(
  entries: readonly LedgerEntry[],
  secret = "",
  anchor?: LedgerAnchor,
): LedgerVerification {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prevHash !== prev) {
      return { valid: false, brokenAt: i, reason: "prevHash linkage broken (reorder/insert/delete)", entryCount: entries.length };
    }
    const expected = computeEntryHash(prev, e, secret);
    if (e.entryHash !== expected) {
      return { valid: false, brokenAt: i, reason: "entryHash mismatch (tampered payload or wrong key)", entryCount: entries.length };
    }
    prev = e.entryHash;
  }
  if (anchor) {
    if (entries.length !== anchor.count) {
      return {
        valid: false,
        brokenAt: Math.min(entries.length, anchor.count),
        reason: `entry count ${entries.length} ≠ committed checkpoint ${anchor.count} (tail-truncation or unrecorded insert)`,
        entryCount: entries.length,
      };
    }
    if (prev !== anchor.head) {
      return { valid: false, brokenAt: entries.length, reason: "head hash ≠ committed checkpoint head", entryCount: entries.length };
    }
  }
  return { valid: true, brokenAt: null, reason: null, entryCount: entries.length };
}
