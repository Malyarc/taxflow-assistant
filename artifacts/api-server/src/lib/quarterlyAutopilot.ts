/**
 * G-4 — Quarterly Estimate Autopilot.
 *
 * Converts a once-a-year prep client into a 4×/yr advisory subscription: take an
 * ALREADY-FETCHED year-to-date income snapshot (the live product pulls it from
 * QuickBooks Online / Gusto / Plaid via OAuth — that connector is a route/adapter,
 * NOT this module), annualize it, re-size the §6654 safe-harbor estimate, refresh
 * the four 1040-ES vouchers against payments made so far, classify each voucher's
 * status as of a caller-supplied date, and emit client-ready reminder strings with
 * IRS Direct Pay context.
 *
 * ── PURITY (Haven-portable) ──────────────────────────────────────────────────
 * NO `Date`/`new Date()`/`Math.random`/DB/fs/network/`process`. The "as-of date"
 * and ALL feed data are PARAMETERS. Date math is done on ISO `YYYY-MM-DD` strings
 * (which sort lexically) via pure integer arithmetic — never the `Date` object —
 * so the same call always yields the same result regardless of wall-clock/timezone.
 *
 * ── KEY SEAM: the income feed ────────────────────────────────────────────────
 * This module computes over an `IncomeFeedSnapshot` — a structured YTD summary.
 * Building that snapshot (OAuth to QBO/Gusto/Plaid, mapping their ledgers to
 * net-SE / wages / withholding) is the live connector's job and lives in a route
 * adapter. Suggested endpoint: `POST /clients/:clientId/quarterly-autopilot` with
 * an optional `{ feed, paymentsByQuarter, asOfDate }` body → this module's
 * `AutopilotResult` as JSON.
 *
 * ── §6654 reuse ──────────────────────────────────────────────────────────────
 * The safe-harbor target is sized by `computeForm2210` (form2210.ts) — the SAME
 * §6654 Part-I "required annual payment" the projection planner uses — fed a
 * RE-PROJECTED return when a feed is supplied. We mirror `computeTaxProjection`'s
 * (taxProjection.ts) harbor pattern: required = min(90% of the projected/current
 * year's tax, 100%/110% of the prior year's tax). Per §6654(d)(1)(C) the
 * prior-year multiplier is 110% when prior-year AGI exceeds $150,000 ($75,000 MFS).
 *
 * Statutory installment due dates (§6654(c)(2)): Apr 15, Jun 15, Sep 15 of the tax
 * year and Jan 15 of the following year. See `quarterlyDueDates` for the §7503
 * weekend-roll note (kept OUT here — documented assumption; the projection
 * planner's `voucherDueDates` applies the roll if a route prefers it).
 */

import {
  computeTaxReturnPure,
  toNum,
  type TaxReturnInputs,
  type ComputedTaxReturn,
} from "./taxReturnEngine";
import { computeForm2210 } from "./form2210";

// ── 1. Income feed snapshot (the adapter's output; this module's input) ───────
export interface IncomeFeedSnapshot {
  /** YYYY-MM-DD — the date through which the YTD figures are current. */
  asOfDate: string;
  /** YTD net Schedule C / self-employment profit (already net of expenses). */
  ytdNetSelfEmployment?: number;
  /** YTD W-2 wages (Box 1). */
  ytdWages?: number;
  /** YTD federal income tax withheld (W-2 Box 2 + 1099 withholding). */
  ytdFederalWithheld?: number;
  /** YTD other ordinary income (interest, dividends, etc.). */
  ytdOtherIncome?: number;
  /** Months of data the YTD figures reflect, 1-12, used to annualize (×12/m). */
  monthsElapsed: number;
}

// ── 2. A single quarterly 1040-ES voucher ─────────────────────────────────────
export interface QuarterlyVoucher {
  quarter: 1 | 2 | 3 | 4;
  /** Statutory installment due date (ISO YYYY-MM-DD). */
  dueDate: string;
  /** The required installment for this quarter (the even ¼ + any re-split catch-up). */
  amount: number;
  /** Amount the client has already paid toward this installment. */
  alreadyPaid: number;
  /** max(0, amount − alreadyPaid). */
  remainingDue: number;
  /**
   * "paid" — fully covered (remainingDue ≤ 0).
   * "due" — the current installment (asOfDate ≤ dueDate) with a balance.
   * "upcoming" — a future installment (asOfDate ≤ dueDate, not the next-due one).
   * "overdue" — past its dueDate with an unpaid balance.
   */
  status: "paid" | "due" | "upcoming" | "overdue";
}

