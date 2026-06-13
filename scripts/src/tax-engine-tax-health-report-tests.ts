/**
 * G-7 — Annual "Tax Health Report" tests.
 *
 * Pure (no API). Builds REAL prior/current returns with computeTaxReturnPure,
 * then exercises buildTaxHealthReport + buildTaxHealthReportPdf.
 *
 * HAND-CALC'D anchors (derivations inline):
 *   • Effective rate = totalTax / AGI, where totalTax = engine effectiveTaxRate
 *     × engine totalIncome (the exact inverse of the engine identity at
 *     taxReturnEngine.ts:4832). So totalTax/AGI = effRate × totalIncome / AGI.
 *   • Capital-loss carryforward: a $20,000 short-term loss carryforward with no
 *     gains → $3,000 ordinary offset (single) → $17,000 carries forward (Sch D
 *     $3k cap + character-preserving carryforward, CLAUDE.md invariant #6).
 *   • YoY NIIT $1,140 / Add'l Medicare $540 reused from the YoY anchor set.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-tax-health-report-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  buildTaxHealthReport,
  buildCarryforwardInventory,
} from "../../artifacts/api-server/src/lib/taxHealthReport";
import type { OpportunityHit } from "@workspace/planning-strategies";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  cond ? PASS.push(`✓ ${label}`) : FAIL.push(`✗ ${label}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Single FL wage earner, optional LTCG, optional adjustments. */
function single(
  year: number,
  wages: number,
  ltcg = 0,
  withhold = 0,
  adjustments: TaxReturnInputs["adjustments"] = [],
): TaxReturnInputs {
  return {
    client: { filingStatus: "single", state: "FL", taxYear: year },
    w2s: [{ taxYear: year, wagesBox1: wages, medicareWagesBox5: wages, federalTaxWithheldBox2: withhold || Math.round(wages * 0.18) }],
    form1099s: [],
    adjustments: [
      ...(ltcg ? [{ adjustmentType: "long_term_capital_gain" as const, amount: ltcg, isApplied: true }] : []),
      ...adjustments,
    ],
    taxYear: year,
  };
}

/** A couple of planning hits (one verified, one estimate, one "cost" Roth). */
function sampleHits(): OpportunityHit[] {
  const base = {
    category: "retirement" as const,
    confidence: 0.8,
    cpaEffortHours: 2,
    recurring: true,
    rationale: "rationale",
    action: "action",
    prerequisiteData: [],
    citation: "IRC §x",
    inputs: {},
  };
  return [
    { ...base, strategyId: "G1.1", name: "SEP-IRA", estSavings: 4000, verifiedSavings: 4200, savingsSource: "engine-verified" },
    { ...base, strategyId: "G1.9", name: "Tax-loss harvesting", category: "investment", estSavings: 1500, savingsSource: "estimate" },
    { ...base, strategyId: "G1.4", name: "Roth conversion", estSavings: 900, savingsSource: "estimate" },
  ];
}

const fmtItem = (inv: ReturnType<typeof buildCarryforwardInventory>, kind: string) =>
  inv.find((i) => i.kind === kind);

