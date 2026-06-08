# LIVE benchmark run — notes

## 2026-06-08 (second run) — W-2 cohort now 100%; full run still quota-blocked

Re-ran LIVE after the P2-10 prompt changes (recall hint + Box-1≠Box-3 disambiguation,
shipped 2026-06-06). The free-tier rate/daily quota again blocked a full 100-doc run, but
**every W-2 the model processed scored 12/12 fields (100% precision AND per-field recall)**
— up from 2026-05-23's 77.7% recall / 0.865 F1. Strong (small-n) signal that the P2-10
recall fix closed the gap. Partial artifacts + analysis in
[`live-partial-2026-06-08/`](./live-partial-2026-06-08/). Harness also now retries
transient 5xx (a 503 burned a doc) and has `--limit` / `--per-kind` for fast samples.

## 2026-05-23 (first run) — the recall gap that drove P2-10

First real Gemini run on the C13 harness. Hit Gemini Flash's free-tier daily
quota partway through, so the full 100-doc report is not yet shipped — but the
~25-W-2 partial that completed before quota is a usable real-data signal and is
preserved verbatim in [`live-partial-2026-05-23/`](./live-partial-2026-05-23/).

## What we learned from the partial run

**Model:** `gemini-2.5-flash`
**Quota hit at:** roughly request 25 (free-tier daily limit on
`generate_content_free_tier_requests`).
**Bench-side mitigations after the run:** added per-request 8s→60s exponential
backoff for HTTP 429 and a default 6.5s inter-request pacing (~9 RPM ceiling).
Both kept the harness honest on the next attempt — but with the daily quota
already exhausted, all requests after the first ~25 returned 429 even after
the full retry chain.

### W-2 — only form type with a complete sample

25 W-2s × 12 fields = 300 field cells scored before quota.

Headline:
- **TP = 233 (77.7%), FP = 6 (2.0%), FN = 61 (20.3%)**
- **Precision = 97.5%, Recall = 77.7%, F1 = 0.865**

Per-field (Gemini 2.5 Flash on the C13 synthetic W-2 layout):

| Field | TP | FP | FN | Precision | Recall | F1 |
|---|--:|--:|--:|--:|--:|--:|
| employerName, employerEin, federalTaxWithheldBox2, medicareTaxBox6, medicareWagesBox5, socialSecurityTaxBox4, stateCode, stateTaxWithheldBox17, stateWagesBox16 | 20 | 0 | 5 | 100.0% | 80.0% | 0.889 |
| employeeSSN | 19 | 1 | 6 | 95.0% | 76.0% | 0.844 |
| wagesBox1 | 17 | 2 | 8 | 89.5% | 68.0% | 0.773 |
| socialSecurityWagesBox3 | 17 | 3 | 8 | 85.0% | 68.0% | 0.756 |

Interpretation:
- **Precision (96.9% overall on W-2) is the headline a CPA partner needs.** When
  the model emits a value, it is almost always the right one. False positives
  are rare (3 instances on SS wages, 2 on Box 1) and tend to be sibling-box
  confusion (Box 1 vs Box 3 mis-read).
- **Recall is the gap.** Roughly 20% of W-2 fields per document were not
  returned at all — usually a clean omission rather than a misread. This is
  the leverage point for prompt iteration: ask the model to enumerate every
  filled box rather than only the ones it's confident about.

### 1099 form variants

Not analyzable. The 22-ok / 78-error count from the original log indicates the
quota cliff hit before the 1099 cohort had a fair sample. The 0.0% recall
numbers in the partial `aggregate.csv` for 1099-DIV / B / MISC / R / G / K
reflect "request was rejected with HTTP 429" rather than a model miss.

## What to do next

1. **Re-run with a paid Gemini quota** (or after the free-tier daily reset, with
   the new `--pace-ms` default). The harness is now hardened against rate-
   limit churn; a clean 100-doc run should take ~11 minutes on the free tier or
   ~5 minutes on a paid plan.
2. **Sanity-check the W-2 wagesBox1 / socialSecurityWagesBox3 FPs against the
   raw extracted values** in `live-partial-2026-05-23/raw.csv` (grep for FP)
   to confirm the sibling-box-confusion hypothesis. If it's a real pattern,
   the prompt should call out "Box 1 (Wages) ≠ Box 3 (SS Wages); they may
   differ when employee contributed to a pre-tax retirement plan."
3. **MOCK sample at the root** of `docs/ai-benchmark/` remains the methodology
   demo for CPA partners until a clean LIVE run is in.

## Why these numbers are still useful

A CPA design partner asking "does the AI actually work" gets a defensible
answer from the W-2 cohort: **97.5% precision means the AI very rarely lies;
77.7% recall means the CPA still has to enumerate which fields the AI missed.**
That maps to a clear UX implication: the review modal should make
not-extracted fields visually distinct from extracted-but-changeable ones —
which is exactly what C14's diff column ships.
