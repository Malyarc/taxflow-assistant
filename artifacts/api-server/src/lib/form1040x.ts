/**
 * Form 1040-X — Amended U.S. Individual Income Tax Return.
 *
 * Source: IRS Form 1040-X (Rev. Feb 2024).
 *
 * Architecture: when the CPA marks the originally-filed return as "filed",
 * `originalSnapshot` (jsonb) is captured on the tax_returns row. Subsequent
 * recomputes update tax_returns normally but leave originalSnapshot pinned.
 * Form 1040-X diff = currentReturn (col c) minus originalSnapshot (col a).
 *
 * Workflow:
 *   1. CPA computes return → tax_returns row exists
 *   2. CPA reviews + clicks "Lock as filed" → POST /lock-as-filed
 *      captures originalSnapshot
 *   3. CPA learns of a correction → modifies inputs → recomputes
 *      → tax_returns row now reflects amended values
 *   4. CPA hits "Form 1040-X" → engine diffs current row against
 *      originalSnapshot, generates the form
 *   5. CPA enters Part III explanation, downloads PDF, mails to IRS
 *   6. After IRS accepts, CPA clicks "Clear amendment baseline" → snapshot reset
 */
import PDFDocument from "pdfkit";
import { winAnsiSafePdf } from "./pdfBrand";
import type { ComputedTaxReturn } from "./taxReturnEngine";
import type { clientsTable, taxReturnsTable } from "@workspace/db";

type Client = typeof clientsTable.$inferSelect;
type TaxReturnRow = typeof taxReturnsTable.$inferSelect;

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_widow: "Qualifying Widow(er)",
};

/**
 * Snapshot of the relevant computed-return values, captured at "lock as
 * filed" time. Stored as JSONB so subsequent schema additions don't
 * invalidate frozen historicals (the col-a values must remain stable).
 *
 * Adding a field: pick it up in `captureFiledSnapshot()`. Don't break
 * existing snapshots — only ADD; never rename / remove. If a field is
 * missing from an old snapshot, the engine treats it as 0.
 */
export interface FiledSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  fields: {
    adjustedGrossIncome: number;
    standardDeduction: number;
    itemizedDeductions: number;
    qbiDeduction: number;
    taxableIncome: number;
    federalTaxLiability: number;
    federalTaxWithheld: number;
    federalRefundOrOwed: number;
    selfEmploymentTax: number;
    niitTax: number;
    amtTax: number;
    additionalMedicareTax: number;
    eitc: number;
    additionalChildTaxCredit: number;
    aocRefundablePortion: number;
    premiumTaxCredit: number;
    stateTaxLiability: number;
    stateTaxWithheld: number;
    stateRefundOrOwed: number;
    /** FORM-02 — non-refundable credits applied (income-tax offset). */
    totalNonRefundableApplied: number;
    // ── P2-7 amendment depth — nonrefundable-credit component detail + the
    //    preferential-rate tax component. All ADDITIVE (schemaVersion stays 1);
    //    a pre-P2-7 snapshot that lacks them coerces each to 0 via num(), so
    //    existing locked returns keep diffing correctly. ──────────────────────
    /** Tax on LTCG + qualified dividends at preferential rates (part of Line 6). */
    capitalGainsTax: number;
    /** Child & dependent care credit (Form 2441) — nonrefundable. */
    dependentCareCredit: number;
    /** Saver's credit (Form 8880) — nonrefundable. */
    saversCredit: number;
    /** Foreign tax credit (Form 1116) — nonrefundable. */
    foreignTaxCredit: number;
    /** Residential energy credits (Form 5695) — nonrefundable. */
    residentialEnergyCredits: number;
    /** American Opportunity Credit total (Form 8863); nonref portion = total − refundable. */
    aocCredit: number;
    /** Lifetime Learning Credit (Form 8863) — nonrefundable. */
    llcCredit: number;
    // ── T1.0 H3 (audit 2026-06-11) — the remaining Schedule 2 Part II taxes,
    //    so the line 6 "Tax" vs line 10 "Other taxes" split attributes deltas
    //    correctly. ADDITIVE (schemaVersion stays 1); pre-H3 snapshots coerce
    //    to 0 via num(). NOTE: §72(t) + HSA excise are not persisted as
    //    tax_returns columns, so a snapshot captured from a DB row reads them
    //    as 0 (degrades to the pre-H3 split); a snapshot captured from a
    //    ComputedTaxReturn captures all three. ──────────────────────────────
    /** §72(t) early-distribution additional tax (Form 5329 → Sch 2 line 8). */
    earlyWithdrawalPenalty: number;
    /** §4973 HSA excess-contribution excise (Form 5329 Pt VII → Sch 2 line 8). */
    hsaExcessExcise: number;
    /** Schedule H household employment taxes (Sch 2 line 9). */
    householdEmploymentTax: number;
  };
}

