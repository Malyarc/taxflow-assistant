# Cross-Cutting Invariants Audit — TaxFlow Assistant
Fresh independent auditor · 2026-06-11 · READ-ONLY · scope: `artifacts/api-server/src/lib/` cross-cutting invariants
Repros (all run via `cd scripts && npx tsx /tmp/audit-repro-*.ts`): `/tmp/audit-repro-1-purity.ts` … `-6-earned.ts`.

Severity scale per brief: CRITICAL = double-count/purity break affecting filed numbers · HIGH = narrower · MEDIUM = edge/robustness · LOW = cosmetic.

---

## HIGH findings (filed-number impact, confirmed by repro)

### H1. K-1 partner SE earnings excluded from EITC/ACTC/dep-care "earned income" — $0 credits for a partner with identical economics to a sole prop
`taxReturnEngine.ts:3613` — `earnedIncomeHousehold = totalWages + Math.max(0, netSeIncome − se.deductibleHalf)`.
`netSeIncome` is **Schedule-C-only**; K-1 Box 14A SE earnings, clergy housing, church-employee income, statutory-employee income are all SE-taxed (in `seTaxBase`, line 2117) but NOT in earned income — while `se.deductibleHalf` (subtracted) covers ALL of them. §32(c)(2)(A)(ii) earned income includes a partner's net SE earnings.
**Repro 6 (confirmed):** HoH, 2 kids, $18,000 income, identical AGI ($16,728.34) and identical SE tax ($2,543.32):
- as Sch C sole prop → EITC **$6,691.34** + ACTC **$2,134.25** → refund **+$6,282.27**
- as partnership K-1 (Box 1 + 14A) → EITC **$0** + ACTC **$0** → owes **−$2,543.32**
$8,825 swing on identical facts; over-tax/under-credit. Also hits the §21 dep-care earned-income cap and `earnedIncomeForStdDed` (line 2834, §63(c)(5) dependent std ded — omits K-1 14A and clergy but does include statutory/church). For a mixed Sch C + K-1 return the full ½-SE over-subtracts from the Sch-C-only income, under-counting earned income even when Sch C exists.

### H2. K-1 Box 2 (rental RE) double-dips into QBI while being §469-suspended out of AGI — QBI deduction on income never taxed
`taxReturnEngine.ts:2940` and `:3045` — the QBI auto-default for an ACTIVE K-1 computes `Math.max(0, box1 + box3 + box2)` while the comment four lines above (2937-2939) says "**Box 2 (rental RE) excluded** — typically passive at the holder level". Meanwhile `k1PassiveCurrentYear` (line 1972-1975) routes **ALL** Box 2 (active and passive K-1s) into the §469 passive bucket for AGI.
**Repro 2-A (confirmed):** active K-1 Box 2 = $50,000 + separate passive K-1 loss −$50,000 → passive bucket nets to 0, **$0 reaches AGI** (AGI identical to W-2-only control), yet **QBI deduction $10,000** is granted → taxable income $10k lower than control. Comment-vs-code contradiction; under-tax. Even without a suspending loss, Box 2 income of an active K-1 is AGI-passive but QBI-active — internally inconsistent.

### H3. K-1 ordinary/qualified dividend semantics — transcribing the real form's Box 6a/6b double-counts qualified dividends in AGI (and NIIT)
The DB schema (`lib/db/src/schema/schedule-k1-data.ts:74-77`) documents the fields as "1065 Box **6a**" / "Box **6b**" — on the actual K-1, 6b is a **subset** of 6a (same as 1099-DIV 1a/1b). The 1099-DIV path correctly nets (`summarize1099s`, `taxReturnEngine.ts:628-631`: 1a − 1b); the K-1 path adds both raw (`k1OrdinaryDividends` at 1977 + `qualifiedDividends` incl. `k1QualifiedDividends` at 2233 both enter AGI at 2652-2646; NIIT mirrors at 3265-3268).
**Repro 2-B (confirmed):** identical dividends ($10,000 total / $8,000 qualified): 1099-DIV path adds $10,000 to AGI; K-1 path adds **$18,000** — the $8,000 qualified subset counted twice. Over-tax. Existing tests/UI use a disjoint-entry convention, but the schema's own box documentation contradicts it — a CPA transcribing a real K-1 double-counts. (Also: `nonQualifiedDividends` at 2447-2451 subtracts qualified from the ALREADY-netted 1099 figure — see M5.)

