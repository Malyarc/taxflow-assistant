# Handoff Note — 2026-05-27 PM (C-batch v3 — finishes all remaining C2/C9/C10/C11)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked.

The coverage map (per-state + per-feature) lives in
**`docs/coverage-matrix.md`** — read before planning state or federal
coverage work.

The planning strategy audit lives in **`docs/planning-strategy-audit.md`**
— all 97 catalog strategies verified for IRC + TY2024/2025 limits.

After this session, open sections:
- **A** — strategic / business (A1 outreach, A2 D15 auth, A3 D18 Stripe)
- **B** — Phase H ✅ FULLY COMPLETE + **H1 CATALOG CLOSED at 97 strategies**.
- **C** — engine coverage push — **C2/C9/C10/C11 now ALL SHIPPED.** **C3
  shadow-CPA validation also shipped** — see `docs/c3-design-partner-validation-2026-05-27.md`.
  Result: conditional approval. Tier-1 blocker = §199A QBI auto-detection
  (Sch C + K-1 Box 1). Live CPA partner still recommended for final
  cross-software validation against UltraTax CS / Lacerte.
- **D** — infra / security hardening (TLS, S3, soft-delete, etc.)
- **E** — reactive / deferred (only when a customer asks)

Read `docs/todo.md` BEFORE picking a task.

## Headline

**C-batch v3 shipped 2026-05-27 PM — completes all remaining C-batch work in one session:**

- **C2** Top-10-state credits — expanded from 3 states (NY/CA/IL with 7
  credits) to **10 states with 31 credits**. NEW: MA (4 — Senior Circuit
  Breaker, DMOH, LIC, Lead Paint Removal), NJ (3 — Property Tax Credit,
  CDCC, Senior-Disabled PTC), OH (2 — Joint Filing Credit, Senior Citizen
  Credit), PA (2 — Special Tax Forgiveness Sched SP, Working Family Tax
  Credit), VA (2 — Low-Income Tax Credit, Credit for Tax to Other State),
  GA (3 — Low-Income, Retirement Income Exclusion, Disabled Home Purchase),
  MI (2 — Homestead PTC, Home Heating Credit).
- **C9** PA local EIT — expanded from 13 to **~175 PA municipalities**.
  New `paEitRates.ts` registry module + `scripts/data/pa-eit-rates.csv`
  source-of-truth. New `lookupPaLocalEit()` function with PSD-code AND
  name-keyed access. Inline LOCAL_TAX_DATA top-13 preserved as fast-path.
- **C10** OH SDIT — expanded from 15 to **~226 OH school districts**.
  New `ohSchoolDistricts.ts` registry + CSV. Supports both `earned_income`
  AND `traditional` (OH IT-1040 Line 3) bases. New `oh_traditional` base
  type. New `oh_sdit_traditional_base` adjustment for CPA-supplied
  exact-Line-3 value.
- **C11 deeper** — Per-K-1 + per-rental source-state allocation. NEW
  fields `sourceState` on `ScheduleK1Fact` + `RentalPropertyFact`. NEW
  adjustment marker `part_year_use_full_source_allocation` supersedes
  `part_year_use_w2_source`. When enabled: K-1 + rental net income flows
  to source state, intangibles still pro-rate to resident state by days
  (standard residency rule).
- **OpenAPI** — added 14 new adjustment types to enum (`ma_assessed_home_value`,
  `ma_water_sewer_half`, `ma_lead_paint_removal_cost`, `ca_renter_months`,
  `k12_education_expenses`, `college_tuition_qualified`, `annual_rent_paid`,
  `part_year_use_w2_source`, `part_year_use_full_source_allocation`,
  `pa_eligibility_income`, `ga_disabled_home_purchase_cost`, `mi_home_heating_cost`,
  `mi_household_resources`, `oh_sdit_traditional_base`). Regenerated
  api-zod + api-client-react codegen.

**Verification:**
- **122 NEW hand-calc'd assertions** across 3 new test files (67 + 35 + 20)
- All 40+ existing test suites green (no regressions)
- API verified end-to-end (MA Senior Circuit Breaker $2,730 refund delta;
  PA Williamsport bulk lookup $1,425; OH SDIT bulk lookup $487.50)
- UI verified live in dev environment (no console runtime errors)

## Commits this session

