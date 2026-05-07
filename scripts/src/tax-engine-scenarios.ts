/**
 * Realistic CPA scenario tests. Each scenario simulates a real-world client
 * with a specific tax situation, and asserts the calculator produces the
 * correct tax return values. Expected values are hand-calculated using the
 * 2024/2025 IRS brackets, std deductions, and IRC rules we've implemented.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-scenarios.ts
 */

const BASE = "http://localhost:8080/api";
const SCENARIO_RESULTS: Array<{ name: string; passes: number; fails: number; failures: string[] }> = [];

async function api<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function settle(ms = 350) { await new Promise(r => setTimeout(r, ms)); }

function near(a: number, b: number, tol = 1) { return Math.abs(a - b) <= tol; }

interface AssertContext {
  scenarioName: string;
  passes: number;
  fails: number;
  failures: string[];
}

function assert(ctx: AssertContext, label: string, actual: number, expected: number, tol = 1) {
  if (near(actual, expected, tol)) {
    ctx.passes++;
  } else {
    ctx.fails++;
    ctx.failures.push(`  ✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (diff ${(actual - expected).toFixed(2)})`);
  }
}
function assertExact<T>(ctx: AssertContext, label: string, actual: T, expected: T) {
  if (actual === expected) ctx.passes++;
  else { ctx.fails++; ctx.failures.push(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

interface Client { firstName: string; lastName: string; email: string; filingStatus: string; state: string; taxYear: number; dependentsUnder17?: number; otherDependents?: number; }

async function runScenario(name: string, fn: (ctx: AssertContext) => Promise<void>) {
  console.log(`\n── ${name} ──`);
  const ctx: AssertContext = { scenarioName: name, passes: 0, fails: 0, failures: [] };
  try {
    await fn(ctx);
  } catch (e: any) {
    ctx.fails++;
    ctx.failures.push(`  ✗ Scenario crashed: ${e.message}`);
  }
  console.log(`   ${ctx.passes} passed, ${ctx.fails} failed`);
  if (ctx.fails > 0) ctx.failures.forEach(f => console.log(f));
  SCENARIO_RESULTS.push({ name, passes: ctx.passes, fails: ctx.fails, failures: ctx.failures });
}

let counter = 0;
async function makeClient(c: Partial<Client>): Promise<number> {
  const data = {
    firstName: c.firstName ?? "Test", lastName: c.lastName ?? `S${++counter}`,
    email: `s${Date.now()}-${counter}@test.com`,
    filingStatus: c.filingStatus ?? "single",
    state: c.state ?? "FL",
    taxYear: c.taxYear ?? 2024,
    dependentsUnder17: c.dependentsUnder17 ?? 0,
    otherDependents: c.otherDependents ?? 0,
  };
  const res = await api<{ id: number }>("/clients", { method: "POST", body: JSON.stringify(data) });
  return res.id;
}

async function delClient(id: number) { await api(`/clients/${id}`, { method: "DELETE" }).catch(() => {}); }

async function getReturn(id: number): Promise<any> {
  return api<any>(`/clients/${id}/tax-return`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  COMPREHENSIVE CPA SCENARIO TESTS");
  console.log("═══════════════════════════════════════════════════════════════════");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: Simple W-2 filer (baseline)
  // Single, $50,000 wages, FL (no state tax), $5,000 federal withheld
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("1. Simple W-2 filer (Single, FL, $50k wages)", async (ctx) => {
    const cid = await makeClient({ firstName: "Alex", lastName: "Simple", filingStatus: "single", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({
        taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL",
        socialSecurityWagesBox3: 50000, socialSecurityTaxBox4: 3100,
        medicareWagesBox5: 50000, medicareTaxBox6: 725,
      }) });
      await settle();
      const r = await getReturn(cid);
      // Expected: wages $50k, std ded $14,600, taxable $35,400
      // Federal: 1160 + (35400-11600)×.12 = 1160 + 2856 = $4,016
      assert(ctx, "Total income $50k", Number(r.totalIncome), 50000);
      assert(ctx, "Std deduction $14,600", Number(r.standardDeduction), 14600);
      assert(ctx, "Taxable income $35,400", Number(r.taxableIncome), 35400);
      assert(ctx, "Federal tax $4,016", Number(r.federalTaxLiability), 4016);
      assertExact(ctx, "FL state tax = $0", Number(r.stateTaxLiability), 0);
      assert(ctx, "Federal refund $984 ($5k withheld - $4,016)", Number(r.federalRefundOrOwed), 984);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: Married couple, two W-2s, CA, mortgage interest deduction
  // MFJ, $90k W-2 + $70k W-2 = $160k wages, CA, $30k itemized (mortgage+SALT)
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("2. MFJ with two W-2s + itemized deductions (CA)", async (ctx) => {
    const cid = await makeClient({ firstName: "Mark+Jane", lastName: "MFJ", filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 90000, federalTaxWithheldBox2: 14000, stateCode: "CA", stateTaxWithheldBox17: 6500, stateWagesBox16: 90000 }) });
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 70000, federalTaxWithheldBox2: 11000, stateCode: "CA", stateTaxWithheldBox17: 5000, stateWagesBox16: 70000 }) });
      await settle();
      // Trigger calculation with itemized
      await api(`/clients/${cid}/tax-return`, { method: "POST", body: JSON.stringify({ taxYear: 2024, useItemizedDeductions: true, additionalDeductions: 30000 }) });
      await settle();
      const r = await getReturn(cid);
      // AGI = $160k. Itemized $30k > std $29,200 → use itemized. Taxable = $130k.
      // Federal MFJ: 2320 + (94300-23200)×.12 + (130000-94300)×.22 = 2320 + 8532 + 7854 = $18,706
      assert(ctx, "Total income $160k", Number(r.totalIncome), 160000);
      assert(ctx, "Itemized $30k > std → uses $30k", Number(r.standardDeduction), 30000);
      assert(ctx, "Taxable $130k", Number(r.taxableIncome), 130000);
      assert(ctx, "Federal tax $18,706", Number(r.federalTaxLiability), 18706);
      // CA MFJ at AGI $160k: std $11,080, taxable $148,920
      // 1% × 21512 + 2% × 29486 + 4% × 29492 + 6% × 31242 + 8% × 29480 + 9.3% × 7708
      // = 215.12 + 589.72 + 1179.68 + 1874.52 + 2358.40 + 716.84 = 6934.28
      assert(ctx, "CA state tax ~$6,934", Number(r.stateTaxLiability), 6934.28, 1);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: High earner with capital gains + qualified dividends
  // Single, $300k wages, $100k LTCG, $20k qualified dividends
  // Triggers NIIT, capital gains preferential rates
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("3. High earner — $300k wages + $100k LTCG + $20k QDIV (NIIT triggers)", async (ctx) => {
    const cid = await makeClient({ firstName: "Sarah", lastName: "HighEarner", filingStatus: "single", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 70000, stateCode: "FL", socialSecurityWagesBox3: 168600, socialSecurityTaxBox4: 10453.20, medicareWagesBox5: 300000, medicareTaxBox6: 5250 }) });
      // 1099-B with $100k LTCG
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "b", payerName: "Brokerage X", longTermGainLoss: 100000 }) });
      // 1099-DIV with $20k qualified dividends
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "div", payerName: "Vanguard", ordinaryDividends: 20000, qualifiedDividends: 20000 }) });
      await settle();
      const r = await getReturn(cid);
      // Total income = $300k wages + $100k LTCG + $20k full div = $420k
      // Std deduction $14,600. Taxable income before QBI = $405,400
      // Ordinary portion = $405,400 - $100k LTCG - $20k QDIV = $285,400
      // Federal ordinary tax single 2024 on $285,400:
      //   1160 + 4266 + 11742.50 + 21942 + (285400-243725)×.32
      //   = 1160 + 4266 + (100525-47150)×.22 + (191950-100525)×.24 + (243725-191950)×.32 + (285400-243725)×.35
      //   1160 + (47150-11600)×.12 + (100525-47150)×.22 + (191950-100525)×.24 + (243725-191950)×.32 + (285400-243725)×.35
      //   = 1160 + 4266 + 11742.5 + 21942 + 16568 + 14586.25 = 70264.75
      // LTCG + QDIV preferential calc: ordinary $285,400, LTCG+QDIV $120k stacks above
      //   $285,400 already > $518,900? No, $285k < $518,900. So stack into 15% bracket.
      //   $120k × 15% = $18,000
      // Total fed tax = $70,264.75 + $18,000 = $88,264.75
      assert(ctx, "Total income $420k", Number(r.totalIncome), 420000);
      // federalTaxLiability includes ordinary + cap gains + NIIT + SE + AMT
      // = $70,264.75 (ordinary) + $18,000 (cap gains) + $4,560 (NIIT) = $92,824.75
      assert(ctx, "Total federal liability (ord + cap gains + NIIT)", Number(r.federalTaxLiability), 92824.75, 5);
      assert(ctx, "Capital gains tax = 15% × $120k", Number(r.capitalGainsTax), 18000, 1);
      // NIIT: AGI $420k, excess over $200k = $220k. Investment income = $100k LTCG + $20k full divs = $120k
      // NIIT = min($120k, $220k) × 3.8% = $4,560
      assert(ctx, "NIIT = 3.8% × $120k investment income", Number(r.niitTax), 4560, 1);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: Self-employed contractor (1099-NEC heavy)
  // Single, $80,000 1099-NEC (no W-2), QBI 20% deduction
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("4. Self-employed contractor — $80k 1099-NEC + QBI", async (ctx) => {
    const cid = await makeClient({ firstName: "Frank", lastName: "Freelance", filingStatus: "single", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "nec", payerName: "Client Co", nonemployeeCompensation: 80000 }) });
      // Mark $80k as QBI income (typical for self-employed)
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "qbi_income", amount: 80000, description: "Schedule C QBI", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      // SE earnings = $80k × 0.9235 = $73,880
      // SE tax = $73,880 × 15.3% = $11,303.64
      // 1/2 SE deduction = $5,651.82
      // AGI = $80k - $5,651.82 = $74,348.18
      // Std deduction $14,600. Taxable before QBI = $59,748.18
      // QBI: 20% × $80k = $16,000. Cap = 20% × $59,748.18 = $11,949.64
      // QBI deduction = min($16,000, $11,949.64) = $11,949.64
      // Taxable after QBI = $59,748.18 - $11,949.64 = $47,798.54
      // Federal ordinary tax: 1160 + (47150-11600)×.12 + (47798.54-47150)×.22 = 1160 + 4266 + 142.68 = 5568.68
      assert(ctx, "Total income $80k (1099-NEC)", Number(r.totalIncome), 80000);
      assert(ctx, "SE tax ~$11,304", Number(r.selfEmploymentTax), 11303.64, 2);
      assert(ctx, "QBI deduction limited by 20% of taxable", Number(r.qbiDeduction), 11949.64, 2);
      assert(ctx, "Federal ordinary tax", Number(r.federalTaxLiability) - Number(r.selfEmploymentTax), 5568.68, 5);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 5: W-2 + side hustle (mixed wage + 1099-NEC)
  // Single, $60k W-2 + $25k 1099-NEC, NY
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("5. Day job + side hustle ($60k W-2 + $25k 1099-NEC, NY)", async (ctx) => {
    const cid = await makeClient({ firstName: "Riley", lastName: "Hybrid", filingStatus: "single", state: "NY", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 7500, stateCode: "NY", stateTaxWithheldBox17: 3500, stateWagesBox16: 60000 }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "nec", payerName: "Side Gig", nonemployeeCompensation: 25000 }) });
      await settle();
      const r = await getReturn(cid);
      // Total income = $60k + $25k = $85k
      // SE: $25k × 0.9235 = $23,087.50; SE tax = $23,087.50 × 15.3% = $3,532.39
      // 1/2 SE deduction = $1,766.20
      // AGI = $85k - $1,766.20 = $83,233.80
      // Std deduction $14,600. Taxable = $68,633.80
      // Federal ordinary: 1160 + 4266 + (68633.80-47150)×.22 = 1160 + 4266 + 4726.44 = $10,152.44
      // Plus SE tax: $3,532.39
      // Total fed liability = $13,684.83
      assert(ctx, "Total income $85k", Number(r.totalIncome), 85000);
      assert(ctx, "SE tax ~$3,532", Number(r.selfEmploymentTax), 3532.39, 2);
      assert(ctx, "AGI = $85k - 1/2 SE", Number(r.adjustedGrossIncome), 83233.80, 2);
      assert(ctx, "Total federal liability", Number(r.federalTaxLiability), 13684.83, 5);
      // NY state: AGI $83,234, std $8000, taxable $75,234
      // 4%×8500 + 4.5%×3200 + 5.25%×2200 + 5.5%×(75234-13900) = 340+144+115.5+3373.37 = 3972.87
      assert(ctx, "NY state tax", Number(r.stateTaxLiability), 3972.87, 5);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 6: Retiree with multiple 1099s (no W-2)
  // MFJ retired couple: $40k 1099-R + $8k 1099-INT + $5k 1099-DIV qualified
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("6. Retiree couple — IRA + interest + dividends ($40k+$8k+$5k)", async (ctx) => {
    const cid = await makeClient({ firstName: "Bob+Sue", lastName: "Retiree", filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "r", payerName: "401k", grossDistribution: 40000, taxableAmount: 40000, federalTaxWithheld: 4000 }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 8000 }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "div", payerName: "Vanguard", ordinaryDividends: 5000, qualifiedDividends: 5000 }) });
      await settle();
      const r = await getReturn(cid);
      // Total income = $40k + $8k + $5k = $53k
      // AGI = $53k. Std MFJ $29,200. Taxable = $23,800.
      // Ordinary portion = $23,800 - $5k qualified = $18,800
      // Federal MFJ ordinary: 2320 + (18800-23200)×.12 = wait, $18,800 < $23,200 so all in 10%
      //   actually $18,800 × 10% = $1,880
      // QDIV $5k stacks: ordinary $18,800 < MFJ 0% cap $94,050, so QDIV fits in 0% bracket
      //   tax on QDIV = $0
      // Total fed = $1,880
      assert(ctx, "Total income $53k", Number(r.totalIncome), 53000);
      assert(ctx, "Federal tax $1,880", Number(r.federalTaxLiability), 1880, 1);
      assertExact(ctx, "Cap gains tax $0 (low ordinary, QDIV in 0%)", Number(r.capitalGainsTax), 0);
      // Federal withheld = $4,000 (only from 1099-R)
      assert(ctx, "Federal withheld $4,000", Number(r.federalTaxWithheld), 4000);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 7: Day trader with capital gains and losses (1099-B)
  // Single, $80k W-2 + $30k LTCG + $15k STCG - $20k LTCG losses
  // Note: our model doesn't net losses against gains; it clamps to 0
  // We'll send NET gains directly.
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("7. Day trader — $80k W-2 + $10k net LTCG + $15k STCG", async (ctx) => {
    const cid = await makeClient({ firstName: "Trader", lastName: "Joe", filingStatus: "single", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 12000, stateCode: "FL" }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "b", payerName: "Robinhood", longTermGainLoss: 10000, shortTermGainLoss: 15000 }) });
      await settle();
      const r = await getReturn(cid);
      // Total income = $80k + $10k LTCG + $15k STCG = $105k
      // AGI $105k, std $14,600, taxable $90,400
      // Ordinary portion = $90,400 - $10k LTCG = $80,400 (STCG stays in ordinary)
      // Federal ordinary on $80,400: 1160 + 4266 + (80400-47150)×.22 = 1160 + 4266 + 7315 = $12,741
      // LTCG: ordinary $80,400 > 0% cap $47,025, so all $10k LTCG at 15% = $1,500
      // Total fed = $14,241
      assert(ctx, "Total income $105k", Number(r.totalIncome), 105000);
      assert(ctx, "Federal tax (incl cap gains)", Number(r.federalTaxLiability), 14241, 5);
      assert(ctx, "Capital gains tax = 15% × $10k LTCG", Number(r.capitalGainsTax), 1500, 1);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 8: Family with kids + low income → ACTC fires
  // MFJ, $30k W-2, 2 children — refundable Child Tax Credit kicks in
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("8. Lower-income MFJ with 2 children — refundable ACTC fires", async (ctx) => {
    const cid = await makeClient({ firstName: "Mike+Linda", lastName: "Family", filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024, dependentsUnder17: 2 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 30000, federalTaxWithheldBox2: 1500, stateCode: "FL" }) });
      await settle();
      const r = await getReturn(cid);
      // Total income $30k. AGI $30k. Std MFJ $29,200. Taxable = $800.
      // Federal: $800 × 10% = $80
      // CTC: 2 children × $2,000 = $4,000 preliminary. AGI $30k < $400k MFJ threshold, no phase-out.
      // Non-refundable: min($4,000, $80) = $80
      // ACTC: unused = $4,000 - $80 = $3,920. Cap = 2 × $1,700 = $3,400. Earned income test: 15% × ($30k - $2,500) = $4,125
      //   Refundable = min($3,920, $3,400, $4,125) = $3,400
      // Total CTC applied = $80 + $3,400 = $3,480
      // Federal refund/owed = withheld $1,500 - tax $80 + CTC $3,480 = $4,900
      assert(ctx, "Federal tax $80 (only 10% bracket)", Number(r.federalTaxLiability), 80, 1);
      assert(ctx, "ACTC refundable $3,400 (capped at $1,700/child)", Number(r.additionalChildTaxCredit), 3400, 1);
      assert(ctx, "Federal refund $4,900", Number(r.federalRefundOrOwed), 4900, 5);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 9: Big landlord (1099-MISC heavy)
  // Single, $40k W-2 + $50k rental income + $5k royalties
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("9. Landlord — $40k W-2 + $50k rents + $5k royalties (1099-MISC)", async (ctx) => {
    const cid = await makeClient({ firstName: "Pat", lastName: "Landlord", filingStatus: "single", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 5000, stateCode: "FL" }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "misc", payerName: "Tenant Co", rents: 50000 }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "misc", payerName: "Songs LLC", royalties: 5000 }) });
      await settle();
      const r = await getReturn(cid);
      // Total income = $40k + $50k + $5k = $95k
      // Std $14,600. Taxable = $80,400
      // Federal: 1160 + 4266 + (80400-47150)×.22 = $12,741
      assert(ctx, "Total income $95k", Number(r.totalIncome), 95000);
      assert(ctx, "Federal tax $12,741", Number(r.federalTaxLiability), 12741, 1);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 10: Phase-out CTC scenario
  // Single, $250k W-2, 2 children, partial phase-out
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("10. CTC partial phase-out — $250k single, 2 kids", async (ctx) => {
    const cid = await makeClient({ firstName: "Janet", lastName: "Highearner", filingStatus: "single", state: "FL", taxYear: 2024, dependentsUnder17: 2 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 250000, federalTaxWithheldBox2: 55000, stateCode: "FL" }) });
      await settle();
      const r = await getReturn(cid);
      // CTC: 2 × $2k = $4k. Threshold $200k single. Excess = $50k.
      // Phase-out = ceil(50/1) × $50 = $2,500. CTC = max(0, $4k - $2,500) = $1,500
      // (Note: tax_returns row stores capital_gains_tax / niit / etc but not the structured
      // CTC object — that comes from the breakdown endpoint.)
      const breakdown = await api<any>(`/clients/${cid}/tax-return/breakdown`);
      assert(ctx, "Breakdown CTC applied $1,500", Number(breakdown.childTaxCredit.appliedCredit), 1500, 1);
      assert(ctx, "Phase-out reduction $2,500", Number(breakdown.childTaxCredit.phaseOutReduction), 2500, 1);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 11: Complex high-net-worth
  // MFJ, $250k W-2 + $50k QDIV + $40k LTCG + $30k 1099-NEC + 2 kids
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("11. Complex HNW — $250k W-2 + $40k LTCG + $50k QDIV + $30k 1099-NEC, 2 kids", async (ctx) => {
    const cid = await makeClient({ firstName: "Complex", lastName: "Case", filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024, dependentsUnder17: 2 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 250000, federalTaxWithheldBox2: 50000, stateCode: "FL" }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "div", ordinaryDividends: 50000, qualifiedDividends: 50000 }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "b", longTermGainLoss: 40000 }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "nec", nonemployeeCompensation: 30000 }) });
      await settle();
      const r = await getReturn(cid);
      // Total income = $250k + $50k + $40k + $30k = $370k
      // SE tax on $30k: $30k × 0.9235 × 15.3% = $4,238.83. 1/2 = $2,119.42
      // AGI = $370k - $2,119.42 = $367,880.58
      // Std MFJ $29,200. Taxable = $338,680.58
      // Ordinary portion = $338,680.58 - $40k LTCG - $50k QDIV = $248,680.58
      // Federal MFJ ordinary on $248,680.58: 2320 + 8532 + 23485 + (248680.58-201050)×.24 = 2320 + 8532 + 23485 + 11431.34 = $45,768.34
      //   wait let me recompute: 2320 + (94300-23200)×.12 + (201050-94300)×.22 + (248680.58-201050)×.24
      //   = 2320 + 8532 + 23485 + 11431.34 = $45,768.34
      // LTCG+QDIV $90k stacks on $248,680.58:
      //   $248,680.58 < MFJ 15% boundary $583,750, so all $90k at 15% = $13,500
      // Total fed ordinary+capgains = $45,768.34 + $13,500 = $59,268.34
      // SE tax: $4,238.83
      // CTC: 2×$2000 = $4,000. AGI $367,880 < MFJ threshold $400k → no phase-out
      // NIIT: AGI $367,880, excess over $250k MFJ = $117,880. Investment income = $40k LTCG + $50k QDIV + $50k full divs = wait, the $50k qualified is INSIDE the $50k ordinary divs (box 1b is subset of 1a)
      //   form1099Summary.totalInvestmentIncome = interest + ordinaryDivs(non-qualified portion=$0) + qualifiedDivs($50k) + LTCG($40k) + STCG(0) = $90k
      //   NIIT = min($90k, $117,880) × 3.8% = $3,420
      // Total federal liability = $59,268.34 + $4,238.83 + $3,420 = $66,927.17
      // Apply CTC $4,000: refund/owed = withheld $50k - $66,927.17 + $4,000 = -$12,927.17 (owes)
      assert(ctx, "Total income $370k", Number(r.totalIncome), 370000);
      assert(ctx, "SE tax ~$4,239", Number(r.selfEmploymentTax), 4238.83, 2);
      assert(ctx, "Capital gains tax 15% × $90k = $13,500", Number(r.capitalGainsTax), 13500, 5);
      assert(ctx, "NIIT 3.8% × $90k investment", Number(r.niitTax), 3420, 5);
      assert(ctx, "Total federal liability ~$66,927", Number(r.federalTaxLiability), 66927.17, 10);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 12: Gig economy worker (1099-K + 1099-NEC)
  // Single, $20k 1099-K (Uber) + $10k 1099-NEC (consulting), $0 W-2
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("12. Gig worker — $20k Uber 1099-K + $10k consulting 1099-NEC", async (ctx) => {
    const cid = await makeClient({ firstName: "Gig", lastName: "Worker", filingStatus: "single", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "k", payerName: "Uber", grossPaymentAmount: 20000 }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "nec", payerName: "ConsultCo", nonemployeeCompensation: 10000 }) });
      await settle();
      const r = await getReturn(cid);
      // Note: 1099-K is reported as income but our model doesn't auto-treat it as SE.
      // 1099-NEC $10k → SE tax: 10000 × 0.9235 × 15.3% = $1,412.96
      // Total income = $20k + $10k = $30k
      // AGI = $30k - 1/2 SE ($706.48) = $29,293.52
      // Std $14,600. Taxable = $14,693.52
      // Federal ordinary: 1160 + (14693.52-11600)×.12 = 1160 + 371.22 = $1,531.22
      // SE tax: $1,412.96
      // Total fed = $2,944.18
      assert(ctx, "Total income $30k", Number(r.totalIncome), 30000);
      assert(ctx, "SE tax (only on 1099-NEC)", Number(r.selfEmploymentTax), 1412.96, 1);
      assert(ctx, "Total federal liability", Number(r.federalTaxLiability), 2944.18, 5);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 13: Unemployed all year (1099-G only)
  // Single, $25k unemployment, $1k state refund
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("13. Unemployed — $25k unemployment + $1k state refund (1099-G)", async (ctx) => {
    const cid = await makeClient({ firstName: "Pat", lastName: "Unemployed", filingStatus: "single", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "g", unemploymentCompensation: 25000, stateLocalRefund: 1000, federalTaxWithheld: 2500 }) });
      await settle();
      const r = await getReturn(cid);
      // Total income $26k. Std $14,600. Taxable $11,400.
      // Federal: $11,400 × 10% = $1,140
      assert(ctx, "Total income $26k (unemployment + refund)", Number(r.totalIncome), 26000);
      assert(ctx, "Federal tax $1,140 (all in 10%)", Number(r.federalTaxLiability), 1140, 1);
      // Refund = $2,500 withheld - $1,140 = $1,360
      assert(ctx, "Federal refund $1,360", Number(r.federalRefundOrOwed), 1360, 1);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 14: NIIT just barely triggers
  // Single, $195k W-2 + $10k interest income (1099-INT)
  // AGI $205k, NIIT excess = $5k, investment $10k → NIIT = 3.8% × $5k
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("14. NIIT just barely triggers — $195k wages + $10k interest", async (ctx) => {
    const cid = await makeClient({ firstName: "Edge", lastName: "Niit", filingStatus: "single", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 195000, federalTaxWithheldBox2: 38000, stateCode: "FL" }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "int", interestIncome: 10000 }) });
      await settle();
      const r = await getReturn(cid);
      // AGI = $205k. NIIT excess = $5k. Investment income = $10k.
      // NIIT = min($10k, $5k) × 3.8% = $190
      assert(ctx, "NIIT just barely fires (excess $5k binding)", Number(r.niitTax), 190, 1);
    } finally { await delClient(cid); }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 15: Multi-year persistence — same client, both 2024 and 2025 returns
  // ─────────────────────────────────────────────────────────────────────────
  await runScenario("15. Multi-year — same client filed 2024 + previewing 2025", async (ctx) => {
    const cid = await makeClient({ firstName: "Multi", lastName: "Year", filingStatus: "single", state: "FL", taxYear: 2024 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 12000, stateCode: "FL" }) });
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2025, wagesBox1: 85000, federalTaxWithheldBox2: 13000, stateCode: "FL" }) });
      await settle();
      // Calculate 2024 (saves a tax_returns row for 2024)
      await api(`/clients/${cid}/tax-return`, { method: "POST", body: JSON.stringify({ taxYear: 2024 }) });
      await settle();
      // Switch client to 2025 (saves a tax_returns row for 2025 via auto-recalc)
      await api(`/clients/${cid}`, { method: "PATCH", body: JSON.stringify({ taxYear: 2025 }) });
      await settle();

      const allReturns = await api<any[]>(`/clients/${cid}/tax-returns`);
      assertExact(ctx, "Two tax-return rows persisted", allReturns.length, 2);
      const t24 = allReturns.find(r => r.taxYear === 2024);
      const t25 = allReturns.find(r => r.taxYear === 2025);
      // 2024: $80k - $14,600 std = $65,400 taxable. 1160 + 4266 + (65400-47150)×.22 = $9,441
      assert(ctx, "TY2024 federal tax", Number(t24?.federalTaxLiability), 9441, 1);
      // 2025: $85k - $15,000 std = $70,000 taxable. 1192.5 + 4386 + (70000-48475)×.22 = $1192.5 + 4386 + 4735.5 = $10,314
      assert(ctx, "TY2025 federal tax", Number(t25?.federalTaxLiability), 10314, 1);
    } finally { await delClient(cid); }
  });

  // ═════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═════════════════════════════════════════════════════════════════════════
  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  SCENARIO TEST SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════");
  let totalPasses = 0, totalFails = 0;
  for (const r of SCENARIO_RESULTS) {
    totalPasses += r.passes;
    totalFails += r.fails;
    const icon = r.fails === 0 ? "✓" : "✗";
    console.log(`  ${icon} ${r.name}: ${r.passes} passed, ${r.fails} failed`);
  }
  console.log("───────────────────────────────────────────────────────────────────");
  console.log(`  TOTAL: ${totalPasses} assertions passed, ${totalFails} failed`);
  console.log("═══════════════════════════════════════════════════════════════════");
  process.exit(totalFails > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
