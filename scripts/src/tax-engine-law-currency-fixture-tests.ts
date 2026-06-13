/**
 * T1.5 #8 — Law-watch: DOR/IRS-pinned fixture tests.
 *
 * The year-coverage suite only checks that year-indexed values are FINITE and
 * monotonic — the 2026-06-08/11 audits proved that misses real RATE CHANGES (a
 * stale CO/WI/ID/SC/OH/NE/KY rate stayed "finite" while being wrong). This suite
 * pins the EXACT published value of every high-impact federal + state parameter
 * to its primary source, so a stale or fat-fingered rate fails the build loudly.
 *
 * Every literal is the DOR/IRS primary-source value (the audit-verified figure).
 * Update a literal here ONLY together with the engine, and cite the source in
 * docs/accuracy/law-watch.md. Companion: the quarterly sweep runbook +
 * pending-effective-date register in docs/accuracy/law-watch.md.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-law-currency-fixture-tests.ts
 */
import {
  getFederalStandardDeduction,
  getSaltCap,
  SS_WAGE_BASE,
  calculateFederalTax,
} from "../../artifacts/api-server/src/lib/taxCalculator";
import { STATE_TAX_DATA_BY_YEAR } from "../../artifacts/api-server/src/lib/stateTaxData";

const PASS: string[] = [];
const FAIL: string[] = [];
function eq(label: string, actual: number, expected: number, tol = 0.0): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
/** Top (flat) marginal rate of a state's single-column brackets in a given year. */
function topRate(year: 2024 | 2025 | 2026, st: string): number {
  const b = STATE_TAX_DATA_BY_YEAR[year]?.[st]?.brackets?.single;
  if (!b || b.length === 0) return NaN;
  return b[b.length - 1].rate;
}

// ════════════════════════════════════════════════════════════════════════════
// FEDERAL — standard deduction (IRS Rev. Proc. / OBBBA). EXACT published values.
// ════════════════════════════════════════════════════════════════════════════
eq("Fed std ded 2024 single $14,600", getFederalStandardDeduction("single", 2024), 14600);
eq("Fed std ded 2024 MFJ $29,200", getFederalStandardDeduction("married_filing_jointly", 2024), 29200);
eq("Fed std ded 2024 HoH $21,900", getFederalStandardDeduction("head_of_household", 2024), 21900);
eq("Fed std ded 2024 MFS $14,600", getFederalStandardDeduction("married_filing_separately", 2024), 14600);
eq("Fed std ded 2024 QSS $29,200", getFederalStandardDeduction("qualifying_widow", 2024), 29200);
// OBBBA TY2025 (the corrected $15,750 / $31,500 / $23,625).
eq("Fed std ded 2025 single $15,750 (OBBBA)", getFederalStandardDeduction("single", 2025), 15750);
eq("Fed std ded 2025 MFJ $31,500 (OBBBA)", getFederalStandardDeduction("married_filing_jointly", 2025), 31500);
eq("Fed std ded 2025 HoH $23,625 (OBBBA)", getFederalStandardDeduction("head_of_household", 2025), 23625);
eq("Fed std ded 2026 single $16,100", getFederalStandardDeduction("single", 2026), 16100);
eq("Fed std ded 2026 MFJ $32,200", getFederalStandardDeduction("married_filing_jointly", 2026), 32200);

// ════════════════════════════════════════════════════════════════════════════
// FEDERAL — SALT cap (§164(b)(6)/(7); TCJA $10k → OBBBA $40k). Low-MAGI (no phase-down).
// ════════════════════════════════════════════════════════════════════════════
eq("SALT cap 2024 single $10,000 (TCJA)", getSaltCap(2024, "single", 100000), 10000);
eq("SALT cap 2024 MFS $5,000", getSaltCap(2024, "married_filing_separately", 100000), 5000);
eq("SALT cap 2025 single $40,000 (OBBBA)", getSaltCap(2025, "single", 100000), 40000);
eq("SALT cap 2025 MFS $20,000 (OBBBA half)", getSaltCap(2025, "married_filing_separately", 100000), 20000);

// ════════════════════════════════════════════════════════════════════════════
// FEDERAL — SS wage base + the line-16 schedule (pins the brackets).
// ════════════════════════════════════════════════════════════════════════════
eq("SS wage base 2024 $168,600", SS_WAGE_BASE[2024], 168600);
eq("SS wage base 2025 $176,100", SS_WAGE_BASE[2025], 176100);
eq("SS wage base 2026 $184,500", SS_WAGE_BASE[2026], 184500);
// 2024 single tax on $100k taxable = 1,160 + 12%×35,550 + 22%×52,850 = $17,053.
eq("Fed tax 2024 single $100k taxable = $17,053 (pins brackets)", calculateFederalTax(100000, "single", 2024), 17053);
// 2024 MFJ tax on $100k taxable = 2,320 + 12%×(94,300−23,200) + 22%×(100,000−94,300)
//   = 2,320 + 8,532 + 1,254 = $12,106.
eq("Fed tax 2024 MFJ $100k taxable = $12,106 (pins brackets)", calculateFederalTax(100000, "married_filing_jointly", 2024), 12106);

// ════════════════════════════════════════════════════════════════════════════
// STATE — flat-rate states the 2026-06-08/11 audits corrected. DOR-verified.
//   Pinning the exact rate catches a stale rate that "year-coverage" would pass.
// ════════════════════════════════════════════════════════════════════════════
eq("CO 2024 flat 4.25% (TABOR)", topRate(2024, "CO"), 0.0425);
eq("CO 2025 flat 4.40% (audit 4.25% claim REFUTED vs DR 0104)", topRate(2025, "CO"), 0.0440);
eq("ID 2024 flat 5.695%", topRate(2024, "ID"), 0.05695);
eq("ID 2025 flat 5.30%", topRate(2025, "ID"), 0.053);
eq("KY 2025 flat 4.0%", topRate(2025, "KY"), 0.040);
eq("AZ flat 2.5% (2024)", topRate(2024, "AZ"), 0.025);
eq("OH 2025 top 3.125%", topRate(2025, "OH"), 0.03125);
eq("OH 2026 flat 2.75%", topRate(2026, "OH"), 0.0275);
eq("NE 2025 top 5.20%", topRate(2025, "NE"), 0.052);
eq("SC 2024 top 6.2%", topRate(2024, "SC"), 0.062);
eq("SC 2025 top 6.0%", topRate(2025, "SC"), 0.060);
eq("WI 2024 top 7.65%", topRate(2024, "WI"), 0.0765);
// Federal-conforming + no-income-tax sentinels (a structural pin).
eq("FL has no income tax → undefined brackets", STATE_TAX_DATA_BY_YEAR[2024].FL?.brackets ? 1 : 0, 0);

console.log(`\nT1.5 #8 — Law-watch DOR/IRS-pinned fixtures (federal std-ded/SALT/SS/brackets + audit-fixed state rates):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
