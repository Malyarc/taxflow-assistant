# TaxFlow Assistant — Coverage Matrix

**Status as of 2026-05-26.** Inventory of what the calc engine models vs.
what's not yet covered. This is the source of truth for "do we handle X?".

Read this before planning state or federal coverage work. When you add a
new feature, **update this doc in the same commit**.

Source files referenced:
- [stateTaxData.ts](../artifacts/api-server/src/lib/stateTaxData.ts) — state brackets, std deductions, personal exemptions, SS-taxing set, reciprocity
- [taxCalculator.ts](../artifacts/api-server/src/lib/taxCalculator.ts) — all calculators incl. `LOCAL_TAX_DATA`
- [taxReturnEngine.ts](../artifacts/api-server/src/lib/taxReturnEngine.ts) — `computeTaxReturnPure` pipeline

---

## 1. Federal engine coverage

### Forms / schedules modeled

| Form / Schedule | Modeled | Notes |
|---|---|---|
| **Form 1040** | ✅ | Full line-by-line, including PDF fill (`buildIrsForm1040Pdf`) |
| **Schedule 1** (Additional Income / Adjustments) | ✅ | Above-the-line: HSA, SEHI, half-SE, IRA, educator, student loan int, alimony, FEIE |
| **Schedule 2** (Additional Taxes) | ✅ | AMT, SE, NIIT, AddlMed, §72(t), excess HSA excise (§4973(g)) |
| **Schedule 3** (Credits) | ✅ | CTC, AOC/LLC, Saver's, DependentCare, FTC, AMT credit (Form 8801) |
| **Schedule A** (Itemized) | ✅ | Per-line: medical, SALT (cap $10k), mortgage int, charitable cash + non-cash |
| **Schedule B** (Interest / Div) | ✅ | Implicit from 1099 records |
| **Schedule C** (SE Business) | ✅ | Via SE earnings input; no per-line P&L tab (CPA enters net) |
| **Schedule D** + **Form 8949** | ✅ | Per-transaction, formBox A-F, broker-reported wash sale + E13 auto-detection |
| **Schedule E** (Rentals + K-1) | ✅ | Per-property MACRS (27.5y / 39y), §469 PAL with $25k allowance + REP exception; K-1 passive bucket separate |
| **Schedule SE** | ✅ | Including K-1 Box 14A; K1-MFJ per-spouse SS-wage-base sharing |
| **Form 6251** (AMT) | ✅ | Line 2g state-tax addback (auto from SALT), Line 2k ISO bargain, K3 LTCG preferential MIN |
| **Form 8959** (Addl Medicare 0.9%) | ✅ | K2 |
| **Form 8960** (NIIT 3.8%) | ✅ | |
| **Form 8615** (Kiddie tax) | ✅ | K8 — taxes unearned > $2,600 at parent's marginal rate |
| **Form 2555** (FEIE §911) | ✅ | K9 — per-spouse cap, stacking rule |
| **Form 8801** (AMT credit carryforward) | ✅ | E2 — IRC §53 |
| **Form 8889** (HSA) | ✅ | E4 — employer contrib, §4973(g) excise |
| **Form 7206** (SEHI) | ✅ | K5 — net SE − ½ SE cap |
| **Form 1116** (FTC) | ✅ | BP7 — including form-limit binding |
| **Form 8606** (nondeductible IRA basis) | ❌ | TODO — H6 in Phase H |
| **Form 4868** (extension) | ❌ | **C8 — shipping this session** |
| **Form 1040-X** (amended) | ❌ | **C4 — shipping this session** |
| **Form 8824** (§1031 like-kind) | ❌ | **C5 — shipping this session** |
| **Form 8990** (§163(j)) | ❌ | **C7 — shipping this session** |
| **Form 461** (§461(l)) | ❌ | **C7 — shipping this session** |
| **Form 1041 / 1065 / 1120 / 1120-S** | ❌ | Out of scope (Phase 4 Option A) |
| **Form 706 / 709** | ❌ | Out of scope (estate/gift) |

### IRC sections explicitly modeled

