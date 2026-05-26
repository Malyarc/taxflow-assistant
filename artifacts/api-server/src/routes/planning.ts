import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, adjustmentsTable, clientsTable, taxReturnsTable } from "@workspace/db";
import {
  GetPlanningOpportunitiesParams,
  GetPlanningMemoParams,
  GetPlanningClientEmailParams,
  GetPlanningMissingDataParams,
  GetPlanningMultiYearParams,
} from "@workspace/api-zod";
import { CATALOG_V1, type OpportunityHit } from "@workspace/planning-strategies";
import {
  evaluatePlanningOpportunities,
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
} from "../lib/planningMemo";
import { computeTaxReturn } from "../lib/taxReturnPipeline";
import type { AdjustmentFact, ClientFacts } from "../lib/taxReturnEngine";
import { logger } from "../lib/logger";

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
  const hits = evaluatePlanningOpportunities({
    client: computed.client,
    computed: computed.result,
    adjustments: adjustments as AdjustmentFact[],
  });
  return { computed: computed.result, client: computed.client, hits };
}

const router: IRouter = Router();

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

    const hits = evaluatePlanningOpportunities({
      client: computed.client,
      computed: computed.result,
      adjustments: adjustments as AdjustmentFact[],
    });

    const totalEstSavings = hits.reduce((s, h) => s + h.estSavings, 0);

    res.json({
      clientId: params.data.clientId,
      taxYear: computed.result.taxYear,
      catalogVersion: CATALOG_V1.version,
      hits,
      totalEstSavings,
    });
  } catch (err) {
    logger.error({ err, clientId: params.data.clientId }, "Planning evaluation failed");
    res.status(500).json({ error: "Planning evaluation failed" });
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

router.get("/clients/:clientId/planning-memo", async (req, res): Promise<void> => {
  const params = GetPlanningMemoParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const ctx = await loadPlanningContext(params.data.clientId);
    if (!ctx) { res.status(404).json({ error: "Client not found" }); return; }
    const result = await generatePlanningMemo({
      client: ctx.client, computed: ctx.computed, hits: ctx.hits,
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

router.get("/planning-hit-list", async (req, res): Promise<void> => {
  const categoryFilter = typeof req.query.category === "string" ? req.query.category : null;
  const stateFilter =
    typeof req.query.state === "string" ? req.query.state.toUpperCase() : null;
  const minAgi = typeof req.query.minAgi === "string" ? Number(req.query.minAgi) : null;
  const maxAgi = typeof req.query.maxAgi === "string" ? Number(req.query.maxAgi) : null;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;

  try {
    const allClients = await db.select().from(clientsTable);
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
    const entries: Entry[] = [];
    for (const c of allClients) {
      if (stateFilter && (c.state ?? "").toUpperCase() !== stateFilter) continue;
      const computed = await computeTaxReturn(c.id);
      if (!computed) continue;
      const agi = computed.result.adjustedGrossIncome;
      if (minAgi != null && Number.isFinite(minAgi) && agi < minAgi) continue;
      if (maxAgi != null && Number.isFinite(maxAgi) && agi > maxAgi) continue;
      const adjustments = await db
        .select()
        .from(adjustmentsTable)
        .where(eq(adjustmentsTable.clientId, c.id));
      const hits = evaluatePlanningOpportunities({
        client: computed.client,
        computed: computed.result,
        adjustments: adjustments as AdjustmentFact[],
      });
      const visibleHits = categoryFilter
        ? hits.filter((h) => h.category === categoryFilter)
        : hits;
      if (visibleHits.length === 0) continue;
      const fedRate = federalMarginalRate(computed.result);
      const score = planningScore({ hits: visibleHits, federalMarginalRate: fedRate });
      const totalEstSavings = visibleHits.reduce((s, h) => s + h.estSavings, 0);
      entries.push({
        clientId: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email ?? null,
        state: c.state ?? "",
        taxYear: computed.result.taxYear,
        agi: Math.round(agi),
        federalMarginalRate: fedRate,
        planningScore: Math.round(score),
        totalEstSavings: Math.round(totalEstSavings),
        numHits: visibleHits.length,
        topHits: visibleHits.slice(0, 3),
      });
    }
    entries.sort((a, b) => b.planningScore - a.planningScore);
    const capped = Number.isFinite(limit) && limit > 0 ? entries.slice(0, limit) : entries;
    res.json({ catalogVersion: CATALOG_V1.version, entries: capped });
  } catch (err) {
    logger.error({ err }, "Planning hit list failed");
    res.status(500).json({ error: "Planning hit list failed" });
  }
});

export default router;
