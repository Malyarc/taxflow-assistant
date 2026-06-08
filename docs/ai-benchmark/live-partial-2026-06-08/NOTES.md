# LIVE benchmark partial — 2026-06-08

Second real Gemini run on the C13 harness (first was 2026-05-23). Same outcome on
completeness — the Gemini 2.5 Flash **free-tier rate/daily quota** blocked a full
100-doc run — but the W-2 cohort that completed is a markedly BETTER signal than
2026-05-23, and it validates the P2-10 prompt changes that shipped in between.

**Model:** `gemini-2.5-flash` (Gemini OpenAI-compat endpoint, same prompts as the
production `documentExtractor.ts`).
**Run:** `src/ai-benchmark/run.ts` (LIVE), seed 12345.
**Quota wall:** the free tier is ~10 RPM (+ a daily request cap). At a 4s pace the run
429'd after ~5 docs; cumulative attempts across the session then exhausted the per-minute
window and (likely) the daily cap, so a clean 100-doc run wasn't completable in this
window. The artifacts here are from the clean 3-doc smoke (the only run that finished and
wrote CSVs before the quota wall); the `--pace-ms=4000` run additionally logged
`w2-001..w2-004 = 12/12 fields TP` before 429-ing at doc 5.

## W-2 — the completed cohort: 100%

The 2 W-2s the model successfully processed scored **24/24 field cells = TP** (the third
doc, w2-002, hit a transient 503 — counted as FN in the report's recall, NOT a model
miss). Per `raw.csv`, every field matched the ground truth exactly, including the hard
ones:

| Field | Result | Note |
|---|---|---|
| employeeSSN | TP | masked last-4 (`XXX-XX-4127`) read correctly |
| wagesBox1 | TP | exact cents ($216,107.83) |
| socialSecurityWagesBox3 | TP | correctly read the **$168,600 SS-wage-base cap** (≠ Box 1) |
| socialSecurityTaxBox4, medicareWagesBox5/6, fed/state WH, EIN, employer, state | TP | all exact |

- **Precision 100%, and 100% per-field recall on the docs that completed.** The Box 1
  ≠ Box 3 case (the 2026-05-23 FP pattern) was read correctly — Box 1 $216,107.83 vs
  Box 3 capped at $168,600.

## Why this matters — the P2-10 fix landed

2026-05-23 found W-2 **recall = 77.7%** (F1 0.865): the model omitted ~20% of fields.
Between then and now, P2-10 (2026-06-06) added the RECALL hint ("extract EVERY box; lower
confidence instead of skipping") + the Box-1≠Box-3 disambiguation to the W-2 prompt. This
LIVE run shows W-2 at 12/12 fields on every processed doc — i.e., the recall gap the
prior run flagged appears CLOSED. (Small-n: 2 clean docs. A full free-tier-reset or paid
run is still needed for a statistically firm 100-doc number.)

## What to do next (unchanged from 2026-05-23)

1. **Re-run on paid quota or after the free-tier daily reset.** The harness is now even
   more robust: retries 429 **and transient 5xx** (a 503 burned a doc this run), and
   `--limit=N` / `--per-kind=N` give fast/balanced samples for a quick LIVE check. A clean
   100-doc run is ~11 min on the free tier at the default 6.5s pace.
2. **1099 cohort:** not analyzable here (quota hit before a fair 1099 sample). Same as
   2026-05-23.
3. The MOCK report at `docs/ai-benchmark/report.md` remains the methodology/format demo.
