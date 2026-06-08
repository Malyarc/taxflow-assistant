/**
 * AI extraction benchmark runner.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx src/ai-benchmark/run.ts \
 *     [--seed=12345] [--mock] [--out=docs/ai-benchmark]
 *
 * Modes:
 *   - Default LIVE if AI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) is set.
 *   - Pass --mock to force the deterministic simulator.
 *   - Otherwise, falls back to MOCK and emits a notice.
 *
 * Outputs (in --out dir):
 *   raw.csv         one row per (doc, field): truth, extracted, TP/FP/FN/TN
 *   aggregate.csv   per (kind, field): tp/fp/fn/tn/precision/recall/f1
 *   report.md       CPA-presentable markdown report (per-form table,
 *                   top-10 worst fields, methodology)
 */

import { mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { aiEnabled, aiModel } from "@workspace/integrations-openai-ai-server";
import { generateCorpus, DEFAULT_COUNTS, corpusTotal } from "./corpus.js";
import { renderForm } from "./render.js";
import { runExtraction, modeDescription } from "./extract.js";
import { scoreDocument, aggregate } from "./score.js";
import { writeRawCsv, writeAggregateCsv, writeMarkdownReport, type RunMeta } from "./report.js";
import type { CorpusEntry, ExtractedRecord, FieldResult, FormKind, W2Fields, F1099Fields } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(__dirname, "..", "..", "..", "docs", "ai-benchmark");

interface Args {
  seed: number;
  forceMock: boolean;
  out: string;
  /** Min ms between LIVE requests. 0 = no pacing. Default 6500 (~9 RPM,
   *  safely under Gemini Flash's free-tier 10 RPM limit). */
  paceMs: number;
  /** Cap the corpus to the first N docs (0 = no cap). Useful for a quick LIVE
   *  smoke test before committing to the full ~11-min free-tier run. The cap is
   *  applied AFTER generation, so the per-kind distribution front-loads W-2s. */
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seed: 12345, forceMock: false, out: DEFAULT_OUT, paceMs: 6500, limit: 0 };
  for (const a of argv) {
    if (a === "--mock") args.forceMock = true;
    else if (a.startsWith("--seed=")) args.seed = Number(a.slice("--seed=".length)) || args.seed;
    else if (a.startsWith("--out=")) args.out = resolve(a.slice("--out=".length));
    else if (a.startsWith("--pace-ms=")) args.paceMs = Math.max(0, Number(a.slice("--pace-ms=".length)) || 0);
    else if (a.startsWith("--limit=")) args.limit = Math.max(0, Number(a.slice("--limit=".length)) || 0);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const start = Date.now();
  const mode = modeDescription(args.forceMock);

  console.log(`AI extraction benchmark`);
  console.log(`  mode    : ${mode}${mode === "LIVE" ? ` (model ${aiModel})` : ""}`);
  console.log(`  seed    : ${args.seed}`);
  console.log(`  out     : ${args.out}`);
  if (mode === "LIVE") console.log(`  pace    : ${args.paceMs}ms between requests (~${Math.round(60_000 / Math.max(args.paceMs, 1))} RPM ceiling)`);
  if (mode === "MOCK" && aiEnabled && !args.forceMock) {
    console.log("  NOTE   : AI_API_KEY is set; pass --mock to force MOCK mode.");
  }
  if (mode === "MOCK" && !aiEnabled) {
    console.log("  NOTE   : no AI_API_KEY in env → running deterministic simulator.");
  }
  console.log("");

  await mkdir(args.out, { recursive: true });

  // Step 1: generate corpus
  console.log(`Generating corpus (${corpusTotal()} docs)…`);
  let corpus = generateCorpus(args.seed, DEFAULT_COUNTS);
  if (args.limit > 0 && corpus.length > args.limit) {
    corpus = corpus.slice(0, args.limit);
    console.log(`  ${corpus.length} entries (capped by --limit=${args.limit}).`);
  } else {
    console.log(`  ${corpus.length} entries.`);
  }

  // Step 2: render + extract each doc
  const allResults: FieldResult[] = [];
  let okCount = 0, errCount = 0;
  let lastReqEnd = 0;
  for (let i = 0; i < corpus.length; i++) {
    const entry = corpus[i];
    process.stdout.write(`  [${String(i + 1).padStart(3, " ")}/${corpus.length}] ${entry.id.padEnd(16)} `);
    try {
      // LIVE pacing: hold each request to ~paceMs after the previous one
      // STARTED. Combined with the extractor's per-call 429-retry-backoff,
      // this lets a 100-doc run complete on the Gemini free tier (10 RPM).
      if (mode === "LIVE" && args.paceMs > 0 && lastReqEnd > 0) {
        const wait = args.paceMs - (Date.now() - lastReqEnd);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      const pdf = mode === "LIVE"
        ? await renderForm(entry.kind, entry.truth as W2Fields | F1099Fields)
        : null;
      const base64 = pdf ? pdf.toString("base64") : null;
      const ext = await runExtraction(entry.id, entry.kind, entry.truth as W2Fields | F1099Fields, base64, { forceMock: args.forceMock });
      lastReqEnd = Date.now();
      const docResults = scoreDocument(entry, ext);
      allResults.push(...docResults);
      if (ext.error) {
        errCount++;
        process.stdout.write(`ERR ${ext.error}\n`);
      } else {
        okCount++;
        const docTP = docResults.filter((r) => r.match === "TP").length;
        const docFields = docResults.length;
        process.stdout.write(`${docTP}/${docFields} fields TP (${ext.durationMs}ms)\n`);
      }
    } catch (err) {
      errCount++;
      process.stdout.write(`FAIL ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  // Step 3: aggregate + write outputs
  console.log("\nAggregating…");
  const aggs = aggregate(allResults);
  const totalDuration = Date.now() - start;
  const meta: RunMeta = {
    generatedAt: new Date().toISOString(),
    mode,
    modelId: aiModel,
    corpusSize: corpus.length,
    durationMs: totalDuration,
    seed: args.seed,
  };
  await writeRawCsv(allResults, join(args.out, "raw.csv"));
  await writeAggregateCsv(aggs, join(args.out, "aggregate.csv"));
  await writeMarkdownReport(allResults, aggs, meta, join(args.out, "report.md"));

  console.log(`\nWrote:\n  ${args.out}/raw.csv\n  ${args.out}/aggregate.csv\n  ${args.out}/report.md`);
  console.log(`\nDone in ${(totalDuration / 1000).toFixed(1)}s. ${okCount} ok, ${errCount} errors.`);
  if (errCount > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
