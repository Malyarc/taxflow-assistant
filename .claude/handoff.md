# Handoff Note — 2026-06-11b (T1.0 CLOSED — 8-worktree ultracode fleet; ~45 fixes incl. the §1(h) worksheet interleave; PR #2)

**ALL of MASTER-TODO T1.0 (a)–(l) is DONE** on `claude/serene-hamilton-rqzitr`
(PR #2; built in the cloud sandbox — NOT deployed; the EC2 key lives on the
local machine). 8 parallel worktree agents (the session-limit cutoff mid-run
was recovered by 2 finisher agents + orchestrator salvage), merged one-by-one
with hand-adjudicated conflicts.

**Final green bar:** 117 no-API suites / **7,117 assertions / 0 failed** ·
property harness 5,636 · differential oracle 758 scenarios **0 divergences** ·
**ALL 17 yes-API integration suites green WITH a dummy AI key** (returnQa +
campaign email-draft now degrade to the deterministic path on a THROWN LLM
call) · api-server + tax-app builds clean · migrations **0021–0024** applied
locally (additive: §25D CF, W-2 Box 10/12/13/18-20 + adjustments.tax_year +
excess-SS/8959-IV, qbi_loss_carryforward_remaining, children_under_6).

**Adjudications of record (don't re-litigate without reading these):**
1. **§1(h) INTERLEAVE** — the Schedule D Tax Worksheet was implemented
   line-by-line (`computeScheduleDTaxWorksheet`); the special 25/28 layers fill
   ordinary brackets up to the below-25% top (L21) and the 25% bucket is
   reduced by (L10+L21)−L1 (L38). The three prior "flat" rulings are
   OVERTURNED; §1231(c) recharacterization is tax-neutral below the 24% top
   (t10cd E2 pins both legs at $30,038.50 with the full worksheet derivation).
2. **CO TY2025 = 4.40%** — the audit's TABOR-4.25% claim was REFUTED against
   the actual DR 0104 booklet (trigger missed); pinned.
3. **EITC §32(a)(2) is a ceiling** (EIC-table method) — engine matches Pub 596.
4. WV TY2026 = SB 392 retroactive rates; CA AMT 2024 = the real FTB
   exemptions; RI SS limits TY2024; §30C survives to 6/30/2026 (NOT 12/31/25).

**Deploy checklist (local machine):** review/merge PR #2 → main → EC2 cycle
(`migrate` applies 0021–0024 — review additive SQL again on the box) → frontend
rsync (codegen regenerated api.schemas) → re-score sweep (planning columns:
detector gating changed) → healthz + smokes: QSS $307,274 → addlMedicare
$965.47 · 1099-INT Box1 5k/Box3 4k/Box8 3k → AGI $9,000 + CA unchanged ·
KS $60k single → $2,548.31 · MCTMT $150k SE → $900 · NOL client AGI now
NET of NOL · TY2026 PTC 450% FPL → $0.

**Still open after T1.0:** T0.1/T0.2 (the security gate — UNCHANGED, still the
launch blocker), T0.3 A3/A6 (corner matrix + CPA sign-off), T1.5 accuracy-
deepening (incl. the filingStatusTraits refactor), T2.3 UX/UI 2.0, T5 growth.

---

# Handoff Note — 2026-06-11 (FULL-APP MAXIMUM AUDIT #2 — 13-agent fleet + NEW differential-oracle harness; 9 fixes on PR #2, NOT yet deployed)

Ran the full-app maximum audit from a **cloud sandbox** (branch
`claude/serene-hamilton-rqzitr`, **draft PR #2** — could NOT merge to main or
deploy from here: no EC2 key in the sandbox, and the remote-session rules pin
work to the designated branch). **Deploy checklist at the bottom.**

**What ran:** green bar (4 typechecks + build + no-API 111/6,720 baseline) →
13-agent fresh-fleet fan-out (one per subsystem, primary-source verification +
live `computeTaxReturnPure` repros) → property harness (5,636) → **NEW
differential-oracle harness vs tenforty/OpenTaxSolver (T0.3 A0/A2 — CLOSED;
758 scenarios, every divergence triaged, 0 unexplained)** → /code-review max
(7 angles) → live /verify (QSS + Box-3 values verified through the running API).

**SHIPPED (commit `bf43c43`, 9 fixes, all hand-calc'd + regression-pinned in the
new `tax-engine-audit-2026-06-11-tests.ts`, 33 assertions):**
- **The QSS ≠ "joint return" cluster** — `qualifying_widow` was treated as MFJ at
  8 sites whose statute excludes a §2(a) surviving spouse: Additional Medicare
  $200k (ORACLE-found), §86(c) SS taxability $25k/$34k, §21 dependent care,
  §25A education band, §32 EITC column, §221 SLI band, §904(j) FTC $300,
  OBBBA Sch 1-A caps/senior. QSS correctly STAYS MFJ for brackets/std-ded/NIIT/
  CTC/§121/IRA-band (Pub 590-A) — verified untouched.
- **1099-INT semantics** — Box 8 was netted out of Box 1 (disjoint boxes!);
  Box 3 Treasury interest was dropped entirely ($0 income) AND missing from the
  Create/Update openapi bodies (zod-stripped on write — the classic gotcha);
  now Box 1 + Box 3 taxable, Box 8 separate, Box 3 wired to the state
  US-Treasury subtraction. 5 wrong-expectation tests corrected.

**Green bar at ship:** no-API **112 suites / 6,754 / 0 failed** + property
harness + oracle 0-divergence + yes-API green (ai-overlay + return-qa need a
real AI key — environmental; NOTE `returnQa.ts:193` 500s on a THROWN LLM error
instead of using its own deterministic fallback — small Tier-3 fix).

**THE BIG OUTPUT — a ranked deferred backlog from the 13 agents** (each item
file:line + repro): **`docs/accuracy-audit/full-app-audit-2026-06-11.md`** +
the 13 verbatim reports in `docs/accuracy-audit/agent-reports-2026-06-11/`.
Tier-1 highlights (wrong filed numbers, broad): KS SB1 never applied; PA Sched
SP double-applied + wrong steps; CO 2025 TABOR 4.25%; WV 2024 rates; HI Act 46;
NM HB252; MD HB352; TY2026 PTC still on expired ARPA schedule; §25C/§25D not
terminated for 2026; §25D-before-CTC ordering inflates ACTC; EITC §32(a)(2)
phase-out formula; §53/§38 gross-vs-net credit limits + MTC=100%-of-AMT
auto-seeded; OBBBA senior missing from AMTI; excess-SS credit unmodeled;
§461(l) no cross-entity netting + stale 2026 thresholds; NOL below-the-line;
QBI SEHI/negative netting; K-1 SE missing from EITC earned income; K-1 Box 2
QBI double-dip; PTC MAGI = raw AGI; MCTMT taxes only the excess over $50k
(statute taxes ALL once over); locality bases never subtract taxable SS.
**Planning HIGH:** multi-year projection drops K-1/rental/capital income from
out-years (G1.47 showed $75k vs true $22k, labeled engine-verified).
**CONTESTED (needs its own session):** the §1(h) 25%/28% interleaving claim —
do NOT change without a Schedule-D-Tax-Worksheet line-by-line adjudication.

**Deploy checklist (run from the local machine per CLAUDE.md):** review/merge
PR #2 → fast-forward main → EC2 deploy cycle (pull, install, migrate = no-op
[no schema change], build, pm2 restart) → frontend rsync (api.schemas.ts
regenerated → rebuild) → healthz + smoke: QSS client w/ $307,274 Medicare wages
→ additionalMedicareTax $965.47; 1099-INT Box1 5k/Box3 4k/Box8 3k → AGI $9,000
(and CA state tax unchanged by Box 3).

---

# Handoff Note — 2026-06-10c (T2 COMPLETE — the T2.2 completion batch: entity-choice, roll-forward, organizer, engagement, branded planning report, return-Q&A, campaigns)

**T2 is ENGINEERING-COMPLETE.** This session (branch `claude/dreamy-bardeen-kspyig`,
built in the cloud sandbox — **NOT yet deployed**; deploy needs the EC2 key from
the local machine) closed every remaining T2.2 item:

**D1:**
- **Entity-choice / S-corp reasonable-comp calculator** (`entityChoice.ts`,
  `GET /clients/:id/entity-choice?reasonableComp=`): real engine runs — the Sch C
  inputs are swapped for a W-2 + ACTIVE S-corp K-1 (QBI = Box 1, §199A wage limit
  fed by owner comp, SSTB flag propagated) + statutory payroll adders (employer
  FICA per-employer, employee FICA per-person net of other W-2 SS wages, net FUTA
  $42). Default 35/50/60% sweep; SEHI = net-zero under S-corp (Notice 2008-1);
  "cheapest MODELED level", never a comp opinion (Rev. Rul. 74-44). 62 hand-calc'd
  tests (E1: $200k/$80k → savings $9,503.38 exact).
- **Branded planning report PDF** (`planningReportPdf.ts`,
  `GET /clients/:id/planning-report/pdf`, pro-gated): Brookhaven cover + headline
  savings + per-opportunity detail + deadline calendar + multi-year + disclosures.
  Deterministic (no LLM).

**D2:**
- **Client organizer** (`clientOrganizer.ts` + `organizerPdf.ts`,
  `GET /clients/:id/organizer[/pdf]`): prior-year-personalized request list
  (employers/payers/K-1s/rentals/accounts flip to "received" on matching
  current-year rows) + deduction reminders + life-events questionnaire. 43 tests.
- **Prior-year roll-forward** (`rollForward.ts` pure mappers +
  `POST /clients/:id/roll-forward`): proforma W-2/1099/K-1/rental/asset rows into
  the new year (K-1 basis start ← prior ending; disposed rentals skipped; doc
  links detached), advances client.taxYear, transaction-wrapped, 409 on re-roll;
  reports the carryforwards the pipeline auto-seeds
  (`synthesizePriorYearCarryforwards` now exported = single source of truth).
  37 tests.
- **Engagement tracking** (`engagement.ts`, **migration 0019** additive:
  engagement_status + extension_filed on tax_returns): 6-status enum, §6072(a)/
  §6081 deadlines with §7503 weekend roll (holiday shift documented not-modeled),
  `PATCH /clients/:id/tax-return/engagement`, firm-wide `GET /engagements`
  (deadline-sorted + status counts). 21 hand-verified date tests.

**D3 (LLM never does math; §7216-gated):**
- **Return Q&A** (`returnQa.ts`, `POST /clients/:id/return-qa`): LLM narrates from
  a ~50-field engine grounding snapshot (first-name-only; key-scan test proves no
  PII fields); question sanitized + treated as untrusted; no consent/AI → the
  deterministic key-figures fallback. 29 tests.
- **Campaign tool** (`planningCampaigns.ts`, `GET /planning-campaigns` +
  `POST /planning-campaigns/email-draft`): hit-list-fast-path cohorts grouped per
  strategy; the LLM email draft sees ONLY strategy text + anonymous $100-rounded
  stats (no client data → no per-client consent needed); {{firstName}}/
  {{estSavings}} merge happens locally; deterministic fallback when the draft
  loses the merge fields. 25 tests.

**Frontend:** CPA Tools tab → 7 cards (+engagement select/extension, entity-choice
sweep table, organizer checklist + PDF, roll-forward action); Planning tab →
"Client report (PDF)" + the Q&A card; Dashboard → campaigns widget. Vite build OK.

