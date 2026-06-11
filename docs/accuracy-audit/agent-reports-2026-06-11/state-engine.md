# State Tax Engine Audit — 2026-06-11 (fresh independent auditor)

Scope: `artifacts/api-server/src/lib/stateTaxData.ts`, state portions of `taxCalculator.ts`
(calculateStateTax, calculateMultiStateTax state-AMT/WA-excise blocks, calculateStateEitc,
calculateStateCtc, calculateStateAdditionalCredits, getStateRetirementExemption, NYC),
`stateMandate.ts`, and their wiring in `taxReturnEngine.ts` (~L3490–4130).

Method: read code (not tests); verified disputed values against state DOR / statute / Tax
Foundation via web search (all confirmed items below cite the source class); HIGH/CRITICAL
findings reproduced live via `/tmp/state-audit-repro.ts` (tsx, imports the real engine).
Repro output is quoted inline. Confidence stated where < high.

Severity: CRITICAL = wrong tax for a common filer in that state · HIGH = narrower ·
MEDIUM = edge · LOW = cosmetic.

---

## CRITICAL

### C1. Kansas — SB 1 (June 2024 special session) never applied; wrong for ALL THREE years
`stateTaxData.ts` L468–475 + `STATES_TAXING_SS` L133.
Engine (all years): 3 brackets 3.1%/5.25%/5.7% (@$15k/$30k single), std ded $3,500/$8,000/$6,000,
no personal exemption, KS listed as taxing Social Security.
Actual (TY2024+, SB 1 2024 Special Session, KS Legislature summary + KLRD):
- 2 brackets: 5.2% ≤ $23,000 single / $46,000 MFJ; 5.58% above.
- Std ded $3,605 / $8,240 / $6,180 (HoH).
- Personal exemption $9,160 per filer ($18,320 MFJ) + $2,320 per dependent — large and unmodeled.
- **Social Security 100% exempt beginning TY2024** (engine keeps KS in `STATES_TAXING_SS`,
  so taxable SS stays in the KS base — repro: $20k taxable SS changes KS tax by $0).
Repro: single $60k AGI TY2024 → engine $2,763.00; SB1-correct ≈ $2,548.31 (with exemption).
A KS retiree with $20k taxable SS is over-taxed ≈ $1,100. Affects every KS filer 2024–2026.

### C2. Hawaii — Act 46 (2024) TY2025 bracket widening + TY2026 std-ded step missing
`stateTaxData.ts` HI block (2024 values cloned into 2025/2026).
Actual (Act 46 SLH 2024; HI DOTAX Ann. 2024-03 / 2025-07): TY2025 brackets widen massively —
1.4% band $2,400 → $9,600 single (×2 MFJ); top 11% starts at $325,000 single (was $200,000);
all intermediate thresholds restructured. TY2026 std ded doubles to $8,000 / $16,000
(engine holds $4,400/$8,800 for 2026). Further widening 2027/2029; std ded steps 2028/2030.
Repro: engine HI 2025 single 1.4% band still ends $2,400; top starts $200k; single $90k AGI
2025 = $6,315.60 — several hundred dollars over the Act 46 result. Affects every HI filer
TY2025/2026 (over-tax).

### C3. New Mexico — hybrid/wrong brackets in BOTH 2024 and 2025+ (HB 252 of 2024)
`stateTaxData.ts` NM block; 2025/2026 are clones of 2024.
- Engine "2024" single: 1.7% ≤$5.5k / 3.2% ≤$16.5k / 4.7% ≤$33.5k / 4.9% ≤$210k / 5.9%.
  Actual TY2024 (pre-HB252 law): 1.7% ≤$5.5k / 3.2% ≤$11k / 4.7% ≤$16k / 4.9% ≤$210k / 5.9%.
  The $16.5k/$33.5k thresholds belong to the 2025 law → TY2024 UNDER-taxed (~$117 @ $50k single).
