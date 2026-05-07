import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, taxReturnsTable, clientsTable } from "@workspace/db";
import {
  GetTaxReturnParams,
  CalculateTaxReturnParams,
  CalculateTaxReturnBody,
  UpdateTaxReturnParams,
  UpdateTaxReturnBody,
} from "@workspace/api-zod";
import { recalculateAndUpsertTaxReturn, computeTaxReturn } from "../lib/taxReturnPipeline";
import {
  calculateFederalTaxWithBreakdown,
  calculateStateTaxWithBreakdown,
  calculateChildTaxCredit,
  resolveTaxYear,
} from "../lib/taxCalculator";

const router: IRouter = Router();

function mapReturn(r: typeof taxReturnsTable.$inferSelect) {
  return {
    ...r,
    totalIncome: r.totalIncome != null ? Number(r.totalIncome) : null,
    adjustedGrossIncome: r.adjustedGrossIncome != null ? Number(r.adjustedGrossIncome) : null,
    standardDeduction: r.standardDeduction != null ? Number(r.standardDeduction) : null,
    itemizedDeductions: r.itemizedDeductions != null ? Number(r.itemizedDeductions) : null,
    taxableIncome: r.taxableIncome != null ? Number(r.taxableIncome) : null,
    federalTaxLiability: r.federalTaxLiability != null ? Number(r.federalTaxLiability) : null,
    federalTaxWithheld: r.federalTaxWithheld != null ? Number(r.federalTaxWithheld) : null,
    federalRefundOrOwed: r.federalRefundOrOwed != null ? Number(r.federalRefundOrOwed) : null,
    stateTaxLiability: r.stateTaxLiability != null ? Number(r.stateTaxLiability) : null,
    stateTaxWithheld: r.stateTaxWithheld != null ? Number(r.stateTaxWithheld) : null,
    stateRefundOrOwed: r.stateRefundOrOwed != null ? Number(r.stateRefundOrOwed) : null,
    effectiveTaxRate: r.effectiveTaxRate != null ? Number(r.effectiveTaxRate) : null,
  };
}

router.get("/clients/:clientId/tax-return", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [taxReturn] = await db
    .select()
    .from(taxReturnsTable)
    .where(eq(taxReturnsTable.clientId, params.data.clientId));
  if (!taxReturn) {
    res.status(404).json({ error: "Tax return not found" });
    return;
  }
  res.json(mapReturn(taxReturn));
});

// Compute (without saving) the tax return for any specified year. Used by the
// year-comparison view to render TY2024 vs TY2025 side-by-side.
router.get("/clients/:clientId/tax-return/preview", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const yearRaw = req.query.taxYear;
  const yearNum = typeof yearRaw === "string" ? Number(yearRaw) : NaN;
  if (!Number.isFinite(yearNum) || yearNum < 2000 || yearNum > 2100) {
    res.status(400).json({ error: "Query param taxYear must be a 4-digit year" });
    return;
  }
  const computed = await computeTaxReturn(params.data.clientId, { taxYear: yearNum });
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(computed.result);
});

// Per-bracket breakdown for the current tax return — for the UI's "show your work" panel.
router.get("/clients/:clientId/tax-return/breakdown", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [taxReturn] = await db
    .select()
    .from(taxReturnsTable)
    .where(eq(taxReturnsTable.clientId, params.data.clientId));
  if (!taxReturn) {
    res.status(404).json({ error: "Tax return not found" });
    return;
  }
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, params.data.clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }

  const year = resolveTaxYear(taxReturn.taxYear);
  const taxableIncome = Number(taxReturn.taxableIncome ?? 0);
  const agi = Number(taxReturn.adjustedGrossIncome ?? 0);
  const filingStatus = taxReturn.filingStatus ?? client.filingStatus;

  const fed = calculateFederalTaxWithBreakdown(taxableIncome, filingStatus, year);
  const state = calculateStateTaxWithBreakdown(agi, client.state, filingStatus, year);
  const ctc = calculateChildTaxCredit({
    qualifyingChildren: client.dependentsUnder17 ?? 0,
    otherDependents: client.otherDependents ?? 0,
    agi,
    filingStatus,
    taxYear: year,
  });

  res.json({
    taxYear: year,
    filingStatus,
    federal: {
      taxableIncome,
      total: fed.total,
      marginalRate: fed.marginalRate,
      brackets: fed.breakdown,
    },
    state: {
      stateCode: client.state,
      stateName: state.stateName,
      hasIncomeTax: state.hasIncomeTax,
      total: state.total,
      marginalRate: state.marginalRate,
      brackets: state.breakdown,
    },
    childTaxCredit: ctc,
  });
});

router.post("/clients/:clientId/tax-return", async (req, res): Promise<void> => {
  const params = CalculateTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CalculateTaxReturnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const taxReturn = await recalculateAndUpsertTaxReturn(params.data.clientId, {
    taxYear: parsed.data.taxYear,
    additionalIncome: parsed.data.additionalIncome ?? 0,
    additionalDeductions: parsed.data.additionalDeductions ?? 0,
    useItemizedDeductions: parsed.data.useItemizedDeductions ?? false,
  });

  if (!taxReturn) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  res.json(mapReturn(taxReturn));
});

router.patch("/clients/:clientId/tax-return", async (req, res): Promise<void> => {
  const params = UpdateTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTaxReturnBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  const numericFields = ["totalIncome","adjustedGrossIncome","standardDeduction","itemizedDeductions","taxableIncome","federalTaxLiability","federalTaxWithheld","federalRefundOrOwed","stateTaxLiability","stateTaxWithheld","stateRefundOrOwed"];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (numericFields.includes(k) && v != null) {
      updateData[k] = String(v);
    } else {
      updateData[k] = v;
    }
  }

  const [taxReturn] = await db
    .update(taxReturnsTable)
    .set(updateData)
    .where(eq(taxReturnsTable.clientId, params.data.clientId))
    .returning();
  if (!taxReturn) {
    res.status(404).json({ error: "Tax return not found" });
    return;
  }
  res.json(mapReturn(taxReturn));
});

export default router;
