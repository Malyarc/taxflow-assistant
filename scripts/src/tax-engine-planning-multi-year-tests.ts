/**
 * Phase G4 — Multi-year planning detector tests.
 *
 * Each rule (G4.1 → G4.5) requires:
 *   - ≥ 3 positive cases (trigger fires with correct estSavings)
 *   - ≥ 2 negative cases (trigger does NOT fire)
 *   - ≥ 1 boundary / edge case
 *
 * Same discipline as G1: hand-calc the expected value against the IRS-cited
 * rule BEFORE asserting, leave the hand-calc trace as a comment, and cite
 * the source. The detector synthesizes TaxReturnSnapshot[] inputs directly
 * (no engine round-trip) — this isolates the detector logic from any
 * upstream tax-engine drift.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-planning-multi-year-tests.ts
 */

import type { ClientFacts } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  evaluateMultiYearOpportunities,
  type TaxReturnSnapshot,
} from "../../artifacts/api-server/src/lib/planningEngineMultiYear";
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

function findHit(hits: OpportunityHit[], id: string): OpportunityHit | undefined {
  return hits.find((h) => h.strategyId === id);
}

/**
 * Build a minimal TaxReturnSnapshot with zero defaults; tests override only
 * the fields they care about. Keeps the test bodies focused on the rule
 * being verified rather than ceremonial setup.
 */
function snapshot(overrides: Partial<TaxReturnSnapshot> & { taxYear: number; filingStatus: string }): TaxReturnSnapshot {
  return {
    adjustedGrossIncome: 0,
    taxableIncome: 0,
    itemizedDeductions: 0,
    amtTax: 0,
    niitTax: 0,
    charitableDeductible: 0,
    capitalLossCarryforwardShort: 0,
    capitalLossCarryforwardLong: 0,
    scheduleEPassiveLossSuspended: 0,
    k1PassiveLossSuspended: 0,
    ...overrides,
  };
}

const baseClient = (overrides: Partial<ClientFacts> = {}): ClientFacts => ({
  filingStatus: "single",
  state: "FL",
  taxYear: 2024,
  ...overrides,
} as ClientFacts);

// ============================================================================
// G4.1 — Persistent NIIT exposure
// IRS: IRC §1411; Form 8960.
// Trigger: niitTax > 0 in current year AND niitTax > 0 in ≥ 1 prior year.
// Formula: estSavings = avg(niitTax across firing years) × 0.5
// ============================================================================
section("G4.1 Persistent NIIT exposure");

// --- G4.1+1: 2 years NIIT, current $5,000, prior $4,000 ---
// Hand-calc: firingYears = [2025, 2024]; avg = (5000+4000)/2 = 4500
// estSavings = 4500 × 0.5 = 2,250
header("G4.1+1 — 2 years NIIT, current $5,000 + prior $4,000, est $2,250");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "single" }),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", taxableIncome: 220000, adjustedGrossIncome: 220000, niitTax: 5000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", taxableIncome: 210000, adjustedGrossIncome: 210000, niitTax: 4000 }),
    ],
  });
  const hit = findHit(hits, "G4.1");
  checkTruthy("G4.1+1", "hit fires", hit != null, true, "IRC §1411 — multi-year NIIT");
  if (hit) {
    check("G4.1+1", "estSavings = $2,250", hit.estSavings, 2250, 1, "(5000+4000)/2 × 0.5");
    check("G4.1+1", "yearsWithNiit = 2", Number(hit.inputs.yearsWithNiit), 2, 0);
    check("G4.1+1", "avgNiit = $4,500", Number(hit.inputs.avgNiit), 4500, 1);
  }
}

// --- G4.1+2: 3 years NIIT, current $10k, prior $8k, prior $6k ---
// Hand-calc: avg = (10000+8000+6000)/3 = 8000; estSavings = 8000 × 0.5 = 4000
header("G4.1+2 — 3 years NIIT, $10k+$8k+$6k, avg $8k, est $4,000");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "married_filing_jointly", niitTax: 10000 }),
      snapshot({ taxYear: 2024, filingStatus: "married_filing_jointly", niitTax: 8000 }),
      snapshot({ taxYear: 2023, filingStatus: "married_filing_jointly", niitTax: 6000 }),
    ],
  });
  const hit = findHit(hits, "G4.1");
  checkTruthy("G4.1+2", "hit fires", hit != null, true);
  if (hit) {
    check("G4.1+2", "estSavings = $4,000", hit.estSavings, 4000, 1);
    check("G4.1+2", "yearsWithNiit = 3", Number(hit.inputs.yearsWithNiit), 3, 0);
    check("G4.1+2", "avgNiit = $8,000", Number(hit.inputs.avgNiit), 8000, 1);
  }
}

