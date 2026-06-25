/**
 * T2.1 — Form 8962 (Premium Tax Credit) workpaper builder.
 *
 * Renders the engine's §36B reconciliation (`ret.premiumTaxCredit`,
 * `calculatePremiumTaxCredit` in taxCalculator.ts) against the official
 * TY2024 Form 8962 layout:
 *   Part I  — Annual contribution amount (lines 1–8a)
 *   Part II — PTC claim + APTC reconciliation (annual lines 11a–11f, 24–26)
 *   Part III — Repayment of excess APTC (lines 27–29), only when APTC > PTC
 *
 * Engine semantics (verified vs source 2026-06-09):
 *   - computedPtc = min(annualPremium, max(0, annualSlcsp − MAGI×applicableFigure))
 *   - netPtc > 0 → refundable credit (Schedule 3 line 9, added to the refund);
 *     netPtc < 0 → excess APTC repayment (Schedule 2 line 2), bundled INTO
 *     ret.federalTaxLiability, capped at the income-tier repayment limitation
 *     when household income < 400% FPL (Infinity = no cap).
 *   - MFS → ineligible (§36B(c)(1)(C)): full APTC repayment, no limitation.
 *   - Missing premium/SLCSP/household size → no PTC, full APTC repayment.
 *
 * PURE — no Date/random/DB/pdfkit. Amounts engine-exact (cents).
 */

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

