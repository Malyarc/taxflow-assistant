/**
 * Export computed tax returns to external formats for CPA software import.
 *
 * Formats:
 *   - JSON: complete machine-readable tax return data
 *   - CSV: flat file with Form 1040 line numbers and values, designed for
 *     spreadsheet-based CPA tools (UltraTax CS, Lacerte, ProConnect, Drake)
 *
 * UltraTax CS / Lacerte / ProConnect / Drake do not have documented public
 * import APIs. Common interchange formats:
 *   - .GEN files (legacy "1040 generic" import — most universal)
 *   - DataLink (CCH proprietary, Thomson Reuters owns CCH)
 *   - CSV with field-coded columns
 *
 * Our CSV is structured for easy mapping: each row is one Form 1040 line,
 * with both our field name and the IRS line reference, plus a column for
 * the CPA software field code (currently UltraTax format).
 */

import type { ComputedTaxReturn } from "./taxReturnPipeline";

type Client = {
  firstName: string;
  lastName: string;
  email: string;
  filingStatus: string;
  state: string;
  taxYear: number;
  dependentsUnder17?: number | null;
  otherDependents?: number | null;
};

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "MFJ",
  married_filing_separately: "MFS",
  head_of_household: "HoH",
  qualifying_widow: "QW",
};

// Map our internal field names → UltraTax CS field codes (approximate; CPAs
// should validate against current UltraTax version). Sources: legacy "1040
// generic tax data" import format documentation.
const ULTRATAX_FIELD_CODES: Record<string, string> = {
  totalIncome: "1040-L9",
  adjustedGrossIncome: "1040-L11",
  standardDeduction: "1040-L12",
  itemizedDeductions: "1040-L12A",
  qbiDeduction: "1040-L13",
  taxableIncome: "1040-L15",
  federalTaxLiability: "1040-L16",
  federalTaxWithheld: "1040-L25A",
  federalRefundOrOwed: "1040-L34",
  stateTaxLiability: "STATE-TAX",
  stateTaxWithheld: "STATE-WH",
  stateRefundOrOwed: "STATE-REFUND",
  selfEmploymentTax: "SE-L12",
  niitTax: "8960-L17",
  amtTax: "6251-L11",
  childTaxCredit_appliedCredit: "1040-L19",
  additionalChildTaxCredit: "8812-L27",
  capitalGainsTax: "QDCG-L24",
  // Phase 1 line items
  scheduleCExpenses: "SCH-C-L28",
  hsaDeduction: "1040-S1-L13",
  iraDeduction: "1040-S1-L20",
  eitc_appliedCredit: "1040-L27",
  aocCredit: "8863-L8",
  llcCredit: "8863-L19",
  saversCredit: "8880-L12",
  dependentCareCredit: "2441-L11",
  medicalDeductible: "SCH-A-L4",
  saltDeductible: "SCH-A-L7",
  mortgageDeductible: "SCH-A-L10",
  charitableDeductible: "SCH-A-L14",
  // Phase 1.5
  educatorExpensesDeduction: "1040-S1-L11",
  studentLoanInterestDeduction: "1040-S1-L21",
  foreignTaxCredit: "1116-L33",
  residentialEnergyCredits: "5695-COMBINED",
  premiumTaxCredit: "8962-L26",
  // Phase 2b/2e
  capitalLossDeducted: "SCH-D-L21",
  netCapitalGainLoss: "SCH-D-L16",
  scheduleERentalAppliedToAgi: "SCH-E-L26",
};

interface ExportRow {
  /** Our internal field name */
  field: string;
  /** Human-readable Form 1040 / Schedule line reference */
  irsLine: string;
  /** UltraTax CS / Lacerte / ProConnect field code */
  ultraTaxCode: string;
  /** Display label */
  label: string;
  /** Numeric value */
  value: number;
}

/**
 * Build a flat list of all relevant tax return values mapped to IRS line
 * references and CPA software field codes. Used by CSV/JSON exports.
 */
