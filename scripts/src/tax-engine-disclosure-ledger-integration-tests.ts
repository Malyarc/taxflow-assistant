/**
 * Disclosure ledger (T0.2 C1) — yes-API integration + CONCURRENCY test.
 *
 * Proves the live append path: §7216 consent capture + exports append entries
 * to the hash chain; the chain verifies; and — the key property — CONCURRENT
 * appends do NOT fork the chain (the Postgres advisory lock serializes them).
 *
 * Needs a live API at localhost:8080 + Postgres (the disclosure_ledger table).
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-disclosure-ledger-integration-tests.ts
 */
const BASE = process.env.API_BASE ?? "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  if (!res.ok && res.status !== 204) throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function withTempClient<T>(fn: (cid: number) => Promise<T>): Promise<T> {
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Ledger", lastName: "Test",
      email: `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}@e.co`,
      filingStatus: "single", state: "CA", taxYear: 2024,
    }),
  });
  try {
    return await fn(c.id);
  } finally {
    await api(`/clients/${c.id}`, { method: "DELETE" }).catch(() => {});
  }
}

const postConsent = (cid: number) =>
  api(`/clients/${cid}/disclosure-consents`, { method: "POST", body: JSON.stringify({}) });

async function run() {
  // ── 1. Sequential appends + per-client ledger + global verify ─────────────
  await withTempClient(async (cid) => {
    for (let i = 0; i < 3; i++) await postConsent(cid);
    const led = await api<any>(`/clients/${cid}/disclosure-ledger`);
    ok("3 consents → 3 client ledger entries", led.entries.length === 3, `got ${led.entries.length}`);
    ok("all entries are consent_recorded", led.entries.every((e: any) => e.action === "consent_recorded"));
    ok("per-client view carries the committed checkpoint", led.checkpoint != null && typeof led.checkpoint.count === "number",
      JSON.stringify(led.checkpoint));
    const v = await api<any>("/disclosure-ledger/verify");
    ok("global chain verifies valid (incl. checkpoint anchor)", v.valid === true, JSON.stringify(v));
    ok("checkpoint count == verified entry count", v.entryCount === led.checkpoint.count,
      `verify ${v.entryCount} vs cp ${led.checkpoint.count}`);
  });

  // ── 2. Export is recorded as a disclosure ─────────────────────────────────
  await withTempClient(async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 90000, federalTaxWithheldBox2: 12000, stateCode: "CA" }),
    });
    await fetch(`${BASE}/clients/${cid}/tax-return/csv?taxYear=2024`); // triggers an "export" disclosure
    await new Promise((r) => setTimeout(r, 120));
    const led = await api<any>(`/clients/${cid}/disclosure-ledger`);
    const exp = led.entries.filter((e: any) => e.action === "export" && e.recipient === "csv_download");
    ok("CSV export appended an 'export' ledger entry", exp.length === 1, `got ${exp.length}`);
    const v = await api<any>("/disclosure-ledger/verify");
    ok("chain still verifies after the export append", v.valid === true, JSON.stringify(v));
  });

  // ── 3. CONCURRENCY — N concurrent appends must NOT fork the chain ──────────
  // Without the advisory lock, concurrent appends read the same head hash and
  // fork (or collide on the unique entry_hash index, losing entries). With it,
  // all N serialize: all succeed AND the global chain stays valid.
  await withTempClient(async (cid) => {
    const N = 15;
    const before = await api<any>("/disclosure-ledger/verify");
    await Promise.all(Array.from({ length: N }, () => postConsent(cid)));
    const led = await api<any>(`/clients/${cid}/disclosure-ledger`);
    const after = await api<any>("/disclosure-ledger/verify");
    ok(`all ${N} concurrent appends landed (no entries lost to a race)`, led.entries.length === N,
      `got ${led.entries.length}`);
    ok("global chain VALID after concurrent appends (advisory lock held)", after.valid === true,
      JSON.stringify(after));
    ok(`global entry count grew by exactly ${N}`, after.entryCount === before.entryCount + N,
      `before ${before.entryCount}, after ${after.entryCount}`);
  });

  // ── 4. Standalone global verify endpoint ──────────────────────────────────
  const v = await api<any>("/disclosure-ledger/verify");
  ok("global ledger is valid", v.valid === true, JSON.stringify(v));
}

run()
  .then(() => {
    console.log(`\nDisclosure ledger integration tests:`);
    console.log(`  Passed: ${PASS.length}`);
    console.log(`  Failed: ${FAIL.length}`);
    if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
    console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
    process.exit(FAIL.length > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("Integration test harness error:", err);
    process.exit(1);
  });
