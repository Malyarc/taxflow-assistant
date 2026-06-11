/**
 * T2.2 D2 — Personalized client organizer / document-request list.
 *
 * Generates the year-start "please send us…" checklist a CPA firm sends every
 * client, personalized from what the client ACTUALLY had last year plus their
 * profile: every prior-year W-2 employer, 1099 payer, K-1 entity, rental
 * property, and account statement becomes a tracked request, marked
 * "received" the moment the matching current-year record exists.
 *
 * PURE (no Date/random/DB) — the route loads the rows; fixtures drive tests.
 *
 * Status semantics:
 *   received — a matching NON-PROFORMA record exists in the target year's
 *              per-year tables. Roll-forward copies are proforma estimates
 *              (no document behind them) and deliberately do NOT count —
 *              otherwise rolling a client forward would mark every document
 *              "already on file" and defeat the request list. A proforma row
 *              flips real when the CPA updates it (PATCH clears the flag) or
 *              when a document-backed/new row is created.
 *   missing  — expected (from prior year / profile) but no real record yet.
 *   question — yes/no items we can't detect from data (life events).
 * Deduction-document reminders are always "missing": adjustments are not
 * year-scoped in this schema, so receipt can't be auto-detected — the CPA
 * checks them off on the printed/PDF list.
 */

import { toNum } from "./taxReturnEngine";

export type OrganizerCategory = "income" | "business_rental" | "deductions_credits" | "life_events";
export type OrganizerStatus = "missing" | "received" | "question";

export interface OrganizerItem {
  /** Stable id, e.g. "w2:acme corp" — used as the checklist key. */
  id: string;
  category: OrganizerCategory;
  title: string;
  detail: string;
  status: OrganizerStatus;
  source: "prior_year" | "profile";
}

export interface OrganizerResult {
  taxYear: number;
  priorYear: number;
  items: OrganizerItem[];
  counts: { missing: number; received: number; questions: number };
}

// Structural row shapes (satisfied by the Drizzle rows AND plain fixtures).
// `proforma` marks roll-forward estimates — never counted as received.
export interface OrganizerW2Row { employerName?: string | null; proforma?: boolean | null }
export interface Organizer1099Row { formType: string; payerName?: string | null; proforma?: boolean | null }
export interface OrganizerK1Row { entityName?: string | null; entityType?: string | null; proforma?: boolean | null }
export interface OrganizerRentalRow { address?: string | null; proforma?: boolean | null }
export interface OrganizerAssetRow { accountName?: string | null; assetType?: string | null; proforma?: boolean | null }

export interface OrganizerClientFacts {
  filingStatus: string;
  socialSecurityBenefits?: number | string | null;
  dependentsUnder17?: number | null;
  otherDependents?: number | null;
  dependentsForCareCredit?: number | null;
  hsaIsFamilyCoverage?: boolean | null;
  acaAnnualPremium?: number | string | null;
}

/** The prior-year persisted return values that drive deduction reminders. */
export interface OrganizerPriorReturnFacts {
  mortgageDeductible?: number;
  charitableDeductible?: number;
  medicalDeductible?: number;
  saltDeductible?: number;
  aocCredit?: number;
  llcCredit?: number;
  studentLoanInterestDeduction?: number;
  hsaDeduction?: number;
  iraDeduction?: number;
  selfEmploymentTax?: number;
  sehiDeduction?: number;
}

export interface YearDataRows {
  w2s: OrganizerW2Row[];
  form1099s: Organizer1099Row[];
  scheduleK1s: OrganizerK1Row[];
  rentalProperties: OrganizerRentalRow[];
  assetBalances: OrganizerAssetRow[];
}

export interface BuildOrganizerArgs {
  taxYear: number;
  client: OrganizerClientFacts;
  priorYear: YearDataRows;
  currentYear: YearDataRows;
  priorReturn?: OrganizerPriorReturnFacts | null;
}

