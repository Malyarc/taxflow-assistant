# MASTER TODO — TaxFlow Assistant

**THE single source of truth, as of 2026-06-08.** We work off this doc from here onward.
`docs/product-todo.md` is now the **historical completed-work log** (the detailed
done-list with commit-level provenance lives there); this doc is the forward plan.

The bar for everything below is a **big-tech launch product (Apple/Google)**: correct,
secure, audited to the hilt, and validated by a CPA before any tax number ships.

---

## 0. How to use this doc

- **Status:** `[ ]` open · `[~]` partial · `[x]` done · `[⛔]` blocked on operator/legal (not engineering).
- **Tiers (work top-down):**
  - **T0 — GATE:** must close before any real client PII / launch.
  - **T1 — PERFECT THE ENGINES:** accuracy audit + the real capability gaps.
  - **T2 — WIN THE FIRM:** forms/workpapers + the features a CPA pays for.
  - **T3 — Haven migration.**
  - **T4 — Business gates (founder).**
- Game plans (A–D) are phased with **exit criteria**. Don't mark a workstream done until its exit criteria are green.
- Standing constraint: keep `computeTaxReturnPure` **pure** (no DB/framework/Date/random) — it's the Haven migration seam.

## 1. Definition of Done (the Apple/Google bar) — applies to EVERY item

1. **Spec → design review → implement to codebase idioms → audit/test matrix → security review → CPA validation → deploy → post-deploy verification.**
2. **Every numeric output is triple-checked:** hand-calc'd against the primary source (IRS/state) **AND** differential-tested vs an independent oracle **AND** property-tested (invariants hold).
3. **Zero known correctness bugs in shipped scope** — only *documented* sub-gaps (each with a regression test pinning current behavior).
4. **Secure-by-default:** the §C controls apply; PII masked; every disclosure logged; fail-loud (never a silent garbage tax number).
5. **Observable:** structured logs + metrics + anomaly alerts; explicit error/failure-mode handling.
6. **Client-facing artifacts:** accessible (WCAG), performant, polished — they carry the firm's brand.
7. **CI-enforced:** the full no-API battery + the audit sweeps run in CI and are required to merge. (Dev-Mac memory rule: sweeps run capped in CI; **no large local agent fan-outs**.)

## 2. Current baseline (DONE — the foundation)

> Detailed provenance in `docs/product-todo.md`. Compact summary:
- **Engine:** individual Form 1040, 50 states + DC, OBBBA-conformant, multi-state NR tax-ratio for 25 states + part-year + local taxes; computes line values for ~30 federal forms; ships substitute PDFs for 1040 / 1040-X / 2210 / 4868 / 8606 / 8824 / 8990. **~4,769 hand-calc'd assertions (80 no-API suites) + the 106-assertion audit file + the ~5,636-run property harness, deployed (migrations through 0016).**
- **Planning:** 101-strategy catalog, "LLM never touches the math," ~16 engine-verified what-ifs + the rest heuristic, multi-year detectors, Roth-conversion optimizer (lifetime RMD/IRMAA value model).
- **AI extraction:** upload→extract→review→approve→engine, end-to-end for W-2 + 8 1099s + 6 info-returns (1098/T/E, 1095-A, SSA-1099, W-2G); LIVE-validated W-2 100% (small-n).

---

## T0 — GATE (close before any real client PII / launch)

### T0.1 [⛔ operator/legal — YOURS] Revenue/security gate (was P0)
- [ ] Rotate the leaked Neon + Gemini credentials (`compliance/runbook-p0-1-rotate-credentials.md`) — the one red item.
- [ ] S3 + SSE-KMS for the document blob (`tax_documents.file_content` is plaintext-base64 carrying the SSN) — **P0-blocking**.
- [ ] TLS + edge auth + EC2 lockdown (Cloudflare Access / ALB+ACM; set `API_AUTH_TOKEN`; HSTS).
- [ ] Google no-training DPA + off the free Gemini tier · counsel sign-off on WISP + §7216 instrument · name the FTC-Safeguards Qualified Individual · CI as a required status check · wire the §7216 consent UX + login.

