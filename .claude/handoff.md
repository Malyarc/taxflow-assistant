# Handoff Note — 2026-05-20

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## What landed this session

Seven commits pushed to `origin/main` between `92fb5b7` (Phase 1.5 baseline) and `9a9a117`:

| Commit | What |
|---|---|
| `0fe0e42` | **Engine/adapter split**: `computeTaxReturnPure()` extracted to `taxReturnEngine.ts` — Haven-portable, no DB, no Drizzle |
| `97a66b1` | **Phase 2b + 2c**: Capital loss $3k cap with cross-netting + short/long carryforward (IRC §1211, Sched D); PA/IL/MS state retirement-income exemptions |
| `c373f3f` | **Phase 2d**: Multi-state foundation — 17-state reciprocity table + resident credit-for-tax-paid + per-W-2 state allocation |
| `57413e6` | **Phase 2e**: Schedule E rental real estate + MACRS depreciation (27.5/39 yr SL mid-month) + §469 PAL with $25k allowance + MAGI phase-out |
| `8f0fb12` | **Phase 3 + UltraTax**: Form 1040-style PDF + CSV (CPA-tool friendly) + JSON + UltraTax `.gen` exports; frontend download buttons for all 4 |
| `c5c4976` | **Sched B + 50-state suite**: per-payer 1099-INT/DIV aggregation + 187-assertion 50-state validation |
| `9a9a117` | **Frontend UX**: rental participation flags + Phase 2 adjustment-type labels + Tax Liability breakdown lines |

## Test state: 959 / 0 across 14 suites

| Suite | Count | Needs API |
|---|---:|---|
| `tax-engine-tests.ts` | 193 | no |
| `tax-engine-deep-tests.ts` | 37 | no |
| `tax-engine-phase1-unit-tests.ts` | 44 | no |
| `tax-engine-phase15-unit-tests.ts` | 90 | no |
| `tax-engine-pure-tests.ts` | 27 | no (pure engine — proves Haven portability) |
| `tax-engine-phase2-unit-tests.ts` | 104 | no |
| `tax-engine-50state-tests.ts` | 187 | no |
| `tax-engine-integration-tests.ts` | 22 | yes |
| `tax-engine-deep-integration-tests.ts` | 26 | yes |
| `tax-engine-new-features-tests.ts` | 23 | yes |
| `tax-engine-phase1-integration-tests.ts` | 55 | yes |
| `tax-engine-phase15-integration-tests.ts` | 33 | yes |
| `tax-engine-exports-tests.ts` | 25 | yes |
| `tax-engine-scenarios.ts` | 93 | yes |

**Every test value is hand-calced against IRS published rules.** If a test fails, the calculator is usually right and the expected value needs verification.

## Adjustment-type enum is now 38 values

`deduction, credit, additional_income, withholding_adjustment, other, self_employment_income, investment_income, qbi_income, amt_preferences, medical_expenses, state_income_tax, state_property_tax, state_sales_tax, mortgage_interest, charitable_cash, charitable_property, hsa_contribution, ira_contribution_traditional, ira_contribution_roth, schedule_c_expenses, dependent_care_expenses, qualified_education_expenses_aoc, qualified_education_expenses_llc, retirement_contributions_savers, educator_expenses, student_loan_interest, foreign_tax_paid, residential_clean_energy, energy_efficient_home, energy_efficient_heatpump, ev_charger_property, capital_loss_carryforward_short, capital_loss_carryforward_long, schedule_e_rental_income, schedule_e_rental_expenses, schedule_e_macrs_depreciation, schedule_e_passive_loss_carryforward`

## Real-world readiness — honest assessment