const FORM_1099_LABELS: Record<string, string> = {
  nec: "1099-NEC", misc: "1099-MISC", int: "1099-INT", div: "1099-DIV",
  b: "1099-B", r: "1099-R", g: "1099-G", k: "1099-K",
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Receipt detection ignores proforma (roll-forward estimate) rows. */
function real<T extends { proforma?: boolean | null }>(rows: T[]): T[] {
  return rows.filter((r) => r.proforma !== true);
}

export function buildClientOrganizer(args: BuildOrganizerArgs): OrganizerResult {
  const { taxYear, client, priorYear, currentYear, priorReturn } = args;
  const items: OrganizerItem[] = [];
  const seen = new Set<string>();
  const push = (item: OrganizerItem) => {
    if (seen.has(item.id)) return; // duplicate prior-year rows collapse to one request
    seen.add(item.id);
    items.push(item);
  };

  // ── Income documents expected from the prior year ─────────────────────────
  const realW2s = real(currentYear.w2s);
  const currentW2Names = new Set(realW2s.map((w) => norm(w.employerName)));
  for (const w2 of priorYear.w2s) {
    const name = norm(w2.employerName);
    const label = w2.employerName?.trim() || "(unnamed employer)";
    // An unnamed prior W-2 matches ANY current-year W-2 (best effort).
    const received = name ? currentW2Names.has(name) : realW2s.length > 0;
    push({
      id: `w2:${name || "unnamed"}`,
      category: "income",
      title: `Form W-2 — ${label}`,
      detail: `Wage statement from ${label} (received last year).`,
      status: received ? "received" : "missing",
      source: "prior_year",
    });
  }

  const real1099s = real(currentYear.form1099s);
  const current1099Keys = new Set(real1099s.map((f) => `${norm(f.formType)}|${norm(f.payerName)}`));
  const current1099Types = new Set(real1099s.map((f) => norm(f.formType)));
  for (const f of priorYear.form1099s) {
    const type = norm(f.formType);
    const formLabel = FORM_1099_LABELS[type] ?? `1099-${type.toUpperCase()}`;
    const payer = f.payerName?.trim() || "(unnamed payer)";
    const key = `${type}|${norm(f.payerName)}`;
    // Match payer-exact first; an unnamed prior payer matches any same-type 1099.
    const received = norm(f.payerName) ? current1099Keys.has(key) : current1099Types.has(type);
    push({
      id: `1099:${type}:${norm(f.payerName) || "unnamed"}`,
      category: "income",
      title: `Form ${formLabel} — ${payer}`,
      detail: `${formLabel} from ${payer} (received last year).`,
      status: received ? "received" : "missing",
      source: "prior_year",
    });
  }

  const currentK1Names = new Set(real(currentYear.scheduleK1s).map((k) => norm(k.entityName)));
  for (const k1 of priorYear.scheduleK1s) {
    const name = k1.entityName?.trim() || "(unnamed entity)";
    const form = (k1.entityType ?? "") === "s_corp" ? "1120-S" : "1065";
    push({
      id: `k1:${norm(k1.entityName) || "unnamed"}`,
      category: "income",
      title: `Schedule K-1 (Form ${form}) — ${name}`,
      detail: `Pass-through K-1 from ${name}. These often arrive late — confirm the entity's filing timeline.`,
      status: currentK1Names.has(norm(k1.entityName)) ? "received" : "missing",
      source: "prior_year",
    });
  }

  if (toNum(client.socialSecurityBenefits) > 0) {
    push({
      id: "ssa:benefits",
      category: "income",
      title: "Form SSA-1099 — Social Security benefit statement",
      detail: "Annual benefit statement (Box 5) for the taxable-benefit worksheet.",
      status: "missing",
      source: "profile",
    });
  }

  // ── Business / rental ──────────────────────────────────────────────────────
  const currentRentals = new Set(real(currentYear.rentalProperties).map((r) => norm(r.address)));
  for (const r of priorYear.rentalProperties) {
    const label = r.address?.trim() || "(rental property)";
    push({
      id: `rental:${norm(r.address) || "unnamed"}`,
      category: "business_rental",
      title: `Rental activity — ${label}`,
      detail: "Annual rent received, expenses by category, and any capital improvements or disposition.",
      status: currentRentals.has(norm(r.address)) ? "received" : "missing",
      source: "prior_year",
    });
  }
  const priorHadSe =
    priorYear.form1099s.some((f) => norm(f.formType) === "nec") ||
    toNum(priorReturn?.selfEmploymentTax) > 0;
  if (priorHadSe) {
    push({
      id: "sched-c:books",
      category: "business_rental",
      title: "Self-employment income & expense summary",
      detail: "Year-end P&L (or bookkeeping export), new equipment purchases, and business-use-of-home / mileage logs.",
      status: "missing",
      source: "prior_year",
    });
    push({
      id: "sched-c:estimates",
      category: "business_rental",
      title: "Estimated tax payments made (Form 1040-ES)",
      detail: "Dates and amounts of each federal + state estimated payment for the year.",
      status: "missing",
      source: "prior_year",
    });
  }

  const currentAccounts = new Set(real(currentYear.assetBalances).map((a) => norm(a.accountName)));
  for (const a of priorYear.assetBalances) {
    const label = a.accountName?.trim() || "(account)";
    push({
      id: `account:${norm(a.accountName) || "unnamed"}`,
      category: "business_rental",
      title: `Year-end statement — ${label}`,
      detail: `December statement for ${label} (${a.assetType ?? "account"}) for basis + planning carryover.`,
      status: currentAccounts.has(norm(a.accountName)) ? "received" : "missing",
      source: "prior_year",
    });
  }

  // ── Deductions & credits (reminders keyed off prior-year usage / profile) ──
  const reminder = (id: string, title: string, detail: string, when: boolean) => {
    if (!when) return;
    push({ id, category: "deductions_credits", title, detail, status: "missing", source: "prior_year" });
  };
  reminder("ded:1098", "Form 1098 — mortgage interest", "Lender statement(s); include points and any refinance closing disclosure.", toNum(priorReturn?.mortgageDeductible) > 0);
  reminder("ded:charitable", "Charitable contribution receipts", "Acknowledgment letters for gifts ≥ $250; itemized list of cash + non-cash donations (FMV for non-cash).", toNum(priorReturn?.charitableDeductible) > 0);
  reminder("ded:medical", "Medical expense records", "Out-of-pocket medical/dental totals (you itemized medical last year — the 7.5%-of-AGI floor applies).", toNum(priorReturn?.medicalDeductible) > 0);
  reminder("ded:salt", "Property tax + state payment records", "Property-tax bills paid and any state estimated/balance-due payments (SALT-cap inputs).", toNum(priorReturn?.saltDeductible) > 0);
  reminder("ded:1098t", "Form 1098-T — tuition statement", "From the school, plus receipts for books/required materials (education credits).", toNum(priorReturn?.aocCredit) + toNum(priorReturn?.llcCredit) > 0);
  reminder("ded:1098e", "Form 1098-E — student loan interest", "Servicer statement for the §221 deduction.", toNum(priorReturn?.studentLoanInterestDeduction) > 0);
  // hsaIsFamilyCoverage is NOT NULL DEFAULT false on the clients table — only an
  // EXPLICIT true (or a prior-year HSA deduction) signals an HSA exists.
  reminder("ded:hsa", "Forms 5498-SA / 1099-SA — HSA", "Contribution + distribution statements for Form 8889.", toNum(priorReturn?.hsaDeduction) > 0 || client.hsaIsFamilyCoverage === true);
  reminder("ded:ira", "Form 5498 — IRA contributions", "Contribution confirmation (deductibility re-tested each year).", toNum(priorReturn?.iraDeduction) > 0);
  reminder("ded:sehi", "Health insurance premium statements", "Self-employed health premiums paid (Form 7206 §162(l) deduction).", toNum(priorReturn?.sehiDeduction) > 0);
  if (toNum(client.dependentsForCareCredit) > 0) {
    push({
      id: "ded:childcare",
      category: "deductions_credits",
      title: "Childcare provider statement",
      detail: "Provider name, address, EIN/SSN, and amount paid per child (Form 2441).",
      status: "missing",
      source: "profile",
    });
  }
  if (toNum(client.acaAnnualPremium) > 0) {
    push({
      id: "ded:1095a",
      category: "deductions_credits",
      title: "Form 1095-A — marketplace health insurance",
      detail: "Required to reconcile the Premium Tax Credit (Form 8962) — the return can't be filed without it.",
      status: "missing",
      source: "profile",
    });
  }

  // ── Life-events questionnaire (always asked; not data-detectable) ─────────
  const question = (id: string, title: string, detail: string) =>
    push({ id, category: "life_events", title, detail, status: "question", source: "profile" });
  question("q:address-filing", "Address / marital status changes?", "Moved (especially across state lines), married, divorced, or widowed during the year?");
  question("q:dependents", "Dependents changed?", "Births, adoptions, children who started college, or dependents who moved out / can no longer be claimed?");
  question("q:home", "Bought or sold a home?", "Closing disclosures for any purchase, sale, or refinance (the §121 exclusion may apply to a primary-residence sale).");
  question("q:digital-assets", "Digital asset transactions?", "Did you receive, sell, exchange, or otherwise dispose of any digital asset (crypto/NFT)? The 1040 asks every filer.");
  question("q:new-income", "New income sources?", "New job, side business, rental, inheritance, gambling winnings, or anything that felt like income?");
  question("q:energy", "Energy-efficient improvements or EV purchase?", "Heat pumps, solar, insulation, windows, or a new/used electric vehicle (§25C/§25D/§30D credits).");
  question("q:529-education", "Education funding activity?", "529 contributions/distributions or student-loan payoff events?");

  const counts = {
    missing: items.filter((i) => i.status === "missing").length,
    received: items.filter((i) => i.status === "received").length,
    questions: items.filter((i) => i.status === "question").length,
  };
  return { taxYear, priorYear: taxYear - 1, items, counts };
}
