/**
 * Unit tests for validateW2 — the W-2 sanity-check / box-arithmetic flag generator.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-w2-validation-tests.ts
 *
 * No API needed; pure function testing.
 *
 * Hand-calc reference for box-arithmetic rules:
 *   Box 4 ≈ Box 3 × 6.2%   (Social Security tax, capped at SS wage base)
 *   Box 6 ≈ Box 5 × 1.45%  (Medicare tax; +0.9% on Box 5 > $200,000)
 *   Box 3 ≤ SS wage base   (2024 = $168,600)
 *   Box 3 == Box 5 when Box 5 ≤ cap (both ignore 401(k); §125 cafeteria
 *     plans reduce both equally; off-by-401(k) means Box 1 < Box 5 = Box 3)
 *   Box 5 ≥ Box 1          (Box 1 is reduced by pre-tax 401(k), Box 5 isn't)
 *   Box 16 ≈ Box 1         (typically; multi-state employees differ)
 *   Box 17 / Box 16 < 15%  (no US state has marginal rates above ~13%)
 */

import { validateW2 } from "@workspace/validation";

const PASS: string[] = [];
const FAIL: string[] = [];

function expect(label: string, condition: boolean, detail: string = "") {
  if (condition) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
}

function hasFlag(flags: ReturnType<typeof validateW2>, field: string | null, severityFilter?: "error" | "warning" | "info"): boolean {
  return flags.some((f) => f.field === field && (severityFilter ? f.severity === severityFilter : true));
}

function flagsForField(flags: ReturnType<typeof validateW2>, field: string | null) {
  return flags.filter((f) => f.field === field);
}

console.log("── Year mismatch ──");
{
  const flags = validateW2({ taxYear: 2023 }, { clientTaxYear: 2024 });
  expect("Flags taxYear mismatch", hasFlag(flags, "taxYear", "warning"));

  const noFlags = validateW2({ taxYear: 2024 }, { clientTaxYear: 2024 });
  expect("No flag when years match", !hasFlag(noFlags, "taxYear"));
}

console.log("\n── State mismatch ──");
{
  const flags = validateW2({ stateCode: "TX" }, { clientState: "FL" });
  expect("Flags state mismatch (info severity)", hasFlag(flags, "stateCode", "info"));

  const same = validateW2({ stateCode: "FL" }, { clientState: "FL" });
  expect("No flag when states match", !hasFlag(same, "stateCode"));

  const caseInsensitive = validateW2({ stateCode: "fl" }, { clientState: "FL" });
  expect("Case-insensitive state match", !hasFlag(caseInsensitive, "stateCode"));
}

console.log("\n── SSN mismatch with other W-2s ──");
{
  const flags = validateW2(
    { employeeSSN: "123-45-6789" },
    { knownSsns: ["999-99-9999"] },
  );
  expect("Flags SSN mismatch as error", hasFlag(flags, "employeeSSN", "error"));

  const ok = validateW2(
    { employeeSSN: "123-45-6789" },
    { knownSsns: ["XXX-XX-6789"] },
  );
  expect("Matching last-4 SSN doesn't flag", !hasFlag(ok, "employeeSSN"));
}

console.log("\n── EIN format ──");
{
  const tooShort = validateW2({ employerEin: "12-345" });
  expect("Flags <9-digit EIN", hasFlag(tooShort, "employerEin", "warning"));

  const ok = validateW2({ employerEin: "12-3456789" });
  expect("9-digit EIN is fine", !hasFlag(ok, "employerEin"));

  const noDashes = validateW2({ employerEin: "123456789" });
  expect("9 digits without dashes is fine (digits-only check)", !hasFlag(noDashes, "employerEin"));
}

console.log("\n── Box 5 ≥ Box 1 invariant ──");
{
  // Box 1 reduced by 401(k); Box 5 typically equal or higher
  const ok = validateW2({ wagesBox1: 80000, medicareWagesBox5: 85000 });
  expect("Box 5 > Box 1 is fine", !hasFlag(ok, "medicareWagesBox5"));

  const equal = validateW2({ wagesBox1: 80000, medicareWagesBox5: 80000 });
  expect("Box 5 == Box 1 is fine", !hasFlag(equal, "medicareWagesBox5"));

  const bad = validateW2({ wagesBox1: 80000, medicareWagesBox5: 70000 });
  expect("Box 5 < Box 1 flags", hasFlag(bad, "medicareWagesBox5", "warning"));
}

