/**
 * T2.2 D2 — Client organizer as a printable branded checklist PDF.
 *
 * One page-flowing checklist grouped by category with ☐/☑ boxes — the
 * artifact the firm actually mails/portals to the client at year start.
 * Deterministic rendering of `buildClientOrganizer` output.
 */
import PDFDocument from "pdfkit";
import type { OrganizerResult, OrganizerItem, OrganizerCategory } from "./clientOrganizer";
import { TRUSTED_BLUE, BRAND_BLUE, SUCCESS, INK, MUTED, applyBrandFooters, winAnsiSafePdf } from "./pdfBrand";

const PAGE_BOTTOM = 730;

const CATEGORY_LABELS: Record<OrganizerCategory, string> = {
  income: "Income documents",
  business_rental: "Business & rental",
  deductions_credits: "Deductions & credits",
  life_events: "A few questions about your year",
};
const CATEGORY_ORDER: OrganizerCategory[] = [
  "income", "business_rental", "deductions_credits", "life_events",
];

export interface BuildOrganizerPdfArgs {
  clientName: string;
  organizer: OrganizerResult;
  /** Caller-supplied (route passes today) so the lib stays deterministic. */
  preparedDate: string;
  firmName?: string;
}

export function buildOrganizerPdf(args: BuildOrganizerPdfArgs): Promise<Buffer> {
  const { clientName, organizer, preparedDate } = args;
  const firmName = args.firmName ?? "Your CPA team";

  return new Promise((resolve, reject) => {
    const doc = winAnsiSafePdf(new PDFDocument({ size: "letter", margin: 54, bufferPages: true })); // M5 WinAnsi glyph seam
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header band.
    doc.rect(0, 0, 612, 110).fill(TRUSTED_BLUE);
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#ffffff")
      .text(`${organizer.taxYear} Tax Organizer`, 54, 34);
    doc.fontSize(10.5).font("Helvetica").fillColor("#c7d6f0")
      .text(`${clientName} · prepared ${preparedDate} by ${firmName}`, 54, 64);
    doc.y = 130;
    doc.fontSize(9.5).font("Helvetica").fillColor(INK).text(
      `This checklist is personalized from your ${organizer.priorYear} return. Check items off as you gather them — ` +
      `checked items are already on file with us. ${organizer.counts.missing} item${organizer.counts.missing === 1 ? "" : "s"} outstanding.`,
      54, doc.y, { width: 504 },
    );

    // U+2713 is not WinAnsi-encodable in the standard-14 Helvetica fonts —
    // draw the check as two stroked vector segments instead of a glyph.
    const drawCheck = (x: number, y: number) => {
      doc.save();
      doc.moveTo(x + 2.2, y + 5.8).lineTo(x + 4.4, y + 8.2).lineTo(x + 8.8, y + 2.8)
        .lineWidth(1.6).strokeColor(SUCCESS).stroke();
      doc.restore();
    };

    const drawItem = (item: OrganizerItem) => {
      if (doc.y + 44 > PAGE_BOTTOM) doc.addPage();
      const y = doc.y + 6;
      // Checkbox: vector-check-filled when received, empty box otherwise.
      if (item.status === "received") {
        doc.rect(54, y, 11, 11).lineWidth(1).strokeColor(SUCCESS).stroke();
        drawCheck(54, y);
      } else if (item.status === "question") {
        doc.rect(54, y, 11, 11).lineWidth(1).strokeColor(BRAND_BLUE).stroke();
      } else {
        doc.rect(54, y, 11, 11).lineWidth(1).strokeColor(MUTED).stroke();
      }
      doc.fontSize(10.5).font("Helvetica-Bold")
        .fillColor(item.status === "received" ? MUTED : INK)
        .text(item.title, 74, y - 1, { width: 484 });
      doc.fontSize(8.5).font("Helvetica").fillColor(MUTED)
        .text(item.detail, 74, doc.y + 1, { width: 484 });
      doc.moveDown(0.45);
    };

    for (const cat of CATEGORY_ORDER) {
      const items = organizer.items.filter((i) => i.category === cat);
      if (items.length === 0) continue;
      if (doc.y + 70 > PAGE_BOTTOM) doc.addPage();
      doc.moveDown(0.9);
      doc.fontSize(13).font("Helvetica-Bold").fillColor(TRUSTED_BLUE).text(CATEGORY_LABELS[cat], 54, doc.y);
      doc.moveTo(54, doc.y + 2).lineTo(558, doc.y + 2).lineWidth(1.2).strokeColor(BRAND_BLUE).stroke();
      doc.moveDown(0.4);
      for (const item of items) drawItem(item);
    }

    doc.moveDown(1);
    if (doc.y + 50 > PAGE_BOTTOM) doc.addPage();
    doc.fontSize(8).font("Helvetica-Oblique").fillColor(MUTED).text(
      "Send documents through the secure portal or bring them to your appointment — please don't email images of " +
      "documents containing Social Security numbers. If something on this list no longer applies, just mark it N/A.",
      54, doc.y, { width: 504 },
    );

    applyBrandFooters(doc, (i, count) =>
      `${firmName} · ${organizer.taxYear} Tax Organizer · ${clientName} · page ${i + 1} of ${count}`,
    );
    doc.end();
  });
}
