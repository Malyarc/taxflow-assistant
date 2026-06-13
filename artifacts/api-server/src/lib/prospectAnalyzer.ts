/**
 * G-2 — Second-Look Prospect Analyzer (PURE + Haven-portable).
 *
 * Lead-gen funnel: a firm uploads a PROSPECT's prior-year Form 1040, we map a
 * handful of 1040 lines into the engine's `TaxReturnInputs`, run
 * `computeTaxReturnPure`, run the planning detector, and assemble a deterministic
 * branded "missed savings" teaser to book a consultation. The person is NOT a
 * stored client — nothing here persists and nothing calls an LLM or OCR.
 *
 * PURITY CONTRACT (Haven migration interface): this module is byte-for-byte
 * deterministic. NO `Date`/`new Date()`/`Math.random`/DB/fs/network/`process`,
 * and NO OCR or LLM call. `preparedDate` is a caller-supplied STRING parameter
 * so the PDF stays deterministic.
 *
 * THE KEY SEAM (do NOT implement here): the live product OCRs a 1040 PDF into a
 * structured `ProspectReturnInput`. That PDF→fields extraction (Textract / a
 * vision LLM / a manual form) lives in the ROUTE/ADAPTER layer, behind the
 * §7216 consent gate. This module computes over the ALREADY-PARSED structured
 * input — so it ports 1:1 into Haven and is trivially unit-testable.
 *
 * The math philosophy mirrors the planning engine: the LLM never touches a
 * number. Every dollar figure here is engine output or a sum of detector
 * `verifiedSavings ?? estSavings`. Any AI polish of the teaser prose is a
 * route-layer concern, not this module's.
 */

import PDFDocument from "pdfkit";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type W2Fact,
  type Form1099Fact,
  type AdjustmentFact,
  type ClientFacts,
} from "./taxReturnEngine";
import { evaluatePlanningOpportunities } from "./planningEngine";
import type { OpportunityHit } from "@workspace/planning-strategies";
import {
  TRUSTED_BLUE,
  BRAND_BLUE,
  GOLD,
  SUCCESS,
  INK,
  MUTED,
  usd,
  applyBrandFooters,
  winAnsiSafePdf,
} from "./pdfBrand";

// ── Input: the handful of Form 1040 lines a teaser needs ────────────────────

/**
 * A structured, already-parsed prior-year Form 1040 (the OCR adapter's output).
 *
 * Only the lines that move a planning teaser are modeled — this is deliberately
 * a small surface, NOT a full return. Everything is best-effort: if a field is
 * absent it maps to nothing (no W-2, no 1099, no adjustment). Dollar fields are
 * plain numbers (the adapter has already stripped "$"/","), matching the
 * client-deliverable convention.
 */
export interface ProspectReturnInput {
  /** Engine filing-status string: "single" | "married_filing_jointly" |
   *  "married_filing_separately" | "head_of_household" |
   *  "qualifying_surviving_spouse". */
  filingStatus: string;
  /** 2-letter resident state code (drives state tax + state planning). */
  state?: string | null;
  /** The tax year of the uploaded 1040 (e.g. 2024). */
  taxYear: number;
  /** Form 1040 line 1a — wages, salaries, tips. */
  wages?: number;
  /** Schedule B / line 2b — taxable interest. */
  interestIncome?: number;
  /** Line 3b — ordinary dividends. */
  ordinaryDividends?: number;
  /** Line 3a — qualified dividends (a subset of ordinaryDividends, LTCG-rated). */
  qualifiedDividends?: number;
  /** Line 7 — net capital gain/loss (Schedule D). Best-effort: a single 1040
   *  line cannot tell us the ST/LT split — we treat it as long-term (see
   *  mapping notes). A loss may be negative. */
  capitalGains?: number;
  /** Schedule 1 line 3 — net Schedule C / self-employment profit. */
  scheduleCNet?: number;
  /** Line 4b/5b — taxable IRA + pension/annuity distributions. */
  iraDistributions?: number;
  /** Line 6a — total Social Security benefits (SSA-1099 box 5). */
  socialSecurityBenefits?: number;
  /** Line 11 — adjusted gross income, as reported on the filed 1040. */
  reportedAgi?: number;
  /** Line 15 — taxable income, as reported. */
  reportedTaxableIncome?: number;
  /** Line 22 (+ line 23 other taxes) — total tax, as reported. The recompute
   *  difference compares OUR engine's total tax against this. */
  reportedTotalTax?: number;
  /** Schedule A total itemized deductions, when the prospect itemized. When set,
   *  mapped through the engine's legacy single-number itemized fallback. Absent
   *  → the engine auto-picks the standard deduction. */
  itemizedDeductions?: number;
}