console.log("\n── Box 3 = Box 5 below SS wage base ──");
{
  // 2024 SS wage base = $168,600. Below cap: Box 3 should equal Box 5.
  const ok = validateW2({ taxYear: 2024, socialSecurityWagesBox3: 80000, medicareWagesBox5: 80000 });
  expect("Box 3 == Box 5 (both below cap) is fine", !hasFlag(ok, "socialSecurityWagesBox3"));

  const offByOneDollar = validateW2({ taxYear: 2024, socialSecurityWagesBox3: 80000, medicareWagesBox5: 80001 });
  expect("Box 3 vs Box 5 off by $1 — tolerated (rounding)", !hasFlag(offByOneDollar, "socialSecurityWagesBox3"));

  const offBy100 = validateW2({ taxYear: 2024, socialSecurityWagesBox3: 79900, medicareWagesBox5: 80000 });
  expect("Box 3 off Box 5 by $100 below cap → warning", hasFlag(offBy100, "socialSecurityWagesBox3", "warning"));
}

console.log("\n── Box 3 capped at SS wage base ──");
{
  // Above cap: Box 5 unlimited, Box 3 capped exactly
  const ok2024 = validateW2({ taxYear: 2024, socialSecurityWagesBox3: 168600, medicareWagesBox5: 200000 });
  expect("Box 3 == 2024 cap when Box 5 > cap is fine", !hasFlag(ok2024, "socialSecurityWagesBox3"));

  // Box 3 over cap is an ERROR
  const overCap = validateW2({ taxYear: 2024, socialSecurityWagesBox3: 200000 });
  expect("Box 3 over 2024 cap flags as error", hasFlag(overCap, "socialSecurityWagesBox3", "error"));

  // Box 5 above cap but Box 3 missing the cap (e.g. shows $150,000 not $168,600)
  const notCappedTo168600 = validateW2({ taxYear: 2024, socialSecurityWagesBox3: 150000, medicareWagesBox5: 200000 });
  expect("Box 3 not capped to 2024 cap when Box 5 > cap flags", hasFlag(notCappedTo168600, "socialSecurityWagesBox3", "warning"));

  // 2025 cap = $176,100
  const ok2025 = validateW2({ taxYear: 2025, socialSecurityWagesBox3: 176100, medicareWagesBox5: 250000 });
  expect("Box 3 == 2025 cap when Box 5 > cap is fine", !hasFlag(ok2025, "socialSecurityWagesBox3"));

  // 2023 cap = $160,200
  const over2023 = validateW2({ taxYear: 2023, socialSecurityWagesBox3: 160300 });
  expect("Box 3 over 2023 cap flags as error", hasFlag(over2023, "socialSecurityWagesBox3", "error"));
}

console.log("\n── Box 4 ≈ Box 3 × 6.2% ──");
{
  // 80000 × 0.062 = 4960
  const exact = validateW2({ socialSecurityWagesBox3: 80000, socialSecurityTaxBox4: 4960 });
  expect("Box 4 = 6.2% × Box 3 exactly → no flag", !hasFlag(exact, "socialSecurityTaxBox4"));

  // Within 0.5% tolerance: 4980 / 80000 = 6.225% — within tolerance
  const within = validateW2({ socialSecurityWagesBox3: 80000, socialSecurityTaxBox4: 4980 });
  expect("Box 4 within 0.5% of 6.2% → no flag", !hasFlag(within, "socialSecurityTaxBox4"));

  // Wildly off: 5500 / 80000 = 6.875% → flag
  const off = validateW2({ socialSecurityWagesBox3: 80000, socialSecurityTaxBox4: 5500 });
  expect("Box 4 wildly off 6.2% → warning", hasFlag(off, "socialSecurityTaxBox4", "warning"));
}

console.log("\n── Box 6 ≈ Box 5 × 1.45% (with Additional Medicare above $200k) ──");
{
  // 80000 × 0.0145 = 1160
  const exact = validateW2({ medicareWagesBox5: 80000, medicareTaxBox6: 1160 });
  expect("Box 6 = 1.45% × Box 5 (under 200k) exactly → no flag", !hasFlag(exact, "medicareTaxBox6"));

  // Above 200k: 250000 wages
  // Standard: min(250000, 200000) × 0.0145 = 200000 × 0.0145 = 2900
  // Additional: max(0, 250000-200000) × (0.0145 + 0.009) = 50000 × 0.0235 = 1175
  // Total expected: 2900 + 1175 = 4075
  const highWage = validateW2({ medicareWagesBox5: 250000, medicareTaxBox6: 4075 });
  expect("Box 6 = 1.45% + 0.9% on excess (>200k) exactly → no flag", !hasFlag(highWage, "medicareTaxBox6"));

  // Wildly off: 80000 wages, 2000 tax (2.5%)
  const off = validateW2({ medicareWagesBox5: 80000, medicareTaxBox6: 2000 });
  expect("Box 6 wildly off 1.45% → warning", hasFlag(off, "medicareTaxBox6", "warning"));
}

