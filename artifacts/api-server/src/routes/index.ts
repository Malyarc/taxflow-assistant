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

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);
router.use(documentsRouter);
router.use(w2DataRouter);
router.use(form1099DataRouter);
router.use(taxReturnsRouter);
router.use(adjustmentsRouter);
router.use(dashboardRouter);
router.use(auditLogRouter);
router.use(rentalPropertiesRouter);
router.use(capitalTransactionsRouter);
router.use(scheduleK1Router);

export default router;
