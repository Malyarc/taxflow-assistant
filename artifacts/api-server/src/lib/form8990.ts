/**
 * Form 8990 — Limitation on Business Interest Expense Under Section 163(j).
 *
 * Substitute Form 8990 PDF rendered via pdfkit (per Pub 1167).
 *
 * C3 follow-up (2026-05-27 PM): closes the C-batch v1 sub-gap "Form 8990
 * PDF for §163(j) NOT yet rendered". Engine already computes:
 *   - section163jBusinessInterestExpense (gross)
 *   - section163jAllowedDeduction
 *   - section163jDisallowedCarryforward
 *
 * Engine refinement (also shipped 2026-05-27 PM): ATI proxy now subtracts
 * std/itemized deduction to better approximate §163(j)(8) "taxable income
 * before §163(j)/NOL/QBI".
 *
 * Layout follows official Form 8990:
 *   Section I    — Computation of Allowable Business Interest Expense (Lines 1-30)
 *   Section II   — Partnership Pass-Through Items (Lines 31-37; not modeled at the individual level)
 *   Section III  — S-Corporation Pass-Through Items (Lines 38-42; not modeled)
 *   Section IV   — Disallowed Business Interest Expense Carryforward (Lines 43-46)
 *   Schedule A   — Summary of Partner's Section 163(j) Excess Items (not modeled)
 *   Schedule B   — Summary of Carryforwards (Lines 50-51 — what we render)
 */

import PDFDocument from "pdfkit";

export interface Form8990Data {
  /** Tax year. */
  taxYear: number;
  /** Filer's name. */
  taxpayerName: string;
  /** Filing status. */
  filingStatus: string;
  /** Line 1 — Current-year business interest expense (gross). */
  currentYearBusinessInterestExpense: number;
  /** Line 2 — Disallowed business interest carryforward from prior year. */
  carryforwardFromPrior: number;
  /** Line 3 = Line 1 + Line 2 — Total subject-to-cap business interest. */
  totalSubjectToCap: number;
  /** Line 4 — Floor plan financing interest expense (uncapped allowance). */
  floorPlanFinancingInterest: number;
  /** Line 22 — Business interest income (subtracted from cap-subject; uncapped). */
  businessInterestIncome: number;
  /** Line 25 — Adjusted Taxable Income (ATI) per §163(j)(8). */
  ati: number;
  /** Line 26 — 30% × ATI = cap on subject-to-cap business interest. */
  thirtyPercentAti: number;
  /** Line 30 — Allowable business interest expense (current-year deduction). */
  allowedDeduction: number;
  /** Line 31 (Section IV) — Disallowed business interest carryforward to next year. */
  disallowedCarryforward: number;
  /** §163(j)(3) small-business exemption (3-yr avg gross receipts ≤ §448(c) threshold). */
  smallBusinessExempt?: boolean;
  /** §448(c) 3-prior-year average gross receipts the CPA supplied (0 = not provided). */
  grossReceipts?: number;
  /** §448(c) gross-receipts threshold for the tax year. */
  grossReceiptsThreshold?: number;
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

export interface BuildForm8990PdfOptions {
  data: Form8990Data;
}

/**
 * Render a CPA-fileable substitute Form 8990 PDF.
 *
 * IMPORTANT: Form 8990 is technically required to be filed even when
 * §163(j) doesn't bind (i.e., when allowed = gross + carryforward). The
 * official IRS guidance is that small business taxpayers (gross receipts
 * < $30M for 2024, indexed) are EXEMPT from filing under §163(j)(3) —
 * but they may still want to file Form 8990 for tracking carryforward.
 * The engine does NOT model the small-business exemption automatically;
 * CPA must determine whether the form is required.
 */
export function buildForm8990Pdf(
  options: BuildForm8990PdfOptions,
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
      .text("Form 8990", { continued: true })
      .font("Helvetica")
      .text("    Limitation on Business Interest Expense");
    doc
      .fontSize(11)
      .text("Under Section 163(j)");
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

    // ── Important notice (engine's §163(j)(3) exemption determination) ──
    const noticeTop = doc.y;
    const exempt = data.smallBusinessExempt === true;
    const grossReceipts = data.grossReceipts ?? 0;
    const threshold = data.grossReceiptsThreshold ?? 30_000_000;
    const noticeColor = exempt ? "#0a5d2a" : "#aa6600";
    doc
      .rect(54, noticeTop, 504, 82)
      .lineWidth(0.5)
      .strokeColor(noticeColor)
      .stroke();
    doc
      .fontSize(9)
      .fillColor(noticeColor)
      .font("Helvetica-Bold")
      .text(
        exempt
          ? "EXEMPT — Small Business Taxpayer (§163(j)(3))"
          : grossReceipts > 0
            ? "NOT EXEMPT — §163(j) limitation applies"
            : "Small Business Taxpayer Exemption (§163(j)(3))",
        64,
        noticeTop + 6,
      );
    const noticeBody = exempt
      ? `The engine determined this filer is EXEMPT: 3-year average gross receipts ${fmtCurrency(grossReceipts)} ` +
        `≤ the §448(c) threshold ${fmtCurrency(threshold)} for TY${data.taxYear}. The §163(j) limitation does NOT ` +
        `apply — all business interest is fully deductible and nothing carries forward. Filing Form 8990 is OPTIONAL ` +
        `(it may still be useful as an audit trail).`
      : grossReceipts > 0
        ? `The engine determined this filer is NOT exempt: 3-year average gross receipts ${fmtCurrency(grossReceipts)} ` +
          `exceeds the §448(c) threshold ${fmtCurrency(threshold)} for TY${data.taxYear}. The §163(j) 30%-of-ATI ` +
          `limitation applies (Section I below) and Form 8990 is REQUIRED.`
        : `Per §163(j)(3), the limitation does NOT apply to a taxpayer meeting the §448(c) gross-receipts test ` +
          `(3-year average ≤ ${fmtCurrency(threshold)} for TY${data.taxYear}). No gross-receipts figure was supplied, ` +
          `so the engine applied the §163(j) limitation (Section I). To claim the exemption, enter the 3-year average ` +
          `gross receipts; if exempt, Form 8990 is OPTIONAL.`;
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#444")
      .text(noticeBody, 64, noticeTop + 22, { width: 484 });
    doc.y = noticeTop + 90;
    doc.moveDown(0.5);

    // ── Identification ──
    doc
      .fontSize(11)
      .fillColor("#000")
      .font("Helvetica-Bold")
      .text("Taxpayer Identification");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#222");
    field(doc, "Taxpayer name", data.taxpayerName || "—");
    field(
      doc,
      "Filing status",
      FILING_STATUS_LABELS[data.filingStatus] ?? data.filingStatus,
    );
    field(doc, "Tax year", String(data.taxYear));
    doc.moveDown(0.5);

    // ── Section I — Computation of Allowable Business Interest Expense ──
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Section I  Computation of Allowable Business Interest Expense");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#222");

