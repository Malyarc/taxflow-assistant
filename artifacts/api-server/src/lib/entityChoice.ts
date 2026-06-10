/**
 * T2.2 D1 — Entity-choice / S-corp reasonable-compensation calculator.
 *
 * The classic CPA conversation for a profitable sole proprietor: "should this
 * business elect S-corp status, and at what reasonable compensation?" This
 * module answers it with REAL engine runs, not a FICA-rate heuristic
 * (G1.17's heuristic is the seed; this is its engine-verified big sibling).
 *
 * PURE (no Date/random/DB) — Haven-portable. Reuses `computeTaxReturnPure`.
 *
 * THE COMPARISON, per comp level W:
 *   Sole prop  — the client's baseline return as-is (Sch C profit P, SE tax,
 *                §199A on the Sch C, SEHI, etc.). Cost = net tax after credits.
 *   S-corp     — the Schedule C inputs are REMOVED and replaced with:
 *                  • a W-2 for W (Boxes 1/3/5 = W) — FICA wages,
 *                  • an ACTIVE S-corp K-1 with Box 1 = P − W − employer
 *                    payroll taxes (employer FICA + FUTA are entity expenses),
 *                    §199A QBI = Box 1 and W-2 wages = W (so the engine's
 *                    wage/UBIA limit + SSTB phase-out apply for real).
 *                Cost = engine net tax after credits + the payroll taxes the
 *                household actually pays (employee FICA + employer FICA +
 *                FUTA) — the employer side is the owner's own money.
 *
 * No double-counting: employer FICA/FUTA appear once as cash cost AND reduce
 * K-1 Box 1 (they're deductible entity expenses) — both are correct.
 * Additional Medicare (0.9% over the §3101(b)(2) threshold) is computed by
 * the ENGINE from the W-2 Medicare wages — deliberately NOT in the payroll
 * adders here. The employee 6.2% SS share respects the per-EMPLOYEE annual
 * cap across the client's other W-2s (excess SS withholding is credited on
 * the 1040, Schedule 3 line 11); the EMPLOYER 6.2% has a per-employer base
 * with no credit, so it is never reduced by other W-2s.
 *
 * WHAT MOVES INTO THE MODELED S-CORP (and what stays behind):
 *   moved  — 1099-NEC income, `self_employment_income` adjustments,
 *            `schedule_c_expenses`, `schedule_c_depreciation`, the Schedule C
 *            asset register (its baseline-computed depreciation is baked into
 *            P), and the Sch C SSTB flag (`qbi_sstb_flag` → K-1 isSstb).
 *   stays  — crypto-mining, statutory-employee, and clergy income (separate
 *            activities; identical in both runs so they cancel in the delta).
 *   SEHI   — the sole-prop baseline keeps its §162(l) deduction; under the
 *            S-corp, a >2% shareholder's premiums are Box-1-only wages fully
 *            offset by §162(l) (Notice 2008-1) — a net-zero we model by
 *            dropping the premiums adjustment from the scenario.
 *
 * IMPORTANT FRAMING: the lowest-cost comp level is reported as the cheapest
 * MODELED option, NOT a recommendation to minimize wages. Reasonable comp
 * must be defensible (Rev. Rul. 74-44; RC Reports / BLS benchmark) — that
 * judgment is the CPA's, which is why the sweep shows the whole curve.
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type ComputedTaxReturn,
  type Form1099Fact,
  type AdjustmentFact,
  type W2Fact,
  type ScheduleK1Fact,
} from "./taxReturnEngine";
import { SS_WAGE_BASE, resolveTaxYear } from "./taxCalculator";
import { netTaxAfterCredits } from "./filingStatusOptimizer";

/** Below this Schedule C profit an S-corp election never recoups its overhead. */
const MIN_PROFIT = 10_000;

/** FUTA: 6.0% on the first $7,000, less the full 5.4% state credit = net 0.6%. */
const FUTA_NET_RATE = 0.006;
const FUTA_WAGE_CAP = 7_000;

const SE_INCOME_TYPES = new Set([
  "self_employment_income",
  "schedule_c_expenses",
  "schedule_c_depreciation",
  "qbi_sstb_flag",
  // Notice 2008-1 — modeled as net-zero under the S-corp (see module doc).
  "self_employed_health_insurance_premiums",
]);

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isNec(f: Form1099Fact): boolean {
  return (f.formType ?? "").toLowerCase() === "nec";
}

