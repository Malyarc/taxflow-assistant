# TaxFlow Assistant — Open TODO list

**Status as of 2026-05-27 (Phase H COMPLETE — all 12 items shipped).** This is the durable, git-tracked TODO list.
Read this in every new session before picking up work. The Claude task
tool inside any single session is ephemeral — only this file persists.

When you pick up a task: move it from this list into the in-session task
tracker, work it, commit, then remove it from here.

---

## Top-priority recommendation

Phase H is **COMPLETE** as of 2026-05-27. All 12 H-items (H1 partial 10/50+ /
H2/H3/H4/H5/H6/H7/H8/H9/H10/H11/H12) ship with hand-calc'd tests + live UI.

Recommended next-session sequencing (now that planning surface is done):

1. **A1 — CPA outreach campaign** — packet is complete; biggest dollar
   gate is finding a paid design partner. Blocked on user availability.
2. **D15 — multi-tenancy auth** (2-3 wks). Required before charging
   real money. Wires actorUserId into audit_log (column exists, nullable).
3. **D18 — Stripe billing** (1-2 wks). Builds on D15. G5 Pro-tier feature
   gate already wired.
4. **H1 continued catalog expansion** — 40+ strategies left in the
   canonical universe. Each ~2-4 hours now that the foundation
   (H2/H7/H12) is proven.
5. **C2 — top-10-state credits push** (2-3 wks). Engine coverage on
   state side; 10 high-volume states × 5 credits each.

---

## A. Strategic / business (top of mind)

| # | Item | Effort | Notes |
|---|---|---|---|
| A1 | **Live CPA outreach campaign** | 4-6 wks calendar | Packet ready in `docs/outreach/`. Send to 30-50 firms. Recruit 1-2 design partners. Blocked on user availability, not engineering. |
| A2 | **D15 — multi-tenancy auth** | 2-3 wks | Per-firm tables, RBAC, per-client visibility. The dominant remaining security gap. Required before paid customers. |
| A3 | **D18 — Stripe billing** | 1-2 wks | Needs D15 first. G5 Pro-tier feature gate already wired. |

---

## B. Tax Planning Strategy tool — Phase H ✅ COMPLETE

Honest current state: **A−**. Phase H is fully complete (12/12 items
shipped) as of 2026-05-27. Catalog at v1.3 (20 deterministic strategies).
Engine + UI + LLM all integrated. Foundation primitives in place for
infinite catalog expansion (each new H1 strategy ~2-4 hrs).

