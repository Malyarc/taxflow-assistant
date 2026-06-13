/**
 * G-8 — Specialty-credit REFERRAL detector.
 *
 * From data the firm already holds, flag clients who are candidates for a
 * SPECIALIST engagement and route them to the partner-referral workflow:
 *
 *   1. cost_segregation     — engineering study to accelerate building depreciation
 *   2. rd_credit_study      — §41 research-credit study (Form 6765)
 *   3. defined_benefit_plan — DB / cash-balance retirement plan for an owner
 *   4. erc_specialty        — pandemic-era / other specialty payroll-credit review
 *
 * These are referral SCREENS, NOT exact credit computations. Each fired
 * referral carries a clearly-heuristic `estValue`, a `confidence`, an IRS/
 * authority `citation`, the diagnostic `inputs` that drove the flag, and a
 * `nextStep` that hands the client off to the relevant outside specialist.
 *
 * The dollar credit math for the strategies the engine actually models (e.g.
 * the real §41 ASC credit) lives in the planning engine — this module's job is
 * narrower: surface the candidate so a CPA opens a specialist engagement.
 *
 * PURITY INVARIANT (Haven-portable): NO Date / Math.random / DB / fs / network
 * / process. Anything time-based (e.g. a tax year) is a parameter. Same inputs
 * → same referrals. This file deliberately does NOT import the planning catalog
 * — it reuses only the pure engine types + pure bracket math.
 */

import type {
  ComputedTaxReturn,
  ClientFacts,
  AdjustmentFact,
  TaxReturnInputs,
} from "./taxReturnEngine";
import { toNum } from "./taxReturnEngine";
import { calculateFederalTaxWithBreakdown } from "./taxCalculator";

// ── Public surface ──────────────────────────────────────────────────────────

export type ReferralKind =
  | "cost_segregation"
  | "rd_credit_study"
  | "defined_benefit_plan"
  | "erc_specialty";

export interface SpecialtyReferral {
  kind: ReferralKind;
  name: string;
  rationale: string;
  /** rough first-year/value estimate, clearly heuristic */
  estValue: number;
  confidence: number;
  citation: string;
  /** diagnostic numbers driving the flag */
  inputs: Record<string, number | string | boolean | null>;
  nextStep: string;
}

export interface SpecialtyReferralArgs {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
  baselineInputs: TaxReturnInputs;
}

// ── Shared helpers (pure) ─────────────────────────────────────────────────────

/**
 * Federal marginal rate at the client's current taxable income. Re-derives
 * from `calculateFederalTaxWithBreakdown` (pure bracket math) so it matches the
 * rate the engine actually used. We re-derive locally (rather than importing
 * the planning engine's helper) to keep this module a standalone leaf.
 */
function federalMarginalRate(computed: ComputedTaxReturn): number {
  const { marginalRate } = calculateFederalTaxWithBreakdown(
    computed.taxableIncome,
    computed.filingStatus,
    computed.taxYear,
  );
  return marginalRate;
}

