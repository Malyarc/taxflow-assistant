import { Router, type IRouter } from "express";
import { eq, desc, and, ne, gte, lte, gt, sql, type SQL } from "drizzle-orm";
import { db, adjustmentsTable, clientsTable, taxReturnsTable } from "@workspace/db";
import {
  GetPlanningOpportunitiesParams,
  GetPlanningMemoParams,
  GetPlanningClientEmailParams,
  GetPlanningMissingDataParams,
  GetPlanningMultiYearParams,
  GetPlanningDiscoveryParams,
  RunWhatIfScenarioParams,
  RunWhatIfScenarioBody,
  RunStateComparisonParams,
  RunStateComparisonBody,
  RunRothOptimizerParams,
  RunRothOptimizerBody,
  GetPeerBenchmarkParams,
} from "@workspace/api-zod";
import { CATALOG_V1, type OpportunityHit } from "@workspace/planning-strategies";
import {
  evaluatePlanningOpportunities,
  evaluateCrossStrategyScenario,
  federalMarginalRate,
  planningScore,
} from "../lib/planningEngine";
import {
  evaluateMultiYearOpportunities,
  type TaxReturnSnapshot,
} from "../lib/planningEngineMultiYear";
import {
  generatePlanningMemo,
  generateClientOutreachEmail,
  inferMissingData,
  discoverPlanningCandidates,
} from "../lib/planningMemo";
import { consentRequired, hasValidConsent, AI_EXTRACTION_SCOPE } from "../lib/consentGate";
import { computeTaxReturn, loadTaxReturnInputs } from "../lib/taxReturnPipeline";
import { buildPlanningCalendar } from "../lib/planningCalendar";
import { optimizeRothConversionLadder } from "../lib/rothOptimizer";
import {
  runWhatIfScenario,
  runWhatIfScenarios,
  type WhatIfMutation,
  type WhatIfScenario,
} from "../lib/whatIfEngine";
import { computeTaxReturnPure } from "../lib/taxReturnEngine";
import type { AdjustmentFact, ClientFacts } from "../lib/taxReturnEngine";
import { logger } from "../lib/logger";
import { config } from "../lib/config";

/**
 * Coerce a drizzle numeric column (string | null) to a plain number. Used by
 * the multi-year route to build TaxReturnSnapshot[] from tax_returns rows.
 */
function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function loadPlanningContext(clientId: number) {
  const computed = await computeTaxReturn(clientId);
  if (!computed) return null;
  const adjustments = await db
    .select()
    .from(adjustmentsTable)
    .where(eq(adjustmentsTable.clientId, clientId));
  // H2 — pass the assembled inputs so detectors can run what-if scenarios
  // for engine-verified deltas.
  const hits = evaluatePlanningOpportunities({
    client: computed.client,
    computed: computed.result,
    adjustments: adjustments as AdjustmentFact[],
    baselineInputs: computed.inputs,
  });
  return { computed: computed.result, client: computed.client, hits };
}

const router: IRouter = Router();

/**
 * Phase G5 — Pro-tier gate. Applied to every planning endpoint via the
 * router. Returns 402 Payment Required with a stable machine-readable
 * code so the frontend can present an "Upgrade to Pro" CTA even if it
 * somehow hits this path with Pro disabled (defense in depth — the
 * frontend already gates the call sites via /api/settings).
 */
router.use((_req, res, next) => {
  if (!config.proTierEnabled) {
    res.status(402).json({
      error: "Pro tier required",
      code: "PRO_TIER_REQUIRED",
      message:
        "Tax-planning features (opportunity detection, AI memos, multi-year intelligence) are available on the Pro tier. Contact your firm administrator to upgrade.",
    });
    return;
  }
  next();
});

