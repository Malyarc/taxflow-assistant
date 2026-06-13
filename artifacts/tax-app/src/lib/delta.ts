/**
 * UX 2.0 (T2.3 D5) — one diff grammar for every delta in the app.
 *
 * YoY, Form 1040-X amendments, what-if scenarios and roll-forward estimates all
 * show "this number changed". They used to each invent their own coloring (and
 * an old bug colored EVERY increase green, mis-signaling rising tax). This is
 * the single source of truth:
 *
 *   favorable direction (does an INCREASE help the taxpayer?) → tone → classes.
 *
 * A refund going UP is good (green); tax going UP is bad (red). The classifiers
 * below preserve the exact line/label sets the FE3 work established, so the
 * `<Delta>` pattern can replace the scattered `amendDeltaClass`/`yoyDeltaClass`
 * helpers byte-for-byte.
 */

/** Does an increase in this quantity help the taxpayer? */
export type FavorableDirection = "up" | "down" | "neutral";

/** The visual outcome of a signed change under a favorable direction. */
export type DeltaTone = "positive" | "negative" | "neutral";

/**
 * Form 1040-X line refs where a HIGHER value is BETTER for the taxpayer
 * (deductions, credits, withholding, payments, refundable credits, the refund
 * line). Keyed by the stable refs built in form1040x.ts. (Was
 * AMEND_BETTER_WHEN_HIGHER in ClientDetail.)
 */
export const AMEND_BETTER_WHEN_HIGHER: ReadonlySet<string> = new Set([
  "2", "4b", "7", "7a", "7b", "7c", "7d", "7e", "7f",
  "11", "13", "14", "16", "20", "S2", "S3",
]);

/**
 * Year-over-year metric labels where a HIGHER value is WORSE (income/tax lines —
 * an increase is unfavorable). Everything else (deductions/credits/refunds) is
 * higher-is-better. (Was YOY_HIGHER_IS_WORSE in ClientDetail.)
 */
export const YOY_HIGHER_IS_WORSE: ReadonlySet<string> = new Set([
  "Total Income", "AGI", "Taxable Income", "Federal Tax", "State Tax",
  "AMT", "SE Tax", "NIIT", "Net Capital Gain/Loss (Sch D)", "Rental Net (Sch E)",
]);

/** Favorable direction for a 1040-X line ref. */
export function amendLineDirection(lineRef: string): FavorableDirection {
  return AMEND_BETTER_WHEN_HIGHER.has(lineRef) ? "up" : "down";
}

/** Favorable direction for a YoY metric label. */
export function yoyLabelDirection(label: string): FavorableDirection {
  return YOY_HIGHER_IS_WORSE.has(label) ? "down" : "up";
}

/** Resolve a signed change + favorable direction into a visual tone. */
export function deltaTone(value: number, dir: FavorableDirection): DeltaTone {
  if (!Number.isFinite(value) || value === 0 || dir === "neutral") return "neutral";
  const favorable = dir === "up" ? value > 0 : value < 0;
  return favorable ? "positive" : "negative";
}

/** Tailwind text class for a tone (semantic tokens only). */
export function toneTextClass(tone: DeltaTone): string {
  return tone === "positive"
    ? "text-success"
    : tone === "negative"
      ? "text-destructive"
      : "text-muted-foreground";
}

/** Tailwind soft-background + text class for a tone (chips/badges). */
export function toneSoftClass(tone: DeltaTone): string {
  return tone === "positive"
    ? "bg-success/10 text-success"
    : tone === "negative"
      ? "bg-destructive/10 text-destructive"
      : "bg-muted text-muted-foreground";
}

/**
 * Back-compat shims — drop-in replacements for the two ClientDetail helpers so
 * the refactor is provably behavior-preserving. New code should prefer the
 * `<Delta>` component or `deltaTone` directly.
 */
export function amendDeltaClass(lineRef: string, netChange: number): string {
  if (!Number.isFinite(netChange) || netChange === 0) return "";
  return toneTextClass(deltaTone(netChange, amendLineDirection(lineRef)));
}
export function yoyDeltaClass(label: string, delta: number): string {
  if (!Number.isFinite(delta) || delta === 0) return "";
  return toneTextClass(deltaTone(delta, yoyLabelDirection(label)));
}
