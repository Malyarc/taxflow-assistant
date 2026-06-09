// ───────────────────────────────────────────────────────────────────────────
// Form 4797 — Sales of Business Property (T1.1b)
//
// Computes the federal-tax consequences of selling depreciable / business
// property (IRC §1231, §1245, §1250) and feeds three engine channels:
//   1. ORDINARY income  — depreciation recapture (§1245 full / §1250 excess) +
//      a net §1231 LOSS (fully deductible, no $3k cap) + §1231(c) 5-year
//      lookback recharacterization + Part II (short-term) ordinary gain/loss.
//   2. LONG-TERM capital gain — a net §1231 GAIN (Form 4797 line 7 → Schedule D
//      line 11), which then rides the preferential 0/15/20% + 25% + 28% stack.
//   3. Unrecaptured §1250 gain — the straight-line-depreciation portion of a
//      §1250 (real-property) sale, taxed at a maximum 25% (a SUBSET of #2).
//
// Pure module (no Date/random/DB) — part of the Haven migration seam.
//
// Primary sources:
//   • IRC §1231 (property used in a trade or business) — net gain → capital,
//     net loss → ordinary; §1231(c) 5-year lookback recapture.
//   • IRC §1245 (recapture on depreciable personal property) — gain is ordinary
//     up to ALL depreciation taken.
//   • IRC §1250 (recapture on depreciable real property) — gain is ordinary only
//     up to "additional depreciation" (accelerated over straight-line; ~0 for
//     post-1986 MACRS real property, which is straight-line). The remaining
//     depreciation-driven gain is "unrecaptured §1250 gain" (§1(h)(1)(E), 25%).
//   • IRS 2024 Form 4797 + Instructions (Parts I/II/III); Schedule D
//     "Unrecaptured Section 1250 Gain Worksheet".
// ───────────────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type BusinessPropertyClass =
  | "section1245" // depreciable personal property / equipment / amortizable intangibles
  | "section1250" // depreciable real property (buildings, structural components)
  | "land" //        non-depreciable §1231 real property
  | "section1231_other"; // other §1231 property (e.g. unharvested crops, livestock)

/**
 * One disposition of business / depreciable property (a Form 4797 line).
 */
export interface BusinessPropertySaleFact {
  taxYear: number;
  description?: string | null;
  /** Form 4797 col (d) — gross sales price / amount realized. */
  grossSalePrice: number;
  /** Original UNADJUSTED cost or other basis (before depreciation). */
  costOrBasis: number;
  /** Total depreciation / amortization allowed or allowable (≥ 0). */
  depreciationAllowed: number;
  assetClass: BusinessPropertyClass;
  /** §1231 requires a >1-year holding period; ≤1-year dispositions of business
   *  property are ORDINARY (Form 4797 Part II). Defaults to true. */
  heldMoreThanOneYear?: boolean | null;
  /** §1250 only — "additional depreciation": depreciation claimed IN EXCESS of
   *  straight-line (Form 4797 line 26a worksheet). Post-1986 MACRS real property
   *  is straight-line, so this is 0 and the whole depreciation portion becomes
   *  unrecaptured §1250 gain (25%). Defaults to 0. */
  additionalDepreciation?: number | null;
}

export interface Form4797Result {
  /** Net ORDINARY income from Form 4797 (SIGNED): +recapture +lookback
   *  +Part-II-ordinary, and −(net §1231 loss). Add to Form 1040 ordinary income. */
  ordinaryComponent: number;
  /** Net §1231 GAIN surviving as long-term capital gain (→ Schedule D). 0 on a
   *  net §1231 loss. */
  netSection1231LtcgGain: number;
  /** Unrecaptured §1250 gain (25% bucket) — a SUBSET of netSection1231LtcgGain. */
  unrecaptured1250Gain: number;
  // ── transparency / Form 4797 reconciliation ──
  section1245OrdinaryRecapture: number;
  section1250OrdinaryRecapture: number;
  section1231GainGross: number;
  section1231LossGross: number;
  netSection1231: number;
  section1231LookbackRecapture: number;
  partIIOrdinary: number;
  assetCount: number;
}

const EMPTY_RESULT: Form4797Result = {
  ordinaryComponent: 0,
  netSection1231LtcgGain: 0,
  unrecaptured1250Gain: 0,
  section1245OrdinaryRecapture: 0,
  section1250OrdinaryRecapture: 0,
  section1231GainGross: 0,
  section1231LossGross: 0,
  netSection1231: 0,
  section1231LookbackRecapture: 0,
  partIIOrdinary: 0,
  assetCount: 0,
};

