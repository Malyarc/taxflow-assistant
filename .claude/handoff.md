# Handoff Note — 2026-05-21

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Phase 4 committed: Option A — CPA-tool overlay.** Consumer DIY (Option B) is parked.

This session executed Tier A (cleanup + carryforward auto-load + recalc race fix), Tier D (state EITC, VT fix, FTC Form 1116), and Tier B (audit log table) — plus a deep edge-case hunt that surfaced and fixed two real engine bugs.

**Test count: 1,092 assertions / 0 failures across 15 suites (was 959 at session start).**

## What landed this session

Seven commits on `main` (local, not yet pushed to origin):

| Commit | What |
|---|---|
| `8611673` | Phase 4 → Option A decision; eliminate background recalc race (sync mutations); doc refresh |
| `154b505` | Tier A: Year Compare shows Phase 2 lines + auto-load capital-loss / §469 PAL carryforward from prior year |
| `5649ed6` | Edge case hunt: 97 boundary tests + 2 real bug fixes |
| `e3fa243` | Tier D: State EITC for California (FTB 3514 approx) + New York (exact 30% of federal) |
| `030e924` | Tier D: Vermont personal exemption (Form IN-111 Line 5b) |
| `ff5c88a` | Tier D: Foreign Tax Credit Form 1116 limit (calculator path) |
| `dfc3732` | Tier B: Audit log table + per-mutation writes (CPA compliance foundation) |

Two real bugs found and fixed (both IRS-rule violations):

1. **SE tax $400 threshold missing.** Engine charged 15.3% on any positive net SE earnings; IRS Schedule SE Line 4c says under $400 net = no SE tax. Was overcharging tiny side-hustle Schedule C filers.
2. **Education credits (AOC + LLC) didn't block MFS.** Per Form 8863, MFS is ineligible for both. Engine was issuing $2,500 AOC / $1,000 LLC on MFS returns.

Both surfaced via the new edge-case suite, hand-calced against IRS publications, fixed.

## What this means for Option A

Calc engine is more correct AND we've started laying the CPA-firm-specific compliance foundation. The audit log is the first piece of Tier B.

Remaining Tier B work (deferred, multi-week):
- CPA-firm auth model (organizations + users + RBAC + per-client access)
- Per-client document upload + secure storage (kill the demo banner)
- AI overlay UX — upload doc → extract → CPA reviews → export back
- Lacerte / ProConnect / Drake adapter validation against real licenses
- SOC 2 Type I prep, security audit
- Stripe billing + subscription metering

## Current state

**Live deploy:** Not yet pushed to origin and not deployed to EC2. Standard cycle:

```bash
git push origin main   # not yet done
# then on EC2:
ssh ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com '
  cd ~/taxflow-assistant &&
  git checkout -- pnpm-lock.yaml &&
  git pull origin main &&
  pnpm install &&
  set -a && source ~/.env && set +a &&
  pnpm --filter @workspace/db run push &&
  pnpm --filter @workspace/tax-app run build &&
  pnpm --filter @workspace/api-server run build &&
  pm2 restart taxflow &&
  curl -s http://localhost:8080/api/healthz
'
```

Schema changed this session — `audit_log` table added. `db run push` is REQUIRED.

**Tests: 1,092 / 0 across 15 suites**

| Suite | Count | Needs API |
|---|---:|---|
| `tax-engine-tests.ts` | 193 | no |
| `tax-engine-deep-tests.ts` | 37 | no |
| `tax-engine-phase1-unit-tests.ts` | 44 | no |
| `tax-engine-phase15-unit-tests.ts` | 90 | no |
| `tax-engine-pure-tests.ts` | 27 | no |
| `tax-engine-phase2-unit-tests.ts` | 104 | no |
| `tax-engine-50state-tests.ts` | 187 | no |
| `tax-engine-edge-cases-tests.ts` | 128 | no (NEW — boundary/cliff hunt) |
| `tax-engine-integration-tests.ts` | 22 | yes |
| `tax-engine-deep-integration-tests.ts` | 26 | yes |
| `tax-engine-new-features-tests.ts` | 28 | yes (+5 for carryforward auto-load) |
| `tax-engine-phase1-integration-tests.ts` | 55 | yes |
| `tax-engine-phase15-integration-tests.ts` | 33 | yes |
| `tax-engine-exports-tests.ts` | 25 | yes |
| `tax-engine-scenarios.ts` | 93 | yes |

## Key behavior changes this session

1. **Mutation routes are synchronous w.r.t. tax-return recalc.** Previously, POST/PATCH/DELETE on clients / W-2 / 1099 / adjustments fired `recalculateInBackground` and returned immediately, leaving a race where a subsequent GET could read stale data. Now they `await recalculateAfterMutation()`. Tradeoff: mutations are ~50–100ms slower; benefit: API is correct (no stale reads, no test flakes).

2. **Capital-loss + §469 PAL carryforwards auto-load from prior year.** If `tax_returns` row exists for year N-1 with non-zero carryforwards, the pipeline injects synthetic adjustment rows when computing year N. Manual override semantics: if the user has explicitly entered a matching adjustment for the current year, auto-load is suppressed.

