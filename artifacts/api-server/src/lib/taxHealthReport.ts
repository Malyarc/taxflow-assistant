/**
 * G-7 — Annual "Tax Health Report".
 *
 * The branded artifact a CPA attaches to every delivered return. It assembles
 * — from already-computed engine output — a single client-facing health
 * snapshot:
 *   • this year vs last (the year-over-year line deltas, reused verbatim from
 *     `computeYearOverYear` — this module NEVER re-derives YoY math),
 *   • the thresholds the client crossed (NIIT / Additional Medicare / AMT /
 *     §199A phase-in / refund→owed / IRMAA — also straight from the YoY pass),
 *   • a carryforward INVENTORY (the engine's *-Remaining / *Carryforward output
 *     fields rolled into next year — NOL, capital-loss ST/LT, charitable,
 *     §163(j) business-interest, AMT credit, passive-activity §469, FTC, QBI
 *     loss, adoption, §25D energy, R&D/GBC, §179), and
 *   • the next-year planning calendar (deadline-grouped, via
 *     `buildPlanningCalendar`) plus the headline planning savings.
 *
 * PURE & Haven-portable: NO Date / Math.random / DB / fs / network / process.
 * `preparedDate` is a caller-supplied string parameter (the route passes
 * "today"); the engine output it reads is itself deterministic.
 *
 * The report computes NO tax. Its `totalTax` is recovered from the engine's own
 * already-computed effective rate (totalTax = effectiveTaxRate × totalIncome,
 * the inverse of the engine identity at taxReturnEngine.ts:4832) so the number
 * ties out to the engine to the cent; the report's headline `effectiveTaxRate`
 * is then re-expressed over AGI (the client-facing convention) — distinct from
 * the engine's income-based rate, and clearly labeled as such.
 */

import PDFDocument from "pdfkit";
import type { OpportunityHit } from "@workspace/planning-strategies";
import type { ComputedTaxReturn } from "./taxReturnEngine";
import { computeYearOverYear, type ThresholdCrossing } from "./yearOverYear";
import { buildPlanningCalendar, type PlanningCalendar } from "./planningCalendar";
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

const PAGE_BOTTOM = 720; // letter height 792 − ~72 margin

// ── Types ────────────────────────────────────────────────────────────────

export interface CarryforwardInventoryItem {
  /** Stable machine key, e.g. "capital_loss_short". */
  kind: string;
  /** Client-readable label for the report row. */
  label: string;
  /** Dollar amount rolling into next year (always > 0 — zero items are omitted). */
  amount: number;
  /** One-line plain-English note on what it is / how it's used next year. */
  note: string;
}

export interface TaxHealthReport {
  taxYear: number;
  priorYear: number;
  /** Total tax burden ÷ AGI (client-facing convention). 0 when AGI ≤ 0. */
  effectiveTaxRate: number;
  /** The prior year's AGI-based effective rate, on the same basis. */
  priorEffectiveTaxRate: number;
  /** Total tax burden (federal incl. other taxes − credits + net state + mandate). */
  totalTax: number;
  /** Combined federal + state refund (positive) or amount owed (negative). */
  refundOrOwed: number;
  agi: number;
  /** The full year-over-year comparison (reused verbatim — not re-derived). */
  yoy: ReturnType<typeof computeYearOverYear>;
  /** The threshold crossings surfaced this year (lifted from `yoy`). */
  thresholdsCrossed: ThresholdCrossing[];
  /** Carryforwards rolling into next year (only items with amount > 0). */
  carryforwardInventory: CarryforwardInventoryItem[];
  /** The planning headline — top opportunities + total potential savings. */
  planningHeadline: {
    topStrategies: Array<{ name: string; savings: number }>;
    totalPotentialSavings: number;
  };
  /** Deadline-grouped, soonest-first planning calendar for next year. */
  calendar: PlanningCalendar;
  /** Plain-English caveats / assumptions the report rests on. */
  assumptions: string[];
}

// ── Carryforward inventory ─────────────────────────────────────────────────