§55-§59 (AMT, including K3 LTCG-preferential MIN, line 2g/2k), §72(t) (early-withdrawal penalty, E5), §85 (unemployment), §111 (1099-G tax-benefit rule, E6), §121 (home-sale exclusion, K6), §163(j) ❌, §168(k) (bonus depreciation, E7), §170 (charitable + §170(d)(1) 5-year cf, E3), §172 (NOL + post-TCJA 80% limit, K4), §179 (E7), §199A (simplified 20%; **no wage/UBIA cap, no SSTB**), §408(d)(2) (backdoor Roth pro-rata) ❌, §409A (NQDC) ❌, §461(l) ❌, §469 (PAL — rental bucket + K-1 bucket separate, $25k allowance + REP exception), §1031 ❌, §1091 + §1091(d) basis adjustment (wash sale + E13 auto-detection), §1202 (QSBS, assumes 100% post-2010-09-27), §1211/§1212 (cap-loss limit + $3k offset + carryforward), §1374 ❌, §1411 (NIIT), §911 (FEIE, K9), §4973(g) (HSA excess excise, E4)

### Credits modeled (in IRS order)

**Non-refundable** (capped against `regularFederalTax + amtTax` only; not against SE or NIIT):

1. CTC non-refundable portion
2. Saver's Credit
3. Education AOC non-refundable (60% of AOC)
4. Lifetime Learning Credit
5. Dependent Care Credit
6. Foreign Tax Credit (Form 1116)
7. AMT credit (Form 8801)

**Refundable** (add directly to refund):

- EITC (with state piggybacks — see state matrix below)
- AOC refundable portion (40%)
- ACTC (Additional Child Tax Credit, $1,700/child for TY2024)

### Known federal gaps (not modeled)

- §163(j) business interest expense limit — **C7 this session**
- §461(l) excess business loss limit — **C7 this session**
- §1031 like-kind exchange basis carryover — **C5 this session**
- ESPP qualifying/disqualifying disposition; ISO disqualifying disposition (ISO bargain is modeled for AMT pref only) — **C6 this session**
- Form 8606 nondeductible IRA basis (required for backdoor Roth) — H6
- §1202 sub-multipliers for pre-2010-09-27 acquisitions (75% / 50%)
- §1091(d) auto-flip ST→LT on wash-sale replacement (covered as a sub-gap in the deep audit; partial wash NOT modeled either)
- AMT line 2i MACRS-vs-ADS depreciation diff; line 2e state-refund recapture; AMT NOL
- K-1 §199A wage/UBIA limits + SSTB phase-out (engine applies flat 20%)
- K-1 guaranteed payments (Box 4)
- K-1 basis / at-risk limits (stored but not enforced)
- Carryforwards modeled: NOL, AMT credit, charitable cash, capital-loss ST/LT, §469 PAL (rental + K-1 separate). **Not modeled:** SEHI cf, FTC cf, §163(j) cf
- Treaty positions; sourcing for FTC by category

---

## 2. State engine coverage matrix

51 jurisdictions (50 states + DC). Key:

- **Inc tax** — has any state income tax (excl. AK/FL/NV/SD/TX/WY; NH+WA wages-exempt)
- **Brackets** — progressive (P) vs. flat (F)
- **Std ded** — modeled (✓), zero/uses-exemption (✗)
- **Exempt** — personal exemption modeled (`personalExemption` set)
- **Cliff** — exemption cliff at high AGI (E1)
- **Surtax** — surtax on income above threshold
- **SS tax** — Social Security benefits taxed at state level
- **EITC** — state EITC modeled
- **CTC** — state CTC modeled (E9)
- **AMT** — state AMT modeled
- **Retire** — partial/full retirement-income exemption modeled
- **Local** — local income tax option(s) available (locality count in parens)

