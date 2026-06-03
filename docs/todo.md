# TaxFlow Assistant — Open TODO list

**Status as of 2026-05-28 (Brookhaven UI/UX revamp shipped; Phase H + C-batch + C3 follow-ups all complete).** This is the durable, git-tracked TODO list.
Read this in every new session before picking up work. The Claude task
tool inside any single session is ephemeral — only this file persists.

When you pick up a task: move it from this list into the in-session task
tracker, work it, commit, then remove it from here.

---

## 🔴 P0 LEGAL/SECURITY GATE (2026-06-03) — in progress

Commissioned after the 2026-06-02 full audit (`docs/product-assessment-2026-06-02.md`).
Branch `p0-legal-security-gate`. These gate ANY real client PII / first revenue.

- ✅ **P0-7b** — TY2026 §199A SSTB QBI band fall-through fixed (single source of
  truth `qbiPhaseInBand`; MFS=single). +12 regression assertions.
- ✅ **P0-6** — CI (`.github/workflows/ci.yml`) + `scripts/tsconfig.tests.json`
  type-checks the test tree (closes "green-on-wrong-shape"). Covers 34/52 suites.
  **RATCHET TARGET: drive the `tsconfig.tests.json` quarantine 25 files → 0.**
  143 pre-existing errors: 93× `T[]|undefined` indexing (add `!`/guard); plus
  GENUINE wrong-shape fixtures to fix FIRST — `stateWagesBox16`/`stateTaxWithheldBox17`
  on W2Fact (deep-audit ×8), `interestIncomeBox1`→`interestIncome` (phaseE),
  `description` on AdjustmentFact (cpa-scenarios), `dependentsForCareCredit` on
  Archetype (seed), duplicate `calculateStateTax` import (phaseE).
- ⏳ **P0-7a** — remove false "TLS/encryption-at-rest/read-only-creds" claims from
  outreach docs (`docs/outreach/partner-faq.md`, `one-pager.md`).
- ⏳ **P0-4 (app layer)** — bearer-token auth gate on `/api` (TLS = infra runbook).
- ⏳ **P0-5 (app layer)** — AES-256-GCM field encryption for SSN/TIN (S3 = runbook).
- ⏳ **P0-2 (app layer)** — §7216 consent gate (extractor fail-closed) + instrument.
- ⏳ **P0-3** — GLBA WISP draft + §7216 + infra runbooks under `docs/compliance/`.
- 🔴 **P0-1 (USER)** — rotate the leaked Neon + Gemini creds. Runbook handed off.
- Infra-side (USER, runbooks in `docs/compliance/`): TLS termination, S3+KMS doc
  storage, Secrets Manager, Google no-training DPA / off the free Gemini tier.

---

## ⚡ CURRENT FOCUS (2026-05-30): refine tax calc + tax planning

**2026-06-02 — OBBBA refresh COMPLETE (planning v1.19.0 + CORE conformance).**
Planning catalog v1.19.0 (101 strategies: TY2026 values, §199A permanence, PTET
§164(b)(7) $40k, 4 NEW deductions G1.97-G1.100). Then ALL core `computeTaxReturnPure`
OBBBA conformance: SALT $40k + §164(b)(7) phase-down; §199A TY2026 thresholds +
$400 min QBI deduction + MFS-threshold fix; **native TY2026 support** (SUPPORTED_TAX_YEARS
+ 2026 in all 20 year-maps + AMT 50% phase-out + stateTaxData); structural CTC $2,200 /
§179 $2.5M / bonus 100% TY2026. **THEN modeled the 4 new OBBBA deductions
(tips/overtime/car-loan/senior) as REAL `computeTaxReturnPure` adjustments**
(`calculateObbbaSchedule1ADeductions`, Schedule 1-A → line 13b; markers in openapi
enum + ClientForm). Every value primary-source-verified vs Rev. Proc. 2025-32 / Notice
2025-67 (3 research agents off the IRS PDFs). **39 no-API suites / 3,320 assertions
green; api-server + frontend deployed + live-verified. OBBBA now fully end-to-end.**
Remaining (deferred, out of scope): bonus-depr TY2025 dual-rate (no acquisition-date
field); state conformity to the 4 deductions; estate (out of scope). See `.claude/handoff.md`.

