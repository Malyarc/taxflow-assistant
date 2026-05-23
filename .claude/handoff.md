# Handoff Note — 2026-05-23 late evening (end of accuracy-audit session)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Intense self-audit complete + two real bugs fixed.** Without a CPA in the
loop, we sourced canonical IRS publication + state DOR worked examples,
ran the engine against 88 hand-calc assertions, found 2 real bugs, fixed
them, and shipped a CPA-defensible accuracy report under
`docs/accuracy-audit/`.

**Current state: 1,420 assertions / 0 real failures across 25 suites + 4
documented gaps.** Live at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com.

## What's done this session

| Commit | Title |
|---|---|
| `103bb7d` | C13 follow-up: rate-limit handling for Gemini free tier |
| `535dcff` | C13 LIVE run: partial real-Gemini results + W-2 cohort analysis (F1 0.865) |
| `0053f0f` | C14: side-by-side AI vs CPA diff column in review modal |
| `02de22a` | Phase C wrap handoff |
| `a5cceee` | **Fix: over-65 std-ded add-on + IL personal exemption** |
| `3c24e3c` | **Accuracy audit harness — 88 hand-calc assertions vs IRS/state DOR sources** |

## Real bugs found + fixed

### Bug 1: Over-65 std-ded add-on never applied (`a5cceee`)

`taxpayerAge: 67` was read for SS-exemption + retirement-exclusion paths
but never for the IRS Form 1040 Std Ded Chart add-on. Every filer 65+
taking the standard deduction over-paid by ~$234–$429 (single, marginal
12–22%).

Fixed: added `getFederalStdDedAgeBlindAddOn()` + `countStdDedAddOnBoxes()`
with IRS-correct amounts:
- 2024: $1,950 per box single/HoH; $1,550 per box MFJ/MFS/QSS
- 2025: $2,000 per box single/HoH; $1,600 per box MFJ/MFS/QSS

Source: IRC §63(f) + IRS 2024 Form 1040 Instructions p. 34.

(Note: prior CLAUDE.md cited $1,550 single / $1,250 MFJ — those values
were wrong. The above are authoritative.)

### Bug 2: IL personal exemption hardcoded to $0 (`a5cceee`)

