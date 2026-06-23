/**
 * G-9 — Firm benchmarking analytics (T5 GROWTH, 2026-06-22). Pure, no API.
 *
 * Hand-calc'd against the documented aggregation rules (nearest-rank
 * percentiles, fixed AGI bands, $100-rounded dollar aggregates).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-firm-benchmarking-tests.ts
 */
import {
  buildFirmBenchmark,
  type FirmBenchmarkClient,
} from "../../artifacts/api-server/src/lib/firmBenchmarking";

const PASS: string[] = [];
const FAIL: string[] = [];
function eq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function truthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected true`);
}

// ── 5-client cohort, every value hand-derived ───────────────────────────────
// Client | AGI     | rate | opportunities (estSavings)
//   1    |  40,000 | 0.05 | SEP 1000
//   2    |  90,000 | 0.12 | SEP 2000, HSA 500
//   3    | 150,000 | 0.18 | HSA 800
//   4    | 300,000 | 0.24 | (none)
//   5    | 600,000 | 0.30 | SEP 3000
const cohort: FirmBenchmarkClient[] = [
  { agi: 40_000, effectiveTaxRate: 0.05, opportunities: [{ strategyId: "G1.1", name: "SEP-IRA", category: "retirement", estSavings: 1000 }] },
  { agi: 90_000, effectiveTaxRate: 0.12, opportunities: [
    { strategyId: "G1.1", name: "SEP-IRA", category: "retirement", estSavings: 2000 },
    { strategyId: "G1.14", name: "HSA", category: "health", estSavings: 500 },
  ] },
  { agi: 150_000, effectiveTaxRate: 0.18, opportunities: [{ strategyId: "G1.14", name: "HSA", category: "health", estSavings: 800 }] },
  { agi: 300_000, effectiveTaxRate: 0.24, opportunities: [] },
  { agi: 600_000, effectiveTaxRate: 0.30, opportunities: [{ strategyId: "G1.1", name: "SEP-IRA", category: "retirement", estSavings: 3000 }] },
];

const r = buildFirmBenchmark(cohort);

eq("clientCount", r.clientCount, 5);

// Effective-rate percentages sorted [5,12,18,24,30], n=5.
//   min 5.0, max 30.0, mean 89/5 = 17.8
//   p25 rank=ceil(1.25)=2 → idx1 → 12.0
//   median rank=ceil(2.5)=3 → idx2 → 18.0
//   p75 rank=ceil(3.75)=4 → idx3 → 24.0
//   p90 rank=ceil(4.5)=5 → idx4 → 30.0
eq("rate min", r.effectiveRatePct.min, 5.0);
eq("rate p25", r.effectiveRatePct.p25, 12.0);
eq("rate median", r.effectiveRatePct.median, 18.0);
eq("rate p75", r.effectiveRatePct.p75, 24.0);
eq("rate p90", r.effectiveRatePct.p90, 30.0);
eq("rate max", r.effectiveRatePct.max, 30.0);
eq("rate mean", r.effectiveRatePct.mean, 17.8);

// AGI bands: one client each.
eq("band Under $50k count", r.agiBands[0].clientCount, 1);
eq("band $50k–$100k count", r.agiBands[1].clientCount, 1);
eq("band $100k–$200k count", r.agiBands[2].clientCount, 1);
eq("band $200k–$500k count", r.agiBands[3].clientCount, 1);
eq("band $500k+ count", r.agiBands[4].clientCount, 1);
eq("band labels stable", r.agiBands.map((b) => b.label).join("|"), "Under $50k|$50k–$100k|$100k–$200k|$200k–$500k|$500k+");

// Strategy adoption — SEP (3 clients) ranks before HSA (2 clients).
//   SEP savings [1000,2000,3000]: sum 6000, median rank=ceil(1.5)=2→idx1→2000, reach 3/5=60.0
//   HSA savings [500,800]:        sum 1300, median rank=ceil(1)=1→idx0→500,  reach 2/5=40.0
eq("strategy[0] id (most reach)", r.strategyAdoption[0].strategyId, "G1.1");
eq("SEP clients", r.strategyAdoption[0].clientsWithOpportunity, 3);
eq("SEP reachPct", r.strategyAdoption[0].reachPct, 60.0);
eq("SEP totalEstSavings", r.strategyAdoption[0].totalEstSavings, 6000);
eq("SEP medianEstSavings", r.strategyAdoption[0].medianEstSavings, 2000);
eq("strategy[1] id", r.strategyAdoption[1].strategyId, "G1.14");
eq("HSA clients", r.strategyAdoption[1].clientsWithOpportunity, 2);
eq("HSA reachPct", r.strategyAdoption[1].reachPct, 40.0);
eq("HSA totalEstSavings", r.strategyAdoption[1].totalEstSavings, 1300);
eq("HSA medianEstSavings", r.strategyAdoption[1].medianEstSavings, 500);
eq("exactly 2 strategies", r.strategyAdoption.length, 2);

// Firm opportunity: raw total = 1000 + 2500 + 800 + 0 + 3000 = 7300.
//   clientsWithAnyOpportunity = 4 (client 4 has none).
//   avg = 7300 / 4 = 1825 → r100 = round(18.25)*100 = 1800.
eq("firm totalEstSavings", r.firmOpportunity.totalEstSavings, 7300);
eq("firm clientsWithAnyOpportunity", r.firmOpportunity.clientsWithAnyOpportunity, 4);
eq("firm avgSavingsPerOpportunityClient", r.firmOpportunity.avgSavingsPerOpportunityClient, 1800);

// ── Empty cohort — all zeros, no NaN/Infinity ───────────────────────────────
const empty = buildFirmBenchmark([]);
eq("empty clientCount", empty.clientCount, 0);
eq("empty rate median", empty.effectiveRatePct.median, 0);
eq("empty rate mean", empty.effectiveRatePct.mean, 0);
eq("empty strategies", empty.strategyAdoption.length, 0);
eq("empty firm total", empty.firmOpportunity.totalEstSavings, 0);
eq("empty firm avg", empty.firmOpportunity.avgSavingsPerOpportunityClient, 0);
truthy("empty bands present (all zero)", empty.agiBands.every((b) => b.clientCount === 0) && empty.agiBands.length === 5);

// ── Edge: negative AGI lands in the first band; $100-rounding holds ──────────
const edge = buildFirmBenchmark([
  { agi: -5_000, effectiveTaxRate: 0, opportunities: [{ strategyId: "X", name: "X", estSavings: 149 }] },
  { agi: 49_999, effectiveTaxRate: 0.1, opportunities: [{ strategyId: "X", name: "X", estSavings: 151 }] },
]);
eq("negative AGI → first band", edge.agiBands[0].clientCount, 2);
// Savings [149,151]: sum 300 → r100 300; median rank=ceil(1)=1→idx0→149 → r100(149)=100.
eq("edge X total r100", edge.strategyAdoption[0].totalEstSavings, 300);
eq("edge X median r100 (149→100)", edge.strategyAdoption[0].medianEstSavings, 100);

console.log(`\nFirm benchmarking (G-9) tests:`);
console.log(`  Passed: ${PASS.length}`);
console.log(`  Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
