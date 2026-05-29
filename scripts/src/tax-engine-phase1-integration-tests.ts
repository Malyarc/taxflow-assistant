/**
 * Phase 1 integration tests via the live API.
 *
 * Exercises the full pipeline end-to-end for each Phase 1 feature:
 *   1. Schedule A itemized vs standard, SALT cap, medical 7.5% threshold
 *   2. Schedule C expenses subtract from gross SE income before SE tax
 *   3. EITC applied for low-income filers, phased out cleanly
 *   4. Education credits (AOC + LLC), refundable/non-refundable split, phase-out
 *   5. HSA + IRA deductions above-the-line, IRA workplace-plan phase-out
 *   6. Saver's Credit at AGI tiers
 *   7. Dependent Care Credit at AGI rate ladder
 *
 * Requires API server running at localhost:8080.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-phase1-integration-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 1) {
  return Math.abs(a - b) <= tol;
}

function check(label: string, actual: number, expected: number, tol = 1) {
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

// Helpers — share the same pattern as existing integration tests
async function makeClient(extras: Record<string, unknown> = {}): Promise<number> {
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "P1",
      lastName: `T${Date.now()}${Math.floor(Math.random() * 1000)}`,
      email: `p1-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
      ...extras,
    }),
  });
  return c.id;
}
async function delClient(id: number): Promise<void> {
  await api(`/clients/${id}`, { method: "DELETE" });
}
async function settle(): Promise<void> {
  // Defensive tiny delay. Routes now await recalc synchronously
  // (recalculateAfterMutation), so this is just a backstop for DB
  // transaction visibility / connection-pool effects.
  await new Promise((r) => setTimeout(r, 50));
}
async function getReturn(cid: number): Promise<any> {
  return await api(`/clients/${cid}/tax-return`);
}
async function getPreview(cid: number, taxYear?: number): Promise<any> {
  const q = taxYear ? `?taxYear=${taxYear}` : "";
  return await api(`/clients/${cid}/tax-return/preview${q}`);
}

// ────────────────────────────────────────────────────────────────────────
// 1. SCHEDULE A
// ────────────────────────────────────────────────────────────────────────
async function testScheduleA() {
  console.log("\n══════════ 1. Schedule A — itemized vs standard ══════════\n");

  // 1a. Big itemizer wins over standard deduction
  // Single, $200k wages, $15k mortgage interest + $8k state income + $4k property + $5k charity
  // SALT cap = $10k → SALT = $8k+$4k = $12k → capped to $10k
  // Total Sched A = $15k + $10k + $5k = $30k. Std single 2024 = $14,600. Itemize wins.
  // Taxable = $200k - $30k = $170k.
  // Federal: 1160 + (47150-11600)×.12 + (100525-47150)×.22 + (170000-100525)×.24
  //        = 1160 + 4266 + 11742.50 + 16674 = $33,842.50
  console.log("── 1a. Big itemizer (mortgage + SALT cap + charity) ──");
  {
    const cid = await makeClient({ firstName: "Itemizer", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 40000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "mortgage_interest", amount: 15000, description: "Mortgage", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "state_income_tax", amount: 8000, description: "State income tax", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "state_property_tax", amount: 4000, description: "Property tax", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "charitable_cash", amount: 5000, description: "Charity", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Itemized total $30k (Sched A wins)", Number(r.itemizedDeductions), 30000, 1);
      check("Taxable $170k after $30k itemized", Number(r.taxableIncome), 170000, 1);
      check("Federal tax $33,842.50", Number(r.federalTaxLiability), 33842.50, 5);
      // Schedule A breakdown columns
      check("SALT capped $10k (was $12k uncapped)", Number(r.saltDeductible), 10000, 1);
      check("Mortgage $15k flows", Number(r.mortgageDeductible), 15000, 1);
      check("Charity $5k flows", Number(r.charitableDeductible), 5000, 1);
      check("Medical $0 (none)", Number(r.medicalDeductible), 0, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 1b. Itemizing loses to standard — we use std
  // Single, $80k wages, $3k state tax + $1k charity → itemized $4k. Std $14,600 wins.
  // Taxable = $80k - $14.6k = $65,400. Fed = 1160 + (47150-11600)×.12 + (65400-47150)×.22 = 1160 + 4266 + 4015 = $9,441
  console.log("── 1b. Standard wins (modest itemized) ──");
  {
    const cid = await makeClient({ firstName: "StdWins", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 12000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "state_income_tax", amount: 3000, description: "x", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "charitable_cash", amount: 1000, description: "x", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Std deduction $14,600 (itemized $4k loses)", Number(r.standardDeduction), 14600, 1);
      check("Taxable $65,400", Number(r.taxableIncome), 65400, 1);
      check("Federal tax $9,441", Number(r.federalTaxLiability), 9441, 5);
      checkExact("Itemized null (using std)", r.itemizedDeductions, null);
    } finally {
      await delClient(cid);
    }
  }

  // 1c. Medical expenses: 7.5% AGI threshold
  // Single, $100k wages, $10k medical → 7.5% × $100k = $7,500 → deductible = $2,500
  // Plus $12,500 from other items (so total > std, itemize wins)
  console.log("── 1c. Medical 7.5% threshold ──");
  {
    const cid = await makeClient({ firstName: "Medical", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "medical_expenses", amount: 10000, description: "Medical", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "charitable_cash", amount: 13000, description: "Charity", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Medical deductible $2,500 ($10k - 7.5% AGI)", Number(r.medicalDeductible), 2500, 1);
      check("Total itemized $15,500 (med $2.5k + charity $13k)", Number(r.itemizedDeductions), 15500, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 1d. Sales tax option: taxpayer picks larger of income vs sales
  // Single, AGI $50k, $1k state income, $5k state sales → picks $5k. Plus $1k property + $10k charity
  // Total = $5k + $1k + $10k = $16k > std $14,600. Itemize wins.
  console.log("── 1d. Sales tax option (larger of income vs sales) ──");
  {
    const cid = await makeClient({ firstName: "SalesTax", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "state_income_tax", amount: 1000, description: "x", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "state_sales_tax", amount: 5000, description: "x", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "state_property_tax", amount: 1000, description: "x", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "charitable_cash", amount: 10000, description: "x", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("SALT = max($1k income, $5k sales) + $1k prop = $6k", Number(r.saltDeductible), 6000, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 1e. Charitable cash 60% AGI cap
  // Single, $50k wages, $40k charitable → cap = 60% × $50k = $30k. So $30k applies.
  console.log("── 1e. Charitable cash 60% AGI cap ──");
  {
    const cid = await makeClient({ firstName: "BigGiver", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "charitable_cash", amount: 40000, description: "x", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Charitable capped at 60% AGI = $30k", Number(r.charitableDeductible), 30000, 1);
    } finally {
      await delClient(cid);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// 2. SCHEDULE C — expenses reduce SE income
// ────────────────────────────────────────────────────────────────────────
async function testScheduleC() {
  console.log("\n══════════ 2. Schedule C — expenses reduce SE income ══════════\n");

  // 1099-NEC $50k gross, $20k expenses → net $30k SE income
  // SE tax: $30k × 0.9235 × 15.3% = $4,238.87
  // 1/2 SE tax = $2,119.43 (above-the-line)
  // Total income = $30k (net SE only)
  // AGI = $30k - $2,119.43 = $27,880.57
  // Std single = $14,600, Taxable before QBI = $13,280.57.
  // C3 QBI auto-default (2026-05-27): Sch C net (less half-SE) defaults to QBI.
  //   QBI base = $30,000 − $2,119.43 = $27,880.57.
  //   QBI deduction = min(20% × $27,880.57, 20% × $13,280.57) = min($5,576.11, $2,656.11) = $2,656.11 (cap binds).
  //   Taxable after QBI = $13,280.57 − $2,656.11 = $10,624.46 (drops into 10% bracket).
  //   Federal ordinary = $10,624.46 × 10% = $1,062.45.
  // Total federal = $1,062.45 ordinary + $4,238.87 SE = $5,301.31.
  console.log("── 2a. Schedule C: $50k gross - $20k expenses → SE tax on $30k net ──");
  {
    const cid = await makeClient({ firstName: "Sched_C", state: "FL" });
    try {
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "nec", payerName: "Acme", nonemployeeCompensation: 50000 }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "schedule_c_expenses", amount: 20000, description: "Business expenses", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Schedule C expenses persisted = $20k", Number(r.scheduleCExpenses), 20000, 1);
      check("Total income = net SE $30k", Number(r.totalIncome), 30000, 1);
      // SE tax computed on $30k net (after Schedule C)
      check("SE tax $4,238.87 (on $30k net)", Number(r.selfEmploymentTax), 4238.87, 1);
      // Total fed liability = ordinary (on taxable after QBI) + SE
      check("Federal tax incl. SE $5,301.31 (QBI auto-default, cap-bound)", Number(r.federalTaxLiability), 5301.31, 5);
    } finally {
      await delClient(cid);
    }
  }

  // 2b. Expenses cap at gross income (no NOL in Phase 1)
  // 1099-NEC $20k gross, $30k expenses → net = max(0, $20k - $30k) = $0. SE tax = $0.
  console.log("── 2b. Expenses cap at gross (no NOL) ──");
  {
    const cid = await makeClient({ firstName: "OverExp", state: "FL" });
    try {
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 20000 }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "schedule_c_expenses", amount: 30000, description: "Big losses", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Sched C capped at gross $20k", Number(r.scheduleCExpenses), 20000, 1);
      check("SE tax = $0 (net SE = $0)", Number(r.selfEmploymentTax), 0, 0.01);
      check("Total income = $0", Number(r.totalIncome), 0, 1);
    } finally {
      await delClient(cid);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// 3. EITC — Earned Income Tax Credit
// ────────────────────────────────────────────────────────────────────────
async function testEitc() {
  console.log("\n══════════ 3. EITC — Earned Income Tax Credit ══════════\n");

  // 3a. MFJ 3 kids @ $25k earned. Should get max EITC.
  // 2024 MFJ 3 kids: maxAtIncome=$17,400, maxCredit=$7,830, phaseOutStart=$29,640.
  // $25k > $17,400 → preliminary $7,830. AGI $25k < $29,640 → no phase-out.
  // Applied EITC = $7,830 (refundable, regardless of tax)
  console.log("── 3a. MFJ 3 kids @ $25k earned → max EITC $7,830 ──");
  {
    const cid = await makeClient({ firstName: "EITC3", filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024, dependentsUnder17: 3 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 25000, federalTaxWithheldBox2: 0, stateCode: "FL" }) });
      await settle();
      const breakdown = await api<any>(`/clients/${cid}/tax-return/breakdown`);
      // EITC is in the structured response. Let me check via preview which has the full result.
      const preview = await getPreview(cid, 2024);
      check("EITC preliminary $7,830 (max for 3 kids MFJ 2024)", Number(preview.eitc.preliminaryCredit), 7830, 1);
      check("EITC applied $7,830 (no phase-out)", Number(preview.eitc.appliedCredit), 7830, 1);
      checkExact("EITC eligible", preview.eitc.eligible, true);
    } finally {
      await delClient(cid);
    }
  }

  // 3b. MFS not eligible
  console.log("── 3b. MFS not eligible for EITC ──");
  {
    const cid = await makeClient({ firstName: "EITC_MFS", filingStatus: "married_filing_separately", state: "FL", taxYear: 2024, dependentsUnder17: 2 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 20000, stateCode: "FL" }) });
      await settle();
      const preview = await getPreview(cid, 2024);
      checkExact("EITC ineligible (MFS)", preview.eitc.eligible, false);
      check("EITC applied = $0", Number(preview.eitc.appliedCredit), 0, 0.01);
    } finally {
      await delClient(cid);
    }
  }

  // 3c. Investment income disqualifies
  // Single, 1 kid, $20k earned, $12k interest income (above $11,600 limit) → ineligible
  console.log("── 3c. Investment income > $11,600 disqualifies ──");
  {
    const cid = await makeClient({ firstName: "EITC_Inv", filingStatus: "single", state: "FL", taxYear: 2024, dependentsUnder17: 1 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 20000, stateCode: "FL" }) });
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 12000 }) });
      await settle();
      const preview = await getPreview(cid, 2024);
      checkExact("EITC ineligible (investment > $11,600)", preview.eitc.eligible, false);
      check("EITC applied = $0", Number(preview.eitc.appliedCredit), 0, 0.01);
    } finally {
      await delClient(cid);
    }
  }

  // 3d. Phased out fully — single 0 kids @ $30k AGI
  console.log("── 3d. Single 0 kids at $30k → fully phased out ──");
  {
    const cid = await makeClient({ firstName: "EITC_Po", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 30000, stateCode: "FL" }) });
      await settle();
      const preview = await getPreview(cid, 2024);
      check("EITC = $0 (single 0 kids @ $30k > $18,591)", Number(preview.eitc.appliedCredit), 0, 0.01);
    } finally {
      await delClient(cid);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// 4. Education credits (AOC + LLC)
// ────────────────────────────────────────────────────────────────────────
async function testEducationCredits() {
  console.log("\n══════════ 4. Education Credits — AOC + LLC ══════════\n");

  // 4a. AOC: 1 student, $4,000 expenses, AGI $50k → full $2,500 credit
  // 60% non-refundable ($1,500) + 40% refundable ($1,000)
  console.log("── 4a. AOC: 1 student $4k expenses → $2,500 ──");
  {
    const cid = await makeClient({ firstName: "AOC1", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 4000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "qualified_education_expenses_aoc", amount: 4000, description: "Tuition", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("AOC total $2,500 (= 100% × $2k + 25% × $2k)", Number(r.aocCredit), 2500, 1);
      check("AOC refundable $1,000 (40% of $2,500)", Number(r.aocRefundablePortion), 1000, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 4b. AOC phase-out: single AGI $85k → 50% phase-out fraction
  // (90k - 85k) / (90k - 80k) = 0.5 → AOC = $2,500 × 0.5 = $1,250
  console.log("── 4b. AOC phase-out at $85k → $1,250 (50% reduced) ──");
  {
    const cid = await makeClient({ firstName: "AOC_PO", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 85000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "qualified_education_expenses_aoc", amount: 4000, description: "Tuition", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("AOC ~$1,250 at AGI $85k (50% phase-out)", Number(r.aocCredit), 1250, 5);
    } finally {
      await delClient(cid);
    }
  }

  // 4c. LLC: $10k expenses → 20% × $10k = $2,000 (max). All non-refundable.
  console.log("── 4c. LLC: $10k expenses → $2,000 max ──");
  {
    const cid = await makeClient({ firstName: "LLC1", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "qualified_education_expenses_llc", amount: 10000, description: "Continuing ed", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("LLC $2,000 (20% × $10k)", Number(r.llcCredit), 2000, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 4d. AOC fully phased out — single AGI $90k → 0
  console.log("── 4d. AOC fully phased out at AGI $90k ──");
  {
    const cid = await makeClient({ firstName: "AOC_PO_Full", state: "FL" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 90000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "qualified_education_expenses_aoc", amount: 4000, description: "Tuition", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("AOC = $0 at $90k", Number(r.aocCredit), 0, 0.5);
    } finally {
      await delClient(cid);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// 5. HSA + IRA above-the-line deductions
// ────────────────────────────────────────────────────────────────────────
async function testRetirementDeductions() {
  console.log("\n══════════ 5. HSA + IRA — above-the-line deductions ══════════\n");

  // 5a. HSA self-only $4k contribution → fully deductible (limit $4,150 for 2024)
  // Single, $80k W-2, $4k HSA → AGI = $80k - $4k = $76k. Std $14.6k. Taxable $61,400.
  // Federal: 1160 + (47150-11600)×.12 + (61400-47150)×.22 = 1160 + 4266 + 3135 = $8,561
  console.log("── 5a. HSA self-only $4k fully deductible ──");
  {
    const cid = await makeClient({ firstName: "HSA1", state: "FL", taxpayerAge: 30, hsaIsFamilyCoverage: false });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 8000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "hsa_contribution", amount: 4000, description: "HSA", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("HSA deduction $4,000", Number(r.hsaDeduction), 4000, 1);
      check("AGI $76k after HSA", Number(r.adjustedGrossIncome), 76000, 1);
      check("Federal tax $8,561", Number(r.federalTaxLiability), 8561, 5);
    } finally {
      await delClient(cid);
    }
  }

  // 5b. HSA over-contribution capped at limit
  // Single, age 30, self-only HSA $10k → cap $4,150 → only $4,150 deductible
  console.log("── 5b. HSA over-contribution capped at $4,150 ──");
  {
    const cid = await makeClient({ firstName: "HSAcap", state: "FL", taxpayerAge: 30, hsaIsFamilyCoverage: false });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "hsa_contribution", amount: 10000, description: "HSA over", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("HSA capped at $4,150", Number(r.hsaDeduction), 4150, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 5c. HSA family + age 55+ catch-up
  // MFJ, age 56, family HSA $10k. Limit = $8,300 + $1,000 = $9,300.
  console.log("── 5c. HSA family + age 55+ catch-up = $9,300 ──");
  {
    const cid = await makeClient({ firstName: "HSAfam", filingStatus: "married_filing_jointly", state: "FL", taxpayerAge: 56, hsaIsFamilyCoverage: true });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "hsa_contribution", amount: 10000, description: "HSA family", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("HSA family + 55+ → $9,300", Number(r.hsaDeduction), 9300, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 5d. IRA traditional, NOT covered by workplace plan → fully deductible
  console.log("── 5d. IRA traditional $7k (not workplace) → full deduction ──");
  {
    const cid = await makeClient({ firstName: "IRA1", state: "FL", taxpayerAge: 30, iraCoveredByWorkplacePlan: false });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 200000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "ira_contribution_traditional", amount: 7000, description: "IRA", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("IRA full $7,000 (not workplace)", Number(r.iraDeduction), 7000, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 5e. IRA covered by workplace plan, AGI in phase-out (single $77k-$87k)
  // AGI ~$82k mid-range → 50% phase-out → $7k × 0.5 = $3,500 deductible
  console.log("── 5e. IRA covered by plan, AGI $82k single → 50% phase-out ──");
  {
    const cid = await makeClient({ firstName: "IRAphase", state: "FL", taxpayerAge: 30, iraCoveredByWorkplacePlan: true });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 82000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "ira_contribution_traditional", amount: 7000, description: "IRA", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("IRA partial deduction at AGI $82k (50%)", Number(r.iraDeduction), 3500, 5);
    } finally {
      await delClient(cid);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// 6. Saver's Credit
// ────────────────────────────────────────────────────────────────────────
async function testSaversCredit() {
  console.log("\n══════════ 6. Saver's Credit ══════════\n");

  // 6a. Single AGI $20k, $2k IRA contribution → 50% × $2k = $1,000
  // Note: IRA deduction would also reduce AGI. Single $20k - $2k IRA = $18k AGI < $23k tier.
  // (No workplace plan → IRA fully deductible.)
  console.log("── 6a. Single AGI $20k, $2k Traditional IRA → 50% saver's credit ──");
  {
    const cid = await makeClient({ firstName: "Save1", state: "FL", taxpayerAge: 30, iraCoveredByWorkplacePlan: false });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 20000, federalTaxWithheldBox2: 800, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "ira_contribution_traditional", amount: 2000, description: "IRA", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Saver's credit $1,000 (50% × $2k)", Number(r.saversCredit), 1000, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 6b. Roth IRA also counts (no deduction but counts for saver's)
  // AGI $24k single → 20% rate × $2k = $400
  // Note: AGI not reduced by Roth contribution
  console.log("── 6b. Roth IRA at AGI $24k → 20% rate × $2k = $400 ──");
  {
    const cid = await makeClient({ firstName: "RothSave", state: "FL", taxpayerAge: 30 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 24000, federalTaxWithheldBox2: 1000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "ira_contribution_roth", amount: 2000, description: "Roth", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Saver's credit $400 (20% × $2k)", Number(r.saversCredit), 400, 1);
      check("IRA deduction $0 (Roth not deductible)", Number(r.iraDeduction), 0, 0.01);
    } finally {
      await delClient(cid);
    }
  }

  // 6c. Above threshold → $0 saver's credit
  // Single AGI $40k → above $38,250 → 0% rate → no credit
  console.log("── 6c. AGI above threshold → $0 saver's credit ──");
  {
    const cid = await makeClient({ firstName: "NoSave", state: "FL", taxpayerAge: 30 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 40000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "ira_contribution_roth", amount: 2000, description: "Roth", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Saver's $0 above $38,250 single", Number(r.saversCredit), 0, 0.01);
    } finally {
      await delClient(cid);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// 7. Dependent Care Credit
// ────────────────────────────────────────────────────────────────────────
async function testDependentCareCredit() {
  console.log("\n══════════ 7. Dependent Care Credit ══════════\n");

  // 7a. MFJ, BOTH spouses work, 2 kids in daycare. W-2 represents combined household wages.
  // W-2 $30k combined, spouseEarnedIncome $10k → taxpayer's portion = $30k - $10k = $20k.
  // For dep-care MFJ earned-income limit: min(taxpayer $20k, spouse $10k) = $10k.
  // Eligible expenses = min($7k actual, $6k 2-child cap, $10k earned limit) = $6k.
  // AGI = $30k → reductions = floor((30000-15000)/2000) = 7 → rate = 35% - 7% = 28%.
  // Credit = $6k × 28% = $1,680.
  console.log("── 7a. MFJ 2 kids, $7k daycare, AGI $30k both work → $1,680 ──");
  {
    const cid = await makeClient({
      firstName: "DepCare1", filingStatus: "married_filing_jointly", state: "FL",
      dependentsForCareCredit: 2, spouseEarnedIncome: 10000,
    });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 30000, federalTaxWithheldBox2: 1500, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "dependent_care_expenses", amount: 7000, description: "Daycare", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Dep care: 28% × $6k = $1,680 at AGI $30k (MFJ split)", Number(r.dependentCareCredit), 1680, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 7b. Single (no spouse needed), 1 kid, $5k expenses, AGI > $43k → 20% rate
  // Single $50k W-2, depCare $5k, dependentsForCareCredit=1
  // Limit = min($5k, $3k 1-child cap, $50k earned) = $3k.
  // Rate at AGI $50k > $43k → 20%. Credit = $3k × 20% = $600.
  console.log("── 7b. Single 1 kid, AGI $50k → 20% × $3k = $600 ──");
  {
    const cid = await makeClient({ firstName: "DepCareSng", state: "FL", dependentsForCareCredit: 1 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "dependent_care_expenses", amount: 5000, description: "Daycare", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Dep care $600 (20% × $3k cap)", Number(r.dependentCareCredit), 600, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 7c. MFJ but spouse $0 earned → $0 credit
  console.log("── 7c. MFJ + spouse $0 earned → no credit ──");
  {
    const cid = await makeClient({
      firstName: "DepCareSp0", filingStatus: "married_filing_jointly", state: "FL",
      dependentsForCareCredit: 2, spouseEarnedIncome: 0,
    });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "dependent_care_expenses", amount: 5000, description: "Daycare", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Dep care $0 (spouse $0 earned)", Number(r.dependentCareCredit), 0, 0.01);
    } finally {
      await delClient(cid);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// 8. Combined: Multiple Phase 1 features at once
// ────────────────────────────────────────────────────────────────────────
async function testCombined() {
  console.log("\n══════════ 8. Combined: multiple Phase 1 features ══════════\n");

  // Single, $60k W-2, age 30, traditional IRA $5k (no workplace plan),
  // 1 kid in daycare $4k expenses, dependentsForCareCredit=1
  //
  // Step-by-step (hand-computed):
  //   Total income = $60k
  //   IRA deduction (no workplace plan) = $5,000 above-the-line
  //   AGI = $60k - $5k = $55k
  //   Std deduction $14,600. Taxable = $40,400.
  //   Federal: 1160 + (40400 - 11600) × 0.12 = 1160 + 3456 = $4,616
  //   Saver's credit: AGI $55k > $38,250 → 0%
  //   Dep care: AGI $55k > $43k → 20% rate. Limit = $3k. Credit = $600.
  //   No EITC (single 0 kids cap at $18,591)
  //   No CTC (dependentsUnder17=0; dependentsForCareCredit doesn't trigger CTC)
  //   Total federal liability = $4,616 (no SE/AMT/NIIT)
  //   Refund = withheld $5,000 + dep care $600 - $4,616 = $984 (assuming $5k withheld)
  console.log("── 8a. IRA deduction + dep care credit combined ──");
  {
    const cid = await makeClient({
      firstName: "Combined", state: "FL", taxpayerAge: 30,
      iraCoveredByWorkplacePlan: false, dependentsForCareCredit: 1,
    });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 5000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "ira_contribution_traditional", amount: 5000, description: "IRA", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "dependent_care_expenses", amount: 4000, description: "Daycare", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("AGI $55k after IRA deduction", Number(r.adjustedGrossIncome), 55000, 1);
      check("IRA deduction $5,000", Number(r.iraDeduction), 5000, 1);
      check("Federal tax $4,616", Number(r.federalTaxLiability), 4616, 5);
      check("Dep care credit $600 (20% × $3k)", Number(r.dependentCareCredit), 600, 1);
      check("Saver's credit $0 (AGI $55k > tier)", Number(r.saversCredit), 0, 0.01);
      check("Refund = $5k - $4,616 + $600 = $984", Number(r.federalRefundOrOwed), 984, 5);
    } finally {
      await delClient(cid);
    }
  }
}

async function run() {
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("  PHASE 1 INTEGRATION TESTS");
  console.log("═══════════════════════════════════════════════════════════════════");

  try {
    await testScheduleA();
    await testScheduleC();
    await testEitc();
    await testEducationCredits();
    await testRetirementDeductions();
    await testSaversCredit();
    await testDependentCareCredit();
    await testCombined();
  } catch (err) {
    console.error("\nUnexpected error during Phase 1 integration tests:", err);
    process.exit(1);
  }

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  PHASE 1 INTEGRATION RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  console.log("══════════════════════════════════════════════════════════════════");
  if (FAIL.length > 0) {
    for (const f of FAIL) console.log("  " + f);
    process.exit(1);
  }
  process.exit(0);
}

run();
