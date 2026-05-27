# Handoff Note — 2026-05-27 (H2 What-If Engine MVP shipped)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked.

The coverage map (per-state + per-feature) lives in
**`docs/coverage-matrix.md`** — read before planning state or federal
coverage work.

Open sections after this session:
- **A** — strategic / business (A1 outreach, A2 D15 auth, A3 D18 Stripe)
- **B** — Planning Strategy tool smartness upgrades (H1-H12) ← H2 MVP just shipped
- **C** — engine coverage push (C2 top-10-state credits, C3 design-partner
  validation, C9 PA local EIT, C10 OH school district, C11 per-state PY
  residency)
- **D** — infra / security hardening (TLS, S3, soft-delete, etc.)
- **E** — reactive / deferred (only when a customer asks)

Read `docs/todo.md` BEFORE picking a task. The Claude task tool inside
any single session is ephemeral — only that file persists.

## Headline

**H2 what-if engine MVP shipped (4 commits, 87 new hand-calc'd
assertions). Pure `whatIfEngine.ts` + Pro-tier-gated POST
/clients/:id/what-if endpoint + G1.1 SEP-IRA detector wired to attach
engine-verified `whatIfDelta` to its OpportunityHit + frontend Planning
tab renders the verified delta in place of the heuristic with a
"Engine-verified (H2)" badge and per-field breakdown panel.**

The remaining 9 G1 + 5 G4 detectors still emit heuristic estSavings;
each needs a strategy-specific mutation model that's straightforward
to add when picked up. ZERO documented engine gaps; 5 sub-gaps tracked
(4 C-batch + the partial H2 detector wiring).

## What landed (commits in order)

