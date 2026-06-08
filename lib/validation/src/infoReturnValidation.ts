/**
 * Information-return sanity checks — box-arithmetic + plausibility flags a CPA
 * should review, mirroring validate1099/validateW2. Covers 1098, 1098-T, 1098-E,
 * 1095-A, SSA-1099, W-2G.
 *
 * Shared between the server (return diagnostics + the document-review flow) and
 * the frontend review modal. Pure + deterministic (no API).
 */

export type InfoReturnFlagSeverity = "error" | "warning" | "info";

export interface InfoReturnFlag {
  /** Field the flag applies to, or null for record-level. */
  field: string | null;
  severity: InfoReturnFlagSeverity;
  message: string;
}

export type InfoReturnTypeLike =
  | "1098" | "1098t" | "1098e" | "1095a" | "ssa1099" | "w2g" | string;

export interface InfoReturnDataLike {
  taxYear?: number | null;
  infoType?: InfoReturnTypeLike | null;
  payerName?: string | null;
  payerTin?: string | null;
  stateCode?: string | null;
  // 1098
  mortgageInterestReceived?: number | string | null;
  outstandingMortgagePrincipal?: number | string | null;
  refundOfOverpaidInterest?: number | string | null;
  mortgageInsurancePremiums?: number | string | null;
  pointsPaid?: number | string | null;
  realEstateTaxes?: number | string | null;
  // 1098-T
  qualifiedTuition?: number | string | null;
  scholarshipsGrants?: number | string | null;
  // 1098-E
  studentLoanInterest?: number | string | null;
  // 1095-A
  annualPremium?: number | string | null;
  annualSlcsp?: number | string | null;
  annualAdvancePtc?: number | string | null;
  // SSA-1099
  socialSecurityBenefitsPaid?: number | string | null;
  benefitsRepaid?: number | string | null;
  netSocialSecurityBenefits?: number | string | null;
  voluntaryFederalWithholding?: number | string | null;
  // W-2G
  gamblingWinnings?: number | string | null;
  gamblingFederalWithheld?: number | string | null;
  gamblingStateWinnings?: number | string | null;
  gamblingStateWithheld?: number | string | null;
}

