# Handoff Note — 2026-05-27 (Phase H batch + H1 partial: 7 items shipped)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked.
The coverage map (per-state + per-feature) lives in
**`docs/coverage-matrix.md`** — read before planning state or federal
coverage work.

Open sections after this session:
- **A** — strategic / business (A1 outreach, A2 D15 auth, A3 D18 Stripe)
- **B** — Planning Strategy tool (Phase H1/H3/H5/H6/H8/H10 remaining;
  H2/H4/H7/H9/H11/H12 done)
- **C** — engine coverage push (C2 top-10-state credits, C3 design-partner
  validation, C9 PA local EIT, C10 OH school district, C11 per-state PY
  residency)
- **D** — infra / security hardening (TLS, S3, soft-delete, etc.)
- **E** — reactive / deferred (only when a customer asks)

Read `docs/todo.md` BEFORE picking a task.

## Headline

**Phase H batch (6 of 12 items: H2/H4/H7/H9/H11/H12) PLUS H1 partial
(4 of 50+ strategies: QCD / appreciated stock / Augusta Rule §280A(g) /
HSA max). Catalog v1.2. 5 feat commits + 2 docs commits. 155 hand-calc'd
H2 + new-detector assertions; 766 total green across 10 suites.**

Live-verified: seed SE client 5389 now triggers SEP ($2,897) + Augusta
($3,780) + Roth-cost ($4,078 long-term) + H7 cross-strategy showing
joint $5,417 vs sum-of-individual $6,677 — interaction effect -$1,260
captures the bracket-stacking erosion the simple sum overstates.

ZERO documented engine gaps; 4 prior C-batch sub-gaps still tracked.
Phase H remaining items (H3/H5/H6/H8/H10 + ~46 more H1 strategies) merit
their own sessions.

## What landed (commits in order)

| Commit | Item | Notes |
|---|---|---|
| `25ca6b8` | **Phase H — engine + H12 + H7** | 5 new H2 detector wirings (G1.5 AMT-ISO / G1.6 NIIT / G1.9 TLH / G1.10 FTC / G1.4 Roth). All 10 detectors gain `assumptions[]`. SEP/NIIT/Roth gain `whatIfSensitivity` (±10%). Type-system cleanup: `whatIfDelta` field replaced with unified `whatIf: { mutations, delta, semantics, sensitivity? }`. WhatIfMutation strict union widened to OpenAPI-wire shape. New `evaluateCrossStrategyScenario` for H7 + `crossStrategy` field on /planning-opportunities. planningMemo.ts: extended client snapshot + H9 personalization rules in system prompt. taxReturnEngine ClientFacts gains 4 H9 optional fields. 124 hand-calc assertions (Cases 1-20 + D1-D9). |
| `49c892d` | **Phase H — H4 + H11 + H9 schema** | POST /clients/:id/state-comparison: runs engine per target state, re-sources W-2/1099 stateCode (without this, CA wages stay CA-sourced even when client "moves" to TX). GET /clients/:id/peer-benchmark: ±$50k AGI band cohort + percentile rank via linear-interp quantiles + graceful 0-peer fallback. db schema: clients table gains risk_tolerance, target_retirement_age, estate_plan_stage, planning_goals. |
| `f0fc164` | **Phase H — frontend** | Three new Planning cards: CrossStrategyCard (indigo, H7), StateResidencyComparisonCard (cyan, H4), PeerBenchmarkCard (purple, H11). Hit-card refactor: headline uses `\|combinedRefundDelta\|` for savings; for cost-semantics (Roth), shows heuristic estSavings + amber "current-year cost" panel. Sensitivity range line ("Range: $low – $high"). Assumptions <details> section. "Engine simulated: ..." transparency line. ClientForm.tsx H9 Planning context block with 4 fields. Live-verified: SE client H2 + sensitivity + assumptions render correctly; CA client H4 returns -$55,782 across all targets; H11 cohort + percentile render; H9 fields persist. |
| `cacd7b1` | **Phase H — docs close-out (batch 1)** | docs/todo.md, CLAUDE.md, .claude/handoff.md refreshed for the H2/H4/H7/H9/H11/H12 batch. |
| `0bcd753` | **Phase H — H1 expansion (catalog v1.2)** | 4 new strategies: G1.11 QCD (age 71+, IRA + charity), G1.12 appreciated stock donation (heuristic — H5 deferred), G1.13 Augusta Rule §280A(g) (SE > $50k), G1.14 HSA maximization (HDHP + cap room). 31 new hand-calc'd assertions (Cases D10-D17 incl age-gating, MFS cap, suppression edge cases). Live-verified: client 5389 fires SEP + Augusta + Roth with H7 cross-strategy showing -$1,260 bracket-stacking erosion. |
| `(this commit)` | **Phase H — docs close-out (batch 2)** | todo/CLAUDE/handoff updated for the H1 partial expansion. |

## Test state (final)

**ALL SUITES GREEN.** 124 H2/H7 assertions + all prior suites unchanged.

| Suite | Result | Notes |
|---|---|---|
| tax-engine-tests | 193/193 | |
| tax-engine-deep-tests | 37/37 | |
| tax-engine-planning-tests | 133/133 | |
| tax-engine-planning-multi-year-tests | 70/70 | |
| tax-engine-form1040x-tests | 45/45 | |
| **tax-engine-whatif-tests** | 155/155 | Phase H + H1 partial (4 new detectors) |
| tax-engine-form4868-tests | 40/40 | |
| tax-engine-section1031-tests | 30/30 | |
| tax-engine-espp-iso-tests | 27/27 | |
| tax-engine-section163j-461l-tests | 36/36 | |
| (other pure + integration suites) | (✓ no regressions) | |

