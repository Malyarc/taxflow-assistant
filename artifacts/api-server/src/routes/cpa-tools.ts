/**
 * T2.2 — CPA-firm tool endpoints (GAME PLAN D, Phases D1 + D2).
 *
 * Pure-engine planning surfaces built on computeTaxReturn:
 *   GET   /clients/:clientId/tax-projection   — next-year projection + 1040-ES
 *   GET   /clients/:clientId/mfj-vs-mfs       — filing-status optimizer
 *   GET   /clients/:clientId/year-over-year   — YoY + OBBBA + threshold alerts
 *   GET   /clients/:clientId/entity-choice    — S-corp reasonable-comp calculator
 *
 * Prep-workflow (D2):
 *   POST  /clients/:clientId/roll-forward            — proforma to a new tax year
 *   GET   /clients/:clientId/organizer[, /pdf]       — document-request checklist
 *   PATCH /clients/:clientId/tax-return/engagement   — status + extension flag
 *   GET   /engagements                               — firm-wide busy-season view
 *
 * The "ready to file" gate reuses the existing
 * GET /clients/:clientId/tax-return/diagnostics (expanded in T2.2).
 */

import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  db,
  clientsTable,
  taxReturnsTable,
  w2DataTable,
  form1099DataTable,
  scheduleK1DataTable,
  rentalPropertiesTable,
  assetBalancesTable,
} from "@workspace/db";
import {
  GetTaxReturnParams,
  RollForwardClientBody,
  UpdateEngagementBody,
} from "@workspace/api-zod";
import {
  computeTaxReturn,
  recalculateAfterMutation,
  synthesizePriorYearCarryforwards,
} from "../lib/taxReturnPipeline";
import { computeTaxProjection } from "../lib/taxProjection";
import { optimizeFilingStatus } from "../lib/filingStatusOptimizer";
import { computeYearOverYear } from "../lib/yearOverYear";
import { analyzeEntityChoice } from "../lib/entityChoice";
import {
  rollForwardW2,
  rollForward1099,
  rollForwardK1,
  rollForwardRental,
  rollForwardAssetBalance,
  shouldRollRentalProperty,
} from "../lib/rollForward";
import { buildClientOrganizer, type YearDataRows } from "../lib/clientOrganizer";
import { buildOrganizerPdf } from "../lib/organizerPdf";
import {
  ENGAGEMENT_STATUSES,
  isEngagementStatus,
  filingDeadlinesFor,
  effectiveDeadline,
  daysUntilDeadline,
} from "../lib/engagement";
import { mapReturn } from "./tax-returns";
import { setSecureDownloadHeaders } from "../lib/httpSecurity";
import { logger } from "../lib/logger";

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

// ── Entity choice: sole prop vs S-corp at a reasonable-comp level ──
router.get("/clients/:clientId/entity-choice", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  let reasonableComp: number | undefined;
  const compRaw = req.query.reasonableComp;
  if (typeof compRaw === "string" && compRaw.length > 0) {
    const c = Number(compRaw);
    if (!Number.isFinite(c) || c <= 0 || c > 10_000_000) {
      res.status(400).json({ error: "reasonableComp must be a positive dollar amount" });
      return;
    }
    reasonableComp = c;
  }
  const computed = await computeTaxReturn(params.data.clientId);
  if (!computed) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const result = analyzeEntityChoice({
    baselineInputs: computed.inputs,
    baselineReturn: computed.result,
    reasonableComp,
  });
  res.json({ clientId: params.data.clientId, taxYear: computed.result.taxYear, ...result });
});

