/**
 * Tax Planning detection engine — Layer 2.
 *
 * Reads the engine's deterministic output (ComputedTaxReturn + client +
 * adjustments) and emits OpportunityHit[]. **No LLM, no math estimation by
 * language model.** Every $-amount is computed here from IRS-cited formulas.
 *
 * Adding a new rule:
 *   1. Add a catalog entry in lib/planning-strategies/src/strategies-v1.json
 *      (id, IRC citation, confidence, action template, etc.).
 *   2. Add a `detectXXX(...)` function below that returns OpportunityHit | null.
 *   3. Wire it into `evaluatePlanningOpportunities` so it runs on every client.
 *   4. Add at least 3 positive + 2 negative + 1 boundary test in
 *      scripts/src/tax-engine-planning-tests.ts. Hand-calc every expected.
 *
 * Invariant: detectors MUST be pure — same inputs → same hits. No I/O, no
 * randomness, no Date.now(). The LLM (Layer 4) consumes these hits; if the
 * math drifts the memos drift with it.
 */

import {
  CATALOG_V1,
  type OpportunityHit,
  type PlanningStrategy,
} from "@workspace/planning-strategies";
import type { ComputedTaxReturn, ClientFacts, AdjustmentFact } from "./taxReturnEngine";
import {
  calculateFederalTaxWithBreakdown,
  calculateStateTaxWithBreakdown,
  getFederalStandardDeduction,
} from "./taxCalculator";

// ── Helpers ────────────────────────────────────────────────────────────────

function toNum(val: string | number | null | undefined): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function strategyById(id: string): PlanningStrategy {
  const s = CATALOG_V1.strategies.find((x) => x.id === id);
  if (!s) throw new Error(`planningEngine: catalog missing strategy ${id}`);
  return s;
}

/**
 * Template substitution. Replaces {{key}} with the formatted value.
 * Numbers are formatted with commas, no decimals (planning-tier values).
 */
function interpolate(template: string, vars: Record<string, number | string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = vars[key];
    if (v == null) return `{{${key}}}`;
    if (typeof v === "number") {
      return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    }
    return String(v);
  });
}

/**
 * Federal marginal rate at the client's current taxable income. Re-derives
 * from `calculateFederalTaxWithBreakdown` so the rate matches whatever the
 * engine actually used for the tax computation.
 */
function federalMarginalRate(computed: ComputedTaxReturn): number {
  const { marginalRate } = calculateFederalTaxWithBreakdown(
    computed.taxableIncome,
    computed.filingStatus,
    computed.taxYear,
  );
  return marginalRate;
}

/**
 * State marginal rate at the client's federal AGI (which is the state base
 * before state-specific subtractions in most states). Returns 0 for states
 * with no income tax (FL, TX, WA, etc.).
 */
function stateMarginalRate(computed: ComputedTaxReturn): number {
  const { marginalRate } = calculateStateTaxWithBreakdown(
    computed.adjustedGrossIncome,
    computed.stateCode,
    computed.filingStatus,
    computed.taxYear,
  );
  return marginalRate;
}

// ── G1.1 — SEP-IRA / Solo 401(k) ───────────────────────────────────────────

/**
 * §415(c) annual additions limit for defined-contribution plans (SEP, Solo 401k
 * employer-side). Per IRS Notice 2023-75 (TY2024) and Notice 2024-80 (TY2025).
 */
const SEP_ANNUAL_LIMIT: Record<number, number> = {
  2024: 69000,
  2025: 70000,
};

/**
 * Self-employment net-earnings threshold below which the SEP planning
 * opportunity is too small to justify the recommendation. Matches the
 * Phase G plan: rule should fire at net SE ≥ $30,000.
 */
const SEP_NET_SE_TRIGGER = 30000;

/**
 * Whether the client already has an existing SEP / Solo 401(k) contribution
 * adjustment. Engine does not yet model SEP/Solo401k as a first-class
 * adjustment type, so this catches future adjustment-type names by string
 * convention. When the schema adds an explicit type, no detector change is
 * needed.
 */
function hasExistingSepOrSolo(adjustments: AdjustmentFact[]): boolean {
  return adjustments.some((a) => {
    if (a.isApplied === false) return false;
    const t = (a.adjustmentType ?? "").toLowerCase();
    if (toNum(a.amount) <= 0) return false;
    return (
      t.includes("sep_ira") ||
      t.includes("solo_401k") ||
      t.includes("solo401k") ||
      t.includes("self_employed_retirement") ||
      t === "sep" ||
      t === "solo401k"
    );
  });
}

