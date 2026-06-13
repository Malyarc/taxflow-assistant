/**
 * T5 — GROWTH: new revenue features for CPA firms (G-1 … G-8).
 *
 * Each endpoint is a thin HTTP seam over a PURE, Haven-portable engine module
 * (the math + the structured output live in `../lib/*`). "The LLM never touches
 * the math": where a feature later wants AI prose (G-1 letters, G-2 teaser),
 * the deterministic object is produced here and a §7216-gated narration seam is
 * a follow-up — these endpoints emit the deterministic version today.
 *
 *   GET  /clients/:clientId/advisory-proposal[, /pdf]   G-3 fee/ROI packager
 *   GET  /clients/:clientId/tax-health-report[, /pdf]   G-7 annual health report
 *   GET  /clients/:clientId/specialty-referrals         G-8 cost-seg/R&D/DB/ERC screen
 *   GET  /clients/:clientId/entity-scenario-lab         G-5 sole-prop/S/partnership/C
 *   POST /clients/:clientId/quarterly-autopilot         G-4 §6654 estimate autopilot
 *   POST /clients/:clientId/k1-package                  G-6 K-1 package → engine facts
 *   POST /clients/:clientId/transcript-monitor          G-1 IRS transcript change diff
 *   POST /clients/:clientId/notice-response-draft        G-1 grounded notice response
 *   POST /prospect-analysis[, /pdf]                     G-2 second-look lead-gen
 *
 * Mounted BEFORE the planning router (which opens with a pathless Pro-tier
 * gate) so these are reachable when PRO_TIER_ENABLED=false — same reason
 * cpa-tools mounts first. Productized Pro-gating is a later product decision.
 *
 * The external connectors these features ultimately ride on — IRS Transcript
 * Delivery System (8821), QBO/Gusto/Plaid feeds, PDF OCR — are ADAPTERS that
 * produce the structured request bodies below; they are intentionally not
 * implemented here (no credentials in this environment), and the pure modules
 * compute over the already-fetched/parsed input.
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, adjustmentsTable, clientsTable } from "@workspace/db";
import { GetTaxReturnParams } from "@workspace/api-zod";
import {
  computeTaxReturn,
  filterAdjustmentsForYear,
} from "../lib/taxReturnPipeline";
import { evaluatePlanningOpportunities } from "../lib/planningEngine";
import type { AdjustmentFact, ClientFacts } from "../lib/taxReturnEngine";
import { setSecureDownloadHeaders } from "../lib/httpSecurity";
import { logger } from "../lib/logger";

import { buildAdvisoryProposal, buildAdvisoryProposalPdf } from "../lib/advisoryProposal";
import { buildTaxHealthReport, buildTaxHealthReportPdf } from "../lib/taxHealthReport";
import { detectSpecialtyReferrals } from "../lib/specialtyCreditReferral";
import { analyzeEntityScenarioLab } from "../lib/entityScenarioLab";
import { analyzeProspect, buildProspectTeaserPdf, type ProspectReturnInput } from "../lib/prospectAnalyzer";
import { runQuarterlyAutopilot, type IncomeFeedSnapshot } from "../lib/quarterlyAutopilot";
import { ingestK1Packages, type RawK1Package } from "../lib/k1PackageIngestion";
import {
  detectTranscriptChanges,
  draftNoticeResponse,
  type TranscriptSnapshot,
} from "../lib/irsAccountMonitor";

const router: IRouter = Router();

const TODAY = (): string => new Date().toISOString().slice(0, 10);
const FIRM_NAME = (): string | undefined => process.env.FIRM_NAME;

/** Fetch firstName/lastName for the client-facing deliverables (PII the engine doesn't carry). */
async function clientName(clientId: number): Promise<{ firstName: string; lastName: string } | null> {
  const [c] = await db.select().from(clientsTable).where(eq(clientsTable.id, clientId));
  return c ? { firstName: c.firstName, lastName: c.lastName } : null;
}

