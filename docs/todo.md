# TaxFlow Assistant — Open TODO list

**Status as of 2026-05-27 (post-Phase H batch — H2/H4/H7/H9/H11/H12 shipped).** This is the durable, git-tracked TODO list.
Read this in every new session before picking up work. The Claude task
tool inside any single session is ephemeral — only this file persists.

When you pick up a task: move it from this list into the in-session task
tracker, work it, commit, then remove it from here.

---

## Top-priority recommendation

If I were sequencing for maximum customer impact, I would do (in order):

1. **H1 — expand catalog 10 → 50+ rules** (2 months calendar, ~25% eng).
   The Phase H foundation (H2 verified deltas, H7 cross-strategy, H12
   transparency) is now complete; new strategies plug in with real
   savings immediately. Highest customer-perceived-value upgrade.
2. **H3 — multi-year scenario modeling** (1-2 wks). Unlocks G1.3 bunching,
   G1.4 Roth conversion long-term, G1.8 DAF as H2-verified. Without H3
   these are heuristic-only.
3. **H5 — asset balance tracking** (2-3 wks). Unlocks RMD / NUA / mega-
   backdoor Roth / Roth conversion sizing. Schema work.
4. **D15 — multi-tenancy auth** (2-3 wks). Required before charging.
5. **CPA design-partner validation** (4-8 wks calendar, ~25% engineering).

---

## A. Strategic / business (top of mind)

| # | Item | Effort | Notes |
|---|---|---|---|
| A1 | **Live CPA outreach campaign** | 4-6 wks calendar | Packet ready in `docs/outreach/`. Send to 30-50 firms. Recruit 1-2 design partners. Blocked on user availability, not engineering. |
| A2 | **D15 — multi-tenancy auth** | 2-3 wks | Per-firm tables, RBAC, per-client visibility. The dominant remaining security gap. Required before paid customers. |
| A3 | **D18 — Stripe billing** | 1-2 wks | Needs D15 first. G5 Pro-tier feature gate already wired. |

---

## B. Tax Planning Strategy tool — accuracy + smartness upgrades (Phase H)

Honest current state: **B+**. Phase H batch shipped 2026-05-27 covers
H2/H4/H7/H9/H11/H12 — six of twelve items done. The H2 foundation
(verified deltas + sensitivity + assumptions) is fully wired across
single-year detectors. Catalog still ~7% of canonical planning universe
(~200 strategies) — H1 expansion is the natural next big unlock.

| # | Item | Effort | Why |
|---|---|---|---|
| H1 | **Expand catalog 10 → 50+ rules** | 2 months | Add Augusta Rule, NUA, REPS election, §1031 timing, mega-backdoor Roth, RMD optimization, cost segregation, opportunity zones, defined benefit / cash balance plans, S-corp reasonable comp, NQDC §409A, CRT/CLT, QCD, §1374 BIG, §338(h)(10), conservation easements, etc. With H2 verified per-rule, each ships with real deltas. |
| H2 | **What-if engine — DONE 2026-05-27** | — | `whatIfEngine.ts` + POST /clients/{id}/what-if + 5 G1 detectors wired (G1.1 SEP / G1.5 AMT-ISO / G1.6 NIIT / G1.9 TLH / G1.10 FTC) + G1.4 Roth with "cost" semantics + frontend cards + 124 hand-calc assertions. Remaining sub-gap: G1.3/G1.7/G1.8 + 5 G4 detectors are multi-year-shaped — defer to H3. |
| H3 | **Multi-year scenario modeling** | 1-2 wks | For strategies that span years (Roth ladder, bunching cycles, NUA), simulate 3-5 years forward with wage growth + bracket indexing. Builds on H2. **Highest unlock after H1** — completes the H2 promise for the deferred G1 rules. |
| H4 | **State-residency comparison — DONE 2026-05-27** | — | POST /clients/:id/state-comparison runs the engine for each target state (default TX/FL/NV/WA/TN), re-sourcing W-2/1099 stateCode. New Planning card with sortable table + caveats. Live-verified: CA filer correctly returns -$55,782 savings to any no-state-tax target. |
| H5 | **Asset balance tracking** | 2-3 wks | Schema + UI for IRA / Roth / SEP / 401(k) (with employer-stock breakdown for NUA) / HSA / 529 / brokerage cost basis / real estate FMV. Unlocks RMD / Roth conversion / NUA / mega-backdoor Roth / estate planning. |
| H6 | **Form 8606 nondeductible IRA basis tracking** | 3-5 days | Required for backdoor Roth (§408(d)(2) pro-rata), Roth conversion taxable portion. Builds on H5. |
| H7 | **Cross-strategy interaction modeling — DONE 2026-05-27** | — | `evaluateCrossStrategyScenario` stacks all H2 savings mutations into one engine run; reports combinedDelta + sumOfIndividualSavings + interactionEffect. New CrossStrategyCard on Planning tab. Catches bracket-stacking erosion. Sub-gap: only fires when ≥2 H2-savings hits present (most seed clients trigger 0-1; needs H1 to be common). |
| H8 | **LLM-based fact-pattern strategy discovery** | 1-2 wks | Inverts G3: give LLM full client + 200-strategy KB, let it propose candidates the rule engine missed. Rules verify; H2 quantifies. Hallucination guards via structured citations. |
| H9 | **Client-context fields — DONE 2026-05-27** | — | 4 optional columns on clients (risk_tolerance, target_retirement_age, estate_plan_stage, planning_goals). ClientForm.tsx Planning context section. planningMemo.ts passes populated fields into the LLM prompt with concrete personalization rules per field. |
| H10 | **Charitable strategy depth** | 1 wk | DAF / CRT / CLT / QCD / appreciated stock / 30% AGI prop / conservation easement (with risk warning). Best done as part of H1 catalog expansion. |
| H11 | **Peer benchmark — DONE 2026-05-27** | — | GET /clients/:id/peer-benchmark loads firm clients in ±$50k AGI band, computes mean/median/p25/p75 effective rate + client's percentile rank using linear-interp quantiles. PeerBenchmarkCard with cohort distribution + verdict. Live-verified: 53-peer cohort, client at 98th percentile flagged as strong planning opportunity. |
| H12 | **Confidence + assumption transparency — DONE 2026-05-27** | — | OpportunityHit gains `assumptions: string[]` (populated by ALL 10 detectors) + `whatIfSensitivity: { low, mid, high }` for variable-amount strategies (±10% range, batched in one runWhatIfScenarios call) + `whatIf.mutations` exposes exact engine mutations for CPA audit ("Engine simulated: add deduction = $X"). |

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