/** Coerce a numeric / numeric-string / null to a finite number. */
function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Capture a snapshot of the current tax_returns row.
 *
 * Used by `lock-as-filed` (snapshots the current return) and by tests
 * (synthesize a snapshot from a hand-built return for hand-calc).
 */
export function captureFiledSnapshot(row: TaxReturnRow | ComputedTaxReturn): FiledSnapshot {
  // Both shapes have these field names; numeric columns may be strings (drizzle numeric()).
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    fields: {
      adjustedGrossIncome: num((row as TaxReturnRow).adjustedGrossIncome),
      standardDeduction: num((row as TaxReturnRow).standardDeduction),
      itemizedDeductions: num((row as TaxReturnRow).itemizedDeductions),
      qbiDeduction: num((row as TaxReturnRow).qbiDeduction),
      taxableIncome: num((row as TaxReturnRow).taxableIncome),
      federalTaxLiability: num((row as TaxReturnRow).federalTaxLiability),
      federalTaxWithheld: num((row as TaxReturnRow).federalTaxWithheld),
      federalRefundOrOwed: num((row as TaxReturnRow).federalRefundOrOwed),
      selfEmploymentTax: num((row as TaxReturnRow).selfEmploymentTax),
      niitTax: num((row as TaxReturnRow).niitTax),
      amtTax: num((row as TaxReturnRow).amtTax),
      additionalMedicareTax: num((row as TaxReturnRow).additionalMedicareTax),
      eitc: num((row as TaxReturnRow).eitc),
      additionalChildTaxCredit: num((row as TaxReturnRow).additionalChildTaxCredit),
      aocRefundablePortion: num((row as TaxReturnRow).aocRefundablePortion),
      premiumTaxCredit: num((row as TaxReturnRow).premiumTaxCredit),
      stateTaxLiability: num((row as TaxReturnRow).stateTaxLiability),
      stateTaxWithheld: num((row as TaxReturnRow).stateTaxWithheld),
      stateRefundOrOwed: num((row as TaxReturnRow).stateRefundOrOwed),
      totalNonRefundableApplied: num((row as TaxReturnRow).totalNonRefundableApplied),
      // P2-7 — nonrefundable-credit component detail (flat DB columns).
      capitalGainsTax: num((row as TaxReturnRow).capitalGainsTax),
      dependentCareCredit: num((row as TaxReturnRow).dependentCareCredit),
      saversCredit: num((row as TaxReturnRow).saversCredit),
      foreignTaxCredit: num((row as TaxReturnRow).foreignTaxCredit),
      residentialEnergyCredits: num((row as TaxReturnRow).residentialEnergyCredits),
      aocCredit: num((row as TaxReturnRow).aocCredit),
      llcCredit: num((row as TaxReturnRow).llcCredit),
      // H3 — Schedule 2 Part II components. §72(t)/HSA exist only on the
      // ComputedTaxReturn shape (no tax_returns columns — read 0 from a row);
      // Schedule H exists on BOTH (row column householdEmploymentTax /
      // computed scheduleH.total).
      earlyWithdrawalPenalty: num((row as Partial<ComputedTaxReturn>).earlyWithdrawalPenalty),
      hsaExcessExcise: num((row as Partial<ComputedTaxReturn>).hsaExcessExcise),
      householdEmploymentTax: num(
        (row as Partial<TaxReturnRow>).householdEmploymentTax ??
          (row as Partial<ComputedTaxReturn>).scheduleH?.total,
      ),
    },
  };
}

