/**
 * PDF generation for tax return summaries using pdfkit.
 *
 * Produces a clean one-page (or two-page) summary suitable for the CPA to
 * email or print for their client.
 */
import PDFDocument from "pdfkit";
import type { ComputedTaxReturn } from "./taxReturnPipeline";
import type { clientsTable } from "@workspace/db";

type Client = typeof clientsTable.$inferSelect;

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_widow: "Qualifying Widow(er)",
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

export function buildTaxReturnPdf(client: Client, ret: ComputedTaxReturn): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.fontSize(20).fillColor("#000").font("Helvetica-Bold").text("Tax Return Summary");
    doc.moveDown(0.3);
    doc.fontSize(11).font("Helvetica").fillColor("#555").text(`Prepared by TaxFlow Pro · TY ${ret.taxYear}`);
    doc.moveDown(0.3);
    const reportDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    doc.fontSize(9).fillColor("#888").text(`Generated ${reportDate}`);
    doc.moveDown(1);

    // Client section
    doc.fontSize(13).fillColor("#000").font("Helvetica-Bold").text("Client");
    doc.moveDown(0.2);
    doc.fontSize(10).font("Helvetica").fillColor("#222");
    doc.text(`${client.firstName} ${client.lastName}`);
    doc.text(`${client.email}`);
    if (client.phone) doc.text(`${client.phone}`);
    doc.text(`${FILING_STATUS_LABELS[client.filingStatus] ?? client.filingStatus} · ${client.state} · TY${ret.taxYear}`);
    if ((client.dependentsUnder17 ?? 0) > 0) {
      doc.text(`${client.dependentsUnder17} qualifying child${client.dependentsUnder17 === 1 ? "" : "ren"}` + (client.otherDependents ? `, ${client.otherDependents} other dependent${client.otherDependents === 1 ? "" : "s"}` : ""));
    }
    doc.moveDown(1);

    // Section helper
    function section(title: string, rows: Array<[string, string]>) {
      doc.fontSize(13).fillColor("#000").font("Helvetica-Bold").text(title);
      doc.moveDown(0.2);
      doc.fontSize(10).font("Helvetica");
      const y0 = doc.y;
      const labelX = 54;
      const valueX = 350;
      for (const [label, val] of rows) {
        doc.fillColor("#444").text(label, labelX, doc.y, { continued: false });
        // Right-align value
        const currentY = doc.y - 12;
        doc.fillColor("#000").font("Helvetica-Bold").text(val, valueX, currentY, { align: "right", width: 200 });
        doc.font("Helvetica");
      }
      doc.moveDown(0.5);
    }

    section("Income", [
      ["Total income (wages + other)", fmt(ret.totalIncome)],
      ["Above-the-line adjustments", "—"],
      ["Adjusted gross income (AGI)", fmt(ret.adjustedGrossIncome)],
    ]);

    section("Deductions", [
      ["Standard / itemized deduction", fmt(ret.standardDeduction)],
      ...(ret.qbiDeduction > 0 ? [["QBI deduction (§199A)", fmt(ret.qbiDeduction)] as [string, string]] : []),
      ["Taxable income", fmt(ret.taxableIncome)],
    ]);

    const fedRows: Array<[string, string]> = [
      ["Federal income tax (regular)", fmt(ret.federalTaxLiability - (ret.amtTax ?? 0) - (ret.niitTax ?? 0) - (ret.selfEmploymentTax ?? 0))],
    ];
    if (ret.selfEmploymentTax > 0) fedRows.push(["Self-employment tax (Schedule SE)", fmt(ret.selfEmploymentTax)]);
    if (ret.niitTax > 0) fedRows.push(["Net investment income tax (NIIT)", fmt(ret.niitTax)]);
    if (ret.amtTax > 0) fedRows.push(["Alternative minimum tax (AMT)", fmt(ret.amtTax)]);
    fedRows.push(["Total federal tax liability", fmt(ret.federalTaxLiability)]);
    if (ret.childTaxCredit.appliedCredit > 0) {
      fedRows.push(["Child Tax Credit", `(${fmt(ret.childTaxCredit.appliedCredit)})`]);
      if (ret.childTaxCredit.refundableActc > 0) {
        fedRows.push(["  └─ Refundable ACTC", fmt(ret.childTaxCredit.refundableActc)]);
      }
    }
    if (ret.manualCreditsApplied > 0) fedRows.push(["Other credits applied", `(${fmt(ret.manualCreditsApplied)})`]);
    fedRows.push(["Federal tax withheld", fmt(ret.federalTaxWithheld)]);
    const fedRefund = ret.federalRefundOrOwed;
    fedRows.push([fedRefund >= 0 ? "Federal refund" : "Federal balance due", fmt(Math.abs(fedRefund))]);
    section("Federal", fedRows);

    section("State", [
      [`State (${ret.stateCode}) income tax`, fmt(ret.stateTaxLiability)],
      ["State tax withheld", fmt(ret.stateTaxWithheld)],
      [ret.stateRefundOrOwed >= 0 ? "State refund" : "State balance due", fmt(Math.abs(ret.stateRefundOrOwed))],
    ]);

    section("Summary metrics", [
      ["Effective tax rate (federal + state)", pct(ret.effectiveTaxRate)],
      ["Total refund (federal + state)", fmt(ret.federalRefundOrOwed + ret.stateRefundOrOwed)],
      ["W-2 records included", String(ret.w2Count)],
    ]);

    doc.moveDown(1);
    doc.fontSize(8).fillColor("#888").font("Helvetica-Oblique").text(
      "This is a calculator summary, not a filed tax return. Verify all numbers before filing. " +
      "Local taxes (city, county), AMT preferences, and certain credits may not be modeled. " +
      "AI-extracted W-2 data should be cross-checked against the source document.",
      { width: 500 },
    );

    doc.end();
  });
}
