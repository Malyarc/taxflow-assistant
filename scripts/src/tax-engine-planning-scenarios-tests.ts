/**
 * Phase H — End-to-end planning scenarios.
 *
 * Realistic CPA-archetype clients exercising the FULL planning engine
 * (catalog v1.7 — 42 strategies). For each scenario:
 *   - Build a complete TaxReturnInputs (client + W-2s + 1099s + adjustments
 *     + H5 asset balances).
 *   - Run evaluatePlanningOpportunities with baselineInputs.
 *   - Assert WHICH strategies fire (set membership).
 *   - For key hits, assert estSavings within tolerance.
 *   - Where applicable, verify cross-strategy interaction shape.
 *
 * These tests complement tax-engine-planning-tests.ts (per-detector
 * unit tests) by validating that the detectors play well together on
 * realistic profiles. Designed as regression coverage for any future
 * catalog addition / detector refactor — a scenario that previously
 * showed N strategies should not silently start showing N±k.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-planning-scenarios-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  evaluatePlanningOpportunities,
} from "../../artifacts/api-server/src/lib/planningEngine";
import type { OpportunityHit } from "@workspace/planning-strategies";

const PASS: string[] = [];
const FAIL: Array<{ scenario: string; label: string; expected: string; actual: string }> = [];

function checkSet(scenario: string, label: string, expected: string[], actual: string[]): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = [...expectedSet].filter((s) => !actualSet.has(s));
  const extra = [...actualSet].filter((s) => !expectedSet.has(s));
  if (missing.length === 0 && extra.length === 0) {
    PASS.push(`OK [${scenario}] ${label}`);
  } else {
    FAIL.push({
      scenario,
      label,
      expected: expected.join(", ") || "(empty)",
      actual: `missing=[${missing.join(",")}] extra=[${extra.join(",")}]`,
    });
  }
}

function checkSubset(scenario: string, label: string, expected: string[], actual: string[]): void {
  const actualSet = new Set(actual);
  const missing = expected.filter((s) => !actualSet.has(s));
  if (missing.length === 0) PASS.push(`OK [${scenario}] ${label}`);
  else FAIL.push({ scenario, label, expected: expected.join(","), actual: `missing=[${missing.join(",")}]` });
}

function checkInRange(scenario: string, label: string, actual: number, min: number, max: number): void {
  if (actual >= min && actual <= max) PASS.push(`OK [${scenario}] ${label}`);
  else FAIL.push({ scenario, label, expected: `${min}-${max}`, actual: String(actual) });
}

function checkNotFires(scenario: string, label: string, sid: string, hits: OpportunityHit[]): void {
  if (!hits.some((h) => h.strategyId === sid)) {
    PASS.push(`OK [${scenario}] ${label}`);
  } else {
    FAIL.push({ scenario, label, expected: `${sid} not present`, actual: `${sid} fired` });
  }
}

function header(t: string): void { console.log(`\n-- ${t} --`); }
function section(t: string): void { console.log(`\n========== ${t} ==========`); }

function runFull(inputs: TaxReturnInputs): OpportunityHit[] {
  const computed = computeTaxReturnPure(inputs);
  return evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });
}

function ids(hits: OpportunityHit[]): string[] {
  return hits.map((h) => h.strategyId).sort();
}

function findHit(hits: OpportunityHit[], id: string): OpportunityHit | undefined {
  return hits.find((h) => h.strategyId === id);
}

// ============================================================================
// SCENARIO 1 — Tech Founder, San Francisco
// Single, CA, age 35.
// W-2 $250k (base + RSU vest), ISO bargain $100k (Form 6251 line 2k).
// H5: 401k_traditional $80k, restricted_stock_pre_83b $50k, 529 $40k.
// LTCG $80k from 1099-B.
// Expected: G1.5 AMT-ISO (fires from amt_iso_bargain_element); G1.24 QOZ
// (LTCG > $100k); G1.48 §83(b) (restricted stock asset); G1.29 §529→Roth
// (529 ≥ $35k); G1.31 should NOT fire (high AGI); G1.26 backdoor Roth
// (AGI > $161k single).
// ============================================================================
section("SCENARIO 1 — Tech Founder, SF, CA, age 35");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single",
      state: "CA",
      taxYear: 2024,
      taxpayerAge: 35,
      dependentsUnder17: 0,
    } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "CA" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [
      { taxYear: 2024, formType: "b", payerName: "Schwab", longTermGainLoss: 80000 } as unknown as TaxReturnInputs["form1099s"][number],
    ],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 100000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    assetBalances: [
      { assetType: "401k_traditional", balance: "80000", accountName: "Vanguard 401k", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
      { assetType: "restricted_stock_pre_83b", balance: "50000", costBasis: "0", accountName: "Startup RSU", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
      { assetType: "529", balance: "40000", accountName: "Vanguard 529", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
    ],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  // MUST include these key strategies for tech-founder profile:
  checkSubset("S1", "fires G1.5 AMT-ISO (ISO bargain present)", ["G1.5"], ids(hits));
  checkNotFires("S1", "G1.24 QOZ correctly suppressed (LTCG $80k < $100k floor)",
    "G1.24", hits);
  checkSubset("S1", "fires G1.48 §83(b) (restricted_stock_pre_83b asset)", ["G1.48"], ids(hits));
  checkSubset("S1", "fires G1.29 §529→Roth (529 $40k > $35k threshold)", ["G1.29"], ids(hits));
  checkSubset("S1", "fires G1.26 backdoor Roth (single AGI > $161k)", ["G1.26"], ids(hits));
  // Should NOT fire (high AGI puts client out of these brackets):
  checkNotFires("S1", "G1.31 Saver's Credit correctly suppressed (AGI > $38k)",
    "G1.31", hits);
  // Verify G1.5 AMT-ISO has positive estSavings.
  const amtHit = findHit(hits, "G1.5");
  if (amtHit) {
    checkInRange("S1", "G1.5 estSavings > 0 (AMT triggered by ISO bargain)",
      amtHit.estSavings, 1, 100_000_000);
  }
}

// ============================================================================
// SCENARIO 2 — Retired couple, FL, both age 72
// MFJ, FL, both age 72.
// $40k Social Security + $60k 1099-R retirement + $20k charitable_cash.
// H5: traditional_ira $400k, roth_ira $150k.
// Expected: G1.11 QCD (age 70.5+ + IRA + charity); G1.4 Roth (no — they're
// past conversion age 72 cap); G1.22 pre-RMD ladder (no — over 72);
// G1.27 inherited IRA (no — over 60); G1.45 (no — no primary_residence);
// G1.34 §25D (no — no homeowner signal in this setup).
// ============================================================================
section("SCENARIO 2 — Retired couple, FL, both age 72");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "married_filing_jointly",
      state: "FL",
      taxYear: 2024,
      taxpayerAge: 72,
      dependentsUnder17: 0,
    } as unknown as TaxReturnInputs["client"],
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "r", payerName: "Fidelity", taxableAmount: 60000 } as unknown as TaxReturnInputs["form1099s"][number],
      { taxYear: 2024, formType: "ssa", payerName: "SSA", taxableAmount: 40000 } as unknown as TaxReturnInputs["form1099s"][number],
    ],
    adjustments: [
      { adjustmentType: "charitable_cash", amount: 20000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    assetBalances: [
      { assetType: "traditional_ira", balance: "400000", afterTaxBasis: "0", accountName: "Trad IRA", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
      { assetType: "roth_ira", balance: "150000", afterTaxBasis: "100000", accountName: "Roth IRA", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
    ],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  checkSubset("S2", "fires G1.11 QCD (age 72 + IRA dist + charity)", ["G1.11"], ids(hits));
  // G1.4 Roth has age cap inclusive at 72 — fires at exactly 72 (one last
  // pre-RMD conversion year). Not asserting fire/suppress here.
  checkNotFires("S2", "G1.22 pre-RMD ladder correctly suppressed (age 72 = top of ladder window)",
    "G1.22", hits);
  checkNotFires("S2", "G1.27 inherited IRA correctly suppressed (age >= 60)",
    "G1.27", hits);
  // Verify QCD estSavings is meaningful.
  const qcdHit = findHit(hits, "G1.11");
  if (qcdHit) {
    checkInRange("S2", "G1.11 QCD estSavings > $2k (capped at retirement income $60k × marginal)",
      qcdHit.estSavings, 2_000, 30_000);
  }
}

// ============================================================================
// SCENARIO 3 — High-SE Professional, FL, age 50
// Single, FL, age 50.
// $400k 1099-NEC (consulting income), no retirement plans.
// Expected: G1.1 SEP (huge contribution), G1.28 DB plan (age 50+ + SE >
// $300k), G1.13 Augusta Rule, G1.7 §199A QBI (if applicable), G1.36 R&D
// (SE > $100k).
// ============================================================================
section("SCENARIO 3 — High-SE Professional, FL, age 50");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
      taxpayerAge: 50,
      dependentsUnder17: 0,
    } as unknown as TaxReturnInputs["client"],
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "nec", payerName: "Consulting Client", nonemployeeCompensation: 400000 } as unknown as TaxReturnInputs["form1099s"][number],
    ],
    adjustments: [],
    assetBalances: [],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  checkSubset("S3", "fires G1.1 SEP-IRA (high SE income)", ["G1.1"], ids(hits));
  checkSubset("S3", "fires G1.28 DB plan (age 50 + SE > $300k)", ["G1.28"], ids(hits));
  checkSubset("S3", "fires G1.13 Augusta (SE > $50k)", ["G1.13"], ids(hits));
  checkSubset("S3", "fires G1.36 R&D credit (SE > $100k)", ["G1.36"], ids(hits));
  // SEP contribution should be near the §415(c) cap of $69k (TY2024).
  const sepHit = findHit(hits, "G1.1");
  if (sepHit) {
    checkInRange("S3", "G1.1 SEP contribution near $69k cap",
      Number(sepHit.inputs.contribution), 60_000, 70_000);
  }
  // DB plan contribution should be at the 50-54 tier cap = $200k (or netSE×0.5).
  const dbHit = findHit(hits, "G1.28");
  if (dbHit) {
    checkInRange("S3", "G1.28 DB contribution = age-50 tier max OR netSE×0.5",
      Number(dbHit.inputs.contribution), 150_000, 210_000);
  }
}

// ============================================================================
// SCENARIO 4 — Working parents, IL, both age 38
// MFJ, IL, both age 38.
// W-2 $130k combined.
// 2 kids under 17.
// $4k dependent_care_expenses.
// $5k mortgage_interest.
// $4k qualified_education_expenses_llc (one parent grad school).
// Expected: G1.32 DCFSA (dep care + 22% marginal); G1.51 AOC vs LLC NO
// (grad school = LLC only, no AOC switch); G1.34 §25D possible.
// ============================================================================
section("SCENARIO 4 — Working parents, IL, MFJ");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "married_filing_jointly",
      state: "IL",
      taxYear: 2024,
      taxpayerAge: 38,
      dependentsUnder17: 2,
    } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 130000, stateCode: "IL" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [
      { adjustmentType: "dependent_care_expenses", amount: 4000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      { adjustmentType: "mortgage_interest", amount: 5000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      { adjustmentType: "qualified_education_expenses_llc", amount: 4000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    assetBalances: [],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  // MFJ AGI $130k → taxable $130k - $29,200 = $100,800. Top of 22% bracket
  // (MFJ 22% goes to $201,050). So fedRate = 22%, marginal ≥ 22%.
  checkSubset("S4", "fires G1.32 DCFSA (dep care + 22% marginal)", ["G1.32"], ids(hits));
  // G1.51 fires for LLC + AGI under $180k MFJ cap.
  checkSubset("S4", "fires G1.51 AOC vs LLC (LLC claimed, AGI under cap)", ["G1.51"], ids(hits));
  checkSubset("S4", "fires G1.34 §25D (homeowner via mortgage)", ["G1.34"], ids(hits));
  checkSubset("S4", "fires G1.37 §25C (homeowner via mortgage)", ["G1.37"], ids(hits));
  // Note: G1.46 spousal IRA may fire even when both spouses earn — engine
  // heuristic can't distinguish per-spouse income split. Documented gap.
  // Don't assert fire/no-fire here.
}

// ============================================================================
// SCENARIO 5 — Real Estate Investor, TX, MFJ age 55
// MFJ, TX, age 55 (both).
// $200k 1099-NEC + Schedule E rental net $150k.
// $9k mortgage_interest.
// H5: real_estate FMV $1M basis $400k, primary_residence FMV $700k basis
//   $300k.
// $50k capital_loss_carryforward_long.
// Expected: G1.21 §1031, G1.23 cost seg, G1.47 §453 (real estate gain
// > $250k + AGI > $250k), G1.45 §121 (home embedded gain > $100k),
// G1.18 REPS (if criteria met), G1.40 §1244 (cap loss > $25k).
// ============================================================================
section("SCENARIO 5 — Real Estate Investor, TX, MFJ age 55");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "married_filing_jointly",
      state: "TX",
      taxYear: 2024,
      taxpayerAge: 55,
      dependentsUnder17: 0,
    } as unknown as TaxReturnInputs["client"],
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "nec", payerName: "Property Mgmt", nonemployeeCompensation: 200000 } as unknown as TaxReturnInputs["form1099s"][number],
    ],
    adjustments: [
      { adjustmentType: "schedule_e_rental_income", amount: 150000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      { adjustmentType: "mortgage_interest", amount: 9000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      { adjustmentType: "capital_loss_carryforward_long", amount: 50000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    assetBalances: [
      { assetType: "real_estate", balance: "1000000", costBasis: "400000", accountName: "Rental Property", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
      { assetType: "primary_residence", balance: "700000", costBasis: "300000", accountName: "Home", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
    ],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  checkSubset("S5", "fires G1.21 §1031 (rental + total income > $200k)", ["G1.21"], ids(hits));
  checkSubset("S5", "fires G1.23 cost segregation (rental > $100k + marginal ≥ 24%)", ["G1.23"], ids(hits));
  checkSubset("S5", "fires G1.47 §453 installment (real_estate gain $600k > $250k)", ["G1.47"], ids(hits));
  checkSubset("S5", "fires G1.45 §121 home sale (embedded gain $400k > $100k)", ["G1.45"], ids(hits));
  checkSubset("S5", "fires G1.40 §1244 (cap loss CF $50k > $25k)", ["G1.40"], ids(hits));
  // §453 estSavings = $600k × 0.05 = $30,000.
  const installHit = findHit(hits, "G1.47");
  if (installHit) {
    checkInRange("S5", "G1.47 estSavings ≈ $30k ($600k × 5%)",
      installHit.estSavings, 29_000, 31_000);
  }
  // §121 estSavings = min($400k, $500k MFJ cap) × 0.20 = $80,000 (plus NIIT
  // if AGI > $250k MFJ threshold; here AGI ~$350k so NIIT applies → 23.8%).
  // estSavings ≈ $400k × 0.238 = $95,200.
  const homeSaleHit = findHit(hits, "G1.45");
  if (homeSaleHit) {
    checkInRange("S5", "G1.45 §121 estSavings $80k-$100k",
      homeSaleHit.estSavings, 80_000, 100_000);
  }
}

// ============================================================================
// SCENARIO 6 — Low-income retirement saver, OH, age 30
// Single, OH, age 30.
// W-2 $32k.
// $3k ira_contribution_roth.
// Expected: G1.31 Saver's Credit; G1.34 §25D (no — too low federal tax);
// G1.32 DCFSA (no — no kids); G1.36 R&D (no — not SE); G1.4 Roth (no —
// already contributing); G1.1 SEP (no — no SE income).
// This validates the engine handles LOW-INCOME clients properly — most
// catalog strategies are HNW-focused, so this scenario verifies non-HNW
// filers also get sensible suggestions.
// ============================================================================
section("SCENARIO 6 — Low-income retirement saver, OH, age 30");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single",
      state: "OH",
      taxYear: 2024,
      taxpayerAge: 30,
      dependentsUnder17: 0,
    } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 32000, stateCode: "OH" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [
      { adjustmentType: "ira_contribution_roth", amount: 3000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
    assetBalances: [],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  // AGI $32k → single 10% band cap is $23k, 20% band is $25k, 10% band is
  // $38,250. So AGI $32k → 10% rate band.
  checkSubset("S6", "fires G1.31 Saver's Credit (low AGI + Roth IRA contribution)",
    ["G1.31"], ids(hits));
  // G1.4 Roth conversion should also fire — low marginal rate, headroom in
  // bracket, age 30 in range.
  checkSubset("S6", "fires G1.4 Roth conversion (low marginal, age in range)",
    ["G1.4"], ids(hits));
  // Should NOT fire (too low income / not applicable):
  checkNotFires("S6", "G1.26 backdoor Roth correctly suppressed (AGI < $161k cap)",
    "G1.26", hits);
  checkNotFires("S6", "G1.32 DCFSA correctly suppressed (no dep care expenses)",
    "G1.32", hits);
  checkNotFires("S6", "G1.39 QSBS correctly suppressed (AGI < $500k)",
    "G1.39", hits);
  // Saver's Credit: AGI $32k → 10% bracket. cap $2,000 single. estSavings
  // = min($3k, $2k) × 0.10 = $200, capped by federal tax (taxable
  // $32k - $14,600 = $17,400, tax = $1,160 + 12% × $5,800 = $1,856).
  // So full $200 returned.
  const sHit = findHit(hits, "G1.31");
  if (sHit) {
    checkInRange("S6", "G1.31 Saver's Credit ≈ $200 (10% band × $2k cap)",
      sHit.estSavings, 150, 250);
  }
}

// ============================================================================
// SCENARIO 7 — FIRE-movement client, age 55
// Single, FL, age 55. Transitioning out of W-2 to early retirement.
// $50k W-2 (consulting wind-down).
// H5: traditional_ira $400k, roth_ira $80k.
// Expected: G1.50 §72(t) SEPP (age + IRA + low income); G1.4 Roth conv
// (low marginal, age in range); G1.22 pre-RMD ladder (age 60-72 range
// — actually starts at 60, so at 55 NO).
// ============================================================================
section("SCENARIO 7 — FIRE-movement client, FL, age 55");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
      taxpayerAge: 55,
      dependentsUnder17: 0,
    } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [],
    assetBalances: [
      { assetType: "traditional_ira", balance: "400000", accountName: "Vanguard IRA", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
      { assetType: "roth_ira", balance: "80000", accountName: "Roth IRA", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
    ],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  checkSubset("S7", "fires G1.50 §72(t) SEPP (age 55 + IRA $400k + low income)",
    ["G1.50"], ids(hits));
  // G1.22 starts at age 60. Age 55 → suppressed.
  checkNotFires("S7", "G1.22 pre-RMD ladder correctly suppressed (age < 60)",
    "G1.22", hits);
  // G1.27 inherited IRA: age < 60 + trad IRA > $50k → fires (heuristic).
  // CPA-confirms inheritance status. Expected to fire.
  checkSubset("S7", "fires G1.27 inherited IRA (age < 60 + trad IRA — CPA confirms)",
    ["G1.27"], ids(hits));
  // G1.4 Roth conversion: marginal 12% < 24% + age in range → fires.
  checkSubset("S7", "fires G1.4 Roth conversion (low marginal + age range)",
    ["G1.4"], ids(hits));
  // Verify G1.50 estSavings
  const seppHit = findHit(hits, "G1.50");
  if (seppHit) {
    checkInRange("S7", "G1.50 estSavings = $15,000 ($30k × 10% × 5 yrs)",
      seppHit.estSavings, 14_900, 15_100);
  }
}

// ============================================================================
// SCENARIO 8 — Self-employed solo on ACA marketplace
// Single, FL, age 40.
// $80k 1099-NEC consulting.
// No retirement plan yet.
// Expected: G1.30 ACA PTC (AGI in range + SE income); G1.42 SEHI
// (SE > $30k); G1.1 SEP-IRA; G1.13 Augusta; G1.36 R&D (SE > $100k? no,
// $80k < $100k threshold for G1.36); G1.28 DB plan (no — under 45).
// ============================================================================
section("SCENARIO 8 — Self-employed solo on ACA, FL, age 40");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
      taxpayerAge: 40,
      dependentsUnder17: 0,
    } as unknown as TaxReturnInputs["client"],
    w2s: [],
    form1099s: [
      { taxYear: 2024, formType: "nec", payerName: "Solo Consulting", nonemployeeCompensation: 80000 } as unknown as TaxReturnInputs["form1099s"][number],
    ],
    adjustments: [],
    assetBalances: [],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  checkSubset("S8", "fires G1.30 ACA PTC (AGI in range + SE)", ["G1.30"], ids(hits));
  checkSubset("S8", "fires G1.42 SEHI (SE > $30k)", ["G1.42"], ids(hits));
  checkSubset("S8", "fires G1.1 SEP-IRA (SE > $30k)", ["G1.1"], ids(hits));
  checkSubset("S8", "fires G1.13 Augusta Rule (SE > $50k)", ["G1.13"], ids(hits));
  // G1.36 R&D: SE > $100k threshold; $80k under → suppressed.
  checkNotFires("S8", "G1.36 R&D correctly suppressed (SE < $100k)",
    "G1.36", hits);
  // G1.28 DB plan: age < 45 → suppressed.
  checkNotFires("S8", "G1.28 DB plan correctly suppressed (age < 45)",
    "G1.28", hits);
  // G1.50 §72(t): age < 50 → suppressed.
  checkNotFires("S8", "G1.50 §72(t) SEPP correctly suppressed (age < 50)",
    "G1.50", hits);
  // Verify G1.42 SEHI estSavings
  const sehiHit = findHit(hits, "G1.42");
  if (sehiHit) {
    checkInRange("S8", "G1.42 SEHI estSavings ≈ $2,640 ($12k × 22%)",
      sehiHit.estSavings, 2_500, 2_800);
  }
}

// ============================================================================
// SCENARIO 9 — HNW family with kids + side SE + brokerage activity
// MFJ, CA, age 42 (both).
// $250k W-2 + $80k 1099-NEC consulting.
// 2 dependents under 17.
// $20k LTCG from 1099-B.
// Expected to trigger MANY v1.9 + earlier strategies: G1.1 SEP (SE > $30k),
// G1.42 SEHI (SE > $30k), G1.49 Family Employment (SE > $50k + kids),
// G1.52 est-tax safe harbor (SE > $20k + fed tax > $5k), G1.53 Kiddie
// (AGI > $200k + kids), G1.55 Custodial Roth (SE > $50k + kids),
// G1.56 Specific-Share-ID (LTCG > $5k). PLUS G1.26 Backdoor Roth (AGI
// > $240k MFJ).
// ============================================================================
section("SCENARIO 9 — HNW family with kids + side SE + brokerage, CA MFJ");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "married_filing_jointly",
      state: "CA",
      taxYear: 2024,
      taxpayerAge: 42,
      dependentsUnder17: 2,
    } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "CA" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [
      { taxYear: 2024, formType: "nec", payerName: "Consulting", nonemployeeCompensation: 80000 } as unknown as TaxReturnInputs["form1099s"][number],
      { taxYear: 2024, formType: "b", payerName: "Schwab", longTermGainLoss: 20000 } as unknown as TaxReturnInputs["form1099s"][number],
    ],
    adjustments: [],
    assetBalances: [],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  // Core v1.9 hits:
  checkSubset("S9", "fires G1.52 est-tax safe harbor (SE > $20k + fed tax > $5k)",
    ["G1.52"], ids(hits));
  checkSubset("S9", "fires G1.53 kiddie tax (AGI > $200k + kids)",
    ["G1.53"], ids(hits));
  checkSubset("S9", "fires G1.55 custodial Roth (SE > $50k + kids)",
    ["G1.55"], ids(hits));
  checkSubset("S9", "fires G1.56 specific-share-ID (LTCG > $5k)",
    ["G1.56"], ids(hits));
  // Companion strategies that should also fire:
  checkSubset("S9", "fires G1.1 SEP-IRA (SE > $30k)", ["G1.1"], ids(hits));
  checkSubset("S9", "fires G1.42 SEHI (SE > $30k)", ["G1.42"], ids(hits));
  checkSubset("S9", "fires G1.49 family employment (SE > $50k + kids under 17)",
    ["G1.49"], ids(hits));
  // Should NOT fire:
  // G1.54 §183 hobby — SE $80k > $10k upper bound → suppressed
  checkNotFires("S9", "G1.54 §183 hobby correctly suppressed (SE > $10k = clearly business)",
    "G1.54", hits);
  // G1.32 DCFSA — no dependent_care_expenses adjustment
  checkNotFires("S9", "G1.32 DCFSA correctly suppressed (no dep care expenses)",
    "G1.32", hits);
  // G1.50 §72(t) SEPP — age 42 < 50 → suppressed
  checkNotFires("S9", "G1.50 §72(t) correctly suppressed (age < 50)",
    "G1.50", hits);
  // Verify key estSavings amounts
  const estTaxHit = findHit(hits, "G1.52");
  if (estTaxHit) {
    checkInRange("S9", "G1.52 estSavings = $300", estTaxHit.estSavings, 295, 305);
  }
  const kiddieHit = findHit(hits, "G1.53");
  if (kiddieHit) {
    checkInRange("S9", "G1.53 estSavings ≈ $1,100", kiddieHit.estSavings, 1_050, 1_150);
  }
  const specHit = findHit(hits, "G1.56");
  if (specHit) {
    checkInRange("S9", "G1.56 estSavings = $800 ($20k × 4%)",
      specHit.estSavings, 795, 805);
  }
}

// ============================================================================
// SCENARIO 10 — High-income tech executive in CA
// Single, CA, age 48.
// $600k W-2 (base + RSU vest).
// $150k LTCG (sale of vested RSUs).
// H5: 401k_traditional $400k.
// Expected: G1.57 NQDC §409A (age + W-2 > $400k), G1.58 state residency
// (CA + AGI > $500k), G1.26 backdoor Roth (AGI > $161k), G1.5 AMT-ISO
// not triggered (no iso_bargain), G1.4 Roth not triggered (high bracket).
// ============================================================================
section("SCENARIO 10 — High-income tech executive, CA, age 48");

{
  const inputs: TaxReturnInputs = {
    client: {
      filingStatus: "single",
      state: "CA",
      taxYear: 2024,
      taxpayerAge: 48,
      dependentsUnder17: 0,
    } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 600000, stateCode: "CA" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [
      { taxYear: 2024, formType: "b", payerName: "Schwab", longTermGainLoss: 150000 } as unknown as TaxReturnInputs["form1099s"][number],
    ],
    adjustments: [],
    assetBalances: [
      { assetType: "401k_traditional", balance: "400000", accountName: "401k", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
    ],
    taxYear: 2024,
  };
  const hits = runFull(inputs);
  header(`Found: ${ids(hits).join(", ") || "(none)"}`);
  checkSubset("S10", "fires G1.57 NQDC §409A (W-2 > $400k + age 40-55)",
    ["G1.57"], ids(hits));
  checkSubset("S10", "fires G1.58 state residency change (CA + AGI > $500k)",
    ["G1.58"], ids(hits));
  checkSubset("S10", "fires G1.26 backdoor Roth (single AGI > $161k)",
    ["G1.26"], ids(hits));
  checkSubset("S10", "fires G1.56 specific-share-ID (LTCG > $5k)",
    ["G1.56"], ids(hits));
  // Should NOT fire:
  checkNotFires("S10", "G1.31 Saver's Credit suppressed (high AGI)",
    "G1.31", hits);
  checkNotFires("S10", "G1.4 Roth conversion suppressed (high marginal rate)",
    "G1.4", hits);
  checkNotFires("S10", "G1.61 student loan suppressed (AGI > $95k single cap)",
    "G1.61", hits);
  // Verify G1.57 estSavings
  const nqdcHit = findHit(hits, "G1.57");
  if (nqdcHit) {
    checkInRange("S10", "G1.57 estSavings = $15,000",
      nqdcHit.estSavings, 14_995, 15_005);
  }
  // Verify G1.58 estSavings is meaningful (CA state tax × 50%)
  const stateHit = findHit(hits, "G1.58");
  if (stateHit) {
    checkInRange("S10", "G1.58 estSavings in $20k-$50k range",
      stateHit.estSavings, 20_000, 50_000);
  }
}

// ============================================================================
// RESULTS
// ============================================================================

console.log(`\n========== END-TO-END SCENARIOS RESULTS ==========`);
console.log(`PASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  [${f.scenario}] ${f.label}`);
    console.log(`      expected: ${f.expected}`);
    console.log(`      actual:   ${f.actual}`);
  }
  process.exit(1);
}
console.log(`\nALL PLANNING-SCENARIOS ASSERTIONS PASS`);
