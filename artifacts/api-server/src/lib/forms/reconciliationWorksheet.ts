/**
 * T2.1 B1 — The 1040 reconciliation worksheet: every computed value tied to
 * its form + line, with explicit ✓/⚠ tie-out rows. The single best CPA
 * cross-check: a preparer lines this up against their prep software and any
 * variance is visible immediately.
 *
 * Tie-out identities mirror the ENGINE's own final assembly exactly
 * (taxReturnEngine.ts):
 *
 *   taxable  = max(0, max(0, max(0, AGI − deduction) − QBI) − OBBBA 1-A)
 *   regular  = federalTaxLiability − AMT − SE − NIIT − addlMedicare
 *              − §72(t) − HSA excise − Sch H − excess-APTC repayment
 *   refund   = withheld + manual credits + nonrefundable applied
 *              + (ACTC + AOC-refundable + EITC + net PTC + adoption-refundable)
 *              − federalTaxLiability
 *   state    = withheld − max(0, preCreditTax − addlNonRef) + stateEITC
 *              + MN CTC + NYC EITC excess + state CTC + NYC school credit
 *              + addlRefundable − mandate penalty
 *
 * Where a section's component list is intentionally non-exhaustive (the
 * engine has 50+ income paths), an explicit RESIDUAL row absorbs the
 * remainder so the section still ties by construction and the unlisted
 * portion is VISIBLE — never silently dropped.
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

export function buildReconciliationWorksheet(ctx: FormBuildContext): FormInstance {
  const { ret, inputs } = ctx;

  // ── Part 1 — Total income (Form 1040 line 9) ──
  // Year-filter the W-2s (matches schedule1Spec) so a multi-year inputs.w2s
  // can't overstate the wages row and drive the residual negative.
  const wages = (inputs?.w2s ?? [])
    .filter((w) => (w.taxYear ?? ret.taxYear) === ret.taxYear)
    .reduce((s, w) => s + toNum(w.wagesBox1), 0);
  const f99 = ret.form1099Summary;
  const k1 = ret.scheduleK1;
  const capitalLine7 =
    ret.netCapitalGainLoss >= 0 ? ret.netCapitalGainLoss : -ret.capitalLossDeducted;
  // K-1 non-capital buckets INCLUDING qualified dividends — K-1 QDIV is part of
  // total income (AGI invariant #1) just like the 1099 qualified portion.
  const k1NonCapital =
    k1.totalActiveOrdinaryIncome +
    k1.totalGuaranteedPayments +
    k1.totalPassiveBucketNetApplied +
    k1.totalInterestIncome +
    k1.totalOrdinaryDividends +
    k1.totalQualifiedDividends +
    k1.totalRoyalties;
  const scheduleCNet = f99.seIncome - ret.scheduleCExpenses - ret.scheduleCDepreciation;
  // M2 — official Form 1040 line 3b / Schedule B line 6 is 1099-DIV box-1a
  // TOTAL ordinary dividends (INCLUDING the qualified portion). The engine
  // buckets box 1a − 1b as `ordinaryDividends` and box 1b as
  // `qualifiedDividends`; recombine so the itemized row matches the official
  // line (and the 1040 workpaper in the same packet) instead of leaving the
  // QDIV in the residual.
  const div3b = f99.ordinaryDividends + f99.qualifiedDividends;
  // M1 — `rents`/`royalties` are SUBSETS of `miscIncome` (engine 696–700);
  // summing all three double-counted them. Itemize the three disjoint pieces.
  const miscOther = f99.miscIncome - f99.rents - f99.royalties;

  const incomeComponents: Array<[string, string, number, string?]> = [
    ["1a", "Wages (W-2 box 1)", wages],
    ["2b", "Taxable interest (Schedule B)", f99.interestIncome],
    ["3b", "Ordinary dividends (Schedule B, 1099-DIV box 1a incl. qualified)", div3b],
    ["4b/5b", "IRA / pension / annuity taxable distributions", f99.retirementIncome],
    ["6b", "Taxable Social Security (Pub 915 worksheet)", ret.socialSecurityTaxable],
    ["7", "Capital gain or (loss) (Schedule D line 16 / $3k limit)", capitalLine7],
    ["8", "Schedule C net profit or (loss)", scheduleCNet, "Sch 1 line 3 — 1099-NEC receipts − expenses − depreciation"],
    ["8", "Rental real estate applied (Schedule E, after §469)", ret.scheduleERentalAppliedToAgi, "Sch 1 line 5"],
    ["8", "K-1 pass-through (non-capital buckets)", k1NonCapital, "Sch E p.2 + Sch B portions (incl. K-1 qualified dividends)"],
    ["8", "Unemployment compensation (1099-G)", f99.unemploymentCompensationOnly, "Sch 1 line 7"],
    ["8", "1099-MISC rents (box 1)", f99.rents, "Sch 1 line 5"],
    ["8", "1099-MISC royalties (box 2)", f99.royalties, "Sch 1 line 5"],
    ["8", "1099-MISC other income (box 3 + fishing + medical)", miscOther, "Sch 1 line 8z"],
    ["8", "1099-K payment-card income", f99.paymentCardIncome],
    ["8d", "Foreign earned income exclusion (Form 2555)", -ret.feie.totalExclusion, "Sch 1 line 8d — negative; the engine nets the FEIE INSIDE total income (the gross foreign earned income is in the residual row)"],
    ["8", "ISO disqualifying-disposition ordinary income", ret.isoDisqualifyingDispositionOrdinary],
    ["8", "ESPP disqualifying-disposition ordinary income", ret.esppDisqualifyingDispositionOrdinary],
    ["8", "Form 4797 ordinary component (recapture + §1231 loss)", ret.form4797?.ordinaryComponent ?? 0],
    ["8", "§461(l) excess business loss addback", ret.section461lExcessLossAddback],
    ["8", "§163(j) allowed business interest (deduction)", -ret.section163jAllowedDeduction],
    // T1.0c #3 — the §172 NOL deduction is ABOVE THE LINE (Sch 1 line 8a,
    // negative other income → total income → AGI), so it belongs to the INCOME
    // chain (previously mislisted as an adjustment-to-income row).
    ["8a", "NOL deduction (§172, Sch 1 line 8a — 80% limit)", -ret.nolDeduction],
  ];
  const incomeLines: FormLine[] = [];
  let incomeListed = 0;
  for (const [line, label, value, note] of incomeComponents) {
    if (!nz(value)) continue;
    incomeListed += value;
    incomeLines.push(moneyLine(line, label, value, note ? { note } : {}));
  }
  if (nz(f99.qualifiedDividends)) {
    incomeLines.push(
      moneyLine("3a", "Qualified dividends (info — subset of the 3b row above; preferential rates)", f99.qualifiedDividends, {
        indent: 1,
      }),
    );
  }
  if (nz(ret.socialSecurityBenefits)) {
    incomeLines.push(
      moneyLine("6a", "Gross Social Security benefits (info — 6b above is the taxable part)", ret.socialSecurityBenefits, {
        indent: 1,
      }),
    );
  }
  if (nz(f99.taxExemptInterest)) {
    incomeLines.push(
      moneyLine("2a", "Tax-exempt interest (info — excluded from total income)", f99.taxExemptInterest, { indent: 1 }),
    );
  }
  const incomeResidual = ret.totalIncome - incomeListed;
  if (nz(incomeResidual)) {
    incomeLines.push(
      moneyLine("", "Other income components (residual — trace in app)", incomeResidual, {
        note: "Manual income adjustments, §111 taxable state refund, clergy/statutory edges, K-1 capital detail, etc.",
      }),
    );
  }
  incomeLines.push(moneyLine("9", "Total income (reported by engine)", ret.totalIncome, { emphasis: true }));

  // ── Part 2 — AGI (Form 1040 line 11) ──
  // H1/M3 (audit 2026-06-11): the NOL and the FEIE are NOT in the engine's
  // AGI bridge — the FEIE is netted INSIDE total income (Part 1's 8d row) and
  // the NOL is applied between the deduction and QBI steps (Part 3's chain).
  // Listing them here inflated the adjustments and forced an equal, spurious
  // negative residual mislabeled "Manual above-the-line adjustments".
  const rd = ret.retirementDeductions;
  const atlComponents: Array<[string, string, number, string?]> = [
    ["11", "Educator expenses", ret.educatorExpenses.deductible],
    ["13", "HSA deduction (Form 8889)", rd.hsaDeductible],
    ["15", "Deductible half of SE tax (Schedule SE)", ret.detail.se.deductibleHalf],
    ["17", "Self-employed health insurance (Form 7206)", ret.sehi.deduction],
    ["18", "Early-withdrawal penalty on savings (1099-INT box 2)", f99.interestEarlyWithdrawalPenalty],
    ["20", "Traditional IRA deduction", rd.iraDeductible],
    ["21", "Student loan interest", ret.studentLoanInterest.deductible],
    ["8d", "Foreign earned income exclusion (Form 2555)", ret.feie.totalExclusion, "Sch 1 line 8d (negative income; stacking rule applied)"],
  ];
  const atlLines: FormLine[] = [];
  let atlListed = 0;
  for (const [line, label, value, note] of atlComponents) {
    if (!nz(value)) continue;
    atlListed += value;
    atlLines.push(moneyLine(line, label, value, note ? { note } : {}));
  }
  const atlResidual = ret.totalIncome - atlListed - ret.adjustedGrossIncome;
  if (nz(atlResidual)) {
    atlLines.push(
      moneyLine("", "Other adjustments (residual — trace in app)", atlResidual, {
        note: "Manual above-the-line adjustments (SEP/SIMPLE, alimony, etc.).",
      }),
    );
  }
  atlLines.push(moneyLine("10", "Total adjustments to income", ret.totalIncome - ret.adjustedGrossIncome, { emphasis: true }));
  atlLines.push(moneyLine("11", "Adjusted gross income (reported by engine)", ret.adjustedGrossIncome, { emphasis: true }));

  // ── Part 3 — Taxable income chain (EXACT identity) ──
  // Mirrors the ENGINE's actual chain incl. the §172 NOL step between the
  // deduction and QBI (taxableAfterNol — engine ~2977). The NOL amount comes
  // from the ENGINE OUTPUT (ret.nolDeduction); if a future engine moves the
  // NOL above-the-line (inside AGI), the no-NOL chain ties instead and the
  // NOL row is dropped from this chain (it is then already inside line 11) —
  // correct under either engine architecture (audit 2026-06-11 H1).
  const deductionUsed = ret.itemizedDeductions ?? ret.standardDeduction;
  const obbbaTotal = ret.obbbaSchedule1A.total;
  const nolApplied = Math.max(0, ret.nolDeduction);
  const taxableChain = (nol: number) =>
    Math.max(
      0,
      Math.max(0, Math.max(0, Math.max(0, ret.adjustedGrossIncome - deductionUsed) - nol) - ret.qbiDeduction) -
        obbbaTotal,
    );
  const nolInTaxableChain =
    nolApplied > 0 && Math.abs(taxableChain(0) - ret.taxableIncome) < 0.01 ? 0 : nolApplied;
  const taxableComputed = taxableChain(nolInTaxableChain);
  const taxableLines: FormLine[] = [
    moneyLine("11", "Adjusted gross income", ret.adjustedGrossIncome),
    moneyLine(
      "12",
      ret.itemizedDeductions != null ? "Itemized deductions (Schedule A)" : "Standard deduction",
      deductionUsed,
    ),
  ];
  if (nz(nolInTaxableChain)) {
    taxableLines.push(
      moneyLine("", "NOL carryforward deduction (§172, 80% limit) — engine deducts here", nolInTaxableChain, {
        note: "Officially Schedule 1 line 8a (inside AGI); the engine nets the NOL between the deduction and QBI steps — same disclosed deviation as the Schedule 1 workpaper.",
      }),
    );
  }
  taxableLines.push(moneyLine("13a", "QBI deduction (Form 8995/8995-A, §199A)", ret.qbiDeduction));
  if (nz(obbbaTotal)) {
    taxableLines.push(
      moneyLine("13b", "OBBBA Schedule 1-A deductions (tips/overtime/car-loan/senior)", obbbaTotal),
    );
  }
  taxableLines.push(moneyLine("15", "Taxable income (reported by engine)", ret.taxableIncome, { emphasis: true }));
  taxableLines.push(
    checkLine(
      nz(nolInTaxableChain)
        ? "Taxable income ties: max(0, AGI − deduction − NOL − QBI − 1-A)"
        : "Taxable income ties: max(0, AGI − deduction − QBI − 1-A)",
      taxableComputed,
      ret.taxableIncome,
    ),
  );

  // ── Part 4 — Federal tax composition (EXACT by engine assembly) ──
  const excessAptcRepayment = Math.max(0, -ret.premiumTaxCredit.netPtc);
  const otherTaxes =
    ret.amtTax +
    ret.selfEmploymentTax +
    ret.niitTax +
    ret.additionalMedicareTax +
    ret.earlyWithdrawalPenalty +
    ret.hsaExcessExcise +
    ret.scheduleH.total +
    excessAptcRepayment;
  const regularTax = ret.federalTaxLiability - otherTaxes;
  const taxLines: FormLine[] = [
    moneyLine("16", "Regular income tax (incl. capital-gains preferential method)", regularTax, {
      note: `Preferential-rate tax within this line: ${ret.capitalGainsTax.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
    }),
  ];
  const taxComponents: Array<[string, string, number]> = [
    ["S2-1", "Alternative minimum tax (Form 6251)", ret.amtTax],
    ["S2-2", "Excess advance premium tax credit repayment (Form 8962)", excessAptcRepayment],
    ["S2-4", "Self-employment tax (Schedule SE)", ret.selfEmploymentTax],
    ["S2-8", "Additional tax on early distributions §72(t) (Form 5329)", ret.earlyWithdrawalPenalty],
    ["S2-8", "HSA excess-contribution excise §4973 (Form 5329)", ret.hsaExcessExcise],
    ["S2-9", "Household employment taxes (Schedule H)", ret.scheduleH.total],
    ["S2-11", "Additional Medicare tax (Form 8959)", ret.additionalMedicareTax],
    ["S2-12", "Net investment income tax (Form 8960)", ret.niitTax],
  ];
  for (const [line, label, value] of taxComponents) {
    if (nz(value)) taxLines.push(moneyLine(line, label, value));
  }
  taxLines.push(
    moneyLine("24", "Total federal tax before credits (reported by engine)", ret.federalTaxLiability, {
      emphasis: true,
      note: "Engine convention: pre-nonrefundable-credit, bundling the Schedule 2 taxes above.",
    }),
  );
  taxLines.push(
    checkLine("Components sum to total federal tax", regularTax + otherTaxes, ret.federalTaxLiability),
  );

  // ── Part 5 — Credits ──
  // M4 (audit 2026-06-11): list the APPLIED (income-tax-capped) amounts, not
  // the calc-level computed amounts. The engine applies each nonrefundable
  // credit as min(computed, remaining income tax) in the Schedule 8812
  // Credit-Limit-Worksheet order (FTC → dependent care → education → Saver's
  // → energy → adoption → CTC → §53 → §38 GBC); when the cap binds (common on
  // low-income returns with credits), the calc-level amounts overstate the
  // rows and false-⚠ the tie-out. Reconstruct the same sequential mins from
  // engine outputs (the per-form 2441/8863/8880 builders do the identical
  // reconstruction); adoption / CTC / §53 / §38 amounts are already exposed
  // post-cap by the engine and are used directly.
  const excessAptcForCredits = Math.max(0, -ret.premiumTaxCredit.netPtc);
  const incomeTaxOnlyForCredits =
    ret.federalTaxLiability -
    ret.selfEmploymentTax -
    ret.niitTax -
    ret.additionalMedicareTax -
    ret.earlyWithdrawalPenalty -
    ret.hsaExcessExcise -
    ret.scheduleH.total -
    excessAptcForCredits; // = regular income tax + AMT, the §26 credit base
  let creditRoom = Math.max(0, incomeTaxOnlyForCredits);
  const applyCap = (computed: number): number => {
    const applied = Math.min(Math.max(0, computed), creditRoom);
    creditRoom = Math.max(0, creditRoom - applied);
    return applied;
  };
  const takeApplied = (applied: number): number => {
    creditRoom = Math.max(0, creditRoom - Math.max(0, applied));
    return Math.max(0, applied);
  };
  const creditLines: FormLine[] = [];
  // Sequential order MUST match the engine pipeline (taxReturnEngine ~3633).
  const nonRefComponents: Array<[string, string, number, number]> = [];
  const pushCapped = (line: string, label: string, computed: number) => {
    nonRefComponents.push([line, label, applyCap(computed), computed]);
  };
  const pushApplied = (line: string, label: string, applied: number) => {
    nonRefComponents.push([line, label, takeApplied(applied), applied]);
  };
  pushCapped("S3-1", "Foreign tax credit (Form 1116)", ret.foreignTaxCredit.credit);
  pushCapped("S3-2", "Dependent care credit (Form 2441)", ret.dependentCareCredit.appliedCredit);
  pushCapped("S3-3", "Education credits — nonrefundable AOC + LLC (Form 8863)", ret.educationCredits.aocNonRefundable + ret.educationCredits.llcApplied);
  pushCapped("S3-4", "Retirement savings credit (Form 8880)", ret.saversCredit.appliedCredit);
  // §25C/§30C energy credits apply BEFORE the CTC (capped against the running
  // income tax); the §25D residential clean energy credit applies AFTER the CTC
  // with a §25D(c) carryforward (engine: taxReturnEngine ~4342-4429). Splitting
  // them — and using the §25D APPLIED amount (not the computed total) — makes the
  // Part-5 tie-out tie for a §25D-with-carryforward return; pushing the full
  // computed total pre-CTC produced a FALSE "⚠ off by" on a correct packet
  // (audit 2026-06-23).
  pushCapped("S3-5", "Residential energy credits §25C/§30C (Form 5695)", ret.residentialEnergyCredits.total - ret.residentialEnergyCredits.cleanEnergyCredit);
  pushApplied("S3-6c", "Adoption credit — nonrefundable (Form 8839)", ret.adoptionCredit.nonRefundableApplied);
  pushApplied("19", "Child tax credit + ODC — nonrefundable (Form 8812)", ret.childTaxCredit.nonRefundablePortion);
  pushApplied("S3-5a", "Residential clean energy §25D (Form 5695)", ret.residentialCleanEnergyApplied);
  pushApplied("S3-6b", "Prior-year minimum tax credit (Form 8801)", ret.amtCreditApplied);
  pushApplied("S3-6a", "R&D credit applied under §38 limit (Form 6765)", ret.rdCreditApplied);
  pushApplied("S3-6a", "Other general business credits (WOTC §51 / FMLA §45S)", ret.otherGeneralBusinessCreditApplied);
  let nonRefListed = 0;
  for (const [line, label, applied, computed] of nonRefComponents) {
    if (!nz(applied) && !nz(computed)) continue;
    nonRefListed += applied;
    creditLines.push(
      moneyLine(
        line,
        label,
        applied,
        computed - applied > 0.005
          ? { note: `Income-tax limit binds — computed ${computed.toLocaleString("en-US", { style: "currency", currency: "USD" })}, applied as shown.` }
          : {},
      ),
    );
  }
  creditLines.push(
    moneyLine("", "Total nonrefundable credits applied (reported by engine)", ret.totalNonRefundableApplied, {
      emphasis: true,
    }),
  );
  creditLines.push(checkLine("Nonrefundable components tie (applied amounts)", nonRefListed, ret.totalNonRefundableApplied));

  const refundables: Array<[string, string, number]> = [
    ["28", "Additional child tax credit (refundable ACTC)", ret.additionalChildTaxCredit],
    ["29", "Refundable American Opportunity credit (40%)", ret.educationCredits.aocRefundable],
    ["27", "Earned income tax credit", ret.eitc.appliedCredit],
    ["S3-9", "Net premium tax credit (Form 8962)", Math.max(0, ret.premiumTaxCredit.netPtc)],
    ["S3-6c", "Adoption credit — refundable portion (OBBBA)", ret.adoptionCredit.refundablePortion],
    // F-5 — Schedule 3 line 11: excess SS withholding (2+ employers) is a
    // payment-side refundable credit inside the engine's federalRefundOrOwed.
    ["S3-11", "Excess Social Security withholding (2+ employers)", ret.excessSocialSecurityCredit ?? 0],
  ];
  let refundableTotal = 0;
  for (const [line, label, value] of refundables) {
    if (!nz(value)) continue;
    refundableTotal += value;
    creditLines.push(moneyLine(line, label, value));
  }
  if (nz(ret.manualCreditsApplied)) {
    creditLines.push(moneyLine("", "Manual CPA credit adjustments", ret.manualCreditsApplied));
  }

  // ── Part 6 — Refund settlement (EXACT identity) ──
  const refundComputed =
    ret.federalTaxWithheld +
    ret.manualCreditsApplied +
    ret.totalNonRefundableApplied +
    refundableTotal -
    ret.federalTaxLiability;
  const settlementLines: FormLine[] = [
    moneyLine("25", "Federal tax withheld (incl. manual withholding adjustments)", ret.federalTaxWithheld),
    moneyLine("", "Nonrefundable credits applied", ret.totalNonRefundableApplied),
    moneyLine("", "Refundable credits", refundableTotal),
    moneyLine("", "Manual CPA credit adjustments", ret.manualCreditsApplied),
    moneyLine("24", "Less: total federal tax", -ret.federalTaxLiability),
    moneyLine(
      ret.federalRefundOrOwed >= 0 ? "34" : "37",
      ret.federalRefundOrOwed >= 0 ? "Federal refund (reported by engine)" : "Federal balance due (reported by engine)",
      Math.abs(ret.federalRefundOrOwed),
      { emphasis: true },
    ),
    checkLine("Refund settlement ties: withheld + credits − tax", refundComputed, ret.federalRefundOrOwed),
  ];

  // ── Part 7 — State settlement (EXACT identity) ──
  const stateAfterAdditional = Math.max(0, ret.stateTaxLiability - ret.stateAdditionalCreditsNonRefundable);
  const nycSchoolCredit = ret.multiState.localTax?.nycSchoolTaxCredit ?? 0;
  const mnCtc = ret.stateEitc.mnCtc ?? 0;
  const stateRefundComputed =
    ret.stateTaxWithheld -
    stateAfterAdditional +
    ret.stateEitc.credit +
    mnCtc +
    ret.nycEitcRefundableExcess +
    ret.stateChildTaxCredit +
    nycSchoolCredit +
    ret.stateAdditionalCreditsRefundable -
    ret.stateIndividualMandatePenalty;
  const stateLines: FormLine[] = [
    moneyLine("", `Resident-state (${ret.stateCode}) tax after NR credit`, ret.multiState.residentStateTax),
  ];
  for (const nr of ret.multiState.nonresidentStateTaxes) {
    stateLines.push(
      moneyLine("", `Non-resident ${nr.state} tax${nr.reciprocityApplied ? " (reciprocity)" : ""}`, nr.tax, { indent: 1 }),
    );
  }
  if (nz(ret.localTaxLiability)) {
    stateLines.push(
      moneyLine("", `Local tax (${ret.localTaxJurisdiction ?? "local"})`, ret.localTaxLiability, { indent: 1 }),
    );
  }
  stateLines.push(moneyLine("", "Total state + local tax before additional credits", ret.stateTaxLiability, { emphasis: true }));
  if (nz(ret.stateAdditionalCreditsNonRefundable)) {
    stateLines.push(moneyLine("", "State additional credits — nonrefundable", -ret.stateAdditionalCreditsNonRefundable));
  }
  stateLines.push(moneyLine("", "State tax withheld", ret.stateTaxWithheld));
  const stateRefundableRows: Array<[string, number]> = [
    ["State EITC", ret.stateEitc.credit],
    ["MN child tax credit", mnCtc],
    ["NYC EITC refundable excess", ret.nycEitcRefundableExcess],
    ["State child tax credit (CA YCTC / CO / NJ / IL / NM / VT)", ret.stateChildTaxCredit],
    ["NYC school tax credit", nycSchoolCredit],
    ["State additional credits — refundable", ret.stateAdditionalCreditsRefundable],
  ];
  for (const [label, value] of stateRefundableRows) {
    if (nz(value)) stateLines.push(moneyLine("", label, value));
  }
  if (nz(ret.stateIndividualMandatePenalty)) {
    stateLines.push(
      moneyLine("", `Individual mandate penalty (${ret.stateMandate.state ?? ret.stateCode})`, -ret.stateIndividualMandatePenalty),
    );
  }
  stateLines.push(
    moneyLine(
      "",
      ret.stateRefundOrOwed >= 0 ? "State refund (reported by engine)" : "State balance due (reported by engine)",
      Math.abs(ret.stateRefundOrOwed),
      { emphasis: true },
    ),
  );
  stateLines.push(checkLine("State settlement ties", stateRefundComputed, ret.stateRefundOrOwed));

  // ── Part 8 — Carryforwards to next year ──
  const cfComponents: Array<[string, string, number]> = [
    ["", "NOL carryforward remaining (§172)", ret.nolCarryforwardRemaining],
    ["", "Short-term capital loss carryforward (Pub 550)", ret.capitalLossCarryforwardShort],
    ["", "Long-term capital loss carryforward (Pub 550)", ret.capitalLossCarryforwardLong],
    ["", "Cash charitable carryforward §170(d)(1)", ret.charitableCarryforwardCashRemaining],
    ["", "AMT minimum-tax credit carryforward (Form 8801)", ret.amtCreditCarryforwardRemaining],
    ["", "AMT NOL (ATNOLD §56(d)) carryforward", ret.amtNolCarryforwardRemaining],
    ["", "§163(j) disallowed business interest carryforward", ret.section163jDisallowedCarryforward],
    ["", "§179 carryforward (§179(b)(3)(B))", ret.section179Carryforward],
    ["", "Foreign tax credit carryforward (§904(c))", ret.foreignTaxCreditCarryforwardRemaining],
    ["", "Adoption credit carryforward (§23(c))", ret.adoptionCreditCarryforwardRemaining],
    ["", "Residential clean energy credit carryforward (§25D(c))", ret.residentialCleanEnergyCarryforward],
    ["", "R&D credit carryforward (§39)", ret.rdCreditCarryforwardRemaining],
    ["", "Other GBC carryforward (§39)", ret.otherGeneralBusinessCreditCarryforward],
    ["", "Schedule E passive loss suspended (§469)", ret.scheduleEPassiveLossSuspended],
    ["", "K-1 passive loss suspended (§469)", ret.scheduleK1.k1PassiveLossSuspended],
    ["", "K-1 basis/at-risk loss suspended (§704(d)/§465)", ret.scheduleK1.k1BasisAtRiskLossSuspended],
    ["", "Investment interest disallowed (§163(d)(2))", ret.investmentInterestDisallowed],
  ];
  const cfLines: FormLine[] = cfComponents
    .filter(([, , v]) => nz(v))
    .map(([line, label, value]) => moneyLine(line, label, value));
  if (cfLines.length === 0) {
    cfLines.push(textLine("", "No carryforwards generated this year", "—"));
  }

  return {
    formId: "reconciliation",
    formNumber: "Workpaper",
    title: "1040 Reconciliation Worksheet",
    subtitle:
      "Every computed value tied to its form + line. ✓ rows are engine-identity tie-outs; ⚠ rows demand review before relying on this packet.",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part 1 — Total income (Form 1040 line 9)", lines: incomeLines },
      { title: "Part 2 — Adjustments to income → AGI (Form 1040 line 11)", lines: atlLines },
      { title: "Part 3 — Taxable income (Form 1040 line 15)", lines: taxableLines },
      { title: "Part 4 — Federal tax composition (Form 1040 line 24 + Schedule 2)", lines: taxLines },
      { title: "Part 5 — Credits (Form 1040 lines 19–29 + Schedule 3)", lines: creditLines },
      { title: "Part 6 — Federal settlement (Form 1040 lines 25–37)", lines: settlementLines },
      { title: "Part 7 — State + local settlement", lines: stateLines },
      { title: "Part 8 — Carryforwards to next year", lines: cfLines },
    ],
    footnotes: [
      "Residual rows absorb components the worksheet does not itemize (manual adjustments, rare engine paths) so each section ties by construction — a nonzero residual is disclosure, not error.",
      "Engine convention: \"total federal tax\" (line 24 row) is PRE-nonrefundable-credit and bundles Schedule 2 other taxes; credits are netted in the settlement section, matching the app's Tax Liability card.",
      "State \"additional credits\" = the 31-credit state package (MA Circuit Breaker, NJ property tax, OH JFC, PA SP, VA/GA/MI credits, …).",
    ],
  };
}
