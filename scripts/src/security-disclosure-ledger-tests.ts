/**
 * §7216/§6713 disclosure ledger — pure hash-chain core tests (T0.2 C1).
 *
 * Verifies tamper-evidence PROPERTIES (no need to hand-compute SHA-256):
 * build→verify round-trip, genesis + linkage, determinism, and detection of
 * payload edits / reorder / deletion / insertion / wrong-key, for BOTH the
 * keyed (HMAC) and unkeyed (SHA-256) chains.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/security-disclosure-ledger-tests.ts
 */
import {
  buildLedger,
  verifyLedger,
  appendDisclosure,
  computeEntryHash,
  canonicalDisclosure,
  GENESIS_HASH,
  HASHED_FIELDS,
  type DisclosureRecord,
  type LedgerEntry,
} from "../../artifacts/api-server/src/lib/disclosureLedger";

const PASS: string[] = [];
const FAIL: string[] = [];
function eq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function truthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected true`);
}
const clone = (entries: LedgerEntry[]): LedgerEntry[] => entries.map((e) => ({ ...e }));

function rec(i: number, over: Partial<DisclosureRecord> = {}): DisclosureRecord {
  return {
    clientId: 100 + i,
    action: "export",
    recipient: "csv_download",
    purpose: `tax-return summary #${i}`,
    scope: "n/a",
    actor: "system",
    occurredAt: `2026-06-22T0${i}:00:00.000Z`,
    ...over,
  };
}

const KEY = "test-ledger-secret-key";
const records = [rec(0), rec(1, { action: "ai_disclosure", recipient: "google_gemini", scope: "ai_extraction" }), rec(2), rec(3, { clientId: null })];

for (const [tag, secret] of [["unkeyed", ""], ["keyed", KEY]] as const) {
  const chain = buildLedger(records, secret);

  eq(`${tag}: chain length`, chain.length, 4);
  eq(`${tag}: genesis prevHash`, chain[0].prevHash, GENESIS_HASH);
  truthy(`${tag}: hash is 64-hex`, /^[0-9a-f]{64}$/.test(chain[0].entryHash));
  truthy(`${tag}: linkage 1`, chain[1].prevHash === chain[0].entryHash);
  truthy(`${tag}: linkage 2`, chain[2].prevHash === chain[1].entryHash);
  truthy(`${tag}: linkage 3`, chain[3].prevHash === chain[2].entryHash);

  // Build/verify round-trip.
  eq(`${tag}: verify valid`, verifyLedger(chain, secret).valid, true);
  eq(`${tag}: verify entryCount`, verifyLedger(chain, secret).entryCount, 4);

  // Determinism.
  truthy(`${tag}: deterministic rebuild`, buildLedger(records, secret).every((e, i) => e.entryHash === chain[i].entryHash));
  eq(`${tag}: computeEntryHash deterministic`, computeEntryHash(GENESIS_HASH, records[0], secret), chain[0].entryHash);

  // Distinct payloads under the same prevHash → distinct hashes.
  truthy(`${tag}: different payload → different hash`,
    appendDisclosure(GENESIS_HASH, records[0], secret).entryHash !== appendDisclosure(GENESIS_HASH, records[1], secret).entryHash);

  // Tamper a middle payload field → mismatch at that index.
  {
    const t = clone(chain);
    t[2] = { ...t[2], purpose: "SECRETLY CHANGED" };
    const v = verifyLedger(t, secret);
    eq(`${tag}: tamper payload → invalid`, v.valid, false);
    eq(`${tag}: tamper payload → brokenAt 2`, v.brokenAt, 2);
  }
  // Tamper a stored entryHash → mismatch at that index.
  {
    const t = clone(chain);
    t[1] = { ...t[1], entryHash: "f".repeat(64) };
    const v = verifyLedger(t, secret);
    eq(`${tag}: tamper hash → invalid`, v.valid, false);
    eq(`${tag}: tamper hash → brokenAt 1`, v.brokenAt, 1);
  }
  // Reorder two entries → linkage breaks.
  {
    const t = clone(chain);
    [t[1], t[2]] = [t[2], t[1]];
    eq(`${tag}: reorder → invalid`, verifyLedger(t, secret).valid, false);
  }
  // Delete an entry → linkage breaks at the gap.
  {
    const t = clone(chain);
    t.splice(2, 1);
    const v = verifyLedger(t, secret);
    eq(`${tag}: delete → invalid`, v.valid, false);
    eq(`${tag}: delete → brokenAt 2`, v.brokenAt, 2);
  }
  // Insert a fabricated entry mid-chain → linkage breaks.
  {
    const t = clone(chain);
    t.splice(2, 0, appendDisclosure("a".repeat(64), rec(9), secret));
    eq(`${tag}: insert → invalid`, verifyLedger(t, secret).valid, false);
  }
  // Empty + single.
  eq(`${tag}: empty chain valid`, verifyLedger([], secret).valid, true);
  eq(`${tag}: single-entry valid`, verifyLedger(buildLedger([rec(0)], secret), secret).valid, true);
}

