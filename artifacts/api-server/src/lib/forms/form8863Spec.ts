/**
 * T2.1 — Form 8863 substitute workpaper: Education Credits (American
 * Opportunity and Lifetime Learning Credits). Line numbers follow the official
 * TY2024 Form 8863 (Part I lines 1–8 refundable AOC; Part II lines 9–19
 * nonrefundable credits).
 *
 * Every value traces to the engine's EducationCreditsCalculation
 * (`ret.educationCredits`):
 *   line 1  = aocPreliminary  (Σ per-student tentative AOC: 100% of first
 *             $2,000 + 25% of next $2,000, max $2,500/student)
 *   line 6  = phaseOutFraction (MAGI band $80k–$90k single/HoH; $160k–$180k
 *             MFJ/QSS — §25A(d))
 *   line 7  = aocApplied = line 1 × line 6
 *   line 8  = aocRefundable = 40% × line 7  → Form 1040 line 29
 *   line 9  = aocNonRefundable = line 7 − line 8
 *   line 11 = llcEligibleExpenses (capped at $10,000/return)
 *   line 12 = llcPreliminary = 20% × line 11
 *   line 18 = llcApplied = line 12 × the same MAGI fraction
 *   line 19 = aocNonRefundable + llcApplied → Schedule 3 line 3
 *
 * The official line-19 Credit Limit Worksheet (cap at remaining tax after the
 * foreign tax + dependent care credits) is applied by the ENGINE's credit
 * pipeline, not inside the stored calc — this workpaper reconstructs that cap
 * and discloses when it binds.
 *
 * CPA review workpaper (Pub 1167 substitute conventions) — NOT a filed form.
 */