// --- G4.1+3: Gap year — current + skip + prior year with NIIT ---
// Hand-calc: priorWithNiit = [2023 only]; firingYears = [2025, 2023]
// avg = (7000+5000)/2 = 6000; estSavings = 6000 × 0.5 = 3000
header("G4.1+3 — Current + skip + prior; priorWithNiit non-consecutive");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "single" }),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", niitTax: 7000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", niitTax: 0 }),
      snapshot({ taxYear: 2023, filingStatus: "single", niitTax: 5000 }),
    ],
  });
  const hit = findHit(hits, "G4.1");
  checkTruthy("G4.1+3", "hit fires (non-consecutive)", hit != null, true);
  if (hit) {
    check("G4.1+3", "estSavings = $3,000", hit.estSavings, 3000, 1);
    check("G4.1+3", "yearsWithNiit = 2", Number(hit.inputs.yearsWithNiit), 2, 0);
  }
}

// --- G4.1-1: Only current year NIIT — does NOT fire ---
header("G4.1-1 — Single year NIIT only, no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", niitTax: 8000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", niitTax: 0 }),
    ],
  });
  const hit = findHit(hits, "G4.1");
  checkTruthy("G4.1-1", "no hit", hit == null, true);
}

// --- G4.1-2: Current year no NIIT, prior has it — does NOT fire (current must have NIIT) ---
header("G4.1-2 — Current year no NIIT, no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", niitTax: 0 }),
      snapshot({ taxYear: 2024, filingStatus: "single", niitTax: 6000 }),
    ],
  });
  const hit = findHit(hits, "G4.1");
  checkTruthy("G4.1-2", "no hit when current = 0", hit == null, true);
}

// --- G4.1 boundary: Only 1 year of history → no fire ---
header("G4.1 boundary — only 1 year of history");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [snapshot({ taxYear: 2025, filingStatus: "single", niitTax: 10000 })],
  });
  checkTruthy("G4.1-3", "no hit with < 2 years history", hits.length === 0, true);
}

// ============================================================================
// G4.2 — Persistent AMT exposure
// IRS: IRC §55-§59; Form 6251.
// Trigger: amtTax > 0 in current year AND amtTax > 0 in ≥ 1 prior year.
// Formula: estSavings = avg(amtTax across firing years) × 0.4
// ============================================================================
section("G4.2 Persistent AMT exposure");

// --- G4.2+1: 2 years AMT, current $8,000, prior $6,000 ---
// Hand-calc: avg = (8000+6000)/2 = 7000; estSavings = 7000 × 0.4 = 2800
header("G4.2+1 — 2 years AMT, $8k + $6k, est $2,800");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", amtTax: 8000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", amtTax: 6000 }),
    ],
  });
  const hit = findHit(hits, "G4.2");
  checkTruthy("G4.2+1", "hit fires", hit != null, true);
  if (hit) {
    check("G4.2+1", "estSavings = $2,800", hit.estSavings, 2800, 1);
    check("G4.2+1", "avgAmt = $7,000", Number(hit.inputs.avgAmt), 7000, 1);
  }
}

// --- G4.2+2: Tech founder ISO pattern — 3 years AMT growing ---
// Hand-calc: avg = (25k+15k+10k)/3 = 16,667; estSavings = 16,667 × 0.4 = 6,667
header("G4.2+2 — 3 years AMT $25k+$15k+$10k (tech founder ISO), est $6,667");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "single" }),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", amtTax: 25000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", amtTax: 15000 }),
      snapshot({ taxYear: 2023, filingStatus: "single", amtTax: 10000 }),
    ],
  });
  const hit = findHit(hits, "G4.2");
  checkTruthy("G4.2+2", "hit fires", hit != null, true);
  if (hit) {
    check("G4.2+2", "estSavings ~ $6,667", hit.estSavings, 6667, 1);
    check("G4.2+2", "yearsWithAmt = 3", Number(hit.inputs.yearsWithAmt), 3, 0);
  }
}

