/**
 * P2-12 — 1099 box-arithmetic validation. Deterministic; NO API.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-1099-validation-tests.ts
 */
import { validate1099, type Form1099DataLike } from "../../lib/validation/src/form1099Validation";
import { computeTaxReturnPure, type TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { computeReturnDiagnostics } from "../../artifacts/api-server/src/lib/returnDiagnostics";

const PASS: string[] = [];
const FAIL: string[] = [];
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }
const hasErr = (rec: Form1099DataLike, field: string) =>
  validate1099(rec, { clientTaxYear: 2024, clientState: "CA" }).some((f) => f.field === field && f.severity === "error");
const hasFlag = (rec: Form1099DataLike, field: string, sev?: string) =>
  validate1099(rec, { clientTaxYear: 2024, clientState: "CA" }).some((f) => f.field === field && (sev ? f.severity === sev : true));

// ── 1099-DIV: qualified ≤ ordinary ─────────────────────────────────────────
header("1099-DIV qualified vs ordinary");
{
  checkBool("qualified > ordinary → error", hasErr({ formType: "div", ordinaryDividends: 1000, qualifiedDividends: 1500 }, "qualifiedDividends"), true);
  checkBool("qualified ≤ ordinary → no error", hasErr({ formType: "div", ordinaryDividends: 1000, qualifiedDividends: 800 }, "qualifiedDividends"), false);
  checkBool("qualified == ordinary → no error", hasErr({ formType: "div", ordinaryDividends: 1000, qualifiedDividends: 1000 }, "qualifiedDividends"), false);
}

// ── 1099-R: taxable ≤ gross + missing code ─────────────────────────────────
header("1099-R taxable vs gross");
{
  checkBool("taxable > gross → error", hasErr({ formType: "r", grossDistribution: 5000, taxableAmount: 6000 }, "taxableAmount"), true);
  checkBool("taxable ≤ gross → no error", hasErr({ formType: "r", grossDistribution: 5000, taxableAmount: 4000 }, "taxableAmount"), false);
  checkBool("gross>0 + no code → info", hasFlag({ formType: "r", grossDistribution: 5000, taxableAmount: 5000 }, "distributionCode", "info"), true);
  checkBool("gross>0 + code present → no info", hasFlag({ formType: "r", grossDistribution: 5000, taxableAmount: 5000, distributionCode: "7" }, "distributionCode"), false);
}

// ── 1099-B: proceeds − basis ≈ reported gain/loss ──────────────────────────
header("1099-B gain reconciliation");
{
  // proceeds 10000 − basis 7000 = 3000; reported ST 1000 + LT 1000 = 2000 → mismatch $1000.
  checkBool("proceeds−basis ≠ reported gain → warning", hasFlag({ formType: "b", proceeds: 10000, costBasis: 7000, shortTermGainLoss: 1000, longTermGainLoss: 1000 }, "shortTermGainLoss", "warning"), true);
  // proceeds 10000 − basis 7000 = 3000; reported LT 3000 → matches.
  checkBool("proceeds−basis == reported gain → no warning", hasFlag({ formType: "b", proceeds: 10000, costBasis: 7000, longTermGainLoss: 3000 }, "shortTermGainLoss"), false);
}

// ── Payer TIN format ───────────────────────────────────────────────────────
header("Payer TIN format");
{
  checkBool("8-digit TIN → warning", hasFlag({ formType: "int", payerTin: "12-345678", interestIncome: 100 }, "payerTin", "warning"), true);
  checkBool("9-digit TIN → no flag", hasFlag({ formType: "int", payerTin: "12-3456789", interestIncome: 100 }, "payerTin"), false);
}

// ── Year + state mismatch ──────────────────────────────────────────────────
header("Year + state mismatch");
{
  checkBool("year mismatch → warning", hasFlag({ formType: "int", taxYear: 2023, interestIncome: 100 }, "taxYear", "warning"), true);
  checkBool("state mismatch → info", hasFlag({ formType: "int", stateCode: "NY", interestIncome: 100 }, "stateCode", "info"), true);
}

// ── Withholding plausibility ───────────────────────────────────────────────
header("Withholding plausibility");
{
  checkBool("withholding > 40% of income → warning", hasFlag({ formType: "nec", nonemployeeCompensation: 1000, federalTaxWithheld: 500 }, "federalTaxWithheld", "warning"), true);
  checkBool("normal 24% backup withholding → no flag", hasFlag({ formType: "nec", nonemployeeCompensation: 1000, federalTaxWithheld: 240 }, "federalTaxWithheld"), false);
  checkBool("withholding but $0 income → warning", hasFlag({ formType: "div", ordinaryDividends: 0, federalTaxWithheld: 100 }, "federalTaxWithheld", "warning"), true);
}

// ── Negative income guard ──────────────────────────────────────────────────
header("Negative income guard");
{
  checkBool("negative NEC → error", hasErr({ formType: "nec", nonemployeeCompensation: -500 }, "nonemployeeCompensation"), true);
}

// ── Diagnostics integration ────────────────────────────────────────────────
header("Diagnostics folds in 1099 errors");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "CA", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 6000, stateCode: "CA" }],
    form1099s: [{ taxYear: 2024, formType: "div", payerName: "Broker", ordinaryDividends: 1000, qualifiedDividends: 1500 }],
    adjustments: [],
    taxYear: 2024,
  };
  const computed = computeTaxReturnPure(inputs);
  const diag = computeReturnDiagnostics({ client: inputs.client, w2s: inputs.w2s, form1099s: inputs.form1099s, computed });
  const has1099Critical = diag.diagnostics.some((d) => d.id.startsWith("1099-") && d.severity === "critical");
  checkBool("1099-DIV qualified>ordinary → critical diagnostic", has1099Critical, true);
  checkBool("NOT ready to hand off (1099 error)", diag.readyToHandOff, false);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log(f); process.exit(1); }
console.log("ALL 1099 VALIDATION TESTS GREEN");
