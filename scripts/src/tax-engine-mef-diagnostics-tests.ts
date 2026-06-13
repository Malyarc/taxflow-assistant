/**
 * T1.5 #4 — MeF (Modernized e-File) business-rule diagnostics.
 *
 * Encodes the public IRS e-file reject rules a CPA's filing software would bounce
 * on, as pre-filing diagnostics tagged with the reject-rule number. Verifies each
 * rule FIRES when its trigger is present and is ABSENT otherwise (no false
 * positives). Every reject mapping is cited inline against the MeF rule.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-mef-diagnostics-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  computeReturnDiagnostics,
  type ReturnDiagnostic,
} from "../../artifacts/api-server/src/lib/returnDiagnostics";

const PASS: string[] = [];
const FAIL: string[] = [];
function ok(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`); else FAIL.push(`✗ ${label}`);
}

function diagnose(partial: Partial<TaxReturnInputs> & { client: TaxReturnInputs["client"] }): ReturnDiagnostic[] {
  const inputs = {
    w2s: [], form1099s: [], adjustments: [], taxYear: partial.client.taxYear ?? 2024,
    ...partial,
  } as TaxReturnInputs;
  const computed = computeTaxReturnPure(inputs);
  return computeReturnDiagnostics({ client: inputs.client, w2s: inputs.w2s, form1099s: inputs.form1099s, computed }).diagnostics;
}
const has = (ds: ReturnDiagnostic[], id: string) => ds.some((d) => d.id === id);
const ruleOf = (ds: ReturnDiagnostic[], id: string) => ds.find((d) => d.id === id)?.mefRule;

// NOTE: the engine PREVENTS the hard data-rejects by construction (e.g. it
// refuses to credit excess Social Security from a single employer per
// F1040-021-03 — see excessSsForPerson in taxReturnEngine.ts), so those are not
// reachable diagnostics. The MeF checks below are the e-file gates the engine
// cannot self-check + required-form confirmations.

// ════════════════════════════════════════════════════════════════════════════
// M2 — F1040-034/035: MFS itemize consistency reminder (only when MFS).
// ════════════════════════════════════════════════════════════════════════════
{
  const mfs = diagnose({ client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000 }] });
  ok("M2 fires for MFS", has(mfs, "mef-mfs-itemize-consistency"));
  ok("M2 tagged F1040-034/035", (ruleOf(mfs, "mef-mfs-itemize-consistency") ?? "").includes("F1040-034-06"));
  const single = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000 }] });
  ok("M2 absent for single (no false positive)", !has(single, "mef-mfs-itemize-consistency"));
}

// ════════════════════════════════════════════════════════════════════════════
// M3 — F8959: Additional Medicare Tax present → Form 8959 required.
//   Single $250k wages → Add'l Medicare on the $50k over $200k.
// ════════════════════════════════════════════════════════════════════════════
{
  const hi = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 250000, medicareWagesBox5: 250000 }] });
  ok("M3 fires: Add'l Medicare → Form 8959 required", has(hi, "mef-form-8959-required"));
  ok("M3 tagged F8959-001", ruleOf(hi, "mef-form-8959-required") === "F8959-001");
  const lo = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000, medicareWagesBox5: 80000 }] });
  ok("M3 absent below the $200k threshold", !has(lo, "mef-form-8959-required"));
}

// ════════════════════════════════════════════════════════════════════════════
// M4 — F8962-070: APTC paid → Form 8962 required (the most common ACA reject).
// ════════════════════════════════════════════════════════════════════════════
{
  const aptc = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024,
    acaAnnualPremium: 6000, acaAnnualSlcsp: 7000, acaAdvanceAptc: 3000, acaHouseholdSize: 1 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000 }] });
  ok("M4 fires: APTC paid → Form 8962 required", has(aptc, "mef-form-8962-required"));
  ok("M4 tagged F8962-070", ruleOf(aptc, "mef-form-8962-required") === "F8962-070");
  const noAptc = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 40000 }] });
  ok("M4 absent with no marketplace coverage", !has(noAptc, "mef-form-8962-required"));
}

// ════════════════════════════════════════════════════════════════════════════
// M5 + M7 — EITC qualifying-child rules (SEIC-F1040-535/501) + Form 8862
//   (F1040-164-01). Single, $18k earned, 2 kids → on the EITC plateau.
// ════════════════════════════════════════════════════════════════════════════
{
  const eitc = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024, eitcQualifyingChildren: 2, dependentsUnder17: 2 },
    w2s: [{ taxYear: 2024, wagesBox1: 18000 }] });
  ok("M5 fires: EITC w/ kids → qualifying-child age/SSN e-file rules", has(eitc, "mef-eitc-qualifying-child-rules"));
  ok("M5 tagged SEIC-F1040-535/501", (ruleOf(eitc, "mef-eitc-qualifying-child-rules") ?? "").includes("SEIC-F1040-535-04"));
  ok("M7 fires: EITC claimed → Form 8862 reminder", has(eitc, "mef-eitc-form-8862"));
  ok("M7 tagged F1040-164-01", ruleOf(eitc, "mef-eitc-form-8862") === "F1040-164-01");
  const noEitc = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 80000 }] });
  ok("M5/M7 absent when no EITC", !has(noEitc, "mef-eitc-qualifying-child-rules") && !has(noEitc, "mef-eitc-form-8862"));
}

// ════════════════════════════════════════════════════════════════════════════
// M6 — Schedule H: household-employee cash wages over the threshold → Sch H.
// ════════════════════════════════════════════════════════════════════════════
{
  const schH = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 90000 }],
    adjustments: [{ adjustmentType: "household_employee_cash_wages", amount: 30000, isApplied: true }] });
  ok("M6 fires: household wages → Schedule H required", has(schH, "mef-schedule-h-required"));
  const noSchH = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 90000 }] });
  ok("M6 absent with no household employee", !has(noSchH, "mef-schedule-h-required"));
}

// ════════════════════════════════════════════════════════════════════════════
// NFP — no false positives: a plain single W-2 return triggers NO MeF reject.
// ════════════════════════════════════════════════════════════════════════════
{
  const plain = diagnose({ client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, medicareWagesBox5: 60000 }] });
  const mefIds = plain.filter((d) => d.category === "MeF e-file rules").map((d) => d.id);
  ok(`NFP: plain single W-2 → zero MeF rejects (got ${mefIds.length})`, mefIds.length === 0);
}

console.log(`\nT1.5 #4 — MeF e-file business-rule diagnostics (F1040-021/034/035/164, F8959, F8962-070, SEIC-F1040-535/501, Sch H):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
