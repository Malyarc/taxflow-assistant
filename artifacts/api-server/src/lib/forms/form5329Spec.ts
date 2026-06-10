/**
 * T2.1 — Form 5329 (Additional Taxes on Qualified Plans (Including IRAs) and
 * Other Tax-Favored Accounts) workpaper builder.
 *
 * Modeled parts (the only two the engine computes):
 *   Part I   — lines 1–4: §72(t) additional tax on early distributions.
 *              Engine: 10% of the taxable amount of each 1099-R with Box 7
 *              code "1"; 25% for code "S" (SIMPLE IRA in the first 2 years,
 *              §72(t)(6)). Other codes → no automatic tax.
 *   Part VII — lines 47–49 (TY2024 numbering): §4973(g) 6% excise on HSA
 *              contributions above the §223 annual limit.
 *
 * Line 1 is rebuilt from the input 1099-R facts when `ctx.inputs` is supplied
 * (the same records the engine summed); without inputs the builder degrades to
 * the engine's tax totals with the detail lines blank.
 *
 * Applicability: ret.earlyWithdrawalPenalty > 0 || ret.hsaExcessExcise > 0.
 *
 * PURE — no Date / randomness / DB / pdfkit.
 */

import {
  checkLine,
  moneyLine,
  nz,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
  type FormPart,
} from "./formSpec";

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function buildForm5329(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const hasPartI = ret.earlyWithdrawalPenalty > 0;
  const hasPartVII = ret.hsaExcessExcise > 0;
  if (!hasPartI && !hasPartVII) return null;

  const parts: FormPart[] = [];

  // ── Part I — Additional tax on early distributions (§72(t)) ──
  if (hasPartI) {
    // Mirror the engine's summarize1099s logic exactly: case-insensitive
    // formType, trimmed Box 7 code, taxable = taxableAmount ?? grossDistribution,
    // skip non-positive taxable amounts.
    let code1Taxable = 0;
    let codeSTaxable = 0;
    let sawRecords = false;
    if (inputs?.form1099s) {
      for (const r of inputs.form1099s) {
        if ((r.formType ?? "").toLowerCase() !== "r") continue;
        const taxable = toNum(r.taxableAmount ?? r.grossDistribution);
        if (taxable <= 0) continue;
        const code = (r.distributionCode ?? "").trim();
        if (code === "1") {
          code1Taxable += taxable;
          sawRecords = true;
        } else if (code === "S") {
          codeSTaxable += taxable;
          sawRecords = true;
        }
      }
    }
    const earlyTotal = code1Taxable + codeSTaxable;

    const lines: FormLine[] = [];
    if (sawRecords) {
      lines.push(
        moneyLine("1", "Early distributions includible in income (1099-R taxable amounts, Box 7 codes 1 / S)", earlyTotal),
      );
      if (nz(code1Taxable)) {
        lines.push(moneyLine("", "Code 1 — early distribution, no known exception (10%)", code1Taxable, { indent: 1 }));
      }
      if (nz(codeSTaxable)) {
        lines.push(
          moneyLine("", "Code S — SIMPLE IRA within first 2 years (25%, §72(t)(6))", codeSTaxable, { indent: 1 }),
        );
      }
    } else {
      lines.push(
        textLine("1", "Early distributions includible in income", null, {
          note: "(input 1099-R detail unavailable to this workpaper — the engine derived the line 4 tax from 1099-R Box 7 codes)",
        }),
      );
    }
    lines.push(
      textLine("2", "Early distributions not subject to additional tax (§72(t)(2) exceptions)", null, {
        note: "(CPA-supplied — the engine models no exception amounts; record an exception by re-coding the 1099-R Box 7 instead)",
      }),
    );
    if (sawRecords) {
      lines.push(moneyLine("3", "Amount subject to additional tax (line 1 minus line 2)", earlyTotal));
    }
    lines.push(
      moneyLine("4", "Additional tax (10% of line 3; 25% for SIMPLE-IRA code S)", ret.earlyWithdrawalPenalty, {
        emphasis: true,
        note: "Flows to Schedule 2, line 8. Not offset by non-refundable credits.",
      }),
    );
    if (sawRecords) {
      lines.push(
        checkLine(
          "Line 4 ties: 10% × code-1 + 25% × code-S",
          0.10 * code1Taxable + 0.25 * codeSTaxable,
          ret.earlyWithdrawalPenalty,
        ),
      );
    }
    parts.push({ title: "Part I — Additional Tax on Early Distributions (IRC §72(t))", lines });
  }

  // ── Part VII — Additional tax on excess HSA contributions (§4973(g)) ──
  if (hasPartVII) {
    const rd = ret.retirementDeductions;
    const excess = Math.max(0, rd.hsaTotalContribution - rd.hsaLimit);
    const lines: FormLine[] = [
      moneyLine("", "HSA contributions — employee (Schedule 1 candidate)", rd.hsaContribution, { indent: 1 }),
    ];
    if (nz(rd.hsaEmployerContribution)) {
      lines.push(
        moneyLine("", "HSA contributions — employer (W-2 box 12 code W; counts toward the cap)", rd.hsaEmployerContribution, {
          indent: 1,
        }),
      );
    }
    lines.push(
      moneyLine("", "Total HSA contributions (employee + employer)", rd.hsaTotalContribution, { indent: 1 }),
      moneyLine("", "§223 annual limit (coverage tier + age-55 catch-up)", rd.hsaLimit, { indent: 1 }),
      moneyLine("47", "Excess contributions for the year (total minus limit)", excess),
      moneyLine("48", "Total excess contributions", excess, {
        note: "(prior-year excess (line 42) is not modeled — current-year excess only)",
      }),
      moneyLine("49", "Additional tax: 6% of line 48 (§4973(g))", ret.hsaExcessExcise, {
        emphasis: true,
        note: "Official cap at 6% of the year-end HSA value is not modeled (the engine does not track HSA FMV). Flows to Schedule 2, line 8.",
      }),
      checkLine("Line 49 ties: 6% × line 48", 0.06 * excess, ret.hsaExcessExcise),
    );
    parts.push({
      title: "Part VII — Additional Tax on Excess Contributions to Health Savings Accounts (IRC §4973(g))",
      lines,
    });
  }

  return {
    formId: "5329",
    formNumber: "Form 5329",
    title: "Additional Taxes on Qualified Plans (Including IRAs) and Other Tax-Favored Accounts",
    subtitle: "Substitute workpaper (Pub 1167 conventions) — CPA review copy, not for filing",
    taxYear: ret.taxYear,
    parts,
    footnotes: [
      "Only Part I (§72(t) early distributions) and Part VII (HSA excess excise) are engine-modeled. Parts II–VI and VIII–IX (Roth conversions/distributions detail, education accounts, traditional-IRA/ABLE excess contributions, missed RMD §4974 tax) are not modeled — CPA prepares those from source documents.",
      "Part I trusts the 1099-R Box 7 code as entered: code 1 → 10%, code S → 25%; exception codes (2/3/4/7/G/…) → no tax. When codes 1 and S coexist the line 4 figure blends the two rates (the official form computes them on separate 5329s/line entries).",
      "A Roth distribution entered via the `roth_ira_distribution` adjustment is analyzed on the Form 8606 Part III workpaper and is NOT included in this Part I total.",
    ],
  };
}
