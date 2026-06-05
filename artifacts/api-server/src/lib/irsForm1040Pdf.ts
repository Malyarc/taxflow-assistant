/**
 * IRS Form 1040 PDF overlay using pdf-lib.
 *
 * Loads the bundled fillable IRS Form 1040 (TY2024) AcroForm template and
 * fills it from a `ComputedTaxReturn` + client. Flattens the form before
 * returning so the values render across all PDF viewers (Acrobat, macOS
 * Preview, Chrome pdfium). Returns a Buffer suitable for streaming back
 * from an Express route.
 *
 * The IRS uses opaque field names like `topmostSubform[0].Page1[0].f1_32[0]`
 * which we map to domain names (line1a, agi, etc.) in F1040_2024_FIELDS.
 *
 * Multi-year support: when TY2025 ships, add a parallel field map keyed by
 * year and select based on `return.taxYear`. For now only TY2024.
 *
 * Sources:
 *   https://www.irs.gov/pub/irs-prior/f1040--2024.pdf
 *   https://www.irs.gov/pub/irs-prior/f1040s1--2024.pdf
 *   https://www.irs.gov/pub/irs-prior/f1040s2--2024.pdf
 *   https://www.irs.gov/pub/irs-prior/f1040s3--2024.pdf
 */
import { PDFDocument, type PDFForm } from "pdf-lib";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComputedTaxReturn } from "./taxReturnPipeline";
import type { clientsTable } from "@workspace/db";

type Client = typeof clientsTable.$inferSelect;

/** Resolve the bundled IRS template by tax year + form name. */
function templatePath(formName: "1040" | "1040s1" | "1040s2" | "1040s3", taxYear: number): string {
  // We currently ship only TY2024 IRS fillable templates (with TY2024 AcroForm
  // field maps). Any other return year falls back to the 2024 form on purpose —
  // the route surfaces a year-mismatch warning. This explicit map (rather than a
  // no-op ternary) documents the limitation and the extension path: when TY2025+
  // templates land, add the directory here AND a year-specific field map + the
  // f*-<year>.pdf filenames below.
  const TEMPLATE_YEAR_DIR: Record<number, string> = { 2024: "irs-forms-2024" };
  const yearDir = TEMPLATE_YEAR_DIR[taxYear] ?? "irs-forms-2024";
  const baseName = formName === "1040" ? "f1040-2024.pdf" : `f${formName}-2024.pdf`;
  return path.join(globalThis.__dirname ?? "", "assets", yearDir, baseName);
}

