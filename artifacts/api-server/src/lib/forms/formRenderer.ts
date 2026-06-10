/**
 * T2.1 B0 — Generic workpaper form renderer + one-click packet assembler.
 *
 * The ONLY pdfkit dependency in lib/forms/. Renders any `FormInstance`
 * (pure data from the per-form builders) into a consistent substitute-form
 * layout (per Pub 1167 conventions, like the existing form8824/8990 PDFs),
 * and assembles the full "workpaper packet": cover page + reconciliation
 * worksheet + every applicable form, each on its own page, with a DRAFT
 * watermark on every page (T0.2 Phase C3 — these are review workpapers,
 * NOT filed forms).
 */

import PDFDocument from "pdfkit";
import {
  filingStatusLabel,
  type FormInstance,
  type FormLine,
  type WorkpaperTaxpayer,
} from "./formSpec";

const PAGE = {
  width: 612,
  height: 792,
  margin: 54,
  contentWidth: 504,
  /** Start a new page when the cursor would pass this. */
  breakY: 720,
};

const COL = {
  lineX: 54,
  lineW: 36,
  labelX: 96,
  labelW: 288,
  valueX: 392,
  valueW: 166,
};

function fmtMoney(n: number): string {
  const formatted = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${formatted})` : formatted;
}

function fmtValue(l: FormLine): string {
  if (l.value == null) return "—";
  switch (l.kind) {
    case "money":
      return typeof l.value === "number" ? fmtMoney(l.value) : String(l.value);
    case "percent":
      return typeof l.value === "number" ? `${(l.value * 100).toFixed(2)}%` : String(l.value);
    case "count":
      return typeof l.value === "number" ? String(Math.round(l.value)) : String(l.value);
    case "boolean":
      return l.value === true ? "Yes" : l.value === false ? "No" : "—";
    default:
      return String(l.value);
  }
}

/** Light diagonal DRAFT watermark — content overlays it. */
function drawWatermark(doc: PDFKit.PDFDocument): void {
  doc.save();
  doc.rotate(-38, { origin: [306, 396] });
  doc
    .font("Helvetica-Bold")
    .fontSize(34)
    .fillColor("#ededed")
    .text("DRAFT — WORKPAPER — NOT FOR FILING", 0, 380, {
      width: 612,
      align: "center",
      lineBreak: false,
    });
  doc.restore();
  doc.fillColor("#000");
}

function pageBreak(doc: PDFKit.PDFDocument, inst: FormInstance): void {
  doc.addPage();
  doc
    .font("Helvetica-Oblique")
    .fontSize(8)
    .fillColor("#999")
    .text(`${inst.formNumber} — ${inst.title} (continued)`, PAGE.margin, PAGE.margin, {
      width: PAGE.contentWidth,
    });
  doc.y = PAGE.margin + 18;
}

function ensureRoom(doc: PDFKit.PDFDocument, needed: number, inst: FormInstance): void {
  if (doc.y + needed > PAGE.breakY) pageBreak(doc, inst);
}

function renderLine(doc: PDFKit.PDFDocument, l: FormLine, inst: FormInstance): void {
  const labelX = COL.labelX + (l.indent ?? 0) * 14;
  const labelW = COL.labelW - (l.indent ?? 0) * 14;
  const labelSize = l.emphasis ? 9.5 : 9;
  doc.font(l.emphasis ? "Helvetica-Bold" : "Helvetica").fontSize(labelSize);
  const labelH = doc.heightOfString(l.label, { width: labelW });
  const noteH = l.note
    ? doc.font("Helvetica-Oblique").fontSize(7.5).heightOfString(l.note, { width: labelW }) + 2
    : 0;
  const rowH = Math.max(labelH, 11) + noteH + 4;
  ensureRoom(doc, rowH, inst);
  const y = doc.y;

  if (l.emphasis) {
    doc
      .moveTo(COL.valueX, y - 1.5)
      .lineTo(COL.valueX + COL.valueW, y - 1.5)
      .lineWidth(0.5)
      .strokeColor("#888")
      .stroke();
  }
  if (l.line) {
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#666")
      .text(l.line, COL.lineX, y + 1, { width: COL.lineW, lineBreak: false });
  }
  doc
    .font(l.emphasis ? "Helvetica-Bold" : "Helvetica")
    .fontSize(labelSize)
    .fillColor(l.emphasis ? "#000" : "#333")
    .text(l.label, labelX, y, { width: labelW });
  doc
    .font("Helvetica-Bold")
    .fontSize(labelSize)
    .fillColor(l.emphasis ? "#000" : "#222")
    .text(fmtValue(l), COL.valueX, y, { width: COL.valueW, align: "right", lineBreak: false });
  if (l.note) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(7.5)
      .fillColor("#777")
      .text(l.note, labelX, y + labelH + 1, { width: labelW });
  }
  doc.y = y + rowH;
}

/** Render one form starting at the CURRENT page position (packet adds pages). */
export function renderFormInstance(
  doc: PDFKit.PDFDocument,
  inst: FormInstance,
  taxpayer: WorkpaperTaxpayer,
): void {
  // Header block
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor("#000")
    .text(inst.formNumber, PAGE.margin, doc.y, { continued: true })
    .font("Helvetica")
    .fontSize(11)
    .text(`   ${inst.title}`);
  if (inst.subtitle) {
    doc.font("Helvetica").fontSize(8.5).fillColor("#555").text(inst.subtitle, { width: PAGE.contentWidth });
  }
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#777")
    .text(
      `Tax year ${inst.taxYear}  ·  ${taxpayer.firstName} ${taxpayer.lastName}  ·  ${filingStatusLabel(
        taxpayer.filingStatus,
      )}  ·  ${taxpayer.state}`,
    );
  doc
    .moveTo(PAGE.margin, doc.y + 4)
    .lineTo(PAGE.margin + PAGE.contentWidth, doc.y + 4)
    .lineWidth(0.75)
    .strokeColor("#231F55")
    .stroke();
  doc.y += 12;

  for (const part of inst.parts) {
    if (part.title) {
      ensureRoom(doc, 30, inst);
      const y = doc.y;
      doc.rect(PAGE.margin, y, PAGE.contentWidth, 16).fillColor("#f2f4f8").fill();
      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor("#231F55")
        .text(part.title, PAGE.margin + 6, y + 4, { width: PAGE.contentWidth - 12, lineBreak: false });
      doc.y = y + 22;
    }
    for (const line of part.lines) renderLine(doc, line, inst);
    doc.y += 6;
  }

  if (inst.footnotes && inst.footnotes.length > 0) {
    ensureRoom(doc, 24, inst);
    doc
      .moveTo(PAGE.margin, doc.y)
      .lineTo(PAGE.margin + PAGE.contentWidth, doc.y)
      .lineWidth(0.25)
      .strokeColor("#bbb")
      .stroke();
    doc.y += 6;
    for (const note of inst.footnotes) {
      doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#777");
      ensureRoom(doc, doc.heightOfString(`• ${note}`, { width: PAGE.contentWidth }) + 3, inst);
      doc.text(`• ${note}`, PAGE.margin, doc.y, { width: PAGE.contentWidth });
      doc.y += 3;
    }
  }
}

export interface BuildWorkpaperPacketOptions {
  taxpayer: WorkpaperTaxpayer;
  instances: FormInstance[];
  taxYear: number;
  /** Injectable for deterministic tests; defaults to today. */
  generatedAt?: Date;
}

/**
 * Assemble the one-click workpaper packet: cover page (taxpayer + contents +
 * disclosures) followed by every form instance on its own page, DRAFT
 * watermark + numbered footer on every page.
 */
export function buildWorkpaperPacketPdf(
  options: BuildWorkpaperPacketOptions,
): Promise<Buffer> {
  const { taxpayer, instances, taxYear } = options;
  const generatedAt = options.generatedAt ?? new Date();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: PAGE.margin, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.on("pageAdded", () => drawWatermark(doc));

    // ── Cover page ──
    drawWatermark(doc);
    doc.y = 96;
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#231F55").text("Tax Return Workpaper Packet", PAGE.margin, doc.y);
    doc.font("Helvetica").fontSize(13).fillColor("#333").text(`Tax year ${taxYear}`);
    doc.moveDown(1.2);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text(`${taxpayer.firstName} ${taxpayer.lastName}`);
    doc.font("Helvetica").fontSize(9.5).fillColor("#444");
    if (taxpayer.email) doc.text(taxpayer.email);
    doc.text(`${filingStatusLabel(taxpayer.filingStatus)}  ·  ${taxpayer.state}`);
    doc
      .fontSize(8.5)
      .fillColor("#777")
      .text(
        `Generated ${generatedAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} by TaxFlow Assistant`,
      );
    doc.moveDown(1.2);

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text("Contents");
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(9).fillColor("#333");
    for (const inst of instances) {
      doc.text(`${inst.formNumber} — ${inst.title}`, { width: PAGE.contentWidth });
    }
    doc.moveDown(1.2);

    const noticeTop = doc.y;
    const noticeText =
      "DRAFT workpaper packet — NOT a filed tax return and not for filing. Substitute-form layouts " +
      "follow the official TY-2024 line numbering (Pub 1167 conventions) for CPA line-by-line " +
      "cross-checking against professional prep software. Amounts are engine-exact to the cent; " +
      "official forms round to whole dollars. AI-extracted source documents must be verified " +
      "against the originals. The reconciliation worksheet flags any internal tie-out variance.";
    doc.font("Helvetica").fontSize(8);
    const noticeH = doc.heightOfString(noticeText, { width: PAGE.contentWidth - 20 }) + 16;
    doc.rect(PAGE.margin, noticeTop, PAGE.contentWidth, noticeH).lineWidth(0.75).strokeColor("#aa6600").stroke();
    doc.fillColor("#444").text(noticeText, PAGE.margin + 10, noticeTop + 8, { width: PAGE.contentWidth - 20 });

    // ── Forms, one per page ──
    for (const inst of instances) {
      doc.addPage();
      doc.y = PAGE.margin;
      renderFormInstance(doc, inst, taxpayer);
    }

    // ── Footer pass (page numbers need the full count) ──
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc
        .font("Helvetica")
        .fontSize(7)
        .fillColor("#999")
        .text(
          `DRAFT workpaper — not for filing  ·  TaxFlow Assistant  ·  Page ${i + 1} of ${range.count}`,
          PAGE.margin,
          764,
          { width: PAGE.contentWidth, align: "center", lineBreak: false },
        );
    }

    doc.end();
  });
}
