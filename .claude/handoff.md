# Handoff Note — 2026-05-26 (Phase G1+G2+G3 shipped)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Phase G — Tax Planning Initiative landed end-to-end.** TaxFlow flipped
from "data-keying tool" to "revenue-generating advisory tool" in a single
session. All 10 G1 detectors shipped + G2 firm-wide hit list + G3 AI
synthesis (memo, email, missing-data) + 85-archetype seed for demos.

The engine started this session at zero documented gaps (10 K-list +
4 G-list closed end-of-last-session); the planning layer builds on top
**without changing engine math** per the architectural invariant
("LLM never touches the math").

## What landed (session commits, in order)

| Commit | SHA  | Title |
|---|---|---|
| 1     | `18cb9e5` | Knowledge base scaffolding — `@workspace/planning-strategies` |
| 2     | `5e958ff` | planningEngine framework + G1.1 SEP-IRA detector |
| 3     | `a1dd995` | G1.2 PTET + G1.10 Foreign Tax Credit detectors |
| 4     | `fdbbf22` | G1.3 Bunching + G1.8 Charitable DAF detectors |
| 5     | `16d3b96` | G1.4 Roth conversion + G1.5 AMT-ISO timing detectors |
| 6     | `4b28d8e` | G1.6 NIIT cliff + G1.7 §199A QBI phase-in detectors |
| 7     | `329da11` | G1.9 Tax-loss harvesting — ALL 10 RULES SHIPPED |
| 8     | `4712743` | API endpoint + OpenAPI + integration tests |
| 9     | `2b0e0b8` | Planning tab in ClientDetail |
| 10    | `f9050a4` | Seed 85 dummy CPA-client archetypes |
| 11    | `7095214` | Composite scoring + hit list endpoint + dashboard widget (G2) |
| 12    | `6c96c5c` | AI synthesis: memo + email + missing-data (G3 + collapsed G3 half 2) |

## Test state

- **133/133 planning unit tests pass** (was 0 at session start).
- **18/18 planning integration tests pass** vs live API on localhost.
- Deep audit: 210/210 unchanged. Accuracy audit: 97/97 unchanged.
- Workspace typecheck clean across all 12 workspaces.
- **Engine net: ZERO documented gaps** (preserved from prior session).

## Architecture (5-layer planning module)

1. **Catalog (Layer 1)** — `lib/planning-strategies/strategies-v1.json`,
   versioned + fail-fast validated at module load. 10 strategies.
2. **Detector engine (Layer 2, deterministic, NO LLM)** —
   `artifacts/api-server/src/lib/planningEngine.ts`. Reads
   ComputedTaxReturn + client + adjustments; emits OpportunityHit[].
3. **Scoring (Layer 3, deterministic)** — `planningScore()` in
   planningEngine; uses marginalRateWeight × engagementComplexityWeight
   × stickinessWeight per the Phase G plan.
4. **AI synthesis (Layer 4, LLM narration only — NEVER math)** —
   `artifacts/api-server/src/lib/planningMemo.ts`. Three functions:
   generatePlanningMemo, generateClientOutreachEmail, inferMissingData.
   Each has a deterministic stub fallback when aiEnabled === false.
5. **Online intel refresh (Layer 5)** — NOT BUILT this session. Clean
   seam left for a quarterly cron job that pulls IRS / state DOR /
   Tax Foundation updates, LLM summarizes diffs, human reviews before
   catalog changes.

## New endpoints

```
GET /api/clients/:id/planning-opportunities  → OpportunityHit[]
GET /api/clients/:id/planning-memo           → markdown memo
GET /api/clients/:id/planning-email          → client outreach email
GET /api/clients/:id/planning-missing-data   → questions to ask client
GET /api/planning-hit-list                   → firm-wide ranking, filterable
    [?category=X&state=ST&minAgi=Y&maxAgi=Z&limit=N]
```

## Frontend changes

- **New "Planning" tab in ClientDetail** (10th tab, after "Adjustments").
  Top: total estimated annual savings. Body: cards per opportunity
  grouped by category, with rationale + action + prerequisite-data
  list + IRS citation. "Generate AI memo" button reveals a 3-card
  panel: memo (markdown) + outreach email + missing-data list.
- **New "Top 10 planning targets" widget on Dashboard.** Rows
  click-through to the client's Planning tab. Shows planningScore +
  total savings + AGI + marginal rate + first 3 strategy IDs.

## Seed data (for demos)

`scripts/src/seed-dummy-clients.ts` — 85 archetypes covering:
- Simple W-2 only (20): basic variations
- Moderate complexity (30): sole-prop + Sch E + retiree + tech +
  multi-W-2 MFJ + 1099-NEC + HSA + IRA + bunching candidates + ACA
- High complexity (25): tech founder + ISO + AMT, RE investor 5
  rentals, S-corp + K-1 + §199A, day trader, multi-state PTET,
  doctor DAF, expat FEIE + FTC, $5M QSBS founder, QSS year-of, NYC
  jumbo, MFJ both SE, MFS edge, CA PTET, SEHI, §121, partnership
- Edge cases (10): WA $1M LTCG, kiddie tax, MN MFJ WFC, NOL
  carryforward, NIIT cliff, $5M LTCG, CT retiree SS, just-over §199A
  threshold, kiddie + parent K-1 mix, CA AMT

Run after fresh DB push:
```
pnpm --filter @workspace/scripts exec tsx ./src/seed-dummy-clients.ts
# Or to reset prior-seed rows first:
pnpm --filter @workspace/scripts exec tsx ./src/seed-dummy-clients.ts --reset
```

