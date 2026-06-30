/**
 * T2.1 — Schedule SE (Form 1040) substitute workpaper: Self-Employment Tax.
 * Pub 1167 substitute for CPA review — NOT a filed form. Line numbers per the
 * official TY2024 Schedule SE Part I.
 *
 * Engine model (taxReturnEngine.ts + taxCalculator.calculateSelfEmploymentTax,
 * exposed as ret.detail.se — SeTaxCalculation):
 *
 *   line 2/3  seIncomeReported     = Sch C net (floored at 0; or the Part II
 *                                    non-farm optional-method amount when
 *                                    elected) + K-1 partnership box 14A (or
 *                                    §707(c) GP if larger) + clergy housing
 *                                    (§1402(a)(8)) + church-employee income
 *   line 4a/4c netSeEarnings       = line 2/3 × 92.35% (no SE tax under $400;
 *                                    $100 floor when church income ≥ $108.28)
 *   line 7    SS wage base          ($168,600 TY2024 / $176,100 TY2025 /
 *                                    $184,500 TY2026)
 *   line 8a/8d W-2 SS wages         credited against the base (Box 3, falling
 *                                    back to Box 1) — derived here from the
 *                                    engine's remaining-base figure
 *   line 9    ssBaseAvailableForSe = max(0, line 7 − line 8d)
 *   line 10   socialSecurityPortion = 12.4% × min(line 4c/6, line 9)
 *   line 11   medicarePortion       = 2.9% × line 4c/6 (no cap)
 *   line 12   seTaxTotal            → Schedule 2 line 4 (== ret.selfEmploymentTax)
 *   line 13   deductibleHalf        → Schedule 1 line 15 (above-the-line)
 *
 * MFJ (E2): when any W-2 / 1099 / SE-income adjustment carries an explicit
 * spouse tag, the engine computes TWO per-spouse Schedule SEs and sums them —
 * lines 7–9 below are then aggregates across both forms (footnoted). MFJ
 * WITHOUT tagging conservatively applies NO W-2 SS-wage offset (line 8d = 0).
 */

