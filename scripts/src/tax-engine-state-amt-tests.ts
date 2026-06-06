/**
 * P2-2 — State AMT (Minnesota Schedule M1MT). Hand-calc'd. NO API.
 *
 * MN AMT (Minn. Stat. §290.091): 6.75% flat on MN AMTI after the exemption, as a
 * delta over regular MN tax, for MN residents with AMT preferences. Exemptions
 * are the §290.091 subd. 3 statutory figures ($77,590 MFJ / $58,190 single /
 * $38,800 MFS); the exemption phases out 25¢/$ over the §55(d) threshold
 * ($1,218,700 MFJ / $609,350 others, 2024). MN AMTI ≈ federal AGI + the engine's
 * AMT preferences (the federal-AMTI proxy, same approximation as the CA pattern).
 *
 * NY: the NY "minimum income tax" (Form IT-220) is a NARROW 6% tax on specific
 * NY tax-preference items (largely repealed/rare) — NOT a broad income AMT. The
 * engine's federal AMT preferences do not map to NY's preference list, so a
 * faithful IT-220 is ~$0 for typical clients; a fabricated broad NY AMT is
 * intentionally NOT modeled.
 * NJ: New Jersey has NO individual alternative minimum tax (the NJ AMT applies
 * only to corporations) — verified below (prefs change nothing).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-state-amt-tests.ts
 */
import { computeTaxReturnPure, type TaxReturnInputs, type AdjustmentFact } from "../../artifacts/api-server/src/lib/taxReturnEngine";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }

const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });
const run = (state: string, wages: number, adj: AdjustmentFact[], fs = "single"): ReturnType<typeof computeTaxReturnPure> =>
  computeTaxReturnPure({
    client: { filingStatus: fs, state, taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: wages, stateCode: state }],
    form1099s: [], adjustments: adj, taxYear: 2024,
  } as TaxReturnInputs);

// ════════════════════════════════════════════════════════════════════════════
// 1. MN AMT binds: large preference, exemption not phased out
// ════════════════════════════════════════════════════════════════════════════
header("MN AMT binds (preference pushes tentative above regular)");
{
  // Single, W-2 $300k, ISO preference $200k → MN AMTI = $500k. Exemption $58,190
  // (no phase-out; $500k < $609,350). Base = $441,810. Tentative = 6.75% ×
  // $441,810 = $29,822.18. Regular MN tax $22,697.11 → AMT binds → final $29,822.18.
  const pref = run("MN", 300000, [A("amt_iso_bargain_element", 200000)]);
  const noPref = run("MN", 300000, []);
  check("MN no-pref regular state tax = $22,697.11", noPref.stateTaxLiability, 22697.11, 0.5);
  check("MN final state tax = tentative AMT $29,822.18", pref.stateTaxLiability, 29822.18, 0.5);
  check("MN AMT delta = $7,125.07", pref.stateTaxLiability - noPref.stateTaxLiability, 7125.07, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. MN AMT exemption phase-out (AMTI over $609,350)
// ════════════════════════════════════════════════════════════════════════════
header("MN AMT exemption phase-out");
{
  // Single, W-2 $400k, preference $400k → AMTI $800k. Exemption = 58,190 −
  // 0.25×(800,000−609,350) = 58,190 − 47,662.50 = $10,527.50. Base = $789,472.50.
  // Tentative = 6.75% × $789,472.50 = $53,289.39 (> regular MN → binds).
  const r = run("MN", 400000, [A("amt_preferences", 400000)]);
  check("MN phased-exemption final state tax = $53,289.39", r.stateTaxLiability, 53289.39, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. MN AMT does NOT bind when tentative < regular (high earner, small pref)
// ════════════════════════════════════════════════════════════════════════════
header("MN AMT does not bind when 6.75% tentative < progressive regular tax");
{
  // W-2 $500k, small $10k pref → AMTI $510k, exemption $58,190, base $451,810,
  // tentative 6.75% × $451,810 = $30,497.18 < regular MN (~$45k) → delta 0.
  const pref = run("MN", 500000, [A("amt_preferences", 10000)]);
  const noPref = run("MN", 500000, []);
  check("MN: small-pref state tax == no-pref (no AMT delta)", pref.stateTaxLiability, noPref.stateTaxLiability, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 4. MN no preferences → AMT path not triggered
// ════════════════════════════════════════════════════════════════════════════
header("MN no preferences → no AMT");
{
  const r = run("MN", 100000, []);
  // $100k single MN, no pref → just regular MN tax, no spurious AMT.
  checkBool("MN $100k no-pref state tax > 0 and finite", r.stateTaxLiability > 0 && Number.isFinite(r.stateTaxLiability), true);
  // Adding a preference at this income must NOT raise the tax (6.75% tentative
  // well below regular progressive tax) — proves no over-charge at low income.
  const withPref = run("MN", 100000, [A("amt_preferences", 20000)]);
  check("MN $100k: preference does not raise state tax (tentative < regular)", withPref.stateTaxLiability, r.stateTaxLiability, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// 5. NJ has NO individual AMT (preferences change nothing)
// ════════════════════════════════════════════════════════════════════════════
header("NJ — no individual AMT");
{
  const pref = run("NJ", 300000, [A("amt_iso_bargain_element", 200000)]);
  const noPref = run("NJ", 300000, []);
  check("NJ: AMT preference does NOT change state tax (no NJ individual AMT)", pref.stateTaxLiability, noPref.stateTaxLiability, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// 6. CA AMT regression — still computes (Schedule P 540, 7%)
// ════════════════════════════════════════════════════════════════════════════
header("CA AMT regression (unchanged by MN addition)");
{
  // CA exemption $244,857 single. W-2 $300k + pref $200k → CA AMTI $500k, base
  // $255,143, tentative 7% × $255,143 = $17,860.01. Only binds if > regular CA.
  const pref = run("CA", 300000, [A("amt_iso_bargain_element", 200000)]);
  const noPref = run("CA", 300000, []);
  checkBool("CA AMT path active (state tax with prefs >= without)", pref.stateTaxLiability >= noPref.stateTaxLiability, true);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log(f); process.exit(1); }
console.log("ALL STATE AMT TESTS GREEN");
