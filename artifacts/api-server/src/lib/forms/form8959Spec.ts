/**
 * T2.1 — Form 8959 (Additional Medicare Tax) workpaper builder.
 *
 * Line numbers follow the official TY2024 Form 8959:
 *   Part I   — lines 1–7  (Additional Medicare Tax on wages)
 *   Part II  — lines 8–13 (Additional Medicare Tax on self-employment income)
 *   Part III — lines 14–17 (RRTA compensation — not modeled)
 *   line 18  — total Additional Medicare Tax
 *   Part IV  — lines 19–24 (Medicare-withholding reconciliation — F-6: rendered
 *              as the engine's aggregate `additionalMedicareWithholding`)
 *
 * Source: ret.detail.additionalMedicare (`calculateAdditionalMedicareTax`,
 * taxCalculator.ts) — 0.9% (IRC §3101(b)(2)/§1401(b)(2)) on Medicare wages +
 * SE net earnings above the filing-status threshold; wages consume the
 * threshold first (Form 8959 lines 10–11).
 *
 * Applicability: ret.additionalMedicareTax > 0 OR Additional-Medicare
 * withholding was credited (Part IV is required to claim the withholding even
 * when no Additional Medicare Tax is owed — e.g. one spouse over the
 * per-employer $200k withholding trigger but under the joint $250k threshold).
 *
 * PURE — no Date / randomness / DB / pdfkit.
 */

import {
  checkLine,
  moneyLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
  type FormPart,
} from "./formSpec";

const RATE = 0.009;

export function buildForm8959(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  if (!(ret.additionalMedicareTax > 0 || (ret.additionalMedicareWithholding ?? 0) > 0)) return null;

  const am = ret.detail.additionalMedicare;

  const thresholdNote =
    "Filing-status threshold (not inflation-indexed): $200,000 single/HoH/QSS; $250,000 MFJ; $125,000 MFS.";

  // ── Part I — Additional Medicare Tax on wages ──
  const partI: FormLine[] = [
    moneyLine("1", "Medicare wages and tips (Form W-2, box 5)", am.medicareWages, {
      note: "Sum across all W-2s; the engine falls back to box 1 when box 5 is absent.",
    }),
    moneyLine("4", "Add lines 1 through 3", am.medicareWages, {
      note: "(= line 1 — unreported tips (Form 4137, line 2) and Form 8919 wages (line 3) are not modeled)",
    }),
    moneyLine("5", "Filing-status threshold", am.threshold, { note: thresholdNote }),
    moneyLine("6", "Line 4 minus line 5 (if zero or less, -0-)", am.wagesOverThreshold),
    moneyLine("7", "Additional Medicare Tax on Medicare wages (line 6 × 0.9%)", am.additionalMedicareOnWages, {
      emphasis: true,
    }),
    checkLine("Line 7 ties: line 6 × 0.9%", am.wagesOverThreshold * RATE, am.additionalMedicareOnWages),
  ];

  // ── Part II — Additional Medicare Tax on self-employment income ──
  // Rendered only when there are SE net earnings (the official form is left
  // blank otherwise).
  const parts: FormPart[] = [{ title: "Part I — Additional Medicare Tax on Wages", lines: partI }];
  if (am.seNetEarnings > 0) {
    const partII: FormLine[] = [
      moneyLine("8", "Self-employment income (Schedule SE, Part I, line 6)", am.seNetEarnings, {
        note: "Net SE earnings (92.35% of net profit); if zero or less, -0-.",
      }),
      moneyLine("9", "Filing-status threshold", am.threshold, { note: thresholdNote }),
      moneyLine("10", "Enter the amount from line 4", am.medicareWages),
      moneyLine("11", "Line 9 minus line 10 (if zero or less, -0-)", am.seThresholdRemaining, {
        note: "The threshold remaining for SE income after wages consume it first.",
      }),
      moneyLine("12", "Line 8 minus line 11 (if zero or less, -0-)", am.seOverThreshold),
      moneyLine("13", "Additional Medicare Tax on self-employment income (line 12 × 0.9%)", am.additionalMedicareOnSe, {
        emphasis: true,
      }),
      checkLine("Line 13 ties: line 12 × 0.9%", am.seOverThreshold * RATE, am.additionalMedicareOnSe),
    ];
    parts.push({ title: "Part II — Additional Medicare Tax on Self-Employment Income", lines: partII });
  }

  // ── Total ──
  const totalLines: FormLine[] = [
    moneyLine("18", "Total Additional Medicare Tax (add lines 7, 13, and 17)", am.additionalMedicareTax, {
      emphasis: true,
      note: "Flows to Schedule 2, line 11. Line 17 (RRTA) is not modeled.",
    }),
    checkLine(
      "Line 18 ties: line 7 + line 13",
      am.additionalMedicareOnWages + am.additionalMedicareOnSe,
      am.additionalMedicareTax,
    ),
    checkLine("Line 18 ties to the engine's Additional Medicare Tax", am.additionalMedicareTax, ret.additionalMedicareTax),
  ];
  parts.push({ title: "Total Additional Medicare Tax (line 18)", lines: totalLines });

  // ── Part IV — withholding reconciliation (F-6, audit 2026-06-11) ──
  // Rendered when the engine credited Additional-Medicare withholding (the
  // W-2 box 6 excess over 1.45% × box 5). Line 24 is included in 1040 line 25c
  // federal income tax withholding per the Form 8959 instructions.
  if ((ret.additionalMedicareWithholding ?? 0) > 0) {
    const partIV: FormLine[] = [
      moneyLine("22", "Additional Medicare Tax withholding (box 6 over 1.45% × box 5)", ret.additionalMedicareWithholding, {
        note: "Aggregate across W-2s that report box 6 (lines 19–21 detail not re-rendered).",
      }),
      moneyLine("24", "Total Additional Medicare Tax withholding — include on Form 1040, line 25c", ret.additionalMedicareWithholding, {
        emphasis: true,
      }),
    ];
    parts.push({ title: "Part IV — Withholding Reconciliation (lines 19–24)", lines: partIV });
  }

  return {
    formId: "8959",
    formNumber: "Form 8959",
    title: "Additional Medicare Tax",
    subtitle: "Substitute workpaper (Pub 1167 conventions) — CPA review copy, not for filing",
    taxYear: ret.taxYear,
    parts,
    footnotes: [
      "Lines 2–3 (unreported tips, Form 4137; Form 8919 wages) and Part III (RRTA compensation, lines 14–17) are not modeled — the engine computes Additional Medicare Tax from W-2 Medicare wages + Schedule SE net earnings only.",
      "Part IV (lines 19–24): the engine credits Additional-Medicare withholding from W-2 box 6 (max(0, total box 6 − 1.45% × total box 5), aggregated across W-2s that report box 6) into 1040 line 25c. W-2s without a box 6 value are excluded from the reconciliation — enter box 6 on every W-2 for an exact Part IV.",
    ],
  };
}
