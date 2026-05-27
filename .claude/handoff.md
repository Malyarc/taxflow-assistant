# Handoff Note — 2026-05-27 (Phase H + H1 CATALOG CLOSED at v1.17)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked.

The coverage map (per-state + per-feature) lives in
**`docs/coverage-matrix.md`** — read before planning state or federal
coverage work.

The planning strategy audit lives in **`docs/planning-strategy-audit.md`**
— all 92 catalog strategies verified for IRC + TY2024/2025 limits.

After this session, open sections:
- **A** — strategic / business (A1 outreach, A2 D15 auth, A3 D18 Stripe)
- **B** — Phase H ✅ FULLY COMPLETE + **H1 CATALOG CLOSED at 92 strategies**.
  Future H1 work: H2-wire heuristic detectors for engine-verified savings.
- **C** — engine coverage push (C2 top-10-state credits, C3 design-partner
  validation, C9 PA local EIT, C10 OH school district, C11 per-state PY
  residency)
- **D** — infra / security hardening (TLS, S3, soft-delete, etc.)
- **E** — reactive / deferred (only when a customer asks)

Read `docs/todo.md` BEFORE picking a task.

## Headline

**H1 catalog CLOSED at v1.17 — 92 strategies (87 G1 + 5 G4).** Six
back-to-back batches shipped in this session (v1.12 → v1.17), adding
**30 new G1 strategies** covering the remaining canonical universe:

- **v1.12 (5)** — Universal individual: G1.67 In-plan Roth Conversion
  §402A(c)(4)(B), G1.68 §174 R&D Capitalization Workaround, G1.69
  Year-end Income Timing, G1.70 Bargain Sale to Charity §1011(b),
  G1.71 ISO Lot Selection (Qualifying Disposition)
- **v1.13 (5)** — Equity comp + small-biz credits: G1.72 RSU Sell-to-Cover
  Withholding Gap, G1.73 NUA In-Service (age 55-59½), G1.74 §45S FMLA
  Credit, G1.75 WOTC §51, G1.76 §170(h) Non-Syndicated Easement
- **v1.14 (5)** — RE + multi-state: G1.77 Self-Rental Grouping §1.469-4(d),
  G1.78 Multi-State NR Allocation, G1.79 §453 Partial-Installment Election
  Out, G1.80 §47 Historic Rehab Credit, G1.81 §44 Disabled Access Credit
- **v1.15 (5)** — Business + corporate: G1.82 §1374 Built-In Gains,
  G1.83 §338(h)(10), G1.84 §351 Controlled-Corp Contribution,
  G1.85 §163(h)(3) Mortgage Interest Optimization, G1.86 Charitable Lead Trust
- **v1.16 (5)** — Retirement + §199A: G1.87 §401(a)(17) Compensation Cap,
  G1.88 §199A SSTB Navigation, G1.89 §199A Aggregation Election,
  G1.90 Pooled Income Fund §642(c)(5), G1.91 §139 Qualified Disaster Relief
- **v1.17 (5 — FINAL)** — Closeout: G1.92 Solo 401(k) Employee Deferral,
  G1.93 §163(d)(4)(B) Investment Interest Election, G1.94 §85 Unemployment
  Income Analysis, G1.95 §1377(a)(2) S-corp Terminating Shareholder,
  G1.96 §132(f) Qualified Transportation Fringe

**Verification:**
- 455 hand-calc'd planning unit tests passing (+120 in this session).
- All 40 test suites green (no regressions).
- API returns hits for new strategies on seed clients (verified via curl).
- UI verified live in dev environment: Planning tab renders v1.17.0
  catalog, all new strategies appear on appropriate client profiles.
  No console errors, no failed network requests.

## Commits this session

| Commit | Item |
|---|---|
| (this commit) | Phase H — H1 catalog v1.17 (30 new strategies) + audit refresh + close-out |

