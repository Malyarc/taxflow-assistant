/**
 * Phase H — H6: Form 8606 — Nondeductible IRAs.
 *
 * Source: IRS Form 8606 (2024). Required whenever:
 *   (1) Taxpayer makes nondeductible contributions to a Traditional IRA
 *       (Part I).
 *   (2) Taxpayer converts a Traditional/SEP/SIMPLE IRA to a Roth (Part II) —
 *       the IRS allows tax-free recovery of any after-tax basis on a
 *       pro-rata basis with the pre-tax portion (IRC §408(d)(2)).
 *   (3) Taxpayer takes a distribution from a Roth IRA in a year when
 *       basis tracking matters (Part III) — not the common case.
 *
 * The §408(d)(2) pro-rata rule:
 *
 *   When ALL of the client's traditional/SEP/SIMPLE IRAs are aggregated,
 *   any distribution (including a Roth conversion) is treated as coming
 *   PROPORTIONALLY from after-tax basis vs pre-tax money. You cannot
 *   "cherry-pick" the after-tax portion.
 *
 *   excludedAmount  = conversion × (afterTaxBasis / totalIraBalanceAtYearEnd_plusConversion)
 *   taxableAmount   = conversion − excludedAmount
 *
 *   Engine model: we use year-end balance INCLUDING the converted amount
 *   as Form 8606 instructs (the "fraction" denominator is line 6 + line 8).
 *
 * This module is a PURE engine library. No DB, no I/O. The DB-backed
 * route handler reads asset balances + adjustments and calls these
 * functions.
 */

import PDFDocument from "pdfkit";
import type { clientsTable } from "@workspace/db";

type Client = typeof clientsTable.$inferSelect;

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_widow: "Qualifying Widow(er)",
};

// ── Math primitives (pure) ─────────────────────────────────────────────────

export interface Form8606ProRataInputs {
  /** Total Roth conversion amount this tax year (across all IRAs being converted). */
  conversionAmount: number;
  /** Aggregate Dec 31 balance of ALL Traditional + SEP + SIMPLE IRAs
   *  (BEFORE the conversion is removed). */
  totalTraditionalIraBalance: number;
  /** Total after-tax basis across all Traditional IRAs (Form 8606 Line 2 +
   *  Line 3 + ... carryforward). */
  totalAfterTaxBasis: number;
  /** Nondeductible contribution made FOR this tax year (Form 8606 Line 1). */
  nondeductibleContribution: number;
  /** Other distributions (non-conversion) from the IRA this year. */
  otherDistributions?: number;
}

export interface Form8606ProRataResult {
  /** Line 2 — Total basis carried into this year (from prior Form 8606 Line 14). */
  priorBasis: number;
  /** Line 1 — Nondeductible contribution this year. */
  nondeductibleContribution: number;
  /** Line 3 — Total basis available this year (Line 1 + Line 2). */
  totalBasisAvailable: number;
  /** Line 4 — Distributions + conversions during the year. */
  distributionsAndConversions: number;
  /** Line 6 — Dec 31 IRA balance (after all transactions). */
  yearEndBalance: number;
  /** Line 7 — Distributions only (not conversions). */
  otherDistributions: number;
  /** Line 8 — Roth conversion amount. */
  conversionAmount: number;
  /**
   * Line 10 (effective pro-rata fraction) — the % of distributions
   * representing tax-free recovery of basis.
   */
  proRataFraction: number;
  /** Line 11 — Tax-free portion of the Roth conversion (basis recovered). */
  excludedAmount: number;
  /** Line 17 + 18 — Taxable amount of the Roth conversion. */
  taxableAmount: number;
  /** Line 14 — Total basis remaining for next year's Form 8606 carryforward. */
  basisCarryforward: number;
  /** Quick percentage display. */
  excludedFractionPct: number;
}

/**
 * Compute the §408(d)(2) pro-rata split. Handles edge cases:
 * - No basis → 100% taxable
 * - Conversion exceeds yearEnd+distributions → cap fraction at 1
 * - Zero balance → no conversion possible, returns all zero
 */
export function computeForm8606ProRata(
  inputs: Form8606ProRataInputs,
): Form8606ProRataResult {
  const nondeductibleContribution = Math.max(0, inputs.nondeductibleContribution);
  const priorBasis = Math.max(0, inputs.totalAfterTaxBasis - nondeductibleContribution);
  const totalBasisAvailable = priorBasis + nondeductibleContribution;
  const conversionAmount = Math.max(0, inputs.conversionAmount);
  const otherDistributions = Math.max(0, inputs.otherDistributions ?? 0);
  const distributionsAndConversions = conversionAmount + otherDistributions;
  const yearEndBalance = Math.max(0, inputs.totalTraditionalIraBalance);

  if (distributionsAndConversions <= 0) {
    return {
      priorBasis,
      nondeductibleContribution,
      totalBasisAvailable,
      distributionsAndConversions: 0,
      yearEndBalance,
      otherDistributions: 0,
      conversionAmount: 0,
      proRataFraction: 0,
      excludedAmount: 0,
      taxableAmount: 0,
      basisCarryforward: totalBasisAvailable,
      excludedFractionPct: 0,
    };
  }

  // Form 8606 Line 10: fraction = Line 3 (basis) / (Line 6 + Line 7 + Line 8)
  // = basis / (yearEndBalance + otherDistributions + conversion)
  const denominator = yearEndBalance + distributionsAndConversions;
  const proRataFraction = denominator > 0 ? Math.min(1, totalBasisAvailable / denominator) : 0;
  // Line 11 — apply fraction to distributions+conversions
  const totalBasisRecovered = distributionsAndConversions * proRataFraction;
  // Pro-rate the recovered basis between conversion and other distributions
  const conversionShare = distributionsAndConversions > 0 ? conversionAmount / distributionsAndConversions : 0;
  const excludedAmount = totalBasisRecovered * conversionShare;
  const taxableAmount = conversionAmount - excludedAmount;
  const basisCarryforward = Math.max(0, totalBasisAvailable - totalBasisRecovered);

  return {
    priorBasis,
    nondeductibleContribution,
    totalBasisAvailable,
    distributionsAndConversions,
    yearEndBalance,
    otherDistributions,
    conversionAmount,
    proRataFraction,
    excludedAmount,
    taxableAmount,
    basisCarryforward,
    excludedFractionPct: proRataFraction * 100,
  };
}

