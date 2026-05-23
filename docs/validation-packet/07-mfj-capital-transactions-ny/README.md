# Case 07: MFJ, W-2 + capital transactions (Form 8949), NY

Couple with W-2 income and a mix of short-term and long-term capital transactions including one wash-sale-disallowed loss. Exercises Schedule D netting, QDCG worksheet (LTCG at preferential 15% rate), NIIT threshold.

## What to spot-check in UltraTax CS

- Net ST cap gain taxed as ordinary income
- Net LT cap gain taxed at 0% / 15% / 20% per QDCG worksheet
- Wash sale loss adjustment increases the disallowed loss
- NY state tax applies to total AGI (incl. cap gains)

## Artifacts

- `inputs.json` — the exact scenario this case was generated from (recreate in UltraTax to compare)
- `computed.json` — full engine output (all internal state)
- `values.csv` — IRS-line-keyed CSV; one row per Form 1040 / Schedule line
- `summary.txt` — plain-text key=value summary (vendor-neutral)
- `summary.pdf` — one-page CPA-readable PDF
