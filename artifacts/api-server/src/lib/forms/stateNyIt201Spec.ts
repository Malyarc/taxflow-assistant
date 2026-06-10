/**
 * T2.1 — NY Form IT-201 SUMMARY workpaper (state-ca-ny group).
 *
 * IMPORTANT: this is a SUMMARY-STYLE state workpaper, NOT a full IT-201
 * reproduction. The engine computes New York tax internally as
 * `brackets(federal AGI − NY standard deduction − NY retirement exclusions −
 * taxable SS)` and exposes AGGREGATES — there is no per-line IT-201
 * addition/subtraction model. We render only the official form's KEY lines,
 * each traced to an engine output field, with the summary nature disclosed
 * prominently.
 *
 * Official line references are the TY2024 NY Form IT-201:
 *   19  Federal AGI                       48  NYC household credit
 *   26  Govt pension exclusion            49  Net NYC tax
 *   27  Taxable Social Security subtr.    54b MCTMT
 *   29  Pension/annuity excl. ($20k)      55  Yonkers resident surcharge
 *   34  Standard/itemized deduction       63  Empire State child credit
 *   38  NY taxable income                 65  NYS earned income credit
 *   39  NYS tax                           69  NYC school tax credit
 *   47  NYC taxable income                70  NYC earned income credit
 *   47a NYC resident tax                  72  Total NYS tax withheld
 *
 * Applicability: resident state NY, OR part-year former state NY, OR a NY
 * entry in the non-resident state-tax table. Otherwise null. (NYC UBT for a
 * non-NY-resident doing business in NYC is out of this workpaper's gate —
 * documented sub-gap.)
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

export function buildNyIt201(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;

  const residentCode = (ret.stateCode ?? "").toUpperCase();
  const isResident = residentCode === "NY";
  const isFormer = (ret.formerStateCode ?? "").toUpperCase() === "NY";
  const nrEntry = ret.multiState.nonresidentStateTaxes.find(
    (n) => (n.state ?? "").toUpperCase() === "NY",
  );
  if (!isResident && !isFormer && !nrEntry) return null;

  const partYear = ret.multiState.partYearResidency != null;
  const otherStatesInvolved =
    ret.multiState.nonresidentStateTaxes.length > 0 || ret.formerStateCode != null;
  const localTax = ret.multiState.localTax;
  const isNycLocal = (localTax?.jurisdiction ?? "").toUpperCase() === "NYC";
  const isYonkers = (localTax?.jurisdiction ?? "").toUpperCase() === "YONKERS";

  // ── Part 1 — Income & NY AGI (IT-201 lines 19–34) ─────────────────────────
  const incomeLines: FormLine[] = [
    moneyLine("19", "Federal adjusted gross income (Form 1040 line 11)", ret.adjustedGrossIncome, {
      emphasis: true,
    }),
  ];
  if (isResident && nz(ret.stateRetirementExemption)) {
    incomeLines.push(
      moneyLine("26/29", "NY retirement-income exclusions (subtraction)", ret.stateRetirementExemption, {
        indent: 1,
        note: "Engine combines the Line 26 government-pension FULL exclusion (CPA-tagged portion) and the Line 29 $20,000 private pension/IRA exclusion (age 59½+) into one figure. Per-spouse $20k stacking is not modeled.",
      }),
    );
  }
  if (isResident && nz(ret.socialSecurityTaxable)) {
    incomeLines.push(
      moneyLine("27", "Taxable Social Security subtracted from NY income", ret.socialSecurityTaxable, {
        indent: 1,
        note: "New York does not tax Social Security — the engine subtracts the federally-taxable amount from the NY base.",
      }),
    );
  }
  incomeLines.push(
    textLine("34", "NY standard deduction", null, {
      note: "(not exposed as an output field — the engine nets the NY standard deduction inside its state model: NY tax = brackets(federal AGI − NY std ded − exclusions). NY itemized deductions and dependent exemptions (line 36) are NOT modeled.)",
    }),
    textLine("38", "NY taxable income", null, {
      note: "(not exposed — see line 34 note; the engine reports only the resulting tax.)",
    }),
  );

  // ── Part 2 — New York State tax (IT-201 lines 38–46) ──────────────────────
  const taxLines: FormLine[] = [];
  let nyTaxTotal = 0;
  if (isResident) {
    const beforeCredit = ret.multiState.residentStateTaxBeforeCredit;
    const credit = ret.multiState.residentCreditApplied;
    if (nz(credit)) {
      taxLines.push(
        moneyLine("39", "NYS tax before resident credit (IT-112-R analog)", beforeCredit, { indent: 1 }),
        moneyLine("41", "Less: resident credit for taxes paid to other states", -credit, { indent: 1 }),
      );
    }
    taxLines.push(
      moneyLine(
        "39",
        partYear
          ? "NY residency-period tax (part-year resident — day-prorated AGI and std ded)"
          : "New York State resident tax (engine: NY brackets on AGI − std ded − exclusions)",
        ret.multiState.residentStateTax,
        {
          note: partYear
            ? "Engine pro-rates AGI and the NY standard deduction by residency days; the official IT-203 sources by income item."
            : "After the resident credit for non-resident state taxes; BEFORE the NY refundable credits in Part 4. The NY supplemental-tax recapture (line 45) is not modeled.",
        },
      ),
    );
    nyTaxTotal += ret.multiState.residentStateTax;
  }
  if (isFormer && nz(ret.formerStateTax)) {
    taxLines.push(
      moneyLine("39", "NY part-year resident tax (period Jan 1 → residency change)", ret.formerStateTax, {
        note: "Filed on Form IT-203 (part-year). Engine: day-prorated AGI × NY brackets with the std ded prorated by residency days — not the per-item IT-203 income-percentage sourcing.",
      }),
    );
    nyTaxTotal += ret.formerStateTax;
  }
  if (nrEntry) {
    taxLines.push(
      moneyLine("", "NY-source income (W-2 stateCode NY + CPA-sourced items)", nrEntry.wages, {
        indent: 1,
        note: "Filed on Form IT-203 (nonresident).",
      }),
      moneyLine(
        "39",
        `NY nonresident tax${nrEntry.reciprocityApplied ? " (reciprocity — $0)" : ""}`,
        nrEntry.tax,
        {
          note: "IT-203 method: base tax on TOTAL income as if a full-year resident × the Line 45 income percentage (NY-source ÷ total AGI) — the engine's verified IT-203 method.",
        },
      ),
    );
    nyTaxTotal += nrEntry.tax;
  }
  taxLines.push(moneyLine("46", "Total New York State tax (engine aggregate of the rows above)", nyTaxTotal, { emphasis: true }));
  if (isResident && !otherStatesInvolved) {
    // Single-state NY filer: the engine's whole state liability IS the NY tax.
    // (NYC/Yonkers local tax is a SEPARATE engine output — see Part 3.)
    taxLines.push(
      checkLine("NY tax ties to engine total state tax (single-state filer)", nyTaxTotal, ret.stateTaxLiability),
    );
  } else {
    taxLines.push(
      textLine("", "Engine total state tax is a cross-state aggregate", "see reconciliation worksheet Part 7", {
        note: "ret.stateTaxLiability spans every state on the return; the NY rows above are the NY share only.",
      }),
    );
  }

  // ── Part 3 — NYC / Yonkers / MCTMT (IT-201 lines 47–58) ───────────────────
  const localLines: FormLine[] = [];
  if (isNycLocal && localTax) {
    localLines.push(
      moneyLine("47", "NYC taxable income (≈ NYS taxable income, line 38)", localTax.nysTaxableIncome),
      moneyLine("47a", "NYC resident tax on line 47 (NYC brackets)", localTax.baselineTax),
    );
    if (nz(localTax.householdCredit)) {
      localLines.push(moneyLine("48", "NYC household credit", -localTax.householdCredit, { indent: 1 }));
    }
    if (nz(localTax.nycEitc)) {
      localLines.push(
        moneyLine("70", "NYC earned income credit (IT-215 Worksheet C)", -localTax.nycEitc, {
          indent: 1,
          note: `Engine rate ${(localTax.nycEitcRate * 100).toFixed(2)}% of the federal EITC, by NYAGI band (NYAGI ≈ federal AGI). Applied against NYC tax; the excess is refundable below.`,
        }),
      );
    }
    if (nz(localTax.nycMctmt)) {
      localLines.push(
        moneyLine("54b", "MCTMT (self-employed, Zone 1 flat 0.60% of net SE earnings over $50k)", localTax.nycMctmt, {
          indent: 1,
        }),
      );
    }
    localLines.push(
      moneyLine("49/54", "Net NYC tax incl. MCTMT (engine net local tax)", localTax.netLocalTax, { emphasis: true }),
    );
    if (nz(ret.nycUbt)) {
      localLines.push(
        moneyLine("", "NYC Unincorporated Business Tax (Form NYC-202 — not an IT-201 line)", ret.nycUbt, {
          note: "4% of NYC-allocated net business income after the services allowance, $5,000 exemption, and sliding business tax credit.",
        }),
      );
    }
    localLines.push(
      moneyLine("", "Total local tax (engine: net NYC tax + NYC UBT)", ret.localTaxLiability, { emphasis: true }),
      checkLine("Local components tie: net NYC tax + UBT", localTax.netLocalTax + ret.nycUbt, ret.localTaxLiability),
    );
    if (nz(localTax.nycSchoolTaxCredit)) {
      localLines.push(
        moneyLine("69", "NYC school tax credit (refundable — flows to the state settlement)", localTax.nycSchoolTaxCredit),
      );
    }
    if (nz(ret.nycEitcRefundableExcess)) {
      localLines.push(
        moneyLine("", "NYC EIC in excess of NYC tax (refundable — flows to the state settlement)", ret.nycEitcRefundableExcess),
      );
    }
  } else if (isYonkers && localTax) {
    localLines.push(
      moneyLine("55", "Yonkers resident income tax surcharge (16.75% of net NYS tax)", localTax.netLocalTax, {
        note: "Engine: localityCode \"YONKERS\" — surcharge = 16.75% × the net NY State resident tax (after the resident credit), per the IT-201 Yonkers worksheet.",
      }),
      moneyLine("", "Total local tax (engine)", ret.localTaxLiability, { emphasis: true }),
    );
  } else if (nz(ret.nycUbt)) {
    // UBT can exist without a NYC-resident locality (business in NYC).
    localLines.push(
      moneyLine("", "NYC Unincorporated Business Tax (Form NYC-202 — not an IT-201 line)", ret.nycUbt, {
        note: "Applies to residents AND non-residents doing business in NYC; independent of the personal income tax.",
      }),
      moneyLine("", "Total local tax (engine)", ret.localTaxLiability, { emphasis: true }),
    );
  }

  // ── Part 4 — Credits & payments (IT-201 lines 63–72) ──────────────────────
  const creditLines: FormLine[] = [];
  if (isResident && nz(ret.stateEitc.credit)) {
    creditLines.push(
      moneyLine("65", "NYS earned income credit — refundable (30% of federal EITC)", ret.stateEitc.credit, {
        note: "NY Tax Law §606(d): exactly 30% of the federal EITC.",
      }),
    );
  }
  if (isResident && nz(ret.stateChildTaxCredit)) {
    // Engine's stateChildTaxCredit covers CA/CO/NJ/IL/NM/VT — NY's Empire State
    // child credit lives in the additional-credit package below. Rendered only
    // if the engine ever reports it here.
    creditLines.push(moneyLine("63", "State child tax credit (engine field)", ret.stateChildTaxCredit));
  }
  if (isResident && nz(ret.stateAdditionalCreditsRefundable)) {
    creditLines.push(
      moneyLine("63/64", "NY additional credits — refundable (engine aggregate)", ret.stateAdditionalCreditsRefundable, {
        note: "For NY this aggregate includes the Empire State child credit (IT-213, line 63) and the NY child & dependent care credit (IT-216, line 64). Per-credit detail is not separately exposed — see the app's state-credit breakdown.",
      }),
    );
  }
  if (isResident && nz(ret.stateAdditionalCreditsNonRefundable)) {
    creditLines.push(
      moneyLine("", "NY additional credits — nonrefundable (engine aggregate)", ret.stateAdditionalCreditsNonRefundable, {
        note: "For NY this aggregate includes the college tuition credit (IT-272). Reduces state tax (floored at $0).",
      }),
    );
  }
  creditLines.push(
    moneyLine("72", "State income tax withheld — ALL STATES aggregate", ret.stateTaxWithheld, {
      note: "The engine aggregates W-2 box 17 + 1099 state withholding across every state; a per-state (NY-only) line 72 split is not exposed.",
    }),
    textLine("", "Combined state settlement (refund / balance due)", "see reconciliation worksheet Part 7", {
      note: "The engine's state refund is an AGGREGATE across all states and credits — no per-state (NY-only) refund exists, so none is rendered here.",
    }),
  );

  const parts = [
    { title: "Part 1 — Income & NY AGI (IT-201 lines 19–34)", lines: incomeLines },
    { title: "Part 2 — New York State tax (IT-201 lines 38–46)", lines: taxLines },
  ];
  if (localLines.length > 0) {
    parts.push({ title: "Part 3 — New York City / Yonkers / MCTMT (IT-201 lines 47–58)", lines: localLines });
  }
  parts.push({ title: `Part ${localLines.length > 0 ? 4 : 3} — Credits & payments (IT-201 lines 63–72)`, lines: creditLines });

  return {
    formId: "ny-it-201",
    formNumber: "NY Form IT-201",
    title: "New York Income Tax — Summary Workpaper",
    subtitle:
      "SUMMARY WORKPAPER of the engine's New York model — NOT a full IT-201/IT-203 reproduction. Line numbers reference the TY2024 Form IT-201 for orientation.",
    taxYear: ret.taxYear,
    parts,
    footnotes: [
      "SUMMARY MODEL: the engine computes NY tax as brackets(federal AGI − NY standard deduction − retirement exclusions − taxable SS). It does NOT model IT-201 per-line additions/subtractions (e.g. the line 20 NY-bond addback beyond the CPA marker, 414(h)/IRC 125 addbacks), NY itemized deductions, dependent exemptions (line 36), or the tax-recapture supplemental tax (line 45).",
      "ENGINE CONVENTION — local tax is its OWN output line: NYC/Yonkers tax (ret.localTaxLiability) is NOT inside the engine's state-tax total or state settlement. The refundable NYC credits (school tax credit, NYC EIC excess) DO flow to the state settlement — tie them in reconciliation worksheet Part 7.",
      "NYC tax base (line 47) ≈ NYS taxable income computed by the engine (federal AGI − NY std ded − retirement exclusion); the Charitable Gifts Trust Fund edge on line 47 is not modeled.",
      "MCTMT is modeled for the SELF-EMPLOYED in Zone 1 only (flat 0.60% over $50k, localityCode NYC); the employer payroll-side MCTMT and Zone 2 are out of scope.",
      "The engine's state withholding and state refund are cross-state aggregates — this workpaper intentionally renders no NY-only settlement; tie the combined settlement in reconciliation worksheet Part 7.",
    ],
  };
}
