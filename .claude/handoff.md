# Handoff Note — 2026-05-26 (Phase G4 multi-year intelligence shipped)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## Headline

**Phase G4 — Multi-year tax-planning intelligence landed end-to-end.**
The planning module now detects patterns across multiple tax years
(persistent NIIT/AMT, std-ded-cliff bunching, stuck capital-loss
carryforward, growing passive-loss suspension) in addition to the 10
single-year G1 rules. With Phase G1+G2+G3+G4 all shipped, Phase G is
complete except for the G5 Pro-tier feature flag.

Engine still at zero documented gaps. CPA outreach pitch position is the
strongest it has ever been: 1,770+ hand-calc assertions, ZERO engine
gaps, complete planning module (15 detector rules total — 10 single-year
+ 5 multi-year), AI memo + email synthesis, 88-archetype demo seed
surfacing $145k+ in planning opportunities.

## What landed (session commits, in order)

| Commit | SHA       | Title |
|---|---|---|
| 1 | `e6ad3b5` | G4 catalog entries — 5 multi-year strategies (catalog v1.1.0) |
| 2 | `727222a` | planningEngineMultiYear.ts + 5 G4 detectors + 70 hand-calc unit tests |
| 3 | `a1d0225` | API endpoint /planning-multi-year + OpenAPI + 11 new integration assertions |
| 4 | `16287d5` | Planning tab "Multi-year trends" section + action-template fix |
| 5 | `2e9f863` | Multi-year seed extension + G4.3 cliff-detection bug fix + 3 G4 demo archetypes |

## Test state

- **70/70 G4 multi-year unit tests pass** (new this session).
- **29/29 planning integration tests pass** (was 18; +11 G4).
- **133/133 G1 unit tests pass** (unchanged).
- **210/210 deep-audit assertions pass** (unchanged).
- **97/97 accuracy-audit assertions pass** (unchanged).
- Workspace typecheck clean across all 12 workspaces (incl. regenerated
  api-zod + api-client-react after OpenAPI bump).
- **Engine net: ZERO documented gaps** (preserved from prior session).

## Architecture (5-layer planning module — now complete except G5)

1. **Catalog (Layer 1)** — `lib/planning-strategies/strategies-v1.json`
   v1.1.0, 15 strategies (10 G1 + 5 G4), validated at module load.
2. **Detector engine (Layer 2, deterministic)** — two sibling modules:
   - `planningEngine.ts` (G1 single-year)
   - `planningEngineMultiYear.ts` (G4 multi-year — new this session)
3. **Scoring (Layer 3, deterministic)** — `planningScore()` in
   planningEngine; weights single-year hits only at present.
4. **AI synthesis (Layer 4, LLM narration only — NEVER math)** —
   `planningMemo.ts` consumes the deterministic hits.
5. **Online intel refresh (Layer 5)** — NOT BUILT. Clean seam left.

## G4 detector specs (recap from the catalog)

| Rule | IRC | Trigger | Formula | Confidence |
|---|---|---|---|---|
| G4.1 | §1411 | NIIT > 0 in current AND ≥ 1 prior year | avg(niitTax) × 0.5 | 0.70 |
| G4.2 | §55-§59 | AMT > 0 in current AND ≥ 1 prior year | avg(amtTax) × 0.4 | 0.65 |
| G4.3 | §170; §63 | Sched A line items sum within ±15% of std-ded in current AND ≥ 1 prior year, charity > 0 currently | stdDed × 0.25 × marginal | 0.90 |
| G4.4 | §1211; §1212 | cap-loss carryforward > $20k AND not declining > $3,500/yr | min(cf, $20k) × marginal | 0.65 |
| G4.5 | §469 | suspended PAL > $5k AND grew YoY | growth × marginal × 0.5 | 0.60 |

## New endpoint

```
GET /api/clients/:id/planning-multi-year
  → { clientId, taxYear, catalogVersion, hits[], totalEstSavings,
      yearsAvailable, yearsCovered: number[] }
```

## Frontend changes

- **New "Multi-year trends" section on the Planning tab.** Indigo cards
  visually distinct from the emerald G1 cards. Shows year coverage in
  the section header.