/** Load the current-year computed return + its year-scoped adjustments + planning hits. */
async function loadContext(clientId: number) {
  const computed = await computeTaxReturn(clientId);
  if (!computed) return null;
  const adjustments = filterAdjustmentsForYear(
    await db.select().from(adjustmentsTable).where(eq(adjustmentsTable.clientId, clientId)),
    computed.result.taxYear,
  ) as AdjustmentFact[];
  const hits = evaluatePlanningOpportunities({
    client: computed.client,
    computed: computed.result,
    adjustments,
    baselineInputs: computed.inputs,
  });
  return { computed, adjustments, hits };
}

// ─────────────────────────────────────────────────────────────────────────────
// G-3 — Advisory Proposal + ROI packager
// ─────────────────────────────────────────────────────────────────────────────
const ProposalQuery = z.object({
  proposedFee: z.coerce.number().finite().min(0).max(1_000_000).optional(),
  feeRate: z.coerce.number().finite().min(0).max(1).optional(),
  minFee: z.coerce.number().finite().min(0).max(1_000_000).optional(),
});

async function buildProposalFor(clientId: number) {
  const ctx = await loadContext(clientId);
  if (!ctx) return null;
  const name = await clientName(clientId);
  if (!name) return null;
  return { ctx, name };
}

router.get("/clients/:clientId/advisory-proposal", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const q = ProposalQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const loaded = await buildProposalFor(params.data.clientId);
  if (!loaded) { res.status(404).json({ error: "Client not found" }); return; }
  const proposal = buildAdvisoryProposal({
    clientFirstName: loaded.name.firstName,
    clientLastName: loaded.name.lastName,
    taxYear: loaded.ctx.computed.result.taxYear,
    hits: loaded.ctx.hits,
    proposedFee: q.data.proposedFee,
    feeRate: q.data.feeRate,
    minFee: q.data.minFee,
    firmName: FIRM_NAME(),
  });
  res.json({ clientId: params.data.clientId, taxYear: loaded.ctx.computed.result.taxYear, ...proposal });
});

router.get("/clients/:clientId/advisory-proposal/pdf", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const q = ProposalQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const loaded = await buildProposalFor(params.data.clientId);
  if (!loaded) { res.status(404).json({ error: "Client not found" }); return; }
  const taxYear = loaded.ctx.computed.result.taxYear;
  const proposal = buildAdvisoryProposal({
    clientFirstName: loaded.name.firstName,
    clientLastName: loaded.name.lastName,
    taxYear,
    hits: loaded.ctx.hits,
    proposedFee: q.data.proposedFee,
    feeRate: q.data.feeRate,
    minFee: q.data.minFee,
    firmName: FIRM_NAME(),
  });
  const pdf = await buildAdvisoryProposalPdf({
    proposal,
    clientFirstName: loaded.name.firstName,
    clientLastName: loaded.name.lastName,
    taxYear,
    preparedDate: TODAY(),
    firmName: FIRM_NAME(),
  });
  setSecureDownloadHeaders(res, {
    fileName: `advisory-proposal-${params.data.clientId}-TY${taxYear}.pdf`,
    contentType: "application/pdf",
    disposition: "attachment",
    length: pdf.length,
  });
  res.send(pdf);
});

