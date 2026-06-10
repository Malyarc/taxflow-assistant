/**
 * T2.1 — Schedule 1 (Form 1040): "Additional Income and Adjustments to Income".
 *
 * Substitute-form workpaper (Pub 1167 conventions) — a CPA review artifact,
 * NOT a filed form. Line numbers follow the official TY2024 Schedule 1.
 *
 * Tie-out identities (mirror the engine's income assembly EXACTLY):
 *
 *   Part I  : line 10 + Form 1040 lines 1–7 == ret.totalIncome
 *   Part II : line 25                       == ret.totalIncome − ret.adjustedGrossIncome
 *
 * where "Form 1040 lines 1–7" = W-2 wages (1a) + taxable interest (2b)
 * + total ordinary dividends incl. qualified (3b) + 1099-R taxable (4b/5b)
 * + taxable Social Security (6b) + capital line 7 (Schedule D / $3k limit).
 *
 * Each part carries an explicit RESIDUAL row (same device as
 * reconciliationWorksheet.ts) absorbing engine income/adjustment paths the
 * schedule does not itemize, so both parts tie BY CONSTRUCTION and the
 * unlisted portion stays visible — never silently dropped.
 *
 * Engine-semantics notes baked into this builder:
 *  - The §172 NOL deduction (official Schedule 1 line 8a) is applied by the
 *    engine at the TAXABLE-INCOME step (post-deduction, per Form 8995 line 11
 *    ordering), NOT inside total income → the 8a row here is INFORMATIONAL
 *    (excluded from the line 9/10 sums) so the Part I tie stays engine-exact.
 *  - §179 + bonus depreciation are modeled by the engine as above-the-line
 *    deductions (officially they live inside Schedule C via Form 4562) — shown
 *    on line 24z with a disclosure note.
 *  - ISO/ESPP disqualifying-disposition ordinary comp is shown on line 8k
 *    ("Stock options") — the TY2024 letter for option comp not in W-2 box 1.
 */

