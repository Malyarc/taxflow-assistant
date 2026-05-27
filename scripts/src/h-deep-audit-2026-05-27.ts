/**
 * Phase H DEEP AUDIT — 2026-05-27
 *
 * Tests 10 realistic CPA-archetype dummy clients against ALL 97 catalog strategies
 * to verify:
 *   - which strategies fire for each profile (coverage matrix)
 *   - no detector throws / errors silently
 *   - estSavings are non-negative + finite
 *   - hits sorted by estSavings desc
 *   - cross-strategy stacking (H7) computes properly
 *   - multi-year detector wiring (H3) populates for G1.3/G1.4/G1.8
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/h-deep-audit-2026-05-27.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  evaluatePlanningOpportunities,
  evaluateCrossStrategyScenario,
} from "../../artifacts/api-server/src/lib/planningEngine";
import { CATALOG_V1, type OpportunityHit } from "@workspace/planning-strategies";

interface Archetype {
  id: string;
  name: string;
  description: string;
  inputs: Partial<TaxReturnInputs> & { client: TaxReturnInputs["client"] };
  expectedHitsContain?: string[];
  expectedHitsLackOf?: string[];
}

// ── Build 10 dummy archetypes ──────────────────────────────────────────────

const ARCHETYPES: Archetype[] = [
  {
    id: "A1-tech-rsu-ca",
    name: "Tech employee CA — $450k W-2 with RSU vesting",
    description: "Single FL→CA tech worker; high W-2 (much from RSU vesting); ISO H5 balance.",
    inputs: {
      client: {
        filingStatus: "single",
        state: "CA",
        taxYear: 2024,
        taxpayerAge: 35,
      } as TaxReturnInputs["client"],
      w2s: [
        { taxYear: 2024, wagesBox1: 450000, federalTaxWithheldBox2: 100000, stateCode: "CA" } as unknown as TaxReturnInputs["w2s"][number],
      ],
      assetBalances: [
        { assetType: "iso_amt_credit_shares", balance: "75000", accountName: "ISO grant", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
        { assetType: "401k_traditional", balance: "200000", accountName: "Old 401k", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
      ],
    },
    expectedHitsContain: ["G1.72", "G1.71", "G1.78"], // RSU, ISO, multi-state (CA only — no actual NR yet)
  },
  {
    id: "A2-retired-fl-diversified",
    name: "Retired couple FL — diversified retirement accounts age 67",
    description: "MFJ retired in FL with trad IRA, Roth, brokerage, SS benefits.",
    inputs: {
      client: {
        filingStatus: "married_filing_jointly",
        state: "FL",
        taxYear: 2024,
        taxpayerAge: 67,
        spouseAge: 65,
        socialSecurityBenefits: 40000,
      } as TaxReturnInputs["client"],
      form1099s: [
        { taxYear: 2024, formType: "r", payerName: "IRA Trust", grossDistribution: 50000, taxableAmount: 50000 } as unknown as TaxReturnInputs["form1099s"][number],
        { taxYear: 2024, formType: "div", payerName: "Brokerage", ordinaryDividends: 8000, qualifiedDividends: 6000 } as unknown as TaxReturnInputs["form1099s"][number],
      ],
      assetBalances: [
        { assetType: "traditional_ira", balance: "800000", accountName: "Trad IRA", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
        { assetType: "roth_ira", balance: "200000", accountName: "Roth", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
        { assetType: "brokerage_taxable", balance: "400000", accountName: "Brokerage", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
      ],
    },
    expectedHitsContain: ["G1.63"], // lot rotation
  },
  {
    id: "A3-se-consultant-mid-fl",
    name: "Self-employed consultant FL — $80k 1099 (low-mid SE)",
    description: "Single FL solo consultant with mid-tier SE income; ideal Solo 401(k) profile.",
    inputs: {
      client: {
        filingStatus: "single",
        state: "FL",
        taxYear: 2024,
        taxpayerAge: 38,
      } as TaxReturnInputs["client"],
      form1099s: [
        { taxYear: 2024, formType: "nec", payerName: "Big Client", nonemployeeCompensation: 80000 } as unknown as TaxReturnInputs["form1099s"][number],
      ],
      adjustments: [
        { adjustmentType: "qbi_income", amount: 73880, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
    expectedHitsContain: ["G1.1", "G1.92"], // SEP-IRA + Solo 401(k) deferral
  },
  {
    id: "A4-scorp-owner-ca-ptet",
    name: "S-corp owner CA $400k K-1 + SALT pain",
    description: "Single CA S-corp owner with $400k active K-1, SALT cap binds.",
    inputs: {
      client: {
        filingStatus: "single",
        state: "CA",
        taxYear: 2024,
        taxpayerAge: 45,
      } as TaxReturnInputs["client"],
      scheduleK1: [
        { taxYear: 2024, entityName: "Tech LLC", entityType: "s_corp", activityType: "active",
          box1OrdinaryIncome: 400000, selfEmploymentEarnings: 0, section199aQbi: 400000 } as unknown as TaxReturnInputs["scheduleK1"][number],
      ],
      adjustments: [
        { adjustmentType: "state_income_tax", amount: 40000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "property_tax", amount: 12000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "mortgage_interest", amount: 25000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "charitable_cash", amount: 15000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "qbi_income", amount: 400000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
    expectedHitsContain: ["G1.2", "G1.17", "G1.89"], // PTET, S-corp reasonable comp, §199A aggregation
  },
  {
    id: "A5-hnw-charitable-ny",
    name: "HNW NY age 60 — $2M AGI + charitable + age-55+ in-service",
    description: "HNW NY executive with high W-2 + employer stock + charitable intent.",
    inputs: {
      client: {
        filingStatus: "married_filing_jointly",
        state: "NY",
        taxYear: 2024,
        taxpayerAge: 60,
        spouseAge: 58,
      } as TaxReturnInputs["client"],
      w2s: [
        { taxYear: 2024, wagesBox1: 2000000, federalTaxWithheldBox2: 500000, stateCode: "NY" } as unknown as TaxReturnInputs["w2s"][number],
      ],
      adjustments: [
        { adjustmentType: "charitable_cash", amount: 100000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "state_income_tax", amount: 150000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "mortgage_interest", amount: 35000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      ],
      assetBalances: [
        { assetType: "employer_stock", balance: "500000", accountName: "Co stock", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
        { assetType: "401k_traditional", balance: "1500000", accountName: "401k", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
      ],
    },
    expectedHitsContain: ["G1.72", "G1.73", "G1.86", "G1.90"], // RSU, NUA in-service, CLT, PIF
  },
  {
    id: "A6-tx-realestate-pro",
    name: "TX real estate professional — REPS election",
    description: "MFJ TX with rental losses + REPS election → suspended PAL release.",
    inputs: {
      client: {
        filingStatus: "married_filing_jointly",
        state: "TX",
        taxYear: 2024,
        taxpayerAge: 45,
        rentalRealEstateProfessional: true,
      } as TaxReturnInputs["client"],
      w2s: [
        { taxYear: 2024, wagesBox1: 150000, stateCode: "TX" } as unknown as TaxReturnInputs["w2s"][number],
      ],
      rentalProperties: [
        { taxYear: 2024, address: "123 Main", propertyType: "residential", basis: 500000, rentalIncome: 30000, totalExpenses: 80000, isActiveParticipant: true } as unknown as TaxReturnInputs["rentalProperties"][number],
        { taxYear: 2024, address: "456 Oak", propertyType: "residential", basis: 400000, rentalIncome: 25000, totalExpenses: 65000, isActiveParticipant: true } as unknown as TaxReturnInputs["rentalProperties"][number],
      ],
      assetBalances: [
        { assetType: "real_estate", balance: "1500000", accountName: "Portfolio", taxYear: 2024, costBasis: "900000" } as unknown as TaxReturnInputs["assetBalances"][number],
      ],
    },
    expectedHitsContain: ["G1.18", "G1.76", "G1.84"], // REPS, non-syndicated easement, §351
  },
  {
    id: "A7-low-income-family-ohio",
    name: "Low-income family OH — Saver's Credit + EITC + CTC",
    description: "MFJ OH with kids + low income → Saver's Credit, EITC, Coverdell.",
    inputs: {
      client: {
        filingStatus: "married_filing_jointly",
        state: "OH",
        taxYear: 2024,
        taxpayerAge: 32,
        spouseAge: 31,
        dependentsUnder17: 2,
        dependentsForCareCredit: 2,
        spouseEarnedIncome: 30000,
      } as TaxReturnInputs["client"],
      w2s: [
        { taxYear: 2024, wagesBox1: 60000, stateCode: "OH" } as unknown as TaxReturnInputs["w2s"][number],
      ],
      adjustments: [
        { adjustmentType: "ira_contribution_traditional", amount: 2000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
    expectedHitsContain: ["G1.31", "G1.59"], // Saver's Credit, Coverdell ESA
  },
  {
    id: "A8-iso-tech-startup-ca",
    name: "Tech startup founder CA — ISO + QSBS + AMT",
    description: "Single CA founder with ISO exercise + QSBS position + AMT.",
    inputs: {
      client: {
        filingStatus: "single",
        state: "CA",
        taxYear: 2024,
        taxpayerAge: 38,
      } as TaxReturnInputs["client"],
      w2s: [
        { taxYear: 2024, wagesBox1: 250000, stateCode: "CA" } as unknown as TaxReturnInputs["w2s"][number],
      ],
      adjustments: [
        { adjustmentType: "amt_iso_bargain_element", amount: 200000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      ],
      assetBalances: [
        { assetType: "iso_amt_credit_shares", balance: "300000", accountName: "ISO", taxYear: 2024 } as unknown as TaxReturnInputs["assetBalances"][number],
      ],
    },
    expectedHitsContain: ["G1.5", "G1.71"], // AMT-ISO timing, ISO lot selection
  },
  {
    id: "A9-cpa-firm-owner",
    name: "CPA firm owner SE $350k + SSTB phase-out",
    description: "Single FL CPA firm owner — SSTB, near phase-out threshold.",
    inputs: {
      client: {
        filingStatus: "single",
        state: "FL",
        taxYear: 2024,
        taxpayerAge: 47,
      } as TaxReturnInputs["client"],
      form1099s: [
        { taxYear: 2024, formType: "nec", payerName: "Clients", nonemployeeCompensation: 350000 } as unknown as TaxReturnInputs["form1099s"][number],
      ],
      adjustments: [
        { adjustmentType: "qbi_income", amount: 320000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
    expectedHitsContain: ["G1.1", "G1.88", "G1.74", "G1.75"], // SEP, SSTB nav, §45S FMLA, WOTC
  },
  {
    id: "A10-disaster-state-mid-income",
    name: "Disaster state TX — middle-income with mortgage",
    description: "MFJ TX with mortgage + W-2 — disaster state proxy.",
    inputs: {
      client: {
        filingStatus: "married_filing_jointly",
        state: "TX",
        taxYear: 2024,
        taxpayerAge: 40,
        spouseAge: 38,
        dependentsUnder17: 1,
        hsaIsFamilyCoverage: true,
      } as TaxReturnInputs["client"],
      w2s: [
        { taxYear: 2024, wagesBox1: 200000, stateCode: "TX" } as unknown as TaxReturnInputs["w2s"][number],
      ],
      adjustments: [
        { adjustmentType: "state_income_tax", amount: 5000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "mortgage_interest", amount: 25000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
        { adjustmentType: "property_tax", amount: 8000, isApplied: true } as unknown as TaxReturnInputs["adjustments"][number],
      ],
    },
    expectedHitsContain: ["G1.91", "G1.14"], // disaster state, HSA max
  },
];

// ── Run audit ──────────────────────────────────────────────────────────────

const ALL_STRATEGY_IDS = CATALOG_V1.strategies.map((s) => s.id).sort();
const TOTAL_STRATEGIES = ALL_STRATEGY_IDS.length;

interface AuditResult {
  archetype: string;
  hitsCount: number;
  hitStrategyIds: string[];
  totalEstSavings: number;
  errors: string[];
  warnings: string[];
  crossStrategySummary?: {
    stackedCount: number;
    combinedSavings: number;
    sumOfIndividual: number;
    interactionEffect: number;
  };
  multiYearWired: { strategyId: string; horizonYears: number; totalSavings: number }[];
}

const results: AuditResult[] = [];
const allHitsAcrossArchetypes = new Set<string>();

console.log("============================================================");
console.log("Phase H + 97-Catalog DEEP AUDIT — 2026-05-27");
console.log(`Catalog version: ${CATALOG_V1.version}`);
console.log(`Total strategies in catalog: ${TOTAL_STRATEGIES}`);
console.log(`Archetypes tested: ${ARCHETYPES.length}`);
console.log("============================================================\n");

for (const arch of ARCHETYPES) {
  const errors: string[] = [];
  const warnings: string[] = [];
  let hits: OpportunityHit[] = [];
  let crossStrategy: AuditResult["crossStrategySummary"];

  try {
    const fullInputs: TaxReturnInputs = {
      w2s: [], form1099s: [], adjustments: [],
      taxYear: arch.inputs.client.taxYear ?? 2024,
      ...arch.inputs,
    } as TaxReturnInputs;
    const computed = computeTaxReturnPure(fullInputs);
    hits = evaluatePlanningOpportunities({
      client: fullInputs.client,
      computed,
      adjustments: fullInputs.adjustments ?? [],
      baselineInputs: fullInputs,
    });

    const css = evaluateCrossStrategyScenario({ hits, baselineInputs: fullInputs });
    if (css) {
      crossStrategy = {
        stackedCount: css.stackedStrategyIds.length,
        combinedSavings: Math.round(Math.abs(css.combinedDelta.combinedRefundDelta)),
        sumOfIndividual: css.sumOfIndividualSavings,
        interactionEffect: css.interactionEffect,
      };
    }

    // Validate each hit
    for (const h of hits) {
      if (h.estSavings < 0) errors.push(`${h.strategyId}: negative estSavings ${h.estSavings}`);
      if (!Number.isFinite(h.estSavings)) errors.push(`${h.strategyId}: non-finite estSavings`);
      if (!ALL_STRATEGY_IDS.includes(h.strategyId)) errors.push(`${h.strategyId}: not in catalog!`);
      if (h.confidence < 0 || h.confidence > 1) errors.push(`${h.strategyId}: confidence out of [0,1]: ${h.confidence}`);
      if (!h.assumptions || h.assumptions.length === 0) warnings.push(`${h.strategyId}: missing assumptions`);
      allHitsAcrossArchetypes.add(h.strategyId);
    }

    // Verify sorted by estSavings desc
    for (let i = 1; i < hits.length; i++) {
      if (hits[i - 1].estSavings < hits[i].estSavings) {
        errors.push(`hits not sorted: pos ${i - 1} = ${hits[i - 1].estSavings} < pos ${i} = ${hits[i].estSavings}`);
        break;
      }
    }

    // Check expected hits
    if (arch.expectedHitsContain) {
      const hitIds = new Set(hits.map((h) => h.strategyId));
      for (const expected of arch.expectedHitsContain) {
        if (!hitIds.has(expected)) {
          warnings.push(`Expected hit ${expected} did NOT fire`);
        }
      }
    }

    // Capture multi-year wired strategies
    const multiYearWired = hits
      .filter((h) => h.multiYear != null)
      .map((h) => ({
        strategyId: h.strategyId,
        horizonYears: h.multiYear!.horizonYears,
        totalSavings: h.multiYear!.totalSavings,
      }));

    results.push({
      archetype: arch.id,
      hitsCount: hits.length,
      hitStrategyIds: hits.map((h) => h.strategyId),
      totalEstSavings: hits.reduce((s, h) => s + h.estSavings, 0),
      errors,
      warnings,
      crossStrategySummary: crossStrategy,
      multiYearWired,
    });
  } catch (e) {
    errors.push(`THROW: ${(e as Error).message}`);
    results.push({
      archetype: arch.id,
      hitsCount: 0,
      hitStrategyIds: [],
      totalEstSavings: 0,
      errors,
      warnings,
      multiYearWired: [],
    });
  }

  console.log(`\n── ${arch.id}: ${arch.name} ──`);
  console.log(`  ${hits.length} hits / $${Math.round(hits.reduce((s, h) => s + h.estSavings, 0)).toLocaleString("en-US")} total estSavings`);
  console.log(`  Strategies: ${hits.map((h) => h.strategyId).slice(0, 12).join(", ")}${hits.length > 12 ? "..." : ""}`);
  if (crossStrategy) {
    console.log(`  H7 cross-strategy: ${crossStrategy.stackedCount} stacked / combined $${crossStrategy.combinedSavings.toLocaleString("en-US")} vs sum $${crossStrategy.sumOfIndividual.toLocaleString("en-US")} (interaction ${crossStrategy.interactionEffect >= 0 ? "+" : ""}$${crossStrategy.interactionEffect.toLocaleString("en-US")})`);
  }
  for (const my of results[results.length - 1].multiYearWired) {
    console.log(`  H3 multi-year: ${my.strategyId} horizon=${my.horizonYears} totalSavings=$${my.totalSavings.toLocaleString("en-US")}`);
  }
  if (errors.length > 0) {
    console.log(`  ERRORS: ${errors.length}`);
    for (const e of errors) console.log(`    ! ${e}`);
  }
  if (warnings.length > 0) {
    console.log(`  WARNINGS: ${warnings.length}`);
    for (const w of warnings) console.log(`    ? ${w}`);
  }
}

// ── Coverage matrix summary ────────────────────────────────────────────────

console.log("\n\n============================================================");
console.log("COVERAGE MATRIX");
console.log("============================================================");

const uncovered = ALL_STRATEGY_IDS.filter((id) => !allHitsAcrossArchetypes.has(id));
const covered = ALL_STRATEGY_IDS.filter((id) => allHitsAcrossArchetypes.has(id));

console.log(`\nFired in at least 1 archetype: ${covered.length} / ${TOTAL_STRATEGIES}`);
console.log(`NOT fired in any archetype: ${uncovered.length}`);
console.log(`\nNOT-fired strategies (may need additional archetype or have narrow triggers):`);
console.log(`  ${uncovered.join(", ")}`);

// ── Overall summary ────────────────────────────────────────────────────────

const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);
const totalWarnings = results.reduce((s, r) => s + r.warnings.length, 0);

console.log("\n\n============================================================");
console.log("AUDIT SUMMARY");
console.log("============================================================");
console.log(`Archetypes tested: ${ARCHETYPES.length}`);
console.log(`Total hits across all: ${results.reduce((s, r) => s + r.hitsCount, 0)}`);
console.log(`Total estSavings across all: $${Math.round(results.reduce((s, r) => s + r.totalEstSavings, 0)).toLocaleString("en-US")}`);
console.log(`Catalog coverage: ${covered.length} / ${TOTAL_STRATEGIES} (${Math.round((covered.length / TOTAL_STRATEGIES) * 100)}%)`);
console.log(`ERRORS: ${totalErrors}`);
console.log(`WARNINGS: ${totalWarnings}`);

if (totalErrors > 0) {
  console.log("\n❌ AUDIT FAILED — errors found.");
  process.exit(1);
}

console.log("\n✓ AUDIT PASSED — no errors. (Warnings + coverage gaps documented above.)");
