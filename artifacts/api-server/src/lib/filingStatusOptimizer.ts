/**
 * T2.2 D1 — MFJ-vs-MFS filing-status optimizer.
 *
 * Computes a married couple's combined tax both ways — Married Filing Jointly
 * (the baseline) and Married Filing Separately (two independent returns) — and
 * recommends the cheaper option with the dollar delta. The classic CPA
 * value-add (MFS occasionally wins on IBR/PSLF income-driven student-loan
 * payments, large one-spouse medical/casualty AGI floors, or state quirks).
 *
 * PURE (no Date/random/DB) — Haven-portable. Reuses `computeTaxReturnPure`.
 *
 * THE COMPARISON METRIC is the household's total tax AFTER all credits, which
 * is withholding-INDEPENDENT:  netTax = (fedWithheld − fedRefund) +
 * (stateWithheld − stateRefund) = (liability − credits) by the engine's refund
 * identity. Comparing refunds directly would be wrong (withholding differs).
 *
 * THE MFS SPLIT (documented assumptions; the CPA refines):
 *  - Income (W-2 / 1099 / SE adjustments) is allocated by the `spouse` tag;
 *    untagged records go to the primary taxpayer. `spouseTagsPresent` flags
 *    whether ANY tag was found — without tags the split assumes all income is
 *    the primary taxpayer's (the comparison is then only as good as that).
 *  - Dependents + household items (SS benefits, ACA) are assigned to the
 *    primary taxpayer (a dependent can be claimed by only ONE spouse on MFS).
 *  - §63(c)(6)(A): if one spouse itemizes, BOTH must — the optimizer detects
 *    this and forces itemized on both (the other gets their Schedule A total,
 *    possibly near $0). Reported via `itemizedCouplingApplied`.
 *  - The engine already disallows the MFS-barred credits (EITC, dependent care
 *    unless lived apart, the $25k PAL allowance when lived together, etc.).
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type ComputedTaxReturn,
  type W2Fact,
  type Form1099Fact,
  type AdjustmentFact,
  type ClientFacts,
} from "./taxReturnEngine";

const MFS = "married_filing_separately";

function tagOf(spouse: unknown): "taxpayer" | "spouse" {
  return spouse === "spouse" ? "spouse" : "taxpayer";
}

/**
 * Net household tax after credits (withholding-independent). By the engine's
 * refund identity, withheld − refund = liability − credits on both the federal
 * and state side. Shared with the entity-choice calculator (same metric).
 */
export function netTaxAfterCredits(ret: ComputedTaxReturn): number {
  return (
    ret.federalTaxWithheld - ret.federalRefundOrOwed +
    (ret.stateTaxWithheld - ret.stateRefundOrOwed)
  );
}
const netTax = netTaxAfterCredits;

interface MfsSplit {
  taxpayer: TaxReturnInputs;
  spouse: TaxReturnInputs;
  spouseTagsPresent: boolean;
}

function splitJointToMfs(joint: TaxReturnInputs): MfsSplit {
  const c = joint.client;
  const w2s = joint.w2s ?? [];
  const f99s = joint.form1099s ?? [];
  const adj = joint.adjustments ?? [];

  const spouseTagsPresent =
    w2s.some((w) => w.spouse === "spouse") ||
    f99s.some((f) => f.spouse === "spouse") ||
    adj.some((a) => a.spouse === "spouse");

  const pick = <T extends { spouse?: string | null }>(arr: T[], who: "taxpayer" | "spouse"): T[] =>
    arr.filter((x) => tagOf(x.spouse) === who);

  // Primary-taxpayer MFS return: keeps untagged + taxpayer-tagged income, all
  // dependents and household items, the taxpayer's own age/blind/IRA coverage.
  const taxpayerClient: ClientFacts = {
    ...c,
    filingStatus: MFS,
    spouseEarnedIncome: undefined,
    spouseAge: undefined,
    spouseBlind: undefined,
    iraSpouseCoveredByWorkplacePlan: undefined,
  };
  const taxpayer: TaxReturnInputs = {
    ...joint,
    client: taxpayerClient,
    w2s: pick(w2s as (W2Fact & { spouse?: string | null })[], "taxpayer"),
    form1099s: pick(f99s as (Form1099Fact & { spouse?: string | null })[], "taxpayer"),
    adjustments: pick(adj as (AdjustmentFact & { spouse?: string | null })[], "taxpayer"),
  };

  // Spouse MFS return: spouse-tagged income only, NO dependents/SS/ACA, the
  // spouse's age/blind/IRA coverage mapped to the primary slots.
  const spouseClient: ClientFacts = {
    ...c,
    filingStatus: MFS,
    taxpayerAge: c.spouseAge ?? null,
    taxpayerBlind: c.spouseBlind ?? null,
    iraCoveredByWorkplacePlan: c.iraSpouseCoveredByWorkplacePlan ?? null,
    spouseAge: undefined,
    spouseBlind: undefined,
    spouseEarnedIncome: undefined,
    iraSpouseCoveredByWorkplacePlan: undefined,
    dependentsUnder17: 0,
    otherDependents: 0,
    dependentsForCareCredit: 0,
    eitcQualifyingChildren: 0,
    socialSecurityBenefits: undefined,
    acaAnnualPremium: undefined,
    acaAdvanceAptc: undefined,
    acaAnnualSlcsp: undefined,
    acaHouseholdSize: undefined,
  };
  const spouse: TaxReturnInputs = {
    ...joint,
    client: spouseClient,
    w2s: pick(w2s as (W2Fact & { spouse?: string | null })[], "spouse"),
    form1099s: pick(f99s as (Form1099Fact & { spouse?: string | null })[], "spouse"),
    adjustments: pick(adj as (AdjustmentFact & { spouse?: string | null })[], "spouse"),
    // The spouse keeps none of the household-level per-property facts; income
    // attribution for those is the CPA's call (documented sub-gap).
    rentalProperties: [],
    scheduleK1: [],
    capitalTransactions: [],
    scheduleCAssets: [],
    form4797: [],
  };

  return { taxpayer, spouse, spouseTagsPresent };
}

