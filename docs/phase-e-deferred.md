# Phase E — Deferred Items

After shipping 11 of 14 Phase E items in the 2026-05-26 batch (E1, E2,
E3, E4, E5, E6, E7, E8, E9, E10, E11 — 129 hand-calc assertions), three
remaining items were deferred because they require multi-day refactors
that didn't fit the session window. This doc captures the implementation
plan for each so a future session can pick up cleanly.

---

## E12 — Part-year residency in multi-state framework

**Why deferred.** Requires schema-level changes to track residency
periods + per-period income allocation + tax-base proration across
states. Touches the multi-state pipeline (`calculateMultiStateTax`),
client schema, and downstream state-tax engines. Estimated 3-5 days.

### What needs to change

1. **Client schema (clients table).** Add fields for residency-change
   tracking:
   ```sql
   ALTER TABLE clients ADD COLUMN residency_changed_in_year BOOLEAN;
   ALTER TABLE clients ADD COLUMN former_state TEXT;
   ALTER TABLE clients ADD COLUMN residency_change_date DATE;
   -- new_state is implicitly clients.state (current resident state)
   ```

2. **W-2 / 1099 allocation.** Existing per-W-2 `stateCode` field
   already supports per-state allocation. For part-year, also need a
   pro-rata allocation by date: if W-2 covers full year but client
   moved mid-year, allocate to former + current states by days.
   - Option A: New per-W-2 `daysAllocatedFormerState` /
     `daysAllocatedCurrentState` columns
   - Option B: Engine auto-prorates based on `residency_change_date`
     and assumes wages earned evenly across the year

3. **Engine multi-state pipeline.** Rewrite to:
   - Compute resident tax for FORMER state on income earned while
     resident there (Jan 1 to change_date)
   - Compute resident tax for CURRENT state on income earned after
     change_date
   - Apply resident credit between them for the overlap
   - Most states have specific part-year resident forms (e.g., NY
     IT-203, CA 540NR Part III, NJ-1040NR) — engine simplifies to a
     pro-rata calculation

4. **Engine `ComputedTaxReturn`.** Add fields:
   - `partYearResidency: { fromState, toState, changeDate, daysFormer, daysCurrent }`
   - `formerStateTax: number`
   - `currentStateTax: number` (renames existing `stateTaxLiability` semantics)

### Test plan

