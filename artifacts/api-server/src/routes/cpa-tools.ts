/**
 * T2.2 — CPA-firm tool endpoints (GAME PLAN D, Phase D1).
 *
 * Pure-engine planning surfaces built on computeTaxReturn:
 *   GET /clients/:clientId/tax-projection   — next-year projection + 1040-ES
 *   GET /clients/:clientId/mfj-vs-mfs        — filing-status optimizer
 *   GET /clients/:clientId/year-over-year    — YoY + OBBBA + threshold alerts
 *
 * The "ready to file" gate reuses the existing
 * GET /clients/:clientId/tax-return/diagnostics (expanded in T2.2).
 */

import { Router, type IRouter } from "express";
import { GetTaxReturnParams } from "@workspace/api-zod";
import { computeTaxReturn } from "../lib/taxReturnPipeline";
import { computeTaxProjection } from "../lib/taxProjection";
import { optimizeFilingStatus } from "../lib/filingStatusOptimizer";
import { computeYearOverYear } from "../lib/yearOverYear";

const router: IRouter = Router();

// ── Next-year tax projection + quarterly 1040-ES estimates ──
router.get("/clients/:clientId/tax-projection", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const growthRaw = req.query.incomeGrowth;
  let incomeGrowth = 1.03;
  if (typeof growthRaw === "string" && growthRaw.length > 0) {
    const g = Number(growthRaw);
    // Sane bounds: −50% to +200% annual growth.
    if (!Number.isFinite(g) || g < 0.5 || g > 3) {
      res.status(400).json({ error: "incomeGrowth must be a factor between 0.5 and 3.0" });
      return;
    }
    incomeGrowth = g;
  }
  const computed = await computeTaxReturn(params.data.clientId);
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const projection = computeTaxProjection({
    baselineInputs: computed.inputs,
    baselineReturn: computed.result,
    incomeGrowth,
  });
  res.json(projection);
});

// ── MFJ-vs-MFS filing-status optimizer ──
router.get("/clients/:clientId/mfj-vs-mfs", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const computed = await computeTaxReturn(params.data.clientId);
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const result = optimizeFilingStatus({
    jointInputs: computed.inputs,
    jointReturn: computed.result,
  });
  if (!result) {
    res.json({
      applicable: false,
      reason: `The MFJ-vs-MFS optimizer only applies to a Married Filing Jointly baseline (this client is ${computed.result.filingStatus}).`,
    });
    return;
  }
  res.json({ applicable: true, ...result });
});

// ── Year-over-year + OBBBA impact + threshold-crossing alerts ──
router.get("/clients/:clientId/year-over-year", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const current = await computeTaxReturn(params.data.clientId);
  if (!current) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const currentYear = current.result.taxYear;
  const priorRaw = req.query.priorYear;
  let priorYear = currentYear - 1;
  if (typeof priorRaw === "string" && priorRaw.length > 0) {
    const y = Number(priorRaw);
    if (!Number.isFinite(y) || y < 2000 || y >= currentYear) {
      res.status(400).json({ error: "priorYear must be a year before the current tax year" });
      return;
    }
    priorYear = y;
  }
  const prior = await computeTaxReturn(params.data.clientId, { taxYear: priorYear });
  if (!prior) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const comparison = computeYearOverYear({
    priorReturn: prior.result,
    currentReturn: current.result,
  });
  // When the prior year carries no income data, the client likely has no
  // per-year inputs for that year — the comparison is then "current data at
  // prior-year rules" (still useful for the OBBBA/law-change view). Flag it.
  res.json({
    ...comparison,
    priorYearHasData: prior.result.totalIncome > 0,
  });
});

export default router;
