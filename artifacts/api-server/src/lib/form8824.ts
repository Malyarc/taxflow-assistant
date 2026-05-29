/**
 * Form 8824 — Like-Kind Exchanges (§1031).
 *
 * Substitute Form 8824 PDF rendered via pdfkit (per Pub 1167 — "substitute
 * forms are acceptable provided they conform to IRS specifications and
 * faithfully reflect the line numbers and content of the official form").
 *
 * C3 follow-up (2026-05-27 PM): closes the C-batch v1 sub-gap "Form 8824 PDF
 * for §1031 reporting deferred". Engine already computes recognized vs
 * deferred gain (C5); this module renders a CPA-fileable PDF summary that
 * the CPA can attach to the client's return (or use as a hand-typed reference
 * for the official IRS form).
 *
 * Layout follows official Form 8824:
 *   Part I   — Information on the Like-Kind Exchange (Lines 1-7)
 *   Part II  — Related Party Exchange Information (Lines 8-11)
 *   Part III — Realized Gain or (Loss), Recognized Gain, and Basis of Like-
 *              Kind Property Received (Lines 12-25)
 *   Part IV  — Deferral of Gain From Section 1043 Conflict-of-Interest Sales
 *              (not modeled; rarely used)
 *
 * Engine inputs (from the existing §1031 adjustments):
 *   - section_1031_realized_gain: realized gain on sale
 *   - section_1031_boot_received: non-like-kind property/cash received
 *     (recognized gain = MIN(realized, boot))
 *   Output: recognized + deferred gain, basis of received property.
 */

import PDFDocument from "pdfkit";

export interface Form8824Data {
  /** Tax year (e.g. 2024). */
  taxYear: number;
  /** Filer's full name. */
  taxpayerName: string;
  /** Filer's filing status. */
  filingStatus: string;
  /**
   * Description of the like-kind property given up. CPA-supplied; defaults
   * to a placeholder if not provided.
   */
  propertyGivenUp?: string;
  /** Description of the like-kind property received. */
  propertyReceived?: string;
  /** Date the property given up was originally acquired. */
  dateAcquired?: string;
  /** Date the property given up was transferred. */
  dateTransferred?: string;
  /** Date of identification of replacement property (must be ≤ 45 days). */
  dateIdentified?: string;
  /** Date the replacement property was actually received (must be ≤ 180 days). */
  dateReceived?: string;
  /** Line 12 — FMV of like-kind property received. */
  fmvLikeKindReceived?: number;
  /** Line 13 — Adjusted basis of property given up. */
  adjustedBasisGivenUp?: number;
  /** Line 15 — Cash + FMV of non-like-kind property received (boot). */
  bootReceived: number;
  /** Line 18 — Realized gain or (loss). */
  realizedGain: number;
  /** Line 22 — Recognized gain (= LESSER OF realized OR boot received). */
  recognizedGain: number;
  /** Line 24 — Deferred gain or (loss) (= realized − recognized). */
  deferredGain: number;
  /** Line 25 — Basis of like-kind property received. */
  basisOfReceived?: number;
}

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_widow: "Qualifying Surviving Spouse",
};

function fmtCurrency(n: number): string {
  if (Number.isNaN(n) || !Number.isFinite(n)) return "—";
  const formatted = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return n < 0 ? `(${formatted})` : formatted;
}

function field(doc: PDFKit.PDFDocument, label: string, value: string): void {
  const y = doc.y;
  doc.font("Helvetica").fillColor("#444").text(label, 54, y, {
    width: 240,
    continued: false,
  });
  doc
    .font("Helvetica-Bold")
    .fillColor("#000")
    .text(value, 296, y, { width: 262, align: "left" });
  doc.moveDown(0.25);
}

function moneyLine(
  doc: PDFKit.PDFDocument,
  label: string,
  amount: number,
  emphasis = false,
): void {
  const y = doc.y;
  doc.font("Helvetica").fillColor("#444").text(label, 54, y, {
    width: 360,
    continued: false,
  });
  doc
    .font("Helvetica-Bold")
    .fillColor(emphasis ? "#0a5d2a" : "#000")
    .fontSize(emphasis ? 11 : 10)
    .text(fmtCurrency(amount), 420, y, { width: 138, align: "right" });
  doc.fontSize(10);
  doc.moveDown(0.25);
}

export interface BuildForm8824PdfOptions {
  data: Form8824Data;
}

/**
 * Render a CPA-fileable substitute Form 8824 PDF. The CPA hand-files the
 * fillable IRS form using these values; this PDF is the engine's audit
 * trail of the recognized/deferred gain calculation.
 */
