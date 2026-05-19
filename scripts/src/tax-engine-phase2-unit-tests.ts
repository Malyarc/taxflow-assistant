/**
 * Phase 2 unit tests — capital loss + state retirement exemption + Schedule B
 * + multi-state + Schedule E/MACRS + Schedule D detail.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-phase2-unit-tests.ts
 */

import {
  calculateStateTax,
  calculateMultiStateTax,
  getStateRetirementExemption,
  calculateMacrsDepreciation,
  calculatePassiveActivityLossAllowance,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import { hasReciprocity } from "../../artifacts/api-server/src/lib/stateTaxData";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function near(a: number, b: number, tol = 0.01) { return Math.abs(a - b) <= tol; }
function check(label: string, actual: number, expected: number, tol = 0.01) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// CAPITAL LOSS NETTING + $3K CAP (IRC §1211, Schedule D Line 21)
// ════════════════════════════════════════════════════════════════════════════
header("Capital loss — net loss ≤ $3k (no carryforward)");
{
  // Single, $50k W-2, $2k LTCL → -$2k net loss → all $2k deducted, no carryforward.
  // Total income = $50k - $2k = $48k. Std ded $14,600. Taxable $33,400.
  // Tax = $1,160 + ($33,400 - $11,600) × 0.12 = $3,776.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: -2000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("Total income $48,000 (after $2k loss)", r.totalIncome, 48000, 1);
  check("Capital loss deducted = $2,000", r.capitalLossDeducted, 2000);
  checkExact("No short carryforward", r.capitalLossCarryforwardShort, 0);
  checkExact("No long carryforward", r.capitalLossCarryforwardLong, 0);
  check("Net cap loss = -$2,000", r.netCapitalGainLoss, -2000);
  check("Federal tax $3,776", r.federalTaxLiability, 3776, 2);
}

header("Capital loss — net loss > $3k cap, with short + long carryforward");
{
  // Single, $50k W-2, $5k LTCL + $2k STCL → -$7k net.
  // $3k cap consumed: short first ($2k), then long ($1k).
  // Carryforward: short $0, long $4,000. Net = -$7k.
  // Total income = $50k - $3k = $47k.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: -5000, shortTermGainLoss: -2000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("Total income = $47,000 ($50k - $3k cap)", r.totalIncome, 47000, 1);
  check("Capital loss deducted = $3,000 (cap)", r.capitalLossDeducted, 3000);
  checkExact("Short carryforward = $0 (short consumed first)", r.capitalLossCarryforwardShort, 0);
  check("Long carryforward = $4,000 ($5k - $1k applied)", r.capitalLossCarryforwardLong, 4000);
  check("Net cap loss = -$7,000", r.netCapitalGainLoss, -7000);
}

header("Capital loss — MFS $1,500 cap");
{
  // MFS gets half the cap. Same -$7k loss → $1,500 deducted, $5,500 carryforward.
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: -5000, shortTermGainLoss: -2000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("MFS cap loss deducted = $1,500", r.capitalLossDeducted, 1500);
  checkExact("MFS short carryforward = $500 ($2k - $1.5k applied)", r.capitalLossCarryforwardShort, 500);
  check("MFS long carryforward = $5,000 (no LT consumed)", r.capitalLossCarryforwardLong, 5000);
}

header("Capital loss — cross-netting STCG vs LTCL");
{
  // STCG $3,000 + LTCL -$1,000. Cross-net: long loss offsets short gain → STCG $2,000 net.
  // No cap loss deduction (net positive).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", shortTermGainLoss: 3000, longTermGainLoss: -1000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("Cross-net STCG -$1k LT loss = $2,000 STCG", r.netCapitalGainLoss, 2000);
  checkExact("No cap loss deduction (net gain)", r.capitalLossDeducted, 0);
  check("Total income $52,000 ($50k + $2k STCG)", r.totalIncome, 52000, 1);
}

header("Capital loss — cross-netting LTCG vs STCL");
{
  // LTCG $4,000 + STCL -$3,000. Cross-net: short loss offsets long gain.
  // Net: $1,000 LTCG (preserves long character).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", shortTermGainLoss: -3000, longTermGainLoss: 4000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("Net cap gain = $1,000 LTCG after cross-net", r.netCapitalGainLoss, 1000);
  check("Preferential income includes $1k LTCG", r.preferentialIncome, 1000);
}

header("Capital loss — prior year carryforward via adjustment");
{
  // Prior year carryforward: $5k long + $2k short. This year: $1k LTCG.
  // After carryforward applied:
  //   netSTCG = 0 - $2,000 = -$2,000
  //   netLTCG = $1,000 - $5,000 = -$4,000
  // Cross-netting: both negative, no swap.
  // netTotal = -$6,000. $3k cap consumed: short first ($2k), then long ($1k).
  // Carryforward: short $0, long $3,000 ($4k LT loss - $1k consumed).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 10000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", longTermGainLoss: 1000 }],
    adjustments: [
      { adjustmentType: "capital_loss_carryforward_long", amount: 5000, isApplied: true },
      { adjustmentType: "capital_loss_carryforward_short", amount: 2000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("Net after prior year carryforward = -$6,000", r.netCapitalGainLoss, -6000);
  check("Cap loss deducted = $3,000", r.capitalLossDeducted, 3000);
  checkExact("Short carryforward to next year = $0", r.capitalLossCarryforwardShort, 0);
  check("Long carryforward to next year = $3,000", r.capitalLossCarryforwardLong, 3000);
}

// ════════════════════════════════════════════════════════════════════════════
// STATE RETIREMENT-INCOME EXEMPTION (PA, IL, MS)
// ════════════════════════════════════════════════════════════════════════════
header("State retirement exemption — PA (age-gated)");
{
  // PA exempts qualified retirement at age 59½+ (we use 60).
  // Filer age 65, $30k 1099-R distribution. PA should exempt all $30k.
  // PA flat rate 3.07%. Without exemption: tax on AGI $30k = $921.
  // With exemption: tax on $0 = $0.
  const r1 = getStateRetirementExemption({ stateCode: "PA", retirementIncome: 30000, taxpayerAge: 65 });
  check("PA age 65 → $30k exempt", r1.exemption, 30000);

  const r2 = getStateRetirementExemption({ stateCode: "PA", retirementIncome: 30000, taxpayerAge: 55 });
  checkExact("PA age 55 (below 60) → $0 exempt", r2.exemption, 0);

  // Verify it flows through calculateStateTax
  const taxWithExemption = calculateStateTax(30000, "PA", "single", 2024, {
    retirementIncomeForExemption: 30000,
    taxpayerAge: 65,
  });
  checkExact("PA state tax with exemption = $0", taxWithExemption, 0);

  const taxWithoutExemption = calculateStateTax(30000, "PA", "single", 2024, {
    retirementIncomeForExemption: 30000,
    taxpayerAge: 55,
  });
  check("PA state tax without exemption (age 55)", taxWithoutExemption, 30000 * 0.0307, 0.01);
}

header("State retirement exemption — IL (no age requirement)");
{
  // IL exempts qualified retirement at any age. IL flat rate 4.95%.
  // $30k retirement income at any age → full exempt.
  const r1 = getStateRetirementExemption({ stateCode: "IL", retirementIncome: 30000, taxpayerAge: 35 });
  check("IL age 35 → $30k exempt (no age req)", r1.exemption, 30000);

  // IL has no std deduction by default in our data; need to verify
  // The state tax calc applies retirement exemption → AGI - exempt = $0 → tax $0
  const taxWithExemption = calculateStateTax(30000, "IL", "single", 2024, {
    retirementIncomeForExemption: 30000,
    taxpayerAge: 35,
  });
  checkExact("IL state tax with full retirement exemption = $0", taxWithExemption, 0);
}

header("State retirement exemption — MS age-gated");
{
  // MS exempts qualified retirement at age 59½+ (we use 60). MS flat 4.7% in 2024.
  const r1 = getStateRetirementExemption({ stateCode: "MS", retirementIncome: 20000, taxpayerAge: 62 });
  check("MS age 62 → $20k exempt", r1.exemption, 20000);

  const r2 = getStateRetirementExemption({ stateCode: "MS", retirementIncome: 20000, taxpayerAge: 50 });
  checkExact("MS age 50 (below 60) → $0 exempt", r2.exemption, 0);
}

header("State retirement exemption — other state (no rule) → $0");
{
  const r = getStateRetirementExemption({ stateCode: "CA", retirementIncome: 30000, taxpayerAge: 65 });
  checkExact("CA → $0 exempt (no state rule)", r.exemption, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// END-TO-END: PA retiree with 1099-R should pay $0 PA tax
// ════════════════════════════════════════════════════════════════════════════
header("End-to-end: PA retiree with 1099-R retirement income");
{
  // PA filer age 70, no wages, $40k 1099-R distribution.
  // Federal: AGI = $40k. Std ded single 2024 = $14,600 (extra std ded for 65+ = $1,950)
  // For now, we don't model extra std ded for 65+, so use base $14,600.
  // Taxable = $25,400. Tax = $1,160 + ($25,400 - $11,600) × 0.12 = $2,816.
  // State (PA): retirement income exempt → $0 PA tax.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "PA", taxYear: 2024, taxpayerAge: 70 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "r", taxableAmount: 40000 }],
    adjustments: [],
    taxYear: 2024,
  });
  check("AGI $40,000", r.adjustedGrossIncome, 40000, 1);
  check("Federal tax ~$2,816", r.federalTaxLiability, 2816, 2);
  check("PA state tax = $0 (retirement exempt)", r.stateTaxLiability, 0, 0.01);
  check("State retirement exemption = $40,000", r.stateRetirementExemption, 40000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// MULTI-STATE — reciprocity table
// ════════════════════════════════════════════════════════════════════════════
header("Multi-state — reciprocity table");
{
  checkExact("NJ resident working in PA → reciprocity (PA doesn't tax)", hasReciprocity("NJ", "PA"), true);
  checkExact("PA resident working in NJ → reciprocity (NJ doesn't tax)", hasReciprocity("PA", "NJ"), true);
  checkExact("IL resident working in WI → reciprocity", hasReciprocity("IL", "WI"), true);
  checkExact("IL resident working in CA → NO reciprocity", hasReciprocity("IL", "CA"), false);
  checkExact("MD resident working in DC → reciprocity", hasReciprocity("MD", "DC"), true);
  checkExact("MD resident working in VA → reciprocity", hasReciprocity("MD", "VA"), true);
  checkExact("PA resident working in WV → reciprocity", hasReciprocity("PA", "WV"), true);
  checkExact("CA resident working in NY → NO reciprocity (CA not in table)", hasReciprocity("CA", "NY"), false);
  checkExact("Case insensitive", hasReciprocity("nj", "pa"), true);
}

// ════════════════════════════════════════════════════════════════════════════
// MULTI-STATE — calculateMultiStateTax
// ════════════════════════════════════════════════════════════════════════════
header("Multi-state — NJ resident commuting to PA (reciprocity)");
{
  // NJ resident, $100k all wages from PA employer.
  // Reciprocity: PA doesn't tax. NJ taxes full $100k.
  // NJ 2024 single brackets: 1.4% to $20k, 1.75% to $35k, 3.5% to $40k, 5.525% to $75k, 6.37% to $500k, 8.97% to $1M, 10.75% above.
  // Tax: 20000×0.014 + (35000-20000)×0.0175 + (40000-35000)×0.035 + (75000-40000)×0.05525 + (100000-75000)×0.0637
  //    = 280 + 262.50 + 175 + 1933.75 + 1592.50 = $4,243.75
  // NJ has $1,000 std ded for single — actually NJ has no std ded; we have 0 in our data probably.
  // Let me just verify with calculateStateTax to get the actual NJ tax for $100k AGI.
  const njDirectTax = calculateStateTax(100000, "NJ", "single", 2024);

  const r = calculateMultiStateTax({
    residentState: "NJ",
    federalAgi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "PA", wages: 100000 }],
  });

  checkExact("PA non-resident tax = $0 (reciprocity)", r.nonresidentStateTaxes[0]?.tax ?? -1, 0);
  checkExact("PA reciprocityApplied = true", r.nonresidentStateTaxes[0]?.reciprocityApplied ?? false, true);
  check("NJ resident tax = full NJ liability (no credit needed)", r.residentStateTax, njDirectTax, 1);
  check("Total state tax = NJ tax", r.totalStateTax, njDirectTax, 1);
  checkExact("Resident credit applied = $0 (reciprocity)", r.residentCreditApplied, 0);
}

header("Multi-state — NJ resident commuting to NY (no reciprocity, credit applies)");
{
  // NJ resident, $100k all wages from NY employer.
  // NY 2024 single brackets are progressive ~4% to 10.9%. NY tax on $100k ≈ ?
  // NJ resident tax on $100k AGI = njFullTax.
  // Credit: NJ gives credit for NY tax paid, capped at NJ's tax on the same income.
  // For all wages = AGI, the credit cap is the full NJ tax → credit = min(NY tax, NJ tax).
  // Net resident NJ tax = max(0, NJ tax - credit). Total = NJ + NY = NJ + NY-credit-applied at NY level.
  // Actually: totalStateTax = residentStateTax (post-credit) + sum(NR taxes)
  //   = (NJ - min(NY, NJ)) + NY
  //   = If NY ≤ NJ: (NJ - NY) + NY = NJ
  //   = If NY > NJ: 0 + NY = NY
  // So total = max(NJ, NY) when all wages from NY.

  const nyTax = calculateStateTax(100000, "NY", "single", 2024);
  const njFullTax = calculateStateTax(100000, "NJ", "single", 2024);

  const r = calculateMultiStateTax({
    residentState: "NJ",
    federalAgi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 100000 }],
  });

  check("NY non-resident tax matches calculateStateTax(NY)", r.nonresidentStateTaxes[0].tax, nyTax, 1);
  checkExact("NY reciprocityApplied = false", r.nonresidentStateTaxes[0]?.reciprocityApplied ?? true, false);
  check("Total state tax = max(NJ, NY) when 100% from NY", r.totalStateTax, Math.max(njFullTax, nyTax), 1);
}

header("Multi-state — Partial NR allocation (50% CA, 50% TX)");
{
  // CA resident, $100k W-2: $50k CA-sourced + $50k TX-sourced.
  // TX: no income tax. CA: taxes worldwide $100k AGI.
  // No NR tax (TX = $0). No credit needed.
  const caFullTax = calculateStateTax(100000, "CA", "single", 2024);
  const r = calculateMultiStateTax({
    residentState: "CA",
    federalAgi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [
      { stateCode: "CA", wages: 50000 },
      { stateCode: "TX", wages: 50000 },
    ],
  });
  // CA wages omitted from NR allocation (resident state); only TX is in the NR list.
  const txEntry = r.nonresidentStateTaxes.find((s) => s.state === "TX");
  checkExact("TX NR tax = $0 (no income tax)", txEntry?.tax ?? -1, 0);
  check("Total state tax = full CA tax", r.totalStateTax, caFullTax, 1);
}

header("Multi-state — TX resident with CA-sourced W-2 (no reciprocity)");
{
  // TX resident (no income tax), $100k W-2 from CA employer.
  // CA NR taxes the $100k. TX resident tax = $0. No credit.
  // Total = CA NR tax.
  const caTax = calculateStateTax(100000, "CA", "single", 2024);
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "CA", wages: 100000 }],
  });
  check("CA NR tax = full CA tax on $100k", r.nonresidentStateTaxes[0].tax, caTax, 1);
  checkExact("TX resident tax = $0", r.residentStateTax, 0);
  check("Total state tax = CA NR amount", r.totalStateTax, caTax, 1);
  checkExact("No resident credit (TX has no tax to credit against)", r.residentCreditApplied, 0);
}

