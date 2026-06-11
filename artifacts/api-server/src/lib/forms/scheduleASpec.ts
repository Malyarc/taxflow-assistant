/**
 * T2.1 — Schedule A (Form 1040): Itemized Deductions, rendered as a CPA
 * review workpaper from the engine's `ret.scheduleA` (ScheduleACalculation)
 * plus the §163(d) investment-interest line and (when available) the
 * adjustment-level gross inputs.
 *
 * Line numbers follow the official TY2024 Schedule A:
 *   1–4    Medical and Dental Expenses (7.5%-of-AGI floor, §213(a))
 *   5a–5e, 7  Taxes You Paid (SALT, §164 cap: TCJA $10k/$5k-MFS TY2024;
 *             OBBBA §164(b)(7) $40k TY2025 / $40.4k TY2026+, MFS half,
 *             30% phase-down above $500k MAGI to a $10k floor)
 *   8a–8e, 9, 10  Interest You Paid (mortgage + Form 4952 investment interest)
 *   11–14  Gifts to Charity (§170(b) AGI caps; cash carryforward §170(d)(1))
 *   17     Total itemized deductions
 *
 * Engine-tie guarantees (verified against taxReturnEngine.ts 2026-06-09):
 *   - The medical floor was computed against the SAME AGI the engine reports
 *     (`provisionalAgi` == `calc.adjustedGrossIncome` — identical formula and
 *     inputs), so line 3 = ret.adjustedGrossIncome × 7.5% ties exactly.
 *   - Line 17 = scheduleA.totalItemized + ret.investmentInterestDeduction
 *     (the engine folds Form 4952 investment interest into the itemized total
 *     OUTSIDE the ScheduleACalculation struct).
 *   - ret.itemizedDeductions (when non-null) = max(line 17, legacy
 *     single-number override) — a difference is disclosed, never hidden.
 *
 * Applicability: ret.scheduleA.totalItemized > 0. When the standard deduction
 * was selected the form still renders in COMPARISON mode with a prominent
 * footnote (CPAs want to see how close the client was to itemizing).
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

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function buildScheduleA(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const a = ret.scheduleA;
  // M9 (audit 2026-06-11): also render when the engine USED an itemized
  // deduction even though scheduleA.totalItemized is 0 — the legacy
  // single-number override and the §163(d)-investment-interest-only itemizer
  // both have Form 1040 line 12 reading "Itemized deductions (Schedule A)",
  // so the packet must contain a Schedule A (the election section below
  // discloses the override delta). Standard-deduction returns with nothing
  // itemizable still return null.
  if (!nz(a.totalItemized) && ret.itemizedDeductions == null) return null;

  // Gross (pre-limit) adjustment inputs — null when the input facts were not
  // supplied to the builder (aggregate-only rendering). Mirrors the engine's
  // sumByType over applied adjustments (taxReturnEngine.ts isApplied !== false).
  const sumAdj = (type: string): number | null => {
    if (!inputs) return null;
    let s = 0;
    for (const adj of inputs.adjustments) {
      if (adj.isApplied === false) continue;
      if (adj.adjustmentType === type) s += toNum(adj.amount);
    }
    return s;
  };

  const footnotes: string[] = [];
  const standardChosen = ret.itemizedDeductions == null;

  // ── Medical and Dental Expenses (lines 1–4) ──
  const medicalRaw = sumAdj("medical_expenses");
  const agi = ret.adjustedGrossIncome;
  const medicalFloor = agi * 0.075; // §213(a): 7.5% of AGI
  const medicalLines: FormLine[] = [];
  if (nz(medicalRaw ?? 0) || nz(a.medicalDeductible)) {
    if (medicalRaw != null) {
      medicalLines.push(moneyLine("1", "Medical and dental expenses paid", medicalRaw));
    }
    medicalLines.push(moneyLine("2", "Adjusted gross income (Form 1040 line 11)", agi));
    medicalLines.push(
      moneyLine("3", "Multiply line 2 by 7.5% (0.075)", medicalFloor, {
        note: "§213(a) AGI floor — only expenses above this are deductible",
      }),
    );
    medicalLines.push(
      moneyLine("4", "Deductible medical — line 1 minus line 3 (not less than 0)", a.medicalDeductible, {
        emphasis: true,
      }),
    );
    if (medicalRaw != null) {
      medicalLines.push(
        checkLine("Line 4 ties: max(0, line 1 − line 3)", Math.max(0, medicalRaw - medicalFloor), a.medicalDeductible),
      );
    }
  }

  // ── Taxes You Paid (lines 5a–5e, 7) ──
  const incomeTaxRaw = sumAdj("state_income_tax");
  const salesTaxRaw = sumAdj("state_sales_tax");
  const propertyTaxRaw = sumAdj("state_property_tax");
  const saltLines: FormLine[] = [];
  if (nz(a.saltUncapped) || nz(a.saltDeductible)) {
    if (incomeTaxRaw != null && salesTaxRaw != null) {
      const salesWins = salesTaxRaw > incomeTaxRaw;
      const line5a = Math.max(incomeTaxRaw, salesTaxRaw);
      if (nz(line5a)) {
        saltLines.push(
          moneyLine(
            "5a",
            salesWins
              ? "State and local GENERAL SALES taxes (box checked — elected in lieu of income taxes)"
              : "State and local income taxes",
            line5a,
            nz(incomeTaxRaw) && nz(salesTaxRaw)
              ? { note: `Greater of income tax ${usd(incomeTaxRaw)} vs. general sales tax ${usd(salesTaxRaw)}` }
              : {},
          ),
        );
      }
      if (propertyTaxRaw != null && nz(propertyTaxRaw)) {
        saltLines.push(
          moneyLine("5b", "State and local real estate taxes", propertyTaxRaw, {
            note: "Engine carries all property tax here — a personal-property portion (line 5c) is not split out",
          }),
        );
      }
    }
    saltLines.push(moneyLine("5d", "Add lines 5a through 5c (SALT before cap)", a.saltUncapped));
    if (incomeTaxRaw != null && salesTaxRaw != null && propertyTaxRaw != null) {
      saltLines.push(
        checkLine(
          "Line 5d ties: max(income, sales) + property taxes",
          Math.max(incomeTaxRaw, salesTaxRaw) + propertyTaxRaw,
          a.saltUncapped,
        ),
      );
    }
    const capBinds = a.saltDeductible < a.saltUncapped - 0.005;
    const capNote =
      ret.taxYear <= 2024
        ? "§164(b)(6) TCJA cap: $10,000 ($5,000 MFS)"
        : "OBBBA §164(b)(7) cap: $40,000 TY2025 / $40,400 TY2026+ ($20,000/$20,200 MFS), phased down 30% of MAGI over $500k to a $10,000 floor";
    saltLines.push(
      moneyLine("5e", "Smaller of line 5d or the SALT cap", a.saltDeductible, {
        emphasis: true,
        note: capBinds ? `${capNote} — cap BINDS: ${usd(a.saltUncapped - a.saltDeductible)} of SALT is nondeductible` : capNote,
      }),
    );
    saltLines.push(
      moneyLine("7", "Total taxes paid — add lines 5e and 6", a.saltDeductible, {
        note: "Line 6 (other taxes) not modeled by the engine",
      }),
    );
  }

  // ── Interest You Paid (lines 8a–10) ──
  const invInt = ret.investmentInterestDeduction;
  const interestLines: FormLine[] = [];
  if (nz(a.mortgageDeductible) || nz(invInt)) {
    if (nz(a.mortgageDeductible)) {
      interestLines.push(
        moneyLine("8a", "Home mortgage interest and points reported on Form 1098", a.mortgageDeductible, {
          note: "§163(h)(3) $750k acquisition-debt limit NOT engine-enforced — CPA verifies",
        }),
      );
      interestLines.push(moneyLine("8e", "Add lines 8a through 8c", a.mortgageDeductible));
    }
    if (nz(invInt)) {
      const electionNote =
        ret.investmentInterestElectionAmount > 0
          ? `; includes a §163(d)(4)(B) election treating ${usd(ret.investmentInterestElectionAmount)} of QDIV/LTCG as ordinary investment income`
          : "";
      interestLines.push(
        moneyLine("9", "Investment interest (attach Form 4952)", invInt, {
          note: `§163(d) — allowed up to net investment income${electionNote}`,
        }),
      );
    }
    interestLines.push(
      moneyLine("10", "Total interest paid — add lines 8e and 9", a.mortgageDeductible + invInt, {
        emphasis: true,
      }),
    );
  }
  if (nz(ret.investmentInterestDisallowed)) {
    footnotes.push(
      `Investment interest of ${usd(ret.investmentInterestDisallowed)} was DISALLOWED by the §163(d)(1) net-investment-income limit and carries forward indefinitely (§163(d)(2); Form 4952 line 7).`,
    );
  }

  // ── Gifts to Charity (lines 11–14) ──
  const cashRaw = sumAdj("charitable_cash");
  const propRaw = sumAdj("charitable_property");
  const carryRaw = sumAdj("charitable_carryforward_cash");
  const giftLines: FormLine[] = [];
  if (nz(a.charitableDeductible) || nz(cashRaw ?? 0) || nz(propRaw ?? 0) || nz(carryRaw ?? 0)) {
    const rawKnown = cashRaw != null && propRaw != null && carryRaw != null;
    const rawTotal = (cashRaw ?? 0) + (propRaw ?? 0) + (carryRaw ?? 0);
    // Each applied bucket is ≤ its gross input, so (sum applied == sum gross)
    // ⟺ no AGI cap bound anywhere ⟺ the gross inputs ARE the per-line split.
    const splitKnown = rawKnown && Math.abs(rawTotal - a.charitableDeductible) < 0.01;
    if (splitKnown) {
      if (nz(cashRaw ?? 0)) giftLines.push(moneyLine("11", "Gifts by cash or check", cashRaw ?? 0));
      if (nz(propRaw ?? 0)) {
        giftLines.push(
          moneyLine("12", "Gifts other than by cash or check", propRaw ?? 0, {
            note: "Form 8283 required when over $500 (not generated by the engine)",
          }),
        );
      }
      if (nz(carryRaw ?? 0)) {
        giftLines.push(moneyLine("13", "Carryover from prior year (§170(d)(1) cash carryforward)", carryRaw ?? 0));
      }
      giftLines.push(moneyLine("14", "Total gifts — add lines 11 through 13", a.charitableDeductible, { emphasis: true }));
      giftLines.push(
        checkLine("Line 14 ties: lines 11 + 12 + 13 (no AGI cap bound)", rawTotal, a.charitableDeductible),
      );
    } else {
      giftLines.push(
        moneyLine("14", "Total gifts to charity (after §170(b) AGI limits)", a.charitableDeductible, {
          emphasis: true,
          note: "Engine applies the 60%-cash / 30%-property / 50%-overall AGI caps; the official line 11/12/13 split of the LIMITED amount is not exposed",
        }),
      );
      if (rawKnown) {
        if (nz(cashRaw ?? 0)) {
          giftLines.push(
            moneyLine("", "Gross cash gifts before AGI limits (informational)", cashRaw ?? 0, { indent: 1 }),
          );
        }
        if (nz(propRaw ?? 0)) {
          giftLines.push(
            moneyLine("", "Gross non-cash gifts before AGI limits (informational)", propRaw ?? 0, { indent: 1 }),
          );
        }
        if (nz(carryRaw ?? 0)) {
          giftLines.push(
            moneyLine("", "Prior-year cash carryforward available (informational)", carryRaw ?? 0, { indent: 1 }),
          );
        }
        footnotes.push(
          "A §170(b) AGI cap bound this year, so the gifts section shows the engine's limited total (line 14) with the gross contributions as informational rows — the official per-line split of the limited amount is not modeled.",
        );
      }
    }
  }
  if (nz(a.charitableCarryforwardCashRemaining)) {
    footnotes.push(
      `Cash charitable contributions of ${usd(a.charitableCarryforwardCashRemaining)} exceed this year's AGI ceiling and carry forward up to 5 years (§170(d)(1)). NOTE: the engine tracks only the CASH carryforward — any excess PROPERTY contribution is not carried (documented engine simplification).`,
    );
  }

  // ── Total (line 17) ──
  const line17 = a.medicalDeductible + a.saltDeductible + a.mortgageDeductible + invInt + a.charitableDeductible;
  const totalLines: FormLine[] = [
    moneyLine("17", "Total itemized deductions — add lines 4, 7, 10, and 14", line17, { emphasis: true }),
    checkLine(
      "Line 17 ties: engine Schedule A total + Form 4952 investment interest",
      line17,
      a.totalItemized + invInt,
    ),
  ];

  // ── Deduction election (workpaper comparison) ──
  const electionLines: FormLine[] = [
    moneyLine("", "Standard deduction available (incl. any age-65/blind add-on)", ret.standardDeduction),
    moneyLine("", "Schedule A itemized total (line 17)", line17),
  ];
  if (!standardChosen) {
    const used = ret.itemizedDeductions ?? 0;
    electionLines.push(
      moneyLine("12", "Deduction used on Form 1040 line 12 — ITEMIZED", used, { emphasis: true }),
    );
    if (Math.abs(used - line17) < 0.01) {
      electionLines.push(checkLine("Form 1040 line 12 ties to Schedule A line 17", line17, used));
    } else {
      electionLines.push(
        textLine("", "Form 1040 line 12 EXCEEDS this Schedule A computation", `${usd(used - line17)} higher`, {
          note: "Legacy single-number itemized override in effect — the engine uses max(Schedule A total, override)",
        }),
      );
      footnotes.push(
        `Form 1040 line 12 (${usd(used)}) reflects the legacy single-number itemized override, which exceeds the Schedule A computation (${usd(line17)}). The per-line detail above covers only the Schedule A portion.`,
      );
    }
  } else {
    electionLines.push(
      moneyLine("12", "Deduction used on Form 1040 line 12 — STANDARD", ret.standardDeduction, { emphasis: true }),
    );
  }

  if (standardChosen) {
    footnotes.unshift(
      `STANDARD DEDUCTION WAS SELECTED (${usd(ret.standardDeduction)} vs. itemized ${usd(line17)}) — this Schedule A is shown for COMPARISON ONLY and is not part of the computed return.`,
    );
  }
  if (!inputs) {
    footnotes.push(
      "Adjustment-level inputs were not supplied to the workpaper builder — gross medical/SALT/charitable detail is omitted; all deductible amounts remain engine-exact.",
    );
  }
  footnotes.push(
    "Not modeled by the engine: line 5c personal property taxes (all property tax renders on 5b), line 6 other taxes, lines 8b/8c (non-1098 mortgage interest and points are not split out), the §163(h)(3) $750k acquisition-debt limit, line 15 casualty/theft losses, and line 16 other itemized deductions.",
  );

  const parts: FormPart[] = [];
  if (medicalLines.length > 0) parts.push({ title: "Medical and Dental Expenses (lines 1–4)", lines: medicalLines });
  if (saltLines.length > 0) parts.push({ title: "Taxes You Paid (lines 5–7)", lines: saltLines });
  if (interestLines.length > 0) parts.push({ title: "Interest You Paid (lines 8–10)", lines: interestLines });
  if (giftLines.length > 0) parts.push({ title: "Gifts to Charity (lines 11–14)", lines: giftLines });
  parts.push({ title: "Total Itemized Deductions (line 17)", lines: totalLines });
  parts.push({ title: "Deduction election (workpaper comparison)", lines: electionLines });

  return {
    formId: "schedule-a",
    formNumber: "Schedule A (Form 1040)",
    title: "Itemized Deductions",
    subtitle: standardChosen ? "Comparison only — the standard deduction was used on this return" : undefined,
    taxYear: ret.taxYear,
    parts,
    footnotes,
  };
}