// HMAC ≠ SHA-256 (keyed hash differs from unkeyed for the same record).
truthy("HMAC differs from SHA-256", computeEntryHash(GENESIS_HASH, records[0], KEY) !== computeEntryHash(GENESIS_HASH, records[0], ""));

// Verifying a keyed chain with the WRONG key fails immediately (no recompute-suffix attack).
{
  const chain = buildLedger(records, KEY);
  const v = verifyLedger(chain, "wrong-key");
  eq("wrong key → invalid", v.valid, false);
  eq("wrong key → brokenAt 0", v.brokenAt, 0);
}
// And verifying a keyed chain with NO key fails (can't pass an HMAC chain off as SHA-256).
eq("keyed chain, unkeyed verify → invalid", verifyLedger(buildLedger(records, KEY), "").valid, false);

// clientId null vs 0 must not collide through coercion.
truthy("clientId null ≠ 0 in canonical",
  canonicalDisclosure(rec(0, { clientId: null })) !== canonicalDisclosure(rec(0, { clientId: 0 })));

// FIELD_ORDER guard — canonical must cover EVERY field of DisclosureRecord (a
// future field left out becomes silently mutable post-write).
{
  const sample = rec(0);
  const recordKeys = Object.keys(sample).sort();
  const hashedKeys = [...HASHED_FIELDS].sort();
  eq("HASHED_FIELDS covers every DisclosureRecord key", hashedKeys.join(","), recordKeys.join(","));
  // And changing any covered field actually changes the canonical (no dead field).
  for (const k of HASHED_FIELDS) {
    const mutated = canonicalDisclosure(rec(0, { [k]: k === "clientId" ? 999 : `MUT-${k}` } as Partial<DisclosureRecord>));
    truthy(`mutating ${k} changes canonical`, mutated !== canonicalDisclosure(rec(0)));
  }
}

// Tail-truncation — undetectable WITHOUT the checkpoint anchor, DETECTED with it.
{
  const chain = buildLedger(records, KEY);
  const anchor = { count: chain.length, head: chain[chain.length - 1].entryHash };
  eq("full chain valid against its anchor", verifyLedger(chain, KEY, anchor).valid, true);
  const truncated = chain.slice(0, chain.length - 1);
  // Internal verify alone says the truncated prefix is "valid" (the gap).
  eq("truncated prefix passes internal-only verify", verifyLedger(truncated, KEY).valid, true);
  // WITH the anchor, truncation is caught (count mismatch).
  const v = verifyLedger(truncated, KEY, anchor);
  eq("truncation caught by anchor", v.valid, false);
  eq("truncation reason mentions count", /count/.test(v.reason ?? "") , true);
  // A tampered head anchor is also caught.
  eq("wrong-head anchor caught", verifyLedger(chain, KEY, { count: chain.length, head: "z".repeat(64) }).valid, false);
  // An empty chain with a non-empty anchor is caught.
  eq("empty chain vs non-empty anchor caught", verifyLedger([], KEY, { count: 1, head: "a".repeat(64) }).valid, false);
}

console.log(`\nDisclosure ledger (C1) core tests:`);
console.log(`  Passed: ${PASS.length}`);
console.log(`  Failed: ${FAIL.length}`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
