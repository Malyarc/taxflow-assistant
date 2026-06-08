# Document-type extraction coverage

What the AI-overlay upload→extract→review flow can read, and what each form's
fields map to downstream.

## Supported document types

| `documentType` | Form | Extractor | Downstream record (today) |
|---|---|---|---|
| `w2` | W-2 | `extractW2DataFromFile` | `w2_data` (auto-create on approve) |
| `form_1099` | 1099-NEC/MISC/INT/DIV/B/R/G/K | `extract1099DataFromFile` | `form_1099_data` (auto-create on approve) |
| `form_1098` | 1098 Mortgage Interest | `extractInfoReturnFromFile` | `mortgage_interest` (+ `state_property_tax`) adjustment |
| `form_1098t` | 1098-T Tuition | `extractInfoReturnFromFile` | `qualified_education_expenses_aoc` adjustment |
| `form_1098e` | 1098-E Student Loan Interest | `extractInfoReturnFromFile` | `student_loan_interest` adjustment |
| `form_1095a` | 1095-A Marketplace | `extractInfoReturnFromFile` | client `aca*` fields (Form 8962) |
| `form_ssa1099` | SSA-1099 Social Security | `extractInfoReturnFromFile` | client `socialSecurityBenefits` |
| `form_w2g` | W-2G Gambling | `extractInfoReturnFromFile` | `additional_income` (+ `withholding_adjustment`) |

The information-return extractor (`extractInfoReturnFromFile`, `documentExtractor.ts`)
makes ONE vision call: the model identifies the specific form from its header
(returns `infoType`) and extracts the tax-relevant boxes. Output flows to the same
`pending_review` payload as W-2/1099, with per-field bounding boxes + confidence.

The same prompt-injection defense applies (the rendered doc is untrusted; the field
**whitelist** in `normalizeInfoReturnData` drops anything off-schema), and the
mandatory CPA review gate is unchanged.

## Validation (box arithmetic + plausibility)

`validateInfoReturn` (`@workspace/validation`) flags issues the CPA should review,
mirroring `validate1099`. Highlights:

- **SSA-1099**: Box 5 (net) must equal Box 3 (gross) − Box 4 (repaid); withholding ≤ net.
- **W-2G**: federal withholding ≤ winnings; state withholding ≤ state winnings; state ≠ client state → non-resident gambling-tax note.
- **1098**: Box 4 (refund of overpaid interest) > Box 1 → likely OCR mis-read.
- **1098-T**: scholarships (Box 5) > tuition (Box 1) → taxable-scholarship / $0-credit-base note.
- **1098-E**: interest > $2,500 → §221-cap note.
- **1095-A**: advance PTC (Col C) ≤ premium (Col A); SLCSP (Col B) = 0 with a premium present → Form 8962 needs it.
- Common: 9-digit filer TIN; doc-year vs client-year.

39 deterministic tests (`scripts/src/tax-engine-info-return-extraction-tests.ts`) —
normalizer (infoType normalization, currency/boolean coercion, the whitelist drop)
+ every validation rule. These run without an API key; the model call itself needs a
live key (measured by the AI benchmark, which can be extended to render these forms).

## Field → engine mapping (auto-applied on approve — DONE 2026-06-08d)

Approving an info-return now auto-applies it: the reviewed boxes map (server-side,
authoritatively, via the pure `mapInfoReturnToInputs`) to engine **adjustments** and/or
**client-field patches**, in one transaction, then the return recalculates. New approve
`recordType: "info_return"` (+ `infoType`).

| Form | Key boxes | Engine destination |
|---|---|---|
| 1098 | Box 1 interest, Box 10 RE tax | `mortgage_interest` adjustment (+ `state_property_tax`) |
| 1098-T | Box 1 tuition − Box 5 scholarships (floored) | `qualified_education_expenses_aoc` adjustment (CPA switches to LLC if not AOC-eligible) |
| 1098-E | Box 1 | `student_loan_interest` adjustment (engine caps at $2,500) |
| 1095-A | Part III A/B/C annual totals | client `acaAnnualPremium` / `acaAnnualSlcsp` / `acaAdvanceAptc` (Form 8962) |
| SSA-1099 | Box 5 net benefits | client `socialSecurityBenefits` (Pub 915 taxability) |
| W-2G | Box 1 winnings, Box 4 withholding | `additional_income` adjustment + `withholding_adjustment` |

Only positive boxes are mapped (a 0/blank box is skipped, so an approve never overwrites
a client field with 0). 23 tests cover the mapping + an end-to-end check that each chosen
adjustment type hits the right engine lever (1098-E drops AGI exactly, W-2G adds income +
withholding, SSA-1099 triggers Pub 915, 1095-A computes the PTC).

**Remaining tail (documented sub-gaps):** 1098 points (Box 6 — amortization nuance, CPA
adds manually); 1098-T AOC-vs-LLC choice (defaults AOC); 1095-A monthly (engine uses
annual totals); each adjustment is year-agnostic (the adjustments table has no taxYear —
matches manual entry).

## Benchmark

The synthetic-corpus accuracy benchmark (`scripts/src/ai-benchmark/`) currently
covers W-2 + the 8 1099 variants. To measure the new forms, add their truth
generators to `corpus.ts` and pdfkit renderers to `render.ts` (the harness scores
any form once it can render + has ground truth). The `--limit=N` flag added 2026-06-08
caps the corpus for a quick LIVE smoke before a full free-tier run.
