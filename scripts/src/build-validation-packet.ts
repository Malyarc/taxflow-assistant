/**
 * Build the C12 validation packet for a CPA design partner.
 *
 * Creates 10 representative tax-return cases via the live API, fetches each
 * one's PDF summary + CSV + plain-text summary, and writes them to
 * `docs/validation-packet/<NN>-<slug>/` along with the input scenario
 * (`inputs.json`) and the computed engine result (`computed.json`).
 *
 * Requires: api-server running at http://localhost:8080.
 * Run:      pnpm --filter @workspace/scripts exec tsx src/build-validation-packet.ts
 *
 * The packet is *not* a test runner — the assertion-suite for the engine
 * lives in scripts/src/tax-engine-*. This script just emits the artifacts a
 * CPA partner can hand-key into UltraTax CS (or any tool) and compare to.
 */

import { writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://localhost:8080/api";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKET_ROOT = resolve(__dirname, "..", "..", "docs", "validation-packet");

// ──────────────────────────────────────────────────────────────────────────
// Tiny API helpers (mirrors patterns from scripts/src/tax-engine-*)
// ──────────────────────────────────────────────────────────────────────────

async function api<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${txt}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function rawText(path: string): Promise<string> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.text();
}

async function rawBytes(path: string): Promise<Buffer> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function settle(ms = 80): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ──────────────────────────────────────────────────────────────────────────
// Scenario definitions
// ──────────────────────────────────────────────────────────────────────────

interface ClientInputs {
  firstName: string;
  lastName: string;
  filingStatus: "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household" | "qualifying_widow";
  state: string;
  taxYear: number;
  localityCode?: string | null;
  dependentsUnder17?: number;
  otherDependents?: number;
  ageBracket?: "under65" | "between65_70" | "over70";
}

interface W2Inputs {
  taxYear: number;
  wagesBox1: number;
  federalTaxWithheldBox2: number;
  stateCode: string;
  socialSecurityWagesBox3?: number;
  socialSecurityTaxBox4?: number;
  medicareWagesBox5?: number;
  medicareTaxBox6?: number;
  stateWagesBox16?: number;
  stateTaxWithheldBox17?: number;
}

interface AdjustmentInputs {
  adjustmentType: string;
  amount: number;
  description?: string;
  isApplied?: boolean;
}

interface K1Inputs {
  taxYear: number;
  entityName: string;
  entityType: "partnership" | "s_corp";
  activityType: "active" | "passive";
  box1OrdinaryIncome?: number;
  box2RentalRealEstateIncome?: number;
  box14ASelfEmploymentEarnings?: number;
}

interface RentalInputs {
  taxYear: number;
  address: string;
  propertyType: "residential" | "commercial";
  basis: number;
  placedInServiceYear: number;
  placedInServiceMonth: number;
  rentalIncome: number;
  totalExpenses: number;
  isActiveParticipant: boolean;
}

interface CapTxnInputs {
  description: string;
  proceeds: number;
  costBasis: number;
  formBox: "A" | "B" | "C" | "D" | "E" | "F";
  taxYear: number;
  acquisitionDate?: string;
  saleDate?: string;
  adjustmentCode?: string;
  adjustmentAmount?: number;
  washSaleDisallowed?: number;
}

interface F1099Inputs {
  taxYear: number;
  formType: "nec" | "misc" | "int" | "div" | "b" | "r" | "g" | "k";
  payerName: string;
  [field: string]: unknown;
}

interface CaseSpec {
  /** Slug used as directory name */
  slug: string;
  /** 1-based ordinal — appears in the packet directory */
  number: number;
  /** Short one-line label */
  title: string;
  /** Long paragraph describing the CPA scenario */
  description: string;
  /** Expected behaviors a CPA can spot-check */
  expectations: string[];
  client: ClientInputs;
  w2s?: W2Inputs[];
  form1099s?: F1099Inputs[];
  adjustments?: AdjustmentInputs[];
  k1s?: K1Inputs[];
  rentals?: RentalInputs[];
  capitalTransactions?: CapTxnInputs[];
}

const NOW = Date.now();
function email(slug: string): string {
  return `validation-${slug}-${NOW}@taxflow.example`;
}

