# Full-App Maximum Audit — 2026-06-08 (T0.3)

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