| St | Name | Inc tax | Brackets | Std ded | Exempt | Cliff | Surtax | SS tax | EITC | CTC | AMT | Retire | Local |
|----|----|---|---|---|---|---|---|---|---|---|---|---|---|
| AL | Alabama | ✓ | P | ✓ | — | — | — | — | — | — | — | — | — |
| AK | Alaska | ✗ | — | — | — | — | — | — | — | — | — | — | — |
| AZ | Arizona | ✓ | F 2.5% | ✓ | — | — | — | — | — | — | — | — | — |
| AR | Arkansas | ✓ | P | ✓ | — | — | — | — | — | — | — | — | — |
| CA | California | ✓ | P | ✓ | — | — | 1% >$1M MHST | — | ✓ 45% (CalEITC) | ✓ YCTC | ✓ (G5) | — | — |
| CO | Colorado | ✓ | F 4.4% | ✓ fed | — | — | — | ✓ | ✓ E9 piggyback | ✓ | — | — | — |
| CT | Connecticut | ✓ | P | ✗ | — | — | — | ✓ (phase ≈ approx) | ✓ 40% | — | — | — | — |
| DE | Delaware | ✓ | P | ✓ | — | — | — | — | ✓ 4.5% | — | — | — | — |
| DC | DC | ✓ | P | ✓ | — | — | — | — | ✓ 70% | — | — | — | — |
| FL | Florida | ✗ | — | — | — | — | — | — | — | — | — | — | — |
| GA | Georgia | ✓ | F 5.39% | ✓ | — | — | — | — | — | — | — | — | — |
| HI | Hawaii | ✓ | P | ✓ | — | — | — | — | — | — | — | ✓ Full | — |
| ID | Idaho | ✓ | F 5.8% | ✓ fed | — | — | — | — | — | — | — | — | — |
| IL | Illinois | ✓ | F 4.95% | ✗ | ✓ $2,775/filer | ✓ $250k/$500k | — | — | ✓ E10 | ✓ | — | ✓ Full | — |
| IN | Indiana | ✓ | F 3.05% | ✗ | — | — | — | — | ✓ 10% | — | — | — | ✓ (10) |
| IA | Iowa | ✓ | P | ✓ fed | — | — | — | — | ✓ 15% | — | — | — | — |
| KS | Kansas | ✓ | P | ✓ | — | — | — | ✓ | ✓ 17% | — | — | — | — |
| KY | Kentucky | ✓ | F 4.0% | ✓ | — | — | — | — | — | — | — | — | — |
| LA | Louisiana | ✓ | P | ✓ | — | — | — | — | ✓ 5% | — | — | — | — |
| ME | Maine | ✓ | P | ✓ | — | — | — | — | ✓ 25% | — | — | — | — |
| MD | Maryland | ✓ | P | ✓ | — | — | — | — | ✓ 45% | — | — | — | ✓ (24) |
| MA | Massachusetts | ✓ | F 5.0% | ✗ | — | — | 4% >$1.05M | — | ✓ 40% | — | — | — | — |
| MI | Michigan | ✓ | F 4.25% | ✗ | — | — | — | — | ✓ 30% | — | — | — | — |
| MN | Minnesota | ✓ | P | ✓ | — | — | — | ✓ | ✓ WFC | — | — | — | — |
| MS | Mississippi | ✓ | F 4.7% | ✓ | — | — | — | — | — | — | — | ✓ Full | — |
| MO | Missouri | ✓ | P | ✓ fed | — | — | — | — | — | — | — | — | — |
| MT | Montana | ✓ | P | ✓ fed | — | — | — | ✓ | ✓ 10% | — | — | — | — |
| NE | Nebraska | ✓ | P | ✓ | — | — | — | — | ✓ 10% | — | — | — | — |
| NV | Nevada | ✗ | — | — | — | — | — | — | — | — | — | — | — |
| NH | New Hampshire | partial | int/div only | — | — | — | — | — | — | — | — | — | — |
| NJ | New Jersey | ✓ | P | ✗ | — | — | — | — | ✓ 40% | ✓ | — | ✓ Partial cap | — |
| NM | New Mexico | ✓ | P | ✓ fed | — | — | — | ✓ | ✓ 25% WFTC | ✓ | — | — | — |
| NY | New York | ✓ | P | ✓ | — | — | — | — | ✓ 30% + NYC sliding | — | — | ✓ Partial $20k/$40k | ✓ NYC PIT + school + MCTMT |
| NC | North Carolina | ✓ | F 4.5% | ✓ | — | — | — | — | — | — | — | — | — |
| ND | North Dakota | ✓ | P | ✓ fed | — | — | — | — | — | — | — | — | — |
| OH | Ohio | ✓ | P | ✗ | — | — | — | — | ✓ 30% | — | — | — | ✓ (10 cities) |
| OK | Oklahoma | ✓ | P | ✓ | — | — | — | — | ✓ 5% | — | — | — | — |
| OR | Oregon | ✓ | P | ✓ | — | — | — | — | ✓ 9% | — | — | — | — |
| PA | Pennsylvania | ✓ | F 3.07% | ✗ | — | — | — | — | Sched SP forgiveness | — | — | ✓ Full | — |
| RI | Rhode Island | ✓ | P | ✓ | — | — | — | ✓ | ✓ 16% | — | — | — | — |
| SC | South Carolina | ✓ | P | ✓ fed | — | — | — | — | — | — | — | — | — |
| SD | South Dakota | ✗ | — | — | — | — | — | — | — | — | — | — | — |
| TN | Tennessee | ✗ | — | — | — | — | — | — | — | — | — | — | — |
| TX | Texas | ✗ | — | — | — | — | — | — | — | — | — | — | — |
| UT | Utah | ✓ | F 4.55% | ✗ | — | — | — | ✓ | — | — | — | — | — |
| VT | Vermont | ✓ | P | ✓ | ✓ $4,850/filer | — | — | ✓ | ✓ 38% | ✓ | — | — | — |
| VA | Virginia | ✓ | P | ✓ | — | — | — | — | ✓ 15% | — | — | — | — |
| WA | Washington | partial | LTCG 7% >$262k | — | — | — | — | — | — | — | — | — | — |
| WV | West Virginia | ✓ | P | ✗ | — | — | — | — | — | — | — | — | — |
| WI | Wisconsin | ✓ | P | ✓ | — | — | — | — | ✓ tiered | — | — | — | — |
| WY | Wyoming | ✗ | — | — | — | — | — | — | — | — | — | — | — |

