/**
 * T2.1 — Schedule B (Form 1040): Interest and Ordinary Dividends, rendered as
 * a CPA review workpaper from the engine's per-payer aggregation
 * (`ret.form1099Summary.scheduleBPayers` — grouped 1099-INT / 1099-DIV rows).
 *
 * Line numbers follow the official TY2024 Schedule B:
 *   Part I  — 1 (per-payer taxable interest), 2 (total), 3 (excludable U.S.
 *             savings bond interest, Form 8815 — not modeled), 4 (line 2 −
 *             line 3 → Form 1040 line 2b)
 *   Part II — 5 (per-payer ordinary dividends, 1099-DIV box 1a), 6 (total →
 *             Form 1040 line 3b)
 *   Part III — 7a/7b/8 foreign accounts and trusts questions (CPA answers)
 *
 * Engine-tie guarantees (verified against taxReturnEngine.ts 2026-06-09):
 *   - Per-payer taxable interest = Σ max(0, box 1 − box 8) per record, so the
 *     payer rows sum EXACTLY to form1099Summary.interestIncome (1040 line 2b).
 *   - Schedule B line 5/6 report 1099-DIV box 1a (TOTAL ordinary dividends,
 *     INCLUDING the qualified portion, per the Schedule B instructions). The
 *     engine buckets box 1a − box 1b as `ordinaryDividends` (ordinary rates)
 *     and box 1b as `qualifiedDividends` (preferential rates), so the official
 *     line 6 = ordinaryDividends + qualifiedDividends.
 *   - scheduleBRequired = interest > $1,500 OR box-1a dividends > $1,500.
 *   - Capital gain distributions (1099-DIV box 2a) are NOT Schedule B income —
 *     they flow to Schedule D line 13 (shown here informationally).
 *
 * Applicability: form1099Summary.scheduleBRequired OR scheduleBPayers
 * nonempty (under-threshold payer detail still renders, flagged as such).
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

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function buildScheduleB(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const f99 = ret.form1099Summary;
  if (!f99.scheduleBRequired && f99.scheduleBPayers.length === 0) return null;

  const payers = f99.scheduleBPayers;
  const parts: FormPart[] = [];
  const footnotes: string[] = [];

  // ── Part I — Interest ──
  const interestRows = payers.filter((p) => nz(p.interestIncome));
  if (interestRows.length > 0 || nz(f99.interestIncome)) {
    const lines: FormLine[] = [];
    let interestSum = 0;
    for (const p of interestRows) {
      interestSum += p.interestIncome;
      lines.push(
        moneyLine(
          "1",
          p.payerName,
          p.interestIncome,
          nz(p.taxExemptInterest)
            ? { note: `Plus ${usd(p.taxExemptInterest)} tax-exempt interest (Form 1040 line 2a — not on Schedule B)` }
            : {},
        ),
      );
    }
    lines.push(moneyLine("2", "Add the amounts on line 1", interestSum, { emphasis: true }));
    lines.push(
      textLine("3", "Excludable interest on series EE/I U.S. savings bonds (attach Form 8815)", null, {
        note: "(not modeled — CPA supplies)",
      }),
    );
    lines.push(
      moneyLine("4", "Subtract line 3 from line 2 — enter on Form 1040 line 2b", f99.interestIncome, {
        emphasis: true,
      }),
    );
    lines.push(checkLine("Line 4 ties to engine taxable interest (Form 1040 line 2b)", interestSum, f99.interestIncome));
    if (nz(f99.taxExemptInterest)) {
      lines.push(
        moneyLine("", "Tax-exempt interest — Form 1040 line 2a (informational, excluded from Schedule B)", f99.taxExemptInterest, {
          indent: 1,
        }),
      );
    }
    parts.push({ title: "Part I — Interest", lines });
  }

  // ── Part II — Ordinary Dividends ──
  const box1aTotal = f99.ordinaryDividends + f99.qualifiedDividends;
  const divRows = payers
    .map((p) => ({ payerName: p.payerName, box1a: p.ordinaryDividends + p.qualifiedDividends, qualified: p.qualifiedDividends }))
    .filter((p) => nz(p.box1a));
  const capGainDistTotal = payers.reduce((s, p) => s + p.totalCapitalGainDistribution, 0);
  if (divRows.length > 0 || nz(box1aTotal) || nz(capGainDistTotal)) {
    const lines: FormLine[] = [];
    let divSum = 0;
    for (const p of divRows) {
      divSum += p.box1a;
      lines.push(
        moneyLine(
          "5",
          p.payerName,
          p.box1a,
          nz(p.qualified) ? { note: `Of which qualified (1099-DIV box 1b): ${usd(p.qualified)}` } : {},
        ),
      );
    }
    if (divRows.length > 0 || nz(box1aTotal)) {
      lines.push(
        moneyLine("6", "Add the amounts on line 5 — enter on Form 1040 line 3b", box1aTotal, { emphasis: true }),
      );
      lines.push(
        checkLine(
          "Line 6 ties to engine box-1a dividends (ordinary + qualified buckets)",
          divSum,
          box1aTotal,
        ),
      );
      if (nz(f99.qualifiedDividends)) {
        lines.push(
          moneyLine("", "Of line 6, qualified dividends (Form 1040 line 3a — preferential rates)", f99.qualifiedDividends, {
            indent: 1,
          }),
        );
      }
    }
    if (nz(capGainDistTotal)) {
      lines.push(
        moneyLine("", "Capital gain distributions (1099-DIV box 2a) — report on Schedule D line 13, NOT Schedule B", capGainDistTotal, {
          indent: 1,
          note: "Engine folds these into long-term capital gains",
        }),
      );
    }
    parts.push({ title: "Part II — Ordinary Dividends", lines });
  }

  // ── Part III — Foreign Accounts and Trusts ──
  const partIII: FormLine[] = [
    textLine(
      "7a",
      "At any time during the year, did you have a financial interest in or signature authority over a financial account located in a foreign country?",
      null,
      { note: "(CPA to answer)" },
    ),
    textLine("7a", "If yes — are you required to file FinCEN Form 114 (FBAR)?", null, { note: "(CPA to answer)" }),
    textLine("7b", "If required to file FinCEN Form 114, enter the name of the foreign country", null, {
      note: "(CPA to answer)",
    }),
    textLine(
      "8",
      "During the year, did you receive a distribution from, or were you the grantor of, or transferor to, a foreign trust? (If yes, Form 3520)",
      null,
      { note: "(CPA to answer)" },
    ),
  ];
  parts.push({
    title: "Part III — Foreign Accounts and Trusts (complete if Schedule B is required)",
    lines: partIII,
  });

  // M9b — the engine's scheduleBRequired flag counts K-1 portfolio interest +
  // dividends toward the official $1,500 trigger (Schedule B instructions —
  // partnership/S-corp portfolio income belongs on Schedule B). The payer
  // rows above are 1099-only; disclose the K-1 amounts that contributed.
  const k1Interest = ret.scheduleK1.totalInterestIncome;
  const k1Box1aDividends = ret.scheduleK1.totalOrdinaryDividends + ret.scheduleK1.totalQualifiedDividends;
  const k1TriggerNote =
    k1Interest > 0 || k1Box1aDividends > 0
      ? ` K-1 portfolio amounts COUNT toward the trigger and belong on Schedule B (interest ${usd(k1Interest)}, box-1a dividends ${usd(k1Box1aDividends)}) but are not in the 1099 payer rows above — list the entity as the payer when transcribing.`
      : "";
  footnotes.push(
    f99.scheduleBRequired
      ? `Schedule B is REQUIRED for this return: taxable interest (${usd(f99.interestIncome)} + K-1 ${usd(k1Interest)}) or box-1a ordinary dividends (${usd(box1aTotal)} + K-1 ${usd(k1Box1aDividends)}) exceed the $1,500 threshold.${k1TriggerNote}`
      : `Taxable interest (${usd(f99.interestIncome)}) and box-1a ordinary dividends (${usd(box1aTotal)}), each including any K-1 portfolio portion, are at or below the $1,500 threshold — Schedule B is not strictly required; payer detail is included as workpaper support.${k1TriggerNote}`,
  );
  footnotes.push(
    "Other mandatory Schedule B triggers are NOT modeled (CPA judgment): seller-financed mortgage interest, accrued bond interest, nominee distributions, OID adjustments, frozen deposits, and the Form 8815 savings-bond exclusion — Schedule B can be required regardless of the $1,500 threshold when foreign accounts/trusts exist (Part III).",
  );
  footnotes.push(
    "Payer rows aggregate the year's 1099-INT/1099-DIV records by payer name; per-record detail (multiple accounts at one payer) is merged.",
  );

  return {
    formId: "schedule-b",
    formNumber: "Schedule B (Form 1040)",
    title: "Interest and Ordinary Dividends",
    taxYear: ret.taxYear,
    parts,
    footnotes,
  };
}
