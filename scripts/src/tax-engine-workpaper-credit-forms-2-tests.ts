/**
 * T2.1 — Workpaper builders, group "credit-forms-2":
 *   Form 8962 (Premium Tax Credit §36B), Form 5695 (Residential Energy
 *   Credits §25D/§25C + bundled §30C), Form 8839 (Adoption Credit §23),
 *   Form 1116 (Foreign Tax Credit §901/§904).
 *
 * Every headline dollar value is HAND-CALC'D against the IRS published rule
 * (see the "Hand-calc:" blocks); identity ties may compare to engine fields —
 * that is the workpaper's job. Pure engine; no API required.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-credit-forms-2-tests.ts
 */
import {
  computeTaxReturnPure,
  type ComputedTaxReturn,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildForm8962 } from "../../artifacts/api-server/src/lib/forms/form8962Spec";
import { buildForm5695 } from "../../artifacts/api-server/src/lib/forms/form5695Spec";
import { buildForm8839 } from "../../artifacts/api-server/src/lib/forms/form8839Spec";
import { buildForm1116 } from "../../artifacts/api-server/src/lib/forms/form1116Spec";
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
  else FAIL.push(`✗ ${label}: expected true`);
}
function checkStr(label: string, actual: string | null | undefined, frag: string): void {
  if ((actual ?? "").includes(frag)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected to contain "${frag}", got "${actual}"`);
}

// ── Builders' input fixtures ────────────────────────────────────────────────
interface ScenarioOpts {
  year?: number;
  filingStatus?: string;
  wages?: number;
  client?: Partial<TaxReturnInputs["client"]>;
  adjustments?: Array<{ type: string; amount: number }>;
}
function mkInputs(o: ScenarioOpts = {}): TaxReturnInputs {
  const year = o.year ?? 2024;
  const wages = o.wages ?? 0;
  return {
    client: {
      filingStatus: o.filingStatus ?? "single",
      state: "FL",
      taxYear: year,
      dependentsUnder17: 0,
      otherDependents: 0,
      taxpayerAge: 45,
      ...o.client,
    },
    w2s:
      wages > 0
        ? [{ taxYear: year, wagesBox1: wages, socialSecurityWagesBox3: wages, medicareWagesBox5: wages, stateCode: "FL" }]
        : [],
    form1099s: [],
    adjustments: (o.adjustments ?? []).map((a) => ({ adjustmentType: a.type, amount: a.amount, isApplied: true })),
    taxYear: year,
  };
}
const TAXPAYER: WorkpaperTaxpayer = {
  firstName: "Test",
  lastName: "Client",
  filingStatus: "single",
  state: "FL",
};
function ctxFor(ret: ComputedTaxReturn, inputs?: TaxReturnInputs): FormBuildContext {
  return { taxpayer: TAXPAYER, ret, inputs };
}

// ── Line lookup helpers ─────────────────────────────────────────────────────
const allLines = (inst: FormInstance): FormLine[] => inst.parts.flatMap((p) => p.lines);
const findLine = (inst: FormInstance, lineNo: string, frag?: string): FormLine | undefined =>
  allLines(inst).find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
const findByLabel = (inst: FormInstance, frag: string): FormLine | undefined =>
  allLines(inst).find((l) => l.label.includes(frag));
const num = (l: FormLine | undefined): number => (typeof l?.value === "number" ? l.value : NaN);
/** Count of FAILED tie-out rows (checkLine renders "⚠ …" when off). */
const warnCount = (inst: FormInstance): number => allLines(inst).filter((l) => l.label.startsWith("⚠")).length;

// ════════════════════════════════════════════════════════════════════════════
// Form 8962 — Premium Tax Credit
// ════════════════════════════════════════════════════════════════════════════

// S1 — APTC clawback CAPPED (the P2-14 PTC-A anchor). TY2024 single FL,
// wages $36,450; premium $7,000 / SLCSP $8,000 / advance APTC $9,000.
// Hand-calc (Form 8962 + §36B; Rev. Proc. 2023-34 repayment caps; 2023 HHS FPL):
//   FPL (household of 1, 48-state table)      = $14,580
//   Line 5: 36,450 / 14,580                   = 2.50 → 250% of FPL
//   Line 7 applicable figure (ARPA schedule)  = 0.04 (the 250% breakpoint)
//   Line 8a contribution: 36,450 × 0.04       = $1,458.00
//   Line 11d: max(0, 8,000 − 1,458)           = $6,542.00
//   Line 11e PTC: min(7,000, 6,542)           = $6,542.00
//   Line 27 excess APTC: 9,000 − 6,542        = $2,458.00
//   Line 28 cap (single, 200–300% FPL tier)   = $975
//   Line 29 repayment: min(2,458, 975)        = $975.00  → Schedule 2 line 2
//   Income tax: taxable = 36,450 − 14,600 std = 21,850
//     = 1,160 (10% × 11,600) + 12% × 10,250 = 1,160 + 1,230 = $2,390.00
//   federalTaxLiability = 2,390 + 975 (repayment bundled) = $3,365.00
{
  const inputs = mkInputs({
    wages: 36450,
    client: { acaAnnualPremium: 7000, acaAnnualSlcsp: 8000, acaAdvanceAptc: 9000 },
  });
  const ret = computeTaxReturnPure(inputs);
  check("S1 engine netPtc capped at −975", ret.premiumTaxCredit.netPtc, -975);
  check("S1 engine federalTaxLiability = 2,390 tax + 975 repayment", ret.federalTaxLiability, 3365);

  const inst = buildForm8962(ctxFor(ret, inputs));
  checkTrue("S1 8962 applicable (not null)", inst != null);
  if (inst) {
    check("S1 line 1 tax family size", num(findLine(inst, "1")), 1);
    check("S1 line 2a modified AGI", num(findLine(inst, "2a")), 36450);
    check("S1 line 4 federal poverty line", num(findLine(inst, "4")), 14580);
    check("S1 line 5 FPL fraction = 2.50 (renders 250%)", num(findLine(inst, "5")), 2.5, 0.0001);
    check("S1 line 7 applicable figure 0.04", num(findLine(inst, "7")), 0.04, 0.0001);
    check("S1 line 8a annual contribution $1,458", num(findLine(inst, "8a")), 1458);
    check("S1 line 11d max premium assistance $6,542", num(findLine(inst, "11d")), 6542);
    check("S1 line 11e annual PTC allowed $6,542", num(findLine(inst, "11e")), 6542);
    check("S1 line 24 total PTC $6,542", num(findLine(inst, "24")), 6542);
    check("S1 line 25 advance APTC $9,000", num(findLine(inst, "25")), 9000);
    checkTrue("S1 line 26 (net PTC) omitted on a clawback", findLine(inst, "26") == null);
    check("S1 line 27 excess APTC $2,458", num(findLine(inst, "27")), 2458);
    check("S1 line 28 repayment limitation $975", num(findLine(inst, "28")), 975);
    check("S1 line 29 repayment $975", num(findLine(inst, "29")), 975);
    check("S1 line 29 ties engine repayment", num(findLine(inst, "29")), Math.max(0, -ret.premiumTaxCredit.netPtc));
    checkTrue("S1 has Parts I, II, III", inst.parts.length === 3);
    check("S1 all tie-out rows pass (no ⚠)", warnCount(inst), 0);
  }
}

// S2 — additional PTC (the P2-14 PTC-B anchor): premium $9,000 / SLCSP $8,000 /
// advance $4,000, same MAGI.
// Hand-calc: PTC = min(9,000, 6,542) = 6,542; net = 6,542 − 4,000 = +$2,542 →
//   Schedule 3 line 9. Settlement: withheld 0 + refundable 2,542 − tax 2,390
//   = +$152 refund (income tax unchanged at $2,390; no repayment).
{
  const inputs = mkInputs({
    wages: 36450,
    client: { acaAnnualPremium: 9000, acaAnnualSlcsp: 8000, acaAdvanceAptc: 4000 },
  });
  const ret = computeTaxReturnPure(inputs);
  check("S2 engine netPtc +2,542", ret.premiumTaxCredit.netPtc, 2542);
  check("S2 refund identity: 2,542 refundable − 2,390 tax = +152", ret.federalRefundOrOwed, 152);

  const inst = buildForm8962(ctxFor(ret, inputs));
  checkTrue("S2 8962 applicable", inst != null);
  if (inst) {
    check("S2 line 24 total PTC $6,542", num(findLine(inst, "24")), 6542);
    check("S2 line 26 net PTC $2,542", num(findLine(inst, "26")), 2542);
    checkTrue("S2 Part III omitted (no excess APTC)", inst.parts.length === 2 && findLine(inst, "29") == null);
    check("S2 all tie-out rows pass", warnCount(inst), 0);
  }
}

// S3 — null gate: no ACA activity → Form 8962 not applicable.
{
  const inputs = mkInputs({ wages: 50000 });
  const ret = computeTaxReturnPure(inputs);
  checkTrue("S3 8962 null when no ACA fields", buildForm8962(ctxFor(ret, inputs)) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// Form 5695 — Residential Energy Credits
// ════════════════════════════════════════════════════════════════════════════

// S4 — TY2024 single FL, wages $200,000. Solar $20,000; general §25C $5,000;
// heat pump $9,000; EV charger $4,000.
// Hand-calc (Form 5695 + §25D/§25C; Form 8911 §30C):
//   §25D: 30% × 20,000 = $6,000 (no annual cap)
//   §25C general: min(30% × 5,000 = 1,500, $1,200 cap)   = $1,200
//   §25C heat pump: min(30% × 9,000 = 2,700, $2,000 cap) = $2,000
//   §25C combined (line 30): 1,200 + 2,000               = $3,200 (≤ $3,200 max)
//   §30C: min(30% × 4,000 = 1,200, $1,000 cap)           = $1,000
//   Package total: 6,000 + 1,200 + 2,000 + 1,000         = $10,200
//   Income tax: taxable = 200,000 − 14,600 = 185,400
//     = 1,160 + 4,266 + 11,742.50 + 24% × 84,875 = $37,538.50 (> 10,200, so the
//     full package applies → totalNonRefundableApplied = $10,200; refund
//     settlement = 0 + 10,200 − 37,538.50 = −$27,338.50)
{
  const inputs = mkInputs({
    wages: 200000,
    adjustments: [
      { type: "residential_clean_energy", amount: 20000 },
      { type: "energy_efficient_home", amount: 5000 },
      { type: "energy_efficient_heatpump", amount: 9000 },
      { type: "ev_charger_property", amount: 4000 },
    ],
  });
  const ret = computeTaxReturnPure(inputs);
  check("S4 engine energy package total $10,200", ret.residentialEnergyCredits.total, 10200);
  check("S4 engine totalNonRefundableApplied $10,200", ret.totalNonRefundableApplied, 10200);
  check("S4 refund identity −$27,338.50", ret.federalRefundOrOwed, -27338.5);

  const inst = buildForm5695(ctxFor(ret, inputs));
  checkTrue("S4 5695 applicable", inst != null);
  if (inst) {
    check("S4 Part I line 1 clean energy costs $20,000", num(findLine(inst, "1")), 20000);
    check("S4 line 6b = 30% of line 6a = $6,000", num(findLine(inst, "6b")), 6000);
    check("S4 line 13 §25D credit $6,000", num(findLine(inst, "13")), 6000);
    // FC-11: line 15 now carries the REAL §25D applied amount (liability limit
    // + §25D(c) carryforward are modeled; tax $37,538.50 ≫ package → full $6,000).
    check("S4 line 15 §25D applied $6,000 (liability limit modeled)", num(findLine(inst, "15")), 6000);
    check("S4 §25C general bucket costs $5,000", num(findLine(inst, "18–25")), 5000);
    const generalCredit = num(findByLabel(inst, "$1,200 general annual limit"));
    check("S4 §25C general credit capped at $1,200", generalCredit, 1200);
    check("S4 line 29a heat-pump costs $9,000", num(findLine(inst, "29a")), 9000);
    const heatPumpCredit = num(findByLabel(inst, "$2,000 heat-pump annual limit"));
    check("S4 heat-pump credit capped at $2,000", heatPumpCredit, 2000);
    check("S4 line 30 §25C total $3,200", num(findLine(inst, "30")), 3200);
    check("S4 additive: line 30 = general + heat pump", num(findLine(inst, "30")), generalCredit + heatPumpCredit);
    check("S4 §30C EV charger credit capped at $1,000", num(findByLabel(inst, "capped at $1,000")), 1000);
    check("S4 summary total $10,200", num(findByLabel(inst, "Total residential energy credits")), 10200);
    checkTrue("S4 has 4 parts (I, II, §30C, summary)", inst.parts.length === 4);
    check("S4 all tie-out rows pass", warnCount(inst), 0);
    checkStr("S4 footnote discloses Form 8911", (inst.footnotes ?? []).join(" | "), "Form 8911");
  }
}

// S5 — null gate: no energy spend → Form 5695 not applicable.
{
  const inputs = mkInputs({ wages: 80000 });
  const ret = computeTaxReturnPure(inputs);
  checkTrue("S5 5695 null when no energy credits", buildForm5695(ctxFor(ret, inputs)) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// Form 8839 — Adoption Credit
// ════════════════════════════════════════════════════════════════════════════

// S6 — TY2024 single FL, wages $150,000, qualified expenses $20,000.
// Hand-calc (Form 8839 Part II + §23; Rev. Proc. 2023-34):
//   Line 2 max credit/child (TY2024)            = $16,810
//   Line 6 eligible: min(20,000, 16,810)        = $16,810
//   Line 7 MAGI = 150,000 (< $252,150 start)    → no phase-out
//   Line 11 current credit                      = $16,810
//   TY2024 refundable cap $0 → fully nonrefundable
//   Income tax: taxable = 150,000 − 14,600 = 135,400
//     = 1,160 + 4,266 + 11,742.50 + 24% × 34,875 = $25,538.50 (> 16,810)
//   Line 16 applied = $16,810; carryforward $0
//   Settlement: 0 + 16,810 − 25,538.50 = −$8,728.50
{
  const inputs = mkInputs({
    wages: 150000,
    adjustments: [{ type: "qualified_adoption_expenses", amount: 20000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  check("S6 engine nonrefundable applied $16,810", ret.adoptionCredit.nonRefundableApplied, 16810);
  check("S6 engine carryforward $0", ret.adoptionCreditCarryforwardRemaining, 0);
  check("S6 refund identity −$8,728.50", ret.federalRefundOrOwed, -8728.5);

  const inst = buildForm8839(ctxFor(ret, inputs));
  checkTrue("S6 8839 applicable", inst != null);
  if (inst) {
    checkTrue("S6 line 1 special-needs = No", findLine(inst, "1")?.value === false);
    check("S6 line 2 max credit per child $16,810", num(findLine(inst, "2")), 16810);
    check("S6 line 5 qualified expenses $20,000", num(findLine(inst, "5")), 20000);
    check("S6 line 6 eligible expenses capped $16,810", num(findLine(inst, "6")), 16810);
    check("S6 line 7 MAGI $150,000", num(findLine(inst, "7")), 150000);
    checkTrue("S6 no phase-out lines (8–10 note instead)", findLine(inst, "8") == null && findLine(inst, "8–10") != null);
    check("S6 line 11 current-year credit $16,810", num(findLine(inst, "11")), 16810);
    checkTrue("S6 no OBBBA refundable rows in TY2024", findByLabel(inst, "OBBBA refundable cap") == null);
    check("S6 line 14 nonrefundable available $16,810", num(findLine(inst, "14")), 16810);
    check("S6 line 16 applied $16,810", num(findLine(inst, "16")), 16810);
    check("S6 carryforward-to-next row $0", num(findByLabel(inst, "Carryforward to next year")), 0);
    check("S6 all tie-out rows pass", warnCount(inst), 0);
    checkStr("S6 MFS-bar footnote present", (inst.footnotes ?? []).join(" | "), "married-filing-separately");
  }
}

// S7 — MAGI phase-out, TY2024 single, wages $272,150, expenses $20,000.
// Hand-calc (§23(b)(2): ratable over $40,000 above $252,150):
//   Line 8: 272,150 − 252,150 = $20,000
//   Line 9: 20,000 / 40,000   = 0.50
//   Line 6: $16,810 → Line 10 reduction = 16,810 × 0.50 = $8,405.00
//   Line 11: 16,810 − 8,405 = $8,405.00
//   Income tax: taxable = 272,150 − 14,600 = 257,550
//     = 1,160 + 4,266 + 11,742.50 + 24% × 91,425 (= 21,942) + 32% × 51,775
//     (= 16,568) + 35% × 13,825 (= 4,838.75) = $60,517.25 (> 8,405 → applied full)
{
  const inputs = mkInputs({
    wages: 272150,
    adjustments: [{ type: "qualified_adoption_expenses", amount: 20000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  check("S7 engine tentative credit after 50% phase-out $8,405", ret.adoptionCredit.tentativeCredit, 8405);
  check("S7 engine applied $8,405", ret.adoptionCredit.nonRefundableApplied, 8405);

  const inst = buildForm8839(ctxFor(ret, inputs));
  checkTrue("S7 8839 applicable", inst != null);
  if (inst) {
    check("S7 line 8 MAGI excess $20,000", num(findLine(inst, "8")), 20000);
    check("S7 line 9 phase-out fraction 0.50", num(findLine(inst, "9")), 0.5, 0.0001);
    check("S7 line 10 reduction $8,405", num(findLine(inst, "10")), 8405);
    check("S7 line 11 credit after phase-out $8,405", num(findLine(inst, "11")), 8405);
    check("S7 line 16 applied $8,405", num(findLine(inst, "16")), 8405);
    check("S7 all tie-out rows pass", warnCount(inst), 0);
  }
}

// S8 — TY2025 OBBBA refundable split. Single, wages $150,000, expenses $20,000.
// Hand-calc (Rev. Proc. 2024-40 + OBBBA P.L. 119-21 §70402):
//   Line 2 (TY2025): $17,280; eligible = min(20,000, 17,280) = $17,280
//   MAGI 150,000 < $259,190 start → tentative = $17,280
//   Refundable = min(17,280, $5,000 cap) = $5,000; nonrefundable current = $12,280
//   Income tax: taxable = 150,000 − 15,750 (OBBBA std ded) = 134,250
//     = 1,192.50 + 12% × 36,550 (= 4,386) + 22% × 54,875 (= 12,072.50)
//     + 24% × 30,900 (= 7,416) = $25,067.00 (> 12,280 → applied in full)
//   Settlement: 0 + 12,280 + 5,000 − 25,067 = −$7,787.00
{
  const inputs = mkInputs({
    year: 2025,
    wages: 150000,
    adjustments: [{ type: "qualified_adoption_expenses", amount: 20000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  check("S8 engine refundable portion $5,000 (OBBBA)", ret.adoptionCredit.refundablePortion, 5000);
  check("S8 engine nonrefundable applied $12,280", ret.adoptionCredit.nonRefundableApplied, 12280);
  check("S8 refund identity −$7,787", ret.federalRefundOrOwed, -7787);

  const inst = buildForm8839(ctxFor(ret, inputs));
  checkTrue("S8 8839 applicable", inst != null);
  if (inst) {
    check("S8 line 2 max credit per child $17,280", num(findLine(inst, "2")), 17280);
    check("S8 line 11 current credit $17,280", num(findLine(inst, "11")), 17280);
    check("S8 OBBBA refundable cap row $5,000", num(findByLabel(inst, "OBBBA refundable cap")), 5000);
    check("S8 refundable portion row $5,000", num(findByLabel(inst, "Refundable portion")), 5000);
    check("S8 line 14 nonrefundable available $12,280", num(findLine(inst, "14")), 12280);
    check("S8 line 16 applied $12,280", num(findLine(inst, "16")), 12280);
    check("S8 all tie-out rows pass", warnCount(inst), 0);
  }
}

// S9 — MFS with a prior §23(c) carryforward: no current credit; the
// carryforward rolls forward untouched (engine v1 conservative MFS bar).
// Hand-calc: prior carryforward $3,000 in → applied $0 → carryforward out $3,000.
{
  const inputs = mkInputs({
    filingStatus: "married_filing_separately",
    wages: 100000,
    adjustments: [{ type: "adoption_credit_carryforward", amount: 3000 }],
  });
  const ret = computeTaxReturnPure(inputs);
  check("S9 engine applied $0 (MFS barred)", ret.adoptionCredit.nonRefundableApplied, 0);
  check("S9 engine carryforward rolls $3,000", ret.adoptionCreditCarryforwardRemaining, 3000);

  const inst = buildForm8839(ctxFor(ret, inputs));
  checkTrue("S9 8839 renders for carryforward-only", inst != null);
  if (inst) {
    checkStr("S9 MFS ineligibility row", String(findByLabel(inst, "Current-year credit")?.value ?? ""), "married filing separately");
    check("S9 line 13 carryforward in $3,000", num(findLine(inst, "13")), 3000);
    check("S9 line 16 applied $0", num(findLine(inst, "16")), 0);
    check("S9 carryforward-out row $3,000", num(findByLabel(inst, "Carryforward to next year")), 3000);
    check("S9 all tie-out rows pass", warnCount(inst), 0);
  }
}

// S10 — null gate: no expenses, no carryforward → Form 8839 not applicable.
{
  const inputs = mkInputs({ wages: 90000 });
  const ret = computeTaxReturnPure(inputs);
  checkTrue("S10 8839 null with no adoption activity", buildForm8839(ctxFor(ret, inputs)) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// Form 1116 — Foreign Tax Credit
// ════════════════════════════════════════════════════════════════════════════

// S11 — over the §904(j) threshold, Form 1116 limit BINDS. TY2024 single FL,
// wages $100,000; foreign tax paid $4,000; foreign-source taxable income $20,000.
// Hand-calc (Form 1116 Part III; §904(a)):
//   Line 18 taxable income: 100,000 − 14,600 = $85,400
//   Line 20 pre-credit tax: 1,160 + 4,266 + 22% × 38,250 (= 8,415) = $13,841.00
//     (AMT $0: AMTI = 85,400 + 14,600 std-ded addback = 100,000; exemption
//      85,700 → base 14,300 × 26% = 3,718 < 13,841)
//   Line 19 fraction: 20,000 / 85,400 = 0.23419…
//   Line 21 limit: 13,841 × 20,000 / 85,400 = $3,241.45
//   Line 24 credit: min(4,000, 3,241.45) = $3,241.45 → Schedule 3 line 1
//   §904(c) carryforward: 4,000 − 3,241.45 = $758.55
{
  const inputs = mkInputs({
    wages: 100000,
    adjustments: [
      { type: "foreign_tax_paid", amount: 4000 },
      { type: "foreign_source_taxable_income", amount: 20000 },
    ],
  });
  const ret = computeTaxReturnPure(inputs);
  check("S11 engine FTC credit $3,241.45 (limit binds)", ret.foreignTaxCredit.credit, 3241.45);
  check("S11 engine §904(c) carryforward $758.55", ret.foreignTaxCreditCarryforwardRemaining, 758.55);
  check("S11 engine totalNonRefundableApplied $3,241.45", ret.totalNonRefundableApplied, 3241.45);
  checkTrue("S11 engine flags: exceeded simplified + form limit applied", ret.foreignTaxCredit.exceededSimplifiedLimit && ret.foreignTaxCredit.formLimitApplied);

  const inst = buildForm1116(ctxFor(ret, inputs));
  checkTrue("S11 1116 applicable", inst != null);
  if (inst) {
    check("S11 line 9 current-year foreign tax $4,000", num(findLine(inst, "9")), 4000);
    checkTrue("S11 line 10 (carryover) omitted when none", findLine(inst, "10") == null);
    check("S11 line 14 total foreign taxes $4,000", num(findLine(inst, "14")), 4000);
    checkTrue("S11 §904(j) election = No", findByLabel(inst, "§904(j) election")?.value === false);
    check("S11 line 17 foreign-source income $20,000", num(findLine(inst, "17")), 20000);
    check("S11 line 18 taxable income $85,400", num(findLine(inst, "18")), 85400);
    check("S11 line 19 fraction 0.2342", num(findLine(inst, "19")), 0.234192, 0.0005);
    check("S11 line 20 pre-credit U.S. tax $13,841", num(findLine(inst, "20")), 13841);
    check("S11 line 21 §904 limit $3,241.45", num(findLine(inst, "21")), 3241.45);
    check("S11 line 24 credit $3,241.45", num(findLine(inst, "24")), 3241.45);
    check("S11 carryforward row $758.55", num(findByLabel(inst, "carryforward to next year")), 758.55);
    check("S11 all tie-out rows pass", warnCount(inst), 0);
    checkStr("S11 single-category footnote", (inst.footnotes ?? []).join(" | "), "§904(d)");
  }
}

// S12 — §904(j) simplified election: $250 foreign tax (single, ≤ $300).
// Hand-calc: credit = $250 (no Form 1116 limit, no carryover arises).
{
  const inputs = mkInputs({ wages: 100000, adjustments: [{ type: "foreign_tax_paid", amount: 250 }] });
  const ret = computeTaxReturnPure(inputs);
  check("S12 engine credit = $250 paid", ret.foreignTaxCredit.credit, 250);
  check("S12 engine carryforward $0", ret.foreignTaxCreditCarryforwardRemaining, 0);

  const inst = buildForm1116(ctxFor(ret, inputs));
  checkTrue("S12 1116 renders on simplified path", inst != null);
  if (inst) {
    checkTrue("S12 §904(j) election = Yes", findByLabel(inst, "§904(j) election")?.value === true);
    check("S12 line 14 total foreign taxes $250", num(findLine(inst, "14")), 250);
    checkTrue("S12 §904 limit lines omitted under the election", findLine(inst, "21") == null);
    check("S12 line 24 credit $250", num(findLine(inst, "24")), 250);
    check("S12 carryforward row $0", num(findByLabel(inst, "carryforward to next year")), 0);
    check("S12 all tie-out rows pass", warnCount(inst), 0);
  }
}

// S13 — current-year tax + prior §904(c) carryover combined UNDER the limit.
// $2,000 current + $1,000 carryover; same $20,000 foreign-source / $100k wages.
// Hand-calc: combined $3,000 > $300 → Form 1116 path; limit $3,241.45 (S11);
//   credit = min(3,000, 3,241.45) = $3,000; carryforward out $0.
{
  const inputs = mkInputs({
    wages: 100000,
    adjustments: [
      { type: "foreign_tax_paid", amount: 2000 },
      { type: "foreign_tax_credit_carryforward", amount: 1000 },
      { type: "foreign_source_taxable_income", amount: 20000 },
    ],
  });
  const ret = computeTaxReturnPure(inputs);
  check("S13 engine credit $3,000 (under the limit)", ret.foreignTaxCredit.credit, 3000);
  check("S13 engine carryforward out $0", ret.foreignTaxCreditCarryforwardRemaining, 0);

  const inst = buildForm1116(ctxFor(ret, inputs));
  checkTrue("S13 1116 applicable", inst != null);
  if (inst) {
    check("S13 line 9 current-year $2,000", num(findLine(inst, "9")), 2000);
    check("S13 line 10 carryover in $1,000", num(findLine(inst, "10")), 1000);
    check("S13 line 14 combined $3,000", num(findLine(inst, "14")), 3000);
    check("S13 line 21 §904 limit $3,241.45", num(findLine(inst, "21")), 3241.45);
    check("S13 line 24 credit $3,000", num(findLine(inst, "24")), 3000);
    check("S13 all tie-out rows pass (incl. 9+10=14)", warnCount(inst), 0);
  }
}

// S14 — over the threshold WITHOUT foreign-source income (engine path 3:
// credit approximated at taxes paid; §904 limit NOT computed) — must be
// disclosed loudly. $4,000 paid, $100k wages.
// Hand-calc: credit = $4,000 (approximation); income tax $13,841 > 4,000.
{
  const inputs = mkInputs({ wages: 100000, adjustments: [{ type: "foreign_tax_paid", amount: 4000 }] });
  const ret = computeTaxReturnPure(inputs);
  check("S14 engine credit = paid $4,000 (approximation)", ret.foreignTaxCredit.credit, 4000);
  checkTrue("S14 engine formLimitApplied = false", !ret.foreignTaxCredit.formLimitApplied && ret.foreignTaxCredit.exceededSimplifiedLimit);

  const inst = buildForm1116(ctxFor(ret, inputs));
  checkTrue("S14 1116 renders", inst != null);
  if (inst) {
    checkTrue("S14 '§904 limitation NOT COMPUTED' disclosure row present", findLine(inst, "17–21") != null);
    checkStr("S14 approximation warning footnote first", (inst.footnotes ?? [])[0] ?? "", "APPROXIMATION");
    check("S14 line 24 credit $4,000", num(findLine(inst, "24")), 4000);
    check("S14 all tie-out rows pass", warnCount(inst), 0);
  }
}

// S15 — null gate: no foreign tax → Form 1116 not applicable.
{
  const inputs = mkInputs({ wages: 60000 });
  const ret = computeTaxReturnPure(inputs);
  checkTrue("S15 1116 null with no foreign tax", buildForm1116(ctxFor(ret, inputs)) == null);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\nT2.1 workpaper credit-forms-2 (8962 / 5695 / 8839 / 1116):`);
PASS.forEach((p) => console.log(`  ${p}`));
if (FAIL.length > 0) {
  console.log(`\nFailures:`);
  FAIL.forEach((f) => console.log(`  ${f}`));
}
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
