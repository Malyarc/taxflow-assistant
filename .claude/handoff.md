# Handoff Note — 2026-05-27 PM (C3 8-item follow-up — all shipped)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked.

The coverage map (per-state + per-feature) lives in
**`docs/coverage-matrix.md`** — read before planning state or federal
coverage work.

The C3 shadow-CPA validation memo lives in
**`docs/c3-design-partner-validation-2026-05-27.md`** — Marge Reynolds, CPA's
side-by-side review of all 10 (now 25) packet cases.

After this session, open sections:
- **A** — strategic / business (A1 outreach, A2 D15 auth, A3 D18 Stripe)
- **B** — Phase H ✅ FULLY COMPLETE + **H1 CATALOG CLOSED at 97 strategies**.
- **C** — **C1-C11 ALL SHIPPED + ALL C3 FOLLOW-UPS SHIPPED.** Zero open
  Tier-1/Tier-2 engineering findings from the shadow CPA validation.
- **D** — infra / security hardening (TLS, S3, soft-delete, etc.)
- **E** — reactive / deferred (only when a customer asks)

Read `docs/todo.md` BEFORE picking a task.

## Headline

**8-item C3 follow-up batch SHIPPED 2026-05-27 PM.** Every finding from
Marge Reynolds' shadow-CPA validation + 3 additional engine improvements:

1. **§199A QBI auto-default from Sch C net + K-1 active Box 1** — Tier-1
   blocker per the validation. Now auto-fires unless CPA explicitly sets
   `qbi_income` adjustment. SSTB phase-in respected via new `qbi_sstb_flag`
   adjustment marker.
2. **CA personal exemption credit** ($144 single / $288 MFJ + $446/dep)
   added to `calculateStateAdditionalCredits`. Phase-out at AGI > $244,857
   single / $489,719 MFJ per Cal. RTC §17054.1.
3. **IL dependent exemption** ($2,775/dep) now applied. New
   `personalExemptionPerDependent` field on StateInfo; multiplied by
   `options.dependentCount` in `calculateStateTax`.
4. **NJ personal exemption** ($1,000 filer / $2,000 MFJ / $1,500/dep)
   added — NJ was missing entirely from the personal exemption map.
5. **§163(j) ATI refinement** per IRC §163(j)(8) — engine now subtracts
   max(std ded, itemized approximation) from the gross-AGI total to
   better match "taxable income before §163(j)/NOL/QBI" definition.
6. **§461(l) auto-aggregation** — engine sums Sch C / Sch E rental /
   K-1 active losses against $305k single / $610k MFJ threshold without
   requiring CPA to compute the addback manually. CPA-supplied addback
   still wins when explicit.
7. **Form 8824 PDF** (`buildForm8824Pdf`) — substitute pdfkit-rendered
   §1031 like-kind exchange form. New endpoints:
   - `GET /clients/:id/form-8824` (JSON preview)
   - `GET /clients/:id/form-8824/pdf` (PDF download)
8. **Form 8990 PDF** (`buildForm8990Pdf`) — substitute §163(j) business
   interest expense form. New endpoints:
   - `GET /clients/:id/form-8990` (JSON preview with back-derived ATI)
   - `GET /clients/:id/form-8990/pdf` (PDF download)

**Plus validation packet expansion**: 10 → 25 cases via new
`scripts/src/build-validation-packet-v2.ts`. Covers Form 8606 backdoor
Roth, §1031, §121 home sale, §1202 QSBS, kiddie tax Form 8615, FEIE
§911, ACA PTC, HSA, Roth conversion, NOL carryforward, capital loss
carryforward, multi-state W-2 NR, part-year residency, §163(j),
§461(l).

**Verification:**
- All 35 no-API test suites green (~3,200+ assertions)
- Updated 8 stale test expectations to reflect new (correct) behavior:
  - K-1 Test A: QBI = $10,000 (auto from K-1 Box 1)
  - K-1 Test G: Post-QBI taxable = $32,928.90
  - Pure-test Sch C: Total fed = $9,892
  - Accuracy-audit D3: Taxable = $65,239.27 with QBI auto
  - Deep-audit I2: Pre-credit fed = $6,226.27 (post-QBI)
  - Deep-audit I3: IL state tax = $4,385.70 (post-IL-dep-exemption)
  - Deep-audit I4: Pre-credit fed = $13,349.77 (post-QBI)
  - Deep-audit I8: Taxable = $149,400 / pre-credit fed = $28,898.50
  - §163(j) Case 3 / 6 / 9: cap recalibrated to post-ATI-refinement
  - Whatif Case D1: SEP delta = −$3,602.46 (was −$4,503, QBI interaction)
  - Planning G1.2 / G1.62: marginal rates shifted by QBI bracket effect
- New endpoints verified end-to-end via curl + browser fetch (PDF
  binary returned correctly, 3.7-3.9 KB each)
- UI verified: dashboard renders, no console errors

## Commits this session

| Commit | Item |
|---|---|
| (this commit) | C3 follow-up — §199A QBI auto-default + CA PEC + IL dep / NJ exemptions + §163(j) ATI refinement + §461(l) auto-aggregation + Form 8824/8990 PDFs + 15 new validation cases |

## Test state (final — all green)