    moneyLine(
      doc,
      "Line 1. Current-year business interest expense (gross)",
      data.currentYearBusinessInterestExpense,
    );
    moneyLine(
      doc,
      "Line 2. Disallowed business interest carryforward (from prior year)",
      data.carryforwardFromPrior,
    );
    moneyLine(
      doc,
      "Line 3. Total business interest subject to §163(j) cap (= Lines 1 + 2)",
      data.totalSubjectToCap,
    );
    moneyLine(
      doc,
      "Line 4. Floor plan financing interest (uncapped — 100% allowed)",
      data.floorPlanFinancingInterest,
    );
    moneyLine(
      doc,
      "Line 22. Business interest income (uncapped — adds to allowance)",
      data.businessInterestIncome,
    );
    moneyLine(
      doc,
      "Line 25. Adjusted Taxable Income (ATI) per §163(j)(8) — taxable income before §163(j)/NOL/QBI",
      data.ati,
    );
    moneyLine(
      doc,
      "Line 26. 30% × ATI (cap on subject-to-cap business interest)",
      data.thirtyPercentAti,
    );
    moneyLine(
      doc,
      "Line 30. Allowable business interest expense (current-year deduction)",
      data.allowedDeduction,
      true,
    );
    doc.moveDown(0.5);

    // ── Section II — Partnership Pass-Through Items (Lines 31-37) ──
    // These are completed by a PARTNERSHIP filing its own Form 8990; an
    // individual partner does not complete them. The partner-level item is
    // excess business interest expense (EBIE) reported on Schedule K-1
    // (1065 Box 13 code K / Box 20 code N), carried to the partner's
    // Form 8990 Schedule A and deductible only against future excess taxable
    // income from the SAME partnership (not the partner's own ATI).
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Section II  Partnership Pass-Through Items (Lines 31-37)");
    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica").fillColor("#555");
    doc.text(
      "Not applicable to an individual filer. A partnership computes its §163(j) limitation at the entity level " +
        "and reports each partner's excess business interest expense (EBIE), excess taxable income (ETI), and " +
        "excess business interest income on Schedule K-1. A partner who received EBIE carries it on Schedule A " +
        "of their own Form 8990 — it is deductible only against later ETI from the same partnership and is NOT " +
        "subject to the partner's own 30%-of-ATI limit in Section I.",
      54,
      doc.y,
      { width: 504 },
    );
    doc.moveDown(0.5);

