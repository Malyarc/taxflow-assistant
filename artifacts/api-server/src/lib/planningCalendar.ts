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
};

const DEADLINE_BY_CATEGORY: Record<StrategyCategory, DeadlineType> = {
  retirement: "filing_deadline", // most contributions; SEP/DB id-overridden to extended
  charitable: "year_end",
  timing: "year_end",
  investment: "year_end",
  credits: "filing_deadline",
  business: "ongoing",
  state: "ongoing",
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
    case "quarterly":
      return {
        type,
        isoDate: iso(taxYear + 1, 1, 15),
        label: `${fmt(taxYear + 1, 1, 15)} (final estimated payment)`,
        daysFromYearEnd: 15,
      };
    case "filing_deadline":
      return {
        type,
        isoDate: iso(taxYear + 1, 4, 15),
        label: `${fmt(taxYear + 1, 4, 15)} (filing deadline)`,
        daysFromYearEnd: 105,
      };
    case "extended_due_date":
      return {
        type,
        isoDate: iso(taxYear + 1, 10, 15),
        label: `${fmt(taxYear + 1, 10, 15)} (extended due date)`,
        daysFromYearEnd: 288,
      };
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
  const groups = [...byType.values()].sort(
    (a, b) => DEADLINE_ORDER.indexOf(a.deadlineType) - DEADLINE_ORDER.indexOf(b.deadlineType),
  );
  for (const g of groups) {
    g.strategies.sort((a, b) => (b.verifiedSavings ?? b.estSavings) - (a.verifiedSavings ?? a.estSavings));
  }
  return { taxYear, groups, totalSavings: groups.reduce((s, g) => s + g.totalSavings, 0) };
}
