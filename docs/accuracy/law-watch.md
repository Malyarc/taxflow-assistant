# Law-watch — currency register + quarterly sweep runbook (T1.5 #8)

The engine's accuracy decays silently as tax law changes. Three defenses:

1. **DOR/IRS-pinned fixtures** — `scripts/src/tax-engine-law-currency-fixture-tests.ts`
   pins EXACT published values (not just finiteness). A stale rate fails the build.
2. **This register** — pending effective dates to act on, with the trigger date.
3. **The quarterly sweep runbook** (below) — the recurring process.

> Why pinned fixtures: the `tax-engine-year-coverage-tests.ts` suite only checks
> that year-indexed values are finite + monotonic. The 2026-06-08/11 audits found
> several state rates that were finite but WRONG (CO/WI/ID/SC/OH/NE/KY). Finiteness
> ≠ correctness. The fixtures pin the number.

---

## Pending effective-date register

| Effective | Item | Action when it hits | Status |
|---|---|---|---|
| **after TY2025** | OBBBA energy credits §25C / §25D / §25E phase-outs (catalog G1.33/34/37) | Confirm termination; planning catalog `validUntil` already 2025 | tracked |
| **6/30/2026** | §30C alternative-fuel-vehicle-refueling property terminates (NOT 12/31/25) | Verify mid-year cutoff still modeled | adjudicated (T1.0) |
| **after TY2028** | OBBBA Schedule 1-A deductions (tips §224 / overtime §225 / car-loan §163(h)(4) / senior §151(d)) sunset | Re-confirm sunset; catalog G1.97–100 `validUntil` 2028 | tracked |
| **annual (each TY)** | **CO flat rate — TABOR surplus trigger.** 2024 = 4.25%, 2025 = 4.40%. The rate moves with the surplus refund; do NOT assume last year's value | Re-pull CO DR 0104 booklet each year; update `STATE_TAX_DATA_BY_YEAR` + the CO fixture | **recurring — high risk** |
| **TY2025/2026** | State rate-cut batch: IN, MS, NC, NE, GA, MT, OK (phased reductions) | Verify each year's scheduled rate vs the DOR; pin in the fixture | partially pinned (NE/OH/SC/ID/KY done) |
| **TY2026** | WV SB 392 retroactive personal-income-tax rate cut | Confirm 2026 rates vs WV State Tax Dept | adjudicated (T1.0) |
| **TY2026** | HI Act 46 bracket/std-ded phase-ins (multi-year) | Pull HI DOTAX each year through the phase-in | tracked |
| **annual** | IRS Rev. Proc. inflation adjustments (std ded, brackets, SALT phase-down threshold, AMT exemption, EITC, FEIE, SS wage base, kiddie, §199A thresholds) | Append the new TY to `SUPPORTED_TAX_YEARS`; fill every year-map; run fixtures + year-coverage + catalog-freshness | recurring |
| **TY2026** | ACA enhanced PTC (ARPA/IRA) expires → pre-ARPA 400%-FPL cliff + applicable figures restored | Already restored (FC-01); re-confirm if Congress extends the enhanced subsidies | adjudicated (T1.0) — **watch for extension** |

### Known accuracy sub-gaps (candidates, not regressions)

- **EITC uses the §32 formula, not the $50-band EIC Table** (≤$1 in the
  phase-in/out regions). The income Tax Table analogue was closed in T1.5 #1
  (`taxComputationMethod: "table"`); an EIC-table-emulation extension would close
  this. See `docs/accuracy/golden-test-pack.md`.
- **AMT Form 6251 line 2c (§163(d) investment-interest difference) + line 2d
  (percentage depletion §57(a)(1)) are not modeled.** Both are rare AMT
  preference items (line 2c is nonzero only when regular vs AMT investment
  interest differ — e.g. private-activity-bond income). The Form 8801 MTC model
  treats whatever AMT preferences ARE modeled with the correct exclusion-vs-
  deferral split; these two prefs simply aren't entered. Low-frequency; tracked.

### T1.5 accuracy-program status (the "most accurate engine" tier)