export interface InfoReturnValidationContext {
  clientTaxYear?: number;
  clientState?: string;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
function normType(t: InfoReturnTypeLike | null | undefined): string {
  return (t ?? "").toString().toLowerCase().replace(/form\s*/g, "").replace(/[-\s]/g, "");
}

export function validateInfoReturn(
  rec: InfoReturnDataLike,
  ctx: InfoReturnValidationContext = {},
): InfoReturnFlag[] {
  const flags: InfoReturnFlag[] = [];
  const type = normType(rec.infoType);

  // ── Year mismatch ────────────────────────────────────────────
  if (ctx.clientTaxYear != null && rec.taxYear != null && rec.taxYear !== ctx.clientTaxYear) {
    flags.push({ field: "taxYear", severity: "warning",
      message: `Document tax year (${rec.taxYear}) doesn't match the client's tax year (${ctx.clientTaxYear}).` });
  }
  // ── Payer/filer TIN format ───────────────────────────────────
  if (rec.payerTin) {
    const t = digits(rec.payerTin);
    if (t.length !== 9) {
      flags.push({ field: "payerTin", severity: "warning",
        message: `Filer/payer TIN should be 9 digits (got ${t.length}). Format: XX-XXXXXXX.` });
    }
  }

  // ── 1098 — Mortgage Interest ─────────────────────────────────
  if (type === "1098") {
    const interest = num(rec.mortgageInterestReceived);
    const refund = num(rec.refundOfOverpaidInterest);
    if (interest != null && interest < 0) {
      flags.push({ field: "mortgageInterestReceived", severity: "error",
        message: `Mortgage interest (Box 1) is negative (${fmt(interest)}).` });
    }
    // Box 4 (refund of overpaid interest) reduces the deduction — flag when it
    // is unusually large relative to Box 1 (a likely OCR mis-read).
    if (interest != null && refund != null && refund > interest && interest > 0) {
      flags.push({ field: "refundOfOverpaidInterest", severity: "warning",
        message: `Refund of overpaid interest (Box 4, ${fmt(refund)}) exceeds mortgage interest received (Box 1, ${fmt(interest)}). Verify — Box 4 is a prior-year refund and is usually small.` });
    }
  }

  // ── 1098-T — Tuition ─────────────────────────────────────────
  if (type === "1098t") {
    const tuition = num(rec.qualifiedTuition);
    const scholarships = num(rec.scholarshipsGrants);
    if (tuition != null && tuition < 0) {
      flags.push({ field: "qualifiedTuition", severity: "error",
        message: `Qualified tuition (Box 1) is negative (${fmt(tuition)}).` });
    }
    if (tuition != null && scholarships != null && scholarships > tuition && tuition >= 0) {
      flags.push({ field: "scholarshipsGrants", severity: "info",
        message: `Scholarships/grants (Box 5, ${fmt(scholarships)}) exceed qualified tuition (Box 1, ${fmt(tuition)}). The excess may be TAXABLE scholarship income and leaves $0 of expenses for the education credit.` });
    }
  }

  // ── 1098-E — Student Loan Interest ───────────────────────────
  if (type === "1098e") {
    const interest = num(rec.studentLoanInterest);
    if (interest != null && interest < 0) {
      flags.push({ field: "studentLoanInterest", severity: "error",
        message: `Student loan interest (Box 1) is negative (${fmt(interest)}).` });
    }
    // The §221 deduction caps at $2,500, but reported interest paid can exceed it.
    if (interest != null && interest > 2500) {
      flags.push({ field: "studentLoanInterest", severity: "info",
        message: `Student loan interest is ${fmt(interest)}; the §221 deduction caps at $2,500 (and phases out by MAGI).` });
    }
  }

  // ── 1095-A — Marketplace (Form 8962 inputs) ──────────────────
  if (type === "1095a") {
    const premium = num(rec.annualPremium);
    const slcsp = num(rec.annualSlcsp);
    const aptc = num(rec.annualAdvancePtc);
    for (const [field, v] of [["annualPremium", premium], ["annualSlcsp", slcsp], ["annualAdvancePtc", aptc]] as const) {
      if (v != null && v < 0) {
        flags.push({ field, severity: "error", message: `1095-A ${field} is negative (${fmt(v)}).` });
      }
    }
    if (premium != null && aptc != null && aptc > premium + 1) {
      flags.push({ field: "annualAdvancePtc", severity: "warning",
        message: `Advance PTC (Column C, ${fmt(aptc)}) exceeds the enrollment premium (Column A, ${fmt(premium)}). Verify — APTC cannot exceed the premium.` });
    }
    if (slcsp != null && slcsp === 0 && (premium ?? 0) > 0) {
      flags.push({ field: "annualSlcsp", severity: "warning",
        message: `SLCSP (Column B) is $0 but a premium is present. Form 8962 needs the second-lowest-cost Silver premium — look it up on HealthCare.gov if Column B is blank.` });
    }
  }

  // ── SSA-1099 — Social Security ───────────────────────────────
  if (type === "ssa1099") {
    const gross = num(rec.socialSecurityBenefitsPaid);
    const repaid = num(rec.benefitsRepaid);
    const net = num(rec.netSocialSecurityBenefits);
    const withheld = num(rec.voluntaryFederalWithholding);
    // Box 5 = Box 3 − Box 4.
    if (gross != null && repaid != null && net != null) {
      const implied = gross - repaid;
      if (Math.abs(implied - net) > 1) {
        flags.push({ field: "netSocialSecurityBenefits", severity: "error",
          message: `Net benefits (Box 5, ${fmt(net)}) should equal benefits paid (Box 3, ${fmt(gross)}) minus repaid (Box 4, ${fmt(repaid)}) = ${fmt(implied)}.` });
      }
    }
    const netOrGross = net ?? gross;
    if (netOrGross != null && withheld != null && withheld > netOrGross && netOrGross > 0) {
      flags.push({ field: "voluntaryFederalWithholding", severity: "error",
        message: `Federal tax withheld (Box 6, ${fmt(withheld)}) exceeds the net benefits (${fmt(netOrGross)}).` });
    }
  }

  // ── W-2G — Gambling Winnings ─────────────────────────────────
  if (type === "w2g") {
    const winnings = num(rec.gamblingWinnings);
    const fedWh = num(rec.gamblingFederalWithheld);
    const stWin = num(rec.gamblingStateWinnings);
    const stWh = num(rec.gamblingStateWithheld);
    if (winnings != null && winnings < 0) {
      flags.push({ field: "gamblingWinnings", severity: "error",
        message: `Gambling winnings (Box 1) is negative (${fmt(winnings)}).` });
    }
    if (winnings != null && fedWh != null && fedWh > winnings && winnings > 0) {
      flags.push({ field: "gamblingFederalWithheld", severity: "error",
        message: `Federal withholding (Box 4, ${fmt(fedWh)}) exceeds the winnings (Box 1, ${fmt(winnings)}).` });
    }
    if (stWin != null && stWh != null && stWh > stWin && stWin > 0) {
      flags.push({ field: "gamblingStateWithheld", severity: "warning",
        message: `State withholding (Box 15, ${fmt(stWh)}) exceeds the state winnings (Box 14, ${fmt(stWin)}).` });
    }
    // ── State mismatch (W-2G is the only one of these with sourced state tax) ──
    if (ctx.clientState && rec.stateCode && ctx.clientState.toUpperCase() !== rec.stateCode.toUpperCase()) {
      flags.push({ field: "stateCode", severity: "info",
        message: `W-2G state (${rec.stateCode}) differs from the client's state (${ctx.clientState}). Gambling winnings are taxed by the state where won — non-resident state tax may apply.` });
    }
  }

  return flags;
}
