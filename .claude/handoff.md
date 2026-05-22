# Handoff Note — 2026-05-21 (evening)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Phase A + Phase B complete.** All 8 items shipped (A3, B4-B10) with hand-calced tests; **1,221 assertions / 0 failures across 19 suites** (was 1,122 / 16 at start of this turn).

The product surface now covers:
- AI-extraction review/approve UX (Phase A2) with bounding-box overlays
- **Multi-page PDF support** in the review modal (B9)
- **Real IRS Form 1040 PDF overlay** via pdf-lib + bundled IRS templates (A3)
- **Per-property rental** + per-property MACRS (B6) — new Rentals tab
- **Schedule D per-transaction** + wash-sale via Form 8949 column g (B4) — new Schedule D tab
- **CA 540NR non-resident** bracket formula (B5)
- **HI / NJ / NY** retirement-income exemptions (B8)
- **Form 1116 FTC limit** with foreign_source_taxable_income (B7)
- **Live W-2 box-arithmetic flags** in the review modal (B10) — severity-colored chips
- **CPA-firm auth model** is now the only Phase D blocker; everything else in Phases A-B is product-complete

## Commits this session (all pushed to `origin/main`)

| Commit | Phase | What |
|---|---|---|
| `72faa21` | B10 | W-2 box-arithmetic verify flags — shared `@workspace/validation` package, live flag chips in modal |
| `0ca50c8` | B7  | Form 1116 engine integration — foreign_source_taxable_income adjustment + Form 1116 limit calc |
| `d82cc9d` | B8  | HI / NJ / NY partial retirement-income state exemptions |
| `3c5b5dc` | B5  | CA 540NR non-resident bracket formula (resident-equivalent × CA-source/total) |
| `edbcea2` | B9  | Multi-page PDF support in BoundedDocumentViewer (page nav + extracted-fields indicators) |
| `2ac58e1` | A3  | IRS Form 1040 PDF overlay via pdf-lib (bundled TY2024 templates, 50+ field-path map) |
| `edfa29a` | B6  | Per-property rental + per-property MACRS (engine + backend) |
| `780f47e` | B6  | Per-property rental UI tab |
| `6eb27c8` | B4  | Schedule D per-transaction + wash sale (Form 8949, schema + engine + UI) |

## New schema additions

Three new tables on top of the existing `audit_log`-extended schema:

```
tax_documents.linked_record_id, linked_record_type, rejection_reason  (added in prior session)
rental_properties                                                      (B6)
capital_transactions                                                   (B4)
```

Plus a new workspace package:
```
lib/validation/  →  @workspace/validation  (shared W-2 validator, server + frontend)
```

## Current state

**Live deploy**: All commits pushed to `origin/main`. **NOT yet deployed to EC2** — both `rental_properties` and `capital_transactions` are new schemas, so `db push` is required on the box.

Standard EC2 cycle (see CLAUDE.md for full details — note: `~/taxflow-pro`, no `~/.env`, source via `pm2 env 0`):

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com '
  cd ~/taxflow-pro &&
  git checkout -- pnpm-lock.yaml &&
  git pull origin main &&
  pnpm install &&
  export DATABASE_URL=$(pm2 env 0 | awk -F": " "/^DATABASE_URL:/ {print \$2; exit}") &&
  export AI_API_KEY=$(pm2 env 0 | awk -F": " "/^AI_API_KEY:/ {print \$2; exit}") &&
  pnpm --filter @workspace/db run push &&
  pnpm --filter @workspace/api-server run build &&
  pm2 restart taxflow &&
  curl -s http://localhost:8080/api/healthz
'
```

Then build the frontend locally + rsync (EC2 OOMs on Vite — see CLAUDE.md):

```bash
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

**Tests: 1,221 / 0 across 19 suites** — see CLAUDE.md for the full table.

## What I did NOT do this session

- **EC2 deploy** — code shipped to origin, deploy is pending (~10 min)
- **CPA-firm multi-tenancy auth** (Phase D15) — single biggest remaining blocker for a paid design partner
- **Schedules 1 / 2 / 3 PDF overlay** — templates are bundled at `artifacts/api-server/src/assets/irs-forms-2024/` but only Form 1040 itself is overlaid. Schedule 1/2/3 derived totals are summarized into the 1040 lines; per-line schedule pages aren't yet generated. ~1 day to add.
- **Auto wash-sale detection** in B4 — broker-reported via 1099-B Box 1g (code W) is honored, but cross-account / spousal / IRA detection (Rev Rul 2008-5) is deferred. CPAs enter the broker amount.
- **Holding-period tack-on** per §1091(d) — disallowed loss adds to replacement basis; we don't track the holding-period inheritance.
- **NJ Worksheet D Part I/II** — Line 28a pension exclusion is modeled; the "unused exclusion against other income" path (Line 28b) is not.
- **NY government-pension distinction** — all retirement income goes to NY Line 29 ($20k cap); the unlimited Line 26 path (NY state, federal, military pensions) is not split.
- **HI Schedule J exclusion ratio** — full exemption applied to all 1099-R retirement income (the conservative-for-the-taxpayer interpretation).
- **Phase D** items (CPA-firm auth, S3 storage, SOC 2, Stripe billing) — these are calendar-time projects.

## Where to pick up next session — ranked by value

### Tier 1 (Option-A specific, ship-blocking for a design-partner demo)

1. **Deploy to EC2** — ~15 min, two schema pushes + frontend rsync
2. **CPA-firm multi-tenancy auth (D15)** — 2-3 weeks. The single biggest blocker for a paid design partner. Without it, all firm data shares one URL.
3. **Validate UltraTax `.gen` with a real CPA design partner (C12)** — needs a partner + license
4. **AI extraction accuracy benchmark (C13)** — labeled sample of 100 1099s/W-2s

### Tier 2 (engine polish + UX)

5. **Schedules 1 / 2 / 3 PDF overlay** — templates already bundled, just need the field maps + line-by-line population. ~1 day
6. **Side-by-side AI vs CPA diff view (C14)** in review modal — ~1 day
7. **NY government-pension Line 26 distinction** — new client-level flag or per-1099-R field
8. **HI Schedule J exclusion ratio** for mixed-contributory plans
9. **NJ Worksheet D Part I/II** "unused exclusion vs other income"

### Tier 3 (Phase E — engine completeness, reactive)
See roadmap.md for the full list.

## How to start the next Claude session

Just say: **"Read .claude/handoff.md, .claude/roadmap.md, and CLAUDE.md. What should we work on next?"**

Or pick a specific direction:
- **"Deploy to EC2."** (~15 min with two schema pushes)
- **"Start CPA-firm multi-tenancy auth (Phase D15)."**
- **"Add Schedules 1/2/3 to the IRS Form 1040 PDF overlay."**
- **"Find me a CPA design partner outreach pitch from the Tier 2 roadmap."**
