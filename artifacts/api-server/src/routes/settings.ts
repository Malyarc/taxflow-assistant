/**
 * Public server-side settings — surface env-driven flags to the frontend
 * so the UI can gate Pro-tier surfaces (Planning tab, dashboard widget).
 * Returned shape matches the `Settings` schema in the OpenAPI spec.
 *
 * Add new fields with the same caution: only expose values the client
 * actually needs. Anything secret stays in process.env, never in this
 * response.
 */
import { Router, type IRouter } from "express";
import { config } from "../lib/config";

const router: IRouter = Router();

router.get("/settings", async (_req, res): Promise<void> => {
  res.json({
    proTierEnabled: config.proTierEnabled,
  });
});

export default router;
