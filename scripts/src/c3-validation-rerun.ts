/**
 * C3 — Re-run all 10 validation-packet cases against the CURRENT engine
 * to capture fresh outputs for hand-calc comparison. The static packet
 * files in `docs/validation-packet/` were built 2026-05-23; the engine
 * has been updated since (Phase H, C-batch v2/v3, K-list closures), so
 * the static outputs may be stale.
 *
 * Output: JSON to stdout with line-by-line numbers for each case.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx ./src/c3-validation-rerun.ts
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

const PACKET_DIR = path.resolve(
  __dirname,
  "../../docs/validation-packet",
);

const cases = fs
  .readdirSync(PACKET_DIR)
  .filter((d) => /^\d+-/.test(d))
  .sort();

interface RerunResult {
  case: string;
  title: string;
  client: { filingStatus: string; state: string; taxYear: number; dependentsUnder17?: number };
  out: {
    totalIncome: number;
    adjustedGrossIncome: number;
    standardDeduction: number;
    itemizedDeductions: number | null;
    qbiDeduction: number | string;
    taxableIncome: number;
    federalTaxLiability: number;
    federalTaxWithheld: number;
    federalRefundOrOwed: number;
    stateTaxLiability: number;
    stateTaxWithheld: number;
    stateRefundOrOwed: number;
    localTaxLiability?: number | string;
    localTaxJurisdiction?: string | null;
    selfEmploymentTax?: number | string;
    capitalGainsTax?: number | string;
    childTaxCreditApplied?: number;
    additionalChildTaxCredit?: number | string;
    eitcApplied?: number | string;
    amtTax?: number | string;
    foreignTaxCredit?: number | string;
    socialSecurityTaxable?: number | string;
    homeSaleTaxableGain?: number | string;
    stateRetirementExemption?: number | string;
  };
}

const results: RerunResult[] = [];

for (const dirName of cases) {
  const inputsPath = path.join(PACKET_DIR, dirName, "inputs.json");
  if (!fs.existsSync(inputsPath)) continue;
  const raw = JSON.parse(fs.readFileSync(inputsPath, "utf8")) as {
    client: TaxReturnInputs["client"];
    w2s?: TaxReturnInputs["w2s"];
    form1099s?: TaxReturnInputs["form1099s"];
    adjustments?: TaxReturnInputs["adjustments"];
    rentals?: TaxReturnInputs["rentalProperties"];
    capitalTransactions?: TaxReturnInputs["capitalTransactions"];
    k1s?: TaxReturnInputs["scheduleK1"];
    title: string;
  };

  const inputs: TaxReturnInputs = {
    client: raw.client,
    w2s: raw.w2s ?? [],
    form1099s: raw.form1099s ?? [],
    adjustments: raw.adjustments ?? [],
    rentalProperties: raw.rentals,
    capitalTransactions: raw.capitalTransactions,
    scheduleK1: raw.k1s,
    taxYear: raw.client.taxYear,
  };

  const computed = computeTaxReturnPure(inputs) as Record<string, unknown>;
  results.push({
    case: dirName,
    title: raw.title,
    client: {
      filingStatus: raw.client.filingStatus,
      state: raw.client.state,
      taxYear: raw.client.taxYear,
      dependentsUnder17: raw.client.dependentsUnder17,
    },
    out: {
      totalIncome: computed.totalIncome as number,
      adjustedGrossIncome: computed.adjustedGrossIncome as number,
      standardDeduction: computed.standardDeduction as number,
      itemizedDeductions: computed.itemizedDeductions as number | null,
      qbiDeduction: computed.qbiDeduction as number,
      taxableIncome: computed.taxableIncome as number,
      federalTaxLiability: computed.federalTaxLiability as number,
      federalTaxWithheld: computed.federalTaxWithheld as number,
      federalRefundOrOwed: computed.federalRefundOrOwed as number,
      stateTaxLiability: computed.stateTaxLiability as number,
      stateTaxWithheld: computed.stateTaxWithheld as number,
      stateRefundOrOwed: computed.stateRefundOrOwed as number,
      localTaxLiability: computed.localTaxLiability as number | undefined,
      localTaxJurisdiction: computed.localTaxJurisdiction as string | undefined,
      selfEmploymentTax: computed.selfEmploymentTax as number | undefined,
      capitalGainsTax: computed.capitalGainsTax as number | undefined,
      childTaxCreditApplied: (computed.childTaxCredit as { appliedCredit?: number } | undefined)?.appliedCredit,
      additionalChildTaxCredit: computed.additionalChildTaxCredit as number | undefined,
      eitcApplied: (computed.eitc as { appliedCredit?: number } | undefined)?.appliedCredit,
      amtTax: computed.amtTax as number | undefined,
      foreignTaxCredit: (computed.foreignTaxCredit as { appliedCredit?: number } | undefined)?.appliedCredit,
      socialSecurityTaxable: computed.socialSecurityTaxable as number | undefined,
      homeSaleTaxableGain: computed.homeSaleTaxableGain as number | undefined,
    },
  });
}

console.log(JSON.stringify(results, null, 2));