**Multi-state reciprocity agreements** (15): DC, IL, IN, IA, KY, MD, MI, MN, MT, NJ, ND, OH, PA, VA, WV, WI — see `STATE_RECIPROCITY` in [stateTaxData.ts](../artifacts/api-server/src/lib/stateTaxData.ts).

**Federal-conforming std-ded states** (auto-update to federal value each year): CO, ID, IA, MN, MO, MT, NM, ND, SC.

**SS-taxing states** (9): CO, CT, KS, MN, MT, NM, RI, UT, VT. CT phases out below $75k single / $100k MFJ — engine over-taxes those filers (sub-gap, conservative).

---

## 3. Local income tax coverage

Modeled in `LOCAL_TAX_DATA` ([taxCalculator.ts:602](../artifacts/api-server/src/lib/taxCalculator.ts:602)):

| Locality bundle | Count | Detail |
|---|---|---|
| **NYC PIT** | 1 | Full bracketed PIT (4 brackets per status) + IT-201 line 48 household credit. NYC School Tax Credit (E8) + MCTMT (E8 tiered SE tax) modeled. NYC EITC sliding scale (G1) modeled. |
| **Yonkers** | 0 | NOT modeled. NY income tax has Yonkers as a flat % of state liability — sub-gap. |
| **MD counties** | 24 | All 23 counties + Baltimore City. Rates 2.25% (Talbot) to 3.20% (Baltimore City + 11 others). Base = state taxable income. |
| **OH cities** | 10 | Akron, Canton, Cincinnati, Cleveland, Columbus, Dayton, Lakewood, Parma, Toledo, Youngstown. Base = wages_only. **Cross-city employment credit NOT modeled** — sub-gap. |
| **IN counties** | 10 | Allen, Elkhart, Hamilton, Lake, Marion, Monroe, Porter, St. Joseph, Tippecanoe, Vanderburgh. Rates 0.50% – 2.035%. Base = state taxable income. |
| **PA local EIT** | 0 | NOT modeled. ~2,000+ municipalities; requires zip/municipality lookup. C9 deferred. |
| **NYC UBT** | 0 | NOT modeled. Separate tax on unincorporated business income. |
| **KY occupational tax** | 0 | NOT modeled. |
| **CA SF / LA city** | 0 | NOT modeled. SF has no personal income tax; LA has business license tax only. |

