/**
 * T2.1 — Form 1116 (Foreign Tax Credit) workpaper builder.
 *
 * Renders the engine's §901/§904 computation (`ret.foreignTaxCredit`,
 * `calculateForeignTaxCredit` in taxCalculator.ts) against the official
 * TY2024 Form 1116 Part III line layout:
 *   9   Foreign taxes paid or accrued (current year, from Part II line 8)
 *   10  Carryback/carryover (§904(c), Schedule B)
 *   14  Total foreign taxes available for credit (lines 12–13 reductions
 *       not modeled)
 *   17  Net foreign-source taxable income
 *   18  Taxable income (Form 1040 line 15)
 *   19  Foreign-source fraction (line 17 ÷ line 18)
 *   20  U.S. income tax before credits (regular + AMT)
 *   21  §904 limitation (line 19 × line 20; §960(c) line 22 not modeled,
 *       so line 23 = line 21)
 *   24  Credit (smaller of line 14 or line 21) → Schedule 3 line 1
 *
 * Engine semantics (verified vs source 2026-06-09):
 *   - ret.foreignTaxCredit.foreignTaxPaid is the COMBINED current-year
 *     `foreign_tax_paid` + prior `foreign_tax_credit_carryforward` adjustments
 *     (each floored at 0) — the §904 limit runs on the combined amount.
 *   - usedSimplifiedPath: the §904(j) election — total creditable foreign tax
 *     ≤ $300 single / $600 MFJ (all passive-category, 1099-reported): credit
 *     = taxes paid, NO Form 1116 limitation, and no carryover arises.
 *   - formLimitApplied + formLimit: over the election threshold WITH
 *     foreign-source taxable income supplied → limit = clamp01(foreign-source
 *     ÷ taxable income) × pre-credit tax; credit = min(paid, limit).
 *   - Over the threshold WITHOUT foreign-source income → the engine
 *     APPROXIMATES credit = taxes paid (formLimitApplied=false) — disclosed
 *     loudly below.
 *   - ret.foreignTaxCreditCarryforwardRemaining = max(0, combined − credit),
 *     §904(c) 10-year life, vintage not tracked.
 *
 * PURE — no Date/random/DB/pdfkit. Amounts engine-exact (cents).
 */

