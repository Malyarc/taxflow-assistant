# Handoff Note — 2026-05-26 (C-batch: 6 items shipped)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## ⚡ Read this first

The full open TODO is in **`docs/todo.md`** — durable, git-tracked.

The coverage map (per-state + per-feature) lives in
**`docs/coverage-matrix.md`** — read before planning state or federal
coverage work.

Open sections after this session:
- **A** — strategic / business (A1 outreach, A2 D15 auth, A3 D18 Stripe)
- **B** — Planning Strategy tool smartness upgrades (H1-H12)
- **C** — engine coverage push (C2 top-10-state credits, C3 design-partner validation, C9 PA local EIT, C10 OH school district, C11 per-state PY residency) ← C1+C4+C5+C6+C7+C8 just shipped
- **D** — infra / security hardening (TLS, S3, soft-delete, etc.)
- **E** — reactive / deferred (only when a customer asks)

Read `docs/todo.md` BEFORE picking a task. The Claude task tool inside
any single session is ephemeral — only that file persists.

## Headline

**C-batch (6 items) shipped this session. 178 new hand-calc'd
assertions across 5 new test files. Coverage matrix doc written.
Forms 4868 + 1040-X live with both engine math + frontend cards +
PDF downloads. §1031 / ESPP-ISO disqualifying / §163(j) / §461(l)
engines added. Engine still at zero documented federal/state gaps.
4 sub-gaps tracked (Form 8824 PDF deferred, §163(j) ATI proxy
approx, §461(l) auto-aggregation deferred, §1031/§121 → NIIT not
yet wired).**

## What landed (commits in order)

| Commit | Item | Notes |
|---|---|---|
| `a852b16` | **C1 — Coverage matrix doc** | `docs/coverage-matrix.md`: federal forms/IRC inventory, 51-row state matrix (brackets/std-ded/exemption/cliff/surtax/SS/EITC/CTC/AMT/retirement/local), 45-row local-tax catalog, prioritized gap list, extension guide. |
| `d04a67c` | **C8 — Form 4868 extensions** | `form4868.ts` engine + pdfkit substitute PDF (per Pub 1167). 2 routes (`/form-4868` JSON, `/form-4868/pdf`). Frontend card on Tax Calculator tab: live Line 4-7 preview, override inputs (amountBeingPaid, estimatedTaxAlreadyPaid, outOfCountry, 1040-NR), PDF download. 40 hand-calc'd tests. |
| `ba2f229` | **C4 — Form 1040-X amended returns** | Snapshot-based diff. 3 new columns on tax_returns (originalSnapshot jsonb, amendmentExplanation, amendmentLockedAt). 5 routes (lock-as-filed, clear-amendment, PUT explanation, JSON diff, PDF). Frontend Form1040xCard with 3-col diff table (col a / b / c), red/green delta coloring, Part III textarea autosaving on blur, PDF download. 45 hand-calc'd tests (IRS rounding convention: col b = round(c) − round(a)). |
| `b60d8ff` | **C5 — §1031 like-kind exchange** | 4 new tax-return columns. 2 adjustment types (`section_1031_realized_gain`, `section_1031_boot_received`). Engine: recognized = min(realized, boot); deferred = realized − recognized. Recognized flows to LTCG. Frontend Section1031Card. 30 hand-calc'd tests. Sub-gap: doesn't flow into NIIT (consistent with §121 pattern). |
| `(c-6-commit)` | **C6 — ESPP + ISO disqualifying disposition** | 2 new tax-return columns. 2 adjustment types (`iso_disqualifying_disposition_ordinary`, `espp_disqualifying_disposition_ordinary`). Engine adds comp income to ordinary income (NOT FICA per Notice 2002-47 / Rev Rul 71-52). Frontend EsppIsoCard. 27 hand-calc'd tests verifying bracket-stacking, NIIT exclusion, AddlMed exclusion. |
| `(c-7-commit)` | **C7 — §163(j) + §461(l)** | 4 new tax-return columns. 5 adjustment types. §163(j) full engine: ATI proxy → 30% cap → allowed/disallowed split + indefinite carryforward. Biz interest income + floor plan financing always uncapped. §461(l) as CPA-supplied addback. Frontend Section163j461lCard. 36 hand-calc'd tests. |

(The git log will have the actual commit hashes for the last two.)

## Test state (final)

**ALL SUITES GREEN.** 178 new C-section assertions. Engine still at
zero documented federal/state gaps.

| Suite | Result | Notes |
|---|---|---|
| tax-engine-tests | 193/193 | |
| tax-engine-deep-tests | 37/37 | |
| tax-engine-cpa-scenarios-tests | 146/146 | |
| tax-engine-deep-audit-tests | 210 pass | |
| tax-engine-accuracy-audit-tests | 97 pass | |
| tax-engine-phaseE-tests | 235/235 | |
| tax-engine-50state-tests | 187/187 | |
| **tax-engine-form4868-tests** (NEW) | 40/40 | C8 |
| **tax-engine-form1040x-tests** (NEW) | 45/45 | C4 |
| **tax-engine-section1031-tests** (NEW) | 30/30 | C5 |
| **tax-engine-espp-iso-tests** (NEW) | 27/27 | C6 |
| **tax-engine-section163j-461l-tests** (NEW) | 36/36 | C7 |
| (other pure + integration suites) | (✓ no regressions) | |

