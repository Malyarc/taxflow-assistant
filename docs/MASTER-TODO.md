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
  - [ ] **(2026-06-11 audit)** `tax_documents.extracted_text` carries plaintext SSN/TIN even with `PII_ENCRYPTION_KEY` set AND is echoed by the documents LIST — strip/encrypt at the extraction write seam + drop from list projections (sibling of the blob gap). · `Cache-Control: no-store` on W-2/1099 JSON GETs returning decrypted TINs.
  - [ ] Data retention + **secure deletion (crypto-shred)** — IRS 3-yr preparer retention + state variants + client deletion rights (delete the per-record key).
- **Phase C3 — Workflow + output controls:**
  - [ ] Tax-workflow segregation of duties (preparer/reviewer/signer) + a **two-person "ready to file" dual-control gate** + §6695 signature controls.
  - [ ] Output/export security: expiring signed links, "DRAFT — not for filing" watermarking, no-cache, every export → the disclosure ledger.
- **Phase C4 — AI governance + hardening + program:**
  - [ ] AI data governance: no-training DPA enforcement, per-call TRI request/response logging, prompt-injection defense (built), firm-wide AI kill-switch.
  - [ ] Engine input hardening: DoS caps on `capitalTransactions`/K-1 array sizes, ReDoS-safe parsing, fail-loud on NaN/Infinity.
  - [ ] **(2026-06-11 audit)** Bound the what-if `mutations` array (`.max()` + string/finite caps — CPU DoS today) · fix `trust proxy: 1` on the no-proxy box (X-Forwarded-For spoofing defeats the per-IP rate limiter) · validate the §7216 consent POST fields (`durationDays` bound) · `CORS_ALLOW_ALL` must not reflect arbitrary origins with credentials · neutralize formula-leading names in TXT/JSON exports (CSV already done).
  - [ ] WISP / FTC-Safeguards operationalization: documented program (built) + named Qualified Individual + annual risk assessment + breach-response runbook + sub-processor management.
  - [ ] Secrets management: env-var secrets → a secrets manager + short-lived scoped AI keys.
- **Exit criteria:** `/security-review` clean on the full diff · independent pen-test of the data path · the compliance checklist green · counsel sign-off · no plaintext PII at rest anywhere.

### T0.3 [P0] Large-scale accuracy audit campaign — **GAME PLAN A** (the credibility gate) — **[~] MOSTLY DONE (2026-06-08→09): machine harness + 14-agent full-app fan-out RAN; all ~45 findings FIXED + deployed + prod-verified. Remaining: the differential-ORACLE layer (A0/A2) + CPA sign-off (A6).**
> "Zero bugs" is unprovable; the **bug-discovery rate** is driven to ~0 across *independent* techniques — the safety-critical-numerics standard. Today's ~4,600 hand-picked assertions have a coverage ceiling (they test what the author thought of). These find what the author didn't. **This campaign surfaced the T1 engine gaps — the §1250/collectibles/§1231 bugs fell out (T1.1, all fixed).**
- **Phase A0 — Foundation (harness + methodology):**
  - [x] Differential-oracle **adapter layer** — **DONE 2026-06-11**: `scripts/src/tax-engine-differential-oracle-harness.ts` + `differential-oracle-runner.py` (TaxReturnInputs → tenforty/OpenTaxSolver; documented tolerances + per-metric skips for proven ORACLE bugs).
  - [x] Evaluate + pick oracles — **tenforty/OTS selected + validated 2026-06-11** (TY2024+2025-OBBBA-aware; its limitations — no QBI, no SE wage-base coordination, STCG omitted from NIIT, +$64 HoH schedule — are documented in the harness header). ustaxes/IRS-ATS remain optional second oracles.
  - [x] Write the methodology doc + define the invariant set — `docs/accuracy-audit/full-app-audit-2026-06-08.md` (findings ledger) + the invariant set encoded in the property harness.
- **Phase A1 — Machine-driven bug-finding (no oracle needed) — [x] DONE: `scripts/src/tax-engine-property-harness.ts` (~5,636 fast-check runs, seed 20260608). Found the −1e308 engine-totality overflow.**
  - [x] **Property-based suite** (fast-check): all-finite + AGI ≥ taxable ≥ 0 + non-neg taxes + sane effective rate over 1,500 realistic returns.
  - [x] **Boundary/threshold sweep:** ±$1 + exact-boundary continuity at the 2024 bracket edges (P4).
  - [x] **Metamorphic + fuzzing** (gross-tax monotonic in wage income; 2,500 malformed/extreme inputs → no crash/NaN/Infinity). *(Differential-year relations partial; full cross-year metamorphic with the oracle is A2.)*
