/**
 * T1.2 state depth — CO + CT individual AMT, and the WA capital-gains excise
 * + 2.9% surcharge. Values verified vs DR 0104AMT / CT-6251 / RCW 82.87.
 * Calls calculateMultiStateTax directly (to control the federal TMT input).
 *
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-t1-state-depth-tests.ts
 */
import { calculateMultiStateTax } from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (Δ ${(actual - expected).toFixed(2)})`);
}
function ok(label: string, cond: boolean) { (cond ? PASS : FAIL).push(`${cond ? "✓" : "✗"} ${label}`); }
function header(t: string) { console.log(`\n── ${t} ──`); }

const ms = (state: string, agi: number, year: number, opts: Record<string, unknown>, status = "single") =>
  calculateMultiStateTax({
    residentState: state, federalAgi: agi, filingStatus: status, taxYear: year,
    perStateWages: [{ stateCode: state, wages: 0 }], totalWages: 0, options: opts,
  }).residentStateTax;

// ── WA capital-gains excise + 2025 surcharge (RCW 82.87) ──
header("WA LTCG excise — threshold + 2.9% surcharge over $1M");
{
  // 2024: 7% × ($500k − $270k threshold) = $16,100. No surcharge.
  check("WA 2024 $500k LTCG → $16,100", ms("WA", 5000000, 2024, { longTermCapitalGains: 500000 }), 16100, 0.5);
  // 2025: surcharge is on the TAXABLE (post-$278k-deduction) gain over $1M, NOT
  // gross. taxable = $1.5M − $278k = $1,222,000. 7%×$1,222,000 + 2.9%×($1,222,000 −
  // $1M) = 85,540 + 2.9%×222,000 = 85,540 + 6,438 = $91,978. (Was wrongly $100,040
  // using gross-over-$1M — over-stated by 2.9% × the $278k standard deduction.)
  check("WA 2025 $1.5M LTCG → $91,978 (surcharge on taxable gain over $1M)", ms("WA", 5000000, 2025, { longTermCapitalGains: 1500000 }), 91978, 0.5);
  // 2025 taxable gain under $1M → no surcharge: 7% × ($800k − $278k) = $36,540.
  check("WA 2025 $800k LTCG → $36,540 (no surcharge under $1M)", ms("WA", 5000000, 2025, { longTermCapitalGains: 800000 }), 36540, 0.5);
}

// ── CO AMT (DR 0104AMT) — 3.47% of the FEDERAL AMT BASE (AMTI − exemption) ──
header("CO AMT — 3.47% of the federal AMT base, delta over regular tax");
{
  const noPrefs = ms("CO", 500000, 2024, {});
  // §39-22-105(2): CO AMTI = federal AMTI − federal exemption = the federal AMT
  // base (Form 6251 line 6), passed as federalAmtBase. 3.47% × $800k = $27,760.
  const withPrefs = ms("CO", 500000, 2024, { amtPreferences: 300000, federalAmtBase: 800000 });
  check("CO with prefs → max(regular, 3.47%×$800k = $27,760)", withPrefs, 27760, 1);
  ok("CO AMT raises tax over the no-prefs regular tax", withPrefs > noPrefs);
  ok("CO without prefs has no AMT add-on", noPrefs < 27760);
  // Without a federalAmtBase the AMT cannot fire (no AMTI supplied) — regression
  // that the new exemption-aware base is required (vs the old AGI proxy).
  ok("CO AMT requires the federal AMT base", ms("CO", 500000, 2024, { amtPreferences: 300000 }) === noPrefs);
}

// ── CT AMT (CT-6251) — lesser of (19%×TMT, 5.5%×federal AMT base), delta over regular ──
header("CT AMT — lesser-of(19%×TMT, 5.5%×federal AMT base)");
{
  // CT's exemption tracks federal, so the 5.5% prong's base = the federal AMT base
  // (AMTI − federal exemption), passed as federalAmtBase = $880,000. 5.5%×$880k =
  // $48,400. HIGH federal TMT → the 5.5% prong is the lesser.
  const noPrefs = ms("CT", 600000, 2024, { federalTentativeMinimumTax: 1000000, federalAmtBase: 880000 });
  const withPrefsHighTmt = ms("CT", 600000, 2024, { amtPreferences: 300000, federalTentativeMinimumTax: 1000000, federalAmtBase: 880000 });
  check("CT 5.5%×base path → total = max(regular, $48,400)", withPrefsHighTmt, Math.max(noPrefs, 0.055 * 880000), 1);
  // LOW federal TMT ($200k) → 19%×$200k = $38,000 < $48,400 → the 19%×TMT prong is
  // the lesser-of → tentative = $38,000 (binds only if > regular CT tax).
  const withPrefsLowTmt = ms("CT", 600000, 2024, { amtPreferences: 300000, federalTentativeMinimumTax: 200000, federalAmtBase: 880000 });
  check("CT 19%×TMT path → total = max(regular, $38,000)", withPrefsLowTmt, Math.max(noPrefs, 38000), 1);
  ok("CT AMT (high TMT) raises tax over no-prefs", withPrefsHighTmt > noPrefs);
}

// ── summary ──
console.log(`\n${"═".repeat(60)}`);
for (const f of FAIL) console.log(f);
console.log(`\nT1.2-state-depth: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