import {
  checkLine,
  moneyLine,
  nz,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export function buildSchedule1(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const f99 = ret.form1099Summary;
  const k1 = ret.scheduleK1;

  // ── Form 1040 lines 1–7 (the non-Schedule-1 income lines) ──
  // 1040 line 7 mirrors the engine: net gain when Schedule D line 16 ≥ 0,
  // else the $3,000/$1,500 capital-loss-deducted amount as a negative.
  const wages = (inputs?.w2s ?? [])
    .filter((w) => (w.taxYear ?? ret.taxYear) === ret.taxYear)
    .reduce((s, w) => s + toNum(w.wagesBox1), 0);
  const wagesKnown = inputs != null;
  const capitalLine7 =
    ret.netCapitalGainLoss >= 0 ? ret.netCapitalGainLoss : -ret.capitalLossDeducted;
  const lines1to7 =
    wages +
    f99.interestIncome +
    f99.ordinaryDividends +
    f99.qualifiedDividends +
    f99.retirementIncome +
    ret.socialSecurityTaxable +
    capitalLine7;

  // ── Part I — Additional income ──
  // E6/§111 — the engine taxes a 1099-G state refund only when the prior year
  // itemized. The flag lives on the input facts; without inputs the amount
  // falls into the residual row (disclosed in the footnotes).
  const taxableStateRefund =
    inputs?.client?.priorYearItemized === true ? f99.stateLocalRefundOnly : 0;
  const scheduleCNet = f99.seIncome - ret.scheduleCExpenses - ret.scheduleCDepreciation;
  const form4797Ordinary = ret.form4797?.ordinaryComponent ?? 0;
  const rentalApplied = ret.scheduleERentalAppliedToAgi;
  const k1ScheduleE =
    k1.totalActiveOrdinaryIncome + k1.totalGuaranteedPayments + k1.totalPassiveBucketNetApplied;
  const k1Portfolio = k1.totalInterestIncome + k1.totalOrdinaryDividends + k1.totalRoyalties;
  const k1QualifiedDividends = k1.totalQualifiedDividends;
  const line5Total = rentalApplied + k1ScheduleE + k1Portfolio + k1QualifiedDividends;
  const feieGross = ret.feie.taxpayerForeignIncome + ret.feie.spouseForeignIncome;

  // Line-8 "other income" additive components (each is engine-exact).
  const line8Components: Array<[string, string, number, string?]> = [
    [
      "8d",
      "Foreign earned income exclusion (Form 2555, §911)",
      -ret.feie.totalExclusion,
      "Negative. The engine applies the FEIE stacking rule downstream (tax computed at the marginal rate that would apply including the excluded amount).",
    ],
    [
      "8z",
      "Foreign earned income — gross (per §911 adjustments)",
      feieGross,
      "Official placement is Form 1040 line 1h; the engine carries it in other income, so it is shown here to keep the tie exact.",
    ],
    [
      "8k",
      "ISO disqualifying-disposition ordinary income (§421(b)/§422)",
      ret.isoDisqualifyingDispositionOrdinary,
      "Line 8k (\"Stock options\") is the TY2024 letter for option comp not reported in W-2 box 1 — the engine models this comp outside wages. CPA confirms placement (W-2-reported comp belongs on line 1a/1h).",
    ],
    [
      "8k",
      "ESPP disqualifying-disposition ordinary income (§423)",
      ret.esppDisqualifyingDispositionOrdinary,
      "Same 8k placement rationale as the ISO row. Not FICA-taxed (Notice 2002-47 / Rev. Rul. 71-52).",
    ],
    [
      "8p",
      "§461(l) excess business loss adjustment (Form 461)",
      ret.section461lExcessLossAddback,
    ],
    [
      "8z",
      "1099-MISC income (rents + royalties + other + fishing + medical)",
      f99.miscIncome,
      "The engine aggregates all 1099-MISC boxes here; officially box 1 rents / box 2 royalties flow through Schedule E to line 5.",
    ],
    ["8z", "1099-K payment-card / third-party-network income", f99.paymentCardIncome],
    [
      "8z",
      "§163(j) allowed business interest expense (Form 8990)",
      -ret.section163jAllowedDeduction,
      "Negative. Officially deducted inside the business schedule; the engine applies it as a standalone income reduction.",
    ],
  ];

  // Everything additive that Part I itemizes (lines 1–7 of the schedule plus
  // the line-8 block). The residual absorbs the rest of the engine's income
  // paths (manual additional_income/investment_income adjustments, statutory/
  // church-employee + crypto income, §469(g) disposed-rental effect, …).
  let listedPartI =
    taxableStateRefund + scheduleCNet + form4797Ordinary + line5Total + f99.unemploymentCompensationOnly;
  for (const [, , value] of line8Components) listedPartI += value;
  const partIResidual = ret.totalIncome - lines1to7 - listedPartI;

  const partILines: FormLine[] = [];
  if (nz(taxableStateRefund)) {
    partILines.push(
      moneyLine("1", "Taxable refunds of state/local income taxes (1099-G box 2)", taxableStateRefund, {
        note: "Taxable because the prior year itemized (§111 tax-benefit rule).",
      }),
    );
  }
  if (nz(scheduleCNet)) {
    partILines.push(
      moneyLine("3", "Business income or (loss) — Schedule C net", scheduleCNet, {
        note: "1099-NEC receipts − Schedule C expenses − depreciation. SE income entered as manual adjustments appears in the residual row.",
      }),
    );
  }
  if (nz(form4797Ordinary)) {
    partILines.push(
      moneyLine("4", "Other gains or (losses) — Form 4797 ordinary component", form4797Ordinary, {
        note: "§1245/§1250 recapture + net §1231 loss + §1231(c) lookback recharacterization (signed).",
      }),
    );
  }
  if (nz(rentalApplied)) {
    partILines.push(
      moneyLine("5", "Rental real estate (Schedule E, after §469 PAL limit)", rentalApplied),
    );
  }
  if (nz(k1ScheduleE)) {
    partILines.push(
      moneyLine("5", "K-1 pass-through (Sch E p.2): active ordinary + guaranteed payments + passive net applied", k1ScheduleE, {
        indent: 1,
      }),
    );
  }
  if (nz(k1Portfolio)) {
    partILines.push(
      moneyLine("5", "K-1 portfolio income: interest + ordinary dividends + royalties", k1Portfolio, {
        indent: 1,
        note: "Officially Schedule B / Schedule E Part I lines; shown with the K-1 package.",
      }),
    );
  }
  if (nz(k1QualifiedDividends)) {
    partILines.push(
      moneyLine("5", "K-1 qualified dividends", k1QualifiedDividends, {
        indent: 1,
        note: "Officially Form 1040 line 3a/3b; shown with the K-1 package so the Part I tie stays exact.",
      }),
    );
  }
  if (nz(f99.unemploymentCompensationOnly)) {
    partILines.push(
      moneyLine("7", "Unemployment compensation (1099-G box 1, §85)", f99.unemploymentCompensationOnly),
    );
  }
  // 8a NOL — informational only (see module header). NOT in the 9/10 sums.
  if (nz(ret.nolDeduction)) {
    partILines.push(
      moneyLine("8a", "Net operating loss deduction (§172) — INFORMATIONAL", -ret.nolDeduction, {
        indent: 1,
        note: "The engine applies the NOL (80% limit) at the taxable-income step, not within total income — excluded from the line 9/10 sums so they tie to the app. Official Schedule 1 reports it here as a negative.",
      }),
    );
  }
  for (const [line, label, value, note] of line8Components) {
    if (!nz(value)) continue;
    partILines.push(moneyLine(line, label, value, note ? { note } : {}));
  }
  if (nz(partIResidual)) {
    partILines.push(
      moneyLine("8z", "Other income components (residual — trace in app)", partIResidual, {
        note: "Manual additional-income/investment-income adjustments, statutory-employee / church-employee / crypto income, §469(g) disposed-rental effect, state refund when input facts are unavailable, etc.",
      }),
    );
  }
  const line9 = line8Components.reduce((s, [, , v]) => s + v, 0) + partIResidual;
  const line10 =
    taxableStateRefund +
    scheduleCNet +
    form4797Ordinary +
    line5Total +
    f99.unemploymentCompensationOnly +
    line9;
  partILines.push(moneyLine("9", "Total other income (sum of lines 8a–8z as itemized above)", line9));
  partILines.push(
    moneyLine("10", "Additional income — to Form 1040 line 8", line10, { emphasis: true }),
  );
  partILines.push(
    checkLine(
      "Line 10 + Form 1040 lines 1–7 (wages, interest, dividends, retirement, taxable SS, capital) = total income",
      line10 + lines1to7,
      ret.totalIncome,
    ),
  );

  // ── Part II — Adjustments to income ──
  const rd = ret.retirementDeductions;
  const atlTotalEngine = ret.totalIncome - ret.adjustedGrossIncome;
  const partIIComponents: Array<[string, string, number, string?]> = [
    ["11", "Educator expenses ($300/educator cap)", ret.educatorExpenses.deductible],
    ["13", "HSA deduction (Form 8889)", rd.hsaDeductible],
    ["15", "Deductible part of self-employment tax (Schedule SE)", ret.detail.se.deductibleHalf],
    ["17", "Self-employed health insurance deduction (Form 7206, §162(l))", ret.sehi.deduction],
    ["18", "Penalty on early withdrawal of savings (1099-INT box 2, §62(a)(9))", f99.interestEarlyWithdrawalPenalty],
    ["20", "Traditional IRA deduction (§219)", rd.iraDeductible],
    ["21", "Student loan interest deduction (§221)", ret.studentLoanInterest.deductible],
    [
      "24z",
      "§179 expense election applied (engine above-the-line)",
      ret.section179Applied,
      "Officially inside Schedule C via Form 4562; the engine models it as an above-the-line deduction.",
    ],
    [
      "24z",
      "Bonus depreciation §168(k) applied (engine above-the-line)",
      ret.bonusDepreciationApplied,
      "Officially inside Schedule C via Form 4562; the engine models it as an above-the-line deduction.",
    ],
  ];
  const partIILines: FormLine[] = [];
  let listedPartII = 0;
  for (const [line, label, value, note] of partIIComponents) {
    if (!nz(value)) continue;
    listedPartII += value;
    partIILines.push(moneyLine(line, label, value, note ? { note } : {}));
  }
  const partIIResidual = atlTotalEngine - listedPartII;
  if (nz(partIIResidual)) {
    partIILines.push(
      moneyLine("24z", "Other adjustments (residual — trace in app)", partIIResidual, {
        note: "Manual above-the-line adjustments (SEP/SIMPLE, alimony, `deduction`/`other` types). Negative residual can also reflect the engine's AGI floor at $0.",
      }),
    );
  }
  partIILines.push(
    moneyLine("25", "Total adjustments to income — to Form 1040 line 10", atlTotalEngine, {
      emphasis: true,
    }),
  );
  partIILines.push(
    checkLine(
      "Line 25 = total income − AGI (engine identity)",
      listedPartII + partIIResidual,
      ret.totalIncome - ret.adjustedGrossIncome,
    ),
  );

  // ── Applicability — null when the schedule has nothing to report ──
  const anyPartI =
    nz(taxableStateRefund) ||
    nz(scheduleCNet) ||
    nz(form4797Ordinary) ||
    nz(line5Total) ||
    nz(f99.unemploymentCompensationOnly) ||
    nz(ret.nolDeduction) ||
    line8Components.some(([, , v]) => nz(v)) ||
    nz(partIResidual) ||
    nz(line10);
  const anyPartII = listedPartII !== 0 || nz(partIIResidual) || nz(atlTotalEngine);
  if (!anyPartI && !anyPartII) return null;

  const footnotes = [
    "Residual rows absorb income/adjustment paths this schedule does not itemize so each part ties to the app BY CONSTRUCTION — a nonzero residual is disclosure, not error.",
    "Line 8a NOL is informational: the engine deducts the §172 NOL at the taxable-income step (post-deduction, Form 8995 line 11 ordering) rather than inside total income, so AGI-keyed phase-outs do not see it (engine sub-gap; the official form reduces AGI through line 8a).",
    "Line 24z §179/bonus-depreciation rows reflect the engine's above-the-line modeling; on an official return they reduce Schedule C net profit via Form 4562 (and would also reduce the SE-tax base — the engine's `schedule_c_depreciation` path covers that case).",
    "Manual SEP/SIMPLE/alimony-style entries are CPA `deduction`/`other` adjustments — they appear in the Part II residual, not on dedicated lines 16/19a.",
  ];
  if (!wagesKnown) {
    footnotes.push(
      "Input facts were unavailable to this builder — W-2 wages (Form 1040 line 1a) could not be separated, so they appear inside the Part I residual row.",
    );
  }

  return {
    formId: "schedule-1",
    formNumber: "Schedule 1 (Form 1040)",
    title: "Additional Income and Adjustments to Income",
    subtitle: "Substitute workpaper — engine-exact amounts tied to Form 1040 lines 8 and 10.",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — Additional Income (Form 1040 line 8)", lines: partILines },
      { title: "Part II — Adjustments to Income (Form 1040 line 10)", lines: partIILines },
    ],
    footnotes,
  };
}
