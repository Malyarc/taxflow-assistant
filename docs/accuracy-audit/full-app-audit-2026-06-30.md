# Full-App Audit — 2026-06-30

A from-scratch, independent audit of the entire TaxFlow Assistant: tax-calculator
IRS correctness, tax-planning strategy coverage, whole-app code review, and
end-to-end browser/usability testing. Branch `claude/complete-app-audit-testing-wewqm5`.

## Method (independent of the existing 8,474-assertion suite)

- **Engine correctness fan-out** — 14 subsystem agents, each re-deriving the IRS
  value from the primary source (Rev. Procs. / IRC / form worksheets), probing the
  LIVE `computeTaxReturnPure`, then adversarially verifying every candidate.
- **Planning coverage fan-out** — every one of the 107 catalog strategies driven
  through a constructed triggering + non-triggering scenario.
- **Whole-app code review** — routes/middleware, security, frontend, PDF/exports,
  and 25+ feature libs, adversarially verified.
- **Machine oracles** — the `tenforty` differential oracle (an independent IRS-tax
  library; 758 scenarios), the fast-check property/fuzz harness (~9,836 runs), and
  the cross-year metamorphic suite.
- **Browser/usability** — Playwright + the pre-installed Chromium: 4 passes (route
  smoke, deep-interact, full CRUD/form-submit, CPA-tools), capturing JS/page errors
  and API ≥400s.
- **`/deep-research`** — requested an IRS-figure reference; the remote environment's
  network policy blocked all 25 outbound fetches (IRS.gov etc.), so the validation
  ground truth was instead the `tenforty` oracle (a stronger, executable IRS check)
  plus the agents' first-principles re-derivations.

## Baseline (re-established on a fresh clone) — all green

| Check | Result |
|---|---|
| Typechecks (libs, api-server, scripts, tax-app, scripts:tests) | clean |
| No-API battery | **145 suites / 8,500 assertions / 0 failed** (after this audit) |
| Yes-API integration | 17 suites / all pass |
| Property/fuzz/boundary/metamorphic harness | ~9,836 runs, all invariants hold |
| Differential oracle vs `tenforty` | 758 scenarios, 0 divergences |
| Frontend build | clean |

## Tax-calculator engine — 9 confirmed bugs (7 fixed + regression-locked, 2 deferred)

| # | Sev | Subsystem | Bug | Status |
|---|---|---|---|---|
| ENG-1 | MED | Sch SE | Non-farm **optional method** double-haircut by 0.9235 — returned $941.97 where Schedule SE Line 4b requires **$1,020.00** ($10k gross). A wrong-expectation test pinned the bug. | **Fixed** (`calculateSelfEmploymentTax` + 4 call sites; tests corrected) |
| ENG-2 | MED | NIIT | §163(d) investment interest not subtracted from the NIIT base (Form 8960 line 9c) → over-stated NIIT ($3,800 vs $1,520). | **Fixed** (NII base now nets the allowed interest when itemized) |
| ENG-4 | LOW | OBBBA | Car-loan §163(h)(4) phase-out used smooth 0.20×excess instead of the per-$1,000 **round-UP** ("or fraction thereof"). | **Fixed** |
| ENG-5 | LOW | OBBBA | Tips §224 phase-out used smooth instead of per-$1,000 **round-DOWN**. | **Fixed** |
| ENG-6 | LOW | OBBBA | Overtime §225 phase-out used smooth instead of per-$1,000 **round-DOWN**. | **Fixed** |
| ENG-7 | LOW | IRA | Deduction phase-out omitted the §219(g)(2)(B) **$200 minimum floor** (Pub 590-A Wksht 1-2). | **Fixed** |
| ENG-8 | LOW | IRA | Deduction phase-out omitted the **round-to-next-$10** rule. | **Fixed** |
| ENG-3 | LOW | §1(h) | A net short-term loss under-reduces unrecaptured §1250 when a 28% bucket co-exists. | **Deferred** — directly conflicts with the prior verified F3 "28%-bucket-first" fix; can't fetch the IRS Unrecaptured-§1250 Worksheet to adjudicate (network blocked); the §1(h)(1)(E) area has a documented history of three prior misreadings. Tracked. |
| ENG-9 | LOW | §280F | Luxury-auto caps fall back to 2026 values for pre-2024 vintages. | **Deferred** — needs network-blocked per-year Rev. Proc. cap tables. Tracked. |

