/**
 * T2.1 workpaper tests — group "state-ca-ny": CA Form 540 + NY Form IT-201
 * SUMMARY workpapers (buildCa540 / buildNyIt201).
 *
 * Pure engine + pure builders; NO API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-state-ca-ny-tests.ts
 *
 * Every headline dollar value is HAND-CALC'D against the published state rule
 * (FTB 2024 Rate Schedule X / FTB 3853 / 540NR method; NY IT-201/IT-203/IT-215/
 * IT-213 and the NYC PIT tables) in a "// Hand-calc:" block. Identity rows
 * (workpaper total == engine field) MAY compare to engine output — that tie-out
 * is the workpaper's job.
 */

import {
  computeTaxReturnPure,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildCa540 } from "../../artifacts/api-server/src/lib/forms/stateCa540Spec";
import { buildNyIt201 } from "../../artifacts/api-server/src/lib/forms/stateNyIt201Spec";
import type {
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
  else FAIL.push(`✗ ${label}: expected true`);
}

const findLine = (
  inst: FormInstance | null,
  lineNo: string,
  frag?: string,
): FormLine | undefined =>
  inst?.parts
    .flatMap((p) => p.lines)
    .find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
const findByLabel = (inst: FormInstance | null, frag: string): FormLine | undefined =>
  inst?.parts.flatMap((p) => p.lines).find((l) => l.label.includes(frag));
const money = (l: FormLine | undefined): number =>
  typeof l?.value === "number" ? l.value : NaN;

const taxpayer = (filingStatus: string, state: string): WorkpaperTaxpayer => ({
  firstName: "Test",
  lastName: "Payer",
  filingStatus,
  state,
});
const inputs = (
  client: Record<string, unknown>,
  w2s: unknown[],
  adjustments: unknown[] = [],
  form1099s: unknown[] = [],
): TaxReturnInputs =>
  ({ client, w2s, form1099s, adjustments, taxYear: 2024 } as unknown as TaxReturnInputs);

