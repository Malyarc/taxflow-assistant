/**
 * T2.1 — Form 8995 / Form 8995-A (Qualified Business Income Deduction, IRC
 * §199A) substitute workpaper (Pub 1167 conventions — CPA review copy, NOT a
 * filed form).
 *
 * Variant selection (per the T2.1 packet design):
 *   - "Form 8995-A" when the engine's §199A(b)(2)(B) wage/UBIA limit binds OR
 *     the engine produced per-business detail (`ret.qbiPerBusiness`) — renders
 *     a per-business Part II (lines 2/3/9/12 row-set per business) + Part IV.
 *     NOTE: `computeTaxReturnPure` emits per-business detail whenever any
 *     qualified business exists, so engine-produced returns with QBI render as
 *     8995-A; the simple variant covers aggregate-path (no-detail) returns.
 *   - "Form 8995" (simplified) otherwise: lines 1–15 of the TY2024 layout.
 *
 * Line numbers follow the official TY2024 forms:
 *   Form 8995:   1 (business rows) / 2 / 5 / 10 / 11 / 12 / 13 / 14 / 15.
 *   Form 8995-A: Part II lines 2, 3, 9, 12 (one row-set per business);
 *                Part IV lines 27, 32, 33, 34, 35, 36, 37, 39.
 *
 * Engine-exact: every dollar traces to ComputedTaxReturn (`ret.detail.qbi`,
 * `ret.qbiPerBusiness`, `ret.qbiDeduction`) or a documented derivation:
 *   - Line 11/33 "taxable income before QBI" is DERIVED as
 *     taxableIncome + qbiDeduction + obbbaSchedule1A.total (re-adding the two
 *     post-QBI subtractions; exact unless a zero-floor bound downstream).
 *   - Line 12/34 "net capital gain" (§199A(e)(3) = net LTCG + qualified divs)
 *     is DERIVED as preferentialIncome + investmentInterestElectionAmount
 *     (the §163(d)(4)(B) election re-buckets preferential income AFTER the
 *     §199A computation reads it, so re-adding it reproduces the engine input).
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

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Display-only mirror of taxCalculator's QBI_WAGE_LIMIT_BAND (§199A(e)(2)
 * threshold + phase-in band; Rev. Proc. 2023-34 / 2024-40 / 2025-32 + OBBBA
 * widened TY2026 band). Used ONLY for the phase-in position note — the binding
 * limit math is engine-computed. MFS = single per §199A(e)(2) (only a JOINT
 * return doubles the threshold).
 */
const QBI_PHASE_BAND: Record<number, Record<string, { start: number; end: number }>> = {
  2024: {
    single: { start: 191_950, end: 241_950 },
    head_of_household: { start: 191_950, end: 241_950 },
    married_filing_separately: { start: 191_950, end: 241_950 },
    married_filing_jointly: { start: 383_900, end: 483_900 },
    qualifying_widow: { start: 383_900, end: 483_900 },
  },
  2025: {
    single: { start: 197_300, end: 247_300 },
    head_of_household: { start: 197_300, end: 247_300 },
    married_filing_separately: { start: 197_300, end: 247_300 },
    married_filing_jointly: { start: 394_600, end: 494_600 },
    qualifying_widow: { start: 394_600, end: 494_600 },
  },
  2026: {
    single: { start: 201_750, end: 276_750 },
    head_of_household: { start: 201_750, end: 276_750 },
    married_filing_separately: { start: 201_750, end: 276_750 },
    married_filing_jointly: { start: 403_500, end: 553_500 },
    qualifying_widow: { start: 403_500, end: 553_500 },
  },
};

function phaseBandFor(taxYear: number, filingStatus: string): { start: number; end: number } {
  const year = Math.min(2026, Math.max(2024, taxYear));
  const byStatus = QBI_PHASE_BAND[year];
  return byStatus[filingStatus] ?? byStatus.single;
}

