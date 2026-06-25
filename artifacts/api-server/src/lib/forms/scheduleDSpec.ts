/**
 * T2.1 — Schedule D (Form 1040) workpaper: Capital Gains and Losses.
 *
 * Decomposes the engine's Schedule D netting (taxReturnEngine.ts ~2360) into
 * the official TY2024 line layout. The engine's pre-cross-netting character
 * nets map 1:1 onto the official lines:
 *
 *   line 7  = form1099Summary.shortTermCapitalGains          (8949 / 1099-B)
 *           + scheduleK1.totalShortTermCapitalGain           (K-1 box 8)
 *           − Σ capital_loss_carryforward_short              (line 6, negative)
 *
 *   line 15 = form1099Summary.longTermCapitalGains           (8949/1099-B + DIV 2a)
 *           + scheduleK1.totalLongTermCapitalGain            (K-1 box 9a)
 *           − Σ capital_loss_carryforward_long               (line 14, negative)
 *           + homeSaleTaxableGain                            (§121 remainder)
 *           + qsbsTaxableGain                                (§1202 remainder)
 *           + section1031RecognizedGain                      (Form 8824 boot)
 *           + max(0, Σ long_term_capital_gain adjustment)    (manual lever)
 *           + form4797.netSection1231LtcgGain                (line 11)
 *
 *   line 16 = line 7 + line 15 == ret.netCapitalGainLoss (cross-netting moves
 *   amounts between the two characters but never changes the sum) — tie-out.
 *
 * Per-box rows (1b/2/3, 8b/9/10) re-aggregate inputs.capitalTransactions with
 * the ENGINE's exact bucketing: a missing formBox defaults to Box A (short),
 * an unrecognized box is EXCLUDED from both buckets (disclosed loudly). The
 * rows show BROKER-ENTERED amounts; when the engine auto-detected §1091 wash
 * sales its internal totals differ per-bucket (loss reversal + replacement
 * basis add + possible ST→LT box flip) while the combined line-16 identity is
 * invariant — the per-bucket tie-outs are therefore gated on
 * washSalesDetected === 0 and a disclosure block renders instead.
 *
 * Lines 18/19 carry the engine's post-loss-absorption 28%-rate and
 * unrecaptured-§1250 buckets — character SUBSETS of the line-16 gain, never
 * additive rows.
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
import type { CapitalTransactionFact } from "../taxReturnEngine";

function toNum(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

function usd(v: number): string {
  return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Engine-exact Form 8949 column (h): proceeds − basis + adjustment. */
function lotGain(t: CapitalTransactionFact): number {
  return toNum(t.proceeds) - toNum(t.costBasis) + toNum(t.adjustmentAmount);
}

/**
 * Engine-exact box bucketing (taxReturnEngine.ts ~1536): formBox null/undefined
 * defaults to "A" (short-term); D/E/F long-term; anything else (incl. an empty
 * string or junk) is in NEITHER engine bucket.
 */
function normalizedBox(t: CapitalTransactionFact): string {
  return t.formBox == null ? "A" : String(t.formBox).toUpperCase();
}

interface BoxAgg {
  count: number;
  proceeds: number;
  basis: number;
  adj: number;
  gain: number;
}

const newAgg = (): BoxAgg => ({ count: 0, proceeds: 0, basis: 0, adj: 0, gain: 0 });

const ST_BOXES = ["A", "B", "C"] as const;
const LT_BOXES = ["D", "E", "F"] as const;
const BOX_LINE: Record<string, string> = { A: "1b", B: "2", C: "3", D: "8b", E: "9", F: "10" };
const BOX_LABEL: Record<string, string> = {
  A: "Box A — short-term, basis reported to the IRS",
  B: "Box B — short-term, basis NOT reported to the IRS",
  C: "Box C — short-term, not reported on Form 1099-B",
  D: "Box D — long-term, basis reported to the IRS",
  E: "Box E — long-term, basis NOT reported to the IRS",
  F: "Box F — long-term, not reported on Form 1099-B",
};

