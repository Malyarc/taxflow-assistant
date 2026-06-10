/**
 * T2.1 — Form 5695 (Residential Energy Credits) workpaper builder.
 *
 * Renders the engine's residential-energy package (`ret.residentialEnergyCredits`,
 * `calculateResidentialEnergyCredits` in taxCalculator.ts) against the official
 * TY2024 Form 5695 layout:
 *   Part I  — Residential Clean Energy Credit (§25D): 30%, no annual cap,
 *             lines 1/6a/6b/13 (fuel cell lines 7–11 and the carryforward
 *             lines 12/16 are not modeled).
 *   Part II — Energy Efficient Home Improvement Credit (§25C): 30% under the
 *             $1,200 general cap + the separate $2,000 heat-pump/biomass cap
 *             (combined annual max $3,200, no carryforward).
 * Plus a labeled EXTRA section for the §30C EV-charger credit, which the
 * engine folds into its residential-energy total but which is OFFICIALLY
 * claimed on Form 8911, not Form 5695 — disclosed inline.
 *
 * Engine semantics (verified vs source 2026-06-09):
 *   - cleanEnergyCredit  = 30% × cleanEnergySpend (uncapped)
 *   - efficientHomeCredit = min(30% × efficientHomeSpend, $1,200)
 *   - heatPumpCredit      = min(30% × heatPumpSpend, $2,000)
 *   - evChargerCredit     = min(30% × evChargerSpend, $1,000)
 *   - `total` is the PRE-liability-limit credit; the engine caps each
 *     component at remaining income tax downstream in Schedule 3 ordering.
 *
 * PURE — no Date/random/DB/pdfkit. Amounts engine-exact (cents).
 */

import {
  checkLine,
  moneyLine,
  nz,
  textLine,
  type FormBuildContext,
  type FormInstance,
  type FormLine,
  type FormPart,
} from "./formSpec";

