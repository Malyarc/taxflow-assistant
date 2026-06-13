/**
 * G-1 IRS Account Monitor — no-API unit tests.
 *
 * Hand-calc'd assertions for:
 *   • detectTranscriptChanges — no-change, balance increase (size→severity),
 *     balance decrease, a new CP2000, an audit/exam TC (420/424/922), other
 *     new TCs, and the null-prior baseline behavior + severity sort.
 *   • draftNoticeResponse — grounded CP2000 dispute (cites our reported figures
 *     vs the IRS proposed amount), CP14 balance-due, CP504 levy, disclaimers.
 *
 * Pure module — no API / DB / Date needed.
 */
import {
  detectTranscriptChanges,
  draftNoticeResponse,
  type TranscriptSnapshot,
  type MonitorAlert,
} from "../../artifacts/api-server/src/lib/irsAccountMonitor";
import { type ComputedTaxReturn } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  cond ? PASS.push(`✓ ${label}`) : FAIL.push(`✗ ${label}`);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function snap(over: Partial<TranscriptSnapshot> = {}): TranscriptSnapshot {
  return {
    taxYear: 2024,
    asOfDate: "2026-06-13",
    accountBalance: 0,
    lineItems: [
      { transactionCode: "150", description: "Return filed and tax assessed", date: "2025-04-15", amount: 18000 },
      { transactionCode: "806", description: "W-2/1099 withholding credit", date: "2025-04-15", amount: -20000 },
    ],
    notices: [],
    ...over,
  };
}

function only<K extends MonitorAlert["kind"]>(alerts: MonitorAlert[], kind: K): MonitorAlert[] {
  return alerts.filter((a) => a.kind === kind);
}

/** A minimal grounded ComputedTaxReturn fixture — only the fields the monitor
 *  module reads. Cast through unknown so CI typecheck:tests stays clean without
 *  enumerating the full ~80-field engine output. Hand values:
 *    totalIncome 250,000 ; interest 4,000 ; ord div 6,000 ; total tax 42,000 ;
 *    withheld 38,000 ; refundOrOwed -4,000 (i.e. $4,000 owed). */
function computedFixture(): ComputedTaxReturn {
  return {
    taxYear: 2024,
    totalIncome: 250000,
    adjustedGrossIncome: 248000,
    federalTaxLiability: 42000,
    federalTaxWithheld: 38000,
    federalRefundOrOwed: -4000,
    form1099Summary: {
      interestIncome: 4000,
      ordinaryDividends: 6000,
      qualifiedDividends: 5000,
    },
  } as unknown as ComputedTaxReturn;
}

// ═══════════════════════════════════════════════════════════════════════════
// A. detectTranscriptChanges — NO CHANGE
// ═══════════════════════════════════════════════════════════════════════════
{
  const prior = snap({ accountBalance: -2000 });
  const current = snap({ accountBalance: -2000, asOfDate: "2026-06-13" });
  const alerts = detectTranscriptChanges({ prior, current });
  check("no-change → 0 alerts", alerts.length, 0);
}

