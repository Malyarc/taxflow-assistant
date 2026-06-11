# Tax-Planning Engine Audit — 2026-06-11

Auditor: fresh independent pass (read code, did NOT trust tests). Scope: `planningEngine.ts`, `planningEngineMultiYear.ts`, `whatIfEngine.ts`, `multiYearEngine.ts`, `multiYearOptimizer.ts`, `strategyComboOptimizer.ts`, `monteCarloEngine.ts`, `rothOptimizer.ts`, `planningCalendar.ts`, `lib/planning-strategies/`. All HIGH findings live-repro'd via tsx scripts importing the real modules.

All paths below are under `/home/user/taxflow-assistant/artifacts/api-server/src/lib/` unless noted.

---

## HIGH

### H1. Multi-year projection silently drops K-1, rental, per-lot capital-transaction, and Form 4797 income — every multi-year "engine-verified" number is wrong for those clients
- **Where:** `multiYearEngine.ts:120-145` (`projectYearForward` advances `taxYear` and scales dollars ONLY on `w2s` and `form1099s`; `scheduleK1`, `rentalProperties`, `capitalTransactions`, `form4797` pass through via `{...baseline}` with their original `taxYear`). The core engine filters those arrays STRICTLY by year: `taxReturnEngine.ts:1526` (capitalTransactions `t.taxYear === taxYear`), `:1849` (rentalProperties), `:1926` (scheduleK1), `:2359` (form4797). W-2s/1099s use a `?? taxYear` fallback; these four do not.
- **Effect:** in projection years ≥ 1, all K-1 / rental / 8949-lot / 4797 income vanishes from BOTH baseline and scenario trajectories, so every multi-year delta is computed at the wrong bracket.
- **Live repro 1:** single FL, $50k W-2 + $300k active S-corp K-1 → 3-yr trajectory AGI = [350,000, 51,500, 53,045]; fed tax [66,765, 4,052, 4,185]. Rental ($60k) + capital-transaction ($80k gain) client: AGI 190,000 → 51,500.
- **Live repro 2 (dollar materiality):** identical economics — $300k income + $600k embedded real-estate gain, 5-yr §453 installment (G1.47):
  - income as W-2: estSavings **$22,016** (sane bracket smoothing);
  - income as active S-corp K-1: estSavings **$75,284**, with `baselineYearTax = [180,998, 0, 0, 0, 0]` — a $300k/yr S-corp owner shown paying **$0** tax in years 1-4, and the spread gain landing in empty brackets. G1.47's assumptions text says "ENGINE-VERIFIED" (`planningEngine.ts:3931`).
- **Blast radius:** G1.3 bunching + G1.8 DAF (their `estSavings` PREFERS the multi-year engine number when positive — `planningEngine.ts:759-762, 867-870`), G1.4 Roth 5-yr `multiYear`, G1.47 installment headline, `rothOptimizer.projectRmdAvoidance` + ladder (`rothOptimizer.ts:170, 268`), `monteCarloEngine.runSinglePath` (`monteCarloEngine.ts:215`), and the multi-year trajectory API. Pure-W-2/1099 clients are unaffected. (`scheduleCAssets` are NOT year-filtered, so they survive — only the four arrays above drop.)
- **Fix shape:** advance `taxYear` (and optionally scale) on `scheduleK1` / `rentalProperties` / `capitalTransactions` / `form4797` in `projectYearForward`, mirroring `scaleW2`'s "CRITICAL: advance taxYear" comment.
- Severity: HIGH (verges on CRITICAL for a pass-through-heavy CPA book — the affected numbers are presented as engine-verified).