// --- G4.2+3: Modest 2-year AMT for MFJ ---
// Hand-calc: avg = (3500+2500)/2 = 3000; estSavings = 3000 × 0.4 = 1200
header("G4.2+3 — MFJ AMT modest $3.5k + $2.5k, est $1,200");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "married_filing_jointly", amtTax: 3500 }),
      snapshot({ taxYear: 2024, filingStatus: "married_filing_jointly", amtTax: 2500 }),
    ],
  });
  const hit = findHit(hits, "G4.2");
  checkTruthy("G4.2+3", "hit fires", hit != null, true);
  if (hit) check("G4.2+3", "estSavings = $1,200", hit.estSavings, 1200, 1);
}

// --- G4.2-1: Only current year AMT — does NOT fire ---
header("G4.2-1 — Single year AMT only, no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", amtTax: 12000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", amtTax: 0 }),
    ],
  });
  const hit = findHit(hits, "G4.2");
  checkTruthy("G4.2-1", "no hit", hit == null, true);
}

// --- G4.2-2: No AMT in any year — does NOT fire ---
header("G4.2-2 — Zero AMT in all years, no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", amtTax: 0 }),
      snapshot({ taxYear: 2024, filingStatus: "single", amtTax: 0 }),
    ],
  });
  const hit = findHit(hits, "G4.2");
  checkTruthy("G4.2-2", "no hit", hit == null, true);
}

// ============================================================================
// G4.3 — Permanent bunching strategy (persistent std-ded cliff)
// IRS: IRC §170; §63.
// Trigger: itemized within ±15% of std-ded for current AND ≥1 prior year,
//          charitableDeductible > 0 in current year.
// Formula: estSavings = stdDed × 0.25 × federalMarginalRate
// ============================================================================
section("G4.3 Permanent bunching strategy");

// --- G4.3+1: MFJ TY2024 + 2025 at cliff with charity ---
// Hand-calc:
//   Current year (TY2025): MFJ std ded = $30,000. Band ±15% = $25,500 to $34,500.
//     Itemized = $30,500 (in band).
//   Prior year (TY2024): MFJ std ded = $29,200. Band ±15% = $24,820 to $33,580.
//     Itemized = $28,800 (in band).
//   Charity in current = $8,000 (> 0).
//   Marginal rate from TY2025 taxableIncome = $150,000:
//     MFJ 2025 brackets (Rev. Proc. 2024-40): 10% to $23,850 | 12% to $96,950 |
//                                              22% to $206,700 | 24% to $394,600.
//     $150,000 is in the 22% bracket → marginal = 0.22.
//   estSavings = $30,000 × 0.25 × 0.22 = $1,650.
header("G4.3+1 — MFJ 2 years at cliff with charity, est $1,650");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "married_filing_jointly",
        taxableIncome: 150000, adjustedGrossIncome: 180000,
        itemizedDeductions: 30500, charitableDeductible: 8000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "married_filing_jointly",
        taxableIncome: 145000, adjustedGrossIncome: 175000,
        itemizedDeductions: 28800, charitableDeductible: 7500,
      }),
    ],
  });
  const hit = findHit(hits, "G4.3");
  checkTruthy("G4.3+1", "hit fires", hit != null, true, "IRC §170 — bunching cliff");
  if (hit) {
    check("G4.3+1", "estSavings = $1,650", hit.estSavings, 1650, 2,
      "$30,000 stdDed × 0.25 × 0.22 marginal");
    check("G4.3+1", "yearsAtCliff = 2", Number(hit.inputs.yearsAtCliff), 2, 0);
    check("G4.3+1", "fed marginal = 0.22", Number(hit.inputs.federalMarginalRate), 0.22, 0.001,
      "MFJ TY2025 $150k taxable is 22% bracket");
  }
}

// --- G4.3+2: Single TY2024 + 2025 at cliff ---
// Hand-calc:
//   Current (TY2025): Single std ded = $15,000. Band $12,750-$17,250. Itemized = $14,800 (in band).
//   Prior (TY2024): Single std ded = $14,600. Band $12,410-$16,790. Itemized = $14,200 (in band).
//   Charity in current = $3,000.
//   Marginal: Single 2025 brackets: 10% to $11,925 | 12% to $48,475 | 22% to $103,350.
//     taxableIncome = $80,000 → 22% marginal.
//   estSavings = $15,000 × 0.25 × 0.22 = $825.
header("G4.3+2 — Single 2 years at cliff TY2024+2025, est $825");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "single" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "single",
        taxableIncome: 80000, itemizedDeductions: 14800, charitableDeductible: 3000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "single",
        taxableIncome: 75000, itemizedDeductions: 14200, charitableDeductible: 2500,
      }),
    ],
  });
  const hit = findHit(hits, "G4.3");
  checkTruthy("G4.3+2", "hit fires", hit != null, true);
  if (hit) check("G4.3+2", "estSavings = $825", hit.estSavings, 825, 2);
}

