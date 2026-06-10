/**
 * T2.1 — Form 4562 (Depreciation and Amortization) substitute workpaper
 * (Pub 1167 conventions — CPA review copy, NOT a filed form).
 *
 * The engine has TWO depreciation channels, both rendered here:
 *   1. The Schedule C ASSET REGISTER (`inputs.scheduleCAssets` →
 *      `ret.scheduleCAssetDepreciation`): §179 with the §179(b)(3) business-
 *      income limit + carryforward, §168(k) bonus, and personal-property MACRS.
 *      Its total reduces the Schedule C net profit (and therefore the SE base,
 *      QBI, and earned income) via `ret.scheduleCDepreciation`.
 *   2. The AGGREGATE ADJUSTMENTS channel (`section_179_expense_election` /
 *      `bonus_depreciation_basis[_obbba]` → `ret.section179Applied` /
 *      `ret.bonusDepreciationApplied`): an ABOVE-THE-LINE deduction (reduces
 *      AGI but NOT the SE base — kept for rental / pass-through contexts).
 *
 * Line numbers follow the official TY2024 Form 4562: Part I lines 1–13 (§179),
 * Part II line 14 (special/bonus allowance), Part III lines 17/19 (MACRS),
 * Part IV line 22 (total).
 *
 * Engine-exact: deductions come from ComputedTaxReturn fields; the Part I
 * dollar-limit rows (lines 1/3/5) re-state the year's statutory §179 caps
 * (display-only mirror of the engine's SECTION_179_CAPS — Rev. Proc. 2023-34
 * §3.27 TY2024 $1.22M/$3.05M; OBBBA §70306 TY2025 $2.5M/$4M; Rev. Proc.
 * 2025-32 TY2026 $2.56M/$4.09M). Line 11 (business-income limit) is derived
 * from inputs using the engine's exact formula when inputs are available.
 */

import {
  checkLine,
  moneyLine,
  nz,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
  type FormPart,
} from "./formSpec";
import type { TaxReturnInputs } from "../taxReturnEngine";
import type { ScheduleCAsset } from "../taxCalculator";

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Display-only mirror of the engine's SECTION_179_CAPS (see header citation). */
const SECTION_179_LIMITS: Record<number, { cap: number; phaseStart: number }> = {
  2024: { cap: 1_220_000, phaseStart: 3_050_000 },
  2025: { cap: 2_500_000, phaseStart: 4_000_000 },
  2026: { cap: 2_560_000, phaseStart: 4_090_000 },
};

/** Year-default §168(k) bonus rates (note text only; the engine computes the $). */
const BONUS_RATE_NOTE: Record<number, string> = {
  2024: "60% (TCJA phase-down)",
  2025: "40% TCJA default; OBBBA §70301 restores 100% for property acquired AND placed in service after 1/19/2025 (engine: `bonusFullObbba` flag / `bonus_depreciation_basis_obbba` adjustment)",
  2026: "100% (OBBBA §70301, permanent)",
};

function sumAdj(inputs: TaxReturnInputs | undefined, type: string): number {
  return (inputs?.adjustments ?? [])
    .filter((a) => a.adjustmentType === type && a.isApplied !== false)
    .reduce((s, a) => s + toNum(a.amount), 0);
}

function assetDesc(a: ScheduleCAsset): string {
  const flags: string[] = [];
  if (a.section179) flags.push("§179 elected");
  if (a.bonus) flags.push(a.bonusFullObbba ? "bonus (OBBBA 100%)" : "bonus elected");
  if (a.isPassengerAuto && !a.gvwrOver6000) flags.push("§280F passenger auto");
  if (a.gvwrOver6000) flags.push("heavy SUV >6,000 lb GVWR (§179(b)(5) cap)");
  const bu = a.businessUsePct;
  if (bu != null && bu < 1) flags.push(`business use ${(bu * 100).toFixed(0)}%`);
  const q = a.placedInServiceQuarter;
  return `${a.recoveryYears}-yr GDS, placed in service ${a.placedInServiceYear}${q ? ` Q${q}` : ""}${flags.length > 0 ? ` — ${flags.join(", ")}` : ""}`;
}

