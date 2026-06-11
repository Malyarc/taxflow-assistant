# Federal Engine Core — Independent Audit Findings (2026-06-11)

Subsystem: `artifacts/api-server/src/lib/taxCalculator.ts` + income/AGI/capital-gains portions of
`artifacts/api-server/src/lib/taxReturnEngine.ts`. All paths below are relative to
`/home/user/taxflow-assistant/`. Every HIGH finding was confirmed with a live repro
(`/tmp/audit-fed-core-repro.ts`, `/tmp/audit-fed-core-repro2.ts`, run via
`cd scripts && npx tsx /tmp/...`). Repo files were NOT modified.

Legend: severity per brief (CRITICAL/HIGH/MEDIUM/LOW). "Engine" = repo code; "Law" = primary source.

---

## FC-1 · HIGH (CRITICAL inside the §1250/28% feature) — §1(h) Schedule D Tax Worksheet: special-rate layers don't interleave with ordinary rates / 0% zone

**Files:** `artifacts/api-server/src/lib/taxCalculator.ts:6333-6385` (`calculateFederalTaxWithCapitalGains`,
the g25/g28 "flat 25%/28% + global final-min" model); same defect mirrored in the AMT Part III path
(`taxCalculator.ts:7216-7227`).

**Law (verbatim, confirmed via two independent sources):** IRC §1(h)(1):
- (A) ordinary-rate tax on **the greater of** (i) taxable income reduced by the *net capital gain*, or
  (ii) **the lesser of** (I) the amount of taxable income taxed at a rate below 25 percent
  [= top of the 24% bracket post-TCJA: $191,950 single / $383,900 MFJ for 2024 — the worksheet's
  "smaller of line 1 or $191,950" line], or (II) **taxable income reduced by the adjusted net capital
  gain** (ANCG = net cap gain minus the 28%-rate and unrecaptured-§1250 amounts).
- (B) 0% on so much of the ANCG as does not exceed the excess of the maximum-zero-rate amount **over
  the taxable income reduced by the ANCG** — i.e. the §1250/28% layers sit BELOW the ANCG in the
  stack and consume the 0% bracket space.
- (E)(ii) then reduces the 25%-rate amount by the excess of ((A)-amount + net capital gain) over
  taxable income — removing from the 25% bucket exactly the §1250 gain that (A)(ii) already taxed at
  ordinary rates.

**Engine:** stacks the 0/15/20 gain (`gNormal`) directly above ordinary income only
(`ltcgStackBase = ordinaryWithStcg`), taxes g25/g28 at flat 25%/28%, and relies solely on the global
`min(…, all-ordinary)` floor. The in-code comment (6364-6371) asserts "the statutory 'maximum rate' is
… enforced SOLELY by the final-line global floor" — that is wrong: §1(h)(1)(A)(ii) + (E)(ii) is an
*intermediate* interleaving mechanism the engine lacks.

**Live repro (single, TY2024, `unrecaptured1250Gain` populated):**

| Case | ordinary | LTCG (of which §1250) | Engine | Correct (§1(h)(1)(A)-(F) hand-calc) | Delta |
|---|---|---|---|---|---|
| A | 20,000 | 55,000 (25,000) | **8,864.25** | 9,364.25 | **−500.00 under-tax** |
| B | 0 | 50,000 (40,000) | **6,053.00** | 5,014.25 | **+1,038.75 over-tax** |
| C | 100,000 | 500,000 (300,000) | **122,053.00** | 121,123.00 | **+930.00 over-tax** |
| extra (live-verified) | 60,000 | 90,000 (50,000) | **26,753.00** | 25,442.50 | **+1,310.50 over-tax** |
| D control (no buckets) | 20,000 | 55,000 (0) | 6,364.25 | 6,364.25 | exact ✓ |