header("Multi-state — Two non-resident states + resident");
{
  // CA resident, $150k W-2 split: $50k CA + $60k NY + $40k OR.
  // NY NR tax on $60k. OR NR tax on $40k.
  // CA resident tax on $150k AGI. Credit-for-tax-paid limited to CA's share.
  const r = calculateMultiStateTax({
    residentState: "CA",
    federalAgi: 150000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [
      { stateCode: "CA", wages: 50000 },
      { stateCode: "NY", wages: 60000 },
      { stateCode: "OR", wages: 40000 },
    ],
  });
  checkExact("2 non-resident states tracked", r.nonresidentStateTaxes.length, 2);
  if (r.totalStateTax > 0) PASS.push(`✓ Total state tax = $${r.totalStateTax.toFixed(2)} (CA resident + NY/OR NR)`);
  else FAIL.push(`✗ Total state tax should be positive, got $${r.totalStateTax}`);
  if (r.residentCreditApplied > 0) PASS.push(`✓ Resident credit applied (CA credits NY/OR tax): $${r.residentCreditApplied.toFixed(2)}`);
  else FAIL.push(`✗ Resident credit should be > 0 when CA gets NR tax credit`);
}

header("End-to-end multi-state — NJ resident, PA wages (reciprocity)");
{
  // NJ resident, $80k W-2 with PA stateCode.
  // Federal: AGI $80k, std ded $14,600, taxable $65,400.
  //   Tax = $1,160 + ($47,150-$11,600)×0.12 + ($65,400-$47,150)×0.22 = $9,441.
  // State: PA reciprocity → PA = $0. NJ taxes full $80k worldwide.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "NJ", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9000, stateCode: "PA" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  });
  check("Federal tax $9,441", r.federalTaxLiability, 9441, 2);
  // NJ tax on $80k single — verify via direct call
  const njDirectTax = calculateStateTax(80000, "NJ", "single", 2024);
  check("State tax = NJ tax on $80k (reciprocity gives no credit needed)", r.stateTaxLiability, njDirectTax, 1);
  checkExact("PA reciprocity reflected in multi-state breakdown", r.multiState.nonresidentStateTaxes[0]?.reciprocityApplied ?? false, true);
}

