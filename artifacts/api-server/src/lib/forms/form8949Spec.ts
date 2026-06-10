/**
 * T2.1 — Form 8949 workpaper: Sales and Other Dispositions of Capital Assets.
 *
 * Per-lot detail behind the Schedule D box totals, rendered from
 * inputs.capitalTransactions (the BROKER-ENTERED rows). Engine-exact
 * conventions mirrored from taxReturnEngine.ts (~1519–1567):
 *
 *   - column (h) gain/(loss) = proceeds − costBasis + adjustmentAmount
 *   - formBox A/B/C → Part I (short-term); D/E/F → Part II (long-term);
 *     a MISSING box defaults to Box A; any other unrecognized box is in
 *     NEITHER engine bucket (disclosed in its own section)
 *   - broker-reported wash sales arrive as adjustmentCode "W" +
 *     adjustmentAmount (honored as-is by the engine)
 *   - ENGINE-auto-detected §1091 wash sales (washSalesDetected > 0) mutate
 *     the engine's INTERNAL copies only (loss reversal, §1091(d) replacement
 *     basis add, §1223(3) ST→LT box flip) — the rows here stay broker-entered,
 *     so per-part tie-outs are gated on washSalesDetected === 0 and the
 *     combined total (invariant when the replacement was sold in-year) is
 *     checked instead, alongside a disclosure block.
 *
 * 1099-DIV box 2a capital-gain distributions are NOT Form 8949 transactions —
 * they live on Schedule D line 13 and are excluded from the Part II tie-out.
 *
 * Each part renders at most 40 lots ("+ k more transactions — see app"
 * overflow row); box subtotals and part totals always cover ALL rows.
 */

