# Handoff Note — 2026-05-21 (end of long session)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Phase A + Phase B complete and deployed.** Next priority: **Phase B+ — pull four high-frequency engine items from Phase E to immediate priority** (K-1 detail, NYC local income tax, AMT preferences, state EITC ×5 states). The new session has explicit instructions for this work in the pasteable prompt below.

**Current state: 1,221 assertions / 0 failures across 19 suites.** Live at http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com.

## What's done

### This session (Phase A + B — all 9 commits pushed + deployed):

| Commit | Phase | Title |
|---|---|---|
| `72faa21` | B10 | W-2 box-arithmetic verify flags + shared `@workspace/validation` package |
| `0ca50c8` | B7  | Form 1116 engine integration — `foreign_source_taxable_income` |
| `d82cc9d` | B8  | HI / NJ / NY partial retirement-income exemptions |
| `3c5b5dc` | B5  | CA 540NR non-resident bracket formula |
| `edbcea2` | B9  | Multi-page PDF in BoundedDocumentViewer |
| `2ac58e1` | A3  | IRS Form 1040 PDF overlay via pdf-lib + bundled templates |
| `edfa29a` + `780f47e` | B6 | Per-property rental + per-property MACRS (engine + UI) |
| `6eb27c8` | B4  | Schedule D / Form 8949 per-transaction + wash sale |
| `274ee0f` | docs | roadmap + handoff + CLAUDE.md updates |

### Earlier sessions:

- AI-overlay review/approve UX (Phase A2)
- Audit log + per-mutation writes (Phase A2 / Tier B)
- State EITC for CA + NY, VT personal exemption, Form 1116 calculator path (Tier D)
- Multi-state framework + reciprocity, MACRS, capital-loss + §469 PAL carryforwards (Phase 2)
- Phase 1.5 — student loan / educator / ACA PTC / residential energy / FTC
- Engine + adapter split, 50-state bracket data, edge-case suite

### Schema (current state of the DB):

```
clients, w2_data, form_1099_data, tax_documents, tax_returns,
adjustments, audit_log, rental_properties, capital_transactions,
conversations, messages
```

Workspace packages:
```
@workspace/api-spec, @workspace/api-zod, @workspace/api-client-react,
@workspace/db, @workspace/integrations-openai-ai-server,
@workspace/integrations-openai-ai-react, @workspace/validation
```

## Next session: Phase B+ — engine expansion

The strategic decision (logged in roadmap.md and explained to the user in the previous turn): pull four high-frequency items forward from Phase E because they cover the largest remaining slice of common returns. Holding Phase D (CPA-firm auth) for now, even though it's the gate to a paid design partner — engine coverage is the more concrete blocker for the design partner to *see value* on day one.

### Items to ship, in this order

| # | Item | Effort | Coverage gain |
|---|---|---|---|
| BP1 | K-1 detail (S-corp + partnership) | 3-5 days | Anyone with pass-through entities |
| BP2 | NYC local income tax (Form IT-201, NYC residents only) | 2-3 days | NYC residents (~3M filers) |
| BP3 | AMT preferences detail (ISO bargain + state-tax addback) | 2-3 days | AMT-bound filers (high earners, ISO exercisers) |
| BP4 | State EITC expansion: CO, IL, MN, NJ, MA | ~5 days total | Low-income filers in 5 more states |

### Hand-calc references (mandatory per CLAUDE.md):

**BP1 — K-1**:
- Form 1065 K-1 (partnership): boxes 1 (ordinary biz income), 2 (rental real estate income), 14 (SE earnings), 17 (AMT items), 20 (other info incl. §199A code Z)
- Form 1120-S K-1 (S-corp): boxes 1 (ordinary biz income), 2 (rental), 16 (foreign), 17 (§199A items)
- §199A flow: K-1 box (Z for 1065 / V for 1120-S) carries QBI, W-2 wages, UBIA — flows to Form 8995-A
- §469 passive activity: K-1 box code "B" indicates passive
- Schedule E Part II for income/loss flow
- IRS Pub 541 (partnerships), Pub 550, Form 8995 instructions
- Worked examples needed: 1 S-corp K-1 (active), 1 partnership K-1 (passive), 1 with §199A flow