/** Sum of applied adjustments of a given type (mirrors planningEngine.sumAdjustment). */
function sumAdjustment(adjustments: AdjustmentFact[], type: string): number {
  return adjustments
    .filter((a) => a.adjustmentType === type && a.isApplied !== false)
    .reduce((s, a) => s + toNum(a.amount), 0);
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Net self-employment / active-business earnings the OWNER controls. We use the
 * engine's computed SE net earnings (Schedule C + K-1 Box 14A flowed in) PLUS
 * active K-1 ordinary income (S-corp pass-through profit isn't SE-taxed but is
 * still owner business income for plan-funding / cost-seg screens).
 */
function ownerBusinessIncome(computed: ComputedTaxReturn): {
  netSe: number;
  activeK1: number;
  total: number;
} {
  const netSe = Math.max(0, computed.detail?.se?.netSeEarnings ?? 0);
  const activeK1 = Math.max(0, computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0);
  return { netSe, activeK1, total: netSe + activeK1 };
}

// ── 1. Cost-segregation study ─────────────────────────────────────────────────
//
// SCREEN: a client with depreciable real estate where the building basis (or,
// absent an entered basis, the rental gross as a proxy) is large enough that an
// engineering study pays for itself, AND a marginal rate high enough for the
// accelerated deduction to be worth pulling forward.
//
// Thresholds (hand-set):
//   - building basis (or rental gross proxy) ≥ $500,000. Studies cost ~$5k-$15k;
//     a ~$500k building yields enough 5/15-yr reclassification (~20%) that the
//     first-year acceleration dwarfs the fee.
//   - federal marginal rate ≥ 24%. Below that the deferral value is thin.
//
// estValue (heuristic NPV-of-acceleration proxy):
//   accelerated basis = buildingBasis × 0.20   (≈20% reclassified to 5/15-yr; a
//                                                conservative midpoint of the
//                                                15-30% range cited by providers)
//   estValue = accelerated basis × marginalRate × PV_FACTOR
//   PV_FACTOR = 0.5 — the deferral is worth ~half the nominal tax on the
//   reclassified basis once you net out future recapture + time value (a
//   deliberately conservative "is this worth a referral?" proxy, NOT the study's
//   actual first-year bonus deduction, which depends on placed-in-service date).
//
// Authority: IRS Cost Segregation Audit Techniques Guide (ATG); IRC §168
//            (MACRS class lives); Form 3115 §481(a) for catch-up on prior years.
const COSTSEG_MIN_BASIS = 500_000;
const COSTSEG_MIN_MARGINAL = 0.24;
const COSTSEG_RECLASS_FRACTION = 0.20;
const COSTSEG_PV_FACTOR = 0.5;

function detectCostSegregation(args: SpecialtyReferralArgs): SpecialtyReferral | null {
  const { computed, baselineInputs } = args;

  // Prefer the entered per-property building basis; fall back to the rental
  // gross (Schedule E aggregate) as a proxy when basis isn't captured yet.
  const props = baselineInputs.rentalProperties ?? [];
  const yearProps = props.filter(
    (p) => (p.taxYear ?? computed.taxYear) === computed.taxYear,
  );
  const totalBasis = yearProps.reduce((s, p) => s + toNum(p.basis), 0);
  const rentalGross = Math.abs(computed.scheduleERentalGrossNet ?? 0);
  // The basis is the real screening number; if no basis is entered, use rental
  // gross as a (weaker) proxy for "there's substantial real estate here".
  const screenBasis = totalBasis > 0 ? totalBasis : rentalGross;
  const basisIsProxy = totalBasis <= 0;

  // Need substantial real estate AND a real estate signal at all.
  if (yearProps.length === 0 && rentalGross <= 0) return null;
  if (screenBasis < COSTSEG_MIN_BASIS) return null;

  const fedRate = federalMarginalRate(computed);
  if (fedRate < COSTSEG_MIN_MARGINAL) return null;

  const acceleratedBasis = screenBasis * COSTSEG_RECLASS_FRACTION;
  const estValue = Math.round(acceleratedBasis * fedRate * COSTSEG_PV_FACTOR);
  if (estValue <= 0) return null;

  const commercialCount = yearProps.filter(
    (p) => (p.propertyType ?? "").toLowerCase() === "commercial",
  ).length;

  return {
    kind: "cost_segregation",
    name: "Cost-segregation study",
    rationale:
      `Client holds depreciable real estate with ${
        basisIsProxy
          ? `~${fmtUsd(Math.round(screenBasis))} of rental gross (no building basis on file yet)`
          : `${fmtUsd(Math.round(screenBasis))} of aggregate building basis`
      } at a ${(fedRate * 100).toFixed(0)}% federal marginal rate. An engineering ` +
      `cost-segregation study can reclassify ~${Math.round(
        COSTSEG_RECLASS_FRACTION * 100,
      )}% of building basis into 5/7/15-year property eligible for accelerated ` +
      `(and, by placed-in-service date, bonus) depreciation — pulling deductions forward.`,
    estValue,
    // Higher confidence when we have a real entered basis vs a rental-gross proxy.
    confidence: basisIsProxy ? 0.45 : 0.6,
    citation: "IRS Cost Segregation Audit Techniques Guide; IRC §168 (MACRS class lives); Form 3115 §481(a)",
    inputs: {
      propertyCount: yearProps.length,
      commercialPropertyCount: commercialCount,
      aggregateBuildingBasis: Math.round(totalBasis),
      rentalGross: Math.round(rentalGross),
      screenBasis: Math.round(screenBasis),
      basisIsProxy,
      federalMarginalRate: fedRate,
      reclassFraction: COSTSEG_RECLASS_FRACTION,
      acceleratedBasis: Math.round(acceleratedBasis),
      pvFactor: COSTSEG_PV_FACTOR,
    },
    nextStep:
      "Refer to a cost-seg engineering partner (KBKG / Marshall & Stevens / CSSI); " +
      "gather building basis, land allocation, and placed-in-service dates. For pre-owned " +
      "property, a Form 3115 §481(a) catch-up recoups missed depreciation in one year.",
  };
}

// ── 2. R&D credit study (§41) ────────────────────────────────────────────────
//
// SCREEN: the client either already has qualified-research-expense (QRE) markers
// on file, OR runs an active trade/business large enough (SE / active-K-1
// receipts ≥ $250k) to plausibly have wages/supplies tied to product or software
// development worth a study.
//
// Thresholds (hand-set):
//   - QRE present  → always screen (any positive QRE marker = a real signal).
//   - else active business income ≥ $250,000 → screen as a candidate.
//
// estValue:
//   - QRE present: ASC proxy = 14% × max(0, QRE − 50% × prior-3-yr-avg QRE).
//     (Pre-§280C; this is a SCREEN, not the engine's §280C-reduced/§38-limited
//     number. The engine's planning detector reports the exact credit.)
//   - QRE absent: a screening PLACEHOLDER = activeBusinessIncome × 0.02, capped
//     at $50,000 — a deliberately modest "worth a conversation" figure (real QRE
//     is unknown until the study scopes wages/supplies/contract research).
//
// Authority: IRC §41 (ASC, §41(c)(5)); Form 6765; Treas. Reg. §1.41-4 (4-part test).
const RD_MIN_BUSINESS_INCOME = 250_000;
const RD_ASC_RATE = 0.14;
const RD_PLACEHOLDER_RATE = 0.02;
const RD_PLACEHOLDER_CAP = 50_000;

function detectRdCreditStudy(args: SpecialtyReferralArgs): SpecialtyReferral | null {
  const { computed, adjustments } = args;

  const qre = sumAdjustment(adjustments, "qualified_research_expenses");
  const priorAvgQre = sumAdjustment(adjustments, "qualified_research_expenses_prior_avg");
  const { netSe, activeK1, total: bizIncome } = ownerBusinessIncome(computed);

  const hasQre = qre > 0;
  const hasQualifyingBusiness = bizIncome >= RD_MIN_BUSINESS_INCOME;
  if (!hasQre && !hasQualifyingBusiness) return null;

  let estValue: number;
  let confidence: number;
  let rationale: string;
  if (hasQre) {
    // ASC proxy (pre-§280C, pre-§38-limit): 14% × (QRE − 50% × prior-3-yr avg).
    const ascBase = 0.5 * priorAvgQre;
    estValue = Math.round(RD_ASC_RATE * Math.max(0, qre - ascBase));
    confidence = 0.6;
    rationale =
      `Client reported ${fmtUsd(Math.round(qre))} of qualified research expenses` +
      (priorAvgQre > 0 ? ` (prior-3-yr avg ${fmtUsd(Math.round(priorAvgQre))})` : ` (no prior base — startup posture)`) +
      `. A formal §41 study can substantiate the credit (ASC = 14% over 50% of the prior-3-yr QRE base) ` +
      `and document the §41(d) four-part test.`;
    // Even when the screening ASC value rounds to $0 (QRE below base), the marker
    // itself is a strong signal a study is warranted — keep the referral.
  } else {
    estValue = Math.round(Math.min(RD_PLACEHOLDER_CAP, bizIncome * RD_PLACEHOLDER_RATE));
    confidence = 0.35;
    rationale =
      `Active trade/business with ${fmtUsd(Math.round(bizIncome))} of owner business income ` +
      `(SE ${fmtUsd(Math.round(netSe))} + active K-1 ${fmtUsd(Math.round(activeK1))}). Businesses developing ` +
      `products, software, or processes frequently have unclaimed §41 research credits — worth scoping wages, ` +
      `supplies, and contract research against the four-part test.`;
  }
  if (estValue < 0) return null;

  return {
    kind: "rd_credit_study",
    name: "R&D credit study (§41)",
    rationale,
    estValue,
    confidence,
    citation: "IRC §41 (ASC §41(c)(5)); Form 6765; Treas. Reg. §1.41-4 (four-part test)",
    inputs: {
      qualifiedResearchExpenses: Math.round(qre),
      priorThreeYearAvgQre: Math.round(priorAvgQre),
      netSeEarnings: Math.round(netSe),
      activeK1Ordinary: Math.round(activeK1),
      ownerBusinessIncome: Math.round(bizIncome),
      signal: hasQre ? "qre_marker" : "business_income_screen",
      ascRate: hasQre ? RD_ASC_RATE : null,
      placeholderRate: hasQre ? null : RD_PLACEHOLDER_RATE,
    },
    nextStep:
      "Refer to an R&D-credit specialist (alliantgroup / KBKG / Source Advisors); " +
      "scope qualifying wages, supplies, and contract research, build the §41(d) four-part-test " +
      "narrative, and file Form 6765 (consider the §41(h) payroll-tax election for a qualified small business).",
  };
}

// ── 3. Defined-benefit / cash-balance plan ────────────────────────────────────
//
// SCREEN: a high-earning self-employed owner / S-corp owner who is old enough
// that a DB / cash-balance plan permits a very large deductible contribution
// (the §415(b) benefit limit funds faster the closer the owner is to retirement).
//
// Thresholds (hand-set):
//   - owner business income (net SE + active K-1) ≥ $250,000 (room to fund a DB
//     on top of any DC plan).
//   - taxpayer age ≥ 45 (younger owners can't amortize enough to justify it).
//   - suppress if an existing large SE-retirement contribution is already on file
//     (≥ $69,000 — the TY2024 §415(c) DC limit) to avoid double-counting.
//
// estValue:
//   age-tiered deductible-contribution proxy (heuristic; actual cap needs an
//   actuarial §415(b) calc): 45-49 = $100k, 50-54 = $150k, 55-59 = $200k,
//   60+ = $250k; contribution = min(tier, ownerIncome × 0.5).
//   estValue = contribution × federal marginal rate (federal tax deferred).
//
// Authority: IRC §415(b) (annual-benefit limit); IRC §404(a) (deduction).
const DB_MIN_BUSINESS_INCOME = 250_000;
const DB_MIN_AGE = 45;
const DB_EXISTING_RETIREMENT_SUPPRESS = 69_000;
const DB_AGE_TIERS: Array<{ minAge: number; max: number }> = [
  { minAge: 60, max: 250_000 },
  { minAge: 55, max: 200_000 },
  { minAge: 50, max: 150_000 },
  { minAge: 45, max: 100_000 },
];

function detectDefinedBenefitPlan(args: SpecialtyReferralArgs): SpecialtyReferral | null {
  const { client, computed, adjustments } = args;

  const age = client.taxpayerAge;
  if (age == null || age < DB_MIN_AGE) return null;

  const { netSe, activeK1, total: bizIncome } = ownerBusinessIncome(computed);
  if (bizIncome < DB_MIN_BUSINESS_INCOME) return null;

  const existingRetirement = sumAdjustment(adjustments, "self_employed_retirement");
  if (existingRetirement >= DB_EXISTING_RETIREMENT_SUPPRESS) return null;

  const tier = DB_AGE_TIERS.find((t) => age >= t.minAge);
  if (!tier) return null;
  const contribution = Math.min(tier.max, Math.round(bizIncome * 0.5));

  const fedRate = federalMarginalRate(computed);
  const estValue = Math.round(contribution * fedRate);
  if (estValue <= 0) return null;

  return {
    kind: "defined_benefit_plan",
    name: "Defined-benefit / cash-balance plan",
    rationale:
      `Owner age ${age} with ${fmtUsd(Math.round(bizIncome))} of business income (SE ${fmtUsd(
        Math.round(netSe),
      )} + active K-1 ${fmtUsd(Math.round(activeK1))}) is in the sweet spot for a defined-benefit or ` +
      `cash-balance plan. Age-tiered deductible-contribution proxy: ${fmtUsd(tier.max)}; modeled ` +
      `contribution ${fmtUsd(contribution)} → ~${fmtUsd(estValue)} of federal tax deferred at the ${(
        fedRate * 100
      ).toFixed(0)}% marginal rate.`,
    estValue,
    confidence: 0.5,
    citation: "IRC §415(b) (annual-benefit limit); IRC §404(a) (deduction)",
    inputs: {
      taxpayerAge: age,
      netSeEarnings: Math.round(netSe),
      activeK1Ordinary: Math.round(activeK1),
      ownerBusinessIncome: Math.round(bizIncome),
      ageTierMax: tier.max,
      modeledContribution: contribution,
      federalMarginalRate: fedRate,
      existingRetirementContribution: Math.round(existingRetirement),
    },
    nextStep:
      "Refer to a third-party administrator / actuary (e.g. a cash-balance specialist) for a §415(b) " +
      "funding study; gather owner age, comp history, and any W-2 staff (nondiscrimination testing applies). " +
      "Volatile income → consider a cash-balance (hybrid) design over a traditional DB plan.",
  };
}

// ── 4. ERC-adjacent / other specialty payroll-credit review ───────────────────
//
// SCREEN ONLY (LOW confidence): the ERC claim period has largely CLOSED, so this
// is purely a "does this business warrant a specialty review of any remaining or
// uncertain pandemic-era / payroll credits?" flag — never an estimate of an
// actual claim. Fire it for a client whose entity pays W-2 wages (i.e. an
// employer), keeping confidence low and the rationale conservative.
//
// "Employer" signal (from data already on file):
//   - a payroll/wage marker the owner's entity supplied
//     (`employer_w2_wages_paid` / `business_w2_wages_paid`), OR
//   - the client runs a substantial active business (SE / active-K-1 ≥ $150k) —
//     a proxy for "likely has employees" worth a conservation review.
//
// We do NOT fire on the taxpayer's OWN W-2 wages (that's employee income, not an
// employer relationship).
//
// estValue: intentionally $0 — this is a review flag, NOT a credit estimate.
//
// Authority: IRC §3134 (Employee Retention Credit); IRS ERC guidance
//            (IR-2023-169 moratorium; claim-period deadlines).
const ERC_PAYROLL_MARKERS = ["employer_w2_wages_paid", "business_w2_wages_paid"] as const;
const ERC_BUSINESS_PROXY = 150_000;
const ERC_CONFIDENCE = 0.3;

function detectErcSpecialty(args: SpecialtyReferralArgs): SpecialtyReferral | null {
  const { computed, adjustments } = args;

  const payrollPaid = ERC_PAYROLL_MARKERS.reduce(
    (s, m) => s + sumAdjustment(adjustments, m),
    0,
  );
  const { netSe, activeK1, total: bizIncome } = ownerBusinessIncome(computed);

  const hasPayrollMarker = payrollPaid > 0;
  const hasBusinessProxy = bizIncome >= ERC_BUSINESS_PROXY;
  if (!hasPayrollMarker && !hasBusinessProxy) return null;

  return {
    kind: "erc_specialty",
    name: "ERC-adjacent / specialty payroll-credit review",
    rationale:
      `Client's entity ${
        hasPayrollMarker
          ? `paid ${fmtUsd(Math.round(payrollPaid))} of W-2 wages`
          : `runs a substantial active business (${fmtUsd(Math.round(bizIncome))} owner income — likely an employer)`
      }. The ERC claim window has largely closed and the IRS moratorium/audit posture is active, so this is ` +
      `a CONSERVATIVE review flag ONLY: confirm whether any remaining or uncertain pandemic-era payroll ` +
      `credits apply and VERIFY eligibility and the (now largely expired) claim deadlines before acting.`,
    // A review flag, not a credit estimate.
    estValue: 0,
    confidence: ERC_CONFIDENCE,
    citation: "IRC §3134 (Employee Retention Credit); IRS ERC guidance (IR-2023-169 moratorium; claim-period deadlines)",
    inputs: {
      employerWagesPaid: Math.round(payrollPaid),
      netSeEarnings: Math.round(netSe),
      activeK1Ordinary: Math.round(activeK1),
      ownerBusinessIncome: Math.round(bizIncome),
      signal: hasPayrollMarker ? "payroll_marker" : "business_proxy",
      reviewOnly: true,
    },
    nextStep:
      "Refer to an ERC/payroll-credit specialist for an ELIGIBILITY-FIRST review (NOT a promoter): " +
      "verify the gross-receipts decline / suspension test and the claim-period deadlines, and screen for " +
      "any improper prior claim (the IRS Voluntary Disclosure / withdrawal programs may apply).",
  };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Run all four specialty-referral detectors, return the ones that fire, sorted
 * by `estValue` descending (ties broken by a stable detector order so output is
 * deterministic).
 */
export function detectSpecialtyReferrals(
  args: SpecialtyReferralArgs,
): SpecialtyReferral[] {
  const detectors: Array<(a: SpecialtyReferralArgs) => SpecialtyReferral | null> = [
    detectCostSegregation,
    detectRdCreditStudy,
    detectDefinedBenefitPlan,
    detectErcSpecialty,
  ];
  const hits: SpecialtyReferral[] = [];
  for (const d of detectors) {
    const hit = d(args);
    if (hit) hits.push(hit);
  }
  // Sort by estValue desc; the detectors[] order above is the stable tiebreak.
  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => b.h.estValue - a.h.estValue || a.i - b.i)
    .map((x) => x.h);
}