function detectSepIra(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { client, computed, adjustments } = args;
  if (client.filingStatus === "married_filing_separately") return null;

  const netSe = computed.detail.se.netSeEarnings;
  if (netSe < SEP_NET_SE_TRIGGER) return null;
  if (hasExistingSepOrSolo(adjustments)) return null;

  const halfSe = computed.detail.se.deductibleHalf;
  const sepCap = SEP_ANNUAL_LIMIT[computed.taxYear] ?? SEP_ANNUAL_LIMIT[2025];
  // Pub 560: contribution = 20% of (net SE earnings − half-SE-tax deduction)
  // for the self-employed individual (the rate-conversion of the 25%-of-net-
  // compensation employer rule). Capped at the §415(c) annual additions limit.
  const baseForContribution = Math.max(0, netSe - halfSe);
  const contribution = Math.min(baseForContribution * 0.20, sepCap);
  if (contribution <= 0) return null;

  const fedRate = federalMarginalRate(computed);
  const stateRate = stateMarginalRate(computed);
  const estSavings = contribution * (fedRate + stateRate);

  const strategy = strategyById("G1.1");
  const contributionRounded = Math.round(contribution);
  const vars: Record<string, number | string> = {
    contribution: contributionRounded,
    estSavings: Math.round(estSavings),
  };
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const combinedPct = Math.round((fedRate + stateRate) * 1000) / 10;
  const rationale =
    `Net SE earnings of ${fmt(Math.round(netSe))} support a SEP-IRA contribution of ~${fmt(contributionRounded)} ` +
    `at a combined federal+state marginal rate of ${combinedPct}%.`;

  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      netSeEarnings: Math.round(netSe),
      halfSeDeduction: Math.round(halfSe),
      sepCap,
      federalMarginalRate: fedRate,
      stateMarginalRate: stateRate,
      contribution: Math.round(contribution),
    },
  };
}

// ── G1.2 — PTET (Pass-Through Entity Tax) election ────────────────────────

/**
 * States that have enacted a Pass-Through Entity Tax regime that lets
 * S-corp / partnership owners bypass the federal $10k SALT cap. List per the
 * Phase G plan (AICPA tracker as of 2026-05). New states are added as they
 * enact PTET; date-version the catalog when the list changes.
 */
const PTET_ELECTING_STATES: ReadonlySet<string> = new Set([
  "AL", "AZ", "AR", "CA", "CO", "CT", "GA", "HI", "IL", "IN",
  "IA", "KS", "KY", "LA", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NJ", "NM", "NY", "NC", "OH", "OK", "OR", "RI",
  "SC", "UT", "VA", "WV", "WI",
]);

function detectPtetElection(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  // Resident state must have a PTET regime.
  const state = (client.state ?? "").toUpperCase();
  if (!PTET_ELECTING_STATES.has(state)) return null;

  // Must be a K-1 client with active (i.e. non-passive) pass-through income.
  // Passive K-1 income doesn't benefit from PTET in the same way (the rule
  // is intended for owner-operators of S-corps / partnerships).
  const activeK1 = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  if (activeK1 <= 0) return null;

  // Cap must actually bind: itemizing AND saltDeductible at the cap.
  if (computed.itemizedDeductions == null) return null;
  const saltCap = client.filingStatus === "married_filing_separately" ? 5000 : 10000;
  const { saltDeductible, saltUncapped } = computed.scheduleA;
  if (Math.round(saltDeductible) !== saltCap) return null;
  if (saltUncapped <= saltCap) return null;

  const fedRate = federalMarginalRate(computed);
  const recoverable = saltUncapped - saltCap;
  const estSavings = recoverable * fedRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.2");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = {
    estSavings: Math.round(estSavings),
    recoverableSalt: Math.round(recoverable),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Resident state ${state} has a PTET regime; SALT cap binds at ${fmt(saltCap)} but ` +
      `${fmt(Math.round(saltUncapped))} of state + property tax was paid. Electing PTET would deduct ` +
      `~${fmt(Math.round(recoverable))} at the entity level instead.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      state,
      activeK1Income: Math.round(activeK1),
      saltUncapped: Math.round(saltUncapped),
      saltCap,
      recoverableSalt: Math.round(recoverable),
      federalMarginalRate: fedRate,
    },
  };
}

