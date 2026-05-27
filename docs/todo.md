# TaxFlow Assistant — Open TODO list

**Status as of 2026-05-27 (Phase H FULLY COMPLETE + H1 CATALOG CLOSED at v1.17 — 92 strategies).** This is the durable, git-tracked TODO list.
Read this in every new session before picking up work. The Claude task
tool inside any single session is ephemeral — only this file persists.

When you pick up a task: move it from this list into the in-session task
tracker, work it, commit, then remove it from here.

---

## Top-priority recommendation

Phase H is **FULLY COMPLETE** as of 2026-05-27 (sub-gaps included). All 12
H-items + H3 multi-year detector wiring + H5 4 new asset types + H6 Form
8606 Part III + H8 LLM-discovery rule-engine verification.

**H1 CATALOG CLOSED at v1.17 (97 strategies total — 92 G1 + 5 G4).** All
shipped + audited + tested (455 hand-calc'd planning unit tests passing,
plus 74 end-to-end scenarios). UI rendering v1.17.0 confirmed live;
api-server returns hits for new strategies on seed clients.

Recommended next-session sequencing:

1. **A1 — CPA outreach campaign** — packet is complete; biggest dollar
   gate is finding a paid design partner. Blocked on user availability.
2. **D15 — multi-tenancy auth** (2-3 wks). Required before charging
   real money. Wires actorUserId into audit_log (column exists, nullable).
3. **D18 — Stripe billing** (1-2 wks). Builds on D15. G5 Pro-tier feature
   gate already wired.
4. **C2 — top-10-state credits push** (2-3 wks). Engine coverage on
   state side; 10 high-volume states × 5 credits each.
5. **H1 incremental refinement** — H2-wiring of more heuristic detectors
   (most v1.12-v1.17 strategies are heuristic-only); convert key ones
   to engine-verified via runDetectorWhatIf.

---

## A. Strategic / business (top of mind)

| # | Item | Effort | Notes |
|---|---|---|---|
| A1 | **Live CPA outreach campaign** | 4-6 wks calendar | Packet ready in `docs/outreach/`. Send to 30-50 firms. Recruit 1-2 design partners. Blocked on user availability, not engineering. |
| A2 | **D15 — multi-tenancy auth** | 2-3 wks | Per-firm tables, RBAC, per-client visibility. The dominant remaining security gap. Required before paid customers. |
| A3 | **D18 — Stripe billing** | 1-2 wks | Needs D15 first. G5 Pro-tier feature gate already wired. |

---

## B. Tax Planning Strategy tool — Phase H ✅ FULLY COMPLETE + H1 CATALOG CLOSED

Honest current state: **A+**. Phase H is fully complete (12/12 items + ALL
sub-gaps) as of 2026-05-27. **H1 CATALOG CLOSED at v1.17 (97 strategies
total — 92 G1 + 5 G4).** Engine + UI + LLM all integrated. Foundation
primitives in place (H2/H3/H7/H12). All 97 strategies hand-calc audited
+ UI-verified live on prod-equivalent dev.

