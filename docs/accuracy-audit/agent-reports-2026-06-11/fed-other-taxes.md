# Audit — Other Federal Taxes (AMT / NIIT / Add'l Medicare / SE / Sch H / Form 2210 / §72(t) / §4973 / excess-SS)

Auditor: independent fresh-eyes pass, 2026-06-11. READ-ONLY.
Files: `artifacts/api-server/src/lib/taxCalculator.ts` (tC), `taxReturnEngine.ts` (tRE), `scheduleH.ts`, `form2210.ts`, `taxReturnPipeline.ts` (tRP).
Method: re-derived every constant from IRS/SSA primary sources; did NOT trust test files. All HIGH findings confirmed with live repros (`/tmp/audit-repro-fed-other.ts`, run via `cd scripts && npx tsx`). Repro output is reproduced inline.

---

## FINDINGS

### F-1 · HIGH · Additional Medicare Tax (Form 8959) — QSS threshold is $250,000; the form says $200,000
- **Where:** tC `additionalMedicareThreshold()` ~6749–6759 (`case "qualifying_widow": return 250000`).
- **Law:** Form 8959 instructions (2024 & 2025, irs.gov/instructions/i8959): thresholds are MFJ $250,000; MFS $125,000; **Single, HoH, or Qualifying surviving spouse $200,000**. IRC §3101(b)(2)(C): "$200,000 in any other case" — a QSS return is not a joint return. (NIIT is different: §1411(b)(1) gives a *surviving spouse* $250,000 — the engine's NIIT mapping is correct; the 8959 mapping copied it.) The comment block at tC 6744 even states "$200k single/HoH/QSS" — the code contradicts its own comment.
- **Repro (confirmed):** QSS, $240k Medicare wages, TY2024 → engine threshold 250,000, Additional Medicare **$0.00**; Form 8959 = 0.9% × $40,000 = **$360.00**. Pipeline result identical.
- **Impact:** under-collection up to 0.9% × $50k = **$450/yr** for every QSS filer with Medicare wages+SE between $200k and $250k. Wrong filed Schedule 2 line 11.

### F-2 · HIGH · §53 minimum-tax-credit limit (Form 8801 line 21/23) does not net out other nonrefundable credits — income tax can be driven BELOW TMT
- **Where:** tRE 3765: `const amtCreditApplicable = Math.max(0, regularFederalTax - amt.amtBeforeRegular)`; applied as `min(carryforward, applicable, availableForNonRefundable)` (3766–3770).
- **Law:** IRC §53(c): the credit may not exceed (regular tax liability **reduced by the sum of the credits allowable under subparts A, B, D, E and F** — i.e., FTC, dependent care, education, Saver's, energy, adoption, CTC, GBC) minus TMT. Form 8801 line 21 is "regular tax liability minus allowable credits"; line 23 = line 21 − line 22 (TMT). The engine subtracts TMT from **gross** regular tax. The third cap (`availableForNonRefundable`) bounds at remaining tax, not at remaining-tax-minus-TMT, so whenever other credits were applied and regular > TMT, the MTC over-applies by up to min(otherCredits, regular−TMT).
- **Repro (confirmed):** Single FL TY2024, $300k W-2 (std ded), FTC $300, `amt_credit_carryforward` $50,000. Regular tax $70,264.75; TMT $55,718.00 (AMTI $300,000 = $285,400 + $14,600 std-ded addback; base $214,300 × 26%). Law max MTC = (70,264.75 − 300) − 55,718 = **$14,246.75**. Engine applied **$14,546.75**; income tax after credits = **$55,418.00 = TMT − $300** — below TMT, which §53(c) exists to forbid.
- **Impact:** under-tax equal to the other nonrefundable credits stacked in the same year (FTC/2441/8863/8880/5695/8839/CTC) — easily $1k–$5k+ with a CTC. Population: anyone consuming an MTC carryforward in a regular-tax year with other credits (the canonical post-ISO-exercise pattern).
- **Sibling defect:** the §38(c) GBC limit (tRE 3796–3799) uses gross `incomeTaxOnly` for both "net income tax" and "net regular tax liability"; §38(c)(1)/(2) define both **net of subpart A & B credits**. Same direction (over-allows GBC below the statutory floor when personal/FTC credits are present).

### F-3 · HIGH · §53(b)/(d) MTC generation = 100% of AMT, including exclusion-item AMT — and the pipeline AUTO-SEEDS it into next year
- **Where:** tRE 3772 `const amtCreditGenerated = amt.amtTax;` → persisted `amtCreditCarryforwardRemaining`; tRP `synthesizePriorYearCarryforwards` 318–328 auto-creates next year's `amt_credit_carryforward` from it (suppressed only by a manual override).
- **Law:** §53(d)(1)(B): the credit-eligible "adjusted net minimum tax" is AMT **reduced by the portion attributable to exclusion items** — the §56(b)(1) adjustments (SALT addback, standard deduction, etc.) generate **no** MTC (Form 8801 Part I lines 1–15 recompute a "minimum tax on exclusion items" and only the excess carries). Deferral items (ISO bargain 2k, depreciation 2i) do generate credit.
- **Why it bites here:** the engine's two *automatic* AMT drivers — the line-2a standard-deduction addback (F2 fix, 2026-06-08) and the line-2g SALT addback — are both exclusion items. A SALT/std-ded-driven AMT year generates $0 MTC under Form 8801; the engine generates 100% and silently loads it the following year, where it offsets regular tax (further amplified by F-2's broken limit).
- **Impact:** year-2 under-tax up to the full year-1 AMT. The in-code comment ("CPAs can override … for exclusion-item-only AMT") documents the simplification, but the **default filed number is wrong** and flows without CPA action. Recommend: split generation by exclusion vs deferral preferences (the engine already itemizes its preference components — saltAddback + stdDed + state-refund 2e are exclusion; ISO 2k + depreciation 2i ± ATNOLD are deferral; legacy catch-all needs a CPA flag).

### F-4 · HIGH (TY2025+) · OBBBA senior deduction is not added back to AMTI — 2025 Form 6251 line 1b requires it
- **Where:** tRE 3092 `taxableAfterObbba = max(0, taxableAfterQbi − obbbaDeductions.total)` (total **includes** `senior`); 3223–3224 passes it to `calculateAmt` as `taxableIncome`; no senior addback anywhere in `federalAmtPreferences` (3208–3221).
- **Law:** 2025 Instructions for Form 6251 (irs.gov/instructions/i6251), What's New: the $6,000 enhanced deduction for seniors (Schedule 1-A line 37) "is treated as a personal exemption that is **added back to alternative minimum taxable income** as an adjustment under section 56(b)"; the 2025 Form 6251 split line 1 into 1a/1b specifically to add it back. The other three OBBBA Schedule 1-A deductions (tips §224 / overtime §225 / car-loan §163(h)(4)) are **not** added back — engine treatment of those is correct.
- **Impact:** a 65+ filer who hits AMT in TY2025–2028 has AMTI understated by up to $6,000 ($12,000 MFJ both 65+) → TMT understated by up to ~26–28% × $12,000 ≈ **$3,360**. Narrowed by the senior deduction's own 6%-over-$75k/$150k MAGI phase-out (gone by $175k/$250k MAGI), but AMT at moderate AGI is exactly the ISO-bargain / big-SALT-itemizer profile. Under-tax; wrong Form 6251.
- **Fix shape:** `federalAmtPreferences += obbbaDeductions.senior` (the component is already separately computed at tC 7071).

### F-5 · HIGH · Excess Social Security withholding credit (Schedule 3 line 11) is not modeled at all
- **Where:** engine never reads W-2 Box 4. `socialSecurityTaxBox4` exists in the DB/extraction layer (routes/w2data.ts, documentExtractor.ts) but `grep socialSecurityTaxBox4 lib/taxReturnEngine.ts` → no matches; `W2Fact` (tRE 227–235) has no Box 4 field. (entityChoice.ts *comments* assume the 1040 recovers it: "the over-withheld SS is recovered on the 1040 (Schedule 3 line 11)" — the engine doesn't.)
- **Law:** 1040 Schedule 3 line 11 — with two or more employers and combined Box 4 (+ tier-1 RRTA) over the year max (2024: 6.2% × $168,600 = **$10,453.20**; 2025: $10,918.20; 2026: $11,439.00), the excess is a refundable payment-like credit.
- **Repro (confirmed):** two employers × $120k SS wages, Box 4 = $7,440 each (total $14,880; excess **$4,426.80**). Engine refund identical with and without Box 4 supplied (−$10,174.50 both) → credit absent.
- **Impact:** under-refunds job-switchers/multi-employer filers above the wage base — a routine CPA-desk fact pattern; max miss grows each year (~$4.4k+ at 2× full-base employers). The data is already captured at the W-2 seam; only the engine read + Schedule 3 line 11 surface is missing. Should at minimum be flagged in return diagnostics.

### F-6 · HIGH · Form 8959 Part IV withholding reconciliation not modeled — mandatory employer 0.9% withholding (W-2 Box 6 excess) never credited
- **Where:** engine reads only `federalTaxWithheldBox2` for withholding; `medicareTaxBox6` exists in DB/extraction but is unread by tRE. Documented in `lib/forms/form8959Spec.ts` footnote (line 104) — i.e., a known gap, but it changes the headline refund number.
- **Law:** employers must withhold 0.9% on wages over $200,000 per employer (reported in Box 6 above 1.45% × Box 5). Form 8959 Part IV line 24 moves (Box 6 − 1.45% × Box 5) into 1040 line 25c as federal income tax withholding.
- **Impact:** the engine adds the Additional Medicare **liability** but never credits the matching **withholding** → systematically overstates balance due by ≈ 0.9% × (wages − $200k) for every single-employer W-2 filer over $200k (e.g. $900 at $300k wages). Common case in this app's clientele; over-tax direction (client-unfavorable, CPA-visible).

### F-7 · MEDIUM · Schedule H 2026 FICA threshold held at $2,800 — SSA published **$3,000** for 2026
- **Where:** `scheduleH.ts` 36–40: `2026: 2800, // PROVISIONAL`.
- **Law:** SSA 2026 employment coverage threshold for domestic employees = **$3,000** (ssa.gov/oact/cola/CovThresh.html; SSA Pub EN-05-10021 "Household Workers 2026"; +$200 from 2025's $2,800). 2024 $2,700 ✓ and 2025 $2,800 ✓ are correct.
- **Impact:** TY2026 household employers paying $2,800–$2,999 are wrongly charged full FICA on the entire wage (≈15.3% × ~$2.9k ≈ **$430–459** over-tax) — a cliff at the wrong spot. Data is now published; the PROVISIONAL marker should be resolved.

### F-8 · MEDIUM · NIIT — the allowed −$3,000 net capital loss never offsets other investment income (Form 8960 line 5a may be negative)
- **Where:** tRE 3258–3298 — NII base sums `ltcgPreferential + stcgInOrdinary`, both post-netting **positive** buckets; whole base floored at 0.
- **Law:** Form 8960 line 5a = the net gain **or loss** included in AGI from Schedule D (i.e., includes the §1211(b) −$3,000/−$1,500 allowed loss), which offsets interest/dividends/etc. within NII.
- **Repro (confirmed):** single FL TY2024, $230k wages + $20k interest + $10k net LT loss. AGI $247,000 ✓. Form 8960 NII = 20,000 − 3,000 = 17,000 → NIIT **$646.00**. Engine NII = 20,000 → **$760.00**.
- **Impact:** over-tax ≤ 3.8% × $3,000 = **$114/yr** ($57 MFS), recurring for the very common loss-carryforward + portfolio-income profile. Conservative direction but a systematically wrong filed number.

### F-9 · MEDIUM (documented design) · MFJ default (no spouse tags) skips Sch SE Line 8/9 wage-base sharing entirely — over-taxes same-spouse W-2+SE
- **Where:** tRE 2191–2196: MFJ without explicit `spouse` attribution calls `calculateSelfEmploymentTax(seTaxBase, taxYear, **0**, …)`.
- **Law:** Schedule SE Part I lines 8a–9: the filer's own W-2 SS wages reduce the SS base available to SE — not optional.
- **Repro (confirmed):** $150k W-2 + $100k SE. Single filer: SS portion $2,306.40 ✓ (12.4% × min(92,350, 18,600)). Same facts as MFJ with no tags: engine SS portion **$11,451.40** — **$9,145.00 over-tax** when the W-2 and the business belong to the same spouse.
- **Assessment:** intentional, documented, opt-in via spouse tags (and the engine can't know whose W-2 it is) — but the failure mode is a silent five-figure-rate over-collection on a very common return shape. Deserves a UI/diagnostic nudge ("MFJ with W-2 + SE and no spouse attribution — SS wage base not shared") rather than silence.

### F-10 · MEDIUM · NIIT excludes non-qualified annuity income — §1411(c)(1)(A)(i) includes it
- **Where:** tRE NII base (3258–3298) includes no 1099-R amounts; all 1099-R income is treated as excluded retirement distributions (§1411(c)(5)).
- **Law:** §1411(c)(1)(A)(i): gross income from **annuities** (other than from §401/§403/§408 etc. qualified plans) is NII. 1099-R Box 7 code **D** ("annuity payments from nonqualified annuities") identifies exactly this; the engine already stores `distributionCode` but uses it only for §72(t).
- **Impact:** under-tax 3.8% × the annuity income for MAGI-over-threshold holders of non-qualified annuities — a standard HNW retiree product. Narrower than F-1/F-5 but the data needed (code D) is already captured.

### F-11 · LOW/MEDIUM · SE non-farm optional method amount is re-multiplied by 92.35%
- **Where:** tRE 2105–2109 puts `seOptionalReported` (⅔ × gross, capped) into `seBaseScheduleC`; tC `calculateSelfEmploymentTax` then multiplies the whole base by 0.9235.
- **Law:** Sch SE line 4b: optional-method amounts from Part II enter **without** the 92.35% factor (only line 4a applies it to actual net profit).
- **Repro (confirmed):** gross $9,000, expenses $5,000, election: engine net earnings $5,541.00 / SE tax **$847.77**; form: $6,000.00 / **$918.00**. Under-tax ≤ ~$85 and under-credits the SS-coverage/EITC purpose the election exists for. (Eligibility gates — net < $7,493 (2024)/$7,840 (2025) and < 72.189% of gross, cap $6,920/$7,240 — are correct for 2024/2025.)

### F-12 · LOW · AMT Part III preferential stacking base diverges from Form 6251 lines 44/49
- **Where:** tC 7210–7227 stacks the 0/15/20% brackets above `ordinaryPortion = amtBase − ltcgInAmtBase`.
- **Law:** Form 6251 Part III consumes the 0%/15% breakpoints using the **regular-tax** Schedule D worksheet amounts (line 44: breakpoint − QDCGT-worksheet line 7; line 49 similar), not the AMT-base ordinary portion.
- **Impact:** mixed direction, bounded by rate-band shifts: when prefs > exemption the engine over-taxes the gain bands slightly; when exemption > prefs it under-taxes slightly. Small for typical AMT filers (already in the 15/20% bands); worth a code comment at minimum.

### F-13 · LOW · AMT line 1 cannot go negative in the engine
- **Where:** tRE 3092 floors `taxableAfterObbba` at 0 before it becomes Form 6251 line 1.
- **Law:** Form 6251 line 1: if 1040 line 15 is zero, enter line 11 − line 14 **as a negative amount**. A filer whose deductions exceed income keeps that negative against preferences.
- **Impact:** AMTI overstated by the unused deduction in the (rare) negative-taxable + large-preference case → over-tax. Edge case; conservative direction.

### F-14 · LOW · §4973(g) excise lacks the year-end-account-value cap
- **Where:** tC 4513–4515: `hsaExcessExcise = excess × 0.06`.
- **Law:** §4973(a) flush language: the 6% tax "shall not exceed 6 percent of the value of the account (determined as of the close of the taxable year)". Engine has no account-value input. Also: withdrawal-of-excess-by-due-date (no excise) is CPA-managed; prior-year excess carryover excise not modeled. Over-tax only in the spent-down-account edge.

### F-15 · LOW · Sch SE micro-edges (church / tips)
1. With church-employee income present and line 4c < $400, the form **zeroes the non-church SE** and taxes only line 5b; the engine taxes the combined base once the $100 floor is met (over-tax ≤ ~$61). Partially documented at tRE 2082–2085 (the stale comment there still says "engine uses the $400 Sch SE floor" although 2114 implements the $100 floor — comment drift).
2. Exactly $108.28 church wages: 108.28 × .9235 = $99.9966 < the engine's $100 floor → engine $0 vs form ~$15.30 (whole-dollar rounding). Cents-level.
3. Sch SE line 8a is Boxes **3 + 7** (SS tips); engine sums Box 3 only (fallback Box 1) — tipped W-2 + SE filers over-pay the SE SS portion slightly.

### F-16 · LOW · SE optional method 2026 values held at 2025 although SSA published the 2026 QC amount
- **Where:** tRE 2096–2100 (`2026: { netThreshold: 7840, maxReport: 7240 } // not yet published — hold 2025`).
- **Law:** the cap is 4 × the SSA quarter-of-coverage amount; 2026 QC = $1,890 → maxReport **$7,560**, net-profit gate ≈ **$8,190**. Also style: `SE_OPTIONAL_METHOD` is `Record<number>` with a 2024 fallback — escapes the repo's `Record<TaxYear>` freshness-hardening pattern.

### F-17 · LOW · Form 2210 notes (all inside the labeled-estimate envelope)
1. TY2026 `SECTION_6654_ANNUAL_RATE = null` is the right shape: 2026 rates are **non-uniform** (Q1 = 7%, Rev. Rul. 2025-25 family / IRS newsroom; Q2 = 6%, IRB 2026-08) — a flat per-year number can't represent 2026; if filled, the model needs per-quarter rates.
2. Sch AI `annualizedTax` uses ordinary brackets only (`calculateFederalTax`) — no preferential LTCG rates and no annualized SE tax, although back-loaded capital gains are the method's main user. Overstates early-period installments (penalty over-estimate; cannot under-state vs the regular method since it min()s with the 25% column).
3. `currentYearTax` includes Schedule H unconditionally; Form 2210 line 2 includes household employment taxes only when there's withholding or estimates would otherwise be due (tiny edge, over-counts the safe-harbor target).
4. 2024 = 8%, 2025 = 7% flat rates verified ✓; 90/100/110 + $150k/$75k MFS + $1,000 floor + prior-year-zero gating + AI factors (4/2.4/1.5/1) and 22.5/45/67.5/90% + the line-25 recapture recurrence all verified correct ✓.

### F-18 · INFO / watch-items
1. **TY2026 MFS §55(d)(3) add-back at 50%:** the engine applies OBBBA's 50% phase-out rate to the MFS phantom add-back (zero-point $500,000 + $70,100/0.50 = $640,200). This follows OBBBA's substitution into §55(d) but the 2026 Form 6251 isn't published; confirm the add-back rate (25% vs 50%) when the form drops. (Medium confidence either way; magnitude ≤ $70,100 of AMTI placement.)
2. §59(j) kiddie-AMT exemption limit (child's exemption capped at earned income + $9,250 (2024)) not modeled — Form 8615 filers with large unearned income + AMT prefs.
3. Form 8959 lines 2–3 (Form 4137 unreported tips / Form 8919) and Part III RRTA not modeled — already documented in form8959Spec.
4. 1099-R code "J" (early Roth) carries no automatic penalty; the §72(t) tax on Roth earnings is handled by `computeForm8606PartIII` only when the CPA routes through the `roth_ira_distribution` adjustment — a raw code-J 1099-R record alone produces no penalty. Documented-adjacent; listing for completeness.

---

## VERIFIED CLEAN (re-derived against primary sources)

**AMT (Form 6251):**
- Exemptions/phase-out starts, all 3 years × 5 statuses: 2024 $85,700/$133,300/$66,650 @ $609,350/$1,218,700 (Rev. Proc. 2023-34); 2025 $88,100/$137,000/$68,500 @ $626,350/$1,252,700 (cross-checked against the live 2025 i6251 — exact); 2026 $90,100/$140,200/$70,100 @ OBBBA $500k/$1M (MFS $500k = half of joint — correct, same as single) with **50%** phase-out rate (§70107) — live-verified (exemption $40,100 at AMTI $600k; TMT $151,882.00).
- 26/28% breakpoints $232,600/$239,100/$244,500, **halved for MFS** — verified in the R5 TMT hand-calc ($116,300 used).
- §55(d)(3) MFS phantom add-back: zero-point $875,950 (2024) and lesser-of math reproduce Form 6251 exactly (TMT $286,357.50 at AMTI $1.0M — matches hand calc to the cent).
- Line 2a std-ded addback (incl. §63(f) age/blind add-ons), itemizer/non-itemizer mutual exclusivity with the 2g SALT addback (capped, deducted amount only), 2e taxable-state-refund **negative** adjustment, 2k ISO bargain, 2i depreciation (±), ATNOLD capped at 90% of pre-ATNOLD AMTI with carryforward (§56(d)), §57(a)(7) QSBS preference = 7% and only for <100%-exclusion stock.
- Part III: flat 25% §1250 / 28% collectibles buckets, §1250-first ordering symmetric with the regular-tax Schedule D worksheet, global final min(full-rate, preferential) per the form.
- TMT-vs-regular comparison: engine omits FTC from both sides of the AMT subtraction — algebraically identical to Form 6251 lines 9/10 whenever AMT-FTC = regular FTC (the common case).

**NIIT (§1411):** 3.8%; thresholds $200k/$250k MFJ+**QSS** (§1411(b)(1) surviving spouse)/$125k MFS, not indexed; tax = min(NII, MAGI − threshold); MAGI = AGI + gross §911 FEIE addback (net-of-allocable-deductions sub-gap documented); base includes interest/dividends/royalties (1099 + K-1), passive rental (post-PAL), disposed-rental positive net, passive K-1, post-netting gains; excludes active T/B + Sch C + SE income, RE-professional rental, retirement distributions, tax-exempt interest; non-passive §1231 exclusion correctly capped at the surviving net gain.

**Additional Medicare (Form 8959):** 0.9%; MFJ $250k / MFS $125k / single+HoH $200k (QSS excepted — F-1); wages consume the threshold before SE (lines 4–13 mechanics exact); per-couple W-2 aggregation; Box 5 with Box 1 fallback; SE floored at 0; treated as an "other tax" not offsettable by nonrefundable credits.

**Schedule SE:** 92.35% factor; 12.4% SS capped at min(net earnings, base remaining after W-2 Box 3) — single/HoH/MFS/QSS Line 8/9 sharing exact ($2,306.40 repro); 2.9% Medicare uncapped; half-SE deduction = total/2; <$400 net-earnings floor; church-employee $108.28/$100 floor modeled (micro-edges in F-15); clergy housing allowance in the SE base + excluded from AGI + carved out of Sch-C QBI; statutory employee on Sch C (AGI + QBI + earned income) and **out** of the SE base; SS wage bases $168,600/$176,100/$184,500 (SSA) ✓; MFJ per-spouse path (when tagged) computes two Sch SEs and sums.

**Schedule H:** 2024 $2,700 / 2025 $2,800 FICA thresholds (SSA) ✓ (2026 — F-7); full wages taxed once threshold met (no excess-only error); SS portion capped at the year's wage base; 0.9% employer-withholding line over flat $200k ✓; FUTA 0.6% net on first $7,000 with the $1,000 trigger and a multi-employee `futaWagesOverride`; quarterly-trigger and credit-reduction-state approximations documented in-file.

**Form 2210 (§6654):** required annual payment = min(90% current, 100%/110% prior) with the 110% gate at prior AGI > $150,000 (> $75,000 MFS); line-4 tax correctly = total tax (incl. SE/AMT/NIIT/Add'l-Medicare/excess-APTC) minus refundable credits (EITC, ACTC, refundable AOC, net PTC, OBBBA refundable adoption); $1,000 de-minimis on tax-minus-withholding; prior-year-zero exception gated on a known full prior year; 2024 8% / 2025 7% flat rates match the IRS quarterly tables; penalty $ clearly labeled an estimate; Schedule AI factors 4/2.4/1.5/1, applicable percentages 22.5/45/67.5/90, and the line-23/24/25 recapture recurrence all match the form.

**§72(t):** 10% on the taxable portion for Box-7 code 1; 25% for code S (§72(t)(6) SIMPLE first-2-years); exception codes (2/3/4/7/G/T/Q/H/U/M/N/R) no-penalty; added outside the credit-offsettable income-tax bucket. **§4973(g):** 6% on (employee + employer) − limit; HSA limits $4,150/$8,300 (2024), $4,300/$8,550 (2025), $4,400/$8,750 (2026, Rev. Proc. 2025-19) + $1,000 age-55 catch-up ✓ (cap nuance — F-14).

**Credit ordering invariant:** nonrefundable credits draw only on `regularFederalTax + amtTax` (never SE/NIIT/Add'l-Medicare/§72(t)/§4973/Sch H) ✓.

---

## Repro artifacts
- Script: `/tmp/audit-repro-fed-other.ts` (R1 QSS-8959, R2 §53 limit, R3 NIIT −$3k, R4 optional method, R5 AMT MFS/2026 params, R6 MFJ SE default, R7 excess-SS). All ran against the live engine on 2026-06-11; outputs quoted in the findings above.

## External sources used
- IRS Instructions for Form 8959 (2024/2025) — QSS $200,000 threshold. https://www.irs.gov/instructions/i8959
- IRS Instructions for Form 6251 (2025) — senior-deduction AMTI addback (line 1b), 2025 exemption/phase-out/breakpoint figures. https://www.irs.gov/instructions/i6251
- SSA employment coverage thresholds + SSA Pub EN-05-10021 (2026) — domestic threshold $3,000 for 2026. https://www.ssa.gov/oact/cola/CovThresh.html · https://www.ssa.gov/pubs/EN-05-10021.pdf
- IRS newsroom + IRB 2026-08 — §6621 underpayment rate 7% Q1-2026, 6% Q2-2026. https://www.irs.gov/newsroom/interest-rates-remain-the-same-for-the-first-quarter-of-2026 · https://www.irs.gov/irb/2026-08_IRB
- IRC §53(c)/(d), §55(d), §56(b)/(d), §57(a)(7), §1411, §3101(b)(2), §1401(b)(2), §6654, §72(t), §4973; Form 8801/6251/8960/8959/2210/Sch SE/Sch H instructions (knowledge-based where not fetched; flagged inline where confidence < high).
