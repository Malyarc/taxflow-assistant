# CLAUDE.md — TaxFlow Assistant

Project-level notes for Claude sessions. Things that change every sprint live in `.claude/handoff.md` (a session-handoff doc, may be stale) or `ONBOARDING.md` (the original kick-off doc).

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

6. **Capital losses are dropped, not subtracted.** Pipeline uses `Math.max(0, longTermGains)` etc. IRS allows up to $3k/year of net cap loss against ordinary income; we don't model this yet. Documented known limitation — leave it as-is unless you're implementing Schedule D detail.

## Frontend conventions

- **Money fields use `<CurrencyInput>`**, never `<Input type="number">`. The CurrencyInput handles `$` prefix, commas, strip-on-focus.
- **Radix `<Select>` needs a `formReady` gate in edit mode** before mounting controlled selects. Otherwise Radix fires `onValueChange("")` on first render before SelectItems mount, wiping form state. See `ClientForm.tsx` for the working pattern (`formReady = !isEdit || (existing != null && form.email === (existing.email ?? ""))`).
- **`SelectContent` is capped at `max-h-96`** (`components/ui/select.tsx`) to keep long dropdowns (51 states) scrollable instead of overflowing the viewport.
- **shadcn-style Tabs use `data-state` for active/inactive.** When clicking tabs programmatically (eg in browser tests), `.click()` alone may not work — dispatch `mousedown` then `click` MouseEvents.

## Testing

- **Hand-calc every expected value** against IRS published rules before asserting it. The user has been burned by tests passing while the underlying calc was wrong (e.g. the AGI/Line-9 bug shipped despite unit tests passing).
- **Unit tests alone aren't enough.** Standalone suites verify the calculator; integration suites hit a live API at `localhost:8080` and exercise the full pipeline. Run both.
- **Adding a new test file** also requires adding it to `scripts/tsconfig.json`'s `exclude` array — the workspace typecheck fails otherwise.
- **Test files (current set, 1,790+ assertions across 28 suites — ALL 10 K-list federal-engine gaps + ALL 4 state-engine gaps closed end-to-end 2026-05-23 → 2026-05-26; Phase G4 multi-year shipped with 70 new hand-calc assertions; Phase G5 Pro-tier gate shipped with 21 new dual-state integration assertions; deep-audit suite still 210 assertions, accuracy-audit 97 assertions, 0 documented gaps; AI-overlay 33 env-gated):**
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
  | `tax-engine-planning-tests.ts` | no (133 hand-calc'd tests across 10 G1 detectors + G2 scoring helpers; Phase G) |
  | `tax-engine-planning-integration-tests.ts` | yes (29 assertions: Phase G API surface — G1 SEP via 1099-NEC, G1 PTET via S-corp K-1 + SALT, pure-W-2 silence, 404, G4 persistent NIIT 2-year, G4 single-year-history empty hits, G4 404) |
  | `tax-engine-planning-multi-year-tests.ts` | no (70 hand-calc'd tests across 5 G4 multi-year detectors; Phase G4) |
  | `tax-engine-pro-tier-tests.ts` | yes (Phase G5 — adapts to current PRO_TIER_ENABLED state: 5 on-state assertions OR 16 off-state assertions verifying 402 + body code on every planning endpoint. Run twice for full coverage.) |
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
pnpm --filter @workspace/db run push      # only if schema changed
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
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

## Known limitations (current scope)

Several Phase 2/3 limitations have been resolved (multi-state foundation, MACRS, capital-loss $3k+carryforward, PA/IL/MS retirement exemptions, Oregon Form 40 Line 13). Remaining intentional gaps:

- Schedule D per-transaction detail (1099-B is summed; no wash-sale, no per-lot)
- Per-property rental tracking (Schedule E is aggregate adjustments, not per-property)
- Part-year residency in multi-state framework (resident + non-resident work; part-year doesn't)
- Local income taxes for non-NYC jurisdictions (MD counties, OH cities, IN counties); NYC PIT shipped — NYC school tax credit + UBT + MCTMT still not modeled
- Most state-specific credits (state EITC: CA, NY, CO, IL, NJ, MA piggyback + MN Working Family Credit wired; CT/DC/DE/IN/IA/KS/LA/ME/MD/MI/MT/NE/NM/OH/OK/OR/RI/VT/VA/WA/WI not modeled. State CTC, state AMT, etc. not modeled)
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
- AMT preferences modeled: line 2g state-tax addback (auto from itemized SALT, override available), line 2k ISO bargain element. Still not modeled: line 2i MACRS-vs-ADS depreciation difference, line 2e state-refund recapture, AMT NOL.
- K-1 §199A wage/UBIA limits + SSTB phase-out (engine applies simplified 20% only); K-1 basis / at-risk fields stored but not enforced; K-1 guaranteed payments (Box 4) not modeled
- Other carryforwards: NOL, AMT credit, charitable (capital loss + §469 PAL + K-1 passive loss carryforward ARE supported)
- Foreign income exclusion (§911 FEIE), treaty positions
- Trust/estate (1041), partnership/corporate (1065/1120/1120-S)
- E-filing — Option A means CPAs e-file through *their* software, not ours
- HI / NJ / NY partial retirement-income exemptions (PA, IL, MS done)
- Vermont calc has personal exemption + SS exclusion as of 2026-05-21; prior versions were approximate

## User context

- Direct, pragmatic, doesn't want hand-holding but does want thoroughness.
- **Hates test failures that turn out to be wrong test expectations.** Hand-calc before asserting.
- **Phase 4: Option A (CPA-tool overlay).** Consumer DIY is parked. Don't build interview UI, e-file, or ERO-related infra.
- Explicitly does NOT want a Lacerte clone (5+ years / $20M+). Wants as close as feasible without that scope.
- Next-phase priorities (post Phase G + C11 outreach-packet ship 2026-05-26): (a) **Live CPA outreach campaign using the refreshed packet in `docs/outreach/` — the packet is research-synthesis-backed (~20 sources) and Phase-G-led; awaits user availability to send;** (b) CPA-firm multi-tenancy auth (Phase D15) once a paid partner is committed; (c) Stripe billing flow (D18) — only after a paid partner asks for it; validate UltraTax `.gen` with a real design partner; build Lacerte / ProConnect / Drake adapters. AI-overlay UX shipped 2026-05-21 — covers upload → extract → CPA review → approve → audit-logged record write → `.gen` export.

## Where to look first when picking up a session

1. `.claude/handoff.md` — last session's state. May be stale; check `git log` to corroborate.
2. `git log --oneline -10` — recent commits.
3. `ONBOARDING.md` — original kick-off doc; may have context the handoff doesn't.
4. `git status` — uncommitted WIP.
5. Run the standalone test suites to confirm baseline: `pnpm --filter @workspace/scripts exec tsx ./src/tax-engine-tests.ts` (also `-deep-tests` and `-phase1-unit-tests`).
