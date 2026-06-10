/**
 * T2.1 B0 — Workpaper form-spec core (GAME PLAN B, Phase B0).
 *
 * A `FormInstance` is the PURE data model of one workpaper form: the official
 * form's parts + numbered lines, resolved against a `ComputedTaxReturn`.
 * Builders (`(ctx) => FormInstance | null`, null = not applicable to this
 * return) live one-per-form in this directory and MUST stay pure — no Date,
 * no randomness, no DB, no pdfkit. They are unit-tested by asserting on
 * FormInstance line values directly (no PDF parsing) and are Haven-portable
 * alongside the engine.
 *
 * Rendering is centralized in `formRenderer.ts` (the ONLY pdfkit dependency
 * in this directory); `registry.ts` assembles the one-click packet.
 *
 * Conventions:
 *  - Amounts are ENGINE-EXACT (cents), not whole-dollar rounded — the packet
 *    is a CPA cross-check workpaper, so every value must tie to the app to
 *    the cent. (Official forms round to whole dollars; the packet cover page
 *    discloses this.)
 *  - `line` carries the official form's line number ("1a", "9", "12"…) per
 *    the TY2024 official layout — the stable reference year. Later-year
 *    layout divergences are noted in `footnotes`, never silently renumbered.
 *  - Builders OMIT zero-value optional lines to keep forms scannable, but
 *    always render structural totals (use `showZero` semantics by emitting
 *    the line regardless of value).
 *  - A builder that exists but has nothing to report MUST return null rather
 *    than an empty shell — the packet only includes applicable forms.
 */

import type { ComputedTaxReturn, TaxReturnInputs } from "../taxReturnEngine";

export type FormLineKind = "money" | "text" | "boolean" | "percent" | "count";

export interface FormLine {
  /** Official form line number ("1a", "9"…). Empty string for unnumbered rows. */
  line: string;
  label: string;
  /** null renders as blank ("—"). */
  value: number | string | boolean | null;
  kind: FormLineKind;
  /** Bold + hairline rule — for totals and key results. */
  emphasis?: boolean;
  /** Indent level for sub-lines (0 = flush). */
  indent?: number;
  /** Short caveat/derivation note rendered under the label in fine print. */
  note?: string;
}

export interface FormPart {
  /** e.g. "Part I — Additional Income". Omit for single-part forms. */
  title?: string;
  lines: FormLine[];
}

export interface FormInstance {
  /** Stable kebab id ("1040", "schedule-1", "8812", "ca-540"). */
  formId: string;
  /** Display number ("Form 8812", "Schedule 1 (Form 1040)", "CA Form 540"). */
  formNumber: string;
  title: string;
  /** Official subtitle, e.g. "Credits for Qualifying Children and Other Dependents". */
  subtitle?: string;
  taxYear: number;
  parts: FormPart[];
  /** Form-level caveats / engine sub-gap disclosures, rendered in fine print. */
  footnotes?: string[];
}

/**
 * The taxpayer facts a builder may reference. Deliberately narrow — the API
 * route adapts the DB client row to this; tests construct it literally.
 */
export interface WorkpaperTaxpayer {
  firstName: string;
  lastName: string;
  email?: string | null;
  filingStatus: string;
  state: string;
  dependentsUnder17?: number | null;
  otherDependents?: number | null;
  taxpayerAge?: number | null;
  spouseAge?: number | null;
  isKiddieTaxFiler?: boolean | null;
  parentsTopMarginalRate?: number | null;
}

export interface FormBuildContext {
  taxpayer: WorkpaperTaxpayer;
  ret: ComputedTaxReturn;
  /**
   * Input-side facts for detail tables (Form 8949 lots, 4562 asset register,
   * Schedule E per-property, 8283 property gifts). Optional — builders MUST
   * degrade gracefully to aggregate-only rendering when absent.
   */
  inputs?: TaxReturnInputs;
}

export type FormBuilder = (ctx: FormBuildContext) => FormInstance | null;

export const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_widow: "Qualifying Surviving Spouse",
};

export function filingStatusLabel(status: string): string {
  return FILING_STATUS_LABELS[status] ?? status;
}

// ── Line constructors ────────────────────────────────────────────────────────

interface LineOpts {
  emphasis?: boolean;
  indent?: number;
  note?: string;
}

export function moneyLine(
  line: string,
  label: string,
  value: number | null | undefined,
  opts: LineOpts = {},
): FormLine {
  return { line, label, value: value ?? null, kind: "money", ...opts };
}

export function textLine(
  line: string,
  label: string,
  value: string | null | undefined,
  opts: LineOpts = {},
): FormLine {
  return { line, label, value: value ?? null, kind: "text", ...opts };
}

export function boolLine(
  line: string,
  label: string,
  value: boolean | null | undefined,
  opts: LineOpts = {},
): FormLine {
  return { line, label, value: value ?? null, kind: "boolean", ...opts };
}

export function countLine(
  line: string,
  label: string,
  value: number | null | undefined,
  opts: LineOpts = {},
): FormLine {
  return { line, label, value: value ?? null, kind: "count", ...opts };
}

export function pctLine(
  line: string,
  label: string,
  value: number | null | undefined,
  opts: LineOpts = {},
): FormLine {
  return { line, label, value: value ?? null, kind: "percent", ...opts };
}

/** True when the amount is meaningfully nonzero (guards optional lines). */
export function nz(n: number | null | undefined): boolean {
  return Math.abs(n ?? 0) >= 0.005;
}

/**
 * Tie-out check row: renders "✓ ties" when |actual − expected| < $0.01, else
 * a loud "⚠ off by $X" — the reconciliation worksheet's core device. Never
 * hide a discrepancy; the workpaper exists to SURFACE them.
 */
export function checkLine(
  label: string,
  actual: number,
  expected: number,
  opts: LineOpts = {},
): FormLine {
  const delta = actual - expected;
  const ties = Math.abs(delta) < 0.01;
  return {
    line: "",
    label: `${ties ? "✓" : "⚠"} ${label}`,
    value: ties
      ? "ties"
      : `off by ${delta < 0 ? "−" : "+"}$${Math.abs(delta).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    kind: "text",
    emphasis: !ties,
    ...opts,
  };
}
