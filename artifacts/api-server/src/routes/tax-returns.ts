import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, taxReturnsTable, clientsTable } from "@workspace/db";
import {
  GetTaxReturnParams,
  CalculateTaxReturnParams,
  CalculateTaxReturnBody,
  UpdateTaxReturnParams,
  UpdateTaxReturnBody,
} from "@workspace/api-zod";
import { recalculateAndUpsertTaxReturn, computeTaxReturn } from "../lib/taxReturnPipeline";
import { buildTaxReturnPdf } from "../lib/pdfExport";
import { buildIrsForm1040Pdf } from "../lib/irsForm1040Pdf";
import { calculateForm4868, buildForm4868Pdf, type Form4868Input } from "../lib/form4868";
import {
  computeForm8606ProRata,
  computeForm8606PartIII,
  buildForm8606Pdf,
  type Form8606PartIIIResult,
} from "../lib/form8606";
import {
  captureFiledSnapshot,
  computeAmendmentDiff,
  buildForm1040xPdf,
  type FiledSnapshot,
} from "../lib/form1040x";
import {
  buildTaxReturnCsvExport,
  buildTaxReturnJsonExport,
  buildTaxReturnSummaryText,
} from "../lib/taxReturnExports";
import { setSecureDownloadHeaders } from "../lib/httpSecurity";
import { logger } from "../lib/logger";
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
  // Optional ?taxYear=YYYY query param. Default: client's current taxYear,
  // falling back to most recently updated return if no exact match.
  const yearRaw = req.query.taxYear;
  let yearFilter: number | null = null;
  if (typeof yearRaw === "string" && yearRaw.length > 0) {
    const n = Number(yearRaw);
    if (!Number.isFinite(n)) {
      res.status(400).json({ error: "Invalid taxYear query parameter" });
      return;
    }
    yearFilter = n;
  } else {
    const [client] = await db
      .select()
      .from(clientsTable)
      .where(eq(clientsTable.id, params.data.clientId));
    if (client) yearFilter = client.taxYear;
  }

  let taxReturn: typeof taxReturnsTable.$inferSelect | undefined;
  if (yearFilter != null) {
    [taxReturn] = await db
      .select()
      .from(taxReturnsTable)
      .where(and(eq(taxReturnsTable.clientId, params.data.clientId), eq(taxReturnsTable.taxYear, yearFilter)));
  }
  // Fallback: most recently updated return for this client (if year-filtered miss)
  if (!taxReturn) {
    [taxReturn] = await db
      .select()
      .from(taxReturnsTable)
      .where(eq(taxReturnsTable.clientId, params.data.clientId))
      .orderBy(desc(taxReturnsTable.updatedAt))
      .limit(1);
  }
  if (!taxReturn) {
    res.status(404).json({ error: "Tax return not found" });
    return;
  }
  res.json(mapReturn(taxReturn));
});

// List all tax returns for a client (one per year that's been calculated)
router.get("/clients/:clientId/tax-returns", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const returns = await db
    .select()
    .from(taxReturnsTable)
    .where(eq(taxReturnsTable.clientId, params.data.clientId))
    .orderBy(desc(taxReturnsTable.taxYear));
  res.json(returns.map(mapReturn));
});

// PDF download of the tax return summary
router.get("/clients/:clientId/tax-return/pdf", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const yearRaw = req.query.taxYear;
  const overrideYear = typeof yearRaw === "string" && Number.isFinite(Number(yearRaw))
    ? Number(yearRaw)
    : undefined;
  const computed = await computeTaxReturn(params.data.clientId, overrideYear ? { taxYear: overrideYear } : {});
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const pdf = await buildTaxReturnPdf(computed.client, computed.result);
  const fileName = `tax-return-${computed.client.firstName}-${computed.client.lastName}-${computed.result.taxYear}.pdf`;
  setSecureDownloadHeaders(res, {
    fileName, contentType: "application/pdf", disposition: "attachment",
    length: pdf.length, fallbackExt: ".pdf",
  });
  res.send(pdf);
});

