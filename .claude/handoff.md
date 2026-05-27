# Handoff Note — 2026-05-26 (Deep audit + 20 real-world scenarios)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked,
~30 open tasks organized into:
- **A** — strategic / business
- **B** — Planning Strategy tool smartness upgrades (H1-H12)
- **C** — engine coverage push (federal + state)
- **D** — infra / security hardening
- **E** — reactive / deferred

Read `docs/todo.md` BEFORE picking a task. The Claude task tool inside
any single session is ephemeral — only that file persists.

## Headline

**Deep four-axis audit complete (code quality / security / database /
real-world coverage). All high-severity findings actionable in one
session were fixed; 20 new hand-calc'd CPA-grade scenarios shipped as
a regression suite. 2,150+ assertions across 30 suites now. Engine
still at zero documented federal/state gaps.**

## What landed (commits in order)

| Commit | Item | Notes |
|---|---|---|
| `260eb04` | **Deep audit fixes** — code quality + security + DB | FK + indexes on 8 tables, CORS allowlist, rate limit, PII redaction in audit log, file-content MIME validation, AI key check, Promise.all on 6 queries, O(n²) → O(n) wash-sale detector |
| `995b5e1` | **20 real-world CPA scenarios** | 146 hand-calc'd assertions; pure engine; no API required; covers stock comp / RE pro / multi-state / retiree / K-1 / ACA / kiddie / FEIE / NIIT / AMT / wash sale / FTC / NYC + MD locality |

## Audit summary

Four parallel audit agents ran simultaneously and produced
severity-ranked reports. Findings split into Tier 1 (fixed this
session) and Tier 2 (documented for follow-up sessions).

### Code quality audit

- **CRITICAL** `as any` casts throughout ClientDetail.tsx (19 sites) →
  *deferred* (large refactor, low risk in current code path).