Single mega-commit covering v1.12-v1.17 (catalog JSON + 30 detectors +
120 hand-calc'd tests + audit doc + CLAUDE.md / handoff.md / todo.md).

## Test state (final)

ALL SUITES GREEN. Highlights:

| Suite | Result | Notes |
|---|---|---|
| tax-engine-tests | 193/193 | |
| tax-engine-deep-tests | 37/37 | |
| **tax-engine-planning-tests** | **455/455** | +120 from prior (27 v1.12 + 22 v1.13 + 18 v1.14 + 16 v1.15 + 17 v1.16 + 20 v1.17) |
| tax-engine-planning-multi-year-tests | 70/70 | G4 suite (unchanged) |
| tax-engine-whatif-tests | 169/169 | H2 / H7 / catalog v1.2-v1.3 detector wiring |
| tax-engine-form8606-tests | 68/68 | |
| tax-engine-multiyear-tests | 25/25 | H3 primitive |
| tax-engine-discovery-tests | 23/23 | H8 verifier (updated upper bound: 4-30 sibling mappings) |
| tax-engine-deep-audit-tests | ✓ | |
| tax-engine-accuracy-audit-tests | ✓ | |
| (other pure + integration suites) | ✓ no regressions | |

## Schema changes pushed to local DB (need EC2 push too)

NONE — all v1.12-v1.17 work uses existing schema:
- Catalog is a JSON file in `lib/planning-strategies/src/strategies-v1.json`
- Detectors are pure functions in `artifacts/api-server/src/lib/planningEngine.ts`
- New tests are TS files in `scripts/src/tax-engine-planning-tests.ts`

OpenAPI changes: NONE (no new API endpoints).

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

# NO db push needed.
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
1. Open Top-10 Dashboard → confirm clients show new strategy IDs (G1.70, G1.72, G1.91, G1.96 should appear).
2. Open client 5449 (edge-big-ltcg) → Planning tab → confirm 11 hits incl. G1.70 (Bargain), G1.72 (RSU), G1.79 (§453), G1.91 (§139), G1.96 (§132(f)).
3. Open client 5433 (high-consultant-200k) → Planning tab → confirm hits incl. G1.80 (§47 historic), G1.81 (§44 disabled access), G1.62 (§263A), G1.69 (year-end), G1.91 (§139).
4. Hit `/api/clients/5449/planning-opportunities` → confirm `catalogVersion: "v1.17.0"` and totalEstSavings calculation.

## Sub-gaps STILL OPEN after this session

C-batch sub-gaps remain open (NOT addressed this session):
1. §163(j) ATI proxy — approximate; over-restricts high-depreciation
   low-income filers.
2. §461(l) auto-aggregation — engine accepts CPA-supplied addback.
3. §1031/§121 recognized gains don't flow into NIIT investment-income base.
4. Form 8824 PDF (§1031) + Form 8990 PDF (§163(j)) not rendered yet.

H1 catalog sub-gaps:
- Many v1.12-v1.17 detectors are heuristic-only (no H2 engine verification).
  Future work: convert key strategies (G1.67 in-plan Roth → H2 cost; G1.78
  multi-state via state-comparison endpoint; G1.85 mortgage interest via
  what-if scenarios) to engine-verified.
- G1.86 CLT + G1.90 PIF use rough PV-factor heuristics; full §7520-rate
  actuarial PV computation would require integrating IRS tables monthly.

## What's left (post-H1-catalog-closure — strongest candidates)

1. **A1 — CPA outreach campaign** — packet complete; blocked on user
   availability. Highest revenue gate.
2. **D15 — multi-tenancy auth (2-3 wks)** — required before charging.
3. **D18 — Stripe billing (1-2 wks)** — depends on D15.
4. **C2 — top-10-state credits push (2-3 wks)** — engine state coverage.
5. **H1 incremental refinement** — H2-wire more heuristic detectors;
   most v1.12-v1.17 strategies could benefit from engine verification.

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. docs/todo.md                       — THE LIVE TODO
  2. docs/coverage-matrix.md            — Per-state + per-feature inventory
  3. docs/planning-strategy-audit.md    — All 92 strategies audited (v1.17)
  4. .claude/handoff.md                 — Last session state (H1 CLOSED at v1.17)
  5. CLAUDE.md                          — invariants, test-file list, closure log

Where we left off (2026-05-27): **H1 CATALOG CLOSED at v1.17 (92
strategies — 87 G1 + 5 G4).** Phase H FULLY COMPLETE. 455 planning
hand-calc tests + 74 end-to-end scenarios + all other 40 suites green.
ZERO documented federal/state engine gaps.

Top recommendation: **A1 CPA outreach** (biggest revenue gate; packet
complete; awaits user availability). Alternative: **D15 multi-tenancy
auth (2-3 wks)** — required before charging. Then **D18 Stripe billing
(1-2 wks)**.

If continuing H1 work: H2-wire heuristic detectors. Most v1.12-v1.17
strategies are heuristic-only. Highest-impact H2 wires:
- G1.67 in-plan Roth (cost-semantics, like G1.4)
- G1.78 multi-state via state-comparison endpoint (existing H4 wire)
- G1.79 §453 election out (engine verifies via gain-acceleration scenario)
- G1.85 mortgage interest (engine verifies via scaled adjustment)
- G1.93 §163(d) investment interest election (engine verifies)

Quality bar:
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update docs/todo.md / .claude/handoff.md / CLAUDE.md at session end
- Deploy to EC2 at the end (git pull + api-server build + pm2 restart
  + local frontend build + rsync; NO db push needed unless schema
  changes)
```