// ─────────────────────────────────────────────────────────────────────────────
// G-7 — Annual Tax Health Report
// ─────────────────────────────────────────────────────────────────────────────
async function buildHealthReportFor(clientId: number) {
  const ctx = await loadContext(clientId);
  if (!ctx) return null;
  const currentYear = ctx.computed.result.taxYear;
  const priorYear = currentYear - 1;
  const prior = await computeTaxReturn(clientId, { taxYear: priorYear });
  if (!prior) return null;
  // Mirror the YoY route: a prior year with no year-scoped documents is the
  // current data re-run under prior-year law (surfaced as a caveat downstream).
  const pin = prior.inputs;
  const priorYearScopedDocsPresent =
    pin.w2s.some((r) => (r.taxYear ?? priorYear) === priorYear) ||
    pin.form1099s.some((r) => (r.taxYear ?? priorYear) === priorYear) ||
    (pin.scheduleK1 ?? []).some((r) => r.taxYear === priorYear) ||
    (pin.rentalProperties ?? []).some((r) => r.taxYear === priorYear) ||
    (pin.capitalTransactions ?? []).some((r) => r.taxYear === priorYear) ||
    (pin.form4797 ?? []).some((r) => r.taxYear === priorYear);
  const report = buildTaxHealthReport({
    priorReturn: prior.result,
    currentReturn: ctx.computed.result,
    priorYearScopedDocsPresent,
    hits: ctx.hits,
    taxYear: currentYear,
  });
  return { report, taxYear: currentYear };
}

router.get("/clients/:clientId/tax-health-report", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const loaded = await buildHealthReportFor(params.data.clientId);
  if (!loaded) { res.status(404).json({ error: "Client not found" }); return; }
  res.json({ clientId: params.data.clientId, ...loaded.report });
});

router.get("/clients/:clientId/tax-health-report/pdf", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const loaded = await buildHealthReportFor(params.data.clientId);
  if (!loaded) { res.status(404).json({ error: "Client not found" }); return; }
  const name = await clientName(params.data.clientId);
  if (!name) { res.status(404).json({ error: "Client not found" }); return; }
  const pdf = await buildTaxHealthReportPdf({
    report: loaded.report,
    clientFirstName: name.firstName,
    clientLastName: name.lastName,
    preparedDate: TODAY(),
    firmName: FIRM_NAME(),
  });
  setSecureDownloadHeaders(res, {
    fileName: `tax-health-report-${params.data.clientId}-TY${loaded.taxYear}.pdf`,
    contentType: "application/pdf",
    disposition: "attachment",
    length: pdf.length,
  });
  res.send(pdf);
});