function buildExportRows(ret: ComputedTaxReturn): ExportRow[] {
  const rows: ExportRow[] = [];

  function add(field: string, irsLine: string, label: string, value: number) {
    if (value == null || !Number.isFinite(value)) return;
    rows.push({
      field,
      irsLine,
      ultraTaxCode: ULTRATAX_FIELD_CODES[field] ?? "",
      label,
      value,
    });
  }

  // Form 1040 main flow
  add("totalIncome", "1040 Line 9", "Total Income", ret.totalIncome);
  add("adjustedGrossIncome", "1040 Line 11", "Adjusted Gross Income (AGI)", ret.adjustedGrossIncome);
  add("standardDeduction", "1040 Line 12", "Standard Deduction", ret.standardDeduction);
  if (ret.itemizedDeductions != null) add("itemizedDeductions", "1040 Line 12 (itemized)", "Itemized Deductions (Schedule A)", ret.itemizedDeductions);
  add("qbiDeduction", "1040 Line 13", "QBI Deduction (§199A)", ret.qbiDeduction);
  add("taxableIncome", "1040 Line 15", "Taxable Income", ret.taxableIncome);
  add("federalTaxLiability", "1040 Line 24", "Total Federal Tax Liability", ret.federalTaxLiability);
  add("federalTaxWithheld", "1040 Line 25a", "Federal Tax Withheld", ret.federalTaxWithheld);
  add("federalRefundOrOwed", "1040 Line 34 / 37", "Federal Refund or Owed", ret.federalRefundOrOwed);

  // State
  add("stateTaxLiability", "State Return", "State Tax Liability", ret.stateTaxLiability);
  add("stateTaxWithheld", "State Return", "State Tax Withheld", ret.stateTaxWithheld);
  add("stateRefundOrOwed", "State Return", "State Refund or Owed", ret.stateRefundOrOwed);

  // Federal components
  if (ret.selfEmploymentTax > 0) add("selfEmploymentTax", "Sched SE Line 12", "Self-Employment Tax", ret.selfEmploymentTax);
  if (ret.niitTax > 0) add("niitTax", "Form 8960 Line 17", "Net Investment Income Tax (NIIT)", ret.niitTax);
  if (ret.amtTax > 0) add("amtTax", "Form 6251 Line 11", "Alternative Minimum Tax (AMT)", ret.amtTax);
  if (ret.capitalGainsTax > 0) add("capitalGainsTax", "QDCG Worksheet", "Capital Gains Tax (LTCG/QDIV)", ret.capitalGainsTax);

  // Credits
  if (ret.childTaxCredit.appliedCredit > 0) add("childTaxCredit_appliedCredit", "1040 Line 19", "Child Tax Credit (Form 8812)", ret.childTaxCredit.appliedCredit);
  if (ret.additionalChildTaxCredit > 0) add("additionalChildTaxCredit", "Form 8812 Line 27", "Additional Child Tax Credit (refundable)", ret.additionalChildTaxCredit);
  if (ret.eitc.appliedCredit > 0) add("eitc_appliedCredit", "1040 Line 27", "Earned Income Credit (EITC)", ret.eitc.appliedCredit);

  // Phase 1 deductions
  if (ret.scheduleCExpenses > 0) add("scheduleCExpenses", "Schedule C Line 28", "Schedule C Business Expenses", ret.scheduleCExpenses);
  if (ret.retirementDeductions.hsaDeductible > 0) add("hsaDeduction", "Sched 1 Line 13", "HSA Deduction", ret.retirementDeductions.hsaDeductible);
  if (ret.retirementDeductions.iraDeductible > 0) add("iraDeduction", "Sched 1 Line 20", "Traditional IRA Deduction", ret.retirementDeductions.iraDeductible);

  // Schedule A
  if (ret.scheduleA.medicalDeductible > 0) add("medicalDeductible", "Sched A Line 4", "Medical (Schedule A)", ret.scheduleA.medicalDeductible);
  if (ret.scheduleA.saltDeductible > 0) add("saltDeductible", "Sched A Line 7", "SALT capped (Schedule A)", ret.scheduleA.saltDeductible);
  if (ret.scheduleA.mortgageDeductible > 0) add("mortgageDeductible", "Sched A Line 10", "Mortgage Interest (Schedule A)", ret.scheduleA.mortgageDeductible);
  if (ret.scheduleA.charitableDeductible > 0) add("charitableDeductible", "Sched A Line 14", "Charitable Deduction (Schedule A)", ret.scheduleA.charitableDeductible);

  // Phase 1 credits
  if (ret.educationCredits.aocApplied > 0) add("aocCredit", "Form 8863 Line 8", "American Opportunity Credit", ret.educationCredits.aocApplied);
  if (ret.educationCredits.llcApplied > 0) add("llcCredit", "Form 8863 Line 19", "Lifetime Learning Credit", ret.educationCredits.llcApplied);
  if (ret.saversCredit.appliedCredit > 0) add("saversCredit", "Form 8880 Line 12", "Saver's Credit", ret.saversCredit.appliedCredit);
  if (ret.dependentCareCredit.appliedCredit > 0) add("dependentCareCredit", "Form 2441 Line 11", "Dependent Care Credit", ret.dependentCareCredit.appliedCredit);

  // Phase 1.5
  if (ret.educatorExpenses.deductible > 0) add("educatorExpensesDeduction", "Sched 1 Line 11", "Educator Expenses Deduction", ret.educatorExpenses.deductible);
  if (ret.studentLoanInterest.deductible > 0) add("studentLoanInterestDeduction", "Sched 1 Line 21", "Student Loan Interest Deduction", ret.studentLoanInterest.deductible);
  if (ret.foreignTaxCredit.credit > 0) add("foreignTaxCredit", "Form 1116 Line 33", "Foreign Tax Credit", ret.foreignTaxCredit.credit);
  if (ret.residentialEnergyCredits.total > 0) add("residentialEnergyCredits", "Form 5695 (combined)", "Residential Energy Credits", ret.residentialEnergyCredits.total);
  if (ret.premiumTaxCredit.netPtc !== 0) add("premiumTaxCredit", "Form 8962 Line 26", "Net Premium Tax Credit (or repayment if negative)", ret.premiumTaxCredit.netPtc);

  // Phase 2
  if (ret.capitalLossDeducted > 0) add("capitalLossDeducted", "Sched D Line 21", "Capital Loss Deducted ($3k/$1.5k cap)", ret.capitalLossDeducted);
  if (ret.netCapitalGainLoss !== 0) add("netCapitalGainLoss", "Sched D Line 16", "Net Capital Gain/Loss (post-netting)", ret.netCapitalGainLoss);
  if (ret.scheduleERentalAppliedToAgi !== 0) add("scheduleERentalAppliedToAgi", "Sched E Line 26 (net of PAL)", "Schedule E Rental Net Applied to AGI", ret.scheduleERentalAppliedToAgi);

  return rows;
}