Error window: any return with a populated §1250/collectibles bucket where (ordinary + special layers)
≤ the 24%-bracket top, or where (taxable − ANCG) is below the 0%/15% breakpoints. That includes the
bread-and-butter "W-2 earner sells a depreciated rental" case (over-tax $1,310.50 in the live-verified
$60k-wages / $50k-§1250 / $40k-other-LTCG example) and the low-ordinary retiree case (under-tax). High-income cases (ordinary above the
24%-top) are exact — which is why the prior reviews' high-income spot checks passed.

**Note on tests:** `tax-engine-section1250-1231-tests.ts` (W8 etc.) pins the FLAT-25%+global-min
behavior; per this audit those expectations are themselves wrong in the mixed-layer geometry — the
exact wrong-expectation-test failure mode this repo has been burned by.

**Fix direction:** implement §1(h)(1)(A)(ii) (the lesser-of clamp with the 24%-bracket-top amount) and
(E)(ii) (reduce the 25% bucket by the portion absorbed into (A)); stack ANCG's 0%-zone measurement on
(taxable − ANCG) per (B)(ii). The 15%/20% split base is (A)+(B) amounts per (C)(ii)(II). Mirror in
`calculateAmt` Part III.

---

## FC-2 · HIGH — QSS uses MFJ thresholds for Social Security taxability (§86 / Pub 915)

**File:** `taxCalculator.ts:6645-6646` (`calculateSocialSecurityTaxability` — `isMfj` includes
`qualifying_widow`) → thresholds $32,000/$44,000.

**Law:** §86(c)(1): base amount $32,000 only for a **joint return**; a QSS return is not a §6013 joint
return → $25,000/$34,000. Pub 915 Worksheet 1 line 8: "single, head of household, **qualifying
surviving spouse**, or MFS-lived-apart → $25,000."

**Repro:** QSS, SS benefits $20,000, AGI-excl-SS $28,000 (provisional $38,000):
engine taxable SS = **$3,000** (T1/T2 = 32k/44k); correct = **$7,900** (0.85×4,000 + min(10,000,4,500)).
Under-taxes a widowed retiree — QSS + SS benefits is a core demographic of the status.

---

## FC-3 · HIGH — QSS Additional Medicare Tax threshold $250k instead of $200k (Form 8959)

**File:** `taxCalculator.ts:6749-6759` (`additionalMedicareThreshold` returns 250,000 for
`qualifying_widow`).

**Law:** §3101(b)(2): $250,000 only "in the case of a joint return"; "(C) in any other case,
$200,000". Form 8959 instructions threshold chart: "Single, Head of household, or **Qualifying
surviving spouse — $200,000**".

**Repro:** QSS, Medicare wages $300,000 → engine $450; correct $900 (0.9% × $100,000). Under-tax.
(Contrast: NIIT correctly keeps QSS at $250,000 — §1411(b) *explicitly* includes a §2(a) surviving
spouse; the two statutes genuinely differ, the engine treats them identically.)

---

## FC-4 · HIGH — QSS gets the MFJ student-loan-interest phase-out band (§221)

**File:** `taxCalculator.ts:4986-5008` (`SLI_PHASE_OUT` — `qualifying_widow` rows = MFJ band all 3 years).

**Law:** §221(b)(2)(B): the higher range applies "in the case of a joint return". Pub 970 Table 4-2
(2024): "single, head of household, or qualifying surviving spouse: $80,000–$95,000"; MFJ
$165,000–$195,000.

**Repro:** QSS, MAGI $150,000, paid $2,500 (TY2024) → engine deducts **$2,500**; correct **$0**
(fully phased out above $95k). Max tax impact ≈ $2,500 × marginal (~$600–$925). Wrong filed number,
narrow case.

---

## FC-5 · MEDIUM — Pub 915 provisional income wrongly reduced by the SLI deduction

**File:** `taxReturnEngine.ts:2775-2792` — `agiExcludingSs = totalIncomeProvisional −
aboveTheLineAdjustments`, where `aboveTheLineAdjustments` includes `sliDeduction`.

