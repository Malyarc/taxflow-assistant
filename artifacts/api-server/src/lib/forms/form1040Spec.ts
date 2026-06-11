/**
 * T2.1 — Form 1040 (U.S. Individual Income Tax Return) substitute workpaper.
 *
 * Renders the TY2024 official Form 1040 layout (Pub 1167 substitute-form
 * conventions) resolved against a ComputedTaxReturn. This is a CPA review
 * workpaper, NOT a filed form — amounts are engine-exact (cents).
 *
 * Line-number mapping (TY2024 Form 1040):
 *   1a       W-2 box 1 wages (sum of inputs.w2s)
 *   2a/2b    tax-exempt (info) / taxable interest        — 1099-INT only
 *   3a/3b    qualified (info) / ordinary dividends       — 1099-DIV only;
 *            3b = box 1a TOTAL (includes 3a) per the official form
 *   4b+5b    IRA + pension taxable distributions (engine: one 1099-R bucket)
 *   6a/6b    gross SS (info) / taxable SS (Pub 915 worksheet)
 *   7        Schedule D line 16 if ≥ 0, else −(capital loss deducted, $3k/$1.5k)
 *   8        Schedule 1 additional income — DERIVED residual so line 9 ties
 *   9        total income (engine totalIncome)
 *   10/11    Schedule 1 Part II adjustments (derived) / AGI
 *   12       standard OR itemized deduction (label says which the engine chose)
 *   13a/13b  QBI §199A / OBBBA Schedule 1-A (tips/overtime/car-loan/senior)
 *   14/15    deduction total / taxable income
 *   16       regular income tax — engine residual: federalTaxLiability minus
 *            every Schedule 2 component (QDCGT / Sched D Tax Worksheet
 *            preferential method is INSIDE this line)
 *   17       Schedule 2 line 3 = AMT (6251) + excess-APTC repayment (8962)
 *   19       CTC + ODC nonrefundable (Schedule 8812)
 *   20       Schedule 3 line 8 = totalNonRefundableApplied − line 19 (FTC,
 *            2441, 8863, 8880, 5695 + line-6 others: 8839 / 8801 / 3800 GBC)
 *   22       max(0, 18 − 21) — the official floor (never binds on engine
 *            output; see footnote)
 *   23       Schedule 2 line 21 other taxes: SE + 8959 + 8960 + §72(t) + HSA
 *            excise + Schedule H (excess-APTC sits on line 17, Part I)
 *   24       total tax = 22 + 23; line 24 + line 21 ties the engine's
 *            PRE-credit federalTaxLiability
 *   25a-d    withholding (W-2 / 1099 / other-residual / total)
 *   26       estimated payments — NOT separately modeled (footnote)
 *   27/28/29 EITC / ACTC / refundable AOC
 *   31       Schedule 3 line 13: net PTC + refundable adoption + manual credits
 *   32/33    refundable-credit subtotal / total payments
 *   34 or 37 refund / amount owed + settlement tie-out
 */