**D15 (auth + multi-tenancy) is POSTPONED** — this app will be fused into the
larger **Haven** app, which brings its own auth/tenancy, so we won't build it
twice. The focus is the **portable engine + planning feature**
(`computeTaxReturnPure` is already Haven-portable — keep it pure). The live EC2
box stays a **demo** (no auth/TLS) — do NOT put real client PII on it until the
Haven fusion lands. **2026-06-01 session 2: 8 chunks shipped + deployed + verified
live** — ALL 7 remaining tax-calc sub-gaps (K-1 depth: Box 4 GP + basis/at-risk +
per-business SSTB; §163(j) $30M exemption + Form 8990 Sec II/III; AMT line 2i +
ATNOLD; part-year pro-rated std ded; partial-wash + cross-account; HI/NY retirement
refinements; IN/KY/OH/NYC-UBT local taxes) + #9 OBBBA energy-credit repeal (catalog
v1.18.0). Planning #8 (H3 multi-year) + #10 (H2-wire remaining) ASSESSED + DEFERRED.
**39 no-API suites / 3,234 assertions green**, clean typecheck. (Prior 2026-06-01
session 1: 12 fixes — see `.claude/handoff.md` history.)

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
- **K-1 depth** — ✅ **CLOSED 2026-06-01 (session 2).** §199A wage/UBIA limit
  (prior session) + NEW: dedicated **guaranteed-payments Box 4** field (AGI + SE
  via max(14A,Box4), excluded from QBI §199A(c)(4)); **§704(d)/§1366(d) basis +
  §465 at-risk** loss limits enforced (cap active Box 1 loss; suspended carryforward);
  **per-business SSTB** phase-out (per-K-1 isSstb, fixes the old whole-QBI phase-out).
  49 hand-calc'd tests (`tax-engine-k1-depth-tests.ts`). Remaining: per-business
  (Form 8995-A) wage/UBIA limit is aggregate; basis not reduced by distributions.
- **§163(j)** — ✅ **CLOSED 2026-06-01 (session 2).** $30M small-biz gross-receipts
  exemption auto-detected (§448(c): $30M 2024 / $31M 2025 / $32M 2026, web-verified)
  via `section_163j_gross_receipts`; Form 8990 Sections II/III now rendered with
  correct individual-filer content. +19 tests.
- **AMT prefs** — ✅ **CLOSED 2026-06-01 (session 2).** line 2i MACRS-vs-ADS
  depreciation diff (`amt_depreciation_adjustment`, ±) + AMT NOL/ATNOLD §56(d)
  (`amt_nol_carryforward`, 90%-of-AMTI cap, web-verified). +14 tests.
- **Part-year residency** — ✅ **pro-rated std ded SHIPPED 2026-06-01 (session 2)**:
  std ded + personal exemption now pro-rated by residency days (was full in BOTH
  periods → ~2× over-deduct). +6 tests. Remaining (documented, larger lift): exact
  NY IT-203 / CA 540NR Sched CA per-line sourcing, mid-year resident credit,
  part-year locality/AMT, pro-rated retirement/SS exclusions.
- **Wash sales** — ✅ **CLOSED 2026-06-01 (session 2).** Partial wash proportional
  disallowance (loss × min(replQty,soldQty)/soldQty, consumption-tracked) via new
  `quantity` column; cross-account documented + test-locked (detector is
  account-agnostic) + new `account` column. +13 tests. Remaining: leftover-share
  re-flow across input-order-later losses.
- **State retirement exemptions** — ✅ **CLOSED 2026-06-01 (session 2).** HI
  employer-funded cap (`hi_employer_funded_pension`); NY govt-pension Line 26 full
  exclusion + Line 29 $20k/$40k (`ny_government_pension`). NJ verified already
  correct (no change). +11 tests. (NJ/NY/HI were already wired — todo was stale.)
