// ───────────────────────────────────────────────────────────────────────────
// Deadline-aware planning calendar (T1.3)
//
// Classifies each detected planning opportunity by WHEN the CPA/client must act
// to capture it for a given tax year, then groups the firm's hits into an
// actionable, soonest-first timeline. Pure (no wall-clock reads — ordering uses
// a deterministic days-from-year-end key so the engine stays migration-portable).
//
// Deadline buckets (IRS):
//   • year_end (Dec 31)        — actions that must occur within the tax year:
//     Roth conversions, tax-loss harvesting, QCD, DAF/charitable gifts, Augusta
//     rule, 401(k)/403(b) EMPLOYEE deferrals, AMT-ISO timing, gifting, RMDs.
//   • filing_deadline (~Apr 15)— contributions allowed up to the unextended due
//     date: traditional/Roth IRA (incl. backdoor), HSA, spousal/custodial IRA.
//   • extended_due_date (~Oct 15) — SEP-IRA, Solo-401(k) EMPLOYER contribution,
//     defined-benefit/cash-balance funding (with an extension).
//   • quarterly                — estimated-tax safe-harbor (final voucher Jan 15).
//   • ongoing                  — structural moves with no single hard date
//     (entity choice, state residency, multi-year structural planning).
// ───────────────────────────────────────────────────────────────────────────

import type {
  OpportunityHit,
  StrategyCategory,
  StrategyDeadline,
  DeadlineType,
} from "@workspace/planning-strategies";

// Canonical per-strategy deadline overrides (where the id's deadline is more
// specific than its category default).
const DEADLINE_BY_ID: Record<string, DeadlineType> = {
  // Employer retirement plans — fundable through the EXTENDED due date.
  "G1.1": "extended_due_date", // SEP-IRA (§408(k))
  "G1.28": "extended_due_date", // Defined benefit / cash balance
  "G1.60": "extended_due_date", // §41(h) R&D payroll-tax election (filed with return)
  // Contributions allowed through the UNEXTENDED filing deadline.
  "G1.14": "filing_deadline", // HSA (§223)
  "G1.26": "filing_deadline", // Backdoor Roth IRA
  "G1.46": "filing_deadline", // Spousal IRA (§219(c))
  "G1.55": "filing_deadline", // Custodial Roth IRA
  "G1.66": "filing_deadline", // Rollover-IRA → 401(k) pro-rata fix (enables backdoor)
  // Must act within the tax year (Dec 31).
  "G1.3": "year_end", // Bunching
  "G1.4": "year_end", // Roth conversion
  "G1.5": "year_end", // AMT-ISO timing
  "G1.8": "year_end", // Donor-advised fund
  "G1.9": "year_end", // Tax-loss harvesting
  "G1.11": "year_end", // QCD
  "G1.12": "year_end", // Appreciated-stock gift
  "G1.13": "year_end", // Augusta rule
  "G1.92": "year_end", // Solo-401(k) EMPLOYEE deferral (the binding date)
  "G1.96": "year_end", // §132(f) transit (per-month elections within the year)
  // Estimated-tax safe harbor.
  "G1.52": "quarterly", // §6654 estimated-tax safe harbor
  // Estate — bespoke structures are structural (no hard Dec-31 deadline); the
  // gifting/529-superfund flags keep the "estate" category's year_end default.
  "G1.103": "ongoing", // SLAT
  "G1.104": "ongoing", // ILIT
  "G1.105": "ongoing", // GRAT
  "G1.106": "ongoing", // Step-up-in-basis hold (§1014)
};

