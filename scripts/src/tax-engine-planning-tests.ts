/**
 * Phase G — Tax Planning detector tests.
 *
 * Each rule (G1.1 → G1.10) requires:
 *   - ≥ 3 positive cases (trigger fires with correct estSavings)
 *   - ≥ 2 negative cases (trigger does NOT fire)
 *   - ≥ 1 boundary / edge case
 *
 * Same discipline as the tax engine: hand-calc the expected value against
 * the IRS-published rule BEFORE asserting, leave the hand-calc trace as a
 * comment, and cite the source.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-planning-tests.ts
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
const FAIL: Array<{ rule: string; label: string; expected: number | string; actual: number | string; delta?: number; cite?: string }> = [];

function check(rule: string, label: string, actual: number, expected: number, tol = 1, cite = ""): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected, actual, delta: Math.round((actual - expected) * 100) / 100, cite });
}

function checkTruthy(rule: string, label: string, actual: boolean, expected: boolean, cite = ""): void {
  if (actual === expected) PASS.push(`OK [${rule}] ${label}`);
  else FAIL.push({ rule, label, expected: String(expected), actual: String(actual), cite });
}

function header(t: string): void { console.log(`\n-- ${t} --`); }
function section(t: string): void { console.log(`\n========== ${t} ==========`); }

function runPlanning(inputs: Partial<TaxReturnInputs> & { client: TaxReturnInputs["client"] }): OpportunityHit[] {
  const computed = computeTaxReturnPure({
    w2s: [], form1099s: [], adjustments: [],
    taxYear: inputs.client.taxYear ?? 2024,
    ...inputs,
  });
  return evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments ?? [],
  });
}

function findHit(hits: OpportunityHit[], id: string): OpportunityHit | undefined {
  return hits.find((h) => h.strategyId === id);
}

// ============================================================================
// G1.1 — SEP-IRA / Solo 401(k) for self-employed filer
// IRS: IRC §408(k); Pub 560 (TY2024 SEP cap $69k; TY2025 $70k).
// Trigger: netSeIncome ≥ $30k AND no existing SEP/Solo401k adj AND not MFS.
// Contribution = min((netSE − halfSE) × 0.20, sepCap)
// estSavings = contribution × (federalMarginalRate + stateMarginalRate)
// ============================================================================
section("G1.1 SEP-IRA / Solo 401(k) for self-employed filer");

// --- G1.1 positive Case 1: Pure SE filer, single, FL, TY2024, $80k 1099-NEC ---
// Hand-calc (engine does NOT auto-derive QBI from Sch C — QBI needs an
// explicit qbi_income adjustment; that's a documented sub-gap, not a bug):
//   Gross SE = $80,000
//   Net SE = 80,000 × 0.9235 = $73,880.00
//   SS portion = min(73,880, 168,600 SS base) × 12.4% = $9,161.12
//   Medicare = 73,880 × 0.029 = $2,142.52
//   SE tax = $11,303.64 → half-SE = $5,651.82
//   Base for SEP = (73,880.00 − 5,651.82) × 0.20 = $13,645.64
//   SEP cap 2024 = $69,000 (not binding)
//   AGI = 80,000 − 5,651.82 = $74,348.18
//   Federal taxable = AGI − std ded = 74,348.18 − 14,600 = $59,748.18
//   Single 2024 brackets: 10% to $11,600 | 12% to $47,150 | 22% to $100,525.
//   $59,748.18 is in the 22% bracket → marginal = 0.22.
//   FL has no income tax → state marginal = 0.
//   estSavings = $13,645.64 × 0.22 = $3,002.04
header("G1.1+1 — Single FL TY2024, $80k SE: contribution $13,646, savings $3,002");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 80000 }],
  });
  const hit = findHit(hits, "G1.1");
  checkTruthy("G1.1+1", "hit fires", hit != null, true, "Pub 560 — SEP triggers at net SE >= $30k");
  if (hit) {
    check("G1.1+1", "contribution = $13,646",
      Number(hit.inputs.contribution), 13646, 2,
      "Pub 560 — (netSE − halfSE) × 20%");
    check("G1.1+1", "estSavings = $3,002",
      hit.estSavings, 3002, 2,
      "contribution × (fedMarginal 22% + stateMarginal 0%)");
    check("G1.1+1", "federal marginal rate = 0.22",
      Number(hit.inputs.federalMarginalRate), 0.22, 0.001,
      "Single 2024: $59,748 taxable is in the 22% bracket ($47,150-$100,525)");
    check("G1.1+1", "state marginal rate = 0 (FL)",
      Number(hit.inputs.stateMarginalRate), 0, 0.001,
      "Florida has no personal income tax");
  }
}

// --- G1.1 positive Case 1b: With explicit qbi_income adjustment, marginal drops to 12% ---
// Hand-calc (CPA enters qbi_income = net Sch C earnings):
//   Same setup as +1, but adjustments include qbi_income = $73,880.
//   QBI deduction = 20% × $73,880 = $14,776, capped at 20% × taxableBeforeQbi.
//     taxableBeforeQbi = AGI − stdDed = $74,348.18 − $14,600 = $59,748.18
//     cap = 20% × $59,748.18 = $11,949.64 → QBI deduction = $11,949.64 (cap binds).
//   Federal taxable = $59,748.18 − $11,949.64 = $47,798.54
//   Single 2024: $47,798.54 is in the 22% bracket (above $47,150 by $648).
//   Marginal = 0.22 still — QBI cap is just barely not enough to land back in 12%.
//   estSavings = $13,645.64 × 0.22 = $3,002.04 (same)
header("G1.1+1b — qbi_income adjustment exercised; QBI cap binds, marginal stays 22%");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 80000 }],
    adjustments: [{ adjustmentType: "qbi_income", amount: 73880, isApplied: true }],
  });
  const hit = findHit(hits, "G1.1");
  checkTruthy("G1.1+1b", "hit fires with QBI adjustment present", hit != null, true);
  if (hit) {
    check("G1.1+1b", "contribution = $13,646 (QBI does not affect contribution formula)",
      Number(hit.inputs.contribution), 13646, 2);
    check("G1.1+1b", "federal marginal still 0.22 (QBI cap binds, $648 over)",
      Number(hit.inputs.federalMarginalRate), 0.22, 0.001);
  }
}

// --- G1.1 positive Case 2: SEP cap binds (MFJ FL TY2024, $1,000,000 SE) ---
// Hand-calc:
//   Gross SE = $1,000,000
//   Net SE = 1,000,000 × 0.9235 = $923,500
//   SS portion = min(923,500, 168,600) × 0.124 = $20,906.40
//   Medicare = 923,500 × 0.029 = $26,781.50
//   SE tax = $47,687.90 → half-SE = $23,843.95
//   Base for SEP = (923,500 − 23,843.95) × 0.20 = $179,931.21
//   SEP cap 2024 = $69,000 → contribution capped at $69,000.
//   AGI ≈ 1,000,000 − half-SE ≈ $976,156.05
//   Federal taxable: subtract std ded ($29,200) and QBI 20% of (923,500 − 23,843.95)
//     = 20% × 899,656.05 = $179,931.21 (no SSTB phase-out modeled by engine)
//     → taxable ≈ 976,156 − 29,200 − 179,931 = $767,025
//   MFJ 2024 brackets — 37% kicks in at $731,200. $767,025 → marginal = 37%.
//   FL has no income tax → state marginal = 0.
//   estSavings = $69,000 × 0.37 = $25,530
header("G1.1+2 — MFJ FL TY2024, $1M SE: contribution capped at $69k, savings $25,530");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 1000000 }],
  });
  const hit = findHit(hits, "G1.1");
  checkTruthy("G1.1+2", "hit fires", hit != null, true);
  if (hit) {
    check("G1.1+2", "contribution = $69,000 (cap binds)",
      Number(hit.inputs.contribution), 69000, 1,
      "§415(c) annual additions cap TY2024");
    check("G1.1+2", "federal marginal = 0.37",
      Number(hit.inputs.federalMarginalRate), 0.37, 0.001,
      "MFJ 2024 top bracket starts $731,200");
    check("G1.1+2", "estSavings = $25,530",
      hit.estSavings, 25530, 5,
      "$69,000 × 37% federal + 0% FL");
  }
}

// --- G1.1 positive Case 3: TY2025 cap = $70,000 ---
// Same MFJ FL $1M SE setup as +2 but TY2025. SEP cap = $70,000.
//   estSavings = $70,000 × 0.37 = $25,900
header("G1.1+3 — MFJ FL TY2025, $1M SE: contribution $70k, savings $25,900");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2025 },
    form1099s: [{ taxYear: 2025, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 1000000 }],
  });
  const hit = findHit(hits, "G1.1");
  checkTruthy("G1.1+3", "hit fires", hit != null, true);
  if (hit) {
    check("G1.1+3", "contribution = $70,000 (TY2025 cap)",
      Number(hit.inputs.contribution), 70000, 1,
      "IRS Notice 2024-80 — §415(c) cap TY2025 $70,000");
  }
}

// --- G1.1 negative Case 4: MFS filer — must NOT trigger ---
// Per spec: MFS is excluded (SEP not available to MFS in practice; even if it
// were, planning ROI is poor at MFS bracket compression).
header("G1.1-4 — MFS suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 80000 }],
  });
  checkTruthy("G1.1-4", "no SEP hit for MFS", findHit(hits, "G1.1") == null, true,
    "Phase G plan: filingStatus != MFS");
}

// --- G1.1 negative Case 5: Below $30k threshold — must NOT trigger ---
// Gross SE $25,000 → net = 25,000 × 0.9235 = $23,087.50 < $30,000 trigger.
header("G1.1-5 — net SE below $30k suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 25000 }],
  });
  checkTruthy("G1.1-5", "no SEP hit when net SE < $30k", findHit(hits, "G1.1") == null, true);
}

// --- G1.1 negative Case 6: Existing SEP adjustment suppresses ---
// CPA already noted a SEP-IRA contribution. Detector should respect that and
// stay silent (avoid duplicate recommendation).
header("G1.1-6 — existing sep_ira adjustment suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 80000 }],
    adjustments: [{ adjustmentType: "sep_ira_contribution", amount: 10000, isApplied: true }],
  });
  checkTruthy("G1.1-6", "no SEP hit when sep_ira_contribution adjustment exists",
    findHit(hits, "G1.1") == null, true);
}

// --- G1.1 boundary Case 7: net SE just above $30k cliff (gross $32,500) ---
// Gross SE = $32,500 → net = 32,500 × 0.9235 = $30,013.75 ≥ $30,000 → fires.
//   SS portion = 30,013.75 × 0.124 = $3,721.71
//   Medicare = 30,013.75 × 0.029 = $870.40
//   SE tax = $4,592.11 → half-SE = $2,296.05
//   Base = (30,013.75 − 2,296.05) × 0.20 = $5,543.54
//   No cap binding. Contribution = $5,544 (rounded).
header("G1.1±7 — net SE $30,014 just above cliff: contribution $5,544");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 32500 }],
  });
  const hit = findHit(hits, "G1.1");
  checkTruthy("G1.1±7", "hit fires just above $30k cliff", hit != null, true);
  if (hit) {
    check("G1.1±7", "contribution ≈ $5,544",
      Number(hit.inputs.contribution), 5544, 2,
      "(30,013.75 − 2,296.05) × 20% per Pub 560");
  }
}

// --- G1.1 boundary Case 8: net SE just below $30k (gross $32,000) ---
// Gross SE $32,000 → net = $29,552 < $30,000 → does NOT fire.
header("G1.1-8 — net SE $29,552 just below cliff suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Acme Co", nonemployeeCompensation: 32000 }],
  });
  checkTruthy("G1.1-8", "no SEP hit just below $30k cliff",
    findHit(hits, "G1.1") == null, true);
}

// ============================================================================
// G1.2 — PTET election for SALT cap
// IRS: IRC §164(b)(6); Notice 2020-75; state-specific PTET statute.
// Trigger: K-1 active income > 0 AND resident state in PTET regime
//          AND itemizing AND saltDeductible == saltCap AND saltUncapped > cap.
// estSavings = (saltUncapped - saltCap) × federalMarginalRate
// ============================================================================
section("G1.2 PTET election for SALT cap");

// --- G1.2+1 — MFJ NY TY2024, $80k W-2 + $300k active K-1 + high SALT ---
// Hand-calc:
//   K-1 active S-corp box 1 = $300k (flows to Sch E line 28, active).
//   AGI = $80,000 + $300,000 = $380,000.
//   Sch A: medical 0. SALT uncapped = max(state_income $20k, sales 0) +
//     property $15k = $35,000 → SALT cap binds at $10,000.
//     Mortgage interest = $25,000 (well below the $750k loan limit so all
//     deductible per engine). Charitable = 0.
//     totalItemized = $10,000 + $25,000 = $35,000.
//   Std ded MFJ 2024 = $29,200. Itemized ($35k) > std ded → itemize.
//   itemizedDeductions = $35,000 → G1.2 trigger conditions all met.
//   Federal taxable = $380,000 − $35,000 = $345,000. MFJ 2024 brackets:
//     24% bracket $201,050−$383,900. $345k is in 24% bracket → marginal 24%.
//   recoverableSalt = $35,000 − $10,000 = $25,000.
//   estSavings = $25,000 × 0.24 = $6,000.
header("G1.2+1 — MFJ NY $300k K-1 + $35k SALT: PTET recovers $25k @ 24% = $6,000");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "NY" }],
    scheduleK1: [{
      taxYear: 2024, entityName: "Owner Co.", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 300000,
    }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 20000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 15000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 25000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.2");
  checkTruthy("G1.2+1", "PTET hit fires when SALT cap binds + K-1 active + PTET state", hit != null, true);
  if (hit) {
    check("G1.2+1", "recoverableSalt = $25,000",
      Number(hit.inputs.recoverableSalt), 25000, 1,
      "saltUncapped $35,000 − saltCap $10,000");
    check("G1.2+1", "federal marginal = 0.24",
      Number(hit.inputs.federalMarginalRate), 0.24, 0.001,
      "MFJ 2024: $345k taxable is in 24% bracket ($201,050-$383,900)");
    check("G1.2+1", "estSavings = $6,000",
      hit.estSavings, 6000, 5,
      "$25,000 × 24% federal marginal");
  }
}

// --- G1.2+2 — CA MFJ $500k active partnership K-1 + $60k SALT ---
// Hand-calc:
//   K-1 partnership active box 1 = $500k.
//   AGI = $500k.
//   Wait — partnership K-1 box 14A SE earnings would flow through. To keep
//   the case clean (no SE tax), use s_corp where box 1 is NOT SE income.
//   Use s_corp with box 1 = $500k active.
//   Sch A: state_income $40k + property $20k = $60k SALT uncapped → $10k.
//     mortgage = $30k. totalItemized = $10k + $30k = $40k.
//   Std ded MFJ 2024 = $29,200 → itemize.
//   Federal taxable = $500k − $40k = $460k.
//   MFJ 2024: 32% bracket $383,900-$487,450 → marginal 0.32 at $460k.
//   recoverableSalt = $60k − $10k = $50k. estSavings = $50k × 0.32 = $16,000.
header("G1.2+2 — MFJ CA $500k S-corp + $60k SALT: PTET recovers $50k @ 32% = $16,000");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "S-Corp Inc.", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 500000,
    }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 40000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 20000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 30000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.2");
  checkTruthy("G1.2+2", "PTET hit fires (CA)", hit != null, true);
  if (hit) {
    check("G1.2+2", "estSavings = $16,000", hit.estSavings, 16000, 10);
    check("G1.2+2", "federal marginal = 0.32",
      Number(hit.inputs.federalMarginalRate), 0.32, 0.001);
  }
}

// --- G1.2+3 — Single NJ $200k S-corp K-1, $25k SALT, mortgage $20k ---
// AGI = $200k. SALT uncapped = $15k + $10k = $25k → $10k cap.
// Mortgage $20k. totalItemized = $30k > single std ded $14,600 → itemize.
// Taxable = $200k − $30k = $170k. Single 2024: 22% bracket $47,150-$100,525,
// 24% bracket $100,525-$191,950. $170k → marginal 0.24.
// recoverableSalt = $15k. estSavings = $15k × 0.24 = $3,600.
header("G1.2+3 — Single NJ $200k S-corp + $25k SALT: PTET recovers $15k @ 24% = $3,600");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "NJ", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "NJ S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 200000,
    }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 15000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 10000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 20000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.2+3");  // bug-self-check: wrong id should fail-fast
  checkTruthy("G1.2+3 self-check", "wrong id misses", hit == null, true);
  const realHit = findHit(hits, "G1.2");
  checkTruthy("G1.2+3", "PTET hit fires (NJ)", realHit != null, true);
  if (realHit) {
    check("G1.2+3", "estSavings = $3,600", realHit.estSavings, 3600, 5);
  }
}

// --- G1.2-4 — State not in PTET list (TX) — must NOT fire ---
// TX, MFJ, K-1 active $200k, property $20k, mortgage $25k.
// Itemized = $10k + $25k = $35k > $29.2k std ded → itemizes. But TX not in
// PTET regime list → G1.2 silent.
header("G1.2-4 — TX (no PTET regime) suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "TX", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "TX S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 200000,
    }],
    adjustments: [
      { adjustmentType: "state_property_tax", amount: 20000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 25000, isApplied: true },
    ],
  });
  checkTruthy("G1.2-4", "no PTET hit when state has no PTET regime",
    findHit(hits, "G1.2") == null, true);
}

// --- G1.2-5 — No K-1 active income — must NOT fire ---
// MFJ NY, W-2 $200k only, SALT $35k, mortgage $25k → itemizes, cap binds,
// but no K-1 active income. PTET is only useful for pass-through owners.
header("G1.2-5 — No K-1 active income suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, stateCode: "NY" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 20000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 15000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 25000, isApplied: true },
    ],
  });
  checkTruthy("G1.2-5", "no PTET hit without K-1 active income",
    findHit(hits, "G1.2") == null, true);
}

// --- G1.2±6 — Boundary: saltUncapped exactly at $10,000 ---
// SALT uncapped = $10,000 exactly (state income $10k, no property). recoverable
// = 0. Detector should NOT fire (saltUncapped > saltCap is false).
header("G1.2±6 — saltUncapped exactly at $10k cap — does NOT fire");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "NY S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 250000,
    }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 10000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 25000, isApplied: true },
    ],
  });
  checkTruthy("G1.2±6", "no PTET hit when saltUncapped equals cap exactly",
    findHit(hits, "G1.2") == null, true);
}

// ============================================================================
// G1.10 — Foreign Tax Credit unclaimed
// IRS: IRC §901; Form 1116.
// Trigger: foreign_tax_paid adjustment > 0
//          AND foreignTaxCredit.credit < foreign_tax_paid × 0.95
// estSavings = foreign_tax_paid − foreignTaxCredit.credit
// ============================================================================
section("G1.10 Foreign Tax Credit unclaimed");

// --- G1.10+1 — Single, $5k FTC paid, foreign-source $10k, Form 1116 limit binds ---
// Hand-calc:
//   W-2 $100,000 → AGI $100,000 → taxable = $100,000 − $14,600 std ded = $85,400.
//   Federal tax single 2024 on $85,400:
//     $11,600 × 10% = $1,160
//     ($47,150 − $11,600) × 12% = $4,266
//     ($85,400 − $47,150) × 22% = $8,415
//     Total = $13,841 (Form 1040 Line 16 incomeTaxOnly, no AMT).
//   foreign_tax_paid $5,000 > simplified $300 → Path 2 (Form 1116).
//   foreign_source_taxable_income = $10,000 → fraction = 10,000/85,400 = 0.117096.
//   formLimit = 0.117096 × $13,841 = $1,620.63.
//   credit = min($5,000, $1,620.63) = $1,620.63.
//   gap = $5,000 − $1,620.63 = $3,379.37.
//   Trigger condition: $1,620.63 < $5,000 × 0.95 = $4,750. YES, fires.
//   estSavings = $3,379 (rounded).
header("G1.10+1 — Single $5k FTC paid, $10k foreign source: gap $3,379");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "foreign_tax_paid", amount: 5000, isApplied: true },
      { adjustmentType: "foreign_source_taxable_income", amount: 10000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.10");
  checkTruthy("G1.10+1", "FTC gap hit fires", hit != null, true);
  if (hit) {
    check("G1.10+1", "estSavings = $3,379",
      hit.estSavings, 3379, 2,
      "$5,000 paid − $1,620.63 credited per Form 1116 limit");
    check("G1.10+1", "foreignTaxPaid = $5,000",
      Number(hit.inputs.foreignTaxPaid), 5000, 1);
  }
}

// --- G1.10+2 — MFJ, $8k FTC paid, $20k foreign source ---
// Hand-calc:
//   MFJ, W-2 $250k → AGI $250k → taxable = $250k − $29,200 = $220,800.
//   Federal tax MFJ 2024 on $220,800:
//     $23,200 × 10% = $2,320
//     ($94,300 − $23,200) × 12% = $8,532
//     ($201,050 − $94,300) × 22% = $23,485
//     ($220,800 − $201,050) × 24% = $4,740
//     Total = $39,077.
//   foreign_tax_paid $8,000 > simplified $600 → Path 2.
//   fraction = 20,000 / 220,800 = 0.090580.
//   formLimit = 0.090580 × $39,077 = $3,539.78.
//   credit = min($8,000, $3,539.78) = $3,539.78.
//   gap = $8,000 − $3,539.78 = $4,460.22.
//   Trigger: $3,539.78 < $8,000 × 0.95 = $7,600 → YES.
//   estSavings = $4,460 (rounded).
header("G1.10+2 — MFJ $8k FTC paid, $20k foreign source: gap $4,460");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "foreign_tax_paid", amount: 8000, isApplied: true },
      { adjustmentType: "foreign_source_taxable_income", amount: 20000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.10");
  checkTruthy("G1.10+2", "FTC gap hit fires (MFJ)", hit != null, true);
  if (hit) {
    check("G1.10+2", "estSavings = $4,460", hit.estSavings, 4460, 5);
  }
}

// --- G1.10+3 — Single, $1k FTC paid, $1k foreign source — tiny gap ---
// Hand-calc:
//   W-2 $100k → taxable $85,400 → tax $13,841.
//   fraction = 1,000/85,400 = 0.01171.
//   formLimit = 0.01171 × $13,841 = $162.06.
//   credit = min($1,000, $162.06) = $162.06.
//   gap = $1,000 − $162.06 = $837.94 → ≈ $838.
//   Trigger: $162 < $1,000 × 0.95 = $950 → YES.
header("G1.10+3 — Tiny FTC gap: $1k paid, $1k foreign source: gap $838");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "foreign_tax_paid", amount: 1000, isApplied: true },
      { adjustmentType: "foreign_source_taxable_income", amount: 1000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.10");
  checkTruthy("G1.10+3", "FTC gap fires for small amounts when materially binding",
    hit != null, true);
  if (hit) {
    check("G1.10+3", "estSavings ≈ $838", hit.estSavings, 838, 2);
  }
}

// --- G1.10-4 — Under simplified limit ($300 single): full credit, no gap ---
header("G1.10-4 — Under simplified limit suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "foreign_tax_paid", amount: 200, isApplied: true },
    ],
  });
  checkTruthy("G1.10-4", "no FTC hit when under simplified limit (paid==credited)",
    findHit(hits, "G1.10") == null, true);
}

// --- G1.10-5 — No foreign tax paid — must NOT fire ---
header("G1.10-5 — No foreign tax paid suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
  });
  checkTruthy("G1.10-5", "no FTC hit without foreign_tax_paid",
    findHit(hits, "G1.10") == null, true);
}

// --- G1.10±6 — Boundary: large foreign source, Form 1116 limit doesn't bind ---
// $1k FTC paid + $50k foreign-source taxable income → fraction high enough
// that formLimit > paid → credit = paid → no gap → no fire.
header("G1.10±6 — Big foreign-source ratio, limit doesn't bind — no hit");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "foreign_tax_paid", amount: 1000, isApplied: true },
      { adjustmentType: "foreign_source_taxable_income", amount: 50000, isApplied: true },
    ],
  });
  checkTruthy("G1.10±6", "no FTC hit when Form 1116 limit > paid",
    findHit(hits, "G1.10") == null, true);
}

// ============================================================================
// G1.3 — Bunching itemized vs standard
// IRS: IRC §170; §63; Pub 17; Sch A.
// Trigger: itemizedTotal between stdDed × 0.85 and stdDed × 1.15
//          AND charitableCash > 0.
// estSavings = stdDed × 0.25 × federalMarginalRate (avg annual over 2-yr cycle)
// ============================================================================
section("G1.3 Bunching itemized vs standard");

// --- G1.3+1 — Single $90k W-2, itemized $14k, charitable $4k ---
// Hand-calc:
//   adjustments: state_income $5k, property $2k, mortgage $3k, charitable $4k.
//   Sch A: SALT uncapped $7k (< $10k cap), mortgage $3k, charitable $4k.
//   totalItemized = $7k + $3k + $4k = $14,000.
//   Std ded single 2024 = $14,600 → ±15% = $12,410 to $16,790. $14k in range.
//   AGI = $90,000 → taxable = $90k − std ded $14,600 = $75,400 (engine picks
//     std because $14,600 > $14,000). Single 2024: 22% bracket $47,150−$100,525.
//   marginal = 0.22 → estSavings = $14,600 × 0.25 × 0.22 = $803.
header("G1.3+1 — Single, itemized $14k vs std $14.6k, charitable $4k: savings $803");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 90000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 5000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 2000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 3000, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 4000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.3");
  checkTruthy("G1.3+1", "bunching hit fires", hit != null, true);
  if (hit) {
    check("G1.3+1", "itemizedTotal = $14,000",
      Number(hit.inputs.itemizedTotal), 14000, 1);
    check("G1.3+1", "estSavings = $803", hit.estSavings, 803, 2,
      "stdDed × 0.25 × marginalRate = 14600 × 0.25 × 0.22");
  }
}

// --- G1.3+2 — MFJ $160k, itemized $25k, charitable $10k ---
// Hand-calc:
//   adjustments: state_income $8k, property $4k, mortgage $5k, charitable $10k.
//   SALT uncapped $12k → capped $10k. mortgage $5k, charitable $10k.
//   totalItemized = $10k + $5k + $10k = $25,000.
//   Std ded MFJ 2024 = $29,200 → ±15% = $24,820 to $33,580. $25k in range.
//   AGI $160k → taxable $160k − $29,200 = $130,800. MFJ 22% bracket.
//   marginal 0.22 → estSavings = $29,200 × 0.25 × 0.22 = $1,606.
header("G1.3+2 — MFJ itemized $25k vs std $29.2k, charitable $10k: savings $1,606");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 160000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 8000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 4000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 5000, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 10000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.3");
  checkTruthy("G1.3+2", "bunching hit fires (MFJ)", hit != null, true);
  if (hit) {
    check("G1.3+2", "estSavings = $1,606", hit.estSavings, 1606, 2);
  }
}

// --- G1.3+3 — Single, itemized just above std ded with small charitable ---
// adjustments: state_income $5k, mortgage $7k, charitable $3k.
// totalItemized = $5k + $7k + $3k = $15,000 > std $14,600 → in band.
// AGI $60k → engine itemizes ($15k > $14.6k). taxable = 60k − 15k = $45k.
// Single 2024 12% bracket → marginal 0.12.
// estSavings = $14,600 × 0.25 × 0.12 = $438.
header("G1.3+3 — Single, itemized $15k just over std, charitable $3k: savings $438");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 5000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 7000, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 3000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.3");
  checkTruthy("G1.3+3", "bunching hit fires", hit != null, true);
  if (hit) {
    check("G1.3+3", "estSavings = $438", hit.estSavings, 438, 2);
  }
}

// --- G1.3-4 — Itemized too low (far below stdDed × 0.85) ---
header("G1.3-4 — itemized $1k well below 0.85 × stdDed suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "charitable_cash", amount: 1000, isApplied: true },
    ],
  });
  checkTruthy("G1.3-4", "no bunching hit far below band",
    findHit(hits, "G1.3") == null, true);
}

// --- G1.3-5 — In band but no charitable cash ---
header("G1.3-5 — In band but no charitable_cash suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 90000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 5000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 9000, isApplied: true },
    ],
  });
  checkTruthy("G1.3-5", "no bunching hit when charitable_cash = 0",
    findHit(hits, "G1.3") == null, true);
}

// --- G1.3±6 — Boundary: just above upper band cap (1.15 × stdDed + $1) ---
// Single 2024: cap = $14,600 × 1.15 = $16,790. Set itemized to $16,791 → out.
// Use state_income $5k + property $5k + mortgage $5k + charitable $1,791 =
// $10k SALT (capped from $10k) wait that's exactly cap. Let me use uncapped
// SALT < $10k: state_income $5k + property $3k + mortgage $7k + charitable
// $1,791 = $8k SALT + $7k + $1,791 = $16,791.
header("G1.3±6 — itemized $16,791 just over 1.15 × stdDed — does NOT fire");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 90000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 5000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 3000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 7000, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 1791, isApplied: true },
    ],
  });
  checkTruthy("G1.3±6", "no bunching hit just over 1.15 × stdDed boundary",
    findHit(hits, "G1.3") == null, true);
}

// ============================================================================
// G1.8 — Charitable Donor-Advised Fund (DAF) bunching
// IRS: IRC §170; §4966; Pub 526.
// Trigger: charitableCash > $5,000 AND federalMarginalRate ≥ 32%.
// estSavings = charitableCash × 2 × marginalRate × 0.2
// ============================================================================
section("G1.8 Charitable DAF bunching");

// --- G1.8+1 — Single $400k W-2, charitable $20k → marginal 35%, savings $2,800 ---
// Hand-calc:
//   AGI $400k. itemized: SALT $30k → $10k cap, mortgage $10k, charitable $20k
//     → totalItemized $40k. Std ded $14,600 → itemize.
//   Taxable = $400k − $40k = $360k. Single 2024 35% bracket $243,725-$609,350.
//   marginal = 0.35. Trigger: charitable $20k > $5k ✓, marginal 0.35 ≥ 0.32 ✓.
//   estSavings = $20,000 × 2 × 0.35 × 0.20 = $2,800.
header("G1.8+1 — Single $400k, charitable $20k @ 35% marginal: savings $2,800");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 400000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 20000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 10000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 10000, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 20000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.8");
  checkTruthy("G1.8+1", "DAF hit fires (single 35%)", hit != null, true);
  if (hit) {
    check("G1.8+1", "estSavings = $2,800", hit.estSavings, 2800, 5);
    check("G1.8+1", "federal marginal = 0.35",
      Number(hit.inputs.federalMarginalRate), 0.35, 0.001);
  }
}

// --- G1.8+2 — MFJ $700k W-2, charitable $15k → marginal 35%, savings $2,100 ---
// Hand-calc:
//   adjustments: state $10k → cap, mortgage $20k, charitable $15k → itemized $45k.
//   Taxable = $700k − $45k = $655k. MFJ 2024 35% bracket $487,450-$731,200.
//   marginal = 0.35. Trigger: ✓.
//   estSavings = $15k × 2 × 0.35 × 0.20 = $2,100.
header("G1.8+2 — MFJ $700k, charitable $15k @ 35% marginal: savings $2,100");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 700000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 10000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 20000, isApplied: true },
      { adjustmentType: "charitable_cash", amount: 15000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.8");
  checkTruthy("G1.8+2", "DAF hit fires (MFJ 35%)", hit != null, true);
  if (hit) {
    check("G1.8+2", "estSavings = $2,100", hit.estSavings, 2100, 5);
  }
}

// --- G1.8+3 — Single $250k W-2, charitable $8k, no other Sch A items ---
// Hand-calc:
//   itemized $8k < std ded $14,600 → std. Taxable = $250k − $14,600 = $235,400.
//   Single 2024 32% bracket $191,950-$243,725 → marginal 0.32.
//   Trigger: charitable $8k > $5k ✓, marginal 0.32 ≥ 0.32 ✓.
//   estSavings = $8,000 × 2 × 0.32 × 0.20 = $1,024.
header("G1.8+3 — Single $250k, charitable $8k @ 32% marginal: savings $1,024");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "charitable_cash", amount: 8000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.8");
  checkTruthy("G1.8+3", "DAF hit fires at the 32% threshold", hit != null, true);
  if (hit) {
    check("G1.8+3", "estSavings = $1,024", hit.estSavings, 1024, 5);
    check("G1.8+3", "marginal = 0.32",
      Number(hit.inputs.federalMarginalRate), 0.32, 0.001);
  }
}

// --- G1.8-4 — Charitable too low ($3k) — must NOT fire ---
header("G1.8-4 — charitable $3k below threshold suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 400000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "charitable_cash", amount: 3000, isApplied: true },
    ],
  });
  checkTruthy("G1.8-4", "no DAF hit when charitable ≤ $5,000",
    findHit(hits, "G1.8") == null, true);
}

// --- G1.8-5 — Marginal too low (22%) — must NOT fire ---
header("G1.8-5 — high charitable but marginal 22% suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "charitable_cash", amount: 20000, isApplied: true },
    ],
  });
  checkTruthy("G1.8-5", "no DAF hit when marginal < 32%",
    findHit(hits, "G1.8") == null, true);
}

// --- G1.8±6 — Charitable exactly $5,000 — spec says strict > so NOT fires ---
header("G1.8±6 — charitable exactly $5,000 boundary — does NOT fire");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 400000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "charitable_cash", amount: 5000, isApplied: true },
    ],
  });
  checkTruthy("G1.8±6", "no DAF hit at exactly $5,000 (strict >)",
    findHit(hits, "G1.8") == null, true);
}

// ============================================================================
// G1.4 — Roth conversion window
// IRS: IRC §408A; Pub 590-A.
// Trigger: federalMarginalRate < 0.24 AND taxpayerAge in [30, 72] (or null).
// conversion = bracketTop − taxableIncome
// estSavings = conversion × (0.32 future-rate placeholder − currentRate)
// ============================================================================
section("G1.4 Roth conversion window");

// --- G1.4+1 — Single FL $50k W-2 → 12% bracket, fill to $47,150 ---
// Hand-calc:
//   AGI $50,000. Taxable = $50,000 − $14,600 std = $35,400.
//   Single 2024: 12% bracket $11,600-$47,150. marginal = 0.12.
//   conversion = $47,150 − $35,400 = $11,750.
//   estSavings = $11,750 × (0.32 − 0.12) = $2,350.
header("G1.4+1 — Single $50k @ 12% bracket → fill $11,750, savings $2,350");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
  });
  const hit = findHit(hits, "G1.4");
  checkTruthy("G1.4+1", "Roth hit fires", hit != null, true);
  if (hit) {
    check("G1.4+1", "conversion = $11,750",
      Number(hit.inputs.conversion), 11750, 1,
      "12% bracket top $47,150 − taxable $35,400");
    check("G1.4+1", "estSavings = $2,350",
      hit.estSavings, 2350, 2,
      "$11,750 × (0.32 − 0.12)");
  }
}

// --- G1.4+2 — MFJ FL $130k W-2 → 22% bracket, fill to $201,050 ---
// Hand-calc:
//   AGI $130,000. Taxable = $130k − $29,200 = $100,800.
//   MFJ 2024: 22% bracket $94,300-$201,050. marginal = 0.22.
//   conversion = $201,050 − $100,800 = $100,250.
//   estSavings = $100,250 × (0.32 − 0.22) = $10,025.
header("G1.4+2 — MFJ $130k @ 22% bracket → fill $100,250, savings $10,025");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 130000, stateCode: "FL" }],
  });
  const hit = findHit(hits, "G1.4");
  checkTruthy("G1.4+2", "Roth hit fires (MFJ 22%)", hit != null, true);
  if (hit) {
    check("G1.4+2", "estSavings = $10,025", hit.estSavings, 10025, 5);
  }
}

// --- G1.4+3 — HoH FL $80k W-2, taxpayerAge 45 → 12% bracket ---
// Hand-calc:
//   AGI $80,000. Taxable = $80,000 − $21,900 HoH std = $58,100.
//   HoH 2024: 12% bracket $16,550-$63,100. marginal = 0.12.
//   conversion = $63,100 − $58,100 = $5,000.
//   estSavings = $5,000 × (0.32 − 0.12) = $1,000.
header("G1.4+3 — HoH age 45 $80k @ 12% bracket → fill $5,000, savings $1,000");
{
  const hits = runPlanning({
    client: { filingStatus: "head_of_household", state: "FL", taxYear: 2024, taxpayerAge: 45 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "FL" }],
  });
  const hit = findHit(hits, "G1.4");
  checkTruthy("G1.4+3", "Roth hit fires for HoH age 45", hit != null, true);
  if (hit) {
    check("G1.4+3", "estSavings = $1,000", hit.estSavings, 1000, 2);
  }
}

// --- G1.4-4 — Marginal too high (24%) — must NOT fire ---
// Single $300k W-2 → taxable $285,400 → 35% bracket → > 0.24 → no fire.
header("G1.4-4 — Single $300k @ 35% marginal suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, stateCode: "FL" }],
  });
  checkTruthy("G1.4-4", "no Roth hit when marginal >= 24%",
    findHit(hits, "G1.4") == null, true);
}

// --- G1.4-5 — Age under 30 — must NOT fire ---
header("G1.4-5 — taxpayerAge 25 suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 25 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
  });
  checkTruthy("G1.4-5", "no Roth hit at age 25",
    findHit(hits, "G1.4") == null, true);
}

// --- G1.4-6 — Age over 72 — must NOT fire ---
header("G1.4-6 — taxpayerAge 75 suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 75 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
  });
  checkTruthy("G1.4-6", "no Roth hit at age 75",
    findHit(hits, "G1.4") == null, true);
}

// --- G1.4±7 — Boundary: marginal exactly 0.24 ---
// Single 2024: 24% bracket starts at $100,525. Wage $115,125 → taxable
// $100,525 → marginal 0.22 (still in 22% bracket since strict < at upper).
// Boost to $115,200 wage → taxable $100,600 → in 24% bracket → marginal 0.24
// → trigger `< 0.24` fails → no fire.
header("G1.4±7 — taxable just into 24% bracket: marginal 0.24, suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 115200, stateCode: "FL" }],
  });
  checkTruthy("G1.4±7", "no Roth hit when marginal exactly 0.24",
    findHit(hits, "G1.4") == null, true);
}

// ============================================================================
// G1.5 — AMT timing (ISO bargain element)
// IRS: IRC §56(b)(3); Form 6251 line 2k.
// Trigger: amtTax > 0 AND amt_iso_bargain_element adjustment > 0.
// estSavings = amtTax (full deferrable amount).
// ============================================================================
section("G1.5 AMT timing — ISO bargain element");

// --- G1.5+1 — Single $250k W-2 + $100k ISO bargain ---
// Hand-calc:
//   Regular tax single 2024 on $235,400 taxable ($250k − $14,600 std):
//     $1,160 + $4,266 + $11,742.50 + $21,942 + $13,904 = $53,014.50.
//   AMTI = taxable $235,400 + ISO bargain $100,000 = $335,400.
//   Single AMT exemption $85,700 (no phaseout below $609,350).
//   AMT base = $335,400 − $85,700 = $249,700.
//   Tentative AMT @ 26/28% (breakpoint $232,600):
//     $232,600 × 0.26 + ($249,700 − $232,600) × 0.28
//     = $60,476 + $4,788 = $65,264.
//   amtTax = max(0, $65,264 − $53,014.50) = ~$12,250.
//   estSavings = $12,250 (entire AMT deferrable / avoidable).
header("G1.5+1 — Single $250k W-2 + $100k ISO bargain: AMT ~$12,250");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 100000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.5");
  checkTruthy("G1.5+1", "AMT-ISO hit fires", hit != null, true);
  if (hit) {
    check("G1.5+1", "estSavings ≈ $12,250 (Form 6251 tentative − regular)",
      hit.estSavings, 12250, 10,
      "Form 6251: 26/28% on $249,700 AMT base − regular tax $53,014");
    check("G1.5+1", "isoBargainElement = $100,000",
      Number(hit.inputs.isoBargainElement), 100000, 1);
  }
}

// --- G1.5+2 — MFJ $400k W-2 + $200k ISO bargain ---
// Hand-calc:
//   Regular tax MFJ 2024 on ($400k − $29,200) = $370,800 taxable:
//     $2,320 + $8,532 + $23,485 + $40,500 + ($370,800 − $383,900 too high)
//     Wait: MFJ brackets 2024: 24% to $383,900. $370,800 < $383,900 → in 24%.
//     $2,320 + $8,532 + $23,485 + ($370,800 − $201,050) × 0.24
//     = $2,320 + $8,532 + $23,485 + $40,740 = $75,077.
//   AMTI = $370,800 + $200,000 = $570,800.
//   MFJ AMT exemption $133,300 (no phaseout below $1,218,700).
//   AMT base = $570,800 − $133,300 = $437,500.
//   Tentative @ 26/28% (breakpoint $232,600):
//     $232,600 × 0.26 + ($437,500 − $232,600) × 0.28
//     = $60,476 + $57,372 = $117,848.
//   amtTax = max(0, $117,848 − $75,077) = $42,771.
header("G1.5+2 — MFJ $400k W-2 + $200k ISO bargain: AMT ~$42,771");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 400000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 200000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.5");
  checkTruthy("G1.5+2", "AMT-ISO hit fires (MFJ)", hit != null, true);
  if (hit) {
    check("G1.5+2", "estSavings ≈ $42,771", hit.estSavings, 42771, 10);
  }
}

// --- G1.5+3 — Single $180k W-2 + $50k ISO bargain ---
// Hand-calc:
//   taxable = $180,000 − $14,600 = $165,400. Single 24% bracket
//     $100,525-$191,950 → marginal 0.24.
//   Regular tax: $1,160 + $4,266 + $11,742.50 + ($165,400 − $100,525) × 0.24
//     = $1,160 + $4,266 + $11,742.50 + $15,570 = $32,738.50.
//   AMTI = $165,400 + $50,000 = $215,400. Single exemption $85,700.
//   AMT base = $215,400 − $85,700 = $129,700.
//   Tentative (under $232,600 → all 26%): $129,700 × 0.26 = $33,722.
//   amtTax = max(0, $33,722 − $32,738.50) = $983.50 ≈ $984.
header("G1.5+3 — Single $180k + $50k ISO: AMT ~$984");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 180000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 50000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.5");
  checkTruthy("G1.5+3", "AMT-ISO hit fires (small AMT)", hit != null, true);
  if (hit) {
    check("G1.5+3", "estSavings ≈ $984", hit.estSavings, 984, 5);
  }
}

// --- G1.5-4 — AMT > 0 but no ISO bargain (driven by SALT addback) ---
// Setup: MFJ $1M W-2 with high itemized SALT → big AMT line 2g addback,
// no ISO. amtTax > 0 (from SALT addback) but ISO = 0 → no fire.
header("G1.5-4 — AMT from SALT addback only, no ISO suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 1500000, stateCode: "CA" }],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 100000, isApplied: true },
      { adjustmentType: "state_property_tax", amount: 30000, isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 50000, isApplied: true },
    ],
  });
  checkTruthy("G1.5-4", "no G1.5 hit without ISO bargain element",
    findHit(hits, "G1.5") == null, true);
}

// --- G1.5-5 — ISO bargain present but no AMT (low income) ---
// Single $40k W-2 + $1,000 ISO bargain. AMTI low; exemption $85,700 covers
// it → amtTax = 0 → no fire.
header("G1.5-5 — ISO bargain but no AMT suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 1000, isApplied: true },
    ],
  });
  checkTruthy("G1.5-5", "no G1.5 hit when AMT exemption absorbs bargain",
    findHit(hits, "G1.5") == null, true);
}

// --- G1.5±6 — Boundary: tiny ISO bargain that just triggers AMT ---
// Set bargain just large enough to clip AMT. Single $250k W-2 → AMTI base
// $235,400. Without prefs, tentative on AMTI − $85,700 = $149,700 × 0.26 =
// $38,922 (less than regular tax $53k → no AMT). Add $60k ISO → AMTI
// $295,400, base $209,700, tentative $54,522 → amtTax = $54,522 − $53,014.50 =
// $1,507.50. Fires with that small amount.
header("G1.5±6 — Single $250k + $60k ISO: small AMT ~$1,508");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "amt_iso_bargain_element", amount: 60000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.5");
  checkTruthy("G1.5±6", "G1.5 fires with small AMT", hit != null, true);
  if (hit) {
    check("G1.5±6", "estSavings ≈ $1,508", hit.estSavings, 1508, 5);
  }
}

// ============================================================================
// G1.6 — NIIT cliff avoidance
// IRS: IRC §1411; Form 8960.
// Trigger: AGI in [threshold − $10k, threshold + $10k]
//          (where threshold = 200k single/HoH, 250k MFJ/QSS, 125k MFS)
//          AND netInvestmentIncome > 0 AND currently paying NIIT.
// estSavings = niitTax.
// ============================================================================
section("G1.6 NIIT cliff avoidance");

// --- G1.6+1 — Single $205k AGI: NIIT $190 ---
// Hand-calc:
//   W-2 $195k + interest $10k → AGI $205k. Threshold single $200k.
//   AGI in [$190k, $210k] band ✓. NII = $10k > 0 ✓.
//   NIIT taxable = min(NII $10k, AGI − threshold = $5k) = $5k.
//   niitTax = $5k × 3.8% = $190.
header("G1.6+1 — Single AGI $205k → NIIT $190, savings $190");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 195000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 10000 }],
  });
  const hit = findHit(hits, "G1.6");
  checkTruthy("G1.6+1", "NIIT hit fires", hit != null, true);
  if (hit) {
    check("G1.6+1", "estSavings = $190", hit.estSavings, 190, 1,
      "Form 8960: min(NII $10k, AGI excess $5k) × 3.8%");
    check("G1.6+1", "AGI = $205,000",
      Number(hit.inputs.agi), 205000, 1);
    check("G1.6+1", "threshold = $200,000",
      Number(hit.inputs.threshold), 200000, 1);
  }
}

// --- G1.6+2 — MFJ AGI $260k (exactly at upper boundary): NIIT $380 ---
// Hand-calc:
//   W-2 $245k + $15k interest. AGI $260k = threshold $250k + $10k. ✓
//   NIIT = min($15k, $10k) × 3.8% = $380.
header("G1.6+2 — MFJ AGI $260k (upper edge): NIIT $380");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 245000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 15000 }],
  });
  const hit = findHit(hits, "G1.6");
  checkTruthy("G1.6+2", "NIIT hit fires at upper-edge AGI", hit != null, true);
  if (hit) {
    check("G1.6+2", "estSavings = $380", hit.estSavings, 380, 1);
  }
}

// --- G1.6+3 — HoH AGI $209k: NIIT $190 ---
// Hand-calc:
//   W-2 $204k + $5k qualified dividends. AGI = $209k. Threshold HoH $200k.
//   In band. NII = $5k (dividends). NIIT = min($5k, $9k) × 3.8% = $190.
header("G1.6+3 — HoH AGI $209k → NIIT $190");
{
  const hits = runPlanning({
    client: { filingStatus: "head_of_household", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 204000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "div", payerName: "Fund",
      ordinaryDividends: 5000, qualifiedDividends: 5000 }],
  });
  const hit = findHit(hits, "G1.6");
  checkTruthy("G1.6+3", "NIIT hit fires for HoH", hit != null, true);
  if (hit) {
    check("G1.6+3", "estSavings = $190", hit.estSavings, 190, 1);
  }
}

// --- G1.6-4 — AGI well above band ---
// Single $220k W-2 alone → AGI = $220k. Threshold $200k + $10k = $210k.
// $220k > $210k → outside band → no fire.
header("G1.6-4 — AGI $220k outside upper band suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 220000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 5000 }],
  });
  checkTruthy("G1.6-4", "no NIIT cliff hit outside band",
    findHit(hits, "G1.6") == null, true);
}

// --- G1.6-5 — AGI in band but no investment income ---
// W-2 only. niitTax = 0. No fire.
header("G1.6-5 — AGI in band, no NII suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 205000, stateCode: "FL" }],
  });
  checkTruthy("G1.6-5", "no NIIT cliff hit without investment income",
    findHit(hits, "G1.6") == null, true);
}

// --- G1.6±6 — AGI just over upper bound ($211k single) → no fire ---
header("G1.6±6 — AGI $211k just over $210k upper bound suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 210000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 1000 }],
  });
  checkTruthy("G1.6±6", "no NIIT cliff hit at $211k (just out of band)",
    findHit(hits, "G1.6") == null, true);
}

// ============================================================================
// G1.7 — §199A QBI wage / UBIA phase-in band (K-1)
// IRS: IRC §199A(b)(2); Rev. Proc. 2023-34 / 2024-40.
// Trigger: K-1 active income > 0 AND §199A QBI > 0
//          AND taxableBeforeQbi in (threshold, top] band per filing status.
// estSavings = 0.5 × QBI × 0.20 × federalMarginalRate (lost-QBI proxy).
// ============================================================================
section("G1.7 §199A QBI phase-in band");

// --- G1.7+1 — Single K-1 active $250k + §199A QBI $200k, TY2024 ---
// Hand-calc:
//   AGI = K-1 active $250k. Engine QBI = 20% × $200k = $40k.
//   taxableBeforeQbi = $250k − $14,600 = $235,400.
//   $235,400 > §199A threshold $191,950 ✓ and ≤ top $241,950 ✓ → in band.
//   taxable = $235,400 − $40k = $195,400. Single 32% bracket
//     ($191,950-$243,725) → marginal 0.32.
//   estSavings = 0.5 × $200k × 0.20 × 0.32 = $6,400.
header("G1.7+1 — Single K-1 $200k QBI in band: savings $6,400 @ 32%");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 250000,
      section199aQbi: 200000,
    }],
  });
  const hit = findHit(hits, "G1.7");
  checkTruthy("G1.7+1", "§199A hit fires", hit != null, true);
  if (hit) {
    check("G1.7+1", "estSavings = $6,400", hit.estSavings, 6400, 5);
    check("G1.7+1", "taxableBeforeQbi = $235,400",
      Number(hit.inputs.taxableBeforeQbi), 235400, 2);
    check("G1.7+1", "marginal = 0.32",
      Number(hit.inputs.federalMarginalRate), 0.32, 0.001);
  }
}

// --- G1.7+2 — MFJ W-2 $200k + K-1 active $300k + §199A QBI $300k ---
// Hand-calc:
//   AGI = $200k W-2 + $300k K-1 active = $500k.
//   Engine QBI = 20% × $300k = $60k.
//   taxableBeforeQbi = $500k − $29,200 = $470,800.
//   $470,800 > MFJ threshold $383,900 ✓ and ≤ top $483,900 ✓ → in band.
//   taxable = $470,800 − $60k = $410,800. MFJ 32% bracket $487,450-? Wait,
//   MFJ 2024 brackets: 24% to $383,900, 32% to $487,450. $410,800 in 32%.
//   marginal = 0.32.
//   estSavings = 0.5 × $300k × 0.20 × 0.32 = $9,600.
header("G1.7+2 — MFJ K-1 $300k QBI in band: savings $9,600 @ 32%");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, stateCode: "FL" }],
    scheduleK1: [{
      taxYear: 2024, entityName: "MFJ S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 300000,
      section199aQbi: 300000,
    }],
  });
  const hit = findHit(hits, "G1.7");
  checkTruthy("G1.7+2", "§199A hit fires (MFJ)", hit != null, true);
  if (hit) {
    check("G1.7+2", "estSavings = $9,600", hit.estSavings, 9600, 5);
  }
}

// --- G1.7+3 — Single W-2 $50k + K-1 active $200k + §199A QBI $80k ---
// Hand-calc:
//   AGI = $250k. Engine QBI = $16k. taxableBeforeQbi = $235,400.
//   In band ✓. taxable = $219,400. Single 32% bracket. marginal 0.32.
//   estSavings = 0.5 × $80k × 0.20 × 0.32 = $2,560.
header("G1.7+3 — Single mixed K-1 + W-2, QBI $80k: savings $2,560 @ 32%");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    scheduleK1: [{
      taxYear: 2024, entityName: "S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 200000,
      section199aQbi: 80000,
    }],
  });
  const hit = findHit(hits, "G1.7");
  checkTruthy("G1.7+3", "§199A hit fires (mixed)", hit != null, true);
  if (hit) {
    check("G1.7+3", "estSavings = $2,560", hit.estSavings, 2560, 5);
  }
}

// --- G1.7-4 — Taxable below threshold (single $100k) ---
header("G1.7-4 — below §199A threshold suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    scheduleK1: [{
      taxYear: 2024, entityName: "S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 50000,
      section199aQbi: 50000,
    }],
  });
  checkTruthy("G1.7-4", "no §199A hit below threshold",
    findHit(hits, "G1.7") == null, true);
}

// --- G1.7-5 — Above phase-in top (MFJ $700k W-2 + K-1 + QBI) ---
header("G1.7-5 — above phase-in top suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 500000, stateCode: "FL" }],
    scheduleK1: [{
      taxYear: 2024, entityName: "S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 200000,
      section199aQbi: 200000,
    }],
  });
  checkTruthy("G1.7-5", "no §199A hit above phase-in top",
    findHit(hits, "G1.7") == null, true);
}

// --- G1.7-6 — No K-1 active income — must NOT fire ---
header("G1.7-6 — No K-1 client suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 230000, stateCode: "FL" }],
  });
  checkTruthy("G1.7-6", "no §199A hit without K-1",
    findHit(hits, "G1.7") == null, true);
}

// --- G1.7±7 — taxableBeforeQbi exactly at threshold $191,950 — must NOT fire ---
// Single, K-1 active = $206,550, QBI $50k. Engine QBI = $10k.
// taxableBeforeQbi = $206,550 − $14,600 = $191,950 exact.
// Strict > threshold → does NOT fire.
header("G1.7±7 — taxableBeforeQbi exactly at threshold: does NOT fire");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    scheduleK1: [{
      taxYear: 2024, entityName: "S-Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 206550,
      section199aQbi: 50000,
    }],
  });
  checkTruthy("G1.7±7", "no §199A hit at threshold exactly",
    findHit(hits, "G1.7") == null, true);
}

// ============================================================================
// G1.9 — Tax-loss harvesting
// IRS: IRC §1211, §1212; Pub 550.
// Trigger: capitalLossDeducted < cap ($3k / $1.5k MFS)
//          AND (LTCG > 0 OR STCG > 0 OR net capital gain/loss ≠ 0)
// estSavings = cap × federal marginal rate.
// ============================================================================
section("G1.9 Tax-loss harvesting");

// --- G1.9+1 — Single $80k W-2 + $10k LTCG: marginal 22% → savings $660 ---
// Hand-calc:
//   AGI = $80k + $10k = $90k. Taxable = $90k − $14,600 = $75,400. Single
//   2024: 22% bracket $47,150-$100,525 → marginal 0.22.
//   No loss this year → capitalLossDeducted = 0 < $3,000 cap.
//   1099-B LTCG > 0 → trigger met.
//   estSavings = $3,000 × 0.22 = $660.
header("G1.9+1 — Single $80k + $10k LTCG @ 22%: savings $660");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", payerName: "Brokerage",
      longTermGainLoss: 10000 }],
  });
  const hit = findHit(hits, "G1.9");
  checkTruthy("G1.9+1", "TLH hit fires", hit != null, true);
  if (hit) {
    check("G1.9+1", "estSavings = $660", hit.estSavings, 660, 1,
      "$3,000 × 0.22 marginal");
    check("G1.9+1", "capitalLossDeducted = 0",
      Number(hit.inputs.capitalLossDeducted), 0, 1);
  }
}

// --- G1.9+2 — MFJ $150k W-2 + $20k STCG: marginal 22% → savings $660 ---
// Hand-calc:
//   AGI = $150k + $20k = $170k. Taxable = $170k − $29,200 = $140,800. MFJ
//   2024: 22% bracket $94,300-$201,050 → marginal 0.22.
//   capitalLossDeducted = 0 < $3,000 ✓. STCG > 0 → trigger ✓.
//   estSavings = $3,000 × 0.22 = $660.
header("G1.9+2 — MFJ $150k + $20k STCG: savings $660");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 150000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", payerName: "Brokerage",
      shortTermGainLoss: 20000 }],
  });
  const hit = findHit(hits, "G1.9");
  checkTruthy("G1.9+2", "TLH hit fires (MFJ STCG)", hit != null, true);
  if (hit) {
    check("G1.9+2", "estSavings = $660", hit.estSavings, 660, 1);
  }
}

// --- G1.9+3 — Single $300k W-2 + $50k LTCG: marginal 35% → savings $1,050 ---
// Hand-calc:
//   AGI = $350k. Taxable = $350k − $14,600 = $335,400.
//   Single 2024 35% bracket $243,725-$609,350 → marginal 0.35.
//   estSavings = $3,000 × 0.35 = $1,050.
header("G1.9+3 — Single high earner @ 35%: savings $1,050");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 300000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", payerName: "Brokerage",
      longTermGainLoss: 50000 }],
  });
  const hit = findHit(hits, "G1.9");
  checkTruthy("G1.9+3", "TLH hit fires (35% marginal)", hit != null, true);
  if (hit) {
    check("G1.9+3", "estSavings = $1,050", hit.estSavings, 1050, 2);
  }
}

// --- G1.9-4 — Already maxed loss ($3k deducted from carryforward) ---
// Capital_loss_carryforward_short = $5,000 → engine deducts $3,000 → cap hit.
// Trigger requires capitalLossDeducted < $3,000 → no fire.
header("G1.9-4 — Already maxed at $3,000 loss deduction suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "capital_loss_carryforward_short", amount: 5000, isApplied: true },
    ],
  });
  checkTruthy("G1.9-4", "no TLH hit when already at $3k cap",
    findHit(hits, "G1.9") == null, true);
}

// --- G1.9-5 — No capital market activity (W-2 only) ---
header("G1.9-5 — No capital activity suppresses (negative)");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "FL" }],
  });
  checkTruthy("G1.9-5", "no TLH hit for pure W-2 client",
    findHit(hits, "G1.9") == null, true);
}

// --- G1.9±6 — Boundary: MFS cap is $1,500 ---
// MFS, $80k W-2, no current-year gains, $3,000 LT carryforward → net loss
// $3k → engine deducts MFS cap $1,500. Trigger requires
// capitalLossDeducted < $1,500 MFS cap → $1,500 is NOT < $1,500 → no fire.
// (NB: omitting LTCG / STCG is intentional — gains would absorb the
// carryforward before the cap could bind.)
header("G1.9±6 — MFS already at $1,500 cap suppresses");
{
  const hits = runPlanning({
    client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "FL" }],
    adjustments: [
      { adjustmentType: "capital_loss_carryforward_short", amount: 3000, isApplied: true },
    ],
  });
  checkTruthy("G1.9±6", "no TLH hit when MFS at $1,500 cap",
    findHit(hits, "G1.9") == null, true);
}

// --- G1.9±7 — Single below cap with $1k carryforward already in use ---
// $1k carryforward → engine deducts $1k. capitalLossDeducted = $1,000 < $3k cap.
// Still has 1099-B activity → fires. estSavings = $3k × marginal.
header("G1.9±7 — Single with $1k loss deducted (below cap): fires");
{
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "b", payerName: "Brokerage",
      longTermGainLoss: 0 }],
    adjustments: [
      { adjustmentType: "capital_loss_carryforward_short", amount: 1000, isApplied: true },
    ],
  });
  const hit = findHit(hits, "G1.9");
  checkTruthy("G1.9±7", "TLH fires below cap with partial loss",
    hit != null, true);
  if (hit) {
    check("G1.9±7", "capitalLossDeducted = $1,000",
      Number(hit.inputs.capitalLossDeducted), 1000, 1);
  }
}

// ============================================================================
// RESULTS
// ============================================================================

console.log(`\nPASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  [${f.rule}] ${f.label}`);
    console.log(`      expected=${f.expected}  actual=${f.actual}  delta=${f.delta ?? ""}`);
    if (f.cite) console.log(`      cite: ${f.cite}`);
  }
  process.exit(1);
}
console.log("\nALL PLANNING-DETECTOR ASSERTIONS PASS");
