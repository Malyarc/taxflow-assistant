/**
 * SCH1 — surface the T1.1 engine outputs through the persistence + API seam.
 *
 * The engine (computeTaxReturnPure) computes the state individual-mandate
 * penalty, unrecaptured §1250 gain (25%), 28%-rate collectibles gain, and the
 * Schedule H household-employment tax. These were correct in the engine but NOT
 * persisted to tax_returns nor exposed in the API TaxReturn schema, so the
 * results view couldn't disclose them. This verifies they round-trip:
 *   client + adjustments → recalc/persist → GET /tax-return → typed fields.
 *
 * Hand-calc references:
 *   • Schedule H: 15.3% FICA on $30k cash wages + 0.6% FUTA on the $7k base
 *       = 0.153×30,000 + 0.006×7,000 = 4,590 + 42 = $4,632.
 *   • CA mandate (FTB 3853 % method): 2.5% × (household income − filing
 *       threshold). Single, 0 deps, 2024 threshold $17,818; income = $120k
 *       wages + $60k LTCG = $180,000 → 2.5% × 162,182 = $4,054.55 (< the
 *       $4,176 1-person bronze cap, so the % method drives it).
 *   • §1250 / 28% gains pass through verbatim as Schedule D line 19 / 18 subsets.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-sch1-surface-integration-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function settle() { await new Promise((r) => setTimeout(r, 80)); }

async function withTempClient<T>(extras: Record<string, unknown>, fn: (cid: number) => Promise<T>): Promise<T> {
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Sch1", lastName: "Surface",
      email: `sch1-${Date.now()}-${Math.random().toString(36).slice(2)}@e.co`,
      filingStatus: "single", state: "CA", taxYear: 2024, ...extras,
    }),
  });
  try {
    return await fn(c.id);
  } finally {
    await api(`/clients/${c.id}`, { method: "DELETE" }).catch(() => {});
  }
}

async function run() {
  console.log("── SCH1: T1.1 disclosure scalars round-trip through the API ──");
  await withTempClient({ dependentsUnder17: 0 }, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 18000, stateCode: "CA" }),
    });
    const adjs = [
      { adjustmentType: "household_employee_cash_wages", amount: 30000, description: "nanny", isApplied: true, taxYear: 2024 },
      { adjustmentType: "unrecaptured_section_1250_gain", amount: 40000, description: "1250", isApplied: true, taxYear: 2024 },
      { adjustmentType: "collectibles_28_rate_gain", amount: 10000, description: "art", isApplied: true, taxYear: 2024 },
      { adjustmentType: "long_term_capital_gain", amount: 60000, description: "ltcg host for the 1250/28 subsets", isApplied: true, taxYear: 2024 },
      { adjustmentType: "months_without_minimum_coverage", amount: 12, description: "uninsured", isApplied: true, taxYear: 2024 },
    ];
    for (const a of adjs) await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify(a) });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return?taxYear=2024`);

    check("Schedule H household-employment tax persisted = $4,632", Number(r.householdEmploymentTax), 4632, 0.5);
    check("Unrecaptured §1250 gain persisted = $40,000", Number(r.unrecapturedSection1250Gain), 40000, 0.5);
    check("28%-rate collectibles gain persisted = $10,000", Number(r.collectibles28RateGain), 10000, 0.5);
    check("CA individual-mandate penalty persisted (FTB threshold) = $4,054.55", Number(r.stateIndividualMandatePenalty), 4054.55, 0.5);
  });

  // Negative control: a plain single FL W-2-only return → all four are 0 (no
  // mandate state, no household employee, no business-property/collectibles gain).
  console.log("── SCH1: inert when none of the items apply (all 0) ──");
  await withTempClient({ state: "FL" }, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 90000, federalTaxWithheldBox2: 12000, stateCode: "FL" }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return?taxYear=2024`);
    check("Schedule H = 0 (no household employee)", Number(r.householdEmploymentTax), 0, 0.01);
    check("§1250 = 0 (no business property)", Number(r.unrecapturedSection1250Gain), 0, 0.01);
    check("28% = 0 (no collectibles)", Number(r.collectibles28RateGain), 0, 0.01);
    check("Mandate penalty = 0 (FL is not a mandate state)", Number(r.stateIndividualMandatePenalty), 0, 0.01);
  });

  // ── Summary ──
  console.log(`\n${PASS.length} passed`);
  if (FAIL.length) {
    console.error(`${FAIL.length} failed:`);
    for (const f of FAIL) console.error(`  ${f}`);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("Runner error:", e);
  process.exit(1);
});
