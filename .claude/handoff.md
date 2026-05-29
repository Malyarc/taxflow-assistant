# Handoff Note — 2026-05-29 (Deep audit #2: code, security, DB, every engine, UI)

Session continuation point for the next Claude (or human) on TaxFlow Assistant.

## ⚡ Read this first

Durable TODO: **`docs/todo.md`**. Coverage map: **`docs/coverage-matrix.md`**.
Branch: **`deep-audit-2026-05-29`** (5 commits, pushed; open a PR to merge to main).

## 🔴 USER ACTION STILL PENDING (from the 2026-05-28 session)

Rotate the two leaked production credentials (Neon `neondb_owner` password +
Google Gemini API key). They were scrubbed from disk but only you can rotate
them in the Neon console + Google AI Studio.

## Headline

**Second deep audit, run as two adversarially-verified multi-agent passes
(8-dimension find → verify, then 19 tax-correctness claims independently
re-derived against the code + a cited IRS/state source with hand-calcs).** Every
finding was triaged: false positives were dropped (the verify pass refuted 2
tax findings and downgraded several), and only confirmed bugs were fixed. 22
bugs fixed across 5 commits, all guarded by the test suite (now **37 no-API
suites / 2,943 assertions green**, clean typecheck) and the key fixes verified
live in the browser.

### What landed (5 commits on `deep-audit-2026-05-29`, all pushed)

1. **`20c6d0b` safe non-tax fixes** — DB-01 pg Pool config (max/idle/timeout/
   keepAlive + Neon TLS + `pool.on('error')`); BE-02 atomic `onConflictDoUpdate`
   replacing the racy SELECT-then-INSERT in `recalculateAndUpsertTaxReturn`;
   SEC-01 project away base64 `fileContent` PII from the documents list; SEC-03
   block `__proto__`/`constructor` in the what-if field setter; **FE-02 hoist
   `W2Fields` to module scope** (it remounted on every keystroke and stole input
   focus — W-2 entry was unusable); BE-06/BE-08 hygiene.
2. **`d08b490` 9 federal + state tax-correctness bugs** + a new 28-assertion
   regression suite (`tax-engine-audit-2026-05-29-tests.ts`) + 4 updated prior
   expectations that encoded the old buggy values:
   - FED-01 AMT 26/28% breakpoint halved for MFS (Form 6251; was −$2,326).
   - FED-02 kiddie-tax threshold year-indexed ($2,600/$2,700).
   - FED-03 NIIT MAGI adds back the §911(a)(1) FEIE per §1411(d).
   - FED-04 QBI §199A cap computed on POST-NOL taxable income.
   - FED-06 EITC §32(i) test now counts tax-exempt interest.
   - STL-01 NYC self-employed MCTMT = flat 0.60% over $50k (Zone 1, TY2024+).
   - STL-02 PA EIT / OH SDIT / Philly NPT earned-income base includes SE net profit.
   - STL-03 MA 4% / CA 1% surtaxes on state taxable income, not AGI.
   - STL-04 IL part-year exemption cliff tested on full-year AGI.
3. **`fea8d3c` 5 planning-detector bugs** + tests (the §1377 tests were inverted
   because the old ones asserted the dead-code bug):
   - PLAN-01 Saver's Credit QSS → single column (fixed in detector AND engine).
   - PLAN-02 §1377 detector gates on S-corp presence, not SE earnings (was dead).
   - PLAN-03 family-employment includes 17-year-olds (otherDependents).
   - PLAN-05 student-loan-interest applies the §221 phase-out fraction.
   - PLAN-07 S-corp reasonable-comp nets wages out of the SS wage base.
4. **`c8e9f37` FORM-01** — corrected the stale Form 8824 footnote that told CPAs
   to manually add NIIT on §1031 boot gain the engine already taxes (double-count).
5. **`76afa96` DB scaling** — DB-07 `/dashboard/summary` SQL aggregate (was a
   full-table load of the widest table); + `clients(updated_at)`, `clients(email)`,
   `tax_returns(adjusted_gross_income)` indexes (clients had ZERO secondary
   indexes). Applied to the dev DB; EXPLAIN confirms Index Scan Backward.

### Verification

- `pnpm run typecheck` — clean (forced a fresh build; the incremental cache had
  masked a real error mid-session — clear `*.tsbuildinfo` when in doubt).
- `pnpm --filter @workspace/scripts run test:no-api` — **37 suites, 2,943
  assertions, 0 failures.**
- Live UI (Vite + api-server on the dev DB): dashboard renders DB-07 values +
  planning hit-list, zero console errors; ClientDetail 11 tabs render; **W-2 Add
  form keeps focus across keystrokes** (FE-02 confirmed) — screenshot in session.

## What's left — prioritized plan (NEEDS YOUR DECISION on the big ones)

1. **Auth + multi-tenancy (D15)** — STILL the #1 risk. No auth on any route, no
   `firm_id`/tenant column. Multi-week; needs decisions: session-cookie vs JWT;
   TLS terminator (ALB/CloudFront/nginx+certbot); KMS for at-rest PII. Blocks any
   real client PII on the live box. Once `firm_id` lands it also unlocks the next item.
