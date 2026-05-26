# Handoff Note — 2026-05-24 (K3 + K5 + K6 + K10 closed + outreach packet)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Four engine gaps closed end-to-end and deployed; outreach packet drafted.**

Continuing from 2026-05-23 PM when K1 + K2 closed. This session closed
the next four highest-impact items plus the no-code C11 outreach
packet. Net: federal-engine gaps **10 → 6** in 36 hours, plus a
complete CPA-partner cold-outreach kit.

- **K3** — Form 6251 Part III AMT × LTCG preferential rates. AMT now
  computes the LOWER of (full 26/28% on AMT base) and (26/28% on the
  AMT-base ordinary portion + LTCG/QDIV at 0/15/20% preferential
  stacked above). Saves ~$13k on a representative high-LTCG +
  ISO-bargain single filer.
- **K5** — SEHI deduction (Form 7206, IRC §162(l)). New
  `self_employed_health_insurance_premiums` adjustment; engine caps
  at (net SE − half-SE) and adds above-the-line on Sched 1 Line 17.
- **K6** — §121 home-sale exclusion. New
  `home_sale_gross_gain_primary_residence` adjustment; engine applies
  $250k single/HoH/MFS / $500k MFJ-or-QSS cap; taxable remainder
  flows to LTCG.
- **K10** — SS taxability worksheet (Pub 915, 0/50/85%). Two new
  client fields (`socialSecurityBenefits`, `mfsLivedApartAllYear`).
  Engine computes the worksheet using AGI-excluding-SS + tax-exempt
  interest + half SS; folds taxable SS into AGI as Form 1040 Line 6b.
  Both new fields are wired through OpenAPI, Orval, DB, route,
  pipeline, PDF, CSV, IRS Form 1040 PDF, AND the frontend ClientForm
  (with conditional MFS-lived-apart checkbox).
- **C11** — `docs/outreach/` packet: README, one-pager, cold-email
  templates, 12-min demo script, partner FAQ. No code.

**Current state: 1,630 assertions across 26 suites / 0 real failures
(1,597 testable + 33 AI-overlay env-gated).** Live at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com — production
smoke test verified K10 end-to-end (POST client w/ SS benefits →
calculator returns correct taxable SS).

## Commits this session

| Commit | Title |
|---|---|
| `4b96c75` | K5 closed — Self-Employed Health Insurance (Form 7206, Sched 1 L17) |
| `66c1572` | K6 closed — §121 home-sale exclusion ($250k/$500k) |
| `b0c1bee` | K3 closed — AMT × LTCG (Form 6251 Part III preferential rates) |
| `e3a4e07` | K10 closed — Social Security taxability worksheet (Pub 915) |
| `f34428e` | K10 fixup — wire CreateClientBody / UpdateClientBody schemas |
| `<latest>` | C11 — CPA design-partner outreach packet |

(Replace `<latest>` with the actual sha after final docs commit.)

## E2E verification (Pub 915 worked example, production)

```
POST /api/clients
  { ..., "socialSecurityBenefits": 48000 }
POST /api/clients/$CID/form1099data
  { taxYear: 2024, formType: "r", taxableAmount: 30000 }
POST /api/clients/$CID/form1099data
  { taxYear: 2024, formType: "int", interestIncome: 5000 }
POST /api/clients/$CID/tax-return
  { taxYear: 2024 }
GET  /api/clients/$CID/tax-return
  → totalIncome:    53750
    AGI:            53750
    ssBenefits:     48000.00
    ssTaxable:      18750.00  ✓ exact Pub 915 hand-calc
```

## Test impact this session

| Suite | Before session | After session |
|---|---|---|
| deep-audit | 125 | **170** (+45 from K3, K5, K6, K10 hand-calc cases) |
| accuracy-audit | 85 | **86** (+1 from K3 D2 path-2 sub-check) |
| scenarios | 95 | 95 (no test changes) |
| (other 22 suites) | unchanged | unchanged, all 0 failures |
| **TOTAL** | **1,584** | **1,630** |

Federal-engine gaps in deep-audit suite: **10 → 6.**
State-engine gaps: 4 (unchanged).

## EC2 deploy (completed this session)

```
ssh ec2:~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
pnpm --filter @workspace/db run push      # added 8 columns: sehi_deduction, home_sale_gross_gain,
                                          #  home_sale_section_121_exclusion, home_sale_taxable_gain,
                                          #  social_security_benefits, social_security_taxable on
                                          #  tax_returns; social_security_benefits +
                                          #  mfs_lived_apart_all_year on clients.
pnpm --filter @workspace/api-server run build
pm2 restart taxflow

# Frontend (K10 added new ClientForm fields):
# Local
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/

curl http://localhost:8080/api/healthz   # {"status":"ok"}
```