// ── Prior-year roll-forward (proforma) ──
router.post("/clients/:clientId/roll-forward", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = RollForwardClientBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const clientId = params.data.clientId;
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  const toYear = body.data.toYear ?? (client.taxYear ?? new Date().getFullYear() - 1) + 1;
  if (!Number.isInteger(toYear) || toYear < 2001 || toYear > 2100) {
    res.status(400).json({ error: "toYear must be a 4-digit tax year" });
    return;
  }
  const fromYear = toYear - 1;

  const yearRows = async (taxYear: number) => {
    const [w2s, f1099s, k1s, rentals, assets] = await Promise.all([
      db.select().from(w2DataTable).where(and(eq(w2DataTable.clientId, clientId), eq(w2DataTable.taxYear, taxYear))),
      db.select().from(form1099DataTable).where(and(eq(form1099DataTable.clientId, clientId), eq(form1099DataTable.taxYear, taxYear))),
      db.select().from(scheduleK1DataTable).where(and(eq(scheduleK1DataTable.clientId, clientId), eq(scheduleK1DataTable.taxYear, taxYear))),
      db.select().from(rentalPropertiesTable).where(and(eq(rentalPropertiesTable.clientId, clientId), eq(rentalPropertiesTable.taxYear, taxYear))),
      db.select().from(assetBalancesTable).where(and(eq(assetBalancesTable.clientId, clientId), eq(assetBalancesTable.taxYear, taxYear))),
    ]);
    return { w2s, f1099s, k1s, rentals, assets };
  };

  const source = await yearRows(fromYear);
  const sourceCount =
    source.w2s.length + source.f1099s.length + source.k1s.length + source.rentals.length + source.assets.length;
  if (sourceCount === 0) {
    res.status(400).json({ error: `No TY${fromYear} input rows to roll forward` });
    return;
  }
  // Best-effort duplicate guard (no unique constraint exists on these tables —
  // multiple W-2s per year are legal). Two perfectly concurrent rolls could
  // both pass; the second 409s on retry once the rows are visible.
  const target = await yearRows(toYear);
  const targetCount =
    target.w2s.length + target.f1099s.length + target.k1s.length + target.rentals.length + target.assets.length;
  if (targetCount > 0) {
    res.status(409).json({
      error: `TY${toYear} already has ${targetCount} input row(s) — roll-forward would duplicate them. Delete the TY${toYear} rows first if you intend to re-roll.`,
    });
    return;
  }

  const rentalsToRoll = source.rentals.filter(shouldRollRentalProperty);
  try {
    await db.transaction(async (tx) => {
      if (source.w2s.length > 0) {
        await tx.insert(w2DataTable).values(source.w2s.map((r) => rollForwardW2(r, toYear)));
      }
      if (source.f1099s.length > 0) {
        await tx.insert(form1099DataTable).values(source.f1099s.map((r) => rollForward1099(r, toYear)));
      }
      if (source.k1s.length > 0) {
        await tx.insert(scheduleK1DataTable).values(source.k1s.map((r) => rollForwardK1(r, toYear)));
      }
      if (rentalsToRoll.length > 0) {
        await tx.insert(rentalPropertiesTable).values(rentalsToRoll.map((r) => rollForwardRental(r, toYear)));
      }
      if (source.assets.length > 0) {
        await tx.insert(assetBalancesTable).values(source.assets.map((r) => rollForwardAssetBalance(r, toYear)));
      }
      await tx.update(clientsTable).set({ taxYear: toYear }).where(eq(clientsTable.id, clientId));
    });
  } catch (err) {
    logger.error({ err, clientId, toYear }, "Roll-forward transaction failed");
    res.status(500).json({ error: "Roll-forward failed; no rows were copied" });
    return;
  }

  // Recalculate the new year (also writes the tax_returns row the carryforward
  // auto-seed reads from next time) and report what WILL auto-seed — same
  // single source of truth the engine pipeline uses.
  await recalculateAfterMutation(clientId, toYear);
  const carryforwardsSeeded = (await synthesizePriorYearCarryforwards(clientId, toYear, []))
    .map((a) => ({ type: a.adjustmentType, amount: Number(a.amount) }));

  res.json({
    clientId,
    fromYear,
    toYear,
    copied: {
      w2s: source.w2s.length,
      form1099s: source.f1099s.length,
      scheduleK1s: source.k1s.length,
      rentalProperties: rentalsToRoll.length,
      rentalPropertiesSkippedDisposed: source.rentals.length - rentalsToRoll.length,
      assetBalances: source.assets.length,
    },
    carryforwardsSeeded,
    notes: [
      "Dollar amounts copied as prior-year estimates — update them as documents arrive (the organizer tracks what's outstanding).",
      "Capital transactions never roll forward (one-time events).",
      "K-1 opening basis was rolled to the prior year's ending basis where available.",
    ],
  });
});

