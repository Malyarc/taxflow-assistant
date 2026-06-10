/**
 * T2.1 — Schedule E (Form 1040) "Supplemental Income and Loss" substitute
 * workpaper (Pub 1167 conventions — a CPA review copy, NOT a filed form).
 *
 * Line numbers follow the official TY2024 Schedule E:
 *   Part I (page 1):  1a physical address · 3 rents received · 18 depreciation
 *     expense · 20 total expenses · 21 income or (loss) · 22 deductible rental
 *     real estate loss after limitation (Form 8582) · 26 total rental real
 *     estate income or (loss).
 *   Part II (page 2): 28 per-entity columns (g)–(k) · 32 total partnership and
 *     S corporation income or (loss).
 *
 * Engine mapping (taxReturnEngine.ts / taxCalculator.ts):
 *   - Per-property detail: `inputs.rentalProperties` (RentalPropertyFact) +
 *     `ret.form8582` per-activity rows (Form 8582 Worksheet 5 ratable
 *     allocation). Per-property MACRS is engine-internal, so the workpaper
 *     re-derives line 18 as rents − expenses − (form8582 activity net) —
 *     engine-exact arithmetic, never an independent recomputation.
 *   - Aggregates: `ret.scheduleERentalGrossNet` (pre-§469 combined net; the
 *     engine nets the prior-year suspended-loss carry-in into this figure),
 *     `ret.scheduleERentalAppliedToAgi` (post-§469 → Schedule 1 line 5),
 *     `ret.scheduleEPassiveLossSuspended`, `ret.passiveActivityLoss`
 *     (§469(i) special-allowance detail), `ret.section469gReleasedLoss`
 *     (full-disposition release).
 *   - K-1 pass-through: `ret.scheduleK1` aggregate summary (page 2). The
 *     engine routes K-1 portfolio buckets (interest / dividends / royalties /
 *     capital gains) to their own schedules; they are summarized in a
 *     workpaper part with flow-to notes.
 *
 * Applicability: any rental activity (per-property rows for the year, or a
 * nonzero rental aggregate / suspension / §469(g) release) OR ≥1 Schedule K-1.
 */

