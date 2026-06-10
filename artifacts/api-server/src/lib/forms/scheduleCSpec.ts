/**
 * T2.1 — Schedule C (Form 1040) substitute workpaper: Profit or Loss From
 * Business (Sole Proprietorship). Pub 1167 substitute for CPA review — NOT a
 * filed form. Line numbers per the official TY2024 Schedule C.
 *
 * Engine model (taxReturnEngine.ts) — the engine keeps ONE aggregate Schedule C:
 *
 *   line 1 gross receipts = 1099-NEC nonemployee comp (form1099Summary.seIncome)
 *                         + `self_employment_income` adjustments (signed)
 *                         + `crypto_mining_income` adjustments (trade/business
 *                           mining — SE-taxable per Notice 2014-21)
 *   line 13 depreciation  = `schedule_c_depreciation` manual adjustment
 *                         + asset-register total (computeScheduleCAssetDepreciation:
 *                           §179 + §168(k) bonus + MACRS) = ret.scheduleCDepreciation
 *   line 28 total exp     = `schedule_c_expenses` aggregate + line 13
 *   line 31 (signed)      = receipts − expenses − depreciation → Schedule 1 line 3.
 *                           A LOSS flows to AGI (capped by the §461(l) excess-
 *                           business-loss addback); the SE-tax / QBI / earned-
 *                           income base stays floored at 0 (a loss may not
 *                           reduce those — engine invariant).
 *
 * NOTE on expenses: the engine DEDUCTS the uncapped `schedule_c_expenses` sum
 * in the signed net; the `ret.scheduleCExpenses` output field is display-capped
 * at gross receipts. This workpaper shows the deducted (uncapped) figure when
 * input-level facts are available and discloses any divergence in a footnote.
 *
 * Related streams disclosed (not Schedule C income in the engine):
 *   - `statutory_employee_income` — W-2 Box 13 statutory employee: belongs on
 *     its OWN Schedule C per the form instructions; the engine routes it to
 *     ordinary income + §199A QBI with NO SE tax (FICA was withheld on the W-2).
 *   - `clergy_housing_allowance` — income-tax-EXEMPT (§107) so never in line 1,
 *     but SE-taxable (§1402(a)(8)) via Schedule SE.
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

const fmtUsd = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function buildScheduleC(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const f99 = ret.form1099Summary;

  // ── Mirror the engine's applied-adjustment filter (isApplied !== false) ──
  const applied = (inputs?.adjustments ?? []).filter((a) => a.isApplied !== false);
  const sumAdj = (type: string): number =>
    applied
      .filter((a) => a.adjustmentType === type)
      .reduce((s, a) => s + toNum(a.amount), 0);

  // Receipts components (engine: grossSeIncome = adj SE + NEC + crypto mining).
  const necIncome = f99.seIncome;
  const adjSeIncome = inputs ? sumAdj("self_employment_income") : 0; // signed, like the engine
  const cryptoMining = inputs ? Math.max(0, sumAdj("crypto_mining_income")) : 0;
  const receipts = necIncome + adjSeIncome + cryptoMining;

  // Expense components.
  const expensesRaw = inputs
    ? Math.max(0, sumAdj("schedule_c_expenses")) // the figure the engine deducts
    : ret.scheduleCExpenses; // graceful degradation: display-capped engine output
  const depreciation = ret.scheduleCDepreciation;

  // Disclosure-only streams.
  const statutoryIncome = inputs ? Math.max(0, sumAdj("statutory_employee_income")) : 0;
  const clergyHousing = inputs ? Math.max(0, sumAdj("clergy_housing_allowance")) : 0;
  const churchIncome = inputs ? Math.max(0, sumAdj("church_employee_income")) : 0;
  const seOptionalGross = inputs ? Math.max(0, sumAdj("se_optional_method_nonfarm")) : 0;

  // ── Applicability: any Schedule C activity to report ──
  // (Orchestrator minimum: seIncome > 0 || scheduleCExpenses > 0. Broadened to
  // adjustment-sourced receipts, depreciation, and the statutory-employee
  // stream so an adjustment-only sole prop still gets its workpaper.)
  if (
    !nz(receipts) &&
    !nz(ret.scheduleCExpenses) &&
    !nz(depreciation) &&
    !nz(statutoryIncome)
  ) {
    return null;
  }

  const net = receipts - expensesRaw - depreciation; // official line 29 = line 31 (no line 30 modeled)

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

  // ── Part I — Income ──
  const incomeLines: FormLine[] = [];
  const receiptComponents: Array<[string, number]> = [];
  if (inputs) {
    if (nz(necIncome)) receiptComponents.push(["1099-NEC nonemployee compensation (aggregated)", necIncome]);
    if (nz(adjSeIncome)) receiptComponents.push(["CPA self-employment income adjustments", adjSeIncome]);
    if (nz(cryptoMining)) receiptComponents.push(["Crypto-mining income (trade or business, Notice 2014-21)", cryptoMining]);
  }
  const singleSourceNote =
    receiptComponents.length === 1 ? ` Entirely from: ${receiptComponents[0][0]}.` : "";
  incomeLines.push(
    moneyLine("1", "Gross receipts or sales", receipts, {
      note:
        "Engine aggregate. Returns & allowances (line 2), COGS (line 4 / Part III), and other income (line 6) are not separately modeled — net them within the CPA's per-category P&L." +
        singleSourceNote,
    }),
  );
  if (receiptComponents.length >= 2) {
    for (const [label, value] of receiptComponents) {
      incomeLines.push(moneyLine("", label, value, { indent: 1 }));
    }
  }
  incomeLines.push(
    moneyLine("7", "Gross income", receipts, {
      emphasis: true,
      note: "Equals line 1 (lines 2–6 not separately modeled).",
    }),
  );
  if (nz(statutoryIncome)) {
    incomeLines.push(
      moneyLine(
        "",
        "Statutory-employee income (separate Schedule C stream — NOT in line 1)",
        statutoryIncome,
        {
          note:
            "W-2 Box 13 statutory employee: reported on its own Schedule C. The engine routes the net to ordinary income + §199A QBI with NO SE tax (FICA was already withheld on the W-2).",
        },
      ),
    );
  }
  if (nz(clergyHousing)) {
    incomeLines.push(
      moneyLine("", "Clergy housing allowance (info — NOT Schedule C income)", clergyHousing, {
        note:
          "Excluded from gross income under IRC §107; included in net earnings from self-employment under §1402(a)(8) — see Schedule SE.",
      }),
    );
  }

  // ── Part II — Expenses ──
  const expenseLines: FormLine[] = [];
  if (nz(expensesRaw)) {
    expenseLines.push(
      moneyLine("8–27a", "Total expenses other than depreciation (engine aggregate)", expensesRaw, {
        note: "Per-category expense detail (lines 8 through 27a) lives in the CPA's prep software / client P&L.",
      }),
    );
  }
  if (nz(depreciation)) {
    expenseLines.push(
      moneyLine("13", "Depreciation and section 179 expense deduction (Form 4562)", depreciation, {
        note: ret.scheduleCAssetDepreciation
          ? "Asset-register computation (Form 4562 workpaper) + any CPA-entered depreciation adjustment; components below."
          : "CPA-entered `schedule_c_depreciation` figure (the computed Form 4562 amount).",
      }),
    );
    const assetDep = ret.scheduleCAssetDepreciation;
    if (assetDep) {
      if (nz(assetDep.section179Deduction)) {
        expenseLines.push(
          moneyLine("", "§179 expense deduction (after dollar / investment / income limits)", assetDep.section179Deduction, { indent: 1 }),
        );
      }
      if (nz(assetDep.bonusDeduction)) {
        expenseLines.push(
          moneyLine("", "§168(k) bonus (special) depreciation", assetDep.bonusDeduction, { indent: 1 }),
        );
      }
      if (nz(assetDep.macrsDeduction)) {
        expenseLines.push(
          moneyLine("", "MACRS depreciation (Pub 946)", assetDep.macrsDeduction, { indent: 1 }),
        );
      }
      const manualPortion = depreciation - assetDep.totalDepreciation;
      if (nz(manualPortion)) {
        expenseLines.push(
          moneyLine("", "CPA-entered depreciation adjustment (outside the asset register)", manualPortion, { indent: 1 }),
        );
      }
    }
  }
  expenseLines.push(
    moneyLine("28", "Total expenses (lines 8 through 27a, including line 13)", expensesRaw + depreciation, {
      emphasis: true,
    }),
  );
  expenseLines.push(
    moneyLine("29", "Tentative profit or (loss) (line 7 − line 28)", net, {
      note: "Form 8829 home-office expense (line 30) is not separately modeled — include any allowable amount in the expense aggregate.",
    }),
  );
  const lossNotes: string[] = [];
  if (net >= 0) {
    lossNotes.push("Flows to Schedule 1 line 3 and (with K-1 box 14A) to Schedule SE line 2.");
  } else {
    lossNotes.push(
      "Loss flows to AGI (Schedule 1 line 3); the SE-tax / QBI / earned-income base is floored at $0 — a Schedule C loss does not reduce SE tax.",
    );
  }
  if (ret.section461lExcessLossAddback > 0) {
    lossNotes.push(
      `§461(l) interplay: the engine adds back ${fmtUsd(ret.section461lExcessLossAddback)} of excess business loss (Schedule 1 line 8p), limiting the loss that nets against other income.`,
    );
  }
  expenseLines.push(
    moneyLine("31", "Net profit or (loss)", net, {
      emphasis: true,
      note: lossNotes.join(" "),
    }),
  );

  // Tie-out: the engine's Schedule SE line-2 Schedule C portion must equal
  // max(0, line 31). Derivable only when the SE base decomposes cleanly:
  // per-spouse MFJ attribution apportions expenses differently, the optional
  // method replaces the Sch C net, and a negative K-1 box 14A can clamp the
  // base — skip the row in those cases rather than show a false ⚠.
  const k1Se = ret.scheduleK1.totalSelfEmploymentEarnings;
  if (inputs && !mfjPerSpouseSe && !nz(seOptionalGross) && k1Se >= 0) {
    const seImpliedSchC = ret.detail.se.seIncomeReported - k1Se - clergyHousing - churchIncome;
    expenseLines.push(
      checkLine(
        "Schedule SE line 2 Schedule C portion equals max(0, line 31)",
        seImpliedSchC,
        Math.max(0, net),
        { note: "Engine invariant: a Schedule C loss does not reduce the SE-tax base (floored at $0)." },
      ),
    );
  }

  // ── Footnotes ──
  const footnotes: string[] = [
    "Substitute form per IRS Pub 1167 conventions — CPA review workpaper, NOT for filing. Amounts are engine-exact (cents); the official form rounds to whole dollars.",
    "The engine models ONE aggregate Schedule C. Per-category expenses (lines 8–27a), returns & allowances, COGS (Part III), home office (Form 8829 / line 30), and vehicle detail (Part IV) live in the CPA's prep software.",
  ];
  if (!inputs) {
    footnotes.push(
      "Built without input-level facts: line 1 shows only 1099-NEC receipts (CPA self-employment-income / crypto-mining adjustments are not visible at this level) and the expense aggregate is the app's display figure (capped at gross receipts).",
    );
  }
  if (inputs && Math.abs(expensesRaw - ret.scheduleCExpenses) >= 0.005) {
    footnotes.push(
      `Expenses exceed gross receipts: the app's Schedule C expense display caps at receipts (${fmtUsd(ret.scheduleCExpenses)}); this workpaper deducts the full engine amount ${fmtUsd(expensesRaw)} in the line 31 loss.`,
    );
  }
  if (nz(statutoryIncome)) {
    footnotes.push(
      "Statutory-employee income (`statutory_employee_income`) routes to ordinary income + §199A QBI with NO SE tax — disclosed above as a separate Schedule C stream; it is not combined with line 1 of this aggregate.",
    );
  }
  if (nz(clergyHousing)) {
    footnotes.push(
      "Clergy housing allowance is income-tax-exempt (§107) but SE-taxable (§1402(a)(8)); it appears on the Schedule SE workpaper, not in line 1 here.",
    );
  }
  if (mfjPerSpouseSe) {
    footnotes.push(
      "MFJ per-spouse SE attribution is active (records tagged spouse=\"spouse\"): the engine apportions Schedule C expenses to the taxpayer's gross when splitting the SE base, so the Schedule SE line-2 tie-out row is omitted on this aggregate view.",
    );
  }

  return {
    formId: "schedule-c",
    formNumber: "Schedule C (Form 1040)",
    title: "Profit or Loss From Business",
    subtitle: "(Sole Proprietorship) — engine aggregate, substitute workpaper",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — Income", lines: incomeLines },
      { title: "Part II — Expenses", lines: expenseLines },
    ],
    footnotes,
  };
}
