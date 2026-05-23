# Case 01: Single, W-2 only, FL (no state income tax)

Baseline simplest return. Single filer, one W-2, lives in Florida. Exercises: federal regular tax brackets, std deduction, federal withholding → refund or balance due. Zero state tax. No credits.

## What to spot-check in UltraTax CS

- AGI = $55,000
- Std ded (single 2024) = $14,600 → taxable = $40,400
- Federal tax ≈ $4,616 (single 2024 brackets)
- Federal withheld = $6,200 → refund ≈ $1,584
- State tax = $0 (FL)

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
