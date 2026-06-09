/**
 * T1.2 §280F — luxury-auto depreciation caps + listed-property + heavy-SUV cap.
 * Every expected value hand-calc'd against Rev. Proc. 2024-13 / 2025-16 + IRC
 * §280F / §179(b)(5). Tests `computeScheduleCAssetDepreciation` (Sch C / Form 4562).
 *
 *   pnpm --filter @workspace/scripts exec tsx src/tax-engine-section280f-tests.ts
 */
import { computeScheduleCAssetDepreciation, type ScheduleCAsset } from "../../artifacts/api-server/src/lib/taxCalculator";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.5) {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected.toFixed(2)}, got ${actual.toFixed(2)} (Δ ${(actual - expected).toFixed(2)})`);
}
function ok(label: string, cond: boolean) { (cond ? PASS : FAIL).push(`${cond ? "✓" : "✗"} ${label}`); }
function header(t: string) { console.log(`\n── ${t} ──`); }

// 2024 bonus rate = 60% (TCJA phase-down); 2025 = 40%. (We pass these explicitly.)
const BONUS = { 2023: 0.8, 2024: 0.6, 2025: 0.4, 2026: 0.4 };
function run(assets: ScheduleCAsset[], taxYear: number, income = 500000) {
  return computeScheduleCAssetDepreciation({
    assets, taxYear, businessIncomeForSection179: income,
    section179Cap: 1220000, section179PhaseStart: 3050000, bonusRateByYear: BONUS,
  });
}

// ── Case 1: 2024 passenger auto $60k, 100% business, bonus, YEAR 1 ──
// Uncapped Y1 = 60%×60,000 bonus (36,000) + 20%×(24,000 MACRS basis)=4,800 → 40,800.
// §280F Y1-with-bonus cap (2024) = $20,400 → deduction capped at $20,400.
header("§280F — 2024 auto $60k, bonus, Y1 → $20,400 cap");
{
  const r = run([{ cost: 60000, recoveryYears: 5, placedInServiceYear: 2024, bonus: true, isPassengerAuto: true }], 2024);
  check("Y1 total depreciation = $20,400", r.totalDepreciation, 20400, 0.5);
  ok("§280F cap flagged", r.section280FCapApplied === true);
}

// ── Case 2: SAME auto, YEAR 2 (taxYear 2025, placed 2024) ──
// Caps stay on the 2024 vintage. Y2 MACRS = 32%×24,000 = $7,680 (< the $19,800
// Y2-2024 cap → not capped).
header("§280F — 2024 auto, Y2 (2025) → $7,680 (vintage-fixed cap)");
{
  const r = run([{ cost: 60000, recoveryYears: 5, placedInServiceYear: 2024, bonus: true, isPassengerAuto: true }], 2025);
  check("Y2 depreciation = $7,680", r.totalDepreciation, 7680, 0.5);
  ok("Y2 not capped", r.section280FCapApplied === false);
}

// ── Case 3: 2024 auto $80k, 100%, NO bonus — the cap binds Y1-Y4 + overhang ──
// Y1 20%×80k=16,000 → cap 12,400. Y2 32%×80k=25,600 → cap 19,800. Y3 19.2%×80k=
// 15,360 → cap 11,900. Y4 11.52%×80k=9,216 → cap 7,160. Overhang Y7 = $7,160.
// Full life sums to $80,000 (basis recovered over ~9 years).
header("§280F — 2024 auto $80k no-bonus: caps Y1-Y4 + overhang");
{
  const mk = (ty: number) => run([{ cost: 80000, recoveryYears: 5, placedInServiceYear: 2024, bonus: false, isPassengerAuto: true }], ty);
  check("Y1 = $12,400 (y1NoBonus cap)", mk(2024).totalDepreciation, 12400, 0.5);
  check("Y2 = $19,800 (y2 cap)", mk(2025).totalDepreciation, 19800, 0.5);
  check("Y3 = $11,900 (y3 cap)", mk(2026).totalDepreciation, 11900, 0.5);
  check("Y4 = $7,160 (y4+ cap)", mk(2027).totalDepreciation, 7160, 0.5);
  check("Y7 = $7,160 (overhang at y4+ cap)", mk(2030).totalDepreciation, 7160, 0.5);
  // Cumulative over the whole life must equal the $80,000 basis (no loss).
  let total = 0;
  for (let ty = 2024; ty <= 2040; ty++) total += mk(ty).totalDepreciation;
  check("Σ life depreciation = full $80,000 basis", total, 80000, 1);
}

// ── Case 4: business-use proration (80%) caps × 0.80 ──
// businessBasis 48,000; Y1 bonus 60%×48,000=28,800 + 20%×19,200=3,840 → 32,640.
// cap = $20,400 × 0.80 = $16,320.
header("§280F — 80% business use: cap × 0.80");
{
  const r = run([{ cost: 60000, recoveryYears: 5, placedInServiceYear: 2024, bonus: true, isPassengerAuto: true, businessUsePct: 0.8 }], 2024);
  check("Y1 = $16,320 (cap × 80%)", r.totalDepreciation, 16320, 0.5);
}

// ── Case 5: ≤50% business use → ADS straight-line, no bonus (§280F(b)(1)) ──
// 40% use: businessBasis 24,000; ADS Y1 = 10%×24,000 = $2,400 (< the prorated cap).
header("§280F(b)(1) — ≤50% use → ADS SL, no bonus");
{
  const r = run([{ cost: 60000, recoveryYears: 5, placedInServiceYear: 2024, bonus: true, isPassengerAuto: true, businessUsePct: 0.4 }], 2024);
  check("Y1 ADS = $2,400 (10% of $24k business basis)", r.totalDepreciation, 2400, 0.5);
  // Y2 ADS = 20%×24,000 = $4,800.
  const r2 = run([{ cost: 60000, recoveryYears: 5, placedInServiceYear: 2024, bonus: true, isPassengerAuto: true, businessUsePct: 0.4 }], 2025);
  check("Y2 ADS = $4,800 (20% of $24k)", r2.totalDepreciation, 4800, 0.5);
}

// ── Case 6: heavy SUV (GVWR > 6,000) escapes §280F; §179 capped at SUV cap ──
// $90k SUV, §179 + bonus, 2024: §179 = min($30,500 SUV cap, 90,000) = $30,500.
// remBasis 59,500; bonus 60%×59,500 = 35,700; MACRS 20%×23,800 = 4,760.
// total = 30,500 + 35,700 + 4,760 = $70,960. NO §280F cap.
header("§280F(d)(5) — heavy SUV: §179(b)(5) cap, no luxury cap");
{
  const r = run([{ cost: 90000, recoveryYears: 5, placedInServiceYear: 2024, section179: true, bonus: true, isPassengerAuto: true, gvwrOver6000: true }], 2024, 200000);
  check("SUV §179 = $30,500 (SUV cap)", r.section179Deduction, 30500, 0.5);
  check("SUV total = $70,960", r.totalDepreciation, 70960, 0.5);
  ok("no §280F cap on the SUV", r.section280FCapApplied === false);
}

// ── Case 7: regression — a non-auto asset is unaffected ──
// $10k 5-yr computer, bonus 60% 2024: bonus 6,000 + MACRS 20%×4,000 = 800 → $6,800.
header("§280F — non-auto asset unaffected (regression)");
{
  const r = run([{ cost: 10000, recoveryYears: 5, placedInServiceYear: 2024, bonus: true }], 2024);
  check("non-auto Y1 = $6,800", r.totalDepreciation, 6800, 0.5);
}

// ── summary ──
console.log(`\n${"═".repeat(60)}`);
for (const f of FAIL) console.log(f);
console.log(`\n§280F: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