// ── G1.10 — Foreign Tax Credit unclaimed ──────────────────────────────────

function sumAdjustment(adjustments: AdjustmentFact[], type: string): number {
  return adjustments
    .filter((a) => a.adjustmentType === type && a.isApplied !== false)
    .reduce((s, a) => s + toNum(a.amount), 0);
}

function detectForeignTaxCreditGap(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const foreignTaxPaid = sumAdjustment(adjustments, "foreign_tax_paid");
  if (foreignTaxPaid <= 0) return null;
  const claimed = computed.foreignTaxCredit?.credit ?? 0;
  // Fire when the engine's auto-claimed FTC is materially below the foreign
  // tax actually paid — typically because the simplified $300/$600 limit
  // capped it and Form 1116 wasn't filed.
  if (claimed >= foreignTaxPaid * 0.95) return null;
  const recoverable = foreignTaxPaid - claimed;
  if (recoverable <= 0) return null;

  const strategy = strategyById("G1.10");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = {
    estSavings: Math.round(recoverable),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(recoverable),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Foreign tax paid of ${fmt(Math.round(foreignTaxPaid))} but only ${fmt(Math.round(claimed))} claimed as FTC. ` +
      `Filing Form 1116 with foreign-source taxable income unlocks ~${fmt(Math.round(recoverable))} of additional credit.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      foreignTaxPaid: Math.round(foreignTaxPaid),
      currentlyClaimed: Math.round(claimed),
      recoverable: Math.round(recoverable),
    },
  };
}

// ── G1.3 — Bunching itemized vs standard ──────────────────────────────────

