/**
 * MACHINE-DRIVEN audit harness (T0.3 Phase A1) — property-based + fuzzing +
 * boundary + metamorphic. Uses fast-check to exercise `computeTaxReturnPure`
 * across a wide random input space and assert invariants that must hold for
 * EVERY input (the safety-critical-numerics standard — finds what the
 * hand-picked assertion authors didn't think of).
 *
 * NO database / NO API. Run standalone:
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-property-harness.ts
 *
 * Deterministic (fixed seed) so a failure reproduces. Named *-harness (not
 * *-tests) so it is NOT auto-included in the no-API battery until it is green;
 * once the bugs it surfaces are fixed it can be renamed to join CI.
 */
import fc from "fast-check";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

let runCount = 0;
const VIOLATIONS: string[] = [];
function runProp(label: string, body: () => void) {
  try { body(); console.log(`  ✓ ${label}`); }
  catch (e) { const m = (e as Error).message?.split("\n").slice(0, 6).join("\n"); VIOLATIONS.push(`✗ ${label}\n${m}`); console.log(`  ✗ ${label} — VIOLATION`); }
}

// ── deep finite walk ────────────────────────────────────────────────────────
// Every numeric leaf of a ComputedTaxReturn MUST be finite. A NaN/Infinity
// reaching a dollar field is a fail-loud violation (silent garbage tax number).
// `premiumTaxCredit.repaymentCap` is a DELIBERATE +Infinity sentinel meaning
// "no §36B(f)(2)(B) repayment limitation" (income ≥ 400% FPL — the full APTC is
// repayable, uncapped). Every consumer gates it with Number.isFinite() and JSON
// serializes it to null, so it is correctly handled — exclude it from the
// "no unintentional non-finite output" property.
const FINITE_SENTINEL_KEYS = new Set(["repaymentCap"]);
function firstNonFinite(obj: unknown, path = "", key = ""): string | null {
  if (typeof obj === "number") {
    if (FINITE_SENTINEL_KEYS.has(key)) return null;
    return Number.isFinite(obj) ? null : `${path} = ${obj}`;
  }
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const r = firstNonFinite(obj[i], `${path}[${i}]`, "");
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      const r = firstNonFinite((obj as Record<string, unknown>)[k], path ? `${path}.${k}` : k, k);
      if (r) return r;
    }
  }
  return null;
}

const FILING = [
  "single", "married_filing_jointly", "married_filing_separately",
  "head_of_household", "qualifying_widow",
];
const STATES = ["FL", "TX", "WA", "CA", "NY", "PA", "NJ", "IL", "MA", "CO", "OH", "GA", "NC", "VA", "MN", "AZ"];
const YEARS = [2024, 2025, 2026];
const F1099 = ["nec", "misc", "int", "div", "b", "r", "g", "k"];
const ADJ = [
  "ira_deduction", "hsa_contribution", "student_loan_interest", "self_employment_income",
  "mortgage_interest", "state_property_tax", "charitable_cash", "qualified_dividends",
  "long_term_capital_gain", "unrecaptured_section_1250_gain", "collectibles_28_rate_gain",
  "social_security_benefits", "nol_carryforward", "k1_ordinary_business_income",
];