### H2. G1.34 (§25D) and G1.37 (§25C) label conditional purchases "engine-verified" — the exact pattern the repo's own 2026-06-08 Q2 audit fixed for G1.33
- **Where:** `planningEngine.ts:3002-3011` (G1.34 injects an assumed `$20k install × 30% = $6,000` credit via `residential_clean_energy` what-if), `:3585-3594` (G1.37 injects the assumed $5k heat-pump → $1,500). `annotateVerifiedSavings` (`:8274-8289`) then stamps `savingsSource: "engine-verified"` + `verifiedSavings` because the what-if has `semantics: "savings"`.
- **Live repro:** a client with mortgage interest and NO solar/heat-pump signal gets `G1.34: $6,000*` and `G1.37: $1,500*` (engine-verified) ranked above genuinely-applicable strategies.
- The G1.33 fix comment (`:2916-2923`) describes this exact failure ("the engine dutifully 'confirmed' the arithmetic → the hit was mislabeled engine-verified... for ANY filer under the MAGI cap with no EV signal") and sets `whatIf = undefined` — G1.34/G1.37 were not given the same treatment. The §36B "$7,000 IRA" optimizer in G1.30 (`:4258-4266`) is different in kind (the lever is universally available), but G1.34/G1.37 require buying hardware.
- Severity: HIGH (mislabeled provenance + misranking for every homeowner client; the repo itself classified this pattern as a bug).

---

## MEDIUM

### M1. G1.92 Solo-401(k): employee deferral not capped at compensation (§402(g) / §415(c)(1)(B))
- **Where:** `planningEngine.ts:7589-7603`. `totalContribution = min(employeeDeferral + employerMatch, SEP_ANNUAL_LIMIT)` — caps at the dollar limit but never at 100% of compensation (net SE − ½SE).
- **Live repro:** net SE $22,001 (comp ≈ $20,318) → recommends "$23,500 extra deferral", estSavings $2,350. The client cannot legally defer more than ~$20.3k total. Affects the firing band netSe ≈ $20k–$32k (common side-gig profile). The attached what-if applies the illegal $23.5k deduction (verified $511 — the dollar self-limits because taxable income runs out, but the recommended ACTION amount is wrong).
- Fix: `employeeDeferral = min(G1_92_EMPLOYEE_DEFERRAL[y], baseForContrib)` and `totalContribution = min(..., baseForContrib)`.

### M2. G1.61 §221 student-loan gate hardcoded at TY2024 phase-out tops → false-suppress for TY2025/2026
- **Where:** `planningEngine.ts:5250-5268`. Gate `G1_61_AGI_PHASE_OUT_TOP` = $95k single / $195k MFJ (TY2024, Rev. Proc. 2023-34) is NOT year-indexed, while the engine's `calculateStudentLoanInterest` (used for the amount) IS year-indexed.
- **Live repro:** TY2025 single AGI $97,000 → **no fire**, though the TY2025 band is $85k–$100k (Rev. Proc. 2024-40) and the engine would compute a ~$500 deduction. Control at $94k fires with the correct TY2025 phase-out math ($1,000 deductible — verifying only the gate is stale). False-suppress bands: TY2025 single $95k–$100k, MFJ $195k–$200k; wider for TY2026.

