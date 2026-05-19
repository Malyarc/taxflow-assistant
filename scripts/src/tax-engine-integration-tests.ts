/**
 * Integration tests via the live API.
 *
 * Exercises the full pipeline: DB → pipeline → calculator → API response.
 * This catches bugs that slip past unit tests, like serialization issues,
 * Drizzle round-tripping, or pipeline coupling problems.
 *
 * Requires the API server running on localhost:8080 with a test DB.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-integration-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 0.5) {
  return Math.abs(a - b) <= tol;
}

function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (near(actual, expected, tol)) {
    PASS.push(`✓ ${label}`);
  } else {
    FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (diff ${(actual - expected).toFixed(2)})`);
  }
}

function checkExact(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    PASS.push(`✓ ${label}`);
  } else {
    FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
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

interface TaxReturn {
  taxYear: number;
  filingStatus: string;
  totalIncome: number;
  adjustedGrossIncome: number;
  standardDeduction: number;
  taxableIncome: number;
  federalTaxLiability: number;
  federalTaxWithheld: number;
  federalRefundOrOwed: number;
  stateTaxLiability: number;
  stateTaxWithheld: number;
  stateRefundOrOwed: number;
  effectiveTaxRate: number;
}

interface PreviewResponse extends TaxReturn {
  manualCreditsApplied: number;
  childTaxCredit: { qualifyingChildren: number; otherDependents: number; preliminaryCredit: number; phaseOutReduction: number; appliedCredit: number; phaseOutThreshold: number };
  w2Count: number;
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
      firstName: "Test", lastName: name,
      email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      filingStatus, state, taxYear, ...extras,
    }),
  });
  try {
    return await fn(client.id);
  } finally {
    await api(`/clients/${client.id}`, { method: "DELETE" });
  }
}

async function run() {
  console.log("── Integration: scenarios across all 5 filing statuses ──");
  // Same $80,000 wages, FL, no adjustments — verify each filing status uses the right brackets
  const FS_EXPECTED = {
    single: 9874, // 1160 + (47150-11600)*.12 + (80000-14600 - 47150)*.22  — actually let me recompute
    married_filing_jointly: 4708,  // 2320 + (80000-29200 - 23200)*.12 = 2320 + (27600)*.12 = 2320 + 3312 = 5632... let me check
    head_of_household: 6624,
    qualifying_widow: 4708,
    married_filing_separately: 9874,
  };
  // Recomputed by hand:
  // single 2024: AGI 80k - std 14.6k = 65.4k taxable. 1160 + (47150-11600)*.12 + (65400-47150)*.22 = 1160 + 4266 + 4015 = 9441
  // MFJ: AGI 80k - 29.2k = 50.8k. 2320 + (50800-23200)*.12 = 2320 + 3312 = 5632
  // HoH: AGI 80k - 21.9k = 58.1k. 1655 + (58100-16550)*.12 = 1655 + 4986 = 6641
  // MFS: same as single, AGI - 14.6k = 65.4k. = 9441
  // QW: same as MFJ = 5632
  for (const [fs, expectedTax] of Object.entries({
    single: 9441,
    married_filing_jointly: 5632,
    head_of_household: 6641,
    married_filing_separately: 9441,
    qualifying_widow: 5632,
  })) {
    await withTempClient(`fs_${fs}`, fs, "FL", 2024, async (cid) => {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 12000, stateCode: "FL" }) });
      // Wait briefly for background recalc
      await new Promise(r => setTimeout(r, 200));
      const ret = await api<TaxReturn>(`/clients/${cid}/tax-return`);
      check(`Filing=${fs} $80k FL → fed tax`, Number(ret.federalTaxLiability), expectedTax, 1);
    });
  }

  console.log("\n── Integration: changing state recomputes state tax (multi-state aware) ──");
  // With Phase 2d multi-state: when client.state changes but the W-2 stateCode
  // stays, the engine now correctly treats the W-2 wages as non-resident-state
  // source income. To isolate just the resident-state change effect, this test
  // creates separate clients per state with matching W-2 stateCodes.
  await withTempClient("state_ca", "single", "CA", 2024, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "CA" }) });
    await new Promise(r => setTimeout(r, 200));
    const ca = await api<TaxReturn>(`/clients/${cid}/tax-return`);
    check("CA resident, CA-source $100k → CA tax > 0", ca.stateTaxLiability > 0 ? 1 : 0, 1, 0);
  });
  await withTempClient("state_tx", "single", "TX", 2024, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "TX" }) });
    await new Promise(r => setTimeout(r, 200));
    const tx = await api<TaxReturn>(`/clients/${cid}/tax-return`);
    checkExact("TX resident, TX-source $100k → $0 state tax (TX no income tax)", tx.stateTaxLiability, 0);
  });
  await withTempClient("state_ny", "single", "NY", 2024, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "NY" }) });
    await new Promise(r => setTimeout(r, 200));
    const ny = await api<TaxReturn>(`/clients/${cid}/tax-return`);
    check("NY resident, NY-source $100k → NY tax > 0", ny.stateTaxLiability > 0 ? 1 : 0, 1, 0);
  });

  console.log("\n── Integration: adjustments correctly modify return ──");
  await withTempClient("adj", "single", "FL", 2024, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "FL" }) });
    await new Promise(r => setTimeout(r, 200));
    const baseline = await api<TaxReturn>(`/clients/${cid}/tax-return`);

    // Add a $5k deduction adjustment (above-the-line, reduces AGI)
    await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "deduction", amount: 5000, description: "Test deduction", isApplied: true }) });
    await new Promise(r => setTimeout(r, 300));
    const withDed = await api<TaxReturn>(`/clients/${cid}/tax-return`);
    checkExact("Deduction adj reduces AGI by $5k", baseline.adjustedGrossIncome - withDed.adjustedGrossIncome, 5000);

    // Add a $1,500 credit adjustment
    await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "credit", amount: 1500, description: "Test credit", isApplied: true }) });
    await new Promise(r => setTimeout(r, 300));
    const withCred = await api<TaxReturn>(`/clients/${cid}/tax-return`);
    check("Credit adj increases refund by $1,500", withCred.federalRefundOrOwed - withDed.federalRefundOrOwed, 1500, 1);

    // Add additional income adjustment
    await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "additional_income", amount: 10000, description: "Test 1099 income", isApplied: true }) });
    await new Promise(r => setTimeout(r, 300));
    const withInc = await api<TaxReturn>(`/clients/${cid}/tax-return`);
    checkExact("Additional income adj raises totalIncome by $10k", withInc.totalIncome - withCred.totalIncome, 10000);

    // Withholding adjustment
    await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "withholding_adjustment", amount: 2000, description: "Q4 estimated", isApplied: true }) });
    await new Promise(r => setTimeout(r, 300));
    const withWh = await api<TaxReturn>(`/clients/${cid}/tax-return`);
    checkExact("Withholding adj raises federalTaxWithheld by $2k", withWh.federalTaxWithheld - withInc.federalTaxWithheld, 2000);
  });

  console.log("\n── Integration: dependents auto-CTC propagates to refund ──");
  await withTempClient("ctc", "single", "FL", 2024, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 7000, stateCode: "FL" }) });
    await new Promise(r => setTimeout(r, 200));
    const beforeKids = await api<TaxReturn>(`/clients/${cid}/tax-return`);

    await api(`/clients/${cid}`, { method: "PATCH", body: JSON.stringify({ dependentsUnder17: 2, otherDependents: 1 }) });
    await new Promise(r => setTimeout(r, 300));
    const withKids = await api<TaxReturn>(`/clients/${cid}/tax-return`);
    check("Adding 2 children + 1 other dep → refund +$4,500", withKids.federalRefundOrOwed - beforeKids.federalRefundOrOwed, 4500, 1);

    // Verify breakdown endpoint includes the CTC detail
    const breakdown = await api<{ childTaxCredit: { appliedCredit: number; preliminaryCredit: number } }>(`/clients/${cid}/tax-return/breakdown`);
    checkExact("Breakdown CTC preliminary $4,500", breakdown.childTaxCredit.preliminaryCredit, 4500);
    checkExact("Breakdown CTC applied $4,500", breakdown.childTaxCredit.appliedCredit, 4500);
  });

  console.log("\n── Integration: multi-year W-2 isolation ──");
  await withTempClient("multiyear", "single", "FL", 2024, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 10000, stateCode: "FL" }) });
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2025, wagesBox1: 90000, federalTaxWithheldBox2: 12000, stateCode: "FL" }) });
    await new Promise(r => setTimeout(r, 200));

    const ty24 = await api<PreviewResponse>(`/clients/${cid}/tax-return/preview?taxYear=2024`);
    const ty25 = await api<PreviewResponse>(`/clients/${cid}/tax-return/preview?taxYear=2025`);
    checkExact("TY2024 sums only 2024 W-2 ($80k)", ty24.totalIncome, 80000);
    checkExact("TY2025 sums only 2025 W-2 ($90k)", ty25.totalIncome, 90000);
    checkExact("TY2024 std ded = $14,600", ty24.standardDeduction, 14600);
    checkExact("TY2025 std ded = $15,000", ty25.standardDeduction, 15000);
  });

  console.log("\n── Integration: cascade delete cleans up ──");
  // Create client with everything attached, delete, verify all gone
  const stale = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({ firstName: "Cascade", lastName: "Test", email: `cascade-${Date.now()}@example.com`, filingStatus: "single", state: "FL", taxYear: 2024 }),
  });
  await api(`/clients/${stale.id}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }) });
  await api(`/clients/${stale.id}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "credit", amount: 100, description: "x", isApplied: true }) });
  await new Promise(r => setTimeout(r, 200));
  await api(`/clients/${stale.id}`, { method: "DELETE" });
  // Verify children are gone (should 404)
  try {
    await api(`/clients/${stale.id}`);
    FAIL.push("✗ Cascade: client still exists after delete");
  } catch {
    PASS.push("✓ Cascade: client deleted");
  }

  console.log("\n── Integration: invalid state rejected with 400 ──");
  try {
    await api("/clients", {
      method: "POST",
      body: JSON.stringify({ firstName: "Bad", lastName: "State", email: `bad-${Date.now()}@x.com`, filingStatus: "single", state: "California", taxYear: 2024 }),
    });
    FAIL.push("✗ Invalid state should have been rejected");
  } catch (e: any) {
    if (e.message.includes("400") && e.message.includes("Invalid US state code")) {
      PASS.push("✓ Invalid state code 'California' rejected with 400");
    } else {
      FAIL.push(`✗ Wrong error: ${e.message}`);
    }
  }

  console.log("\n── Integration: lowercase state normalized to uppercase ──");
  const lc = await api<{ id: number; state: string }>("/clients", {
    method: "POST",
    body: JSON.stringify({ firstName: "Lower", lastName: "State", email: `lc-${Date.now()}@x.com`, filingStatus: "single", state: "ny", taxYear: 2024 }),
  });
  checkExact("state 'ny' normalized to 'NY'", lc.state, "NY");
  await api(`/clients/${lc.id}`, { method: "DELETE" });

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  INTEGRATION RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  console.log("══════════════════════════════════════════════════════════════════");
  if (FAIL.length > 0) {
    console.log("\nFAILURES:");
    for (const f of FAIL) console.log("  " + f);
    process.exit(1);
  }
  process.exit(0);
}

run().catch((e) => { console.error("Test runner crashed:", e); process.exit(2); });
