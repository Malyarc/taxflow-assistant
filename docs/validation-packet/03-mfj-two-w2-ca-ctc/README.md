# Case 03: MFJ, two W-2s, CA, 1 child under 17 (CTC)

Dual-earner married household with one qualifying child. Exercises CTC (non-refundable + refundable ACTC ordering), CA state tax, joint brackets.

## What to spot-check in UltraTax CS

- AGI = $145,000 (combined wages)
- Std ded (MFJ 2024) = $29,200 → taxable = $115,800
- CTC = $2,000 (well below MFJ phase-out start $400,000)
- CA state tax > 0 (graduated CA brackets)

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
