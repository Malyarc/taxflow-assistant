/**
 * G-10 — Client notifications event spine (T5 GROWTH, 2026-06-22).
 *
 * The DELIVERY layer (push / SMS / email + the portal UI) is Haven's last mile.
 * What lives HERE is the deterministic SPINE: given a client's deadlines,
 * estimated-tax vouchers, and outstanding document requests, derive the set of
 * notification events that are currently due — each with a STABLE dedupe key (so
 * the dispatch layer sends a given reminder at most once), an urgency tier, and
 * the timing. Haven (or any dispatcher) consumes this and decides channels.
 *
 * PURE + Haven-portable: NO `new Date()` (argless) / Date.now() / Math.random()
 * / DB / network. Date math is on caller-supplied ISO strings via Date.parse
 * (deterministic), matching engagement.ts / taxProjection.ts.
 */

export type NotificationKind =
  | "filing_deadline"
  | "extension_deadline"
  | "estimate_voucher"
  | "doc_request";

/** overdue > urgent > upcoming > scheduled. */
export type NotificationUrgency = "overdue" | "urgent" | "upcoming" | "scheduled";

export interface NotificationEvent {
  kind: NotificationKind;
  /** Stable idempotency key — the dispatch layer sends each key at most once. */
  dedupeKey: string;
  title: string;
  body: string;
  /** ISO date the event is anchored to, or null for an undated doc request. */
  dueDate: string | null;
  /** Whole days from asOfDate to dueDate (negative = past); null when undated. */
  daysUntil: number | null;
  urgency: NotificationUrgency;
  /** Dollar amount when applicable (a voucher), else null. */
  amount: number | null;
}

export interface DeriveNotificationsInput {
  /** ISO date (YYYY-MM-DD) the dispatcher is running as-of. */
  asOfDate: string;
  clientId: number;
  taxYear: number;
  /** The active filing/extension deadline, if any. */
  deadline?: { date: string; kind: "filing_deadline" | "extension_deadline" } | null;
  /** Estimated-tax vouchers (paid ones are skipped). */
  vouchers?: ReadonlyArray<{ quarter: number; dueDate: string; amount: number; paid?: boolean }>;
  /** Outstanding (missing) document requests — already filtered to "not received". */
  docRequests?: ReadonlyArray<{ id: string; title: string }>;
  /** Only surface dated events within this many days of asOfDate (default 45). */
  reminderWindowDays?: number;
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to` (both ISO YYYY-MM-DD). Negative = `to` is past. */
function isoDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

function urgencyForDays(days: number, windowDays: number): NotificationUrgency {
  if (days < 0) return "overdue";
  if (days <= 7) return "urgent";
  if (days <= windowDays) return "upcoming";
  return "scheduled";
}

const URGENCY_RANK: Record<NotificationUrgency, number> = {
  overdue: 3,
  urgent: 2,
  upcoming: 1,
  scheduled: 0,
};

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function deriveNotificationEvents(input: DeriveNotificationsInput): NotificationEvent[] {
  const { asOfDate, clientId, taxYear } = input;
  const windowDays = Number.isFinite(input.reminderWindowDays) ? (input.reminderWindowDays as number) : 45;
  const events: NotificationEvent[] = [];

  // ── Filing / extension deadline ───────────────────────────────────────────
  // Surface when within the window OR already overdue (never months early).
  const deadlineDays = input.deadline ? isoDaysBetween(asOfDate, input.deadline.date) : null;
  if (input.deadline && deadlineDays != null && deadlineDays <= windowDays) {
    const isExt = input.deadline.kind === "extension_deadline";
    events.push({
      kind: input.deadline.kind,
      dedupeKey: `notify:${clientId}:${input.deadline.kind}:${taxYear}`,
      title: isExt ? `Extended filing deadline ${input.deadline.date}` : `Tax filing deadline ${input.deadline.date}`,
      body:
        deadlineDays < 0
          ? `The ${isExt ? "extended " : ""}filing deadline (${input.deadline.date}) has passed.`
          : `The ${isExt ? "extended " : ""}filing deadline is ${input.deadline.date} (${deadlineDays} day${deadlineDays === 1 ? "" : "s"} away).`,
      dueDate: input.deadline.date,
      daysUntil: deadlineDays,
      urgency: urgencyForDays(deadlineDays, windowDays),
      amount: null,
    });
  }

  // ── Estimated-tax vouchers (unpaid, within window or overdue) ──────────────
  for (const v of input.vouchers ?? []) {
    if (v.paid) continue;
    const days = isoDaysBetween(asOfDate, v.dueDate);
    if (days > windowDays) continue;
    events.push({
      kind: "estimate_voucher",
      dedupeKey: `notify:${clientId}:estimate_voucher:${taxYear}:Q${v.quarter}`,
      title: `Q${v.quarter} estimated payment ${money(v.amount)}`,
      body:
        days < 0
          ? `The Q${v.quarter} ${taxYear} estimated payment of ${money(v.amount)} (due ${v.dueDate}) is past due.`
          : `Q${v.quarter} ${taxYear} estimated payment of ${money(v.amount)} is due ${v.dueDate} (${days} day${days === 1 ? "" : "s"} away).`,
      dueDate: v.dueDate,
      daysUntil: days,
      urgency: urgencyForDays(days, windowDays),
      amount: v.amount,
    });
  }

  // ── Outstanding document requests (undated; urgency tracks the deadline) ───
  // A document request isn't itself "overdue"; its pressure rises as the filing
  // deadline nears, so map a past deadline to "urgent" (not "overdue").
  const docUrgency: NotificationUrgency =
    deadlineDays == null
      ? "scheduled"
      : deadlineDays < 0
        ? "urgent"
        : urgencyForDays(deadlineDays, windowDays);
  for (const d of input.docRequests ?? []) {
    events.push({
      kind: "doc_request",
      dedupeKey: `notify:${clientId}:doc_request:${d.id}`,
      title: `Document needed: ${d.title}`,
      body: `We still need "${d.title}" to complete this return.`,
      dueDate: null,
      daysUntil: null,
      urgency: docUrgency,
      amount: null,
    });
  }

  // Most urgent first; then soonest due (undated last); then dedupeKey (stable).
  events.sort(
    (a, b) =>
      URGENCY_RANK[b.urgency] - URGENCY_RANK[a.urgency] ||
      (a.daysUntil ?? Number.POSITIVE_INFINITY) - (b.daysUntil ?? Number.POSITIVE_INFINITY) ||
      a.dedupeKey.localeCompare(b.dedupeKey),
  );
  return events;
}