// --- G4.3+3: 3 years all at cliff — uses current year's std ded ---
// Hand-calc:
//   3 years at cliff. Current (TY2025): MFJ std ded = $30,000, itemized $30,000 (right on).
//   Marginal: MFJ 2025 taxableIncome $300,000 → 24% bracket (between $206,700 and $394,600).
//   estSavings = $30,000 × 0.25 × 0.24 = $1,800.
header("G4.3+3 — MFJ 3 years at cliff, 24% marginal, est $1,800");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "married_filing_jointly",
        taxableIncome: 300000, itemizedDeductions: 30000, charitableDeductible: 12000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "married_filing_jointly",
        taxableIncome: 290000, itemizedDeductions: 29500, charitableDeductible: 11000,
      }),
      snapshot({
        taxYear: 2023, filingStatus: "married_filing_jointly",
        taxableIncome: 270000, itemizedDeductions: 30200, charitableDeductible: 10000,
      }),
    ],
  });
  const hit = findHit(hits, "G4.3");
  checkTruthy("G4.3+3", "hit fires", hit != null, true);
  if (hit) {
    check("G4.3+3", "estSavings = $1,800", hit.estSavings, 1800, 2);
    check("G4.3+3", "yearsAtCliff = 3", Number(hit.inputs.yearsAtCliff), 3, 0);
  }
}

// --- G4.3-1: Itemized far below std ded (took std ded comfortably) — no fire ---
// MFJ std ded TY2024 = $29,200. Itemized = $10,000 is well below 85% band ($24,820).
header("G4.3-1 — Itemized far below std-ded band, no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "married_filing_jointly",
        taxableIncome: 150000, itemizedDeductions: 10000, charitableDeductible: 5000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "married_filing_jointly",
        taxableIncome: 145000, itemizedDeductions: 9000, charitableDeductible: 4500,
      }),
    ],
  });
  const hit = findHit(hits, "G4.3");
  checkTruthy("G4.3-1", "no hit", hit == null, true);
}

// --- G4.3-2: No charitable cash in current year — no fire (no bunching lever) ---
header("G4.3-2 — At cliff but no charitable, no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "married_filing_jointly",
        taxableIncome: 150000, itemizedDeductions: 30500, charitableDeductible: 0,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "married_filing_jointly",
        taxableIncome: 145000, itemizedDeductions: 28800, charitableDeductible: 0,
      }),
    ],
  });
  const hit = findHit(hits, "G4.3");
  checkTruthy("G4.3-2", "no hit", hit == null, true);
}

// --- G4.3 boundary: Current at cliff, prior far above (itemized comfortably). No fire ---
header("G4.3 boundary — current at cliff, prior far above; no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "married_filing_jointly",
        taxableIncome: 150000, itemizedDeductions: 30500, charitableDeductible: 8000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "married_filing_jointly",
        taxableIncome: 145000, itemizedDeductions: 50000, charitableDeductible: 7500, // far above $33,580
      }),
    ],
  });
  const hit = findHit(hits, "G4.3");
  checkTruthy("G4.3-3", "no hit (only 1 year at cliff)", hit == null, true);
}

// ============================================================================
// G4.4 — Capital loss carryforward unused
// IRS: IRC §1211; §1212; Pub 550.
// Trigger: total cap loss carryforward > $20,000 AND has not declined materially YoY.
// Formula: estSavings = min(currentCarryforward, $20,000) × federalMarginalRate
// ============================================================================
section("G4.4 Capital loss carryforward unused");

