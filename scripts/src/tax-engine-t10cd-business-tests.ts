/**
 * T1.0 groups (c)+(d) — business/QBI/losses + cross-cutting/K-1 fixes
 * (audit 2026-06-11; fed-business.md + cross-cutting.md findings).
 *
 * Hand-calc'd regression pins for:
 *   A. §461(l) Form 461 NETTING (aggregate T/B income offsets losses — the
 *      +$400k/−$700k → $0 addback repro) + the TY2026 $256k/$512k thresholds
 *      (Rev. Proc. 2025-32 §4.31 — OBBBA re-based the indexation LOWER).
 *   B. §172 NOL moved ABOVE THE LINE (Schedule 1 line 8a → AGI), with the 80%
 *      cap still measured on taxable income computed WITHOUT the NOL/§199A per
 *      §172(a)(2)(B)(ii) — and a MAGI consumer (IRA phase-out) seeing the
 *      lower post-NOL AGI per Pub 590-A.
 *   C. QBI auto-default: SEHI subtraction (Treas. Reg. §1.199A-3(b)(1)(vi)),
 *      §199A(c)(2) negative-QBI netting, and the qualified-business-LOSS
 *      carryforward round-trip (§199A(c)(2)(B); Form 8995 lines 2/3/16).
 *   D. OBBBA Schedule 1-A MFS bar: §224(f) tips + §225(e) overtime + the
 *      §151(d)(5) senior deduction require a JOINT return for married filers
 *      (Notice 2025-69); §163(h)(4) car-loan interest has NO such bar.
 *   E. §1231(c) lookback ordering per Notice 97-59 / Reg. §1.453-12 Ex. 3:
 *      the recharacterized ordinary amount absorbs the 28% group first (none
 *      modeled), THEN the unrecaptured-§1250 25% pool, then 0/15/20 — on both
 *      the form4797 path and the live-app capitalTransactions gainClass=
 *      "section1250" channel (T1.0d #16 — previously a live-app no-op).
 *   F. §179 trio: (i) carryover re-limited by the deduction-year DOLLAR cap
 *      (Reg. §1.179-3(a)); (ii) a DOLLAR-cap-disallowed current-year election
 *      is NOT a §179 carryover — its basis recovers through bonus/MACRS
 *      (Reg. §1.179-3(c)(1)); (iii) the above-the-line income limit includes
 *      W-2 wages (Reg. §1.179-2(c)(6)(iv); Form 4562 line 11).
 *   G. K-1 partner SE earnings are §32(c)(2)(A)(ii) EARNED INCOME →
 *      EITC/ACTC parity with an economically-identical sole prop (the $8,825
 *      swing repro).
 *   H. K-1 Box 2 QBI gated on the §469-allowed fraction (§1.199A-3(b)(1)(iv)).
 *   I. K-1 Box 6a/6b netting (6b qualified ⊂ 6a ordinary, like 1099-DIV 1a/1b).
 *   J. Negative carryforward entries floored (no phantom income).
 *   K. NaN/Infinity COUNT-field totality (engine never throws / emits NaN).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-t10cd-business-tests.ts
 */
import {
  computeTaxReturnPure,
  type TaxReturnInputs,
  type AdjustmentFact,
} from "../../artifacts/api-server/src/lib/taxReturnEngine";
import { computeForm4797 } from "../../artifacts/api-server/src/lib/form4797";
import { computeScheduleCAssetDepreciation } from "../../artifacts/api-server/src/lib/taxCalculator";

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(label: string, actual: number, expected: number, tol = 0.01): void {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) passed++;
  else {
    failed++;
    failures.push(`  X ${label}: expected ${expected}±${tol}, got ${actual}`);
  }
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`  X ${label}`);
  }
}
function header(t: string): void {
  console.log(`\n-- ${t} --`);
}
const A = (t: string, amt: number): AdjustmentFact => ({ adjustmentType: t, amount: amt, isApplied: true });

// ════════════════════════════════════════════════════════════════════════════
// A. §461(l) — Form 461 netting + TY2026 thresholds
// ════════════════════════════════════════════════════════════════════════════
header("A1 — §461(l) NETS business income against losses (the +$400k/−$700k repro)");
{
  // Single TY2024: Sch C profit +$400,000 + active K-1 Box 1 loss −$700,000
  // (basis untracked → loss unlimited at the §704(d)/§465 layer).
  // Form 461 lines 1–9 (§461(l)(3)(A)): excess business loss = aggregate T/B
  // deductions − aggregate T/B gross income − threshold. Net aggregate business
  // income = 400,000 − 700,000 = −300,000; |loss| 300,000 < $305,000 TY2024
  // threshold → addback $0. (The PRE-FIX per-bucket-loss sum charged a $395,000
  // addback — fed-business.md H2 live repro R3.)
  // SE tax (Sch C only; the K-1 has no Box 14A): SE earnings 400,000 × .9235 =
  // 369,400 → OASDI 168,600 × 12.4% = 20,906.40 + Medicare 369,400 × 2.9% =
  // 10,712.60 → 31,619.00 (Additional Medicare is reported separately).
  // AGI = max(0, 400,000 − 700,000 − ½SE 15,809.50) = 0 (engine floors AGI ≥ 0).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [A("self_employment_income", 400000)],
    scheduleK1: [
      { taxYear: 2024, entityType: "partnership", activityType: "active", box1OrdinaryIncome: -700000 },
    ],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("A1 §461(l) addback = $0 (net biz loss 300k < 305k threshold)", r.section461lExcessLossAddback, 0);
  check("A1 AGI = $0 (net −315,809.50 floored at 0; pre-fix was 79,190.50)", r.adjustedGrossIncome, 0);
  check("A1 SE tax = $31,619.00 (on the profitable Sch C)", r.selfEmploymentTax, 31619.0, 0.5);
}