export function buildForm4562(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const reg = ret.scheduleCAssetDepreciation;

  // Applicable when either depreciation channel produced activity (incl. a
  // fully-income-disallowed adjustment-path §179, which is still §179 activity).
  const applicable =
    nz(ret.section179Applied) ||
    nz(ret.bonusDepreciationApplied) ||
    nz(ret.section179Carryforward) ||
    reg != null;
  if (!applicable) return null;

  const year = Math.min(2026, Math.max(2024, ret.taxYear));
  const limits = SECTION_179_LIMITS[year];
  const parts: FormPart[] = [];
  const footnotes: string[] = [];

  const assets = (inputs?.scheduleCAssets ?? []).filter((a) => toNum(a.cost) > 0);
  const currentYearAssets = assets.filter((a) => a.placedInServiceYear === ret.taxYear);
  const priorYearAssets = assets.filter((a) => a.placedInServiceYear < ret.taxYear);

  // ── Part I — §179 (asset-register channel, Schedule C) ────────────────────
  if (reg != null) {
    const lines: FormLine[] = [
      moneyLine("1", "Maximum section 179 deduction for the year", limits.cap, {
        note: `Year-indexed: TY2024 $1,220,000 / TY2025 $2,500,000 (OBBBA) / TY2026 $2,560,000.`,
      }),
    ];

    // §179-elected current-year assets. The engine routes §280F passenger autos
    // OUT of the §179 pool (capped path) and caps a heavy SUV's elected amount
    // at the §179(b)(5) limit — both excluded from the simple cost sum below.
    const plain179Assets = currentYearAssets.filter(
      (a) => a.section179 && !a.isPassengerAuto && !a.gvwrOver6000,
    );
    const special179Present = currentYearAssets.some(
      (a) => a.section179 && (a.isPassengerAuto || a.gvwrOver6000),
    );

    if (inputs) {
      // Line 2 mirrors the engine's `currentYearQualifiedPropertyCost` (drives
      // the investment phase-out): plain assets at cost; vehicles at business
      // basis; a non-§179 heavy SUV is not counted (engine convention).
      const qualifiedPropertyCost = currentYearAssets.reduce((s, a) => {
        const bu = Math.max(0, Math.min(1, a.businessUsePct ?? 1));
        if (a.isPassengerAuto && !a.gvwrOver6000) return s + a.cost * bu;
        if (a.gvwrOver6000) return s + (a.section179 ? a.cost * bu : 0);
        return s + a.cost;
      }, 0);
      const reduction = Math.max(0, qualifiedPropertyCost - limits.phaseStart);
      lines.push(
        moneyLine("2", "Total cost of section 179 property placed in service this year", qualifiedPropertyCost, {
          note: "Engine convention: all current-year qualified property (incl. non-elected MACRS/bonus assets); vehicles at business-use basis.",
        }),
        moneyLine("3", "Threshold cost before reduction in limitation", limits.phaseStart),
        moneyLine("4", "Reduction in limitation (line 2 minus line 3, not less than 0)", reduction),
        moneyLine("5", "Dollar limitation for the year (line 1 minus line 4)", Math.max(0, limits.cap - reduction)),
      );
      plain179Assets.forEach((a) => {
        lines.push(moneyLine("6", `Elected §179 property: ${assetDesc(a)}`, a.cost, { indent: 1 }));
      });
      if (special179Present) {
        lines.push(
          textLine("6", "Vehicle §179 elections present", null, {
            indent: 1,
            note: "Passenger autos are excluded from the §179 pool (engine §280F capped path); heavy-SUV §179 is capped at the §179(b)(5) limit inside the engine — elected amounts below are engine-computed.",
          }),
        );
      }
      const line8 = plain179Assets.reduce((s, a) => s + a.cost, 0);
      const carryIn = Math.max(0, sumAdj(inputs, "schedule_c_section179_carryforward"));
      if (!special179Present) {
        lines.push(moneyLine("8", "Total elected cost of section 179 property", line8));
      }
      if (nz(carryIn)) {
        lines.push(
          moneyLine("10", "Carryover of disallowed deduction from prior year (§179(b)(3)(B))", carryIn),
        );
      }
      // Line 11 — engine-exact §179(b)(3) business-income limit base:
      // (1099-NEC SE income + `self_employment_income` + crypto-mining) − Sch C
      // expenses − manual Sch C depreciation + W-2 wages (Reg §1.179-2(c)(6)(iv)),
      // minus the computed bonus + MACRS.
      const wages = (inputs.w2s ?? [])
        .filter((w) => (w.taxYear ?? ret.taxYear) === ret.taxYear)
        .reduce((s, w) => s + toNum(w.wagesBox1), 0);
      const grossSe =
        sumAdj(inputs, "self_employment_income") +
        ret.form1099Summary.seIncome +
        Math.max(0, sumAdj(inputs, "crypto_mining_income"));
      const incomeBase =
        grossSe -
        Math.max(0, sumAdj(inputs, "schedule_c_expenses")) -
        Math.max(0, sumAdj(inputs, "schedule_c_depreciation")) +
        wages;
      const line11 = Math.max(0, incomeBase - reg.bonusDeduction - reg.macrsDeduction);
      lines.push(
        moneyLine("11", "Business income limitation (§179(b)(3))", line11, {
          note: "Active trade/business income before §179 (Sch C net + W-2 wages per Reg §1.179-2(c)(6)(iv)), less the year's bonus + MACRS.",
        }),
      );
      lines.push(moneyLine("12", "Section 179 expense deduction", reg.section179Deduction, { emphasis: true }));
      if (!special179Present) {
        lines.push(
          checkLine(
            "Line 12 = smaller of (line 8 + line 10) or line 11",
            Math.min(line8 + carryIn, line11),
            reg.section179Deduction,
          ),
        );
      }
    } else {
      lines.push(
        textLine("2", "Total cost of §179 property placed in service", null, {
          note: "(input facts not provided to the workpaper — engine results below are authoritative)",
        }),
      );
      lines.push(moneyLine("12", "Section 179 expense deduction", reg.section179Deduction, { emphasis: true }));
    }
    lines.push(
      moneyLine("13", "Carryover of disallowed deduction to next year (§179(b)(3)(B))", reg.section179Carryforward, {
        note: "Income-disallowed (plus any dollar-cap-disallowed) §179; the pipeline re-seeds it next year as `schedule_c_section179_carryforward`.",
      }),
    );
    parts.push({ title: "Part I — Election to expense certain property under section 179 (Schedule C asset register)", lines });
  }

  // ── Part I(b) — §179 via aggregate adjustments (above-the-line channel) ────
  if (nz(ret.section179Applied) || nz(ret.section179Carryforward)) {
    const lines: FormLine[] = [];
    const electedAdj = inputs != null ? sumAdj(inputs, "section_179_expense_election") : null;
    const bonusBases =
      inputs != null
        ? sumAdj(inputs, "bonus_depreciation_basis") + sumAdj(inputs, "bonus_depreciation_basis_obbba")
        : null;
    if (electedAdj != null && nz(electedAdj)) {
      lines.push(
        moneyLine("8", "Elected §179 amount (`section_179_expense_election` adjustment)", electedAdj),
      );
    }
    lines.push(
      moneyLine("12", "§179 deduction applied (above-the-line)", ret.section179Applied, {
        emphasis: true,
        note: "Engine convention: this channel's income limit is NET SE EARNINGS (Sch SE base × 0.9235), and the deduction reduces AGI — it does NOT reduce the Schedule C net / SE base.",
      }),
      moneyLine("13", "§179 carryforward to next year (§179(b)(3)(B))", ret.section179Carryforward),
    );
    if (
      electedAdj != null &&
      bonusBases != null &&
      electedAdj + bonusBases <= limits.phaseStart // no investment phase-out in play
    ) {
      lines.push(
        checkLine(
          "Elected (capped at the year's dollar limit) = applied + carryforward",
          Math.min(electedAdj, limits.cap),
          ret.section179Applied + ret.section179Carryforward,
        ),
      );
    }
    parts.push({
      title: "Part I (b) — §179 via aggregate adjustments (above-the-line channel)",
      lines,
    });
  }

  // ── Part II — Special depreciation allowance (§168(k) bonus) ──────────────
  if ((reg != null && nz(reg.bonusDeduction)) || nz(ret.bonusDepreciationApplied)) {
    const lines: FormLine[] = [];
    if (reg != null && nz(reg.bonusDeduction)) {
      lines.push(
        moneyLine("14", "Special depreciation allowance — Schedule C asset register", reg.bonusDeduction, {
          note: `Rate by placed-in-service year: ${BONUS_RATE_NOTE[year]}.`,
        }),
      );
    }
    if (nz(ret.bonusDepreciationApplied)) {
      lines.push(
        moneyLine("14", "Special depreciation allowance — aggregate adjustment channel (above-the-line)", ret.bonusDepreciationApplied, {
          note: `Basis × rate (${BONUS_RATE_NOTE[year]}); `
            + "`bonus_depreciation_basis_obbba` basis gets 100% in TY2025+. Reduces AGI, not the SE base.",
        }),
      );
    }
    parts.push({ title: "Part II — Special depreciation allowance (§168(k))", lines });
  }

  // ── Part III — MACRS depreciation (asset register) ─────────────────────────
  if (reg != null) {
    const lines: FormLine[] = [];
    priorYearAssets.forEach((a) => {
      lines.push(
        moneyLine("17", `Prior-year asset (cost shown): ${assetDesc(a)}`, a.cost, {
          indent: 1,
          note: a.bonus
            ? "MACRS continues on the basis net of the placed-in-service year's bonus (engine reconstructs the prior bonus rate)."
            : a.section179
              ? "Fully expensed via §179 in its placed-in-service year — contributes $0 now."
              : undefined,
        }),
      );
    });
    currentYearAssets
      .filter((a) => !a.section179)
      .forEach((a) => {
        lines.push(moneyLine("19", `Current-year asset (cost shown): ${assetDesc(a)}`, a.cost, { indent: 1 }));
      });
    if (lines.length === 0 && inputs == null) {
      lines.push(textLine("", "Asset register detail unavailable (inputs not provided)", null));
    }
    lines.push(
      moneyLine("", "MACRS deduction — all register assets (engine-computed)", reg.macrsDeduction, {
        emphasis: true,
        note: "Per-asset dollar detail is engine-internal; this is the Pub 946 Table A-1..A-5 total (half-year or mid-quarter per the §168(d)(3) test).",
      }),
    );
    if (reg.midQuarterApplies) {
      lines.push(
        textLine("", "§168(d)(3) MID-QUARTER convention applies", "review", {
          note: "More than 40% of the year's non-§179 basis was placed in service in Q4 — assets WITH a quarter use the mid-quarter tables; an asset missing its quarter falls back to half-year (supply the quarter for an exact figure).",
        }),
      );
    }
    if (reg.section280FCapApplied) {
      lines.push(
        textLine("", "§280F passenger-automobile luxury cap BOUND this year", "review", {
          note: "A passenger auto's combined §179 + bonus + MACRS was limited to the §280F(a) year-of-life dollar cap × business use; ≤50% business use forces ADS straight-line with no §179/bonus (§280F(b)(1)).",
        }),
      );
    }
    parts.push({ title: "Part III — MACRS depreciation (Schedule C asset register)", lines });
  }

  // ── Part IV — Summary + engine tie-outs ───────────────────────────────────
  const summary: FormLine[] = [];
  if (reg != null) {
    summary.push(
      moneyLine("22", "Total — asset register (§179 + bonus + MACRS) → Schedule C line 13", reg.totalDepreciation, {
        emphasis: true,
      }),
      checkLine(
        "Line 22 = §179 + bonus + MACRS components",
        reg.section179Deduction + reg.bonusDeduction + reg.macrsDeduction,
        reg.totalDepreciation,
      ),
    );
  }
  const manualDep = inputs != null ? Math.max(0, sumAdj(inputs, "schedule_c_depreciation")) : null;
  if (manualDep != null && nz(manualDep)) {
    summary.push(
      moneyLine("", "Manual `schedule_c_depreciation` adjustment (CPA-computed Form 4562)", manualDep),
    );
  }
  if (nz(ret.scheduleCDepreciation) || reg != null) {
    summary.push(
      moneyLine("", "Engine Schedule C depreciation total (reduces SE base / QBI)", ret.scheduleCDepreciation, {
        emphasis: true,
      }),
    );
    if (manualDep != null) {
      summary.push(
        checkLine(
          "Schedule C depreciation = manual adjustment + asset-register total",
          manualDep + (reg?.totalDepreciation ?? 0),
          ret.scheduleCDepreciation,
        ),
      );
    }
  }
  if (nz(ret.section179Applied) || nz(ret.bonusDepreciationApplied)) {
    summary.push(
      moneyLine(
        "",
        "Above-the-line §179 + bonus (aggregate adjustment channel — NOT in the Schedule C total)",
        ret.section179Applied + ret.bonusDepreciationApplied,
        { note: "Reduces AGI directly; does not reduce the SE-tax base, QBI, or earned income (engine convention for rental/pass-through property)." },
      ),
    );
  }
  parts.push({ title: "Part IV — Summary", lines: summary });

  footnotes.push(
    "Listed-property detail (official Part V) and amortization (Part VI) are not modeled; §280F passenger-auto caps apply only through the asset-register path (`isPassengerAuto`/`gvwrOver6000`/`businessUsePct`).",
    "TY2025 bonus is dual-rate by acquisition date (40% on/before 1/19/2025, 100% after — OBBBA §70301); the engine defaults conservatively to 40% unless the OBBBA flag/adjustment marks post-1/19/2025 property.",
    "Rental-property MACRS (residential 27.5-yr / commercial 39-yr straight-line) is computed per property on the Schedule E side and is NOT in this form's totals.",
    "The two §179 channels use different income-limit bases by engine convention: the asset register uses Sch C income + W-2 wages (Reg §1.179-2(c)(6)(iv)); the adjustment channel caps at net SE earnings (×0.9235).",
  );

  return {
    formId: "4562",
    formNumber: "Form 4562",
    title: "Depreciation and Amortization",
    subtitle: "Substitute workpaper — Schedule C asset register + aggregate adjustment channels (TY2024 layout)",
    taxYear: ret.taxYear,
    parts,
    footnotes,
  };
}
