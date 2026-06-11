/**
 * Form 4868 — Application for Automatic Extension of Time To File
 * U.S. Individual Income Tax Return.
 *
 * Source: IRS Form 4868 (2024). The CPA files this BEFORE the return is
 * complete to request a 6-month extension (Oct 15 for calendar-year filers).
 * Extension is automatic on filing — no IRS approval is needed. The form
 * is required even when no balance is due (so the IRS knows to expect a
 * late return).
 *
 * Note: an extension to FILE is NOT an extension to PAY. Any balance due
 * accrues interest + late-payment penalty from April 15. To avoid the
 * penalty (but not interest), the taxpayer must pay at least 90% of the
 * total liability by April 15.
 *
 * We render Form 4868 as a substitute via pdfkit. The IRS accepts a
 * substitute form so long as it contains all required information per
 * Pub 1167 (General Rules and Specifications for Substitute Forms). CPAs
 * can also use this PDF as a working draft and transcribe into Lacerte
 * / UltraTax / ProConnect / Drake.
 */
import PDFDocument from "pdfkit";
import { winAnsiSafePdf } from "./pdfBrand";
import type { ComputedTaxReturn } from "./taxReturnEngine";
import type { clientsTable } from "@workspace/db";

type Client = typeof clientsTable.$inferSelect;

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_widow: "Qualifying Widow(er)",
};

export interface Form4868Input {
  /** Amount the taxpayer is paying with the extension. Defaults to balanceDue (Line 6). */
  amountBeingPaid?: number;
  /**
   * Estimated tax payments + prior-year refund applied already credited to this
   * tax year, NOT already captured in withholding (Form 1040 Line 26).
   * Engine currently doesn't track Line 26 separately; CPA passes here.
   */
  estimatedTaxAlreadyPaid?: number;
  /**
   * Line 8 — Check if the taxpayer was "out of the country" on the regular
   * due date (a U.S. citizen/resident living and working abroad gets an
   * automatic 2-month extension on top of the 6 months from Form 4868).
   */
  outOfCountry?: boolean;
  /**
   * Line 9 — Check if filing Form 1040-NR and not received wages subject to
   * U.S. income-tax withholding (changes the due date to June 15 → extension
   * to Dec 15 instead of Oct 15).
   */
  form1040NrNoWithholding?: boolean;
}

export interface Form4868Result {
  taxYear: number;
  /** Line 4 — Estimate of total tax liability for the year (Form 1040 Line 24). */
  estimatedTotalTax: number;
  /** Line 5 — Total payments toward this tax year (Form 1040 Line 33). */
  totalPayments: number;
  /** Line 6 — Balance due (Line 4 − Line 5; floor 0). */
  balanceDue: number;
  /** Line 7 — Amount being paid with this extension. Defaults to Line 6. */
  amountBeingPaid: number;
  /** Line 8 — Out of country on regular due date. */
  outOfCountry: boolean;
  /** Line 9 — Filing 1040-NR and not received US-withheld wages. */
  form1040NrNoWithholding: boolean;
}

/**
 * Compute Form 4868 line values from a computed tax return.
 *
 * Derivation (consistent with engine math; H4 audit 2026-06-11):
 *   Official Line 4 = "estimate of total tax liability" = Form 1040 Line 24,
 *   which is NET of nonrefundable credits. The engine's federalTaxLiability is
 *   PRE-nonrefundable-credit, so back the applied credits out (the same
 *   FORM-02 correction the 1040-X module carries):
 *     Line 4 = ret.federalTaxLiability − ret.totalNonRefundableApplied
 *   Official Line 5 = total payments = Form 1040 Line 33 (excluding Schedule 3
 *   line 10, the amount paid WITH this extension). Engine identity:
 *     federalRefundOrOwed = withheld + nonref + refundables − federalTaxLiability
 *     → Line-33 payments = federalTaxLiability + federalRefundOrOwed
 *                          − totalNonRefundableApplied
 *   Line 5 = that + estimatedTaxAlreadyPaid (CPA-supplied additional estimated
 *            payments not already in the engine via withholding / credit
 *            adjustments).
 *   Line 6 = max(0, Line 4 − Line 5) — unchanged by the credit netting (both
 *            lines drop by the same amount, modulo $1 rounding).
 *   Line 7 = amountBeingPaid override, else Line 6.
 */