- When `yearsAvailable < 2`, collapses to a short dashed-border hint:
  "Multi-year planning patterns activate once this client has at
  least 2 years of computed tax_returns history."

## Seed extension

`scripts/src/seed-dummy-clients.ts` now has a second pass after the main
archetype seed:

- For each archetype, mirrors its W-2/1099/K-1 records at TY+1 (TY2025
  by default) with ×1.05 amounts. Adjustments are shared across years
  (no per-year column).
- Runs POST /tax-return for both years to persist tax_returns snapshots
  so the G4 detector has history to read.
- Idempotent on year-2 ingestion; always re-runs the compute (cheap).
- Pass `--no-multi-year` to skip and seed single-year only.

3 dedicated demo archetypes added:
- `g4-bunching-mfj` — fires G4.3 ($1,650/yr)
- `g4-cap-loss-cf` — fires G4.4 ($4,400/yr)
- `g4-pal-growth-mfj` — fires G4.5 ($6,000/yr)

## Production-data verification (local DB)

After re-seeding: 88 seed clients, 11 fire G4 hits, **$145,499 total
estSavings on display**. Coverage across all 5 G4 rules:

| Rule | Fires on | Headline savings |
|---|---|---|
| G4.1 | 4 clients (incl. `edge-big-ltcg` — $93,575/yr) | $93k+ |
| G4.2 | 2 clients (incl. `high-amt-binding` — $17,107/yr) | $17k |
| G4.3 | 3 clients (g4-bunching demo + 2 organic) | $1.6k–$2.5k each |
| G4.4 | 1 client (g4-cap-loss-cf demo) | $4.4k |
| G4.5 | 1 client (g4-pal-growth-mfj demo) | $6k |

## Bug fix surfaced by exercising the seed

**G4.3 cliff detector was silently no-op'ing for std-ded filers.** The
detector originally read `TaxReturnSnapshot.itemizedDeductions`, which
the engine populates only when the filer actually itemized. For std-ded
filers — the very pattern G4.3 is designed to catch — the column is
null and the detector skipped them. Fixed by summing the per-line
Sched A columns (medical + salt + mortgage + charity) for the
"would-be itemized" total via a new `wouldBeItemizedTotal()` helper.
Required adding 3 new fields to `TaxReturnSnapshot` and updating the
route handler and the G4.3 unit tests to set the line items rather
than the chosen-itemized field. All 70 unit tests still pass; the
g4-bunching-mfj demo archetype now correctly fires G4.3 in the seed.

## Open items (next session priorities)

**Option A — Phase G5 Pro tier feature flag (~1 day, RECOMMENDED).**
The Planning tab + dashboard widget + new multi-year section are
currently shown to all clients. Add a `proTierEnabled` boolean (env
var or per-firm column after D15) and gate Phase G features behind it.
Show "Upgrade to Pro" CTA when off. Defer Stripe + billing to D18.
This is the last piece of Phase G as originally scoped — completing it
closes out Phase G entirely.

**Option B — CPA design-partner outreach (C11).** No code. Strongest
pitch position to date. Pair `docs/outreach/cold-email.md` with a
screen record of the Planning tab on a high-value archetype like
`edge-big-ltcg` (G4.1 $93k headline + other hits). Or send the seed-DB
to a partner for hands-on exploration.

**Option C — Phase D15 multi-tenancy auth (~2-3 weeks).** Required
before charging real money. Hold until a paid design partner is
committed. Wires `actorUserId` into `audit_log` (column already
exists, nullable).

**Option D — Live AI smoke verification.** Stub mode is verified. The
live Gemini path (planning memo + email + missing-data) has been
exercised in prior sessions; if quality is uneven on production, set
`AI_PLANNING_MODEL=gemini-2.5-pro` on EC2 pm2.

## Sub-gaps + known limits (Phase G4)

- **G4 detectors are pure** — no LLM, no I/O. All math hand-verified
  per IRC citation. The "would-be itemized" sum in G4.3 captures
  medical + salt + mortgage + charity but not the smaller Sched A
  lines (casualty losses, gambling losses, other itemized). Real
  clients with those line items will be slightly mis-estimated on
  the cliff check; acceptable for a detection heuristic.
