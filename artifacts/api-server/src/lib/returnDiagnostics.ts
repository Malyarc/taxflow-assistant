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
  | "Health coverage (ACA)";

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
