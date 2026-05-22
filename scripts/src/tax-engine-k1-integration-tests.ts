/**
 * BP1 — Schedule K-1 integration tests.
 *
 * Exercises the full HTTP CRUD + recalc pipeline:
 *   POST /clients/:id/k1s → engine recompute → GET /clients/:id/tax-return
 * Hand-calced against IRS Form 1065 K-1 / 1120-S K-1 / Form 8995 / Pub 925.
 *
 * Requires the api-server running at http://localhost:8080.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-k1-integration-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
  return res.json();
}

async function withTempClient<T>(extras: Record<string, unknown>, fn: (cid: number) => Promise<T>): Promise<T> {
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "K1",
      lastName: "Test",
      email: `k1-${Date.now()}-${Math.random().toString(36).slice(2)}@e.co`,
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
      ...extras,
    }),
  });
  try {
    return await fn(c.id);
  } finally {
    await api(`/clients/${c.id}`, { method: "DELETE" }).catch(() => {});
  }
}

async function settle() { await new Promise((r) => setTimeout(r, 75)); }

async function run() {
  // ──────────────────────────────────────────────────────────────────────
  console.log("── 1. S-corp K-1 active, $50k Box 1 → AGI $130k ──");
  // Hand-calc (matches pure Test A): AGI = $80k W-2 + $50k K-1 = $130k.
  // Taxable = $115,400; federal tax = $20,738.50.
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "FL" }),
    });
    const k1 = await api<any>(`/clients/${cid}/k1s`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024,
        entityName: "Acme S Corp",
        entityType: "s_corp",
        activityType: "active",
        box1OrdinaryIncome: 50000,
      }),
    });
    checkExact("K-1 row created with entityType s_corp", k1.entityType, "s_corp");
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("AGI = $130,000", Number(r.adjustedGrossIncome), 130000, 2);
    check("Taxable = $115,400", Number(r.taxableIncome), 115400, 2);
    check("Federal tax = $20,738.50", Number(r.federalTaxLiability), 20738.5, 2);
    check("SE tax = $0 (S-corp K-1)", Number(r.selfEmploymentTax ?? 0), 0, 0.01);
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log("\n── 2. Partnership K-1 passive, $30k loss fully suspended ──");
  // AGI unchanged at $80k; K-1 passive suspended = $30k.
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/k1s`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024,
        entityName: "Sleepy Partners LP",
        entityType: "partnership",
        activityType: "passive",
        box1OrdinaryIncome: -30000,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("AGI = $80,000 (passive loss suspended)", Number(r.adjustedGrossIncome), 80000, 2);
    check("Federal tax = $9,441.00", Number(r.federalTaxLiability), 9441, 2);
    check("K-1 passive loss suspended (persisted) = $30,000", Number(r.k1PassiveLossSuspended ?? 0), 30000, 0.5);
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log("\n── 3. Partnership K-1 active with §199A QBI flow ──");
  // AGI = $130k; QBI deduction = $16k; taxable = $99,400; federal tax = $16,921.
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/k1s`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024,
        entityName: "QBI LP",
        entityType: "partnership",
        activityType: "active",
        box1OrdinaryIncome: 80000,
        selfEmploymentEarnings: 0,
        section199aQbi: 80000,
        section199aW2Wages: 0,
        section199aUbia: 0,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("AGI = $130,000", Number(r.adjustedGrossIncome), 130000, 2);
    check("QBI deduction = $16,000", Number(r.qbiDeduction ?? 0), 16000, 0.5);
    check("Taxable (after QBI) = $99,400", Number(r.taxableIncome), 99400, 2);
    check("Federal tax = $16,921.00", Number(r.federalTaxLiability), 16921, 2);
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log("\n── 4. Partnership K-1 SE flows to Schedule SE (Test G mirror) ──");
  // AGI = $55,761.13; SE tax = $8,477.73; total federal = $13,185.07.
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/k1s`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024,
        entityName: "GP LP",
        entityType: "partnership",
        activityType: "active",
        box1OrdinaryIncome: 60000,
        selfEmploymentEarnings: 60000,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("AGI = $55,761.13", Number(r.adjustedGrossIncome), 55761.13, 1);
    check("SE tax = $8,477.73", Number(r.selfEmploymentTax ?? 0), 8477.73, 1);
    check("Federal tax = $13,185.07", Number(r.federalTaxLiability), 13185.07, 1);
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log("\n── 5. CRUD: List/Patch/Delete on K-1 round-trips correctly ──");
  await withTempClient({}, async (cid) => {
    const created = await api<any>(`/clients/${cid}/k1s`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024,
        entityName: "Initial Name",
        entityType: "partnership",
        activityType: "active",
        box1OrdinaryIncome: 10000,
      }),
    });
    checkExact("Created entityName", created.entityName, "Initial Name");
    checkExact("Created box1 = 10000", created.box1OrdinaryIncome, 10000);

    const list1 = await api<any[]>(`/clients/${cid}/k1s`);
    checkExact("List returns 1 K-1", list1.length, 1);

    const updated = await api<any>(`/clients/${cid}/k1s/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ entityName: "Renamed", box1OrdinaryIncome: 25000 }),
    });
    checkExact("Updated entityName", updated.entityName, "Renamed");
    checkExact("Updated box1 = 25000", updated.box1OrdinaryIncome, 25000);

    await api(`/clients/${cid}/k1s/${created.id}`, { method: "DELETE" });
    const list2 = await api<any[]>(`/clients/${cid}/k1s`);
    checkExact("After delete, list is empty", list2.length, 0);
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log("\n── 6. Mutation triggers recalc (engine sees new K-1 row) ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }),
    });
    await settle();
    const before = await api<any>(`/clients/${cid}/tax-return`);
    const baselineAgi = Number(before.adjustedGrossIncome);

    await api(`/clients/${cid}/k1s`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024,
        entityName: "Recalc LP",
        entityType: "partnership",
        activityType: "active",
        box1OrdinaryIncome: 25000,
      }),
    });
    await settle();
    const after = await api<any>(`/clients/${cid}/tax-return`);
    check(
      "AGI increased by exactly $25k after K-1 mutation",
      Number(after.adjustedGrossIncome) - baselineAgi,
      25000,
      1,
    );
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log("\n── 7. Audit log captures K-1 create/update/delete ──");
  await withTempClient({}, async (cid) => {
    const k1 = await api<any>(`/clients/${cid}/k1s`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024,
        entityName: "Audit Test",
        entityType: "s_corp",
        box1OrdinaryIncome: 5000,
      }),
    });
    await api(`/clients/${cid}/k1s/${k1.id}`, {
      method: "PATCH",
      body: JSON.stringify({ box1OrdinaryIncome: 7500 }),
    });
    await api(`/clients/${cid}/k1s/${k1.id}`, { method: "DELETE" });
    const audit = await api<any[]>(`/clients/${cid}/audit-log`);
    const actions = audit.filter((a) => a.entityId === k1.id).map((a) => a.action).sort();
    checkExact("Audit captured create + update + delete", actions, ["create", "delete", "update"]);
  });

  // ──────────────────────────────────────────────────────────────────────
  console.log(`\n────────────────────────────────────────────────────────────────────`);
  console.log(`PASS: ${PASS.length}`);
  for (const p of PASS) console.log("  " + p);
  if (FAIL.length > 0) {
    console.log(`\nFAIL: ${FAIL.length}`);
    for (const f of FAIL) console.log("  " + f);
    process.exit(1);
  }
  console.log(`\nAll ${PASS.length} K-1 integration assertions passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
