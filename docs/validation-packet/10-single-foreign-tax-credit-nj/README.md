# Case 10: Single, W-2 + foreign dividends + Form 1116 FTC, NJ

US filer with significant foreign-source dividend income and foreign tax withheld at source. Exercises Form 1116 FTC limitation (binding when foreign tax > US tax share) and NJ state tax on AGI.

## What to spot-check in UltraTax CS

- Foreign tax credit reduces federal liability (capped at FTC limitation)
- 1099-DIV interest+dividend income flows into AGI
- NJ state tax > 0 (graduated NJ brackets)

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