header("A2 — §461(l) single-business control (pure loss still capped)");
{
  // Single TY2024: W-2 $500,000 + Sch C loss −$400,000 (no offsetting income).
  // Net aggregate business income = −400,000 → addback = 400,000 − 305,000 =
  // $95,000. AGI = 500,000 − 400,000 + 95,000 = $195,000.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 500000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("self_employment_income", -400000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("A2 §461(l) addback = $95,000 (400k loss − 305k)", r.section461lExcessLossAddback, 95000);
  check("A2 AGI = $195,000", r.adjustedGrossIncome, 195000);
}

header("A3 — explicit CPA §461(l) override still wins over the auto-netting");
{
  // Same facts as A1 (auto-addback $0) + explicit addback $10,000 → $10,000.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [A("self_employment_income", 400000), A("section_461l_excess_loss_addback", 10000)],
    scheduleK1: [
      { taxYear: 2024, entityType: "partnership", activityType: "active", box1OrdinaryIncome: -700000 },
    ],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("A3 explicit addback $10,000 wins", r.section461lExcessLossAddback, 10000);
}

header("A4 — §461(l) TY2026 thresholds $256k/$512k (Rev. Proc. 2025-32 §4.31)");
{
  // OBBBA (P.L. 119-21) made §461(l) permanent and RE-BASED the indexation —
  // TY2026 is LOWER than TY2025 ($313k/$626k). Holding at 2025 under-stated
  // the addback (fed-business.md H1).
  // Single TY2026: W-2 400,000 + Sch C −300,000 → addback = 300,000 − 256,000
  // = $44,000; AGI = 400,000 − 300,000 + 44,000 = $144,000.
  const single = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2026 },
    w2s: [{ taxYear: 2026, wagesBox1: 400000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("self_employment_income", -300000)],
    taxYear: 2026,
  } as TaxReturnInputs);
  check("A4 single TY2026 addback = $44,000 (threshold $256,000)", single.section461lExcessLossAddback, 44000);
  check("A4 single TY2026 AGI = $144,000", single.adjustedGrossIncome, 144000);
  // MFJ TY2026: W-2 800,000 + Sch C −700,000 → addback = 700,000 − 512,000 =
  // $188,000; AGI = 800,000 − 700,000 + 188,000 = $288,000.
  const mfj26 = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2026 },
    w2s: [{ taxYear: 2026, wagesBox1: 800000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("self_employment_income", -700000)],
    taxYear: 2026,
  } as TaxReturnInputs);
  check("A4 MFJ TY2026 addback = $188,000 (threshold $512,000)", mfj26.section461lExcessLossAddback, 188000);
  check("A4 MFJ TY2026 AGI = $288,000", mfj26.adjustedGrossIncome, 288000);
  // MFJ TY2025 control (Rev. Proc. 2024-40 $626,000): addback = 700,000 −
  // 626,000 = $74,000; AGI = 174,000 — proves the year split.
  const mfj25 = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2025 },
    w2s: [{ taxYear: 2025, wagesBox1: 800000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("self_employment_income", -700000)],
    taxYear: 2025,
  } as TaxReturnInputs);
  check("A4 MFJ TY2025 control addback = $74,000 (threshold $626,000)", mfj25.section461lExcessLossAddback, 74000);
  check("A4 MFJ TY2025 control AGI = $174,000", mfj25.adjustedGrossIncome, 174000);
}

// ════════════════════════════════════════════════════════════════════════════
// B. §172 NOL — above the line (Schedule 1 line 8a → AGI)
// ════════════════════════════════════════════════════════════════════════════
header("B1 — NOL reduces AGI; 80% cap measured pre-NOL/pre-QBI (§172(a)(2)(B)(ii))");
{
  // Single FL TY2024: Sch C $200,000 + NOL carryforward $300,000.
  // SE tax 26,262.70 (OASDI 20,906.40 + Medicare 5,356.30); ½SE = 13,131.35.
  // 80%-cap base = taxable computed WITHOUT the NOL and WITHOUT §199A:
  //   AGI-w/o-NOL 186,868.65 − 14,600 std = 172,268.65
  //   (engine derives it as baselineTaxable 137,814.92 + baselineQbi 34,453.73).
  // NOL deduction = min(300,000, 0.80 × 172,268.65) = 137,814.92; rem 162,185.08.
  // AGI = 200,000 − 13,131.35 − 137,814.92 = 49,053.73  ← the line-8a move.
  // Taxable pre-QBI = 49,053.73 − 14,600 = 34,453.73 (inherently post-NOL).
  // QBI = min(20% × (200,000 − 13,131.35) = 37,373.73, cap 20% × 34,453.73 =
  //   6,890.75) = 6,890.75. Final taxable = 34,453.73 − 6,890.75 = 27,562.98.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [A("self_employment_income", 200000), A("nol_carryforward", 300000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("B1 NOL deduction = $137,814.92 (80% of pre-NOL/pre-QBI taxable)", r.nolDeduction, 137814.92, 0.5);
  check("B1 NOL remaining = $162,185.08", r.nolCarryforwardRemaining, 162185.08, 0.5);
  check("B1 AGI = $49,053.73 (NOL is a Sch 1 line 8a AGI deduction)", r.adjustedGrossIncome, 49053.73, 0.5);
  check("B1 QBI = $6,890.75 (capped by POST-NOL taxable)", r.qbiDeduction, 6890.75, 0.5);
  check("B1 taxable income = $27,562.98", r.taxableIncome, 27562.98, 0.5);
}

