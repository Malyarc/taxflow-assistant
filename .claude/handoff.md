# Handoff Note — 2026-05-22 (end of Phase B+ session)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Phase B+ complete and deployed.** All four high-frequency engine items shipped:
K-1 detail (BP1), NYC PIT (BP2), AMT preferences (BP3), state EITC ×5 (BP4).

**Current state: 1,366 assertions / 0 failures across 24 suites.** Live at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com. Smoke-tested in production:
NYC + K-1 flow returns the engine-correct numbers end-to-end.

## What's done this session

| Commit | Phase | Title |
|---|---|---|
| `85fae6d` | BP1 backend | Schedule K-1 — partnership + S-corp pass-through |
| `4761baa` | BP1 frontend | K-1s tab with per-K-1 CRUD UI |
| `31ecea8` | BP2 | NYC personal income tax — 4 brackets per filing status |
| `5908925` | BP3 | AMT preferences — SALT addback + ISO bargain element |
| `cdb90b2` | BP4 | State EITC expansion — CO + IL + NJ + MA piggyback + MN WFC |

### Verified facts (sourced May 2026)

Critical research-driven corrections this session:

1. **NYC MFJ thresholds are NOT 2× single** — they're 1.8× ($21.6k / $45k / $90k vs. single's $12k / $25k / $50k). Verified against NY DTF Form IT-201-I 2024 page 40.

2. **CO state EITC for TY2024 = 50%, not 25%.** HB24-1134 was a mid-2024 one-time bump (DR 0104CR rev. 09/30/24 Line 5). TY2025 = 35%, TY2026+ baseline = 25%. The user's "25%" was the pre-2024 rate.

3. **NYC PIT brackets unchanged since TY2017.** The "FY2025 NYS budget shift" the user mentioned in the handoff was about the NYS top rates, not NYC.

4. **MN Working Family Credit uses Schedule M1CWFC** (consolidated with the MN CTC starting TY2023), NOT the older M1WFC. Independent calc: 4% × min(earned, $9,220) + per-child add-ons, 12% phase-out above $31,090 ($36,880 MFJ), $11,600 investment-income limit.

5. **K-1 engine fix while in BP1:** SE-tax base separated from Schedule C net so partnership Box 14A SE earnings don't double-count into AGI (Box 1 already flows there via Schedule E Part II).

### Schema additions

```
schedule_k1_data           NEW TABLE   (BP1)
clients.locality_code      NEW COLUMN  (BP2)
tax_returns.k1_passive_loss_suspended   NEW COLUMN  (BP1 — for prior-year carryforward auto-load)
tax_returns.local_tax_liability         NEW COLUMN  (BP2)
tax_returns.local_tax_jurisdiction      NEW COLUMN  (BP2)
```

New adjustment types introduced (no schema change — existing `adjustments` table):

- `k1_passive_loss_carryforward` — auto-loaded from prior year's tax_returns.k1_passive_loss_suspended
- `amt_iso_bargain_element` — Form 6251 line 2k
- `amt_state_tax_addback_override` — Form 6251 line 2g override (auto-derived from itemized SALT when not set)

### Test count tracker

- Session start: 1,221 assertions / 19 suites
- After BP1: 1,314 / 21 (added k1-tests + k1-integration-tests)
- After BP2: 1,329 / 22 (added nyc-tests)
- After BP3: 1,345 / 23 (added amt-prefs-tests)
- After BP4: 1,366 / 24 (added state-eitc-tests)

All standalone + integration suites at 0 failures after each commit.

(`tax-engine-ai-overlay-tests` was not run in this session — needs a real
`AI_API_KEY`. Failure on dummy key is environmental, not a regression.)

## Known limitations introduced or documented

### K-1 (BP1)
- §199A wage/UBIA limit + SSTB phase-out: stored but not applied (simplified 20%)
- Basis / at-risk limits: stored, not enforced
- K-1 guaranteed payments (Box 4 on 1065): not modeled
- Form 8582 cross-bucketing: K-1 passive bucket separate from rental-RE bucket (slight simplification — IRS pools them with caveats)

### NYC (BP2)
- NYC school tax credit (line 69 flat + 69b rate-reduction): not modeled
- NYC UBT: separate tax, out of scope
- MCTMT (Metropolitan Commuter Mobility Tax): separate tax, out of scope
- NYC household credit (line 48) IS modeled (small low-FAGI offset)

### AMT (BP3)
- Form 6251 line 2g (SALT addback) and line 2k (ISO bargain): modeled
- Line 2i (MACRS-vs-ADS depreciation difference): not modeled
- Line 2e (state-refund recapture): not modeled
- AMT NOL: not modeled
- AMT credit carryforward: not modeled

### State EITC (BP4)
- NJ age 18+/65+ expansion to childless filers: not auto-applied (CPA workaround = manual credit adjustment)
- MA part-year proration: not modeled
- MN "qualifying older children" approximated as federal-EITC qualifying-children count
- MN phase-out uses the 12% rate (skips the 9% carve-out for older-children-only filers)

## EC2 deploy

Deployed this session via the standard cycle from CLAUDE.md:

```
# Local
pnpm --filter @workspace/tax-app run build
rsync ... ec2:~/taxflow-pro/artifacts/tax-app/dist/public/

# EC2
git pull && pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
pnpm --filter @workspace/db run push     # 3 new columns + 1 new table
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz   # {"status":"ok"}
```

Live smoke test confirmed: NYC + K-1 flow produces the engine-correct numbers in production.

## Next session — recommended priorities (read order matters)

1. **`.claude/handoff.md`** — this file
2. **`.claude/roadmap.md`** — Phase E options
3. **`CLAUDE.md`** — invariants

### Top candidates for next session (pick one based on user goal)

**Option A — Phase C (design-partner validation):**
- C11: Find a CPA design partner (calendar)
- C12: Validate UltraTax `.gen` against a real UltraTax CS install
- C13: AI extraction accuracy benchmark (100 labeled real 1099s/W-2s)
- This is the path to actual customer feedback and a paid pilot.

**Option B — Phase D (compliance / multi-tenancy, when paid partner committed):**
- D15: CPA-firm multi-tenancy auth (orgs + users + RBAC) — 2-3 weeks
- D16: Soft-delete clients + append-only audit log (DB-level revoke UPDATE/DELETE)
- D17: Real document storage in S3 + encryption at rest

**Option C — More Phase E engine items (do when a customer asks):**
- NOL carryforward + 80% taxable income limit (post-TCJA)
- AMT credit carryforward
- Charitable carryforward (5-year)
- §179 expense + bonus depreciation
- HSA Form 8889 detail
- Other local income taxes (MD counties, OH cities, IN counties)
- Part-year residency in multi-state framework
- Foreign income exclusion (§911 FEIE)

**Option D — Polish:**
- BP1 limitations: §199A wage/UBIA limit (for high-earner K-1 cases) — needed before serving filers above $191,950 single / $383,900 MFJ
- BP2 limitations: NYC school tax credit (flat $63/$125 + 69b rate-reduction) — applies to almost all NYC residents below $250k AGI
- BP3 limitations: Form 6251 line 2i (MACRS-vs-ADS depreciation difference) — needed for rental owners with significant depreciation
- BP4 limitations: NJ 18+/65+ EITC expansion auto-apply

### What I'd NOT do speculatively

- Build any of Phase D before a paid design partner is committed (risk of building the wrong access model)
- SOC 2 prep (D19) before a paying customer requires it
- Per-vendor Lacerte / ProConnect / Drake adapters — `.gen` covers them universally

## How to start the next Claude session

Pasteable prompt below.