**Total modeled localities: 45** (NYC + 24 MD + 10 OH + 10 IN). All but NYC use a flat rate; NYC uses brackets + credits.

---

## 4. Known coverage gaps — prioritized

Listed in rough customer-frequency order. The top of this list is what to ship next if a paid CPA partner asks.

### Highest priority

1. **PA local EIT** (C9 deferred — ~2,000 municipalities). Required to serve any PA CPA seriously.
2. **OH school district income tax** (C10 deferred — separate from OH city tax; ~615 districts).
3. **NYC Yonkers PIT add-on** — straightforward; ~16% of NY state tax.
4. **CA AMT** is modeled (G5); next-highest state-AMT need: NY, NJ, MN if a customer asks.
5. **Part-year residency per-income-item sourcing** (C11 — NY IT-203, CA 540NR Sched CA). Currently pro-rata day-count.

### Medium priority

6. **State AMT for NY, NJ, MN** (none modeled outside CA).
7. **NJ retirement-income exemption — refine the cap + phase-out** (currently approximate).
8. **IL dependent exemption** ($2,775/dep — modeled only for filers, not dependents — over-deduction max ~$137/filer).
9. **WI std-ded high-AGI phase-out** (currently uses max value).
10. **IL personal exemption $250k/$500k cliff** — modeled (E1).

### Low priority / deferred until asked

- HI / NJ partial retirement exemptions (partial coverage; sub-gaps documented in [stateTaxData.ts](../artifacts/api-server/src/lib/stateTaxData.ts))
- AL std ded phases out at higher AGI (currently uses max)
- AR complex bracket switching above $89,600 (currently simplified)
- VT dependent personal exemption + Sched IN-112 Part II Line 9 SS exclusion
- KY occupational tax
- NYC UBT
- MD personal exemption per dependent
- OH cross-city employment credit
- IN $1,000/filer personal exemption
- CT pension exemption gradual phase-out (currently approximated as fully-taxing — conservative)
- TN/NH have no wage tax but TN has Hall tax repealed 2021 (✓ correctly modeled as no-tax)

### Out of scope (Phase 4 Option A)

- Trust/estate (Form 1041), partnership (1065), S-corp (1120-S), C-corp (1120), estate/gift (706/709)
- E-filing (CPAs e-file via Lacerte/UltraTax/ProConnect/Drake — by Option A design)

---

## 5. How to extend coverage

**Adding a new state bracket / std ded:** edit [stateTaxData.ts](../artifacts/api-server/src/lib/stateTaxData.ts), add tests to `tax-engine-50state-tests.ts`, update this matrix.

**Adding a state credit (EITC/CTC):** add a `calculateStateXxxCredit()` in [taxCalculator.ts](../artifacts/api-server/src/lib/taxCalculator.ts) (mirror `calculateStateEitc` / `calculateStateCtc` patterns), wire into the credit-ordering block of `computeTaxReturnPure`, add hand-calc'd tests to `tax-engine-state-eitc-tests.ts` (or new file), update this matrix.

**Adding a new locality:** add an entry to `LOCAL_TAX_DATA` in [taxCalculator.ts:602](../artifacts/api-server/src/lib/taxCalculator.ts:602). For NYC-style bracketed locality, build a separate `calculateXxxLocalTax()`; for flat-rate, the existing dispatch handles it. Update `localityCodesForState()` if state-specific list, update the locality dropdown in `ClientForm.tsx`, update this matrix.

**Adding a new federal form / IRC section:** depends on whether it's a deduction, credit, or alternative tax. Mirror an existing pattern in `taxCalculator.ts` (e.g., `calculateNiit` for an alternative tax, `calculateChildTaxCredit` for a credit). Add hand-calc'd tests in `scripts/src/tax-engine-*.ts` (also add the new test file to `scripts/tsconfig.json` `exclude`). Update this matrix + CLAUDE.md test file list.

**Always** update this matrix when shipping a coverage change.