// ── Mapping: ProspectReturnInput → TaxReturnInputs ──────────────────────────

const TAXPAYER = "taxpayer" as const;

function pos(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/**
 * Best-effort map of the structured 1040 lines onto the engine's input shape.
 *
 * Each choice below is the closest faithful representation a teaser needs — NOT
 * a full reconstruction of the original return (we don't have the source forms).
 * The cross-check tests prove this mapping reproduces the engine's AGI/total-tax
 * for the mapped inputs (i.e. `analyzeProspect` and an independent
 * `computeTaxReturnPure(mapProspectToInputs(p))` agree to the cent).
 *
 * Mapping choices:
 *   - wages              → ONE W-2 (Box 1 = Box 3 = Box 5 = wages; taxpayer).
 *                          Box 3/5 default to Box 1 so SE-wage-base sharing and
 *                          Additional-Medicare math behave like a normal W-2.
 *   - interestIncome     → a 1099-INT (Box 1).
 *   - ordinary/qualified
 *     dividends          → a 1099-DIV (ordinary + qualified boxes; qualified is
 *                          a subset that the engine taxes at preferential rates).
 *   - capitalGains       → a `long_term_capital_gain` ADJUSTMENT. A single 1040
 *                          line 7 carries no ST/LT split, so we route it through
 *                          the engine's general LTCG lever, which feeds Schedule D
 *                          netting (the $3k offset + carryforward), AGI, the
 *                          preferential-rate calc, and the §1411 NIIT base. A
 *                          loss flows in negative and cross-nets. (Sub-gap: a
 *                          short-term prospect gain is modeled as long-term, so
 *                          our tax can be lower than reported — surfaced honestly
 *                          as a "preliminary recompute difference," never as
 *                          "you overpaid".)
 *   - scheduleCNet       → a `self_employment_income` ADJUSTMENT (taxpayer). This
 *                          is THE field that carries SE income: it drives Sch C
 *                          net, SE tax, the SE above-the-line deduction, and QBI.
 *   - iraDistributions   → a 1099-R (gross = taxable; no §72(t) code → no early
 *                          penalty; the teaser doesn't model basis/QCD).
 *   - socialSecurity     → client.socialSecurityBenefits (Pub 915 taxability).
 *   - itemizedDeductions → existingItemizedFallback (the engine's legacy
 *                          single-number itemized path; it auto-picks max(that,
 *                          standard deduction)).
 *
 * Everything is opt-in: a field left undefined maps to nothing.
 */
export function mapProspectToInputs(p: ProspectReturnInput): TaxReturnInputs {
  const taxYear = p.taxYear;

  const w2s: W2Fact[] = [];
  if (pos(p.wages) > 0) {
    const wages = pos(p.wages);
    w2s.push({
      taxYear,
      employerName: "Prospect employer",
      wagesBox1: wages,
      socialSecurityWagesBox3: wages,
      medicareWagesBox5: wages,
      stateCode: p.state ?? null,
      spouse: TAXPAYER,
    });
  }

  const form1099s: Form1099Fact[] = [];
  if (pos(p.interestIncome) > 0) {
    form1099s.push({
      taxYear,
      formType: "int",
      payerName: "Prospect interest payer",
      interestIncome: pos(p.interestIncome),
    });
  }
  if (pos(p.ordinaryDividends) > 0 || pos(p.qualifiedDividends) > 0) {
    form1099s.push({
      taxYear,
      formType: "div",
      payerName: "Prospect dividend payer",
      ordinaryDividends: pos(p.ordinaryDividends),
      // Qualified is a subset of ordinary; clamp so a malformed input where
      // qualified > ordinary can't over-claim preferential-rate income.
      qualifiedDividends: Math.min(pos(p.qualifiedDividends), pos(p.ordinaryDividends)),
    });
  }
  if (pos(p.iraDistributions) > 0) {
    form1099s.push({
      taxYear,
      formType: "r",
      payerName: "Prospect retirement payer",
      grossDistribution: pos(p.iraDistributions),
      taxableAmount: pos(p.iraDistributions),
    });
  }

  const adjustments: AdjustmentFact[] = [];
  if (pos(p.scheduleCNet) !== 0 && typeof p.scheduleCNet === "number" && Number.isFinite(p.scheduleCNet)) {
    adjustments.push({
      adjustmentType: "self_employment_income",
      amount: p.scheduleCNet,
      isApplied: true,
      spouse: TAXPAYER,
    });
  }
  // capitalGains may legitimately be negative (a net loss) — only skip an exact 0.
  if (typeof p.capitalGains === "number" && Number.isFinite(p.capitalGains) && p.capitalGains !== 0) {
    adjustments.push({
      adjustmentType: "long_term_capital_gain",
      amount: p.capitalGains,
      isApplied: true,
    });
  }

  const client: ClientFacts = {
    filingStatus: p.filingStatus,
    state: p.state ?? null,
    taxYear,
    socialSecurityBenefits: pos(p.socialSecurityBenefits),
  };

  const inputs: TaxReturnInputs = {
    client,
    w2s,
    form1099s,
    adjustments,
    taxYear,
  };
  if (typeof p.itemizedDeductions === "number" && Number.isFinite(p.itemizedDeductions) && p.itemizedDeductions > 0) {
    inputs.existingItemizedFallback = p.itemizedDeductions;
  }
  return inputs;
}

// ── Analysis output ─────────────────────────────────────────────────────────

export interface ProspectAnalysis {
  taxYear: number;
  /** AGI our engine computed from the mapped inputs (Form 1040 line 11). */
  ourAgi: number;
  /** Total federal tax our engine computed (the engine's comprehensive
   *  federalTaxLiability — income tax + SE + NIIT + Add'l-Medicare + AMT +
   *  other taxes, before refundable payment-side credits). */
  ourTotalTax: number;
  /** The prospect's reported total tax (1040 line 22+23), or null if not provided. */
  reportedTotalTax: number | null;
  /**
   * reported − ours. POSITIVE = we computed LESS tax than the prospect reported
   * — a recompute-DIFFERENCE flag, clearly framed as PRELIMINARY. This is NOT a
   * claim that the prospect overpaid; the mapping is best-effort and a full
   * review is required. null when no reported total tax was supplied.
   */
  recomputeDifference: number | null;
  /** Planning opportunities the detector matched, in client language. */
  opportunities: Array<{ strategyId: string; name: string; estSavings: number; rationale: string }>;
  /** Sum of the headline savings across all opportunities. */
  totalPotentialSavings: number;
  /** Deterministic teaser headline (a template string — never LLM-derived). */
  headline: string;
  /** Plain-English disclosures (preliminary, no-engagement estimate). */
  disclosures: string[];
}

/** Headline savings for a hit = engine-verified when present, else the estimate. */
function headlineSavings(h: OpportunityHit): number {
  return h.verifiedSavings ?? h.estSavings;
}

/** Whole-dollar, comma-grouped, no cents (e.g. 12345.67 → "12,346"). */
function wholeDollars(n: number): string {
  return Math.round(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * The standing, deterministic disclosures. Every teaser carries these verbatim
 * so the legal framing is consistent: preliminary, no engagement, document-based.
 */
function buildDisclosures(hasReportedTax: boolean): string[] {
  const out = [
    "This is a PRELIMINARY, no-engagement estimate prepared from the documents you provided. " +
      "It is not tax advice, an engagement, an audit, or a filed or amended return.",
    "Every dollar figure is the deterministic output of our tax-rule engine run against the figures " +
      "we extracted from your prior-year return — no figure is AI-generated, and your full return was " +
      "not reconstructed. Amounts are estimates of federal + state impact under current law and change as your facts change.",
    "Eligibility, documentation, and interaction effects for each strategy must be confirmed by a CPA in a " +
      "full engagement before anything is implemented.",
  ];
  if (hasReportedTax) {
    out.push(
      "Any “recompute difference” shown is a preliminary comparison between our engine's figure and the total " +
        "tax on the return you provided. It is NOT a finding that you overpaid or are owed a refund — differences are " +
        "expected from a document-based estimate and require a full review to evaluate.",
    );
  }
  return out;
}

/**
 * Map → compute → detect → assemble. Pure: same input → same ProspectAnalysis.
 */
export function analyzeProspect(p: ProspectReturnInput): ProspectAnalysis {
  const inputs = mapProspectToInputs(p);
  const computed = computeTaxReturnPure(inputs);

  // Reuse the firm-grade planning detector. It takes the SAME deterministic
  // engine output a stored client would; baselineInputs enables engine-verified
  // what-if deltas (verifiedSavings) on the detectors that support them.
  const hits = evaluatePlanningOpportunities({
    client: inputs.client,
    computed,
    adjustments: inputs.adjustments,
    baselineInputs: inputs,
  });

  const opportunities = hits
    .map((h) => ({
      strategyId: h.strategyId,
      name: h.name,
      estSavings: headlineSavings(h),
      rationale: h.rationale,
    }))
    .sort((a, b) => b.estSavings - a.estSavings);

  const totalPotentialSavings = opportunities.reduce((s, o) => s + o.estSavings, 0);

  const ourAgi = computed.adjustedGrossIncome;
  const ourTotalTax = computed.federalTaxLiability;
  const reportedTotalTax =
    typeof p.reportedTotalTax === "number" && Number.isFinite(p.reportedTotalTax) ? p.reportedTotalTax : null;
  const recomputeDifference = reportedTotalTax != null ? reportedTotalTax - ourTotalTax : null;

  const headline =
    totalPotentialSavings > 0
      ? `We identified $${wholeDollars(totalPotentialSavings)} in potential tax-saving opportunities for TY${p.taxYear}.`
      : `Your TY${p.taxYear} return looks well-optimized — let's confirm with a full review.`;

  return {
    taxYear: p.taxYear,
    ourAgi,
    ourTotalTax,
    reportedTotalTax,
    recomputeDifference,
    opportunities,
    totalPotentialSavings,
    headline,
    disclosures: buildDisclosures(reportedTotalTax != null),
  };
}

// ── Branded teaser PDF ───────────────────────────────────────────────────────

const PAGE_BOTTOM = 720; // letter height 792 − ~72 margin

/** Three ascending rounded bars — the BrandMark, in vector (mirrors planningReportPdf). */
function drawBrandMark(doc: PDFKit.PDFDocument, x: number, y: number, scale = 1): void {
  const w = 10 * scale;
  const gap = 6 * scale;
  const heights = [18 * scale, 30 * scale, 42 * scale];
  const colors = [BRAND_BLUE, "#8ED4F0", GOLD];
  heights.forEach((h, i) => {
    doc.roundedRect(x + i * (w + gap), y + (heights[2] - h), w, h, 2 * scale).fill(colors[i]);
  });
}

function ensureRoom(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE_BOTTOM) doc.addPage();
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string): void {
  ensureRoom(doc, 60);
  doc.moveDown(0.8);
  doc.fontSize(15).font("Helvetica-Bold").fillColor(TRUSTED_BLUE).text(title, 54, doc.y);
  doc.moveTo(54, doc.y + 2).lineTo(558, doc.y + 2).lineWidth(1.5).strokeColor(BRAND_BLUE).stroke();
  doc.moveDown(0.6);
}

/**
 * A branded one-to-two-page prospect teaser: the headline savings, the top
 * opportunities in client language, a clear "Book a consultation" CTA, and the
 * disclosures. No PII beyond the supplied name. `preparedDate` is caller-
 * supplied so the renderer stays deterministic (no `new Date()`).
 */
export function buildProspectTeaserPdf(args: {
  analysis: ProspectAnalysis;
  prospectName: string;
  preparedDate: string;
  firmName?: string;
}): Promise<Buffer> {
  const { analysis, prospectName, preparedDate } = args;
  const firmName = args.firmName ?? "Our firm";
  const opps = [...analysis.opportunities].sort((a, b) => b.estSavings - a.estSavings);

  return new Promise((resolve, reject) => {
    const doc = winAnsiSafePdf(new PDFDocument({ size: "letter", margin: 54, bufferPages: true })); // M5 WinAnsi glyph seam
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Cover ────────────────────────────────────────────────────────────
    doc.rect(0, 0, 612, 230).fill(TRUSTED_BLUE);
    drawBrandMark(doc, 54, 44, 1.2);
    doc.fontSize(25).font("Helvetica-Bold").fillColor("#ffffff").text("Your Second-Look Tax Review", 54, 116);
    doc.fontSize(13).font("Helvetica").fillColor("#c7d6f0").text(`${prospectName} · Tax year ${analysis.taxYear}`, 54, 150);
    doc.fontSize(10).fillColor("#9fb3d8").text(`Prepared ${preparedDate} by ${firmName}`, 54, 172);

    // ── Headline ──────────────────────────────────────────────────────────
    doc.y = 258;
    if (analysis.totalPotentialSavings > 0) {
      doc.fontSize(11).font("Helvetica").fillColor(MUTED).text("Estimated tax-saving opportunities we identified", 54, doc.y);
      doc.fontSize(34).font("Helvetica-Bold").fillColor(SUCCESS).text(usd(analysis.totalPotentialSavings), 54, doc.y + 4);
      doc.fontSize(11).font("Helvetica").fillColor(INK).text(
        `across ${opps.length} strateg${opps.length === 1 ? "y" : "ies"} our planning engine matched to your TY${analysis.taxYear} return. ` +
          "A short consultation turns these into a concrete plan.",
        54,
        doc.y + 8,
        { width: 504 },
      );
    } else {
      doc.fontSize(12).font("Helvetica").fillColor(INK).text(
        analysis.headline +
          " Our engine did not surface additional savings on the figures provided, but a full review often finds opportunities the documents alone don't show.",
        54,
        doc.y,
        { width: 504 },
      );
    }

    // ── Top opportunities (client language) ────────────────────────────────
    if (opps.length > 0) {
      sectionHeading(doc, "What we found");
      opps.slice(0, 6).forEach((o, idx) => {
        ensureRoom(doc, 52);
        const y0 = doc.y + 6;
        doc.fontSize(11.5).font("Helvetica-Bold").fillColor(TRUSTED_BLUE).text(`${idx + 1}. ${o.name}`, 62, y0, { width: 352 });
        const afterName = doc.y;
        doc.fontSize(12.5).font("Helvetica-Bold").fillColor(SUCCESS).text(usd(o.estSavings), 422, y0, { width: 130, align: "right" });
        doc.y = Math.max(afterName, doc.y) + 4;
        doc.fontSize(9.5).font("Helvetica").fillColor(INK).text(o.rationale, 62, doc.y, { width: 488 });
        doc.moveDown(0.7);
      });
    }

    // ── Preliminary recompute note (carefully framed) ──────────────────────
    if (analysis.recomputeDifference != null && analysis.reportedTotalTax != null) {
      sectionHeading(doc, "A figure worth a closer look");
      const diff = analysis.recomputeDifference;
      const body =
        diff > 0
          ? `Our preliminary recomputation of your TY${analysis.taxYear} federal tax differs from the total tax on the return you provided ` +
            `by about ${usd(Math.abs(diff))}. This is NOT a finding that you overpaid — it is exactly the kind of difference a document-based ` +
            "estimate produces, and it is worth a full review to understand."
          : diff < 0
            ? `Our preliminary recomputation lands within about ${usd(Math.abs(diff))} of the total tax on the return you provided — ` +
              "close enough that nothing jumps out, though a full review confirms the details."
            : "Our preliminary recomputation matches the total tax on the return you provided. A full review confirms the details.";
      doc.fontSize(9.5).font("Helvetica").fillColor(INK).text(body, 54, doc.y, { width: 504 });
    }

    // ── CTA ─────────────────────────────────────────────────────────────────
    ensureRoom(doc, 90);
    doc.moveDown(0.8);
    const ctaY = doc.y;
    doc.roundedRect(54, ctaY, 504, 64, 8).fill(BRAND_BLUE);
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#ffffff").text("Book a consultation", 70, ctaY + 14);
    doc.fontSize(10.5).font("Helvetica").fillColor("#ffffff").text(
      `Bring your most recent return and let ${firmName} walk you through these opportunities and what they mean for you.`,
      70,
      ctaY + 38,
      { width: 472 },
    );
    doc.y = ctaY + 76;

    // ── Disclosures ───────────────────────────────────────────────────────
    sectionHeading(doc, "Important — how to read this");
    for (const d of analysis.disclosures) {
      ensureRoom(doc, 34);
      doc.fontSize(8.5).font("Helvetica").fillColor(MUTED).text(`• ${d}`, 54, doc.y, { width: 504 });
      doc.moveDown(0.3);
    }

    applyBrandFooters(
      doc,
      (i, count) => `${firmName} · Second-Look Tax Review · ${prospectName} · TY${analysis.taxYear} · page ${i + 1} of ${count}`,
    );

    doc.end();
  });
}
