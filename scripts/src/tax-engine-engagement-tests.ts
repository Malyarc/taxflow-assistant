/**
 * T2.2 D2 — Engagement status + filing-deadline tests.
 *
 * Pure (no API). Deadline dates HAND-VERIFIED against the calendar:
 *   2025-04-15 Tue · 2025-10-15 Wed · 2026-04-15 Wed · 2026-10-15 Thu ·
 *   2028-04-15 SAT → Mon 04-17 · 2028-10-15 SUN → Mon 10-16 ·
 *   2023-04-15 SAT → Mon 04-17 (the real-world 2023 deadline was Apr 18 via
 *   DC Emancipation Day — holiday shifts are documented as NOT modeled; the
 *   computed date is never later than the true one).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-engagement-tests.ts
 */

import {
  ENGAGEMENT_STATUSES,
  isEngagementStatus,
  filingDeadlinesFor,
  effectiveDeadline,
  daysUntilDeadline,
} from "../../artifacts/api-server/src/lib/engagement";

const PASS: string[] = [];
const FAIL: string[] = [];
function checkStr(label: string, actual: string, expected: string): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected "${expected}", got "${actual}"`);
}
function check(label: string, actual: number, expected: number): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

// ── Weekday deadlines pass through unchanged ────────────────────────────────
checkStr("TY2024 filing = 2025-04-15 (Tue)", filingDeadlinesFor(2024).filingDeadline, "2025-04-15");
checkStr("TY2024 extended = 2025-10-15 (Wed)", filingDeadlinesFor(2024).extendedDeadline, "2025-10-15");
checkStr("TY2025 filing = 2026-04-15 (Wed)", filingDeadlinesFor(2025).filingDeadline, "2026-04-15");
checkStr("TY2025 extended = 2026-10-15 (Thu)", filingDeadlinesFor(2025).extendedDeadline, "2026-10-15");

// ── §7503 weekend rolls ─────────────────────────────────────────────────────
checkStr("TY2027 filing: Sat 2028-04-15 → Mon 2028-04-17", filingDeadlinesFor(2027).filingDeadline, "2028-04-17");
checkStr("TY2027 extended: Sun 2028-10-15 → Mon 2028-10-16", filingDeadlinesFor(2027).extendedDeadline, "2028-10-16");
checkStr("TY2022 filing: Sat 2023-04-15 → Mon 2023-04-17 (holiday shift not modeled)",
  filingDeadlinesFor(2022).filingDeadline, "2023-04-17");
// Sunday April 15 case: 2029-04-15 is a Sunday → Monday 04-16.
checkStr("TY2028 filing: Sun 2029-04-15 → Mon 2029-04-16", filingDeadlinesFor(2028).filingDeadline, "2029-04-16");

// ── Effective deadline keyed by the extension flag ──────────────────────────
checkStr("TY2025 effective (no extension)", effectiveDeadline(2025, false), "2026-04-15");
checkStr("TY2025 effective (extended)", effectiveDeadline(2025, true), "2026-10-15");

// ── daysUntilDeadline (whole days; negative = past due) ─────────────────────
check("5 days before the TY2025 deadline", daysUntilDeadline(2025, false, "2026-04-10"), 5);
check("deadline day = 0", daysUntilDeadline(2025, false, "2026-04-15"), 0);
check("5 days past due = −5", daysUntilDeadline(2025, false, "2026-04-20"), -5);
// Jun 10 → Oct 15 = 20 (Jun) + 31 (Jul) + 31 (Aug) + 30 (Sep) + 15 (Oct) = 127.
check("extended: 2026-06-10 → 2026-10-15 = 127 days", daysUntilDeadline(2025, true, "2026-06-10"), 127);

// ── Status enum ─────────────────────────────────────────────────────────────
check("6 statuses", ENGAGEMENT_STATUSES.length, 6);
checkTrue("not_started valid", isEngagementStatus("not_started"));
checkTrue("filed valid", isEngagementStatus("filed"));
checkTrue("ready_to_file valid", isEngagementStatus("ready_to_file"));
checkTrue("bogus invalid", !isEngagementStatus("bogus"));
checkTrue("null invalid", !isEngagementStatus(null));
checkTrue("number invalid", !isEngagementStatus(3));

console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
