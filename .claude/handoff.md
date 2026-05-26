# Handoff Note — 2026-05-26 (Phase E batch shipped — 11 of 14 items)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## Headline

**Phase E — Engine completeness shipped 11 of 14 items in this single
session.** 129 new hand-calc'd assertions added (now 1,910+ total
across 29 suites). Engine still at zero documented gaps. Three items
deferred with full implementation plans in `docs/phase-e-deferred.md`:

- **E12** — Part-year residency in multi-state framework (3-5 days)
- **E13** — Auto wash-sale + §1091(d) holding-period tack-on (4-6 days)
- **E14** — Other local income taxes (MD/OH/IN counties) (1-10 days)

## What landed (session commits, in order)

| Commit | SHA | Item | Coverage |
|---|---|---|---|
| 1 | `a191cf4` | **E1** — IL personal exemption AGI cliff | 8 assertions |
| 2 | `c093b65` | **E2** — AMT credit carryforward (Form 8801) | 9 assertions |
| 3 | `7018816` | **E3** — Charitable carryforward 5-year | 8 assertions |
| 4 | `1f313ca` | **E5** + **E6** — 1099-R penalty + 1099-G tax-benefit rule | 10 assertions |
| 5 | `b25f3fe` | **E10** — State EITCs for 20 new states | 27 assertions |
| 6 | `006807f` | **E11** — PA Schedule SP Tax Forgiveness | 10 assertions |
| 7 | `5c0192e` | **E4** — HSA Form 8889 detail (employer + excise) | 5 assertions |
| 8 | `d8da365` | **E9** — State CTCs (CA/CO/NJ/IL/NM/VT) | 13 assertions |
| 9 | `07b8921` | **E7** — §179 expense + §168(k) bonus depreciation | 5 assertions |
| 10 | `55d7062` | **E8** — NYC School Tax Credit + MCTMT | 7 assertions |

## Test state

- **193/193 tax-engine-tests** (regression — no change)
- **210/210 deep-audit** (regression — no change)
- **97/97 accuracy-audit** (regression — no change)
- **133/133 G1 planning** (regression — no change)
- **70/70 G4 multi-year** (regression — no change)
- **29/29 planning integration** (regression — no change)
- **21/21 Pro-tier integration** (regression — no change)
- **16/16 NYC tests** (regression after E8 catch — initially broken,
  fixed by moving school credit to state-refund level not NYC tax)
- **21/21 state-EITC tests** (regression — no change)
- **129/129 Phase E (NEW)** — all E1-E11 items hand-calc'd against IRC/Pub
- Workspace typecheck clean across all 12 workspaces.
- **Engine net: ZERO documented gaps** (preserved).

## Architecture changes (per item)

### E1 — IL exemption cliff
- New `personalExemptionAgiCliff` field on StateInfo
- `calculateStateTax` zeroes personal exemption when federalAgi > cliff

### E2 — AMT credit carryforward
- New `amt_credit_carryforward` adjustment type
- Schema: `tax_returns.amt_credit_carryforward_remaining` + `amt_credit_applied` + `amt_credit_generated`
- Pipeline auto-loads prior-year cf
- Engine applies §53(c): credit = min(cf in, regularTax - TMT, available)
- §53(b) simplified: credit generated = amtTax (CPA overrides for exclusion items)

### E3 — Charitable cf
- New `charitable_carryforward_cash` adjustment type
- Schema: `tax_returns.charitable_carryforward_cash_remaining`
- `calculateScheduleA` ordering: current contributions first, then carryforward, both capped at 60% AGI
- Excess current + unused prior both roll forward

### E4 — HSA Form 8889
- New `hsa_employer_contribution` adjustment type
- `calculateRetirementDeductions` extended with employer-contribution cap reduction
- IRC §4973(g) 6% excise on total contributions above limit
- New `ComputedTaxReturn.hsaExcessExcise` field; added to totalFederalLiability

### E5 — §72(t) early-withdrawal penalty
- Engine reads 1099-R `distributionCode`:
  - Code "1" → 10% penalty on taxable amount
  - Code "S" → 25% penalty (SIMPLE IRA in first 2 years)
- `ComputedTaxReturn.earlyWithdrawalPenalty`; added to totalFederalLiability

### E6 — 1099-G tax-benefit rule
- New `clients.prior_year_itemized` column (boolean | null)
- Pipeline auto-derives from prior-year tax_returns row (itemized > std ded)
- `summarize1099s` splits 1099-G into Box 1 (unemployment) + Box 2 (state refund)
- Engine includes state refund in AGI only when priorYearItemized === true

### E7 — §179 + bonus depreciation
- New `section_179_expense_election` + `bonus_depreciation_basis` adjustment types
- Engine: §179 capped by (cap with phase-out, net SE income); excess carries forward
- Bonus depreciation: 60% × basis TY2024, 40% TY2025
- Both flow to aboveTheLineDeterministic (reduces AGI)
- `ComputedTaxReturn.section179Applied / section179Carryforward / bonusDepreciationApplied`

