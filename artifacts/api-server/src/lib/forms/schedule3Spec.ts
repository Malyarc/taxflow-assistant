/**
 * T2.1 — Schedule 3 (Form 1040): "Additional Credits and Payments".
 *
 * Substitute-form workpaper (Pub 1167 conventions). Line numbers follow the
 * official TY2024 Schedule 3.
 *
 * Tie-out identity (Part I): the sum of the Schedule 3 Part I nonrefundable
 * credits equals the engine's total nonrefundable credits applied MINUS the
 * Child Tax Credit (which lands directly on Form 1040 line 19, not Schedule 3):
 *
 *   Σ(Part I lines 1–6) == ret.totalNonRefundableApplied
 *                           − ret.childTaxCredit.nonRefundablePortion
 *
 * Part II (refundable) carries only the credits the official Schedule 3 holds
 * (net PTC line 9, other line 13); EITC / ACTC / refundable-AOC live on Form
 * 1040 page 2, so Part II does NOT attempt a refund tie — the Reconciliation
 * Worksheet Part 6 owns the full settlement.
 */

import {
  checkLine,
  moneyLine,
  nz,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
} from "./formSpec";

export function buildSchedule3(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const ec = ret.educationCredits;
  const re = ret.residentialEnergyCredits;

  // ── Part I — Nonrefundable credits ──
  const educationNonRef = ec.aocNonRefundable + ec.llcApplied;
  // FC-11 — line 5a shows the §25D amount APPLIED (post-CTC ordering, incl.
  // any §25D(c) carryforward consumed), not the pre-limit credit — the unused
  // balance rolls forward and is disclosed on Form 5695 line 16.
  const energy5a = ret.residentialCleanEnergyApplied;
  const energy5b = re.efficientHomeCredit + re.heatPumpCredit;
  const gbc = ret.rdCreditApplied + ret.otherGeneralBusinessCreditApplied;

  const partIComponents: Array<[string, string, number, string?]> = [
    ["1", "Foreign tax credit (Form 1116)", ret.foreignTaxCredit.credit],
    ["2", "Credit for child & dependent care expenses (Form 2441)", ret.dependentCareCredit.appliedCredit],
    ["3", "Education credits — nonrefundable (Form 8863): AOC nonref + LLC", educationNonRef],
    ["4", "Retirement savings contributions credit (Form 8880)", ret.saversCredit.appliedCredit],
    ["5a", "Residential clean energy credit §25D (Form 5695 Part I) — applied", energy5a, "Solar/wind/geothermal/battery — 30%, no annual cap, §25D(c) carryforward; applied AFTER the CTC (FC-11)."],
    ["5b", "Energy efficient home improvement credit §25C (Form 5695 Part II)", energy5b, "$1,200 general cap + $2,000 heat-pump cap = $3,200/yr."],
    ["6j", "Alternative fuel vehicle refueling property §30C (Form 8911)", re.evChargerCredit, "Engine models the EV-charger credit here (officially Form 8911 → Schedule 3 line 6j)."],
    ["6c", "Adoption credit — nonrefundable (Form 8839)", ret.adoptionCredit.nonRefundableApplied],
    ["6b", "Prior-year minimum tax credit (Form 8801)", ret.amtCreditApplied],
    ["6a", "General business credit (Form 3800): R&D §41 + WOTC §51 + FMLA §45S", gbc],
  ];
  const partILines: FormLine[] = [];
  let partISum = 0;
  for (const [line, label, value, note] of partIComponents) {
    if (!nz(value)) continue;
    partISum += value;
    partILines.push(moneyLine(line, label, value, note ? { note } : {}));
  }
  partILines.push(
    moneyLine("8", "Total nonrefundable credits — to Form 1040 line 20", partISum, { emphasis: true }),
  );
  partILines.push(
    checkLine(
      "Schedule 3 Part I = engine nonrefundable credits − CTC (which is on Form 1040 line 19)",
      partISum,
      ret.totalNonRefundableApplied - ret.childTaxCredit.nonRefundablePortion,
    ),
  );

  // ── Part II — Refundable credits and payments ──
  const netPtc = Math.max(0, ret.premiumTaxCredit.netPtc);
  const partIILines: FormLine[] = [];
  if (nz(netPtc)) {
    partIILines.push(
      moneyLine("9", "Net premium tax credit (Form 8962)", netPtc, {
        note: "Allowable PTC over advance APTC received. Refundable.",
      }),
    );
  }
  // Sch 3 line 11 → 1040 line 31. Form 1040 already reports this on line 31; the
  // workpaper omitted the supporting Schedule 3 line so it couldn't be traced
  // (audit 2026-06-23, forms F-excessSS).
  if (nz(ret.excessSocialSecurityCredit)) {
    partIILines.push(
      moneyLine("11", "Excess social security and tier 1 RRTA tax withheld", ret.excessSocialSecurityCredit, {
        note: "One employee with 2+ employers whose combined Box 4 exceeds the year's SS wage-base max → the excess is a refundable payment (→ Form 1040 line 31).",
      }),
    );
  }
  if (nz(ret.adoptionCredit.refundablePortion)) {
    partIILines.push(
      moneyLine("13z", "Adoption credit — refundable portion (OBBBA, Form 8839)", ret.adoptionCredit.refundablePortion, {
        note: "OBBBA made up to $5,000/$5,120 of the §23 credit refundable (TY2025+).",
      }),
    );
  }
  if (nz(ret.manualCreditsApplied)) {
    partIILines.push(
      moneyLine("13z", "Other credits — CPA manual credit adjustments", ret.manualCreditsApplied, {
        note: "CPA-entered `credit` adjustments not mapped to a specific engine credit line.",
      }),
    );
  }
  partIILines.push(
    moneyLine(
      "",
      "Note: EITC, additional CTC, and refundable AOC are reported on Form 1040 page 2 (lines 27–29), not Schedule 3",
      null,
    ),
  );

  if (partISum === 0 && !nz(netPtc) && !nz(ret.excessSocialSecurityCredit) && !nz(ret.adoptionCredit.refundablePortion) && !nz(ret.manualCreditsApplied)) {
    return null;
  }

  return {
    formId: "schedule-3",
    formNumber: "Schedule 3 (Form 1040)",
    title: "Additional Credits and Payments",
    subtitle: "Substitute workpaper — engine-exact amounts tied to Form 1040 lines 20 and 31.",
    taxYear: ret.taxYear,
    parts: [
      { title: "Part I — Nonrefundable Credits (Form 1040 line 20)", lines: partILines },
      { title: "Part II — Refundable Credits and Payments (Form 1040 line 31)", lines: partIILines },
    ],
    footnotes: [
      "Credit ORDERING: the engine applies the Schedule-3 personal credits in the Sch 8812 CLW line-2 list FIRST (FTC → dependent care → education → savers → §25C energy/§30C → adoption), THEN the Child Tax Credit, THEN the §25D residential clean energy credit (NOT in the CLW list; its excess carries forward under §25D(c) — FC-11), then §53/§38. Each credit is capped at the remaining income tax (which includes the Schedule 2 line 2 excess-APTC repayment — FC-09).",
      "The Child Tax Credit nonrefundable portion is on Form 1040 line 19 (not Schedule 3); Part I therefore ties to totalNonRefundableApplied − CTC nonrefundable.",
      "The EV-charger credit (§30C) is modeled inside the engine's residentialEnergyCredits and shown on line 6j (officially Form 8911; 6m is the previously-owned clean vehicle credit).",
    ],
  };
}
