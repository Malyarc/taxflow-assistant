# Handoff Note — 2026-06-01 (Tax-calc + planning refinement: 4 fixes + 16-scenario battery)

Session continuation point for the next Claude (or human) on TaxFlow Assistant.

## ⚡ Read this first

Durable TODO: **`docs/todo.md`** (CURRENT FOCUS section). Coverage map:
**`docs/coverage-matrix.md`**. Per-strategy planning source of truth:
**`docs/planning-strategy-audit.md`**. Branch: **`main`** (5 commits this session,
all pushed + deployed to EC2 + verified live).

## 🔴 USER ACTION STILL PENDING (from the 2026-05-28 session)

Rotate the two leaked production credentials (Neon `neondb_owner` password +
Google Gemini API key). Scrubbed from disk, but only you can rotate them in the
Neon console + Google AI Studio.

## Headline

Refinement session on the **portable tax engine + planning feature** (D15 auth is
postponed to the Haven fusion). Knocked out the four quick correctness wins the
2026-05-29 audit left open, then encoded the 16-scenario real-world battery that
gives the previously-missing PIPELINE coverage for the audit's federal fixes.
Every expected value hand-calc'd against the published IRS/state rule before
asserting. Then began the planning-credibility lift (H2-wiring), with a survey
that found most heuristic detectors are qualitative-by-nature. **38 no-API suites
/ 3,062 assertions / 0 failures**, clean typecheck, FED-05 UI verified in a local
browser preview, full deploy verified on the live box.

### What landed (6 commits on `main`, all pushed + deployed)