router.get("/clients/:clientId/planning-opportunities", async (req, res): Promise<void> => {
  const params = GetPlanningOpportunitiesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const computed = await computeTaxReturn(params.data.clientId);
    if (!computed) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    // Pull adjustments separately — computeTaxReturn doesn't surface them
    // but the planning detectors need them (e.g., G1.1 SEP-IRA suppression,
    // G1.2 PTET SALT lookup, G1.5 ISO bargain element, etc.).
    const adjustments = await db
      .select()
      .from(adjustmentsTable)
      .where(eq(adjustmentsTable.clientId, params.data.clientId));

    // H2 — pass baselineInputs so detectors can attach engine-verified
    // whatIf data to each opportunity hit.
    const hits = evaluatePlanningOpportunities({
      client: computed.client,
      computed: computed.result,
      adjustments: adjustments as AdjustmentFact[],
      baselineInputs: computed.inputs,
    });

    const totalEstSavings = hits.reduce((s, h) => s + h.estSavings, 0);

    // H7 — joint scenario stacking all "savings" H2 mutations together.
    // Returns undefined when <2 stackable hits are present.
    const crossStrategy = evaluateCrossStrategyScenario({
      hits,
      baselineInputs: computed.inputs,
    });

    res.json({
      clientId: params.data.clientId,
      taxYear: computed.result.taxYear,
      catalogVersion: CATALOG_V1.version,
      hits,
      totalEstSavings,
      ...(crossStrategy ? { crossStrategy } : {}),
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Planning evaluation failed");
    res.status(500).json({ error: "Planning evaluation failed" });
  }
});

// T1.3 — Deadline-aware planning calendar: the client's detected opportunities
// grouped by their action deadline (year-end → quarterly → filing → extended →
// ongoing), soonest-first, with per-group savings totals.
router.get("/clients/:clientId/planning-calendar", async (req, res): Promise<void> => {
  const params = GetPlanningOpportunitiesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const computed = await computeTaxReturn(params.data.clientId);
    if (!computed) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const adjustments = await db
      .select()
      .from(adjustmentsTable)
      .where(eq(adjustmentsTable.clientId, params.data.clientId));
    const hits = evaluatePlanningOpportunities({
      client: computed.client,
      computed: computed.result,
      adjustments: adjustments as AdjustmentFact[],
      baselineInputs: computed.inputs,
    });
    const calendar = buildPlanningCalendar(hits, computed.result.taxYear);
    res.json({
      clientId: params.data.clientId,
      catalogVersion: CATALOG_V1.version,
      ...calendar,
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Planning calendar failed");
    res.status(500).json({ error: "Planning calendar failed" });
  }
});

router.get("/clients/:clientId/planning-multi-year", async (req, res): Promise<void> => {
  const params = GetPlanningMultiYearParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, params.data.clientId));
    if (!client) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const rows = await db
      .select()
      .from(taxReturnsTable)
      .where(eq(taxReturnsTable.clientId, params.data.clientId))
      .orderBy(desc(taxReturnsTable.taxYear));

    // Build TaxReturnSnapshot[] in most-recent-first order. Missing
    // filingStatus (older rows) falls back to client.filingStatus so the
    // detector can still compute marginal rates.
    const history: TaxReturnSnapshot[] = rows.map((r) => ({
      taxYear: r.taxYear,
      filingStatus: r.filingStatus ?? client.filingStatus,
      adjustedGrossIncome: num(r.adjustedGrossIncome),
      taxableIncome: num(r.taxableIncome),
      itemizedDeductions: num(r.itemizedDeductions),
      amtTax: num(r.amtTax),
      niitTax: num(r.niitTax),
      medicalDeductible: num(r.medicalDeductible),
      saltDeductible: num(r.saltDeductible),
      mortgageDeductible: num(r.mortgageDeductible),
      charitableDeductible: num(r.charitableDeductible),
      capitalLossCarryforwardShort: num(r.capitalLossCarryforwardShort),
      capitalLossCarryforwardLong: num(r.capitalLossCarryforwardLong),
      scheduleEPassiveLossSuspended: num(r.scheduleEPassiveLossSuspended),
      k1PassiveLossSuspended: num(r.k1PassiveLossSuspended),
    }));

    const hits = evaluateMultiYearOpportunities({
      client: client as ClientFacts,
      history,
    });
    const totalEstSavings = hits.reduce((s, h) => s + h.estSavings, 0);
    const yearsCovered = history.map((h) => h.taxYear);

    res.json({
      clientId: params.data.clientId,
      taxYear: yearsCovered[0] ?? client.taxYear ?? new Date().getFullYear() - 1,
      catalogVersion: CATALOG_V1.version,
      hits,
      totalEstSavings,
      yearsAvailable: history.length,
      yearsCovered,
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Planning multi-year failed");
    res.status(500).json({ error: "Planning multi-year failed" });
  }
});

// P0-2 — §7216: an AI memo/email/discovery transmits the client's return
// information to Google Gemini (a "disclosure"). Block it when consent is
// required but not on file; the endpoints then use their deterministic
// (no-LLM) path instead of disclosing.
async function aiDisclosureBlocked(clientId: number): Promise<boolean> {
  return consentRequired() && !(await hasValidConsent(clientId, AI_EXTRACTION_SCOPE));
}

router.get("/clients/:clientId/planning-memo", async (req, res): Promise<void> => {
  const params = GetPlanningMemoParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const ctx = await loadPlanningContext(params.data.clientId);
    if (!ctx) { res.status(404).json({ error: "Client not found" }); return; }
    const result = await generatePlanningMemo({
      client: ctx.client, computed: ctx.computed, hits: ctx.hits,
      forceDeterministic: await aiDisclosureBlocked(params.data.clientId),
    });
    res.json({
      clientId: params.data.clientId,
      taxYear: ctx.computed.taxYear,
      content: result.memo,
      aiUsed: result.aiUsed,
      model: result.model,
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Planning memo failed");
    res.status(500).json({ error: "Planning memo failed" });
  }
});

router.get("/clients/:clientId/planning-email", async (req, res): Promise<void> => {
  const params = GetPlanningClientEmailParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const ctx = await loadPlanningContext(params.data.clientId);
    if (!ctx) { res.status(404).json({ error: "Client not found" }); return; }
    const result = await generateClientOutreachEmail({
      client: ctx.client, computed: ctx.computed, hits: ctx.hits,
      forceDeterministic: await aiDisclosureBlocked(params.data.clientId),
    });
    res.json({
      clientId: params.data.clientId,
      taxYear: ctx.computed.taxYear,
      content: result.memo,
      aiUsed: result.aiUsed,
      model: result.model,
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Planning email failed");
    res.status(500).json({ error: "Planning email failed" });
  }
});

router.get("/clients/:clientId/planning-missing-data", async (req, res): Promise<void> => {
  const params = GetPlanningMissingDataParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const ctx = await loadPlanningContext(params.data.clientId);
    if (!ctx) { res.status(404).json({ error: "Client not found" }); return; }
    const result = await inferMissingData({
      client: ctx.client, computed: ctx.computed, hits: ctx.hits,
      forceDeterministic: await aiDisclosureBlocked(params.data.clientId),
    });
    res.json({
      clientId: params.data.clientId,
      items: result.items,
      aiUsed: result.aiUsed,
      model: result.model,
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Planning missing-data failed");
    res.status(500).json({ error: "Planning missing-data failed" });
  }
});

// ── Phase H — H8 LLM fact-pattern strategy discovery ──────────────────────
router.get("/clients/:clientId/planning-discovery", async (req, res): Promise<void> => {
  const params = GetPlanningDiscoveryParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const ctx = await loadPlanningContext(params.data.clientId);
    if (!ctx) { res.status(404).json({ error: "Client not found" }); return; }
    if (await aiDisclosureBlocked(params.data.clientId)) {
      // §7216 — no consent on file: skip the LLM disclosure, return no candidates.
      res.json({ clientId: params.data.clientId, candidates: [], aiUsed: false, model: "stub" });
      return;
    }
    const result = await discoverPlanningCandidates({
      client: ctx.client, computed: ctx.computed, hits: ctx.hits,
    });
    res.json({
      clientId: params.data.clientId,
      candidates: result.candidates,
      aiUsed: result.aiUsed,
      model: result.model,
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Planning discovery failed");
    res.status(500).json({ error: "Planning discovery failed" });
  }
});

router.get("/planning-hit-list", async (req, res): Promise<void> => {
  const categoryFilter = typeof req.query.category === "string" ? req.query.category : null;
  const stateFilter =
    typeof req.query.state === "string" ? req.query.state.toUpperCase() : null;
  const minAgi = typeof req.query.minAgi === "string" ? Number(req.query.minAgi) : null;
  const maxAgi = typeof req.query.maxAgi === "string" ? Number(req.query.maxAgi) : null;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;

  const effectiveLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;

  type Entry = {
    clientId: number;
    firstName: string;
    lastName: string;
    email: string | null;
    state: string;
    taxYear: number;
    agi: number;
    federalMarginalRate: number;
    planningScore: number;
    totalEstSavings: number;
    numHits: number;
    topHits: OpportunityHit[];
  };

  // Build a full hit-list entry for one client by running the detectors (the
  // display details — topHits/totalEstSavings/numHits — can't be served from the
  // precomputed columns alone). Shared by the fast + slow paths. Returns null
  // when the client has no return, is out of the AGI band, or has no visible hits.
  const buildEntry = async (clientId: number): Promise<Entry | null> => {
    const computed = await computeTaxReturn(clientId);
    if (!computed) return null;
    const agi = computed.result.adjustedGrossIncome;
    if (minAgi != null && Number.isFinite(minAgi) && agi < minAgi) return null;
    if (maxAgi != null && Number.isFinite(maxAgi) && agi > maxAgi) return null;
    const hits = evaluatePlanningOpportunities({
      client: computed.client,
      computed: computed.result,
      adjustments: computed.inputs.adjustments,
    });
    const visibleHits = categoryFilter ? hits.filter((h) => h.category === categoryFilter) : hits;
    if (visibleHits.length === 0) return null;
    const fedRate = federalMarginalRate(computed.result);
    const score = planningScore({ hits: visibleHits, federalMarginalRate: fedRate });
    const totalEstSavings = visibleHits.reduce((s, h) => s + h.estSavings, 0);
    return {
      clientId,
      firstName: computed.client.firstName,
      lastName: computed.client.lastName,
      email: computed.client.email ?? null,
      state: computed.client.state ?? "",
      taxYear: computed.result.taxYear,
      agi: Math.round(agi),
      federalMarginalRate: fedRate,
      planningScore: Math.round(score),
      totalEstSavings: Math.round(totalEstSavings),
      numHits: visibleHits.length,
      topHits: visibleHits.slice(0, 3),
    };
  };

  try {
    // Pick the candidate client set.
    let candidateClientIds: number[];
    if (categoryFilter) {
      // SLOW PATH — a category filter changes which hits count toward the score,
      // so the all-category precomputed planning_score can't rank it correctly.
      // Evaluate every client (still error-isolated per client). This filter is
      // not used by the dashboard widget (the hot path); it's an API power-feature.
      const allClients = await db
        .select({ id: clientsTable.id, state: clientsTable.state })
        .from(clientsTable);
      candidateClientIds = allClients
        .filter((c) => !stateFilter || (c.state ?? "").toUpperCase() === stateFilter)
        .map((c) => c.id);
    } else {
      // FAST PATH (dashboard Top-10 + default hit-list) — rank by the precomputed
      // planning_score with a SINGLE indexed query (tax_returns_planning_score_idx),
      // pushing the state/AGI filters into SQL, and take the top-N. Display details
      // are then computed for ONLY those N clients — not the whole firm. The join
      // pins each client to their current-year return (clients.tax_year).
      const conditions: SQL[] = [gt(taxReturnsTable.planningScore, "0")];
      if (stateFilter) conditions.push(eq(sql`upper(${clientsTable.state})`, stateFilter));
      if (minAgi != null && Number.isFinite(minAgi)) {
        conditions.push(gte(taxReturnsTable.adjustedGrossIncome, String(minAgi)));
      }
      if (maxAgi != null && Number.isFinite(maxAgi)) {
        conditions.push(lte(taxReturnsTable.adjustedGrossIncome, String(maxAgi)));
      }
      const ranked = await db
        .select({ clientId: taxReturnsTable.clientId })
        .from(taxReturnsTable)
        .innerJoin(
          clientsTable,
          and(
            eq(clientsTable.id, taxReturnsTable.clientId),
            eq(clientsTable.taxYear, taxReturnsTable.taxYear),
          ),
        )
        .where(and(...conditions))
        .orderBy(desc(taxReturnsTable.planningScore))
        .limit(effectiveLimit);
      candidateClientIds = ranked.map((r) => r.clientId);
    }

    const entries: Entry[] = [];
    let skippedClients = 0;
    for (const clientId of candidateClientIds) {
      try {
        const entry = await buildEntry(clientId);
        if (entry) entries.push(entry);
      } catch (clientErr) {
        // Error isolation: one client with malformed data (or a schema drift on
        // one of its child tables) must NOT take down the entire firm-wide
        // hit-list. Log + skip that client; keep ranking the rest.
        skippedClients += 1;
        logger.warn(
          { err: clientErr, clientId },
          "Planning hit-list: skipping client (per-client compute failed)",
        );
      }
    }
    if (skippedClients > 0) {
      logger.warn({ skippedClients }, "Planning hit-list completed with skipped clients");
    }
    // Re-sort by the freshly-computed score (the SQL pre-rank may lag a hair
    // behind the live engine) and cap to the requested page size.
    entries.sort((a, b) => b.planningScore - a.planningScore);
    res.json({ catalogVersion: CATALOG_V1.version, entries: entries.slice(0, effectiveLimit) });
  } catch (err) {
    logger.error({ err }, "Planning hit list failed");
    res.status(500).json({ error: "Planning hit list failed" });
  }
});

// ── Phase H — H11 peer benchmark ───────────────────────────────────────────

/**
 * Default cohort band: ±$50,000 around target AGI. Wider bands include more
 * peers (more statistical power) but mix in clients with structurally
 * different tax profiles (e.g., a $200k AGI W-2 client vs a $200k AGI
 * S-corp owner with massive QBI). The default is conservative.
 */
const DEFAULT_PEER_BAND_WIDTH = 50_000;

function percentileRank(sortedValues: number[], target: number): number {
  if (sortedValues.length === 0) return 50;
  // Standard "weak" percentile rank: % of values strictly less than target,
  // plus half the % equal to target. Returns 0-100.
  let lt = 0;
  let eq = 0;
  for (const v of sortedValues) {
    if (v < target) lt++;
    else if (v === target) eq++;
  }
  return ((lt + eq * 0.5) / sortedValues.length) * 100;
}

function percentile(sortedValues: number[], pct: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  // Linear interpolation between adjacent ranks.
  const idx = (pct / 100) * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  const w = idx - lo;
  return sortedValues[lo] * (1 - w) + sortedValues[hi] * w;
}

router.get("/clients/:clientId/peer-benchmark", async (req, res): Promise<void> => {
  const params = GetPeerBenchmarkParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const bandWidthRaw = req.query.bandWidth;
  const bandWidth = typeof bandWidthRaw === "string" && Number.isFinite(Number(bandWidthRaw))
    ? Number(bandWidthRaw)
    : DEFAULT_PEER_BAND_WIDTH;
  if (bandWidth <= 0) {
    res.status(400).json({ error: "bandWidth must be > 0" });
    return;
  }

  try {
    // 1. Compute target client's return.
    const target = await computeTaxReturn(params.data.clientId);
    if (!target) {
      res.status(404).json({ error: "Client not found" });
      return;
    }
    const targetAgi = target.result.adjustedGrossIncome;
    const targetEffectiveRate = target.result.effectiveTaxRate;

    // 2. Load the peer cohort with ONE indexed query over the persisted
    // tax_returns columns (adjusted_gross_income + effective_tax_rate) — these
    // are written by the same engine via onConflictDoUpdate after every recalc,
    // so reading them is equivalent to recomputing, at 1 query instead of N full
    // DB-backed engine passes. The AGI band is pushed into SQL (served by
    // tax_returns_agi_idx), and the cohort is pinned to the target's tax year so
    // peers are compared like-for-like. Skip rows with no income (effective rate
    // undefined/inflated) — mirrors the old total_income > 0 guard.
    const cohortRows = await db
      .select({ effRate: taxReturnsTable.effectiveTaxRate })
      .from(taxReturnsTable)
      .where(
        and(
          eq(taxReturnsTable.taxYear, target.result.taxYear),
          ne(taxReturnsTable.clientId, params.data.clientId),
          gt(taxReturnsTable.totalIncome, "0"),
          gte(taxReturnsTable.adjustedGrossIncome, String(targetAgi - bandWidth)),
          lte(taxReturnsTable.adjustedGrossIncome, String(targetAgi + bandWidth)),
        ),
      );
    const peerRates: number[] = cohortRows
      .map((r) => Number(r.effRate))
      .filter((v) => Number.isFinite(v));

    if (peerRates.length === 0) {
      res.json({
        clientId: params.data.clientId,
        taxYear: target.result.taxYear,
        clientAgi: Math.round(targetAgi),
        clientEffectiveRate: targetEffectiveRate,
        cohort: {
          size: 0,
          agiMin: Math.round(targetAgi - bandWidth),
          agiMax: Math.round(targetAgi + bandWidth),
          effectiveRateMean: 0,
          effectiveRateMedian: 0,
          effectiveRateP25: 0,
          effectiveRateP75: 0,
          clientPercentileRank: 50,
        },
      });
      return;
    }

    const sorted = [...peerRates].sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const mean = sum / sorted.length;
    const median = percentile(sorted, 50);
    const p25 = percentile(sorted, 25);
    const p75 = percentile(sorted, 75);
    const rank = percentileRank(sorted, targetEffectiveRate);

    res.json({
      clientId: params.data.clientId,
      taxYear: target.result.taxYear,
      clientAgi: Math.round(targetAgi),
      clientEffectiveRate: targetEffectiveRate,
      cohort: {
        size: sorted.length,
        agiMin: Math.round(targetAgi - bandWidth),
        agiMax: Math.round(targetAgi + bandWidth),
        effectiveRateMean: mean,
        effectiveRateMedian: median,
        effectiveRateP25: p25,
        effectiveRateP75: p75,
        clientPercentileRank: rank,
      },
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Peer benchmark failed");
    res.status(500).json({ error: "Peer benchmark failed" });
  }
});

// ── Phase H — H4 state-residency comparison ────────────────────────────────

/**
 * Default target states for state-residency comparison: zero-income-tax
 * jurisdictions. CPAs can override via the request body. The client's
 * current state is auto-excluded from the comparison.
 */
const DEFAULT_STATE_COMPARISON_TARGETS = ["TX", "FL", "NV", "WA", "TN"] as const;

router.post("/clients/:clientId/state-comparison", async (req, res): Promise<void> => {
  const params = RunStateComparisonParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = RunStateComparisonBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const loaded = await loadTaxReturnInputs(params.data.clientId);
    if (!loaded) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const baselineState = (loaded.inputs.client.state ?? "").toUpperCase();
    const requested = (body.data.targetStates ?? DEFAULT_STATE_COMPARISON_TARGETS).map((s) =>
      s.toUpperCase(),
    );
    // Filter out the client's current state — comparing to self is noise.
    const targets = Array.from(new Set(requested)).filter((s) => s !== baselineState);

    if (targets.length === 0) {
      res.json({
        clientId: params.data.clientId,
        taxYear: loaded.inputs.taxYear,
        baselineState,
        baselineFederal: 0,
        baselineState_tax: 0,
        results: [],
      });
      return;
    }

    // For state-residency comparison, "move to state X" means the client
    // ALSO has their W-2 / 1099 income sourced to that state next year. The
    // generic WhatIfMutation API only supports client + adjustment changes,
    // not per-W-2 state edits. So we build the modified inputs manually,
    // rewriting client.state PLUS each W-2 / 1099 stateCode to the target.
    // Without this, the engine would treat the client as a TX resident with
    // CA-source wages and still owe CA non-resident tax.
    const baseline = computeTaxReturnPure(loaded.inputs);

    const computeForState = (target: string) => {
      const reInputs = {
        ...loaded.inputs,
        client: { ...loaded.inputs.client, state: target },
        w2s: loaded.inputs.w2s.map((w) => ({ ...w, stateCode: target })),
        form1099s: loaded.inputs.form1099s.map((f) => ({ ...f, stateCode: target })),
      };
      const scenario = computeTaxReturnPure(reInputs);
      return {
        state: target,
        deltaFederal: Math.round(scenario.federalTaxLiability - baseline.federalTaxLiability),
        deltaState: Math.round(scenario.stateTaxLiability - baseline.stateTaxLiability),
        deltaCombined: Math.round(
          scenario.federalTaxLiability + scenario.stateTaxLiability -
            baseline.federalTaxLiability - baseline.stateTaxLiability,
        ),
        scenarioFederal: Math.round(scenario.federalTaxLiability),
        scenarioState: Math.round(scenario.stateTaxLiability),
      };
    };
    const comparisonResults = targets
      .map(computeForState)
      .sort((a, b) => a.deltaCombined - b.deltaCombined);

    res.json({
      clientId: params.data.clientId,
      taxYear: loaded.inputs.taxYear,
      baselineState,
      baselineFederal: Math.round(baseline.federalTaxLiability),
      baselineState_tax: Math.round(baseline.stateTaxLiability),
      results: comparisonResults,
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "State comparison failed");
    res.status(500).json({ error: "State comparison failed" });
  }
});

// ── PLAN-B1 — Multi-year Roth-conversion bracket-fill optimizer ────────────
router.post("/clients/:clientId/roth-optimizer", async (req, res): Promise<void> => {
  const params = RunRothOptimizerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = RunRothOptimizerBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  try {
    const loaded = await loadTaxReturnInputs(params.data.clientId);
    if (!loaded) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const plan = optimizeRothConversionLadder(loaded.inputs, {
      horizonYears: body.data.horizonYears,
      traditionalIraBalance: body.data.traditionalIraBalance,
      incomeGrowth: body.data.incomeGrowth ?? undefined,
      iraGrowth: body.data.iraGrowth ?? undefined,
    });

    res.json({
      clientId: params.data.clientId,
      taxYear: loaded.inputs.taxYear,
      plan,
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Roth optimizer failed");
    res.status(500).json({ error: "Roth optimizer failed" });
  }
});

// ── Phase H — H2 what-if scenario endpoint ─────────────────────────────────

/**
 * Validate that each mutation has the fields required for its `kind`. The
 * OpenAPI schema can't express per-kind requirements (we kept it as a flat
 * object so codegen would produce a single zod schema), so the per-kind
 * check happens here. Returns a typed WhatIfMutation[] or throws with a
 * descriptive message for HTTP 400.
 */
function coerceWhatIfMutations(
  raw: ReadonlyArray<{
    kind: "set_adjustment" | "add_adjustment" | "remove_adjustment" | "set_client_field";
    adjustmentType?: string;
    amount?: number;
    field?: string;
    value?: unknown;
  }>,
): WhatIfMutation[] {
  return raw.map((m, i) => {
    switch (m.kind) {
      case "set_adjustment":
      case "add_adjustment":
        if (m.adjustmentType == null || m.amount == null) {
          throw new Error(`mutation[${i}] (${m.kind}) requires adjustmentType + amount`);
        }
        return { kind: m.kind, adjustmentType: m.adjustmentType, amount: m.amount };
      case "remove_adjustment":
        if (m.adjustmentType == null) {
          throw new Error(`mutation[${i}] (remove_adjustment) requires adjustmentType`);
        }
        return { kind: "remove_adjustment", adjustmentType: m.adjustmentType };
      case "set_client_field":
        if (m.field == null) {
          throw new Error(`mutation[${i}] (set_client_field) requires field`);
        }
        return {
          kind: "set_client_field",
          field: m.field as keyof ClientFacts,
          value: m.value ?? null,
        };
      default: {
        const exhaustive: never = m.kind;
        throw new Error(`mutation[${i}] unsupported kind: ${exhaustive as string}`);
      }
    }
  });
}

router.post("/clients/:clientId/what-if", async (req, res): Promise<void> => {
  const params = RunWhatIfScenarioParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = RunWhatIfScenarioBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  let mutations: WhatIfMutation[];
  try {
    mutations = coerceWhatIfMutations(body.data.mutations);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  try {
    const loaded = await loadTaxReturnInputs(params.data.clientId);
    if (!loaded) {
      res.status(404).json({ error: "Client not found" });
      return;
    }

    const scenario: WhatIfScenario = {
      scenarioId: body.data.scenarioId ?? undefined,
      label: body.data.label,
      mutations,
    };
    const result = runWhatIfScenario(loaded.inputs, scenario);

    res.json({
      clientId: params.data.clientId,
      taxYear: result.baseline.taxYear,
      scenarioId: result.scenarioId,
      label: result.label,
      mutations: result.mutations,
      delta: result.delta,
      baseline: {
        adjustedGrossIncome: result.baseline.adjustedGrossIncome,
        taxableIncome: result.baseline.taxableIncome,
        federalTaxLiability: result.baseline.federalTaxLiability,
        stateTaxLiability: result.baseline.stateTaxLiability,
        federalRefundOrOwed: result.baseline.federalRefundOrOwed,
        stateRefundOrOwed: result.baseline.stateRefundOrOwed,
        effectiveTaxRate: result.baseline.effectiveTaxRate,
      },
      scenario: {
        adjustedGrossIncome: result.scenario.adjustedGrossIncome,
        taxableIncome: result.scenario.taxableIncome,
        federalTaxLiability: result.scenario.federalTaxLiability,
        stateTaxLiability: result.scenario.stateTaxLiability,
        federalRefundOrOwed: result.scenario.federalRefundOrOwed,
        stateRefundOrOwed: result.scenario.stateRefundOrOwed,
        effectiveTaxRate: result.scenario.effectiveTaxRate,
      },
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "What-if scenario failed");
    res.status(500).json({ error: "What-if scenario failed" });
  }
});

export default router;