import type { ComputedTaxReturn, TaxReturnInputs } from "../taxReturnEngine";
import {
  checkLine,
  countLine,
  moneyLine,
  nz,
  pctLine,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Form 1040 line 18 — the base nonrefundable credits offset: regular income
 *  tax + AMT + the Schedule 2 line 2 excess-APTC repayment (FC-09: §36B(f)(2)(A)
 *  makes the repayment chapter-1 tax and it is NOT in the §26(b)(2) exclusion
 *  list, so every credit-limit worksheet starts from line 18). Exact inversion
 *  of the engine's liability assembly (the repayment STAYS in the base). */
function incomeTaxOnly(ret: ComputedTaxReturn): number {
  return (
    ret.federalTaxLiability -
    ret.selfEmploymentTax -
    ret.niitTax -
    ret.additionalMedicareTax -
    ret.earlyWithdrawalPenalty -
    ret.hsaExcessExcise -
    ret.scheduleH.total
  );
}

/** Raw LLC expenses entered (pre-$10k cap), derivable only from inputs. */
function rawLlcExpenses(inputs: TaxReturnInputs | undefined): number | null {
  if (!inputs) return null;
  let sum = 0;
  let found = false;
  for (const a of inputs.adjustments ?? []) {
    if (a.adjustmentType === "qualified_education_expenses_llc" && a.isApplied !== false) {
      sum += toNum(a.amount);
      found = true;
    }
  }
  return found ? sum : null;
}

export function buildForm8863(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const ec = ret.educationCredits;

  // Applicable when any education activity exists — including an MFS filer
  // whose entered expenses produced a $0 credit (the workpaper shows WHY).
  const anyActivity =
    ec.aocEligibleStudents > 0 ||
    nz(ec.aocPreliminary) ||
    nz(ec.aocApplied) ||
    nz(ec.llcEligibleExpenses) ||
    nz(ec.llcPreliminary) ||
    nz(ec.llcApplied);
  if (!anyActivity) return null;

  const isMfs = ret.filingStatus === "married_filing_separately";

  // ── Part I — Refundable American Opportunity Credit ──
  const partI: FormLine[] = [];
  if (ec.aocEligibleStudents > 0 || nz(ec.aocPreliminary)) {
    partI.push(
      countLine("", "Eligible students with AOC qualified expenses (one Part III each)", ec.aocEligibleStudents),
      moneyLine("1", "Total tentative American opportunity credit (all Parts III, line 30)", ec.aocPreliminary, {
        note: "Per student: 100% of the first $2,000 of qualified expenses + 25% of the next $2,000 — max $2,500/student (§25A(b)(1)).",
      }),
      moneyLine("3", "Modified adjusted gross income (Form 1040 line 11)", ret.adjustedGrossIncome, {
        note: "Engine MAGI = AGI; §911/§931/§933 foreign-exclusion add-backs not modeled.",
      }),
      pctLine("6", "Phase-out fraction retained (line 4 ÷ line 5)", ec.phaseOutFraction, {
        note: "MAGI band §25A(d): $80,000–$90,000 single/HoH; $160,000–$180,000 MFJ/QSS (not inflation-indexed). 100% = no phase-out.",
      }),
      moneyLine("7", "American opportunity credit after phase-out (line 1 × line 6)", ec.aocApplied, { emphasis: true }),
      moneyLine("8", "Refundable American opportunity credit — 40% of line 7 (Form 1040 line 29)", ec.aocRefundable, {
        emphasis: true,
        note: "§25A(i)(5) — fully refundable share; bypasses the tax limit.",
      }),
      checkLine("Line 8 ties: 40% × line 7", 0.4 * ec.aocApplied, ec.aocRefundable),
    );
  } else {
    partI.push(textLine("", "No American opportunity credit claimed this year", "—"));
  }

  // ── Part II — Nonrefundable education credits ──
  const partII: FormLine[] = [];
  if (ec.aocEligibleStudents > 0 || nz(ec.aocPreliminary)) {
    partII.push(
      moneyLine("9", "Line 7 minus line 8 (nonrefundable AOC)", ec.aocNonRefundable),
      checkLine("Line 9 ties: line 7 − line 8", ec.aocApplied - ec.aocRefundable, ec.aocNonRefundable),
    );
  }
  if (nz(ec.llcEligibleExpenses) || nz(ec.llcPreliminary)) {
    const rawLlc = rawLlcExpenses(inputs);
    if (rawLlc != null && nz(rawLlc)) {
      partII.push(
        moneyLine("10", "Total qualified lifetime learning expenses (all students)", rawLlc, { indent: 1 }),
      );
    }
    partII.push(
      moneyLine("11", "Smaller of line 10 or $10,000 (LLC expense cap per return)", ec.llcEligibleExpenses),
      moneyLine("12", "Line 11 × 20% (tentative lifetime learning credit, §25A(c))", ec.llcPreliminary),
      moneyLine("18", "Lifetime learning credit after phase-out (line 12 × the line-6 MAGI fraction)", ec.llcApplied, {
        note: "Same §25A(d) MAGI band as the AOC.",
      }),
      checkLine("Line 18 ties: line 12 × phase-out fraction", ec.llcPreliminary * ec.phaseOutFraction, ec.llcApplied),
    );
  }
  const line19 = ec.aocNonRefundable + ec.llcApplied;
  partII.push(
    moneyLine("19", "Nonrefundable education credits (line 9 + line 18) — Schedule 3 line 3", line19, {
      emphasis: true,
    }),
  );

  // Credit Limit Worksheet reconstruction — the engine applies AOC-nonref then
  // LLC against the income tax remaining after the FTC + dependent care credit
  // (the same ordering as the official worksheet).
  const availBeforeAoc = Math.max(
    0,
    incomeTaxOnly(ret) - ret.foreignTaxCredit.credit - ret.dependentCareCredit.appliedCredit,
  );
  const aocNonRefUsable = Math.min(ec.aocNonRefundable, availBeforeAoc);
  const llcUsable = Math.min(ec.llcApplied, Math.max(0, availBeforeAoc - ec.aocNonRefundable));
  const usableTotal = aocNonRefUsable + llcUsable;
  if (usableTotal < line19 - 0.005) {
    partII.push(
      moneyLine("", "Credit Limit Worksheet — income tax remaining before education credits", availBeforeAoc, {
        indent: 1,
        note: "Income tax (regular + AMT) less the foreign tax and dependent care credits, per the engine's Schedule-3 ordering.",
      }),
      moneyLine("", "⚠ Portion of line 19 actually usable against tax (engine-applied)", usableTotal, {
        emphasis: true,
        note: "The tax-liability limit binds — the excess nonrefundable education credit is lost (no carryforward under §25A).",
      }),
    );
  }

  const footnotes: string[] = [];
  if (isMfs) {
    footnotes.push(
      "MARRIED FILING SEPARATELY: §25A(g)(6) bars BOTH education credits for MFS filers — the engine correctly computes $0. The eligible-student count is shown so the lost credit is visible for filing-status planning.",
    );
  }
  footnotes.push(
    "Engine MAGI = AGI without the §911/§931/§933 foreign-exclusion add-backs — the phase-out may be understated for FEIE/possessions filers.",
    "The Form 8863 line-7 checkbox rule (taxpayer under 24 meeting the §25A(i)(6)/kiddie-tax conditions gets NO refundable AOC) is not modeled — CPA verifies before relying on line 8.",
    "Per-student Part III facts (student name/TIN, institution EIN, the 4-prior-year AOC limit, half-time enrollment, felony drug conviction) are CPA-supplied — the engine takes per-student qualified-expense amounts (`qualified_education_expenses_aoc`, one adjustment per student) as given.",
    "Line 19 is capped at remaining income tax by the engine's credit pipeline (after the foreign tax + dependent care credits, before Saver's/energy/adoption/CTC) — a binding cap is disclosed above; unused education credit does not carry forward.",
    "Workpaper amounts are engine-exact (cents); the official form rounds to whole dollars.",
  );

  return {
    formId: "8863",
    formNumber: "Form 8863",
    title: "Education Credits (American Opportunity and Lifetime Learning Credits)",
    subtitle: "Refundable AOC + nonrefundable education credits — substitute workpaper (TY2024 line layout)",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — Refundable American Opportunity Credit (lines 1–8)", lines: partI },
      { title: "Part II — Nonrefundable Education Credits (lines 9–19)", lines: partII },
    ],
    footnotes,
  };
}