function sumAdj(adjustments: AdjustmentFact[], type: string): number {
  return adjustments
    .filter((a) => a.adjustmentType === type && (a.isApplied ?? true))
    .reduce((s, a) => s + toNum(a.amount), 0);
}

export interface EntityChoiceOption {
  /** W-2 wages paid to the owner under the S-corp (the comp level modeled). */
  reasonableComp: number;
  /** K-1 Box 1 = profit − comp − employer payroll taxes (the distribution-eligible income). */
  sCorpOrdinaryIncome: number;
  /** Employer FICA on the owner's wages (6.2% to the SS base + 1.45%). */
  employerFica: number;
  /** Net FUTA (0.6% × first $7,000). */
  futa: number;
  /** Employee FICA withheld (6.2% to the per-person SS cap net of other W-2s + 1.45%). */
  employeeFica: number;
  /** Engine net tax after credits for the S-corp scenario (income tax side). */
  engineNetTaxAfterCredits: number;
  /** engineNetTaxAfterCredits + employerFica + futa + employeeFica. */
  totalCost: number;
  /** Sole-prop cost − totalCost. Positive = the S-corp saves money at this comp. */
  savingsVsSoleProp: number;
  /** Scenario return detail for CPA review of the §199A / bracket interplay. */
  scenario: {
    adjustedGrossIncome: number;
    taxableIncome: number;
    qbiDeduction: number;
    federalTaxLiability: number;
    stateTaxLiability: number;
    selfEmploymentTax: number;
  };
}

export interface EntityChoiceResult {
  applicable: boolean;
  /** Why the calculator declined (when applicable=false). */
  reason?: string;
  /** Net Schedule C profit being moved into the modeled S-corp. */
  businessProfit: number;
  soleProp: {
    netTaxAfterCredits: number;
    selfEmploymentTax: number;
    qbiDeduction: number;
  };
  options: EntityChoiceOption[];
  /** The lowest-totalCost modeled option — NOT a reasonable-comp opinion. */
  bestOption: EntityChoiceOption | null;
  assumptions: string[];
}

export interface AnalyzeEntityChoiceArgs {
  baselineInputs: TaxReturnInputs;
  baselineReturn: ComputedTaxReturn;
  /** Explicit comp level to model (replaces the default sweep when given). */
  reasonableComp?: number;
}

function notApplicable(reason: string): EntityChoiceResult {
  return {
    applicable: false,
    reason,
    businessProfit: 0,
    soleProp: { netTaxAfterCredits: 0, selfEmploymentTax: 0, qbiDeduction: 0 },
    options: [],
    bestOption: null,
    assumptions: [],
  };
}

/** Employer-side payroll taxes on owner wages W (per-employer SS base, no credit). */
export function employerPayrollTaxes(
  wages: number,
  taxYear: number,
): { employerFica: number; futa: number } {
  const ssBase = SS_WAGE_BASE[resolveTaxYear(taxYear)];
  const employerFica = 0.062 * Math.min(wages, ssBase) + 0.0145 * wages;
  const futa = FUTA_NET_RATE * Math.min(wages, FUTA_WAGE_CAP);
  return { employerFica: round2(employerFica), futa: round2(futa) };
}

/**
 * Employee FICA on owner wages W. The 6.2% SS share is capped at the
 * per-PERSON annual base net of the same person's other W-2 SS wages —
 * over-withheld SS is recovered on the 1040 (Schedule 3 line 11), so the
 * economic cost is the post-credit amount. Medicare 1.45% is uncapped;
 * the 0.9% Additional Medicare surtax is the ENGINE's job (Form 8959).
 */