New regression file `tax-engine-audit-2026-06-30-tests.ts` (26 hand-calc'd assertions)
pins every applied fix. The deferred two are LOW-severity, narrow-scenario, and
documented rather than guessed — consistent with "hand-calc against the published
rule, never assert what you can't verify."

## Tax-planning strategy engine — 107/107 confirmed, 0 bugs

All 107 catalog strategies (96 G1 federal + 5 G4 multi-year + estate/gift) fire for
a constructed triggering scenario and suppress for a non-triggering one, with finite,
sane savings. The "LLM never touches the math" architecture holds.

## Whole-app code review — 11 confirmed bugs, all fixed

| # | Sev | Where | Bug | Fix |
|---|---|---|---|---|
| 1 | **HIGH** | `taxReturnPipeline.ts` | Cross-year itemized contamination: the `existing` return was loaded by clientId only (arbitrary/lowest year), leaking another year's `itemizedDeductions` into a different year's compute → forced itemization + silently persisted understated tax. | Year-scope the `existing` query (verified end-to-end: TY2025 no longer leaks TY2024's $42k itemized) |
| 2 | MED | `planning.ts` | Fractional/uncapped `?limit` → Postgres LIMIT 500. | `Math.min(Math.floor(limit), 200)` |
| 3 | MED | `ClientDetail.tsx` | Blank W-2 Tax Year coerced to year-0 → W-2 excluded from every return. | `validTaxYear` guard on save |
| 4 | MED | `rothOptimizer.ts` | Unbounded/negative `iraGrowth` → negative recommended conversions. | clamp growth [0.5, 2] |
| 5 | MED | `multiYearEngine.ts` | Negative income-growth → oscillating/exploding projections. | clamp growth [0.5, 3] at the shared seam |
| 6 | MED | `w2data.ts` / `form1099data.ts` | Create/edit recalculated the wrong tax year → stale return. | pass the record's `taxYear` |
| 7 | LOW | `app.ts` | Child-record CREATE on a missing client → 500. | map pg FK violation (23503, incl. wrapped) → 404 |
| 8 | LOW | `tax-returns.ts` | CSV/JSON/TXT exports omitted `Cache-Control: no-store` despite PII. | `setNoStorePii` |
| 9 | LOW | `ReviewExtractionModal.tsx` | Hardcoded `bg-amber-50` not dark-safe. | `dark:` variants |
| 10 | LOW | `ReturnReview.tsx` | Diagnostics raw `fetch` bypassed the bearer token. | shared `authHeaders()` |
| 11 | LOW | `taxReturnEngine.ts` / pipeline | `effectiveTaxRate` could overflow `numeric(6,4)` → whole recalc fails (silently). | clamp at the persist layer |
| UX-1 | LOW | `Dashboard.tsx` | "Top planning opportunities" labeled "Highest-value" but score-ranked (non-monotonic $). | relabel to reflect score ranking |

## `/code-review max` on the fix diff — 2 self-caught defects fixed

A max-effort review (10 finder angles → adversarial verify → sweep) of the audit-fix
diff caught **two real defects in the fixes themselves**, both fixed + re-verified:

- **MED** — the 1099 create/edit recalc-year fix (#6) was incomplete: a PATCH that
  *moves* a 1099 to a different tax year recalced only the new year, leaving the source
  year's persisted return stale. Fixed to recalc both years when they differ (verified:
  moving a $50k NEC 2024→2025 now drops the 2024 SE tax to $0 and lands it on 2025).
- **LOW** — the NIIT §163(d) gate (ENG-2) keyed on `useItemizedDeductions` alone, so it
  fired even when the larger *legacy flat itemized override* won (investment interest not
  actually on Schedule A) → understated NIIT in that edge. Fixed to also require
  `scheduleAItemizedWithInvInt >= additionalDeductions` (verified both branches).
- One PLAUSIBLE finding (the `authHeaders` helper converted only ReturnReview, not
  ClientDetail's ~28 pre-existing bare fetches) was triaged **out of scope** — it's a
  pre-existing pattern, not introduced by this diff, and inert in every current
  deployment (the app-layer token is unset; broader per-component auth is the D15/Haven
  work). Documented, not changed.

## Browser / usability — production-quality

4 Playwright passes across every route, all 13 client tabs, the 3-pane review
workspace, the CPA-tools cards, dark mode, the command palette, and full CRUD
(create client via the Radix-select form → 201 → correct persistence; add W-2;
download all 3 PDF exports → 200/PDF; delete). **Zero JS/page errors, zero API
4xx/5xx** (the only console line is an environment artifact: Google Fonts is blocked
by the sandbox network → harmless system-font fallback). The documented-fragile
Radix `formReady` gate works correctly.

## Bottom line

The engine and planning surfaces were already exceptionally well-validated; this
audit drove the independent-technique bug-discovery rate further down, fixing 2
medium-severity engine bugs (one masked by a wrong-expectation test), a high-severity
data-pipeline bug that silently persisted wrong tax, and a batch of robustness/UX
defects — with a full green regression bar and two LOW findings honestly deferred
rather than guessed. The product is in a ready-to-use state for its CPA-overlay scope
(the standing T0 operator/legal launch gate — credential rotation, S3+KMS, edge auth
— remains, as documented in `docs/MASTER-TODO.md`).
