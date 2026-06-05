/**
 * Form 2210 — Underpayment of Estimated Tax by Individuals (IRC §6654).
 *
 * Source: IRS Form 2210 (2024/2025) + Instructions, and §6654.
 *
 * What this computes (and what it deliberately does NOT):
 *   - The EXACT, statutorily-stable core: the **required annual payment**
 *     (the estimated-tax safe-harbor target) and whether a §6654 penalty
 *     applies. This is the number CPAs use daily ("the client must have paid
 *     at least $X via withholding + estimates to avoid a penalty"). Part I of
 *     Form 2210.
 *   - An APPROXIMATE penalty-dollar estimate. The modern Form 2210 dropped the
 *     old single-factor "short method"; the penalty is now a per-quarter
 *     worksheet that needs the exact DATE each estimated payment was made —
 *     data this engine does not track. So the penalty $ here is a clearly-
 *     labeled estimate: the underpayment spread evenly across the four
 *     quarterly installments (25% each), outstanding until the April 15 filing
 *     deadline, at the year's flat §6654 underpayment rate (≈ 8 months / a
 *     2/3-of-year average). The exact penalty is the CPA's filing-software
 *     regular-method computation.
 *
 * Required annual payment (§6654(d)) = the SMALLER of:
 *   (a) 90% of the current-year tax, OR
 *   (b) 100% of the prior-year tax — 110% if prior-year AGI > $150,000
 *       ($75,000 if MFS). (b) is available only when the prior year was a full
 *       12-month year with a filed return.
 * No penalty (§6654(e)) when: the prior year had ZERO tax liability (full-year
 * citizen/resident), OR current-year tax minus withholding is under $1,000.
 *
 * Rendered as a CPA-quality substitute PDF via pdfkit (Pub 1167), mirroring the
 * Form 4868 builder.
 */
import PDFDocument from "pdfkit";
import type { ComputedTaxReturn } from "./taxReturnEngine";
import type { clientsTable } from "@workspace/db";
import { SUPPORTED_TAX_YEARS, type TaxYear } from "./taxYears";

type Client = typeof clientsTable.$inferSelect;

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_widow: "Qualifying Widow(er)",
};

/**
 * Flat §6654 underpayment interest rate per tax year (IRS quarterly rates were
 * uniform within each of these years: 8% across all of 2024, 7% across all of
 * 2025). Null = not yet published (penalty $ estimate omitted; safe-harbor
 * target still computed). YEAR-INDEXED — add a year here once the IRS publishes
 * its quarterly underpayment rates (Rev. Rul. under §6621).
 */
const SECTION_6654_ANNUAL_RATE: Record<TaxYear, number | null> = {
  2024: 0.08,
  2025: 0.07,
  2026: null,
};

/** §6654(d)(1)(C) — prior-year AGI above this makes the prior-year safe harbor
 *  110% instead of 100% (halved for MFS). */
const PRIOR_YEAR_110_AGI_THRESHOLD = 150_000;
/** §6654(e)(1) — no penalty when current tax minus withholding is under this. */
const UNDERPAYMENT_DE_MINIMIS = 1_000;
/** Approximate fraction-of-year the underpayment is outstanding when the four
 *  25% installments (due 4/15, 6/15, 9/15, 1/15) sit until the 4/15 filing
 *  deadline: average ≈ (12+10+7+3)/4 months = 8 months ≈ 2/3 year. */
const PENALTY_OUTSTANDING_FRACTION = 2 / 3;

export interface Form2210Input {
  /**
   * §6654 prior-year total tax (Form 2210 Line 8 base). When omitted, the route
   * derives it from the prior-year tax_returns row. Required for the prior-year
   * safe harbor; without it only the 90%-of-current harbor is usable.
   */
  priorYearTax?: number;
  /** Prior-year AGI — triggers the 110% safe harbor when over the threshold. */
  priorYearAgi?: number;
  /**
   * TRUE when the prior year was a full 12-month year with a filed return (so
   * the prior-year safe harbor + the §6654(e)(2) zero-liability exception
   * apply). Default false = prior year unknown.
   */
  priorYearAvailable?: boolean;
  /** Estimated tax payments NOT already reflected in the return's withholding. */
  estimatedPaymentsAdditional?: number;
}

