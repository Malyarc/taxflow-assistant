import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, adjustmentsTable, clientsTable } from "@workspace/db";
import { GetPlanningOpportunitiesParams } from "@workspace/api-zod";
import { CATALOG_V1, type OpportunityHit } from "@workspace/planning-strategies";
import {
  evaluatePlanningOpportunities,
  federalMarginalRate,
  planningScore,
} from "../lib/planningEngine";
import { computeTaxReturn } from "../lib/taxReturnPipeline";
import type { AdjustmentFact } from "../lib/taxReturnEngine";
import { logger } from "../lib/logger";

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
