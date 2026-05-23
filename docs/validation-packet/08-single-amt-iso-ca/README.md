# Case 08: Single, W-2 + ISO bargain element (AMT preference), CA

Tech worker exercising ISOs held past year-end. Exercises the AMT preference for the ISO bargain element (Form 6251 Line 2k) on top of the auto-derived SALT addback (Line 2g). AMT may or may not bind depending on regular-tax burden.

## What to spot-check in UltraTax CS

- AMTI > taxable income (ISO bargain element + SALT addback)
- AMT = max(0, tentative AMT − regular tax)
- AMT line populated on the summary if it binds

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