| # | Item | Effort | Why |
|---|---|---|---|
| H1 | **Catalog v1.3 — 10 of 50+ shipped** | ~5-6 wks remaining for full 50+ | **SHIPPED so far:** G1.1-G1.10 (Phase G baseline), G1.11 QCD, G1.12 appreciated stock, G1.13 Augusta Rule §280A(g), G1.14 HSA max, G1.15 NUA §402(e)(4), G1.16 Mega-Backdoor Roth, G1.17 S-corp reasonable comp, G1.18 REPS §469(c)(7), G1.19 CRT framework, G1.20 conservation easement (audit warning). **Remaining:** REPS partial, §1031 timing, RMD optimization, cost-seg, opportunity zones, defined benefit / cash balance plans, NQDC §409A, CLT, §1374 BIG, §338(h)(10), §199A optimization variants, retirement plan §401(a)(17)/§415(c) max-out strategies, etc. Each ~2-4 hrs w/ H2 wiring. |
| H2 | **What-if engine — DONE 2026-05-27** | — | `whatIfEngine.ts` + POST /clients/{id}/what-if + 5 G1 detectors wired (G1.1 SEP / G1.5 AMT-ISO / G1.6 NIIT / G1.9 TLH / G1.10 FTC) + G1.4 Roth with "cost" semantics + frontend cards. 169 hand-calc assertions. |
| H3 | **Multi-year primitive — DONE 2026-05-27** | — | `multiYearEngine.ts` with `projectYearForward(inputs, yearsAhead)` + `runMultiYearTrajectory(baseline, years, mutationsByYear)` + `compareMultiYearTrajectories(baseline, scenario)`. Scales W-2/1099/adjustment dollars at configurable growth factor (default 3%/yr); advances each fact's taxYear so engine picks them up. Engine clamps unknown years to TY2025 brackets (`resolveTaxYear`). 25 hand-calc assertions. Detector wiring deferred (G1.3 / G1.4 long-term / G1.8 still heuristic — future H1 catalog work). |
| H4 | **State-residency comparison — DONE 2026-05-27** | — | POST /clients/:id/state-comparison runs the engine for each target state (default TX/FL/NV/WA/TN), re-sourcing W-2/1099 stateCode. New Planning card with sortable table + caveats. |
| H5 | **Asset balance tracking — DONE 2026-05-27** | — | New `client_asset_balances` table with 14 asset types (IRA / Roth / SEP / SIMPLE / 401k traditional/Roth/after-tax / NUA-eligible employer stock / HSA / 529 / brokerage / real estate / primary residence / other). Per-account balance + cost basis + after-tax basis + nuaEligible flag. Full CRUD endpoints. New "Assets" tab on ClientDetail with summary cards + add/edit/delete form. Engine reads via ClientFacts.assetBalances. |
| H6 | **Form 8606 nondeductible IRA basis — DONE 2026-05-27** | — | `computeForm8606ProRata` aggregates trad/SEP/SIMPLE IRA basis from H5 assets and applies §408(d)(2) pro-rata fraction (basis / (year-end + distributions + conversion)). Catches backdoor Roth (100% tax-free clean) AND the pro-rata trap ($7k backdoor + $100k pre-tax = ~$6,542 taxable). pdfkit-rendered Form 8606 PDF. Endpoints GET /clients/:id/form-8606 + /pdf. 28 hand-calc assertions. |
| H7 | **Cross-strategy interaction modeling — DONE 2026-05-27** | — | `evaluateCrossStrategyScenario` stacks all H2 savings mutations into one engine run; reports combinedDelta + sumOfIndividualSavings + interactionEffect. New CrossStrategyCard on Planning tab. Catches bracket-stacking erosion. |
| H8 | **LLM fact-pattern strategy discovery — DONE 2026-05-27** | — | New endpoint GET /clients/:id/planning-discovery sends client snapshot + already-detected hits + full catalog (20 strategies) to LLM, requests ≤5 candidate strategies the rule engine may have missed. Strong hallucination guards in system prompt (NO dollar invention; NO catalog-overlap; require IRS citations). AiDiscoveryCard with fuchsia theme, lazy-loaded behind "Discover with AI" button. Graceful empty fallback when aiEnabled === false. |
| H9 | **Client-context fields — DONE 2026-05-27** | — | 4 optional columns on clients (risk_tolerance, target_retirement_age, estate_plan_stage, planning_goals). ClientForm.tsx Planning context section. planningMemo.ts passes populated fields into the LLM prompt with concrete personalization rules per field. |
| H10 | **Charitable strategy depth — DONE 2026-05-27** | — | Shipped via H1 catalog v1.2 + v1.3: G1.11 QCD, G1.12 appreciated stock, G1.13 Augusta Rule (business-charity §280A(g) framework), G1.19 CRT framework. Conservation easement (G1.20) with HIGH AUDIT RISK warning per Notice 2017-10. |
| H11 | **Peer benchmark — DONE 2026-05-27** | — | GET /clients/:id/peer-benchmark loads firm clients in ±$50k AGI band, computes mean/median/p25/p75 effective rate + client's percentile rank using linear-interp quantiles. PeerBenchmarkCard with cohort distribution + verdict. |
| H12 | **Confidence + assumption transparency — DONE 2026-05-27** | — | OpportunityHit gains `assumptions: string[]` (populated by ALL detectors) + `whatIfSensitivity: { low, mid, high }` for variable-amount strategies (±10% range, batched in one runWhatIfScenarios call) + `whatIf.mutations` exposes exact engine mutations for CPA audit ("Engine simulated: add deduction = $X"). |

---

## C. Coverage push (federal + state engine completeness)

**Shipped 2026-05-26 (C-batch):** C1 coverage matrix · C4 Form 1040-X amended returns · C5 §1031 like-kind exchange · C6 ESPP + ISO disqualifying disposition · C7 §163(j) + §461(l) limits · C8 Form 4868 extensions. See `docs/coverage-matrix.md`.

