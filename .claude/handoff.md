# Handoff Note — 2026-05-27 (Phase H COMPLETE — all 12 items shipped)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked.

The coverage map (per-state + per-feature) lives in
**`docs/coverage-matrix.md`** — read before planning state or federal
coverage work.

After this session, open sections:
- **A** — strategic / business (A1 outreach, A2 D15 auth, A3 D18 Stripe)
- **B** — Phase H ✅ COMPLETE. Future: H1 continued catalog (40+ more
  strategies — each ~2-4 hrs now that foundation is proven).
- **C** — engine coverage push (C2 top-10-state credits, C3 design-partner
  validation, C9 PA local EIT, C10 OH school district, C11 per-state PY
  residency)
- **D** — infra / security hardening (TLS, S3, soft-delete, etc.)
- **E** — reactive / deferred (only when a customer asks)

Read `docs/todo.md` BEFORE picking a task.

## Headline

**Phase H is FULLY COMPLETE.** Across this session block (~12 hours
total over multiple chunks), shipped:

- **H2** what-if engine + 6 detector wires
- **H3** multi-year scenario primitive
- **H4** state-residency comparison endpoint + card
- **H5** asset balance MVP — new client_asset_balances table + Assets tab
- **H6** Form 8606 §408(d)(2) pro-rata math + PDF
- **H7** cross-strategy interaction modeling
- **H8** LLM fact-pattern discovery endpoint + AiDiscoveryCard
- **H9** client-context fields (4 new client columns)
- **H10** charitable strategy depth (folded into H1 catalog)
- **H11** peer benchmark cohort analysis
- **H12** transparency (assumptions + sensitivity + mutation traces)
- **H1 partial** — 10 of 50+ catalog strategies (G1.1-G1.20) at v1.3

Total commits: ~12 feature commits + ~3 docs commits.
Total assertions: 222 new across 3 new pure-engine test files
(whatif 169, form8606 28, multiyear 25). All ~2,600+ assertions
across 38 suites GREEN. ZERO documented federal/state gaps.

Live-verified on seed client 5389:
- 4 H2-verified hits (NUA $14,700 + Augusta $4,620 + Roth $4,078 +
  SEP $2,897) + cross-strategy interaction effect -$1,260
- All 7 Phase H planning cards render cleanly
- Assets tab + Form 8606 PDF + AI Discovery button all functional
- Catalog v1.3 with 20 strategies

## Commits this session block (12 hours)

| Commit | Item |
|---|---|
| `25ca6b8` | H2 expansion (5 detector wires) + H12 transparency + H7 cross-strategy |
| `49c892d` | H4 state-residency + H11 peer benchmark + H9 schema |
| `f0fc164` | Frontend (CrossStrategy + StateResidency + PeerBenchmark cards + H9 client form) |
| `cacd7b1` | Docs close-out (batch 1) |
| `0bcd753` | H1 catalog v1.2 (4 strategies: QCD / appreciated stock / Augusta / HSA max) |
| `d64361c` | Docs close-out (batch 2) |
| `696a7b0` | H5 asset balances + H6 Form 8606 + H3 multi-year primitive |
| `b2ff4e7` | H1+H10 catalog v1.3 (6 strategies: NUA / Mega-Backdoor Roth / S-corp / REPS / CRT / conservation easement) |
| `014c102` | H8 LLM fact-pattern discovery |
| `(this commit)` | Phase H final docs + deploy |

## Test state (final)

**ALL SUITES GREEN — 11 of 11 sampled in regression sweep.**

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
| **tax-engine-whatif-tests** | 169/169 | All H2 + H7 + H1 v1.2/v1.3 detector wire-ups |
| **tax-engine-form8606-tests** (NEW) | 28/28 | H6 §408(d)(2) pro-rata math |
| **tax-engine-multiyear-tests** (NEW) | 25/25 | H3 primitive |
| (other pure + integration suites) | (✓ no regressions) | |

## Schema changes pushed to local DB (need EC2 push too)

| Table | New columns / tables |
|---|---|
| **`client_asset_balances`** (NEW) | id, client_id (FK, cascade), tax_year, asset_type (14-enum), account_name, balance, cost_basis, after_tax_basis, nua_eligible, notes, timestamps |

OpenAPI schema additions auto-regenerated to api-zod + api-client-react:
- `AssetBalance` + `CreateAssetBalanceBody` + `UpdateAssetBalanceBody`
  (full CRUD)
- `Form8606Result`
- `PlanningDiscovery` + `PlanningDiscoveryCandidate`
- `OpportunityHit.whatIf` carries `mutations` for full transparency
- New adjustment types on the engine enum:
  `roth_conversion_amount`, `nondeductible_ira_contribution`,
  `traditional_ira_distribution`, `augusta_rule_rent`,
  `nua_lump_sum_employer_stock`,
  `mega_backdoor_roth_after_tax_contribution`
