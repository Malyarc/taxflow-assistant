# Database migrations — versioned, not push

**Status (2026-06-04): CUTOVER COMPLETE.** Dev + prod (Neon) are both baselined to
`0000` + `0001` and `drizzle-kit migrate` is a verified no-op on each. The EC2
deploy now uses `migrate` (see CLAUDE.md → "EC2 deploy"). `push` is local-dev-only.

What the cutover did (2026-06-04):
- Fixed the drizzle-kit **snapshot-path bug** that had blocked `generate`:
  `drizzle.config.ts`'s `out` was an absolute path, which drizzle-kit 0.31.9
  prepended `./` to → malformed `.//…/0000_snapshot.json` → ENOENT. Now relative.
- Generated **`0001_tiresome_mastermind.sql`** (purely additive) capturing the
  drift since the 2026-05-28 `0000` baseline (FED-05 blind cols, FORM-02 col, the
  `quantity`/`account` + `box4_guaranteed_payments`/`is_sstb` cols, the
  `disclosure_consents` table + FK, and 4 indexes). Validated against a fresh
  throwaway DB (builds all 14 tables cleanly). hash `441f713f…` = file sha256.
- **Caught a real prod gap:** prod was missing 3 perf indexes
  (`clients_updated_at_idx`, `clients_email_idx`, `tax_returns_agi_idx` — applied
  to dev/schema in the 2026-05-29 audit but never to prod). Created them
  (additive) so prod's physical schema fully matches `0001`. Prod's 318-column
  fingerprint now matches dev exactly.
- Baselined both DBs (`__drizzle_migrations` rows for `0000` + `0001`) and
  confirmed `migrate` applies nothing on each.

**Status (2026-05-28, historical):** versioned-migration infrastructure put in
place; `0000` baseline generated; dev baselined; prod still on `push`.

## Why this changed

The project previously synced schema with `drizzle-kit push` only (no
versioned SQL). `push` diffs the live DB against the schema and applies DDL
directly — a renamed column reads as **drop-old + add-new → silent data loss**,
there is no rollback, and dev/prod drift is unprovable. For a production tax
database that is unacceptable. We now generate reviewable, versioned SQL.

## Files

- `lib/db/drizzle/0000_messy_corsair.sql` — baseline (all 13 tables, FKs,
  indexes, constraints). Represents the schema as of 2026-05-28.
- `lib/db/drizzle/meta/` — `_journal.json` + `0000_snapshot.json` (drizzle's
  diff state). **Commit these.**
- `lib/db/drizzle.config.ts` — now has `out: "./drizzle"`.

## Day-to-day workflow (going forward)

```bash
# 1. Edit lib/db/src/schema/*.ts
# 2. Generate the migration (diff vs. the last snapshot):
pnpm --filter @workspace/db run generate          # writes drizzle/NNNN_*.sql
# 3. REVIEW the generated SQL by hand (this is the whole point — catch a
#    destructive drop/rename before it ships). Commit the SQL + meta/.
# 4. Apply:
DATABASE_URL=... pnpm --filter @workspace/db run migrate
```

`push` / `push-force` are retained for **local dev iteration only** (fast
throwaway schema sync against your local Docker Postgres). **Never run `push`
against Neon/prod.**

## One-time cutover for the EXISTING dev + prod databases — SIGN-OFF REQUIRED

The dev (`taxflow_pro`) and prod (Neon) databases already contain the baseline
schema (created by past `push` runs). Running `migrate` against them as-is would
try to `CREATE TABLE` rows that already exist and fail. They must be
**baselined**: record `0000` as already-applied *without* running it.

> NOT YET EXECUTED. This touches prod — do it deliberately, and **test the whole
> flow on a throwaway database first** (create empty DB → `migrate` → confirm it
> builds the schema cleanly).

**STATUS (2026-05-28): the LOCAL dev DB (`taxflow_pro`) is BASELINED + validated.**
`migrate` against it is now a verified no-op (it sees 0000 as applied and does
NOT re-create tables; the 13 app tables are untouched). The 0000 migration was
also validated against a fresh throwaway DB (built all 13 tables + the tracking
table cleanly). **PROD (Neon) is NOT yet baselined** — run the one-time baseline
on the box (below) before switching the deploy to `migrate`.

Baseline an existing database (run once per DB). The canonical 0000 hash that
drizzle records is fixed (sha256 of the migration file content):

```sql
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);
-- Mark the 0000 baseline as applied so `migrate` skips it and only runs 0001+.
INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
VALUES ('3383733c4b800535bf751dcb9363c6cbf6b1e85ee5ffe6510b7279e0c7e0eb79', 1780003127842);
```

(How dev was baselined, for reference: run `migrate` against a fresh empty DB so
drizzle writes the row itself, then copy it —
`pg_dump --schema=drizzle <fresh> | psql <target>`. That yields the identical
row above. Either method works.)

After inserting, confirm `pnpm --filter @workspace/db run migrate` reports
success while applying NOTHING (it sees 0000 as done). Only then switch the
deploy to `migrate`.

## EC2 deploy change (after the one-time prod baseline)

On the box, ONCE: baseline the Neon prod DB with the SQL above (`psql` against
the prod `DATABASE_URL` from `pm2 env 0`), and confirm `migrate` applies
nothing. THEN replace the schema step in the EC2 deploy cycle (`CLAUDE.md` →
"EC2 deploy"):

```bash
# OLD (remove after the prod baseline):
pnpm --filter @workspace/db run push      # only if schema changed
# NEW:
pnpm --filter @workspace/db run migrate   # applies any pending versioned migrations
```

Until prod is baselined, the deploy keeps using `push` (a migrate would fail on
prod's already-existing tables). Dev is already baselined, so locally you can
use `migrate` now.