- Actual TY2025+ (HB 252, L.2024 ch.67, eff. 1/1/2025): SIX brackets 1.5%/3.2%/4.3%/4.7%/4.9%/5.9%
  (single ≤$5.5k/$16.5k/$33.5k/$66.5k/$210k; MFJ ≤$8k/$25k/$50k/$100k/$315k). Engine keeps the
  1.7% bottom + no 4.3% band → TY2025/2026 OVER-taxed (~$112 @ $50k single).
Verified: REDW/Legiscan/NM gov release. Repro printed both tables.

### C4. West Virginia — TY2024 table holds the TY2025 rates (under-tax every 2024 WV filer)
`stateTaxData.ts` WV block: 2.22/2.96/3.33/4.44/4.82 used for 2024.
Actual TY2024 = 2.36/3.15/3.54/4.72/5.12 (the 2023 HB 2526 cut held through 2024); the 4%
trigger cut + SB 2033's extra 2% both took effect **1/1/2025**, producing 2.22/.../4.82
(EY tax alert; WV Tax Division). Engine 2025/2026 therefore correct (next trigger window is
Jan 2027). Repro: single $60k TY2024 → engine $2,053.50 vs correct ≈ $2,183.50 (≈6% under-tax).

### C5. PA Schedule SP forgiveness — applied TWICE, and the inline copy uses $1,000 steps
Two independent implementations both run in the pipeline:
1. `calculateStateTax` (taxCalculator.ts L2483–2535) multiplies PA tax by (1 − pct) using
   `calculatePaScheduleSpForgivenessPct` with **$1,000** income steps (real PA-40 SP steps are
   **$250**; ceiling single 0-dep = $8,750). Engine grants partial forgiveness all the way to
   floor + $10,000 (e.g. $16,500 single).
2. `calculateStateAdditionalCredits` (L3995–4046, correct $250-step table) then computes
   `pa-special-tax-forgiveness` as a credit on the ALREADY-forgiven liability, and
   `taxReturnEngine.ts` L4029 subtracts it again.
Repro: single, no deps —
- $12,000 income (real forgiveness 0%): engine inline → $221.04 vs correct $368.40.
- $7,000 income (real forgiveness 80% → tax $42.98): engine $21.49 inline (90% step table)
  then SP credit $17.19 again → final **$4.30** vs correct $42.98.
Every low-income PA filer in/near the SP band is wrong; fix = delete one implementation
(keep the $250-step one) and apply it exactly once.

---

## HIGH

### H1. Colorado TY2025 rate — 4.40% used; CO DOR confirms the TABOR temporary reduction to 4.25%
`build2025Data()` restores 4.40% with a "surplus-conditional, default to base" comment, but the
condition has RESOLVED: tax.colorado.gov states all TY2025 filers automatically get the 4.40%→4.25%
reduction (SB24-228 reactivation). Repro: single $100k AGI 2025 → engine $3,707.00 vs $3,580.63.
Every CO filer over-taxed 0.15pp of taxable income. (2026 at 4.40% remains a reasonable default;
flag for re-check when the 2026 surplus certifies.)

### H2. Maryland TY2025/2026 — 2025 overhaul (HB 352) entirely missing
Engine clones 2024 MD into 2025/2026. Actual TY2025 (MD Comptroller tax alert; Gordon Feinblatt):
- New brackets: 6.25% > $500k single / $600k MFJ; 6.5% > $1M / $1.2M.
- Std ded raised to $3,350 single / $6,700 MFJ (phase-in eliminated, now COLA-indexed)
  (engine: $2,700/$5,450).
- NEW 2% capital-gains surtax when federal AGI > $350,000 (not modeled anywhere).
- Itemized deductions reduced by 7.5% of AGI over $300k (out of this module's direct scope but
  affects MD via SALT interplay).
Repro: single $1.5M taxable → engine $84,479.75; correct adds ≈ $6.2k of bracket delta plus the
2% gains surtax. Under-taxes high earners; std-ded staleness slightly over-taxes everyone else.