/** The engine carryforward-remaining fields we surface, in display order. */
const CARRYFORWARD_SPECS: Array<{
  kind: string;
  label: string;
  /** Reads the magnitude off the computed return (already floored ≥ 0 by the engine). */
  pick: (r: ComputedTaxReturn) => number;
  note: string;
}> = [
  {
    kind: "nol",
    label: "Net operating loss (NOL)",
    pick: (r) => r.nolCarryforwardRemaining,
    note: "Offsets up to 80% of next year's taxable income (IRC §172(a)(2)).",
  },
  {
    kind: "capital_loss_short",
    label: "Short-term capital loss",
    pick: (r) => r.capitalLossCarryforwardShort,
    note: "Nets against next year's gains first; up to $3,000 ($1,500 MFS) offsets ordinary income.",
  },
  {
    kind: "capital_loss_long",
    label: "Long-term capital loss",
    pick: (r) => r.capitalLossCarryforwardLong,
    note: "Nets against next year's gains, preserving long-term character (Pub 550).",
  },
  {
    kind: "charitable_cash",
    label: "Charitable contribution (cash)",
    pick: (r) => r.charitableCarryforwardCashRemaining,
    note: "Excess over the 60%-of-AGI cap; deductible over the next 5 years (IRC §170(d)(1)).",
  },
  {
    kind: "section_163j_business_interest",
    label: "Business interest (§163(j))",
    pick: (r) => r.section163jDisallowedCarryforward,
    note: "Disallowed business interest, carried forward indefinitely (IRC §163(j)).",
  },
  {
    kind: "amt_credit",
    label: "AMT minimum-tax credit (§53)",
    pick: (r) => r.amtCreditCarryforwardRemaining,
    note: "Recovers prior AMT against future regular tax (Form 8801).",
  },
  {
    kind: "amt_nol",
    label: "AMT-basis NOL (ATNOLD)",
    pick: (r) => r.amtNolCarryforwardRemaining,
    note: "Offsets up to 90% of future AMTI (IRC §56(d)).",
  },
  {
    kind: "passive_activity_loss",
    label: "Passive activity loss (§469, rental)",
    pick: (r) => r.scheduleEPassiveLossSuspended,
    note: "Suspended rental loss; released against passive income or on a full disposition (§469).",
  },
  {
    kind: "k1_passive_loss",
    label: "K-1 passive loss (§469)",
    pick: (r) => r.scheduleK1.k1PassiveLossSuspended,
    note: "Suspended K-1 passive loss; released against passive income or on disposition (§469).",
  },
  {
    kind: "k1_basis_at_risk_loss",
    label: "K-1 basis / at-risk loss (§704(d)/§465)",
    pick: (r) => r.scheduleK1.k1BasisAtRiskLossSuspended,
    note: "K-1 loss disallowed by basis or at-risk limits; released as basis/at-risk is restored.",
  },
  {
    kind: "foreign_tax_credit",
    label: "Foreign tax credit (§904(c))",
    pick: (r) => r.foreignTaxCreditCarryforwardRemaining,
    note: "Excess foreign tax over the §904 limit; carried forward up to 10 years.",
  },
  {
    kind: "qbi_loss",
    label: "Qualified-business loss (§199A)",
    pick: (r) => r.qbiLossCarryforward,
    note: "Negative QBI carried to next year, reducing the future §199A deduction (§199A(c)(2)).",
  },
  {
    kind: "adoption_credit",
    label: "Adoption credit (§23)",
    pick: (r) => r.adoptionCreditCarryforwardRemaining,
    note: "Unused nonrefundable adoption credit; carried forward up to 5 years (§23(c)).",
  },
  {
    kind: "residential_clean_energy",
    label: "Residential clean energy credit (§25D)",
    pick: (r) => r.residentialCleanEnergyCarryforward,
    note: "Unused §25D credit carried forward (IRC §25D(c)).",
  },
  {
    kind: "rd_credit",
    label: "R&D credit (§41 / §39)",
    pick: (r) => r.rdCreditCarryforwardRemaining,
    note: "§41 credit disallowed by the §38 limit; carried forward (§39).",
  },
  {
    kind: "general_business_credit",
    label: "General business credit (§51/§45S, §39)",
    pick: (r) => r.otherGeneralBusinessCreditCarryforward,
    note: "WOTC / FMLA credit disallowed by the §38 limit; carried forward (§39).",
  },
  {
    kind: "section_179",
    label: "§179 expense election",
    pick: (r) => r.section179Carryforward,
    note: "§179 elected over the business-income limit; carried forward (IRC §179(b)(3)(B)).",
  },
];

/**
 * Roll the computed return's carryforward-remaining fields into an inventory.
 * Only items with amount > 0 are included (a return with no carryforwards →
 * an empty array). Each amount is a magnitude (the engine floors them ≥ 0).
 */
