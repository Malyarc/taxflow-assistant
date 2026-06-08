# Product TODO — prioritized (enhancements + fixes)

**As of 2026-06-05.** The single working to-do for TaxFlow Assistant, prioritizing
**enhancements to the current app** and **fixes**. Consolidates the 2026-06-02
product audit (`product-assessment-2026-06-02.md`), the Haven migration roadmap
(`haven-migration-roadmap.md`), `todo.md` (now a historical log), the engine
coverage / planning / extraction / UltraTax analyses, and the compliance gate
(`compliance/README.md`).

**How to read this:** items are `[ENH]` (new/expanded capability) or `[FIX]`
(wrong/stale/risky to correct), tagged with rough effort and whether the value
**ports to Haven** (the engine + planning brain migrate into the Haven app 1:1;
auth/frontend/EC2 infra do not). Check off as you go; keep `computeTaxReturnPure`
pure and don't churn the `TaxReturnInputs`/`ComputedTaxReturn` I/O contract.

Strategic frame: the engine + planning brain are strong and rare ("LLM never
touches the math"); the standalone shell is being wound down in favor of porting
the brain into Haven. So **prioritize enhancements that survive the migration**,
fix the correctness/credibility/time-bomb issues, and treat the revenue gate as
operator/legal work (P0) that's yours, not engineering.

---

## P0 — Fixes & gate-closers (do first)

### Quick fixes (hours — correctness / honesty / doc drift)
- [x] `[FIX]` **Stale "UltraTax CS / Lacerte / ProConnect / Drake friendly" comment** at `routes/tax-returns.ts:647` — ✅ **DONE 2026-06-05** → "vendor-neutral CPA-review format".
- [x] `[FIX]` **Refresh `docs/coverage-matrix.md`** — ✅ **DONE 2026-06-05.** Verified each against code: §199A wage/UBIA limit IS modeled (`wageUbiaLimit`, taxCalculator.ts:5489); §1411 NIIT base now folds in §121 remainder + §1031 recognized + QSBS + passive rental + K-1 (taxReturnEngine.ts:1885/2562); removed NYC UBT / KY occupational / OH cross-city / IN per-dependent from the deferred list (all shipped); IL dependent exemption ($2,775/dep) marked shipped.
- [x] `[FIX]` **`ONBOARDING.md` referenced but absent** — ✅ **DONE 2026-06-05.** Dropped both CLAUDE.md pointers (intro + "Where to look first" list — also fixed the duplicate "4." numbering); `docs/haven-migration-roadmap.md` is the forward roadmap.
- [x] `[FIX]` **Verify §121-remainder → NIIT base** — ✅ **DONE 2026-06-05.** Confirmed the engine includes it (taxReturnEngine.ts:1885 `netLTCG += homeSaleTaxableGain`; comment 2562; regression realworld S4 = $15,200). The §1031 recognized gain is included too. Closed the stale "open" notes in `docs/todo.md` (lines 260 + 356).
- [x] `[FIX]` **De-risk the planning detector registry** — ✅ **DONE 2026-06-05.** Added `scripts/src/tax-engine-detector-coverage-tests.ts` (static: the set of `strategyById("...")` literals across planningEngine.ts + planningEngineMultiYear.ts == the catalog id set; dynamic: a rich client fires ≥6 distinct strategies). **The audit's "4 IDs unreachable" claim was a FALSE POSITIVE** — G4.1–G4.5 are wired in the separate multi-year module; actual coverage is 101/101.

### Revenue gate — operator/legal (NOT engineering; nothing real ships until closed)
> No real client PII may touch the app until ALL of these close (see `compliance/README.md`). All app-layer code controls (auth gate, §7216 consent gate, PII field-encryption, CI, WISP doc) already shipped 2026-06-03; what remains is operator/infra/legal.
- [ ] `[FIX]` **Rotate the leaked Neon + Gemini credentials** (P0-1, YOU) — runbook `compliance/runbook-p0-1-rotate-credentials.md`. The one red item. (~1 day)
- [ ] `[ENH]` **S3 + SSE-KMS for the document blob** (P0-5 blob gap / D2-D17) — `tax_documents.file_content` is still base64 **plaintext carrying the SSN**; field-encryption covers only the SSN/TIN columns. **P0-blocking.** Runbook B. (~2 wks; ports to Haven as the same "solve once on whichever side holds PII")
- [ ] `[ENH]` **TLS + edge auth + EC2 security-group lockdown** (P0-4 / D1) — Cloudflare Access or ALB+ACM; set `API_AUTH_TOKEN`; re-enable HSTS. Runbook A.
- [ ] Google no-training DPA + off the free Gemini tier · counsel sign-off on WISP + §7216 instrument · name the FTC-Safeguards Qualified Individual · make CI a required status check · wire the §7216 consent-capture UX + a login form (D6).

---

## P1 — Highest-leverage enhancements (all port to Haven)

- [x] `[ENH]` **Wire & ship the multi-year Roth optimizer** ⭐ — ✅ **COMPLETE + DEPLOYED 2026-06-05f.** v1 ladder (POST `/api/clients/:id/roth-optimizer` + `RothOptimizerCard`, engine-exact costs) **+ the lifetime RMD-avoidance VALUE model** (`projectRmdAvoidance`: baseline-no-conversion vs scenario-with-ladder total federal tax to ~age 92; `lifetimeFederalTaxSaved` + RMD totals + final IRA balances; UI panel). **+ Medicare IRMAA cost (2025 SSA table, 2-yr lookback, 65+) + tax-free Roth-growth** shipped 2026-06-05g — `netLifetimeValue = tax saved − extra IRMAA`, `scenarioRothBalanceFinal`. Prod (client 9): net **$148,940** (= $142,575 tax + $6,365 IRMAA saved) + $1.42M tax-free Roth. **The Roth value model is now feature-complete.**
- [x] `[ENH]` **H3 multi-year engine hardening** ✅ **DONE 2026-06-05f.** `multiYearEngine.ts` gained OPT-IN (default-off, back-compat) **RMD recognition** (IRS Uniform Lifetime Table Pub 590-B, age 73 SECURE 2.0) + **carryforward threading** (capture/apply the 8 remaining-carryforward fields → depletion year-over-year). SS needed no work (benefits already flat + per-year taxable-SS recompute). 35 hand-calc'd assertions; adversarially re-derived (issues: none). NOT changed: default trajectory behavior (opt-in only, so G1.3/G1.4/G1.8 + the G4 detectors are untouched). Remaining engine refinements (low priority): bracket-year inflation past the latest supported year; installment-note recognition; PAL disposition-release.
- [x] `[ENH]` **State "modifications" layer** (PREP-B1) — **COMPLETE 2026-06-08b.** `calculateMultiStateTax` non-resident branch uses the tax-ratio method (a) for **25 states** (CA/NY/CT/NJ/MN/GA/NC/OH + the 2026-06-08b batch: graduated AR/DE/ME/MO/MT/NE/NM/OK/OR/RI/VT/WI + flat CO/IA/KS/LA/ND), each verified against its NR form's "multiply tax-on-all-income by the source %" line. Per-type NR source now has a CPA path — the opt-in `nonresident_source_allocation` marker sources out-of-state K-1 business + rental real estate by `sourceState`, plus `CapitalTransaction.propertyStateSitus` (migration 0010) routes real-property gains to their situs state; §114 enforced by design (intangibles + retirement never sourced). The part-year resident-period tax can use the IT-203/540NR income-% method via the opt-in `part_year_income_pct_method` marker. 93 hand-calc'd tests across 3 files. **EXCLUDED + test-guarded: MD (method b + 2.25% special NR tax), SC (method b), UT (no-op), KY/ID/AZ/MI/IN (flat method b), VA/AL/HI/IL/MA/MS/WV (method b).** Remaining tail (minor): arbitrary per-state NR source for non-K1/rental items (needs an AdjustmentFact state field); a dedicated SPA UI field for propertyStateSitus (deferred — Haven builds its own).
- [x] `[FIX]` **Planning-catalog refresh discipline** (PLAN-Q3) ✅ **DONE 2026-06-05 (tax-law freshness hardening).** The time-bomb is defused: catalog v1.20 re-dated the 90 permanent-IRC strategies (+ G1.64) from `validUntil 2026-12-31` → `2099-12-31`; the 3 genuine OBBBA clean-energy sunsets (G1.33/34/37) stay 2025 and the 4 OBBBA deductions (G1.97–100) stay 2028, so PLAN-08 still suppresses them on schedule. **CI now guards it:** `tax-engine-catalog-freshness-tests.ts` (F1–F4: no strategy expired for the current filing year; permanence floor ≥90 @ 2099; genuine sunsets keep real dates). Re-dating discipline is still a periodic review, but a lapse now fails CI instead of silently collapsing the catalog.
- [~] `[ENH]` **Quick state wins** (PREP-Q3) — SHIPPED: VT dependent exemption + Yonkers PIT (2026-06-05e); WI single std-ded phase-out + CT Social Security exclusion (2026-06-05g); **WI MFJ/HoH/MFS std-ded phase-out (2026-06-06k — reverse-derived from the 2024 WI Form 1 table, verified to the dollar across all 276 brackets; all 4 statuses now modeled)**; NJ verified already-correct; IN SS already correctly excluded; **CT pension/annuity + IRA exclusion SHIPPED 2026-06-08b (CT-1040 Pension & Annuity Worksheet — `(100% pension + IRA% × IRA) × phase-out`, IRA% 50/75/100% by year, IRA portion via the `ct_ira_distribution` marker; the pension-vs-IRA "split" is done via the marker, no schema change needed)**. **Remaining sub-gaps (minor): IN unemployment-comp deduction; WI/HoH/MFS use single WI brackets (separate pre-existing bracket fallback); CT military/RR-Tier/CT-teacher carve-outs (CPA nets out of the bucket).**

---

## P2 — Medium enhancements (bounded; port to Haven)

### Tax calculator engine
- [x] `[ENH]` **Per-property Schedule E roll-up** — ✅ **DONE 2026-06-06.** Form 8582 per-activity worksheet (`computeForm8582Breakdown` → `ComputedTaxReturn.form8582`): ratably allocates allowed/suspended loss per property (Worksheet 5). Tax result unchanged (the $25k cap was always correct on aggregate). 27 tests. Remaining increment: per-property suspended-loss STORAGE for release-on-disposition.
- [~] `[ENH]` **State AMT for NY (IT-220) / NJ / MN** — ✅ **MN DONE 2026-06-06** (Schedule M1MT §290.091: 6.75%, statutory exemptions, §55(d) phase-out, resident delta, mirrors CA). NY (IT-220 narrow preference tax) + NJ (no individual AMT) documented as intentionally-not-modeled. 9 tests.
- [x] `[ENH]` **FTC carryforward** (Form 1116 Schedule B, §904(c)) — ✅ **DONE 2026-06-06.** Combined current+carryover through the §904 limit; excess re-carries (migration 0003). SEHI "carryforward" documented as a non-concept (no SEHI CF in law). 14 tests.
- [x] `[ENH]` **Form 8995-A per-business wage/UBIA limit** — ✅ **DONE 2026-06-06.** Per-business limit summed; `qbiPerBusiness` output. Deep audit caught+fixed a §199A loss-netting bug. 22 tests.
- [x] `[ENH]` **Schedule C per-line P&L + depreciation** — ✅ **SE-BASE CORE DONE 2026-06-06f.** New `schedule_c_depreciation` adjustment (Form 4562) reduces the Schedule C net profit → SE-tax base + §199A QBI + earned income + §461(l), closing the documented gap (above-the-line §179/bonus reduced only AGI). Per-line P&L now complete: gross receipts (self_employment_income) − expenses (schedule_c_expenses) − depreciation = net SE. 8 hand-calc'd tests ($30k dep → SE tax −$4,238.87; §179 → SE tax −$0). **Asset-level §179/bonus/MACRS calculator — ✅ ENGINE DONE 2026-06-06h.** `computeScheduleCAssetDepreciation` (taxCalculator.ts): personal-property MACRS (Pub 946 Table A-1 half-year, 3/5/7/10/15/20-yr, every % verified) + §179 (dollar cap + investment phase-out + §179(b)(3) business-income limit + carryforward) + §168(k) bonus (with prior-year-basis reconstruction via `BONUS_RATE_BY_ACQUISITION_YEAR`), folded into the SE-base-reducing `schedule_c_depreciation` total. New `scheduleCAssets` input (PURE migration-seam addition) + `ComputedTaxReturn.scheduleCAssetDepreciation`; inert when absent. 37 hand-calc'd tests. **✅ FULLY COMPLETE 2026-06-06i/j.** (i) §179(b)(3)(B) income-limit carryforward persist+auto-seed (migration 0008, `schedule_c_section179_carryforward`) — full §41/§51 multi-year parity; OBBBA 100% bonus flag (`bonusFullObbba`). (j-A) **Full §168(d)(3) mid-quarter MACRS** — `computeMacrsSchedule` generates Pub 946 A-1..A-5 from the IRS DB→SL round-and-carry algorithm, verified to reproduce Table A-1 exactly for all 6 classes. (j-C) **Live-app input path DONE** — `schedule_c_assets` DB table (migration 0009) + pipeline load + CRUD API + a compact "Sched C Assets" ClientDetail tab; PROD-verified end-to-end (POST §179 asset → SE tax drops). Remaining bound: each asset either fully §179'd OR bonus+MACRS (split into two rows otherwise); per-EXPENSE-category breakdown stays out (cosmetic). PREP-B3 / Haven B#19.
- [x] `[ENH]` **Federal sub-gap batch** (PREP-B5) — ✅ **DONE 2026-06-06** (a/b/c): §1202 acquisition-date exclusion % (50/75/100) + §57(a)(7) AMT pref; K-1 basis reduced by distributions + sep-stated deductions (§1367 order, migration 0004); §168(k) TY2025 bonus dual-rate (`bonus_depreciation_basis_obbba`). (d) HIFO = a sale-time planning decision (detector G1.56), not a prep-engine gap; (e) partial-wash re-flow already handled via `remainingReplQty`. 21 tests.
- [x] `[ENH]` **1040-X amendment depth** — ✅ **DONE 2026-06-06.** Real Line 6→7→8 chain + credit-component breakdown + amended state lines; additive snapshot. 107 tests.

### AI extraction (the real half of "autofill")
- [~] `[FIX]` **Run the full 100-doc benchmark** — **LIVE-VALIDATED on the free key 2026-06-08; full 100-doc run still quota-blocked.** Ran LIVE against gemini-2.5-flash: every W-2 the model processed scored **12/12 fields (100% precision + per-field recall)** — up from 2026-05-23's 77.7% recall, confirming the P2-10 recall-hint prompt fix landed. The free-tier rate/daily quota (10 RPM + daily cap) blocks a clean 100-doc run (429s with multi-min backoffs); it needs **paid quota or a fresh free-tier window** (~11 min at the default 6.5s pace). Harness hardened: now retries transient 5xx (a 503 burned a doc) + `--limit=N`/`--per-kind=N` for fast/balanced samples. Partial + analysis in `docs/ai-benchmark/live-partial-2026-06-08/`. (EXT)
- [x] `[ENH]` **Per-field confidence scores + "review only low-confidence fields" filter** — ✅ **DONE 2026-06-06.** Extractors return `confidence` (0–1); `lowConfidenceFields` filter; threaded through the documents route. (Model-side values need a live key to validate.)
- [x] `[ENH]` **Attack recall** — ✅ **DONE 2026-06-06.** W-2 + 1099 vision prompts: "extract EVERY box (lower confidence, don't skip)" + W-2 Box 1 ≠ Box 3 disambiguation hint.
- [x] `[ENH]` **Expand doc-type coverage** (1098/1098-T/E, 1095-A, SSA-1099, W-2G) — ✅ **DONE 2026-06-08c.** Unified information-return extractor (`extractInfoReturnFromFile`): one vision call identifies the form from its header (`infoType`) + extracts the boxes (IRS 2024 layouts), with bounding boxes + confidence + the prompt-injection field-whitelist defense. `validateInfoReturn` (box arithmetic — SSA-1099 Box5=Box3−Box4, W-2G withholding≤winnings, 1095-A APTC≤premium, 1098-T scholarships>tuition, 1098-E §221 cap, etc.). 6 new `documentType` enum values route to it; upload dropdown updated. 39 deterministic tests (normalizer + validation; no key needed). **Auto-apply on approve DONE 2026-06-08d**: new `recordType: "info_return"` maps the reviewed boxes (via the pure `mapInfoReturnToInputs`) → adjustments (1098→mortgage_interest+state_property_tax, 1098-T→AOC, 1098-E→student_loan_interest, W-2G→additional_income+withholding) and/or client patches (1095-A→aca fields, SSA-1099→socialSecurityBenefits), transactional + recalc. ReviewExtractionModal renders the per-form boxes + sends the info_return body. +23 tests (mapping + e2e-through-engine); PROD-smoked end-to-end (approve → adjustment/client created → recalc). Deployed.
- [x] `[ENH]` **1099 box-arithmetic validation** — ✅ **DONE 2026-06-06.** `validate1099` (DIV qualified≤ordinary, R taxable≤gross, B reconciliation, TIN/withholding); folded into diagnostics. 19 tests.

### Planning engine
- [x] `[ENH]` **Model the credit/election mechanics that block what-if wiring** — ✅ **DONE across 2026-06-06b → 06f.** §23 adoption (`calculateAdoptionCredit`, G1.65), §36B ACA PTC (G1.30 reads the real Form 8962 reconciliation **+ the §36B PTC-cliff optimizer** — engine-verified IRA-contribution what-if), §41 R&D (`calculateRdCredit`: ASC + §280C + §38(c) limit + §39 carryforward, G1.36), and §51 WOTC + §45S FMLA (CPA-supplied GBCs through the §38 limit; G1.74/G1.75 stay qualitative — the engine can't compute employer credits). §530 Coverdell clarified: NO current-year 1040 effect (non-deductible / tax-free growth) → correctly informational, nothing to model. Carryforward auto-seeds added for §163(d) + §41 (migration 0006) **and §51/§45S WOTC+FMLA (`general_business_credit_carryforward`, migration 0007, 2026-06-06g) — all three GBC/election carryforwards now at full §39 multi-year parity (persist + re-seed)**.
- [x] `[ENH]` **H2-wire the remaining *engine-modelable* heuristics** (PLAN-Q2) — **TRIO COMPLETE.** **§1244 (G1.40) DONE 2026-06-06b** (engine-verified current-year delta via recharacterize-loss → ordinary `deduction` mutation; cross-checked vs an independent engine run). **§453 (G1.47) DONE 2026-06-06c** — H3 multi-year (baseline full-gain-year-0 vs scenario gain/N; SAME total gain so no overstatement) via a new general `long_term_capital_gain` injection lever; cross-checked vs an independent runMultiYearTrajectory pair; exposed+fixed the flat-5% heuristic's two-way error. **§163(d) (G1.93) DONE 2026-06-06d** — built the missing engine model (investment-interest deduction capped at NII + the §163(d)(4)(B) election re-bucketing QDIV/LTCG to ordinary) then H2-wired the detector (suppresses when the engine shows the freed interest is wasted against the std deduction — the error the 13.2% heuristic missed). (The ~44 *qualitative* G1.46–G1.96 detectors stay heuristic until their mechanic is modeled.)
- [x] `[ENH]` **Replace fixed heuristic splits with data** — ✅ **DONE.** **G1.17 (2026-06-06f)**: S-corp reasonable comp uses a CPA-supplied benchmarked figure (`scorp_reasonable_comp`, an RC Reports/BLS OES result) instead of the hardcoded 40% (kept as a documented placeholder fallback). **G1.2 PTET (2026-06-06g)**: new `STATE_PTET_REGIMES` table (all 50 states + DC, hand-verified per-state rates against statute/DOR — AICPA tracker + CrossLink/Smith&Howard/EisnerAmper; AZ 2.5%/OH 3%/CO 4.4% confirmed against DOR). `detectPtetElection` fires only for the 36 PTET states and values the workaround at `min(stranded SALT, active K-1 × state PTET rate) × fed marginal` (the rate now BOUNDS recovery — CA's flat 9.3% can't recover all stranded SALT). 48-assertion `tax-engine-ptet-regimes-tests.ts` + a yearly-freshness note.

### Workflow
- [~] `[ENH]` **Return-level diagnostics engine** (P1-5) — **MVP SHIPPED 2026-06-06 (P2-16).** `lib/returnDiagnostics.ts` (PURE): critical/warning/info pre-filing checklist (missing/invalid state code, kiddie-tax parent rate, ACA APTC w/o SLCSP, non-resident wages, §6654 balance-due, W-2 + 1099 box arithmetic, ACA gaps) → GET `/clients/:id/tax-return/diagnostics` + `DiagnosticsCard` on the Tax Calc tab. 36 tests (`tax-engine-diagnostics-tests.ts`). **Remaining (the fuller ~1 qtr version): dependent-TIN/EIN completeness, dependent-count vs CTC/EITC eligibility cross-checks, a clearable "ready to hand off" gate, and broader unbalanced-return checks.**

---

## P3 — The Haven migration (when ready to cut over)

- [ ] `[ENH]` **Build the bridge** (the real integration risk, not the math): Prisma tax-data models + the `TaxReturnInputs` adapter on the Haven side; map the Drizzle schema → Prisma (use the versioned migrations `0000`/`0001`/`0002` as the enumerable source).
- [ ] `[ENH]` **Repackage the engine** as a **compiled** `@haven/tax-engine` + `@haven/tax-planning` npm package (NestJS imports at runtime — a TS-source package won't work).
- [ ] `[FIX]` **Standing constraint:** keep `computeTaxReturnPure` pure (no DB/framework/`Date`/random); document any `TaxReturnInputs`/`ComputedTaxReturn` additions (the I/O contract IS the migration seam).

---

## P4 — Engine perfection, form generation, app-security & firm features (NEW — founder-requested 2026-06-08)

> Founder-level expansion across all angles (CTO + Principal Eng + CPA): (A) drive the
> engine + planning brain to an asymptotic zero-bug rate via a LARGE multi-technique audit;
> (B) turn the computed return into a generated workpaper/form packet; (C) the tax-domain
> security the product owns regardless of Haven; (D) the features a CPA firm would pay for.
> Each item is a multi-session workstream. NOTE (dev-Mac memory safety): run generative/
> differential sweeps in CI, capped — no large agent fan-outs locally.

### A. Large-scale accuracy audit campaign (engine + planning → asymptotic zero bugs)
> "Zero bugs" is unprovable, but the bug-DISCOVERY rate can be driven to ~0 across
> INDEPENDENT techniques — the standard for shipping safety-critical numerics. Today's
> ~4,600 hand-picked assertions have a coverage ceiling (they test what the author thought
> of); these techniques find what the author DIDN'T.
- [ ] **Differential / oracle testing vs independent reference engines** — run identical
  inputs through TaxFlow AND ≥2 independent oracles (OpenTaxSolver / `ustaxes` / `tenforty`,
  + the IRS ATS published e-file test scenarios + Pub 17 / form-instruction worked examples).
  Any divergence = a bug to root-cause. Highest-value technique — you stop being your own
  oracle. (Ultimate oracle = UltraTax/Lacerte side-by-side on real returns; waits on the partner.)
- [ ] **Property-based / generative testing** (fast-check) — millions of valid random returns
  asserting INVARIANTS true for ANY return: AGI ≥ taxable ≥ 0; tax ≥ 0; effective rate ≤ top
  marginal; refund = payments − liability; each credit ≤ its statutory cap; phase-outs
  continuous (no unintended cliffs); no >100% marginal rate outside known cliffs; MFJ within
  the marriage-penalty bound. Violation = bug.
- [ ] **Automated boundary/threshold sweep** — extract EVERY numeric threshold (brackets,
  phase-out start/end, caps, age gates, AGI cliffs) and auto-generate ±$1 + exact-boundary
  tests. Catches the `<` vs `<=` / off-by-one class (the #1 tax-software bug).
- [ ] **Metamorphic + differential-year testing** — income doubling/splitting relations; the
  same scenario across 2024/25/26 (year-indexed values move correctly, no regression).
- [ ] **Fuzzing** — random/malformed inputs → no crash/NaN/Infinity/negative-where-impossible;
  the engine fails LOUD, never a silent garbage tax number.
- [ ] **CPA scenario matrix (common + uncommon)** — filing status (5) × income archetype
  (W-2, SE/Sch C, retiree SS+pension+RMD, investor, RE pro, multi-state, expat/FEIE,
  business-owner K-1) × life event (marriage/divorce/death/new-child/disability/disaster) ×
  credit-deduction combos × all 50 states+DC, hand-calc'd corners by a CPA. The explicit
  "uncommon" list: kiddie-AMT, ISO-AMT, NIIT/IRMAA/§199A cliffs, QSBS 50/75/100% tiers,
  cross-account partial wash sale, §1031 boot+NIIT, §453 multi-year, NOL 80% limit, excess-SS
  (multi-employer), Roth+IRMAA 2-yr lookback, charitable 60/30/20 carryforward, disaster
  casualty, HSA excess §4973, §72(t) SEPP, Saver's QSS boundary, EITC investment-income
  disqualification, adoption special-needs refundable split, PTC clawback-cap vs additional,
  SEHI/§162(l) interaction, QSS 2-yr window, Form 8332 split custody.
- [ ] **Planning-engine audit (all 101 strategies)** — a fire/suppress confusion matrix
  (fires-when-should + suppresses-when-shouldn't) + savings within tolerance vs an independent
  calc + cross-strategy stacking + a false-positive sweep on a trivial W-2 return + every
  heuristic detector bounded against a hand-calc + catalog freshness at every supported year.
- [ ] **Infra:** documented methodology + scenario matrix + oracle set + results ledger + bug
  taxonomy (off-by-one / stale-year-constant / missing-phase-out / ordering / rounding); every
  bug → a regression test; green bar = "no divergences across N independent techniques";
  CPA sign-off on the matrix + divergences.

### B. Form / workpaper generator (the engine already computes ~30 forms)
> The product ALREADY ships substitute PDFs for 1040, 1040-X, 2210, 4868, 8606, 8824, 8990
> (+ the IRS-1040 PDF + CPA-review `.gen` + PDF/CSV/JSON). Since the engine computes line
> values for far more, the high-value feature is a WORKPAPER / review-packet generator — NOT
> filed forms (Option A: the CPA e-files in their own software; filed forms need Pub 1167
> substitute approval + MeF e-file XML — parked).
- [ ] **Workpaper-packet generator** — render the computed forms as labeled, readable PDFs so
  the CPA cross-checks their prep software line-by-line and the client gets a clean packet.
  Generable NOW (data already computed):
  - 1040 schedules: Sch 1/2/3, Sch A, Sch B, Sch C, Sch D + Form 8949, Sch E, Sch SE.
  - Credits: 8812 (CTC/ACTC), 8863 (education), 8880 (saver's), 2441 (dependent care), 8962
    (PTC), 5695 (energy), 8839 (adoption), 1116 (FTC).
  - Other taxes: 6251 (AMT), 8959 (Add'l Medicare), 8960 (NIIT), 8615 (kiddie), 5329 (§72(t)).
  - Income/deduction detail: 8995/8995-A (QBI), 4562 (depreciation), 8582 (PAL), 4952
    (investment interest), 2555 (FEIE), 7206 (SEHI), 8283 (noncash charitable).
- [ ] **1040 reconciliation worksheet** — one artifact mapping every computed value → its
  form + line (the `.gen`/CPA-review summary is the seed). The single best CPA cross-check.
- [ ] **Top-5 state main forms** (CA 540, NY IT-201, …) — the engine computes 50-state tax;
  render the resident-state form for the top states (per-state rendering; start small).
- [ ] **(Parked) Filable official/substitute forms + MeF e-file XML** — only if Option B /
  real filing resurfaces; multi-month + IRS approval.

### C. App-owned security & compliance (what Haven WON'T provide)
> Haven provides PLATFORM security (auth, RBAC primitives, TLS, infra, DB, sessions). These
> are tax-DOMAIN + feature-coupled controls the product owns on either side of the migration.
- [ ] **§7216 consent LIFECYCLE (full)** — beyond the built gate: verbatim instrument
  (Rev. Proc. 2013-14), per-disclosure scoping (AI-extract vs third-party-share vs
  cross-service-use = separate consents), versioning, 1-yr expiry, revocation, renewal, and a
  hard "can't proceed without consent" UX gate.
- [ ] **Disclosure/use audit LEDGER (immutable, hash-chained)** — §7216/§6713: every
  disclosure/use of tax-return info (to the LLM, an export, an email, a share) logged
  append-only + tamper-evident (what/to-whom/under-which-consent/by-whom). The firm's defense
  in an IRS/state exam or malpractice claim.
- [ ] **PII handling at the feature level** — masked-by-default rendering (SSN last-4; logged
  reveal), field-encryption key ROTATION + KMS (fieldCrypto built), document-blob S3+SSE-KMS
  (P0), tokenization.
- [ ] **AI/LLM data governance** — no-training DPA enforcement, per-call TRI request/response
  logging, prompt-injection defense (built), a firm-wide AI kill-switch.
- [ ] **Data retention + secure deletion (crypto-shred)** — IRS 3-yr preparer retention +
  state variants + client deletion rights; a retention-policy engine + verifiable purge
  (delete the per-record key).
- [ ] **Tax-workflow segregation of duties** — preparer/reviewer/signer roles + a two-person
  "ready to file" dual-control gate + §6695 signature controls (Haven gives RBAC primitives;
  the tax roles + dual control are feature-level).
- [ ] **Output/export security** — expiring signed download links, "DRAFT — not for filing"
  watermarking, no-cache (partial), every export → the disclosure ledger.
- [ ] **Engine input hardening** — DoS caps on capitalTransactions/K-1 array sizes, ReDoS-safe
  parsing, fail-loud on NaN/Infinity (never a silent garbage tax).
- [ ] **WISP / FTC Safeguards operationalization** — documented program (built) + named
  Qualified Individual + annual risk assessment + breach-response runbook + sub-processor mgmt.
- [ ] **Secrets management** — rotate AI/DB creds (P0-1) + env-var secrets → a secrets manager
  + short-lived scoped AI keys.

### D. Features a CPA firm would pay for (leveraging the engine + planning brain)
- **Recurring-revenue / planning:**
  - [ ] **Tax projection + quarterly estimates** — project next year from current data + 1040-ES
    vouchers + safe-harbor (2210 logic exists). Turns a 1-time return into a recurring relationship.
  - [ ] **MFJ-vs-MFS optimizer** — compute both, recommend (engine can do both).
  - [ ] **Entity-choice / S-corp reasonable-comp calculator** — "should this Sch C be an S-corp"
    (G1.17 is the seed; make it a dedicated payroll-tax-vs-comp tool).
  - [ ] **Year-over-year + OBBBA-impact analysis** — flag big swings; quantify the law-change
    delta (engine is multi-year + OBBBA-aware).
  - [ ] **Client-facing branded planning deliverable** — polish the planning memo into a firm
    sales artifact.
- **Prep-workflow efficiency:**
  - [ ] **Personalized client organizer / document-request list** — derive from last year's
    return (diagnostics + missing-data endpoints are the bones).
  - [ ] **"Ready to file" gate** — expand diagnostics (dependent-TIN completeness, CTC/EITC
    eligibility cross-checks, unbalanced-return checks — the P1-5 fuller version).
  - [ ] **Prior-year roll-forward** — carry the client + auto-seed carryforwards (partly via
    buildSyntheticPriorYearAdjustments).
  - [ ] **Audit-risk / DIF-style flagging** — outsized Sch C loss, charitable-to-income ratio,
    home office — defensive review.
  - [ ] **Engagement status + extension/due-date tracking** (some may be Haven — confirm).
- **AI differentiators (LLM never does math):**
  - [ ] **NL Q&A grounded in the computed return** — "why did the refund drop $4k?" via RAG over
    the engine output (not the LLM computing).
  - [ ] **Proactive threshold alerts** — crossed NIIT/IRMAA/§199A-phase-in → notify the CPA.
  - [ ] **Firm-wide planning campaign tool** — turn the hit-list into "these 12 clients should
    convert before year-end" with one-click memos.
- **Practice management (likely Haven — confirm before building):** e-signature (§7216 +
  engagement letters) · per-return/per-plan billing · review-notes/collaboration · client portal.

---

## Explicitly DON'T invest (Haven replaces it, or wait for demand)
- ClientDetail.tsx refactor / login UI / JS code-splitting / dark-mode toggle — Haven's Next.js portals + Expo mobile replace the SPA.
- Real UltraTax / SDE write-back ("autofill" as integration) — no tax tool imports a finished 1040 via file; SurePrep API (2–3 wks post-contract, pricing-blocked) / SDE reverse-eng (4–6 wks + per-release maintenance) / GruntWorx-style UI automation (6–10 wks + high maintenance) are all multi-month and **gated on a paying partner confirming it's their blocker**.
- Trust/estate (1041), partnership (1065), S-corp/C-corp (1120-S/1120), 706/709, e-filing — out of scope per the Option-A decision.
- Long-tail state credits (beyond top-10 states), PA EIT (~1,800 minor munis) / OH SDIT (~390 districts) long tail, MD per-dependent exemption, HSA last-month rule — only when a customer asks.

## Business (blocked on you, not engineering)
- [ ] Land **1 real, named CPA design partner** on real clients + a real side-by-side validation vs UltraTax CS; publish an honest case study. (A1/C3 — the biggest dollar gate.)
- [ ] **Reset pricing** toward per-return ($50–150) or a Holistiplan-adjacent tier (current $30k = Corvee ceiling with Holistiplan depth). Budget the annual catalog refresh.
- [ ] Decide the game (P1-1, founder-level): standalone planning product vs engine component for Haven — *already leaning "migrate the brain into Haven"; confirm and stop straddling.*