// ── 3. The autopilot result (the JSON the endpoint returns) ───────────────────
export interface AutopilotResult {
  taxYear: number;
  asOfDate: string;
  /** Annualized projected total income for the year. */
  projectedAnnualIncome: number;
  /** §6654 current-year tax (total tax net of refundable credits) for the projection. */
  projectedAnnualTax: number;
  /** The §6654 required annual payment (the safe-harbor target). */
  safeHarborTarget: number;
  /** Which harbor bound set the target. */
  safeHarborBasis: "90%_current" | "100%_prior" | "110%_prior";
  vouchers: QuarterlyVoucher[];
  /** Sum of the four voucher amounts (= the safe-harbor target net of withholding). */
  totalRequired: number;
  /** Sum of the payments credited across the four quarters. */
  totalPaidToDate: number;
  /** max(0, totalRequired − totalPaidToDate). */
  remainingToPay: number;
  /** The soonest unpaid installment as of `asOfDate` (null when all are paid). */
  nextVoucher: QuarterlyVoucher | null;
  /** Client-ready reminder strings (with IRS Direct Pay context). */
  reminders: string[];
  /** Disclosed modeling assumptions (annualization, weekend-roll, harbor basis). */
  assumptions: string[];
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** §6654(d)(1)(C) — prior-year AGI above this makes the prior-year harbor 110%. */
const PRIOR_YEAR_110_AGI_THRESHOLD = 150_000;

/**
 * §6654(c)(2) — the four 1040-ES installment due dates for `taxYear`, as ISO
 * `YYYY-MM-DD` strings: Apr 15, Jun 15, Sep 15 of the tax year, and Jan 15 of the
 * FOLLOWING year. Built by pure string arithmetic (no `Date`) so the module stays
 * Haven-portable.
 *
 * §7503 WEEKEND ROLL — NOT applied here (a documented assumption): when a date
 * lands on a Saturday/Sunday (or a §7503 legal holiday) the true deadline rolls to
 * the next business day. This module reports the *statutory* dates; computing the
 * roll needs the `Date`-based day-of-week, which would break purity. A route that
 * wants the rolled dates can map each through the projection planner's
 * `voucherDueDates(taxYear)` (taxProjection.ts), which already applies the §7503
 * weekend roll + the deterministic MLK collision for the January installment. The
 * statutory date is never LATER than the true deadline, so a reminder keyed to it
 * is conservatively early — the safe direction.
 */
export function quarterlyDueDates(taxYear: number): string[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    `${taxYear}-04-15`,
    `${taxYear}-06-15`,
    `${taxYear}-09-15`,
    `${taxYear + 1}-${pad(1)}-15`,
  ];
}

/** Human "Month D, YYYY" for an ISO `YYYY-MM-DD` (pure; no `Date`). */
function humanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((s) => Number(s));
  const monthName = MONTH_NAMES[(m ?? 1) - 1] ?? "";
  return `${monthName} ${d}, ${y}`;
}

/** USD with thousands separators, rounded to the dollar (pure). */
function usd(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded).toString();
  let out = "";
  for (let i = 0; i < abs.length; i++) {
    if (i > 0 && (abs.length - i) % 3 === 0) out += ",";
    out += abs[i];
  }
  return `$${sign}${out}`;
}