// --- G4.4+1: $50k carryforward stuck for 2 years, single 22% marginal ---
// Hand-calc:
//   Current cf = $50k ($10k short + $40k long). Prior cf = $50k. Delta = 0 → no decline.
//   absorbable = min($50k, $20k) = $20k.
//   Marginal: Single 2025 taxable $80k → 22%.
//   estSavings = $20k × 0.22 = $4,400.
header("G4.4+1 — $50k cf stuck 2 years, 22% marginal, est $4,400");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "single" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "single", taxableIncome: 80000,
        capitalLossCarryforwardShort: 10000, capitalLossCarryforwardLong: 40000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "single", taxableIncome: 75000,
        capitalLossCarryforwardShort: 10000, capitalLossCarryforwardLong: 40000,
      }),
    ],
  });
  const hit = findHit(hits, "G4.4");
  checkTruthy("G4.4+1", "hit fires", hit != null, true, "IRC §1211 — unused cap loss");
  if (hit) {
    check("G4.4+1", "estSavings = $4,400", hit.estSavings, 4400, 1);
    check("G4.4+1", "currentCarryforward = $50,000", Number(hit.inputs.currentCarryforward), 50000, 1);
    check("G4.4+1", "absorbable = $20,000", Number(hit.inputs.absorbable), 20000, 1);
  }
}

// --- G4.4+2: $25k cf, marginal 24% MFJ ---
// Hand-calc:
//   Current cf = $25k. Prior cf = $25,500 (declined $500 — within $1k tolerance, still fires).
//   absorbable = min($25k, $20k) = $20k.
//   Marginal: MFJ 2025 taxable $250k → 24% (between $206,700 and $394,600).
//   estSavings = $20k × 0.24 = $4,800.
header("G4.4+2 — $25k cf MFJ 24%, est $4,800 (small decline within tolerance)");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "married_filing_jointly", taxableIncome: 250000,
        capitalLossCarryforwardLong: 25000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "married_filing_jointly", taxableIncome: 240000,
        capitalLossCarryforwardLong: 25500,
      }),
    ],
  });
  const hit = findHit(hits, "G4.4");
  checkTruthy("G4.4+2", "hit fires (small decline within tolerance)", hit != null, true);
  if (hit) check("G4.4+2", "estSavings = $4,800", hit.estSavings, 4800, 1);
}

// --- G4.4+3: cf growing (worsening) — fires ---
// Hand-calc:
//   Current cf = $80k (grew from $60k — adding more losses).
//   absorbable = min($80k, $20k) = $20k.
//   Marginal: Single 2025 taxable $200k → 32% bracket
//     (Single 2025: $103,350 < $200k < $197,300? wait $197,300 is 24%, $250,525 starts 32%).
//   Let me recheck Single 2025 brackets per Rev. Proc. 2024-40:
//     10% to $11,925, 12% to $48,475, 22% to $103,350, 24% to $197,300,
//     32% to $250,525, 35% to $626,350, 37% above.
//     $200k is between $197,300 and $250,525 → 32% marginal.
//   estSavings = $20k × 0.32 = $6,400.
header("G4.4+3 — Single $80k cf growing, 32% marginal, est $6,400");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "single" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "single", taxableIncome: 200000,
        capitalLossCarryforwardShort: 30000, capitalLossCarryforwardLong: 50000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "single", taxableIncome: 190000,
        capitalLossCarryforwardShort: 20000, capitalLossCarryforwardLong: 40000,
      }),
    ],
  });
  const hit = findHit(hits, "G4.4");
  checkTruthy("G4.4+3", "hit fires (growing cf)", hit != null, true);
  if (hit) {
    check("G4.4+3", "estSavings = $6,400", hit.estSavings, 6400, 1);
    check("G4.4+3", "fed marginal = 0.32", Number(hit.inputs.federalMarginalRate), 0.32, 0.001);
  }
}

// --- G4.4-1: cf actively declining (client is using it) — no fire ---
// Current cf = $40k. Prior cf = $50k. Declined $10k — well past $1k tolerance.
header("G4.4-1 — cf declining $10k YoY (client absorbing), no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", taxableIncome: 80000, capitalLossCarryforwardLong: 40000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", taxableIncome: 75000, capitalLossCarryforwardLong: 50000 }),
    ],
  });
  const hit = findHit(hits, "G4.4");
  checkTruthy("G4.4-1", "no hit", hit == null, true);
}

// --- G4.4-2: cf below $20k threshold — no fire ---
header("G4.4-2 — cf $15k below threshold, no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", taxableIncome: 80000, capitalLossCarryforwardLong: 15000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", taxableIncome: 75000, capitalLossCarryforwardLong: 15000 }),
    ],
  });
  const hit = findHit(hits, "G4.4");
  checkTruthy("G4.4-2", "no hit", hit == null, true);
}

