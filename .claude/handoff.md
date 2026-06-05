# Handoff Note — 2026-06-05b (FORM 2210 / §6654 — audit P1-6, shipped + deployed)

Picked the next concrete audit P1 after confirming the obvious candidates were
done: H2-wiring the remaining G1.46–G1.96 detectors was already **assessed +
not-recommended** (qualitative — business credits/elections/trusts the individual
engine doesn't model; force-wiring via the refundable `credit` adjustment would
overstate), and **P1-2 "engine delta as headline" was already shipped** as PLAN-Q1
(`annotateVerifiedSavings` → `verifiedSavings`/`savingsSource`, `headlineSavings`
ranks on it, "Engine-verified (H2)" badge). So shipped **P1-6: Form 2210 / §6654**
(commit `ea26fa5`).

- **lib/form2210.ts** — `computeForm2210()`: the EXACT required-annual-payment /
  estimated-tax safe-harbor target (§6654(d): lesser of 90% current-year tax or
  100%/110% prior-year tax; 110% when prior AGI > $150k / $75k MFS) + the
  under-$1,000 and prior-year-zero exceptions (§6654(e)). Current-year tax (Line 4)
  derived exactly from the engine refund identity (federalTaxLiability − nonref −
  refundable credits). Penalty $ is a clearly-labeled ESTIMATE (underpayment ×
  year-rate [8% TY2024 / 7% TY2025, year-indexed `SECTION_6654_ANNUAL_RATE`] × ⅔,
  the even-quarterly-installment average) — the modern Form 2210 dropped the
  short-method multiplier and needs per-quarter payment dates we don't track. +
  `buildForm2210Pdf()` substitute PDF.
- **routes/tax-returns.ts** — GET `/tax-return/form-2210` (+ `/pdf`); prior-year
  tax + AGI derived from the prior-year tax_returns row, with
  ?priorYearTax/?priorYearAgi/?estimatedPayments overrides.
- **ClientDetail** — `Form2210Card` on the Tax Calculator tab (safe-harbor verdict
  + "pay $X to avoid" + PDF download), beside the Form 4868 card.
- **45 hand-calc'd assertions** (`tax-engine-form2210-tests.ts`) — all safe-harbor /
  exception / MFS-threshold / TY2024-25-26 paths + an end-to-end case.

Verified: **47 no-API suites / 3,498 assertions green**; live endpoint (prior-year
derivation + override + PDF) + the rendered card (client 6107: underpayment $1,469
→ est. penalty $78 @ 8%) confirmed in the browser; deployed to EC2 + prod-smoked
(Han: required $120,396 = 90% × $133,773). **No schema change** (no migration).

**Maintenance note:** add the next year's flat §6654 rate to
`SECTION_6654_ANNUAL_RATE` in form2210.ts once the IRS publishes its quarterly
underpayment rates (currently TY2026 = null → safe-harbor target shown, penalty $
omitted).

---

# Handoff Note — 2026-06-05 (DEFERRED BACKLOG CLEARED — Batch A 12 + Batch B 2, deployed)

Cleared the deferred backlog from the 2026-06-04 multi-agent audit. **5 commits on
`main` (`14aa2ed` → `597302d`), pushed + deployed to EC2 (api-server rebuilt,
migration 0002 applied, prod recompute-swept, frontend rsynced) + verified.**
Full no-API battery **3,453 assertions green** (was 3,432; +21); typecheck +
typecheck:tests green.

## Batch A — 12 low-severity cleanups (commits `14aa2ed` security, `50e4877` correctness)
- **#1** documents.ts: extraction now routes off the content-verified (magic-byte)
  MIME, not the filename. **#2** doc-content endpoint → `Cache-Control: no-store`
  (was `private, max-age=300`) for the PII bytes. **#3** CORS reflect-any-origin now
  needs an explicit `CORS_ALLOW_ALL=true` (was keyed off `NODE_ENV!==production`;
  the box ships with NODE_ENV unset → was reflecting any origin w/ credentials);
  disallowed cross-origin → `callback(null,false)` so same-origin mutations don't
  500. **#4** prompt-injection fence extended to the W-2 image/PDF + 1099 vision
  paths. **#5** ClientDetail masks the 1099 payer TIN (`maskTin`). **#8** post-
  approve recompute pinned to the approved record's tax year.