const DEADLINE_BY_CATEGORY: Record<StrategyCategory, DeadlineType> = {
  retirement: "filing_deadline", // most contributions; SEP/DB id-overridden to extended
  charitable: "year_end",
  timing: "year_end",
  investment: "year_end",
  credits: "filing_deadline",
  business: "ongoing",
  state: "ongoing",
  estate: "year_end", // annual-exclusion gifting + 529 superfunding are Dec-31 deadlines
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function fmt(year: number, month1: number, day: number): string {
  return `${MONTHS[month1 - 1]} ${day}, ${year}`;
}
function iso(year: number, month1: number, day: number): string {
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// §7503: a filing/payment deadline that lands on a Sat/Sun (or legal holiday)
// rolls to the next business day. Deterministic Date.UTC math only (no wall-clock
// read) so the module stays migration-portable. Mirrors engagement.ts
// `rollToBusinessDay` + the taxProjection.ts Jan-15/MLK rule (replicated inline to
// avoid coupling this pure module to a CPA-tools module). Federal holidays other
// than MLK (e.g. DC Emancipation Day) are NOT modeled — same documented
// conservatism (the computed date is never LATER than the true §7503 deadline).
// (audit 2026-06-23 F2 — year_end Dec-31 deadlines stay UNrolled: "within the tax
// year" actions, not a §7503 filing/payment date.)
function rollWeekend(utcMs: number): number {
  const dow = new Date(utcMs).getUTCDay();
  if (dow === 6) return utcMs + 2 * 86_400_000; // Saturday → Monday
  if (dow === 0) return utcMs + 1 * 86_400_000; // Sunday → Monday
  return utcMs;
}
function rolledDeadline(type: DeadlineType, taxYear: number, utcMs: number, suffix: string): StrategyDeadline {
  const d = new Date(utcMs);
  return {
    type,
    isoDate: d.toISOString().slice(0, 10),
    label: `${fmt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())}${suffix}`,
    daysFromYearEnd: Math.round((utcMs - Date.UTC(taxYear, 11, 31)) / 86_400_000),
  };
}

/** Classify a strategy's actionable deadline for a tax year. */
export function strategyDeadline(
  strategyId: string,
  category: StrategyCategory,
  taxYear: number,
): StrategyDeadline {
  const type = DEADLINE_BY_ID[strategyId] ?? DEADLINE_BY_CATEGORY[category] ?? "ongoing";
  switch (type) {
    case "year_end":
      return { type, isoDate: iso(taxYear, 12, 31), label: fmt(taxYear, 12, 31), daysFromYearEnd: 0 };
    case "quarterly": {
      // Final estimated voucher: Jan 15 of the following year + the §7503 weekend
      // roll, then the deterministic MLK collision (the rolled/landed Monday is the
      // 3rd Monday of January = MLK day → +1). See taxProjection.voucherDueDates.
      const jan15 = Date.UTC(taxYear + 1, 0, 15);
      const dow = new Date(jan15).getUTCDay();
      let ms = rollWeekend(jan15);
      if (dow === 6 || dow === 0 || dow === 1) ms += 86_400_000;
      return rolledDeadline(type, taxYear, ms, " (final estimated payment)");
    }
    case "filing_deadline":
      return rolledDeadline(type, taxYear, rollWeekend(Date.UTC(taxYear + 1, 3, 15)), " (filing deadline)");
    case "extended_due_date":
      return rolledDeadline(type, taxYear, rollWeekend(Date.UTC(taxYear + 1, 9, 15)), " (extended due date)");
    default:
      return { type: "ongoing", isoDate: null, label: "No fixed deadline (structural)", daysFromYearEnd: 9999 };
  }
}

/** Attach a `deadline` to each hit, in place. */
export function annotateDeadlines(hits: OpportunityHit[], taxYear: number): void {
  for (const h of hits) {
    h.deadline = strategyDeadline(h.strategyId, h.category, taxYear);
  }
}

export interface PlanningCalendarStrategy {
  strategyId: string;
  name: string;
  estSavings: number;
  savingsSource?: "engine-verified" | "estimate";
  verifiedSavings?: number;
}

export interface PlanningCalendarGroup {
  deadlineType: DeadlineType;
  isoDate: string | null;
  label: string;
  daysFromYearEnd: number;
  /** Total estimated savings across the group's strategies. */
  totalSavings: number;
  strategies: PlanningCalendarStrategy[];
}

export interface PlanningCalendar {
  taxYear: number;
  /** Deadline groups, soonest-first. */
  groups: PlanningCalendarGroup[];
  totalSavings: number;
}

const DEADLINE_ORDER: DeadlineType[] = [
  "year_end",
  "quarterly",
  "filing_deadline",
  "extended_due_date",
  "ongoing",
];

/** Group detected hits into a soonest-first deadline calendar for a tax year. */
export function buildPlanningCalendar(hits: OpportunityHit[], taxYear: number): PlanningCalendar {
  const byType = new Map<DeadlineType, PlanningCalendarGroup>();
  for (const h of hits) {
    const d = h.deadline ?? strategyDeadline(h.strategyId, h.category, taxYear);
    let g = byType.get(d.type);
    if (!g) {
      g = { deadlineType: d.type, isoDate: d.isoDate, label: d.label, daysFromYearEnd: d.daysFromYearEnd, totalSavings: 0, strategies: [] };
      byType.set(d.type, g);
    }
    const headline = h.verifiedSavings ?? h.estSavings;
    g.strategies.push({
      strategyId: h.strategyId,
      name: h.name,
      estSavings: h.estSavings,
      savingsSource: h.savingsSource,
      verifiedSavings: h.verifiedSavings,
    });
    g.totalSavings += Math.max(0, headline);
  }
  // Sort soonest-first. An unknown deadline type (caller-supplied / future enum
  // value) sorts LAST, not first (indexOf -1 would otherwise jump it to the top).
  const orderOf = (t: DeadlineType): number => {
    const i = DEADLINE_ORDER.indexOf(t);
    return i < 0 ? DEADLINE_ORDER.length : i;
  };
  const groups = [...byType.values()].sort((a, b) => orderOf(a.deadlineType) - orderOf(b.deadlineType));
  for (const g of groups) {
    g.strategies.sort((a, b) => (b.verifiedSavings ?? b.estSavings) - (a.verifiedSavings ?? a.estSavings));
  }
  return { taxYear, groups, totalSavings: groups.reduce((s, g) => s + g.totalSavings, 0) };
}