### Production-quality
- Federal tax calc for W-2/SE filers across all 50 states + DC
- Federal credits: CTC, EITC, education (AOC/LLC), dep care, saver's, foreign tax (simplified), residential energy (§25D + §25C + §30C)
- Schedule A itemized (medical 7.5% threshold, SALT $10k cap, mortgage, charitable AGI limits)
- Schedule C net SE income
- Above-the-line: HSA, traditional IRA (with workplace-plan phase-out), SLI (with MAGI phase-out), educator
- ACA Premium Tax Credit with advance APTC reconciliation + repayment caps
- AMT, NIIT, SE tax
- LTCG/QDIV preferential rates
- Multi-state with reciprocity + resident credit
- Capital gain/loss netting + $3k ordinary cap + carryforward
- State retirement exemptions (PA/IL/MS)
- Oregon Form 40 Line 13 federal-tax-paid subtraction
- 959 hand-calced tests

### MVP-quality (works but with approximations)
- **ACA MAGI** ≈ AGI (doesn't add back tax-exempt interest, foreign earned income exclusion, non-taxable Social Security)
- **Foreign Tax Credit** — simplified <$300/$600 path only; over-limit cases use full paid amount without Form 1116 limit
- **Schedule E** — adjustment-based aggregates (not per-property); MACRS calculator exists separately
- **§469 PAL** — uses provisional AGI as MAGI (close approximation per IRS Pub 925 worksheet)
- **State retirement exemption** — only PA/IL/MS; HI/NJ/NY partial exemptions not modeled
- **Capital loss carryforward** — manual entry via adjustments (no auto-load from prior year's `tax_returns` row)
- **Non-resident state tax** — uses resident-style brackets on allocated wages (slightly overstates; many states have NR-specific rules)
- **§25C sub-caps** — windows $600 / doors $250 / audit $150 collapsed into the general $1,200 cap
- **PA/MS age 59½ → integer 60** — loses few birth-month-1 edge cases

### NOT built (would be needed for production filing)
- **E-filing** (separate IRS ERO approval, ~9-month track)
- **Actual IRS Form 1040 PDF layout** (we output a clean summary, not the IRS form template)
- **Schedule D per-transaction detail + wash sale tracking**
- **Per-property rental tracking** (`rental_properties` table sketched in commit notes)
- **Part-year residency** for multi-state filers
- **Local income taxes** (NYC, MD counties, OH cities, IN counties)
- **State EITC, state CTC** (vary widely; each state has its own rules)
- **AMT preferences detail** (state-tax addback, ISO bargain element, etc.)
- **K-1 detail** (partnership / S-corp pass-through)
- **Trust/estate (1041), partnership (1065), corporate (1120/1120-S)**
- **Auth / multi-user / multi-tenancy**
- **Security audit** (HIPAA / SOC 2 / data encryption at rest)
- **Real document upload** (demo banner still says "do not upload real tax documents")

### Bottom line
| Use case | Ready? |
|---|---|
| **Internal CPA review / what-if scenarios** on simple-to-moderate W-2/1099 returns | ✅ Yes |
| **Calculation engine for another product (Haven App)** | ✅ Drop-in, pure function |
| **Demo / prototype for CPA conversations** | ✅ Yes |
| **Consumer DIY filing (Option B)** | ❌ Needs interview UI, e-file, ERO approval |
| **Actual paid tax preparation by a CPA** | ❌ Needs real IRS form output, audit trail, security |

The calc engine could power a real product. The current frontend is admin/review, not consumer-facing.

## How to deploy this session's work to EC2

Schema changed (5 new tax_returns columns + 7 new adjustment enum values + 2 new client fields). Standard cycle:

```bash
ssh ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com '
  cd ~/taxflow-assistant &&
  git checkout -- pnpm-lock.yaml &&
  git pull &&
  pnpm install &&
  set -a && source ~/.env && set +a &&
  pnpm --filter @workspace/db run push &&
  pnpm --filter @workspace/tax-app run build &&
  pnpm --filter @workspace/api-server run build &&
  pm2 restart taxflow &&
  curl -s http://localhost:8080/api/healthz
'
```

**Note: `pnpm --filter @workspace/db run push` will add new columns/fields without losing data** (Drizzle uses ALTER TABLE for additive changes). It's safe to run.

## How to start the next Claude session

Just say: **"Read .claude/handoff.md and CLAUDE.md. What should we work on next?"**

That triggers the documented context-loading dance. The next Claude will pick up from this handoff.

If you want to work on something specific, say:
- **"Continue Phase 2: implement Schedule D per-transaction detail with wash sale tracking"**
- **"Start integrating the tax engine into Haven App. Here's the Haven repo: <path>"**
- **"Improve the frontend — make ClientForm collapse the Phase 1.5/2 sections by default"**
- **"Add Schedule D and Schedule E PDFs as separate downloads"**

## Where to pick up next session — ranked by value

### High-value, small-effort
1. **Auto-load capital loss carryforward from prior year's `tax_returns` row** (~30 min). Manual entry currently. Would close the carryforward loop.
2. **Year Compare currently doesn't show new Phase 2 lines** — quick check that all rental/cap-loss/state-retirement fields appear in YearCompare component (~1 hour).
3. **Refresh the `cd40d3b` ghost** — main has a CLAUDE.md commit but the worktree dump was dropped from git history. Verify .claude/handoff.md is current.

### High-value, medium-effort
4. **Per-property rental table** (`rental_properties` schema). Today rental data is aggregate adjustments. Real CPAs want per-property tracking + per-property MACRS auto-calc. ~1 day.
5. **Schedule D per-transaction detail** (`capital_transactions` table). Enables wash sale detection. ~2-3 days.
6. **Actual IRS Form 1040 PDF layout** using `pdf-lib` to fill the official IRS template at coordinates. ~2 days.

### Big bets
7. **Haven App integration** — engine is now Haven-portable via `computeTaxReturnPure(inputs)`. Need: Haven's stack, ORM, auth model, multi-tenancy approach. Could be days or weeks depending on integration depth.
8. **Phase 4 strategic commit** — Option A (CPA tool with import adapters) vs Option B (consumer DIY with e-file). Big strategic decision. The current state supports both paths.

### Maintenance items
9. **Vermont approximation** — VT calc uses 0 personal exemption + no taxable-SS modeling. Acknowledged in stateTaxData.ts notes.
10. **NR-state tax overstatement** — non-resident state computation uses resident brackets. To fix correctly, each state's NR rules (e.g., NY IT-203, CA 540NR) would need separate modeling.

## Critical reminders for next session

- **Hand-calc every test value** — the user has been burned by tests passing while calc was wrong (CLAUDE.md)
- **Adding test files** also requires adding to `scripts/tsconfig.json`'s `exclude` array
- **api-server typecheck stalls** — delete `lib/db/dist/` + `lib/db/tsconfig.tsbuildinfo`, then `pnpm --filter @workspace/db exec tsc -b --force`
- **Money fields use `<CurrencyInput>`** never `<Input type="number">`
- **Radix Select edit-mode** needs the `formReady` gate (see `ClientForm.tsx`)
- **shadcn Tabs** dispatch `mousedown` + `click` MouseEvents when clicking programmatically
- **EC2 `git pull` conflicts** on `pnpm-lock.yaml` every time — `git checkout -- pnpm-lock.yaml` first

## Background processes still running locally

These may need restart in a new session:
- API server on `:8080` (last started via `node ./artifacts/api-server/dist/index.mjs` background task — killed by session restart)
- Frontend preview on `:3010` (started via `preview_start`)
- Postgres in Docker container `haven-postgres` (shared with another project; user `brookhaven`, db `taxflow_pro` — both created by us)

Restart API server:
```bash
DATABASE_URL=postgres://brookhaven:brookhaven@localhost:5432/taxflow_pro \
  AI_API_KEY=dummy PORT=8080 \
  node /Users/johntang/Documents/taxflow-assistant/.claude/worktrees/admiring-lehmann-e51bf4/artifacts/api-server/dist/index.mjs
```

Restart frontend:
```bash
pnpm --filter @workspace/tax-app run dev
# or use the preview server: invoke preview_start with name "frontend"
```
