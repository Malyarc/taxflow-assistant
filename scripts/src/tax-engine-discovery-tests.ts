/**
 * Phase H — H8: LLM-discovery rule-engine verification — hand-calc'd tests.
 *
 * Pure: tests `verifyAndDedupeCandidates` against a stub OpportunityHit[].
 * The LLM is NOT called — we feed in already-normalized candidate payloads
 * to exercise the verification matrix.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-discovery-tests.ts
 */
import { verifyAndDedupeCandidates } from "../../artifacts/api-server/src/lib/planningMemo";
import { CATALOG_V1, type OpportunityHit } from "@workspace/planning-strategies";

const PASS: string[] = [];
const FAIL: string[] = [];

function check<T>(label: string, actual: T, expected: T): void {
  if (Object.is(actual, expected)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function checkTruthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

/** Minimal OpportunityHit stub. */
const hit = (id: string): OpportunityHit =>
  ({
    strategyId: id,
    name: "test",
    category: "retirement",
    estSavings: 100,
    confidence: 0.5,
    cpaEffortHours: 1,
    recurring: false,
    rationale: "",
    action: "",
    prerequisiteData: [],
    citation: "",
    inputs: {},
  }) as OpportunityHit;

// ── Case 1: Catalog-overlap — IRC matches catalog, not in detected hits ───
// G1.4 catalog ircSection is "IRC §408A". LLM proposes a strategy with
// that IRC. No G1.4 in already-detected hits → verification status =
// "catalog-overlap" + matchedCatalogId = "G1.4".
{
  const result = verifyAndDedupeCandidates(
    [{
      name: "Backdoor Roth conversion",
      ircSection: "IRC §408A",
      confidence: 0.7,
      rationale: "Low-bracket year is a good Roth conversion window.",
      prerequisiteData: ["Traditional IRA balance"],
    }],
    [], // no detected hits
  );
  check("Case 1 single candidate returned", result.length, 1);
  check("Case 1 status = catalog-overlap", result[0].verification.status, "catalog-overlap");
  check("Case 1 matchedCatalogId = G1.4", result[0].verification.matchedCatalogId, "G1.4");
  checkTruthy(
    "Case 1 detail mentions the catalog strategy by ID",
    result[0].verification.detail.includes("G1.4"),
  );
}

// ── Case 2: Duplicate — IRC matches catalog AND that catalog ID was detected ─
// G1.4 already in detected hits — LLM violated the dedupe rule. Engine
// drops the candidate from the result entirely.
{
  const result = verifyAndDedupeCandidates(
    [{
      name: "Backdoor Roth conversion",
      ircSection: "IRC §408A",
      confidence: 0.7,
      rationale: "Same suggestion as already detected.",
      prerequisiteData: [],
    }],
    [hit("G1.4")], // G1.4 already detected
  );
  check("Case 2 duplicate dropped (length 0)", result.length, 0);
}

// ── Case 3: Extra-strategy — IRC not in catalog ───────────────────────────
// "IRC §6043(a)" isn't in the catalog. Verification status = extra-strategy.
{
  const result = verifyAndDedupeCandidates(
    [{
      name: "Liquidation tax planning",
      ircSection: "IRC §6043(a)",
      confidence: 0.5,
      rationale: "Distribution timing around corporate liquidation.",
      prerequisiteData: [],
    }],
    [],
  );
  check("Case 3 single candidate returned", result.length, 1);
  check("Case 3 status = extra-strategy", result[0].verification.status, "extra-strategy");
  checkTruthy(
    "Case 3 no matchedCatalogId",
    result[0].verification.matchedCatalogId == null,
  );
}

// ── Case 4: Empty IRC section → extra-strategy ────────────────────────────
{
  const result = verifyAndDedupeCandidates(
    [{
      name: "Some strategy without IRC",
      ircSection: "",
      confidence: 0.4,
      rationale: "blah",
      prerequisiteData: [],
    }],
    [],
  );
  check("Case 4 status = extra-strategy (no IRC)", result[0].verification.status, "extra-strategy");
  checkTruthy(
    "Case 4 detail mentions missing IRC",
    result[0].verification.detail.toLowerCase().includes("irc"),
  );
}

// ── Case 5: Mixed batch — overlap + extra + duplicate ─────────────────────
// 3 candidates: G1.4 not-detected (overlap), unknown IRC (extra), G1.1
// already detected (duplicate → filtered).
{
  const result = verifyAndDedupeCandidates(
    [
      { name: "Roth conv", ircSection: "IRC §408A", confidence: 0.6, rationale: "x", prerequisiteData: [] },
      { name: "Custom", ircSection: "IRC §9999", confidence: 0.3, rationale: "y", prerequisiteData: [] },
      { name: "SEP-IRA", ircSection: "IRC §408(k)", confidence: 0.8, rationale: "z", prerequisiteData: [] },
    ],
    [hit("G1.1")], // G1.1 already detected (uses §408(k))
  );
  check("Case 5 2 candidates kept (1 duplicate dropped)", result.length, 2);
  const statuses = result.map((c) => c.verification.status).sort();
  check("Case 5 first status = catalog-overlap", statuses[0], "catalog-overlap");
  check("Case 5 second status = extra-strategy", statuses[1], "extra-strategy");
}

// ── Case 6: IRC variant matching — "§163(j)" vs "163(j)" vs "Section 163(j)" ─
// Robustness: the normalizer should handle these variants.
// G1.7 in catalog uses "IRC §199A(b)(2)". Test variant matching.
{
  const result = verifyAndDedupeCandidates(
    [
      { name: "QBI", ircSection: "Section 199A(b)(2)", confidence: 0.6, rationale: "x", prerequisiteData: [] },
    ],
    [],
  );
  check("Case 6 'Section X' variant matches catalog", result[0].verification.status, "catalog-overlap");
  check("Case 6 matched to G1.7", result[0].verification.matchedCatalogId, "G1.7");
}

// ── Case 7: Empty candidate list → empty result ───────────────────────────
{
  const result = verifyAndDedupeCandidates([], []);
  check("Case 7 empty input → empty output", result.length, 0);
}

// ── Case 8: ALL candidates duplicates → empty result ──────────────────────
{
  const result = verifyAndDedupeCandidates(
    [
      { name: "Dup1", ircSection: "IRC §408A", confidence: 0.5, rationale: "", prerequisiteData: [] },
      { name: "Dup2", ircSection: "IRC §408(k)", confidence: 0.5, rationale: "", prerequisiteData: [] },
    ],
    [hit("G1.4"), hit("G1.1")],
  );
  check("Case 8 all dupes filtered → length 0", result.length, 0);
}

// ── Case 9: Verification preserves candidate fields ───────────────────────
{
  const result = verifyAndDedupeCandidates(
    [{
      name: "Test Strategy",
      ircSection: "IRC §9999",
      confidence: 0.42,
      rationale: "Specific rationale text.",
      prerequisiteData: ["Data point A", "Data point B"],
    }],
    [],
  );
  check("Case 9 name preserved", result[0].name, "Test Strategy");
  check("Case 9 confidence preserved", result[0].confidence, 0.42);
  check("Case 9 rationale preserved", result[0].rationale, "Specific rationale text.");
  check("Case 9 prerequisiteData length preserved", result[0].prerequisiteData.length, 2);
}

// ── Case 10: Sanity — every catalog strategy's IRC section maps to SOME ──
// catalog entry (catalog-overlap status). It may not map back to its own
// ID — multiple catalog entries share IRC sections (G1.6 NIIT cliff and
// G4.1 persistent NIIT both cite §1411; matcher returns the first hit).
// What matters: no catalog entry's IRC section falls through to
// extra-strategy (= no match). That would be a catalog regression.
{
  let unmatched = 0;
  let mappedToOther = 0;
  for (const s of CATALOG_V1.strategies) {
    const result = verifyAndDedupeCandidates(
      [{ name: s.name, ircSection: s.ircSection, confidence: 0.5, rationale: "x", prerequisiteData: [] }],
      [],
    );
    if (result[0]?.verification.status !== "catalog-overlap") unmatched++;
    else if (result[0]?.verification.matchedCatalogId !== s.id) mappedToOther++;
  }
  check("Case 10 every catalog entry IRC matches SOME catalog entry", unmatched, 0);
  // mappedToOther > 0 is expected (multi-year siblings) — just document
  // the count so a regression is visible.
  checkTruthy(
    `Case 10 ${mappedToOther} catalog entries map to a sibling (shared IRC) — expected for G4.X multi-year analogues of G1.X + intra-G1 IRC sharing (e.g. G1.22 pre-RMD ladder + G1.4 Roth both cite §408A)`,
    mappedToOther >= 4 && mappedToOther <= 12,
  );
}

// ── Print results ─────────────────────────────────────────────────────────
console.log(`\nH8 LLM-discovery verification tests:`);
console.log(`  ✓ Passed: ${PASS.length}`);
console.log(`  ✗ Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
process.exit(FAIL.length > 0 ? 1 : 0);