// Real IRS Form 1040 PDF — fills the official IRS fillable template via pdf-lib.
// CPAs use this for client-facing review; the engine values land on the actual
// IRS form layout instead of our custom summary.
router.get("/clients/:clientId/tax-return/form-1040", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const yearRaw = req.query.taxYear;
  const overrideYear = typeof yearRaw === "string" && Number.isFinite(Number(yearRaw))
    ? Number(yearRaw)
    : undefined;
  const computed = await computeTaxReturn(params.data.clientId, overrideYear ? { taxYear: overrideYear } : {});
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  try {
    const pdf = await buildIrsForm1040Pdf({ client: computed.client, ret: computed.result });
    const fileName = `irs-form-1040-${computed.client.firstName}-${computed.client.lastName}-${computed.result.taxYear}.pdf`;
    setSecureDownloadHeaders(res, {
      fileName, contentType: "application/pdf", disposition: "attachment",
      length: pdf.length, fallbackExt: ".pdf",
    });
    res.send(pdf);
  } catch (err) {
    // Log internal detail server-side; return generic message to client to
    // avoid leaking absolute filesystem paths or pdf-lib internals.
    logger.error({ err }, "Failed to build IRS Form 1040 PDF");
    res.status(500).json({ error: "Failed to build Form 1040 PDF" });
  }
});

// ── C8 — Form 4868 (Application for Automatic Extension) ─────────────────
// JSON preview endpoint. Frontend uses this to show Lines 4-7 live as the
// CPA tweaks amountBeingPaid / estimatedTaxAlreadyPaid / out-of-country.
// PDF download is the sibling /form-4868/pdf endpoint.
function parseForm4868Input(req: import("express").Request): Form4868Input {
  const num = (v: unknown): number | undefined => {
    if (typeof v !== "string" || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const bool = (v: unknown): boolean => v === "true" || v === "1";
  return {
    amountBeingPaid: num(req.query.amountBeingPaid),
    estimatedTaxAlreadyPaid: num(req.query.estimatedTaxAlreadyPaid),
    outOfCountry: bool(req.query.outOfCountry),
    form1040NrNoWithholding: bool(req.query.form1040NrNoWithholding),
  };
}

router.get("/clients/:clientId/tax-return/form-4868", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const yearRaw = req.query.taxYear;
  const overrideYear = typeof yearRaw === "string" && Number.isFinite(Number(yearRaw))
    ? Number(yearRaw)
    : undefined;
  const computed = await computeTaxReturn(params.data.clientId, overrideYear ? { taxYear: overrideYear } : {});
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const input = parseForm4868Input(req);
  const form = calculateForm4868({ ret: computed.result, input });
  res.json(form);
});

router.get("/clients/:clientId/tax-return/form-4868/pdf", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const yearRaw = req.query.taxYear;
  const overrideYear = typeof yearRaw === "string" && Number.isFinite(Number(yearRaw))
    ? Number(yearRaw)
    : undefined;
  const computed = await computeTaxReturn(params.data.clientId, overrideYear ? { taxYear: overrideYear } : {});
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  try {
    const input = parseForm4868Input(req);
    const form = calculateForm4868({ ret: computed.result, input });
    const pdf = await buildForm4868Pdf({ client: computed.client, ret: computed.result, form });
    const fileName = `form-4868-${computed.client.firstName}-${computed.client.lastName}-${computed.result.taxYear}.pdf`;
    setSecureDownloadHeaders(res, {
      fileName, contentType: "application/pdf", disposition: "attachment",
      length: pdf.length, fallbackExt: ".pdf",
    });
    res.send(pdf);
  } catch (err) {
    logger.error({ err }, "Failed to build Form 4868 PDF");
    res.status(500).json({ error: "Failed to build Form 4868 PDF" });
  }
});

// ── Phase H — H6 — Form 8606 (nondeductible IRA basis) ────────────────────

/**
 * Compute Form 8606 inputs from the client's tax-return data:
 *   - Roth conversion amount from `roth_conversion_amount` adjustment
 *     (also flows through engine as additional_income; this just exposes it)
 *   - Nondeductible contribution from `nondeductible_ira_contribution`
 *     adjustment
 *   - Year-end traditional IRA balance + after-tax basis from H5 asset
 *     balances (sum across all traditional_ira, sep_ira, simple_ira types)
 */
