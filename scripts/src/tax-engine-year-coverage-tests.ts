/**
 * Tax-year FRESHNESS / coverage suite (no API).
 *
 * Purpose: make a MISSING or STALE tax year fail CI loudly instead of silently
 * returning a wrong number. This is the runtime half of the freshness guarantee;
 * the compile-time half is the `Record<TaxYear>` typing on every year-indexed map
 * (a missing supported-year key is a build error). Here we assert that for EVERY
 * year in SUPPORTED_TAX_YEARS:
 *   T1  — every public year-indexed engine function returns a finite, sane value
 *         (no throw, no NaN, no undefined), and the whole pipeline runs.
 *   T1b — inflation-indexed values are strictly monotonic across years (catches a
 *         "copied last year's number into the new slot and forgot to bump it" bug,
 *         which a presence check alone would miss).
 *   T4  — registry invariants (SUPPORTED sorted/unique, LATEST in range) and
 *         resolveTaxYear clamping behavior, plus a next-year-readiness note.
 *   REG — TY2026 published-value regressions for the three live bugs fixed in the
 *         2026-06 freshness pass (G1.23 bonus 100%, G1.96 transit $340, G1.26 IRA
 *         $7,500 / $8,600), asserted against the exact IRS source values.
 *
 * When a new tax year is activated (append it to SUPPORTED_TAX_YEARS), every loop
 * below automatically exercises it — so this file is the canary that flags any
 * year-indexed map still missing its new key.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-year-coverage-tests.ts
 */