### H3. `STATES_TAXING_SS` is binary — five member states have income-tested exemptions that are ignored
`stateTaxData.ts` L133 + calculateStateTax. Engine taxes 100% of federally-taxable SS for every
state in the set except CT/WV (which have dedicated branches). Actual:
- **NM**: SS fully exempt when AGI ≤ $100k single / $150k MFJ / $75k MFS (§7-2-5.14, TY2022+,
  verified vs NM Tax & Rev). Repro: single $60k AGI incl. $20k taxable SS → engine $1,827.60 vs
  ≈$863.80 with the exemption — ~$964 over-tax for a typical NM retiree. (Worst of this group.)
- **CO**: 65+ may subtract ALL federally-taxed SS (55–64: $20k pension/annuity cap; TY2025+ full
  subtraction for 55-64 if AGI ≤ $75k/$95k). Engine taxes a 70-year-old's SS at 4.25/4.4%.
- **VT**: full exemption below $50k single / $65k MFJ AGI, partial to $60k/$75k. (The VT notes
  string admits "NOT MODELED" — but CLAUDE.md claims VT has an "SS exclusion as of 2026-05-21";
  the doc claim is wrong.)
- **MN**: own subtraction (TY2024 full below ~$84,490 MFJ / $66,085 single, 10%-per-$4k phase-out).
- **RI**: full exemption at full-retirement-age below ~$104k (2024 indexed) AGI.
- **UT**: SS credit fully offsets SS tax below $45k/$75k (2024); thresholds raised to
  $54k/$90k for TY2025 (SB 71, verified). Engine has no UT credit.
- **MT**: acceptable as-is (SS flows per federal; no broad threshold exemption) — CLEAN.
Common retirees in NM/CO/VT (and low-income MN/RI/UT) are over-taxed up to ~$1k+/yr.

### H4. CA AMT (Schedule P 540) — exemption constants are wrong values entirely
`taxCalculator.ts` L1656–1674 uses 244,857 / 326,478 / 163,238 as the "exemption".
Actual 2024 Schedule P (FTB 2024 instructions, verified): exemption $87,171 single-HoH /
$116,229 MFJ / $58,111 MFS; exemption PHASES OUT at 25¢/$ starting $326,891 / $435,855 /
$217,924 (gone at $697,870/$930,498/$465,231). The engine's numbers match neither the
exemption nor the 2024 phase-out (they resemble the CA personal-exemption-credit AGI
thresholds used at L3624-27). No phase-out is modeled at all, so the over-sized "exemption"
persists at any income. Repro: CA single $150k AGI + $100k ISO preference → engine AMT delta
$0.00; correct ≈ +$1,420 (tentative 7%×(250,000−87,171)=$11,398 vs regular $9,977).
Under-taxes exactly the ISO-exercise clients the planning engine targets. Also not year-indexed.

### H5. TY2026 statutory rate cuts missing in `build2026Data()` (verified vs Tax Foundation 1/1/2026 changes)
Engine 2026 = clone of 2025 except OH/KY. Missing (all effective 1/1/2026):
- **IN** 3.0% → 2.95% (2.9% scheduled 2027)
- **MS** 4.4% → 4.0%
- **NC** 4.25% → 3.99% (final step of S.L. 2023-134 phasedown)
- **NE** top 5.2% → 4.55% (LB 754 path to 3.99% by 2027)
- **GA** 5.19% → 5.09%
- **MT** top 5.9% → 5.65% (SB 323; also restructures/widens the lower bracket — verify thresholds
  when building the fix)
- **OK** 6 brackets → 3, top 4.75% → 4.5% (HB 2764, + future trigger phase-out)
Repro printed each engine-vs-actual top rate. Every filer in these 7 states is over-taxed for
TY2026 projections/planning.

### H6. DC EITC — flat 70% used for all years; actual ≥85% (TY2025) and 100% (TY2026)
`STATE_EITC_PCT_OF_FEDERAL.DC = 0.70`. DC OTR states TY2025 DC EITC = 100% of federal for
filers with children (statutory schedule had 85% for 2025; OTR/recent law says 100%; either way
> 70%), and 100% for 2026. Repro: $3,000 federal EITC, 2025 → engine $2,100 vs $3,000.
Material under-credit for DC's low-income filers. (Childless DC EITC also differs — already
flagged "simplified" in code.)

