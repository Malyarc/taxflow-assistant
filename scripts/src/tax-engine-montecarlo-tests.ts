/**
 * T1.3 — Monte Carlo layer over the multi-year projection engine.
 *
 * Standalone hand-calc / statistical tests. No API, no DB — pure engine.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-montecarlo-tests.ts
 *
 * Coverage:
 *   DETERMINISM   same seed ⇒ byte-identical MonteCarloResult.
 *   BAND ORDERING p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 for both metrics.
 *   CONVERGENCE   stdevReturn=0 ⇒ every trial identical ⇒ all bands == mean,
 *                 and the MC mean cumulative tax == a directly hand-computed
 *                 deterministic trajectory of the same scenario (the anchor).
 *   MONOTONICITY  higher meanReturn ⇒ higher median ending portfolio.
 *   DEFENSIVE     trials/horizon out of range are clamped; no NaN/Infinity.
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  projectYearForward,
} from "../../artifacts/api-server/src/lib/multiYearEngine";
import { applyWhatIfMutations } from "../../artifacts/api-server/src/lib/whatIfEngine";
import {
  runMonteCarlo,
  type MonteCarloOptions,
  type MonteCarloBands,
  type MonteCarloResult,
} from "../../artifacts/api-server/src/lib/monteCarloEngine";

const PASS: string[] = [];
const FAIL: string[] = [];

function check(label: string, actual: number, expected: number, tol = 1): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`ok    ${label}`);
  else FAIL.push(`FAIL  ${label}: expected ${expected} (±${tol}), got ${actual}`);
}
function assert(label: string, cond: boolean): void {
  if (cond) PASS.push(`ok    ${label}`);
  else FAIL.push(`FAIL  ${label}`);
}

/**
 * Realistic retiree baseline — single FL, age 68, $40k taxable pension
 * (1099-R) + $24k Social Security. FL has no state income tax, isolating the
 * federal arithmetic. (Mirrors the roth-optimizer retiree archetype.)
 */
function retireeBaseline(): TaxReturnInputs {
  return {
    client: {
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
      taxpayerAge: 68,
      socialSecurityBenefits: 24000,
    } as unknown as TaxReturnInputs["client"],
    w2s: [],
    form1099s: [
      {
        taxYear: 2024,
        formType: "r",
        payerName: "Pension",
        taxableAmount: 40000,
        grossDistribution: 40000,
      } as unknown as TaxReturnInputs["form1099s"][number],
    ],
    adjustments: [],
    taxYear: 2024,
  };
}

/**
 * Independent reference for the CONVERGENCE anchor. Replays the EXACT model the
 * Monte Carlo engine uses for a zero-volatility path (every year's return ==
 * meanReturn): grow the portfolio, realize the positive growth as additional
 * income, project the year forward, compute through the engine, accumulate
 * federal+state. Built only from PUBLIC engine functions, so if the MC engine's
 * internal walk drifts from this, the anchor test catches it.
 */
function deterministicTrajectory(
  baseline: TaxReturnInputs,
  opts: { horizonYears: number; meanReturn: number; incomeGrowth: number; startingPortfolio: number },
): { perYearTax: number[]; cumulativeTax: number; endingPortfolio: number } {
  let portfolio = opts.startingPortfolio;
  let cumulativeTax = 0;
  const perYearTax: number[] = [];
  for (let y = 0; y < opts.horizonYears; y++) {
    const r = opts.meanReturn;
    const grown = portfolio * (1 + r);
    const realized = Math.max(0, grown - portfolio);
    portfolio = r >= 0 ? portfolio : grown;
    let inputs = projectYearForward(baseline, y, { incomeGrowth: opts.incomeGrowth });
    if (realized > 0) {
      inputs = applyWhatIfMutations(inputs, [
        { kind: "add_adjustment", adjustmentType: "additional_income", amount: Math.round(realized) },
      ]);
    }
    const c = computeTaxReturnPure(inputs);
    const t = c.federalTaxLiability + c.stateTaxLiability;
    perYearTax.push(t);
    cumulativeTax += t;
  }
  return { perYearTax, cumulativeTax, endingPortfolio: portfolio };
}