Production smoke test confirmed K10 working end-to-end against the
live Neon DB.

## Next session — recommended priorities

**Option A — close remaining K-list gaps:**
- **K4 NOL carryforward** (post-TCJA 80% limit) — moderately common
  for businesses transitioning out of losses, ~3 days.
- **K8 Kiddie tax** (Form 8615) — common on filers with children's
  unearned income > $2,600, ~2 days.
- **K9 FEIE §911** ($126,500 TY2024 + stacking rule) — expat filers,
  ~2-3 days.
- **K7 §1202 QSBS** ($10M / 10× basis exclusion) — tech-founder
  liquidity events, ~3 days.
- **K1 MFJ sub-gap** — per-spouse W-2/SE attribution. Data-model
  change required (clients/W-2s/SE rows need a `spouse: number` field
  identifying which spouse). ~3-5 days.
- **K10 state-SS exclusion** — engine over-taxes SS at the state
  level for the 41 jurisdictions that exempt SS. Per-state opt-out
  flag in stateTaxData.ts, ~2 days.

**Option B — close state-engine gaps:**
- **G1 NYC EITC sliding scale** (30/25/20/15/10% by NYAGI band on
  top of NY state 30% EITC piggyback). ~1 day.
- **G2 MN $1,750/child refundable CTC** (independent of WFC).
  ~1 day.
- **G4 WA 7% LTCG excise** (> $262k indexed). ~1 day.
- **G5 CA AMT (Schedule P 540)** (7% flat AMT after exemption).
  ~2 days.

**Option C — CPA partner outreach (C11 next step):**
The packet exists in `docs/outreach/`. Pick 5–10 target firms (state
CPA society listings, LinkedIn, referrals). Send the short-form
cold email from `docs/outreach/cold-email.md`. Track responses in a
spreadsheet. Have the demo script (`demo-script.md`) and validation
packet ready for any positive response.

**Option D — Phase D (multi-tenancy, encryption, billing):**
Only once a paid design partner is committed and explicitly asks
for it. D15 (CPA-firm auth), D17 (PII encryption at rest with S3 +
KMS), D18 (Stripe billing) — see roadmap.

**Option E — C13 LIVE benchmark completion:**
Re-run the AI extraction benchmark on the full 100-doc corpus once
Gemini free-tier quota resets or paid quota is set up.

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these four files first, in order:
  1. .claude/handoff.md           — K3 + K5 + K6 + K10 closures + outreach packet (this session)
  2. docs/accuracy-audit/deep-audit-2026-05-23.md — the full deep audit report
  3. .claude/roadmap.md           — Phase D / E / Phase 5 plan, updated K-list
  4. CLAUDE.md                    — invariants + the updated K-list (6 federal gaps open)

Where we left off: K1+K2 (2026-05-23 PM) and K3+K5+K6+K10 (2026-05-24)
all closed and deployed. 1,630 assertions across 26 suites, 0 real
failures, 6 federal-engine gaps + 4 state-engine gaps + 1 MFJ K1
sub-gap + 1 state-SS sub-gap documented. CPA outreach packet drafted
in docs/outreach/.

This session, pick ONE:

  Option A — Close another K-list engine gap. Remaining federal:
    K4 NOL carryforward (post-TCJA 80% limit; ~3 days)
    K8 Kiddie tax (Form 8615; ~2 days)
    K9 FEIE §911 (expat earned income; ~2-3 days)
    K7 §1202 QSBS (tech founder liquidity; ~3 days)
    K1 MFJ sub-gap (per-spouse SE attribution; data-model change; 3-5 days)
    K10 state-SS exclusion (per-state opt-out flag; ~2 days)
  Each has its failing assertion in deep-audit-tests.ts.

  Option B — Close one of the 4 state-engine gaps:
    G1 NYC EITC sliding scale (~1 day)
    G2 MN $1,750/child refundable CTC (~1 day)
    G4 WA 7% LTCG excise > $262k (~1 day)
    G5 CA AMT Schedule P 540 (~2 days)

  Option C — Begin CPA design-partner outreach (C11). No code. The
  packet is in docs/outreach/. Pick 5-10 target firms, send the
  short-form cold email from docs/outreach/cold-email.md.

  Option D — Phase D multi-tenancy auth (D15), only once a paid
  design partner is committed and explicitly asks for it.

  Option E — Finish C13 LIVE AI-extraction benchmark on the full
  100-doc corpus (needs Gemini paid quota or free-tier reset).

Quality bar (same as prior sessions):
- Each item ships as its own commit
- All 26 existing suites must stay at 0 real failures (25 testable;
  AI-overlay env-gated)
- Update roadmap.md / CLAUDE.md / handoff.md at session end
- Deploy to EC2 at the end
```