export function buildForm8962(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const ptc = ret.premiumTaxCredit;

  // Applicable when any reconciliation activity exists: advance APTC received,
  // a computed PTC, or a nonzero net (either direction).
  if (!(ptc.advanceAptc > 0 || nz(ptc.netPtc) || ptc.computedPtc > 0)) return null;

  const isMfs = ret.filingStatus === "married_filing_separately";
  const netRefundable = Math.max(0, ptc.netPtc); // → Schedule 3 line 9
  const repayment = Math.max(0, -ptc.netPtc); // → Schedule 2 line 2

  // ── Part I — Annual and monthly contribution amount (lines 1–8a) ──
  const partI: FormLine[] = [];
  if (ptc.eligible) {
    partI.push(
      countLine("1", "Tax family size", ptc.householdSize, {
        note: "Engine default: filer + spouse (MFJ) + dependents; overridable via the client acaHouseholdSize field.",
      }),
      moneyLine("2a", "Modified AGI", ptc.modifiedAgi, {
        note: "Engine MAGI = AGI as computed — §36B(d)(2)(B) add-backs (tax-exempt interest, nontaxable Social Security, FEIE) not modeled.",
      }),
      moneyLine("3", "Household income", ptc.modifiedAgi, {
        note: "Dependents' MAGI (line 2b) not modeled.",
      }),
      moneyLine("4", "Federal poverty line for the family size", ptc.fplGuideline, {
        note: "48 contiguous states + DC table, prior-year HHS guidelines per §36B(d)(3)(B); AK/HI tables not modeled.",
      }),
      pctLine("5", "Household income as a percentage of the federal poverty line", ptc.fplFraction, {
        note: `${(ptc.fplFraction * 100).toFixed(0)}% of FPL — ARPA/IRA enhanced schedule (no 400% eligibility cliff through 2025).`,
      }),
      pctLine("7", "Applicable figure", ptc.applicableFigure, {
        note: "Linear-interpolated contribution percentage (0% at 150% FPL rising to 8.5% at 400%+).",
      }),
      moneyLine("8a", "Annual contribution amount (line 3 × line 7)", ptc.expectedContribution, {
        emphasis: true,
      }),
    );
  } else {
    partI.push(
      textLine(
        "",
        "PTC eligibility",
        isMfs
          ? "Not eligible — married filing separately (§36B(c)(1)(C))"
          : "Not eligible — premium, SLCSP, or household size missing/zero",
        {
          note: isMfs
            ? "The domestic-abuse/abandonment exception is not modeled. ALL advance APTC must be repaid without limitation."
            : "Without eligibility, all advance APTC is repayable in full.",
        },
      ),
    );
  }

  // ── Part II — Premium tax credit claim and reconciliation (annual calc) ──
  const maxPremiumAssistance = Math.max(0, ptc.annualSlcsp - ptc.expectedContribution);
  const partII: FormLine[] = [];
  if (ptc.eligible) {
    partII.push(
      moneyLine("11a", "Annual enrollment premiums (Form 1095-A line 33A)", ptc.annualPremium),
      moneyLine("11b", "Annual applicable SLCSP premium (Form 1095-A line 33B)", ptc.annualSlcsp),
      moneyLine("11c", "Annual contribution amount (line 8a)", ptc.expectedContribution),
      moneyLine("11d", "Annual maximum premium assistance (line 11b − 11c, not below $0)", maxPremiumAssistance),
      moneyLine("11e", "Annual premium tax credit allowed (smaller of line 11a or 11d)", ptc.computedPtc),
      moneyLine("11f", "Annual advance payment of PTC (Form 1095-A line 33C)", ptc.advanceAptc),
    );
  }
  partII.push(
    moneyLine("24", "Total premium tax credit", ptc.computedPtc, { emphasis: true }),
    moneyLine("25", "Advance payment of PTC", ptc.advanceAptc),
  );
  if (netRefundable > 0) {
    partII.push(
      moneyLine("26", "Net premium tax credit (line 24 − line 25) → Schedule 3, line 9", netRefundable, {
        emphasis: true,
        note: "Refundable — added to the refund by the engine alongside EITC/ACTC.",
      }),
      checkLine("Net PTC ties to engine refundable amount", ptc.computedPtc - ptc.advanceAptc, netRefundable),
    );
  }
  if (ptc.eligible) {
    partII.push(
      checkLine("Line 11e ties: min(premium, max(0, SLCSP − contribution))", Math.min(ptc.annualPremium, maxPremiumAssistance), ptc.computedPtc),
    );
  }

  // ── Part III — Repayment of excess advance payment (lines 27–29) ──
  const parts = [
    { title: "Part I — Annual and Monthly Contribution Amount", lines: partI },
    { title: "Part II — Premium Tax Credit Claim and Reconciliation of Advance Payment (annual calculation)", lines: partII },
  ];
  if (repayment > 0 || ptc.advanceAptc > ptc.computedPtc) {
    const excess = Math.max(0, ptc.advanceAptc - ptc.computedPtc);
    // FC-10 + T1.0d #14 — the engine's repayment-cap sentinel is NULL (no
    // limitation: ≥400% FPL, TY2026+ post-OBBBA repeal, or no determinable
    // tier). A real finite cap renders the Table-5 row — including on the MFS
    // path (the 8962 instructions apply Table 5 to each MFS spouse
    // separately, "all other filing statuses" column).
    const realCap = ptc.repaymentCap != null && ptc.repaymentCap > 0 ? ptc.repaymentCap : null;
    const partIII: FormLine[] = [
      moneyLine("27", "Excess advance payment of PTC (line 25 − line 24)", excess),
      realCap != null
        ? moneyLine("28", "Repayment limitation (instructions Table 5, by household income tier)", realCap, {
            note: isMfs
              ? "MFS — ineligible for the PTC (§36B(c)(1)(C)) but Table 5 still limits the repayment, applied to each spouse separately ('all other filing statuses' column)."
              : "Applies only when household income < 400% of FPL — see the cap-tier footnote.",
          })
        : textLine("28", "Repayment limitation", null, {
            note: ret.taxYear >= 2026
              ? "No limitation — OBBBA (P.L. 119-21) struck §36B(f)(2)(B) for tax years beginning after 12/31/2025: full repayment at every income level (IRS FS 2025-10)."
              : ptc.eligible
                ? "No limitation — household income ≥ 400% of FPL: full repayment."
                : isMfs
                  ? "No limitation — MFS (§36B(c)(1)(C)) with no determinable Table 5 tier: full repayment."
                  : "No limitation — no PTC eligibility computed: full repayment.",
          }),
      moneyLine("29", "Excess advance PTC repayment (smaller of line 27 or 28) → Schedule 2, line 2", repayment, {
        emphasis: true,
        note: "Bundled into the engine's total federal tax liability.",
      }),
      checkLine("Repayment ties: min(excess, limitation)", realCap != null ? Math.min(excess, realCap) : excess, repayment),
    ];
    parts.push({ title: "Part III — Repayment of Excess Advance Payment of the Premium Tax Credit", lines: partIII });
  }

  return {
    formId: "8962",
    formNumber: "Form 8962",
    title: "Premium Tax Credit (PTC)",
    subtitle: "§36B reconciliation of the premium tax credit with advance payments (Form 1095-A)",
    taxYear: ret.taxYear,
    parts,
    footnotes: [
      "FC-23 — engine MAGI for §36B = AGI + tax-exempt interest + nontaxable Social Security + the §911 FEIE exclusion (§36B(d)(2)(B)). Dependents'-own-income inclusion is NOT modeled — CPA verifies household income.",
      "Annual-only reconciliation (line 11). Monthly lines 12–23, shared-policy allocation (Part IV), and the alternative calculation for year of marriage (Part V) are not modeled.",
      "Federal poverty line uses the 48-contiguous-states + DC table (prior-year HHS guidelines); Alaska/Hawaii higher guidelines not modeled.",
      "FC-01 — applicable percentages: TY2024/2025 use the ARPA/IRA enhanced schedule (0% below 150% FPL, 8.5% top, no 400% cliff — expired after 2025); TY2026+ uses Rev. Proc. 2025-25 Table 2 (2.10% under 133% FPL up to 9.96% in the 300–400% band) and the 400%-FPL eligibility cliff returns. Household income below 100% FPL → no PTC any year (§36B(c)(1)(A); the APTC-was-advanced §1.36B-2(b)(6) exception is not modeled).",
      "Repayment limitation tiers (line 28; Single column / all-other-statuses column per §36B(f)(2)(B)(i) — FC-10): TY2024 (Rev. Proc. 2023-34) <200% FPL $375/$750, <300% $950/$1,900, <400% $1,575/$3,150; TY2025 (Rev. Proc. 2024-40) $400/$800, $1,050/$2,100, $1,750/$3,500; ≥400% FPL no limit. TY2026+: NO limitation at any income — OBBBA struck §36B(f)(2)(B) for tax years beginning after 12/31/2025.",
      "Engine convention: excess APTC repayment (line 29) is bundled INTO federalTaxLiability (Schedule 2 line 2) AND is part of the nonrefundable-credit base (Form 1040 line 18 — FC-09); net PTC (line 26) is a refundable credit added to the refund (Schedule 3 line 9).",
    ],
  };
}
