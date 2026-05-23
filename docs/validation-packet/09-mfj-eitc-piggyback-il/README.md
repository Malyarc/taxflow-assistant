# Case 09: MFJ, low-income with 2 qualifying children, IL state EITC

Low-AGI joint filer with 2 qualifying children, lives in Illinois. Exercises federal EITC + IL state EITC at 20% piggyback (PA 102-0700, since TY2023). Also exercises refundable Additional CTC.

## What to spot-check in UltraTax CS

- Federal EITC > 0 (within MFJ-with-2-kids window)
- IL state EITC = 20% × federal EITC
- ACTC (refundable CTC) may be non-zero

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
