/**
 * UX 2.0 (T2.3 D1) — TypeScript view of the design tokens.
 *
 * CSS variables in index.css are the source of truth for *styling*; this file
 * mirrors the parts that JS needs (chart series, motion timings, the documented
 * scales) so charts and scripted animations don't hardcode hex/ms values. Read
 * live CSS-var values with `cssVar()` when an exact computed color is required.
 */

/** Motion tokens (mirror of --duration-* / --ease-* in index.css). */
export const motion = {
  durationFast: 120,
  durationBase: 180,
  durationSlow: 280,
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easeEmphasized: "cubic-bezier(0.3, 0, 0, 1)",
  easeExit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/**
 * The modular type scale (rem), documented for reference + JS measurement.
 * Mirrors the --text-* tokens; prefer the `.t-*` utility classes in markup.
 */
export const typeScale = {
  eyebrow: 0.6875,
  caption: 0.75,
  data: 0.8125,
  body: 0.875,
  metric: 2,
  display: 1.875,
} as const;

/** 4px base spacing scale (mirror of Tailwind's --spacing). */
export const spacingBase = 4;

/** Chart series, in order, as CSS-var references (theme-aware, dark-safe). */
export const chartSeries = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
] as const;

/** Read a live computed CSS custom property (e.g. cssVar("--brand")). */
export function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Whether the user has asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
