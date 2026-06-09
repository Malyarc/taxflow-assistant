# Full-App Maximum Audit — 2026-06-08 (T0.3)

## FINAL OUTCOME — ZERO DEFERRALS REMAINING (2026-06-09 close-out, +8 commits, shipped + deployed + prod-verified)
Every remaining deferred finding is now FIXED. The 8 closing commits (`869d39a` F3+E2,
`a64d5c0` state-batch-3, `772b276` M4, `17671c2` SCH1, `3cfd96f` PDF2, `6050ccc` FE1+FE3,
`ae19308` runner) were deployed to prod (migration 0015 applied, api-server rebuilt, frontend
rsynced, re-scored, health + SCH1/M4 + seeded-client + PDF prod-smoked green). Each item is
primary-source-verified and carries hand-calc'd regressions.

| Item | What shipped | Verification |
|---|---|---|
| **F3** §1250/28% loss-absorption | A coexisting LT loss now erodes the 28% bucket first, then §1250; buckets bounded by `grossPositiveLt` (undercount-only → never under-tax). | section1250-1231 suite (92) + audit file |
| **E2** MFJ per-spouse Sch SE | Opt-in `spouse` tag on a self_employment_income adjustment (migration 0014); default stays the conservative over-tax. | audit file (2 cases) |
| **S10 WV SS phase-out** | HB 4880 decreasing modification 35%/65%/100% above $50k/$100k AGI; 100% exempt at/below the floor (≤). | audit file (5 cases), TIR-cited |
| **M3 MA mandate** | TY2024/2025 6-tier schedules from MA DOR **TIR 24-1** ($24/48/71/109/127/175) + **TIR 25-1** ($25/49/73/113/132/187); 2026 holds 2025. | audit file (5 cases), primary-source |
| **MD-08 graduated counties** | Anne Arundel + Frederick graduated local brackets (single vs joint columns) via a new `localBrackets` path on LocalityInfo. | audit file (5 cases), MD Comptroller table |
| **M4** CA mandate threshold + bronze cap | CA % method now uses the FTB 3853 household-size filing threshold (2024/2025); §5000A bronze cap counts ≤5 individuals (CA/NJ/RI/DC). | audit file (11 cases), FTB-cited; prod-smoked |
| **SCH1** surface T1.1 outputs | 4 persisted scalar columns (migration 0015) + openapi TaxReturn fields + UI disclosure rows for mandate / §1250 / 28% / Schedule H. | new integration suite (11), prod-smoked exact values |
| **PDF2** PDF disclosure rows | Summary PDF nets §72(t)/HSA/Sch-H out of the "regular tax" line and discloses each + §1250/28% + mandate. | pypdf-verified render + integration PDF asserts |
| **FE1** Assets money inputs | 3 H5 Assets dialog dollar fields `<Input type=number>` → `<CurrencyInput>`. | typecheck + build |
| **FE3** delta colors | `amendDeltaClass`/`yoyDeltaClass` — refund/credit/payment/deduction lines green-on-increase, tax/income red-on-increase (1040-X 3 tables + year-compare). | typecheck + build |
| **CF3** §469(i) MFS PAL | MFS-lived-WITH-spouse now barred from the $25k rental special allowance ($0, full loss suspended) per §469(i)(5)(B); only MFS-lived-apart-all-year gets $12,500. New `mfsLivedApartAllYear` gate on the PAL helper. | audit file (5 cases) |
| **E4** §219(g)(7) spouse-covered IRA | Taxpayer-not-covered/spouse-covered now uses the separate higher MFJ phase-out band ($230k-$240k 2024 / $236k-$246k 2025 / $242k-$252k 2026). New `iraSpouseCoveredByWorkplacePlan` field (migration 0016) + ClientForm checkbox. | audit file (5 cases), IRS-verified |
| **A3** 1099-G refund taxability | NO fix needed — the pipeline already auto-derives `priorYearItemized` from the prior-year return when the CPA hasn't set it, so §111 applies correctly. Resolved-by-design. | pipeline code |

Audit regression file `tax-engine-audit-2026-06-08-tests.ts` now **106** assertions; new
`tax-engine-sch1-surface-integration-tests.ts` (11). Full green bar: 4 typechecks clean, 80 no-API
suites / 4,769 parsed assertions + the 96 audit + property harness (5,636 runs) green, all yes-API
integration suites green. **No deferred items remain from this audit.**