- **Phase A2 — Differential vs oracles:** [x] **DONE 2026-06-11** — 758 scenarios (5 statuses × TY2024/2025 × wages/interest/dividends/cap-gains + boundary batteries + a CA batch) vs tenforty/OTS; EVERY divergence triaged vs the primary source (several proved the ORACLE wrong); **0 unexplained divergences**. It found a real engine bug (QSS Additional-Medicare $250k→$200k, fixed `bf43c43`). **NEW ledger + 13-agent deferred backlog: `docs/accuracy-audit/full-app-audit-2026-06-11.md`.**
- **Phase A3 — CPA scenario matrix (common + uncommon):** [~] partial — large scenario batteries exist (cpa-scenarios 20 archetypes, realworld S1-S17, 16-scenario battery, planning-scenarios 11 archetypes) covering most of the uncommon list incl. the now-closed **§1250/collectibles/§1231**. Open: the full 5×archetype×life-event×50-state CPA-hand-calc'd corner matrix + CPA sign-off.
- **Phase A4 — Planning-engine audit:** [~] partial — `tax-engine-detector-coverage-tests.ts` (catalog↔detector parity, 101/101) + catalog-freshness at every supported year + false-positive sweeps (Q1-Q4 fixed) + bounded heuristics. Open: the full fire/suppress confusion matrix + savings-vs-independent-calc for all 101.
- **Phase A5 — Functionality-level audit (EVERY feature) — [~] substantially DONE via the 14-agent fan-out (one per subsystem, each verifying numeric rules vs the primary source):**
  - [~] **AI extraction accuracy** — round-trip + info-return mapping audited (F1 case-sensitivity bug fixed); the full 100-doc precision/recall benchmark on paid quota still open.
  - [x] **Multi-state + local depth** — NR method-(a) states vs their NR forms (73 assertions), part-year income-% method, local taxes (NYC/PA/OH/MD incl. graduated counties/IN/KY/Yonkers), reciprocity, resident credit — all audited + the WV/MA/MD/state-rate fixes shipped.
  - [x] **Form/workpaper generator output** — T2.1 shipped 2026-06-10 and was audited by the 2026-06-11 forms fan-out (1,724 builder assertions + the recon/NOL + WinAnsi + line-label fixes shipped in T1.0(i)).
  - [x] **Exports + API contract** — PDF/CSV/JSON/.gen + the OpenAPI contract + all yes-API integration suites green; SCH1 surfaced the T1.1 outputs through the seam.
  - [x] **What-if + multi-year primitives** — purity, mutation ordering, carryforward chaining, RMD/IRMAA models, optimizer convergence (the SEC2 horizon-DoS bound shipped).
  - [x] **Diagnostics + planning surfaces** — hit-list ranking, peer-benchmark, state-comparison, planning-calendar audited under real data.
- **Phase A6 — Sign-off:** [ ] CPA review of the matrix + every divergence; publish the audit report. **← OPEN (needs a CPA design partner, T4).**
- **Exit criteria:** bug-discovery rate ~0 across all techniques **and across every feature/functionality** · every divergence root-caused · the whole campaign is a **CI-runnable suite** · CPA sign-off. **STATUS: machine + fan-out techniques green & all findings fixed; the oracle technique (A2) + CPA sign-off (A6) remain before this can be marked [x].**

---

## T1 — PERFECT THE ENGINES (accuracy + the real capability gaps)

> **Honest answer to "are the engines perfected?": no.** Accuracy auditing (T0.3) refines what's *modeled*; these add *capability*. ~~Verified absent in code 2026-06-08~~ — **RE-OPENED 2026-06-11: the differential-oracle + 13-agent audit found ~40 more confirmed correctness bugs (9 fixed on PR #2; the rest are T1.0 below).** "Zero known bugs" is a state you re-earn after every audit technique, not a permanent badge.

