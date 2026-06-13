/**
 * UX 2.0 (T2.3 D1) — the single source of numeric formatting.
 *
 * Before this, `fmt`/`pct` were redefined ~10 times across Dashboard,
 * ClientDetail, CpaToolsTab with subtly different options. These are the
 * canonical formatters; the `<Money>` / `<Delta>` patterns build on them so a
 * dollar figure looks identical on every surface (and transfers to Haven).
 *
 * Everything is null/NaN-safe and returns an em-dash placeholder rather than
 * "$NaN" — a tax UI must never render a garbage number.
 */

const EMDASH = "—";

type Numish = number | string | null | undefined;

/** Coerce a possibly-stringified decimal (Drizzle returns numerics as strings). */
function toNumber(n: Numish): number | null {
  if (n == null) return null;
  const v = typeof n === "string" ? Number(n) : n;
  return Number.isFinite(v) ? v : null;
}

/** Whole-dollar currency: $1,234. The default for nearly every figure. */
export function money(n: Numish): string {
  const v = toNumber(n);
  if (v == null) return EMDASH;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** Cent-precise currency: $1,234.56. For penalties, per-share, tie-outs. */
export function moneyCents(n: Numish): string {
  const v = toNumber(n);
  if (v == null) return EMDASH;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Explicit-sign currency: +$1,234 / −$1,234 (true minus glyph, not hyphen). */
export function signedMoney(n: Numish, opts?: { cents?: boolean }): string {
  const v = toNumber(n);
  if (v == null) return EMDASH;
  if (v === 0) return opts?.cents ? "$0.00" : "$0";
  const body = opts?.cents ? moneyCents(Math.abs(v)) : money(Math.abs(v));
  return v < 0 ? `−${body}` : `+${body}`;
}

/** Accounting parens for negatives: ($1,234). Used in amendment columns. */
export function accountingMoney(n: Numish): string {
  const v = toNumber(n);
  if (v == null) return EMDASH;
  if (v === 0) return "$0";
  const body = money(Math.abs(v));
  return v < 0 ? `(${body})` : body;
}

/** Abbreviated currency for dense displays: $1.2M, $45.0K, $980. */
export function abbrevMoney(n: Numish): string {
  const v = toNumber(n);
  if (v == null) return EMDASH;
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Percent from a FRACTION (0.22 → "22.0%"). */
export function pct(n: Numish, digits = 1): string {
  const v = toNumber(n);
  if (v == null) return EMDASH;
  return `${(v * 100).toFixed(digits)}%`;
}

/** Percent from an already-scaled value (22 → "22%"). */
export function pctScaled(n: Numish, digits = 0): string {
  const v = toNumber(n);
  if (v == null) return EMDASH;
  return `${v.toFixed(digits)}%`;
}

/** Plain grouped integer: 1,234. */
export function num(n: Numish): string {
  const v = toNumber(n);
  if (v == null) return EMDASH;
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export { toNumber, EMDASH };
