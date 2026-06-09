/**
 * T1.3 — Strategy-combination global optimizer.
 *
 * Planning detectors fire individual strategies, each with an engine-verified
 * what-if mutation set. But strategies INTERACT — stacking two that both fill the
 * same bracket erodes the second one's value (the combined delta is usually LESS
 * than the sum of the individual deltas). Pairwise stacking (H7) misses the best
 * SUBSET. This finds it.
 *
 * Approach: greedy forward selection over the real engine. Start empty; each
 * round, try adding each remaining candidate's mutations on top of the current
 * stack, measure the MARGINAL savings via a true `computeTaxReturnPure` run, and
 * add the best one. Stop when no candidate adds positive marginal savings (or the
 * cap is reached). Greedy is near-optimal for the diminishing-returns (submodular-
 * like) structure of bracket-filling interactions and is O(N²) engine runs — far
 * cheaper than the 2^N exhaustive search, and it surfaces the per-step marginal
 * contribution a CPA wants to see.
 *
 * PURE — no Date/random/DB. Part of the Haven migration seam.
 */
import { computeTaxReturnPure, type TaxReturnInputs } from "./taxReturnEngine";
import { applyWhatIfMutations } from "./whatIfEngine";
import type { WhatIfMutation } from "@workspace/planning-strategies";

export interface StrategyCandidate {
  id: string;
  label?: string;
  mutations: WhatIfMutation[];
}

export interface ComboOptimizerStep {
  addedId: string;
  /** Marginal savings this step added (combined-with vs combined-without). */
  marginalSavings: number;
  /** Cumulative savings of the stack after this step. */
  cumulativeSavings: number;
}

export interface ComboOptimizerResult {
  /** The selected strategy ids, in the order greedily added (most valuable first). */
  selectedIds: string[];
  /** Refund-delta of the selected stack vs the baseline (positive = saves money). */
  combinedSavings: number;
  /** Σ of each selected strategy's STANDALONE savings. */
  sumOfIndividualSavings: number;
  /** combinedSavings − sumOfIndividualSavings. Usually ≤ 0 (interaction erosion);
   *  can be > 0 for complementary strategies. */
  interactionEffect: number;
  /** Per-step greedy trace (marginal contribution of each added strategy). */
  steps: ComboOptimizerStep[];
  /** Each candidate's standalone savings (id → refund delta), for transparency. */
  standaloneSavings: Record<string, number>;
}

/** Refund convention: federal + state refund/owed. Higher = better for the client. */
function refundOf(inputs: TaxReturnInputs): number {
  const r = computeTaxReturnPure(inputs);
  return (r.federalRefundOrOwed ?? 0) + (r.stateRefundOrOwed ?? 0);
}

export interface ComboOptimizerOptions {
  /** Cap the number of strategies in the recommended stack (default: all). */
  maxStrategies?: number;
  /** Minimum marginal savings to keep adding a strategy (default $1). */
  minMarginal?: number;
}

export function optimizeStrategyCombination(
  baseline: TaxReturnInputs,
  candidates: readonly StrategyCandidate[],
  options: ComboOptimizerOptions = {},
): ComboOptimizerResult {
  const minMarginal = options.minMarginal ?? 1;
  const maxStrategies = options.maxStrategies ?? candidates.length;
  const baseRefund = refundOf(baseline);
  const savingsOf = (mutations: WhatIfMutation[]): number =>
    refundOf(applyWhatIfMutations(baseline, mutations)) - baseRefund;

  // Standalone savings for every candidate (transparency + the sum-of-individuals).
  const standaloneSavings: Record<string, number> = {};
  for (const c of candidates) standaloneSavings[c.id] = savingsOf(c.mutations);

  const selected: StrategyCandidate[] = [];
  const remaining = [...candidates];
  const steps: ComboOptimizerStep[] = [];
  let cumulative = 0;

  while (selected.length < maxStrategies && remaining.length > 0) {
    let best: StrategyCandidate | null = null;
    let bestMarginal = minMarginal; // must beat the threshold to be added
    const selectedMutations = selected.flatMap((s) => s.mutations);
    for (const c of remaining) {
      const comboSavings = savingsOf([...selectedMutations, ...c.mutations]);
      const marginal = comboSavings - cumulative;
      if (marginal > bestMarginal) {
        bestMarginal = marginal;
        best = c;
      }
    }
    if (!best) break; // no remaining candidate adds material marginal savings
    selected.push(best);
    remaining.splice(remaining.indexOf(best), 1);
    cumulative += bestMarginal;
    steps.push({ addedId: best.id, marginalSavings: round2(bestMarginal), cumulativeSavings: round2(cumulative) });
  }

  const combinedSavings = savingsOf(selected.flatMap((s) => s.mutations));
  const sumOfIndividualSavings = selected.reduce((s, c) => s + (standaloneSavings[c.id] ?? 0), 0);
  return {
    selectedIds: selected.map((s) => s.id),
    combinedSavings: round2(combinedSavings),
    sumOfIndividualSavings: round2(sumOfIndividualSavings),
    interactionEffect: round2(combinedSavings - sumOfIndividualSavings),
    steps,
    standaloneSavings: Object.fromEntries(Object.entries(standaloneSavings).map(([k, v]) => [k, round2(v)])),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