**Quality bar:** 7 new no-API suites (~240 hand-calc'd/fixture assertions incl.
review-regression pins, all summary lines in the runner-parseable RESULTS
format) + the cpa-tools yes-API suite expanded to ~60 assertions (needs a live
DB — couldn't run in the sandbox); 4 typechecks clean; full no-API battery
green; **`fast-check` added to scripts devDependencies — the property harness's
dep was in NO manifest (typecheck:tests had 10 pre-existing errors → now 0) and
the harness runs green on v4.8.0 (5,636 runs).** Migrations 0019 + 0020
reviewed (additive only).

**The 9-angle /code-review max pass found + fixed 16 real defects pre-ship**
(full ledger in MASTER-TODO §T2.2): entity-choice §179-CF double-count + QBI
regime flip + Box-3 falsy-zero (now reads the NEW engine output
`netScheduleCProfit`); rental suspended-loss double-release; the PROFORMA flag
system (migration 0020 — rolled rows aren't "received"; CPA PATCH clears);
pdfkit footer page-fork in BOTH new PDFs AND the shipped workpaper packet
(pdfBrand.applyBrandFooters); the planning router's Pro-tier gate 402-ing ALL
cpa-tools endpoints when off (mount-order swap; pre-existing); WinAnsi ✓ glyph;
manual-override-aware carryforward report; SUPPORTED_TAX_YEARS roll guard;
engagement PATCH 3-tier year resolution + derived weekend-rolled deadlines on
TaxReturn responses; statusCounts pre-filter; email-draft fan-out eliminated
(stats ride the campaign payload). Reuse: pdfBrand / downloadFile / clamped
engine toNum / rankedClientIdsByPlanningScore / loadMultiYearHistory shared.

**Deploy checklist (run from the local machine per CLAUDE.md):** merge to main →
EC2 deploy cycle (pulls + `migrate` applies 0019 + build + pm2 restart) →
frontend rsync → healthz + prod-smoke (engagements list, entity-choice on a
seeded client, organizer PDF, planning-report PDF, campaigns).

**Still open in T2 (NOT engineering):** T2.1 CPA legibility sign-off + T2.2
design-partner validation (both gated on the T4 partner); the (Haven platform)
items stay deferred by design.

---

# Handoff Note — 2026-06-10b (T2.2 CPA-FIRM FEATURES — projection/1040-ES + MFJ-vs-MFS + ready-to-file + YoY/threshold-alerts; shipped + deployed + browser-verified)

Built **the second half of T2 — MASTER-TODO T2.2 (GAME PLAN D)**, the pure-engine
CPA-firm features. Same session as the §221 fix + T2.1. All on `main`, pushed,
deployed (api-server + frontend rsync + healthz), **PROD-SMOKED + browser-verified**.

**What landed (4 pure-engine modules + endpoints + a "CPA Tools" frontend tab):**
- **Tax projection + 1040-ES** (`taxProjection.ts`, `GET /clients/:id/tax-projection`):
  projects next year, sizes the four §6654 safe-harbor quarterly vouchers
  (min(90%-projected, 100%/110%-prior)), YoY + OBBBA deltas. 35 tests.
- **MFJ-vs-MFS optimizer** (`filingStatusOptimizer.ts`, `GET /mfj-vs-mfs`): joint vs
  two-MFS (income by spouse tag, §63(c)(6)(A) coupling, withholding-independent
  net-tax metric), recommend + delta. 28 tests (doubled-bracket symmetry + a real
  MFS-win + coupling).
- **"Ready to file" gate** (expanded `returnDiagnostics.ts`): EITC-vs-dependents
  cross-check, qualifying-child-SSN reminder, new "Audit risk (DIF)" category
  (rental-loss + charitable-ratio), carryforward awareness. 52 diagnostics tests.
- **Year-over-year + OBBBA + threshold alerts** (`yearOverYear.ts`, `GET /year-over-year`):
  line deltas + notable swings + crossings (NIIT/Add'l-Medicare/AMT/§199A/IRMAA/
  refund→owed, entered/exited) + the OBBBA law-change benefit. 25 tests.
- Frontend: new **"CPA Tools" tab** (`components/CpaToolsTab.tsx`) — 3 cards over the
  generated hooks; browser-verified (projection $195k→$200,850 ×1.03, 1040-ES
  $8,945/qtr, MFJ-vs-MFS recommendation, all in the Brookhaven palette, 0 console
  errors).
- OpenAPI: 3 endpoints (permissive object responses → generated hooks) + codegen.
- Tests: 3 no-API suites (88) + `tax-engine-cpa-tools-integration-tests.ts` (yes-API,
  20). **Full battery 104 suites / 6,459 no-API assertions, 0 failed; 4 typechecks
  clean.**

**Deferred (flagged, NOT done — need product/infra decisions):** D1 entity-choice /
S-corp reasonable-comp + client-facing branded deliverable; D2 client organizer +
prior-year roll-forward + engagement tracking; **D3 LLM features (NL Q&A, firm-wide
campaign tool) — gated on §7216 consent + the "LLM never does math" architecture**;
the **(Likely Haven)** items (e-sign, billing, review-notes, client portal).

**Next:** T2.2 entity-choice/S-corp calc + prior-year roll-forward (the next
pure-engine D-items) · the deferred T0.3-A0/A2 differential-oracle layer · T2.1 +
T2.2 CPA design-partner validation (T4).

---

# Handoff Note — 2026-06-10 (T2.1 WORKPAPER/FORM GENERATOR — one-click CPA review packet; shipped + deployed + prod-smoked)

Built **MASTER-TODO T2.1 (GAME PLAN B), Phases B0–B4** — "the first half of T2."
1 commit on `main` (`df94d5e`), pushed, deployed (api-server rebuilt + restarted,
frontend rsynced, migrate no-op, healthz ok), **PROD-SMOKED** (workpaper PDF 200
+ valid `%PDF-` for a real seeded client; 404 path; summary PDF unregressed;
frontend serves).

**What landed:** a one-click **workpaper packet** PDF = cover page + **1040
reconciliation worksheet** (the headline CPA cross-check: every computed value
tied to its form+line with engine-exact ✓/⚠ tie-out rows) + **40 substitute-form
builders** (1040, Sch 1/1-A/2/3/A/B/C/D/E/SE/H, 8949; credit forms 8812/8863/
8880/2441/8962/5695/8839/1116; other-tax 6251/8959/8960/8615/5329; detail 8995/
4562/8582/4952/2555/7206/8283/4797; state CA-540/NY-IT-201/NJ-1040/MA-Form-1/PA-40
+ a generic-state fallback). Pure `FormSpec` builders (Haven-portable) + ONE
generic pdfkit renderer (DRAFT-watermarked, not for filing).
- Architecture: `artifacts/api-server/src/lib/forms/` (formSpec, formRenderer,
  registry, reconciliationWorksheet + 40 `*Spec.ts`).
- Endpoint `GET /clients/:id/tax-return/workpapers/pdf`; ClientDetail "Workpaper
  packet (PDF)" button. Engine: additive `obbbaSchedule1A` + 4 state-credit
  scalars exposed on `ComputedTaxReturn` (zero regression).
- Tests: 13 no-API suites (`tax-engine-workpaper-*-tests.ts`) + 1 yes-API
  (`tax-engine-workpapers-integration-tests.ts`). **Full battery green: 100
  suites / 6,345 no-API assertions, 0 failed; 4 typechecks clean; 40-form render
  smoke + prod smoke green.**

**Recovery note:** the ultracode fan-out hit the session limit twice mid-run, but
the agents had written most builder files to disk before being cut off — 33 of 40
builders + 10 test files landed and turned out typecheck-clean + test-green once
re-run. Finished solo: wrote the 7 missing builders (Sch 2/3/1-A, 8582, 4952,
PA-40, generic-state) + 3 missing test files (schedules-123, detail-forms-a,
state-njmapa-generic), wired the registry + tsconfig + run-no-api, fixed 1 wrong
test expectation (CA Personal Exemption Credit $144 — verified correct, not a
bug), reviewed inline (no multi-agent).

**§221 SLI-MAGI ENGINE BUG — FIXED + DEPLOYED (same session, commit after df94d5e):**
the student-loan-interest MAGI omitted the IRA deduction → over-phased-out §221
when a deductible IRA pushed MAGI across the $80k/$165k band. Fixed per Pub 970
Worksheet 4-1: IRA deduction now computed FIRST (its Pub 590-A MAGI is independent
of SLI), then SLI MAGI = AGI-without-SLI (net of IRA) + FEIE add-back. Repro
single $90k SE + $4k IRA + $1,500 SLI now deducts the full $1,500 (was $1,135.83);
no-IRA filers byte-for-byte unchanged. Regression `tax-engine-section221-sli-magi-tests.ts`
(10 hand-calc'd). Full battery 101 suites / 6,355 / 0 failed.

**Next (per MASTER-TODO):** T2.2 firm features (Game Plan D — the "second half of
T2") · T2.1 CPA legibility sign-off (gated on a design partner, T4) · the deferred
T0.3-A0/A2 differential-oracle layer.

---

# Handoff Note — 2026-06-09d (T1.3 PLANNING POLISH — what-if UI + estate/gift touchpoints + heuristic-promotion triage; shipped + deployed + browser-verified)

Finished the **remaining MASTER-TODO T1.3 items** (all of T1.3 is now done or
deliberately-resolved). 1 commit on `main` (`4541a2c`), pushed, deployed
(api-server rebuilt, frontend rsynced, re-scored, healthz ok), **PROD-SMOKED +
BROWSER-VERIFIED**. Full green bar: 4 typechecks + CI test-typecheck + 86 no-API
suites / **4,838** assertions + property harness (5,636). A full **`/code-review
max --fix`** pass (6 parallel finder-angles + verify + sweep) found **5 real
issues — all fixed** before deploy.

**What shipped:**
- **Interactive what-if scenario builder UI** (the highest-demo-leverage T1.3
  item). A new flagship card on the Planning tab over the existing
  `POST /clients/:id/what-if` engine: a CPA composes arbitrary mutations
  (add/replace/remove an adjustment, or change a client fact — filing status /
  state / age) and gets the EXACT engine federal+state delta, side-by-side
  baseline-vs-scenario + per-component breakdown. **Browser-verified end-to-end**
  (a $50k deduction on a $1.1M single client → AGI $1,100,000→$1,050,000, federal
  tax $338,964→$320,464, Δ −$18,500 = exactly 50k×37% top marginal). Reuses the
  existing `useRunWhatIfScenario` hook; Pro-tier-gated (inside the Planning tab).
- **Estate & gift touchpoints**: a NEW `"estate"` StrategyCategory + 6 catalog
  strategies + detectors **G1.101–G1.106** — annual-exclusion gifting (§2503(b)),
  529 superfunding (§529(c)(2)(B)), SLAT, ILIT, GRAT, §1014 step-up-in-basis hold.
  These are **qualitative INFORMATIONAL flags** (confidence 0.40–0.50, so they
  never outrank the engine-verified income-tax strategies) because the
  individual-1040 engine has no estate-tax model — each estSavings is an
  illustrative figure with disclosed assumptions; the CPA sizes it via the
  prerequisiteData. New year-indexed `ANNUAL_GIFT_EXCLUSION`/`ESTATE_BASIC_EXCLUSION`
  (`Record<TaxYear>`). Catalog **v1.21.0**. +29 hand-calc'd planning assertions
  (planning-tests 556→585). Wired through openapi (both category enums) + codegen
  + frontend label/badge maps + the planning-calendar deadline classifier.
- **Heuristic-detector promotion — evidence-based re-triage** (NEW
  `docs/planning-detector-promotion-triage.md`). Independently re-confirmed the
  2026-06-06i finding: the cleanly-modelable detectors (current-year,
  income-tax-complete, determinable amount) are ALREADY engine-verified (§1244 /
  §453 / §41 / §163(d) / §221 / Saver's / adoption / PTC / SEP / HSA / SEHI / …);
  the remaining ~50 are deliberately heuristic for documented reasons —
  multi-year/future-growth (no current-year delta), engine-invisible component
  (DCFSA's FICA), qualitative/structural (trusts, entity elections), or
  requires-a-guessed-input. **Force-wiring them would inject incomplete/
  falsely-precise "verified" numbers — explicitly NOT done** (the "model the
  mechanic first or leave heuristic" rule). **If you want specific ones promoted
  despite the documented limitations, say which.**
- **Shared `adjustmentLabels.ts`**: hoisted the 122-entry `TYPE_LABELS` out of
  `AdjustmentsTab` into a shared module so the editor + the what-if builder share
  one source of truth (verified 1:1, zero keys dropped).

**`/code-review max --fix` — 5 fixes applied (all re-verified green + the UI ones
browser-verified on the post-fix build):**
1. **Inverted delta coloring** — the AGI/Taxable-income comparison rows used
   `signedMoney` → GREEN on increase (an income rise shown as "good"). New
   `neutralMoney` kind → AGI/taxable carry no good/bad signal; only the tax
   (down=good) + refund (up=good) rows do. Browser-confirmed AGI delta now
   `text-muted-foreground`.
2. **openapi `OpportunityHit.category` enum** was missing `estate` (only the
   hit-list query-param enum got it — different indentation) → the generated
   `OpportunityHitCategory` union + api-zod under-declared a value the server
   returns. Fixed + re-ran codegen (both enums now include `estate`).
3. **`Number("")===0` footgun** in `whatIfRowToMutation` (amount + numeric-field
   paths) — garbage text ("abc", "$") stripped to "" and `Number("")===0` passed
   because the empty-guard tested the UN-stripped string → a silent `amount:0` /
   `age:0` / `0-dependents` mutation. Now rejects when the CLEANED string is empty.
4. **Credit-only headline** — the verdict led with `combinedTaxDelta`, so a
   credit-only scenario (tax liability flat, refund moves) showed "$0 / No
   combined tax change". Now drives off `combinedRefundDelta` (the cash impact,
   the lesson `PlanningHitWhatIfPanel` already encodes) + dropped the awkward
   `data.label`-possessive copy. Browser-confirmed.
5. **`estateFmt` duplicated the module-scope `obbbaFmt`** byte-for-byte →
   consolidated both into one shared `fmtUsd0`.
   **Skipped (by-design / false-positive, each reasoned):** GRAT/step-up firing
   off gross-LTCG (consistent with the existing CRT detector; qualitative flags),
   the unfiltered adjustment-type dropdown (the user wanted ARBITRARY mutations),
   the Radix empty-Select (benign — static items, no async prefill), the
   module-global row-seq counter (no cross-card collision), toLocaleString in
   Layer-2 display strings (never an asserted value).

**Recommended next:** T1 is complete. The highest-leverage remaining engineering
move is the **T0.3 differential-ORACLE layer** (A0/A2 — wire OpenTaxSolver /
ustaxes / tenforty + the IRS ATS scenarios as a second oracle) to promote the
property harness from self-consistency to oracle-backed cross-validation — the
last unmet T0.3 technique. Then T2 (forms/workpaper generator) once a CPA design
partner is in hand.

---

# Handoff Note — 2026-06-09c (T1 A+ HARDENING — independent multi-agent + /code-review + /security-review; 12 bugs found + fixed + deployed)

After the T1 ship, ran the review pass the first T1 pass skipped: `/code-review`
(9 finder angles + verify) + `/security-review` + a fresh **9-agent opus
adversarial audit** (4 area-audits + 4 method-angle finders + 1 security), each
re-deriving every value vs the IRS/state primary source. It found **12 real
correctness bugs** — several in MFJ paths + cross-cutting flows the single-filer
unit tests missed, and several where the TEST EXPECTATION itself encoded the bug
(the failure mode John warns about). All fixed + regression-tested + deployed +
prod-verified (commit `5028ac0`); **/security-review found ZERO vulnerabilities**.

**Bugs fixed (all hand-calc-regressed):**
- HIGH-1 statutory-employee QBI dropped when an explicit qbi_income coexisted.
- HIGH-2 crypto-mining escaped SE tax on the MFJ per-spouse path (~$4,239/return;
  prod-verified now $4,238.87).
- HIGH-3 SE non-farm optional method ignored on the MFJ per-spouse path.
- MEDIUM-1 a disposed passive rental's positive net was missing from the NIIT base.
- §280F-HIGH heavy-SUV §179 cap keyed off the current year not the vehicle vintage
  → permanent under-depreciation; §280F-MED SUV ≤50%-use missing the ADS switch.
- WA-HIGH surcharge measured on gross not TAXABLE gain over $1M (test re-derived
  $100,040 → $91,978); CO-HIGH AMTI omitted the federal exemption; CT-MED exemption
  hardcoded 2025 values mislabeled 2024 — all now use the engine's federal AMT base.
- church $108.28 SE floor; Monte Carlo startingPortfolio Infinity-overflow + the
  iraRemainingAtHorizon phantom growth + a toLocaleString determinism risk; the
  two route handlers' numeric-column stringify gaps.
- Form 2210 Schedule AI: the agent's "front-loaded under-statement" was on an
  IMPOSSIBLE input (RAP can't exceed 90%×current tax); the math is correct for
  valid inputs (verified, not changed) — only a NaN guard added.

**LESSON (recorded to memory): always run /code-review + /security-review + an
independent multi-agent audit before calling engine work done — green-bar-only is
not enough.** The single-filer tests were green while 4 HIGH MFJ/cross-cutting
bugs shipped.

+19 regressions (t1-capability 29, §280F 21, state-depth 10). Green bar: 86 no-API
suites / 4,809 + property harness (5,636) + 4 typechecks; Monte Carlo 1e308→finite.

---

# Handoff Note — 2026-06-09b (T1 — PERFECT THE ENGINES: all of T1.2 + T1.3 core shipped + deployed + prod-verified)

Worked MASTER-TODO **T1** (perfect the tax + planning engines). **All 7 T1.2
items + the T1.3 optimizer core are DONE**, hand-calc-tested, deployed (migrations
0017+0018 applied to prod), and prod-smoked. 9 commits this run
(`590b451`..`cb8e134`); ~115 new hand-calc'd assertions across 6 new suites; full
green bar 86 no-API suites / 4,809 assertions + property harness (5,636) + 4
typechecks; prod endpoints (monte-carlo, bracket-fill, tax-return) all 200.

**T1.2 (ALL DONE):**
- **§280F** luxury-auto depreciation caps + listed-property ≤50%-use ADS + heavy-SUV
  §179(b)(5) cap (dedicated capped path; vintage-fixed caps + post-yr-6 overhang
  via replay). New asset fields (migration 0017). Caps Rev. Proc. 2024-13/25-16/26-15.
- **§469(g)** per-property suspended-loss release on full disposition (migration 0018).
- **SE edges**: statutory employee (Sch C, no SE tax), church employee ($108.28),
  non-farm optional method. **Digital assets**: crypto staking (ordinary) + mining (SE).
- **State depth**: CO + CT individual AMT (CT plumbs the federal TMT for its
  lesser-of test); WA cap-gains threshold corrected $270k/$278k + 2025 2.9%
  surcharge over $1M. **Form 2210 Schedule AI** annualized method.
- **Carryforward audit**: 10 round-trip assertions, zero gaps.

**T1.3 (CORE DONE):** `monteCarloEngine.ts` (seeded MC confidence bands; built by a
worktree agent, reviewed + integrated), `multiYearOptimizer.ts` (bracket-fill),
`strategyComboOptimizer.ts` (greedy best-subset + interaction erosion). Endpoints:
POST /clients/:id/monte-carlo + /bracket-fill.

**T1.3 STILL OPEN (the remaining polish):** (1) promote the ~44 qualitative
heuristic detectors to engine-verified what-ifs; (2) estate/gift touchpoints
(catalog+detector — research is in hand: annual excl $18k/$19k, BEA $15M-permanent,
step-up §1014); (3) the interactive what-if scenario-builder UI (frontend over the
existing what-if engine + endpoints). Each needs careful catalog/coverage or
frontend work; the high-value differentiated T1.3 core (optimizers + MC) is done.

**Recommended next:** the interactive what-if UI (the engine + endpoints already
exist — it's the highest-visibility remaining piece for a CPA demo), then the
estate touchpoints, then the heuristic-detector promotion batch.

---

# Handoff Note — 2026-06-09 (AUDIT CLOSE-OUT — ZERO DEFERRALS; +8 commits shipped + deployed + prod-verified)

Finished EVERY remaining deferred finding from the full-app audit (ledger:
`docs/accuracy-audit/full-app-audit-2026-06-08.md`). All 45 ledger findings are now fixed or
resolved-by-design — **no deferred items remain**. 8 commits on `main` (`869d39a`..`6beb7e0`, all
pushed + deployed: api-server rebuilt, **migrations 0014+0015+0016** applied, frontend rsynced,
re-scored, healthz ok; prod-smoked SCH1/M4 exact values + seeded-client + PDF 200). Every value
hand-calc'd vs the IRS/state primary source; each fix has a regression in
`tax-engine-audit-2026-06-08-tests.ts` (now **106** assertions) + the new
`tax-engine-sch1-surface-integration-tests.ts` (11, yes-API). Green bar: 4 typechecks + 80 no-API
suites / 4,769 + property harness (5,636) + all yes-API integration suites green.

**Shipped this close-out:**
- **F3** §1250/28% loss-absorption — a coexisting LT loss erodes the 28% bucket first, then §1250;
  bounded by `grossPositiveLt` (undercount-only → never under-tax).
- **E2** MFJ per-spouse Sch SE — opt-in `spouse` tag on a self_employment_income adjustment
  (migration 0014); default stays the conservative over-tax.
- **S10 WV SS** — HB 4880 phase-out 35%/65%/100% above $50k/$100k AGI; 100% exempt at/below the floor.
- **M3 MA mandate** — TY2024/2025 6-tier schedules from MA DOR **TIR 24-1 + TIR 25-1** (primary-source).
- **MD-08** — Anne Arundel + Frederick GRADUATED local brackets (new `localBrackets` on LocalityInfo).
- **M4** — CA mandate FTB 3853 household-size filing threshold + §5000A bronze cap counts ≤5.
- **SCH1** — T1.1 outputs persisted (migration 0015, 4 cols) + openapi TaxReturn + ClientDetail card.
- **PDF2** — summary PDF nets §72(t)/HSA/Sch-H out of "regular tax" + discloses §1250/28%/mandate.
- **FE1** — H5 Assets dialog money fields → `<CurrencyInput>`. **FE3** — `amendDeltaClass`/`yoyDeltaClass`
  (refund/credit/deduction green-on-increase, tax/income red-on-increase; 1040-X 3 tables + year-compare).
- **CF3** — §469(i)(5)(B) MFS-lived-with-spouse barred from the $25k allowance ($0).
- **E4** — §219(g)(7) spouse-covered IRA phase-out band (migration 0016 + ClientForm checkbox).
- **A3** — no fix needed (pipeline auto-derives `priorYearItemized` → §111 applies).

**Recommended next:** the T0.3 audit is fully closed. The highest-leverage next move is the
differential-oracle layer (T0.3 A2/A3 — wire OpenTaxSolver/ustaxes/tenforty + the IRS ATS scenarios as
a second oracle) to promote `tax-engine-property-harness.ts` from a self-consistency harness to an
oracle-backed CI suite. Then resume MASTER-TODO T1.2/T1.3 (§280F luxury-auto, Form 2210 annualized,
the detector-promotion / multi-year-optimizer planning work).

---

# Handoff Note — 2026-06-08g (FIX-ALL pass on the full-app-audit findings — 10 more commits shipped + deployed + prod-verified)

Worked every remaining deferred finding from the 2026-06-08f audit (ledger:
`docs/accuracy-audit/full-app-audit-2026-06-08.md`). **10 commits on `main`
(`335bde7`..`50d0083`, all pushed + deployed: api-server rebuilt, migrations 0012+0013
applied, frontend rsynced, re-scored, healthz ok). 80 no-API suites / 4,769 + the property
harness (5,636 runs) + all 12 integration suites green; prod-smoked.** Every value hand-calc'd
vs the IRS/state primary source; each fix has a regression in `tax-engine-audit-2026-06-08-tests.ts`
(now 64 assertions).

**Shipped (the under-tax / wrong-number bugs):**
- **E3b** dependent/kiddie §63(c)(5) limited std deduction — was a full-std-ded under-tax of children
  with unearned income, LOCKED BY a wrong-expectation test (deep-audit K8a-d + cpa-S7 reworked). New
  `claimedAsDependent` client field (migration 0012). Prod-smoked: kiddie $10k interest → $2,498.
- **C1** credit ordering — CTC now applied AFTER the Schedule-3 personal credits per the Sch 8812
  Credit Limit Worksheet (dep-care/education no longer wasted; CLAUDE.md invariant #2 corrected).
- **C3** AMT MFS §55(d)(3) phantom add-back. **C4** IRA-deduction MAGI adds back SLI+FEIE (Pub 590-A).
  **CF2** auto-load NOL/§163(j) carryforwards. **E1** EITC qualifying-children (new field, migration 0013).
- **A1** 1098 Box 4 nets the mortgage-interest deduction; **A2** 1099-INT Box 2 above-the-line deduction.
- **State:** KY 2025 = 4.0% (was wrongly 3.5% — that's the 2026 rate; HB1) + KY 2026; MN removed from
  the federal-conforming set (own std ded $14,950); AZ added (ties to federal); MA surtax 2025
  $1,083,150; MD/IN county rates; DC/CA individual-mandate year-indexing (DC was wrongly frozen $695).
- **L1** NYC EIC rebuilt to the IT-215 staircase + interpolation + 10% floor; **L1b** — fixing L1
  exposed a worse bug: the NYC EIC was being subtracted from EVERY locality's tax (MD/PA/OH) → now
  gated to NYC only (fixed cpa-S17 MD-Montgomery $627.78 → the correct $1,105.60).
- **Planning** Q1 (Saver's $0-collapse), Q2 (EV false "engine-verified"), Q4 (§139 false-positive).
- **Forms/UI:** PDF1 (1040 substitute Lines 20-24/33), PDF3 (Form 2210 adoption), FE2 (36 missing
  TYPE_LABELS), FE4 (fmt NaN guard).

**Deliberately DEFERRED (documented, all CONSERVATIVE/over-tax OR needing a new structural path —
NOT silently dropped):** F3 §1250 loss-shielding (conservative over-charge; exact fix risks under-tax),
E2 MFJ-SE attribution (conservative; 1099-NEC-spouse-tag workaround), WV SS phase-out 2024/25 (narrow
under-tax; needs a year+floor+% handler), MD Anne Arundel/Frederick graduated brackets, MA mandate
>300% FPL schedule (provisional), PDF2/SCH1/FE1/FE3 (SPA cosmetic — Haven replaces the SPA).

**Lesson reconfirmed:** the /code-review on the FIRST audit ship caught a real incomplete fix (2 more
case-sensitive `formType` sites my solo pass missed). Run /code-review on engine changes before done.

**Recommended next:** the deferred items are all conservative or structural — none is a fresh under-tax
except WV SS (narrow). The highest-leverage next move is the T0.3 differential-oracle layer (A2/A3 —
OpenTaxSolver/ustaxes/tenforty + the IRS ATS scenarios) to promote the property harness to a full
oracle-backed CI suite.

---

# Handoff Note — 2026-06-08f (FULL-APP MAXIMUM AUDIT — T0.3 — 14-agent fleet + machine harness; 3 commits shipped + deployed + prod-verified)

Ran the full-app maximum audit: a **14-agent fresh-fleet fan-out** (one per subsystem, each
verifying every numeric rule vs the IRS/state PRIMARY SOURCE) + a new **machine-driven fast-check
harness** (property/fuzz/boundary/metamorphic) + the **integration suites** + an in-session
**/code-review max**. **3 commits on `main` (`5fdb104` Set A, `f2cb6b7` Set B, `d0914fe` Set C),
pushed, deployed (api-server + frontend rsync, healthz ok, re-score 0-drift), PROD-SMOKED.
80 no-API suites / 4,769 green + harness 5,636 runs + 12 integration suites green.** Full findings
ledger (severity/file:line/repro/fix for ALL findings, shipped + deferred): **`docs/accuracy-audit/full-app-audit-2026-06-08.md`**.

**SHIPPED (every value hand-calc'd vs primary source):**
- **F1 (CRITICAL)** — AI-extracted-then-approved 1099s were stored UPPERCASE (`ApproveExtractionBody`
  enum) while the engine filtered lowercase → **every AI-approved 1099's income silently dropped.**
  Fixed all 3 `formType` read-sites case-insensitive + lowercase at the write seam. (The /code-review
  caught 2 sibling sites my first fix missed — `:1985` MFJ-SE $7,064 + `:1460` DIV cap-gain $10k.)
- **F2 (CRITICAL)** — AMT omitted the Form 6251 line-2a **standard-deduction addback** (§56(b)(1)(E));
  a std-ded filer who hit AMT had AMTI understated by the full std ded. Federal-only (state CA/MN AMT
  kept on the shared prefs — they add back their own std ded). 22 AMT test expectations re-hand-calc'd.
- **C2** NIIT §1231 non-passive exclusion capped at the surviving disposition gain (was wiping
  unrelated NII). **F4** MFS LTCG breakpoint $291,850. **F5** W-2 val TY2026 SS base $184,500.
- **SEC1/2/3 (DoS/totality)** — `toNum` clamps ±1e13 (engine can't emit NaN/Infinity even on garbage —
  Haven seam); `horizonYears` bounded (openapi max 75 + rothOptimizer clamp — was an unauthenticated
  ~200M-engine-run hang); effRate sub-dollar guard; dropped console.warn from the pure seam.
- **6 state rates, each DOR/statute-verified** — WI 2024 3.54%/4.65%→3.50%/4.40% (every WI filer);
  ID 5.8%→5.695%(2024)/5.3%(2025); CO 4.4%→4.25%(2024 TABOR); SC 6.4%→6.2%(2024)/6.0%(2025);
  OH top 3.5%→3.125%(2025)/flat 2.75%(2026); NE top 5.84%→5.20%(2025). 11 state-test expectations re-calc'd.
- **Q3** Saver's Credit (G1.31) now reads the engine's year-indexed `SAVERS_CREDIT_TIERS` via the new
  `saversCreditRateFor()` (was a stale TY2024-only band map → mis-rated TY2025+).
- **New tests:** `tax-engine-audit-2026-06-08-tests.ts` (31) + `tax-engine-property-harness.ts`
  (fast-check; a T0.3 Phase-A1 deliverable). The harness independently surfaced SEC1 (the -1e308
  overflow) + the effRate denormal + the PTC repaymentCap=Infinity sentinel.

**Prod smoke proved live:** F2 amtTax $72,337.50 (pre-fix $68,249.50); WI $50k stateTax $1,758.88
(pre-fix $1,800.41).

**DEFERRED — prioritized (top of the ledger; each has a repro + fix):** (1) **E3b dependent/kiddie
std deduction** §63(c)(5) — HIGH under-tax + LOCKED BY A WRONG-EXPECTATION TEST (deep-audit K8a-d);
(2) **C1 credit ordering** (CTC before Sch-3 credits wastes dependent-care/education); (3) **C4 IRA-MAGI
SLI/FEIE add-back**; (4) E1 EITC child count; (5) A1/A2 AI 1098-Box4 + 1099-INT-Box2; (6) PDF1 Form-1040
substitute lines; (7) surface T1.1 outputs in openapi+UI; (8) planning Q1/Q2/Q4; (9) CF2 NOL/§163(j)
auto-load, C3 AMT-MFS, E2 MFJ-SE; (10) F3 §1250-loss-shielding (conservative), more states (MN/MA/AZ/WV/KY),
NYC-EITC, MD/IN county, DC/CA mandate. **Security:** the API-security fan-out agent did the comprehensive
pass (no CRITICAL/HIGH; all gates verified; unbounded-input finding shipped as SEC1/2/3).

**Recommended next:** **E3b** (the dependent-std-ded under-tax that's locked by a wrong test — exactly
the "tests passing on wrong expectations" class John hates), then **C1 credit ordering**. Both are real
filed-number bugs; both need careful test rework (do them with /code-review before calling done).

---

# Handoff Note — 2026-06-08e (MASTER-TODO **T1** engine-perfection session — T1.1 fully closed + high-value T1.2/T1.3 slices; shipped + pushed)

Worked the MASTER-TODO **T1 — PERFECT THE ENGINES** tier. **3 commits on `main`
(`2cb182d` T1.1, `94f70a4` T1.2, `8c529b1` T1.3), pushed. No-API battery 79 suites /
4,754 green (+161). Typecheck + CI test-typecheck clean. DB migration 0011 (additive,
2 nullable cols) pending the prod deploy's `drizzle-kit migrate` step.**

**What landed (all hand-calc'd against IRS/state primary sources; zero regression — the
special-rate path is gated so the prior 4,593 assertions are byte-for-byte unchanged):**
- **T1.1 — ALL FOUR latent correctness bugs fixed** (a client got a wrong number today):
  - §1(h) **Schedule D Tax Worksheet** — unrecaptured **§1250 (25% cap)** + **collectibles
    (28% cap)** buckets in `calculateFederalTaxWithCapitalGains` (rates are CAPS, not floors;
    stack above the 0/15/20 gain). Inputs: per-lot `capitalTransactions.gainClass` /
    `unrecaptured1250Amount` (new DB cols) + the `unrecaptured_section_1250_gain` /
    `collectibles_28_rate_gain` adjustments + Form 4797.
  - New `form4797.ts` — **§1231/§1245/§1250 + Form 4797**: §1245 full recapture + §1250
    excess recapture → ordinary; unrecaptured §1250 → 25% bucket; net §1231 gain→LTCG /
    loss→ordinary (full, no $3k cap); §1231(c) 5-yr lookback. `TaxReturnInputs.form4797` +
    `section_1231_lookback_loss` adjustment.
  - New `stateMandate.ts` — **CA/NJ/RI/DC/MA individual-mandate penalty** via
    `months_without_minimum_coverage`; folds into stateRefundOrOwed + effective rate.
- **T1.2 (partial)**: new `scheduleH.ts` **household-employment (nanny) tax** (FICA + FUTA +
  0.9%) via `household_employee_cash_wages`; **clergy housing allowance** (`clergy_housing_allowance`
  → SE base only, income-tax-exempt per §107/§1402(a)(8)).
- **T1.3 (partial)**: new `planningCalendar.ts` **deadline-aware planning calendar**
  (`strategyDeadline` classifier + `buildPlanningCalendar`); `OpportunityHit.deadline`
  attached by the engine; new `GET /api/clients/:id/planning-calendar`.

**New tests (4 files, +161):** `tax-engine-section1250-1231-tests.ts` (79),
`tax-engine-state-mandate-tests.ts` (31), `tax-engine-scheduleh-clergy-tests.ts` (19),
`tax-engine-planning-calendar-tests.ts` (32). All registered in `scripts/tsconfig.json` +
auto-run by `run-no-api.ts`.

**Deferred + documented in `docs/MASTER-TODO.md`** (NOT silently dropped): **§280F** luxury-auto
caps (deep change to the 108-test `computeScheduleCAssetDepreciation` — give it its own pass),
Form 2210 annualized method, digital-assets/1099-DA, per-property suspended-loss storage,
statutory-employee Sch C routing, broader state AMT/sourcing depth, carryforward audit;
T1.3 detector-promotions + multi-year/strategy-combo/Monte-Carlo optimizers + what-if UI +
estate/gift touchpoints; **business returns (1065/1120/1041) remain a founder scope decision.**

**Watch-outs:** **MA mandate 2024+ monthly amounts are PROVISIONAL** (seeded with the confirmed
2023 schedule; tests assert TY2023 only) — confirm against the annual MA DOR TIR before relying
on a MA 2024/2025 mandate number. The per-lot §1250/collectibles + Form-4797 inputs are
engine/Haven-ready; the live Option-A overlay path is the **adjustment** channel (zero-schema,
works today) — a bespoke Form 4797 entry UI was intentionally NOT built (Haven's portals replace
the SPA). **Recommended next:** the T0.3 large accuracy-audit campaign (it will exercise these
new rate buckets hard), or §280F as a focused follow-on.

**POST-SHIP INDEPENDENT REVIEW (same session, commit `f863b9c`, redeployed + prod-verified
HEAD f863b9c).** Ran a memory-safe multi-agent review (3 fresh reviewer agents + in-session
/code-review + /security-review + /verify) over the T1 diff. It found **2 real HIGH
capital-gains bugs my solo tests missed** — both fixed with hand-calc'd regressions:
(1) §1250/28% were taxed via a per-layer min(rate, marginal-ordinary) that UNDER-taxed a
special layer pushed into a sub-25/28% bracket while the global floor was slack (ord $20k +
reg-LTCG $20k + §1250 $40k: $10,253 vs correct $12,168). IRC §1(h)(1)(E)/(F) + the Schedule D
Tax Worksheet use FLAT 25%/28% with the cap enforced only by the global final-min — fixed to
flat. **NOTE: test W6 had asserted the WRONG per-layer value (4,685) — corrected to 6,000.**
(2) Loss-absorption ordering was reversed (preserved 28%, clipped §1250 → OVER-taxed); the
28%-Rate-Gain worksheet offsets losses against the 28% gain first — fixed (§1250 first claim).
Plus 2 LOW fixes (clergy→Sch-C-QBI ½-SE over-reduction; mandate `method`="bronze_cap") and 2
documented conservative §1231 sub-gaps (loss not in §461(l) auto-agg; gain unconditionally in
NIIT). Battery 4,754 → **4,761** green. **Lesson: this is the author's-blindness gap — solo
hand-calc'd tests passed on a wrong expected value; independent review caught it. For the next
big engine change, run /code-review + a few fresh review agents (or /code-review ultra) BEFORE
calling it done.**

**FULL 9-ANGLE /code-review max (same session, commit `2f584a7`, redeployed HEAD 2f584a7).** Ran
the code-review skill AS DESIGNED — 9 finder-angle agents (A-E correctness + reuse/simplification/
efficiency/altitude) in parallel. Found **2 more correctness items** my round-1 (4-agent) pass
missed, both fixed + hand-calc-tested: (1) **AMT asymmetry** — the regular-tax §1250→25%/
collectibles→28% fix left Form 6251 Part III taxing the same gains at 0/15/20%, under-stating TMT;
threaded the buckets into calculateAmt (AMT1/AMT2 tests). (2) **§1231 gain unconditionally in NIIT**
— added an opt-in `nonPassive` flag (§1411(c)(1) active-business exclusion; N1 test). Battery
4,754 → **4,769**. Two fresh agents AGAIN split on flat-vs-per-layer §1250 (the seductive "25% is a
per-bracket cap" fallacy) — re-adjudicated via IRC §1(h)(1)(E) "25 percent of" → flat is correct,
my fix stands. REFUTED: §1202 (engine's qsbsTaxableGain = over-§1202-cap regular LTCG, not the
28%-rate remainder), FUTA falsy-zero. **Documented/deferred sub-gaps:** clergy/K-1 QBI ½-SE
attribution, exports missing Schedule-H/mandate/4797 line items, 1040-X other-taxes bucket for
Schedule H, top-level finite-guard for absurd inputs (T0.2). **Meta-lesson reinforced: even after a
4-agent review, the FULL 9-angle fan-out found 2 more real bugs — the cross-cutting AMT one needed
the cross-file angle specifically.**

---

# Handoff Note — 2026-06-08d (AI extraction: auto-apply info-returns on approve — shipped + deployed + prod-smoked)

Closed the downstream gap from 2026-06-08c: approving an extracted information return now
APPLIES it to the return instead of re-keying. **1 commit on `main` (`ef86a7a`), pushed,
deployed (api-server + frontend rsync, healthz ok), PROD-SMOKED end-to-end. No-API battery
75 suites / 4,593 green (+23). No migration.**

- **`mapInfoReturnToInputs`** (documentExtractor.ts, PURE): reviewed boxes → engine
  adjustments and/or client-field patches per infoType. 1098 → `mortgage_interest`
  (+ `state_property_tax`); 1098-T → `qualified_education_expenses_aoc` (Box1−Box5 floored);
  1098-E → `student_loan_interest`; 1095-A → client `aca{AnnualPremium,AnnualSlcsp,AdvanceAptc}`;
  SSA-1099 → client `socialSecurityBenefits`; W-2G → `additional_income` (+ `withholding_adjustment`).
  Only positive boxes map (never overwrites a client field with 0).
- **Approve handler** — new `recordType: "info_return"` branch: inserts N adjustments
  (category "ai_extracted", isApplied) + patches client columns + links the doc + audits +
  recalcs, all transactional. openapi (recordType enum + info-return fields) + codegen.
- **ReviewExtractionModal** renders the per-infoType boxes for review (infoType from the
  model's ID, falling back to the upload documentType) + the form label + an applied-as note.
- **+23 tests** (17 mapping + 6 end-to-end through computeTaxReturnPure proving each chosen
  adjustmentType hits the right lever: 1098-E drops AGI exactly $2,000, W-2G adds income +
  withholding, SSA-1099 → Pub 915 taxable SS, 1095-A → PTC).
- **PROD smoke (throwaway client, cleaned up):** SSA-1099 approve → `social_security_benefits
  = 24000`; 1098 approve → `mortgage_interest 8200` + `state_property_tax 5400` (applied);
  both docs `approved`/`info_return`. The extract→review→approve→engine pipeline is now
  CLOSED for all 6 forms.

## Honest notes / remaining tails
- Documented sub-gaps in `docs/doc-type-coverage.md`: 1098 points (Box 6, amortization
  nuance — CPA adds manually); 1098-T AOC-vs-LLC (defaults AOC); 1095-A monthly (engine uses
  annual totals); adjustments are year-agnostic (the adjustments table has no taxYear, same
  as manual entry).
- The new ReviewExtractionModal info-return path typechecks + Vite-builds + is deployed; the
  live browser render of the review modal for a new form was not separately screenshotted
  (the approve API path IS prod-verified end-to-end).

---

# Handoff Note — 2026-06-08c (AI extraction: doc-type coverage +6 forms + LIVE benchmark run — shipped + deployed)

Did the two AI-extraction items from product-todo P2. **4 commits on `main` (`290c9ee`,
`78f5c4f`, `baeade8`, `375aa72`), pushed, deployed (api-server + frontend rsync, healthz
ok). No-API battery 75 suites / 4,570 green (+39).**

- **Doc-type coverage +6 forms** (`78f5c4f` + `baeade8`) — unified information-return
  extractor `extractInfoReturnFromFile` for **1098 / 1098-T / 1098-E / 1095-A / SSA-1099
  / W-2G**: one vision call identifies the form from its header (`infoType`) + extracts
  the boxes (IRS 2024 layouts) with bounding boxes + confidence + the prompt-injection
  field-whitelist defense. `validateInfoReturn` (@workspace/validation) does box
  arithmetic (SSA-1099 Box5=Box3−Box4, W-2G withholding≤winnings, 1095-A APTC≤premium,
  1098-T scholarships>tuition, 1098-E §221 cap, 1098 refund>interest, TIN/year). 6 new
  `documentType` enum values route to it; upload dropdown updated. 39 deterministic tests
  (normalizer + every validation rule — no API key needed). Downstream auto-create-on-
  approve is the documented next increment (`docs/doc-type-coverage.md`); today they
  extract + show for CPA review.
- **AI benchmark — RAN IT LIVE** (`290c9ee` + `375aa72`) — against the prod Gemini key
  (synthetic corpus, no PII). The free-tier rate/daily quota blocked a clean 100-doc run
  (429s w/ multi-min backoffs — same wall as 2026-05-23), BUT **every W-2 the model
  processed scored 12/12 fields (100% precision + per-field recall)** — incl. masked SSN
  last-4, exact cents, and the $168,600 SS-wage-base cap (Box 1 ≠ Box 3 read correctly).
  That's up from 2026-05-23's 77.7% recall / 0.865 F1 → **validates the P2-10 recall-hint
  prompt fix closed the recall gap**. Partial + analysis in
  `docs/ai-benchmark/live-partial-2026-06-08/`. Harness hardened: retries transient 5xx
  (a 503 burned a doc) + new `--limit=N` / `--per-kind=N` flags.

## Honest notes
- **The full 100-doc LIVE benchmark is still not done** — blocked by the free-tier quota
  (needs paid quota or a fresh free-tier window; ~11 min at the default 6.5s pace). The
  W-2 cohort (small-n) is a strong real signal; the 1099 cohort wasn't reachable before
  the quota wall (same as 2026-05-23).
- **The 6 new doc types EXTRACT + show for review but don't auto-create downstream
  records on approve** (the approve flow only makes w2/form1099 records). The field→engine
  mapping is documented in `docs/doc-type-coverage.md` as the next increment.
- New doc-type UI = 5 dropdown SelectItems (live-deployed); not separately browser-tested
  (trivial additive change).

---

# Handoff Note — 2026-06-08b (All 4 remaining multi-state items — CT pension/IRA, NR per-type plumbing, +17 NR states, lane C — shipped + deployed)

Cleared the entire remaining multi-state backlog in one session — the four items the
2026-06-08 handoff listed as "what's left." **4 commits on `main` (`d263e95`, `f65d41b`,
`0697e78`, `22c0422`), pushed, deployed to EC2 (migration 0010 applied, api-server +
frontend rsynced, healthz ok, re-score 0-drift across 10 returns; endpoints 200).
No-API battery 74 suites / 4,531 assertions green (+92).** Every state value hand-calc'd
against the primary source (DOR form/worksheet) before asserting.

## What shipped (each its own commit + hand-calc'd tests)
- **CT pension/annuity + IRA exclusion** (`d263e95`, lane B) — Conn. Gen. Stat.
  §12-701(a)(20)(B); CT-1040 Pension & Annuity Worksheet (PyMuPDF-extracted from the
  CT-1040NR/PY 2024 instructions, Page 28). The engine taxed 100% of CT pension/IRA
  before (over-taxing every CT retiree). Now: `(100% pension/annuity + IRA% × non-Roth
  IRA) × phase-out decimal`. IRA% year-indexed (50/75/100% for 2024/25/26, new
  `CT_IRA_EXCLUSION_PCT: Record<TaxYear>`); phase-out from the statutory table
  (single/MFS/HoH $75k→$100k, MFJ/QSS $100k→$150k — HoH is single-like here, DIFFERS
  from CT SS). IRA portion via a new `ct_ira_distribution` adjustment marker (no DB
  change; mirrors NY/HI carve-out). 20 tests (`tax-engine-ct-retirement-tests.ts`).
- **NR per-type-source plumbing** (`f65d41b`) — wired the existing-but-unreachable
  `perStateNonResidentOtherSourced` engine option to a CPA path. New opt-in
  `nonresident_source_allocation` marker: on a FULL-YEAR resident, sources out-of-state
  K-1 business (Box 1) + rental real estate (Box 2/3 + rentalProperties net) by each
  fact's `sourceState`. §114 by construction (intangibles/retirement never sourced).
  10 e2e tests (`tax-engine-nr-source-plumbing-tests.ts`).
- **+17 method-(a) NR states** (`0697e78`) — `NR_AS_IF_RESIDENT_STATES` now 25 states.
  A background agent classified all remaining states vs their NR forms; I re-verified
  (probed every engine value, confirmed method-a > fallback, form-line cites inline).
  Added graduated AR/DE/ME/MO/MT/NE/NM/OK/OR/RI/VT/WI + flat CO/IA/KS/LA/ND. Guarded
  exclusions: SC (genuine method b), UT (no-op — engine std ded 0), KY/ID/AZ/MI/IN
  (flat method b), DC (no NR tax). +38 assertions.
- **Lane C** (`22c0422`) — (a) `CapitalTransaction.propertyStateSitus` (new column,
  migration 0010 additive) routes a real-property capital GAIN to its situs state (with
  the marker); intangible gains excluded (§114(a)). (b) Opt-in `part_year_income_pct_method`
  marker → the part-year RESIDENT-period tax in a method-(a) state uses IT-203/540NR
  `tax-as-if-full-year-resident(total) × (period/total)` instead of day-prorated direct
  brackets (which under-tax). Both default-off → zero change to existing returns. +10 tests.

## Honest notes / remaining tails
- The 4 new markers + propertyStateSitus column are API-settable + engine-wired +
  prod-verified via the re-score (full pipeline ran clean on 10 real returns), but a
  dedicated capital-transaction UI field for propertyStateSitus was NOT added (per the
  "don't invest in SPA forms" frame — Haven builds its own; the field is in the API/
  Create/Update bodies). The 4 adjustment markers DO appear in the ClientDetail dropdown.
- CT military/RR-Tier/CT-teacher retirement carve-outs (separate CT lines) are a
  documented sub-gap — the CPA nets them out of the retirement bucket.
- Part-year income-% is OPT-IN (not default) because the part-year path has other
  documented simplifications; forcing it would shift existing hand-calc'd part-year tests.
- NR source for non-K1/non-rental items (e.g. 1099-NEC services in another state) still
  needs the per-state amount entered via a K-1/rental/propertyStateSitus fact; an
  arbitrary per-state input would need an AdjustmentFact schema extension (no state field today).

---

# Handoff Note — 2026-06-08 (Lane A: GA/NC/OH added to the NR tax-ratio method — shipped + deployed)

Picked lane A from the 2026-06-06k handoff: batch more states into `NR_AS_IF_RESIDENT_STATES`,
each only after verifying it uses the TAX-RATIO method (a) against its actual NR-form line
flow. **1 commit on `main` (`2db174f`), pushed, deployed to EC2 (engine-only: pull → build →
pm2 restart, healthz ok, migration no-op, re-score 0-drift across 10 returns). No-API battery
72 suites / 4,453 assertions green (+14).**

- **Added GA + NC + OH** → `NR_AS_IF_RESIDENT_STATES` is now {CA,NY,CT,NJ,MN,GA,NC,OH}.
  Each web-verified against its official NR form (.gov instructions) for method (a) — NR tax
  = tax(TOTAL income as-if-resident) × (state-source/total):
  - **GA Form 500 Schedule 3** (IT-511): Line 9 ratio = GA-source/total; Line 13 prorates
    deductions by it. GA is FLAT 5.39%, so `r·(source − D·ratio) = r·(total − D)·ratio` =
    method a EXACTLY. Worked example $90k GA + $30k TX → $5,821.20 × 0.75 = **$4,365.90**.
  - **NC D-400** (D-401): Line 14 = taxable income on TOTAL × Line 13 "taxable %" (Sched PN =
    NC-source/total); flat 4.5%. Worked example $80k NC + $40k TX → $4,826.25 × ⅔ = **$3,217.50**.
  - **OH IT NRC**: nonresident CREDIT = tax(OAGI) × (non-OH/OAGI) ⇒ OH tax borne = tax(total)
    × (OH-source/OAGI) = method a; the graduated 0/2.75/3.5% schedule makes it materially >
    the source-only fallback. Worked example $90k OH + $30k TX → $2,733.625 × 0.75 = **$2,050.22**.
  - All three previously hit the conservative fallback (direct brackets on source income),
    which hands the NR the FULL std ded (GA/NC) or the whole zero/low bracket (OH) against
    source-only income — under-taxing. Method (a) correctly prorates. Verified the deltas:
    GA +$161.70 = 5.39%×$12k×0.25; NC +$191.25 = 4.5%×$12,750×⅓; OH +$291.59 (bracket effect).
- **MD deliberately EXCLUDED + test-guarded**: Form 505NR is method b (prorates deductions
  by the income factor, applies the GRADUATED rate to MD-SOURCE income — lands in lower
  brackets than method a) AND adds a 2.25% SPECIAL NONRESIDENT TAX in lieu of county tax
  (Line 32b) the engine doesn't model. A set-addition would both mis-method AND silently
  omit 2.25% of MD taxable income, so a MD NR stays on the conservative direct-bracket
  fallback (locked by a test).
- +14 hand-calc'd assertions in `tax-engine-nr-sourcing-tests.ts` (now 35 total).

## Remaining P1 sub-items (unchanged from 2026-06-06k, minus GA/NC/OH)
- **More NR states** — same per-form method-(a)-vs-(b) verification cycle. VA + AL/HI/IL/MA/
  MS/WV are confirmed method (b) → do NOT add. Other states need the NR-form check before adding.
- **CT pension/annuity + IRA exclusion** — ENGINE-LIMITED (needs a pension-vs-IRA split of the
  single retirement bucket + the bracketed phase-out table).
- **IN unemployment-comp deduction** — minor; needs the IN rule sourced.
- **NR per-type source plumbing** — the engine fn (`perStateNonResidentOtherSourced`) is done +
  tested; needs a CPA-input path to set it e2e.
- **Part-year as-if-resident income-% method**; **`CapitalGainTransaction.propertyStateSitus`** —
  bigger multi-step engine changes.

---

# Handoff Note — 2026-06-06k (Remaining-P1 sub-increments: WI all-statuses std-ded + NJ/MN NR sourcing — shipped + deployed)

Worked the "remaining P1" partial items. **4 commits on `main` (`5817b07` WI,
`b457ce2` NJ, `72c0ce0` MN, `21a0b5b` docs), pushed, deployed to EC2 (engine-only:
api-server rebuilt + pm2 restarted, healthz ok). No-API battery 72 suites / 4,439
assertions green.**

- **Diagnostics doc-drift fixed**: product-todo line 76 marked the diagnostics
  engine unchecked though the MVP shipped 2026-06-06 (P2-16); corrected to [~] with
  the MVP scope + the fuller-version remainder.
- **WI MFJ/HoH/MFS sliding-scale std deduction** (`5817b07`): closed the documented
  WI sub-gap (the 3 non-single statuses were stuck at max, over-deducting). Reverse-
  derived the per-status (max, threshold, rate) from the 2024 WI Form 1 Standard
  Deduction Table (PyMuPDF-extracted) and VERIFIED to reproduce the published table
  to the dollar across all 276 income brackets. HoH is two-tier (max(single, 22.5%
  line)). +5 hand-calc'd tests. (HoH/MFS still use single WI brackets — a separate
  pre-existing bracket sub-gap.)
- **NJ + MN added to NR_AS_IF_RESIDENT_STATES** (`b457ce2`, `72c0ce0`): now
  {CA, NY, CT, NJ, MN}, each method-(a)-verified against its NR form (NJ-1040NR Line
  40×41→42; MN M1NR Line 30×31→32). Hand-calc'd worked examples (NJ $4,910.03; MN
  $6,052.27). +7 tests.

## Remaining P1 sub-items (honest — research-careful / engine-limited / multi-step)
- **More NR states (GA/MD/OH/NC)** — each needs a per-form method-(a)-vs-(b)
  verification cycle (fetch the NR instructions → PyMuPDF-extract → confirm the
  tax-ratio line flow → add + worked example). Proven fast pattern; a fresh session
  can batch them. Do NOT add a state without confirming method (a) (over-tax risk).
- **CT pension/annuity + IRA exclusion** — ENGINE-LIMITED: needs the bracketed
  phase-out table + a pension-vs-IRA split the engine's single retirement bucket
  can't make (a schema change to split retirement income by type).
- **IN unemployment-comp deduction** — minor; needs the IN rule sourced.
- **NR per-type source plumbing** — the engine fn (`perStateNonResidentOtherSourced`)
  is done + tested; needs a CPA-input path (a new adjustment/input) to set it e2e.
- **Part-year as-if-resident income-% method** (replace the day-proration);
  **`CapitalGainTransaction.propertyStateSitus`** (auto-route real-estate gains) —
  bigger multi-step engine changes.

---

# Handoff Note — 2026-06-06j (A+B+C batch: mid-quarter MACRS + CT NR sourcing + Schedule C asset live-app path — shipped + deployed)

Did all three of the previously-deferred items. **4 commits on `main` (`1dcaeda`,
`4e0bc01`, `b8c12a8`, `26099a5`), pushed, deployed to EC2 (migration 0009 applied,
api-server rebuilt, pm2 restarted, frontend rsynced). No-API battery 72 suites /
4,427 assertions green; C verified end-to-end in PROD.**

- **(A) Full §168(d)(3) mid-quarter MACRS** (`1dcaeda`): replaced detection-only
  with full computation. `computeMacrsSchedule` GENERATES the Pub 946 tables from
  the IRS algorithm (200%/150% DB → SL switch, convention first-year fraction,
  round-each-year-and-carry, 3-decimal for the 20-yr class). **Verified to reproduce
  Pub 946 Table A-1 (half-year) EXACTLY for all 6 classes** (incl. the 7-yr
  8.93/8.92/8.93 + the 3-decimal 20-yr) — so the mid-quarter output is trustworthy
  without sourcing the (web-unreliable) published mid-quarter tables. The calculator
  runs the 40% test PER placed-in-service year. +46 tests.
- **(B) CT added to the NR tax-ratio method** (`4e0bc01`): NR_AS_IF_RESIDENT_STATES
  = {CA, NY, CT}. CT verified against the CT-1040NR/PY DRS instructions (Line 8 tax
  on full CT-AGI × Line 9 source ratio = method a, NOT the income-ratio method b).
  Documented why VA + AL/HI/IL/MA/MS/WV (method b) and NJ/MN (unverified) are NOT
  added. Hand-calc'd worked example ($5,950 × 0.75 = $4,462.50). +4 tests.
- **(C) Schedule C asset live-app input path** (`b8c12a8` + test fix `26099a5`):
  full new `schedule_c_assets` entity mirroring rental_properties — DB table
  (migration 0009) + schema + pipeline load (by clientId, ALL years for multi-year
  MACRS; engine skips future-placed) + CRUD routes + openapi/codegen + a compact
  "Sched C Assets" tab in ClientDetail (list/add/edit/delete). **PROD-VERIFIED
  end-to-end:** POST a $20k §179 asset on $100k SE → SE tax $14,129.55 → $11,303.64
  (−$2,825.91) → delete → back to $14,129.55. The Schedule C asset calculator is now
  reachable in the live app.

## Honest notes
- `scheduleCDepreciation` is a computed-only field (NOT a persisted column) — observe
  the asset flow via the persisted `selfEmploymentTax`/`adjustedGrossIncome`.
- The "Sched C Assets" UI tab is built + typechecks + Vite-builds + its CRUD endpoints
  are prod-verified; the live BROWSER render of the tab was not separately screenshotted
  (standard rentals-mirroring pattern; low risk).
- Per the "don't invest in SPA forms" frame the UI tab is deliberately compact.

## Verify
typecheck (all projects) + typecheck:tests clean; 72 no-API suites / 4,427 assertions
green; esbuild + Vite clean; deployed (migration 0009, api-server, frontend rsync) +
prod-smoked (healthz, the C CRUD→SE-tax flow end-to-end).

---

# Handoff Note — 2026-06-06h (Schedule C asset-level depreciation calculator — shipped + deployed)

Completed the last item of the 3-task batch (the one 2026-06-06g had deferred):
the Schedule C asset-level §179/bonus/MACRS calculator on the SE side. **1 commit
(`17b8bab`) on `main`, pushed, deployed to EC2 (api-server rebuilt, pm2 restarted,
prod-smoked — NO migration/frontend/re-score: it's inert in prod until the
asset-load path is built). Full no-API battery 72 suites / 4,352 assertions green
(+37).**

- **`computeScheduleCAssetDepreciation`** (taxCalculator.ts) — pure calculator:
  takes a Schedule C asset register (`{cost, recoveryYears, placedInServiceYear,
  section179?, bonus?}`) and computes §179 (dollar cap + investment phase-out
  reusing SECTION_179_CAPS, + the §179(b)(3) BUSINESS-INCOME limit with the
  income-disallowed carryforward) + §168(k) bonus + personal-property MACRS
  (Pub 946 Table A-1, half-year, 3/5/7/10/15/20-yr; every % verified, sums to 100%).
  Reconstructs prior-year bonus via a new `BONUS_RATE_BY_ACQUISITION_YEAR` map to
  get correct multi-year MACRS basis. The total folds into the SE-base-reducing
  `schedule_c_depreciation` total.
- **New `scheduleCAssets` on TaxReturnInputs** (migration-seam contract addition,
  PURE) + **`ComputedTaxReturn.scheduleCAssetDepreciation`** breakdown.
  `scheduleCDepreciation` is now manual `schedule_c_depreciation` + the asset total.
  INERT when no assets supplied (`scheduleCAssetDepreciation` null → unchanged).
- 37 hand-calc'd tests (`tax-engine-schedule-c-asset-depreciation-tests.ts`):
  bonus/MACRS/§179/income-limit/carry-in/multi-year/prior-year-bonus-basis + e2e
  SE-tax delta ($20k §179 → SE tax −$2,825.91), income-limit floor, W-2-lifted
  §179 limit (Reg §1.179-2(c)(6)(iv) → AGI $50k), inert no-assets case.

## Documented follow-ups (engine capability shipped; these are the live-app + parity tails)
- **Live-app input path for `scheduleCAssets`** — a `schedule_c_assets` DB table +
  CRUD API + entry form + a `loadTaxReturnInputs` load path (like scheduleK1).
  NOT built — per the strategic frame the SPA is being wound down and the engine
  ports to Haven 1:1, so Haven builds its own asset-entry UI/persistence. Until
  then the calculator is reachable only via direct `computeTaxReturnPure` calls;
  CPAs enter the computed figure via the live `schedule_c_depreciation` adjustment.
- **✅ §179 carryforward persist + auto-seed — DONE 2026-06-06i (commit `45268bf`,
  migration 0008, deployed).** New nullable
  `tax_returns.schedule_c_section179_carryforward_remaining` + `mapReturn` persist +
  `buildSyntheticPriorYearAdjustments` re-seed as a new
  `schedule_c_section179_carryforward` adjustment (openapi 3 enums + codegen +
  ClientDetail label). The engine now also runs the asset calculator when ONLY a
  carryforward is present (no new assets) so a carried §179 deducts in a later
  year. +8 hand-calc'd tests (C1-C3: deduct-with-no-new-assets, re-limited re-carry,
  full year-N→N+1 roll-forward). The Schedule C §179 carryforward is now at full
  §41/§51 multi-year parity.
- **Modeling bounds (documented in code):** MACRS computed half-year. **Mid-quarter
  (§168(d)(3)) is now DETECTED 2026-06-06i (commit `62dc739`): a per-asset
  `placedInServiceQuarter` + the >40%-of-non-§179-Q4-basis test → a
  `midQuarterApplies` result flag (CPA overrides via `schedule_c_depreciation`); the
  mid-quarter PERCENTAGES (Pub 946 A-2..A-5, ~150 verified values) are the deferred
  completion.** +4 tests (MQ1-MQ4, incl. the §179-exclusion). An asset is either
  fully §179'd OR bonus+MACRS (not partial-§179 + bonus on one asset); basis = cost.
- **✅ OBBBA 100% bonus — DONE 2026-06-06i (commit `94f6dba`, deployed).** New
  per-asset `bonusFullObbba` flag forces 100% §168(k) bonus for post-1/19/2025
  property (OBBBA §70301), removing the conservative-40%-for-all-TY2025 bound
  (mirrors the engine's `bonus_depreciation_basis_obbba`). +6 tests (A9/A9b).
- **H2-wire remaining G1.46–G1.96 — RE-ASSESSED 2026-06-06i (fresh per-detector
  triage): still NOT recommended.** The remaining heuristic detectors are
  qualitative (business credits the individual engine can't compute, trusts,
  multi-entity/§469 elections, multi-year sequencing) or would only re-express a
  GUESSED input amount through the engine (G1.62/G1.76/G1.85 — the agent's
  candidates), which is the "force-wire without modeling the mechanic → risk a
  wrong value" trap. The genuinely-modelable ones were already done
  (§1244/§453/§163(d)/§41/§23/§36B/§51/§45S). Don't force-wire; model the mechanic
  first or leave heuristic.
- **✅ FIXED 2026-06-06i (commit `4fca6aa`, deployed): SECTION_179_CAPS[2024]**
  was holding 2023's values ($1.16M/$2.89M) → corrected to $1,220,000/$3,050,000
  (Rev. Proc. 2023-34 §3.27); both inline comments fixed; map exported. +7 regression
  assertions (all 3 years' cap+phaseStart pinned + a behavioral $1.3M-§179-on-$2M-SE
  → caps at $1.22M). No existing suite shifted (none exercised the >$1.16M boundary).
  Full battery 72 suites / 4,359 green.

---

# Handoff Note — 2026-06-06g (G1.2 PTET regime table + §51/§45S carryforward — shipped + deployed)

Cleared the two real remaining P2 items (the PTET data task + the WOTC/FMLA
carryforward parity gap). **2 commits on `main` (`831b21c`, `d4ec69a`), pushed,
deployed to EC2 (migration 0007 applied, api-server rebuilt, pm2 restarted,
frontend rsynced, re-score 0-drift, prod-smoked). Full no-API battery 71 suites /
4,315 assertions green (+61).** Task 3 (Schedule C asset-level depreciation
calculator) was deliberately SKIPPED per the batch's "lower value — skip if tight"
instruction (see below).

- **G1.2 PTET per-state regime table** (`831b21c`): replaced the flat
  `PTET_ELECTING_STATES` set with `STATE_PTET_REGIMES` (all 50 states + DC,
  `{ hasPtet, topPtetRate, notes }`) — 36 PTET states, each rate hand-verified
  against the statute/DOR (AICPA tracker cross-checked with CrossLink / Smith &
  Howard / EisnerAmper; AZ 2.5%, OH 3%, CO 4.4% confirmed against DOR; per-state
  source in `notes`; verified 2026-06). `detectPtetElection` now values the
  workaround at the REAL rate: `recoverable = min(stranded SALT, active K-1 ×
  state PTET rate)`, fixing the prior all-stranded overstatement for low-rate
  states (CA flat 9.3% on $500k = $46.5k can't recover $50k stranded → G1.2+2
  $12,000 → $11,160). Coordinated with the year-indexed §164(b)(6)+(7) OBBBA
  SALT-cap phase-down. New `tax-engine-ptet-regimes-tests.ts` (48 assertions) +
  freshness note (PTET rates change yearly — re-verify each filing season).
- **§51 WOTC + §45S FMLA carryforward persistence** (`d4ec69a`, migration 0007):
  brought the §51/§45S general-business-credit carryforward to full §39 parity
  with §41/§163(d). New `general_business_credit_carryforward` adjustment added to
  the §51/§45S available BEFORE the §38(c) limit (mirrors `rd_credit_carryforward`);
  new nullable `tax_returns.other_general_business_credit_carryforward_remaining`
  column; `mapReturn` persists + `buildSyntheticPriorYearAdjustments` re-seeds the
  prior-year value (FTC/adoption/rd pattern). openapi (3 enums) + codegen +
  ClientDetail label. +10 hand-calc'd tests in `tax-engine-gbc-wotc-fmla-tests.ts`
  (W4-W6: carryforward-in applied, aggregates with current WOTC, full year-N→N+1
  roll-forward with §39 re-carry; §38 limit measured via the shared §41 path).

## NOT done / deferred (honest)
- **Task 3 — Schedule C asset-level §179/bonus/MACRS calculator on the SE side**
  — DELIBERATELY SKIPPED (the batch ranked it lowest + "skip if context/quality is
  tight"). The tax-relevant core already shipped (`schedule_c_depreciation` reduces
  the SE base, P2-5 2026-06-06f); the CPA enters the computed Form 4562 figure.
  **Why deferred, not rushed:** the existing `calculateMacrsDepreciation`
  (taxCalculator.ts:5020) is REAL-PROPERTY ONLY (27.5/39-yr SL, mid-month). A
  Schedule C calculator needs personal-property MACRS classes (3/5/7/15-yr, 200%DB,
  half-year/mid-quarter), §179 with the **business-income limitation** + disallowed
  carryforward, AND bonus — a correctness-sensitive new subsystem with LOW reuse,
  plus a `TaxReturnInputs` structured-asset input (a migration-seam contract change).
  A half-built §179-only version would be *worse* than the CPA entering the figure.
  Clean scoped follow-up: add `scheduleCAssets: [{cost, classLife, placedInService,
  section179, bonus}]` to TaxReturnInputs → a pure `computeScheduleCAssetDepreciation`
  → route the total into `schedule_c_depreciation` (already SE-base-wired). The
  per-EXPENSE-category P&L breakdown stays out (cosmetic; documented).
- **Schedule C per-EXPENSE-category P&L** — NOT building (aggregate net is the
  tax-relevant figure; documented).

## Verify
typecheck (api-server + tax-app + db + libs + tests) clean; 71 no-API suites /
4,315 assertions green; api-server esbuild + frontend Vite build clean; deployed +
prod-smoked (healthz ok, migration 0007 column present + serializes, planning-opps/
hit-list HTTP 200 over real data, re-score 0-drift across 10 prod returns).

---

# Handoff Note — 2026-06-06f (REST OF P2 — 5 items shipped + deployed)

Cleared the remaining P2 backlog: carryforward auto-seeds, §51/§45S WOTC, the §36B
PTC optimizer, G1.17 data-driven comp + §530 clarification, and the Schedule C
per-line depreciation core. **5 commits on `main`, pushed, deployed to EC2
(migration 0006 applied, api-server rebuilt, pm2 restarted, frontend rsynced,
prod-smoked, re-score 0-drift). Full no-API battery 70 suites / 4,254 assertions green.**

- **Carryforward auto-seeds** (`2f82ebf`, migration 0006): §163(d)(2) disallowed
  investment interest (new `investment_interest_carryforward`, summed into invInt) +
  §39 §41 R&D GBC carryforward (new `rd_credit_carryforward`, added before the §38
  limit). Persisted (2 new tax_returns columns) + auto-seeded from the prior return
  (FTC/adoption pattern). Both new credits now at full multi-year parity.
- **§51 WOTC + §45S FMLA** (`a325212`): CPA-supplied general business credits
  (Form 5884 / 8994 — need employee data the engine can't compute) applied through
  the SAME §38(c) limit as §41, against the REMAINING GBC room (§41 first), with §39
  carryforward. `wotc_credit` / `fmla_credit` adjustments. G1.74/G1.75 stay
  qualitative (no engine computation of the credit → no meaningful promotion).
- **§36B PTC-cliff optimizer** (`79f6ca7`): G1.30 gains an engine-verified what-if at
  a $7,000 deductible IRA — combinedRefundDelta = income-tax saving + the PTC swing
  (the PTC is nonlinear near a band edge). Becomes the actionable headline on the
  per-client path; the |netPtc| reconciliation stands on the firm-wide path (P2-14
  preserved).
- **G1.17 data-driven comp + §530** (`98473ef`): G1.17 S-corp reasonable comp now
  uses a CPA-supplied benchmarked figure (`scorp_reasonable_comp`, an RC Reports/BLS
  result) instead of the hardcoded 40% (kept as a documented placeholder). §530
  Coverdell clarified — NO current-year 1040 effect (non-deductible, tax-free growth),
  so it's correctly informational, not a missed engine credit.
- **Schedule C depreciation** (`5ac953b`): new `schedule_c_depreciation` reduces the
  Schedule C NET PROFIT → SE-tax base + §199A QBI + earned income + §461(l) (unlike
  above-the-line §179/bonus). Closes the documented P2-5 SE-base gap. Per-line P&L is
  now complete (receipts − expenses − depreciation = net SE). $30k dep reduces SE tax
  by exactly $4,238.87; §179 reduces it by $0 (the gap, regression-locked).

## NOT done / honest gaps
- **G1.2 PTET per-state regime split** — needs the AICPA state-by-state PTET data
  (which states, rates, caps, mechanics). Documented as a data task; NOT faked.
- **Schedule C per-EXPENSE-category P&L + asset-level §179/bonus/MACRS calculator on
  the SE side** — NOT modeled (the aggregate net is what's tax-relevant; the CPA
  supplies the computed Form 4562 figure). The SE-base correctness core IS done.
- §45S/§51 carryforward not persisted (surfaced only; the §163(d)/§41 ones are).

## Verify
typecheck (api-server + tax-app + db + libs + tests) clean; 70 no-API suites / 4,254
assertions green; builds clean; deployed + prod-smoked (healthz, migration 0006 both
columns present, re-score 0-drift across 10 returns, planning-opps HTTP 200).

---

# Handoff Note — 2026-06-06e (§41 R&D credit — engine model + G1.36 H2 — shipped + deployed)

Continued the credit-mechanics theme (§23-adoption pattern). The engine had NO §41
modeling; this adds the ASC research credit + the §38 GBC limit, then promotes G1.36.
**1 commit (`91b7105`) on `main`, pushed, deployed to EC2 (api-server rebuilt, pm2
restarted, frontend rsynced, prod-smoked, re-score 0-drift). No migration. Full no-API
battery 68 suites / 4,220 assertions green (+36 this increment).**

- **ENGINE — `calculateRdCredit`** (taxCalculator): Alternative Simplified Credit —
  14% × max(0, currentQRE − 50% × prior-3-yr-avg QRE), or 6% × QRE with no 3-year base
  (startup); the §280C(c)(3) reduced-credit election applied by default (gross ×
  (1 − 21%)) to avoid the QRE-deduction add-back. Wired into the credit pipeline as the
  general business credit (LAST in the nonrefundable order) under the **§38(c)(1)
  liability limit** — the GBC can't reduce regular tax below the tentative minimum tax;
  the excess carries forward (§39). 2 new adjustments (`qualified_research_expenses` /
  `qualified_research_expenses_prior_avg`) + openapi + codegen + ClientForm. **Fully
  gated → zero change to returns without the adjustments** (verified: 214-test core +
  planning suites green). §41(h) payroll-tax election + the regular (non-ASC) method
  documented as out-of-scope sub-gaps.
- **G1.36 promoted**: engine-verified (full §280C-reduced credit, with the
  applied-this-year vs §39-carryforward split shown) when QRE is supplied; heuristic
  netSe-proxy ($3,000) preserved otherwise.
- `ComputedTaxReturn` gains rdCredit / rdCreditApplied / rdCreditCarryforwardRemaining.
- 36 hand-calc'd tests (`tax-engine-section41-rd-tests.ts`): ASC ($11,200 gross →
  $8,848), startup ($6,000 → $4,740), §280C toggle, below-base $0, e2e refund-delta
  identity, the §38(c) TMT-floor limit binding (conservation + bound on a $47,400
  credit), detector engine-verified + heuristic-preserved.

**Credit-mechanics progress:** §23 adoption (P2-13) + §36B PTC reconciliation (P2-14) +
§41 R&D (this) are now real engine credits / engine-verified detectors. The PLAN-Q2
engine-modelable trio (§1244/§453/§163(d)) is also complete. **Remaining credit
mechanics:** §530 Coverdell (G1.59), §45S FMLA (G1.74), §51 WOTC (G1.75), §36B-full
optimizer. **Documented follow-ups:** the §163(d) + §41(§39) carryforward AUTO-SEED
(DB column + pipeline, like FTC/adoption); §41(h) payroll election; §41 regular method.

---

# Handoff Note — 2026-06-06d (§163(d) investment interest + election — engine model + G1.93 H2 — shipped + deployed)

Completed the PLAN-Q2 engine-modelable trio (§1244 / §453 / §163(d)). The engine had
NO §163(d) modeling; this adds the deduction + the election, then H2-wires G1.93.
**1 commit (`10c24d6`) on `main`, pushed, deployed to EC2 (api-server rebuilt, pm2
restarted, frontend rsynced, prod-smoked, re-score 0-drift). No migration. Full no-API
battery 67 suites / 4,184 assertions green (+24 this increment).**

- **ENGINE — §163(d) investment interest (Form 4952)** as a Schedule A itemized
  deduction capped at net investment income (interest + non-qualified dividends + net
  STCG + royalties); the excess is the §163(d)(2) indefinite carryforward
  (`investmentInterestDisallowed`). The **§163(d)(4)(B) election**
  (`investment_interest_election_amount`) treats QDIV/LTCG as ordinary investment
  income — raises the NII cap (frees more deduction) AND re-buckets that amount from
  the preferential to the ordinary rate (reduces BOTH the ordinary-portion split and
  the amounts passed to calculateFederalTaxWithCapitalGains → no double-count). The
  elected amount STAYS in the §1411 NIIT base (it's a §163(d), not §1411,
  characterization). 2 new adjustments (openapi + codegen + ClientForm). **Fully gated
  on the adjustments → zero change to any return without them** (verified: 214-test
  core + Schedule A + preferential suites all green).
- **G1.93 H2-wired**: reads the engine-computed disallowed interest, elects
  min(preferential, disallowed) via an engine-verified what-if; SUPPRESSES when the
  engine shows no benefit (e.g. too little OTHER itemized → the freed interest is
  wasted against the std deduction — the exact error the flat 13.2% heuristic missed).
  Heuristic preserved for the no-baselineInputs (precompute/hit-list) path.
- `ComputedTaxReturn` gains investmentInterestDeduction / investmentInterestDisallowed
  / investmentInterestElectionAmount.
- 24 hand-calc'd tests (`tax-engine-section163d-tests.ts`): deduction cap, the election
  ($6,000 = $40k × 15% preferential, freed-deduction offset), std-floor waste (no
  benefit), election capped at preferential, NIIT-unchanged, and the detector's what-if
  cross-checked vs an independent elect-vs-no-elect engine run.

**PLAN-Q2 TRIO COMPLETE (§1244/§453/§163(d)).** Remaining credit mechanics (need
calculate* support first, §23-adoption pattern): §41 R&D (G1.36), §530 Coverdell
(G1.59), §45S FMLA (G1.74), §51 WOTC (G1.75). Documented follow-up: §163(d) disallowed-
interest carryforward AUTO-SEED (a DB column + pipeline wire, like FTC/adoption); the
§1411 NII investment-interest net-down (a pre-existing engine simplification).

---

# Handoff Note — 2026-06-06c (§453 installment sale — H3 multi-year wiring — shipped + deployed)

Completed the §1244/§453 pair (the 2026-06-06b §453 "deferred" note is now SUPERSEDED).
**1 commit (`264e607`) on `main`, pushed, deployed to EC2 (api-server rebuilt, pm2
restarted, frontend rsynced, prod-smoked, re-score 0-drift). No migration. Full no-API
battery 66 suites / 4,160 assertions green (+16 net this increment).**

- **New `long_term_capital_gain` adjustment** — a general "additional LTCG" lever injected
  into Schedule D netting at the LTCG aggregation point (cross-nets STCG + $3k offset +
  carryforward; flows to AGI + preferential rate + §1411 NIIT + §199A(e)(3) QBI cap).
  openapi enum + codegen + ClientForm label. **No DB column** (adjustment types are
  API-layer enums, never persisted as columns). CPA-enterable; also the lever the §453
  what-if injects per year.
- **G1.47 §453 — H3 multi-year wired** via `runDetectorMultiYear`: baseline recognizes the
  full gain in year 0, scenario spreads gain/N over the 5-year horizon — SAME total gain,
  so the delta is the honest bracket-smoothing benefit (the deferred gain IS taxed later;
  this is why a single-year what-if was wrong). estSavings = engine multi-year total when
  baselineInputs present, heuristic 5%-of-gain fallback otherwise. §453(i) recapture is a
  documented year-0 CPA carve-out.
- **The wiring EXPOSED the old flat-5% heuristic was wrong both ways** — it overstated ~$15k
  on a $400k gain mostly already at 15% (planning-tests G1.47+1: engine $4,353 vs heuristic
  $20k, hand-calc'd against the MFJ $583,750 LTCG breakpoint) and understated on a $600k
  gain that fully crosses it (scenarios S5: $46,091). Both regression assertions updated to
  the engine-verified values.
- 14 new hand-calc'd tests (`tax-engine-section453-multiyear-tests.ts`): the LTCG lever flows
  correctly (AGI/netting/preferential deltas + cross-nets a loss CF) and the detector's
  multiYear.totalSavings is cross-checked against an INDEPENDENT runMultiYearTrajectory pair.

**§1244/§453 PAIR COMPLETE.** Remaining engine-modelable heuristic: §163(d) investment-
interest election (G1.93). Remaining credit mechanics (need calculate* first): §41 R&D
(G1.36), §530 Coverdell (G1.59), §45S FMLA (G1.74), §51 WOTC (G1.75).

---

# Handoff Note — 2026-06-06b (P2-13/14/15 — planning CREDIT MECHANICS — shipped + deployed)

Worked `docs/product-todo.md` P2 "Planning engine" — the credit/election mechanics
that block what-if wiring. **3 commits fast-forwarded to `main`, pushed, deployed to
EC2 (migration 0005 applied, api-server rebuilt, pm2 restarted, frontend rsynced,
prod-smoked, re-score 0-drift). Full no-API battery 65 suites / 4,144 assertions green
(+119 this session).** Every tax value hand-calc'd against IRS rules before asserting.

## What shipped (each its own commit; hand-calc'd tests)
- **P2-13 — §23 Adoption Credit as a REAL engine credit** (`060a9d7`): new
  `calculateAdoptionCredit` (taxCalculator) — per-child dollar limit (2024 $16,810 /
  2025 $17,280 / 2026 $17,670), ratable $40k MAGI phase-out, §23(a)(3) special-needs
  full-limit deeming, OBBBA refundable split ($0/$5,000/$5,120), §23(c) 5-year
  nonrefundable carryforward. Wired into the credit pipeline after the §25–§25D
  credits and before the §53 AMT credit; refundable portion → refundable total.
  MAGI = AGI + FEIE add-back (§23(b)(2)(B)). MFS disqualified (v1). 3 new adjustment
  inputs (`qualified_adoption_expenses` / `adoption_special_needs` flag /
  `adoption_credit_carryforward`) + openapi/codegen + ClientForm labels. Carryforward
  persisted (`tax_returns.adoption_credit_carryforward_remaining`, migration 0005) +
  auto-seeded from the prior year (FTC pattern). G1.65 detector now reports the
  engine-verified credit when a marker is present (heuristic CPA-prompt otherwise);
  `annotateVerifiedSavings` now preserves a detector's direct engine-verified
  annotation. 74 hand-calc'd tests (`tax-engine-adoption-credit-tests.ts`).
- **P2-14 — wire calculatePremiumTaxCredit into G1.30** (`67253e4`): the ACA PTC
  detector now reports the engine's ACTUAL Form 8962 §36B reconciliation
  (`computed.premiumTaxCredit`) when the client has Marketplace coverage — netPtc > 0 =
  additional refundable PTC; netPtc < 0 = excess-APTC repayment exposure (with the
  §36B(f)(2)(B) cap) that MAGI management can reduce. savingsSource "engine-verified",
  verifiedSavings = |netPtc|; full PTC detail in inputs. The forward-looking SE-income
  $1,000 heuristic is PRESERVED for clients with no 1095-A data. 26 hand-calc'd tests
  (`tax-engine-ptc-detector-tests.ts`; TY2024 FPL $14,580, fplFraction 2.50, AF 0.04).
- **P2-15 — H2-wire §1244 (G1.40); document §453 (G1.47) deferral** (`22fbb82`):
  G1.40 attaches an engine-verified what-if measuring the CURRENT-YEAR refund benefit
  of electing §1244 ordinary treatment (recharacterize the loss out of the
  capital-loss carryforward → deduct in full above the line); the engine captures the
  real bracket/NOL limits the fixed 17% rate-spread heuristic can't. estSavings stays
  the conservative lifetime rate-spread; verifiedSavings is the current-year delta.
  **§453 NOT single-year-wired** — its value is purely multi-year bracket-smoothing, so
  a single-year what-if would falsely book the deferred-year tax as a saving; honest
  wiring needs an installment-gain input lever via runDetectorMultiYear (the engine has
  no general capital-gain adjustment to inject yet) — documented in the detector +
  exposes the engine's actual marginal rate. 19 hand-calc'd tests (the what-if delta is
  cross-checked against an INDEPENDENT engine run; `tax-engine-section1244-whatif-tests.ts`).

## NOT done / deferred (honest)
- **§453 (G1.47) full H2/H3 wiring** — needs a new installment-gain input lever
  (inject recognized gain/N per year into a multi-year trajectory). Scoped, documented
  in the detector's assumptions. The single-year shortcut was deliberately NOT taken
  (it overstates).
- **Remaining credit mechanics** (still heuristic): §41 R&D (G1.36), §45S FMLA (G1.74),
  §51 WOTC (G1.75), §530 Coverdell (G1.59), §36B-full reconciliation optimizer, §163(d)
  investment-interest election (G1.93). Each needs its calculate* support modeled first.
- **UI dropdown** (3 new adoption adjustment labels) verified by typecheck + clean Vite
  build + rsync (identical render path to the 100+ existing entries) — not re-rendered
  in a live browser (low risk; flagged for transparency).

## Verify
typecheck (api-server + tax-app + db + libs + tests) clean; 65 no-API suites / 4,144
assertions green; api-server esbuild + frontend Vite build clean; deployed +
prod-smoked (healthz ok, migration 0005 column present + serializes, planning-opps
HTTP 200 over real data, re-score 0-drift across 10 prod returns).

---

# Handoff Note — 2026-06-06 (P2 BATCH — 10 items shipped + deep audit + deployed)

Worked `docs/product-todo.md` P2 (medium enhancements) + the requested deep audit.
**13 commits fast-forwarded to `main`, pushed, deployed to EC2 (migrations 0003+0004
applied, api-server rebuilt, pm2 restarted, frontend rsynced, prod-smoked, planning
re-scored). Full no-API battery 62 suites / 4,025 assertions green.** Every tax value
hand-calc'd against IRS/state primary sources before asserting.

## What shipped (each its own commit; hand-calc'd tests)
- **P2-16 — return-level diagnostics** (`lib/returnDiagnostics.ts`, PURE): critical/
  warning/info pre-filing checklist (state code, kiddie-tax parent rate, ACA APTC w/o
  SLCSP, non-resident wages, §6654 balance-due, W-2 + 1099 box arithmetic, ACA gaps).
  GET `/clients/:id/tax-return/diagnostics`; `DiagnosticsCard` on the Tax Calc tab. 36 tests.
- **P2-7 — 1040-X depth**: real Line 6→7→8 chain (tax → nonref credits → net), credit-
  component breakdown, amended state-return lines. Additive FiledSnapshot (back-compat
  bug caught by a legacy-snapshot test + fixed). PDF + card. 107 tests.
- **P2-4 — Form 8995-A per-business §199A wage/UBIA limit**: per-business limit summed
  (high-wage biz can't rescue low-wage). `ComputedTaxReturn.qbiPerBusiness`. 22 tests.
  **Deep audit caught + fixed a real §199A loss-netting bug** in this (loss biz now nets
  before the wage limit; was over-stating).
- **P2-3 — FTC §904(c) carryover** (Form 1116 Sch B): combined current+carryover through
  the §904 limit; excess re-carries. New column `foreign_tax_credit_carryforward_remaining`
  (migration 0003). SEHI "carryforward" documented as a non-concept (no SEHI CF in law). 14 tests.
- **P2-6 — federal sub-gaps**: §1202 acquisition-date exclusion % (50/75/100) + §57(a)(7)
  AMT pref; K-1 basis reduced by distributions + sep-stated deductions (§1367 order,
  migration 0004); §168(k) TY2025 bonus dual-rate (`bonus_depreciation_basis_obbba` @100%).
  HIFO/specific-ID (planning, not prep) + partial-wash re-flow (already handled) documented. 21 tests.
- **P2-1 — Form 8582 per-activity worksheet**: ratably allocates allowed/suspended loss
  per property (Worksheet 5); `ComputedTaxReturn.form8582`. Tax result unchanged. 27 tests.
- **P2-2 — Minnesota AMT** (Schedule M1MT, §290.091): 6.75% on MN AMTI after the statutory
  exemption ($77,590 MFJ/$58,190 single/$38,800 MFS), §55(d) phase-out, resident delta —
  mirrors the CA pattern. Caught that a web search had conflated the FEDERAL exemptions;
  used the statute. NY (IT-220 narrow) + NJ (no AMT) documented. 9 tests.
- **P2-12 — 1099 box-arithmetic validation** (`validate1099`): DIV qualified≤ordinary,
  R taxable≤gross, B proceeds−basis≈gain, TIN/withholding plausibility; folded into
  diagnostics. 19 tests.
- **P2-9/P2-10 — extraction confidence + recall**: per-field confidence (0–1) on the
  extractors + `lowConfidenceFields` filter + documents-route plumbing; W-2 Box1≠Box3
  + "extract every box" recall hints. 10 deterministic tests (model-side needs a live key).
- **Deep audit** — hand-verified 7 feature-INTERACTION scenarios + 5 edge cases
  (`tax-engine-p2-audit-tests.ts`, 23 assertions); found+fixed the QBI loss-netting bug;
  verified the planning engine fires sane engine-verified strategies.

## NOT done / partial (honest)
- **P2-5 Schedule C per-line** — NOT done. The engine takes net SE as one number;
  §179/bonus are above-the-line (don't reduce the SE base — documented, not a bug).
  Per-line P&L + asset depreciation reducing SE is the real enhancement (large input model).
- **P2-8 100-doc benchmark** — BLOCKED on a PAID Gemini key. Harness READY
  (`scripts/src/ai-benchmark/run.ts` — LIVE with a key, MOCK otherwise).
- **P2-11 new doc-type extractors** (1098/1095-A/SSA-1099/W-2G) — NOT done (unverifiable
  without the paid API; W-2/1099 now have confidence+recall).
- **P2-13..15 planning credit mechanics** (§41/§45S/§51/§23/§530/§36B + heuristic→engine
  promotion) — NOT done (XL; the cleanest next is §23 adoption + wiring the existing PTC).

## Verify
typecheck (api-server + tax-app + db + validation + tests) clean; 62 no-API suites /
4,025 assertions green; api-server esbuild + frontend Vite build clean; deployed +
prod-smoked (diagnostics endpoint live, new engine fields present, 10/10 prod returns
recompute clean, planning re-scored 0-drift).

---

# Handoff Note — 2026-06-05h (STATE-MOD LAYER — per-line non-resident sourcing, NY IT-203 / CA 540NR — SHIPPED + deployed)

Built P1 #2 — the #1 correctness gap. Research (worked examples) → implement →
adversarially verify (3 verifiers, issues: none). Every value re-derived against
the ENGINE's own brackets; the hand-calc caught a research arithmetic error.

**What shipped (`calculateMultiStateTax` non-resident branch rewrite):**
- **Proportional ("as-if-resident × source-fraction") method generalized to {CA, NY}**
  (`NR_AS_IF_RESIDENT_STATES`). NR tax = tax-as-if-a-full-year-resident on TOTAL
  income × (state-source / total income) — the method NY IT-203 (Line 45 income %)
  and CA 540NR (Schedule CA ratio) actually use; it preserves the progressive
  marginal rate. CA already did this for wages; **NY now does too** — fixes the very
  common NJ/CT-resident-working-in-NY case (was under-taxing via direct brackets).
- **Per-income-type NR source base** — new option `perStateNonResidentOtherSourced`
  (NR business / rental / real-property gains). A non-resident state with ONLY
  non-wage source (e.g. NY rental, no NY wages) is now taxed.
- **4 U.S.C. §114 enforced BY DESIGN** — interest/dividends/intangible gains (§114(a))
  + pension/IRA/401(k)/SS (§114(b)) are NEVER auto-added to the source base (no
  algorithmic path includes them; the CPA must explicitly place sourceable income).
  The resident credit-for-tax-paid cap now uses NR-source (not wages-only).
- **Backward-compatible**: CA NR unchanged when the new option is absent; the
  part-year path + the former-state double-count guard are untouched.
- **10 hand-calc'd tests** (`tax-engine-nr-sourcing-tests.ts`): NY $80k+$40k →
  $4,101.17; CA $100k+$50k → $6,651.43 (engine value — an external worked example
  had a $1,006 addition error, caught + corrected); per-type rental; §114 exclusion.
- Prod-verified: the NR-sourcing test passes 10/10 on the deployed box.

**Remaining sub-increments (the layer is substantially done; these are smaller):**
- **Pipeline wiring** — `perStateNonResidentOtherSourced` is engine-function-level
  + tested there. The METHOD generalization (NY IT-203) flows end-to-end already
  (via W-2 stateCodes through computeTaxReturnPure); the per-type NR source
  (business/rental/real-property gains) needs a CPA-input plumbing path (a new
  adjustment / per-state-per-type input) to be settable end-to-end.
- **Part-year as-if-resident method** — the part-year path (`computePartYearAllocation`)
  already sources per-type (`perStateOtherSourced`) but still uses direct
  `calculateStateTax` on the allocated AGI rather than the IT-203 income-% method.
- **Real-property-situs metadata** on capital transactions (a `CapitalGainTransaction`
  schema field) to AUTO-route real-estate gains (today CPA-supplied via the option).
- **More states** in `NR_AS_IF_RESIDENT_STATES` (only CA + NY validated with worked
  examples; most states use the same method — add as verified).

Verify: typecheck (api-server + libs) + typecheck:tests clean; **53 no-API suites /
3,817 assertions green**; deployed + prod-smoked.

---

# Handoff Note — 2026-06-05g (Rest of P1 — WI/CT wins + Roth IRMAA + growth model; state-mod layer scoped)

Worked "the rest of P1." Research → implement → verify, with every tax value
confirmed against the PRIMARY source before shipping (the no-guessing rule).

**State wins (PREP-Q3) — shipped + deployed + hand-calc'd:**
- **WI single sliding-scale std deduction** (Wis. Stat. §71.05(22) / WI Legislative
  Fiscal Bureau): $13,230 max − 12% of WAGI over $19,070 → $0 at ~$129,319. Engine
  used the max for all AGIs before (over-deducting high earners). **MFJ/HoH/MFS kept
  at max** — couldn't cleanly source their indexed thresholds, so NOT shipped (no
  guessing; the LFB single threshold + 12% rate are confirmed). WI single $50k →
  std ded $9,518.40 → tax $1,800.41 (exact).
- **CT Social Security exclusion** (CT-1040 + DRS): 100% exempt below $75k single/
  MFS / $100k MFJ-QW-HoH; 75% exempt (≤25% taxed) above. Engine taxed 100% of CT SS
  before (over-taxed every CT retiree). CT pension/IRA exclusion still NOT modeled
  (needs the exact bracketed phase-out table + a pension-vs-IRA split the single
  retirement bucket can't make — documented).
- **IN**: SS is already correctly excluded (IN not in STATES_TAXING_SS) — no change
  needed. The minor IN unemployment-comp deduction is a small remaining sub-gap.

**Roth "future increments" — both shipped (the value model is now complete):**
- **Medicare IRMAA** — verified the 2025 table myself (SSA POMS HI 01101.020; the
  research agent's table was year-mixed). Part B+D annual surcharge per person by
  MAGI tier. The value model now charges the EXTRA IRMAA conversions trigger, with
  IRMAA's 2-year MAGI lookback (years 0-1 use pre-conversion MAGI), at age 65+
  (MFJ ×2). New `netLifetimeValue = tax saved − extra IRMAA`. Prod (client 9):
  net $148,940 = $142,575 tax saved + $6,365 IRMAA saved (converting also LOWERED
  lifetime IRMAA — smaller RMDs → lower later MAGI: $235k→$229k).
- **Tax-free Roth-growth** — tracks the laddered conversions growing tax-free;
  surfaces `scenarioRothBalanceFinal` ($1.42M for client 9) as the upside the
  tax-only figure omits. openapi + codegen + UI panel updated. 17 new hand-calc'd
  assertions (exact IRMAA tiers + the $8,470 2-yr-lag scenario + Roth growth).

**P1 #2 state-modifications layer (per-line NY IT-203 / CA 540NR sourcing) —
SCOPED, NOT shipped (genuinely multi-week).** The engine ALREADY has a strong
multi-state foundation: C11 per-W-2-stateCode + per-K-1/rental sourcing
(`useW2SourceAllocation`/`perStateOtherSourced`), the CA 540NR "as-if-resident"
formula (taxCalculator.ts:1288-1301), days-prorated deductions (E12), the
former-state double-count fix. The remaining FULL per-income-type sourcing
(interest/div/cap-gains/business/rental routed per-state, with real-property-situs
vs intangible-domicile distinction) is **Phase 2** — it needs a schema change
(`CapitalGainTransaction.propertyStateSitus`) + per-type plumbing through
`computePartYearAllocation`, ~2-3 weeks. The ordered plan + the 4 U.S.C. §114
retirement-preemption analysis are in the 2026-06-05g scope investigation
(workflow w4quowsu4). I did NOT fake-complete it.

Verify: typecheck (api-server + tax-app + libs) clean; **52 no-API suites / 3,806
assertions green**; deployed (api-server + frontend rsync) + prod-smoked.

---

# Handoff Note — 2026-06-05f (H3 MULTI-YEAR HARDENING + Roth RMD-avoidance value model — SHIPPED + deployed)

Did the full H3 multi-year hardening (the Roth optimizer's value-model prereq) and
folded RMD into the optimizer as the lifetime value model. Research → implement →
adversarial-verify (3 workflows); all independently re-derived, **issues: none**.

**H3 engine hardening (multiYearEngine.ts) — additive, OPT-IN, PURE.** The impact
analysis proved the naive "change defaults" plan was wrong (would double-count
G1.4's existing RMD proxy + break Case 4), so everything is opt-in (default off →
every existing consumer + test byte-for-byte unchanged):
- **RMD**: IRS Uniform Lifetime Table (Pub 590-B Table III, all 29 divisors ages
  72-100 cross-verified vs IRS + 3 sources), RMD_TRIGGER_AGE=73, rmdDivisorForAge +
  requiredMinimumDistribution (prior-year-end balance / current-age divisor).
- **Carryforward threading**: captureCarryforwards (8 remaining fields: NOL, cap-loss
  short/long, charitable cash, §163(j), AMT credit, AMT NOL, Sched-E PAL) +
  applyCarryforwards → next year starts from depleted remainders.
- runMultiYearTrajectory gained opt-in `chainCarryforwards` + `rmd` options +
  `rmdByYear`. 35 hand-calc'd assertions (tax-engine-multiyear-hardening-tests.ts).
- SS needed NO work — benefits already stay flat (client field, not scaled) + the
  engine recomputes taxable SS per year as income grows.

**Roth RMD-avoidance VALUE MODEL (rothOptimizer.ts).** projectRmdAvoidance (pure,
separately testable) projects total federal tax to ~age 92 for BASELINE (no
conversions, full RMDs at 73+) vs SCENARIO (the ladder shrinks the IRA → smaller
RMDs); returns lifetimeFederalTaxSaved + RMD totals + final IRA balances.
Conservative (excludes tax-free Roth growth → real value higher).
optimizeRothConversionLadder attaches it when client.taxpayerAge is set (null else).
openapi + codegen + the RothOptimizerCard "Lifetime RMD-avoidance" panel updated.
- **Prod-verified**: client 9 (age ~54, RMDs from 2044) → **$134,759 lifetime tax
  saved**, lifetime RMDs $1,617,111 → $1,019,786. Clients w/o age → null (correct).
- Hand-calc'd 2-year controlled test: the engine correctly applies the age-65 add'l
  std ded + the OBBBA senior deduction (my first hand-calc omitted them → I corrected
  the expectations to match; that's the discipline working).

**Verify**: 52 no-API suites / 3,781 assertions green; typecheck (api-server +
tax-app + libs) clean; deployed (api-server + frontend rsync) + prod-smoked. The
Roth optimizer (PLAN-B1) is now COMPLETE (v1 ladder + lifetime value model).

**Still deferred (multi-week):** P1 #2 state-modifications layer (per-line NY IT-203
/ CA 540NR sourcing); the remaining quick state wins WI/CT/IN (need final
primary-source confirmation on the exact thresholds before coding).

---

# Handoff Note — 2026-06-05e (P1 — Roth optimizer v1 SHIPPED + 2 state wins; #2/H3 deferred w/ plan)

Worked the P1 enhancement list. Scope was set honestly against the code (one
investigation workflow grounded it): #3 was already done; #1's solver was already
built; #2 + the Roth *value model* are genuinely multi-week.

**⭐ #1 Multi-year Roth-conversion optimizer — v1 SHIPPED end-to-end + deployed.**
`rothOptimizer.ts` (`optimizeRothConversionLadder`) was already built, pure, and
unit-tested but wired to nothing. Now live:
- POST `/api/clients/:id/roth-optimizer` (openapi + codegen → `useRunRothOptimizer`;
  Pro-tier-gated; 400/404). routes/planning.ts loads the client's inputs → solver.
- `RothOptimizerCard` in the Planning tab (IRA-balance + horizon inputs, per-year
  ladder table, summary tiles, v1-assumptions disclosure).
- Prod-verified: client 3 (12% retiree) fills the 12% bracket — converts $8,200,
  engine-exact cost $984 = 8,200 × 0.12; client 7 (35%) fills to $626,350, cost
  $57,703 = 164,866 × 0.35. Bracket ceilings advance with inflation; IRA depletes.
- **v1 models the bracket-fill ladder with engine-EXACT current-year cost.** The
  long-term value model (RMD avoidance, IRMAA, SS-taxability) needs the **H3
  multi-year hardening** — see the deferred plan below.

**#4 Quick state wins — VT + Yonkers SHIPPED (hand-calc'd).**
- VT dependent personal exemption `$4,850/dep` (was $0 for VT dependents).
- Yonkers resident surcharge = 16.75% of net NY State tax (localityCode "YONKERS",
  mirrors the NYC path; web-verified 16.75% via NY DTF).
- 8 hand-calc'd assertions (`tax-engine-state-wins-2026-tests.ts`).
- NJ retirement exclusion verified already-correct (no change).

**#3 Catalog refresh — VERIFIED already done** (v1.20, 94@2099; CI test green). No work.

**DEFERRED (multi-week — NOT faked; concrete plans captured):**
- **H3 multi-year hardening** (the Roth optimizer's advanced value model): carryforward
  depletion (NOL 80% §172 / cap-loss $3k §1212 / charitable 5-yr §170(d) / §163j),
  RMD recognition at age 73 (§401(a)(9), Pub 590-B Table III), SS-taxability scaling
  (§86). ~6–8 wks, multiYearEngine.ts. Full ordered plan + IRS cites in the scope
  investigation result (workflow wvnhs2g8r).
- **#2 State "modifications" layer** — configurable retirement/SS exclusions + per-line
  NY IT-203 / CA 540NR sourcing (replace the day-proration approximation). Multi-week.
- **#4 remaining state wins — WI std-ded phase-out, CT SS/pension phase-out, IN-112.**
  The agent's exact thresholds need final primary-source confirmation before coding
  (I won't ship a guessed WI phase-out rate over today's documented approximation).
  Values + wiring plans captured in the investigation result.

Verify: typecheck (api-server + tax-app + libs) + typecheck:tests clean; **51 no-API
suites / 3,730 assertions green**; frontend builds; deployed (api-server + frontend
rsync) + prod-smoked.

---

# Handoff Note — 2026-06-05d (P0 quick-fixes — doc-drift + detector-coverage guard)

Closed the 5 P0 "quick fixes" from `docs/product-todo.md` (verified each against code,
not docs):
- **tax-returns.ts:647** stale "UltraTax CS / Lacerte / ProConnect / Drake friendly"
  CSV comment → "vendor-neutral CPA-review format".
- **coverage-matrix.md** refreshed: §199A wage/UBIA limit marked MODELED
  (`wageUbiaLimit`, taxCalculator.ts:5489); §1411 NIIT base note corrected (§121
  remainder + §1031 recognized + QSBS + passive rental + K-1 now in the NII base);
  removed NYC UBT / KY occupational / OH cross-city / IN per-dependent from the
  "deferred" list (all shipped); IL dependent exemption ($2,775/dep) marked shipped.
- **CLAUDE.md** dropped both `ONBOARDING.md` pointers (file never committed; roadmap
  is `docs/haven-migration-roadmap.md`) + fixed the duplicate "4." numbering.
- **§121-remainder → NIIT** confirmed CLOSED in code (taxReturnEngine.ts:1885/2562,
  regression realworld S4 = $15,200); cleared the stale "open" notes in `docs/todo.md`.
- **Detector-registry guard** — NEW `scripts/src/tax-engine-detector-coverage-tests.ts`
  (9 assertions): static set-equality of `strategyById("...")` literals across
  planningEngine.ts + planningEngineMultiYear.ts vs the catalog (catches "added
  catalog entry, forgot the detector"), plus a dynamic floor (a rich client fires
  ≥6 distinct — actually 17). **The audit's "4 catalog IDs unreachable" was a FALSE
  POSITIVE** (adversarially disproved): G4.1–G4.5 are wired in the separate
  multi-year module; real coverage is **101/101**.

Verify: typecheck + typecheck:tests clean; **50 no-API suites / 3,722 assertions
green**. Only a code COMMENT changed (no runtime behavior); docs + 1 new test.

---

# Handoff Note — 2026-06-05c (TAX-LAW FRESHNESS HARDENING — items 1–9, shipped + deployed)

Made stale/missing tax years **fail loudly** instead of silently returning a wrong
number, fixed three live TY2026 values, and defused the planning-catalog time-bomb.
The freshness guarantee is now three-layered: **compile-time** (`Record<TaxYear>`
typing — a missing supported-year key is a build error), **CI tests** (year-coverage
+ catalog-freshness), and **maintenance tooling** (a re-score sweep).

**Live bugs fixed (were wrong for an activated year TODAY):**
- **G1.23 cost-seg bonus depreciation** — `G1_23_BONUS_RATE` had no TY2026 key, so a
  2026 rental return fell back to the 40% default. OBBBA (§70301) restored **100%**
  bonus for property placed in service after 2025-01-19 → added `2026: 1.0`.
- **G1.96 §132(f) transit** — used the TY2025 $325 cap for 2026. Added the **$340**
  cap (Rev. Proc. 2025-32) as a `Record<TaxYear>` map.
- **G1.26 backdoor-Roth IRA cap** — hardcoded $7,000/$8,000. 2026 is **$7,500** base /
  **$8,600** with the 50+ catch-up ($1,100) per IRS Notice 2025-67 → year-indexed.

**Compile-time guard (`Record<number>` → `Record<TaxYear>`):** all 15 planning
year-maps in `planningEngine.ts`, `STATE_TAX_DATA_BY_YEAR` (`stateTaxData.ts`),
`SECTION_6654_ANNUAL_RATE` (`form2210.ts`). New leaf module **`taxYears.ts`** owns
`SUPPORTED_TAX_YEARS` / `TaxYear` / `LATEST_YEAR` / `resolveTaxYear` (re-exported from
`taxCalculator` for back-compat) so `stateTaxData` can import `TaxYear` without an
import cycle. De-duped `obbbaSaltCap` → the shared `taxCalculator.getSaltCap`
(line-for-line identical); killed the open-ended `SS_WAGE_BASE` ternary; **KY-Kenton
occupational wage cap** now tracks the year's OASDI/SS base (was frozen at the 2024
$168,600); fixed the **dead `irsForm1040Pdf` ternary** (`2024 ? "2024" : "2024"`) →
explicit, extensible template-year map.

**Catalog v1.20 (time-bomb defused):** re-dated 90 permanent-IRC strategies (+G1.64)
`validUntil 2026-12-31` → `2099-12-31`; genuine OBBBA sunsets keep real dates (energy
G1.33/34/37 = 2025; tips/OT/car-loan/senior G1.97–100 = 2028). PLAN-08 still suppresses
those on schedule.

**New CI freshness tests (+215 assertions; now 49 suites / 3,713 green):**
- `tax-engine-year-coverage-tests.ts` (114) — every public year-indexed engine fn
  returns a sane value for **every** SUPPORTED year; inflation-indexed values strictly
  monotonic (catches a stale copy); registry + `resolveTaxYear` invariants; **the three
  live-bug regressions at exact IRS values** (G1.23 bonus, G1.96 cap, G1.26 IRA — and
  2024/2025 preserved).
- `tax-engine-catalog-freshness-tests.ts` (30) — F1–F4 above.
- `tax-engine-50state-tests.ts` extended to loop `SUPPORTED_TAX_YEARS` (covers 2026 +
  any future year automatically) + a no-income-tax $0 smoke per year.

**New tooling:** `scripts/src/recompute-planning-scores.ts` — sweeps every persisted
return and re-derives ONLY the two ranking columns (`planning_score` /
`planning_marginal_rate`) via the exact live scoring path; `--dry-run` previews; numeric
(not string) change-detection so a re-run is a no-op. Run it after any catalog/score
change. (`scripts/package.json` gained `@workspace/db` + `drizzle-orm`.)

**Deferred (documented):** item 6 (extract per-year numbers into `tax-year-data/<year>.ts`)
— pure organizational reorg of the core engine; the freshness GOAL is already met by the
`Record<TaxYear>` typing + CI tests, and `taxYears.ts` is the seam if/when it's done. Not
worth the core-engine churn now.

**Verify:** `pnpm run typecheck` + `typecheck:tests` clean; **49 no-API suites / 3,713
assertions green**; api-server esbuild clean. **No schema change** (catalog is bundled
JSON; planning columns already exist). Post-deploy: ran the re-score sweep on prod.

**Maintenance going forward:** to activate a new tax year, append it to
`SUPPORTED_TAX_YEARS` in `taxYears.ts` — the compiler then flags every `Record<TaxYear>`
map missing the key, and the year-coverage test flags any function that doesn't cover it.
Fill the IRS values (Notice/Rev. Proc.), refresh catalog `validUntil`s if any provision
sunset, run the sweep.

---

# Handoff Note — 2026-06-05b (FORM 2210 / §6654 — audit P1-6, shipped + deployed)

Picked the next concrete audit P1 after confirming the obvious candidates were
done: H2-wiring the remaining G1.46–G1.96 detectors was already **assessed +
not-recommended** (qualitative — business credits/elections/trusts the individual
engine doesn't model; force-wiring via the refundable `credit` adjustment would
overstate), and **P1-2 "engine delta as headline" was already shipped** as PLAN-Q1
(`annotateVerifiedSavings` → `verifiedSavings`/`savingsSource`, `headlineSavings`
ranks on it, "Engine-verified (H2)" badge). So shipped **P1-6: Form 2210 / §6654**
(commit `ea26fa5`).

- **lib/form2210.ts** — `computeForm2210()`: the EXACT required-annual-payment /
  estimated-tax safe-harbor target (§6654(d): lesser of 90% current-year tax or
  100%/110% prior-year tax; 110% when prior AGI > $150k / $75k MFS) + the
  under-$1,000 and prior-year-zero exceptions (§6654(e)). Current-year tax (Line 4)
  derived exactly from the engine refund identity (federalTaxLiability − nonref −
  refundable credits). Penalty $ is a clearly-labeled ESTIMATE (underpayment ×
  year-rate [8% TY2024 / 7% TY2025, year-indexed `SECTION_6654_ANNUAL_RATE`] × ⅔,
  the even-quarterly-installment average) — the modern Form 2210 dropped the
  short-method multiplier and needs per-quarter payment dates we don't track. +
  `buildForm2210Pdf()` substitute PDF.
- **routes/tax-returns.ts** — GET `/tax-return/form-2210` (+ `/pdf`); prior-year
  tax + AGI derived from the prior-year tax_returns row, with
  ?priorYearTax/?priorYearAgi/?estimatedPayments overrides.
- **ClientDetail** — `Form2210Card` on the Tax Calculator tab (safe-harbor verdict
  + "pay $X to avoid" + PDF download), beside the Form 4868 card.
- **45 hand-calc'd assertions** (`tax-engine-form2210-tests.ts`) — all safe-harbor /
  exception / MFS-threshold / TY2024-25-26 paths + an end-to-end case.

Verified: **47 no-API suites / 3,498 assertions green**; live endpoint (prior-year
derivation + override + PDF) + the rendered card (client 6107: underpayment $1,469
→ est. penalty $78 @ 8%) confirmed in the browser; deployed to EC2 + prod-smoked
(Han: required $120,396 = 90% × $133,773). **No schema change** (no migration).

**Maintenance note:** add the next year's flat §6654 rate to
`SECTION_6654_ANNUAL_RATE` in form2210.ts once the IRS publishes its quarterly
underpayment rates (currently TY2026 = null → safe-harbor target shown, penalty $
omitted).

---

# Handoff Note — 2026-06-05 (DEFERRED BACKLOG CLEARED — Batch A 12 + Batch B 2, deployed)

Cleared the deferred backlog from the 2026-06-04 multi-agent audit. **5 commits on
`main` (`14aa2ed` → `597302d`), pushed + deployed to EC2 (api-server rebuilt,
migration 0002 applied, prod recompute-swept, frontend rsynced) + verified.**
Full no-API battery **3,453 assertions green** (was 3,432; +21); typecheck +
typecheck:tests green.

## Batch A — 12 low-severity cleanups (commits `14aa2ed` security, `50e4877` correctness)
- **#1** documents.ts: extraction now routes off the content-verified (magic-byte)
  MIME, not the filename. **#2** doc-content endpoint → `Cache-Control: no-store`
  (was `private, max-age=300`) for the PII bytes. **#3** CORS reflect-any-origin now
  needs an explicit `CORS_ALLOW_ALL=true` (was keyed off `NODE_ENV!==production`;
  the box ships with NODE_ENV unset → was reflecting any origin w/ credentials);
  disallowed cross-origin → `callback(null,false)` so same-origin mutations don't
  500. **#4** prompt-injection fence extended to the W-2 image/PDF + 1099 vision
  paths. **#5** ClientDetail masks the 1099 payer TIN (`maskTin`). **#8** post-
  approve recompute pinned to the approved record's tax year.
- **#6** tax-returns `mapReturn` coerces EVERY numeric column to number (schema-
  driven via `getTableColumns`→PgNumeric; was a 12-field list leaving ~70 cols as
  strings) + integration assert `typeof amtTax==='number'`. **#7** W-2/1099 delete
  clears the polymorphic `tax_documents` back-pointer in-txn + pins recompute year.
  **#9** disclosure-consents 404s when the client doesn't exist (was a FK 500).
  **#10** four §179/bonus/§461(l)/§448(c) year-maps hoisted to module scope, typed
  `Record<TaxYear,…>` (missing year now = typecheck error). **#11** Form 2441
  applicable-% uses `Math.ceil` ("or fraction thereof", §21(a)(2)) + dropped the
  off-by-one `agi>=43000` override; **corrected 5 stale test expectations that
  encoded the bug** ($30k→27%, $40k→22%, $43k→21%) + a 9-point boundary battery.
  **#12** year-indexed the residual stale TY2024 planning constants (G1.66 reuses
  the year-indexed G1.26 Roth phase-out — gates fire/no-fire; G1.53 kiddie
  threshold from `KIDDIE_TAX_THRESHOLD`; G1.69 via new `getFederalBracketBreakpoints`).

## Batch B — 2 scale items
- **#13 `perf(clients)` (`6fe576d` + fix `597302d`):** GET /clients keyset-paginated
  (`?limit` default 50/cap 200, `?cursor`, `?q` ILIKE name/email, `?filingStatus`),
  column-projected, returns `{items,nextCursor}`; ClientList drives search/filter/
  "Load more" off the server (`useInfiniteQuery`). OpenAPI + codegen updated.
  **Post-deploy verification caught a real keyset bug** (`597302d`): the cursor
  carried updatedAt as a millisecond JS Date (pg truncates timestamptz to ms), so
  rows sharing the cursor's ms but a smaller microsecond were SKIPPED — on prod, 3
  clients batch-inserted at the same microsecond made limit<8 return 6 of 8. Fixed
  by carrying a UTC **microsecond** ISO cursor compared via
  `$cursor::timestamp at time zone 'UTC'` (still index-usable). Verified: forced
  3-way same-µs collision paged at limit=2 returns all 97 (no skips/dupes); prod
  limit=3 now 8/8.
- **#14 `perf(planning)` (`2b87ed6`, migration 0002):** tax_returns gains
  `planning_score` + `planning_marginal_rate` (+ `tax_returns_planning_score_idx`),
  written at recalc time in taxReturnPipeline (isolated try/catch — a planning
  failure never blocks persisting the return). The firm-wide hit-list + dashboard
  Top-10 now rank via one indexed `ORDER BY planning_score DESC LIMIT n` + build
  details for only the top-N (was running the engine for EVERY client). Category
  filter keeps the per-client path (all-category score can't rank a subset; unused
  by the dashboard). Verified: fast-path top-10 IDENTICAL to the precomputed
  ranking; dashboard widget renders the same scores; topHits contract preserved.

## Verification (high bar)
- Local browser (ClientList): renders from {items}, "Load more" 50→97, server
  search 97→2, no console errors; Dashboard Top-10 widget scores render.
- Prod API (public path): clients pagination (8/8, collision-safe), q-filter,
  bad-cursor 400, hit-list ranked w/ topHits, healthz 200, new bundle served.
- **`planning_score` MUST be recompute-swept after any deploy that changes the
  planning catalog/score** (rows with null score are excluded from the fast path).
  Done this deploy (8/8 prod clients).

## Recommended next
1. H2-wire the remaining heuristic planning detectors (≈G1.67–G1.96) — the durable
   product value (engine-verified deltas). 2. God-file refactor (planningEngine 8k /
   taxCalculator 6k / ClientDetail 5k) — deferred, mid-Haven-migration. 3. The
   two-nullable-FK refactor for `tax_documents.linkedRecord*` (replaces the in-txn
   back-pointer clear). 4. Auth + multi-tenancy (D15, Haven fusion).

---

# Handoff Note — 2026-06-04c (DB MIGRATION CUTOVER — COMPLETE, commit `8e95184`)

The stale-`0000`-baseline drift class (root cause of the local hit-list 500) is
CLOSED. Dev + prod (Neon) are now baselined to versioned migrations and the EC2
deploy runs `drizzle-kit migrate`.

- **Unblocked the documented blocker:** `drizzle.config.ts` `out` was an ABSOLUTE
  path; drizzle-kit 0.31.9 prepends `./` when reading meta snapshots → malformed
  `.//…/0000_snapshot.json` → ENOENT, which had blocked `generate`. Made `out`
  relative.
- **Generated `0001_tiresome_mastermind.sql`** (purely additive — reviewed) for the
  drift since the 2026-05-28 `0000` baseline. Validated the full chain (0000→0001)
  on a fresh throwaway DB (builds all 14 tables cleanly). hash `441f713f…` = sha256.
- **Caught + fixed a real prod gap:** prod was missing 3 perf indexes
  (`clients_updated_at_idx`, `clients_email_idx`, `tax_returns_agi_idx` — added to
  dev/schema in the 2026-05-29 audit but never to prod). Created them (additive).
  Prod's 318-column fingerprint now matches dev exactly; all 4 indexes present.
- **Baselined dev + prod** (`__drizzle_migrations` rows for 0000+0001) and confirmed
  `migrate` is a verified NO-OP on each (it would have errored on the existing
  `disclosure_consents` table if it tried to apply 0001). Prod app health OK post-
  cutover (recent-clients + hit-list verified).
- **Going forward:** edit schema → `generate` → REVIEW the SQL → commit → deploy's
  `migrate` applies it. `push` is local-dev-only. CLAUDE.md "EC2 deploy" + deploy
  policy updated; `docs/db-migrations.md` marked CUTOVER COMPLETE.

Canonical hashes: `0000` = `3383733c…` (when 1780003127842), `0001` = `441f713f…`
(when 1780558502276).

---

# Handoff Note — 2026-06-04b (PLANNING-DETECTOR AUDIT — 7 gating fixes, commit `71306a8`)

Follow-up to the deep audit below: completed the one audit surface that session left
open (the `tax-state-plan` / planning-detector code review). Fanned out one agent per
detector to read the real gating code + produce SHOULD-fire/SHOULD-NOT clients, then
verified every claim against the engine via a ground-truth harness (run each client
through `evaluatePlanningOpportunities`, check fired strategy IDs). **8 detectors
audited, 7 had real gating bugs — all fixed + regression-locked. Planning suite
527→539 assertions; full no-API battery 3,432 green; CI gates green.**

- **False positives** (fired when it shouldn't): G1.4 Roth conversion (no pre-tax-
  balance check → advised converting a $0 trad IRA; now gates on supplied balances),
  G1.26 backdoor Roth (stale TY2024 phase-out tops → fired for TY2025/26 clients still
  able to contribute directly; now year-indexed), G1.31 Saver's Credit (HSA in the
  §25B gate → phantom credit; HSA isn't Form-8880-eligible), G1.17 S-corp reasonable-
  comp (no entity gate → fired for active partnerships with no wage/dist lever; added
  S-corp presence gate + TY2026 SS wage base), G1.7 QBI phase-in (stale "engine
  doesn't model the wage/UBIA limit" premise + fictional 50%-of-QBI savings → now uses
  the engine's actual limit impact).
- **Missed opportunities** (suppressed a qualifying client): G1.1 SEP/Solo-401(k)
  (hard-excluded MFS, but §408(k)/§415(c) have no filing-status limit), G1.2 PTET
  (itemizing gate suppressed std-deduction filers — prime candidates when the OBBBA
  SALT cap phases to the $10k floor).
- G1.6 NIIT-cliff was the one clean detector (sound gating).

**Methodology note (saved to memory):** the ground-truth harness caught that 8 of the
scenario-battery's "discrepancies" were agent INPUT errors (double-entered income),
not engine bugs — always verify agent-traced gating against a real engine run.

Verification harness pattern (delete-after-use temp files) is gone; the 12 new
`AUDIT-*` regression assertions in `tax-engine-planning-tests.ts` lock every fix.

---

# Handoff Note — 2026-06-04 (DEEP AUDIT — 13 fixes, merged to main + deployed to prod)

Multi-agent deep audit (security / DB-scale / code-quality / tax-correctness) +
an 18-archetype real-world scenario battery (each independently hand-calc'd from
IRS rules) + a full live UI click-through. **2 commits on `main`, pushed +
deployed to EC2 + frontend rsynced + prod recompute-swept.**

## What landed (commits `87db3e4` engine-correctness, `0e92287` hardening)

**3 engine correctness bugs (wrong tax number shipped) — each hand-calc'd + regression-locked:**
1. **QDCGT line-10 cap** (`calculateFederalTaxWithCapitalGains`): the capital-gains
   preferential base is now capped at `min(net cap gain, taxable income)`. When
   deductions exceed ordinary income (retiree/FIRE on LTCG/QDIV, big-LTCG seller),
   the engine taxed the FULL preferential at 0/15/20% — over-taxing by (unused
   deduction × top LTCG rate). Call site passes the SIGNED ordinary portion.
   Regression S14/S15/S16 in `tax-engine-realworld-scenarios-tests.ts`. *Found by
   manual hand-calc during the live UI click-through.*
2. **§199A SSTB phase-out base**: keyed on AGI; now keyed on TAXABLE income before
   QBI per §199A(e)(2) (parity with the wage/UBIA limit). AGI>taxable phased SSTB
   owners out too early. Moved below NOL, keyed on `taxableAfterNol`. 3 SSTB tests
   re-hand-calc'd (`-qbi-ty2026`, `-k1-depth`). *Found by the audit (cq-engine-1).*
3. **Part-year multi-state double-count**: a part-year mover's former-state W-2 was
   taxed BOTH as the part-year resident allocation AND as non-resident wages — a
   NY→FL mover paid MORE than a full-year NY resident ($16,709 vs $12,152). Former
   state now excluded from non-resident aggregation. Regression S17 + cpa-scenarios
   S12 corrected. *Found by the scenario battery.*
- Plus **year-map clamp**: §179/bonus/§461(l)/§448(c) now index via `resolveTaxYear`
  (consistent clamping) instead of ad-hoc per-map fallbacks that drifted on
  out-of-range years (multi-year projections past LATEST_YEAR).

**10 hardening fixes (`0e92287`):** planning hit-list **per-client error isolation**
(one bad client no longer 500s the firm-wide list — the failure that was masked as
"no opportunities" on the dashboard) + drop redundant adjustments query; **peer-
benchmark** N full-recomputes → ONE indexed SQL read over persisted columns; **PATCH
/tax-return** scoped to one tax year (was clobbering all year-rows — data loss);
**dashboard/summary** counts DISTINCT clients (row-count double-counted multi-year →
pendingReturns masked to 0 by clamp; now shows true pending); **Dashboard widget**
shows a real error state (not the benign empty state) on API failure; **CSV export**
formula-injection neutralized; **AI extraction** prompt fenced (injection defense);
**audit-log** redactPii recurses into arrays (nested SSN/TIN leak).

## Schema drift (FOUND + FIXED)
The **local dev DB** was behind the Drizzle schema by 4 columns + 1 table
(`capital_transactions.quantity`/`.account`, `schedule_k1_data.box4_guaranteed_payments`/`.is_sstb`,
`disclosure_consents`) — this 500'd the local planning hit-list. Applied additive
DDL locally. **Prod (Neon) was verified CURRENT — no drift, no prod incident.** The
stale-migration-baseline risk is real: `lib/db/drizzle` still only has `0000`.

## Verification (all green)
- 46 no-API suites / **3,420 assertions** green; full workspace typecheck + test
  typecheck (CI gates) green.
- Scenario battery: 135/144 hand-calc'd fields matched the engine; the 1 real bug
  (part-year) fixed; the other 8 discrepancies were agent input/harness errors
  (engine correct — verified by inspecting inputs).
- **181/181 local + 10/10 prod returns recompute cleanly** through the fixed engine
  (real-data smoke test, 0 throws).
- Live click-through: dashboard, client list, all 11 ClientDetail tabs, Tax
  Calculator, Planning (cross-strategy stacking) all verified working.
- Deployed: pm2 `taxflow` online + healthz ok; frontend bundle rsynced.

## Recommended next (prioritized)
1. **DB-scale (still open, low-urgency at demo scale):** `GET /clients` has no
   pagination (SELECT * whole table) — keyset-paginate + project columns + move
   ClientList filtering server-side (frontend change; won't port to Haven). The
   durable hit-list fix is a precomputed `planning_score` column on `tax_returns`
   ranked by one indexed `ORDER BY ... LIMIT` (replaces the per-client recompute).
2. **Re-run the lost `tax-state-plan` audit dimension** (its agent failed to emit
   structured output) for code-level planning-detector + state-math review — the
   scenario battery covered the intent but not the detector source.
3. **Migration cutover** — baseline the prod Neon DB + finish versioned migrate
   (the `0000`-only baseline is the root cause of the drift class; `docs/db-migrations.md`).
4. God-file split (planningEngine 8.1k / taxCalculator 5.9k / taxReturnEngine 3.2k /
   ClientDetail 5k lines) — deferred: high-risk, low durable value mid-Haven-migration.

---

# Handoff Note — 2026-06-03 (P0 legal/security gate — 6 commits on branch `p0-legal-security-gate`)

Session continuation point for the next Claude (or human) on TaxFlow Assistant.

## ⚡ Read this first

This session was triggered by a full product/codebase **audit**
(`docs/product-assessment-2026-06-02.md`) which found a strong engine + planning
architecture trapped in an unshippable trust layer. We then implemented the
**P0 legal/security gate**. Durable TODO: **`docs/todo.md`** (the new P0 section
at top). Compliance backbone: **`docs/compliance/`**. Branch:
**`p0-legal-security-gate`** (6 commits, pushed; **NOT merged to main, NOT
deployed** — that's the user's call via PR).

## Headline — what landed (all 6 commits green, pushed)

| Commit | What |
|---|---|
| `3406f4e` | **P0-6** CI (`.github/workflows/ci.yml`) + `scripts/tsconfig.tests.json` type-checks the test tree (closes "green-on-wrong-shape"); **P0-7b** TY2026 §199A SSTB QBI band fall-through fixed via one source of truth `qbiPhaseInBand` (MFS=single). +12 hand-calc assertions. |
| `306326c` | **P0-4** app-layer bearer-token auth gate (`API_AUTH_TOKEN`) on `/api` + frontend token getter; **P0-7a** removed FALSE "TLS/encryption-at-rest/read-only-creds" claims from outreach docs. |
| `e129ff3` | **P0-3** compliance backbone: `docs/compliance/WISP.md` (GLBA), `section-7216-consent.md` (verbatim consent instrument + spec), `runbook-tls-s3-secrets.md`, README. + the audit report. |
| `e46c283` | **P0-5** AES-256-GCM field encryption for SSN/TIN (`fieldCrypto.ts`) wired into W-2/1099 routes + document-approve; idempotent + versioned prefix + backfill script. |
| `f546e51` | **P0-2** fail-closed §7216 consent gate (`consentGate.ts`) before the Gemini call + `disclosure_consents` table + record/list/revoke endpoints. |
| `291637f` | **Review fixups** — closed 4 issues an adversarial self-review found (CI typecheck was red; consent gate was fail-open in edge-auth prod; planning-AI endpoints were ungated; a decrypt-sentinel could destroy a TIN). |

**Verification:** full workspace `pnpm run typecheck` GREEN; **43 no-API suites /
3,372 assertions green** (3 new security suites: auth 11, consent 12, crypto 17;
+ the QBI regression 12). api-server + db + tax-app typecheck clean.

## 🔴 USER ACTION — P0-1 (only you can do)

Rotate the leaked **Neon `neondb_owner` password** + **Gemini API key**. Full
steps: **`docs/compliance/runbook-p0-1-rotate-credentials.md`**. Note: I scanned
all git history — the creds were **never committed**, so NO history scrub /
force-push is needed; rotation in the consoles fully closes it.

## New env vars (all default to today's demo behavior when unset)

- `API_AUTH_TOKEN` — when set, every `/api` route requires `Authorization:
  Bearer <token>` (else 401). Unset = open demo + a loud startup warning.
- `PII_ENCRYPTION_KEY` — base64 32-byte AES-256 key (`openssl rand -base64 32`).
  When set, SSN/TIN are encrypted at rest; unset = plaintext passthrough (demo).
  After setting it on existing data, run `backfill-encrypt-pii.ts`.
- `REQUIRE_7216_CONSENT` — gate before AI extraction/planning. **Defaults to ON
  when `NODE_ENV=production`**, OFF otherwise. Override true/false.

## Deploy (when the user approves the PR → main)

Needs: api-server cycle + **`db push` (new `disclosure_consents` table)** +
frontend rsync (main.tsx changed). See CLAUDE.md "EC2 deploy". Extra prod env to
set before real PII: `API_AUTH_TOKEN`, `PII_ENCRYPTION_KEY`,
`REQUIRE_7216_CONSENT=true`, `NODE_ENV=production`, `ALLOWED_ORIGINS`.

```bash
# on the box, after git pull of the merged branch
pnpm install
pnpm --filter @workspace/db run push        # creates disclosure_consents
pnpm --filter @workspace/api-server run build
pm2 restart taxflow --update-env
curl http://localhost:8080/api/healthz
# locally: pnpm --filter @workspace/tax-app run build && rsync … (see CLAUDE.md)
```

## What's left (prioritized — see docs/todo.md P0 section + the audit roadmap)

1. **P0-1 (user)** — rotate creds.
2. **Operator/infra (before real PII)** — TLS + edge auth (Runbook A); S3+KMS for
   the **document blob** (still plaintext base64 in PG — field encryption does
   NOT cover it; this is P0-blocking, see README P0-5); Secrets Manager;
   Google DPA; counsel sign-off on WISP + §7216 instrument; name the Qualified
   Individual; make CI a required status check.
3. **Frontend fast-follows** — a login form (token is bootstrapped via
   `?api_token=` / localStorage today) + an in-app §7216 consent-capture step
   (the `disclosure-consents` endpoints exist; nothing calls them yet, so with
   `REQUIRE_7216_CONSENT=true` every upload 403s until consent is POSTed).
4. **Test-typecheck ratchet** — drive the `tsconfig.tests.json` quarantine (25
   legacy files, 143 pre-existing type errors; genuine wrong-shape fixtures to
   fix first: `stateWagesBox16`/`interestIncomeBox1`/`description`) → 0.
5. **Versioned migration for `disclosure_consents`** (currently push-only; the
   migrate cutover is otherwise blocked per docs/db-migrations.md).
6. **Then the product roadmap** from the audit (P1: engine-verified planning
   delta as the headline number; multi-year Roth/distribution optimizer; Form
   2210; diagnostics engine; per-field extraction confidence; land 1 real CPA
   partner). See `docs/product-assessment-2026-06-02.md` §7.

## How to start the next session

```
Project: TaxFlow Assistant. Read: .claude/handoff.md, docs/todo.md (P0 section),
docs/product-assessment-2026-06-02.md (the audit + roadmap), docs/compliance/.

State (2026-06-03): the P0 legal/security gate is implemented on branch
p0-legal-security-gate (6 commits, pushed, NOT merged/deployed). Auth gate, PII
field encryption, §7216 fail-closed consent gate, WISP + consent instrument + CI
all landed; 43 suites/3,372 assertions green. The user is rotating the leaked
creds (P0-1). Next: either (a) finish the operator/infra gate (TLS, S3+KMS doc
blob, DPA, counsel) before real PII, (b) the frontend login + consent-capture UX,
or (c) start the product roadmap (engine-verified planning delta; multi-year
optimizer; Form 2210; diagnostics). Hand-calc every tax value; commit per chunk;
keep computeTaxReturnPure pure.
```
