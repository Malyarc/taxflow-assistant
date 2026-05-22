/**
 * B6 — Per-property rental real estate integration tests.
 *
 * Validates that when rental_properties rows exist, the engine uses them
 * (per-property income, expenses, computed MACRS depreciation) and the
 * Schedule E aggregate flows to AGI through the §469 PAL allowance.
 *
 * Hand-calc references:
 *   Residential 27.5-year SL, mid-month convention (IRS Pub 946 Table A-6)
 *     Annual rate = 1/27.5 = 3.6364%
 *     Year-1 = 12.5 − month_placed) / 12 × annual_dep
 *     Years 2-27 = full annual_dep
 *   Commercial 39-year SL, mid-month convention (Pub 946 Table A-7a)
 *     Annual rate = 1/39 = 2.5641%
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-rental-properties-tests.ts
 *
 * Requires the api-server on http://localhost:8080.
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
      firstName: "Rental",
      lastName: "Test",
      email: `rental-${Date.now()}-${Math.random().toString(36).slice(2)}@e.co`,
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
  console.log("── 1. Single residential rental, placed pre-2024, year-5 MACRS = full annual ──");
  // $275,000 basis, residential, placed 2020-01, taxYear 2024 (5th year)
  // Year 1 (2020): 11.5/12 × $10,000 = $9,583.33
  // Years 2-5: full $10,000 each. Year 5 (2024) MACRS = $10,000
  // Income $24k − Expenses $8k − MACRS $10k = $6k net → flows to AGI
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 70000, federalTaxWithheldBox2: 8000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/rental-properties`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, address: "123 Main St", propertyType: "residential",
        basis: 275000, placedInServiceYear: 2020, placedInServiceMonth: 1,
        rentalIncome: 24000, totalExpenses: 8000, isActiveParticipant: true,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    // AGI = wages 70k + net rental 6k = 76k
    check("AGI = $76,000 (wages + net rental income)", Number(r.adjustedGrossIncome), 76000, 2);
    check("Schedule E rental gross net = $6,000", Number(r.scheduleERentalGrossNet), 6000, 2);
    check("Schedule E rental applied to AGI = $6,000", Number(r.scheduleERentalAppliedToAgi), 6000, 2);
  });

  console.log("\n── 2. Single property placed in July 2024 (first-year mid-month convention) ──");
  // $275k basis, residential, placed 2024-07, taxYear 2024
  // Year 1 MACRS: (12.5 − 7) / 12 × ($275k / 27.5) = 5.5/12 × $10,000 = $4,583.33
  // Income $12k − Expenses $4k − MACRS $4,583.33 = $3,416.67 net
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 70000, federalTaxWithheldBox2: 8000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/rental-properties`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, address: "456 Oak Ave", propertyType: "residential",
        basis: 275000, placedInServiceYear: 2024, placedInServiceMonth: 7,
        rentalIncome: 12000, totalExpenses: 4000, isActiveParticipant: true,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    // Net = $12k - $4k - $4,583.33 = $3,416.67
    check("Schedule E net = $3,416.67 (first-year July mid-month MACRS)", Number(r.scheduleERentalGrossNet), 3416.67, 2);
  });

  console.log("\n── 3. Rental loss → §469 PAL allowance fully applied (AGI under phaseout) ──");
  // $275k basis, residential, placed 2020-01, taxYear 2024 (MACRS = $10k)
  // Income $5k − Expenses $10k − MACRS $10k = -$15k loss
  // Wages $60k → MAGI well under $100k → full $25k allowance
  // Allowed loss = $15k applied negatively to AGI
  // AGI = $60k - $15k = $45k
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 6000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/rental-properties`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, address: "789 Pine Rd", propertyType: "residential",
        basis: 275000, placedInServiceYear: 2020, placedInServiceMonth: 1,
        rentalIncome: 5000, totalExpenses: 10000, isActiveParticipant: true,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("Schedule E gross net = -$15,000 (loss before PAL)", Number(r.scheduleERentalGrossNet), -15000, 2);
    check("Schedule E applied to AGI = -$15,000 (full allowance)", Number(r.scheduleERentalAppliedToAgi), -15000, 2);
    check("AGI = $45,000 (wages - allowed loss)", Number(r.adjustedGrossIncome), 45000, 2);
  });

  console.log("\n── 4. Two properties — aggregated ──");
  // Property A: residential, $275k basis, placed 2020-01, year-5 MACRS = $10k. $20k rent − $5k exp = net $5k
  // Property B: residential, $200k basis, placed 2018-01, year-7 MACRS = $200k / 27.5 = $7,272.73. $15k rent − $3k exp = net $4,727.27
  // Combined: $35k rent, $8k expenses, $17,272.73 MACRS → net $9,727.27
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 10000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/rental-properties`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, address: "Property A", propertyType: "residential",
        basis: 275000, placedInServiceYear: 2020, placedInServiceMonth: 1,
        rentalIncome: 20000, totalExpenses: 5000, isActiveParticipant: true,
      }),
    });
    await api(`/clients/${cid}/rental-properties`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, address: "Property B", propertyType: "residential",
        basis: 200000, placedInServiceYear: 2018, placedInServiceMonth: 1,
        rentalIncome: 15000, totalExpenses: 3000, isActiveParticipant: true,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    // Expected combined: $5k + ($15k - $3k - $7,272.73) = $5k + $4,727.27 = $9,727.27
    check("Aggregate Schedule E net = $9,727.27 (two residential rentals)", Number(r.scheduleERentalGrossNet), 9727.27, 2);
  });

  console.log("\n── 5. Commercial property — 39-year MACRS ──");
  // $400k basis, commercial, placed 2022-01, taxYear 2024 (year 3)
  // Annual: $400k / 39 = $10,256.41
  // Year 1 (2022): 11.5/12 × $10,256.41 = $9,829.40
  // Year 2 (2023): full $10,256.41
  // Year 3 (2024): full $10,256.41 ← current year
  // Income $50k − Expenses $20k − MACRS $10,256.41 = $19,743.59 net
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 6000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/rental-properties`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, address: "999 Commercial Blvd", propertyType: "commercial",
        basis: 400000, placedInServiceYear: 2022, placedInServiceMonth: 1,
        rentalIncome: 50000, totalExpenses: 20000, isActiveParticipant: true,
      }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    check("Commercial Schedule E net = $19,743.59 (39-yr MACRS year-3)", Number(r.scheduleERentalGrossNet), 19743.59, 2);
  });

  console.log("\n── 6. Per-property rental supersedes legacy aggregate adjustments ──");
  // Add both a rental_property row AND a schedule_e_rental_income adjustment.
  // Engine should use the property (not double-count).
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 6000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/rental-properties`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, address: "Per-property wins", propertyType: "residential",
        basis: 275000, placedInServiceYear: 2020, placedInServiceMonth: 1,
        rentalIncome: 24000, totalExpenses: 8000, isActiveParticipant: true,
      }),
    });
    // This adjustment should be IGNORED because a per-property row exists.
    await api(`/clients/${cid}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "schedule_e_rental_income", amount: 999999, description: "legacy aggregate", isApplied: true }),
    });
    await settle();
    const r = await api<any>(`/clients/${cid}/tax-return`);
    // Net should reflect per-property only: $6k, NOT $999,999 + $6k
    check("Per-property wins over legacy adjustment", Number(r.scheduleERentalGrossNet), 6000, 2);
  });

  console.log("\n── 7. CRUD: list / update / delete rental properties ──");
  await withTempClient({}, async (cid) => {
    const created = await api<any>(`/clients/${cid}/rental-properties`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024, address: "Original", propertyType: "residential",
        basis: 100000, placedInServiceYear: 2024, placedInServiceMonth: 1,
        rentalIncome: 5000, totalExpenses: 1000, isActiveParticipant: true,
      }),
    });
    const listed = await api<any[]>(`/clients/${cid}/rental-properties`);
    checkExact("List shows 1 row", listed.length, 1);
    checkExact("Row address matches", listed[0].address, "Original");

    await api(`/clients/${cid}/rental-properties/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ address: "Updated", rentalIncome: 8000 }),
    });
    const listed2 = await api<any[]>(`/clients/${cid}/rental-properties`);
    checkExact("After PATCH address = Updated", listed2[0].address, "Updated");
    check("After PATCH rentalIncome = $8,000", Number(listed2[0].rentalIncome), 8000, 0.01);

    await api(`/clients/${cid}/rental-properties/${created.id}`, { method: "DELETE" });
    const listed3 = await api<any[]>(`/clients/${cid}/rental-properties`);
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
