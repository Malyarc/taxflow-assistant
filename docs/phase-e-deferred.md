# Phase E — Deferred Items (CLOSED 2026-05-26)

All three previously-deferred Phase E items shipped in the
2026-05-26 follow-up session. This doc is preserved as a historical
record of what was deferred and how it was implemented. For the
current engine status see [CLAUDE.md](../CLAUDE.md) and
[.claude/handoff.md](../.claude/handoff.md).

---

## E12 — Part-year residency in multi-state framework ✅ DONE

**Shipped commit:** see `git log --grep="E12 —"`.

### What landed

1. **Client schema additions** (lib/db/src/schema/clients.ts):
   ```
   residency_changed_in_year  boolean    NOT NULL DEFAULT false
   former_state               text                — 2-letter code
   residency_change_date      text                — ISO YYYY-MM-DD
   ```
2. **`MultiStateTaxResult.partYearResidency`** populated when the
   engine sees a part-year client. Contains: formerState, currentState,
   residencyChangeDate, daysFormer, daysCurrent, daysInYear,
   formerStateAgi, currentStateAgi, formerStateTax, currentStateTax.
3. **Engine `calculateMultiStateTax`** branches on `partYearResidency`:
   - calls new `computePartYearAllocation` helper to parse the change
     date, clamp it to the tax year, compute day counts (366 leap /
     365 non-leap), and pro-rate AGI proportionally.
   - calls `calculateStateTax` twice — once with formerState and
     pro-rated former AGI, once with currentState and pro-rated current
     AGI — then sums to `totalStateTax`.
   - skips: NR-credit logic, WA LTCG surcharge, CA AMT (Schedule P),
     locality tax (NYC + MD/OH/IN flat-rate). Documented sub-gaps.
4. **Engine `computeTaxReturnPure`** auto-wires when client has all
   three residency fields set AND formerState !== current state.
5. **`ComputedTaxReturn`** surfaces `formerStateTax`, `formerStateCode`,
   `daysFormerStateResident`, `daysCurrentStateResident` (all 0 / null
   on the full-year path).
6. **tax_returns row** persists the same four fields via
   `recalcAndUpsert` in `taxReturnPipeline.ts`.
7. **OpenAPI** updated:
   - Client / CreateClientBody / UpdateClientBody gain the 3 new fields.
   - TaxReturn gains the 4 result fields.
8. **Frontend ClientForm** has a bordered "Moved between states" section
   with a checkbox + conditional former-state dropdown + date input +
   helper text.
9. **Frontend ClientDetail** adds a sub-line under "State Tax" when
   `formerStateTax > 0`: `└─ Part-year: CA (91d resident)  $378.36`.

### Test coverage

23 new hand-calc'd assertions in `tax-engine-phaseE-tests.ts`:

| Case | Hand-calc |
|---|---|
| CA → TX Apr 1 single $120k TY2024 (leap) | daysFormer=91; CA tax on $29,836; TX=$0 |
| NY → FL Apr 1 MFJ $200k | pro-rated NY only, FL=$0 |
| IL → CO Jul 1 single $80k | both states tax pro-rated AGI |
| TY2025 Apr 1 non-leap | daysFormer=90, daysCurrent=275 |
| Boundary: Jan 1 | 0 days former, all current |
| Boundary: Dec 31 | 365 days former, 1 day current |
| Negative: no part-year arg | falls through to full-year |
| Negative: locality + part-year | locality null (sub-gap) |
| Integration: full pipeline CA→TX | formerStateCode=CA, days=91/275, tax matches |
| Integration: flag=false | formerStateTax=0, full-year |
| Integration: same-state | formerStateTax=0 (guards pseudo-move) |

### Known sub-gaps

- AGI pro-rated proportionally by days, NOT by income source. Real
  per-state forms (NY IT-203, CA 540NR Sched CA, etc.) source by
  income item; engine approximates.
- Resident credit-for-tax-paid skipped on part-year path.
- Locality tax (NYC, MD/OH/IN) skipped for part-year filers.
- State AMT / WA LTCG surcharge skipped on part-year path.
- Standard deduction applied in full to each period rather than
  pro-rated.

---

## E13 — Auto wash-sale detection + §1091(d) basis adjustment ✅ DONE

**Shipped commit:** see `git log --grep="E13 —"`.

### What landed

1. **`detectWashSales()`** in `artifacts/api-server/src/lib/taxReturnEngine.ts`:
   - Scans the year's `CapitalTransactionFact[]` for loss sales.
   - For each loss row S: searches for another row T with same
     description (case-insensitive normalized) where T.dateAcquired is
     in `[S.dateSold − 30d, S.dateSold + 30d]` AND T.dateAcquired !=
     S.dateAcquired (defends against tax-lot splits).
   - Skips when adjustmentCode already contains "W" (broker-reported).
   - Earliest-replacement-wins tie-break (deterministic).
   - When detected: reverses loss via column g, increases T.costBasis
     by the disallowed amount (§1091(d)), sets `washSaleAutoDetected`,
     appends "W" to adjustmentCode if not present.
   - Returns a NEW array (input not mutated).
2. **Schema additions:**
   - `capital_transactions.wash_sale_auto_detected` (bool, default false)
   - `tax_returns.wash_sales_detected` (int, default 0)
   - `tax_returns.wash_sale_loss_disallowed` (numeric, default 0)
3. **`ComputedTaxReturn`** surfaces `washSalesDetected` (count) +
   `washSaleLossDisallowed` (total $).
4. **`computeTaxReturnPure`** runs the detector BEFORE the cap-txn
   aggregation step (line `rawCapTxnsForYear = ...; washSaleResult =
   detectWashSales(...);`).
