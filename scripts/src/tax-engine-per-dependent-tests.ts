/**
 * T1.5 #5 — per-dependent data model → EXACT credit-gating derivation.
 *
 * Models each dependent ONCE (DOB / SSN / relationship / residency / student /
 * disabled) and derives every credit's count (CTC / ODC / EITC-child / §21 care /
 * under-6) from the statute, instead of trusting separate scalar counts. Verifies
 * the derivation rules + that `TaxReturnInputs.dependents` overrides the scalar
 * counts end-to-end (and that omitting it preserves the legacy behavior).
 *
 * Every expected value is HAND-CALC'D against §24 / §24(h)(4) / §32(c)(3) / §21.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-per-dependent-tests.ts
 */
import {
  deriveDependentCounts,
  ageAtYearEnd,
  type DependentFact,
} from "../../artifacts/api-server/src/lib/dependents";
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function eq(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function ok(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`); else FAIL.push(`✗ ${label}`);
}
const TY = 2024;
const child = (birthYear: number, extra: Partial<DependentFact> = {}): DependentFact =>
  ({ birthYear, hasSsn: true, relationship: "daughter", ...extra });

// ════════════════════════════════════════════════════════════════════════════
// A — ageAtYearEnd: birthYear and ISO dateOfBirth; null when unknown.
// ════════════════════════════════════════════════════════════════════════════
eq("age: born 2019 → 5 at end of 2024", ageAtYearEnd({ birthYear: 2019 }, 2024)!, 5);
eq("age: born 2007 → 17 at end of 2024", ageAtYearEnd({ birthYear: 2007 }, 2024)!, 17);
eq("age from ISO DOB 2014-03-02 → 10", ageAtYearEnd({ dateOfBirth: "2014-03-02" }, 2024)!, 10);
ok("age null when no birth info", ageAtYearEnd({ relationship: "son" }, 2024) === null);

// ════════════════════════════════════════════════════════════════════════════
// B — derivation rules (taxYear 2024).
// ════════════════════════════════════════════════════════════════════════════
{
  // Two young children (5, 10), SSN, daughters.
  const d = deriveDependentCounts([child(2019), child(2014)], TY);
  ok("B1 two kids 5+10: CTC=2, ODC=0, EITC=2, care=2, under6=1",
    d.dependentsUnder17 === 2 && d.otherDependents === 0 && d.eitcQualifyingChildren === 2 && d.dependentsForCareCredit === 2 && d.childrenUnder6 === 1);
}
{
  // 17-year-old child with SSN → too old for CTC (→ ODC), but EITC-eligible (<19).
  const d = deriveDependentCounts([child(2007)], TY);
  ok("B2 age-17 child: CTC=0, ODC=1, EITC=1, care=0",
    d.dependentsUnder17 === 0 && d.otherDependents === 1 && d.eitcQualifyingChildren === 1 && d.dependentsForCareCredit === 0);
}
{
  // ITIN child (no SSN), age 8 → no CTC (→ ODC), no EITC, but care-eligible (<13).
  const d = deriveDependentCounts([child(2016, { hasSsn: false })], TY);
  ok("B3 ITIN child age 8: CTC=0, ODC=1, EITC=0, care=1 (care needs no SSN)",
    d.dependentsUnder17 === 0 && d.otherDependents === 1 && d.eitcQualifyingChildren === 0 && d.dependentsForCareCredit === 1);
}
{
  // Full-time student age 20 → ODC, EITC-eligible (<24 student), not care.
  const d = deriveDependentCounts([child(2004, { isStudent: true })], TY);
  ok("B4 student age 20: CTC=0, ODC=1, EITC=1, care=0",
    d.dependentsUnder17 === 0 && d.otherDependents === 1 && d.eitcQualifyingChildren === 1 && d.dependentsForCareCredit === 0);
}
{
  // Qualifying RELATIVE (parent, age 70) → ODC only, never EITC/CTC/care.
  const d = deriveDependentCounts([{ birthYear: 1954, hasSsn: true, relationship: "parent" }], TY);
  ok("B5 parent age 70: CTC=0, ODC=1, EITC=0, care=0",
    d.dependentsUnder17 === 0 && d.otherDependents === 1 && d.eitcQualifyingChildren === 0 && d.dependentsForCareCredit === 0);
}
{
  // Permanently disabled adult child (age 30) → ODC, EITC (any age), care (disabled).
  const d = deriveDependentCounts([child(1994, { isPermanentlyDisabled: true })], TY);
  ok("B6 disabled adult child: CTC=0, ODC=1, EITC=1 (any age), care=1 (disabled)",
    d.dependentsUnder17 === 0 && d.otherDependents === 1 && d.eitcQualifyingChildren === 1 && d.dependentsForCareCredit === 1);
}
{
  // Residency fail (lived 3 months) → fails qualifying-child tests; still a dependent (ODC).
  const d = deriveDependentCounts([child(2016, { monthsInHome: 3 })], TY);
  ok("B7 residency-fail child: CTC=0, EITC=0, care=0, ODC=1",
    d.dependentsUnder17 === 0 && d.eitcQualifyingChildren === 0 && d.dependentsForCareCredit === 0 && d.otherDependents === 1);
}
{
  // EITC "younger than the taxpayer": a 20-yo student dependent of a 19-yo... is
  // not younger than the taxpayer → not an EITC qualifying child.
  const d = deriveDependentCounts([child(2004, { isStudent: true })], TY, /*taxpayerBirthYear*/ 2005);
  ok("B8 EITC younger-than-taxpayer fails (dep 20 ≥ taxpayer 19)", d.eitcQualifyingChildren === 0);
}

// ════════════════════════════════════════════════════════════════════════════
// C — END-TO-END: TaxReturnInputs.dependents derives + OVERRIDES the scalar
//   counts. MFJ $40k, 2 qualifying children → ACTC $2,920 (golden-pack anchor:
//   tax 1,080; CTC $4,000; nonref 1,080; ACTC min(2,920, 5,625, $3,400)=2,920).
// ════════════════════════════════════════════════════════════════════════════
function actc(inputs: Partial<TaxReturnInputs> & { client: TaxReturnInputs["client"] }): number {
  const r = computeTaxReturnPure({ w2s: [], form1099s: [], adjustments: [], taxYear: 2024, ...inputs } as TaxReturnInputs);
  return Number(r.additionalChildTaxCredit);
}
{
  const base = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 } as TaxReturnInputs["client"],
    w2s: [{ taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 0 } as never],
  };
  // Derived from per-dependent facts (2 young kids), scalar counts absent.
  eq("C1 dependents[2 kids] → ACTC $2,920 (derived)", actc({ ...base, dependents: [child(2019), child(2014)] }), 2920);
  // Control: explicit scalar count, no dependents[] → identical.
  eq("C2 scalar dependentsUnder17=2 (no dependents[]) → ACTC $2,920 (back-compat)",
    actc({ client: { ...base.client, dependentsUnder17: 2 }, w2s: base.w2s }), 2920);
  // OVERRIDE: a WRONG scalar count of 5 is overridden by the derived 2.
  eq("C3 dependents[] OVERRIDES a wrong scalar count (5→derived 2) → ACTC $2,920",
    actc({ client: { ...base.client, dependentsUnder17: 5 }, w2s: base.w2s, dependents: [child(2019), child(2014)] }), 2920);
  // A 17-year-old + an 8-year-old: only ONE CTC child (the 8yo); the 17yo is ODC.
  //   CTC $2,000 (8yo) + ODC $500 (17yo); tax 1,080. The $500 ODC (nonrefundable-
  //   only) is absorbed against tax FIRST, so only $580 of CTC is used
  //   nonrefundably → CTC refundable remaining $2,000 − $580 = $1,420;
  //   ACTC = min($1,420, $1,700 cap, 15%×37,500=$5,625) = $1,420.
  eq("C4 dependents[17yo ODC + 8yo CTC] → ACTC $1,420 (ODC absorbs tax first)",
    actc({ ...base, dependents: [child(2007), child(2016)] }), 1420);
}

console.log(`\nT1.5 #5 — per-dependent data model → exact credit gating (§24/§24(h)(4)/§32(c)(3)/§21):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
