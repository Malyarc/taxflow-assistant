/**
 * PLAN-Q1 — engine-verified delta as the headline/ranking number.
 *
 * annotateVerifiedSavings() tags each hit's provenance and, for a
 * "savings"-semantics hit carrying an engine-verified what-if, exposes the
 * engine-computed delta as `verifiedSavings`; the hit-list sort + the firm-wide
 * planningScore then rank on it (via `headlineSavings`) instead of the heuristic
 * `estSavings`. `estSavings` is left intact (both numbers travel on the hit).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-plan-q1-tests.ts
 */
import {
  annotateVerifiedSavings,
  headlineSavings,
} from "../../artifacts/api-server/src/lib/planningEngine";
import type { OpportunityHit } from "@workspace/planning-strategies";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
}

// A "savings" hit whose engine-verified delta ($9,000) is HIGHER than its
// heuristic estSavings ($1,000) — the discriminating case.
const verified = {
  strategyId: "verified", estSavings: 1000,
  whatIf: { semantics: "savings", delta: { combinedRefundDelta: 9000 } },
} as unknown as OpportunityHit;
// A heuristic-only hit with a HIGHER heuristic ($5,000) but no verified delta.
const heuristic = { strategyId: "heuristic", estSavings: 5000 } as unknown as OpportunityHit;
// A "cost" hit (Roth) — headline must STAY on the heuristic.
const cost = {
  strategyId: "cost", estSavings: 3000,
  whatIf: { semantics: "cost", delta: { combinedRefundDelta: -8000 } },
} as unknown as OpportunityHit;

annotateVerifiedSavings([verified, heuristic, cost]);

console.log("── annotateVerifiedSavings ──");
ok("verified → savingsSource 'engine-verified'", verified.savingsSource === "engine-verified");
ok("verified → verifiedSavings = |delta| = 9000", verified.verifiedSavings === 9000);
ok("verified → estSavings left intact (1000)", verified.estSavings === 1000);
ok("heuristic → savingsSource 'estimate'", heuristic.savingsSource === "estimate");
ok("heuristic → no verifiedSavings", heuristic.verifiedSavings === undefined);
ok("cost → 'estimate' (headline stays heuristic, not the cost delta)", cost.savingsSource === "estimate" && cost.verifiedSavings === undefined);

console.log("── headlineSavings ──");
ok("headlineSavings(verified) = 9000 (the verified delta)", headlineSavings(verified) === 9000);
ok("headlineSavings(heuristic) = 5000 (estSavings)", headlineSavings(heuristic) === 5000);
ok("headlineSavings(cost) = 3000 (estSavings)", headlineSavings(cost) === 3000);

console.log("── ranking now uses the verified delta ──");
// THE behavior change: by heuristic estSavings the order is heuristic(5000) >
// cost(3000) > verified(1000); by the verified delta, verified(9000) ranks #1.
const sorted = [heuristic, cost, verified].sort((a, b) => headlineSavings(b) - headlineSavings(a));
ok("verified hit ranks #1 (was last by heuristic estSavings)", sorted[0] === verified);
ok("heuristic hit ranks #2", sorted[1] === heuristic);

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL PLAN-Q1 CHECKS GREEN");
