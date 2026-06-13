/**
 * G-6 — K-1 PACKAGE INGESTION tests (pure, no API/DB/OCR/LLM)
 * ============================================================================
 *
 * Verifies `ingestK1Package` / `ingestK1Packages` (artifacts/.../k1PackageIngestion.ts):
 *   (a) box → ScheduleK1Fact field FIDELITY for both 1065 and 1120-S layouts,
 *   (b) the mapped facts FLOW correctly through `computeTaxReturnPure`
 *       (SE tax, §199A QBI, passive rental, dividend netting),
 *   (c) per-state schedule → stateFacts + sourceState (the engine's
 *       `nonresident_source_allocation` sourcing mechanism),
 *   (d) footnote extraction (§199A QBI/W-2/UBIA + SSTB), and
 *   (e) conservative WARNINGS (never invent numbers).
 *
 * Every engine-flow expected value is hand-calc'd against the published IRS rule.
 *
 * Hand-calc references (TY2024, single unless noted):
 *   - std ded single $14,600.
 *   - brackets: 10% to $11,600 | 12% to $47,150 | 22% to $100,525 | 24% to $191,950.
 *   - Schedule SE: net SE = 0.9235 × SE earnings; SS 12.4% to $168,600; Med 2.9% all;
 *     deductible half = SE tax / 2.
 *   - §199A: 20% × QBI, capped at 20% × (taxable income − net cap gain).
 *     K-1 QBI is NOT reduced by half-SE (engine invariant). GP excluded §199A(c)(4).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-k1-package-ingestion-tests.ts
 */

import {
  ingestK1Package,
  ingestK1Packages,
  type RawK1Package,
} from "../../artifacts/api-server/src/lib/k1PackageIngestion";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  cond ? PASS.push(`✓ ${label}`) : FAIL.push(`✗ ${label}`);
}