- **Local** — ✅ **mostly SHIPPED 2026-06-01 (session 2).** IN per-dependent
  exemption ($1k/filer + $1k/dep); KY occupational (Louisville/Lexington + Kenton/
  Boone wage-cap); OH cross-city resident credit (`oh_work_city_tax_paid`); NYC UBT
  (`calculateNycUbt`, `nyc_ubt_business_income`). +15 tests. **MD per-dependent NOT
  done** — engine has no MD state-income-tax row (MD is county-localities only) +
  MD's graduated phase-down exceeds the cliff-only data model. Documented, deferred.

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
- ✅ **PLAN-08 — SHIPPED 2026-06-01.** `isStrategyExpiredForYear(validUntil, taxYear)`
  + `evaluatePlanningOpportunities` filters expired hits (return tax year > validUntil
  year). All current strategies are validUntil 2026, so TY≤2026 unaffected; TY2027+
  surfaces nothing until refresh. +7 tests.

Biggest credibility lift:
- **H2-wire remaining (#10) — ASSESSED + NOT RECOMMENDED (re-confirmed 2026-06-01
  session 2).** The ~44 remaining G1.46–G1.96 detectors are qualitative-by-nature
  (business credits the individual engine doesn't model — §41/§45S/§51/§47/§44;
  entity/S-corp elections — §351/§338(h)(10)/§1374/§1377/§263A; trust vehicles —
  CLT/PIF/easement; multi-year structures — §453/§72(t)/§174/§529→Roth; after-tax
  contributions with long-term-only value; soft guidance). NOT a single current-year
  engine mutation. **Don't force-wire without first modeling the underlying credit/
  election in the engine** — the generic `credit` adjustment is REFUNDABLE, so it
  can't model a nonrefundable credit without overstating for low-tax filers.
- **H3 multi-year wiring (#8) — ASSESSED + DEFERRED again (2026-06-01 session 2).**
  Only G1.3/G1.8/G1.4 are multi-year-aware. A defensible NEW wire needs either the
  ~13-yr RMD-projection model (G1.22, overlaps wired G1.4 + inherently approximate)
  or per-year §453 installment-gain recognition the engine doesn't model. Neither is
  a quick win; shipping a shaky model is explicitly off-limits. Carryforward
  depletion is already covered by G4.4/G4.5. Do only with dedicated time for a
  defensible trajectory model + tolerance-based engine-verified tests (H3.G1.3 precedent).
- **Catalog freshness (#9) — FULLY SHIPPED.** Tier-1 (catalog v1.18.0, 2026-06-01):
  OBBBA clean-energy-credit repeal (G1.33/G1.34/G1.37 validUntil 2032→2025).
  **Tier-2/3/4 — SHIPPED 2026-06-02 (catalog v1.19.0):** QCD/adoption(+refundable)/
  retirement-cluster/§448(c) dollar bumps; §199A TY2026 thresholds + widened phase-in
  + $400-floor note + QBI permanence (validUntil→2099); core TY2025 std-ded corrected
  to OBBBA $15,750/$31,500/$23,625; PTET recoded §164(b)(6)+(7) with $40k cap +
  phase-down (new `obbbaSaltCap()`); **4 NEW deductions G1.97–G1.100** (tips §224 /
  overtime §225 / car-loan §163(h)(4) / senior $6k). Catalog now **101 strategies**;
  planning suite **527 assertions**. Every value hand-calc'd vs the IRS source.
  See `docs/planning-strategy-audit.md` (OBBBA section). **Follow-ups discovered**
  (core-engine, deliberately out of the planning-refresh scope): core SALT cap still
  $10k (OBBBA $40k not applied to the federal itemized total — PTET works around it
  off saltUncapped); core §199A SSTB thresholds + $400 min-deduction; native TY2026
  engine support (brackets/std-ded $16,100/$32,200 + SUPPORTED_TAX_YEARS); API-enum +
  ClientForm UI for the tips/overtime/car-loan markers (G1.97–G1.99 reachable in prod;
  G1.100 senior fires on age now).

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
