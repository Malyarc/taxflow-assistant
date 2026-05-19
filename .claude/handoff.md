# Handoff Note — 2026-05-12

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## What we accomplished

Two commits landed on `main` and were deployed to EC2:

1. **[7738ed8](https://github.com/Malyarc/taxflow-assistant/commit/7738ed8)** — **Phase 1 completion.** All 6 scaffolded calculator functions piped through the pipeline, with Schedule C expenses also wired in. End-to-end coverage: Schedule A itemized line items (medical 7.5% / SALT $10k cap / mortgage / charitable AGI limits / sales-tax option), Schedule C (expenses subtracted from gross 1099-NEC before SE tax), EITC (refundable, all phase-in/plateau/phase-out tiers, MFS-ineligible, $11,600 investment income cap), education credits (AOC 100/25 split with 60% NR + 40% R, LLC 20% × $10k; phase-out $80–90k single, $160–180k MFJ), HSA + IRA traditional above-the-line deductions with workplace-plan AGI phase-out, saver's credit (50/20/10% AGI tiers), dependent care credit (35→20% AGI rate, MFJ requires both earning, $3k/$6k cap). Schema added 6 client fields + 13 tax_return line-item columns. OpenAPI added 14 adjustment types and exposed the new client fields through CreateClientBody/UpdateClientBody. Frontend got new ClientForm fields (taxpayer/spouse age, dep-care-credit count, spouse earned income, HSA family flag, IRA workplace-plan flag) and a per-line Tax Liability breakdown.

2. **[456aa42](https://github.com/Malyarc/taxflow-assistant/commit/456aa42)** — **Two demo bugs.** (a) Iowa state tax was using the pre-2023 IA std deduction ($2,630/$6,480); Iowa Code §422.9 was reformed in 2022 to conform IA to the federal value. Fix: added `"IA"` to `FED_CONFORMING_STD_DED_STATES` and seeded its 2024 std ded from `FED_STD_DEDUCTION_2024`. Impact ~$680 less IA tax for a single filer at $80k. (b) State `<Select>` dropdown didn't scroll for the 51-state list; `max-h-[--radix-select-content-available-height]` could compute past the viewport. Fix: bound `SelectContent` at `max-h-96` so Radix's scroll-up/down chevrons and mousewheel both work.

## Current state

**Tests:** 8 suites, **489 assertions, 0 failures** (was 349 at session start; +137 for Phase 1, +3 for the Iowa fix).

| Suite | Count | Needs API server |
|---|---:|---|
| `tax-engine-tests.ts` | 193 | no |
| `tax-engine-deep-tests.ts` | 37 | no |
| `tax-engine-phase1-unit-tests.ts` | 44 | no |
| `tax-engine-integration-tests.ts` | 22 | yes |
| `tax-engine-deep-integration-tests.ts` | 22 | yes |
| `tax-engine-new-features-tests.ts` | 23 | yes |
| `tax-engine-scenarios.ts` | 93 (23 scenarios) | yes |
| `tax-engine-phase1-integration-tests.ts` | 55 | yes |

**Deployment:** Live on EC2 at `http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com`. Both commits deployed; Neon schema push completed. Standard cycle (from project root on EC2):

```bash
cd ~/taxflow-assistant
git checkout -- pnpm-lock.yaml && git pull
pnpm install
set -a; source ~/.env; set +a
pnpm --filter @workspace/db run push         # only if schema changed
pnpm --filter @workspace/tax-app run build
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
```

**Local dev:** Docker Postgres `brookhaven-postgres` on `:5432`, db `taxflow_pro`. Connection string:
```
postgres://brookhaven:brookhaven@localhost:5432/taxflow_pro
```
Run the API server with `DATABASE_URL=… AI_API_KEY=dummy PORT=8080 node ./artifacts/api-server/dist/index.mjs` (after `pnpm --filter @workspace/api-server run build`).

**Adjustment type enum** is now 23 values (was 9): `deduction, credit, additional_income, withholding_adjustment, other, self_employment_income, investment_income, qbi_income, amt_preferences, medical_expenses, state_income_tax, state_property_tax, state_sales_tax, mortgage_interest, charitable_cash, charitable_property, hsa_contribution, ira_contribution_traditional, ira_contribution_roth, schedule_c_expenses, dependent_care_expenses, qualified_education_expenses_aoc, qualified_education_expenses_llc, retirement_contributions_savers`.

## Key decisions

1. **Credit ordering in the pipeline follows IRS Form 1040.** Non-refundable credits apply against `regularFederalTax + amtTax` (the "income tax" portion only, not SE/NIIT) in this order: CTC non-refundable → Saver's Credit → Education AOC non-refundable → LLC → Dependent Care. Then refundable credits (EITC, AOC refundable, ACTC) add directly to the refund. Each non-refundable credit is capped at the running remaining tax. Why: matches Schedule 3 ordering exactly and prevents over-crediting against SE tax. The pipeline still stores the *eligibility* amount in DB columns (matching the calculator's output for saver's, dep-care, etc.) — the refund formula does the capping. This is a deliberate tradeoff: if a user qualifies for a $1,000 saver's credit but only $340 of tax to apply against, `r.saversCredit` reads `1000` (what they qualified for) while the actual federal refund correctly only reflects $340 applied. Future polish: split eligibility vs. applied into separate columns.

2. **IRA phase-out uses MAGI ≈ AGI-before-IRA.** Per IRS Pub 590-A, the AGI used for the IRA-deduction phase-out is computed *without* the IRA deduction itself (chicken-and-egg). Pipeline does this by computing above-the-line deductions excluding IRA first, deriving a provisional AGI, then computing the IRA deduction against that, then final AGI subtracts it.

3. **Schedule A vs. legacy `additionalDeductions` override.** Schedule A is always computed from the per-line adjustment types when present. Effective itemized total = `max(scheduleA.totalItemized, additionalDeductions override)`. Auto-pick vs. standard deduction based on whichever is larger; explicit `useItemizedDeductions: true` override forces itemized. Why: backward-compatible with the legacy single-number itemized field while making the new per-line adjustments the primary path.

4. **Iowa std deduction mirrors federal via the `FED_CONFORMING_STD_DED_STATES` set, not a separate "taxable income base" mechanism.** Considered refactoring `calculateStateTax` to accept federal taxable income as a separate input for federal-conforming states (CO/ID/IA/MN/MO/MT/NM/ND/SC). Decided against because all of those states already set their std deduction to the federal value, so the existing formula `AGI − std_ded` mathematically equals `federalTaxableIncome` for them. Adding `"IA"` to the set was a 1-line fix that piggy-backs on the existing infrastructure and is auto-updated each year via `build2025Data()`. Oregon and Vermont don't fit this pattern (they have intentionally-different state std deds plus their own subtractions); left as approximate, flagged as a known limitation.

5. **EITC fires automatically when the filer qualifies.** A previous scenario (#8: MFJ $30k 2 kids) expected refund $4,900 — it now expects $11,784 because EITC ($6,884) correctly applies. We updated the scenario rather than gating EITC behind an opt-in. Real-world correctness wins over backward-compat with an incomplete test.

6. **Schedule D detail deferred.** ONBOARDING listed Schedule D per-transaction breakdown as a Phase 1 feature but marked "DEFERRED — confirm with user." Confirmed: 1099-B continues to feed a single LTCG/STCG number. Wash-sale rules, per-lot tracking, and capital-loss carryforwards remain out of scope.

7. **Demo bug fixes prioritized over Oregon/Vermont audit.** While fixing Iowa, I identified that Oregon's tiny $2,745 std deduction overstates OR tax (OR allows a federal-tax-paid subtraction we don't model) and Vermont uses its own structure. Neither is a clear "obvious bug" like Iowa was — they're approximations of complex state-specific rules. Not in this commit; documented in commit message and the OR/VT case is in the Phase 2 conversation as part of the multi-state work.

8. **One big Phase 1 commit, not six.** ONBOARDING said "(one commit per feature, or one big commit — user preference)." Chose one commit because the features are interrelated (AGI computation order, credit ordering, schema columns are shared across all six functions). Multiple commits would have left intermediate states that don't typecheck or pass tests.

## What should happen next

User is deciding between three paths (presented in order of my recommendation):

### Phase 1.5 — round out the everyday-filer calculator
Same pattern as Phase 1 (adjustment type → calculator → pipeline → tests → frontend). All five items together are ~1–2 days of work; each is a self-contained feature.

| Item | Frequency | Per-filer impact | Notes |
|---|---|---|---|
| **Student loan interest deduction** | ~12–13M filers (~9%) | up to $2,500 above-line | Phase-out single $80k–$95k, MFJ $165k–$195k (2024). Highest-frequency hole. |
| **ACA Premium Tax Credit** | 4M+ filers | $3–5k typical | Form 8962, reconciles against advance APTC. Driver: Form 1095-A. Largest single-line dollar impact. |
| **Educator expenses** | ~3M K-12 teachers | $300 above-line | Easiest. |
| **Residential energy credits** | growing fast | varies (solar 30%) | Form 5695, 8911. Solar/heat pump/EV charging. |
| **Foreign tax credit** | most 1099-DIV filers | small (often <$300) | Form 1116, no-form simplification under $300 single / $600 MFJ. |

Recommended start: student loan interest (most common) then ACA PTC (highest impact). Memory file at `/Users/johntang/.claude/projects/-Users-johntang-Documents-taxflow-assistant/memory/project_phase15_gaps.md` has more detail.

### Phase 2 — Schedule E + Schedule B + multi-state foundation
Bigger structural work, per ONBOARDING:
- **Schedule E**: rental real estate income/expenses with depreciation (MACRS — currently out of scope, would need to add). ~11% of filers.
- **Schedule B per-payer detail**: track 1099-INT and 1099-DIV by payer (currently summed across all payers).
- **Multi-state residency framework**: resident + non-resident state returns, part-year residency, state apportionment. Currently we pick one state from `client.state` or fall back to W-2 `stateCode`.

Best ROI if the near-term target is small CPA firms — landlords and movers are constant cases.

### Phase 3 — Real form output
Generate actual Form 1040 PDF (we currently render a summary PDF, not the IRS form). Then Schedule A/B/C/D/E PDFs and top-10 state PDFs.

### Phase 4 — Pick Option A or B
- **A:** Lacerte / ProConnect / Drake import-format adapters (CPA market).
- **B:** Guided interview UI + e-file flow (consumer DIY). IRS ERO approval runs in parallel as a ~9-month track.

### Other bugs/polish to bundle in
- **Oregon state tax overstates** — OR allows a federal-tax-paid subtraction (Form 40 Line 13) we don't model. Probably bundle with Phase 2 multi-state work.
- **Vermont** uses its own structure; calculation is approximate.
- **Dependent-care credit MFJ earned-income quirk** — `earnedIncomeTaxpayer` in the pipeline is passed as combined household wages (we have no per-spouse W-2 modeling). When spouse earns more than half of total, the credit's earned-income limit can be overstated. Edge case; rarely matters because the $3k/$6k expense cap usually binds first.
- **Capital losses ignored against ordinary income** — net cap loss is deductible up to $3k/year per IRS, currently we `max(0, ...)` and drop the loss. Listed in ONBOARDING "Known limitations." Bundle with Schedule D detail in Phase 2 or 3.
- **State retirement-income exemptions** — some states (PA, IL) exempt qualified retirement distributions; we always tax them at the state level. Bundle with Phase 2 multi-state work.

## Codebase reminders
- AGI must include LTCG + QDIV + STCG per Form 1040 Line 9 (real bug fix in commit `9a69b66`). For federal-tax computation, `ordinaryPortionOfTaxable = taxableAfterQbi − LTCG − QDIV` is passed to `calculateFederalTaxWithCapitalGains`. STCG stays in ordinary portion.
- `<CurrencyInput>` for money fields, never `<Input type="number">`.
- Radix `<Select>` requires a `formReady` gate before mount in edit mode — otherwise `onValueChange("")` fires before SelectItems mount and wipes form state. ClientForm.tsx has the working pattern.
- Adding a new test file requires adding it to `scripts/tsconfig.json`'s `exclude` array, otherwise typecheck fails.
- When the api-server typecheck stalls with "Property 'x' does not exist on type": delete `lib/db/dist/` and `lib/db/tsconfig.tsbuildinfo`, then `pnpm --filter @workspace/db exec tsc -b --force`.
- The user has shared the Neon password in chat once; they should rotate it eventually but it's been flagged.

## Auto-memory notes saved this session
- `project_phase15_gaps.md` — the Phase 1.5 priorities table above, with reasoning.
