/**
 * T2.1 — MA Form 1 (Massachusetts Resident Income Tax Return) summary
 * workpaper.
 *
 * SUMMARY-WORKPAPER PHILOSOPHY (matches the CA/NY state group): the engine
 * exposes state AGGREGATES, not a per-line MA Part A/B/C income build-up.
 * This builder maps those aggregates onto the key official Form 1 lines
 * (TY2024 layout where stable), labels every approximation, and NEVER renders
 * a per-state refund — the engine settles the state side in AGGREGATE (see
 * the 1040 Reconciliation Worksheet Part 7).
 *
 * Line anchor (Form 1): line 22 "Tax on 5.0% income" — stable for years.
 * The 4% surtax (M.G.L. c.62 §4(b), the 2023+ "millionaire's tax") is FOLDED
 * into the engine's MA tax figure, so it is disclosed on the tax row rather
 * than rendered as a separate line (the official 28a/28b numbering shifted
 * when the surtax was added; we avoid pinning it).
 *
 * Applicability: resident MA, OR a non-resident MA row, OR part-year former
 * state MA.
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

export function buildMaForm1(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const resident = (ret.stateCode ?? "").toUpperCase() === "MA";
  const nrRow =
    ret.multiState.nonresidentStateTaxes.find((n) => n.state.toUpperCase() === "MA") ?? null;
  const former = (ret.formerStateCode ?? "").toUpperCase() === "MA";
  if (!resident && !nrRow && !former) return null;

  const base = {
    formId: "ma-form-1",
    formNumber: "MA Form 1",
    title: "Massachusetts Income Tax — Summary Workpaper",
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
          `Massachusetts non-resident tax${nrRow.reciprocityApplied ? " (reciprocity — MA does not tax)" : ""}`,
          nrRow.tax,
          {
            emphasis: true,
            note: "Engine applies MA's 5.0% flat rate directly to the MA-source income (conservative direct-bracket method; Form 1-NR/PY apportionment is the CPA's refinement).",
          },
        ),
        moneyLine("", "MA-source income (W-2 wages + CPA-sourced non-wage)", nrRow.wages, { indent: 1 }),
      );
    }
    if (former) {
      lines.push(
        moneyLine("", "Part-year former-state Massachusetts tax", ret.formerStateTax, {
          emphasis: true,
          note: "Engine pro-rates AGI by residency days; Form 1-NR/PY per-item sourcing is the CPA's refinement.",
        }),
        countLine("", "Days resident in Massachusetts (former state)", ret.daysFormerStateResident, { indent: 1 }),
      );
    }
    lines.push(settlementNote);
    return {
      ...base,
      subtitle: former && !nrRow ? "Part-year former-state Massachusetts" : "Non-resident Massachusetts (Form 1-NR/PY equivalent)",
      parts: [{ title: "Massachusetts tax included in the engine state total", lines }],
      footnotes: [
        "Summary workpaper — not a filed form. The engine computes MA as one component of the aggregate multi-state total; this page isolates the MA slice for review.",
      ],
    };
  }

  // ── Resident Form 1 ───────────────────────────────────────────────────────
  const taxLines: FormLine[] = [
    moneyLine("22", "Tax on 5.0% income (M.G.L. c.62 §4)", ret.multiState.residentStateTaxBeforeCredit, {
      note:
        "5.0% flat on the engine's MA base (federal AGI − taxable Social Security; MA exempts SS). INCLUDES the 4% surtax on taxable income over $1,053,750 (TY2024, M.G.L. c.62 §4(b) \"millionaire's tax\") when applicable — folded into this row, computed on state TAXABLE income per STL-03.",
    }),
  ];
  if (nz(ret.multiState.residentCreditApplied)) {
    taxLines.push(
      moneyLine("", "Credit for taxes paid to other jurisdictions (Schedule OJC)", -ret.multiState.residentCreditApplied, {
        note: "Engine cap: resident tax × (non-resident-source income ÷ AGI), limited to the actual non-resident tax.",
      }),
    );
    taxLines.push(
      moneyLine("", "Massachusetts tax after other-jurisdiction credit", ret.multiState.residentStateTax, {
        emphasis: true,
      }),
    );
  }
  if (nz(ret.stateRetirementExemption)) {
    // MA has no engine-modeled retirement exemption today; guarded for future.
    taxLines.push(
      moneyLine("", "State retirement-income exemption applied", ret.stateRetirementExemption, { indent: 1 }),
    );
  }
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
      moneyLine("", `Part-year former-state (${ret.formerStateCode}) tax (context)`, ret.formerStateTax, { indent: 1 }),
    );
  }
  const componentSum =
    ret.multiState.residentStateTax +
    ret.multiState.nonresidentStateTaxes.reduce((s, n) => s + n.tax, 0) +
    ret.formerStateTax;
  taxLines.push(
    checkLine("MA + other-state components tie to engine state tax (pre-additional-credit)", componentSum, ret.stateTaxLiability),
  );

  // ── Credits, penalty & payments ──
  const creditLines: FormLine[] = [];
  if (nz(ret.stateEitc.credit)) {
    creditLines.push(
      moneyLine("", "Massachusetts Earned Income Tax Credit", ret.stateEitc.credit, {
        note: "40% of the federal EITC (Ch. 50 Acts of 2023, TY2023+). Refundable — adds to the aggregate state settlement. Part-year proration not modeled.",
      }),
    );
  }
  if (nz(ret.stateAdditionalCreditsRefundable)) {
    creditLines.push(
      moneyLine("", "MA refundable credit package (Senior Circuit Breaker / Dependent Member of Household)", ret.stateAdditionalCreditsRefundable, {
        note:
          "Engine aggregate of the MA refundable additional credits: Senior Circuit Breaker (Schedule CB, cap $2,730 TY2024) + Dependent Member of Household ($310 per qualifying dependent, M.G.L. c.62 §6(x)). Adds to the aggregate state settlement.",
      }),
    );
  }
  if (nz(ret.stateAdditionalCreditsNonRefundable)) {
    creditLines.push(
      moneyLine("", "MA nonrefundable credit package (Limited Income Credit–NTS / Lead Paint)", ret.stateAdditionalCreditsNonRefundable, {
        note: "Engine aggregate (Schedule NTS-L Limited Income Credit / No Tax Status equivalent + Lead Paint Removal). Reduces the aggregate state tax (floored at $0).",
      }),
    );
  }
  if (nz(ret.stateIndividualMandatePenalty)) {
    const m = ret.stateMandate;
    creditLines.push(
      moneyLine("", "Health care penalty (Schedule HC, G.L. c.111M)", ret.stateIndividualMandatePenalty, {
        emphasis: true,
        note:
          `MA DOR TIR schedule (TIR 24-1 / TIR 25-1): per-ADULT monthly amount by income tier (% of FPL); no penalty at or below 150% FPL; ${m.monthsUninsured} uninsured months. Children are not penalized. Increases the balance due in the aggregate state settlement.`,
      }),
    );
  }
  creditLines.push(
    moneyLine("", "State income tax withheld (engine aggregate — all states)", ret.stateTaxWithheld, {
      note: "The engine tracks withholding in aggregate across states; MA-only withholding is the CPA's split.",
    }),
  );
  creditLines.push(settlementNote);

  return {
    ...base,
    subtitle: "Resident return — engine state aggregates mapped to MA Form 1",
    parts: [
      { title: "Part 1 — Massachusetts income tax (Form 1)", lines: taxLines },
      { title: "Part 2 — Credits, penalty & payments", lines: creditLines },
    ],
    footnotes: [
      "Summary workpaper — NOT a filed Form 1. The engine taxes a federal-AGI-proxy base at the 5.0% rate; MA's Part A/B/C income classes (12% short-term gains, interest/dividend schedule B) are not separately modeled.",
      "MA personal exemptions ($4,400 single / $6,800 HoH / $8,800 MFJ) and the No Tax Status thresholds are NOT subtracted from the engine's 5.0% base; the NTS/Limited Income Credit relief appears only via the nonrefundable additional-credit package when it fires.",
      "The 4% surtax on taxable income over $1,053,750 (TY2024) is folded into the tax row above, not rendered as the separate official surtax line (line numbering shifted when the surtax was added in 2023).",
      "No per-state refund is rendered: the engine settles state withholding, credits, and the mandate penalty in aggregate — see the 1040 Reconciliation Worksheet Part 7.",
    ],
  };
}