### H4. PTC §36B MAGI = raw AGI — omits nontaxable SS, tax-exempt interest, and FEIE
`taxReturnEngine.ts:3890` passes `modifiedAgi: calc.adjustedGrossIncome` to `calculatePremiumTaxCredit`. §36B(d)(2)(B) household MAGI = AGI + §911 exclusion + tax-exempt interest + **nontaxable** SS benefits.
**Repro 3-A (confirmed):** single retiree, $20k 1099-R + $40k SS + $15k tax-exempt interest on ACA: engine MAGI $42,350 vs true §36B MAGI **$75,000** → engine grants netPtc **$7,120** (over-credit on the order of $4k/yr). This is a mainstream retiree-on-ACA scenario, not an expat edge. Ironically the §23 adoption credit (line 3727) adds the FEIE back "mirror[ing] the §36B PTC MAGI" — the PTC itself doesn't.

### H5. FEIE MAGI add-back family — present for IRA/SLI/NIIT/adoption, MISSING for CTC §24(b), education §25A(d)(3), Saver's §25B(e), OBBBA Schedule 1-A, and the §32 Form-2555 EITC bar
All of these receive `calc.adjustedGrossIncome` raw: CTC (line 3744), education credits (3676), Saver's (3691), OBBBA 1-A `magi` (3085); `calculateEitc` has no FEIE input (no §32(c)(1)(C)/2555 categorical bar — narrow because FEIE income isn't in engine earned income anyway, but US-wage + Form 2555 filers wrongly keep EITC).
**Repro 3-B (confirmed):** MFJ expat, $560k foreign earned income, FEIE $253k → AGI $307k → engine grants **full $4,000 CTC**; true §24(b) MAGI $560k → CTC fully phased out. Under-tax for expat filers. The engine demonstrably knows how to do this add-back (IRA line 2743, SLI 2766, NIIT 3305, adoption 3727) — the remaining sites are inconsistent.

