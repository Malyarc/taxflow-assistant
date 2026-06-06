/**
 * 1099 sanity checks (P2-12) — box-arithmetic + plausibility flags a CPA should
 * review, mirroring validateW2. Covers the eight supported 1099 types.
 *
 * Shared between server (return diagnostics + a future /1099/flags route) and
 * the frontend review modal.
 */

export type Form1099FlagSeverity = "error" | "warning" | "info";

export interface Form1099Flag {
  /** Field the flag applies to, or null for record-level. */
  field: string | null;
  severity: Form1099FlagSeverity;
  message: string;
}

export interface Form1099DataLike {
  taxYear?: number | null;
  formType?: string | null; // nec | misc | int | div | b | r | g | k
  payerName?: string | null;
  payerTin?: string | null;
  stateCode?: string | null;
  federalTaxWithheld?: number | string | null;
  stateTaxWithheld?: number | string | null;
  // 1099-NEC
  nonemployeeCompensation?: number | string | null;
  // 1099-MISC
  rents?: number | string | null;
  royalties?: number | string | null;
  otherIncome?: number | string | null;
  // 1099-INT
  interestIncome?: number | string | null;
  usTreasuryInterest?: number | string | null;
  taxExemptInterest?: number | string | null;
  earlyWithdrawalPenalty?: number | string | null;
  // 1099-DIV
  ordinaryDividends?: number | string | null;   // box 1a (total)
  qualifiedDividends?: number | string | null;   // box 1b (subset of 1a)
  totalCapitalGainDistribution?: number | string | null;
  // 1099-B
  proceeds?: number | string | null;
  costBasis?: number | string | null;
  shortTermGainLoss?: number | string | null;
  longTermGainLoss?: number | string | null;
  // 1099-R
  grossDistribution?: number | string | null;
  taxableAmount?: number | string | null;
  distributionCode?: string | null;
  // 1099-G
  unemploymentCompensation?: number | string | null;
  stateLocalRefund?: number | string | null;
  // 1099-K
  grossPaymentAmount?: number | string | null;
}