export type Form2210WaivedReason =
  | "prior_year_zero"
  | "under_1000"
  | "met_safe_harbor"
  | null;

export interface Form2210Result {
  taxYear: number;
  /** Line 4 — current-year tax for §6654 (total tax net of refundable credits). */
  currentYearTax: number;
  /** Line 5 — 90% of current-year tax. */
  ninetyPercentCurrent: number;
  /** Prior-year tax (Line 8 base), or null when not supplied. */
  priorYearTax: number | null;
  /** 1.0 or 1.1 — the multiplier applied to prior-year tax. */
  priorYearSafeHarborPct: number;
  /** pct × prior-year tax (Line 8), or null when no prior-year tax. */
  priorYearSafeHarbor: number | null;
  /** Line 6 — tax paid through withholding. */
  withholding: number;
  /** CPA-supplied estimated payments not already in the return. */
  estimatedPayments: number;
  /** withholding + estimatedPayments. */
  totalPaid: number;
  /** Line 9 — required annual payment (the estimated-tax safe-harbor target). */
  requiredAnnualPayment: number;
  /** max(0, requiredAnnualPayment − totalPaid). */
  underpayment: number;
  /** Additional payment that would reach the safe harbor (= underpayment). */
  additionalToSafeHarbor: number;
  /** TRUE when a §6654 penalty applies. */
  penaltyApplies: boolean;
  /** When no penalty, which rule waived it. */
  penaltyWaivedReason: Form2210WaivedReason;
  /** Approximate §6654 penalty (null when penaltyApplies but the year's rate is
   *  unpublished; 0 when no penalty). See the module docstring for the method. */
  estimatedPenalty: number | null;
  /** The flat §6654 annual rate used for the estimate (null if unpublished). */
  penaltyRateUsed: number | null;
}

/**
 * Compute Form 2210 / §6654 from a computed return.
 *
 * Line 4 (current-year tax) is derived from the engine's own components so it
 * is exactly the total tax (income tax after nonrefundable credits, PLUS SE /
 * AMT / NIIT / Additional Medicare / excess-APTC) MINUS the refundable credits
 * §6654 treats as payments (ACTC, refundable AOC, EITC, net PTC). This mirrors
 * `taxReturnEngine`'s refund identity exactly.
 */
