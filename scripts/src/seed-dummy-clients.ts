/**
 * Seed 85 dummy CPA-client archetypes for design-partner demos + Phase G
 * end-to-end exercise. Idempotent — checks email before insert so re-runs
 * are no-ops.
 *
 * Categories from the Phase G plan:
 *   Simple W-2 only          (20 archetypes)
 *   Moderate complexity      (30 archetypes)
 *   High complexity          (25 archetypes)
 *   Edge cases               (10 archetypes)
 *
 * Run (with API running on localhost:8080):
 *   pnpm --filter @workspace/scripts exec tsx src/seed-dummy-clients.ts
 *
 * Optional: pass --reset to delete all seeded clients first.
 */

const BASE = "http://localhost:8080/api";
const TAG = "seed-dummy";

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(`${opts.method ?? "GET"} ${path} -> ${res.status}: ${txt}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

type Filing = "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household" | "qualifying_widow";

interface W2 {
  wagesBox1: number;
  federalTaxWithheldBox2?: number;
  stateCode: string;
  socialSecurityWagesBox3?: number;
  medicareWagesBox5?: number;
  spouse?: "taxpayer" | "spouse";
}

interface Form1099 {
  formType: "nec" | "misc" | "int" | "div" | "b" | "r" | "g" | "k";
  payerName: string;
  nonemployeeCompensation?: number;
  interestIncome?: number;
  ordinaryDividends?: number;
  qualifiedDividends?: number;
  shortTermGainLoss?: number;
  longTermGainLoss?: number;
  taxableAmount?: number;
}

interface K1 {
  entityName: string;
  entityType?: "partnership" | "s_corp";
  activityType?: "active" | "passive";
  box1OrdinaryIncome?: number;
  section199aQbi?: number;
}

interface Adjustment {
  adjustmentType: string;
  amount: number;
}

interface Archetype {
  /** Stable label used in firstName / lastName + tagged email. */
  slug: string;
  /** Friendly description (CPA notes) */
  notes: string;
  filingStatus: Filing;
  state: string;
  taxYear: number;
  dependentsUnder17?: number;
  otherDependents?: number;
  taxpayerAge?: number;
  spouseAge?: number;
  socialSecurityBenefits?: number;
  isKiddieTaxFiler?: boolean;
  parentsTopMarginalRate?: number;
  iraCoveredByWorkplacePlan?: boolean;
  hsaIsFamilyCoverage?: boolean;
  rentalActiveParticipant?: boolean;
  localityCode?: string;
  w2s?: W2[];
  form1099s?: Form1099[];
  k1s?: K1[];
  adjustments?: Adjustment[];
}

function emailFor(slug: string): string {
  return `${TAG}.${slug}@taxflow.local`;
}

// ── Archetype catalog ──────────────────────────────────────────────────────

const ARCHETYPES: Archetype[] = [];

// ============================================================================
// SIMPLE W-2 ONLY (20 archetypes) — basic variations across states + filing
// statuses + dependent counts. AGI $30k-$120k.
// ============================================================================
const simpleW2: Array<[string, string, Filing, string, number, number, number]> = [
  ["single-fl-30k", "Single FL recent grad", "single", "FL", 30000, 0, 0],
  ["single-tx-50k", "Single TX, no withholding edge", "single", "TX", 50000, 0, 0],
  ["single-ca-80k", "Single CA mid-career", "single", "CA", 80000, 0, 0],
  ["single-ny-100k", "Single NY", "single", "NY", 100000, 0, 0],
  ["single-wa-120k", "Single WA tech (no state tax)", "single", "WA", 120000, 0, 0],
  ["hoh-ca-45k-1k", "HoH CA single parent", "head_of_household", "CA", 45000, 1, 0],
  ["hoh-tx-60k-2k", "HoH TX two kids", "head_of_household", "TX", 60000, 2, 0],
  ["hoh-fl-75k-2k", "HoH FL school-age kids", "head_of_household", "FL", 75000, 2, 0],
  ["hoh-il-50k-3k", "HoH IL three kids EITC", "head_of_household", "IL", 32000, 3, 0],
  ["hoh-ny-90k-1k", "HoH NY one teen", "head_of_household", "NY", 90000, 1, 0],
  ["mfj-fl-60k-0k", "MFJ FL childless", "married_filing_jointly", "FL", 60000, 0, 0],
  ["mfj-tx-90k-2k", "MFJ TX two kids", "married_filing_jointly", "TX", 90000, 2, 0],
  ["mfj-ca-100k-1k", "MFJ CA one kid", "married_filing_jointly", "CA", 100000, 1, 0],
  ["mfj-il-110k-2k", "MFJ IL two kids", "married_filing_jointly", "IL", 110000, 2, 0],
  ["mfj-ny-120k-3k", "MFJ NY three kids", "married_filing_jointly", "NY", 120000, 3, 0],
  ["mfj-pa-95k-2k", "MFJ PA two kids", "married_filing_jointly", "PA", 95000, 2, 0],
  ["mfj-oh-65k-0k", "MFJ OH no deps", "married_filing_jointly", "OH", 65000, 0, 0],
  ["mfs-fl-50k-0k", "MFS FL separated", "married_filing_separately", "FL", 50000, 0, 0],
  ["mfs-ca-70k-0k", "MFS CA separated", "married_filing_separately", "CA", 70000, 0, 0],
  ["qss-tx-55k-2k", "QSS TX widowed two kids", "qualifying_widow", "TX", 55000, 2, 0],
];
for (const [slug, notes, fs, state, wages, kids, _other] of simpleW2) {
  ARCHETYPES.push({
    slug, notes, filingStatus: fs, state, taxYear: 2024,
    dependentsUnder17: kids,
    w2s: [{ wagesBox1: wages, federalTaxWithheldBox2: Math.round(wages * 0.10), stateCode: state }],
  });
}

// ============================================================================
// MODERATE COMPLEXITY (30 archetypes)
// ============================================================================

// Sole-prop consultant TX — triggers SEP-IRA opportunity (G1.1)
ARCHETYPES.push({
  slug: "moderate-sole-prop-tx",
  notes: "Sole-prop consultant TX (G1.1 SEP-IRA candidate)",
  filingStatus: "single", state: "TX", taxYear: 2024,
  form1099s: [{ formType: "nec", payerName: "Consulting Client", nonemployeeCompensation: 80000 }],
});

// Side 1099-NEC on top of W-2
ARCHETYPES.push({
  slug: "moderate-side-gig",
  notes: "W-2 day job + side 1099-NEC",
  filingStatus: "single", state: "CO", taxYear: 2024,
  w2s: [{ wagesBox1: 60000, federalTaxWithheldBox2: 6000, stateCode: "CO" }],
  form1099s: [{ formType: "nec", payerName: "Side Hustle", nonemployeeCompensation: 18000 }],
});

// Retiree with SS + pension
ARCHETYPES.push({
  slug: "moderate-retiree-pa",
  notes: "Retiree MFJ PA, SS + pension (state SS exempt)",
  filingStatus: "married_filing_jointly", state: "PA", taxYear: 2024,
  taxpayerAge: 70, spouseAge: 68,
  socialSecurityBenefits: 35000,
  form1099s: [{ formType: "r", payerName: "Pension Co", taxableAmount: 25000 }],
});

// Tech worker NY+NYC
ARCHETYPES.push({
  slug: "moderate-tech-ny-150k",
  notes: "Tech worker single NY + NYC",
  filingStatus: "single", state: "NY", taxYear: 2024,
  localityCode: "NYC",
  w2s: [{ wagesBox1: 150000, federalTaxWithheldBox2: 22000, stateCode: "NY" }],
});

// Single mom EITC (FL, low income)
ARCHETYPES.push({
  slug: "moderate-eitc-mom-fl",
  notes: "Single mom HoH FL two kids EITC eligible",
  filingStatus: "head_of_household", state: "FL", taxYear: 2024,
  dependentsUnder17: 2,
  w2s: [{ wagesBox1: 28000, federalTaxWithheldBox2: 1500, stateCode: "FL" }],
});

// ACA marketplace family
ARCHETYPES.push({
  slug: "moderate-aca-family",
  notes: "MFJ ACA premium tax credit reconciliation",
  filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
  dependentsUnder17: 2,
  w2s: [{ wagesBox1: 55000, federalTaxWithheldBox2: 4000, stateCode: "FL" }],
  adjustments: [
    { adjustmentType: "additional_income", amount: 0 },
  ],
});

// Multi-W-2 MFJ both working
ARCHETYPES.push({
  slug: "moderate-mfj-dual-w2",
  notes: "MFJ both W-2 earners",
  filingStatus: "married_filing_jointly", state: "MA", taxYear: 2024,
  dependentsUnder17: 1,
  w2s: [
    { wagesBox1: 95000, federalTaxWithheldBox2: 14000, stateCode: "MA" },
    { wagesBox1: 75000, federalTaxWithheldBox2: 9000, stateCode: "MA", spouse: "spouse" },
  ],
});

// Student loan interest claim
ARCHETYPES.push({
  slug: "moderate-student-loans",
  notes: "Young professional with student-loan interest",
  filingStatus: "single", state: "GA", taxYear: 2024,
  w2s: [{ wagesBox1: 65000, federalTaxWithheldBox2: 7000, stateCode: "GA" }],
  adjustments: [
    { adjustmentType: "student_loan_interest", amount: 2500 },
  ],
});

// HSA contribution + employer plan
ARCHETYPES.push({
  slug: "moderate-hsa-family",
  notes: "MFJ family HSA + IRA covered",
  filingStatus: "married_filing_jointly", state: "MN", taxYear: 2024,
  hsaIsFamilyCoverage: true, iraCoveredByWorkplacePlan: true,
  w2s: [{ wagesBox1: 110000, federalTaxWithheldBox2: 13000, stateCode: "MN" }],
  adjustments: [
    { adjustmentType: "hsa_contribution", amount: 8300 },
    { adjustmentType: "ira_contribution_traditional", amount: 7000 },
  ],
});

// Sch E rental real estate — moderate
ARCHETYPES.push({
  slug: "moderate-rental-tx",
  notes: "TX single rental, active participant",
  filingStatus: "married_filing_jointly", state: "TX", taxYear: 2024,
  rentalActiveParticipant: true,
  w2s: [{ wagesBox1: 110000, federalTaxWithheldBox2: 12000, stateCode: "TX" }],
  adjustments: [
    { adjustmentType: "schedule_e_rental_income", amount: 24000 },
    { adjustmentType: "schedule_e_rental_expenses", amount: 14000 },
    { adjustmentType: "schedule_e_macrs_depreciation", amount: 8000 },
  ],
});

// Modest charitable + itemizable
ARCHETYPES.push({
  slug: "moderate-bunching-candidate",
  notes: "Single near-cliff itemized (G1.3 candidate)",
  filingStatus: "single", state: "FL", taxYear: 2024,
  w2s: [{ wagesBox1: 90000, federalTaxWithheldBox2: 11000, stateCode: "FL" }],
  adjustments: [
    { adjustmentType: "state_income_tax", amount: 5000 },
    { adjustmentType: "state_property_tax", amount: 2000 },
    { adjustmentType: "mortgage_interest", amount: 3000 },
    { adjustmentType: "charitable_cash", amount: 4000 },
  ],
});

// Dividend + interest income, moderate AGI
ARCHETYPES.push({
  slug: "moderate-dividends",
  notes: "Investor with $20k dividends",
  filingStatus: "married_filing_jointly", state: "OR", taxYear: 2024,
  w2s: [{ wagesBox1: 130000, federalTaxWithheldBox2: 18000, stateCode: "OR" }],
  form1099s: [
    { formType: "div", payerName: "Index Fund", ordinaryDividends: 20000, qualifiedDividends: 16000 },
    { formType: "int", payerName: "Savings", interestIncome: 3000 },
  ],
});

// Roth conversion candidate (lower bracket, no age)
ARCHETYPES.push({
  slug: "moderate-roth-window",
  notes: "Single MFJ in 12% bracket (G1.4 candidate)",
  filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
  taxpayerAge: 60, spouseAge: 58,
  w2s: [{ wagesBox1: 130000, federalTaxWithheldBox2: 16000, stateCode: "FL" }],
});

// Educator family
ARCHETYPES.push({
  slug: "moderate-educator-mfj",
  notes: "Public-school teachers MFJ IL educator-expense deduction",
  filingStatus: "married_filing_jointly", state: "IL", taxYear: 2024,
  dependentsUnder17: 2,
  w2s: [
    { wagesBox1: 60000, federalTaxWithheldBox2: 6000, stateCode: "IL" },
    { wagesBox1: 58000, federalTaxWithheldBox2: 5800, stateCode: "IL", spouse: "spouse" },
  ],
});

// IRA rollover + traditional IRA
ARCHETYPES.push({
  slug: "moderate-ira-rollover",
  notes: "1099-R IRA rollover taxable",
  filingStatus: "single", state: "AZ", taxYear: 2024,
  taxpayerAge: 55,
  form1099s: [{ formType: "r", payerName: "Vanguard", taxableAmount: 50000 }],
});

// HSA self-only
ARCHETYPES.push({
  slug: "moderate-hsa-self",
  notes: "Single self-only HSA",
  filingStatus: "single", state: "MI", taxYear: 2024,
  w2s: [{ wagesBox1: 95000, federalTaxWithheldBox2: 11000, stateCode: "MI" }],
  adjustments: [{ adjustmentType: "hsa_contribution", amount: 4150 }],
});

// Saver's Credit eligible
ARCHETYPES.push({
  slug: "moderate-savers-credit",
  notes: "Low-AGI single with retirement contribution",
  filingStatus: "single", state: "TN", taxYear: 2024,
  w2s: [{ wagesBox1: 32000, federalTaxWithheldBox2: 1500, stateCode: "TN" }],
  adjustments: [{ adjustmentType: "retirement_contributions_savers", amount: 2000 }],
});

// 1099-MISC rents (royalties)
ARCHETYPES.push({
  slug: "moderate-royalty",
  notes: "Author with 1099-MISC royalties",
  filingStatus: "single", state: "OR", taxYear: 2024,
  form1099s: [{ formType: "misc", payerName: "Publisher", interestIncome: 0 }],
  adjustments: [{ adjustmentType: "additional_income", amount: 18000 }],
});

// Energy credit residential
ARCHETYPES.push({
  slug: "moderate-energy-credit",
  notes: "MFJ with residential solar credit",
  filingStatus: "married_filing_jointly", state: "AZ", taxYear: 2024,
  w2s: [{ wagesBox1: 140000, federalTaxWithheldBox2: 18000, stateCode: "AZ" }],
  adjustments: [{ adjustmentType: "residential_clean_energy", amount: 8000 }],
});

// AOC family
ARCHETYPES.push({
  slug: "moderate-aoc",
  notes: "MFJ + 1 college student AOC",
  filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
  dependentsUnder17: 0, otherDependents: 1,
  w2s: [{ wagesBox1: 120000, federalTaxWithheldBox2: 14000, stateCode: "FL" }],
  adjustments: [{ adjustmentType: "qualified_education_expenses_aoc", amount: 8000 }],
});

// LLC student
ARCHETYPES.push({
  slug: "moderate-llc",
  notes: "Single grad student LLC credit",
  filingStatus: "single", state: "MA", taxYear: 2024,
  w2s: [{ wagesBox1: 55000, federalTaxWithheldBox2: 5500, stateCode: "MA" }],
  adjustments: [{ adjustmentType: "qualified_education_expenses_llc", amount: 6000 }],
});

// Dependent care MFJ
ARCHETYPES.push({
  slug: "moderate-depcare",
  notes: "MFJ daycare expenses",
  filingStatus: "married_filing_jointly", state: "WA", taxYear: 2024,
  dependentsForCareCredit: 1, dependentsUnder17: 1,
  w2s: [
    { wagesBox1: 95000, federalTaxWithheldBox2: 12000, stateCode: "WA" },
    { wagesBox1: 60000, federalTaxWithheldBox2: 6000, stateCode: "WA", spouse: "spouse" },
  ],
  adjustments: [{ adjustmentType: "dependent_care_expenses", amount: 6000 }],
});

// Schedule A heavy itemizer near cliff
ARCHETYPES.push({
  slug: "moderate-schA-cliff",
  notes: "Single near std-ded cliff with charity (G1.3)",
  filingStatus: "single", state: "FL", taxYear: 2024,
  w2s: [{ wagesBox1: 65000, federalTaxWithheldBox2: 7000, stateCode: "FL" }],
  adjustments: [
    { adjustmentType: "state_income_tax", amount: 5000 },
    { adjustmentType: "mortgage_interest", amount: 7000 },
    { adjustmentType: "charitable_cash", amount: 3000 },
  ],
});

// NY+NJ commuter
ARCHETYPES.push({
  slug: "moderate-ny-nj-commuter",
  notes: "MFJ NY resident NJ W-2 source",
  filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024,
  w2s: [
    { wagesBox1: 100000, federalTaxWithheldBox2: 13000, stateCode: "NY" },
    { wagesBox1: 80000, federalTaxWithheldBox2: 10000, stateCode: "NJ", spouse: "spouse" },
  ],
});

// MA state EITC piggyback
ARCHETYPES.push({
  slug: "moderate-ma-state-eitc",
  notes: "MA single parent piggyback EITC",
  filingStatus: "head_of_household", state: "MA", taxYear: 2024,
  dependentsUnder17: 1,
  w2s: [{ wagesBox1: 30000, federalTaxWithheldBox2: 1500, stateCode: "MA" }],
});

// CO state EITC
ARCHETYPES.push({
  slug: "moderate-co-state-eitc",
  notes: "CO single parent state EITC",
  filingStatus: "head_of_household", state: "CO", taxYear: 2024,
  dependentsUnder17: 2,
  w2s: [{ wagesBox1: 35000, federalTaxWithheldBox2: 2000, stateCode: "CO" }],
});

// HI retiree
ARCHETYPES.push({
  slug: "moderate-hi-retiree",
  notes: "HI retiree pension exempt",
  filingStatus: "married_filing_jointly", state: "HI", taxYear: 2024,
  taxpayerAge: 72, spouseAge: 70,
  form1099s: [{ formType: "r", payerName: "HI Pension", taxableAmount: 50000 }],
});

// NJ retiree partial exemption
ARCHETYPES.push({
  slug: "moderate-nj-retiree",
  notes: "NJ retiree partial retirement exemption (age 62+)",
  filingStatus: "married_filing_jointly", state: "NJ", taxYear: 2024,
  taxpayerAge: 66, spouseAge: 64,
  form1099s: [{ formType: "r", payerName: "NJ Pension", taxableAmount: 60000 }],
});

// NY retiree partial exemption
ARCHETYPES.push({
  slug: "moderate-ny-retiree",
  notes: "NY retiree $20k per filer pension exemption",
  filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024,
  taxpayerAge: 68, spouseAge: 66,
  form1099s: [{ formType: "r", payerName: "NY Pension", taxableAmount: 70000 }],
});

// MFJ + 1099-DIV qualified
ARCHETYPES.push({
  slug: "moderate-qualified-divs",
  notes: "MFJ low-W-2 high qualified divs",
  filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
  w2s: [{ wagesBox1: 70000, federalTaxWithheldBox2: 7000, stateCode: "FL" }],
  form1099s: [
    { formType: "div", payerName: "Index Fund", ordinaryDividends: 25000, qualifiedDividends: 22000 },
  ],
});

// ============================================================================
// HIGH COMPLEXITY (25 archetypes)
// ============================================================================

// Tech founder + ISO bargain + AMT bind (G1.5)
ARCHETYPES.push({
  slug: "high-tech-founder-iso",
  notes: "Tech worker single $250k W-2 + $100k ISO bargain (G1.5)",
  filingStatus: "single", state: "CA", taxYear: 2024,
  w2s: [{ wagesBox1: 250000, federalTaxWithheldBox2: 50000, stateCode: "CA" }],
  adjustments: [{ adjustmentType: "amt_iso_bargain_element", amount: 100000 }],
});

// RE investor MFJ 5 rentals
ARCHETYPES.push({
  slug: "high-re-investor-mfj",
  notes: "RE investor MFJ 5 rentals (Sch E aggregate)",
  filingStatus: "married_filing_jointly", state: "TX", taxYear: 2024,
  rentalActiveParticipant: true,
  w2s: [{ wagesBox1: 130000, federalTaxWithheldBox2: 15000, stateCode: "TX" }],
  adjustments: [
    { adjustmentType: "schedule_e_rental_income", amount: 180000 },
    { adjustmentType: "schedule_e_rental_expenses", amount: 110000 },
    { adjustmentType: "schedule_e_macrs_depreciation", amount: 65000 },
  ],
});

// S-corp owner + K-1 + §199A QBI candidate (G1.7)
ARCHETYPES.push({
  slug: "high-scorp-mfj-qbi",
  notes: "MFJ S-corp owner + W-2 + K-1 + §199A in phase-in (G1.7)",
  filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
  w2s: [{ wagesBox1: 200000, federalTaxWithheldBox2: 30000, stateCode: "FL" }],
  k1s: [{ entityName: "OwnerCo S-Corp", entityType: "s_corp", activityType: "active",
    box1OrdinaryIncome: 300000, section199aQbi: 300000 }],
});

// Day trader + STCG + LTCG
ARCHETYPES.push({
  slug: "high-day-trader",
  notes: "Single trader $40k W-2 + $120k LTCG + $60k STCG (G1.9 candidate)",
  filingStatus: "single", state: "NY", taxYear: 2024,
  w2s: [{ wagesBox1: 40000, federalTaxWithheldBox2: 3500, stateCode: "NY" }],
  form1099s: [{ formType: "b", payerName: "Brokerage",
    longTermGainLoss: 120000, shortTermGainLoss: 60000 }],
});

// Multi-state K-1 owner
ARCHETYPES.push({
  slug: "high-multi-state-k1",
  notes: "NY resident K-1 owner (G1.2 PTET candidate)",
  filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024,
  w2s: [{ wagesBox1: 80000, federalTaxWithheldBox2: 11000, stateCode: "NY" }],
  k1s: [{ entityName: "Tri-State Partners", entityType: "s_corp", activityType: "active",
    box1OrdinaryIncome: 300000 }],
  adjustments: [
    { adjustmentType: "state_income_tax", amount: 20000 },
    { adjustmentType: "state_property_tax", amount: 15000 },
    { adjustmentType: "mortgage_interest", amount: 25000 },
  ],
});

// Doctor $400k + Roth + AMT
ARCHETYPES.push({
  slug: "high-doctor-400k",
  notes: "Doctor MFJ $400k + DAF candidate (G1.8)",
  filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
  taxpayerAge: 52, spouseAge: 50,
  w2s: [{ wagesBox1: 400000, federalTaxWithheldBox2: 80000, stateCode: "FL" }],
  adjustments: [
    { adjustmentType: "charitable_cash", amount: 20000 },
    { adjustmentType: "ira_contribution_traditional", amount: 7000 },
  ],
});

// Expat with FEIE + FTC (G1.10)
ARCHETYPES.push({
  slug: "high-expat-feie-ftc",
  notes: "Expat single $90k W-2 + foreign tax (G1.10 candidate)",
  filingStatus: "single", state: "FL", taxYear: 2024,
  w2s: [{ wagesBox1: 90000, federalTaxWithheldBox2: 10000, stateCode: "FL" }],
  adjustments: [
    { adjustmentType: "foreign_tax_paid", amount: 5000 },
    { adjustmentType: "foreign_source_taxable_income", amount: 10000 },
  ],
});

// QSBS founder
ARCHETYPES.push({
  slug: "high-qsbs-founder",
  notes: "Founder MFJ $5M QSBS sale (§1202 exclusion)",
  filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024,
  w2s: [{ wagesBox1: 200000, federalTaxWithheldBox2: 30000, stateCode: "CA" }],
  adjustments: [
    { adjustmentType: "qsbs_gross_gain", amount: 5000000 },
    { adjustmentType: "qsbs_adjusted_basis", amount: 200000 },
  ],
});

// Recently widowed QSS
ARCHETYPES.push({
  slug: "high-qss-widow",
  notes: "QSS year-of transition (deceased spouse last year)",
  filingStatus: "qualifying_widow", state: "FL", taxYear: 2024,
  dependentsUnder17: 2,
  w2s: [{ wagesBox1: 110000, federalTaxWithheldBox2: 13000, stateCode: "FL" }],
});

// NY+NYC high SALT + jumbo mortgage
ARCHETYPES.push({
  slug: "high-nyc-jumbo",
  notes: "NY+NYC high SALT + mortgage $1M (G1.3 + G1.8)",
  filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024,
  localityCode: "NYC",
  w2s: [{ wagesBox1: 500000, federalTaxWithheldBox2: 100000, stateCode: "NY" }],
  adjustments: [
    { adjustmentType: "state_income_tax", amount: 35000 },
    { adjustmentType: "state_property_tax", amount: 20000 },
    { adjustmentType: "mortgage_interest", amount: 30000 },
    { adjustmentType: "charitable_cash", amount: 15000 },
  ],
});

// MFJ both SE
ARCHETYPES.push({
  slug: "high-mfj-both-se",
  notes: "MFJ both spouses self-employed",
  filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
  form1099s: [
    { formType: "nec", payerName: "Husband Co.", nonemployeeCompensation: 90000 },
    { formType: "nec", payerName: "Wife Co.", nonemployeeCompensation: 80000 },
  ],
});

// MFS rare edge
ARCHETYPES.push({
  slug: "high-mfs-rare",
  notes: "MFS with spouse, SS taxability edge",
  filingStatus: "married_filing_separately", state: "CA", taxYear: 2024,
  taxpayerAge: 68,
  socialSecurityBenefits: 22000,
  form1099s: [{ formType: "r", payerName: "Pension", taxableAmount: 40000 }],
});

// CA PTET candidate
ARCHETYPES.push({
  slug: "high-ca-ptet",
  notes: "CA MFJ S-corp PTET candidate",
  filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024,
  k1s: [{ entityName: "CA S-Corp", entityType: "s_corp", activityType: "active",
    box1OrdinaryIncome: 500000 }],
  adjustments: [
    { adjustmentType: "state_income_tax", amount: 40000 },
    { adjustmentType: "state_property_tax", amount: 20000 },
    { adjustmentType: "mortgage_interest", amount: 30000 },
  ],
});

// Big charitable + tech
ARCHETYPES.push({
  slug: "high-tech-charitable",
  notes: "Single tech $300k + $25k charitable (G1.8)",
  filingStatus: "single", state: "WA", taxYear: 2024,
  w2s: [{ wagesBox1: 300000, federalTaxWithheldBox2: 60000, stateCode: "WA" }],
  adjustments: [{ adjustmentType: "charitable_cash", amount: 25000 }],
});

// Sch C consultant high SE
ARCHETYPES.push({
  slug: "high-consultant-200k",
  notes: "Single consultant $200k SE (G1.1 SEP)",
  filingStatus: "single", state: "TX", taxYear: 2024,
  form1099s: [{ formType: "nec", payerName: "Big Client", nonemployeeCompensation: 200000 }],
});

// HSA + IRA + workplace plan covered
ARCHETYPES.push({
  slug: "high-savings-stacker",
  notes: "MFJ stacker HSA + IRA + 401(k)",
  filingStatus: "married_filing_jointly", state: "MA", taxYear: 2024,
  hsaIsFamilyCoverage: true, iraCoveredByWorkplacePlan: true,
  taxpayerAge: 50, spouseAge: 48,
  w2s: [{ wagesBox1: 180000, federalTaxWithheldBox2: 26000, stateCode: "MA" }],
  adjustments: [
    { adjustmentType: "hsa_contribution", amount: 8300 },
    { adjustmentType: "ira_contribution_traditional", amount: 7000 },
  ],
});

// SEHI
ARCHETYPES.push({
  slug: "high-sehi-se",
  notes: "SE consultant + self-employed health insurance premiums",
  filingStatus: "single", state: "AZ", taxYear: 2024,
  form1099s: [{ formType: "nec", payerName: "Consult Co.", nonemployeeCompensation: 120000 }],
  adjustments: [{ adjustmentType: "self_employed_health_insurance_premiums", amount: 14000 }],
});

// §121 home sale exclusion
ARCHETYPES.push({
  slug: "high-home-sale",
  notes: "MFJ primary residence sale §121 exclusion",
  filingStatus: "married_filing_jointly", state: "TX", taxYear: 2024,
  w2s: [{ wagesBox1: 180000, federalTaxWithheldBox2: 22000, stateCode: "TX" }],
  adjustments: [{ adjustmentType: "home_sale_gross_gain_primary_residence", amount: 650000 }],
});

// FEIE expat
ARCHETYPES.push({
  slug: "high-feie",
  notes: "Expat single Singapore W-2 $150k FEIE",
  filingStatus: "single", state: "FL", taxYear: 2024,
  w2s: [{ wagesBox1: 150000, federalTaxWithheldBox2: 0, stateCode: "FL" }],
  adjustments: [{ adjustmentType: "foreign_earned_income", amount: 126500 }],
});

// Partnership K-1 (SE earnings)
ARCHETYPES.push({
  slug: "high-partnership-k1",
  notes: "Partner with partnership K-1 box 14A SE",
  filingStatus: "single", state: "NY", taxYear: 2024,
  k1s: [{ entityName: "Partnership", entityType: "partnership", activityType: "active",
    box1OrdinaryIncome: 0, section199aQbi: 0 }],
  adjustments: [{ adjustmentType: "additional_income", amount: 220000 }],
});

// MFJ + ACA reconciliation
ARCHETYPES.push({
  slug: "high-aca-recon",
  notes: "MFJ ACA marketplace high APTC",
  filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
  dependentsUnder17: 2,
  w2s: [{ wagesBox1: 70000, federalTaxWithheldBox2: 6000, stateCode: "FL" }],
});

// Foreign tax paid > simplified, with foreign source
ARCHETYPES.push({
  slug: "high-ftc-mfj",
  notes: "MFJ $8k FTC + $20k foreign source (G1.10 strong fit)",
  filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024,
  w2s: [{ wagesBox1: 250000, federalTaxWithheldBox2: 40000, stateCode: "FL" }],
  adjustments: [
    { adjustmentType: "foreign_tax_paid", amount: 8000 },
    { adjustmentType: "foreign_source_taxable_income", amount: 20000 },
  ],
});

// HoH ACTC heavy
ARCHETYPES.push({
  slug: "high-hoh-actc",
  notes: "HoH with low income, large refundable CTC/ACTC",
  filingStatus: "head_of_household", state: "OK", taxYear: 2024,
  dependentsUnder17: 3,
  w2s: [{ wagesBox1: 25000, federalTaxWithheldBox2: 800, stateCode: "OK" }],
});

// AMT prefs + iso big binding
ARCHETYPES.push({
  slug: "high-amt-binding",
  notes: "MFJ + $200k ISO + AMT bind (G1.5 big)",
  filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024,
  w2s: [{ wagesBox1: 400000, federalTaxWithheldBox2: 80000, stateCode: "CA" }],
  adjustments: [{ adjustmentType: "amt_iso_bargain_element", amount: 200000 }],
});

// NY high SALT + K-1 + PTET
ARCHETYPES.push({
  slug: "high-ny-ptet",
  notes: "NY high earner K-1 owner + huge SALT (G1.2)",
  filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024,
  w2s: [{ wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "NY" }],
  k1s: [{ entityName: "NY S-Corp", entityType: "s_corp", activityType: "active",
    box1OrdinaryIncome: 600000 }],
  adjustments: [
    { adjustmentType: "state_income_tax", amount: 50000 },
    { adjustmentType: "state_property_tax", amount: 25000 },
    { adjustmentType: "mortgage_interest", amount: 40000 },
  ],
});

// ============================================================================
// EDGE CASES (10 archetypes)
// ============================================================================

// WA $1M LTCG (G4 excise binding)
ARCHETYPES.push({
  slug: "edge-wa-1m-ltcg",
  notes: "WA single $1M LTCG (G4 excise)",
  filingStatus: "single", state: "WA", taxYear: 2024,
  form1099s: [{ formType: "b", payerName: "Brokerage", longTermGainLoss: 1000000 }],
});

// Kiddie tax filer
ARCHETYPES.push({
  slug: "edge-kiddie-tax",
  notes: "Kiddie tax filer $30k unearned income",
  filingStatus: "single", state: "FL", taxYear: 2024,
  taxpayerAge: 16,
  isKiddieTaxFiler: true, parentsTopMarginalRate: 0.32,
  form1099s: [{ formType: "int", payerName: "Trust", interestIncome: 30000 }],
});

// MN MFJ 3 kids low income (G2 WFC + CTC)
ARCHETYPES.push({
  slug: "edge-mn-mfj-wfc",
  notes: "MN MFJ 3 kids low income (WFC + CTC)",
  filingStatus: "married_filing_jointly", state: "MN", taxYear: 2024,
  dependentsUnder17: 3,
  w2s: [{ wagesBox1: 30000, federalTaxWithheldBox2: 1000, stateCode: "MN" }],
});

// NOL carryforward
ARCHETYPES.push({
  slug: "edge-nol-carryforward",
  notes: "NOL $80k carryforward + $100k W-2 (K4 80% limit)",
  filingStatus: "single", state: "FL", taxYear: 2024,
  w2s: [{ wagesBox1: 100000, federalTaxWithheldBox2: 15000, stateCode: "FL" }],
  adjustments: [{ adjustmentType: "nol_carryforward", amount: 80000 }],
});

// NIIT cliff (G1.6) — AGI must land within ±$10k of $200k threshold
ARCHETYPES.push({
  slug: "edge-niit-cliff",
  notes: "Single AGI $205k + $10k NII (G1.6 cliff: AGI in $190k-$210k band)",
  filingStatus: "single", state: "FL", taxYear: 2024,
  w2s: [{ wagesBox1: 195000, federalTaxWithheldBox2: 35000, stateCode: "FL" }],
  form1099s: [
    { formType: "int", payerName: "Bank", interestIncome: 10000 },
  ],
});

// Big LTCG single (top bracket stacking)
ARCHETYPES.push({
  slug: "edge-big-ltcg",
  notes: "Single $5M LTCG (top bracket stacking)",
  filingStatus: "single", state: "FL", taxYear: 2024,
  form1099s: [{ formType: "b", payerName: "Brokerage", longTermGainLoss: 5000000 }],
});

// CT retiree below SS phase-out
ARCHETYPES.push({
  slug: "edge-ct-retiree-ss",
  notes: "CT retiree below SS exemption phase-out",
  filingStatus: "married_filing_jointly", state: "CT", taxYear: 2024,
  taxpayerAge: 70, spouseAge: 68,
  socialSecurityBenefits: 30000,
  form1099s: [{ formType: "r", payerName: "Pension", taxableAmount: 50000 }],
});

// Just over §199A threshold
ARCHETYPES.push({
  slug: "edge-199a-threshold",
  notes: "Single just over §199A threshold (G1.7)",
  filingStatus: "single", state: "FL", taxYear: 2024,
  k1s: [{ entityName: "Edge S-Corp", entityType: "s_corp", activityType: "active",
    box1OrdinaryIncome: 250000, section199aQbi: 200000 }],
});

// Kiddie + parent K-1
ARCHETYPES.push({
  slug: "edge-kiddie-parent-k1",
  notes: "Kiddie tax filer with $15k unearned, parent at 37%",
  filingStatus: "single", state: "FL", taxYear: 2024,
  taxpayerAge: 15,
  isKiddieTaxFiler: true, parentsTopMarginalRate: 0.37,
  form1099s: [
    { formType: "div", payerName: "Custodian", ordinaryDividends: 15000, qualifiedDividends: 10000 },
  ],
});

// CA AMT (G5)
ARCHETYPES.push({
  slug: "edge-ca-amt",
  notes: "CA single high AMTI + AMT preferences (G5)",
  filingStatus: "single", state: "CA", taxYear: 2024,
  w2s: [{ wagesBox1: 600000, federalTaxWithheldBox2: 150000, stateCode: "CA" }],
  adjustments: [{ adjustmentType: "amt_iso_bargain_element", amount: 80000 }],
});

// ── Phase G4 demo archetypes (3) ──────────────────────────────────────────
// Specifically constructed so each fires one G4 multi-year detector when
// the seed extension generates 2024 + 2025 snapshots. Picked to round out
// the demo story; the regular archetypes above already exercise G4.1/G4.2.

// G4.3 — Persistent itemized std-ded cliff with charity (MFJ TY2024).
// MFJ stdDed 2024 = $29,200; 2025 = $30,000. Itemized $28k both years
// (within +/- 15% band) with $8k cash charity → bunching opportunity.
ARCHETYPES.push({
  slug: "g4-bunching-mfj",
  notes: "MFJ near std-ded cliff 2 years running (G4.3 demo)",
  filingStatus: "married_filing_jointly", state: "NY", taxYear: 2024,
  w2s: [
    { wagesBox1: 160000, federalTaxWithheldBox2: 20000, stateCode: "NY" },
  ],
  adjustments: [
    { adjustmentType: "state_income_tax", amount: 9000 },
    { adjustmentType: "state_property_tax", amount: 8000 },
    { adjustmentType: "mortgage_interest", amount: 11000 },
    { adjustmentType: "charitable_cash", amount: 8000 },
  ],
});

// G4.4 — Stuck capital loss carryforward (single TY2024).
// Single FL with $50k LTCL in 2024 from 1099-B; engine deducts $3k against
// ordinary, carries forward $47k. 2025 (no new activity) deducts another
// $3k, cf ends $44k. Delta $3k is within the $3,500 tolerance → G4.4 fires.
ARCHETYPES.push({
  slug: "g4-cap-loss-cf",
  notes: "Stuck $50k LTCL carryforward 2 years (G4.4 demo)",
  filingStatus: "single", state: "FL", taxYear: 2024,
  w2s: [
    { wagesBox1: 95000, federalTaxWithheldBox2: 12000, stateCode: "FL" },
  ],
  form1099s: [
    { formType: "b", payerName: "Brokerage", longTermGainLoss: -50000 },
  ],
});

// G4.5 — Passive activity loss suspension growing (MFJ TY2024).
// MFJ AGI $250k (well above $150k PAL phase-out — $25k allowance fully
// phases out by AGI $150k). Sched E shows ~$50k of rental losses both
// years (engine suspends all of them under §469). Year-over-year growth
// from the seed extension's 1.05× scaling keeps suspension growing →
// G4.5 fires.
ARCHETYPES.push({
  slug: "g4-pal-growth-mfj",
  notes: "MFJ rental investor PAL growing YoY (G4.5 demo)",
  filingStatus: "married_filing_jointly", state: "CA", taxYear: 2024,
  rentalActiveParticipant: true,
  w2s: [
    { wagesBox1: 250000, federalTaxWithheldBox2: 40000, stateCode: "CA" },
  ],
  adjustments: [
    { adjustmentType: "schedule_e_rental_income", amount: 10000 },
    { adjustmentType: "schedule_e_rental_expenses", amount: 60000 },
  ],
});

// ── Runner ────────────────────────────────────────────────────────────────

async function existingClientIdByEmail(email: string): Promise<number | null> {
  const list = await api<Array<{ id: number; email: string }>>(`/clients`);
  const match = list.find((c) => c.email === email);
  return match ? match.id : null;
}

async function seedOne(a: Archetype): Promise<{ slug: string; clientId: number; created: boolean }> {
  const email = emailFor(a.slug);
  const existingId = await existingClientIdByEmail(email);
  if (existingId != null) {
    return { slug: a.slug, clientId: existingId, created: false };
  }
  const client = await api<{ id: number }>("/clients", {
    method: "POST",
    body: JSON.stringify({
      firstName: "Seed",
      lastName: a.slug,
      email,
      filingStatus: a.filingStatus,
      state: a.state,
      taxYear: a.taxYear,
      dependentsUnder17: a.dependentsUnder17 ?? 0,
      otherDependents: a.otherDependents ?? 0,
      dependentsForCareCredit: a.dependentsForCareCredit ?? 0,
      taxpayerAge: a.taxpayerAge ?? null,
      spouseAge: a.spouseAge ?? null,
      socialSecurityBenefits: a.socialSecurityBenefits ?? null,
      isKiddieTaxFiler: a.isKiddieTaxFiler ?? false,
      parentsTopMarginalRate: a.parentsTopMarginalRate ?? null,
      hsaIsFamilyCoverage: a.hsaIsFamilyCoverage ?? false,
      iraCoveredByWorkplacePlan: a.iraCoveredByWorkplacePlan ?? false,
      rentalActiveParticipant: a.rentalActiveParticipant ?? true,
      localityCode: a.localityCode ?? null,
      notes: a.notes,
    }),
  });
  for (const w2 of a.w2s ?? []) {
    await api(`/clients/${client.id}/w2data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: a.taxYear, ...w2 }),
    });
  }
  for (const f of a.form1099s ?? []) {
    await api(`/clients/${client.id}/form1099data`, {
      method: "POST",
      body: JSON.stringify({ taxYear: a.taxYear, ...f }),
    });
  }
  for (const k1 of a.k1s ?? []) {
    await api(`/clients/${client.id}/k1s`, {
      method: "POST",
      body: JSON.stringify({ taxYear: a.taxYear, ...k1 }),
    });
  }
  for (const adj of a.adjustments ?? []) {
    await api(`/clients/${client.id}/adjustments`, {
      method: "POST",
      body: JSON.stringify({ ...adj, description: a.notes, isApplied: true }),
    });
  }
  return { slug: a.slug, clientId: client.id, created: true };
}

