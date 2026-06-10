/**
 * T2.1 — Form 7206 (Self-Employed Health Insurance Deduction) substitute
 * workpaper.
 *
 * Renders the engine's §162(l) SEHI computation (`ret.sehi`, K5 —
 * taxCalculator.calculateSehiDeduction) against the official TY2024 Form 7206
 * line skeleton:
 *   line 1  — total premiums paid (engine lumps medical/dental/vision/LTC;
 *             the official form splits LTC onto line 2)
 *   line 4  — earned-income limit for the trade/business under which the plan
 *             is established
 *   line 14 — the deduction → Schedule 1 (Form 1040) line 17
 *
 * Engine semantics: deduction = min(premiums, max(0, net SE earnings −
 * deductible half of SE tax)). The official line 4 ALSO subtracts Schedule 1
 * line 16 (SE retirement-plan contributions) — documented engine sub-gap.
 */

import {
  checkLine,
  moneyLine,
  nz,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

export function buildForm7206(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const sehi = ret.sehi;

  // Applicable only when an SEHI deduction was actually taken.
  if (!nz(sehi.deduction)) return null;

  const excessPremiums = Math.max(0, sehi.premiumsPaid - sehi.deduction);

  const lines: FormLine[] = [
    moneyLine("1", "Total health insurance premiums paid for the year", sehi.premiumsPaid, {
      note: "Engine lumps medical / dental / vision / qualified LTC into one figure (official form splits LTC onto line 2 with per-age §213(d)(10) limits — CPA verifies any LTC portion).",
    }),
    moneyLine(
      "4",
      "Earned-income limit: net SE earnings − deductible half of SE tax (§162(l)(2)(A))",
      sehi.earnedIncomeCap,
      {
        note: `Net SE earnings ${ret.detail.se.netSeEarnings.toLocaleString("en-US", { style: "currency", currency: "USD" })} − half-SE ${ret.detail.se.deductibleHalf.toLocaleString("en-US", { style: "currency", currency: "USD" })}. Official line 4 also subtracts Schedule 1 line 16 SE retirement-plan contributions — NOT modeled (engine sub-gap; CPA reduces line 1 to compensate when material).`,
      },
    ),
    moneyLine("14", "Self-employed health insurance deduction — smaller of line 1 or line 4", sehi.deduction, {
      emphasis: true,
      note: "→ Schedule 1 (Form 1040) line 17 (above-the-line).",
    }),
    checkLine("Line 14 = min(line 1, line 4) — engine deduction ties", Math.min(sehi.premiumsPaid, sehi.earnedIncomeCap), sehi.deduction),
  ];

  if (nz(excessPremiums)) {
    lines.push(
      moneyLine("", "Premiums above the earned-income limit (NOT deductible as SEHI)", excessPremiums, {
        indent: 1,
        note: "No carryforward exists in §162(l). The excess is same-year Schedule A medical (§213) subject to the 7.5%-of-AGI floor — CPA enters it there if itemizing.",
      }),
    );
  }

  return {
    formId: "7206",
    formNumber: "Form 7206",
    title: "Self-Employed Health Insurance Deduction",
    subtitle: "IRC §162(l) — substitute workpaper, not a filed form",
    taxYear: ret.taxYear,
    parts: [{ lines }],
    footnotes: [
      "Eligibility is CPA-enforced: no deduction for any month the filer (or spouse) was eligible to participate in an employer-subsidized health plan — the engine assumes the entered premiums qualify.",
      "The official lines 6–13 (specified premiums / Form 8962 premium-tax-credit interplay for marketplace coverage) are not modeled — for APTC-subsidized marketplace plans the CPA applies the iterative Pub 974 computation.",
      "Engine cap detail: the earned-income limit uses the combined Schedule SE result; the official form applies the limit per trade/business under which the plan is established.",
    ],
  };
}
