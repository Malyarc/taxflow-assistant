/**
 * Return-level diagnostics engine (P1-5 / P2-16).
 *
 * The critical/warning/informational checklist a CPA runs before handing a
 * return off for filing. Consumes the assembled `TaxReturnInputs` (client +
 * raw W-2/1099 facts) plus the `ComputedTaxReturn`, and emits a clearable
 * "ready to hand off" panel.
 *
 * Design:
 *   - PURE (no DB / I/O / Date / random) so it ports 1:1 into Haven and is
 *     trivially unit-testable. The DB-backed route assembles the inputs.
 *   - Builds on the shared W-2 box-arithmetic validator (`validateW2`) — the
 *     diagnostics engine folds those flags in rather than re-implementing them.
 *   - Conservative by construction: every check is actionable and avoids
 *     false alarms (e.g. "$0 CTC" is only surfaced as INFO with the reason,
 *     never as a bug, because it can be a legitimate phase-out / no-liability).
 *
 * Severity contract:
 *   - "critical": the return is NOT ready to file (a value is missing that the
 *     IRS requires, or a computation is incomplete). Blocks "ready to hand off".
 *   - "warning":  likely a data-entry problem or a risk the CPA should confirm.
 *   - "info":     an explanation / opportunity / heads-up; never blocks.
 */
import type {
  ClientFacts,
  W2Fact,
  Form1099Fact,
  ComputedTaxReturn,
} from "./taxReturnEngine";
import { validateW2, type W2DataLike, type ValidationContext, type W2FlagSeverity } from "@workspace/validation";
import { validate1099, type Form1099DataLike } from "@workspace/validation";
import { STATE_TAX_DATA } from "./stateTaxData";

/** validateW2 uses "error"; the diagnostics panel uses "critical" for the same. */
function mapW2Severity(s: W2FlagSeverity): DiagnosticSeverity {
  return s === "error" ? "critical" : s;
}

export type DiagnosticSeverity = "critical" | "warning" | "info";

export type DiagnosticCategory =
  | "Filing & identity"
  | "Dependents & credits"
  | "Income documents"
  | "State & local"
  | "Payments & balance"
  | "Health coverage (ACA)"
  | "Audit risk (DIF)"
  | "MeF e-file rules";

export interface ReturnDiagnostic {
  /** Stable check id (e.g. "state-code-invalid") — lets the UI dedupe / suppress. */
  id: string;
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  /** Short human title. */
  title: string;
  /** One-to-two sentence explanation + the action the CPA should take. */
  detail: string;
  /** Optional field hint for deep-linking the UI. */
  field?: string | null;
  /**
   * T1.5 #4 — the IRS Modernized e-File (MeF) business-rule number this check
   * mirrors (e.g. "F8962-070", "F1040-034-06", "SEIC-F1040-535-04"), so a CPA
   * knows which reject their filing software would issue. Present only on the
   * "MeF e-file rules" diagnostics.
   */
  mefRule?: string;
}

export interface ReturnDiagnosticsResult {
  diagnostics: ReturnDiagnostic[];
  counts: { critical: number; warning: number; info: number; total: number };
  /** True when there are zero criticals — the "ready to hand off" gate. */
  readyToHandOff: boolean;
}

/** USPS jurisdiction codes the engine recognises (50 states + DC). */
const VALID_STATE_CODES = new Set(Object.keys(STATE_TAX_DATA));

function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function last4(ssn: string | null | undefined): string {
  return (ssn ?? "").replace(/\D/g, "").slice(-4);
}

/** Does this resident state levy a broad personal income tax on wages? */
function stateTaxesWages(code: string | null | undefined): boolean {
  if (!code) return false;
  const info = STATE_TAX_DATA[code.toUpperCase()];
  // NH/TN historically tax only interest/dividends → not wages. The engine
  // models that via hasIncomeTax=false for wage purposes.
  return Boolean(info?.hasIncomeTax);
}

/**
 * Compute the pre-filing diagnostics checklist.
 *
 * @param client   The client facts (filing status, dependents, ACA, etc.).
 * @param w2s       The W-2 rows. Accepts the richer DB row shape (all boxes)
 *                  OR the engine's W2Fact subset — box-arithmetic checks simply
 *                  skip boxes that are absent.
 * @param form1099s The 1099 rows.
 * @param computed  The computed return (credit results, balances, totals).
 */
