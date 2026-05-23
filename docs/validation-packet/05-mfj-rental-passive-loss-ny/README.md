# Case 05: MFJ, W-2 + Sch E rental (per-property MACRS + PAL), NY

Couple with one W-2 income and one residential rental property purchased in 2020. Exercises per-property MACRS (27.5 yr SL, mid-month), passive- activity-loss §469 with the $25k active-participant allowance, and NY state tax.

## What to spot-check in UltraTax CS

- Per-property MACRS depreciation auto-computed (residential 27.5 yr SL)
- Net rental gain/loss = rental income − total expenses − depreciation
- If loss: up to $25,000 allowable as PAL (AGI < $100k phase-out start MFJ)
- AGI reflects net rental on Sch E Line 26

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
