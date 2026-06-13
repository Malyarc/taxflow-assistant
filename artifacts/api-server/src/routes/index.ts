import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import documentsRouter from "./documents";
import w2DataRouter from "./w2data";
import form1099DataRouter from "./form1099data";
import taxReturnsRouter from "./tax-returns";
import adjustmentsRouter from "./adjustments";
import dashboardRouter from "./dashboard";
import auditLogRouter from "./audit-log";
import rentalPropertiesRouter from "./rental-properties";
import capitalTransactionsRouter from "./capital-transactions";
import scheduleK1Router from "./schedule-k1";
import assetBalancesRouter from "./asset-balances";
import scheduleCAssetsRouter from "./schedule-c-assets";
import planningRouter from "./planning";
import cpaToolsRouter from "./cpa-tools";
import growthRouter from "./growth";
import settingsRouter from "./settings";
import disclosureConsentsRouter from "./disclosure-consents";
import { requireApiAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.use(healthRouter);
// P0-4 — gate everything below behind the bearer-token auth check. No-op in
// demo mode (API_AUTH_TOKEN unset); healthRouter above stays public for probes.
router.use(requireApiAuth);
router.use(settingsRouter);
router.use(clientsRouter);
router.use(documentsRouter);
router.use(disclosureConsentsRouter);
router.use(w2DataRouter);
router.use(form1099DataRouter);
router.use(taxReturnsRouter);
router.use(adjustmentsRouter);
router.use(dashboardRouter);
router.use(auditLogRouter);
router.use(rentalPropertiesRouter);
router.use(capitalTransactionsRouter);
router.use(scheduleK1Router);
router.use(assetBalancesRouter);
router.use(scheduleCAssetsRouter);
// cpa-tools MUST mount BEFORE planning: the planning router opens with a
// pathless Pro-tier gate (402 when PRO_TIER_ENABLED=false) that would
// otherwise swallow every request still travelling toward cpa-tools — the
// prep-workflow features (projection, entity-choice, organizer, roll-forward,
// engagements) are NOT Pro-gated by the G5 contract.
router.use(cpaToolsRouter);
// T5 GROWTH (G-1…G-8). Mounts BEFORE planning for the same reason as cpa-tools:
// the planning router opens with a pathless Pro-tier gate that would otherwise
// swallow these requests when PRO_TIER_ENABLED=false.
router.use(growthRouter);
router.use(planningRouter);

export default router;
