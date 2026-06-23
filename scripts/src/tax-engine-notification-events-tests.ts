/**
 * G-10 — Client notifications event spine (T5 GROWTH, 2026-06-22). Pure, no API.
 *
 * Hand-calc'd day counts (Date.parse on ISO dates) + urgency tiers + dedupe keys
 * + windowing + sort order.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-notification-events-tests.ts
 */
import {
  deriveNotificationEvents,
  type DeriveNotificationsInput,
} from "../../artifacts/api-server/src/lib/notificationEvents";

const PASS: string[] = [];
const FAIL: string[] = [];
function eq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── Test A — full mix, asOf 2026-03-01, clientId 7, TY2025 ──────────────────
// deadline 2026-03-05 → 4 days (urgent, included)
// Q1 voucher due 2026-04-15 → 45 days (== window 45 → included, upcoming)
// Q2 voucher due 2026-06-15 → 106 days (> window → excluded)
// 2 doc requests (undated; deadline 4 days away → urgency "urgent")
// Sort: urgents first by daysUntil (deadline 4) then undated by dedupeKey
//   ("...:1099:bank" < "...:w2:acme"), then the upcoming voucher last.
const a: DeriveNotificationsInput = {
  asOfDate: "2026-03-01",
  clientId: 7,
  taxYear: 2025,
  deadline: { date: "2026-03-05", kind: "filing_deadline" },
  vouchers: [
    { quarter: 1, dueDate: "2026-04-15", amount: 2500 },
    { quarter: 2, dueDate: "2026-06-15", amount: 2500 },
  ],
  docRequests: [
    { id: "w2:acme", title: "W-2 from Acme" },
    { id: "1099:bank", title: "1099-INT from Bank" },
  ],
};
const ea = deriveNotificationEvents(a);
eq("A count", ea.length, 4);
eq("A[0] kind", ea[0].kind, "filing_deadline");
eq("A[0] urgency", ea[0].urgency, "urgent");
eq("A[0] daysUntil", ea[0].daysUntil, 4);
eq("A[0] dedupeKey", ea[0].dedupeKey, "notify:7:filing_deadline:2025");
eq("A[1] kind", ea[1].kind, "doc_request");
eq("A[1] dedupeKey (1099 before w2)", ea[1].dedupeKey, "notify:7:doc_request:1099:bank");
eq("A[1] urgency (tracks deadline)", ea[1].urgency, "urgent");
eq("A[1] daysUntil null (undated)", ea[1].daysUntil, null);
eq("A[2] dedupeKey", ea[2].dedupeKey, "notify:7:doc_request:w2:acme");
eq("A[3] kind", ea[3].kind, "estimate_voucher");
eq("A[3] dedupeKey", ea[3].dedupeKey, "notify:7:estimate_voucher:2025:Q1");
eq("A[3] urgency", ea[3].urgency, "upcoming");
eq("A[3] daysUntil (45 == window)", ea[3].daysUntil, 45);
eq("A[3] amount", ea[3].amount, 2500);

// ── Test B — overdue deadline + paid voucher skipped ────────────────────────
// asOf 2026-04-20; deadline 2026-04-15 → -5 (overdue, included)
// Q1 paid → skipped; Q2 due 2026-06-15 → 56 days (> window → excluded)
const b: DeriveNotificationsInput = {
  asOfDate: "2026-04-20",
  clientId: 9,
  taxYear: 2025,
  deadline: { date: "2026-04-15", kind: "filing_deadline" },
  vouchers: [
    { quarter: 1, dueDate: "2026-04-15", amount: 1000, paid: true },
    { quarter: 2, dueDate: "2026-06-15", amount: 1000 },
  ],
};
const eb = deriveNotificationEvents(b);
eq("B count (only overdue deadline)", eb.length, 1);
eq("B[0] urgency", eb[0].urgency, "overdue");
eq("B[0] daysUntil", eb[0].daysUntil, -5);
eq("B[0] kind", eb[0].kind, "filing_deadline");

// ── Test C — deadline beyond window, nothing else → empty ───────────────────
// asOf 2026-01-01; deadline 2026-04-15 → 104 days (> window → excluded)
const c: DeriveNotificationsInput = {
  asOfDate: "2026-01-01",
  clientId: 1,
  taxYear: 2025,
  deadline: { date: "2026-04-15", kind: "filing_deadline" },
};
eq("C empty (far deadline suppressed)", deriveNotificationEvents(c).length, 0);

// ── Test D — extension deadline + custom window 60; sort by daysUntil ────────
// asOf 2026-09-01, window 60.
// extension deadline 2026-10-15 → 44 days (upcoming)
// Q3 voucher 2026-09-15 → 14 days (upcoming) → sorts BEFORE the deadline.
const d: DeriveNotificationsInput = {
  asOfDate: "2026-09-01",
  clientId: 3,
  taxYear: 2025,
  reminderWindowDays: 60,
  deadline: { date: "2026-10-15", kind: "extension_deadline" },
  vouchers: [{ quarter: 3, dueDate: "2026-09-15", amount: 3000 }],
};
const ed = deriveNotificationEvents(d);
eq("D count", ed.length, 2);
eq("D[0] kind (voucher sooner)", ed[0].kind, "estimate_voucher");
eq("D[0] daysUntil", ed[0].daysUntil, 14);
eq("D[0] amount", ed[0].amount, 3000);
eq("D[1] kind", ed[1].kind, "extension_deadline");
eq("D[1] daysUntil", ed[1].daysUntil, 44);
eq("D[1] dedupeKey", ed[1].dedupeKey, "notify:3:extension_deadline:2025");
eq("D[1] urgency", ed[1].urgency, "upcoming");

// ── Test E — doc request with deadline beyond window → urgency "scheduled" ───
// deadline 104 days (excluded as event) but its distance drives doc urgency.
const e: DeriveNotificationsInput = {
  asOfDate: "2026-01-01",
  clientId: 5,
  taxYear: 2025,
  deadline: { date: "2026-04-15", kind: "filing_deadline" },
  docRequests: [{ id: "k1:abc", title: "K-1 ABC LLC" }],
};
const ee = deriveNotificationEvents(e);
eq("E count (doc only)", ee.length, 1);
eq("E[0] kind", ee[0].kind, "doc_request");
eq("E[0] urgency scheduled (deadline beyond window)", ee[0].urgency, "scheduled");
eq("E[0] dedupeKey", ee[0].dedupeKey, "notify:5:doc_request:k1:abc");

// ── Test F — no deadline at all → doc urgency "scheduled" ────────────────────
const f: DeriveNotificationsInput = {
  asOfDate: "2026-01-01",
  clientId: 8,
  taxYear: 2025,
  docRequests: [{ id: "w2:x", title: "W-2 X" }],
};
const ef = deriveNotificationEvents(f);
eq("F count", ef.length, 1);
eq("F[0] urgency scheduled (no deadline)", ef[0].urgency, "scheduled");

console.log(`\nNotification events (G-10) tests:`);
console.log(`  Passed: ${PASS.length}`);
console.log(`  Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((ff) => console.log(`    ${ff}`));
}
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
