/**
 * T2.1 — Form 2555 (Foreign Earned Income) substitute workpaper.
 *
 * Renders the engine's §911 FEIE computation (`ret.feie`, K9) against the
 * official TY2024 Form 2555 line skeleton:
 *   Part IV  line 26 — total foreign earned income (per person)
 *   Part VII line 37 — maximum exclusion (annual cap, noted per year)
 *   Part VII line 42 — foreign earned income exclusion (capped)
 *   Part VIII line 45 — amount to Schedule 1 (Form 1040) line 8d, in parentheses
 *
 * The official Form 2555 is filed PER PERSON — an MFJ couple where both
 * spouses qualify files two Forms 2555. The workpaper renders one part per
 * person plus a combined Schedule-1 tie section.
 *
 * Engine semantics (taxReturnEngine.ts / taxCalculator.calculateFeie):
 *   - exclusion = min(foreign earned income, year cap) per spouse;
 *   - gross foreign income enters total income, the exclusion is subtracted
 *     (net effect: only the over-cap remainder is in AGI);
 *   - the IRS "stacking rule" (Foreign Earned Income Tax Worksheet) is applied
 *     at the federal-tax step: tax = tax(taxable + FEIE) − tax(FEIE).
 */

import {
  checkLine,
  moneyLine,
  nz,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
  type FormPart,
} from "./formSpec";

/**
 * Annual §911(b)(2)(D) exclusion caps — used ONLY in display notes (the
 * dollar VALUES on lines come from the engine). TY2024 $126,500 (Rev. Proc.
 * 2023-34); TY2025 $130,000 (Rev. Proc. 2024-40); TY2026 $132,900 (Rev.
 * Proc. 2025-32 §4.39). Mirrors the engine's FEIE_CAP table.
 */
const FEIE_CAP_NOTE: Record<number, number> = { 2024: 126500, 2025: 130000, 2026: 132900 };

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function buildForm2555(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const feie = ret.feie;

  // Applicable only when the engine actually excluded something.
  if (!nz(feie.totalExclusion)) return null;

  const cap = FEIE_CAP_NOTE[ret.taxYear];
  const capNote =
    cap != null
      ? `Line 37 maximum exclusion for TY${ret.taxYear}: ${fmtUsd(cap)} (§911(b)(2)(D)). Engine assumes a FULL qualifying year — the lines 38–39 day-count proration is not modeled (CPA pro-rates a partial year).`
      : `Annual §911(b)(2)(D) cap applied by the engine. Day-count proration (lines 38–39) not modeled.`;

  const personPart = (
    who: "Taxpayer" | "Spouse",
    foreignIncome: number,
    exclusion: number,
  ): FormPart => {
    const lines: FormLine[] = [
      moneyLine("26", `Total foreign earned income (${who.toLowerCase()})`, foreignIncome, {
        note: "Part IV — wages / SE earned abroad while qualifying (bona fide residence or 330-day physical presence; CPA verifies Part II/III).",
      }),
      moneyLine("42", "Foreign earned income exclusion (smaller of line 40 or 41)", exclusion, {
        note: capNote,
      }),
    ];
    if (nz(foreignIncome - exclusion)) {
      lines.push(
        moneyLine("", "Foreign earned income above the cap (remains in AGI)", foreignIncome - exclusion, {
          indent: 1,
          note: "The over-cap remainder stays in total income at ordinary rates.",
        }),
      );
    }
    lines.push(
      moneyLine("45", "Exclusion to Schedule 1 (Form 1040) line 8d — entered in parentheses", exclusion, {
        emphasis: true,
        note: "Line 45 = line 43 − line 44. Housing exclusion (line 36) and allocable deductions (line 44) are not modeled → line 45 = line 42.",
      }),
    );
    return { title: `Part IV / VII — ${who}'s Form 2555 (filed per person)`, lines };
  };

  const parts: FormPart[] = [personPart("Taxpayer", feie.taxpayerForeignIncome, feie.taxpayerExclusion)];
  if (nz(feie.spouseForeignIncome) || nz(feie.spouseExclusion)) {
    parts.push(personPart("Spouse", feie.spouseForeignIncome, feie.spouseExclusion));
  }

  const grossForeign = feie.taxpayerForeignIncome + feie.spouseForeignIncome;
  const combined: FormLine[] = [
    moneyLine("", "Gross foreign earned income included in total income before exclusion", grossForeign),
    moneyLine("8d", "Total foreign earned income exclusion (all Forms 2555)", feie.totalExclusion, {
      emphasis: true,
      note: "Schedule 1 (Form 1040) line 8d — a NEGATIVE income entry on the return.",
    }),
    checkLine(
      "Total exclusion = taxpayer line 42 + spouse line 42",
      feie.taxpayerExclusion + feie.spouseExclusion,
      feie.totalExclusion,
    ),
  ];

  return {
    formId: "2555",
    formNumber: "Form 2555",
    title: "Foreign Earned Income",
    subtitle: "Foreign earned income exclusion (IRC §911) — substitute workpaper, not a filed form",
    taxYear: ret.taxYear,
    parts: [...parts, { title: "Schedule 1 tie-out (combined)", lines: combined }],
    footnotes: [
      "STACKING RULE (Foreign Earned Income Tax Worksheet — 1040 instructions): tax on the remaining taxable income is computed at the marginal rate AS IF the excluded income were included — engine computes tax(taxable + FEIE) − tax(FEIE). The exclusion removes income from the base but does NOT lower the rate on the rest.",
      "Not modeled (CPA supplies on the official form): housing exclusion/deduction (Parts VI, VIII line 36, Part IX), the lines 38–39 day-count proration for a partial qualifying year, and the Part II / Part III qualification tests (bona fide residence / physical presence) — the engine assumes the entered foreign earned income qualifies.",
      "Married filing separately: the engine ignores the spouse foreign-income adjustment for MFS — each MFS spouse claims their own cap on their own return.",
      "A Form 2555 filer is generally ineligible for the EITC (§32(c)(1)(C)) and the foreign tax credit cannot be claimed on excluded income (§911(d)(6)) — CPA confirms no double benefit.",
    ],
  };
}