1. **`e768c0c` FORM-03** — Form 1040-X Lines 16→20 rebuilt as the IRS settlement
   chain (Line 17 overpayment-on-original, Line 18 tax-paid-with-original, Lines
   19/20 the amendment's owe/refund). INVARIANT now test-locked: Line 20 − Line 19
   == `netFederalRefundChange` on every refund↔owed swap. Line 16 kept standalone
   so the FORM-02 footing survives. +28 hand-calc'd assertions (52→80 in the suite).
2. **`d3825d0` FED-05** — blind additional std deduction wired end-to-end. New
   `clients.taxpayer_blind` / `spouse_blind` boolean columns (openapi + db + codegen),
   `ClientFacts` fields, engine passes them to the age/blind box counter, and two
   ClientForm checkboxes. +10 assertions (IRC §63(f); single/MFJ/MFS/HoH, 2025 rates,
   not-blind control). **Prod `clients` ALTER applied** (see deploy notes).
3. **`9bfb90a` PLAN-04** — kiddie-tax + Coverdell-ESA detectors now gate on a shared
   `countEligibleChildren(client)` helper (`dependentsUnder17 + otherDependents`),
   catching 17-year-olds + 18–23 student dependents. detectFamilyEmployment (PLAN-03)
   refactored onto the same helper. +4 assertions.
4. **`809e044` PLAN-06** — QCD detector fires at year-end age ≥70 (was ≥71), catching
   clients who reached 70½ mid-year, with a `requires70HalfDateConfirm` flag + a
   sharpened distribution-date caveat for the borderline age-70 case. +4 assertions.
5. **`5d812de` 16-scenario battery** — new `tax-engine-16-scenario-battery-tests.ts`
   (42 hand-calc'd, N1–N16): FED-03 NIIT FEIE add-back (N1 single, N14 MFJ per-spouse
   cap), FED-04 QBI/NOL ordering (N2), FED-06 EITC §32(i) tax-exempt interest (N3),
   plus S-corp/partnership K-1 pass-through, MFS NIIT/Add'l-Medicare, cap-loss CF,
   §1031 boot in NIIT, SE above-the-line stacking, HoH CTC/ACTC/EITC, MA surtax,
   STL-02 Philly EIT incl. SE, Pub 915 SS taxability, §1202 QSBS. Added to
   scripts/tsconfig.json exclude; the dangling forward-ref in the 2026-05-29 audit
   suite was repointed here.
6. **`6f9121b` H2-wire G1.92 + G1.96** — attached engine-verified `runDetectorWhatIf`
   deltas to the two cleanly-wireable heuristic detectors (Solo 401(k) employee
   deferral + §132(f) transit), threading baselineInputs from the evaluator.
   estSavings stays the heuristic fallback (per the G1.1 SEP pattern). The G1.92
   whatIf ($3,760) lands BELOW the flat heuristic ($5,060) because the §199A QBI cap
   dampens each $1 of deduction — the cascade H2 is meant to capture. +9 tests.
   **Survey finding (in docs/todo.md):** the other ~44 heuristic detectors in
   G1.46–G1.96 are qualitative-by-nature (business credits, entity elections, trust
   vehicles, multi-year structures, after-tax contributions, soft guidance) and
   should NOT be force-wired — they aren't a single current-year engine mutation.

### Engine semantics worth remembering (learned this session)

- `federalTaxLiability` is **PRE-(nonrefundable-credit)** + bundles other taxes
  (SE/NIIT/Add'l-Medicare). CTC/FTC/etc. flow into `federalRefundOrOwed`, NOT this
  field. Assert clean income tax only on no-credit scenarios; use
  `childTaxCredit.nonRefundablePortion` / `additionalChildTaxCredit` / `eitc.appliedCredit`
  for credit detail.
- `r.eitc` is an `EitcCalculation` object → use `r.eitc.appliedCredit`.
- Known sub-gap re-confirmed: K-1 §199A QBI is NOT reduced by the SE-tax / SEHI /
  SEP deductions (only Schedule C is, via `netSeIncome − deductibleHalf`). The
  battery does not assert K-1 QBI for that reason (noted in-comment).

### Verification

- `pnpm run typecheck` — clean (full workspace).
- `pnpm --filter @workspace/scripts run test:no-api` — **38 suites, 3,053
  assertions, 0 failures.**
- Local browser preview (Vite + api-server on local DB): /clients/new renders both
  FED-05 "legally blind" checkboxes with the IRC §63(f) helper text, the toggle
  fires onChange, zero console errors.
- Live EC2 (after deploy): `GET /api/healthz` ok, `/api/settings` proTierEnabled,
  `/api/clients` serializes `taxpayerBlind`/`spouseBlind`, served HTML references
  the new JS bundle.

## Deploy — DONE this session (for the record / next time)

api-server CHANGED, frontend CHANGED, **DB: 2 additive `clients` columns**.
Deploy performed + verified live 2026-06-01:

1. **Prod DB (Neon):** `psql` is NOT on the box. Added the two columns surgically
   via a one-off `node` + `pg` script run from `~/taxflow-pro/lib/db` with
   `DATABASE_URL` sourced from `pm2 env 0`:
   `ALTER TABLE clients ADD COLUMN IF NOT EXISTS taxpayer_blind boolean NOT NULL DEFAULT false;`
   (+ `spouse_blind`). Chosen over `drizzle-kit push` to avoid reconciling against
   the manually-added 2026-05-29 prod indexes.
2. **Frontend:** built locally (`pnpm --filter @workspace/tax-app run build`) +
   `rsync --delete artifacts/tax-app/dist/public/` → box (the 908 MiB box OOMs on Vite).
3. **api-server:** on the box — `git checkout -- pnpm-lock.yaml && git pull origin main
   && pnpm install && pnpm --filter @workspace/api-server run build && pm2 restart taxflow`
   (skipped `db push` since the columns were added in step 1).

EC2: `ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com`,
project at `~/taxflow-pro`. Full runbook in CLAUDE.md.

## What's left — prioritized (next session)

1. **Tax-calc correctness:** **STL-05** (MD EITC two-component: 50% nonrefundable
   + 45% refundable, take the larger — engine has a single 45% refundable). Then the
   documented engine sub-gaps in `docs/todo.md` ordered by how often they bite:
   §461(l) Sch-C loss flow (engine floors netSeIncome at 0), K-1 §199A wage/UBIA +
   SSTB depth + guaranteed payments, §163(j) ATI proxy, AMT prefs (2i/2e/AMT-NOL),
   part-year per-income sourcing, wash-sale §1091(d).
2. **Tax-planning:** H2-wiring is DONE for the wireable subset (G1.92 + G1.96);
   the rest is qualitative — see the survey note in `docs/todo.md` (do NOT
   force-wire). Remaining planning work: extend H3 multi-year wiring (only
   G1.3/G1.8/G1.4 are multi-year-aware → Roth ladders, RMD, installment sales,
   carryforward depletion); **PLAN-08** (enforce catalog `validUntil`); a
   TY2025/2026 + OBBBA limits refresh across the 97 strategies
   (`docs/planning-strategy-audit.md`).
3. **Haven fusion prep:** keep `computeTaxReturnPure` pure/portable (no DB/API
   imports) — it carries into Haven, which brings its own auth/tenancy.

D15 (auth + multi-tenancy) is POSTPONED to the Haven fusion — do NOT build it; the
EC2 box stays a demo with no real PII.

## How to start the next Claude session

```
Project: TaxFlow Assistant (CPA tax-prep + planning; will fuse into "Haven",
which brings its own auth/tenancy — so D15 auth is POSTPONED, don't build it).

Read first: .claude/handoff.md, CLAUDE.md, docs/todo.md (CURRENT FOCUS),
docs/coverage-matrix.md, docs/planning-strategy-audit.md.

Where we left off (2026-06-01): shipped + deployed 4 audit quick-wins (FORM-03
1040-X chain, FED-05 blind std ded incl. a prod clients-table ALTER, PLAN-04
kiddie/Coverdell child gate, PLAN-06 QCD 70½) + a 16-scenario hand-calc'd
pipeline battery (FED-03/04/06 + pass-through/NIIT/state coverage) + H2-wired the
2 cleanly-wireable heuristic planning detectors (G1.92 Solo 401(k), G1.96
§132(f)). 38 no-API suites / 3,062 assertions green; clean typecheck; live-verified
on EC2.

Recommended next task: tax-calc correctness — START with the §461(l) Schedule-C
loss flow (the engine floors netSeIncome at 0, so a Sch C LOSS can't offset other
income — a real gap that bites). Then STL-05 (MD EITC two-component) and the other
engine sub-gaps in docs/todo.md. (H2-wiring is DONE for the wireable subset; the
rest is qualitative — see the survey note in docs/todo.md, do NOT force-wire.)
Keep computeTaxReturnPure pure/portable for the Haven fusion. Hand-calc every
expected value; run the no-API suite; commit per chunk; push to main AND fully
deploy to EC2 + verify live (runbook in CLAUDE.md / handoff.md).
```