export function computeReturnDiagnostics(args: {
  client: ClientFacts;
  w2s: Array<W2Fact | W2DataLike>;
  form1099s: Form1099Fact[];
  computed: ComputedTaxReturn;
}): ReturnDiagnosticsResult {
  const { client, w2s, form1099s, computed } = args;
  const out: ReturnDiagnostic[] = [];
  const push = (d: ReturnDiagnostic) => out.push(d);

  const filingStatus = client.filingStatus;
  const isMfj = filingStatus === "married_filing_jointly" || filingStatus === "qualifying_widow";
  const isMfs = filingStatus === "married_filing_separately";
  const taxYear = computed.taxYear;

  // ─────────────────────────────────────────────────────────────────────
  // Category: Filing & identity
  // ─────────────────────────────────────────────────────────────────────

  // D1 — invalid / missing resident state code. The state return can't be
  // computed and the federal e-file requires a valid address state.
  const stateCode = (client.state ?? "").toUpperCase();
  if (!stateCode) {
    push({
      id: "state-code-missing",
      severity: "critical",
      category: "Filing & identity",
      title: "Resident state is missing",
      detail: "No resident state is set on the client. Set the state before filing — the state return and many residency-based rules depend on it.",
      field: "state",
    });
  } else if (!VALID_STATE_CODES.has(stateCode)) {
    push({
      id: "state-code-invalid",
      severity: "critical",
      category: "Filing & identity",
      title: `Resident state "${client.state}" is not a recognized code`,
      detail: "The resident state must be a two-letter USPS code (50 states or DC). Correct it before filing.",
      field: "state",
    });
  }

  // D2 — kiddie-tax filer flagged but the parent's marginal rate is missing,
  // so Form 8615 cannot be computed (the engine falls back to $0 kiddie tax).
  if (client.isKiddieTaxFiler && toNum(client.parentsTopMarginalRate) <= 0) {
    push({
      id: "kiddie-missing-parent-rate",
      severity: "critical",
      category: "Filing & identity",
      title: "Kiddie tax (Form 8615) is incomplete",
      detail: "This return is flagged as a kiddie-tax filer but the parent's top marginal rate is not set, so the Form 8615 tax on net unearned income cannot be computed. Enter the parent's marginal rate.",
      field: "parentsTopMarginalRate",
    });
  }

  // D3 — MFS with a spouse not lived-apart: SS is 85% taxable and many credits
  // are disallowed. Surface it so the CPA confirms the lived-apart flag.
  if (isMfs && toNum(client.socialSecurityBenefits) > 0 && !client.mfsLivedApartAllYear) {
    push({
      id: "mfs-ss-lived-apart-unset",
      severity: "info",
      category: "Filing & identity",
      title: "MFS Social Security uses the 85% rule",
      detail: "Filing MFS with Social Security benefits and 'lived apart all year' unset means 85% of benefits are treated as taxable (Pub 915). Confirm whether the taxpayer lived apart from their spouse the entire year.",
      field: "mfsLivedApartAllYear",
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Category: Dependents & credits
  // ─────────────────────────────────────────────────────────────────────

  const ctc = computed.childTaxCredit;
  const under17 = toNum(client.dependentsUnder17);
  if (under17 > 0 && ctc && (ctc.appliedCredit + ctc.refundableActc) === 0) {
    // Not necessarily a bug: phase-out at high AGI, or no tax liability AND
    // earned income below the $2,500 ACTC floor. Surface as INFO with the
    // most likely reason so the CPA can confirm.
    const phasedOut = ctc.phaseOutReduction > 0;
    push({
      id: "ctc-zero",
      severity: "info",
      category: "Dependents & credits",
      title: `Child Tax Credit is $0 with ${under17} qualifying child${under17 > 1 ? "ren" : ""}`,
      detail: phasedOut
        ? "The Child Tax Credit fully phased out at this AGI. Verify the dependent count and AGI are correct."
        : "No Child Tax Credit applied. This is expected when there is no tax liability and earned income is below $2,500 (the refundable ACTC floor). Verify earned income and the dependent count.",
      field: "dependentsUnder17",
    });
  }

  // D5 — EITC disallowed for a plausibly-eligible profile. The engine only sets
  // an ineligibilityReason for the three "gotcha" cases (MFS, investment income
  // over the limit, no earned income) — a plain AGI phase-out leaves it blank.
  // Surface the investment-income disqualifier always (the client was otherwise
  // in EITC income range and got knocked out — a real planning flag), and the
  // no-earned-income case only when there are qualifying children (else it's a
  // retiree, where "no earned income" is expected and not actionable).
  const eitc = computed.eitc;
  if (eitc && !eitc.eligible && eitc.ineligibilityReason) {
    const reason = eitc.ineligibilityReason;
    const isInvestmentDisqualifier = reason.startsWith("Investment income");
    const noEarnedWithKids = reason === "No earned income" && eitc.qualifyingChildren > 0;
    if (isInvestmentDisqualifier || noEarnedWithKids) {
      push({
        id: "eitc-ineligible",
        severity: "info",
        category: "Dependents & credits",
        title: "EITC was not allowed",
        detail: `Earned Income Tax Credit disallowed: ${reason}. If the client expected EITC, verify the disqualifying item.`,
        field: null,
      });
    }
  }

  // D6 — dependent-care dependents but $0 care credit → likely the child-care
  // expense adjustment wasn't entered (or MFS disqualifies it).
  const careCount = toNum(client.dependentsForCareCredit);
  const careCredit = computed.dependentCareCredit;
  if (careCount > 0 && careCredit && careCredit.appliedCredit === 0) {
    push({
      id: "care-credit-zero",
      severity: "warning",
      category: "Dependents & credits",
      title: `Dependent care credit is $0 with ${careCount} qualifying dependent${careCount > 1 ? "s" : ""}`,
      detail: isMfs
        ? "The Child & Dependent Care Credit is generally disallowed for MFS filers (§21(e)(2)) unless lived apart. Confirm filing status."
        : "No care credit applied. Verify the child-care expense amount was entered and that both spouses (if MFJ) have earned income.",
      field: "dependentsForCareCredit",
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Category: Income documents — W-2 box arithmetic (delegated to validateW2)
  // ─────────────────────────────────────────────────────────────────────

  const knownSsns = w2s
    .map((w) => (w as W2DataLike).employeeSSN)
    .filter((s): s is string => Boolean(s));
  const ctx: ValidationContext = {
    clientTaxYear: taxYear,
    clientState: stateCode || undefined,
    knownSsns,
  };
  w2s.forEach((w, idx) => {
    const rec = w as W2DataLike;
    const flags = validateW2(rec, ctx);
    const employer = rec.employerName?.trim() || `W-2 #${idx + 1}`;
    for (const f of flags) {
      push({
        id: `w2-${idx}-${f.field ?? "record"}-${f.severity}`,
        severity: mapW2Severity(f.severity),
        category: "Income documents",
        title: `${employer}: ${f.field ?? "record"} check`,
        detail: f.message,
        field: f.field,
      });
    }
  });

  // P2-12 — 1099 box-arithmetic checks (DIV qualified ≤ ordinary, R taxable ≤
  // gross, B proceeds−basis ≈ gain/loss, withholding plausibility, etc.).
  form1099s.forEach((rec, idx) => {
    const flags = validate1099(rec as Form1099DataLike, { clientTaxYear: taxYear, clientState: stateCode || undefined });
    const label = (rec.payerName ?? "").toString().trim() || `1099 #${idx + 1}`;
    const ft = (rec.formType ?? "").toString().toUpperCase();
    for (const f of flags) {
      push({
        id: `1099-${idx}-${f.field ?? "record"}-${f.severity}`,
        severity: f.severity === "error" ? "critical" : f.severity,
        category: "Income documents",
        title: `${label}${ft ? ` (1099-${ft})` : ""}: ${f.field ?? "record"} check`,
        detail: f.message,
        field: f.field,
      });
    }
  });

  // D-income — return has zero income and no source documents. Almost always a
  // data-entry omission (documents not yet attached).
  const hasAnyIncomeDoc = w2s.length > 0 || form1099s.length > 0;
  if (!hasAnyIncomeDoc && computed.totalIncome === 0) {
    push({
      id: "no-income-docs",
      severity: "warning",
      category: "Income documents",
      title: "No income documents and $0 total income",
      detail: "This return has no W-2s, no 1099s, and $0 of total income. Confirm all income documents have been entered before filing.",
      field: null,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Category: State & local
  // ─────────────────────────────────────────────────────────────────────

  // D8 — a W-2 sourced to a different state than the resident state: a
  // non-resident return may be required.
  const nonResidentW2States = new Set<string>();
  for (const w of w2s) {
    const sc = ((w as W2DataLike).stateCode ?? "").toUpperCase();
    if (sc && stateCode && sc !== stateCode && VALID_STATE_CODES.has(sc)) {
      nonResidentW2States.add(sc);
    }
  }
  if (nonResidentW2States.size > 0) {
    push({
      id: "nonresident-state-wages",
      severity: "info",
      category: "State & local",
      title: `Wages sourced to other state(s): ${[...nonResidentW2States].sort().join(", ")}`,
      detail: "One or more W-2s are sourced to a state other than the resident state. Confirm whether a non-resident state return is required and that a resident credit for taxes paid is claimed.",
      field: null,
    });
  }

  // D9 — resident state taxes wages, the client has wage income, but no W-2
  // carries a state code AND no state tax was withheld → likely missing state
  // data on the W-2s.
  const totalWages = w2s.reduce((s, w) => s + toNum((w as W2DataLike).wagesBox1), 0);
  const anyW2HasStateCode = w2s.some((w) => Boolean((w as W2DataLike).stateCode));
  const totalStateWithheld = toNum(computed.stateTaxWithheld);
  if (
    stateTaxesWages(stateCode) &&
    totalWages > 0 &&
    !anyW2HasStateCode &&
    totalStateWithheld === 0
  ) {
    push({
      id: "missing-w2-state-data",
      severity: "warning",
      category: "State & local",
      title: "No state code or state withholding on any W-2",
      detail: `The resident state (${stateCode}) taxes wages, but no W-2 carries a state code and no state tax was withheld. Verify the W-2 boxes 15–17 were entered.`,
      field: "stateCode",
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Category: Payments & balance
  // ─────────────────────────────────────────────────────────────────────

  // D10 — material federal balance due → §6654 underpayment-penalty exposure.
  const federalOwed = -toNum(computed.federalRefundOrOwed); // positive = owes
  if (federalOwed > 1_000) {
    push({
      id: "federal-balance-due",
      severity: "warning",
      category: "Payments & balance",
      title: `Federal balance due of $${Math.round(federalOwed).toLocaleString()}`,
      detail: "A balance due over $1,000 can trigger a §6654 underpayment penalty. Check the Form 2210 safe harbor (90% of this year or 100%/110% of last year) and whether estimated payments are needed next year.",
      field: null,
    });
  }

  // D12 — very large refund relative to withholding → over-withheld; a W-4
  // adjustment is a (small) opportunity.
  const federalRefund = toNum(computed.federalRefundOrOwed);
  const federalWithheld = toNum(computed.federalTaxWithheld);
  if (federalRefund > 5_000 && federalWithheld > 0 && federalRefund > 0.25 * federalWithheld) {
    push({
      id: "large-refund",
      severity: "info",
      category: "Payments & balance",
      title: `Large federal refund of $${Math.round(federalRefund).toLocaleString()}`,
      detail: "A refund this large means the client over-withheld during the year. Consider a W-4 adjustment so they keep more per paycheck.",
      field: null,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Category: Health coverage (ACA) — Form 8962 reconciliation
  // ─────────────────────────────────────────────────────────────────────

  const aptc = toNum(client.acaAdvanceAptc);
  const slcsp = toNum(client.acaAnnualSlcsp);
  const acaPremium = toNum(client.acaAnnualPremium);
  if (aptc > 0 && slcsp <= 0) {
    push({
      id: "aca-aptc-no-slcsp",
      severity: "critical",
      category: "Health coverage (ACA)",
      title: "Advance premium credit can't be reconciled",
      detail: "Advance Premium Tax Credit was received but the Second Lowest Cost Silver Plan (SLCSP) benchmark is missing. Form 8962 is required to reconcile APTC — enter the SLCSP from Form 1095-A column B before filing.",
      field: "acaAnnualSlcsp",
    });
  }
  if (acaPremium > 0 && (client.acaHouseholdSize == null || toNum(client.acaHouseholdSize) <= 0)) {
    push({
      id: "aca-missing-household-size",
      severity: "info",
      category: "Health coverage (ACA)",
      title: "ACA household size not set",
      detail: "Marketplace premiums are present but the household size for the FPL determination is not set. The engine defaults to filer + dependents; confirm it matches Form 1095-A.",
      field: "acaHouseholdSize",
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Category: Dependents & credits — "ready to file" cross-checks (T2.2 D2)
  // ─────────────────────────────────────────────────────────────────────

  // RF1 — EITC qualifying-children count exceeds the claimed dependents. EITC
  // qualifying children must also be the taxpayer's dependents; a higher EITC
  // count than (under-17 + other dependents) is an inconsistency that inflates
  // the refundable credit and is a top IRS examination trigger.
  const eitcKids = toNum(client.eitcQualifyingChildren);
  const totalDependents = under17 + toNum(client.otherDependents);
  if (eitcKids > 0 && eitcKids > totalDependents) {
    push({
      id: "eitc-exceeds-dependents",
      severity: "warning",
      category: "Dependents & credits",
      title: `EITC qualifying children (${eitcKids}) exceed claimed dependents (${totalDependents})`,
      detail: "The number of EITC qualifying children is greater than the dependents on the return. EITC children must also be claimed as dependents (with valid SSNs); reconcile the counts before filing — a mismatch inflates the refundable EITC and is a common audit trigger.",
      field: "eitcQualifyingChildren",
    });
  }

  // RF2 — refundable child/earned-income credits claimed → SSN reminder. The
  // engine models dependent COUNTS, not per-dependent SSNs; ACTC (§24(h)(7)) and
  // EITC require a valid SSN issued by the return due date. Surface a reminder
  // so the CPA confirms each qualifying child's SSN before filing.
  const refundableChildEitc = toNum(computed.additionalChildTaxCredit) + toNum(eitc?.appliedCredit);
  if (refundableChildEitc > 0 && (under17 > 0 || eitcKids > 0)) {
    push({
      id: "qualifying-child-ssn-reminder",
      severity: "info",
      category: "Dependents & credits",
      title: "Confirm each qualifying child's SSN before filing",
      detail: "Refundable child / earned-income credits are claimed. The ACTC (§24(h)(7)) and EITC require each qualifying child to have a valid SSN issued before the return due date (an ITIN does not qualify for these credits). Verify the SSNs — the engine tracks counts, not SSNs.",
      field: null,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Category: Audit risk (DIF) — data-driven examination-likelihood flags
  // ─────────────────────────────────────────────────────────────────────

  // RF3 — large Schedule E rental loss. A sizable rental loss (especially one
  // deducted against ordinary income via a real-estate-professional / active-
  // participation claim) is a known DIF / §469 examination flag. The engine's
  // signed gross rental net is exposed; the SE-base Schedule C loss is floored
  // to $0 in the outputs, so the rental loss is the detectable business-loss
  // DIF signal here.
  const rentalNet = toNum(computed.scheduleERentalGrossNet);
  if (rentalNet < -10_000) {
    push({
      id: "dif-rental-loss",
      severity: "info",
      category: "Audit risk (DIF)",
      title: `Schedule E rental loss of $${Math.round(-rentalNet).toLocaleString()}`,
      detail: "A sizable rental real-estate loss raises the IRS DIF score (§469 passive-loss limits / real-estate-professional substantiation). Confirm material-participation hours if claiming real-estate-professional status, the $25k active-participation allowance phase-out, and that suspended passive losses are tracked.",
      field: null,
    });
  }

  // RF4 — high charitable-to-AGI ratio. Large noncash or cash charitable
  // relative to income is a top DIF flag (and large noncash needs Form 8283 /
  // a qualified appraisal over $5,000).
  const charitable = toNum(computed.scheduleA?.charitableDeductible);
  const agi = toNum(computed.adjustedGrossIncome);
  if (charitable > 0 && agi > 0 && charitable / agi > 0.30) {
    push({
      id: "dif-charitable-ratio",
      severity: "info",
      category: "Audit risk (DIF)",
      title: `Charitable deduction is ${Math.round((charitable / agi) * 100)}% of AGI`,
      detail: "Charitable contributions large relative to AGI raise the DIF score. Verify contemporaneous written acknowledgments for gifts ≥ $250, and that noncash gifts over $500 have Form 8283 (over $5,000 a qualified appraisal). The engine applies the 60%/30%/50%-of-AGI ceilings and carries the excess forward.",
      field: null,
    });
  }

  // RF5 — material carryforwards generated to next year. A planning heads-up so
  // the CPA threads them into next year's return (the prior-year roll-forward).
  const carryforwards: Array<[string, number]> = [
    ["net operating loss (§172)", toNum(computed.nolCarryforwardRemaining)],
    ["capital loss (short)", toNum(computed.capitalLossCarryforwardShort)],
    ["capital loss (long)", toNum(computed.capitalLossCarryforwardLong)],
    ["passive activity loss (§469)", toNum(computed.scheduleEPassiveLossSuspended)],
    ["charitable (§170(d)(1))", toNum(computed.charitableCarryforwardCashRemaining)],
  ];
  const materialCfs = carryforwards.filter(([, v]) => v > 1_000);
  if (materialCfs.length > 0) {
    push({
      id: "carryforwards-to-next-year",
      severity: "info",
      category: "Payments & balance",
      title: `${materialCfs.length} carryforward${materialCfs.length > 1 ? "s" : ""} generated for next year`,
      detail:
        "This return generates carryforwards that must be threaded into next year's return: " +
        materialCfs.map(([name, v]) => `${name} $${Math.round(v).toLocaleString()}`).join("; ") +
        ". Roll them forward when preparing the next year so the deductions aren't lost.",
      field: null,
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Category: MeF e-file rules (T1.5 #4) — the public IRS Modernized e-File
  // business rules that a CPA's filing software would REJECT on, surfaced before
  // filing and tagged with the reject-rule number. The engine already PREVENTS
  // the hard data-rejects by construction (it refuses to credit excess SS from a
  // single employer per F1040-021, floors impossible negatives, bars MFS EITC,
  // requires SLCSP for APTC — the critical `aca-aptc-no-slcsp` above is the
  // reachable F8962 reject). What remains are the e-file gates the engine CANNOT
  // self-check (per-child SSN/age, the spouse's itemize election, a prior EITC
  // disallowance) + confirmations that a required form is attached.
  // ─────────────────────────────────────────────────────────────────────

  // M2 — F1040-034-06 / F1040-035-06: MFS itemize consistency. If a taxpayer's
  // spouse itemizes, the taxpayer MUST itemize (cannot take the standard
  // deduction), and vice versa. The engine can't see the spouse's return, so
  // surface it as a confirm-before-file reminder whenever filing MFS.
  if (isMfs) {
    const usingStandard = toNum(computed.itemizedDeductions) <= toNum(computed.standardDeduction)
      || computed.itemizedDeductions == null;
    push({
      id: "mef-mfs-itemize-consistency",
      severity: "info",
      category: "MeF e-file rules",
      title: "MFS: confirm the spouse's itemize election matches",
      detail: usingStandard
        ? "This MFS return uses the standard deduction. If the spouse itemizes, this return must itemize too (and the standard deduction becomes $0) — e-file rejects an inconsistent pair. Confirm the spouse's election."
        : "This MFS return itemizes. The spouse's return must also itemize (cannot take the standard deduction) — confirm the pair is consistent before filing.",
      field: null,
      // NOT a single MeF reject code — it's a §63(c)(6)(A) computation rule the
      // software enforces (the standard deduction is forced to $0 when the spouse
      // itemizes). Cite the statute, not a reject number (F1040-034 is the
      // unrelated federal-withholding-match rule — do not mis-cite it).
      mefRule: "§63(c)(6)(A) · Pub 501",
    });
  }

  // M3 — F8959: Additional Medicare Tax present → Form 8959 must accompany the
  // return. The engine includes it; this confirms the attachment for e-file.
  if (toNum(computed.additionalMedicareTax) > 0) {
    push({
      id: "mef-form-8959-required",
      severity: "info",
      category: "MeF e-file rules",
      title: "Form 8959 (Additional Medicare Tax) is required",
      detail: "Additional Medicare Tax applies, so Form 8959 must be filed with the return (the engine includes it). Ensure the filing software attaches Form 8959 and reconciles the 0.9% withholding (Form 8959 Part IV).",
      field: null,
      // Required-attachment rule, not a single published reject number; cite the
      // form + statute rather than an unverifiable code.
      mefRule: "Form 8959 required (§3101(b)(2))",
    });
  }

  // M4 — F8962-070: when APTC was paid (Form 1095-A), Form 8962 MUST be filed to
  // reconcile it — the single most common ACA e-file reject. The incomplete-data
  // case (no SLCSP) is already CRITICAL above; this is the always-on requirement.
  const aptcPaid = toNum(client.acaAdvanceAptc) > 0 || toNum(computed.premiumTaxCredit?.advanceAptc) > 0;
  if (aptcPaid && slcsp > 0) {
    push({
      id: "mef-form-8962-required",
      severity: "info",
      category: "MeF e-file rules",
      title: "Form 8962 (Premium Tax Credit) is required",
      detail: "Advance Premium Tax Credit was paid, so Form 8962 must reconcile it on the return (the engine computes it). A return that omits Form 8962 when a 1095-A shows APTC e-files as a reject (F8962-070).",
      field: null,
      mefRule: "F8962-070",
    });
  }

  // M5 — SEIC-F1040-535-04 / -501-02: EITC qualifying-child age + SSN rules. The
  // engine models counts, not per-child age/SSN; surface the e-file gates so the
  // CPA confirms each child qualifies (the SSN reminder is separate, RF2).
  if (eitc?.eligible && toNum(eitc.qualifyingChildren) > 0) {
    push({
      id: "mef-eitc-qualifying-child-rules",
      severity: "info",
      category: "MeF e-file rules",
      title: "EITC: confirm each qualifying child's age and SSN",
      detail: "EITC is claimed with qualifying children. e-file enforces that each child is under 19 (under 24 if a full-time student, or any age if permanently disabled), younger than the taxpayer, and has a valid SSN — a violation rejects (SEIC-F1040-535 / -501). The engine tracks counts only; confirm each child meets the §32(c)(3) tests.",
      field: null,
      mefRule: "SEIC-F1040-535-04 / SEIC-F1040-501-02",
    });
  }

  // M6 — Schedule H present → it must be attached (and SE/employment-tax e-file
  // rules apply). Confirms the attachment.
  if (toNum(computed.scheduleH?.total) > 0) {
    push({
      id: "mef-schedule-h-required",
      severity: "info",
      category: "MeF e-file rules",
      title: "Schedule H (household employment tax) is required",
      detail: "Household-employee FICA/FUTA applies, so Schedule H must be filed with the return (the engine includes it on Schedule 2 line 9). Ensure the filing software attaches Schedule H and that the household employer has an EIN.",
      field: null,
      mefRule: "SH-F1040-520-01",
    });
  }

  // M7 — F1040-164-01: claiming EITC after a prior IRS disallowance requires
  // Form 8862. Not detectable from a single return; reminder when EITC is claimed.
  if (eitc?.eligible && toNum(eitc.appliedCredit) > 0) {
    push({
      id: "mef-eitc-form-8862",
      severity: "info",
      category: "MeF e-file rules",
      title: "If EITC was previously disallowed, Form 8862 is required",
      detail: "EITC is claimed. If the IRS disallowed or reduced the taxpayer's EITC in a prior year, Form 8862 must be attached to claim it again — omitting it rejects (F1040-164-01). Confirm there is no open disallowance.",
      field: null,
      mefRule: "F1040-164-01",
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Tally
  // ─────────────────────────────────────────────────────────────────────
  const counts = {
    critical: out.filter((d) => d.severity === "critical").length,
    warning: out.filter((d) => d.severity === "warning").length,
    info: out.filter((d) => d.severity === "info").length,
    total: out.length,
  };
  // Deterministic ordering: critical → warning → info, stable within severity.
  const rank: Record<DiagnosticSeverity, number> = { critical: 0, warning: 1, info: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    diagnostics: out,
    counts,
    readyToHandOff: counts.critical === 0,
  };
}