import {
  boolLine,
  checkLine,
  countLine,
  moneyLine,
  nz,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";
import type { RentalPropertyFact } from "../taxReturnEngine";
import type { Form8582ActivityRow } from "../taxCalculator";

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Official Schedule E property column letter (A/B/C…; >26 falls back to #n). */
function propertyLetter(i: number): string {
  return i < 26 ? String.fromCharCode(65 + i) : `#${i + 1}`;
}

/** Mirrors the engine's per-property MACRS trigger (taxReturnEngine propMacrs):
 *  depreciation is computed only when basis > 0 AND a valid placed-in-service
 *  year + month (1–12) are present. When NOT triggered, engine MACRS is exactly
 *  0, so the property net is re-derivable from rents − expenses alone. */
function macrsTriggered(p: RentalPropertyFact): boolean {
  const m = p.placedInServiceMonth ?? 0;
  return toNum(p.basis) > 0 && (p.placedInServiceYear ?? 0) > 0 && m >= 1 && m <= 12;
}

export function buildScheduleE(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const k1 = ret.scheduleK1;

  // Properties for the computed year, preserving input order (the engine
  // iterates the same filtered array, so form8582 activity order matches the
  // non-disposed subsequence below).
  const propsForYear = (inputs?.rentalProperties ?? []).filter((p) => p.taxYear === ret.taxYear);
  const activeProps: Array<{ p: RentalPropertyFact; key: string }> = [];
  const disposedProps: Array<{ p: RentalPropertyFact; key: string }> = [];
  propsForYear.forEach((p, idx) => {
    // Same fallback naming as the engine ("Property ${idx+1}" over the FULL
    // year-filtered array, disposed included).
    const key = p.address?.trim() || `Property ${idx + 1}`;
    (p.fullyDisposedThisYear ? disposedProps : activeProps).push({ p, key });
  });

  const rentalActive =
    propsForYear.length > 0 ||
    nz(ret.scheduleERentalGrossNet) ||
    nz(ret.scheduleERentalAppliedToAgi) ||
    nz(ret.scheduleEPassiveLossSuspended) ||
    nz(ret.section469gReleasedLoss);

  if (!rentalActive && k1.k1Count === 0) return null;

  const sumAdj = (type: string): number =>
    (inputs?.adjustments ?? [])
      .filter((a) => a.isApplied !== false && a.adjustmentType === type)
      .reduce((s, a) => s + toNum(a.amount), 0);

  const parts: FormInstance["parts"] = [];
  const footnotes: string[] = [
    "Substitute form per Pub 1167 conventions — CPA review workpaper, not for filing. Amounts are engine-exact (cents), not whole-dollar rounded.",
  ];

  // ── Part I — Rental real estate (page 1, lines 1a–26) ─────────────────────
  if (rentalActive) {
    const lines: FormLine[] = [];
    const activities: Form8582ActivityRow[] = ret.form8582?.activities ?? [];
    // The engine builds form8582 activities from the non-disposed properties in
    // order; match by index when the counts line up, else by address key.
    const activityFor = (i: number, key: string): Form8582ActivityRow | null => {
      if (activities.length === activeProps.length) return activities[i] ?? null;
      return activities.find((a) => a.address === key) ?? null;
    };

    // Per-property blocks (active properties).
    activeProps.forEach(({ p, key }, i) => {
      const rents = toNum(p.rentalIncome);
      const expenses = toNum(p.totalExpenses);
      const act = activityFor(i, key);
      // Engine-exact net: form8582 activity net when available; otherwise only
      // derivable when the engine's MACRS path is provably inert.
      const net = act != null ? act.netIncome : macrsTriggered(p) ? null : rents - expenses;
      lines.push(
        textLine("1a", `Property ${propertyLetter(i)} — ${key}`, p.propertyType ?? "residential", {
          emphasis: true,
        }),
      );
      lines.push(moneyLine("3", "Rents received", rents, { indent: 1 }));
      if (net != null) {
        const dep = rents - expenses - net; // engine MACRS, recovered exactly
        if (nz(expenses)) {
          lines.push(
            moneyLine("", "Operating expenses (official lines 5–17, 19 — engine aggregate)", expenses, {
              indent: 1,
            }),
          );
        }
        if (nz(dep)) {
          lines.push(
            moneyLine("18", "Depreciation expense (engine MACRS — SL, 27.5/39-yr mid-month)", dep, {
              indent: 1,
            }),
          );
        }
        lines.push(moneyLine("20", "Total expenses (incl. depreciation)", expenses + dep, { indent: 1 }));
        lines.push(moneyLine("21", "Income or (loss)", net, { indent: 1 }));
      } else {
        // Defensive only — form8582 accompanies every non-disposed property set.
        lines.push(
          moneyLine("", "Operating expenses (excl. depreciation)", expenses, { indent: 1 }),
        );
        lines.push(
          textLine("21", "Income or (loss)", null, {
            indent: 1,
            note: "(engine MACRS not re-derivable in workpaper — see the app's Rentals tab)",
          }),
        );
      }
      if (act != null && act.netIncome < 0) {
        lines.push(
          moneyLine("22", "Deductible rental real estate loss after limitation (Form 8582)", act.allowedThisYear, {
            indent: 1,
          }),
        );
        if (act.suspendedToNextYear > 0) {
          lines.push(
            moneyLine("", "Suspended to next year (Form 8582 Worksheet 5 ratable share)", act.suspendedToNextYear, {
              indent: 2,
            }),
          );
        }
      }
    });

    // Fully-disposed properties (§469(g)) — held OUT of the §469 active path.
    let disposedNetSum = 0;
    let disposedNetDerivable = disposedProps.length > 0;
    let disposedCarryforwardInputs = 0;
    disposedProps.forEach(({ p, key }, j) => {
      const rents = toNum(p.rentalIncome);
      const expenses = toNum(p.totalExpenses);
      disposedCarryforwardInputs += Math.max(0, toNum(p.suspendedLossCarryforward));
      lines.push(
        textLine("1a", `Property ${propertyLetter(activeProps.length + j)} — ${key}`, p.propertyType ?? "residential", {
          emphasis: true,
          note: "FULLY DISPOSED this year in a fully-taxable transaction — §469(g) applies.",
        }),
      );
      if (nz(rents)) lines.push(moneyLine("3", "Rents received", rents, { indent: 1 }));
      if (nz(expenses)) {
        lines.push(moneyLine("", "Operating expenses (excl. depreciation)", expenses, { indent: 1 }));
      }
      if (macrsTriggered(p)) {
        // Disposed properties never reach form8582, so engine MACRS for them
        // is not recoverable from outputs — disclose instead of inventing.
        disposedNetDerivable = false;
        lines.push(
          textLine("21", "Income or (loss) — current year", null, {
            indent: 1,
            note: "(includes engine MACRS — not re-derivable in workpaper; see the app's Rentals tab)",
          }),
        );
      } else {
        const net = rents - expenses;
        disposedNetSum += net;
        lines.push(moneyLine("21", "Income or (loss) — current year", net, { indent: 1 }));
      }
    });

    // Legacy aggregate path — no per-property rows: render the aggregate
    // schedule_e_rental_* adjustment amounts so the workpaper still shows the
    // rents/expenses composition (engine-exact: these ARE the engine's inputs).
    if (propsForYear.length === 0 && inputs != null) {
      const aggIncome = sumAdj("schedule_e_rental_income");
      const aggExpenses = sumAdj("schedule_e_rental_expenses");
      const aggDep = sumAdj("schedule_e_macrs_depreciation");
      if (nz(aggIncome) || nz(aggExpenses) || nz(aggDep)) {
        lines.push(moneyLine("3", "Rents received (aggregate adjustment)", aggIncome));
        if (nz(aggExpenses)) {
          lines.push(moneyLine("", "Operating expenses (aggregate adjustment)", aggExpenses, { indent: 1 }));
        }
        if (nz(aggDep)) {
          lines.push(moneyLine("18", "Depreciation (aggregate schedule_e_macrs_depreciation)", aggDep, { indent: 1 }));
        }
        lines.push(moneyLine("20", "Total expenses (incl. depreciation)", aggExpenses + aggDep, { indent: 1 }));
        lines.push(moneyLine("21", "Income or (loss)", aggIncome - aggExpenses - aggDep, { indent: 1 }));
      }
    }

    // Aggregate rows.
    const palCarryIn = sumAdj("schedule_e_passive_loss_carryforward");
    if (nz(palCarryIn)) {
      lines.push(
        moneyLine("", "Prior-year suspended passive loss carried in (§469(b); Form 8582 Wks 1 col (c))", -palCarryIn),
      );
    }
    lines.push(
      moneyLine("", "Combined net rental income/(loss) subject to §469 (engine pre-limitation)", ret.scheduleERentalGrossNet, {
        emphasis: true,
        note: "Engine convention: includes the prior-year suspended-loss carry-in; excludes §469(g) fully-disposed properties.",
      }),
    );
    if (activeProps.length > 0 && ret.form8582 != null) {
      const activityNetSum = activities.reduce((s, a) => s + a.netIncome, 0);
      lines.push(
        checkLine(
          "Per-property nets − prior-year carry-in tie to the engine combined net",
          activityNetSum - palCarryIn,
          ret.scheduleERentalGrossNet,
        ),
      );
    }
    lines.push(
      moneyLine("26", "Total rental real estate income or (loss) applied (post-§469, active properties)", ret.scheduleERentalAppliedToAgi, {
        emphasis: true,
        note: "Flows to Schedule 1 line 5 → Form 1040 line 8.",
      }),
    );
    const expectedApplied =
      ret.scheduleERentalGrossNet >= 0
        ? ret.scheduleERentalGrossNet
        : -(ret.passiveActivityLoss?.allowedThisYear ?? 0);
    lines.push(
      checkLine("Post-§469 rental applied ties to the engine identity", expectedApplied, ret.scheduleERentalAppliedToAgi),
    );

    // §469(g) full-disposition release.
    if (nz(ret.section469gReleasedLoss)) {
      lines.push(
        moneyLine("", "§469(g) released suspended passive loss (fully-taxable disposition)", -ret.section469gReleasedLoss, {
          emphasis: true,
          note: "Freely deductible — a full disposition to an unrelated party releases the accumulated suspended loss; NOT subject to the $25k §469(i) cap. Flows to Schedule 1 line 5.",
        }),
      );
      if (disposedProps.length > 0) {
        lines.push(
          checkLine(
            "Released suspended losses tie to the per-property carryforward inputs",
            disposedCarryforwardInputs,
            ret.section469gReleasedLoss,
          ),
        );
      }
    }
    if (disposedProps.length > 0 && disposedNetDerivable && nz(disposedNetSum)) {
      lines.push(
        moneyLine("", "Disposed-property current-year net income/(loss) (§469(g) — outside the PAL limit)", disposedNetSum, {
          note: "Flows to Schedule 1 line 5 with no §469 limitation (full-disposition rule).",
        }),
      );
    }
    // Grand total to AGI — only when the §469(g) disposed component is fully
    // accountable from the supplied inputs (never render a misleading total).
    if (disposedProps.length > 0 && disposedNetDerivable) {
      lines.push(
        moneyLine(
          "",
          "Total Schedule E rental flowing to AGI (post-§469 + §469(g))",
          ret.scheduleERentalAppliedToAgi + disposedNetSum - ret.section469gReleasedLoss,
          { emphasis: true },
        ),
      );
    }
    if (nz(ret.scheduleEPassiveLossSuspended)) {
      lines.push(
        moneyLine("", "Passive loss suspended to next year (§469(b) carryforward)", ret.scheduleEPassiveLossSuspended, {
          note: "Re-enter next year via the schedule_e_passive_loss_carryforward adjustment (pipeline auto-loads).",
        }),
      );
    }
    parts.push({ title: "Part I — Income or Loss From Rental Real Estate", lines });

    if (propsForYear.length === 0) {
      footnotes.push(
        "No per-property rows were supplied — rental amounts are aggregate-modeled via the schedule_e_rental_* adjustments (documented engine sub-gap); the official per-property columns A/B/C cannot be rendered.",
      );
    }
    footnotes.push(
      "Official expense lines 5–17 and 19 are modeled as a single per-property operating-expense total; per-category expense detail is the CPA's records.",
      "1099-MISC Box 1 rents / Box 2 royalties are engine-modeled as other income (Form 1040 line 8), not within this Schedule E Part I.",
    );
  }

  // ── Form 8582 detail — §469(i) special allowance ───────────────────────────
  const pal = ret.passiveActivityLoss;
  if (pal != null) {
    const lines: FormLine[] = [
      moneyLine("", "Net rental loss subject to §469 limitation", pal.rentalLoss),
      moneyLine("", "Modified AGI used for the §469(i) phase-out (engine provisional AGI)", pal.modifiedAgi, {
        note: "Engine MAGI ≈ AGI before the rental loss; the few §469(i)(3)(F) addbacks (IRA, taxable SS…) are not modeled.",
      }),
      boolLine("", "Active participant (§469(i)(6))", pal.isActiveParticipant),
      boolLine("", "Real estate professional (§469(c)(7) — no limitation)", pal.isRealEstateProfessional),
    ];
    if (pal.isRealEstateProfessional) {
      lines.push(
        textLine("", "Real estate professional — rental loss fully allowed, no $25,000 cap", "—"),
      );
    } else {
      lines.push(
        moneyLine("", "Special allowance cap (§469(i)(2): $25,000 / $12,500 MFS-apart / $0 MFS-together)", pal.allowanceCap),
        moneyLine("", "Allowance after the 50%-of-MAGI-over-$100,000 phase-out ($50,000 MFS)", pal.allowanceAfterPhaseOut),
      );
    }
    lines.push(
      moneyLine("", "Loss ALLOWED this year (deducted against ordinary income)", pal.allowedThisYear, {
        emphasis: true,
      }),
      moneyLine("", "Loss SUSPENDED to next year (§469(b) carryforward)", pal.suspendedToNextYear, {
        emphasis: true,
      }),
      checkLine("Allowed + suspended = loss subject to §469", pal.allowedThisYear + pal.suspendedToNextYear, pal.rentalLoss),
      checkLine("Suspended ties to the engine carryforward field", pal.suspendedToNextYear, ret.scheduleEPassiveLossSuspended),
    );
    parts.push({
      title: "Form 8582 cross-reference — §469 passive activity loss limitation",
      lines,
    });
  }

  // ── Part II — Partnerships and S corporations (page 2, lines 27–32) ───────
  if (k1.k1Count > 0) {
    const lines: FormLine[] = [
      countLine("28", "Schedule(s) K-1 included in this return", k1.k1Count, {
        note: `${k1.partnershipCount} partnership (Form 1065) + ${k1.sCorpCount} S corporation (Form 1120-S). Per-entity columns are in the app's K-1 tab; engine totals shown here.`,
      }),
    ];
    if (nz(k1.totalActiveOrdinaryIncome)) {
      lines.push(
        moneyLine("28(i)/(k)", "Nonpassive ordinary income or (loss) — active Box 1 + Box 3", k1.totalActiveOrdinaryIncome, {
          note: "After the §704(d)/§1366(d) basis + §465 at-risk loss limits.",
        }),
      );
    }
    if (nz(k1.totalGuaranteedPayments)) {
      lines.push(
        moneyLine("28(k)", "Guaranteed payments — §707(c) (Form 1065 Box 4)", k1.totalGuaranteedPayments, {
          note: "Ordinary income to the partner; EXCLUDED from QBI per §199A(c)(4).",
        }),
      );
    }
    if (nz(k1.totalPassiveBucketNetApplied)) {
      lines.push(
        moneyLine("28(h)", "Passive income — net passive bucket applied to AGI", k1.totalPassiveBucketNetApplied, {
          note: "Passive Box 1/3 + all Box 2 rental real estate, after prior-year passive-carryforward netting.",
        }),
      );
    }
    const line32 =
      k1.totalActiveOrdinaryIncome + k1.totalGuaranteedPayments + k1.totalPassiveBucketNetApplied;
    lines.push(
      moneyLine("32", "Total partnership and S corporation income or (loss)", line32, {
        emphasis: true,
        note: "Flows to Schedule 1 line 5 → Form 1040 line 8.",
      }),
    );
    if (nz(k1.k1PassiveLossSuspended)) {
      lines.push(
        moneyLine("", "K-1 passive loss suspended to next year (§469)", k1.k1PassiveLossSuspended, {
          note: "No $25k special allowance for K-1 passive activity — the §469(i) allowance is rental-real-estate active-participation only. Re-enters via k1_passive_loss_carryforward.",
        }),
      );
    }
    if (nz(k1.k1BasisAtRiskLossSuspended)) {
      lines.push(
        moneyLine("", "Loss suspended by the basis / at-risk limits (§704(d)/§1366(d) + §465)", k1.k1BasisAtRiskLossSuspended, {
          note: "Deductible in a later year when basis or at-risk is restored (Schedule E line 27 question — CPA re-enters).",
        }),
      );
    }
    parts.push({
      title: "Part II — Income or Loss From Partnerships and S Corporations",
      lines,
    });

    // ── K-1 items routed to other schedules (workpaper summary) ──
    const p3: FormLine[] = [];
    if (nz(k1.totalInterestIncome)) {
      p3.push(moneyLine("", "Interest income (Box 5) → Schedule B / Form 1040 line 2b", k1.totalInterestIncome));
    }
    if (nz(k1.totalOrdinaryDividends)) {
      p3.push(
        moneyLine("", "Ordinary dividends (Box 6a) → Schedule B / Form 1040 line 3b", k1.totalOrdinaryDividends, {
          note: nz(k1.totalQualifiedDividends)
            ? `Qualified portion (Box 6b) ${"$" + k1.totalQualifiedDividends.toLocaleString("en-US", { minimumFractionDigits: 2 })} taxed at preferential rates.`
            : undefined,
        }),
      );
    } else if (nz(k1.totalQualifiedDividends)) {
      p3.push(
        moneyLine("", "Qualified dividends (Box 6b) → Form 1040 line 3a (preferential rates)", k1.totalQualifiedDividends),
      );
    }
    if (nz(k1.totalRoyalties)) {
      p3.push(
        moneyLine("", "Royalties (Box 7)", k1.totalRoyalties, {
          note: "Officially Schedule E Part I line 4; engine aggregates to ordinary income (same AGI result).",
        }),
      );
    }
    if (nz(k1.totalShortTermCapitalGain)) {
      p3.push(
        moneyLine("", "Net short-term capital gain or (loss) (Box 8) → Schedule D line 5", k1.totalShortTermCapitalGain, {
          note: "Cross-nets with the return's other capital transactions in the engine's Schedule D netting.",
        }),
      );
    }
    if (nz(k1.totalLongTermCapitalGain)) {
      p3.push(
        moneyLine("", "Net long-term capital gain or (loss) (Box 9a) → Schedule D line 12", k1.totalLongTermCapitalGain, {
          note: "Cross-nets with the return's other capital transactions in the engine's Schedule D netting.",
        }),
      );
    }
    if (nz(k1.totalSelfEmploymentEarnings)) {
      p3.push(
        moneyLine("", "Self-employment earnings (Form 1065 Box 14A / §707(c) GP) → Schedule SE", k1.totalSelfEmploymentEarnings, {
          note: "Partnership K-1s only (S-corp pass-through is not SE income). Engine SE base per K-1 = max(Box 14A, Box 4); the underlying income is already in Part II — no double count.",
        }),
      );
    }
    if (nz(k1.totalQbiContribution)) {
      p3.push(
        moneyLine("", "§199A QBI reported (Box 20 code Z / Box 17 code V) → Form 8995/8995-A", k1.totalQbiContribution),
      );
    }
    if (p3.length === 0) {
      p3.push(textLine("", "No portfolio / SE / §199A items reported on the K-1s", "—"));
    }
    parts.push({ title: "Schedule K-1 items reported on other schedules (workpaper summary)", lines: p3 });
  }

  return {
    formId: "schedule-e",
    formNumber: "Schedule E (Form 1040)",
    title: "Supplemental Income and Loss",
    subtitle: "Rental real estate (Part I) and partnership / S-corporation pass-through (Part II) — CPA review workpaper",
    taxYear: ret.taxYear,
    parts,
    footnotes,
  };
}