// ════════════════════════════════════════════════════════════════════════════
// 1 — 1065 active partner: box fidelity + SE tax + QBI flow through engine
// ════════════════════════════════════════════════════════════════════════════
// Single 2024, NO W-2. 1065 K-1: Box 1 = $80,000 (active), Box 14A = $80,000 SE.
// Mapping: entityType partnership, activityType active, box1=80k, 14A=80k.
// Engine hand-calc:
//   Total income = 80,000
//   SE base = max(14A 80,000, GP 0) = 80,000
//     net SE = 80,000 × 0.9235 = 73,880
//     SS  = 73,880 × 0.124 =  9,161.12  (< 168,600 base)
//     Med = 73,880 × 0.029 =  2,142.52
//     SE tax = 11,303.64 ; half = 5,651.82
//   AGI = 80,000 − 5,651.82 = 74,348.18
//   QBI (auto) = Box 1 80,000 ; taxable before QBI = 74,348.18 − 14,600 = 59,748.18
//     cap = 20% × 59,748.18 = 11,949.636 ; tentative = 20% × 80,000 = 16,000
//     QBI deduction = min = 11,949.636
//   Taxable = 59,748.18 − 11,949.636 = 47,798.544
//   Income tax = 1,160 + 4,266 + 22%×(47,798.544 − 47,150) = 1,160 + 4,266 + 142.68 = 5,568.68
//   federalTaxLiability = 5,568.68 + 11,303.64 = 16,872.32
{
  const pkg: RawK1Package = {
    taxYear: 2024,
    entityName: "Acme Partners LP",
    entityKind: "1065",
    activity: "active",
    boxes: { "1": 80000, "14A": 80000 },
  };
  const ing = ingestK1Package(pkg);
  checkTrue("1065 → entityType partnership", ing.fact.entityType === "partnership");
  checkTrue("1065 → activityType active", ing.fact.activityType === "active");
  check("1065 Box 1 mapped", Number(ing.fact.box1OrdinaryIncome), 80000, 0.01);
  check("1065 Box 14A → selfEmploymentEarnings", Number(ing.fact.selfEmploymentEarnings), 80000, 0.01);
  checkTrue("1065 no warnings on clean active K-1", ing.warnings.length === 0);
  checkTrue("1065 no source state when no state schedule", ing.fact.sourceState === null);

  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [ing.fact],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("ENGINE total income = $80,000", r.totalIncome, 80000, 1);
  check("ENGINE SE tax = $11,303.64", r.selfEmploymentTax ?? 0, 11303.64, 0.5);
  check("ENGINE AGI = $74,348.18", r.adjustedGrossIncome, 74348.18, 0.5);
  check("ENGINE QBI deduction = $11,949.64 (Box 1 auto)", r.qbiDeduction ?? 0, 11949.636, 0.5);
  check("ENGINE taxable income = $47,798.54", r.taxableIncome, 47798.544, 0.5);
  check("ENGINE federalTaxLiability = $16,872.32", r.federalTaxLiability, 16872.32, 1);
  check("ENGINE K-1 SE earnings summary = $80,000", r.scheduleK1.totalSelfEmploymentEarnings, 80000, 0.01);
  check("ENGINE K-1 active ordinary summary = $80,000", r.scheduleK1.totalActiveOrdinaryIncome, 80000, 0.01);
  check("ENGINE partnership count = 1", r.scheduleK1.partnershipCount, 1, 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 2 — 1120-S K-1: NO SE; portfolio labels (4/5a/5b); QBI; Box 4 dropped
// ════════════════════════════════════════════════════════════════════════════
// 1120-S K-1: Box 1 = $50,000, Box 4 (interest) = $1,000, Box 5a div = $2,000,
//   Box 5b qual div = $1,500. ERROR injection: Box "4A" guaranteed = $9,999
//   (S-corps have no GP → dropped + warning), Box "14A" $5,000 (dropped + warning).
{
  const pkg: RawK1Package = {
    taxYear: 2024,
    entityName: "Beta S-Corp Inc",
    entityKind: "1120S",
    boxes: { "1": 50000, "4": 1000, "5a": 2000, "5b": 1500, "4A": 9999, "14A": 5000 },
  };
  const ing = ingestK1Package(pkg);
  checkTrue("1120S → entityType s_corp", ing.fact.entityType === "s_corp");
  check("1120S Box 1 mapped", Number(ing.fact.box1OrdinaryIncome), 50000, 0.01);
  check("1120S Box 4 → interestIncome ($1,000)", Number(ing.fact.interestIncome), 1000, 0.01);
  check("1120S Box 5a → ordinaryDividends ($2,000)", Number(ing.fact.ordinaryDividends), 2000, 0.01);
  check("1120S Box 5b → qualifiedDividends ($1,500)", Number(ing.fact.qualifiedDividends), 1500, 0.01);
  checkTrue("1120S guaranteed payment DROPPED (null)", ing.fact.box4GuaranteedPayments == null);
  checkTrue("1120S Box 14A SE DROPPED (null)", ing.fact.selfEmploymentEarnings == null);
  checkTrue(
    "1120S warns about dropped GP",
    ing.warnings.some((w) => w.includes("guaranteed payments") && w.includes("1120-S")),
  );
  checkTrue(
    "1120S warns about dropped SE",
    ing.warnings.some((w) => w.toLowerCase().includes("self-employment") && w.includes("1120-S")),
  );

  // Flow: single 2024 → S-corp distributive share is NOT SE-taxed.
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [ing.fact],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("ENGINE S-corp SE tax = $0 (no SE on K-1 share)", r.selfEmploymentTax ?? 0, 0, 0.01);
  check("ENGINE S-corp count = 1", r.scheduleK1.sCorpCount, 1, 0);
  // ordinary dividends net = max(0, 2000 − 1500) = 500 ; qualified = 1500
  check("ENGINE K-1 ordinary dividends (net of qual) = $500", r.scheduleK1.totalOrdinaryDividends, 500, 0.5);
  check("ENGINE K-1 qualified dividends = $1,500", r.scheduleK1.totalQualifiedDividends, 1500, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 3 — Box 2 rental real estate → passive bucket (no SE, no QBI auto from Box 2
//     on a passive K-1)
// ════════════════════════════════════════════════════════════════════════════
// 1065 K-1 marked passive: Box 2 net rental RE = $20,000. Single 2024.
//   Passive Box 2 flows to the K-1 passive bucket → AGI (net positive).
//   No SE (rental RE is not SE income). passive K-1 → no QBI auto.
//   AGI = 20,000 ; taxable = 20,000 − 14,600 = 5,400 ; QBI = 0.
//   Income tax = 10% × 5,400 = 540.
{
  const pkg: RawK1Package = {
    taxYear: 2024,
    entityName: "Gamma Realty LP",
    entityKind: "1065",
    activity: "passive",
    boxes: { "2": 20000 },
  };
  const ing = ingestK1Package(pkg);
  check("1065 Box 2 → box2RentalRealEstate", Number(ing.fact.box2RentalRealEstate), 20000, 0.01);
  checkTrue("1065 passive → activityType passive", ing.fact.activityType === "passive");

  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [ing.fact],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("ENGINE passive rental → AGI = $20,000", r.adjustedGrossIncome, 20000, 1);
  check("ENGINE passive bucket applied = $20,000", r.scheduleK1.totalPassiveBucketNetApplied, 20000, 1);
  check("ENGINE no SE on rental K-1", r.selfEmploymentTax ?? 0, 0, 0.01);
  check("ENGINE no QBI from passive K-1", r.qbiDeduction ?? 0, 0, 0.01);
  check("ENGINE taxable income = $5,400", r.taxableIncome, 5400, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 4 — §199A from inline boxes (20Z) with W-2 wages + UBIA + SSTB flag box
// ════════════════════════════════════════════════════════════════════════════
{
  const pkg: RawK1Package = {
    taxYear: 2024,
    entityName: "Delta Pro LP",
    entityKind: "1065",
    activity: "active",
    boxes: {
      "1": 100000,
      "14A": 100000,
      "20Z_qbi": 100000,
      "20Z_w2": 40000,
      "20Z_ubia": 250000,
      "20Z_sstb": 0, // explicit non-SSTB flag
    },
  };
  const ing = ingestK1Package(pkg);
  check("20Z_qbi → section199aQbi", Number(ing.fact.section199aQbi), 100000, 0.01);
  check("20Z_w2 → section199aW2Wages", Number(ing.fact.section199aW2Wages), 40000, 0.01);
  check("20Z_ubia → section199aUbia", Number(ing.fact.section199aUbia), 250000, 0.01);
  checkTrue("20Z_sstb=0 → isSstb false (explicit)", ing.fact.isSstb === false);
  checkTrue("§199A complete → no QBI/SSTB warnings", ing.warnings.length === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// 5 — §199A from FOOTNOTE statement (the HNW case) + SSTB footnote
// ════════════════════════════════════════════════════════════════════════════
// Box 20 Z is just "STMT" on the printed K-1; the figures live in footnotes.
{
  const pkg: RawK1Package = {
    taxYear: 2024,
    entityName: "Epsilon Advisors LP",
    entityKind: "1065",
    activity: "active",
    boxes: { "1": 90000, "14A": 90000 },
    footnotes: [
      { code: "199A_QBI", description: "Section 199A qualified business income", amount: 90000 },
      { code: "199A_W2", description: "Section 199A W-2 wages", amount: 30000 },
      { code: "199A_UBIA", description: "Section 199A UBIA of qualified property", amount: 0 },
      { code: "SSTB", description: "This activity is a specified service trade or business" },
    ],
  };
  const ing = ingestK1Package(pkg);
  check("footnote 199A_QBI → section199aQbi", Number(ing.fact.section199aQbi), 90000, 0.01);
  check("footnote 199A_W2 → section199aW2Wages", Number(ing.fact.section199aW2Wages), 30000, 0.01);
  checkTrue("footnote SSTB present → isSstb true", ing.fact.isSstb === true);
  checkTrue("footnotes complete → no warnings", ing.warnings.length === 0);

  // Box wins over footnote: add a Box 20Z_qbi that disagrees → box value used.
  const pkg2: RawK1Package = {
    ...pkg,
    boxes: { ...pkg.boxes, "20Z_qbi": 95000 },
  };
  const ing2 = ingestK1Package(pkg2);
  check("box 20Z_qbi overrides footnote QBI", Number(ing2.fact.section199aQbi), 95000, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// 6 — §199A QBI present but NO W-2 wages → conservative warning (wage limit
//     cannot be applied); QBI still maps.
// ════════════════════════════════════════════════════════════════════════════
{
  const pkg: RawK1Package = {
    taxYear: 2024,
    entityName: "Zeta Holdings LP",
    entityKind: "1065",
    activity: "active",
    boxes: { "1": 60000, "20Z_qbi": 60000 },
  };
  const ing = ingestK1Package(pkg);
  check("QBI maps even without W-2 wages", Number(ing.fact.section199aQbi), 60000, 0.01);
  checkTrue("section199aW2Wages left undefined (not invented)", ing.fact.section199aW2Wages === undefined);
  checkTrue(
    "warns: QBI present but no W-2 wages → wage limit cannot apply",
    ing.warnings.some((w) => w.includes("wage/UBIA limit cannot be applied")),
  );
  checkTrue(
    "warns: no SSTB flag → defaulting non-SSTB",
    ing.warnings.some((w) => w.includes("defaulting to non-SSTB")),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 7 — MULTI-STATE: per-state K-1 schedule → stateFacts + sourceState
// ════════════════════════════════════════════════════════════════════════════
// Single state NY schedule → primary sourceState NY, one stateFact.
{
  const pkg: RawK1Package = {
    taxYear: 2024,
    entityName: "Eta MultiState LP",
    entityKind: "1065",
    activity: "active",
    boxes: { "1": 120000, "14A": 120000 },
    stateSchedules: [
      { state: "ny", ordinaryIncome: 120000, apportionmentPct: 100, note: "Wholly NY-sourced" },
    ],
  };
  const ing = ingestK1Package(pkg);
  checkTrue("primary sourceState = NY (uppercased)", ing.fact.sourceState === "NY");
  checkTrue("one stateFact", ing.stateFacts.length === 1);
  checkTrue("stateFact state = NY", ing.stateFacts[0].state === "NY");
  check("stateFact ordinaryIncome = $120,000", ing.stateFacts[0].ordinaryIncome, 120000, 0.01);
  check("stateFact apportionmentPct = 100", ing.stateFacts[0].apportionmentPct ?? -1, 100, 0.01);
  checkTrue(
    "state note surfaced as warning",
    ing.warnings.some((w) => w.includes("Wholly NY-sourced")),
  );

  // Engine sourcing: full-year FL resident + nonresident_source_allocation marker
  // → the NY-sourced Box 1 is taxed by NY as a non-resident (the real mechanism).
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [{ adjustmentType: "nonresident_source_allocation", amount: 1 }],
    scheduleK1: [ing.fact],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  // FL has no income tax; NY (non-resident) taxes the NY-sourced K-1 via the
  // IT-203 as-if-resident method. Hand-check: NY tax > $0 and the NR detail names NY.
  check(
    "ENGINE NY non-resident state tax > $0 via sourceState mechanism",
    (r.stateTaxLiability ?? 0) > 0 ? 1 : 0,
    1,
    0,
  );
  checkTrue(
    "ENGINE NR detail sources to NY",
    (r.multiState?.nonresidentStateTaxes ?? []).some((n) => n.state === "NY" && n.tax > 0),
  );
}

// Multi-state package → primary sourceState + fan-out warning + all stateFacts.
{
  const pkg: RawK1Package = {
    taxYear: 2024,
    entityName: "Theta MultiState LP",
    entityKind: "1065",
    activity: "active",
    boxes: { "1": 200000, "14A": 200000 },
    stateSchedules: [
      { state: "NY", ordinaryIncome: 120000, apportionmentPct: 60 },
      { state: "CA", ordinaryIncome: 60000, apportionmentPct: 30 },
      { state: "NJ", ordinaryIncome: 20000, apportionmentPct: 10 },
    ],
  };
  const ing = ingestK1Package(pkg);
  checkTrue("multi-state primary sourceState = first (NY)", ing.fact.sourceState === "NY");
  checkTrue("three stateFacts", ing.stateFacts.length === 3);
  checkTrue(
    "multi-state fan-out warning emitted",
    ing.warnings.some((w) => w.includes("spans 3 states") && w.includes("fan out")),
  );
  check("CA stateFact ordinaryIncome = $60,000", ing.stateFacts[1].ordinaryIncome, 60000, 0.01);
  check("NJ stateFact apportionmentPct = 10", ing.stateFacts[2].apportionmentPct ?? -1, 10, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// 8 — Basis / at-risk / distributions mapping; unmapped footnote → warning
// ════════════════════════════════════════════════════════════════════════════
{
  const pkg: RawK1Package = {
    taxYear: 2024,
    entityName: "Iota Capital LP",
    entityKind: "1065",
    activity: "active",
    boxes: {
      "1": -50000, // a loss
      basis_begin: 30000,
      basis_end: 0,
      at_risk: 25000,
      "19": 5000, // distributions
      sep_ded: 2000,
    },
    footnotes: [{ code: "163J", description: "Section 163(j) business interest limitation info", amount: 1234 }],
  };
  const ing = ingestK1Package(pkg);
  check("basis_begin → basisAtYearStart", Number(ing.fact.basisAtYearStart), 30000, 0.01);
  check("basis_end → basisAtYearEnd", Number(ing.fact.basisAtYearEnd), 0, 0.01);
  check("at_risk → atRiskAmount", Number(ing.fact.atRiskAmount), 25000, 0.01);
  check("Box 19 → distributions", Number(ing.fact.distributions), 5000, 0.01);
  check("sep_ded → separatelyStatedDeductions", Number(ing.fact.separatelyStatedDeductions), 2000, 0.01);
  checkTrue(
    "unmapped §163(j) footnote surfaced as warning",
    ing.warnings.some((w) => w.includes("Unmapped footnote") && w.includes("163J")),
  );

  // Engine: §704(d)/§465 limit — basis available = 30,000 − (5,000 dist + 2,000 ded)
  //   = 23,000; at-risk = 25,000. Allowed loss = min(50,000, 23,000, 25,000) = 23,000.
  //   Suspended = 50,000 − 23,000 = 27,000. The allowed -23,000 flows to total income
  //   (Line 9); AGI is FLOORED at 0 by the engine (negative AGI → 0).
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: [ing.fact],
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  check("ENGINE basis/at-risk suspended loss = $27,000", r.scheduleK1.k1BasisAtRiskLossSuspended, 27000, 1);
  check("ENGINE allowed active loss → total income = -$23,000", r.totalIncome, -23000, 1);
  check("ENGINE K-1 active ordinary (capped) = -$23,000", r.scheduleK1.totalActiveOrdinaryIncome, -23000, 1);
}

// ════════════════════════════════════════════════════════════════════════════
// 9 — Conservatism: empty boxes never invent numbers; data-validation warnings
// ════════════════════════════════════════════════════════════════════════════
{
  const empty: RawK1Package = {
    taxYear: 2024,
    entityName: "Kappa Empty LP",
    entityKind: "1065",
    boxes: {},
  };
  const ing = ingestK1Package(empty);
  checkTrue("empty Box 1 → undefined (not 0)", ing.fact.box1OrdinaryIncome === undefined);
  checkTrue("empty Box 2 → undefined", ing.fact.box2RentalRealEstate === undefined);
  checkTrue("empty QBI → undefined", ing.fact.section199aQbi === undefined);
  checkTrue("empty package no warnings", ing.warnings.length === 0);

  // qualified > ordinary dividends → warning.
  const badDiv: RawK1Package = {
    taxYear: 2024,
    entityName: "Lambda BadDiv LP",
    entityKind: "1065",
    boxes: { "6a": 1000, "6b": 5000 },
  };
  const ingBad = ingestK1Package(badDiv);
  checkTrue(
    "qualified > ordinary div → warning",
    ingBad.warnings.some((w) => w.includes("Qualified dividends exceed ordinary")),
  );

  // apportionment out of range → warning.
  const badApp: RawK1Package = {
    taxYear: 2024,
    entityName: "Mu BadApp LP",
    entityKind: "1065",
    boxes: { "1": 50000 },
    stateSchedules: [{ state: "TX", ordinaryIncome: 50000, apportionmentPct: 150 }],
  };
  const ingApp = ingestK1Package(badApp);
  checkTrue(
    "apportionment 150% → warning",
    ingApp.warnings.some((w) => w.includes("outside 0–100")),
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 10 — Batch helper: ingestK1Packages aggregates facts + prefixes warnings
// ════════════════════════════════════════════════════════════════════════════
{
  const pkgs: RawK1Package[] = [
    { taxYear: 2024, entityName: "Alpha LP", entityKind: "1065", activity: "active", boxes: { "1": 40000, "14A": 40000 } },
    { taxYear: 2024, entityName: "Bravo S-Corp", entityKind: "1120S", boxes: { "1": 30000, "4A": 7777 } },
  ];
  const batch = ingestK1Packages(pkgs);
  checkTrue("batch produced 2 facts", batch.facts.length === 2);
  checkTrue("batch fact 0 is partnership", batch.facts[0].entityType === "partnership");
  checkTrue("batch fact 1 is s_corp", batch.facts[1].entityType === "s_corp");
  checkTrue(
    "batch warning prefixed with entity name",
    batch.warnings.some((w) => w.startsWith("[Bravo S-Corp]") && w.includes("guaranteed payments")),
  );

  // Both flow through engine together: SE only from the partnership.
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    scheduleK1: batch.facts,
    taxYear: 2024,
  };
  const r = computeTaxReturnPure(inputs);
  // SE base = 40,000 (partnership only) → net 36,940; SS 4,580.56; Med 1,071.26; SE 5,651.82.
  check("ENGINE batch SE tax = $5,651.82 (partnership only)", r.selfEmploymentTax ?? 0, 5651.82, 0.5);
  check("ENGINE batch K-1 count = 2", r.scheduleK1.k1Count, 2, 0);
  check("ENGINE batch partnership=1", r.scheduleK1.partnershipCount, 1, 0);
  check("ENGINE batch s_corp=1", r.scheduleK1.sCorpCount, 1, 0);
  // Total active ordinary = 40,000 (P) + 30,000 (S, active default) = 70,000.
  check("ENGINE batch active ordinary = $70,000", r.scheduleK1.totalActiveOrdinaryIncome, 70000, 1);
}

console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