**BP2 — NYC local tax**:
- NYC Form IT-201 (NYC residents file as part of NY IT-201, plus NYC schedule)
- 2024 NYC brackets (verify against NYC DOF before locking — these are approximate):
  - Single: 3.078% to $12k, 3.762% to $25k, 3.819% to $50k, 3.876% above
  - MFJ: similar tiers with doubled thresholds
- NYC-resident determination: domicile + 183-day test
- NYC unincorporated business tax (UBT) is SEPARATE — handles only NYC personal income tax here
- MCTMT (Metropolitan Commuter Mobility Tax) is separate too — for self-employed > $50k net SE income in MCTD
- Reference: NYC Administrative Code §11-1701, NY IT-201 instructions Section 4

**BP3 — AMT preferences**:
- Form 6251 line 2e: state and local tax refund addback (we don't currently apply this — but for the federal AMT calc we should also ADD BACK the state/local tax deduction that lowered ordinary taxable income → line 2g)
- Form 6251 line 2i: depreciation difference (we have MACRS; the AMT depreciation uses ADS / longer life → difference adds back)
- Form 6251 line 2k: ISO bargain element on exercise (FMV at exercise − strike, when ISO held past calendar year-end)
- New adjustment types needed: `amt_iso_bargain_element`, `amt_state_tax_addback_override` (the addback should auto-compute from itemized SALT, but allow override)
- IRS Pub 535, Form 6251 instructions

**BP4 — State EITC expansion**:
| State | TY2024 rule | Source |
|---|---|---|
| CO | 25% of federal EITC | Form 104CR Part III |
| IL | 20% of federal EITC | Schedule IL-EIC |
| MN | Working Family Credit — independent calc, NOT % of federal | Form M-1 Schedule M1WFC |
| NJ | 40% of federal EITC | NJ-1040 Line 58 |
| MA | 40% of federal EITC | Form 1 Schedule EITC |

⚠️ MN is the tricky one — Working Family Credit is its own calculation based on earned income + dependents, not a multiplier of federal EITC. Schedule M1WFC has its own phase-out. Hand-calc this carefully.

### Quality bar (same as Phase A + B):

- Hand-calc every test expected value from IRS / state publication before asserting
- Each item gets:
  - Schema (if new tables needed)
  - OpenAPI + codegen
  - Engine integration with documented limitations
  - Backend CRUD route + audit log writes
  - Frontend tab or section
  - Hand-calced integration tests
- All 19 existing suites must stay at 0 failures
- Commit + push per logical unit
- Update roadmap.md status as each lands
- Update CLAUDE.md test list when adding new test files
- Update this handoff at session end

### Deferred (do not build in next session):

- NOL carryforward, AMT credit carryforward, charitable carryforward
- Other local income taxes (MD counties, OH cities, IN counties)
- §911 FEIE, §1091(d) holding-period tack-on
- HSA Form 8889 detail, 1099-R penalty exception codes, 1099-G state-refund taxability
- Part-year residency
- Entity returns (1041 / 1065 / 1120) — out of scope per Phase 4 Option A

## EC2 deploy

The standard cycle is documented in CLAUDE.md ("EC2 deploy" section). Key facts:

- Project lives at `~/taxflow-pro` (NOT `taxflow-assistant`)
- SSH: `ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com`
- No `~/.env` on box; pull env vars from `pm2 env 0`
- Frontend OOMs on EC2 (908 MiB box) — build locally + rsync `artifacts/tax-app/dist/public/`

Schema pushes for Phase B+ items: **BP1 K-1 likely adds a `schedule_k1_data` table** → `db push` needed.

## Test count tracker

- Session start: 1,122 / 16 suites
- After A3 + B4-B10: 1,221 / 19 suites
- Target after BP1-BP4: ~1,300+ / ~21 suites

## How to start the next Claude session

Use the pasteable prompt below.
