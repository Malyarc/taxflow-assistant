/**
 * T2.1 — NJ-1040 (New Jersey Resident Income Tax Return) summary workpaper.
 *
 * SUMMARY-WORKPAPER PHILOSOPHY (matches the CA/NY state group): the engine
 * exposes state AGGREGATES (multiState breakdown, state EITC/CTC, the
 * additional-credit package, the mandate penalty) — NOT a per-line NJ gross
 * income tax computation. This builder maps those aggregates onto the key
 * official NJ-1040 lines (TY2024 layout) honestly, labels every approximation,
 * and NEVER renders a per-state refund — the engine settles the state side in
 * AGGREGATE across all states (see the 1040 Reconciliation Worksheet Part 7).
 *
 * Line anchors (NJ-1040 TY2024): 15 wages; 28a pension/retirement exclusion;
 * 42 tax; 43 credit for income taxes paid to other jurisdictions; 44 balance
 * of tax; 53c shared responsibility payment; 55 NJ income tax withheld;
 * 56 property tax credit; 58 NJ EITC; 59–61 excess UI/SDI/FLI; 64 NJ CTC.
 *
 * Applicability: resident NJ, OR a non-resident NJ row in
 * multiState.nonresidentStateTaxes, OR part-year former-state NJ.
 */

import {
  checkLine,
  countLine,
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

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function buildNj1040(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const resident = (ret.stateCode ?? "").toUpperCase() === "NJ";
  const nrRow =
    ret.multiState.nonresidentStateTaxes.find((n) => n.state.toUpperCase() === "NJ") ?? null;
  const former = (ret.formerStateCode ?? "").toUpperCase() === "NJ";
  if (!resident && !nrRow && !former) return null;

  const base = {
    formId: "nj-1040",
    formNumber: "NJ-1040",
    title: "New Jersey Income Tax — Summary Workpaper",
    taxYear: ret.taxYear,
  };

  const settlementNote = textLine(
    "",
    "Per-state refund/balance NOT rendered",
    null,
    {
      note:
        "The engine settles the state side in AGGREGATE across all states (withheld − tax + credits − penalty). Trace the settlement in the 1040 Reconciliation Worksheet, Part 7.",
    },
  );

  // ── Non-resident-only / former-state-only variants ────────────────────────
  if (!resident) {
    const lines: FormLine[] = [];
    if (nrRow) {
      lines.push(
        moneyLine(
          "",
          `New Jersey non-resident tax${nrRow.reciprocityApplied ? " (reciprocity — NJ does not tax)" : ""}`,
          nrRow.tax,
          {
            emphasis: true,
            note:
              "NJ-1040NR method (a): tax-as-if-full-year-resident on TOTAL income × (NJ-source ÷ total income). Verified against the NJ-1040NR Line 40/41/42 chain.",
          },
        ),
        moneyLine("", "NJ-source income (W-2 wages + CPA-sourced non-wage)", nrRow.wages, {
          indent: 1,
        }),
      );
    }
    if (former) {
      lines.push(
        moneyLine("", "Part-year former-state New Jersey tax", ret.formerStateTax, {
          emphasis: true,
          note: "Engine pro-rates AGI by residency days; NJ-1040 part-year per-item sourcing is the CPA's refinement.",
        }),
        countLine("", "Days resident in New Jersey (former state)", ret.daysFormerStateResident, {
          indent: 1,
        }),
      );
    }
    lines.push(settlementNote);
    return {
      ...base,
      subtitle: former && !nrRow ? "Part-year former-state New Jersey" : "Non-resident New Jersey (NJ-1040NR equivalent)",
      parts: [{ title: "New Jersey tax included in the engine state total", lines }],
      footnotes: [
        "Summary workpaper — not a filed form. The engine computes NJ as one component of the aggregate multi-state total; this page isolates the NJ slice for review.",
        "State withholding is tracked in aggregate across all states; see the resident-state workpaper / Reconciliation Worksheet Part 7 for the settlement.",
      ],
    };
  }

  // ── Resident NJ-1040 ──────────────────────────────────────────────────────
  const taxLines: FormLine[] = [];

  // Line 15 — wages (info row from input W-2s; the engine's NJ base is a
  // federal-AGI proxy, so this is presented for review context only).
  const w2Wages = (inputs?.w2s ?? [])
    .filter((w) => (w.taxYear ?? ret.taxYear) === ret.taxYear)
    .reduce((s, w) => s + toNum(w.wagesBox1), 0);
  if (nz(w2Wages)) {
    taxLines.push(
      moneyLine("15", "Wages, salaries, tips (all W-2s — info)", w2Wages, {
        indent: 1,
        note: "Info only. The engine's NJ tax base is a federal-AGI proxy, not the NJ per-category gross-income build-up.",
      }),
    );
  }

  // Line 28a — pension/retirement exclusion (engine's state retirement
  // exemption for NJ: capped by status, phased out on NJ gross income).
  if (nz(ret.stateRetirementExemption)) {
    taxLines.push(
      moneyLine("28a", "Pension/retirement exclusion (N.J.S.A. 54A:6-10/-15)", ret.stateRetirementExemption, {
        note: "Engine applies the status-capped NJ pension exclusion with the NJ-gross-income phase-out (approximated as federal AGI − taxable Social Security).",
      }),
    );
  }

  // Line 42 — tax (before the other-jurisdiction credit).
  taxLines.push(
    moneyLine("42", "New Jersey gross income tax (before other-jurisdiction credit)", ret.multiState.residentStateTaxBeforeCredit, {
      note:
        "Graduated NJ rates on the engine base: federal AGI − personal exemptions ($1,000 filer / $2,000 MFJ + $1,500 per dependent, N.J.S.A. 54A:3-1) − retirement exclusion − taxable Social Security (NJ exempts SS).",
    }),
  );
  if (nz(ret.multiState.residentCreditApplied)) {
    taxLines.push(
      moneyLine("43", "Credit for income taxes paid to other jurisdictions", -ret.multiState.residentCreditApplied, {
        note: "Engine cap: resident tax × (non-resident-source income ÷ AGI), limited to the actual non-resident tax.",
      }),
    );
    taxLines.push(
      moneyLine("44", "Balance of tax (resident NJ tax after credit)", ret.multiState.residentStateTax, {
        emphasis: true,
      }),
    );
  }

  // Other-state context rows so the engine-total tie-out below is visible.
  for (const nr of ret.multiState.nonresidentStateTaxes) {
    taxLines.push(
      moneyLine(
        "",
        `Non-resident ${nr.state} tax${nr.reciprocityApplied ? " (reciprocity)" : ""} (context — engine state total includes it)`,
        nr.tax,
        { indent: 1 },
      ),
    );
  }
  if (ret.formerStateCode && nz(ret.formerStateTax)) {
    taxLines.push(
      moneyLine("", `Part-year former-state (${ret.formerStateCode}) tax (context)`, ret.formerStateTax, {
        indent: 1,
      }),
    );
  }
  const componentSum =
    ret.multiState.residentStateTax +
    ret.multiState.nonresidentStateTaxes.reduce((s, n) => s + n.tax, 0) +
    ret.formerStateTax;
  taxLines.push(
    checkLine("NJ + other-state components tie to engine state tax (pre-additional-credit)", componentSum, ret.stateTaxLiability),
  );

  // ── Credits, penalty & payments ──
  const creditLines: FormLine[] = [];
  if (nz(ret.stateIndividualMandatePenalty)) {
    const m = ret.stateMandate;
    creditLines.push(
      moneyLine("53c", "Shared Responsibility Payment (NJ individual mandate)", ret.stateIndividualMandatePenalty, {
        emphasis: true,
        note:
          `Method "${m.method}" bound — frozen 2018 federal amounts per N.J.S.A. 54A:11: greater of flat $695/adult + $347.50/child (max $2,085) or 2.5% of income over the NJ filing threshold ($10k single/MFS, $20k others), capped at the statewide average bronze premium; prorated ${m.monthsUninsured}/12 months. ` +
          `Flat ${fmtUsd(m.flatAmount)} vs percentage ${fmtUsd(m.percentageAmount)} vs bronze cap ${fmtUsd(m.bronzeCapAmount)}. Increases the balance due in the aggregate state settlement.`,
      }),
    );
  }
  if (nz(ret.stateEitc.credit)) {
    creditLines.push(
      moneyLine("58", "New Jersey Earned Income Tax Credit", ret.stateEitc.credit, {
        note: "40% of the federal EITC (NJ-1040 Line 58, since TY2020). Refundable — adds to the aggregate state settlement.",
      }),
    );
  }
  if (nz(ret.stateChildTaxCredit)) {
    creditLines.push(
      moneyLine("64", "New Jersey Child Tax Credit", ret.stateChildTaxCredit, {
        note: "$1,000 per child under 6, phased out $50k→$80k NJ income. Refundable.",
      }),
    );
  }
  if (nz(ret.stateAdditionalCreditsRefundable)) {
    creditLines.push(
      moneyLine("56", "NJ refundable credit package (property tax credit / NJ-CDCC)", ret.stateAdditionalCreditsRefundable, {
        note:
          "Engine aggregate of the NJ refundable additional credits: $50 property tax credit (N.J.S.A. 54A:3A-15 base credit; the alternative full property-tax deduction is not modeled) + NJ child & dependent care credit (% of federal CDCC by NJ income). Adds to the aggregate state settlement.",
      }),
    );
  }
  if (nz(ret.stateAdditionalCreditsNonRefundable)) {
    creditLines.push(
      moneyLine("", "NJ nonrefundable credit package (senior/disabled property-tax deduction equivalent)", ret.stateAdditionalCreditsNonRefundable, {
        note: "Reduces the aggregate state tax (floored at $0) in the engine settlement.",
      }),
    );
  }
  creditLines.push(
    textLine("59–61", "Excess UI/WF/SWF, SDI, FLI withholding credits", null, {
      note: "(not modeled — CPA supplies from the W-2 box 14 / NJ-2450 detail)",
    }),
  );
  creditLines.push(
    moneyLine("55", "State income tax withheld (engine aggregate — all states)", ret.stateTaxWithheld, {
      note: "The engine tracks withholding in aggregate across states; NJ-only withholding is the CPA's split.",
    }),
  );
  creditLines.push(settlementNote);

  return {
    ...base,
    subtitle: "Resident return — engine state aggregates mapped to key NJ-1040 lines",
    parts: [
      { title: "Part 1 — New Jersey gross income tax", lines: taxLines },
      { title: "Part 2 — Credits, penalty & payments", lines: creditLines },
    ],
    footnotes: [
      "Summary workpaper — NOT a filed NJ-1040. The engine models NJ on a federal-AGI-proxy base; NJ's per-category gross-income system (e.g. the 2%-floor medical deduction, NJ-source K-1 categories) is not separately computed.",
      "Personal exemptions modeled: $1,000 filer / $2,000 MFJ + $1,500 per dependent (N.J.S.A. 54A:3-1). NOT modeled: the additional $1,000 for 65+/blind/disabled and the $1,500 college-student dependent exemption.",
      "NJ Child Tax Credit: the engine passes children-under-6 = 0 (the schema lacks per-child ages), so Line 64 is typically $0 — the CPA supplies it when a child under 6 qualifies.",
      "NJ EITC: the engine requires federal EITC eligibility; NJ's 18+/65+ childless expansion is not modeled (enter as a manual credit adjustment).",
      "Excess UI/SDI/FLI withholding credits (Lines 59–61) are not modeled.",
      "No per-state refund is rendered: the engine settles state withholding, credits, and the mandate penalty in aggregate — see the 1040 Reconciliation Worksheet Part 7.",
    ],
  };
}