### H7. IL Child Tax Credit — wrong base and wrong rate
`calculateStateCtc` IL branch: 20% × **federal CTC** with an invented $50k/$75k AGI phase-out.
Actual (IL DOR; PA 103-0592): IL CTC = 20% of the taxpayer's **IL EITC** for TY2024 and
**40% of IL EITC** for TY2025+, child under 12, no separate AGI phase-out. Repro: single $30k,
1 child, fed CTC $2,000 → engine $400 vs actual ≈ $144 (TY2024 caps ~$170/1-child household).
Over-credits IL families ~2-3×; rate for 2025+ also missing.

### H8. Missouri TY2025+ — rate stale AND new 100% capital-gains exemption unmodeled
- Top rate: engine holds 4.8% for 2025/2026; MO DOR confirms TY2025 = **4.7%** (SB 3 trigger met).
- **HB 594 (2025): individuals deduct 100% of capital gains from MO income starting TY2025**
  (MO DOR news release "First State to Fully Exempt Capital Gains"). Engine's MO base = federal
  AGI including all gains → over-taxes any MO filer with capital gains by 4.7% × gains.

### H9. Maine std deduction stale for 2025/2026
ME tracks the federal standard deduction; Maine Revenue Services 2025: $15,750 single /
$31,500 MFJ (matches OBBBA); 2026 schedules also announced. Engine holds 2024's $14,600/$29,200
(ME is not in `FED_CONFORMING_STD_DED_STATES` and gets no override). Over-taxes every ME filer
~6.75-7.15% × $1,150+. Fix: add ME to the conforming set (its 2024 value already equals federal).

### H10. Louisiana TY2025+ HoH std deduction — $12,500 vs actual $25,000
LDR FAQ: 2025 std ded $12,500 single/MFS; **$25,000 for joint, HoH, and surviving spouse**.
Engine's LA 2025 override sets head_of_household: 12,500 → LA HoH filers over-taxed
3% × $12,500 = $375. (Also: the $12,500/$25,000 is CPI-indexed beginning 2026 — minor.)

---

## MEDIUM

### M1. DC std deduction 2025/2026 — stale 2024 value; DC DECOUPLED from OBBBA
DC Law 26-89 (2025): DC sets its own 2025 basic std ded = $15,000 single / $30,000 MFJ /
$22,500 HoH (pre-OBBBA federal values; congressional disapproval fight pending — H.J.Res.142).
Engine uses $14,600/$29,200/$21,900. Either way the engine is stale; do NOT put DC in the
federal-conforming set (it intentionally decoupled). Moderate dollar effect (~$25-35).

### M2. Virginia std deduction 2025/2026 — $8,500/$17,000 vs enacted $8,750/$17,500
VA Tax (July 2025 law-change page; HB 1600): TY2025 std ded $8,750/$17,500 (extended through
2026). Engine holds the 2024 values for 2025/2026. ~$14/filer over-tax.

### M3. VT personal exemption — $4,850 is the 2023 value; TY2024 = $5,100
Verified vs 2024 Form IN-111 (Line 5e: "multiply by $5,100"). Engine uses $4,850 for filer,
spouse, AND each dependent across all years → ~$8.40/person over-tax at 3.35%, more at higher
brackets. NOTE: `tax-engine-state-wins-2026-tests.ts` pins "$4,850/dep ($324.95 for 2 deps)" —
a wrong-expectation test; CLAUDE.md repeats it. 2025 exemption will be higher still (unverified).

### M4. State-CTC pipeline passes `childrenUnder6: 0` always → CA YCTC, NJ CTC, VT CTC and the
CO under-6 portion can NEVER fire in the live product
`taxReturnEngine.ts` L3966 ("simplified — we don't track per-child age"). CLAUDE.md advertises
"State CTCs CA/CO/NJ/IL/NM/VT shipped via E9", but in the pipeline only IL (wrong base, H7),
NM, and CO's $200 (6-15) sliver ever pay out. Under-credits CA/NJ/VT families with young
children ($1,000-$1,154/child). Needs a `children_under_6` input (adjustment or client column).

