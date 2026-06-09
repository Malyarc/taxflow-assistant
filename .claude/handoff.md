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