function detectBunching(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const charitableCash = sumAdjustment(adjustments, "charitable_cash");
  if (charitableCash <= 0) return null;

  // NB: computed.standardDeduction is the *chosen* deduction (max of std vs
  // itemized). For this detector we need the actual standard-deduction value
  // to compute the ±15% band. Pull it directly from the calculator helper.
  const stdDed = getFederalStandardDeduction(computed.filingStatus, computed.taxYear);
  const itemizedTotal = computed.scheduleA.totalItemized;
  // Within ±15% of std ded — bunching has the highest leverage right at the
  // cliff. Filers far below std ded already lose itemized value; filers far
  // above already itemize comfortably and don't need bunching.
  if (itemizedTotal < stdDed * 0.85) return null;
  if (itemizedTotal > stdDed * 1.15) return null;

  const fedRate = federalMarginalRate(computed);
  // Phase G plan formula. The 0.25 × stdDed approximates the average annual
  // benefit of an alternating-year itemize/standard pattern: you "recover"
  // half the std ded one year (worth marginalRate of that half), averaged
  // over the 2-year cycle (×0.5).
  const estSavings = stdDed * 0.25 * fedRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.3");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(estSavings) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Itemized total ${fmt(Math.round(itemizedTotal))} is within +/- 15% of the ${fmt(stdDed)} ` +
      `standard deduction, and there is ${fmt(Math.round(charitableCash))} of cash charitable giving ` +
      `that could be bunched.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      itemizedTotal: Math.round(itemizedTotal),
      standardDeduction: stdDed,
      charitableCash: Math.round(charitableCash),
      federalMarginalRate: fedRate,
    },
  };
}

// ── G1.8 — Charitable Donor-Advised Fund bunching ─────────────────────────

const G1_8_MIN_CHARITABLE = 5000;
const G1_8_MIN_MARGINAL_RATE = 0.32;

function detectCharitableDaf(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  const charitableCash = sumAdjustment(adjustments, "charitable_cash");
  if (charitableCash <= G1_8_MIN_CHARITABLE) return null;

  const fedRate = federalMarginalRate(computed);
  if (fedRate < G1_8_MIN_MARGINAL_RATE) return null;

  // Phase G plan formula: (charitableCash × 2) × marginalRate × 0.2.
  // The 2× reflects bunching 2-3 years into one; the 0.2 reflects the
  // fraction recoverable above the standard-deduction floor in the bunch
  // year (empirical from the AICPA tax-planning playbook).
  const estSavings = charitableCash * 2 * fedRate * 0.2;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.8");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(estSavings) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Cash charitable giving of ${fmt(Math.round(charitableCash))} at a ${(fedRate * 100).toFixed(0)}% ` +
      `federal marginal rate is a strong fit for DAF front-loading.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      charitableCash: Math.round(charitableCash),
      federalMarginalRate: fedRate,
    },
  };
}

// ── G1.4 — Roth conversion window ─────────────────────────────────────────

const G1_4_MAX_MARGINAL = 0.24;
const G1_4_EXPECTED_FUTURE_RATE = 0.32;
const G1_4_MIN_AGE = 30;
const G1_4_MAX_AGE = 72;

function detectRothConversion(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  const fedRate = federalMarginalRate(computed);
  // Only fire when there's a meaningful spread vs the assumed future rate.
  if (fedRate >= G1_4_MAX_MARGINAL) return null;

  const age = client.taxpayerAge;
  // Unknown age → fire (CPA judgment call). Known age outside range → suppress.
  if (age != null && (age < G1_4_MIN_AGE || age > G1_4_MAX_AGE)) return null;

  // Headroom to the top of the current bracket. Use calculateFederalTaxWith-
  // Breakdown to find the last bracket hit; cap on the 37% bracket is Infinity
  // so we can't fill it.
  const { breakdown } = calculateFederalTaxWithBreakdown(
    computed.taxableIncome,
    computed.filingStatus,
    computed.taxYear,
  );
  if (breakdown.length === 0) return null;
  const currentBracket = breakdown[breakdown.length - 1];
  if (!Number.isFinite(currentBracket.bracketMax)) return null;
  const conversion = Math.max(0, currentBracket.bracketMax - computed.taxableIncome);
  if (conversion <= 0) return null;

  const spread = G1_4_EXPECTED_FUTURE_RATE - fedRate;
  const estSavings = conversion * spread;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.4");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = {
    estSavings: Math.round(estSavings),
    conversion: Math.round(conversion),
    currentRate: `${(fedRate * 100).toFixed(0)}%`,
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Client sits at a ${(fedRate * 100).toFixed(0)}% federal marginal rate with ` +
      `${fmt(Math.round(conversion))} of headroom to the top of the current bracket. ` +
      `Converting traditional IRA to Roth this year locks in that rate vs an assumed ` +
      `future rate of ${(G1_4_EXPECTED_FUTURE_RATE * 100).toFixed(0)}%.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      federalMarginalRate: fedRate,
      bracketTop: currentBracket.bracketMax,
      conversion: Math.round(conversion),
      assumedFutureRate: G1_4_EXPECTED_FUTURE_RATE,
      taxpayerAge: age ?? null,
    },
  };
}

// ── G1.5 — AMT timing (ISO bargain element) ────────────────────────────────

function detectAmtIsoTiming(args: {
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}): OpportunityHit | null {
  const { computed, adjustments } = args;
  if (computed.amtTax <= 0) return null;
  const isoBargain = sumAdjustment(adjustments, "amt_iso_bargain_element");
  if (isoBargain <= 0) return null;

  // The entire AMT could potentially be deferred OR avoided by either
  // spreading exercises across years (so AMT exemption covers more of it)
  // or doing a same-year disqualifying sale (converts AMT-preference to
  // ordinary W-2 income). estSavings = amtTax (the upper bound).
  const strategy = strategyById("G1.5");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(computed.amtTax) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(computed.amtTax),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `AMT of ${fmt(Math.round(computed.amtTax))} driven by ${fmt(Math.round(isoBargain))} of ISO ` +
      `bargain element. Spreading the exercise across multiple tax years OR a same-year ` +
      `disqualifying sale would convert the preference and likely eliminate the AMT.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      amtTax: Math.round(computed.amtTax),
      isoBargainElement: Math.round(isoBargain),
    },
  };
}

// ── G1.6 — NIIT cliff avoidance ────────────────────────────────────────────

const NIIT_THRESHOLDS: Record<string, number> = {
  single: 200000,
  head_of_household: 200000,
  married_filing_jointly: 250000,
  qualifying_widow: 250000,
  married_filing_separately: 125000,
};

const G1_6_BAND = 10000;

