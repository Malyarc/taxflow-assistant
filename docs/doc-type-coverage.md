# Document-type extraction coverage

What the AI-overlay upload→extract→review flow can read, and what each form's
fields map to downstream.

## Supported document types

| `documentType` | Form | Extractor | Downstream record (today) |
|---|---|---|---|
| `w2` | W-2 | `extractW2DataFromFile` | `w2_data` (auto-create on approve) |
| `form_1099` | 1099-NEC/MISC/INT/DIV/B/R/G/K | `extract1099DataFromFile` | `form_1099_data` (auto-create on approve) |
| `form_1098` | 1098 Mortgage Interest | `extractInfoReturnFromFile` | review-only (re-key, see below) |
| `form_1098t` | 1098-T Tuition | `extractInfoReturnFromFile` | review-only |
| `form_1098e` | 1098-E Student Loan Interest | `extractInfoReturnFromFile` | review-only |
| `form_1095a` | 1095-A Marketplace | `extractInfoReturnFromFile` | review-only |
| `form_ssa1099` | SSA-1099 Social Security | `extractInfoReturnFromFile` | review-only |
| `form_w2g` | W-2G Gambling | `extractInfoReturnFromFile` | review-only |

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

## Field → engine mapping (the downstream follow-up)

Auto-creating downstream records on approve (the way `form_1099` creates a
`form_1099_data` row) is NOT yet wired for these six — the extracted data is shown
for CPA review and re-keyed. The clean mapping when that's built:

| Form | Key boxes | Engine destination |
|---|---|---|
| 1098 | Box 1 interest, Box 6 points, Box 10 RE tax | `mortgage_interest` adjustment (+ `state_property_tax`) |
| 1098-T | Box 1 tuition − Box 5 scholarships | `qualified_education_expenses_aoc` / `_llc` adjustment |
| 1098-E | Box 1 | `student_loan_interest` adjustment (engine caps at $2,500) |
| 1095-A | Col A/B/C annual totals | Form 8962 PTC inputs (`premiumTaxCredit` path) |
| SSA-1099 | Box 5 net benefits | `client.socialSecurityBenefits` (Pub 915 taxability) |
| W-2G | Box 1 winnings, Box 4 withholding | gambling income (Sch 1 line 8b) + federal withholding |

Each needs a `recordType` (or adjustment-synthesis) branch in the approve handler +
the relevant target. Tracked as the next increment.

## Benchmark

The synthetic-corpus accuracy benchmark (`scripts/src/ai-benchmark/`) currently
covers W-2 + the 8 1099 variants. To measure the new forms, add their truth
generators to `corpus.ts` and pdfkit renderers to `render.ts` (the harness scores
any form once it can render + has ground truth). The `--limit=N` flag added 2026-06-08
caps the corpus for a quick LIVE smoke before a full free-tier run.
