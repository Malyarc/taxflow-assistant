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
 *  - FS-2: the HOUSEHOLD-LEVEL `existingItemizedFallback` (the legacy
 *    single-number itemized total off the persisted tax_returns row) and the
 *    `overrides.additionalIncome`/`additionalDeductions` lump sums are
 *    EXCLUDED from both MFS halves — they are joint totals that cannot be
 *    attributed per spouse, and inheriting them deducted/added the full
 *    household amount TWICE across the pair (phantom MFS savings). Each MFS
 *    half itemizes only from its own per-line (tag-split) Schedule A
 *    adjustments. LIMITATION: a client whose itemized total lives ONLY in the
 *    legacy single-number column (no per-line adjustments) is compared as a
 *    standard-deduction MFS pair — disclosed in `assumptions.notes`.
 *  - §63(c)(6)(A): if one spouse itemizes, BOTH legal pairs are priced —
 *    both-itemize (TRUE forced itemizing via `overrides.forceItemized`; the
 *    no-deduction spouse claims their actual Schedule A total, possibly ~$0)
 *    AND both-standard — and the CHEAPER legal pair represents MFS. Reported
 *    via `itemizedCouplingApplied` + `itemizedCouplingChoice`.
 *  - FS-3: in the 9 community-property states the tag-based split is NOT how
 *    MFS works (community income is generally allocated 50/50 regardless of
 *    whose W-2 it is) — a caveat is added for those states.
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

interface MfsSplit {
  taxpayer: TaxReturnInputs;
  spouse: TaxReturnInputs;
  spouseTagsPresent: boolean;
}

/**
 * FS-2 — overrides safe to inherit into an MFS half. `taxYear` is a year
 * selector (not a dollar amount) and stays; the household-level lump-sum
 * dollar overrides (`additionalIncome` / `additionalDeductions`) and any
 * deduction-mode force flags are dropped — splitting an unattributable joint
 * total is the CPA's call, and inheriting it doubled it across the pair.
 */
function splitSafeOverrides(joint: TaxReturnInputs): TaxReturnInputs["overrides"] {
  const taxYear = joint.overrides?.taxYear;
  return taxYear != null ? { taxYear } : undefined;
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
    // FS-2 — the household-level legacy itemized total + lump-sum overrides
    // must not replicate into BOTH halves (each half would deduct/add the full
    // joint amount). Per-line Schedule A adjustments (tag-split above) drive
    // each spouse's itemized total instead.
    existingItemizedFallback: undefined,
    overrides: splitSafeOverrides(joint),
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
    // FS-2 — same household-total exclusions as the taxpayer half.
    existingItemizedFallback: undefined,
    overrides: splitSafeOverrides(joint),
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
    /**
     * FS-4 — which legal §63(c)(6) deduction pair won when the coupling fired:
     * "both_itemized" (forced) or "both_standard". Null when no coupling.
     */
    itemizedCouplingChoice: "both_itemized" | "both_standard" | null;
    dependentsAllocatedToPrimaryTaxpayer: boolean;
    notes: string[];
  };
}

/** FS-3 — the 9 community-property states (the tag split is wrong there). */
const COMMUNITY_PROPERTY_STATES: ReadonlySet<string> = new Set([
  "CA", "TX", "WA", "AZ", "ID", "LA", "NV", "NM", "WI",
]);

