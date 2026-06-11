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

// ── WinAnsi glyph safety (T1.0 M5) ─────────────────────────────────────────
//
// pdfkit's standard-14 fonts (Helvetica family) encode text as WinAnsi
// (cp1252). A character OUTSIDE that codepage is emitted as garbage byte
// pairs: U+2713 ✓ became `'` + an invisible control, U+26A0 ⚠ became `& `,
// and — worst — U+2212 − (the minus sign) became `"` + invisible, so
// "−$50,000.00" rendered as `"$50,000.00` and a NEGATIVE could be read as
// positive. Sanitize every string at the pdfkit text seam.

/** Semantic ASCII replacements for the glyphs our artifacts actually use. */
const WINANSI_REPLACEMENTS: Array<[RegExp, string]> = [
  [/✓|✔/g, "OK"], // ✓ ✔ check
  [/✗|✘|✕|✖/g, "X"], // ✗ ✘ ✕ ✖
  [/⚠(️)?/g, "!"], // ⚠ warning
  [/−/g, "-"], // − minus sign → ASCII hyphen (sign must survive)
  [/→/g, "->"], // →
  [/←/g, "<-"], // ←
  [/↔/g, "<->"], // ↔
  [/≤/g, "<="], // ≤
  [/≥/g, ">="], // ≥
  [/≠/g, "!="], // ≠
  [/≈/g, "~"], // ≈
  [/└─*/g, "-"], // └─ tree branch
  [/─/g, "-"], // ─ box-drawing dash
  [/☐/g, "[ ]"], // ☐
  [/☑|☒/g, "[x]"], // ☑ ☒
  [/Δ/g, "delta "], // Δ (Greek capital delta is not WinAnsi)
  [/⅓/g, "1/3"],
  [/⅔/g, "2/3"],
  [/↑/g, "^"], // ↑
  [/↓/g, "v"], // ↓
];

/** The non-Latin-1 codepoints WinAnsi (cp1252) CAN encode (0x80–0x9F slots). */
const WINANSI_EXTRA = new Set<number>([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/**
 * Make a string safe for pdfkit's WinAnsi standard fonts: map the known
 * semantic glyphs to ASCII equivalents, then replace any REMAINING
 * non-encodable character with "?" (visible, honest — never a silent
 * garbage-byte pair). Idempotent on already-safe strings.
 */
export function winAnsiSafe(s: string): string {
  let out = s;
  for (const [re, rep] of WINANSI_REPLACEMENTS) out = out.replace(re, rep);
  let needsScan = false;
  for (let i = 0; i < out.length; i++) {
    const c = out.codePointAt(i)!;
    if (c > 0xff && !WINANSI_EXTRA.has(c)) {
      needsScan = true;
      break;
    }
    if (c > 0xffff) i++;
  }
  if (!needsScan) return out;
  let r = "";
  for (const ch of out) {
    const c = ch.codePointAt(0)!;
    r += c <= 0xff || WINANSI_EXTRA.has(c) ? ch : "?";
  }
  return r;
}

/**
 * Patch a pdfkit document so EVERY `text()` call (and the width/height
 * measurements, so wrapping stays consistent with what is drawn) passes its
 * string through {@link winAnsiSafe}. One call per PDF artifact at document
 * construction — the centralized M5 fix for all current and future strings.
 */
export function winAnsiSafePdf<T extends PDFKit.PDFDocument>(doc: T): T {
  const d = doc as unknown as {
    text: (...args: unknown[]) => unknown;
    widthOfString: (...args: unknown[]) => number;
    heightOfString: (...args: unknown[]) => number;
  };
  const origText = d.text.bind(doc);
  d.text = (...args: unknown[]) => {
    if (typeof args[0] === "string") args[0] = winAnsiSafe(args[0]);
    return origText(...args);
  };
  const origWidth = d.widthOfString.bind(doc);
  d.widthOfString = (...args: unknown[]) => {
    if (typeof args[0] === "string") args[0] = winAnsiSafe(args[0]);
    return origWidth(...args);
  };
  const origHeight = d.heightOfString.bind(doc);
  d.heightOfString = (...args: unknown[]) => {
    if (typeof args[0] === "string") args[0] = winAnsiSafe(args[0]);
    return origHeight(...args);
  };
  return doc;
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
