/**
 * T2.1 — Form 4797 (Sales of Business Property) substitute workpaper.
 *
 * Renders the engine's §1231/§1245/§1250 disposition math (`ret.form4797`,
 * computed by lib/form4797.ts — T1.1b) against the official TY2024 Form 4797
 * layout:
 *   Part I   — §1231 netting (line 2 per-property, 6, 7, 8 lookback, 9 → Sch D)
 *   Part II  — ordinary gains/losses (lines 10–13, 17)
 *   Part III — recapture detail per gain property (lines 19–26, 30–32)
 *
 * Per-property rows are rebuilt from `inputs.form4797` (same arithmetic as the
 * engine module — Part III lines 23/24/25b/26g mirror computeForm4797 exactly)
 * and every SECTION TOTAL is tied to the engine's Form4797Result fields with
 * ✓/⚠ check rows, so any divergence between this workpaper's per-property
 * re-derivation and the engine is loudly visible. Degrades to aggregate-only
 * rendering when `inputs` is absent.
 *
 * Routing recap (IRC §1231/§1245/§1250 + 2024 Form 4797 instructions):
 *   - held ≤ 1 year            → Part II line 10 (ordinary, no §1231 netting)
 *   - held > 1 year, net loss  → Part I line 2 (loss; a NET §1231 loss is
 *                                fully ordinary — no $3,000 capital-loss cap)
 *   - §1245 gain               → Part III: ordinary recapture up to ALL
 *                                depreciation (line 25b); excess → §1231
 *   - §1250 gain               → Part III: ordinary recapture only on
 *                                ADDITIONAL (accelerated-over-SL) depreciation
 *                                (line 26g; 0 for post-1986 MACRS realty); the
 *                                straight-line portion = unrecaptured §1250
 *                                gain (25% bucket); remainder + appreciation
 *                                → §1231
 *   - land / other §1231 gain  → Part I line 2 directly (no Part III)
 */

import type { ComputedTaxReturn, TaxReturnInputs } from "../taxReturnEngine";
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

type SaleFact = NonNullable<TaxReturnInputs["form4797"]>[number];
type Form4797Result = NonNullable<ComputedTaxReturn["form4797"]>;

function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Per-property derivation mirroring lib/form4797.ts computeForm4797. */
interface PropRow {
  desc: string;
  cls: string;
  longTerm: boolean;
  proceeds: number;
  cost: number;
  depr: number;
  adjBasis: number;
  realizedGain: number;
  recapture1245: number;
  recapture1250: number;
  additionalDepr: number;
  unrecap1250Memo: number;
  section1231Gain: number; // gain surviving to §1231 (0 for losses / short-term)
  section1231Loss: number; // positive loss amount entering the §1231 pool
  nonPassive: boolean;
}

function deriveProp(sale: SaleFact, index: number): PropRow {
  const proceeds = toNum(sale.grossSalePrice);
  const cost = toNum(sale.costOrBasis);
  const depr = Math.max(0, toNum(sale.depreciationAllowed));
  const adjBasis = cost - depr;
  const realizedGain = proceeds - adjBasis;
  const longTerm = sale.heldMoreThanOneYear !== false; // engine default: true
  const cls = sale.assetClass;
  const desc = (sale.description ?? "").trim() || `Property ${index + 1}`;

  const row: PropRow = {
    desc,
    cls,
    longTerm,
    proceeds,
    cost,
    depr,
    adjBasis,
    realizedGain,
    recapture1245: 0,
    recapture1250: 0,
    additionalDepr: 0,
    unrecap1250Memo: 0,
    section1231Gain: 0,
    section1231Loss: 0,
    nonPassive: sale.nonPassive === true,
  };
  if (!longTerm) return row; // Part II — no §1231/recapture split
  if (realizedGain <= 0) {
    row.section1231Loss = -realizedGain;
    return row;
  }
  if (cls === "section1245") {
    row.recapture1245 = Math.min(realizedGain, depr);
    row.section1231Gain = realizedGain - row.recapture1245;
  } else if (cls === "section1250") {
    const additional = Math.max(0, toNum(sale.additionalDepreciation));
    row.additionalDepr = additional;
    row.recapture1250 = Math.min(realizedGain, additional);
    const remaining = realizedGain - row.recapture1250;
    const straightLineDepr = Math.max(0, depr - additional);
    row.unrecap1250Memo = Math.min(remaining, straightLineDepr);
    row.section1231Gain = remaining;
  } else {
    // land / section1231_other — entire gain is §1231 gain (Part I line 2).
    row.section1231Gain = realizedGain;
  }
  return row;
}

