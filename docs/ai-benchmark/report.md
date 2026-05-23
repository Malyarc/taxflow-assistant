# TaxFlow AI Extraction Benchmark

**Generated:** 2026-05-23T21:14:36.088Z
**Mode:** MOCK (deterministic simulator — see methodology)
**Corpus:** 100 synthetic documents, seed=12345, generated in 8 ms.

> **NOTE — This report was produced in MOCK mode.** The extraction values come from a deterministic simulator that perturbs the ground truth (10% field-drop rate, occasional digit drift, occasional formType confusion). The harness, scoring, and report-output format are identical to a LIVE run. Re-run with `AI_API_KEY` set to substitute real model output.

## Headline

- **Documents:** 100
- **Fields scored:** 1,078
- **Overall accuracy:** 82.5% (936 / 1,135)
- **Precision (extracted values that are right):** 93.5% (819 TP / 876 positives)
- **Recall (truth values the model caught):** 85.2% (819 TP / 961 actual)
- **F1:** 0.892

## Per-form summary

| Form | Fields | Precision | Recall | F1 |
|---|--:|--:|--:|--:|
| w2 | 324 | 91.3% | 83.7% | 0.873 |
| 1099-nec | 124 | 96.2% | 85.0% | 0.903 |
| 1099-int | 168 | 97.2% | 86.2% | 0.914 |
| 1099-div | 174 | 93.4% | 87.1% | 0.901 |
| 1099-b | 119 | 90.3% | 84.0% | 0.870 |
| 1099-misc | 123 | 95.9% | 87.5% | 0.915 |
| 1099-r | 59 | 91.5% | 84.3% | 0.878 |
| 1099-g | 28 | 95.5% | 87.5% | 0.913 |
| 1099-k | 16 | 100.0% | 87.5% | 0.933 |

## Worst-performing 10 fields (overall)

Lower F1 = the AI either misses these or gets them wrong more often. These are the high-leverage targets for prompt iteration.

| Field | TP | FP | FN | Precision | Recall | F1 |
|---|--:|--:|--:|--:|--:|--:|
| unemploymentCompensation | 0 | 1 | 2 | 0.0% | 0.0% | 0.000 |
| nondividendDistributions | 1 | 2 | 2 | 33.3% | 33.3% | 0.333 |
| taxableAmount | 2 | 2 | 3 | 50.0% | 40.0% | 0.444 |
| proceeds | 5 | 4 | 5 | 55.6% | 50.0% | 0.526 |
| costBasis | 6 | 2 | 4 | 75.0% | 60.0% | 0.667 |
| shortTermGainLoss | 4 | 2 | 2 | 66.7% | 66.7% | 0.667 |
| usTreasuryInterest | 1 | 0 | 1 | 100.0% | 50.0% | 0.667 |
| wagesBox1 | 16 | 5 | 9 | 76.2% | 64.0% | 0.696 |
| stateWagesBox16 | 17 | 5 | 8 | 77.3% | 68.0% | 0.723 |
| longTermGainLoss | 3 | 1 | 1 | 75.0% | 75.0% | 0.750 |

## Methodology

**Corpus.** Deterministic — seeded RNG produces realistic synthetic W-2 and 1099 forms (full distribution in `corpus.ts`). The corpus is rendered as actual PDF files by `render.ts` using pdfkit, with box layouts that mimic the IRS form templates closely enough that a vision model treats them as equivalent. Why synthetic and not real: real anonymized 1099s/W-2s are nearly impossible to source at the n=100 scale without breaching PII; synthetic gives perfect ground truth and full coverage of edge cases (multi-state, missing fields, distribution codes).

**Extraction.** LIVE runs call the same Gemini vision endpoint and prompts used by the production `documentExtractor.ts` (`extractW2DataFromFile` / `extract1099DataFromFile`). MOCK runs use a deterministic perturbation of the ground truth, useful for harness validation and report-format demos.

**Scoring.** Per (document, field): TP / FP / FN / TN classification. Numeric fields use a $1.00 tolerance; short codes (formType, stateCode, distributionCode) require exact match (case-insensitive); proper-noun strings (employerName, payerName) require case-insensitive whitespace-collapsed match. A wrong-value extraction counts as BOTH FP and FN (model both emitted wrong *and* missed right). Precision = TP/(TP+FP); Recall = TP/(TP+FN); F1 = 2PR/(P+R).

**Caveats for CPA reviewers.**
- Synthetic forms use IRS-like but not IRS-issued layouts — there is residual model-fit risk: real W-2 photocopies with smudges may underperform these numbers.
- Vision-model results are non-deterministic. A re-run on the same corpus typically agrees to within 1-2 percentage points on overall accuracy.
- The benchmark exercises *extraction quality*, not downstream calc correctness. The 24 test suites under `scripts/src/tax-engine-*.ts` cover that.
- All values in this corpus are fictional. The demo banner in the production UI stays in place.