// ── PDF rendering ─────────────────────────────────────────────────────────

function fmt$(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  const abs = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return n < 0 ? `(${abs})` : abs;
}

export interface BuildForm8606PdfOptions {
  client: Client;
  taxYear: number;
  result: Form8606ProRataResult;
}

/** Render a substitute Form 8606 PDF (Pub 1167). */
export function buildForm8606Pdf(options: BuildForm8606PdfOptions): Promise<Buffer> {
  const { client, taxYear, result } = options;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ───────────────────────────────────────────────────────────
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .text("Form 8606", { continued: true })
      .font("Helvetica")
      .text("    Nondeductible IRAs");
    doc.fontSize(11).text(`Tax year ${taxYear}`);
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        `Department of the Treasury — IRS  ·  Generated by TaxFlow Assistant on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. Substitute form per Pub 1167.`,
      );
    doc.moveDown(0.6);

    // Identity block
    doc.fontSize(10).font("Helvetica-Bold").fillColor("#000").text("Taxpayer");
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#222")
      .text(`${client.firstName ?? ""} ${client.lastName ?? ""}`.trim())
      .text(`Filing status: ${FILING_STATUS_LABELS[client.filingStatus] ?? client.filingStatus}`)
      .text(`State: ${client.state ?? "—"}`);
    doc.moveDown(0.8);

    // ── Part I — Nondeductible Contributions to Traditional IRAs ─────────
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Part I — Nondeductible Contributions to Traditional IRAs and Distributions From Traditional, SEP, and SIMPLE IRAs");
    doc.moveDown(0.3);

    const drawLine = (
      label: string,
      value: number,
      lineRef: string,
      bold = false,
    ) => {
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor("#000");
      doc.text(lineRef, 50, y, { width: 30, align: "right" });
      doc.text(label, 90, y, { width: 380 });
      doc.text(fmt$(value), 480, y, { width: 80, align: "right" });
      doc.moveDown(0.25);
    };

    drawLine(
      "Nondeductible contributions to traditional IRAs for the year",
      result.nondeductibleContribution,
      "1",
    );
    drawLine("Total basis in traditional IRAs (prior years carry-in)", result.priorBasis, "2");
    drawLine("Add lines 1 and 2", result.totalBasisAvailable, "3", true);
    drawLine(
      "Distributions + Roth conversions during the year",
      result.distributionsAndConversions,
      "4",
    );
    drawLine("Year-end balance of all traditional IRAs", result.yearEndBalance, "6");
    drawLine("Distributions only (excluding conversions)", result.otherDistributions, "7");
    drawLine("Roth conversions this year", result.conversionAmount, "8", true);
    drawLine(
      "Pro-rata fraction (basis / total relevant balance) — Line 10",
      result.proRataFraction,
      "10",
    );
    drawLine("Tax-free portion of the conversion (Line 11)", result.excludedAmount, "11");
    drawLine("Taxable amount of conversion (Line 17 + 18)", result.taxableAmount, "17/18", true);
    drawLine(
      "Basis carryforward for next year's Form 8606 (Line 14)",
      result.basisCarryforward,
      "14",
      true,
    );

    doc.moveDown(0.8);

    // ── §408(d)(2) note ────────────────────────────────────────────────
    doc.fontSize(9).font("Helvetica-Oblique").fillColor("#555");
    doc.text(
      "§408(d)(2) pro-rata rule: when ALL of the taxpayer's traditional/SEP/SIMPLE IRAs are aggregated, any distribution or conversion is treated as coming proportionally from after-tax basis vs. pre-tax money. You cannot 'cherry-pick' the after-tax portion. The fraction at Line 10 is applied to all distributions + conversions.",
      { width: 510 },
    );
    doc.moveDown(0.5);

    // Headline summary callout
    const calloutY = doc.y;
    doc
      .rect(50, calloutY, 510, 60)
      .lineWidth(1)
      .strokeColor("#0a5d2a")
      .stroke();
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#0a5d2a").text("Conversion summary", 60, calloutY + 6);
    doc.fontSize(10).font("Helvetica").fillColor("#000");
    doc.text(`Conversion amount: ${fmt$(result.conversionAmount)}`, 60, calloutY + 22);
    doc.text(`Tax-free (basis recovered): ${fmt$(result.excludedAmount)}`, 60, calloutY + 36);
    doc.text(`Taxable (added to ordinary income): ${fmt$(result.taxableAmount)}`, 320, calloutY + 22);
    doc.text(`Basis carryforward: ${fmt$(result.basisCarryforward)}`, 320, calloutY + 36);

    doc.end();
  });
}