// --- G4.4 boundary: cf exactly $20k, unchanged ---
// absorbable = min($20k, $20k) = $20k. Marginal 22%. estSavings = $20k × 0.22 = $4,400.
header("G4.4 boundary — cf exactly $20k, est $4,400");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", taxableIncome: 80000, capitalLossCarryforwardLong: 20000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", taxableIncome: 75000, capitalLossCarryforwardLong: 20000 }),
    ],
  });
  const hit = findHit(hits, "G4.4");
  checkTruthy("G4.4-3", "hit fires at boundary", hit != null, true);
  if (hit) check("G4.4-3", "estSavings = $4,400", hit.estSavings, 4400, 1);
}

// ============================================================================
// G4.5 — Passive activity loss suspension growing
// IRS: IRC §469; Pub 925.
// Trigger: total suspended PAL (Sched E + K-1) > $5,000 AND grew year-over-year.
// Formula: estSavings = (currentSuspended - priorSuspended) × marginalRate × 0.5
// ============================================================================
section("G4.5 Passive activity loss suspension growing");

// --- G4.5+1: Sched E + K-1 PAL grew $10k, MFJ 22% ---
// Hand-calc:
//   Current PAL: $20k Sched E + $10k K-1 = $30k. Prior PAL: $15k + $5k = $20k. Growth = $10k.
//   Marginal: MFJ 2025 taxable $150k → 22% (between $96,950 and $206,700).
//   estSavings = $10k × 0.22 × 0.5 = $1,100.
header("G4.5+1 — MFJ PAL grew $30k - $20k = $10k, est $1,100");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "married_filing_jointly", taxableIncome: 150000,
        scheduleEPassiveLossSuspended: 20000, k1PassiveLossSuspended: 10000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "married_filing_jointly", taxableIncome: 145000,
        scheduleEPassiveLossSuspended: 15000, k1PassiveLossSuspended: 5000,
      }),
    ],
  });
  const hit = findHit(hits, "G4.5");
  checkTruthy("G4.5+1", "hit fires", hit != null, true, "IRC §469 — PAL growth");
  if (hit) {
    check("G4.5+1", "estSavings = $1,100", hit.estSavings, 1100, 1);
    check("G4.5+1", "growth = $10,000", Number(hit.inputs.growth), 10000, 1);
    check("G4.5+1", "fed marginal = 0.22", Number(hit.inputs.federalMarginalRate), 0.22, 0.001);
  }
}

// --- G4.5+2: K-1 only PAL grew $15k, Single 32% ---
// Hand-calc:
//   Current K-1 PAL $25k, prior $10k. Growth $15k.
//   Single 2025 taxable $200k → 32% marginal.
//   estSavings = $15k × 0.32 × 0.5 = $2,400.
header("G4.5+2 — K-1 PAL grew $15k Single 32%, est $2,400");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "single" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "single", taxableIncome: 200000,
        k1PassiveLossSuspended: 25000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "single", taxableIncome: 190000,
        k1PassiveLossSuspended: 10000,
      }),
    ],
  });
  const hit = findHit(hits, "G4.5");
  checkTruthy("G4.5+2", "hit fires", hit != null, true);
  if (hit) check("G4.5+2", "estSavings = $2,400", hit.estSavings, 2400, 1);
}

// --- G4.5+3: Modest growth $6k, MFJ 24% ---
// Hand-calc:
//   Current Sched E PAL $12k, prior $6k. Growth = $6k.
//   MFJ 2025 taxable $250k → 24% (between $206,700 and $394,600).
//   estSavings = $6k × 0.24 × 0.5 = $720.
header("G4.5+3 — Sched E PAL grew $6k MFJ 24%, est $720");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "married_filing_jointly", taxableIncome: 250000,
        scheduleEPassiveLossSuspended: 12000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "married_filing_jointly", taxableIncome: 240000,
        scheduleEPassiveLossSuspended: 6000,
      }),
    ],
  });
  const hit = findHit(hits, "G4.5");
  checkTruthy("G4.5+3", "hit fires", hit != null, true);
  if (hit) check("G4.5+3", "estSavings = $720", hit.estSavings, 720, 1);
}

// --- G4.5-1: PAL shrinking (client absorbing) — no fire ---
header("G4.5-1 — PAL shrinking, no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", taxableIncome: 100000, scheduleEPassiveLossSuspended: 10000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", taxableIncome: 95000, scheduleEPassiveLossSuspended: 15000 }),
    ],
  });
  const hit = findHit(hits, "G4.5");
  checkTruthy("G4.5-1", "no hit", hit == null, true);
}