// ════════════════════════════════════════════════════════════════════════════
// S1 — Effective-rate computation (totalTax / AGI) + AGI≤0 guard.
//   Single, $260k wages + $30k LTCG current vs $150k + $30k prior.
//   The report's totalTax = engine effRate × engine totalIncome (exact inverse);
//   the report's effRate = totalTax / AGI.
// ════════════════════════════════════════════════════════════════════════════
{
  const prior = computeTaxReturnPure(single(2024, 150000, 30000));
  const curr = computeTaxReturnPure(single(2024, 260000, 30000));
  const rpt = buildTaxHealthReport({
    priorReturn: prior, currentReturn: curr, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024,
  });

  // totalTax recovered from the engine's own rate × income (ties to the cent).
  check("S1 totalTax = engine effRate × totalIncome", rpt.totalTax, curr.effectiveTaxRate * curr.totalIncome, 0.01);
  // Report effective rate = totalTax / AGI.
  check("S1 effective rate = totalTax / AGI", rpt.effectiveTaxRate, rpt.totalTax / curr.adjustedGrossIncome, 1e-9);
  check("S1 prior effective rate = priorTotalTax / priorAGI", rpt.priorEffectiveTaxRate,
    (prior.effectiveTaxRate * prior.totalIncome) / prior.adjustedGrossIncome, 1e-9);
  check("S1 agi pass-through", rpt.agi, curr.adjustedGrossIncome, 0.01);
  check("S1 priorYear pass-through", rpt.priorYear, 2024);
  check("S1 taxYear pass-through", rpt.taxYear, 2024);
  check("S1 refundOrOwed = fed + state refund", rpt.refundOrOwed, curr.federalRefundOrOwed + curr.stateRefundOrOwed, 0.01);
  checkTrue("S1 effective rate is positive & finite", rpt.effectiveTaxRate > 0 && Number.isFinite(rpt.effectiveTaxRate));
}

