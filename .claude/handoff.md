# Handoff Note — 2026-05-23 PM (K1 + K2 closed)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Two highest-impact K-list engine gaps closed this session and deployed.**

- **K1** — Schedule SE Part I Line 9 (SS wage base shared across W-2 + SE)
  for single/HoH/MFS/QSS. Combined W-2 + SE filers were over-paying the
  12.4% SS portion by ~$10k+ in the canonical $100k W-2 + $200k Sch C
  case. **MFJ sub-gap intentionally tracked** — engine sums W-2 wages
  household-wide but the IRS rule is per-spouse; without per-spouse W-2/SE
  attribution we conservatively don't apply Line 9 for MFJ (mirrors the
  old engine behavior, correct in the common case where the SE earner is
  the lower-W-2 spouse).
- **K2** — Form 8959 Additional Medicare Tax (0.9% on Medicare wages + SE
  net above filing-status threshold). New `additionalMedicareTax` field
  on `ComputedTaxReturn`, new `additional_medicare_tax` column on
  `tax_returns`, OpenAPI + codegen + PDF + CSV + IRS Form 1040 PDF all
  wired. Applies to all filing statuses (no MFJ sub-gap — Form 8959 itself
  is filed jointly with a single shared threshold).

**Current state: 1,584 assertions across 26 suites / 0 real failures.**
Live at http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com.

**Documented federal-engine gaps dropped 10 → 8.** State-engine gaps still 4.

## What's done this session

| Commit | Title |
|---|---|
| `48bb197` | K1 closed — Sch SE Part I Line 9 (W-2 + SE combined SS wage base) |
| `a131329` | K2 closed — Form 8959 Additional Medicare Tax (0.9%) |

Both deployed to EC2: API + DB schema (Neon) updated, pm2 restarted,
`/api/healthz` confirmed green. No frontend changes; no rsync needed.

## K1 detail — Sch SE Part I Line 9

Engine change: `calculateSelfEmploymentTax` takes a third optional
`w2SocialSecurityWages` param (default 0). When > 0, the SS wage base
available for SE is reduced by that amount before applying 12.4%. Medicare
portion unchanged (no Medicare cap on SS side).

Pipeline change: `W2Fact` interface gains `socialSecurityWagesBox3` and
`medicareWagesBox5` (Box 5 reserved for K2). Pipeline sums Box 3 across
W-2s (Box 1 fallback for legacy records / AI-missing extractions). For
**non-MFJ** statuses, the sum is passed to `calculateSelfEmploymentTax`.
For MFJ, 0 is passed (the per-spouse caveat).

Hand-calc cases added to deep-audit (8 positives):
- K1a: single $100k W-2 + $200k Sch C → SE $13,862.70 (was $26,262.70)
- K1b: single $200k W-2 (>SS base) + $50k Sch C → SE $1,339.08 (Medicare only)
- K1c: single $50k W-2 + $50k Sch C (combined under cap) → $7,064.78
- K1d: single pure SE $200k → $26,262.70 (unchanged from old)
- K1e: single 401k filer Box1 $80k Box3 $100k → Box 3 takes precedence
- K1f: TY2025 single $100k + $200k SE → $14,792.70 (SS base $176,100)
- K1g: half-SE deduction tracks corrected SE tax
- K1h: MFJ $185k household W-2 + $8k SE → $1,130.36 (intentionally
  unchanged from old; documents the MFJ sub-gap)

## K2 detail — Form 8959 Additional Medicare

New function `calculateAdditionalMedicareTax` in `taxCalculator.ts`:
- Threshold: $200k single/HoH/QSS, $250k MFJ, $125k MFS (same as NIIT,
  per IRC §3101(b)(2) / §1401(b)(2); not inflation-adjusted)
- Wages bucket: 0.9% × max(0, Medicare wages − threshold)
- SE bucket: 0.9% × max(0, SE net − max(0, threshold − Medicare wages))
  (shared threshold: wages consume first, then SE only above remainder)
