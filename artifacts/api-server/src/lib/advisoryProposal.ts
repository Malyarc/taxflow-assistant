/**
 * G-3 — Advisory Proposal + ROI packager.
 *
 * Turns a client's detected tax-planning opportunities into a fee PROPOSAL the
 * CPA sends to win the advisory engagement: it sums the headline savings,
 * splits recurring vs one-time benefit, derives (or accepts) a planning fee,
 * computes the ROI story (savings ÷ fee), and renders a branded acceptance PDF.
 *
 * This module is PURE & Haven-portable: NO Date / Date.now / Math.random / DB /
 * fs / network / process. Any "today"/preparedDate is a caller-supplied string
 * parameter — the same discipline planningReportPdf.ts follows. It never
 * invents a tax number; the only arithmetic it does is on the deterministic
 * `verifiedSavings ?? estSavings` the planning engine already produced, plus a
 * transparent fee/ROI derivation the CPA can audit.
 *
 * Brand: Brookhaven palette + the three-ascending-bars mark, via pdfBrand.ts.
 */
import PDFDocument from "pdfkit";
import type { OpportunityHit } from "@workspace/planning-strategies";
import {
  TRUSTED_BLUE,
  BRAND_BLUE,
  GOLD,
  SUCCESS,
  INK,
  MUTED,
  usd,
  applyBrandFooters,
  winAnsiSafePdf,
} from "./pdfBrand";

const PAGE_BOTTOM = 720; // letter height 792 − ~72 margin (mirrors planningReportPdf)

/** Default fraction of total savings used to derive the fee when none is given. */
export const DEFAULT_FEE_RATE = 0.2;
/** Default floor for a derived fee. */
export const DEFAULT_MIN_FEE = 500;

export interface AdvisoryProposalInput {
  clientFirstName: string;
  clientLastName: string;
  taxYear: number;
  hits: OpportunityHit[];
  /** Optional explicit flat fee; else derived. */
  proposedFee?: number;
  /** fraction of total savings used to derive the fee when proposedFee absent; default 0.2 */
  feeRate?: number;
  /** floor for a derived fee; default 500 */
  minFee?: number;
  firmName?: string;
}

export interface AdvisoryProposalLineItem {
  strategyId: string;
  name: string;
  savings: number;
  cpaEffortHours: number;
  recurring: boolean;
  savingsSource: "engine-verified" | "estimate";
}

export interface AdvisoryProposal {
  totalSavings: number;
  recurringSavings: number;
  oneTimeSavings: number;
  proposedFee: number;
  feeSource: "explicit" | "derived";
  /** savings ÷ fee, rounded to 1 decimal (0 when fee is 0). */
  roiRatio: number;
  /** savings − fee */
  netClientBenefit: number;
  /** ceil(totalEffortHours) */
  totalCpaHours: number;
  /** sorted desc by savings */
  lineItems: AdvisoryProposalLineItem[];
  assumptions: string[];
}

/**
 * Headline savings for one hit — the engine-verified what-if delta when present,
 * else the heuristic estimate. Same rule the planning report + hit-list use.
 */
function headlineSavings(h: OpportunityHit): number {
  return h.verifiedSavings ?? h.estSavings;
}

/** Round to whole dollars (client-deliverable convention). */
function roundDollars(n: number): number {
  return Math.round(n);
}

/** Round to one decimal place (the ROI ratio precision). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Build the structured advisory proposal from a client's detected hits.
 *
 * - totalSavings   = Σ headlineSavings, rounded to whole dollars.
 * - recurring vs one-time split by `hit.recurring`.
 * - fee: when `proposedFee` is supplied it is used verbatim (feeSource
 *   "explicit"); otherwise derived as max(minFee, round(totalSavings ×
 *   feeRate)) (feeSource "derived"). A supplied fee of exactly 0 is honored
 *   as explicit (the CPA may comp a proposal); only `undefined` triggers
 *   derivation.
 * - roiRatio = round1(totalSavings / fee) when fee > 0, else 0.
 * - netClientBenefit = totalSavings − fee.
 * - totalCpaHours = ceil(Σ cpaEffortHours).
 * - lineItems sorted by savings descending (stable for ties by input order).
 */
