/**
 * Return-level diagnostics engine tests (P2-16 / P1-5).
 *
 * Drives diagnostics through the REAL engine (computeTaxReturnPure) so the
 * tests verify the actual integration (real CTC/EITC/balance values feeding
 * the checks), not stubbed ComputedTaxReturn objects. NO database / API.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-diagnostics-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  computeReturnDiagnostics,
  type ReturnDiagnosticsResult,
  type DiagnosticSeverity,
} from "../../artifacts/api-server/src/lib/returnDiagnostics";

const PASS: string[] = [];
const FAIL: string[] = [];

function checkExact<T>(label: string, actual: T, expected: T) {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }

/** Run engine + diagnostics for a set of inputs. */
function diag(inputs: TaxReturnInputs): ReturnDiagnosticsResult {
  const computed = computeTaxReturnPure(inputs);
  return computeReturnDiagnostics({
    client: inputs.client,
    w2s: inputs.w2s,
    form1099s: inputs.form1099s,
    computed,
  });
}
function has(r: ReturnDiagnosticsResult, id: string): boolean {
  return r.diagnostics.some((d) => d.id === id);
}
function sevOf(r: ReturnDiagnosticsResult, id: string): DiagnosticSeverity | null {
  return r.diagnostics.find((d) => d.id === id)?.severity ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Clean return → no criticals, ready to hand off
// ════════════════════════════════════════════════════════════════════════════
header("Clean return (single FL $50k W-2)");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("0 criticals", r.counts.critical, 0);
  checkExact("ready to hand off", r.readyToHandOff, true);
  checkExact("no state-code diagnostic", has(r, "state-code-invalid"), false);
  checkExact("no balance-due (refund $984)", has(r, "federal-balance-due"), false);
  checkExact("no large-refund ($984 < $5k)", has(r, "large-refund"), false);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. Invalid + missing state code → critical
// ════════════════════════════════════════════════════════════════════════════
header("Invalid state code");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "ZZ", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 6000, stateCode: "ZZ" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("state-code-invalid present", has(r, "state-code-invalid"), true);
  checkExact("severity critical", sevOf(r, "state-code-invalid"), "critical");
  checkExact("NOT ready to hand off", r.readyToHandOff, false);
}
header("Missing state code");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, federalTaxWithheldBox2: 6000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("state-code-missing present", has(r, "state-code-missing"), true);
  checkExact("severity critical", sevOf(r, "state-code-missing"), "critical");
}

// ════════════════════════════════════════════════════════════════════════════
// 3. Kiddie tax flagged, no parent rate → critical
// ════════════════════════════════════════════════════════════════════════════
header("Kiddie tax missing parent rate");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "CA", taxYear: 2024, isKiddieTaxFiler: true },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "div", payerName: "Broker", ordinaryDividends: 8000, qualifiedDividends: 0 }],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("kiddie-missing-parent-rate present", has(r, "kiddie-missing-parent-rate"), true);
  checkExact("severity critical", sevOf(r, "kiddie-missing-parent-rate"), "critical");
  checkExact("NOT ready", r.readyToHandOff, false);
}
header("Kiddie tax WITH parent rate → no diagnostic");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "CA", taxYear: 2024, isKiddieTaxFiler: true, parentsTopMarginalRate: 0.35 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "div", payerName: "Broker", ordinaryDividends: 8000 }],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("no kiddie diagnostic", has(r, "kiddie-missing-parent-rate"), false);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. ACA APTC without SLCSP → critical (Form 8962 can't reconcile)
// ════════════════════════════════════════════════════════════════════════════
header("ACA APTC without SLCSP");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "TX", taxYear: 2024, acaAdvanceAptc: 4000, acaAnnualPremium: 9000 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 4000, stateCode: "TX" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("aca-aptc-no-slcsp present", has(r, "aca-aptc-no-slcsp"), true);
  checkExact("severity critical", sevOf(r, "aca-aptc-no-slcsp"), "critical");
  checkExact("aca-missing-household-size info present", has(r, "aca-missing-household-size"), true);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. Non-resident state wages → info (not blocking)
// ════════════════════════════════════════════════════════════════════════════
header("Non-resident state wages");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "NJ", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 90000, federalTaxWithheldBox2: 14000, stateTaxWithheldBox17: 5000, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("nonresident-state-wages present", has(r, "nonresident-state-wages"), true);
  checkExact("severity info", sevOf(r, "nonresident-state-wages"), "info");
  checkExact("still ready (info only)", r.readyToHandOff, true);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. Federal balance due > $1,000 → warning
// ════════════════════════════════════════════════════════════════════════════
header("Federal balance due");
{
  // $150k single W-2, only $5k withheld → large balance due.
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 150000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("federal-balance-due present", has(r, "federal-balance-due"), true);
  checkExact("severity warning", sevOf(r, "federal-balance-due"), "warning");
  checkExact("ready (warning is not blocking)", r.readyToHandOff, true);
}

// ════════════════════════════════════════════════════════════════════════════
// 7. W-2 box arithmetic — Box 3 over SS wage base → critical (via validateW2)
// ════════════════════════════════════════════════════════════════════════════
header("W-2 Box 3 over SS wage base");
{
  // 2024 SS wage base = $168,600. Box 3 = $200,000 is impossible → error.
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{
      taxYear: 2024, wagesBox1: 200000, federalTaxWithheldBox2: 45000,
      socialSecurityWagesBox3: 200000, medicareWagesBox5: 200000, stateCode: "FL",
    }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  const w2Critical = r.diagnostics.some((d) => d.category === "Income documents" && d.severity === "critical");
  checkExact("a W-2 income-doc critical exists", w2Critical, true);
  checkExact("NOT ready (W-2 error)", r.readyToHandOff, false);
}

// ════════════════════════════════════════════════════════════════════════════
// 8. No income documents → warning
// ════════════════════════════════════════════════════════════════════════════
header("No income documents");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "CA", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("no-income-docs present", has(r, "no-income-docs"), true);
  checkExact("severity warning", sevOf(r, "no-income-docs"), "warning");
}

