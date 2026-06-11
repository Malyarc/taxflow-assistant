# Federal Credits Audit — TaxFlow Assistant (2026-06-11, independent fresh audit)

Subsystem: federal credit computation + ordering.
Files: `artifacts/api-server/src/lib/taxReturnEngine.ts` (engine, "TRE"), `artifacts/api-server/src/lib/taxCalculator.ts` ("TC").
Method: re-derived every constant against IRS primary sources; live repros via `computeTaxReturnPure` / direct calculator calls
(`/tmp/fed-credits-repro.ts`, `/tmp/fed-credits-repro2.ts`, `/tmp/fed-credits-repro3.ts`, run with
`cd /home/user/taxflow-assistant/scripts && npx tsx <script>`). All repro outputs reproduced below verbatim.

Severity: CRITICAL = wrong filed number, common case · HIGH = wrong, narrower · MEDIUM = edge · LOW = cosmetic/documented.

---

## FC-01 · CRITICAL · TY2026 PTC still uses the expired ARPA/IRA schedule (no 400% cliff, 0% under 150% FPL)

**Where:** TC:5248-5256 (`getApplicableFigure` — takes no tax year), used by `calculatePremiumTaxCredit` (TC:5278+).

**Law:** The ARPA §9661 enhanced applicable-percentage schedule, extended by IRA §12001, **expired for taxable years beginning after 2025**. For TY2026, §36B reverts to the original structure per **Rev. Proc. 2025-25**: applicable percentages 2.10% (<133% FPL) rising to 9.96% (300–400% FPL), and the **400%-FPL eligibility cliff returns** (household income ≥ 400% FPL → PTC = $0 and no repayment limitation). Confirmed by web search 2026-06-11 (Rev. Proc. 2025-25; CRS R48290 "Enhanced Premium Tax Credit and 2026 Exchange Premiums"); no extension enacted per available sources.

**Code:** the single ARPA curve (0% < 150%, top 8.5%, no cliff) is applied for every supported year including 2026.

**Repro (R9):**
```
447% FPL: engine computedPtc = 3050.00 (correct TY2026: 0.00)
140% FPL: engine applicableFigure = 0.0000 (correct TY2026 ≈ 0.0359 per Rev. Proc. 2025-25)
```
Every TY2026 marketplace client is wrong: above 400% FPL the engine invents a PTC (and caps APTC clawback at the Table-5 amount via the <400% tiers when fplFraction < 4); below 150% it over-subsidizes vs the 2.10–4.19% required contribution.

**Fix shape:** year-index `getApplicableFigure` (2024/2025 = ARPA curve; 2026 = Rev. Proc. 2025-25 table + hard ineligibility ≥ 400% FPL).

---

## FC-02 · HIGH (CRITICAL for TY2026 filings) · TY2026 §25C/§25D credits still allowed — OBBBA terminated both after 2025-12-31

**Where:** TC:5161-5210 (`calculateResidentialEnergyCredits` — **no `taxYear` parameter at all**); TRE:3698-3714 applies the results for any year.

**Law:** OBBBA (P.L. 119-21, §§70505–70506): §25C terminates for **property placed in service after 12/31/2025**; §25D terminates for **expenditures made after 12/31/2025** (§25D(h); installation-completion rule §25D(e)(8)(A)). Confirmed via IRS OBBB FAQ ("FAQs for modification of sections 25C, 25D, 25E, 30C, 30D…") + Cornell LII §25D text. Also §30C (EV charger, Form 8911) terminates for property placed in service **after 6/30/2026** — a TY2026 §30C credit is only valid for H1-2026 installs; the engine allows it year-round with no date input.

**Repro (R10):**
```
TY2026 engine §25D credit = 6000.00 / §25C = 1200.00 (correct: 0.00 / 0.00 — OBBBA §§70505-70506)
totalNonRefundableApplied = 7200.00
```
Note the planning catalog already encodes these sunsets (G1.33/34/37 validUntil 2025) — the **core engine** was never updated.

---

## FC-03 · HIGH · EITC §32(a)(2) limitation mis-implemented — phase-out subtracted from the phase-in amount instead of the maximum credit

**Where:** TC:2904-2923 (`calculateEitc`).

