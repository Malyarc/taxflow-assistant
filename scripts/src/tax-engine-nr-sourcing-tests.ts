/**
 * PREP-B1 — per-line non-resident income sourcing (NY IT-203 / CA 540NR).
 *
 * Verifies the proportional ("as-if-resident × source-fraction") TAX-RATIO method
 * for the method-(a)-verified states — NY, CA, CT (2026-06-06j), NJ + MN (2026-06-06k),
 * GA + NC + OH (2026-06-08), and the 2026-06-08 batch of 17 more (graduated AR/DE/ME/MO/
 * MT/NE/NM/OK/OR/RI/VT/WI + flat CO/IA/KS/LA/ND) — the per-income-type NR source base
 * (wages + NR business/rental/real-property gains via perStateNonResidentOtherSourced),
 * and the federal sourcing exclusions: intangibles (interest/dividends — 4 U.S.C.
 * §114(a)) and retirement (pension/IRA/401(k)/SS — 4 U.S.C. §114(b)) are NEVER NR-source.
 * Also guards the deliberate EXCLUSIONS stay on the direct-bracket fallback: MD (method b
 * + a 2.25% special NR tax the engine can't model), SC (genuine method b), UT (method-a
 * form but a no-op — engine std ded 0).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-nr-sourcing-tests.ts
 */

