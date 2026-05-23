# Case 06: Single, S-corp K-1 + W-2, CA

S-corp shareholder taking salary (W-2) plus K-1 distributive share. Exercises K-1 Box 1 (active ordinary income), §199A QBI on the K-1 portion, no SE tax on the K-1 (S-corp passthrough), CA state tax.

## What to spot-check in UltraTax CS

- AGI = W-2 wages + K-1 Box 1 ordinary income (no SE on K-1 for S-corp)
- QBI deduction applies to the K-1 portion (simplified 20%)
- CA state tax > 0

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
