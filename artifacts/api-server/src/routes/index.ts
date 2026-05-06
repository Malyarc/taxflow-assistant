import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import documentsRouter from "./documents";
import w2DataRouter from "./w2data";
import taxReturnsRouter from "./tax-returns";
import adjustmentsRouter from "./adjustments";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);
router.use(documentsRouter);
router.use(w2DataRouter);
router.use(taxReturnsRouter);
router.use(adjustmentsRouter);
router.use(dashboardRouter);

export default router;