function bandsAllFinite(b: MonteCarloBands): boolean {
  return [b.p10, b.p25, b.p50, b.p75, b.p90, b.mean].every((v) => Number.isFinite(v));
}
function bandsOrdered(b: MonteCarloBands): boolean {
  return b.p10 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p90;
}
function resultAllFinite(r: MonteCarloResult): boolean {
  return (
    bandsAllFinite(r.cumulativeTaxBurden) &&
    bandsAllFinite(r.endingPortfolioValue) &&
    r.perYearMedianTax.every((v) => Number.isFinite(v)) &&
    Number.isFinite(r.trials) &&
    Number.isFinite(r.horizonYears)
  );
}

const baseOpts: MonteCarloOptions = {
  trials: 500,
  horizonYears: 5,
  seed: 20260609,
  meanReturn: 0.06,
  stdevReturn: 0.12,
  incomeGrowth: 1.03,
  startingPortfolio: 1_000_000,
};

// ════════════════════════════════════════════════════════════════════════════
// DETERMINISM — same seed ⇒ byte-identical result (deep-equal via JSON).
// ════════════════════════════════════════════════════════════════════════════
console.log("── DETERMINISM: same seed ⇒ identical result ──");
{
  const a = runMonteCarlo(retireeBaseline(), baseOpts);
  const b = runMonteCarlo(retireeBaseline(), baseOpts);
  assert("two runs with the same seed are deep-equal", JSON.stringify(a) === JSON.stringify(b));
  // A different seed should generally NOT produce an identical distribution.
  const c = runMonteCarlo(retireeBaseline(), { ...baseOpts, seed: 999 });
  assert("a different seed yields a different result", JSON.stringify(a) !== JSON.stringify(c));
}

// ════════════════════════════════════════════════════════════════════════════
// BAND ORDERING — p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 for both metrics.
// ════════════════════════════════════════════════════════════════════════════
console.log("── BAND ORDERING: p10 ≤ p25 ≤ p50 ≤ p75 ≤ p90 ──");
{
  const r = runMonteCarlo(retireeBaseline(), baseOpts);
  assert("cumulativeTaxBurden bands are monotonically ordered", bandsOrdered(r.cumulativeTaxBurden));
  assert("endingPortfolioValue bands are monotonically ordered", bandsOrdered(r.endingPortfolioValue));
  // The mean of a right-skewed-ish tax distribution sits between p10 and p90.
  assert(
    "cumulative tax mean lies within [p10, p90]",
    r.cumulativeTaxBurden.mean >= r.cumulativeTaxBurden.p10 &&
      r.cumulativeTaxBurden.mean <= r.cumulativeTaxBurden.p90,
  );
  // With real volatility the bands must actually spread (not all collapsed).
  assert("volatility produces a non-trivial spread (p90 > p10)", r.cumulativeTaxBurden.p90 > r.cumulativeTaxBurden.p10);
  assert("ending portfolio spread (p90 > p10)", r.endingPortfolioValue.p90 > r.endingPortfolioValue.p10);
  assert("perYearMedianTax has one entry per year", r.perYearMedianTax.length === baseOpts.horizonYears);
}