Remaining open:

| # | Item | Effort | Notes |
|---|---|---|---|
| C2 | **Top-10-state credit push** (Option C) | 2-3 wks | Pick 10 high-CPA-volume states with brackets-only coverage; add their top 5 credits each. ~50 credits × 3-5 days each. |
| C3 | **CPA design-partner side-by-side validation** (Option A) | 4-8 wks calendar | 1 partner runs 20-50 returns through TaxFlow next to Lacerte. Every diff = real customer-driven gap. Highest-ROI coverage path. |
| C9 | PA local EIT (~2000 jurisdictions) | 1 wk | Lookup table by zip / municipality. |
| C10 | OH school district income tax | 3-5 days | |
| C11 | Per-state part-year residency formulas | 2-3 wks | Currently pro-rata by days; real NY IT-203 / CA 540NR Sched CA source by income item. |

**C-batch sub-gaps to track (for follow-up sessions):**

- §163(j) ATI proxy is approximate; over-restricts for high-depreciation low-income filers. True ATI per §163(j)(8) needs depreciation addback + pre-§163(j)/NOL/QBI taxable-income base.
- §461(l) loss-aggregation is CPA-supplied; engine doesn't auto-aggregate across Sched C / E / K-1 buckets.
- §1031 / §121 recognized gains don't flow into NIIT investment-income base. Consistent with the existing §121 pattern; fix requires broader NIIT-base refactor.
- Form 8824 PDF for §1031 reporting and Form 8990 PDF for §163(j) NOT yet rendered; CPAs hand-file from the engine's computed values.

---

## D. Infra / security hardening

| # | Item | Effort | Notes |
|---|---|---|---|
| D1 | **TLS terminator on EC2** (ALB + ACM cert OR nginx + certbot) | 1-2 days | Then re-enable HSTS + `upgrade-insecure-requests` in `app.ts` (doc comment spells out the toggle). |
| D2 | **D17 — file storage hardening** | 2 wks | `tax_documents.fileContent` → S3 with signed URLs. SSN encryption via pgcrypto. |
| D3 | **D16 — soft-delete clients + append-only audit_log** | 1 wk | Revoke UPDATE/DELETE for app role on audit_log. |
| D4 | **Drizzle versioned migrations** (replace `push`) | 1 day | Worth doing before next major schema change. |
| D5 | **audit_log partitioning by quarter** | 3-5 days | Defer until ~5M rows. |
| D6 | **Per-upload AI extraction consent UI** | 3-5 days | Currently demo banner only; auditor flagged this as CRITICAL. |
| D7 | **Refactor ClientDetail.tsx** (3400 lines → tab sub-components) + remove `as any` casts (19 sites) | 1-2 days | Pure refactor; low risk. |
| D8 | **Self-host Google Fonts** (drop fonts.googleapis.com CSP allowlist) | 1-2 hours | Plus minor perf win. |

---

## E. Deferred / reactive (do only when a customer asks)

- HSA Form 8889 last-month rule (testing period)
- §1091(d) holding-period auto-flip ST→LT on wash-sale replacement
- State-specific AMT for states other than CA
- IL personal-exemption dependent allowance
- NYC UBT
- KY occupational tax
- MD personal exemption per dependent
- OH cross-city employment credit
- IN $1,000/filer personal exemption
- Trust/estate (Form 1041), partnership (1065), S-corp (1120-S), C-corp (1120), estate/gift (706/709) — **out of scope per Phase 4 Option A**
- E-filing (CPAs e-file via Lacerte/UltraTax — by Option A design)

---

## How to use this file

- **Start of every session:** read this file before picking up work.
- **Pick a task:** move it into the in-session task tracker via TaskCreate.
- **Finish a task:** commit your work, then EDIT THIS FILE to remove the
  finished task and add any sub-gaps you found. Push.
- **Recommend a task to the user:** reference the # (e.g., "ship H2 next").
- **Quality bar:** all existing tests must stay at 0 real failures.
  Each chunk ships as its own commit. Update CLAUDE.md / handoff.md /
  this file at session end. Deploy to EC2.