// ─── Form 1040 field map (TY2024) ────────────────────────────────────────────
//
// Field names confirmed by parsing the actual IRS PDF's AcroForm dictionary.
// Y-coordinates of each field rect match the line label's y-coord on the page.
// See research notes for the full coordinate table.
//
const F1040_2024_FIELDS = {
  // Header — taxpayer identity
  firstName: "topmostSubform[0].Page1[0].f1_04[0]",
  lastName: "topmostSubform[0].Page1[0].f1_05[0]",
  ssn: "topmostSubform[0].Page1[0].f1_06[0]",
  spouseFirstName: "topmostSubform[0].Page1[0].f1_07[0]",
  spouseLastName: "topmostSubform[0].Page1[0].f1_08[0]",
  spouseSsn: "topmostSubform[0].Page1[0].f1_09[0]",

  // Filing status checkboxes
  filingStatusSingle: "topmostSubform[0].Page1[0].FilingStatus_ReadOrder[0].c1_3[0]",
  filingStatusMfj: "topmostSubform[0].Page1[0].FilingStatus_ReadOrder[0].c1_3[1]",
  filingStatusMfs: "topmostSubform[0].Page1[0].FilingStatus_ReadOrder[0].c1_3[2]",
  filingStatusHoh: "topmostSubform[0].Page1[0].c1_3[0]", // right column on the form
  filingStatusQss: "topmostSubform[0].Page1[0].c1_3[1]",

  // Page 1 income lines
  line1a: "topmostSubform[0].Page1[0].f1_32[0]", // W-2 box 1 sum
  line1z: "topmostSubform[0].Page1[0].f1_41[0]", // total of lines 1a–1h
  line2a: "topmostSubform[0].Page1[0].f1_42[0]", // tax-exempt interest
  line2b: "topmostSubform[0].Page1[0].f1_43[0]", // taxable interest
  line3a: "topmostSubform[0].Page1[0].f1_44[0]", // qualified dividends
  line3b: "topmostSubform[0].Page1[0].f1_45[0]", // ordinary dividends
  line4a: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_46[0]", // IRA distributions
  line4b: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_47[0]", // IRA taxable
  line5a: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_48[0]", // pensions
  line5b: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_49[0]", // pensions taxable
  line6a: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_50[0]", // SS benefits
  line6b: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_51[0]", // SS taxable
  line7: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_52[0]", // capital gain/loss
  line8: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_53[0]", // additional income from Sch 1
  line9: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_54[0]", // total income (AGI before adjustments)
  line10: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_55[0]", // adjustments from Sch 1
  line11: "topmostSubform[0].Page1[0].Line4a-11_ReadOrder[0].f1_56[0]", // AGI
  line12: "topmostSubform[0].Page1[0].f1_57[0]", // std or itemized
  line13: "topmostSubform[0].Page1[0].f1_58[0]", // QBI
  line14: "topmostSubform[0].Page1[0].f1_59[0]", // 12+13
  line15: "topmostSubform[0].Page1[0].f1_60[0]", // taxable income

  // Page 2 — tax, credits, payments
  line16: "topmostSubform[0].Page2[0].f2_02[0]", // tax
  line17: "topmostSubform[0].Page2[0].f2_03[0]", // Sch 2 line 3
  line18: "topmostSubform[0].Page2[0].f2_04[0]", // 16+17
  line19: "topmostSubform[0].Page2[0].f2_05[0]", // CTC
  line20: "topmostSubform[0].Page2[0].f2_06[0]", // Sch 3 line 8 (non-ref credits)
  line21: "topmostSubform[0].Page2[0].f2_07[0]", // 19+20
  line22: "topmostSubform[0].Page2[0].f2_08[0]", // 18 - 21
  line23: "topmostSubform[0].Page2[0].f2_09[0]", // Sch 2 line 21 (other taxes)
  line24: "topmostSubform[0].Page2[0].f2_10[0]", // total tax
  line25a: "topmostSubform[0].Page2[0].f2_11[0]", // W-2 federal withholding
  line25b: "topmostSubform[0].Page2[0].f2_12[0]", // 1099 federal withholding
  line25c: "topmostSubform[0].Page2[0].f2_13[0]", // other withholding
  line25d: "topmostSubform[0].Page2[0].f2_14[0]", // 25a+b+c
  line26: "topmostSubform[0].Page2[0].f2_15[0]", // 2024 estimated payments
  line27: "topmostSubform[0].Page2[0].f2_16[0]", // EITC
  line28: "topmostSubform[0].Page2[0].f2_17[0]", // additional CTC
  line29: "topmostSubform[0].Page2[0].f2_18[0]", // AOC refundable
  line31: "topmostSubform[0].Page2[0].f2_20[0]", // Sch 3 line 15 (other refundable)
  line32: "topmostSubform[0].Page2[0].f2_21[0]", // total other payments
  line33: "topmostSubform[0].Page2[0].f2_22[0]", // total payments
  line34: "topmostSubform[0].Page2[0].f2_23[0]", // overpayment (refund)
  line37: "topmostSubform[0].Page2[0].f2_28[0]", // amount you owe
} as const;

// Formatting: IRS convention is no $ sign, no decimals on summary lines.
// Negative numbers shown as plain negatives (no parens).
function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  // IRS forms show whole dollars on Form 1040; cents on supporting schedules.
  return Math.round(n).toLocaleString("en-US");
}

function fmtSsn(s: string | null | undefined): string {
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length !== 9) return s;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/**
 * Safe text setter. pdf-lib's `getTextField()` throws if the field doesn't
 * exist (the IRS occasionally renumbers fields between revisions); wrap in
 * try/catch so a missing field doesn't fail the whole export.
 */