export interface RunQuarterlyAutopilotArgs {
  /** Current-year (baseline) inputs. */
  baselineInputs: TaxReturnInputs;
  /** Current-year computed return (avoids a redundant recompute). */
  baselineReturn: ComputedTaxReturn;
  /** Prior-year §6654 total tax — enables the prior-year harbor. */
  priorYearTax?: number;
  /** Prior-year AGI — triggers the 110% harbor over the $150k ($75k MFS) threshold. */
  priorYearAgi?: number;
  /**
   * Already-fetched YTD feed. When supplied, the baseline is re-projected to a
   * full-year run with the annualized feed figures; when omitted, the baseline
   * return is used as-is (a static-snapshot estimate).
   */
  feed?: IncomeFeedSnapshot;
  /** Payments already made, indexed by quarter (paymentsByQuarter[0] = Q1, …). */
  paymentsByQuarter?: number[];
  /** YYYY-MM-DD — the "today" against which voucher statuses are classified. */
  asOfDate: string;
}

/**
 * Annualize a YTD feed to a full-year estimate and overlay it on the baseline
 * inputs, re-projecting the return. We scale by 12/monthsElapsed (the standard
 * straight-line annualization — assumes income accrues EVENLY; a back-loaded year
 * is the §6654(d)(2) annualized-installment method's job, modeled separately in
 * `computeForm2210Annualized`). The feed's net-SE / wages / withholding REPLACE the
 * baseline's (the feed is the fresher source); other income lines are carried from
 * the baseline. Returns the re-computed return + the annualized headline income.
 */
function projectFromFeed(
  baselineInputs: TaxReturnInputs,
  baselineReturn: ComputedTaxReturn,
  feed: IncomeFeedSnapshot,
): { ret: ComputedTaxReturn; projectedAnnualIncome: number } {
  const months = Math.min(12, Math.max(1, Math.round(toNum(feed.monthsElapsed) || 1)));
  const factor = 12 / months;
  const ann = (v: number | undefined) => toNum(v) * factor;

  const annualWages = ann(feed.ytdWages);
  const annualWithheld = ann(feed.ytdFederalWithheld);
  const annualSe = ann(feed.ytdNetSelfEmployment);
  const annualOther = ann(feed.ytdOtherIncome);

  // Overlay the annualized feed onto the baseline. Wages + withholding fold into
  // a single representative W-2; net-SE into a self_employment_income adjustment;
  // other ordinary income into an `other_income` adjustment. Everything else on
  // the baseline (state, filing status, dependents, itemized, K-1s, …) is reused
  // so the projection stays a faithful full-return computation, not a stub.
  const w2s = annualWages > 0 || annualWithheld > 0
    ? [{
        taxYear: baselineInputs.taxYear,
        wagesBox1: annualWages,
        federalTaxWithheldBox2: annualWithheld,
        medicareWagesBox5: annualWages,
      }]
    : [];

  const adjustments = [
    ...baselineInputs.adjustments.filter(
      (a) =>
        a.adjustmentType !== "self_employment_income" &&
        a.adjustmentType !== "other_income",
    ),
    ...(annualSe !== 0
      ? [{ adjustmentType: "self_employment_income", amount: annualSe }]
      : []),
    ...(annualOther !== 0
      ? [{ adjustmentType: "other_income", amount: annualOther }]
      : []),
  ] as TaxReturnInputs["adjustments"];

  // Carry the baseline's portfolio / retirement 1099s (DIV / INT / R / B / MISC /
  // G / K) UNCHANGED — the feed refreshes only wages, withholding, net-SE, and
  // other ordinary income, NOT investment/pension income. Drop 1099-NEC
  // (nonemployee compensation = self-employment, which the feed's net-SE figure
  // replaces) so SE isn't double-counted. (audit 2026-06-23 — previously
  // `form1099s: []` wiped ALL baseline 1099 income, collapsing the §6654
  // safe-harbor target and under-billing estimates → real underpayment penalties.)
  // …and zero each carried 1099's federalTaxWithheld: the feed's
  // `ytdFederalWithheld` is documented as the TOTAL (W-2 Box 2 + 1099 withholding)
  // and is folded into the synthetic W-2 above, so leaving it on the carried 1099s
  // too would double-count withholding → overstate payments → undersize the
  // §6654 target (code-review 2026-06-23). State withholding is not in the feed, so
  // it is preserved.
  const carriedForm1099s = (baselineInputs.form1099s ?? [])
    .filter((f) => String((f as { formType?: unknown }).formType ?? "").toUpperCase() !== "NEC")
    .map((f) => ({ ...f, federalTaxWithheld: 0 }));

  const projectedInputs: TaxReturnInputs = {
    ...baselineInputs,
    w2s: w2s as TaxReturnInputs["w2s"],
    form1099s: carriedForm1099s as TaxReturnInputs["form1099s"],
    adjustments,
  };
  const ret = computeTaxReturnPure(projectedInputs);
  return { ret, projectedAnnualIncome: ret.totalIncome };
}

