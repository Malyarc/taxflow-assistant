/**
 * T2.1 — Workpaper builder tests: detail forms 8995 / 4562 / 8582 / 4952
 * (group "detail-forms-a"). Pure — no API, no DB.
 *
 * Headline dollars are HAND-CALC'D (§469(i) $25k allowance phase-out, §163(d)
 * NII cap, §179 income limit); builder-faithful identity rows compare to the
 * engine field by design.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-detail-forms-a-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildForm8995 } from "../../artifacts/api-server/src/lib/forms/form8995Spec";
import { buildForm4562 } from "../../artifacts/api-server/src/lib/forms/form4562Spec";
import { buildForm8582 } from "../../artifacts/api-server/src/lib/forms/form8582Spec";
import { buildForm4952 } from "../../artifacts/api-server/src/lib/forms/form4952Spec";
import type {
  FormBuildContext,
  FormInstance,
  FormLine,
  WorkpaperTaxpayer,
} from "../../artifacts/api-server/src/lib/forms/formSpec";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.02): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

const allLines = (inst: FormInstance): FormLine[] => inst.parts.flatMap((p) => p.lines);
const findByLabel = (inst: FormInstance, frag: string): FormLine | undefined =>
  allLines(inst).find((l) => l.label.includes(frag));
const num = (l: FormLine | undefined): number =>
  l != null && typeof l.value === "number" ? l.value : NaN;

function assertTies(label: string, inst: FormInstance): void {
  const checks = allLines(inst).filter(
    (l) => typeof l.value === "string" && (l.value === "ties" || l.value.startsWith("off by")),
  );
  const offs = checks.filter((l) => l.value !== "ties");
  if (checks.length === 0) FAIL.push(`✗ ${label}: expected a tie-out row, found none`);
  else if (offs.length === 0) PASS.push(`✓ ${label}: all ${checks.length} tie-out rows tie`);
  else FAIL.push(`✗ ${label}: ${offs.length} off — ${offs.map((l) => l.label).join("; ")}`);
}
function assertNoNaN(label: string, inst: FormInstance): void {
  const bad = allLines(inst).filter(
    (l) => l.kind === "money" && l.value != null && (typeof l.value !== "number" || !Number.isFinite(l.value)),
  );
  if (bad.length === 0) PASS.push(`✓ ${label}: no NaN money lines`);
  else FAIL.push(`✗ ${label}: ${bad.length} bad money line(s)`);
}

function ctxFor(inputs: TaxReturnInputs): { ctx: FormBuildContext; ret: ReturnType<typeof computeTaxReturnPure> } {
  const ret = computeTaxReturnPure(inputs);
  const taxpayer: WorkpaperTaxpayer = {
    firstName: "Test", lastName: "Client",
    filingStatus: inputs.client.filingStatus, state: inputs.client.state ?? "FL",
  };
  return { ctx: { taxpayer, ret, inputs }, ret };
}

// ════════════════════════════════════════════════════════════════════════════
// S1 — Form 8995 (QBI): SE $100k sole prop (TY2024).
//   QBI deduction = 20% × (net SE − attributable ½-SE), bound by 20% of
//   (taxable − net cap gain). Builder line 39 must equal ret.qbiDeduction.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 100000 }],
    adjustments: [],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  const f = buildForm8995(ctx);
  checkTrue("S1 Form 8995 applicable (QBI > 0)", f !== null);
  if (f) {
    assertTies("S1 Form 8995", f);
    assertNoNaN("S1 Form 8995", f);
    const total = findByLabel(f, "Total QBI deduction") ?? findByLabel(f, "QBI deduction");
    check("S1 total QBI deduction == engine qbiDeduction", num(total), ret.qbiDeduction);
    checkTrue("S1 engine QBI > 0", ret.qbiDeduction > 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — Form 4562 (depreciation): §179 $20k on $100k SE (TY2024).
//   §179 income-limited to net SE income (≫ $20k) → fully applied $20,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 100000 }],
    adjustments: [{ adjustmentType: "section_179_expense_election", amount: 20000, isApplied: true }],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S2 engine §179 applied $20,000", ret.section179Applied, 20000);
  const f = buildForm4562(ctx);
  checkTrue("S2 Form 4562 applicable (§179 > 0)", f !== null);
  if (f) {
    assertNoNaN("S2 Form 4562", f);
    const l12 = findByLabel(f, "§179");
    checkTrue("S2 Form 4562 has a §179 line", l12 !== undefined);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — Form 8582 (PAL): two rentals, net passive loss, AGI $120k (TY2024).
//   §469(i) special allowance = 25,000 − 50% × (120,000 − 100,000) = $15,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 120000, federalTaxWithheldBox2: 15000 }],
    form1099s: [],
    rentalProperties: [
      { taxYear: 2024, address: "1 Maple St", propertyType: "residential", basis: 200000, placedInServiceYear: 2020, isActiveParticipant: true, rentalIncome: 20000, totalExpenses: 8000 },
      { taxYear: 2024, address: "2 Oak Ave", propertyType: "residential", basis: 300000, placedInServiceYear: 2021, isActiveParticipant: true, rentalIncome: 10000, totalExpenses: 32000 },
    ] as unknown as TaxReturnInputs["rentalProperties"],
    adjustments: [],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  checkTrue("S3 engine form8582 present", ret.form8582 != null);
  const f = buildForm8582(ctx);
  checkTrue("S3 Form 8582 applicable", f !== null);
  if (f) {
    assertTies("S3 Form 8582", f);
    assertNoNaN("S3 Form 8582", f);
    check("S3 line 9 special-allowance cap $25,000", num(findByLabel(f, "Maximum special allowance")), 25000);
    check("S3 line 10 allowance after phase-out $15,000 (hand-calc)", num(findByLabel(f, "Special allowance after MAGI phase-out")), 15000);
    check("S3 combined allowed == engine totalAllowed", num(findByLabel(f, "Combined allowed")), ret.form8582!.totalAllowed);
    // Per-activity rows present (2 rentals).
    const activityRows = allLines(f).filter((l) => l.label.includes("Maple") || l.label.includes("Oak"));
    checkTrue("S3 both rental activities rendered", activityRows.length === 2);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — Form 4952 (investment interest): $10k expense, $6k NII (TY2024).
//   §163(d) caps the deduction at net investment income:
//     allowed = min(10,000, 6,000) = $6,000;  disallowed carryforward = $4,000.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, federalTaxWithheldBox2: 12000 }],
    form1099s: [{ taxYear: 2024, formType: "int", interestIncome: 6000 }],
    adjustments: [{ adjustmentType: "investment_interest_expense", amount: 10000, isApplied: true }],
    taxYear: 2024,
  };
  const { ctx, ret } = ctxFor(inputs);
  check("S4 engine investment interest deduction $6,000", ret.investmentInterestDeduction, 6000);
  check("S4 engine investment interest disallowed $4,000", ret.investmentInterestDisallowed, 4000);
  const f = buildForm4952(ctx);
  checkTrue("S4 Form 4952 applicable", f !== null);
  if (f) {
    assertTies("S4 Form 4952", f);
    assertNoNaN("S4 Form 4952", f);
    check("S4 line 1 total investment interest $10,000", num(findByLabel(f, "Investment interest expense paid")), 10000);
    check("S4 line 8 deduction $6,000", num(findByLabel(f, "Investment interest expense deduction")), 6000);
    check("S4 line 7 carryforward $4,000", num(findByLabel(f, "carryforward to next year")), 4000);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — Null gates: bare W-2 single → no QBI / §179 / PAL / investment interest.
// ════════════════════════════════════════════════════════════════════════════
{
  const inputs: TaxReturnInputs = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 60000, federalTaxWithheldBox2: 6000 }],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
  };
  const { ctx } = ctxFor(inputs);
  checkTrue("S5 Form 8995 null (no QBI)", buildForm8995(ctx) === null);
  checkTrue("S5 Form 4562 null (no depreciation)", buildForm4562(ctx) === null);
  checkTrue("S5 Form 8582 null (no rental PAL)", buildForm8582(ctx) === null);
  checkTrue("S5 Form 4952 null (no investment interest)", buildForm4952(ctx) === null);
}

console.log(`\nT2.1 workpaper — detail forms 8995/4562/8582/4952 (detail-forms-a):`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.error(`  ${f}`); process.exit(1); }
for (const p of PASS) console.log(`  ${p}`);
process.exit(0);
