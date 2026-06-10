/**
 * T2.1 — Workpaper builders: Schedule D + Form 8949 (group "schedule-d-8949").
 *
 * Hand-calc'd against the TY2024 official Schedule D / Form 8949 layout +
 * IRC §1211/§1212 netting, the Pub 550 capital-loss-carryover worksheet
 * (short losses consumed first against the $3,000/$1,500-MFS limit), §121
 * (Pub 523 $250k/$500k exclusion), and the §1(h) 25%/28% character buckets
 * (Schedule D lines 18/19 worksheets).
 *
 * Pure engine + pure builders; no API required.
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-workpaper-schedule-d-8949-tests.ts
 */
import {
  computeTaxReturnPure,
  type CapitalTransactionFact,
  type TaxReturnInputs,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { buildScheduleD } from "../../artifacts/api-server/src/lib/forms/scheduleDSpec";
import { buildForm8949 } from "../../artifacts/api-server/src/lib/forms/form8949Spec";
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
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected true, got false`);
}
function checkStr(label: string, actual: string | null | undefined, frag: string): void {
  if ((actual ?? "").includes(frag)) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: "${actual}" does not contain "${frag}"`);
}

// ── helpers ──────────────────────────────────────────────────────────────────

const allLines = (inst: FormInstance): FormLine[] => inst.parts.flatMap((p) => p.lines);
const findLine = (inst: FormInstance, lineNo: string, frag?: string): FormLine | undefined =>
  allLines(inst).find((l) => l.line === lineNo && (!frag || l.label.includes(frag)));
const findByLabel = (inst: FormInstance, frag: string): FormLine | undefined =>
  allLines(inst).find((l) => l.label.includes(frag));
const num = (l: FormLine | undefined): number => (typeof l?.value === "number" ? l.value : NaN);
/** checkLine rows render "✓ <label>" + value "ties" when they tie. */
const tiesOk = (l: FormLine | undefined): boolean => l != null && l.label.startsWith("✓") && l.value === "ties";

function makeInputs(opts: {
  filingStatus?: string;
  wages?: number;
  form1099s?: TaxReturnInputs["form1099s"];
  adjustments?: Array<{ adjustmentType: string; amount: number }>;
  capitalTransactions?: CapitalTransactionFact[];
  scheduleK1?: TaxReturnInputs["scheduleK1"];
} = {}): TaxReturnInputs {
  return {
    client: {
      filingStatus: opts.filingStatus ?? "single",
      state: "FL",
      taxYear: 2024,
      taxpayerAge: 45,
      dependentsUnder17: 0,
      otherDependents: 0,
    },
    w2s: [{ taxYear: 2024, wagesBox1: opts.wages ?? 60000, stateCode: "FL" }],
    form1099s: opts.form1099s ?? [],
    adjustments: (opts.adjustments ?? []).map((a) => ({ ...a, isApplied: true })),
    capitalTransactions: opts.capitalTransactions,
    scheduleK1: opts.scheduleK1,
    taxYear: 2024,
  };
}

function makeCtx(inputs: TaxReturnInputs): FormBuildContext {
  const taxpayer: WorkpaperTaxpayer = {
    firstName: "Test",
    lastName: "Client",
    filingStatus: inputs.client.filingStatus,
    state: inputs.client.state ?? "FL",
  };
  return { taxpayer, ret: computeTaxReturnPure(inputs), inputs };
}

const txn = (t: Omit<CapitalTransactionFact, "taxYear"> & { taxYear?: number }): CapitalTransactionFact => ({
  taxYear: 2024,
  ...t,
});

