/**
 * T2.1 — Form 6251 (Alternative Minimum Tax — Individuals) workpaper builder.
 *
 * Line numbers follow the official TY2024 Form 6251 layout:
 *   Part I  — lines 1, 2a–2t, 3, 4 (AMTI)
 *   Part II — lines 5 (exemption), 6, 7 (TMT rate computation / Part III),
 *             8 (AMT FTC), 9 (tentative minimum tax), 10 (regular tax), 11 (AMT)
 *
 * The engine (`calculateAmt`, taxCalculator.ts) carries all Form 6251 line-2
 * adjustments as ONE aggregate (`federalAmtPreferences`), so Part I renders the
 * aggregate with a note naming each modeled component; the ATNOLD (line 2f) is
 * exposed separately (`atnoldApplied`) and gets its own row. Part II shows BOTH
 * tentative-minimum-tax paths (full 26%/28% vs Part III preferential preserved)
 * and ties the MIN to the engine's `amtBeforeRegular`.
 *
 * Applicability: ret.amtTax > 0 (the packet only includes forms with something
 * to report; an AMT-shadow disclosure for near-AMT filers is a future nicety).
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
} from "./formSpec";

export function buildForm6251(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  if (!(ret.amtTax > 0)) return null;

  const amt = ret.detail.amt;
  const isMfs = ret.filingStatus === "married_filing_separately";

  // ── Part I — Alternative Minimum Taxable Income ──
  // The engine computes amti = max(0, taxableIncome + federalAmtPreferences)
  // − atnoldApplied, so the pre-ATNOLD aggregate adjustment reconstructs as
  // amti + atnoldApplied − taxableIncome (exact; any max(0,·) flooring of a
  // net-negative adjustment is absorbed into the aggregate, which is the
  // as-computed truth).
  const aggregateAdjustments = amt.amti + amt.atnoldApplied - ret.taxableIncome;

  const partI: FormLine[] = [
    moneyLine("1", "Taxable income (Form 1040, line 15)", ret.taxableIncome),
    moneyLine("2a–3", "Preferences and adjustments (engine aggregate)", aggregateAdjustments, {
      note:
        "Engine-modeled components, not split per sub-line: standard-deduction addback (line 2a, non-itemizers, §56(b)(1)(E)) OR Schedule A SALT addback (line 2a, itemizers); taxable state-refund removal (line 2b, negative); §1202 QSBS 7%-of-exclusion preference (line 2h, §57(a)(7)); ISO bargain element (line 2i, `amt_iso_bargain_element`); MACRS-vs-ADS depreciation (line 2l, ±, `amt_depreciation_adjustment`); plus the legacy catch-all `amt_preferences` adjustment (line 3).",
    }),
  ];
  if (nz(amt.atnoldApplied)) {
    partI.push(
      moneyLine("2f", "Alternative tax net operating loss deduction (ATNOLD, §56(d))", -amt.atnoldApplied, {
        note: "Limited to 90% of AMTI computed without the ATNOLD; the unused excess carries forward.",
      }),
    );
  }
  partI.push(
    moneyLine("4", "Alternative minimum taxable income (combine lines 1 through 3)", amt.amti, {
      emphasis: true,
    }),
  );
  partI.push(
    checkLine(
      "Line 4 ties: line 1 + adjustments − ATNOLD = engine AMTI",
      ret.taxableIncome + aggregateAdjustments - amt.atnoldApplied,
      amt.amti,
    ),
  );

  // ── Part II — Alternative Minimum Tax ──
  const partII: FormLine[] = [
    moneyLine("5", "Exemption (after phase-out)", amt.exemption, {
      note:
        "Phases out 25¢ per $1 of AMTI over the filing-status start (TY2024 $609,350 single / $1,218,700 MFJ; 50¢ per $1 from TY2026 per OBBBA §70107)." +
        (isMfs
          ? " MFS: once the exemption is fully phased out, the §55(d)(3) phantom add-back increases the AMT base inside the engine (not shown as a separate line)."
          : ""),
    }),
    moneyLine("6", "Line 4 minus line 5 (if zero or less, AMT base is 0)", Math.max(0, amt.amti - amt.exemption), {
      note: isMfs
        ? "Display value; the engine's actual base may be higher at very high AMTI due to the MFS §55(d)(3) add-back."
        : undefined,
    }),
    moneyLine("", "Path A — 26%/28% on the full AMT base", amt.amtAtFullRateOnAmtBase, {
      indent: 1,
      note: "26% up to the rate breakpoint ($232,600 TY2024; halved for MFS), 28% above.",
    }),
    moneyLine("", "Path B — Part III: LTCG/QDIV preserved at 0/15/20%", amt.amtWithPreferentialRates, {
      indent: 1,
      note: `LTCG + qualified dividends inside the AMT base: $${amt.ltcgQdivInAmtBase.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Unrecaptured §1250 (25%) and 28%-rate collectibles/§1202 buckets pass through Part III via the Schedule D Tax Worksheet, which INTERLEAVES them with the ordinary brackets — taxed at ordinary rates up to the top of the 24% bracket, with the 25%/28% statutory maxima applying only to the remainder above that (Form 6251 lines 36–40); they are NOT a flat 25%/28%.`,
    }),
    moneyLine("7", "Tentative minimum tax rate computation (lesser of Path A / Path B)", amt.amtBeforeRegular, {
      emphasis: true,
    }),
    checkLine(
      "Line 7 ties: MIN(Path A, Path B)",
      Math.min(amt.amtAtFullRateOnAmtBase, amt.amtWithPreferentialRates),
      amt.amtBeforeRegular,
    ),
    textLine("8", "Alternative minimum tax foreign tax credit", null, {
      note: "(not modeled — CPA supplies; the engine treats line 9 = line 7)",
    }),
    moneyLine("9", "Tentative minimum tax (line 7 minus line 8)", amt.amtBeforeRegular),
    moneyLine("10", "Tax from Form 1040, line 16 (regular tax for comparison)", amt.regularTax, {
      note:
        "Engine convention: the PRE-credit regular income tax (incl. the capital-gains preferential method). The official line 10 subtracts the Schedule 3 foreign tax credit — see footnote.",
    }),
    moneyLine("11", "Alternative minimum tax (line 9 minus line 10; if zero or less, -0-)", ret.amtTax, {
      emphasis: true,
    }),
    checkLine("Line 11 ties: max(0, TMT − regular tax)", Math.max(0, amt.amtBeforeRegular - amt.regularTax), ret.amtTax),
    checkLine("Line 11 ties to the engine's AMT (Schedule 2, line 1)", ret.amtTax, ret.detail.amt.amtTax),
  ];

  // ── Form 8801 interplay (informational) ──
  const form8801: FormLine[] = [
    moneyLine("", "Minimum tax credit generated this year (simplified: equals line 11)", ret.amtCreditGenerated, {
      note: "Engine simplification — the true Form 8801 credit excludes exclusion items (SALT/std-ded addbacks); the engine treats the FULL AMT as creditable.",
    }),
  ];
  if (nz(ret.amtCreditApplied)) {
    form8801.push(
      moneyLine("", "Prior-year minimum tax credit applied against regular tax (Schedule 3, line 6b)", ret.amtCreditApplied),
    );
  }
  form8801.push(
    moneyLine("", "Minimum tax credit carryforward to next year (Form 8801)", ret.amtCreditCarryforwardRemaining, {
      emphasis: true,
      note: "= carried-in credit + credit generated − credit applied.",
    }),
  );

  return {
    formId: "6251",
    formNumber: "Form 6251",
    title: "Alternative Minimum Tax — Individuals",
    subtitle: "Substitute workpaper (Pub 1167 conventions) — CPA review copy, not for filing",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — Alternative Minimum Taxable Income", lines: partI },
      { title: "Part II — Alternative Minimum Tax", lines: partII },
      { title: "Form 8801 interplay — minimum tax credit (informational)", lines: form8801 },
    ],
    footnotes: [
      "The engine carries all Form 6251 line-2 adjustments as a single aggregate; per-sub-line splits (2a–2t) are not individually exposed. The line 2a–3 row is the exact aggregate the engine added to taxable income.",
      "Line 8 (AMT foreign tax credit) is not modeled, and line 10 uses the PRE-credit regular tax — the official form nets the Schedule 3 FTC out of line 10, so for an FTC filer the engine can UNDERSTATE AMT. CPA verifies when both AMT and FTC are present.",
      "Adjustments NOT modeled (CPA enters via the `amt_preferences` catch-all when applicable): depletion (2d), regular-NOL addback (2e), private-activity-bond interest (2g), estates/trusts (2j), disposition basis differences (2k), passive activities (2m), loss limitations (2n), and lines 2o–2t.",
      "Form 8801 credit figures use the engine's simplification (credit generated = full AMT, including exclusion items). The official Form 8801 limits the credit to deferral items (e.g. ISO timing), so the carryforward shown is an UPPER bound when exclusion items (SALT/std-ded) drove the AMT.",
    ],
  };
}
