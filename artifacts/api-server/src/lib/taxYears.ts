// Single source of truth for the set of tax years the engine supports plus the
// year-clamping helper. This is a LEAF module — it imports nothing from the rest
// of the engine — so any module (taxCalculator, stateTaxData, form2210, the
// planning engine, …) can import `TaxYear` without creating an import cycle.
// taxCalculator re-exports all four names, so existing
// `import { SUPPORTED_TAX_YEARS, TaxYear, resolveTaxYear } from "./taxCalculator"`
// call sites keep working unchanged.
//
// FRESHNESS CONTRACT: to activate a new tax year, append it to
// SUPPORTED_TAX_YEARS below, then fill in every `Record<TaxYear>` map across the
// engine. The TypeScript compiler flags each missing key as a build error, and
// the T1 year-coverage CI test (scripts/src/tax-engine-year-coverage-tests.ts)
// asserts that no year-indexed map or function silently falls back to a stale
// year. See docs/tax-year-maintenance.md for the annual IRS-source playbook.

export const SUPPORTED_TAX_YEARS = [2024, 2025, 2026] as const;
export type TaxYear = (typeof SUPPORTED_TAX_YEARS)[number];

// LATEST_YEAR is the default for an unspecified (null) tax year. Held at 2025
// (the "current" filing year) so adding native TY2026 doesn't shift the default
// for callers that omit taxYear. An explicit TY2026 computes natively.
export const LATEST_YEAR: TaxYear = 2025;

/**
 * Clamp an arbitrary numeric year to a supported TaxYear:
 *  - null / undefined        -> LATEST_YEAR (the default filing year)
 *  - a supported year        -> itself
 *  - below the supported range -> the earliest supported year (2024)
 *  - above the supported range -> LATEST_YEAR
 *
 * This is the engine-wide convention for tolerating out-of-range input without
 * crashing. Combined with `Record<TaxYear>` maps it guarantees a real value for
 * every supported year (a missing key is a compile error) while still degrading
 * gracefully for unsupported input.
 */
export function resolveTaxYear(input: number | undefined | null): TaxYear {
  if (input == null) return LATEST_YEAR;
  if ((SUPPORTED_TAX_YEARS as readonly number[]).includes(input)) {
    return input as TaxYear;
  }
  // Unsupported: fall back to the nearest available year.
  if (input < 2024) return 2024;
  return LATEST_YEAR;
}