// AGI ≤ 0 guard → effective rate 0. Built from a REAL return: $5k wages eaten by
// an $80k rental loss (passive) → engine AGI = 0 → the totalTax/AGI guard fires.
{
  const zeroAgi = computeTaxReturnPure(single(2024, 5000, 0, 0, [
    { adjustmentType: "schedule_e_rental_income", amount: 1000, isApplied: true },
    { adjustmentType: "schedule_e_rental_expenses", amount: 80000, isApplied: true },
  ]));
  check("S1b sanity: engine AGI is 0", zeroAgi.adjustedGrossIncome, 0);
  const rpt = buildTaxHealthReport({ priorReturn: zeroAgi, currentReturn: zeroAgi, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024 });
  check("S1b AGI≤0 → effective rate 0", rpt.effectiveTaxRate, 0);
  check("S1b AGI≤0 → prior effective rate 0", rpt.priorEffectiveTaxRate, 0);
  // sanity: a normal return is non-zero (proves the guard isn't always firing).
  const real = computeTaxReturnPure(single(2024, 80000));
  const rpt2 = buildTaxHealthReport({ priorReturn: real, currentReturn: real, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024 });
  checkTrue("S1b normal return effective rate > 0", rpt2.effectiveTaxRate > 0);
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — YoY summary pass-through (the report reuses computeYearOverYear verbatim).
//   Reuses the YoY anchor: $150k→$260k crosses NIIT ($1,140) + Add'l Med ($540).
// ════════════════════════════════════════════════════════════════════════════
{
  const prior = computeTaxReturnPure(single(2024, 150000, 30000));
  const curr = computeTaxReturnPure(single(2024, 260000, 30000));
  const rpt = buildTaxHealthReport({
    priorReturn: prior, currentReturn: curr, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024,
  });
  check("S2 yoy currentYear", rpt.yoy.currentYear, 2024);
  check("S2 yoy priorYear", rpt.yoy.priorYear, 2024);
  check("S2 yoy has 14 comparison lines", rpt.yoy.deltas.length, 14);
  check("S2 current NIIT $1,140 (hand-calc)", curr.niitTax, 1140);
  check("S2 current Add'l Medicare $540 (hand-calc)", curr.additionalMedicareTax, 540);
  // Total-income delta = +$110,000.
  const incomeDelta = rpt.yoy.deltas.find((d) => d.label === "Total income")!;
  check("S2 total-income change +$110,000", incomeDelta.change, 110000);
  checkTrue("S2 NIIT is a notable swing in the YoY pass", rpt.yoy.notableSwings.some((d) => d.label === "Net investment income tax"));
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — Threshold-crossing surfacing (thresholdsCrossed === yoy.thresholdCrossings).
// ════════════════════════════════════════════════════════════════════════════
{
  const prior = computeTaxReturnPure(single(2024, 150000, 30000));
  const curr = computeTaxReturnPure(single(2024, 260000, 30000));
  const rpt = buildTaxHealthReport({
    priorReturn: prior, currentReturn: curr, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024,
  });
  checkTrue("S3 thresholdsCrossed mirrors yoy.thresholdCrossings", rpt.thresholdsCrossed === rpt.yoy.thresholdCrossings);
  checkTrue("S3 NIIT crossing surfaced (entered)", rpt.thresholdsCrossed.some((t) => t.id === "niit" && t.direction === "entered"));
  checkTrue("S3 Add'l Medicare crossing surfaced (entered)", rpt.thresholdsCrossed.some((t) => t.id === "addl-medicare" && t.direction === "entered"));
  checkTrue("S3 every crossing has a non-empty detail", rpt.thresholdsCrossed.every((t) => t.detail.length > 0));
}

// Stable return → no crossings.
{
  const r = computeTaxReturnPure(single(2024, 90000, 0, 12000));
  const rpt = buildTaxHealthReport({ priorReturn: r, currentReturn: r, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024 });
  check("S3b stable return → 0 thresholds crossed", rpt.thresholdsCrossed.length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — Carryforward inventory extraction — return WITH a capital-loss CF.
//   $20,000 short-term capital-loss carryforward, no gains, single:
//     $3,000 ordinary offset → $17,000 carries forward (Sch D $3k cap, invariant #6).
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs = single(2024, 90000, 0, 14000, [
    { adjustmentType: "capital_loss_carryforward_short", amount: 20000, isApplied: true },
  ]);
  const ret = computeTaxReturnPure(inputs);
  check("S4 engine carries $17,000 short-term loss forward (hand-calc)", ret.capitalLossCarryforwardShort, 17000);

  const inv = buildCarryforwardInventory(ret);
  const item = fmtItem(inv, "capital_loss_short");
  checkTrue("S4 inventory includes the short-term capital loss", item != null);
  check("S4 inventory amount == engine field ($17,000)", item?.amount ?? 0, ret.capitalLossCarryforwardShort, 0.01);
  checkTrue("S4 item has a label", (item?.label.length ?? 0) > 0);
  checkTrue("S4 item has a note", (item?.note.length ?? 0) > 0);
  checkTrue("S4 every inventory item has amount > 0", inv.every((i) => i.amount > 0));

  // Through buildTaxHealthReport: the report surfaces the same inventory.
  const rpt = buildTaxHealthReport({ priorReturn: ret, currentReturn: ret, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024 });
  checkTrue("S4 report carryforwardInventory non-empty", rpt.carryforwardInventory.length > 0);
  check("S4 report capital-loss CF amount", fmtItem(rpt.carryforwardInventory, "capital_loss_short")?.amount ?? 0, 17000, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — Carryforward inventory — return WITHOUT carryforwards → EMPTY inventory.
//   Plain W-2, no losses, no NOL → no attribute rolls forward.
// ════════════════════════════════════════════════════════════════════════════
{
  const ret = computeTaxReturnPure(single(2024, 90000, 0, 14000));
  const inv = buildCarryforwardInventory(ret);
  check("S5 inventory is EMPTY for a clean W-2 return", inv.length, 0);
  // Confirm the underlying engine fields are indeed all zero.
  check("S5 capital-loss CF short = 0", ret.capitalLossCarryforwardShort, 0);
  check("S5 capital-loss CF long = 0", ret.capitalLossCarryforwardLong, 0);
  check("S5 NOL CF remaining = 0", ret.nolCarryforwardRemaining, 0);
  check("S5 charitable CF remaining = 0", ret.charitableCarryforwardCashRemaining, 0);

  const rpt = buildTaxHealthReport({ priorReturn: ret, currentReturn: ret, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024 });
  check("S5 report carryforwardInventory empty", rpt.carryforwardInventory.length, 0);
}

// Second carryforward kind: a partly-unused NOL also surfaces (qualitative — the
// NOL applies above the line so the remaining is engine-derived, asserted == field).
{
  const ret = computeTaxReturnPure(single(2024, 60000, 0, 10000, [
    { adjustmentType: "nol_carryforward", amount: 200000, isApplied: true },
  ]));
  checkTrue("S5b NOL carryforward remaining > 0 (huge NOL only partly used)", ret.nolCarryforwardRemaining > 0);
  const inv = buildCarryforwardInventory(ret);
  const item = fmtItem(inv, "nol");
  checkTrue("S5b inventory includes the NOL", item != null);
  check("S5b NOL inventory amount == engine field", item?.amount ?? 0, ret.nolCarryforwardRemaining, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// S6 — Planning headline (top hits by verified ?? est savings) + total.
//   Hits: SEP verified $4,200, TLH est $1,500, Roth est $900 → total $6,600.
//   Top should be SEP first (highest headline), Roth last.
// ════════════════════════════════════════════════════════════════════════════
{
  const ret = computeTaxReturnPure(single(2024, 90000, 0, 14000));
  const rpt = buildTaxHealthReport({
    priorReturn: ret, currentReturn: ret, priorYearScopedDocsPresent: true, hits: sampleHits(), taxYear: 2024,
  });
  check("S6 total potential savings = 4200 + 1500 + 900", rpt.planningHeadline.totalPotentialSavings, 6600, 0.01);
  check("S6 top strategy count", rpt.planningHeadline.topStrategies.length, 3);
  checkTrue("S6 SEP ranked first (verified $4,200)", rpt.planningHeadline.topStrategies[0].name === "SEP-IRA");
  check("S6 SEP headline savings = verified $4,200", rpt.planningHeadline.topStrategies[0].savings, 4200, 0.01);
  checkTrue("S6 Roth ranked last ($900)", rpt.planningHeadline.topStrategies[2].name === "Roth conversion");
  check("S6 no hits → 0 total", buildTaxHealthReport({ priorReturn: ret, currentReturn: ret, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024 }).planningHeadline.totalPotentialSavings, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// S7 — Planning calendar (buildPlanningCalendar) grouping + totals.
//   SEP (G1.1) → extended_due_date; TLH (G1.9) + Roth (G1.4) → year_end.
//   year_end group total = max(0,1500) + max(0,900) = 2400; extended = 4200.
// ════════════════════════════════════════════════════════════════════════════
{
  const ret = computeTaxReturnPure(single(2024, 90000, 0, 14000));
  const rpt = buildTaxHealthReport({
    priorReturn: ret, currentReturn: ret, priorYearScopedDocsPresent: true, hits: sampleHits(), taxYear: 2024,
  });
  check("S7 calendar taxYear", rpt.calendar.taxYear, 2024);
  checkTrue("S7 calendar has groups", rpt.calendar.groups.length >= 2);
  const yearEnd = rpt.calendar.groups.find((g) => g.deadlineType === "year_end");
  const extended = rpt.calendar.groups.find((g) => g.deadlineType === "extended_due_date");
  checkTrue("S7 year_end group present (TLH + Roth)", yearEnd != null);
  checkTrue("S7 extended_due_date group present (SEP)", extended != null);
  check("S7 year_end total = 1500 + 900", yearEnd?.totalSavings ?? -1, 2400, 0.01);
  check("S7 extended total = 4200 (verified SEP)", extended?.totalSavings ?? -1, 4200, 0.01);
  check("S7 calendar grand total = 6600", rpt.calendar.totalSavings, 6600, 0.01);
  // Soonest-first: year_end before extended_due_date.
  const yeIdx = rpt.calendar.groups.findIndex((g) => g.deadlineType === "year_end");
  const exIdx = rpt.calendar.groups.findIndex((g) => g.deadlineType === "extended_due_date");
  checkTrue("S7 year_end sorts before extended_due_date", yeIdx < exIdx);
}

// ════════════════════════════════════════════════════════════════════════════
// S8 — Assumptions: base set present + YoY caveat propagated when no prior docs.
// ════════════════════════════════════════════════════════════════════════════
{
  const prior = computeTaxReturnPure(single(2024, 80000));
  const curr = computeTaxReturnPure(single(2025, 90000));
  const rptNoDocs = buildTaxHealthReport({
    priorReturn: prior, currentReturn: curr, priorYearScopedDocsPresent: false, hits: [], taxYear: 2025,
  });
  checkTrue("S8 assumptions non-empty", rptNoDocs.assumptions.length >= 4);
  checkTrue("S8 effective-rate basis assumption present",
    rptNoDocs.assumptions.some((a) => a.toLowerCase().includes("adjusted gross income")));
  checkTrue("S8 YoY no-prior-docs caveat propagated",
    rptNoDocs.assumptions.some((a) => a.includes("year-scoped documents")));

  // With prior docs → no such caveat.
  const rptDocs = buildTaxHealthReport({
    priorReturn: prior, currentReturn: curr, priorYearScopedDocsPresent: true, hits: [], taxYear: 2025,
  });
  checkTrue("S8 caveat absent when prior docs present",
    !rptDocs.assumptions.some((a) => a.includes("year-scoped documents")));
}

// ════════════════════════════════════════════════════════════════════════════
// S9 — PDF render smoke (%PDF magic + byte length) — async.
// ════════════════════════════════════════════════════════════════════════════
async function pdfSmoke(): Promise<void> {
  const { buildTaxHealthReportPdf } = await import("../../artifacts/api-server/src/lib/taxHealthReport");
  const prior = computeTaxReturnPure(single(2024, 150000, 30000, 0, [
    { adjustmentType: "capital_loss_carryforward_short", amount: 20000, isApplied: true },
  ]));
  const curr = computeTaxReturnPure(single(2024, 260000, 30000, 0, [
    { adjustmentType: "capital_loss_carryforward_short", amount: 20000, isApplied: true },
  ]));
  const rpt = buildTaxHealthReport({
    priorReturn: prior, currentReturn: curr, priorYearScopedDocsPresent: true, hits: sampleHits(), taxYear: 2024,
  });

  const buf = await buildTaxHealthReportPdf({
    report: rpt, clientFirstName: "Jordan", clientLastName: "Avery", preparedDate: "June 13, 2026", firmName: "Brookhaven CPA",
  });
  checkTrue("S9 PDF is a Buffer", Buffer.isBuffer(buf));
  checkTrue("S9 PDF starts with %PDF magic", buf.subarray(0, 5).toString("latin1") === "%PDF-");
  checkTrue("S9 PDF byte length is substantial (> 2,000 bytes)", buf.length > 2000);

  // Empty-state PDF (no crossings, no carryforwards, no hits) also renders.
  const plain = computeTaxReturnPure(single(2024, 90000, 0, 14000));
  const rptPlain = buildTaxHealthReport({ priorReturn: plain, currentReturn: plain, priorYearScopedDocsPresent: true, hits: [], taxYear: 2024 });
  const buf2 = await buildTaxHealthReportPdf({ report: rptPlain, clientFirstName: "Sam", clientLastName: "Lee", preparedDate: "June 13, 2026" });
  checkTrue("S9 empty-state PDF starts with %PDF magic", buf2.subarray(0, 5).toString("latin1") === "%PDF-");
  checkTrue("S9 empty-state PDF byte length > 1,500 bytes", buf2.length > 1500);
}

// ── Run ───────────────────────────────────────────────────────────────────
(async () => {
  await pdfSmoke();
  console.log(`\nG-7 — Annual Tax Health Report:`);
  console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
  if (FAIL.length > 0) { for (const f of FAIL) console.error(f); process.exit(1); }
  for (const p of PASS) console.log(`  ${p}`);
  process.exit(0);
})();