// ── invariant checks on a computed return — returns [] or a single violation ─
function checkInvariants(inputs: TaxReturnInputs): string | null {
  runCount++;
  let r: ReturnType<typeof computeTaxReturnPure>;
  try {
    r = computeTaxReturnPure(inputs);
  } catch (e) {
    return `THREW: ${(e as Error).message?.slice(0, 140)}`;
  }
  // (1) every numeric output finite — the killer fuzz invariant
  const nf = firstNonFinite(r);
  if (nf) return `NON-FINITE OUTPUT ${nf}`;
  // (2) non-negativity
  const nn: Array<[string, number]> = [
    ["taxableIncome", r.taxableIncome], ["federalTaxLiability", r.federalTaxLiability],
    ["standardDeduction", r.standardDeduction], ["selfEmploymentTax", r.selfEmploymentTax],
    ["niitTax", r.niitTax], ["amtTax", r.amtTax], ["additionalMedicareTax", r.additionalMedicareTax],
    ["capitalGainsTax", r.capitalGainsTax], ["qbiDeduction", r.qbiDeduction],
  ];
  for (const [k, v] of nn) {
    if (Number.isFinite(v) && v < -0.5) return `NEGATIVE ${k}=${v.toFixed(2)}`;
  }
  // (3) AGI >= taxable income (taxable is AGI net of deductions, floored >= 0)
  if (Number.isFinite(r.adjustedGrossIncome) && Number.isFinite(r.taxableIncome) &&
      r.adjustedGrossIncome >= 0 && r.taxableIncome > r.adjustedGrossIncome + 1) {
    return `taxable ${r.taxableIncome.toFixed(2)} > AGI ${r.adjustedGrossIncome.toFixed(2)}`;
  }
  // (4) effective rate MUST be finite for every input. The sane-band check
  // only applies at MEANINGFUL income: at near-zero income a refundable credit
  // (EITC/CTC/state CTC) legitimately exceeds income → a large-magnitude (but
  // correct) negative rate (e.g. $1 income + a refundable child credit). That is
  // a tiny-denominator artifact, not an engine bug, so the band is income-gated.
  if (!Number.isFinite(r.effectiveTaxRate)) {
    return `effectiveTaxRate non-finite = ${r.effectiveTaxRate}`;
  }
  if (r.totalIncome >= 10000 && (r.effectiveTaxRate > 1.5 || r.effectiveTaxRate < -2)) {
    return `effectiveTaxRate out of band = ${r.effectiveTaxRate} (income ${r.totalIncome.toFixed(0)})`;
  }
  return null;
}

// fast-check arbitraries ------------------------------------------------------
const money = fc.oneof(
  fc.double({ min: 0, max: 500_000, noNaN: true }),
  fc.double({ min: 0, max: 5_000_000, noNaN: true }),
  fc.constant(0),
);
// fuzz money: extremes, negatives, and (via Numish) strings/nulls
const fuzzMoney = fc.oneof(
  fc.double({ min: -1e6, max: 1e9, noNaN: true }),
  fc.constant(1e308), fc.constant(-1e308), fc.constant(1e15),
  fc.constant(0), fc.constant(0.005),
  fc.string().map((s) => s as unknown as number),
  fc.constant(null as unknown as number),
  fc.constant(undefined as unknown as number),
);

function clientArb() {
  return fc.record({
    filingStatus: fc.constantFrom(...FILING),
    state: fc.constantFrom(...STATES),
    dependentsUnder17: fc.integer({ min: 0, max: 6 }),
    otherDependents: fc.integer({ min: 0, max: 4 }),
    taxpayerAge: fc.integer({ min: 18, max: 95 }),
  });
}