export function buildForm8824Pdf(
  options: BuildForm8824PdfOptions,
): Promise<Buffer> {
  const { data } = options;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ──
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Form 8824", { continued: true })
      .font("Helvetica")
      .text("    Like-Kind Exchanges (§1031)");
    doc
      .fontSize(11)
      .text("And Section 1043 Conflict-of-Interest Sales");
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(`Tax year ${data.taxYear}  ·  Department of the Treasury — Internal Revenue Service`);
    doc.moveDown(0.3);
    doc
      .fontSize(8)
      .fillColor("#888")
      .text(
        `Prepared by TaxFlow Assistant on ${new Date().toLocaleDateString(
          "en-US",
          { year: "numeric", month: "long", day: "numeric" },
        )}. Substitute form per Pub 1167.`,
      );
    doc.moveDown(1);

    // ── Important reminders box ──
    const noticeTop = doc.y;
    doc
      .rect(54, noticeTop, 504, 64)
      .lineWidth(0.5)
      .strokeColor("#aa6600")
      .stroke();
    doc
      .fontSize(9)
      .fillColor("#aa6600")
      .font("Helvetica-Bold")
      .text("§1031 Timing Rules", 64, noticeTop + 6);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#444")
      .text(
        "Identification period: 45 days after sale of relinquished property. Exchange period: 180 days after sale (or due date of return, whichever is earlier). Post-TCJA: §1031 applies ONLY to real property held for productive use in a trade/business or for investment. Personal property exchanges are no longer eligible.",
        64,
        noticeTop + 22,
        { width: 484 },
      );
    doc.y = noticeTop + 72;
    doc.moveDown(0.5);

    // ── Part I — Information on the Like-Kind Exchange ──
    doc
      .fontSize(11)
      .fillColor("#000")
      .font("Helvetica-Bold")
      .text("Part I  Information on the Like-Kind Exchange");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#222");

    field(doc, "Taxpayer name", data.taxpayerName || "—");
    field(
      doc,
      "Filing status",
      FILING_STATUS_LABELS[data.filingStatus] ?? data.filingStatus,
    );
    field(
      doc,
      "Line 1. Description of like-kind property given up",
      data.propertyGivenUp || "(CPA to enter)",
    );
    field(
      doc,
      "Line 2. Description of like-kind property received",
      data.propertyReceived || "(CPA to enter)",
    );
    field(doc, "Line 3. Date property given up was originally acquired", data.dateAcquired || "—");
    field(
      doc,
      "Line 4. Date property given up was actually transferred",
      data.dateTransferred || "—",
    );
    field(
      doc,
      "Line 5. Date like-kind property received was identified",
      data.dateIdentified || "(must be ≤ 45 days after Line 4)",
    );
    field(
      doc,
      "Line 6. Date you actually received like-kind property",
      data.dateReceived || "(must be ≤ 180 days after Line 4)",
    );
    field(
      doc,
      "Line 7. Was the exchange with a related party?",
      "(CPA marks YES/NO — see Part II)",
    );
    doc.moveDown(0.5);

    // ── Part II — Related Party (skipped placeholder) ──
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Part II  Related Party Exchange Information");
    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica").fillColor("#666");
    doc.text(
      "If Line 7 = YES, complete Part II (Lines 8-11): related party name, address, SSN/EIN, " +
        "relationship, and whether either party disposed of the like-kind property within 2 years " +
        "(triggers recognition of the deferred gain). The engine does NOT auto-fill Part II; CPA " +
        "supplies on the IRS-filed copy.",
      54,
      doc.y,
      { width: 504 },
    );
    doc.moveDown(0.8);

    // ── Part III — Realized Gain, Recognized Gain, Basis of Received Property ──
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Part III  Realized Gain, Recognized Gain, and Basis of Like-Kind Property Received");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#222");

    if (data.fmvLikeKindReceived != null) {
      moneyLine(
        doc,
        "Line 12. FMV of like-kind property received",
        data.fmvLikeKindReceived,
      );
    }
    if (data.adjustedBasisGivenUp != null) {
      moneyLine(
        doc,
        "Line 13. Adjusted basis of like-kind property given up",
        data.adjustedBasisGivenUp,
      );
    }
    moneyLine(
      doc,
      "Line 15. Cash + FMV of non-like-kind property received (boot)",
      data.bootReceived,
    );
    moneyLine(doc, "Line 18. Realized gain or (loss)", data.realizedGain);
    moneyLine(
      doc,
      "Line 22. Recognized gain (= MIN of Line 18 OR Line 15)",
      data.recognizedGain,
      true,
    );
    moneyLine(
      doc,
      "Line 24. Deferred gain or (loss) (= Line 18 − Line 22)",
      data.deferredGain,
      true,
    );
    if (data.basisOfReceived != null) {
      moneyLine(
        doc,
        "Line 25. Basis of like-kind property received",
        data.basisOfReceived,
      );
    }
    doc.moveDown(0.5);

    // ── Engine math summary ──
    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Engine calculation summary");
    doc.moveDown(0.2);
    doc.fontSize(9).font("Helvetica").fillColor("#444");
    doc.text(
      `Realized gain = ${fmtCurrency(data.realizedGain)}.  Boot received = ${fmtCurrency(data.bootReceived)}.  ` +
        `Recognized gain = MIN(realized, boot) = ${fmtCurrency(data.recognizedGain)} (flows to Schedule D Line 13 as long-term capital gain). ` +
        `Deferred gain = ${fmtCurrency(data.deferredGain)} (reduces basis of replacement property under §1031(d)). ` +
        `Engine assumes the §1031 transaction qualifies — CPA must verify the property is real property held for ` +
        `productive use in a trade/business or for investment, that the timing rules (45/180 day) are met, and that ` +
        `the exchange isn't with a related party requiring 2-year holding (or if it is, that the holding is met).`,
      54,
      doc.y,
      { width: 504 },
    );
    doc.moveDown(0.8);

    // ── Footnote / signature ──
    doc.fontSize(9).fillColor("#666");
    doc.text(
      "Note: recognized §1031 boot gain flows to Schedule D LTCG AND is already included in the engine's " +
        "§1411 NIIT investment-income base (to the extent it survives capital-loss netting) — do NOT add " +
        "3.8% NIIT on it manually. Form 8824 Part IV (§1043 conflict-of-interest sales) not rendered.",
      54,
      doc.y,
      { width: 504 },
    );
    doc.moveDown(2);

    doc
      .fontSize(8)
      .fillColor("#aaa")
      .text(
        "End of substitute Form 8824. CPA: transcribe these line values to the official IRS Form 8824 (or use this PDF as audit-trail backup).",
      );

    doc.end();
  });
}