export interface FilingStatusReturnSummary {
  filingStatus: string;
  totalIncome: number;
  adjustedGrossIncome: number;
  taxableIncome: number;
  federalTaxLiability: number;
  stateTaxLiability: number;
  /** Total household tax after all credits (withholding-independent). */
  netTaxAfterCredits: number;
  itemized: boolean;
}

export interface FilingStatusOptimizerResult {
  mfj: FilingStatusReturnSummary;
  mfs: {
    taxpayer: FilingStatusReturnSummary;
    spouse: FilingStatusReturnSummary;
    /** Combined MFS net tax after credits (taxpayer + spouse). */
    combinedNetTaxAfterCredits: number;
  };
  recommendation: "mfj" | "mfs";
  /** Positive dollars saved by the recommended status vs the other. */
  savings: number;
  assumptions: {
    spouseTagsPresent: boolean;
    itemizedCouplingApplied: boolean;
    dependentsAllocatedToPrimaryTaxpayer: boolean;
    notes: string[];
  };
}

function summarize(ret: ComputedTaxReturn): FilingStatusReturnSummary {
  return {
    filingStatus: ret.filingStatus,
    totalIncome: ret.totalIncome,
    adjustedGrossIncome: ret.adjustedGrossIncome,
    taxableIncome: ret.taxableIncome,
    federalTaxLiability: ret.federalTaxLiability,
    stateTaxLiability: ret.stateTaxLiability,
    netTaxAfterCredits: netTax(ret),
    itemized: ret.itemizedDeductions != null,
  };
}

export interface OptimizeFilingStatusArgs {
  jointInputs: TaxReturnInputs;
  jointReturn: ComputedTaxReturn;
}

/**
 * Returns null unless the baseline is Married Filing Jointly (the optimizer
 * only compares against MFS for a joint baseline).
 */
export function optimizeFilingStatus(
  args: OptimizeFilingStatusArgs,
): FilingStatusOptimizerResult | null {
  const { jointInputs, jointReturn } = args;
  if (jointReturn.filingStatus !== "married_filing_jointly") return null;

  const split = splitJointToMfs(jointInputs);
  let tpRet = computeTaxReturnPure(split.taxpayer);
  let spRet = computeTaxReturnPure(split.spouse);

  // §63(c)(6)(A) — if exactly one spouse itemizes, BOTH must itemize.
  const tpItemizes = tpRet.itemizedDeductions != null;
  const spItemizes = spRet.itemizedDeductions != null;
  let itemizedCouplingApplied = false;
  if (tpItemizes !== spItemizes) {
    itemizedCouplingApplied = true;
    const forceItemized = (inp: TaxReturnInputs): TaxReturnInputs => ({
      ...inp,
      overrides: { ...(inp.overrides ?? {}), useItemizedDeductions: true },
    });
    tpRet = computeTaxReturnPure(forceItemized(split.taxpayer));
    spRet = computeTaxReturnPure(forceItemized(split.spouse));
  }

  const mfjNet = netTax(jointReturn);
  const mfsNet = netTax(tpRet) + netTax(spRet);
  const recommendation: "mfj" | "mfs" = mfsNet < mfjNet - 0.5 ? "mfs" : "mfj";
  const savings = Math.abs(mfjNet - mfsNet);

  const notes: string[] = [
    "Comparison metric = total household tax after all credits (withholding-independent); refunds are NOT compared directly.",
  ];
  if (!split.spouseTagsPresent) {
    notes.push(
      "No per-spouse income tags found — the MFS split assumed ALL income belongs to the primary taxpayer. Tag W-2/1099/SE income with `spouse: \"spouse\"` for an accurate split.",
    );
  }
  if (itemizedCouplingApplied) {
    notes.push(
      "§63(c)(6)(A) applied: one spouse itemized, so BOTH were forced to itemize (the other gets their Schedule A total, possibly near $0).",
    );
  }
  notes.push(
    "All dependents + Social Security + ACA were assigned to the primary taxpayer's MFS return (a dependent can be claimed by only one spouse). Per-property income (rentals/K-1/capital transactions) stayed on the primary return — re-attribute as needed.",
  );

  return {
    mfj: summarize(jointReturn),
    mfs: {
      taxpayer: summarize(tpRet),
      spouse: summarize(spRet),
      combinedNetTaxAfterCredits: mfsNet,
    },
    recommendation,
    savings,
    assumptions: {
      spouseTagsPresent: split.spouseTagsPresent,
      itemizedCouplingApplied,
      dependentsAllocatedToPrimaryTaxpayer: true,
      notes,
    },
  };
}