import {
  checkLine,
  countLine,
  filingStatusLabel,
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

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function build1040(ctx: FormBuildContext): FormInstance {
  const { taxpayer, ret, inputs } = ctx;
  const f99 = ret.form1099Summary;

  // ── Filing information ──────────────────────────────────────────────────
  const infoLines: FormLine[] = [
    textLine("", "Taxpayer", `${taxpayer.firstName} ${taxpayer.lastName}`.trim()),
    textLine("", "Filing status", filingStatusLabel(taxpayer.filingStatus)),
    textLine("", "Resident state", taxpayer.state),
  ];
  if ((taxpayer.dependentsUnder17 ?? 0) > 0) {
    infoLines.push(
      countLine("", "Dependents — qualifying children under 17 (CTC)", taxpayer.dependentsUnder17),
    );
  }
  if ((taxpayer.otherDependents ?? 0) > 0) {
    infoLines.push(
      countLine("", "Dependents — other (credit for other dependents)", taxpayer.otherDependents),
    );
  }
  if (taxpayer.taxpayerAge != null) {
    infoLines.push(countLine("", "Taxpayer age (Dec 31)", taxpayer.taxpayerAge));
  }
  if (taxpayer.spouseAge != null) {
    infoLines.push(countLine("", "Spouse age (Dec 31)", taxpayer.spouseAge));
  }

  // ── Income (lines 1a–9) ─────────────────────────────────────────────────
  const line1a = (inputs?.w2s ?? []).reduce((s, w) => s + toNum(w.wagesBox1), 0);
  const line2b = f99.interestIncome;
  const line3a = f99.qualifiedDividends;
  // Official line 3b = 1099-DIV box 1a TOTAL ordinary dividends, which INCLUDES
  // the qualified portion (line 3a). The engine tracks the non-qualified
  // remainder separately, so recombine here.
  const line3b = f99.ordinaryDividends + f99.qualifiedDividends;
  const line4b5b = f99.retirementIncome;
  const line6b = ret.socialSecurityTaxable;
  // 1040 line 7: Schedule D line 16 when a net gain; when a net loss, the
  // ordinary-offset portion (Schedule D line 21, capped $3,000/$1,500 MFS).
  const line7 =
    ret.netCapitalGainLoss >= 0 ? ret.netCapitalGainLoss : -ret.capitalLossDeducted;
  // Line 8 is DERIVED as the residual so line 9 ties by construction — every
  // engine income path not on lines 1a–7 (Schedule C, rentals, K-1 buckets,
  // unemployment, 1099-MISC/K, clergy, ISO/ESPP ordinary, 4797 ordinary, …)
  // belongs on Schedule 1 anyway.
  const line8 = ret.totalIncome - (line1a + line2b + line3b + line4b5b + line6b + line7);
  const line9 = ret.totalIncome;

  const incomeLines: FormLine[] = [];
  if (nz(line1a)) {
    incomeLines.push(moneyLine("1a", "Total amount from Form(s) W-2, box 1", line1a));
  }
  if (nz(f99.taxExemptInterest)) {
    incomeLines.push(
      moneyLine("2a", "Tax-exempt interest (info — excluded from total income)", f99.taxExemptInterest, {
        indent: 1,
      }),
    );
  }
  if (nz(line2b)) {
    incomeLines.push(
      moneyLine("2b", "Taxable interest", line2b, {
        note: "1099-INT only — K-1 portfolio interest flows through the Schedule E p.2 aggregation (line 8 here).",
      }),
    );
  }
  if (nz(line3a)) {
    incomeLines.push(
      moneyLine("3a", "Qualified dividends (info — subset of line 3b)", line3a, { indent: 1 }),
    );
  }
  if (nz(line3b)) {
    incomeLines.push(
      moneyLine("3b", "Ordinary dividends", line3b, {
        note: "1099-DIV box 1a total (includes line 3a); K-1 dividends flow through line 8.",
      }),
    );
  }
  if (nz(line4b5b)) {
    incomeLines.push(
      moneyLine("4b/5b", "IRA distributions + pensions and annuities — taxable amount", line4b5b, {
        note: "Engine aggregates all 1099-R taxable amounts in one retirement bucket (official 4b vs 5b split not modeled).",
      }),
    );
  }
  if (nz(ret.socialSecurityBenefits)) {
    incomeLines.push(
      moneyLine("6a", "Social Security benefits (info — gross)", ret.socialSecurityBenefits, {
        indent: 1,
      }),
    );
  }
  if (nz(line6b)) {
    incomeLines.push(
      moneyLine("6b", "Taxable amount of Social Security (Pub 915 worksheet)", line6b),
    );
  }
  if (nz(line7)) {
    incomeLines.push(
      moneyLine("7", "Capital gain or (loss) (Schedule D line 16; $3,000/$1,500 loss limit)", line7),
    );
  }
  if (nz(line8)) {
    incomeLines.push(
      moneyLine("8", "Additional income from Schedule 1, line 10", line8, {
        note: "Derived: line 9 − (1a + 2b + 3b + 4b/5b + 6b + 7) — see Schedule 1.",
      }),
    );
  }
  incomeLines.push(moneyLine("9", "Total income", line9, { emphasis: true }));
  incomeLines.push(
    checkLine(
      "Lines 1a + 2b + 3b + 4b/5b + 6b + 7 + 8 sum to line 9 (engine total income)",
      line1a + line2b + line3b + line4b5b + line6b + line7 + line8,
      ret.totalIncome,
    ),
  );

  // ── AGI → taxable income (lines 10–15) ──────────────────────────────────
  const line10 = ret.totalIncome - ret.adjustedGrossIncome;
  const deductionUsed = ret.itemizedDeductions ?? ret.standardDeduction;
  const line13a = ret.qbiDeduction;
  const line13b = ret.obbbaSchedule1A.total;
  const line14 = deductionUsed + line13a + line13b;
  // Engine identity (taxReturnEngine.ts final assembly): per-step floors.
  const taxableComputed = Math.max(
    0,
    Math.max(0, Math.max(0, ret.adjustedGrossIncome - deductionUsed) - line13a) - line13b,
  );

  const agiLines: FormLine[] = [
    moneyLine("10", "Adjustments to income from Schedule 1, line 26", line10, {
      note: "Derived: line 9 − line 11 — see Schedule 1 Part II.",
    }),
    moneyLine("11", "Adjusted gross income", ret.adjustedGrossIncome, { emphasis: true }),
    moneyLine(
      "12",
      ret.itemizedDeductions != null
        ? "Itemized deductions (Schedule A)"
        : "Standard deduction (incl. any §63(f) age-65/blind add-on)",
      deductionUsed,
    ),
  ];
  if (nz(line13a)) {
    agiLines.push(
      moneyLine("13a", "Qualified business income deduction (Form 8995/8995-A, §199A)", line13a),
    );
  }
  if (nz(line13b)) {
    agiLines.push(
      moneyLine(
        "13b",
        "OBBBA Schedule 1-A deductions (tips §224 / overtime §225 / car-loan §163(h)(4) / senior §151(d))",
        line13b,
      ),
    );
  }
  agiLines.push(moneyLine("14", "Add lines 12, 13a, and 13b", line14));
  agiLines.push(moneyLine("15", "Taxable income", ret.taxableIncome, { emphasis: true }));
  agiLines.push(
    checkLine(
      "Taxable income ties: max(0, AGI − line 12 − 13a − 13b) (engine per-step floors)",
      taxableComputed,
      ret.taxableIncome,
    ),
  );

  // ── Tax and credits (lines 16–24) ───────────────────────────────────────
  const excessAptcRepayment = Math.max(0, -ret.premiumTaxCredit.netPtc);
  // Schedule 2 Part II (line 21) — the other taxes bundled into the engine's
  // pre-credit federalTaxLiability. Excess-APTC repayment is Schedule 2
  // PART I (line 1a → 3), i.e. 1040 line 17, NOT line 23.
  const line23 =
    ret.selfEmploymentTax +
    ret.additionalMedicareTax +
    ret.niitTax +
    ret.earlyWithdrawalPenalty +
    ret.hsaExcessExcise +
    ret.scheduleH.total;
  // Line 16 is the engine residual: everything in federalTaxLiability that is
  // not AMT / excess-APTC / a Schedule 2 Part II tax is the regular income tax
  // (which internally used the QDCGT / Schedule D Tax Worksheet when
  // preferential income is present).
  const line16 = ret.federalTaxLiability - ret.amtTax - excessAptcRepayment - line23;
  const line17 = ret.amtTax + excessAptcRepayment;
  const line18 = line16 + line17;
  const line19 = ret.childTaxCredit.nonRefundablePortion;
  // Schedule 3 line 8 = every nonrefundable credit the engine applied EXCEPT
  // the CTC/ODC (which is 1040 line 19): FTC (1116), dependent care (2441),
  // education (8863), Saver's (8880), residential energy (5695), and the
  // line-6 others — adoption (8839), prior-year minimum tax (8801), general
  // business credits (3800: §41 R&D + §51 WOTC + §45S FMLA under the §38 limit).
  const line20 = ret.totalNonRefundableApplied - line19;
  const line21 = line19 + line20;
  const line22 = Math.max(0, line18 - line21);
  const line24 = line22 + line23;

  const line16Note =
    "Engine residual: total federal tax − AMT − excess-APTC − Schedule 2 Part II taxes. " +
    (nz(ret.preferentialIncome) || nz(ret.capitalGainsTax)
      ? `Computed via the QDCGT / Schedule D Tax Worksheet — preferential-rate tax within this line: ${usd(ret.capitalGainsTax)}.`
      : "No preferential-rate income on this return.");
  const taxLines: FormLine[] = [
    moneyLine("16", "Tax (incl. capital-gains preferential method)", line16, { note: line16Note }),
    moneyLine("17", "Amount from Schedule 2, line 3", line17, {
      note: `AMT (Form 6251) ${usd(ret.amtTax)} + excess advance premium tax credit repayment (Form 8962) ${usd(excessAptcRepayment)}.`,
    }),
    moneyLine("18", "Add lines 16 and 17", line18),
    moneyLine("19", "Child tax credit + credit for other dependents (Schedule 8812)", line19),
    moneyLine("20", "Amount from Schedule 3, line 8", line20, {
      note: "FTC (1116) + dependent care (2441) + education (8863) + Saver's (8880) + energy (5695) + adoption (8839) + prior-yr AMT credit (8801) + GBC (3800) — as applied by the engine.",
    }),
    moneyLine("21", "Add lines 19 and 20", line21),
    moneyLine("22", "Subtract line 21 from line 18 (if zero or less, -0-)", line22, {
      note: "The engine caps nonrefundable credits at the income-tax portion, so this floor never binds on engine output (footnote).",
    }),
    moneyLine("23", "Other taxes, including self-employment tax (Schedule 2, line 21)", line23, {
      note: "SE tax + Additional Medicare (8959) + NIIT (8960) + §72(t) early distribution (5329) + HSA excise (5329 Pt VII) + household employment (Sch H).",
    }),
    moneyLine("24", "Total tax", line24, { emphasis: true }),
    checkLine(
      "Lines 19 + 20 tie to the engine's total nonrefundable credits applied",
      line21,
      ret.totalNonRefundableApplied,
    ),
    checkLine(
      "Line 24 + nonrefundable credits = engine pre-credit federal tax liability",
      line24 + ret.totalNonRefundableApplied,
      ret.federalTaxLiability,
    ),
  ];

  // ── Payments (lines 25–33) ──────────────────────────────────────────────
  const w2Withheld = (inputs?.w2s ?? []).reduce((s, w) => s + toNum(w.federalTaxWithheldBox2), 0);
  const f99Withheld = f99.federalWithheld;
  const line25d = ret.federalTaxWithheld;
  // Residual: manual withholding adjustments (and, when ctx.inputs is absent,
  // any W-2 withholding the builder could not attribute to 25a).
  const line25c = line25d - w2Withheld - f99Withheld;
  const line27 = ret.eitc.appliedCredit;
  const line28 = ret.additionalChildTaxCredit;
  const line29 = ret.educationCredits.aocRefundable;
  // F-5 — Schedule 3 line 11 (excess SS withholding) flows through Schedule 3
  // line 13 into 1040 line 31.
  const line31 =
    Math.max(0, ret.premiumTaxCredit.netPtc) +
    ret.adoptionCredit.refundablePortion +
    (ret.excessSocialSecurityCredit ?? 0) +
    ret.manualCreditsApplied;
  const line32 = line27 + line28 + line29 + line31;
  const line33 = line25d + line32;

  const paymentLines: FormLine[] = [];
  if (nz(w2Withheld)) {
    paymentLines.push(moneyLine("25a", "Federal income tax withheld — Form(s) W-2", w2Withheld, { indent: 1 }));
  }
  if (nz(f99Withheld)) {
    paymentLines.push(moneyLine("25b", "Federal income tax withheld — Form(s) 1099", f99Withheld, { indent: 1 }));
  }
  if (nz(line25c)) {
    paymentLines.push(
      moneyLine("25c", "Federal income tax withheld — other forms", line25c, {
        indent: 1,
        note: "Residual: Form 8959 Part IV Additional-Medicare withholding (W-2 box 6 excess) + manual CPA withholding adjustments.",
      }),
    );
  }
  paymentLines.push(moneyLine("25d", "Total federal income tax withheld", line25d));
  paymentLines.push(
    textLine("26", "Estimated tax payments and amount applied from prior-year return", null, {
      note: "(not separately modeled — CPA-entered withholding/credit adjustments are reflected in lines 25d/31)",
    }),
  );
  if (nz(line27)) paymentLines.push(moneyLine("27", "Earned income credit (EIC)", line27));
  if (nz(line28)) {
    paymentLines.push(moneyLine("28", "Additional child tax credit (Schedule 8812)", line28));
  }
  if (nz(line29)) {
    paymentLines.push(moneyLine("29", "American opportunity credit — refundable 40% (Form 8863, line 8)", line29));
  }
  if (nz(line31)) {
    paymentLines.push(
      moneyLine("31", "Amount from Schedule 3, line 13", line31, {
        note: "Net premium tax credit (8962) + refundable adoption credit (8839/OBBBA) + excess Social Security withholding (Sch 3 line 11) + manual CPA credit adjustments.",
      }),
    );
  }
  paymentLines.push(moneyLine("32", "Add lines 27, 28, 29, and 31 — total other payments and refundable credits", line32));
  paymentLines.push(moneyLine("33", "Total payments (lines 25d + 26 + 32)", line33, { emphasis: true }));

  // ── Refund or amount owed (lines 34 / 37) ───────────────────────────────
  const settlementLines: FormLine[] = [
    moneyLine(
      ret.federalRefundOrOwed >= 0 ? "34" : "37",
      ret.federalRefundOrOwed >= 0
        ? "Overpayment — amount to be refunded"
        : "Amount you owe",
      Math.abs(ret.federalRefundOrOwed),
      { emphasis: true },
    ),
    checkLine(
      "Settlement ties: line 33 − line 24 = engine federal refund/(owed)",
      line33 - line24,
      ret.federalRefundOrOwed,
    ),
  ];

  return {
    formId: "1040",
    formNumber: "Form 1040",
    title: "U.S. Individual Income Tax Return",
    subtitle:
      "Substitute review workpaper (TY2024 official layout, Pub 1167 conventions) — engine-computed; NOT for filing.",
    taxYear: ret.taxYear,
    parts: [
      { title: "Filing information", lines: infoLines },
      { title: "Income (lines 1a–9)", lines: incomeLines },
      { title: "Adjusted gross income and taxable income (lines 10–15)", lines: agiLines },
      { title: "Tax and credits (lines 16–24)", lines: taxLines },
      { title: "Payments (lines 25–33)", lines: paymentLines },
      { title: "Refund or amount you owe (lines 34/37)", lines: settlementLines },
    ],
    footnotes: [
      "Amounts are engine-exact (cents); the official Form 1040 rounds each entry to whole dollars.",
      "Engine convention: the app's \"federal tax liability\" is PRE-nonrefundable-credit and bundles every Schedule 2 tax. This form presents the official structure (line 24 is NET of nonrefundable credits), so line 24 + line 21 ties back to the app's pre-credit total — see the ✓ rows.",
      "Line 22 floor: the engine caps each nonrefundable credit at the remaining income-tax portion (regular tax + AMT, EXCLUDING the excess-APTC repayment in line 17), so the literal line 22 can never go below the excess-APTC amount and the official \"if zero or less, -0-\" floor never binds on engine output. Because the official Credit Limit Worksheets include Schedule 2 line 3 in the limit base, the engine is slightly conservative (may under-apply credits) on a return where the caps bind with excess APTC present.",
      "Line 26 (estimated tax payments) is not separately modeled — CPA-entered estimated payments live in manual withholding/credit adjustments (lines 25d/31).",
      "Lines 1a/2b/3b are W-2 / 1099-INT / 1099-DIV sourced. Everything else (Schedule C, rentals, ALL K-1 buckets including portfolio interest/dividends, unemployment, 1099-MISC/K, clergy housing SE edge, ISO/ESPP ordinary income, Form 4797 ordinary component, …) flows through line 8 (Schedule 1), which is derived as the residual so line 9 ties by construction.",
      "Line 4b/5b combined: the engine aggregates all 1099-R taxable amounts in one retirement bucket; the official IRA (4b) vs pension/annuity (5b) split is not modeled.",
    ],
  };
}
