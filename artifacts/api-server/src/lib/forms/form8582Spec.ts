/**
 * T2.1 — Form 8582: Passive Activity Loss Limitations (§469).
 *
 * Substitute-form workpaper (Pub 1167 conventions). The engine's per-activity
 * passive-loss worksheet (ret.form8582, a Form8582Breakdown) drives this:
 * each rental activity's net, the allowed loss this year (after the §469(i)
 * $25,000 special allowance phased out 50% over $100k MAGI), and the loss
 * suspended to next year.
 *
 * Applicable when ret.form8582 is non-null (per-property rental rows present).
 */

import {
  checkLine,
  moneyLine,
  nz,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";
import type { Form8582ActivityRow } from "../taxCalculator";

export function buildForm8582(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const f = ret.form8582;
  if (!f) return null;

  const activities: Form8582ActivityRow[] = f.activities ?? [];
  const pal = ret.passiveActivityLoss;

  // ── Part I — 2024 Passive Activity Loss (rental real estate w/ active part.) ──
  const partILines: FormLine[] = [];
  partILines.push(
    moneyLine("1a/1b", "Combined net income/(loss) from all passive rental activities", f.totalNetIncome, {
      note: "Sum of per-activity (rents − expenses − depreciation).",
    }),
  );
  partILines.push(
    moneyLine("1c", "Combined allowed against ordinary income this year", f.totalAllowed, {
      note: "Negative = a loss that reduces AGI (after the §469(i) special allowance).",
    }),
  );
  partILines.push(
    moneyLine("3", "Total loss suspended to next year (carryforward)", f.totalSuspended, { emphasis: true }),
  );

  // ── Per-activity worksheet (Form 8582 Worksheet 1/5) ──
  const activityLines: FormLine[] = [];
  let allowedSum = 0;
  let suspendedSum = 0;
  let netSum = 0;
  for (const a of activities) {
    netSum += a.netIncome;
    allowedSum += a.allowedThisYear;
    suspendedSum += a.suspendedToNextYear;
    activityLines.push(
      moneyLine("", a.address || "(rental activity)", a.netIncome, {
        note: `Allowed this year ${a.allowedThisYear.toLocaleString("en-US", { style: "currency", currency: "USD" })} · suspended ${a.suspendedToNextYear.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
      }),
    );
  }
  if (activities.length > 0) {
    activityLines.push(
      checkLine("Per-activity net ties to the combined total", netSum, f.totalNetIncome),
    );
    activityLines.push(
      checkLine("Per-activity allowed ties to the combined allowed", allowedSum, f.totalAllowed),
    );
    activityLines.push(
      checkLine("Per-activity suspended ties to the combined suspended", suspendedSum, f.totalSuspended),
    );
  }

  // ── Special allowance (§469(i)) ──
  const allowanceLines: FormLine[] = [
    moneyLine("9", "Maximum special allowance (§469(i) statutory cap)", f.allowanceCap, {
      note: "$25,000 ($12,500 MFS-lived-apart; $0 MFS-lived-together per §469(i)(5)(B)).",
    }),
    moneyLine("10", "Special allowance after MAGI phase-out", f.allowanceAfterPhaseOut, {
      emphasis: true,
      note: "Phased out 50¢ per $1 of MAGI over $100,000 ($50,000 MFS), fully gone at $150,000.",
    }),
  ];
  if (pal) {
    allowanceLines.push(
      moneyLine("", "Modified AGI used for the phase-out", pal.modifiedAgi, { indent: 1 }),
    );
    if (pal.isRealEstateProfessional) {
      allowanceLines.push(
        moneyLine("", "Real-estate professional (§469(c)(7)) — losses are non-passive", null, {
          indent: 1,
          note: "Material participation → rental losses are NOT subject to the §469 limit.",
        }),
      );
    }
  }
  if (nz(ret.section469gReleasedLoss)) {
    allowanceLines.push(
      moneyLine("", "§469(g) suspended loss RELEASED by full disposition", ret.section469gReleasedLoss, {
        emphasis: true,
        note: "A fully-taxable disposition frees the property's suspended passive loss — freely deductible, no $25k cap.",
      }),
    );
  }

  return {
    formId: "form-8582",
    formNumber: "Form 8582",
    title: "Passive Activity Loss Limitations",
    subtitle: "§469 — per-activity allowed vs suspended rental real-estate loss.",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — 2024 Passive Activity Loss", lines: partILines },
      ...(activityLines.length > 0 ? [{ title: "Worksheet — per-activity detail", lines: activityLines }] : []),
      { title: "Special allowance for rental real estate (§469(i))", lines: allowanceLines },
    ],
    footnotes: [
      "The engine models the §469(i) $25,000 active-participation special allowance with the MAGI phase-out; the $150,000-MAGI full-phase-out and MFS rules (§469(i)(5)(B)) are applied.",
      "Per-activity allocation of the allowed loss follows Form 8582 Worksheet 5 (ratable by each activity's share of the total loss).",
      "Suspended losses carry forward indefinitely and release in full on a fully-taxable disposition of the activity (§469(g)).",
    ],
  };
}
