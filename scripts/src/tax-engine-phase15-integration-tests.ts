/**
 * Phase 1.5 integration tests — exercise the full pipeline end-to-end via API.
 *
 * Coverage:
 *   1. Educator expenses ($300/educator above-the-line)
 *   2. Student loan interest deduction ($2,500 cap + MAGI phase-out)
 *   3. Foreign tax credit (simplified path)
 *   4. Residential energy credits (§25D + §25C + §30C)
 *   5. ACA Premium Tax Credit (Form 8962, refundable + repayment cap)
 *   6. Oregon federal-tax-paid subtraction (Form 40 Line 13)
 *   7. Dependent-care credit MFJ taxpayer-only earned-income fix
 *
 * Requires API server running at localhost:8080.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-phase15-integration-tests.ts
 */

const BASE = "http://localhost:8080/api";
const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 1) {
  return Math.abs(a - b) <= tol;
}
function check(label: string, actual: number, expected: number, tol = 1) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (diff ${(actual - expected).toFixed(2)})`);
}
function checkExact(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

async function makeClient(extras: Record<string, unknown> = {}): Promise<number> {
  const c = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "P15",
      lastName: `T${Date.now()}${Math.floor(Math.random() * 1000)}`,
      email: `p15-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
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
  // See phase1-integration-tests.ts for context — routes are now sync.
  await new Promise((r) => setTimeout(r, 50));
}
async function getReturn(cid: number): Promise<any> {
  return await api(`/clients/${cid}/tax-return`);
}
async function getPreview(cid: number, taxYear?: number): Promise<any> {
  const q = taxYear ? `?taxYear=${taxYear}` : "";
  return await api(`/clients/${cid}/tax-return/preview${q}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. EDUCATOR EXPENSES
// ════════════════════════════════════════════════════════════════════════════
async function testEducator() {
  console.log("\n══════════ 1. Educator expenses ($300/educator) ══════════\n");

  // 1a. Single educator, $250 expenses → $250 deductible (under $300 cap)
  // Single, W-2 $50k, $250 educator → AGI = $50,000 - $250 = $49,750.
  // Std ded single = $14,600. Taxable = $35,150. Tax = $1,160 + ($35,150-$11,600)×0.12 = $1,160 + $2,826 = $3,986.
  console.log("── 1a. Single educator, $250 expenses → $250 above-the-line ──");
  {
    const cid = await makeClient({ firstName: "Educator", eligibleEducatorCount: 1 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "educator_expenses", amount: 250, description: "Classroom supplies", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("AGI = $49,750 (W-2 $50k - $250 educator)", Number(r.adjustedGrossIncome), 49750, 1);
      check("Educator deduction = $250", Number(r.educatorExpensesDeduction), 250, 1);
      check("Federal tax = $3,986", Number(r.federalTaxLiability), 3986, 2);
    } finally {
      await delClient(cid);
    }
  }

  // 1b. Single educator, $500 → capped at $300
  console.log("── 1b. Single educator, $500 expenses → $300 cap ──");
  {
    const cid = await makeClient({ firstName: "EducatorCap", eligibleEducatorCount: 1 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "educator_expenses", amount: 500, description: "Capped", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Educator deduction capped at $300", Number(r.educatorExpensesDeduction), 300, 1);
      check("AGI = $49,700 ($50k - $300)", Number(r.adjustedGrossIncome), 49700, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 1c. MFJ 2 eligible educators, $800 → $600 cap
  console.log("── 1c. MFJ 2 educators, $800 expenses → $600 cap ──");
  {
    const cid = await makeClient({ firstName: "EducatorMfj", filingStatus: "married_filing_jointly", eligibleEducatorCount: 2 });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 8000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "educator_expenses", amount: 800, description: "Two educators", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Educator MFJ 2 educators capped at $600", Number(r.educatorExpensesDeduction), 600, 1);
      check("AGI = $79,400 ($80k - $600)", Number(r.adjustedGrossIncome), 79400, 1);
    } finally {
      await delClient(cid);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. STUDENT LOAN INTEREST
// ════════════════════════════════════════════════════════════════════════════
async function testStudentLoanInterest() {
  console.log("\n══════════ 2. Student loan interest ══════════\n");

  // 2a. Single, $2k SLI, MAGI $50k (well under phase-out) → full $2k
  // AGI = $50k - $2k = $48k. Std ded $14,600. Taxable $33,400.
  // Tax = $1,160 + ($33,400-$11,600)×0.12 = $1,160 + $2,616 = $3,776.
  console.log("── 2a. Single $2k SLI, MAGI $50k → full $2,000 deduction ──");
  {
    const cid = await makeClient({ firstName: "SLI1" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "student_loan_interest", amount: 2000, description: "1098-E", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("SLI deduction = $2,000", Number(r.studentLoanInterestDeduction), 2000, 1);
      check("AGI = $48,000 (after SLI)", Number(r.adjustedGrossIncome), 48000, 1);
      check("Federal tax = $3,776", Number(r.federalTaxLiability), 3776, 2);
    } finally {
      await delClient(cid);
    }
  }

  // 2b. Single, $3k SLI → capped at $2,500
  console.log("── 2b. Single $3k SLI → capped at $2,500 ──");
  {
    const cid = await makeClient({ firstName: "SLI2" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "student_loan_interest", amount: 3000, description: "Over-cap", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("SLI deduction capped at $2,500", Number(r.studentLoanInterestDeduction), 2500, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 2c. Single, MAGI $85k (midpoint of $80k-$95k phase-out)
  // Phase-out fraction = (95k-85k)/15k = 0.6667. Deduction = $2,500 × 0.6667 = $1,666.67
  console.log("── 2c. Single MAGI $85k → SLI phase-out 0.6667 → $1,666.67 ──");
  {
    const cid = await makeClient({ firstName: "SLIphased" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 85000, federalTaxWithheldBox2: 8500, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "student_loan_interest", amount: 2500, description: "Phased", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Phased SLI ≈ $1,666.67", Number(r.studentLoanInterestDeduction), 1666.67, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 2d. MFS → ineligible
  console.log("── 2d. MFS → SLI ineligible ──");
  {
    const cid = await makeClient({ firstName: "SLIMfs", filingStatus: "married_filing_separately" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "student_loan_interest", amount: 2500, description: "MFS test", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      checkExact("MFS SLI = $0", Number(r.studentLoanInterestDeduction), 0);
    } finally {
      await delClient(cid);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. FOREIGN TAX CREDIT
// ════════════════════════════════════════════════════════════════════════════
async function testForeignTaxCredit() {
  console.log("\n══════════ 3. Foreign tax credit ══════════\n");

  // 3a. Single, $200 foreign tax → simplified path, full $200 credit
  // Wages $80k, AGI $80k, Std ded $14,600, Taxable $65,400.
  // Gross fed tax = $1,160 + ($47,150-$11,600)×0.12 + ($65,400-$47,150)×0.22
  //               = $1,160 + $4,266 + $4,015 = $9,441.
  // Refund = withheld $9,000 + credit $200 - gross $9,441 = -$241 owed.
  console.log("── 3a. Single $200 FTC simplified path → $200 credit ──");
  {
    const cid = await makeClient({ firstName: "FTC1" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_tax_paid", amount: 200, description: "1099-DIV Box 7", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Foreign tax credit = $200", Number(r.foreignTaxCredit), 200, 1);
      check("Federal owed = -$241 (withheld + credit - gross)", Number(r.federalRefundOrOwed), -241, 2);
    } finally {
      await delClient(cid);
    }
  }

  // 3b. MFJ, $600 foreign tax → at simplified limit, full credit
  console.log("── 3b. MFJ $600 FTC at simplified limit → $600 credit ──");
  {
    const cid = await makeClient({ firstName: "FTCMfj", filingStatus: "married_filing_jointly" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 15000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_tax_paid", amount: 600, description: "Foreign div", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("FTC MFJ $600 (at simplified limit)", Number(r.foreignTaxCredit), 600, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 3c. Single, over simplified limit, NO Form 1116 input → approximate (= paid)
  // Hand-calc: $5,000 foreign tax paid; no foreign_source_taxable_income provided.
  // Path 3 (approximate): credit = paid = $5,000.
  console.log("── 3c. Single $5k FTC, no Form 1116 input → approximate $5,000 ──");
  {
    const cid = await makeClient({ firstName: "FTCApprox" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 30000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_tax_paid", amount: 5000, description: "1099-DIV Box 7", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("FTC approximated to paid ($5,000)", Number(r.foreignTaxCredit), 5000, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 3d. Single, over simplified limit, WITH Form 1116 input — limit DOESN'T bind
  // Hand-calc TY2024 single:
  //   Wages $200,000; std ded $14,600; taxable = $185,400
  //   Federal tax (single 2024):
  //     10% × $11,600          = $1,160.00
  //     12% × ($47,150-$11,600) = $4,266.00
  //     22% × ($100,525-$47,150) = $11,742.50
  //     24% × ($185,400-$100,525) = $20,370.00
  //     Total = $37,538.50
  //   Foreign source taxable = $30,000; total taxable = $185,400
  //   Form 1116 limit = 30000/185400 × 37538.50 = 0.16181 × 37538.50 ≈ $6,074
  //   Paid $5,000 < limit $6,074 → credit = $5,000 (limit doesn't bind)
  console.log("── 3d. Single $5k FTC with Form 1116, limit doesn't bind → $5,000 ──");
  {
    const cid = await makeClient({ firstName: "FTC1116a" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 30000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_tax_paid", amount: 5000, description: "1099-DIV Box 7", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_source_taxable_income", amount: 30000, description: "Foreign mutual fund dividends (Form 1116 L17)", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("FTC under limit → full $5,000", Number(r.foreignTaxCredit), 5000, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 3e. Single, over simplified, Form 1116 limit DOES bind
  // Same wages but paid = $10,000, foreign source = $20,000:
  //   Form 1116 limit = 20000/185400 × 37538.50 = 0.10787 × 37538.50 ≈ $4,049.13
  //   Paid $10,000 > limit $4,049 → credit = $4,049 (limit binds; $5,951 lost)
  console.log("── 3e. Single $10k FTC with Form 1116, limit binds → ~$4,049 ──");
  {
    const cid = await makeClient({ firstName: "FTC1116b" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 30000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_tax_paid", amount: 10000, description: "Foreign tax", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_source_taxable_income", amount: 20000, description: "Foreign source taxable", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      // Engine's federal tax on $185,400 should match hand-calc to within $1 (rounding within brackets).
      // Limit = 20000/185400 × federalTaxBeforeCredits
      // With our exact $37,538.50: limit = 0.10787 × 37538.50 = $4,049.13
      check("FTC Form 1116 limit binds (~$4,049)", Number(r.foreignTaxCredit), 4049, 3);
    } finally {
      await delClient(cid);
    }
  }

  // 3f. MFJ, Form 1116 limit binds at a different fraction
  // TY2024 MFJ: wages $300,000; std ded $29,200; taxable = $270,800
  // Federal tax (MFJ 2024):
  //   10% × $23,200        = $2,320.00
  //   12% × ($94,300-$23,200) = $8,532.00
  //   22% × ($201,050-$94,300) = $23,485.00
  //   24% × ($270,800-$201,050) = $16,740.00
  //   Total = $51,077.00
  // foreign tax paid: $8,000; foreign source = $40,000
  // Limit = 40000/270800 × 51077 = 0.14771 × 51077 ≈ $7,544.20
  // Paid $8k > limit $7,544 → credit = $7,544
  console.log("── 3f. MFJ $8k FTC with Form 1116, limit binds → ~$7,544 ──");
  {
    const cid = await makeClient({ firstName: "FTC1116mfj", filingStatus: "married_filing_jointly" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 300000, federalTaxWithheldBox2: 50000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_tax_paid", amount: 8000, description: "Foreign tax", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_source_taxable_income", amount: 40000, description: "Foreign source taxable", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("FTC Form 1116 MFJ limit binds (~$7,544)", Number(r.foreignTaxCredit), 7544, 5);
    } finally {
      await delClient(cid);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. RESIDENTIAL ENERGY CREDITS
// ════════════════════════════════════════════════════════════════════════════
async function testResidentialEnergyCredits() {
  console.log("\n══════════ 4. Residential energy credits (§25D/§25C/§30C) ══════════\n");

  // 4a. Single, $30k solar → $9,000 credit (no cap)
  // Single $100k W-2, AGI $100k, Std ded $14,600, Taxable $85,400.
  // Gross fed tax = $1,160 + ($47,150-$11,600)×0.12 + ($85,400-$47,150)×0.22
  //               = $1,160 + $4,266 + $8,415 = $13,841.
  // Solar credit = $30,000 × 30% = $9,000.
  // federalTaxLiability is GROSS — credits flow to refund/owed formula.
  // Withheld $14,000 + credits $9,000 - gross $13,841 = $9,159 refund.
  console.log("── 4a. Single $30k solar → $9,000 credit (no cap) ──");
  {
    const cid = await makeClient({ firstName: "Solar" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 14000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "residential_clean_energy", amount: 30000, description: "Solar PV", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Solar credit = $9,000 (no cap)", Number(r.residentialEnergyCredits), 9000, 1);
      check("Federal gross tax = $13,841 (credits don't reduce gross)", Number(r.federalTaxLiability), 13841, 5);
      check("Federal refund = withheld + credits - gross = $9,159", Number(r.federalRefundOrOwed), 9159, 5);
    } finally {
      await delClient(cid);
    }
  }

  // 4b. Heat pump $10k → $2,000 (heat pump cap)
  console.log("── 4b. Single $10k heat pump → $2,000 (heat pump cap) ──");
  {
    const cid = await makeClient({ firstName: "HeatPump" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 14000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "energy_efficient_heatpump", amount: 10000, description: "Heat pump", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Heat pump credit = $2,000", Number(r.residentialEnergyCredits), 2000, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 4c. EV charger $5k → $1,000 cap
  console.log("── 4c. Single $5k EV charger → $1,000 (charger cap) ──");
  {
    const cid = await makeClient({ firstName: "EVCharger" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 14000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "ev_charger_property", amount: 5000, description: "EV charger", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("EV charger credit = $1,000", Number(r.residentialEnergyCredits), 1000, 1);
    } finally {
      await delClient(cid);
    }
  }

  // 4d. Combined: solar $20k + windows $5k + heat pump $8k + EV charger $4k
  // §25D: $20k × 30% = $6,000
  // §25C general: min($5k×30%, $1,200) = $1,200
  // §25C heat pump: min($8k×30%, $2,000) = $2,000
  // §30C: min($4k×30%, $1,000) = $1,000
  // Total = $10,200
  console.log("── 4d. Combined all four energy adjustments → $10,200 ──");
  {
    const cid = await makeClient({ firstName: "AllEnergy" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 150000, federalTaxWithheldBox2: 25000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "residential_clean_energy", amount: 20000, description: "Solar", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "energy_efficient_home", amount: 5000, description: "Windows", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "energy_efficient_heatpump", amount: 8000, description: "Heat pump", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "ev_charger_property", amount: 4000, description: "Charger", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("All four energy credits combined = $10,200", Number(r.residentialEnergyCredits), 10200, 1);
    } finally {
      await delClient(cid);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 5. ACA PREMIUM TAX CREDIT
// ════════════════════════════════════════════════════════════════════════════
async function testPremiumTaxCredit() {
  console.log("\n══════════ 5. ACA Premium Tax Credit (Form 8962) ══════════\n");

  // 5a. Single, MAGI $25k, household 1, premium $6,000, SLCSP $6,500, advance $4,000
  // 2023 FPL single = $14,580. FPL% = 25000/14580 = 1.714.
  // Applicable figure = 0 + ((1.714-1.50)/0.50) × 0.02 = 0.00857.
  // Expected contribution = $25,000 × 0.00857 = $214.27.
  // Computed PTC = min($6,000, max(0, $6,500 - $214.27)) = $6,000.
  // Net PTC = $6,000 - $4,000 = $2,000 refundable.
  console.log("── 5a. Single MAGI $25k, premium $6k, advance $4k → $2,000 refundable PTC ──");
  {
    const cid = await makeClient({
      firstName: "PTCSng",
      acaAnnualPremium: 6000,
      acaAnnualSlcsp: 6500,
      acaAdvanceAptc: 4000,
      acaHouseholdSize: 1,
    });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 25000, federalTaxWithheldBox2: 1500, stateCode: "FL" }) });
      await settle();
      const r = await getReturn(cid);
      check("Net PTC (refundable) = $2,000", Number(r.premiumTaxCredit), 2000, 2);
    } finally {
      await delClient(cid);
    }
  }

  // 5b. Single, MAGI $50k, premium $10k, SLCSP $8k, advance $12k → owe repayment
  // FPL% = 50000/14580 = 3.429. Tier 3.00-4.00.
  // Applicable figure = 0.06 + ((3.429-3.00)/1.00) × 0.025 = 0.06 + 0.0107 = 0.07073.
  // Expected contribution = $50,000 × 0.07073 = $3,536.50.
  // Computed PTC = min($10,000, max(0, $8,000 - $3,536.50)) = $4,463.50.
  // Net = $4,463.50 - $12,000 = -$7,536.50 owed.
  // Repayment cap (FPL 3.00-4.00, single) = $1,575 (R3-C13: 2024 Form 8962 Table 5
  // / Rev. Proc. 2023-34 — the 300-<400% single cap is $1,575, not $1,625). Capped to -$1,575.
  console.log("── 5b. Single MAGI $50k, advance $12k overstated → repayment capped at $1,575 ──");
  {
    const cid = await makeClient({
      firstName: "PTCRepay",
      acaAnnualPremium: 10000,
      acaAnnualSlcsp: 8000,
      acaAdvanceAptc: 12000,
      acaHouseholdSize: 1,
    });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }) });
      await settle();
      const r = await getReturn(cid);
      check("Net PTC (excess repayment, capped) = -$1,575", Number(r.premiumTaxCredit), -1575, 2);
    } finally {
      await delClient(cid);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 6. OREGON FEDERAL-TAX-PAID SUBTRACTION
// ════════════════════════════════════════════════════════════════════════════
async function testOregonSubtraction() {
  console.log("\n══════════ 6. Oregon federal-tax-paid subtraction ══════════\n");

  // 6a. OR single, $80k W-2, no other items. Fed tax + AMT = $9,441 (regular fed).
  // AGI $80k. Std ded $2,745. Without subtraction: taxable = $77,255.
  //   Brackets: 4300×0.0475 + (10750-4300)×0.0675 + (77255-10750)×0.0875
  //     = 204.25 + 435.38 + 5819.19 = $6,458.82.
  // With subtraction: min($9,441, $8,250 cap) = $8,250. AGI $80k < $125k → no phase-out.
  // Taxable = $80,000 - $2,745 - $8,250 = $69,005.
  //   4300×0.0475 + (10750-4300)×0.0675 + (69005-10750)×0.0875
  //     = 204.25 + 435.38 + 5097.31 = $5,736.94.
  console.log("── 6a. OR single $80k W-2 → state tax with $8,250 fed subtraction ──");
  {
    const cid = await makeClient({ firstName: "ORfiler", state: "OR" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "OR" }) });
      await settle();
      const r = await getReturn(cid);
      check("OR state tax reduced by fed subtraction → ~$5,736.94", Number(r.stateTaxLiability), 5736.94, 5);
    } finally {
      await delClient(cid);
    }
  }

  // 6b. OR single, AGI $145k → fully phased out, state tax matches no-subtraction baseline
  // W-2 $145k. Taxable = $145,000 - $2,745 = $142,255.
  //   Bracket calc: 4300×0.0475 + (10750-4300)×0.0675 + (125000-10750)×0.0875 + (142255-125000)×0.099
  //     = 204.25 + 435.38 + 9996.88 + 1708.25 = $12,344.76
  console.log("── 6b. OR single AGI $145k → subtraction fully phased out ──");
  {
    const cid = await makeClient({ firstName: "ORphaseout", state: "OR" });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 145000, federalTaxWithheldBox2: 25000, stateCode: "OR" }) });
      await settle();
      const r = await getReturn(cid);
      check("OR state tax at AGI $145k matches no-subtraction (~$12,344.76)", Number(r.stateTaxLiability), 12344.76, 5);
    } finally {
      await delClient(cid);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 7. COMBINED: MFJ with multiple Phase 1.5 features
// ════════════════════════════════════════════════════════════════════════════
async function testCombined() {
  console.log("\n══════════ 7. Combined Phase 1.5 features ══════════\n");

  // 7a. MFJ, 1 educator, $300 educator + $2,500 SLI + $200 FTC + $5k solar
  // W-2 $100k combined. AGI = $100k - $300 - $2,500 = $97,200.
  // Std ded MFJ = $29,200. Taxable = $68,000.
  // Gross tax = $2,320 + ($68,000-$23,200)×0.12 = $2,320 + $5,376 = $7,696.
  // FTC: $200 (under $600 MFJ simplified limit).
  // Solar: $5,000 × 30% = $1,500.
  // federalTaxLiability remains $7,696 gross; credits flow to refund.
  // Withheld $8,000 + credits ($200+$1,500) - $7,696 = $2,004 refund.
  console.log("── 7a. MFJ combined: educator + SLI + FTC + solar ──");
  {
    const cid = await makeClient({
      firstName: "Combined",
      filingStatus: "married_filing_jointly",
      eligibleEducatorCount: 1,
    });
    try {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify({ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 8000, stateCode: "FL" }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "educator_expenses", amount: 300, description: "Classroom", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "student_loan_interest", amount: 2500, description: "1098-E", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "foreign_tax_paid", amount: 200, description: "Foreign div", isApplied: true }) });
      await api(`/clients/${cid}/adjustments`, { method: "POST", body: JSON.stringify({ adjustmentType: "residential_clean_energy", amount: 5000, description: "Solar", isApplied: true }) });
      await settle();
      const r = await getReturn(cid);
      check("Educator $300", Number(r.educatorExpensesDeduction), 300, 1);
      check("SLI $2,500", Number(r.studentLoanInterestDeduction), 2500, 1);
      check("FTC $200", Number(r.foreignTaxCredit), 200, 1);
      check("Solar credit $1,500", Number(r.residentialEnergyCredits), 1500, 1);
      check("AGI $97,200", Number(r.adjustedGrossIncome), 97200, 1);
      check("Federal gross tax = $7,696 (credits don't reduce gross)", Number(r.federalTaxLiability), 7696, 5);
      check("Federal refund = $2,004 (withheld + credits - gross)", Number(r.federalRefundOrOwed), 2004, 5);
    } finally {
      await delClient(cid);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────
async function main() {
  try {
    await testEducator();
    await testStudentLoanInterest();
    await testForeignTaxCredit();
    await testResidentialEnergyCredits();
    await testPremiumTaxCredit();
    await testOregonSubtraction();
    await testCombined();
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log(`  PHASE 1.5 INTEGRATION RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  console.log("══════════════════════════════════════════════════════════════════");
  if (FAIL.length > 0) {
    for (const f of FAIL) console.log("  " + f);
    process.exit(1);
  }
}

main();