// ─────────────────────────────────────────────────────────────────────────────
// G-8 — Specialty-credit referral detector
// ─────────────────────────────────────────────────────────────────────────────
router.get("/clients/:clientId/specialty-referrals", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const computed = await computeTaxReturn(params.data.clientId);
  if (!computed) { res.status(404).json({ error: "Client not found" }); return; }
  const adjustments = filterAdjustmentsForYear(
    await db.select().from(adjustmentsTable).where(eq(adjustmentsTable.clientId, params.data.clientId)),
    computed.result.taxYear,
  ) as AdjustmentFact[];
  const referrals = detectSpecialtyReferrals({
    client: computed.client as ClientFacts,
    computed: computed.result,
    adjustments,
    baselineInputs: computed.inputs,
  });
  res.json({ clientId: params.data.clientId, taxYear: computed.result.taxYear, referrals });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-5 — Entity Scenario Lab
// ─────────────────────────────────────────────────────────────────────────────
const EntityLabQuery = z.object({
  reasonableComp: z.coerce.number().finite().positive().max(10_000_000).optional(),
  cCorpDistributes: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

router.get("/clients/:clientId/entity-scenario-lab", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const q = EntityLabQuery.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }
  const computed = await computeTaxReturn(params.data.clientId);
  if (!computed) { res.status(404).json({ error: "Client not found" }); return; }
  const result = analyzeEntityScenarioLab({
    baselineInputs: computed.inputs,
    baselineReturn: computed.result,
    reasonableComp: q.data.reasonableComp,
    cCorpDistributes: q.data.cCorpDistributes,
  });
  res.json({ clientId: params.data.clientId, taxYear: computed.result.taxYear, ...result });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-4 — Quarterly Estimate Autopilot
// ─────────────────────────────────────────────────────────────────────────────
const IncomeFeedSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ytdNetSelfEmployment: z.number().finite().optional(),
  ytdWages: z.number().finite().optional(),
  ytdFederalWithheld: z.number().finite().optional(),
  ytdOtherIncome: z.number().finite().optional(),
  monthsElapsed: z.number().int().min(1).max(12),
});
const QuarterlyAutopilotBody = z.object({
  feed: IncomeFeedSchema.optional(),
  paymentsByQuarter: z.array(z.number().finite().min(0)).max(4).optional(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post("/clients/:clientId/quarterly-autopilot", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = QuarterlyAutopilotBody.safeParse(req.body ?? {});
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const current = await computeTaxReturn(params.data.clientId);
  if (!current) { res.status(404).json({ error: "Client not found" }); return; }
  // Prior-year safe-harbor floor (100%/110%) from the prior year's computed return.
  const priorYear = current.result.taxYear - 1;
  const prior = await computeTaxReturn(params.data.clientId, { taxYear: priorYear });
  const result = runQuarterlyAutopilot({
    baselineInputs: current.inputs,
    baselineReturn: current.result,
    priorYearTax: prior ? prior.result.federalTaxLiability : undefined,
    priorYearAgi: prior ? prior.result.adjustedGrossIncome : undefined,
    feed: body.data.feed as IncomeFeedSnapshot | undefined,
    paymentsByQuarter: body.data.paymentsByQuarter,
    asOfDate: body.data.asOfDate ?? TODAY(),
  });
  res.json({ clientId: params.data.clientId, ...result });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-6 — K-1 package ingestion (maps an already-extracted package → engine facts)
// ─────────────────────────────────────────────────────────────────────────────
const RawK1StateScheduleSchema = z.object({
  state: z.string().min(1).max(64),
  ordinaryIncome: z.number().finite().optional(),
  rentalIncome: z.number().finite().optional(),
  apportionmentPct: z.number().finite().optional(),
  note: z.string().max(2000).optional(),
});
const RawK1FootnoteSchema = z.object({
  code: z.string().max(64),
  description: z.string().max(2000),
  amount: z.number().finite().optional(),
});
const RawK1PackageSchema = z.object({
  taxYear: z.number().int().min(2001).max(2100),
  entityName: z.string().min(1).max(256),
  entityKind: z.enum(["1065", "1120S"]),
  activity: z.enum(["active", "passive"]).optional(),
  spouse: z.enum(["taxpayer", "spouse"]).optional(),
  // Bound the key count too (T0.2 C4 DoS standard): the array fields below are
  // already capped, but a record's key count is not — a real K-1 has well under
  // 100 box codes, so 200 is generous headroom while refusing a giant payload.
  boxes: z
    .record(z.string().max(32), z.number().finite())
    .refine((b) => Object.keys(b).length <= 200, { message: "too many box entries (max 200)" }),
  footnotes: z.array(RawK1FootnoteSchema).max(100).optional(),
  stateSchedules: z.array(RawK1StateScheduleSchema).max(60).optional(),
});
// Accept one package or a (bounded) batch.
const K1PackageBody = z.union([RawK1PackageSchema, z.array(RawK1PackageSchema).min(1).max(50)]);

router.post("/clients/:clientId/k1-package", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = K1PackageBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  // Confirm the client exists (the mapped facts are scoped to it once persisted).
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.clientId));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  const pkgs = (Array.isArray(body.data) ? body.data : [body.data]) as RawK1Package[];
  const ingested = ingestK1Packages(pkgs);
  // Persistence of the mapped facts (schedule_k1 rows + a nonresident_source_allocation
  // adjustment when state schedules are present) is a follow-up; return the mapped
  // facts + warnings for CPA review now.
  res.json({ clientId: params.data.clientId, ...ingested });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-1 — IRS Account Monitor (transcript change detection + grounded drafts)
// ─────────────────────────────────────────────────────────────────────────────
const TranscriptLineItemSchema = z.object({
  transactionCode: z.string().max(16),
  description: z.string().max(512),
  date: z.string().max(32),
  amount: z.number().finite(),
});
const TranscriptNoticeSchema = z.object({
  code: z.string().max(32),
  date: z.string().max(32),
  description: z.string().max(512),
  proposedAmount: z.number().finite().optional(),
});
const TranscriptSnapshotSchema = z.object({
  taxYear: z.number().int().min(2001).max(2100),
  asOfDate: z.string().max(32),
  accountBalance: z.number().finite(),
  lineItems: z.array(TranscriptLineItemSchema).max(500),
  notices: z.array(TranscriptNoticeSchema).max(100),
});
const TranscriptMonitorBody = z.object({
  current: TranscriptSnapshotSchema,
  prior: TranscriptSnapshotSchema.nullable().optional(),
});

router.post("/clients/:clientId/transcript-monitor", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = TranscriptMonitorBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.clientId));
  if (!client) { res.status(404).json({ error: "Client not found" }); return; }
  const alerts = detectTranscriptChanges({
    prior: (body.data.prior ?? null) as TranscriptSnapshot | null,
    current: body.data.current as TranscriptSnapshot,
  });
  // Persisting `current` as the next baseline for the next diff is a follow-up
  // (needs a transcript_snapshots table); the diff is computed over the supplied pair.
  res.json({ clientId: params.data.clientId, taxYear: body.data.current.taxYear, alerts });
});

const NoticeResponseBody = z.object({
  notice: TranscriptNoticeSchema,
  preparerName: z.string().max(256).optional(),
});

router.post("/clients/:clientId/notice-response-draft", async (req, res): Promise<void> => {
  const params = GetTaxReturnParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = NoticeResponseBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const computed = await computeTaxReturn(params.data.clientId);
  if (!computed) { res.status(404).json({ error: "Client not found" }); return; }
  const name = await clientName(params.data.clientId);
  if (!name) { res.status(404).json({ error: "Client not found" }); return; }
  const draft = draftNoticeResponse({
    notice: body.data.notice,
    computed: computed.result,
    clientFirstName: name.firstName,
    clientLastName: name.lastName,
    preparerName: body.data.preparerName,
    asOfDate: TODAY(),
  });
  res.json({ clientId: params.data.clientId, ...draft });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-2 — Second-Look Prospect Analyzer (lead-gen; the person is NOT a stored client)
// ─────────────────────────────────────────────────────────────────────────────
const ProspectReturnInputSchema = z.object({
  filingStatus: z.string().min(1).max(32),
  state: z.string().max(2).nullable().optional(),
  taxYear: z.number().int().min(2001).max(2100),
  wages: z.number().finite().optional(),
  interestIncome: z.number().finite().optional(),
  ordinaryDividends: z.number().finite().optional(),
  qualifiedDividends: z.number().finite().optional(),
  capitalGains: z.number().finite().optional(),
  scheduleCNet: z.number().finite().optional(),
  iraDistributions: z.number().finite().optional(),
  socialSecurityBenefits: z.number().finite().optional(),
  reportedAgi: z.number().finite().optional(),
  reportedTaxableIncome: z.number().finite().optional(),
  reportedTotalTax: z.number().finite().optional(),
  itemizedDeductions: z.number().finite().optional(),
});

router.post("/prospect-analysis", (req, res): void => {
  const body = ProspectReturnInputSchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const analysis = analyzeProspect(body.data as ProspectReturnInput);
  res.json(analysis);
});

const ProspectPdfBody = z.object({
  prospect: ProspectReturnInputSchema,
  prospectName: z.string().min(1).max(256),
});

router.post("/prospect-analysis/pdf", async (req, res): Promise<void> => {
  const body = ProspectPdfBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const analysis = analyzeProspect(body.data.prospect as ProspectReturnInput);
  const pdf = await buildProspectTeaserPdf({
    analysis,
    prospectName: body.data.prospectName,
    preparedDate: TODAY(),
    firmName: FIRM_NAME(),
  });
  setSecureDownloadHeaders(res, {
    fileName: `second-look-${analysis.taxYear}.pdf`,
    contentType: "application/pdf",
    disposition: "attachment",
    length: pdf.length,
  });
  res.send(pdf);
});

export default router;