// ════════════════════════════════════════════════════════════════════════════
// S1 — CA resident, single, $150,000 W-2, $9,000 CA withholding (TY2024)
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (FTB 2024 Rate Schedule X, single; CA std ded $5,540 — 2024 FTB
// 540 booklet; engine model: brackets(federal AGI − CA std ded)):
//   CA taxable = 150,000 − 5,540 = 144,460
//   1% × 10,756                       =    107.56
//   2% × (25,499 − 10,756 = 14,743)   =    294.86
//   4% × (40,245 − 25,499 = 14,746)   =    589.84
//   6% × (55,866 − 40,245 = 15,621)   =    937.26
//   8% × (70,606 − 55,866 = 14,740)   =  1,179.20
//   9.3% × (144,460 − 70,606 = 73,854)=  6,868.42
//   CA tax = 9,977.14  (no MH surtax: taxable < $1M; no CA AMT: no prefs)
// CA Personal Exemption Credit (540 line 32, Cal. RTC §17054): $144 single,
//   AGI 150,000 < the $244,857 phase-out start → full $144 (the engine's
//   nonrefundable state additional-credit aggregate).
{
  const ins = inputs(
    { filingStatus: "single", state: "CA", taxYear: 2024 },
    [{ taxYear: 2024, wagesBox1: 150000, stateTaxWithheldBox17: 9000, stateCode: "CA" }],
  );
  const ret = computeTaxReturnPure(ins);
  const ca = buildCa540({ taxpayer: taxpayer("single", "CA"), ret, inputs: ins });
  checkTrue("S1 buildCa540 applicable (non-null)", ca != null);
  check("S1 line 13 federal AGI = $150,000", money(findLine(ca, "13")), 150000);
  const taxRow = findLine(ca, "31/61/62");
  check("S1 CA resident tax row = $9,977.14 (hand-calc, Sched X)", money(taxRow), 9977.14);
  check("S1 CA tax row ties engine multiState.residentStateTax", money(taxRow), ret.multiState.residentStateTax);
  check("S1 line 64 total CA tax = $9,977.14", money(findLine(ca, "64")), 9977.14);
  const tie = findByLabel(ca, "ties to engine total state tax");
  checkTrue("S1 single-state tie-out row present", tie != null);
  checkStr("S1 tie-out row reads 'ties'", String(tie?.value), "ties");
  check("S1 line 32/40/46 CA personal exemption credit aggregate = $144", money(findLine(ca, "32/40/46")), 144);
  check("S1 line 71 withholding (all-states aggregate) = $9,000", money(findLine(ca, "71")), 9000);
  checkTrue("S1 line 75 CalEITC omitted ($0 at $150k AGI)", findLine(ca, "75") == null);
  checkTrue("S1 line 92 ISR penalty omitted (no uninsured months)", findLine(ca, "92") == null);
  checkStr(
    "S1 settlement row points at reconciliation Part 7",
    String(findByLabel(ca, "Combined state settlement")?.value),
    "Part 7",
  );
  checkTrue("S1 buildNyIt201 returns null (no NY nexus)", buildNyIt201({ taxpayer: taxpayer("single", "CA"), ret, inputs: ins }) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// S2 — CA resident, single, $150k, 4 months without minimum coverage
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (FTB Form 3853, TY2024; audit M4 household-size threshold):
//   filing threshold (single, 0 deps) = $17,818
//   flat       = 1 adult × $900 = $900/yr
//   percentage = 2.5% × (150,000 − 17,818) = 2.5% × 132,182 = $3,304.55/yr
//   bronze cap = $348/mo × 12 × 1 person = $4,176/yr
//   greater-of(900, 3,304.55) = 3,304.55 < bronze cap → percentage method
//   penalty = 3,304.55 × 4/12 = $1,101.52  (engine round2)
{
  const ins = inputs(
    { filingStatus: "single", state: "CA", taxYear: 2024 },
    [{ taxYear: 2024, wagesBox1: 150000, stateCode: "CA" }],
    [{ adjustmentType: "months_without_minimum_coverage", amount: 4, isApplied: true }],
  );
  const ret = computeTaxReturnPure(ins);
  const ca = buildCa540({ taxpayer: taxpayer("single", "CA"), ret, inputs: ins });
  const isr = findLine(ca, "92");
  check("S2 line 92 ISR penalty = $1,101.52 (hand-calc, FTB 3853 2.5% method)", money(isr), 1101.52);
  check("S2 ISR row ties engine stateIndividualMandatePenalty", money(isr), ret.stateIndividualMandatePenalty);
  checkStr("S2 ISR note discloses the percentage method", isr?.note, "percentage");
  check("S2 line 64 total CA tax unchanged ($9,977.14 — penalty is line 92, not tax)", money(findLine(ca, "64")), 9977.14);
}

// ════════════════════════════════════════════════════════════════════════════
// S3 — Part-year mover CA → TX (change 2024-07-01), $100k W-2 (TX-sourced)
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (engine part-year model: day-prorated AGI + prorated std ded;
// 2024 is a leap year — 366 days; Jan 1 → Jun 30 = 182 CA days):
//   CA-period AGI   = 100,000 × 182/366 = 49,726.776
//   prorated stdDed = 5,540 × 182/366   =  2,754.863
//   CA taxable      = 49,726.776 − 2,754.863 = 46,971.913
//   1% × 10,756 = 107.56; 2% × 14,743 = 294.86; 4% × 14,746 = 589.84;
//   6% × (46,971.913 − 40,245 = 6,726.913) = 403.61
//   CA part-year tax = 107.56 + 294.86 + 589.84 + 403.61 = 1,395.87
{
  const ins = inputs(
    {
      filingStatus: "single", state: "TX", taxYear: 2024,
      residencyChangedInYear: true, formerState: "CA", residencyChangeDate: "2024-07-01",
    },
    [{ taxYear: 2024, wagesBox1: 100000, stateCode: "TX" }],
  );
  const ret = computeTaxReturnPure(ins);
  const ca = buildCa540({ taxpayer: taxpayer("single", "TX"), ret, inputs: ins });
  checkTrue("S3 buildCa540 applicable via formerStateCode CA", ca != null);
  const py = findByLabel(ca, "part-year resident tax");
  check("S3 CA part-year tax row = $1,395.87 (hand-calc)", money(py), 1395.87);
  checkStr("S3 part-year row carries the 540NR note", py?.note, "540NR");
  check("S3 line 64 total CA tax = part-year row (additive structure)", money(findLine(ca, "64")), 1395.87);
  checkTrue(
    "S3 cross-state aggregate note (no single-state tie-out)",
    findByLabel(ca, "cross-state aggregate") != null && findByLabel(ca, "ties to engine total state tax") == null,
  );
  checkTrue("S3 buildNyIt201 returns null", buildNyIt201({ taxpayer: taxpayer("single", "TX"), ret, inputs: ins }) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// S4 — NV resident with CA-source wages ($50k NV + $50k CA W-2s)
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (540NR as-if-resident effective-rate method — the engine's
// verified CA NR method):
//   tax-as-if-resident on total AGI 100,000: CA taxable = 100,000 − 5,540 = 94,460
//   107.56 + 294.86 + 589.84 + 937.26 + 1,179.20 + 9.3% × (94,460 − 70,606 =
//   23,854 → 2,218.42) = 5,327.14
//   CA-source fraction = 50,000 / 100,000 = 0.5
//   CA NR tax = 5,327.14 × 0.5 = 2,663.57
{
  const ins = inputs(
    { filingStatus: "single", state: "NV", taxYear: 2024 },
    [
      { taxYear: 2024, wagesBox1: 50000, stateCode: "NV" },
      { taxYear: 2024, wagesBox1: 50000, stateCode: "CA" },
    ],
  );
  const ret = computeTaxReturnPure(ins);
  const ca = buildCa540({ taxpayer: taxpayer("single", "NV"), ret, inputs: ins });
  checkTrue("S4 buildCa540 applicable via CA NR entry", ca != null);
  check("S4 CA-source income row = $50,000", money(findByLabel(ca, "CA-source income")), 50000);
  const nr = findByLabel(ca, "CA nonresident tax");
  check("S4 CA NR tax row = $2,663.57 (hand-calc, 540NR ratio)", money(nr), 2663.57);
  checkStr("S4 NR note cites the 540NR as-if-resident method", nr?.note, "540NR method");
  check("S4 line 64 total = NR row (additive structure)", money(findLine(ca, "64")), 2663.57);
  check("S4 engine stateTaxLiability identity (CA-only NR)", ret.stateTaxLiability, 2663.57);
}

// ════════════════════════════════════════════════════════════════════════════
// S5 — NYC resident, single, 1 child under 17, $20,000 W-2 (TY2024)
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc:
//   Federal EITC (Rev. Proc. 2023-34, single, 1 child): earned 20,000 >
//     plateau start 12,390 → max credit $4,213; AGI 20,000 < phase-out start
//     22,720 → EITC = $4,213.
//   NYS EIC (IT-201 line 65; Tax Law §606(d)) = 30% × 4,213 = $1,263.90.
//   NYS tax (line 39): NY taxable = 20,000 − 8,000 std ded = 12,000.
//     4% × 8,500 = 340; 4.5% × (11,700 − 8,500 = 3,200) = 144;
//     5.25% × (12,000 − 11,700 = 300) = 15.75 → $499.75.
//   NYC (IT-201 lines 47–49; NYC brackets static since 2017):
//     line 47 NYC taxable = 12,000; 47a = 3.078% × 12,000 = $369.36.
//     household credit (line 48): single FAGI 20,000 > $12,500 → $0.
//     NYC EIC (line 70, IT-215 Worksheet C): NYAGI 20,000 → 20% band;
//       20% × 4,213 = $842.60. Exceeds NYC tax 369.36 → net NYC tax $0,
//       refundable excess = 842.60 − 369.36 = $473.24.
//     NYC school tax credit (line 69): FAGI < $250k, single → $63.
//   Empire State child credit (IT-213, line 63): AGI 20,000 < $75k threshold
//     → $330 × 1 child = $330 (engine's refundable additional-credit aggregate).
{
  const ins = inputs(
    { filingStatus: "single", state: "NY", taxYear: 2024, dependentsUnder17: 1, localityCode: "NYC" },
    [{ taxYear: 2024, wagesBox1: 20000, stateCode: "NY" }],
  );
  const ret = computeTaxReturnPure(ins);
  const ny = buildNyIt201({ taxpayer: taxpayer("single", "NY"), ret, inputs: ins });
  checkTrue("S5 buildNyIt201 applicable (non-null)", ny != null);
  checkTrue("S5 buildCa540 returns null", buildCa540({ taxpayer: taxpayer("single", "NY"), ret, inputs: ins }) == null);
  check("S5 line 19 federal AGI = $20,000", money(findLine(ny, "19")), 20000);
  const nyTax = findLine(ny, "39", "resident tax");
  check("S5 line 39 NYS tax = $499.75 (hand-calc)", money(nyTax), 499.75);
  check("S5 line 46 total NY tax = $499.75", money(findLine(ny, "46")), 499.75);
  checkStr("S5 single-state tie-out reads 'ties'", String(findByLabel(ny, "ties to engine total state tax")?.value), "ties");
  check("S5 line 47 NYC taxable = $12,000", money(findLine(ny, "47")), 12000);
  check("S5 line 47a NYC resident tax = $369.36 (hand-calc)", money(findLine(ny, "47a")), 369.36);
  checkTrue("S5 line 48 household credit omitted ($0 above $12.5k FAGI)", findLine(ny, "48") == null);
  const nycEic = findLine(ny, "70");
  check("S5 line 70 NYC EIC = −$842.60 (20% band, hand-calc)", money(nycEic), -842.60);
  checkStr("S5 NYC EIC note shows the 20.00% rate", nycEic?.note, "20.00");
  check("S5 net NYC tax (49/54) = $0 (EIC exceeds NYC tax)", money(findLine(ny, "49/54")), 0);
  check("S5 NYC EIC refundable excess row = $473.24 (hand-calc)", money(findByLabel(ny, "excess of NYC tax")), 473.24);
  check("S5 line 69 NYC school tax credit = $63", money(findLine(ny, "69")), 63);
  check("S5 line 65 NYS EIC = $1,263.90 (30% of $4,213 federal)", money(findLine(ny, "65")), 1263.90);
  check("S5 line 63/64 refundable aggregate = $330 Empire State child credit", money(findLine(ny, "63/64")), 330);
  checkTrue("S5 nonrefundable NY aggregate omitted ($0)", findByLabel(ny, "nonrefundable (engine aggregate)") == null);
}

// ════════════════════════════════════════════════════════════════════════════
// S6 — NYC resident, single, $200k 1099-NEC SE + $200k NYC UBT business income
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc:
//   SE: net SE earnings = 200,000 × 0.9235 = 184,700.
//     SS capped at 168,600 × 12.4% = 20,906.40; Medicare 184,700 × 2.9% =
//     5,356.30 → SE tax 26,262.70; half = 13,131.35.
//   AGI = 200,000 − 13,131.35 = 186,868.65.
//   NYS tax: NY taxable = 186,868.65 − 8,000 = 178,868.65.
//     340 + 144 + 115.50 + 5.5% × (80,650 − 13,900 = 66,750 → 3,671.25)
//     + 6% × (178,868.65 − 80,650 = 98,218.65 → 5,893.12) = $10,163.87.
//   NYC PIT (line 47a): 3.078% × 12,000 = 369.36; 3.762% × 13,000 = 489.06;
//     3.819% × 25,000 = 954.75; 3.876% × (178,868.65 − 50,000 = 128,868.65)
//     = 4,994.95 → $6,808.12.
//   MCTMT (line 54b, Zone 1 SE flat 0.60%): (184,700 − 50,000) × 0.006 = $808.20.
//   Net NYC tax incl. MCTMT = 6,808.12 + 808.20 = $7,616.32.
//   NYC UBT (Form NYC-202): net 200,000 − services allowance min(20%, $10k) =
//     10,000 − exemption 5,000 → taxable 185,000 × 4% = 7,400; credit $0
//     (tax ≥ $5,400) → UBT = $7,400.
//   Total local = 7,616.32 + 7,400 = $15,016.32.
//   NYC school tax credit: FAGI 186,868.65 < $250k, single → $63.
{
  const ins = inputs(
    { filingStatus: "single", state: "NY", taxYear: 2024, localityCode: "NYC" },
    [],
    [{ adjustmentType: "nyc_ubt_business_income", amount: 200000, isApplied: true }],
    [{ taxYear: 2024, formType: "nec", nonemployeeCompensation: 200000 }],
  );
  const ret = computeTaxReturnPure(ins);
  const ny = buildNyIt201({ taxpayer: taxpayer("single", "NY"), ret, inputs: ins });
  check("S6 line 39 NYS tax = $10,163.87 (hand-calc)", money(findLine(ny, "39", "resident tax")), 10163.87);
  check("S6 line 47 NYC taxable = $178,868.65", money(findLine(ny, "47")), 178868.65);
  check("S6 line 47a NYC tax = $6,808.12 (hand-calc)", money(findLine(ny, "47a")), 6808.12);
  check("S6 line 54b MCTMT = $808.20 (hand-calc, 0.60% over $50k)", money(findLine(ny, "54b")), 808.20);
  check("S6 net NYC tax incl. MCTMT = $7,616.32", money(findLine(ny, "49/54")), 7616.32);
  check("S6 NYC UBT row = $7,400 (hand-calc, NYC-202)", money(findByLabel(ny, "Unincorporated Business Tax")), 7400);
  const totalLocal = findByLabel(ny, "Total local tax");
  check("S6 total local tax = $15,016.32", money(totalLocal), 15016.32);
  check("S6 total local ties engine localTaxLiability", money(totalLocal), ret.localTaxLiability);
  checkStr("S6 local components tie-out reads 'ties'", String(findByLabel(ny, "Local components tie")?.value), "ties");
  check("S6 line 69 school tax credit = $63", money(findLine(ny, "69")), 63);
}

// ════════════════════════════════════════════════════════════════════════════
// S7 — Yonkers resident, single, $100k W-2
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc:
//   NYS tax: NY taxable = 100,000 − 8,000 = 92,000.
//     340 + 144 + 115.50 + 3,671.25 + 6% × (92,000 − 80,650 = 11,350 → 681)
//     = $4,951.75.
//   Yonkers resident surcharge (IT-201 line 55) = 16.75% × net NYS tax
//     = 0.1675 × 4,951.75 = $829.42.
{
  const ins = inputs(
    { filingStatus: "single", state: "NY", taxYear: 2024, localityCode: "YONKERS" },
    [{ taxYear: 2024, wagesBox1: 100000, stateCode: "NY" }],
  );
  const ret = computeTaxReturnPure(ins);
  const ny = buildNyIt201({ taxpayer: taxpayer("single", "NY"), ret, inputs: ins });
  check("S7 line 39 NYS tax = $4,951.75 (hand-calc)", money(findLine(ny, "39", "resident tax")), 4951.75);
  const yonkers = findLine(ny, "55");
  check("S7 line 55 Yonkers surcharge = $829.42 (16.75% of net NYS tax)", money(yonkers), 829.42);
  checkStr("S7 Yonkers note cites the 16.75% surcharge", yonkers?.note, "16.75%");
  checkStr("S7 single-state tie-out reads 'ties' (local is a separate engine line)", String(findByLabel(ny, "ties to engine total state tax")?.value), "ties");
}

// ════════════════════════════════════════════════════════════════════════════
// S8 — TX resident with NY-source wages ($60k TX + $60k NY W-2s)
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (IT-203 as-if-resident income-percentage method):
//   tax-as-if-resident on total AGI 120,000: NY taxable = 120,000 − 8,000 = 112,000.
//     340 + 144 + 115.50 + 3,671.25 + 6% × (112,000 − 80,650 = 31,350 → 1,881)
//     = 6,151.75
//   NY-source fraction = 60,000 / 120,000 = 0.5
//   NY NR tax = 6,151.75 × 0.5 = $3,075.88
{
  const ins = inputs(
    { filingStatus: "single", state: "TX", taxYear: 2024 },
    [
      { taxYear: 2024, wagesBox1: 60000, stateCode: "TX" },
      { taxYear: 2024, wagesBox1: 60000, stateCode: "NY" },
    ],
  );
  const ret = computeTaxReturnPure(ins);
  const ny = buildNyIt201({ taxpayer: taxpayer("single", "TX"), ret, inputs: ins });
  checkTrue("S8 buildNyIt201 applicable via NY NR entry", ny != null);
  check("S8 NY-source income row = $60,000", money(findByLabel(ny, "NY-source income")), 60000);
  const nr = findByLabel(ny, "NY nonresident tax");
  check("S8 NY NR tax row = $3,075.88 (hand-calc, IT-203 ratio)", money(nr), 3075.88);
  checkStr("S8 NR note cites the IT-203 method", nr?.note, "IT-203");
  check("S8 line 46 total = NR row (additive structure)", money(findLine(ny, "46")), 3075.88);
  checkTrue("S8 buildCa540 returns null", buildCa540({ taxpayer: taxpayer("single", "TX"), ret, inputs: ins }) == null);
}

// ════════════════════════════════════════════════════════════════════════════
// S9 — Part-year mover NY → FL (change 2024-07-01), $100k W-2 (FL-sourced)
// ════════════════════════════════════════════════════════════════════════════
// Hand-calc (engine part-year model; 182 NY days of 366):
//   NY-period AGI   = 100,000 × 182/366 = 49,726.776
//   prorated stdDed = 8,000 × 182/366   =  3,978.142
//   NY taxable      = 49,726.776 − 3,978.142 = 45,748.634
//   340 + 144 + 115.50 + 5.5% × (45,748.634 − 13,900 = 31,848.634 → 1,751.67)
//   = $2,351.17
{
  const ins = inputs(
    {
      filingStatus: "single", state: "FL", taxYear: 2024,
      residencyChangedInYear: true, formerState: "NY", residencyChangeDate: "2024-07-01",
    },
    [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
  );
  const ret = computeTaxReturnPure(ins);
  const ny = buildNyIt201({ taxpayer: taxpayer("single", "FL"), ret, inputs: ins });
  checkTrue("S9 buildNyIt201 applicable via formerStateCode NY", ny != null);
  const py = findByLabel(ny, "part-year resident tax");
  check("S9 NY part-year tax row = $2,351.17 (hand-calc)", money(py), 2351.17);
  checkStr("S9 part-year row carries the IT-203 note", py?.note, "IT-203");
  check("S9 line 46 total NY tax = $2,351.17 (additive structure)", money(findLine(ny, "46")), 2351.17);
}

// ════════════════════════════════════════════════════════════════════════════
// S10 — Null gates: TX-only resident → BOTH builders return null
// ════════════════════════════════════════════════════════════════════════════
{
  const ins = inputs(
    { filingStatus: "single", state: "TX", taxYear: 2024 },
    [{ taxYear: 2024, wagesBox1: 80000, stateCode: "TX" }],
  );
  const ret = computeTaxReturnPure(ins);
  checkTrue("S10 buildCa540 null for TX-only filer", buildCa540({ taxpayer: taxpayer("single", "TX"), ret, inputs: ins }) == null);
  checkTrue("S10 buildNyIt201 null for TX-only filer", buildNyIt201({ taxpayer: taxpayer("single", "TX"), ret, inputs: ins }) == null);
}

console.log(`\nT2.1 workpaper state-ca-ny tests (CA 540 + NY IT-201):`);
if (FAIL.length > 0) FAIL.forEach((f) => console.log(`  ${f}`));
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
