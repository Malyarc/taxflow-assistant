# Handoff Note — 2026-06-01 (session 2: remaining tax-calc sub-gaps + OBBBA energy-credit repeal)

Session continuation point for the next Claude (or human) on TaxFlow Assistant.

## ⚡ Read this first

Durable TODO: **`docs/todo.md`** (CURRENT FOCUS). Coverage map:
**`docs/coverage-matrix.md`**. Per-strategy planning source of truth:
**`docs/planning-strategy-audit.md`** (now has an OBBBA section). Branch: **`main`**
(9 commits this session, all pushed + deployed to EC2 + verified live).

## 🔴 USER ACTION STILL PENDING (from the 2026-05-28 session)

Rotate the two leaked production credentials (Neon `neondb_owner` password +
Google Gemini API key). Only you can rotate them in the Neon console + Google AI
Studio.

## Headline

Worked through **ALL 7 remaining tax-CALCULATOR sub-gaps** from `docs/todo.md`,
one coherent chunk at a time (each its own commit + hand-calc'd tests + EC2
deploy + live verification), then did the **#9 OBBBA catalog Tier-1 fix**. Every
expected value hand-calc'd against the published IRS/state rule; two web searches
+ three research sub-agents used to pin down authoritative values (no guessing).
Planning #8 (H3 multi-year wiring) and #10 (H2-wire remaining heuristics) were
deliberately ASSESSED + DEFERRED (the user forbade shaky models / force-wiring).
**39 no-API suites / 3,234 assertions / 0 failures; clean typecheck; all deploys
verified live.**

### What landed (9 commits on `main`, all pushed + deployed + live-verified)

1. **`358f9e8` #1a K-1 guaranteed payments (Box 4 §707(c))** — new
   `box4_guaranteed_payments` column; flows to AGI + SE (SE = max(Box 14A, Box 4),
   no double-count), EXCLUDED from QBI (§199A(c)(4)). +21 tests. **Prod ALTER applied.**
2. **`a3138c2` #1b K-1 basis/at-risk loss limits** — §704(d)/§1366(d) basis +
   §465 at-risk cap the active Box 1 loss (min(basisAtYearStart, atRiskAmount));
   excess suspended (k1BasisAtRiskLossSuspended). Untracked → unlimited (legacy).
   Flows to AGI/§461(l)/QBI consistently. +17 tests. Engine-only.
3. **`e3a9681` #1c per-business SSTB** — new `is_sstb` column; the §199A(d)(3)
   phase-out now applies per-K-1 (was wrongly phasing the whole combined QBI off
   one Sch-C flag). +11 tests. **Prod ALTER applied.**
4. **`9cb7314` #2 §163(j)(3) $30M small-biz exemption + Form 8990 Sec II/III** —
   `section_163j_gross_receipts` ≤ §448(c) ($30M/$31M/$32M, web-verified) lifts
   the 30% cap; Form 8990 PDF renders the exemption determination + Sections II/III.
   +19 tests. No DB ALTER (free-form adjustment).
5. **`0e0b860` #3 AMT line 2i + ATNOLD** — `amt_depreciation_adjustment` (±) and
   `amt_nol_carryforward` (§56(d), 90%-of-AMTI cap, web-verified). +14 tests.
6. **`ab7b8f6` #4 part-year pro-rated std deduction** — std ded + personal exemption
   now pro-rated by residency days (was full in BOTH periods → ~2× over-deduct).
   New `partYearDeductionProration` option. +6 tests (incl. re-hand-calc'd E12 oracles
   + cpa-scenario S6). Engine-only.
7. **`a7cfd4e` #5 wash-sale partial + cross-account** — new `quantity` + `account`
   columns; partial wash = loss × min(replQty,soldQty)/soldQty (consumption-tracked);
   cross-account documented + test-locked (detector is account-agnostic). +13 tests.
   **Prod ALTER applied.**
8. **`536d91a` #6 HI/NY retirement refinements** — HI excludes only employer-funded
   pension (`hi_employer_funded_pension`); NY govt pension Line 26 fully excluded
   + Line 29 $20k/$40k (`ny_government_pension`). NJ verified already correct. +11
   tests. (Research found HI/NJ/NY were ALREADY wired — the todo was stale.)
9. **`4b56dd4` #7 local taxes** — IN per-dependent exemption ($1k/filer + $1k/dep);
   KY occupational (Louisville/Lexington + Kenton/Boone wage-cap); OH cross-city
   resident credit (`oh_work_city_tax_paid`); NYC UBT (`calculateNycUbt`,
   `nyc_ubt_business_income`). +15 tests. No DB ALTER. **MD per-dependent NOT done**
   — engine has no MD state-tax row (county-localities only) + graduated phase-down
   exceeds the cliff model (documented).
10. **`a4ed208` #9 OBBBA energy-credit repeal (catalog v1.18.0)** — G1.33/G1.34/G1.37
    validUntil 2032→2025 (PLAN-08 suppresses for TY2026+); the engine was
    recommending OBBBA-repealed credits. Tier-2/3/4 refreshes documented WITH sources.
    +2 tests. api-server-only deploy.

### Engine semantics / gotchas confirmed this session