import {
  checkLine,
  countLine,
  moneyLine,
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

/** Engine-exact box normalization: null/undefined → "A"; else uppercased. */
function normalizedBox(t: CapitalTransactionFact): string {
  return t.formBox == null ? "A" : String(t.formBox).toUpperCase();
}

/** "description · acquired d1 · sold d2 [· code W adj $x]" */
function lotLabel(t: CapitalTransactionFact): string {
  const desc = (t.description ?? "").trim() || "(no description)";
  const acquired = (t.dateAcquired ?? "").trim() || "—";
  const sold = (t.dateSold ?? "").trim() || "—";
  let label = `${desc} · acquired ${acquired} · sold ${sold}`;
  const code = (t.adjustmentCode ?? "").trim();
  const adj = toNum(t.adjustmentAmount);
  if (code && adj !== 0) label += ` · code ${code} adj ${usd(adj)}`;
  else if (code) label += ` · code ${code}`;
  else if (adj !== 0) label += ` · adj ${usd(adj)}`;
  return label;
}

/** Per-lot fine-print: account / quantity / special-rate gain class. */
function lotNote(t: CapitalTransactionFact): string | undefined {
  const bits: string[] = [];
  const account = (t.account ?? "").trim();
  if (account) bits.push(`account ${account}`);
  const qty = toNum(t.quantity);
  if (qty > 0) bits.push(`${qty} share${qty === 1 ? "" : "s"}`);
  const cls = (t.gainClass ?? "").trim().toLowerCase();
  if (cls === "section1250") {
    const explicit = toNum(t.unrecaptured1250Amount);
    bits.push(
      `gainClass section1250 — unrecaptured §1250 portion ${
        explicit > 0 ? usd(explicit) : "(full gain)"
      } → Schedule D line 19`,
    );
  } else if (cls === "collectible" || cls === "section1202") {
    bits.push(`gainClass ${cls} → 28%-rate gain (Schedule D line 18)`);
  } else if (cls) {
    bits.push(`gainClass ${cls} (unrecognized — engine ignores it)`);
  }
  return bits.length > 0 ? bits.join(" · ") : undefined;
}

const MAX_LOT_ROWS_PER_PART = 40;

const BOX_HEADER: Record<string, string> = {
  A: "Box A — basis reported to the IRS",
  B: "Box B — basis NOT reported to the IRS",
  C: "Box C — not reported on Form 1099-B",
  D: "Box D — basis reported to the IRS",
  E: "Box E — basis NOT reported to the IRS",
  F: "Box F — not reported on Form 1099-B",
};

/** Render one part (Part I boxes A/B/C or Part II boxes D/E/F). */
function renderPart(
  boxes: readonly string[],
  rowsByBox: Map<string, CapitalTransactionFact[]>,
  partName: string,
  scheduleDLines: string,
): { lines: FormLine[]; total: number } {
  const lines: FormLine[] = [];
  let total = 0;
  let lotBudget = MAX_LOT_ROWS_PER_PART;
  let omitted = 0;
  for (const box of boxes) {
    const rows = rowsByBox.get(box) ?? [];
    if (rows.length === 0) continue;
    lines.push(textLine("", `── ${BOX_HEADER[box]} (${rows.length} lot${rows.length === 1 ? "" : "s"}) ──`, null));
    let boxGain = 0;
    let boxProceeds = 0;
    let boxBasis = 0;
    for (const t of rows) {
      const gain = lotGain(t);
      boxGain += gain;
      boxProceeds += toNum(t.proceeds);
      boxBasis += toNum(t.costBasis);
      if (lotBudget > 0) {
        const note = lotNote(t);
        lines.push(moneyLine("1", lotLabel(t), gain, { indent: 1, ...(note ? { note } : {}) }));
        lotBudget -= 1;
      } else {
        omitted += 1;
      }
    }
    total += boxGain;
    lines.push(
      moneyLine("2", `Box ${box} totals`, boxGain, {
        note: `proceeds ${usd(boxProceeds)} − basis ${usd(boxBasis)} (+ adjustments) — flows to Schedule D line ${scheduleDBoxLine(box)}`,
      }),
    );
  }
  if (omitted > 0) {
    lines.push(textLine("", `+ ${omitted} more transaction${omitted === 1 ? "" : "s"} — see app`, null, { indent: 1 }));
  }
  if (lines.length > 0) {
    lines.push(
      moneyLine("", `${partName} total — flows to Schedule D ${scheduleDLines}`, total, { emphasis: true }),
    );
  }
  return { lines, total };
}

function scheduleDBoxLine(box: string): string {
  return { A: "1b", B: "2", C: "3", D: "8b", E: "9", F: "10" }[box] ?? "—";
}

export function buildForm8949(ctx: FormBuildContext): FormInstance | null {
  const { ret, inputs } = ctx;
  const year = ret.taxYear;

  const txns = (inputs?.capitalTransactions ?? []).filter((t) => t.taxYear === year);
  if (txns.length === 0) return null;

  // ── Engine-exact bucketing (input order preserved within each box) ──
  const rowsByBox = new Map<string, CapitalTransactionFact[]>();
  const unclassified: CapitalTransactionFact[] = [];
  for (const t of txns) {
    const box = normalizedBox(t);
    if (["A", "B", "C", "D", "E", "F"].includes(box)) {
      const bucket = rowsByBox.get(box) ?? [];
      bucket.push(t);
      rowsByBox.set(box, bucket);
    } else {
      unclassified.push(t);
    }
  }

  const partI = renderPart(["A", "B", "C"], rowsByBox, "Part I (short-term)", "lines 1b/2/3");
  const partII = renderPart(["D", "E", "F"], rowsByBox, "Part II (long-term)", "lines 8b/9/10");

  // Engine bucket totals to tie against (Part II excludes DIV 2a distributions,
  // which are Schedule D line 13, not 8949 rows). Same filters as the engine.
  const cgDistributions = (inputs?.form1099s ?? [])
    .filter((r) => (r.taxYear ?? year) === year && (r.formType ?? "").toLowerCase() === "div")
    .reduce((s, r) => s + toNum(r.totalCapitalGainDistribution), 0);
  const engSt = ret.form1099Summary.shortTermCapitalGains;
  const engLt8949 = ret.form1099Summary.longTermCapitalGains - cgDistributions;
  const autoWash = ret.washSalesDetected > 0;

  const reconLines: FormLine[] = [];
  if (!autoWash) {
    reconLines.push(
      checkLine("Part I short-term total ties engine short-term bucket", partI.total, engSt),
      checkLine("Part II long-term total ties engine long-term bucket (excl. 1099-DIV distributions)", partII.total, engLt8949),
    );
  } else {
    reconLines.push(
      checkLine(
        "Combined Part I + II total ties engine ST+LT (invariant under §1091 auto-adjustments)",
        partI.total + partII.total,
        engSt + engLt8949,
      ),
      countLine("", "Wash sales auto-detected by the engine (IRC §1091)", ret.washSalesDetected, {
        note: "Excludes broker-reported code-W wash sales, which are honored as entered above.",
      }),
      moneyLine("", "Capital loss disallowed by auto-detection", ret.washSaleLossDisallowed, {
        note: "§1091(d): the disallowed loss was added to the replacement lot's basis inside the engine; the replacement's holding period tacks (§1223(3)) and can flip its box short→long. Rows above show broker-entered values.",
      }),
    );
  }

  const parts = [
    {
      title: "Part I — Short-Term (assets held one year or less)",
      lines: partI.lines.length > 0 ? partI.lines : [textLine("", "No short-term transactions", "—")],
    },
    {
      title: "Part II — Long-Term (assets held more than one year)",
      lines: partII.lines.length > 0 ? partII.lines : [textLine("", "No long-term transactions", "—")],
    },
  ];
  if (unclassified.length > 0) {
    const lines: FormLine[] = unclassified
      .slice(0, MAX_LOT_ROWS_PER_PART)
      .map((t) => {
        const note = lotNote(t);
        return moneyLine("", `${lotLabel(t)} · box "${t.formBox ?? ""}"`, lotGain(t), {
          indent: 1,
          ...(note ? { note } : {}),
        });
      });
    if (unclassified.length > MAX_LOT_ROWS_PER_PART) {
      lines.push(
        textLine("", `+ ${unclassified.length - MAX_LOT_ROWS_PER_PART} more transactions — see app`, null, { indent: 1 }),
      );
    }
    lines.push(
      textLine(
        "",
        `${unclassified.length} transaction(s) with an unrecognized Form 8949 box — EXCLUDED from engine totals`,
        "review",
        { emphasis: true, note: "Engine convention: a missing box defaults to Box A; any other unrecognized box drops the row from BOTH buckets. Fix the box in the app." },
      ),
    );
    parts.push({ title: "Unclassified rows (unrecognized box — not in any engine total)", lines });
  }
  parts.push({ title: "Reconciliation to the engine / Schedule D", lines: reconLines });

  const footnotes: string[] = [
    "Column (h) per lot = proceeds − cost basis + adjustment (engine-exact cents; official forms round to whole dollars).",
    "Lot rows are the broker-entered facts. Broker-reported wash sales (code W) are already inside each lot's adjustment amount.",
    "1099-DIV box 2a capital-gain distributions are not Form 8949 transactions — they appear on Schedule D line 13 only.",
    "A lot with no Form 8949 box defaults to Box A (engine convention).",
  ];
  if (autoWash) {
    footnotes.push(
      "Engine §1091 auto-detection adjusted its INTERNAL copies of these rows (loss reversal + replacement basis add + possible ST→LT box flip); per-part totals here are pre-adjustment, so only the combined total is tied. The combined identity assumes each replacement lot was itself sold this year (the engine's data model).",
    );
  }

  return {
    formId: "8949",
    formNumber: "Form 8949",
    title: "Sales and Other Dispositions of Capital Assets",
    subtitle: "Per-lot detail behind the Schedule D box totals (boxes A–F)",
    taxYear: year,
    parts,
    footnotes,
  };
}