- **#1 Tax-Table mode** — done (`docs/accuracy/tax-table-mode.md`).
- **#2 Golden-test pack** — done (`docs/accuracy/golden-test-pack.md`).
- **#3 Oracles** — the differential-oracle harness (T0.3 A2) already runs 758
  scenarios vs tenforty/OTS with 0 unexplained divergences. The cross-year +
  filing-status **metamorphic** layer (`tax-engine-cross-year-metamorphic-tests.ts`,
  139 assertions, no external oracle) is added and CI-runnable. The harness
  COLUMN extension (dependents/CTC, itemized, SE-with-QBI, NY/NJ/MA state batches)
  is CI-gated on the oracle install — **`tenforty` does not build on the dev
  Python 3.9 / Xcode toolchain** (pip build failure), so that extension runs in
  CI/where the oracle is available, not locally. A `ustaxes`/IRS-ATS second
  oracle remains optional.
- **#4 MeF diagnostics** — done (`returnDiagnostics.ts` "MeF e-file rules").
- **#7 Form 8801 full MTC + §1(h)** — delivered in T1.0b (Part I exclusion-vs-
  deferral, §53(c)/(d) limits, carryforward — `tax-engine-t10b-othertax-tests.ts`
  + the AMT-credit round-trip in `tax-engine-carryforward-audit-tests.ts`) and
  T1.0l (§1(h) Schedule D Tax Worksheet). Remaining: the rare line 2c/2d prefs above.
- **#5 Per-dependent data model** — the PURE engine core is delivered: each
  dependent's DOB/SSN/relationship/residency/student/disabled drives the EXACT
  credit gating (CTC / ODC / EITC-child / §21 care / under-6) via
  `dependents.ts` (`deriveDependentCounts`), threaded as the
  `TaxReturnInputs.dependents` contract (the Haven seam) — present → derives +
  overrides the scalar counts; absent → legacy counts unchanged.
  `tax-engine-per-dependent-tests.ts` (16 hand-calc'd). **Product-surface
  follow-up (per the migration roadmap — engine ports, frontend/DB do NOT):** the
  `dependents` DB table + CRUD endpoints + a per-dependent entry UI + organizer/
  roll-forward of dependent rows. Until that lands, the derivation is reachable
  by any `computeTaxReturnPure` caller (Haven, workpapers) but not yet by the
  TaxFlow app's CRUD — same engine-capability/UI-follow-up split as #1.
- **#6 Community-property MFS** — `communityProperty.ts` (9-state set + 50/50
  Form 8958 split) wired into the MFJ-vs-MFS optimizer (FS-3 closed);
  `tax-engine-community-property-mfs-tests.ts` (35).
- **#8 Law-watch** — this file + `tax-engine-law-currency-fixture-tests.ts`.
- **#9 Filing-status trait table** — `filingStatusTraits.ts` + property test;
  cluster threshold functions adopt it; remaining sites migrate incrementally.

---

## Quarterly law-currency sweep runbook

Run at the start of each calendar quarter (and always before opening a new filing
season). ~1–2 hours.

1. **Federal (IRS).** Check the latest Rev. Proc. (annual inflation adjustments)
   + any mid-year statutory change (OBBBA implementation notices). Diff against
   the year-maps in `taxCalculator.ts` (`FEDERAL_BRACKETS`, `getFederalStandardDeduction`,
   `getSaltCap`, `SS_WAGE_BASE`, `CTC_PER_CHILD`, `AMT_DATA`, EITC/FEIE/kiddie maps).
2. **States (DOR).** For each state with a scheduled change in the register above
   (and CO every year for TABOR), pull the DOR booklet and diff the rate / std
   ded / exemption against `STATE_TAX_DATA_BY_YEAR`.
3. **Update + pin.** Edit the data tables, then update the matching literal in
   `tax-engine-law-currency-fixture-tests.ts` (cite the source) so the value is
   pinned going forward.
4. **Run the green bar:**
   - `pnpm --filter @workspace/scripts run test:no-api` (includes the law-watch
     fixtures + year-coverage + catalog-freshness + golden pack).
   - If a planning `validUntil` or score changed:
     `pnpm --filter @workspace/scripts exec tsx src/recompute-planning-scores.ts`
     (after deploy, on the box — see CLAUDE.md "EC2 deploy").
5. **Activate a new tax year** (once a year): append it to `SUPPORTED_TAX_YEARS`
   in `taxYears.ts` → the compiler flags every year-map missing the key → fill
   IRS/DOR values → run the fixtures + year-coverage + catalog-freshness → run
   the planning-score sweep.
6. **Record** the sweep outcome (what changed / confirmed-current) in this file's
   register so the next quarter starts from a known baseline.