### M5. VT CTC phase-out rate wrong in the calculator itself
Engine: −$5 per $1,000 over $125k **per child** (zero at $325k for 1 child). Statute
(32 V.S.A. §5830f, verified): −**$20** per $1,000 (or fraction) over $125k TOTAL, fully phased
at $175k. Repro (direct call): MFJ $200k AGI, 2 kids<6 → engine $1,250 vs statutory $0.
Latent today because of M4, but will go live the moment childrenUnder6 is wired.

### M6. NJ CTC shape wrong (when it goes live)
Engine: $1,000/child linear phase $50k→$80k. Actual NJ-1040: step tiers — $1,000 (NJTI ≤$30k),
$800 (≤$40k), $600 (≤$50k), $400 (≤$60k), $200 (≤$80k), $0 above. Over-credits $30k-$50k
households by $200-$400/child. Latent (M4).

### M7. CO child credit model matches neither CO credit
Engine "$1,200 <6 + $200 6-15, full ≤$25k/$35k, zero ≥$85k/$95k" resembles neither the CO CTC
(% of federal CTC by AGI tier, children <6) nor the new Family Affordability Tax Credit
(HB24-1311: TY2024 up to $3,200/child <6 and $2,400/child 6-16, TABOR-funded and
surplus-variable by year). Under-credits low-income CO families (only the $200 sliver fires —
see M4). Moderate confidence on exact FATC amounts (year-variable); direction certain.

### M8. MA millionaire-surtax threshold not indexed for 2026
Engine holds $1,083,150 (2025) into 2026; MA DOR: TY2026 threshold = $1,107,750. Over-taxes
4% × $24,600 = ~$984 max for affected filers. (2024/2025 values verified correct.)

### M9. NY TY2026 middle-class rate cut missing
FY2026 NY budget (A3009, signed 5/9/2025): the five lowest brackets (4/4.5/5.25/5.5/6%) drop
0.1pp for TY2026 (another 0.1pp TY2027); top-bracket surcharge extended through 2032 (engine's
top rates remain right). Engine 2026 = 2024 rates → over-tax up to ~$300 (income ~$323k MFJ).

### M10. Mississippi std-ded fold-in is internally inconsistent (all years)
Single $12,300 = $2,300 std + $10k 0%-band but omits the $6,000 personal exemption → over-tax
$282 (4.7%). MFJ $24,600 = $4,600 + 2×$10k — but MS's $10k 0% band does NOT double for MFJ,
and the $12,000 MFJ exemption is omitted → net over-tax ~$94. HoH $18,300 matches no
decomposition. Suggest modeling exemption via `personalExemption` and the 0% band as a real
bracket. (Global "exemptions not modeled" disclaimer partially covers this — but MS folded SOME
of it in, inconsistently.)

### M11. GA dependent exemption not modeled
GA kept a per-dependent exemption ($3,000 TY2024; $4,000 TY2025+ per HB 136) alongside the new
$12k/$24k std ded. Engine has no GA `personalExemptionPerDependent` → over-tax ~$162-216/child.

### M12. PA "Working Family Tax Credit" placeholder is wrong twice
`calculateStateAdditionalCredits` PA block ships a $0 placeholder claiming the credit flows via
the state-EITC piggyback path — but PA is NOT in `STATE_EITC_PCT_OF_FEDERAL` (so nothing flows),
and PA has no EITC; PA's actual refundable credit is the **Child & Dependent Care Enhancement
Tax Credit = 100% of the federal CDCC (TY2023+)**, which is entirely unmodeled (worth up to
$2,100 for PA families).