async function loadForm8606Inputs(clientId: number) {
  const { db, adjustmentsTable, assetBalancesTable, clientsTable } = await import("@workspace/db");
  const [adjustments, assets, clientRows] = await Promise.all([
    db.select().from(adjustmentsTable).where(eq(adjustmentsTable.clientId, clientId)),
    db.select().from(assetBalancesTable).where(eq(assetBalancesTable.clientId, clientId)),
    db.select().from(clientsTable).where(eq(clientsTable.id, clientId)),
  ]);
  const num = (v: string | number | null | undefined): number => {
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const sumAdj = (type: string): number =>
    adjustments
      .filter((a) => a.adjustmentType === type && a.isApplied !== false)
      .reduce((s, a) => s + num(a.amount), 0);
  const tradAssetTypes = new Set(["traditional_ira", "sep_ira", "simple_ira"]);
  const tradAssets = assets.filter((a) => tradAssetTypes.has(a.assetType));
  const totalTraditionalIraBalance = tradAssets.reduce((s, a) => s + num(a.balance), 0);
  const totalAfterTaxBasis = tradAssets.reduce((s, a) => s + num(a.afterTaxBasis), 0);
  // Part III inputs — Roth IRA aggregates.
  const rothAssets = assets.filter((a) => a.assetType === "roth_ira");
  const rothBalance = rothAssets.reduce((s, a) => s + num(a.balance), 0);
  const rothContributionsBasis = rothAssets.reduce((s, a) => s + num(a.afterTaxBasis), 0);
  return {
    partI: {
      conversionAmount: sumAdj("roth_conversion_amount"),
      nondeductibleContribution: sumAdj("nondeductible_ira_contribution"),
      totalTraditionalIraBalance,
      totalAfterTaxBasis,
      otherDistributions: sumAdj("traditional_ira_distribution"),
    },
    partIII: {
      rothDistribution: sumAdj("roth_ira_distribution"),
      rothContributionsBasis,
      rothBalanceBeforeDistribution: rothBalance + sumAdj("roth_ira_distribution"),
      ownerAge: clientRows[0]?.taxpayerAge ?? null,
      // MVP: assume first Roth contribution is 5+ years old when any Roth
      // balance exists. CPA can refine via a future client-level field.
      firstRothFiveYearsOld: rothBalance > 0 || rothContributionsBasis > 0,
    },
  };
}

router.get("/clients/:clientId/form-8606", async (req, res): Promise<void> => {
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
  const inputs = await loadForm8606Inputs(params.data.clientId);
  const result = computeForm8606ProRata(inputs.partI);
  let partIII: Form8606PartIIIResult | undefined;
  if (inputs.partIII.rothDistribution > 0 || inputs.partIII.rothContributionsBasis > 0) {
    partIII = computeForm8606PartIII(inputs.partIII);
  }
  res.json({
    taxYear: computed.result.taxYear,
    ...result,
    ...(partIII ? { partIII } : {}),
  });
});

router.get("/clients/:clientId/form-8606/pdf", async (req, res): Promise<void> => {
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
  try {
    const inputs = await loadForm8606Inputs(params.data.clientId);
    const result = computeForm8606ProRata(inputs.partI);
    let partIII: Form8606PartIIIResult | undefined;
    if (inputs.partIII.rothDistribution > 0 || inputs.partIII.rothContributionsBasis > 0) {
      partIII = computeForm8606PartIII(inputs.partIII);
    }
    const pdf = await buildForm8606Pdf({
      client: computed.client,
      taxYear: computed.result.taxYear,
      result,
      partIII,
    });
    const fileName = `form-8606-${computed.client.firstName}-${computed.client.lastName}-${computed.result.taxYear}.pdf`;
    setSecureDownloadHeaders(res, {
      fileName, contentType: "application/pdf", disposition: "attachment",
      length: pdf.length, fallbackExt: ".pdf",
    });
    res.send(pdf);
  } catch (err) {
    logger.error({ err }, "Failed to build Form 8606 PDF");
    res.status(500).json({ error: "Failed to build Form 8606 PDF" });
  }
});

// ── C4 — Form 1040-X (Amended return) ───────────────────────────────────
// POST /lock-as-filed → snapshot current row → originalSnapshot column.
// POST /clear-amendment → reset snapshot, explanation, lockedAt.
// PUT  /amendment-explanation → update Part III text.
// GET  /form-1040x → JSON diff for live UI.
// GET  /form-1040x/pdf → substitute PDF.
async function loadCurrentTaxReturnRow(clientId: number, taxYear?: number) {
  const conditions = taxYear != null
    ? and(eq(taxReturnsTable.clientId, clientId), eq(taxReturnsTable.taxYear, taxYear))
    : eq(taxReturnsTable.clientId, clientId);
  const rows = await db
    .select()
    .from(taxReturnsTable)
    .where(conditions)
    .orderBy(desc(taxReturnsTable.taxYear));
  return rows[0] ?? null;
}

function parseTaxYearQuery(req: import("express").Request): number | undefined {
  const yearRaw = req.query.taxYear;
  return typeof yearRaw === "string" && Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : undefined;
}

router.post("/clients/:clientId/tax-return/lock-as-filed", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const taxYear = parseTaxYearQuery(req);
  const row = await loadCurrentTaxReturnRow(params.data.clientId, taxYear);
  if (!row) {
    res.status(404).json({ error: "No computed tax return found to snapshot" });
    return;
  }
  const snapshot = captureFiledSnapshot(row);
  const lockedAt = new Date();
  await db
    .update(taxReturnsTable)
    .set({
      originalSnapshot: snapshot,
      amendmentLockedAt: lockedAt,
      // Preserve existing explanation if set (could be a re-lock); default to "" for new locks.
      amendmentExplanation: row.amendmentExplanation ?? "",
    })
    .where(eq(taxReturnsTable.id, row.id));
  res.json({ ok: true, snapshot, lockedAt: lockedAt.toISOString() });
});

