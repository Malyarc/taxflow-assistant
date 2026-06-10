/**
 * T2.1 — Form 8283 (Noncash Charitable Contributions) substitute workpaper.
 *
 * The engine has NO per-item gift detail and `ScheduleACalculation` exposes no
 * cash/noncash split — the noncash total is derived the same way the engine
 * derives it: the sum of applied `charitable_property` adjustments
 * (taxReturnEngine.ts `sumByType("charitable_property")`, negatives floored to
 * 0 inside calculateScheduleA). Form 8283 is REQUIRED when the claimed
 * deduction for all noncash gifts exceeds $500 (Form 8283 instructions) —
 * that is the applicability gate.
 *
 * What this workpaper can and cannot do:
 *   - CAN: tie the aggregate noncash amount, show the §170(b)(1)(C) 30%-of-AGI
 *     ceiling for capital-gain property and the overall 50% ceiling, and tie
 *     the combined Schedule A charitable deduction to the engine.
 *   - CANNOT: render Section A/B per-item rows (description, FMV, valuation
 *     method, appraiser declaration) — CPA-supplied on the official form.
 */

import {
  moneyLine,
  nz,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export function buildForm8283(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;

  // Aggregate-only data model: without input adjustments there is nothing to
  // report (degrade gracefully — the packet simply omits the form).
  if (!inputs) return null;

  // Mirror the engine's adjustment filter (isApplied !== false) + the
  // calculateScheduleA floor at 0.
  const noncash = Math.max(
    0,
    (inputs.adjustments ?? [])
      .filter((a) => a.adjustmentType === "charitable_property" && a.isApplied !== false)
      .reduce((s, a) => s + toNum(a.amount), 0),
  );

  // Form 8283 is required only when total noncash deductions claimed > $500.
  if (noncash <= 500) return null;

  const agi = ret.adjustedGrossIncome;
  const cap30 = 0.3 * Math.max(0, agi);
  const cap50 = 0.5 * Math.max(0, agi);
  const usingStandard = ret.itemizedDeductions == null;

  const lines: FormLine[] = [
    moneyLine("1(h)", "Total noncash charitable contributions claimed (aggregate FMV)", noncash, {
      emphasis: true,
      note: "Sum of the return's charitable-property entries. Per-item Section A Part I rows (donee, description, date, FMV, valuation method) are CPA-supplied on the official form.",
    }),
    moneyLine("", "30%-of-AGI ceiling for appreciated capital-gain property (§170(b)(1)(C))", cap30, {
      indent: 1,
      note: "30% × AGI. The engine applies this cap to the property bucket inside the Schedule A computation (calculateScheduleA).",
    }),
    moneyLine("", "Overall 50%-of-AGI charitable ceiling (§170(b)(1))", cap50, {
      indent: 1,
      note: "50% × AGI, reduced by cash contributions already deducted — the engine bounds property by min(30% AGI, 50% AGI − cash deducted).",
    }),
    moneyLine(
      "",
      "Schedule A charitable deduction as computed (cash + noncash + carryforward applied)",
      ret.scheduleA.charitableDeductible,
      {
        emphasis: true,
        note: "Engine tie — Schedule A line 14 charitable bucket after all AGI limits.",
      },
    ),
  ];

  if (nz(ret.charitableCarryforwardCashRemaining)) {
    lines.push(
      moneyLine("", "CASH charitable carryforward to next year (§170(d)(1))", ret.charitableCarryforwardCashRemaining, {
        indent: 1,
        note: "Cross-reference — cash-bucket carryforward only; see footnote on property carryforward.",
      }),
    );
  }

  if (noncash > 5000) {
    lines.push(
      textLine("", "Section B appraisal trigger", "review required", {
        note: "Aggregate noncash exceeds $5,000 — any single item (or group of similar items) over $5,000 requires Section B with a qualified appraisal + donee acknowledgment (publicly traded securities excepted). The engine has no per-item detail; CPA determines.",
      }),
    );
  }

  if (usingStandard) {
    lines.push(
      textLine("", "Deduction status", "standard deduction used", {
        note: "The return takes the standard deduction, so the noncash gift produced no current-year federal benefit (itemized total below the standard deduction).",
      }),
    );
  }

  return {
    formId: "8283",
    formNumber: "Form 8283",
    title: "Noncash Charitable Contributions",
    subtitle: "Section A summary — substitute workpaper, not a filed form",
    taxYear: ret.taxYear,
    parts: [{ title: "Section A — Donated property of $5,000 or less and publicly traded securities (summary)", lines }],
    footnotes: [
      "Per-item detail (donee name/address/EIN, property description, acquisition date + how acquired, donor's cost basis, FMV and the method used to determine it) is CPA-supplied on the official Form 8283 — the engine models only the aggregate noncash amount.",
      "Appreciated long-term capital-gain property is deductible at FMV subject to the 30%-of-AGI limit (§170(b)(1)(C)); electing §170(b)(1)(C)(iii) to deduct basis at the 50% limit, ordinary-income property (basis-only), and vehicle/§170(f)(12) rules are not modeled.",
      "PROPERTY excess above the AGI ceilings carries forward 5 years under §170(d)(1), but the engine tracks only the CASH carryforward — the property carryforward is CPA-tracked (documented engine sub-gap).",
      "Engine applies the AGI limits inside Schedule A: property deductible = min(entered property, 30% AGI, 50% AGI − cash deducted).",
    ],
  };
}