export function buildForm4797Form(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const f: Form4797Result | null = ret.form4797;
  if (!f) return null; // engine emits null when no business-property dispositions

  const sales = (inputs?.form4797 ?? []).filter((s) => s.taxYear === ret.taxYear);
  const props = sales.map(deriveProp);
  const hasDetail = props.length > 0;

  const partIIIProps = props.filter(
    (p) => p.longTerm && p.realizedGain > 0 && (p.cls === "section1245" || p.cls === "section1250"),
  );
  const partILine2Gains = props.filter(
    (p) => p.longTerm && p.realizedGain > 0 && p.cls !== "section1245" && p.cls !== "section1250",
  );
  const partILine2Losses = props.filter((p) => p.longTerm && p.realizedGain <= 0 && nz(p.realizedGain));
  const partIIShortTerm = props.filter((p) => !p.longTerm);

  const totalRecapture = f.section1245OrdinaryRecapture + f.section1250OrdinaryRecapture;
  const netLoss1231 = Math.min(0, f.netSection1231); // signed (≤ 0)

  // ── Part I — §1231 netting ──
  const partI: FormLine[] = [];
  if (hasDetail) {
    for (const p of partILine2Gains) {
      partI.push(
        moneyLine("2", `${p.desc} — §1231 gain (${p.cls === "land" ? "land" : "other §1231 property"}, held > 1 yr)`, p.realizedGain, {
          note: `Sales price ${fmt(p.proceeds)} − adjusted basis ${fmt(p.adjBasis)} (no depreciation recapture class).`,
        }),
      );
    }
    for (const p of partILine2Losses) {
      partI.push(
        moneyLine("2", `${p.desc} — §1231 loss (held > 1 yr)`, p.realizedGain, {
          note: `Sales price ${fmt(p.proceeds)} − adjusted basis ${fmt(p.adjBasis)}.`,
        }),
      );
    }
    if (nz(partIIIPropsGain(partIIIProps))) {
      partI.push(
        moneyLine("6", "Gain from Part III line 32 (recapture-class properties, post-recapture)", partIIIPropsGain(partIIIProps)),
      );
    }
  } else {
    // Aggregate-only mode — per-property line 2 / line 6 split is not available.
    if (nz(f.section1231GainGross)) {
      partI.push(
        moneyLine("2/6", "§1231 gains — all properties (lines 2 + 6 combined; per-property detail not supplied)", f.section1231GainGross),
      );
    }
    if (nz(f.section1231LossGross)) {
      partI.push(moneyLine("2", "§1231 losses — all properties", -f.section1231LossGross));
    }
  }
  partI.push(
    moneyLine("7", "Net §1231 gain or (loss) — combine lines 2 through 6", f.netSection1231, { emphasis: true }),
  );
  if (hasDetail) {
    partI.push(
      checkLine(
        "Line 7 ties: per-property gains − losses",
        partIIIPropsGain(partIIIProps) +
          partILine2Gains.reduce((s, p) => s + p.realizedGain, 0) +
          partILine2Losses.reduce((s, p) => s + p.realizedGain, 0),
        f.netSection1231,
      ),
    );
  }
  if (nz(f.section1231LookbackRecapture)) {
    partI.push(
      moneyLine("8", "Nonrecaptured net §1231 losses from prior 5 years — APPLIED recapture", f.section1231LookbackRecapture, {
        note: "§1231(c) lookback: this portion of the line 7 gain is recharacterized as ORDINARY (Part II line 12). Rendered as the applied amount = min(line 7 gain, prior nonrecaptured losses); the full prior-loss balance is CPA-tracked (supplied via the section_1231_lookback_loss adjustment).",
      }),
    );
  }
  partI.push(
    moneyLine("9", "Line 7 minus line 8 — net §1231 gain treated as long-term capital gain", f.netSection1231LtcgGain, {
      emphasis: true,
      note:
        f.netSection1231 > 0
          ? "→ Schedule D line 11. Rides the preferential 0/15/20% stack, carrying any unrecaptured §1250 (25%) character below."
          : "Net §1231 LOSS → fully ORDINARY (Part II line 11) — deductible in full, NOT subject to the $3,000 capital-loss limitation.",
    }),
  );

  // ── Part II — ordinary gains and losses ──
  const partII: FormLine[] = [];
  if (hasDetail) {
    for (const p of partIIShortTerm) {
      partII.push(
        moneyLine("10", `${p.desc} — held ≤ 1 year (ordinary gain or loss)`, p.realizedGain, {
          note: `Sales price ${fmt(p.proceeds)} − adjusted basis ${fmt(p.adjBasis)}; business property held ≤ 1 year never enters §1231.`,
        }),
      );
    }
  } else if (nz(f.partIIOrdinary)) {
    partII.push(moneyLine("10", "Ordinary gains/losses on property held ≤ 1 year (aggregate)", f.partIIOrdinary));
  }
  if (nz(netLoss1231)) {
    partII.push(
      moneyLine("11", "Loss, if any, from line 7 (net §1231 loss — fully ordinary)", netLoss1231, {
        note: "No $3,000 cap — a net §1231 loss is an ordinary deduction in full (IRC §1231(a)(2)).",
      }),
    );
  }
  if (nz(f.section1231LookbackRecapture)) {
    partII.push(moneyLine("12", "Amount from line 8 (§1231(c) lookback recapture → ordinary)", f.section1231LookbackRecapture));
  }
  if (nz(totalRecapture)) {
    partII.push(
      moneyLine("13", "Gain from line 31 (depreciation recapture — §1245 + §1250 additional)", totalRecapture),
    );
  }
  partII.push(
    moneyLine("17", "Combine lines 10 through 16 — total ordinary gain or (loss)", f.ordinaryComponent, {
      emphasis: true,
      note: "Flows into the return's ordinary income (engine: form4797.ordinaryComponent, signed — Schedule 1 line 4 / line 8 region).",
    }),
  );
  partII.push(
    checkLine(
      "Line 17 = line 10 + line 11 + line 12 + line 13",
      f.partIIOrdinary + netLoss1231 + f.section1231LookbackRecapture + totalRecapture,
      f.ordinaryComponent,
    ),
  );

  // ── Part III — recapture detail (gain properties under §1245/§1250) ──
  const partIII: FormLine[] = [];
  if (hasDetail) {
    partIIIProps.forEach((p, i) => {
      partIII.push(
        textLine("19", `Property ${String.fromCharCode(65 + Math.min(i, 25))}: ${p.desc}`, p.cls === "section1245" ? "§1245 (depreciable personal property)" : "§1250 (depreciable real property)"),
      );
      partIII.push(moneyLine("20", "Gross sales price", p.proceeds, { indent: 1 }));
      partIII.push(moneyLine("21", "Cost or other basis (unadjusted)", p.cost, { indent: 1 }));
      partIII.push(moneyLine("22", "Depreciation allowed or allowable", p.depr, { indent: 1 }));
      partIII.push(moneyLine("23", "Adjusted basis (line 21 − line 22)", p.adjBasis, { indent: 1 }));
      partIII.push(moneyLine("24", "Total gain (line 20 − line 23)", p.realizedGain, { indent: 1 }));
      if (p.cls === "section1245") {
        partIII.push(
          moneyLine("25b", "§1245 ordinary recapture — smaller of line 24 or depreciation (line 25a)", p.recapture1245, {
            indent: 1,
            note: "Gain is ordinary up to ALL depreciation taken (§1245(a)); only appreciation above original cost survives as §1231 gain.",
          }),
        );
      } else {
        partIII.push(
          moneyLine("26g", "§1250 ordinary recapture — additional (accelerated-over-SL) depreciation only", p.recapture1250, {
            indent: 1,
            note: `Additional depreciation ${fmt(p.additionalDepr)}. Post-1986 MACRS real property is straight-line → 0 ordinary recapture.`,
          }),
        );
        if (nz(p.unrecap1250Memo)) {
          partIII.push(
            moneyLine("", "Unrecaptured §1250 gain memo — straight-line depreciation portion, capped at gain", p.unrecap1250Memo, {
              indent: 2,
              note: "min(gain after line 26g, depreciation − additional). 25%-rate character inside the §1231 gain (Schedule D line 19 worksheet).",
            }),
          );
        }
      }
      if (nz(p.section1231Gain)) {
        partIII.push(
          moneyLine("", "Gain surviving to §1231 after recapture (→ line 32 → Part I line 6)", p.section1231Gain, { indent: 1 }),
        );
      }
    });
    if (partIIIProps.length > 0) {
      const line30 = partIIIProps.reduce((s, p) => s + p.realizedGain, 0);
      const line31FromProps = partIIIProps.reduce((s, p) => s + p.recapture1245 + p.recapture1250, 0);
      partIII.push(moneyLine("30", "Total gains for all Part III properties (sum of line 24)", line30, { emphasis: true }));
      partIII.push(moneyLine("31", "Total ordinary recapture (sum of lines 25b + 26g)", line31FromProps, {
        emphasis: true,
        note: "→ Part II line 13.",
      }));
      partIII.push(checkLine("Line 31 ties to engine recapture (§1245 + §1250)", line31FromProps, totalRecapture));
      partIII.push(
        moneyLine("32", "Line 30 − line 31 (→ Part I line 6)", line30 - line31FromProps, { emphasis: true }),
      );
    }
  } else if (nz(totalRecapture)) {
    if (nz(f.section1245OrdinaryRecapture)) {
      partIII.push(moneyLine("25b", "§1245 ordinary recapture (aggregate)", f.section1245OrdinaryRecapture));
    }
    if (nz(f.section1250OrdinaryRecapture)) {
      partIII.push(moneyLine("26g", "§1250 additional-depreciation recapture (aggregate)", f.section1250OrdinaryRecapture));
    }
    partIII.push(moneyLine("31", "Total ordinary recapture (→ Part II line 13)", totalRecapture, { emphasis: true }));
  }

  // ── Schedule D / NIIT cross-reference ──
  const crossRef: FormLine[] = [
    moneyLine("", "Unrecaptured §1250 gain from this form (pool, capped at the surviving §1231 LTCG)", f.unrecaptured1250Gain, {
      emphasis: true,
      note: "→ Schedule D line 19 — the Schedule D Tax Worksheet INTERLEAVES this layer with the ordinary brackets (taxed at ordinary rates up to the top of the 24% bracket), with the IRC §1(h)(1)(E) 25% statutory maximum applying only to the remainder above that. NOT a flat 25%.",
    }),
    moneyLine("", "Unrecaptured §1250 gain reported on the return (Schedule D line 19 bucket)", ret.unrecapturedSection1250Gain, {
      note: "Return-level bucket. May exceed this form's pool (direct Form 8949 §1250-class lots / aggregate adjustments) or fall below it (long-term loss absorption — losses erode the 28% bucket first, then §1250; bounded by net LTCG).",
    }),
  ];
  if (nz(f.nonPassiveSection1231Gain)) {
    crossRef.push(
      moneyLine("", "Non-passive §1231 gain — EXCLUDED from the §1411 NIIT base", f.nonPassiveSection1231Gain, {
        note: "Dispositions flagged nonPassive (materially-participated trade/business) are not net investment income (§1411(c)(1)); the engine excludes this portion from Form 8960, capped at the surviving §1231 LTCG.",
      }),
    );
  } else if (f.netSection1231LtcgGain > 0) {
    crossRef.push(
      textLine("", "NIIT treatment of the §1231 gain", "included in NII (conservative default)", {
        note: "No disposition was flagged nonPassive, so the engine includes the surviving §1231 gain in the §1411 NIIT base. Flag materially-participated trade/business sales nonPassive to exclude them.",
      }),
    );
  }

  const parts: FormPart[] = [
    { title: "Part I — Sales of property used in a trade or business held more than 1 year (§1231)", lines: partI },
    { title: "Part II — Ordinary gains and losses", lines: partII },
  ];
  if (partIII.length > 0) {
    parts.push({ title: "Part III — Gain from disposition of property under §1245 / §1250", lines: partIII });
  }
  parts.push({ title: "Schedule D / NIIT cross-reference", lines: crossRef });

  return {
    formId: "4797",
    formNumber: "Form 4797",
    title: "Sales of Business Property",
    subtitle: "§1231 netting + §1245/§1250 recapture — substitute workpaper, not a filed form",
    taxYear: ret.taxYear,
    parts,
    footnotes: [
      "Recapture model: §1245 gain is ordinary up to ALL depreciation taken; §1250 ordinary recapture applies only to ADDITIONAL (accelerated-over-straight-line) depreciation — 0 for post-1986 MACRS real property — and the straight-line depreciation portion of the gain is unrecaptured §1250 gain taxed at a maximum 25% (§1(h)(1)(E)).",
      "Not modeled (CPA supplies on the official form): installment-sale §1231/ordinary gains (lines 4/15, Form 6252), casualty/theft (lines 3/14, Form 4684), like-kind exchanges (lines 5/16, Form 8824), §1252/§1254/§1255 property (lines 27–29), and Part IV §179/§280F(b)(2) recapture on business-use drop.",
      "Line 8 shows the APPLIED §1231(c) lookback recapture (min of the line 7 gain and the prior 5 years' nonrecaptured §1231 losses, supplied via the section_1231_lookback_loss adjustment) — the engine does not track the running 5-year loss ledger across years.",
      "A net §1231 loss is NOT auto-aggregated into the engine's §461(l) excess-business-loss check (conservative direction; CPA can supply the explicit addback override).",
      "Per-property rows re-derive the engine module's arithmetic from the input register; the ✓ check rows tie every section total to the engine's Form4797Result to the cent.",
    ],
  };
}

function partIIIPropsGain(props: PropRow[]): number {
  return props.reduce((s, p) => s + p.section1231Gain, 0);
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