import {
  SUPPORTED_TAX_YEARS,
  LATEST_YEAR,
  resolveTaxYear,
  getFederalStandardDeduction,
  getFederalBracketBreakpoints,
  getSaltCap,
  calculateFederalTax,
  calculateStateTax,
  SS_WAGE_BASE,
  KIDDIE_TAX_THRESHOLD,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import { STATE_TAX_DATA_BY_YEAR } from "../../artifacts/api-server/src/lib/stateTaxData";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { evaluatePlanningOpportunities } from "../../artifacts/api-server/src/lib/planningEngine";
import type { OpportunityHit } from "@workspace/planning-strategies";

const PASS: string[] = [];
const FAIL: string[] = [];

function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}${detail ? `: ${detail}` : ""}`);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function finitePos(label: string, v: number): void {
  ok(label, Number.isFinite(v) && v > 0, `expected finite > 0, got ${v}`);
}
function header(t: string): void { console.log(`\n-- ${t} --`); }

const FILING_STATUSES = [
  "single",
  "married_filing_jointly",
  "married_filing_separately",
  "head_of_household",
  "qualifying_widow",
] as const;

// ============================================================================
// T1 — every public year-indexed function returns a sane value for every year
// ============================================================================
header("T1 — public year-indexed engine surface covers every SUPPORTED_TAX_YEARS year");
for (const y of SUPPORTED_TAX_YEARS) {
  for (const fs of FILING_STATUSES) {
    finitePos(`getFederalStandardDeduction(${fs}, ${y})`, getFederalStandardDeduction(fs, y));

    const bp = getFederalBracketBreakpoints(fs, y);
    ok(`getFederalBracketBreakpoints(${fs}, ${y}) has ≥6 ascending breakpoints`,
      Array.isArray(bp) && bp.length >= 6 && bp.every((v, i) => i === 0 || v > bp[i - 1]),
      `got ${JSON.stringify(bp)}`);

    finitePos(`calculateFederalTax($100k, ${fs}, ${y})`, calculateFederalTax(100000, fs, y));
  }

  // SALT cap: low-MAGI single returns the base cap (TCJA $10k for 2024, OBBBA $40k+ for 2025+)
  finitePos(`getSaltCap(${y}, single, $40k MAGI)`, getSaltCap(y, "single", 40000));

  // A state that always has income tax (CA) must produce positive, finite tax.
  finitePos(`calculateStateTax($80k, CA, single, ${y})`, calculateStateTax(80000, "CA", "single", y));

  // Year-indexed exported maps must have a present, sane value for this year.
  ok(`SS_WAGE_BASE has key ${y}`, y in SS_WAGE_BASE);
  finitePos(`SS_WAGE_BASE[${y}]`, SS_WAGE_BASE[y]);
  ok(`KIDDIE_TAX_THRESHOLD has key ${y}`, y in KIDDIE_TAX_THRESHOLD);
  finitePos(`KIDDIE_TAX_THRESHOLD[${y}]`, KIDDIE_TAX_THRESHOLD[y]);

  // State-data table must cover the year with the full 50 states + DC.
  const yearData = STATE_TAX_DATA_BY_YEAR[y];
  ok(`STATE_TAX_DATA_BY_YEAR[${y}] present with ≥50 jurisdictions`,
    yearData != null && Object.keys(yearData).length >= 50,
    `got ${yearData ? Object.keys(yearData).length : "undefined"} keys`);

  // Whole-pipeline smoke: a representative single filer with $150k W-2 must
  // produce a finite, positive federal tax for the year (exercises brackets,
  // std ded, AMT, NIIT, EITC, SS wage base, etc. for that year end-to-end).
  const computed = computeTaxReturnPure({
    w2s: [{ taxYear: y, wagesBox1: 150000, stateCode: "CA" } as unknown as TaxReturnInputs["w2s"][number]],
    form1099s: [],
    adjustments: [],
    taxYear: y,
    client: { filingStatus: "single", state: "CA", taxYear: y } as TaxReturnInputs["client"],
  });
  eq(`computeTaxReturnPure(${y}) AGI = $150k`, Math.round(computed.adjustedGrossIncome), 150000);
  finitePos(`computeTaxReturnPure(${y}) federalTaxLiability`, computed.federalTaxLiability);
  eq(`computeTaxReturnPure(${y}) taxYear echoes`, computed.taxYear, y);
}

// ============================================================================
// T1b — inflation-indexed values are STRICTLY monotonic across the supported
// years. A stale copy (forgot to bump the new year) would leave two years equal,
// which strict `>` catches; a presence check would not.
// ============================================================================
header("T1b — inflation-indexed values strictly increase year over year");
const sortedYears = [...SUPPORTED_TAX_YEARS].sort((a, b) => a - b);
for (let i = 1; i < sortedYears.length; i++) {
  const prev = sortedYears[i - 1];
  const cur = sortedYears[i];

  ok(`single std deduction ${cur} > ${prev}`,
    getFederalStandardDeduction("single", cur) > getFederalStandardDeduction("single", prev),
    `${getFederalStandardDeduction("single", cur)} vs ${getFederalStandardDeduction("single", prev)}`);

  ok(`SS wage base ${cur} > ${prev}`,
    SS_WAGE_BASE[cur] > SS_WAGE_BASE[prev],
    `${SS_WAGE_BASE[cur]} vs ${SS_WAGE_BASE[prev]}`);

  // Kiddie threshold is non-decreasing (can be flat year to year — $2,700 for
  // both 2025 and 2026 — but must never go DOWN).
  ok(`kiddie threshold ${cur} ≥ ${prev}`,
    KIDDIE_TAX_THRESHOLD[cur] >= KIDDIE_TAX_THRESHOLD[prev],
    `${KIDDIE_TAX_THRESHOLD[cur]} vs ${KIDDIE_TAX_THRESHOLD[prev]}`);
}

// ============================================================================
// T4 — registry invariants + resolveTaxYear clamping + next-year readiness
// ============================================================================
header("T4 — tax-year registry invariants + resolveTaxYear behavior");
ok("SUPPORTED_TAX_YEARS strictly ascending & unique",
  SUPPORTED_TAX_YEARS.every((v, i) => i === 0 || v > SUPPORTED_TAX_YEARS[i - 1]));
ok("LATEST_YEAR is a member of SUPPORTED_TAX_YEARS",
  (SUPPORTED_TAX_YEARS as readonly number[]).includes(LATEST_YEAR));

eq("resolveTaxYear(null) = LATEST_YEAR", resolveTaxYear(null), LATEST_YEAR);
eq("resolveTaxYear(undefined) = LATEST_YEAR", resolveTaxYear(undefined), LATEST_YEAR);
for (const y of SUPPORTED_TAX_YEARS) {
  eq(`resolveTaxYear(${y}) = ${y} (identity for supported years)`, resolveTaxYear(y), y);
}
eq("resolveTaxYear(1999) clamps to earliest supported (2024)", resolveTaxYear(1999), sortedYears[0]);
eq("resolveTaxYear(3000) clamps to LATEST_YEAR", resolveTaxYear(3000), LATEST_YEAR);

// ============================================================================
// REG — TY2026 published-value regressions for the 2026-06 freshness bug fixes.
// Each asserts the exact IRS source value via an observable on the detector hit.
// ============================================================================
header("REG — TY2026 live-bug published-value regressions");

function runPlanning(
  inputs: Partial<TaxReturnInputs> & { client: TaxReturnInputs["client"] },
): OpportunityHit[] {
  const computed = computeTaxReturnPure({
    w2s: [], form1099s: [], adjustments: [],
    taxYear: inputs.client.taxYear ?? 2024,
    ...inputs,
  });
  return evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments ?? [],
  });
}
const findHit = (hits: OpportunityHit[], id: string) => hits.find((h) => h.strategyId === id);

// G1.23 cost-seg — OBBBA restored 100% bonus depreciation for TY2026 (§70301).
// bonusRate observable: 0.60 (2024) / 0.40 (2025) / 1.00 (2026).
for (const [yr, expectBonus] of [[2024, 0.6], [2025, 0.4], [2026, 1.0]] as const) {
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: yr } as TaxReturnInputs["client"],
    w2s: [{ taxYear: yr, wagesBox1: 120000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
    adjustments: [
      { adjustmentType: "schedule_e_rental_income", amount: 200000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
    ],
  });
  const hit = findHit(hits, "G1.23");
  ok(`G1.23 fires TY${yr}`, hit != null);
  if (hit) eq(`G1.23 bonusRate TY${yr} = ${expectBonus}`, Number(hit.inputs.bonusRate), expectBonus);
}

// G1.96 §132(f) transit — monthlyCap observable: $315 (2024) / $325 (2025) / $340 (2026, Rev. Proc. 2025-32).
for (const [yr, expectCap] of [[2024, 315], [2025, 325], [2026, 340]] as const) {
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: yr } as TaxReturnInputs["client"],
    w2s: [{ taxYear: yr, wagesBox1: 80000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
  });
  const hit = findHit(hits, "G1.96");
  ok(`G1.96 fires TY${yr}`, hit != null);
  if (hit) eq(`G1.96 monthlyCap TY${yr} = $${expectCap}`, Number(hit.inputs.monthlyCap), expectCap);
}

// G1.26 backdoor Roth — contribAmount observable = IRA contribution limit for the
// year. Under-50 base: $7,000 (2024/2025) / $7,500 (2026, Notice 2025-67).
for (const [yr, expectBase] of [[2024, 7000], [2025, 7000], [2026, 7500]] as const) {
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: yr, taxpayerAge: 45 } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: yr, wagesBox1: 250000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
  });
  const hit = findHit(hits, "G1.26");
  ok(`G1.26 fires TY${yr} (under 50)`, hit != null);
  if (hit) eq(`G1.26 contribAmount TY${yr} (base) = $${expectBase}`, Number(hit.inputs.contribAmount), expectBase);
}
// Age 50+ catch-up: $8,000 (2024/2025) / $8,600 (2026, $7,500 + $1,100 catch-up).
for (const [yr, expectCatchup] of [[2024, 8000], [2025, 8000], [2026, 8600]] as const) {
  const hits = runPlanning({
    client: { filingStatus: "single", state: "FL", taxYear: yr, taxpayerAge: 55 } as unknown as TaxReturnInputs["client"],
    w2s: [{ taxYear: yr, wagesBox1: 250000, stateCode: "FL" } as unknown as TaxReturnInputs["w2s"][number]],
  });
  const hit = findHit(hits, "G1.26");
  ok(`G1.26 fires TY${yr} (50+)`, hit != null);
  if (hit) eq(`G1.26 contribAmount TY${yr} (catch-up) = $${expectCatchup}`, Number(hit.inputs.contribAmount), expectCatchup);
}

// ============================================================================
console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (year-coverage / freshness)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL YEAR-COVERAGE / FRESHNESS ASSERTIONS PASS`);