function safeSet(form: PDFForm, name: string, value: string): void {
  if (!value) return;
  try {
    const field = form.getTextField(name);
    field.setText(value);
  } catch {
    // Field not found — log and continue. In production we'd want a metric.
  }
}

function safeCheck(form: PDFForm, name: string): void {
  try {
    form.getCheckBox(name).check();
  } catch {
    // ignore
  }
}

export interface BuildIrsForm1040Options {
  client: Client;
  ret: ComputedTaxReturn;
  /** True (default) = flatten the form so values render in all viewers. False = keep fillable. */
  flatten?: boolean;
}

/**
 * Build a populated IRS Form 1040 PDF for the given client + computed return.
 *
 * Limitations:
 * - Schedules 1, 2, 3 are not yet overlaid (a future commit can add them by
 *   loading their templates and merging multi-page output via PDFDocument.copyPages).
 * - For tax years other than 2024, falls back to the 2024 template (form
 *   layout changes year to year; CPAs need to manually verify).
 * - Spouse data is filled only if filing status is MFJ.
 */
export async function buildIrsForm1040Pdf(options: BuildIrsForm1040Options): Promise<Buffer> {
  const { client, ret } = options;
  const flatten = options.flatten !== false;

  const templateBytes = readFileSync(templatePath("1040", ret.taxYear));
  const pdf = await PDFDocument.load(templateBytes);
  const form = pdf.getForm();

  // ── Header ──
  safeSet(form, F1040_2024_FIELDS.firstName, client.firstName ?? "");
  safeSet(form, F1040_2024_FIELDS.lastName, client.lastName ?? "");
  // SSN currently not stored on the client; the W-2 carries the employee SSN.
  // (Privacy note: we mask SSNs in the UI; we don't store a top-level taxpayer
  // SSN. The form leaves this blank — CPAs fill it in their own software.)

  // ── Filing status ──
  switch (client.filingStatus) {
    case "single":
      safeCheck(form, F1040_2024_FIELDS.filingStatusSingle);
      break;
    case "married_filing_jointly":
      safeCheck(form, F1040_2024_FIELDS.filingStatusMfj);
      break;
    case "married_filing_separately":
      safeCheck(form, F1040_2024_FIELDS.filingStatusMfs);
      break;
    case "head_of_household":
      safeCheck(form, F1040_2024_FIELDS.filingStatusHoh);
      break;
    case "qualifying_widow":
      safeCheck(form, F1040_2024_FIELDS.filingStatusQss);
      break;
  }

  // ── Page 1 income lines ──
  // We don't separate W-2 wages from total income at the line-1a granularity
  // perfectly because the engine sums everything into adjustments; the most
  // honest mapping uses what we DO know.
  const wages = (ret.totalIncome ?? 0) - (
    (Number(ret.form1099Summary?.interestIncome ?? 0)) +
    (Number(ret.form1099Summary?.ordinaryDividends ?? 0)) +
    (Number(ret.form1099Summary?.retirementIncome ?? 0)) +
    (Number(ret.netCapitalGainLoss ?? 0))
  );
  safeSet(form, F1040_2024_FIELDS.line1a, fmt(wages));
  safeSet(form, F1040_2024_FIELDS.line1z, fmt(wages));

  safeSet(form, F1040_2024_FIELDS.line2b, fmt(ret.form1099Summary?.interestIncome ?? 0));
  safeSet(form, F1040_2024_FIELDS.line3b, fmt(ret.form1099Summary?.ordinaryDividends ?? 0));
  safeSet(form, F1040_2024_FIELDS.line3a, fmt(ret.preferentialIncome ?? 0)); // qualified dividends (preferential portion)
  safeSet(form, F1040_2024_FIELDS.line5b, fmt(ret.form1099Summary?.retirementIncome ?? 0));
  // K10 — Social Security: Line 6a (gross) and 6b (taxable, per Pub 915).
  safeSet(form, F1040_2024_FIELDS.line6a, fmt(ret.socialSecurityBenefits ?? 0));
  safeSet(form, F1040_2024_FIELDS.line6b, fmt(ret.socialSecurityTaxable ?? 0));
  safeSet(form, F1040_2024_FIELDS.line7, fmt(ret.netCapitalGainLoss ?? 0));

  safeSet(form, F1040_2024_FIELDS.line9, fmt(ret.totalIncome));
  // Above-the-line adjustments: AGI = total income - line 10. So line 10 = total income - AGI.
  const line10 = (ret.totalIncome ?? 0) - (ret.adjustedGrossIncome ?? 0);
  safeSet(form, F1040_2024_FIELDS.line10, fmt(line10));
  safeSet(form, F1040_2024_FIELDS.line11, fmt(ret.adjustedGrossIncome));

  // Line 12: std vs itemized; the engine picks one
  const deduction = ret.itemizedDeductions ?? ret.standardDeduction;
  safeSet(form, F1040_2024_FIELDS.line12, fmt(deduction));
  safeSet(form, F1040_2024_FIELDS.line13, fmt(ret.qbiDeduction));
  safeSet(form, F1040_2024_FIELDS.line14, fmt((deduction ?? 0) + (ret.qbiDeduction ?? 0)));
  safeSet(form, F1040_2024_FIELDS.line15, fmt(ret.taxableIncome));

  // ── Page 2 — tax + credits + payments ──
  // Line 16 is gross federal tax (income tax only, before credits).
  // engine breaks out: regularFederalTax + amtTax + niit + se + addlMedicare
  // For 1040 Line 16 we want regularFederalTax (the bracket-based income tax).
  const regularFederalTax = (ret.federalTaxLiability ?? 0)
    - (ret.amtTax ?? 0)
    - (ret.niitTax ?? 0)
    - (ret.selfEmploymentTax ?? 0)
    - (ret.additionalMedicareTax ?? 0);
  safeSet(form, F1040_2024_FIELDS.line16, fmt(Math.max(0, regularFederalTax)));
  // Line 17 (Schedule 2 line 3) = AMT + excess APTC. We approximate to AMT only.
  safeSet(form, F1040_2024_FIELDS.line17, fmt(ret.amtTax ?? 0));
  safeSet(form, F1040_2024_FIELDS.line18, fmt(Math.max(0, regularFederalTax + (ret.amtTax ?? 0))));

  // Line 19: CTC (non-refundable portion). CtcCalculation exposes
  // `nonRefundablePortion`; refundable ACTC lands separately on Line 28.
  safeSet(form, F1040_2024_FIELDS.line19, fmt(ret.childTaxCredit?.nonRefundablePortion ?? 0));

  // Line 23: other taxes (SE + NIIT + Add'l Medicare) — Schedule 2 line 21.
  // Add'l Medicare flows from Form 8959 Line 18 → Sch 2 Line 11 → Line 21.
  safeSet(form, F1040_2024_FIELDS.line23, fmt(
    (ret.selfEmploymentTax ?? 0) + (ret.niitTax ?? 0) + (ret.additionalMedicareTax ?? 0)));
  safeSet(form, F1040_2024_FIELDS.line24, fmt(ret.federalTaxLiability ?? 0));

  // Payments
  safeSet(form, F1040_2024_FIELDS.line25a, fmt(ret.federalTaxWithheld ?? 0));
  safeSet(form, F1040_2024_FIELDS.line25d, fmt(ret.federalTaxWithheld ?? 0));
  safeSet(form, F1040_2024_FIELDS.line27, fmt(ret.eitc?.appliedCredit ?? 0));
  safeSet(form, F1040_2024_FIELDS.line28, fmt(ret.additionalChildTaxCredit ?? 0));
  safeSet(form, F1040_2024_FIELDS.line33, fmt(ret.federalTaxWithheld ?? 0));

  // Refund vs. owed
  const refundOrOwed = ret.federalRefundOrOwed ?? 0;
  if (refundOrOwed > 0) {
    safeSet(form, F1040_2024_FIELDS.line34, fmt(refundOrOwed));
  } else if (refundOrOwed < 0) {
    safeSet(form, F1040_2024_FIELDS.line37, fmt(Math.abs(refundOrOwed)));
  }

  if (flatten) form.flatten();

  const out = await pdf.save();
  return Buffer.from(out);
}

// Re-suppress unused-but-helpful guard
void fmtSsn;