### T0.2 [P0] App-owned security & compliance — **GAME PLAN C**
> Haven gives the *platform* (auth, RBAC primitives, TLS, infra). These are tax-domain/feature-coupled controls the product owns on either side of the migration. Each ships behind `/security-review` + (for the data-path items) a pen-test.
- **Phase C0 — the T0.1 blockers** (above) — must land first.
- **Phase C1 — Consent + disclosure law (the legal core):**
  - [ ] §7216 consent **lifecycle**: verbatim instrument (Rev. Proc. 2013-14), per-disclosure scoping (AI-extract vs third-party-share vs cross-service-use = separate consents), versioning, 1-yr expiry, revocation, renewal, hard "can't proceed without consent" UX gate.
  - [ ] **Immutable, hash-chained disclosure/use ledger** (§7216/§6713): every disclosure/use of tax-return info (to the LLM, an export, an email, a share) → append-only, tamper-evident (what/to-whom/under-which-consent/by-whom).
- **Phase C2 — PII handling:**
  - [ ] Masked-by-default rendering (SSN last-4; explicit reveal is logged) · field-crypto key **rotation** + KMS · document-blob S3+SSE-KMS · tokenization.
  - [ ] Data retention + **secure deletion (crypto-shred)** — IRS 3-yr preparer retention + state variants + client deletion rights (delete the per-record key).
- **Phase C3 — Workflow + output controls:**
  - [ ] Tax-workflow segregation of duties (preparer/reviewer/signer) + a **two-person "ready to file" dual-control gate** + §6695 signature controls.
  - [ ] Output/export security: expiring signed links, "DRAFT — not for filing" watermarking, no-cache, every export → the disclosure ledger.
- **Phase C4 — AI governance + hardening + program:**
  - [ ] AI data governance: no-training DPA enforcement, per-call TRI request/response logging, prompt-injection defense (built), firm-wide AI kill-switch.
  - [ ] Engine input hardening: DoS caps on `capitalTransactions`/K-1 array sizes, ReDoS-safe parsing, fail-loud on NaN/Infinity.
  - [ ] WISP / FTC-Safeguards operationalization: documented program (built) + named Qualified Individual + annual risk assessment + breach-response runbook + sub-processor management.
  - [ ] Secrets management: env-var secrets → a secrets manager + short-lived scoped AI keys.
- **Exit criteria:** `/security-review` clean on the full diff · independent pen-test of the data path · the compliance checklist green · counsel sign-off · no plaintext PII at rest anywhere.