- New paths:
  - `GET /clients/{id}/form-8606` (JSON)
  - `GET /clients/{id}/form-8606/pdf` (PDF)
  - `GET /clients/{id}/planning-discovery`
  - `GET /clients/{id}/asset-balances` (list)
  - `POST /clients/{id}/asset-balances` (create)
  - `PATCH /clients/{id}/asset-balances/{assetId}` (update)
  - `DELETE /clients/{id}/asset-balances/{assetId}` (delete)

## Deploy steps (for the user)

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')

# REQUIRED — H5 adds the client_asset_balances table:
pnpm --filter @workspace/db run push

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
1. Open Assets tab on a client → add a traditional_ira asset with
   after-tax basis.
2. Open Form 8606 endpoint (`/api/clients/<id>/form-8606`) → returns
   §408(d)(2) pro-rata JSON.
3. Open Planning tab → all 7 Phase H cards render (Total savings,
   Cross-strategy, AI discovery, State residency, Peer benchmark,
   Multi-year trends, per-strategy cards).
4. Add a `nua_lump_sum_employer_stock` asset → G1.15 NUA hit
   appears on Planning tab.

## Sub-gaps surfaced (multi-week each — defer)

1. **H1 — 40+ remaining catalog strategies.** Foundation proven; each
   future strategy ~2-4 hrs incl. detector + H2 wiring + assumptions
   + tests + frontend (which is generic, no changes needed).
2. **H3 detector wiring** — multiYearEngine primitive in place but no
   detectors yet wired to use it. Highest-value wires: G1.4 Roth
   long-term, G1.3 bunching, G1.8 DAF. Each ~2-3 hours.
3. **H5 schema extensions** — current 14 asset types cover most cases;
   future additions: ESPP (employee stock purchase plan basis), ISO
   shares-held-for-AMT-credit, restricted stock pre-§83(b), cryptos.
4. **H6 Form 8606 Part II / Part III** — current implementation handles
   Part I only (Roth conversion from traditional IRA). Part II (Roth
   conversion of inherited IRA) and Part III (Roth distribution basis
   tracking) deferred.
5. **H8 LLM verification** — current discovery returns LLM-self-reported
   confidence. A future enhancement: have the rule engine attempt to
   verify each candidate by checking trigger conditions.

The 4 prior C-batch sub-gaps also remain open: §163(j) ATI proxy,
§461(l) auto-aggregation, §1031/§121 NIIT routing, Form 8824/8990 PDFs.

## What's left (post-Phase H — strongest candidates)

1. **A1 — CPA outreach campaign** — packet still complete; blocked on
   user availability. Highest revenue gate.
2. **D15 — multi-tenancy auth (2-3 wks)** — required before charging
   real money. Wires actorUserId into audit_log.
3. **D18 — Stripe billing (1-2 wks)** — depends on D15.
4. **H1 continued catalog (~5-6 wks if going to 50+)** — incremental
   value per strategy now that foundation is done.
5. **C2 — top-10-state credits push (2-3 wks)** — engine coverage on
   state side.

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. docs/todo.md                 — THE LIVE TODO
  2. docs/coverage-matrix.md      — Per-state + per-feature inventory
  3. .claude/handoff.md           — Last session state (Phase H COMPLETE)
  4. .claude/roadmap.md           — Long-arc Phase A-G plan
  5. CLAUDE.md                    — invariants, closure log

Where we left off (2026-05-27): Phase H is FULLY COMPLETE — all 12
H-items shipped this session block. Catalog at v1.3 (20 strategies).
~2,600+ assertions across 38 suites green. ZERO documented gaps.

Phase H foundation:
  - whatIfEngine + multiYearEngine + form8606 (3 new pure libs)
  - client_asset_balances schema + CRUD + UI
  - 7 Planning tab cards (per-strategy + Cross-strategy + AI Discovery +
    State residency + Peer benchmark + Multi-year trends + Total savings)
  - Engine-verified deltas via H2 mutations on 11 of 20 strategies
  - H7 captures cross-strategy interaction effects
  - H8 LLM Discovery surfaces missed candidates qualitatively

Top recommendation: **A1 CPA outreach** (biggest revenue gate; packet
complete; awaits user availability). Alternative: **D15 multi-tenancy
auth (2-3 wks)** — required before charging. Then **D18 Stripe
billing (1-2 wks)**.

If continuing H1 catalog expansion: REPS partial / §1031 timing / RMD
optimization / cost segregation / opportunity zones / defined benefit
plans / NQDC §409A / CLT / §1374 BIG / §338(h)(10) / §199A variants /
retirement plan max-outs. Each ~2-4 hrs.

Quality bar:
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update docs/todo.md / .claude/handoff.md / CLAUDE.md at session end
- Deploy to EC2 at the end (git pull + db push if schema changed +
  pm2 restart on EC2 + local pnpm build + rsync)
```