import {
  checkLine,
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

/**
 * Social Security contribution & benefit base (Schedule SE line 7) by tax
 * year — DISPLAY constant only (builders may not import engine values; the
 * computation source of truth is taxCalculator.SS_WAGE_BASE, which these
 * mirror; scripts/src/tax-engine-year-coverage-tests.ts pins the engine's).
 * An unmapped year degrades loudly: lines 7/8d render as "not pinned" rather
 * than guessing — the engine-exact lines (2–4, 9–13) are unaffected.
 */
const SS_WAGE_BASE_BY_YEAR: Record<number, number> = {
  2024: 168600,
  2025: 176100,
  2026: 184500,
};

export function buildScheduleSE(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  if (!(ret.selfEmploymentTax > 0)) return null; // no SE tax → form not applicable
  const se = ret.detail.se;

  // ── Mirror the engine's applied-adjustment filter (isApplied !== false) ──
  const applied = (inputs?.adjustments ?? []).filter((a) => a.isApplied !== false);
  const sumAdj = (type: string): number =>
    applied
      .filter((a) => a.adjustmentType === type)
      .reduce((s, a) => s + toNum(a.amount), 0);

  const clergyHousing = inputs ? Math.max(0, sumAdj("clergy_housing_allowance")) : 0;
  const churchIncome = inputs ? Math.max(0, sumAdj("church_employee_income")) : 0;
  const seOptionalGross = inputs ? Math.max(0, sumAdj("se_optional_method_nonfarm")) : 0;
  const k1Se = ret.scheduleK1.totalSelfEmploymentEarnings;

  // ── MFJ per-spouse Schedule SE attribution gate (mirror of the engine's) ──
  const isMfjForSe =
    ret.filingStatus === "married_filing_jointly" || ret.filingStatus === "qualifying_widow";
  const hasSpouseTag =
    inputs != null &&
    ((inputs.w2s ?? []).some(
      (w) => (w.taxYear ?? ret.taxYear) === ret.taxYear && w.spouse === "spouse",
    ) ||
      (inputs.form1099s ?? []).some(
        (r) => (r.taxYear ?? ret.taxYear) === ret.taxYear && r.spouse === "spouse",
      ) ||
      applied.some(
        (a) =>
          a.adjustmentType === "self_employment_income" &&
          (a.spouse === "spouse" || a.spouse === "taxpayer"),
      ));
  const mfjPerSpouseSe = isMfjForSe && hasSpouseTag;
  /** Number of per-spouse Schedule SEs the engine aggregated into detail.se. */
  const nSchedSe = mfjPerSpouseSe ? 2 : 1;

  const ssBase: number | undefined = SS_WAGE_BASE_BY_YEAR[ret.taxYear];
  // The W-2 SS wages the ENGINE credited against the base (per spouse, each
  // capped at the base): line 7 × n − line 9. Derived from engine output so it
  // reflects what was actually applied — for untagged MFJ the engine applies
  // NO offset, so this correctly shows 0 even when W-2s exist (footnoted).
  const w2SsCredited = ssBase != null ? Math.max(0, ssBase * nSchedSe - se.ssBaseAvailableForSe) : null;
  // W-2 SS wages present on the return (for the untagged-MFJ disclosure).
  const w2SsEntered = (inputs?.w2s ?? [])
    .filter((w) => (w.taxYear ?? ret.taxYear) === ret.taxYear)
    .reduce(
      (s, w) =>
        s + (w.socialSecurityWagesBox3 != null ? toNum(w.socialSecurityWagesBox3) : toNum(w.wagesBox1)),
      0,
    );

  // ── Part I — Self-Employment Tax ──
  const lines: FormLine[] = [];
  lines.push(
    moneyLine(
      "2/3",
      "Net profit from Schedule C + Schedule K-1 (Form 1065) box 14 code A",
      se.seIncomeReported,
      {
        note: "No farm income modeled (lines 1a/1b) — line 3 = line 2. Components below where derivable.",
      },
    ),
  );
  // Component sub-rows (engine decomposition of the SE base).
  const schCPortionDerivable = inputs != null && !mfjPerSpouseSe && !nz(seOptionalGross) && k1Se >= 0;
  if (schCPortionDerivable) {
    const schCPortion = se.seIncomeReported - k1Se - clergyHousing - churchIncome;
    if (nz(schCPortion)) {
      lines.push(
        moneyLine("", "Schedule C net profit (floored at $0 — a loss does not enter)", schCPortion, {
          indent: 1,
        }),
      );
    }
  }
  if (nz(k1Se)) {
    lines.push(
      moneyLine("", "K-1 partnership box 14A SE earnings (or §707(c) guaranteed payments if larger)", k1Se, {
        indent: 1,
      }),
    );
  }
  if (nz(clergyHousing)) {
    lines.push(
      moneyLine("", "Clergy housing allowance (§1402(a)(8) — SE-taxable, income-tax-exempt)", clergyHousing, {
        indent: 1,
      }),
    );
  }
  if (nz(churchIncome)) {
    lines.push(
      moneyLine("", "Church-employee income (officially Sch SE lines 5a/5b — folded here)", churchIncome, {
        indent: 1,
      }),
    );
  }
  lines.push(
    moneyLine("4a/4c", "Net earnings from self-employment", se.netSeEarnings, {
      note: "Line 2/3 × 92.35%. Under $400 no SE tax is due ($100 floor when church-employee income ≥ $108.28) — this form only renders when SE tax is owed.",
    }),
  );

  if (ssBase != null) {
    lines.push(
      moneyLine("7", "Maximum income subject to the social security portion", ssBase, {
        note:
          mfjPerSpouseSe
            ? `Per Schedule SE. Two per-spouse Schedule SEs are aggregated below (combined maximum ${(ssBase * 2).toLocaleString("en-US", { style: "currency", currency: "USD" })}).`
            : undefined,
      }),
    );
  } else {
    lines.push(
      textLine("7", "Maximum income subject to the social security portion", null, {
        note: `(SS wage base for tax year ${ret.taxYear} not pinned in this workpaper — engine-exact lines 9–13 below are unaffected)`,
      }),
    );
  }
  if (w2SsCredited != null && nz(w2SsCredited)) {
    lines.push(
      moneyLine("8a/8d", "W-2 social security wages credited against the base", w2SsCredited, {
        note: "Derived: line 7 × (Schedule SE count) − line 9. The engine credits each filer's W-2 box 3 wages (box 1 fallback) against their own base, capped at the base. Unreported tips (Form 4137) / Form 8919 wages not modeled.",
      }),
    );
  }
  lines.push(
    moneyLine("9", "Social security base remaining for SE earnings", se.ssBaseAvailableForSe, {
      note:
        "Line 7 − line 8d, floored at $0." +
        (mfjPerSpouseSe ? " Aggregated across both spouses' Schedule SEs." : ""),
    }),
  );
  lines.push(
    moneyLine("10", "Social security portion", se.socialSecurityPortion, {
      note: "12.4% × the smaller of line 4c/6 or line 9 (applied per Schedule SE).",
    }),
  );
  lines.push(
    moneyLine("11", "Medicare portion", se.medicarePortion, {
      note: "2.9% × line 4c/6 — no wage-base cap.",
    }),
  );
  lines.push(
    moneyLine("12", "Self-employment tax", se.seTaxTotal, {
      emphasis: true,
      note: "→ Schedule 2 line 4.",
    }),
  );
  lines.push(checkLine("Line 10 + line 11 equals line 12", se.socialSecurityPortion + se.medicarePortion, se.seTaxTotal));
  lines.push(
    checkLine(
      "Line 12 equals the engine's self-employment tax (Schedule 2 line 4)",
      se.seTaxTotal,
      ret.selfEmploymentTax,
    ),
  );
  lines.push(
    moneyLine("13", "Deduction for one-half of self-employment tax", se.deductibleHalf, {
      note: "Line 12 × 50% → Schedule 1 line 15 (above-the-line deduction).",
    }),
  );

  // ── Footnotes ──
  const footnotes: string[] = [
    "Substitute form per IRS Pub 1167 conventions — CPA review workpaper, NOT for filing. Amounts are engine-exact (cents); the official form rounds to whole dollars.",
    "Not modeled: farm SE income (Schedule F / Sch SE lines 1a–1b), unreported tips (Form 4137, line 8b), Form 8919 wages (line 8c), and the farm optional method — the CPA supplies these in prep software.",
  ];
  if (mfjPerSpouseSe) {
    footnotes.push(
      "MFJ per-spouse attribution (E2): records tagged spouse=\"spouse\" give each spouse their OWN Schedule SE; the rows above are the SUM of the two forms. The line-10 \"smaller of line 4c/6 or line 9\" rule was applied per spouse — it may not reproduce from the aggregated display.",
    );
  }
  if (isMfjForSe && !mfjPerSpouseSe && w2SsEntered > 0) {
    footnotes.push(
      "MFJ without per-spouse tagging: the engine conservatively applies NO W-2 SS-wage offset on lines 8–9 (the full base is shown even though W-2 wages exist). Tag W-2s / 1099-NECs / SE-income adjustments with spouse=\"taxpayer\"/\"spouse\" to opt in to per-spouse Schedule SE (Part I line 9 sharing).",
    );
  }
  if (nz(clergyHousing)) {
    footnotes.push(
      "Clergy housing/parsonage allowance is income-tax-exempt (IRC §107) but IS net earnings from self-employment (§1402(a)(8)) — it is folded into line 2/3 above and never appears in AGI.",
    );
  }
  if (nz(churchIncome)) {
    footnotes.push(
      "Church-employee income (§3121(w) electing org): officially Sch SE lines 5a/5b (5b = 5a × 92.35%). The engine folds it into the ×92.35% base — identical arithmetic — and lowers the no-tax floor to $100 when such income is ≥ $108.28.",
    );
  }
  if (nz(seOptionalGross)) {
    footnotes.push(
      "Non-farm optional method elected (Sch SE Part II): the engine REPLACES the Schedule C net with the optional-method amount (Line 15 = ⅔ of gross nonfarm, capped at the year max) and enters it on line 4b WITHOUT the 92.35% factor — the ⅔ factor is itself the optional method's substitute for the net-earnings reduction (line 4c = line 4a + line 4b). Net earnings shown above reflect this.",
    );
  }

  return {
    formId: "schedule-se",
    formNumber: "Schedule SE (Form 1040)",
    title: "Self-Employment Tax",
    subtitle: "Part I — engine computation, substitute workpaper",
    taxYear: ret.taxYear,
    parts: [{ title: "Part I — Self-Employment Tax", lines }],
    footnotes,
  };
}