console.log("\n── Box 16 ≈ Box 1 invariant ──");
{
  // Same employer paid in one state — Box 16 should match Box 1
  const ok = validateW2({ wagesBox1: 80000, stateWagesBox16: 80000, stateCode: "CA" });
  expect("Box 16 == Box 1 single-state is fine", !hasFlag(ok, "stateWagesBox16"));

  // Off by $50: tolerated (1% of $80k = $800 tolerance, OR $50 minimum)
  // Actually our threshold is max(50, box1*0.01). So $50 over $80k → 0.0625% off → check threshold
  // $80,000 * 0.01 = $800 tolerance. $50 < $800, so within tolerance.
  const small = validateW2({ wagesBox1: 80000, stateWagesBox16: 80050, stateCode: "CA" });
  expect("Box 16 vs Box 1 small diff tolerated", !hasFlag(small, "stateWagesBox16"));

  // Off by $5000 on $80k: well over the 1% threshold ($800), should flag
  const off = validateW2({ wagesBox1: 80000, stateWagesBox16: 75000, stateCode: "CA" });
  expect("Box 16 vs Box 1 large diff flags as info", hasFlag(off, "stateWagesBox16", "info"));
}

console.log("\n── State withholding plausibility ──");
{
  // California maxes ~13.3% — anything well above that is a flag
  const ok = validateW2({ stateWagesBox16: 80000, stateTaxWithheldBox17: 5000 });
  expect("6.25% state withholding is plausible — no flag", !hasFlag(ok, "stateTaxWithheldBox17"));

  // 20% state withholding — impossible for any US state
  const tooHigh = validateW2({ stateWagesBox16: 80000, stateTaxWithheldBox17: 16000 });
  expect("20% state withholding flags as warning", hasFlag(tooHigh, "stateTaxWithheldBox17", "warning"));
}

console.log("\n── Federal withholding plausibility ──");
{
  // 15% federal withholding is normal
  const ok = validateW2({ wagesBox1: 80000, federalTaxWithheldBox2: 12000 });
  expect("15% federal withholding fine", !hasFlag(ok, "federalTaxWithheldBox2"));

  // 60% withholding is implausible (warning)
  const tooHigh = validateW2({ wagesBox1: 80000, federalTaxWithheldBox2: 48000 });
  expect("60% federal withholding flags as warning", hasFlag(tooHigh, "federalTaxWithheldBox2", "warning"));

  // 1% withholding on $50k is unusually low (info)
  const tooLow = validateW2({ wagesBox1: 50000, federalTaxWithheldBox2: 500 });
  expect("1% federal withholding on $50k flags as info", hasFlag(tooLow, "federalTaxWithheldBox2", "info"));

  // Same 1% withholding on $20k is below the $30k threshold for the "low" check
  const smallWage = validateW2({ wagesBox1: 20000, federalTaxWithheldBox2: 200 });
  expect("1% withholding below $30k wage threshold doesn't trigger low-flag", !hasFlag(smallWage, "federalTaxWithheldBox2"));
}

console.log("\n── Realistic full W-2 hand-calc ──");
{
  // CPA-realistic W-2: $90,000 wages, $5,000 401(k) pre-tax
  //   Box 1 = $90,000 - $5,000 = $85,000
  //   Box 3 = Box 5 = $90,000  (401(k) doesn't reduce SS/Medicare wages)
  //   Box 4 = $90,000 × 6.2% = $5,580
  //   Box 6 = $90,000 × 1.45% = $1,305
  //   Box 16 = $85,000 (matches Box 1; CA)
  //   Box 17 ≈ 6% effective state rate = $5,100
  const realistic = validateW2(
    {
      taxYear: 2024,
      wagesBox1: 85000,
      socialSecurityWagesBox3: 90000,
      socialSecurityTaxBox4: 5580,
      medicareWagesBox5: 90000,
      medicareTaxBox6: 1305,
      stateWagesBox16: 85000,
      stateTaxWithheldBox17: 5100,
      federalTaxWithheldBox2: 13000,
      stateCode: "CA",
    },
    { clientTaxYear: 2024, clientState: "CA" },
  );
  expect("Realistic 401(k)-W-2 → zero flags", realistic.length === 0, `got ${realistic.length} flags: ${realistic.map((f) => f.message).join(" | ")}`);
}

// ── Summary ──
console.log(`\n${PASS.length} passed`);
if (FAIL.length) {
  console.error(`${FAIL.length} failed:`);
  for (const f of FAIL) console.error(`  ${f}`);
  process.exit(1);
}