- **#6** tax-returns `mapReturn` coerces EVERY numeric column to number (schema-
  driven via `getTableColumns`→PgNumeric; was a 12-field list leaving ~70 cols as
  strings) + integration assert `typeof amtTax==='number'`. **#7** W-2/1099 delete
  clears the polymorphic `tax_documents` back-pointer in-txn + pins recompute year.
  **#9** disclosure-consents 404s when the client doesn't exist (was a FK 500).
  **#10** four §179/bonus/§461(l)/§448(c) year-maps hoisted to module scope, typed
  `Record<TaxYear,…>` (missing year now = typecheck error). **#11** Form 2441
  applicable-% uses `Math.ceil` ("or fraction thereof", §21(a)(2)) + dropped the
  off-by-one `agi>=43000` override; **corrected 5 stale test expectations that
  encoded the bug** ($30k→27%, $40k→22%, $43k→21%) + a 9-point boundary battery.
  **#12** year-indexed the residual stale TY2024 planning constants (G1.66 reuses
  the year-indexed G1.26 Roth phase-out — gates fire/no-fire; G1.53 kiddie
  threshold from `KIDDIE_TAX_THRESHOLD`; G1.69 via new `getFederalBracketBreakpoints`).

## Batch B — 2 scale items
- **#13 `perf(clients)` (`6fe576d` + fix `597302d`):** GET /clients keyset-paginated
  (`?limit` default 50/cap 200, `?cursor`, `?q` ILIKE name/email, `?filingStatus`),
  column-projected, returns `{items,nextCursor}`; ClientList drives search/filter/
  "Load more" off the server (`useInfiniteQuery`). OpenAPI + codegen updated.
  **Post-deploy verification caught a real keyset bug** (`597302d`): the cursor
  carried updatedAt as a millisecond JS Date (pg truncates timestamptz to ms), so
  rows sharing the cursor's ms but a smaller microsecond were SKIPPED — on prod, 3
  clients batch-inserted at the same microsecond made limit<8 return 6 of 8. Fixed
  by carrying a UTC **microsecond** ISO cursor compared via
  `$cursor::timestamp at time zone 'UTC'` (still index-usable). Verified: forced
  3-way same-µs collision paged at limit=2 returns all 97 (no skips/dupes); prod
  limit=3 now 8/8.
- **#14 `perf(planning)` (`2b87ed6`, migration 0002):** tax_returns gains
  `planning_score` + `planning_marginal_rate` (+ `tax_returns_planning_score_idx`),
  written at recalc time in taxReturnPipeline (isolated try/catch — a planning
  failure never blocks persisting the return). The firm-wide hit-list + dashboard
  Top-10 now rank via one indexed `ORDER BY planning_score DESC LIMIT n` + build
  details for only the top-N (was running the engine for EVERY client). Category
  filter keeps the per-client path (all-category score can't rank a subset; unused
  by the dashboard). Verified: fast-path top-10 IDENTICAL to the precomputed
  ranking; dashboard widget renders the same scores; topHits contract preserved.

## Verification (high bar)
- Local browser (ClientList): renders from {items}, "Load more" 50→97, server
  search 97→2, no console errors; Dashboard Top-10 widget scores render.
- Prod API (public path): clients pagination (8/8, collision-safe), q-filter,
  bad-cursor 400, hit-list ranked w/ topHits, healthz 200, new bundle served.
- **`planning_score` MUST be recompute-swept after any deploy that changes the
  planning catalog/score** (rows with null score are excluded from the fast path).
  Done this deploy (8/8 prod clients).

## Recommended next
1. H2-wire the remaining heuristic planning detectors (≈G1.67–G1.96) — the durable
   product value (engine-verified deltas). 2. God-file refactor (planningEngine 8k /
   taxCalculator 6k / ClientDetail 5k) — deferred, mid-Haven-migration. 3. The
   two-nullable-FK refactor for `tax_documents.linkedRecord*` (replaces the in-txn
   back-pointer clear). 4. Auth + multi-tenancy (D15, Haven fusion).

