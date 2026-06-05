/**
 * Planning-catalog FRESHNESS suite (T2, no API).
 *
 * The catalog's `validUntil` field drives PLAN-08: a strategy stops surfacing
 * once the return's tax year is past its validUntil year. That makes validUntil
 * a silent-staleness risk — if a strategy for a PERMANENT IRC provision carries a
 * near-term validUntil, it vanishes the moment the filing year rolls past it.
 *
 * This suite is the tripwire. Core invariants:
 *   F1 — every strategy validUntil is a well-formed year >= 2024.
 *   F2 — NO strategy is expired for the CURRENT filing year (LATEST_YEAR). If a
 *        validUntil ever drops below the current filing year, CI fails loudly.
 *   F3 — the genuine OBBBA sunsets keep their REAL dates (clean-energy credits
 *        expire after 2025; tips/OT/car-loan/senior deductions after 2028) so the
 *        gate still suppresses them on schedule.
 *   F4 — a permanence FLOOR: the large majority of strategies are validUntil
 *        2099 (permanent IRC). Catches accidental re-introduction of the
 *        "authored-year == validUntil" time-bomb that the 2026-06 refresh removed.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-catalog-freshness-tests.ts
 */

import { CATALOG_V1 } from "@workspace/planning-strategies";
import {
  isStrategyExpiredForYear,
} from "../../artifacts/api-server/src/lib/planningEngine";
import {
  LATEST_YEAR,
  SUPPORTED_TAX_YEARS,
} from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}${detail ? `: ${detail}` : ""}`);
}
function header(t: string): void { console.log(`\n-- ${t} --`); }

const strategies = CATALOG_V1.strategies;
const yearOf = (validUntil: string) => Number(String(validUntil).slice(0, 4));
const byId = (id: string) => strategies.find((s) => s.id === id);

header("Catalog structural sanity");
ok("catalog has a version string", typeof CATALOG_V1.version === "string" && CATALOG_V1.version.length > 0);
ok("catalog has >= 100 strategies", strategies.length >= 100, `got ${strategies.length}`);

// ── F1 — every validUntil is a well-formed year >= 2024 ─────────────────────
header("F1 — every validUntil is a well-formed year >= 2024");
{
  let bad = 0;
  for (const s of strategies) {
    const y = yearOf(s.validUntil);
    if (!(Number.isInteger(y) && y >= 2024)) {
      bad++;
      FAIL.push(`✗ F1 ${s.id} has malformed/old validUntil "${s.validUntil}"`);
    }
  }
  ok("F1 — all strategies have a valid validUntil year >= 2024", bad === 0, `${bad} bad`);
}

// ── F2 — NO strategy is expired for the current filing year (LATEST_YEAR) ────
header(`F2 — no strategy expired for the current filing year (LATEST_YEAR=${LATEST_YEAR})`);
{
  const expiredNow = strategies.filter((s) => isStrategyExpiredForYear(s.validUntil, LATEST_YEAR));
  ok(`F2 — every strategy is live for TY${LATEST_YEAR}`, expiredNow.length === 0,
    `expired: ${expiredNow.map((s) => `${s.id}(${s.validUntil})`).join(", ")}`);
}

// ── F3 — genuine OBBBA sunsets keep their real, schedule-accurate dates ──────
header("F3 — genuine OBBBA sunsets keep real dates (gate still fires on schedule)");
{
  // Clean-energy / clean-vehicle credits: OBBBA repeals §25C/§25D after 2025-12-31
  // and §30D/§25E after 2025-09-30. They must be LIVE for TY2025, EXPIRED for TY2026.
  for (const id of ["G1.33", "G1.34", "G1.37"]) {
    const s = byId(id);
    ok(`F3 — ${id} exists`, s != null);
    if (s) {
      ok(`F3 — ${id} (energy) live TY2025`, !isStrategyExpiredForYear(s.validUntil, 2025), s.validUntil);
      ok(`F3 — ${id} (energy) EXPIRED TY2026`, isStrategyExpiredForYear(s.validUntil, 2026), s.validUntil);
    }
  }
  // OBBBA tips/overtime/car-loan/senior deductions (§224/§225/§163(h)(4)/§151(d))
  // run TY2025-2028: LIVE for TY2028, EXPIRED for TY2029.
  for (const id of ["G1.97", "G1.98", "G1.99", "G1.100"]) {
    const s = byId(id);
    ok(`F3 — ${id} exists`, s != null);
    if (s) {
      ok(`F3 — ${id} (OBBBA deduction) live TY2028`, !isStrategyExpiredForYear(s.validUntil, 2028), s.validUntil);
      ok(`F3 — ${id} (OBBBA deduction) EXPIRED TY2029`, isStrategyExpiredForYear(s.validUntil, 2029), s.validUntil);
    }
  }
}

// ── F4 — permanence floor: the bulk of the catalog is validUntil 2099 ───────
header("F4 — permanence floor (no re-introduction of the authored-year time-bomb)");
{
  const permanent = strategies.filter((s) => yearOf(s.validUntil) >= 2099);
  ok("F4 — >= 90 strategies are validUntil 2099 (permanent IRC provisions)",
    permanent.length >= 90, `got ${permanent.length}`);

  // None of the LATEST supported year's permanent strategies should be expired
  // for the newest supported tax year (the engine natively computes it).
  const latestSupported = Math.max(...SUPPORTED_TAX_YEARS);
  const permanentExpiredAtNewest = permanent.filter((s) => isStrategyExpiredForYear(s.validUntil, latestSupported));
  ok(`F4 — no permanent strategy expired for TY${latestSupported}`, permanentExpiredAtNewest.length === 0,
    permanentExpiredAtNewest.map((s) => s.id).join(", "));

  // §199A permanence (OBBBA) sanity — these are the canonical permanent strategies.
  for (const id of ["G1.7", "G1.88", "G1.89"]) {
    const s = byId(id);
    ok(`F4 — ${id} (§199A) validUntil >= 2099`, s != null && yearOf(s.validUntil) >= 2099, s?.validUntil);
  }
}

console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (catalog freshness)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL CATALOG-FRESHNESS ASSERTIONS PASS`);
