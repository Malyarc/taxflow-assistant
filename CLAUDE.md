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
- **Test files (current set, 1,122 assertions):**
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
  | `tax-engine-integration-tests.ts` | yes |
  | `tax-engine-deep-integration-tests.ts` | yes |
  | `tax-engine-new-features-tests.ts` | yes |
  | `tax-engine-scenarios.ts` | yes |
  | `tax-engine-phase1-integration-tests.ts` | yes |
  | `tax-engine-phase15-integration-tests.ts` | yes |
  | `tax-engine-exports-tests.ts` | yes (PDF/CSV/JSON/UltraTax-GEN endpoints) |
  | `tax-engine-ai-overlay-tests.ts` | yes (upload → review → approve gate) |
- **Scenarios are CPA-style end-to-end cases.** Each one has a `Hand-calc:` comment block — keep that convention. When a scenario fails, double-check your hand-calc before mutating the assertion; the calculator is usually right.
- **Run all suites after any pipeline or schema change.** The Phase 1 work flushed out one regression (scenario 8 — needed to add EITC to expected refund).

## Local dev

- Postgres in Docker: container `haven-postgres` (shared with another local project), db `taxflow_pro`, user/pass `brookhaven`. URL `postgres://brookhaven:brookhaven@localhost:5432/taxflow_pro`.
- API server needs `DATABASE_URL` and `AI_API_KEY` (dummy is fine if you're not exercising AI extraction). No `dotenv` is loaded — pass env vars on the command line or `source ~/.env`.
- Frontend dev server: `pnpm --filter @workspace/tax-app run dev` on port 3010 (configured in `.claude/launch.json`).
- The api-server runs from `./artifacts/api-server/dist/index.mjs` after `pnpm run build`. The build script uses esbuild — fast (<200ms).
- **When running commands from a parallel worktree:** preview tools use the harness CWD, which may not match where the work is. Use `pnpm --dir /path/to/worktree --filter @workspace/x run ...` or update the `.claude/launch.json` `runtimeArgs` with `--dir`.

## EC2 deploy

Standard cycle, run on the box:
```bash
ssh ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-assistant
git checkout -- pnpm-lock.yaml     # discard pnpm install drift; conflicts every time otherwise
git pull
pnpm install
set -a; source ~/.env; set +a       # exports DATABASE_URL and AI_API_KEY for the next commands
pnpm --filter @workspace/db run push    # only if schema changed
pnpm --filter @workspace/tax-app run build
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
```

**EC2 gotchas:**
- Don't `curl` the public DNS from inside EC2 — AWS networking drops the loopback. Use `localhost:8080`.
- `git pull` will conflict on `pnpm-lock.yaml` every time — `git checkout -- pnpm-lock.yaml` first.
- Credentials are in `~/.env` on EC2; never put them in commits, code, or chat.

## Security / data handling

- Demo banner is intentional: "do not upload real tax documents." AI extraction sends file content to Gemini.
- API keys + DB URLs live in `~/.env` on EC2 and the user's local `.env`. Never commit credentials.
- If the user pastes a credential in chat (it happens), flag it once and recommend rotation; don't keep mentioning.

## Known limitations (current scope)

Several Phase 2/3 limitations have been resolved (multi-state foundation, MACRS, capital-loss $3k+carryforward, PA/IL/MS retirement exemptions, Oregon Form 40 Line 13). Remaining intentional gaps:

- Schedule D per-transaction detail (1099-B is summed; no wash-sale, no per-lot)
- Per-property rental tracking (Schedule E is aggregate adjustments, not per-property)
- Part-year residency in multi-state framework (resident + non-resident work; part-year doesn't)
- Local income taxes (NYC, MD counties, OH cities, IN counties)
- Most state-specific credits (state EITC for CA + NY are wired; others not)
- AMT preferences detail (state-tax addback, ISO bargain element, etc.)
- K-1 detail (partnership / S-corp pass-through specifics)
- Other carryforwards: NOL, AMT credit, charitable (capital loss + §469 PAL carryforward ARE supported)
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
- Next-phase priorities: validate UltraTax `.gen` with a real design partner; build Lacerte / ProConnect / Drake adapters; CPA-firm multi-tenancy auth (organizations / users / RBAC). AI-overlay UX shipped 2026-05-21 — covers upload → extract → CPA review → approve → audit-logged record write → `.gen` export.

## Where to look first when picking up a session

1. `.claude/handoff.md` — last session's state. May be stale; check `git log` to corroborate.
2. `git log --oneline -10` — recent commits.
3. `ONBOARDING.md` — original kick-off doc; may have context the handoff doesn't.
4. `git status` — uncommitted WIP.
5. Run the standalone test suites to confirm baseline: `pnpm --filter @workspace/scripts exec tsx ./src/tax-engine-tests.ts` (also `-deep-tests` and `-phase1-unit-tests`).