2. **N×M planning query storm (DB-02/03/BE-05)** — `/planning-hit-list` (backs
   the dashboard widget, hottest path) + `/peer-benchmark` recompute the FULL tax
   engine for EVERY client serially (~12×N queries) with no firm scoping. Fix:
   read the persisted `tax_returns` rows (AGI/effective-rate are stored columns;
   the agi index from this session supports it) instead of recomputing; bound
   concurrency; add `WHERE firm_id` (needs #1). Fine at 97 clients, bites at scale.
3. **Prod DB migration cutover — BLOCKED.** `drizzle-kit generate`/`migrate` fail
   on a malformed snapshot path in `lib/db/drizzle/meta/_journal.json` (a doubled
   `.//<abs path>`). Fix that first, then the new indexes ship as a versioned
   migration. Until then, add the 3 indexes to prod manually with `CREATE INDEX
   CONCURRENTLY` (statements in commit `76afa96`).
4. **Forms (verified specs ready, need small schema changes):**
   - FORM-02 (HIGH): Form 1040-X Line 8/10 overstate tax by the non-refundable
     credits (engine `federalTaxLiability` is pre-credit). Needs a persisted
     `total_non_refundable_applied` column + snapshot + line math.
   - FORM-03 (MED, pure code): 1040-X Line 19/20 don't reconcile on a refund↔owed
     swap — rebuild as the IRS Line 16→21 chain.
   - FORM-04 (HIGH): Form 8606 Part III treats converted basis as taxable
     earnings (over-taxes). Needs a `roth_conversion_basis` adjustment + the
     conversion-basis layer (function fix is backward-compatible).
5. **God-file refactor** (maintainability): planningEngine.ts (~7.7k),
   ClientDetail.tsx (~5k), `calculateStateAdditionalCredits` (~853-line fn).
6. **Frontend robustness:** FE-03 (Schedule D / Rentals / K-1 queryFns skip
   `res.ok` → crash on a 500), FE-04 (hardcoded cyan/fuchsia in two Planning
   cards break dark mode). Exact line refs in the audit output.
7. **Real-world scenario battery** — the audit workflow designed 16 complex CPA
   scenarios (individual + pass-through). Encode them as a hand-calc'd suite; they
   also give end-to-end coverage for FED-03/04/06 (currently locked by direct
   hand-calc, not a pipeline test).
8. **Low-priority verified items:** FED-05 (blind std ded — unwired feature),
   STL-05 (MD EITC two-component; realistic error $0), PLAN-04/06/08, SEC-02/04/05,
   DB-09 (audit_log → timestamptz), DB-10 (redundant tax_returns index), DB-11
   (CHECK constraints on enum-ish text cols), DB-12 (adjustments needs tax_year).
9. **Refuted — do NOT "fix":** FORM-05 (8606 pro-rata denominator is correct per
   Form 8606 Line 9; only a contradictory docstring), MY-01 (multi-year
   carryforward held flat is inert — no consumer reads it within the horizon).

## Deploy steps (for the user)

**api-server CHANGED** (engine fixes + dashboard aggregate + pool config).
**Frontend CHANGED** (ClientDetail W-2 hoist — needs rebuild + rsync).
**DB:** 3 additive indexes — add to prod with `CREATE INDEX CONCURRENTLY` (see
commit `76afa96`); no other schema change this session.

```bash
# 1. Merge the branch (open PR from deep-audit-2026-05-29) or push to main.
# 2. Frontend build (locally — the 908 MiB box OOMs on Vite):
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
# 3. api-server (on the box):
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro && git checkout -- pnpm-lock.yaml && git pull origin main && pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
# 4. Prod indexes (one-time, non-blocking) — psql into Neon and run:
#   CREATE INDEX CONCURRENTLY IF NOT EXISTS clients_updated_at_idx ON clients (updated_at);
#   CREATE INDEX CONCURRENTLY IF NOT EXISTS clients_email_idx ON clients (email);
#   CREATE INDEX CONCURRENTLY IF NOT EXISTS tax_returns_agi_idx ON tax_returns (adjusted_gross_income);
pnpm --filter @workspace/api-server run build && pm2 restart taxflow
curl http://localhost:8080/api/healthz
```

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read first: .claude/handoff.md, CLAUDE.md, docs/coverage-matrix.md.

Where we left off (2026-05-29): second deep audit shipped on branch
deep-audit-2026-05-29 (5 commits) — 22 verified bug fixes (federal + state tax
correctness, 5 planning detectors, security/perf/frontend), DB-07 dashboard
aggregate + scaling indexes, FE-02 W-2 focus bug. 37 no-API suites / 2,943
assertions green; clean typecheck; UI verified live.

Top recommendation: FORM-02 + FORM-04 (the two HIGH-severity CPA-form bugs with
verified specs in the handoff) — both are small + isolated and each needs one
schema addition. Do them together with the prod-migration-snapshot-path fix
(handoff item 3) so the schema change ships cleanly. Then tackle the N×M planning
query storm (handoff item 2). Auth + multi-tenancy (D15) remains the #1 risk and
needs your architecture decisions before building.
```