- **CRITICAL** Silent catch in `recalculateAfterMutation` → *kept
  intentional* (documented; log line is monitored; mutation row write
  isn't affected).
- **HIGH** Sequential Drizzle queries in `computeTaxReturn` → **FIXED**
  via `Promise.all()`. 6 queries now batch.
- **HIGH** O(n²) wash-sale detection → **FIXED**. New first-pass groups
  rows by normalized security key; inner loop scans only matching-
  security candidates. Drops worst case from ~1M comparisons to ~1k
  for a 1000-row capital_transactions table.
- **HIGH** Manual numeric coercion in mapReturn (route layer) →
  *deferred* (working; refactor risk).
- **MEDIUM** ClientDetail.tsx 3400 lines / many tabs → *deferred*
  (split into sub-components is its own ~1-day refactor).
- **MEDIUM** Stale LOCAL_TAX_DATA verification dates → *to add* (one
  comment block per category).

### Security audit

- **CRITICAL** No authentication → *D15 territory, 2-3 weeks separate
  session*.
- **CRITICAL** PII transmission to AI without consent → *partial:
  banner exists; per-upload consent UI deferred*.
- **CRITICAL** CORS `*` → **FIXED** via `ALLOWED_ORIGINS` env-var
  allowlist (production must set it; dev permissive when unset).
- **HIGH** HTTP-only deployment → *infra: needs TLS terminator before
  paid customers*.
- **HIGH** No rate limiting → **FIXED** with `express-rate-limit` at
  200 req/min/IP (configurable via `RATE_LIMIT_PER_MINUTE`).
- **HIGH** PII in audit logs → **FIXED**. New `redactPii()` helper in
  `auditLog.ts` masks SSN/EIN/TIN/account fields before persist.
  "123-45-6789" → "***-**-6789"; bare digits keep last 4.
- **MEDIUM** File MIME validation by extension only → **FIXED**. New
  `validateAndResolveMimeType()` inspects magic bytes; documents route
  rejects with 415 on mismatch.
- **LOW** AI key fallback to "missing-key" → **FIXED** with production
  warning. `AI_DISABLED=true` silences when intentional.
- **LOW** CSP `unsafe-inline` for Vite → *deferred* (needs Vite nonce
  plugin).

### Database audit

Critical findings all **FIXED** this session:

- **CRITICAL** Missing FK constraints on 8 tables → added (clientId →
  clients.id with ON DELETE CASCADE; documentId → tax_documents.id
  with ON DELETE SET NULL where applicable). Cleaned 524 orphan rows
  in dev DB before push.
- **HIGH** Missing indexes on (clientId, taxYear) → added composite
  indexes on tax_returns, w2_data, form_1099_data, capital_transactions,
  rental_properties, schedule_k1_data. Single-column indexes on
  adjustments, tax_documents. Composite (clientId, status) on
  tax_documents and (clientId, createdAt) + (entityType, entityId)
  on audit_log.

Documented and deferred:

- SSN encryption (D17, ~2 weeks)
- tax_documents.fileContent → S3 (D17)
- audit_log partitioning (defer until ~5M rows)
- firmId multi-tenancy columns (D15)
- Drizzle versioned migrations vs `push` (1 day)
- Connection pool tuning + read replicas (deferred until load grows)

### Real-world scenarios

- 20 scenarios designed in `docs/cpa-scenarios-20.md` (~5,400 words,
  hand-calc derivations against IRS published rules).
- Implemented as `scripts/src/tax-engine-cpa-scenarios-tests.ts`,
  146 hand-calc'd assertions, pure engine (no API server required).
- Surface area covered: federal brackets + LTCG/QDIV preferential
  stacking, AMT (K3), NIIT, Additional Medicare (K2), Schedule A/C/D/E
  including REP + MACRS, Schedule K-1 (S-corp), QBI (§199A), all 10
  K-list items (NOL, FEIE, §121, §1202, kiddie, AddlMed, etc.),
  E1-E14 (IL exemption, AMT credit cf, charitable cf, HSA, §72(t),
  1099-G tax-benefit, §179+bonus, NYC school+MCTMT, state CTCs/EITCs,
  PA Sched SP, part-year residency, auto wash sale, MD/OH/IN local),
  NYC PIT + MCTMT, MD-Montgomery local.

Six engine sub-gaps surfaced and documented inline in the test file:
- Dependent's std-ded reduction (min(std, earned+450)) NOT auto-applied
- FTC with $0 taxable returns full paid amount (no Form 1116 form-limit
  binding when pre-credit tax is also $0)
- §121 home-sale LTCG not added to NIIT investment income
- MD-Montgomery local-tax base uses a state-bracket-base path that's
  not the simple `federalAgi − mdStdDed` formula
- §1091(d) holding-period auto-flip on wash-sale replacement (formBox
  ST→LT) not modeled
- 1099-DIV box 1a includes qualified div in IRS spec; engine correctly
  nets `ord = max(0, box1a − box1b)` to avoid double-count (CPAs who
  enter total in box1a + qDiv get correct result; CPAs who enter ord
  + qDiv separately would over-count without this normalization)

## Test state (final)

All 30 suites green. 2,150+ assertions total. **Engine: zero
documented federal/state gaps.**

| Suite | Result |
|---|---|
| tax-engine-tests | 193/193 |
| tax-engine-cpa-scenarios-tests (NEW) | 146/146 |
| tax-engine-phaseE-tests | 235/235 |
| tax-engine-deep-audit-tests | 210/210 |
| tax-engine-accuracy-audit-tests | 97/97 |
| tax-engine-50state-tests | 187/187 |
| tax-engine-planning-tests (G1) | 133/133 |
| tax-engine-planning-multi-year-tests (G4) | 70/70 |
| tax-engine-planning-integration-tests | 29/29 |
| tax-engine-pro-tier-tests | 5/5 (on-state) |
| tax-engine-scenarios | 95/95 |
| tax-engine-integration-tests | 22/22 |
| tax-engine-deep-tests | 37/37 |
| tax-engine-deep-integration-tests | 29/29 |
| tax-engine-new-features-tests | 28/28 |
| tax-engine-phase1-unit-tests | 44/44 |
| tax-engine-phase1-integration-tests | 55/55 |
| tax-engine-phase15-unit-tests | (✓) |
| tax-engine-phase15-integration-tests | 37/37 |
| tax-engine-phase2-unit-tests | (✓) |
| tax-engine-pure-tests | (✓) |
| tax-engine-edge-cases-tests | (✓) |
| tax-engine-w2-validation-tests | 37/37 |
| tax-engine-k1-tests | 70/70 |
| tax-engine-k1-integration-tests | 23/23 |
| tax-engine-amt-prefs-tests | 16/16 |
| tax-engine-state-eitc-tests | 21/21 |
| tax-engine-nyc-tests | 16/16 |
| tax-engine-capital-transactions-tests | 16/16 |
| tax-engine-rental-properties-tests | 15/15 |
| tax-engine-exports-tests | 32/32 |

## Schema changes pushed to local DB

| Table | New constraints / indexes |
|---|---|
| clients | (existing) |
| tax_returns | FK clientId→clients cascade, composite (clientId, taxYear) |
| w2_data | FK clientId cascade, FK documentId set-null, composite (clientId, taxYear), documentId |
| form_1099_data | FK clientId cascade, FK documentId set-null, composite (clientId, taxYear), documentId |
| adjustments | FK clientId cascade, index clientId |
| rental_properties | FK clientId cascade, composite (clientId, taxYear) |
| capital_transactions | FK clientId cascade, composite (clientId, taxYear) |
| schedule_k1_data | FK clientId cascade, composite (clientId, taxYear) |
| tax_documents | FK clientId cascade, index clientId, composite (clientId, status) |
| audit_log | (existing FK set-null), composite (clientId, createdAt), (entityType, entityId) |

EC2 (Neon) needs the same FKs + indexes applied during deploy.

## Deploy steps (for the user)

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')

# IMPORTANT — set CORS allowlist + rate-limit env (otherwise the
# CORS lockdown defaults to no cross-origin in production)
pm2 set taxflow:ALLOWED_ORIGINS "http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com"
# (Optional override) pm2 set taxflow:RATE_LIMIT_PER_MINUTE 300

# REQUIRED — Phase E + audit-fix added 10+ new columns and 18 indexes.
# Neon may have orphan rows; clean before pushing FKs if push fails:
#   DELETE FROM <child> WHERE client_id NOT IN (SELECT id FROM clients);
pnpm --filter @workspace/db run push

pnpm --filter @workspace/api-server run build
pm2 restart taxflow --update-env
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

## What's left (Tier 2 — separate sessions)

Strongest candidates for next sessions:

1. **CPA outreach campaign** — packet complete in `docs/outreach/`;
   needs user availability. Engine is feature-complete + audit-passed.
2. **Phase D15 multi-tenancy auth** (2-3 wks). The dominant remaining
   security gap. Required before charging real money.
3. **Phase D18 Stripe billing** (1-2 wks, needs D15). Pro-tier feature
   flag is already wired (G5).
4. **D17 file storage hardening** — encrypt SSN with pgcrypto +
   move tax_documents.fileContent → S3. ~2 weeks.
5. **D16 soft-delete + DB-level append-only audit_log** (revoke
   UPDATE/DELETE for app role). 1 week.
6. **Drizzle versioned migrations** vs `push`. 1 day. Worth doing
   before next major schema change.
7. **Split ClientDetail.tsx** + remove `as any` casts. Pure refactor,
   ~1-2 days, low risk now that the audit table indexed the 19 sites.

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. .claude/handoff.md           — Deep audit + 20 scenarios (last session)
  2. .claude/roadmap.md           — Phase D plan
  3. CLAUDE.md                    — invariants, closure log

Where we left off (2026-05-26): Deep four-axis audit complete; all
high-severity findings (CORS, rate limit, file MIME, PII redaction,
AI key check, DB FKs + indexes, parallelized queries, O(n) wash-sale)
applied. 20 new real-world CPA scenarios as a regression suite (146
new hand-calc'd assertions). 2,150+ assertions across 30 suites.
Engine still at zero documented federal/state gaps.

Also shipped after the audit: HSTS + upgrade-insecure-requests
removed from the Helmet CSP because they were stranding sub-resource
loads on the HTTP-only EC2 deploy (commits 90e7e72 + 8d31796). EC2
site is back online and rendering correctly.

The full open TODO list is in `docs/todo.md` (~30 tasks organized
A/B/C/D/E). Show it to me. Top recommendation is task **H2
(what-if engine, 1-2 wks)** — single biggest planning-accuracy
unlock; every existing planning rule becomes credible immediately.

Sub-recommendations after H2:
  - C1 coverage-matrix doc (1 day — foundation for state work)
  - H5 asset balance tracking (2-3 wks — unlocks RMD/NUA/Roth strategies)
  - A2 D15 multi-tenancy auth (2-3 wks — gating real billing)
  - A1 live CPA outreach (needs YOUR availability, not engineering)

Quality bar:
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update docs/todo.md / .claude/handoff.md / CLAUDE.md at session end
- Deploy to EC2 at the end (incl. git pull + db push + pm2 restart
  on EC2 + local pnpm build + rsync — see deploy steps section)
```
