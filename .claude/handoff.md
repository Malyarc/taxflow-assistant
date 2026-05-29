# Handoff Note — 2026-05-28 (Deep audit: correctness + security + DB + tests)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

Durable TODO: **`docs/todo.md`**. Coverage map: **`docs/coverage-matrix.md`**.
New this session: **`docs/db-migrations.md`** (versioned-migration setup + cutover).

## 🔴 USER ACTION REQUIRED — rotate two leaked credentials

A stale, gitignored worktree settings file
(`.claude/worktrees/hopeful-wing-a2bb93/.claude/settings.local.json`) held
**two production secrets in plaintext** in `psql`/`curl` allowlist entries:
- the **Neon `neondb_owner` DB password**, and
- the **Google Gemini API key** (`AIza…`).

They were **never committed to git** (verified — not tracked, path is
gitignored, no commit ever touched it), but they sat in plaintext on disk and
were read by tooling. I scrubbed the file (values replaced with
`REDACTED-ROTATE-…`). **Rotate BOTH in the Neon console and Google AI Studio**
as a precaution — only you can do that.

## Headline

**Deep audit across four dimensions (code quality, security, database,
tax-engine correctness). Found and FIXED 5 tax-correctness bugs + 4
typecheck-breaking defects, patched 3 dependency CVEs, hardened the DB write
paths, set up versioned migrations, and added 28 hand-calc'd end-to-end
scenarios.** The engine is in genuinely good shape — money is stored as
`numeric` (no float bug), no SQL injection, validation everywhere, tests are
real hand-calcs. The real gaps were the 5 correctness bugs below + the
already-known security posture (no auth yet = D15).

### What landed (5 commits, all pushed to `main`)

1. **Tax-correctness bugs (the crown jewel)** — each hand-calc'd + regression-tested:
   - **H-1 QBI §199A**: taxable-income cap now reduced by net capital gain
     (LTCG + qualified dividends) per §199A(e)(3). Was over-deducting QBI
     whenever the cap binds with preferential income (probe: $3,717 → $797).
   - **H-2 + M-1 NIIT §1411**: base rebuilt from the engine's component buckets
     — now includes passive Schedule-E rental, 1099-MISC + K-1 royalties, K-1
     portfolio/passive income, and post-netting gains (§121 remainder, §1031
     recognized, QSBS, K-1 Box 8/9a). Was understating NIIT for the common
     high-W-2 + rental/K-1/home-sale client. RE-professional rental excluded
     via `client.rentalRealEstateProfessional`.
   - **M-2 charitable**: capital-gain-property (30%) deduction now also bounded
     by the overall 50%-of-AGI ceiling minus cash (§170(b)(1)) — independent
     caps allowed up to 90% of AGI.
   - **M-3 dependent-care** (Form 2441): disallowed for MFS unless lived-apart
     (§21(e)(2)).
2. **4 typecheck defects** (api-server now passes `tsc`; the esbuild build had
   been hiding them): `OpportunityMultiYear` export; a **masked spousal-IRA
   logic bug** (read a misspelled `unemploymentCompensation` field → never
   subtracted UI comp); `perStateOtherSourced` type relocation (×2).
3. **Security quick wins**: path-to-regexp + qs CVEs patched (`pnpm.overrides`;
   `pnpm audit --prod` clean); global Express error middleware (uniform JSON
   500s); credential scrub (above).
4. **DB safety**: document-approve (W-2 + 1099) and client-delete wrapped in
   `db.transaction` (no more orphaned rows / double-counted income on partial
   failure). Versioned-migrations baseline generated (`lib/db/drizzle/0000…`),
   `generate`/`migrate` scripts added, `push` kept for local dev only.
