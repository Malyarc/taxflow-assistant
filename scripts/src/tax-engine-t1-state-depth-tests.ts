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
  // 2025: 7% × ($1.5M − $278k) + 2.9% × ($1.5M − $1M) = 85,540 + 14,500 = $100,040.
  check("WA 2025 $1.5M LTCG → $100,040 (7% + 2.9% surcharge)", ms("WA", 5000000, 2025, { longTermCapitalGains: 1500000 }), 100040, 0.5);
  // 2025 gain under $1M → no surcharge: 7% × ($800k − $278k) = $36,540.
  check("WA 2025 $800k LTCG → $36,540 (no surcharge under $1M)", ms("WA", 5000000, 2025, { longTermCapitalGains: 800000 }), 36540, 0.5);
}

// ── CO AMT (DR 0104AMT) — 3.47% of CO AMTI, delta over regular CO tax ──
header("CO AMT — 3.47% of AMTI binds over regular tax");
{
  const noPrefs = ms("CO", 500000, 2024, {});
  const withPrefs = ms("CO", 500000, 2024, { amtPreferences: 300000 });
  // CO AMTI = $500k + $300k = $800k → tentative 3.47% × $800k = $27,760. It binds
  // over the regular CO tax → total = $27,760.
  check("CO with prefs → max(regular, $27,760) = $27,760", withPrefs, 27760, 1);
  ok("CO AMT raises tax over the no-prefs regular tax", withPrefs > noPrefs);
  // No preferences → no AMT (regular only).
  ok("CO without prefs has no AMT add-on", noPrefs < 27760);
}

// ── CT AMT (CT-6251) — lesser of (19%×TMT, 5.5%×AMTI), delta over regular ──
header("CT AMT — lesser-of(19%×TMT, 5.5%×AMTI)");
{
  // single $600k AGI + $300k prefs → CT AMTI $900k. Exemption: $88,100 −
  // 0.25×($900k − $626,350) = $88,100 − $68,412.50 = $19,687.50. AMTI after
  // exemption = $880,312.50. 5.5%×that = $48,417.19.
  const ctAmtiAfterEx = 900000 - Math.max(0, 88100 - 0.25 * (900000 - 626350));
  const byAmti = 0.055 * ctAmtiAfterEx; // 48,417.19
  // HIGH federal TMT → the 5.5%×AMTI path is the lesser → tentative = $48,417.19.
  const noPrefs = ms("CT", 600000, 2024, { federalTentativeMinimumTax: 1000000 });
  const withPrefsHighTmt = ms("CT", 600000, 2024, { amtPreferences: 300000, federalTentativeMinimumTax: 1000000 });
  check("CT 5.5%×AMTI path → total = max(regular, $48,417.19)", withPrefsHighTmt, Math.max(noPrefs, byAmti), 1);
  // LOW federal TMT ($200k) → 19%×$200k = $38,000 < $48,417 → the 19%×TMT path is
  // the lesser-of → tentative = $38,000 (binds only if > regular CT tax).
  const withPrefsLowTmt = ms("CT", 600000, 2024, { amtPreferences: 300000, federalTentativeMinimumTax: 200000 });
  check("CT 19%×TMT path → total = max(regular, $38,000)", withPrefsLowTmt, Math.max(noPrefs, 38000), 1);
  ok("CT AMT (high TMT) raises tax over no-prefs", withPrefsHighTmt > noPrefs);
}

// ── summary ──
console.log(`\n${"═".repeat(60)}`);
for (const f of FAIL) console.log(f);
console.log(`\nT1.2-state-depth: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
