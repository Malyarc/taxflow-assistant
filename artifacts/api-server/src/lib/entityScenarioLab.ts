/**
 * G-5 — Entity Scenario Lab.
 *
 * Extends the S-corp reasonable-comp calculator (`entityChoice.ts`) into the
 * full four-way entity-study deliverable a firm sells for $1,500–$5,000:
 *
 *     sole proprietorship  vs  S-corp  vs  partnership  vs  C-corp
 *
 * plus a §1202 QSBS timeline note on the C-corp leg. Each leg reports a single
 * comparable number — the household's TOTAL ANNUAL COST = individual net tax
 * after credits + any entity-level tax + the household's payroll taxes — so the
 * CPA can rank them side by side.
 *
 * PURE (no Date/random/DB/fs/network/process) — Haven-portable. Reuses
 * `computeTaxReturnPure` + `analyzeEntityChoice` (so the sole-prop + S-corp legs
 * are NEVER re-derived here — they ARE the entity-choice calculator's output).
 *
 * THE FOUR LEGS:
 *
 *   sole_prop   — the baseline return AS-IS (Sch C profit, full SE tax, §199A on
 *                 the Sch C, SEHI, …). Cost = net tax after credits (the metric
 *                 from filingStatusOptimizer). entityLevelTax 0; the payroll part
 *                 is the baseline SE tax; reasonableComp null.
 *
 *   s_corp      — reuse `analyzeEntityChoice` and take its bestOption (or, when
 *                 a reasonableComp is given, the single explicit-comp option):
 *                 owner takes a W-2 for the comp; the residual is K-1 ordinary
 *                 income (no SE tax). Cost = that option's totalCost; the payroll
 *                 part = employer + employee FICA + FUTA. entityLevelTax 0 (the
 *                 S-corp is a pass-through; no federal entity tax).
 *
 *   partnership — a partnership requires ≥2 partners; for a SINGLE owner it is
 *                 tax-equivalent to a sole proprietorship: an active general
 *                 partner's distributive share + guaranteed payments are SE
 *                 income (§1402(a)) and §199A still applies. We model its cost
 *                 as the sole-prop cost (we do NOT invent a different number) and
 *                 say so in the notes. (A genuine multi-partner split — special
 *                 allocations, a non-managing limited partner escaping SE tax —
 *                 is the CPA's Form 1065 work, outside a one-owner study.)
 *
 *   c_corp      — the double-taxation leg (the manual one):
 *                 • Owner takes salary = reasonableComp (W-2; same employer FICA
 *                   + FUTA adders as the S-corp).
 *                 • Corporate taxable income = profit − salary − employer payroll
 *                   taxes (salary + the employer's payroll taxes are deductible
 *                   §162 wages/§164 taxes). Corporate tax = 21% FLAT (§11(b)),
 *                   floored at 0. entityLevelTax = that corporate tax.
 *                 • Individual side: the Schedule C business is REMOVED (same
 *                   SE_INCOME_TYPES filtering as entityChoice) and replaced with
 *                   a W-2 for the salary. When cCorpDistributes (default), the
 *                   after-corporate-tax earnings are paid out as QUALIFIED
 *                   DIVIDENDS (a 1099-DIV) so the engine taxes them at 0/15/20%
 *                   + NIIT. dividendTax = the individual tax delta vs a no-
 *                   dividend run of the same salary-only individual return.
 *                 • Cost = individual net tax (salary + dividends) + corporate
 *                   tax + employer FICA + employee FICA + FUTA. This is the
 *                   classic two layers of tax: 21% at the entity, then again on
 *                   the dividend at the shareholder.
 *
 * §1202 (QSBS) is deliberately NOT an annual number — it is a future-EXIT gain
 * exclusion that can flip the recommendation toward a C-corp for a company
 * headed for a sale. Surfaced as `section1202Note`, separate from the costs.
 *
 * `best` = the leg with the lowest totalAnnualCost. The lab DECLINES with the
 * same guards as `analyzeEntityChoice` (no/low SE profit, SE optional method,
 * split-spouse business) — it leans on that function to enforce them.
 */