const fmtUsd = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function buildForm8995(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const q = ret.detail.qbi;

  // Applicable only when the engine produced a QBI deduction.
  if (!nz(ret.qbiDeduction)) return null;

  const perBiz = ret.qbiPerBusiness ?? [];
  const isVariantA = q.wageUbiaLimitBinds === true || perBiz.length > 0;

  // Derived bases (see header). Both exact engine reconstructions.
  const tiBeforeQbi = ret.taxableIncome + ret.qbiDeduction + ret.obbbaSchedule1A.total;
  const netCapGain = Math.max(0, ret.preferentialIncome + ret.investmentInterestElectionAmount);
  const tiLessNcg = Math.max(0, tiBeforeQbi - netCapGain);

  // TY2026+ OBBBA §199A(i) minimum deduction: ≥ $400 when active QBI ≥ $1,000.
  const sumPerBizDeductible = perBiz.reduce((s, b) => s + b.deductibleAmount, 0);
  const beforeFloor = isVariantA
    ? Math.min(sumPerBizDeductible, q.taxableIncomeCap)
    : Math.min(q.preliminaryDeduction, q.taxableIncomeCap);
  const floorFired = ret.taxYear >= 2026 && q.qbiAmount >= 1_000 && q.finalDeduction > beforeFloor + 0.005;

  // Phase-in band position (note only; the binding math is engine-side).
  const band = phaseBandFor(ret.taxYear, ret.filingStatus);
  const bandPosition =
    tiBeforeQbi <= band.start
      ? `below the §199A threshold (${fmtUsd(band.start)}) — wage/UBIA limit does not apply`
      : tiBeforeQbi >= band.end
        ? `above the §199A phase-in band top (${fmtUsd(band.end)}) — wage/UBIA limit fully applies`
        : `inside the §199A phase-in band (${fmtUsd(band.start)}–${fmtUsd(band.end)}) — wage/UBIA limit phased per Treas. Reg. §1.199A-1(d)(2)(iv)`;

  // SSTB disclosure (from inputs when available; engine applies the §199A(d)(3)
  // phase-out BEFORE the per-business QBI shown here).
  const sstbNames: string[] = [];
  if (inputs) {
    const schCSstb = (inputs.adjustments ?? []).some(
      (a) => a.adjustmentType === "qbi_sstb_flag" && a.isApplied !== false && toNum(a.amount) > 0,
    );
    if (schCSstb) sstbNames.push("Schedule C");
    for (const k of inputs.scheduleK1 ?? []) {
      if (k.taxYear === ret.taxYear && k.isSstb === true) {
        sstbNames.push(k.entityName?.trim() || "K-1 entity");
      }
    }
  }

  const footnotes: string[] = [
    "Qualified REIT dividends / PTP income (Form 8995 lines 6–9; Form 8995-A lines 28–31) are not modeled by the engine — those components are omitted.",
    "Negative-combined-QBI loss carryforwards (Form 8995 lines 16–17 / Form 8995-A line 40) are not tracked across years by the engine; a qualified business LOSS nets against positive QBI in the current year only.",
    "Per-business QBI shown is the ENGINE's post-§199A(d)(3)-SSTB-phase, post-loss-netting amount (Form 8995-A Schedule A netting is applied by proportional scale).",
    `Taxable-income position: taxable income before QBI ${fmtUsd(tiBeforeQbi)} is ${bandPosition}.`,
  ];
  if (sstbNames.length > 0) {
    footnotes.push(
      `SSTB (§199A(d)(2)) flagged for: ${sstbNames.join(", ")} — the engine phased that QBI over the band (fully excluded above the band top).`,
    );
  }
  if (floorFired) {
    footnotes.push(
      "OBBBA §199A(i) minimum deduction applied (TY2026+): active QBI ≥ $1,000 guarantees a deduction of at least $400, overriding the 20%/wage-limit/income-cap result.",
    );
  }

  // ── Variant A — Form 8995-A ────────────────────────────────────────────────
  if (isVariantA) {
    const partII: FormLine[] = [];
    perBiz.forEach((b, i) => {
      const label = b.label?.trim() || `Business ${i + 1}`;
      partII.push(moneyLine("2", `${label} — qualified business income`, b.qbiIncome));
      partII.push(moneyLine("3", `${label} — 20% of QBI (tentative)`, b.tentativeDeduction, { indent: 1 }));
      if (b.wageUbiaLimit > 0 || b.limitApplied) {
        partII.push(
          moneyLine("10", `${label} — wage/UBIA limit: greater of 50% W-2 wages or 25% wages + 2.5% UBIA`, b.wageUbiaLimit, {
            indent: 1,
            note: b.limitApplied
              ? "Limit reduced this business's deductible amount (phased per the §199A band)."
              : "Limit computed but not binding for this business.",
          }),
        );
      } else {
        partII.push(
          textLine("10", `${label} — wage/UBIA limit`, null, {
            indent: 1,
            note: "No W-2 wage / UBIA data supplied — engine leaves this business unlimited (CPA applies §199A(b)(2) externally).",
          }),
        );
      }
      partII.push(
        moneyLine("15", `${label} — QBI component after wage/UBIA limit`, b.deductibleAmount, { indent: 1, emphasis: true }),
      );
    });

    const partIV: FormLine[] = [
      moneyLine("27", "Total QBI component (Form 8995-A line 16 = sum of per-business line 15)", sumPerBizDeductible, { emphasis: true }),
      moneyLine("32", "QBI deduction before income limitation", sumPerBizDeductible, {
        note: "REIT/PTP component (lines 28–31) not modeled — line 32 = line 27.",
      }),
      moneyLine("33", "Taxable income before QBI deduction", tiBeforeQbi, {
        note: "Derived: Form 1040 line 15 + QBI deduction + OBBBA Schedule 1-A re-added.",
      }),
      moneyLine("34", "Net capital gain (net LTCG + qualified dividends, §199A(e)(3))", netCapGain, {
        note: "Pre-§163(d)(4)(B)-election figure (the §199A computation reads it before the election re-buckets).",
      }),
      moneyLine("35", "Line 33 minus line 34", tiLessNcg),
      moneyLine("36", "Income limitation — 20% of line 35", 0.20 * tiLessNcg),
      checkLine("Line 36 ties to engine taxable-income cap", 0.20 * tiLessNcg, q.taxableIncomeCap),
    ];
    if (floorFired) {
      partIV.push(
        moneyLine("", "OBBBA §199A(i) minimum deduction (TY2026+, active QBI ≥ $1,000)", 400, {
          note: "Floor overrides the smaller-of result below.",
        }),
      );
    }
    partIV.push(
      moneyLine("37", "QBI deduction — smaller of line 32 or line 36 (after any §199A(i) floor)", q.finalDeduction, {
        emphasis: true,
      }),
    );
    partIV.push(moneyLine("39", "Total QBI deduction (to Form 1040 line 13a)", q.finalDeduction, { emphasis: true }));
    partIV.push(
      checkLine(
        "Form 8995-A result ties to engine QBI deduction",
        floorFired ? Math.max(beforeFloor, 400) : beforeFloor,
        ret.qbiDeduction,
      ),
    );

    return {
      formId: "8995",
      formNumber: "Form 8995-A",
      title: "Qualified Business Income Deduction",
      subtitle: "Substitute workpaper — per-business §199A(b)(2)(B) wage/UBIA limit detail (TY2024 layout)",
      taxYear: ret.taxYear,
      parts: [
        { title: "Part II — Determine your adjusted QBI (one row-set per business)", lines: partII },
        { title: "Part IV — Determine your QBI deduction", lines: partIV },
      ],
      footnotes,
    };
  }

  // ── Simple variant — Form 8995 ─────────────────────────────────────────────
  const lines: FormLine[] = [
    moneyLine("1", "Qualified business income (engine aggregate — Sch C net of attributable ½-SE + K-1 §199A amounts)", q.qbiAmount),
    moneyLine("2", "Total qualified business income", q.qbiAmount, { emphasis: true }),
    moneyLine("5", "QBI component — 20% of line 2", q.preliminaryDeduction),
    moneyLine("10", "QBI deduction before income limitation", q.preliminaryDeduction, {
      note: "REIT/PTP component (lines 6–9) not modeled — line 10 = line 5.",
    }),
    moneyLine("11", "Taxable income before QBI deduction", tiBeforeQbi, {
      note: "Derived: Form 1040 line 15 + QBI deduction + OBBBA Schedule 1-A re-added.",
    }),
    moneyLine("12", "Net capital gain (net LTCG + qualified dividends, §199A(e)(3))", netCapGain),
    moneyLine("13", "Line 11 minus line 12", tiLessNcg),
    moneyLine("14", "Income limitation — 20% of line 13", 0.20 * tiLessNcg),
    checkLine("Line 14 ties to engine taxable-income cap", 0.20 * tiLessNcg, q.taxableIncomeCap),
  ];
  if (floorFired) {
    lines.push(
      moneyLine("", "OBBBA §199A(i) minimum deduction (TY2026+, active QBI ≥ $1,000)", 400, {
        note: "Floor overrides the smaller-of result below.",
      }),
    );
  }
  lines.push(
    moneyLine("15", "QBI deduction — smaller of line 10 or line 14 (after any §199A(i) floor)", q.finalDeduction, {
      emphasis: true,
    }),
  );
  lines.push(
    checkLine(
      "Form 8995 result ties to engine QBI deduction",
      floorFired ? Math.max(beforeFloor, 400) : beforeFloor,
      ret.qbiDeduction,
    ),
  );

  const parts: FormPart[] = [{ lines }];
  return {
    formId: "8995",
    formNumber: "Form 8995",
    title: "Qualified Business Income Deduction Simplified Computation",
    subtitle: "Substitute workpaper (TY2024 layout)",
    taxYear: ret.taxYear,
    parts,
    footnotes,
  };
}
