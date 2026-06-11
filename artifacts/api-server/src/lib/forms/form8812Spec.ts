/**
 * T2.1 — Schedule 8812 (Form 1040) substitute workpaper: Credits for
 * Qualifying Children and Other Dependents. Line numbers follow the official
 * TY2024 Schedule 8812 layout (Part I-A lines 1–14, Part II-A lines 16a–27).
 *
 * Every value traces to the engine's CtcCalculation (`ret.childTaxCredit`)
 * or to a documented reconstruction of the engine's own credit pipeline:
 *
 *   - Line 13 (Credit Limit Worksheet) = income tax (regular + AMT) minus the
 *     Schedule-3 personal credits actually applied BEFORE the CTC. The engine
 *     applies the CTC AFTER the Schedule-3 credits (FTC → dependent care →
 *     education → Saver's → energy → adoption) per the Schedule 8812 Credit
 *     Limit Worksheet (the C1 fix, audit 2026-06-08), so line 13 here is the
 *     EXACT residual the engine handed the CTC:
 *       incomeTaxOnly − (totalNonRefundableApplied − ctcNonRef − §53 − §41 − §38-other)
 *   - Line 14 must equal min(line 12, line 13) — surfaced as a ✓/⚠ tie row.
 *
 * Renders as a CPA review workpaper (Pub 1167 substitute conventions) — NOT a
 * filed form.
 */