| Commit | Item | Notes |
|---|---|---|
| `80cf4ef` | **H2 core whatIfEngine + tests** | `artifacts/api-server/src/lib/whatIfEngine.ts` (pure): WhatIfMutation discriminated union, WhatIfScenario, WhatIfDelta, WhatIfResult types. applyWhatIfMutations returns new TaxReturnInputs without mutating baseline. runWhatIfScenario / runWhatIfScenarios entry points. computeWhatIfDelta does pure scenario−baseline math. `scripts/src/tax-engine-whatif-tests.ts` (79 hand-calc'd assertions). Registered in `scripts/tsconfig.json` exclude. |
| `a063870` | **H2 POST /clients/:id/what-if endpoint** | OpenAPI schemas added; api-zod + api-client-react regenerated. `taxReturnPipeline.ts` refactored to also return `inputs`; new `loadTaxReturnInputs(clientId)` helper. `routes/planning.ts` handler with per-kind mutation validation (HTTP 400 on bad combinations). Pro-tier gated. Smoke-tested live. |
| `01cc30e` | **H2 wired into G1.1 SEP-IRA detector** | `lib/planning-strategies/types.ts` — `WhatIfDelta` interface + optional `whatIfDelta` field on `OpportunityHit`. OpenAPI updated. `planningEngine.ts` — `PlanningInputs.baselineInputs?: TaxReturnInputs`; when present, SEP detector runs a what-if scenario (add `deduction` adjustment = recommended contribution) and attaches the delta. `routes/planning.ts` passes `baselineInputs` for `/planning-opportunities` (skipped for `/planning-hit-list` to keep N-client loop fast). 8 new wire-up assertions (Cases D1, D2). |
| `0cecc34` | **Frontend H2 display on planning cards** | `artifacts/tax-app/src/pages/ClientDetail.tsx` — when hit carries `whatIfDelta`, headline shows `\|combinedTaxDelta\|` instead of `estSavings`, emerald "Engine-verified (H2)" badge appears, and a per-field breakdown panel renders (Federal tax, State tax, AGI change, + NIIT/AMT when non-zero) with red/green sign cues. Verified live in browser. |

## Test state (final)

**ALL SUITES GREEN.** 87 new H2 assertions. Engine still at zero
documented federal/state gaps.

| Suite | Result | Notes |
|---|---|---|
| tax-engine-tests | 193/193 | |
| tax-engine-deep-tests | 37/37 | |
| tax-engine-planning-tests | 133/133 | |
| tax-engine-planning-multi-year-tests | 70/70 | |
| tax-engine-form1040x-tests | 45/45 | |
| tax-engine-form4868-tests | 40/40 | |
| tax-engine-section1031-tests | 30/30 | |
| tax-engine-espp-iso-tests | 27/27 | |
| tax-engine-section163j-461l-tests | 36/36 | |
| **tax-engine-whatif-tests** (NEW) | 87/87 | H2 (20 engine cases + D1/D2 detector wire-up) |
| (other pure + integration suites) | (✓ no regressions) | |

## Schema changes

**None.** H2 is a pure pipeline addition — no DB columns added; no
adjustment_type enum extensions. The new OpenAPI schemas
(WhatIfMutation, WhatIfScenarioBody, WhatIfDelta, WhatIfSummary,
WhatIfResponse) are wire-only.

## Deploy steps (for the user)

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')

# No schema changes this round — skip the db push.

pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
exit
```

Local frontend rebuild + rsync (Vite OOMs on EC2):
```bash
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

Verify by clicking through a self-employed seeded client at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com:
1. Open `/clients/<sole-prop-id>` → Planning tab.
2. The SEP-IRA opportunity card should display:
   - Headline savings number with "Engine-verified (H2)" emerald badge.
   - A "What-if engine delta (vs current return)" panel listing federal
     tax, state tax, AGI change (and NIIT/AMT when non-zero).
3. Other opportunity cards (Roth, NIIT, etc.) should look unchanged —
   they're still on the heuristic path.

## Sub-gaps surfaced this session

1. **H2 detector wiring is partial.** Only G1.1 SEP-IRA has the engine-
   verified `whatIfDelta`. G1.4 Roth conversion, G1.6 NIIT cliff,
   G1.9 tax-loss harvesting, G1.10 FTC unclaimed each need a
   strategy-specific mutation model (~3-5 days total). G1.3 bunching,
   G1.7 §199A wage-limit, G1.8 charitable DAF are multi-year
   strategies that don't have a clean single-year mutation —
   defer to H3 (multi-year scenario modeling).

The 4 C-batch sub-gaps from the previous session remain open:

2. **§163(j) ATI proxy approximation** — over-restricts for high-
   depreciation low-income filers.
3. **§461(l) auto-aggregation deferred** — engine accepts CPA-
   supplied addback; doesn't yet aggregate Sched C / E / K-1.
4. **§1031 / §121 recognized gains don't flow into NIIT base** —
   consistent with existing §121 pattern.
5. **Form 8824 (§1031) + Form 8990 (§163(j)) PDFs deferred** —
   CPAs hand-file from engine's computed values.

## What's left (post-H2 — strongest candidates)

1. **Expand H2 wiring to remaining G1 detectors (3-5 days)** — turn
   G1.4 / G1.6 / G1.9 / G1.10 from heuristic to verified.
2. **CPA outreach campaign (A1)** — packet complete; blocked on user
   availability.
3. **H5 — asset balance tracking (2-3 wks)** — unlocks RMD / NUA /
   Roth conversion sizing / mega-backdoor Roth detection.
4. **H1 — expand catalog 10 → 50+ rules (2 months calendar)** — with
   H2 verified, each new strategy ships with real deltas immediately.
5. **D15 — multi-tenancy auth (2-3 wks)** — gate to paid customers.
6. **D1 — TLS terminator (1-2 days)** — needed before paid customers.

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. docs/todo.md                 — THE LIVE TODO (read this first)
  2. docs/coverage-matrix.md      — Per-state + per-feature inventory
  3. .claude/handoff.md           — Last session state (H2 MVP shipped)
  4. .claude/roadmap.md           — Long-arc Phase A-G plan
  5. CLAUDE.md                    — invariants, closure log

Where we left off (2026-05-27): H2 what-if engine MVP shipped — 4
commits, 87 hand-calc'd assertions. Pure `whatIfEngine.ts` + Pro-tier-
gated POST /clients/:id/what-if endpoint + G1.1 SEP-IRA detector wired
to attach engine-verified `whatIfDelta` + frontend renders verified
delta with "Engine-verified (H2)" badge and per-field breakdown panel.

ZERO documented engine gaps. 5 sub-gaps tracked (4 C-batch + 1 H2
partial detector wiring).

Show me the full open TODO list. Top recommendation is **expand H2
wiring to the remaining 4 single-year G1 detectors** (G1.4 Roth,
G1.6 NIIT cliff, G1.9 TLH, G1.10 FTC — each ~1 day with a
strategy-specific mutation model). Sub-recommendations: A1 (CPA
outreach, awaits user availability), H5 (asset balance tracking),
D15 (multi-tenancy auth).

Quality bar:
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update docs/todo.md / docs/coverage-matrix.md / .claude/handoff.md /
  CLAUDE.md at session end
- Deploy to EC2 at the end (git pull + pm2 restart on EC2 + local
  pnpm build + rsync; NO db push needed this round)
```