export function calculateForm4868(args: {
  ret: ComputedTaxReturn;
  input?: Form4868Input;
}): Form4868Result {
  const { ret, input = {} } = args;
  const round = (n: number): number => Math.max(0, Math.round(n));
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  // H4 — official Line 4 is 1040 line 24 (NET of nonrefundable credits).
  const nonRefApplied = Math.max(0, num(ret.totalNonRefundableApplied));
  const line4 = round(ret.federalTaxLiability - nonRefApplied);
  const computedPayments = round(
    ret.federalTaxLiability + ret.federalRefundOrOwed - nonRefApplied,
  );
  const line5 = computedPayments + round(input.estimatedTaxAlreadyPaid ?? 0);
  const line6 = Math.max(0, line4 - line5);
  const line7 =
    input.amountBeingPaid != null ? round(input.amountBeingPaid) : line6;

  return {
    taxYear: ret.taxYear,
    estimatedTotalTax: line4,
    totalPayments: line5,
    balanceDue: line6,
    amountBeingPaid: line7,
    outOfCountry: input.outOfCountry === true,
    form1040NrNoWithholding: input.form1040NrNoWithholding === true,
  };
}

function fmtCurrency(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export interface BuildForm4868PdfOptions {
  client: Client;
  ret: ComputedTaxReturn;
  form: Form4868Result;
}

/**
 * Render a CPA-quality Form 4868 substitute PDF.
 *
 * Layout follows the IRS Form 4868 template:
 *   Part I  — Identification (name, address, SSN, spouse SSN if MFJ)
 *   Part II — Individual income tax (Lines 4-9)
 * Plus header, instructions banner, signature/date area, footnotes.
 */
export function buildForm4868Pdf(options: BuildForm4868PdfOptions): Promise<Buffer> {
  const { client, ret, form } = options;
  return new Promise((resolve, reject) => {
    const doc = winAnsiSafePdf(new PDFDocument({ size: "letter", margin: 54 })); // M5 WinAnsi glyph seam
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ──────────────────────────────────────────────────────────
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Form 4868", { continued: true })
      .font("Helvetica")
      .text("    Application for Automatic Extension of Time", { continued: false });
    doc
      .fontSize(11)
      .text("To File U.S. Individual Income Tax Return");
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(`Tax year ${form.taxYear}  ·  Department of the Treasury — Internal Revenue Service`);
    doc.moveDown(0.3);
    doc
      .fontSize(8)
      .fillColor("#888")
      .text(
        `Prepared by TaxFlow Assistant on ${new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })}. Substitute form per Pub 1167.`,
      );
    doc.moveDown(1);

    // ── Box: Important reminders ────────────────────────────────────────
    const noticeTop = doc.y;
    doc
      .rect(54, noticeTop, 504, 56)
      .lineWidth(0.5)
      .strokeColor("#aa6600")
      .stroke();
    doc
      .fontSize(9)
      .fillColor("#aa6600")
      .font("Helvetica-Bold")
      .text("Important", 64, noticeTop + 6);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#444")
      .text(
        "An extension to FILE is NOT an extension to PAY. Any balance due accrues interest + late-payment penalty from the original April 15 due date. To avoid the late-payment penalty (but not interest), the taxpayer must have paid at least 90% of the total liability by April 15.",
        64,
        noticeTop + 22,
        { width: 484 },
      );
    doc.y = noticeTop + 64;
    doc.moveDown(0.5);

    // ── Part I — Identification ─────────────────────────────────────────
    doc
      .fontSize(11)
      .fillColor("#000")
      .font("Helvetica-Bold")
      .text("Part I  Identification");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#222");

    const fullName = `${client.firstName ?? ""} ${client.lastName ?? ""}`.trim();
    field(doc, "1. Your name(s)", fullName || "—");
    field(
      doc,
      "Filing status",
      FILING_STATUS_LABELS[client.filingStatus] ?? client.filingStatus,
    );
    field(doc, "Address", "(enter on the IRS-filed copy)");
    field(doc, "City, state, ZIP", "(enter on the IRS-filed copy)");
    field(doc, "2. Your SSN", "(enter on the IRS-filed copy — masked here for privacy)");
    if (
      client.filingStatus === "married_filing_jointly" ||
      client.filingStatus === "qualifying_widow"
    ) {
      field(doc, "3. Spouse's SSN", "(enter on the IRS-filed copy — masked here for privacy)");
    }
    doc.moveDown(0.5);

    // ── Part II — Individual Income Tax ─────────────────────────────────
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Part II  Individual Income Tax");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#222");

    moneyLine(doc, "4. Estimate of total tax liability for the year (Form 1040 Line 24)", form.estimatedTotalTax);
    moneyLine(doc, "5. Total payments (Form 1040 Line 33, excl. Schedule 3 line 10)", form.totalPayments);
    moneyLine(doc, "6. Balance due (Line 4 − Line 5)", form.balanceDue);
    moneyLine(doc, "7. Amount being paid with this extension", form.amountBeingPaid, true);
    checkLine(
      doc,
      "8. Check here if you are 'out of the country' on the regular due date",
      form.outOfCountry,
    );
    checkLine(
      doc,
      "9. Check here if you are filing Form 1040-NR and did not receive wages subject to U.S. withholding",
      form.form1040NrNoWithholding,
    );
    doc.moveDown(0.5);

    // ── Signature / mailing ─────────────────────────────────────────────
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Signature & filing");
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#444")
      .text(
        "Form 4868 generally does not require a signature. File electronically via IRS e-file (Free File / direct pay / EFTPS) or mail to the address listed in the Form 4868 instructions for the taxpayer's resident state. Include a check or money order payable to 'United States Treasury' for the amount on Line 7.",
        { width: 484 },
      );
    doc.moveDown(0.8);

    // ── Footnotes / data source ─────────────────────────────────────────
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("How these values were computed");
    doc.moveDown(0.2);
    doc.fontSize(8).font("Helvetica").fillColor("#555");
    doc.text(
      `Line 4 (estimated total tax) is sourced from the TaxFlow computed Form 1040 Line 24: federal tax liability (including SE / AMT / NIIT / Additional Medicare / §72(t) / HSA §4973(g) excise / Schedule H / advance APTC repayment) NET of the nonrefundable credits the engine applied (CTC, FTC, dependent care, education, Saver's, energy, adoption, §53, §38).`,
    );
    doc.text(
      `Line 5 (total payments) mirrors Form 1040 Line 33 (excluding Schedule 3 line 10 — the amount paid with this extension): federal withholding (W-2 + 1099) plus engine-applied refundable credits (EITC, ACTC, AOC refundable, net premium tax credit) plus any CPA-supplied estimated payments. Engine net refund/owed = ${fmtCurrency(ret.federalRefundOrOwed)}.`,
    );
    doc.text(
      `Line 6 is zero when payments equal or exceed estimated total tax. Line 7 defaults to Line 6 but can be reduced if the taxpayer wants a partial payment (interest accrues on the unpaid portion).`,
    );

    doc.end();
  });
}