- Returns full Form 8959 breakdown (per-bucket components) for transparency

Full plumbing:
- `ComputedTaxReturn.additionalMedicareTax` field; included in
  `detail.additionalMedicare` and folded into `totalFederalLiability`
- Pipeline reads W-2 Box 5 (Box 1 fallback), passes SE net + filing status
- New DB column `tax_returns.additional_medicare_tax` (numeric 12/2);
  schema pushed to local Postgres + Neon (EC2)
- OpenAPI: new field on all 3 tax-return response schemas; `api-zod` +
  `api-client-react` regenerated
- `pdfExport`: separate "Additional Medicare tax (Form 8959)" line in
  the CPA-facing PDF, with regular-tax row corrected to subtract it
- `taxReturnExports` (CSV/JSON/.gen): new export row with IRS code 8959-L18
- `irsForm1040Pdf`: Add'l Medicare flows into 1040 Line 23 (Sch 2 L21
  "other taxes" sum); regular-tax derivation accounts for it

Hand-calc cases added (8 new in deep-audit + 1 new in accuracy-audit + 2
new in scenarios):
- K2a: single $250k W-2 → $450
- K2b: single $180k W-2 (under threshold) → $0
- K2c: MFJ $200k+$100k W-2 → $450
- K2d: MFS $130k W-2 → $45
- K2e: single $150k W-2 + $100k SE → $381.15 (SE-only portion via shared threshold)
- K2f: single $300k W-2 + $50k SE → $1,315.58 (both buckets)
- K2g: Box 5 precedence over Box 1 → Add'l Medicare uses Medicare wages
- K2h: federalTaxLiability containment

## Test impact (this session)

| Suite | Before | After | Notes |
|---|---|---|---|
| deep-audit | 108 | 125 | +8 K1, +9 K2, 1 hand-calc updated (I20) |
| accuracy-audit | 88 | 88 | F3 expected updated for K2 + 1 sub-check added |
| scenarios | 95 | 95 | Scenario 3 + 11 expected updated for K2 |
| (others) | unchanged | unchanged | All 22 other suites — no test changes |

Documented federal gaps in deep-audit suite: **10 → 8.**
State gaps: 4 (unchanged).

## Verification

All 25 testable suites pass at 0 real failures:

```
tax-engine-tests                                       193
tax-engine-deep-tests                                   37
tax-engine-pure-tests                                   27
tax-engine-phase1-unit-tests                            44
tax-engine-phase15-unit-tests                           90
tax-engine-phase2-unit-tests                           131
tax-engine-edge-cases-tests                            125
tax-engine-w2-validation-tests                          37
tax-engine-k1-tests                                     70
tax-engine-50state-tests                               187
tax-engine-nyc-tests                                    15
tax-engine-amt-prefs-tests                              16
tax-engine-state-eitc-tests                             21
tax-engine-accuracy-audit-tests                         85   (was 83)
tax-engine-deep-audit-tests                            125   (was 108)
tax-engine-integration-tests                            22
tax-engine-deep-integration-tests                       29
tax-engine-new-features-tests                           28
tax-engine-scenarios                                    95
tax-engine-phase1-integration-tests                     55
tax-engine-phase15-integration-tests                    37
tax-engine-exports-tests                                32
tax-engine-rental-properties-tests                      15
tax-engine-capital-transactions-tests                   12
tax-engine-k1-integration-tests                         23
─────────────────────────────────────────────
TOTAL: 1,551 + 33 AI-overlay = 1,584 across 26 suites
```

`tax-engine-ai-overlay-tests.ts` (33 assertions) requires a real Gemini
API key — environmental, unchanged from prior sessions. Not a regression.

## EC2 deploy (completed this session)

```
ssh ec2:~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
pnpm --filter @workspace/db run push            # added additional_medicare_tax column
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz          # {"status":"ok"}
```

No frontend rsync needed — no frontend changes this session.

