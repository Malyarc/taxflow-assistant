/**
 * Shared Brookhaven brand constants + helpers for the client-facing
 * deliverable PDFs (planning report, organizer). One palette, one money
 * formatter, one SAFE footer pass — so a brand refresh or a footer fix lands
 * once. (Source: Brookhaven Brand Bible v1; tokens mirror tax-app/index.css.)
 */

export const TRUSTED_BLUE = "#231F55";
export const BRAND_BLUE = "#41B9EA";
export const GOLD = "#F0CA17";
export const SUCCESS = "#15803d";
export const INK = "#1f2430";
export const MUTED = "#6b7280";

/** Whole-dollar USD (client-deliverable convention). */
export function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * Write a centered footer line on every buffered page. Zeroes the bottom
 * margin per page first: pdfkit's line wrapper forks a NEW page for any text
 * written below maxY (even with lineBreak:false), which silently doubled
 * page counts until the 2026-06-10 /code-review caught it. Requires the doc
 * to be created with `bufferPages: true`.
 */
export function applyBrandFooters(
  doc: PDFKit.PDFDocument,
  line: (pageIndex: number, pageCount: number) => string,
): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.fontSize(7.5).fillColor(MUTED).text(line(i, range.count), 54, 752, {
      width: 504,
      align: "center",
      lineBreak: false,
    });
  }
}
