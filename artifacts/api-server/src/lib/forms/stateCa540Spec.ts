/**
 * T2.1 — CA Form 540 SUMMARY workpaper (state-ca-ny group).
 *
 * IMPORTANT: this is a SUMMARY-STYLE state workpaper, NOT a full Form 540
 * reproduction. The engine computes California tax internally as
 * `brackets(federal AGI − CA standard deduction)` (+ the 1% Mental Health
 * Services surtax over $1M taxable and the Schedule P 540 AMT delta when AMT
 * preferences exist) and exposes AGGREGATES — there is no per-line Schedule CA
 * (540) conformity model. We therefore render only the official form's KEY
 * lines, each traced to an engine output field, with the summary nature
 * disclosed prominently.
 *
 * Official line references are the TY2024 CA Form 540:
 *   13  Federal AGI                      31  Tax (Rate Schedule X/Y/Z)
 *   14  Sch CA(540) subtractions         32  Exemption credits
 *   18  Standard/itemized deduction      61  AMT (Schedule P 540)
 *   19  Taxable income                   62  Mental Health Services Tax
 *   64  Total tax                        71  CA income tax withheld
 *   75  CalEITC (FTB 3514)               76  Young Child Tax Credit
 *   92  Individual Shared Responsibility Penalty (FTB 3853)
 *
 * Applicability: resident state CA, OR part-year former state CA, OR a CA
 * entry in the non-resident state-tax table. Otherwise null.
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

export function buildCa540(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;

  const residentCode = (ret.stateCode ?? "").toUpperCase();
  const isResident = residentCode === "CA";
  const isFormer = (ret.formerStateCode ?? "").toUpperCase() === "CA";
  const nrEntry = ret.multiState.nonresidentStateTaxes.find(
    (n) => (n.state ?? "").toUpperCase() === "CA",
  );
  if (!isResident && !isFormer && !nrEntry) return null;

  const partYear = ret.multiState.partYearResidency != null;
  const otherStatesInvolved =
    ret.multiState.nonresidentStateTaxes.length > 0 || ret.formerStateCode != null;

  // ── Part 1 — Income & AGI (Form 540 lines 13–19) ──────────────────────────
  const incomeLines: FormLine[] = [
    moneyLine("13", "Federal adjusted gross income (Form 1040 line 11)", ret.adjustedGrossIncome, {
      emphasis: true,
    }),
  ];
  if (isResident && nz(ret.stateRetirementExemption)) {
    // CA has no general retirement exclusion in the engine's table (PA/IL/MS/
    // HI/NJ/NY do); rendered only if the engine ever reports one for CA.
    incomeLines.push(
      moneyLine("14", "State retirement-income exemption (subtraction)", ret.stateRetirementExemption, {
        indent: 1,
        note: "Engine state-model subtraction — Sch CA (540) Part I col B analog.",
      }),
    );
  }
  if (isResident && nz(ret.socialSecurityTaxable)) {
    incomeLines.push(
      moneyLine("14", "Taxable Social Security excluded from CA income (subtraction)", ret.socialSecurityTaxable, {
        indent: 1,
        note: "California does not tax Social Security (R&TC §17087) — the engine subtracts the federally-taxable amount from the CA base. Sch CA (540) line 14 col B.",
      }),
    );
  }
  incomeLines.push(
    textLine("18", "CA standard deduction", null, {
      note: "(not exposed as an output field — the engine nets the CA standard deduction inside its state model: CA tax = FTB brackets(federal AGI − CA std ded). CA itemized deductions are NOT modeled.)",
    }),
    textLine("19", "CA taxable income", null, {
      note: "(not exposed — see line 18 note; the engine reports only the resulting tax.)",
    }),
  );

  // ── Part 2 — Tax (Form 540 lines 31–64) ────────────────────────────────────
  const taxLines: FormLine[] = [];
  let caTaxTotal = 0;
  if (isResident) {
    const beforeCredit = ret.multiState.residentStateTaxBeforeCredit;
    const credit = ret.multiState.residentCreditApplied;
    if (nz(credit)) {
      taxLines.push(
        moneyLine("31", "CA tax before credit for taxes paid to other states", beforeCredit, { indent: 1 }),
        moneyLine("", "Less: resident credit for non-resident state taxes (Sch S)", -credit, { indent: 1 }),
      );
    }
    taxLines.push(
      moneyLine(
        "31/61/62",
        partYear
          ? "CA residency-period tax (part-year resident — day-prorated AGI and std ded)"
          : "CA resident tax (engine: FTB brackets; incl. Mental-Health surtax line 62 and Schedule P 540 AMT line 61 when applicable)",
        ret.multiState.residentStateTax,
        {
          note: partYear
            ? "Engine pro-rates AGI and the CA standard deduction by residency days; the official 540NR Schedule CA sources by income item."
            : "The 1% Mental Health Services Tax (taxable > $1M) and the CA AMT delta are folded into this single engine figure — they are not separable lines in the engine output.",
        },
      ),
    );
    caTaxTotal += ret.multiState.residentStateTax;
  }
  if (isFormer && nz(ret.formerStateTax)) {
    taxLines.push(
      moneyLine("31", "CA part-year resident tax (period Jan 1 → residency change)", ret.formerStateTax, {
        note: "Filed on Form 540NR (part-year). Engine: day-prorated AGI × CA brackets with the std ded prorated by residency days — not the per-item 540NR Schedule CA sourcing.",
      }),
    );
    caTaxTotal += ret.formerStateTax;
  }
  if (nrEntry) {
    taxLines.push(
      moneyLine("", "CA-source income (W-2 stateCode CA + CPA-sourced items)", nrEntry.wages, {
        indent: 1,
        note: "Filed on Form 540NR (nonresident).",
      }),
      moneyLine(
        "31",
        `CA nonresident tax${nrEntry.reciprocityApplied ? " (reciprocity — $0)" : ""}`,
        nrEntry.tax,
        {
          note: "540NR method: tax-as-if-full-year-resident on TOTAL income × (CA-source ÷ total AGI) — the engine's verified 540NR effective-rate method.",
        },
      ),
    );
    caTaxTotal += nrEntry.tax;
  }
  taxLines.push(moneyLine("64", "Total California tax (engine aggregate of the rows above)", caTaxTotal, { emphasis: true }));
  if (isResident && !otherStatesInvolved) {
    // Single-state CA filer: the engine's whole state liability IS the CA tax.
    taxLines.push(
      checkLine("CA tax ties to engine total state tax (single-state filer)", caTaxTotal, ret.stateTaxLiability),
    );
  } else {
    taxLines.push(
      textLine("", "Engine total state tax is a cross-state aggregate", "see reconciliation worksheet Part 7", {
        note: "ret.stateTaxLiability spans every state on the return; the CA rows above are the CA share only.",
      }),
    );
  }

  // ── Part 3 — Credits, payments & ISR penalty (lines 71–76, 92) ────────────
  const creditLines: FormLine[] = [];
  if (isResident && nz(ret.stateEitc.credit)) {
    creditLines.push(
      moneyLine("75", "California Earned Income Tax Credit (CalEITC, FTB 3514) — refundable", ret.stateEitc.credit, {
        note: ret.stateEitc.approximate
          ? "Engine approximation of the FTB 3514 worksheet (piecewise-linear peak-to-zero) — confirm against the FTB table."
          : undefined,
      }),
    );
  }
  if (isResident && nz(ret.stateChildTaxCredit)) {
    creditLines.push(
      moneyLine("76", "Young Child Tax Credit (YCTC) — refundable", ret.stateChildTaxCredit, {
        note: "Requires CalEITC eligibility + child under 6.",
      }),
    );
  }
  if (isResident && nz(ret.stateAdditionalCreditsNonRefundable)) {
    creditLines.push(
      moneyLine("32/40/46", "State additional-credit package — nonrefundable (engine aggregate)", ret.stateAdditionalCreditsNonRefundable, {
        note: "For CA this aggregate can include the personal exemption credit (line 32), nonrefundable renter's credit (line 46), and CA CDCC (line 40). Per-credit detail is not separately exposed — see the app's state-credit breakdown.",
      }),
    );
  }
  if (isResident && nz(ret.stateAdditionalCreditsRefundable)) {
    creditLines.push(
      moneyLine("", "State additional-credit package — refundable (engine aggregate)", ret.stateAdditionalCreditsRefundable),
    );
  }
  if (nz(ret.stateIndividualMandatePenalty) && (ret.stateMandate.state ?? "").toUpperCase() === "CA") {
    const m = ret.stateMandate;
    creditLines.push(
      moneyLine("92", "Individual Shared Responsibility Penalty (FTB 3853)", ret.stateIndividualMandatePenalty, {
        note: `Engine method: ${m.method} (flat $${m.flatAmount.toFixed(2)} vs 2.5%-of-income $${m.percentageAmount.toFixed(2)}, capped at bronze $${m.bronzeCapAmount.toFixed(2)}; ${m.monthsUninsured} uninsured month(s)). Assumes the whole household uninsured for those months.`,
      }),
    );
  }
  creditLines.push(
    moneyLine("71", "State income tax withheld — ALL STATES aggregate", ret.stateTaxWithheld, {
      note: "The engine aggregates W-2 box 17 + 1099 state withholding across every state; a per-state (CA-only) line 71 split is not exposed.",
    }),
    textLine("", "Combined state settlement (refund / balance due)", "see reconciliation worksheet Part 7", {
      note: "The engine's state refund is an AGGREGATE across all states and credits — no per-state (CA-only) refund exists, so none is rendered here.",
    }),
  );

  return {
    formId: "ca-540",
    formNumber: "CA Form 540",
    title: "California Income Tax — Summary Workpaper",
    subtitle:
      "SUMMARY WORKPAPER of the engine's California model — NOT a full Form 540/540NR reproduction. Line numbers reference the TY2024 Form 540 for orientation.",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part 1 — Income & AGI (Form 540 lines 13–19)", lines: incomeLines },
      { title: "Part 2 — Tax (Form 540 lines 31–64)", lines: taxLines },
      { title: "Part 3 — Credits, payments & ISR penalty (lines 71–76, 92)", lines: creditLines },
    ],
    footnotes: [
      "SUMMARY MODEL: the engine computes CA tax as FTB brackets(federal AGI − CA standard deduction). It does NOT model Schedule CA (540) per-line conformity adjustments — notably CA's NON-conformity to HSA deductions (CA taxes HSA contributions/earnings), §529-to-Roth, bonus-depreciation differences, or CA itemized deductions. A CPA reconciles those in their prep software.",
      "CA AMT (Schedule P 540, 7% over the exemption) and the 1% Mental Health Services Tax (taxable income over $1M) ARE modeled but are folded into the single CA tax figure (Part 2), not broken out as lines 61/62.",
      "The Individual Shared Responsibility Penalty (line 92) uses the FTB 3853 household-size filing threshold and the greater-of(flat, 2.5% of income) method capped at the statewide average bronze premium; it assumes the entire household was uninsured for the reported months.",
      "Young Child Tax Credit: the engine does not track per-child ages (children-under-6 defaults to 0), so the YCTC line is effectively informational until per-child ages are modeled.",
      "The engine's state withholding and state refund are cross-state aggregates — this workpaper intentionally renders no CA-only settlement; tie the combined settlement in reconciliation worksheet Part 7.",
    ],
  };
}