export interface Form1099ValidationContext {
  clientTaxYear?: number;
  clientState?: string;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/** The income box that "anchors" each 1099 type for withholding plausibility. */
function primaryIncome(rec: Form1099DataLike, type: string): number {
  const n = (v: number | string | null | undefined) => num(v) ?? 0;
  switch (type) {
    case "nec": return n(rec.nonemployeeCompensation);
    case "misc": return n(rec.rents) + n(rec.royalties) + n(rec.otherIncome);
    case "int": return n(rec.interestIncome) + n(rec.usTreasuryInterest);
    case "div": return n(rec.ordinaryDividends) + n(rec.totalCapitalGainDistribution);
    case "b": return Math.max(0, n(rec.proceeds));
    case "r": return n(rec.grossDistribution);
    case "g": return n(rec.unemploymentCompensation) + n(rec.stateLocalRefund);
    case "k": return n(rec.grossPaymentAmount);
    default: return 0;
  }
}

export function validate1099(rec: Form1099DataLike, ctx: Form1099ValidationContext = {}): Form1099Flag[] {
  const flags: Form1099Flag[] = [];
  const type = (rec.formType ?? "").toLowerCase().replace(/^1099-?/, "");

  // ── Year mismatch ────────────────────────────────────────────
  if (ctx.clientTaxYear != null && rec.taxYear != null && rec.taxYear !== ctx.clientTaxYear) {
    flags.push({ field: "taxYear", severity: "warning",
      message: `1099 tax year (${rec.taxYear}) doesn't match the client's tax year (${ctx.clientTaxYear}). The calculator only sums 1099s for the client's current year.` });
  }

  // ── State mismatch ───────────────────────────────────────────
  if (ctx.clientState && rec.stateCode && ctx.clientState.toUpperCase() !== rec.stateCode.toUpperCase()) {
    flags.push({ field: "stateCode", severity: "info",
      message: `1099 state (${rec.stateCode}) differs from the client's state (${ctx.clientState}). Check whether non-resident state tax applies.` });
  }

  // ── Payer TIN format ─────────────────────────────────────────
  if (rec.payerTin) {
    const t = digits(rec.payerTin);
    if (t.length !== 9) {
      flags.push({ field: "payerTin", severity: "warning",
        message: `Payer TIN should be 9 digits (got ${t.length}). Format: XX-XXXXXXX.` });
    }
  }

  // ── Per-type box arithmetic ──────────────────────────────────
  if (type === "div") {
    // Box 1b (qualified) is a SUBSET of box 1a (total ordinary) — can't exceed it.
    const ord = num(rec.ordinaryDividends);
    const qual = num(rec.qualifiedDividends);
    if (ord != null && qual != null && qual > ord + 1) {
      flags.push({ field: "qualifiedDividends", severity: "error",
        message: `Qualified dividends (${fmt(qual)}) exceed total ordinary dividends (${fmt(ord)}). Box 1b is a subset of Box 1a — it cannot be larger.` });
    }
  }

  if (type === "r") {
    // Taxable amount (box 2a) can't exceed gross distribution (box 1).
    const gross = num(rec.grossDistribution);
    const taxable = num(rec.taxableAmount);
    if (gross != null && taxable != null && taxable > gross + 1) {
      flags.push({ field: "taxableAmount", severity: "error",
        message: `Taxable amount (${fmt(taxable)}) exceeds the gross distribution (${fmt(gross)}). Box 2a cannot exceed Box 1.` });
    }
    if (gross != null && gross > 0 && !rec.distributionCode) {
      flags.push({ field: "distributionCode", severity: "info",
        message: `No distribution code (Box 7). The code drives the §72(t) early-withdrawal penalty — verify it was captured.` });
    }
  }

  if (type === "b") {
    // proceeds − basis should ≈ reported gain/loss (allowing wash-sale + other adjustments).
    const proceeds = num(rec.proceeds);
    const basis = num(rec.costBasis);
    const st = num(rec.shortTermGainLoss);
    const lt = num(rec.longTermGainLoss);
    if (proceeds != null && basis != null && (st != null || lt != null)) {
      const reportedGain = (st ?? 0) + (lt ?? 0);
      const impliedGain = proceeds - basis;
      if (Math.abs(impliedGain - reportedGain) > Math.max(5, Math.abs(impliedGain) * 0.02)) {
        flags.push({ field: "shortTermGainLoss", severity: "warning",
          message: `Proceeds − cost basis (${fmt(impliedGain)}) doesn't match reported gain/loss (${fmt(reportedGain)}). Normal if there are wash-sale or other Box 1g adjustments — otherwise verify.` });
      }
    }
  }

  if (type === "int") {
    // Tax-exempt interest (box 8) being LARGER than taxable is fine, but a huge
    // tax-exempt with $0 taxable on the same payer is worth a glance — skip; the
    // useful INT check is backup-withholding plausibility (below).
    const exempt = num(rec.taxExemptInterest);
    if (exempt != null && exempt < 0) {
      flags.push({ field: "taxExemptInterest", severity: "error", message: `Tax-exempt interest can't be negative (${fmt(exempt)}).` });
    }
  }

  // ── Withholding plausibility (all types) ─────────────────────
  const fedWh = num(rec.federalTaxWithheld);
  const income = primaryIncome(rec, type);
  if (fedWh != null && fedWh > 0 && income > 0) {
    const ratio = fedWh / income;
    // 24% is the statutory backup-withholding rate; well above it is suspect.
    if (ratio > 0.4) {
      flags.push({ field: "federalTaxWithheld", severity: "warning",
        message: `Federal withholding is ${(ratio * 100).toFixed(1)}% of the income on this 1099 — unusually high (backup withholding is 24%). Verify.` });
    }
  }
  if (fedWh != null && income === 0 && fedWh > 0 && type !== "r") {
    flags.push({ field: "federalTaxWithheld", severity: "warning",
      message: `Federal withholding (${fmt(fedWh)}) is reported but no income is on this 1099. Verify the income boxes were captured.` });
  }

  // ── Negative-income guard (income boxes that can't be negative) ──
  for (const f of ["nonemployeeCompensation", "interestIncome", "ordinaryDividends", "grossDistribution", "rents", "royalties", "grossPaymentAmount"] as const) {
    const v = num(rec[f]);
    if (v != null && v < 0) {
      flags.push({ field: f, severity: "error", message: `${f} can't be negative (${fmt(v)}).` });
    }
  }

  return flags;
}