function detectNiitCliff(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  const threshold = NIIT_THRESHOLDS[client.filingStatus] ?? NIIT_THRESHOLDS.single;
  const agi = computed.adjustedGrossIncome;
  // Symmetric band per spec. "Below threshold" case still fires (as an early
  // warning) but estSavings is zero so it won't rank into the top hits.
  if (agi < threshold - G1_6_BAND) return null;
  if (agi > threshold + G1_6_BAND) return null;

  const nii = computed.detail.niit?.investmentIncome ?? 0;
  if (nii <= 0) return null;

  const niitTax = computed.niitTax;
  // Round up; estSavings = current NIIT (the upper bound recoverable by
  // dropping AGI below the threshold).
  if (niitTax <= 0) return null;

  const strategy = strategyById("G1.6");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = {
    estSavings: Math.round(niitTax),
    threshold: threshold,
    deferAmount: Math.round(agi - threshold),
  };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(niitTax),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `AGI ${fmt(Math.round(agi))} sits ${fmt(Math.round(agi - threshold))} above the ${fmt(threshold)} ` +
      `NIIT threshold with ${fmt(Math.round(nii))} of investment income. Dropping AGI below the ` +
      `threshold removes the 3.8% NIIT entirely.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      agi: Math.round(agi),
      threshold,
      excess: Math.round(agi - threshold),
      netInvestmentIncome: Math.round(nii),
      niitTax: Math.round(niitTax),
    },
  };
}

// ── G1.7 — §199A wage / UBIA limit (K-1) ──────────────────────────────────

/**
 * §199A taxable-income thresholds (Rev. Proc. 2023-34 TY2024 + 2024-40 TY2025).
 * Below threshold: no wage/UBIA limit. Within phase-in band: limit phases in.
 * Above phase-in top: wage/UBIA limit binds fully.
 *
 * For TY2024:
 *   Single / MFS / HoH: threshold $191,950, top $241,950
 *   MFJ / QSS:           threshold $383,900, top $483,900
 *
 * For TY2025:
 *   Single / MFS / HoH: threshold $197,300, top $247,300
 *   MFJ / QSS:           threshold $394,600, top $494,600
 */
const QBI_THRESHOLDS: Record<number, Record<string, { threshold: number; top: number }>> = {
  2024: {
    single: { threshold: 191950, top: 241950 },
    married_filing_separately: { threshold: 191950, top: 241950 },
    head_of_household: { threshold: 191950, top: 241950 },
    married_filing_jointly: { threshold: 383900, top: 483900 },
    qualifying_widow: { threshold: 383900, top: 483900 },
  },
  2025: {
    single: { threshold: 197300, top: 247300 },
    married_filing_separately: { threshold: 197300, top: 247300 },
    head_of_household: { threshold: 197300, top: 247300 },
    married_filing_jointly: { threshold: 394600, top: 494600 },
    qualifying_widow: { threshold: 394600, top: 494600 },
  },
};

function detectQbiPhaseIn(args: {
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { computed } = args;
  const k1Active = computed.scheduleK1?.totalActiveOrdinaryIncome ?? 0;
  const qbi = computed.detail.qbi?.qbiAmount ?? 0;
  // Only fires for K-1 / pass-through clients with QBI income.
  if (k1Active <= 0 || qbi <= 0) return null;

  const cfg = QBI_THRESHOLDS[computed.taxYear];
  if (!cfg) return null;
  const tier = cfg[computed.filingStatus] ?? cfg.single;
  const taxableBeforeQbi = computed.taxableIncome + computed.qbiDeduction;
  if (taxableBeforeQbi <= tier.threshold) return null;
  if (taxableBeforeQbi > tier.top) return null;

  const fedRate = federalMarginalRate(computed);
  // Phase G plan proxy: 50% of QBI income is at risk of wage/UBIA-limit
  // erosion when in the phase-in band. The engine doesn't model the limit
  // (it applies the simplified flat 20%); proper Form 8995-A might reduce
  // the QBI deduction. Recoverable estSavings = lost_qbi × 0.20 × marginalRate.
  const lostQbi = qbi * 0.5;
  const estSavings = lostQbi * 0.20 * fedRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.7");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(estSavings) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Taxable-before-QBI ${fmt(Math.round(taxableBeforeQbi))} is in the §199A phase-in band ` +
      `(${fmt(tier.threshold)}-${fmt(tier.top)}). Engine applies simplified 20% × QBI; proper ` +
      `Form 8995-A wage/UBIA structuring could recover up to ~${fmt(Math.round(estSavings))} of ` +
      `federal tax.`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      taxableBeforeQbi: Math.round(taxableBeforeQbi),
      qbiAmount: Math.round(qbi),
      lostQbi: Math.round(lostQbi),
      threshold: tier.threshold,
      phaseInTop: tier.top,
      federalMarginalRate: fedRate,
    },
  };
}

// ── G1.9 — Tax-loss harvesting ────────────────────────────────────────────

