/**
 * T2.1 — Form 8880 substitute workpaper: Credit for Qualified Retirement
 * Savings Contributions (Saver's Credit, IRC §25B). Line numbers follow the
 * official TY2024 Form 8880 (lines 1–12).
 *
 * Every value traces to the engine's SaversCreditCalculation
 * (`ret.saversCredit`):
 *   line 3  = retirementContributions (engine sources: the
 *             `ira_contribution_traditional` + `ira_contribution_roth` +
 *             `retirement_contributions_savers` adjustments)
 *   line 7  = eligibleContribution ($2,000 cap — $4,000 combined MFJ)
 *   line 8  = AGI
 *   line 9  = rate (50%/20%/10% from the engine's year-indexed §25B AGI tiers;
 *             QSS uses the single column per Form 8880)
 *   line 10 = appliedCredit = line 7 × line 9
 *   line 11 = Credit Limit Worksheet (reconstructed — remaining income tax
 *             after the FTC, dependent care, and education credits, matching
 *             the engine's Schedule-3 ordering)
 *   line 12 = min(line 10, line 11) → Schedule 3 line 4
 *
 * CPA review workpaper (Pub 1167 substitute conventions) — NOT a filed form.
 */

import type { ComputedTaxReturn, TaxReturnInputs } from "../taxReturnEngine";
import {
  checkLine,
  moneyLine,
  nz,
  pctLine,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Regular income tax + AMT — exact inversion of the engine's liability assembly. */
function incomeTaxOnly(ret: ComputedTaxReturn): number {
  return (
    ret.federalTaxLiability -
    ret.selfEmploymentTax -
    ret.niitTax -
    ret.additionalMedicareTax -
    ret.earlyWithdrawalPenalty -
    ret.hsaExcessExcise -
    ret.scheduleH.total -
    Math.max(0, -ret.premiumTaxCredit.netPtc)
  );
}

function sumAdj(inputs: TaxReturnInputs | undefined, type: string): number {
  let s = 0;
  for (const a of inputs?.adjustments ?? []) {
    if (a.adjustmentType === type && a.isApplied !== false) s += toNum(a.amount);
  }
  return s;
}

export function buildForm8880(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const sc = ret.saversCredit;

  if (!(sc.appliedCredit > 0)) return null;

  const lines: FormLine[] = [];

  // Lines 1–2 breakdown — only when derivable from inputs AND the pieces
  // reconcile to the engine total (defensive: never show a breakdown that
  // contradicts the engine).
  const iraPiece =
    sumAdj(inputs, "ira_contribution_traditional") + sumAdj(inputs, "ira_contribution_roth");
  const deferralPiece = sumAdj(inputs, "retirement_contributions_savers");
  if (inputs && Math.abs(iraPiece + deferralPiece - sc.retirementContributions) < 0.005) {
    if (nz(iraPiece)) {
      lines.push(moneyLine("1", "Traditional and Roth IRA contributions", iraPiece, { indent: 1 }));
    }
    if (nz(deferralPiece)) {
      lines.push(
        moneyLine("2", "Elective deferrals and other qualifying contributions", deferralPiece, { indent: 1 }),
      );
    }
  }

  lines.push(
    moneyLine("3", "Total qualifying retirement contributions (add lines 1 and 2)", sc.retirementContributions, {
      note: "Engine sources: ira_contribution_traditional + ira_contribution_roth + retirement_contributions_savers adjustments.",
    }),
    textLine("4", "Distributions received during the testing period", null, {
      note: "(not modeled — CPA supplies; testing-period distributions per §25B(d)(2) reduce line 3)",
    }),
    moneyLine("7", "Eligible contribution after the per-filer cap", sc.eligibleContribution, {
      note: "$2,000 cap per person (Form 8880 line 6 columns); the engine caps the COMBINED amount at $4,000 for MFJ — see footnote.",
    }),
    moneyLine("8", "Adjusted gross income (Form 1040 line 11)", sc.agi),
    pctLine("9", "Applicable decimal (50% / 20% / 10% by AGI tier)", sc.rate, {
      note: "From the engine's year-indexed §25B AGI bands (Rev. Proc. tables). QSS uses the single column per Form 8880.",
    }),
    moneyLine("10", "Tentative credit (line 7 × line 9)", sc.appliedCredit, { emphasis: true }),
    checkLine("Line 10 ties: line 7 × line 9", sc.eligibleContribution * sc.rate, sc.appliedCredit),
  );

  // Line 11 — Credit Limit Worksheet reconstruction (the engine applies the
  // Saver's credit after FTC, dependent care, and education credits).
  const ec = ret.educationCredits;
  const line11 = Math.max(
    0,
    incomeTaxOnly(ret) -
      ret.foreignTaxCredit.credit -
      ret.dependentCareCredit.appliedCredit -
      ec.aocNonRefundable -
      ec.llcApplied,
  );
  const line12 = Math.min(sc.appliedCredit, line11);
  lines.push(
    moneyLine("11", "Credit Limit Worksheet — income tax remaining before this credit", line11, {
      note: "Income tax (regular + AMT) less the foreign tax, dependent care, and education credits, per the engine's Schedule-3 ordering.",
    }),
    moneyLine("12", "Credit for qualified retirement savings contributions — smaller of line 10 or line 11 (Schedule 3 line 4)", line12, {
      emphasis: true,
      note: line12 < sc.appliedCredit - 0.005
        ? "⚠ The tax-liability limit binds — the excess is lost (nonrefundable, no carryforward)."
        : undefined,
    }),
  );

  return {
    formId: "8880",
    formNumber: "Form 8880",
    title: "Credit for Qualified Retirement Savings Contributions",
    subtitle: "Saver's Credit (IRC §25B) — substitute workpaper (TY2024 line layout)",
    taxYear: ret.taxYear,
    parts: [{ lines }],
    footnotes: [
      "NONREFUNDABLE: the credit offsets income tax only (line 12 caps at the Credit Limit Worksheet amount) and does not carry forward.",
      "Per-spouse columns are NOT modeled — the official form caps EACH spouse's line 6 at $2,000, while the engine caps the combined contributions at $4,000 MFJ. When one spouse contributed more than $2,000 and the other less, the engine can overstate line 7 — CPA verifies the per-column split.",
      "Line 4 testing-period distributions (current year + 2 prior years + through the return due date, §25B(d)(2)) are not modeled — they reduce eligible contributions.",
      "Eligibility gates the engine does not check: full-time students, dependents claimed on another return, and filers under 18 are INELIGIBLE (§25B(c)) — CPA verifies.",
      "Workpaper amounts are engine-exact (cents); the official form rounds to whole dollars.",
    ],
  };
}