// ════════════════════════════════════════════════════════════════════════════
// CONVERGENCE — stdevReturn = 0 ⇒ every trial identical ⇒ bands collapse to the
// mean, AND the MC mean cumulative tax == the hand-computed deterministic
// trajectory of the same scenario.
//
// HAND-CALC (1-year anchor, mean 6%, $1M portfolio, retiree baseline):
//   realized income y0 = max(0, 1,000,000 × 1.06 − 1,000,000) = $60,000.
//   Engine on (retiree + $60,000 additional_income): AGI $120,400, fed
//   $17,966.50, state $0 (FL). ⇒ cumulative tax (1yr) = $17,966.50.
//   Ending portfolio = $1,000,000 (the $60k gain is realized/distributed out;
//   an up year keeps the pre-growth balance per the conservative model).
// ════════════════════════════════════════════════════════════════════════════
console.log("── CONVERGENCE: stdev=0 ⇒ all bands == mean == deterministic trajectory ──");
{
  // 1-year anchor — fully hand-checkable.
  const opts1: MonteCarloOptions = {
    trials: 300,
    horizonYears: 1,
    seed: 42,
    meanReturn: 0.06,
    stdevReturn: 0, // no volatility
    incomeGrowth: 1.03,
    startingPortfolio: 1_000_000,
  };
  const r1 = runMonteCarlo(retireeBaseline(), opts1);
  const det1 = deterministicTrajectory(retireeBaseline(), {
    horizonYears: 1,
    meanReturn: 0.06,
    incomeGrowth: 1.03,
    startingPortfolio: 1_000_000,
  });
  // Hand-calc'd expectation.
  check("1yr deterministic cumulative tax = $17,966.50 (hand-calc)", det1.cumulativeTax, 17966.5, 0.5);
  check("1yr ending portfolio = $1,000,000 (gain realized out)", det1.endingPortfolio, 1_000_000, 0.5);
  // Bands all collapse to the single value.
  const b = r1.cumulativeTaxBurden;
  assert("1yr stdev=0: p10==p50", b.p10 === b.p50);
  assert("1yr stdev=0: p50==p90", b.p50 === b.p90);
  assert("1yr stdev=0: p50==mean", b.p50 === b.mean);
  // MC mean == the deterministic trajectory (the anchor identity).
  check("1yr MC mean cumulative tax == deterministic trajectory", r1.cumulativeTaxBurden.mean, det1.cumulativeTax, 0.01);
  check("1yr MC mean ending portfolio == deterministic", r1.endingPortfolioValue.mean, det1.endingPortfolio, 0.01);
  check("1yr MC per-year median[0] == deterministic year tax", r1.perYearMedianTax[0], det1.perYearTax[0], 0.01);

  // 5-year anchor — same identity over a longer horizon (income grows, so each
  // year's tax differs; the realized $60k is constant since an up year keeps the
  // portfolio flat). Cross-check the full MC mean against the deterministic Σ.
  const opts5: MonteCarloOptions = {
    trials: 400,
    horizonYears: 5,
    seed: 7,
    meanReturn: 0.06,
    stdevReturn: 0,
    incomeGrowth: 1.03,
    startingPortfolio: 1_000_000,
  };
  const r5 = runMonteCarlo(retireeBaseline(), opts5);
  const det5 = deterministicTrajectory(retireeBaseline(), {
    horizonYears: 5,
    meanReturn: 0.06,
    incomeGrowth: 1.03,
    startingPortfolio: 1_000_000,
  });
  check("5yr MC mean cumulative tax == deterministic Σ", r5.cumulativeTaxBurden.mean, det5.cumulativeTax, 0.01);
  // Bands collapse: every path is identical, so p10/p90 are byte-equal and the
  // mean matches them to within FP summation drift (mean reduces 5 floats ×400
  // trials; the percentile picks a single element — they agree to sub-cent).
  assert("5yr stdev=0: cumulative percentile bands byte-equal (p10==p90)",
    r5.cumulativeTaxBurden.p10 === r5.cumulativeTaxBurden.p90);
  check("5yr stdev=0: mean == collapsed band (FP-drift tolerance)",
    r5.cumulativeTaxBurden.mean, r5.cumulativeTaxBurden.p90, 1e-6);
  for (let y = 0; y < 5; y++) {
    check(`5yr per-year median[${y}] == deterministic`, r5.perYearMedianTax[y], det5.perYearTax[y], 0.01);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MONOTONICITY — higher meanReturn ⇒ higher median ending portfolio.
// (More volatility-free upside compounds the surviving balance higher; even
// with the conservative realize-gains model, down years are rarer/smaller.)
// ════════════════════════════════════════════════════════════════════════════
console.log("── MONOTONICITY: higher meanReturn ⇒ higher median ending portfolio ──");
{
  const low = runMonteCarlo(retireeBaseline(), { ...baseOpts, meanReturn: 0.03, seed: 555 });
  const high = runMonteCarlo(retireeBaseline(), { ...baseOpts, meanReturn: 0.09, seed: 555 });
  assert(
    "median ending portfolio rises with meanReturn (9% > 3%)",
    high.endingPortfolioValue.p50 > low.endingPortfolioValue.p50,
  );
  // Higher returns ⇒ more realized income ⇒ higher median cumulative tax too.
  assert(
    "median cumulative tax rises with meanReturn (9% > 3%)",
    high.cumulativeTaxBurden.p50 > low.cumulativeTaxBurden.p50,
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DEFENSIVE — clamping + totality (no NaN / Infinity anywhere).
// ════════════════════════════════════════════════════════════════════════════
console.log("── DEFENSIVE: clamps + no NaN/Infinity ──");
{
  // trials below the floor (1) clamps up to 100; horizon below floor (0) clamps to 1.
  const lowClamp = runMonteCarlo(retireeBaseline(), { ...baseOpts, trials: 1, horizonYears: 0 });
  check("trials clamped up to 100", lowClamp.trials, 100, 0);
  check("horizon clamped up to 1", lowClamp.horizonYears, 1, 0);
  assert("low-clamp result all finite", resultAllFinite(lowClamp));

  // trials above the ceiling (1e9) clamps to 5000; horizon above (999) clamps to 40.
  const hiClamp = runMonteCarlo(retireeBaseline(), { ...baseOpts, trials: 1_000_000_000, horizonYears: 999 });
  check("trials clamped down to 5000", hiClamp.trials, 5000, 0);
  check("horizon clamped down to 40", hiClamp.horizonYears, 40, 0);
  assert("hi-clamp result all finite", resultAllFinite(hiClamp));

  // Non-finite / nonsense control values must NOT leak NaN into the output.
  const garbage = runMonteCarlo(retireeBaseline(), {
    trials: Number.NaN as unknown as number,
    horizonYears: Number.POSITIVE_INFINITY as unknown as number,
    seed: Number.NaN as unknown as number,
    meanReturn: Number.NaN as unknown as number,
    stdevReturn: -5, // negative stdev clamps to 0
    incomeGrowth: Number.NaN as unknown as number,
    startingPortfolio: Number.NEGATIVE_INFINITY as unknown as number,
  });
  assert("garbage inputs ⇒ all-finite result (engine totality)", resultAllFinite(garbage));
  assert("garbage trials clamped into [100,5000]", garbage.trials >= 100 && garbage.trials <= 5000);
  assert("garbage horizon clamped into [1,40]", garbage.horizonYears >= 1 && garbage.horizonYears <= 40);
  // negative stdev ⇒ treated as 0 ⇒ bands collapse (no volatility).
  assert(
    "negative stdev treated as 0 (bands collapse)",
    garbage.cumulativeTaxBurden.p10 === garbage.cumulativeTaxBurden.p90,
  );

  // An extreme but finite return distribution must not blow up.
  const extreme = runMonteCarlo(retireeBaseline(), {
    ...baseOpts,
    trials: 200,
    meanReturn: 0.05,
    stdevReturn: 2.0, // 200% stdev → many draws below -100%, capped at -99.9999%
    seed: 13,
  });
  assert("extreme volatility ⇒ all-finite result", resultAllFinite(extreme));
  assert("extreme volatility ⇒ ending portfolio bands non-negative", extreme.endingPortfolioValue.p10 >= 0);
  assert("extreme volatility ⇒ tax bands non-negative", extreme.cumulativeTaxBurden.p10 >= 0);
  assert("extreme volatility ⇒ bands still ordered", bandsOrdered(extreme.cumulativeTaxBurden));
}

// ── Print results ───────────────────────────────────────────────────────────
console.log(`\nMonte Carlo engine tests:`);
console.log(`  Passed: ${PASS.length}`);
console.log(`  Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
  process.exit(1);
}
console.log("ALL MONTE CARLO CHECKS GREEN");