export function runQuarterlyAutopilot(args: RunQuarterlyAutopilotArgs): AutopilotResult {
  const { baselineInputs, baselineReturn, asOfDate } = args;

  // 1. Projection — annualize the feed (if any) into a full-year return.
  const { ret: projectedRet, projectedAnnualIncome } = args.feed
    ? projectFromFeed(baselineInputs, baselineReturn, args.feed)
    : { ret: baselineReturn, projectedAnnualIncome: baselineReturn.totalIncome };

  const taxYear = projectedRet.taxYear;
  const dueDates = quarterlyDueDates(taxYear);

  // 2. §6654 safe-harbor target via the shared Form 2210 Part-I machinery. The
  // PROJECTED return is the "current year"; the prior year (if supplied) bounds it.
  const priorYearAvailable = args.priorYearTax != null;
  const form2210 = computeForm2210({
    ret: projectedRet,
    input: {
      priorYearTax: args.priorYearTax,
      priorYearAgi: args.priorYearAgi,
      priorYearAvailable,
    },
  });

  const safeHarborTarget = form2210.requiredAnnualPayment;
  const projectedAnnualTax = form2210.currentYearTax;

  // Which harbor bound the target? min(90%-current, prior-year-pct × prior tax).
  let safeHarborBasis: AutopilotResult["safeHarborBasis"];
  if (
    form2210.priorYearSafeHarbor != null &&
    form2210.priorYearSafeHarbor < form2210.ninetyPercentCurrent
  ) {
    safeHarborBasis = form2210.priorYearSafeHarborPct >= 1.1 ? "110%_prior" : "100%_prior";
  } else {
    safeHarborBasis = "90%_current";
  }

  // 3. Withholding is credited against the target first (§6654(g) treats W/H as
  // paid evenly across the four installments); estimates cover the remainder,
  // split evenly into four vouchers. The LAST voucher absorbs the rounding remainder.
  const projectedWithholding = form2210.withholding;
  const toCoverViaEstimates = Math.max(0, safeHarborTarget - projectedWithholding);
  const perQuarter = Math.round(toCoverViaEstimates / 4);
  const baseAmounts: number[] = [
    perQuarter,
    perQuarter,
    perQuarter,
    Math.round(toCoverViaEstimates) - perQuarter * 3, // remainder → Q4
  ];

  // 4. Apply payments + RE-SPLIT the still-OPEN quarters so any underpayment/
  // overpayment of the open quarters catches up evenly by year-end, while keeping
  // `totalRequired` equal to the safe-harbor coverage amount (the four vouchers
  // always sum to toCoverViaEstimates). A quarter whose due date has ALREADY
  // passed keeps its base share — if underpaid it shows OVERDUE at its own base
  // (you still owe THAT installment; we don't silently re-pile a missed quarter
  // onto the future, which would double-count it and inflate the year's total).
  // This is the practical "catch-up" figure, distinct from the date-stamped §6654
  // penalty math (which the projection planner + computeForm2210 already model).
  const payments = args.paymentsByQuarter ?? [];
  const paid = [0, 1, 2, 3].map((i) => Math.max(0, toNum(payments[i])));
  const totalPaidToDate = paid.reduce((s, p) => s + p, 0);

  // Indices of quarters whose due date has NOT yet passed (asOfDate ≤ dueDate).
  // ISO dates compare correctly as strings.
  const stillOpen = [0, 1, 2, 3].filter((i) => asOfDate <= dueDates[i]);
  const passed = [0, 1, 2, 3].filter((i) => asOfDate > dueDates[i]);

  // The open quarters must collectively cover: the total coverage, MINUS the
  // base shares assigned to the passed quarters (which keep them), MINUS any
  // payment already credited to the open quarters themselves. Floored at 0.
  const passedBaseTotal = passed.reduce((s, i) => s + baseAmounts[i], 0);
  const paidOnOpen = stillOpen.reduce((s, i) => s + paid[i], 0);
  const openRequirement = Math.max(
    0,
    Math.round(toCoverViaEstimates) - passedBaseTotal - paidOnOpen,
  );

  // Re-split: passed quarters keep their base; open quarters split openRequirement
  // (their amount = that even share + whatever was already paid to that quarter, so
  // a quarter's remainingDue reflects the even catch-up share).
  const reSplit: number[] = [...baseAmounts];
  if (stillOpen.length > 0) {
    const perOpen = Math.round(openRequirement / stillOpen.length);
    stillOpen.forEach((qi, k) => {
      const share =
        k === stillOpen.length - 1
          ? openRequirement - perOpen * (stillOpen.length - 1) // last absorbs remainder
          : perOpen;
      reSplit[qi] = share + paid[qi]; // amount includes this quarter's own payment
    });
  }

  // 5. Build the vouchers + classify each status vs asOfDate.
  const vouchers: QuarterlyVoucher[] = [0, 1, 2, 3].map((i) => {
    const amount = Math.max(0, reSplit[i]);
    const alreadyPaid = paid[i];
    const remainingDue = Math.max(0, amount - alreadyPaid);
    const dueDate = dueDates[i];
    let status: QuarterlyVoucher["status"];
    if (remainingDue <= 0.005) {
      status = "paid";
    } else if (asOfDate > dueDate) {
      status = "overdue";
    } else {
      // Open with a balance — the soonest such one is "due", the rest "upcoming".
      status = "upcoming"; // refined below once we know the soonest
    }
    return {
      quarter: (i + 1) as 1 | 2 | 3 | 4,
      dueDate,
      amount,
      alreadyPaid,
      remainingDue,
      status,
    };
  });

  // The NEXT voucher = the soonest-due voucher that still has a balance (open OR
  // overdue). Among open-with-balance vouchers, the soonest is "due"; later ones
  // stay "upcoming". An overdue voucher is also a candidate for "next" (you owe it).
  const unpaidOpen = vouchers.filter((v) => v.remainingDue > 0.005 && asOfDate <= v.dueDate);
  if (unpaidOpen.length > 0) {
    // dueDates are already chronological by quarter index; the first open one is "due".
    const soonest = unpaidOpen[0];
    soonest.status = "due";
  }
  const unpaidAll = vouchers.filter((v) => v.remainingDue > 0.005);
  // nextVoucher: prefer the soonest OPEN unpaid; else the soonest OVERDUE unpaid.
  const nextVoucher: QuarterlyVoucher | null =
    unpaidOpen.length > 0
      ? unpaidOpen[0]
      : unpaidAll.length > 0
        ? unpaidAll[0]
        : null;

  const totalRequired = vouchers.reduce((s, v) => s + v.amount, 0);
  const remainingToPay = Math.max(0, totalRequired - totalPaidToDate);

  // 6. Reminders — client-ready strings with IRS Direct Pay context.
  const reminders = buildReminders({
    vouchers,
    nextVoucher,
    safeHarborTarget,
    projectedWithholding,
    withholdingCoversSafeHarbor: toCoverViaEstimates <= 0.005,
    remainingToPay,
  });

  // 7. Disclosed assumptions.
  const mfs = projectedRet.filingStatus === "married_filing_separately";
  const agiThreshold = mfs ? PRIOR_YEAR_110_AGI_THRESHOLD / 2 : PRIOR_YEAR_110_AGI_THRESHOLD;
  const assumptions: string[] = [];
  if (args.feed) {
    const months = Math.min(12, Math.max(1, Math.round(toNum(args.feed.monthsElapsed) || 1)));
    assumptions.push(
      `Income annualized straight-line from ${months} month(s) of feed data (×${(12 / months).toFixed(2)}); assumes income accrues EVENLY across the year. A back-loaded year (year-end bonus/gain) may overstate the early-quarter requirement — use the §6654(d)(2) annualized-installment method (Form 2210 Schedule AI) to lower it.`,
      "The income feed (QuickBooks Online / Gusto / Plaid) is supplied ALREADY-FETCHED by the connector adapter; this module does not pull it. Net-SE / wages / withholding from the feed REPLACE the baseline's; all other return facts (filing status, state, dependents, itemized deductions, K-1s) are carried from the baseline.",
    );
  } else {
    assumptions.push("No income feed supplied — the safe-harbor estimate uses the baseline return's figures as-is (static-snapshot mode).");
  }
  assumptions.push(
    `§6654 safe harbor = min(90% of the projected year's tax, ${Math.round(form2210.priorYearSafeHarborPct * 100)}% of the prior-year tax)${priorYearAvailable ? "" : " — no prior-year tax supplied, so only the 90%-of-current harbor is usable"}. The prior-year multiplier is 110% when prior-year AGI exceeds ${usd(agiThreshold)} (§6654(d)(1)(C); ${mfs ? "MFS" : "non-MFS"} threshold).`,
    "Withholding is credited evenly across the four installments (§6654(g)); the remaining target is split into four equal vouchers (the last absorbs the rounding remainder). After payments, the still-open quarters re-split to evenly catch up any shortfall/overage by year-end — this is the practical 'catch-up' figure, NOT the date-stamped §6654 penalty computation.",
    "Installment due dates are the STATUTORY §6654(c)(2) dates (Apr 15, Jun 15, Sep 15, Jan 15-next-year); the §7503 weekend/holiday roll is NOT applied here (a statutory date is never later than the true deadline). A route can map them through taxProjection.voucherDueDates() for the rolled dates.",
  );

  return {
    taxYear,
    asOfDate,
    projectedAnnualIncome,
    projectedAnnualTax,
    safeHarborTarget,
    safeHarborBasis,
    vouchers,
    totalRequired,
    totalPaidToDate,
    remainingToPay,
    nextVoucher,
    reminders,
    assumptions,
  };
}

