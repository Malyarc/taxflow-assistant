/**
 * T2.1 — Schedule 2 (Form 1040): "Additional Taxes".
 *
 * Substitute-form workpaper (Pub 1167 conventions). Line numbers follow the
 * official TY2024 Schedule 2.
 *
 * Tie-out identity (mirrors the engine's federalTaxLiability assembly):
 *
 *   regular income tax (Form 1040 line 16) + Part I (line 3) + Part II (line 21)
 *     == ret.federalTaxLiability
 *
 * where the engine bundles the Schedule 2 taxes INTO its pre-credit
 * federalTaxLiability:
 *   federalTaxLiability = regularTax + amtTax + max(0,−netPtc)        ← Part I
 *     + selfEmploymentTax + earlyWithdrawalPenalty + hsaExcessExcise
 *     + scheduleH.total + additionalMedicareTax + niitTax             ← Part II
 *
 * So the "regular income tax" residual is exact: federalTaxLiability minus the
 * eight other-tax components. A checkLine proves the parts reconcile.
 */

import {
  checkLine,
  moneyLine,
  nz,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

export function buildSchedule2(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;

  const excessAptcRepayment = Math.max(0, -ret.premiumTaxCredit.netPtc);

  // ── Part I — Tax (AMT + APTC repayment) ──
  const partILines: FormLine[] = [];
  if (nz(ret.amtTax)) {
    partILines.push(
      moneyLine("1", "Alternative minimum tax (Form 6251)", ret.amtTax, {
        note: "Excess of tentative minimum tax over regular tax (Form 6251 line 11).",
      }),
    );
  }
  if (nz(excessAptcRepayment)) {
    partILines.push(
      moneyLine("2", "Excess advance premium tax credit repayment (Form 8962)", excessAptcRepayment, {
        note: "Advance APTC received over the allowable PTC, capped by the §36B(f)(2)(B) repayment-limitation table.",
      }),
    );
  }
  const line3 = ret.amtTax + excessAptcRepayment;
  partILines.push(moneyLine("3", "Total Part I — add to Form 1040 line 17", line3, { emphasis: true }));

  // ── Part II — Other taxes ──
  const partIILines: FormLine[] = [];
  if (nz(ret.selfEmploymentTax)) {
    partIILines.push(
      moneyLine("4", "Self-employment tax (Schedule SE)", ret.selfEmploymentTax, {
        note: "15.3% on net SE earnings (12.4% OASDI to the wage base + 2.9% Medicare).",
      }),
    );
  }
  // Line 8 — additional tax on early distributions (Form 5329 Part I) and the
  // §4973 HSA excise (Form 5329 Part VII); both are reported on Schedule 2
  // line 8 / via Form 5329.
  if (nz(ret.earlyWithdrawalPenalty)) {
    partIILines.push(
      moneyLine("8", "Additional tax on early distributions §72(t) (Form 5329 Part I)", ret.earlyWithdrawalPenalty, {
        note: "10% (Box 7 code 1) / 25% (SIMPLE code S) on the taxable early-distribution amount.",
      }),
    );
  }
  if (nz(ret.hsaExcessExcise)) {
    partIILines.push(
      moneyLine("8", "Excise tax on excess HSA contributions §4973 (Form 5329 Part VII)", ret.hsaExcessExcise, {
        indent: 1,
        note: "6% of the contribution over the §223 annual limit.",
      }),
    );
  }
  if (nz(ret.scheduleH.total)) {
    partIILines.push(
      moneyLine("9", "Household employment taxes (Schedule H)", ret.scheduleH.total, {
        note: "FICA on household-employee cash wages ≥ the §3121(a)(7) threshold + FUTA (0.6% net).",
      }),
    );
  }
  if (nz(ret.additionalMedicareTax)) {
    partIILines.push(
      moneyLine("11", "Additional Medicare tax (Form 8959)", ret.additionalMedicareTax, {
        note: "0.9% on Medicare wages + SE earnings over the filing-status threshold.",
      }),
    );
  }
  if (nz(ret.niitTax)) {
    partIILines.push(
      moneyLine("12", "Net investment income tax (Form 8960)", ret.niitTax, {
        note: "3.8% on the lesser of net investment income or MAGI over the §1411 threshold.",
      }),
    );
  }
  const line21 =
    ret.selfEmploymentTax +
    ret.earlyWithdrawalPenalty +
    ret.hsaExcessExcise +
    ret.scheduleH.total +
    ret.additionalMedicareTax +
    ret.niitTax;
  partIILines.push(moneyLine("21", "Total Part II — add to Form 1040 line 23", line21, { emphasis: true }));

  // Tie-out: regular income tax is the residual; parts must reconcile to the
  // engine's pre-credit federal liability.
  const regularTax = ret.federalTaxLiability - line3 - line21;
  partIILines.push(
    moneyLine("", "Regular income tax (Form 1040 line 16, residual)", regularTax, {
      note: "= total federal tax (line 24) − Schedule 2 Part I − Part II. Includes the capital-gains preferential-rate method.",
    }),
  );
  partIILines.push(
    checkLine(
      "Regular tax + Schedule 2 Part I + Part II = total federal tax (engine pre-credit liability)",
      regularTax + line3 + line21,
      ret.federalTaxLiability,
    ),
  );

  if (!nz(line3) && !nz(line21)) return null;

  return {
    formId: "schedule-2",
    formNumber: "Schedule 2 (Form 1040)",
    title: "Additional Taxes",
    subtitle: "Substitute workpaper — engine-exact amounts tied to Form 1040 lines 17 and 23.",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — Tax (Form 1040 line 17)", lines: partILines },
      { title: "Part II — Other Taxes (Form 1040 line 23)", lines: partIILines },
    ],
    footnotes: [
      "The engine bundles all Schedule 2 taxes into its pre-credit \"total federal tax\" (Form 1040 line 24); nonrefundable credits are netted afterward (see Schedule 3 + the Reconciliation Worksheet).",
      "Lines 8 (§72(t) early-distribution tax + §4973 HSA excise) are reported via Form 5329; the engine does not honor §72(t) exceptions automatically (CPA enters Form 5329 exception codes).",
      "The regular-income-tax residual row is exact (total federal tax minus the eight modeled other-tax components) and equals Form 1040 line 16.",
    ],
  };
}
