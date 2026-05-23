# C12 Validation Packet (2026-05-23)

Ten representative tax-return cases for a CPA design partner to import
into UltraTax CS (by hand-keying the scenario) and compare to our engine.

See [`../ultratax-audit.md`](../ultratax-audit.md) for why we cannot ship
a direct UltraTax CS import file (no such format exists) and what we recommend
instead.

Per-case artifacts:

- `summary.pdf` — one-page CPA-readable PDF of the computed return
- `values.csv` — IRS-line-keyed flat file (`IRS Line | Field | Description | Reference Code | Value`)
- `summary.txt` — plain-text vendor-neutral key=value (e.g. `1040-L9=75000.00`)
- `inputs.json` — the input scenario, exactly as fed to the engine
- `computed.json` — the full computed result (internal state, useful for deep dives)

## Cases

| # | Title | Surfaces tested |
|---|---|---|
| 1 | [Single, W-2 only, FL (no state income tax)](./01-single-w2-fl/) | AGI = $55,000 |
| 2 | [Single, W-2 only, NYC resident](./02-single-w2-nyc/) | AGI = $75,000 |
| 3 | [MFJ, two W-2s, CA, 1 child under 17 (CTC)](./03-mfj-two-w2-ca-ctc/) | AGI = $145,000 (combined wages) |
| 4 | [Single, Sch C self-employment + 1099-NEC, TX](./04-single-sch-c-qbi-tx/) | Net SE income (Sch C) = $65,000 |
| 5 | [MFJ, W-2 + Sch E rental (per-property MACRS + PAL), NY](./05-mfj-rental-passive-loss-ny/) | Per-property MACRS depreciation auto-computed (residential 27.5 yr SL) |
| 6 | [Single, S-corp K-1 + W-2, CA](./06-single-k1-scorp-ca/) | AGI = W-2 wages + K-1 Box 1 ordinary income (no SE on K-1 for S-corp) |
| 7 | [MFJ, W-2 + capital transactions (Form 8949), NY](./07-mfj-capital-transactions-ny/) | Net ST cap gain taxed as ordinary income |
| 8 | [Single, W-2 + ISO bargain element (AMT preference), CA](./08-single-amt-iso-ca/) | AMTI > taxable income (ISO bargain element + SALT addback) |
| 9 | [MFJ, low-income with 2 qualifying children, IL state EITC](./09-mfj-eitc-piggyback-il/) | Federal EITC > 0 (within MFJ-with-2-kids window) |
| 10 | [Single, W-2 + foreign dividends + Form 1116 FTC, NJ](./10-single-foreign-tax-credit-nj/) | Foreign tax credit reduces federal liability (capped at FTC limitation) |

## Regenerating

```
# api-server must be running at localhost:8080
pnpm --filter @workspace/scripts exec tsx src/build-validation-packet.ts
```

Cases are generated deterministically from `scripts/src/build-validation-packet.ts`;
emails are timestamped so re-running creates fresh clients (the old ones are deleted
on completion).
