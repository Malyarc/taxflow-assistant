# AI Extraction Benchmark (C13)

Measures the accuracy of TaxFlow's AI extraction pipeline on a labeled corpus
of synthetic W-2s and 1099s. Produces a CPA-presentable markdown report plus
two CSVs (raw per-field results + per-(form, field) aggregates).

## Why a benchmark

A CPA design partner cannot trust the AI-overlay UX without quantitative
accuracy data. *"It extracted my last W-2 correctly"* is not enough — we
need per-field precision / recall / F1 across enough samples to detect
systematic gaps.

## Why synthetic

Real anonymized 1099s/W-2s at n=100 are nearly impossible to source without
breaching PII or copyright. Synthetic forms:

- Give *perfect ground truth* (we generate them, we know the answer)
- Cover edge cases (missing fields, multi-state, all 8 1099 variants)
- Reproducible across runs (seeded RNG)

Residual fit risk: a real W-2 photocopy with smudges may underperform our
numbers. The harness is structured so a partner can swap in a real corpus
later by writing a new `corpus.ts` loader.

## Usage

```bash
# Default LIVE run (uses AI_API_KEY from env; falls back to MOCK if absent)
pnpm --filter @workspace/scripts exec tsx src/ai-benchmark/run.ts

# Force MOCK mode (deterministic simulator — useful for harness/report-format demos)
pnpm --filter @workspace/scripts exec tsx src/ai-benchmark/run.ts --mock

# Different seed (regenerate corpus deterministically with different sampling)
pnpm --filter @workspace/scripts exec tsx src/ai-benchmark/run.ts --seed=99999

# Custom output dir
pnpm --filter @workspace/scripts exec tsx src/ai-benchmark/run.ts --out=/tmp/bench
```

Outputs to `docs/ai-benchmark/` by default:

| File | Contents |
|---|---|
| `report.md` | Markdown report: headline accuracy, per-form table, worst 10 fields, methodology |
| `aggregate.csv` | Per `(kind, field)` aggregates: tp, fp, fn, tn, precision, recall, f1 |
| `raw.csv` | Per `(doc, field)` results: truth value, extracted value, match kind |

## Files

| File | Role |
|---|---|
| `types.ts` | Field shape per form variant + the FieldResult/FieldAggregate types |
| `rng.ts` | Mulberry32 seeded RNG + canned employer/payer/state lists |
| `corpus.ts` | Default counts (25 W-2 + 75 1099 across 8 variants); generator |
| `render.ts` | pdfkit renderers for W-2 + 8 1099 variants |
| `extract.ts` | LIVE (Gemini-via-OpenAI-compat) + MOCK extractors; same prompts as `documentExtractor.ts` |
| `score.ts` | Per-field TP/FP/FN/TN classification; aggregate; overall |
| `report.ts` | CSV + markdown writers |
| `run.ts` | Orchestrator (excluded from tsconfig — uses top-level await) |

## What MOCK mode simulates

The deterministic simulator perturbs the ground truth to mimic plausible
vision-model errors:

- **10% field-drop rate** — model misses a field
- **~30% per-numeric small drift** — $1-3 off, or rounded to 1 decimal
- **~10% per-numeric off-by-10x** — a real OCR failure mode
- **~5% formType confusion** — wrong 1099 variant

It is good enough to verify the harness end-to-end and demo the report
format. **Don't use MOCK numbers as a quality signal** — they reflect the
simulator's noise model, not the real model's behavior.

## Why this isn't a CI test

The benchmark needs a live AI key and ~$0.01-0.10 per run (100 vision-API
calls at Gemini Flash rates). It's run manually before/after prompt or
model changes, not on every commit. The harness lives in this directory
rather than `scripts/src/tax-engine-*` to keep that separation explicit.
