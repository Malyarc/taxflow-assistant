/**
 * T2.1 — PA-40 (Pennsylvania Income Tax Return) summary workpaper.
 *
 * SUMMARY-WORKPAPER PHILOSOPHY (matches the CA/NY/NJ/MA state group): the
 * engine exposes state AGGREGATES, not a per-class PA-40 build-up. PA levies a
 * FLAT 3.07% tax and fully EXEMPTS retirement income; Tax Forgiveness
 * (Schedule SP) and local Earned Income Tax (EIT) ride along in the engine's
 * additional-credit / local-tax aggregates. NEVER renders a per-state refund —
 * the engine settles the state side in aggregate (see Reconciliation
 * Worksheet Part 7).
 *
 * Line anchors (PA-40 TY2024): 9 taxable compensation; 12 PA tax (3.07%);
 * 13 total PA tax withheld; 21 Tax Forgiveness credit (Schedule SP);
 * local EIT is a separate municipal return (Act 32).
 *
 * Applicability: resident PA, OR a non-resident PA row, OR part-year former PA.
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

export function buildPa40(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const resident = (ret.stateCode ?? "").toUpperCase() === "PA";
  const nrRow = ret.multiState.nonresidentStateTaxes.find((n) => n.state.toUpperCase() === "PA") ?? null;
  const former = (ret.formerStateCode ?? "").toUpperCase() === "PA";
  if (!resident && !nrRow && !former) return null;

  const base = {
    formId: "pa-40",
    formNumber: "PA-40",
    title: "Pennsylvania Income Tax — Summary Workpaper",
    taxYear: ret.taxYear,
  };
  const settlementNote = textLine("", "Per-state refund/balance NOT rendered", null, {
    note: "The engine settles the state side in AGGREGATE across all states. Trace it in the 1040 Reconciliation Worksheet, Part 7.",
  });

  // PA-local EIT (Act 32) — present when the engine attributed a PA locality.
  const paLocal =
    nz(ret.localTaxLiability) && (ret.localTaxJurisdiction ?? "").length > 0
      ? ret.localTaxLiability
      : 0;
  const localJur = ret.localTaxJurisdiction ?? "PA locality";

  if (!resident) {
    const lines: FormLine[] = [];
    if (nrRow) {
      lines.push(
        moneyLine("", `Pennsylvania non-resident tax${nrRow.reciprocityApplied ? " (reciprocity — no PA tax)" : ""}`, nrRow.tax, {
          emphasis: true,
          note: "Flat 3.07% on PA-source compensation/income. PA has wage reciprocity with IN/MD/NJ/OH/VA/WV.",
        }),
        moneyLine("", "PA-source income", nrRow.wages, { indent: 1 }),
      );
    }
    if (former) {
      lines.push(
        moneyLine("", "Part-year former-state Pennsylvania tax", ret.formerStateTax, { emphasis: true }),
      );
    }
    if (nz(paLocal)) {
      lines.push(
        moneyLine("", `PA local Earned Income Tax (${localJur}, Act 32)`, paLocal, {
          note: "Municipal/school EIT on earned income incl. net SE profit; a separate local return.",
        }),
      );
    }
    lines.push(settlementNote);
    return {
      ...base,
      subtitle: former && !nrRow ? "Part-year former-state Pennsylvania" : "Non-resident Pennsylvania",
      parts: [{ title: "Pennsylvania tax included in the engine state total", lines }],
      footnotes: [
        "Summary workpaper — not a filed PA-40. PA is a flat 3.07% tax with eight income classes; the engine uses a federal-AGI-proxy base.",
        "No per-state refund is rendered — see the Reconciliation Worksheet Part 7.",
      ],
    };
  }

  // ── Resident PA-40 ──
  const w2Wages = (inputs?.w2s ?? [])
    .filter((w) => (w.taxYear ?? ret.taxYear) === ret.taxYear)
    .reduce((s, w) => s + toNum(w.wagesBox1), 0);

  const taxLines: FormLine[] = [];
  if (nz(w2Wages)) {
    taxLines.push(
      moneyLine("1a/9", "Gross/taxable compensation (all W-2s — info)", w2Wages, {
        indent: 1,
        note: "Info only. PA taxes compensation, net profits, and 6 other classes; retirement income is fully EXEMPT.",
      }),
    );
  }
  if (nz(ret.stateRetirementExemption)) {
    taxLines.push(
      moneyLine("", "Retirement income exempted (PA does not tax qualified retirement)", ret.stateRetirementExemption, {
        note: "PA excludes qualifying pension, IRA, 401(k), and Social Security distributions from the tax base.",
      }),
    );
  }
  taxLines.push(
    moneyLine("12", "PA income tax — flat 3.07%", ret.multiState.residentStateTax, {
      emphasis: true,
      note: "3.07% (PA 72 P.S. §7302) on the engine's PA base (federal AGI proxy − retirement − taxable SS).",
    }),
  );
  for (const nr of ret.multiState.nonresidentStateTaxes) {
    taxLines.push(
      moneyLine("", `Non-resident ${nr.state} tax${nr.reciprocityApplied ? " (reciprocity)" : ""} (context)`, nr.tax, { indent: 1 }),
    );
  }
  if (ret.formerStateCode && nz(ret.formerStateTax)) {
    taxLines.push(moneyLine("", `Part-year former-state (${ret.formerStateCode}) tax (context)`, ret.formerStateTax, { indent: 1 }));
  }
  const componentSum =
    ret.multiState.residentStateTax +
    ret.multiState.nonresidentStateTaxes.reduce((s, n) => s + n.tax, 0) +
    ret.formerStateTax;
  taxLines.push(
    checkLine("PA + other-state components tie to engine state tax (pre-additional-credit)", componentSum, ret.stateTaxLiability),
  );

  // ── Credits, local & payments ──
  const creditLines: FormLine[] = [];
  if (nz(ret.stateAdditionalCreditsNonRefundable)) {
    creditLines.push(
      moneyLine("21", "Tax Forgiveness credit (Schedule SP)", ret.stateAdditionalCreditsNonRefundable, {
        note: "PA Special Tax Forgiveness reduces (or eliminates) PA tax for low-income filers by eligibility income + dependents; nonrefundable.",
      }),
    );
  }
  if (nz(ret.stateAdditionalCreditsRefundable)) {
    creditLines.push(
      moneyLine("", "PA refundable credit package", ret.stateAdditionalCreditsRefundable, {
        note: "Engine aggregate (e.g. PA Working Family / child-care contribution credits).",
      }),
    );
  }
  if (nz(paLocal)) {
    creditLines.push(
      moneyLine("", `PA local Earned Income Tax (${localJur}, Act 32)`, paLocal, {
        emphasis: true,
        note: "Municipal/school EIT on earned income INCLUDING net SE profit (the engine's SE-inclusive local base). Filed on a separate local return; adds to the aggregate state+local settlement.",
      }),
    );
  }
  creditLines.push(
    moneyLine("13", "PA income tax withheld (engine aggregate — all states)", ret.stateTaxWithheld, {
      note: "Tracked in aggregate across states; the PA-only split is the CPA's.",
    }),
  );
  creditLines.push(settlementNote);

  return {
    ...base,
    subtitle: "Resident return — flat 3.07% tax + retirement exemption + local EIT",
    parts: [
      { title: "Part 1 — Pennsylvania income tax", lines: taxLines },
      { title: "Part 2 — Credits, local tax & payments", lines: creditLines },
    ],
    footnotes: [
      "Summary workpaper — NOT a filed PA-40. PA's eight-class income system (each class netted separately, losses not crossed) is approximated on a federal-AGI-proxy base.",
      "PA fully exempts qualifying retirement income and Social Security; capital gains and dividends ARE taxed at 3.07%.",
      "Tax Forgiveness (Schedule SP) rides in the engine's nonrefundable additional-credit aggregate; local EIT (Act 32) is a separate municipal return.",
      "No per-state refund is rendered — see the Reconciliation Worksheet Part 7.",
    ],
  };
}
