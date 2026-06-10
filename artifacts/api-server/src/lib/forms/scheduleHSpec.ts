/**
 * T2.1 — Schedule H (Form 1040) "Household Employment Taxes" substitute
 * workpaper (Pub 1167 conventions — a CPA review copy, NOT a filed form).
 *
 * Line numbers follow the official TY2024 Schedule H (the 2024 revision
 * removed the 2021–2023 COVID sick/family-leave credit lines 1b/2b/2c/8b–8e,
 * restoring the plain Part I numbering):
 *   Part I:  1 cash wages subject to social security tax · 2 SS tax (12.4%) ·
 *            3 cash wages subject to Medicare tax · 4 Medicare tax (2.9%) ·
 *            5 wages subject to Additional Medicare Tax withholding ·
 *            6 Additional Medicare Tax (0.9%) · 7 federal income tax withheld ·
 *            8 total social security, Medicare, and federal income taxes.
 *   Part II: Section A — 15 cash wages subject to FUTA tax · 16 FUTA tax
 *            (0.6% net of the full 5.4% state credit).
 *   Part III: 25 amount from line 8 · 26 total household employment taxes
 *            (→ Schedule 2 line 9).
 *
 * Engine mapping (scheduleH.ts → ComputedTaxReturn.scheduleH):
 *   total / socialSecurityTax / medicareTax / additionalMedicareTax / futaTax /
 *   ficaApplies / cashWages. The cash wages come from the
 *   `household_employee_cash_wages` adjustment; the FUTA base optionally from
 *   the `household_employee_futa_wages` override (else min(wages, $7,000)).
 *   Line 1 (SS-base-capped wages) is recovered from the engine's flat 12.4%
 *   (tax ÷ 0.124) — a documented inversion, not an independent recomputation.
 *
 * Applicability: ret.scheduleH.total > 0.
 */

