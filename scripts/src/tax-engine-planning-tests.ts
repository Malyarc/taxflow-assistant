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
