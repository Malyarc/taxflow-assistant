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
- **Engine:** individual Form 1040, 50 states + DC, OBBBA-conformant, multi-state NR tax-ratio for 25 states + part-year + local taxes; computes line values for ~30 federal forms; ships substitute PDFs for 1040 / 1040-X / 2210 / 4868 / 8606 / 8824 / 8990. **~4,600 hand-calc'd assertions, deployed.**
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

### T0.3 [P0] Large-scale accuracy audit campaign — **GAME PLAN A** (the credibility gate)
> "Zero bugs" is unprovable; the **bug-discovery rate** is driven to ~0 across *independent* techniques — the safety-critical-numerics standard. Today's ~4,600 hand-picked assertions have a coverage ceiling (they test what the author thought of). These find what the author didn't. **This campaign will surface the T1 engine gaps — run it and the §1250/collectibles/§1231 bugs fall out.**
- **Phase A0 — Foundation (harness + methodology):**
  - [ ] Differential-oracle **adapter layer** (`TaxReturnInputs` → each oracle's input format) + a results-ledger schema + a bug taxonomy (off-by-one / stale-year-constant / missing-phase-out / ordering / rounding / missing-rate-bucket).
  - [ ] Evaluate + pick ≥2 oracles: OpenTaxSolver, `ustaxes`, `tenforty`, + the **IRS ATS published e-file test scenarios** and Pub 17 / form-instruction worked examples (authoritative). Document each oracle's coverage + known divergences.
  - [ ] Write the methodology doc (`docs/accuracy-audit/master-campaign.md`) + define the invariant set.
- **Phase A1 — Machine-driven bug-finding (no oracle needed):**
  - [ ] **Property-based suite** (fast-check): AGI ≥ taxable ≥ 0; tax ≥ 0; effective rate ≤ top marginal; refund = payments − liability; each credit ≤ its statutory cap; phase-outs continuous (no unintended cliffs); no >100% marginal rate outside known cliffs; MFJ within the marriage-penalty bound.
  - [ ] **Boundary/threshold sweep:** auto-extract every numeric threshold (brackets, phase-out start/end, caps, age gates, AGI cliffs) → ±$1 + exact-boundary tests (the `<`/`<=` off-by-one class).
  - [ ] **Metamorphic + differential-year** (income doubling/splitting relations; same scenario across 2024/25/26) + **fuzzing** (malformed → no crash/NaN/Infinity).
- **Phase A2 — Differential vs oracles:** run the shared scenario space; triage every divergence (could be the oracle's bug — investigate both); IRS ATS + Pub 17 as tie-breakers.
- **Phase A3 — CPA scenario matrix (common + uncommon):** filing status (5) × income archetype (W-2, SE/Sch C, retiree SS+pension+RMD, investor, RE pro, multi-state, expat/FEIE, business-owner K-1) × life event (marriage/divorce/death/new-child/disability/disaster) × credit-deduction combos × all 50 states+DC; CPA hand-calcs the corners. **Explicit uncommon list:** kiddie-AMT, ISO-AMT, NIIT/IRMAA/§199A cliffs, QSBS 50/75/100% tiers, cross-account partial wash sale, §1031 boot+NIIT, §453 multi-year, NOL 80% limit, excess-SS (multi-employer), Roth+IRMAA 2-yr lookback, charitable 60/30/20 carryforward, disaster casualty, HSA excess §4973, §72(t) SEPP, Saver's QSS boundary, EITC investment-income disqualification, adoption special-needs refundable split, PTC clawback-cap vs additional, SEHI/§162(l), QSS 2-yr window, Form 8332 split custody, **§1250 unrecaptured 25%, collectibles 28%, §1231/4797 recapture** (these last three are known gaps — T1).
- **Phase A4 — Planning-engine audit:** a fire/suppress **confusion matrix** for all 101 strategies + savings within tolerance vs an independent calc + cross-strategy stacking + a false-positive sweep on a trivial W-2 return + every heuristic detector bounded against a hand-calc + catalog freshness at every supported year.
- **Phase A5 — Functionality-level audit (EVERY feature, not just the two engines):**
  - [ ] **AI extraction accuracy** — the full 100-doc benchmark on paid quota: per-field precision/recall/F1 across W-2 + 8 1099s + 6 info-returns; the document→review→approve→engine round-trip; the info-return → adjustment/client mapping correctness.
  - [ ] **Multi-state + local depth** — every NR method-(a) state vs its NR form; the part-year income-% method; local taxes (NYC PIT/UBT/MCTMT, PA EIT ~175 munis, OH SDIT ~226 SDs, MD/IN counties, KY occupational, Yonkers); reciprocity pairs; the resident credit-for-tax-paid.
  - [ ] **Form/workpaper generator output** (once T2.1 ships) — every generated form's line values reconcile to the engine AND to the official form layout; round-trip a packet through the T0.3 scenario matrix.
  - [ ] **Exports + API contract** — PDF/CSV/JSON/.gen exports correct + stable; the OpenAPI contract + the integration ("yes-API") suites green; backward-compat of the `TaxReturnInputs`/`ComputedTaxReturn` seam.
  - [ ] **What-if + multi-year primitives** — purity, mutation ordering, carryforward chaining, the RMD/IRMAA models, optimizer convergence.
  - [ ] **Diagnostics + planning surfaces** — the pre-filing checklist, the firm-wide hit-list ranking, peer-benchmark, state-comparison endpoints, all under real data.
- **Phase A6 — Sign-off:** CPA review of the matrix + every divergence; publish the audit report.
- **Exit criteria:** bug-discovery rate ~0 across all techniques **and across every feature/functionality (not just the two engines)** · every divergence root-caused (fixed or documented as a CPA-confirmed correct difference) · the whole campaign is a **CI-runnable suite** · CPA sign-off.

---

## T1 — PERFECT THE ENGINES (accuracy + the real capability gaps)

> **Honest answer to "are the engines perfected?": no.** Accuracy auditing (T0.3) refines what's *modeled*; these add *capability*. The first group are **latent correctness bugs** (a client gets a wrong number today) — verified absent in code 2026-06-08.

### T1.1 Tax calculator — correctness-affecting gaps (HIGH; the audit will surface these) — **ALL DONE 2026-06-08 (commit 2cb182d)**
- [x] **Unrecaptured §1250 gain (25% rate)** — DONE. Schedule D Tax Worksheet 25% bucket (`taxCalculator.calculateFederalTaxWithCapitalGains`); per-lot `capitalTransactions.gainClass`/`unrecaptured1250Amount` + the `unrecaptured_section_1250_gain` adjustment + Form 4797 feed it. 79 hand-calc'd tests.
- [x] **Collectibles 28% rate gain** (§1(h)(5)) — DONE. 28% bucket in the same worksheet; `gainClass:"collectible"/"section1202"` + `collectibles_28_rate_gain` adjustment.
- [x] **§1231 netting + Form 4797 + depreciation recapture (§1245/§1250)** — DONE. New pure `form4797.ts` (`computeForm4797`): §1245 full-recapture + §1250 excess-recapture → ordinary, unrecaptured §1250 → 25% bucket, net §1231 gain→LTCG / loss→ordinary (no $3k cap), §1231(c) 5-year lookback. New `TaxReturnInputs.form4797` + `section_1231_lookback_loss` adjustment.
- [x] **State individual-mandate penalty** (CA, MA, NJ, RI, DC) — DONE. New pure `stateMandate.ts`: CA/NJ/RI/DC greater-of(flat, 2.5%) capped at bronze; MA FPL-tier monthly. `months_without_minimum_coverage` adjustment; folds into stateRefundOrOwed. 31 hand-calc'd tests. (MA 2024+ monthly amounts are PROVISIONAL — confirm vs the annual TIR.)

### T1.2 Tax calculator — capability enhancements (in-scope individual 1040) — **PARTIAL (Schedule H + clergy DONE 2026-06-08, commit 94f70a4)**
- [ ] **§280F luxury-auto depreciation caps** + listed-property rules (extends the Sch C asset calculator). DEFERRED — deep change to the 108-test `computeScheduleCAssetDepreciation`; needs per-asset cap visibility + its own test suite. Top remaining T1.2 item.
- [x] **Schedule H** — household employment (nanny) tax. DONE. New pure `scheduleH.ts`: FICA (≥ threshold) + FUTA + addl-Medicare; `household_employee_cash_wages` (+`_futa_wages`) adjustment → Sched 2 line 9. 19 hand-calc'd tests.
- [ ] **Form 2210 annualized-income method** (uneven income; the engine has only the short/safe-harbor method). DEFERRED — needs per-period income inputs the engine doesn't carry.
- [ ] **Digital assets / 1099-DA** — basis tracking + staking/mining ordinary income + the 2025 1099-DA doc-type extractor (today crypto rides the generic capital-transaction path).
- [ ] **Per-property suspended-loss STORAGE + release-on-disposition** (the 8582 worksheet allocates; storage/release is the remaining gap).
- [~] **SE-tax edges** — **clergy housing allowance DONE** (`clergy_housing_allowance` adjustment → SE base only, income-tax-exempt per §107/§1402(a)(8)). Remaining: statutory employee Sch C routing, optional method, church-employee income.
- [ ] **State depth** — state AMT beyond CA/MN; state-specific credits beyond the top-10; part-year per-income-item sourcing precision (NY IT-203 / CA 540NR Sched CA line-by-line); NYC EITC sliding scale; WA LTCG-excise edge.
- [ ] **Carryforward completeness audit** — confirm every carryforward (NOL, cap-loss, charitable, §163(j), PAL, AMT credit, FTC) persists + interacts correctly across years (overlaps T0.3-A4).
- [ ] **(Scope decision — flag to founder, not assumed) Business returns** (1065/1120-S/1120/1041). Currently out of scope (Option A); a major scope-expansion if the firm needs entity returns.

### T1.3 Tax planning engine — capability enhancements — **PARTIAL (deadline calendar DONE 2026-06-08, commit 8c529b1)**
- [ ] **Promote the ~44 heuristic detectors to engine-verified** what-ifs (model each mechanic, like the §1244/§453/§163(d)/§41/§23 work) — the largest accuracy lift for planning *dollars*. Triage: modelable now vs needs-new-engine-support vs genuinely-qualitative. DEFERRED — ~2-4 hrs each; large.
- [ ] **Multi-year global optimizer** (beyond detection): optimal capital-gains harvesting across years, the Roth-conversion amount that minimizes *lifetime* tax (extend the optimizer), bracket-filling, RMD/SS-timing optimization — a constrained-optimization solver over the multi-year engine.
- [ ] **Strategy-combination global optimization** — find the best *combination* of strategies (not pairwise stacking), with the interaction-erosion modeled. Differentiated + hard.
- [ ] **Monte Carlo** on the multi-year trajectory (market-return uncertainty; the Roth optimizer assumes fixed growth) → confidence bands on lifetime value.
- [x] **Deadline-aware planning calendar** — DONE. New pure `planningCalendar.ts` (`strategyDeadline` classifier → year_end/quarterly/filing/extended/ongoing + ISO dates; `buildPlanningCalendar` groups hits soonest-first). `OpportunityHit.deadline` attached by the engine; new `GET /api/clients/:id/planning-calendar`. 32 tests.
- [ ] **Interactive what-if scenario builder** (CPA composes arbitrary engine mutations; the what-if engine exists, needs a UI) + sensitivity/assumptions surfaced on *every* strategy (extend `whatIfSensitivity`).
- [ ] **New + state-specific strategies** as law evolves (catalog is "closed" at 101 but tax law isn't); a few state-specific planning moves beyond PTET.
- [ ] **Estate/gift planning touchpoints** (qualitative flags — SLAT, annual-exclusion gifting, step-up — without computing 706/709).

---

## T2 — WIN THE FIRM (the features a CPA pays for)

### T2.1 Form / workpaper generator — **GAME PLAN B**
> The engine already computes ~30 forms; the high-value feature is a **workpaper / review packet** (CPA cross-checks their prep software line-by-line; client gets a clean packet) — **not** filed forms (Option A; filed forms need Pub 1167 substitute approval + MeF XML — parked).
- **Phase B0 — Architecture:** a reusable form-template engine (generalize the pdfkit substitute-PDF pattern; decide official-PDF-overlay vs substitute) + the **form ↔ `ComputedTaxReturn` field mapping** (data model = the reconciliation worksheet).
- **Phase B1 — Core packet:** 1040 + Sch 1/2/3 + Sch A/B/C/D+8949/E/SE + the **1040 reconciliation worksheet** (every value → its form+line; the single best CPA cross-check).
- **Phase B2 — Credits + other-taxes:** 8812, 8863, 8880, 2441, 8962, 5695, 8839, 1116 · 6251, 8959, 8960, 8615, 5329.
- **Phase B3 — Detail forms:** 8995/8995-A, 4562, 8582, 4952, 2555, 7206, 8283.
- **Phase B4 — Top-5 state main forms** (CA 540, NY IT-201, …) — per-state rendering; start small.
- **Exit criteria:** a one-click "workpaper packet" produces every computed form as a labeled PDF + the reconciliation worksheet; a CPA validates legibility + correctness vs their software on the T0.3 scenario matrix.
- [ ] **(Parked) Filable official/substitute forms + MeF e-file XML** — only if Option B / real filing resurfaces.

### T2.2 CPA-firm features — **GAME PLAN D** (each ships with T0.3 audit rigor + T0.2 security)
- **Phase D1 — Recurring-revenue / planning:**
  - [ ] **Tax projection + quarterly estimates** (next-year projection + 1040-ES vouchers + safe-harbor) — turns a 1-time return into a recurring relationship.
  - [ ] **MFJ-vs-MFS optimizer** (compute both, recommend).
  - [ ] **Entity-choice / S-corp reasonable-comp calculator** ("should this Sch C be an S-corp"; G1.17 is the seed).
  - [ ] **Year-over-year + OBBBA-impact analysis** (flag swings; quantify the law-change delta).
  - [ ] **Client-facing branded planning deliverable** (polish the memo into a firm sales artifact).
- **Phase D2 — Prep-workflow efficiency:**
  - [ ] **Personalized client organizer / document-request list** (derive from last year's return).
  - [ ] **"Ready to file" gate** (expand diagnostics: dependent-TIN completeness, CTC/EITC eligibility cross-checks, unbalanced-return checks).
  - [ ] **Prior-year roll-forward** (carry the client + auto-seed carryforwards).
  - [ ] **Audit-risk / DIF-style flagging** (outsized Sch C loss, charitable-to-income ratio, home office).
  - [ ] **Engagement status + extension/due-date tracking** (confirm vs Haven first).
- **Phase D3 — AI differentiators (LLM never does math):**
  - [ ] **NL Q&A grounded in the computed return** ("why did the refund drop $4k?" via RAG over engine output).
  - [ ] **Proactive threshold alerts** (crossed NIIT/IRMAA/§199A-phase-in).
  - [ ] **Firm-wide planning campaign tool** ("these 12 clients should convert before year-end" → one-click memos).
- **(Likely Haven — confirm before building):** e-signature (§7216 + engagement letters) · per-return/per-plan billing · review-notes/collaboration · client portal.

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

1. **T0.1** (yours — rotate creds; it unblocks everything).
2. **T0.3 Phase A0–A1** — stand up the audit harness + machine-driven bug-finding. *This is the single highest-leverage engineering move:* it hardens the core AND auto-surfaces the T1.1 correctness gaps.
3. **T1.1** — fix the correctness-affecting gaps the audit surfaces (§1250 / collectibles / §1231).
4. **T0.2 Phase C1–C2** — consent ledger + PII, in parallel (different skill set).
5. **T0.3 Phase A2–A5 + T1.2/T1.3** — finish the audit + the capability enhancements.
6. **T2** — forms/workpapers + firm features, once the core is audited and the trust layer is closed.
7. **T3/T4** — Haven + business.
