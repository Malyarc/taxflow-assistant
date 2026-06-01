# TaxFlow Assistant — Open TODO list

**Status as of 2026-05-28 (Brookhaven UI/UX revamp shipped; Phase H + C-batch + C3 follow-ups all complete).** This is the durable, git-tracked TODO list.
Read this in every new session before picking up work. The Claude task
tool inside any single session is ephemeral — only this file persists.

When you pick up a task: move it from this list into the in-session task
tracker, work it, commit, then remove it from here.

---

## ⚡ CURRENT FOCUS (2026-05-30): refine tax calc + tax planning

**D15 (auth + multi-tenancy) is POSTPONED** — this app will be fused into the
larger **Haven** app, which brings its own auth/tenancy, so we won't build it
twice. The focus is the **portable engine + planning feature**
(`computeTaxReturnPure` is already Haven-portable — keep it pure). The live EC2
box stays a **demo** (no auth/TLS) — do NOT put real client PII on it until the
Haven fusion lands. **2026-06-01: 11 refinement fixes shipped + verified live**
(FORM-03, FED-05, PLAN-04, PLAN-06, 16-scenario battery, H2-wire G1.92/G1.96,
§461(l) Sch-C loss flow, STL-05 MD EITC, K-1 §199A wage/UBIA limit, AMT line 2e
state-refund recapture, wash-sale §1091(d) holding-period tack — see
`.claude/handoff.md`); **38 no-API suites / 3,099 assertions green**, clean typecheck.

### Tax CALCULATOR refinement backlog (correctness-first)

**SHIPPED 2026-06-01** (commits on main, deployed to EC2 + verified live):
- ✅ **FORM-03** — Form 1040-X Lines 16→20 rebuilt as the IRS settlement chain;
  Line 20 − Line 19 now foots to `netFederalRefundChange` on every swap. +28 tests.
- ✅ **FED-05** — blind additional std deduction wired (new `clients.taxpayer_blind`
  / `spouse_blind` columns + ClientForm checkboxes + ClientFacts + engine). Prod
  ALTER applied. +10 hand-calc'd tests.

Confirmed-open from the 2026-05-29 audit:
- ✅ **STL-05 — SHIPPED 2026-06-01.** Maryland two-component EITC: net benefit =
  max(45% × fedEITC refundable floor, min(50% × fedEITC, MD tax) nonrefundable).
  No longer under-credits the high-MD-tax zone. +9 tests. (Childless-worker ~100%
  expansion still not modeled — documented.)

Documented engine sub-gaps (ordered by how often they bite a real return):
- ✅ **§461(l) Sch-C loss flow — SHIPPED 2026-06-01.** Signed `scheduleCNetSigned`
  now flows the Sch C loss to AGI, capped by the §461(l) addback ($305k/$610k).
  netSeIncome stays floored for SE-tax/QBI/local/earned-income. +12 tests.
  (Remaining: engine doesn't auto-generate the NOL when the loss exceeds total
  income — AGI floors at 0, CPA carries the excess via nol_carryforward; and the
  §163(j) ATI proxy still uses the floored value — documented approximations.)
- **K-1 depth** — ✅ **§199A wage/UBIA limit SHIPPED 2026-06-01** (max(50% wages,
  25% wages + 2.5% UBIA), phased over the band, when the K-1 supplies positive
  section199aW2Wages/Ubia; +5 tests). Remaining: true per-business SSTB depth;
  K-1 basis/at-risk limits not enforced; guaranteed payments (Box 4) flow via the
  `additional_income` adjustment (income + QBI-excluded) + Box 14A (SE) — a
  dedicated Box 4 field is a future UX refinement.
- **§163(j)** — ATI proxy ≈ taxable income before §163(j)/NOL/QBI; for TY2024+
  (post-2021) this needs NO depreciation addback per §163(j)(8), so the proxy is
  close. Remaining: $30M small-biz exemption not auto-detected; Form 8990 Sec
  II/III (pass-through) are zero-placeholders. (Low priority.)
- **AMT prefs** — ✅ **line 2e state-refund recapture SHIPPED 2026-06-01** (+6
  tests; AMTI floor moved from prefs to AMTI). Remaining: line 2i MACRS-vs-ADS
  depreciation diff + AMT NOL (each needs a separate AMT computation).
- **Part-year residency** — per-income-item sourcing partially shipped (C11: K-1/
  rental/W-2 stateCode). Remaining: exact NY IT-203 / CA 540NR Sched CA schedules,
  mid-year resident credit, part-year locality/AMT, pro-rated std ded.
- **Wash sales** — ✅ **§1091(d) basis add + §1223(3) holding-period tack (ST→LT
  formBox flip) SHIPPED 2026-06-01** (+5 tests). Remaining: partial wash (engine
  fully disallows the loss); cross-account wash only when both brokers' txns entered.
- **State retirement exemptions** — HI / NJ / NY partial exemptions (PA/IL/MS done).
- **Local** — NYC UBT, KY occupational tax, OH cross-city employment credit, IN/MD per-dependent.

