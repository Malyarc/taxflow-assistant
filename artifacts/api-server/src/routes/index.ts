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
router.use(planningRouter);
router.use(cpaToolsRouter);

export default router;
