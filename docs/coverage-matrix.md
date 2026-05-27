# TaxFlow Assistant — Coverage Matrix

**Status as of 2026-05-27 (Phase H sub-gap closure + C-batch v3 shipped).**
Inventory of what the calc engine models vs. what's not yet covered.
This is the source of truth for "do we handle X?".

**C-batch v3 (2026-05-27 PM)** — extends v2 with full top-10-state-credit
coverage + bulk PA EIT + bulk OH SDIT + per-K-1/rental sourcing:
- **C2** Expanded to 10 states (was NY/CA/IL): added MA (Senior Circuit
  Breaker / Dependent Member of Household / Limited Income Credit / Lead
  Paint Removal), NJ (Property Tax Credit / Child & Dependent Care /
  Senior-Disabled Property Tax Deduction), OH (Joint Filing Credit /
  Senior Citizen Credit), PA (Special Tax Forgiveness Sched SP / Working
  Family Tax Credit), VA (Low-Income Tax Credit / Credit for Tax Paid to
  Other State), GA (Low-Income Tax Credit / Retirement Income Exclusion /
  Disabled Person Home Purchase), MI (Homestead Property Tax Credit /
  Home Heating Credit). **24 new credits — 31 total state credits.**
- **C9** PA local EIT — bulk-loaded to **~175 PA municipalities** via
  `paEitRates.ts` + `scripts/data/pa-eit-rates.csv`. New `lookupPaLocalEit`
  function with PSD-code AND name-keyed access. Falls back to inline
  LOCAL_TAX_DATA top-13 as fast-path. Locality codes auto-listed in
  `localityCodesForState("PA")`.
- **C10** Ohio SDIT — bulk-loaded to **~226 OH school districts** via
  `ohSchoolDistricts.ts` + `scripts/data/oh-school-district-rates.csv`.
  Supports both `earned_income` and `traditional` bases per district.
  New `oh_traditional` base type in calculator (OH IT-1040 Line 3
  approximation). New `oh_sdit_traditional_base` adjustment for CPA-
  supplied exact value.
- **C11 deeper** Per-K-1, per-rental sourcing — `ScheduleK1Fact.sourceState`
  and `RentalPropertyFact.sourceState` fields added. New adjustment marker
  `part_year_use_full_source_allocation` (supersedes `part_year_use_w2_source`).
  When enabled, K-1 + rental net income flows to source state; intangibles
  still pro-rate to resident state by days (standard residency rule).

**C-batch v2 (2026-05-27 AM):**
- **C2** Top-state credits — Ship NY/CA/IL × 2-3 credits each via new
  `calculateStateAdditionalCredits` (7 credits, refundable + nonrefundable
  flowing through pipeline). NY Empire State Child Credit, NY Child &
  Dependent Care, NY College Tuition, CA Renter's Credit, CA Child &
  Dependent Care, IL Property Tax Credit, IL K-12 Education Expense.
- **C9** PA local EIT — 13 PA municipalities including Philadelphia,
  Pittsburgh, Allentown, Erie, Reading, Scranton + Act 32 default.
- **C10** Ohio School District Income Tax — 15 OH SDs with mix of
  earned-income + traditional bases.