/**
 * Compute Form 4797 for a single tax year.
 *
 * @param sales         business-property dispositions for the year
 * @param lookbackLoss  §1231(c) non-recaptured net §1231 losses from the prior
 *                      5 years (recharacterizes the current net §1231 gain as
 *                      ordinary, up to this amount). Default 0.
 */
export function computeForm4797(
  sales: BusinessPropertySaleFact[],
  lookbackLoss = 0,
): Form4797Result {
  if (!sales || sales.length === 0) return { ...EMPTY_RESULT };

  let section1245OrdinaryRecapture = 0;
  let section1250OrdinaryRecapture = 0;
  let section1231GainGross = 0;
  let section1231LossGross = 0;
  let unrecaptured1250Pool = 0;
  let partIIOrdinary = 0; // Part II: ordinary gains/losses (short-term business property)

  for (const sale of sales) {
    const proceeds = num(sale.grossSalePrice);
    const cost = num(sale.costOrBasis);
    const depr = Math.max(0, num(sale.depreciationAllowed));
    const adjustedBasis = cost - depr;
    const realizedGain = proceeds - adjustedBasis;
    const longTerm = sale.heldMoreThanOneYear !== false; // default true

    // Part II — property held ≤ 1 year: ordinary gain/loss (no §1231/§1245 split).
    if (!longTerm) {
      partIIOrdinary += realizedGain;
      continue;
    }

    if (realizedGain <= 0) {
      // §1231 loss (enters the §1231 netting pool; net loss → ordinary).
      section1231LossGross += -realizedGain;
      continue;
    }

    switch (sale.assetClass) {
      case "section1245": {
        // §1245: ordinary recapture = gain up to ALL depreciation taken.
        const recapture = Math.min(realizedGain, depr);
        section1245OrdinaryRecapture += recapture;
        // True appreciation above original cost (only when proceeds > cost) is
        // §1231 gain.
        section1231GainGross += realizedGain - recapture;
        break;
      }
      case "section1250": {
        // §1250: ordinary recapture only on "additional depreciation"
        // (accelerated over straight-line). Post-1986 MACRS real property is
        // straight-line → additional depreciation is 0.
        const additional = Math.max(0, num(sale.additionalDepreciation));
        const ordinaryRecapture = Math.min(realizedGain, additional);
        section1250OrdinaryRecapture += ordinaryRecapture;
        const remaining = realizedGain - ordinaryRecapture;
        // Unrecaptured §1250 gain = the straight-line depreciation portion of the
        // remaining gain (25% bucket), bounded by the remaining gain.
        const straightLineDepr = Math.max(0, depr - additional);
        unrecaptured1250Pool += Math.min(remaining, straightLineDepr);
        // All of the remaining gain is §1231 gain (the unrecaptured portion is a
        // character SUBSET of it).
        section1231GainGross += remaining;
        break;
      }
      default: {
        // land / other §1231 property — entire gain is §1231 gain.
        section1231GainGross += realizedGain;
        break;
      }
    }
  }

  const netSection1231 = section1231GainGross - section1231LossGross;
  // §1245/§1250 recapture is ALWAYS ordinary (Part III), independent of §1231
  // netting. Part II ordinary gains/losses are also always ordinary.
  let ordinaryComponent =
    section1245OrdinaryRecapture + section1250OrdinaryRecapture + partIIOrdinary;
  let netSection1231LtcgGain = 0;
  let unrecaptured1250Gain = 0;
  let section1231LookbackRecapture = 0;

  if (netSection1231 > 0) {
    // §1231(c) 5-year lookback: recharacterize the net §1231 gain as ORDINARY up
    // to the prior 5 years' non-recaptured net §1231 losses.
    section1231LookbackRecapture = Math.min(netSection1231, Math.max(0, lookbackLoss));
    ordinaryComponent += section1231LookbackRecapture;
    netSection1231LtcgGain = netSection1231 - section1231LookbackRecapture;
    // The 25% bucket survives only to the extent the §1231 gain survives as LTCG.
    // The lookback is treated as recharacterizing the regular (0/15/20%) §1231
    // gain first (the IRS Unrecaptured §1250 Gain Worksheet does not net the
    // §1231(c) recapture against the §1250 amount) — so §1250 is bounded last.
    unrecaptured1250Gain = Math.min(unrecaptured1250Pool, netSection1231LtcgGain);
  } else {
    // Net §1231 loss → fully ordinary (signed, reduces ordinary income).
    ordinaryComponent += netSection1231; // netSection1231 ≤ 0 here
  }

  return {
    ordinaryComponent,
    netSection1231LtcgGain,
    unrecaptured1250Gain,
    section1245OrdinaryRecapture,
    section1250OrdinaryRecapture,
    section1231GainGross,
    section1231LossGross,
    netSection1231,
    section1231LookbackRecapture,
    partIIOrdinary,
    assetCount: sales.length,
  };
}