export function buildCarryforwardInventory(r: ComputedTaxReturn): CarryforwardInventoryItem[] {
  const items: CarryforwardInventoryItem[] = [];
  for (const spec of CARRYFORWARD_SPECS) {
    const raw = spec.pick(r);
    const amount = Number.isFinite(raw) ? raw : 0;
    if (amount > 0.005) {
      items.push({ kind: spec.kind, label: spec.label, amount, note: spec.note });
    }
  }
  return items;
}

// ── Report assembly ─────────────────────────────────────────────────────────

function headlineSavings(h: OpportunityHit): number {
  return h.verifiedSavings ?? h.estSavings;
}

/**
 * Recover the engine's total tax burden from its own already-computed
 * effective rate (totalTax = effectiveTaxRate × totalIncome — the exact inverse
 * of the engine identity). Ties to the cent without re-summing components; 0
 * when the engine itself reported a 0 rate (sub-$1 income guard).
 */
function totalTaxBurdenOf(r: ComputedTaxReturn): number {
  return r.effectiveTaxRate * r.totalIncome;
}

/**
 * Build the annual Tax Health Report from a prior + current computed return,
 * the planning hits, and the tax year.
 */
export function buildTaxHealthReport(args: {
  priorReturn: ComputedTaxReturn;
  currentReturn: ComputedTaxReturn;
  /** Whether the prior year had year-scoped documents (forwarded to YoY caveats). */
  priorYearScopedDocsPresent: boolean;
  hits: OpportunityHit[];
  taxYear: number;
}): TaxHealthReport {
  const { priorReturn, currentReturn, priorYearScopedDocsPresent, hits, taxYear } = args;

  const yoy = computeYearOverYear({ priorReturn, currentReturn, priorYearScopedDocsPresent });

  const totalTax = totalTaxBurdenOf(currentReturn);
  const priorTotalTax = totalTaxBurdenOf(priorReturn);

  const agi = currentReturn.adjustedGrossIncome;
  const priorAgi = priorReturn.adjustedGrossIncome;
  // Client-facing effective rate over AGI (guard AGI ≤ 0 → 0).
  const effectiveTaxRate = agi > 0 ? totalTax / agi : 0;
  const priorEffectiveTaxRate = priorAgi > 0 ? priorTotalTax / priorAgi : 0;

  const refundOrOwed = currentReturn.federalRefundOrOwed + currentReturn.stateRefundOrOwed;

  const carryforwardInventory = buildCarryforwardInventory(currentReturn);

  // Planning headline — rank by the headline savings (verified ?? estimate),
  // floored at 0 so a "cost" strategy (e.g. Roth conversion) never subtracts.
  const ranked = [...hits].sort((a, b) => headlineSavings(b) - headlineSavings(a));
  const topStrategies = ranked.slice(0, 5).map((h) => ({
    name: h.name,
    savings: Math.max(0, headlineSavings(h)),
  }));
  const totalPotentialSavings = ranked.reduce((s, h) => s + Math.max(0, headlineSavings(h)), 0);

  // Next-year planning calendar (deadline-grouped, soonest-first).
  const calendar = buildPlanningCalendar(hits, taxYear);

  const assumptions: string[] = [
    "Effective tax rate is expressed as total tax burden divided by adjusted gross income (AGI).",
    "Total tax burden is the engine's federal liability (including self-employment, NIIT, Additional Medicare, and AMT) net of credits, plus net state tax and any state coverage-mandate penalty.",
    "Carryforward amounts are the balances rolling into the next tax year, as computed by the return engine.",
    "Planning savings are deterministic engine estimates of federal + state impact under current law; your CPA validates eligibility before anything is implemented.",
  ];
  // Surface the YoY data-quality caveats (e.g. no prior-year documents) verbatim.
  for (const c of yoy.caveats) assumptions.push(c);

  return {
    taxYear,
    priorYear: priorReturn.taxYear,
    effectiveTaxRate,
    priorEffectiveTaxRate,
    totalTax,
    refundOrOwed,
    agi,
    yoy,
    thresholdsCrossed: yoy.thresholdCrossings,
    carryforwardInventory,
    planningHeadline: { topStrategies, totalPotentialSavings },
    calendar,
    assumptions,
  };
}

// ── PDF deliverable ─────────────────────────────────────────────────────────

/** Three ascending rounded bars — the BrandMark, in vector. */
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

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Signed whole-dollar string ("+$1,234" / "-$1,234"). */
function signedUsd(n: number): string {
  const v = Math.round(n);
  return (v >= 0 ? "+" : "-") + usd(Math.abs(v));
}

