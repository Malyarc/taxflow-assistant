/**
 * Planning DETECTOR-COVERAGE suite (no API).
 *
 * Guards the hand-wired detector dispatch against silently DROPPING a catalog
 * strategy. The dispatch is a long hand-maintained sequence of
 * `const h = detectX(...); if (h) hits.push(h)` calls across two files —
 * planningEngine.ts (G1.* single-year) and planningEngineMultiYear.ts (G4.*
 * multi-year) — so it is easy to add a catalog entry and forget to wire a
 * detector. A dropped strategy then returns zero hits forever with NO error.
 *
 * PRIMARY (static): the set of strategyById("...") literals across BOTH engine
 * source files must equal the set of CATALOG_V1 ids. This catches the most common
 * mistake — "added a catalog strategy, wrote no detector". (strategyById() throws
 * at runtime for an unknown id, so a wired id is always a real catalog id; the
 * static scan also flags an orphan reference before runtime.)
 *
 * SECONDARY (dynamic): a deliberately rich single client run through
 * evaluatePlanningOpportunities must fire a healthy number of distinct G1
 * strategies — a coarse guard that the dispatch list isn't wholesale broken
 * (a detector that EXISTS but was removed from the push list is the one case the
 * static scan can't see; this floor partially covers it).
 *
 * NOTE on the static scan's limitation: it proves a detector *function for* each
 * id exists; it cannot prove that function is actually invoked in the dispatch.
 * The dynamic floor is the (partial) backstop for that. A future hardening would
 * derive the dispatch from a registry array so wiring is structural.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-detector-coverage-tests.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CATALOG_V1 } from "@workspace/planning-strategies";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { evaluatePlanningOpportunities } from "../../artifacts/api-server/src/lib/planningEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}${detail ? `: ${detail}` : ""}`);
}
function header(t: string): void { console.log(`\n-- ${t} --`); }

// ── Static: strategyById("...") literals across both engine files ───────────
header("Static — every catalog strategy is reachable by a detector");

const libDir = join(dirname(fileURLToPath(import.meta.url)), "../../artifacts/api-server/src/lib");
const sources = ["planningEngine.ts", "planningEngineMultiYear.ts"]
  .map((f) => readFileSync(join(libDir, f), "utf8"))
  .join("\n");

const wiredIds = new Set(
  [...sources.matchAll(/strategyById\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
);
const catalogIds = new Set(CATALOG_V1.strategies.map((s) => s.id));

const unwired = [...catalogIds].filter((id) => !wiredIds.has(id));
ok(`every catalog strategy (${catalogIds.size}) is wired to a detector`, unwired.length === 0,
  `UNWIRED (in catalog, no detector): ${unwired.join(", ")}`);

const orphans = [...wiredIds].filter((id) => !catalogIds.has(id));
ok("no detector references a non-catalog strategyId", orphans.length === 0,
  `ORPHANS (detector refs, not in catalog): ${orphans.join(", ")}`);

ok(`wired id count (${wiredIds.size}) equals catalog count (${catalogIds.size})`,
  wiredIds.size === catalogIds.size, `${wiredIds.size} vs ${catalogIds.size}`);

// Belt-and-suspenders: G4 multi-year strategies are wired in the SEPARATE module —
// assert they're present in the union (a regression that moved/deleted that file
// would surface here).
for (const g4 of ["G4.1", "G4.2", "G4.3", "G4.4", "G4.5"]) {
  ok(`${g4} (multi-year) is wired`, wiredIds.has(g4));
}

// ── Dynamic: a rich client fires a healthy number of distinct G1 strategies ──
header("Dynamic — rich client fires many distinct strategies (dispatch not broken)");

// High-income SE + W-2 + investment + charitable single filer, age 55, high-tax
// state — deliberately trips many independent detectors (SEP/Solo401k, backdoor
// Roth, NIIT, transit fringe, estimated-tax safe harbor, state-residency, Augusta,
// TLH, HSA, etc.). Exact set isn't asserted (that's the per-detector suites' job) —
// only that the dispatch surfaces a broad spread.
const richClient = {
  filingStatus: "single",
  state: "CA",
  taxYear: 2025,
  taxpayerAge: 55,
  dependentsUnder17: 1,
} as unknown as TaxReturnInputs["client"];

const richInputs: TaxReturnInputs = {
  client: richClient,
  taxYear: 2025,
  w2s: [{ taxYear: 2025, wagesBox1: 180000, stateCode: "CA" } as unknown as TaxReturnInputs["w2s"][number]],
  form1099s: [
    { taxYear: 2025, formType: "nec", payerName: "Consulting", nonemployeeCompensation: 220000 } as unknown as TaxReturnInputs["form1099s"][number],
    { taxYear: 2025, formType: "div", payerName: "Broker", ordinaryDividends: 12000, qualifiedDividends: 10000 } as unknown as TaxReturnInputs["form1099s"][number],
    { taxYear: 2025, formType: "int", payerName: "Bank", interestIncome: 8000 } as unknown as TaxReturnInputs["form1099s"][number],
  ],
  adjustments: [
    { adjustmentType: "long_term_capital_gains", amount: 60000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    { adjustmentType: "charitable_cash", amount: 20000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
  ],
};

const computed = computeTaxReturnPure(richInputs);
const hits = evaluatePlanningOpportunities({
  client: richClient,
  computed,
  adjustments: richInputs.adjustments,
});
const distinct = new Set(hits.map((h) => h.strategyId));
const FLOOR = 6;
ok(`rich client fires >= ${FLOOR} distinct strategies`, distinct.size >= FLOOR,
  `fired ${distinct.size}: ${[...distinct].sort().join(", ")}`);
console.log(`   (fired ${distinct.size} distinct: ${[...distinct].sort().join(", ")})`);

console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (detector coverage)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL DETECTOR-COVERAGE ASSERTIONS PASS`);