// ════════════════════════════════════════════════════════════════════════════
// MACRS DEPRECIATION (27.5yr residential, 39yr commercial, mid-month)
// ════════════════════════════════════════════════════════════════════════════
header("MACRS — Residential rental, placed in January (first year)");
{
  // $275,000 basis, residential 27.5yr SL, placed in service Jan 2024.
  // First year mid-month: (12.5 - 1) / 12 = 11.5/12 = 0.9583.
  // Annual dep = 275000 / 27.5 = $10,000.
  // First year = $10,000 × 0.9583 = $9,583.33.
  // Per IRS Table A-6 January: 3.485% × $275,000 = $9,583.75 — close (rounding).
  const r = calculateMacrsDepreciation({
    basis: 275000,
    propertyType: "residential",
    monthPlacedInService: 1,
    yearPlacedInService: 2024,
    taxYear: 2024,
  });
  check("Y1 January residential ≈ $9,583.33", r.currentYearDepreciation, 9583.33, 1);
  check("Accumulated = Y1 dep", r.accumulatedDepreciation, 9583.33, 1);
  check("Remaining basis ≈ $265,417", r.remainingBasis, 275000 - 9583.33, 1);
}

header("MACRS — Residential, placed in June (mid-year)");
{
  // $275,000 basis, residential, placed in service Jun 2024.
  // Y1: (12.5 - 6) / 12 = 6.5/12 = 0.5417. Dep = $10,000 × 0.5417 = $5,416.67.
  // IRS Table A-6 June: 1.970% × $275,000 = $5,417.50 ≈
  const r = calculateMacrsDepreciation({
    basis: 275000,
    propertyType: "residential",
    monthPlacedInService: 6,
    yearPlacedInService: 2024,
    taxYear: 2024,
  });
  check("Y1 June residential ≈ $5,416.67", r.currentYearDepreciation, 5416.67, 1);
}

