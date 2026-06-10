/**
 * T2.1 — Form 8839 (Qualified Adoption Expenses) workpaper builder.
 *
 * Renders the engine's §23 adoption credit (`ret.adoptionCredit`,
 * `calculateAdoptionCredit` in taxCalculator.ts) against the official TY2024
 * Form 8839 Part II layout (the stable reference; the 2025 revision adds
 * OBBBA refundable-split lines, rendered here as labeled extra rows):
 *   2  Maximum adoption credit per child ($16,810 TY2024 / $17,280 TY2025 /
 *      $17,670 TY2026 — Rev. Proc. 2023-34 / 2024-40 / 2025-32)
 *   5  Qualified adoption expenses
 *   6  Eligible expenses (smaller of the cap or line 5; §23(a)(3) special-needs
 *      adoptions are DEEMED to have full-limit expenses)
 *   7  Modified AGI (engine: AGI + FEIE add-back per §23(b)(2)(B))
 *   8–10  MAGI phase-out (ratable over the $40,000 band above the start)
 *   11/12 Current-year credit after phase-out
 *   13 Carryforward from prior years (§23(c))
 *   14 Total nonrefundable credit available
 *   16 Nonrefundable credit applied (tax-liability limited) → Schedule 3 line 6c
 *
 * Engine semantics (verified vs source 2026-06-09):
 *   - MFS: NO current-year credit (the §23 lived-apart exception is not
 *     modeled); a prior carryforward rolls forward untouched.
 *   - OBBBA (P.L. 119-21 §70402): up to $5,000 (TY2025; $5,120 TY2026) of the
 *     CURRENT-year credit is refundable; carryforwards stay nonrefundable.
 *   - carryforwardToNext = nonRefundableTentative − nonRefundableApplied,
 *     copied to ret.adoptionCreditCarryforwardRemaining (tie-out below).
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

export function buildForm8839(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const ac = ret.adoptionCredit;

  // Applicable when a current-year credit exists OR a prior carryforward is in play.
  if (!(ac.tentativeCredit > 0 || ac.priorCarryforward > 0)) return null;

  const isMfs = ret.filingStatus === "married_filing_separately";
  const lines: FormLine[] = [];

  if (ac.eligible) {
    // ── Part I info the engine carries (single-adoption model) ──
    lines.push(
      boolLine("1", "Special-needs adoption (Part I, line 1 special-needs column)", ac.specialNeeds, {
        note: "§23(a)(3): a finalized special-needs adoption is DEEMED to have qualified expenses equal to the full per-child dollar limit, regardless of amounts actually paid.",
      }),
      // ── Part II — Adoption Credit ──
      moneyLine("2", "Maximum adoption credit per child", ac.maxCreditPerChild, {
        note: "Year-indexed: $16,810 TY2024 / $17,280 TY2025 / $17,670 TY2026 (Rev. Proc. 2023-34 / 2024-40 / 2025-32).",
      }),
      moneyLine("5", "Qualified adoption expenses", ac.qualifiedExpenses, {
        note: "CPA nets out prior-year claims for the same child (Form 8839 lines 3–4 not modeled).",
      }),
      moneyLine("6", "Eligible expenses (smaller of line 2 or line 5; special-needs deemed at the full limit)", ac.eligibleExpenses),
      moneyLine("7", "Modified AGI (AGI + foreign earned income exclusion add-back, §23(b)(2)(B))", ac.magi),
    );

    // MAGI phase-out (lines 8–10) — ratable over the $40,000 band.
    const reduction = ac.eligibleExpenses - ac.tentativeCredit; // = eligibleExpenses × phaseOutFraction
    if (ac.phaseOutFraction > 0) {
      lines.push(
        moneyLine("8", "MAGI in excess of the phase-out start", Math.max(0, ac.magi - ac.phaseOutStart), {
          note: `Phase-out start $${ac.phaseOutStart.toLocaleString("en-US")}; the credit is fully eliminated at $${ac.phaseOutTop.toLocaleString("en-US")}.`,
        }),
        pctLine("9", "Phase-out fraction (line 8 ÷ $40,000)", ac.phaseOutFraction),
        moneyLine("10", "Reduction (line 6 × line 9)", reduction),
      );
    } else {
      lines.push(
        textLine("8–10", "MAGI phase-out", null, {
          note: `MAGI at or below the $${ac.phaseOutStart.toLocaleString("en-US")} phase-out start — no reduction.`,
        }),
      );
    }

    lines.push(
      moneyLine("11", "Current-year credit after the MAGI phase-out (line 6 − line 10)", ac.tentativeCredit, { emphasis: true }),
      checkLine("Line 11 ties: eligible expenses × (1 − phase-out fraction)", ac.eligibleExpenses * (1 - ac.phaseOutFraction), ac.tentativeCredit),
    );

    // OBBBA refundable split (TY2025+ — extra rows vs the TY2024 layout).
    if (nz(ac.refundableCap) || nz(ac.refundablePortion)) {
      lines.push(
        moneyLine("", "OBBBA refundable cap (P.L. 119-21 §70402, TY2025+)", ac.refundableCap, { indent: 1 }),
        moneyLine("", "Refundable portion of the current-year credit → refundable credits", ac.refundablePortion, {
          indent: 1,
          emphasis: true,
          note: "Bypasses the tax-liability limit and adds directly to the refund. Applies to the CURRENT-year credit only — carryforwards stay nonrefundable.",
        }),
      );
    }
  } else {
    lines.push(
      textLine(
        "",
        "Current-year credit",
        isMfs ? "Not eligible — married filing separately" : "No current-year eligible expenses",
        {
          note: isMfs
            ? "Engine v1 disqualifies MFS (the narrow §23 lived-apart exception is not modeled). The prior carryforward below rolls forward untouched — conservative."
            : "Only the prior §23(c) carryforward is in play this year.",
        },
      ),
    );
  }

  // Carryforward in + nonrefundable application (lines 13–16).
  if (nz(ac.priorCarryforward)) {
    lines.push(
      moneyLine("13", "Adoption credit carryforward from prior years", ac.priorCarryforward, {
        note: "§23(c) — unused nonrefundable credit carries forward up to 5 years.",
      }),
    );
  }
  lines.push(
    moneyLine("14", "Total nonrefundable credit available (current nonrefundable portion + carryforward)", ac.nonRefundableTentative, {
      note: nz(ac.refundablePortion)
        ? "TY2025+: the current-year credit enters net of its refundable portion (the official 2025 revision renumbers these lines)."
        : undefined,
    }),
    checkLine(
      "Line 14 ties: (line 11 − refundable portion) + line 13",
      ac.tentativeCredit - ac.refundablePortion + ac.priorCarryforward,
      ac.nonRefundableTentative,
    ),
    moneyLine("16", "Adoption credit — nonrefundable applied (smaller of line 14 or the tax-liability limit) → Schedule 3, line 6c", ac.nonRefundableApplied, {
      emphasis: true,
      note: "Tax-liability limit (line 15) = income tax remaining after the higher-priority Schedule 3 credits — applied by the engine inside its credit ordering (see the reconciliation worksheet).",
    }),
    moneyLine("", "Carryforward to next year (line 14 − line 16)", ac.carryforwardToNext, {
      note: "§23(c) — 5-year carryforward life; vintage/expiry not tracked by the engine.",
    }),
    checkLine("Carryforward ties to engine adoptionCreditCarryforwardRemaining", ac.carryforwardToNext, ret.adoptionCreditCarryforwardRemaining),
  );

  return {
    formId: "8839",
    formNumber: "Form 8839",
    title: "Qualified Adoption Expenses",
    subtitle: "§23 adoption credit — MAGI phase-out, OBBBA refundable split (TY2025+), and the §23(c) carryforward",
    taxYear: ret.taxYear,
    parts: [{ title: "Part II — Adoption Credit", lines }],
    footnotes: [
      "MFS bar: engine v1 disqualifies married-filing-separately returns from the current-year credit (the narrow §23 lived-apart exception is not modeled); a prior §23(c) carryforward rolls forward untouched — conservative, never overstates the refund.",
      "Single-adoption model: qualified expenses are capped at ONE child's dollar limit. Simultaneous multiple adoptions need per-child entry (engine sub-gap) — Part I child detail and Part III employer-provided adoption benefits are not modeled.",
      "MAGI = AGI + foreign earned income exclusion add-back (§23(b)(2)(B)). The phase-out applies to the CURRENT-year credit only; a prior carryforward keeps its already-determined dollar amount and is not re-phased.",
      "Form 8839 lines 3–4 (credit claimed in a prior year for the same child) are not modeled — the CPA nets prior-year claims out of the qualified-expenses input.",
      "OBBBA (P.L. 119-21 §70402) made up to $5,000 (TY2025, indexed to $5,120 TY2026) of the current-year credit refundable; through TY2024 the credit is fully nonrefundable. TY2024 line numbering shown — the official 2025 revision adds refundable-split lines.",
    ],
  };
}
