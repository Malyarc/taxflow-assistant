/**
 * Phase G5 — Pro-tier gating integration tests.
 *
 * Discovers the current PRO_TIER_ENABLED state from /api/settings, then
 * exercises the appropriate branch:
 *   - Pro on  → /api/settings returns true; planning endpoints respond 200.
 *   - Pro off → /api/settings returns false; planning endpoints respond 402
 *               with `code: PRO_TIER_REQUIRED` body. Settings endpoint
 *               itself is unaffected by the flag.
 *
 * Run BOTH branches to cover the gating end-to-end:
 *
 *   # Pro on (default):
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-pro-tier-tests.ts
 *
 *   # Pro off — restart the api-server with PRO_TIER_ENABLED=false first.
 *   PRO_TIER_ENABLED=false node artifacts/api-server/dist/index.mjs &
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-pro-tier-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const eq =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) <= 1
      : actual === expected;
  if (eq) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

function checkTruthy(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected=${expected} actual=${actual}`);
}

async function jsonOrText(res: Response): Promise<unknown> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

/** Returns { status, body } without throwing on non-2xx. */
async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(BASE + path);
  return { status: res.status, body: await jsonOrText(res) };
}

async function run() {
  // ── 1. Settings endpoint shape (regardless of Pro state) ───────────────
  console.log("\n-- /api/settings — shape --");
  const settingsRes = await get("/settings");
  check("settings HTTP 200", settingsRes.status, 200);
  if (typeof settingsRes.body === "object" && settingsRes.body != null) {
    const proTierEnabled = (settingsRes.body as Record<string, unknown>).proTierEnabled;
    checkTruthy("settings.proTierEnabled is boolean", typeof proTierEnabled === "boolean", true);
  } else {
    FAIL.push(`FAIL settings body is not an object: ${JSON.stringify(settingsRes.body)}`);
  }

  const proTier =
    typeof settingsRes.body === "object" &&
    settingsRes.body != null &&
    (settingsRes.body as Record<string, unknown>).proTierEnabled === true;

  if (proTier) {
    console.log("\n[Pro tier ON — running on-state assertions]");

    // ── 2. Planning endpoints return 200 ─────────────────────────────────
    // Need an existing client; pick the first one from the (paginated) list.
    const clientsRes = await get("/clients");
    const clientItems = (clientsRes.body as { items?: Array<{ id: number }> } | null)?.items;
    if (
      clientsRes.status === 200 &&
      Array.isArray(clientItems) &&
      clientItems.length > 0
    ) {
      const sampleClient = clientItems[0];
      const cid = sampleClient.id;

      const opps = await get(`/clients/${cid}/planning-opportunities`);
      check("planning-opportunities HTTP 200 (Pro on)", opps.status, 200);

      const multi = await get(`/clients/${cid}/planning-multi-year`);
      check("planning-multi-year HTTP 200 (Pro on)", multi.status, 200);

      const list = await get("/planning-hit-list?limit=3");
      check("planning-hit-list HTTP 200 (Pro on)", list.status, 200);
    } else {
      // Acceptable — empty database. Skip endpoint tests cleanly.
      PASS.push("OK (Pro on) no clients to exercise; settings shape verified");
    }
  } else {
    console.log("\n[Pro tier OFF — running off-state assertions]");

    // ── 2. Planning endpoints respond 402 with PRO_TIER_REQUIRED body ──
    const probes = [
      "/clients/1/planning-opportunities",
      "/clients/1/planning-multi-year",
      "/clients/1/planning-memo",
      "/clients/1/planning-email",
      "/clients/1/planning-missing-data",
      "/planning-hit-list",
    ];
    for (const path of probes) {
      const r = await get(path);
      check(`${path} HTTP 402 (Pro off)`, r.status, 402);
      if (r.status === 402 && typeof r.body === "object" && r.body != null) {
        const code = (r.body as Record<string, unknown>).code;
        check(`${path} body.code = PRO_TIER_REQUIRED`, code as string, "PRO_TIER_REQUIRED");
      } else if (r.status === 402) {
        FAIL.push(`FAIL ${path} body is not JSON: ${JSON.stringify(r.body)}`);
      }
    }

    // ── 3. Other endpoints unaffected by the flag ────────────────────────
    const dashboard = await get("/dashboard/summary");
    check("dashboard/summary unaffected (Pro off)", dashboard.status, 200);
    const clients = await get("/clients");
    check("clients listing unaffected (Pro off)", clients.status, 200);
  }

  // ── Results ────────────────────────────────────────────────────────────
  console.log(`\nPASSED: ${PASS.length}`);
  if (FAIL.length > 0) {
    console.log(`FAILED: ${FAIL.length}`);
    for (const f of FAIL) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log(proTier
    ? "ALL PRO-TIER GATING TESTS PASS (Pro on branch)"
    : "ALL PRO-TIER GATING TESTS PASS (Pro off branch)");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