function summarize(ret: ComputedTaxReturn): FilingStatusReturnSummary {
  return {
    filingStatus: ret.filingStatus,
    totalIncome: ret.totalIncome,
    adjustedGrossIncome: ret.adjustedGrossIncome,
    taxableIncome: ret.taxableIncome,
    federalTaxLiability: ret.federalTaxLiability,
    stateTaxLiability: ret.stateTaxLiability,
    netTaxAfterCredits: netTaxAfterCredits(ret),
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

  // §63(c)(6)(A) — if exactly one spouse itemizes, the natural mixed pair
  // (one itemized + one standard) is ILLEGAL: an MFS filer whose spouse
  // itemizes has a $0 standard deduction. Price BOTH legal pairs and let the
  // cheaper one represent MFS (FS-1 + FS-4):
  //  - both-itemized: TRUE forced itemizing (`forceItemized` skips the
  //    engine's max-with-std protection — the no-deduction spouse claims
  //    their actual Schedule A total, possibly $0);
  //  - both-standard: both spouses take the standard deduction (the
  //    natural itemizer gives up Schedule A).
  const tpItemizes = tpRet.itemizedDeductions != null;
  const spItemizes = spRet.itemizedDeductions != null;
  let itemizedCouplingApplied = false;
  let itemizedCouplingChoice: "both_itemized" | "both_standard" | null = null;
  if (tpItemizes !== spItemizes) {
    itemizedCouplingApplied = true;
    const withOverride = (inp: TaxReturnInputs, o: Partial<NonNullable<TaxReturnInputs["overrides"]>>): TaxReturnInputs => ({
      ...inp,
      overrides: { ...(inp.overrides ?? {}), ...o },
    });
    const tpItem = computeTaxReturnPure(withOverride(split.taxpayer, { forceItemized: true }));
    const spItem = computeTaxReturnPure(withOverride(split.spouse, { forceItemized: true }));
    const tpStd = computeTaxReturnPure(withOverride(split.taxpayer, { forceStandardDeduction: true }));
    const spStd = computeTaxReturnPure(withOverride(split.spouse, { forceStandardDeduction: true }));
    const itemizedPairNet = netTaxAfterCredits(tpItem) + netTaxAfterCredits(spItem);
    const standardPairNet = netTaxAfterCredits(tpStd) + netTaxAfterCredits(spStd);
    if (itemizedPairNet <= standardPairNet) {
      tpRet = tpItem;
      spRet = spItem;
      itemizedCouplingChoice = "both_itemized";
    } else {
      tpRet = tpStd;
      spRet = spStd;
      itemizedCouplingChoice = "both_standard";
    }
  }

  const mfjNet = netTaxAfterCredits(jointReturn);
  const mfsNet = netTaxAfterCredits(tpRet) + netTaxAfterCredits(spRet);
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
      itemizedCouplingChoice === "both_itemized"
        ? "§63(c)(6)(A) applied: one spouse itemized naturally, so the two LEGAL pairs (both-itemized vs both-standard) were priced — BOTH-ITEMIZED was cheaper (the other spouse claims their actual Schedule A total, possibly near $0; a mixed itemized/standard pair is not allowed)."
        : "§63(c)(6)(A) applied: one spouse itemized naturally, so the two LEGAL pairs (both-itemized vs both-standard) were priced — BOTH-STANDARD was cheaper (the itemizing spouse gives up Schedule A; a mixed itemized/standard pair is not allowed).",
    );
  }
  // FS-2 — household-total exclusion disclosure (only relevant when the joint
  // inputs actually carried one of the excluded amounts).
  if (jointInputs.existingItemizedFallback != null && Number(jointInputs.existingItemizedFallback) > 0) {
    notes.push(
      "The legacy single-number itemized total on the joint return was EXCLUDED from both MFS halves (a household total cannot be attributed per spouse — pre-fix it deducted twice). Each MFS half itemizes only from its per-line Schedule A adjustments; if this client's deductions live only in the legacy column, enter them as per-line adjustments (with spouse tags) for an accurate MFS comparison.",
    );
  }
  if (
    (jointInputs.overrides?.additionalIncome ?? 0) !== 0 ||
    (jointInputs.overrides?.additionalDeductions ?? 0) !== 0
  ) {
    notes.push(
      "The joint return's lump-sum additionalIncome/additionalDeductions overrides were EXCLUDED from both MFS halves (unattributable household totals would double across the pair). Re-enter them as tagged per-spouse adjustments to include them in the split.",
    );
  }
  // FS-3 — community-property caveat.
  const state = (jointInputs.client.state ?? "").toUpperCase();
  if (COMMUNITY_PROPERTY_STATES.has(state)) {
    notes.push(
      `${state} is a COMMUNITY-PROPERTY state: on real MFS returns, community income (most wages/SE earned during the marriage) is generally allocated 50/50 between the spouses regardless of whose name is on the W-2 (IRS Pub 555; Form 8958). The tag-based split here does NOT model that allocation — treat the MFS side as indicative only and re-run with a 50/50 community split before recommending MFS.`,
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
      itemizedCouplingChoice,
      dependentsAllocatedToPrimaryTaxpayer: true,
      notes,
    },
  };
}