### M13. `calculateStateTaxWithBreakdown` diverges from `calculateStateTax`
Used by routes/tax-returns.ts:879 (breakdown endpoint) + planningEngine.ts:271 (state marginal
rate). It skips: WI sliding std ded, personal exemptions (IL/IN/NJ/VT cliff), retirement/SS
exclusions, OR subtraction, PA forgiveness, CT branches — so the displayed breakdown/planning
marginal rate can contradict the actual computed liability (e.g. an IL filer shows 0 exemption;
a PA low-income filer's marginal shows 3.07% where effective is forgiven). Display/planning only.

### M14. MN year-pinning (partially documented)
2025/2026 MN brackets pinned at 2024 (documented sub-gap; ~2.5%/yr drift = over-tax); 2026 std
ded held at the 2025 values (MN announces its own — not documented); MN WFC/CTC parameters
($9,220 base cap, $970/$2,210/$2,630 add-ons, $1,750 CTC, $31,090/$36,880 thresholds,
$11,600 investment cap) all pinned at TY2024 — MN indexes these annually (TY2025 CTC ≈ $1,850 —
moderate confidence). Same year-pinning applies to the WI EITC-adjacent sliding std ded (noted
in code) and WI brackets.

### M15. stateMandate.ts — `FPL_GUIDELINE_BY_YEAR` has no 2026 key and falls back to 2024
`householdFplPercent` does `FPL_GUIDELINE_BY_YEAR[taxYear] ?? [2024]` → a TY2026 MA filer's
FPL% is computed on the 2024 guidelines ($15,060 base) instead of ≥2025's $15,650 → FPL%
overstated → possible one-tier-too-high penalty. Should hold the latest year (2025) like the
tier tables do. (2023/2024/2025 guideline values themselves verified correct: $14,580/$15,060/
$15,650 + per-person $5,140/$5,380/$5,500.)

### M16. CA 2025 bracket/std-ded values are ~3% estimates, not FTB-published figures
Code admits "inflation-adjusted ~3%". FTB published the actual 2025 schedule (announced
Oct 2025); the engine's $11,079/.../$5,707 are close but not authoritative; 2026 clones them.
Low dollar error but the file claims "real where states have published (CA …)". Verify against
the FTB 2025 rate schedules and replace.

### M17. Mandate dollar values partially unverified for 2025
CA $950/$475 (2025) and DC $745→$795 (2024→2025) in `GREATER_OF_PARAMS_BY_YEAR` could not be
confirmed against FTB 3853 2025 instructions / DC HBX notices in this audit (moderate
confidence; the 2024 CA $900/$450, NJ/RI frozen $695/$347.50, MA TIR 24-1/25-1 tiers and the
CA filing-threshold table all check out). Flag for primary-source confirmation.

---

## LOW

- **L1. WA excise 2026 deduction** held at $278,000 (2025 value verified ✓); 2026 will be
  inflation-indexed higher (~$286k). The `taxYear >= 2025` ternary needs a 2026 row. ($1M
  surcharge threshold correctly NOT indexed ✓.)
- **L2. IL personal exemption 2025/2026** held at $2,775; IL announced $2,850 for 2025
  (moderate confidence). ~$3.7/person.
- **L3. OR**: 2025/2026 std ded held at 2024 ($2,745/$5,495; actual 2025 ≈ $2,805/$5,610), and
  the fed-tax-subtraction caps for 2025/2026 ($8,500/$4,250) are labeled "held pending official
  publication" (actual 2025 ≈ $8,490 — verify).
- **L4. Generic 2025/2026 bracket-indexing drift** for inflation-indexed graduated states held
  at 2024: ME, ND, RI, VT, WI, MT, SC bracket edges, AL/AR/KS(†C1) std deds. Each ≤ ~$50.
  (NY/NJ/CT/DC statutory brackets correctly static.)
- **L5. MD std-ded 15%-of-AGI phase-in** (min $1,800) not modeled — engine always grants the
  max; moot for 2025+ once H2 fixes land (flat $3,350/$6,700).
- **L6. NH 2024 3% interest/dividends tax** not modeled (documented note; tax repealed 1/1/2025
  so only TY2024 I&D filers affected).
- **L7. UT taxpayer credit** (6% of deductions+exemptions, phased out ~$18k/$36k+) not modeled
  (documented). Over-taxes low-income UT filers slightly; high-income unaffected (credit phases
  out anyway).
- **L8. CO EITC 2026 = 25%** (engine) — HB24-1134 default schedule; some TABOR-conditional
  bump possibilities. Moderate confidence; re-verify when DR 0104CR 2026 publishes.
  (2024 = 50% ✓, 2025 = 35% ✓ verified.)
- **L9. AZ conformity timing**: AZ std ded is treated as OBBBA-conformed for 2025 ($15,750).
  AZ uses annually-updated fixed-date conformity; the 2026 session bill must adopt the
  post-OBBBA IRC for this to hold for TY2025 (historically routine). Note, don't change.
- **L10. `stateTaxData.ts` stale notes**: SC note still says "dropped to 6.4% for 2024" while
  the bracket correctly uses 6.2%; CT note says pension/IRA exclusion "not modeled" though it
  now is (calculateStateTax CT branch); STATES_TAXING_SS comment likewise stale re CT.
  Cosmetic only.

---

## VERIFIED CLEAN (explicitly checked, no change needed)

- **Flat rates**: KY 4.0/4.0/3.5 (24/25/26) + std ded $3,160/$3,270/$3,360 ✓; OH 2.75-3.5 (24),
  3.125 top (25), flat 2.75 over $26,050 (26) ✓; IA 4.4/4.82/5.7 (24) → flat 3.8% (25/26) ✓;
  GA 5.39 (24) / 5.19 (25) ✓; NC 4.5 / 4.25 ✓; IN 3.05 / 3.0 ✓; MS 4.7 / 4.4 ✓; ID 5.695 (24) /
  5.3 (25-26) ✓; SC 6.2 (24) / 6.0 (25-26) ✓ (0%/3% lower brackets ✓); UT 4.55 / 4.50 ✓;
  NE 5.84 (24) / 5.2 (25) ✓; AZ 2.5% ✓; PA 3.07% ✓; MI 4.25% ✓ (exemption gap documented);
  CO 4.25% TY2024 ✓; MA 5% ✓; NC/GA/LA/MS 2024 baselines ✓. (2026 gaps listed at H5.)
- **No-income-tax set** (AK FL NV NH SD TN TX WA WY) ✓.
- **Graduated 2024 tables**: CA (exact FTB 2024 ✓ incl. $5,540/$11,080 std ded), NY (incl.
  $8,000/$16,050 std ded), NJ, CT (2024 2%/4.5% rate cuts present ✓), DC brackets, DE, HI-2024,
  ME-2024, MD-2024, MN-2024 (+2025 std ded $14,950/$29,900/$22,500 ✓), MO-2024 brackets,
  MT-2024 (2-bracket $20,500/$41,000 ✓), OK, OR (incl. $125k/$250k 9.9% breaks), RI, VT-2024
  (brackets + $7,400/$14,850/$11,150 std ded ✓), VA brackets, WI-2024 (3.50/4.40 ✓), AL, AR
  (top 3.9% ✓, simplified low-income table documented), KS-pre-2024-law-only (†C1), NM-rate-set
  (†C3 thresholds), LA-2024 ✓.
- **MN removed from / AZ added to FED_CONFORMING_STD_DED_STATES** — both correct calls ✓;
  CO/ID/IA/MO/MT/NM/ND/SC conformity itself correct ✓ (OBBBA flows through rolling/annual
  conformity; ME should JOIN the set — H9; DC must NOT — M1).
- **WI sliding std ded** — all four status formulas reproduce the 2024 table ✓ (year-pinning M14).
- **IL exemption** $2,775 + $2,775/dep + the $250k/$500k CLIFF ✓ (2024); IN $1,000/$1,000 ✓;
  NJ $1,000/$1,500 ✓; VT dependent exemption mechanism ✓ (amount †M3).
- **CT retirement exclusion**: 100% pension base + IRA 50/75/100% (24/25/26) ✓ per
  §12-701(a)(20)(B)/PA 23-204; phase-out decimals (.85/.70/.55/.40/.25/.10/.05/.025 over
  $75k→$100k single-band / $100k→$150k joint-band) match the CT-1040 table ✓; HoH single-like
  here vs MFJ-like for SS ✓ (deliberate, correct).
- **NJ pension exclusion**: caps $100k/$75k/$50k, tiers 50/37.5/25% and 25/18.75/12.5%,
  $150k cliff, age 62 ✓. NY $20k/$40k + unlimited govt pension (Line 26/29) ✓ (per-spouse
  cap approximation documented). PA/IL/MS full exemptions ✓; HI employer-funded cap ✓.
  GA retirement exclusion $35k (62-64) / $65k (65+) per qualifying spouse ✓.
- **State EITC percentages**: NY 30% ✓, NJ 40% ✓, MA 40% ✓, IL 20% ✓, CO 50/35 (24/25) ✓,
  CT 40% ✓, DE 4.5% ✓, IN 10% ✓, IA 15% ✓, KS 17% ✓ (KS EITC survives SB1), LA 5% ✓, MT 10% ✓,
  NE 10% ✓, NM 25% ✓, OH 30% ✓ (refundable-treatment simplification documented), OK 5% ✓,
  OR 9% ✓ (12%-under-3 simplification documented), RI 16% ✓, VT 38% ✓, VA 15% ✓, ME 25% ✓,
  MI 30% ✓, WI 4/11/34% ✓, MD two-component max(45% refundable, min(50%, tax)) ✓ (Family
  Prosperity Act made 45% permanent ✓). CA CalEITC table values plausible (FTB-indexed;
  2025/2026 flagged as estimates in code ✓ documented).
- **NYC**: EIC bands (30→10% with linear transitions, 10% floor) ✓; school credit $63/$125
  <$250k ✓; household credit tables ✓; MCTMT SE flat 0.60% > $50k ✓; UBT (4%, $5k exemption,
  $3,400-$5,400 credit slope) ✓; Yonkers 16.75% ✓.
- **Surtaxes**: MA $1,053,750 (24) / $1,083,150 (25) ✓ on TAXABLE income ✓; CA 1% MHST > $1M
  taxable ✓. (2026 MA †M8.)
- **State AMT**: CO 3.47% on the federal AMT base ✓; CT lesser-of(19%×TMT, 5.5%×AMTI) ✓;
  MN 6.75% + §290.091 exemptions (documented approximation) ✓-ish. (CA †H4.)
- **WA excise**: $270k/$278k (24/25) ✓ verified vs WA DOR; 7% + 2.9% surcharge on TAXABLE gains
  > $1M (= 9.9% tier) ✓; surcharge threshold un-indexed ✓; deduction ordering ✓.
- **stateMandate.ts**: structure (greater-of flat/2.5%, bronze cap, ≤5-person headcount,
  proration) ✓; NJ/RI frozen $695/$347.50 ✓; NJ $10k/$20k threshold ✓; RI/DC federal-std-ded
  threshold proxy ✓ reasonable; CA 2024 $900/$450 ✓; CA FTB-3853 filing-threshold table
  (17,818/33,185/44,710…) ✓; MA TIR 24-1 ($24/48/71/109/127/175) + TIR 25-1
  ($25/49/73/113/132/187) tier schedules ✓; MA ≤150% FPL = $0 ✓; children not penalized in
  MA ✓. (2025 CA/DC flat amounts †M17; 2026 FPL fallback †M15.)
- **Reciprocity table** spot-checked (DC/MD/VA, NJ↔PA, KY/IL/IN/MI/OH/VA/WV/WI, MI↔MN,
  MN↔ND, MT↔ND) ✓ consistent with published agreements.
- **Engine wiring**: SS exclusion threaded ✓; NJ gross = AGI − taxable SS ✓; surtax on taxable
  (STL-03) ✓; part-year proration of std ded/exemption ✓; muni-bond addback / Treasury
  subtraction signs ✓; MD EITC capped by pre-credit state tax ✓.

## Suggested fix order
C5 (PA double-apply — small diff, big correctness), C1 (KS), H1 (CO 2025 one-liner),
H5 (2026 rates — mechanical), C4 (WV 2024), C3 (NM), C2 (HI), H4 (CA AMT), H2 (MD 2025),
H3 (SS thresholds — needs per-state branches like CT/WV), then H6-H10, then the M items.
Add a freshness CI test asserting each year's table against a pinned DOR-sourced fixture
(the existing year-coverage test only checks finiteness/monotonicity, which caught none of
these).