function buildReminders(args: {
  vouchers: QuarterlyVoucher[];
  nextVoucher: QuarterlyVoucher | null;
  safeHarborTarget: number;
  projectedWithholding: number;
  withholdingCoversSafeHarbor: boolean;
  remainingToPay: number;
}): string[] {
  const { vouchers, nextVoucher, withholdingCoversSafeHarbor, remainingToPay } = args;
  const reminders: string[] = [];
  const DIRECT_PAY =
    "Pay online at IRS Direct Pay (irs.gov/payments/direct-pay) — choose reason “Estimated Tax” and the current tax year; no fee for bank-account payments.";

  if (withholdingCoversSafeHarbor) {
    reminders.push(
      `Your projected withholding already meets the §6654 safe harbor (${usd(args.safeHarborTarget)}) — no quarterly estimated payments are required this year. We’ll keep watching your income feed and alert you if that changes.`,
    );
    return reminders;
  }

  // Overdue installments first (most urgent).
  for (const v of vouchers) {
    if (v.status === "overdue") {
      reminders.push(
        `Q${v.quarter} estimate of ${usd(v.remainingDue)} was due ${humanDate(v.dueDate)} and is OVERDUE — pay as soon as possible to limit the §6654 underpayment interest. ${DIRECT_PAY}`,
      );
    }
  }

  // The next due installment.
  if (nextVoucher && nextVoucher.status === "due") {
    reminders.push(
      `Q${nextVoucher.quarter} estimate of ${usd(nextVoucher.remainingDue)} is due ${humanDate(nextVoucher.dueDate)} — pay via IRS Direct Pay. ${DIRECT_PAY}`,
    );
  }

  // Upcoming installments (heads-up).
  for (const v of vouchers) {
    if (v.status === "upcoming" && v.remainingDue > 0.005) {
      reminders.push(
        `Heads up: Q${v.quarter} estimate of ${usd(v.remainingDue)} will be due ${humanDate(v.dueDate)}.`,
      );
    }
  }

  if (reminders.length === 0 && remainingToPay <= 0.005) {
    reminders.push(
      `All four quarterly estimates are paid in full — you’ve met the ${usd(args.safeHarborTarget)} safe-harbor target for the year. Nice work.`,
    );
  }

  return reminders;
}