header("MACRS — Residential, Y2 (full year)");
{
  // $275,000 basis, placed Jan 2024. Compute Y2 (2025).
  // Y1 = $9,583.33. Y2 = $10,000 (full annual).
  // Accumulated through Y2 = $9,583.33 + $10,000 = $19,583.33.
  const r = calculateMacrsDepreciation({
    basis: 275000,
    propertyType: "residential",
    monthPlacedInService: 1,
    yearPlacedInService: 2024,
    taxYear: 2025,
  });
  check("Y2 = $10,000 full year", r.currentYearDepreciation, 10000, 1);
  check("Accumulated = $19,583.33", r.accumulatedDepreciation, 19583.33, 1);
}

header("MACRS — Commercial 39yr, Y1 March");
{
  // $390,000 basis, commercial 39yr, placed in service March 2024.
  // Annual dep = $10,000 (= 390000 / 39).
  // Y1: (12.5 - 3) / 12 = 9.5/12 = 0.7917. Dep = $10,000 × 0.7917 = $7,916.67.
  const r = calculateMacrsDepreciation({
    basis: 390000,
    propertyType: "commercial",
    monthPlacedInService: 3,
    yearPlacedInService: 2024,
    taxYear: 2024,
  });
  check("Y1 March commercial ≈ $7,916.67", r.currentYearDepreciation, 7916.67, 1);
  checkExact("Recovery years = 39", r.recoveryYears, 39);
}