const G1_9_MAX_OFFSET = 3000;
const G1_9_MAX_OFFSET_MFS = 1500;

function detectTaxLossHarvesting(args: {
  client: ClientFacts;
  computed: ComputedTaxReturn;
}): OpportunityHit | null {
  const { client, computed } = args;
  const maxOffset = client.filingStatus === "married_filing_separately"
    ? G1_9_MAX_OFFSET_MFS
    : G1_9_MAX_OFFSET;
  if (computed.capitalLossDeducted >= maxOffset) return null;

  // Has capital-market activity: either gains (something to offset) or
  // losses (some history of trading). We don't fire for pure-W-2 clients
  // who'd have to open a brokerage from scratch to even harvest losses.
  const ltcg = computed.form1099Summary?.longTermCapitalGains ?? 0;
  const stcg = computed.form1099Summary?.shortTermCapitalGains ?? 0;
  const netCap = computed.netCapitalGainLoss ?? 0;
  if (ltcg <= 0 && stcg <= 0 && netCap === 0) return null;

  const fedRate = federalMarginalRate(computed);
  // Phase G plan: flat $3k × ordinary marginal rate. The "rest" of harvested
  // losses beyond the $3k cap carries forward indefinitely (upside not
  // captured in the headline number — surfaced in the rationale).
  const estSavings = maxOffset * fedRate;
  if (estSavings <= 0) return null;

  const strategy = strategyById("G1.9");
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const vars = { estSavings: Math.round(estSavings) };
  return {
    strategyId: strategy.id,
    name: strategy.name,
    category: strategy.category,
    estSavings: Math.round(estSavings),
    confidence: strategy.confidence,
    cpaEffortHours: strategy.cpaEffortHours,
    recurring: strategy.recurring,
    rationale:
      `Current capital-loss deduction ${fmt(Math.round(computed.capitalLossDeducted))} is below ` +
      `the ${fmt(maxOffset)} annual cap. Harvesting unrealized losses to reach the cap saves ` +
      `~${fmt(Math.round(estSavings))} of federal tax (plus carryforward upside on losses ` +
      `beyond the cap).`,
    action: interpolate(strategy.action, vars),
    prerequisiteData: strategy.prerequisiteData,
    citation: `${strategy.ircSection}; ${strategy.irsPub}`,
    inputs: {
      capitalLossDeducted: Math.round(computed.capitalLossDeducted),
      maxOffset,
      longTermCapitalGains: Math.round(ltcg),
      shortTermCapitalGains: Math.round(stcg),
      netCapitalGainLoss: Math.round(netCap),
      federalMarginalRate: fedRate,
    },
  };
}

// ── Top-level evaluator ────────────────────────────────────────────────────

export interface PlanningInputs {
  client: ClientFacts;
  computed: ComputedTaxReturn;
  adjustments: AdjustmentFact[];
}

/**
 * Run all detectors over a single client's computed tax return.
 * Returns hits sorted by `estSavings` descending so the highest-impact
 * opportunity is presented first in the Planning tab.
 */
export function evaluatePlanningOpportunities(args: PlanningInputs): OpportunityHit[] {
  const hits: OpportunityHit[] = [];
  const sepIra = detectSepIra(args);
  if (sepIra) hits.push(sepIra);
  const ptet = detectPtetElection({ client: args.client, computed: args.computed });
  if (ptet) hits.push(ptet);
  const ftc = detectForeignTaxCreditGap({ computed: args.computed, adjustments: args.adjustments });
  if (ftc) hits.push(ftc);
  const bunching = detectBunching({ computed: args.computed, adjustments: args.adjustments });
  if (bunching) hits.push(bunching);
  const daf = detectCharitableDaf({ computed: args.computed, adjustments: args.adjustments });
  if (daf) hits.push(daf);
  const roth = detectRothConversion({ client: args.client, computed: args.computed });
  if (roth) hits.push(roth);
  const amtIso = detectAmtIsoTiming({ computed: args.computed, adjustments: args.adjustments });
  if (amtIso) hits.push(amtIso);
  const niit = detectNiitCliff({ client: args.client, computed: args.computed });
  if (niit) hits.push(niit);
  const qbi = detectQbiPhaseIn({ computed: args.computed });
  if (qbi) hits.push(qbi);
  const tlh = detectTaxLossHarvesting({ client: args.client, computed: args.computed });
  if (tlh) hits.push(tlh);
  hits.sort((a, b) => b.estSavings - a.estSavings);
  return hits;
}
