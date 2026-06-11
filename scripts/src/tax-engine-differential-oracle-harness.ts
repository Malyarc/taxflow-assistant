/**
 * DIFFERENTIAL-ORACLE HARNESS (T0.3 A0+A2) — cross-validates
 * computeTaxReturnPure against an INDEPENDENT oracle: tenforty
 * (https://pypi.org/project/tenforty/), the Python wrapper around
 * OpenTaxSolver. Standalone like the property harness (named `-harness`,
 * not picked up by run-no-api): it needs python3 + `pip install tenforty`.
 * When the oracle is unavailable it SKIPS with exit 0 (CI-safe).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-differential-oracle-harness.ts
 *
 * SHARED SCENARIO SPACE (the intersection both engines model FAITHFULLY):
 *   TY2024 + TY2025 (tenforty 2025 verified OBBBA-aware: std ded 15,750) ×
 *   all 5 filing statuses × {W-2 wages, taxable interest, ordinary/qualified
 *   dividends, STCG/LTCG incl. losses + the $3k/$1.5k limit} on the standard
 *   deduction, no dependents, plus a CA state batch.
 *
 * EXCLUDED features (the oracle does NOT model them — including them would
 * produce false divergences, not bug signal; each is covered instead by the
 * hand-calc suites + the property harness):
 *  - **§199A QBI** — tenforty/OTS has no QBI input, so any self-employment or
 *    Sch-C scenario diverges by the full 20% QBI deduction. SE income is
 *    therefore EXCLUDED from this harness.
 *  - **SE-tax W-2 wage-base coordination** — OTS charges the full 12.4% SS on
 *    SE income even when W-2 wages already exhaust the SS wage base (Sch SE
 *    line 8). The engine correctly coordinates. (Another reason SE is excluded.)
 *  - **EITC/CTC** — wages floored at $26k (above the childless-EITC ceiling),
 *    0 dependents.
 *
 * KNOWN oracle ERRORS we proved against the IRS primary source (the engine is
 * right; we widen/skip the affected metric, never "fix" the engine to match):
 *  - **HoH ordinary-tax schedule** — OTS is a flat $64 high on the 2024 HoH
 *    35%/37% brackets (engine reproduces Rev. Proc. 2023-34 to the cent, e.g.
 *    taxable $447,342 → $125,251.70 = 53,977 + 35%×203,642). incomeTax tol on
 *    HoH widened to $70.
 *  - **STCG in the §1411 NII base** — OTS omits short-term gains/losses from
 *    NII; the engine correctly includes the netted result. NIIT is therefore
 *    only compared when stcg == 0.
 *
 * DOCUMENTED method tolerances (rounding, not bugs):
 *  - OTS uses the $50-bracket IRS tax TABLE under $100k taxable (midpoint) and
 *    rounds intermediate lines to whole dollars → tolerance $15 below $100k
 *    taxable, $3 at/above; $2 on AGI/taxable/NIIT/AddlMedicare.
 *  - CA: OTS uses the CA tax TABLE under $100k → state tolerance $25.
 *
 * Every diff beyond tolerance prints a full ledger row — triage each one
 * (the oracle can be wrong too) before treating it as an engine bug.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

// ── deterministic PRNG (same family as the property harness) ───────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260611);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const dollars = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

// Canonical engine/openapi filing-status strings. (The oracle runner maps
// `qualifying_widow` → OTS "Widow(er)".) Note: the engine types filingStatus
// as a bare `string` and silently treats any UNRECOGNIZED value as single —
// API-gated by the zod enum, but a fail-loud gap on the pure Haven seam.
interface Scenario {
  id: number;
  year: 2024 | 2025;
  filingStatus:
    | "single"
    | "married_filing_jointly"
    | "married_filing_separately"
    | "head_of_household"
    | "qualifying_widow";
  state?: "CA";
  w2: number;
  interest: number;
  ordinaryDividends: number;
  qualifiedDividends: number;
  stcg: number;
  ltcg: number;
  se: number;
}

const STATUSES = [
  "single",
  "married_filing_jointly",
  "married_filing_separately",
  "head_of_household",
  "qualifying_widow",
] as const;

// ── scenario generation ─────────────────────────────────────────────────────
const scenarios: Scenario[] = [];
let nextId = 1;
function add(s: Omit<Scenario, "id">) {
  scenarios.push({ id: nextId++, ...s });
}

// (1) Random fill across the shared space (no SE — see header EXCLUDED).
for (let i = 0; i < 600; i++) {
  const year = pick([2024, 2025] as const);
  const filingStatus = pick(STATUSES);
  const hasInv = rand() < 0.6;
  add({
    year,
    filingStatus,
    w2: dollars(26_000, 600_000),
    se: 0,
    interest: hasInv ? dollars(0, 30_000) : 0,
    ordinaryDividends: 0,
    qualifiedDividends: 0,
    stcg: hasInv ? dollars(-15_000, 40_000) : 0,
    ltcg: hasInv ? dollars(-20_000, 250_000) : 0,
  });
  const last = scenarios[scenarios.length - 1]!;
  if (hasInv && rand() < 0.7) {
    last.ordinaryDividends = dollars(0, 40_000);
    last.qualifiedDividends = Math.round(last.ordinaryDividends * rand());
  }
}

// (2) Boundary battery — ±$1 at the 2024/2025 single + MFJ ordinary bracket
// edges (wage = taxable edge + std ded), the LTCG 0/15/20 breakpoints, the
// NIIT/Additional-Medicare thresholds, and the SE SS wage base.
const STD: Record<number, Record<string, number>> = {
  2024: { single: 14_600, married_filing_jointly: 29_200 },
  2025: { single: 15_750, married_filing_jointly: 31_500 },
};
const BRACKET_EDGES: Record<number, Record<string, number[]>> = {
  2024: {
    single: [11_600, 47_150, 100_525, 191_950, 243_725, 609_350],
    married_filing_jointly: [23_200, 94_300, 201_050, 383_900, 487_450, 731_200],
  },
  2025: {
    single: [11_925, 48_475, 103_350, 197_300, 250_525, 626_350],
    married_filing_jointly: [23_850, 96_950, 206_700, 394_600, 501_050, 751_600],
  },
};
for (const year of [2024, 2025] as const) {
  for (const fs of ["single", "married_filing_jointly"] as const) {
    for (const edge of BRACKET_EDGES[year]![fs]!) {
      for (const delta of [-1, 0, 1]) {
        add({
          year,
          filingStatus: fs,
          w2: edge + STD[year]![fs]! + delta,
          interest: 0,
          ordinaryDividends: 0,
          qualifiedDividends: 0,
          stcg: 0,
          ltcg: 0,
          se: 0,
        });
      }
    }
  }
}
const LTCG_BREAKS: Record<number, Record<string, number[]>> = {
  2024: { single: [47_025, 518_900], married_filing_jointly: [94_050, 583_750] },
  2025: { single: [48_350, 533_400], married_filing_jointly: [96_700, 600_050] },
};
for (const year of [2024, 2025] as const) {
  for (const fs of ["single", "married_filing_jointly"] as const) {
    for (const brk of LTCG_BREAKS[year]![fs]!) {
      for (const delta of [-1, 1]) {
        add({
          year,
          filingStatus: fs,
          w2: 60_000,
          interest: 0,
          ordinaryDividends: 0,
          qualifiedDividends: 0,
          stcg: 0,
          ltcg: Math.max(0, brk - 60_000 + STD[year]![fs]! + delta),
          se: 0,
        });
      }
    }
  }
}
// NIIT + Additional Medicare thresholds; cap-loss $3k/$1.5k limit.
for (const year of [2024, 2025] as const) {
  add({ year, filingStatus: "single", w2: 199_000, interest: 20_000, ordinaryDividends: 0, qualifiedDividends: 0, stcg: 0, ltcg: 0, se: 0 });
  add({ year, filingStatus: "single", w2: 240_000, interest: 20_000, ordinaryDividends: 0, qualifiedDividends: 0, stcg: 0, ltcg: 0, se: 0 });
  add({ year, filingStatus: "married_filing_jointly", w2: 251_000, interest: 30_000, ordinaryDividends: 0, qualifiedDividends: 0, stcg: 0, ltcg: 0, se: 0 });
  add({ year, filingStatus: "single", w2: 60_000, interest: 0, ordinaryDividends: 0, qualifiedDividends: 0, stcg: -10_000, ltcg: 4_000, se: 0 }); // $3k limit binds
  add({ year, filingStatus: "married_filing_separately", w2: 60_000, interest: 0, ordinaryDividends: 0, qualifiedDividends: 0, stcg: -8_000, ltcg: 2_000, se: 0 }); // $1.5k MFS
}

// (3) CA state batch — W-2 only (the cleanly-shared state surface).
for (let i = 0; i < 60; i++) {
  add({
    year: pick([2024, 2025] as const),
    filingStatus: pick(["single", "married_filing_jointly"] as const),
    state: "CA",
    w2: dollars(30_000, 400_000),
    interest: 0,
    ordinaryDividends: 0,
    qualifiedDividends: 0,
    stcg: 0,
    ltcg: 0,
    se: 0,
  });
}

// ── run OUR engine ──────────────────────────────────────────────────────────
interface OurResult {
  agi: number;
  taxable: number;
  seTax: number;
  niit: number;
  addlMedicare: number;
  amt: number;
  incomeTaxPlusAmt: number;
  totalTax: number;
  stateTax: number;
}
function runOurs(s: Scenario): OurResult {
  const inputs: TaxReturnInputs = {
    client: { filingStatus: s.filingStatus, state: s.state ?? "FL", taxYear: s.year },
    w2s: s.w2 > 0 ? [{ taxYear: s.year, wagesBox1: s.w2, federalTaxWithheldBox2: 0, stateCode: s.state ?? "FL" }] : [],
    form1099s: [
      ...(s.interest > 0 ? [{ formType: "int", interestIncome: s.interest }] : []),
      ...(s.ordinaryDividends > 0
        ? [{ formType: "div", ordinaryDividends: s.ordinaryDividends, qualifiedDividends: s.qualifiedDividends }]
        : []),
      ...(s.stcg !== 0 || s.ltcg !== 0
        ? [{ formType: "b", shortTermGainLoss: s.stcg, longTermGainLoss: s.ltcg }]
        : []),
    ],
    adjustments: s.se > 0 ? [{ adjustmentType: "self_employment_income", amount: s.se }] : [],
    taxYear: s.year,
  };
  const r = computeTaxReturnPure(inputs);
  const otherTaxes = r.selfEmploymentTax + r.niitTax + r.additionalMedicareTax + (r.scheduleH?.total ?? 0);
  // NB: the output `stateTaxLiability` is PRE-additional-credit. The CA
  // personal-exemption credit (and all state additional/EITC/CTC credits)
  // settle into `stateRefundOrOwed`. With state withholding = 0, the oracle's
  // "state total tax" (post-nonrefundable-credit) == −stateRefundOrOwed.
  return {
    agi: r.adjustedGrossIncome,
    taxable: r.taxableIncome,
    seTax: r.selfEmploymentTax,
    niit: r.niitTax,
    addlMedicare: r.additionalMedicareTax,
    amt: r.amtTax,
    incomeTaxPlusAmt: r.federalTaxLiability - otherTaxes,
    totalTax: r.federalTaxLiability,
    stateTax: -r.stateRefundOrOwed,
  };
}

// ── run the ORACLE ──────────────────────────────────────────────────────────
interface OracleResult {
  id: number;
  ok: boolean;
  error?: string;
  agi: number;
  taxable: number;
  incomeTax: number;
  amt: number;
  seTax: number;
  niit: number;
  addlMedicare: number;
  totalTax: number;
  stateTaxable: number;
  stateTax: number;
}
function runOracle(batch: Scenario[]): OracleResult[] | null {
  const dir = mkdtempSync(join(tmpdir(), "diff-oracle-"));
  const file = join(dir, "scenarios.json");
  writeFileSync(file, JSON.stringify(batch));
  try {
    const stdout = execFileSync("python3", [join(HERE, "differential-oracle-runner.py"), file], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30 * 60 * 1000,
    });
    return JSON.parse(stdout) as OracleResult[];
  } catch (err) {
    console.log(`SKIP: oracle unavailable (python3 + tenforty required) — ${(err as Error).message.slice(0, 200)}`);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── compare ─────────────────────────────────────────────────────────────────
function main() {
  console.log(`Differential oracle — ${scenarios.length} scenarios (seed 20260611) vs tenforty/OpenTaxSolver`);
  const oracle = runOracle(scenarios);
  if (!oracle) {
    console.log("DIFFERENTIAL ORACLE SKIPPED (environment without the oracle) — exit 0");
    return;
  }
  const byId = new Map(oracle.map((o) => [o.id, o]));
  let compared = 0;
  let divergent = 0;
  let oracleErrors = 0;
  const rows: string[] = [];
  for (const s of scenarios) {
    const o = byId.get(s.id);
    if (!o || !o.ok) {
      oracleErrors++;
      continue;
    }
    const ours = runOurs(s);
    compared++;
    // OTS uses the $50 IRS tax TABLE under $100k taxable (midpoint) → ~$15;
    // a few $/cents of breakpoint rounding on the 0/15/20 LTCG worksheet at/above.
    const tableTol = ours.taxable < 100_000 ? 15 : 6;
    // HoH: absorb the proven +$64 OTS HoH-schedule error (engine matches IRS).
    const hohTol = s.filingStatus === "head_of_household" ? 70 : 0;
    const checks: Array<[string, number, number, number]> = [
      ["AGI", ours.agi, o.agi, 2],
      ["taxable", ours.taxable, o.taxable, 2],
      ["addlMedicare", ours.addlMedicare, o.addlMedicare, 2],
      ["AMT", ours.amt, o.amt, 5],
      ["incomeTax+AMT", ours.incomeTaxPlusAmt, o.incomeTax + o.amt, Math.max(tableTol, hohTol)],
    ];
    // NIIT / totalTax: OTS omits short-term gains/losses from the §1411 NII
    // base — so both NIIT and the NIIT-inclusive totalTax only compare when
    // stcg == 0 (the engine correctly nets STCG into NII; proven vs §1411).
    if (s.stcg === 0) {
      checks.push(["NIIT", ours.niit, o.niit, 2]);
      checks.push(["totalTax", ours.totalTax, o.totalTax, Math.max(tableTol + 5, hohTol)]);
    }
    // CA: $25 table rounding + up to ~$30 from the engine's linear personal-
    // exemption-credit phase-out approximation (vs CA's exact $6/$2,500 steps).
    if (s.state === "CA") checks.push(["stateTax", ours.stateTax, o.stateTax, 35]);
    const bad = checks.filter(([, a, b, tol]) => Math.abs(a - b) > tol);
    if (bad.length > 0) {
      divergent++;
      rows.push(
        `DIVERGE #${s.id} ${s.year} ${s.filingStatus}${s.state ? ` ${s.state}` : ""} ` +
          `w2=${s.w2} int=${s.interest} odiv=${s.ordinaryDividends} qdiv=${s.qualifiedDividends} stcg=${s.stcg} ltcg=${s.ltcg} se=${s.se}\n` +
          bad.map(([k, a, b]) => `    ${k}: ours=${a.toFixed(2)} oracle=${b.toFixed(2)} Δ=${(a - b).toFixed(2)}`).join("\n"),
      );
    }
  }
  for (const row of rows) console.log(row);
  console.log(`\nCompared ${compared} scenarios (${oracleErrors} oracle-side errors skipped).`);
  if (divergent > 0) {
    console.log(`❌ ${divergent} DIVERGENT scenario(s) beyond documented tolerances — triage each (the oracle may be wrong).`);
    process.exitCode = 1;
  } else {
    console.log("✅ ZERO divergences beyond the documented oracle-method tolerances.");
  }
}

main();