5. **OpenAPI** updated: TaxReturn + CapitalTransaction + Create/Update
   bodies all surface the new fields.
6. **Frontend ClientDetail Schedule D tab** shows an amber banner:
   "Engine auto-detected N wash sale(s) (IRC §1091) — Total capital
   loss disallowed: $X." Renders only when `washSalesDetected > 0`.

### Test coverage

24 hand-calc'd unit assertions + 4 HTTP integration assertions:

| Case | Behavior |
|---|---|
| Single security loss + replacement +15d | wash sale fires |
| Replacement +61d | not a wash sale |
| Exactly +30d | fires (inclusive) |
| +31d | doesn't fire |
| Before-window: −25d | fires |
| Same dateAcquired | skipped (tax-lot guard) |
| Broker "W" already set | skipped |
| Gain sale | no wash sale |
| Different security | no wash sale |
| Multi-loss / single replacement in both windows | both fire |
| Empty input | 0 detected |
| Missing dateSold | skipped safely |
| Case-insensitive description | normalized |
| Engine integration via computeTaxReturnPure | works |
| Broker-reported via API | not double-counted |
| "WD" multi-code | skipped (contains W) |
| Detector pure (no input mutation) | confirmed |
| Single row | 0 detected |
| HTTP integration: $1k loss + replacement | washSalesDetected=1, disallowed=$1,000 |
| HTTP integration: broker-reported | washSalesDetected=0 |

### Known sub-gaps

- Replacement shares bought-and-held within the year (never sold) are
  INVISIBLE to the detector — the schema models dispositions only.
  CPAs enter those manually via `adjustmentCode = "W"`.
- Partial wash (rebought < sold shares) — engine fully disallows;
  should be share-proportional.
- Cross-account wash detected only when both brokers' transactions
  are entered in capital_transactions.
- §1091(d) formBox auto-flip ST→LT on the replacement not applied
  (CPA verifies via Schedule D tab).

---

## E14 — Other local income taxes (MD/OH/IN) ✅ DONE

**Shipped commit:** see `git log --grep="E14 —"`.

### What landed

1. **44 flat-rate localities** registered in `LOCAL_TAX_DATA`
   (artifacts/api-server/src/lib/taxCalculator.ts):
   - 24 MD counties (`state_taxable` base — federalAgi − MD std ded)
   - 10 major OH cities (`wages_only` base — total W-2 wages)
   - 10 IN counties (`state_taxable` base — federalAgi − IN std ded)
2. **New helpers:** `calculateFlatRateLocalTax`, `localityCodesForState`.
3. **`NycLocalTaxCalculation.jurisdiction`** widened from `"NYC"`
   literal to `string`. Added optional `flatRate` + `taxBase` fields.
4. **`calculateMultiStateTax` dispatch:**
   - NYC → existing NYC bracket path (resident=NY).
   - Other locality codes → `calculateFlatRateLocalTax`. Silently
     skips when state mismatch (stale localityCode after state change).
   - New `totalWages` option wired in for OH wage-base.
5. **OpenAPI:** dropped the `enum: ["NYC", null]` constraint on
   `localityCode`; documented the supported set in the schema description.
6. **Frontend:** new `localityLabels.ts` shared helper; ClientForm
   shows per-state locality dropdown; ClientDetail uses `localityLabel()`
   to render the local-tax line label (e.g., "Montgomery County, MD").

### Test coverage

30 hand-calc'd assertions in `tax-engine-phaseE-tests.ts`:

| Case | Hand-calc |
|---|---|
| MD-MONTGOMERY single $100k | 3.20% × ($100k − $2,700) = $3,113.60 |
| MD-HOWARD MFJ $200k | 3.20% × ($200k − $5,450) = $6,225.60 |
| MD-WORCESTER single $80k | 2.25% × ($80k − $2,700) = $1,739.25 |
| MD-BALTIMORE_CITY MFJ $1M | 3.20% × ($1M − $5,450) = $31,825.60 |
| OH-CINCINNATI single $80k wages | 1.80% × $80k = $1,440 |
| OH-CLEVELAND MFJ $100k | 2.50% × $100k = $2,500 |
| OH-YOUNGSTOWN single $60k | 2.75% × $60k = $1,650 |
| IN-MARION single $80k | 2.02% × $80k = $1,616 |
| IN-LAKE MFJ $120k | 1.50% × $120k = $1,800 |
| IN-PORTER single $90k | 0.50% × $90k = $450 |
| IN-HAMILTON single $500k | 1.10% × $500k = $5,500 |
| State/locality mismatch (NY + MD code) | null |
| No localityCode | null |
| Unknown code | null |
| AGI below MD std ded | base clamps to 0 |
| OH city with zero wages | $0 |
| NYC regression | preserved |
| Catalog sanity (24 MD + 10 OH + 10 IN) | 44 total |
| Direct calculateFlatRateLocalTax call | OK |
| Full computeTaxReturnPure MD integration | OK |
| Full pipeline OH 1099-INT excluded from wage base | $1,080 (60k × 1.80%) |
| Full pipeline NYC regression | preserved |

### Known sub-gaps

- MD personal exemption ($3,200/dependent) not modeled — base uses
  federalAgi − MD std ded only.
- OH cross-city employment credit not modeled.
- IN $1,000/filer personal exemption not modeled.
- PA local EIT (Earned Income Tax, 1% statewide minimum + local
  overrides administered by Berkheimer/Keystone) still not modeled —
  ~2000+ municipalities each with own rate, deferred.
- KY occupational tax still not modeled.

---

## Engine status (post-Phase E close-out)

- **Zero documented federal or state engine gaps remain.**
- 14 of 14 Phase E items complete.
- 235 Phase E assertions (E1–E14), ~2,000+ total across 29 suites.