| Commit | Item |
|---|---|
| (this commit) | C-batch v3 — finishes C2 (top-10-state credits) + C9 (~175 PA munis) + C10 (~226 OH SDs) + C11 deeper (per-K-1 + per-rental source-state) + OpenAPI enum expansion + codegen regen + 122 new hand-calc'd assertions + docs updates |

## Test state (final — all green)

| Suite | Result |
|---|---|
| tax-engine-tests | ✓ |
| tax-engine-deep-tests | ✓ |
| tax-engine-planning-tests | 455/455 |
| tax-engine-whatif-tests | 169/169 |
| tax-engine-c2-state-credits-tests | 26/26 (existing) |
| **tax-engine-c2-state-credits-v2-tests** | **67/67 (NEW)** |
| tax-engine-c9-c10-local-tax-tests | 17/17 (existing) |
| **tax-engine-c9-c10-bulk-tests** | **35/35 (NEW)** |
| tax-engine-c11-part-year-w2-tests | 11/11 (existing) |
| **tax-engine-c11-deeper-sourcing-tests** | **20/20 (NEW)** |
| (all other ~35 suites) | ✓ no regressions |

## Schema changes pushed to local DB (need EC2 push too)

NONE — all v3 work uses existing schema:
- New adjustment types are stored in the existing `adjustments.adjustment_type`
  TEXT column (no DB migration)
- New `sourceState` field on K1/Rental facts is read from the Drizzle row's
  optional `sourceState` column. If the column doesn't exist in the DB yet,
  the field is silently undefined (engine falls back to pro-rata).
- New TS modules `paEitRates.ts` + `ohSchoolDistricts.ts` are pure-data
  + lookup functions; no DB needed.

OpenAPI changes: 14 new adjustment-type enum values (additive). Old types
still accepted. Codegen regenerated; api-zod + api-client-react now expose
the new types.