### T1.0 [x] Correctness backlog — CLOSED 2026-06-11b (ALL groups (a)–(l) shipped on PR #2; 8-worktree ultracode fleet + orchestrator adjudication)
> **DONE.** Every checkbox below shipped (commits `f49da97`..HEAD on PR #2): 5 new regression suites (t10a 31 / t10b 86 / t10cd 98 / t10ef 102 / t10l worksheet) + ~60 re-derived existing expectations, battery **117 suites / 7,117+ assertions / 0 failed**, differential oracle 0 divergences, all 17 yes-API suites green (returnQa + campaign email now degrade to deterministic on a THROWN LLM call). Migrations 0021–0024 (additive, SQL reviewed). **Adjudications of record:** (1) **§1(h) CONTESTED item RESOLVED — the special-rate layers INTERLEAVE** per the Schedule D Tax Worksheet (L21/L38 mechanics; orchestrator hand-worked the worksheet on the repro + both legs of the §1231(c) case — recharacterization is tax-NEUTRAL below the 24% top); the three prior "flat 25/28%" rulings are overturned. (2) **CO TY2025 stays 4.40%** — the audit's 4.25% claim REFUTED against the DR 0104 booklet (TABOR trigger missed); pinned by test. (3) EITC §32(a)(2) is a CEILING (EIC-table method) — the audit's formula reading was half-right; engine now matches Pub 596. (4) WV TY2026 = SB 392 retroactive rates (found during verification, beyond the audit). (5) CA AMT 2024 exemptions corrected to the real FTB values ($90,048/$120,065/$60,029). Original per-item list preserved below for provenance.
> Source of truth: **`docs/accuracy-audit/full-app-audit-2026-06-11.md`** (ranked ledger) + the 13 verbatim agent reports in `agent-reports-2026-06-11/`. Work top-down; every fix ships with a hand-calc'd regression + /code-review (the standing engine-change rule). Severity tags are the audit's.
- **(a)–(l) original worklist (ALL DONE — see the close-out note above):**
- **(a) Federal credits & TY2026 law currency [Tier 1]:**
  - [x] TY2026 PTC still on the expired ARPA schedule — restore the 400%-FPL cliff + pre-ARPA applicable figures (Rev. Proc. 2025-25). (FC-01)
  - [x] §25C/§25D residential energy credits not terminated for TY2026 (OBBBA §§70505-06). (FC-02)
  - [x] §25D applied BEFORE the CTC — Sch 8812 CLW includes §25C but NOT §25D; inflates ACTC. + add §25D carryforward. (FC-11)
  - [x] EITC §32(a)(2) phase-out subtracted from the phase-in amount instead of the max credit. (FC-03)
  - [x] Form 8962 Table 5: MFS repayment uncapped + HoH given single half-caps. (FC-10) · excess-APTC repayment excluded from the nonrefundable-credit base. (FC-09)
  - [x] EITC gates: Form 2555/FEIE bar · 0-child age 25-64 check · §32(i) annuity over-inclusion. (FC-12) · ACTC Part II-B (3+ kids SS-tax alternative). (FC-13)
  - [x] §911 FEIE MAGI add-back missing on CTC/§25A/§25B (present on IRA/SLI/NIIT/adoption). (FC-14) · saver's `claimedAsDependent` gate. (FC-15) · PTC <100%-FPL gate + MAGI components (tax-exempt interest, nontaxable SS, FEIE). (FC-22/23)
- **(b) AMT credit + other taxes [Tier 1]:**
  - [x] §53(c) + §38(c) limits use GROSS income tax — must net other nonrefundable credits (Form 8801 / "net income tax"). (F-2/FC-07/08)
  - [x] MTC generation = 100% of AMT ignoring §53(d) exclusion items (SALT/std-ded AMT generates $0 credit) AND it's auto-seeded next year → build Form 8801 Part I. (F-3)
  - [x] OBBBA senior deduction AMTI addback (2025 Form 6251 line 1b). (F-4)
  - [x] Excess-SS-withholding credit (Sch 3 line 11; W-2 Box 4 already captured). (F-5) · Form 8959 Part IV withholding reconciliation. (F-6)
  - [x] Sch H 2026 FICA threshold $3,000 (SSA). (F-7) · NIIT allows the −$3,000 capital loss (8960 line 5a). (F-8) · non-qualified annuity income in NII. (F-10)
- **(c) Business / QBI / losses [Tier 1]:**
  - [x] §461(l) auto-aggregation must NET profitable businesses (repro: $395k phantom addback) + TY2026 thresholds $256k/$512k (Rev. Proc. 2025-32 — LOWER than held values).
  - [x] NOL is a Schedule 1 line 8a ABOVE-the-line deduction — every MAGI-keyed item currently runs on overstated AGI.
  - [x] QBI auto-default: subtract SEHI (§1.199A-3(b)(1)(vi)) + §199A(c)(2) negative-QBI netting + qualified-business-loss carryforward.
  - [x] OBBBA Sch 1-A MFS bar (tips/overtime/senior statutorily require joint). · §1231(c)-vs-§1250 lookback ordering (Notice 97-59). · §179 carryover re-cap (Reg §1.179-3(b)) + cap-disallowed-basis MACRS. · above-the-line §179 income limit must include W-2 wages.
- **(d) Cross-cutting / K-1 / MAGI [Tier 1]:**
  - [x] K-1 partner SE earnings → EITC/ACTC/dep-care EARNED income ($8,825 swing repro; §32(c)(2)(A)(ii)).
  - [x] K-1 Box 2 QBI double-dip (QBI on §469-suspended income) + K-1 6a/6b dividend double-count vs the 1099-DIV netting convention.
  - [x] Negative `capital_loss_carryforward_*` creates phantom income (unfloored). · NaN totality on count fields (toNum covers Numish only). · adjustments need a `taxYear` column (cross-year leakage; migration). · enum hygiene: add the 6 engine-read types missing from openapi; decide each of the ~10 no-op types (wire or remove); populate `inputs.form4797` (needs an input surface) or retire `section_1231_lookback_loss`.
- **(e) State-law currency [Tier 1 — each vs the DOR primary source]:**
  - [x] KS: SB 1 (2024) never applied — rates/std-ded/exemptions + SS now 100% exempt (remove from STATES_TAXING_SS).
  - [x] PA: Schedule SP applied TWICE + $250 (not $1,000) phase-out steps + leaks into the NR fallback.
  - [x] CO 2025 TABOR 4.25% · WV TY2024 holds TY2025 rates · HI Act 46 2025/26 phase-ins · NM HB 252 · MD HB 352 (new brackets + std-ded + 2% cap-gains surtax) · ME/LA/DC/VA std-ded corrections · IL CTC = % × IL EITC (child<12) · CA AMT exemption constants (FTB Sched P) · TY2026 cuts batch (IN/MS/NC/NE/GA/MT/OK) · DC EITC ≥85%/100%.
  - [x] SS-exclusion DEPTH for the binary STATES_TAXING_SS set: NM ≤$100k/$150k, CO 65+, VT, MN/RI thresholds, UT credit.
  - [x] Pipeline passes `childrenUnder6: 0` → CA YCTC/NJ/VT CTCs never fire in the live product (wire a real input). · VT CTC $20-per-$1k phase-out. · MS exemption fold-in. · `calculateStateTaxWithBreakdown` parity (skips WI slide/exemptions/forgiveness).
- **(f) Multistate + local [Tier 1/2]:**
  - [x] MCTMT: tax the ENTIRE net SE earnings once over the threshold (cliff, §801(b)) + TY2026 $150k threshold.
  - [x] Locality bases must subtract taxable SS (NYC/MD/IN/OH retiree over-tax). · Reading PA 3.6%. · OR out of NR_AS_IF_RESIDENT_STATES (method b). · NYC school credit HoH $63. · resident credit per-state (not aggregated). · `wages_only` locality bases should use Box 5/qualifying wages. · 2025/26 locality-rate refresh (MD Dorchester/Kent/Allegany, IN Monroe, Philly Jul-2025). · part-year SS/retirement exclusion proration. · AZ reciprocity (CA/IN/OR/VA).
- **(g) Planning engine [Tier 2]:**
  - [x] `projectYearForward` must advance taxYear on K-1s/rentals/capitalTransactions/form4797 (out-years currently DROP that income — G4/Roth/MC/G1.47 all affected; values labeled "engine-verified").
  - [x] G1.34/G1.37 conditional purchases must not carry the engine-verified badge (the G1.33/Q2 rule). · G1.92 cap at compensation (§402(g)/§415). · G1.61 year-indexed gate. · wage-proxy gating for G1.96/G1.72/G1.87/G1.57. · G1.33/G1.24 OBBBA-sunset copy. · `Math.abs` on signed refund deltas. · G4 validUntil filter. · cap heuristic mega-numbers (G1.39 $238k) below engine-verified hits in ranking.
- **(h) CPA tools [Tier 2]:**
  - [x] filingStatusOptimizer: the §63(c)(6)(A) forced-itemize override is a NO-OP (engine max()) + the household itemized fallback leaks into BOTH MFS halves → phantom "MFS saves $X". Model the legal pairs (both-itemize AND both-standard) + community-property caveat. (FS-1/2/4)
  - [x] taxProjection: consume carryforwards via captureCarryforwards/applyCarryforwards (TP-1) · complete the scale-exclusion set (TP-2) · §7503 roll on voucher dates (TP-3) · disclose withholding-growth assumption (TP-4).
  - [x] yearOverYear: IRMAA tiers → Record<TaxYear> + MFS table (YOY-1) · year-scoped adjustments caveat (YOY-2).
- **(i) Forms / exports [Tier 2]:**
  - [x] 1040 workpaper + recon Part 3: include the NOL step (false ⚠ today). · 1040-X payments-half line numbers (17-21) + Sch-H/§72(t)/HSA in other-taxes. · 4868 lines 4/5 net of nonrefundable credits. · `irsForm1040Pdf.ts` rewrite-or-retire (wrong 3a/3b/7/1a/16/23/25a/33 — stale sibling of the correct workpapers). · summary PDF: itemized-vs-std display + APTC repayment netting. · WinAnsi-safe glyphs everywhere (U+2212 DISAPPEARS — negatives can read positive). · recon 1099-MISC row + Part-5 capped credits. · Sch A/B gating edges. · CSV/.gen row completeness (Sch H/§72(t)/HSA/APTC/mandate/§1250). · 8824/8995-A/Sch-3 line labels.
- **(j) AI extraction [Tier 2]:**
  - [x] SSA-1099 Box 6 withholding → approve mapping. · 1098 Box 4 netting dead in the review modal (FieldDef + INFO_RETURN_VALUE_KEYS). · approve double-submit TOCTOU (status predicate in the UPDATE). · 1099-B Box 1g wash-sale. · W-2 Box 12 codes/Box 13 retirement-plan (drives the IRA band)/Box 10/locals 18-20. · year-scope info-return adjustments (pairs with the (d) taxYear migration). · wire or delete `validateInfoReturn` (dead code the docs claim is live).
- **(k) Frontend [Tier 2 — display/data-loss]:**
  - [x] FE-A1 formReady email-compare bug (typing in Email swaps the form to skeletons; edits lost) — also the K-1 dialog. · FE-A2 four raw-fetch dialogs ignore res.ok (error → success toast, silent data loss). · FE-A3 cleared W-2/1099 boxes must send null (can't clear a value today). · FE-A4 add the 5 missing TYPE_LABELS. · FE-A5 CTC card hardcodes $2,000 (engine: $2,200 TY2025+). · FE-A6 YoY regex coloring (credits shown red-on-increase). · AssetBalances + roll-forward query-key invalidation. · PDF/CSV downloads check content-type. · locality dropdown parity (Yonkers/Philly/OH SDs unreachable). · add an error boundary.
- **(l) Robustness / adjudications [Tier 3]:**
  - [x] `returnQa` falls back to the deterministic answer on a THROWN LLM error (today: 500). · oracle harness: distinguish skip-vs-error. · **CONTESTED:** §1(h) 25%/28% interleaving — dedicated Schedule-D-Tax-Worksheet line-by-line session before ANY change (3 prior adjudications say flat).

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

### T1.5 Accuracy DEEPENING — "the most accurate engine" program (beyond bug-fixing; each item raises the ceiling)
- [ ] **IRS Tax-Table emulation mode** (<$100k taxable, $50-bracket midpoint) — match FILED returns to the dollar (today: exact formula, ±$14 vs the table); per-line IRS-rounding option; document both modes.
- [ ] **Golden-test pack from IRS worked examples** — encode every form-instruction + Pub 17 worked example (8812/8863/2441/6251/8962/8606/2210/SE…) as fixtures; CI-pinned. The strongest authoritative oracle there is.
- [ ] **Second + third oracles**: IRS ATS/MeF published test scenarios; optionally `ustaxes`. Extend the differential harness: dependents/CTC-aware columns, itemized batches, SE-with-QBI modeled comparisons, NY/NJ/MA state batches, cross-year metamorphic relations.
- [ ] **MeF business-rules diagnostics** — encode the public e-file reject rules as return diagnostics (catch what a CPA's filing software would bounce).
- [ ] **Per-dependent data model** (DOB/SSN-present/relationship/months-in-home) — unlocks EXACT CTC vs ODC vs EITC-child vs 2441 vs 8615 gating (today: counts only). Migration + organizer + roll-forward.
- [ ] **Community-property MFS** (CA/TX/WA/AZ/ID/LA/NV/NM/WI splitting) — makes the MFS optimizer legally correct in 9 states.
- [ ] **Form 8801 full MTC model** (with (b)) + **§1(h) worksheet adjudication** (with (l)).
- [ ] **Law-watch pipeline**: per-state DOR-pinned fixture tests (the year-coverage test only checks finiteness — this audit proved that misses real rate changes) + a quarterly law-currency sweep runbook + a `lawWatch.md` register of pending effective dates (OBBBA sunsets, state triggers).
- [ ] **Filing-status trait table** (`filingStatusTraits.ts`): ONE source of truth for the QSS/MFS classification per provision (the 2026-06-11 QSS cluster existed because ~40 sites each re-encode "is QSS joint here?" inline). Refactor call sites to it; property-test the table against the statute list.

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
- **Frontend:** "CPA Tools" tab now 7 cards (engagement, projection+1040-ES, MFJ-vs-MFS, entity-choice, YoY+threshold-alerts, organizer+PDF, roll-forward); Planning tab + "Client report (PDF)" + the return-Q&A card; Dashboard + the campaigns widget. Tests: 10 no-API suites (~340 assertions incl. the review-regression pins + PDF smokes) + `tax-engine-cpa-tools-integration-tests.ts` (yes-API, expanded to ~60 assertions across all 10 endpoints). **Migrations 0019 + 0020** (both additive; 0020 = the `proforma` flag on the 5 rolled tables). `fast-check` added to scripts devDependencies (the property harness's missing dep — typecheck:tests now 0 errors vs the 10 pre-existing).
- **The 9-angle /code-review max pass + the post-fix gap sweep (2026-06-10, the standing engine-change rule) found + FIXED 19 real defects before ship** (the sweep's three: the E7 aggregate §179 election VANISHING in the S-corp scenario — income-capped at the scenario's $0 SE earnings, now taken by the entity inside Box 1; the `qbi_income` Sch-C override stacking on the modeled K-1's QBI — savings overstated ~$6.6k; a digit-boundary bug in the roll-forward cache-invalidation predicate), the headline five: (1) the pipeline-synthesized `schedule_c_section179_carryforward` survived into the entity-choice S-corp scenario → the same §179 dollars deducted twice (savings overstated ~$4.4k on the verified repro; entity-choice profit now reads the NEW engine output `netScheduleCProfit` — the deep seam — and the carryforward joined the removal set); (2) the modeled K-1's explicit §199A QBI flipped the engine's GLOBAL auto-default off for the client's OTHER K-1s (regime now matched to the baseline; E11 pin); (3) roll-forward copied the per-property rental `suspendedLossCarryforward` while the aggregate §469 auto-seed flows the same dollars → 2× the loss released in a disposal year (now nulled; mapper test pins it); (4) roll-forward marked every organizer item "received" (name-identical copies) → the **proforma flag system** (migration 0020): rolled rows are estimates the organizer keeps requesting until a CPA PATCH (which clears the flag) or a real document; (5) a pdfkit footer-pass bug forked one JUNK PAGE per real page in BOTH new deliverable PDFs **and the shipped T2.1 workpaper packet** (text below maxY auto-paginates even with lineBreak:false — fixed via `pdfBrand.applyBrandFooters` margins.bottom=0; page-count smoke pins). Plus: the planning router's pathless Pro-tier gate was 402-ing EVERY cpa-tools endpoint when PRO_TIER_ENABLED=false (mount-order swap — pre-existing since the D1 trio); the ✓ glyph isn't WinAnsi-encodable (vector check now); explicit-Box-3=0 falsy-zero in the FICA adder; the carryforward report ignoring manual-override semantics (now passes the client's real adjustments); roll-forward year guard vs SUPPORTED_TAX_YEARS (freshness invariant); /engagements statusCounts computed post-filter; engagement PATCH/GET year-resolution mismatch (3-tier now + DERIVED weekend-rolled deadlines on every TaxReturn response); the email-draft re-running the 100-client fan-out per click (now forwards the campaign's anonymous stats — zero engine runs); HSA reminder firing for every client (NOT NULL DEFAULT false column). Cleanups: shared `pdfBrand`/`downloadFile`/engine-`toNum`(clamped)/`rankedClientIdsByPlanningScore`/`loadMultiYearHistory`; dashboard campaigns widget bounded (limit 25 + 5-min staleTime); scoped roll-forward cache invalidation.

### T2.3 UX/UI 2.0 — modern design system — **[x] DONE 2026-06-12 (D1–D8 shipped + browser-verified; full green bar). Design doc: `docs/design/ux2.md`.**
> Scope discipline: build the **portable layer** (design tokens, component patterns, IA spec, a11y rules — all of which transfer to Haven's portals) first; treat page-level rebuilds as demos of the system, not an SPA rewrite. Brookhaven palette stays; this modernizes structure + density + trust cues.
> **Pick (D8): the HYBRID direction** — Linear-grade density + keyboard ergonomics inside the warm Brookhaven shell; lead with provenance + tie-outs as first-class trust cues. Portable layer in `artifacts/tax-app/src/{design,components/patterns,lib/{format,delta,returnModel}}.*`; pages (Today/Planning/Firm/ReturnReview) are demos of the system. **The two `docs/accuracy-audit/*.json` files modified this session are unrelated pre-existing churn (left uncommitted).**
- [x] **D1 Tokens v2** — type scale (`.t-*`)/spacing/semantic elevation/motion tokens + runtime dark mode on the Brookhaven palette; `lint:tokens` (scripts/src/lint-semantic-tokens.ts) drove raw-palette usage to **0** (also fixed latent dark-mode bugs where `text-violet-900` was invisible on dark cards). Single-source `lib/format.ts` (replaces ~10 dup `fmt`/`pct`).
- [x] **D2 IA + navigation** — workspace nav (Today/Clients/Planning/Firm) + ⌘K command palette (server client-search, jump-to, actions, theme; global shortcut + sidebar trigger; cmdk filter off so server results are truth).
- [x] **D3 Return workspace** — `/clients/:id/review` 3-pane demo (form-tree rail w/ tie-outs · keyboard-first line-item grid (ref-tracked roving ↑/↓, Enter explains) · diagnostics + doc-request rail). Driven by pure `lib/returnModel.ts` (residual-line tie-outs, Haven-portable). NOT a rewrite — the ClientDetail source-entry tabs are unchanged.
- [x] **D4 Provenance ("why this number")** — `components/patterns/Provenance.tsx` + `Money.tsx`: click any figure → form line ← engine identity ← signed components, with ✓/⚠ tie-out (the checkLine device). Wired into the workspace + the existing Tax Calculator (AGI, Taxable). *The trust differentiator no competitor shows.* (Source-document bounding-box link is a future hook — the input-chain + tie-out is surfaced now.)
- [x] **D5 Diff language** — `lib/delta.ts` + `components/patterns/Delta.tsx`: one model (does an increase help the taxpayer? → tone → classes) for YoY/1040-X/what-if/roll-forward. The FE3 sets moved here verbatim; ClientDetail's `amendDeltaClass`/`yoyDeltaClass` are now behavior-preserving shims over it.
- [x] **D6 Workflow surfaces** — Firm engagement board (deadline-sorted, inline status edit persisted, urgency pills, status-count tiles, rows expand to the doc-request tracker) + `DocRequestTracker` (organizer checklist, shared StatusPill vocab) + Today refresh (KPIs + deadlines + planning peek; firm planning widgets moved to /planning).
- [x] **D7 Accessibility + output polish** — runtime dark mode (`design/theme.tsx`: light/dark/system + persistence + pre-paint no-flash), global `:focus-visible` ring, skip-to-content link, reduced-motion, labelled command dialog (sr-only title), print styles retained. (Full WCAG AA contrast audit of every state remains an incremental pass.)
- [x] **D8 Claude-Design concept round** — 3 explorations (modern-dense / classic-professional / hybrid) → picked hybrid → shipped tokens+components; documented in `docs/design/ux2.md`.

---

## T3 — Haven migration (P3)
- [ ] Build the bridge: Prisma tax-data models + the `TaxReturnInputs` adapter on the Haven side; map Drizzle → Prisma (versioned migrations are the enumerable source).
- [ ] Repackage the engine as a **compiled** `@haven/tax-engine` + `@haven/tax-planning` npm package (NestJS imports at runtime).
- [ ] Standing constraint: keep `computeTaxReturnPure` pure; document any `TaxReturnInputs`/`ComputedTaxReturn` additions (the I/O contract IS the seam).

## T4 — Business gates (founder)
- [ ] Land **1 named CPA design partner** + a real side-by-side vs UltraTax on real returns (the ultimate oracle for T0.3) → an honest case study.
- [ ] Reset pricing (per-return $50–150 or a Holistiplan-adjacent tier).
- [ ] Confirm the game: "migrate the brain into Haven" — stop straddling.

## T5 — GROWTH: new revenue features for CPA firms (entrepreneur tier, 2026-06-11)
> Market frame: Holistiplan leads (~39% share) on INSTANT 1040-upload analysis; Corvee sells strategy DEPTH (1,500+); TaxPlanIQ sells ~$12k/yr workflows; SafeSend/TaxDome own the last mile; 8821 transcript monitoring is the hottest recurring-revenue add (firms report $50k–$300k/yr). We already own the rarest asset — a REAL computing engine (they estimate; we compute). Every item below: §7216 consent + disclosure-ledger + no-PII-to-LLM by construction; 8821/2848 scope respected.
- [ ] **G-1 IRS Account Monitor** (8821-based transcript monitoring): nightly transcript pulls per consenting client → alerts (new notice, balance change, CP2000 signature, audit flags) → AI-drafted, CPA-reviewed response letters grounded in OUR computed return. *What it brings: a $30–50/client/yr subscription line + the #1 retention hook ("we see IRS problems before the letter arrives"). The engine grounding makes responses better than generic tools.*
- [ ] **G-2 Second-Look Prospect Analyzer** (lead-gen): upload any prior-year 1040 PDF → OCR the full return (extend the extractor beyond source docs) → run OUR engine + 107-strategy detector → branded "missed savings" teaser → book-a-consult. Firm-website embeddable. *Brings: the Holistiplan-killer demo + a measurable new-client funnel for firms. Compliance: prospect consent at upload; PII handled under T0 controls.*
- [ ] **G-3 Advisory Proposal + ROI packager**: turn verified savings into a fee proposal ("$12,400 found vs $2,500 planning fee — 5.0× ROI"), engagement letter, e-sign. *Brings: converts our engine output into the firm's PRICING moment; the single biggest "make firms money" lever.*
- [ ] **G-4 Quarterly Estimate Autopilot** (subscription advisory): QBO/Gusto/Plaid feeds → quarterly safe-harbor recalc (engine already does §6654) → refreshed vouchers + client reminders with IRS Direct Pay links. *Brings: converts 1×/yr prep clients into 4×/yr advisory subscriptions; near-zero marginal CPA time.*
- [ ] **G-5 Entity Scenario Lab** (expand entity-choice): S-corp vs partnership vs C-corp(+§1202 QSBS timeline) side-by-side, multi-year, with reasonable-comp benchmark ranges + payroll-cost realism. *Brings: the $1,500–$5,000 entity-study deliverable firms sell to every profitable Sch-C client.*
- [ ] **G-6 K-1 package ingestion**: multi-page K-1s w/ footnotes + state schedules → extractor → per-state K-1 facts (we already compute downstream). *Brings: the single most-hated manual task in HNW prep; SurePrep-grade pain, mid-market price.*
- [ ] **G-7 Annual "Tax Health Report"** (extend the planning report): YoY + thresholds crossed + carryforward inventory + next-year calendar, branded. *Brings: the artifact firms attach to every delivered return — visible value = referrals.*
- [ ] **G-8 Specialty-credit referral detector**: flag cost-seg / R&D-study / DB-plan / ERC-adjacent candidates from data we already hold (rentals>$X, QRE markers, SE>$300k) → partner-referral workflow. *Brings: referral revenue share + advisory depth without in-house specialists.*
- [ ] **G-9 Firm benchmarking analytics**: anonymized, $100-rounded cross-client stats (effective-rate distributions, strategy-adoption gaps) → "your book vs opportunity" report. *Brings: practice-management insight; reuses the campaigns anonymization ethos.*
- [ ] **G-10 Client notifications layer** (Haven-side when portals land): deadline/voucher/doc-request push + SMS. *Brings: the SafeSend-style last-mile polish; defer the UI to Haven, build the event spine here.*
- **Sequencing:** G-3 + G-7 first (pure packaging of EXISTING engine output — weeks, zero new compliance surface) → G-2 (extends extraction; the demo that lands T4's design partner) → G-1 (new external integration; biggest recurring line) → G-4/G-5 → G-6/G-8/G-9/G-10.

## Explicitly DON'T invest (Haven replaces it, or wait for demand)
- SPA refactors / login UI / code-splitting — Haven's portals replace the SPA. **EXCEPTION (2026-06-11): T2.3 UX/UI 2.0 is sanctioned for the PORTABLE layer (tokens/components/IA/a11y — they transfer to Haven); page-level rebuilds stay scoped to demos of the system.**
- Real UltraTax / SDE write-back — multi-month, gated on a paying partner confirming it's their blocker.
- Trust/estate (1041), partnership (1065), S/C-corp (1120-S/1120), 706/709, e-filing — out of scope per Option A (see T1.2 business-returns flag).
- Long-tail state credits / PA EIT (~1,800 munis) / OH SDIT long tail / MD per-dependent / HSA last-month — only when a customer asks.

---

## Suggested execution order (highest leverage first — REORDERED 2026-06-11)

1. **T0.1** (yours — rotate creds; unblocks everything). Still the one red gate.
2. **T1.0 (a)–(f)** — the re-opened Tier-1 correctness backlog (wrong filed numbers in shipped code: TY2026 credits on expired law, §53/§38 limits, §461(l), NOL-AGI, K-1 earned income, KS/PA/CO/WV/HI/NM/MD state currency, MCTMT). Batch by subsystem; /code-review every batch.
3. **T1.0 (g)–(l)** — planning projection year-advance + CPA-tools optimizer fixes + forms/extraction/frontend display batch.
4. **T1.5** — accuracy deepening: golden-test pack + tax-table mode + the filing-status trait table (the anti-QSS-cluster refactor) + the law-watch pipeline; then the second-oracle expansion.
5. **T0.2 C1–C2** (+ the new audit security items) — consent ledger + PII; parallel-trackable.
6. **T5 G-3 + G-7** — proposal/ROI packager + tax-health report (pure packaging, fast revenue story) → **G-2** second-look analyzer (the design-partner demo) → **G-1** transcript monitor.
7. ~~**T2.3** — UX/UI 2.0 portable layer~~ — **DONE 2026-06-12** (D1–D8: tokens v2 + dark mode + ⌘K nav + 3-pane return workspace + provenance + diff grammar + engagement board + a11y; `docs/design/ux2.md`).
8. **T3/T4** — Haven + business gates (the CPA partner also unblocks T0.3-A6 + T2.1 sign-offs).