async function reset() {
  const list = await api<Array<{ id: number; email: string }>>("/clients");
  let deleted = 0;
  for (const c of list) {
    if (c.email.startsWith(`${TAG}.`)) {
      await api(`/clients/${c.id}`, { method: "DELETE" });
      deleted++;
    }
  }
  console.log(`Deleted ${deleted} prior-seed clients.`);
}

// ── Phase G4 — multi-year extension ───────────────────────────────────────

/**
 * Multiplier applied to the archetype's W-2 / 1099 / K-1 amounts when
 * generating the *current* year (one year forward from the archetype's
 * recorded taxYear). 1.05 = 5% year-over-year growth — a realistic
 * compensation bump that keeps the prior-year (archetype's original) data
 * unchanged and adds a slightly larger current-year snapshot.
 */
const G4_CURRENT_YEAR_MULTIPLIER = 1.05;

/**
 * Multi-year ingestion for Phase G4 detectors. The archetype's original
 * data is kept as the *prior* year (typically TY2024); this pass adds a
 * *current* year (TY2025) at +5% W-2/1099/K-1 amounts and persists
 * tax_returns rows for BOTH years so the multi-year detector has history.
 *
 * Why forward (TY2024 → TY2025) and not backward (TY2024 → TY2023)?
 * The federal tax engine is verified for TY2024 + TY2025 only (SEP +
 * QBI limit tables; std-ded constants). Going backward into TY2023 would
 * fall back to a year the engine doesn't carry first-class constants for.
 *
 * Idempotent: skips W-2/1099/K-1 ingestion if any already exist for the
 * current (forward) year. Always re-issues POST /tax-return for both
 * years so snapshots stay current after any adjustment / engine change.
 */