**Future schema work to consider (NOT required for deploy):**
- Add `sourceState text` columns to `schedule_k1` + `rental_properties` tables
  to allow CPAs to enter source state via UI without using the engine-level
  workaround (currently the field is only readable from the engine; UI
  doesn't yet expose it).

## Deploy steps (for the user)

NO DB schema migration needed.

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')

# NO db push needed.
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
exit
```

Local frontend rebuild + rsync (codegen ran locally; needs to ship):
```bash
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

Verify by clicking through a few clients at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com:
1. Open a PA client → set localityCode to `PA-WILLIAMSPORT` (or any new bulk
   PA muni) → Tax Calculator tab → confirm local tax line shows the
   correct rate × wages.
2. Open an OH client → set localityCode to `OH-SD-1151` (Olentangy LSD) →
   confirm local tax appears.
3. Create a test adjustment with `adjustmentType: "ma_assessed_home_value"`
   (and `state_property_tax`) on an age-65+ MA client → confirm state
   refund jumps by up to $2,730 (MA Senior Circuit Breaker cap).

## Sub-gaps STILL OPEN after this session

C-batch sub-gaps (NOT addressed):
1. §163(j) ATI proxy — approximate; over-restricts high-depreciation
   low-income filers.
2. §461(l) auto-aggregation — engine accepts CPA-supplied addback.
3. §1031/§121 recognized gains don't flow into NIIT investment-income base.
4. Form 8824 PDF (§1031) + Form 8990 PDF (§163(j)) not rendered yet.

C2 v3 sub-gaps:
- MA Limited Income Credit uses approximate $8k × 1.75 = $14k ceiling
  formula. Real MA Schedule NTS-L might have slightly different per-status
  ceiling math; CPA should hand-check edge cases.
- NJ Property Tax Credit ships $50 base credit only — full $15,000 deduction
  alternative not modeled (CPA uses NJ-1040 Line 41 deduction path manually).
- PA Working Family Tax Credit is a placeholder; the actual 10% × federal
  EITC computation flows through the existing state-EITC piggyback path.
- VA Credit for Tax Paid to Other State is a placeholder; computed via the
  existing multi-state credit-for-tax-paid logic in `calculateMultiStateTax`.
- MI Home Heating Credit allowance formula ($565 + $200/exemption) is
  approximate; real MI-1040CR-7 has tier-specific allowances per exemption
  count.
- GA Retirement Income Exclusion is computed as `excluded × 5.39%` (top
  flat rate) — slightly over-estimates for low-bracket GA filers.

C9/C10 sub-gaps:
- PA EIT bulk registry covers top ~175 municipalities (~85% of PA filers).
  Remaining ~1,800+ minor munis fall through to "null" — CPA must use
  inline `PA-ACT32-DEFAULT` or pick the closest bulk entry.
- OH SDIT bulk registry covers ~226 districts. Real OH has ~615 districts;
  most missing ones don't levy SDIT (rate 0%) so engine silently returns 0.
- OH SDIT "traditional" base approximates as federalAgi − OH std ded.
  Real OH IT-1040 Line 3 also subtracts personal exemption. Engine
  over-applies tax by exemption × rate. Sub-gap: CPA can supply exact
  base via `oh_sdit_traditional_base` adjustment.

C11 deeper sub-gaps:
- K-1 / rental losses (negative sourced income) are clamped to 0 for
  source state to avoid edge-case negative-tax issues. Engine sub-gap.
- Intangibles always pro-rate to resident-state by days — engine doesn't
  yet implement situs-of-broker sourcing (rare; usually all-resident is
  correct).
- UI doesn't yet expose `sourceState` field on K-1 / rental editors —
  CPA has to use the engine-level adjustment marker for now. Follow-up:
  add field to schema + ClientDetail K-1/Rental forms.

## What's left (post-C-batch — strongest candidates)

### Tier-1 engineering blocker surfaced by C3 validation

**§199A QBI auto-detection** — the engine currently requires CPA to
manually enter `qbi_income` adjustment for Sch C net OR `section199aQbi`
on each K-1. Default behavior: QBI deduction = $0. Real CPA expectation:
QBI should apply automatically for pass-through income. Fix:

```ts
// In taxReturnEngine.ts, after computing seIncomeFromAdj:
const qbiIncomeAuto = qbiIncome > 0
  ? qbiIncome  // existing explicit value wins
  : Math.max(0, seIncomeFromAdj - se.deductibleHalf);  // auto from Sch C
// And for K-1s: default `section199aQbi = box1OrdinaryIncome` when
// activityType === "active" AND no explicit section199aQbi.
```

Then thread through §199A phase-in (single $191,950 / MFJ $383,900) and
SSTB flag (engine has SSTB infrastructure already). ~1 day of work.
**Highest-impact engineering item.**

### Other tier-2/3 fixes from C3

- CA personal exemption credit ($144 single / $288 MFJ + $446/dep) — add
  to `calculateStateAdditionalCredits`
- IL dependent exemption ($2,775/dep) — extend IL personal exemption
  multiplier
- NJ personal exemption ($1,000 filer / $1,500 dep) — add to `stateTaxData.ts`

### Strategic

1. **A1 — CPA outreach campaign** — packet complete; blocked on user
   availability. Highest revenue gate.
2. **D15 — multi-tenancy auth (2-3 wks)** — required before charging.
3. **D18 — Stripe billing (1-2 wks)** — depends on D15.
4. **UI follow-up** — expose `sourceState` on K-1 / rental forms;
   expose new MA/NJ/OH/PA/VA/GA/MI adjustment types in ClientForm.
5. **C3 — CPA design-partner validation** — needs user-recruited partner.

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. docs/todo.md                       — THE LIVE TODO
  2. docs/coverage-matrix.md            — Per-state + per-feature inventory
  3. .claude/handoff.md                 — Last session state
  4. CLAUDE.md                          — invariants, test-file list, closure log

Where we left off (2026-05-27 PM): **C-batch v3 SHIPPED — finishes ALL
remaining C-batch work** (C2 expansion to 10 states / 31 credits;
C9 PA bulk to ~175 munis; C10 OH SDIT bulk to ~226 SDs; C11 deeper
per-K-1 + per-rental source-state allocation). All 40+ test suites
green. UI + API verified live.

Top recommendation: **A1 CPA outreach** (packet complete; awaits user
availability). Alternative: **D15 multi-tenancy auth (2-3 wks)** —
required before charging. Then **D18 Stripe billing (1-2 wks)**.

If continuing C-batch / coverage work:
- UI exposure of new adjustment types on ClientForm.tsx
- UI exposure of `sourceState` on K-1 + Rental editors
- Bulk OH municipal city tax expansion (only 10 inline today)
- Beyond-top-10 state credits (NC, AZ, OK, etc. — only when CPA asks)

Quality bar:
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update docs/todo.md / .claude/handoff.md / CLAUDE.md at session end
- Deploy to EC2 at the end (git pull + api-server build + pm2 restart
  + local frontend build + rsync; NO db push needed unless schema
  changes)
```