import {
  boolLine,
  checkLine,
  moneyLine,
  nz,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Engine constants mirrored for derivation notes (scheduleH.ts). */
const FUTA_WAGE_BASE = 7000;
const ADDL_MEDICARE_THRESHOLD = 200000;

export function buildScheduleHForm(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const sh = ret.scheduleH;
  if (!(sh.total > 0)) return null;

  const ficaThreshold = ret.taxYear <= 2024 ? 2700 : 2800; // SSA-indexed FICA trigger

  // ── Part I — Social Security, Medicare, and Federal Income Taxes ──────────
  const p1: FormLine[] = [
    moneyLine("", "Total cash wages paid to household employee(s) (engine input)", sh.cashWages, {
      note: "Sum of household_employee_cash_wages adjustments.",
    }),
    boolLine("A", `Any one employee paid cash wages ≥ the $${ficaThreshold.toLocaleString("en-US")} FICA threshold?`, sh.ficaApplies, {
      note: "Engine proxy: total annual cash wages vs the threshold (per-employee detail not modeled).",
    }),
  ];
  if (sh.ficaApplies) {
    // Recover the SS-base-capped wage line from the engine's flat 12.4% rate.
    const ssWages = r2(sh.socialSecurityTax / 0.124);
    p1.push(
      moneyLine("1", "Total cash wages subject to social security tax", ssWages, {
        note:
          ssWages < sh.cashWages - 0.01
            ? "Social Security wage base cap applied (wages above the base are SS-exempt)."
            : undefined,
      }),
      moneyLine("2", "Social security tax (line 1 × 12.4%)", sh.socialSecurityTax),
      moneyLine("3", "Total cash wages subject to Medicare tax (no cap)", sh.cashWages),
      moneyLine("4", "Medicare tax (line 3 × 2.9%)", sh.medicareTax),
    );
    if (nz(sh.additionalMedicareTax)) {
      p1.push(
        moneyLine("5", "Total cash wages subject to Additional Medicare Tax withholding", Math.max(0, sh.cashWages - ADDL_MEDICARE_THRESHOLD), {
          note: "Cash wages over the flat $200,000 withholding threshold (not filing-status indexed).",
        }),
        moneyLine("6", "Additional Medicare Tax withholding (line 5 × 0.9%)", sh.additionalMedicareTax),
      );
    }
  } else {
    p1.push(
      textLine("1–6", "Cash wages below the FICA threshold — no social security or Medicare tax due", "—"),
    );
  }
  p1.push(
    textLine("7", "Federal income tax withheld, if any", null, {
      note: "(not modeled — CPA supplies; income-tax withholding for a household employee is optional)",
    }),
  );
  const line8 = r2(sh.socialSecurityTax + sh.medicareTax + sh.additionalMedicareTax);
  p1.push(
    moneyLine("8", "Total social security, Medicare, and federal income taxes (lines 2 + 4 + 6 + 7)", line8, {
      emphasis: true,
    }),
  );

  // ── Part II — Federal Unemployment (FUTA) Tax (Section A) ─────────────────
  // FUTA wage base: mirror the engine exactly — the household_employee_futa_wages
  // override when positive, else min(cash wages, $7,000). When inputs are not
  // available to the workpaper, invert the engine's flat 0.6% net rate.
  const futaOverride = (inputs?.adjustments ?? [])
    .filter((a) => a.isApplied !== false && a.adjustmentType === "household_employee_futa_wages")
    .reduce((s, a) => s + toNum(a.amount), 0);
  const futaWages =
    sh.futaTax <= 0
      ? 0
      : inputs != null
        ? futaOverride > 0
          ? futaOverride
          : Math.min(sh.cashWages, FUTA_WAGE_BASE)
        : r2(sh.futaTax / 0.006);
  const p2: FormLine[] = [
    boolLine("9", "Total cash wages of $1,000 or more in any calendar quarter?", sh.futaTax > 0, {
      note: "Engine proxy: annual cash wages ≥ $1,000 (quarterly detail not modeled).",
    }),
  ];
  if (sh.futaTax > 0) {
    p2.push(
      moneyLine("15", "Total cash wages subject to FUTA tax (first $7,000 per employee)", futaWages, {
        note:
          futaOverride > 0
            ? "CPA-supplied multi-employee FUTA base (household_employee_futa_wages override)."
            : "Single-employee default: min(cash wages, $7,000). Multi-employee bases via the household_employee_futa_wages override.",
      }),
      moneyLine("16", "FUTA tax (line 15 × 0.6%)", sh.futaTax, {
        note: "Net rate after the full 5.4% state-unemployment credit — credit-reduction states are a CPA refinement.",
      }),
      checkLine("FUTA tax = FUTA wages × 0.6%", futaWages * 0.006, sh.futaTax),
    );
  } else {
    p2.push(textLine("15–16", "FUTA not triggered — no quarter reached $1,000 in cash wages", "—"));
  }

  // ── Part III — Total Household Employment Taxes ───────────────────────────
  const p3: FormLine[] = [
    moneyLine("25", "Amount from line 8", line8),
    moneyLine("26", "Total household employment taxes (line 8 + line 16)", sh.total, {
      emphasis: true,
      note: "Flows to Schedule 2, line 9 → included in Form 1040 line 23 total other taxes. An employment tax — NOT offset by nonrefundable income-tax credits.",
    }),
    checkLine("Line 26 ties to the engine Schedule H total", line8 + sh.futaTax, sh.total),
  ];

  return {
    formId: "schedule-h",
    formNumber: "Schedule H (Form 1040)",
    title: "Household Employment Taxes",
    subtitle: "FICA + FUTA on household-employee cash wages — CPA review workpaper",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — Social Security, Medicare, and Federal Income Taxes", lines: p1 },
      { title: "Part II — Federal Unemployment (FUTA) Tax (Section A)", lines: p2 },
      { title: "Part III — Total Household Employment Taxes", lines: p3 },
    ],
    footnotes: [
      "Substitute form per Pub 1167 conventions — CPA review workpaper, not for filing. Amounts are engine-exact (cents), not whole-dollar rounded.",
      "FICA triggers when cash wages to any one household employee reach $2,700 (TY2024) / $2,800 (TY2025); FUTA is owed when total household cash wages reach $1,000 in any calendar quarter. The engine applies both tests against annual totals (aggregate single-employee model — documented sub-gap).",
      "Both the employer AND employee FICA shares are reported on Schedule H (12.4% SS to the wage base + 2.9% Medicare on all cash wages), whether or not the employee share was withheld.",
      "Part II assumes the full 5.4% FUTA state credit (net 0.6%) and a single state; Section B multi-state / credit-reduction computations are not modeled. State unemployment contributions (line 14) are not tracked.",
      "Pre-2024 Schedule H revisions numbered the Part I total 8a–8d (COVID-credit era); the TY2024 form restored plain line 8.",
    ],
  };
}
