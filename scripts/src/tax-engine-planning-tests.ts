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