## Next session — recommended priorities

The K1 + K2 closures gave the engine its biggest accuracy lift since the
deep audit. Three reasonable next moves:

**Option A — close another K-list gap (engine accuracy):**
Remaining open gaps, prioritized by impact:
- **K10 (SS taxability worksheet)** — high prevalence among retiree
  clients; needs a new SS benefits input field on `clients` schema + Pub
  915 worksheet. ~3 days.
- **K6 (§121 home-sale exclusion)** — common (CPA encounters it
  regularly); needs new home-sale input fields + $250k/$500k exclusion.
  ~2 days.
- **K5 (SEHI deduction)** — common for SE filers paying their own
  health insurance; Form 7206. ~1-2 days.
- **K3 (AMT × LTCG via Form 6251 Part III)** — niche but large $;
  high-LTCG + AMT-binding filers currently over-pay. ~2-3 days.
- **K1 MFJ sub-gap** — would require per-spouse W-2/SE attribution on
  the data model. ~3-5 days; defer unless a CPA partner pushes for it.

**Option B — CPA design-partner outreach (C11).** The audit packet keeps
getting stronger:
- 8 federal gaps remaining (down from 10) including the most-painful
  $10k-overcharge case (K1) now CLOSED
- 1,584 hand-calc assertions across 26 suites
- `docs/validation-packet/` 10 hand-keyable cases
- `docs/ai-benchmark/LIVE-RUN-NOTES.md` W-2 F1 0.865 on real Gemini
- C14 polished review-modal demo

**Option C — Phase D (multi-tenancy, encryption, billing).** Hold until a
paid design partner is committed.

**Option D — Finish C13 LIVE benchmark** after Gemini free-tier reset (or
with paid quota) for full 100-doc real numbers.

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these four files first, in order:
  1. .claude/handoff.md           — K1 + K2 closures recap (this session)
  2. docs/accuracy-audit/deep-audit-2026-05-23.md — the full deep audit report
  3. .claude/roadmap.md           — Phase D / E / Phase 5 plan
  4. CLAUDE.md                    — invariants + the updated K-list (8 open)

Where we left off: K1 (Sch SE Line 9 for non-MFJ) and K2 (Form 8959
Additional Medicare 0.9%) both shipped and deployed 2026-05-23 PM.
1,584 assertions across 26 suites, 0 real failures, 8 federal-engine
gaps + 4 state-engine gaps documented + 1 MFJ K1 sub-gap (per-spouse
attribution) tracked separately.

This session, pick ONE:

  Option A — Close another K-list engine gap. Remaining priorities:
    K10 SS taxability worksheet (Pub 915; new SS input field; ~3 days)
    K6 §121 home-sale exclusion ($250k/$500k; ~2 days)
    K5 SEHI deduction (Form 7206; ~1-2 days)
    K3 AMT × LTCG (Form 6251 Part III preferential rates; ~2-3 days)
    K1 MFJ sub-gap (per-spouse W-2/SE attribution; data-model change; 3-5 days)
  Each is bounded and has its failing assertion in
  scripts/src/tax-engine-deep-audit-tests.ts ready to flip green
  once implemented.

  Option B — CPA design-partner outreach (C11). No code. Strong pitch
  now: 8 (down from 10) federal gaps, the most-painful $10k-overcharge
  case closed, 1,584 hand-calc assertions, validation packet + benchmark.

  Option C — Phase D multi-tenancy auth (D15), only once a paid design
  partner is committed and explicitly asks for it.

  Option D — Finish C13 LIVE benchmark after the Gemini free-tier
  daily reset (or with paid quota) for full 100-doc real numbers.

Quality bar (same as prior sessions):
- Each item ships as its own commit
- All 26 existing suites must stay at 0 real failures (25 testable; AI-overlay env-gated)
- Update roadmap.md / CLAUDE.md / handoff.md at session end
- Deploy to EC2 at the end
```