**Law:** §32(a)(2): the credit (credit% × earned income up to the earned-income amount) "shall not exceed the excess of (A) **the credit percentage of the earned income amount** [= the max credit], over (B) the phaseout percentage of so much of AGI (or, if greater, earned income) as exceeds the phaseout amount." I.e. credit = **min(phase-in value, maxCredit − reduction)**. The 1040-instruction EIC Worksheet implements this as: look up table value at earned income; if AGI ≥ threshold, also look up at AGI; take the **smaller** of the two lookups.

**Code:** `appliedCredit = max(0, preliminary − reduction)` where `preliminary` is the earned-income phase-in value — the reduction is taken off the wrong base. Whenever earned income is still on the phase-in slope (< `maxAtIncome`) but max(AGI, earned) is past the phase-out start (unearned income: unemployment, pensions, taxable SS, spouse income…), the engine **under-credits**.

**Repro (R1):** single, 1 QC, earned $10,000, AGI $25,000, TY2024. Correct = min($3,400, $4,213 − 0.1598×$2,280 = $3,848.66) = **$3,400.00**.
```
engine appliedCredit = 3035.66 (correct: 3400.00)
```

---

## FC-04 · HIGH · QSS dependent-care credit zeroed out (treated as MFJ requiring spouse earned income)

**Where:** TC:4694-4698 (`calculateDependentCareCredit`: `filingStatus === "qualifying_widow"` → `earnedIncomeLimit = min(taxpayer, spouse ?? 0)`); TRE:3648-3659 (call site passes `spouseEarnedIncome = client.spouseEarnedIncome ?? 0` for QSS).

**Law:** Form 2441 line 5: "If married filing **jointly**, enter your spouse's earned income; **all others, enter the amount from line 4** [your own earned income]." A qualifying surviving spouse has no current-year spouse; §21(d)(2)'s two-earner rule applies to married couples only.

**Repro (R2):** QSS, 2 kids in care, $6,000 expenses, $50k earned → correct $6,000 × 20% = $1,200.
```
engine appliedCredit = 0.00 (correct: 1200.00), earnedIncomeLimit=0
engine e2e dependentCareCredit.appliedCredit = 0.00 (correct: 1200.00)
```
Under-credit (denies the whole credit) for every QSS client with care expenses.

---

## FC-05 · HIGH · QSS EITC uses the MFJ phase-out column — should use the single/HoH/QSS column

**Where:** TC:2898-2900 (`status = MFJ if filingStatus ∈ {married_filing_jointly, qualifying_widow}`).

**Law:** §32(b)(2)(B) increases the phase-out amounts only "in the case of a **joint return**." A QSS return is not a joint return. The EIC Table columns are "Single, head of household, or **qualifying surviving spouse**" vs "Married filing jointly" (Pub 596 / 1040 instructions; confirmed by web search).

**Repro (R3):** QSS, 2 QC, earned = AGI = $58,000, TY2024. Single column phase-out completes at $55,768 → correct **$0**.
```
engine appliedCredit = 987.38 (correct: 0.00 — single-column phase-out complete $55,768)
```
Over-credit (refundable) up to ≈$1,457 for TY2024 2-QC QSS filers in the $29,640–$62,688 band — exactly the widowed-parent population QSS exists for.

---

## FC-06 · HIGH · QSS education credits get the MFJ MAGI band ($160k–$180k) — Form 8863 gives QSS the $80k–$90k band

**Where:** TC:4362-4363 (`isMfj = MFJ || qualifying_widow` → `EDUCATION_PHASE_OUT_MFJ`).

**Law:** §25A(d)(2)/(i)(4): the $160,000 limit applies to a **joint return**; Form 8863 instructions: MAGI limit "$180,000 if married filing jointly; $90,000 if single, head of household, or **qualifying surviving spouse**."

**Repro (R4):** QSS, MAGI $120,000, one AOC student $4,000 expenses:
```
engine aocApplied = 2500.00 (correct: 0.00 — QSS MAGI $120k > $90k limit)
```
Over-credit incl. $1,000 refundable AOC. Same `isMfj`-includes-QSS pattern also gives QSS the $600 §904(j) FTC simplified limit (LOW, see FC-19). Contrast: Form 8880/saver's QSS treatment was already fixed (PLAN-01) — the same review never reached §21/§32/§25A/§904(j).

---

## FC-07 · HIGH · §53(c) AMT-credit limit not reduced by other nonrefundable credits

**Where:** TRE:3764-3771: `amtCreditApplicable = max(0, regularFederalTax − amt.amtBeforeRegular)`; applied = `min(carryforwardIn, amtCreditApplicable, availableForNonRefundable)`.

