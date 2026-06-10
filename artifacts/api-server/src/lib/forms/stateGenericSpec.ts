/**
 * T2.1 — Generic state income-tax summary workpaper.
 *
 * The catch-all for the ~44 states NOT covered by a dedicated builder
 * (everything except CA / NY / NJ / MA / PA). Renders the engine's state
 * AGGREGATES — resident tax, non-resident rows, retirement exemption, state
 * EITC/CTC, the additional-credit package, the individual mandate (RI/DC),
 * local taxes (MD/OH/IN/KY/Yonkers), part-year split, the WA capital-gains
 * excise — onto a neutral labeled layout. NEVER renders a per-state refund
 * (the engine settles state-side in aggregate; see Reconciliation Worksheet
 * Part 7).
 *
 * Applicability: stateCode is NOT one of CA/NY/NJ/MA/PA, AND the return has
 * some state activity (resident tax, withholding, or a former-state tax).
 * No-income-tax states with zero withholding render nothing (null).
 */

import {
  checkLine,
  countLine,
  moneyLine,
  nz,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

const DEDICATED = new Set(["CA", "NY", "NJ", "MA", "PA"]);

export function buildStateGeneric(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const code = (ret.stateCode ?? "").toUpperCase();
  if (DEDICATED.has(code)) return null;

  const hasActivity =
    nz(ret.stateTaxLiability) ||
    nz(ret.stateTaxWithheld) ||
    nz(ret.formerStateTax) ||
    ret.multiState.nonresidentStateTaxes.some((n) => nz(n.tax)) ||
    nz(ret.stateIndividualMandatePenalty);
  if (!hasActivity) return null;

  const isWa = code === "WA";

  // ── Part 1 — State income tax ──
  const taxLines: FormLine[] = [];
  if (nz(ret.stateRetirementExemption)) {
    taxLines.push(
      moneyLine("", "Retirement income exemption applied", ret.stateRetirementExemption, {
        note: "Engine state retirement subtraction (PA/IL/MS full; CT/HI/NY partial; SS excluded in 41 jurisdictions).",
      }),
    );
  }
  taxLines.push(
    moneyLine("", `Resident state (${code}) tax${nz(ret.multiState.residentCreditApplied) ? " (after other-state credit)" : ""}`, ret.multiState.residentStateTax, {
      emphasis: true,
      note: isWa
        ? "Washington has no broad income tax; this is the RCW 82.87 capital-gains excise (7% over the annual exclusion + 2.9% surcharge over $1M, 2025+)."
        : undefined,
    }),
  );
  if (isWa && nz(ret.stateTaxLiability)) {
    taxLines.push(
      textLine("", "WA capital-gains excise basis", "RCW 82.87", {
        indent: 1,
        note: "Applies to long-term gains over the year's standard deduction ($270k/$278k); a 2.9% surcharge applies to the portion over $1M (2025+).",
      }),
    );
  }
  if (nz(ret.multiState.residentCreditApplied)) {
    taxLines.push(
      moneyLine("", "Credit for taxes paid to other states", -ret.multiState.residentCreditApplied, {
        indent: 1,
        note: "Resident-state credit, capped at resident tax × (other-state-source ÷ AGI).",
      }),
    );
  }
  for (const nr of ret.multiState.nonresidentStateTaxes) {
    taxLines.push(
      moneyLine("", `Non-resident ${nr.state} tax${nr.reciprocityApplied ? " (reciprocity — no tax)" : ""}`, nr.tax, {
        indent: 1,
        note: nr.reciprocityApplied ? undefined : `On ${nr.wages.toLocaleString("en-US", { style: "currency", currency: "USD" })} ${nr.state}-source income.`,
      }),
    );
  }
  if (ret.formerStateCode && nz(ret.formerStateTax)) {
    taxLines.push(
      moneyLine("", `Part-year former-state (${ret.formerStateCode}) tax`, ret.formerStateTax, { indent: 1 }),
    );
    taxLines.push(
      countLine("", `Days resident — former ${ret.formerStateCode}`, ret.daysFormerStateResident, { indent: 2 }),
    );
    taxLines.push(
      countLine("", `Days resident — current ${code}`, ret.daysCurrentStateResident, { indent: 2 }),
    );
  }
  if (nz(ret.localTaxLiability)) {
    taxLines.push(
      moneyLine("", `Local income tax (${ret.localTaxJurisdiction ?? "local"})`, ret.localTaxLiability, {
        indent: 1,
        note: "MD county / OH city (SDIT) / IN county / KY occupational / Yonkers surcharge, per the engine's local registries.",
      }),
    );
  }
  const componentSum =
    ret.multiState.residentStateTax +
    ret.multiState.nonresidentStateTaxes.reduce((s, n) => s + n.tax, 0) +
    ret.formerStateTax;
  taxLines.push(
    checkLine("State + local components tie to engine state tax (pre-additional-credit)", componentSum, ret.stateTaxLiability),
  );

  // ── Part 2 — Credits, mandate & payments ──
  const creditLines: FormLine[] = [];
  if (nz(ret.stateEitc.credit)) {
    creditLines.push(
      moneyLine("", `${code} Earned Income Tax Credit${ret.stateEitc.approximate ? " (approximate)" : ""}`, ret.stateEitc.credit, {
        note: "State EITC — refundable; piggybacks the federal EITC.",
      }),
    );
  }
  if (nz(ret.stateEitc.mnCtc ?? 0)) {
    creditLines.push(
      moneyLine("", "MN Child Tax Credit", ret.stateEitc.mnCtc ?? 0, {
        note: "$1,750/child refundable (Schedule M1CWFC), phased out jointly with the Working Family Credit.",
      }),
    );
  }
  if (nz(ret.stateChildTaxCredit)) {
    creditLines.push(
      moneyLine("", "State Child Tax Credit", ret.stateChildTaxCredit, {
        note: "CA YCTC / CO / IL / NM / VT refundable child credit.",
      }),
    );
  }
  if (nz(ret.stateAdditionalCreditsNonRefundable)) {
    creditLines.push(
      moneyLine("", "State nonrefundable additional credits", -ret.stateAdditionalCreditsNonRefundable, {
        note: "Engine package (e.g. OH joint-filing / senior, GA low-income, VA LITC). Reduces state tax, floored at $0.",
      }),
    );
  }
  if (nz(ret.stateAdditionalCreditsRefundable)) {
    creditLines.push(
      moneyLine("", "State refundable additional credits", ret.stateAdditionalCreditsRefundable, {
        note: "Engine package of refundable state credits; adds to the aggregate state settlement.",
      }),
    );
  }
  if (nz(ret.stateIndividualMandatePenalty)) {
    const m = ret.stateMandate;
    creditLines.push(
      moneyLine("", `Individual mandate penalty (${m.state || code})`, ret.stateIndividualMandatePenalty, {
        emphasis: true,
        note: `Method "${m.method}", ${m.monthsUninsured}/12 months uninsured (RI/DC frozen-federal schedule). Increases the balance due in the aggregate settlement.`,
      }),
    );
  }
  creditLines.push(
    moneyLine("", "State income tax withheld (engine aggregate — all states)", ret.stateTaxWithheld, {
      note: "Tracked in aggregate across states.",
    }),
  );
  creditLines.push(
    textLine("", "Per-state refund/balance NOT rendered", null, {
      note: "The engine settles the state side in AGGREGATE (withheld − tax + credits − penalty). See the 1040 Reconciliation Worksheet Part 7.",
    }),
  );

  return {
    formId: "state-generic",
    formNumber: `${code} state return`,
    title: `${code} Income Tax — Summary Workpaper`,
    subtitle: "Engine state aggregates on a neutral layout (no dedicated state-form builder for this state yet).",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part 1 — State + local income tax", lines: taxLines },
      { title: "Part 2 — Credits, mandate & payments", lines: creditLines },
    ],
    footnotes: [
      `Summary workpaper — NOT a filed ${code} return. The engine computes ${code} on a federal-AGI-proxy base (federal AGI − state standard deduction/exemptions − exempt retirement/SS), with that state's brackets.`,
      "State-specific subtractions, credits, and AMT beyond the 31 modeled credits are the CPA's refinement (enter as manual credit adjustments).",
      "No per-state refund is rendered: the engine settles state withholding, credits, and any mandate penalty in aggregate — see the Reconciliation Worksheet Part 7.",
    ],
  };
}