export function buildAdvisoryProposal(input: AdvisoryProposalInput): AdvisoryProposal {
  const feeRate = input.feeRate ?? DEFAULT_FEE_RATE;
  const minFee = input.minFee ?? DEFAULT_MIN_FEE;

  const lineItems: AdvisoryProposalLineItem[] = input.hits.map((h) => ({
    strategyId: h.strategyId,
    name: h.name,
    savings: roundDollars(headlineSavings(h)),
    cpaEffortHours: h.cpaEffortHours,
    recurring: h.recurring,
    savingsSource: h.savingsSource ?? "estimate",
  }));

  // Sort desc by savings; keep input order for equal values (stable sort).
  lineItems.sort((a, b) => b.savings - a.savings);

  const totalSavings = roundDollars(lineItems.reduce((s, li) => s + li.savings, 0));
  const recurringSavings = roundDollars(
    lineItems.filter((li) => li.recurring).reduce((s, li) => s + li.savings, 0),
  );
  const oneTimeSavings = roundDollars(totalSavings - recurringSavings);

  const totalCpaHours = Math.ceil(lineItems.reduce((s, li) => s + li.cpaEffortHours, 0));

  let proposedFee: number;
  let feeSource: "explicit" | "derived";
  if (input.proposedFee != null) {
    proposedFee = roundDollars(input.proposedFee);
    feeSource = "explicit";
  } else {
    proposedFee = Math.max(minFee, roundDollars(totalSavings * feeRate));
    feeSource = "derived";
  }

  const roiRatio = proposedFee > 0 ? round1(totalSavings / proposedFee) : 0;
  const netClientBenefit = roundDollars(totalSavings - proposedFee);

  const hasEstimate = lineItems.some((li) => li.savingsSource === "estimate");
  const hasRecurring = lineItems.some((li) => li.recurring);

  const assumptions: string[] = [
    "Savings are current-year engine-verified where marked; estimates are heuristic and may require client data to confirm.",
    "Fee is a planning-engagement quote, separate from return-preparation fees.",
    "ROI compares first-year savings to the planning fee; recurring strategies compound the benefit in later years.",
  ];
  if (feeSource === "derived") {
    assumptions.push(
      `Fee derived as ${Math.round(feeRate * 100)}% of identified first-year savings, floored at ${usd(minFee)}.`,
    );
  } else {
    assumptions.push("Fee is a fixed quote set by the firm.");
  }
  if (hasRecurring) {
    assumptions.push(
      `Recurring strategies represent ${usd(recurringSavings)}/yr of the total and repeat in future years.`,
    );
  }
  if (hasEstimate) {
    assumptions.push(
      "Heuristic estimates are confirmed against the full return before any strategy is implemented.",
    );
  }

  return {
    totalSavings,
    recurringSavings,
    oneTimeSavings,
    proposedFee,
    feeSource,
    roiRatio,
    netClientBenefit,
    totalCpaHours,
    lineItems,
    assumptions,
  };
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/** Three ascending rounded bars — the BrandMark, in vector (mirrors planningReportPdf). */
function drawBrandMark(doc: PDFKit.PDFDocument, x: number, y: number, scale = 1): void {
  const w = 10 * scale;
  const gap = 6 * scale;
  const heights = [18 * scale, 30 * scale, 42 * scale];
  const colors = [BRAND_BLUE, "#8ED4F0", GOLD];
  heights.forEach((h, i) => {
    doc.roundedRect(x + i * (w + gap), y + (heights[2] - h), w, h, 2 * scale).fill(colors[i]);
  });
}

function ensureRoom(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE_BOTTOM) doc.addPage();
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string): void {
  ensureRoom(doc, 60);
  doc.moveDown(0.8);
  doc.fontSize(15).font("Helvetica-Bold").fillColor(TRUSTED_BLUE).text(title, 54, doc.y);
  doc.moveTo(54, doc.y + 2).lineTo(558, doc.y + 2).lineWidth(1.5).strokeColor(BRAND_BLUE).stroke();
  doc.moveDown(0.6);
}

export interface BuildAdvisoryProposalPdfArgs {
  proposal: AdvisoryProposal;
  clientFirstName: string;
  clientLastName: string;
  taxYear: number;
  /** Caller-supplied date string printed on the cover (route passes today). */
  preparedDate: string;
  firmName?: string;
}

/**
 * Render the branded advisory proposal PDF — a real client deliverable (no
 * "DRAFT" watermark). Layout: branded cover with the headline ROI + savings,
 * an executive summary, a per-strategy savings table, a fee + ROI box, and an
 * engagement-acceptance / signature block. A footer disclosure notes the
 * figures are estimates pending the signed engagement.
 */