// ── Client organizer (JSON + PDF) ──
async function loadOrganizer(clientId: number, taxYearRaw: unknown) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  if (!client) return null;
  let targetYear = client.taxYear ?? new Date().getFullYear() - 1;
  if (typeof taxYearRaw === "string" && taxYearRaw.length > 0) {
    const y = Number(taxYearRaw);
    if (!Number.isInteger(y) || y < 2001 || y > 2100) return { badYear: true } as const;
    targetYear = y;
  }
  const priorYear = targetYear - 1;
  const years = [priorYear, targetYear];
  const [w2s, f1099s, k1s, rentals, assets, [priorReturn]] = await Promise.all([
    db.select().from(w2DataTable).where(and(eq(w2DataTable.clientId, clientId), inArray(w2DataTable.taxYear, years))),
    db.select().from(form1099DataTable).where(and(eq(form1099DataTable.clientId, clientId), inArray(form1099DataTable.taxYear, years))),
    db.select().from(scheduleK1DataTable).where(and(eq(scheduleK1DataTable.clientId, clientId), inArray(scheduleK1DataTable.taxYear, years))),
    db.select().from(rentalPropertiesTable).where(and(eq(rentalPropertiesTable.clientId, clientId), inArray(rentalPropertiesTable.taxYear, years))),
    db.select().from(assetBalancesTable).where(and(eq(assetBalancesTable.clientId, clientId), inArray(assetBalancesTable.taxYear, years))),
    db.select().from(taxReturnsTable).where(and(eq(taxReturnsTable.clientId, clientId), eq(taxReturnsTable.taxYear, priorYear))),
  ]);
  const split = (year: number): YearDataRows => ({
    w2s: w2s.filter((r) => r.taxYear === year),
    form1099s: f1099s.filter((r) => r.taxYear === year),
    scheduleK1s: k1s.filter((r) => r.taxYear === year),
    rentalProperties: rentals.filter((r) => r.taxYear === year),
    assetBalances: assets.filter((r) => r.taxYear === year),
  });
  const num = (v: string | null | undefined) => (v != null ? Number(v) : 0);
  const organizer = buildClientOrganizer({
    taxYear: targetYear,
    client,
    priorYear: split(priorYear),
    currentYear: split(targetYear),
    priorReturn: priorReturn
      ? {
          mortgageDeductible: num(priorReturn.mortgageDeductible),
          charitableDeductible: num(priorReturn.charitableDeductible),
          medicalDeductible: num(priorReturn.medicalDeductible),
          saltDeductible: num(priorReturn.saltDeductible),
          aocCredit: num(priorReturn.aocCredit),
          llcCredit: num(priorReturn.llcCredit),
          studentLoanInterestDeduction: num(priorReturn.studentLoanInterestDeduction),
          hsaDeduction: num(priorReturn.hsaDeduction),
          iraDeduction: num(priorReturn.iraDeduction),
          selfEmploymentTax: num(priorReturn.selfEmploymentTax),
          sehiDeduction: num(priorReturn.sehiDeduction),
        }
      : null,
  });
  return { client, organizer };
}

router.get("/clients/:clientId/organizer", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const loaded = await loadOrganizer(params.data.clientId, req.query.taxYear);
  if (!loaded) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  if ("badYear" in loaded) {
    res.status(400).json({ error: "Invalid taxYear query parameter" });
    return;
  }
  res.json({ clientId: params.data.clientId, ...loaded.organizer });
});

router.get("/clients/:clientId/organizer/pdf", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const loaded = await loadOrganizer(params.data.clientId, req.query.taxYear);
  if (!loaded) {
    res.status(404).json({ error: "Client not found" });
    return;
  }
  if ("badYear" in loaded) {
    res.status(400).json({ error: "Invalid taxYear query parameter" });
    return;
  }
  const clientName = `${loaded.client.firstName} ${loaded.client.lastName}`;
  const pdf = await buildOrganizerPdf({
    clientName,
    organizer: loaded.organizer,
    preparedDate: new Date().toISOString().slice(0, 10),
  });
  setSecureDownloadHeaders(res, {
    fileName: `organizer-${params.data.clientId}-TY${loaded.organizer.taxYear}.pdf`,
    contentType: "application/pdf",
    disposition: "attachment",
    length: pdf.length,
  });
  res.send(pdf);
});