Each persona needs at least one part-year case:
- Single, moved CA → TX mid-year (CA has income tax, TX doesn't)
- MFJ, moved NY → FL Apr 1 (no income on NY-side after change date)
- Multi-state worker moved IL → CO mid-year (both have income tax)

Hand-calc'd test cases verifying:
- Sum of part-year state taxes ≈ what one full-year resident state would owe
- Reciprocity rules still respected
- NYC tax only applied to days resident in NYC

### Estimated effort

3-5 days. Largely depends on whether we model day-count proration
honestly per state (each state has its own form / method) or use a
single approximation. Single approximation is 2-3 days; honest per-
state is 4-5.

---

## E13 — Auto wash-sale detection across accounts + §1091(d) holding-period tack-on

**Why deferred.** Algorithmic — requires per-transaction matching
across the entire `capital_transactions` table within 30-day windows.
Complex correctness rules around partial matches, fractional shares,
multiple buy-backs. Estimated 4-6 days.

### What needs to change

1. **`taxReturnEngine.ts` — wash-sale detection algorithm.** For each
   sale transaction, search for matching purchases of the same security
   within a 61-day window (30 days before AND 30 days after the sale).
   When a match is found:
   - The loss on the sale is disallowed (added back to gain/loss)
   - The replacement shares' basis is increased by the disallowed loss
   - The replacement shares' holding period extends back to the original
     purchase date (§1091(d) tack-on)

   ```typescript
   function detectWashSales(transactions: CapitalTransactionFact[]): {
     adjustments: WashSaleAdjustment[];
     transactionsWithAdjustments: CapitalTransactionFact[];
   }
   ```

2. **Schema.** No new columns required — `capital_transactions` already
   has `washSaleDisallowed`, `adjustmentCode`, `adjustmentAmount`. But
   add a flag: `washSaleAutoDetected: boolean` to distinguish broker-
   reported (current) from engine-detected.

3. **Holding-period tack-on.** Per IRC §1091(d):
   - When a loss is disallowed by §1091(a), the new purchase's holding
     period extends back to include the holding period of the
     originally-sold shares
   - This affects whether the replacement shares are STCG or LTCG when
     eventually sold

   Engine needs:
   ```typescript
   // When detecting a wash sale, update the replacement transaction's
   // `acquired` date to the original transaction's `acquired` date for
   // holding-period determination.
   ```

4. **Engine output.** `ComputedTaxReturn` adds:
   - `washSalesDetected: number` — count of auto-detected matches
   - `washSaleLossDisallowed: number` — total disallowed losses

### Test plan

Critical cases:
- Single security: $1k loss, repurchase same security 15 days later
  → loss disallowed, basis adjusted
- Multiple buy-backs across 30-day window
- Cross-account wash sale (broker A sells, broker B buys)
- Partial wash sale (sold 100 shares, bought 50 within 30 days)
- LTCG → STCG conversion (sold LTCG-eligible shares at loss, bought
  back within 30 days → replacement gets LTCG holding period)
- 61-day window edge cases (day 30 still wash, day 31 not)

Hand-calc each against IRC §1091 + Pub 550 worked examples.

### Estimated effort

4-6 days. Algorithm is well-defined but the edge cases (partial,
fractional shares, multiple buy-backs) are subtle. Test rigor is
critical because broker-reported wash sales (current path) handle
most real cases — auto-detection is mainly a CPA assurance feature.

---

## E14 — Other local income taxes (MD counties, OH cities, IN counties)

**Why deferred.** Many jurisdictions, each with its own rate + base
rules. Total scope is large but per-jurisdiction effort is small.
Estimated 5-10 days for comprehensive coverage; 1-2 days for the
single most-impactful jurisdiction (Maryland counties).

### What needs to change

1. **Client schema.** Add `localityCode` extension to support the
   broader set:
   - MD counties: `MD-MONTGOMERY` / `MD-HOWARD` / etc.
   - OH cities: `OH-CINCINNATI` / `OH-CLEVELAND` / etc.
   - IN counties: `IN-MARION` / `IN-LAKE` / etc.

   Engine's current `localityCode: "NYC"` becomes a single enum
   member among many.

2. **`stateTaxData.ts` localityData.** Currently only NYC. Extend to
   per-jurisdiction rate tables:
   ```typescript
   export const LOCALITY_TAX_DATA = {
     "NYC": { ...existing },
     "MD-MONTGOMERY": { rate: 0.0320, base: "federalAgi" },
     "MD-HOWARD": { rate: 0.0320, base: "federalAgi" },
     "MD-PRINCE_GEORGES": { rate: 0.0320, base: "federalAgi" },
     // ... 22 more MD counties
     "OH-CINCINNATI": { rate: 0.0210, base: "wages_earned_in_city" },
     "OH-CLEVELAND": { rate: 0.0250, base: "wages_earned_in_city" },
     "IN-MARION": { rate: 0.0202, base: "federalAgi" },
     // ... etc.
   };
   ```

3. **Engine.** Generalize `calculateNycLocalTax` to `calculateLocalTax`,
   dispatching on `localityCode`. NYC keeps its custom logic (brackets,
   credits, MCTMT). Other jurisdictions use the flat-rate table.

4. **Priorities by AGI impact.**
   - **MD counties** (24 jurisdictions, ALL Maryland residents pay
     county tax — high-volume): rate 2.0%-3.2%
   - **OH cities** (~600 cities — typically 1-2.5% on
     wages-earned-in-city): less common for tax prep clients
   - **IN counties** (92 counties, ~0.5-3.0%): broad coverage but
     small dollars
   - **PA local Earned Income Tax (EIT)**: 1% statewide minimum + local
     overrides; not modeled
   - **KY occupational tax**: city-specific

### Test plan

For each new jurisdiction:
- Verify rate × base produces expected tax
- Edge cases: zero tax for non-residents, federal AGI floor for
  county taxes vs. wage-only for cities
- Multi-state filer with one state having local tax

Estimated 50+ assertions for full MD county coverage; 200+ for full
MD/OH/IN coverage.

### Estimated effort

- MD alone: 1-2 days
- MD + OH + IN comprehensive: 5-10 days
- Single most-impactful jurisdiction (e.g., MD-MONTGOMERY): ½ day

---

## Quick prioritization for next Phase E session

If/when revisiting:

1. **Highest value, lowest effort**: **MD counties** (E14 partial).
   24 jurisdictions, ~½ day each = ~3 days for the most common 5-10.
   Common in CPA firms in MD/DC area.

2. **High value, mid effort**: **Part-year residency** (E12).
   3-5 days. Material for CPA firms with mobile clients.

3. **Mid value, high effort**: **Auto wash-sale** (E13). 4-6 days.
   Broker-reported wash sales are already honored (current path);
   auto-detection is incremental safety, not essential.

The remaining Phase E items are explicitly reactive — ship only when
a real customer asks for them.