header("MACRS — Not yet in service (future year placed)");
{
  // Placed in 2025, asking for 2024 → $0.
  const r = calculateMacrsDepreciation({
    basis: 275000,
    propertyType: "residential",
    monthPlacedInService: 1,
    yearPlacedInService: 2025,
    taxYear: 2024,
  });
  checkExact("Y(-1) → $0 dep", r.currentYearDepreciation, 0);
  checkExact("Accumulated = $0", r.accumulatedDepreciation, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// §469 PASSIVE ACTIVITY LOSS ALLOWANCE
// ════════════════════════════════════════════════════════════════════════════
header("§469 PAL — Active participant, MAGI < $100k, full $25k allowance");
{
  // Loss $15,000, active participant, MAGI $80k. Below $100k phase-out start.
  // Allowance = min($15k, $25k cap) = $15,000. All deductible.
  const r = calculatePassiveActivityLossAllowance({
    rentalLoss: 15000,
    modifiedAgi: 80000,
    filingStatus: "single",
    isActiveParticipant: true,
    isRealEstateProfessional: false,
  });
  check("Allowance cap = $25,000", r.allowanceCap, 25000);
  check("Allowance after phase-out = $25,000 (no phase-out)", r.allowanceAfterPhaseOut, 25000);
  check("Allowed this year = $15,000 (full loss)", r.allowedThisYear, 15000);
  checkExact("Suspended = $0", r.suspendedToNextYear, 0);
}

header("§469 PAL — Active, MAGI $125k (mid phase-out)");
{
  // Loss $20k, active, MAGI $125k. Phase-out: ($125k - $100k) × 0.5 = $12,500 reduction.
  // Allowance = $25,000 - $12,500 = $12,500. Allowed = min($20k, $12,500) = $12,500.
  // Suspended = $20,000 - $12,500 = $7,500.
  const r = calculatePassiveActivityLossAllowance({
    rentalLoss: 20000,
    modifiedAgi: 125000,
    filingStatus: "single",
    isActiveParticipant: true,
    isRealEstateProfessional: false,
  });
  check("Allowance after phase-out = $12,500", r.allowanceAfterPhaseOut, 12500);
  check("Allowed this year = $12,500", r.allowedThisYear, 12500);
  check("Suspended = $7,500", r.suspendedToNextYear, 7500);
}

header("§469 PAL — Active, MAGI $150k+ (fully phased out)");
{
  const r = calculatePassiveActivityLossAllowance({
    rentalLoss: 20000,
    modifiedAgi: 150000,
    filingStatus: "single",
    isActiveParticipant: true,
    isRealEstateProfessional: false,
  });
  checkExact("Fully phased out at $150k", r.allowanceAfterPhaseOut, 0);
  checkExact("Allowed = $0", r.allowedThisYear, 0);
  check("All $20k suspended", r.suspendedToNextYear, 20000);
}

header("§469 PAL — Real estate professional (no limit)");
{
  const r = calculatePassiveActivityLossAllowance({
    rentalLoss: 100000,
    modifiedAgi: 500000,
    filingStatus: "single",
    isActiveParticipant: true,
    isRealEstateProfessional: true,
  });
  check("RE pro → full $100k deductible", r.allowedThisYear, 100000);
  checkExact("Nothing suspended", r.suspendedToNextYear, 0);
}

header("§469 PAL — Not active, not pro (full suspension)");
{
  const r = calculatePassiveActivityLossAllowance({
    rentalLoss: 10000,
    modifiedAgi: 50000,
    filingStatus: "single",
    isActiveParticipant: false,
    isRealEstateProfessional: false,
  });
  checkExact("Not active → no allowance", r.allowedThisYear, 0);
  check("All $10k suspended", r.suspendedToNextYear, 10000);
}

header("§469 PAL — MFS active participant (halved allowance)");
{
  // MFS gets $12,500 cap and $50k-$75k phase-out.
  const r = calculatePassiveActivityLossAllowance({
    rentalLoss: 8000,
    modifiedAgi: 60000,
    filingStatus: "married_filing_separately",
    isActiveParticipant: true,
    isRealEstateProfessional: false,
  });
  check("MFS cap = $12,500", r.allowanceCap, 12500);
  // Phase-out at MAGI $60k: ($60k - $50k) × 0.5 = $5k reduction
  // Allowance = $12,500 - $5,000 = $7,500. Allowed = min($8k, $7.5k) = $7,500.
  check("MFS allowance after phase-out = $7,500", r.allowanceAfterPhaseOut, 7500);
  check("MFS allowed = $7,500", r.allowedThisYear, 7500);
  check("MFS suspended = $500", r.suspendedToNextYear, 500);
}

// ════════════════════════════════════════════════════════════════════════════
// END-TO-END: Schedule E rental with depreciation + §469 PAL
// ════════════════════════════════════════════════════════════════════════════
header("End-to-end Schedule E — rental loss within $25k allowance");
{
  // Single, $60k W-2. Rental: $20k income, $12k expenses, $10k depreciation.
  // Gross rental net = $20k - $12k - $10k = -$2k loss.
  // Active participant, MAGI ~$60k → full $25k allowance. Loss fully deductible.
  // AGI = $60k + (-$2k) = $58k.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, rentalActiveParticipant: true },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 6000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "schedule_e_rental_income", amount: 20000, isApplied: true },
      { adjustmentType: "schedule_e_rental_expenses", amount: 12000, isApplied: true },
      { adjustmentType: "schedule_e_macrs_depreciation", amount: 10000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("Gross rental net = -$2,000", r.scheduleERentalGrossNet, -2000);
  check("Rental applied to AGI = -$2,000 (fully allowed)", r.scheduleERentalAppliedToAgi, -2000);
  check("Total income = $58,000 (after rental loss)", r.totalIncome, 58000, 1);
  checkExact("No suspended losses", r.scheduleEPassiveLossSuspended, 0);
}

header("End-to-end Schedule E — high-income filer, loss suspended");
{
  // Single, $160k W-2 + $10k rental loss.
  // MAGI for §469 ≈ AGI before rental ≈ $160k. Fully phased out at $150k.
  // Allowance = $0. All $10k suspended.
  // AGI = $160k (no deduction).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, rentalActiveParticipant: true },
    w2s: [{ taxYear: 2024, wagesBox1: 160000, federalTaxWithheldBox2: 25000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "schedule_e_rental_income", amount: 5000, isApplied: true },
      { adjustmentType: "schedule_e_rental_expenses", amount: 8000, isApplied: true },
      { adjustmentType: "schedule_e_macrs_depreciation", amount: 7000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("Gross rental net = -$10,000", r.scheduleERentalGrossNet, -10000);
  checkExact("Rental applied to AGI = $0 (fully phased out)", r.scheduleERentalAppliedToAgi, 0);
  check("Suspended loss = $10,000", r.scheduleEPassiveLossSuspended, 10000);
  check("Total income = $160,000 (unchanged)", r.totalIncome, 160000, 1);
}

header("End-to-end Schedule E — rental NET INCOME (positive)");
{
  // Rental net positive — flows directly to AGI, no PAL limit.
  // Single $50k W-2 + $3k rental net income.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "schedule_e_rental_income", amount: 15000, isApplied: true },
      { adjustmentType: "schedule_e_rental_expenses", amount: 8000, isApplied: true },
      { adjustmentType: "schedule_e_macrs_depreciation", amount: 4000, isApplied: true },
    ],
    taxYear: 2024,
  });
  check("Gross rental net = +$3,000", r.scheduleERentalGrossNet, 3000);
  check("Rental applied to AGI = +$3,000 (positive, no limit)", r.scheduleERentalAppliedToAgi, 3000);
  check("Total income = $53,000", r.totalIncome, 53000, 1);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log("\n══════════════════════ Phase 2 Test Summary ══════════════════════");
console.log(`PASS: ${PASS.length}`);
console.log(`FAIL: ${FAIL.length}`);
if (FAIL.length > 0) {
  console.log("\nFailures:");
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
} else {
  console.log("\n✓ All Phase 2 unit tests pass");
}