// ── Engagement status + extension flag ──
router.patch("/clients/:clientId/tax-return/engagement", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateEngagementBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { engagementStatus, extensionFiled } = body.data;
  if (engagementStatus != null && !isEngagementStatus(engagementStatus)) {
    res.status(400).json({ error: `engagementStatus must be one of: ${ENGAGEMENT_STATUSES.join(", ")}` });
    return;
  }
  if (engagementStatus == null && extensionFiled == null) {
    res.status(400).json({ error: "Provide engagementStatus and/or extensionFiled" });
    return;
  }
  const clientId = params.data.clientId;
  // Resolve the year exactly like GET /tax-return: explicit query > client.taxYear.
  let taxYear: number | null = null;
  const yearRaw = req.query.taxYear;
  if (typeof yearRaw === "string" && yearRaw.length > 0) {
    const y = Number(yearRaw);
    if (!Number.isInteger(y)) {
      res.status(400).json({ error: "Invalid taxYear query parameter" });
      return;
    }
    taxYear = y;
  } else {
    const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
    taxYear = client?.taxYear ?? null;
  }
  if (taxYear == null) {
    res.status(404).json({ error: "No tax return row for this client/year" });
    return;
  }
  const [row] = await db
    .update(taxReturnsTable)
    .set({
      ...(engagementStatus != null ? { engagementStatus } : {}),
      ...(extensionFiled != null ? { extensionFiled } : {}),
    })
    .where(and(eq(taxReturnsTable.clientId, clientId), eq(taxReturnsTable.taxYear, taxYear)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "No tax return row for this client/year" });
    return;
  }
  res.json(mapReturn(row));
});

// ── Firm-wide engagement tracker ──
router.get("/engagements", async (req, res): Promise<void> => {
  const statusFilter = typeof req.query.status === "string" && req.query.status.length > 0
    ? req.query.status
    : null;
  if (statusFilter != null && !isEngagementStatus(statusFilter)) {
    res.status(400).json({ error: `status must be one of: ${ENGAGEMENT_STATUSES.join(", ")}` });
    return;
  }
  let yearFilter: number | null = null;
  const yearRaw = req.query.taxYear;
  if (typeof yearRaw === "string" && yearRaw.length > 0) {
    const y = Number(yearRaw);
    if (!Number.isInteger(y)) {
      res.status(400).json({ error: "Invalid taxYear query parameter" });
      return;
    }
    yearFilter = y;
  }

  // Pin each client to their current-year return (clients.taxYear), the same
  // join the hit-list uses, unless an explicit year is requested.
  const rows = await db
    .select({
      clientId: clientsTable.id,
      firstName: clientsTable.firstName,
      lastName: clientsTable.lastName,
      taxYear: taxReturnsTable.taxYear,
      engagementStatus: taxReturnsTable.engagementStatus,
      extensionFiled: taxReturnsTable.extensionFiled,
      federalRefundOrOwed: taxReturnsTable.federalRefundOrOwed,
    })
    .from(taxReturnsTable)
    .innerJoin(
      clientsTable,
      yearFilter != null
        ? and(eq(clientsTable.id, taxReturnsTable.clientId), eq(taxReturnsTable.taxYear, yearFilter))
        : and(eq(clientsTable.id, taxReturnsTable.clientId), eq(clientsTable.taxYear, taxReturnsTable.taxYear)),
    )
    .orderBy(asc(clientsTable.lastName), asc(clientsTable.firstName));

  const today = new Date().toISOString().slice(0, 10);
  const statusOrder = new Map(ENGAGEMENT_STATUSES.map((s, i) => [s, i] as const));
  const entries = rows
    .filter((r) => statusFilter == null || r.engagementStatus === statusFilter)
    .map((r) => {
      const deadlines = filingDeadlinesFor(r.taxYear);
      return {
        clientId: r.clientId,
        firstName: r.firstName,
        lastName: r.lastName,
        taxYear: r.taxYear,
        engagementStatus: r.engagementStatus,
        extensionFiled: r.extensionFiled,
        ...deadlines,
        effectiveDeadline: effectiveDeadline(r.taxYear, r.extensionFiled),
        daysUntilDeadline: daysUntilDeadline(r.taxYear, r.extensionFiled, today),
        federalRefundOrOwed: r.federalRefundOrOwed != null ? Number(r.federalRefundOrOwed) : null,
      };
    })
    .sort(
      (a, b) =>
        a.effectiveDeadline.localeCompare(b.effectiveDeadline) ||
        (statusOrder.get(a.engagementStatus as never) ?? 99) - (statusOrder.get(b.engagementStatus as never) ?? 99) ||
        a.lastName.localeCompare(b.lastName),
    );

  const statusCounts: Record<string, number> = {};
  for (const s of ENGAGEMENT_STATUSES) statusCounts[s] = 0;
  for (const e of entries) statusCounts[e.engagementStatus] = (statusCounts[e.engagementStatus] ?? 0) + 1;

  res.json({ asOf: today, entries, statusCounts });
});

export default router;