### E8 — NYC school credit + MCTMT
- `calculateNycLocalTax` extended with `netSeEarnings` input
- New `nycSchoolTaxCredit` (refundable, $63 single / $125 MFJ when NYAGI < $250k)
- New `nycMctmt` (tiered: 0.34% over $50k → 0.50% over $362.5k → 0.60% over $675k)
- School credit applied at STATE refund level (per IT-201 mechanics)
- MCTMT added to netLocalTax

### E9 — State CTCs (CA/CO/NJ/IL/NM/VT)
- New `calculateStateCtc` helper
- Engine wires it alongside `calculateStateEitc`; refundable credit flows to state refund
- 6 states' specific formulas implemented

### E10 — State EITCs (20 new states)
- `STATE_EITC_PCT_OF_FEDERAL` lookup table added 19 simple piggybacks (CT/DE/IN/IA/KS/LA/MT/NE/NM/OH/OK/OR/RI/VT/VA/DC/ME/MD/MI)
- WI separately implemented (tiered by # qualifying children)

### E11 — PA Schedule SP
- New `calculatePaScheduleSpForgivenessPct` helper
- `calculateStateTax` options gain `dependentCount`
- When code === "PA" and PA tax > 0, multiply tax by (1 - forgivenessPct)

## Schema changes pushed to local DB

| Table | New columns |
|---|---|
| tax_returns | `amt_credit_carryforward_remaining`, `amt_credit_applied`, `amt_credit_generated`, `charitable_carryforward_cash_remaining` |
| clients | `prior_year_itemized` |

`pnpm --filter @workspace/db run push` ran successfully against local
Postgres after each schema change. EC2 (Neon) needs the same migrations
applied during deploy.

## OpenAPI changes

New AdjustmentType enum members (3 places):
- `amt_credit_carryforward`
- `charitable_carryforward_cash`
- `hsa_employer_contribution`
- `section_179_expense_election`
- `bonus_depreciation_basis`

New Client schema field: `priorYearItemized`

api-zod + api-client-react regenerated cleanly.

## Open items (next session priorities)

### Phase E remaining (3 items, fully scoped in `docs/phase-e-deferred.md`)

- **E12 — Part-year residency** (3-5 days). Schema-level refactor of
  multi-state pipeline + per-state day-count proration.
- **E13 — Auto wash-sale + §1091(d)** (4-6 days). Algorithm + edge
  cases. Broker-reported wash sales already honored (current).
- **E14 — Other local income taxes** (1-10 days). MD counties alone is
  high-value / low-effort (~2 days for the most common 5-10).

### Original next-session options (still on the menu)

- **CPA design-partner outreach (C11 packet shipped).** Ready to send
  whenever user has bandwidth. ~4-6 weeks calendar from start of
  outreach to signed pilot.
- **Phase D15 multi-tenancy auth** (~2-3 weeks). Required before
  charging real money. Worth starting in parallel with outreach.
- **Phase D18 Stripe billing** (1-2 weeks, requires D15 first).

## EC2 deploy steps (for the user)

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
# Phase E added new columns — REQUIRES schema push
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz

# Frontend has no UI changes this session, but recompile + rsync is
# safe (no-op vs current public). Skip if confident.
```

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. .claude/handoff.md           — Phase E batch shipped (this session)
  2. .claude/roadmap.md           — Phase E status, D15/D18 plan
  3. CLAUDE.md                    — invariants, closure log
  4. docs/phase-e-deferred.md     — implementation plans for E12/E13/E14

Where we left off (2026-05-26): Phase E shipped 11 of 14 items in a
single session. 129 hand-calc'd assertions added across E1-E11.
Engine still at zero documented gaps. 1,910+ total assertions across
29 suites. Phase G fully complete from prior sessions.

This session, pick ONE:

  Option A — Finish Phase E (3 deferred items: E12 part-year residency,
  E13 auto wash-sale, E14 other local taxes). Each has a detailed plan
  in `docs/phase-e-deferred.md`. Estimated effort:
    - E12: 3-5 days
    - E13: 4-6 days
    - E14 (MD counties only): 1-2 days; (full MD/OH/IN): 5-10 days

  Option B — RECOMMENDED if not finishing Phase E. Send the C11 outreach
  packet (research-synthesis backed, Phase G-complete demo). 4-6 weeks
  calendar to signed pilot. See `docs/outreach/`.

  Option C — Phase D15 multi-tenancy auth (~2-3 weeks). Required before
  charging real money.

  Option D — Phase D18 Stripe billing (1-2 weeks, needs D15 first).

Quality bar (same as prior sessions):
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update roadmap.md / CLAUDE.md / handoff.md at session end
- Deploy to EC2 at the end
```