async function extendMultiYearForArchetype(
  clientId: number,
  a: Archetype,
): Promise<{ currentYearAdded: boolean; computed: number[] }> {
  const priorYear = a.taxYear; // archetype's original year, e.g. 2024
  const currentYear = priorYear + 1; // forward, e.g. 2025

  // Idempotency: detect existing current-year data.
  const existingW2 = await api<Array<{ taxYear: number }>>(`/clients/${clientId}/w2data`);
  const existing1099 = await api<Array<{ taxYear: number }>>(`/clients/${clientId}/form1099data`);
  const existingK1 = await api<Array<{ taxYear: number }>>(`/clients/${clientId}/k1s`);
  const hasCurrentYear =
    existingW2.some((r) => r.taxYear === currentYear) ||
    existing1099.some((r) => r.taxYear === currentYear) ||
    existingK1.some((r) => r.taxYear === currentYear);

  let currentYearAdded = false;
  if (!hasCurrentYear) {
    const scaleNum = (n?: number) =>
      n != null ? Math.round(n * G4_CURRENT_YEAR_MULTIPLIER) : undefined;
    for (const w2 of a.w2s ?? []) {
      const scaled = {
        ...w2,
        wagesBox1: Math.round(w2.wagesBox1 * G4_CURRENT_YEAR_MULTIPLIER),
        federalTaxWithheldBox2: scaleNum(w2.federalTaxWithheldBox2),
        socialSecurityWagesBox3: scaleNum(w2.socialSecurityWagesBox3),
        medicareWagesBox5: scaleNum(w2.medicareWagesBox5),
      };
      await api(`/clients/${clientId}/w2data`, {
        method: "POST",
        body: JSON.stringify({ taxYear: currentYear, ...scaled }),
      });
    }
    for (const f of a.form1099s ?? []) {
      const scaled: Form1099 = {
        ...f,
        nonemployeeCompensation: scaleNum(f.nonemployeeCompensation),
        interestIncome: scaleNum(f.interestIncome),
        ordinaryDividends: scaleNum(f.ordinaryDividends),
        qualifiedDividends: scaleNum(f.qualifiedDividends),
        shortTermGainLoss: scaleNum(f.shortTermGainLoss),
        longTermGainLoss: scaleNum(f.longTermGainLoss),
        taxableAmount: scaleNum(f.taxableAmount),
      };
      await api(`/clients/${clientId}/form1099data`, {
        method: "POST",
        body: JSON.stringify({ taxYear: currentYear, ...scaled }),
      });
    }
    for (const k1 of a.k1s ?? []) {
      const scaled: K1 = {
        ...k1,
        box1OrdinaryIncome: scaleNum(k1.box1OrdinaryIncome),
        section199aQbi: scaleNum(k1.section199aQbi),
      };
      await api(`/clients/${clientId}/k1s`, {
        method: "POST",
        body: JSON.stringify({ taxYear: currentYear, ...scaled }),
      });
    }
    currentYearAdded = true;
  }

  // Persist tax_returns rows for both years.
  const computed: number[] = [];
  for (const year of [priorYear, currentYear]) {
    try {
      await api(`/clients/${clientId}/tax-return`, {
        method: "POST",
        body: JSON.stringify({ taxYear: year }),
      });
      computed.push(year);
    } catch (e) {
      console.error(`  warn: tax-return compute for clientId=${clientId} year=${year} failed: ${(e as Error).message}`);
    }
  }
  return { currentYearAdded, computed };
}

