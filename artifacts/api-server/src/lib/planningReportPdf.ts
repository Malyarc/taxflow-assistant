/**
 * T2.2 D1 — Client-facing branded planning deliverable (PDF).
 *
 * The polished artifact a CPA hands (or emails) to the client to SELL the
 * planning engagement: a branded cover with the headline savings number, an
 * executive summary, one block per opportunity (in client-readable language —
 * the engine's rationale/action strings), the deadline calendar, and a
 * disclosure page. All dollar values are deterministic engine output — this
 * renderer never computes or invents a number (it only sums the same
 * `estSavings` the planning endpoints already report).
 *
 * Brand: Brookhaven palette (Trusted Blue #231F55 primary, Brookhaven Blue
 * #41B9EA accent, gold #F0CA17 sparingly) + the three-ascending-bars mark
 * (mirrors src/components/BrandMark.tsx).
 *
 * `preparedDate` is caller-supplied so this module stays deterministic.
 */
import PDFDocument from "pdfkit";
import type { OpportunityHit } from "@workspace/planning-strategies";
import type { PlanningCalendar } from "./planningCalendar";

const TRUSTED_BLUE = "#231F55";
const BRAND_BLUE = "#41B9EA";
const GOLD = "#F0CA17";
const SUCCESS = "#15803d";
const INK = "#1f2430";
const MUTED = "#6b7280";

const PAGE_BOTTOM = 720; // letter height 792 − ~72 margin

export interface PlanningReportClient {
  firstName: string;
  lastName: string;
  state?: string | null;
  filingStatus?: string | null;
}