import {
  boolLine,
  checkLine,
  moneyLine,
  nz,
  pctLine,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

/** Mirrors the engine's Numish coercion for input-side adjustment sums. */
function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function buildForm1116(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const ftc = ret.foreignTaxCredit;

  // Applicable when any foreign tax is in play (current or carryover) or a
  // credit was computed.
  if (!(ftc.foreignTaxPaid > 0 || ftc.credit > 0)) return null;

  // Input-side split of the combined foreign tax — mirrors the engine's
  // sumByType + Math.max(0, ·) exactly. Degrades to combined-only when the
  // builder has no inputs.
  const sumByType = (type: string): number =>
    (inputs?.adjustments ?? [])
      .filter((a) => a.isApplied !== false && a.adjustmentType === type)
      .reduce((s, a) => s + toNum(a.amount), 0);
  const haveInputs = inputs != null;
  const currentYearPaid = Math.max(0, sumByType("foreign_tax_paid"));
  const carryoverIn = Math.max(0, sumByType("foreign_tax_credit_carryforward"));
  const foreignSourceIncome = Math.max(0, sumByType("foreign_source_taxable_income"));

  const lines: FormLine[] = [];

  // ── Part III lines 9–14 — foreign taxes available ──
  if (haveInputs) {
    lines.push(
      moneyLine("9", "Foreign taxes paid or accrued (current year — Part II, line 8 total)", currentYearPaid),
    );
    if (nz(carryoverIn)) {
      lines.push(
        moneyLine("10", "Carryover of unused foreign taxes from prior years (§904(c), Schedule B)", carryoverIn, {
          note: "1-year carryback / 10-year carryforward; vintage not tracked by the engine.",
        }),
      );
    }
  }
  lines.push(
    moneyLine("14", "Total foreign taxes available for credit", ftc.foreignTaxPaid, {
      emphasis: true,
      note: haveInputs
        ? "Lines 12–13 (foreign-tax reductions, high-tax kickout) not modeled."
        : "Current-year foreign tax + prior-year §904(c) carryover, combined (input detail unavailable to this workpaper).",
    }),
  );
  if (haveInputs) {
    lines.push(
      checkLine("Lines 9 + 10 tie to the line 14 total", currentYearPaid + carryoverIn, ftc.foreignTaxPaid),
    );
  }

  // ── §904(j) simplified-limitation election ──
  lines.push(
    boolLine("", `§904(j) election — credit claimed WITHOUT the Form 1116 limitation`, ftc.usedSimplifiedPath, {
      note: `Available when ALL foreign income is passive category (1099-reported) AND total creditable foreign taxes ≤ $${ftc.simplifiedLimit.toLocaleString("en-US")} (${ftc.simplifiedLimit === 600 ? "MFJ/QSS" : "single/HoH/MFS"}). No §904 limit applies and no carryover arises in an election year.`,
    }),
  );

  // ── Part III lines 17–21 — the §904 limitation ──
  if (ftc.formLimitApplied && ftc.formLimit != null) {
    // Reconstruct the engine's exact inputs to line 21: fraction = clamp01(
    // foreign-source ÷ taxable income); pre-credit tax = regular tax + AMT =
    // federalTaxLiability minus the bundled Schedule 2 other taxes.
    const preCreditTax =
      ret.federalTaxLiability -
      (ret.selfEmploymentTax +
        ret.niitTax +
        ret.additionalMedicareTax +
        ret.earlyWithdrawalPenalty +
        ret.hsaExcessExcise +
        ret.scheduleH.total +
        Math.max(0, -ret.premiumTaxCredit.netPtc));
    if (haveInputs && nz(foreignSourceIncome) && ret.taxableIncome > 0) {
      const fraction = Math.max(0, Math.min(1, foreignSourceIncome / ret.taxableIncome));
      lines.push(
        moneyLine("17", "Net foreign-source taxable income (CPA-supplied Form 1116 line 17 figure)", foreignSourceIncome, {
          note: "From the foreign_source_taxable_income adjustment — the §861–§865 sourcing/allocation of deductions (lines 1–7, 15–16) is the CPA's computation.",
        }),
        moneyLine("18", "Taxable income (Form 1040, line 15)", ret.taxableIncome),
        pctLine("19", "Foreign-source fraction (line 17 ÷ line 18, capped at 100%)", fraction),
        moneyLine("20", "U.S. income tax before credits (Form 1040 line 16 + AMT)", preCreditTax),
        moneyLine("21", "§904 limitation (line 20 × line 19)", ftc.formLimit, { emphasis: true }),
        checkLine("Line 21 ties: foreign-source fraction × pre-credit tax", fraction * preCreditTax, ftc.formLimit),
      );
    } else {
      lines.push(
        moneyLine("21", "§904 limitation (foreign-source fraction × pre-credit U.S. tax)", ftc.formLimit, {
          emphasis: true,
          note: "Line 17–20 detail unavailable to this workpaper — limit shown as computed by the engine.",
        }),
      );
    }
  } else if (ftc.exceededSimplifiedLimit && !ftc.formLimitApplied) {
    lines.push(
      textLine("17–21", "§904 limitation", null, {
        note: "⚠ NOT COMPUTED — foreign taxes exceed the §904(j) election threshold but no foreign-source taxable income was supplied; the engine approximated credit = taxes paid. Supply the foreign_source_taxable_income adjustment to apply the real Form 1116 limit.",
      }),
    );
  }

  // ── Lines 24/33 — the credit + carryforward ──
  const expectedCredit =
    ftc.formLimitApplied && ftc.formLimit != null
      ? Math.min(ftc.foreignTaxPaid, ftc.formLimit)
      : ftc.foreignTaxPaid;
  lines.push(
    moneyLine("24", "Foreign tax credit (smaller of line 14 or the §904 limitation) → Schedule 3, line 1", ftc.credit, {
      emphasis: true,
      note: "Single-category model — Part III line 24 equals the Part IV line 33 summary. Nonrefundable; applied FIRST in the engine's Schedule 3 credit order.",
    }),
    checkLine(
      ftc.formLimitApplied ? "Credit ties: min(line 14, line 21)" : "Credit ties: line 14 (no §904 limit binding)",
      expectedCredit,
      ftc.credit,
    ),
    moneyLine("", "Foreign tax credit carryforward to next year (§904(c))", ret.foreignTaxCreditCarryforwardRemaining, {
      emphasis: nz(ret.foreignTaxCreditCarryforwardRemaining),
      note: "Total foreign taxes (line 14) in excess of the §904 limit. 10-year carryforward life; vintage not tracked.",
    }),
    checkLine(
      "Carryforward ties: line 14 − credit",
      Math.max(0, ftc.foreignTaxPaid - ftc.credit),
      ret.foreignTaxCreditCarryforwardRemaining,
    ),
  );

  const footnotes = [
    "Single-category model: the §904(d) separate limitation baskets (passive / general / GILTI §951A / foreign branch / re-sourced treaty / lump-sum) are not modeled — all foreign-source income is treated as one category, so Part III is rendered once and Part IV collapses to the same value.",
    "Form 1116 lines 12–13 (reductions of foreign taxes, high-tax kickout) and line 22 (§960(c) increase in limitation) are not modeled.",
    "The §904(c) carryforward is keyed to the §904 LIMIT, not to credit-ordering room — in the rare case other nonrefundable credits absorb all tax first, the carryforward may understate (documented engine sub-gap). Vintage/expiry of the 10-year life is not tracked.",
    "Net foreign-source taxable income is the CPA-supplied Form 1116 line 17 figure (the foreign_source_taxable_income adjustment); the engine does not source income or apportion deductions (§861–§865).",
    "The AMT foreign tax credit (Form 1116-AMT, §59(a)) is not modeled — line 20 includes AMT in the pre-credit tax, matching the engine's regular-tax-side application.",
  ];
  if (ftc.exceededSimplifiedLimit && !ftc.formLimitApplied) {
    footnotes.unshift(
      "⚠ APPROXIMATION IN EFFECT: foreign taxes exceed the §904(j) simplified-election threshold but the §904 limit was NOT applied (no foreign-source taxable income supplied) — the credit equals taxes paid and may be OVERSTATED. CPA must compute the Form 1116 limitation.",
    );
  }

  return {
    formId: "1116",
    formNumber: "Form 1116",
    title: "Foreign Tax Credit",
    subtitle: "(Individual, Estate, or Trust) — §901 credit under the §904 limitation, with the §904(j) simplified election",
    taxYear: ret.taxYear,
    parts: [{ title: "Part III — Figuring the Credit (single category; Part IV summary collapses to line 24)", lines }],
    footnotes,
  };
}