    // ── Section III — S Corporation Pass-Through Items (Lines 38-42) ──
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Section III  S Corporation Pass-Through Items (Lines 38-42)");
    doc.moveDown(0.3);
    doc.fontSize(9).font("Helvetica").fillColor("#555");
    doc.text(
      "Not applicable to an individual filer. An S corporation applies §163(j) at the entity level; any disallowed " +
        "business interest stays at the S-corp level (it does not pass through as EBIE the way a partnership's does). " +
        "Shareholders therefore have no Section III pass-through entries on their individual Form 8990.",
      54,
      doc.y,
      { width: 504 },
    );
    doc.moveDown(0.5);

    // ── Section IV — Disallowed Business Interest Expense Carryforward ──
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Section IV  Disallowed Business Interest Expense Carryforward");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#222");
    moneyLine(
      doc,
      "Line 43. Total business interest expense subject to cap (= Line 3)",
      data.totalSubjectToCap,
    );
    moneyLine(
      doc,
      "Line 44. Allowable cap-subject portion (= Line 30 − Line 4 − Line 22)",
      Math.max(
        0,
        data.allowedDeduction -
          data.floorPlanFinancingInterest -
          data.businessInterestIncome,
      ),
    );
    moneyLine(
      doc,
      "Line 46. Disallowed business interest carryforward to next year",
      data.disallowedCarryforward,
      true,
    );
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
      `Total business interest subject to cap: ${fmtCurrency(data.totalSubjectToCap)}. ` +
        `30% × ATI ${fmtCurrency(data.ati)} = ${fmtCurrency(data.thirtyPercentAti)} (the cap). ` +
        `MIN(cap-subject, cap) = ${fmtCurrency(
          Math.min(data.totalSubjectToCap, data.thirtyPercentAti),
        )} cap-allowed. ` +
        `Plus floor plan ${fmtCurrency(data.floorPlanFinancingInterest)} + biz int income ${fmtCurrency(data.businessInterestIncome)} (both uncapped) = ` +
        `total allowed ${fmtCurrency(data.allowedDeduction)}. ` +
        `Disallowed cap-subject = ${fmtCurrency(data.disallowedCarryforward)} carries forward indefinitely per §163(j)(2).`,
      54,
      doc.y,
      { width: 504 },
    );
    doc.moveDown(0.8);

    // ── Footnote ──
    doc.fontSize(9).fillColor("#666");
    doc.text(
      "Notes: (1) ATI proxy is taxable-income-before-§163(j)/NOL/QBI; for TY≤2021 the rules also require " +
        "depreciation/amortization/depletion addback (not relevant for TY2024+). (2) Sections II/III are " +
        "entity-level (the partnership/S-corp files its own Form 8990) and are correctly blank for an individual " +
        "filer; partner-received EBIE is reported on Schedule A. (3) The §163(j)(3) small-business exemption is " +
        "now auto-detected from the CPA-supplied 3-year average gross receipts vs. the §448(c) threshold.",
      54,
      doc.y,
      { width: 504 },
    );
    doc.moveDown(2);

    doc
      .fontSize(8)
      .fillColor("#aaa")
      .text(
        "End of substitute Form 8990. CPA: transcribe these values to the official IRS Form 8990 or use this PDF as audit-trail backup.",
      );

    doc.end();
  });
}