/**
 * Render the branded Tax Health Report PDF: a cover, "This year vs last", the
 * thresholds crossed, the carryforward inventory, the planning calendar, and
 * the opportunity list. `preparedDate` is caller-supplied (deterministic).
 */
export function buildTaxHealthReportPdf(args: {
  report: TaxHealthReport;
  clientFirstName: string;
  clientLastName: string;
  preparedDate: string;
  firmName?: string;
}): Promise<Buffer> {
  const { report, clientFirstName, clientLastName, preparedDate } = args;
  const firmName = args.firmName ?? "Your CPA team";
  const fullName = `${clientFirstName} ${clientLastName}`;

  return new Promise((resolve, reject) => {
    const doc = winAnsiSafePdf(new PDFDocument({ size: "letter", margin: 54, bufferPages: true })); // M5 WinAnsi glyph seam
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Cover ────────────────────────────────────────────────────────────
    doc.rect(0, 0, 612, 240).fill(TRUSTED_BLUE);
    drawBrandMark(doc, 54, 48, 1.2);
    doc.fontSize(26).font("Helvetica-Bold").fillColor("#ffffff").text("Tax Health Report", 54, 120);
    doc.fontSize(13).font("Helvetica").fillColor("#c7d6f0")
      .text(`${fullName} · Tax year ${report.taxYear}`, 54, 156);
    doc.fontSize(10).fillColor("#9fb3d8")
      .text(`Prepared ${preparedDate} by ${firmName}`, 54, 178);

    // Headline stat tiles.
    doc.y = 270;
    const refundLabel = report.refundOrOwed >= 0 ? "Combined refund" : "Combined balance due";
    doc.fontSize(11).font("Helvetica").fillColor(MUTED).text("Effective tax rate (of AGI)", 54, doc.y);
    doc.fontSize(30).font("Helvetica-Bold").fillColor(TRUSTED_BLUE).text(pct(report.effectiveTaxRate), 54, doc.y + 2);
    const rateDelta = report.effectiveTaxRate - report.priorEffectiveTaxRate;
    doc.fontSize(10).font("Helvetica").fillColor(MUTED).text(
      `${pct(report.priorEffectiveTaxRate)} last year (${rateDelta >= 0 ? "+" : ""}${(rateDelta * 100).toFixed(1)} pts)`,
      54, doc.y + 4,
    );
    doc.moveDown(0.8);
    doc.fontSize(11).font("Helvetica").fillColor(MUTED).text(`Total tax · AGI · ${refundLabel}`, 54, doc.y);
    doc.fontSize(13).font("Helvetica-Bold").fillColor(INK)
      .text(`${usd(report.totalTax)}    ${usd(report.agi)}    `, 54, doc.y + 2, { continued: true })
      .fillColor(report.refundOrOwed >= 0 ? SUCCESS : "#b91c1c")
      .text(usd(Math.abs(report.refundOrOwed)));

    // ── This year vs last ──────────────────────────────────────────────────
    sectionHeading(doc, "This year vs last");
    doc.fontSize(9).font("Helvetica-Bold").fillColor(MUTED)
      .text("Line", 54, doc.y, { width: 240, continued: true })
      .text(`TY${report.priorYear}`, { width: 90, align: "right", continued: true })
      .text(`TY${report.taxYear}`, { width: 90, align: "right", continued: true })
      .text("Change", { width: 84, align: "right" });
    doc.moveDown(0.2);
    for (const d of report.yoy.deltas) {
      ensureRoom(doc, 16);
      const isRate = d.label === "Effective tax rate";
      const fmtVal = (v: number) => (isRate ? pct(v) : usd(v));
      doc.fontSize(9).font("Helvetica").fillColor(INK)
        .text(d.label, 54, doc.y, { width: 240, continued: true })
        .fillColor(MUTED).text(fmtVal(d.prior), { width: 90, align: "right", continued: true })
        .text(fmtVal(d.current), { width: 90, align: "right", continued: true })
        .fillColor(Math.abs(d.change) < (isRate ? 0.0005 : 0.5) ? MUTED : INK)
        .text(isRate ? `${d.change >= 0 ? "+" : ""}${(d.change * 100).toFixed(1)} pts` : signedUsd(d.change), {
          width: 84,
          align: "right",
        });
    }

    // ── Thresholds you crossed ─────────────────────────────────────────────
    sectionHeading(doc, "Thresholds you crossed");
    if (report.thresholdsCrossed.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor(MUTED)
        .text("No new tax thresholds were crossed this year.", 54, doc.y, { width: 504 });
    } else {
      for (const t of report.thresholdsCrossed) {
        ensureRoom(doc, 44);
        doc.fontSize(10.5).font("Helvetica-Bold").fillColor(t.direction === "entered" ? "#b45309" : SUCCESS)
          .text(`${t.direction === "entered" ? "Entered" : "Exited"}: ${t.label}`, 54, doc.y, { width: 504 });
        doc.fontSize(9).font("Helvetica").fillColor(INK).text(t.detail, 54, doc.y + 1, { width: 504 });
        doc.moveDown(0.5);
      }
    }

    // ── Carryforwards into next year ───────────────────────────────────────
    sectionHeading(doc, "Carryforwards into next year");
    if (report.carryforwardInventory.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor(MUTED)
        .text("No tax attributes carry forward into next year.", 54, doc.y, { width: 504 });
    } else {
      for (const item of report.carryforwardInventory) {
        ensureRoom(doc, 30);
        doc.fontSize(10.5).font("Helvetica-Bold").fillColor(INK)
          .text(item.label, 54, doc.y, { width: 380, continued: true })
          .fillColor(TRUSTED_BLUE).text(usd(item.amount), { width: 124, align: "right" });
        doc.fontSize(8.5).font("Helvetica").fillColor(MUTED).text(item.note, 54, doc.y + 1, { width: 504 });
        doc.moveDown(0.4);
      }
    }

    // ── Your planning calendar ─────────────────────────────────────────────
    sectionHeading(doc, "Your planning calendar");
    if (report.calendar.groups.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor(MUTED)
        .text("No time-sensitive planning actions identified for next year.", 54, doc.y, { width: 504 });
    } else {
      for (const g of report.calendar.groups) {
        ensureRoom(doc, 34 + g.strategies.length * 14);
        doc.fontSize(11).font("Helvetica-Bold").fillColor(INK)
          .text(g.label + (g.isoDate ? ` — ${g.isoDate}` : ""), 54, doc.y, { continued: true })
          .fillColor(SUCCESS).text(`   ${usd(g.totalSavings)}`);
        for (const s of g.strategies) {
          doc.fontSize(9.5).font("Helvetica").fillColor(MUTED)
            .text(`• ${s.name} (${usd(s.verifiedSavings ?? s.estSavings)})`, 66, doc.y + 1, { width: 480 });
        }
        doc.moveDown(0.5);
      }
    }

    // ── Opportunities ──────────────────────────────────────────────────────
    sectionHeading(doc, "Opportunities");
    if (report.planningHeadline.topStrategies.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor(MUTED).text(
        "Our planning engine found no additional savings opportunities on the current data.",
        54, doc.y, { width: 504 },
      );
    } else {
      doc.fontSize(11).font("Helvetica").fillColor(MUTED)
        .text("Estimated annual tax-saving opportunities identified", 54, doc.y);
      doc.fontSize(26).font("Helvetica-Bold").fillColor(SUCCESS)
        .text(usd(report.planningHeadline.totalPotentialSavings), 54, doc.y + 2);
      doc.moveDown(0.4);
      for (const s of report.planningHeadline.topStrategies) {
        ensureRoom(doc, 18);
        doc.fontSize(10.5).font("Helvetica-Bold").fillColor(INK)
          .text(s.name, 54, doc.y, { width: 400, continued: true })
          .fillColor(SUCCESS).text(usd(s.savings), { width: 104, align: "right" });
      }
    }

    // ── How to read these numbers ──────────────────────────────────────────
    sectionHeading(doc, "How to read these numbers");
    doc.fontSize(9).font("Helvetica").fillColor(INK).text(
      "Every dollar figure in this report is the deterministic output of our tax-rule engine run against your actual return data — " +
        "no figure is AI-generated. All amounts are estimates of federal + state impact based on current law and the data on file, and " +
        `they change as your facts change. This report is a planning discussion aid, not tax advice, an engagement, or a filed return — ` +
        `your CPA at ${firmName} validates every strategy before anything is implemented.`,
      54, doc.y, { width: 504 },
    );
    for (const a of report.assumptions) {
      ensureRoom(doc, 14);
      doc.fontSize(8.5).font("Helvetica-Oblique").fillColor(MUTED).text(`• ${a}`, 54, doc.y + 2, { width: 504 });
    }

    applyBrandFooters(doc, (i, count) =>
      `${firmName} · Tax Health Report · ${fullName} · TY${report.taxYear} · page ${i + 1} of ${count}`,
    );

    doc.end();
  });
}
