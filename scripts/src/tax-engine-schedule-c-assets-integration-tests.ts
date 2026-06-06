/**
 * Schedule C asset-register CRUD → engine integration (P2, C).
 *
 * Verifies the live-app input path: POST a depreciable asset → the pipeline loads
 * it into TaxReturnInputs.scheduleCAssets → the engine computes the depreciation →
 * it flows into scheduleCDepreciation (the SE-base-reducing total).
 *
 * Requires the api-server on http://localhost:8080 (+ Postgres). Excluded from the
 * no-API battery (NEEDS_API in run-no-api.ts).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-schedule-c-assets-integration-tests.ts
 */
const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
async function settle(): Promise<void> { await new Promise((r) => setTimeout(r, 80)); }

async function run(): Promise<void> {
  // SE filer, FL, $100k Schedule C income; add a $20k 5-yr §179 asset →
  // §179 = min(20k, business income) = $20,000 → scheduleCDepreciation = $20,000.
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Asset", lastName: "Test",
      email: `sca-${Date.now()}-${Math.random().toString(36).slice(2)}@e.co`,
      filingStatus: "single", state: "FL", taxYear: 2024,
    }),
  });
  try {
    await api(`/clients/${c.id}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "self_employment_income", amount: 100000, isApplied: true }),
    });
    const asset = await api<{ id: number }>(`/clients/${c.id}/schedule-c-assets`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, description: "Equipment", cost: 20000,
        recoveryYears: 5, placedInServiceYear: 2024, section179: true,
      }),
    });
    await settle();
    const r1 = await api<{ scheduleCDepreciation: number | string }>(`/clients/${c.id}/tax-return`);
    check("§179 asset flows to scheduleCDepreciation ($20,000)", Number(r1.scheduleCDepreciation), 20000);

    // Delete it → scheduleCDepreciation returns to 0.
    await api(`/clients/${c.id}/schedule-c-assets/${asset.id}`, { method: "DELETE" });
    await settle();
    const r2 = await api<{ scheduleCDepreciation: number | string }>(`/clients/${c.id}/tax-return`);
    check("after delete, scheduleCDepreciation = 0", Number(r2.scheduleCDepreciation), 0);
  } finally {
    await api(`/clients/${c.id}`, { method: "DELETE" }).catch(() => {});
  }

  console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed (Schedule C assets CRUD→engine)`);
  for (const p of PASS) console.log(p);
  if (FAIL.length) { for (const f of FAIL) console.error(f); process.exit(1); }
  console.log("ALL SCHEDULE-C-ASSETS INTEGRATION ASSERTIONS PASS");
}
run().catch((err) => { console.error(err); process.exit(1); });