- **C11** Per-state part-year residency — OPT-IN per-W-2-stateCode
  wage allocation (NY IT-203 / CA 540NR Sched CA pattern) via
  `part_year_use_w2_source` adjustment marker. Pure pro-rata default
  preserved.

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
| **Form 8606** (nondeductible IRA basis) | ✅ | H6 — Part I §408(d)(2) pro-rata (basis recovery on Roth conversion) + Part III (Roth distribution basis recovery per Treas. Reg. §1.408A-6 Q&A 8 — qualified-distribution shortcut + 10% §72(t) penalty under 59½). pdfkit substitute PDF. |
| **Form 4868** (extension) | ✅ | C8 — pdfkit substitute (Pub 1167); live JSON preview + PDF download |
| **Form 1040-X** (amended) | ✅ | C4 — snapshot-based diff (col a / b / c); Part III explanation textarea |
| **Form 8824** (§1031 like-kind) | partial | C5 — engine computes recognized/deferred from adjustment inputs; PDF deferred (sub-gap: no Form 8824 PDF builder yet) |
| **Form 8990** (§163(j)) | partial | C7 — engine computes 30%-of-ATI cap with indefinite carryforward; PDF deferred |
| **Form 461** (§461(l)) | partial | C7 — engine accepts CPA-supplied addback (loss-aggregation across Sched C/E/K-1 is the CPA's responsibility for now) |
| **Form 1041 / 1065 / 1120 / 1120-S** | ❌ | Out of scope (Phase 4 Option A) |
| **Form 706 / 709** | ❌ | Out of scope (estate/gift) |

### IRC sections explicitly modeled

§55-§59 (AMT, including K3 LTCG-preferential MIN, line 2g/2k), §72(t) (early-withdrawal penalty, E5), §85 (unemployment), §111 (1099-G tax-benefit rule, E6), §121 (home-sale exclusion, K6), §163(j) (C7 — 30%-of-ATI cap with indefinite carryforward), §168(k) (bonus depreciation, E7), §170 (charitable + §170(d)(1) 5-year cf, E3), §172 (NOL + post-TCJA 80% limit, K4), §179 (E7), §199A (simplified 20%; **no wage/UBIA cap, no SSTB**), §408(d)(2) (backdoor Roth pro-rata) ❌, §409A (NQDC) ❌, §421(b)/§422 (C6 — ISO disqualifying disposition ordinary comp), §423 (C6 — ESPP disqualifying disposition ordinary comp), §461(l) (C7 — CPA-supplied addback), §469 (PAL — rental bucket + K-1 bucket separate, $25k allowance + REP exception), §1031 (C5 — like-kind exchange recognized/deferred gain), §1091 + §1091(d) basis adjustment (wash sale + E13 auto-detection), §1202 (QSBS, assumes 100% post-2010-09-27), §1211/§1212 (cap-loss limit + $3k offset + carryforward), §1374 ❌, §1411 (NIIT — sub-gap: §121/§1031 recognized gains don't yet flow into NIIT investment-income base), §911 (FEIE, K9), §4973(g) (HSA excess excise, E4)

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

<!-- Form 8606 shipped 2026-05-27 (H6 Part I + Part III) — line above. -->
- §1202 sub-multipliers for pre-2010-09-27 acquisitions (75% / 50%)
- §1091(d) auto-flip ST→LT on wash-sale replacement (covered as a sub-gap in the deep audit; partial wash NOT modeled either)
- AMT line 2i MACRS-vs-ADS depreciation diff; line 2e state-refund recapture; AMT NOL
- K-1 §199A wage/UBIA limits + SSTB phase-out (engine applies flat 20%)
- K-1 guaranteed payments (Box 4)
- K-1 basis / at-risk limits (stored but not enforced)
- Carryforwards modeled: NOL, AMT credit, charitable cash, capital-loss ST/LT, §469 PAL (rental + K-1 separate), §163(j) disallowed business interest (C7, indefinite). **Not modeled:** SEHI cf, FTC cf
- Treaty positions; sourcing for FTC by category
- **§1031 / §121 recognized gains don't flow into NIIT investment-income base** (sub-gap; consistent with the existing §121 pattern). Fix requires NIIT-base refactor.
- **§163(j) ATI proxy** ≈ pre-§163(j) ordinary income (not the strict §163(j)(8) "taxable income without §163(j)/NOL/QBI + depreciation addback" — over-restricts the allowance for high-depreciation low-income filers).
- **§461(l) loss-aggregation** is CPA-supplied (engine doesn't auto-aggregate across Sched C / E / K-1 buckets to compute the excess).
- **Form 8824 PDF** for §1031 reporting deferred; **Form 8990 PDF** for §163(j) deferred. CPAs hand-file these forms.

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

**C2 v3 — Additional state credits beyond EITC/CTC/AMT columns** (computed via `calculateStateAdditionalCredits`):

| State | Credits | Form / Statute |
|---|---|---|
| NY | Empire State Child Credit / Child & Dependent Care / College Tuition | IT-213, IT-216, IT-272 |
| CA | Nonrefundable Renter's Credit / Child & Dependent Care | Form 540 Line 46, Form 3506 |
| IL | Property Tax Credit / K-12 Education Expense | Schedule ICR |
| MA | Senior Circuit Breaker / Dependent Member of Household / Limited Income Credit / Lead Paint Removal | Schedule CB, M.G.L. c.62 §6(x)/§6(e), Schedule NTS-L |
| NJ | Property Tax Credit / Child & Dependent Care / Senior-Disabled Property Tax Deduction | NJ-1040 L56, NJ-CDCC, N.J.S.A. 54:4-8.41 |
| OH | Joint Filing Credit / Senior Citizen Credit | R.C. 5747.05 |
| PA | Special Tax Forgiveness / Working Family Tax Credit | Schedule SP, Act 64 of 2024 (WFC via state-EITC piggyback) |
| VA | Low-Income Tax Credit / Credit for Tax Paid to Other State | Sched ADJ L17, Va. Code §58.1-332 (computed via multi-state credit path) |
| GA | Low-Income Tax Credit / Retirement Income Exclusion / Disabled Person Home Purchase | O.C.G.A. §48-7-29.18, §48-7-27(a)(5), §48-7-29.1 |
| MI | Homestead Property Tax Credit / Home Heating Credit | MI-1040CR, MI-1040CR-7 |

Total: **31 state-additional credits** across 10 states. Per-credit hand-calc tests in `tax-engine-c2-state-credits-tests.ts` and `tax-engine-c2-state-credits-v2-tests.ts`.

---

## 3. Local income tax coverage

Modeled in `LOCAL_TAX_DATA` ([taxCalculator.ts:602](../artifacts/api-server/src/lib/taxCalculator.ts:602)):

| Locality bundle | Count | Detail |
|---|---|---|
| **NYC PIT** | 1 | Full bracketed PIT (4 brackets per status) + IT-201 line 48 household credit. NYC School Tax Credit (E8) + MCTMT (E8 tiered SE tax) modeled. NYC EITC sliding scale (G1) modeled. |
| **Yonkers** | 0 | NOT modeled. NY income tax has Yonkers as a flat % of state liability — sub-gap. |
| **MD counties** | 24 | All 23 counties + Baltimore City. Rates 2.25% (Talbot) to 3.20% (Baltimore City + 11 others). Base = state taxable income. |
| **OH cities** | 10 | Akron, Canton, Cincinnati, Cleveland, Columbus, Dayton, Lakewood, Parma, Toledo, Youngstown. Base = wages_only. **Cross-city employment credit NOT modeled** — sub-gap. |
| **OH school districts (SDIT)** | ~226 | C10 v3 (2026-05-27): bulk-loaded via `ohSchoolDistricts.ts` + CSV. Both `earned_income` (wages-only) and `traditional` (OH IT-1040 Line 3 approximation) bases supported. Inline top-15 fast-path preserved. New `oh_sdit_traditional_base` adjustment for CPA-supplied exact value. |
| **IN counties** | 10 | Allen, Elkhart, Hamilton, Lake, Marion, Monroe, Porter, St. Joseph, Tippecanoe, Vanderburgh. Rates 0.50% – 2.035%. Base = state taxable income. |
| **PA local EIT** | ~175 | C9 v3 (2026-05-27): top municipalities + Act 32 default. Loaded via `paEitRates.ts` bulk registry + CSV. Lookup by PSD code or name. Inline top-13 fast-path preserved. |
| **NYC UBT** | 0 | NOT modeled. Separate tax on unincorporated business income. |
| **KY occupational tax** | 0 | NOT modeled. |
| **CA SF / LA city** | 0 | NOT modeled. SF has no personal income tax; LA has business license tax only. |

**Total modeled localities: ~446** (NYC + 24 MD + 10 OH cities + 10 IN + ~175 PA EIT + ~226 OH SDIT). All but NYC use a flat rate; NYC uses brackets + credits.

---

## 4. Known coverage gaps — prioritized

Listed in rough customer-frequency order. The top of this list is what to ship next if a paid CPA partner asks.

### Highest priority

1. ~~**PA local EIT** (C9)~~ — **SHIPPED 2026-05-27 v3 — ~175 municipalities loaded via bulk registry.**
2. ~~**OH school district income tax** (C10)~~ — **SHIPPED 2026-05-27 v3 — ~226 districts loaded.**
3. **NYC Yonkers PIT add-on** — straightforward; ~16% of NY state tax.
4. **CA AMT** is modeled (G5); next-highest state-AMT need: NY, NJ, MN if a customer asks.
5. ~~**Part-year residency per-income-item sourcing** (C11)~~ — **SHIPPED 2026-05-27 v3 — K-1 + rental source-state allocation via `part_year_use_full_source_allocation` adjustment.** Intangibles still pro-rate to resident-state by days (standard rule).

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