header("B2 — a MAGI consumer (IRA §219(g) phase-out) sees the post-NOL AGI");
{
  // Single TY2024 covered by a workplace plan; W-2 $100,000; trad-IRA $7,000.
  // Pub 590-A MAGI ≈ AGI computed without the IRA deduction.
  // WITHOUT the NOL: MAGI 100,000 > $87,000 band top → deduction $0.
  const noNol = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, iraCoveredByWorkplacePlan: true },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("ira_contribution_traditional", 7000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("B2 control IRA deduction = $0 (MAGI 100,000 > 87,000)", noNol.retirementDeductions.iraDeductible, 0);
  check("B2 control AGI = $100,000", noNol.adjustedGrossIncome, 100000);
  // WITH a $40,000 NOL: 80%-cap base = 100,000 − 14,600 = 85,400 → 0.80 ×
  // 85,400 = 68,320 > 40,000 → NOL fully used. MAGI = 100,000 − 40,000 =
  // 60,000 < $77,000 band floor → FULL $7,000 deduction.
  // AGI = 100,000 − 40,000 − 7,000 = 53,000.
  const withNol = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024, iraCoveredByWorkplacePlan: true },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("ira_contribution_traditional", 7000), A("nol_carryforward", 40000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("B2 NOL deduction = $40,000 (under the 80% cap of 68,320)", withNol.nolDeduction, 40000);
  check("B2 IRA deduction = $7,000 (post-NOL MAGI 60,000 < 77,000)", withNol.retirementDeductions.iraDeductible, 7000);
  check("B2 AGI = $53,000 (100,000 − NOL 40,000 − IRA 7,000)", withNol.adjustedGrossIncome, 53000);
}