---

# Handoff Note — 2026-06-04c (DB MIGRATION CUTOVER — COMPLETE, commit `8e95184`)

The stale-`0000`-baseline drift class (root cause of the local hit-list 500) is
CLOSED. Dev + prod (Neon) are now baselined to versioned migrations and the EC2
deploy runs `drizzle-kit migrate`.

- **Unblocked the documented blocker:** `drizzle.config.ts` `out` was an ABSOLUTE
  path; drizzle-kit 0.31.9 prepends `./` when reading meta snapshots → malformed
  `.//…/0000_snapshot.json` → ENOENT, which had blocked `generate`. Made `out`
  relative.
- **Generated `0001_tiresome_mastermind.sql`** (purely additive — reviewed) for the
  drift since the 2026-05-28 `0000` baseline. Validated the full chain (0000→0001)
  on a fresh throwaway DB (builds all 14 tables cleanly). hash `441f713f…` = sha256.
- **Caught + fixed a real prod gap:** prod was missing 3 perf indexes
  (`clients_updated_at_idx`, `clients_email_idx`, `tax_returns_agi_idx` — added to
  dev/schema in the 2026-05-29 audit but never to prod). Created them (additive).
  Prod's 318-column fingerprint now matches dev exactly; all 4 indexes present.
- **Baselined dev + prod** (`__drizzle_migrations` rows for 0000+0001) and confirmed
  `migrate` is a verified NO-OP on each (it would have errored on the existing
  `disclosure_consents` table if it tried to apply 0001). Prod app health OK post-
  cutover (recent-clients + hit-list verified).
- **Going forward:** edit schema → `generate` → REVIEW the SQL → commit → deploy's
  `migrate` applies it. `push` is local-dev-only. CLAUDE.md "EC2 deploy" + deploy
  policy updated; `docs/db-migrations.md` marked CUTOVER COMPLETE.

Canonical hashes: `0000` = `3383733c…` (when 1780003127842), `0001` = `441f713f…`
(when 1780558502276).

---

# Handoff Note — 2026-06-04b (PLANNING-DETECTOR AUDIT — 7 gating fixes, commit `71306a8`)

Follow-up to the deep audit below: completed the one audit surface that session left
open (the `tax-state-plan` / planning-detector code review). Fanned out one agent per
detector to read the real gating code + produce SHOULD-fire/SHOULD-NOT clients, then
verified every claim against the engine via a ground-truth harness (run each client
through `evaluatePlanningOpportunities`, check fired strategy IDs). **8 detectors
audited, 7 had real gating bugs — all fixed + regression-locked. Planning suite
527→539 assertions; full no-API battery 3,432 green; CI gates green.**

