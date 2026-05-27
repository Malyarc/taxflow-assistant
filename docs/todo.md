# TaxFlow Assistant — Open TODO list

**Status as of 2026-05-26 (post-C-batch).** This is the durable, git-tracked TODO list.
Read this in every new session before picking up work. The Claude task
tool inside any single session is ephemeral — only this file persists.

When you pick up a task: move it from this list into the in-session task
tracker, work it, commit, then remove it from here.

---

## Top-priority recommendation

If I were sequencing for maximum customer impact, I would do (in order):

1. **H2 — what-if engine** (1-2 wks). Single biggest planning-accuracy
   unlock. Every existing rule becomes credible immediately. Foundation
   for H3 / H7 / H10 / H12.
2. **Coverage matrix doc** (1 day). One-day investment that gives you
   the data to prioritize all subsequent state work.
3. **H5 — asset balance tracking** (2-3 wks). Unlocks the next tier of
   planning strategies (RMD, NUA, Roth conversion sizing).
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

Honest current state: B-. 10 G1 rules + 5 G4 detectors ≈ 7% of the
canonical planning universe (~200 strategies). Savings are heuristic
estimates, not actual engine re-runs.

| # | Item | Effort | Why |
|---|---|---|---|
| H1 | **Expand catalog 10 → 50+ rules** | 2 months | Add Augusta Rule, NUA, REPS election, §1031 timing, mega-backdoor Roth, RMD optimization, cost segregation, opportunity zones, defined benefit / cash balance plans, S-corp reasonable comp, NQDC §409A, CRT/CLT, QCD, §1374 BIG, §338(h)(10), conservation easements, etc. |
| H2 | **What-if engine** | 1-2 wks | **HIGHEST-IMPACT.** Run `computeTaxReturnPure` twice (current + with strategy) → report actual federal+state tax delta. No more heuristic ranges. Foundation for all other H tasks. |
| H3 | **Multi-year scenario modeling** | 1-2 wks | For strategies that span years (Roth ladder, bunching cycles, NUA), simulate 3-5 years forward with wage growth + bracket indexing. Builds on H2. |
| H4 | **State-residency change analysis** | 1-2 wks | "Stay in CA: $45k state tax. Move to TX: $0. Multi-year delta with caveats." Huge for HNW CA/NY/NJ clients. |
| H5 | **Asset balance tracking** | 2-3 wks | Schema + UI for IRA / Roth / SEP / 401(k) (with employer-stock breakdown for NUA) / HSA / 529 / brokerage cost basis / real estate FMV. Unlocks RMD / Roth conversion / NUA / mega-backdoor Roth / estate planning. |
| H6 | **Form 8606 nondeductible IRA basis tracking** | 3-5 days | Required for backdoor Roth (§408(d)(2) pro-rata), Roth conversion taxable portion. Builds on H5. |
| H7 | **Cross-strategy interaction modeling** | 1-2 wks | SEP reduces QBI base. Charitable bunching affects AMT. Roth conversion hits ACA cliff. Simulate cascades via H2. |
| H8 | **LLM-based fact-pattern strategy discovery** | 1-2 wks | Inverts G3: give LLM full client + 200-strategy KB, let it propose candidates the rule engine missed. Rules verify; H2 quantifies. Hallucination guards via structured citations. |
| H9 | **Client-context fields** | 3-5 days | risk tolerance / retirement age / estate plan stage / specific goals → personalizes all planning recommendations. |
| H10 | **Charitable strategy depth** | 1 wk | DAF / CRT / CLT / QCD / appreciated stock / 30% AGI prop / conservation easement (with risk warning). |
| H11 | **Peer / benchmark comparison** | 1 wk | "Your effective rate is X%; $Y-AGI peer average is Z%" — in-firm cohort or IRS SOI Table 1.4. |
| H12 | **Confidence + assumption transparency** | 3-5 days | Each rec shows confidence + assumption list + sensitivity. CPAs can audit the math. Builds on H2. |

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
