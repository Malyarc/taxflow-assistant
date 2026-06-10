/**
 * T2.1 — Form 8615 (Tax for Certain Children Who Have Unearned Income —
 * "kiddie tax") workpaper builder. INFORMATIONAL.
 *
 * The engine computes the kiddie tax INSIDE `calculateFederalTaxWithCapitalGains`
 * (taxCalculator.ts): child's tax = MAX(regular method, kiddie method), where the
 * kiddie method taxes net unearned income above the §1(g)(4) threshold at the
 * CPA-supplied parent top marginal rate (Form 8615, line 18 analogue). The
 * result is folded into Form 1040 line 16 — the engine does NOT expose the
 * official lines 1–18 individually, so this workpaper renders the inputs +
 * method as CPA review context rather than a per-line substitute.
 *
 * Threshold (2× the §63(c)(5)(A) dependent floor): $2,600 TY2024 (Rev. Proc.
 * 2023-34) / $2,700 TY2025 (Rev. Proc. 2024-40) / $2,700 TY2026 (Rev. Proc.
 * 2025-32, flat). Mirrors the engine's KIDDIE_TAX_THRESHOLD — the test suite
 * pins the two in sync.
 *
 * Applicability: taxpayer.isKiddieTaxFiler === true.
 *
 * PURE — no Date / randomness / DB / pdfkit.
 */

import {
  moneyLine,
  nz,
  pctLine,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

/** §1(g)(4) net-unearned-income threshold by year (engine KIDDIE_TAX_THRESHOLD mirror). */
const KIDDIE_THRESHOLD_BY_YEAR: Record<number, number> = {
  2024: 2600, // Rev. Proc. 2023-34
  2025: 2700, // Rev. Proc. 2024-40
  2026: 2700, // Rev. Proc. 2025-32 (flat vs 2025)
};

export function buildForm8615(ctx: FormBuildContext): FormInstance | null {
  const { taxpayer, ret } = ctx;
  if (taxpayer.isKiddieTaxFiler !== true) return null;

  const threshold = KIDDIE_THRESHOLD_BY_YEAR[ret.taxYear] ?? null;
  const f99 = ret.form1099Summary;
  const k1 = ret.scheduleK1;
  const parentRate =
    taxpayer.parentsTopMarginalRate != null && Number.isFinite(Number(taxpayer.parentsTopMarginalRate))
      ? Number(taxpayer.parentsTopMarginalRate)
      : null;

  const lines: FormLine[] = [];

  // Unearned-income context — the engine outputs that feed its internal
  // unearned-income derivation (interest + dividends + positive net capital
  // gains, incl. the K-1 portfolio buckets). Clearly labeled as context, NOT
  // the official line 1 (the exact engine figure is internal).
  const interest = f99.interestIncome + k1.totalInterestIncome;
  const dividends =
    f99.ordinaryDividends + f99.qualifiedDividends + k1.totalOrdinaryDividends + k1.totalQualifiedDividends;
  if (nz(interest)) {
    lines.push(moneyLine("", "Taxable interest (context — 1099-INT + K-1)", interest, { indent: 1 }));
  }
  if (nz(dividends)) {
    lines.push(moneyLine("", "Dividends, ordinary + qualified (context — 1099-DIV + K-1)", dividends, { indent: 1 }));
  }
  if (ret.netCapitalGainLoss > 0 && nz(ret.netCapitalGainLoss)) {
    lines.push(
      moneyLine("", "Net capital gain, Schedule D line 16 (context)", ret.netCapitalGainLoss, { indent: 1 }),
    );
  }

  lines.push(
    threshold != null
      ? moneyLine("2", "Net-unearned-income threshold (§1(g)(4))", threshold, {
          note: "$2,600 TY2024 (Rev. Proc. 2023-34) / $2,700 TY2025 (Rev. Proc. 2024-40) / $2,700 TY2026. Unearned income above this is taxed at the parent's rate.",
        })
      : textLine("2", "Net-unearned-income threshold (§1(g)(4))", null, {
          note: "(threshold not on file for this tax year — CPA verifies against the year's Rev. Proc.)",
        }),
  );

  if (parentRate != null) {
    lines.push(
      pctLine("", "Parent's top marginal rate (CPA-supplied)", parentRate, {
        note: "The engine taxes net unearned income above the threshold at this flat rate — see method note + footnote.",
      }),
    );
  } else {
    lines.push(
      textLine("", "Parent's top marginal rate (CPA-supplied)", null, {
        note: "(not on file — the engine then applies a 0% parent rate; kiddie method degenerates to the regular method)",
      }),
    );
  }

  lines.push(
    moneyLine("", "Limited dependent standard deduction applied (§63(c)(5))", ret.standardDeduction, {
      note: "A kiddie-tax filer is a dependent by definition — greater of the floor or earned income + $450, capped at the regular amount.",
    }),
    textLine("18", "Method (engine)", "tax = MAX(regular method, kiddie method at parent rate over threshold)", {
      note:
        "Kiddie method: child's tax on income net of the parent-rate portion (preferential rates preserved) + parent's rate × min(net unearned income, taxable income). The result is folded into Form 1040 line 16 — it is NOT a separate line on this return.",
      emphasis: true,
    }),
  );

  return {
    formId: "8615",
    formNumber: "Form 8615",
    title: "Tax for Certain Children Who Have Unearned Income",
    subtitle: "Informational workpaper — the kiddie-tax result is inside Form 1040 line 16",
    taxYear: ret.taxYear,
    parts: [{ title: "Kiddie tax — engine inputs and method (informational)", lines }],
    footnotes: [
      "The engine does not expose the official Form 8615 lines 1–18 individually — it computes the MAX(regular, kiddie) overlay inside the Form 1040 line-16 tax. This workpaper shows the inputs + method for CPA review; prepare the official Form 8615 from the source documents.",
      "Engine approximation: the official form recomputes tax using the PARENT'S actual taxable income, filing status, and any sibling 8615s (lines 6–13); the engine instead applies the CPA-supplied flat parent top marginal rate to net unearned income (preferential-rate character of the child's own income is preserved). Verify against the parent's return when the parent straddles a bracket.",
      "The engine's unearned-income figure = taxable interest + ordinary and qualified dividends (1099 + K-1 portfolio) + positive post-netting capital gains. Earned income enters only through the dependent standard-deduction limit.",
    ],
  };
}