// ── Layout helpers ─────────────────────────────────────────────────────
function field(doc: PDFKit.PDFDocument, label: string, value: string): void {
  const y = doc.y;
  doc.font("Helvetica").fillColor("#444").text(label, 54, y, {
    width: 240,
    continued: false,
  });
  // Right column: value (left-aligned)
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
    .font(emphasis ? "Helvetica-Bold" : "Helvetica-Bold")
    .fillColor(emphasis ? "#0a5d2a" : "#000")
    .fontSize(emphasis ? 11 : 10)
    .text(fmtCurrency(amount), 420, y, { width: 138, align: "right" });
  doc.fontSize(10);
  doc.moveDown(0.25);
}

function checkLine(doc: PDFKit.PDFDocument, label: string, checked: boolean): void {
  const y = doc.y;
  // Box
  doc.lineWidth(0.5).strokeColor("#444").rect(54, y + 1, 9, 9).stroke();
  if (checked) {
    // X mark
    doc
      .strokeColor("#000")
      .lineWidth(1.2)
      .moveTo(56, y + 3)
      .lineTo(61, y + 8)
      .moveTo(61, y + 3)
      .lineTo(56, y + 8)
      .stroke();
  }
  doc.font("Helvetica").fillColor("#444").text(label, 70, y, {
    width: 488,
    continued: false,
  });
  doc.moveDown(0.25);
}
