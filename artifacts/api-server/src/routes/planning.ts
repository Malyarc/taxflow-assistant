import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, adjustmentsTable } from "@workspace/db";
import { GetPlanningOpportunitiesParams } from "@workspace/api-zod";
import { CATALOG_V1 } from "@workspace/planning-strategies";
import { evaluatePlanningOpportunities } from "../lib/planningEngine";
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

export default router;
