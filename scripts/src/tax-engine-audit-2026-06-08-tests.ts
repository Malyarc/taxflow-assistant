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
import { calculateStateTax, saversCreditRateFor, getDependentStandardDeductionBase, calculateAmt } from "../../artifacts/api-server/src/lib/taxCalculator";
import { validateW2 } from "@workspace/validation";

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

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`);
for (const f of FAIL) console.log(f);
console.log(`\nAUDIT-2026-06-08: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
