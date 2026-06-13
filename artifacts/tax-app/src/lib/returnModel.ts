/**
 * UX 2.0 (T2.3 D3/D4) — the return form-model. A pure transform from the
 * computed `TaxReturn` into a form tree (1040 + schedules) of line items, each
 * carrying the engine IDENTITY that produced it as a provenance chain.
 *
 * The identities here are the engine's real invariants (see CLAUDE.md "Critical
 * tax-domain invariants"): AGI = total income − adjustments; taxable = AGI −
 * deduction − QBI; itemized = medical + SALT + mortgage + charitable; §121
 * taxable = gross − exclusion; etc. Where we can enumerate every component we
 * add a RESIDUAL line so the chain ties out by construction (the same checkLine
 * device the workpaper builders use) — never a fabricated tie-out.
 *
 * Pure + framework-free → this transfers to Haven's portals unchanged.
 */
import { toNumber } from "./format";
import type { ProvenanceChain, ProvenanceComponent } from "@/components/patterns/Provenance";

type Numish = number | string | null | undefined;
const n = (v: Numish): number => toNumber(v) ?? 0;
/** Is this figure present / non-trivial enough to model a line for? */
const has = (v: Numish): boolean => toNumber(v) != null && Math.abs(toNumber(v) ?? 0) > 0.005;

export interface LineItem {
  lineRef: string;
  label: string;
  value: number;
  /** "default" | a tone for refunds/owed. */
  tone?: "default" | "success" | "destructive" | "muted";
  /** Provenance chain → click-to-explain (D4). */
  chain?: ProvenanceChain;
  /** Emphasize as a subtotal/total row. */
  emphasis?: boolean;
}

export interface FormNode {
  id: string;
  /** Short tree label, e.g. "Form 1040". */
  name: string;
  /** One-line description for the tree. */
  caption: string;
  lines: LineItem[];
  /** Tie-out status for the whole form (any failing chain → false). */
  tiesOut: boolean;
}

/** A non-trivial subset of the TaxReturn fields this model reads. */
export interface ReturnLike {
  filingStatus?: string;
  totalIncome?: Numish; adjustedGrossIncome?: Numish; standardDeduction?: Numish;
  itemizedDeductions?: Numish; taxableIncome?: Numish; qbiDeduction?: Numish;
  federalTaxLiability?: Numish; federalTaxWithheld?: Numish; federalRefundOrOwed?: Numish;
  stateTaxLiability?: Numish; stateTaxWithheld?: Numish; stateRefundOrOwed?: Numish;
  effectiveTaxRate?: Numish; capitalGainsTax?: Numish; preferentialIncome?: Numish;
  selfEmploymentTax?: Numish; amtTax?: Numish; niitTax?: Numish; additionalMedicareTax?: Numish;
  stateIndividualMandatePenalty?: Numish; householdEmploymentTax?: Numish;
  unrecapturedSection1250Gain?: Numish; collectibles28RateGain?: Numish;
  medicalDeductible?: Numish; saltDeductible?: Numish; mortgageDeductible?: Numish; charitableDeductible?: Numish;
  hsaDeduction?: Numish; iraDeduction?: Numish; sehiDeduction?: Numish; nolDeduction?: Numish;
  homeSaleGrossGain?: Numish; homeSaleSection121Exclusion?: Numish; homeSaleTaxableGain?: Numish;
  socialSecurityBenefits?: Numish; socialSecurityTaxable?: Numish; feieTotalExclusion?: Numish;
  qsbsGrossGain?: Numish; qsbsSection1202Exclusion?: Numish; qsbsTaxableGain?: Numish;
  eitc?: Numish; aocCredit?: Numish; aocRefundablePortion?: Numish; llcCredit?: Numish;
  saversCredit?: Numish; dependentCareCredit?: Numish; additionalChildTaxCredit?: Numish;
  localTaxLiability?: Numish; localTaxJurisdiction?: string | null;
}

function tied(chain: ProvenanceChain): boolean {
  if (chain.operator === "custom") return true;
  const sum = chain.components.reduce((a, c) => a + (Number.isFinite(c.value) ? c.value : 0), 0);
  return Math.abs(sum - chain.result) < 0.01;
}

function formTiesOut(lines: LineItem[]): boolean {
  return lines.every((l) => !l.chain || tied(l.chain));
}

