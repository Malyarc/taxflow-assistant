/**
 * T2.1 workpaper tests — Schedule E + Schedule H substitute-form builders
 * (group "schedule-e-h").
 *
 * Verifies buildScheduleE / buildScheduleHForm FormInstance line values against
 * HAND-CALC'D expectations (IRS Schedule E / Form 8582 / §469(i)/(g); IRS
 * Schedule H / Pub 926), plus identity ties to the engine fields, applicability
 * gates, and additive structure. Pure — no API needed.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-schedule-e-h-tests.ts
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildScheduleE } from "../../artifacts/api-server/src/lib/forms/scheduleESpec";
import { buildScheduleHForm } from "../../artifacts/api-server/src/lib/forms/scheduleHSpec";
import type {
  FormBuildContext,
  FormInstance,
  FormLine,
  WorkpaperTaxpayer,
} from "../../artifacts/api-server/src/lib/forms/formSpec";

const PASS: string[] = [];
const FAIL: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.02): void {
  if (Math.abs(actual - expected) <= tol) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${expected}, got ${actual}`);
}
function checkStr(label: string, actual: string | null | undefined, expectedFrag: string): void {
  if ((actual ?? "").includes(expectedFrag)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected to include "${expectedFrag}", got "${actual}"`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

const allLines = (inst: FormInstance): FormLine[] => inst.parts.flatMap((p) => p.lines);
const findLine = (inst: FormInstance, line: string, frag?: string): FormLine | undefined =>
  allLines(inst).find((l) => l.line === line && (!frag || l.label.includes(frag)));
const findLines = (inst: FormInstance, line: string): FormLine[] =>
  allLines(inst).filter((l) => l.line === line);
const findByLabel = (inst: FormInstance, frag: string): FormLine | undefined =>
  allLines(inst).find((l) => l.label.includes(frag));
/** checkLine() rows render "✓ <label>" with value "ties" when the tie holds. */
function checkTie(testLabel: string, inst: FormInstance, frag: string): void {
  const l = allLines(inst).find((x) => x.kind === "text" && x.label.includes(frag));
  if (!l) FAIL.push(`✗ ${testLabel}: tie row "${frag}" not found`);
  else if (String(l.value) === "ties") PASS.push(`✓ ${testLabel}`);
  else FAIL.push(`✗ ${testLabel}: ${l.label} → ${String(l.value)}`);
}
const num = (l: FormLine | undefined): number => Number(l?.value ?? NaN);

const taxpayer: WorkpaperTaxpayer = {
  firstName: "Test",
  lastName: "Client",
  filingStatus: "single",
  state: "FL",
};