router.post("/clients/:clientId/tax-return/clear-amendment", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const taxYear = parseTaxYearQuery(req);
  const row = await loadCurrentTaxReturnRow(params.data.clientId, taxYear);
  if (!row) {
    res.status(404).json({ error: "No computed tax return found" });
    return;
  }
  await db
    .update(taxReturnsTable)
    .set({
      originalSnapshot: null,
      amendmentExplanation: null,
      amendmentLockedAt: null,
    })
    .where(eq(taxReturnsTable.id, row.id));
  res.json({ ok: true });
});

router.put("/clients/:clientId/tax-return/amendment-explanation", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const taxYear = parseTaxYearQuery(req);
  const explanation = typeof req.body?.explanation === "string" ? req.body.explanation : "";
  if (explanation.length > 5000) {
    res.status(400).json({ error: "explanation too long (max 5000 chars)" });
    return;
  }
  const row = await loadCurrentTaxReturnRow(params.data.clientId, taxYear);
  if (!row) {
    res.status(404).json({ error: "No computed tax return found" });
    return;
  }
  if (row.originalSnapshot == null) {
    res.status(400).json({ error: "Lock as filed before setting explanation" });
    return;
  }
  await db
    .update(taxReturnsTable)
    .set({ amendmentExplanation: explanation })
    .where(eq(taxReturnsTable.id, row.id));
  res.json({ ok: true });
});

router.get("/clients/:clientId/tax-return/form-1040x", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const taxYear = parseTaxYearQuery(req);
  const row = await loadCurrentTaxReturnRow(params.data.clientId, taxYear);
  if (!row) {
    res.status(404).json({ error: "No computed tax return found" });
    return;
  }
  if (row.originalSnapshot == null) {
    res.status(409).json({
      error: "No amendment in progress",
      code: "NO_AMENDMENT_BASELINE",
      hint: "POST /tax-return/lock-as-filed first.",
    });
    return;
  }
  const snapshot = row.originalSnapshot as unknown as FiledSnapshot;
  const form = computeAmendmentDiff({
    current: row,
    snapshot,
    explanation: row.amendmentExplanation ?? "",
    lockedAt: row.amendmentLockedAt?.toISOString() ?? null,
  });
  res.json(form);
});

router.get("/clients/:clientId/tax-return/form-1040x/pdf", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const taxYear = parseTaxYearQuery(req);
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const row = await loadCurrentTaxReturnRow(params.data.clientId, taxYear);
  if (!row) {
    res.status(404).json({ error: "No computed tax return found" });
    return;
  }
  if (row.originalSnapshot == null) {
    res.status(409).json({ error: "No amendment baseline; POST /lock-as-filed first" });
    return;
  }
  try {
    const snapshot = row.originalSnapshot as unknown as FiledSnapshot;
    const form = computeAmendmentDiff({
      current: row,
      snapshot,
      explanation: row.amendmentExplanation ?? "",
      lockedAt: row.amendmentLockedAt?.toISOString() ?? null,
    });
    const pdf = await buildForm1040xPdf({ client, ret: row, form });
    const fileName = `form-1040x-${client.firstName}-${client.lastName}-${row.taxYear}.pdf`;
    setSecureDownloadHeaders(res, {
      fileName, contentType: "application/pdf", disposition: "attachment",
      length: pdf.length, fallbackExt: ".pdf",
    });
    res.send(pdf);
  } catch (err) {
    logger.error({ err }, "Failed to build Form 1040-X PDF");
    res.status(500).json({ error: "Failed to build Form 1040-X PDF" });
  }
});

