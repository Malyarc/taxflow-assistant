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
