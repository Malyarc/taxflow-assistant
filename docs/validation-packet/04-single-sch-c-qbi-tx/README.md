# Case 04: Single, Sch C self-employment + 1099-NEC, TX

Sole-proprietor consultant. One 1099-NEC for $80k gross with $15k Sch C expenses → $65k net SE income. Exercises Sch SE, QBI §199A 20% deduction, deductible-half-of-SE adjustment. No state tax (TX).

## What to spot-check in UltraTax CS

- Net SE income (Sch C) = $65,000
- SE tax ≈ $9,184 (15.3% × 92.35% × $65,000)
- Half SE adjustment ≈ $4,592 reduces AGI
- QBI deduction = 20% × min(QBI, taxable) → meaningful reduction
- Total tax includes SE + income tax

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