// 10 cases. Chosen to exercise every major engine surface a CPA would touch.
const CASES: CaseSpec[] = [
  {
    slug: "single-w2-fl",
    number: 1,
    title: "Single, W-2 only, FL (no state income tax)",
    description:
      "Baseline simplest return. Single filer, one W-2, lives in Florida. " +
      "Exercises: federal regular tax brackets, std deduction, federal withholding " +
      "→ refund or balance due. Zero state tax. No credits.",
    expectations: [
      "AGI = $55,000",
      "Std ded (single 2024) = $14,600 → taxable = $40,400",
      "Federal tax ≈ $4,616 (single 2024 brackets)",
      "Federal withheld = $6,200 → refund ≈ $1,584",
      "State tax = $0 (FL)",
    ],
    client: {
      firstName: "Alex",
      lastName: "Baseline",
      filingStatus: "single",
      state: "FL",
      taxYear: 2024,
    },
    w2s: [
      {
        taxYear: 2024, wagesBox1: 55000, federalTaxWithheldBox2: 6200, stateCode: "FL",
        socialSecurityWagesBox3: 55000, socialSecurityTaxBox4: 3410,
        medicareWagesBox5: 55000, medicareTaxBox6: 797.50,
      },
    ],
  },

  {
    slug: "single-w2-nyc",
    number: 2,
    title: "Single, W-2 only, NYC resident",
    description:
      "Same baseline as #1, but lives in NYC. Exercises NY state tax + NYC local " +
      "income tax (BP2). CPA can verify the NYC PIT brackets independently.",
    expectations: [
      "AGI = $75,000",
      "NY state tax > 0 (NY brackets, std ded $8,000)",
      "NYC local tax > 0 (single 2024 NYC brackets)",
      "Local tax shown separately from state tax in the summary",
    ],
    client: {
      firstName: "Mia",
      lastName: "Manhattan",
      filingStatus: "single",
      state: "NY",
      localityCode: "NYC",
      taxYear: 2024,
    },
    w2s: [
      {
        taxYear: 2024, wagesBox1: 75000, federalTaxWithheldBox2: 9500, stateCode: "NY",
        socialSecurityWagesBox3: 75000, socialSecurityTaxBox4: 4650,
        medicareWagesBox5: 75000, medicareTaxBox6: 1087.50,
        stateWagesBox16: 75000, stateTaxWithheldBox17: 4200,
      },
    ],
  },

  {
    slug: "mfj-two-w2-ca-ctc",
    number: 3,
    title: "MFJ, two W-2s, CA, 1 child under 17 (CTC)",
    description:
      "Dual-earner married household with one qualifying child. Exercises CTC " +
      "(non-refundable + refundable ACTC ordering), CA state tax, joint brackets.",
    expectations: [
      "AGI = $145,000 (combined wages)",
      "Std ded (MFJ 2024) = $29,200 → taxable = $115,800",
      "CTC = $2,000 (well below MFJ phase-out start $400,000)",
      "CA state tax > 0 (graduated CA brackets)",
    ],
    client: {
      firstName: "Jordan & Robin",
      lastName: "Couple",
      filingStatus: "married_filing_jointly",
      state: "CA",
      taxYear: 2024,
      dependentsUnder17: 1,
    },
    w2s: [
      {
        taxYear: 2024, wagesBox1: 85000, federalTaxWithheldBox2: 9800, stateCode: "CA",
        socialSecurityWagesBox3: 85000, socialSecurityTaxBox4: 5270,
        medicareWagesBox5: 85000, medicareTaxBox6: 1232.50,
        stateWagesBox16: 85000, stateTaxWithheldBox17: 3900,
      },
      {
        taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 6400, stateCode: "CA",
        socialSecurityWagesBox3: 60000, socialSecurityTaxBox4: 3720,
        medicareWagesBox5: 60000, medicareTaxBox6: 870,
        stateWagesBox16: 60000, stateTaxWithheldBox17: 2600,
      },
    ],
  },

  {
    slug: "single-sch-c-qbi-tx",
    number: 4,
    title: "Single, Sch C self-employment + 1099-NEC, TX",
    description:
      "Sole-proprietor consultant. One 1099-NEC for $80k gross with $15k Sch C " +
      "expenses → $65k net SE income. Exercises Sch SE, QBI §199A 20% deduction, " +
      "deductible-half-of-SE adjustment. No state tax (TX).",
    expectations: [
      "Net SE income (Sch C) = $65,000",
      "SE tax ≈ $9,184 (15.3% × 92.35% × $65,000)",
      "Half SE adjustment ≈ $4,592 reduces AGI",
      "QBI deduction = 20% × min(QBI, taxable) → meaningful reduction",
      "Total tax includes SE + income tax",
    ],
    client: {
      firstName: "Sam",
      lastName: "Solopreneur",
      filingStatus: "single",
      state: "TX",
      taxYear: 2024,
    },
    form1099s: [
      {
        taxYear: 2024, formType: "nec", payerName: "Acme Client LLC",
        nonemployeeCompensation: 80000, federalTaxWithheld: 0, stateCode: "TX",
      },
    ],
    adjustments: [
      { adjustmentType: "schedule_c_expenses", amount: 15000, description: "Business expenses", isApplied: true },
    ],
  },

  {
    slug: "mfj-rental-passive-loss-ny",
    number: 5,
    title: "MFJ, W-2 + Sch E rental (per-property MACRS + PAL), NY",
    description:
      "Couple with one W-2 income and one residential rental property purchased " +
      "in 2020. Exercises per-property MACRS (27.5 yr SL, mid-month), passive- " +
      "activity-loss §469 with the $25k active-participant allowance, and NY " +
      "state tax.",
    expectations: [
      "Per-property MACRS depreciation auto-computed (residential 27.5 yr SL)",
      "Net rental gain/loss = rental income − total expenses − depreciation",
      "If loss: up to $25,000 allowable as PAL (AGI < $100k phase-out start MFJ)",
      "AGI reflects net rental on Sch E Line 26",
    ],
    client: {
      firstName: "Pat",
      lastName: "Landlord",
      filingStatus: "married_filing_jointly",
      state: "NY",
      taxYear: 2024,
    },
    w2s: [
      {
        taxYear: 2024, wagesBox1: 95000, federalTaxWithheldBox2: 10500, stateCode: "NY",
        socialSecurityWagesBox3: 95000, socialSecurityTaxBox4: 5890,
        medicareWagesBox5: 95000, medicareTaxBox6: 1377.50,
        stateWagesBox16: 95000, stateTaxWithheldBox17: 5800,
      },
    ],
    rentals: [
      {
        taxYear: 2024, address: "742 Evergreen Ter, Albany NY", propertyType: "residential",
        basis: 275000, placedInServiceYear: 2020, placedInServiceMonth: 6,
        rentalIncome: 24000, totalExpenses: 11000, isActiveParticipant: true,
      },
    ],
  },

  {
    slug: "single-k1-scorp-ca",
    number: 6,
    title: "Single, S-corp K-1 + W-2, CA",
    description:
      "S-corp shareholder taking salary (W-2) plus K-1 distributive share. " +
      "Exercises K-1 Box 1 (active ordinary income), §199A QBI on the K-1 " +
      "portion, no SE tax on the K-1 (S-corp passthrough), CA state tax.",
    expectations: [
      "AGI = W-2 wages + K-1 Box 1 ordinary income (no SE on K-1 for S-corp)",
      "QBI deduction applies to the K-1 portion (simplified 20%)",
      "CA state tax > 0",
    ],
    client: {
      firstName: "Riley",
      lastName: "Shareholder",
      filingStatus: "single",
      state: "CA",
      taxYear: 2024,
    },
    w2s: [
      {
        taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 9500, stateCode: "CA",
        socialSecurityWagesBox3: 80000, socialSecurityTaxBox4: 4960,
        medicareWagesBox5: 80000, medicareTaxBox6: 1160,
        stateWagesBox16: 80000, stateTaxWithheldBox17: 3700,
      },
    ],
    k1s: [
      {
        taxYear: 2024, entityName: "Riverside Consulting Inc",
        entityType: "s_corp", activityType: "active",
        box1OrdinaryIncome: 45000,
      },
    ],
  },

  {
    slug: "mfj-capital-transactions-ny",
    number: 7,
    title: "MFJ, W-2 + capital transactions (Form 8949), NY",
    description:
      "Couple with W-2 income and a mix of short-term and long-term capital " +
      "transactions including one wash-sale-disallowed loss. Exercises Schedule " +
      "D netting, QDCG worksheet (LTCG at preferential 15% rate), NIIT threshold.",
    expectations: [
      "Net ST cap gain taxed as ordinary income",
      "Net LT cap gain taxed at 0% / 15% / 20% per QDCG worksheet",
      "Wash sale loss adjustment increases the disallowed loss",
      "NY state tax applies to total AGI (incl. cap gains)",
    ],
    client: {
      firstName: "Casey",
      lastName: "Investor",
      filingStatus: "married_filing_jointly",
      state: "NY",
      taxYear: 2024,
    },
    w2s: [
      {
        taxYear: 2024, wagesBox1: 130000, federalTaxWithheldBox2: 17000, stateCode: "NY",
        socialSecurityWagesBox3: 130000, socialSecurityTaxBox4: 8060,
        medicareWagesBox5: 130000, medicareTaxBox6: 1885,
        stateWagesBox16: 130000, stateTaxWithheldBox17: 8200,
      },
    ],
    capitalTransactions: [
      {
        taxYear: 2024, description: "AAPL 100 sh — long-term gain",
        proceeds: 18000, costBasis: 12000, formBox: "D",
        acquisitionDate: "2021-03-15", saleDate: "2024-08-04",
      },
      {
        taxYear: 2024, description: "TSLA 50 sh — short-term gain",
        proceeds: 12500, costBasis: 9000, formBox: "A",
        acquisitionDate: "2024-02-12", saleDate: "2024-11-01",
      },
      {
        taxYear: 2024, description: "GME 100 sh — wash sale partial",
        proceeds: 4000, costBasis: 5000, formBox: "A",
        acquisitionDate: "2024-04-01", saleDate: "2024-09-15",
        adjustmentCode: "W", adjustmentAmount: 300, washSaleDisallowed: 300,
      },
    ],
  },

  {
    slug: "single-amt-iso-ca",
    number: 8,
    title: "Single, W-2 + ISO bargain element (AMT preference), CA",
    description:
      "Tech worker exercising ISOs held past year-end. Exercises the AMT " +
      "preference for the ISO bargain element (Form 6251 Line 2k) on top of the " +
      "auto-derived SALT addback (Line 2g). AMT may or may not bind depending on " +
      "regular-tax burden.",
    expectations: [
      "AMTI > taxable income (ISO bargain element + SALT addback)",
      "AMT = max(0, tentative AMT − regular tax)",
      "AMT line populated on the summary if it binds",
    ],
    client: {
      firstName: "Drew",
      lastName: "Stockoptionhaver",
      filingStatus: "single",
      state: "CA",
      taxYear: 2024,
    },
    w2s: [
      {
        taxYear: 2024, wagesBox1: 220000, federalTaxWithheldBox2: 48000, stateCode: "CA",
        socialSecurityWagesBox3: 168600, socialSecurityTaxBox4: 10453.20,
        medicareWagesBox5: 220000, medicareTaxBox6: 3190,
        stateWagesBox16: 220000, stateTaxWithheldBox17: 15000,
      },
    ],
    adjustments: [
      { adjustmentType: "state_income_tax", amount: 22000, description: "CA withholding + Q1 estimate", isApplied: true },
      { adjustmentType: "mortgage_interest", amount: 18000, description: "Primary residence", isApplied: true },
      { adjustmentType: "amt_iso_bargain_element", amount: 80000, description: "ISO exercise held past 12/31", isApplied: true },
    ],
  },

  {
    slug: "mfj-eitc-piggyback-il",
    number: 9,
    title: "MFJ, low-income with 2 qualifying children, IL state EITC",
    description:
      "Low-AGI joint filer with 2 qualifying children, lives in Illinois. " +
      "Exercises federal EITC + IL state EITC at 20% piggyback (PA 102-0700, " +
      "since TY2023). Also exercises refundable Additional CTC.",
    expectations: [
      "Federal EITC > 0 (within MFJ-with-2-kids window)",
      "IL state EITC = 20% × federal EITC",
      "ACTC (refundable CTC) may be non-zero",
    ],
    client: {
      firstName: "Morgan & Sky",
      lastName: "Family",
      filingStatus: "married_filing_jointly",
      state: "IL",
      taxYear: 2024,
      dependentsUnder17: 2,
    },
    w2s: [
      {
        taxYear: 2024, wagesBox1: 28000, federalTaxWithheldBox2: 800, stateCode: "IL",
        socialSecurityWagesBox3: 28000, socialSecurityTaxBox4: 1736,
        medicareWagesBox5: 28000, medicareTaxBox6: 406,
        stateWagesBox16: 28000, stateTaxWithheldBox17: 1100,
      },
    ],
  },

  {
    slug: "single-foreign-tax-credit-nj",
    number: 10,
    title: "Single, W-2 + foreign dividends + Form 1116 FTC, NJ",
    description:
      "US filer with significant foreign-source dividend income and foreign tax " +
      "withheld at source. Exercises Form 1116 FTC limitation (binding when " +
      "foreign tax > US tax share) and NJ state tax on AGI.",
    expectations: [
      "Foreign tax credit reduces federal liability (capped at FTC limitation)",
      "1099-DIV interest+dividend income flows into AGI",
      "NJ state tax > 0 (graduated NJ brackets)",
    ],
    client: {
      firstName: "Quinn",
      lastName: "Expat",
      filingStatus: "single",
      state: "NJ",
      taxYear: 2024,
    },
    w2s: [
      {
        taxYear: 2024, wagesBox1: 110000, federalTaxWithheldBox2: 14000, stateCode: "NJ",
        socialSecurityWagesBox3: 110000, socialSecurityTaxBox4: 6820,
        medicareWagesBox5: 110000, medicareTaxBox6: 1595,
        stateWagesBox16: 110000, stateTaxWithheldBox17: 5800,
      },
    ],
    form1099s: [
      {
        taxYear: 2024, formType: "div", payerName: "International Index Fund LLC",
        ordinaryDividends: 9000, qualifiedDividends: 7000, federalTaxWithheld: 0, stateCode: "NJ",
      },
    ],
    adjustments: [
      { adjustmentType: "foreign_tax_paid", amount: 1500, description: "Foreign tax withheld on 1099-DIV", isApplied: true },
      { adjustmentType: "foreign_source_taxable_income", amount: 9000, description: "Foreign-source portion of dividends", isApplied: true },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Builder
// ──────────────────────────────────────────────────────────────────────────

async function buildOne(spec: CaseSpec): Promise<{ ok: boolean; error?: string }> {
  const slugDir = join(PACKET_ROOT, `${String(spec.number).padStart(2, "0")}-${spec.slug}`);
  await mkdir(slugDir, { recursive: true });

  // Create client
  const clientBody = {
    firstName: spec.client.firstName,
    lastName: spec.client.lastName,
    email: email(spec.slug),
    filingStatus: spec.client.filingStatus,
    state: spec.client.state,
    taxYear: spec.client.taxYear,
    localityCode: spec.client.localityCode ?? null,
    dependentsUnder17: spec.client.dependentsUnder17 ?? 0,
    otherDependents: spec.client.otherDependents ?? 0,
    ageBracket: spec.client.ageBracket ?? "under65",
  };
  const created = await api<{ id: number }>("/clients", { method: "POST", body: JSON.stringify(clientBody) });
  const cid = created.id;

  try {
    for (const w of spec.w2s ?? []) {
      await api(`/clients/${cid}/w2data`, { method: "POST", body: JSON.stringify(w) });
    }
    for (const f of spec.form1099s ?? []) {
      await api(`/clients/${cid}/form1099data`, { method: "POST", body: JSON.stringify(f) });
    }
    for (const adj of spec.adjustments ?? []) {
      await api(`/clients/${cid}/adjustments`, {
        method: "POST",
        body: JSON.stringify({ isApplied: true, ...adj }),
      });
    }
    for (const k of spec.k1s ?? []) {
      await api(`/clients/${cid}/k1s`, { method: "POST", body: JSON.stringify(k) });
    }
    for (const r of spec.rentals ?? []) {
      await api(`/clients/${cid}/rental-properties`, { method: "POST", body: JSON.stringify(r) });
    }
    for (const c of spec.capitalTransactions ?? []) {
      await api(`/clients/${cid}/capital-transactions`, { method: "POST", body: JSON.stringify(c) });
    }

    await settle();

    // Fetch computed return + the three artifacts
    const computed = await api<unknown>(`/clients/${cid}/tax-return`);
    const csv = await rawText(`/clients/${cid}/tax-return/csv?taxYear=${spec.client.taxYear}`);
    const summaryTxt = await rawText(`/clients/${cid}/tax-return/ultratax?taxYear=${spec.client.taxYear}`);
    const pdf = await rawBytes(`/clients/${cid}/tax-return/pdf?taxYear=${spec.client.taxYear}`);

    await writeFile(join(slugDir, "inputs.json"), JSON.stringify({ client: clientBody, ...spec }, null, 2));
    await writeFile(join(slugDir, "computed.json"), JSON.stringify(computed, null, 2));
    await writeFile(join(slugDir, "values.csv"), csv);
    await writeFile(join(slugDir, "summary.txt"), summaryTxt);
    await writeFile(join(slugDir, "summary.pdf"), pdf);

    return { ok: true };
  } finally {
    await api(`/clients/${cid}`, { method: "DELETE" }).catch(() => {});
  }
}

function readmeFor(c: CaseSpec): string {
  const lines: string[] = [];
  lines.push(`# Case ${String(c.number).padStart(2, "0")}: ${c.title}`);
  lines.push("");
  lines.push(c.description);
  lines.push("");
  lines.push("## What to spot-check in UltraTax CS");
  lines.push("");
  for (const e of c.expectations) lines.push(`- ${e}`);
  lines.push("");
  lines.push("## Artifacts");
  lines.push("");
  lines.push("- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)");
  lines.push("- `computed.json` — full engine output (all internal state)");
  lines.push("- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line");
  lines.push("- `summary.txt` — plain-text key=value summary (vendor-neutral)");
  lines.push("- `summary.pdf` — one-page CPA-readable PDF");
  lines.push("");
  return lines.join("\n");
}

async function writeIndex(): Promise<void> {
  const lines: string[] = [];
  lines.push("# C12 Validation Packet (2026-05-23)");
  lines.push("");
  lines.push("Ten representative tax-return cases for a CPA design partner to import");
  lines.push("into UltraTax CS (by hand-keying the scenario) and compare to our engine.");
  lines.push("");
  lines.push("See [`../ultratax-audit.md`](../ultratax-audit.md) for why we cannot ship");
  lines.push("a direct UltraTax CS import file (no such format exists) and what we recommend");
  lines.push("instead.");
  lines.push("");
  lines.push("Per-case artifacts:");
  lines.push("");
  lines.push("- `summary.pdf` — one-page CPA-readable PDF of the computed return");
  lines.push("- `values.csv` — IRS-line-keyed flat file (`IRS Line | Field | Description | Reference Code | Value`)");
  lines.push("- `summary.txt` — plain-text vendor-neutral key=value (e.g. `1040-L9=75000.00`)");
  lines.push("- `inputs.json` — the input scenario, exactly as fed to the engine");
  lines.push("- `computed.json` — the full computed result (internal state, useful for deep dives)");
  lines.push("");
  lines.push("## Cases");
  lines.push("");
  lines.push("| # | Title | Surfaces tested |");
  lines.push("|---|---|---|");
  for (const c of CASES) {
    const dir = `${String(c.number).padStart(2, "0")}-${c.slug}`;
    const surfaces = c.expectations.length > 0 ? c.expectations[0] : "—";
    lines.push(`| ${c.number} | [${c.title}](./${dir}/) | ${surfaces} |`);
  }
  lines.push("");
  lines.push("## Regenerating");
  lines.push("");
  lines.push("```");
  lines.push("# api-server must be running at localhost:8080");
  lines.push("pnpm --filter @workspace/scripts exec tsx src/build-validation-packet.ts");
  lines.push("```");
  lines.push("");
  lines.push("Cases are generated deterministically from `scripts/src/build-validation-packet.ts`;");
  lines.push("emails are timestamped so re-running creates fresh clients (the old ones are deleted");
  lines.push("on completion).");
  lines.push("");

  await writeFile(join(PACKET_ROOT, "README.md"), lines.join("\n"));
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Health check
  try {
    const h = await fetch("http://localhost:8080/api/healthz");
    if (!h.ok) throw new Error(String(h.status));
  } catch (err) {
    console.error("api-server not running at http://localhost:8080. Boot it first.");
    process.exit(2);
  }

  // Clean prior packet so we don't accumulate stale files
  try {
    const entries = await readdir(PACKET_ROOT);
    for (const e of entries) {
      if (/^\d{2}-/.test(e)) await rm(join(PACKET_ROOT, e), { recursive: true, force: true });
    }
  } catch {
    // Directory doesn't exist yet — created below.
  }
  await mkdir(PACKET_ROOT, { recursive: true });

  console.log(`Writing validation packet to ${PACKET_ROOT}`);
  let ok = 0;
  let fail = 0;
  for (const c of CASES) {
    process.stdout.write(`  ${String(c.number).padStart(2, "0")} ${c.title.padEnd(60)}`);
    try {
      const r = await buildOne(c);
      if (r.ok) {
        ok++;
        const slugDir = join(PACKET_ROOT, `${String(c.number).padStart(2, "0")}-${c.slug}`);
        await writeFile(join(slugDir, "README.md"), readmeFor(c));
        process.stdout.write("ok\n");
      } else {
        fail++;
        process.stdout.write(`FAIL — ${r.error}\n`);
      }
    } catch (err) {
      fail++;
      process.stdout.write(`FAIL — ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  await writeIndex();
  console.log(`\n${ok}/${CASES.length} cases generated (${fail} failures).`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