export interface Form1040xLine {
  /** IRS Form 1040-X line number (e.g., "1", "5", "10", "20"). */
  lineRef: string;
  /** Human label for the line. */
  label: string;
  /** Col (a) — Original amount (from FiledSnapshot). */
  original: number;
  /** Col (c) — Corrected amount (from current return). */
  amended: number;
  /** Col (b) — Net change (c − a). */
  netChange: number;
}

export interface Form1040xResult {
  taxYear: number;
  lockedAt: string | null;
  explanation: string;
  lines: Form1040xLine[];
  /**
   * P2-7 — supplementary nonrefundable-credit component breakdown. NOT part of
   * the Line 7 footing (Line 7 stays the authoritative aggregate); this just
   * shows WHICH credit changed on an amendment (dependent care, education,
   * saver's, FTC, energy) plus the preferential-rate tax component. Only
   * components with a nonzero original OR amended value are included.
   */
  creditDetail: Form1040xLine[];
  /**
   * P2-7 — amended STATE return summary lines (state tax, withholding,
   * refund/owed). Lets the CPA produce the amended-state delta line-by-line,
   * not just the headline netStateRefundChange.
   */
  stateLines: Form1040xLine[];
  /**
   * Bottom-line federal refund/owed delta. Positive = additional refund
   * (Line 20 increase); negative = additional tax owed (Line 19 increase).
   */
  netFederalRefundChange: number;
  /** Same, but state-level. */
  netStateRefundChange: number;
}

/**
 * Build a Form 1040-X comparison from the current computed return and a
 * snapshot of the originally-filed values.
 */