**Law:** §53(c): the credit cannot exceed "(1) the regular tax liability **reduced by the sum of the credits allowable under subparts A, B, D, E, and F**, over (2) the tentative minimum tax." Form 8801 line 21 nets the other credits out of regular tax before the TMT comparison. The engine compares gross regular tax to TMT, so the TMT floor is under-respected by exactly the other credits applied.

**Repro (R5):** single FL TY2024, $120k wages (regular $18,338.50; TMT = 26%×($120,000−$85,700) = $8,918), 2 kids (CTC $4,000), `amt_credit_carryforward` $20,000. Correct limit = ($18,338.50 − $4,000) − $8,918 = **$5,420.50**.
```
engine amtCreditApplied = 9420.50 (correct §53(c): 4542.00*) [*corrected hand-calc: 5420.50 — over-allowed by exactly the $4,000 CTC]
```
Over-credit = min(other credits applied, carryforward headroom). Requires a CPA-entered `amt_credit_carryforward` + other credits + TMT < regular — the standard Form 8801 population.
**Note (ordering):** §53(c) also nets out **subpart D (§38 GBC)** — i.e. §53 sequences AFTER the GBC; the engine applies §53 before §38 (TRE:3752 before 3778). Secondary effect (changes carryforward attribution between two carryforwardable credits).

---

## FC-08 · HIGH · §38(c) general-business-credit limit computed on gross income tax, not "net income tax"

**Where:** TRE:3796-3800: `section38Limit = incomeTaxOnly − max(TMT, 0.25 × (incomeTaxOnly − 25,000))` with `incomeTaxOnly = regular + AMT` **before** any credits.

**Law:** §38(c)(1): limit = **net income tax** − greater of (TMT, 25% of **net regular tax liability** over $25,000), where "net income tax" = regular + AMT **reduced by the subpart A & B credits** (Form 3800 Part II lines 10-11 subtract the personal credits and FTC), and "net regular tax liability" = regular tax (no AMT) less those credits.

Two defects: (a) the TMT prong isn't reduced by personal credits → **over-allows** GBC (the `min(…, availableForNonRefundable)` guard does not catch it when TMT binds); (b) the 25% prong includes AMT and isn't reduced by credits → over-states the floor → conservative direction. (Also un-modeled: $12,500 MFS substitution in §38(c)(6)(B) — LOW.)

**Repro (R12):** same $120k/2-kid fixture + `wotc_credit` $20,000. Correct = ($18,338.50 − $4,000) − max($8,918, 0) = **$5,420.50**.
```
engine otherGeneralBusinessCreditApplied = 9420.50 (correct §38(c): 5420.50)
```
Over-credit by exactly the personal credits ($4,000). Same root cause as FC-07: TMT-floored limits never see previously-applied credits.

---

## FC-09 · HIGH · Excess-APTC repayment excluded from the nonrefundable-credit base (Form 1040 line 18 includes Schedule 2 line 2)

**Where:** TRE:3610-3611 (`incomeTaxOnly = regularFederalTax + amt.amtTax` seeds `availableForNonRefundable`); TRE:3919 adds `excessAdvanceAptcOwed` to the liability **after** all credits.

**Law:** Form 1040 line 17 = Schedule 2 line 3 = AMT (line 1) **+ excess APTC repayment (line 2)**; line 18 = 16 + 17. Every nonrefundable-credit limit worksheet (Form 2441, 8863, 8880, 5695, 8839, Sch 8812 CLW-A, Form 3800) starts from **line 18**. Statutorily, §36B(f)(2)(A) treats the repayment as an increase in the chapter-1 tax, and it is not in the §26(b)(2) exclusion list — so personal credits offset it.

**Repro (R6):** single FL TY2024, wages $14,000 (income tax $0), 1 other dependent (ODC $500), APTC $10,000 vs computed PTC $4,000 → repayment capped at $375 (<200% FPL). Correct: line 18 = $375 → ODC absorbs it → owes $0 (refund = EITC $351.25).
```
repaymentCap=375, netPtc=-375.00
engine ODC applied = 0.00 (correct: 375.00)
engine federalRefundOrOwed = -23.75 (correct: 0.00)
```
Over-collects from any filer whose nonrefundable credits exceed regular+AMT but who owes an APTC clawback (SE + marketplace + kids is a common profile).

---