Engine comment marked it "approximated as zero." Every IL filer over-paid
by $137.36 single / $274.73 MFJ. Fixed with IL's `$2,775 single / $5,550
MFJ` exemption per IL-1040 instructions. Dependent exemptions and the
$250k/$500k phase-out are still not modeled (over-deducts by max
$137/filer at the top — flagged limitation).

## Documented gaps (intentional, tracked in audit harness)

| ID | Gap | Source |
|---|---|---|
| G1 | NYC EITC sliding scale (30/25/20/15/10% of fed EITC by NYAGI) — engine has NY state EITC 30% flat but not the additional NYC city EITC | NY IT-215 Instructions |
| G2 | MN $1,750/child refundable CTC — engine has MN WFC but not the separate child CTC | MN Schedule M1CWFC |
| G4 | WA 7% LTCG excise > $262k threshold — engine returns $0 state tax for WA | RCW 82.87 |
| G5 | CA AMT (Schedule P 540) 7% flat with $244,857 single exemption | FTB Schedule P (540) |

## Verified-correct features that the audit confirmed work

- MA 4% Millionaire's Surtax above $1,053,750 ✓
- NY State EITC at 30% of federal ✓
- CO EITC year-keyed (50% TY2024 / 35% TY2025 / 25% TY2026+) ✓
- MN Working Family Credit Schedule M1CWFC ✓
- NJ EITC at 40% of federal ✓
- IL EITC at 20% of federal (PA 102-0700) ✓
- MA EITC at 40% of federal ✓
- NYC PIT brackets per filing status (vs IT-201-I) ✓
- 2024 Tax Computation Worksheet (single $100k=$17,053, MFJ $200k=$34,106, single $500k=$145,374.75) ✓
- AOC + LLC phase-outs (Pub 970 examples) ✓
- IRA phase-out (Pub 590-A example) ✓
- AMT preference detail (SALT addback auto + ISO bargain) ✓
- Schedule SE + half-SE adjustment ✓
- Capital loss $3k cap ✓
- ACTC refundability cap $1,700/child ✓
- 50-state std-ded + bracket coverage ✓

## Test count tracker

- Session start: 1,372 / 24 suites
- After accuracy audit: **1,420 / 25 suites** (+88 assertions in
  `tax-engine-accuracy-audit-tests.ts`; −40 because some pre-existing
  tests needed expected-value correction after the engine fixes; net
  +48)

All 24 pre-existing suites continue at 0 failures. The new audit suite
exits 0 (no real engine deltas) but emits 4 expected gap warnings.

## EC2 deploy

Engine fix deployed (`a5cceee`) via the standard cycle:

```
ssh ec2:~/taxflow-pro
git pull && pnpm install
export DATABASE_URL=$(pm2 env 0 ...)
export AI_API_KEY=$(pm2 env 0 ...)
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz   # {"status":"ok"}
```

No frontend changes this session, no schema changes. Existing tax_returns
keep their old cached numbers until next CRUD touch (next recompute
applies the bug fix).

## Next session — recommended priorities (read order)

1. **`.claude/handoff.md`** — this file
2. **`.claude/roadmap.md`** — Phase C complete; D / E / Phase 5 next
3. **`CLAUDE.md`** — invariants
4. **`docs/accuracy-audit/report.md`** — the new evidence packet

### Top candidates for next session

**Option A — Close the documented gaps (engine accuracy):**
Each is well-bounded, ~1-2 days. Pick by partner-relevance:
- G1 NYC EITC sliding scale — high impact for NYC residents (~$2k/yr).
  Maps cleanly: add a new credit calc on top of existing localTax line.
- G2 MN $1,750/child CTC — material for MN families with kids.
- G5 CA AMT — material for CA tech-comp filers with ISO grants.
- G4 WA LTCG excise — small population but binary (currently $0 reported).

**Option B — CPA partner outreach (no code):**
Lead with the three artifacts:
1. `docs/validation-packet/` (10 hand-keyable scenarios)
2. `docs/accuracy-audit/report.md` (84/84 hand-calc + 2 bugs found+fixed)
3. `docs/ai-benchmark/LIVE-RUN-NOTES.md` (W-2 F1 0.865)
Plus the C14 polished review-modal demo.

**Option C — Finish real-Gemini C13 benchmark:**
Re-run with paid quota or after free-tier daily reset to replace the
MOCK sample with full 100-doc real numbers.

**Option D — Phase D (only when paid partner committed):**
D15 multi-tenancy auth (2-3 wks); D16 audit-log hardening; D17 S3 +
encryption; D18 Stripe billing.

### What I'd NOT do speculatively

- Phase D before a paid partner is committed
- Real UltraTax integration (Phase 5 — SurePrep / SDE / GUI automation)
  before a partner specifically asks for file-based ingestion
- Add the state CTCs (CA YCTC, CO CTC, NJ CTC, NM CTC, VT CTC, IL CTC)
  or PA Schedule SP Tax Forgiveness without a specific filer asking —
  these are easy to add per-state, but speculative builds rot

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these four files first, in order:
  1. .claude/handoff.md           — accuracy-audit session complete; marching orders below
  2. .claude/roadmap.md           — Phase A→C done; D / E / Phase 5 next
  3. CLAUDE.md                    — invariants, conventions, test discipline
  4. docs/accuracy-audit/report.md — the audit findings + 2 bugs fixed

Where we left off: Phase A + B + B+ + C12 + C13 + C14 all complete +
adversarial self-audit landed. 1,420 assertions across 25 suites, 0
real failures, 4 documented engine gaps. Live at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com.

The C13 LIVE benchmark gave us W-2 precision 97.5% / recall 77.7% /
F1 0.865 on gemini-2.5-flash (n=25) before hitting the free-tier
daily quota; 1099 cohort still unanalyzed.

This session's job, pick ONE:

  Option A — Close a documented gap. Each is ~1-2 days; pick by
  partner-relevance: G1 NYC EITC sliding scale, G2 MN $1,750/child
  CTC, G5 CA AMT, G4 WA LTCG excise. Tests in
  scripts/src/tax-engine-accuracy-audit-tests.ts will auto-flip from
  documented-gap to PASS once implemented.

  Option B — CPA design-partner outreach (C11). No code. Lead with
  docs/validation-packet/ + docs/accuracy-audit/report.md +
  docs/ai-benchmark/LIVE-RUN-NOTES.md + the C14 review-modal demo.

  Option C — Finish C13 LIVE. Re-run after the Gemini free-tier daily
  reset (or with paid quota) to replace the MOCK sample at
  docs/ai-benchmark/{report,raw,aggregate} with full 100-doc real
  numbers.

  Option D — Phase D multi-tenancy auth (D15), only once a paid
  design partner is committed and explicitly asks.

Quality bar (same as prior sessions):
- Each item ships as its own commit
- All 25 existing suites + accuracy-audit must stay at 0 real failures
- Update roadmap.md status, CLAUDE.md test list, handoff.md at session end
- Deploy to EC2 at the end
```