- `adjustment_type` is a FREE-FORM text column — new adjustment types need only an
  openapi enum edit + codegen, NO DB ALTER. New K-1/capital-txn FIELDS do need a
  prod ALTER (done via the node+pg pattern below).
- The deploy cadence that worked: ALTER (if needed) → `git pull && pnpm install &&
  api-server build && pm2 restart` → rsync frontend (if changed) → live round-trip.
- Part-year `calculateStateTax` previously gave the FULL std ded in BOTH residency
  periods (the #4 bug). Watch for similar full-allowance-twice patterns.
- Catalog (`lib/planning-strategies/src/strategies-v1.json`) is imported directly
  (no dist build) and `validateCatalog` runs on import — a malformed edit fails
  api-server startup, so a green planning endpoint = catalog valid.

### Verification

- `pnpm run typecheck` — clean (full workspace).
- `pnpm --filter @workspace/scripts run test:no-api` — **39 suites, 3,234
  assertions, 0 failures.** (Baseline at session start was 38 / 3,106.)
- Live EC2 after each deploy: `GET /api/healthz` ok; round-trip POST/DELETE of each
  new K-1 field / capital-txn field / adjustment type (e.g. `"box4GuaranteedPayments":
  "40000.00"`, `"isSstb":true`, `"quantity":"100.000000"`); planning endpoint 200
  (catalog v1.18.0 loaded). Final HEAD on box = `a4ed208`.

## Deploy — DONE this session (for the record / next time)

Three prod DB ALTERs applied via the node+pg one-off (psql isn't on the box), run
from `~/taxflow-pro/lib/db` with `DATABASE_URL=$(pm2 env 0 | awk ...)`:
- `schedule_k1_data`: `box4_guaranteed_payments numeric(14,2) NOT NULL DEFAULT 0`,
  `is_sstb boolean NOT NULL DEFAULT false`.
- `capital_transactions`: `quantity numeric(18,6)`, `account text`.
Frontend rebuilt locally + rsynced for #1/#2/#3/#5/#6/#7 (the 908 MiB box OOMs on
Vite). api-server rebuilt + `pm2 restart taxflow` every chunk. Full runbook in CLAUDE.md.

## What's left — prioritized (next session)

1. **Planning catalog Tier-2/3/4 OBBBA refresh** (the #9 follow-up) — dollar bumps
   (QBI/QCD/adoption/retirement/§448(c)/std-ded for TY2025→2026), SALT recode to
   §164(b)(7)/$40k, estate $15M permanence, + 4 NEW OBBBA deductions (tips, overtime,
   car-loan interest, senior $6k bonus). **All values + sources are already captured
   in `docs/planning-strategy-audit.md`** — it's a careful but well-scoped pass.
   Lower-risk than Tier-1; deferred only to protect the 580-assertion planning baseline.
2. **Remaining tax-calc sub-gaps** (all niche/low-frequency, documented in
   `docs/todo.md` / `coverage-matrix.md`): MD per-dependent exemption (needs MD state
   tax modeled first); exact NY IT-203 / CA 540NR per-line sourcing + mid-year
   resident credit + part-year locality/AMT; K-1 per-business (Form 8995-A) wage/UBIA;
   wash leftover-share re-flow.
3. **H3 multi-year wiring (#8)** — deferred; needs a defensible RMD/installment model.
4. **Haven fusion prep** — keep `computeTaxReturnPure` pure/portable (it carries into
   Haven, which brings its own auth/tenancy). D15 auth POSTPONED.

D15 (auth + multi-tenancy) is POSTPONED to the Haven fusion — the EC2 box stays a
demo with no real PII.

## How to start the next Claude session

```
Project: TaxFlow Assistant (CPA tax-prep + planning; portable engine
computeTaxReturnPure fuses into "Haven", which brings its own auth/tenancy — so
D15 auth is POSTPONED, don't build it).

Read first: .claude/handoff.md, CLAUDE.md, docs/todo.md (CURRENT FOCUS),
docs/coverage-matrix.md, docs/planning-strategy-audit.md (OBBBA section).

Where we left off (2026-06-01 session 2): shipped + deployed + live-verified ALL 7
remaining tax-calc sub-gaps (K-1 depth, §163(j) $30M, AMT line 2i + ATNOLD,
part-year pro-rated std ded, partial/cross-account wash, HI/NY retirement, IN/KY/OH/
NYC-UBT local) + the #9 OBBBA energy-credit repeal (catalog v1.18.0). 39 no-API
suites / 3,234 assertions green; clean typecheck. Planning #8/#10 deliberately deferred.

Recommended next task: the **planning catalog Tier-2/3/4 OBBBA refresh** — the
authoritative TY2025/2026 values + sources are ALREADY in
docs/planning-strategy-audit.md (QBI/QCD/adoption/retirement/§448(c)/std-ded dollar
bumps, SALT §164(b)(7)/$40k, estate $15M permanence, + 4 new OBBBA deductions: tips/
overtime/car-loan-interest/senior $6k). It's well-scoped: update strategies-v1.json
+ any affected detector values, hand-calc the test deltas, run the no-API suite,
commit, deploy api-server. Keep computeTaxReturnPure pure. Hand-calc every value;
commit per chunk; push to main AND deploy to EC2 + verify live.
```