## FC-10 · HIGH · Form 8962 Table 5 repayment-limitation column mapping wrong for MFS (uncapped) and HoH (half caps)

**Where:** TC:5290-5307 (MFS branch: `repaymentCap: Infinity`, `netPtc = −advanceAptc`); TC:5341-5352 (`isMfj = MFJ||QSS → capMfj`, everyone else → `capSingle`).

**Law:** §36B(f)(2)(B): the applicable dollar amount is **halved only for §1(c) (single) taxpayers**. Form 8962 Table 5 columns: "Single" vs "**All other filing statuses**" — HoH, MFS, QSS, MFJ all use the full column. And the MFS rule, per the official 8962 instructions (verified via IRS instruction text, Part 3): "If you were married at the end of [the year] but are filing separately from your spouse, **the repayment limitations shown in Table 5 apply to you and your spouse separately** based on the household income reported on each return." MFS loses the PTC, not the repayment cap (when household income < 400% FPL).

**Repro (R8):** premium/SLCSP $4,000, APTC $8,000, MAGI $30,000 (206% FPL), household 1, TY2024 (correct cap $1,950):
```
MFS: engine netPtc = -8000.00 (correct: −1950.00 — repayment limited)
HoH: engine netPtc = -975.00 (correct: −1950.00; engine cap=975)
```
MFS: over-collects $6,050 in this fixture. HoH: under-collects $975 (filed-number wrong in the IRS's favor and the taxpayer's favor respectively).

---

## FC-11 · HIGH · §25D applied BEFORE the CTC — Schedule 8812 Credit Limit Worksheet excludes §25D (Sch 3 line 5a)

**Where:** TRE:3698-3714 (all four energy credits, incl. `cleanEnergyApplied` = §25D, reduce `availableForNonRefundable`) before TRE:3741-3750 (CTC with `taxBeforeCredit = availableForNonRefundable`).

**Law:** Schedule 8812 Credit Limit Worksheet A line 2 (2024: "Schedule 3, lines 1–4, **5b**, 6c, 6g, 6h"; 2025 version equivalently lists Form 5695 **line 30** = §25C Part II) — the §25C credit is subtracted before the CTC, but the **§25D residential clean energy credit (line 5a / Form 5695 line 15) is NOT**. §25D's own credit-limit worksheet subtracts 1040 **line 19 (the CTC)**, i.e. §25D sequences after the CTC, with its excess carried forward under §25D(c).

**Effect:** when tax is tight, the engine lets §25D eat the tax first, shrinking the CTC's nonrefundable slice and inflating the refundable ACTC spill — converting a carryforward-only credit into current refundable cash, and over-stating the year's refund.

**Repro (R7):** HoH FL TY2024, $50k wages (tax $3,041), 2 kids, $10,000 solar (§25D $3,000). IRS: CTC nonref $3,041 + ACTC $959; §25D applied $0, $3,000 carries forward.
```
engine CTC nonref = 41.00 (IRS: 3041.00)
engine ACTC = 3400.00 (IRS: 959.00)
engine §25D applied = 3000.00 → all consumed pre-CTC; IRS: 0 applied + 3,000 carryforward
```
Current-year over-refund $2,441 in this fixture. **Related sub-gap:** the engine has **no §25D carryforward tracking at all** (`calculateResidentialEnergyCredits` and the outputs expose no carryforward) — when tax room runs out, unused §25D silently vanishes instead of rolling forward.

---

## FC-12 · MEDIUM · EITC eligibility gates missing