- **G4.5 PAL growth** — adjustments are shared across tax years in
  the current schema. The seed extension's ×1.05 scaling applies only
  to W-2/1099/K-1 records, not adjustments. So PAL growth in the seed
  comes from the §469 carryforward synthesis (prior year's suspended
  PAL flows in as a "new" loss the next year) rather than from
  growing rental losses. Real customers' growing PAL is naturally
  captured.
- **G4 multi-year intelligence assumes engine-supported tax years.**
  The seed currently uses TY2024 + TY2025 (the two years with first-
  class engine constants). Extending to TY2023 history would require
  back-porting brackets / SEP / QBI thresholds to TY2023 in the
  engine.
- **G4 not yet behind a Pro-tier flag.** Same caveat as G1+G2+G3.

## EC2 deploy

Schema unchanged this round so `pnpm --filter @workspace/db run push`
is a no-op. The frontend tab + dashboard widget are unchanged from G3;
only the new MultiYearPlanningSection component requires a fresh build.

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

# Frontend — Multi-year trends section is new. Build locally + rsync:
# LOCAL:
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/

# (Optional) Re-run seed on prod to get multi-year demo data on EC2:
# Already ingested locally via the seed extension — production will
# need a re-run to ingest 2025 rows for the existing 85 archetypes.
# Run on the box (NOT against EC2 from local — see localhost-only DNS note):
#   pnpm --filter @workspace/scripts exec tsx ./src/seed-dummy-clients.ts
```

## Production verification (post-deploy)

```bash
curl http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com/api/healthz

# Pick a seed client ID from /api/clients and:
curl http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com/api/clients/<ID>/planning-multi-year
```

Expect `yearsAvailable: 1` initially (existing seeds are single-year);
re-run seed on the box to populate TY2025 snapshots and trigger G4 hits.

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these four files first, in order:
  1. .claude/handoff.md           — Phase G4 multi-year shipped (this session)
  2. .claude/roadmap.md           — G5 / Phase D / Phase 5 plan
  3. CLAUDE.md                    — invariants, closure log, planning architecture
  4. .claude/phase-g-plan.md      — original Phase G session-kickoff plan (G5 spec)

Where we left off (2026-05-26): Phase G4 deployed end-to-end. 5 multi-
year detectors (persistent NIIT/AMT, std-ded-cliff bunching, capital-loss
carryforward growth, passive-loss suspension growth). New endpoint
/planning-multi-year. Frontend "Multi-year trends" section on the
Planning tab. Seed extension produces 2 years per archetype + 3
dedicated G4 demo archetypes. 70 hand-calc unit + 11 new integration
assertions all pass. Engine still at zero documented gaps. Phase G is
now complete except for G5.

This session, pick ONE:

  Option A — RECOMMENDED. Phase G5 Pro tier feature flag (~1 day).
  Last piece of Phase G as originally scoped. Add `proTierEnabled`
  boolean (env var or per-firm column after D15). Hide Planning tab +
  dashboard widget + new multi-year section when off. Show "Upgrade
  to Pro" CTA. Defer Stripe to D18. Completes Phase G entirely.

  Option B — CPA design-partner outreach (C11). No code. Strongest
  pitch position ever — 15 detector rules + AI synthesis + 88-archetype
  demo + $145k+ surfaced savings + zero documented engine gaps.
  Send docs/outreach/cold-email.md with a screen record of the
  Planning tab on edge-big-ltcg ($93k headline G4.1 hit).

  Option C — Phase D15 CPA-firm multi-tenancy auth (~2-3 weeks).
  Required before charging real money. Hold until a paid design
  partner is committed.

  Option D — Live AI smoke + Pro-tier model upgrade. Verify Gemini
  live path produces high-quality memos on EC2 + planning-email +
  planning-missing-data. Toggle AI_PLANNING_MODEL=gemini-2.5-pro in
  pm2 if Flash output is uneven.

Quality bar (same as prior sessions):
- Each item ships as its own commit
- All existing tests must stay at 0 real failures
- Update roadmap.md / CLAUDE.md / handoff.md at session end
- Deploy to EC2 at the end
```
