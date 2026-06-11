/**
 * T2.2 D1 + D3 — Year-over-year comparison, OBBBA-impact isolation, and
 * proactive threshold-crossing alerts.
 *
 * Compares two computed returns (prior vs current — works for any two years,
 * incl. a baseline-vs-projection pair) and surfaces:
 *   - line-by-line deltas (income/AGI/taxable/tax/refund/credits) with %-change
 *   - notable swings (large absolute + relative moves the CPA should explain)
 *   - threshold CROSSINGS observed directly from the two returns — entering or
 *     exiting NIIT (§1411), Additional Medicare (§3101(b)(2)), AMT, the §199A
 *     wage/UBIA phase-in, a refund→balance-due flip, and the first IRMAA
 *     Medicare-premium tier (a 2-year-MAGI lookback, approximated by AGI)
 *   - the OBBBA law-change benefit (Schedule 1-A tips/overtime/car-loan/senior
 *     that a pre-2025 year did not have)
 *
 * PURE (no Date/random/DB) — Haven-portable. No re-derivation of thresholds for
 * the surtaxes: a tax going 0 → positive across the two years is the crossing.
 */

import type { ComputedTaxReturn } from "./taxReturnEngine";
import { resolveTaxYear, type TaxYear } from "./taxCalculator";

export interface LineDelta {
  label: string;
  prior: number;
  current: number;
  /** current − prior. */
  change: number;
  /** Fractional change (current/prior − 1); null when prior is 0. */
  pctChange: number | null;
}

export type CrossingDirection = "entered" | "exited";

export interface ThresholdCrossing {
  id: string;
  label: string;
  direction: CrossingDirection;
  detail: string;
}

export interface YearOverYearResult {
  priorYear: number;
  currentYear: number;
  deltas: LineDelta[];
  notableSwings: LineDelta[];
  thresholdCrossings: ThresholdCrossing[];
  obbbaImpact: {
    priorTotal: number;
    currentTotal: number;
    /** New OBBBA Schedule 1-A benefit this year vs the prior year. */
    newBenefit: number;
    note: string;
  };
  /**
   * YOY-2 — data-quality caveats on the comparison (e.g. the "prior year" was
   * computed from the client's CURRENT non-year-scoped adjustment set re-run
   * under prior-year law because no year-scoped documents exist for that year).
   */
  caveats: string[];
}

function delta(label: string, prior: number, current: number): LineDelta {
  const change = current - prior;
  const pctChange = Math.abs(prior) < 0.005 ? null : change / prior;
  return { label, prior, current, change, pctChange };
}

/**
 * YOY-1 — IRMAA Part-B MAGI tier thresholds, YEAR-INDEXED per the repo
 * freshness convention (`Record<TaxYear>` — a missing supported year is a
 * compile error). Each return's AGI is compared against ITS OWN year's table
 * (pre-fix, the 2024 table flagged a phantom 2025→2026 tier-1 entry at
 * $107k). Sources: CMS premium announcements / SSA POMS HI 01101.020 —
 *   2024: single 103k/129k/161k/193k/500k; MFJ 206k/258k/322k/386k/750k; MFS >103k → tier 4, ≥397k → tier 5.
 *   2025: single 106k/133k/167k/200k/500k; MFJ 212k/266k/334k/400k/750k; MFS 106k / 394k.
 *   2026 (CMS 2026 Parts A&B fact sheet): single 109k/137k/171k/205k/500k; MFJ 218k/274k/342k/410k/750k; MFS 109k / 391k.
 * MFS (lived with spouse) has only TWO surcharge levels, mapped to tiers 4/5
 * (the SSA premium-table rows they correspond to); MFS-lived-apart-all-year is
 * treated as single by SSA — not distinguishable from the return, so the MFS
 * table is the conservative default. Approximation (documented): real IRMAA
 * premiums for year Y+2 use year-Y MAGI vs the year-(Y+2) thresholds; this
 * advisory flags the crossing as a Medicare-premium heads-up.
 */
const IRMAA_TIERS: Record<TaxYear, { single: number[]; joint: number[]; mfs: number[] }> = {
  2024: {
    single: [103_000, 129_000, 161_000, 193_000, 500_000],
    joint: [206_000, 258_000, 322_000, 386_000, 750_000],
    mfs: [103_000, 103_000, 103_000, 103_000, 397_000],
  },
  2025: {
    single: [106_000, 133_000, 167_000, 200_000, 500_000],
    joint: [212_000, 266_000, 334_000, 400_000, 750_000],
    mfs: [106_000, 106_000, 106_000, 106_000, 394_000],
  },
  2026: {
    single: [109_000, 137_000, 171_000, 205_000, 500_000],
    joint: [218_000, 274_000, 342_000, 410_000, 750_000],
    mfs: [109_000, 109_000, 109_000, 109_000, 391_000],
  },
};

