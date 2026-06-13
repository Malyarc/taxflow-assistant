# Golden-test pack from IRS worked examples (T1.5 #2)

`scripts/src/tax-engine-golden-irs-examples-tests.ts` pins the engine to
authoritative IRS sources — the strongest oracle available. Each assertion is
either an IRS-PUBLISHED figure (the IRS's own printed worked example / table
cell) or hand-calc'd line-by-line against the cited form/worksheet. CI-pinned via
the no-API battery.

## Coverage (18 assertions)

| Source | What's pinned |
|---|---|
| **Pub 915** Social Security Benefits Worksheet | The real filled-in Examples 1/3/4 — single 50%-tier ($2,990), MFJ 85%-tier w/ SSEB ($6,275), MFS-lived-together forced 85% ($3,400). Each hand-reconciled to the worksheet, then matched by the engine to the dollar. |
| **Pub 596 / Rev. Proc. 2023-34** EIC Table | TY2024 max-credit plateau values: 1ch $4,213 · 2ch $6,960 · 3ch $7,830 · 0ch MFJ $632 (extracted from the real p596 EIC table via PyMuPDF). |
| **Form 1040 Tax Table** (i1040tt 2024) | Single/MFJ $50,000 rows ($6,059 / $5,539) — full coverage in `tax-engine-tax-table-mode-tests.ts`. |
| **Schedule SE** | $50k net → $7,064.78; $200k net (SS-base-capped) → $26,262.70. |
| **Schedule 8812** | MFJ $40k / 2 kids → ACTC $2,920 (CTC nonref-limited to tax, remainder to refundable ACTC). |
| **QDCGT Worksheet** | Single $40k LTCG-only → $0 (0% bracket); $100k LTCG-only → $5,756.25 (15% over the $47,025 0%-top). |
| **Form 8863** | AOC $4k expenses → $2,500 max (40% / $1,000 refundable). |
| **Form 2441** | $5k expense, 1 dependent, AGI $60k → $600 (20% × $3,000 limit). |

## Documented sub-gap: EITC uses the §32 formula, not the $50-band EIC Table

The IRS EIC Table (like the income Tax Table) prints, for each $50 income band,
the §32 credit at the band MIDPOINT rounded to a whole dollar. The engine instead
evaluates the exact §32 formula at the taxpayer's actual income. On the **max
plateau** the two are identical (the golden values above match to the dollar). In
the **phase-in / phase-out regions** they can differ by ≤ ~$1 — e.g. 1 child at
$12,025 earned income: the engine returns the formula value $4,088.50, the EIC
Table prints $4,089 (34% × $12,025 = $4,088.50, rounded up).

This is the EITC analogue of the income-tax formula-vs-table gap that T1.5 #1
closed with the `taxComputationMethod: "table"` mode. It is intentionally left as
a documented ≤$1 sub-gap (EITC was just reworked in T1.0a, and the effect is
sub-dollar) rather than expanding the table mode to the EIC Table now. The golden
pack pins the current formula behavior AND records the EIC-table value, so a
future EIC-table-emulation enhancement has its target encoded. Candidate for the
T1.5 law-watch register as a known accuracy item.
