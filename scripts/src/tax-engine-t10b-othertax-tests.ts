/**
 * T1.0b (audit 2026-06-11, fed-other-taxes) — AMT credit + other federal taxes.
 *
 * Covers (every expectation HAND-CALC'D against the cited primary source):
 *   F-2   §53(c) MTC limit nets out the OTHER nonrefundable credits — the §53
 *         credit can never push net income tax below TMT. (Form 8801 Part II
 *         "regular income tax liability minus allowable credits" = 1040 line
 *         16 + Sch 2 line 1z − [1040 line 19 + Schedule 3 lines 1–6z excl.
 *         6b/8912]; IRC §53(c) subparts A, B, D, E, F.)
 *   FC-08 §38(c) GBC limit uses NET income tax / NET regular tax liability
 *         (net of subpart A+B credits — Form 3800 Part II), and the §38 GBC is
 *         applied BEFORE §53 (Schedule 3 line 6a before 6b; §53(c) nets out
 *         subpart D = the GBC).
 *   F-3   §53(d) MTC generation = AMT minus the "net minimum tax on EXCLUSION
 *         items" (Form 8801 Part I — exclusion items per the i8801: 6251 lines
 *         2a/2b/2c/2d/2g/2h + the standard deduction; deferral items like the
 *         ISO bargain element + depreciation generate the credit).
 *   F-4   2025 Form 6251 line 1b — the OBBBA §151(d) senior deduction is a
 *         personal exemption added back to AMTI (§56(b)(1)(E)); the tips/
 *         overtime/car-loan Schedule 1-A deductions are NOT added back.
 *   F-5   Excess Social Security withholding (Schedule 3 line 11): 2+
 *         employers per person, Box 4 total over 6.2% × wage base
 *         ($10,453.20 / $10,918.20 / $11,439.00 for 2024/25/26); per-spouse
 *         for MFJ; single-employer over-withholding NOT creditable (Topic 608).
 *   F-6   Form 8959 Part IV — Additional-Medicare withholding = max(0, ΣBox 6
 *         − 1.45% × ΣBox 5) → 1040 line 25c (a payment).
 *   F-7   Schedule H 2026 FICA threshold $3,000 (SSA Pub EN-05-10021).
 *   F-8   Form 8960 line 5a includes the ALLOWED net capital loss (−$3,000 /
 *         −$1,500 MFS) — it offsets other investment income.
 *   F-10  Non-qualified annuity (1099-R Box 7 code D) is NII (§1411(c)(1)(A)(i),
 *         Form 8960 line 3); all other 1099-R income stays excluded.
 *
 * Pure engine; no API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-t10b-othertax-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type W2Fact,
  type Form1099Fact,
  type AdjustmentFact,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { computeForm8801CreditGeneration } from "../../artifacts/api-server/src/lib/taxCalculator";
import { calculateScheduleH } from "../../artifacts/api-server/src/lib/scheduleH";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}

function clientFor(filingStatus: string, taxYear: number, extra: Record<string, unknown> = {}) {
  return {
    id: 1, firstName: "T", lastName: "OtherTax", email: "t@e.com", phone: null,
    filingStatus, state: "FL", taxYear,
    dependentsUnder17: 0, otherDependents: 0, dependentsForCareCredit: 0,
    taxpayerAge: 40, spouseAge: null, spouseEarnedIncome: null,
    hsaIsFamilyCoverage: false, iraCoveredByWorkplacePlan: false,
    eligibleEducatorCount: 0, acaAnnualPremium: null, acaAnnualSlcsp: null,
    acaAdvanceAptc: null, acaHouseholdSize: null,
    rentalActiveParticipant: true, rentalRealEstateProfessional: false,
    localityCode: null, socialSecurityBenefits: null,
    mfsLivedApartAllYear: false, isKiddieTaxFiler: false,
    parentsTopMarginalRate: null, priorYearItemized: null,
    residencyChangedInYear: false, formerState: null, residencyChangeDate: null,
    ...extra,
  } as TaxReturnInputs["client"];
}

function inputs(args: {
  filingStatus?: string; taxYear?: number; client?: Record<string, unknown>;
  w2s?: W2Fact[]; form1099s?: Form1099Fact[]; adjustments?: AdjustmentFact[];
}): TaxReturnInputs {
  const taxYear = args.taxYear ?? 2024;
  return {
    client: clientFor(args.filingStatus ?? "single", taxYear, args.client ?? {}),
    w2s: args.w2s ?? [],
    form1099s: args.form1099s ?? [],
    adjustments: args.adjustments ?? [],
    taxYear,
  };
}
const adj = (adjustmentType: string, amount: number): AdjustmentFact =>
  ({ adjustmentType, amount, isApplied: true });

// ════════════════════════════════════════════════════════════════════════════
// A — F-2: §53(c) limit = (regular tax − other nonrefundable credits) − TMT
// ════════════════════════════════════════════════════════════════════════════

// A1 — the audit repro. Single FL TY2024, $300k W-2 (std ded), FTC $300,
// amt_credit_carryforward $50,000.
// Hand-calc:
//   TI = 300,000 − 14,600 = 285,400.
//   Regular = 1,160 + 4,266 + 11,742.50 + 21,942 + 16,568
//             + 0.35×(285,400−243,725)=14,586.25 → 70,264.75.
//   AMTI = 285,400 + 14,600 (line-2a std-ded addback) = 300,000.
//   Exemption 85,700 (< 609,350) → base 214,300 → TMT = 0.26×214,300 = 55,718.
//   amtTax = 0 (regular > TMT).
//   §53(c) limit = (70,264.75 − 300 FTC) − 55,718 = 14,246.75
//   (the pre-fix engine applied 14,546.75 — gross regular tax − TMT — driving
//   income tax after credits to 55,418 = TMT − 300, below TMT).
//   amtCreditApplied = min(50,000, 14,246.75, 69,964.75) = 14,246.75.
//   CF remaining = 50,000 − 14,246.75 (generated 0 — no AMT) = 35,753.25.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 300000, employerName: "A" }],
    adjustments: [adj("foreign_tax_paid", 300), adj("amt_credit_carryforward", 50000)],
  }));
  check("A1 §53 applied = (regular − FTC) − TMT = 14,246.75", r.amtCreditApplied, 14246.75);
  check("A1 total nonrefundable = 300 FTC + 14,246.75 MTC", r.totalNonRefundableApplied, 14546.75);
  check("A1 income tax after credits == TMT (70,264.75 − 14,546.75 = 55,718)",
    70264.75 - r.totalNonRefundableApplied, 55718);
  check("A1 MTC carryforward remaining 35,753.25", r.amtCreditCarryforwardRemaining, 35753.25);
  check("A1 no AMT this year", r.amtTax, 0);
  check("A1 generated 0 (no AMT)", r.amtCreditGenerated, 0);
}

// A2 — control without the FTC: limit = 70,264.75 − 55,718 = 14,546.75 (the
// old behavior is CORRECT when no other credits exist — regression guard).
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 300000, employerName: "A" }],
    adjustments: [adj("amt_credit_carryforward", 50000)],
  }));
  check("A2 no-other-credit control: §53 applied 14,546.75", r.amtCreditApplied, 14546.75);
  check("A2 CF remaining 35,453.25", r.amtCreditCarryforwardRemaining, 35453.25);
}

// A3 — AMT binds this year → §53 limit 0; the ISO-deferral AMT GENERATES
// credit (F-3). Single TY2024, $120k W-2 + $200k ISO bargain, CF in $10k.
// Hand-calc:
//   TI = 105,400. Regular = 1,160 + 4,266 + 11,742.50 + 0.24×4,875 = 18,338.50.
//   AMTI = 105,400 + 200,000 (2i ISO, deferral) + 14,600 (2a std ded,
//   exclusion) = 320,000 → base 234,300 → TMT = 0.26×232,600 + 0.28×1,700
//   = 60,476 + 476 = 60,952 → amtTax = 60,952 − 18,338.50 = 42,613.50.
//   §53: regular − 0 credits − TMT = 18,338.50 − 60,952 < 0 → applied 0.
//   F-3 Form 8801 Part I: exclusion-only AMTI = 105,400 + 14,600 = 120,000
//   → base 34,300 → TMT-excl = 8,918 → net min tax on exclusion items
//   = max(0, 8,918 − 18,338.50) = 0 → generated = 42,613.50 − 0 = 42,613.50.
//   CF remaining = 10,000 + 42,613.50 − 0 = 52,613.50.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 120000, employerName: "A" }],
    adjustments: [adj("amt_iso_bargain_element", 200000), adj("amt_credit_carryforward", 10000)],
  }));
  check("A3 AMT binds: amtTax 42,613.50", r.amtTax, 42613.5);
  check("A3 §53 applied 0 when AMT binds", r.amtCreditApplied, 0);
  check("A3 ISO (deferral) generates the FULL AMT as MTC", r.amtCreditGenerated, 42613.5);
  check("A3 CF remaining 52,613.50", r.amtCreditCarryforwardRemaining, 52613.5);
}

// ════════════════════════════════════════════════════════════════════════════
// B — F-3: §53(d)/Form 8801 Part I — exclusion items generate NO credit
// ════════════════════════════════════════════════════════════════════════════

// B1 — exclusion-only AMT (legacy `amt_preferences` catch-all + the std-ded
// addback are both exclusion-classified) → generated $0.
// Hand-calc: single TY2024, $150k W-2 + amt_preferences 250,000.
//   TI = 135,400. Regular = 1,160 + 4,266 + 11,742.50 + 0.24×34,875 = 25,538.50.
//   AMTI = 135,400 + 250,000 + 14,600 = 400,000 → base 314,300
//   → TMT = 60,476 + 0.28×81,700 = 83,352 → amtTax = 57,813.50.
//   Exclusion run is IDENTICAL (all prefs exclusion) → generated 0.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 150000, employerName: "A" }],
    adjustments: [adj("amt_preferences", 250000)],
  }));
  check("B1 exclusion-driven amtTax 57,813.50", r.amtTax, 57813.5);
  check("B1 exclusion items generate NO MTC", r.amtCreditGenerated, 0);
  check("B1 CF remaining 0", r.amtCreditCarryforwardRemaining, 0);
}

// B2 — MIXED exclusion + deferral where the exclusion-only minimum tax is
// NONZERO (Form 8801 Part I genuinely reduces the generation). Single TY2024,
// $60k W-2 + amt_preferences 150,000 (exclusion) + ISO 150,000 (deferral).
// Hand-calc:
//   TI = 45,400. Regular = 1,160 + 0.12×33,800 = 5,216.
//   AMTI = 45,400 + 150,000 + 150,000 + 14,600 = 360,000 → base 274,300
//   → TMT = 60,476 + 0.28×41,700 = 72,152 → amtTax = 72,152 − 5,216 = 66,936.
//   Exclusion run: prefs = 150,000 + 14,600 = 164,600 → AMTI 210,000
//   → base 124,300 → TMT-excl = 0.26×124,300 = 32,318
//   → net min tax on exclusion items = 32,318 − 5,216 = 27,102.
//   generated = 66,936 − 27,102 = 39,834.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 60000, employerName: "A" }],
    adjustments: [adj("amt_preferences", 150000), adj("amt_iso_bargain_element", 150000)],
  }));
  check("B2 mixed amtTax 66,936", r.amtTax, 66936);
  check("B2 generated = AMT − net-min-tax-on-exclusion = 39,834", r.amtCreditGenerated, 39834);
  check("B2 form8801 net min tax on exclusion items 27,102",
    r.form8801Generation?.netMinimumTaxOnExclusionItems ?? NaN, 27102);
  check("B2 form8801 TMT on exclusion items 32,318",
    r.form8801Generation?.tentativeMinTaxOnExclusionItems ?? NaN, 32318);
  check("B2 form8801 exclusion AMTI 210,000", r.form8801Generation?.exclusionAmti ?? NaN, 210000);
}

// B3 — computeForm8801CreditGeneration unit tests (direct, mirrors B1/B2/A3).
{
  // all-exclusion → exclusion run == actual run → 0
  const u1 = computeForm8801CreditGeneration({
    taxableIncome: 135400, exclusionPreferences: 264600, amtTax: 57813.5,
    regularTax: 25538.5, filingStatus: "single", taxYear: 2024,
  });
  check("B3a unit: all-exclusion generates 0", u1.adjustedNetMinimumTax, 0);
  // all-deferral (exclusion prefs only the std-ded would be exclusion; here 0)
  const u2 = computeForm8801CreditGeneration({
    taxableIncome: 105400, exclusionPreferences: 14600, amtTax: 42613.5,
    regularTax: 18338.5, filingStatus: "single", taxYear: 2024,
  });
  check("B3b unit: deferral-dominated generates the full AMT", u2.adjustedNetMinimumTax, 42613.5);
  // mixed (B2 numbers)
  const u3 = computeForm8801CreditGeneration({
    taxableIncome: 45400, exclusionPreferences: 164600, amtTax: 66936,
    regularTax: 5216, filingStatus: "single", taxYear: 2024,
  });
  check("B3c unit: mixed generates 39,834", u3.adjustedNetMinimumTax, 39834);
  check("B3c unit: exclusion TMT 32,318", u3.tentativeMinTaxOnExclusionItems, 32318);
  // no AMT → 0 regardless of prefs
  const u4 = computeForm8801CreditGeneration({
    taxableIncome: 285400, exclusionPreferences: 14600, amtTax: 0,
    regularTax: 70264.75, filingStatus: "single", taxYear: 2024,
  });
  check("B3d unit: no AMT generates 0", u4.adjustedNetMinimumTax, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// C — FC-08: §38(c) net-income-tax limit + §38-before-§53 ordering
// ════════════════════════════════════════════════════════════════════════════

// C1 — GBC limited by (net income tax − TMT) where net = gross − FTC.
// Single TY2024 $300k W-2 (regular 70,264.75, TMT 55,718 — A1 derivation),
// FTC $300, WOTC $20,000.
// Hand-calc:
//   net income tax = 70,264.75 − 300 = 69,964.75 (no AMT).
//   25% floor = 0.25 × (69,964.75 − 25,000) = 11,241.19 < TMT 55,718 → TMT.
//   §38 limit = 69,964.75 − 55,718 = 14,246.75 (pre-fix: 14,546.75 off gross).
//   WOTC applied = 14,246.75; §39 carryforward = 5,753.25.
//   Income tax after all credits = 70,264.75 − 300 − 14,246.75 = 55,718 = TMT.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 300000, employerName: "A" }],
    adjustments: [adj("foreign_tax_paid", 300), adj("wotc_credit", 20000)],
  }));
  check("C1 §38 GBC applied = net income tax − TMT = 14,246.75",
    r.otherGeneralBusinessCreditApplied, 14246.75);
  check("C1 §39 GBC carryforward 5,753.25", r.otherGeneralBusinessCreditCarryforward, 5753.25);
  check("C1 after-credit income tax == TMT", 70264.75 - r.totalNonRefundableApplied, 55718);
}

// C2 — ordering: the §38 GBC absorbs the whole spread; the §53 MTC (applied
// AFTER per Schedule 3 line 6a → 6b + §53(c) subpart-D netting) gets 0 and the
// carryforward is preserved.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 300000, employerName: "A" }],
    adjustments: [
      adj("foreign_tax_paid", 300),
      adj("wotc_credit", 20000),
      adj("amt_credit_carryforward", 50000),
    ],
  }));
  check("C2 GBC first: applied 14,246.75", r.otherGeneralBusinessCreditApplied, 14246.75);
  check("C2 §53 after §38: applied 0 (spread exhausted)", r.amtCreditApplied, 0);
  check("C2 MTC carryforward preserved 50,000", r.amtCreditCarryforwardRemaining, 50000);
}

// C3 — control (no personal credits): TMT-binding §38 limit identical pre/post
// fix. Single TY2024 $700k W-2, WOTC $100k.
// Hand-calc:
//   TI = 685,400. Regular = 55,678.50 (at 243,725) + 0.35×365,625 = 127,968.75
//   → 183,647.25 (at 609,350) + 0.37×76,050 = 28,138.50 → 211,785.75.
//   AMTI = 700,000 → exemption 85,700 − 0.25×(700,000−609,350) = 63,037.50
//   → base 636,962.50 → TMT = 60,476 + 0.28×404,362.50 = 173,697.50.
//   25% floor = 0.25×(211,785.75 − 25,000) = 46,696.44 < TMT.
//   limit = 211,785.75 − 173,697.50 = 38,088.25 → CF 61,911.75.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 700000, employerName: "A" }],
    adjustments: [adj("wotc_credit", 100000)],
  }));
  check("C3 TMT-floor GBC limit 38,088.25", r.otherGeneralBusinessCreditApplied, 38088.25);
  check("C3 GBC carryforward 61,911.75", r.otherGeneralBusinessCreditCarryforward, 61911.75);
}

// ════════════════════════════════════════════════════════════════════════════
// D — F-4: OBBBA senior deduction added back to AMTI (2025 6251 line 1b);
//     tips NOT added back
// ════════════════════════════════════════════════════════════════════════════

// D1 — TY2025 single age 66, $100k W-2, $300k ISO bargain.
// Hand-calc:
//   Std ded = 15,750 + 2,000 (§63(f) age-65 box, Rev. Proc. 2024-40) = 17,750.
//   Senior deduction = 6,000 − 6%×(100,000 − 75,000) = 4,500 (Sch 1-A).
//   TI = 100,000 − 17,750 − 4,500 = 77,750.
//   Regular = 1,192.50 + 4,386 + 0.22×(77,750−48,475) = 6,440.50 → 12,019.
//   AMT prefs = ISO 300,000 + std-ded addback 17,750 + SENIOR ADDBACK 4,500
//   → AMTI = 77,750 + 322,250 = 400,000 (= wages + ISO — the line-1b addback
//   makes AMTI invariant to the senior deduction, which is the point).
//   Base = 400,000 − 88,100 = 311,900 → TMT = 0.26×239,100 + 0.28×72,800
//   = 62,166 + 20,384 = 82,550 → amtTax = 82,550 − 12,019 = 70,531.
{
  const r = computeTaxReturnPure(inputs({
    taxYear: 2025,
    client: { taxpayerAge: 66 },
    w2s: [{ wagesBox1: 100000, employerName: "A" }],
    adjustments: [adj("amt_iso_bargain_element", 300000)],
  }));
  check("D1 senior deduction 4,500", r.obbbaSchedule1A.senior, 4500);
  check("D1 AMTI 400,000 (senior added back, 6251 line 1b)", r.detail.amt.amti, 400000);
  check("D1 amtTax 70,531", r.amtTax, 70531);
}

// D2 — invariance control: same facts at age 40 (no senior deduction).
//   TI = 100,000 − 15,750 = 84,250. Regular = 1,192.50 + 4,386 + 0.22×35,775
//   = 7,870.50 → 13,449. AMTI = 84,250 + 315,750 = 400,000 — SAME AMTI.
//   amtTax = 82,550 − 13,449 = 69,101.
{
  const r = computeTaxReturnPure(inputs({
    taxYear: 2025,
    client: { taxpayerAge: 40 },
    w2s: [{ wagesBox1: 100000, employerName: "A" }],
    adjustments: [adj("amt_iso_bargain_element", 300000)],
  }));
  check("D2 control: senior 0", r.obbbaSchedule1A.senior, 0);
  check("D2 AMTI also 400,000 — addback makes AMTI senior-invariant", r.detail.amt.amti, 400000);
  check("D2 amtTax 69,101", r.amtTax, 69101);
}

// D3 — tips are NOT added back (no §56(b) adjustment for §224). TY2025 single
// age 40, $80k W-2 + qualified_tips 10,000 + $300k ISO.
//   Tips deduction = 10,000 (MAGI 80,000 < 150,000). TI = 80,000 − 15,750
//   − 10,000 = 54,250 → AMTI = 54,250 + 300,000 + 15,750 = 370,000.
//   Control without tips: TI = 64,250 → AMTI = 380,000. Delta = exactly the
//   tips deduction (it survives for AMT).
{
  const withTips = computeTaxReturnPure(inputs({
    taxYear: 2025,
    w2s: [{ wagesBox1: 80000, employerName: "A" }],
    adjustments: [adj("qualified_tips", 10000), adj("amt_iso_bargain_element", 300000)],
  }));
  const noTips = computeTaxReturnPure(inputs({
    taxYear: 2025,
    w2s: [{ wagesBox1: 80000, employerName: "A" }],
    adjustments: [adj("amt_iso_bargain_element", 300000)],
  }));
  check("D3 tips deduction 10,000", withTips.obbbaSchedule1A.tips, 10000);
  check("D3 AMTI with tips 370,000 (tips NOT added back)", withTips.detail.amt.amti, 370000);
  check("D3 AMTI control 380,000", noTips.detail.amt.amti, 380000);
}

// D4 — F-3 × F-4 interplay: the senior addback is an EXCLUSION item (a §151
// personal exemption, §53(d)(1)(B)(ii) → §56(b)(1)(E)) — D1's AMT generates
// only the deferral (ISO) portion.
//   D1 exclusion run: prefs = 17,750 + 4,500 = 22,250 → AMTI 100,000 → base
//   11,900 → TMT-excl = 3,094 → net = max(0, 3,094 − 12,019) = 0
//   → generated = full 70,531 (the exclusion items' standalone min tax is 0).
{
  const r = computeTaxReturnPure(inputs({
    taxYear: 2025,
    client: { taxpayerAge: 66 },
    w2s: [{ wagesBox1: 100000, employerName: "A" }],
    adjustments: [adj("amt_iso_bargain_element", 300000)],
  }));
  check("D4 senior-as-exclusion: exclusion AMTI 100,000",
    r.form8801Generation?.exclusionAmti ?? NaN, 100000);
  check("D4 generated = full ISO-driven AMT 70,531", r.amtCreditGenerated, 70531);
}

// ════════════════════════════════════════════════════════════════════════════
// E — F-5: Excess Social Security withholding (Schedule 3 line 11)
// ════════════════════════════════════════════════════════════════════════════

// E1 — TY2024 single, 2 employers, $120k SS wages each, Box 4 = 7,440 each.
//   Total Box 4 = 14,880; max = 6.2% × 168,600 = 10,453.20 → excess 4,426.80.
{
  const base: W2Fact[] = [
    { wagesBox1: 120000, socialSecurityWagesBox3: 120000, socialSecurityTaxBox4: 7440, employerName: "Alpha Inc" },
    { wagesBox1: 120000, socialSecurityWagesBox3: 120000, socialSecurityTaxBox4: 7440, employerName: "Beta LLC" },
  ];
  const r = computeTaxReturnPure(inputs({ w2s: base }));
  const control = computeTaxReturnPure(inputs({
    w2s: base.map((w) => ({ ...w, socialSecurityTaxBox4: 0 })),
  }));
  check("E1 excess SS credit 4,426.80", r.excessSocialSecurityCredit, 4426.8);
  check("E1 refund delta vs no-Box-4 control = the credit",
    r.federalRefundOrOwed - control.federalRefundOrOwed, 4426.8);
  check("E1 liability unchanged (payment-side, not a liability offset)",
    r.federalTaxLiability - control.federalTaxLiability, 0);
}

// E2 — single employer over-withholding → NOT creditable (Topic 608: recover
// from the employer). One W-2, Box 4 = 12,000 (> max).
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 120000, socialSecurityTaxBox4: 12000, employerName: "Alpha Inc" }],
  }));
  check("E2 one employer: no credit", r.excessSocialSecurityCredit, 0);
}

// E3 — two W-2 ROWS from the SAME employer (e.g. a corrected W-2) collapse to
// one employer → no credit.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [
      { wagesBox1: 80000, socialSecurityTaxBox4: 6000, employerName: "Acme Corp" },
      { wagesBox1: 80000, socialSecurityTaxBox4: 6000, employerName: "acme corp " },
    ],
  }));
  check("E3 same-employer duplicate rows: no credit", r.excessSocialSecurityCredit, 0);
}

// E4 — MFJ per-spouse: taxpayer 2 employers (6,000 + 6,000 = 12,000 →
// excess 1,546.80); spouse 1 employer 9,000 → 0. Total 1,546.80.
{
  const r = computeTaxReturnPure(inputs({
    filingStatus: "married_filing_jointly",
    client: { spouseAge: 40 },
    w2s: [
      { wagesBox1: 96774, socialSecurityTaxBox4: 6000, employerName: "T1", spouse: "taxpayer" },
      { wagesBox1: 96774, socialSecurityTaxBox4: 6000, employerName: "T2", spouse: "taxpayer" },
      { wagesBox1: 145161, socialSecurityTaxBox4: 9000, employerName: "S1", spouse: "spouse" },
    ],
  }));
  check("E4 MFJ per-spouse: taxpayer's excess only = 1,546.80",
    r.excessSocialSecurityCredit, 1546.8);
}

// E5 — MFJ spouses may NOT combine: each spouse 1 employer, 6,000 + 6,000
// (= 12,000 jointly over the max) → still 0 (Pub 505: figured separately).
{
  const r = computeTaxReturnPure(inputs({
    filingStatus: "married_filing_jointly",
    client: { spouseAge: 40 },
    w2s: [
      { wagesBox1: 96774, socialSecurityTaxBox4: 6000, employerName: "T1", spouse: "taxpayer" },
      { wagesBox1: 96774, socialSecurityTaxBox4: 6000, employerName: "S1", spouse: "spouse" },
    ],
  }));
  check("E5 MFJ no cross-spouse combination: 0", r.excessSocialSecurityCredit, 0);
}

// E6 — TY2025 max = 6.2% × 176,100 = 10,918.20: 2 employers × 6,000 → 1,081.80.
{
  const r = computeTaxReturnPure(inputs({
    taxYear: 2025,
    w2s: [
      { wagesBox1: 96774, socialSecurityTaxBox4: 6000, employerName: "A" },
      { wagesBox1: 96774, socialSecurityTaxBox4: 6000, employerName: "B" },
    ],
  }));
  check("E6 TY2025 excess = 12,000 − 10,918.20 = 1,081.80", r.excessSocialSecurityCredit, 1081.8);
}

// E7 — TY2026 max = 6.2% × 184,500 = 11,439.00: 12,000 − 11,439 = 561.
{
  const r = computeTaxReturnPure(inputs({
    taxYear: 2026,
    w2s: [
      { wagesBox1: 96774, socialSecurityTaxBox4: 6000, employerName: "A" },
      { wagesBox1: 96774, socialSecurityTaxBox4: 6000, employerName: "B" },
    ],
  }));
  check("E7 TY2026 excess 561.00", r.excessSocialSecurityCredit, 561);
}

// E8 — under the max: 2 employers × 5,000 = 10,000 < 10,453.20 → 0.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [
      { wagesBox1: 80645, socialSecurityTaxBox4: 5000, employerName: "A" },
      { wagesBox1: 80645, socialSecurityTaxBox4: 5000, employerName: "B" },
    ],
  }));
  check("E8 under the annual max: 0", r.excessSocialSecurityCredit, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// F — F-6: Form 8959 Part IV Additional-Medicare withholding → line 25c
// ════════════════════════════════════════════════════════════════════════════

// F1 — single, one W-2: Box 5 = 300,000; Box 6 = 1.45%×300,000 + 0.9%×100,000
// = 4,350 + 900 = 5,250 → Part IV line 22 = 900. Liability side: Additional
// Medicare Tax = 0.9% × (300,000 − 200,000) = 900 — they net to zero in the
// refund (that is the whole point of Part IV).
{
  const w2: W2Fact = {
    wagesBox1: 300000, federalTaxWithheldBox2: 60000,
    medicareWagesBox5: 300000, medicareTaxBox6: 5250, employerName: "A",
  };
  const r = computeTaxReturnPure(inputs({ w2s: [w2] }));
  const control = computeTaxReturnPure(inputs({ w2s: [{ ...w2, medicareTaxBox6: 4350 }] }));
  check("F1 Part IV withholding 900", r.additionalMedicareWithholding, 900);
  check("F1 liability Additional Medicare Tax 900", r.additionalMedicareTax, 900);
  check("F1 federalTaxWithheld includes line 25c (60,000 + 900)", r.federalTaxWithheld, 60900);
  check("F1 refund delta vs exactly-1.45% control = +900",
    r.federalRefundOrOwed - control.federalRefundOrOwed, 900);
}

// F2 — Box 6 at exactly 1.45% of Box 5 → no Part IV amount.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 150000, medicareWagesBox5: 150000, medicareTaxBox6: 2175, employerName: "A" }],
  }));
  check("F2 exactly-1.45% Box 6: 0", r.additionalMedicareWithholding, 0);
}

// F3 — a W-2 MISSING Box 6 is excluded from the reconciliation (it must not
// erode another employer's excess with its 1.45% × Box 5 term).
//   W-2 #1: Box 5 250,000, Box 6 4,075 (= 3,625 + 450 excess).
//   W-2 #2: Box 5 100,000, Box 6 null → excluded. Credit = 450.
//   (Including #2 as Box6=0 would give max(0, 4,075 − 1.45%×350,000) = 0.)
{
  const r = computeTaxReturnPure(inputs({
    w2s: [
      { wagesBox1: 250000, medicareWagesBox5: 250000, medicareTaxBox6: 4075, employerName: "A" },
      { wagesBox1: 100000, medicareWagesBox5: 100000, employerName: "B" },
    ],
  }));
  check("F3 missing-Box-6 W-2 excluded: credit 450", r.additionalMedicareWithholding, 450);
}

// F4 — AGGREGATE per the form (8959 lines 19–21 total across W-2s), not
// per-W-2: an under-withheld employer's shortfall offsets the other's excess.
//   #1: Box 5 250,000, Box 6 4,075 (+450). #2: Box 5 100,000, Box 6 1,000
//   (1.45% would be 1,450 — short 450). Σ6 = 5,075 = 1.45% × 350,000 → 0.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [
      { wagesBox1: 250000, medicareWagesBox5: 250000, medicareTaxBox6: 4075, employerName: "A" },
      { wagesBox1: 100000, medicareWagesBox5: 100000, medicareTaxBox6: 1000, employerName: "B" },
    ],
  }));
  check("F4 aggregate reconciliation: 0 (shortfall offsets excess)", r.additionalMedicareWithholding, 0);
}

// F5 — MFJ aggregate across both spouses' W-2s: taxpayer Box 5 220,000 /
// Box 6 = 3,190 + 180 = 3,370 (employer withheld 0.9% over its $200k
// per-employer trigger); spouse Box 5 50,000 / Box 6 725.
//   Part IV: Σ6 = 4,095 − 1.45%×270,000 = 3,915 → 180.
//   Liability: MFJ Medicare wages 270,000 − 250,000 = 20,000 × 0.9% = 180.
//   The withholding and the tax net to zero.
{
  const r = computeTaxReturnPure(inputs({
    filingStatus: "married_filing_jointly",
    client: { spouseAge: 40 },
    w2s: [
      { wagesBox1: 220000, medicareWagesBox5: 220000, medicareTaxBox6: 3370, employerName: "T", spouse: "taxpayer" },
      { wagesBox1: 50000, medicareWagesBox5: 50000, medicareTaxBox6: 725, employerName: "S", spouse: "spouse" },
    ],
  }));
  check("F5 MFJ Part IV withholding 180", r.additionalMedicareWithholding, 180);
  check("F5 MFJ Additional Medicare Tax 180", r.additionalMedicareTax, 180);
}

// ════════════════════════════════════════════════════════════════════════════
// G — F-7: Schedule H 2026 FICA threshold $3,000 (SSA)
// ════════════════════════════════════════════════════════════════════════════

// G1 — 2026 $2,900 < $3,000 → NO FICA; FUTA only = 0.6% × 2,900 = 17.40.
{
  const r = calculateScheduleH({ cashWages: 2900, taxYear: 2026 });
  check("G1 2026 $2,900: no FICA (SS 0)", r.socialSecurityTax, 0);
  check("G1 2026 $2,900: FUTA only 17.40", r.total, 17.4);
}
// G2 — 2026 $3,000 hits the threshold: SS 372 + Medicare 87 + FUTA 18 = 477.
{
  const r = calculateScheduleH({ cashWages: 3000, taxYear: 2026 });
  check("G2 2026 $3,000 SS 12.4% = 372", r.socialSecurityTax, 372);
  check("G2 2026 $3,000 Medicare 2.9% = 87", r.medicareTax, 87);
  check("G2 2026 $3,000 total 477", r.total, 477);
}
// G3 — 2025 unchanged ($2,800): $2,900 ≥ 2,800 → FICA applies.
//   0.124×2,900 = 359.60 + 0.029×2,900 = 84.10 + FUTA 17.40 = 461.10.
{
  const r = calculateScheduleH({ cashWages: 2900, taxYear: 2025 });
  check("G3 2025 $2,900 FICA applies, total 461.10", r.total, 461.1);
}
// G4 — 2024 unchanged ($2,700): 0.124×2,700 + 0.029×2,700 + 0.006×2,700
//   = 334.80 + 78.30 + 16.20 = 429.30.
{
  const r = calculateScheduleH({ cashWages: 2700, taxYear: 2024 });
  check("G4 2024 $2,700 total 429.30", r.total, 429.3);
}
// G5 — e2e: the 2026 threshold flows through computeTaxReturnPure.
{
  const r = computeTaxReturnPure(inputs({
    taxYear: 2026,
    w2s: [{ wagesBox1: 60000, employerName: "A" }],
    adjustments: [adj("household_employee_cash_wages", 2900)],
  }));
  check("G5 e2e 2026 $2,900 household wages: Schedule H 17.40 (FUTA only)", r.scheduleH.total, 17.4);
}

// ════════════════════════════════════════════════════════════════════════════
// H — F-8: NIIT — the allowed −$3,000/−$1,500 capital loss reduces NII
// ════════════════════════════════════════════════════════════════════════════

// H1 — audit repro: single FL TY2024, $230k W-2 + $20k interest + $10k net LT
// loss. AGI = 230,000 + 20,000 − 3,000 = 247,000.
//   Form 8960: line 1 interest 20,000 + line 5a (−3,000) = NII 17,000.
//   MAGI excess = 47,000 → NIIT = 3.8% × min(17,000, 47,000) = 646.00.
//   (Pre-fix engine: 3.8% × 20,000 = 760.)
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 230000, employerName: "A" }],
    form1099s: [
      { formType: "int", interestIncome: 20000 },
      { formType: "b", longTermGainLoss: -10000 },
    ],
  }));
  check("H1 AGI 247,000", r.adjustedGrossIncome, 247000);
  check("H1 allowed capital loss 3,000", r.capitalLossDeducted, 3000);
  check("H1 NIIT 646 (NII = 20,000 − 3,000)", r.niitTax, 646);
}

// H2 — MFS $1,500 limit: $200k wages + $20k interest + $10k LT loss.
//   AGI = 218,500. NII = 20,000 − 1,500 = 18,500. Excess over 125,000 =
//   93,500 → NIIT = 3.8% × 18,500 = 703.
{
  const r = computeTaxReturnPure(inputs({
    filingStatus: "married_filing_separately",
    w2s: [{ wagesBox1: 200000, employerName: "A" }],
    form1099s: [
      { formType: "int", interestIncome: 20000 },
      { formType: "b", longTermGainLoss: -10000 },
    ],
  }));
  check("H2 MFS allowed loss 1,500", r.capitalLossDeducted, 1500);
  check("H2 MFS NIIT 703", r.niitTax, 703);
}

// H3 — the loss can zero NII but not drive it negative: $300k wages + $1k
// interest + $10k LT loss → NII = max(0, 1,000 − 3,000) = 0 → NIIT 0.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 300000, employerName: "A" }],
    form1099s: [
      { formType: "int", interestIncome: 1000 },
      { formType: "b", longTermGainLoss: -10000 },
    ],
  }));
  check("H3 NII floored at 0 → NIIT 0", r.niitTax, 0);
}

// H4 — control: net-GAIN path unchanged. $230k wages + $20k LTCG → AGI
//   250,000, NII 20,000, excess 50,000 → NIIT 760.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 230000, employerName: "A" }],
    form1099s: [{ formType: "b", longTermGainLoss: 20000 }],
  }));
  check("H4 gain-path control NIIT 760", r.niitTax, 760);
}

// ════════════════════════════════════════════════════════════════════════════
// I — F-10: non-qualified annuity (1099-R code D) in NII
// ════════════════════════════════════════════════════════════════════════════

// I1 — single FL, $240k wages + code-D annuity taxable 30,000.
//   AGI = 270,000; NII = 30,000; excess = 70,000 → NIIT = 3.8%×30,000 = 1,140.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 240000, employerName: "A" }],
    form1099s: [{ formType: "r", grossDistribution: 30000, taxableAmount: 30000, distributionCode: "D" }],
  }));
  check("I1 code-D annuity NIIT 1,140", r.niitTax, 1140);
  check("I1 summary nonQualifiedAnnuityIncome 30,000",
    r.form1099Summary.nonQualifiedAnnuityIncome, 30000);
}

// I2 — combo code "7D" (normal distribution from a non-qualified annuity)
// also counts.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 240000, employerName: "A" }],
    form1099s: [{ formType: "r", grossDistribution: 30000, taxableAmount: 30000, distributionCode: "7D" }],
  }));
  check("I2 code 7D NIIT 1,140", r.niitTax, 1140);
}

// I3 — control: code "7" (qualified-plan normal distribution) stays OUT of
// NII (§1411(c)(5)) → NIIT 0.
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 240000, employerName: "A" }],
    form1099s: [{ formType: "r", grossDistribution: 30000, taxableAmount: 30000, distributionCode: "7" }],
  }));
  check("I3 code-7 control NIIT 0", r.niitTax, 0);
  check("I3 nonQualifiedAnnuityIncome 0", r.form1099Summary.nonQualifiedAnnuityIncome, 0);
}

// I4 — code "1" (early, qualified plan): §72(t) penalty 10% applies but NO
// NIIT (it is not code D).
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 240000, employerName: "A" }],
    form1099s: [{ formType: "r", grossDistribution: 30000, taxableAmount: 30000, distributionCode: "1" }],
  }));
  check("I4 code-1 NIIT 0", r.niitTax, 0);
  check("I4 code-1 §72(t) penalty 3,000 unchanged", r.earlyWithdrawalPenalty, 3000);
}

// I5 — code D below the MAGI threshold: $100k wages + 30,000 code D → AGI
//   130,000 < 200,000 → NIIT 0 (threshold control).
{
  const r = computeTaxReturnPure(inputs({
    w2s: [{ wagesBox1: 100000, employerName: "A" }],
    form1099s: [{ formType: "r", grossDistribution: 30000, taxableAmount: 30000, distributionCode: "D" }],
  }));
  check("I5 below-threshold control NIIT 0", r.niitTax, 0);
}

// ════════════════════════════════════════════════════════════════════════════
const total = PASS.length + FAIL.length;
console.log(`\nT1.0b — AMT credit + other federal taxes (audit 2026-06-11):`);
for (const f of FAIL) console.log(`  ${f}`);
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed (${total} total)`);
process.exit(FAIL.length > 0 ? 1 : 0);