// --- G4.5-2: PAL below $5k threshold even if grew — no fire ---
header("G4.5-2 — PAL $4k below threshold, no fire");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", taxableIncome: 100000, scheduleEPassiveLossSuspended: 4000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", taxableIncome: 95000, scheduleEPassiveLossSuspended: 1000 }),
    ],
  });
  const hit = findHit(hits, "G4.5");
  checkTruthy("G4.5-2", "no hit", hit == null, true);
}

// --- G4.5 boundary: PAL exactly $5k AND grew by $1k — fires (smallest growth) ---
// Hand-calc: growth = $1k. Single 2025 taxable $80k → 22%. estSavings = $1k × 0.22 × 0.5 = $110.
header("G4.5 boundary — PAL $5k grew by $1k, est $110");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [
      snapshot({ taxYear: 2025, filingStatus: "single", taxableIncome: 80000, scheduleEPassiveLossSuspended: 5000 }),
      snapshot({ taxYear: 2024, filingStatus: "single", taxableIncome: 75000, scheduleEPassiveLossSuspended: 4000 }),
    ],
  });
  const hit = findHit(hits, "G4.5");
  checkTruthy("G4.5-3", "hit fires at boundary", hit != null, true);
  if (hit) check("G4.5-3", "estSavings = $110", hit.estSavings, 110, 1);
}

// ============================================================================
// Cross-rule scenarios — multiple G4 hits on same client
// ============================================================================
section("Cross-rule — multi-hit scenarios");

// High-income real-estate investor: persistent NIIT + AMT + PAL growth
// 3 of the 5 G4 rules should fire on one client.
header("Cross — RE investor with NIIT + AMT + PAL growth fires 3 G4 rules");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient({ filingStatus: "married_filing_jointly" }),
    history: [
      snapshot({
        taxYear: 2025, filingStatus: "married_filing_jointly", taxableIncome: 350000,
        niitTax: 4000, amtTax: 8000,
        scheduleEPassiveLossSuspended: 35000,
      }),
      snapshot({
        taxYear: 2024, filingStatus: "married_filing_jointly", taxableIncome: 320000,
        niitTax: 3500, amtTax: 6000,
        scheduleEPassiveLossSuspended: 20000,
      }),
    ],
  });
  checkTruthy("X+1", "G4.1 fires", findHit(hits, "G4.1") != null, true);
  checkTruthy("X+1", "G4.2 fires", findHit(hits, "G4.2") != null, true);
  checkTruthy("X+1", "G4.5 fires", findHit(hits, "G4.5") != null, true);
  checkTruthy("X+1", "G4.3 does NOT fire (no itemized cliff)", findHit(hits, "G4.3") == null, true);
  checkTruthy("X+1", "G4.4 does NOT fire (no cap loss cf)", findHit(hits, "G4.4") == null, true);
  // Sort verification: hits ordered by estSavings desc.
  for (let i = 1; i < hits.length; i++) {
    checkTruthy("X+1", `sort order [${i-1}] >= [${i}]`,
      hits[i - 1].estSavings >= hits[i].estSavings, true);
  }
}

// Single year of history — no G4 hits fire
header("Cross — single year history, no G4 hits");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [snapshot({ taxYear: 2025, filingStatus: "single", taxableIncome: 200000, niitTax: 5000, amtTax: 3000 })],
  });
  checkTruthy("X+2", "zero hits with 1-year history", hits.length === 0, true);
}

// Zero years history (defensive)
header("Cross — empty history, no crash");
{
  const hits = evaluateMultiYearOpportunities({
    client: baseClient(),
    history: [],
  });
  checkTruthy("X+3", "zero hits with empty history", hits.length === 0, true);
}

// ============================================================================
// Report
// ============================================================================
console.log("\n========== RESULTS ==========");
console.log(`PASSED: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`\nFAILED: ${FAIL.length}`);
  for (const f of FAIL) {
    console.log(`  ✗ [${f.rule}] ${f.label}: expected ${f.expected}, got ${f.actual}` +
      (f.delta != null ? ` (delta ${f.delta})` : "") +
      (f.cite ? ` — ${f.cite}` : ""));
  }
  process.exit(1);
} else {
  console.log("\nALL G4 MULTI-YEAR PLANNING-DETECTOR ASSERTIONS PASS");
}