export function computeForm2210(args: { ret: ComputedTaxReturn; input?: Form2210Input }): Form2210Result {
  const { ret, input = {} } = args;
  const round = (n: number): number => Math.round(n);
  const taxYear = ret.taxYear;

  // Line 4 — §6654 current-year tax.
  const refundableCredits =
    ret.additionalChildTaxCredit +
    ret.educationCredits.aocRefundable +
    ret.eitc.appliedCredit +
    Math.max(0, ret.premiumTaxCredit.netPtc);
  const currentYearTax = Math.max(
    0,
    round(ret.federalTaxLiability - ret.totalNonRefundableApplied - refundableCredits),
  );

  const withholding = Math.max(0, round(ret.federalTaxWithheld));
  const estimatedPayments = Math.max(0, round(input.estimatedPaymentsAdditional ?? 0));
  const totalPaid = withholding + estimatedPayments;

  // Line 5 — 90% of current-year tax.
  const ninetyPercentCurrent = round(0.9 * currentYearTax);

  // Line 8 — prior-year safe harbor (100%, or 110% over the AGI threshold).
  const mfs = ret.filingStatus === "married_filing_separately";
  const agiThreshold = mfs ? PRIOR_YEAR_110_AGI_THRESHOLD / 2 : PRIOR_YEAR_110_AGI_THRESHOLD;
  const priorYearAvailable = input.priorYearAvailable === true && input.priorYearTax != null;
  const priorYearTax = priorYearAvailable ? Math.max(0, round(input.priorYearTax as number)) : null;
  const priorYearSafeHarborPct =
    priorYearAvailable && input.priorYearAgi != null && input.priorYearAgi > agiThreshold ? 1.1 : 1.0;
  const priorYearSafeHarbor =
    priorYearTax != null ? round(priorYearSafeHarborPct * priorYearTax) : null;

  // Line 9 — required annual payment = smaller of (90% current) or (prior-year
  // safe harbor). Without prior-year data, only the 90%-current harbor is usable.
  const requiredAnnualPayment =
    priorYearSafeHarbor != null
      ? Math.min(ninetyPercentCurrent, priorYearSafeHarbor)
      : ninetyPercentCurrent;

  // Exceptions (no penalty), checked in §6654(e) order:
  const priorYearZeroException = priorYearAvailable && priorYearTax === 0;
  const under1000Exception = currentYearTax - withholding < UNDERPAYMENT_DE_MINIMIS;
  const metSafeHarbor = totalPaid >= requiredAnnualPayment;

  let penaltyApplies = false;
  let penaltyWaivedReason: Form2210WaivedReason = null;
  if (priorYearZeroException) penaltyWaivedReason = "prior_year_zero";
  else if (under1000Exception) penaltyWaivedReason = "under_1000";
  else if (metSafeHarbor) penaltyWaivedReason = "met_safe_harbor";
  else penaltyApplies = true;

  const additionalToSafeHarbor = Math.max(0, requiredAnnualPayment - totalPaid);
  const underpayment = penaltyApplies ? additionalToSafeHarbor : 0;

  // Year-indexed, but tolerant of an out-of-range stored taxYear: only a
  // SUPPORTED year reads the table (TY2026 is intentionally null = rate not yet
  // published); anything else yields null (penalty-$ estimate omitted) rather
  // than a stale clamp to another year's rate.
  const penaltyRateUsed: number | null = (SUPPORTED_TAX_YEARS as readonly number[]).includes(taxYear)
    ? SECTION_6654_ANNUAL_RATE[taxYear as TaxYear]
    : null;
  let estimatedPenalty: number | null;
  if (!penaltyApplies) estimatedPenalty = 0;
  else if (penaltyRateUsed != null) {
    estimatedPenalty = round(underpayment * penaltyRateUsed * PENALTY_OUTSTANDING_FRACTION);
  } else estimatedPenalty = null;

  return {
    taxYear,
    currentYearTax,
    ninetyPercentCurrent,
    priorYearTax,
    priorYearSafeHarborPct,
    priorYearSafeHarbor,
    withholding,
    estimatedPayments,
    totalPaid,
    requiredAnnualPayment,
    underpayment,
    additionalToSafeHarbor,
    penaltyApplies,
    penaltyWaivedReason,
    estimatedPenalty,
    penaltyRateUsed,
  };
}