import {
  computeTaxReturnPure,
  toNum,
  type TaxReturnInputs,
  type ComputedTaxReturn,
  type Form1099Fact,
  type AdjustmentFact,
  type W2Fact,
} from "./taxReturnEngine";
import { SS_WAGE_BASE, resolveTaxYear } from "./taxCalculator";
import { netTaxAfterCredits } from "./filingStatusOptimizer";
import {
  analyzeEntityChoice,
  employerPayrollTaxes,
  employeeFicaOnWages,
  type EntityChoiceOption,
} from "./entityChoice";

/** §11(b) — the flat C-corporation income-tax rate (post-TCJA, permanent). */
const C_CORP_RATE = 0.21;

/** FUTA net 0.6% × first $7,000 — mirrored from entityChoice for the C-corp salary. */
const FUTA_NET_RATE = 0.006;
const FUTA_WAGE_CAP = 7_000;

/**
 * Schedule C business adjustments that must not survive into the C-corp
 * individual scenario — their dollars are inside the corporation now (mirrors
 * entityChoice.SE_INCOME_TYPES; replicated rather than imported because it is a
 * private constant there). The §179 election + carryforward are dropped for the
 * same reason as the S-corp leg: the entity (here the C-corp) takes the
 * depreciation, so we subtract the baseline-applied §179 from corporate income.
 */
const SE_INCOME_TYPES = new Set([
  "self_employment_income",
  "schedule_c_expenses",
  "schedule_c_depreciation",
  "schedule_c_section179_carryforward",
  "section_179_expense_election",
  "qbi_income",
  "qbi_w2_wages",
  "qbi_ubia",
  "qbi_sstb_flag",
  "self_employed_health_insurance_premiums",
]);