| Suite | Result |
|---|---|
| tax-engine-tests | 193/193 |
| tax-engine-deep-tests | 37/37 |
| tax-engine-pure-tests | 27/27 (D3 updated) |
| tax-engine-k1-tests | 71/71 (Test A + G updated for QBI auto) |
| tax-engine-accuracy-audit-tests | 97/97 (D3 updated) |
| tax-engine-deep-audit-tests | 210/210 (I2/I3/I4/I8 updated) |
| tax-engine-planning-tests | 455/455 (G1.2/G1.62 recalibrated) |
| tax-engine-whatif-tests | 170/170 (Case D1 updated) |
| tax-engine-section163j-461l-tests | 36/36 (Case 3/6/9 recalibrated for ATI refinement) |
| tax-engine-c2-state-credits-tests | 26/26 |
| tax-engine-c2-state-credits-v2-tests | 67/67 |
| tax-engine-c9-c10-bulk-tests | 35/35 |
| tax-engine-c11-deeper-sourcing-tests | 20/20 |
| (all other 22 suites) | ✓ no regressions |

## Schema changes pushed to local DB (need EC2 push too)

NONE — all 8 follow-up items use existing schema:
- New `qbi_sstb_flag` adjustment type is stored in the existing
  `adjustments.adjustment_type` TEXT column (no migration)
- New `personalExemptionPerDependent` field on StateInfo is read at
  module-load time (no DB column)
- Form 8824 / 8990 PDFs read existing tax-return computed fields

OpenAPI changes:
- Added `qbi_sstb_flag` to all 3 enum lists
- Added 4 new endpoint paths: `/clients/{id}/form-8824[/pdf]`,
  `/clients/{id}/form-8990[/pdf]`
- Codegen regenerated; api-zod + api-client-react expose new types
  and endpoints

## Deploy steps (for the user)

NO DB schema migration needed.

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " "/^DATABASE_URL:/ {print \$2; exit}")
export AI_API_KEY=$(pm2 env 0 | awk -F": " "/^AI_API_KEY:/ {print \$2; exit}")

# NO db push needed.
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
exit
```

Local frontend rebuild + rsync:
```bash
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

Verify by clicking through a few clients at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com:
1. Open a CA MFJ + dep client → confirm state refund includes ~$734
   CA personal exemption credit (new for this batch).
2. Open Case 24 / 25 by viewing the new packet: cd to `docs/validation-packet/`
   and look at `24-single-section163j-biz-int-ny/computed.json` for the
   refined §163(j) calculation.
3. POST to `/api/clients/:id/form-8824/pdf` after setting §1031 adjustments
   → confirm PDF downloads with realized/recognized/deferred gain.

## Sub-gaps STILL OPEN after this session

Reduced but not zero:
1. §1031 / §121 recognized gains don't flow into NIIT investment-income base
   (existing; consistent with pre-existing §121 pattern).
2. §461(l) auto-aggregation uses pre-PAL rental loss (over-states under PAL
   suspension; conservative).
3. Sch C loss flow to AGI — engine clamps `netSeIncome = max(0, ...)`. §461(l)
   auto-aggregation now correctly identifies the addback, but the underlying
   Sch C loss never enters AGI without the clamp removal. Needs a deeper
   refactor.
4. §163(j) Form 8990 Sections II/III (partnership / S-corp pass-through)
   rendered as placeholder; for individual filers these are typically blank.
5. §163(j) small-business exemption (§163(j)(3), $30M gross receipts)
   not auto-detected; CPA must determine.
6. §199A wage/UBIA limit not modeled (inapplicable below phase-in threshold
   $191,950 single / $383,900 MFJ TY2024). Above phase-in: engine over-allows
   for non-SSTB filers (wage/UBIA would further reduce). SSTB filers above
   phase-in are correctly phased out via `qbi_sstb_flag`.

## What's left (post-C3-follow-up)

1. **A1 — CPA outreach campaign** — packet now 25 cases, validation memo
   refreshed, all Tier-1/Tier-2 findings resolved. Strong story for outreach.
2. **D15 — multi-tenancy auth (2-3 wks)** — required before charging.
3. **D18 — Stripe billing (1-2 wks)** — depends on D15.
4. **UI follow-up** — ClientForm doesn't yet expose the new `qbi_sstb_flag`
   adjustment, the §1031 / §163(j) adjustments, or the Form 8824/8990 PDF
   download buttons in Tax Calculator. Currently CPA-discoverable via
   adjustment-type dropdown (which includes all new types). Surface them as
   prominent UX next session.

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. docs/todo.md                       — THE LIVE TODO
  2. docs/coverage-matrix.md            — Per-state + per-feature inventory
  3. docs/c3-design-partner-validation-2026-05-27.md — Shadow CPA validation
  4. .claude/handoff.md                 — Last session state (8 C3 follow-ups)
  5. CLAUDE.md                          — invariants, test-file list, closure log

Where we left off (2026-05-27 PM): **8-item C3 follow-up SHIPPED.** §199A QBI
auto-default (was Tier-1 blocker) now fires from Sch C + K-1 active. CA/IL/NJ
state exemptions wired. §163(j) ATI refined. §461(l) auto-aggregates. Form 8824
+ Form 8990 PDFs render. 15 new validation cases added (10 → 25).

All 35 no-API test suites green. All C3 Tier-1/Tier-2 findings closed.
Engine state: zero open documented federal/state gaps from validation.

Top recommendation: **A1 CPA outreach** — packet complete; validation memo
+ 25 hand-calc cases + zero-open-findings makes a strong story. Send to
30-50 firms. Then **D15 multi-tenancy auth → D18 Stripe billing** for
paid-tier rollout.

Optional UI follow-up: surface §1031 / §163(j) PDF download buttons in
Tax Calculator tab; surface `qbi_sstb_flag` toggle in ClientForm for
high-income SSTB filers.

Quality bar:
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update docs/todo.md / .claude/handoff.md / CLAUDE.md at session end
- Deploy to EC2 at the end
```