| # | Item | Effort | Why |
|---|---|---|---|
| H1 | **Catalog v1.17 — H1 CLOSED at 97 strategies (92 G1 + 5 G4)** | Maintenance only | **SHIPPED:** G1.1-G1.96 (92 G1 strategies across 17 versions) + G4.1-G4.5 (5 multi-year detectors). All 92 audited (`docs/planning-strategy-audit.md`) — IRC + TY2024/2025 limits verified. v1.12 (G1.67-G1.71 — universal/equity comp), v1.13 (G1.72-G1.76 — equity + small-biz credits), v1.14 (G1.77-G1.81 — RE + multi-state), v1.15 (G1.82-G1.86 — business/corporate), v1.16 (G1.87-G1.91 — retirement/§199A), v1.17 (G1.92-G1.96 — closeout). Future work: H2-wire heuristic detectors for engine-verified savings (most v1.12-v1.17 are heuristic-only). |
| H2 | **What-if engine — DONE 2026-05-27** | — | `whatIfEngine.ts` + POST /clients/{id}/what-if + 5 G1 detectors wired (G1.1 SEP / G1.5 AMT-ISO / G1.6 NIIT / G1.9 TLH / G1.10 FTC) + G1.4 Roth with "cost" semantics + frontend cards. 169 hand-calc assertions. |
| H3 | **Multi-year primitive + detector wiring — DONE 2026-05-27** | — | `multiYearEngine.ts` primitive + `runDetectorMultiYear` helper. **WIRED into G1.3 bunching (2-year), G1.8 DAF (3-year), G1.4 Roth (5-year with projected RMD).** Each hit carries `multiYear: { horizonYears, baselineYearTax[], scenarioYearTax[], yearByYearDelta[], totalSavings, growthAssumption, multiYearAssumptions[] }`. estSavings annualizes to multi-year totalSavings when baselineInputs available. 25 primitive + 28 wiring hand-calc assertions. |
| H4 | **State-residency comparison — DONE 2026-05-27** | — | POST /clients/:id/state-comparison runs the engine for each target state (default TX/FL/NV/WA/TN), re-sourcing W-2/1099 stateCode. New Planning card with sortable table + caveats. |
| H5 | **Asset balance tracking + 4 new types — DONE 2026-05-27** | — | `client_asset_balances` table with **18 asset types** (original 14 + new 4: espp_shares, iso_amt_credit_shares, restricted_stock_pre_83b, crypto). Per-account balance + cost basis + after-tax basis + nuaEligible flag. Full CRUD endpoints. "Assets" tab on ClientDetail. Engine reads via ClientFacts.assetBalances. |
| H6 | **Form 8606 Part I/II + Part III — DONE 2026-05-27** | — | `computeForm8606ProRata` (Part I §408(d)(2) pro-rata) + **`computeForm8606PartIII` (NEW: Roth distribution basis recovery per Treas. Reg. §1.408A-6 Q&A 8 — qualified-distribution shortcut, basis-first ordering, 10% §72(t) penalty)**. pdfkit-rendered PDF with both sections. New `roth_ira_distribution` adjustment type. GET /clients/:id/form-8606 + /pdf. 68 hand-calc assertions (28 Part I + 40 Part III). |
| H7 | **Cross-strategy interaction modeling — DONE 2026-05-27** | — | `evaluateCrossStrategyScenario` stacks all H2 savings mutations into one engine run; reports combinedDelta + sumOfIndividualSavings + interactionEffect. New CrossStrategyCard on Planning tab. Catches bracket-stacking erosion. |
| H8 | **LLM discovery + rule-engine verification — DONE 2026-05-27** | — | GET /clients/:id/planning-discovery + **`verifyAndDedupeCandidates` (NEW: cross-references IRC sections to catalog; tags candidates as `catalog-overlap` or `extra-strategy`; drops candidates duplicating already-detected hits)**. AiDiscoveryCard shows verification badge above rationale. 23 hand-calc'd verifier tests in new `tax-engine-discovery-tests.ts`. |
| H9 | **Client-context fields — DONE 2026-05-27** | — | 4 optional columns on clients (risk_tolerance, target_retirement_age, estate_plan_stage, planning_goals). ClientForm.tsx Planning context section. planningMemo.ts passes populated fields into the LLM prompt with concrete personalization rules per field. |
| H10 | **Charitable strategy depth — DONE 2026-05-27** | — | Shipped via H1 catalog v1.2 + v1.3 + v1.4: G1.11 QCD, G1.12 appreciated stock, G1.13 Augusta Rule, G1.19 CRT framework. Conservation easement (G1.20) with HIGH AUDIT RISK warning per Notice 2017-10. |
| H11 | **Peer benchmark — DONE 2026-05-27** | — | GET /clients/:id/peer-benchmark loads firm clients in ±$50k AGI band, computes mean/median/p25/p75 effective rate + client's percentile rank using linear-interp quantiles. PeerBenchmarkCard with cohort distribution + verdict. |
| H12 | **Confidence + assumption transparency — DONE 2026-05-27** | — | OpportunityHit gains `assumptions: string[]` (populated by ALL detectors) + `whatIfSensitivity: { low, mid, high }` for variable-amount strategies (±10% range, batched in one runWhatIfScenarios call) + `whatIf.mutations` exposes exact engine mutations for CPA audit ("Engine simulated: add deduction = $X"). |

---

## C. Coverage push (federal + state engine completeness)

