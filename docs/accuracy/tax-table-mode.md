# Tax-computation modes: "formula" vs "table" (T1.5 #1)

The engine computes Form 1040 line 16 (the tax on ordinary taxable income) in one
of two modes, selected by `TaxReturnInputs.taxComputationMethod`
(`"formula"` | `"table"`, default `"formula"`).

## Why two modes

For taxable income **under $100,000**, the IRS requires most filers to use the
**Tax Table**, not the rate-schedule formula. The Tax Table is *built* by the IRS
from the rate schedules, but with a twist: the tax for each income row is the
schedule tax at the **midpoint** of the row, rounded to the nearest dollar. So a
filed return's line 16 will differ from the exact-formula value by up to ~$14 —
not a bug, just the table's construction. To **match a filed return to the
dollar**, we emulate the table.

## "formula" (default)

The exact rate-schedule tax: `Σ (income in bracket × bracket rate)`. Precise to
the cent, year-indexed via `FEDERAL_BRACKETS`. This is what every existing test
and the deployed engine use — the default keeps the engine byte-for-byte
unchanged.

Use it for: planning math, what-if deltas, projections, any place you want the
mathematically exact marginal behavior.

## "table" (IRS Tax Table emulation)

`irsTaxTableTax(taxableIncome, filingStatus, taxYear)` in `taxCalculator.ts`:

- **Income ≥ $100,000** → the IRS Tax Computation Worksheet = the exact formula,
  rounded to a whole dollar.
- **Income < $100,000** → `round(formula(rowMidpoint))`, where the row midpoint is:
  - `$50`-wide rows for income **≥ $3,000** → `floor(ti/50)*50 + 25`
  - `$25`-wide rows for **$25–$3,000** → `floor(ti/25)*25 + 12.5`
  - the small `$5`/`$10` rows below `$25` (`$0–5` → 0, `$5–15` → midpoint 10,
    `$15–25` → midpoint 20)
- Rounding is **round half up** (`Math.round`), matching the IRS construction
  (e.g. MFJ $12,025 = $1,202.50 → **$1,203**).

`"table"` affects only the **ordinary-income** tax lines. The preferential
0/15/20/25/28% capital-gain rates are exact percentages in both modes; inside the
Qualified Dividends & Capital Gain and Schedule D Tax Worksheets, the
"tax on the ordinary amount" lines (and the FEIE/kiddie ordinary lines) use the
selected method, so a table-mode return with capital gains still matches a filed
return.

### Verification

`scripts/src/tax-engine-tax-table-mode-tests.ts` (116 assertions) pins the mode
against the **real published 2024 IRS Tax Table** (`i1040tt--2024`), all four
filing statuses:

| Row | Single | MFJ | MFS | HoH |
|---|---|---|---|---|
| $12,000–12,050 | 1,211 | 1,203 | 1,211 | 1,203 |
| $50,000–50,050 | 6,059 | 5,539 | 6,059 | 5,672 |
| $53,000–53,050 | 6,719 | 5,899 | 6,719 | 6,032 |
| $56,000–56,050 | 7,379 | 6,259 | 7,379 | 6,392 |

plus the construction identity (`table === round(formula(midpoint))`) across
TY2024/2025, the ≥$100k worksheet path, the bottom rows, and end-to-end through
`computeTaxReturnPure` (the table line 16 is exactly $3 above the formula line 16
on a single $50k W-2 return; the rest of the return is identical).

## Reachability (where the mode can be selected)

`taxComputationMethod` is an **engine-level input on `TaxReturnInputs`** — the
pure `computeTaxReturnPure` migration seam. Any programmatic caller (the
workpaper packet builder, the Haven NestJS service post-migration, a future
recalc-route flag) can request `"table"`. It is intentionally NOT yet surfaced
in the OpenAPI spec / recalc route / UI — the deployed app always computes in the
default `"formula"` mode. Wiring a per-return UI toggle (spec → Zod → recalc
route → a persisted setting) is a product follow-up; the engine + Haven seam
capability is complete and tested here.

## Known boundary

State-side references to "federal tax" (e.g. Oregon's federal-tax subtraction)
stay on the **formula** method regardless of `taxComputationMethod` — the mode
governs the federal line 16, and the state edge is negligible. Documented here so
it's a known, deliberate boundary rather than an oversight.