function inputsArb(m: fc.Arbitrary<number>) {
  return fc.record({
    client: clientArb(),
    taxYear: fc.constantFrom(...YEARS),
    w2s: fc.array(fc.record({
      wagesBox1: m, federalTaxWithheldBox2: m, stateCode: fc.constantFrom(...STATES),
    }), { maxLength: 3 }),
    form1099s: fc.array(fc.record({
      formType: fc.constantFrom(...F1099),
      nonemployeeCompensation: m, interestIncome: m, ordinaryDividends: m,
      qualifiedDividends: m, shortTermGainLoss: fc.oneof(m, m.map((x) => -x)),
      longTermGainLoss: fc.oneof(m, m.map((x) => -x)), taxableAmount: m,
    }), { maxLength: 3 }),
    adjustments: fc.array(fc.record({
      adjustmentType: fc.constantFrom(...ADJ), amount: m, isApplied: fc.constant(true),
    }), { maxLength: 4 }),
  }).map((x) => ({ ...x, client: { ...x.client, taxYear: x.taxYear } }) as unknown as TaxReturnInputs);
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log("Machine-driven harness — property + fuzz + boundary + metamorphic\n");

const fcOpts = (n: number) => ({ numRuns: n, seed: 20260608 });

// P1 — invariants on realistic random returns
runProp("P1 invariants on realistic returns (1500 runs)", () =>
  fc.assert(fc.property(inputsArb(money), (inp) => {
    const v = checkInvariants(inp);
    if (v) throw new Error(`${v}\n  inputs=${JSON.stringify(inp).slice(0, 280)}`);
  }), fcOpts(1500)));

// P2 — FUZZING: malformed/extreme inputs must never crash or produce non-finite output
runProp("P2 fuzz: malformed/extreme inputs → no crash/NaN/Infinity (2500 runs)", () =>
  fc.assert(fc.property(inputsArb(fuzzMoney), (inp) => {
    const v = checkInvariants(inp);
    if (v) throw new Error(`${v}\n  inputs=${JSON.stringify(inp).slice(0, 280)}`);
  }), fcOpts(2500)));

// P3 — METAMORPHIC monotonicity: more wage income never decreases gross tax
//      (high-income, no-credit region — single/FL, no deps).
runProp("P3 metamorphic: gross tax monotonic in wage income (800 runs)", () =>
  fc.assert(fc.property(
    fc.double({ min: 300_000, max: 3_000_000, noNaN: true }),
    fc.double({ min: 1, max: 500_000, noNaN: true }),
    fc.constantFrom(...YEARS),
    (base, delta, year) => {
      const mk = (w: number): TaxReturnInputs => ({
        client: { filingStatus: "single", state: "FL", taxYear: year },
        w2s: [{ wagesBox1: w, federalTaxWithheldBox2: 0, stateCode: "FL" }],
        form1099s: [], adjustments: [], taxYear: year,
      });
      const lo = computeTaxReturnPure(mk(base)).federalTaxLiability;
      const hi = computeTaxReturnPure(mk(base + delta)).federalTaxLiability;
      runCount += 2;
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi < lo - 1)
        throw new Error(`tax(${(base + delta).toFixed(0)})=${hi.toFixed(2)} < tax(${base.toFixed(0)})=${lo.toFixed(2)} (yr ${year})`);
    }), fcOpts(800)));

// P4 — BOUNDARY continuity: ±$1 around 2024 single ordinary-bracket edges must
//      not produce a discontinuous tax jump (no unintended cliff). High income →
//      no credit cliffs, so the only legit step is ~marginal-rate per $1.
runProp("P4 boundary: no >$1 cliff at ordinary-bracket edges", () => {
  const stdSingle2024 = 14600;
  const edges = [11600, 47150, 100525, 191950, 243725, 609350];
  const mk = (w: number): TaxReturnInputs => ({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: w, federalTaxWithheldBox2: 0, stateCode: "FL" }],
    form1099s: [], adjustments: [], taxYear: 2024,
  });
  for (const edge of edges) {
    for (const t of [edge - 1, edge, edge + 1]) {
      const a = computeTaxReturnPure(mk(t + stdSingle2024)).federalTaxLiability;
      const b = computeTaxReturnPure(mk(t + stdSingle2024 + 1)).federalTaxLiability;
      runCount += 2;
      if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b - a) > 1.0)
        throw new Error(`$1 jump of ${(b - a).toFixed(2)} at taxable≈${t} (edge ${edge})`);
    }
  }
});

console.log(`\nRuns: ~${runCount}`);
if (VIOLATIONS.length === 0) {
  console.log("✅ ALL PROPERTY/FUZZ/BOUNDARY/METAMORPHIC INVARIANTS HOLD");
  process.exit(0);
} else {
  console.log(`\n❌ ${VIOLATIONS.length} property(ies) violated:\n`);
  for (const f of VIOLATIONS) console.log(f + "\n");
  process.exit(1);
}
