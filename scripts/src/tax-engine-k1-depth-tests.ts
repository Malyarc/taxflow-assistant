/**
 * K-1 DEPTH — pure-engine tests for the session-1 K-1 refinements:
 *   1a. Guaranteed payments (1065 Box 4, §707(c)) — AGI + SE, excluded from QBI.
 *   1b. Basis / at-risk loss limitation (§704(d) / §1366(d) / §465).
 *   1c. Per-business SSTB phase-out (§199A(d)(3)).
 *
 * Invokes computeTaxReturnPure directly. No DB, no API. Every expected value is
 * hand-calc'd against the published IRS rule in the comment block above it.
 *
 * Hand-calc references:
 *   - 2024 single std ded: $14,600; MFJ: $29,200.
 *   - 2024 single brackets (Rev. Proc. 2023-34):
 *       10% to $11,600 | 12% to $47,150 | 22% to $100,525 | 24% to $191,950
 *       32% to $243,725 | 35% to $609,350 | 37% above
 *   - Schedule SE: net SE = 92.35% × SE earnings; SS 12.4% to $168,600 (2024);
 *     Medicare 2.9% on all; deductible half = SE tax / 2.
 *   - §199A: 20% × QBI, capped at 20% × (taxable income − net cap gain).
 *     Guaranteed payments are NOT QBI (§199A(c)(4)). K-1 QBI is NOT reduced by
 *     the half-SE deduction (only Schedule C is) — per engine invariant.
 *   - §704(d)/§1366(d): a partner/shareholder loss is deductible only up to basis;
 *     §465 then limits to the amount at risk. Excess suspended (carryforward).
 *   - §199A(d)(3): SSTB QBI phases out over the band ($191,950–$241,950 single /
 *     $383,900–$483,900 MFJ for 2024); $0 above the top of band.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-k1-depth-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// 1a — GUARANTEED PAYMENTS (Box 4 §707(c))
// ════════════════════════════════════════════════════════════════════════════

// GP-1 — Real partnership K-1: Box 1 ordinary + Box 4 GP + Box 14A (incl. GP).
// Filer: single 2024, NO W-2. Partnership K-1: Box 1 = $60,000 (active),
//        Box 4 = $40,000 GP, Box 14A = $100,000 SE (a real K-1 reports 14A
//        INCLUSIVE of the guaranteed payment).
// Hand-calc:
//   Total income (Line 9) = Box 1 60,000 + Box 4 GP 40,000 = 100,000
//   SE base = max(Box 14A 100,000, Box 4 40,000) = 100,000  (no double-count)
//     net SE = 100,000 × 0.9235 = 92,350
//     SS  = 92,350 × 0.124 = 11,451.40   (92,350 < 168,600 wage base)
//     Med = 92,350 × 0.029 =  2,678.15
//     SE tax = 14,129.55   ;  deductible half = 7,064.775
//   AGI = 100,000 − 7,064.775 = 92,935.225
//   QBI base = Box 1 60,000 only (GP excluded §199A(c)(4); K-1 QBI not net of half-SE)
//     taxable before QBI = 92,935.225 − 14,600 = 78,335.225
//     cap = 20% × 78,335.225 = 15,667.045 ; tentative = 20% × 60,000 = 12,000
//     QBI deduction = min(12,000, 15,667.045) = 12,000
//   Taxable = 78,335.225 − 12,000 = 66,335.225
//   Income tax (single 2024): 1,160 + 4,266 + 22%×(66,335.225 − 47,150)
//     = 1,160 + 4,266 + 22%×19,185.225 = 1,160 + 4,266 + 4,220.7495 = 9,646.7495
//   federalTaxLiability = income tax 9,646.7495 + SE tax 14,129.55 = 23,776.2995
header("GP-1 — partnership K-1 Box 1 + Box 4 GP + Box 14A (real K-1)");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024,
      entityName: "Acme Partners LP",
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: 60000,
      box4GuaranteedPayments: 40000,
      selfEmploymentEarnings: 100000,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Total income = $100,000 (Box 1 + GP)", r.totalIncome, 100000, 1);
  check("K-1 guaranteed payments = $40,000", r.scheduleK1.totalGuaranteedPayments, 40000, 0.01);
  check("K-1 active ordinary = $60,000", r.scheduleK1.totalActiveOrdinaryIncome, 60000, 0.01);
  check("K-1 SE earnings = $100,000 (max(14A,GP), no double-count)", r.scheduleK1.totalSelfEmploymentEarnings, 100000, 0.01);
  check("SE tax = $14,129.55", r.selfEmploymentTax ?? 0, 14129.55, 0.5);
  check("AGI = $92,935.23 (net of half-SE)", r.adjustedGrossIncome, 92935.225, 0.5);
  check("QBI deduction = $12,000 (Box 1 only, GP excluded)", r.qbiDeduction ?? 0, 12000, 0.5);
  check("Taxable income = $66,335.23", r.taxableIncome, 66335.225, 0.5);
  check("federalTaxLiability = $23,776.30 (income + SE)", r.federalTaxLiability, 23776.2995, 1);
}

// GP-2 — GP with Box 14A blank: GP still flows to SE (the max() floor).
// Filer: single 2024, NO W-2. Partnership K-1: Box 1 = $0, Box 4 = $50,000 GP,
//        Box 14A = $0 (CPA entered only the guaranteed payment).
// Hand-calc:
//   Total income = 0 + 50,000 GP = 50,000
//   SE base = max(0, 50,000) = 50,000
//     net SE = 50,000 × 0.9235 = 46,175
//     SS = 46,175 × 0.124 = 5,725.70 ; Med = 46,175 × 0.029 = 1,339.075
//     SE tax = 7,064.775 ; half = 3,532.3875
//   AGI = 50,000 − 3,532.3875 = 46,467.6125
//   QBI = 0 (Box 1 = 0; GP not QBI)
//   Taxable = 46,467.6125 − 14,600 = 31,867.6125
header("GP-2 — GP with Box 14A blank still flows to SE");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024,
      entityName: "Solo GP LLC",
      entityType: "partnership",
      activityType: "active",
      box4GuaranteedPayments: 50000,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("K-1 guaranteed payments = $50,000", r.scheduleK1.totalGuaranteedPayments, 50000, 0.01);
  check("K-1 SE earnings = $50,000 (max(0,GP))", r.scheduleK1.totalSelfEmploymentEarnings, 50000, 0.01);
  check("SE tax = $7,064.78", r.selfEmploymentTax ?? 0, 7064.775, 0.5);
  check("AGI = $46,467.61", r.adjustedGrossIncome, 46467.6125, 0.5);
  check("QBI deduction = $0 (GP not QBI, Box 1 = 0)", r.qbiDeduction ?? 0, 0, 0.01);
  check("Taxable income = $31,867.61", r.taxableIncome, 31867.6125, 0.5);
}

// GP-3 — No double-count when Box 14A == Box 4 (GP only, no Box 1 SE share).
// Filer: single 2024, NO W-2. Box 1 = $0, Box 4 = $30,000, Box 14A = $30,000.
// Hand-calc:
//   SE base = max(30,000, 30,000) = 30,000  (NOT 60,000)
//     net SE = 30,000 × 0.9235 = 27,705
//     SS = 27,705 × 0.124 = 3,435.42 ; Med = 27,705 × 0.029 = 803.445
//     SE tax = 4,238.865 ; half = 2,119.4325
//   AGI = 30,000 − 2,119.4325 = 27,880.5675
header("GP-3 — no double-count when Box 14A == Box 4");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024,
      entityName: "GP Co LP",
      entityType: "partnership",
      activityType: "active",
      box4GuaranteedPayments: 30000,
      selfEmploymentEarnings: 30000,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("K-1 SE earnings = $30,000 (max, NOT 60,000)", r.scheduleK1.totalSelfEmploymentEarnings, 30000, 0.01);
  check("SE tax = $4,238.87", r.selfEmploymentTax ?? 0, 4238.865, 0.5);
  check("AGI = $27,880.57", r.adjustedGrossIncome, 27880.5675, 0.5);
}

// GP-4 — GP excluded from QBI vs Box 1 (the §199A(c)(4) isolation test).
// Filer: single 2024, $40,000 W-2. Partnership K-1: Box 1 = $50,000,
//        Box 4 = $50,000 GP, Box 14A = $50,000.
// Hand-calc:
//   SE base = max(50,000, 50,000) = 50,000 ; net SE = 46,175 ; SE tax = 7,064.775
//     half = 3,532.3875
//   Total income = 40,000 W-2 + 50,000 Box 1 + 50,000 GP = 140,000
//   AGI = 140,000 − 3,532.3875 = 136,467.6125  (below $191,950 — no phase-in)
//   QBI base = Box 1 50,000 only → tentative = 20% × 50,000 = 10,000
//     taxable before QBI = 136,467.6125 − 14,600 = 121,867.6125
//     cap = 20% × 121,867.6125 = 24,373.52 > 10,000 → QBI = 10,000
//   If GP were (wrongly) in QBI, the deduction would be 20% × 100,000 = 20,000.
header("GP-4 — GP excluded from QBI (§199A(c)(4))");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024,
      entityName: "Mixed LP",
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: 50000,
      box4GuaranteedPayments: 50000,
      selfEmploymentEarnings: 50000,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("QBI deduction = $10,000 (Box 1 only; GP NOT in QBI)", r.qbiDeduction ?? 0, 10000, 0.5);
  check("K-1 guaranteed payments = $50,000", r.scheduleK1.totalGuaranteedPayments, 50000, 0.01);
  check("AGI = $136,467.61", r.adjustedGrossIncome, 136467.6125, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 1b — BASIS / AT-RISK LOSS LIMITATION (§704(d) / §1366(d) / §465)
// ════════════════════════════════════════════════════════════════════════════

// BA-1 — Active K-1 ordinary loss limited by BASIS (at-risk not tracked).
// Filer: single 2024, $120,000 W-2. Active partnership K-1: Box 1 = −$50,000,
//        basisAtYearStart = $30,000, atRiskAmount = null (not tracked → ∞).
// Hand-calc:
//   Allowed loss = min(50,000, basis 30,000, at-risk ∞) = 30,000
//   Suspended = 50,000 − 30,000 = 20,000
//   k1 active ordinary = −30,000
//   Total income / AGI = 120,000 − 30,000 = 90,000  (no SE: loss, no Box 14A)
//   Taxable = 90,000 − 14,600 = 75,400  (QBI = 0, business is a loss)
//   Income tax (single 2024): 1,160 + 4,266 + 22%×(75,400 − 47,150)
//     = 1,160 + 4,266 + 22%×28,250 = 1,160 + 4,266 + 6,215 = 11,641
header("BA-1 — active K-1 loss limited by basis");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024,
      entityName: "Loss LP",
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: -50000,
      basisAtYearStart: 30000,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Basis/at-risk loss suspended = $20,000", r.scheduleK1.k1BasisAtRiskLossSuspended, 20000, 0.01);
  check("K-1 active ordinary = −$30,000 (loss capped at basis)", r.scheduleK1.totalActiveOrdinaryIncome, -30000, 0.01);
  check("AGI = $90,000", r.adjustedGrossIncome, 90000, 1);
  check("Taxable income = $75,400", r.taxableIncome, 75400, 1);
  check("federalTaxLiability = $11,641", r.federalTaxLiability, 11641, 1);
}

// BA-2 — AT-RISK limit is the binding constraint (lower than basis).
// Filer: single 2024, $120,000 W-2. Active K-1: Box 1 = −$40,000,
//        basisAtYearStart = $35,000, atRiskAmount = $15,000.
// Hand-calc:
//   Allowed loss = min(40,000, basis 35,000, at-risk 15,000) = 15,000
//   Suspended = 25,000 ; k1 active ordinary = −15,000
//   AGI = 120,000 − 15,000 = 105,000
//   Taxable = 105,000 − 14,600 = 90,400
//   Income tax: 1,160 + 4,266 + 22%×(90,400 − 47,150) = 1,160 + 4,266 + 9,515 = 14,941
header("BA-2 — at-risk limit binds below basis");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024,
      entityName: "AtRisk LP",
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: -40000,
      basisAtYearStart: 35000,
      atRiskAmount: 15000,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Suspended = $25,000 (at-risk binds)", r.scheduleK1.k1BasisAtRiskLossSuspended, 25000, 0.01);
  check("K-1 active ordinary = −$15,000", r.scheduleK1.totalActiveOrdinaryIncome, -15000, 0.01);
  check("AGI = $105,000", r.adjustedGrossIncome, 105000, 1);
  check("federalTaxLiability = $14,941", r.federalTaxLiability, 14941, 1);
}

// BA-3 — Zero basis (tracked) → full loss suspended.
// Filer: single 2024, $100,000 W-2. Active K-1: Box 1 = −$20,000,
//        basisAtYearStart = $0 (tracked, not null), atRiskAmount = null.
// Hand-calc: allowed = min(20,000, 0, ∞) = 0 ; suspended = 20,000 ;
//   k1 active ordinary = 0 ; AGI = 100,000.
header("BA-3 — zero tracked basis suspends the whole loss");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024,
      entityName: "ZeroBasis LP",
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: -20000,
      basisAtYearStart: 0,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Suspended = $20,000 (basis 0)", r.scheduleK1.k1BasisAtRiskLossSuspended, 20000, 0.01);
  check("K-1 active ordinary = $0", r.scheduleK1.totalActiveOrdinaryIncome, 0, 0.01);
  check("AGI = $100,000", r.adjustedGrossIncome, 100000, 1);
}

// BA-4 — No basis/at-risk tracked → loss flows UNLIMITED (backward compat).
// Filer: single 2024, $100,000 W-2. Active K-1: Box 1 = −$20,000, no basis fields.
// Hand-calc: not tracked → allowed = 20,000 ; suspended = 0 ;
//   k1 active ordinary = −20,000 ; AGI = 80,000.
header("BA-4 — untracked basis preserves prior unlimited-loss behavior");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024,
      entityName: "Untracked LP",
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: -20000,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Suspended = $0 (untracked)", r.scheduleK1.k1BasisAtRiskLossSuspended, 0, 0.01);
  check("K-1 active ordinary = −$20,000 (full loss flows)", r.scheduleK1.totalActiveOrdinaryIncome, -20000, 0.01);
  check("AGI = $80,000", r.adjustedGrossIncome, 80000, 1);
}

// BA-5 — Basis limit never touches INCOME (Box 1 > 0).
// Filer: single 2024, $50,000 W-2. Active K-1: Box 1 = +$40,000,
//        basisAtYearStart = $10,000 (low basis — irrelevant to income).
// Hand-calc: Box 1 ≥ 0 → no limit ; k1 active ordinary = +40,000 ; suspended = 0 ;
//   AGI = 90,000 (before QBI/half-SE; no SE since Box 14A blank).
header("BA-5 — low basis does not limit K-1 income");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024,
      entityName: "Income LP",
      entityType: "partnership",
      activityType: "active",
      box1OrdinaryIncome: 40000,
      basisAtYearStart: 10000,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("Suspended = $0 (income not limited)", r.scheduleK1.k1BasisAtRiskLossSuspended, 0, 0.01);
  check("K-1 active ordinary = +$40,000", r.scheduleK1.totalActiveOrdinaryIncome, 40000, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// 1c — PER-BUSINESS SSTB PHASE-OUT (§199A(d)(2)/(d)(3))
// ════════════════════════════════════════════════════════════════════════════
// 2024 single §199A band: $191,950 → $241,950 (width $50,000).

// SSTB-1 — SSTB K-1 ABOVE the band top → $0 QBI.
// Filer: single 2024, $200,000 W-2, S-corp K-1 Box 1 = $100,000, isSstb=true.
// Hand-calc: AGI = 300,000 ≥ 241,950 → phase fraction 0 → SSTB QBI = $0.
//   (A non-SSTB K-1 would instead give 20% × 100,000 = $20,000.)
header("SSTB-1 — SSTB K-1 above band → $0 QBI");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024, entityName: "Law Firm S Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 100000, isSstb: true,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("AGI = $300,000 (above band)", r.adjustedGrossIncome, 300000, 1);
  check("QBI deduction = $0 (SSTB phased out)", r.qbiDeduction ?? 0, 0, 0.5);
}

// SSTB-1b — same K-1 NOT flagged SSTB → full 20% (control).
// Hand-calc: AGI 300,000, non-SSTB, no wage limit (no wages supplied) →
//   QBI = 20% × 100,000 = 20,000 (cap 20%×285,400 = 57,080 — not binding).
header("SSTB-1b — non-SSTB control → $20,000 QBI");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024, entityName: "Mfg S Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 100000, isSstb: false,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("QBI deduction = $20,000 (non-SSTB, full 20%)", r.qbiDeduction ?? 0, 20000, 0.5);
}

// SSTB-2 — SSTB K-1 BELOW the band start → full QBI (SSTB irrelevant).
// Filer: single 2024, $50,000 W-2, S-corp K-1 Box 1 = $60,000, isSstb=true.
// Hand-calc: AGI = 110,000 < 191,950 → fraction 1 → QBI = 20% × 60,000 = 12,000
//   (cap 20%×95,400 = 19,080 — not binding).
header("SSTB-2 — SSTB K-1 below band → full QBI");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024, entityName: "Consulting S Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 60000, isSstb: true,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("AGI = $110,000 (below band)", r.adjustedGrossIncome, 110000, 1);
  check("QBI deduction = $12,000 (SSTB below band → full)", r.qbiDeduction ?? 0, 12000, 0.5);
}

// SSTB-3 — SSTB K-1 WITHIN the band → linear phase-out.
// Filer: single 2024, $116,950 W-2, S-corp K-1 Box 1 = $100,000, isSstb=true.
// Hand-calc: AGI 216,950; §199A(e)(2) phases on TAXABLE income before QBI =
//   216,950 − 14,600 std = 202,350; fraction = (241,950 − 202,350)/50,000 = 0.792
//   SSTB QBI = 100,000 × 0.792 = 79,200 → deduction = 20% × 79,200 = 15,840
//   (cap 20%×202,350 = 40,470 — not binding).
header("SSTB-3 — SSTB K-1 within band → linear phase-out (taxable-income base)");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 116950, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{
      taxYear: 2024, entityName: "Accounting S Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 100000, isSstb: true,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("AGI = $216,950 (band midpoint)", r.adjustedGrossIncome, 216950, 1);
  check("QBI deduction = $15,840 (SSTB phase-out on taxable income)", r.qbiDeduction ?? 0, 15840, 0.5);
}

// SSTB-4 — PER-BUSINESS: one SSTB K-1 + one non-SSTB K-1 within the band.
// Filer: single 2024, $30,000 W-2; S-corp K-1 A = $100,000 SSTB,
//        S-corp K-1 B = $80,000 non-SSTB.
// Hand-calc: AGI 210,000; §199A(e)(2) phases on TAXABLE income before QBI =
//   210,000 − 14,600 std = 195,400; fraction = (241,950 − 195,400)/50,000 = 0.931
//   SSTB QBI = 100,000 × 0.931 = 93,100 ; non-SSTB QBI = 80,000 (full)
//   combined QBI = 173,100 → deduction = 20% × 173,100 = 34,620
//   (cap 20%×195,400 = 39,080 — not binding).
//   Proves the non-SSTB K-1 keeps full QBI while the SSTB one phases out.
header("SSTB-4 — per-business: SSTB + non-SSTB K-1 within band");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 30000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      { taxYear: 2024, entityName: "SSTB S Corp", entityType: "s_corp", activityType: "active", box1OrdinaryIncome: 100000, isSstb: true },
      { taxYear: 2024, entityName: "Trade S Corp", entityType: "s_corp", activityType: "active", box1OrdinaryIncome: 80000, isSstb: false },
    ],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("AGI = $210,000", r.adjustedGrossIncome, 210000, 1);
  check("QBI deduction = $34,620 (SSTB phased on taxable income, non-SSTB full)", r.qbiDeduction ?? 0, 34620, 0.5);
}

// SSTB-5 — FIX: Sch C SSTB flag does NOT phase out a non-SSTB K-1.
// (Old engine phased the WHOLE combined QBI when the Sch C flag was set.)
// Filer: single 2024, $150,000 W-2, self_employment_income $100,000 with
//        qbi_sstb_flag set (Sch C is SSTB), S-corp K-1 Box 1 = $50,000 non-SSTB.
// Hand-calc (Sch SE Part I Line 9 — the $150k W-2 uses most of the SS base):
//   net SE = 100,000 × 0.9235 = 92,350
//   SS subject = min(92,350, 168,600 − 150,000 W-2 SS) = 18,600
//   SS tax = 18,600 × 0.124 = 2,306.40 ; Med = 92,350 × 0.029 = 2,678.15
//   SE tax = 4,984.55 ; half = 2,492.275
//   AGI = 150,000 + 100,000 + 50,000 − 2,492.275 = 297,507.725 (> 241,950 → fraction 0)
//   Sch C QBI = 100,000 − 2,492.275 = 97,507.725 (SSTB → 0)
//   K-1 QBI = 50,000 (non-SSTB → full)
//   combined = 50,000 → deduction = 20% × 50,000 = 10,000
//     (cap 20%×282,907.725 = 56,581 — not binding).
//   OLD behavior would have given $0 (whole QBI phased). New = $10,000.
header("SSTB-5 — Sch C SSTB flag does not phase a non-SSTB K-1");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 150000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "self_employment_income", amount: 100000, isApplied: true },
      { adjustmentType: "qbi_sstb_flag", amount: 1, isApplied: true },
    ],
    scheduleK1: [{
      taxYear: 2024, entityName: "Trade S Corp", entityType: "s_corp",
      activityType: "active", box1OrdinaryIncome: 50000, isSstb: false,
    }],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("AGI = $297,507.73 (W-2 SS base offset)", r.adjustedGrossIncome, 297507.725, 0.5);
  check("QBI deduction = $10,000 (non-SSTB K-1 retained; Sch C SSTB → 0)", r.qbiDeduction ?? 0, 10000, 0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(60)}`);
console.log(`PASS: ${PASS.length}`);
if (FAIL.length > 0) {
  console.log(`FAIL: ${FAIL.length}`);
  for (const f of FAIL) console.log("  " + f);
  process.exit(1);
}
console.log(`All ${PASS.length} K-1 depth assertions passed.`);