export function computeAmendmentDiff(args: {
  current: ComputedTaxReturn | TaxReturnRow;
  snapshot: FiledSnapshot;
  explanation?: string;
  lockedAt?: string | null;
}): Form1040xResult {
  const { current, snapshot, explanation = "", lockedAt = null } = args;
  const o = snapshot.fields;

  // ── Pull current values (handle both ComputedTaxReturn and DB-row shapes) ──
  const cur = {
    adjustedGrossIncome: num((current as TaxReturnRow).adjustedGrossIncome),
    standardDeduction: num((current as TaxReturnRow).standardDeduction),
    itemizedDeductions: num((current as TaxReturnRow).itemizedDeductions),
    qbiDeduction: num((current as TaxReturnRow).qbiDeduction),
    taxableIncome: num((current as TaxReturnRow).taxableIncome),
    federalTaxLiability: num((current as TaxReturnRow).federalTaxLiability),
    federalTaxWithheld: num((current as TaxReturnRow).federalTaxWithheld),
    federalRefundOrOwed: num((current as TaxReturnRow).federalRefundOrOwed),
    selfEmploymentTax: num((current as TaxReturnRow).selfEmploymentTax),
    niitTax: num((current as TaxReturnRow).niitTax),
    amtTax: num((current as TaxReturnRow).amtTax),
    additionalMedicareTax: num((current as TaxReturnRow).additionalMedicareTax),
    eitc: num((current as TaxReturnRow).eitc),
    additionalChildTaxCredit: num((current as TaxReturnRow).additionalChildTaxCredit),
    aocRefundablePortion: num((current as TaxReturnRow).aocRefundablePortion),
    premiumTaxCredit: num((current as TaxReturnRow).premiumTaxCredit),
    stateTaxLiability: num((current as TaxReturnRow).stateTaxLiability),
    stateTaxWithheld: num((current as TaxReturnRow).stateTaxWithheld),
    stateRefundOrOwed: num((current as TaxReturnRow).stateRefundOrOwed),
    totalNonRefundableApplied: num((current as TaxReturnRow).totalNonRefundableApplied),
    capitalGainsTax: num((current as TaxReturnRow).capitalGainsTax),
    dependentCareCredit: num((current as TaxReturnRow).dependentCareCredit),
    saversCredit: num((current as TaxReturnRow).saversCredit),
    foreignTaxCredit: num((current as TaxReturnRow).foreignTaxCredit),
    residentialEnergyCredits: num((current as TaxReturnRow).residentialEnergyCredits),
    aocCredit: num((current as TaxReturnRow).aocCredit),
    llcCredit: num((current as TaxReturnRow).llcCredit),
    // H3 — Schedule 2 Part II components (see captureFiledSnapshot note).
    earlyWithdrawalPenalty: num((current as Partial<ComputedTaxReturn>).earlyWithdrawalPenalty),
    hsaExcessExcise: num((current as Partial<ComputedTaxReturn>).hsaExcessExcise),
    householdEmploymentTax: num(
      (current as Partial<TaxReturnRow>).householdEmploymentTax ??
        (current as Partial<ComputedTaxReturn>).scheduleH?.total,
    ),
  };

  // ── Helper: chosen deduction (the one actually taken; per CLAUDE.md
  //    pipeline note, std vs itemized is auto-picked by max). ──────────
  const deduction = (snap: typeof o): number => {
    return Math.max(snap.standardDeduction, snap.itemizedDeductions);
  };
  const oDed = deduction(o);
  const cDed = deduction(cur);

  // ── Derive "Line 10 other taxes" — the Schedule 2 Part II (line 21) bucket:
  // SE + NIIT + Additional Medicare + §72(t) + HSA excise + Schedule H (H3 —
  // the last three previously sat inside the line-6 "Tax" figure, so the
  // 6 / 10 split a CPA copies was wrong for any filer with them). The
  // excess-APTC repayment is Schedule 2 PART I (line 1a → 1040 line 17), so
  // it correctly stays INSIDE line 6 (official 1040-X line 6 = 1040 line 18).
  const otherTaxes = (s: typeof o): number =>
    s.selfEmploymentTax +
    s.niitTax +
    s.additionalMedicareTax +
    num(s.earlyWithdrawalPenalty) +
    num(s.hsaExcessExcise) +
    num(s.householdEmploymentTax);
  const oOther = otherTaxes(o);
  const cOther = otherTaxes(cur);

  // ── Derive "regular tax + AMT" (Line 6 before non-ref credits).
  // We don't store this directly; back out from total tax minus other taxes.
  // For Line 6 + 7 + 8: total tax = (regular + AMT after non-ref credits) + other
  // → Line 8 = total tax − other taxes
  // (Lines 6 and 7 individually require breaking out non-ref credits which we
  // don't persist as a single sum; the Line 8 derivation captures the net.)
  // FORM-02: Line 8 = (regular tax + AMT) − non-refundable credits. Engine
  // federalTaxLiability is PRE-credit and bundles other taxes, so back out
  // both: (federalTaxLiability − otherTaxes) − totalNonRefundableApplied.
  const oLine8 = o.federalTaxLiability - oOther - o.totalNonRefundableApplied;
  const cLine8 = cur.federalTaxLiability - cOther - cur.totalNonRefundableApplied;

  // ── Refundable credits sum (Line 14) ──────────────────────────────────
  const refundable = (s: typeof o): number =>
    s.additionalChildTaxCredit +
    s.aocRefundablePortion +
    Math.max(0, s.premiumTaxCredit);
  const oRef = refundable(o);
  const cRef = refundable(cur);

  // ── Total payments (Line 16) — derived consistently with engine ──────
  // engine: federalRefundOrOwed = totalPayments − federalTaxLiability
  // → totalPayments = federalTaxLiability + federalRefundOrOwed
  // FORM-02: total payments = withholding + refundable credits (non-refundable
  // credits reduce TAX on Line 10, not payments). Engine federalRefundOrOwed
  // already nets ALL credits, so back the non-refundable ones out here too:
  // payments = federalTaxLiability + federalRefundOrOwed − totalNonRefundableApplied.
  const oTotalPayments = o.federalTaxLiability + o.federalRefundOrOwed - o.totalNonRefundableApplied;
  const cTotalPayments = cur.federalTaxLiability + cur.federalRefundOrOwed - cur.totalNonRefundableApplied;

  // ── FORM-03: settlement reconciliation (IRS Form 1040-X Lines 16-21) ────
  // The amended total tax (Line 11, col c) compared against the payments the
  // taxpayer has ALREADY made (and not had refunded) determines the
  // additional amount owed or refunded BY FILING THE AMENDMENT — which is the
  // whole point of Form 1040-X. The prior implementation showed each return's
  // own standalone owe/refund, so on a refund↔owed swap the breakdown failed
  // to foot to the headline.
  //
  // Official 2024 Form 1040-X mapping (H2 — the payments/settlement half was
  // previously one line LOW across the board):
  //   Line 16  Amount paid with extension / original return  (single-column)
  //   Line 17  Total payments (12c–15c + 16) — we render the per-column
  //            withholding+credits total here and keep line 16 as its own
  //            recon row, preserving the FORM-02 per-column footing
  //            Line17 − Line11 = refund/owed
  //   Line 18  Overpayment shown on original return (already refunded/applied)
  //   Line 19  Line 17 + Line 16 − Line 18 (payments net of original outcome)
  //   Line 20  Amount you owe with this amendment
  //   Line 21  Overpaid — refund with this amendment
  // Net payments available against amended tax (official Line 19) =
  //   Line 17(c) + Line 16 − Line 18  =  cTotalPayments − o.federalRefundOrOwed.
  // INVARIANT: Line 21 − Line 20 === netFederalRefundChange (proven by tests).
  const cTotalTax = cur.federalTaxLiability - cur.totalNonRefundableApplied; // = Line 11 (c)
  const origOverpayment = Math.max(0, o.federalRefundOrOwed); // refund already received on original
  const origBalancePaid = Math.max(0, -o.federalRefundOrOwed); // tax already paid with original
  const availablePayments = cTotalPayments + origBalancePaid - origOverpayment; // ≡ cTotalPayments − o.refund
  const additionalOwe = Math.max(0, cTotalTax - availablePayments);
  const additionalRefund = Math.max(0, availablePayments - cTotalTax);

  // Per IRS Form 1040-X instructions: col (b) "Net change" = (c) − (a),
  // where (a) and (c) are each independently rounded to whole dollars.
  // This means col (b) = round(amended) − round(original), NOT
  // round(amended − original) — the latter can off-by-one when both
  // halves round in opposite directions.
  const line = (lineRef: string, label: string, original: number, amended: number): Form1040xLine => {
    const a = Math.round(original);
    const c = Math.round(amended);
    return { lineRef, label, original: a, amended: c, netChange: c - a };
  };

  // Settlement lines (16, 18-21) are single-column figures on the official
  // form — there is no col-a/col-b comparison for them. We render the
  // operative value in col (c) and pin netChange to 0 (they are derived
  // totals, not line-by-line "changes"). Keeps the "every line nets 0 on an
  // identical amendment" guarantee intact.
  const reconLine = (lineRef: string, label: string, colA: number, colC: number): Form1040xLine => ({
    lineRef,
    label,
    original: Math.round(colA),
    amended: Math.round(colC),
    netChange: 0,
  });

  // H2 (audit 2026-06-11): the payments/settlement half follows the OFFICIAL
  // 2024 Form 1040-X numbering — 10 other taxes / 11 total tax / 12 withholding
  // / 13 estimated payments (not modeled) / 14 EIC / 15 refundable credits /
  // 16 amount paid with extension or original return / 17 total payments / 18
  // overpayment on original / 19 = 17 + 16 − 18 / 20 amount you owe / 21
  // overpaid (refund). The prior numbering was one line LOW throughout (and
  // landed the EIC on the official estimated-payments line), so a CPA
  // transcribing lineRefs onto the real form mis-filed every entry.
  const lines: Form1040xLine[] = [
    // Income & Deductions
    line("1", "Adjusted gross income", o.adjustedGrossIncome, cur.adjustedGrossIncome),
    line("2", "Itemized deductions or standard deduction", oDed, cDed),
    line("3", "Subtract line 2 from line 1", o.adjustedGrossIncome - oDed, cur.adjustedGrossIncome - cDed),
    line("4b", "Qualified business income deduction", o.qbiDeduction, cur.qbiDeduction),
    line("5", "Taxable income", o.taxableIncome, cur.taxableIncome),
    // Tax Liability — P2-7: break out the real Form 1040-X Line 6 → 7 → 8 chain
    // (the form previously jumped straight to the net Line 8). Line 6 is the
    // income tax including AMT (and the excess-APTC repayment, per 1040 line
    // 18), BEFORE nonrefundable credits; Line 7 is the nonrefundable credits;
    // Line 8 = Line 6 − Line 7 (the value the FORM-02 tests already lock).
    line("6", "Tax (regular + AMT), before nonrefundable credits", o.federalTaxLiability - oOther, cur.federalTaxLiability - cOther),
    line("7", "Nonrefundable credits", o.totalNonRefundableApplied, cur.totalNonRefundableApplied),
    line("8", "Subtract nonrefundable credits from tax (incl. AMT)", oLine8, cLine8),
    line("10", "Other taxes (Sch 2 Pt II: SE + NIIT + AddlMed + §72(t) + HSA excise + Sch H)", oOther, cOther),
    // FORM-02: Total tax = tax + AMT − non-refundable credits + other taxes
    // = federalTaxLiability − totalNonRefundableApplied (engine total is pre-credit).
    line("11", "Total tax", o.federalTaxLiability - o.totalNonRefundableApplied, cur.federalTaxLiability - cur.totalNonRefundableApplied),
    // Payments
    line("12", "Federal income tax withheld", o.federalTaxWithheld, cur.federalTaxWithheld),
    line("14", "EITC", o.eitc, cur.eitc),
    line("15", "Refundable credits (ACTC, AOC refundable, PTC)", oRef, cRef),
    // ── Settlement (FORM-03 — official Line 16→21 chain). Lines 16/18-21 are
    //    single-column figures; Line 21 − Line 20 foots to the headline
    //    netFederalRefundChange. ─────────────────────────────────────────────
    reconLine("16", "Tax paid with original return (and with Form 4868)", origBalancePaid, origBalancePaid),
    line("17", "Total payments (withholding + EIC + refundable credits; line 16 shown separately)", oTotalPayments, cTotalPayments),
    reconLine("18", "Overpayment per original return (already refunded/applied)", origOverpayment, origOverpayment),
    reconLine("19", "Payments net of original outcome (line 17 + line 16 − line 18)", oTotalPayments + origBalancePaid - origOverpayment, availablePayments),
    reconLine("20", "Amount you owe with this amended return", 0, additionalOwe),
    reconLine("21", "Overpaid — refund with this amended return", 0, additionalRefund),
  ];

  // ── P2-7 — nonrefundable-credit component breakdown (supplementary) ──────
  // AOC nonrefundable portion = total AOC − refundable 40%. Other credits are
  // wholly nonrefundable. Each component is included only when it has a nonzero
  // original or amended value (keeps the breakdown tight). NOT part of Line 7
  // footing — Line 7 stays the authoritative aggregate.
  // NOTE: read the P2-7 snapshot fields through num() — a pre-P2-7 (old) locked
  // snapshot lacks these keys, so a raw read would yield undefined → NaN and
  // wrongly include the component. num(undefined) = 0 keeps old snapshots clean.
  const creditComponents: Array<{ ref: string; label: string; o: number; c: number }> = [
    { ref: "6a", label: "  Tax on capital gains / qualified dividends (preferential)", o: num(o.capitalGainsTax), c: cur.capitalGainsTax },
    { ref: "7a", label: "  Child & dependent care credit (Form 2441)", o: num(o.dependentCareCredit), c: cur.dependentCareCredit },
    { ref: "7b", label: "  American Opportunity Credit, nonrefundable (Form 8863)", o: Math.max(0, num(o.aocCredit) - num(o.aocRefundablePortion)), c: Math.max(0, cur.aocCredit - cur.aocRefundablePortion) },
    { ref: "7c", label: "  Lifetime Learning Credit (Form 8863)", o: num(o.llcCredit), c: cur.llcCredit },
    { ref: "7d", label: "  Saver's credit (Form 8880)", o: num(o.saversCredit), c: cur.saversCredit },
    { ref: "7e", label: "  Foreign tax credit (Form 1116)", o: num(o.foreignTaxCredit), c: cur.foreignTaxCredit },
    { ref: "7f", label: "  Residential energy credits (Form 5695)", o: num(o.residentialEnergyCredits), c: cur.residentialEnergyCredits },
  ];
  const creditDetail: Form1040xLine[] = creditComponents
    .filter((cc) => Math.round(cc.o) !== 0 || Math.round(cc.c) !== 0)
    .map((cc) => line(cc.ref, cc.label, cc.o, cc.c));

  // ── P2-7 — amended STATE return summary lines ───────────────────────────
  const stateLines: Form1040xLine[] = [
    line("S1", "State tax liability", o.stateTaxLiability, cur.stateTaxLiability),
    line("S2", "State tax withheld", o.stateTaxWithheld, cur.stateTaxWithheld),
    line("S3", "State refund (+) / owed (−)", o.stateRefundOrOwed, cur.stateRefundOrOwed),
  ];

  // Bottom-line delta — used for the headline UI display.
  const netFederalRefundChange = Math.round(cur.federalRefundOrOwed - o.federalRefundOrOwed);
  const netStateRefundChange = Math.round(cur.stateRefundOrOwed - o.stateRefundOrOwed);

  return {
    taxYear: (current as TaxReturnRow).taxYear,
    lockedAt,
    explanation,
    lines,
    creditDetail,
    stateLines,
    netFederalRefundChange,
    netStateRefundChange,
  };
}