// ── JSON export ─────────────────────────────────────────────────────────────

export function buildTaxReturnJsonExport(client: Client, ret: ComputedTaxReturn): string {
  const exportObject = {
    metadata: {
      taxYear: ret.taxYear,
      filingStatus: FILING_STATUS_LABELS[client.filingStatus] ?? client.filingStatus,
      state: client.state,
      generatedAt: new Date().toISOString(),
      generatedBy: "TaxFlow Assistant",
      formatVersion: "1.0",
    },
    client: {
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      dependentsUnder17: client.dependentsUnder17 ?? 0,
      otherDependents: client.otherDependents ?? 0,
    },
    formData: buildExportRows(ret),
    /** Full computed result for downstream tools that want everything */
    fullResult: ret,
  };
  return JSON.stringify(exportObject, null, 2);
}

// ── CSV export (UltraTax-friendly) ──────────────────────────────────────────
// CSV format: one row per Form 1040 line, with columns:
//   IRS Line | Field Name | Description | UltraTax Code | Value
// Designed for easy CPA review and mapping to UltraTax CS, Lacerte, ProConnect,
// Drake. The UltraTax Code column maps to "1040 Generic Tax Data" format codes.

function csvEscape(s: string | number): string {
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildTaxReturnCsvExport(client: Client, ret: ComputedTaxReturn): string {
  const rows = buildExportRows(ret);
  const lines: string[] = [];

  // Header metadata as comments
  lines.push(`# TaxFlow Assistant — Tax Return Export`);
  lines.push(`# Client: ${csvEscape(client.firstName + " " + client.lastName)}`);
  lines.push(`# Email: ${csvEscape(client.email)}`);
  lines.push(`# Filing Status: ${FILING_STATUS_LABELS[client.filingStatus] ?? client.filingStatus}`);
  lines.push(`# State: ${client.state}`);
  lines.push(`# Tax Year: ${ret.taxYear}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Format: 1040 Generic Tax Data CSV (UltraTax CS / Lacerte / ProConnect / Drake)`);
  lines.push("");

  // Column header
  lines.push("IRS Line,Field Name,Description,UltraTax Code,Value");

  // Data rows
  for (const r of rows) {
    lines.push([
      csvEscape(r.irsLine),
      csvEscape(r.field),
      csvEscape(r.label),
      csvEscape(r.ultraTaxCode),
      csvEscape(r.value.toFixed(2)),
    ].join(","));
  }

  return lines.join("\n");
}

// ── UltraTax-specific .GEN-style export ──────────────────────────────────────
// The .GEN format (1040 Generic Tax Data) is a simple key=value text format
// used by various CPA tax preparation tools. Each line is FIELD_CODE=VALUE.
// This is the most universal CPA software interchange format.

export function buildUltraTaxGenExport(client: Client, ret: ComputedTaxReturn): string {
  const rows = buildExportRows(ret);
  const lines: string[] = [];

  // Header metadata (some .GEN consumers expect specific metadata block)
  lines.push(`[META]`);
  lines.push(`CLIENT_FIRST_NAME=${client.firstName}`);
  lines.push(`CLIENT_LAST_NAME=${client.lastName}`);
  lines.push(`CLIENT_EMAIL=${client.email}`);
  lines.push(`FILING_STATUS=${FILING_STATUS_LABELS[client.filingStatus] ?? client.filingStatus}`);
  lines.push(`STATE=${client.state}`);
  lines.push(`TAX_YEAR=${ret.taxYear}`);
  lines.push(`DEPENDENTS_UNDER_17=${client.dependentsUnder17 ?? 0}`);
  lines.push(`OTHER_DEPENDENTS=${client.otherDependents ?? 0}`);
  lines.push(`GENERATED_BY=TaxFlow Assistant`);
  lines.push(`GENERATED_AT=${new Date().toISOString()}`);
  lines.push("");
  lines.push(`[1040]`);

  for (const r of rows) {
    if (!r.ultraTaxCode) continue;
    lines.push(`${r.ultraTaxCode}=${r.value.toFixed(2)}`);
  }

  return lines.join("\n");
}