// ════════════════════════════════════════════════════════════════════════════
// C. QBI auto-default — SEHI, negative netting, loss carryforward
// ════════════════════════════════════════════════════════════════════════════
header("C1 — QBI auto-default subtracts the SEHI deduction (§1.199A-3(b)(1)(vi))");
{
  // Single TY2024: SE $100,000 + $150,000 interest + $20,000 SEHI.
  // (The interest keeps the 20%-of-taxable cap from masking the QBI amount.)
  // Sch C QBI = netSE 100,000 − ½SE 7,064.775 − SEHI 20,000 = 72,935.225.
  // QBI deduction = 20% × 72,935.225 = $14,587.05 (pre-fix: 18,587.05 —
  // fed-business.md H3 live repro R4b).
  // SEHI cap: min(20,000, netSE − ½SE = 92,935.23) → full 20,000.
  // AGI = 100,000 + 150,000 − 7,064.775 − 20,000 = 222,935.225.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 150000 }],
    adjustments: [A("self_employment_income", 100000), A("self_employed_health_insurance_premiums", 20000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("C1 QBI = $14,587.05 (SEHI reduces QBI)", r.qbiDeduction, 14587.05, 0.5);
  check("C1 AGI = $222,935.23", r.adjustedGrossIncome, 222935.23, 0.5);
  // No-SEHI control: QBI = 20% × 92,935.225 = 18,587.05.
  const ctrl = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 150000 }],
    adjustments: [A("self_employment_income", 100000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("C1 control (no SEHI) QBI = $18,587.05", ctrl.qbiDeduction, 18587.05, 0.5);
}

header("C2 — §199A(c)(2) negative-QBI netting (Form 8995 lines 1–2)");
{
  // Single TY2024: SE $100,000 + active K-1 Box 1 LOSS −$60,000 (untracked
  // basis → fully allowed) + $150,000 interest.
  // Sch C QBI 92,935.225 − K-1 allowed loss 60,000 = net 32,935.225.
  // QBI deduction = 20% × 32,935.225 = $6,587.05 (pre-fix: 18,587.05 — the
  // K-1 loss was floored out of QBI; fed-business.md H3 repro R5b).
  // AGI = 100,000 − 60,000 + 150,000 − 7,064.775 = 182,935.225.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [{ taxYear: 2024, formType: "int", payerName: "Bank", interestIncome: 150000 }],
    adjustments: [A("self_employment_income", 100000)],
    scheduleK1: [
      { taxYear: 2024, entityType: "partnership", activityType: "active", box1OrdinaryIncome: -60000 },
    ],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("C2 QBI = $6,587.05 (K-1 loss nets against Sch C QBI)", r.qbiDeduction, 6587.05, 0.5);
  check("C2 AGI = $182,935.23", r.adjustedGrossIncome, 182935.23, 0.5);
  check("C2 no QBI-loss carryforward (net positive)", r.qbiLossCarryforward, 0);
}

header("C3 — net-negative QBI → $0 deduction + loss carryforward OUT (§199A(c)(2)(B))");
{
  // Single TY2024: W-2 $120,000 + Sch C loss −$50,000 (under the §461(l)
  // threshold → fully allowed into AGI). Combined QBI = −50,000 → deduction $0
  // and qbiLossCarryforward = $50,000 (Form 8995 line 16 analog).
  // AGI = 120,000 − 50,000 = 70,000.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 120000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("self_employment_income", -50000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("C3 QBI deduction = $0 (net negative)", r.qbiDeduction, 0);
  check("C3 qbiLossCarryforward = $50,000", r.qbiLossCarryforward, 50000);
  check("C3 AGI = $70,000 (signed Sch C loss flows to AGI)", r.adjustedGrossIncome, 70000);
}

header("C4 — qbi_loss_carryforward round-trip (carry-IN reduces next year's QBI)");
{
  // Single TY2024: SE $100,000 + prior-year QBI loss carryforward $50,000.
  // Next-year combined QBI = 92,935.225 − 50,000 = 42,935.225 →
  // deduction = 20% × 42,935.225 = $8,587.05 (carry fully absorbed → CF out 0).
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [A("self_employment_income", 100000), A("qbi_loss_carryforward", 50000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("C4 QBI = $8,587.05 (20% × (92,935.23 − 50,000))", r.qbiDeduction, 8587.05, 0.5);
  check("C4 carryforward fully absorbed (CF out = 0)", r.qbiLossCarryforward, 0);
  // Carry-in EXCEEDS the year's QBI → $0 deduction + the residual carries on:
  // 92,935.225 − 120,000 = −27,064.775 → CF out 27,064.78.
  const r2 = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [],
    form1099s: [],
    adjustments: [A("self_employment_income", 100000), A("qbi_loss_carryforward", 120000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("C4b QBI = $0 (carry-in exceeds QBI)", r2.qbiDeduction, 0);
  check("C4b residual CF out = $27,064.78", r2.qbiLossCarryforward, 27064.78, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// D. OBBBA Schedule 1-A — MFS bar (Notice 2025-69)
// ════════════════════════════════════════════════════════════════════════════
header("D1 — MFS gets $0 tips/overtime/senior; car-loan interest survives");
{
  // TY2025, MFS, age 66, W-2 $60,000 (MAGI below every phase-out), $10,000
  // qualified tips + $5,000 qualified overtime + $4,000 car-loan interest.
  // §224(f)/§225(e): married must file JOINTLY → tips/overtime $0 for MFS.
  // §151(d)(5) senior $6,000: same joint-return requirement → $0 for MFS.
  // §163(h)(4) car-loan: NO joint-return bar → $4,000 kept (single-threshold
  // $100k phase-out; MAGI 60,000+adjustments below it → no reduction).
  const mfs = computeTaxReturnPure({
    client: { filingStatus: "married_filing_separately", state: "FL", taxYear: 2025, taxpayerAge: 66 },
    w2s: [{ taxYear: 2025, wagesBox1: 60000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("qualified_tips", 10000), A("qualified_overtime", 5000), A("qualified_car_loan_interest", 4000)],
    taxYear: 2025,
  } as TaxReturnInputs);
  check("D1 MFS tips = $0 (§224(f) joint-return requirement)", mfs.obbbaSchedule1A.tips, 0);
  check("D1 MFS overtime = $0 (§225(e))", mfs.obbbaSchedule1A.overtime, 0);
  check("D1 MFS senior = $0 (§151(d)(5))", mfs.obbbaSchedule1A.senior, 0);
  check("D1 MFS car-loan = $4,000 (no MFS bar)", mfs.obbbaSchedule1A.carLoanInterest, 4000);
  check("D1 MFS total = $4,000", mfs.obbbaSchedule1A.total, 4000);
  // MFJ control on the same facts: 10,000 + 5,000 + 4,000 + senior 6,000 = 25,000.
  const mfj = computeTaxReturnPure({
    client: { filingStatus: "married_filing_jointly", state: "FL", taxYear: 2025, taxpayerAge: 66 },
    w2s: [{ taxYear: 2025, wagesBox1: 60000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("qualified_tips", 10000), A("qualified_overtime", 5000), A("qualified_car_loan_interest", 4000)],
    taxYear: 2025,
  } as TaxReturnInputs);
  check("D1 MFJ control tips = $10,000", mfj.obbbaSchedule1A.tips, 10000);
  check("D1 MFJ control overtime = $5,000", mfj.obbbaSchedule1A.overtime, 5000);
  check("D1 MFJ control senior = $6,000 (one 65+ spouse)", mfj.obbbaSchedule1A.senior, 6000);
  check("D1 MFJ control total = $25,000", mfj.obbbaSchedule1A.total, 25000);
}

// ════════════════════════════════════════════════════════════════════════════
// E. §1231(c) lookback ordering — Notice 97-59
// ════════════════════════════════════════════════════════════════════════════
header("E1 — form4797: recapture absorbs the 25% pool FIRST (the kept-$40k repro)");
{
  // fed-business.md M2 live repro R2: §1250 building (gain $40,000, all
  // unrecaptured — SL depreciation 40,000, additional 0) + land gain $60,000 +
  // §1231(c) lookback loss $60,000.
  //   net §1231 = 40,000 + 60,000 = 100,000
  //   recapture = min(100,000, 60,000) = 60,000 → ordinary
  //   surviving §1231 LTCG = 40,000
  //   Notice 97-59 / Reg. §1.453-12 Ex. 3: the recharacterized ordinary amount
  //   comes FIRST from 28% gain (none), THEN from unrecaptured §1250:
  //     pool after recapture = max(0, 40,000 − 60,000) = 0
  //   → unrecaptured §1250 = min(0, 40,000) = $0; the surviving 40,000 is ALL
  //   0/15/20 gain. (The pre-fix code kept the full $40,000 at 25% —
  //   over-taxing by (25% − 15/20%) × 40,000.)
  const f = computeForm4797(
    [
      { taxYear: 2024, description: "bldg", grossSalePrice: 140000, costOrBasis: 140000, depreciationAllowed: 40000, additionalDepreciation: 0, assetClass: "section1250" },
      { taxYear: 2024, description: "land", grossSalePrice: 160000, costOrBasis: 100000, depreciationAllowed: 0, assetClass: "land" },
    ],
    60000,
  );
  check("E1 net §1231 = $100,000", f.netSection1231, 100000);
  check("E1 lookback recapture = $60,000 (→ ordinary)", f.section1231LookbackRecapture, 60000);
  check("E1 surviving §1231 LTCG = $40,000", f.netSection1231LtcgGain, 40000);
  check("E1 unrecaptured §1250 = $0 (recapture absorbed the 25% pool first)", f.unrecaptured1250Gain, 0);
  check("E1 ordinary component = $60,000", f.ordinaryComponent, 60000);
}

header("E2 — live-app channel: lookback vs gainClass=\"section1250\" transactions");
{
  // T1.0d #16: `TaxReturnInputs.form4797` has no DB table, so the enum'd
  // section_1231_lookback_loss adjustment was a live-app NO-OP. The app's
  // §1231 channel is capitalTransactions gainClass="section1250" — the unused
  // lookback now recharacterizes those gains (LTCG → ordinary; 25% pool first).
  // Single TY2024, W-2 $100,000; one lot: proceeds 200,000 − basis 120,000 =
  // gain 80,000, explicit unrecaptured §1250 50,000; lookback loss 30,000.
  //   recharacterized = min(30,000, 80,000) = 30,000 (LTCG → ordinary)
  //   §1250 pool after = 50,000 − 30,000 = 20,000 (Notice 97-59 order)
  //   net LTCG = 80,000 − 30,000 = 50,000; AGI unchanged at 180,000.
  // Tax: taxable = 180,000 − 14,600 = 165,400; ordinary portion = 115,400
  //   (wages 100,000 − 14,600 + recharacterized 30,000):
  //   10%×11,600 + 12%×35,550 + 22%×53,375 + 24%×14,875
  //     = 1,160 + 4,266 + 11,742.50 + 3,570 = 20,738.50
  //   §1250 20,000 @ FLAT 25% = 5,000; other LTCG 30,000 @ 15% = 4,500
  //   federal = 20,738.50 + 5,000 + 4,500 = $30,238.50.
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [A("section_1231_lookback_loss", 30000)],
    capitalTransactions: [
      { taxYear: 2024, description: "rental bldg", proceeds: 200000, costBasis: 120000, formBox: "E", gainClass: "section1250", unrecaptured1250Amount: 50000 },
    ],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("E2 recharacterized = $30,000 (txn-channel lookback now live)", r.section1231TxnLookbackRecharacterized, 30000);
  check("E2 unrecaptured §1250 = $20,000 (pool 50,000 − 30,000 first)", r.unrecapturedSection1250Gain, 20000);
  check("E2 net capital gain = $50,000 (80,000 − recharacterized)", r.netCapitalGainLoss, 50000);
  check("E2 AGI = $180,000 (character swap, not income change)", r.adjustedGrossIncome, 180000);
  check("E2 federal tax = $30,238.50", r.federalTaxLiability, 30238.5, 0.5);
  // No-lookback control: §1250 50,000 @25% = 12,500 + 30,000 @15% = 4,500;
  // ordinary 85,400 → 1,160 + 4,266 + 22%×38,250 = 8,415 → 13,841.
  // federal = 13,841 + 12,500 + 4,500 = $30,841.
  const ctrl = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    capitalTransactions: [
      { taxYear: 2024, description: "rental bldg", proceeds: 200000, costBasis: 120000, formBox: "E", gainClass: "section1250", unrecaptured1250Amount: 50000 },
    ],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("E2 control recharacterized = $0", ctrl.section1231TxnLookbackRecharacterized, 0);
  check("E2 control unrecaptured §1250 = $50,000", ctrl.unrecapturedSection1250Gain, 50000);
  check("E2 control federal tax = $30,841.00", ctrl.federalTaxLiability, 30841, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// F. §179 trio
// ════════════════════════════════════════════════════════════════════════════
header("F1 — §179 carryover re-limited by the deduction-year DOLLAR cap (Reg. §1.179-3(a))");
{
  // TY2024 cap $1,220,000 / phase-out start $3,050,000. Elected $1,220,000 (at
  // the cap) + carry-in $100,000 + ample income. Total §179 for the year =
  // min(1,220,000 + 100,000, dollar cap 1,220,000, income) = $1,220,000; the
  // carryover keeps §179 character → CF out $100,000. (Pre-fix deducted
  // $1,320,000 — fed-business.md M3 repro R1.)
  const a = computeScheduleCAssetDepreciation({
    taxYear: 2024,
    assets: [{ cost: 1220000, placedInServiceYear: 2024, recoveryYears: 5, section179: true }],
    section179Cap: 1220000,
    section179PhaseStart: 3050000,
    bonusRateByYear: { 2024: 0.6 },
    businessIncomeForSection179: 5000000,
    section179CarryforwardIn: 100000,
  });
  check("F1 §179 = $1,220,000 (dollar cap re-binds the carry-in)", a.section179Deduction, 1220000);
  check("F1 carryforward out = $100,000 (keeps §179 character)", a.section179Carryforward, 100000);
  check("F1 MACRS = $0 (whole cost expensed)", a.macrsDeduction, 0);
}

header("F2 — DOLLAR-cap-disallowed election → bonus/MACRS basis, NOT a §179 CF (Reg. §1.179-3(c)(1))");
{
  // Elected $1,500,000, cap $1,220,000 → §179 $1,220,000; the $280,000 excess
  // is NOT carryforward-eligible (only the income-limit disallowance carries) —
  // it stays in depreciable basis: 5-yr half-year MACRS yr 1 = 20% × 280,000 =
  // $56,000. (Pre-fix: phantom $280k §179 CF + $0 depreciation —
  // fed-business.md M4 repro R1b.)
  const b = computeScheduleCAssetDepreciation({
    taxYear: 2024,
    assets: [{ cost: 1500000, placedInServiceYear: 2024, recoveryYears: 5, section179: true }],
    section179Cap: 1220000,
    section179PhaseStart: 3050000,
    bonusRateByYear: { 2024: 0.6 },
    businessIncomeForSection179: 5000000,
    section179CarryforwardIn: 0,
  });
  check("F2 §179 = $1,220,000", b.section179Deduction, 1220000);
  check("F2 NO phantom §179 carryforward", b.section179Carryforward, 0);
  check("F2 MACRS yr-1 on the excess = $56,000 (20% × 280,000)", b.macrsDeduction, 56000);
  check("F2 total depreciation = $1,276,000", b.totalDepreciation, 1276000);
  // Same with the bonus flag: excess 280,000 → bonus 60% = 168,000 + MACRS
  // 20% × 112,000 = 22,400.
  const c = computeScheduleCAssetDepreciation({
    taxYear: 2024,
    assets: [{ cost: 1500000, placedInServiceYear: 2024, recoveryYears: 5, section179: true, bonus: true }],
    section179Cap: 1220000,
    section179PhaseStart: 3050000,
    bonusRateByYear: { 2024: 0.6 },
    businessIncomeForSection179: 5000000,
    section179CarryforwardIn: 0,
  });
  check("F2b excess basis bonus 60% = $168,000", c.bonusDeduction, 168000);
  check("F2b excess basis MACRS = $22,400 (20% × 112,000)", c.macrsDeduction, 22400);
}

header("F3 — above-the-line §179 income limit includes W-2 wages (Reg. §1.179-2(c)(6)(iv))");
{
  // Single TY2024: $50,000 1099-NEC Sch C + $100,000 W-2; §179 elected $80,000.
  // Limit base = Sch C net 50,000 + wages 100,000 = 150,000 (NOT 92.35% × SE —
  // the Sch SE multiplier has no role in §179; fed-business.md M7 repro R8) →
  // full $80,000 applied. AGI = 150,000 − ½SE 3,532.39 − 80,000 = 66,467.61.
  //   (½SE: 50,000 × .9235 = 46,175 × 15.3% = 7,064.775 → half 3,532.3875.)
  const r = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "nec", payerName: "Client", nonemployeeCompensation: 50000 }],
    adjustments: [A("section_179_expense_election", 80000)],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("F3 §179 applied = $80,000 (wages lift the income limit)", r.section179Applied, 80000);
  check("F3 §179 carryforward = $0", r.section179Carryforward, 0);
  check("F3 AGI = $66,467.61", r.adjustedGrossIncome, 66467.61, 0.5);
}

// ════════════════════════════════════════════════════════════════════════════
// G. K-1 partner SE earnings = §32 earned income (the $8,825-swing repro)
// ════════════════════════════════════════════════════════════════════════════
header("G1 — partnership K-1 (Box 1 + 14A) gets the same EITC/ACTC as a sole prop");
{
  // cross-cutting.md H1 repro 6: HoH, 2 kids, $18,000 of business income,
  // identical economics both ways.
  // SE: 18,000 × .9235 = 16,623 → SE tax 15.3% = 2,543.32; ½ = 1,271.66.
  // AGI = 18,000 − 1,271.66 = 16,728.34. Taxable = 0 (std ded 21,900).
  // Earned income (§32(c)(2)(A)(ii)) = net SE earnings − ½SE = 16,728.34.
  // EITC 2024 HoH/2 kids: below the $17,400 plateau → 40% × 16,728.34 =
  //   $6,691.34.
  // ACTC = min(CTC 4,000 unused, 15% × (16,728.34 − 2,500)) = $2,134.25.
  // Refund = 6,691.34 + 2,134.25 − SE tax 2,543.32 = $6,282.27.
  const mk = (k1: boolean): TaxReturnInputs =>
    ({
      client: { filingStatus: "head_of_household", state: "FL", taxYear: 2024, dependentsUnder17: 2, eitcQualifyingChildren: 2 },
      w2s: [],
      form1099s: [],
      adjustments: k1 ? [] : [A("self_employment_income", 18000)],
      scheduleK1: k1
        ? [{ taxYear: 2024, entityType: "partnership", activityType: "active", box1OrdinaryIncome: 18000, selfEmploymentEarnings: 18000 }]
        : undefined,
      taxYear: 2024,
    }) as TaxReturnInputs;
  const sole = computeTaxReturnPure(mk(false));
  const partner = computeTaxReturnPure(mk(true));
  check("G1 sole-prop EITC = $6,691.34", sole.eitc.appliedCredit, 6691.34, 0.5);
  check("G1 partner EITC = $6,691.34 (was $0 — K-1 14A is earned income)", partner.eitc.appliedCredit, 6691.34, 0.5);
  check("G1 partner ACTC = $2,134.25 (was $0)", partner.childTaxCredit.refundableActc, 2134.25, 0.5);
  check("G1 partner refund = +$6,282.27 (was −$2,543.32: the $8,825 swing)", partner.federalRefundOrOwed, 6282.27, 0.5);
  check("G1 EITC parity (partner == sole prop)", partner.eitc.appliedCredit, sole.eitc.appliedCredit, 0.01);
  check("G1 ACTC parity", partner.childTaxCredit.refundableActc, sole.childTaxCredit.refundableActc, 0.01);
  check("G1 refund parity", partner.federalRefundOrOwed, sole.federalRefundOrOwed, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// H. K-1 Box 2 QBI gated on the §469-allowed fraction
// ════════════════════════════════════════════════════════════════════════════
header("H1 — §469-suspended Box 2 income generates NO QBI (§1.199A-3(b)(1)(iv))");
{
  // Single TY2024, W-2 $100,000. Active K-1 Box 2 +$50,000 rides the §469
  // passive bucket for AGI; a separate passive K-1 Box 1 −$50,000 suspends it
  // → $0 reaches AGI → $0 QBI (pre-fix: $10,000 QBI on income never taxed —
  // cross-cutting.md H2 repro 2-A).
  const suspended = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      { taxYear: 2024, entityType: "partnership", activityType: "active", box2RentalRealEstate: 50000 },
      { taxYear: 2024, entityType: "partnership", activityType: "passive", box1OrdinaryIncome: -50000 },
    ],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("H1 AGI = $100,000 (Box 2 fully offset in the passive bucket)", suspended.adjustedGrossIncome, 100000);
  check("H1 QBI = $0 (suspended income is not §199A QBI)", suspended.qbiDeduction, 0);
  // Control — no suspending loss: Box 2 fully allowed → QBI 20% × 50,000 = 10,000.
  const allowed = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [{ taxYear: 2024, entityType: "partnership", activityType: "active", box2RentalRealEstate: 50000 }],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("H1 control AGI = $150,000 (Box 2 allowed)", allowed.adjustedGrossIncome, 150000);
  check("H1 control QBI = $10,000 (allowed Box 2 is QBI)", allowed.qbiDeduction, 10000);
}

// ════════════════════════════════════════════════════════════════════════════
// I. K-1 Box 6a/6b dividend netting (6b ⊂ 6a)
// ════════════════════════════════════════════════════════════════════════════
header("I1 — K-1 6a/6b parity with 1099-DIV 1a/1b (no qualified double-count)");
{
  // $50,000 W-2 + dividends $1,500 total / $1,000 qualified, entered once as a
  // K-1 (Box 6a=1,500 / 6b=1,000) and once as a 1099-DIV (1a=1,500 / 1b=1,000).
  // Both must produce AGI = 50,000 + 1,500 = $51,500 and identical tax.
  // (Pre-fix the K-1 path added 1,500 + 1,000 = 2,500 — cross-cutting.md H3.)
  const viaK1 = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    form1099s: [],
    adjustments: [],
    scheduleK1: [
      { taxYear: 2024, entityType: "s_corp", activityType: "active", ordinaryDividends: 1500, qualifiedDividends: 1000 },
    ],
    taxYear: 2024,
  } as TaxReturnInputs);
  const viaDiv = computeTaxReturnPure({
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 50000, stateCode: "FL" }],
    form1099s: [{ taxYear: 2024, formType: "div", payerName: "Fund", ordinaryDividends: 1500, qualifiedDividends: 1000 }],
    adjustments: [],
    taxYear: 2024,
  } as TaxReturnInputs);
  check("I1 K-1 path AGI = $51,500 (6b subset not double-counted)", viaK1.adjustedGrossIncome, 51500);
  check("I1 1099-DIV path AGI = $51,500", viaDiv.adjustedGrossIncome, 51500);
  check("I1 AGI parity (K-1 == 1099-DIV)", viaK1.adjustedGrossIncome, viaDiv.adjustedGrossIncome, 0.01);
  check("I1 federal-tax parity", viaK1.federalTaxLiability, viaDiv.federalTaxLiability, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// J. Negative carryforward entries are floored (no phantom income)
// ════════════════════════════════════════════════════════════════════════════
header("J1 — a NEGATIVE carryforward entry is inert, never phantom income");
{
  // cross-cutting.md M2 repro 4: capital_loss_carryforward_short entered as
  // −50,000 previously ADDED $50,000 to AGI (+$11,697.50 tax). Now floored.
  const base: Omit<TaxReturnInputs, "adjustments"> = {
    client: { filingStatus: "single", state: "FL", taxYear: 2024 },
    w2s: [{ taxYear: 2024, wagesBox1: 100000, stateCode: "FL" }],
    form1099s: [],
    taxYear: 2024,
  } as Omit<TaxReturnInputs, "adjustments">;
  const ctrl = computeTaxReturnPure({ ...base, adjustments: [] } as TaxReturnInputs);
  const negShort = computeTaxReturnPure({ ...base, adjustments: [A("capital_loss_carryforward_short", -50000)] } as TaxReturnInputs);
  check("J1 −$50k STCG carryforward inert (AGI unchanged)", negShort.adjustedGrossIncome, ctrl.adjustedGrossIncome, 0.01);
  check("J1 −$50k STCG carryforward inert (tax unchanged)", negShort.federalTaxLiability, ctrl.federalTaxLiability, 0.01);
  const negLong = computeTaxReturnPure({ ...base, adjustments: [A("capital_loss_carryforward_long", -50000)] } as TaxReturnInputs);
  check("J1 −$50k LTCG carryforward inert", negLong.adjustedGrossIncome, ctrl.adjustedGrossIncome, 0.01);
  // Passive-bucket sibling: passive K-1 +10,000 with a NEGATIVE k1 passive-loss
  // carryforward must not ADD passive income (floored → income stays 10,000).
  const k1Base = {
    ...base,
    scheduleK1: [{ taxYear: 2024, entityType: "partnership", activityType: "passive", box1OrdinaryIncome: 10000 }],
  };
  const k1Ctrl = computeTaxReturnPure({ ...k1Base, adjustments: [] } as TaxReturnInputs);
  const k1Neg = computeTaxReturnPure({ ...k1Base, adjustments: [A("k1_passive_loss_carryforward", -30000)] } as TaxReturnInputs);
  check("J1 control passive K-1 AGI = $110,000", k1Ctrl.adjustedGrossIncome, 110000);
  check("J1 −$30k passive-loss carryforward inert", k1Neg.adjustedGrossIncome, k1Ctrl.adjustedGrossIncome, 0.01);
  // NOL: a negative nol_carryforward is floored — no deduction, no remaining.
  const negNol = computeTaxReturnPure({ ...base, adjustments: [A("nol_carryforward", -25000)] } as TaxReturnInputs);
  check("J1 −$25k NOL carryforward inert (deduction 0)", negNol.nolDeduction, 0);
  check("J1 −$25k NOL carryforward inert (AGI unchanged)", negNol.adjustedGrossIncome, ctrl.adjustedGrossIncome, 0.01);
}

// ════════════════════════════════════════════════════════════════════════════
// K. NaN/Infinity COUNT-field totality
// ════════════════════════════════════════════════════════════════════════════
header("K1 — NaN count fields neither throw nor emit NaN (cross-cutting.md M3)");
{
  // HoH $30,000 W-2 with EVERY count/age field set to NaN. Pre-fix:
  // eitcQualifyingChildren: NaN THREW in calculateEitc; otherDependents /
  // eligibleEducatorCount / dependentsForCareCredit / acaHouseholdSize: NaN
  // propagated NaN into filed outputs. Now toCount clamps NaN → 0.
  // With 0 kids: taxable = 30,000 − 21,900 = 8,100 → tax 10% = $810; EITC $0
  // (childless AGI above phase-out); refund = −810.
  let r: ReturnType<typeof computeTaxReturnPure> | null = null;
  let threw = false;
  try {
    r = computeTaxReturnPure({
      client: {
        filingStatus: "head_of_household",
        state: "FL",
        taxYear: 2024,
        dependentsUnder17: NaN,
        otherDependents: NaN,
        dependentsForCareCredit: NaN,
        eitcQualifyingChildren: NaN,
        eligibleEducatorCount: NaN,
        acaHouseholdSize: NaN,
        taxpayerAge: NaN,
        spouseAge: NaN,
      },
      w2s: [{ taxYear: 2024, wagesBox1: 30000, stateCode: "FL" }],
      form1099s: [],
      adjustments: [],
      taxYear: 2024,
    } as TaxReturnInputs);
  } catch {
    threw = true;
  }
  checkTrue("K1 engine does not throw on NaN counts", !threw && r != null);
  if (r) {
    const outs = [r.adjustedGrossIncome, r.taxableIncome, r.federalTaxLiability, r.federalRefundOrOwed, r.eitc.appliedCredit, r.childTaxCredit.appliedCredit];
    checkTrue("K1 all headline outputs finite (no NaN/Infinity)", outs.every((v) => Number.isFinite(v)));
    check("K1 NaN counts behave as 0 — tax = $810 (taxable 8,100 × 10%)", r.federalTaxLiability, 810);
    check("K1 EITC = $0 (childless, AGI over phase-out)", r.eitc.appliedCredit, 0);
    check("K1 refund = −$810", r.federalRefundOrOwed, -810);
  }
  // Infinity variant: Infinity counts clamp to the neutral 0 as well; ages too.
  let r2: ReturnType<typeof computeTaxReturnPure> | null = null;
  let threw2 = false;
  try {
    r2 = computeTaxReturnPure({
      client: {
        filingStatus: "single",
        state: "FL",
        taxYear: 2024,
        eitcQualifyingChildren: Infinity,
        dependentsUnder17: Infinity,
        taxpayerAge: -Infinity,
      },
      w2s: [{ taxYear: 2024, wagesBox1: 30000, stateCode: "FL" }],
      form1099s: [],
      adjustments: [],
      taxYear: 2024,
    } as TaxReturnInputs);
  } catch {
    threw2 = true;
  }
  checkTrue("K1 engine does not throw on Infinity counts", !threw2 && r2 != null);
  if (r2) {
    checkTrue(
      "K1 Infinity-count outputs all finite",
      [r2.adjustedGrossIncome, r2.taxableIncome, r2.federalTaxLiability, r2.federalRefundOrOwed].every((v) => Number.isFinite(v)),
    );
  }
}

// ── Summary ──
console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const f of failures) console.log(f);
  process.exit(1);
}
console.log("ALL T1.0(c)+(d) BUSINESS/CROSS-CUTTING ASSERTIONS PASS");
