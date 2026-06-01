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
asserting. Then began the planning-credibility lift (H2-wiring, survey found most
heuristic detectors are qualitative-by-nature) and closed a run of engine sub-gaps:
§461(l) Schedule-C loss flow, STL-05 (Maryland two-component EITC), K-1 §199A
wage/UBIA limit, AMT line 2e state-refund recapture, wash-sale §1091(d)
holding-period tack, and PLAN-08 (catalog validUntil gate). **38 no-API suites /
3,106 assertions / 0 failures**, clean typecheck, FED-05 UI verified in a local
browser preview, deploys verified live.

### What landed (12 fixes on `main`, all pushed; deploys verified live)

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
7. **`6681644` §461(l) Sch-C loss flow** — the engine floored `netSeIncome` at 0, so
   a Schedule C LOSS couldn't offset other income (and a large loss inflated AGI,
   since the §461(l) auto-addback was still added: a $500k loss returned AGI $695k).
   New signed `scheduleCNetSigned` flows the loss to the main AGI aggregation where
   the existing §461(l) addback caps it at $305k single / $610k MFJ; `netSeIncome`
   stays floored (== old value) for the SE-tax base, QBI, local EIT, earned income.
   +12 tests. Remaining (documented): no auto-NOL when loss > income (AGI floors at
   0, CPA uses nol_carryforward); §163(j) ATI proxy still floored.
8. **`601ae5f` STL-05 Maryland two-component EITC** — was a flat 45% refundable;
   now `max(0.45 × fedEITC, min(0.50 × fedEITC, mdTax))` (nonrefundable 50% capped
   at MD tax + refundable 45% floor), per Md. Code Tax-General §10-704. `calculateStateEitc`
   gained a `stateTaxLiability` param, threaded from the engine credit block. +9
   tests (direct unit + end-to-end wiring check). Childless-worker ~100% expansion
   still not modeled (documented).
9. **`e6540bb` K-1 §199A(b)(2)(B) wage/UBIA limit** — non-SSTB high earners got the
   full 20% QBI, ignoring the wage cap ($1M S-corp w/ $100k wages got $197k QBI vs
   $50k). `calculateQbi` now applies max(50% wages, 25% wages + 2.5% UBIA), phased
   over the band, when the K-1 supplies positive section199aW2Wages/Ubia (those
   fields already existed — no schema change). 0/absent → simplified 20% (backward
   compatible). +5 tests. Sub-gap: aggregate (not per-business) limit for mixed Sch
   C + K-1.
10. **`de0e27e` AMT Form 6251 line 2e** — a taxable state refund (§111) is in regular
    taxable income but is NOT AMT income. Engine subtracts it from the §6251 prefs;
    `calculateAmt`'s floor moved from the prefs (`max(0, prefs)`) to AMTI itself
    (`max(0, TI + prefs)`) so a negative net adjustment is honored (equivalent for
    all prior callers — prefs were always ≥ 0). +6 tests incl. an elegant
    refund-toggle differential (AMTI identical). AMT NOL + line 2i still deferred.
11. **`310ebf5` wash-sale §1091(d)/§1223(3) holding-period tack** — the basis add was
    already done; now `detectWashSales` also tacks the washed lot's holding period
    onto the replacement and flips its formBox A/B/C → D/E/F when the tacked period
    crosses one year (same-year replacement sale → STCG becomes LTCG). +5 tests.
12. **`0afb4e8` PLAN-08 catalog validUntil gate** — the per-strategy `validUntil` was
    documented + date-validated but never enforced. New `isStrategyExpiredForYear`
    + a filter in `evaluatePlanningOpportunities` suppress hits whose validUntil tax
    year is before the RETURN's tax year (deterministic, not wall-clock). All current
    strategies are validUntil 2026, so TY≤2026 unaffected; TY2027+ surfaces nothing.
    +7 tests. (H3 multi-year wiring assessed + DEFERRED — best candidate G1.22 overlaps
    the wired G1.4 Roth + needs a ~13-yr RMD projection; see docs/todo.md.)

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

1. **Tax-calc correctness:** the headline sub-gaps are now closed (K-1 §199A
   wage/UBIA, AMT line 2e, wash-sale §1091(d), §461(l), STL-05). Remaining are niche/
   low-value (see `docs/todo.md`): AMT NOL (ATNOLD) + line 2i MACRS-vs-ADS depreciation;
   K-1 guaranteed-payments dedicated Box 4 field (workaround: `additional_income` +
   Box 14A); §163(j) $30M small-biz exemption auto-detect; part-year exact NY IT-203 /
   CA 540NR schedules + mid-year resident credit; partial-wash + cross-account wash.
   None of these is high-frequency. **Consider pivoting to the planning-feature depth
   (H3 multi-year wiring) or a CPA-validation pass instead.**
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

Where we left off (2026-06-01): shipped + deployed 12 fixes — 4 audit quick-wins
(FORM-03 1040-X chain, FED-05 blind std ded incl. a prod clients-table ALTER,
PLAN-04 kiddie/Coverdell child gate, PLAN-06 QCD 70½), a 16-scenario hand-calc'd
pipeline battery, H2-wired 2 heuristic planning detectors (G1.92 Solo 401(k),
G1.96 §132(f)), 5 engine sub-gaps (§461(l) Sch-C loss flow, STL-05 Maryland EITC,
K-1 §199A wage/UBIA limit, AMT line 2e state-refund recapture, wash-sale §1091(d)
tack), and PLAN-08 (catalog validUntil gate). 38 no-API suites / 3,106 assertions
green; clean typecheck; live-verified on EC2.

Recommended next task: the high-value tax-calc sub-gaps AND the quick planning wins
are CLOSED. The remaining work is either niche calc edge cases (AMT NOL, line 2i,
K-1 guaranteed-payments field, §163(j) $30M, part-year exact schedules, partial wash)
or larger lifts that need dedicated time: H3 multi-year wiring (assessed + deferred —
best candidate overlaps G1.4, needs a defensible ~13-yr RMD model; see docs/todo.md),
and a TY2025/2026 + OBBBA catalog refresh (needs an authoritative OBBBA source — do
NOT guess the values). Strong candidates for a fresh, high-leverage session: a live
CPA-validation pass (A1 outreach packet is ready), or the Haven-fusion prep. Keep
computeTaxReturnPure pure/portable. Hand-calc every expected value; run the no-API
suite; commit per chunk; push to main AND fully deploy to EC2 + verify live.
```
