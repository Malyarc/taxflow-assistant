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