**Law:** Pub 915 Worksheet 1 line 6 / 1040-instructions SS worksheet: subtract Schedule 1 lines 11–20,
23, 25 — **line 21 (student loan interest) is excluded**, so SLI does NOT reduce provisional income.
The adjacent code comment even states this rule ("the Pub 915 worksheet line 6 intentionally excludes
SLI") but the code subtracts it anyway.

**Repro (pipeline):** single TY2024, 1099-R $30,000 + SS $20,000 + SLI $2,500:
engine taxable SS = **$7,475** (provisional 37,500); correct = **$9,600** (provisional 40,000).
Understates taxable income by up to 0.85 × $2,500 = $2,125 for SS-phase-in filers with student loans.

---

## FC-6 · MEDIUM — Capital-loss carryforward over-consumed when the $3,000 offset gave no benefit

**File:** `taxReturnEngine.ts:2399-2419` — the net-loss branch always burns the full $3,000/$1,500 cap
out of the carryforward.

**Law:** Schedule D instructions Capital Loss Carryover Worksheet lines 1–4 (Pub 550): the carryover
is reduced only by min(allowed loss, taxable income (computed allowing it to be negative) + allowed
loss). A filer whose taxable income is already ≤ 0 without the loss keeps the FULL loss as carryover.

**Repro (pipeline):** single TY2024, zero income, 1099-B ST loss $10,000: engine
`capitalLossCarryforwardShort` = **$7,000**; correct = **$10,000**. Permanently destroys up to $3,000
of carryforward per low-income year (this engine value feeds the next year's auto-load).

---

## FC-7 · MEDIUM — `useItemizedDeductions` decided against the base std ded, mis-keying AMT lines 2a/2g

**Files:** `taxReturnEngine.ts:2833-2843` (`stdDed` for the itemize decision excludes the §63(f)
aged/blind add-on) vs `taxCalculator.ts:2596-2599` (`runTaxCalculation` final deduction =
`max(itemized, base+add-on)`); consumed at `taxReturnEngine.ts:3191` (`autoSaltAddback`) and `:3220`
(`stdDeductionAddbackForAmt`).

**Defect:** when itemized total falls between the base std ded and base+add-on (aged/blind filers),
the flag says "itemizing" but the std deduction is actually used. AMT then adds back Schedule-A SALT
(line 2g) that was never deducted and omits the §56(b)(1)(E) std-ded addback (line 2a).

**Repro:** single age 70, TY2024, wages $300k, SALT $10,000 + mortgage $5,200 (itemized $15,200; std
$16,550 used), ISO pref $80,000 → engine AMTI **$373,450**; correct **$380,000** (taxable 283,450 +
ISO 80,000 + std 16,550). AMTI understated by $6,550 → AMT under-charged when binding.

---

## FC-8 · HIGH — QSS uses the MFJ EITC phase-out column (§32(b)(2)(B) / Pub 596)

**File:** `taxCalculator.ts:2898-2900` (`calculateEitc` maps `qualifying_widow` →
`married_filing_jointly` table).

**Law:** the §32(b)(2)(B) phase-out increase applies only to a **joint return**; Pub 596's table
groups "single, head of household, or qualifying surviving spouse" together. QSS (a widowed parent
with a dependent child — exactly the EITC demographic) must use the lower column.

**Repro:** QSS, 2 kids, earned $30,000 / AGI $58,000, TY2024 → engine EITC **$987.38**; correct
**$0** (single column completes at $55,768). Over-credit (refundable — direct refund inflation).

---

## FC-9 · MEDIUM — OBBBA Schedule 1-A: QSS treated as a joint return (senior threshold, overtime cap, tips/car-loan thresholds; deceased-spouse senior counted)

**File:** `taxCalculator.ts:7057-7071` (`calculateObbbaSchedule1ADeductions` — `isJoint` includes
`qualifying_widow`; spouse-age senior counted for QSS).

**Law:** §224(b)(2), §225, §163(h)(4), §151(d)(5) (as added by OBBBA) phrase every doubled
cap/threshold as "in the case of a joint return"; QSS is not one.

**Repros (TY2025):** QSS age-70, MAGI $100k → engine senior ded **$6,000**; correct **$4,500**
(6,000 − 6% × (100,000 − 75,000)). QSS overtime $20,000 → engine **$20,000**; correct **$12,500**
(non-joint cap). Also: a QSS with a stale spouse DOB on record would get a second $6,000 senior
deduction for the deceased spouse.

---

## FC-10 · MEDIUM — Educator-expense cap stale for TY2026: $300 vs the published $350

**File:** `taxCalculator.ts:4950` (`EDUCATOR_PER_FILER_CAP` = {2024: 300, 2025: 300, **2026: 300**}).

**Law:** Rev. Proc. 2025-32 (§62(a)(2)(D) adjustment): the 2026 educator expense limit rose to
**$350** (first increase since 2022). Repro: TY2026, $400 expenses, 1 educator → engine deducts $300;
correct $350. Under-deduction $50/educator ($100 for two-educator MFJ). (OBBBA's new TY2026 itemized
deduction for educator expenses beyond the cap is also unmodeled — see FC-14.)

---

## FC-11 · MEDIUM — QSS standard-deduction add-on counts the deceased spouse's age/blind boxes

**File:** `taxCalculator.ts:264-267` (`countStdDedAddOnBoxes` counts spouse boxes for
`married_filing_jointly` **or** `qualifying_widow`).

**Law:** Form 1040 age/blindness spouse checkboxes apply to MFJ (and MFS with a no-income spouse —
which the engine conservatively never counts); a QSS's spouse died in a *prior* year and cannot be 65
or blind "at the end of the tax year". Repro: QSS age 70 with stale `spouseAge: 70` → engine add-on
**$3,100**; correct **$1,550**. Data-gated (requires stale spouse fields, which widowed-client records
plausibly retain). The per-box *amount* for QSS (married rate, $1,550/1,600/1,650) is correct per
§63(f)(3).

---

## FC-12 · LOW — QSS honored for the spouse FEIE exclusion

**File:** `taxCalculator.ts:6581-6587` (`calculateFeie` — `isMfj` includes `qualifying_widow`, so a
`foreign_earned_income_spouse` adjustment excludes up to a second cap). A QSS has no spouse on the
return; a deceased spouse's final-year FEIE belongs on the year-of-death joint return. Repro: QSS
spouse FEIE $100,000 → engine excludes $100,000. Data-gated (requires the CPA to enter the spouse
adjustment on a QSS return).

---

## FC-13 · MEDIUM — Kiddie-tax unearned income omits 1099-R, rents/royalties, unemployment, taxable SS

**File:** `taxReturnEngine.ts:3113-3117` (`kiddieUnearnedIncome` = interest + dividends + net cap
gains only).

**Law:** Form 8615 line 1 / §1(g)(4): unearned income = ALL income other than earned income — incl.
taxable IRA/pension distributions (the post-SECURE inherited-IRA-to-minor 10-year-rule case is
common), rents, royalties, unemployment, taxable SS, taxable scholarships. A kiddie filer with a
$30k inherited-IRA distribution and no investment income currently has `unearnedIncome = 0` → kiddie
method never engages → under-tax at the child's brackets instead of the parent's rate.
Related documented simplifications (no separate finding): the parent-rate method uses a flat
client-supplied `parentsTopMarginalRate` instead of the Form 8615 parent-return recomputation, and the
parent-rate slice taxes embedded LTCG/QDIV at the ordinary parent rate (over-tax direction; noted in
code).

---

## FC-14 · MEDIUM — TY2026 OBBBA itemized-deduction regime changes not modeled

**File:** `taxCalculator.ts:2702-2777` (`calculateScheduleA`), engine-wide.

Missing for TY2026+ (all enacted by OBBBA, effective for tax years beginning after 12/31/2025):
1. **§170(p) 0.5%-of-AGI floor** on itemized charitable contributions (§70425) — engine over-deducts
   by 0.5% × AGI for every TY2026 itemizer with charity.
2. **§68-replacement 2/37 limitation** on itemized deductions for 37%-bracket taxpayers (§70111) —
   engine over-deducts ≈ 2/37 of the value of itemized deductions falling in the 37% bracket.
3. **Non-itemizer charitable deduction** ($1,000/$2,000, §70424) — engine under-deducts for TY2026
   standard-deduction filers with cash charity.
4. (Companion to FC-10) the new above-the-cap educator-expense itemized deduction.
TY2026 returns/projections are a supported, advertised year (`SUPPORTED_TAX_YEARS`), so these are
live deviations for 2026 planning numbers, not future-proofing.

---

## FC-15 · LOW — §461(l) TY2026 thresholds held at TY2025 although Rev. Proc. 2025-32 is published

**File:** `taxReturnEngine.ts:1439-1443` — 2026 row = $313k/$626k with comment "TY2026 not yet
published — held at TY2025." Rev. Proc. 2025-32 (Oct 2025) publishes the 2026 §461(l)(3)(B) amounts
(≈ $323k/$646k). Direction conservative (threshold too low → over-addback). Same stale-comment class:
`SE_OPTIONAL_METHOD` 2026 held at 2025 (`taxReturnEngine.ts:2096-2100`).

---

## FC-16 · LOW — IRA deduction omits the Pub 590-A $10 round-up and $200 minimum

**File:** `taxCalculator.ts:4520-4541` (`calculateRetirementDeductions` — pure linear phase-out).
Pub 590-A Worksheet 1-2 rounds the reduced limit UP to the next $10 and allows a $200 minimum while
any amount remains in the band. Engine under-deducts by ≤ $10 generally and by up to ~$200 near the
top of the band.

---

## FC-17 · LOW — No IRS Tax Table emulation below $100,000

`applyBrackets` computes exact formula tax at all income levels. Filed returns under $100,000 must use
the $25/$50-bracket Tax Table (midpoint), so engine values differ from the filed number by up to ~±$9.
Consistent with the file's documented "estimation" posture; flagged for completeness since the app
emits 1040-style PDFs.

---

## FC-18 · LOW — §63(c)(6)(A) MFS spouse-itemizes coupling not enforced in the core engine

An MFS filer whose spouse itemizes must take a $0 standard deduction. No client flag exists in
`computeTaxReturnPure`; only the T2.2 filing-status optimizer models the coupling. CPA-judgment gap.

---

# Verified CLEAN (re-derived against primary sources)

- **Ordinary brackets, all 3 years × all 5 statuses** (`FEDERAL_BRACKETS`, taxCalculator.ts:52-201):
  every breakpoint matches Rev. Proc. 2023-34 / 2024-40 / 2025-32, including the published
  asymmetries (2024 HoH $100,500/$243,700; 2025 HoH $250,500; 2026 HoH $201,750/$256,200; MFS 35%-top
  $365,600/$375,800/$384,350; QSS = MFJ). 2026 single bracket set independently re-confirmed online.
- **applyBrackets / stacked-LTCG math**: continuous at boundaries, no off-by-one; bracket-edge dollar
  taxed in the lower bracket (correct).
- **Standard deductions** 2024/2025-OBBBA/2026 ($14,600/29,200/21,900 · $15,750/31,500/23,625 ·
  $16,100/32,200/24,150); MFS=single, QSS=MFJ.
- **§63(f) aged/blind add-on amounts** ($1,950/1,550 · $2,000/1,600 · $2,050/1,650) including QSS
  correctly getting the *married* per-box amount (§63(f) higher amount only for "not married and not a
  surviving spouse"); MFJ spouse boxes counted; dependent + add-on combination (Pub 501 worksheet) correct.
- **§63(c)(5) dependent std ded**: floor $1,300/$1,350/$1,350, +$450 earned bump (all confirmed for
  2026 via Rev. Proc. 2025-32 reporting), capped at the regular std ded; wired through both the
  itemize decision and `runTaxCalculation` with `claimedAsDependent || isKiddieTaxFiler`.
- **AGI = 1040 Line 9**: LTCG/QDIV/STCG all flow into total income; `summarize1099s` keeps ordinary
  dividends = Box 1a − 1b so adding qualified separately does not double count; taxable SS folded into
  AGI; AGI floor at 0.
- **Above-the-line ordering** (taxReturnEngine.ts:2697-2776): educator → HSA (no AGI dependence) →
  half-SE → SEHI (cap = net SE − half-SE per §162(l)) → §179/bonus → IRA computed FIRST on a MAGI that
  excludes both IRA and SLI (+FEIE add-back) = exactly Pub 590-A Worksheet 1-1; then SLI MAGI = AGI
  without SLI, net of IRA, +FEIE = Pub 970 Worksheet 4-1. No circularity. (Single-pass interaction with
  taxable SS is a disclosed sub-gap in code; see FC-5 for the actual bug in this area.)
- **IRA limits & phase-outs**: $7,000/+1,000 (2024-25), $7,500/+1,100 (2026); covered bands
  77-87/123-143 · 79-89/126-146 · 81-91/129-149; spousal §219(g)(7) 230-240/236-246/242-252; MFS 0-10k.
  QSS = MFJ band is CORRECT here (Pub 590-A explicitly lists QSS with MFJ).
- **HSA limits** 4,150/8,300 · 4,300/8,550 · 4,400/8,750 +$1,000 55+; employer-contribution cap
  reduction + §4973(g) 6% excise.
- **SLI**: $2,500 max; MFS ineligible; bands 80-95/165-195 · 85-100/170-200 · 85-100/175-205 (2026
  single band held flat per Rev. Proc. 2025-32) — except the QSS row (FC-4).
- **Schedule D netting** (taxReturnEngine.ts:2367-2420): ST/LT cross-netting per Sch D lines 7/15/16;
  $3,000/$1,500-MFS ordinary offset; carryforward preserves character with the $3k consumed
  short-first (Pub 550 worksheet order) — except FC-6.
- **LTCG breakpoints all 3 years/5 statuses** incl. MFS 2024 $291,850 (IRS-rounded, not half-MFJ) and
  2025 MFS $300,000; 2026 set re-confirmed online ($49,450/$98,900/$66,200; $545,500/$613,700/$306,850).
- **QDCGT-worksheet behavior without special buckets** (control case D byte-exact); preferential base
  capped at taxable income (line-10 cap) with the signed-ordinary-portion convention; STCG stays in
  the ordinary stack; single call site passes `shortTermGains: 0` so the
  `max(0, ordinary)+max(0,stcg)` flooring hazard is unreachable.
- **§1250/28% loss-absorption order** upstream (taxReturnEngine.ts:3128-3158): losses erode the 28%
  bucket first, then §1250, bounded by surviving net LTCG; QDIV never consumed by special buckets —
  consistent with the 28%-Rate-Gain / Unrecaptured-§1250 worksheets. (The downstream *rate*
  computation is FC-1.)
- **Kiddie thresholds** $2,600/$2,700/$2,700 (= 2× dependent floor); Form 8615 line-18 MAX(regular,
  kiddie) shape; amount-at-parent-rate = min(net unearned, taxable) (line 5).
- **Pub 915 SS worksheet math** (50% zone min(half-excess, half-benefits); 85% zone 0.85×excess +
  min(half-benefits, half-band); MFS-lived-together min(85%×benefits, 85%×provisional); $25k/$34k vs
  $32k/$44k; tax-exempt interest included; IRA deduction included in line-6) — except FC-2/FC-5.
- **FEIE**: caps $126,500/$130,000/$132,900 (2026 confirmed against Rev. Proc. 2025-32 reporting);
  per-spouse caps MFJ; MFS spouse ignored; stacking rule tax(ord+FEIE)−tax(FEIE) per the Foreign
  Earned Income Tax Worksheet, LTCG stacked above ordinary+FEIE; NIIT MAGI FEIE add-back present.
- **SE tax**: 0.9235 factor, 12.4% to the shared SS wage base (168,600/176,100/184,500) less W-2 Box 3,
  2.9% uncapped, $400 floor (`<` semantics correct), church $108.28/$100 special floor, half-SE.
- **Additional Medicare**: wages-first threshold consumption per Form 8959 lines 4-8 (except FC-3 QSS).
- **NIIT**: $200k/$250k/$125k; QSS correctly $250k (§1411(b) includes a §2(a) surviving spouse).
- **CTC/ODC** core: $2,000/$2,200/$2,200 + $500 ODC; $200k/$400k-joint-only thresholds (QSS correctly
  $200k); ceil-to-$1,000 × $50; ACTC $1,700 cap + 15% over $2,500.
- **EITC tables 2024/2025/2026** (max credits 632/4,213/6,960/7,830 · 649/4,328/7,152/8,046 ·
  664/4,427/7,316/8,231; phase-out starts/completes; investment-income limits 11,600/11,950/12,200);
  HoH on the single column — except FC-8 (QSS column).
- **Saver's credit tiers** all 3 years incl. QSS = single column (Form 8880) and the MFS $2,000 cap.
- **§199A**: thresholds/bands 191,950+50k / 197,300+50k / 201,750+75k (OBBBA widened band), MFS=single
  per §199A(e)(2); 20%-of-(taxable − net capital gain) cap per §199A(e)(3) keyed on POST-NOL taxable;
  wage/UBIA max(50% W-2, 25%+2.5% UBIA) phase-in; $400 minimum (TY2026+, ≥$1,000 QBI); NOL 80% limit
  ordering (§172(a)(2) on pre-NOL base, QBI cap on post-NOL base).
- **getSaltCap**: $10k/$5k TY2024; OBBBA $40k/$20k TY2025, $40,400/$20,200 TY2026 with the 30%
  phase-down over $500k/$505k (halved MFS) to the $10k/$5k floor.
- **OBBBA Schedule 1-A caps/rates** (non-QSS): tips $25k @ −$100/$1k over 150k/300k; overtime
  12.5k/25k; car-loan $10k @ −$200/$1k over 100k/200k; senior $6k @ −6% over 75k/150k; TY2025-2028
  window; reduces taxable income not AGI; phase-outs implemented as smooth linear (statutory "for each
  $1,000" arguably ceils — ≤$100 difference; not flagged).
- **AMT data** (constants only — deeper AMT logic is another subsystem's scope): exemptions/phase-out
  starts/26-28% breakpoints for all 3 years incl. OBBBA TY2026 $500k/$1M starts + 50% phase-out rate +
  MFS §55(d)(3) clawback + halved MFS breakpoint.
- **§179/bonus/§448(c) year maps**: $1.22M/3.05M · $2.5M/4M · $2.56M/4.09M; bonus 60%/40%(+OBBBA
  100% post-1/19/25 channel)/100%; $30M/31M/32M.
- **Schedule A mechanics** (non-2026 portions): 7.5% medical floor; SALT income-or-sales + property
  under getSaltCap; charitable 60% cash + 30% property + 50% overall ceiling less cash; cash
  carryforward in/out.

# Repro artifacts

- `/tmp/audit-fed-core-repro.ts` — FC-1 (cases A-D), FC-2, FC-3, FC-4, FC-5, FC-6, FC-7.
- `/tmp/audit-fed-core-repro2.ts` — FC-8, FC-9/9b, FC-10, FC-11, FC-12.
- Sources used: IRC §1(h)(1)(A)/(B) text (confirmed verbatim via bradfordtaxinstitute/Cornell search
  snippets), Pub 915 Wksht 1, Pub 970 Table 4-2, Pub 596, Form 8959 instructions, §86(c)/§221/§32/§3101
  statutory "joint return" language, Rev. Proc. 2023-34 / 2024-40 / 2025-32 (2026 values re-confirmed
  via IRS newsroom + practitioner analyses: brackets, LTCG breakpoints, FEIE $132,900, dependent floor
  $1,350/+$450, aged/blind $2,050/$1,650, educator $350), OBBBA P.L. 119-21 §§70103-70120, 70424-70425,
  Pub 550 / Sch D Capital Loss Carryover Worksheet, Pub 590-A Wksht 1-1/1-2.
