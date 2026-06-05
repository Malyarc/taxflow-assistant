# CLAUDE.md — TaxFlow Assistant

Project-level notes for Claude sessions. Things that change every sprint live in `.claude/handoff.md` (a session-handoff doc, may be stale). The canonical forward-looking roadmap is `docs/haven-migration-roadmap.md`.

**This app is being MIGRATED into the Haven app** (`/Users/johntang/Documents/haven` — NestJS + Prisma + Next.js portals + Expo mobile, multi-tenant). The pure engine (`computeTaxReturnPure`) + planning engine + their tests port 1:1; auth/frontend/infra do NOT (Haven has its own). The canonical forward-looking roadmap for what to enhance in tax prep + tax planning BEFORE migrating is **`docs/haven-migration-roadmap.md`** — read it before picking up calc/planning work. Keep `computeTaxReturnPure` PURE (it's the migration interface).

## Deploy policy (STANDING — set by John 2026-06-03)

**Always merge to `main` and deploy EVERYTHING to prod (api-server + frontend rsync + DB schema) after completing a chunk of work — do NOT ask first.** Work may be staged on a feature branch, but finish by fast-forwarding `main`, pushing, running the full EC2 deploy cycle (see "EC2 deploy" below) + the frontend rsync, applying any schema change to the prod DB, then health-check.

**DB schema → prod — VERSIONED MIGRATIONS are now the source of truth (cutover COMPLETE 2026-06-04: dev + prod baselined to `0000`+`0001`; the EC2 deploy runs `drizzle-kit migrate`).** Normal path: edit `lib/db/src/schema/*` → `pnpm --filter @workspace/db run generate` → **REVIEW the generated SQL** (catch any drop/rename) → commit → the deploy's `migrate` step applies it. The additive/destructive rules below still govern any *out-of-band* hotfix DDL (when you can't do a full deploy):**
- **Additive changes (new table / column / index): apply AUTOMATICALLY** via idempotent additive DDL — `CREATE TABLE IF NOT EXISTS …`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`, `CREATE INDEX IF NOT EXISTS …`. These can only add — never drop or lose data. psql isn't installed on the box; run the DDL with the box's `pg` client: a tiny `.mjs` in `~/taxflow-pro/lib/db/` doing `import pg from "pg"` + `new pg.Pool({ connectionString: <DATABASE_URL from pm2 env 0>, ssl: { rejectUnauthorized: false } })` + `pool.query(ddl)`. (Precedent: `disclosure_consents`, applied 2026-06-03.)
- **Destructive changes (drop/rename column, type change, drop table): NEVER auto-apply.** Show John the exact SQL and get explicit OK first — these can silently lose data, and `drizzle.config.ts` explicitly forbids blind `push` to prod. (Proper long-term fix: baseline the prod DB + finish the versioned-migrate cutover — tracked in `docs/db-migrations.md`.)

**The live box is a synthetic-data demo:** keep `API_AUTH_TOKEN` / `PII_ENCRYPTION_KEY` UNSET and the §7216 consent gate OFF there (set `REQUIRE_7216_CONSENT=false` if `NODE_ENV=production`) so the open demo flow stays working — those P0 controls activate only on a real-PII deployment.

## What this is

CPA-focused tax-prep app. **Phase 4 decision (2026-05-21): committed to Option A — AI overlay for existing CPA software (Lacerte / ProConnect / Drake / UltraTax CS).** Consumer DIY (Option B) is parked.

The calc engine is still designed to be reusable (`computeTaxReturnPure` in `taxReturnEngine.ts`) — keeping it portable in case Option B ever resurfaces, but no consumer-facing surface area is being built.

Live at `http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com`. Repo: `github.com/Malyarc/taxflow-assistant`.

## Layout

```
artifacts/
  api-server/   Node 22 + Express 5 + Drizzle ORM + Pino
  tax-app/      React 19 + Vite + Tailwind v4 + shadcn/ui + Radix + wouter + React Query

lib/
  api-spec/                       OpenAPI 3.1 — single source of truth
  api-zod/                        Generated server Zod schemas (Orval)
  api-client-react/               Generated React Query hooks (Orval)
  db/                             Drizzle schema + Postgres client
  integrations-openai-ai-server/  AI client (OpenAI SDK pointed at Gemini compat endpoint)

