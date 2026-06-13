/**
 * T1.5 #6 — community-property MFS income splitting (Form 8958), FS-3.
 *
 * In the 9 community-property states, MFS spouses each report HALF of all
 * community income regardless of who earned it — so the MFJ-vs-MFS optimizer must
 * split 50/50, NOT by the spouse tag. This makes a one-earner couple's MFS halves
 * two equal lower-bracket returns instead of one high-bracket + one empty return.
 *
 * Every expected value is HAND-CALC'D against the 2024 MFS rate schedule.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-community-property-mfs-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { optimizeFilingStatus } from "../../artifacts/api-server/src/lib/filingStatusOptimizer";
import {
  isCommunityPropertyState,
  COMMUNITY_PROPERTY_STATES,
  halveCommunityDollars,
} from "../../artifacts/api-server/src/lib/communityProperty";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function ok(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`); else FAIL.push(`✗ ${label}`);
}
function optimize(inputs: TaxReturnInputs) {
  const ret = computeTaxReturnPure(inputs);
  return optimizeFilingStatus({ jointInputs: inputs, jointReturn: ret });
}

// ════════════════════════════════════════════════════════════════════════════
// STATE SET — the 9 community-property states, and a few common-law controls.
// ════════════════════════════════════════════════════════════════════════════
for (const st of ["AZ", "CA", "ID", "LA", "NV", "NM", "TX", "WA", "WI"]) {
  ok(`${st} is a community-property state`, isCommunityPropertyState(st));
}
for (const st of ["FL", "NY", "NJ", "GA", "PA", "OH", "VA"]) {
  ok(`${st} is NOT community-property`, !isCommunityPropertyState(st));
}
ok("exactly 9 community-property states", COMMUNITY_PROPERTY_STATES.size === 9);
ok("isCommunityPropertyState case-insensitive", isCommunityPropertyState("ca") && isCommunityPropertyState("Tx"));
ok("isCommunityPropertyState null-safe", !isCommunityPropertyState(null) && !isCommunityPropertyState(undefined));

// ════════════════════════════════════════════════════════════════════════════
// halveCommunityDollars — halves dollar fields, never taxYear; leaves strings.
// ════════════════════════════════════════════════════════════════════════════
{
  const w = halveCommunityDollars({ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 10000, employerName: "Acme", stateCode: "TX", spouse: "taxpayer" } as Record<string, unknown>);
  check("halve wages 120k → 60k", w.wagesBox1 as number, 60000);
  check("halve withholding 10k → 5k", w.federalTaxWithheldBox2 as number, 5000);
  ok("taxYear NOT halved (2024)", w.taxYear === 2024);
  ok("employerName string untouched", w.employerName === "Acme");
  ok("stateCode string untouched", w.stateCode === "TX");
}

// ════════════════════════════════════════════════════════════════════════════
// E1 — ONE-EARNER MFJ couple, $120k W-2, in TX (community-property, NO state tax).
//   COMMUNITY 50/50: each spouse $60,000 → MFS taxable 60,000 − 14,600 = 45,400 →
//   MFS tax 1,160 + 12%×33,800 = $5,216 each → combined $10,432.
//   (Tag-based would put all $120k on the taxpayer: $18,338.50 — see E2.)
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "TX", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 0 }],
    form1099s: [], adjustments: [], taxYear: 2024,
  };
  const o = optimize(inputs)!;
  ok("E1 communityPropertySplit = true (TX)", o.assumptions.communityPropertySplit);
  check("E1 MFS taxpayer net = $5,216 (half income)", o.mfs.taxpayer.netTaxAfterCredits, 5216);
  check("E1 MFS spouse net = $5,216 (community → also half)", o.mfs.spouse.netTaxAfterCredits, 5216);
  check("E1 MFS combined = $10,432 (50/50 split)", o.mfs.combinedNetTaxAfterCredits, 10432);
}

// ════════════════════════════════════════════════════════════════════════════
// E2 — SAME couple in FL (common-law, NO state tax). Tag-based (no tags) →
//   all $120k on the taxpayer: MFS taxable 105,400 → tax 1,160 + 12%×35,550 +
//   22%×53,375 + 24%×4,875 = $18,338.50; spouse $0. Combined $18,338.50.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 0 }],
    form1099s: [], adjustments: [], taxYear: 2024,
  };
  const o = optimize(inputs)!;
  ok("E2 communityPropertySplit = false (FL common-law)", !o.assumptions.communityPropertySplit);
  check("E2 MFS taxpayer net = $18,338.50 (all income, tag-based)", o.mfs.taxpayer.netTaxAfterCredits, 18338.5);
  check("E2 MFS spouse net = $0", o.mfs.spouse.netTaxAfterCredits, 0);
  check("E2 MFS combined = $18,338.50", o.mfs.combinedNetTaxAfterCredits, 18338.5);
}

// ════════════════════════════════════════════════════════════════════════════
// E3 — community splitting LOWERS a one-earner couple's MFS tax vs common-law.
// ════════════════════════════════════════════════════════════════════════════
{
  const mk = (state: string): TaxReturnInputs => ({
    client: { filingStatus: "married_filing_jointly", state, taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 0 }],
    form1099s: [], adjustments: [], taxYear: 2024,
  });
  const tx = optimize(mk("TX"))!;
  const fl = optimize(mk("FL"))!;
  ok("E3 TX (community) MFS combined < FL (common-law) MFS combined",
    tx.mfs.combinedNetTaxAfterCredits < fl.mfs.combinedNetTaxAfterCredits);
}

// ════════════════════════════════════════════════════════════════════════════
// E4 — community split IGNORES the spouse tags: a TWO-earner couple ($80k tagged
//   taxpayer + $40k tagged spouse) in TX still splits the $120k community total
//   50/50 → each $60k → combined $10,432, identical to the one-earner E1.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "married_filing_jointly", state: "TX", taxYear: 2024 },
    w2s: [
      { taxYear: 2024, wagesBox1: 80000, federalTaxWithheldBox2: 0, spouse: "taxpayer" },
      { taxYear: 2024, wagesBox1: 40000, federalTaxWithheldBox2: 0, spouse: "spouse" },
    ],
    form1099s: [], adjustments: [], taxYear: 2024,
  };
  const o = optimize(inputs)!;
  ok("E4 communityPropertySplit = true despite spouse tags", o.assumptions.communityPropertySplit);
  check("E4 MFS combined = $10,432 (tags ignored; 50/50 of the $120k total)", o.mfs.combinedNetTaxAfterCredits, 10432);
}

console.log(`\nT1.5 #6 — community-property MFS 50/50 splitting (Form 8958, FS-3):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