export interface BuildPlanningReportArgs {
  client: PlanningReportClient;
  taxYear: number;
  hits: OpportunityHit[];
  calendar: PlanningCalendar;
  /** Multi-year trend hits (subset of OpportunityHit fields used). */
  multiYearHits?: Array<Pick<OpportunityHit, "name" | "estSavings" | "rationale">>;
  /** ISO or human date string printed on the cover (route passes today). */
  preparedDate: string;
  /** Firm name on the cover / footer. */
  firmName?: string;
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function headlineSavings(h: OpportunityHit): number {
  return h.verifiedSavings ?? h.estSavings;
}

/** Three ascending rounded bars — the BrandMark, in vector. */
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

export function buildPlanningReportPdf(args: BuildPlanningReportArgs): Promise<Buffer> {
  const { client, taxYear, calendar, preparedDate } = args;
  const firmName = args.firmName ?? "Your CPA team";
  const hits = [...args.hits].sort((a, b) => headlineSavings(b) - headlineSavings(a));
  const totalSavings = hits.reduce((s, h) => s + headlineSavings(h), 0);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 54, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Cover ────────────────────────────────────────────────────────────
    doc.rect(0, 0, 612, 240).fill(TRUSTED_BLUE);
    drawBrandMark(doc, 54, 48, 1.2);
    doc.fontSize(26).font("Helvetica-Bold").fillColor("#ffffff")
      .text("Tax Planning Report", 54, 120);
    doc.fontSize(13).font("Helvetica").fillColor("#c7d6f0")
      .text(`${client.firstName} ${client.lastName} · Tax year ${taxYear}`, 54, 156);
    doc.fontSize(10).fillColor("#9fb3d8")
      .text(`Prepared ${preparedDate} by ${firmName}`, 54, 178);

    doc.y = 270;
    if (hits.length > 0) {
      doc.fontSize(11).font("Helvetica").fillColor(MUTED)
        .text("Estimated annual tax-saving opportunities identified", 54, doc.y);
      doc.fontSize(34).font("Helvetica-Bold").fillColor(SUCCESS)
        .text(usd(totalSavings), 54, doc.y + 4);
      doc.fontSize(11).font("Helvetica").fillColor(INK).text(
        `across ${hits.length} strateg${hits.length === 1 ? "y" : "ies"} our planning engine matched to your return. ` +
        `Each one is itemized below with the action it requires and the rule it relies on.`,
        54, doc.y + 8, { width: 504 },
      );
    } else {
      doc.fontSize(12).font("Helvetica").fillColor(INK).text(
        "Our planning engine found no additional savings opportunities on the current data — your return is already well-optimized. " +
        "We re-run this analysis whenever your situation changes.",
        54, doc.y, { width: 504 },
      );
    }

    // ── Executive summary (top 3) ─────────────────────────────────────────
    if (hits.length > 0) {
      sectionHeading(doc, "Where the savings come from");
      for (const h of hits.slice(0, 3)) {
        ensureRoom(doc, 48);
        doc.fontSize(11.5).font("Helvetica-Bold").fillColor(INK)
          .text(h.name, 54, doc.y, { continued: true })
          .fillColor(SUCCESS).text(`   ${usd(headlineSavings(h))}`);
        doc.fontSize(9.5).font("Helvetica").fillColor(MUTED)
          .text(h.rationale, 54, doc.y + 1, { width: 504 });
        doc.moveDown(0.5);
      }
    }

    // ── Opportunity detail ────────────────────────────────────────────────
    if (hits.length > 0) {
      sectionHeading(doc, "The full opportunity list");
      hits.forEach((h, idx) => {
        ensureRoom(doc, 110);
        const y0 = doc.y + 8;
        doc.fontSize(12).font("Helvetica-Bold").fillColor(TRUSTED_BLUE)
          .text(`${idx + 1}. ${h.name}`, 62, y0, { width: 352 });
        const afterName = doc.y;
        doc.fontSize(13).font("Helvetica-Bold").fillColor(SUCCESS)
          .text(usd(headlineSavings(h)), 422, y0, { width: 130, align: "right" });
        if (h.verifiedSavings != null) {
          doc.fontSize(7.5).font("Helvetica").fillColor(BRAND_BLUE)
            .text("engine-verified what-if", 422, doc.y + 1, { width: 130, align: "right" });
        }
        doc.y = Math.max(afterName, doc.y) + 5;
        doc.fontSize(9.5).font("Helvetica").fillColor(INK)
          .text(h.rationale, 62, doc.y, { width: 488 });
        doc.moveDown(0.3);
        doc.fontSize(9.5).font("Helvetica-Bold").fillColor(INK).text("Next step: ", 62, doc.y, { continued: true })
          .font("Helvetica").text(h.action, { width: 488 });
        doc.moveDown(0.25);
        doc.fontSize(8).font("Helvetica-Oblique").fillColor(MUTED)
          .text(`${h.citation} · confidence ${(h.confidence * 100).toFixed(0)}% · ${h.recurring ? "recurring annual benefit" : "one-time"}`, 62, doc.y, { width: 488 });
        doc.moveDown(0.9);
      });
    }

    // ── Action calendar ───────────────────────────────────────────────────
    if (calendar.groups.length > 0) {
      sectionHeading(doc, "When to act");
      for (const g of calendar.groups) {
        ensureRoom(doc, 40 + g.strategies.length * 14);
        doc.fontSize(11).font("Helvetica-Bold").fillColor(INK)
          .text(g.label + (g.isoDate ? ` — ${g.isoDate}` : ""), 54, doc.y, { continued: true })
          .fillColor(SUCCESS).text(`   ${usd(g.totalSavings)}`);
        for (const s of g.strategies) {
          doc.fontSize(9.5).font("Helvetica").fillColor(MUTED)
            .text(`• ${s.name} (${usd(s.verifiedSavings ?? s.estSavings)})`, 66, doc.y + 1, { width: 480 });
        }
        doc.moveDown(0.5);
      }
    }

    // ── Multi-year trends ─────────────────────────────────────────────────
    if (args.multiYearHits && args.multiYearHits.length > 0) {
      sectionHeading(doc, "Patterns across your last few returns");
      for (const m of args.multiYearHits) {
        ensureRoom(doc, 40);
        doc.fontSize(10.5).font("Helvetica-Bold").fillColor(INK)
          .text(m.name, 54, doc.y, { continued: true })
          .fillColor(SUCCESS).text(`   ${usd(m.estSavings)}`);
        doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(m.rationale, 54, doc.y + 1, { width: 504 });
        doc.moveDown(0.4);
      }
    }

    // ── Disclosures ───────────────────────────────────────────────────────
    sectionHeading(doc, "How to read these numbers");
    doc.fontSize(9).font("Helvetica").fillColor(INK).text(
      "Every dollar figure in this report is the deterministic output of our tax-rule engine run against your actual return data — " +
      "no figure is AI-generated. “Engine-verified” amounts were re-computed by running your full return with and without the strategy applied; " +
      "other amounts are rule-based estimates. All amounts are ESTIMATES of federal + state impact based on current law and the data on file, " +
      "and they change as your facts change. This report is a planning discussion aid, not tax advice, an engagement, or a filed return — " +
      `your CPA at ${firmName} validates every strategy (eligibility, documentation, and interaction effects) before anything is implemented.`,
      54, doc.y, { width: 504 },
    );

    // Footer on every page (bufferPages keeps them addressable until end()).
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(7.5).fillColor(MUTED).text(
        `${firmName} · Tax Planning Report · ${client.firstName} ${client.lastName} · TY${taxYear} · page ${i + 1} of ${range.count}`,
        54, 752, { width: 504, align: "center", lineBreak: false },
      );
    }

    doc.end();
  });
}
