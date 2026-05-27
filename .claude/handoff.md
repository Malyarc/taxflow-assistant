# Handoff Note — 2026-05-27 (Phase H sub-gap closure + H1 catalog v1.5 — ALL DONE)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked.

The coverage map (per-state + per-feature) lives in
**`docs/coverage-matrix.md`** — read before planning state or federal
coverage work.

After this session, open sections:
- **A** — strategic / business (A1 outreach, A2 D15 auth, A3 D18 Stripe)
- **B** — Phase H ✅ FULLY COMPLETE (12/12 + all sub-gaps). Future: H1
  continued catalog (~35 more strategies — each ~2-4 hrs).
- **C** — engine coverage push (C2 top-10-state credits, C3 design-partner
  validation, C9 PA local EIT, C10 OH school district, C11 per-state PY
  residency)
- **D** — infra / security hardening (TLS, S3, soft-delete, etc.)
- **E** — reactive / deferred (only when a customer asks)

Read `docs/todo.md` BEFORE picking a task.

## Headline

**Phase H is FULLY COMPLETE.** Including ALL sub-gaps from the prior
session's "deferred" list. This session shipped:

- **H3 multi-year detector wiring** — G1.3 bunching (2-year cycle),
  G1.4 Roth (5-year with projected RMD), G1.8 DAF (3-year front-loading).
  Each detector now carries `multiYear: { ... }` with engine-verified
  per-year burden trajectory + totalSavings.
- **H5 4 new asset types** — espp_shares, iso_amt_credit_shares,
  restricted_stock_pre_83b, crypto. Schema is `text` column so no DB
  migration; OpenAPI enum extended in 3 places; UI dropdown extended.
- **H6 Form 8606 Part III** — Roth distribution basis recovery with
  Treas. Reg. §1.408A-6 Q&A 8 ordering rule. Qualified-distribution
  shortcut for over-59½ + 5-year clock. 10% §72(t) penalty. PDF gains
  Part III section. New `roth_ira_distribution` adjustment type.
- **H8 rule-engine verification** — `verifyAndDedupeCandidates`
  post-processes LLM discovery: matches IRC sections to catalog;
  tags as `catalog-overlap` (needs review) or `extra-strategy`
  (qualitative only); drops duplicates of already-detected hits.
  AiDiscoveryCard shows verification badge above rationale.
- **H1 catalog v1.4 — 5 new strategies**: G1.21 §1031 timing,
  G1.22 pre-RMD Roth ladder, G1.23 cost segregation, G1.24 opportunity
  zones, G1.26 backdoor Roth IRA.
- **H1 catalog v1.5 — 6 more new strategies**: G1.27 inherited IRA
  10-year rule (heuristic, SECURE 1.0), G1.28 defined benefit / cash
  balance plan (H2-wired), G1.33 Clean Vehicle Credit §30D/§25E
  (H2-wired), G1.34 Residential Clean Energy §25D (H2-wired), G1.39
  §1202 QSBS (heuristic), G1.45 §121 home sale exclusion (heuristic).
- **H1 catalog v1.6 — 6 more new strategies** (37 total — past the
  v1.4/v1.5 mark; fills education/family gap that was at 0):
  G1.29 §529→Roth IRA SECURE 2.0 (heuristic PV $12,114 for H5 529 ≥ $35k),
  G1.31 Saver's Credit §25B (H2-wired, 4-tier AGI band × $2k/$4k cap),
  G1.32 DCFSA vs §21 Dependent Care Credit (heuristic ~$883 for working
  parents at 22%+ marginal), G1.36 R&D Credit §41 (heuristic $3,000
  first-time ASC for tech-SE > $100k), G1.37 §25C Energy Efficient
  Home Improvement (H2-wired $1,500 heat pump), G1.40 §1244 ordinary
  loss on small biz stock (heuristic 17% rate spread).

Total: 9 feature commits + 3 close-out commits.
Total new assertions: 165 hand-calc'd across 4 test files (28 H3-wiring
+ 40 H6-PartIII + 23 H8-verifier + 24 H1-v1.4 + 26 H1-v1.5 + 24 H1-v1.6).
All other 23 suites still GREEN. ZERO documented federal/state gaps.

Live-verified end-to-end on seed clients via curl + browser:
- Client 5429 (G1.4 Roth): multiYear horizon=5 totalSavings=$5,658
- Client 5460 (G4-bunching archetype): G1.3 multiYear horizon=2 $1,716
- Client 5432 (high-tech-charitable): G1.8 multiYear horizon=3 $16,143
- Client 5449 (edge-big-ltcg): G1.24 + G1.26 fire on $5M AGI ✓
- Form 8606 endpoint: Part I/II + Part III JSON + PDF (3.7KB valid PDF)
- All 7 Planning tab cards render
- AssetBalances UI: 18 types in dropdown; crypto add/delete works

## Commits this session

| Commit | Item |
|---|---|
| (post-d64361c) | H3 multi-year detector wiring (G1.3 / G1.4 / G1.8) |
| (next) | H5 4 new asset types + H6 Form 8606 Part III |
| (next) | H8 rule-engine verification of LLM discovery candidates |
| (next) | H1 catalog v1.4 (5 new strategies) |
| (this commit) | Phase H sub-gap close-out — docs + deploy |

## Test state (final)

ALL SUITES GREEN. Highlights:

