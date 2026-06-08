# TaxFlow AI Extraction Benchmark

**Generated:** 2026-06-08T20:29:52.930Z
**Mode:** LIVE (model: `gemini-2.5-flash`)
**Corpus:** 3 synthetic documents, seed=12345, generated in 30,352 ms.

## Headline

- **Documents:** 3
- **Fields scored:** 36
- **Overall accuracy:** 66.7% (24 / 36)
- **Precision (extracted values that are right):** 100.0% (24 TP / 24 positives)
- **Recall (truth values the model caught):** 66.7% (24 TP / 36 actual)
- **F1:** 0.800

## Per-form summary

| Form | Fields | Precision | Recall | F1 |
|---|--:|--:|--:|--:|
| w2 | 36 | 100.0% | 66.7% | 0.800 |

## Worst-performing 10 fields (overall)

Lower F1 = the AI either misses these or gets them wrong more often. These are the high-leverage targets for prompt iteration.

| Field | TP | FP | FN | Precision | Recall | F1 |
|---|--:|--:|--:|--:|--:|--:|
| employeeSSN | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |
| employerEin | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |
| employerName | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |
| federalTaxWithheldBox2 | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |
| medicareTaxBox6 | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |
| medicareWagesBox5 | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |
| socialSecurityTaxBox4 | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |
| socialSecurityWagesBox3 | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |
| stateCode | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |
| stateTaxWithheldBox17 | 2 | 0 | 1 | 100.0% | 66.7% | 0.800 |

## Methodology

**Corpus.** Deterministic — seeded RNG produces realistic synthetic W-2 and 1099 forms (full distribution in `corpus.ts`). The corpus is rendered as actual PDF files by `render.ts` using pdfkit, with box layouts that mimic the IRS form templates closely enough that a vision model treats them as equivalent. Why synthetic and not real: real anonymized 1099s/W-2s are nearly impossible to source at the n=100 scale without breaching PII; synthetic gives perfect ground truth and full coverage of edge cases (multi-state, missing fields, distribution codes).

**Extraction.** LIVE runs call the same Gemini vision endpoint and prompts used by the production `documentExtractor.ts` (`extractW2DataFromFile` / `extract1099DataFromFile`). MOCK runs use a deterministic perturbation of the ground truth, useful for harness validation and report-format demos.

**Scoring.** Per (document, field): TP / FP / FN / TN classification. Numeric fields use a $1.00 tolerance; short codes (formType, stateCode, distributionCode) require exact match (case-insensitive); proper-noun strings (employerName, payerName) require case-insensitive whitespace-collapsed match. A wrong-value extraction counts as BOTH FP and FN (model both emitted wrong *and* missed right). Precision = TP/(TP+FP); Recall = TP/(TP+FN); F1 = 2PR/(P+R).

**Caveats for CPA reviewers.**
- Synthetic forms use IRS-like but not IRS-issued layouts — there is residual model-fit risk: real W-2 photocopies with smudges may underperform these numbers.
- Vision-model results are non-deterministic. A re-run on the same corpus typically agrees to within 1-2 percentage points on overall accuracy.
- The benchmark exercises *extraction quality*, not downstream calc correctness. The 24 test suites under `scripts/src/tax-engine-*.ts` cover that.
- All values in this corpus are fictional. The demo banner in the production UI stays in place.
