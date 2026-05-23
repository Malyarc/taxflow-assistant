# Case 02: Single, W-2 only, NYC resident

Same baseline as #1, but lives in NYC. Exercises NY state tax + NYC local income tax (BP2). CPA can verify the NYC PIT brackets independently.

## What to spot-check in UltraTax CS

- AGI = $75,000
- NY state tax > 0 (NY brackets, std ded $8,000)
- NYC local tax > 0 (single 2024 NYC brackets)
- Local tax shown separately from state tax in the summary

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