Validation:
- ✅ **16-scenario real-world battery** — SHIPPED 2026-06-01 as
  `tax-engine-16-scenario-battery-tests.ts` (42 hand-calc'd assertions, N1–N16).
  Gives the missing PIPELINE coverage for FED-03 (NIIT FEIE add-back), FED-04
  (QBI/NOL ordering), FED-06 (EITC §32(i)) + STL-02 (Philly EIT incl. SE) + MA
  surtax + stacked pass-through / NIIT / SE / QSBS / SS-taxability returns.

### Tax PLANNING refinement backlog

**SHIPPED 2026-06-01**:
- ✅ **PLAN-04** — kiddie-tax + Coverdell-ESA now gate on a shared
  `countEligibleChildren` helper (dependentsUnder17 + otherDependents), catching
  17-year-olds + 18–23 students. +4 tests.
- ✅ **PLAN-06** — QCD detector fires at year-end age ≥70 (was ≥71) with a 70½
  distribution-date-confirm caveat for the borderline age-70 case. +4 tests.
- ✅ **H2-wire (partial)** — wired the two cleanly-wireable heuristic detectors in
  the G1.46–G1.96 range to engine-verified `runDetectorWhatIf` deltas: **G1.92
  Solo 401(k)** (employee deferral as deduction; whatIf $3,760 vs heuristic $5,060
  — §199A QBI cap dampens it) + **G1.96 §132(f) transit** ($907.20). +9 tests.

Confirmed-open from the audit:
- **PLAN-08** — catalog `validUntil` expiry gate is documented but never enforced;
  TY-specific strategies keep firing with stale thresholds past their date (latent → 2027).

Biggest credibility lift:
- **H2-wire — REMAINING IS MOSTLY QUALITATIVE (survey done 2026-06-01).** Of the
  ~46 heuristic detectors in G1.46–G1.96, only G1.92 + G1.96 were cleanly wireable
  (shipped above). The other ~44 are NOT a single current-year engine mutation and
  should stay heuristic: business credits the individual engine doesn't model
  (§41 R&D, §45S FMLA, §51 WOTC, §47 historic rehab, §44 disabled access), entity/
  S-corp elections (§351, §338(h)(10), §1374 BIG, §1377, §263A method), trust
  vehicles (CLT, PIF, conservation easement), multi-year structures (§453 installment,
  §72(t) SEPP, §174 amortization, §529→Roth), after-tax contributions with no
  current deduction (custodial Roth G1.55, Coverdell G1.59 — value is long-term
  growth), and soft guidance (residency change, hobby loss, wash-sale avoidance, lot
  selection, year-end timing). **Don't re-attempt these without first modeling the
  underlying credit/election in the engine.** A `credit` adjustment exists but is
  treated as REFUNDABLE — wiring a nonrefundable credit (e.g. G1.65 adoption) through
  it would over-state for low-tax filers; needs a nonrefundable-credit mutation first.
- **Multi-year-wire more detectors (H3)** — only G1.3 / G1.8 / G1.4 are multi-year-aware;
  extend to Roth conversion ladders, RMD planning, installment sales, carryforward depletion.
- **Catalog freshness** — refresh TY2025/2026 limits + any OBBBA-driven changes across
  the 97 strategies (`docs/planning-strategy-audit.md` is the per-strategy source of truth).

---

## Brookhaven UI/UX revamp SHIPPED (2026-05-28) — frontend-only

Full visual modernization to the **Brookhaven brand** (Trusted Blue
`#231F55` / Brookhaven Blue `#41B9EA` / Yellow `#F0CA17` / Powder Blue
`#8ED4F0`) + the two open UI follow-ups. Engine/api/schema untouched; all
35 no-API suites still green. See `.claude/handoff.md` for the full list.

| Item | Status |
|---|---|
| Brookhaven design tokens (light+dark) in `src/index.css` + brand gradient/pattern utilities | ✅ |
| Branded chrome — Trusted Blue sidebar + `BrandMark` SVG + lucide nav + gold demo banner + favicon | ✅ |
| **Cramped ClientDetail tab bar → scrollable icon-pill bar** (was `grid-cols-11`, tabs collided) | ✅ |
| Dashboard + ClientList modernized (icon stat cards, branded widgets) | ✅ |
| Hardcoded-color sweep — 172 classes → brand/semantic tokens; 0 residual off-brand | ✅ |
| **Form 8824 / 8990 PDF download buttons** in Tax Calculator (§1031 / §163(j) cards) | ✅ (UI follow-up) |
| **SSTB toggle** — `qbi_sstb_flag` surfaced as a §199A card switch in Adjustments | ✅ (UI follow-up) |
| Mobile responsive — sidebar `hidden lg:flex` + compact mobile top bar | ✅ |
| Print CSS fix (removed invalid `:contains()`; `print:hidden` banner) | ✅ |

Remaining optional UI polish (deferred): dark-mode toggle (tokens exist,
no UI toggle), code-split the ~1 MB JS bundle, D7 ClientDetail.tsx
per-tab component extraction (~4,960 lines).

---

## C3 validation findings + 8 follow-ups SHIPPED (2026-05-27 PM)

The shadow-CPA validation (Marge Reynolds, CPA) flagged 5 engine findings + recommended 3 additional engine improvements. **ALL 8 SHIPPED in the same session.** Resulting engine state: zero open Tier-1 / Tier-2 findings from the C3 validation packet.

| Finding | Tier | Status | Verification |
|---|---|---|---|
| ~~§199A QBI not auto-detected from Sch C net or K-1 Box 1 active~~ | 1 (was blocker) | ✅ **SHIPPED 2026-05-27 PM** | Cases 4 + 6 + I2 + I4 + I8 + D3 + Pure-Sch-C-test all recalibrated. QBI auto-default fires from `seIncomeFromAdj > 0` AND from active K-1 Box 1 unless overridden by explicit `qbi_income` adjustment. SSTB phase-in (§199A(d)(3)) respected via `qbi_sstb_flag` adjustment. |
| ~~CA personal exemption credit ($144/$288 + $446/dep)~~ | 2 | ✅ **SHIPPED 2026-05-27 PM** | Added as nonrefundable entry to `calculateStateAdditionalCredits` CA block. Phase-out per Cal. RTC §17054.1 at AGI > $244,857 single / $489,719 MFJ. Cases 3 / 6 / 8 deltas: $144/$288/$734 respectively. |
| ~~IL dependent exemption ($2,775/dep)~~ | 3 | ✅ **SHIPPED 2026-05-27 PM** | Added `personalExemptionPerDependent` field to StateInfo + IL row. Wired via `options.dependentCount` in `calculateStateTax`. Case 9 / I3 delta: $275 over-tax now removed. |
| ~~NJ personal exemption ($1,000 filer + $1,500/dep)~~ | 3 | ✅ **SHIPPED 2026-05-27 PM** | NJ row gains both `personalExemption` and `personalExemptionPerDependent`. Case 10 delta: $64 over-tax now removed. |
| ~~Expand validation packet to 25 cases~~ | 3 | ✅ **SHIPPED 2026-05-27 PM** | 15 new cases generated by `scripts/src/build-validation-packet-v2.ts`: Form 8606 backdoor Roth, §1031, §121 home sale, §1202 QSBS, kiddie tax Form 8615, FEIE, ACA PTC, HSA, Roth conversion, NOL cf, cap loss cf, multi-state NR, part-year residency, §163(j), §461(l). |
| ~~§163(j) ATI proxy approximate~~ | — | ✅ **SHIPPED 2026-05-27 PM** | Refined ATI per IRC §163(j)(8) — now subtracts `max(std ded, itemized approximation)` to better approximate "taxable income before §163(j)/NOL/QBI". |
| ~~§461(l) auto-aggregation across Sch C/E/K-1~~ | — | ✅ **SHIPPED 2026-05-27 PM** | Engine auto-aggregates net business losses (Sch C, Sch E pre-PAL rental, K-1 active) when CPA hasn't supplied explicit `section_461l_excess_loss_addback`. Threshold = $305k single / $610k MFJ TY2024. CPA-supplied addback still wins. |
| ~~Form 8824 PDF (§1031) + Form 8990 PDF (§163(j))~~ | — | ✅ **SHIPPED 2026-05-27 PM** | Two new pdfkit builders + 4 new endpoints: GET /clients/:id/form-8824 / .../pdf and /form-8990 / .../pdf. |

**Remaining sub-gaps (newly documented during shipping):**

- **§1031 / §121 / NIIT investment-income base** — recognized gains still don't flow into NIIT base (existing sub-gap, noted in Form 8824 PDF footnote).
- ~~**§461(l) Sch C loss flow**~~ — **CLOSED 2026-06-01.** Signed `scheduleCNetSigned` flows the Sch C loss to AGI, capped by the §461(l) addback; `netSeIncome` stays floored for SE-tax/QBI/local/earned-income. (NOL not auto-generated when loss > income; §163(j) ATI proxy still floored — documented approximations.)
- **§163(j) Sections II/III** (partnership / S-corp pass-through) — Form 8990 PDF rendered as zero-placeholder sections (typical for individual filers).
- **§163(j) small-business exemption** — engine doesn't auto-detect `gross receipts < $30M` exemption per §163(j)(3); CPA must determine whether the form is required.

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
| A2 | **D15 — multi-tenancy auth** | 2-3 wks | **POSTPONED 2026-05-30 → deferred to the Haven-app fusion** (Haven brings its own auth/tenancy). Per-firm tables, RBAC. Until then the EC2 box is demo-only — no real client PII. |
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
| C3 | **CPA design-partner side-by-side validation** — shadow validation by AI-persona CPA shipped 2026-05-27 PM → `docs/c3-design-partner-validation-2026-05-27.md`. Result: **conditional approval** pending §199A QBI auto-detection fix (Tier 1 blocker) + CA personal exemption credit (Tier 2) + IL dep / NJ personal exemption (Tier 3). | done (AI persona); 4-8 wks calendar for real CPA | Live CPA partner still recommended for final cross-validation against UltraTax CS on real client data — packet should be expanded to 25 cases covering Form 8606, §1031, §121, §1202, kiddie tax, FEIE, ACA PTC. |
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