export function buildReturnModel(r: ReturnLike): FormNode[] {
  const forms: FormNode[] = [];

  // ── Form 1040 — income → AGI → taxable → settlement ──────────────────────
  {
    const totalIncome = n(r.totalIncome);
    const agi = n(r.adjustedGrossIncome);
    // Itemize when Schedule A is at least as large as the standard deduction
    // (ties go to itemized — Sch A line items exist). Kept consistent with the
    // Schedule A node condition below so line 12's label never disagrees with
    // whether the Sch A node is shown.
    const usedItemized = n(r.itemizedDeductions) > 0 && n(r.itemizedDeductions) >= n(r.standardDeduction);
    const deduction = usedItemized ? n(r.itemizedDeductions) : n(r.standardDeduction);
    const qbi = n(r.qbiDeduction);
    const taxable = n(r.taxableIncome);

    // AGI identity: total income − (enumerated adjustments + residual).
    const adjTotal = totalIncome - agi;
    const knownAdj: ProvenanceComponent[] = [];
    if (has(r.hsaDeduction)) knownAdj.push({ label: "HSA deduction (§223)", value: -n(r.hsaDeduction) });
    if (has(r.iraDeduction)) knownAdj.push({ label: "IRA deduction (§219)", value: -n(r.iraDeduction) });
    if (has(r.sehiDeduction)) knownAdj.push({ label: "SE health insurance (§162(l))", value: -n(r.sehiDeduction) });
    if (has(r.nolDeduction)) knownAdj.push({ label: "NOL carryforward (§172)", value: -n(r.nolDeduction) });
    const knownSum = knownAdj.reduce((a, c) => a + c.value, 0);
    const residualAdj = -(adjTotal) - knownSum; // remaining adjustments (½ SE tax, etc.)
    const agiComponents: ProvenanceComponent[] = [
      { label: "Total income", value: totalIncome, lineRef: "1040 line 9" },
      ...knownAdj,
    ];
    if (Math.abs(residualAdj) > 0.005) agiComponents.push({ label: "Other adjustments to income (Sch 1 Pt II)", value: residualAdj });

    const lines: LineItem[] = [
      {
        lineRef: "9", label: "Total income", value: totalIncome, emphasis: true,
        chain: {
          lineRef: "Form 1040, line 9", identity: "Total income = Σ all income sources", result: totalIncome,
          operator: "custom",
          components: [{ label: "Wages, interest, dividends, business, gains, K-1, …", value: totalIncome }],
          note: "Aggregated across W-2 / 1099 / Schedule C·D·E / K-1. Open a source tab to trace a single component.",
        },
      },
      {
        lineRef: "11", label: "Adjusted gross income (AGI)", value: agi, emphasis: true,
        chain: { lineRef: "Form 1040, line 11", identity: "AGI = Total income − Adjustments to income", result: agi, components: agiComponents },
      },
      {
        lineRef: "12", label: usedItemized ? "Itemized deductions (Sch A)" : "Standard deduction", value: deduction,
        chain: usedItemized ? undefined : {
          lineRef: "Form 1040, line 12", identity: "Standard deduction (filing-status table, OBBBA)", result: deduction, operator: "custom",
          components: [{ label: `Standard deduction — ${r.filingStatus ?? "filing status"}`, value: deduction }],
        },
      },
    ];
    if (has(r.qbiDeduction)) lines.push({ lineRef: "13", label: "QBI deduction (§199A)", value: qbi });
    lines.push({
      lineRef: "15", label: "Taxable income", value: taxable, emphasis: true,
      chain: {
        lineRef: "Form 1040, line 15", identity: "Taxable income = AGI − Deduction − QBI deduction", result: taxable,
        components: [
          { label: "Adjusted gross income", value: agi, lineRef: "line 11" },
          { label: usedItemized ? "Itemized deductions" : "Standard deduction", value: -deduction, lineRef: "line 12" },
          ...(has(r.qbiDeduction) ? [{ label: "QBI deduction", value: -qbi, lineRef: "line 13" }] : []),
        ],
        note: "Floored at $0. QBI cap is reduced by net capital gain per §199A(e)(3).",
      },
    });

    // Settlement
    const totalTax = n(r.federalTaxLiability);
    const withheld = n(r.federalTaxWithheld);
    const refund = n(r.federalRefundOrOwed);
    lines.push({ lineRef: "22", label: "Total tax (before refundable credits)", value: totalTax, emphasis: true });
    lines.push({ lineRef: "25", label: "Federal tax withheld", value: withheld });
    lines.push({
      lineRef: refund >= 0 ? "34" : "37", label: refund >= 0 ? "Refund" : "Amount owed",
      value: Math.abs(refund), emphasis: true, tone: refund >= 0 ? "success" : "destructive",
    });

    forms.push({ id: "1040", name: "Form 1040", caption: "U.S. Individual Income Tax Return", lines, tiesOut: formTiesOut(lines) });
  }

  // ── Schedule A — itemized deductions (only when itemizing) ────────────────
  if (n(r.itemizedDeductions) > 0 && n(r.itemizedDeductions) >= n(r.standardDeduction)) {
    const itemized = n(r.itemizedDeductions);
    const comps: ProvenanceComponent[] = [];
    if (has(r.medicalDeductible)) comps.push({ label: "Medical (over 7.5% AGI floor)", value: n(r.medicalDeductible) });
    if (has(r.saltDeductible)) comps.push({ label: "State & local taxes (§164, capped)", value: n(r.saltDeductible) });
    if (has(r.mortgageDeductible)) comps.push({ label: "Mortgage interest (§163(h))", value: n(r.mortgageDeductible) });
    if (has(r.charitableDeductible)) comps.push({ label: "Charitable contributions (§170)", value: n(r.charitableDeductible) });
    const known = comps.reduce((a, c) => a + c.value, 0);
    if (Math.abs(itemized - known) > 0.005) comps.push({ label: "Other itemized", value: itemized - known });
    const lines: LineItem[] = [
      ...comps.map((c, i) => ({ lineRef: String(i + 1), label: c.label, value: c.value })),
      {
        lineRef: "17", label: "Total itemized deductions", value: itemized, emphasis: true,
        chain: { lineRef: "Schedule A, line 17", identity: "Itemized = Medical + SALT + Mortgage + Charitable + Other", result: itemized, components: comps },
      },
    ];
    forms.push({ id: "schA", name: "Schedule A", caption: "Itemized deductions", lines, tiesOut: formTiesOut(lines) });
  }

  // ── Schedule 2 — other taxes (independent additions; no single tie-out) ───
  {
    const others: LineItem[] = [];
    if (has(r.selfEmploymentTax)) others.push({ lineRef: "4", label: "Self-employment tax (Sch SE)", value: n(r.selfEmploymentTax) });
    if (has(r.amtTax)) others.push({ lineRef: "1", label: "Alternative minimum tax (Form 6251)", value: n(r.amtTax) });
    if (has(r.niitTax)) others.push({ lineRef: "12", label: "Net investment income tax (Form 8960)", value: n(r.niitTax) });
    if (has(r.additionalMedicareTax)) others.push({ lineRef: "11", label: "Additional Medicare tax (Form 8959)", value: n(r.additionalMedicareTax) });
    if (has(r.householdEmploymentTax)) others.push({ lineRef: "9", label: "Household employment tax (Sch H)", value: n(r.householdEmploymentTax) });
    if (has(r.stateIndividualMandatePenalty)) others.push({ lineRef: "—", label: "State individual-mandate penalty", value: n(r.stateIndividualMandatePenalty) });
    if (others.length > 0) {
      const total = others.reduce((a, c) => a + c.value, 0);
      others.push({
        lineRef: "21", label: "Total other taxes", value: total, emphasis: true,
        chain: { lineRef: "Schedule 2, line 21", identity: "Other taxes = SE + AMT + NIIT + Add'l Medicare + …", result: total, components: others.map((o) => ({ label: o.label, value: o.value })) },
      });
      forms.push({ id: "sch2", name: "Schedule 2", caption: "Additional taxes", lines: others, tiesOut: formTiesOut(others) });
    }
  }

  // ── Credits (Schedule 3 + refundable) ────────────────────────────────────
  {
    const credits: LineItem[] = [];
    if (has(r.eitc)) credits.push({ lineRef: "27", label: "Earned income credit (§32)", value: n(r.eitc), tone: "success" });
    if (has(r.additionalChildTaxCredit)) credits.push({ lineRef: "28", label: "Additional child tax credit (§24)", value: n(r.additionalChildTaxCredit), tone: "success" });
    if (has(r.aocCredit)) credits.push({ lineRef: "3", label: "American Opportunity Credit (§25A)", value: n(r.aocCredit), tone: "success" });
    if (has(r.llcCredit)) credits.push({ lineRef: "3", label: "Lifetime Learning Credit (§25A)", value: n(r.llcCredit), tone: "success" });
    if (has(r.dependentCareCredit)) credits.push({ lineRef: "6", label: "Dependent care credit (§21)", value: n(r.dependentCareCredit), tone: "success" });
    if (has(r.saversCredit)) credits.push({ lineRef: "4", label: "Saver's credit (§25B)", value: n(r.saversCredit), tone: "success" });
    if (credits.length > 0) {
      forms.push({ id: "credits", name: "Credits", caption: "Schedule 3 + refundable credits", lines: credits, tiesOut: true });
    }
  }

  // ── Special-character / netting forms (each its own exact identity) ───────
  {
    const lines: LineItem[] = [];
    if (has(r.homeSaleGrossGain)) {
      const gross = n(r.homeSaleGrossGain), excl = n(r.homeSaleSection121Exclusion), taxable = n(r.homeSaleTaxableGain);
      lines.push({
        lineRef: "§121", label: "Home-sale taxable gain", value: taxable, emphasis: true,
        chain: { lineRef: "§121 exclusion", identity: "Taxable gain = Gross gain − §121 exclusion", result: taxable, components: [{ label: "Gross gain on primary residence", value: gross }, { label: "§121 exclusion", value: -excl }] },
      });
    }
    if (has(r.qsbsGrossGain)) {
      const gross = n(r.qsbsGrossGain), excl = n(r.qsbsSection1202Exclusion), taxable = n(r.qsbsTaxableGain);
      lines.push({
        lineRef: "§1202", label: "QSBS taxable gain", value: taxable, emphasis: true,
        chain: { lineRef: "§1202 exclusion", identity: "Taxable = Gross − §1202 exclusion (min $10M / 10× basis)", result: taxable, components: [{ label: "Gross QSBS gain", value: gross }, { label: "§1202 exclusion", value: -excl }] },
      });
    }
    if (has(r.socialSecurityBenefits)) {
      const ben = n(r.socialSecurityBenefits), tax = n(r.socialSecurityTaxable);
      lines.push({
        lineRef: "6b", label: "Taxable Social Security", value: tax,
        chain: { lineRef: "Form 1040, line 6b", identity: "Pub 915 worksheet (0% / 50% / 85% tiers)", result: tax, operator: "custom", components: [{ label: "Total SS benefits (line 6a)", value: ben }, { label: "Taxable portion (worksheet)", value: tax }], note: "Tiered on provisional income; not a simple subtraction." },
      });
    }
    if (lines.length > 0) forms.push({ id: "special", name: "Gains & exclusions", caption: "§121 · §1202 · Social Security", lines, tiesOut: formTiesOut(lines) });
  }

  // ── State & local ────────────────────────────────────────────────────────
  {
    const lines: LineItem[] = [];
    if (toNumber(r.stateTaxLiability) != null) {
      const liab = n(r.stateTaxLiability), wh = n(r.stateTaxWithheld), ro = n(r.stateRefundOrOwed);
      lines.push({ lineRef: "—", label: "State tax liability", value: liab, emphasis: true });
      if (has(r.stateTaxWithheld)) lines.push({ lineRef: "—", label: "State tax withheld", value: wh });
      lines.push({ lineRef: "—", label: ro >= 0 ? "State refund" : "State amount owed", value: Math.abs(ro), tone: ro >= 0 ? "success" : "destructive", emphasis: true });
    }
    if (has(r.localTaxLiability)) lines.push({ lineRef: "—", label: `Local tax${r.localTaxJurisdiction ? ` — ${r.localTaxJurisdiction}` : ""}`, value: n(r.localTaxLiability) });
    if (lines.length > 0) forms.push({ id: "state", name: "State & local", caption: "Resident / nonresident settlement", lines, tiesOut: true });
  }

  return forms;
}
