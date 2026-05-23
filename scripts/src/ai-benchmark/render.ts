/**
 * pdfkit renderers for synthetic W-2 and 1099 forms.
 *
 * Layout aims to mimic real IRS box-grid conventions closely enough that a
 * vision model treats them as the equivalent real form: thick border, box
 * grid, labelled fields, monospace numeric values. Not pixel-perfect to the
 * IRS template (we don't ship that asset for these forms), but visually
 * indistinguishable to the kinds of OCR that drive AI extraction.
 *
 * Each render function returns the rendered PDF as a Buffer (single page,
 * letter size, 8.5"x11" / 612pt x 792pt).
 */

import PDFDocument from "pdfkit";
import type {
  W2Fields,
  F1099Fields, F1099NEC, F1099MISC, F1099INT, F1099DIV,
  F1099B, F1099R, F1099G, F1099K,
} from "./types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtMoney(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bufferize(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function drawBox(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  label: string, value: string,
  opts: { labelSize?: number; valueSize?: number; valueRight?: boolean } = {},
): void {
  const labelSize = opts.labelSize ?? 7;
  const valueSize = opts.valueSize ?? 11;
  doc.lineWidth(0.6).rect(x, y, w, h).stroke();
  doc.fontSize(labelSize).font("Helvetica");
  doc.text(label, x + 3, y + 2, { width: w - 6, height: 14 });
  doc.fontSize(valueSize).font("Helvetica-Bold");
  const valueY = y + h - valueSize - 4;
  if (opts.valueRight) {
    doc.text(value, x + 3, valueY, { width: w - 6, align: "right" });
  } else {
    doc.text(value, x + 6, valueY, { width: w - 12 });
  }
}

// ── W-2 ─────────────────────────────────────────────────────────────────────
// Simplified layout of the 2024 IRS Form W-2 left panel. Box numbers placed
// where a CPA expects them.

export async function renderW2(t: W2Fields): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", margin: 36 });

  // Title
  doc.fontSize(13).font("Helvetica-Bold").text("Form W-2 — Wage and Tax Statement", 36, 36);
  doc.fontSize(9).font("Helvetica").text("Tax Year 2024  •  OMB No. 1545-0008", 36, 52);

  // Employer panel (top-left)
  const eX = 36, eY = 80, eW = 320;
  drawBox(doc, eX, eY, eW, 24, "b  Employer identification number (EIN)", t.employerEin, { valueSize: 12 });
  drawBox(doc, eX, eY + 24, eW, 68, "c  Employer's name, address, and ZIP code",
    `${t.employerName}\n800 Industry Blvd\nMetropolis, ${t.stateCode || "TX"} 78701`,
    { valueSize: 11 });

  // SSN panel (top-right)
  const sX = 360, sY = 80, sW = 220;
  drawBox(doc, sX, sY, sW, 24, "a  Employee's social security number", t.employeeSSN, { valueSize: 13 });
  drawBox(doc, sX, sY + 24, sW, 68, "d  Employee's name (first, middle, last)\ne  Employee's address and ZIP code",
    "Sample Employee\n123 Worker Way\nMetropolis, TX 78702");

  // Box 1-10 grid
  const gx = 36, gy = 170, cW = 130, rH = 36;
  drawBox(doc, gx, gy, cW, rH, "1  Wages, tips, other compensation", fmtMoney(t.wagesBox1), { valueRight: true });
  drawBox(doc, gx + cW, gy, cW, rH, "2  Federal income tax withheld", fmtMoney(t.federalTaxWithheldBox2), { valueRight: true });
  drawBox(doc, gx + 2*cW, gy, cW, rH, "3  Social security wages", fmtMoney(t.socialSecurityWagesBox3), { valueRight: true });
  drawBox(doc, gx + 3*cW, gy, cW, rH, "4  Social security tax withheld", fmtMoney(t.socialSecurityTaxBox4), { valueRight: true });
  drawBox(doc, gx, gy + rH, cW, rH, "5  Medicare wages and tips", fmtMoney(t.medicareWagesBox5), { valueRight: true });
  drawBox(doc, gx + cW, gy + rH, cW, rH, "6  Medicare tax withheld", fmtMoney(t.medicareTaxBox6), { valueRight: true });
  drawBox(doc, gx + 2*cW, gy + rH, cW, rH, "7  Social security tips", "", { valueRight: true });
  drawBox(doc, gx + 3*cW, gy + rH, cW, rH, "8  Allocated tips", "", { valueRight: true });
  drawBox(doc, gx, gy + 2*rH, cW, rH, "9", "", { valueRight: true });
  drawBox(doc, gx + cW, gy + 2*rH, cW, rH, "10  Dependent care benefits", "", { valueRight: true });
  drawBox(doc, gx + 2*cW, gy + 2*rH, cW, rH, "11  Nonqualified plans", "", { valueRight: true });
  drawBox(doc, gx + 3*cW, gy + 2*rH, cW, rH, "12a", "", { valueRight: true });

  // Box 15-17 (state)
  const stY = 310;
  drawBox(doc, gx, stY, 60, 32, "15  State", t.stateCode, { valueSize: 12 });
  drawBox(doc, gx + 60, stY, 100, 32, "Employer's state ID number", "12-3456789");
  drawBox(doc, gx + 160, stY, 130, 32, "16  State wages, tips, etc.", fmtMoney(t.stateWagesBox16), { valueRight: true });
  drawBox(doc, gx + 290, stY, 130, 32, "17  State income tax", fmtMoney(t.stateTaxWithheldBox17), { valueRight: true });

  return bufferize(doc);
}