// Sub-$1 balance jitter is below threshold → still no alert.
{
  const prior = snap({ accountBalance: 1000 });
  const current = snap({ accountBalance: 1000.4 });
  const alerts = detectTranscriptChanges({ prior, current });
  check("sub-$1 jitter → 0 alerts", alerts.length, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// B. detectTranscriptChanges — BALANCE CHANGE (size → severity)
// ═══════════════════════════════════════════════════════════════════════════
{
  // small increase $500 → info
  const prior = snap({ accountBalance: 0 });
  const current = snap({ accountBalance: 500 });
  const alerts = detectTranscriptChanges({ prior, current });
  const bc = only(alerts, "balance_change");
  check("small +$500 → 1 balance alert", bc.length, 1);
  check("small +$500 delta amount", bc[0].amount ?? 0, 500);
  checkTrue("small +$500 → info severity", bc[0].severity === "info");
}
{
  // moderate increase $3,000 → action
  const prior = snap({ accountBalance: 1000 });
  const current = snap({ accountBalance: 4000 });
  const alerts = detectTranscriptChanges({ prior, current });
  const bc = only(alerts, "balance_change")[0];
  check("moderate +$3,000 delta", bc.amount ?? 0, 3000);
  checkTrue("moderate +$3,000 → action severity", bc.severity === "action");
}
{
  // large increase $15,000 → urgent
  const prior = snap({ accountBalance: 0 });
  const current = snap({ accountBalance: 15000 });
  const alerts = detectTranscriptChanges({ prior, current });
  const bc = only(alerts, "balance_change")[0];
  check("large +$15,000 delta", bc.amount ?? 0, 15000);
  checkTrue("large +$15,000 → urgent severity", bc.severity === "urgent");
}
{
  // a payment posts: balance decreases $20,000 → info (favorable)
  const prior = snap({ accountBalance: 20000 });
  const current = snap({ accountBalance: 0 });
  const alerts = detectTranscriptChanges({ prior, current });
  const bc = only(alerts, "balance_change")[0];
  check("payment −$20,000 delta (signed)", bc.amount ?? 0, -20000);
  checkTrue("payment decrease → info severity", bc.severity === "info");
  checkTrue("payment decrease title says decreased", /decreased/i.test(bc.title));
}

// ═══════════════════════════════════════════════════════════════════════════
// C. detectTranscriptChanges — NEW CP2000
// ═══════════════════════════════════════════════════════════════════════════
{
  const prior = snap({ accountBalance: 0 });
  const current = snap({
    accountBalance: 0,
    notices: [
      {
        code: "CP2000",
        date: "2026-05-01",
        description: "Proposed change from unreported 1099-INT.",
        proposedAmount: 1320,
      },
    ],
  });
  const alerts = detectTranscriptChanges({ prior, current });
  const nn = only(alerts, "new_notice");
  check("CP2000 → 1 new_notice alert", nn.length, 1);
  checkTrue("CP2000 → action severity", nn[0].severity === "action");
  check("CP2000 proposed amount surfaced", nn[0].amount ?? 0, 1320);
  checkTrue("CP2000 noticeCode set", nn[0].noticeCode === "CP2000");
  checkTrue("CP2000 action mentions §6213", /§6213|6213/.test(nn[0].recommendedAction));
}
{
  // CP504 levy → urgent; CP14 → action; verify per-code mapping + sort
  const prior = snap();
  const current = snap({
    notices: [
      { code: "CP14", date: "2026-04-01", description: "Balance due." },
      { code: "CP504", date: "2026-05-01", description: "Notice of intent to levy." },
    ],
  });
  const alerts = detectTranscriptChanges({ prior, current });
  const nn = only(alerts, "new_notice");
  check("two notices → 2 alerts", nn.length, 2);
  const cp504 = nn.find((a) => a.noticeCode === "CP504")!;
  const cp14 = nn.find((a) => a.noticeCode === "CP14")!;
  checkTrue("CP504 → urgent", cp504.severity === "urgent");
  checkTrue("CP14 → action", cp14.severity === "action");
  // urgent must sort ahead of action
  checkTrue("urgent CP504 sorts before action CP14", alerts.indexOf(cp504) < alerts.indexOf(cp14));
}
{
  // An already-seen notice (same code + date) does NOT re-alert.
  const noticeArr = [{ code: "CP2000", date: "2026-05-01", description: "AUR proposal." }];
  const prior = snap({ notices: noticeArr });
  const current = snap({ notices: noticeArr });
  const alerts = detectTranscriptChanges({ prior, current });
  check("repeated identical notice → 0 alerts", alerts.length, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// D. detectTranscriptChanges — EXAM / AUR Transaction Codes
// ═══════════════════════════════════════════════════════════════════════════
{
  // TC 420 examination opened → urgent exam_flag
  const prior = snap();
  const current = snap({
    lineItems: [
      ...snap().lineItems,
      { transactionCode: "420", description: "Examination of return", date: "2026-05-20", amount: 0 },
    ],
  });
  const alerts = detectTranscriptChanges({ prior, current });
  const ex = only(alerts, "exam_flag");
  check("TC 420 → 1 exam_flag", ex.length, 1);
  checkTrue("TC 420 → urgent", ex[0].severity === "urgent");
  checkTrue("TC 420 action mentions Form 2848", /2848/.test(ex[0].recommendedAction));
}
{
  // TC 922 AUR underreporter review → action exam_flag
  const prior = snap();
  const current = snap({
    lineItems: [
      ...snap().lineItems,
      { transactionCode: "922", description: "Review of unreported income", date: "2026-05-22", amount: 0 },
    ],
  });
  const alerts = detectTranscriptChanges({ prior, current });
  const ex = only(alerts, "exam_flag")[0];
  checkTrue("TC 922 → exam_flag kind", ex.kind === "exam_flag");
  checkTrue("TC 922 → action severity (pre-CP2000)", ex.severity === "action");
}
{
  // TC 424 examination requested → urgent
  const prior = snap();
  const current = snap({
    lineItems: [
      ...snap().lineItems,
      { transactionCode: "424", description: "Examination request", date: "2026-05-25", amount: 0 },
    ],
  });
  const alerts = detectTranscriptChanges({ prior, current });
  checkTrue("TC 424 → urgent exam_flag", only(alerts, "exam_flag")[0].severity === "urgent");
}

// ═══════════════════════════════════════════════════════════════════════════
// E. detectTranscriptChanges — other NEW transaction (info) + combined sort
// ═══════════════════════════════════════════════════════════════════════════
{
  // TC 290 additional tax assessed $1,500 (not exam/notice) → info new_transaction
  const prior = snap({ accountBalance: 0 });
  const current = snap({
    accountBalance: 1500,
    lineItems: [
      ...snap().lineItems,
      { transactionCode: "290", description: "Additional tax assessed", date: "2026-05-10", amount: 1500 },
    ],
  });
  const alerts = detectTranscriptChanges({ prior, current });
  const nt = only(alerts, "new_transaction");
  check("TC 290 → 1 new_transaction", nt.length, 1);
  checkTrue("TC 290 → info severity", nt[0].severity === "info");
  check("TC 290 amount surfaced", nt[0].amount ?? 0, 1500);
  // Also produced a balance_change (action, +$1,500) — sorts ahead of the info TC.
  const bc = only(alerts, "balance_change")[0];
  checkTrue("balance action sorts before info new_transaction", alerts.indexOf(bc) < alerts.indexOf(nt[0]));
}

// ═══════════════════════════════════════════════════════════════════════════
// F. detectTranscriptChanges — NULL PRIOR (initial baseline)
// ═══════════════════════════════════════════════════════════════════════════
{
  const current = snap({
    accountBalance: 5000, // opening balance is NOT alerted (it's the baseline)
    notices: [{ code: "CP2000", date: "2026-05-01", description: "AUR proposal.", proposedAmount: 900 }],
    lineItems: [
      { transactionCode: "150", description: "Return filed", date: "2025-04-15", amount: 42000 },
      { transactionCode: "420", description: "Examination of return", date: "2026-05-20", amount: 0 },
      { transactionCode: "806", description: "Withholding", date: "2025-04-15", amount: -38000 },
    ],
  });
  const alerts = detectTranscriptChanges({ prior: null, current });
  // Baseline surfaces ONLY the notice + exam flag (not the balance, not the
  // ordinary 150/806 line items).
  check("null prior → no balance_change", only(alerts, "balance_change").length, 0);
  check("null prior → no info new_transaction", only(alerts, "new_transaction").length, 0);
  check("null prior → CP2000 surfaced", only(alerts, "new_notice").length, 1);
  check("null prior → exam flag surfaced", only(alerts, "exam_flag").length, 1);
  check("null prior → exactly 2 baseline alerts", alerts.length, 2);
  checkTrue("null prior notice marked baseline", /baseline/i.test(only(alerts, "new_notice")[0].title));
  // exam (urgent) sorts before notice (action)
  checkTrue(
    "baseline urgent exam sorts before action notice",
    alerts.indexOf(only(alerts, "exam_flag")[0]) < alerts.indexOf(only(alerts, "new_notice")[0]),
  );
}
{
  // null prior + totally clean transcript → 0 alerts
  const alerts = detectTranscriptChanges({ prior: null, current: snap({ accountBalance: 0 }) });
  check("null prior + clean → 0 alerts", alerts.length, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// G. draftNoticeResponse — CP2000 grounded dispute
// ═══════════════════════════════════════════════════════════════════════════
{
  const draft = draftNoticeResponse({
    notice: {
      code: "CP2000",
      date: "2026-05-01",
      description: "Proposed additional tax from an unreported 1099-INT.",
      proposedAmount: 1320,
    },
    computed: computedFixture(),
    clientFirstName: "Dana",
    clientLastName: "Reyes",
    preparerName: "J. Tang, CPA",
    asOfDate: "2026-06-13",
  });
  checkTrue("CP2000 draft noticeCode", draft.noticeCode === "CP2000");
  checkTrue("CP2000 subject names client + year", /Dana Reyes/.test(draft.subject) && /2024/.test(draft.subject));
  // grounding: our reported interest 4,000 must appear paired with IRS proposed 1,320
  const interestFact = draft.groundingFacts.find((f) => /interest/i.test(f.label))!;
  check("CP2000 grounds our reported interest", interestFact.ourValue, 4000);
  checkTrue("CP2000 our-reported-interest IRS side is null", interestFact.irsValue === null);
  const proposedFact = draft.groundingFacts.find((f) => f.irsValue === 1320)!;
  check("CP2000 IRS proposed amount in grounding", proposedFact.irsValue ?? 0, 1320);
  check("CP2000 grounds total income reported", draft.groundingFacts.find((f) => /total income/i.test(f.label))!.ourValue, 250000);
  checkTrue("CP2000 body disputes (DISAGREE)", /DISAGREE/i.test(draft.bodyTemplate));
  checkTrue("CP2000 body cites §6213 (proposal not assessment)", /6213/.test(draft.bodyTemplate));
  checkTrue("CP2000 body renders the $4,000.00 interest figure", /4,000\.00/.test(draft.bodyTemplate));
  checkTrue("CP2000 body marked DRAFT", /DRAFT/.test(draft.bodyTemplate));
  checkTrue("CP2000 body names preparer", /J\. Tang, CPA/.test(draft.bodyTemplate));
  // disclaimers: CPA review + draft + 8821 (no representation)
  check("draft has 3 disclaimers", draft.disclaimers.length, 3);
  checkTrue("disclaimer: CPA review required", draft.disclaimers.some((d) => /CPA/i.test(d) && /review/i.test(d)));
  checkTrue("disclaimer: 8821 not representation", draft.disclaimers.some((d) => /8821/.test(d) && /2848/.test(d)));
}

// ═══════════════════════════════════════════════════════════════════════════
// H. draftNoticeResponse — CP14 balance-due + CP504 levy + default name fallback
// ═══════════════════════════════════════════════════════════════════════════
{
  const draft = draftNoticeResponse({
    notice: { code: "CP14", date: "2026-04-01", description: "Balance due on the 2024 account.", proposedAmount: 4000 },
    computed: computedFixture(),
    clientFirstName: "Dana",
    clientLastName: "Reyes",
    // no preparerName → placeholder fallback
    asOfDate: "2026-06-13",
  });
  // computed owed = max(0, -refundOrOwed) = max(0, 4000) = 4000
  check("CP14 grounds computed balance owed", draft.groundingFacts.find((f) => /balance owed/i.test(f.label))!.ourValue, 4000);
  check("CP14 grounds IRS demanded balance", draft.groundingFacts.find((f) => f.irsValue === 4000)!.irsValue ?? 0, 4000);
  check("CP14 grounds total tax reported", draft.groundingFacts.find((f) => /total tax/i.test(f.label))!.ourValue, 42000);
  checkTrue("CP14 body uses preparer placeholder", /\[Preparer name/.test(draft.bodyTemplate));
  checkTrue("CP14 mentions installment agreement path", /installment/i.test(draft.bodyTemplate));
}
{
  const draft = draftNoticeResponse({
    notice: { code: "CP504", date: "2026-05-01", description: "Notice of intent to levy.", proposedAmount: 4200 },
    computed: computedFixture(),
    clientFirstName: "Dana",
    clientLastName: "Reyes",
    preparerName: "J. Tang, CPA",
    asOfDate: "2026-06-13",
  });
  checkTrue("CP504 body flags immediate attention / levy", /levy/i.test(draft.bodyTemplate) && /immediate/i.test(draft.bodyTemplate));
  check("CP504 grounds the levy demand amount", draft.groundingFacts.find((f) => f.irsValue === 4200)!.irsValue ?? 0, 4200);
  checkTrue("CP504 always carries 8821 disclaimer", draft.disclaimers.some((d) => /8821/.test(d)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