type IrmaaColumn = "single" | "joint" | "mfs";

export function irmaaTier(agi: number, column: IrmaaColumn, taxYear: number): number {
  const tiers = IRMAA_TIERS[resolveTaxYear(taxYear)][column];
  let tier = 0;
  for (const t of tiers) if (agi > t) tier++;
  return tier; // 0 = no surcharge, 1..5 = IRMAA tier
}

function irmaaColumnFor(filingStatus: string): IrmaaColumn {
  if (filingStatus === "married_filing_jointly" || filingStatus === "qualifying_widow") return "joint";
  if (filingStatus === "married_filing_separately") return "mfs";
  return "single";
}

export function computeYearOverYear(args: {
  priorReturn: ComputedTaxReturn;
  currentReturn: ComputedTaxReturn;
  /**
   * YOY-2 — whether the prior year had any YEAR-SCOPED input documents
   * (W-2 / 1099 / K-1 / rental / capital-transaction rows tagged with that
   * tax year). When FALSE while the prior year still shows income, the
   * "prior year" is really the client's current non-year-scoped adjustment
   * set re-run under prior-year law — flagged in `caveats`. Omitted = no
   * caveat (caller didn't inspect the rows).
   */
  priorYearScopedDocsPresent?: boolean;
}): YearOverYearResult {
  const p = args.priorReturn;
  const c = args.currentReturn;

  const deltas: LineDelta[] = [
    delta("Total income", p.totalIncome, c.totalIncome),
    delta("Adjusted gross income", p.adjustedGrossIncome, c.adjustedGrossIncome),
    delta("Taxable income", p.taxableIncome, c.taxableIncome),
    delta("Federal tax (pre-credit)", p.federalTaxLiability, c.federalTaxLiability),
    delta("State tax", p.stateTaxLiability, c.stateTaxLiability),
    delta("Self-employment tax", p.selfEmploymentTax, c.selfEmploymentTax),
    delta("Net investment income tax", p.niitTax, c.niitTax),
    delta("Additional Medicare tax", p.additionalMedicareTax, c.additionalMedicareTax),
    delta("Alternative minimum tax", p.amtTax, c.amtTax),
    delta("QBI deduction (§199A)", p.qbiDeduction, c.qbiDeduction),
    delta("Child Tax Credit (applied)", p.childTaxCredit.appliedCredit, c.childTaxCredit.appliedCredit),
    delta("Earned Income Tax Credit", p.eitc.appliedCredit, c.eitc.appliedCredit),
    delta("Federal refund/(owed)", p.federalRefundOrOwed, c.federalRefundOrOwed),
    delta("Effective tax rate", p.effectiveTaxRate, c.effectiveTaxRate),
  ];

  // Notable swings: a meaningful absolute AND relative move (effective rate is
  // tracked separately since it is a small-magnitude ratio).
  const notableSwings = deltas.filter((d) => {
    if (d.label === "Effective tax rate") return Math.abs(d.change) >= 0.02; // ≥2 pts
    return Math.abs(d.change) >= 1_000 && (d.pctChange == null || Math.abs(d.pctChange) >= 0.20);
  });

  // ── Threshold crossings (observed directly from the two returns) ──
  const crossings: ThresholdCrossing[] = [];
  const surtax = (id: string, label: string, pv: number, cv: number, detail: string) => {
    if (pv <= 0.005 && cv > 0.005) crossings.push({ id, label, direction: "entered", detail });
    else if (pv > 0.005 && cv <= 0.005) crossings.push({ id, label, direction: "exited", detail });
  };
  surtax("niit", "Net Investment Income Tax (§1411)", p.niitTax, c.niitTax,
    "The 3.8% NIIT now applies — MAGI crossed the $200k single / $250k MFJ / $125k MFS threshold with net investment income. Consider gain-harvesting timing, muni bonds, or installment sales to manage MAGI.");
  surtax("addl-medicare", "Additional Medicare Tax (§3101(b)(2))", p.additionalMedicareTax, c.additionalMedicareTax,
    "The 0.9% Additional Medicare Tax now applies on wages + SE earnings over the filing-status threshold. Verify employer withholding on Form 8959.");
  surtax("amt", "Alternative Minimum Tax", p.amtTax, c.amtTax,
    "AMT now applies. Review the preference items (ISO exercises, large SALT, private-activity-bond interest) and whether to spread ISO exercises across years.");

  // §199A wage/UBIA phase-in started binding (high earners losing QBI).
  const pBinds = p.detail?.qbi?.wageUbiaLimitBinds === true;
  const cBinds = c.detail?.qbi?.wageUbiaLimitBinds === true;
  if (!pBinds && cBinds) {
    crossings.push({
      id: "qbi-phasein",
      label: "§199A QBI wage/UBIA limit",
      direction: "entered",
      detail: "Taxable income crossed the §199A phase-in: the QBI deduction is now limited by W-2 wages / UBIA (and barred for an SSTB above the ceiling). Consider wage/retirement-plan changes or income timing to restore the deduction.",
    });
  }

  // Refund → balance-due flip.
  if (p.federalRefundOrOwed >= 0 && c.federalRefundOrOwed < 0) {
    crossings.push({
      id: "refund-to-owed",
      label: "Refund → balance due",
      direction: "entered",
      detail: `The federal position flipped from a refund to owing $${Math.round(-c.federalRefundOrOwed).toLocaleString()}. Check withholding (W-4) and whether quarterly estimates are needed to avoid a §6654 penalty.`,
    });
  }

  // IRMAA Medicare-premium tier increase (AGI proxy for MAGI). Each year's AGI
  // is measured against ITS OWN year's threshold table (YOY-1); MFS uses the
  // compressed MFS column.
  const pIrmaa = irmaaTier(p.adjustedGrossIncome, irmaaColumnFor(p.filingStatus), p.taxYear);
  const cIrmaa = irmaaTier(c.adjustedGrossIncome, irmaaColumnFor(c.filingStatus), c.taxYear);
  if (cIrmaa > pIrmaa) {
    crossings.push({
      id: "irmaa-tier",
      label: `IRMAA Medicare-premium tier ${pIrmaa} → ${cIrmaa}`,
      direction: "entered",
      detail: "MAGI moved into a higher IRMAA tier, which raises Medicare Part B & D premiums (assessed on a 2-year lookback). For a client at/near 63+, consider Roth-conversion timing, QCDs, or capital-gain spreading to stay under the next tier.",
    });
  } else if (cIrmaa < pIrmaa) {
    crossings.push({
      id: "irmaa-tier",
      label: `IRMAA Medicare-premium tier ${pIrmaa} → ${cIrmaa}`,
      direction: "exited",
      detail: "MAGI dropped to a lower IRMAA tier — Medicare premiums fall (2-year lookback).",
    });
  }

  const obbbaNew = c.obbbaSchedule1A.total - p.obbbaSchedule1A.total;

  // YOY-2 — adjustments (and client-level facts like SS benefits / ACA) are
  // not year-scoped in this schema; without year-scoped documents the prior
  // year is the CURRENT data re-run under prior-year law.
  const caveats: string[] = [];
  if (args.priorYearScopedDocsPresent === false && p.totalIncome > 0.005) {
    caveats.push(
      `No TY${p.taxYear} year-scoped documents (W-2/1099/K-1/rental/capital-transaction rows) were found — the prior year reflects the client's current adjustment set re-computed under TY${p.taxYear} law. Deltas and crossings then measure LAW changes, not actual income changes.`,
    );
  }

  return {
    priorYear: p.taxYear,
    currentYear: c.taxYear,
    deltas,
    notableSwings,
    thresholdCrossings: crossings,
    caveats,
    obbbaImpact: {
      priorTotal: p.obbbaSchedule1A.total,
      currentTotal: c.obbbaSchedule1A.total,
      newBenefit: obbbaNew,
      note:
        obbbaNew > 0.005
          ? `OBBBA Schedule 1-A deductions (tips/overtime/car-loan/senior) provide $${Math.round(obbbaNew).toLocaleString()} more deduction this year than the prior year. These sunset after TY2028.`
          : p.obbbaSchedule1A.total > 0 && c.obbbaSchedule1A.total === 0
            ? "OBBBA Schedule 1-A deductions are no longer claimed this year (verify the qualifying income / age still applies, or the TY2028 sunset)."
            : "No OBBBA Schedule 1-A deductions in either year.",
    },
  };
}
