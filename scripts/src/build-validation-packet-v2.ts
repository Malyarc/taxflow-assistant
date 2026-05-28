/**
 * C3 follow-up — Expand validation packet from 10 → 25 cases.
 *
 * Adds 15 cases covering surfaces NOT exercised by the original 10:
 *   11 — Form 8606 backdoor Roth (Part I §408(d)(2) pro-rata)
 *   12 — §1031 like-kind exchange (Form 8824)
 *   13 — §121 home sale exclusion (single, $300k gain)
 *   14 — §1202 QSBS exclusion (founder, $5M gain)
 *   15 — Kiddie tax Form 8615 (parent's marginal rate)
 *   16 — FEIE Form 2555 (foreign earned income exclusion)
 *   17 — ACA Premium Tax Credit (Form 8962)
 *   18 — HSA Form 8889 (excess contribution + §4973(g) excise)
 *   19 — Roth conversion (large traditional → Roth)
 *   20 — NOL carryforward (K4 — post-TCJA 80% limit)
 *   21 — Capital loss carryforward (ST + LT) + $3k ordinary offset
 *   22 — Multi-state W-2 NR (NY resident, NJ remote work)
 *   23 — Part-year residency (CA → NY mid-year)
 *   24 — §163(j) business interest expense (above the 30% cap)
 *   25 — §461(l) excess business loss (Sch C + K-1 active losses)
 *
 * Output: 15 directories under `docs/validation-packet/` with inputs.json
 * + computed.json + values.csv + summary.txt + README.md per case.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/build-validation-packet-v2.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKET_DIR = path.resolve(__dirname, "../../docs/validation-packet");

interface CaseDef {
  number: number;
  slug: string;
  title: string;
  description: string;
  inputs: TaxReturnInputs;
  expectations: string[];
}

const CASES: CaseDef[] = [
  // ── Case 11 — Backdoor Roth (Form 8606 Part I §408(d)(2) pro-rata) ──
  {
    number: 11,
    slug: "single-backdoor-roth-tn",
    title: "Single, Backdoor Roth IRA (Form 8606 §408(d)(2))",
    description:
      "Mid-career engineer makes nondeductible traditional IRA contribution $7,000 + immediate Roth conversion. Already has $50,000 pre-tax balance in existing rollover IRA from former 401(k). Exercises Form 8606 Part I pro-rata: $7k nondeductible / ($7k + $50k existing) = 12.28% basis recovery. Engine reports basis-recovered portion (not taxable) vs taxable conversion amount.",
    expectations: [
      "Form 8606 Part I pro-rata fraction ≈ 0.1228",
      "Taxable conversion ≈ $6,140 (added to ordinary income)",
      "Tax-free basis recovery ≈ $860",
      "Year-end basis carryforward updates",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "TN",
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 150_000, federalTaxWithheldBox2: 22_000, stateCode: "TN" } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [
        { adjustmentType: "nondeductible_ira_contribution", amount: 7_000, isApplied: true, description: "Nondeductible trad IRA" } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "roth_conversion_amount", amount: 7_000, isApplied: true, description: "Roth conversion" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
      assetBalances: [
        { taxYear: 2024, assetType: "traditional_ira", accountName: "Rollover IRA", balance: 50_000, costBasis: 0, afterTaxBasis: 0 } as TaxReturnInputs["assetBalances"][number],
      ],
    },
  },

  // ── Case 12 — §1031 Like-Kind Exchange ──
  {
    number: 12,
    slug: "mfj-section1031-real-estate-tx",
    title: "MFJ, §1031 like-kind exchange — commercial RE",
    description:
      "Real-estate investor swaps a TX commercial property for a like-kind FL commercial property. Realized gain $200,000; received $30,000 cash boot (the new property was worth $30k less). Engine computes recognized gain = MIN(realized, boot) = $30k (flows to Sch D LTCG); deferred gain = $170k (reduces basis of received property).",
    expectations: [
      "Recognized gain = $30,000 (Sch D LTCG)",
      "Deferred gain = $170,000 (basis adjustment of received property)",
      "Federal LTCG portion taxed at 15% preferential rate",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "married_filing_jointly",
        state: "TX",
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 140_000, federalTaxWithheldBox2: 18_000, stateCode: "TX" } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [
        { adjustmentType: "section_1031_realized_gain", amount: 200_000, isApplied: true, description: "§1031 realized gain TX→FL commercial RE" } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "section_1031_boot_received", amount: 30_000, isApplied: true, description: "Cash boot received" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 13 — §121 Home Sale Exclusion ──
  {
    number: 13,
    slug: "single-home-sale-section121-fl",
    title: "Single, §121 home sale exclusion ($300k gross gain)",
    description:
      "Software developer sells primary residence after 7 years for $300,000 gain. Single filer's §121 exclusion is $250,000. Engine excludes $250k; remaining $50k flows to LTCG (Sch D). FL no state tax.",
    expectations: [
      "§121 exclusion applied = $250,000",
      "Taxable LTCG remainder = $50,000",
      "Federal tax on LTCG portion at 15% (within single bracket)",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "FL",
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 100_000, federalTaxWithheldBox2: 14_000, stateCode: "FL" } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [
        { adjustmentType: "home_sale_gross_gain_primary_residence", amount: 300_000, isApplied: true, description: "Primary residence sale gross gain" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 14 — §1202 QSBS Exclusion ──
  {
    number: 14,
    slug: "single-qsbs-section1202-ca",
    title: "Single, §1202 QSBS exclusion (founder, $5M gain)",
    description:
      "Tech-startup founder sells qualified small business stock acquired 2019 (5+ year hold). Realized gain $5,000,000; adjusted basis $100,000. §1202 100% exclusion (post-2010-09-27 acquisition); exclusion cap = MAX($10M, 10× basis $1M) = $10M. Full gain excluded; $0 federal LTCG.",
    expectations: [
      "§1202 exclusion = $5,000,000 (full)",
      "Taxable QSBS portion = $0",
      "Federal LTCG from QSBS = $0",
      "CA conforms to federal QSBS exclusion (engine treats as zero CA-taxable)",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "CA",
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 200_000, federalTaxWithheldBox2: 40_000, stateCode: "CA" } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [
        { adjustmentType: "qsbs_gross_gain", amount: 5_000_000, isApplied: true, description: "QSBS realized gain" } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "qsbs_adjusted_basis", amount: 100_000, isApplied: true, description: "QSBS adjusted basis" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 15 — Kiddie tax Form 8615 (HNW family) ──
  {
    number: 15,
    slug: "single-kiddie-tax-form8615-ny",
    title: "Single child filer, Kiddie tax (Form 8615 §1(g))",
    description:
      "16-year-old child of HNW NY family has $15,000 of investment income (1099-DIV qualified dividends from UTMA account). Parent's top marginal rate = 35%. Kiddie tax: unearned income > $2,600 taxed at parent's marginal rate per §1(g) / Form 8615. Engine taxes excess $12,400 at 35% kiddie rate.",
    expectations: [
      "Total income = $15,000 (1099-DIV)",
      "Unearned income net of $2,600 threshold = $12,400 taxed at parent's 35% kiddie rate",
      "Form 8615 Line 18 max(regular, kiddie) determines tax",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "NY",
        taxYear: 2024,
        isKiddieTaxFiler: true,
        parentsTopMarginalRate: 0.35,
      } as TaxReturnInputs["client"],
      w2s: [],
      form1099s: [
        { taxYear: 2024, formType: "div", payerName: "Schwab UTMA", ordinaryDividends: 15_000, qualifiedDividends: 15_000, federalTaxWithheld: 0, stateCode: "NY" } as TaxReturnInputs["form1099s"][number],
      ],
      adjustments: [],
    },
  },

  // ── Case 16 — FEIE Form 2555 (Foreign Earned Income Exclusion §911) ──
  {
    number: 16,
    slug: "single-feie-form2555-expat",
    title: "Single, FEIE §911 (foreign-earned income exclusion)",
    description:
      "U.S. citizen working remotely from Portugal full year. Total foreign-earned wages $130,000. §911 cap TY2024 = $126,500 (single, full year). Engine excludes $126,500; $3,500 remainder taxed at marginal rate. Stacking rule applied: tax computed at marginal rate that would have applied including FEIE.",
    expectations: [
      "FEIE exclusion = $126,500 (cap)",
      "Taxable foreign-earned income = $3,500",
      "Stacking rule: tax computed as if FEIE-included income, then back out",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "FL", // tax-domicile state (FL no income tax)
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [],
      form1099s: [],
      adjustments: [
        { adjustmentType: "foreign_earned_income", amount: 130_000, isApplied: true, description: "PT-based remote work" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 17 — ACA Premium Tax Credit (Form 8962) ──
  {
    number: 17,
    slug: "single-aca-ptc-form8962-tx",
    title: "Single, ACA Premium Tax Credit (Form 8962)",
    description:
      "Sole-proprietor consultant with marketplace coverage. AGI $55k, annual premium $9,000, SLCSP $8,400, advance APTC received $4,500. Engine computes net PTC reconciliation; balance flows to Form 8962. (Sub-gap: engine simplifies SLCSP-vs-actual computation.)",
    expectations: [
      "Net PTC (after advance reconciliation) computed",
      "Excess APTC repayment OR additional PTC refund per Form 8962",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "TX",
        taxYear: 2024,
        acaAnnualPremium: 9_000,
        acaAnnualSlcsp: 8_400,
        acaAdvanceAptc: 4_500,
        acaHouseholdSize: 1,
      } as TaxReturnInputs["client"],
      w2s: [],
      form1099s: [
        { taxYear: 2024, formType: "nec", payerName: "Consulting LLC", nonemployeeCompensation: 55_000, federalTaxWithheld: 0, stateCode: "TX" } as TaxReturnInputs["form1099s"][number],
      ],
      adjustments: [],
    },
  },

  // ── Case 18 — HSA Form 8889 + §4973(g) excess contribution excise ──
  {
    number: 18,
    slug: "mfj-hsa-form8889-excess-tx",
    title: "MFJ, HSA Form 8889 + §4973(g) excess contribution excise",
    description:
      "MFJ couple with family-coverage HSA. TY2024 family cap = $8,300. They contributed $10,000 (over-contributed by $1,700). Engine deducts up to cap; excess subject to 6% §4973(g) excise per year until withdrawn.",
    expectations: [
      "HSA deduction = $8,300 (capped)",
      "Excess contribution = $1,700",
      "§4973(g) 6% excise = $102",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "married_filing_jointly",
        state: "TX",
        taxYear: 2024,
        hsaIsFamilyCoverage: true,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 140_000, federalTaxWithheldBox2: 18_000, stateCode: "TX" } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [
        { adjustmentType: "hsa_contribution", amount: 10_000, isApplied: true, description: "Family HSA contribution" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 19 — Roth conversion ──
  {
    number: 19,
    slug: "single-roth-conversion-fl",
    title: "Single, Large Roth conversion (no IRA basis)",
    description:
      "Pre-retiree (age 55) converts $80,000 from traditional IRA to Roth. No after-tax basis. Full $80k is ordinary taxable income in conversion year. Plus $90k W-2 → AGI $170k. Federal marginal 24%. Engine routes through adjustments.",
    expectations: [
      "Total income = $170,000 ($90k W-2 + $80k conversion)",
      "Federal tax on $170k roughly 24% bracket region",
      "Roth basis carryforward updates",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "FL",
        taxYear: 2024,
        taxpayerAge: 55,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 90_000, federalTaxWithheldBox2: 12_000, stateCode: "FL" } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [
        { adjustmentType: "roth_conversion_amount", amount: 80_000, isApplied: true, description: "Large Roth conversion" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 20 — NOL carryforward (K4 — post-TCJA 80% limit) ──
  {
    number: 20,
    slug: "single-nol-carryforward-ca",
    title: "Single, NOL carryforward (post-TCJA 80% limit, §172(a)(2))",
    description:
      "Recovering filer with $40,000 NOL carryforward from prior loss year. Current year W-2 $50,000 (taxable before NOL ≈ $35,400). §172(a)(2) post-TCJA: NOL deduction ≤ 80% × taxable. Cap = 80% × $35,400 = $28,320. NOL used: $28,320. Remaining $11,680 carries forward.",
    expectations: [
      "NOL deduction = $28,320 (80% cap)",
      "Remaining NOL cf = $11,680",
      "Federal tax on post-NOL taxable income ≈ $7,080 ($35,400 − $28,320)",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "CA",
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 50_000, federalTaxWithheldBox2: 4_000, stateCode: "CA" } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [
        { adjustmentType: "nol_carryforward", amount: 40_000, isApplied: true, description: "NOL carryforward from prior year" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 21 — Capital loss carryforward + $3k ordinary offset ──
  {
    number: 21,
    slug: "single-cap-loss-carryforward-ny",
    title: "Single, Capital loss carryforward + $3k §1211 offset",
    description:
      "Filer with prior-year cap-loss carryforward: $15,000 ST + $10,000 LT. Current year W-2 $80k, no current-year cap transactions. §1211: net cap loss limited to $3,000/year against ordinary income; rest carries forward. Engine applies $3k offset (ST first by IRS ordering).",
    expectations: [
      "Capital loss deducted = $3,000",
      "ST cap loss CF remaining = $12,000",
      "LT cap loss CF remaining = $10,000",
      "Federal tax reduced by $3k × 22% marginal ≈ $660",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "NY",
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 80_000, federalTaxWithheldBox2: 10_000, stateCode: "NY", stateTaxWithheldBox17: 4_000 } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [
        { adjustmentType: "capital_loss_carryforward_short", amount: 15_000, isApplied: true, description: "ST cap loss CF" } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "capital_loss_carryforward_long", amount: 10_000, isApplied: true, description: "LT cap loss CF" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 22 — Multi-state NR (NY resident, NJ W-2) ──
  {
    number: 22,
    slug: "single-multistate-ny-nj-nr",
    title: "Single, Multi-state — NY resident, NJ remote W-2 (no reciprocity)",
    description:
      "NY resident works remotely for a NJ employer. W-2 box 16 NJ wages $90,000 (NJ tax withheld $5,000). NY taxes worldwide $90k; NJ taxes $90k as NR. NY resident credit reduces NY tax for NJ tax paid (lesser of NJ tax actually paid or NY tax on the same income).",
    expectations: [
      "NJ NR tax > 0 on $90k wages",
      "NY resident tax with credit for NJ tax paid",
      "Total state tax = NJ NR tax + NY tax (net of resident credit)",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "NY",
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 90_000, federalTaxWithheldBox2: 12_000, stateCode: "NJ", stateTaxWithheldBox17: 5_000 } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [],
    },
  },

  // ── Case 23 — Part-year residency (CA → NY mid-year) ──
  {
    number: 23,
    slug: "single-part-year-residency-ca-ny",
    title: "Single, Part-year residency CA → NY (Apr 1, 2024)",
    description:
      "Filer moved from CA to NY on April 1, 2024. Total W-2 $120k (all NY stateCode — earned post-move). Without W-2 sourcing: pro-rata 91/366 days to CA = $29,836. With `part_year_use_w2_source` marker: $0 to CA, $120k to NY.",
    expectations: [
      "Engine uses W-2 source-allocation when marker is set",
      "CA former-state AGI = $0 (no CA W-2)",
      "NY current-state AGI = $120,000",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "NY",
        taxYear: 2024,
        residencyChangedInYear: true,
        formerState: "CA",
        residencyChangeDate: "2024-04-01",
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 120_000, federalTaxWithheldBox2: 18_000, stateCode: "NY", stateTaxWithheldBox17: 6_000 } as TaxReturnInputs["w2s"][number]],
      form1099s: [],
      adjustments: [
        { adjustmentType: "part_year_use_w2_source", amount: 1, isApplied: true, description: "Enable W-2 source allocation" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 24 — §163(j) business interest (above 30% cap) ──
  {
    number: 24,
    slug: "single-section163j-biz-int-ny",
    title: "Single, §163(j) business interest cap (above 30% ATI)",
    description:
      "Active business owner with Sch C net $100,000 + business interest expense $40,000. Post-C3 refined ATI ≈ $100k − $14,600 std ded − ½ SE $7,065 ≈ $78,335. Cap = 30% × $78,335 ≈ $23,500. Disallowed cf ≈ $16,500.",
    expectations: [
      "§163(j) gross = $40,000",
      "§163(j) allowed ≈ $23,500 (capped at 30% × ATI)",
      "§163(j) disallowed cf ≈ $16,500",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "single",
        state: "NY",
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [],
      form1099s: [
        { taxYear: 2024, formType: "nec", payerName: "Acme Client LLC", nonemployeeCompensation: 100_000, federalTaxWithheld: 0, stateCode: "NY" } as TaxReturnInputs["form1099s"][number],
      ],
      adjustments: [
        { adjustmentType: "section_163j_business_interest_expense", amount: 40_000, isApplied: true, description: "Biz interest expense" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },

  // ── Case 25 — §461(l) excess business loss ──
  {
    number: 25,
    slug: "mfj-section461l-excess-loss-fl",
    title: "MFJ, §461(l) excess business loss addback ($800k Sch C loss)",
    description:
      "High-income family with a Sch C trade/business showing $800,000 loss (large investment + capital write-off). MFJ threshold TY2024 = $610,000. Excess = $800k − $610k = $190k addback to ordinary income. Auto-aggregation via the C3 follow-up.",
    expectations: [
      "Aggregate Sch C loss = $800,000",
      "§461(l) excess addback = $190,000 (post-threshold)",
      "AGI includes $190k addback",
    ],
    inputs: {
      taxYear: 2024,
      client: {
        filingStatus: "married_filing_jointly",
        state: "FL",
        taxYear: 2024,
      } as TaxReturnInputs["client"],
      w2s: [{ taxYear: 2024, wagesBox1: 500_000, federalTaxWithheldBox2: 100_000, stateCode: "FL" } as TaxReturnInputs["w2s"][number]],
      form1099s: [
        { taxYear: 2024, formType: "nec", payerName: "Acme Client LLC", nonemployeeCompensation: 200_000, federalTaxWithheld: 0, stateCode: "FL" } as TaxReturnInputs["form1099s"][number],
      ],
      adjustments: [
        { adjustmentType: "schedule_c_expenses", amount: 1_000_000, isApplied: true, description: "Sch C investment + write-offs" } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
  },
];

// ── Per-case writers ────────────────────────────────────────────────────

function writeCase(c: CaseDef): void {
  const dirName = `${String(c.number).padStart(2, "0")}-${c.slug}`;
  const dir = path.join(PACKET_DIR, dirName);
  fs.mkdirSync(dir, { recursive: true });

  // inputs.json (with metadata)
  const inputsWithMeta = {
    client: c.inputs.client,
    slug: c.slug,
    number: c.number,
    title: c.title,
    description: c.description,
    expectations: c.expectations,
    w2s: c.inputs.w2s,
    form1099s: c.inputs.form1099s,
    adjustments: c.inputs.adjustments,
    rentals: c.inputs.rentalProperties,
    capitalTransactions: c.inputs.capitalTransactions,
    k1s: c.inputs.scheduleK1,
    assetBalances: c.inputs.assetBalances,
  };
  fs.writeFileSync(
    path.join(dir, "inputs.json"),
    JSON.stringify(inputsWithMeta, null, 2),
  );

  // computed.json (the engine output)
  const computed = computeTaxReturnPure(c.inputs);
  fs.writeFileSync(
    path.join(dir, "computed.json"),
    JSON.stringify(computed, null, 2),
  );

  // summary.txt (vendor-neutral key=value)
  const summary = [
    `[META]`,
    `CASE_NUMBER=${c.number}`,
    `CASE_SLUG=${c.slug}`,
    `CASE_TITLE=${c.title}`,
    `FILING_STATUS=${c.inputs.client.filingStatus}`,
    `STATE=${c.inputs.client.state}`,
    `TAX_YEAR=${c.inputs.taxYear}`,
    `GENERATED_BY=TaxFlow Assistant C3-follow-up packet v2`,
    `GENERATED_AT=${new Date().toISOString()}`,
    ``,
    `[1040]`,
    `1040-L9=${Number(computed.totalIncome).toFixed(2)}`,
    `1040-L11=${Number(computed.adjustedGrossIncome).toFixed(2)}`,
    `1040-L12=${Number(computed.standardDeduction).toFixed(2)}`,
    `1040-L13=${Number(computed.qbiDeduction).toFixed(2)}`,
    `1040-L15=${Number(computed.taxableIncome).toFixed(2)}`,
    `1040-L24=${Number(computed.federalTaxLiability).toFixed(2)}`,
    `1040-L25a=${Number(computed.federalTaxWithheld).toFixed(2)}`,
    `1040-L34=${Number(computed.federalRefundOrOwed).toFixed(2)}`,
    `STATE-RETURN=${Number(computed.stateTaxLiability).toFixed(2)}`,
    `STATE-WH=${Number(computed.stateTaxWithheld).toFixed(2)}`,
    `STATE-REFUND=${Number(computed.stateRefundOrOwed).toFixed(2)}`,
  ].join("\n");
  fs.writeFileSync(path.join(dir, "summary.txt"), summary);

  // README.md (case description for CPA)
  const readme = [
    `# Case ${c.number} — ${c.title}`,
    ``,
    `**Slug:** \`${c.slug}\``,
    `**Filing status:** ${c.inputs.client.filingStatus}`,
    `**State:** ${c.inputs.client.state}`,
    `**Tax year:** ${c.inputs.taxYear}`,
    ``,
    `## Description`,
    ``,
    c.description,
    ``,
    `## Expectations`,
    ``,
    ...c.expectations.map((e) => `- ${e}`),
    ``,
    `## Files`,
    ``,
    `- \`inputs.json\` — the case input scenario (exactly as fed to \`computeTaxReturnPure\`)`,
    `- \`computed.json\` — the full computed engine result`,
    `- \`summary.txt\` — vendor-neutral key=value summary of the main IRS form lines`,
    ``,
    `## Engine results (this build)`,
    ``,
    `- 1040 L9 (Total income): \\$${Number(computed.totalIncome).toFixed(2)}`,
    `- 1040 L11 (AGI): \\$${Number(computed.adjustedGrossIncome).toFixed(2)}`,
    `- 1040 L15 (Taxable income): \\$${Number(computed.taxableIncome).toFixed(2)}`,
    `- 1040 L24 (Total federal tax): \\$${Number(computed.federalTaxLiability).toFixed(2)}`,
    `- 1040 L34 (Refund/owed): \\$${Number(computed.federalRefundOrOwed).toFixed(2)}`,
    `- State tax: \\$${Number(computed.stateTaxLiability).toFixed(2)}`,
    `- State refund/owed: \\$${Number(computed.stateRefundOrOwed).toFixed(2)}`,
    ``,
    `Generated by \`scripts/src/build-validation-packet-v2.ts\`.`,
  ].join("\n");
  fs.writeFileSync(path.join(dir, "README.md"), readme);

  console.log(`  ✓ Wrote Case ${c.number} (${c.slug})`);
}

// ── Main ────────────────────────────────────────────────────────────────

console.log(`Writing 15 new validation cases to ${PACKET_DIR}...`);
for (const c of CASES) {
  writeCase(c);
}
console.log(`\nDone. Cases 11-25 written. Total packet size: ${CASES.length + 10} cases.`);
console.log(`\nReview each new case's computed.json + summary.txt before signing off.`);
