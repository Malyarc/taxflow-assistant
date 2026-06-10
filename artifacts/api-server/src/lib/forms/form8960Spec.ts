/**
 * T2.1 — Form 8960 (Net Investment Income Tax — Individuals) workpaper builder.
 *
 * Line numbers follow the official TY2024 Form 8960:
 *   Part I   — lines 1–8  (investment income; 8 = total)
 *   Part II  — lines 9–11 (properly-allocable deductions — not modeled)
 *   Part III — lines 12–17 (individuals: 12 NII, 13 MAGI, 14 threshold,
 *              15 excess, 16 smaller-of, 17 NIIT = 16 × 3.8%)
 *
 * Source: ret.detail.niit (`calculateNiit`, taxCalculator.ts). The engine
 * builds the §1411(c) NII base from its component buckets (taxReturnEngine.ts
 * `totalInvestmentIncomeForNiit`) and exposes only the TOTAL, so Part I lists
 * the cleanly-attributable interest/dividend components and absorbs the rest
 * into an explicit residual row (the reconciliation-worksheet device) — the
 * part ties by construction and nothing is silently dropped.
 *
 * Applicability: ret.niitTax > 0.
 *
 * PURE — no Date / randomness / DB / pdfkit.
 */

import {
  checkLine,
  moneyLine,
  nz,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

const NIIT_RATE = 0.038;

export function buildForm8960(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  if (!(ret.niitTax > 0)) return null;

  const n = ret.detail.niit;
  const f99 = ret.form1099Summary;
  const k1 = ret.scheduleK1;

  // ── Part I — Investment income ──
  // Mirror the engine's NII assembly for the two cleanly-exposed buckets:
  //   interest  = 1099-INT (net of tax-exempt) + K-1 interest
  //   dividends = 1099-DIV non-qualified + qualified (1099 + K-1) + K-1 ordinary
  const interest = f99.interestIncome + k1.totalInterestIncome;
  const dividends =
    f99.ordinaryDividends + f99.qualifiedDividends + k1.totalOrdinaryDividends + k1.totalQualifiedDividends;

  const partI: FormLine[] = [];
  let listed = 0;
  if (nz(interest)) {
    partI.push(moneyLine("1", "Taxable interest (1099-INT + K-1)", interest));
    listed += interest;
  }
  if (nz(dividends)) {
    partI.push(moneyLine("2", "Dividends — ordinary + qualified (1099-DIV + K-1)", dividends));
    listed += dividends;
  }
  const residual = n.investmentIncome - listed;
  if (nz(residual)) {
    partI.push(
      moneyLine("4a–7", "Other net investment income (residual — trace in app)", residual, {
        note:
          "Rents/royalties (1099-MISC + K-1), passive rental + passive K-1 net income, and post-netting gains on dispositions (Schedule D incl. §121 remainder, §1031 recognized boot, taxable QSBS) net of exclusions. A negative residual means netting/exclusions reduced the listed components.",
      }),
    );
  }
  partI.push(
    moneyLine("8", "Total investment income (engine §1411(c) base)", n.investmentIncome, {
      emphasis: true,
      note:
        "Excluded by the engine: non-passive trade/business income (active K-1, Schedule C), a real-estate professional's rental income, and CPA-flagged non-passive §1231 gains.",
    }),
  );
  partI.push(checkLine("Part I components + residual tie to line 8", listed + residual, n.investmentIncome));

  // ── Part II — Properly-allocable deductions (not modeled) ──
  const partII: FormLine[] = [
    moneyLine("11", "Total deductions and modifications", 0, {
      note:
        "(not modeled — the engine taxes GROSS investment income; properly-allocable deductions per Reg. §1.1411-4(f) (investment interest expense, allocable state income tax, advisory fees) are a CPA adjustment. Conservative-high NII.)",
    }),
  ];

  // ── Part III — Tax computation (individuals) ──
  // MAGI is not exposed on NiitCalculation; it reconstructs EXACTLY as
  // threshold + excessOverThreshold because this form only renders when
  // niitTax > 0 → MAGI > threshold (the max(0,·) is not binding).
  const magi = n.threshold + n.excessOverThreshold;
  const partIII: FormLine[] = [
    moneyLine("12", "Net investment income (line 8 minus line 11)", n.investmentIncome),
    moneyLine("13", "Modified adjusted gross income", magi, {
      note: "Derived: line 14 + line 15. §1411(d) MAGI = AGI + the §911 FEIE add-back (engine passes it internally).",
    }),
    moneyLine("14", "Filing-status threshold", n.threshold, {
      note: "$200,000 single/HoH; $250,000 MFJ/QSS; $125,000 MFS (IRC §1411(b), not inflation-indexed).",
    }),
    moneyLine("15", "Line 13 minus line 14 (if zero or less, -0-)", n.excessOverThreshold),
    moneyLine("16", "Smaller of line 12 or line 15", n.taxableAmount, {
      note: "NIIT applies to the LESSER of net investment income or the MAGI excess over the threshold.",
    }),
    moneyLine("17", "Net investment income tax (line 16 × 3.8%)", n.niitTax, {
      emphasis: true,
      note: "Flows to Schedule 2, line 12.",
    }),
    checkLine("Line 16 ties: min(line 12, line 15)", Math.min(n.investmentIncome, n.excessOverThreshold), n.taxableAmount),
    checkLine("Line 17 ties: line 16 × 3.8%", n.taxableAmount * NIIT_RATE, n.niitTax),
    checkLine("Line 17 ties to the engine's NIIT", n.niitTax, ret.niitTax),
  ];

  return {
    formId: "8960",
    formNumber: "Form 8960",
    title: "Net Investment Income Tax — Individuals, Estates, and Trusts",
    subtitle: "Substitute workpaper (Pub 1167 conventions) — CPA review copy, not for filing",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — Investment Income", lines: partI },
      { title: "Part II — Investment Expenses Allocable to Investment Income", lines: partII },
      { title: "Part III — Tax Computation (Individuals)", lines: partIII },
    ],
    footnotes: [
      "Official lines 1–7 are not individually exposed by the engine; the residual row absorbs the buckets it tracks internally (rents/royalties, passive pass-through, net disposition gains) so Part I ties by construction.",
      "Part II properly-allocable deductions are not modeled — the engine's NII is the gross §1411(c) base, which can only OVERSTATE the tax (the safe direction). The engine's §163(d) investment-interest deduction reduces itemized deductions but is NOT netted against NII here.",
      "Engine exclusions applied upstream: real-estate-professional rental income (client flag), non-passive §1231 gains (Form 4797 `nonPassive` flag, capped at the surviving net disposition gain), and non-passive trade/business income (active K-1 / Schedule C).",
    ],
  };
}
