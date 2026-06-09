/**
 * Regression tests for the 2026-06-08 FULL-APP MAXIMUM AUDIT (T0.3).
 * Each pins a confirmed bug fix; every expected value is hand-calc'd against the
 * IRS primary source. NO API / NO DB. See docs/accuracy-audit/full-app-audit-2026-06-08.md.
 *
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-audit-2026-06-08-tests.ts
 */
import {
  computeTaxReturnPure,
  summarize1099s,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { calculateStateTax, saversCreditRateFor, getDependentStandardDeductionBase, calculateAmt, nycEitcRateForAgi, calculateMultiStateTax } from "../../artifacts/api-server/src/lib/taxCalculator";
import { validateW2 } from "@workspace/validation";
import { mapInfoReturnToInputs } from "../../artifacts/api-server/src/lib/documentExtractor";
import { calculateStateIndividualMandatePenalty, caFilingThreshold } from "../../artifacts/api-server/src/lib/stateMandate";

const PASS: string[] = [];
const FAIL: string[] = [];
function near(a: number, b: number, tol = 0.02) { return Math.abs(a - b) <= tol; }
function check(label: string, actual: number, expected: number, tol = 0.02) {
  if (near(actual, expected, tol)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (Δ ${(actual - expected).toFixed(2)})`);
}
function ok(label: string, cond: boolean) { (cond ? PASS : FAIL).push(`${cond ? "✓" : "✗"} ${label}`); }
function header(t: string) { console.log(`\n── ${t} ──`); }

// ════════════════════════════════════════════════════════════════════════════
// F1 — AI-approved 1099 formType case-insensitivity (CRITICAL).
// The ApproveExtractionBody enum is UPPERCASE; summarize1099s filtered lowercase,
// silently dropping ALL income from every AI-approved 1099.
// ════════════════════════════════════════════════════════════════════════════
header("F1 — 1099 formType is case-insensitive (no silent income drop)");
{
  const s = summarize1099s([
    { formType: "INT", interestIncome: 5000 } as never,
    { formType: "NEC", nonemployeeCompensation: 12000 } as never,
    { formType: "DIV", ordinaryDividends: 800, qualifiedDividends: 800 } as never,
  ]);
  check("UPPERCASE INT → interestIncome 5000", s.interestIncome, 5000, 0.01);
  check("UPPERCASE NEC → seIncome 12000", s.seIncome, 12000, 0.01);
  check("UPPERCASE DIV → qualifiedDividends 800", s.qualifiedDividends, 800, 0.01);
  // e2e: an uppercase-INT 1099 must reach AGI.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 40000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [{ formType: "INT", interestIncome: 5000 } as never],
    adjustments: [], taxYear: 2024,
  });
  check("e2e: AGI = 40000 wages + 5000 INT interest", r.adjustedGrossIncome, 45000, 1);

  // F1b — case-insensitivity must hold at ALL formType read sites, not just
  // summarize1099s (code-review 2026-06-08 caught two missed sibling consumers:
  // the MFJ per-spouse SE split + the DIV cap-gain-distribution branch). Assert
  // uppercase ≡ lowercase produce identical returns on both paths.
  const mkMfjNec = (ft: string): TaxReturnInputs => ({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 200000, socialSecurityWagesBox3: 180000, federalTaxWithheldBox2: 0, stateCode: "FL", spouse: "taxpayer" } as never],
    form1099s: [{ formType: ft, nonemployeeCompensation: 50000, spouse: "spouse" } as never],
    adjustments: [], taxYear: 2024,
  });
  check("F1b MFJ uppercase NEC → spouse SE tax (not dropped)",
    computeTaxReturnPure(mkMfjNec("NEC")).selfEmploymentTax,
    computeTaxReturnPure(mkMfjNec("nec")).selfEmploymentTax, 0.01);
  ok("F1b MFJ NEC SE tax > 0 (uppercase counted)", computeTaxReturnPure(mkMfjNec("NEC")).selfEmploymentTax > 1000);
  const mkDiv = (ft: string): TaxReturnInputs => ({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 80000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [{ formType: ft, totalCapitalGainDistribution: 10000 } as never],
    capitalTransactions: [{ description: "X", proceeds: 13000, costBasis: 10000, longTerm: true } as never],
    adjustments: [], taxYear: 2024,
  });
  check("F1b uppercase DIV cap-gain distribution counted with capital txns present",
    computeTaxReturnPure(mkDiv("DIV")).netCapitalGainLoss,
    computeTaxReturnPure(mkDiv("div")).netCapitalGainLoss, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// F2 — AMT standard-deduction addback (Form 6251 line 2a / IRC §56(b)(1)(E)).
// A std-deduction filer who hits AMT must add the std ded back to AMTI.
// Single, $250k wages, $300k ISO bargain, std ded $14,600, TY2024.
//   Regular taxable = 250,000 − 14,600 = 235,400.
//   Regular tax (single 2024) = 1,160 + 4,266 + 11,742.50 + 21,942 + 13,904 = 53,014.50.
//   AMTI = 235,400 + ISO 300,000 + std-ded addback 14,600 = 550,000.
//   AMTI < phase-out start 609,350 → exemption = 85,700 → amtBase = 464,300.
//   TMT = 232,600×.26 + (464,300−232,600)×.28 = 60,476 + 64,876 = 125,352.
//   amtTax = TMT − regularTax = 125,352 − 53,014.50 = 72,337.50.
//   (Without the addback, AMTI 535,400 → TMT 121,264 → amtTax 68,249.50; the
//    std-ded addback adds 14,600 × 28% = $4,088.)
// ════════════════════════════════════════════════════════════════════════════
header("F2 — AMT std-deduction addback (§56(b)(1)(E))");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 250000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "amt_iso_bargain_element", amount: 300000, isApplied: true }],
    taxYear: 2024,
  });
  check("amtTax includes the std-ded addback ($14,600 @ 28%)", r.amtTax, 72337.50, 1.0);
}

// ════════════════════════════════════════════════════════════════════════════
// F4 — 2024 MFS max-15%-LTCG breakpoint = $291,850 (Rev. Proc. 2023-34 §3.03),
// NOT 583,750/2 = 291,875. MFS, all LTCG, taxable income = 291,860.
//   Std ded MFS 2024 = 14,600 → need LTCG = 306,460.
//   0% on 0–47,025; 15% on 47,025–291,850; 20% on 291,850–291,860.
//   tax = (291,850−47,025)×0.15 + (291,860−291,850)×0.20
//       = 244,825×0.15 + 10×0.20 = 36,723.75 + 2.00 = 36,725.75.
//   (Old 291,875 breakpoint would tax all to 291,860 at 15% = 36,725.25.)
// ════════════════════════════════════════════════════════════════════════════
header("F4 — MFS 2024 max-15% LTCG breakpoint $291,850");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ formType: "b", longTermGainLoss: 306460 } as never],
    adjustments: [], taxYear: 2024,
  });
  check("capitalGainsTax uses 291,850 breakpoint", r.capitalGainsTax, 36725.75, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// F5 — W-2 validation SS-wage-base map covers TY2026 ($184,500). A 2026 Box 3
// over the cap must flag an error (was silently skipped — map ended at 2025).
// ════════════════════════════════════════════════════════════════════════════
header("F5 — W-2 validation knows the TY2026 SS wage base");
{
  const flags = validateW2(
    { taxYear: 2026, wagesBox1: 200000, socialSecurityWagesBox3: 200000, medicareWagesBox5: 200000 },
    { clientTaxYear: 2026 },
  );
  const hasCapErr = flags.some((f) => f.severity === "error" && /social security wage|wage base|184,?500|box 3/i.test(`${f.field} ${f.message}`));
  ok("2026 Box 3 > $184,500 raises an error flag", hasCapErr);
  // Box 3 within cap → no cap error.
  const ok2026 = validateW2(
    { taxYear: 2026, wagesBox1: 150000, socialSecurityWagesBox3: 150000, medicareWagesBox5: 150000 },
    { clientTaxYear: 2026 },
  );
  ok("2026 Box 3 within cap → no over-cap error", !ok2026.some((f) => f.severity === "error" && /wage base|184,?500/i.test(f.message)));
}

// ════════════════════════════════════════════════════════════════════════════
// C2 — NIIT §1231 non-passive exclusion capped at the surviving disposition gain.
// Single, wages 700k, investment_income 50k, capital_loss_carryforward_long 80k,
// Form 4797 non-passive §1231 land gain 100k.
//   netLTCG = 100,000 (§1231) − 80,000 (LT carryforward) = 20,000 surviving.
//   NII = 50,000 interest + 20,000 LTCG − min(100,000, 20,000) = 50,000.
//   NIIT = 3.8% × min(50,000, MAGI−200,000) = 3.8% × 50,000 = 1,900.
//   (Bug: subtracting the GROSS 100,000 drove NII negative → floored 0 → NIIT 0,
//    wiping the unrelated $50k of interest.)
// ════════════════════════════════════════════════════════════════════════════
header("C2 — NIIT §1231 exclusion capped at surviving gain");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 700000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "investment_income", amount: 50000, isApplied: true },
      { adjustmentType: "capital_loss_carryforward_long", amount: 80000, isApplied: true },
    ],
    form4797: [{
      taxYear: 2024, grossSalePrice: 100000, costOrBasis: 0, depreciationAllowed: 0,
      assetClass: "land", heldMoreThanOneYear: true, nonPassive: true,
    }],
    taxYear: 2024,
  });
  check("NIIT = 3.8% × $50k surviving NII (not 0)", r.niitTax, 1900, 1.0);
}

// ════════════════════════════════════════════════════════════════════════════
// SEC1 — engine totality: extreme finite inputs must NOT overflow to ±Infinity.
// Two -1e308 wages summed to -Infinity before the toNum clamp (fuzz-found).
// ════════════════════════════════════════════════════════════════════════════
header("SEC1 — engine stays total on extreme finite inputs");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "CA", taxYear: 2024 },
    w2s: [
      { wagesBox1: 1e308, federalTaxWithheldBox2: 1e308, stateCode: "CA" },
      { wagesBox1: 1e308, federalTaxWithheldBox2: 0, stateCode: "CA" },
    ],
    form1099s: [], adjustments: [], taxYear: 2024,
  });
  ok("federalTaxLiability finite", Number.isFinite(r.federalTaxLiability));
  ok("AGI finite", Number.isFinite(r.adjustedGrossIncome));
  ok("stateTaxLiability finite", Number.isFinite(r.stateTaxLiability));
  ok("effectiveTaxRate finite", Number.isFinite(r.effectiveTaxRate));
}

// SEC P1 — sub-dollar income must not explode the effective rate.
header("SEC — sub-dollar income → effectiveTaxRate 0 (not exploded)");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 5e-324, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [], adjustments: [], taxYear: 2024,
  });
  ok("effectiveTaxRate is finite + sane", Number.isFinite(r.effectiveTaxRate) && Math.abs(r.effectiveTaxRate) <= 2);
}

// ════════════════════════════════════════════════════════════════════════════
// STATE RATE CORRECTIONS (S1/S3/S4/S5/S6/S7) — verified vs each state DOR.
// $80k single, std ded = federal $14,600 (2024) / $15,750 (2025) for the
// conforming states (CO/ID/SC). Tax = (80,000 − stdDed) × rate.
// ════════════════════════════════════════════════════════════════════════════
header("State rate corrections — 2024 base + 2025/2026 overrides");
{
  // S1 — Wisconsin 2024 bottom brackets 3.50%/4.40% (Wis. Stat. §71.06).
  // $25k single: stdDed phases to 13,230 − 0.12×(25,000−19,070)=12,518.40;
  // taxable 12,481.60 → all in bracket 1 @ 3.5% = $436.86.
  check("S1 WI 2024 single $25k bottom rate 3.5%", calculateStateTax(25000, "WI", "single", 2024), 436.86, 0.5);
  // S3 — Idaho 5.695% (2024) → 5.3% (2025). std ded conforms.
  check("S3 ID 2024 $80k = (80k−14.6k)×5.695%", calculateStateTax(80000, "ID", "single", 2024), (80000 - 14600) * 0.05695, 0.5);
  check("S3 ID 2025 $80k = (80k−15.75k)×5.3%", calculateStateTax(80000, "ID", "single", 2025), (80000 - 15750) * 0.053, 0.5);
  // S4 — Colorado 4.25% (2024 temp) → 4.40% base (2025).
  check("S4 CO 2024 $80k = (80k−14.6k)×4.25%", calculateStateTax(80000, "CO", "single", 2024), (80000 - 14600) * 0.0425, 0.5);
  check("S4 CO 2025 $80k = (80k−15.75k)×4.40%", calculateStateTax(80000, "CO", "single", 2025), (80000 - 15750) * 0.044, 0.5);
  // S5 — South Carolina top 6.2% (2024) → 6.0% (2025). Brackets 0/3/top.
  // $80k 2024: 0×3,460 + 3%×(17,330−3,460) + 6.2%×(80,000−15,750−17,330) ... uses conforming std ded.
  // Verify the TOP marginal: tax(80k 2025) < tax(80k 2024) by the rate cut on the top slice.
  ok("S5 SC 2025 top rate (6.0%) < 2024 (6.2%) at $80k",
    calculateStateTax(80000, "SC", "single", 2025) < calculateStateTax(80000, "SC", "single", 2024));
  // S6 — Ohio 2025 top 3.125%, 2026 flat 2.75%. $150k single (above $100k).
  // 2025: 0×26,050 + 2.75%×(100,000−26,050) + 3.125%×(150,000−100,000) = 2,033.625 + 1,562.50 = $3,596.13.
  check("S6 OH 2025 $150k top 3.125%", calculateStateTax(150000, "OH", "single", 2025), 3596.13, 0.5);
  // 2026 flat 2.75% over $26,050: 2.75%×(150,000−26,050) = $3,408.625.
  check("S6 OH 2026 $150k flat 2.75%", calculateStateTax(150000, "OH", "single", 2026), 3408.63, 0.5);
  // S7 — Nebraska 2025 top 5.20% (LB754; lower 2.46/3.51/5.01% unchanged).
  // $80k single; NE std ded ~$8,300 (pre-existing) → taxable ≈ 71,700:
  // 2.46%×3,700 + 3.51%×(22,170−3,700) + 5.01%×(35,730−22,170) + 5.2%×(71,700−35,730)
  // = 91.02 + 648.30 + 679.36 + 1,870.44 = $3,289.11. The corrected 5.20% top rate
  // is what's verified (was 5.84%); the std ded is unchanged by this fix.
  check("S7 NE 2025 $80k top 5.20%", calculateStateTax(80000, "NE", "single", 2025), 3289.11, 1.0);
}

// ════════════════════════════════════════════════════════════════════════════
// Q3 — Saver's Credit (G1.31) detector now reads the YEAR-INDEXED engine tiers
// (was a hardcoded TY2024-only band map → mis-rated TY2025+). saversCreditRateFor
// is the shared source of truth the detector uses.
// ════════════════════════════════════════════════════════════════════════════
header("Q3 — Saver's Credit rate is year-indexed (single source)");
{
  ok("2024 single $23,000 → 50%", saversCreditRateFor(2024, "single", 23000) === 0.50);
  ok("2024 single $23,500 → 20% (above the 2024 $23,000 band)", saversCreditRateFor(2024, "single", 23500) === 0.20);
  // The fix: a TY2025 single at $23,500 is in the 50% band ($23,750) — the old
  // hardcoded TY2024 bands wrongly rated it 20%.
  ok("2025 single $23,500 → 50% (2025 band $23,750; was wrongly 20%)", saversCreditRateFor(2025, "single", 23500) === 0.50);
  ok("2026 single $24,000 → 50% (2026 band $24,250)", saversCreditRateFor(2026, "single", 24000) === 0.50);
  ok("2025 MFJ $47,000 → 50% (2025 band $47,500)", saversCreditRateFor(2025, "married_filing_jointly", 47000) === 0.50);
}

// ════════════════════════════════════════════════════════════════════════════
// E3b — IRC §63(c)(5) dependent standard deduction (greater of the year floor or
// earned income + $450, capped at the regular std ded). isKiddieTaxFiler OR the
// new claimedAsDependent flag triggers it.
// ════════════════════════════════════════════════════════════════════════════
header("E3b — dependent §63(c)(5) limited standard deduction");
{
  // The helper directly.
  check("2024 dep, $0 earned → floor $1,300", getDependentStandardDeductionBase("single", 2024, 0), 1300, 0.01);
  check("2024 dep, $5,000 earned → $5,450", getDependentStandardDeductionBase("single", 2024, 5000), 5450, 0.01);
  check("2024 dep, $20,000 earned → capped at regular $14,600", getDependentStandardDeductionBase("single", 2024, 20000), 14600, 0.01);
  check("2025 dep, $0 earned → floor $1,350", getDependentStandardDeductionBase("single", 2025, 0), 1350, 0.01);
  check("2026 dep, $0 earned → floor $1,350", getDependentStandardDeductionBase("single", 2026, 0), 1350, 0.01);
  // e2e via the NEW claimedAsDependent flag (non-kiddie dependent — e.g. a
  // student with a summer job + $0 investment income): $8,000 wages, std ded
  // limited to 8,000+450 = $8,450 → taxable $0 (8,000 < 8,450) but only because
  // earned≈std; use $12,000 wages → std ded $12,450 → taxable $0 still. Use
  // $20,000 wages → std ded capped $14,600 → taxable $5,400 (vs full would be same).
  // Cleaner: $6,000 wages → dep std ded $6,450 → taxable $0; a NON-dependent
  // $6,000 earner also has taxable $0 (under $14,600) — so test the binding case:
  // dependent with $4,000 wages + $5,000 interest.
  const dep = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, claimedAsDependent: true } as never,
    w2s: [{ wagesBox1: 4000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [{ formType: "int", interestIncome: 5000 } as never],
    adjustments: [], taxYear: 2024,
  });
  // earned $4,000 → dep std ded = max($1,300, 4,000+450)=$4,450. AGI $9,000.
  // Taxable = 9,000 − 4,450 = $4,550.
  check("e2e claimedAsDependent: taxable = $4,550 (dep std ded $4,450)", dep.taxableIncome, 4550, 1);
  const nonDep = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 4000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [{ formType: "int", interestIncome: 5000 } as never],
    adjustments: [], taxYear: 2024,
  });
  // Same income, NOT a dependent → full $14,600 std ded → taxable $0.
  ok("non-dependent same income → taxable 0 (full std ded)", nonDep.taxableIncome === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// C1 — credit ordering: the CTC is applied AFTER the Schedule-3 personal credits
// (FTC/dep-care/education/Saver's/energy/adoption) per the Schedule 8812 Credit
// Limit Worksheet, so the non-carryforward credits aren't wasted and the maximum
// CTC spills to the refundable ACTC. HoH $30k + 1 child + $3k dependent care:
// dep-care $810 zeroes the $810 tax → CTC nonref $0 → ACTC = min($2,000,$1,700)
// = $1,700 (vs $1,190 without dep care). Net refund +$510.
// ════════════════════════════════════════════════════════════════════════════
header("C1 — CTC applied after Sch-3 credits (dep care no longer wasted)");
{
  const mk = (dep: boolean): TaxReturnInputs => ({
    client: { filingStatus: "head_of_household", state: "FL", taxYear: 2024, dependentsUnder17: 1, dependentsForCareCredit: 1 } as never,
    w2s: [{ wagesBox1: 30000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: dep ? [{ adjustmentType: "dependent_care_expenses", amount: 3000, isApplied: true }] : [],
    taxYear: 2024,
  });
  const no = computeTaxReturnPure(mk(false));
  const yes = computeTaxReturnPure(mk(true));
  check("dependent care credit is APPLIED (not wasted)", yes.dependentCareCredit.appliedCredit, 810, 0.5);
  check("ACTC maximized to $1,700 when dep care zeroes the tax", yes.additionalChildTaxCredit, 1700, 1);
  check("adding $3k dep care raises the refund by $510", yes.federalRefundOrOwed - no.federalRefundOrOwed, 510, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// C3 — IRC §55(d)(3) MFS "phantom" AMTI add-back. Once the MFS exemption fully
// phases out (AMTI > $875,950 in 2024), AMTI += min(rate×(AMTI−zeroAt), exemption).
// MFS taxable $1,000,000, no prefs, 2024: zeroAt = 609,350 + 66,650/0.25 = 875,950;
// add-back = min(0.25×(1,000,000−875,950), 66,650) = min(31,012.50, 66,650) = 31,012.50.
// amtBase = 1,031,012.50; TMT (MFS breakpoint $116,300) = 116,300×.26 +
// (1,031,012.50−116,300)×.28 = 30,238 + 256,119.50 = $286,357.50.
// ════════════════════════════════════════════════════════════════════════════
header("C3 — AMT MFS §55(d)(3) phantom add-back");
{
  const mfs = calculateAmt({ taxableIncome: 1_000_000, amtPreferences: 0, filingStatus: "married_filing_separately", regularTax: 333062.75, taxYear: 2024 });
  check("MFS $1M TMT includes the §55(d)(3) add-back = $286,357.50", mfs.amtBeforeRegular, 286357.50, 1);
  // Below the full-phase-out point → NO add-back (MFS $800k, exemption not yet 0).
  const mfsLow = calculateAmt({ taxableIncome: 800_000, amtPreferences: 0, filingStatus: "married_filing_separately", regularTax: 0, taxYear: 2024 });
  // amti 800k; exemption = max(0, 66,650 − 0.25×(800,000−609,350)) = max(0, 66,650−47,662.50) = 18,987.50;
  // amtBase = 800,000 − 18,987.50 = 781,012.50; below zeroAt $875,950 → no add-back.
  check("MFS $800k (exemption not fully phased) → no add-back", mfsLow.amtBeforeRegular,
    116300 * 0.26 + (781012.50 - 116300) * 0.28, 1);
  // Single control at the same AMTI is unaffected by the MFS rule.
  const single = calculateAmt({ taxableIncome: 1_000_000, amtPreferences: 0, filingStatus: "single", regularTax: 0, taxYear: 2024 });
  check("single $1M unaffected (TMT $275,348)", single.amtBeforeRegular, 232600 * 0.26 + (1_000_000 - 232600) * 0.28, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// C4 — IRA-deduction MAGI adds back the SLI deduction + FEIE (Pub 590-A Wksht 1-1).
// Single, covered by a workplace plan, $86k W-2, $2,500 SLI, $7k trad IRA, 2024.
// SLI deductible (80-95k phase-out @ MAGI 86k = 0.60) = $1,500. IRA MAGI must add
// that back → $86,000 (not $84,500), so the IRA phase-out (77-87k) fraction is
// (87,000−86,000)/10,000 = 0.10 → IRA deductible $7,000×0.10 = $700 (was $1,750).
// ════════════════════════════════════════════════════════════════════════════
header("C4 — IRA MAGI adds back SLI + FEIE");
{
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, iraCoveredByWorkplacePlan: true } as never,
    w2s: [{ wagesBox1: 86000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [
      { adjustmentType: "student_loan_interest", amount: 2500, isApplied: true },
      { adjustmentType: "ira_contribution_traditional", amount: 7000, isApplied: true },
    ], taxYear: 2024,
  } as never);
  check("IRA deductible = $700 (SLI added back to MAGI)", (r as never as { retirementDeductions: { iraDeductible: number } }).retirementDeductions.iraDeductible, 700, 1);
  // Without SLI, the IRA MAGI is $86,000 too (no SLI to add back) — same $700.
  // Control: lower the wage so MAGI is well below the band → full $7,000.
  const full = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, iraCoveredByWorkplacePlan: true } as never,
    w2s: [{ wagesBox1: 60000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [],
    adjustments: [{ adjustmentType: "ira_contribution_traditional", amount: 7000, isApplied: true }], taxYear: 2024,
  } as never);
  check("IRA deductible = $7,000 (MAGI $60k below the band)", (full as never as { retirementDeductions: { iraDeductible: number } }).retirementDeductions.iraDeductible, 7000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// E1 — EITC qualifying-children count (§32(c)(3): <19 / <24 student) is a wider
// set than the CTC's <17. New `eitcQualifyingChildren` field; null → defaults to
// dependentsUnder17 (backward compatible). HoH, $20k earned, 2024 (plateau).
// ════════════════════════════════════════════════════════════════════════════
header("E1 — EITC qualifying-children count (separate from CTC <17)");
{
  const mk = (eitc?: number): TaxReturnInputs => ({
    client: { filingStatus: "head_of_household", state: "FL", taxYear: 2024, dependentsUnder17: 1, eitcQualifyingChildren: eitc } as never,
    w2s: [{ wagesBox1: 20000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [], adjustments: [], taxYear: 2024,
  });
  // Default (null) → dependentsUnder17 = 1 → 1-child EITC max $4,213 (2024).
  check("default → dependentsUnder17 (1 child EITC $4,213)", computeTaxReturnPure(mk(undefined)).eitc.appliedCredit, 4213, 1);
  // Explicit 2 (e.g. a 17/18-yo qualifying child not in the CTC <17 count) → $6,960.
  check("explicit 2 EITC children → 2-child EITC $6,960", computeTaxReturnPure(mk(2)).eitc.appliedCredit, 6960, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// A1 — 1098 Box 4 (refund of overpaid interest) reduces the deductible mortgage
// interest (Box 1 − Box 4), per Pub 936. A2 — 1099-INT Box 2 early-withdrawal
// penalty is an above-the-line deduction (§62(a)(9)), reducing AGI.
// ════════════════════════════════════════════════════════════════════════════
header("A1/A2 — 1098 Box 4 netting + 1099-INT Box 2 deduction");
{
  const m = mapInfoReturnToInputs({ infoType: "1098", mortgageInterestReceived: 12000, refundOfOverpaidInterest: 500 } as never, "test.pdf");
  const mi = m.adjustments.find((a) => a.adjustmentType === "mortgage_interest");
  check("A1 mortgage interest = Box1 − Box4 = $11,500", mi?.amount ?? -1, 11500, 0.01);
  // No Box 4 → full Box 1.
  const m2 = mapInfoReturnToInputs({ infoType: "1098", mortgageInterestReceived: 12000 } as never, "test.pdf");
  check("A1 no Box 4 → full $12,000", m2.adjustments.find((a) => a.adjustmentType === "mortgage_interest")?.amount ?? -1, 12000, 0.01);
  // A2 — 1099-INT $2,000 early-withdrawal penalty reduces AGI by $2,000.
  const noP = computeTaxReturnPure({ client: { filingStatus: "single", state: "FL", taxYear: 2024 }, w2s: [{ wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }], form1099s: [{ formType: "int", interestIncome: 3000 } as never], adjustments: [], taxYear: 2024 });
  const withP = computeTaxReturnPure({ client: { filingStatus: "single", state: "FL", taxYear: 2024 }, w2s: [{ wagesBox1: 50000, federalTaxWithheldBox2: 0, stateCode: "FL" }], form1099s: [{ formType: "int", interestIncome: 3000, earlyWithdrawalPenalty: 2000 } as never], adjustments: [], taxYear: 2024 });
  check("A2 1099-INT $2k early-withdrawal penalty → AGI −$2,000", noP.adjustedGrossIncome - withP.adjustedGrossIncome, 2000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// State batch 2 — KY/MN/MA/AZ + DC/CA mandate (each DOR/statute-verified).
// ════════════════════════════════════════════════════════════════════════════
header("State batch 2 — KY/MN/MA/AZ + DC/CA mandate year-indexing");
{
  // S11 — KY 2025 = 4.0% (NOT 3.5% — HB1's 3.5% starts 2026). std ded $3,270.
  check("KY 2025 $80k = (80k−3,270)×4.0%", calculateStateTax(80000, "KY", "single", 2025), (80000 - 3270) * 0.04, 0.5);
  check("KY 2026 $80k = (80k−3,360)×3.5%", calculateStateTax(80000, "KY", "single", 2026), (80000 - 3360) * 0.035, 0.5);
  // S2 — MN 2025 uses its OWN std ded $14,950 (not the federal $15,750). MN 2025
  // taxable at $40k income = 40,000 − 14,950 = 25,050 (< first bracket $31,690) → 5.35%.
  check("S2 MN 2025 $40k = (40k−14,950)×5.35%", calculateStateTax(40000, "MN", "single", 2025), (40000 - 14950) * 0.0535, 0.5);
  // S9 — AZ 2025 conforms to the federal (OBBBA) std ded $15,750, flat 2.5%.
  check("S9 AZ 2025 $80k = (80k−15,750)×2.5%", calculateStateTax(80000, "AZ", "single", 2025), (80000 - 15750) * 0.025, 0.5);
  // S8 — MA 4% surtax 2025 threshold $1,083,150 (was $1,053,750). At $1,070,000
  // taxable, NO surtax in 2025 (below the new threshold); 5% only.
  check("S8 MA 2025 $1.07M = 5% only (below $1,083,150 surtax)", calculateStateTax(1070000, "MA", "single", 2025), 1070000 * 0.05, 1);
  // M1 — DC mandate indexes: 2024 $745/adult, 2025 $795.
  check("M1 DC 2025 single flat $795", calculateStateIndividualMandatePenalty({ state: "DC", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 25000, filingThreshold: 14600, monthsUninsured: 12, taxYear: 2025 }).penalty, 795, 0.01);
  // M2 — CA mandate 2025 $950/adult (was $900 in 2024).
  check("M2 CA 2025 single flat $950 (low income)", calculateStateIndividualMandatePenalty({ state: "CA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0, householdIncome: 20000, filingThreshold: 21561, monthsUninsured: 12, taxYear: 2025 }).penalty, 950, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// L1 — NYC EIC rate table (IT-215 Worksheet C): flat plateaus + linear transition
// bands, max 30%, floor 10% (the old 5% floor was repealed TY2022). The prior
// engine bands (10k/15k/25k/35k/50k + 5% floor) were wrong.
// ════════════════════════════════════════════════════════════════════════════
header("L1 — NYC EIC rate table (plateaus + interpolation, 10% floor)");
{
  check("$4,000 → 30%", nycEitcRateForAgi(4000), 0.30, 0.0001);
  check("$10,000 → 25%", nycEitcRateForAgi(10000), 0.25, 0.0001);
  check("$18,000 → 20%", nycEitcRateForAgi(18000), 0.20, 0.0001);
  check("$30,000 → 15%", nycEitcRateForAgi(30000), 0.15, 0.0001);
  check("$55,000 → 10% (was wrongly 5%)", nycEitcRateForAgi(55000), 0.10, 0.0001);
  // Transition band $5,000-$7,500: 0.30 − (6250−4999)×0.00002 = 0.275.
  check("$6,250 transition → 27.5%", nycEitcRateForAgi(6250), 0.275, 0.0001);
}

// ════════════════════════════════════════════════════════════════════════════
// F3 — §1250/28% loss-absorption: a net STCL + LT carryover offsets the 28%
// bucket FIRST, then spills onto §1250, INDEPENDENT of any plain 0/15/20 gain
// (the prior bound let a plain gain "shield" the special buckets → over-charge).
// W-2 $700k; LT §1250 $30k; LT collectible $20k; plain LT $50k; ST loss $40k:
// loss $40k → 28% $20k→$0 (absorbs $20k); spill $20k → §1250 $30k→$10k. Plain $50k.
// ════════════════════════════════════════════════════════════════════════════
header("F3 — §1250/28% loss absorption (no plain-gain shielding)");
{
  const mk = (stLoss: number): TaxReturnInputs => ({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 700000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [{ formType: "b", longTermGainLoss: 50000, shortTermGainLoss: stLoss } as never],
    adjustments: [
      { adjustmentType: "unrecaptured_section_1250_gain", amount: 30000, isApplied: true },
      { adjustmentType: "collectibles_28_rate_gain", amount: 20000, isApplied: true },
      { adjustmentType: "long_term_capital_gain", amount: 50000, isApplied: true },
    ], taxYear: 2024,
  });
  const withLoss = computeTaxReturnPure(mk(-40000));
  check("§1250 = $10,000 (loss spilled onto it)", withLoss.unrecapturedSection1250Gain, 10000, 1);
  check("collectibles 28% = $0 (loss absorbed first)", withLoss.collectibles28RateGain, 0, 1);
  // No loss → full buckets (no regression).
  const noLoss = computeTaxReturnPure(mk(0));
  check("no loss → §1250 = $30,000 (full)", noLoss.unrecapturedSection1250Gain, 30000, 1);
  check("no loss → collectibles 28% = $20,000 (full)", noLoss.collectibles28RateGain, 20000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// E2 — MFJ per-spouse Sch SE: a spouse-tagged self_employment_income adjustment
// credits the right spouse's W-2 SS wages against the SE SS base. MFJ, taxpayer
// W-2 Box 3 $180k (> the $168,600 SS base) + taxpayer Sch C $50k: tagged
// "taxpayer" → SE owes only 2.9% Medicare = $50k×0.9235×0.029 = $1,339.08 (vs
// the conservative untagged default $7,064.77). Default stays conservative.
// ════════════════════════════════════════════════════════════════════════════
header("E2 — MFJ per-spouse SE attribution (spouse-tagged adjustment)");
{
  const mk = (spouse?: string): TaxReturnInputs => ({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 180000, socialSecurityWagesBox3: 180000, federalTaxWithheldBox2: 0, stateCode: "FL", spouse: "taxpayer" } as never],
    form1099s: [],
    adjustments: [{ adjustmentType: "self_employment_income", amount: 50000, isApplied: true, spouse } as never],
    taxYear: 2024,
  });
  check("untagged → conservative default (over-tax preserved)", computeTaxReturnPure(mk(undefined)).selfEmploymentTax, 7064.77, 1);
  check("tagged taxpayer → SE on Medicare only = $1,339.08", computeTaxReturnPure(mk("taxpayer")).selfEmploymentTax, 1339.08, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// M3 — MA individual-mandate penalty schedule for TY2024/2025 (was a stale
// REUSE of the 2023 array). VERIFIED against MA DOR TIR 24-1 ($24/$48/$71/$109/
// $127/$175) + TIR 25-1 ($25/$49/$73/$113/$132/$187), per-ADULT monthly × months.
// FPL 2024 base $15,060 (size 1) / $20,440 (size 2); 2025 base $15,650.
// ════════════════════════════════════════════════════════════════════════════
header("M3 — MA mandate FPL-tier penalty TY2024/2025 (TIR 24-1 / 25-1)");
{
  // single, size 1, income $40k → FPL 40000/15060 = 265.6% → 250.1-300% tier.
  const ma24 = calculateStateIndividualMandatePenalty({
    state: "MA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0,
    householdIncome: 40000, filingThreshold: 0, monthsUninsured: 12, taxYear: 2024, householdSize: 1,
  });
  check("MA TY2024 single $40k 12mo → $71×12 = $852", ma24.penalty, 852.0, 0.01);
  // 2025 same profile: FPL 40000/15650 = 255.6% → 250.1-300% → $73/mo.
  const ma25 = calculateStateIndividualMandatePenalty({
    state: "MA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0,
    householdIncome: 40000, filingThreshold: 0, monthsUninsured: 12, taxYear: 2025, householdSize: 1,
  });
  check("MA TY2025 single $40k 12mo → $73×12 = $876", ma25.penalty, 876.0, 0.01);
  // MFJ, size 2, both uninsured, income $80k → FPL 80000/20440 = 391.4% → 300.1-400% → $109/adult.
  const maMfj = calculateStateIndividualMandatePenalty({
    state: "MA", filingStatus: "married_filing_jointly", uninsuredAdults: 2, uninsuredChildren: 0,
    householdIncome: 80000, filingThreshold: 0, monthsUninsured: 12, taxYear: 2024, householdSize: 2,
  });
  check("MA TY2024 MFJ $80k 2 adults 12mo → $109×2×12 = $2,616", maMfj.penalty, 2616.0, 0.01);
  // >500% FPL single (income $100k, size 1) → top Bronze tier $175 (2024) × 6 mo.
  const maTop = calculateStateIndividualMandatePenalty({
    state: "MA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0,
    householdIncome: 100000, filingThreshold: 0, monthsUninsured: 6, taxYear: 2024, householdSize: 1,
  });
  check("MA TY2024 >500% FPL single 6mo → $175×6 = $1,050", maTop.penalty, 1050.0, 0.01);
  ok("MA 2025 > 2024 at same tier (premium growth)", ma25.penalty > ma24.penalty);
}

// ════════════════════════════════════════════════════════════════════════════
// S10 — WV Social Security phase-out (HB 4880, 2024). 100% exempt ≤$50k single /
// ≤$100k joint federal AGI (all years). ABOVE the floor, WV subtracts 35% (2024)
// / 65% (2025) / 100% (2026) of the federally-taxable SS. The engine exempted
// 100% in every year (under-taxing high-income WV retirees). WV std ded $0;
// single brackets 2.22/2.96/3.33/4.44/4.82% (identical across 2024-2026).
// ════════════════════════════════════════════════════════════════════════════
header("S10 — WV SS phase-out (HB 4880: 35/65/100% above the floor)");
{
  // Above floor (AGI $80k), SS $20k. 2024: exclude 35% = $7,000 → base $73,000.
  //   222 + 444 + 499.50 + 888 + 13,000×4.82%(626.60) = $2,680.10
  check("WV 2024 single $80k AGI, $20k SS (35% excl) → $2,680.10",
    calculateStateTax(80000, "WV", "single", 2024, { taxableSocialSecurity: 20000 }), 2680.10, 0.05);
  // 2025: exclude 65% = $13,000 → base $67,000. + 7,000×4.82%(337.40) = $2,390.90
  check("WV 2025 single $80k AGI, $20k SS (65% excl) → $2,390.90",
    calculateStateTax(80000, "WV", "single", 2025, { taxableSocialSecurity: 20000 }), 2390.90, 0.05);
  // 2026: exclude 100% = $20,000 → base $60,000 → $2,053.50.
  check("WV 2026 single $80k AGI, $20k SS (100% excl) → $2,053.50",
    calculateStateTax(80000, "WV", "single", 2026, { taxableSocialSecurity: 20000 }), 2053.50, 0.05);
  // Below floor (AGI $40k ≤ $50k), SS $15k → 100% exempt every year → base $25,000.
  //   222 + 444 = $666.00
  check("WV 2024 single $40k AGI (≤floor), $15k SS (100% excl) → $666.00",
    calculateStateTax(40000, "WV", "single", 2024, { taxableSocialSecurity: 15000 }), 666.0, 0.05);
  ok("WV above-floor 2024 tax > 2026 tax (less SS excluded earlier)",
    calculateStateTax(80000, "WV", "single", 2024, { taxableSocialSecurity: 20000 }) >
    calculateStateTax(80000, "WV", "single", 2026, { taxableSocialSecurity: 20000 }));
}

// ════════════════════════════════════════════════════════════════════════════
// MD-08 — MD Anne Arundel + Frederick GRADUATED local income tax (CY2024+; MD
// Comptroller local-rate table). Was a single flat rate. Local base = federal
// AGI − MD std ded ($2,700 single / $5,450 MFJ). Brackets on MD taxable income;
// single column also covers MFS/dependent, joint column covers MFJ/HoH/QSS.
// ════════════════════════════════════════════════════════════════════════════
header("MD-08 — Anne Arundel + Frederick graduated local income tax");
{
  const md = (locality: string, agi: number, status: string) =>
    calculateMultiStateTax({
      residentState: "MD", federalAgi: agi, filingStatus: status, taxYear: 2024,
      perStateWages: [{ stateCode: "MD", wages: agi }], localityCode: locality, totalWages: agi,
    }).localTax?.netLocalTax ?? 0;
  // Anne Arundel single, AGI $102,700 → base $100,000: 2.70%×50k + 2.81%×50k.
  check("AnneArundel single base $100k → 1,350 + 1,405 = $2,755", md("MD-ANNE_ARUNDEL", 102700, "single"), 2755.0, 0.05);
  // Anne Arundel MFJ, AGI $105,450 → base $100,000: 2.70%×75k + 2.81%×25k.
  check("AnneArundel MFJ base $100k → 2,025 + 702.50 = $2,727.50", md("MD-ANNE_ARUNDEL", 105450, "married_filing_jointly"), 2727.50, 0.05);
  // Frederick single, AGI $202,700 → base $200,000: 2.25/2.75/2.96/3.20%.
  check("Frederick single base $200k → 562.50+687.50+2,960+1,600 = $5,810", md("MD-FREDERICK", 202700, "single"), 5810.0, 0.05);
  // Frederick MFJ, AGI $305,450 → base $300,000: 2.25/2.75/2.96/3.20% (joint widths).
  check("Frederick MFJ base $300k → 562.50+2,062.50+4,440+1,600 = $8,665", md("MD-FREDERICK", 305450, "married_filing_jointly"), 8665.0, 0.05);
  // Low-income Frederick single (base $20k, all in 2.25% band) → graduated < old flat 2.75%.
  ok("Frederick low-income uses 2.25% band (< old 2.75% flat)", md("MD-FREDERICK", 22700, "single") < 20000 * 0.0275);
}

// ════════════════════════════════════════════════════════════════════════════
// M4 — CA mandate percentage-method filing threshold (FTB 3853) + the §5000A
// bronze-premium cap counting at most 5 individuals. The engine used the federal
// std ded as the CA threshold (too low → over-penalty) and an UNCAPPED headcount
// for the bronze cap. Thresholds verified vs the 2024/2025 FTB 3853 instructions.
// ════════════════════════════════════════════════════════════════════════════
header("M4 — CA FTB 3853 filing threshold + bronze cap headcount ≤ 5");
{
  // Filing-threshold table (under-65), verified vs FTB 3853.
  check("CA 2024 single 0 dep → $17,818", caFilingThreshold("single", 0, 2024), 17818, 0.01);
  check("CA 2024 single 1 dep → $33,185", caFilingThreshold("single", 1, 2024), 33185, 0.01);
  check("CA 2024 single 2+ dep → $44,710", caFilingThreshold("single", 5, 2024), 44710, 0.01);
  check("CA 2024 MFJ 0 dep → $35,642", caFilingThreshold("married_filing_jointly", 0, 2024), 35642, 0.01);
  check("CA 2024 QSS 0 dep → $33,185 (single+1)", caFilingThreshold("qualifying_widow", 0, 2024), 33185, 0.01);
  check("CA 2024 QSS 1 dep → $44,710 (single+1)", caFilingThreshold("qualifying_widow", 1, 2024), 44710, 0.01);
  check("CA 2025 single 0 dep → $18,353", caFilingThreshold("single", 0, 2025), 18353, 0.01);
  // Percentage method binds: single $80k, 0 deps, 12 mo. 2.5%×(80,000−17,818)=$1,554.55.
  const pctCase = calculateStateIndividualMandatePenalty({
    state: "CA", filingStatus: "single", uninsuredAdults: 1, uninsuredChildren: 0,
    householdIncome: 80000, filingThreshold: caFilingThreshold("single", 0, 2024),
    monthsUninsured: 12, taxYear: 2024, householdSize: 1,
  });
  check("CA % method single $80k → 2.5%×62,182 = $1,554.55", pctCase.penalty, 1554.55, 0.02);
  ok("CA % method drives it (> flat $900, < bronze)", pctCase.method === "percentage");
  // Bronze cap counts ≤5: MFJ 2 adults + 6 kids (8 people), income $1M, 12 mo.
  //   pct 2.5%×(1,000,000−62,534)=$23,436.65; bronze $348×12×min(8,5)=5=$20,880 → BINDS.
  const bronzeCase = calculateStateIndividualMandatePenalty({
    state: "CA", filingStatus: "married_filing_jointly", uninsuredAdults: 2, uninsuredChildren: 6,
    householdIncome: 1000000, filingThreshold: caFilingThreshold("married_filing_jointly", 6, 2024),
    monthsUninsured: 12, taxYear: 2024, householdSize: 8,
  });
  check("CA bronze cap counts 5 not 8 → $348×12×5 = $20,880", bronzeCase.penalty, 20880.0, 0.02);
  ok("CA bronze cap is what binds (not uncapped 8-person)", bronzeCase.method === "bronze_cap");
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`);
for (const f of FAIL) console.log(f);
console.log(`\nAUDIT-2026-06-08: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