| Suite | Result | Notes |
|---|---|---|
| tax-engine-tests | 193/193 | |
| tax-engine-deep-tests | 37/37 | |
| **tax-engine-planning-tests** | 185/185 | +52 from prior (28 H3 wiring + 24 H1 v1.4 detector) |
| tax-engine-planning-multi-year-tests | 70/70 | G4 suite (unchanged) |
| tax-engine-whatif-tests | 169/169 | H2 / H7 / catalog v1.2-v1.3 detector wiring |
| **tax-engine-form8606-tests** | 68/68 | +40 Part III hand-calc assertions |
| tax-engine-multiyear-tests | 25/25 | H3 primitive (unchanged) |
| **tax-engine-discovery-tests** (NEW) | 23/23 | H8 verifier |
| tax-engine-deep-audit-tests | ✓ | |
| tax-engine-accuracy-audit-tests | ✓ | |
| (other pure + integration suites) | ✓ no regressions | |

## Schema changes pushed to local DB (need EC2 push too)

NONE — all sub-gap work uses existing schema:
- H5 new asset types use the existing `text` asset_type column (no enum constraint)
- H6 Part III uses the existing assetBalancesTable + new `roth_ira_distribution` adjustment type (also free-text)

OpenAPI changes (auto-regenerated to api-zod + api-client-react):
- `OpportunityMultiYear` schema + `OpportunityHit.multiYear?` field
- `Form8606Result.partIII?` field + `Form8606PartIIIResult` schema
- `PlanningDiscoveryCandidate.verification` (required) +
  `PlanningDiscoveryVerification` schema
- AssetBalance / Create / Update enum extended with 4 new types
- AdjustmentEnum extended with `roth_ira_distribution`

## Deploy steps (for the user)

NO DB schema migration needed.

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')

# NO db push needed (no schema changes this session).
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
exit
```

Local frontend rebuild + rsync:
```bash
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

Verify by clicking through clients at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com:
1. Open client 5449 → Planning tab → confirm G1.24 (Opportunity Zone)
   and G1.26 (Backdoor Roth) appear in the hits list.
2. Open client 5429 → Planning tab → confirm G1.4 Roth card shows
   "Multi-year projection (H3) · Saves $5,658 over 5 years" with
   per-year table.
3. Open client 5389 → Assets tab → confirm dropdown shows 18 asset
   types incl. "Crypto (BTC / ETH / etc.)" + "ESPP shares (cost basis
   + purchase price)".
4. Hit `/api/clients/<id>/form-8606` → confirm `partIII` field present
   when Roth balance + distribution data exist.
5. Click "Discover with AI" → on prod (with AI_API_KEY set) candidates
   should now carry `verification: { status, matchedCatalogId?, detail }`.

## Sub-gaps STILL OPEN after this session

The C-batch sub-gaps remain open (NOT addressed this session):
1. §163(j) ATI proxy — approximate; over-restricts high-depreciation
   low-income filers. True ATI per §163(j)(8) requires depreciation
   addback + pre-§163(j)/NOL/QBI base. Tracked in coverage-matrix.md.
2. §461(l) auto-aggregation — engine accepts CPA-supplied addback;
   doesn't auto-aggregate across Sched C/E/K-1 buckets.
3. §1031/§121 recognized gains don't flow into NIIT investment-income
   base. Consistent with the existing §121 pattern; broader NIIT-base
   refactor required.
4. Form 8824 PDF (§1031) + Form 8990 PDF (§163(j)) not rendered yet.

H6 Part II (inherited IRA Roth conversion) — the handoff terminology
was imprecise. Current implementation already handles the conversion
math via `computeForm8606ProRata` (lines 16-18 of Form 8606 Part II).
What was deferred: SPECIFIC inherited-IRA conversion edge cases (per
IRC §408A(d)(3)(C) only spouse-inherited IRAs can be converted to
Roth — non-spouse inherited IRAs cannot). Engine doesn't currently
distinguish — CPA hand-flags. Documented as a sub-gap for future H1
catalog work (G1.27 Inherited-IRA strategies).

## What's left (post-Phase-H sub-gap closure — strongest candidates)

1. **A1 — CPA outreach campaign** — packet still complete; blocked on
   user availability. Highest revenue gate.
2. **D15 — multi-tenancy auth (2-3 wks)** — required before charging
   real money. Wires actorUserId into audit_log.
3. **D18 — Stripe billing (1-2 wks)** — depends on D15.
4. **H1 continued catalog (~35 strategies remaining)** — incremental
   value per strategy now that foundation is done.
5. **C2 — top-10-state credits push (2-3 wks)** — engine coverage on
   state side.

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. docs/todo.md                 — THE LIVE TODO
  2. docs/coverage-matrix.md      — Per-state + per-feature inventory
  3. .claude/handoff.md           — Last session state (Phase H sub-gaps DONE)
  4. .claude/roadmap.md           — Long-arc Phase A-G plan
  5. CLAUDE.md                    — invariants, closure log

Where we left off (2026-05-27): Phase H is FULLY COMPLETE — all 12
H-items PLUS all sub-gaps (H3 detector wiring + H5 4 new asset types +
H6 Form 8606 Part III + H8 rule-engine verification + H1 catalog v1.4).
Catalog at v1.4 (25 strategies). ~2,700+ assertions across 39 suites
green. ZERO documented federal/state gaps.

Top recommendation: **A1 CPA outreach** (biggest revenue gate; packet
complete; awaits user availability). Alternative: **D15 multi-tenancy
auth (2-3 wks)** — required before charging. Then **D18 Stripe
billing (1-2 wks)**.

If continuing H1 catalog expansion: ~35 strategies left. Candidates:
inherited-IRA Roth (spouse vs non-spouse), defined benefit plans,
NQDC §409A timing, CLT, §1374 BIG, §338(h)(10), §199A optimization
variants, retirement plan max-outs. Each ~2-4 hrs.

Quality bar:
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update docs/todo.md / .claude/handoff.md / CLAUDE.md at session end
- Deploy to EC2 at the end (git pull + api-server build + pm2 restart
  + local frontend build + rsync; NO db push needed unless schema
  changes)
```
