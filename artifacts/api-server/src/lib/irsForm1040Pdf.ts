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
import type { TaxReturnInputs } from "./taxReturnEngine";
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
  /**
   * Input-side facts (W-2 records) for the lines the engine OUTPUT alone
   * cannot attribute: 1a (W-2 box-1 wages), 25a (W-2 withholding) and their
   * residual counterparts 8 / 25c. When absent those lines are left BLANK
   * (per Pub 1167 a blank beats a wrong value); the totals (9/11/25d/…)
   * always render from engine output.
   */
  inputs?: TaxReturnInputs;
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
  const { client, ret, inputs } = options;
  const flatten = options.flatten !== false;
  const toNum = (v: unknown): number => {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
    return Number.isFinite(n) ? n : 0;
  };

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

  // ── Page 1 income lines (H5 rewrite, audit 2026-06-11) ──
  // Source every line from engine outputs exactly the way the (correct)
  // substitute workpaper builder (forms/form1040Spec.ts) does:
  //   1a    = W-2 box-1 sum from INPUTS (year-filtered); blank when inputs
  //           are unavailable — never a residual that swallows SS/QDIV/SE.
  //   3a    = qualified dividends ONLY (was preferentialIncome = QDIV + LTCG).
  //   3b    = 1099-DIV box-1a TOTAL incl. the qualified portion (the engine's
  //           `ordinaryDividends` is the non-qualified remainder).
  //   7     = Schedule D line 16 when a net gain; when a net loss, the
  //           ordinary-offset portion only (line 21, −$3,000/−$1,500 cap) —
  //           was the full uncapped loss.
  //   8     = derived residual so line 9 ties (Schedule 1 income: SE, K-1,
  //           rentals, unemployment, MISC/K, …); blank without inputs (its
  //           value depends on the 1a attribution).
  const f99 = ret.form1099Summary;
  const w2sForYear = (inputs?.w2s ?? []).filter(
    (w) => (w.taxYear ?? ret.taxYear) === ret.taxYear,
  );
  const wages = inputs ? w2sForYear.reduce((s, w) => s + toNum(w.wagesBox1), 0) : null;
  if (wages != null) {
    safeSet(form, F1040_2024_FIELDS.line1a, fmt(wages));
    safeSet(form, F1040_2024_FIELDS.line1z, fmt(wages));
  }

  const line2b = toNum(f99?.interestIncome);
  const line3a = toNum(f99?.qualifiedDividends);
  const line3b = toNum(f99?.ordinaryDividends) + line3a; // box-1a TOTAL
  const line4b5b = toNum(f99?.retirementIncome);
  const line6b = toNum(ret.socialSecurityTaxable);
  const line7 =
    (ret.netCapitalGainLoss ?? 0) >= 0
      ? toNum(ret.netCapitalGainLoss)
      : -toNum(ret.capitalLossDeducted);
  safeSet(form, F1040_2024_FIELDS.line2a, fmt(f99?.taxExemptInterest ?? 0));
  safeSet(form, F1040_2024_FIELDS.line2b, fmt(line2b));
  safeSet(form, F1040_2024_FIELDS.line3a, fmt(line3a));
  safeSet(form, F1040_2024_FIELDS.line3b, fmt(line3b));
  safeSet(form, F1040_2024_FIELDS.line5b, fmt(line4b5b));
  // K10 — Social Security: Line 6a (gross) and 6b (taxable, per Pub 915).
  safeSet(form, F1040_2024_FIELDS.line6a, fmt(ret.socialSecurityBenefits ?? 0));
  safeSet(form, F1040_2024_FIELDS.line6b, fmt(line6b));
  safeSet(form, F1040_2024_FIELDS.line7, fmt(line7));
  if (wages != null) {
    const line8 =
      (ret.totalIncome ?? 0) - (wages + line2b + line3b + line4b5b + line6b + line7);
    safeSet(form, F1040_2024_FIELDS.line8, fmt(line8));
  }

  safeSet(form, F1040_2024_FIELDS.line9, fmt(ret.totalIncome));
  // Above-the-line adjustments: AGI = total income - line 10. So line 10 = total income - AGI.
  const line10 = (ret.totalIncome ?? 0) - (ret.adjustedGrossIncome ?? 0);
  safeSet(form, F1040_2024_FIELDS.line10, fmt(line10));
  safeSet(form, F1040_2024_FIELDS.line11, fmt(ret.adjustedGrossIncome));

  // Line 12: std vs itemized; the engine picks one
  const deduction = ret.itemizedDeductions ?? ret.standardDeduction;
  safeSet(form, F1040_2024_FIELDS.line12, fmt(deduction));
  // Line 13: §199A QBI (+ the OBBBA Schedule 1-A deductions when a TY2025+
  // return falls back to this TY2024 template — merged so line 15 foots; the
  // route already surfaces a year-mismatch warning for those returns).
  // NOTE: the engine additionally deducts any §172 NOL between lines 12 and
  // 13 (disclosed deviation — see the substitute workpaper), so line 15 is
  // the engine value, not necessarily 11 − 14, for NOL filers.
  const line13Val = (ret.qbiDeduction ?? 0) + (ret.obbbaSchedule1A?.total ?? 0);
  safeSet(form, F1040_2024_FIELDS.line13, fmt(line13Val));
  safeSet(form, F1040_2024_FIELDS.line14, fmt((deduction ?? 0) + line13Val));
  safeSet(form, F1040_2024_FIELDS.line15, fmt(ret.taxableIncome));

  // ── Page 2 — tax + credits + payments (H5 rewrite, audit 2026-06-11) ──
  // Mirror the workpaper's residual decomposition of the engine's PRE-credit
  // federalTaxLiability:
  //   line 23 (Sch 2 line 21, other taxes) = SE + NIIT + Add'l Medicare +
  //          §72(t) + HSA excise + Schedule H  (the last three previously
  //          stayed inside line 16);
  //   line 17 (Sch 2 line 3) = AMT + excess-APTC repayment (was AMT only);
  //   line 16 = the residual regular income tax.
  const excessAptcRepayment = Math.max(0, -(ret.premiumTaxCredit?.netPtc ?? 0));
  const line23Val =
    (ret.selfEmploymentTax ?? 0) +
    (ret.niitTax ?? 0) +
    (ret.additionalMedicareTax ?? 0) +
    (ret.earlyWithdrawalPenalty ?? 0) +
    (ret.hsaExcessExcise ?? 0) +
    (ret.scheduleH?.total ?? 0);
  const regularFederalTax =
    (ret.federalTaxLiability ?? 0) - (ret.amtTax ?? 0) - excessAptcRepayment - line23Val;
  safeSet(form, F1040_2024_FIELDS.line16, fmt(Math.max(0, regularFederalTax)));
  safeSet(form, F1040_2024_FIELDS.line17, fmt((ret.amtTax ?? 0) + excessAptcRepayment));
  const line18Val = Math.max(0, regularFederalTax + (ret.amtTax ?? 0) + excessAptcRepayment);
  safeSet(form, F1040_2024_FIELDS.line18, fmt(line18Val));

  // Line 19: CTC (non-refundable portion). CtcCalculation exposes
  // `nonRefundablePortion`; refundable ACTC lands separately on Line 28.
  safeSet(form, F1040_2024_FIELDS.line19, fmt(ret.childTaxCredit?.nonRefundablePortion ?? 0));

  // Audit 2026-06-08 PDF1 — Lines 20/21/22 were never written, and Line 24 used
  // the PRE-nonrefundable-credit federalTaxLiability (overstating it by the
  // credits). Line 20 = Schedule 3 non-refundable credits (everything EXCEPT the
  // CTC, which is Line 19); Line 21 = 19+20; Line 22 = 18−21.
  const ctcNonRef = ret.childTaxCredit?.nonRefundablePortion ?? 0;
  const sch3NonRef = Math.max(0, (ret.totalNonRefundableApplied ?? 0) - ctcNonRef);
  safeSet(form, F1040_2024_FIELDS.line20, fmt(sch3NonRef));
  safeSet(form, F1040_2024_FIELDS.line21, fmt(ctcNonRef + sch3NonRef));
  const line22Val = Math.max(0, line18Val - (ctcNonRef + sch3NonRef));
  safeSet(form, F1040_2024_FIELDS.line22, fmt(line22Val));

  // Line 23: Schedule 2 line 21 other taxes (see decomposition above).
  safeSet(form, F1040_2024_FIELDS.line23, fmt(line23Val));
  // Line 24 (total tax) = Line 22 + Line 23 (== federalTaxLiability −
  // totalNonRefundableApplied, since the engine caps credits at the
  // income-tax portion).
  safeSet(form, F1040_2024_FIELDS.line24, fmt(Math.max(0, line22Val + line23Val)));

  // Payments (H5): official 25a is W-2 withholding ONLY; 25b is 1099
  // withholding; 25c the rest (manual CPA withholding adjustments); 25d the
  // total. The engine total previously landed on BOTH 25a and 25d.
  const line25d = ret.federalTaxWithheld ?? 0;
  const w2Withheld = inputs
    ? w2sForYear.reduce((s, w) => s + toNum(w.federalTaxWithheldBox2), 0)
    : null;
  const f99Withheld = toNum(f99?.federalWithheld);
  safeSet(form, F1040_2024_FIELDS.line25b, fmt(f99Withheld));
  if (w2Withheld != null) {
    safeSet(form, F1040_2024_FIELDS.line25a, fmt(w2Withheld));
    safeSet(form, F1040_2024_FIELDS.line25c, fmt(line25d - w2Withheld - f99Withheld));
  }
  safeSet(form, F1040_2024_FIELDS.line25d, fmt(line25d));
  safeSet(form, F1040_2024_FIELDS.line27, fmt(ret.eitc?.appliedCredit ?? 0));
  safeSet(form, F1040_2024_FIELDS.line28, fmt(ret.additionalChildTaxCredit ?? 0));
  safeSet(form, F1040_2024_FIELDS.line29, fmt(ret.educationCredits?.aocRefundable ?? 0));
  // Line 31 (Schedule 3 line 13): net PTC + refundable adoption (OBBBA) +
  // manual CPA credit adjustments — mirrors the workpaper.
  const line31Val =
    Math.max(0, ret.premiumTaxCredit?.netPtc ?? 0) +
    (ret.adoptionCredit?.refundablePortion ?? 0) +
    (ret.manualCreditsApplied ?? 0);
  safeSet(form, F1040_2024_FIELDS.line31, fmt(line31Val));
  // Line 32 = 27 + 28 + 29 + 31; Line 33 (total payments) = 25d + 32 (H5 —
  // previously omitted refundable AOC, adoption-refundable and manual credits,
  // so 33 − 24 ≠ 34/37 for those filers).
  const line32Val =
    (ret.eitc?.appliedCredit ?? 0) +
    (ret.additionalChildTaxCredit ?? 0) +
    (ret.educationCredits?.aocRefundable ?? 0) +
    line31Val;
  safeSet(form, F1040_2024_FIELDS.line32, fmt(line32Val));
  safeSet(form, F1040_2024_FIELDS.line33, fmt(line25d + line32Val));

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