## FINAL OUTCOME — FIX-ALL PASS (14 commits, all shipped + deployed + prod-verified)
After the initial 4-commit audit ship (below), a full "fix every remaining finding" pass landed 10
more commits (`335bde7` C1 · `cf90947` C3 · `d08481b` C4+CF2 · `ce3a943` E1 · `<E3b>` · `43042cd` AI
A1/A2 · `fa3f113` state · `67c563d` NYC-EIC+L1b · `bc7df0d` planning Q1/Q2/Q4 · `50d0083` forms+frontend).
**80 no-API suites / 4,769 + the property harness (5,636 runs) + all 12 integration suites green; prod
smoke-verified (E3b kiddie $2,498, KY-2025 $3,069.20, F2 AMT, WI rate).**

**SHIPPED in the fix-all pass (every value hand-calc'd vs the primary source):**
- **E3b** dependent/kiddie §63(c)(5) limited std deduction (was a full-std-ded under-tax LOCKED BY a
  wrong-expectation test — K8a-d + S7 reworked). New `claimedAsDependent` field (migration 0012).
- **C1** credit ordering — CTC now applied AFTER the Schedule-3 credits (Sch 8812 worksheet) so
  dep-care/education aren't wasted (HoH $30k+1 child+$3k dep-care: refund +$510).
- **C3** AMT MFS §55(d)(3) phantom add-back. **C4** IRA MAGI adds back SLI+FEIE (Pub 590-A). **CF2**
  auto-load NOL/§163(j) carryforwards. **E1** EITC qualifying-children count (new field, migration 0013).
- **A1** 1098 Box 4 nets mortgage interest; **A2** 1099-INT Box 2 above-the-line deduction (was dropped).
- **State:** KY 2025 = 4.0% (BUG — code had 3.5%; that's 2026) + KY 2026; MN removed from conforming
  (own std ded $14,950); AZ added to conforming; MA surtax 2025 $1,083,150; MD/IN county rates
  (Cecil/StMarys/Allen/Vanderburgh); DC/CA mandate year-indexing.
- **L1** NYC EIC IT-215 staircase + interpolation + 10% floor; **L1b** (a worse bug L1 exposed) — the
  NYC EIC was wrongly reducing EVERY locality's tax (MD/PA/OH) → now gated to NYC only.
- **Planning Q1** (Saver's $0-collapse → use the engine's actual credit), **Q2** (EV false
  "engine-verified" → conditional estimate), **Q4** (§139 disaster → fire only on a real marker).
- **PDF1** Form 1040 substitute Lines 20-24/33; **PDF3** Form 2210 adoption refundable; **FE2** 36
  missing TYPE_LABELS; **FE4** fmt NaN guard.

**STILL DEFERRED (documented — conservative/over-tax direction OR needs a new structural path):**
F3 §1250/28% loss-absorption shielding (conservative over-charge; the exact fix needs lot-level loss
tracking the aggregate engine lacks — under-tax risk). E2 MFJ-SE attribution (conservative; clean
1099-NEC-spouse-tag workaround exists). WV SS phase-out 2024/25 (under-taxes the narrow high-income-WV-
retiree-with-SS case; needs a year+income-floor+% handler). MD Anne Arundel/Frederick graduated
brackets (needs a graduated-locality path). MA mandate >300% FPL schedule (provisional, flagged in code).
PDF2 (pdfExport mandate/Sch-H disclosure rows), SCH1 (surface T1.1 outputs in the openapi TaxReturn
schema + UI), FE1/FE3 (SPA cosmetic — Haven replaces the SPA).

---

## FINAL OUTCOME (initial 4-commit audit ship: 5fdb104 / f2cb6b7 / d0914fe / adc5d56)
**SHIPPED (hand-calc-tested + 80 no-API suites/4,769 + fast-check harness 5,636 runs +
12 integration suites + prod smoke):** F1 (CRITICAL AI-1099 formType drop, +2 sibling sites a
/code-review caught), F2 (CRITICAL AMT std-ded addback, state-AMT isolated), C2 (NIIT §1231 cap),
F4 (MFS LTCG breakpoint), F5 (W-2 2026 SS base), SEC1/2/3 (engine totality + horizonYears +
arrays — DoS), effRate guard, Q3 (Saver's year-index), 6 state rates (WI/ID/CO/SC/OH/NE, each
DOR-verified). New machine harness `tax-engine-property-harness.ts` (property/fuzz/boundary/
metamorphic — a T0.3-A1 deliverable) + `tax-engine-audit-2026-06-08-tests.ts` (31).

**DEFERRED — prioritized follow-up (each has a repro + fix direction below):**
1. **E3b dependent/kiddie std deduction** (§63(c)(5)) — HIGH under-tax; LOCKED BY A WRONG-EXPECTATION
   TEST (deep-audit K8a-d). Needs a `claimedAsDependent`/`isKiddieTaxFiler` std-ded clamp + K8 rework.
2. **C1 credit ordering** — HIGH; CTC applied before the Sch-3 credits (reverses Sch 8812 limit wksht
   → wastes non-carryforward dependent-care/education credits). Reshuffles many tests — do carefully.
3. **C4 IRA-deduction MAGI** must add back SLI + FEIE (Pub 590-A Wksht 1-1) — over-allows IRA in the
   phase-out band. Delicate (the MAGI bootstrap invariant).
4. **E1 EITC qualifying-children** count reuses dependentsUnder17 (drops a tier for 17-23) — needs a field.
5. **A1/A2 AI** 1098 Box 4 net + 1099-INT Box 2 early-withdrawal deduction (extracted, never consumed).
6. **PDF1** Form 1040 substitute: Line 24 pre-credit, Line 33 missing refundables, Lines 20-22 blank.
7. **SCH1/FE2** surface T1.1 outputs (mandate/SchH/4797/§1250-28) in openapi+UI; TYPE_LABELS missing 36.
8. **Planning Q1 (Saver's $0-verify collapse), Q2 (EV provenance), Q4 (§139 false-positive).**
9. **CF2** NOL/§163(j) carryforward auto-load; **C3** AMT MFS §55(d)(3); **E2** MFJ-SE attribution.
10. **F3** §1250/28% loss-absorption shielding (conservative); **M1/M2** DC/CA mandate year-index;
    state **MN-conforming / MA-surtax-COLA / AZ-std-ded / WV-SS / KY-2026**; **L1** NYC-EITC; **L2/L3** MD/IN county.

---

Findings ledger from the 14-agent fleet + machine-driven harness + integration run.
Baseline: HEAD `66bcbcc`, 4,769 no-API assertions green. Each finding adjudicated by
the lead against the primary source before fix. Status: OPEN / CONFIRMED / FIXED / REFUTED / DEFERRED.

## Adjudication rule
Agent claims on subtle domain law are NOT trusted on consensus — every numeric change is
re-verified against the IRS/state primary source (statute / form worksheet) before editing.

---

## SHIP STATUS — commit 1 (Ship Set A, engine-correctness + DoS hardening + harness)
**FIXED + hand-calc-tested + battery-green (80 suites / 4,769+ + new audit suite + property harness 5,636 runs):**
F1, F2 (+ state-AMT isolation refactor), F4, F5, C2, SEC1 (toNum clamp → engine total), SEC2
(horizonYears openapi max + rothOptimizer clamp), P1 (effectiveTaxRate denormal guard), X-pure
(dropped console.warn from pure seam). New: `tax-engine-audit-2026-06-08-tests.ts` (14) +
`tax-engine-property-harness.ts` (fast-check property/fuzz/boundary/metamorphic). 22 AMT test
expectations across 6 suites re-hand-calc'd for the std-ded addback (each Δ = stdDed×AMT-rate).
4 stale live-API integration expectations corrected (OBBBA $15,750 std ded ×3 + §461(l) Sch-C-loss).
**F3 DEFERRED** — conservative (over-charges, never under), correct fix intricate (risks an
under-tax bug); documented sub-gap. **repaymentCap=Infinity** = intentional §36B no-cap sentinel
(guarded by Number.isFinite everywhere, JSON→null) — not a bug.

## TIER 1 — CONFIRMED, fix now (clear + safe + high-impact)

| ID | Sev | Area | File:line | Issue | Status |
|----|-----|------|-----------|-------|--------|
| F1 | CRITICAL | AI extract | openapi `ApproveExtractionBody.formType` (2221) uppercase `[NEC,INT,...]`; documents.ts:456 inserts verbatim; engine summarize1099s filters lowercase `==="int"` | Every AI-approved 1099 stored UPPERCASE → engine drops ALL its income silently. | **FIXED** |
| F2 | CRITICAL/HIGH | AMT | taxReturnEngine.ts:2962 `totalAmtPreferences` (no std-ded addback); `taxableIncome: taxableAfterObbba` already net | Std-deduction filers who hit AMT: AMTI understated by the full std ded (Form 6251 line 2a / §56(b)(1)(E)). Repro single $250k+$300k ISO → $4,088 under. (State AMT kept on shared prefs — federal-only addback.) | **FIXED** |
| F3 | MEDIUM | Cap gains | taxReturnEngine.ts:2902-2913 `unrecaptured1250Bounded`/`collectibles28Bounded` | §1250/28% buckets over-stated when a cap LOSS coexists with a plain 0/15/20 LT gain. Over-charge ~$2,600. Conservative direction. | DEFERRED (conservative; intricate fix) |
| F4 | LOW | Cap gains | taxCalculator.ts:5738 LTCG_BRACKETS[2024].MFS `upTo:291875` | Rev.Proc.2023-34 + Sch D wksht = $291,850. ≤$25 band. | **FIXED** |
| F5 | MEDIUM | AI extract / val | lib/validation/src/w2Validation.ts:48 `SS_WAGE_BASE_BY_YEAR` missing 2026 | TY2026 W-2 Box-3 cap check silently skipped. | **FIXED** |

## SHIP STATUS — commit 2 (F1b /code-review catch + Ship Set B state rates)
**/code-review max on commit 1 caught a REAL incomplete-fix (author-blindness):** F1 healed
`summarize1099s` but TWO sibling consumers still matched `formType` case-sensitively —
taxReturnEngine.ts:1985 (MFJ per-spouse SE split → a legacy uppercase "NEC" dropped → **$7,064
SE-tax understatement**) + :1460 (DIV cap-gain distributions when capital txns present → **$10k
LTCG dropped**). Both UNDER-tax (unsafe direction). **FIXED** all formType reads to
`(r.formType ?? "").toLowerCase()`; added F1b regression (uppercase ≡ lowercase on both paths).
Everything else in commit 1 verified CLEAN by both reviewers (F2 state-AMT isolation, C2 cap,
toNum clamp, effRate guard, MFS breakpoint).
**Ship Set B — state rates, each verified vs the state DOR/statute (WebSearch):** S1 WI 2024
3.54%/4.65%→3.50%/4.40% (§71.06); S3 ID 5.8%→5.695%(2024)/5.3%(2025, HB40); S4 CO 4.4%→4.25%
(2024 TABOR temp; 4.40% base restored 2025); S5 SC 6.4%→6.2%(2024)/6.0%(2025); S6 OH top
3.5%→3.125%(2025)/flat 2.75%(2026, HB96); S7 NE top 5.84%→5.20%(2025, LB754). +S-rate regression
block (8 assertions). 11 existing state-test expectations re-hand-calc'd for the corrected rates.
**Still DEFERRED to a follow-up (documented):** S2 MN-conforming, S8 MA-surtax-COLA, S9 AZ-std-ded,
S10 WV-SS, S11 KY-2026, L1 NYC-EITC, L2/L3 MD/IN county, M1/M2 DC/CA mandate — each needs its own
DOR verification + override; lower population than S1/S3-S7.

## TIER 2 — VERIFY vs primary source, then fix (state/local constants)

| ID | Sev | Area | Claim | Status |
|----|-----|------|-------|--------|
| S1 | HIGH | WI | TY2024 bottom two rates 3.54%/4.65% → should be 3.50%/4.40% (Wis.Stat.§71.06; 4.65%→4.40% took effect TY2023). stateTaxData.ts:814-821 | VERIFY |
| S2 | HIGH | MN | MN wrongly in FED_CONFORMING_STD_DED_STATES (115) → build2025Data overwrites MN std ded w/ federal $15,750 (correct MN 2025 = $14,950/$29,900). MN 2024 hardcoded $14,575 proves non-conformance. Brackets also stale. | VERIFY |
| S3 | HIGH | ID | flat 5.8% → 5.695% (2024, H.521) / 5.3% (2025, HB40). stateTaxData.ts:204, no 2025 override | VERIFY |
| S4 | MED | CO | 2024 4.4% → 4.25% (temp TABOR reduction). 2025 reverts 4.40% (ok). stateTaxData.ts:192 | VERIFY |
| S5 | MED | SC | top 6.4% → 6.2% (2024) / 6.0% (2025). stateTaxData.ts:751 | VERIFY |
| S6 | MED | OH | 2025 top 3.5%→3.125%; 2026 flat 2.75% over $26,050 (HB96 6/30/2025). No override → stale | VERIFY |
| S7 | MED | NE | 2025 top 5.84% → 5.20% (LB754). No override | VERIFY |
| S8 | MED | MA | surtax threshold 2025 $1,053,750 → $1,083,150 (COLA). No override | VERIFY |
| S9 | MED | AZ | std ded stale 2025/2026 (AZ couples to federal §63 but not in conforming set; 2025 ~$15,000) | VERIFY |
| S10 | MED | WV | missing from STATES_TAXING_SS for 2024/2025 (WV taxes SS w/ 35%/65% subtraction; exempt 2026). Engine excludes 100% → under-taxes 2024/25 | VERIFY |
| S11 | LOW | KY | 2026 stale (4%/$3,270 → 3.5%/$3,360; fiscal trigger). LATEST_YEAR=2025 so low | VERIFY |
| L1 | HIGH | NYC EITC | taxCalculator.ts:1963 nycEitcRateForAgi: wrong bands + illegal 5% floor (repealed TY2022; min is 10%; thresholds $20k/$40k/$42.5k). Drives federal AGI not NYAGI (sub-gap). | VERIFY |
| L2 | MED | MD county | Anne Arundel/Frederick graduated (modeled flat); Cecil 0.0280→0.0275; St.Mary's 0.0310→0.0300. taxCalculator.ts:816,822,825,833 | VERIFY |
| L3 | MED | IN county | Allen 0.0148→0.0159; Vanderburgh 0.0120→0.0125 (2024 DOR). taxCalculator.ts:861,870 | VERIFY |

## TIER 3 — careful / higher-risk (touch many tests or edge cases)

| ID | Sev | Area | Issue | Status |
|----|-----|------|-------|--------|
| C1 | HIGH | Credit order | CTC applied BEFORE Sch-3 credits (FTC/dep-care/education/Saver's/energy) — reverses Sch 8812 Credit Limit Wksht (CTC limit = tax AFTER those). Non-carryforward credits (dep-care/education) lost when CTC zeros tax first. Repro HoH $30k 1 child $3k dep-care → shorted $510. CLAUDE.md invariant #2 encodes the buggy order. | VERIFY (delicate) |
| C2 | HIGH | NIIT | §1231 non-passive exclusion subtracts GROSS form4797 §1231 gain even when a cap loss eroded surviving LTCG below it → wipes unrelated NII (interest/div). Repro ~$1,900 under. taxReturnEngine.ts:3022 | CONFIRMED |
| C3 | MED | AMT MFS | §55(d)(3) flush: MFS AMTI += min(rate×(AMTI−zeroAt), exemption) missing. Narrow (high-AMTI MFS). taxCalculator.ts:6742+ | CONFIRMED |
| C4 | MED | IRA MAGI | IRA-deduction MAGI must add back SLI + FEIE (Pub 590-A Wksht 1-1); code subtracts SLI → over-allows IRA in phase-out band. taxReturnEngine.ts:2550 | VERIFY |

## TIER 4 — data-model gaps / planning / AI (fix-if-quick else document)

| ID | Sev | Area | Issue | Status |
|----|-----|------|-------|--------|
| Q1 | HIGH | Planning | G1.31 Saver's verifiedSavings collapses to $0 (what-if ADDS another $2k atop existing → §25B $2k cap → no change). Hides valid credit in hit-list. planningEngine.ts:3339 | CONFIRMED |
| Q2 | HIGH | Planning | G1.33 Clean Vehicle fires for everyone under MAGI cap, headlined "$7,500 engine-verified", ranks #1, no EV signal. planningEngine.ts:2896 | CONFIRMED |
| Q3 | MED | Planning | G1.31 Saver's AGI bands hardcoded TY2024, applied all years → wrong rate TY2025+. planningEngine.ts:3260 | CONFIRMED |
| Q4 | MED | Planning | G1.91 §139 disaster fires for any filer in disaster-prone state >$100k, no disaster signal. planningEngine.ts:7512 | CONFIRMED |
| A1 | HIGH | AI extract | 1098 Box 4 (refund of overpaid interest) never netted vs Box 1 mortgage interest; field not in ApproveExtractionBody. documentExtractor.ts:628 | VERIFY |
| A2 | HIGH | AI extract | 1099-INT Box 2 early-withdrawal penalty extracted+stored but never consumed (no above-the-line §62(a)(9) deduction). summarize1099s only reads 1099-R. | VERIFY |
| A3 | MED | AI extract | 1099-G stateLocalRefund: approve doesn't prompt/set client.priorYearItemized (defaults false → refund non-taxable even if itemized last yr). | DOC |
| E1 | MED | Engine income | EITC qualifying-children count reuses dependentsUnder17 → drops a tier for 17-23 (§32(c)(3) <19/<24-student). Needs new field. taxReturnEngine.ts:3540 | VERIFY |
| E2 | MED | Engine income | MFJ Sch SE OASDI: no spouse attribution → passes w2SsWages=0 → over-taxes SE when same spouse has high W-2 (≥SS base)+Sch C via adjustment (no spouse field). Conservative direction. taxReturnEngine.ts:2012 | VERIFY |
| E3 | LOW | Engine income | Dependent-of-another limited std ded (§63(c)(5): greater of $1,300 or earned+$450) not modeled; full std ded always granted. | DOC |
| E4 | LOW | Engine income | Spousal "non-covered, spouse-covered" IRA phase-out band ($230-240k 2024) missing. taxCalculator.ts:4262 | DOC |
| SEC1 | MED | API | Unbounded numeric inputs: money fields bare zod.number() → 1e308 → numeric(12,2) 500 / what-if engine Infinity→null. Add min/max(+finite) in openapi + maxItems on what-if mutations. | CONFIRMED |
| SEC2 | HIGH(DoS) | API | `horizonYears` (roth-optimizer) Zod `.min(1)` no `.max()`/`.int()` → 1e8 → ~200M engine runs, hangs event loop, unauthenticated on demo. routes/planning.ts:744. Add `.int().max(75)` + clamp in rothOptimizer. | CONFIRMED |
| SEC3 | MED(DoS) | API | No maxItems on capitalTransactions/scheduleK1/rentalProperties/targetStates/mutations; O(N²) wash-sale. Add maxItems. | CONFIRMED |

## TIER 5 — carryforward / forms-PDF / frontend (last batch)

| ID | Sev | Area | Issue | Status |
|----|-----|------|-------|--------|
| E3b | HIGH | Engine | **Dependent/kiddie std ded** (§63(c)(5)): full std ded granted to dependent filers → big under-tax of kids w/ unearned income. **LOCKED BY WRONG-EXPECTATION TEST** (deep-audit K8a-d assert buggy values). Needs `claimedAsDependent` flag + clamp `min(reg, max(floor, earned+450))`. floor {2024:1300,2025:1350,2026:1350}. | CONFIRMED |
| CF2 | MED | Pipeline | NOL + §163(j) carryforwards NOT auto-loaded from prior year (every other CF is). synthesizePriorYearCarryforwards. | CONFIRMED |
| CF3 | LOW | Engine | §469(i) $12,500 MFS PAL allowance granted even when lived-together (need mfsLivedApartAllYear gate). taxCalculator.ts:5600 | CONFIRMED |
| PDF1 | HIGH | Form 1040 PDF | Line 24 uses pre-credit federalTaxLiability (should be −totalNonRefundableApplied); Line 33 missing EITC/ACTC/AOC-ref/PTC; Lines 20-22 never written. irsForm1040Pdf.ts | CONFIRMED |
| PDF2 | MED | pdfExport | "regular income tax" row absorbs §72(t)/HSA/SchH/excessAPTC w/o disclosure; state mandate reduces refund but no line → CA/NJ/MA/RI/DC state section doesn't reconcile. | CONFIRMED |
| PDF3 | MED | form2210 | adoption-credit refundable portion omitted from Line-4 payments (overstates penalty target, conservative). | CONFIRMED |
| FE1 | MED | Frontend | H5 Assets dialog uses `<Input type=number>` on 3 dollar fields (violates CurrencyInput). ClientDetail.tsx ~4251 | CONFIRMED |
| FE2 | MED | Frontend | TYPE_LABELS missing 36/121 adjustment types incl. all 7 T1.1 → unreachable in dropdown + raw key badge. | CONFIRMED |
| FE3 | LOW | Frontend | 1040-X + year-compare delta colors inverted for refund/credit/liability rows. | CONFIRMED |
| FE4 | LOW | Frontend | `fmt(Number(val))` → "$NaN" if a mandatory field undefined; CurrencyInput "-"/"." persist on blur. | CONFIRMED |
| SCH1 | MED | Schema/UI | T1.1 outputs (form4797, stateMandate, stateIndividualMandatePenalty, scheduleH, unrecaptured1250, collectibles28) NOT in openapi TaxReturn schema → Orval strips them → invisible in UI + exports though engine computes them. | CONFIRMED |
| X-pure | LOW | Purity | toNum() calls console.warn inside the pure seam (benign side-effect; collect into result instead for Haven). | NOTE |
| M1 | HIGH | Mandate | DC flat amounts frozen $695/$347.50 but DC indexes: 2024 $745/$372.50/$2,235; 2025 $795/$397.50. "frozen" comment wrong. stateMandate.ts:63 | CONFIRMED |
| M2 | MED | Mandate | CA flat stale 2025 ($900/$450 → $950/$475); not year-indexed. stateMandate.ts:59 | CONFIRMED |
| M3 | MED | Mandate | MA 2024/2025 schedule understated >300% FPL (top $183→$187; 150-200% $24→$25). Already flagged PROVISIONAL in code/tests. | CONFIRMED(known) |
| M4 | LOW | Mandate | bronze cap = flat×12×people (real caps are per-household-size, CA 5-person cap); CA/RI/DC %-threshold uses federal std ded not state filing threshold. Rarely binds. | DOC |

Mandate VERIFIED CORRECT: all 25 NR method-(a) states, §114 intangibles, former-state double-count fix, NR fraction guard, CT pension/IRA phase-out (byte-for-byte vs CT-1040 p.28), NJ/RI frozen $695.

## Integration-suite failures (live API @ :8080)
- integration-tests / new-features: "TY2025 std ded $15,000" → engine $15,750. **STALE pre-OBBBA test expectation** (engine correct). FIX TEST.
- scenarios: "TY2025 federal tax 10314 → 10149 (−165)". Likely stale (OBBBA std ded). INVESTIGATE.
- phase1-integration: "Total income $0 → −10000". INVESTIGATE (capital-loss sign?).
- (ai-overlay needs real AI key — environmental; pro-tier dual-state — run twice.)

## REFUTED / not-a-bug (verified)
- Cap-gains flat-25%/28% design (CONFIRMED CORRECT — IRC §1(h)(1)(E)/(F) "25 percent of"); global final-min correct; Form 4797 correct.
- QBI core mechanics, qbiPhaseInBand single-source, OBBBA $400 floor — correct.
- AMT exemptions/phaseouts/breakpoints (all 3 yrs), Part III flat 25/28 threading, ATNOLD 90% — correct.
- NIIT rate/thresholds/lesser-of/MAGI-FEIE — correct (except C2 edge).
- Most state core rates (CA/NY/NJ/PA/MA/VA/MI/MD/GA/NC/IN/MS/LA/IA/UT/...), conformity & SS sets (except MN/WV), EITC piggybacks — correct.
- MCTMT 0.60% flat, Yonkers 16.75%, NYC PIT/UBT, PA EIT (SE-incl), OH credit, KY caps, IN exemption — correct.
- API gates (auth constant-time, §7216 fail-closed both seams, pro-tier, PII no list-leak, no SSRF/path-traversal/SQLi) — correct.
- AI mappings 1098-T/1098-E/1095-A/SSA-1099/W-2G, prompt-injection whitelist, MIME magic-byte, transactional approve — correct.