// ── 1099 renderers ──────────────────────────────────────────────────────────
// Each shares a common top panel (payer / recipient TIN / fed+state w/h)
// and then a form-specific body.

function drawCommonHeader(
  doc: PDFKit.PDFDocument,
  title: string,
  formCode: string,
  t: Pick<F1099Fields, "payerName" | "payerTin" | "recipientTin" | "stateCode">,
): void {
  // Title
  doc.fontSize(13).font("Helvetica-Bold").text(`Form ${title}`, 36, 36);
  doc.fontSize(9).font("Helvetica").text(`Tax Year 2024  •  ${formCode}  •  OMB No. 1545-0115`, 36, 52);

  // Payer panel (top-left)
  drawBox(doc, 36, 80, 340, 70,
    "PAYER'S name, street address, city or town, state or province, country, ZIP",
    `${t.payerName}\nP.O. Box 4250\nFinancial District, ${t.stateCode || "NY"} 10004`);

  // TIN panel (top-right)
  drawBox(doc, 380, 80, 200, 32, "PAYER'S TIN", t.payerTin, { valueSize: 12 });
  drawBox(doc, 380, 112, 200, 38, "RECIPIENT'S TIN", t.recipientTin, { valueSize: 12 });

  // Recipient name panel
  drawBox(doc, 36, 156, 340, 60,
    "RECIPIENT'S name, street address, city or town, state or province, country, ZIP",
    "Sample Recipient\n456 Park Ave Apt 7\nFinancial District, NY 10004");
}

function drawStateBox(
  doc: PDFKit.PDFDocument,
  y: number,
  t: Pick<F1099Fields, "stateCode" | "stateTaxWithheld">,
  stateBoxLabel: string,
): void {
  drawBox(doc, 36, y, 100, 28, "State", t.stateCode ?? "", { valueSize: 12 });
  drawBox(doc, 136, y, 240, 28, "Payer's state no.", "98-7654321", { valueSize: 11 });
  drawBox(doc, 376, y, 204, 28, stateBoxLabel, fmtMoney(t.stateTaxWithheld), { valueRight: true });
}

export async function render1099NEC(t: F1099NEC): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", margin: 36 });
  drawCommonHeader(doc, "1099-NEC", "Nonemployee Compensation", t);

  drawBox(doc, 380, 156, 200, 60, "1  Nonemployee compensation", `$${fmtMoney(t.nonemployeeCompensation)}`, { valueSize: 12, valueRight: true });
  drawBox(doc, 36, 222, 540, 30, "2  Payer made direct sales totaling $5,000 or more...", "", { valueSize: 9 });
  drawBox(doc, 36, 256, 270, 30, "4  Federal income tax withheld", fmtMoney(t.federalTaxWithheld), { valueRight: true });
  drawBox(doc, 310, 256, 270, 30, "5  State tax (informational)", "", { valueSize: 9 });
  drawStateBox(doc, 292, t, "7  State income tax");

  return bufferize(doc);
}

export async function render1099MISC(t: F1099MISC): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", margin: 36 });
  drawCommonHeader(doc, "1099-MISC", "Miscellaneous Information", t);

  let y = 222;
  const row = 28;
  drawBox(doc, 36, y, 270, row, "1  Rents", fmtMoney(t.rents), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "2  Royalties", fmtMoney(t.royalties), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 270, row, "3  Other income", fmtMoney(t.otherIncome), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "4  Federal income tax withheld", fmtMoney(t.federalTaxWithheld), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 270, row, "5  Fishing boat proceeds", fmtMoney(t.fishingBoatProceeds), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "6  Medical and health care payments", fmtMoney(t.medicalAndHealthcare), { valueRight: true });
  y += row + 8;
  drawStateBox(doc, y, t, "16  State tax withheld");

  return bufferize(doc);
}

export async function render1099INT(t: F1099INT): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", margin: 36 });
  drawCommonHeader(doc, "1099-INT", "Interest Income", t);

  let y = 222;
  const row = 28;
  drawBox(doc, 36, y, 270, row, "1  Interest income", fmtMoney(t.interestIncome), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "2  Early withdrawal penalty", fmtMoney(t.earlyWithdrawalPenalty), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 270, row, "3  Interest on U.S. Savings Bonds and Treasury obligations", fmtMoney(t.usTreasuryInterest), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "4  Federal income tax withheld", fmtMoney(t.federalTaxWithheld), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 270, row, "8  Tax-exempt interest", fmtMoney(t.taxExemptInterest), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "9  Specified private activity bond interest", "", { valueRight: true });
  y += row + 8;
  drawStateBox(doc, y, t, "17  State tax withheld");

  return bufferize(doc);
}