**Shipped 2026-05-26 (C-batch v1):** C1 coverage matrix · C4 Form 1040-X amended returns · C5 §1031 like-kind exchange · C6 ESPP + ISO disqualifying disposition · C7 §163(j) + §461(l) limits · C8 Form 4868 extensions. See `docs/coverage-matrix.md`.

**Shipped 2026-05-27 (C-batch v2):**
- **C2 (partial)** — NY/CA/IL × 2-3 credits each via `calculateStateAdditionalCredits`: NY Empire State Child Credit (IT-213), NY Child & Dependent Care (IT-216), NY College Tuition (IT-272), CA Renter's Credit (Form 540 Line 46), CA Child & Dependent Care (Form 3506), IL Property Tax Credit (Schedule ICR), IL K-12 Education Expense Credit. 7 new credits across top-3 CPA-volume income-tax states.
- **C9** — 13 PA municipalities + Act 32 default. Covers ~60% of PA filers.
- **C10** — 15 OH school districts (mix earned-income + traditional base).
- **C11** — OPT-IN per-W-2-stateCode wage allocation via `part_year_use_w2_source` adjustment marker.

**Shipped 2026-05-27 PM (C-batch v3 — finishes C2/C9/C10/C11):**
- **C2 expanded to top-10 states** — Added MA (4 credits: Senior Circuit Breaker / Dependent Member of Household / Limited Income Credit / Lead Paint Removal), NJ (3: Property Tax Credit / Child & Dependent Care / Senior-Disabled Property Tax Deduction), OH (2: Joint Filing Credit / Senior Citizen Credit), PA (2: Special Tax Forgiveness Sched SP / Working Family Tax Credit), VA (2: Low-Income Tax Credit / Credit for Tax Paid to Other State), GA (3: Low-Income / Retirement Income Exclusion / Disabled Home Purchase), MI (2: Homestead PTC / Home Heating Credit). **24 new credits; 31 total across 10 states.** Hand-calc tests in `tax-engine-c2-state-credits-v2-tests.ts` (67 assertions).
- **C9 PA bulk** — Loaded ~175 PA municipalities via new `paEitRates.ts` module + `scripts/data/pa-eit-rates.csv`. New `lookupPaLocalEit` function. Falls back to inline LOCAL_TAX_DATA top-13 as fast-path. Locality codes auto-listed in `localityCodesForState("PA")`. Hand-calc tests in `tax-engine-c9-c10-bulk-tests.ts` (35 assertions).
- **C10 OH SDIT bulk** — Loaded ~226 OH school districts via new `ohSchoolDistricts.ts` module + CSV. Supports both `earned_income` and `traditional` bases. New `oh_traditional` base type in calculator. New `oh_sdit_traditional_base` adjustment for CPA-supplied exact value (else engine approximates as federalAgi − OH std ded).
- **C11 deeper** — Per-K-1 + per-rental + per-intangible sourcing. New `sourceState` field on `ScheduleK1Fact` and `RentalPropertyFact`. New `part_year_use_full_source_allocation` adjustment marker (supersedes `part_year_use_w2_source`). When enabled, K-1 + rental net income flows to source state; intangibles still pro-rate to resident state by days (standard residency rule). Hand-calc tests in `tax-engine-c11-deeper-sourcing-tests.ts` (20 assertions).

Remaining open:

| # | Item | Effort | Notes |
|---|---|---|---|
| C3 | **CPA design-partner side-by-side validation** (Option A) | 4-8 wks calendar | NOT engineering — requires CPA partner. Blocked on user availability. |
| C2 next | **Beyond-top-10 state credits** | 2-4 wks | Top-10 states shipped. Remaining minor-volume credits (NC dependent care, AZ Family Tax Credit, OK Sales Tax Relief, etc.) — defer until customer asks. |
| C9 next | **PA EIT — remaining ~1,800 minor municipalities** | 3-5 days | Top ~175 covered (~85% of PA filers). Remaining requires DCED registry full dump; defer until customer asks. CPA fallback: Act 32 default 1.0%. |
| C10 next | **OH SDIT — remaining ~390 districts** | 1-2 days | Top ~226 covered. Remaining are very small rural districts; defer until customer asks. CPA fallback: any SD with rate 0% is auto-handled. |

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