function isNec(f: Form1099Fact): boolean {
  return (f.formType ?? "").toLowerCase() === "nec";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type EntityForm = "sole_prop" | "s_corp" | "partnership" | "c_corp";

export interface EntityScenario {
  form: EntityForm;
  /** Owner W-2 comp modeled (S-corp + C-corp); null for sole-prop / partnership. */
  reasonableComp: number | null;
  /** Total annual cost = individual net tax + entity-level tax + the household's payroll taxes. */
  totalAnnualCost: number;
  breakdown: {
    /** Individual return net tax after credits (income-tax side). */
    individualNetTax: number;
    /** Federal entity-level tax (21% C-corp; 0 for the pass-throughs). */
    entityLevelTax: number;
    /** Household payroll taxes — sole-prop SE tax, or employer+employee FICA + FUTA. */
    payrollTaxes: number;
    /** C-corp only — the portion of individualNetTax attributable to the dividend. */
    dividendTax?: number;
  };
  assumptions: string[];
  notes: string[];
}

export interface EntityScenarioLabResult {
  applicable: boolean;
  /** Why the lab declined (when applicable=false). */
  reason?: string;
  /** Net Schedule C profit being modeled across the entity forms. */
  businessProfit: number;
  scenarios: EntityScenario[];
  /** The lowest-totalAnnualCost leg — NOT a reasonable-comp opinion. */
  best: EntityScenario | null;
  section1202Note: string;
  assumptions: string[];
}

export interface EntityScenarioLabArgs {
  baselineInputs: TaxReturnInputs;
  baselineReturn: ComputedTaxReturn;
  /** Comp level for the S-corp + C-corp legs; default = the S-corp calculator's best. */
  reasonableComp?: number;
  /** Model the C-corp as distributing after-tax earnings as qualified dividends
   *  (true, default) or retaining them (false → no second layer this year). */
  cCorpDistributes?: boolean;
}

const SECTION_1202_NOTE =
  "§1202 (Qualified Small Business Stock): C-corp stock held >5 years can exclude " +
  "the GREATER of $10,000,000 or 10× the stock's adjusted basis of gain on a future " +
  "sale (100% exclusion for stock acquired after 9/27/2010; the corporation must be " +
  "a domestic C-corp with ≤$50M of aggregate gross assets and meet the active-business " +
  "test). This is a LONG-HORIZON EXIT benefit, NOT an annual cost — it is therefore " +
  "excluded from the totalAnnualCost comparison above. For a company headed for a sale, " +
  "the §1202 exclusion can dwarf the annual double-tax drag and flip the recommendation " +
  "toward the C-corp; for a cash-flow / lifestyle business with no exit, the annual " +
  "comparison governs.";

/**
 * Build the C-corp individual return: drop the Schedule C business, add the
 * owner's salary W-2, and (optionally) the qualified-dividend distribution.
 * Mirrors entityChoice's scenario construction so the income picture lines up.
 */
function buildCCorpIndividual(
  baselineInputs: TaxReturnInputs,
  taxYear: number,
  owner: "taxpayer" | "spouse",
  salary: number,
  qualifiedDividend: number,
): TaxReturnInputs {
  const adjustments = (baselineInputs.adjustments ?? []) as AdjustmentFact[];
  const salaryW2: W2Fact = {
    taxYear,
    wagesBox1: salary,
    socialSecurityWagesBox3: salary,
    medicareWagesBox5: salary,
    federalTaxWithheldBox2: 0,
    stateCode: baselineInputs.client.state ?? null,
    spouse: owner,
  };
  const divRows: Form1099Fact[] =
    qualifiedDividend > 0
      ? [
          {
            taxYear,
            formType: "div",
            payerName: "Modeled C-corp distribution",
            // The full distribution is a qualified dividend (held > the §1(h)(11)
            // holding period). ordinaryDividends is the Box-1a total; the qualified
            // portion (Box 1b) routes it to the 0/15/20% preferential schedule.
            ordinaryDividends: qualifiedDividend,
            qualifiedDividends: qualifiedDividend,
            spouse: owner,
          },
        ]
      : [];
  return {
    ...baselineInputs,
    // Remove the Schedule C business (its dollars are inside the C-corp now).
    form1099s: [...(baselineInputs.form1099s ?? []).filter((f) => !isNec(f)), ...divRows],
    adjustments: adjustments.filter((a) => !SE_INCOME_TYPES.has(a.adjustmentType)),
    scheduleCAssets: [],
    w2s: [...(baselineInputs.w2s ?? []), salaryW2],
  };
}

function declined(reason: string): EntityScenarioLabResult {
  return {
    applicable: false,
    reason,
    businessProfit: 0,
    scenarios: [],
    best: null,
    section1202Note: SECTION_1202_NOTE,
    assumptions: [],
  };
}

export function analyzeEntityScenarioLab(
  args: EntityScenarioLabArgs,
): EntityScenarioLabResult {
  const { baselineInputs, baselineReturn } = args;
  const cCorpDistributes = args.cCorpDistributes ?? true;
  const taxYear = baselineReturn.taxYear;

  // Lean on entityChoice for ALL the eligibility guards (no/low SE profit, SE
  // optional method, split-spouse business) AND for the sole-prop + S-corp legs.
  const ec = analyzeEntityChoice({
    baselineInputs,
    baselineReturn,
    reasonableComp: args.reasonableComp,
  });
  if (!ec.applicable) return declined(ec.reason ?? "Entity comparison not applicable.");

  // The S-corp leg the lab uses: the explicit-comp option (single) or the
  // lowest-cost swept option. entityChoice guarantees a bestOption here.
  const sCorp: EntityChoiceOption = ec.bestOption!;
  const profit = ec.businessProfit;

  // Whose business is it? (entityChoice already proved it is all one spouse.)
  const adjustments = (baselineInputs.adjustments ?? []) as AdjustmentFact[];
  const seAdjRows = adjustments.filter(
    (a) =>
      a.adjustmentType === "self_employment_income" &&
      (a.isApplied ?? true) &&
      toNum(a.amount) !== 0,
  );
  const necRows = (baselineInputs.form1099s ?? []).filter(isNec);
  const owner: "taxpayer" | "spouse" = [...necRows, ...seAdjRows].some(
    (s) => s.spouse === "spouse",
  )
    ? "spouse"
    : "taxpayer";

  // ── sole_prop leg — the baseline, verbatim ────────────────────────────────
  const solePropCost = round2(netTaxAfterCredits(baselineReturn));
  const solePropScenario: EntityScenario = {
    form: "sole_prop",
    reasonableComp: null,
    totalAnnualCost: solePropCost,
    breakdown: {
      individualNetTax: solePropCost,
      entityLevelTax: 0,
      payrollTaxes: round2(baselineReturn.selfEmploymentTax),
      // (no dividendTax — pass-through, no entity layer)
    },
    assumptions: [
      "Sole proprietorship: full §1401 SE tax on net Schedule C earnings; §199A QBI on the Schedule C; SEHI per §162(l). The household pays the entire 15.3% SE tax.",
      "No entity-level tax (Schedule C flows to the 1040); no separate payroll service or entity return.",
    ],
    notes: [],
  };

  // ── s_corp leg — from analyzeEntityChoice ─────────────────────────────────
  const sCorpPayroll = round2(sCorp.employerFica + sCorp.employeeFica + sCorp.futa);
  const sCorpScenario: EntityScenario = {
    form: "s_corp",
    reasonableComp: sCorp.reasonableComp,
    totalAnnualCost: sCorp.totalCost,
    breakdown: {
      individualNetTax: sCorp.engineNetTaxAfterCredits,
      entityLevelTax: 0,
      payrollTaxes: sCorpPayroll,
    },
    assumptions: [
      `S-corp: owner W-2 reasonable comp = $${Math.round(sCorp.reasonableComp).toLocaleString("en-US")}; the residual $${Math.round(sCorp.sCorpOrdinaryIncome).toLocaleString("en-US")} is K-1 ordinary income with NO SE/FICA tax (the FICA savings vs the sole prop).`,
      "Reasonable comp must be DEFENSIBLE (Rev. Rul. 74-44; RC Reports / BLS) — this is not a comp opinion.",
      "Employer FICA + FUTA are deductible entity expenses (reduce K-1 Box 1) AND household cash cost; §199A QBI = K-1 ordinary income with W-2 wages feeding the wage/UBIA limit.",
      "No federal entity-level tax (S-corp is a pass-through). State S-corp/franchise taxes, payroll-service + 1120-S prep cost, and SUTA are not modeled — net against the FICA savings.",
    ],
    notes: ec.assumptions.slice(),
  };

  // ── partnership leg — single-owner = SE-equivalent to the sole prop ───────
  const partnershipScenario: EntityScenario = {
    form: "partnership",
    reasonableComp: null,
    totalAnnualCost: solePropCost,
    breakdown: {
      individualNetTax: solePropScenario.breakdown.individualNetTax,
      entityLevelTax: 0,
      payrollTaxes: solePropScenario.breakdown.payrollTaxes,
    },
    assumptions: [
      "Partnership: an active general partner's distributive share + guaranteed payments are SE income (§1402(a)); §199A still applies. Tax-equivalent to a sole proprietorship for a single owner.",
    ],
    notes: [
      "A partnership requires ≥2 partners; for a single owner it is tax-equivalent to a sole proprietorship (full SE tax on active earnings). Modeled as such.",
      "A genuine multi-partner partnership (special allocations, a non-managing limited partner whose share may escape SE tax under §1402(a)(13), guaranteed-payment structuring) is the CPA's Form 1065 work — outside a one-owner study.",
    ],
  };

  // ── c_corp leg — the manual double-taxation leg ───────────────────────────
  const salary = sCorp.reasonableComp;
  const { employerFica, futa } = employerPayrollTaxes(salary, taxYear);
  const employeeFica = sCorp.employeeFica; // identical W-2 → identical employee FICA
  // Corporate taxable income = profit − deductible salary − deductible employer
  // payroll taxes − the §179 the entity now takes (same separately-stated §179
  // handling as the S-corp leg; subtract the baseline-applied amount).
  const section179Applied = baselineReturn.section179Applied;
  const corpTaxableIncome = Math.max(
    0,
    round2(profit - salary - employerFica - futa - section179Applied),
  );
  const corporateTax = round2(C_CORP_RATE * corpTaxableIncome);
  const afterCorpEarnings = round2(corpTaxableIncome - corporateTax);
  const dividend = cCorpDistributes ? Math.max(0, afterCorpEarnings) : 0;

  // Individual side: salary-only run (the dividend baseline) and the with-dividend
  // run. dividendTax = the delta between them (the second layer of tax).
  const indivNoDiv = computeTaxReturnPure(
    buildCCorpIndividual(baselineInputs, taxYear, owner, salary, 0),
  );
  const indivWithDiv =
    dividend > 0
      ? computeTaxReturnPure(
          buildCCorpIndividual(baselineInputs, taxYear, owner, salary, dividend),
        )
      : indivNoDiv;
  const indivNoDivNet = netTaxAfterCredits(indivNoDiv);
  const indivWithDivNet = netTaxAfterCredits(indivWithDiv);
  const individualNetTax = round2(indivWithDivNet);
  const dividendTax = round2(indivWithDivNet - indivNoDivNet);

  const cCorpCost = round2(individualNetTax + corporateTax + employerFica + employeeFica + futa);
  const cCorpScenario: EntityScenario = {
    form: "c_corp",
    reasonableComp: salary,
    totalAnnualCost: cCorpCost,
    breakdown: {
      individualNetTax,
      entityLevelTax: corporateTax,
      payrollTaxes: round2(employerFica + employeeFica + futa),
      dividendTax,
    },
    assumptions: [
      `C-corp: owner salary $${Math.round(salary).toLocaleString("en-US")} (deductible §162 wages). Corporate taxable income = profit − salary − employer payroll taxes${section179Applied > 0 ? " − separately-stated §179" : ""} = $${Math.round(corpTaxableIncome).toLocaleString("en-US")}.`,
      `Corporate tax = 21% flat (§11(b)) × $${Math.round(corpTaxableIncome).toLocaleString("en-US")} = $${Math.round(corporateTax).toLocaleString("en-US")}.`,
      cCorpDistributes
        ? `After-corporate-tax earnings $${Math.round(afterCorpEarnings).toLocaleString("en-US")} are distributed as QUALIFIED dividends → taxed again at the shareholder 0/15/20% (+ §1411 NIIT). This is the classic C-corp DOUBLE TAXATION: 21% at the entity, then a second layer on the dividend (the $${Math.round(dividendTax).toLocaleString("en-US")} dividend tax above).`
        : `Earnings are RETAINED in the corporation (no dividend this year) → only the first 21% layer applies now; the second layer is deferred until a future distribution (and the retained earnings may also face the §531 accumulated-earnings tax if not for a reasonable business need — not modeled).`,
      "No STATE corporate income/franchise tax modeled; salary + employer payroll taxes are deductible to the corporation; the dividend is QUALIFIED (held the §1(h)(11) period). Employer FICA + FUTA are household cash cost (the owner's money) AND deductible to the C-corp.",
      "§1202 QSBS is a future-sale EXIT benefit, not an annual number — see section1202Note (it can flip this recommendation for a company headed for a sale).",
    ],
    notes: [
      "C-corp earnings face two layers of tax (21% entity + shareholder dividend rate) unless retained or extracted as deductible salary — usually the costliest annual structure for a profitable owner-operated lifestyle business, and usually the cheapest exit structure under §1202.",
    ],
  };

  const scenarios: EntityScenario[] = [
    solePropScenario,
    sCorpScenario,
    partnershipScenario,
    cCorpScenario,
  ];
  const best = scenarios.reduce((b, s) => (s.totalAnnualCost < b.totalAnnualCost ? s : b));

  const assumptions = [
    "Total annual cost = individual net tax after credits + federal entity-level tax + the household's payroll taxes (the same withholding-independent metric used by the filing-status optimizer).",
    "The sole-prop + S-corp legs come from the engine-verified reasonable-comp calculator (real `computeTaxReturnPure` runs); the partnership is modeled as SE-equivalent to the sole prop for a single owner; the C-corp is the manual double-taxation leg.",
    "Reasonable compensation must be DEFENSIBLE for the role/hours/location (Rev. Rul. 74-44) — the lowest-cost leg is not a comp opinion.",
    "Entity-formation + annual compliance costs (payroll service, bookkeeping, 1120-S/1065/1120 prep ~$1,500–$3,000/yr, state franchise/SUTA) are NOT modeled — net them against any savings.",
    "State corporate income tax, state PTET (strategy G1.2), and the §531 accumulated-earnings tax are not modeled.",
    "§1202 QSBS is reported as a long-horizon EXIT note, not an annual cost — see section1202Note.",
  ];

  return {
    applicable: true,
    businessProfit: profit,
    scenarios,
    best,
    section1202Note: SECTION_1202_NOTE,
    assumptions,
  };
}

// Re-export the FUTA constants so consumers/tests can reference the leg model
// without re-deriving (kept inert here — no behavioral coupling).
export const ENTITY_LAB_C_CORP_RATE = C_CORP_RATE;
export const ENTITY_LAB_FUTA = { rate: FUTA_NET_RATE, cap: FUTA_WAGE_CAP };
