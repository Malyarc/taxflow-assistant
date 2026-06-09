/**
 * Monte Carlo layer over the multi-year projection engine (T1.3).
 *
 * Given a baseline TaxReturnInputs, runs `trials` independent stochastic paths
 * over a `horizonYears` horizon. Each year of each trial draws an investment
 * return r ~ Normal(meanReturn, stdevReturn) from a SEEDED PRNG, grows a
 * portfolio by (1 + r), realizes the positive growth as that year's taxable
 * investment income, and projects the year's tax through the EXISTING engine
 * (`projectYearForward` + `computeTaxReturnPure`) — the Monte Carlo layer never
 * re-implements any tax math. It collects each trial's cumulative tax burden
 * and ending portfolio value, then reports percentile bands (p10/p25/p50/p75/
 * p90 + mean) across the trials.
 *
 * Why a portfolio income model: tax burden in retirement (and for any investor)
 * is dominated by how much investment income gets realized, which is driven by
 * market returns. By drawing the return stochastically and feeding the realized
 * income into the engine, the bands answer "given market uncertainty, what is
 * the distribution of my multi-year tax bill (and my portfolio's terminal
 * value)?" — the canonical retirement-planning Monte Carlo question.
 *
 * PURITY (this is the Haven migration seam — purity is mandatory):
 *   - No `Date`, no `Math.random`, no DB, no network, no framework.
 *   - Randomness is a SEEDED mulberry32 PRNG + a Box–Muller normal transform,
 *     both implemented inline below. Results are byte-for-byte deterministic
 *     given (baseline, options). Trial k draws from a sub-seed derived
 *     deterministically from `seed` and `k`, so trials are independent yet the
 *     whole run is reproducible.
 *
 * Every modeling assumption is surfaced in the result's `assumptions[]`.
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "./taxReturnEngine";
import {
  projectYearForward,
  DEFAULT_INCOME_GROWTH,
} from "./multiYearEngine";
import { applyWhatIfMutations } from "./whatIfEngine";

// ── Public contract ─────────────────────────────────────────────────────────

export interface MonteCarloOptions {
  /** Number of independent stochastic paths. Clamped to [100, 5000]. */
  trials: number;
  /** Projection horizon in years (inclusive of year 0). Clamped to [1, 40]. */
  horizonYears: number;
  /** PRNG seed — same seed ⇒ identical result. */
  seed: number;
  /** Mean annual investment return (e.g. 0.06 = 6%). */
  meanReturn: number;
  /** Stdev of the annual return (e.g. 0.12 = 12% volatility). 0 ⇒ no volatility. */
  stdevReturn: number;
  /** Annual income-growth factor for the underlying W-2/1099 facts (default 1.03). */
  incomeGrowth?: number;
  /** Starting investable portfolio whose returns drive realized income. Default $1,000,000. */
  startingPortfolio?: number;
}

/** Percentile bands across the trials for a single metric. */
export interface MonteCarloBands {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
}

export interface MonteCarloResult {
  /** Effective trial count after clamping. */
  trials: number;
  /** Effective horizon after clamping. */
  horizonYears: number;
  /** Distribution of the cumulative (federal + state) tax burden over the horizon. */
  cumulativeTaxBurden: MonteCarloBands;
  /** Distribution of the portfolio value at the end of the horizon. */
  endingPortfolioValue: MonteCarloBands;
  /** Median tax for each projection year, index 0..horizonYears-1. */
  perYearMedianTax: number[];
  /** Human-readable modeling assumptions, surfaced for the CPA/advisor. */
  assumptions: string[];
}

// ── Defaults + clamps ───────────────────────────────────────────────────────

const DEFAULT_STARTING_PORTFOLIO = 1_000_000;