import type { ComputedTaxReturn } from "../taxReturnEngine";
import {
  checkLine,
  countLine,
  moneyLine,
  nz,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

/**
 * Refundable ACTC per-child cap (§24(d)(1)(A), inflation-indexed). Mirrors the
 * engine's ACTC_REFUNDABLE_PER_CHILD table (taxCalculator.ts) — $1,700 for
 * TY2024–TY2026 (Rev. Proc. 2023-34 / 2024-40 / 2025-32). Unknown years fall
 * back to a disclosure note rather than a guessed number.
 */
const ACTC_PER_CHILD_CAP: Record<number, number> = { 2024: 1700, 2025: 1700, 2026: 1700 };

/** Form 1040 line 18 — the base non-refundable credits offset: regular income
 *  tax + AMT + the Schedule 2 line 2 excess-APTC repayment (FC-09: the
 *  repayment is chapter-1 tax per §36B(f)(2)(A) and every credit-limit
 *  worksheet starts from line 18). Exact inversion of the engine's
 *  federalTaxLiability assembly (the repayment STAYS in the base). */
function incomeTaxOnly(ret: ComputedTaxReturn): number {
  return (
    ret.federalTaxLiability -
    ret.selfEmploymentTax -
    ret.niitTax -
    ret.additionalMedicareTax -
    ret.earlyWithdrawalPenalty -
    ret.hsaExcessExcise -
    ret.scheduleH.total
  );
}

export function buildForm8812(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const ctc = ret.childTaxCredit;

  // Applicable when any CTC/ODC credit was delivered OR qualifying children
  // exist (so a fully-phased-out family still sees WHY the credit is $0).
  if (!(ctc.appliedCredit > 0 || ctc.refundableActc > 0 || ctc.qualifyingChildren > 0)) {
    return null;
  }

  const perChildCredit =
    ctc.qualifyingChildren > 0
      ? (ctc.preliminaryCredit - 500 * ctc.otherDependents) / ctc.qualifyingChildren
      : 0;
  const line5 = ctc.qualifyingChildren * perChildCredit;
  const line7 = ctc.otherDependents * 500;
  const line12 = Math.max(0, ctc.preliminaryCredit - ctc.phaseOutReduction);

  // Line 13 — EXACT pre-CTC residual tax, from the engine's own applied totals.
  // FC-11: the §25D residential clean energy credit applies AFTER the CTC
  // (it is NOT in the Credit Limit Worksheet's line-2 list), so it is backed
  // out of the "before CTC" set along with the §53/§38 credits.
  const schedule3AppliedBeforeCtc =
    ret.totalNonRefundableApplied -
    ctc.nonRefundablePortion -
    ret.residentialCleanEnergyApplied -
    ret.amtCreditApplied -
    ret.rdCreditApplied -
    ret.otherGeneralBusinessCreditApplied;
  const line13 = Math.max(0, incomeTaxOnly(ret) - schedule3AppliedBeforeCtc);

  // ── Part I-A — Child tax credit & credit for other dependents ──
  const ctcMagi = ret.adjustedGrossIncome + ret.feie.totalExclusion;
  const partI: FormLine[] = [
    moneyLine("1", "Adjusted gross income (Form 1040 line 11)", ret.adjustedGrossIncome),
    moneyLine("3", "Modified adjusted gross income (line 1 + §911 foreign earned income exclusion, lines 2a–2d)", ctcMagi, {
      note: "FC-14 — §24(b)(1) MAGI adds back the §911 FEIE (the §931/§933 possessions exclusions have no engine input).",
    }),
    countLine("4", "Number of qualifying children under age 17 with the required SSN", ctc.qualifyingChildren),
    moneyLine("5", `Line 4 × $${perChildCredit.toLocaleString("en-US")} per child`, line5, {
      note: "Per-child credit derived from the engine's preliminary-credit composition: $2,000 TY2024; $2,200 TY2025+ (OBBBA §70104, §24(h)).",
    }),
  ];
  if (ctc.otherDependents > 0) {
    partI.push(
      countLine("6", "Number of other dependents (credit for other dependents)", ctc.otherDependents),
      moneyLine("7", "Line 6 × $500", line7),
    );
  }
  partI.push(
    moneyLine("8", "Add lines 5 and 7 (preliminary credit)", ctc.preliminaryCredit, { emphasis: true }),
    moneyLine("9", "Phase-out threshold ($400,000 MFJ; $200,000 all others)", ctc.phaseOutThreshold),
  );
  if (nz(ctc.phaseOutReduction)) {
    partI.push(
      moneyLine("10", "MAGI over threshold, rounded UP to the nearest $1,000", (ctc.phaseOutReduction / 50) * 1000),
      moneyLine("11", "Phase-out reduction — line 10 × 5% ($50 per $1,000 or fraction over)", ctc.phaseOutReduction),
    );
  }
  partI.push(
    moneyLine("12", "Credit after phase-out (line 8 − line 11; not less than $0)", line12, { emphasis: true }),
    moneyLine("13", "Credit Limit Worksheet — income tax remaining after Schedule-3 credits", line13, {
      note: "Engine ordering (Sch 8812 Credit Limit Worksheet): FTC, dependent care, education, Saver's, energy, and adoption credits claim the income tax FIRST; the CTC fills this residual.",
    }),
    moneyLine("14", "Child tax credit + ODC — smaller of line 12 or line 13 (Form 1040 line 19)", ctc.nonRefundablePortion, {
      emphasis: true,
    }),
    checkLine("Line 14 ties: min(line 12, line 13) = engine non-refundable CTC", Math.min(line12, line13), ctc.nonRefundablePortion),
  );

  // ── Part II-A — Additional child tax credit (refundable) ──
  const line16a = Math.max(0, line12 - ctc.nonRefundablePortion);
  const perChildCap = ACTC_PER_CHILD_CAP[ret.taxYear];
  const partII: FormLine[] = [];
  if (line16a > 0 || ctc.refundableActc > 0) {
    partII.push(moneyLine("16a", "Line 12 minus line 14 (credit not allowed against tax)", line16a));
    if (perChildCap != null) {
      const line16b = ctc.qualifyingChildren * perChildCap;
      partII.push(
        moneyLine("16b", `Number of qualifying children × $${perChildCap.toLocaleString("en-US")} (ACTC per-child cap)`, line16b, {
          note: "§24(d)(1)(A) refundable cap — $1,700/child TY2024–TY2026 (Rev. Proc. 2023-34 / 2024-40 / 2025-32).",
        }),
        moneyLine("17", "Smaller of line 16a or line 16b", Math.min(line16a, line16b)),
      );
    } else {
      partII.push(
        textLine("16b", "ACTC per-child cap", null, {
          note: "(per-child cap for this tax year not mirrored in the workpaper — see engine ACTC_REFUNDABLE_PER_CHILD)",
        }),
      );
    }
    partII.push(
      textLine("18a–26", "Earned-income limit (15% of earned income over $2,500) and the 3-or-more-children Social Security tax alternative", null, {
        note: "Applied inside the engine: ACTC = min(line 17, larger of [15% × (earned income − $2,500)] and — with 3+ qualifying children (Part II-B, FC-13) — [SS/Medicare/Additional-Medicare taxes + ½ SE tax − EIC]). Earned income = W-2 wages + net SE earnings − ½ SE tax (engine-internal).",
      }),
    );
  }
  partII.push(
    moneyLine("27", "Additional child tax credit (Form 1040 line 28)", ctc.refundableActc, { emphasis: true }),
    checkLine("Line 27 ties engine additionalChildTaxCredit", ctc.refundableActc, ret.additionalChildTaxCredit),
  );
  if (ctc.refundableActc === 0 && line16a === 0 && line12 > 0) {
    partII.push(
      textLine("", "Line 12 was fully delivered as the non-refundable credit — no ACTC", "—", { indent: 1 }),
    );
  }

  // Unnumbered summary tie: total CTC delivered (both components).
  const summary: FormLine[] = [
    moneyLine("", "Total credit delivered (line 14 non-refundable + line 27 refundable)", ctc.appliedCredit, {
      emphasis: true,
    }),
    checkLine(
      "Delivered total ties: line 14 + line 27",
      ctc.nonRefundablePortion + ctc.refundableActc,
      ctc.appliedCredit,
    ),
  ];

  const footnotes = [
    "CRITICAL ordering note: the engine applies the CTC AFTER the Schedule-3 personal credits in the Credit Limit Worksheet's line-2 list (foreign tax → dependent care → education → Saver's → §25C energy/§30C → adoption) per the IRS Schedule 8812 Credit Limit Worksheet; the §25D residential clean energy credit is NOT in that list and applies AFTER the CTC (FC-11). Line 13 and the non-refundable portion on line 14 therefore reflect the tax REMAINING after the pre-CTC credits; the unused non-refundable balance spills to the refundable ACTC.",
    "Engine MAGI (line 3) = AGI + the §911 FEIE exclusion (FC-14); the §931/§933 possessions exclusions have no engine input.",
    "Qualifying-child SSN status (line 4) and the under-17/residency/support tests are CPA-verified facts; the engine counts the client's dependentsUnder17 field as-is.",
    "Part II-B (3 or more qualifying children): the engine uses the larger of the 15% earned-income amount or (employee SS/Medicare + Additional Medicare + ½ SE tax − EIC) per lines 21–26 (FC-13). Employee FICA is modeled from W-2 boxes 3/5 (6.2% capped at the wage base + 1.45%), not boxes 4/6 withholding; Schedule 2 lines 5/6/13 unreported-FICA amounts are not modeled.",
    "Workpaper amounts are engine-exact (cents); the official form rounds to whole dollars.",
  ];

  return {
    formId: "8812",
    formNumber: "Schedule 8812 (Form 1040)",
    title: "Credits for Qualifying Children and Other Dependents",
    subtitle: "Child tax credit, credit for other dependents, and additional child tax credit — substitute workpaper (TY2024 line layout)",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I-A — Child Tax Credit and Credit for Other Dependents (lines 1–14)", lines: partI },
      { title: "Part II-A — Additional Child Tax Credit (lines 16a–27)", lines: partII },
      { title: "Workpaper summary", lines: summary },
    ],
    footnotes,
  };
}