function fmtCurrency(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const WAIVED_REASON_LABELS: Record<NonNullable<Form2210WaivedReason>, string> = {
  prior_year_zero: "No penalty — the prior year had no tax liability (§6654(e)(2)).",
  under_1000: "No penalty — current-year tax minus withholding is under $1,000 (§6654(e)(1)).",
  met_safe_harbor: "No penalty — payments met the required annual payment (safe harbor).",
};

export interface BuildForm2210PdfOptions {
  client: Client;
  ret: ComputedTaxReturn;
  form: Form2210Result;
}

/**
 * Render a CPA-quality Form 2210 substitute PDF (Part I — Required Annual
 * Payment + the safe-harbor analysis + the approximate penalty).
 */
export function buildForm2210Pdf(options: BuildForm2210PdfOptions): Promise<Buffer> {
  const { client, form } = options;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "letter", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ──────────────────────────────────────────────────────────
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Form 2210", { continued: true })
      .font("Helvetica")
      .text("    Underpayment of Estimated Tax by Individuals", { continued: false });
    doc.fontSize(11).text("IRC §6654  ·  Required Annual Payment & Safe-Harbor Target");
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

    // ── Verdict banner ──────────────────────────────────────────────────
    const bannerTop = doc.y;
    const verdictColor = form.penaltyApplies ? "#a31515" : "#0a5d2a";
    doc.rect(54, bannerTop, 504, 44).lineWidth(0.5).strokeColor(verdictColor).stroke();
    doc
      .fontSize(11)
      .fillColor(verdictColor)
      .font("Helvetica-Bold")
      .text(
        form.penaltyApplies
          ? `Underpayment penalty APPLIES — estimated ${fmtCurrency(form.estimatedPenalty)}`
          : "No underpayment penalty",
        64,
        bannerTop + 7,
      );
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#444")
      .text(
        form.penaltyApplies
          ? `Pay ${fmtCurrency(form.additionalToSafeHarbor)} more (withholding + estimates) to reach the ${fmtCurrency(form.requiredAnnualPayment)} safe-harbor target and avoid the penalty.`
          : (form.penaltyWaivedReason ? WAIVED_REASON_LABELS[form.penaltyWaivedReason] : ""),
        64,
        bannerTop + 24,
        { width: 484 },
      );
    doc.y = bannerTop + 52;
    doc.moveDown(0.5);

    // ── Part I — Required Annual Payment ────────────────────────────────
    doc.fontSize(11).fillColor("#000").font("Helvetica-Bold").text("Part I — Required Annual Payment");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#222");
    moneyLine(doc, "Current-year tax for §6654 (net of refundable credits)", form.currentYearTax);
    moneyLine(doc, "90% of current-year tax", form.ninetyPercentCurrent);
    moneyLine(
      doc,
      `Prior-year safe harbor (${Math.round(form.priorYearSafeHarborPct * 100)}% of ${fmtCurrency(form.priorYearTax)})`,
      form.priorYearSafeHarbor ?? 0,
    );
    moneyLine(doc, "Required annual payment (safe-harbor target)", form.requiredAnnualPayment, true);
    doc.moveDown(0.4);

    // ── Payments & shortfall ────────────────────────────────────────────
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#000").text("Payments & shortfall");
    doc.moveDown(0.3);
    doc.fontSize(10).font("Helvetica").fillColor("#222");
    moneyLine(doc, "Tax paid through withholding", form.withholding);
    moneyLine(doc, "Estimated tax payments (additional)", form.estimatedPayments);
    moneyLine(doc, "Total paid", form.totalPaid);
    moneyLine(doc, "Underpayment (target − total paid)", form.underpayment, form.penaltyApplies);
    moneyLine(
      doc,
      `Approximate §6654 penalty${form.penaltyRateUsed != null ? ` (≈ underpayment × ${(form.penaltyRateUsed * 100).toFixed(0)}% × ⅔)` : ""}`,
      form.estimatedPenalty ?? 0,
      form.penaltyApplies,
    );
    doc.moveDown(0.6);

    // ── Footnotes ───────────────────────────────────────────────────────
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#000").text("How these values were computed");
    doc.moveDown(0.2);
    doc.fontSize(8).font("Helvetica").fillColor("#555");
    doc.text(
      "Required annual payment (§6654(d)) = smaller of 90% of current-year tax OR the prior-year safe harbor (100% of prior-year tax, 110% if prior-year AGI > $150,000 / $75,000 MFS). No penalty when the prior year had zero tax liability, or current-year tax minus withholding is under $1,000.",
      { width: 504 },
    );
    doc.moveDown(0.2);
    doc.text(
      "The penalty dollar amount is an ESTIMATE: the underpayment spread evenly across the four quarterly installments and outstanding until the April 15 filing deadline, at the year's flat §6654 underpayment rate. The exact penalty depends on the date each estimated payment was actually made (Form 2210 regular-method worksheet) — verify in your filing software before relying on the figure.",
      { width: 504 },
    );

    doc.end();
  });
}

// ── Layout helper ──────────────────────────────────────────────────────
function moneyLine(
  doc: PDFKit.PDFDocument,
  label: string,
  amount: number,
  emphasis = false,
): void {
  const y = doc.y;
  doc.font("Helvetica").fillColor("#444").fontSize(10).text(label, 54, y, { width: 360 });
  doc
    .font("Helvetica-Bold")
    .fillColor(emphasis ? "#a31515" : "#000")
    .fontSize(emphasis ? 11 : 10)
    .text(fmtCurrency(amount), 420, y, { width: 138, align: "right" });
  doc.fontSize(10);
  doc.moveDown(0.25);
}