export async function render1099DIV(t: F1099DIV): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", margin: 36 });
  drawCommonHeader(doc, "1099-DIV", "Dividends and Distributions", t);

  let y = 222;
  const row = 28;
  drawBox(doc, 36, y, 270, row, "1a  Total ordinary dividends", fmtMoney(t.ordinaryDividends), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "1b  Qualified dividends", fmtMoney(t.qualifiedDividends), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 270, row, "2a  Total capital gain distribution", fmtMoney(t.totalCapitalGainDistribution), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "3  Nondividend distributions", fmtMoney(t.nondividendDistributions), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 270, row, "4  Federal income tax withheld", fmtMoney(t.federalTaxWithheld), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "5  Section 199A dividends", "", { valueRight: true });
  y += row + 8;
  drawStateBox(doc, y, t, "16  State tax withheld");

  return bufferize(doc);
}

export async function render1099B(t: F1099B): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", margin: 36 });
  drawCommonHeader(doc, "1099-B", "Proceeds From Broker and Barter Exchange", t);

  let y = 222;
  const row = 28;
  drawBox(doc, 36, y, 270, row, "1d  Proceeds (gross)", fmtMoney(t.proceeds), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "1e  Cost or other basis", fmtMoney(t.costBasis), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 270, row, "Short-term gain/loss summary", fmtMoney(t.shortTermGainLoss), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "Long-term gain/loss summary", fmtMoney(t.longTermGainLoss), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 270, row, "4  Federal income tax withheld", fmtMoney(t.federalTaxWithheld), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "12  Wash sale loss disallowed", "", { valueRight: true });
  y += row + 8;
  drawStateBox(doc, y, t, "16  State tax withheld");

  return bufferize(doc);
}

export async function render1099R(t: F1099R): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", margin: 36 });
  drawCommonHeader(doc, "1099-R", "Distributions From Pensions, Annuities, Retirement", t);

  let y = 222;
  const row = 28;
  drawBox(doc, 36, y, 270, row, "1  Gross distribution", fmtMoney(t.grossDistribution), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "2a  Taxable amount", fmtMoney(t.taxableAmount), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 130, row, "7  Distribution code", t.distributionCode ?? "", { valueSize: 12 });
  drawBox(doc, 166, y, 140, row, "IRA/SEP/SIMPLE", t.iraSepSimple ?? "", { valueSize: 11 });
  drawBox(doc, 310, y, 270, row, "4  Federal income tax withheld", fmtMoney(t.federalTaxWithheld), { valueRight: true });
  y += row + 8;
  drawStateBox(doc, y, t, "14  State tax withheld");

  return bufferize(doc);
}

export async function render1099G(t: F1099G): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", margin: 36 });
  drawCommonHeader(doc, "1099-G", "Certain Government Payments", t);

  let y = 222;
  const row = 28;
  drawBox(doc, 36, y, 270, row, "1  Unemployment compensation", fmtMoney(t.unemploymentCompensation), { valueRight: true });
  drawBox(doc, 310, y, 270, row, "2  State or local income tax refund", fmtMoney(t.stateLocalRefund), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 540, row, "4  Federal income tax withheld", fmtMoney(t.federalTaxWithheld), { valueRight: true });
  y += row + 8;
  drawStateBox(doc, y, t, "11  State income tax withheld");

  return bufferize(doc);
}

export async function render1099K(t: F1099K): Promise<Buffer> {
  const doc = new PDFDocument({ size: "letter", margin: 36 });
  drawCommonHeader(doc, "1099-K", "Payment Card and Third Party Network Transactions", t);

  let y = 222;
  const row = 28;
  drawBox(doc, 36, y, 540, row, "1a  Gross amount of payment card/third party network transactions", fmtMoney(t.grossPaymentAmount), { valueRight: true });
  y += row;
  drawBox(doc, 36, y, 540, row, "4  Federal income tax withheld", fmtMoney(t.federalTaxWithheld), { valueRight: true });
  y += row + 8;
  drawStateBox(doc, y, t, "8  State tax withheld");

  return bufferize(doc);
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export async function renderForm(
  kind: "w2" | "1099-nec" | "1099-misc" | "1099-int" | "1099-div" | "1099-b" | "1099-r" | "1099-g" | "1099-k",
  truth: W2Fields | F1099Fields,
): Promise<Buffer> {
  switch (kind) {
    case "w2":       return renderW2(truth as W2Fields);
    case "1099-nec": return render1099NEC(truth as F1099NEC);
    case "1099-misc":return render1099MISC(truth as F1099MISC);
    case "1099-int": return render1099INT(truth as F1099INT);
    case "1099-div": return render1099DIV(truth as F1099DIV);
    case "1099-b":   return render1099B(truth as F1099B);
    case "1099-r":   return render1099R(truth as F1099R);
    case "1099-g":   return render1099G(truth as F1099G);
    case "1099-k":   return render1099K(truth as F1099K);
  }
}