scripts/   Workspace scripts (tax-engine test runners)
```

## Codegen + schema workflow

- Edit `lib/api-spec/openapi.yaml` → `pnpm --filter @workspace/api-spec run codegen` regenerates `api-zod` + `api-client-react`.
- Edit `lib/db/src/schema/*` → `pnpm --filter @workspace/db run push` applies to Postgres.
- New 1099-style field on a client/return → update both `openapi.yaml` and the relevant `lib/db/src/schema/*.ts`. Then codegen, then push. Forgetting `CreateClientBody`/`UpdateClientBody` (separate from the response `Client` schema) is the common mistake — those gate what the API actually accepts.
- When the api-server typecheck stalls with "Property X does not exist on type" after a schema change: delete `lib/db/dist/` and `lib/db/tsconfig.tsbuildinfo`, then `pnpm --filter @workspace/db exec tsc -b --force`. The stale composite project build is the culprit.

## Critical tax-domain invariants

Future-you will be tempted to "simplify" these. Don't.

1. **AGI = Form 1040 Line 9.** AGI includes LTCG, qualified dividends, and STCG. They get taxed at preferential rates *downstream*, but they go *into* total income / AGI first. Pipeline pattern:
   - `ordinaryAdditionalIncome` includes all of LTCG/QDIV/STCG so AGI is correct for NIIT and state tax.
   - For federal-tax computation, `ordinaryPortionOfTaxable = taxableAfterQbi − LTCG − QDIV` is what gets passed to `calculateFederalTaxWithCapitalGains`. STCG stays in ordinary portion (taxed at ordinary rates).
   - This was fixed in commit `9a69b66` after a real bug shipped.

2. **Credit ordering follows IRS Form 1040 / Schedule 3.** Non-refundable credits apply only against the *income-tax* portion (`regularFederalTax + amtTax`), **not** against SE tax or NIIT. Order in `taxReturnPipeline.ts`: CTC non-refundable → Saver's Credit → Education AOC non-refundable → LLC → Dependent Care. Then refundable credits (EITC, AOC refundable 40%, ACTC) add directly to the refund. Each non-refundable credit is `Math.min(computed, remainingTax)`-capped against the running tax.

3. **IRA deduction phase-out uses MAGI ≈ AGI-computed-WITHOUT-the-IRA-deduction.** Per IRS Pub 590-A. Pipeline bootstraps: compute above-the-line deductions excluding IRA → provisional AGI → IRA deduction → final AGI.

4. **State tax base:** `calculateStateTax(federalAgi, state, status, year)` internally does `federalAgi − stateStdDed`. For states that conform to federal taxable income (CO, ID, IA, MN, MO, MT, NM, ND, SC — the `FED_CONFORMING_STD_DED_STATES` set in `stateTaxData.ts`), the std ded *is* the federal std ded, so `AGI − federalStdDed = federalTaxableIncome` mathematically. `build2025Data()` auto-applies the 2025 federal values to those states. To add a state to that set, also seed its 2024 std ded with `{ ...FED_STD_DEDUCTION_2024 }`.

5. **Schedule A is computed from per-line adjustments and coexists with the legacy single-number override.** Effective itemized total = `max(scheduleA.totalItemized, legacy additionalDeductions override)`. Auto-pick vs. standard deduction based on which is larger; `useItemizedDeductions: true` override forces itemized. Don't remove the legacy path — historical clients still have data in that column.

6. **Capital losses ARE netted (Schedule D) with the $3k / $1,500-MFS ordinary offset + character-preserving carryforward.** `taxReturnEngine.ts` (~1663–1720) cross-nets STCG/LTCG, applies up to $3,000 ($1,500 MFS) of net loss against ordinary income, and carries the excess forward preserving short/long character. The `Math.max(0, …)` floors apply only to the *preferential-rate* buckets, AFTER netting. (This invariant previously read "Capital losses are dropped, not subtracted" — that was STALE; corrected in the 2026-05-28 deep audit, verified by `tax-engine-realworld-scenarios-tests.ts` S9.)

## Frontend conventions

- **Branding: Brookhaven palette** (2026-05-28 revamp). Tokens live in `artifacts/tax-app/src/index.css` (`@theme inline` + `:root`/`.dark`): Trusted Blue `#231F55` = `--primary`; Brookhaven Blue `#41B9EA` = `--brand` (use `--brand-ink` for text/links on light backgrounds — the bright brand blue fails WCAG contrast as small text on white); Yellow `#F0CA17` = `--gold` (use SPARINGLY); Powder Blue `#8ED4F0` = `--powder`; `--success` (green) for positive $/refunds; `--destructive` for owe/loss. **Use semantic tokens (`bg-brand`, `text-brand-ink`, `text-success`, `text-muted-foreground`), NOT hardcoded Tailwind palette classes** (`bg-slate-100`, `text-indigo-700`, …) — those were swept out (172 of them). Amber/yellow Tailwind classes are still OK for genuine *warning* callouts. Brand mark: `src/components/BrandMark.tsx` (three ascending bars). 45° gradient/pattern utilities: `.bg-brand-gradient`, `.bg-brand-gradient-soft`, `.text-gradient-brand`, `.brand-pattern`. Design-doc source: `~/Downloads/Brookhaven Brand Bible_v1.pdf` (PDF reading needs PyMuPDF/poppler).
- **`--accent` is a subtle cool tint, not a bold color.** Radix menus/selects use `bg-accent`/`text-accent-foreground` for hover/selected states — keep it subtle. For a bold pop use `--brand` or `--gold` explicitly. (The original template wrongly set `--accent` to bright yellow, which leaked into every dropdown — fixed in the revamp.)
- **Layout is desktop-first with a mobile fallback.** Sidebar is `hidden lg:flex`; a compact `MobileTopBar` shows below `lg` (`App.tsx`). The scroll container is `<main className="overflow-auto">`, NOT the window — programmatic scroll/screenshots target `main`, not `window.scrollTo`.
- **ClientDetail tab bar** is a horizontally-scrollable icon-pill bar (`flex gap-1 overflow-x-auto scrollbar-thin`, shared trigger class `TAB_TRIGGER_CLS`). Don't revert to a fixed `grid-cols-N` — tabs collide once there are 10+.
- **Money fields use `<CurrencyInput>`**, never `<Input type="number">`. The CurrencyInput handles `$` prefix, commas, strip-on-focus.
- **Radix `<Select>` needs a `formReady` gate in edit mode** before mounting controlled selects. Otherwise Radix fires `onValueChange("")` on first render before SelectItems mount, wiping form state. See `ClientForm.tsx` for the working pattern (`formReady = !isEdit || (existing != null && form.email === (existing.email ?? ""))`).
- **`SelectContent` is capped at `max-h-96`** (`components/ui/select.tsx`) to keep long dropdowns (51 states) scrollable instead of overflowing the viewport.
- **shadcn-style Tabs use `data-state` for active/inactive.** When clicking tabs programmatically (eg in browser tests), `.click()` alone may not work — dispatch `mousedown` then `click` MouseEvents.

## Testing

- **Hand-calc every expected value** against IRS published rules before asserting it. The user has been burned by tests passing while the underlying calc was wrong (e.g. the AGI/Line-9 bug shipped despite unit tests passing).
- **Unit tests alone aren't enough.** Standalone suites verify the calculator; integration suites hit a live API at `localhost:8080` and exercise the full pipeline. Run both.
- **Adding a new test file** also requires adding it to `scripts/tsconfig.json`'s `exclude` array — the workspace typecheck fails otherwise.
- **Test files (current set, ~3,320 assertions across 39 no-API suites; **CORE OBBBA conformance shipped 2026-06-02** (commits `f22c9c1` + `8831708`): SALT $40k+§164(b)(7) phase-down, §199A $400 floor + MFS-threshold fix, native TY2026 (SUPPORTED_TAX_YEARS + all 20 year-maps + AMT 50% phase-out), CTC $2,200, §179 $2.5M, bonus 100% TY2026, + the 4 new OBBBA deductions (tips/overtime/car-loan/senior) modeled as real `calculateObbbaSchedule1ADeductions` adjustments (Schedule 1-A → line 13b); **OBBBA planning refresh catalog v1.19.0 shipped 2026-06-02** — 101 strategies (96 G1 + 5 G4): TY2026 dollar values (QCD/adoption+refundable/SEP/HSA/deferral/§401(a)(17)/§448(c)), §199A TY2026 thresholds + widened phase-in + $400-floor note + QBI permanence (validUntil→2099), PTET recoded §164(b)(6)+(7) with $40k cap + phase-down, 4 NEW deductions G1.97–G1.100 (tips/overtime/car-loan/senior); **core TY2025 std-ded corrected to OBBBA $15,750/$31,500/$23,625**; planning suite now 527 assertions — ALL 10 K-list federal-engine gaps + ALL 4 state-engine gaps closed; C-batch shipped 2026-05-26; **Phase H FULLY COMPLETE + H1 CATALOG CLOSED 2026-05-27** including all sub-gaps + H1 catalog continuation through v1.17: 12/12 H items + H3 multi-year detector wiring + H5 4 new asset types + H6 Form 8606 Part III + H8 LLM-discovery rule-engine verification + **H1 catalog v1.17 (72 NEW G1 strategies total) — TOTAL 97 catalog strategies** (92 G1 + 5 G4). **H1 CANONICAL UNIVERSE CLOSED at v1.17.** Plus: validation audit (`docs/planning-strategy-audit.md` — IRC + TY2024/2025 limits verified for all 92) + end-to-end scenarios test file (11 realistic CPA archetypes). ~464 NEW hand-calc'd assertions in the Phase H + closure session (28 H3-wiring + 40 H6-PartIII + 23 H8-verifier + 24 v1.4 + 26 v1.5 + 24 v1.6 + 20 v1.7 + 21 v1.8 + 20 v1.9 + 20 v1.10 + 20 v1.11 + 27 v1.12 + 22 v1.13 + 18 v1.14 + 16 v1.15 + 17 v1.16 + 20 v1.17 + 74 scenarios); previous Phase H batch 222; Phase G4 70 + G5 21; Phase E 235; deep-audit 210, accuracy-audit 97; 0 documented federal/state gaps, 4 C-batch sub-gaps still tracked):**
  **TAX-LAW FRESHNESS HARDENING shipped 2026-06-05c** — stale/missing tax years now FAIL LOUDLY (compile-time `Record<TaxYear>` + CI tests), not silently. 3 live TY2026 bugs fixed (G1.23 bonus 100%, G1.96 transit $340, G1.26 IRA $7,500/$8,600). All 15 planning year-maps + `STATE_TAX_DATA_BY_YEAR` + `SECTION_6654_ANNUAL_RATE` converted `Record<number>` → `Record<TaxYear>` (a missing supported-year key is a build error). New leaf module `taxYears.ts` owns `SUPPORTED_TAX_YEARS`/`TaxYear`/`LATEST_YEAR`/`resolveTaxYear` (re-exported from `taxCalculator`; breaks the stateTaxData import cycle). De-duped `obbbaSaltCap`→`getSaltCap`; KY-Kenton wage cap now tracks the year's SS base; fixed the dead `irsForm1040Pdf` template ternary. **Catalog v1.20.0**: 90 permanent-IRC strategies (+G1.64) re-dated `validUntil`→2099 (time-bomb defused); genuine OBBBA sunsets keep real dates (energy G1.33/34/37=2025; OBBBA deductions G1.97–100=2028). New sweep `scripts/src/recompute-planning-scores.ts` re-derives the 2 planning ranking columns after any catalog/score change (`--dry-run` supported). **To activate a new tax year: append it to `SUPPORTED_TAX_YEARS` → the compiler flags every map missing the key; fill IRS values; run year-coverage + catalog-freshness tests; run the sweep.**

  | File | Needs API |
  |---|---|
  | `tax-engine-tests.ts` | no |
  | `tax-engine-deep-tests.ts` | no |
  | `tax-engine-phase1-unit-tests.ts` | no |
  | `tax-engine-phase15-unit-tests.ts` | no |
  | `tax-engine-phase2-unit-tests.ts` | no |
  | `tax-engine-pure-tests.ts` | no (proves engine is Haven-portable) |
  | `tax-engine-50state-tests.ts` | no |
  | `tax-engine-edge-cases-tests.ts` | no (boundary/cliff/phase-out edges) |
  | `tax-engine-w2-validation-tests.ts` | no (W-2 box-arithmetic flag rules) |
  | `tax-engine-k1-tests.ts` | no (K-1 partnership + S-corp pass-through) |
  | `tax-engine-k1-depth-tests.ts` | no (2026-06-01 s2 — 49 hand-calc: Box 4 guaranteed payments AGI+SE/non-QBI, §704(d)/§465 basis+at-risk loss limits, per-business §199A(d)(3) SSTB) |
  | `tax-engine-nyc-tests.ts` | no (NYC personal income tax) |
  | `tax-engine-amt-prefs-tests.ts` | no (Form 6251 SALT addback + ISO bargain) |
  | `tax-engine-state-eitc-tests.ts` | no (CO/IL/NJ/MA piggyback + MN WFC) |
  | `tax-engine-integration-tests.ts` | yes |
  | `tax-engine-deep-integration-tests.ts` | yes |
  | `tax-engine-new-features-tests.ts` | yes |
  | `tax-engine-scenarios.ts` | yes |
  | `tax-engine-phase1-integration-tests.ts` | yes |
  | `tax-engine-phase15-integration-tests.ts` | yes (incl. Form 1116 cases) |
  | `tax-engine-exports-tests.ts` | yes (PDF/CSV/JSON/UltraTax-GEN/IRS-1040 PDF) |
  | `tax-engine-ai-overlay-tests.ts` | yes (upload → review → approve gate) |
  | `tax-engine-rental-properties-tests.ts` | yes (per-property MACRS + PAL) |
  | `tax-engine-capital-transactions-tests.ts` | yes (Form 8949 + wash sale) |
  | `tax-engine-k1-integration-tests.ts` | yes (K-1 CRUD + recalc pipeline) |
  | `tax-engine-accuracy-audit-tests.ts` | no (88 IRS-cited cliff + canonical hand-calc tests; see `docs/accuracy-audit/`) |
  | `tax-engine-deep-audit-tests.ts` | no (210 deep-audit: per-calc edge cases, 20 client archetypes, invariants, K1-K10 + K1-MFJ sub-gap full closure; ALL 10 federal K-list gaps closed; see `docs/accuracy-audit/deep-audit-2026-05-23.md`) |
  | `tax-engine-planning-tests.ts` | no (**527** hand-calc'd tests; OBBBA v1.19 added 53: TY2026 lock-ins (QCD/SEP/HSA/§401(a)(17)/adoption) + adoption refundability + §199A permanence (PLAN-08) + PTET $40k-cap-suppress + phase-down-to-floor + G1.97–G1.100 tips/overtime/car-loan/senior caps & both phase-out rates & negatives. Prior 474: 10 original G1 detectors + G2 scoring helpers + 28 H3 multi-year wiring + 24 H1 v1.4 + 26 H1 v1.5 + 24 H1 v1.6 + 20 H1 v1.7 + 21 H1 v1.8 + 20 H1 v1.9 + 20 H1 v1.10 + 20 H1 v1.11 + **27 H1 v1.12** (G1.67 in-plan Roth / G1.68 §174 R&D / G1.69 year-end timing / G1.70 bargain sale / G1.71 ISO lot) + **22 H1 v1.13** (G1.72 RSU sell-to-cover / G1.73 NUA in-service / G1.74 §45S FMLA / G1.75 WOTC §51 / G1.76 §170(h) non-syndicated easement) + **18 H1 v1.14** (G1.77 self-rental grouping / G1.78 multi-state NR / G1.79 §453 election out / G1.80 §47 historic rehab / G1.81 §44 disabled access) + **16 H1 v1.15** (G1.82 §1374 BIG / G1.83 §338(h)(10) / G1.84 §351 / G1.85 §163(h)(3) / G1.86 CLT) + **17 H1 v1.16** (G1.87 §401(a)(17) cap / G1.88 §199A SSTB / G1.89 §199A aggregation / G1.90 PIF / G1.91 §139 disaster) + **20 H1 v1.17 — FINAL** (G1.92 Solo 401(k) deferral / G1.93 §163(d) / G1.94 §85 UI / G1.95 §1377(a)(2) / G1.96 §132(f) transit). Phase G + H. **H1 CATALOG CLOSED.**) |
  | `tax-engine-planning-scenarios-tests.ts` | no (74 end-to-end assertions across 11 realistic CPA archetypes: (1) tech founder SF, (2) retired couple FL, (3) high-SE professional FL, (4) working parents IL MFJ, (5) real-estate investor TX MFJ, (6) low-income retirement saver OH, (7) FIRE-movement age 55, (8) SE solo on ACA age 40, (9) HNW family with kids + side SE + brokerage CA MFJ, (10) high-income tech executive CA age 48, **(11) retiree with diversified accounts FL age 68**. Each scenario: complete TaxReturnInputs + assertions on which strategies fire / suppress + estSavings ranges.) |
  | `tax-engine-planning-integration-tests.ts` | yes (29 assertions: Phase G API surface — G1 SEP via 1099-NEC, G1 PTET via S-corp K-1 + SALT, pure-W-2 silence, 404, G4 persistent NIIT 2-year, G4 single-year-history empty hits, G4 404) |
  | `tax-engine-planning-multi-year-tests.ts` | no (70 hand-calc'd tests across 5 G4 multi-year detectors; Phase G4) |
  | `tax-engine-pro-tier-tests.ts` | yes (Phase G5 — adapts to current PRO_TIER_ENABLED state: 5 on-state assertions OR 16 off-state assertions verifying 402 + body code on every planning endpoint. Run twice for full coverage.) |
  | `tax-engine-phaseE-tests.ts` | no (Phase E — 235 hand-calc'd assertions across E1-E14: IL exemption cliff, AMT credit Form 8801, charitable §170(d)(1) carryforward, HSA Form 8889 detail + §4973(g) excise, 1099-R §72(t) penalty, 1099-G §111 tax-benefit rule, §179 + bonus depreciation, NYC school + MCTMT, state CTCs CA/CO/NJ/IL/NM/VT, state EITCs for 20 states, PA Schedule SP, **E12 part-year residency**, **E13 auto wash-sale detection + §1091(d)**, **E14 MD/OH/IN local taxes**. All 14 Phase E items shipped. See `docs/phase-e-deferred.md`.) |
  | `tax-engine-cpa-scenarios-tests.ts` | no (146 hand-calc'd assertions across 20 real-world CPA scenarios — see `docs/cpa-scenarios-20.md`. Covers stock comp, real estate professional, multi-state moves, retirees with mixed income, K-1, ACA, kiddie tax, FEIE, NIIT, AMT, wash sale, FTC, charitable carryforward, NYC PIT + MCTMT, MD-Montgomery local. Designed as end-to-end regression for `computeTaxReturnPure` against the engine's full surface area.) |
  | `tax-engine-realworld-scenarios-tests.ts` | no (**2026-05-28 deep audit** — 28 hand-calc'd end-to-end assertions S1–S13: locks the 5 correctness fixes (QBI net-cap-gain cap, NIIT base incl. rental/K-1/§121/§1031, charitable overall AGI ceiling, dependent-care MFS) + RE-pro NII exclusion, royalty NIIT, net-cap-loss $3k offset, QSS §121 $500k cap, Pub 915 85% SS, HNW passive-K-1 NIIT, $60k single anchor.) |
  | `tax-engine-audit-2026-05-29-tests.ts` | no (**2026-05-29 deep audit #2** — 28 hand-calc'd assertions locking FED-01 AMT-MFS breakpoint, FED-02 kiddie 2024/2025 threshold, STL-01 NYC MCTMT flat 0.60%, STL-02 PA/OH/Philly SE-profit local base, STL-04 IL part-year cliff, PLAN-01 Saver's-Credit QSS single-column. STL-03 + planning PLAN-02/03/05/07 locked in tax-engine-tests / planning-tests.) |
  | `tax-engine-16-scenario-battery-tests.ts` | no (**2026-06-01 — 16-scenario real-world battery**, 42 hand-calc'd end-to-end assertions N1–N16 through `computeTaxReturnPure`. Gives the PIPELINE coverage the 2026-05-29 audit fixes lacked: FED-03 NIIT FEIE add-back (N1/N14 per-spouse cap), FED-04 QBI cap on POST-NOL taxable (N2), FED-06 EITC §32(i) tax-exempt-interest disqualification (N3). Plus S-corp K-1 + reasonable comp + QBI, MFS NIIT/Add'l-Medicare $125k, cap-loss CF $3k offset, §1031 boot in NIIT, SE above-the-line stacking, partnership K-1 Box 14A SE, HoH CTC/ACTC/EITC, MA millionaire surtax, STL-02 Philly EIT incl. SE, Pub 915 SS taxability, §1202 QSBS. NOTE: `federalTaxLiability` is pre-nonrefundable-credit + bundles other taxes — assert clean income tax only on no-credit scenarios.) |
  | `tax-engine-form4868-tests.ts` | no (C8 — 40 hand-calc'd assertions for `calculateForm4868`: balance-due, refund, override, est-tax-paid, partial payment, 90% safe-harbor scenario, rounding, defensive negatives. Verifies engine math against IRS Form 4868 2024 instructions.) |
  | `tax-engine-form2210-tests.ts` | no (P1-6, 2026-06-05 — 45 hand-calc'd assertions for `computeForm2210` (§6654): required-annual-payment safe-harbor target (90% current vs 100%/110% prior), under-$1,000 + prior-year-zero exceptions, MFS $75k threshold, refundable-credit Line-4 derivation, year-indexed penalty rate (8% TY2024 / 7% TY2025 / null TY2026), + end-to-end via `computeTaxReturnPure`. Penalty $ is a labeled estimate, NOT the exact regular-method worksheet.) |
  | `tax-engine-year-coverage-tests.ts` | no (freshness, 2026-06-05c — 114 assertions. T1: every public year-indexed engine fn (std ded, brackets, SALT cap, state tax, SS wage base, kiddie, state-data table) returns a finite/sane value for EVERY `SUPPORTED_TAX_YEARS` year + whole-pipeline smoke. T1b: inflation-indexed values strictly monotonic (catches a stale-copy). T4: registry invariants + `resolveTaxYear` clamping. REG: the 3 TY2026 live-bug regressions at EXACT IRS values (G1.23 bonus 0.60/0.40/1.00, G1.96 transit 315/325/340, G1.26 IRA 7000/7500 base + 8000/8600 catch-up). Data-driven — auto-covers any newly-activated year.) |
  | `tax-engine-catalog-freshness-tests.ts` | no (freshness, 2026-06-05c — 30 assertions. F1: every `validUntil` is a well-formed year ≥2024. F2: NO strategy expired for the current filing year (`LATEST_YEAR`). F3: genuine OBBBA sunsets keep real dates (energy credits expire after 2025; OBBBA deductions after 2028). F4: permanence floor — ≥90 strategies @ validUntil 2099, none expired for the newest supported year.) |
  | `tax-engine-detector-coverage-tests.ts` | no (2026-06-05d — 9 assertions. Static: the set of `strategyById("...")` literals across planningEngine.ts + planningEngineMultiYear.ts == the catalog id set (catches "added catalog entry, no detector"; coverage is 101/101 incl. G4.1–G4.5 in the multi-year module). Dynamic: a rich client fires ≥6 distinct (actually 17).) |
  | `tax-engine-state-wins-2026-tests.ts` | no (16 hand-calc'd assertions. 2026-06-05e: VT dependent exemption $4,850/dep ($324.95 for 2 deps); Yonkers surcharge = 16.75% of net NY State tax (localityCode "YONKERS"). 2026-06-05g: WI single sliding-scale std ded (Wis. Stat. §71.05(22): $13,230 − 12%×(WAGI−$19,070); $50k → tax $1,800.41 exact); CT Social Security exclusion (100% exempt below $75k single/$100k MFJ; 75% above — relational test). Primary-source-verified (WI LFB, CT DRS).) |
  | `tax-engine-nr-sourcing-tests.ts` | no (PREP-B1, 2026-06-05h — 10 hand-calc'd assertions for per-line NON-RESIDENT sourcing in `calculateMultiStateTax`. NY IT-203 / CA 540NR proportional method ({CA,NY} in `NR_AS_IF_RESIDENT_STATES`): NR tax = tax-as-if-full-year-resident(total income) × (state-source/total). NY $80k wages + $40k NJ interest → NY-as-resident $6,151.75 × 66.67% = $4,101.17; CA $100k+$50k → $9,977.14 × 66.67% = $6,651.43. Per-type NR source via `perStateNonResidentOtherSourced` (NR business/rental/real-property gains). §114: interest/div/intangible-gains + pension/IRA/401(k)/SS NEVER NR-source (enforced by design — no auto-add path). CA + part-year unchanged.) |
  | `tax-engine-multiyear-hardening-tests.ts` | no (2026-06-05f — 35 hand-calc'd assertions for the H3 hardening. RMD: IRS Uniform Lifetime Table (Pub 590-B Table III, all 29 divisors 72-100), `rmdDivisorForAge`/`requiredMinimumDistribution` (500000/26.5=18,867.92), trigger age 73 (SECURE 2.0), age<73→null, age>100 clamp. RMD trajectory injection (rmdByYear 18,868→19,811, IRA evolution). Carryforward `captureCarryforwards`/`applyCarryforwards` + chained-vs-frozen NOL depletion (31,680→0 chained; frozen stays >25k). All multiYearEngine; opt-in (default off → consumers unchanged). The Roth RMD-avoidance value model (`projectRmdAvoidance`) is tested in `tax-engine-roth-optimizer-tests.ts` (controlled 2-yr hand-calc incl. age-65 + OBBBA senior deductions).) |
  | `tax-engine-form1040x-tests.ts` | no (C4 — 45 hand-calc'd assertions for `computeAmendmentDiff` + `captureFiledSnapshot`: AGI/tax/deduction/cap-gain changes, refund↔owed swaps, std↔itemized switch, rounding (IRS round-each-column rule), schema versioning, refundable-credit deltas, PTC sign clamp.) |
  | `tax-engine-section1031-tests.ts` | no (C5 — 30 hand-calc'd assertions for §1031 recognized/deferred gain split: realized > boot, realized = boot, realized < boot cap, zero-boot full deferral, multi-exchange aggregation, defensive negatives, LTCG flow-through, AGI invariant. Documents the NIIT-routing sub-gap explicitly.) |
  | `tax-engine-espp-iso-tests.ts` | no (C6 — 27 hand-calc'd assertions for ISO + ESPP disqualifying-disposition ordinary comp income: ISO-only, ESPP-only, both, aggregation, defensive negatives, NIIT exclusion, Additional Medicare exclusion, bracket-stacking tax through 24%/32% boundary, bucket isolation. Verifies §421(b)/§422 + §423 + IRS Notice 2002-47 + Rev Rul 71-52 compliance.) |
  | `tax-engine-section163j-461l-tests.ts` | no (C7 — 36 hand-calc'd assertions for §163(j) ATI-30% cap + indefinite carryforward + uncapped biz-interest-income + uncapped floor-plan-financing + §461(l) addback. Cases: under-cap full allowance, over-cap split, prior-cf stacking, biz interest income addition, floor plan 100% allow, §461(l) addback, combined §163(j)+§461(l) bigger ATI, near-zero ATI full disallowance, defensive negatives, floor-plan-only, complete disallowance with biz int income only.) |
  | `tax-engine-whatif-tests.ts` | no (Phase H — 169 hand-calc'd assertions covering whatIfEngine + all H2-wired detectors + cross-strategy. **Cases 1-20:** core primitives (applyWhatIfMutations purity / mutation order / refund-sign convention; runWhatIfScenarios baseline-sharing; computeWhatIfDelta combined aggregates; CA state-tax delta). **D1-D2:** G1.1 SEP wiring + heuristic-path backward-compat. **D3-D6:** G1.6 NIIT, G1.9 TLH (LTCG bracket-aware), G1.10 FTC (combinedRefundDelta for credits), G1.4 Roth cost-semantics. **D7-D9:** hit-list backward compat, H7 cross-strategy interactionEffect math. **D10-D17 (catalog v1.2):** G1.11 QCD (age-72 + IRA + charity → $3,641 with elderly std-ded bonus), G1.11 age-gating, G1.12 appreciated stock heuristic + H5-deferral docstring, G1.13 Augusta Rule (SE > $50k → ~$4,600 H2-verified), G1.13 suppression for pure-W-2, G1.14 HSA max ($8,300 family × 22% = $1,826), G1.14 cap-already-met suppression, G1.14 age-55+ $1,000 catch-up adds correctly.) |
  | `tax-engine-form8606-tests.ts` | no (H6 — 68 hand-calc'd assertions for `computeForm8606ProRata` (Part I §408(d)(2) pro-rata: clean basis, mixed IRA partial, edge cases, defensives) AND `computeForm8606PartIII` (Roth distribution basis recovery: qualified vs non-qualified, within-basis vs exceeding-basis, 10% §72(t) penalty under 59½, over-59½ no-clock case, age-null conservative, distribution > balance defensive). NEW 2026-05-27: 40 PartIII assertions.) |
  | `tax-engine-multiyear-tests.ts` | no (H3 — 25 hand-calc'd assertions for the multi-year primitive: `projectYearForward` (income scaling, taxYear advancement, carryforward preservation), `runMultiYearTrajectory` (totalTaxBurden, per-year mutations), `compareMultiYearTrajectories` (delta sign convention, horizon mismatch error). Detector wiring tests live in `tax-engine-planning-tests.ts` H3 section.) |
  | `tax-engine-discovery-tests.ts` | no (H8 — 23 hand-calc'd assertions for `verifyAndDedupeCandidates`: catalog-overlap matching by IRC section, duplicate suppression when LLM violates dedupe rule, extra-strategy fallback, empty IRC handling, mixed batch (3→2 keep + 1 dropped), IRC variant matching, full catalog self-match sanity. NEW 2026-05-27.) |
  | `tax-engine-c2-state-credits-tests.ts` | no (C2 v2 — 26 hand-calc'd assertions for NY/CA/IL state additional credits: Empire State Child Credit, NY CDCC, NY College Tuition, CA Renter's Credit, CA CDCC, IL Property Tax Credit, IL K-12 Education. Each credit verified against TY2024 published form/schedule. End-to-end pipeline integration tests confirm credits flow through to state refund.) |
  | `tax-engine-c2-state-credits-v2-tests.ts` | no (C2 v3 — 67 hand-calc'd assertions for MA/NJ/OH/PA/VA/GA/MI state additional credits: MA Senior Circuit Breaker / Dependent Member of Household / Limited Income Credit / Lead Paint Removal; NJ Property Tax Credit / CDCC / Senior-Disabled Property Tax Deduction; OH Joint Filing Credit / Senior Citizen Credit; PA Special Tax Forgiveness Sched SP / Working Family Tax Credit; VA Low-Income Tax Credit; GA Low-Income / Retirement Income Exclusion / Disabled Home Purchase; MI Homestead PTC / Home Heating Credit. **24 new credits = 31 total state credits across 10 states.** NEW 2026-05-27 PM.) |
  | `tax-engine-c9-c10-local-tax-tests.ts` | no (C9 v2 + C10 v2 — 17 hand-calc'd assertions for inline PA Top-13 EIT (Philly, Pittsburgh, etc.) + inline OH Top-15 SDIT. Includes E2E pipeline + state-mismatch rejection.) |
  | `tax-engine-c9-c10-bulk-tests.ts` | no (C9 v3 + C10 v3 — 35 hand-calc'd assertions for the bulk PA EIT registry (~175 munis) + bulk OH SDIT registry (~226 SDs). Verifies PSD-code AND name-keyed lookup, both `earned_income` and `traditional` (oh_traditional) bases, state-mismatch rejection, E2E pipeline. NEW 2026-05-27 PM.) |
  | `tax-engine-c11-part-year-w2-tests.ts` | no (C11 v2 — 11 hand-calc'd assertions for OPT-IN per-W-2-stateCode wage allocation via `part_year_use_w2_source` adjustment. Verifies wage source-state allocation AND pure-pro-rata default unchanged.) |
  | `tax-engine-c11-deeper-sourcing-tests.ts` | no (C11 v3 — 20 hand-calc'd assertions for per-K-1 + per-rental source-state allocation via `part_year_use_full_source_allocation` adjustment. K-1 + rental net income flows to source state; intangibles still pro-rate to resident state by days. Backward-compat verified. NEW 2026-05-27 PM.) |

**Non-test scripts:**
- `build-validation-packet-v2.ts` — generates 15 new validation packet cases (Cases 11-25: Form 8606 backdoor Roth, §1031, §121, §1202, kiddie tax, FEIE, ACA PTC, HSA, Roth conv, NOL, cap-loss CF, multi-state NR, part-year residency, §163(j), §461(l)). Pure-function; no live API needed.
- `c3-validation-rerun.ts` — re-runs all 25 packet cases against current engine; emits JSON for line-by-line comparison.

**C3 follow-up engine modules (NEW 2026-05-27 PM):**
- `artifacts/api-server/src/lib/form8824.ts` — Form 8824 (§1031) substitute PDF via pdfkit.
- `artifacts/api-server/src/lib/form8990.ts` — Form 8990 (§163(j)) substitute PDF via pdfkit.
- `qbi_sstb_flag` adjustment type — when set, engine applies §199A phase-out for SSTBs above the income threshold ($191,950 single / $383,900 MFJ TY2024).
- **Scenarios are CPA-style end-to-end cases.** Each one has a `Hand-calc:` comment block — keep that convention. When a scenario fails, double-check your hand-calc before mutating the assertion; the calculator is usually right.
- **Run all suites after any pipeline or schema change.** The Phase 1 work flushed out one regression (scenario 8 — needed to add EITC to expected refund).

## Local dev

- Postgres in Docker: container `haven-postgres` (shared with another local project), db `taxflow_pro`, user/pass `brookhaven`. URL `postgres://brookhaven:brookhaven@localhost:5432/taxflow_pro`.
- API server needs `DATABASE_URL` and `AI_API_KEY` (dummy is fine if you're not exercising AI extraction). No `dotenv` is loaded — pass env vars on the command line or `source ~/.env`.
- Frontend dev server: `pnpm --filter @workspace/tax-app run dev` on port 3010 (configured in `.claude/launch.json`).
- The api-server runs from `./artifacts/api-server/dist/index.mjs` after `pnpm run build`. The build script uses esbuild — fast (<200ms).
- **When running commands from a parallel worktree:** preview tools use the harness CWD, which may not match where the work is. Use `pnpm --dir /path/to/worktree --filter @workspace/x run ...` or update the `.claude/launch.json` `runtimeArgs` with `--dir`.

## EC2 deploy

SSH: `ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com`. Project lives at `~/taxflow-pro` (NOT `taxflow-assistant`).

There is NO `~/.env` on the box. Env vars (DATABASE_URL → Neon, AI_API_KEY, and optionally PRO_TIER_ENABLED for Phase G5 gating — defaults to true) are baked into the running pm2 process. To deploy, source them out of pm2:

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
pnpm --filter @workspace/db run migrate   # applies pending versioned migrations
# CUTOVER COMPLETE (2026-06-04, see docs/db-migrations.md): dev + prod are baselined
# to 0000+0001 and `migrate` is a verified no-op. Going forward: edit schema → `pnpm
# --filter @workspace/db run generate` → REVIEW the generated SQL → commit → the
# deploy's `migrate` step applies it. NEVER run `push` against prod (local-dev only).
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
```

**After any planning-CATALOG or scoring change** (e.g. a `validUntil` refresh, a new
detector, a year-indexed constant fix), the precomputed `tax_returns.planning_score`
columns go stale → re-score on the box (safe; touches ONLY the 2 ranking columns):
```bash
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
pnpm --filter @workspace/scripts exec tsx src/recompute-planning-scores.ts --dry-run  # preview
pnpm --filter @workspace/scripts exec tsx src/recompute-planning-scores.ts            # apply
```

**The frontend (tax-app) cannot be built on the box** — the instance has 908 MiB total RAM and Vite OOMs (exit 137). Build locally and rsync:

```bash
# Local
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

The api-server serves these static files directly; no nginx.

**EC2 gotchas:**
- Don't `curl` the public DNS from inside EC2 — AWS networking drops the loopback. Use `localhost:8080`.
- `git pull` will conflict on `pnpm-lock.yaml` every time — `git checkout -- pnpm-lock.yaml` first.
- Credentials live in the pm2 process env, NOT in a `~/.env` file. To inspect: `pm2 env 0`. To change: `pm2 restart taxflow --update-env` after setting env vars in the shell.

## Security / data handling

- Demo banner is intentional: "do not upload real tax documents." AI extraction sends file content to Gemini.
- API keys + DB URLs live in `~/.env` on EC2 and the user's local `.env`. Never commit credentials.
- If the user pastes a credential in chat (it happens), flag it once and recommend rotation; don't keep mentioning.

### P0 legal/security gate (2026-06-03, branch `p0-legal-security-gate`) — triggered by the 2026-06-02 audit (`docs/product-assessment-2026-06-02.md`). Compliance backbone in `docs/compliance/`.

- **NONE of these go live until a real customer / real PII is involved** — they default to today's demo behavior when their env vars are unset. **Do not put real client PII on the EC2 box until the operator/infra gate is closed** (see `.claude/handoff.md` + `docs/compliance/README.md`).
- **Auth (P0-4):** app-layer bearer gate `requireApiAuth` (`middlewares/auth.ts`) on every `/api` route when `API_AUTH_TOKEN` is set (401 otherwise); unset = open demo + loud warning. Primary prod control is edge auth (Cloudflare Access — `runbook-tls-s3-secrets.md`). Full per-user auth is still D15 (Haven). Frontend attaches the token via the custom-fetch getter (`tax-app/src/lib/apiAuth.ts`).
- **PII encryption at rest (P0-5, PARTIAL):** `fieldCrypto.ts` AES-256-GCM (versioned `enc:v1:` prefix, per-value IV, idempotent). Encrypts ONLY the `employee_ssn` / `payer_tin` / `recipient_tin` columns — wired at the W-2/1099 CRUD + document-approve seams; `mapRecord`/W-2 GET decrypt. Keyed by `PII_ENCRYPTION_KEY` (base64 32B); unset = plaintext passthrough (demo). Backfill: `scripts/src/backfill-encrypt-pii.ts`. **The decrypt-failure sentinel must never be persisted** — `encryptField` throws on it (prevents a TIN-destroying round-trip). **Does NOT cover the document blob** (`tax_documents.file_content` is still plaintext base64 with the same SSN) — that needs the S3+KMS migration (Runbook B) and is P0-blocking before real PII.
- **§7216 consent gate (P0-2):** `consentGate.ts` — sending a doc to Gemini is a disclosure of tax-return info; without a recorded, unexpired taxpayer consent it's a criminal violation by the preparer. `consentRequired()` defaults ON when `NODE_ENV=production` (fail-closed in any prod, NOT coupled to the bearer token), OFF in demo; override `REQUIRE_7216_CONSENT`. Fail-closed (403 `CONSENT_REQUIRED`) is wired BOTH at the upload handler AND inside the extraction IIFE, AND on the planning-memo/email/missing-data/discovery endpoints (they fall back to the deterministic no-LLM path when blocked). New `disclosure_consents` table + record/list/revoke endpoints (`routes/disclosure-consents.ts`). **Needs `db push`.** Verbatim consent instrument + DPA checklist in `docs/compliance/section-7216-consent.md` (`ai_extraction_v1`).
- **CI (P0-6):** `.github/workflows/ci.yml` runs `typecheck` + `typecheck:tests` + `test:no-api` on push/PR (no CI existed before). `scripts/tsconfig.tests.json` type-checks the test tree (the regular tsconfig excludes all tests → wrong-shape fixtures passed green). It carries a documented, **ratcheting quarantine** (25 legacy files, 143 pre-existing errors) — drive it to 0; new test files are NOT quarantined. Adding a `security-*tests.ts` file auto-runs it via the run-no-api glob.
- **Engine fix (P0-7b):** the §199A SSTB phase-in band is now ONE source of truth — `taxCalculator.qbiPhaseInBand` — shared by the wage/UBIA limit AND the SSTB phase-out (was a duplicate TY2024/2025-only map that made a TY2026 return use the 2024 band; MFS now = single per §199A(e)(2)). Don't re-duplicate it.

## Known limitations (current scope)

Several Phase 2/3 limitations have been resolved (multi-state foundation, MACRS, capital-loss $3k+carryforward, PA/IL/MS retirement exemptions, Oregon Form 40 Line 13). Remaining intentional gaps:

- **OBBBA core-engine conformance — SHIPPED 2026-06-02 (commit `f22c9c1`):** the core `computeTaxReturnPure` is now OBBBA-conformant. **SALT** cap year-indexed via `getSaltCap` (TCJA $10k TY2024; OBBBA $40k TY2025 / $40.4k TY2026 + §164(b)(7) >$500k-MAGI 30% phase-down to a $10k floor; MFS halved). **§199A** TY2026 thresholds $201,750/$403,500 + widened $75k/$150k phase-in + the new **$400 minimum QBI deduction** (TY2026+, ≥$1,000 QBI) in `calculateQbi`; MFS §199A threshold corrected to = single (§199A(e)(2) doubles only for joint returns). **Native TY2026** — `SUPPORTED_TAX_YEARS` now includes 2026 (LATEST_YEAR held at 2025 so the null-default is unchanged); 2026 added to all 20 year-indexed maps (brackets, std-ded $16,100/$32,200/$24,150, AMT incl. OBBBA **50% exemption phase-out** + $500k/$1M start, LTCG, EITC, IRA, Saver's, SLI, SS wage base $184,500, kiddie $2,700, FEIE $132,900, FPL) + `stateTaxData` (FED_STD_DEDUCTION_2025 corrected to OBBBA + 2026 build). **Structural** (also fixes TY2025): **CTC $2,200** (year-indexed), **§179 $2.5M/$4M** (2025) / $2.56M/$4.09M (2026), **bonus depreciation 100%** TY2026. **4 new OBBBA deductions NOW MODELED as real `computeTaxReturnPure` adjustments** (`calculateObbbaSchedule1ADeductions`, Schedule 1-A → Form 1040 line 13b — reduce TAXABLE income, not AGI; offset the ordinary portion; TY2025–2028; MAGI phase-outs): tips §224 (`qualified_tips`, ≤$25k), overtime §225 (`qualified_overtime`, ≤$12.5k/$25k), car-loan §163(h)(4) (`qualified_car_loan_interest`, ≤$10k), senior §151(d) ($6k/65+, age-based — no marker). The 3 markers are in the openapi enum + ClientForm dropdown (TYPE_LABELS). Planning detectors G1.97–G1.100 value them at the PRE-deduction marginal (computed.taxableIncome is now post-deduction). **Still NOT modeled (deferred):** bonus depreciation TY2025 dual-rate (40% pre-1/19/2025 vs 100% after — engine has no acquisition-date field, keeps the conservative 40% default); estate $15M (out of engine scope).
- Per-property rental tracking (Schedule E is aggregate adjustments, not per-property)
- Schedule D per-transaction detail: per-lot ST/LT routing + broker-reported wash sale + E13 auto-detection + §1091(d)/§1223(3) ST→LT tack + **partial-wash proportional disallowance + cross-account (2026-06-01 s2, via `quantity`/`account` columns)** shipped. NOT modeled: leftover-replacement-share re-flow to input-order-later losses.
- Part-year residency: E12 + **pro-rated std deduction/personal exemption (2026-06-01 s2 — by residency days)** shipped. **FORMER-STATE DOUBLE-COUNT FIXED (2026-06-04 deep audit, caught by the scenario battery): a part-year mover's former-state W-2 was taxed BOTH as the part-year resident allocation AND as non-resident wages (a NY→FL mover paid MORE than a full-year NY resident); `calculateMultiStateTax` now excludes the part-year formerState from the non-resident aggregation. Regression: realworld S17 (invariant part-year ≤ full-year former-state) + cpa-scenarios S12.** NOT modeled (sub-gaps): per-income-item sourcing to the exact NY IT-203 / CA 540NR Sched CA, mid-year resident credit between former + current, NYC + flat-rate locality tax (skipped), state AMT / WA LTCG surcharge (skipped), pro-rated retirement/SS exclusions.
- Local income taxes for NYC + MD counties (24) + OH cities (10) + IN counties (10) + **KY occupational (5 — Louisville/Lexington/Kenton/Boone, 2026-06-01 s2)** + **Yonkers resident surcharge (16.75% of net NY State tax, localityCode "YONKERS", 2026-06-05e)**. **SHIPPED 2026-06-01 s2: NYC UBT (`calculateNycUbt`), KY occupational tax (wage-capped via LocalityInfo.wageCap), OH cross-city resident credit (creditRate/creditLimitRate + `oh_work_city_tax_paid`), IN per-dependent exemption ($1k/filer + $1k/dep).** NOT modeled: PA local EIT remaining ~1,800 munis, MD per-dependent exemption (no MD state-tax row in engine — county-localities only), KY remaining counties.
- Most state-specific credits (state EITC: CA, NY, CO, IL, NJ, MA piggyback + MN Working Family Credit wired; CT/DC/DE/IN/IA/KS/LA/ME/MD/MI/MT/NE/NM/OH/OK/OR/RI/VT/VA/WA/WI piggybacks shipped via E10 + WI tiered. State CTCs CA/CO/NJ/IL/NM/VT shipped via E9. State AMT only CA.)
- **UltraTax CS file-based import** — see `docs/ultratax-audit.md`. No public UltraTax import format exists; our `.gen` file is rebranded as a vendor-neutral CPA-review summary (the URL path + .gen filename are preserved for backward compat). PDF + CSV + the 10-case `docs/validation-packet/` are the design-partner artifacts. Real UltraTax ingestion (SurePrep API / SDE / GUI automation) is Phase 5 — multi-month, do not start speculatively.
- **State-specific accuracy gaps** (uncovered + documented in 2026-05-23 accuracy audit; see `docs/accuracy-audit/report.md`): NYC EITC sliding scale (engine has NY state EITC at 30% but not the additional NYC sliding-scale credit), MN $1,750/child refundable CTC (engine has MN WFC but not the separate CTC), WA 7% LTCG excise > $262k, CA AMT (Schedule P 540). State CTCs for CA/CO/NJ/IL/NM/VT also not modeled. PA Schedule SP Tax Forgiveness not modeled. IL personal exemption $250k/$500k phase-out not modeled (engine over-deducts by max $137/filer at the top).
- **Federal-engine gaps surfaced in the 2026-05-23 DEEP audit** (`docs/accuracy-audit/deep-audit-2026-05-23.md`, K-list, all tracked as positive (closed) assertions in `tax-engine-deep-audit-tests.ts`). **ALL 10 K-LIST GAPS CLOSED (2026-05-23 → 2026-05-26):**
  - **K1** — Sch SE Part I Line 9 (SS wage base shared across W-2 + SE). Closed 2026-05-23 PM for single/HoH/MFS/QSS. MFJ sub-gap closed 2026-05-26 with per-spouse W-2/SE attribution (`spouse` field on W2Fact + Form1099Fact). Default fallback when no explicit spouse tag preserves pre-K1-MFJ behavior.
  - **K2** — Form 8959 Additional Medicare 0.9% on Medicare wages + SE above filing-status threshold. Closed 2026-05-23 PM.
  - **K3** — Form 6251 Part III AMT × LTCG preferential rates. Closed 2026-05-24. AMT now computes MIN of (full 26/28% on AMT base) and (26/28% on AMT-base − LTCG/QDIV + LTCG at 0/15/20% preferential). Saves ~$13k on representative high-LTCG + ISO-bargain case.
  - **K4** — NOL carryforward (post-TCJA 80% limit, IRC §172(a)(2)). Closed 2026-05-26. Adjustment `nol_carryforward`; engine caps deduction at 80% of taxable income; tracks `nolCarryforwardRemaining` for next year.
  - **K5** — SEHI deduction (Form 7206, IRC §162(l)). Closed 2026-05-24. Adjustment `self_employed_health_insurance_premiums`; engine caps at (net SE − half-SE); above-the-line on Sched 1 Line 17.
  - **K6** — §121 home-sale exclusion. Closed 2026-05-24. Adjustment `home_sale_gross_gain_primary_residence`; engine applies $250k single/HoH/MFS / $500k MFJ-or-QSS cap; remainder flows to LTCG.
  - **K7** — §1202 QSBS exclusion. Closed 2026-05-26. Adjustments `qsbs_gross_gain` + `qsbs_adjusted_basis`; exclusion = min(gross, max($10M, 10× basis)). Engine assumes 100% post-2010-09-27 acquisition (sub-gap: older 75%/50% acquisitions require pre-multiplication).
  - **K8** — Kiddie tax (Form 8615). Closed 2026-05-26. New client fields `isKiddieTaxFiler` + `parentsTopMarginalRate`. Engine taxes net unearned income > $2,600 at parent's marginal rate per Form 8615 Line 18 (MAX of regular vs kiddie method).
  - **K9** — FEIE §911 (Form 2555). Closed 2026-05-26. Adjustments `foreign_earned_income` + `foreign_earned_income_spouse` (MFJ); per-spouse cap $126,500 TY2024 / $130,000 TY2025. Stacking rule applied: tax computed at marginal rate that would have applied including FEIE.
  - **K10** — SS taxability worksheet (Pub 915 0/50/85%). Closed 2026-05-24. New `socialSecurityBenefits` and `mfsLivedApartAllYear` client fields. K10 state-SS exclusion closed 2026-05-26 (taxable SS excluded from state-tax base for 41 SS-exempt jurisdictions via STATES_TAXING_SS set).
- **State-engine gaps** (G-list, accuracy-audit suite): **ALL 4 CLOSED 2026-05-26**:
  - **G1** — NYC EITC sliding scale (NY IT-215 Line 26). Engine bands 30/25/20/15/10/5% by NYAGI. Refundable; excess flows to state refund.
  - **G2** — MN $1,750/child refundable CTC (Schedule M1CWFC). Joint phase-out with WFC; WFC absorbed first.
  - **G4** — WA 7% LTCG excise (RCW 82.87). Engine applies to WA-resident filers with LTCG > $262,000 (TY2024).
  - **G5** — CA AMT (Schedule P 540). 7% flat AMT on CA AMTI > $244,857 single / $326,478 MFJ / $163,238 MFS exemption.
- **Engine net: ZERO documented gaps** (down from 10 federal + 4 state at start of week).
- **2026-05-29 DEEP AUDIT #2 — 22 bugs fixed on branch `deep-audit-2026-05-29`** (two adversarially-verified multi-agent passes; 2 findings refuted + several downgraded; all fixes hand-calc'd + IRS/state-cited; 37 no-API suites / 2,943 assertions green; UI verified live):
  - **Federal:** FED-01 AMT 26/28% breakpoint halved for MFS (Form 6251); FED-02 kiddie threshold year-indexed ($2,600/$2,700); FED-03 NIIT MAGI adds back §911 FEIE per §1411(d); FED-04 QBI cap on POST-NOL taxable income; FED-06 EITC §32(i) counts tax-exempt interest.
  - **State/local:** STL-01 NYC self-employed MCTMT = flat 0.60% over $50k (Zone 1; the graduated schedule was the EMPLOYER payroll rate); STL-02 PA EIT / OH SDIT / Philly NPT earned-income base now includes SE net profit; STL-03 MA 4% / CA 1% surtaxes on state taxable income not AGI; STL-04 IL part-year exemption cliff on full-year AGI.
  - **Planning:** PLAN-01 Saver's Credit QSS → single column (detector + engine SAVERS_CREDIT_TIERS); PLAN-02 §1377 detector gates on S-corp presence not SE earnings (was dead code); PLAN-03 family-employment includes 17-year-olds (otherDependents); PLAN-05 student-loan §221 phase-out fraction; PLAN-07 S-corp reasonable-comp nets wages out of the SS wage base.
  - **Security/perf/frontend/DB:** pg Pool config + `pool.on('error')`; atomic `onConflictDoUpdate` (BE-02 race); documents-list base64-PII projection (SEC-01); what-if proto-pollution guard (SEC-03); **FE-02 W-2 entry focus bug — hoisted `W2Fields` to module scope**; DB-07 dashboard SQL aggregate; `clients(updated_at)` + `clients(email)` + `tax_returns(adjusted_gross_income)` indexes (clients had zero secondary indexes).
  - **Refuted (no change):** FORM-05 (8606 pro-rata denominator is correct per Form 8606 Line 9; only a contradictory docstring), MY-01 (multi-year carryforward held flat is inert — no consumer reads it within the horizon).
  - **SHIPPED 2026-06-01 (commits e768c0c / d3825d0 / 9bfb90a / 809e044 / 5d812de / 6f9121b / 6681644, deployed + live-verified):** FORM-03 (1040-X Lines 16→20 settlement chain reconciles on swaps); FED-05 (blind std ded wired + prod `clients.taxpayer_blind`/`spouse_blind` ALTER); PLAN-04 (kiddie/Coverdell eligible-children gate); PLAN-06 (QCD age-70½); the 16-scenario real-world battery (FED-03/04/06 pipeline coverage); H2-wired G1.92 Solo 401(k) + G1.96 §132(f) transit to engine-verified whatIf (the only 2 cleanly-wireable heuristic detectors in G1.46–G1.96 — the rest are qualitative; survey in docs/todo.md); **§461(l) Sch-C loss flow — signed `scheduleCNetSigned` now flows the Sch C loss to AGI, capped by the §461(l) addback; `netSeIncome` stays floored for SE-tax/QBI/local/earned-income (invariant — a loss may not reduce those)**; **STL-05 — Maryland two-component EITC: net benefit = max(45% refundable floor, min(50% nonrefundable, MD tax)) (commits 6681644 / 601ae5f)**; **K-1 §199A(b)(2)(B) wage/UBIA limit — calculateQbi applies max(50% W-2 wages, 25% wages + 2.5% UBIA) phased over the band when the K-1 supplies positive section199aW2Wages/Ubia (e6540bb)**; **AMT Form 6251 line 2e — taxable state refund removed from AMTI; calculateAmt floor moved from prefs to AMTI (de0e27e)**; **wash-sale §1091(d)/§1223(3) holding-period tack — replacement formBox flips ST→LT when the tacked period crosses one year (310ebf5)**; **PLAN-08 — `evaluatePlanningOpportunities` now enforces the catalog `validUntil` gate (`isStrategyExpiredForYear`); a return past a strategy's validUntil tax year suppresses it (0afb4e8)**.
  - **Still open (see `.claude/handoff.md`):** auth + multi-tenancy (D15, POSTPONED to Haven fusion); god-file refactor; FE-03/04 frontend robustness; H2-wire heuristic planning detectors (≈G1.67–G1.96). **RESOLVED 2026-06-05 (deferred-backlog clear):** DB-02/03 N×M planning query storm — the firm-wide hit-list + dashboard Top-10 now rank via a precomputed `tax_returns.planning_score` (+`planning_marginal_rate`) column (indexed `ORDER BY planning_score DESC LIMIT n`), written at recalc in taxReturnPipeline; only the top-N re-run the engine (recompute-sweep after any catalog/score change). **`GET /clients` keyset-paginated** (`{items,nextCursor}`, ?limit≤200/?cursor/?q/?filingStatus, column-projected; the cursor carries a microsecond-precise UTC timestamp to avoid same-ms skips). prod migration cutover (done 2026-06-04c); STL-05 MD EITC (shipped 2026-06-01).
- **2026-05-28 DEEP AUDIT — 5 correctness bugs found + FIXED** (each hand-calc'd + regression-tested in `tax-engine-realworld-scenarios-tests.ts`):
  - **H-1 QBI §199A** taxable-income cap now reduced by net capital gain (LTCG + qualified dividends) per §199A(e)(3) — was over-deducting whenever the cap binds with preferential income (`taxCalculator.ts calculateQbi` + `taxReturnEngine.ts` call site).
  - **H-2 + M-1 NIIT §1411** base rebuilt from the engine's component buckets — now includes passive Schedule-E rental, 1099-MISC + K-1 royalties, K-1 portfolio/passive income, and post-netting gains (§121 remainder, §1031 recognized, QSBS, K-1 Box 8/9a). Was understating NIIT. RE-professional rental excluded via `client.rentalRealEstateProfessional`; active K-1 / Schedule C stay excluded as non-passive trade/business.
  - **M-2 charitable** capital-gain property (30%) deduction now also bounded by the overall 50%-of-AGI ceiling minus cash per §170(b)(1) — independent 60%/30% caps previously allowed up to 90% of AGI.
  - **M-3 dependent-care** (Form 2441) now disallowed for MFS unless lived-apart and treated as not married (§21(e)(2)).
  - Also: 4 api-server typecheck defects fixed (incl. a masked spousal-IRA logic bug reading a misspelled field); path-to-regexp + qs CVEs patched (`pnpm.overrides`); global Express error middleware; document-approve + client-delete wrapped in DB transactions; versioned-migrations baseline (`docs/db-migrations.md`); new `pnpm --filter @workspace/scripts run test:no-api` runner (36 suites / 2,915 assertions green).
  - **Known SECONDARY finding — RECONCILED 2026-05-28 (follow-up session):** 3 live-API integration suites (`tax-engine-scenarios`, `-phase1-integration`, `-k1-integration`) had STALE expected values predating the C3 QBI-auto-default (2026-05-27) — PROVEN to fail identically at baseline `8db8375`; the engine was correct. All 9 stale assertions were independently re-hand-calc'd against the QBI auto-default (active K-1 Box 1 + Sch C net SE → 20% §199A, bound by either the 20%-of-QBI amount or the 20%-of-(taxable−net-cap-gain) cap), confirmed to match the engine, and rewritten with Hand-calc comment blocks. **All three suites now green** (K-1 23/23, phase1 55/0, scenarios 95/0). `tax-engine-ai-overlay-tests` still needs a real `AI_API_KEY` (a dummy key fails extraction → doc goes `failed` → approve correctly 400s; environmental, not a code issue).
- **Phase H FULLY COMPLETE 2026-05-27 — all 12 items + ALL sub-gaps closed in follow-up session.** Pure primitives in `artifacts/api-server/src/lib/whatIfEngine.ts`, `multiYearEngine.ts`, and `form8606.ts`. Threaded into the planning engine via `PlanningInputs.baselineInputs?: TaxReturnInputs`. Sub-gap closure session shipped:
  - **H3 detector wiring** — `runDetectorMultiYear` helper in planningEngine.ts wraps `runMultiYearTrajectory` + `compareMultiYearTrajectories` for clean per-detector use. Three wires: G1.3 bunching (2-year alternating cycle), G1.8 DAF (3-year front-loading), G1.4 Roth (5-year horizon with year-4 projected RMD at conversion × 1.07^4). Engine-verified `multiYear: { horizonYears, baselineYearTax[], scenarioYearTax[], yearByYearDelta[], totalSavings, growthAssumption, multiYearAssumptions[] }` field on each hit. estSavings annualizes to totalSavings/horizon for the H3-wired detectors when baselineInputs available; falls back to heuristic otherwise.
  - **H5 expansion** — 4 new asset types added (no DB migration; text column). `espp_shares` (purchase basis + ordinary income at disqualifying), `iso_amt_credit_shares` (regular vs AMT basis spread = §53 credit), `restricted_stock_pre_83b` (FMV-at-grant tracking; income recognized at vest per Treas. Reg. §1.83-1), `crypto` (Notice 2014-21 — property, each disposition = taxable event).
  - **H6 Part III** — `computeForm8606PartIII` implements Treas. Reg. §1.408A-6 Q&A 8 ordering rule (contributions → conversions → earnings) with qualified-distribution shortcut for over-59½ + 5-year clock. 10% additional tax (IRC §72(t)) on taxable earnings when under 59½. PDF gains a dedicated Part III section with §1.408A-6 caveat. New `roth_ira_distribution` adjustment type. Engine reads basis from H5 roth_ira `afterTaxBasis`.
  - **H8 rule-engine verification** — `verifyAndDedupeCandidates` post-processes LLM discovery responses: matches IRC sections against catalog via normalized substring match; tags candidates as `catalog-overlap` (catalog has it but didn't fire — review for missing data) or `extra-strategy` (LLM-only, qualitative judgment). Drops candidates that duplicate already-detected hits (LLM occasionally violates the dedupe instruction in the system prompt). Frontend shows the verification badge above each candidate's rationale.
  - **H1 catalog v1.4** (5 new strategies): G1.21 §1031 like-kind exchange timing, G1.22 pre-RMD Roth conversion ladder (age 60-72 with > $500k trad IRA), G1.23 cost-segregation study (rental + ≥24% marginal), G1.24 Qualified Opportunity Zone (capital gains > $100k), G1.26 backdoor Roth IRA (high-income filer above direct-Roth phase-out — reads H5 trad IRA balance to detect §408(d)(2) pro-rata trap).
  - **H1 catalog v1.5** (6 more new strategies → 31 total): G1.27 inherited IRA 10-year rule (SECURE 1.0 — heuristic informational for age < 60 + trad IRA > $50k), G1.28 defined benefit / cash balance plan (age-tiered 150k-300k cap for SE > $300k, H2-wired), G1.33 Clean Vehicle Credit §30D / §25E (H2-wired $7,500 with MAGI gate), G1.34 Residential Clean Energy §25D (H2-wired 30% × $20k assumed install through 2032), G1.39 §1202 QSBS (heuristic informational $238k for K-1 + AGI > $500k), G1.45 §121 home sale exclusion (heuristic for H5 primary_residence with embedded gain > $100k).
  - **H1 catalog v1.6** (6 more new strategies → 37 total): G1.29 §529→Roth SECURE 2.0 (heuristic PV $12,114 for H5 529 ≥ $35k), G1.31 Saver's Credit §25B (H2-wired, 4-tier AGI band × $2k/$4k cap), G1.32 DCFSA vs §21 Dependent Care Credit (heuristic ~$883 for working parents with marginal ≥ 22%), G1.36 R&D Credit §41 (heuristic $3,000 first-time ASC for SE > $100k), G1.37 §25C Energy Efficient Home Improvement (H2-wired $1,500 heat pump example), G1.40 §1244 ordinary loss on small biz stock (heuristic 17% rate spread for cap-loss CF > $25k + income > $100k).
  - **H1 catalog v1.7** (5 more new strategies → 42 total): G1.46 Spousal IRA §219(c) (H2-wired, MFJ + earned income > $7k), G1.47 §453 Installment Sale (heuristic real_estate/home gain > $250k + AGI > $250k), G1.48 §83(b) election timing (heuristic informational for restricted_stock_pre_83b H5 asset), G1.49 Family Employment of Children §3121(b)(3)(A) (H2-wired, sole-prop SE + kids under 17, $14,600 child std-ded), G1.51 AOC vs LLC §25A (H2-wired, switch LLC → AOC for undergrad student, $500 extra credit).
  - **H1 catalog v1.8** (5 more new strategies → 47 total): G1.30 ACA PTC §36B reconciliation (heuristic informational, AGI in marketplace range + SE income proxy), G1.41 §1045 QSBS Rollover (heuristic, founder profile + LTCG > $500k, 60-day reinvestment window), G1.42 SE Health Insurance §162(l) (H2-wired, net SE > $30k + no existing SEHI, 100% above-the-line per §162(l)(2)(A) cap), G1.43 Wash-sale §1091 proactive avoidance (heuristic, cap-loss CF > $5k, forward-looking coaching), G1.50 §72(t) SEPP early-retirement (heuristic, age 50-58 + IRA > $200k + low income, FIRE-movement clients).
  - **H1 catalog v1.9** (5 more new strategies → 52 total): G1.52 Estimated Tax Safe Harbor §6654 (heuristic, SE > $20k + fed tax > $5k, 100%/110% safe-harbor calc), G1.53 Kiddie Tax §1(g) minimization (heuristic, kids under 17 + AGI > $200k HNW proxy, TY2024 $2,600 threshold), G1.54 §183 Hobby Loss qualification (heuristic, SE in $1k-$10k borderline range, 3-of-5-years safe harbor), G1.55 Custodial Roth IRA (heuristic, SE > $50k + kids — G1.49 companion, 50-yr PV growth), G1.56 Specific-Share-ID lot selection (heuristic, LTCG/STCG > $5k, Treas. Reg. §1.1012-1(c) HIFO election).
  - **H1 catalog v1.10** (5 more new strategies → 57 total): G1.57 NQDC §409A deferred comp (heuristic, W-2 > $400k + age 40-55), G1.58 State residency change (heuristic, high-tax state + AGI > $500k + state tax > $30k), G1.59 Coverdell ESA §530 (heuristic, AGI under phase-out + kids), G1.60 §41(h) R&D Payroll-Tax Election (heuristic, SE $100k-$5M small biz), G1.61 §221 Student Loan Interest (H2-wired, AGI under $95k/$195k phase-out, $2,500 above-the-line).
  - **H1 catalog v1.11** (5 more new strategies → 62 total): G1.62 §263A Inventory Method Choice (heuristic, SE > $100k retailer/wholesaler — TCJA $30M cash-method threshold), G1.63 Lot Rotation withdrawal sequence (heuristic, age 60+ with diversified accounts — taxable → deferred → Roth order), G1.64 §168(k) Bonus Depreciation OPT-OUT (heuristic, low-income biz year — defer to higher bracket), G1.65 Adoption Credit §23 (heuristic, kids + AGI < $292k cap — $16,810 max), G1.66 Rollover-IRA → 401(k) §408(d)(2) fix (heuristic, G1.26 backdoor Roth pro-rata trap).
  - **Validation audit (NEW `docs/planning-strategy-audit.md`)**: per-strategy verdict — IRC + TY2024/2025 limits cross-referenced against Notice 2023-75 / 2024-80 / Rev. Proc. 2023-34 / 2024-40 / IRA 2022 / SECURE 2.0. ALL 42 strategies valid + correct for real-world TY2024/2025 use.
  - **End-to-end scenarios coverage (NEW `tax-engine-planning-scenarios-tests.ts`)**: 6 realistic CPA archetypes verifying which strategies fire across full client profiles + estSavings ranges + cross-strategy interaction shape.
  - **H2 wiring (6 G1 detectors)** — G1.1 SEP / G1.5 AMT-ISO / G1.6 NIIT / G1.9 TLH / G1.10 FTC attach engine-verified `whatIf` with `semantics="savings"`. G1.4 Roth attaches with `semantics="cost"` (current-year tax cost; long-term benefit stays in heuristic estSavings). G1.3 / G1.7 / G1.8 are multi-year-shaped — H3 prereq. Each mutation is documented in code + assumptions list.
  - **H12 transparency** — All 10 detectors populate `assumptions: string[]`. Variable-amount strategies (SEP, NIIT, Roth) also expose `whatIfSensitivity: { low, mid, high }` from ±10% scenarios (batched in one runWhatIfScenarios call). `whatIf.mutations` exposes the exact engine mutations for CPA audit.
  - **H7 cross-strategy** — `evaluateCrossStrategyScenario` stacks all "savings" H2 mutations into one engine run. Returns `crossStrategy: { stackedStrategyIds, combinedDelta, sumOfIndividualSavings, interactionEffect }` on /planning-opportunities when ≥2 stackable hits present. interactionEffect is typically negative (bracket-stacking erosion).
  - **H4 state-residency** — POST /clients/:id/state-comparison runs the engine for each target state (default TX/FL/NV/WA/TN), re-sourcing W-2/1099 stateCode in addition to client.state. Returns sorted table with per-state delta. New Planning card.
  - **H11 peer benchmark** — GET /clients/:id/peer-benchmark loads firm clients in ±$50k AGI band (overridable), computes mean/median/p25/p75 effective rate + client's percentile rank. New Planning card with cohort distribution + verdict.
  - **H9 client-context** — 4 optional columns on clients (risk_tolerance, target_retirement_age, estate_plan_stage, planning_goals). Used by H9 planningMemo personalization (LLM gets concrete rules per field). New ClientForm section.
  - Frontend `whatIf` panel uses `combinedRefundDelta` not `combinedTaxDelta` as the savings magnitude — critical for credit-based strategies (FTC) where federalTaxLiability stays flat but credits change.
  - **Remaining H1 catalog work (post-v1.4):** ~35 more strategies in the canonical universe. Foundation proven (each new strategy ~2-4 hrs incl. detector + tests).
- **C-batch shipped 2026-05-26 (6 items).** Coverage map in `docs/coverage-matrix.md`. Sub-gaps tracked:
  - **C5 §1031** — engine computes recognized/deferred from `section_1031_realized_gain` + `section_1031_boot_received` adjustments; recognized flows to LTCG **and into the §1411 NIIT base** (closed 2026-05-28; the stale Form 8824 PDF footnote that said otherwise was corrected 2026-05-29 — FORM-01). Form 8824 substitute PDF exists (`form8824.ts`).
  - **C6 ESPP+ISO disqualifying** — adjustments `iso_disqualifying_disposition_ordinary` + `espp_disqualifying_disposition_ordinary` add to ordinary income; NOT FICA-taxed (Notice 2002-47 + Rev Rul 71-52). Cap-gain side is the CPA's responsibility (Form 8949 code "B").
  - **C7 §163(j) + §461(l)** — §163(j): full engine with ATI-30% cap + indefinite carryforward + uncapped biz interest income + uncapped floor plan financing. ATI proxy ≈ pre-§163(j) ordinary income (sub-gap: true ATI per §163(j)(8) needs depreciation addback + pre-§163(j)/NOL/QBI base). Small-biz $30M gross-receipts exception and real-property-trade election are CPA's call. §461(l): CPA-supplied addback (engine doesn't auto-aggregate Sched C/E/K-1 losses across the $305k/$610k threshold).
  - **C4 Form 1040-X** — snapshot-based diff (`originalSnapshot` jsonb on tax_returns). IRS rounding: col (b) = round(c) − round(a). Lock-as-filed → modify → recompute → diff.
  - **C8 Form 4868** — pdfkit substitute PDF (per Pub 1167). Line 5 derived as `federalTaxLiability + federalRefundOrOwed` plus optional CPA-supplied `estimatedTaxAlreadyPaid`.
  - **C1 Coverage matrix doc** at `docs/coverage-matrix.md` — keep updated when shipping coverage changes.
- **Phase G — Tax Planning Detector shipped (2026-05-26).** All 10 G1
  rules deployed end-to-end (G1.1 SEP-IRA, G1.2 PTET, G1.3 bunching,
  G1.4 Roth conversion, G1.5 AMT-ISO timing, G1.6 NIIT cliff, G1.7
  §199A phase-in, G1.8 charitable DAF, G1.9 tax-loss harvesting, G1.10
  Foreign Tax Credit). Architecture: **LLM never touches math.**
  Layer 1 (catalog) in `lib/planning-strategies/`; Layer 2 (detector
  engine) in `artifacts/api-server/src/lib/planningEngine.ts`; Layer 3
  (composite scoring) inline in planningEngine; Layer 4 (AI synthesis
  — memo, email, missing-data) in `artifacts/api-server/src/lib/planningMemo.ts`
  with deterministic stub fallback when aiEnabled === false. Endpoints:
  GET `/api/clients/:id/planning-opportunities`,
  GET `/api/clients/:id/planning-memo`,
  GET `/api/clients/:id/planning-email`,
  GET `/api/clients/:id/planning-missing-data`,
  GET `/api/planning-hit-list` (firm-wide ranking).
  Frontend: new Planning tab in ClientDetail + Top-10 dashboard widget.
  Seed: `scripts/src/seed-dummy-clients.ts` ingests 88 archetypes for
  demos.
- **Phase G4 — Multi-year intelligence shipped (2026-05-26).** 5
  multi-year detectors in
  `artifacts/api-server/src/lib/planningEngineMultiYear.ts`:
  G4.1 persistent NIIT (avg × 0.5 recovery), G4.2 persistent AMT
  (avg × 0.4), G4.3 permanent std-ded-cliff bunching (sums Sched A
  line items so it sees the would-be itemized total even when std-ded
  chosen), G4.4 capital-loss carryforward stuck (min(cf, $20k) ×
  marginal), G4.5 passive-loss suspension growing (growth × marginal
  × 0.5). New endpoint
  `GET /api/clients/:id/planning-multi-year` returns hits + yearsAvailable
  + yearsCovered; empty hits when only 1 year persisted.
  Frontend: "Multi-year trends" section on Planning tab (indigo cards).
  Seed extension ingests 2 years per archetype (TY2024 prior + TY2025
  current, ×1.05 YoY scaling) and POSTs /tax-return for both years.
  Catalog bumped to v1.1.0. 70 hand-calc unit tests + 11 new integration
  assertions.
- **Phase G5 — Pro tier feature flag shipped (2026-05-26).** Env-var
  driven gate on every planning surface. `PRO_TIER_ENABLED=true`
  (default) preserves current behavior. Set `PRO_TIER_ENABLED=false`
  to gate ahead of pricing rollout:
  - New endpoint `GET /api/settings` exposes the flag (boolean) for
    frontend gating. Add new flags here as needed; never expose secrets.
  - All `/api/.../planning-*` and `/api/planning-hit-list` routes
    return HTTP 402 Payment Required with `{ code: "PRO_TIER_REQUIRED" }`
    when off. Single middleware in `routes/planning.ts`.
  - Frontend reads `/api/settings` via `useGetSettings`:
    - Dashboard: Top-10 planning widget swaps to an `UpgradeProCard`
    - ClientDetail: Planning tab trigger + content hidden; grid drops
      from `grid-cols-10` to `grid-cols-9`
    - Gates only on explicit `proTierEnabled === false` to avoid
      flashing the paywall during settings load
  - 21 new dual-state Pro-tier integration assertions
    (`tax-engine-pro-tier-tests.ts`): 5 on-state + 16 off-state.
  - Stripe billing flow deferred to D18; the CTA button is a visual
    placeholder. Future: per-firm `proTierEnabled` column after D15
    multi-tenancy lands.
- AMT preferences modeled: line 2g SALT addback, line 2k ISO bargain, line 2e state-refund recapture, **line 2i MACRS-vs-ADS depreciation (`amt_depreciation_adjustment`, ±) + AMT NOL/ATNOLD §56(d) (`amt_nol_carryforward`, 90%-of-AMTI cap) — 2026-06-01 s2**. All Form 6251 prefs now modeled.
- K-1: §199A wage/UBIA limit + **per-business SSTB phase-out (isSstb) + §704(d)/§465 basis+at-risk loss limits + guaranteed payments (Box 4, `box4GuaranteedPayments` → AGI+SE, non-QBI) — all 2026-06-01 s2**. Remaining: per-business (Form 8995-A) wage/UBIA limit is aggregate, not per-business; basis not reduced by distributions.
- Other carryforwards: NOL, AMT credit, charitable (capital loss + §469 PAL + K-1 passive loss carryforward ARE supported)
- Foreign income exclusion (§911 FEIE), treaty positions
- Trust/estate (1041), partnership/corporate (1065/1120/1120-S)
- E-filing — Option A means CPAs e-file through *their* software, not ours
- HI / NJ / NY partial retirement-income exemptions: **all wired (HI employer-funded cap via `hi_employer_funded_pension`; NY Line 26 govt pension full + Line 29 $20k/$40k via `ny_government_pension`; NJ verified correct) — 2026-06-01 s2** (PA, IL, MS full). Remaining: HI Schedule J exclusion-ratio auto-split, NY per-spouse $20k.
- Vermont calc has personal exemption + SS exclusion as of 2026-05-21; prior versions were approximate

## User context

- Direct, pragmatic, doesn't want hand-holding but does want thoroughness.
- **Hates test failures that turn out to be wrong test expectations.** Hand-calc before asserting.
- **Phase 4: Option A (CPA-tool overlay).** Consumer DIY is parked. Don't build interview UI, e-file, or ERO-related infra.
- Explicitly does NOT want a Lacerte clone (5+ years / $20M+). Wants as close as feasible without that scope.
- Next-phase priorities (post Phase G + C11 outreach-packet + C-batch ship 2026-05-26): (a) **H2 what-if engine (1-2 wks)** — turns every existing planning rule into actual delta-dollar values; foundation for H3/H7/H10/H12; (b) **Live CPA outreach campaign using the refreshed packet in `docs/outreach/` — awaits user availability;** (c) CPA-firm multi-tenancy auth (Phase D15) once a paid partner is committed; (d) Stripe billing flow (D18) — only after a paid partner asks for it. AI-overlay UX shipped 2026-05-21. C-batch shipped 2026-05-26 (6 items: Forms 4868 + 1040-X + §1031 + ESPP/ISO disqualifying + §163(j)+§461(l) + coverage matrix doc).

## Where to look first when picking up a session

1. `.claude/handoff.md` — last session's state. May be stale; check `git log` to corroborate.
2. **`docs/product-todo.md` — the prioritized working to-do (enhancements + fixes), consolidated 2026-06-05 from the audit + Haven roadmap + the engine/planning/extraction/UltraTax analyses.** Start here for "what should I build next."
3. `git log --oneline -10` — recent commits.
4. `git status` — uncommitted WIP.
5. Run the standalone test suites to confirm baseline: `pnpm --filter @workspace/scripts exec tsx ./src/tax-engine-tests.ts` (also `-deep-tests` and `-phase1-unit-tests`).
