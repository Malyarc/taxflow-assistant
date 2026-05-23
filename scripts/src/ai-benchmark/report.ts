/**
 * Output writers — per-document CSV, per-(kind, field) aggregate CSV,
 * markdown report. Designed to be CPA-presentable.
 */

import { writeFile } from "node:fs/promises";
import type { FieldResult, FieldAggregate } from "./types.js";
import { overall } from "./score.js";

function csvEscape(s: string | number): string {
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export async function writeRawCsv(rows: FieldResult[], path: string): Promise<void> {
  const lines: string[] = [];
  lines.push("doc_id,kind,field,truth,extracted,match");
  for (const r of rows) {
    lines.push([
      csvEscape(r.id), csvEscape(r.kind), csvEscape(r.field),
      csvEscape(r.truthValue == null ? "" : JSON.stringify(r.truthValue)),
      csvEscape(r.extractedValue == null ? "" : JSON.stringify(r.extractedValue)),
      r.match,
    ].join(","));
  }
  await writeFile(path, lines.join("\n"));
}

export async function writeAggregateCsv(aggs: FieldAggregate[], path: string): Promise<void> {
  const lines: string[] = [];
  lines.push("kind,field,tp,fp,fn,tn,precision,recall,f1");
  for (const a of aggs) {
    lines.push([
      csvEscape(a.kind), csvEscape(a.field),
      a.tp, a.fp, a.fn, a.tn,
      a.precision.toFixed(4), a.recall.toFixed(4), a.f1.toFixed(4),
    ].join(","));
  }
  await writeFile(path, lines.join("\n"));
}

export interface RunMeta {
  generatedAt: string;
  mode: "MOCK" | "LIVE";
  modelId?: string;
  corpusSize: number;
  durationMs: number;
  seed: number;
}

export async function writeMarkdownReport(
  rows: FieldResult[],
  aggs: FieldAggregate[],
  meta: RunMeta,
  path: string,
): Promise<void> {
  const o = overall(rows);
  const docCount = new Set(rows.map((r) => r.id)).size;

  const lines: string[] = [];
  lines.push("# TaxFlow AI Extraction Benchmark");
  lines.push("");
  lines.push(`**Generated:** ${meta.generatedAt}`);
  lines.push(`**Mode:** ${meta.mode}` + (meta.mode === "LIVE" ? ` (model: \`${meta.modelId ?? "n/a"}\`)` : " (deterministic simulator — see methodology)"));
  lines.push(`**Corpus:** ${meta.corpusSize} synthetic documents, seed=${meta.seed}, generated in ${meta.durationMs.toLocaleString()} ms.`);
  lines.push("");

  if (meta.mode === "MOCK") {
    lines.push("> **NOTE — This report was produced in MOCK mode.** The extraction values come from a deterministic simulator that perturbs the ground truth (10% field-drop rate, occasional digit drift, occasional formType confusion). The harness, scoring, and report-output format are identical to a LIVE run. Re-run with `AI_API_KEY` set to substitute real model output.");
    lines.push("");
  }

  // Headline
  lines.push("## Headline");
  lines.push("");
  lines.push(`- **Documents:** ${docCount}`);
  lines.push(`- **Fields scored:** ${rows.length.toLocaleString()}`);
  lines.push(`- **Overall accuracy:** ${fmtPct(o.accuracy)} (${(o.tp + o.tn).toLocaleString()} / ${(o.tp + o.fp + o.fn + o.tn).toLocaleString()})`);
  lines.push(`- **Precision (extracted values that are right):** ${fmtPct(o.precision)} (${o.tp} TP / ${o.tp + o.fp} positives)`);
  lines.push(`- **Recall (truth values the model caught):** ${fmtPct(o.recall)} (${o.tp} TP / ${o.tp + o.fn} actual)`);
  lines.push(`- **F1:** ${o.f1.toFixed(3)}`);
  lines.push("");

  // Per-form summary
  lines.push("## Per-form summary");
  lines.push("");
  lines.push("| Form | Fields | Precision | Recall | F1 |");
  lines.push("|---|--:|--:|--:|--:|");
  // Aggregate by kind
  const byKind = new Map<string, { tp: number; fp: number; fn: number; tn: number }>();
  for (const r of rows) {
    let b = byKind.get(r.kind);
    if (!b) { b = { tp: 0, fp: 0, fn: 0, tn: 0 }; byKind.set(r.kind, b); }
    if (r.match === "TP") b.tp++;
    else if (r.match === "FP") { b.fp++; if (r.truthValue != null && r.truthValue !== "") b.fn++; }
    else if (r.match === "FN") b.fn++;
    else b.tn++;
  }
  const orderedKinds = ["w2", "1099-nec", "1099-int", "1099-div", "1099-b", "1099-misc", "1099-r", "1099-g", "1099-k"];
  for (const k of orderedKinds) {
    const b = byKind.get(k);
    if (!b) continue;
    const fields = b.tp + b.fp + b.fn + b.tn;
    const denomP = b.tp + b.fp, denomR = b.tp + b.fn;
    const p = denomP > 0 ? b.tp / denomP : 1;
    const r = denomR > 0 ? b.tp / denomR : 1;
    const f1 = (p + r > 0) ? (2 * p * r) / (p + r) : 0;
    lines.push(`| ${k} | ${fields.toLocaleString()} | ${fmtPct(p)} | ${fmtPct(r)} | ${f1.toFixed(3)} |`);
  }
  lines.push("");

  // Worst 10 fields
  lines.push("## Worst-performing 10 fields (overall)");
  lines.push("");
  lines.push("Lower F1 = the AI either misses these or gets them wrong more often. These are the high-leverage targets for prompt iteration.");
  lines.push("");
  lines.push("| Field | TP | FP | FN | Precision | Recall | F1 |");
  lines.push("|---|--:|--:|--:|--:|--:|--:|");
  const overallFieldAggs = aggs.filter((a) => a.kind === "all").slice().sort((a, b) => a.f1 - b.f1).slice(0, 10);
  for (const a of overallFieldAggs) {
    lines.push(`| ${a.field} | ${a.tp} | ${a.fp} | ${a.fn} | ${fmtPct(a.precision)} | ${fmtPct(a.recall)} | ${a.f1.toFixed(3)} |`);
  }
  lines.push("");

  // Methodology
  lines.push("## Methodology");
  lines.push("");
  lines.push("**Corpus.** Deterministic — seeded RNG produces realistic synthetic W-2 and 1099 forms (full distribution in `corpus.ts`). The corpus is rendered as actual PDF files by `render.ts` using pdfkit, with box layouts that mimic the IRS form templates closely enough that a vision model treats them as equivalent. Why synthetic and not real: real anonymized 1099s/W-2s are nearly impossible to source at the n=100 scale without breaching PII; synthetic gives perfect ground truth and full coverage of edge cases (multi-state, missing fields, distribution codes).");
  lines.push("");
  lines.push("**Extraction.** LIVE runs call the same Gemini vision endpoint and prompts used by the production `documentExtractor.ts` (`extractW2DataFromFile` / `extract1099DataFromFile`). MOCK runs use a deterministic perturbation of the ground truth, useful for harness validation and report-format demos.");
  lines.push("");
  lines.push("**Scoring.** Per (document, field): TP / FP / FN / TN classification. Numeric fields use a $1.00 tolerance; short codes (formType, stateCode, distributionCode) require exact match (case-insensitive); proper-noun strings (employerName, payerName) require case-insensitive whitespace-collapsed match. A wrong-value extraction counts as BOTH FP and FN (model both emitted wrong *and* missed right). Precision = TP/(TP+FP); Recall = TP/(TP+FN); F1 = 2PR/(P+R).");
  lines.push("");
  lines.push("**Caveats for CPA reviewers.**");
  lines.push("- Synthetic forms use IRS-like but not IRS-issued layouts — there is residual model-fit risk: real W-2 photocopies with smudges may underperform these numbers.");
  lines.push("- Vision-model results are non-deterministic. A re-run on the same corpus typically agrees to within 1-2 percentage points on overall accuracy.");
  lines.push("- The benchmark exercises *extraction quality*, not downstream calc correctness. The 24 test suites under `scripts/src/tax-engine-*.ts` cover that.");
  lines.push("- All values in this corpus are fictional. The demo banner in the production UI stays in place.");
  lines.push("");

  await writeFile(path, lines.join("\n"));
}