**Where:** TC:2865-2932 + TRE:3826-3844.
1. **Form 2555/FEIE bar** (Pub 596 Rule 6; §32 via Form 2555 disqualification): a filer claiming the foreign earned income exclusion cannot claim EITC. Engine has `feieExclusion` in scope and ignores it. **Repro (R13):** single, 2 QC, $30k US wages + $30k excluded foreign income:
```
AGI = 30000.00, engine EITC = 5426.83 (correct: 0.00)
```
(Secondary: the engine's EITC earned income also omits the excluded foreign earned income from `earnedIncomeHousehold`, which would have pushed the phase-out base to $60k.)
2. **Age 25–64 requirement** for 0-QC claimants (§32(c)(1)(A)(ii)(II)): not checked even though `client.taxpayerAge` exists (it is used by state credits at TRE:4000). A 70-year-old or a 22-year-old with low wages gets the childless EITC.
3. **Disqualified income over-inclusion:** `totalInvestmentIncomeForNiit` (the §1411 base) is reused for §32(i); the NIIT base includes **annuity income**, which §32(i)(2) does not count → possible false disqualification at the $11,600/$11,950/$12,200 cliff (taxpayer-unfavorable edge).
4. MFS separated-spouse exception (ARPA §32(d)(2)) documented-not-modeled — conservative, acceptable (INFO).

---

## FC-13 · MEDIUM · ACTC Part II-B (3+ qualifying children) alternative formula missing

**Where:** TC:7326-7329 (`refundableActc = min(unused, 1700×QC, 15%×(earned−2500))`).

**Law:** Schedule 8812 Part II-B (lines 18b–25): with **3+ qualifying children**, the refundable floor is the **larger** of the 15% formula and (SS/Medicare taxes withheld + ½ SE tax + Addl Medicare/RRTA − EIC − excess-SS credit). Engine has W-2 box data and SE tax available but only implements the 15% path → under-credits large families with low earned income but payroll/SE taxes (e.g., 3 kids, earned $12,000, high SE tax).

---

## FC-14 · MEDIUM · §911 FEIE MAGI add-back missing for CTC (§24(b)(1)), education (§25A), saver's (§25B(e))

**Where:** TRE:3744 (`agi: calc.adjustedGrossIncome` → CTC), TRE:3676 (education), TRE:3691 (saver's). Engine AGI properly *excludes* FEIE (TRE:2653-2656), and the add-back is correctly done for NIIT (TRE:3305), IRA MAGI (TRE:2743), SLI (TRE:2766), and adoption (TRE:3727) — but not these three credits, whose statutes use the same AGI-plus-§911/§931/§933 MAGI.

**Repro (R15b):** MFJ, $350k US wages + $120k FEIE-excluded → AGI $350k, MAGI $470k. §24(b): reduction $3,500 → CTC = $500.
```
engine CTC total = 4000.00, phaseOutReduction = 0.00 (correct: 500.00 credit / 3,500 reduction)
```
Expat-only population → MEDIUM. (Education/saver's same direction: phase-outs evaded by the exclusion.)

---

## FC-15 · MEDIUM · Saver's credit §25B(c)/(d) eligibility gates missing

**Where:** TC:4614-4643 + TRE:3686-3696. §25B(c)(2): a **dependent** (and a full-time student) is ineligible; the engine's `client.claimedAsDependent` (used for the §63(c)(5) std ded at TRE:2833) is not consulted. §25B(d)(2) testing-period **distribution reduction** also unmodeled (no input).

**Repro (R14):** single dependent filer, $20k wages, $2,000 IRA:
```
engine saversCredit.appliedCredit = 1000.00, totalNonRefundableApplied = 340.00 (correct savers: 0.00 — §25B(c)(2) dependent ineligible)
```

---

## FC-16 · MEDIUM · Form 1116 limit uses regular tax + AMT as the pre-credit tax

**Where:** TRE:3633-3637 (`preCreditUsTax: incomeTaxOnly` = regular + AMT); TC:5115-5135 (limit = foreign-TI/total-TI × preCreditUsTax).

**Law:** Form 1116 line 20 is the **regular** income tax (1040 line 16 + certain Sch 2 recapture items) — AMT is not in the §904 limit; the AMT-side FTC has its own AMT Form 1116 (§59(a)) with a 90%-era-free but separately-computed limit. Including AMT inflates the regular §904 limit whenever AMT > 0 → over-credits. Also un-modeled: the line-18 qualified-dividend/LTCG rate-differential adjustment (documented simplification).

---

## FC-17 · MEDIUM (documented) · FTC "approximate" path grants the full foreign tax with no §904 limit

**Where:** TC:5137-5147 (path 3): foreign tax above $300/$600 with no `foreign_source_taxable_income` adjustment → `credit = amount` with only a flag. A CPA who enters `foreign_tax_paid` $50,000 and forgets the companion adjustment gets a full, unlimited credit. Self-documented in code, but it is a silent wrong number on the return, not just a flag.

---

## FC-18 · MEDIUM-LOW · Refundable AOC not denied to kiddie-tax-subject filers

**Where:** TC:4384 (`aocRefundable = aocApplied × 0.40` unconditionally); TRE:3675-3682 + 3912.
**Law:** §25A(i)(5)/Form 8863 line 7: a taxpayer under 24 meeting the §1(g)(2) conditions gets **no refundable** AOC (all nonrefundable). Engine has `client.isKiddieTaxFiler` and doesn't consult it.

---

## FC-19 · LOW · QSS gets the $600 §904(j) simplified FTC limit

**Where:** TC:5094-5097. §904(j)(3)(B): $600 applies to a **joint return**; QSS should be $300. Taxpayer-favorable ≤ $300 (lets up to $600 bypass the Form 1116 limit). Same QSS-as-MFJ pattern as FC-04/05/06.

## FC-20 · LOW · §30C personal-use TMT limitation not modeled

Form 8911 limits the personal-use credit to net regular tax over TMT (the credit cannot offset AMT); engine treats it as an ordinary Sch-3 credit against regular+AMT (TRE:3711). Also census-tract eligibility assumed (documented).

## FC-21 · LOW (documented) · §53(b) AMT-credit generation = full AMT including exclusion items

TRE:3772: `amtCreditGenerated = amt.amtTax` — Form 8801 only regenerates **deferral-item** AMT; exclusion items (SALT addback, std ded) generate no credit. Code comment documents this + CPA override; flagged because the default (auto-carryforward of the full AMT) overstates next year's credit for the std-ded/SALT-driven AMT that dominates this engine's AMT population.

## FC-22 · MEDIUM-LOW · PTC granted below 100% FPL

TC:5250 (`fplFraction < 1.50 → 0`): no §36B(c)(1)(A) 100%-FPL eligibility floor. Correct only in the §1.36B-2(b)(6) APTC-was-advanced case; a no-APTC claim below 100% FPL should be $0 (and for TY2026 the floor matters at the 2.10% band edge).

## FC-23 · MEDIUM · PTC MAGI is plain AGI — missing §36B(d)(2)(B) add-backs

TRE:3890 (`modifiedAgi: calc.adjustedGrossIncome`): household income must add back **tax-exempt interest, the nontaxable portion of Social Security, and the §911 exclusion** — all three available in the engine (`form1099Summary.taxExemptInterest`, `socialSecurityTaxabilityDetail`, `feieExclusion`). Under-states MAGI → over-states PTC / under-states clawback for early-SS-claimant and muni-bond marketplace clients. (Inconsistent with the adoption-credit comment at TRE:3722 that claims to "mirror the §36B PTC MAGI".) Dependents'-income inclusion also unmodeled (INFO).

## FC-24 · LOW (self-documented) · TY2026 PTC repayment caps reuse TY2025 values

TC:5338-5341. Rev. Proc. 2025-32 publishes 2026 caps; code carries a TODO. (Moot at ≥400% FPL once FC-01 is fixed, but the <400% tiers still need the 2026 values.)

## FC-25 · LOW/INFO · EIC computed by formula, not the $50-bracket table

TC:2904-2923 computes the exact statutory curve; the filed EIC Table uses $25-midpoint $50 brackets → ±$25-ish vs the table. Acceptable for an overlay tool; note for exact-match validation.

## FC-26 · INFO · Un-modeled eligibility data (acceptable for an Option-A overlay)

CTC/ODC SSN/ITIN requirements (incl. the OBBBA taxpayer-SSN rule from TY2025), §21 deemed earned income for student/disabled spouse ($250/$500-month), §25A felony-drug-conviction and 4-year AOC limits, EITC residency/SSN rules, §36B AK/HI FPL tables (documented in code). These require data the schema doesn't carry; CPA-judgment territory.

---

# Verified CLEAN (re-derived against primary sources)

- **Ordering skeleton** (TRE:3609-3824): FTC → dep care → education → saver's → §25C → adoption → **CTC** → §53 → §38, each `min(credit, remaining)`-capped; matches the 2024 form worksheets **except** the §25D placement (FC-11) and §53-after-§38 (note in FC-07). CTC correctly sequenced AFTER the Schedule-3 set and BEFORE §53/§38 (the C1 fix is right). Adoption-last-among-Schedule-3 maximizes use of non-carryforward credits — correct per Form 8839 CLW.
- **Nonrefundable credits confined to income tax** (regular + AMT): SE tax, NIIT, Additional Medicare, §72(t), §4973(g), Schedule H are added outside the credit base (TRE:3598-3607) and never offset — correct per §26(b) (modulo FC-09's APTC-repayment exclusion, which is the one §26(b) component wrongly left out).
- **CTC/ACTC values & mechanics**: $2,000 (2024) / $2,200 (2025, OBBBA §70104) / $2,200 (2026, Rev. Proc. 2025-32); ODC $500 nonrefundable-only; phase-out $200k/$400k-joint at $50 per $1,000-or-fraction (ceil) on the combined CTC+ODC; **QSS/MFS correctly $200k** (not a joint return); ACTC = min(unused, $1,700×QC, 15%×(earned−$2,500)) replicates Sch 8812 lines 16a/16b/17/19 incl. the ODC-in-the-unused-pool subtlety; $1,700 refundable cap all three years per Rev. Procs. 2023-34/2024-40/2025-32; earned income = wages + (net SE − ½SE-tax) per the 8812 worksheet.
- **EITC tables**: TY2024 and TY2025 parameters match Rev. Proc. 2023-34 / 2024-40 exactly (all 16 cells each: max credits 632/4,213/6,960/7,830 and 649/4,328/7,152/8,046; thresholds and completed-phase-outs); TY2026 values consistent with Rev. Proc. 2025-32 (664/4,427/7,316/8,231; thresholds 10,860/23,890 + MFJ 18,140/31,160). Investment-income limits $11,600/$11,950/$12,200. Tax-exempt interest correctly counted in §32(i) (FED-06). MFS bar; 3+ QC cap; phase-out base = max(earned, AGI); `eitcQualifyingChildren` wider-than-CTC count handling (E1).
- **Education §25A**: AOC 100%-of-first-$2,000 + 25%-of-next-$2,000 = $2,500/student; 40% refundable / 60% nonrefundable split; LLC 20% × $10k cap $2,000/return; statutory (non-indexed) $80–90k / $160–180k bands; MFS barred. (QSS band aside — FC-06.)
- **Dependent care §21**: $3,000/$6,000 caps; 35%→20% slide with ceil per $2,000-or-fraction — band edges verified ($16,000→34%, $43,000→21%, $43,001→20% per Form 2441); lesser-of-spouses earned-income limit for MFJ; §21(e)(2)/(e)(4) MFS rules with lived-apart override. (QSS aside — FC-04.)
- **Saver's §25B tiers**: TY2024/2025 match the Rev. Procs.; TY2026 (Notice 2025-67) internally consistent with the statutory 50%/75%/100% structure (MFJ $48,500/$52,500/$80,500 = 2× single; HoH = 75% of MFJ); QSS correctly in the single column (Form 8880, PLAN-01); $2,000/filer contribution cap ($4,000 MFJ); Roth contributions correctly included in the base.
- **Adoption §23**: per-child caps $16,810/$17,280/$17,670; phase-out start $252,150/$259,190/$265,080 with the statutory $40,000 band; OBBBA refundable split $0/$5,000/$5,120 applied to the current-year credit only; carryforward not re-phased (correct per Form 8839); special-needs full-limit deeming (§23(a)(3)); MFS conservative bar with carryforward preserved; refundable portion never carried. MAGI = AGI + FEIE is the right add-back **given the engine's AGI excludes FEIE** (verified at TRE:2653-2656).
- **§38 internals**: §41 before WOTC/§45S within one §38 envelope; §39 carryforward-in added pre-limit and carryforward-out = available − applied, for both the §41 and other-GBC pools (limit base aside — FC-08).
- **§41 R&D**: ASC 14% over 50%-of-prior-3-yr-avg; 6% startup; §280C(c)(3) reduced credit ×(1−0.21) default.
- **Refundable-credit plumbing** (TRE:3910-3926): EITC + ACTC + 40% AOC + net PTC + OBBBA refundable adoption all add to the refund; excess APTC adds to liability; manual `credit` adjustments pass through.
- **PTC (TY2024/2025)**: prior-year FPL guidelines correct ($14,580+$5,140; $15,060+$5,380; and the 2026 row $15,650+$5,500 is the right 2025 guideline); ARPA applicable-figure curve correct **for 2021–2025**; Table-5 cap dollar values correct for 2024 ($375/975/1,625 single, doubled otherwise) and 2025 ($400/1,050/1,750); ≥400% FPL → uncapped repayment; QSS→full column is correct ("all other filing statuses").
- **§53 mechanics**: cap by carryforward balance, regular-minus-TMT spread, and remaining tax; no §53 when AMT binds (TMT ≥ regular → applicable 0); carryforward roll = in + generated − applied (limit base aside — FC-07; generation simplification — FC-21).