export function employeeFicaOnWages(
  wages: number,
  taxYear: number,
  otherW2SsWagesSamePerson: number,
): number {
  const ssBase = SS_WAGE_BASE[resolveTaxYear(taxYear)];
  const ssRoom = Math.max(0, ssBase - Math.max(0, otherW2SsWagesSamePerson));
  return round2(0.062 * Math.min(wages, ssRoom) + 0.0145 * wages);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function analyzeEntityChoice(args: AnalyzeEntityChoiceArgs): EntityChoiceResult {
  const { baselineInputs, baselineReturn } = args;
  const taxYear = baselineReturn.taxYear;
  const adjustments = (baselineInputs.adjustments ?? []) as AdjustmentFact[];
  const necRows = (baselineInputs.form1099s ?? []).filter(isNec);

  // SE non-farm optional method interacts with the Sch C base in ways this
  // scenario can't preserve — decline rather than model it wrong.
  if (sumAdj(adjustments, "se_optional_method_nonfarm") > 0) {
    return notApplicable(
      "The SE non-farm optional method (Sch SE Part II) is elected — the S-corp scenario can't preserve it. Remove the election to run this comparison.",
    );
  }

  // Whose business is it? For MFJ with explicit spouse tags, the scenario W-2
  // must carry the owner's tag (per-spouse Sch SE / SS base). All-one-spouse
  // is supported; a business split across both spouses is not.
  const seAdjRows = adjustments.filter(
    (a) => a.adjustmentType === "self_employment_income" && (a.isApplied ?? true) && toNum(a.amount) !== 0,
  );
  const seSources: Array<{ spouse?: string | null }> = [...necRows, ...seAdjRows];
  const spouseTags = new Set(seSources.map((s) => (s.spouse === "spouse" ? "spouse" : "taxpayer")));
  if (spouseTags.size > 1) {
    return notApplicable(
      "Self-employment income is tagged to BOTH spouses — model each spouse's business separately (this calculator moves one Schedule C into one S-corp).",
    );
  }
  const owner: "taxpayer" | "spouse" = spouseTags.has("spouse") ? "spouse" : "taxpayer";

  // Net Schedule C profit P (the engine's own composition: NEC + SE adjustments
  // − expenses − manual depreciation − the asset-register depreciation).
  const necTotal = necRows.reduce((s, f) => s + toNum(f.nonemployeeCompensation), 0);
  const seAdjTotal = sumAdj(adjustments, "self_employment_income");
  const expenses = Math.max(0, sumAdj(adjustments, "schedule_c_expenses"));
  const manualDep = sumAdj(adjustments, "schedule_c_depreciation");
  const assetDep = baselineReturn.scheduleCAssetDepreciation?.totalDepreciation ?? 0;
  const profit = round2(necTotal + seAdjTotal - expenses - manualDep - assetDep);

  if (profit < MIN_PROFIT) {
    return notApplicable(
      `Net Schedule C profit ($${Math.round(profit).toLocaleString("en-US")}) is below $${MIN_PROFIT.toLocaleString("en-US")} — S-corp payroll/admin overhead exceeds any FICA savings at this size.`,
    );
  }

  // Per-person SS wages already used by the owner's other W-2 jobs (employee
  // excess-SS credit basis — see employeeFicaOnWages).
  const otherW2Ss = (baselineInputs.w2s ?? [])
    .filter((w) => (owner === "spouse" ? w.spouse === "spouse" : w.spouse !== "spouse"))
    .reduce((s, w) => s + (toNum(w.socialSecurityWagesBox3) || toNum(w.wagesBox1)), 0);

  // Comp levels: an explicit level, or a default sweep across the defensible
  // range (the curve is the deliverable — the CPA picks the defensible point).
  const requested = args.reasonableComp;
  const levels =
    requested != null && Number.isFinite(requested) && requested > 0
      ? [round2(requested)]
      : [0.35, 0.5, 0.6].map((f) => Math.round((profit * f) / 1000) * 1000).filter((w) => w > 0);

  const schCIsSstb = sumAdj(adjustments, "qbi_sstb_flag") > 0;

  const buildScenario = (wages: number, sCorpBox1: number): TaxReturnInputs => {
    const w2: W2Fact = {
      taxYear,
      wagesBox1: wages,
      socialSecurityWagesBox3: wages,
      medicareWagesBox5: wages,
      federalTaxWithheldBox2: 0,
      stateCode: baselineInputs.client.state ?? null,
      spouse: owner,
    };
    const k1: ScheduleK1Fact = {
      taxYear,
      entityName: "Modeled S-corp election",
      entityType: "s_corp",
      activityType: "active",
      box1OrdinaryIncome: sCorpBox1,
      section199aQbi: sCorpBox1,
      section199aW2Wages: wages,
      isSstb: schCIsSstb,
    };
    return {
      ...baselineInputs,
      form1099s: (baselineInputs.form1099s ?? []).filter((f) => !isNec(f)),
      adjustments: adjustments.filter((a) => !SE_INCOME_TYPES.has(a.adjustmentType)),
      scheduleCAssets: [],
      w2s: [...(baselineInputs.w2s ?? []), w2],
      scheduleK1: [...(baselineInputs.scheduleK1 ?? []), k1],
    };
  };

  const solePropNet = netTaxAfterCredits(baselineReturn);
  const options: EntityChoiceOption[] = [];
  for (const wages of levels) {
    const { employerFica, futa } = employerPayrollTaxes(wages, taxYear);
    const sCorpBox1 = round2(profit - wages - employerFica - futa);
    // Wages at/above profit make the election strictly worse (entity loss +
    // full FICA) — skip the level rather than chart nonsense.
    if (sCorpBox1 < 0) continue;
    const ret = computeTaxReturnPure(buildScenario(wages, sCorpBox1));
    const employeeFica = employeeFicaOnWages(wages, taxYear, otherW2Ss);
    const engineNet = netTaxAfterCredits(ret);
    const totalCost = round2(engineNet + employerFica + futa + employeeFica);
    options.push({
      reasonableComp: wages,
      sCorpOrdinaryIncome: sCorpBox1,
      employerFica,
      futa,
      employeeFica,
      engineNetTaxAfterCredits: round2(engineNet),
      totalCost,
      savingsVsSoleProp: round2(solePropNet - totalCost),
      scenario: {
        adjustedGrossIncome: ret.adjustedGrossIncome,
        taxableIncome: ret.taxableIncome,
        qbiDeduction: ret.qbiDeduction,
        federalTaxLiability: ret.federalTaxLiability,
        stateTaxLiability: ret.stateTaxLiability,
        selfEmploymentTax: ret.selfEmploymentTax,
      },
    });
  }

  if (options.length === 0) {
    return notApplicable(
      "No modelable comp level — the requested wages leave the S-corp with negative ordinary income.",
    );
  }

  const bestOption = options.reduce((best, o) => (o.totalCost < best.totalCost ? o : best));

  const assumptions = [
    "Reasonable compensation must be DEFENSIBLE for the role/hours/location (Rev. Rul. 74-44; RC Reports / BLS benchmark) — the lowest-cost modeled level is not a comp opinion.",
    "Payroll-service, bookkeeping, and Form 1120-S preparation costs (~$1,500–$3,000/yr typical) are NOT modeled — net them against the savings.",
    "State unemployment insurance (SUTA) and any state-level S-corp/franchise taxes are not modeled; state PTET upside is separate (see strategy G1.2).",
    "Employer FICA + FUTA are deducted from S-corp ordinary income AND counted as household cash cost (both are correct — they're the owner's money).",
    "Employee 6.2% SS respects the per-person annual base across other W-2 jobs (excess SS withholding is credited on the 1040); Additional Medicare 0.9% is computed by the engine on the W-2.",
    "SE health premiums: deducted in the sole-prop baseline (§162(l)); modeled net-zero under the S-corp (Box-1 wages offset by the §162(l) deduction per Notice 2008-1).",
    "Existing retirement contributions are held at baseline amounts — an S-corp plan keys off W-2 comp (e.g. SEP = 25% × wages), so re-run after choosing the comp level.",
    "§199A interplay is modeled for real: K-1 QBI = S-corp ordinary income with W-2 wages = owner comp feeding the wage/UBIA limit (and the SSTB phase-out when flagged).",
    "Crypto-mining, statutory-employee, and clergy income stay on Schedule C/SE in both runs (identical → they cancel in the comparison).",
  ];

  return {
    applicable: true,
    businessProfit: profit,
    soleProp: {
      netTaxAfterCredits: round2(solePropNet),
      selfEmploymentTax: baselineReturn.selfEmploymentTax,
      qbiDeduction: baselineReturn.qbiDeduction,
    },
    options,
    bestOption,
    assumptions,
  };
}
