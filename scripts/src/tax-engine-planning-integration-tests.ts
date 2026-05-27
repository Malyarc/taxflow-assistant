/**
 * Planning detector integration tests via the live API.
 *
 * Mirrors the planning-detector unit suite but exercises the full
 * DB → pipeline → planning engine → HTTP response path. Catches Drizzle
 * round-tripping bugs, route-layer serialization, OpenAPI-spec drift.
 *
 * Requires the API server on localhost:8080 with a test DB.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-planning-integration-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

interface OpportunityHit {
  strategyId: string;
  name: string;
  category: string;
  estSavings: number;
  confidence: number;
  cpaEffortHours: number;
  recurring: boolean;
  rationale: string;
  action: string;
  prerequisiteData: string[];
  citation: string;
  inputs: Record<string, unknown>;
}

interface PlanningResponse {
  clientId: number;
  taxYear: number;
  catalogVersion: string;
  hits: OpportunityHit[];
  totalEstSavings: number;
}

interface PlanningMultiYearResponse extends PlanningResponse {
  yearsAvailable: number;
  yearsCovered: number[];
}

function check(label: string, actual: unknown, expected: unknown): void {
  const eq =
    typeof actual === "number" && typeof expected === "number"
      ? Math.abs(actual - expected) <= 5
      : actual === expected;
  if (eq) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

function checkTruthy(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected=${expected} actual=${actual}`);
}

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(`${opts.method ?? "GET"} ${path} -> ${res.status}: ${txt}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function withTempClient<T>(
  name: string,
  filingStatus: string,
  state: string,
  taxYear: number,
  fn: (clientId: number) => Promise<T>,
  extras: Record<string, unknown> = {},
): Promise<T> {
  const client = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Planning", lastName: name,
      email: `planning-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      filingStatus, state, taxYear, ...extras,
    }),
  });
  try {
    return await fn(client.id);
  } finally {
    await api(`/clients/${client.id}`, { method: "DELETE" });
  }
}

function findHit(p: PlanningResponse, id: string): OpportunityHit | undefined {
  return p.hits.find((h) => h.strategyId === id);
}

async function run() {
  // ── 1. SEP-IRA hit fires end-to-end for an SE filer ─────────────────────
  console.log("\n-- Planning integration: G1.1 SEP-IRA via API --");
  await withTempClient("sep_se", "single", "FL", 2024, async (cid) => {
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 80000,
      }),
    });
    await new Promise((r) => setTimeout(r, 300));
    const p = await api<PlanningResponse>(`/clients/${cid}/planning-opportunities`);
    const hit = findHit(p, "G1.1");
    checkTruthy("G1.1 hit present for $80k SE filer", hit != null, true);
    if (hit) {
      check("G1.1 contribution = $13,646", Number(hit.inputs.contribution), 13646);
      check("G1.1 estSavings = $3,002 (22% marginal × contribution)", hit.estSavings, 3002);
    }
    check("clientId echoed", p.clientId, cid);
    check("taxYear = 2024", p.taxYear, 2024);
    checkTruthy("totalEstSavings > 0", p.totalEstSavings > 0, true);
    checkTruthy("catalogVersion present", typeof p.catalogVersion === "string" && p.catalogVersion.length > 0, true);
  });

  // ── 2. PTET (G1.2) fires for NY S-corp owner with high SALT ─────────────
  console.log("\n-- Planning integration: G1.2 PTET via API --");
  await withTempClient("ptet_ny", "married_filing_jointly", "NY", 2024, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 12000, stateCode: "NY" }),
    });
    await api(`/clients/${cid}/k1s`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, entityName: "S-Corp", entityType: "s_corp", activityType: "active",
        box1OrdinaryIncome: 300000,
      }),
    });
    for (const adj of [
      { adjustmentType: "state_income_tax", amount: 20000 },
      { adjustmentType: "state_property_tax", amount: 15000 },
      { adjustmentType: "mortgage_interest", amount: 25000 },
    ]) {
      await api(`/clients/${cid}/adjustments`, {
        method: "POST",
        body: JSON.stringify({ ...adj, description: "Sch A", isApplied: true }),
      });
    }
    await new Promise((r) => setTimeout(r, 400));
    const p = await api<PlanningResponse>(`/clients/${cid}/planning-opportunities`);
    const hit = findHit(p, "G1.2");
    checkTruthy("G1.2 PTET hit present", hit != null, true);
    if (hit) {
      check("G1.2 estSavings = $6,000 (24% × $25k recoverable)", hit.estSavings, 6000);
      check("G1.2 recoverableSalt = $25,000", Number(hit.inputs.recoverableSalt), 25000);
    }
  });

  // ── 3. Pure W-2 single → no hits expected ───────────────────────────────
  console.log("\n-- Planning integration: pure W-2 → no hits --");
  await withTempClient("nohit", "single", "FL", 2024, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 7000, stateCode: "FL" }),
    });
    await new Promise((r) => setTimeout(r, 300));
    const p = await api<PlanningResponse>(`/clients/${cid}/planning-opportunities`);
    // Will fire G1.4 Roth conversion (single 12% bracket, age unknown).
    // Should NOT fire G1.1, G1.2, G1.5-G1.10.
    checkTruthy("no G1.1 for pure-W-2 client", findHit(p, "G1.1") == null, true);
    checkTruthy("no G1.2 for pure-W-2 client", findHit(p, "G1.2") == null, true);
    checkTruthy("no G1.5 (no ISO)", findHit(p, "G1.5") == null, true);
    checkTruthy("no G1.6 (no NII)", findHit(p, "G1.6") == null, true);
    checkTruthy("no G1.7 (no K-1)", findHit(p, "G1.7") == null, true);
    checkTruthy("no G1.9 (no cap activity)", findHit(p, "G1.9") == null, true);
    checkTruthy("no G1.10 (no foreign tax)", findHit(p, "G1.10") == null, true);
  });

  // ── 4. 404 for non-existent client ──────────────────────────────────────
  console.log("\n-- Planning integration: 404 for unknown client --");
  try {
    await api("/clients/999999999/planning-opportunities");
    FAIL.push("FAIL unknown client should 404 but returned 200");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("404")) PASS.push("OK unknown client returns 404");
    else FAIL.push(`FAIL unknown client returned wrong error: ${msg}`);
  }

  // ── 5. G4 multi-year: persistent NIIT pattern fires across 2 years ──────
  // Hand-calc (Single FL, both years above NIIT threshold):
  //   TY2024: W-2 $250k + div $15k + int $5k → AGI $270k. Excess over $200k = $70k.
  //     NII = $15k + $5k = $20k. NIIT base = min($20k, $70k) = $20k.
  //     NIIT = $20k × 3.8% = $760.
  //   TY2025: W-2 $260k + div $18k + int $6k → AGI $284k. Excess = $84k. NII = $24k.
  //     NIIT base = min($24k, $84k) = $24k. NIIT = $24k × 3.8% = $912.
  //   G4.1 fires: firingYears = 2; avgNiit = ($912 + $760)/2 = $836.
  //     estSavings = $836 × 0.5 = $418.
  console.log("\n-- Planning integration: G4.1 persistent NIIT (2 years) --");
  await withTempClient("g4_niit", "single", "FL", 2025, async (cid) => {
    // Year 2024 data
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 250000, federalTaxWithheldBox2: 50000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "div", payerName: "Brokerage", ordinaryDividends: 15000 }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 5000 }),
    });
    // Year 2025 data
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2025, wagesBox1: 260000, federalTaxWithheldBox2: 55000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2025, formType: "div", payerName: "Brokerage", ordinaryDividends: 18000 }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2025, formType: "int", payerName: "Bank", interestIncome: 6000 }),
    });
    // Compute and persist tax_returns rows for both years.
    await api(`/clients/${cid}/tax-return`, { method: "POST", body: JSON.stringify({ taxYear: 2024 }) });
    await api(`/clients/${cid}/tax-return`, { method: "POST", body: JSON.stringify({ taxYear: 2025 }) });
    await new Promise((r) => setTimeout(r, 200));

    const p = await api<PlanningMultiYearResponse>(`/clients/${cid}/planning-multi-year`);
    check("G4 yearsAvailable = 2", p.yearsAvailable, 2);
    checkTruthy("G4 yearsCovered includes 2024 and 2025",
      p.yearsCovered.includes(2024) && p.yearsCovered.includes(2025), true);
    const hit = p.hits.find((h) => h.strategyId === "G4.1");
    checkTruthy("G4.1 persistent NIIT hit fires", hit != null, true);
    if (hit) {
      check("G4.1 estSavings ~$418", hit.estSavings, 418);
      check("G4.1 yearsWithNiit = 2", Number(hit.inputs.yearsWithNiit), 2);
      check("G4.1 avgNiit ~$836", Number(hit.inputs.avgNiit), 836);
    }
    checkTruthy("G4 catalogVersion present", typeof p.catalogVersion === "string" && p.catalogVersion.startsWith("v"), true);
  });

  // ── 6. G4 multi-year: single-year client returns empty hits ─────────────
  console.log("\n-- Planning integration: G4 single-year history returns empty hits --");
  await withTempClient("g4_oneyear", "single", "FL", 2024, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 7000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/tax-return`, { method: "POST", body: JSON.stringify({ taxYear: 2024 }) });
    await new Promise((r) => setTimeout(r, 100));

    const p = await api<PlanningMultiYearResponse>(`/clients/${cid}/planning-multi-year`);
    check("G4 single-year: yearsAvailable = 1", p.yearsAvailable, 1);
    check("G4 single-year: hits empty", p.hits.length, 0);
    check("G4 single-year: totalEstSavings = 0", p.totalEstSavings, 0);
  });

  // ── 7. G4 multi-year: unknown client 404 ────────────────────────────────
  console.log("\n-- Planning integration: G4 unknown client 404 --");
  try {
    await api("/clients/999999999/planning-multi-year");
    FAIL.push("FAIL G4 unknown client should 404 but returned 200");
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("404")) PASS.push("OK G4 unknown client returns 404");
    else FAIL.push(`FAIL G4 unknown client returned wrong error: ${msg}`);
  }

  // ── results ─────────────────────────────────────────────────────────────
  console.log(`\nPASSED: ${PASS.length}`);
  if (FAIL.length > 0) {
    console.log(`FAILED: ${FAIL.length}`);
    for (const f of FAIL) console.log(`  ${f}`);
    process.exit(1);
  }
  console.log("ALL PLANNING INTEGRATION TESTS PASS");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
