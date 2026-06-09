/**
 * Integration tests for the new features (multi-year, SE/AMT/NIIT/QBI/ACTC,
 * PDF export, W-2 flags, AI bounding boxes).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-new-features-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${e}, got ${a}`);
}
function checkNear(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkTruthy(label: string, value: unknown) {
  if (value) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: value was ${JSON.stringify(value)}`);
}

async function api<T = any>(path: string, opts: RequestInit = {}, expectBinary = false): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${txt}`);
  }
  if (res.status === 204) return undefined as T;
  if (expectBinary) return (await res.arrayBuffer()) as unknown as T;
  return res.json();
}

async function withTempClient<T>(extras: Record<string, unknown>, fn: (clientId: number) => Promise<T>): Promise<T> {
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Test",
      lastName: "Feature",
      email: `feat-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
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

async function run() {
  console.log("── Multi-year persistence ──");
  await withTempClient({}, async (cid) => {
    // Add W-2s for 2024 and 2025
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 12000, stateCode: "FL" }) });
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2025, wagesBox1: 85000, federalTaxWithheldBox2: 13000, stateCode: "FL" }) });
    await new Promise((r) => setTimeout(r, 300));

    // Calculate 2024
    await api(`/clients/${cid}/tax-return`, { method: "POST", body: JSON.stringify({ taxYear: 2024 }) });
    // Switch to 2025 and calculate
    await api(`/clients/${cid}`, { method: "PATCH", body: JSON.stringify({ taxYear: 2025 }) });
    await new Promise((r) => setTimeout(r, 400));

    const list = await api<any[]>(`/clients/${cid}/tax-returns`);
    check("Two persistent rows: 2024 + 2025", list.map((r) => r.taxYear).sort(), [2024, 2025]);

    const r24 = await api<any>(`/clients/${cid}/tax-return?taxYear=2024`);
    const r25 = await api<any>(`/clients/${cid}/tax-return?taxYear=2025`);
    check("TY2024 row reflects 2024 W-2 only ($80k)", Number(r24.totalIncome), 80000);
    check("TY2025 row reflects 2025 W-2 only ($85k)", Number(r25.totalIncome), 85000);
    check("TY2024 row has TY2024 std deduction ($14,600)", Number(r24.standardDeduction), 14600);
    check("TY2025 row has TY2025 std deduction ($15,750, OBBBA)", Number(r25.standardDeduction), 15750);
  });

  console.log("\n── Self-employment income via adjustment → SE tax ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 6000, stateCode: "FL" }) });
    await api(`/clients/${cid}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "self_employment_income", amount: 40000, description: "1099-NEC contractor work", isApplied: true }),
    });
    await new Promise((r) => setTimeout(r, 300));
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // 40000 × 0.9235 × 0.153 ≈ 5651
    checkNear("SE tax for $40k SE income ≈ $5,651", Number(ret.selfEmploymentTax || 0), 5651, 5);
    // Total income = wages 50k + SE 40k
    check("Total income includes SE income", Number(ret.totalIncome), 90000);
    // AGI reduced by 1/2 SE tax (~$2,826)
    checkNear("AGI = $90k - 1/2 SE tax", Number(ret.adjustedGrossIncome), 90000 - 2825.4, 2);
  });

  console.log("\n── Investment income → NIIT (above threshold) ──");
  await withTempClient({}, async (cid) => {
    // High-wage W-2 + investment income to push AGI above $200k
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 250000, federalTaxWithheldBox2: 50000, stateCode: "FL" }) });
    await api(`/clients/${cid}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "investment_income", amount: 30000, description: "1099-DIV", isApplied: true }),
    });
    await new Promise((r) => setTimeout(r, 300));
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // AGI = 280k. excess over $200k = $80k. NIIT = min($30k, $80k) × 3.8% = $1,140
    checkNear("NIIT on $30k inv at AGI $280k ≈ $1,140", Number(ret.niitTax || 0), 1140, 1);
  });

  console.log("\n── QBI deduction ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "FL" }) });
    await api(`/clients/${cid}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "qbi_income", amount: 50000, description: "S-corp pass-through", isApplied: true }),
    });
    await new Promise((r) => setTimeout(r, 300));
    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // 20% of $50k = $10,000 (cap is 20% × taxable income, well above)
    check("QBI deduction = 20% × $50k = $10,000", Number(ret.qbiDeduction), 10000);
  });

  console.log("\n── PDF export ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 12000, stateCode: "FL" }) });
    await new Promise((r) => setTimeout(r, 300));
    const buf = await api<ArrayBuffer>(`/clients/${cid}/tax-return/pdf`, {}, true);
    const bytes = new Uint8Array(buf);
    // PDFs start with "%PDF-"
    const startsWithPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    checkTruthy(`PDF response starts with %PDF- magic bytes (${bytes.length} bytes)`, startsWithPdf);
    checkTruthy("PDF is non-trivial size (> 1 KB)", bytes.length > 1024);
  });

  console.log("\n── W-2 validation flags ──");
  // Mismatch year + suspicious withholding
  await withTempClient({ taxYear: 2024 }, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2023, wagesBox1: 100000, federalTaxWithheldBox2: 95000, stateCode: "FL" }),
    });
    await new Promise((r) => setTimeout(r, 300));
    const flags = await api<any[]>(`/clients/${cid}/w2data/flags`);
    const allFlags = flags.flatMap((f) => f.flags);
    const hasYearMismatch = allFlags.some((f) => f.field === "taxYear");
    const hasFedWHFlag = allFlags.some((f) => f.field === "federalTaxWithheldBox2");
    checkTruthy("Flagged: year mismatch (W-2 2023 vs client 2024)", hasYearMismatch);
    checkTruthy("Flagged: implausibly high federal withholding", hasFedWHFlag);
  });

  // SS wage base exceeded
  await withTempClient({ taxYear: 2024 }, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({
        taxYear: 2024,
        wagesBox1: 200000,
        federalTaxWithheldBox2: 40000,
        socialSecurityWagesBox3: 200000, // > 2024 cap of $168,600
        socialSecurityTaxBox4: 12400,
        medicareWagesBox5: 200000,
        medicareTaxBox6: 2900,
        stateCode: "FL",
      }),
    });
    await new Promise((r) => setTimeout(r, 300));
    const flags = await api<any[]>(`/clients/${cid}/w2data/flags`);
    const allFlags = flags.flatMap((f) => f.flags);
    const ssError = allFlags.some((f) => f.field === "socialSecurityWagesBox3" && f.severity === "error");
    checkTruthy("Flagged: Box 3 SS wages exceeds $168,600 cap as ERROR", ssError);
  });

  console.log("\n── 1099 forms — integration ──");
  await withTempClient({}, async (cid) => {
    // Add 1099-NEC ($30k SE) and 1099-INT ($5k interest)
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "nec", payerName: "Acme Contracting", nonemployeeCompensation: 30000, federalTaxWithheld: 0 }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "int", payerName: "Big Bank", interestIncome: 5000, federalTaxWithheld: 500 }),
    });
    await new Promise((r) => setTimeout(r, 300));

    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // Total income: $30k SE + $5k interest = $35k (no W-2)
    check("1099 total income = $35k", Number(ret.totalIncome), 35000);
    // SE tax: $30k × 0.9235 × 15.3% = ~$4,239
    checkNear("SE tax from 1099-NEC", Number(ret.selfEmploymentTax || 0), 4238.83, 1);
    // Federal withholding: $500 from 1099-INT
    check("Federal withholding from 1099-INT", Number(ret.federalTaxWithheld), 500);
  });

  console.log("\n── 1099-B capital gains ──");
  await withTempClient({}, async (cid) => {
    // Wages of $60k + $20k LTCG via 1099-B
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 8000, stateCode: "FL" }),
    });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "b", payerName: "Brokerage X", longTermGainLoss: 20000 }),
    });
    await new Promise((r) => setTimeout(r, 300));

    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // Wages 60k + LTCG 20k → totalIncome 80k (per Form 1040 Line 9, LTCG is in AGI)
    check("1099-B: total income includes LTCG (in AGI)", Number(ret.totalIncome), 80000);
    // After std deduction $14,600, taxable on ordinary = $45,400
    // Ordinary tax on $45,400: 1160 + (45400-11600)*0.12 = 1160 + 4056 = 5216
    // LTCG fills $45,400 → $65,400; 0% cap is $47,025 single 2024
    //   Slice 0%: 45,400-47,025 = $1,625 × 0% = $0
    //   Slice 15%: 47,025-65,400 = $18,375 × 15% = $2,756.25
    // Total fed = 5216 + 2756.25 = 7,972.25
    checkNear("Federal tax with LTCG preferential", Number(ret.federalTaxLiability), 7972.25, 5);
    checkNear("Capital gains tax line", Number((ret as any).capitalGainsTax || 0), 2756.25, 1);
  });

  console.log("\n── 1099-DIV qualified dividends ──");
  await withTempClient({}, async (cid) => {
    await api(`/clients/${cid}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 12000, stateCode: "FL" }),
    });
    // $5k dividends, $4k qualified, $1k ordinary
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: 2024, formType: "div", payerName: "Vanguard", ordinaryDividends: 5000, qualifiedDividends: 4000 }),
    });
    await new Promise((r) => setTimeout(r, 300));

    const ret = await api<any>(`/clients/${cid}/tax-return`);
    // Per Form 1040: total income = wages + full ordinary dividends (Line 3b includes qualified)
    // Total income = $80k wages + $5k full ordinary dividends = $85k
    check("Total income = wages + full ordinary dividends (Line 3b)", Number(ret.totalIncome), 85000);
    // Cap gains tax: 15% × $4k qualified portion (since AGI > 0% threshold)
    checkNear("Cap gains tax = 15% × $4k qualified div", Number((ret as any).capitalGainsTax || 0), 600, 1);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Auto-load capital-loss carryforward from prior year's tax_returns row.
  //
  // Hand-calc TY2024 (single, FL, age 35, W-2 $60k, 1099-B $5k ST loss):
  //   netSTCG = -5000, netLTCG = 0, netCapTotal = -5000
  //   capitalLossDeducted = min(5000, 3000) = 3000 (Sched D L21 cap)
  //   stcgCarryforwardShort to next year = 5000 - 3000 = 2000
  //
  // Switching client.taxYear to 2025 should auto-load that $2000 STCG carry:
  //   netSTCG = 0 - 2000 = -2000  →  capitalLossDeducted = 2000  →  carryforward 0
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n── Auto-load STCG carryforward TY2024 → TY2025 ──");
  await withTempClient({ taxYear: 2024 }, async (cid) => {
    // TY2024 setup
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 60000, stateCode: "FL" }) });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ formType: "b", taxYear: 2024, shortTermGainLoss: -5000, payerName: "Broker" }),
    });
    await new Promise((r) => setTimeout(r, 100));
    const r2024 = await api<any>(`/clients/${cid}/tax-return`);
    checkNear("TY2024: cap loss against ordinary = $3k", Number(r2024.capitalLossDeducted), 3000, 1);
    checkNear("TY2024: STCG carryforward to 2025 = $2k", Number(r2024.capitalLossCarryforwardShort), 2000, 1);

    // Flip client to TY2025 + add TY2025 W-2 + no new cap activity
    await api(`/clients/${cid}`, { method: "PATCH", body: JSON.stringify({ taxYear: 2025 }) });
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2025, wagesBox1: 60000, stateCode: "FL" }) });
    await new Promise((r) => setTimeout(r, 100));
    const r2025 = await api<any>(`/clients/${cid}/tax-return`);
    checkNear("TY2025: auto-loaded $2k STCG carryforward fully consumed against ordinary", Number(r2025.capitalLossDeducted), 2000, 1);
    checkNear("TY2025: no further STCG carryforward", Number(r2025.capitalLossCarryforwardShort), 0, 1);
  });

  // Manual override: explicit adjustment beats auto-load.
  console.log("\n── Manual carryforward adjustment overrides auto-load ──");
  await withTempClient({ taxYear: 2024 }, async (cid) => {
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 60000, stateCode: "FL" }) });
    await api(`/clients/${cid}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ formType: "b", taxYear: 2024, shortTermGainLoss: -5000, payerName: "Broker" }),
    });
    await new Promise((r) => setTimeout(r, 100));
    await api(`/clients/${cid}/tax-return`); // ensure TY2024 row is computed + persisted

    // Flip to TY2025 + manually entered carryforward of $500 (NOT the auto-load $2k)
    await api(`/clients/${cid}`, { method: "PATCH", body: JSON.stringify({ taxYear: 2025 }) });
    await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2025, wagesBox1: 60000, stateCode: "FL" }) });
    await api(`/clients/${cid}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ adjustmentType: "capital_loss_carryforward_short", amount: 500, description: "Manual override", isApplied: true }),
    });
    await new Promise((r) => setTimeout(r, 100));
    const r = await api<any>(`/clients/${cid}/tax-return`);
    checkNear("TY2025: manual $500 overrides auto-load $2k", Number(r.capitalLossDeducted), 500, 1);
  });

  console.log("\n── Currency input + bounding boxes are frontend-only — verified separately ──");

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  console.log("══════════════════════════════════════════════════════════════════");
  if (FAIL.length > 0) {
    console.log("\nFAILURES:");
    for (const f of FAIL) console.log("  " + f);
    process.exit(1);
  }
  process.exit(0);
}

run().catch((e) => {
  console.error("Test runner crashed:", e);
  process.exit(2);
});
