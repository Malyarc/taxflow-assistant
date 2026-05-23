# TaxFlow AI Extraction Benchmark — PARTIAL RUN

> ⚠️ **This run is partial.** The Gemini Flash free-tier daily quota
> exhausted at request ~25, so only the W-2 cohort (25 docs) ran to
> completion. All 1099 variants registered 100% failure-to-extract due
> to HTTP 429, not model behavior. See [`../LIVE-RUN-NOTES.md`](../LIVE-RUN-NOTES.md)
> for analysis of the W-2 partial (F1 = 0.865) and the path forward.

**Generated:** 2026-05-23T21:29:42.524Z
**Mode:** LIVE (model: `gemini-2.5-flash`)
**Corpus:** 100 synthetic documents, seed=12345, generated in 273,148 ms.

## Headline

- **Documents:** 100
- **Fields scored:** 1,078
- **Overall accuracy:** 33.6% (365 / 1,086)
- **Precision (extracted values that are right):** 96.9% (248 TP / 256 positives)
- **Recall (truth values the model caught):** 25.8% (248 TP / 961 actual)
- **F1:** 0.408

## Per-form summary

| Form | Fields | Precision | Recall | F1 |
|---|--:|--:|--:|--:|
| w2 | 306 | 97.5% | 77.7% | 0.865 |
| 1099-nec | 121 | 87.5% | 5.8% | 0.109 |
| 1099-int | 166 | 88.9% | 6.5% | 0.121 |
| 1099-div | 165 | 100.0% | 0.0% | 0.000 |
| 1099-b | 110 | 100.0% | 0.0% | 0.000 |
| 1099-misc | 120 | 100.0% | 0.0% | 0.000 |
| 1099-r | 55 | 100.0% | 0.0% | 0.000 |
| 1099-g | 27 | 100.0% | 0.0% | 0.000 |
| 1099-k | 16 | 100.0% | 0.0% | 0.000 |

## Worst-performing 10 fields (overall)

Lower F1 = the AI either misses these or gets them wrong more often. These are the high-leverage targets for prompt iteration.

| Field | TP | FP | FN | Precision | Recall | F1 |
|---|--:|--:|--:|--:|--:|--:|
| costBasis | 0 | 0 | 10 | 100.0% | 0.0% | 0.000 |
| distributionCode | 0 | 0 | 5 | 100.0% | 0.0% | 0.000 |
| earlyWithdrawalPenalty | 0 | 0 | 1 | 100.0% | 0.0% | 0.000 |
| grossDistribution | 0 | 0 | 5 | 100.0% | 0.0% | 0.000 |
| grossPaymentAmount | 0 | 0 | 2 | 100.0% | 0.0% | 0.000 |
| iraSepSimple | 0 | 0 | 1 | 100.0% | 0.0% | 0.000 |
| longTermGainLoss | 0 | 0 | 4 | 100.0% | 0.0% | 0.000 |
| nondividendDistributions | 0 | 0 | 3 | 100.0% | 0.0% | 0.000 |
| ordinaryDividends | 0 | 0 | 15 | 100.0% | 0.0% | 0.000 |
| otherIncome | 0 | 0 | 6 | 100.0% | 0.0% | 0.000 |

## Methodology

**Corpus.** Deterministic — seeded RNG produces realistic synthetic W-2 and 1099 forms (full distribution in `corpus.ts`). The corpus is rendered as actual PDF files by `render.ts` using pdfkit, with box layouts that mimic the IRS form templates closely enough that a vision model treats them as equivalent. Why synthetic and not real: real anonymized 1099s/W-2s are nearly impossible to source at the n=100 scale without breaching PII; synthetic gives perfect ground truth and full coverage of edge cases (multi-state, missing fields, distribution codes).

**Extraction.** LIVE runs call the same Gemini vision endpoint and prompts used by the production `documentExtractor.ts` (`extractW2DataFromFile` / `extract1099DataFromFile`). MOCK runs use a deterministic perturbation of the ground truth, useful for harness validation and report-format demos.

**Scoring.** Per (document, field): TP / FP / FN / TN classification. Numeric fields use a $1.00 tolerance; short codes (formType, stateCode, distributionCode) require exact match (case-insensitive); proper-noun strings (employerName, payerName) require case-insensitive whitespace-collapsed match. A wrong-value extraction counts as BOTH FP and FN (model both emitted wrong *and* missed right). Precision = TP/(TP+FP); Recall = TP/(TP+FN); F1 = 2PR/(P+R).

**Caveats for CPA reviewers.**
- Synthetic forms use IRS-like but not IRS-issued layouts — there is residual model-fit risk: real W-2 photocopies with smudges may underperform these numbers.
- Vision-model results are non-deterministic. A re-run on the same corpus typically agrees to within 1-2 percentage points on overall accuracy.
- The benchmark exercises *extraction quality*, not downstream calc correctness. The 24 test suites under `scripts/src/tax-engine-*.ts` cover that.
- All values in this corpus are fictional. The demo banner in the production UI stays in place.