/** Each trial × year runs the full engine; unbounded counts are a DoS vector. */
const MIN_TRIALS = 100;
const MAX_TRIALS = 5000;
const MIN_HORIZON = 1;
const MAX_HORIZON = 40;

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/** Sanitize a finite float; non-finite ⇒ fallback. */
function finiteOr(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Deterministic thousands-separator (independent review 2026-06-09): avoid
 *  `toLocaleString` in the result, whose grouping depends on the JS engine's ICU
 *  data — the determinism contract deep-equals the whole result incl. assumptions. */
function fmtThousands(n: number): string {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ── Seeded PRNG (mulberry32) + Box–Muller normal ────────────────────────────
// mulberry32 — a small, well-distributed 32-bit PRNG. Deterministic given the
// seed; no global state, no Math.random. Each instance carries its own state so
// trials never share a stream.

function mulberry32(seed: number): () => number {
  // Coerce to a uint32 state.
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box–Muller transform: turn two uniform(0,1) draws into one standard normal.
 * We take only the first of the pair (cos branch) per call for simplicity — the
 * mulberry32 stream is long enough that discarding the sin branch costs nothing
 * statistically. `u1` is floored away from 0 so log() never hits -Infinity.
 */
function nextNormal(uniform: () => number): number {
  let u1 = uniform();
  const u2 = uniform();
  if (u1 < 1e-12) u1 = 1e-12;
  const mag = Math.sqrt(-2.0 * Math.log(u1));
  return mag * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Derive a deterministic, well-spread per-trial sub-seed from the run seed and
 * the trial index. Mixing with the golden-ratio constant (0x9E3779B9) and a
 * couple of xorshifts decorrelates adjacent trials (k and k+1 would otherwise
 * produce nearly-identical mulberry32 streams).
 */
function subSeed(seed: number, k: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// ── Single-path engine walk (shared by MC + the deterministic anchor) ───────

/**
 * Walk the horizon once. `drawReturn(year)` supplies that year's investment
 * return (stochastic for MC, constant `meanReturn` for the convergence anchor).
 *
 * Model, per year y (0-based):
 *   1. Project the baseline income forward y years (income grows at incomeGrowth,
 *      taxYear advances) — reuses the engine's `projectYearForward`.
 *   2. Grow the portfolio: r = drawReturn(y); portfolio *= (1 + r).
 *   3. Realize the POSITIVE growth as taxable investment income for the year
 *      (`additional_income`) and re-grow next year off the post-realization
 *      balance. A down year (r < 0) realizes nothing (no forced gain; the loss
 *      stays embedded in the portfolio). This is a deliberately conservative,
 *      fully-realize-the-gains model — surfaced in assumptions.
 *   4. Compute the year's return through the engine; accumulate federal+state.
 *
 * Returns the per-year tax and the cumulative tax + ending portfolio for the path.
 */
interface PathResult {
  perYearTax: number[];
  cumulativeTax: number;
  endingPortfolio: number;
}

function runSinglePath(
  baseline: TaxReturnInputs,
  cfg: {
    horizonYears: number;
    incomeGrowth: number;
    startingPortfolio: number;
  },
  drawReturn: (year: number) => number,
): PathResult {
  let portfolio = cfg.startingPortfolio;
  let cumulativeTax = 0;
  const perYearTax: number[] = [];

  for (let y = 0; y < cfg.horizonYears; y++) {
    const r = drawReturn(y);
    const growthFactor = 1 + r;
    const grown = portfolio * growthFactor;
    // Realized taxable income = the positive growth this year (gains only).
    const realizedIncome = Math.max(0, grown - portfolio);
    // The portfolio carried to next year is the grown balance minus the income
    // we just "took out" as realized/spent — i.e. it stays at `portfolio` after a
    // realized gain (gains distributed out), but a down year keeps the full grown
    // (lower) balance with the loss embedded.
    portfolio = r >= 0 ? portfolio : grown;
    // Guard against any pathological non-finite drift (e.g. extreme draws).
    if (!Number.isFinite(portfolio)) portfolio = 0;

    let inputs = projectYearForward(baseline, y, { incomeGrowth: cfg.incomeGrowth });
    if (realizedIncome > 0) {
      inputs = applyWhatIfMutations(inputs, [
        {
          kind: "add_adjustment",
          adjustmentType: "additional_income",
          amount: Math.round(realizedIncome),
        },
      ]);
    }

    const computed = computeTaxReturnPure(inputs);
    const fed = finiteOr(computed.federalTaxLiability, 0);
    const state = finiteOr(computed.stateTaxLiability, 0);
    const yearTax = fed + state;
    perYearTax.push(yearTax);
    cumulativeTax += yearTax;
  }

  return {
    perYearTax,
    cumulativeTax: Number.isFinite(cumulativeTax) ? cumulativeTax : 0,
    endingPortfolio: Number.isFinite(portfolio) ? portfolio : 0,
  };
}

// ── Percentile bands ────────────────────────────────────────────────────────

/**
 * Linear-interpolated percentile (the "type 7" definition used by NumPy/Excel
 * PERCENTILE). `sorted` must be ascending. p in [0,1].
 */
function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function bandsFromSamples(samples: number[]): MonteCarloBands {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
  return {
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    mean,
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Run a Monte Carlo simulation over the multi-year tax projection. PURE +
 * deterministic given (baseline, options).
 */
export function runMonteCarlo(
  baseline: TaxReturnInputs,
  options: MonteCarloOptions,
): MonteCarloResult {
  // Defensive input clamping (DoS guard + totality — the engine must never see
  // a non-finite control value).
  const trials = clampInt(options.trials, MIN_TRIALS, MAX_TRIALS, MIN_TRIALS);
  const horizonYears = clampInt(options.horizonYears, MIN_HORIZON, MAX_HORIZON, MIN_HORIZON);
  const seed = Math.trunc(finiteOr(options.seed, 0)) >>> 0;
  const meanReturn = finiteOr(options.meanReturn, 0);
  // A negative or non-finite stdev is meaningless; clamp at 0 (no volatility).
  const stdevReturn = Math.max(0, finiteOr(options.stdevReturn, 0));
  const incomeGrowth = finiteOr(options.incomeGrowth, DEFAULT_INCOME_GROWTH);
  // Totality fix (independent review 2026-06-09): clamp the starting portfolio to a
  // sane upper bound so growth compounding + the trial-mean reduction can never
  // overflow to Infinity (mirrors the engine's ±1e13 money clamp). Without this an
  // extreme startingPortfolio (e.g. 1e308) overflowed endingPortfolioValue.mean.
  const MAX_PORTFOLIO = 1e13;
  const startingPortfolio = Math.min(MAX_PORTFOLIO, Math.max(0, finiteOr(options.startingPortfolio, DEFAULT_STARTING_PORTFOLIO)));

  const cfg = { horizonYears, incomeGrowth, startingPortfolio };

  // Per-trial samples.
  const cumulativeTaxSamples: number[] = new Array(trials);
  const endingPortfolioSamples: number[] = new Array(trials);
  // Per-year tax collected across trials → per-year median.
  const perYearTaxByYear: number[][] = Array.from({ length: horizonYears }, () => []);

  for (let k = 0; k < trials; k++) {
    // Each trial gets its own independent, deterministic PRNG stream.
    const rng = mulberry32(subSeed(seed, k));
    const drawReturn = (_year: number): number => {
      // stdev 0 ⇒ every draw is exactly meanReturn (no volatility) → every trial
      // is identical → the bands collapse to the mean (the convergence anchor).
      if (stdevReturn === 0) return meanReturn;
      const z = nextNormal(rng);
      const r = meanReturn + stdevReturn * z;
      // Cap the return at -100% (can't lose more than the whole portfolio in a
      // year) so the portfolio never goes negative from an extreme draw.
      return r < -0.999999 ? -0.999999 : r;
    };

    const path = runSinglePath(baseline, cfg, drawReturn);
    cumulativeTaxSamples[k] = path.cumulativeTax;
    endingPortfolioSamples[k] = path.endingPortfolio;
    for (let y = 0; y < horizonYears; y++) {
      perYearTaxByYear[y].push(path.perYearTax[y]);
    }
  }

  const perYearMedianTax = perYearTaxByYear.map((ys) => {
    const sorted = [...ys].sort((a, b) => a - b);
    return percentile(sorted, 0.5);
  });

  return {
    trials,
    horizonYears,
    cumulativeTaxBurden: bandsFromSamples(cumulativeTaxSamples),
    endingPortfolioValue: bandsFromSamples(endingPortfolioSamples),
    perYearMedianTax,
    assumptions: [
      `${trials} independent paths over a ${horizonYears}-year horizon (both clamped: trials∈[${MIN_TRIALS},${MAX_TRIALS}], horizon∈[${MIN_HORIZON},${MAX_HORIZON}]).`,
      `Each year's investment return ~ Normal(mean=${(meanReturn * 100).toFixed(2)}%, stdev=${(stdevReturn * 100).toFixed(2)}%), drawn from a seeded mulberry32 PRNG (seed=${seed}) via a Box–Muller normal transform. Results are fully deterministic for this (baseline, seed).`,
      `Starting investable portfolio = $${fmtThousands(startingPortfolio)}. Underlying W-2/1099 income is projected forward at ${((incomeGrowth - 1) * 100).toFixed(1)}%/yr (reuses the multi-year engine; future brackets are held at the latest published year — the DELTA across paths is what's meaningful).`,
      `Income model: each year's POSITIVE portfolio growth is realized as taxable ordinary income (additional_income) and computed through the full engine; a down year realizes nothing and embeds the loss in the portfolio. This is a deliberately CONSERVATIVE fully-realize-gains model (no deferral, no preferential LTCG bucketing of the realized amount, no withdrawals) — actual tax will usually be lower.`,
      `cumulativeTaxBurden = Σ (federalTaxLiability + stateTaxLiability) over the horizon, per path; bands are the p10/p25/p50/p75/p90 + mean across paths (linear-interpolated percentiles).`,
      `With stdevReturn = 0 every path is identical, so all bands equal the mean and equal a single deterministic multi-year trajectory of the same scenario (the hand-checkable anchor).`,
    ],
  };
}
