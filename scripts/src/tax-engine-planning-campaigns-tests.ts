/**
 * T2.2 D3 — Planning-campaign aggregation + email-template tests.
 *
 * Pure (no API, no LLM). HAND-SUMMED aggregation over synthetic per-client
 * hits, the anonymous cohort-stats rounding (the §7216-by-design boundary),
 * and the deterministic mail-merge template.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-planning-campaigns-tests.ts
 */

import type { OpportunityHit, PlanningStrategy } from "@workspace/planning-strategies";
import { CATALOG_V1 } from "@workspace/planning-strategies";
import {
  aggregateCampaigns,
  cohortStats,
  stubCampaignTemplate,
  type CampaignClientHit,
} from "../../artifacts/api-server/src/lib/planningCampaigns";

const PASS: string[] = [];
const FAIL: string[] = [];
function checkEq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

function hit(strategyId: string, name: string, estSavings: number, verifiedSavings?: number): OpportunityHit {
  return {
    strategyId, name, category: "retirement", estSavings,
    confidence: 0.8, cpaEffortHours: 1, recurring: true,
    rationale: "r", action: "a", prerequisiteData: [], citation: "IRC §x", inputs: {},
    ...(verifiedSavings != null ? { verifiedSavings, savingsSource: "engine-verified" as const } : {}),
  };
}

function client(clientId: number, firstName: string, hits: OpportunityHit[]): CampaignClientHit {
  return { clientId, firstName, lastName: `L${clientId}`, email: null, hits };
}

// ════════════════════════════════════════════════════════════════════════════
// C1 — Grouping + totals + ordering. Three clients, two strategies.
//   SEP: c1 $5,000 + c2 $3,000 + c3 $1,000 = $9,000 (median $3,000)
//   PTET: c1 $4,000 + c3 $2,000 = $6,000 (median $3,000)
//   verifiedSavings takes precedence over estSavings (c2's SEP $3,000
//   verified vs $2,500 estimate).
// ════════════════════════════════════════════════════════════════════════════
{
  const campaigns = aggregateCampaigns([
    client(1, "Ann", [hit("G1.1", "SEP-IRA", 5000), hit("G1.2", "PTET", 4000)]),
    client(2, "Bob", [hit("G1.1", "SEP-IRA", 2500, 3000)]),
    client(3, "Cyd", [hit("G1.1", "SEP-IRA", 1000), hit("G1.2", "PTET", 2000)]),
  ]);
  checkEq("C1 two campaigns", campaigns.length, 2);
  checkEq("C1 SEP first (bigger total)", campaigns[0].strategyId, "G1.1");
  checkEq("C1 SEP total $9,000 (uses verified $3,000)", campaigns[0].totalEstSavings, 9000);
  checkEq("C1 SEP client count 3", campaigns[0].clientCount, 3);
  checkEq("C1 SEP median $3,000", campaigns[0].medianEstSavings, 3000);
  checkEq("C1 PTET total $6,000", campaigns[1].totalEstSavings, 6000);
  checkEq("C1 PTET median $3,000 (even count avg of 2k/4k)", campaigns[1].medianEstSavings, 3000);
  // Members sorted by savings desc within the campaign.
  checkEq("C1 SEP top member = Ann $5,000", campaigns[0].clients[0].estSavings, 5000);
  checkEq("C1 SEP last member = Cyd $1,000", campaigns[0].clients[2].estSavings, 1000);
  checkEq("C1 Bob's SEP savings = verified $3,000", campaigns[0].clients.find((m) => m.clientId === 2)?.estSavings, 3000);
  // Each campaign carries its anonymous stats (what the email-draft forwards).
  checkEq("C1 SEP stats count 3", campaigns[0].stats.clientCount, 3);
  checkEq("C1 SEP stats min $1,000", campaigns[0].stats.minSavings, 1000);
  checkEq("C1 SEP stats median $3,000", campaigns[0].stats.medianSavings, 3000);
  checkEq("C1 SEP stats max $5,000", campaigns[0].stats.maxSavings, 5000);
  checkEq("C1 empty input → no campaigns", aggregateCampaigns([]).length, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// C2 — cohortStats: rounded to $100 (the anonymization boundary).
//   [1,234 · 5,678 · 9,012] → min 1,200 / median 5,700 / max 9,000.
//   Even count [1,000 · 2,000] → median 1,500.
// ════════════════════════════════════════════════════════════════════════════
{
  const s = cohortStats([{ estSavings: 1234 }, { estSavings: 9012 }, { estSavings: 5678 }]);
  checkEq("C2 count", s.clientCount, 3);
  checkEq("C2 min rounded to $1,200", s.minSavings, 1200);
  checkEq("C2 median rounded to $5,700", s.medianSavings, 5700);
  checkEq("C2 max rounded to $9,000", s.maxSavings, 9000);
  const even = cohortStats([{ estSavings: 1000 }, { estSavings: 2000 }]);
  checkEq("C2 even-count median $1,500", even.medianSavings, 1500);
  const none = cohortStats([]);
  checkEq("C2 empty cohort count 0", none.clientCount, 0);
  checkEq("C2 empty cohort min 0", none.minSavings, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// C3 — deterministic template: both merge fields exactly once, strategy named,
//   no literal dollar amounts (only the merge field carries the number).
// ════════════════════════════════════════════════════════════════════════════
{
  const strategy = CATALOG_V1.strategies.find((s: PlanningStrategy) => s.id === "G1.2")!;
  checkTrue("C3 catalog has G1.2 (PTET)", strategy != null);
  const t = stubCampaignTemplate(strategy);
  checkEq("C3 one {{firstName}}", t.split("{{firstName}}").length - 1, 1);
  checkEq("C3 one {{estSavings}}", t.split("{{estSavings}}").length - 1, 1);
  checkTrue("C3 names the strategy", t.toLowerCase().includes(strategy.name.toLowerCase()));
  checkTrue("C3 no literal $ amount", !/\$\d/.test(t));
  checkTrue("C3 has the CTA", t.includes("30 minutes"));
  checkTrue("C3 signs as the CPA team", t.includes("Your CPA team"));
}

console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