async function main() {
  if (process.argv.includes("--reset")) {
    await reset();
  }
  console.log(`Seeding ${ARCHETYPES.length} archetypes...`);
  let created = 0;
  let skipped = 0;
  const seededIds: Array<{ a: Archetype; clientId: number }> = [];
  for (let i = 0; i < ARCHETYPES.length; i++) {
    const a = ARCHETYPES[i];
    try {
      const r = await seedOne(a);
      if (r.created) created++;
      else skipped++;
      seededIds.push({ a, clientId: r.clientId });
      if ((i + 1) % 10 === 0) console.log(`  ... ${i + 1}/${ARCHETYPES.length}`);
    } catch (e) {
      console.error(`FAILED ${a.slug}: ${(e as Error).message}`);
    }
  }
  console.log(`Done: ${created} created, ${skipped} already existed.`);

  if (!process.argv.includes("--no-multi-year")) {
    console.log(`\nExtending to multi-year (Phase G4)...`);
    let currentYearAddedCount = 0;
    let computedCount = 0;
    for (let i = 0; i < seededIds.length; i++) {
      const { a, clientId } = seededIds[i];
      try {
        const r = await extendMultiYearForArchetype(clientId, a);
        if (r.currentYearAdded) currentYearAddedCount++;
        computedCount += r.computed.length;
        if ((i + 1) % 10 === 0) console.log(`  ... ${i + 1}/${seededIds.length}`);
      } catch (e) {
        console.error(`FAILED multi-year ${a.slug}: ${(e as Error).message}`);
      }
    }
    console.log(
      `Multi-year done: ${currentYearAddedCount} current-year (TY+1) rows added, ${computedCount} tax_returns snapshots computed.`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
