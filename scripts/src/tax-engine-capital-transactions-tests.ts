/**
 * B4 — Schedule D / Form 8949 per-transaction integration tests.
 *
 * Validates that when capital_transactions rows exist for a client's
 * tax year:
 *   - per-transaction gain/loss replaces 1099-B aggregate ST/LT totals
 *   - 1099-DIV box 2a cap-gain distributions remain additive (separate stream)
 *   - wash-sale-disallowed amounts (column g) correctly reduce the loss
 *   - per-transaction net flows through the existing Schedule D netting +
 *     §1211(b) $3k cap + carryforward
 *
 * Hand-calc references: IRS Form 8949 instructions; Pub 550 (wash sales,
 * holding period, cap loss limit); Pub 555 (MFS $1.5k cap).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-capital-transactions-tests.ts
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
      firstName: "CapTxns",
      lastName: "Test",
      email: `cap-${Date.now()}-${Math.random().toString(36).slice(2)}@e.co`,
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

async function settle() { await new Promise((r) => setTimeout(r, 50)); }

async function run() {
  console.log("── 1. Three short-term sales, no wash sale → net $1,500 ST gain ──");
  // Hand-calc: $1,000 + (-$500) + $1,000 = $1,500
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "FL" }) });
    const txns = [
      { description: "100 sh AAPL", proceeds: 5000, costBasis: 4000, adjustmentAmount: 0, formBox: "A", taxYear: 2024 },
      { description: "50 sh TSLA", proceeds: 3000, costBasis: 3500, adjustmentAmount: 0, formBox: "A", taxYear: 2024 },
      { description: "200 sh NVDA", proceeds: 7000, costBasis: 6000, adjustmentAmount: 0, formBox: "A", taxYear: 2024 },
    ];
    for (const t of txns) {
      await api(`/clients/${cid}/capital-transactions`, { method: "POST", body: JSON.stringify(t) });
    }
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    // STCG is taxed as ordinary income; LTCG = 0
    // Net cap gain (ST + LT) = $1,500
    check("Net capital gain/loss = $1,500", Number(r.netCapitalGainLoss), 1500, 2);
  });

  console.log("\n── 2. Wash sale full disallowance: $1,000 loss but code W with $1,000 adj → $0 ──");
  // Sell 100 sh at $40 (proceeds $4,000), bought at $50 (basis $5,000) → $1,000 loss
  // Repurchase within 30 days → broker reports Box 1g = $1,000 disallowance
  // Form 8949: code W, adj $1,000 (positive) → gain/loss = $4,000 - $5,000 + $1,000 = $0
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "FL" }) });
    await api(`/clients/${cid}/capital-transactions`, {
      method: "POST",
      body: JSON.stringify({
        description: "100 sh MEME — wash", proceeds: 4000, costBasis: 5000,
        adjustmentCode: "W", adjustmentAmount: 1000, washSaleDisallowed: 1000,
        formBox: "A", taxYear: 2024,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("Net cap gain/loss = $0 (loss fully disallowed)", Number(r.netCapitalGainLoss), 0, 2);
  });

  console.log("\n── 3. Partial wash sale: 30 of 100 shares repurchased → 30% of $1,000 loss disallowed ──");
  // Sell 100 sh at $1,000 loss. Repurchase 30 within 61-day window.
  // Pub 550: 30/100 = 30% disallowed = $300. Deductible loss = $700.
  // 8949: code W, adj $300 → gain/loss = $4,000 - $5,000 + $300 = -$700
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "FL" }) });
    await api(`/clients/${cid}/capital-transactions`, {
      method: "POST",
      body: JSON.stringify({
        description: "100 sh GME — partial wash", proceeds: 4000, costBasis: 5000,
        adjustmentCode: "W", adjustmentAmount: 300, washSaleDisallowed: 300,
        formBox: "A", taxYear: 2024,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("Net cap loss = -$700 (partial wash, 70% deductible)", Number(r.netCapitalGainLoss), -700, 2);
  });

  console.log("\n── 4. Mixed short-term + long-term gains ──");
  // ST: $1,500 gain (Box A)
  // LT: $2,000 gain (Box D)
  // Net = $3,500
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "FL" }) });
    await api(`/clients/${cid}/capital-transactions`, {
      method: "POST",
      body: JSON.stringify({ description: "ST gain", proceeds: 5000, costBasis: 3500, formBox: "A", taxYear: 2024 }),
    });
    await api(`/clients/${cid}/capital-transactions`, {
      method: "POST",
      body: JSON.stringify({ description: "LT gain", proceeds: 12000, costBasis: 10000, formBox: "D", taxYear: 2024 }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("Net cap gain = $3,500 (ST $1,500 + LT $2,000)", Number(r.netCapitalGainLoss), 3500, 2);
  });

  console.log("\n── 5. §1211(b) $3k cap on net loss + carryforward (Single TY2024) ──");
  // Single LT loss of $10,000. $3,000 deducted, $7,000 carryforward.
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "FL" }) });
    await api(`/clients/${cid}/capital-transactions`, {
      method: "POST",
      body: JSON.stringify({ description: "Big LT loss", proceeds: 1000, costBasis: 11000, formBox: "D", taxYear: 2024 }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    // Net cap = -$10k; deducted = -$3k against ordinary; carryforward $7k (long-term)
    check("Capital loss applied to AGI = $3,000 (cap)", Number(r.capitalLossDeducted), 3000, 2);
    check("Long-term carryforward = $7,000", Number(r.capitalLossCarryforwardLong), 7000, 2);
  });

  console.log("\n── 6. Per-transaction overrides 1099-B aggregate (no double-count) ──");
  // 1099-B record reports $5,000 ST gain (aggregate).
  // capital_transactions: a single -$200 ST loss.
  // Engine should use the per-transaction value ($-200), not 1099-B aggregate.
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "FL" }) });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "b", payerName: "Broker", shortTermGainLoss: 5000 }),
    });
    await api(`/clients/${cid}/capital-transactions`, {
      method: "POST",
      body: JSON.stringify({ description: "Single ST loss", proceeds: 800, costBasis: 1000, formBox: "A", taxYear: 2024 }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    // Per-transaction wins: -$200 ST loss (NOT $5,000 from aggregate)
    check("Per-transaction overrides 1099-B aggregate: net = -$200", Number(r.netCapitalGainLoss), -200, 2);
  });

  console.log("\n── 7. Per-transaction + 1099-DIV cgDistributions (separate streams) ──");
  // 1099-DIV box 2a = $500 LT cap-gain distribution (mutual fund).
  // capital_transactions: $1,000 LT gain (Box D).
  // Both should flow to LT total: $500 + $1,000 = $1,500.
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "FL" }) });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "div", payerName: "Vanguard", ordinaryDividends: 0, qualifiedDividends: 0, totalCapitalGainDistribution: 500 }),
    });
    await api(`/clients/${cid}/capital-transactions`, {
      method: "POST",
      body: JSON.stringify({ description: "LT brokerage gain", proceeds: 5000, costBasis: 4000, formBox: "D", taxYear: 2024 }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("LT total = $1,500 (txn $1,000 + 1099-DIV cgDist $500)", Number(r.netCapitalGainLoss), 1500, 2);
  });

  console.log("\n── 8. CRUD lifecycle ──");
  await withTempClient({}, async (cid) => {
    const created = await api<any>(`/clients/${cid}/capital-transactions`, {
      method: "POST",
      body: JSON.stringify({ description: "Original", proceeds: 1000, costBasis: 800, formBox: "A", taxYear: 2024 }),
    });
    const listed = await api<any[]>(`/clients/${cid}/capital-transactions`);
    checkExact("List shows 1 row", listed.length, 1);
    await api(`/clients/${cid}/capital-transactions/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "Renamed", proceeds: 2000 }),
    });
    const listed2 = await api<any[]>(`/clients/${cid}/capital-transactions`);
    checkExact("After PATCH description = Renamed", listed2[0].description, "Renamed");
    check("After PATCH proceeds = $2,000", Number(listed2[0].proceeds), 2000, 0.01);
    await api(`/clients/${cid}/capital-transactions/${created.id}`, { method: "DELETE" });
    const listed3 = await api<any[]>(`/clients/${cid}/capital-transactions`);
    checkExact("After DELETE list empty", listed3.length, 0);
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