- **False positives** (fired when it shouldn't): G1.4 Roth conversion (no pre-tax-
  balance check → advised converting a $0 trad IRA; now gates on supplied balances),
  G1.26 backdoor Roth (stale TY2024 phase-out tops → fired for TY2025/26 clients still
  able to contribute directly; now year-indexed), G1.31 Saver's Credit (HSA in the
  §25B gate → phantom credit; HSA isn't Form-8880-eligible), G1.17 S-corp reasonable-
  comp (no entity gate → fired for active partnerships with no wage/dist lever; added
  S-corp presence gate + TY2026 SS wage base), G1.7 QBI phase-in (stale "engine
  doesn't model the wage/UBIA limit" premise + fictional 50%-of-QBI savings → now uses
  the engine's actual limit impact).
- **Missed opportunities** (suppressed a qualifying client): G1.1 SEP/Solo-401(k)
  (hard-excluded MFS, but §408(k)/§415(c) have no filing-status limit), G1.2 PTET
  (itemizing gate suppressed std-deduction filers — prime candidates when the OBBBA
  SALT cap phases to the $10k floor).
- G1.6 NIIT-cliff was the one clean detector (sound gating).

**Methodology note (saved to memory):** the ground-truth harness caught that 8 of the
scenario-battery's "discrepancies" were agent INPUT errors (double-entered income),
not engine bugs — always verify agent-traced gating against a real engine run.

Verification harness pattern (delete-after-use temp files) is gone; the 12 new
`AUDIT-*` regression assertions in `tax-engine-planning-tests.ts` lock every fix.

---

# Handoff Note — 2026-06-04 (DEEP AUDIT — 13 fixes, merged to main + deployed to prod)

Multi-agent deep audit (security / DB-scale / code-quality / tax-correctness) +
an 18-archetype real-world scenario battery (each independently hand-calc'd from
IRS rules) + a full live UI click-through. **2 commits on `main`, pushed +
deployed to EC2 + frontend rsynced + prod recompute-swept.**

## What landed (commits `87db3e4` engine-correctness, `0e92287` hardening)

**3 engine correctness bugs (wrong tax number shipped) — each hand-calc'd + regression-locked:**
1. **QDCGT line-10 cap** (`calculateFederalTaxWithCapitalGains`): the capital-gains
   preferential base is now capped at `min(net cap gain, taxable income)`. When
   deductions exceed ordinary income (retiree/FIRE on LTCG/QDIV, big-LTCG seller),
   the engine taxed the FULL preferential at 0/15/20% — over-taxing by (unused
   deduction × top LTCG rate). Call site passes the SIGNED ordinary portion.
   Regression S14/S15/S16 in `tax-engine-realworld-scenarios-tests.ts`. *Found by
   manual hand-calc during the live UI click-through.*
2. **§199A SSTB phase-out base**: keyed on AGI; now keyed on TAXABLE income before
   QBI per §199A(e)(2) (parity with the wage/UBIA limit). AGI>taxable phased SSTB
   owners out too early. Moved below NOL, keyed on `taxableAfterNol`. 3 SSTB tests
   re-hand-calc'd (`-qbi-ty2026`, `-k1-depth`). *Found by the audit (cq-engine-1).*
3. **Part-year multi-state double-count**: a part-year mover's former-state W-2 was
   taxed BOTH as the part-year resident allocation AND as non-resident wages — a
   NY→FL mover paid MORE than a full-year NY resident ($16,709 vs $12,152). Former
   state now excluded from non-resident aggregation. Regression S17 + cpa-scenarios
   S12 corrected. *Found by the scenario battery.*
- Plus **year-map clamp**: §179/bonus/§461(l)/§448(c) now index via `resolveTaxYear`
  (consistent clamping) instead of ad-hoc per-map fallbacks that drifted on
  out-of-range years (multi-year projections past LATEST_YEAR).

**10 hardening fixes (`0e92287`):** planning hit-list **per-client error isolation**
(one bad client no longer 500s the firm-wide list — the failure that was masked as
"no opportunities" on the dashboard) + drop redundant adjustments query; **peer-
benchmark** N full-recomputes → ONE indexed SQL read over persisted columns; **PATCH
/tax-return** scoped to one tax year (was clobbering all year-rows — data loss);
**dashboard/summary** counts DISTINCT clients (row-count double-counted multi-year →
pendingReturns masked to 0 by clamp; now shows true pending); **Dashboard widget**
shows a real error state (not the benign empty state) on API failure; **CSV export**
formula-injection neutralized; **AI extraction** prompt fenced (injection defense);
**audit-log** redactPii recurses into arrays (nested SSN/TIN leak).

## Schema drift (FOUND + FIXED)
The **local dev DB** was behind the Drizzle schema by 4 columns + 1 table
(`capital_transactions.quantity`/`.account`, `schedule_k1_data.box4_guaranteed_payments`/`.is_sstb`,
`disclosure_consents`) — this 500'd the local planning hit-list. Applied additive
DDL locally. **Prod (Neon) was verified CURRENT — no drift, no prod incident.** The
stale-migration-baseline risk is real: `lib/db/drizzle` still only has `0000`.

## Verification (all green)
- 46 no-API suites / **3,420 assertions** green; full workspace typecheck + test
  typecheck (CI gates) green.
- Scenario battery: 135/144 hand-calc'd fields matched the engine; the 1 real bug
  (part-year) fixed; the other 8 discrepancies were agent input/harness errors
  (engine correct — verified by inspecting inputs).
- **181/181 local + 10/10 prod returns recompute cleanly** through the fixed engine
  (real-data smoke test, 0 throws).
- Live click-through: dashboard, client list, all 11 ClientDetail tabs, Tax
  Calculator, Planning (cross-strategy stacking) all verified working.
- Deployed: pm2 `taxflow` online + healthz ok; frontend bundle rsynced.

## Recommended next (prioritized)
1. **DB-scale (still open, low-urgency at demo scale):** `GET /clients` has no
   pagination (SELECT * whole table) — keyset-paginate + project columns + move
   ClientList filtering server-side (frontend change; won't port to Haven). The
   durable hit-list fix is a precomputed `planning_score` column on `tax_returns`
   ranked by one indexed `ORDER BY ... LIMIT` (replaces the per-client recompute).
2. **Re-run the lost `tax-state-plan` audit dimension** (its agent failed to emit
   structured output) for code-level planning-detector + state-math review — the
   scenario battery covered the intent but not the detector source.
3. **Migration cutover** — baseline the prod Neon DB + finish versioned migrate
   (the `0000`-only baseline is the root cause of the drift class; `docs/db-migrations.md`).
4. God-file split (planningEngine 8.1k / taxCalculator 5.9k / taxReturnEngine 3.2k /
   ClientDetail 5k lines) — deferred: high-risk, low durable value mid-Haven-migration.

---

# Handoff Note — 2026-06-03 (P0 legal/security gate — 6 commits on branch `p0-legal-security-gate`)

Session continuation point for the next Claude (or human) on TaxFlow Assistant.

## ⚡ Read this first

This session was triggered by a full product/codebase **audit**
(`docs/product-assessment-2026-06-02.md`) which found a strong engine + planning
architecture trapped in an unshippable trust layer. We then implemented the
**P0 legal/security gate**. Durable TODO: **`docs/todo.md`** (the new P0 section
at top). Compliance backbone: **`docs/compliance/`**. Branch:
**`p0-legal-security-gate`** (6 commits, pushed; **NOT merged to main, NOT
deployed** — that's the user's call via PR).

## Headline — what landed (all 6 commits green, pushed)

| Commit | What |
|---|---|
| `3406f4e` | **P0-6** CI (`.github/workflows/ci.yml`) + `scripts/tsconfig.tests.json` type-checks the test tree (closes "green-on-wrong-shape"); **P0-7b** TY2026 §199A SSTB QBI band fall-through fixed via one source of truth `qbiPhaseInBand` (MFS=single). +12 hand-calc assertions. |
| `306326c` | **P0-4** app-layer bearer-token auth gate (`API_AUTH_TOKEN`) on `/api` + frontend token getter; **P0-7a** removed FALSE "TLS/encryption-at-rest/read-only-creds" claims from outreach docs. |
| `e129ff3` | **P0-3** compliance backbone: `docs/compliance/WISP.md` (GLBA), `section-7216-consent.md` (verbatim consent instrument + spec), `runbook-tls-s3-secrets.md`, README. + the audit report. |
| `e46c283` | **P0-5** AES-256-GCM field encryption for SSN/TIN (`fieldCrypto.ts`) wired into W-2/1099 routes + document-approve; idempotent + versioned prefix + backfill script. |
| `f546e51` | **P0-2** fail-closed §7216 consent gate (`consentGate.ts`) before the Gemini call + `disclosure_consents` table + record/list/revoke endpoints. |
| `291637f` | **Review fixups** — closed 4 issues an adversarial self-review found (CI typecheck was red; consent gate was fail-open in edge-auth prod; planning-AI endpoints were ungated; a decrypt-sentinel could destroy a TIN). |

**Verification:** full workspace `pnpm run typecheck` GREEN; **43 no-API suites /
3,372 assertions green** (3 new security suites: auth 11, consent 12, crypto 17;
+ the QBI regression 12). api-server + db + tax-app typecheck clean.

## 🔴 USER ACTION — P0-1 (only you can do)

Rotate the leaked **Neon `neondb_owner` password** + **Gemini API key**. Full
steps: **`docs/compliance/runbook-p0-1-rotate-credentials.md`**. Note: I scanned
all git history — the creds were **never committed**, so NO history scrub /
force-push is needed; rotation in the consoles fully closes it.

## New env vars (all default to today's demo behavior when unset)

- `API_AUTH_TOKEN` — when set, every `/api` route requires `Authorization:
  Bearer <token>` (else 401). Unset = open demo + a loud startup warning.
- `PII_ENCRYPTION_KEY` — base64 32-byte AES-256 key (`openssl rand -base64 32`).
  When set, SSN/TIN are encrypted at rest; unset = plaintext passthrough (demo).
  After setting it on existing data, run `backfill-encrypt-pii.ts`.
- `REQUIRE_7216_CONSENT` — gate before AI extraction/planning. **Defaults to ON
  when `NODE_ENV=production`**, OFF otherwise. Override true/false.

## Deploy (when the user approves the PR → main)

Needs: api-server cycle + **`db push` (new `disclosure_consents` table)** +
frontend rsync (main.tsx changed). See CLAUDE.md "EC2 deploy". Extra prod env to
set before real PII: `API_AUTH_TOKEN`, `PII_ENCRYPTION_KEY`,
`REQUIRE_7216_CONSENT=true`, `NODE_ENV=production`, `ALLOWED_ORIGINS`.

```bash
# on the box, after git pull of the merged branch
pnpm install
pnpm --filter @workspace/db run push        # creates disclosure_consents
pnpm --filter @workspace/api-server run build
pm2 restart taxflow --update-env
curl http://localhost:8080/api/healthz
# locally: pnpm --filter @workspace/tax-app run build && rsync … (see CLAUDE.md)
```

## What's left (prioritized — see docs/todo.md P0 section + the audit roadmap)

1. **P0-1 (user)** — rotate creds.
2. **Operator/infra (before real PII)** — TLS + edge auth (Runbook A); S3+KMS for
   the **document blob** (still plaintext base64 in PG — field encryption does
   NOT cover it; this is P0-blocking, see README P0-5); Secrets Manager;
   Google DPA; counsel sign-off on WISP + §7216 instrument; name the Qualified
   Individual; make CI a required status check.
3. **Frontend fast-follows** — a login form (token is bootstrapped via
   `?api_token=` / localStorage today) + an in-app §7216 consent-capture step
   (the `disclosure-consents` endpoints exist; nothing calls them yet, so with
   `REQUIRE_7216_CONSENT=true` every upload 403s until consent is POSTed).
4. **Test-typecheck ratchet** — drive the `tsconfig.tests.json` quarantine (25
   legacy files, 143 pre-existing type errors; genuine wrong-shape fixtures to
   fix first: `stateWagesBox16`/`interestIncomeBox1`/`description`) → 0.
5. **Versioned migration for `disclosure_consents`** (currently push-only; the
   migrate cutover is otherwise blocked per docs/db-migrations.md).
6. **Then the product roadmap** from the audit (P1: engine-verified planning
   delta as the headline number; multi-year Roth/distribution optimizer; Form
   2210; diagnostics engine; per-field extraction confidence; land 1 real CPA
   partner). See `docs/product-assessment-2026-06-02.md` §7.

## How to start the next session

```
Project: TaxFlow Assistant. Read: .claude/handoff.md, docs/todo.md (P0 section),
docs/product-assessment-2026-06-02.md (the audit + roadmap), docs/compliance/.

State (2026-06-03): the P0 legal/security gate is implemented on branch
p0-legal-security-gate (6 commits, pushed, NOT merged/deployed). Auth gate, PII
field encryption, §7216 fail-closed consent gate, WISP + consent instrument + CI
all landed; 43 suites/3,372 assertions green. The user is rotating the leaked
creds (P0-1). Next: either (a) finish the operator/infra gate (TLS, S3+KMS doc
blob, DPA, counsel) before real PII, (b) the frontend login + consent-capture UX,
or (c) start the product roadmap (engine-verified planning delta; multi-year
optimizer; Form 2210; diagnostics). Hand-calc every tax value; commit per chunk;
keep computeTaxReturnPure pure.
```
