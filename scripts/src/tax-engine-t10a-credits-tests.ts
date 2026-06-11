/**
 * T1.0(a) — federal credits & TY2026 law-currency regressions (2026-06-11).
 *
 * Pins the group-(a) audit fixes. Every expected value below is HAND-DERIVED
 * by the orchestrator from the cited primary source (Rev. Proc. 2025-25 for
 * the TY2026 PTC schedule; OBBBA §§70505-06 energy terminations + the
 * §36B(f)(2)(B) repayment-cap repeal; Schedule 8812 + its Credit Limit
 * Worksheet for the §25D-after-CTC ordering and the Part II-B ACTC
 * alternative; §32(a)(2)/Pub 596 for the EITC formula and gates; §24(b) for
 * the FEIE MAGI add-back; §25B(c)(2) for the saver's dependent bar).
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  calculatePremiumTaxCredit,
  calculateResidentialEnergyCredits,
  calculateChildTaxCredit,
} from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.05) {
  if (Math.abs(actual - expected) <= tol) PASS.push(label);
  else FAIL.push(`FAIL ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkTrue(label: string, cond: boolean) {
  if (cond) PASS.push(label);
  else FAIL.push(`FAIL ${label}`);
}
function header(t: string) { console.log(`\n── ${t} ──`); }

function run(
  filingStatus: string,
  extraClient: Partial<TaxReturnInputs["client"]>,
  wages: number,
  adjustments: TaxReturnInputs["adjustments"] = [],
  taxYear = 2024,
) {
  return computeTaxReturnPure({
    client: { filingStatus, state: "FL", taxYear, ...extraClient },
    w2s: wages > 0 ? [{ taxYear, wagesBox1: wages, federalTaxWithheldBox2: 0, stateCode: "FL" }] : [],
    form1099s: [],
    adjustments,
    taxYear,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// FC-01/FC-22 — TY2026 PTC: the pre-ARPA schedule is back (Rev. Proc. 2025-25)
//   with the 400%-FPL cliff; OBBBA repealed the repayment caps for 2026+.
//   TY2026 PTC uses the 2025 HHS FPL: $15,650 (household of 1).
// ════════════════════════════════════════════════════════════════════════════
header("FC-01 — TY2026 PTC cliff + pre-ARPA schedule");
{
  // 450% FPL: MAGI = 4.5 × 15,650 = $70,425 → INELIGIBLE (cliff) and the
  // $5,000 APTC is repaid in FULL (caps repealed for 2026+).
  const cliff = calculatePremiumTaxCredit({
    annualPremium: 8000, annualSlcsp: 7500, advanceAptc: 5000,
    modifiedAgi: 70425, householdSize: 1, filingStatus: "single", taxYear: 2026,
  });
  check("TY2026 450% FPL → computedPtc $0 (cliff)", cliff.computedPtc, 0);
  check("TY2026 450% FPL → netPtc −$5,000 (uncapped repayment, OBBBA)", cliff.netPtc, -5000);

  // 350% FPL: MAGI = 54,775 → 9.96% flat band. Contribution = 54,775 × 0.0996
  // = $5,455.59 → PTC = 7,500 − 5,455.59 = $2,044.41.
  const mid = calculatePremiumTaxCredit({
    annualPremium: 8000, annualSlcsp: 7500, advanceAptc: 0,
    modifiedAgi: 54775, householdSize: 1, filingStatus: "single", taxYear: 2026,
  });
  check("TY2026 350% FPL applicable figure 9.96%", mid.applicableFigure, 0.0996, 0.0001);
  check("TY2026 350% FPL PTC $2,044.41", mid.netPtc, 2044.41);

  // 133% boundary: MAGI = 1.33 × 15,650 = 20,814.50 → 3.14% exactly.
  // Contribution = 20,814.50 × 0.0314 = $653.58 → PTC = 7,500 − 653.58.
  const low = calculatePremiumTaxCredit({
    annualPremium: 8000, annualSlcsp: 7500, advanceAptc: 0,
    modifiedAgi: 20814.5, householdSize: 1, filingStatus: "single", taxYear: 2026,
  });
  check("TY2026 133% FPL figure 3.14% (Rev. Proc. 2025-25)", low.applicableFigure, 0.0314, 0.0001);
  check("TY2026 133% FPL PTC $6,846.42", low.netPtc, 6846.42);

  // TY2025 ARPA control at 450% FPL (15,060 × 4.5 = 67,770): NO cliff —
  // contribution = 67,770 × 8.5% = $5,760.45 → PTC = 7,500 − 5,760.45.
  const arpa = calculatePremiumTaxCredit({
    annualPremium: 8000, annualSlcsp: 7500, advanceAptc: 0,
    modifiedAgi: 67770, householdSize: 1, filingStatus: "single", taxYear: 2025,
  });
  check("TY2025 450% FPL ARPA control: PTC $1,739.55 (no cliff)", arpa.netPtc, 1739.55);

  // FC-22 — below 100% FPL: no NEW PTC (§36B(c)(1)(A)); TY2024 repayment of
  // APTC is CAPPED at the <200% single tier $375 (Rev. Proc. 2023-34); the
  // TY2026 repeal makes the same case fully repayable.
  const under2024 = calculatePremiumTaxCredit({
    annualPremium: 6000, annualSlcsp: 5500, advanceAptc: 3000,
    modifiedAgi: 13122, householdSize: 1, filingStatus: "single", taxYear: 2024,
  });
  check("TY2024 90% FPL: no new PTC", under2024.computedPtc, 0);
  check("TY2024 90% FPL: repayment capped −$375", under2024.netPtc, -375);
  const under2026 = calculatePremiumTaxCredit({
    annualPremium: 6000, annualSlcsp: 5500, advanceAptc: 3000,
    modifiedAgi: 14085, householdSize: 1, filingStatus: "single", taxYear: 2026,
  });
  check("TY2026 90% FPL: repayment uncapped −$3,000", under2026.netPtc, -3000);
}

// ════════════════════════════════════════════════════════════════════════════
// FC-02 — OBBBA §§70505-06 terminated §25D + §25C (+§30C handled with them)
//   for property placed in service after 2025-12-31 → TY2026 credits are $0.
// ════════════════════════════════════════════════════════════════════════════
header("FC-02 — §25C/§25D TY2026 termination");
{
  const y26 = calculateResidentialEnergyCredits({
    cleanEnergySpend: 20000, efficientHomeSpend: 5000, heatPumpSpend: 9000,
    evChargerSpend: 4000, taxYear: 2026,
  });
  check("TY2026 §25D solar $0 (terminated)", y26.cleanEnergyCredit, 0);
  // §30C survives into 2026: OBBBA terminates it for property placed in
  // service after 2026-06-30 (NOT 12/31/2025) — the EV charger keeps $1,000.
  check("TY2026 total $1,000 (§30C only — terminates 6/30/2026)", y26.total, 1000);
  const y25 = calculateResidentialEnergyCredits({
    cleanEnergySpend: 20000, efficientHomeSpend: 5000, heatPumpSpend: 9000,
    evChargerSpend: 4000, taxYear: 2025,
  });
  // 2025 control: 30%×20k=6,000; min(1,500, $1,200 cap)=1,200; min(2,700,
  // $2,000)=2,000; min(1,200, $1,000)=1,000.
  check("TY2025 control §25D $6,000", y25.cleanEnergyCredit, 6000);
  check("TY2025 control total $10,200", y25.total, 10200);
}

// ════════════════════════════════════════════════════════════════════════════
// FC-11 — §25D applies AFTER the CTC (the Sch 8812 CLW subtracts §25C but NOT
//   §25D) and the unused §25D carries forward (§25D(c)).
//   Single FL 2024, wages $30,000, 1 child, $20,000 solar (§25D $6,000):
//   taxable 15,400 → tax $1,616 → CTC nonref = $1,616 (CTC first), §25D
//   applied $0, carryforward $6,000; ACTC = min(2,000−1,616, 1,700,
//   15%×27,500) = $384 → refund $384.
// ════════════════════════════════════════════════════════════════════════════
header("FC-11 — §25D post-CTC ordering + §25D(c) carryforward");
{
  const withChild = run("single", { dependentsUnder17: 1 }, 30000,
    [{ adjustmentType: "residential_clean_energy", amount: 20000 }]);
  check("CTC absorbs the tax first ($1,616 nonref)", withChild.childTaxCredit.nonRefundablePortion, 1616);
  check("§25D carryforward $6,000 (nothing absorbed)", withChild.residentialCleanEnergyCarryforward ?? NaN, 6000);
  check("ACTC spill $384", withChild.childTaxCredit.refundableActc, 384);
  // Refund = ACTC $384 + EITC (single 1 child, earned/AGI $30,000: table
  // method min(4,213 ceiling, 4,213 − 0.1598×(30,000−22,720) = 3,049.66)
  // = $3,049.66) → total $3,433.66.
  check("refund $3,433.66 (ACTC $384 + EITC $3,049.66)", withChild.federalRefundOrOwed, 3433.66);
  // Control — no child: §25D absorbs the $1,616; carryforward $4,384.
  const noChild = run("single", {}, 30000,
    [{ adjustmentType: "residential_clean_energy", amount: 20000 }]);
  check("no-child control: §25D carryforward $4,384", noChild.residentialCleanEnergyCarryforward ?? NaN, 4384);
}

// ════════════════════════════════════════════════════════════════════════════
// FC-03 — EITC §32(a)(2): the phase-out reduces the MAX-capped phase-in
//   amount, measured on max(AGI, earned). Single 1 child 2024: earned
//   $12,000, AGI $25,000 (the extra $13k is non-investment other income):
//   min(34%×12,000, 4,213) − 15.98%×(25,000−22,720) = 4,080 − 364.34
//   = $3,715.66.  (Pre-fix the subtraction hit the phase-in amount wrong.)
// ════════════════════════════════════════════════════════════════════════════
header("FC-03 — EITC §32(a)(2) formula");
{
  const r = run("single", { dependentsUnder17: 1, eitcQualifyingChildren: 1, taxpayerAge: 30 }, 12000,
    [{ adjustmentType: "additional_income", amount: 13000 }]);
  check("EITC = $3,848.66 (§32(a)(2) ceiling / EIC-table method: min(4,080, 4,213 − 364.34))", r.eitc.appliedCredit, 3848.66);
}

// ════════════════════════════════════════════════════════════════════════════
// FC-12 — EITC gates: the §32(c)(1)(C) Form-2555 bar; the §32(c)(1)(A)(ii)(II)
//   25–64 age window for childless claimants (null age preserves behavior).
// ════════════════════════════════════════════════════════════════════════════
header("FC-12 — EITC FEIE bar + childless age window");
{
  const feie = run("single", { dependentsUnder17: 1, eitcQualifyingChildren: 1, taxpayerAge: 30 }, 20000,
    [{ adjustmentType: "foreign_earned_income", amount: 5000 }]);
  check("FEIE claimed → EITC $0 (§32(c)(1)(C))", feie.eitc.appliedCredit, 0);
  // 2024 childless: rate 7.65%, max $632, single phase-out from $10,330 —
  // $10,000 earned → $632.
  check("childless age 30 → $632", run("single", { taxpayerAge: 30 }, 10000).eitc.appliedCredit, 632);
  check("childless age 22 → $0 (under 25)", run("single", { taxpayerAge: 22 }, 10000).eitc.appliedCredit, 0);
  check("childless age 70 → $0 (over 64)", run("single", { taxpayerAge: 70 }, 10000).eitc.appliedCredit, 0);
  check("childless age UNKNOWN → $632 (pre-gate behavior preserved)", run("single", {}, 10000).eitc.appliedCredit, 632);
}

// ════════════════════════════════════════════════════════════════════════════
// FC-14 — §24(b) CTC MAGI adds back the FEIE. MFJ 2 kids, wages $450,000 with
//   $126,500 FEIE → AGI $323,500 but MAGI $450,000 → phase-out reduction
//   ceil(50,000/1,000) × $50 = $2,500 → CTC $4,000 − $2,500 = $1,500.
// ════════════════════════════════════════════════════════════════════════════
header("FC-14 — CTC FEIE MAGI add-back");
{
  // foreign_earned_income DECLARES the foreign income then excludes the
  // capped amount — wages carry only the US portion ($323,500).
  const r = run("married_filing_jointly", { dependentsUnder17: 2 }, 323500,
    [{ adjustmentType: "foreign_earned_income", amount: 126500 }]);
  check("AGI excludes the FEIE ($323,500)", r.adjustedGrossIncome, 323500, 1);
  check("CTC phased on MAGI $450k → $1,500 (was $4,000)", r.childTaxCredit.appliedCredit, 1500);
}

// ════════════════════════════════════════════════════════════════════════════
// FC-15 — §25B(c)(2): a taxpayer claimed as a dependent cannot take the
//   saver's credit. Single AGI $20,000 + $2,000 contributions (50% tier).
// ════════════════════════════════════════════════════════════════════════════
header("FC-15 — saver's credit dependent bar");
{
  const dep = run("single", { claimedAsDependent: true }, 20000,
    [{ adjustmentType: "retirement_contributions_savers", amount: 2000 }]);
  check("claimed-as-dependent → saver's $0", dep.saversCredit.appliedCredit, 0);
  const indep = run("single", {}, 20000,
    [{ adjustmentType: "retirement_contributions_savers", amount: 2000 }]);
  check("control → saver's $1,000 (50% tier)", indep.saversCredit.appliedCredit, 1000);
}

// ════════════════════════════════════════════════════════════════════════════
// FC-13 — Schedule 8812 Part II-B (3+ qualifying children): the refundable
//   ACTC is the GREATER of the 15% formula and (SS/Medicare taxes − EITC),
//   still capped at $1,700/child and the unused CTC. Unit-level:
//   3 kids, earned $20,000 → 15% formula = 0.15 × 17,500 = $2,625;
//   II-B alternative = 9,000 − 1,000 = $8,000 → ACTC = min(6,000 unused,
//   3 × 1,700 = 5,100, 8,000) = $5,100. Without the SS input: $2,625.
// ════════════════════════════════════════════════════════════════════════════
header("FC-13 — ACTC Part II-B (3+ children SS-tax alternative)");
{
  const withSs = calculateChildTaxCredit({
    qualifyingChildren: 3, otherDependents: 0, agi: 30000,
    filingStatus: "married_filing_jointly", taxYear: 2024, taxBeforeCredit: 0,
    earnedIncome: 20000, socialSecurityMedicareTaxesPaid: 9000, eitcApplied: 1000,
  });
  check("Part II-B binds → ACTC $5,100 (3-child cap)", withSs.refundableActc, 5100);
  const without = calculateChildTaxCredit({
    qualifyingChildren: 3, otherDependents: 0, agi: 30000,
    filingStatus: "married_filing_jointly", taxYear: 2024, taxBeforeCredit: 0,
    earnedIncome: 20000,
  });
  check("15%-formula only → ACTC $2,625", without.refundableActc, 2625);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(70)}`);
for (const f of FAIL) console.log(f);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
