/**
 * Integration-level deep tests against the live API. Specifically targets:
 *   - Double-counting risks (1099-NEC + manual SE adj)
 *   - Multi-year 1099 isolation
 *   - Capital losses (negative gains)
 *   - NIIT triggered solely from 1099 data (no manual adj)
 *   - Cascade delete includes 1099s
 *   - Edge case: $0 income return
 *   - 1099-INT tax-exempt portion subtracted correctly
 *   - 1099-DIV: qualified dividends only counted once
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-deep-integration-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 0.5) { return Math.abs(a - b) <= tol; }
function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (diff ${(actual - expected).toFixed(2)})`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function checkTruthy(label: string, value: unknown) {
  if (value) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: was ${JSON.stringify(value)}`);
}

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${txt}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function withTempClient<T>(extras: Record<string, unknown>, fn: (cid: number) => Promise<T>) {
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Deep", lastName: "Test",
      email: `deep-${Date.now()}-${Math.random().toString(36).slice(2)}@x.com`,
      filingStatus: "single", state: "FL", taxYear: 2024,
      ...extras,
    }),
  });
  try { return await fn(c.id); }
  finally { await api(`/clients/${c.id}`, { method: "DELETE" }).catch(() => {}); }
}

async function settle() { await new Promise(r => setTimeout(r, 350)); }

async function run() {
  console.log("══════════ DEEP INTEGRATION TESTS ══════════\n");

  // ── Test 1: 1099-NEC + manual SE adjustment do NOT double-count ──
  console.log("── 1. Pipeline does NOT double-count when both 1099-NEC and manual SE adj are present ──");
  await withTempClient({}, async (cid) => {
    // Add $20k from 1099-NEC and $30k from manual self_employment_income adj
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "nec", payerName: "Acme", nonemployeeCompensation: 20000 }),
    });
    await api(`/clients/${cid}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "self_employment_income", amount: 30000, description: "Side gig", isApplied: true }),
    });
    await settle();

    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // Total SE = $50k. SE tax = $50k × 0.9235 × 0.153 = $7,064.78
    check("SE tax on combined $50k SE income", Number(ret.selfEmploymentTax), 7064.78, 1);
    // Total income should be $50k (NOT $100k from double-counting)
    check("Total income = $50k (not double-counted)", Number(ret.totalIncome), 50000);
    // AGI = $50k - 1/2 SE tax (~$3,532)
    check("AGI = $50k - 1/2 SE tax", Number(ret.adjustedGrossIncome), 50000 - 7064.78 / 2, 1);
  });

  // ── Test 2: 1099-INT Box 1 and Box 8 are DISJOINT (Box 8 not netted) ──
  console.log("\n── 2. 1099-INT Box 8 (tax-exempt) is NOT subtracted from taxable Box 1 ──");
  await withTempClient({}, async (cid) => {
    // Box 1 (taxable) = $10k, Box 8 (tax-exempt) = $4k — disjoint on the form.
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 10000, taxExemptInterest: 4000 }),
    });
    await settle();
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // Taxable interest = Box 1 = $10k (Box 8 is separate tax-exempt, never netted).
    check("Box 8 not subtracted: total income = $10k", Number(ret.totalIncome), 10000);
  });

  // ── Test 3: 1099-DIV qualified dividends count once ──
  console.log("\n── 3. 1099-DIV qualified portion taxed at preferential rate, not double-counted ──");
  await withTempClient({}, async (cid) => {
    // $10k ordinary divs, $7k qualified portion
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 10000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "div", payerName: "Vanguard", ordinaryDividends: 10000, qualifiedDividends: 7000 }),
    });
    await settle();
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // Per Form 1040 Line 3b: full ordinary dividends $10k goes into total income
    // Total income = wages $80k + $10k full dividends = $90k
    check("Total income = wages + full ordinary dividends (Line 3b)", Number(ret.totalIncome), 90000);
    // Cap gains tax: 15% × $7k qualified (since AGI > 0% threshold of $47k)
    check("Cap gains tax on $7k qualified div", Number(ret.capitalGainsTax), 7000 * 0.15, 1);
    // Verify qualified portion isn't taxed at ordinary rates AND preferential rates
    // (federal tax should reflect ordinary brackets on (taxable - $7k qualified) + 15% × $7k)
  });

  // ── Test 4: Multi-year 1099 isolation (1099 from wrong year doesn't bleed in) ──
  console.log("\n── 4. Multi-year: TY2024 ignores 2025 1099, TY2025 ignores 2024 1099 ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "nec", payerName: "Acme24", nonemployeeCompensation: 30000 }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2025, formType: "nec", payerName: "Acme25", nonemployeeCompensation: 50000 }),
    });
    await settle();

    const ty24 = await api<any>(`/clients/${cid}/tax-return/preview?taxYear=2024`);
    const ty25 = await api<any>(`/clients/${cid}/tax-return/preview?taxYear=2025`);
    check("TY2024 sees only $30k", Number(ty24.totalIncome), 30000);
    check("TY2025 sees only $50k", Number(ty25.totalIncome), 50000);
  });

  // ── Test 5: Capital losses — Schedule D Line 21 deduction ($3k cap) + carryforward ──
  // Per Phase 2b (IRC §1211): net capital loss reduces ordinary income up to
  // $3,000 ($1,500 MFS). Excess carries forward preserving short/long character.
  // Hand-calc: net loss = -$5k LTCG + -$2k STCG = -$7,000.
  //   $3k consumed: short first ($2k), then long ($1k). Total income = $70k - $3k = $67k.
  //   Carryforward short: $0, carryforward long: $5k - $1k = $4,000.
  console.log("\n── 5. Capital losses (Schedule D Line 21 $3k cap + carryforward) ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 70000, federalTaxWithheldBox2: 9000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "b", payerName: "Brokerage", longTermGainLoss: -5000, shortTermGainLoss: -2000 }),
    });
    await settle();
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    checkExact("Negative LTCG → $0 capital gains tax", Number(ret.capitalGainsTax || 0), 0);
    check("Total income = wages - $3k cap loss = $67,000", Number(ret.totalIncome), 67000);
    check("Capital loss deducted (Sched D Line 21) = $3,000", Number(ret.capitalLossDeducted), 3000);
    check("Carryforward short = $0 (short consumed first)", Number(ret.capitalLossCarryforwardShort), 0);
    check("Carryforward long = $4,000 ($5k LT loss - $1k applied after $2k ST)", Number(ret.capitalLossCarryforwardLong), 4000);
    check("Net capital gain/loss (Sched D Line 16) = -$7,000", Number(ret.netCapitalGainLoss), -7000);
  });

  // ── Test 6: NIIT triggered ONLY from 1099 data (no manual adjustment) ──
  console.log("\n── 6. NIIT fires from 1099-derived investment income alone ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 220000, federalTaxWithheldBox2: 50000, stateCode: "FL" }),
    });
    // $30k interest + $20k LTCG → $50k investment income
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "int", interestIncome: 30000 }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "b", longTermGainLoss: 20000 }),
    });
    await settle();
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // AGI = $220k wages + $30k interest = $250k (LTCG NOT in ordinary income)
    // Wait: LTCG also adds to AGI — checking pipeline
    // Excess over $200k = $50k. Investment income = $30k + $20k = $50k.
    // NIIT = min($50k, $50k) × 3.8% = $1,900
    checkTruthy("NIIT > 0 from 1099 alone", Number(ret.niitTax) > 0);
    check("NIIT amount", Number(ret.niitTax), 1900, 5);
  });

  // ── Test 7: Cascade delete removes 1099 records ──
  console.log("\n── 7. Cascade delete removes 1099 records ──");
  const stale = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ firstName: "Cascade", lastName: "Test", email: `casc-${Date.now()}@x.com`, filingStatus: "single", state: "FL", taxYear: 2024 }),
  });
  await api(`/clients/${stale.id}/form1099data`, {
    method: "POST",
    body: JSON.stringify({ taxYear: 2024, formType: "nec", nonemployeeCompensation: 5000 }),
  });
  await api(`/clients/${stale.id}/form1099data`, {
    method: "POST",
    body: JSON.stringify({ taxYear: 2024, formType: "int", interestIncome: 200 }),
  });
  await settle();
  await api(`/clients/${stale.id}`, { method: "DELETE" });
  // Try to GET 1099s — they shouldn't exist anymore
  const orphaned = await api<any[]>(`/clients/${stale.id}/form1099data`);
  checkExact("All 1099 records removed on cascade delete", orphaned.length, 0);

  // ── Test 8: Empty client (no W-2, no 1099) doesn't crash ──
  console.log("\n── 8. Empty client (no income at all) calculates cleanly ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/tax-return`, { method: "POST", body: JSON.stringify({ taxYear: 2024 }) });
    await settle();
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    checkExact("Total income = 0", Number(ret.totalIncome), 0);
    checkExact("Federal tax = 0", Number(ret.federalTaxLiability), 0);
    checkExact("Federal refund = 0", Number(ret.federalRefundOrOwed), 0);
  });

  // ── Test 9: Massive numbers don't overflow (sanity) ──
  console.log("\n── 9. Very high income (top bracket) calculates without overflow ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 5000000, federalTaxWithheldBox2: 1500000, stateCode: "FL" }),
    });
    await settle();
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // Federal tax should be sane (37% top bracket × millions, but precise number depends on bracket math)
    // Just sanity-check it's a number > 0
    checkTruthy("Federal tax on $5M is finite and positive", Number.isFinite(Number(ret.federalTaxLiability)) && Number(ret.federalTaxLiability) > 0);
    checkTruthy("Federal tax < $5M (sanity, can't exceed income)", Number(ret.federalTaxLiability) < 5000000);
  });

  // ── Test 10: 1099-DIV with totalCapitalGainDistribution adds to LTCG ──
  console.log("\n── 10. 1099-DIV cap gain distribution flows to LTCG ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 6000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "div", ordinaryDividends: 0, qualifiedDividends: 0, totalCapitalGainDistribution: 10000 }),
    });
    await settle();
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // LTCG via dist: $10k. Ordinary on $50k - $14,600 std = $35,400. LTCG fills $35,400-$45,400; all in 0% bracket.
    // Capital gains tax = $0
    checkExact("Cap gain dist with low ordinary → all 0% bracket → $0", Number(ret.capitalGainsTax || 0), 0);
  });

  // ── Test 11: Pipeline year change: switching client.taxYear creates a new row ──
  console.log("\n── 11. Multi-year persistence: changing client.taxYear creates separate rows ──");
  await withTempClient({}, async (cid) => {
    // Add 2024 W-2
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 12000, stateCode: "FL" }),
    });
    await settle();
    // Calculate for 2024
    await api(`/clients/${cid}/tax-return`, { method: "POST", body: JSON.stringify({ taxYear: 2024 }) });

    // Add 2025 W-2 and switch year
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2025, wagesBox1: 90000, federalTaxWithheldBox2: 14000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}`, { method: "PATCH", body: JSON.stringify({ taxYear: 2025 }) });
    await settle();

    const allReturns = await api<any[]>(`/clients/${cid}/tax-returns`);
    checkExact("Two separate rows persisted (2024 + 2025)", allReturns.length, 2);
    const years = allReturns.map(r => r.taxYear).sort();
    checkExact("Years preserved", JSON.stringify(years), JSON.stringify([2024, 2025]));
  });

  // ── Test 12: Adjustment investment_income still works alongside 1099 ──
  console.log("\n── 12. Manual investment_income adjustment combines with 1099 invest income for NIIT ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 220000, federalTaxWithheldBox2: 50000, stateCode: "FL" }),
    });
    // $20k from 1099-INT + $20k from manual investment_income adj
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "int", interestIncome: 20000 }),
    });
    await api(`/clients/${cid}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "investment_income", amount: 20000, description: "Other invest", isApplied: true }),
    });
    await settle();
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // AGI: $220k wages + $20k interest + $20k adjustment = $260k
    // Excess over $200k = $60k. Invest income = $40k. NIIT = min($40k, $60k) × 3.8% = $1,520
    check("NIIT combines 1099 + adjustment investment income", Number(ret.niitTax), 1520, 5);
  });

  // ── Test 13: Adjustment-type API coverage for engine-only types ──
  // Regression for: BP1 (k1_passive_loss_carryforward) + BP3 (amt_iso_bargain_element,
  // amt_state_tax_addback_override) were added to the engine but missed in the
  // OpenAPI enum + Zod validator, so the API rejected them with 400 even though
  // the pure-engine tests passed. Caught during C12b validation-packet build.
  console.log("\n── 13. API accepts BP1/BP3 engine-only adjustment types (regression) ──");
  for (const adjType of ["amt_iso_bargain_element", "amt_state_tax_addback_override", "k1_passive_loss_carryforward"]) {
    await withTempClient({}, async (cid) => {
      const res = await fetch(`http://localhost:8080/api/clients/${cid}/adjustments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustmentType: adjType, amount: 1000, description: "regression smoke", isApplied: true }),
      });
      checkExact(`API accepts adjustmentType=${adjType}`, res.status, 201);
    });
  }

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  DEEP INTEGRATION RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  console.log("══════════════════════════════════════════════════════════════════");
  if (FAIL.length > 0) {
    console.log("\nFAILURES:");
    for (const f of FAIL) console.log("  " + f);
    process.exit(1);
  }
  process.exit(0);
}

run().catch((e) => { console.error("Test runner crashed:", e); process.exit(2); });
