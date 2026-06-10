/**
 * T2.2 D2 — Engagement status + filing due-date tracking.
 *
 * Lightweight per-return workflow state for the firm's busy-season view: a
 * status enum + an extension flag persisted on tax_returns, and the statutory
 * individual filing deadlines computed from the tax year.
 *
 * PURE (deterministic from inputs — no Date.now/DB). Deadline rule (IRC
 * §6072(a) + §7503): April 15 of the following year, rolled forward to the
 * next business day when it lands on a weekend; the §6081 automatic extension
 * runs to October 15, same weekend roll. DC Emancipation Day / Patriots' Day
 * holiday shifts are NOT modeled (a 1–2 day conservatism in ~1 of 7 years) —
 * the computed date is never LATER than the true deadline.
 *
 * This is deliberately minimal (status + deadline math) — full workflow
 * (assignments, review queues, e-sign) is Haven's domain after migration.
 */

export const ENGAGEMENT_STATUSES = [
  "not_started",
  "awaiting_documents",
  "in_preparation",
  "in_review",
  "ready_to_file",
  "filed",
] as const;

export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export function isEngagementStatus(v: unknown): v is EngagementStatus {
  return typeof v === "string" && (ENGAGEMENT_STATUSES as readonly string[]).includes(v);
}

/** Roll a UTC date forward past Sat/Sun per §7503 (weekend → next Monday). */
function rollToBusinessDay(utcMs: number): number {
  const day = new Date(utcMs).getUTCDay();
  if (day === 6) return utcMs + 2 * 86_400_000; // Saturday → Monday
  if (day === 0) return utcMs + 1 * 86_400_000; // Sunday → Monday
  return utcMs;
}

function iso(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

export interface FilingDeadlines {
  /** §6072(a) individual filing deadline (April 15 + weekend roll), ISO date. */
  filingDeadline: string;
  /** §6081 extended deadline (October 15 + weekend roll), ISO date. */
  extendedDeadline: string;
}

export function filingDeadlinesFor(taxYear: number): FilingDeadlines {
  const filing = rollToBusinessDay(Date.UTC(taxYear + 1, 3, 15));
  const extended = rollToBusinessDay(Date.UTC(taxYear + 1, 9, 15));
  return { filingDeadline: iso(filing), extendedDeadline: iso(extended) };
}

/** The deadline this return is actually working toward, given the extension flag. */
export function effectiveDeadline(taxYear: number, extensionFiled: boolean): string {
  const d = filingDeadlinesFor(taxYear);
  return extensionFiled ? d.extendedDeadline : d.filingDeadline;
}

/**
 * Whole days from `asOf` (ISO date) to the effective deadline. Negative =
 * past due. `asOf` is caller-supplied (the route passes today) to keep this
 * module pure.
 */
export function daysUntilDeadline(taxYear: number, extensionFiled: boolean, asOf: string): number {
  const deadline = Date.parse(`${effectiveDeadline(taxYear, extensionFiled)}T00:00:00Z`);
  const from = Date.parse(`${asOf}T00:00:00Z`);
  return Math.round((deadline - from) / 86_400_000);
}