function makeInputs(over: Partial<TaxReturnInputs> & { wages?: number; state?: string }): TaxReturnInputs {
  const { wages, state, ...rest } = over;
  return {
    client: { filingStatus: "single", state: state ?? "FL", taxpayerAge: 45, rentalActiveParticipant: true },
    w2s:
      wages != null
        ? [{ taxYear: 2024, wagesBox1: wages, socialSecurityWagesBox3: wages, medicareWagesBox5: wages, stateCode: state ?? "FL" }]
        : [],
    form1099s: [],
    adjustments: [],
    taxYear: 2024,
    ...rest,
  };
}
function ctxFor(inputs: TaxReturnInputs): { ctx: FormBuildContext; ret: ReturnType<typeof computeTaxReturnPure> } {
  const ret = computeTaxReturnPure(inputs);
  return { ctx: { taxpayer, ret, inputs }, ret };
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario E1 — two rentals (one profit, one loss) + a zero-net MACRS property,
// §469(i) $25k special allowance BINDING. TY2024, single, FL, W-2 $120,000.
//
// Hand-calc (IRC §469(i) + Form 8582; Pub 946 Table A-6 SL 27.5-yr):
//   Property A: rents 30,000 − expenses 8,000            = +22,000 (no MACRS)
//   Property B: rents  5,000 − expenses 45,000           = −40,000
//   Property C: rents 22,000 − expenses 12,000 − MACRS 10,000 = 0
//     MACRS C = basis 275,000 / 27.5 = 10,000 exactly (placed in service
//     2015-06 → full-year SL rate for TY2024, residential rental).
//   Combined net = 22,000 − 40,000 + 0 = −18,000 (a net passive loss).
//   §469(i): MAGI = wages 120,000 (no other income) →
//     allowance = 25,000 − 0.5 × (120,000 − 100,000) = 15,000.
//   Allowed = min(18,000, 15,000) = 15,000; suspended = 3,000.
//   Form 8582 Wks 5 (ratable over loss activities — B is the only loss):
//     B allowed = −40,000 + 3,000 = −37,000; B suspended = 3,000.
//   AGI = 120,000 − 15,000 = 105,000.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    wages: 120000,
    rentalProperties: [
      { taxYear: 2024, address: "12 Oak Ave, Tampa FL", rentalIncome: 30000, totalExpenses: 8000 },
      { taxYear: 2024, address: "44 Pine St, Orlando FL", rentalIncome: 5000, totalExpenses: 45000 },
      {
        taxYear: 2024,
        address: "9 Elm Ct, Miami FL",
        propertyType: "residential",
        basis: 275000,
        placedInServiceYear: 2015,
        placedInServiceMonth: 6,
        rentalIncome: 22000,
        totalExpenses: 12000,
      },
    ],
  });
  const { ctx, ret } = ctxFor(inputs);
  const inst = buildScheduleE(ctx);
  checkTrue("E1 Schedule E builder returns an instance", inst != null);
  if (inst) {
    checkStr("E1 formId", inst.formId, "schedule-e");
    check("E1 taxYear", inst.taxYear, 2024);
    const rents = findLines(inst, "3");
    check("E1 three per-property rent rows", rents.length, 3);
    check("E1 Property A rents (line 3)", num(rents[0]), 30000);
    check("E1 Property B rents (line 3)", num(rents[1]), 5000);
    check("E1 Property C rents (line 3)", num(rents[2]), 22000);
    // Hand-calc: C MACRS = 275,000 / 27.5 = 10,000 (Pub 946 SL 27.5-yr, full year).
    check("E1 Property C depreciation (line 18) = 275,000/27.5", num(findLine(inst, "18")), 10000);
    const line20s = findLines(inst, "20");
    check("E1 Property C total expenses (line 20) = 12,000 + 10,000", num(line20s[2]), 22000);
    const nets = findLines(inst, "21");
    check("E1 Property A net (line 21)", num(nets[0]), 22000);
    check("E1 Property B net (line 21)", num(nets[1]), -40000);
    check("E1 Property C net (line 21) = 22,000 − 12,000 − 10,000", num(nets[2]), 0);
    // Hand-calc: B deductible loss after Form 8582 = −40,000 + 3,000 = −37,000.
    check("E1 Property B deductible loss after limitation (line 22)", num(findLine(inst, "22")), -37000);
    check("E1 Wks-5 suspended share on B", num(findByLabel(inst, "Worksheet 5 ratable share")), 3000);
    check("E1 combined pre-§469 net = −18,000", num(findByLabel(inst, "Combined net rental")), -18000);
    // Hand-calc §469(i): 25,000 − 0.5×20,000 = 15,000 allowed; −15,000 to AGI.
    check("E1 line 26 post-§469 applied = −15,000", num(findLine(inst, "26")), -15000);
    checkTie("E1 per-property nets tie to engine combined net", inst, "Per-property nets");
    checkTie("E1 post-§469 applied ties to engine identity", inst, "Post-§469 rental applied");
    check("E1 §469(i) statutory cap", num(findByLabel(inst, "Special allowance cap")), 25000);
    check("E1 allowance after MAGI phase-out = 25,000 − 0.5×(120,000−100,000)", num(findByLabel(inst, "Allowance after the 50%")), 15000);
    check("E1 loss allowed this year", num(findByLabel(inst, "Loss ALLOWED this year")), 15000);
    check("E1 loss suspended to next year", num(findByLabel(inst, "Loss SUSPENDED to next year")), 3000);
    check("E1 PAL MAGI row = provisional AGI 120,000", num(findByLabel(inst, "Modified AGI used")), 120000);
    checkTie("E1 allowed + suspended = loss subject to §469", inst, "Allowed + suspended");
    checkTie("E1 suspended ties to engine carryforward", inst, "Suspended ties to the engine");
  }
  // Engine anchors (hand-calc'd, pin the workpaper's source values).
  check("E1 engine AGI = 120,000 − 15,000", ret.adjustedGrossIncome, 105000);
  check("E1 engine suspended passive loss", ret.scheduleEPassiveLossSuspended, 3000);
  check("E1 engine rental applied to AGI", ret.scheduleERentalAppliedToAgi, -15000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario E2 — §469(g) full disposition. TY2024, single, FL, W-2 $100,000.
//
// Hand-calc (IRC §469(g)(1)(A)): a fully-taxable disposition of the entire
// interest releases the activity's suspended passive losses — freely
// deductible, no $25k cap. Disposed property: rents 6,000 − expenses 11,000 =
// −5,000 current-year net; suspended carryforward released = 10,000.
//   AGI = 100,000 + (−5,000 − 10,000) = 85,000.
//   Active-property aggregate = 0 → no PAL limitation runs.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    wages: 100000,
    rentalProperties: [
      {
        taxYear: 2024,
        address: "77 Birch Ln, Naples FL",
        rentalIncome: 6000,
        totalExpenses: 11000,
        fullyDisposedThisYear: true,
        suspendedLossCarryforward: 10000,
      },
    ],
  });
  const { ctx, ret } = ctxFor(inputs);
  const inst = buildScheduleE(ctx);
  checkTrue("E2 builder returns an instance (disposed-only property)", inst != null);
  if (inst) {
    checkStr("E2 disposed property flagged §469(g)", findLines(inst, "1a")[0]?.note ?? "", "FULLY DISPOSED");
    check("E2 disposed current-year net (line 21) = 6,000 − 11,000", num(findLine(inst, "21")), -5000);
    check("E2 §469(g) release row = −10,000 (deduction)", num(findByLabel(inst, "§469(g) released suspended passive loss")), -10000);
    checkStr(
      "E2 release row carries the freely-deductible note",
      findByLabel(inst, "§469(g) released suspended passive loss")?.note ?? "",
      "Freely deductible",
    );
    checkTie("E2 released losses tie to per-property carryforward inputs", inst, "Released suspended losses tie");
    check("E2 disposed-property net row", num(findByLabel(inst, "Disposed-property current-year net")), -5000);
    check("E2 total Schedule E rental to AGI = 0 − 5,000 − 10,000", num(findByLabel(inst, "Total Schedule E rental flowing to AGI")), -15000);
    checkTrue("E2 no §469(i) allowance part (no active-property loss)", findByLabel(inst, "Special allowance cap") == null);
  }
  check("E2 engine AGI = 100,000 − 15,000", ret.adjustedGrossIncome, 85000);
  check("E2 engine §469(g) released loss", ret.section469gReleasedLoss, 10000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario E3 — K-1s: active partnership (Box 1 + §707(c) GP + portfolio
// interest + Box 14A) and a passive S-corp loss. TY2024, single, TX, no W-2.
//
// Hand-calc (Schedule E page 2 + Schedule SE):
//   Alpha Partners LP (active 1065): Box 1 80,000; Box 4 GP 20,000;
//     Box 5 interest 1,500; Box 14A 100,000 (= Box 1 + GP, as a real K-1
//     reports for a general partner).
//   Beta Corp (passive 1120-S): Box 1 −12,000 → §469 passive, NO allowance
//     → fully suspended (12,000); applied to AGI = 0.
//   Page-2 line 32 = 80,000 + 20,000 + 0 = 100,000.
//   SE tax = 100,000 × 0.9235 × 15.3% = 14,129.55 (under the 168,600 base);
//     half-SE = 7,064.78.
//   AGI = 80,000 + 20,000 + 1,500 − 7,064.78 = 94,435.22.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    state: "TX",
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "Alpha Partners LP",
        entityType: "partnership",
        activityType: "active",
        box1OrdinaryIncome: 80000,
        box4GuaranteedPayments: 20000,
        interestIncome: 1500,
        selfEmploymentEarnings: 100000,
      },
      {
        taxYear: 2024,
        entityName: "Beta Corp",
        entityType: "s_corp",
        activityType: "passive",
        box1OrdinaryIncome: -12000,
      },
    ],
  });
  const { ctx, ret } = ctxFor(inputs);
  const inst = buildScheduleE(ctx);
  checkTrue("E3 builder returns an instance (K-1s only)", inst != null);
  if (inst) {
    checkTrue(
      "E3 no rental Part I (no rental activity)",
      !inst.parts.some((p) => (p.title ?? "").includes("Rental Real Estate")),
    );
    check("E3 K-1 count (line 28)", num(findLine(inst, "28")), 2);
    checkStr("E3 count note shows entity split", findLine(inst, "28")?.note ?? "", "1 partnership");
    check("E3 nonpassive active ordinary (28(i)/(k))", num(findLine(inst, "28(i)/(k)")), 80000);
    check("E3 guaranteed payments §707(c) (28(k))", num(findLine(inst, "28(k)", "Guaranteed")), 20000);
    checkTrue("E3 passive-applied row omitted at $0", findLine(inst, "28(h)") == null);
    // Hand-calc: line 32 = 80,000 + 20,000 + 0 = 100,000.
    check("E3 line 32 total pass-through", num(findLine(inst, "32")), 100000);
    // Additive structure: line 32 equals the sum of its rendered component rows.
    const componentSum = num(findLine(inst, "28(i)/(k)")) + num(findLine(inst, "28(k)", "Guaranteed"));
    check("E3 line 32 = sum of rendered Part II component rows", num(findLine(inst, "32")), componentSum);
    check("E3 K-1 passive loss suspended row", num(findByLabel(inst, "K-1 passive loss suspended")), 12000);
    check("E3 portfolio interest row (→ Sch B)", num(findByLabel(inst, "Interest income (Box 5)")), 1500);
    check("E3 SE earnings row (→ Sch SE)", num(findByLabel(inst, "Self-employment earnings")), 100000);
  }
  check("E3 engine SE tax = 100,000 × 0.9235 × 15.3%", ret.selfEmploymentTax, 14129.55, 0.5);
  check("E3 engine AGI = 101,500 − half-SE", ret.adjustedGrossIncome, 94435.22, 0.05);
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario E4 — §704(d) basis-limited active K-1 loss. TY2024, single, TX,
// W-2 $80,000.
//
// Hand-calc (IRC §704(d)): Box 1 loss −30,000, outside basis 10,000 →
// allowed −10,000; suspended 20,000. AGI = 80,000 − 10,000 = 70,000.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    state: "TX",
    wages: 80000,
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "Gamma Holdings LP",
        entityType: "partnership",
        activityType: "active",
        box1OrdinaryIncome: -30000,
        basisAtYearStart: 10000,
      },
    ],
  });
  const { ctx, ret } = ctxFor(inputs);
  const inst = buildScheduleE(ctx);
  checkTrue("E4 builder returns an instance", inst != null);
  if (inst) {
    check("E4 active ordinary loss capped at basis", num(findLine(inst, "28(i)/(k)")), -10000);
    check("E4 line 32", num(findLine(inst, "32")), -10000);
    check("E4 basis/at-risk suspended row", num(findByLabel(inst, "basis / at-risk limits")), 20000);
  }
  check("E4 engine AGI = 80,000 − 10,000", ret.adjustedGrossIncome, 70000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario E5 — legacy AGGREGATE rental adjustments (no per-property rows).
// TY2024, single, FL, W-2 $50,000; rental income 20,000 / expenses 5,000.
//
// Hand-calc: net = +15,000 (income → no §469 limit) → AGI = 65,000.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    wages: 50000,
    adjustments: [
      { adjustmentType: "schedule_e_rental_income", amount: 20000 },
      { adjustmentType: "schedule_e_rental_expenses", amount: 5000 },
    ],
  });
  const { ctx, ret } = ctxFor(inputs);
  const inst = buildScheduleE(ctx);
  checkTrue("E5 builder returns an instance (aggregate path)", inst != null);
  if (inst) {
    check("E5 aggregate rents (line 3)", num(findLine(inst, "3")), 20000);
    check("E5 aggregate total expenses (line 20)", num(findLine(inst, "20")), 5000);
    check("E5 aggregate net (line 21) = 20,000 − 5,000", num(findLine(inst, "21")), 15000);
    check("E5 combined pre-§469 net", num(findByLabel(inst, "Combined net rental")), 15000);
    check("E5 line 26 applied (income — no PAL limit)", num(findLine(inst, "26")), 15000);
    checkTie("E5 post-§469 applied ties", inst, "Post-§469 rental applied");
    checkTrue(
      "E5 aggregate-modeled sub-gap footnote present",
      (inst.footnotes ?? []).some((f) => f.includes("aggregate-modeled")),
    );
    checkTrue("E5 no §469(i) allowance part (net income)", findByLabel(inst, "Special allowance cap") == null);
  }
  check("E5 engine AGI = 50,000 + 15,000", ret.adjustedGrossIncome, 65000);
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario H1 — Schedule H: nanny $30,000 cash wages + $7,000 FUTA-wage
// override. TY2024, single, FL, W-2 $40,000.
//
// Hand-calc (IRS Schedule H 2024 / Pub 926):
//   FICA applies (30,000 ≥ 2,700):
//     line 1 SS wages 30,000 → line 2 = 30,000 × 12.4% = 3,720.00
//     line 3 Medicare wages 30,000 → line 4 = 30,000 × 2.9% = 870.00
//     no Additional Medicare (≤ 200,000); line 8 = 3,720 + 870 = 4,590.00
//   FUTA: line 15 = 7,000 → line 16 = 7,000 × 0.6% = 42.00
//   Line 26 total = 4,590 + 42 = 4,632.00 (the SCH1 anchor) → Schedule 2 line 9.
// ═══════════════════════════════════════════════════════════════════════════
{
  const base = ctxFor(makeInputs({ wages: 40000 }));
  const inputs = makeInputs({
    wages: 40000,
    adjustments: [
      { adjustmentType: "household_employee_cash_wages", amount: 30000 },
      { adjustmentType: "household_employee_futa_wages", amount: 7000 },
    ],
  });
  const { ctx, ret } = ctxFor(inputs);
  const inst = buildScheduleHForm(ctx);
  checkTrue("H1 Schedule H builder returns an instance", inst != null);
  if (inst) {
    checkStr("H1 formId", inst.formId, "schedule-h");
    check("H1 cash-wages context row", num(findByLabel(inst, "Total cash wages paid")), 30000);
    checkTrue("H1 question A (FICA threshold met) = true", findLine(inst, "A")?.value === true);
    check("H1 line 1 SS wages", num(findLine(inst, "1")), 30000);
    check("H1 line 2 SS tax = 30,000 × 12.4%", num(findLine(inst, "2")), 3720);
    check("H1 line 3 Medicare wages", num(findLine(inst, "3")), 30000);
    check("H1 line 4 Medicare tax = 30,000 × 2.9%", num(findLine(inst, "4")), 870);
    checkTrue("H1 lines 5/6 omitted (no wages over $200k)", findLine(inst, "5") == null && findLine(inst, "6") == null);
    const line7 = findLine(inst, "7");
    checkTrue("H1 line 7 rendered as not-modeled placeholder", line7 != null && line7.value === null);
    checkStr("H1 line 7 carries the CPA-supplies note", line7?.note ?? "", "not modeled");
    check("H1 line 8 = 3,720 + 870", num(findLine(inst, "8")), 4590);
    checkTrue("H1 line 9 FUTA quarter question = true", findLine(inst, "9")?.value === true);
    check("H1 line 15 FUTA wages (override)", num(findLine(inst, "15")), 7000);
    checkStr("H1 line 15 notes the CPA override", findLine(inst, "15")?.note ?? "", "override");
    check("H1 line 16 FUTA tax = 7,000 × 0.6%", num(findLine(inst, "16")), 42);
    checkTie("H1 FUTA rate tie", inst, "FUTA tax = FUTA wages");
    check("H1 line 25 = line 8", num(findLine(inst, "25")), 4590);
    check("H1 line 26 total = 4,590 + 42", num(findLine(inst, "26")), 4632);
    check("H1 line 26 additive = line 8 + line 16", num(findLine(inst, "26")), num(findLine(inst, "8")) + num(findLine(inst, "16")));
    checkTie("H1 line 26 ties to engine Schedule H total", inst, "Line 26 ties");
    checkStr("H1 line 26 flows-to note", findLine(inst, "26")?.note ?? "", "Schedule 2, line 9");
  }
  check("H1 engine Schedule H total", ret.scheduleH.total, 4632);
  check(
    "H1 Schedule H raises federal liability by exactly $4,632",
    ret.federalTaxLiability - base.ret.federalTaxLiability,
    4632,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario H2 — high-wage household employee: $250,000 cash wages, no FUTA
// override. TY2024.
//
// Hand-calc (Schedule H 2024; SS wage base $168,600):
//   line 1 = 168,600 (capped) → line 2 = 168,600 × 12.4% = 20,906.40
//   line 3 = 250,000 → line 4 = 250,000 × 2.9% = 7,250.00
//   line 5 = 250,000 − 200,000 = 50,000 → line 6 = 50,000 × 0.9% = 450.00
//   line 8 = 20,906.40 + 7,250 + 450 = 28,606.40
//   line 15 = min(250,000, 7,000) = 7,000 → line 16 = 42.00
//   line 26 = 28,648.40.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    wages: 40000,
    adjustments: [{ adjustmentType: "household_employee_cash_wages", amount: 250000 }],
  });
  const { ctx, ret } = ctxFor(inputs);
  const inst = buildScheduleHForm(ctx);
  checkTrue("H2 builder returns an instance", inst != null);
  if (inst) {
    check("H2 line 1 capped at the $168,600 SS wage base", num(findLine(inst, "1")), 168600);
    checkStr("H2 line 1 notes the wage-base cap", findLine(inst, "1")?.note ?? "", "wage base cap");
    check("H2 line 2 SS tax = 168,600 × 12.4%", num(findLine(inst, "2")), 20906.4);
    check("H2 line 3 Medicare wages (uncapped)", num(findLine(inst, "3")), 250000);
    check("H2 line 4 Medicare tax = 250,000 × 2.9%", num(findLine(inst, "4")), 7250);
    check("H2 line 5 wages over $200k", num(findLine(inst, "5")), 50000);
    check("H2 line 6 Additional Medicare = 50,000 × 0.9%", num(findLine(inst, "6")), 450);
    check("H2 line 8", num(findLine(inst, "8")), 28606.4);
    check("H2 line 15 default FUTA base = min(wages, 7,000)", num(findLine(inst, "15")), 7000);
    check("H2 line 26 total", num(findLine(inst, "26")), 28648.4);
    checkTie("H2 line 26 ties to engine", inst, "Line 26 ties");
  }
  check("H2 engine Schedule H total", ret.scheduleH.total, 28648.4);
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario H3 — FUTA-only: $2,000 cash wages (below the $2,700 FICA threshold,
// above the $1,000 FUTA trigger). TY2024.
//
// Hand-calc: no FICA; FUTA = min(2,000, 7,000) × 0.6% = 12.00 → line 26 = 12.
// ═══════════════════════════════════════════════════════════════════════════
{
  const inputs = makeInputs({
    wages: 40000,
    adjustments: [{ adjustmentType: "household_employee_cash_wages", amount: 2000 }],
  });
  const { ctx, ret } = ctxFor(inputs);
  const inst = buildScheduleHForm(ctx);
  checkTrue("H3 builder returns an instance (FUTA-only)", inst != null);
  if (inst) {
    checkTrue("H3 question A (FICA threshold) = false", findLine(inst, "A")?.value === false);
    checkTrue("H3 FICA lines replaced by below-threshold placeholder", findLine(inst, "1–6") != null && findLine(inst, "2") == null);
    check("H3 line 8 structural total = 0", num(findLine(inst, "8")), 0);
    check("H3 line 15 FUTA wages", num(findLine(inst, "15")), 2000);
    check("H3 line 16 FUTA tax = 2,000 × 0.6%", num(findLine(inst, "16")), 12);
    check("H3 line 26 total", num(findLine(inst, "26")), 12);
  }
  check("H3 engine Schedule H total (FUTA only)", ret.scheduleH.total, 12);
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario N — applicability null gates: plain W-2 return, no rentals, no
// K-1s, no household employees → both builders return null.
// ═══════════════════════════════════════════════════════════════════════════
{
  const { ctx } = ctxFor(makeInputs({ wages: 60000 }));
  checkTrue("N buildScheduleE returns null with no rental/K-1 activity", buildScheduleE(ctx) === null);
  checkTrue("N buildScheduleHForm returns null with no household wages", buildScheduleHForm(ctx) === null);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nT2.1 workpaper — Schedule E + Schedule H builder tests:`);
for (const f of FAIL) console.log(`  ${f}`);
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