// ── PDF rendering ────────────────────────────────────────────────────────
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

export interface BuildForm1040xPdfOptions {
  client: Client;
  ret: ComputedTaxReturn | TaxReturnRow;
  form: Form1040xResult;
}

/** Render a substitute Form 1040-X PDF (per Pub 1167). */
export function buildForm1040xPdf(options: BuildForm1040xPdfOptions): Promise<Buffer> {
  const { client, form } = options;
  return new Promise((resolve, reject) => {
    const doc = winAnsiSafePdf(new PDFDocument({ size: "letter", margin: 50 })); // M5 WinAnsi glyph seam
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Form 1040-X", { continued: true })
      .font("Helvetica")
      .text("    Amended U.S. Individual Income Tax Return");
    doc.fontSize(11).text(`Tax year ${form.taxYear}`);
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor("#555").text(
      `Department of the Treasury — IRS  ·  Generated by TaxFlow Assistant on ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. Substitute form per Pub 1167.`,
    );
    if (form.lockedAt) {
      doc.fontSize(8).fillColor("#888").text(`Original snapshot locked at ${new Date(form.lockedAt).toLocaleString("en-US")}`);
    }
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

    // 3-column table header
    const labelX = 50;
    const lineRefX = 38;
    const colAX = 358;
    const colBX = 440;
    const colCX = 522;
    const colWidth = 70;

    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Line", lineRefX, doc.y, { width: 26, align: "right" });
    doc.text("Description", labelX, doc.y - 11, { width: 300 });
    doc.text("(a) Original", colAX, doc.y - 11, { width: colWidth, align: "right" });
    doc.text("(b) Net change", colBX, doc.y - 11, { width: colWidth, align: "right" });
    doc.text("(c) Corrected", colCX, doc.y - 11, { width: colWidth, align: "right" });
    doc.moveDown(0.2);
    doc.lineWidth(0.5).strokeColor("#888").moveTo(50, doc.y).lineTo(592, doc.y).stroke();
    doc.moveDown(0.2);

    // Lines
    doc.font("Helvetica").fontSize(9);
    const renderRow = (l: Form1040xLine, headline: boolean) => {
      const y = doc.y;
      doc.fillColor(headline ? "#000" : "#444");
      if (headline) doc.font("Helvetica-Bold");
      doc.text(l.lineRef, lineRefX, y, { width: 26, align: "right" });
      doc.text(l.label, labelX, y, { width: 300 });
      doc.text(fmt$(l.original), colAX, y, { width: colWidth, align: "right" });
      const netChangeColor = l.netChange > 0 ? "#aa3300" : l.netChange < 0 ? "#0a5d2a" : (headline ? "#000" : "#444");
      doc.fillColor(netChangeColor);
      doc.text(fmt$(l.netChange), colBX, y, { width: colWidth, align: "right" });
      doc.fillColor(headline ? "#000" : "#444");
      doc.text(fmt$(l.amended), colCX, y, { width: colWidth, align: "right" });
      if (headline) doc.font("Helvetica");
      doc.moveDown(0.2);
    };
    for (const l of form.lines) {
      // Headline rows: total tax (11), total payments (17), refund (21).
      renderRow(l, l.lineRef === "11" || l.lineRef === "17" || l.lineRef === "21");
    }

    // P2-7 — nonrefundable-credit component breakdown (only when present).
    if (form.creditDetail.length > 0) {
      doc.moveDown(0.2);
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#555").text("Nonrefundable credit detail (supplementary)", labelX, doc.y);
      doc.font("Helvetica").fontSize(9);
      doc.moveDown(0.1);
      for (const l of form.creditDetail) renderRow(l, false);
    }

    // P2-7 — amended state return summary.
    doc.moveDown(0.2);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#555").text("Amended state return summary", labelX, doc.y);
    doc.font("Helvetica").fontSize(9);
    doc.moveDown(0.1);
    for (const l of form.stateLines) renderRow(l, false);

    doc.moveDown(0.5);

    // Bottom-line delta callout
    const calloutY = doc.y;
    const isRefund = form.netFederalRefundChange >= 0;
    doc
      .rect(50, calloutY, 542, 50)
      .lineWidth(1)
      .strokeColor(isRefund ? "#0a5d2a" : "#aa3300")
      .stroke();
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(isRefund ? "#0a5d2a" : "#aa3300")
      .text(isRefund ? "Additional refund due to taxpayer" : "Additional tax owed", 60, calloutY + 8);
    doc
      .fontSize(18)
      .text(fmt$(Math.abs(form.netFederalRefundChange)), 60, calloutY + 24);
    doc
      .fontSize(9)
      .fillColor("#555")
      .text(
        form.netStateRefundChange !== 0
          ? `State change: ${fmt$(form.netStateRefundChange)} (${form.netStateRefundChange >= 0 ? "refund" : "owed"})`
          : "No state-level change",
        260,
        calloutY + 30,
      );
    doc.y = calloutY + 60;
    doc.moveDown(0.5);

    // Part III explanation
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor("#000")
      .text("Part III — Explanation of changes");
    doc.moveDown(0.2);
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#222")
      .text(
        form.explanation || "(No explanation provided. Required by IRS — CPA must complete before mailing.)",
        { width: 542 },
      );

    doc.end();
  });
}
