/**
 * T1.3 — Deadline-aware planning calendar — classifier + calendar builder.
 *
 * Pure; no API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-planning-calendar-tests.ts
 *
 * Buckets: year_end (Dec 31, Y) / quarterly (Jan 15, Y+1) / filing_deadline
 * (Apr 15, Y+1) / extended_due_date (Oct 15, Y+1) / ongoing (structural).
 */
import {
  strategyDeadline,
  buildPlanningCalendar,
  annotateDeadlines,
} from "../../artifacts/api-server/src/lib/planningCalendar";
import type { OpportunityHit, StrategyCategory } from "@workspace/planning-strategies";

const PASS: string[] = [];
const FAIL: string[] = [];
function eq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── PART 1 — strategyDeadline classification (TY2024) ───────────────────────

// SEP-IRA → extended due date (Oct 15, 2025).
{
  const d = strategyDeadline("G1.1", "retirement", 2024);
  eq("G1.1 SEP type", d.type, "extended_due_date");
  eq("G1.1 SEP iso", d.isoDate, "2025-10-15");
  eq("G1.1 SEP days", d.daysFromYearEnd, 288);
}
// Roth conversion → year end (Dec 31, 2024).
{
  const d = strategyDeadline("G1.4", "timing", 2024);
  eq("G1.4 Roth type", d.type, "year_end");
  eq("G1.4 Roth iso", d.isoDate, "2024-12-31");
  eq("G1.4 Roth days", d.daysFromYearEnd, 0);
}
// HSA → filing deadline (Apr 15, 2025).
{
  const d = strategyDeadline("G1.14", "retirement", 2024);
  eq("G1.14 HSA type", d.type, "filing_deadline");
  eq("G1.14 HSA iso", d.isoDate, "2025-04-15");
  eq("G1.14 HSA days", d.daysFromYearEnd, 105);
}
// Estimated tax → quarterly (final voucher Jan 15, 2025).
{
  const d = strategyDeadline("G1.52", "timing", 2024);
  eq("G1.52 estimated type", d.type, "quarterly");
  eq("G1.52 estimated iso", d.isoDate, "2025-01-15");
  eq("G1.52 estimated days", d.daysFromYearEnd, 15);
}
// Category defaults (unknown id).
{
  eq("charitable default → year_end", strategyDeadline("Gx", "charitable", 2024).type, "year_end");
  eq("investment default → year_end", strategyDeadline("Gx", "investment", 2024).type, "year_end");
  eq("retirement default → filing", strategyDeadline("Gx", "retirement", 2024).type, "filing_deadline");
  eq("credits default → filing", strategyDeadline("Gx", "credits", 2024).type, "filing_deadline");
  eq("business default → ongoing", strategyDeadline("Gx", "business", 2024).type, "ongoing");
  eq("state default → ongoing", strategyDeadline("Gx", "state", 2024).type, "ongoing");
  eq("ongoing has null date", strategyDeadline("Gx", "business", 2024).isoDate, null);
}
// Tax year flows through.
{
  const d = strategyDeadline("G1.1", "retirement", 2025);
  eq("TY2025 SEP iso", d.isoDate, "2026-10-15");
}

// ── PART 2 — annotateDeadlines + buildPlanningCalendar ──────────────────────

function mkHit(strategyId: string, category: StrategyCategory, estSavings: number): OpportunityHit {
  return {
    strategyId, name: `Strat ${strategyId}`, category, estSavings,
    confidence: 0.9, cpaEffortHours: 1, recurring: true,
    rationale: "r", action: "a", prerequisiteData: [], citation: "c", inputs: {},
  };
}

{
  const hits = [
    mkHit("G1.4", "timing", 5000), // year_end
    mkHit("G1.1", "retirement", 3000), // extended
    mkHit("G1.14", "retirement", 2000), // filing
    mkHit("G1.9", "investment", 1000), // year_end
  ];
  annotateDeadlines(hits, 2024);
  eq("annotateDeadlines attaches deadline", hits[0].deadline?.type, "year_end");

  const cal = buildPlanningCalendar(hits, 2024);
  eq("calendar group count", cal.groups.length, 3);
  // Soonest-first: year_end, then filing_deadline, then extended_due_date.
  eq("group[0] year_end", cal.groups[0].deadlineType, "year_end");
  eq("group[1] filing_deadline", cal.groups[1].deadlineType, "filing_deadline");
  eq("group[2] extended_due_date", cal.groups[2].deadlineType, "extended_due_date");
  // year_end group: G1.4 ($5000) + G1.9 ($1000) = $6000, G1.4 sorted first.
  eq("year_end total savings", cal.groups[0].totalSavings, 6000);
  eq("year_end first strategy (highest savings)", cal.groups[0].strategies[0].strategyId, "G1.4");
  eq("filing total", cal.groups[1].totalSavings, 2000);
  eq("extended total", cal.groups[2].totalSavings, 3000);
  eq("calendar total savings", cal.totalSavings, 11000);
}

// verifiedSavings takes precedence over estSavings in the total + sort.
{
  const h = mkHit("G1.9", "investment", 1000);
  h.verifiedSavings = 8000;
  h.savingsSource = "engine-verified";
  const h2 = mkHit("G1.4", "timing", 5000);
  const cal = buildPlanningCalendar([h, h2], 2024);
  // Both year_end → one group; total uses verified (8000) + est (5000) = 13000.
  eq("verified-savings total", cal.groups[0].totalSavings, 13000);
  eq("verified-savings sorts first", cal.groups[0].strategies[0].strategyId, "G1.9");
}

console.log(`\nT1.3 — Deadline-aware planning calendar tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`    ${f}`));
process.exit(FAIL.length > 0 ? 1 : 0);