5. **Tests + tooling**: new `tax-engine-realworld-scenarios-tests.ts` (28
   hand-calc'd S1–S13) + a `test:no-api` runner (`pnpm --filter
   @workspace/scripts run test:no-api`) that runs all 36 no-API suites.
6. **Safe refactors**: removed an orphaned dead integration package (13 files);
   centralized the SS wage base constant (was duplicated).

## Verification

- `pnpm run typecheck` — clean (all 3 projects; was RED before — the 4 defects).
- `pnpm --filter @workspace/scripts run test:no-api` — **36 suites, 2,915
  assertions, 0 failures.**
- `pnpm --filter @workspace/api-server run build` — clean (192ms).
- `pnpm --filter @workspace/tax-app run build` — clean (frontend untouched).
- Live-API integration run (local Postgres): 9/13 suites green, including all
  three full-pipeline suites (integration / deep-integration / new-features),
  which validates the new DB transactions end-to-end.

## Secondary finding — RECONCILED 2026-05-28 (follow-up session)

The 3 live-API integration suites (`tax-engine-scenarios`,
`-phase1-integration`, `-k1-integration`) that had **stale expected values**
predating the C3 QBI-auto-default (2026-05-27) are now **fixed**. All 9 stale
assertions were independently re-hand-calc'd against the auto-default (active
K-1 Box 1 + Sch C net SE → 20% §199A deduction, bound by either the
20%-of-QBI amount or the 20%-of-(taxable − net-cap-gain) cap), confirmed to
match the engine, and rewritten with Hand-calc comment blocks. Example:
`$80k W-2 + $50k active S-corp K-1` → $10k QBI auto-default → taxable $105,400,
federal tax $18,338.50 (was asserting the pre-C3 $115,400 / $20,738.50).
**All three suites now green**: K-1 23/23, phase1 55/0, scenarios 95/0.

`tax-engine-ai-overlay-tests` still needs a real `AI_API_KEY` (a dummy key
fails extraction → doc goes `failed` → approve correctly 400s with
`"only 'pending_review' can be approved"`). Environmental, not a code issue.

## Deploy steps (for the user)

**api-server CHANGED** (engine fixes + transactions + error mw + CVE deps).
**No DB migration** (schema unchanged; migrations baseline added but cutover is
sign-off-gated — see `docs/db-migrations.md`). **Frontend UNCHANGED** (no rsync).

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml      # pull conflicts on the lock every time
git pull origin main
pnpm install                        # applies the path-to-regexp/qs CVE overrides
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
# NO `db push` — schema unchanged this session.
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
```

## What's left (prioritized)

1. **Security CRITICALs (D15)** — still the #1 risk and unchanged by this audit
   (it was scoped "quick wins only"): **no authentication/authorization on any
   API route**, PII stored plaintext at rest, prod served over HTTP. Do not put
   real client PII on the live box until auth + per-firm tenant isolation +
   encryption-at-rest + TLS land. Multi-week; needs a model decision
   (session-cookie vs JWT), a TLS terminator (ALB/CloudFront/nginx+certbot),
   and KMS for at-rest encryption.
2. ~~Reconcile the 3 stale integration suites~~ — **DONE 2026-05-28**
   (follow-up session; see "Secondary finding" above).
3. **Versioned-migrations cutover** (`docs/db-migrations.md`) — **DEV DB
   baselined + validated 2026-05-28** (0000 verified on a fresh DB → 13 tables;
   `migrate` on dev is now a confirmed no-op). **PROD (Neon) baseline is the one
   remaining step** — run it once on the box (canonical 0000 hash is in the
   doc), then flip the EC2 deploy `push` line to `migrate`.
4. **God-file refactors** (deferred): planningEngine.ts (~7.7k lines),
   `calculateStateAdditionalCredits` (853-line fn), ClientDetail.tsx (~5k).
   Maintainability-only; do in a dedicated session (850+-line block moves are
   too risky to rush).

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read first: .claude/handoff.md, CLAUDE.md, docs/db-migrations.md, docs/coverage-matrix.md.

Where we left off (2026-05-28): deep audit shipped — 5 tax-correctness bugs
fixed (QBI cap, NIIT base, charitable ceiling, dependent-care MFS), 4 typecheck
defects fixed, CVEs patched, DB writes wrapped in transactions, versioned
migrations baselined, 28 new hand-calc'd scenarios. 36 no-API suites green
(2,915 assertions). I rotated nothing — USER must rotate the leaked Neon
password + Gemini key (see handoff).

Top recommendation: D15 — authentication + per-firm tenant isolation +
encryption-at-rest + TLS. It's the #1 risk and a hard blocker before any real
client PII (or a paid partner) touches the live box. Needs your decisions on
auth model + hosting/TLS + KMS before building.
```