// CSV export — UltraTax CS / Lacerte / ProConnect / Drake friendly
router.get("/clients/:clientId/tax-return/csv", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const yearRaw = req.query.taxYear;
  const overrideYear = typeof yearRaw === "string" && Number.isFinite(Number(yearRaw))
    ? Number(yearRaw)
    : undefined;
  const computed = await computeTaxReturn(params.data.clientId, overrideYear ? { taxYear: overrideYear } : {});
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const csv = buildTaxReturnCsvExport(computed.client, computed.result);
  const fileName = `tax-return-${computed.client.firstName}-${computed.client.lastName}-${computed.result.taxYear}.csv`;
  setSecureDownloadHeaders(res, {
    fileName, contentType: "text/csv; charset=utf-8", disposition: "attachment",
    fallbackExt: ".csv",
  });
  res.send(csv);
});

// JSON export — machine-readable full export for integration with other tools
router.get("/clients/:clientId/tax-return/json", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const yearRaw = req.query.taxYear;
  const overrideYear = typeof yearRaw === "string" && Number.isFinite(Number(yearRaw))
    ? Number(yearRaw)
    : undefined;
  const computed = await computeTaxReturn(params.data.clientId, overrideYear ? { taxYear: overrideYear } : {});
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const json = buildTaxReturnJsonExport(computed.client, computed.result);
  const fileName = `tax-return-${computed.client.firstName}-${computed.client.lastName}-${computed.result.taxYear}.json`;
  setSecureDownloadHeaders(res, {
    fileName, contentType: "application/json; charset=utf-8", disposition: "attachment",
    fallbackExt: ".json",
  });
  res.send(json);
});

// Plain-text key=value summary (vendor-neutral). The URL path `/ultratax`
// and the `.gen` extension are kept for backward compatibility with anything
// that linked to this endpoint historically; the contents are not an UltraTax
// CS import file. See docs/ultratax-audit.md.
router.get("/clients/:clientId/tax-return/ultratax", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const yearRaw = req.query.taxYear;
  const overrideYear = typeof yearRaw === "string" && Number.isFinite(Number(yearRaw))
    ? Number(yearRaw)
    : undefined;
  const computed = await computeTaxReturn(params.data.clientId, overrideYear ? { taxYear: overrideYear } : {});
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const summary = buildTaxReturnSummaryText(computed.client, computed.result);
  const fileName = `tax-return-${computed.client.firstName}-${computed.client.lastName}-${computed.result.taxYear}.txt`;
  setSecureDownloadHeaders(res, {
    fileName, contentType: "text/plain; charset=utf-8", disposition: "attachment",
    fallbackExt: ".txt",
  });
  res.send(summary);
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
  const [client] = await db
    .select()
    .from(clientsTable)
    .where(eq(clientsTable.id, params.data.clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  // Match the year on the saved row, falling back to most recent if no exact-year row.
  const yearRaw = req.query.taxYear;
  const yearFilter = typeof yearRaw === "string" && yearRaw.length > 0 && Number.isFinite(Number(yearRaw))
    ? Number(yearRaw)
    : client.taxYear;
  let [taxReturn] = await db
    .select()
    .from(taxReturnsTable)
    .where(and(eq(taxReturnsTable.clientId, params.data.clientId), eq(taxReturnsTable.taxYear, yearFilter)));
  if (!taxReturn) {
    [taxReturn] = await db
      .select()
      .from(taxReturnsTable)
      .where(eq(taxReturnsTable.clientId, params.data.clientId))
      .orderBy(desc(taxReturnsTable.updatedAt))
      .limit(1);
  }
  if (!taxReturn) {
    res.status(404).json({ error: "Tax return not found" });
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
