/**
 * T2.1 — Schedule 1-A (Form 1040): OBBBA above-the-deduction subtractions.
 *
 * The One Big Beautiful Bill Act (P.L. 119-21) created four new TY2025–2028
 * deductions that reduce TAXABLE income (Form 1040 line 13b), not AGI:
 *   - Qualified tips (§224)            — up to $25,000
 *   - Qualified overtime (§225)        — up to $12,500 ($25,000 MFJ)
 *   - Qualified car-loan interest (§163(h)(4)) — up to $10,000
 *   - Senior deduction (§151(d), age 65+)      — $6,000/eligible taxpayer
 *
 * Each carries its own MAGI phase-out; the engine has ALREADY applied the caps
 * and phase-outs, so the amounts here are the final deductible figures.
 *
 * Substitute-form workpaper (Pub 1167 conventions). Applicable only when the
 * engine computed a positive OBBBA total (TY2025–2028 with qualifying inputs).
 */

import {
  checkLine,
  moneyLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

export function buildSchedule1A(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const d = ret.obbbaSchedule1A;
  if (!(d.total > 0)) return null;

  const lines: FormLine[] = [];
  if (d.tips > 0) {
    lines.push(
      moneyLine("1", "Qualified tips deduction (§224)", d.tips, {
        note: "Up to $25,000; phases out above $150k ($300k MFJ) MAGI. Engine value is post-cap/post-phase-out.",
      }),
    );
  }
  if (d.overtime > 0) {
    lines.push(
      moneyLine("2", "Qualified overtime compensation deduction (§225)", d.overtime, {
        note: "Up to $12,500 ($25,000 MFJ); same MAGI phase-out band as tips.",
      }),
    );
  }
  if (d.carLoanInterest > 0) {
    lines.push(
      moneyLine("3", "Qualified passenger vehicle loan interest (§163(h)(4))", d.carLoanInterest, {
        note: "Up to $10,000; phases out above $100k ($200k MFJ) MAGI. U.S.-assembled vehicle, loan after 2024.",
      }),
    );
  }
  if (d.senior > 0) {
    lines.push(
      moneyLine("4", "Additional senior deduction (§151(d), age 65+)", d.senior, {
        note: "$6,000 per eligible taxpayer (65+); phases out above $75k ($150k MFJ) MAGI.",
      }),
    );
  }
  lines.push(
    moneyLine("5", "Total OBBBA deductions — to Form 1040 line 13b", d.total, { emphasis: true }),
  );
  lines.push(
    checkLine("Components sum to the engine OBBBA total", d.tips + d.overtime + d.carLoanInterest + d.senior, d.total),
  );

  return {
    formId: "schedule-1a",
    formNumber: "Schedule 1-A (Form 1040)",
    title: "Additional Deductions (OBBBA)",
    subtitle: "Tips / overtime / car-loan interest / senior — reduce taxable income (line 13b), not AGI.",
    taxYear: ret.taxYear,
    parts: [{ lines }],
    footnotes: [
      "These four deductions reduce TAXABLE income (Form 1040 line 13b), not AGI — so AGI-keyed phase-outs (NIIT, IRMAA, §199A) are unaffected. They offset the ordinary-income portion; preferential LTCG/QDIV is preserved.",
      "Available TY2025–2028 only (OBBBA §70101–70104 sunset). MAGI phase-outs are already applied by the engine; the senior deduction is age-driven (no input marker).",
    ],
  };
}