function scenario(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    FAIL.push(`✗ ${name}: threw ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── S1 — Per-transaction mixed lots (3 ST + 2 LT + broker-W wash + DIV 2a) ──
//
// Lots (Form 8949 col (h) = proceeds − basis + adjustment):
//   Box A  AAPL  15,000 − 10,000           = +5,000
//   Box B  MSFT   6,000 −  9,000 + 1,000(W) = −2,000  (broker-reported partial
//          wash: $1,000 of the $3,000 loss disallowed via code W, §1091(a))
//   Box C  ORCL   3,000 −  2,000           = +1,000
//   Box D  VTI   80,000 − 50,000           = +30,000
//   Box E  GOOGL 20,000 − 30,000           = −10,000
//   (+ a 2023 lot that must be filtered out of the TY2024 forms)
//   1099-DIV box 2a capital-gain distribution = 2,000 (Schedule D line 13)
//
// Hand-calc (Schedule D, IRC §1211/§1212):
//   L1b = +5,000; L2 = −2,000; L3 = +1,000 → L7 = +4,000
//   L8b = +30,000; L9 = −10,000; L13 = +2,000 → L15 = +22,000
//   L16 = L7 + L15 = +26,000 (a net gain — no §1211(b) limit, no carryforward)
//   L17 = Yes (15 and 16 both gains); L18 = L19 = 0 → L20 = Yes (QD&CGT wksht)
scenario("S1", () => {
  const inputs = makeInputs({
    capitalTransactions: [
      txn({ description: "AAPL", dateAcquired: "2024-02-01", dateSold: "2024-05-01", proceeds: "15000", costBasis: "10000", formBox: "A" }),
      txn({ description: "MSFT", dateAcquired: "2024-03-01", dateSold: "2024-07-10", proceeds: 6000, costBasis: 9000, formBox: "B", adjustmentCode: "W", adjustmentAmount: 1000 }),
      txn({ description: "ORCL", dateAcquired: "2024-04-01", dateSold: "2024-08-15", proceeds: 3000, costBasis: 2000, formBox: "C" }),
      txn({ description: "VTI", dateAcquired: "2020-01-15", dateSold: "2024-06-01", proceeds: 80000, costBasis: 50000, formBox: "D" }),
      txn({ description: "GOOGL", dateAcquired: "2019-05-20", dateSold: "2024-03-10", proceeds: 20000, costBasis: 30000, formBox: "E" }),
      txn({ taxYear: 2023, description: "OLD2023", proceeds: 1999, costBasis: 1000, formBox: "A" }),
    ],
    form1099s: [{ taxYear: 2024, formType: "div", totalCapitalGainDistribution: 2000 }],
  });
  const ctx = makeCtx(inputs);
  const ret = ctx.ret;

  // Engine ground truth (hand-calc'd above)
  check("S1 engine netCapitalGainLoss = 26,000", ret.netCapitalGainLoss, 26000);
  check("S1 engine ST bucket = 4,000", ret.form1099Summary.shortTermCapitalGains, 4000);
  check("S1 engine LT bucket (incl. DIV 2a) = 22,000", ret.form1099Summary.longTermCapitalGains, 22000);
  check("S1 engine detected no auto wash sales (broker W honored)", ret.washSalesDetected, 0);
  check("S1 engine capitalLossDeducted = 0 (net gain year)", ret.capitalLossDeducted, 0);

  const d = buildScheduleD(ctx);
  checkTrue("S1 Schedule D applicable", d != null);
  if (!d) return;
  check("S1 D line 1b (Box A) = +5,000", num(findLine(d, "1b")), 5000);
  check("S1 D line 2 (Box B, W-adjusted) = −2,000", num(findLine(d, "2")), -2000);
  check("S1 D line 3 (Box C) = +1,000", num(findLine(d, "3")), 1000);
  check("S1 D line 7 net short-term = +4,000", num(findLine(d, "7")), 4000);
  check("S1 D line 8b (Box D) = +30,000", num(findLine(d, "8b")), 30000);
  check("S1 D line 9 (Box E) = −10,000", num(findLine(d, "9")), -10000);
  check("S1 D line 13 distributions = +2,000", num(findLine(d, "13")), 2000);
  check("S1 D line 15 net long-term = +22,000", num(findLine(d, "15")), 22000);
  check("S1 D line 16 = +26,000", num(findLine(d, "16")), 26000);
  checkTrue("S1 D line 16 tie-out ✓", tiesOk(findByLabel(d, "Line 16 ties engine")));
  checkTrue("S1 D Part I box-totals tie-out ✓", tiesOk(findByLabel(d, "Part I box totals tie engine")));
  checkTrue("S1 D Part II box-totals tie-out ✓", tiesOk(findByLabel(d, "Part II box totals tie engine")));
  checkTrue("S1 D no wash-sale disclosure (none auto-detected)", findByLabel(d, "Wash sales auto-detected") == null);
  checkTrue("S1 D no line 21 (net gain year)", findLine(d, "21") == null);
  // Additive structure: Part I numbered components sum to line 7; Part II to line 15.
  check("S1 D Part I additive (1b+2+3 = 7)", num(findLine(d, "1b")) + num(findLine(d, "2")) + num(findLine(d, "3")), num(findLine(d, "7")));
  check("S1 D Part II additive (8b+9+13 = 15)", num(findLine(d, "8b")) + num(findLine(d, "9")) + num(findLine(d, "13")), num(findLine(d, "15")));
  checkTrue("S1 D line 17 both-gains = true", findLine(d, "17")?.value === true);
  check("S1 D line 18 (no 28%-rate gain) = 0", num(findLine(d, "18")), 0);
  check("S1 D line 19 (no §1250 gain) = 0", num(findLine(d, "19")), 0);
  checkTrue("S1 D line 20 both-zero = true", findLine(d, "20")?.value === true);
  checkStr("S1 D line 20 routes to QD&CGT worksheet", findLine(d, "20")?.note, "Qualified Dividends");
  checkTrue("S1 D 2023 lot filtered out", findByLabel(d, "OLD2023") == null);

  const f = buildForm8949(ctx);
  checkTrue("S1 8949 applicable", f != null);
  if (!f) return;
  const p1Lots = f.parts[0].lines.filter((l) => l.line === "1");
  const p2Lots = f.parts[1].lines.filter((l) => l.line === "1");
  check("S1 8949 Part I has 3 lot rows", p1Lots.length, 3);
  check("S1 8949 Part II has 2 lot rows", p2Lots.length, 2);
  const msft = findByLabel(f, "MSFT");
  checkStr("S1 8949 MSFT label shows wash code", msft?.label, "code W");
  checkStr("S1 8949 MSFT label shows adjustment", msft?.label, "adj");
  check("S1 8949 MSFT lot (h) = −2,000", num(msft), -2000);
  check("S1 8949 Box A totals = +5,000", num(findLine(f, "2", "Box A totals")), 5000);
  check("S1 8949 Box D totals = +30,000", num(findLine(f, "2", "Box D totals")), 30000);
  check("S1 8949 Part I total = +4,000", num(findByLabel(f, "Part I (short-term) total")), 4000);
  check("S1 8949 Part II total = +20,000 (excl. DIV 2a)", num(findByLabel(f, "Part II (long-term) total")), 20000);
  checkTrue("S1 8949 ST tie-out ✓", tiesOk(findByLabel(f, "Part I short-term total ties engine")));
  checkTrue("S1 8949 LT tie-out ✓", tiesOk(findByLabel(f, "Part II long-term total ties engine")));
  checkTrue("S1 8949 2023 lot filtered out", findByLabel(f, "OLD2023") == null);
});

// ── S2 — Net loss year, $3,000 limit + Pub 550 character-split carryforward ──
//
// Lots: Box A −2,000 (1,000 − 3,000); Box D −9,000 (5,000 − 14,000).
// Prior-year carryovers in: short 1,000 (line 6), long 2,000 (line 14).
//
// Hand-calc (Pub 550 / Schedule D instructions Capital Loss Carryover Wksht):
//   L7  = −2,000 − 1,000 = −3,000
//   L15 = −9,000 − 2,000 = −11,000
//   L16 = −14,000 → L21 = −3,000 (single, §1211(b) $3,000 limit)
//   Carryover: the $3,000 allowed loss consumes SHORT losses first →
//     short 3,000 − 3,000 = 0 carries; long 11,000 − 0 = 11,000 carries (long
//     character preserved).
scenario("S2", () => {
  const inputs = makeInputs({
    wages: 50000,
    capitalTransactions: [
      txn({ description: "LOSS-ST", dateAcquired: "2024-01-05", dateSold: "2024-06-20", proceeds: 1000, costBasis: 3000, formBox: "A" }),
      txn({ description: "LOSS-LT", dateAcquired: "2019-02-10", dateSold: "2024-08-01", proceeds: 5000, costBasis: 14000, formBox: "D" }),
    ],
    adjustments: [
      { adjustmentType: "capital_loss_carryforward_short", amount: 1000 },
      { adjustmentType: "capital_loss_carryforward_long", amount: 2000 },
    ],
  });
  const ctx = makeCtx(inputs);
  const ret = ctx.ret;

  check("S2 engine netCapitalGainLoss = −14,000", ret.netCapitalGainLoss, -14000);
  check("S2 engine capitalLossDeducted = 3,000", ret.capitalLossDeducted, 3000);
  check("S2 engine cfShort out = 0 (short consumed first)", ret.capitalLossCarryforwardShort, 0);
  check("S2 engine cfLong out = 11,000", ret.capitalLossCarryforwardLong, 11000);

  const d = buildScheduleD(ctx);
  checkTrue("S2 Schedule D applicable", d != null);
  if (!d) return;
  check("S2 D line 6 carryover in = −1,000", num(findLine(d, "6")), -1000);
  check("S2 D line 7 = −3,000", num(findLine(d, "7")), -3000);
  check("S2 D line 14 carryover in = −2,000", num(findLine(d, "14")), -2000);
  check("S2 D line 15 = −11,000", num(findLine(d, "15")), -11000);
  check("S2 D line 16 = −14,000", num(findLine(d, "16")), -14000);
  checkTrue("S2 D line 16 tie-out ✓", tiesOk(findByLabel(d, "Line 16 ties engine")));
  check("S2 D line 21 allowed loss = −3,000", num(findLine(d, "21")), -3000);
  checkStr("S2 D line 21 note cites the $3,000 limit", findLine(d, "21")?.note, "$3,000");
  check("S2 D 1040-line-7 flow row = −3,000", num(findByLabel(d, "Flows to Form 1040 line 7")), -3000);
  checkTrue("S2 D line 17 absent (loss year)", findLine(d, "17") == null);
  checkTrue("S2 D line 22 rendered, no qualified dividends", findLine(d, "22")?.value === false);
  check("S2 D long carryforward-out row = 11,000", num(findByLabel(d, "Long-term capital loss carryforward to next year")), 11000);
  checkTrue("S2 D short carryforward-out row absent (0)", findByLabel(d, "Short-term capital loss carryforward to next year") == null);
  checkStr("S2 D carryforward note cites Pub 550 character rule", findByLabel(d, "Long-term capital loss carryforward to next year")?.note, "Pub 550");

  const f = buildForm8949(ctx);
  checkTrue("S2 8949 applicable", f != null);
  if (!f) return;
  checkTrue("S2 8949 ST tie-out ✓ (−2,000)", tiesOk(findByLabel(f, "Part I short-term total ties engine")));
  checkTrue("S2 8949 LT tie-out ✓ (−9,000)", tiesOk(findByLabel(f, "Part II long-term total ties engine")));
});

// ── S2b — Same loss year, MFS: $1,500 limit splits the short carryforward ──
//
// Hand-calc (Pub 550, §1211(b) MFS $1,500):
//   L21 = −1,500. Short losses consumed first: 3,000 − 1,500 = 1,500 carries
//   SHORT; long carries 11,000 untouched.
scenario("S2b", () => {
  const inputs = makeInputs({
    filingStatus: "married_filing_separately",
    wages: 50000,
    capitalTransactions: [
      txn({ description: "LOSS-ST", dateAcquired: "2024-01-05", dateSold: "2024-06-20", proceeds: 1000, costBasis: 3000, formBox: "A" }),
      txn({ description: "LOSS-LT", dateAcquired: "2019-02-10", dateSold: "2024-08-01", proceeds: 5000, costBasis: 14000, formBox: "D" }),
    ],
    adjustments: [
      { adjustmentType: "capital_loss_carryforward_short", amount: 1000 },
      { adjustmentType: "capital_loss_carryforward_long", amount: 2000 },
    ],
  });
  const ctx = makeCtx(inputs);
  const ret = ctx.ret;

  check("S2b engine capitalLossDeducted = 1,500 (MFS)", ret.capitalLossDeducted, 1500);
  check("S2b engine cfShort out = 1,500", ret.capitalLossCarryforwardShort, 1500);
  check("S2b engine cfLong out = 11,000", ret.capitalLossCarryforwardLong, 11000);

  const d = buildScheduleD(ctx);
  checkTrue("S2b Schedule D applicable", d != null);
  if (!d) return;
  check("S2b D line 21 = −1,500", num(findLine(d, "21")), -1500);
  checkStr("S2b D line 21 note cites the MFS $1,500 limit", findLine(d, "21")?.note, "$1,500");
  check("S2b D short carryforward-out = 1,500", num(findByLabel(d, "Short-term capital loss carryforward to next year")), 1500);
  check("S2b D long carryforward-out = 11,000", num(findByLabel(d, "Long-term capital loss carryforward to next year")), 11000);
  checkTrue("S2b D line 16 tie-out ✓", tiesOk(findByLabel(d, "Line 16 ties engine")));
});

// ── S3 — Special-gain stack: §121 remainder + §1250 gainClass + collectible ──
//
// Lots (both Box F, long-term):
//   Rental building: 300,000 − 220,000 = +80,000, gainClass section1250,
//     explicit unrecaptured1250Amount 50,000 (partial recapture; the other
//     30,000 is plain 0/15/20 appreciation)
//   Gold coin collection: 30,000 − 18,000 = +12,000, gainClass collectible
// Adjustment: home_sale_gross_gain_primary_residence 450,000.
//
// Hand-calc:
//   §121 (Pub 523, single): exclusion = min(450,000, 250,000) = 250,000 →
//     taxable remainder 200,000 joins LT.
//   L10 (Box F) = 92,000; L15 = 92,000 + 200,000 = 292,000; L16 = 292,000.
//   Line 18 (28%-Rate Gain Wksht) = 12,000; line 19 (Unrecaptured §1250
//   Wksht) = 50,000 — both CHARACTER SUBSETS of the 292,000, never additive
//   (no LT loss → no absorption; both under the net-LTCG bound).
scenario("S3", () => {
  const inputs = makeInputs({
    wages: 100000,
    capitalTransactions: [
      txn({ description: "Rental building 123 Main St", dateAcquired: "2015-03-01", dateSold: "2024-09-30", proceeds: 300000, costBasis: 220000, formBox: "F", gainClass: "section1250", unrecaptured1250Amount: 50000 }),
      txn({ description: "Gold coin collection", dateAcquired: "2018-01-01", dateSold: "2024-11-15", proceeds: 30000, costBasis: 18000, formBox: "F", gainClass: "collectible" }),
    ],
    adjustments: [{ adjustmentType: "home_sale_gross_gain_primary_residence", amount: 450000 }],
  });
  const ctx = makeCtx(inputs);
  const ret = ctx.ret;

  check("S3 engine homeSaleTaxableGain = 200,000", ret.homeSaleTaxableGain, 200000);
  check("S3 engine unrecapturedSection1250Gain = 50,000", ret.unrecapturedSection1250Gain, 50000);
  check("S3 engine collectibles28RateGain = 12,000", ret.collectibles28RateGain, 12000);
  check("S3 engine netCapitalGainLoss = 292,000", ret.netCapitalGainLoss, 292000);

  const d = buildScheduleD(ctx);
  checkTrue("S3 Schedule D applicable", d != null);
  if (!d) return;
  check("S3 D line 10 (Box F) = +92,000", num(findLine(d, "10")), 92000);
  const s121 = findByLabel(d, "§121 home-sale taxable remainder");
  check("S3 D §121 remainder row = 200,000", num(s121), 200000);
  checkStr("S3 D §121 note shows the exclusion", s121?.note, "$250,000.00");
  check("S3 D line 15 = 292,000 (subsets NOT double-added)", num(findLine(d, "15")), 292000);
  check("S3 D line 16 = 292,000", num(findLine(d, "16")), 292000);
  checkTrue("S3 D line 16 tie-out ✓", tiesOk(findByLabel(d, "Line 16 ties engine")));
  checkTrue("S3 D line 17 both-gains = true", findLine(d, "17")?.value === true);
  check("S3 D line 18 28%-rate gain = 12,000", num(findLine(d, "18")), 12000);
  check("S3 D line 19 unrecaptured §1250 = 50,000", num(findLine(d, "19")), 50000);
  checkStr("S3 D line 18 note: subset, not additive", findLine(d, "18")?.note, "SUBSET");
  checkStr("S3 D line 19 note: flat 25%", findLine(d, "19")?.note, "25%");
  checkTrue("S3 D line 20 both-zero = false", findLine(d, "20")?.value === false);
  checkStr("S3 D line 20 routes to Schedule D Tax Worksheet", findLine(d, "20")?.note, "Schedule D Tax Worksheet");
  checkTrue("S3 D subset arithmetic: 18 + 19 ≤ 16", num(findLine(d, "18")) + num(findLine(d, "19")) <= num(findLine(d, "16")));

  const f = buildForm8949(ctx);
  checkTrue("S3 8949 applicable", f != null);
  if (!f) return;
  check("S3 8949 Part II total = 92,000", num(findByLabel(f, "Part II (long-term) total")), 92000);
  checkTrue("S3 8949 LT tie-out ✓", tiesOk(findByLabel(f, "Part II long-term total ties engine")));
  const bldg = findByLabel(f, "Rental building");
  checkStr("S3 8949 §1250 lot note names the class", bldg?.note, "section1250");
  checkStr("S3 8949 §1250 lot note routes to line 19", bldg?.note, "line 19");
  checkStr("S3 8949 collectible lot note routes to 28% bucket", findByLabel(f, "Gold coin collection")?.note, "28%");
  checkTrue("S3 8949 Part I placeholder (no ST lots)", findByLabel(f, "No short-term transactions") != null);
});

// ── S4 — Null gates: wages-only return has no capital activity ──
scenario("S4", () => {
  const ctx = makeCtx(makeInputs({ wages: 80000 }));
  checkTrue("S4 Schedule D not applicable → null", buildScheduleD(ctx) === null);
  checkTrue("S4 Form 8949 not applicable → null", buildForm8949(ctx) === null);
});

// ── S5 — Aggregate 1099-B path + K-1 box 8/9a + DIV 2a; 8949 gate ──
//
// 1099-B aggregates: ST +4,000, LT +6,000. 1099-DIV box 2a = 1,000.
// K-1 (partnership): box 8 ST +500, box 9a LT +1,500.
//
// Hand-calc:
//   L1b (aggregate) = 4,000; L5 = 500 → L7 = 4,500
//   L8b (aggregate, excl. distributions) = 6,000; L12 = 1,500; L13 = 1,000
//     → L15 = 8,500
//   L16 = 13,000. No per-lot rows → Form 8949 returns null.
scenario("S5", () => {
  const inputs = makeInputs({
    form1099s: [
      { taxYear: 2024, formType: "b", shortTermGainLoss: 4000, longTermGainLoss: 6000 },
      { taxYear: 2024, formType: "div", totalCapitalGainDistribution: 1000 },
    ],
    scheduleK1: [
      {
        taxYear: 2024,
        entityName: "Fund LP",
        entityType: "partnership",
        activityType: "passive",
        netShortTermCapitalGain: 500,
        netLongTermCapitalGain: 1500,
      },
    ],
  });
  const ctx = makeCtx(inputs);
  const ret = ctx.ret;

  check("S5 engine netCapitalGainLoss = 13,000", ret.netCapitalGainLoss, 13000);
  check("S5 engine K-1 ST = 500", ret.scheduleK1.totalShortTermCapitalGain, 500);
  check("S5 engine K-1 LT = 1,500", ret.scheduleK1.totalLongTermCapitalGain, 1500);

  const d = buildScheduleD(ctx);
  checkTrue("S5 Schedule D applicable", d != null);
  if (!d) return;
  const agg1b = findLine(d, "1b");
  check("S5 D line 1b broker aggregate = 4,000", num(agg1b), 4000);
  checkStr("S5 D line 1b labeled as aggregate", agg1b?.label, "aggregate");
  check("S5 D line 5 K-1 short-term = 500", num(findLine(d, "5")), 500);
  check("S5 D line 7 = 4,500", num(findLine(d, "7")), 4500);
  check("S5 D line 8b broker aggregate = 6,000 (excl. line 13)", num(findLine(d, "8b")), 6000);
  check("S5 D line 12 K-1 long-term = 1,500", num(findLine(d, "12")), 1500);
  check("S5 D line 13 distributions = 1,000", num(findLine(d, "13")), 1000);
  check("S5 D line 15 = 8,500", num(findLine(d, "15")), 8500);
  check("S5 D Part II additive (8b+12+13 = 15)", num(findLine(d, "8b")) + num(findLine(d, "12")) + num(findLine(d, "13")), num(findLine(d, "15")));
  check("S5 D line 16 = 13,000", num(findLine(d, "16")), 13000);
  checkTrue("S5 D line 16 tie-out ✓", tiesOk(findByLabel(d, "Line 16 ties engine")));
  checkTrue("S5 D no per-box tie-outs in aggregate mode", findByLabel(d, "box totals tie engine") == null);
  checkTrue("S5 Form 8949 null without per-lot rows", buildForm8949(ctx) === null);
});

// ── S6 — ENGINE-auto-detected §1091 wash sale + an unrecognized-box row ──
//
// NVDA loss: acquired 2024-01-10, sold 2024-06-01, 8,000 − 10,000 = −2,000
//   (no broker W). NVDA replacement: acquired 2024-06-15 (inside the 61-day
//   §1091(a) window), sold 2024-09-01, 12,000 − 9,000 = +3,000.
// ZZZ Corp: formBox "X" (unrecognized) +500 — the engine EXCLUDES it.
//
// Hand-calc (§1091(a)/(d)):
//   Engine disallows the full 2,000 loss (no share quantities → full wash),
//   adds it to the replacement's basis → adjusted lots: 0 and +1,000.
//   ST bucket = 1,000; raw broker-entered sum = −2,000 + 3,000 = +1,000 —
//   the combined total is INVARIANT (replacement sold in-year). L16 = 1,000.
//   Holding tack (§1223(3)): 143 + 78 days held = 221 < 366 → no box flip.
scenario("S6", () => {
  const inputs = makeInputs({
    capitalTransactions: [
      txn({ description: "NVDA", dateAcquired: "2024-01-10", dateSold: "2024-06-01", proceeds: 8000, costBasis: 10000, formBox: "A" }),
      txn({ description: "NVDA", dateAcquired: "2024-06-15", dateSold: "2024-09-01", proceeds: 12000, costBasis: 9000, formBox: "A" }),
      txn({ description: "ZZZ Corp", dateAcquired: "2024-02-01", dateSold: "2024-03-01", proceeds: 1000, costBasis: 500, formBox: "X" }),
    ],
  });
  const ctx = makeCtx(inputs);
  const ret = ctx.ret;

  check("S6 engine washSalesDetected = 1", ret.washSalesDetected, 1);
  check("S6 engine washSaleLossDisallowed = 2,000", ret.washSaleLossDisallowed, 2000);
  check("S6 engine netCapitalGainLoss = 1,000 (junk box excluded)", ret.netCapitalGainLoss, 1000);

  const d = buildScheduleD(ctx);
  checkTrue("S6 Schedule D applicable", d != null);
  if (!d) return;
  check("S6 D line 1b raw Box A = +1,000 (−2,000 + 3,000)", num(findLine(d, "1b")), 1000);
  check("S6 D line 7 = 1,000 (engine total)", num(findLine(d, "7")), 1000);
  check("S6 D line 16 = 1,000", num(findLine(d, "16")), 1000);
  checkTrue("S6 D line 16 tie-out ✓", tiesOk(findByLabel(d, "Line 16 ties engine")));
  checkTrue("S6 D per-box ST tie-out suppressed under auto-wash", findByLabel(d, "Part I box totals tie engine") == null);
  checkTrue("S6 D combined invariant tie-out ✓", tiesOk(findByLabel(d, "Combined raw 8949 total ties engine")));
  check("S6 D wash count row = 1", num(findByLabel(d, "Wash sales auto-detected")), 1);
  const washAmt = findByLabel(d, "Capital loss disallowed by auto-detection");
  check("S6 D wash disallowed row = 2,000", num(washAmt), 2000);
  checkStr("S6 D wash note cites §1091(d) basis add", washAmt?.note, "1091(d)");
  const junk = findByLabel(d, "unrecognized Form 8949 box");
  checkTrue("S6 D unclassified-row alarm present + emphasized", junk != null && junk.emphasis === true);
  checkStr("S6 D unclassified alarm shows the excluded gain", junk?.label, "$500.00");

  const f = buildForm8949(ctx);
  checkTrue("S6 8949 applicable", f != null);
  if (!f) return;
  check("S6 8949 Part I has 2 lot rows", f.parts[0].lines.filter((l) => l.line === "1").length, 2);
  check("S6 8949 Part I total = +1,000 (raw)", num(findByLabel(f, "Part I (short-term) total")), 1000);
  checkTrue("S6 8949 per-part tie-outs suppressed under auto-wash", findByLabel(f, "Part I short-term total ties engine") == null);
  checkTrue("S6 8949 combined invariant tie-out ✓", tiesOk(findByLabel(f, "Combined Part I + II total ties engine")));
  check("S6 8949 wash count row = 1", num(findByLabel(f, "Wash sales auto-detected")), 1);
  check("S6 8949 wash disallowed row = 2,000", num(findByLabel(f, "Capital loss disallowed by auto-detection")), 2000);
  const zzz = findByLabel(f, "ZZZ Corp");
  check("S6 8949 unclassified ZZZ row = +500", num(zzz), 500);
  checkStr("S6 8949 unclassified row shows its box", zzz?.label, 'box "X"');
  checkTrue("S6 8949 unclassified EXCLUDED disclosure present", findByLabel(f, "EXCLUDED from engine totals") != null);
});

// ── S7 — 40-row cap: 45 ST lots of +100 each ──
//
// Hand-calc: 45 × (1,100 − 1,000) = +4,500 = L1b = L7 = L16. Form 8949 shows
// 40 lot rows + "+ 5 more transactions — see app"; totals cover ALL 45 rows.
scenario("S7", () => {
  const lots: CapitalTransactionFact[] = [];
  for (let i = 1; i <= 45; i++) {
    lots.push(
      txn({ description: `LOT-${i}`, dateAcquired: "2024-01-02", dateSold: "2024-03-01", proceeds: 1100, costBasis: 1000, formBox: "A" }),
    );
  }
  const ctx = makeCtx(makeInputs({ capitalTransactions: lots }));
  check("S7 engine netCapitalGainLoss = 4,500", ctx.ret.netCapitalGainLoss, 4500);

  const d = buildScheduleD(ctx);
  checkTrue("S7 Schedule D applicable", d != null);
  if (d) {
    check("S7 D line 1b (45 lots) = 4,500", num(findLine(d, "1b")), 4500);
    checkStr("S7 D line 1b shows the lot count", findLine(d, "1b")?.label, "45 lots");
    checkTrue("S7 D line 16 tie-out ✓", tiesOk(findByLabel(d, "Line 16 ties engine")));
  }

  const f = buildForm8949(ctx);
  checkTrue("S7 8949 applicable", f != null);
  if (!f) return;
  check("S7 8949 Part I capped at 40 lot rows", f.parts[0].lines.filter((l) => l.line === "1").length, 40);
  checkStr("S7 8949 overflow row present", findByLabel(f, "more transaction")?.label, "+ 5 more transactions — see app");
  check("S7 8949 Box A totals cover ALL 45 rows = 4,500", num(findLine(f, "2", "Box A totals")), 4500);
  check("S7 8949 Part I total = 4,500", num(findByLabel(f, "Part I (short-term) total")), 4500);
  checkTrue("S7 8949 ST tie-out ✓", tiesOk(findByLabel(f, "Part I short-term total ties engine")));
});

// ── summary ──────────────────────────────────────────────────────────────────
for (const p of PASS) console.log(p);
for (const f of FAIL) console.error(f);
console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