### M3. Wage-proxy detectors false-fire on clients with zero W-2 wages (K-1-only owners, landlords, investors)
- **G1.96 §132(f) transit** (`planningEngine.ts:7907-7911`): `wagesProxy = totalIncome − netSE` counts K-1/rental/investment income as wages. **Live-confirmed:** a K-1-only client (no W-2 at all) gets an **engine-verified** `$1,365*` "pre-tax transit/parking" hit — §132(f) requires an employer offering the benefit.
- **G1.72 RSU sell-to-cover** (`:6195-6206`): proxy nets out SE/retirement/UI/interest/dividends but not K-1/rental/capital gains. **Live-confirmed:** $500k-K-1 client with no W-2 → "$26,000 withholding gap" on an assumed $200k RSU.
- **G1.87 §401(a)(17)** (`:7200-7204`): same `totalIncome − seIncome` proxy → a K-1-only client with any IRA adjustment is told their "compensation" exceeds the qualified-plan cap.
- **G1.57 NQDC** (`:4997-5000`): uses raw `totalIncome` as the executive-comp signal.
- Fix shape: derive wages from `baselineInputs.w2s` (already plumbed for G1.96's what-if) or at least subtract `scheduleK1.totalActiveOrdinaryIncome` + rental + capital gains from the proxy.

### M4. G1.33 EV credit framing is dead law after 2025-09-30 (OBBBA termination) — assumptions don't carry the cutoff
- **Where:** `planningEngine.ts:2897-2963`. §30D/§25E terminated for vehicles acquired after **2025-09-30** (OBBBA). The catalog `validUntil 2025-12-31` keeps the strategy alive for all TY2025 returns (correct for purchases made before the cutoff), but the rationale says "If client buys a qualifying new EV **this year**" — advice that is wrong when read in Q4-2025 or 2026 (today), and none of the 7 assumptions mention September 30. The year-granular `isStrategyExpiredForYear` cannot express a mid-year sunset; the text must.

### M5. G1.17 S-corp comp split fires for owners already running a wage/distribution split — presents realized savings as new opportunity
- **Where:** `planningEngine.ts:2057-2105`. Fires on any `sCorpCount ≥ 1` + active K-1 ≥ $50k; never looks at existing W-2 wages paid by the S-corp (it doesn't receive `baselineInputs`/w2s). An owner already taking $200k comp + $300k distributions is shown "~$8,700 FICA savings" they already have. (The PLAN-07 SS-base math itself is correct — hand-checked $8,700 = $300k × 2.9% with comp ≥ wage base.)

### M6. G1.5 AMT-ISO heuristic claims the ENTIRE AMT as estSavings regardless of the ISO's contribution
- **Where:** `planningEngine.ts:1084-1117`. `estSavings = computed.amtTax` whenever any `amt_iso_bargain_element > 0`. With a $1k bargain and $40k SALT-addback-driven AMT, the hit claims $40k. The what-if corrects it when `baselineInputs` present, but the firm-wide hit-list path (no baselineInputs) ranks on the full AMT.

### M7. Heuristic mega-numbers dominate ranking over engine-verified strategies
- G1.39 QSBS: flat **$238,000** (assumed $1M gain × 23.8%) for ANY AGI ≥ $500k + K-1 client (`planningEngine.ts:3056-3071`) — live-confirmed as the #1 hit for a plain S-corp owner with zero QSBS signal. G1.20 easement: AGI × 30% × 37% (≥ $111k headline at $1M AGI). G1.19 CRT: min(LTCG, $500k) × 23.8%.
- These are labeled `savingsSource: "estimate"` and the assumptions are honest, but `liveHits.sort(headlineSavings)` (`:8881`) and the firm-wide `planning_score` rank them above engine-verified items; the planning tab's top recommendation for every HNW pass-through client becomes a hypothetical. Consider a ranking discount for `confidence < 0.5` informational flags or capping illustrative anchors.

### M8. G1.24 QOZ guidance is stale post-OBBBA
- **Where:** `planningEngine.ts:2599-2616`. Says deferral runs to 2026-12-31 and "new deferrals beyond are not currently available without legislation" — OBBBA enacted the permanent OZ 2.0 regime (rolling deferral for post-2026 investments). For a mid-2026 reader, deferral-to-Dec-2026 is nearly worthless and the "no legislation" claim is wrong. The detector still applies a 7.14% deferral-value multiplier to all gains.

---

## MEDIUM-LOW / LOW

1. **`Math.abs()` on signed deltas** — `annotateVerifiedSavings` (`planningEngine.ts:8277`), cross-strategy `combinedSavings` (`:8948-8952`), and sensitivity (`:126-130`) take `|combinedRefundDelta|` without checking sign. A "savings"-semantics mutation that nets a COST would display as positive engine-verified savings. G1.30 checks the sign explicitly (`optimizerBeneficial`); the generic paths don't. Latent — no live repro found, but cheap to guard.
2. **G1.46 spousal-IRA + G1.55 custodial-Roth caps hardcoded $7,000/$8,000** (`:3736-3737`, `:4858`) — TY2026 is $7,500/$8,600 (Notice 2025-67). G1.26 was year-indexed in the freshness sweep; these siblings were missed. Under-recommends only.
3. **G1.49 family employment**: wage anchor hardcoded `$14,600` (TY2024 std ded; `:4005`) — TY2025 $15,750 / TY2026 $16,100 (engine has `getFederalStandardDeduction`); heuristic uses flat 15.3% SE saving (actual ≈ 14.13% via the 0.9235 multiplier; 2.9% above the SS base); the H2 what-if models a generic deduction that does NOT reduce SE tax (a `schedule_c_depreciation`-style mutation would). Heuristic mildly over, verified mildly under.
4. **planningCalendar misclassifies in-year purchase credits**: G1.33/34/37 fall to the `credits → filing_deadline` category default (`planningCalendar.ts:63-72`) — live: G1.37 shows "April 15, 2026" for TY2025, but §25C/§25D property must be placed in service/paid by **Dec 31** (and §30D acquired by Sept 30, 2025). Dates themselves verified correct for TY2025/2026 (12/31, 1/15, 4/15, 10/15 — no weekend rolls needed those years; §7503 not modeled here).
5. **PTET rates pinned to TY2024** for all years (`STATE_PTET_REGIMES`, `:453-510`) — CO 4.4% vs 4.25% TY2025, IA flat-3.8% TY2025, LA 3% TY2025 etc. are in the notes but the math uses the TY2024 rate. Self-documented with a freshness banner + per-hit caveat; estimate drift only.
6. **G4 path skips the validUntil gate** — `evaluateMultiYearOpportunities` (`planningEngineMultiYear.ts:435-452`) has no `isStrategyExpiredForYear` filter (only `evaluatePlanningOpportunities` does). All 5 G4 entries are 2099 today, so latent only.
7. **DCFSA G1.32**: applies the full 7.65% FICA saving even for wages above the SS base (should be 1.45-2.35%); MFS $2,500 limit mentioned but not applied. Heuristic, documented loosely.
8. **`federalMarginalRate` treats all taxable income as ordinary** (`:256-263`) — for preferential-heavy retirees the heuristic deduction-valuation rate is wrong (e.g. $20k ordinary + $80k LTCG client is valued at 22% when a deduction actually saves 12%/0%). H2-verified paths self-correct; heuristic-only and hit-list paths don't.
9. **monteCarloEngine portfolio semantics**: gains are "distributed out", so `endingPortfolioValue` can never exceed `startingPortfolio` (up-years flat, down-years shrink) — documented as conservative but the terminal-value metric will surprise users.
10. **rothOptimizer**: top-level `assumptions` still say "v1 core: does NOT yet model RMD avoidance, IRMAA…" (`rothOptimizer.ts:341`) while `rmdAvoidance` IS computed and attached — contradictory text. Ladder fills the CURRENT bracket whatever it is (a 35%-bracket client is laddered at 35%; no target-rate option unlike `optimizeBracketFilling`). IRMAA table pinned to 2025 (documented); MFS-lived-with-spouse IRMAA tiers not modeled (treated as single). RMD age fixed at 73 (born-1960+ → 75 not modeled).
11. **Stale comments/assumption strings**: `evaluatePlanningOpportunities` comment claims "Today every strategy is validUntil 2026-12-31" (`:8869-8872` — actual: 2099/2028/2025 mix); G1.26/G1.31/G1.46/G1.92/G1.96 assumption strings cite "TY2024" values while the code is year-indexed; G1.31 assumptions still describe an H2 mutation that was removed (whatIf = undefined per audit Q1).
12. **`optimizeStrategyCombination` is dead code** in production — exported + tested (`tax-engine-optimizer-tests.ts`) but no route/module calls it; the live cross-strategy path is H7 `evaluateCrossStrategyScenario`. (The greedy loop itself is correct: re-evaluates marginal contribution against the current stack each round.)
13. **Cross-strategy `set_adjustment` collisions**: H7 stacks mutations in hit order; two stacked strategies that `set` the same adjustmentType silently let the later one win (e.g. G1.30's $7k IRA optimizer + G1.46's $8k spousal IRA both `add ira_contribution_traditional` → $15k stacked for one MFJ couple, slightly over the 2×$7k cap pre-catch-up). Combined delta is still a true engine number, only attribution/realism drifts.
14. **G1.28 DB-plan suppression threshold** `existingRetirement >= 69_000` hardcoded (TY2024 §415(c)); should track `SEP_ANNUAL_LIMIT[year]`.
15. **G1.14 HSA**: self-only-HDHP client (`hsaIsFamilyCoverage === false`) with no contributions yet is suppressed (documented conservative proxy) — a real false-suppress for self-only HDHP clients the CPA hasn't keyed contributions for.

---

## VERIFIED CLEAN

- **Catalog↔detector parity:** 107/107 — every catalog id (G1.1–G1.24, G1.26–G1.34, G1.36–G1.37, G1.39–G1.43, G1.45–G1.106, G4.1–G4.5) has a `strategyById` detector reference (102 in planningEngine + 5 in planningEngineMultiYear) and vice versa; catalog validator enforces unique ids/shape at module load.
- **validUntil gating:** enforced post-detection (`:8873-8876`); boundary semantics live-tested (2025-12-31 → alive TY2025, suppressed TY2026; malformed dates fail OPEN); genuine sunsets correct — energy G1.33/34/37 = 2025-12-31, OBBBA G1.97-100 = 2028-12-31, 90+ permanent-IRC at 2099.
- **Year-indexed constants** (web-verified against IRS Notice 2024-80 / Notice 2025-67 / Rev. Proc. 2025-32 / Rev. Proc. 2025-19): §415(c)/SEP $69k/$70k/$72k ✓; §402(g) $23,000/$23,500/$24,500 ✓; IRA (G1.26) $7k/$7k/$7.5k base, $8k/$8k/$8.6k with catch-up ✓; QCD $105k/$108k/$111k ✓; HSA $4,150/$8,300 · $4,300/$8,550 · $4,400/$8,750 + $1k catch-up ✓; §401(a)(17) $345k/$350k/$360k ✓; adoption $16,810/$17,280/$17,670, phase-out $252,150-292,150 / 259,190-299,190 / 265,080-305,080, OBBBA refundable $0/$5,000/$5,120 ✓; transit $315/$325/$340 ✓; Roth phase-out tops $161k/240k · $165k/246k · $168k/252k (MFS $10k statutory) ✓; QBI thresholds incl. OBBBA-widened 2026 bands ($201,750/276,750; $403,500/553,500) ✓; gift exclusion $18k/$19k/$19k + BEA $13.61M/$13.99M/$15M ✓; kiddie + Saver's-credit read the engine's year-indexed maps.
- **OBBBA G1.97-100 detectors** match the statute exactly: tips $25k cap, OT $12.5k/$25k, both −$100/$1k over $150k/$300k; car-loan $10k, −$200/$1k over $100k/$200k; senior $6k/person 65+, −6% over $75k/$150k; active TY2025-2028 only; marginal rate correctly computed PRE-deduction.
- **whatIfEngine:** pure (clones adjustments, lazy-clones client; baseline never mutated; per-kind validation; `__proto__`/`constructor`/`prototype` rejected); delta semantics consistent (combinedTaxDelta = liability Δ, combinedRefundDelta = refund Δ; sensitivity computed on refund delta so credit strategies report correctly).
- **Fire/suppress logic live-tested:** SEP suppressed on pure-W-2; SEP correctly NOT MFS-barred (§408(k) has no MFS restriction — deliberate, documented); PTET suppressed in TX (no income tax) and PA (no PTET), fires only with active K-1 + stranded SALT, valuation bounded by min(stranded SALT, K-1 × state PTET rate) at the federal marginal; QCD age-gating (69 no / 70 fires with explicit 70½-date-confirm flag / 71 fires) with year-indexed cap; HSA suppressed at cap (incl. employer contributions counted); Roth conversion suppressed for all-Roth balance sets, fires on missing data only; backdoor-Roth pro-rata trap downgrades confidence and warns; MFS bars on AOC/LLC, §221, adoption, dependent-care noted, TLH MFS $1,500.
- **S-corp comp math (PLAN-07):** SS 12.4% only on distributions within the remaining wage base + 2.9% Medicare on all — hand-verified $8,700 on $500k/40% comp with TY2025 base $176,100.
- **RMD:** all 29 Uniform Lifetime divisors match Pub 590-B Table III; trigger age 73 (SECURE 2.0); age < 73 → null; > 100 clamps; trajectory injects RMD as income and evolves the balance (withdraw → grow) correctly.
- **multiYearOptimizer (bracket fill):** horizon clamp [1,40]; growth applied between years only (phantom-growth bug already fixed); blended-rate division guarded for totalConverted = 0.
- **strategyComboOptimizer:** greedy forward selection genuinely re-evaluates each candidate's marginal contribution against the current stack each round; stops on < minMarginal; interactionEffect = combined − Σstandalone; consistent refund-sign convention.
- **monteCarloEngine determinism + totality:** seeded mulberry32 + Box-Muller (u1 floored at 1e-12), golden-ratio sub-seed decorrelation, no Date/Math.random; trials [100, 5000], horizon [1, 40], portfolio ≤ 1e13, draw ≥ −100%, finite-guards on every accumulation; deterministic thousands-formatting (no ICU dependence); stdev=0 collapses to the hand-checkable anchor.
- **rothOptimizer IRMAA:** 2025 SSA tiers exact (thresholds $106k/$133k/$167k/$200k/$500k single, doubled MFJ except $750k top; Part B $74.00/$185.00/$295.90/$406.90/$443.90 + Part D $13.70/$35.30/$57.00/$78.60/$85.80 monthly) and the 2-year MAGI lookback IS modeled (years 0-1 neutralized on both trajectories so conversion impact appears at y≥2); horizon DoS clamp 75 both entry points; 37%-bracket clients get zero conversion (Infinity ceiling → headroom 0).
- **planningCalendar:** TY2025 → 2025-12-31 / 2026-01-15 / 2026-04-15 / 2026-10-15; TY2026 → 2026-12-31 / 2027-01-15 / 2027-04-15 / 2027-10-15 (all correct weekdays, no §7503 roll needed in supported years); soonest-first group ordering with unknown types sorted last; per-hit negative savings floored in group totals; deterministic (no wall clock).
- **Composite scoring:** `marginalRateWeight = 1 + max(0, rate−0.22)×5`, log-dampened complexity, 1.5× stickiness — no division-by-zero (empty hits → 0); `headlineSavings` prefers `verifiedSavings`; engine-verified-without-whatIf annotation (G1.36 §41, G1.65 §23, G1.30 §36B) correctly preserved by `annotateVerifiedSavings`'s middle branch.
- **"LLM never touches math":** holds. Memo prompt receives engine-computed hits as JSON with hard no-invent constraints; deterministic stub fallback when AI off; H8 discovery output is qualitative-only (no dollar fields requested or parsed) and post-filtered by `verifyAndDedupeCandidates`.
- **G4 multi-year detectors:** pattern logic sound on persisted history (persistent NIIT avg×0.5, AMT avg×0.4, bunching cliff ±15% on would-be-itemized Sched-A sum with current-year charitable lever required, CF-stuck tolerance $3,500 just above the $3k/$1.5k natural decline, PAL growth × marginal × 0.5); ≥2 years required; no projection involved.
- **G1.40 §1244 what-if** removes ST carryforward first (least-preferential) and documents current-year vs lifetime semantics; ordinary caps $50k/$100k MFJ correct.
- **G1.65 adoption + G1.30 PTC engine-verified paths** read the engine's own Form 8839/8962 outputs (not synthetic mutations) — correct provenance labeling; PTC clawback/additional split, §36B(f)(2)(B) cap note, and the TY2026 400%-cliff reinstatement caveat all accurate.

## Repro scripts
- `/tmp/repro-multiyear-k1.ts` — H1 trajectory income drop.
- `/tmp/repro-installment.ts` — H1 dollar materiality via G1.47 ($75,284 vs $22,016).
- `/tmp/repro-detectors.ts` — G1.92 / G1.61 / QCD ages / SEP / PTET / HSA / Roth suppressions, G1.34*/G1.37*/G1.96* mislabels, expiry boundaries, calendar dates.