## Schema changes pushed to local DB (need EC2 push too)

| Table | New columns |
|---|---|
| `clients` | H9: `risk_tolerance` (text), `target_retirement_age` (integer), `estate_plan_stage` (text), `planning_goals` (text) |

OpenAPI schema additions (auto-regenerated to api-zod + api-client-react):
- `OpportunityHit.assumptions: string[]?`
- `OpportunityHit.whatIf: { mutations, delta, semantics, sensitivity? }?`
  (replaces old `whatIfDelta`)
- `OpportunityWhatIf`, `WhatIfSensitivity` schemas
- `PlanningOpportunities.crossStrategy: CrossStrategySummary?`
- `CrossStrategySummary` schema
- `Client.riskTolerance / targetRetirementAge / estatePlanStage / planningGoals`
- `CreateClientBody` + `UpdateClientBody` same 4 fields
- New paths: `POST /clients/{id}/state-comparison`, `GET /clients/{id}/peer-benchmark`
- New body/response schemas for both

## Deploy steps (for the user)

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')

# REQUIRED — H9 added 4 columns to clients:
pnpm --filter @workspace/db run push

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

Verify by clicking through clients at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com:
1. Open the Planning tab on a self-employed client → SEP card should show
   the H2 verified delta with sensitivity range + assumptions section.
2. Same client → click "Compare states" on the State residency card →
   table should populate with target states.
3. Peer benchmark card should auto-load with percentile rank.
4. Edit Client → scroll to the indigo "Planning context (Phase H — H9)"
   section → 4 fields render.

## Sub-gaps surfaced this session

1. **H7 cross-strategy only fires when ≥2 H2-savings hits present.** Most
   seed clients trigger 0-1 (SEP only). The H7 endpoint code is correct;
   it just needs H1 catalog expansion to make multi-hit scenarios common.
2. **H4 sub-gaps:** Engine mutates resident state + W-2/1099 stateCode
   but NOT income sourcing per state-specific rules (NY IT-203 / CA 540NR
   Sched CA). Real moves require multi-state allocation; the H4 result is
   a "back-of-envelope" estimate. Domicile rules (driver's license,
   days-present test) are CPA's responsibility; not modeled. Cost of
   living / property tax / sales tax burden in new state not modeled.
3. **G1.7 §199A QBI wage limit** still heuristic-only — engine doesn't
   model the Form 8995-A wage/UBIA cap formula. Documented as engine
   sub-gap in the detector's assumptions list.
4. **The 4 prior C-batch sub-gaps remain open**: §163(j) ATI proxy,
   §461(l) auto-aggregation, §1031/§121 NIIT routing, Form 8824/8990
   PDFs.

## What's left (post-Phase H batch + H1 partial — strongest candidates)

1. **H1 continued (~6 weeks remaining, 4 of 50+ done)** — H2/H7/H12
   foundation proven; each ~2-4 hrs w/ H2 wiring. Suggested next batch
   (~1 day each): NUA (employer stock in 401(k) LTCG-vs-ordinary play),
   Mega-Backdoor Roth, S-corp reasonable comp, REPS election. After
   those: defined benefit / cash balance, cost segregation, opportunity
   zones, NQDC §409A, CRT/CLT, §1374 BIG, §338(h)(10), conservation
   easements.
2. **H3 multi-year scenario modeling (1-2 wks)** — completes H2 promise
   for G1.3 bunching / G1.4 Roth long-term / G1.8 DAF. Needs YoY
   projection + bracket-indexing model (auto-extend TY2026/2027 from
   TY2025 at 3%).
3. **CPA outreach (A1)** — packet still complete; blocked on user
   availability.
4. **H5 asset balance tracking (2-3 wks)** — unlocks RMD/NUA/mega-Roth/
   Roth-sizing detectors + G1.12 appreciated-stock H2 verification.
5. **D15 multi-tenancy auth (2-3 wks)** — gate to paid customers.

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. docs/todo.md                 — THE LIVE TODO (read this first)
  2. docs/coverage-matrix.md      — Per-state + per-feature inventory
  3. .claude/handoff.md           — Last session state (Phase H batch shipped)
  4. .claude/roadmap.md           — Long-arc Phase A-G plan
  5. CLAUDE.md                    — invariants, closure log

Where we left off (2026-05-27): Phase H batch + H1 partial shipped —
6 of 12 Phase H items (H2 expansion / H4 / H7 / H9 / H11 / H12) PLUS
4 of 50+ H1 strategies (G1.11 QCD / G1.12 appreciated stock / G1.13
Augusta Rule / G1.14 HSA max). Catalog v1.2. 5 feat commits + 2 docs
pushed and deployed live. 155 H2 + new-detector hand-calc'd assertions.
Live-verified H7 cross-strategy: client 5389 SEP+Augusta saves $5,417
joint vs $6,677 sum (interaction -$1,260 bracket-stacking erosion).
ZERO documented engine gaps.

Top recommendation: **H1 continued** — 4-5 more strategies at ~2-4 hrs
each w/ H2 wiring proven. Suggested batch: NUA (employer-stock LTCG
vs ordinary), Mega-Backdoor Roth, S-corp reasonable comp, REPS
election. Alternative: **H3 multi-year scenario modeling** (1-2 wks)
to complete H2 coverage for G1.3 bunching / G1.4 Roth long-term /
G1.8 DAF.

Sub-recommendations: A1 (CPA outreach, awaits user availability),
H5 (asset balance tracking), D15 (multi-tenancy auth).

Quality bar:
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update docs/todo.md / docs/coverage-matrix.md / .claude/handoff.md /
  CLAUDE.md at session end
- Deploy to EC2 at the end (git pull + db push if schema changed +
  pm2 restart on EC2 + local pnpm build + rsync)
```