import {
  calculateMultiStateTax,
  calculateStateTax,
} from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}`);
}
function checkTruthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}
function header(t: string): void { console.log(`\n-- ${t} --`); }
const nyEntry = (r: ReturnType<typeof calculateMultiStateTax>, s: string) =>
  r.nonresidentStateTaxes.find((x) => x.state === s);

// ════════════════════════════════════════════════════════════════════════════
// NY IT-203 worked example (NY DTF IT-203 instructions):
// Single NJ resident, $80,000 NY-source wages + $40,000 NJ interest = $120,000.
//   NY tax AS-IF a full-year resident on $120,000: taxable = 120,000 − $8,000 NY
//   std ded = 112,000. NY single brackets → 4%×8,500 + 4.5%×3,200 + 5.25%×2,200
//   + 5.5%×66,750 + 6%×31,350 = 340 + 144 + 115.50 + 3,671.25 + 1,881 = $6,151.75.
//   Income % (IT-203 Line 45) = 80,000/120,000 = 66.667%.
//   NY NR tax = 6,151.75 × 0.66667 = $4,101.17.
// ════════════════════════════════════════════════════════════════════════════
header("NY IT-203 — NJ resident, $80k NY wages + $40k NJ interest");
{
  const r = calculateMultiStateTax({
    residentState: "NJ",
    federalAgi: 120000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 80000 }],
  });
  const ny = nyEntry(r, "NY");
  // Anchor: the engine's NY-as-resident tax on $120k matches the published brackets.
  check("NY-as-resident($120k single) = $6,151.75", calculateStateTax(120000, "NY", "single", 2024), 6151.75, 0.5);
  // The IT-203 method: NY-as-resident × income% (80k/120k).
  check("NY NR tax = $4,101.17 (IT-203 income % method)", ny?.tax ?? -1, 4101.17, 0.5);
  check("NY NR tax == NY-as-resident × 0.66667 (relational)",
    ny?.tax ?? -1, calculateStateTax(120000, "NY", "single", 2024) * (80000 / 120000), 0.5);
  checkTruthy("> the old direct-bracket-on-$80k value",
    (ny?.tax ?? 0) > calculateStateTax(80000, "NY", "single", 2024));
}

// ════════════════════════════════════════════════════════════════════════════
// CA 540NR worked example (FTB 540NR Schedule CA):
// Single TX resident, $100,000 CA wages + $50,000 TX wages = $150,000.
//   CA tax as-if resident on $150,000 (taxable 150,000 − $5,540 std ded = 144,460):
//     1%×10,756 + 2%×14,743 + 4%×14,746 + 6%×15,621 + 8%×14,740 + 9.3%×73,854
//     = 107.56 + 294.86 + 589.84 + 937.26 + 1,179.20 + 6,868.42 = $9,977.14.
//   CA ratio = 100,000/150,000 = 66.667% → CA NR tax = $6,651.43.
// ════════════════════════════════════════════════════════════════════════════
header("CA 540NR — TX resident, $100k CA + $50k TX wages");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 150000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "CA", wages: 100000 }, { stateCode: "TX", wages: 50000 }],
  });
  const ca = nyEntry(r, "CA");
  check("CA-as-resident($150k single) = $9,977.14", calculateStateTax(150000, "CA", "single", 2024), 9977.14, 0.5);
  check("CA NR tax = $6,651.43 (540NR ratio)", ca?.tax ?? -1, 6651.43, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// CT-1040NR/PY worked example (CT DRS instructions: Line 8 = tax on the FULL
// CT-AGI, Line 9 = CT-source ÷ CT-AGI ratio, CT tax = Line 8 × Line 9 — method a):
// Single NY resident, $90,000 CT-source wages + $30,000 NY interest = $120,000.
//   CT has NO standard deduction; the $15,000 single personal exemption is fully
//   phased out above $45k → CT taxable = full $120,000. 2024 CT single brackets
//   (post-2024 rate cut: 2% / 4.5% / 5.5% / 6%): 2%×10,000 + 4.5%×40,000 +
//   5.5%×50,000 + 6%×20,000 = 200 + 1,800 + 2,750 + 1,200 = $5,950.
//   CT ratio = 90,000/120,000 = 75% → CT NR tax = 5,950 × 0.75 = $4,462.50.
// ════════════════════════════════════════════════════════════════════════════
header("CT-1040NR/PY — NY resident, $90k CT wages + $30k NY interest");
{
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 120000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "CT", wages: 90000 }],
  });
  const ct = nyEntry(r, "CT");
  check("CT-as-resident($120k single) = $5,950 (hand-calc, 2024 brackets)",
    calculateStateTax(120000, "CT", "single", 2024), 5950, 0.5);
  check("CT NR tax = $4,462.50 (CT-1040NR/PY ratio method)", ct?.tax ?? -1, 4462.5, 0.5);
  check("CT NR tax == CT-as-resident × 0.75 (relational)",
    ct?.tax ?? -1, calculateStateTax(120000, "CT", "single", 2024) * (90000 / 120000), 0.5);
  checkTruthy("> the old direct-bracket-on-$90k fallback ($4,200)",
    (ct?.tax ?? 0) > calculateStateTax(90000, "CT", "single", 2024));
}

// ════════════════════════════════════════════════════════════════════════════
// NJ-1040NR worked example (NJ Div. of Taxation: Line 40 = tax on Line 39 taxable
// income from Column A = income EVERYWHERE; Line 42 = Line 40 × Line 41 income % =
// NJ-source ÷ everywhere — method a):
// Single NY resident, $100,000 NJ-source wages + $50,000 NY interest = $150,000.
//   NJ tax as-if resident on $150,000 (NJ has no std ded; a $1,000 personal
//   exemption → taxable $149,000). NJ single brackets: 1.4%×20,000 + 1.75%×15,000
//   + 3.5%×5,000 + 5.525%×35,000 + 6.37%×(149,000−75,000) = 280 + 262.50 + 175 +
//   1,933.75 + 4,713.80 = $7,365.05.
//   NJ income % = 100,000/150,000 = 66.667% → NJ NR tax = 7,365.05 × ⅔ = $4,910.03.
// ════════════════════════════════════════════════════════════════════════════
header("NJ-1040NR — NY resident, $100k NJ wages + $50k NY interest");
{
  const r = calculateMultiStateTax({
    residentState: "NY",
    federalAgi: 150000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NJ", wages: 100000 }],
  });
  const nj = nyEntry(r, "NJ");
  check("NJ-as-resident($150k single) = $7,365.05 (hand-calc, $1k exemption)",
    calculateStateTax(150000, "NJ", "single", 2024), 7365.05, 0.5);
  check("NJ NR tax = $4,910.03 (NJ-1040NR income % method)", nj?.tax ?? -1, 4910.03, 0.5);
  check("NJ NR tax == NJ-as-resident × ⅔ (relational)",
    nj?.tax ?? -1, calculateStateTax(150000, "NJ", "single", 2024) * (100000 / 150000), 0.5);
  checkTruthy("> the old direct-bracket-on-$100k fallback",
    (nj?.tax ?? 0) > calculateStateTax(100000, "NJ", "single", 2024));
}

// ════════════════════════════════════════════════════════════════════════════
// MN Schedule M1NR worked example (MN DOR: Line 31 = Form M1 line 12 = tax on
// TOTAL income; Line 30 = MN-source ÷ total ratio; Line 32 = Line 30 × Line 31 —
// method a):
// Single TX resident, $100,000 MN-source wages + $50,000 TX wages = $150,000.
//   MN tax as-if resident on $150,000 (MN single std ded $14,575 → taxable
//   $135,425). MN single brackets: 5.35%×31,690 + 6.80%×72,400 + 7.85%×31,335 =
//   1,695.42 + 4,923.20 + 2,459.80 = $9,078.41.
//   MN ratio = 100,000/150,000 = 66.667% → MN NR tax = 9,078.41 × ⅔ = $6,052.27.
// ════════════════════════════════════════════════════════════════════════════
header("MN M1NR — TX resident, $100k MN + $50k TX wages");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 150000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "MN", wages: 100000 }, { stateCode: "TX", wages: 50000 }],
  });
  const mn = nyEntry(r, "MN");
  check("MN-as-resident($150k single) = $9,078.41 (hand-calc, std ded $14,575)",
    calculateStateTax(150000, "MN", "single", 2024), 9078.41, 0.5);
  check("MN NR tax = $6,052.27 (M1NR ratio method)", mn?.tax ?? -1, 6052.27, 0.5);
  check("MN NR tax == MN-as-resident × ⅔ (relational)",
    mn?.tax ?? -1, calculateStateTax(150000, "MN", "single", 2024) * (100000 / 150000), 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// GA Form 500 Schedule 3 worked example (GA DOR IT-511: Line 9 ratio = GA-source ÷
// total; Line 13 prorates deductions/exemptions by that ratio → GA taxable =
// source − ded×ratio. GA is FLAT 5.39%, so r·(source − D·ratio) = r·(total − D)·ratio
// = method a EXACTLY):
// Single TX resident, $90,000 GA-source wages + $30,000 TX wages = $120,000.
//   GA tax as-if resident on $120,000: (120,000 − $12,000 std ded) × 5.39%
//     = 108,000 × 0.0539 = $5,821.20.
//   GA ratio = 90,000/120,000 = 75% → GA NR tax = 5,821.20 × 0.75 = $4,365.90.
//   Cross-check via Schedule 3: 90,000 − 12,000×0.75 = 81,000; × 0.0539 = $4,365.90.
// ════════════════════════════════════════════════════════════════════════════
header("GA Form 500 Sch 3 — TX resident, $90k GA + $30k TX wages");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 120000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "GA", wages: 90000 }, { stateCode: "TX", wages: 30000 }],
  });
  const ga = nyEntry(r, "GA");
  check("GA-as-resident($120k single) = $5,821.20 (flat 5.39%, std ded $12k)",
    calculateStateTax(120000, "GA", "single", 2024), 5821.2, 0.5);
  check("GA NR tax = $4,365.90 (Sch 3 prorate-deductions = method a for flat tax)",
    ga?.tax ?? -1, 4365.9, 0.5);
  check("GA NR tax == GA-as-resident × 0.75 (relational)",
    ga?.tax ?? -1, calculateStateTax(120000, "GA", "single", 2024) * 0.75, 0.5);
  checkTruthy("> the old direct-bracket-on-$90k fallback (full std ded → under-tax)",
    (ga?.tax ?? 0) > calculateStateTax(90000, "GA", "single", 2024));
}

// ════════════════════════════════════════════════════════════════════════════
// NC D-400 worked example (NCDOR D-401: Line 14 = Line 12a taxable income on TOTAL
// × Line 13 "taxable %" from Schedule PN = NC-source ÷ total; Line 15 = ×4.5% —
// method a, flat tax):
// Single TX resident, $80,000 NC-source wages + $40,000 TX wages = $120,000.
//   NC tax as-if resident on $120,000: (120,000 − $12,750 std ded) × 4.5%
//     = 107,250 × 0.045 = $4,826.25.
//   NC taxable % = 80,000/120,000 = 66.667% → NC NR tax = 4,826.25 × ⅔ = $3,217.50.
//   Cross-check: 107,250 × 0.66667 = 71,500; × 0.045 = $3,217.50.
// ════════════════════════════════════════════════════════════════════════════
header("NC D-400 Sch PN — TX resident, $80k NC + $40k TX wages");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 120000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NC", wages: 80000 }, { stateCode: "TX", wages: 40000 }],
  });
  const nc = nyEntry(r, "NC");
  check("NC-as-resident($120k single) = $4,826.25 (flat 4.5%, std ded $12,750)",
    calculateStateTax(120000, "NC", "single", 2024), 4826.25, 0.5);
  check("NC NR tax = $3,217.50 (D-400 Line 14 taxable-% method a)",
    nc?.tax ?? -1, 3217.5, 0.5);
  check("NC NR tax == NC-as-resident × ⅔ (relational)",
    nc?.tax ?? -1, calculateStateTax(120000, "NC", "single", 2024) * (80000 / 120000), 0.5);
  checkTruthy("> the old direct-bracket-on-$80k fallback",
    (nc?.tax ?? 0) > calculateStateTax(80000, "NC", "single", 2024));
}

// ════════════════════════════════════════════════════════════════════════════
// OH IT NRC worked example (tax.ohio.gov: the nonresident CREDIT = tax(OAGI on ALL
// income) × (non-OH ÷ OAGI), so OH tax borne = tax(total) × (OH-source ÷ OAGI) =
// method a. OH's graduated 0%/2.75%/3.5% schedule makes this materially > the
// source-only fallback — the fallback would shelter $90k in the lower brackets):
// Single TX resident, $90,000 OH-source wages + $30,000 TX wages = $120,000.
//   OH tax as-if resident on $120,000 (no std ded): 0%×26,050 + 2.75%×(100,000−26,050)
//     + 3.5%×(120,000−100,000) = 0 + 2,033.625 + 700 = $2,733.625.
//   OH ratio = 90,000/120,000 = 75% → OH NR tax = 2,733.625 × 0.75 = $2,050.22.
// ════════════════════════════════════════════════════════════════════════════
header("OH IT NRC — TX resident, $90k OH + $30k TX wages");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 120000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "OH", wages: 90000 }, { stateCode: "TX", wages: 30000 }],
  });
  const oh = nyEntry(r, "OH");
  check("OH-as-resident($120k single) = $2,733.625 (graduated 0/2.75/3.5%)",
    calculateStateTax(120000, "OH", "single", 2024), 2733.625, 0.5);
  check("OH NR tax = $2,050.22 (IT NRC nonresident-credit = method a)",
    oh?.tax ?? -1, 2050.22, 0.5);
  check("OH NR tax == OH-as-resident × 0.75 (relational)",
    oh?.tax ?? -1, calculateStateTax(120000, "OH", "single", 2024) * 0.75, 0.5);
  checkTruthy("> the old direct-bracket-on-$90k fallback (graduated-bracket effect)",
    (oh?.tax ?? 0) > calculateStateTax(90000, "OH", "single", 2024));
}

// ════════════════════════════════════════════════════════════════════════════
// MD is DELIBERATELY EXCLUDED (Form 505NR is method b — prorates deductions by the
// income factor then applies the GRADUATED rate to MD-SOURCE income, landing in
// lower brackets than method a — AND adds a 2.25% special nonresident tax the engine
// can't model). A MD non-resident must therefore use the CONSERVATIVE FALLBACK
// (direct brackets on the source income), NOT the as-if-resident method. This guards
// against someone naively adding MD to NR_AS_IF_RESIDENT_STATES.
// ════════════════════════════════════════════════════════════════════════════
header("MD excluded — non-resident uses the conservative fallback, NOT method a");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 120000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "MD", wages: 80000 }, { stateCode: "TX", wages: 40000 }],
  });
  const md = nyEntry(r, "MD");
  check("MD NR tax == direct-bracket fallback on $80k source (NOT method a)",
    md?.tax ?? -1, calculateStateTax(80000, "MD", "single", 2024), 0.5);
  checkTruthy("MD NR tax < the method-a value (proving method a was NOT applied)",
    (md?.tax ?? Infinity) < calculateStateTax(120000, "MD", "single", 2024) * (80000 / 120000) - 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 2026-06-08 BATCH — 17 more method-(a) states, each verified against its NR form's
// "multiply tax-on-all-income by the source percentage" line (see the comment block
// in taxCalculator.ts NR_AS_IF_RESIDENT_STATES). The defining property of method (a)
// is the EXACT identity  NR tax == calculateStateTax(total) × (source / total)  — we
// assert that per state (it would FAIL under the pre-change direct-bracket fallback),
// plus NR > fallback (the method actually changed, in the correct direction). The
// absolute resident values calculateStateTax(120000, ·) are validated by the 50-state
// suite; here a TX resident ($80k state-source + $40k TX = $120k, ratio ⅔) isolates
// the NR computation.
// ════════════════════════════════════════════════════════════════════════════
header("2026-06-08 batch — 17 method-(a) states (relational + >fallback)");
{
  const GRADUATED = ["AR", "DE", "ME", "MO", "MT", "NE", "NM", "OK", "OR", "RI", "VT", "WI"];
  const FLAT = ["CO", "IA", "KS", "LA", "ND"];
  for (const s of [...GRADUATED, ...FLAT]) {
    const r = calculateMultiStateTax({
      residentState: "TX",
      federalAgi: 120000,
      filingStatus: "single",
      taxYear: 2024,
      perStateWages: [{ stateCode: s, wages: 80000 }, { stateCode: "TX", wages: 40000 }],
    });
    const e = nyEntry(r, s);
    const asRes = calculateStateTax(120000, s, "single", 2024);
    check(`${s} NR == as-resident($120k) × ⅔ (method-(a) identity)`, e?.tax ?? -1, asRes * (80000 / 120000), 0.5);
    checkTruthy(`${s} NR > direct-bracket fallback on $80k (method changed correctly)`,
      (e?.tax ?? 0) > calculateStateTax(80000, s, "single", 2024) + 0.01);
  }
  // CO absolute hand-calc anchor (flat 4.4%, conforms to federal taxable income →
  // std ded = federal $14,600 single 2024): as-resident = (120,000 − 14,600) × 4.4%
  // = $4,637.60; NR = × ⅔ = $3,091.73.
  const co = nyEntry(
    calculateMultiStateTax({
      residentState: "TX", federalAgi: 120000, filingStatus: "single", taxYear: 2024,
      perStateWages: [{ stateCode: "CO", wages: 80000 }, { stateCode: "TX", wages: 40000 }],
    }), "CO");
  check("CO NR absolute = $3,091.73 ((120k−14.6k std)×4.4%×⅔)", co?.tax ?? -1, 3091.73, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// Guards for the deliberate EXCLUSIONS (each must stay on the direct-bracket
// fallback, NOT method a):
//   - SC: genuine method b (Sch NR taxes SC-source income directly at graduated
//     rates → lower than method a). Adding it would OVER-tax.
//   - UT: method a in form, but the engine models UT std ded as 0 (its taxpayer
//     credit replaces the std ded, not modeled) → method a == fallback (a NO-OP);
//     left out to keep the set honest.
// ════════════════════════════════════════════════════════════════════════════
header("Guards — SC (method b) + UT (no-op) stay on the fallback");
{
  for (const s of ["SC", "UT"]) {
    const r = calculateMultiStateTax({
      residentState: "TX", federalAgi: 120000, filingStatus: "single", taxYear: 2024,
      perStateWages: [{ stateCode: s, wages: 80000 }, { stateCode: "TX", wages: 40000 }],
    });
    const e = nyEntry(r, s);
    check(`${s} NR == direct-bracket fallback on $80k (NOT method a)`,
      e?.tax ?? -1, calculateStateTax(80000, s, "single", 2024), 0.5);
  }
  // SC: confirm method a would have been STRICTLY higher (proves the exclusion matters).
  checkTruthy("SC fallback < the method-a value it would wrongly compute",
    calculateStateTax(80000, "SC", "single", 2024) < calculateStateTax(120000, "SC", "single", 2024) * (80000 / 120000) - 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// Per-income-type NR source: a TX resident with NY REAL-PROPERTY RENTAL income
// (situs-sourced to NY) but NO NY wages. Supplied via perStateNonResidentOther-
// Sourced. NY taxes the rental via the IT-203 method even with zero NY wages.
//   TX resident, $80k TX wages + $20k NY rental = $100k; NY source = $20k.
//   NY NR tax = NY-as-resident($100k) × (20,000/100,000).
// ════════════════════════════════════════════════════════════════════════════
header("Per-type NR source — TX resident, $20k NY rental (no NY wages)");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 100000,
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "TX", wages: 80000 }],
    options: { perStateNonResidentOtherSourced: { NY: 20000 } },
  });
  const ny = nyEntry(r, "NY");
  checkTruthy("NY appears as a non-resident state from rental alone (no wages)", ny != null);
  check("NY NR tax on rental = NY-as-resident($100k) × 20%",
    ny?.tax ?? -1, calculateStateTax(100000, "NY", "single", 2024) * (20000 / 100000), 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// §114 / intangible exclusion: a TX resident who WORKED in NY ($80k wages) and
// also has $40k interest (intangible — §114(a)) + $30k IRA distribution (§114(b)).
// Only the $80k wages are NY-source; the interest + IRA are in total AGI ($150k,
// the denominator) but NOT in the NY-source numerator.
//   NY NR tax = NY-as-resident($150k) × (80,000/150,000), NOT × (150k/150k).
// ════════════════════════════════════════════════════════════════════════════
header("§114 — interest + IRA are NOT NY-source for a non-resident");
{
  const r = calculateMultiStateTax({
    residentState: "TX",
    federalAgi: 150000, // 80k NY wages + 40k interest + 30k IRA
    filingStatus: "single",
    taxYear: 2024,
    perStateWages: [{ stateCode: "NY", wages: 80000 }],
    // interest + IRA deliberately NOT in perStateNonResidentOtherSourced (§114).
  });
  const ny = nyEntry(r, "NY");
  check("NY NR tax = NY-as-resident($150k) × (80k/150k) — intangibles+IRA excluded",
    ny?.tax ?? -1, calculateStateTax(150000, "NY", "single", 2024) * (80000 / 150000), 0.5);
  checkTruthy("NY NR tax < taxing all $150k as NY-source (intangibles+IRA escape NY)",
    (ny?.tax ?? Infinity) < calculateStateTax(150000, "NY", "single", 2024) * 0.99);
}

console.log(`\n========================================`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed  (NR per-line sourcing)`);
if (FAIL.length) {
  console.log(`\nFAILURES:`);
  for (const f of FAIL) console.log(f);
  process.exit(1);
}
console.log(`ALL NR-SOURCING ASSERTIONS PASS`);
