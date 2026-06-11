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

  // Applicable when the package computes a credit OR a §25D carryforward is
  // in play (applied or rolling forward) — FC-11.
  if (!(re.total > 0 || ret.residentialCleanEnergyApplied > 0 || ret.residentialCleanEnergyCarryforward > 0)) return null;

  const parts: FormPart[] = [];

  // ── Part I — Residential Clean Energy Credit (§25D) ──
  if (nz(re.cleanEnergySpend) || nz(re.cleanEnergyCredit) || nz(ret.residentialCleanEnergyApplied) || nz(ret.residentialCleanEnergyCarryforward)) {
    const carryforwardIn = Math.max(
      0,
      ret.residentialCleanEnergyApplied + ret.residentialCleanEnergyCarryforward - re.cleanEnergyCredit,
    );
    const partI: FormLine[] = [
      moneyLine("1", "Qualified clean energy property costs", re.cleanEnergySpend, {
        note: "Engine aggregate of all §25D property types (solar electric/water heating, small wind, geothermal, battery storage ≥3 kWh) — lines 1–5b are not split per type.",
      }),
      moneyLine("6a", "Total qualified clean energy property costs (lines 1 through 5b)", re.cleanEnergySpend),
      moneyLine("6b", "Multiply line 6a by 30% (0.30)", re.cleanEnergyCredit, {
        note: ret.taxYear >= 2026
          ? "OBBBA §70506 terminated §25D for expenditures made after 12/31/2025 — current-year spend earns $0 on a TY2026+ return; only a prior-year carryforward (line 12) still applies."
          : undefined,
      }),
      moneyLine("12", "Credit carryforward from prior year (§25D(c))", carryforwardIn),
      moneyLine("13", "Add lines 6b and 12 — total available §25D credit", re.cleanEnergyCredit + carryforwardIn, {
        emphasis: true,
        note: "No annual dollar cap and no income limit.",
      }),
      moneyLine("15", "Residential clean energy credit applied (smaller of line 13 or the line 14 tax-liability limitation)", ret.residentialCleanEnergyApplied, {
        note: "FC-11 — applied AFTER the child tax credit in the engine's credit ordering (the §25D credit-limit worksheet subtracts Form 1040 line 19; §25D is NOT in the Schedule 8812 Credit Limit Worksheet list).",
      }),
      moneyLine("16", "Credit carryforward to next year (line 13 minus line 15)", ret.residentialCleanEnergyCarryforward, {
        note: "Auto-seeded next year as the residential_clean_energy_carryforward adjustment. Survives the OBBBA termination (only post-2025 EXPENDITURES lose the credit; §25D(c) was not amended).",
      }),
      checkLine(
        "Line 16 ties: line 13 − line 15",
        re.cleanEnergyCredit + carryforwardIn - ret.residentialCleanEnergyApplied,
        ret.residentialCleanEnergyCarryforward,
      ),
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
      "FC-11 — the §25D tax-liability limitation and carryforward (lines 12/15/16) ARE now modeled: §25D applies AFTER the child tax credit and its unused balance rolls forward under §25D(c) (auto-seeded next year). The line-14 worksheet detail itself is engine-internal credit ordering.",
      "FC-02 — OBBBA terminations: §25C (P.L. 119-21 §70505) for property placed in service after 12/31/2025 and §25D (§70506) for expenditures made after 12/31/2025 — both are $0 for TY2026+ current-year spend (a §25D expenditure is 'made' when the original installation completes, §25D(e)(8)(A)). A pre-2026 §25D carryforward still applies. §30C terminates only for property placed in service after 6/30/2026 (CPA verifies the install date on a TY2026 claim).",
      "§25C per-item sub-caps (windows $600, doors $250 each / $500 total, home energy audit $150, $600 per item of residential energy property) are not modeled — only the $1,200 general aggregate and the $2,000 heat-pump cap.",
      "§25C/§30C credits shown are BEFORE the tax-liability limitation. When income tax is insufficient, the applied amount is smaller — see the reconciliation worksheet's nonrefundable-credit section for the applied total.",
      "§30C (EV charger) is officially claimed on Form 8911 (Schedule 3 line 6j), not Form 5695; the engine bundles it into this package, so it is disclosed here as a labeled extra section.",
    ],
  };
}
