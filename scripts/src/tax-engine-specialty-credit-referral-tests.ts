/**
 * G-8 — Specialty-credit REFERRAL detector — hand-calc'd tests.
 *
 * Pure; no API. Builds realistic clients via `computeTaxReturnPure`, then runs
 * `detectSpecialtyReferrals` and asserts each of the four detectors FIRES on a
 * positive client AND is SUPPRESSED on a negative one, plus the hand-calc'd
 * `estValue` for every fired referral.
 *
 * Hand-calc references (TY2024, all clients FL = no state tax unless noted):
 *
 *   cost_segregation:
 *     screenBasis = aggregate rentalProperties[].basis (or rental gross proxy)
 *     accelerated = screenBasis × 0.20
 *     estValue    = accelerated × federalMarginalRate × 0.5 (PV factor)
 *     gates: screenBasis ≥ $500,000 AND federal marginal ≥ 24%.
 *
 *   rd_credit_study:
 *     QRE present : estValue = 14% × max(0, QRE − 50% × prior-3-yr-avg QRE)
 *     QRE absent  : estValue = min($50,000, ownerBizIncome × 0.02), gate biz ≥ $250k
 *
 *   defined_benefit_plan:
 *     age-tier max {45:100k, 50:150k, 55:200k, 60:250k}
 *     contribution = min(tierMax, ownerBizIncome × 0.5)
 *     estValue     = contribution × federalMarginalRate
 *     gates: ownerBizIncome ≥ $250k AND age ≥ 45 AND no existing SE retirement ≥ $69k.
 *
 *   erc_specialty: SCREEN ONLY → estValue = 0 (review flag, not an estimate).
 *     gate: employer payroll marker > 0 OR ownerBizIncome ≥ $150k.
 *
 * Engine anchors confirmed by probe:
 *   - SE $400k single  → netSe 369,400; SE $80k → 73,880; SE $40k → 36,940.
 *   - MFJ W2 $500k + $800k-basis rental → taxable $500,800, marginal 0.35,
 *     scheduleERentalGrossNet 30,000.
 *   - S-corp active K-1 Box 1 $300k single → totalActiveOrdinaryIncome 300,000,
 *     netSe 0, taxable 228,320, marginal 0.32.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-specialty-credit-referral-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type AdjustmentFact,
  type ClientFacts,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  detectSpecialtyReferrals,
  type SpecialtyReferral,
  type ReferralKind,
} from "../../artifacts/api-server/src/lib/specialtyCreditReferral";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 1.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  cond ? PASS.push(`✓ ${label}`) : FAIL.push(`✗ ${label}`);
}

// ── fixture helpers ──────────────────────────────────────────────────────────
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

function build(inputs: Partial<TaxReturnInputs> & { client: ClientFacts; taxYear: number }) {
  const full = {
    w2s: [],
    form1099s: [],
    adjustments: [],
    ...inputs,
  } as unknown as TaxReturnInputs;
  const computed = computeTaxReturnPure(full);
  return {
    referrals: detectSpecialtyReferrals({
      client: full.client,
      computed,
      adjustments: full.adjustments,
      baselineInputs: full,
    }),
    computed,
  };
}
const get = (rs: SpecialtyReferral[], k: ReferralKind) => rs.find((r) => r.kind === k);
const has = (rs: SpecialtyReferral[], k: ReferralKind) => rs.some((r) => r.kind === k);

function header(t: string) {
  console.log(`\n-- ${t} --`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. COST SEGREGATION
// ═══════════════════════════════════════════════════════════════════════════
header("Cost-segregation");
{
  // POSITIVE — MFJ, W-2 $500k lifts marginal to 35%, $800k-basis residential rental.
  // Hand-calc: 800,000 × 0.20 × 0.35 × 0.5 = 28,000.
  const { referrals } = build({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 500000, taxYear: 2024 }],
    rentalProperties: [
      { taxYear: 2024, basis: 800000, rentalIncome: 60000, totalExpenses: 30000, propertyType: "residential", placedInServiceYear: 2024, isActiveParticipant: true },
    ],
    taxYear: 2024,
  });
  const cs = get(referrals, "cost_segregation");
  checkTrue("CS-1 cost_segregation FIRES ($800k basis, 35% marginal)", cs != null);
  check("CS-1 estValue = $28,000", cs?.estValue ?? -1, 28000);
  check("CS-1 federalMarginalRate input = 0.35", Number(cs?.inputs.federalMarginalRate ?? -1), 0.35, 0.001);
  check("CS-1 aggregateBuildingBasis input = $800,000", Number(cs?.inputs.aggregateBuildingBasis ?? -1), 800000);
  checkTrue("CS-1 basisIsProxy === false (real basis on file)", cs?.inputs.basisIsProxy === false);
  checkTrue("CS-1 confidence 0.6 (real basis)", (cs?.confidence ?? 0) === 0.6);
  checkTrue("CS-1 cites Cost Segregation ATG / §168", /Cost Segregation Audit Techniques Guide/.test(cs?.citation ?? ""));
  checkTrue("CS-1 nextStep routes to engineering partner", /engineering partner/i.test(cs?.nextStep ?? ""));
}
{
  // POSITIVE — two commercial buildings aggregating to $600k basis (>$500k),
  // MFJ W-2 $500k → 35%. Hand-calc: 600,000 × 0.20 × 0.35 × 0.5 = 21,000.
  const { referrals } = build({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 500000, taxYear: 2024 }],
    rentalProperties: [
      { taxYear: 2024, basis: 350000, rentalIncome: 40000, totalExpenses: 20000, propertyType: "commercial", placedInServiceYear: 2023, isActiveParticipant: true },
      { taxYear: 2024, basis: 250000, rentalIncome: 30000, totalExpenses: 15000, propertyType: "commercial", placedInServiceYear: 2022, isActiveParticipant: true },
    ],
    taxYear: 2024,
  });
  const cs = get(referrals, "cost_segregation");
  checkTrue("CS-2 aggregates two buildings → FIRES", cs != null);
  check("CS-2 estValue = $21,000", cs?.estValue ?? -1, 21000);
  check("CS-2 propertyCount = 2", Number(cs?.inputs.propertyCount ?? -1), 2);
  check("CS-2 commercialPropertyCount = 2", Number(cs?.inputs.commercialPropertyCount ?? -1), 2);
}
{
  // NEGATIVE — basis $200k < $500k threshold (even at 32% marginal).
  const { referrals } = build({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 500000, taxYear: 2024 }],
    rentalProperties: [
      { taxYear: 2024, basis: 200000, rentalIncome: 20000, totalExpenses: 10000, propertyType: "residential", placedInServiceYear: 2024, isActiveParticipant: true },
    ],
    taxYear: 2024,
  });
  checkTrue("CS-3 SUPPRESSED — basis $200k below $500k threshold", !has(referrals, "cost_segregation"));
}
{
  // NEGATIVE — $800k basis but low marginal rate (single, $50k wage → 12%).
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 50000, taxYear: 2024 }],
    rentalProperties: [
      { taxYear: 2024, basis: 800000, rentalIncome: 20000, totalExpenses: 18000, propertyType: "residential", placedInServiceYear: 2024, isActiveParticipant: true },
    ],
    taxYear: 2024,
  });
  checkTrue("CS-4 SUPPRESSED — marginal 12% below 24% gate", !has(referrals, "cost_segregation"));
}
{
  // NEGATIVE — no real estate at all (W-2 employee).
  const { referrals } = build({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 500000, taxYear: 2024 }],
    taxYear: 2024,
  });
  checkTrue("CS-5 SUPPRESSED — no rental real estate", !has(referrals, "cost_segregation"));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. R&D CREDIT STUDY (§41)
// ═══════════════════════════════════════════════════════════════════════════
header("R&D credit study (§41)");
{
  // POSITIVE (QRE present) — SE $300k + QRE $100k, prior-3-yr avg $40k.
  // Hand-calc: ascBase = 0.5 × 40,000 = 20,000; estValue = 0.14 × (100,000 − 20,000) = 11,200.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    adjustments: [A("self_employment_income", 300000), A("qualified_research_expenses", 100000), A("qualified_research_expenses_prior_avg", 40000)],
    taxYear: 2024,
  });
  const rd = get(referrals, "rd_credit_study");
  checkTrue("RD-1 FIRES on QRE marker", rd != null);
  check("RD-1 estValue = $11,200 (14% × (100k − 20k))", rd?.estValue ?? -1, 11200);
  checkTrue("RD-1 signal = qre_marker", rd?.inputs.signal === "qre_marker");
  check("RD-1 qualifiedResearchExpenses input = $100,000", Number(rd?.inputs.qualifiedResearchExpenses ?? -1), 100000);
  checkTrue("RD-1 confidence 0.6 (QRE present)", (rd?.confidence ?? 0) === 0.6);
  checkTrue("RD-1 cites §41 / Form 6765", /§41.*Form 6765/.test(rd?.citation ?? ""));
}
{
  // POSITIVE (QRE present, value rounds to $0 but marker still warrants a study)
  // SE $80k + QRE $30k, prior avg $100k → 0.14 × max(0, 30k − 50k) = 0.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    adjustments: [A("self_employment_income", 80000), A("qualified_research_expenses", 30000), A("qualified_research_expenses_prior_avg", 100000)],
    taxYear: 2024,
  });
  const rd = get(referrals, "rd_credit_study");
  checkTrue("RD-2 FIRES even when QRE below ASC base (marker is the signal)", rd != null);
  check("RD-2 estValue = $0 (QRE below base)", rd?.estValue ?? -1, 0);
}
{
  // POSITIVE (no QRE, business-income screen) — active S-corp K-1 Box 1 $300k.
  // Hand-calc: bizIncome 300,000 ≥ 250k; estValue = min(50,000, 300,000 × 0.02) = 6,000.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    scheduleK1: [{ taxYear: 2024, entityType: "s_corp", activityType: "active", box1OrdinaryIncome: 300000 }],
    taxYear: 2024,
  });
  const rd = get(referrals, "rd_credit_study");
  checkTrue("RD-3 FIRES on $300k active business (no QRE)", rd != null);
  check("RD-3 estValue placeholder = $6,000 (min($50k, 300k × 2%))", rd?.estValue ?? -1, 6000);
  checkTrue("RD-3 signal = business_income_screen", rd?.inputs.signal === "business_income_screen");
  check("RD-3 activeK1Ordinary input = $300,000", Number(rd?.inputs.activeK1Ordinary ?? -1), 300000);
  checkTrue("RD-3 confidence 0.35 (screen only)", (rd?.confidence ?? 0) === 0.35);
}
{
  // NEGATIVE — modest active business $200k < $250k gate, no QRE.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    scheduleK1: [{ taxYear: 2024, entityType: "s_corp", activityType: "active", box1OrdinaryIncome: 200000 }],
    taxYear: 2024,
  });
  checkTrue("RD-4 SUPPRESSED — $200k business below $250k, no QRE", !has(referrals, "rd_credit_study"));
}
{
  // NEGATIVE — pure W-2 employee (no business, no QRE).
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 300000, taxYear: 2024 }],
    taxYear: 2024,
  });
  checkTrue("RD-5 SUPPRESSED — W-2 wages are not business income", !has(referrals, "rd_credit_study"));
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. DEFINED-BENEFIT / CASH-BALANCE PLAN
// ═══════════════════════════════════════════════════════════════════════════
header("Defined-benefit / cash-balance plan");
{
  // POSITIVE — SE $400k single, age 55. netSe 369,400; tier(55) = 200,000;
  // contribution = min(200,000, round(369,400 × 0.5) = 184,700) = 184,700;
  // marginal 0.35 → estValue = 184,700 × 0.35 = 64,645.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 55 },
    adjustments: [A("self_employment_income", 400000)],
    taxYear: 2024,
  });
  const db = get(referrals, "defined_benefit_plan");
  checkTrue("DB-1 FIRES — age 55, $369k SE", db != null);
  check("DB-1 estValue = $64,645 (184,700 × 0.35)", db?.estValue ?? -1, 64645);
  check("DB-1 modeledContribution = $184,700", Number(db?.inputs.modeledContribution ?? -1), 184700);
  check("DB-1 ageTierMax = $200,000 (age 55)", Number(db?.inputs.ageTierMax ?? -1), 200000);
  check("DB-1 taxpayerAge input = 55", Number(db?.inputs.taxpayerAge ?? -1), 55);
  checkTrue("DB-1 cites §415(b) / §404(a)", /§415\(b\).*§404\(a\)/.test(db?.citation ?? ""));
  checkTrue("DB-1 nextStep routes to TPA / actuary", /actuary|administrator/i.test(db?.nextStep ?? ""));
}
{
  // POSITIVE — S-corp owner via active K-1 $300k, age 50.
  // tier(50) = 150,000; contribution = min(150,000, 150,000) = 150,000;
  // marginal 0.32 → estValue = 150,000 × 0.32 = 48,000.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 50 },
    scheduleK1: [{ taxYear: 2024, entityType: "s_corp", activityType: "active", box1OrdinaryIncome: 300000 }],
    taxYear: 2024,
  });
  const db = get(referrals, "defined_benefit_plan");
  checkTrue("DB-2 FIRES — age 50 S-corp owner ($300k active K-1)", db != null);
  check("DB-2 estValue = $48,000 (150,000 × 0.32)", db?.estValue ?? -1, 48000);
  check("DB-2 ageTierMax = $150,000 (age 50)", Number(db?.inputs.ageTierMax ?? -1), 150000);
}
{
  // NEGATIVE — same $400k SE but age 40 (< 45 gate).
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 40 },
    adjustments: [A("self_employment_income", 400000)],
    taxYear: 2024,
  });
  checkTrue("DB-3 SUPPRESSED — age 40 below 45 gate", !has(referrals, "defined_benefit_plan"));
}
{
  // NEGATIVE — age 55 but already funding a large SE retirement ($69k → suppress).
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 55 },
    adjustments: [A("self_employment_income", 400000), A("self_employed_retirement", 69000)],
    taxYear: 2024,
  });
  checkTrue("DB-4 SUPPRESSED — existing $69k SE retirement", !has(referrals, "defined_benefit_plan"));
}
{
  // NEGATIVE — age 55 but income too low (SE $40k → netSe ~36,940 < $250k).
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 55 },
    adjustments: [A("self_employment_income", 40000)],
    taxYear: 2024,
  });
  checkTrue("DB-5 SUPPRESSED — $37k SE below $250k gate", !has(referrals, "defined_benefit_plan"));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. ERC-ADJACENT / SPECIALTY PAYROLL-CREDIT REVIEW
// ═══════════════════════════════════════════════════════════════════════════
header("ERC-adjacent specialty review");
{
  // POSITIVE (payroll marker) — low-income SE ($80k) so the business proxy alone
  // wouldn't fire (netSe 73,880 < $150k), but a $250k employer payroll marker does.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    adjustments: [A("self_employment_income", 80000), A("employer_w2_wages_paid", 250000)],
    taxYear: 2024,
  });
  const erc = get(referrals, "erc_specialty");
  checkTrue("ERC-1 FIRES on employer payroll marker", erc != null);
  check("ERC-1 estValue = $0 (review flag only)", erc?.estValue ?? -1, 0);
  check("ERC-1 employerWagesPaid input = $250,000", Number(erc?.inputs.employerWagesPaid ?? -1), 250000);
  checkTrue("ERC-1 signal = payroll_marker", erc?.inputs.signal === "payroll_marker");
  checkTrue("ERC-1 reviewOnly === true", erc?.inputs.reviewOnly === true);
  checkTrue("ERC-1 LOW confidence ≤ 0.4", (erc?.confidence ?? 1) <= 0.4);
  checkTrue("ERC-1 cites §3134", /§3134/.test(erc?.citation ?? ""));
  checkTrue("ERC-1 rationale flags VERIFY eligibility/deadlines", /verify/i.test(erc?.rationale ?? ""));
  checkTrue("ERC-1 nextStep is eligibility-first (not a promoter)", /eligibility/i.test(erc?.nextStep ?? ""));
}
{
  // POSITIVE (business proxy) — active S-corp K-1 $300k (≥ $150k proxy), no marker.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    scheduleK1: [{ taxYear: 2024, entityType: "s_corp", activityType: "active", box1OrdinaryIncome: 300000 }],
    taxYear: 2024,
  });
  const erc = get(referrals, "erc_specialty");
  checkTrue("ERC-2 FIRES on $300k active-business proxy", erc != null);
  checkTrue("ERC-2 signal = business_proxy", erc?.inputs.signal === "business_proxy");
  check("ERC-2 estValue = $0", erc?.estValue ?? -1, 0);
}
{
  // NEGATIVE — pure W-2 employee: own wages are NOT an employer relationship.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ wagesBox1: 300000, taxYear: 2024 }],
    taxYear: 2024,
  });
  checkTrue("ERC-3 SUPPRESSED — own W-2 wages ≠ employer", !has(referrals, "erc_specialty"));
}
{
  // NEGATIVE — tiny SE ($40k → ~36,940 < $150k proxy), no payroll marker.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    adjustments: [A("self_employment_income", 40000)],
    taxYear: 2024,
  });
  checkTrue("ERC-4 SUPPRESSED — $37k SE below $150k proxy, no payroll", !has(referrals, "erc_specialty"));
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. ORCHESTRATOR — multi-fire + sort-by-estValue-desc + empty case
// ═══════════════════════════════════════════════════════════════════════════
header("Orchestrator");
{
  // A real-estate-rich, high-SE, older owner with QRE: cost-seg + R&D + DB + ERC
  // should ALL fire. Sorted by estValue desc.
  // SE $400k single age 55 (netSe 369,400) + $900k-basis rental + QRE.
  // Marginal here is single ~35% (taxable well into 35% bracket).
  const { referrals, computed } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 55 },
    adjustments: [
      A("self_employment_income", 400000),
      A("qualified_research_expenses", 200000),
      A("qualified_research_expenses_prior_avg", 50000),
      A("employer_w2_wages_paid", 300000),
    ],
    rentalProperties: [
      { taxYear: 2024, basis: 900000, rentalIncome: 60000, totalExpenses: 30000, propertyType: "commercial", placedInServiceYear: 2024, isActiveParticipant: true },
    ],
    taxYear: 2024,
  });
  checkTrue("ORCH-1 cost_segregation fires", has(referrals, "cost_segregation"));
  checkTrue("ORCH-1 rd_credit_study fires", has(referrals, "rd_credit_study"));
  checkTrue("ORCH-1 defined_benefit_plan fires", has(referrals, "defined_benefit_plan"));
  checkTrue("ORCH-1 erc_specialty fires", has(referrals, "erc_specialty"));
  check("ORCH-1 all four fire", referrals.length, 4);
  // Sorted desc by estValue.
  const vals = referrals.map((r) => r.estValue);
  const sortedDesc = vals.every((v, i) => i === 0 || vals[i - 1] >= v);
  checkTrue("ORCH-1 sorted by estValue desc", sortedDesc);
  // ERC ($0) must sort last.
  checkTrue("ORCH-1 erc_specialty ($0) sorts last", referrals[referrals.length - 1].kind === "erc_specialty");
  // All estValues finite & non-negative.
  checkTrue("ORCH-1 all estValues finite & ≥ 0", referrals.every((r) => Number.isFinite(r.estValue) && r.estValue >= 0));
  // Marginal sanity — confirm we built a 35% client.
  checkTrue("ORCH-1 high marginal (taxable in top brackets)", computed.taxableIncome > 300000);
}
{
  // Empty case — a low-income W-2 employee fires NOTHING.
  const { referrals } = build({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 30 },
    w2s: [{ wagesBox1: 60000, taxYear: 2024 }],
    taxYear: 2024,
  });
  check("ORCH-2 no referrals for a $60k W-2 employee", referrals.length, 0);
}
{
  // Determinism — same inputs twice → identical output (pure).
  const mk = () =>
    build({
      client: { filingStatus: "single", state: "FL", taxYear: 2024, taxpayerAge: 55 },
      adjustments: [A("self_employment_income", 400000)],
      taxYear: 2024,
    }).referrals;
  checkTrue("ORCH-3 deterministic (identical JSON on repeat)", JSON.stringify(mk()) === JSON.stringify(mk()));
}

console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