// ════════════════════════════════════════════════════════════════════════════
// 9. Dependent care dependents but $0 credit (no expense entered) → warning
// ════════════════════════════════════════════════════════════════════════════
header("Dependent care credit zero");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, dependentsForCareCredit: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 7000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("care-credit-zero present", has(r, "care-credit-zero"), true);
  checkExact("severity warning", sevOf(r, "care-credit-zero"), "warning");
}

// ════════════════════════════════════════════════════════════════════════════
// 10. EITC investment-income disqualifier → info
// ════════════════════════════════════════════════════════════════════════════
header("EITC investment-income disqualifier");
{
  // Low earned income but $12k of investment income (> $11,600 limit 2024) → EITC
  // knocked out. 2 qualifying kids would otherwise qualify.
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "TX", taxYear: 2024, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 18000, federalTaxWithheldBox2: 0, stateCode: "TX" }],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 12000 }],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  checkExact("eitc-ineligible present", has(r, "eitc-ineligible"), true);
  checkExact("severity info", sevOf(r, "eitc-ineligible"), "info");
}

// ════════════════════════════════════════════════════════════════════════════
// 11. readyToHandOff gate: warnings + infos only → still ready
// ════════════════════════════════════════════════════════════════════════════
header("readyToHandOff gate ignores non-critical");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024, dependentsForCareCredit: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 150000, federalTaxWithheldBox2: 5000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  // Has a balance-due warning + a care-credit-zero warning, but zero criticals.
  checkExact("has >=1 warning", r.counts.warning >= 1, true);
  checkExact("0 criticals", r.counts.critical, 0);
  checkExact("ready to hand off", r.readyToHandOff, true);
}

// ════════════════════════════════════════════════════════════════════════════
// 12. Ordering — criticals sort before warnings before infos
// ════════════════════════════════════════════════════════════════════════════
header("Severity ordering");
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "ZZ", taxYear: 2024, dependentsForCareCredit: 1, acaAdvanceAptc: 3000 },
    w2s: [{ taxYear: 2024, wagesBox1: 150000, federalTaxWithheldBox2: 5000, stateCode: "NY" }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const r = diag(inputs);
  // First diagnostic must be critical, last must be info (if both exist).
  const firstSev = r.diagnostics[0]?.severity;
  checkExact("first is critical", firstSev, "critical");
  let monotonic = true;
  const rank: Record<DiagnosticSeverity, number> = { critical: 0, warning: 1, info: 2 };
  for (let i = 1; i < r.diagnostics.length; i++) {
    if (rank[r.diagnostics[i].severity] < rank[r.diagnostics[i - 1].severity]) monotonic = false;
  }
  checkExact("severity-sorted", monotonic, true);
}

// ─── Report ───
console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log(f); process.exit(1); }
console.log("ALL DIAGNOSTICS TESTS GREEN");