export function buildForm5695(ctx: FormBuildContext): FormInstance | null {
  const { ret } = ctx;
  const re = ret.residentialEnergyCredits;

  // Applicable only when the package computes a credit.
  if (!(re.total > 0)) return null;

  const parts: FormPart[] = [];

  // ── Part I — Residential Clean Energy Credit (§25D) ──
  if (nz(re.cleanEnergySpend) || nz(re.cleanEnergyCredit)) {
    const partI: FormLine[] = [
      moneyLine("1", "Qualified clean energy property costs", re.cleanEnergySpend, {
        note: "Engine aggregate of all §25D property types (solar electric/water heating, small wind, geothermal, battery storage ≥3 kWh) — lines 1–5b are not split per type.",
      }),
      moneyLine("6a", "Total qualified clean energy property costs (lines 1 through 5b)", re.cleanEnergySpend),
      moneyLine("6b", "Multiply line 6a by 30% (0.30)", re.cleanEnergyCredit),
      moneyLine("13", "Total residential clean energy credit (§25D)", re.cleanEnergyCredit, {
        emphasis: true,
        note: "No annual dollar cap and no income limit; 30% rate through 2032.",
      }),
      textLine("15", "Residential clean energy credit (smaller of line 13 or the line 14 limitation)", null, {
        note: "(not modeled at the form level — the engine applies the tax-liability cap in Schedule 3 credit ordering; the unused-§25D carryforward, lines 12/16, is not tracked — CPA supplies)",
      }),
    ];
    parts.push({ title: "Part I — Residential Clean Energy Credit (§25D)", lines: partI });
  }

  // ── Part II — Energy Efficient Home Improvement Credit (§25C) ──
  const section25cTotal = re.efficientHomeCredit + re.heatPumpCredit;
  if (nz(re.efficientHomeSpend) || nz(re.heatPumpSpend) || nz(section25cTotal)) {
    const partII: FormLine[] = [];
    if (nz(re.efficientHomeSpend) || nz(re.efficientHomeCredit)) {
      partII.push(
        moneyLine("18–25", "Qualified §25C costs — general bucket (insulation, windows, doors, audits, residential energy property)", re.efficientHomeSpend, {
          note: "Engine aggregate; per-item sub-caps (windows $600, doors $250/$500, home energy audit $150, $600 per energy-property item) not modeled.",
        }),
        moneyLine("", "× 30%, capped at the $1,200 general annual limit", re.efficientHomeCredit, { indent: 1 }),
      );
    }
    if (nz(re.heatPumpSpend) || nz(re.heatPumpCredit)) {
      partII.push(
        moneyLine("29a", "Heat pump / heat pump water heater / biomass stove or boiler costs", re.heatPumpSpend),
        moneyLine("", "× 30%, capped at the separate $2,000 heat-pump annual limit", re.heatPumpCredit, { indent: 1 }),
      );
    }
    partII.push(
      moneyLine("30", "Energy efficient home improvement credit (§25C)", section25cTotal, {
        emphasis: true,
        note: "Combined §25C annual maximum $3,200 ($1,200 general + $2,000 heat pump). §25C has NO carryforward — unused credit is lost.",
      }),
      checkLine("§25C total = general + heat-pump components", re.efficientHomeCredit + re.heatPumpCredit, section25cTotal),
    );
    parts.push({ title: "Part II — Energy Efficient Home Improvement Credit (§25C)", lines: partII });
  }

  // ── Extra (engine-bundled) — §30C EV charger, officially Form 8911 ──
  if (nz(re.evChargerSpend) || nz(re.evChargerCredit)) {
    parts.push({
      title: "Alternative Fuel Vehicle Refueling Property (§30C) — officially Form 8911, NOT Form 5695",
      lines: [
        moneyLine("", "Refueling property cost (EV charger)", re.evChargerSpend),
        moneyLine("", "× 30%, capped at $1,000 (§30C personal-use limit)", re.evChargerCredit, {
          emphasis: true,
          note: "Rendered here because the engine folds §30C into its residential-energy total. The §30C(c)(3)(B) eligible-census-tract requirement is assumed satisfied — CPA verifies.",
        }),
      ],
    });
  }

  // ── Summary — ties to the engine total ──
  parts.push({
    title: "Summary — engine residential-energy credit package",
    lines: [
      moneyLine("", "Total residential energy credits (§25D + §25C + §30C, before liability limit)", re.total, {
        emphasis: true,
      }),
      checkLine(
        "Form total ties to engine residentialEnergyCredits.total",
        re.cleanEnergyCredit + re.efficientHomeCredit + re.heatPumpCredit + re.evChargerCredit,
        re.total,
      ),
    ],
  });

  return {
    formId: "5695",
    formNumber: "Form 5695",
    title: "Residential Energy Credits",
    subtitle: "§25D Residential Clean Energy Credit + §25C Energy Efficient Home Improvement Credit (with the engine-bundled §30C / Form 8911 row disclosed)",
    taxYear: ret.taxYear,
    parts,
    footnotes: [
      "The §25D bucket is an engine aggregate of all clean-energy property types; the fuel-cell sub-computation (lines 7–11, $500 per half-kW) is not modeled.",
      "Form 5695 lines 12/14/15/16 (prior-year §25D carryforward in, tax-liability limitation, carryforward out) are not modeled — the engine caps each nonrefundable credit at remaining income tax in Schedule 3 ordering and does NOT track an unused-§25D carryforward.",
      "§25C per-item sub-caps (windows $600, doors $250 each / $500 total, home energy audit $150, $600 per item of residential energy property) are not modeled — only the $1,200 general aggregate and the $2,000 heat-pump cap.",
      "Credits shown are BEFORE the tax-liability limitation. When income tax is insufficient, the applied amount is smaller — see the reconciliation worksheet's nonrefundable-credit section for the applied total.",
      "§30C (EV charger) is officially claimed on Form 8911 (Schedule 3 line 6j), not Form 5695; the engine bundles it into this package, so it is disclosed here as a labeled extra section.",
    ],
  };
}