### T0.3 [P0] Large-scale accuracy audit campaign — **GAME PLAN A** (the credibility gate) — **[~] MOSTLY DONE (2026-06-08→09): machine harness + 14-agent full-app fan-out RAN; all ~45 findings FIXED + deployed + prod-verified. Remaining: the differential-ORACLE layer (A0/A2) + CPA sign-off (A6).**
> "Zero bugs" is unprovable; the **bug-discovery rate** is driven to ~0 across *independent* techniques — the safety-critical-numerics standard. Today's ~4,600 hand-picked assertions have a coverage ceiling (they test what the author thought of). These find what the author didn't. **This campaign surfaced the T1 engine gaps — the §1250/collectibles/§1231 bugs fell out (T1.1, all fixed).**
- **Phase A0 — Foundation (harness + methodology):**
  - [ ] Differential-oracle **adapter layer** (`TaxReturnInputs` → each oracle's input format) + a results-ledger schema + a bug taxonomy (off-by-one / stale-year-constant / missing-phase-out / ordering / rounding / missing-rate-bucket). **← THE TOP OPEN T0.3 ITEM (recommended next).**
  - [ ] Evaluate + pick ≥2 oracles: OpenTaxSolver, `ustaxes`, `tenforty`, + the **IRS ATS published e-file test scenarios** and Pub 17 / form-instruction worked examples (authoritative). Document each oracle's coverage + known divergences.
  - [x] Write the methodology doc + define the invariant set — `docs/accuracy-audit/full-app-audit-2026-06-08.md` (findings ledger) + the invariant set encoded in the property harness.
- **Phase A1 — Machine-driven bug-finding (no oracle needed) — [x] DONE: `scripts/src/tax-engine-property-harness.ts` (~5,636 fast-check runs, seed 20260608). Found the −1e308 engine-totality overflow.**
  - [x] **Property-based suite** (fast-check): all-finite + AGI ≥ taxable ≥ 0 + non-neg taxes + sane effective rate over 1,500 realistic returns.
  - [x] **Boundary/threshold sweep:** ±$1 + exact-boundary continuity at the 2024 bracket edges (P4).
  - [x] **Metamorphic + fuzzing** (gross-tax monotonic in wage income; 2,500 malformed/extreme inputs → no crash/NaN/Infinity). *(Differential-year relations partial; full cross-year metamorphic with the oracle is A2.)*
- **Phase A2 — Differential vs oracles:** [ ] run the shared scenario space; triage every divergence (could be the oracle's bug — investigate both); IRS ATS + Pub 17 as tie-breakers. **← OPEN (needs A0).**
- **Phase A3 — CPA scenario matrix (common + uncommon):** [~] partial — large scenario batteries exist (cpa-scenarios 20 archetypes, realworld S1-S17, 16-scenario battery, planning-scenarios 11 archetypes) covering most of the uncommon list incl. the now-closed **§1250/collectibles/§1231**. Open: the full 5×archetype×life-event×50-state CPA-hand-calc'd corner matrix + CPA sign-off.
- **Phase A4 — Planning-engine audit:** [~] partial — `tax-engine-detector-coverage-tests.ts` (catalog↔detector parity, 101/101) + catalog-freshness at every supported year + false-positive sweeps (Q1-Q4 fixed) + bounded heuristics. Open: the full fire/suppress confusion matrix + savings-vs-independent-calc for all 101.
- **Phase A5 — Functionality-level audit (EVERY feature) — [~] substantially DONE via the 14-agent fan-out (one per subsystem, each verifying numeric rules vs the primary source):**
  - [~] **AI extraction accuracy** — round-trip + info-return mapping audited (F1 case-sensitivity bug fixed); the full 100-doc precision/recall benchmark on paid quota still open.
  - [x] **Multi-state + local depth** — NR method-(a) states vs their NR forms (73 assertions), part-year income-% method, local taxes (NYC/PA/OH/MD incl. graduated counties/IN/KY/Yonkers), reciprocity, resident credit — all audited + the WV/MA/MD/state-rate fixes shipped.
  - [ ] **Form/workpaper generator output** — pending T2.1 (the generator doesn't exist yet).
  - [x] **Exports + API contract** — PDF/CSV/JSON/.gen + the OpenAPI contract + all yes-API integration suites green; SCH1 surfaced the T1.1 outputs through the seam.
  - [x] **What-if + multi-year primitives** — purity, mutation ordering, carryforward chaining, RMD/IRMAA models, optimizer convergence (the SEC2 horizon-DoS bound shipped).
  - [x] **Diagnostics + planning surfaces** — hit-list ranking, peer-benchmark, state-comparison, planning-calendar audited under real data.
- **Phase A6 — Sign-off:** [ ] CPA review of the matrix + every divergence; publish the audit report. **← OPEN (needs a CPA design partner, T4).**
- **Exit criteria:** bug-discovery rate ~0 across all techniques **and across every feature/functionality** · every divergence root-caused · the whole campaign is a **CI-runnable suite** · CPA sign-off. **STATUS: machine + fan-out techniques green & all findings fixed; the oracle technique (A2) + CPA sign-off (A6) remain before this can be marked [x].**

---

## T1 — PERFECT THE ENGINES (accuracy + the real capability gaps)

> **Honest answer to "are the engines perfected?": no.** Accuracy auditing (T0.3) refines what's *modeled*; these add *capability*. The first group are **latent correctness bugs** (a client gets a wrong number today) — verified absent in code 2026-06-08.

### T1.1 Tax calculator — correctness-affecting gaps (HIGH; the audit will surface these) — **ALL DONE 2026-06-08 (commit 2cb182d)**
- [x] **Unrecaptured §1250 gain (25% rate)** — DONE. Schedule D Tax Worksheet 25% bucket (`taxCalculator.calculateFederalTaxWithCapitalGains`); per-lot `capitalTransactions.gainClass`/`unrecaptured1250Amount` + the `unrecaptured_section_1250_gain` adjustment + Form 4797 feed it. 79 hand-calc'd tests.
- [x] **Collectibles 28% rate gain** (§1(h)(5)) — DONE. 28% bucket in the same worksheet; `gainClass:"collectible"/"section1202"` + `collectibles_28_rate_gain` adjustment.
- [x] **§1231 netting + Form 4797 + depreciation recapture (§1245/§1250)** — DONE. New pure `form4797.ts` (`computeForm4797`): §1245 full-recapture + §1250 excess-recapture → ordinary, unrecaptured §1250 → 25% bucket, net §1231 gain→LTCG / loss→ordinary (no $3k cap), §1231(c) 5-year lookback. New `TaxReturnInputs.form4797` + `section_1231_lookback_loss` adjustment.
- [x] **State individual-mandate penalty** (CA, MA, NJ, RI, DC) — DONE. New pure `stateMandate.ts`: CA/NJ/RI/DC greater-of(flat, 2.5%) capped at bronze; MA FPL-tier monthly. `months_without_minimum_coverage` adjustment; folds into stateRefundOrOwed. 31 hand-calc'd tests. (MA 2024+ monthly amounts are PROVISIONAL — confirm vs the annual TIR.)

### T1.2 Tax calculator — capability enhancements (in-scope individual 1040) — **DONE 2026-06-09 (all items shipped + deployed; migrations 0017+0018)**
- [x] **§280F luxury-auto depreciation caps** + listed-property — DONE. Dedicated capped path in `computeScheduleCAssetDepreciation` (caps Rev. Proc. 2024-13/2025-16/2026-15, vintage-fixed, the post-year-6 "overhang" modeled via replay); ≤50%-use ADS SL; heavy-SUV §179(b)(5) cap. New asset fields isPassengerAuto/businessUsePct/gvwrOver6000 (migration 0017). 17 tests.
- [x] **Schedule H** — household employment (nanny) tax. DONE (commit 94f70a4).
- [x] **Form 2210 annualized-income method** (Schedule AI) — DONE. `computeForm2210Annualized`: annualizes per-period income (factors 4/2.4/1.5/1, applicable % 22.5/45/67.5/90), returns the per-period required installment (capped at 25% RAP + recapture). Only lowers early installments for back-loaded income.
- [x] **Digital assets / 1099-DA** — DONE (engine income). `crypto_staking_income` (ordinary, not SE; Rev. Rul. 2023-14) + `crypto_mining_income` (SE business income). The 1099-DA extractor + per-wallet basis-tracking transition remain AI-layer follow-ups.
- [x] **Per-property suspended-loss STORAGE + §469(g) release** — DONE. RentalPropertyFact.fullyDisposedThisYear + suspendedLossCarryforward (migration 0018); on full taxable disposition the property's current-year net + suspended PAL release freely (no $25k cap). New output section469gReleasedLoss.
- [x] **SE-tax edges** — DONE. Clergy (prior) + statutory employee (Sch C, not in SE base), church-employee income ($108.28 SE trigger), SE non-farm optional method (Sch SE Part II election).
- [x] **State depth** — DONE (AMT + WA). CO AMT (3.47%) + CT AMT (lesser-of 19%×TMT or 5.5%×AMTI; federal TMT plumbed); WA capital-gains threshold corrected to $270k/$278k + the 2025+ 2.9% surcharge over $1M. (Additional state-specific credits beyond the existing 31 remain an incremental enhancement.)
- [x] **Carryforward completeness audit** — DONE. `tax-engine-carryforward-audit-tests.ts` (10) verifies all 8 carryforwards (NOL/cap-loss ST+LT/charitable/§163(j)/AMT-credit/AMT-NOL/PAL) capture + apply round-trip correctly. Zero gaps found.
- [ ] **(Scope decision — flag to founder, not assumed) Business returns** (1065/1120-S/1120/1041). Out of scope (Option A).

### T1.3 Tax planning engine — capability enhancements — **DONE 2026-06-09d (what-if UI + estate touchpoints shipped + deployed; heuristic-promotion triaged-and-resolved). The remaining `[ ]` items are forward law-evolution work, not gaps.**
- [~] **Promote the ~44 heuristic detectors to engine-verified** what-ifs — **RESOLVED 2026-06-09d (evidence-based re-triage, `docs/planning-detector-promotion-triage.md`).** The cleanly-modelable detectors (current-year, income-tax-complete, determinable amount) are ALREADY engine-verified (§1244/§453/§41/§163(d)/§221/Saver's/adoption/PTC/SEP/HSA/SEHI/…). The remaining ~50 are deliberately heuristic — multi-year/future-growth, engine-invisible component (DCFSA FICA), qualitative/structural (trusts, entity elections), or requires-a-guessed-input — and force-wiring them would inject incomplete/falsely-precise "verified" numbers. Promote one only if a new client-supplied input makes its mechanic determinable + income-tax-complete.
- [x] **Multi-year global optimizer** — DONE. `multiYearOptimizer.ts` (`optimizeBracketFilling`): sizes the per-year income realization / Roth conversion to fill to a target bracket top, with per-year incremental tax + blended rate. New `federalBracketCeiling` helper. POST /clients/:id/bracket-fill. 6 hand-calc'd tests.
- [x] **Strategy-combination global optimization** — DONE. `strategyComboOptimizer.ts` (`optimizeStrategyCombination`): greedy forward selection over the real engine to find the best SUBSET, modeling interaction erosion (combined vs Σ individual). 6 tests.
- [x] **Monte Carlo** on the multi-year trajectory — DONE. `monteCarloEngine.ts` (`runMonteCarlo`): N seeded stochastic trajectories → p10/p25/p50/p75/p90 bands on cumulative tax + ending portfolio. POST /clients/:id/monte-carlo. 40 tests (determinism + convergence anchor). (Built by a worktree agent, reviewed for purity + integrated.)
- [x] **Deadline-aware planning calendar** — DONE (commit 8c529b1).
- [x] **Interactive what-if scenario builder** (frontend UI over the existing what-if engine) — DONE 2026-06-09d. `WhatIfScenarioBuilderCard` on the Planning tab: compose arbitrary mutations (add/replace/remove adjustment, change a client fact) → exact engine federal+state delta, baseline-vs-scenario table. Browser-verified ($50k deduction → −$18,500 = 50k×37%).
- [ ] **New + state-specific strategies** as law evolves — STILL OPEN (forward work as the law changes).
- [x] **Estate/gift planning touchpoints** (qualitative flags) — DONE 2026-06-09d. New `"estate"` category + G1.101–G1.106 (annual-exclusion gifting §2503(b), 529 superfunding §529(c)(2)(B), SLAT, ILIT, GRAT, §1014 step-up). Confidence 0.40–0.50 (informational — no estate-tax engine); year-indexed annual excl $18k/$19k/$19k + BEA $13.61M/$13.99M/$15M. Catalog v1.21.0; +29 hand-calc'd tests.

---

## T2 — WIN THE FIRM (the features a CPA pays for) — **[x] ENGINEERING-COMPLETE 2026-06-10b.** Every buildable T2.1 + T2.2 item is shipped. The only open lines are externally gated (T2.1 CPA legibility sign-off — needs the T4 design partner) or deferred by design (T2.1 filable/MeF forms — parked per Option A; T2.2 Haven-platform features).

### T2.1 Form / workpaper generator — **GAME PLAN B** — **[x] B0–B4 DONE + DEPLOYED 2026-06-10 (commit df94d5e). Remaining: A6-style CPA legibility sign-off (needs a design partner, T4).**
> The engine already computes ~30 forms; the high-value feature is a **workpaper / review packet** (CPA cross-checks their prep software line-by-line; client gets a clean packet) — **not** filed forms (Option A; filed forms need Pub 1167 substitute approval + MeF XML — parked).
- [x] **Phase B0 — Architecture:** pure `FormSpec` data model + generic pdfkit renderer + registry. `artifacts/api-server/src/lib/forms/`: `formSpec.ts` (FormInstance/FormLine + line constructors + the `checkLine` ✓/⚠ tie-out device), `formRenderer.ts` (THE only pdfkit dep — substitute-form renderer + packet assembler: cover page, DRAFT watermark every page, numbered footers), `registry.ts` (packet order). Builders are pure `(ctx) => FormInstance | null` — Haven-portable (no Date/random/DB), unit-tested on line values (no PDF parsing). Substitute-form approach (not official-PDF overlay) for portability.
- [x] **Phase B1 — Core packet:** `reconciliationWorksheet.ts` (8 parts: income→AGI→taxable→tax composition→credits→federal settlement→state settlement→carryforwards, each tied with engine-exact ✓/⚠ rows mirroring the engine's OWN assembly identities; residual rows make each section tie by construction). 1040 + Sch 1/1-A/2/3 + Sch A/B/C/D+8949/E/SE/H builders.
- [x] **Phase B2 — Credits + other-taxes:** 8812, 8863, 8880, 2441, 8962, 5695, 8839, 1116 · 6251, 8959, 8960, 8615, 5329.
- [x] **Phase B3 — Detail forms:** 8995/8995-A, 4562, 8582, 4952, 2555, 7206, 8283, 4797.
- [x] **Phase B4 — state main forms** CA 540, NY IT-201, NJ-1040, MA Form 1, PA-40 + a **generic state fallback** (covers the other ~44 states). Summary-workpaper style (the engine exposes state aggregates, not per-line state build-up) — honestly labeled, no per-state refund (engine settles state-side in aggregate → cross-refs Reconciliation Worksheet Part 7).
- **Endpoint:** `GET /clients/:id/tax-return/workpapers/pdf` (OpenAPI `getWorkpaperPacketPdf`); frontend "Workpaper packet (PDF)" primary button on ClientDetail. Engine additions (additive, zero regression): `obbbaSchedule1A` detail + 4 state-credit scalars exposed on `ComputedTaxReturn` so settlements tie to the cent.
- **Tests:** 13 no-API hand-calc'd suites (`tax-engine-workpaper-*-tests.ts`, ~1,724 assertions) + `tax-engine-workpapers-integration-tests.ts` (yes-API). Full battery green (100 suites / 6,345 no-API assertions); 40-form packet render smoke + prod smoke green.
- [ ] **Exit criteria — REMAINING:** a CPA validates legibility + correctness vs their software on the T0.3 scenario matrix (needs a design partner — gated on T4).
- [ ] **(Parked) Filable official/substitute forms + MeF e-file XML** — only if Option B / real filing resurfaces.

> **Engine bug surfaced during T2.1 — FIXED + DEPLOYED 2026-06-10 (commit after df94d5e):** the **student-loan-interest (§221) MAGI omitted the traditional-IRA deduction** (`taxReturnEngine.ts` `magiForSli`), over-phasing-out §221 when a deductible IRA pushed MAGI across the $80k/$165k band. Fixed per Pub 970 Worksheet 4-1: the engine now computes the IRA deduction FIRST (its Pub 590-A MAGI is independent of SLI) and SLI MAGI = AGI-without-SLI (net of IRA) + FEIE add-back. Repro single $90k SE + $4k IRA + $1,500 SLI now deducts the full $1,500 (was $1,135.83); no-IRA filers unchanged. Regression: `tax-engine-section221-sli-magi-tests.ts` (10 hand-calc'd, incl. the FEIE add-back). Full battery green (101 suites / 6,355).

### T2.2 CPA-firm features — **GAME PLAN D** (each ships with T0.3 audit rigor + T0.2 security) — **[x] COMPLETE 2026-06-10b: every engineering item shipped (the 2026-06-10 core + the completion batch below). The only remaining T2.2 line is the Haven-platform set, deferred BY DESIGN.**
- **Phase D1 — Recurring-revenue / planning:**
  - [x] **Tax projection + quarterly estimates** — DONE. `taxProjection.ts` (`computeTaxProjection`): projects next year (reuses `projectYearForward`), sizes the four §6654 safe-harbor 1040-ES vouchers (reuses `computeForm2210`: min(90%-projected, 100%/110%-prior)), YoY + OBBBA deltas. `GET /clients/:id/tax-projection?incomeGrowth=`. 35 hand-calc'd tests.
  - [x] **MFJ-vs-MFS optimizer** — DONE. `filingStatusOptimizer.ts` (`optimizeFilingStatus`): computes the joint return + two MFS returns (income split by spouse tags, §63(c)(6)(A) itemized coupling, withholding-independent net-tax metric), recommends + quantifies. `GET /clients/:id/mfj-vs-mfs`. 28 hand-calc'd tests (incl. the doubled-bracket symmetry + a real MFS-win).
  - [x] **Entity-choice / S-corp reasonable-comp calculator** — DONE 2026-06-10b. `entityChoice.ts` (`analyzeEntityChoice`): REAL engine runs (the Sch C inputs are replaced by a W-2 + active S-corp K-1 with §199A QBI/wage-limit interplay) + the statutory payroll adders (employer/employee FICA with the per-person SS cap vs per-employer base distinction, net FUTA). Default 35/50/60%-of-profit sweep or an explicit `?reasonableComp=`; the comparison metric is the withholding-independent net tax (shared `netTaxAfterCredits`). SEHI modeled net-zero under the S-corp per Notice 2008-1; framed as "cheapest MODELED level", never a comp opinion (Rev. Rul. 74-44 assumptions). `GET /clients/:id/entity-choice`. 62 hand-calc'd tests (full E1 hand-calc: $200k profit @ $80k comp → S-corp saves $9,503.38).
  - [x] **Year-over-year + OBBBA-impact analysis** — DONE. `yearOverYear.ts` (`computeYearOverYear`): line-by-line deltas + notable swings + the OBBBA Schedule 1-A law-change benefit. `GET /clients/:id/year-over-year?priorYear=`. 25 hand-calc'd tests.
  - [x] **Client-facing branded planning deliverable** — DONE 2026-06-10b. `planningReportPdf.ts`: Brookhaven-branded PDF (cover with headline savings + the vector BrandMark, executive summary, per-opportunity detail with engine-verified badges/citations/confidence, the deadline calendar, multi-year trends, disclosure page). Deterministic — every figure is engine output; no LLM. `GET /clients/:id/planning-report/pdf` (pro-gated) + a "Client report (PDF)" button on the Planning tab.
- **Phase D2 — Prep-workflow efficiency:**
  - [x] **Personalized client organizer / document-request list** — DONE 2026-06-10b. Pure `clientOrganizer.ts`: every prior-year W-2 employer / 1099 payer (per formType) / K-1 entity / rental / account becomes a tracked request that flips to "received" when the matching current-year record exists; prior-return-driven deduction reminders (1098/charitable/1098-T/1098-E/HSA/IRA/SEHI/2441/1095-A); the 7-question life-events questionnaire (incl. the 1040 digital-asset question). `GET /clients/:id/organizer` + a branded PDF checklist (`organizerPdf.ts`) at `/organizer/pdf`. 43 fixture tests.
  - [x] **"Ready to file" gate** — DONE (expanded `returnDiagnostics.ts`): EITC-exceeds-dependents cross-check, qualifying-child-SSN reminder, + the new "Audit risk (DIF)" category (large rental loss, charitable-to-AGI > 30%) + material-carryforward awareness. 52 diagnostics tests. (Dependent-TIN completeness is NOT data-model-backed — surfaced as an SSN reminder instead.)
  - [x] **Prior-year roll-forward** — DONE 2026-06-10b. `POST /clients/:id/roll-forward` (proforma): copies the prior year's W-2s/1099s (document links + field boxes detached), K-1s (opening basis ← prior ENDING basis; per-year facts reset), rentals (disposed ones skipped, disposal flag reset), and asset balances into the new year as estimates; advances client.taxYear; transaction-wrapped; 409 when the target year already has rows. Carryforwards are NOT copied — the response reports what the pipeline's `synthesizePriorYearCarryforwards` (now exported; single source of truth) auto-seeds. Capital transactions never roll. Pure mappers in `rollForward.ts` (destructure-and-spread so new columns roll automatically); 37 mapper tests.
  - [x] **Audit-risk / DIF-style flagging** — DONE (folded into the ready-to-file gate above: rental-loss + charitable-ratio DIF flags; outsized-Sch-C-loss is undetectable from the output [SE base floored at 0] so the rental loss is the business-loss signal).
  - [x] **Engagement status + extension/due-date tracking** — DONE 2026-06-10b (deliberately MINIMAL — full workflow is Haven's). `engagement.ts` (pure): 6-status enum + §6072(a)/§6081 deadlines with the §7503 weekend roll (holiday shifts documented as not modeled — never later than the true date) + days-until. 2 additive columns on tax_returns (**migration 0019**: engagement_status / extension_filed). `PATCH /clients/:id/tax-return/engagement` + firm-wide `GET /engagements` (deadline-sorted, status counts). 21 hand-verified date tests.
- **Phase D3 — AI differentiators (LLM never does math):**
  - [x] **NL Q&A grounded in the computed return** — DONE 2026-06-10b. `returnQa.ts`: the LLM NARRATES from a ~50-field engine-computed grounding snapshot (rounded; first-name-only — a key-scan test proves no PII fields); hard no-arithmetic + cite-the-field + question-is-untrusted-data prompt constraints; question sanitization (control chars, 1,000-char cap). §7216-gated like the memo — no consent/AI → the deterministic key-figures summary with aiUsed=false. `POST /clients/:id/return-qa` + the "Ask this return a question" card on the Planning tab. 29 tests (incl. a hand-calc'd anchor return).
  - [x] **Proactive threshold alerts** — DONE (folded into `yearOverYear.ts`): observed crossings of NIIT / Additional Medicare / AMT / §199A wage-UBIA phase-in / IRMAA Medicare-premium tier / refund→balance-due, with direction (entered/exited) + the planning action.
  - [x] **Firm-wide planning campaign tool** — DONE 2026-06-10b. `planningCampaigns.ts`: pure `aggregateCampaigns` groups the firm's top planning-score clients (the hit-list fast path, bounded ≤200) into one campaign per strategy (cohort, per-client engine savings, totals/median); `draftCampaignEmail` writes a reusable {{firstName}}/{{estSavings}} mail-merge template — **§7216 by design: the LLM receives ONLY catalog strategy text + anonymous $100-rounded cohort stats (no client identity/figures), so no per-client consent is needed; the merge happens locally** (drafts that lose the merge fields fall back to the deterministic template). `GET /planning-campaigns` + `POST /planning-campaigns/email-draft` (pro-gated) + a Dashboard "Planning campaigns" widget. 25 tests.
- [ ] **(Haven platform — deferred BY DESIGN, confirm before ever building here):** e-signature (§7216 + engagement letters) · per-return/per-plan billing · review-notes/collaboration · client portal. These are multi-tenant platform features Haven already owns — building them pre-migration would be throwaway (see "Explicitly DON'T invest").
- **Frontend:** "CPA Tools" tab now 7 cards (engagement, projection+1040-ES, MFJ-vs-MFS, entity-choice, YoY+threshold-alerts, organizer+PDF, roll-forward); Planning tab + "Client report (PDF)" + the return-Q&A card; Dashboard + the campaigns widget. Tests: 10 no-API suites (~314 assertions: 88 prior + 226 new incl. PDF smokes) + `tax-engine-cpa-tools-integration-tests.ts` (yes-API, expanded to ~60 assertions across all 10 endpoints). **Migration 0019** (additive). `fast-check` added to scripts devDependencies (the property harness's missing dep — typecheck:tests now 0 errors vs the 10 pre-existing).

---

## T3 — Haven migration (P3)
- [ ] Build the bridge: Prisma tax-data models + the `TaxReturnInputs` adapter on the Haven side; map Drizzle → Prisma (versioned migrations are the enumerable source).
- [ ] Repackage the engine as a **compiled** `@haven/tax-engine` + `@haven/tax-planning` npm package (NestJS imports at runtime).
- [ ] Standing constraint: keep `computeTaxReturnPure` pure; document any `TaxReturnInputs`/`ComputedTaxReturn` additions (the I/O contract IS the seam).

## T4 — Business gates (founder)
- [ ] Land **1 named CPA design partner** + a real side-by-side vs UltraTax on real returns (the ultimate oracle for T0.3) → an honest case study.
- [ ] Reset pricing (per-return $50–150 or a Holistiplan-adjacent tier).
- [ ] Confirm the game: "migrate the brain into Haven" — stop straddling.

## Explicitly DON'T invest (Haven replaces it, or wait for demand)
- SPA refactors / login UI / code-splitting / dark mode — Haven's portals replace the SPA.
- Real UltraTax / SDE write-back — multi-month, gated on a paying partner confirming it's their blocker.
- Trust/estate (1041), partnership (1065), S/C-corp (1120-S/1120), 706/709, e-filing — out of scope per Option A (see T1.2 business-returns flag).
- Long-tail state credits / PA EIT (~1,800 munis) / OH SDIT long tail / MD per-dependent / HSA last-month — only when a customer asks.

---

## Suggested execution order (highest leverage first)

1. **T0.1** (yours — rotate creds; it unblocks everything). — still open.
2. ~~**T0.3 Phase A1** — machine-driven bug-finding harness~~ **✓ DONE** (property/fuzz/boundary/metamorphic, 5,636 runs).
3. ~~**T1.1** — §1250 / collectibles / §1231 / state-mandate correctness gaps~~ **✓ DONE** (+ the full-app fan-out audit closed all ~45 findings).
4. **T0.3 Phase A0 + A2** — the differential-**oracle** layer (OpenTaxSolver/ustaxes/tenforty + IRS ATS). **← NEXT highest-leverage engineering move:** turns the self-consistency harness into oracle-backed cross-validation, the last unmet T0.3 technique.
5. **T0.2 Phase C1–C2** — consent ledger + PII, in parallel (different skill set).
6. **T1.2/T1.3** — capability enhancements (§280F luxury-auto is the top T1.2; promote heuristic planning detectors / multi-year optimizer for T1.3).
7. ~~**T2** — forms/workpapers + firm features~~ **✓ ENGINEERING-COMPLETE 2026-06-10b** (T2.1 workpapers + all T2.2 firm features; remaining lines are externally gated or Haven-deferred by design).
8. **T3/T4** — Haven + business (a CPA design partner also unblocks T0.3-A6 sign-off + the T2.1 legibility sign-off).