### H6. API-unreachable engine features — engine read-sites whose data can never exist in the live app (tests pass via the pure seam; UI/API path silently does nothing)
Confirmed three-way diff (openapi enum 127 types ↔ engine reads 124 ↔ FE labels 122):
- **`sourceState` on ScheduleK1Fact + RentalPropertyFact** — read at `taxReturnEngine.ts:3374/3393/3448/3471` (C11 deeper part-year sourcing + PREP-B1 NR sourcing) but the column exists in NEITHER `schedule-k1-data.ts` nor `rental-properties.ts` nor openapi. ⇒ the shipped, enum'd markers **`part_year_use_full_source_allocation`** and **`nonresident_source_allocation`** have their K-1/rental legs permanently dead in the live app (only `capitalTransactions.propertyStateSitus`, which IS in DB+API, works). The rental fallback "or `state` field" promised at 3339-3341 doesn't exist in code or schema.
- **K-1 `distributions` + `separatelyStatedDeductions`** — engine applies the §1367/§1368 basis drawdown (line 1958) and DB columns exist, but they are missing from the openapi ScheduleK1/Create/Update bodies and the FE form → always 0 via the app → basis limit applied too leniently (allows losses that should be suspended). The classic "forgot the CreateBody" drift CLAUDE.md warns about.
- **Engine-read adjustment types NOT in the openapi enum** (the zod-validated API 400s them; FE can't offer them): `bonus_depreciation_basis_obbba` (the documented OBBBA 100%-bonus CPA path), `qbi_w2_wages`, `qbi_ubia` (Sch C §199A wage/UBIA limit), `qsbs_exclusion_pct` (50/75% older QSBS), `out_of_state_muni_interest`, `us_treasury_interest` (state-base modifications). (`foreign_tax_credit_carryforward` is also non-enum but is pipeline-synthesized — reachable, OK.)
- **`TaxReturnInputs.form4797` is never populated by the pipeline** — no business-property-sales table exists; `taxReturnPipeline.ts` never sets it. Consequently the enum'd + FE-labeled **`section_1231_lookback_loss`** adjustment is a live-app NO-OP (`computeForm4797` returns EMPTY when `sales.length === 0`, `form4797.ts:120` — the lookback only recharacterizes a §1231 gain that can never exist). §1245/§1250/§1231 in the live app work only via `capitalTransactions.gainClass`.

---

## MEDIUM findings

### M1. Silently-ignored ("no-op") adjustment types — full list (in enum + UI dropdown; zero effect on filed numbers)
A CPA can select these in the Adjustments editor; the return's numbers do not change:
1. `nua_lump_sum_employer_stock` — **no consumer anywhere** (planning NUA detector reads asset balances, not this).
2. `mega_backdoor_roth_after_tax_contribution` — **no consumer anywhere**.
3. `roth_conversion_amount` — read ONLY by the Form 8606 PDF endpoint (`routes/tax-returns.ts:481`). **Trap:** a Roth conversion is taxable; the label "Roth conversion amount" suggests entering it has a tax effect — it doesn't (tax requires a 1099-R entry).
4. `traditional_ira_distribution` — 8606 pro-rata PDF only (same trap as 3; taxation requires the 1099-R).
5. `roth_ira_distribution` — 8606 Part III PDF only (the Part III §72(t) computation does NOT flow into the live liability).
6. `roth_conversion_basis`, `roth_conversion_basis_within_5yr` — 8606 Part III PDF only.
7. `nondeductible_ira_contribution` — 8606 basis + planning detector only. (Correct that it's not deducted, but it is NOT counted toward the Saver's credit either, which Form 8880 would allow.)
8. `augusta_rule_rent` — planning suppression signal only (`planningEngine.ts:1686`). Defensible (§280A(g) income is excluded) but undocumented in the label.
9. `scorp_reasonable_comp` — planning input only (`planningEngine.ts:2086`).
10. `section_1231_lookback_loss` — see H6 (dead without form4797 rows).
11. `nonresident_source_allocation` / `part_year_use_full_source_allocation` — partial no-ops (see H6; W-2/capital-gain legs work, K-1/rental legs dead).

### M2. Negative carryforward amount creates phantom income (sign-convention trap)
`netSTCG = … − stcgCarryforward` / `netLTCG = … − ltcgCarryforward` (`taxReturnEngine.ts:2367-2368`) with NO floor on the adjustment.
**Repro 4 (confirmed):** `capital_loss_carryforward_short` entered as **−50,000** (a CPA plausibly types a loss as negative) → AGI +$50,000, federal tax **+$11,697.50**. Every other probed negative amount was inert (floored) or an intended lever; this is the only one that manufactures income. (Auto-synthesized carryforwards are gated `> 0` in the pipeline, so only manual entry triggers it.)

### M3. Engine totality (the SEC1 "can NEVER emit NaN/Infinity" claim) is false for non-Numish fields at the pure/Haven seam
`toNum` (±1e13 clamp) covers every money field on W-2/1099/adjustments/K-1/rental/capital-transaction facts (verified). NOT covered — typed plain `number`:
- **Throws:** `eitcQualifyingChildren: NaN` or `dependentsUnder17: NaN` → `TypeError` in `calculateEitc` (`taxCalculator.ts:2908`, undefined threshold-table entry). Repro 5.
- **NaN into filed outputs:** `otherDependents: NaN` → `federalRefundOrOwed = NaN`; `eligibleEducatorCount: NaN` → AGI/taxableIncome/federalTaxLiability all NaN; `dependentsForCareCredit: NaN` → NaN in dep-care detail; `acaHouseholdSize: NaN` → NaN in PTC detail. Repro 5.
- **Always-Infinity sentinel:** `premiumTaxCredit.repaymentCap = Infinity` whenever income ≥ 400% FPL (`taxCalculator.ts:5303/5336`) — deliberate, guarded in `form8962Spec.ts:132`, but it ships non-finite output (JSON-serializes to `null`). Repro 1.
- **Unclamped local coercions:** `form4797.ts:29`, `stateMandate.ts:33`, `scheduleH.ts:29` each define their own `num()` (NaN→0 but no ±1e13 clamp); `taxReturnPipeline.ts:201` maps ScheduleCAsset with raw `Number(a.cost)` and casts `recoveryYears`/quarter unchecked. Live app is protected by zod int ranges + numeric(12-14,2) column precision; the exposure is exactly the Haven seam the claim is about.

### M4. Adjustments have no taxYear — every applied adjustment hits EVERY year's return of a client
`adjustments` table (`lib/db/src/schema/adjustments.ts`) has no `tax_year` column; pipeline loads all rows (`taxReturnPipeline.ts:116`) and the engine applies all `isApplied !== false` rows regardless of year (engine line 1588). The schema's own comment ("engine … filters by isApplied + tax-year in code") is wrong for adjustments. Consequences: a TY2024 `self_employment_income` adjustment also lands in the TY2025 return after roll-forward (roll-forward intentionally does NOT proforma adjustments); recomputing a prior year after adding current-year adjustments silently changes the prior year (1040-X diffs absorb it); the G4 multi-year detectors see identical adjustment-derived income in both years. Single-year returns are unaffected.

### M5. §163(d) `nonQualifiedDividends` double-subtracts qualified dividends
`taxReturnEngine.ts:2447-2451`: `(form1099Summary.ordinaryDividends + k1OrdinaryDividends) − (form1099Summary.qualifiedDividends + k1QualifiedDividends)` — but `form1099Summary.ordinaryDividends` is ALREADY net of qualified (summarize1099s 1a−1b), and under the engine's own disjoint K-1 convention `k1OrdinaryDividends` excludes qualified too. The §163(d) net-investment-income cap is understated by the full qualified-dividend total → investment-interest deduction under-allowed. Conservative (over-tax) but wrong; floored at 0 so often silently zero.

### M6. `totalTaxBurden` / `effectiveTaxRate` exclude local tax and NYC UBT
`taxReturnEngine.ts:4082` sums federal + state (± credits, + mandate) but never adds `localTaxLiabilityWithUbt`. A NYC filer's ~3.9% PIT (+ MCTMT, UBT) is missing from `effectiveTaxRate` — which feeds the H11 peer-benchmark percentile, the planning score context, and the displayed effective rate. Not a filed number; materially misleading analytics for locality clients.

---

## LOW / notes

- **L1.** `toLocaleString()` with no explicit locale in output `reason` strings — `taxCalculator.ts:671, 677, 697-698, 709` (NJ pension / NY pension / HI pension). Same inputs render differently under a different host locale (e.g. `150.000` vs `150,000`) — a byte-determinism wrinkle for the Haven seam; other sites correctly pass `"en-US"`. Numbers unaffected.
- **L2.** Five newest adjustment types missing FE labels (fall back to raw snake_case in the dropdown): `church_employee_income`, `crypto_mining_income`, `crypto_staking_income`, `se_optional_method_nonfarm`, `statutory_employee_income` (`tax-app/src/lib/adjustmentLabels.ts`).
- **L3.** `proforma` flag (W-2/1099/K-1/rental/asset-balances) is DB-only — not in any openapi schema, so the FE cannot mark a row as an estimate; visibility is only via the organizer. Proforma rows DO flow into the engine as real income (pipeline has no proforma filter) — apparently by design (roll-forward projections), worth an explicit design note since the year-N+1 "return" is silently computed from prior-year estimates until each row is touched.
- **L4.** Kiddie unearned income (engine line 3113) omits rents/royalties/taxable SS/pensions — documented simplification ("Unearned for our engine = …"), under-taxes kiddie filers with royalty income.
- **L5.** `tax_documents.fieldBoxes` etc. DB-only columns are intentional internals; clients table ↔ openapi Client parity is clean (44/44 + index defs).
- **L6.** Pipeline default-year fallback `new Date().getFullYear() − 1` (`taxReturnPipeline.ts:91`) — wall-clock in the ADAPTER only (pure engine takes `taxYear` resolved); acceptable, documented here for completeness.

---

## Verified CLEAN (explicitly checked, no issue)

**Purity of `computeTaxReturnPure` (Repro 1 — all PASS):**
- Full transitive import graph = taxReturnEngine → {taxCalculator, form4797, stateMandate, scheduleH} → {stateTaxData, paEitRates, ohSchoolDistricts, taxYears}. No DB/fs/network imports, no `process.env`, no `Math.random` (monteCarloEngine uses a seeded mulberry32 and is outside the graph anyway), no module-level `let`/mutable state in any module of the graph.
- `new Date()` appears only in `form2210.ts:368` and `form8606.ts:362` **PDF builders, outside the pure graph**; the two in-graph `new Date(ms)` sites (taxCalculator:1887, taxReturnEngine:1229) construct from parsed timestamps and use UTC accessors / `.getTime()` only — deterministic and timezone-safe.
- Deep-frozen (recursively `Object.freeze`d) rich inputs run without throwing → no input mutation (wash-sale detector clones rows; whatIfEngine clones adjustments + client; the one engine-side mutation, `multiState.localTax.nycEitc` at 3866-3868, targets the engine's own freshly-built result object).
- Double-call byte-identical; interleaved different-return call does not perturb a recompute (no cross-call state).
- Object-key iteration on user data: `perStateWages`/`perStateOtherSourced` Map/Record sums are order-independent (additions only); `scheduleBPayers` explicitly sorted.

**NaN/Infinity seams:** every variable-denominator division checked is guarded (`nrSource/federalAgi` + `totalNrWages/federalAgi` behind `params.federalAgi > 0` at taxCalculator:1530/1625; day prorations behind `daysInYear > 0`; clergy share behind `seTaxBase > 0`; effectiveRate behind `totalIncome >= 1`). All W-2/1099/K-1/rental/capital-transaction/adjustment money fields flow through the clamped `toNum`.

**Double-count ledger — verified single-entry:**
- 1099-DIV ordinary vs qualified: netted (1a−1b) before both are added — no double-count on the 1099 path.
- `capitalTransactions` REPLACE 1099-B ST/LT aggregates (cap-gain distributions stay additive — correct, they're not 8949 rows).
- Per-property `rentalProperties` REPLACE the aggregate `schedule_e_rental_*` adjustments (not added).
- K-1 Box 14A drives Schedule SE ONLY (income reaches AGI via Box 1) — no AGI double; `max(Box 14A, Box 4 GP)` prevents the GP double-count.
- §121 remainder, §1202 remainder, §1031 recognized gain, Form 4797 §1231 LTCG each enter `netLTCG` exactly once and the NIIT/special-rate paths read post-netting buckets consistently.
- §111 state refund: included in AGI only when `priorYearItemized`, and then REMOVED from AMTI (line 2e); the legacy combined `unemploymentIncome` field has NO consumers (grep-verified) — only the split fields feed AGI, once.
- Taxable SS added once (ordinary + total income); SS not in the provisional AGI used to compute its own taxability (documented single-pass).
- Withholding: W-2 Box 2 + 1099 federal + `withholding_adjustment` each counted once; state likewise.
- OBBBA Schedule 1-A reduces taxable income only; AGI-derived bases (NIIT, EITC, phase-outs) correctly unaffected; its MAGI uses AGI with no circularity (FEIE add-back gap noted in H5).
- Carryforward synthesis is single-source: every auto-load in `synthesizePriorYearCarryforwards` is gated by `hasManualOverride` (manual—even $0—suppresses auto), amounts gated `> 0`; `investmentInterestCarryforwardRemaining` persists `investmentInterestDisallowed`, which already includes the carried-in portion → correct roll-forward, no doubling.
- 1099-NEC + `self_employment_income` adjustments are additive BY DESIGN (adjustment = Sch C income beyond 1099s); same for `long_term_capital_gain` vs transactions (documented "not already captured").
- `summarize1099s` F1 case-insensitivity intact at all read sites checked.

**Sign conventions:** `federalRefundOrOwed` and `stateRefundOrOwed` are consistently positive=refund (withheld + credits − liability); negative `withholding_adjustment`/`credit` reduce the refund as designed; negative Schedule-A/credit-input amounts are inert (floored at each consumer — probed medical/SALT/charitable/HSA/dep-care/LLC/FTC/Saver's/tips/SLI, all no-effect); negative `self_employment_income` is an intended signed Sch C loss (§461(l)-capped); negative `schedule_e_rental_income` correctly routes through the §469 loss path. whatIf delta = scenario − baseline, negative=savings, documented; frontend uses `combinedRefundDelta` per CLAUDE.md.
- Exception: negative capital-loss carryforwards (M2).

**Pipeline / parity:** all 9 persisted input tables the engine consumes are loaded (clients, w2, 1099, adjustments, rentals, capital transactions, K-1, asset balances, Sch C assets) — `form4797` is the only engine input with no table (H6). W2Fact/Form1099Fact/CapitalTransactionFact/RentalPropertyFact field names all exist in their Drizzle schemas (structural typing would also catch renames at compile time); Drizzle numeric-string columns are coerced via `toNum`/`Number(...)` at every read site checked; `tax_returns` write path String()s every numeric. `propertyStateSitus`, `gainClass`, `unrecaptured1250Amount`, `quantity`, `account` all present in DB + openapi (reachable). Clients ↔ openapi Client: parity clean.