export function buildScheduleD(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const year = ret.taxYear;

  // ── Mirror the engine's input filters exactly ──
  const txns = (inputs?.capitalTransactions ?? []).filter((t) => t.taxYear === year);
  const sumAdj = (type: string): number =>
    (inputs?.adjustments ?? [])
      .filter((a) => a.isApplied !== false && a.adjustmentType === type)
      .reduce((s, a) => s + toNum(a.amount), 0);
  // 1099-DIV box 2a capital-gain distributions (additive to LT in BOTH the
  // aggregate and the per-transaction engine paths) — engine filter mirrored:
  // (taxYear ?? year) === year, formType case-insensitive.
  const cgDistributions = (inputs?.form1099s ?? [])
    .filter((r) => (r.taxYear ?? year) === year && (r.formType ?? "").toLowerCase() === "div")
    .reduce((s, r) => s + toNum(r.totalCapitalGainDistribution), 0);

  const cfShortIn = sumAdj("capital_loss_carryforward_short");
  const cfLongIn = sumAdj("capital_loss_carryforward_long");
  // Engine counts only a net-POSITIVE manual LTCG adjustment into the netting.
  const ltcgAdjIn = Math.max(0, sumAdj("long_term_capital_gain"));

  const engSt = ret.form1099Summary.shortTermCapitalGains;
  const engLt = ret.form1099Summary.longTermCapitalGains; // includes DIV 2a distributions
  const k1St = ret.scheduleK1.totalShortTermCapitalGain;
  const k1Lt = ret.scheduleK1.totalLongTermCapitalGain;
  const f4797Lt = ret.form4797?.netSection1231LtcgGain ?? 0;

  // ── Applicability — ANY capital field nonzero (incl. carryforwards + special gains) ──
  const applicable =
    txns.length > 0 ||
    [
      engSt,
      engLt,
      k1St,
      k1Lt,
      cfShortIn,
      cfLongIn,
      ltcgAdjIn,
      ret.netCapitalGainLoss,
      ret.capitalLossDeducted,
      ret.capitalLossCarryforwardShort,
      ret.capitalLossCarryforwardLong,
      ret.homeSaleGrossGain,
      ret.qsbsGrossGain,
      ret.section1031RecognizedGain,
      ret.unrecapturedSection1250Gain,
      ret.collectibles28RateGain,
      f4797Lt,
    ].some(nz);
  if (!applicable) return null;

  const perTxnMode = txns.length > 0;
  const autoWash = ret.washSalesDetected > 0;

  // ── Raw (broker-entered) per-box aggregation, engine-bucketed ──
  const byBox: Record<string, BoxAgg> = {
    A: newAgg(), B: newAgg(), C: newAgg(), D: newAgg(), E: newAgg(), F: newAgg(),
  };
  let unclassifiedCount = 0;
  let unclassifiedGain = 0;
  for (const t of txns) {
    const box = normalizedBox(t);
    const agg = byBox[box];
    if (!agg) {
      unclassifiedCount += 1;
      unclassifiedGain += lotGain(t);
      continue;
    }
    agg.count += 1;
    agg.proceeds += toNum(t.proceeds);
    agg.basis += toNum(t.costBasis);
    agg.adj += toNum(t.adjustmentAmount);
    agg.gain += lotGain(t);
  }
  const rawSt = byBox.A.gain + byBox.B.gain + byBox.C.gain;
  const rawLt = byBox.D.gain + byBox.E.gain + byBox.F.gain;

  // ── Part I — Short-Term (lines 1b–7) ──
  const stLines: FormLine[] = [];
  if (perTxnMode) {
    for (const box of ST_BOXES) {
      const a = byBox[box];
      if (a.count === 0) continue;
      stLines.push(
        moneyLine(BOX_LINE[box], `${BOX_LABEL[box]} (${a.count} lot${a.count === 1 ? "" : "s"})`, a.gain, {
          note: `proceeds ${usd(a.proceeds)} − basis ${usd(a.basis)} + adjustments ${usd(a.adj)} — detail on Form 8949 Part I`,
        }),
      );
    }
  } else if (nz(engSt)) {
    stLines.push(
      moneyLine("1b", "Short-term totals — 1099-B broker aggregate", engSt, {
        note: "No per-lot detail provided (aggregate 1099-B entry); Form 8949 omitted.",
      }),
    );
  }
  if (nz(k1St)) {
    stLines.push(
      moneyLine("5", "Net short-term gain or (loss) from partnerships / S corps (Schedule K-1 box 8)", k1St),
    );
  }
  if (nz(cfShortIn)) {
    stLines.push(
      moneyLine("6", "Short-term capital loss carryover from prior year", -cfShortIn, {
        note: "Engine adjustment capital_loss_carryforward_short (entered positive, applied as a loss).",
      }),
    );
  }
  const line7 = engSt + k1St - cfShortIn;
  stLines.push(
    moneyLine("7", "Net short-term capital gain or (loss) — combine lines 1b through 6", line7, {
      emphasis: true,
      ...(perTxnMode && autoWash
        ? { note: "Engine total reflects §1091 auto wash-sale adjustments; per-box rows above show broker-entered amounts." }
        : {}),
    }),
  );
  if (perTxnMode && !autoWash) {
    stLines.push(checkLine("Form 8949 Part I box totals tie engine short-term total", rawSt, engSt));
  }

  // ── Part II — Long-Term (lines 8b–15, with engine-component decomposition) ──
  const ltLines: FormLine[] = [];
  if (perTxnMode) {
    for (const box of LT_BOXES) {
      const a = byBox[box];
      if (a.count === 0) continue;
      ltLines.push(
        moneyLine(BOX_LINE[box], `${BOX_LABEL[box]} (${a.count} lot${a.count === 1 ? "" : "s"})`, a.gain, {
          note: `proceeds ${usd(a.proceeds)} − basis ${usd(a.basis)} + adjustments ${usd(a.adj)} — detail on Form 8949 Part II`,
        }),
      );
    }
  } else if (nz(engLt - cgDistributions)) {
    ltLines.push(
      moneyLine("8b", "Long-term totals — 1099-B broker aggregate (excl. line-13 distributions)", engLt - cgDistributions, {
        note: "No per-lot detail provided (aggregate 1099-B entry); Form 8949 omitted.",
      }),
    );
  }
  // Engine special-gain components — the official form carries these inside
  // Form 8949 (codes H/Q) or line 11; the engine models them as separate
  // channels, so they are decomposed here as additive rows into line 15.
  if (nz(ret.homeSaleTaxableGain)) {
    ltLines.push(
      moneyLine("", "§121 home-sale taxable remainder (officially a Form 8949 code-H row)", ret.homeSaleTaxableGain, {
        indent: 1,
        note: `gross gain ${usd(ret.homeSaleGrossGain)} − §121 exclusion ${usd(ret.homeSaleSection121Exclusion)} (Pub 523)`,
      }),
    );
  } else if (nz(ret.homeSaleGrossGain)) {
    ltLines.push(
      moneyLine("", "§121 home sale — fully excluded (info; officially still reported via Form 8949 code H)", 0, {
        indent: 1,
        note: `gross gain ${usd(ret.homeSaleGrossGain)} fully inside the §121 exclusion ${usd(ret.homeSaleSection121Exclusion)}`,
      }),
    );
  }
  if (nz(ret.qsbsTaxableGain)) {
    ltLines.push(
      moneyLine("", "§1202 QSBS taxable remainder (officially a Form 8949 code-Q row)", ret.qsbsTaxableGain, {
        indent: 1,
        note: `gross gain ${usd(ret.qsbsGrossGain)} − §1202 exclusion ${usd(ret.qsbsSection1202Exclusion)}`,
      }),
    );
  }
  if (nz(ltcgAdjIn)) {
    ltLines.push(
      moneyLine("", "Manual long-term capital gain adjustment (long_term_capital_gain)", ltcgAdjIn, {
        indent: 1,
        note: "Engine counts only a net-positive adjustment total into the netting.",
      }),
    );
  }
  if (nz(f4797Lt)) {
    ltLines.push(
      moneyLine("11", "Gain from Form 4797 Part I — net §1231 gain treated as long-term", f4797Lt, {
        note: "Post-§1231(c) lookback recharacterization; any unrecaptured §1250 character carries to line 19.",
      }),
    );
  }
  if (nz(ret.section1031RecognizedGain)) {
    ltLines.push(
      moneyLine("11", "§1031 recognized gain — boot received (Form 8824)", ret.section1031RecognizedGain, {
        note: `min(realized ${usd(ret.section1031RealizedGain)}, boot ${usd(ret.section1031BootReceived)}); deferred ${usd(ret.section1031DeferredGain)} carries to replacement basis.`,
      }),
    );
  }
  if (nz(k1Lt)) {
    ltLines.push(
      moneyLine("12", "Net long-term gain or (loss) from partnerships / S corps (Schedule K-1 box 9a)", k1Lt),
    );
  }
  if (nz(cgDistributions)) {
    ltLines.push(moneyLine("13", "Capital gain distributions (1099-DIV box 2a)", cgDistributions));
  }
  if (nz(cfLongIn)) {
    ltLines.push(
      moneyLine("14", "Long-term capital loss carryover from prior year", -cfLongIn, {
        note: "Engine adjustment capital_loss_carryforward_long (entered positive, applied as a loss).",
      }),
    );
  }
  const line15 =
    engLt + k1Lt - cfLongIn +
    ret.homeSaleTaxableGain + ret.qsbsTaxableGain + ret.section1031RecognizedGain +
    ltcgAdjIn + f4797Lt;
  ltLines.push(
    moneyLine("15", "Net long-term capital gain or (loss) — combine lines 8b through 14", line15, {
      emphasis: true,
      ...(perTxnMode && autoWash
        ? { note: "Engine total reflects §1091 auto wash-sale adjustments; per-box rows above show broker-entered amounts." }
        : {}),
    }),
  );
  if (perTxnMode && !autoWash) {
    ltLines.push(
      checkLine("Form 8949 Part II box totals tie engine long-term total (excl. distributions)", rawLt, engLt - cgDistributions),
    );
  }

  // ── Part III — Summary (lines 16–22) ──
  const line16 = line7 + line15;
  const p3: FormLine[] = [
    moneyLine("16", "Net capital gain or (loss) — combine lines 7 and 15", line16, { emphasis: true }),
    checkLine("Line 16 ties engine Schedule D line 16 (netCapitalGainLoss)", line16, ret.netCapitalGainLoss),
    moneyLine(
      "",
      "Flows to Form 1040 line 7",
      ret.netCapitalGainLoss >= 0 ? ret.netCapitalGainLoss : -ret.capitalLossDeducted,
      { indent: 1, note: "A net loss flows at the line-21 limited amount." },
    ),
  ];
  if (perTxnMode && autoWash) {
    p3.push(
      checkLine(
        "Combined raw 8949 total ties engine ST+LT (invariant under §1091 auto-adjustments)",
        rawSt + rawLt,
        engSt + (engLt - cgDistributions),
      ),
    );
  }
  if (unclassifiedCount > 0) {
    p3.push(
      textLine(
        "",
        `${unclassifiedCount} transaction(s) with an unrecognized Form 8949 box — EXCLUDED from engine totals (gain/loss ${usd(unclassifiedGain)})`,
        "review",
        { emphasis: true, note: "Engine convention: a missing box defaults to Box A; any other unrecognized box drops the row from BOTH buckets." },
      ),
    );
  }
  if (line16 > 0) {
    const bothGains = line15 > 0 && line16 > 0;
    p3.push(boolLine("17", "Are lines 15 and 16 both gains?", bothGains));
    if (bothGains) {
      const c28 = ret.collectibles28RateGain;
      const u1250 = ret.unrecapturedSection1250Gain;
      p3.push(
        moneyLine("18", "28%-rate gain (28%-Rate Gain Worksheet — collectibles + taxable §1202)", c28, {
          note: "A character SUBSET of the line-16 gain, NOT additive. The Schedule D Tax Worksheet INTERLEAVES this layer with the ordinary brackets: it is taxed at ordinary rates up to the top of the 24% bracket, with the §1(h)(1)(F) 28% statutory maximum applying only to the remainder above that. An LT loss erodes the 28% bucket FIRST, then §1250.",
        }),
        moneyLine("19", "Unrecaptured §1250 gain (Unrecaptured Section 1250 Gain Worksheet)", u1250, {
          note: "A character SUBSET of the line-16 gain, NOT additive. The Schedule D Tax Worksheet INTERLEAVES this layer with the ordinary brackets: taxed at ordinary rates up to the top of the 24% bracket, with the §1(h)(1)(E) 25% statutory maximum applying only to the remainder above that. An LT loss erodes the 28% bucket FIRST, then §1250.",
        }),
        boolLine("20", "Are lines 18 and 19 both zero or blank?", !nz(c28) && !nz(u1250), {
          note:
            !nz(c28) && !nz(u1250)
              ? "Yes — tax computed via the Qualified Dividends and Capital Gain Tax Worksheet."
              : "No — tax computed via the Schedule D Tax Worksheet (25% / 28% buckets).",
        }),
      );
    } else {
      p3.push(
        boolLine("22", "Do you have qualified dividends?", nz(ret.form1099Summary.qualifiedDividends + ret.scheduleK1.totalQualifiedDividends), {
          note: "If yes, the Qualified Dividends and Capital Gain Tax Worksheet computes the tax.",
        }),
      );
    }
  } else {
    if (line16 < 0) {
      const isMfs = ret.filingStatus === "married_filing_separately";
      p3.push(
        moneyLine("21", "Allowed loss — smaller of the line-16 loss or the §1211(b) limit", -ret.capitalLossDeducted, {
          emphasis: true,
          note: `Limit ${isMfs ? "$1,500 (married filing separately)" : "$3,000"}; flows to Form 1040 line 7 as a negative.`,
        }),
      );
    }
    p3.push(
      boolLine("22", "Do you have qualified dividends?", nz(ret.form1099Summary.qualifiedDividends + ret.scheduleK1.totalQualifiedDividends), {
        note: "If yes, the Qualified Dividends and Capital Gain Tax Worksheet computes the tax.",
      }),
    );
  }

  const parts = [
    { title: "Part I — Short-Term Capital Gains and Losses (held one year or less)", lines: stLines },
    { title: "Part II — Long-Term Capital Gains and Losses (held more than one year)", lines: ltLines },
    { title: "Part III — Summary", lines: p3 },
  ];

  // ── Capital-loss carryforward to next year (Pub 550 worksheet) ──
  const cfLines: FormLine[] = [];
  if (nz(ret.capitalLossCarryforwardShort)) {
    cfLines.push(
      moneyLine("", "Short-term capital loss carryforward to next year", ret.capitalLossCarryforwardShort, {
        note: "Retains SHORT-term character per Pub 550; the §1211(b) allowed loss consumes short losses first.",
      }),
    );
  }
  if (nz(ret.capitalLossCarryforwardLong)) {
    cfLines.push(
      moneyLine("", "Long-term capital loss carryforward to next year", ret.capitalLossCarryforwardLong, {
        note: "Retains LONG-term character per Pub 550.",
      }),
    );
  }
  if (cfLines.length > 0) {
    parts.push({ title: "Capital loss carryforward to next year (Pub 550 worksheet)", lines: cfLines });
  }

  // ── §1091 auto-detected wash-sale disclosure ──
  if (autoWash) {
    parts.push({
      title: "Engine wash-sale adjustments (IRC §1091)",
      lines: [
        countLine("", "Wash sales auto-detected by the engine", ret.washSalesDetected, {
          note: "Excludes broker-reported code-W wash sales, which are honored as entered.",
        }),
        moneyLine("", "Capital loss disallowed by auto-detection", ret.washSaleLossDisallowed, {
          note: "§1091(d): each disallowed loss was added to the replacement lot's basis; the replacement's holding period tacks (§1223(3)) and can flip its Form 8949 box short→long.",
        }),
      ],
    });
  }

  const footnotes: string[] = [
    "Amounts are engine-exact (cents); official forms round to whole dollars. Line numbers follow the TY2024 Schedule D.",
    "Lines 1a/8a (direct broker-aggregate, no-adjustment path) are unused — all activity is decomposed via the Form 8949-equivalent rows plus the engine's component channels.",
    "The §121 / §1202 / §1031 / Form 4797 / manual-LTCG rows are engine adjustment channels; the official form would carry them inside Form 8949 (codes H/Q) or line 11. Here they are additive rows into line 15.",
    "Lines 18/19 are character SUBSETS of the line-16 gain (never additive). The engine taxes them via the IRS Schedule D Tax Worksheet, which INTERLEAVES the §1250 (25%) and 28% layers with the ordinary brackets — they are taxed at ordinary rates up to the top of the 24% bracket, and the 25%/28% statutory maxima (IRC §1(h)(1)(E)/(F)) apply only to the remainder above that. They are NOT taxed at a flat 25%/28%.",
  ];
  if (perTxnMode && autoWash) {
    footnotes.push(
      "Per-box rows show broker-entered (pre-§1091-auto-detection) amounts; the engine's bucket totals include the auto-adjustments, so per-bucket tie-outs are replaced by the combined line-16 identity (invariant when the replacement lot was sold within the year).",
    );
  }
  if (perTxnMode) {
    const bAggSt = (inputs?.form1099s ?? [])
      .filter((r) => (r.taxYear ?? year) === year && (r.formType ?? "").toLowerCase() === "b")
      .reduce((s, r) => s + toNum(r.shortTermGainLoss) + toNum(r.longTermGainLoss), 0);
    if (nz(bAggSt)) {
      footnotes.push(
        "1099-B aggregate ST/LT fields are present but SUPERSEDED by the per-transaction rows (engine override) — they are intentionally NOT in any total above.",
      );
    }
  }
  if (!inputs) {
    footnotes.push(
      "Input facts were unavailable to this builder — carryover lines 6/14 and the line-13 distribution split could not be decomposed; any difference surfaces in the line-16 tie-out.",
    );
  }

  return {
    formId: "schedule-d",
    formNumber: "Schedule D (Form 1040)",
    title: "Capital Gains and Losses",
    subtitle: "Workpaper decomposition of the engine's Schedule D netting (IRC §1211/§1212 + §1(h) character buckets)",
    taxYear: year,
    parts,
    footnotes,
  };
}