export function buildAdvisoryProposalPdf(args: BuildAdvisoryProposalPdfArgs): Promise<Buffer> {
  const { proposal, clientFirstName, clientLastName, taxYear, preparedDate } = args;
  const firmName = args.firmName ?? "Your CPA team";

  return new Promise((resolve, reject) => {
    const doc = winAnsiSafePdf(
      new PDFDocument({ size: "letter", margin: 54, bufferPages: true }),
    ); // M5 WinAnsi glyph seam
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Cover ────────────────────────────────────────────────────────────
    doc.rect(0, 0, 612, 240).fill(TRUSTED_BLUE);
    drawBrandMark(doc, 54, 48, 1.2);
    doc
      .fontSize(26)
      .font("Helvetica-Bold")
      .fillColor("#ffffff")
      .text("Tax Advisory Proposal", 54, 120);
    doc
      .fontSize(13)
      .font("Helvetica")
      .fillColor("#c7d6f0")
      .text(`${clientFirstName} ${clientLastName} · Tax year ${taxYear}`, 54, 156);
    doc
      .fontSize(10)
      .fillColor("#9fb3d8")
      .text(`Prepared ${preparedDate} by ${firmName}`, 54, 178);

    // Headline ROI / savings band.
    doc.y = 270;
    if (proposal.lineItems.length > 0 && proposal.totalSavings > 0) {
      doc
        .fontSize(11)
        .font("Helvetica")
        .fillColor(MUTED)
        .text("Estimated first-year tax savings we identified for you", 54, doc.y);
      doc
        .fontSize(34)
        .font("Helvetica-Bold")
        .fillColor(SUCCESS)
        .text(usd(proposal.totalSavings), 54, doc.y + 4);
      const roiLine =
        proposal.roiRatio > 0
          ? `That is about ${proposal.roiRatio.toFixed(1)}x our proposed planning fee of ${usd(proposal.proposedFee)} — ` +
            `a net first-year benefit to you of ${usd(proposal.netClientBenefit)}.`
          : `Our proposed planning fee is ${usd(proposal.proposedFee)}.`;
      doc
        .fontSize(11)
        .font("Helvetica")
        .fillColor(INK)
        .text(roiLine, 54, doc.y + 8, { width: 504 });
    } else {
      doc
        .fontSize(12)
        .font("Helvetica")
        .fillColor(INK)
        .text(
          "Based on the current data we did not identify additional planning savings beyond your current position. " +
            "We re-run this analysis whenever your situation changes and will propose an engagement when an opportunity appears.",
          54,
          doc.y,
          { width: 504 },
        );
    }

    // ── Executive summary ─────────────────────────────────────────────────
    sectionHeading(doc, "Executive summary");
    {
      const recurringNote =
        proposal.recurringSavings > 0
          ? ` Of this, ${usd(proposal.recurringSavings)} recurs every year, so the multi-year value is materially larger.`
          : "";
      doc
        .fontSize(10)
        .font("Helvetica")
        .fillColor(INK)
        .text(
          `We identified ${proposal.lineItems.length} planning ` +
            `strateg${proposal.lineItems.length === 1 ? "y" : "ies"} worth an estimated ` +
            `${usd(proposal.totalSavings)} in first-year federal + state tax savings.${recurringNote} ` +
            `Implementing them is an estimated ${proposal.totalCpaHours} hours of professional work, which we propose to ` +
            `deliver for a flat planning fee of ${usd(proposal.proposedFee)}` +
            (proposal.roiRatio > 0
              ? ` — a return of roughly ${proposal.roiRatio.toFixed(1)}x in the first year alone.`
              : "."),
          54,
          doc.y,
          { width: 504 },
        );
    }

    // ── Per-strategy savings table ────────────────────────────────────────
    if (proposal.lineItems.length > 0) {
      sectionHeading(doc, "Where the savings come from");
      // Column header row.
      ensureRoom(doc, 28);
      const headY = doc.y;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(MUTED);
      doc.text("Strategy", 62, headY, { width: 300 });
      doc.text("Type", 366, headY, { width: 90 });
      doc.text("Est. savings", 456, headY, { width: 96, align: "right" });
      doc.moveTo(54, headY + 14).lineTo(558, headY + 14).lineWidth(0.5).strokeColor(MUTED).stroke();
      doc.y = headY + 20;

      for (const li of proposal.lineItems) {
        ensureRoom(doc, 26);
        const rowY = doc.y;
        doc.fontSize(10).font("Helvetica-Bold").fillColor(INK).text(li.name, 62, rowY, { width: 300 });
        const afterName = doc.y;
        const typeLabel = li.recurring ? "Recurring" : "One-time";
        doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(typeLabel, 366, rowY, { width: 90 });
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor(SUCCESS)
          .text(usd(li.savings), 456, rowY, { width: 96, align: "right" });
        if (li.savingsSource === "engine-verified") {
          doc
            .fontSize(7)
            .font("Helvetica")
            .fillColor(BRAND_BLUE)
            .text("engine-verified", 456, Math.max(afterName, rowY + 12), {
              width: 96,
              align: "right",
            });
        }
        doc.y = Math.max(afterName, rowY + 12) + 8;
      }

      // Total row.
      ensureRoom(doc, 24);
      const totY = doc.y;
      doc.moveTo(54, totY).lineTo(558, totY).lineWidth(0.75).strokeColor(TRUSTED_BLUE).stroke();
      doc
        .fontSize(10.5)
        .font("Helvetica-Bold")
        .fillColor(TRUSTED_BLUE)
        .text("Total identified savings", 62, totY + 5, { width: 360 });
      doc
        .fontSize(10.5)
        .font("Helvetica-Bold")
        .fillColor(SUCCESS)
        .text(usd(proposal.totalSavings), 456, totY + 5, { width: 96, align: "right" });
      doc.y = totY + 24;
    }

    // ── Fee + ROI box ─────────────────────────────────────────────────────
    sectionHeading(doc, "Your investment and return");
    {
      ensureRoom(doc, 120);
      const boxY = doc.y;
      const boxH = 96;
      doc.roundedRect(54, boxY, 504, boxH, 6).fillAndStroke("#f5f8fc", BRAND_BLUE);
      const col = (x: number, label: string, value: string, valueColor: string) => {
        doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(label, x, boxY + 16, { width: 150 });
        doc.fontSize(18).font("Helvetica-Bold").fillColor(valueColor).text(value, x, boxY + 32, { width: 150 });
      };
      col(74, "First-year savings", usd(proposal.totalSavings), SUCCESS);
      col(244, "Planning fee", usd(proposal.proposedFee), TRUSTED_BLUE);
      col(414, "Return on fee", proposal.roiRatio > 0 ? `${proposal.roiRatio.toFixed(1)}x` : "—", GOLD);
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor(INK)
        .text(
          `Net first-year benefit to you (savings − fee): ${usd(proposal.netClientBenefit)}.`,
          74,
          boxY + 70,
          { width: 464 },
        );
      doc.y = boxY + boxH + 10;
    }

    // ── Assumptions ───────────────────────────────────────────────────────
    sectionHeading(doc, "How these numbers were prepared");
    for (const a of proposal.assumptions) {
      ensureRoom(doc, 24);
      doc.fontSize(9).font("Helvetica").fillColor(INK).text(`• ${a}`, 62, doc.y, { width: 488 });
      doc.moveDown(0.2);
    }

    // ── Engagement acceptance / signature block ───────────────────────────
    sectionHeading(doc, "Accept this engagement");
    doc
      .fontSize(9.5)
      .font("Helvetica")
      .fillColor(INK)
      .text(
        `To proceed, sign below. This authorizes ${firmName} to perform the planning work described above for the flat fee of ` +
          `${usd(proposal.proposedFee)}. This is a planning engagement only and is separate from tax-return preparation.`,
        54,
        doc.y,
        { width: 504 },
      );
    doc.moveDown(1.5);
    {
      ensureRoom(doc, 60);
      const sigY = doc.y;
      // Client signature line.
      doc.moveTo(62, sigY + 24).lineTo(300, sigY + 24).lineWidth(0.75).strokeColor(INK).stroke();
      doc.fontSize(8.5).font("Helvetica").fillColor(MUTED).text("Accepted by", 62, sigY + 28);
      // Date line.
      doc.moveTo(330, sigY + 24).lineTo(470, sigY + 24).lineWidth(0.75).strokeColor(INK).stroke();
      doc.fontSize(8.5).font("Helvetica").fillColor(MUTED).text("Date", 330, sigY + 28);
      doc.y = sigY + 48;
    }

    applyBrandFooters(
      doc,
      (i, count) =>
        `${firmName} · Tax Advisory Proposal · ${clientFirstName} ${clientLastName} · TY${taxYear} · ` +
        `figures are estimates pending engagement · page ${i + 1} of ${count}`,
    );

    doc.end();
  });
}