## Schema changes pushed to local DB (need EC2 push too)

| Table | New columns |
|---|---|
| `tax_returns` | C4: `original_snapshot` jsonb, `amendment_explanation` text, `amendment_locked_at` timestamp |
| `tax_returns` | C5: `section_1031_realized_gain`, `section_1031_boot_received`, `section_1031_recognized_gain`, `section_1031_deferred_gain` (all numeric default "0") |
| `tax_returns` | C6: `iso_disqualifying_disposition_ordinary`, `espp_disqualifying_disposition_ordinary` (numeric default "0") |
| `tax_returns` | C7: `section_163j_business_interest_expense`, `section_163j_allowed_deduction`, `section_163j_disallowed_carryforward`, `section_461l_excess_loss_addback` (numeric default "0") |

OpenAPI enum extensions on `adjustmentType` (3 schemas: Adjustment,
CreateAdjustmentBody, UpdateAdjustmentBody) — 9 new values:
- section_1031_realized_gain
- section_1031_boot_received
- iso_disqualifying_disposition_ordinary
- espp_disqualifying_disposition_ordinary
- section_163j_business_interest_expense
- section_163j_business_interest_income
- section_163j_carryforward_from_prior
- section_163j_floor_plan_financing_interest
- section_461l_excess_loss_addback

api-zod + api-client-react regenerated.

## Deploy steps (for the user)

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')

# REQUIRED — Phase C added 13 new columns to tax_returns:
pnpm --filter @workspace/db run push

pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
exit
```

Local frontend rebuild + rsync (Vite OOMs on EC2):
```bash
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

Verify by clicking through a seeded client at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com:
1. Open a Tax Calculator tab → Form 4868 card should render with live Lines 4-7.
2. Lock-as-filed → modify an adjustment → recompute → Form 1040-X card should render the diff.
3. Add a `section_1031_realized_gain` + `section_1031_boot_received` adjustment → Section1031Card should appear.
4. Similar smoke checks for `iso_disqualifying_disposition_ordinary` (EsppIsoCard) and `section_163j_business_interest_expense` (Section163j461lCard).

## Sub-gaps surfaced this session (for future engine work)

1. **§163(j) ATI proxy approximation** — true ATI per §163(j)(8) is taxable income without §163(j)/NOL/§199A QBI plus depreciation addback (pre-2022 only). Engine uses pre-§163(j) ordinary income, which over-restricts the allowance for high-depreciation low-income filers. Documented in test Case 9.
2. **§461(l) auto-aggregation deferred** — engine accepts CPA-supplied addback; doesn't yet aggregate Sched C + Sched E + K-1 active losses across the §305k single / $610k MFJ threshold. CPA pre-computes.
3. **§1031 (and §121) recognized gains don't flow into NIIT investment-income base** — consistent with the existing §121 pattern (a documented sub-gap in CLAUDE.md). Fix would require a broader NIIT-base refactor that also corrects §121.
4. **Form 8824 PDF for §1031 + Form 8990 PDF for §163(j) deferred** — CPAs hand-file these from the engine's computed values. Engine output is structured enough that adding the PDF builders later is a 1-2 hour task per form.

## What's left (post-C-batch — strongest candidates)

1. **CPA outreach campaign (A1)** — packet complete; blocked on user availability.
2. **H2 — what-if engine (1-2 wks)** — turns every existing planning rule into actual delta-dollar values (no more heuristic ranges). Foundation for H3-H7-H10-H12.
3. **C2 — top-10-state credits push (2-3 wks)** — 50 credits × ~3 days each.
4. **D15 — multi-tenancy auth (2-3 wks)** — required before paid customers.
5. **D1 — TLS terminator (1-2 days)** — needed before paid customers.

## How to start the next Claude session

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. docs/todo.md                 — THE LIVE TODO (read this first)
  2. docs/coverage-matrix.md      — Per-state + per-feature inventory
  3. .claude/handoff.md           — Last session state
  4. .claude/roadmap.md           — Long-arc Phase A-G plan
  5. CLAUDE.md                    — invariants, closure log

Where we left off (2026-05-26): C-batch shipped — 6 items (C1+C4+
C5+C6+C7+C8). 178 new hand-calc'd assertions. Forms 4868 + 1040-X
live end-to-end with PDF downloads. §1031, ESPP-ISO disqualifying,
§163(j) + §461(l) engine + frontend cards live. Coverage matrix
doc written. ZERO documented engine gaps; 4 new sub-gaps tracked
(Form 8824/8990 PDFs deferred; §163(j) ATI proxy approximate;
§461(l) auto-aggregation deferred; §121/§1031 NIIT routing
consistent with existing §121 sub-gap).

Show me the full open TODO list. Top recommendation is task **H2
(what-if engine, 1-2 wks)** — single biggest planning-accuracy
unlock. Sub-recommendations: A1 (CPA outreach, awaits user availability),
C2 (top-10-state credits, 2-3 wks), D15 (multi-tenancy auth, 2-3 wks).

Quality bar:
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update docs/todo.md / docs/coverage-matrix.md / .claude/handoff.md /
  CLAUDE.md at session end
- Deploy to EC2 at the end (git pull + db push + pm2 restart on EC2
  + local pnpm build + rsync)
```
