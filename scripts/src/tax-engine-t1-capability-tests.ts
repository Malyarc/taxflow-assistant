/**
 * T1.2 — capability additions verified end-to-end through computeTaxReturnPure.
 * Each value hand-calc'd against the IRC primary source. NO API / NO DB.
 * Covers: §469(g) suspended-loss release, SE-tax edges (statutory employee /
 * optional method / church employee). (§280F lives in its own suite.)
 *
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-t1-capability-tests.ts
 */
import { computeTaxReturnPure, type TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { computeForm2210Annualized } from "../../artifacts/api-server/src/lib/form2210";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (Δ ${(actual - expected).toFixed(2)})`);
}
function ok(label: string, cond: boolean) { (cond ? PASS : FAIL).push(`${cond ? "✓" : "✗"} ${label}`); }
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// §469(g) — fully-taxable disposition RELEASES the property's current-year net +
// its accumulated suspended passive losses, freely deductible (no $25k cap).
// ════════════════════════════════════════════════════════════════════════════
header("§469(g) — disposition releases suspended PAL (no $25k cap)");
{
  const base = (disposed: boolean): TaxReturnInputs => ({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "FL" } as never],
    form1099s: [],
    adjustments: [],
    rentalProperties: [{
      taxYear: 2024, rentalIncome: 10000, totalExpenses: 25000, basis: 0,
      isActiveParticipant: true,
      fullyDisposedThisYear: disposed, suspendedLossCarryforward: 50000,
    } as never],
    taxYear: 2024,
  });
  // Disposed: net −$15k + released $50k = −$65k fully deductible despite $200k MAGI.
  const d = computeTaxReturnPure(base(true));
  check("disposed: §469(g) released loss = $50,000", d.section469gReleasedLoss, 50000, 1);
  check("disposed: AGI = $200k − $65k = $135,000", d.adjustedGrossIncome, 135000, 1);
  // Not disposed: at $200k MAGI the §469 allowance is $0 → the $15k loss is
  // SUSPENDED and the $50k stays suspended → AGI unchanged at $200,000.
  const n = computeTaxReturnPure(base(false));
  check("not disposed: no release", n.section469gReleasedLoss, 0, 0.01);
  check("not disposed: AGI = $200,000 (loss suspended at high MAGI)", n.adjustedGrossIncome, 200000, 1);
  ok("§469(g) release lowers AGI by the full $65k", Math.abs((n.adjustedGrossIncome - d.adjustedGrossIncome) - 65000) < 1);
}

// ════════════════════════════════════════════════════════════════════════════
// SE-tax edges — statutory employee (no SE tax), church employee ($108.28 SE
// trigger), and the SE optional method are exercised via adjustments.
// ════════════════════════════════════════════════════════════════════════════
header("SE edges — statutory employee Sch C is NOT in the SE base");
{
  // A statutory employee's $50k Sch C net reduces income tax (Sch C) but owes NO
  // SE tax (FICA already withheld on the W-2). Compare to ordinary self-employment.
  const statutory: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [{ adjustmentType: "statutory_employee_income", amount: 50000, isApplied: true } as never],
    taxYear: 2024,
  };
  const ordinary: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [{ adjustmentType: "self_employment_income", amount: 50000, isApplied: true } as never],
    taxYear: 2024,
  };
  check("statutory employee → $0 SE tax", computeTaxReturnPure(statutory).selfEmploymentTax, 0, 0.5);
  // Ordinary SE: 15.3% × (50,000 × 0.9235) = $7,064.77.
  check("ordinary SE → $7,064.77 SE tax", computeTaxReturnPure(ordinary).selfEmploymentTax, 7064.77, 1);
  // Both put $50k of income into AGI (statutory via Sch C, ordinary via Sch C −
  // ½ SE). The statutory one has NO ½-SE above-the-line deduction.
  ok("statutory AGI > ordinary AGI (no ½-SE deduction)",
    computeTaxReturnPure(statutory).adjustedGrossIncome > computeTaxReturnPure(ordinary).adjustedGrossIncome);
}

header("SE edges — church employee income ($108.28 SE trigger)");
{
  // $20,000 church-employee income (employer opted out of FICA) → SE tax on it at
  // 15.3% × (20,000 × 0.9235) = $2,825.91. The $108.28 floor (well below the
  // ordinary $400) is met.
  const church: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [{ adjustmentType: "church_employee_income", amount: 20000, isApplied: true } as never],
    taxYear: 2024,
  };
  check("church employee $20k → SE tax $2,825.91", computeTaxReturnPure(church).selfEmploymentTax, 2825.91, 1);
  // Below the $108.28 floor → no SE tax.
  const tiny: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [{ adjustmentType: "church_employee_income", amount: 100, isApplied: true } as never],
    taxYear: 2024,
  };
  check("church employee $100 (< $108.28) → $0 SE tax", computeTaxReturnPure(tiny).selfEmploymentTax, 0, 0.5);
}

header("SE edges — non-farm optional method (Sch SE Part II election)");
{
  // Gross SE $10k − $7k expenses → actual net $3,000. Without the election SE tax
  // = 15.3% × (3,000 × 0.9235) = $423.89. WITH the election (eligible: net <
  // $7,493 AND < 72.189%×10,000) report ⅔×10,000 = $6,666.67. That ⅔ amount goes
  // on Sch SE Line 15 → Line 4b → Line 4c WITHOUT a second 92.35% reduction (the
  // ⅔ factor IS the optional method's substitute for the net-earnings haircut), so
  // SE tax = 15.3% × $6,666.67 = $1,020.00. Raises SE tax + earned income (not AGI).
  const mk = (elect: boolean): TaxReturnInputs => ({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [
      { adjustmentType: "self_employment_income", amount: 10000, isApplied: true } as never,
      { adjustmentType: "schedule_c_expenses", amount: 7000, isApplied: true } as never,
      ...(elect ? [{ adjustmentType: "se_optional_method_nonfarm", amount: 10000, isApplied: true } as never] : []),
    ],
    taxYear: 2024,
  });
  check("no election → SE tax $423.89 (on actual $3,000 net)", computeTaxReturnPure(mk(false)).selfEmploymentTax, 423.89, 1);
  check("optional method → SE tax $1,020.00 (Sch SE Line 4b: ⅔ × $10k = $6,666.67, no ×0.9235)", computeTaxReturnPure(mk(true)).selfEmploymentTax, 1020.00, 1);
  // The actual $3,000 Sch C net still flows to AGI both ways; AGI differs ONLY by
  // the extra ½-SE deduction ($1,020.00−$423.89)/2 = $298.06.
  check("AGI delta = the ½-SE deduction delta ($298.06)",
    computeTaxReturnPure(mk(false)).adjustedGrossIncome - computeTaxReturnPure(mk(true)).adjustedGrossIncome, 298.06, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Digital assets — staking (ordinary, not SE; Rev. Rul. 2023-14) vs mining as a
// trade/business (ordinary + SE tax; Notice 2014-21).
// ════════════════════════════════════════════════════════════════════════════
header("Digital assets — staking (ordinary) vs mining (SE)");
{
  const staking: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [{ adjustmentType: "crypto_staking_income", amount: 10000, isApplied: true } as never],
    taxYear: 2024,
  };
  const s = computeTaxReturnPure(staking);
  check("staking $10k → AGI includes $10k", s.adjustedGrossIncome, 10000, 1);
  check("staking → $0 SE tax (not a trade/business)", s.selfEmploymentTax, 0, 0.5);
  // Mining as a business: $30k → SE tax 15.3% × (30,000 × 0.9235) = $4,238.87.
  const mining: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [{ adjustmentType: "crypto_mining_income", amount: 30000, isApplied: true } as never],
    taxYear: 2024,
  };
  check("mining $30k → SE tax $4,238.87", computeTaxReturnPure(mining).selfEmploymentTax, 4238.87, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// Form 2210 Schedule AI — annualized-income installment method. tax($100k single
// 2024) = $17,053. RAP = $10,000 → flat 25% = $2,500/quarter.
// ════════════════════════════════════════════════════════════════════════════
header("Form 2210 Schedule AI — annualized installment method");
{
  // Back-loaded: all $100k taxable earned in Q4. The annualized method lets the
  // taxpayer owe $0 in Q1-Q3 and $10,000 (the full RAP) in Q4.
  const back = computeForm2210Annualized({
    cumulativeTaxableIncome: [0, 0, 0, 100000],
    cumulativeTaxPaid: [0, 0, 0, 0],
    filingStatus: "single", taxYear: 2024, requiredAnnualPayment: 10000,
  });
  check("back-loaded Q1 installment = $0", back.requiredInstallment[0], 0, 0.5);
  check("back-loaded Q3 installment = $0", back.requiredInstallment[2], 0, 0.5);
  check("back-loaded Q4 installment = $10,000 (full RAP)", back.requiredInstallment[3], 10000, 1);
  ok("annualized method reduces the early installments", back.reducesEarlyInstallments === true);
  check("back-loaded total required = $10,000", back.totalAnnualizedRequired, 10000, 1);
  // Even income: each period annualizes to ~$100k → flat 25% = $2,500/quarter
  // (the method gives the same as the regular method; it never raises it).
  const even = computeForm2210Annualized({
    cumulativeTaxableIncome: [25000, 41666.67, 66666.67, 100000],
    cumulativeTaxPaid: [2500, 5000, 7500, 10000],
    filingStatus: "single", taxYear: 2024, requiredAnnualPayment: 10000,
  });
  check("even-income Q1 installment = $2,500 (25%)", even.requiredInstallment[0], 2500, 1);
  check("even-income Q4 installment = $2,500 (25%)", even.requiredInstallment[3], 2500, 1);
  ok("even income: annualized does NOT reduce installments", even.reducesEarlyInstallments === false);
}

// ════════════════════════════════════════════════════════════════════════════
// INDEPENDENT-REVIEW REGRESSIONS (2026-06-09) — bugs the multi-agent audit found.
// ════════════════════════════════════════════════════════════════════════════
header("HIGH-1 — statutory-employee QBI survives an explicit qbi_income");
{
  // statutory $50k + an explicit qbi_income $1k. The statutory Sch C net is
  // §199A-eligible and must NOT be dropped: QBI ded = min(20%×$51k, 20%×taxable
  // $35,400) = $7,080 (was $200 — only the explicit qbi_income — before the fix).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [
      { adjustmentType: "statutory_employee_income", amount: 50000, isApplied: true } as never,
      { adjustmentType: "qbi_income", amount: 1000, isApplied: true } as never,
    ],
    taxYear: 2024,
  });
  check("statutory QBI not dropped by explicit qbi_income → $7,080", r.qbiDeduction, 7080, 1);
}

header("HIGH-2 — crypto-mining is SE-taxed on the MFJ per-spouse path");
{
  // MFJ: taxpayer crypto-mining $30k + a spouse-tagged 1099-NEC $5k (triggers
  // per-spouse Sch SE). SE = mining 15.3%×($30k×0.9235)=$4,238.87 + spouse
  // 15.3%×($5k×0.9235)=$706.48 = $4,945.35 (was $706.48 — mining escaped).
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "X", nonemployeeCompensation: 5000, spouse: "spouse" } as never],
    adjustments: [{ adjustmentType: "crypto_mining_income", amount: 30000, isApplied: true } as never],
    taxYear: 2024,
  });
  check("MFJ crypto-mining SE tax = $4,945.35", r.selfEmploymentTax, 4945.35, 1);
}

header("HIGH-3 — SE optional method honored on the MFJ per-spouse path");
{
  // MFJ: taxpayer gross $10k − $7k exp (net $3k) + optional election, spouse NEC $1
  // (triggers per-spouse). SE on the elected ⅔×$10k=$6,666.67 → $1,020.00 (Sch SE
  // Line 4b, no ×0.9235; was $423.89 on the actual $3k — the election was dropped).
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Y", nonemployeeCompensation: 1, spouse: "spouse" } as never],
    adjustments: [
      { adjustmentType: "self_employment_income", amount: 10000, isApplied: true } as never,
      { adjustmentType: "schedule_c_expenses", amount: 7000, isApplied: true } as never,
      { adjustmentType: "se_optional_method_nonfarm", amount: 10000, isApplied: true } as never,
    ],
    taxYear: 2024,
  });
  check("MFJ optional-method SE tax = $1,020.00", r.selfEmploymentTax, 1020.00, 1.5);
}

header("MEDIUM-1 — disposed rental's positive net is in the NIIT base");
{
  // Single, $250k wages (NIIT binds) + a fully-disposed rental with +$50k operating
  // net. AGI $300k; NII includes the $50k → NIIT 3.8%×$50k = $1,900 (was $0).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 250000, federalTaxWithheldBox2: 0, stateCode: "FL" }] as never,
    form1099s: [],
    adjustments: [],
    rentalProperties: [{ taxYear: 2024, rentalIncome: 60000, totalExpenses: 10000, basis: 0, isActiveParticipant: true, fullyDisposedThisYear: true }] as never,
    taxYear: 2024,
  });
  check("disposed rental +$50k net → NIIT $1,900", r.niitTax, 1900, 1);
}

header("church $108.28 floor — standalone church wage below $400 is SE-taxed");
{
  // $300 church-employee income only → net $277.05 ≥ $100 → SE 15.3%×$277.05 =
  // $42.39 (was $0 under the wrongly-applied $400 floor).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [], form1099s: [],
    adjustments: [{ adjustmentType: "church_employee_income", amount: 300, isApplied: true } as never],
    taxYear: 2024,
  });
  check("church $300 → SE tax $42.39 (below $400 floor)", r.selfEmploymentTax, 42.39, 0.5);
}

// ── summary ──
console.log(`\n${"═".repeat(60)}`);
for (const f of FAIL) console.log(f);
console.log(`\nT1.2-capability: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