3. **State EITC firing for CA + NY.** Engine now computes `stateEitc.credit` and applies to `stateRefundOrOwed`. For low-income CA filers with 1 child, this is up to $1,932; for NY filers, exactly 30% of federal EITC.

4. **Vermont calc improved.** Now applies the per-filer personal exemption from Form IN-111 Line 5b ($4,850 single / $9,700 MFJ). VT tax reduced by ~$162 single / ~$325 MFJ for typical filers.

5. **SE tax respects $400 net threshold.** Tiny Schedule C earnings (under $400 net after the 92.35% reduction) now produce $0 SE tax.

6. **Education credits block MFS.** AOC and LLC return $0 for MFS filers per Form 8863.

7. **Audit log written on every client-scoped mutation.** New `audit_log` table, `writeAudit()` helper, `GET /api/clients/:id/audit-log` endpoint. Captures before/after row snapshots. Foundation for CPA-firm compliance.

8. **Foreign Tax Credit has Form 1116 limit path.** Function signature accepts optional `foreignSourceTaxableIncome` + `totalTaxableIncome` + `preCreditUsTax`. When all provided, applies the actual Form 1116 limit (credit = min(paid, sourceFraction × preCreditTax)). Engine integration deferred — needs a new `foreign_source_taxable_income` adjustment type to wire end-to-end.

## What I did NOT do this session (and why)

Explicitly deferred to keep session scope realistic:

- **NR state brackets for CA** (CA 540NR-specific rate formula) — bigger work, lower priority than the items shipped
- **Per-property rental table** + per-property MACRS — 1–2 day standalone item
- **Lacerte / ProConnect / Drake import-adapter validation** — needs a design-partner CPA license + sample files
- **AI overlay UX** (upload → extract → review → export) — multi-week UX project
- **CPA-firm multi-tenancy auth** — multi-week (organizations, users, roles, RLS)
- **Schedule D per-transaction detail + wash sale** — 3–5 days standalone
- **Real IRS Form 1040 PDF layout** — 2–3 days; would have crowded out bug-hunt + Tier B
- **EC2 deploy** — committed but not pushed. User decision: ready to deploy when they want it

## Where to pick up next session — ranked by value

### Tier 1 (highest leverage, Option-A specific)
1. **Push current `main` to origin and deploy to EC2** — ~10 min. Includes schema push for the new `audit_log` table.
2. **Validate UltraTax `.gen` export with a real CPA design partner.** The export is built but never tested against an actual UltraTax CS install. Highest-confidence way to de-risk Option A.
3. **AI overlay UX MVP** — minimal flow: upload 1099 PDF → AI extracts → CPA reviews → click "export to UltraTax". This is the actual product.

### Tier 2 (engine accuracy improvements)
4. **CA 540NR non-resident bracket calc** (CA-source / total × CA tax). Currently uses resident brackets on allocated wages → overstates NR CA tax.
5. **Schedule D per-transaction detail** + wash-sale tracking. Most CPA clients have brokerage accounts.
6. **Per-property rental table** (`rental_properties` schema + per-property MACRS).
7. **HI / NJ / NY partial retirement-income state exemptions** (PA/IL/MS done).
8. **Real IRS Form 1040 PDF layout** via pdf-lib coordinate fills.

### Tier 3 (compliance / infra hardening)
9. **CPA-firm auth model** — organizations, users, role-based access, per-client visibility.
10. **Soft-delete clients** instead of cascading, so audit_log persists past client deletion (real CPA compliance expectation).
11. **DB-level append-only enforcement** on audit_log (revoke UPDATE/DELETE for the app role).
12. **Real document upload + secure S3 storage**, remove demo banner.

### Tier 4 (lower-frequency engine items)
13. **K-1 detail** (S-corp + partnership K-1)
14. **AMT preferences detail** (state-tax addback, ISO bargain element)
15. **Local income taxes** (NYC, MD counties, OH cities, IN counties)
16. **State EITC expansion** to other states (CO, IL, MA, MN, NJ, etc.)
17. **Form 1116 engine integration** — add `foreign_source_taxable_income` adjustment type, wire engine to call new FTC path

## Codebase reminders (carried forward from CLAUDE.md)

- AGI must include LTCG + QDIV + STCG per Form 1040 Line 9
- `<CurrencyInput>` for money fields, never `<Input type="number">`
- Radix `<Select>` needs `formReady` gate before mount in edit mode
- Adding a new test file requires adding it to `scripts/tsconfig.json`'s `exclude` array
- When api-server typecheck stalls after schema change: delete `lib/db/dist/` + `lib/db/tsconfig.tsbuildinfo`, then `pnpm --filter @workspace/db exec tsc -b --force`

## Open background processes

- API server on `:8080`
- Frontend preview on `:3010`
- Docker `haven-postgres` container

## How to start the next Claude session

Just say: **"Read .claude/handoff.md and CLAUDE.md. What should we work on next?"**

Or be more specific:
- **"Push to origin and deploy to EC2."**
- **"Build the AI-overlay UX: upload 1099 PDF → extract → review → export."**
- **"Add CA 540NR non-resident bracket calc."**
- **"Validate UltraTax .gen against a sample import file [path]."**
