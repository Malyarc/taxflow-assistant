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
    doc.fontSize(11).font("Helvetica").fillColor("#555").text(`Prepared by TaxFlow Assistant · TY ${ret.taxYear}`);
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

    const incomeRows: Array<[string, string]> = [
      ["Total income (wages + other)", fmt(ret.totalIncome)],
      ["Above-the-line adjustments", "—"],
      ["Adjusted gross income (AGI)", fmt(ret.adjustedGrossIncome)],
    ];
    if ((ret.socialSecurityBenefits ?? 0) > 0) {
      incomeRows.splice(1, 0,
        ["Social Security benefits (1040 L6a, gross)", fmt(ret.socialSecurityBenefits)],
        [`Taxable Social Security (1040 L6b, ${ret.socialSecurityTaxabilityDetail.appliedMaxPercent}% rule)`, fmt(ret.socialSecurityTaxable)],
      );
    }
    section("Income", incomeRows);

    section("Deductions", [
      ["Standard / itemized deduction", fmt(ret.standardDeduction)],
      ...(ret.qbiDeduction > 0 ? [["QBI deduction (§199A)", fmt(ret.qbiDeduction)] as [string, string]] : []),
      ["Taxable income", fmt(ret.taxableIncome)],
    ]);

    // Above-the-line adjustments (Schedule 1 Part II)
    const atlRows: Array<[string, string]> = [];
    if (ret.retirementDeductions.hsaDeductible > 0) atlRows.push(["HSA deduction (Sched 1 L13)", fmt(ret.retirementDeductions.hsaDeductible)]);
    if (ret.retirementDeductions.iraDeductible > 0) atlRows.push(["Traditional IRA deduction (Sched 1 L20)", fmt(ret.retirementDeductions.iraDeductible)]);
    if (ret.sehi.deduction > 0) atlRows.push(["SE health insurance (Sched 1 L17, Form 7206)", fmt(ret.sehi.deduction)]);
    if (ret.educatorExpenses.deductible > 0) atlRows.push(["Educator expenses (Sched 1 L11)", fmt(ret.educatorExpenses.deductible)]);
    if (ret.studentLoanInterest.deductible > 0) atlRows.push(["Student loan interest (Sched 1 L21)", fmt(ret.studentLoanInterest.deductible)]);
    if (ret.scheduleCExpenses > 0) atlRows.push(["Schedule C business expenses", fmt(ret.scheduleCExpenses)]);
    if (atlRows.length > 0) section("Above-the-line adjustments", atlRows);

    // Schedule A itemized (if itemizing)
    if (ret.itemizedDeductions != null) {
      const schARows: Array<[string, string]> = [];
      if (ret.scheduleA.medicalDeductible > 0) schARows.push(["Medical (Sched A L4)", fmt(ret.scheduleA.medicalDeductible)]);
      if (ret.scheduleA.saltDeductible > 0) schARows.push(["SALT capped (Sched A L7)", fmt(ret.scheduleA.saltDeductible)]);
      if (ret.scheduleA.mortgageDeductible > 0) schARows.push(["Mortgage interest (Sched A L10)", fmt(ret.scheduleA.mortgageDeductible)]);
      if (ret.scheduleA.charitableDeductible > 0) schARows.push(["Charitable (Sched A L14)", fmt(ret.scheduleA.charitableDeductible)]);
      schARows.push(["Total itemized (Sched A L17)", fmt(ret.itemizedDeductions)]);
      section("Schedule A (Itemized)", schARows);
    }

    // Schedule D (Capital Gains/Losses)
    if (ret.netCapitalGainLoss !== 0 || ret.capitalLossDeducted > 0 || ret.homeSaleGrossGain > 0) {
      const sdRows: Array<[string, string]> = [
        ["Net capital gain/loss (Sched D L16)", fmt(ret.netCapitalGainLoss)],
      ];
      if (ret.homeSaleGrossGain > 0) {
        sdRows.push(["Home sale gross gain (primary residence)", fmt(ret.homeSaleGrossGain)]);
        sdRows.push(["§121 exclusion applied", `(${fmt(ret.homeSaleSection121Exclusion)})`]);
        sdRows.push(["Taxable home-sale gain (added to LTCG)", fmt(ret.homeSaleTaxableGain)]);
      }
      if (ret.capitalLossDeducted > 0) sdRows.push(["Capital loss deducted (Sched D L21)", `(${fmt(ret.capitalLossDeducted)})`]);
      if (ret.capitalLossCarryforwardShort > 0) sdRows.push(["Short-term carryforward to next year", fmt(ret.capitalLossCarryforwardShort)]);
      if (ret.capitalLossCarryforwardLong > 0) sdRows.push(["Long-term carryforward to next year", fmt(ret.capitalLossCarryforwardLong)]);
      section("Schedule D (Capital Gains/Losses)", sdRows);
    }

    // Schedule E (Rental Real Estate)
    if (ret.scheduleERentalGrossNet !== 0 || ret.scheduleERentalAppliedToAgi !== 0) {
      const seRows: Array<[string, string]> = [
        ["Gross rental net income/loss", fmt(ret.scheduleERentalGrossNet)],
        ["Applied to AGI (after PAL limit)", fmt(ret.scheduleERentalAppliedToAgi)],
      ];
      if (ret.scheduleEPassiveLossSuspended > 0) seRows.push(["§469 passive loss suspended to next year", fmt(ret.scheduleEPassiveLossSuspended)]);
      section("Schedule E (Rental Real Estate)", seRows);
    }

    const fedRows: Array<[string, string]> = [
      ["Federal income tax (regular, 1040 L16)", fmt(ret.federalTaxLiability - (ret.amtTax ?? 0) - (ret.niitTax ?? 0) - (ret.selfEmploymentTax ?? 0) - (ret.additionalMedicareTax ?? 0))],
    ];
    if (ret.selfEmploymentTax > 0) fedRows.push(["Self-employment tax (Sched SE)", fmt(ret.selfEmploymentTax)]);
    if (ret.niitTax > 0) fedRows.push(["Net investment income tax (Form 8960)", fmt(ret.niitTax)]);
    if (ret.additionalMedicareTax > 0) fedRows.push(["Additional Medicare tax (Form 8959)", fmt(ret.additionalMedicareTax)]);
    if (ret.amtTax > 0) fedRows.push(["Alternative minimum tax (Form 6251)", fmt(ret.amtTax)]);
    fedRows.push(["Total federal tax liability (1040 L24)", fmt(ret.federalTaxLiability)]);
    // Credits
    if (ret.childTaxCredit.appliedCredit > 0) {
      fedRows.push(["Child Tax Credit (1040 L19)", `(${fmt(ret.childTaxCredit.appliedCredit)})`]);
      if (ret.childTaxCredit.refundableActc > 0) {
        fedRows.push(["  └─ Refundable ACTC", fmt(ret.childTaxCredit.refundableActc)]);
      }
    }
    if (ret.foreignTaxCredit.credit > 0) fedRows.push(["Foreign Tax Credit (Sched 3 L1)", `(${fmt(ret.foreignTaxCredit.credit)})`]);
    if (ret.dependentCareCredit.appliedCredit > 0) fedRows.push(["Dependent Care Credit (Sched 3 L2)", `(${fmt(ret.dependentCareCredit.appliedCredit)})`]);
    if (ret.educationCredits.aocApplied > 0) fedRows.push(["AOC Credit (Sched 3 L3a)", `(${fmt(ret.educationCredits.aocApplied)})`]);
    if (ret.educationCredits.llcApplied > 0) fedRows.push(["LLC Credit (Sched 3 L3b)", `(${fmt(ret.educationCredits.llcApplied)})`]);
    if (ret.saversCredit.appliedCredit > 0) fedRows.push(["Saver's Credit (Sched 3 L4)", `(${fmt(ret.saversCredit.appliedCredit)})`]);
    if (ret.residentialEnergyCredits.total > 0) fedRows.push(["Residential Energy Credits (Sched 3 L5a/5b)", `(${fmt(ret.residentialEnergyCredits.total)})`]);
    if (ret.eitc.appliedCredit > 0) fedRows.push(["EITC (1040 L27, refundable)", `(${fmt(ret.eitc.appliedCredit)})`]);
    if (ret.premiumTaxCredit.netPtc > 0) fedRows.push(["Net Premium Tax Credit (Sched 3 L8)", `(${fmt(ret.premiumTaxCredit.netPtc)})`]);
    if (ret.premiumTaxCredit.netPtc < 0) fedRows.push(["Excess Advance APTC (Sched 2 L2)", fmt(Math.abs(ret.premiumTaxCredit.netPtc))]);
    if (ret.manualCreditsApplied > 0) fedRows.push(["Other credits applied (manual)", `(${fmt(ret.manualCreditsApplied)})`]);
    fedRows.push(["Federal tax withheld (1040 L25a)", fmt(ret.federalTaxWithheld)]);
    const fedRefund = ret.federalRefundOrOwed;
    fedRows.push([fedRefund >= 0 ? "Federal refund (1040 L34)" : "Federal balance due (1040 L37)", fmt(Math.abs(fedRefund))]);
    section("Federal", fedRows);

    const stateRows: Array<[string, string]> = [
      [`Resident state (${ret.stateCode}) tax`, fmt(ret.multiState.residentStateTax)],
    ];
    if (ret.stateRetirementExemption > 0) stateRows.push(["State retirement exemption applied", `(${fmt(ret.stateRetirementExemption)})`]);
    if (ret.multiState.nonresidentStateTaxes.length > 0) {
      for (const nr of ret.multiState.nonresidentStateTaxes) {
        if (nr.reciprocityApplied) {
          stateRows.push([`Non-resident ${nr.state} (reciprocity, no tax)`, fmt(0)]);
        } else {
          stateRows.push([`Non-resident ${nr.state} tax on $${nr.wages.toFixed(0)} wages`, fmt(nr.tax)]);
        }
      }
      if (ret.multiState.residentCreditApplied > 0) {
        stateRows.push(["  └─ Resident credit for NR tax paid", `(${fmt(ret.multiState.residentCreditApplied)})`]);
      }
    }
    stateRows.push(["Total state tax", fmt(ret.stateTaxLiability)]);
    stateRows.push(["State tax withheld", fmt(ret.stateTaxWithheld)]);
    stateRows.push([ret.stateRefundOrOwed >= 0 ? "State refund" : "State balance due", fmt(Math.abs(ret.stateRefundOrOwed))]);
    section("State", stateRows);

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