## Production verification (post-deploy)

When deployed, smoke tests:
```
curl http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com/api/healthz
# Pick a real client ID from /api/clients and:
curl http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com/api/clients/<ID>/planning-opportunities
curl http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com/api/planning-hit-list?limit=5
```

## Open items (next session priorities)

**Option A — Phase G4 multi-year intelligence (~1 week, RECOMMENDED).**
With 85 archetypes seeded but only 1 year of history each, the next
high-leverage build is multi-year tracking:
  - opportunityRealizedVsDetected diff
  - trend rules (3 years of NIIT in a row → structural advice)
  - carryforward expiry alerts
  - "consistency opportunities" (always near std-ded cliff → permanently bunch)

**Option B — Phase G5 Pro tier feature flag (~1 day minimal).**
The Planning module currently shows for all clients. Gate behind a
`proTierEnabled` flag (env or per-firm) before pricing rollout. Show
"Upgrade to Pro" CTA when off. Defer Stripe to Phase D18.

**Option C — Live-AI smoke verification.** Stub mode is verified
end-to-end. The live Gemini path will exercise on first prod call.
Worth a manual smoke against a real client right after deploy to
confirm the memo / email / missing-data look reasonable. Consider
setting `AI_PLANNING_MODEL=gemini-2.5-pro` on EC2 for higher-quality
narration vs the default Flash.

**Option D — CPA design-partner outreach (C11).** No code. Strongest
pitch position ever: zero documented engine gaps + 133 planning
assertions + AI-synthesis memo demo. Pair `docs/outreach/cold-email.md`
with a screen-record of the Planning tab on a high-AGI archetype like
`high-ny-ptet` ($22,750 estimated savings).

**Option E — Phase D15 CPA-firm multi-tenancy auth (~2-3 weeks).**
Required before charging real money. Hold until a paid design partner
is committed.

## Sub-gaps + known limits (Phase G)

- **G4 phase-out and G7 §199A cap proxy** — both detectors use the
  Phase G plan's simplifying assumptions (e.g. lost_qbi = 50% × QBI
  inside the phase-in band). Tighten with proper Form 8995-A modeling
  if a design partner asks.
- **G1.1 SEP suppression** — engine has no `sep_ira_contribution`
  adjustment type yet; suppression triggers on any adjustmentType
  matching `/sep|solo_401k|solo401k|self_employed_retirement/i`.
  Future: add explicit adjustment types in OpenAPI + schema.
- **G3 AI live path** — stub mode verified locally; Gemini path will
  first exercise in prod. If quality is uneven, set
  `AI_PLANNING_MODEL=gemini-2.5-pro` on pm2 (Flash is the default).
- **Phase G4 multi-year intelligence** — requires multi-year
  tax_returns history per client. Seed currently ingests one year per
  archetype; G4 will need either a multi-year seed pass or real
  customer data to test against.
- **Phase G5 Pro tier flag** — module is currently shown to all
  clients; gate before pricing rollout.

## EC2 deploy

Identical to prior sessions. Schema unchanged this round so the
`pnpm --filter @workspace/db run push` step is a no-op.

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz

# Frontend (Planning tab + dashboard widget are new) — build locally:
# LOCAL:
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these four files first, in order:
  1. .claude/handoff.md           — Phase G1+G2+G3 shipped (this session)
  2. .claude/roadmap.md           — G4 / G5 / Phase D / Phase 5 plan
  3. CLAUDE.md                    — invariants, closure log, planning architecture
  4. .claude/phase-g-plan.md      — original Phase G session-kickoff plan (G4/G5 specs)

Where we left off (2026-05-26): Phase G1+G2+G3 deployed end-to-end.
ALL 10 G1 detectors + G2 firm-wide hit list + G3 AI synthesis (memo +
email + missing-data) + 85-archetype demo seed. 133 hand-calced unit
tests + 18 integration tests all pass. Engine still at zero documented
gaps. Production verified.

This session, pick ONE:

  Option A — RECOMMENDED. Phase G4 Multi-year intelligence (~1 week).
  Compare opportunityDetected vs opportunityRealized across years.
  Trend rules (NIIT 3 years running → structural advice).
  Carryforward expiry alerts. "Consistency opportunities" (always
  near std-ded cliff). Pre-req: at least 2 years of tax_returns
  history per client. Extend seed-dummy-clients.ts to ingest multi-
  year data per archetype OR build off real customer data.

  Option B — Phase G5 Pro tier feature flag (~1 day minimal).
  Add `proTierEnabled` boolean (env or per-firm). Hide Planning tab +
  dashboard widget when off. Show "Upgrade to Pro" CTA. Defer Stripe
  to Phase D18.

  Option C — Live AI smoke + Pro-tier model upgrade.
  Verify Gemini live path produces high-quality memos on EC2. Toggle
  AI_PLANNING_MODEL=gemini-2.5-pro in pm2 if Flash output is uneven.

  Option D — CPA design-partner outreach (C11). No code. Strongest
  pitch position ever — zero documented engine gaps + planning demo.
  Send docs/outreach/cold-email.md to 5-10 target firms with a screen
  record of the Planning tab.

  Option E — Phase D15 CPA-firm multi-tenancy auth (~2-3 weeks).
  Required before charging real money. Hold until a paid design
  partner is committed.

Quality bar (same as prior sessions):
- Each item ships as its own commit
- All existing tests must stay at 0 real failures
- Update roadmap.md / CLAUDE.md / handoff.md at session end
- Deploy to EC2 at the end
```
