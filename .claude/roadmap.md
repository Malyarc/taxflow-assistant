# TaxFlow Assistant — Strategic Roadmap (Phase A → E)

**Phase 4 committed: Option A — CPA-tool overlay.** Consumer DIY (Option B) is parked.

This document is the long-arc plan. Live state of the project — what just landed, current test count, which background processes are running — is in `.claude/handoff.md`. Cross-cutting invariants and conventions are in `CLAUDE.md`.

**Read order for any new session:** `.claude/handoff.md` → this file → `CLAUDE.md`.

---

## Phase A — Ship what's done + lay product foundation ✅ **COMPLETE**

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | **Push to GitHub + deploy to EC2** | ✅ Done | Deployed at commit `17a03c2`. Schema push applied. |
| A2 | **AI overlay UX MVP** — upload PDF → AI extract → CPA reviews + approves diff → write to client record (audit-logged) → re-generate `.gen` | ✅ Done | Commit `c026154`. End-to-end CPA workflow live. |
| A3 | **Real IRS Form 1040 PDF layout** — overlay text on the IRS template via `pdf-lib` coordinate fills | ✅ Done | Commit `2ac58e1`. Form 1040 + Schedules 1/2/3 templates bundled at `artifacts/api-server/src/assets/irs-forms-2024/`; 50+ field-path mapping; flatten() for cross-viewer rendering. New "IRS Form 1040 (PDF)" button on Tax Calculator. |

---

## Phase B — High-leverage engine accuracy + product polish ✅ **COMPLETE**

| # | Item | Status | Notes |
|---|---|---|---|
| B4 | **Schedule D per-transaction detail + wash-sale tracking** | ✅ Done | Commit `6eb27c8`. New `capital_transactions` schema, Form 8949 box A-F categorization, broker-reported wash-sale via adjustment code "W" + column g. 12 hand-calced integration tests against Pub 550 + Form 8949 instructions. New "Schedule D" tab. |
| B5 | **CA 540NR non-resident bracket calc** (CA-source / total × CA tax) | ✅ Done | Commit `3c5b5dc`. FTB Form 540NR Schedule CA Part III formula in multi-state pipeline. 5 hand-calced test cases (single + MFJ, 1%/30%/100% allocation). |
| B6 | **Per-property rental table + per-property MACRS** | ✅ Done | Commits `edfa29a` + `780f47e`. New `rental_properties` schema, per-property MACRS (residential 27.5y / commercial 39y, mid-month convention), engine sums + applies §469 PAL. New "Rentals" tab with CRUD UI. 15 tests hand-calced against Pub 946. |
| B7 | **Form 1116 engine integration** | ✅ Done | Commit `0ca50c8`. New `foreign_source_taxable_income` adjustment type; pipeline now passes taxableAfterQbi + incomeTaxOnly to the FTC calculator. 4 new hand-calced cases (binding + non-binding limit, single + MFJ). |
| B8 | **HI / NJ / NY partial retirement-income state exemptions** | ✅ Done | Commit `d82cc9d`. HI full exemption, NJ capped + phased-out by NJ gross income (age 62+), NY $20k/$40k per filer (age 59½+). 22 new unit tests. |
| B9 | **PDF multi-page support in BoundedDocumentViewer** + indicators for pages with extracted fields | ✅ Done | Commit `edbcea2`. pdf-lib loads PDF once per src, renders one page at a time, prev/next nav + page picker showing which pages have extracted fields. Boxes filter to current page. |
| B10 | **W-2 box-arithmetic verify flags** | ✅ Done | Commit `72faa21`. Shared `@workspace/validation` package between server + frontend. New box-arithmetic checks (Box 3 = Box 5 below cap, Box 4 ≈ 6.2% × Box 3, Box 16 ≈ Box 1). Live severity-colored flag chips in review modal. 37 new unit tests. |

---

## Phase C — Design-partner validation + product loop

Run in parallel with Phase B.

| # | Item | Status | Effort |
|---|---|---|---|
| C11 | **Find a CPA design partner** | ❌ Open | Calendar time. Required for C12. |
| C12 | **Validate UltraTax `.gen` against a real UltraTax CS install** | ❌ Open | 1 week of partner time + 2–3 days fixing whatever they find. The `.gen` export is correct in shape but has never been end-to-end imported. |
| C13 | **AI extraction accuracy benchmark** — labeled sample of 100 real 1099s / W-2s, measure per-field precision | ❌ Open | ~1 week. Without numbers, CPAs won't trust the AI output. |
| C14 | **Side-by-side AI vs CPA diff view** in the review modal — currently the original AI value is in a tooltip; should be a visible "before / after" column | ❌ Open | 1 day. UX polish; not blocking but better demo. |

---

## Phase D — Compliance + multi-tenancy

Required before charging real money. **Don't build these speculatively** — start when a paid design partner is committed.

| # | Item | Status | Effort |
|---|---|---|---|
| D15 | **CPA-firm multi-tenancy auth** — organizations + users + RBAC + per-client visibility. Wires `actorUserId` on `audit_log` (already a nullable column). | ❌ Open | 2–3 weeks. The gate to a paid design partner. |
| D16 | **Soft-delete clients + DB-level append-only on `audit_log`** (revoke UPDATE/DELETE for the app role) | ❌ Open | 1 week. Real CPA-audit-defense expectation. Currently `audit_log` cascades on client delete. |
| D17 | **Real document upload + secure S3 storage + encryption at rest** for PII columns; remove the "demo mode" banner | ❌ Open | 2 weeks. Required for any paying customer; documents currently live as base64 in `tax_documents.file_content`. |
| D18 | **Stripe billing + subscription metering + onboarding flow** | ❌ Open | 1–2 weeks. |
| D19 | **SOC 2 Type I prep** + third-party security audit | ❌ Open | 3–6 months calendar, ~$30–60k. Gating for mid-size CPA firms; smaller firms may not require. |

---

## Phase E — Engine completeness (do as customers ask, not speculatively)

Each item is 2–5 days; all are well-documented IRS rules.

**Promoted to immediate priority (decision 2026-05-21 evening):** The four items below are being pulled forward from Phase E to a "Phase B+" batch — they're the highest-frequency remaining engine gaps. Total estimated effort: ~2 weeks to get from ~80% to ~90% of common-return coverage.

### Phase B+ — next session's work

| # | Item | Effort | Status |
|---|---|---|---|
| BP1 | **K-1 detail** (S-corp + partnership, per-K-1 ordinary income + QBI flow-through + passive/active flag + basis tracking) | 3-5 days | ✅ Backend done; new `schedule_k1_data` table + CRUD route; engine wires Box 1/2/3 income, interest/div/cap-gain, SE earnings → Sch SE, §199A QBI, §469 K-1 passive bucket (no $25k allowance, fully suspended), `k1_passive_loss_carryforward` adjustment + auto-load from prior year. 70 pure + 23 integration = 93 hand-calced assertions. **Frontend tab still TODO.** |
| BP2 | **NYC local income tax** (4 brackets per status, separate from NY state) | 2-3 days | ✅ Done. NYC PIT brackets per filing status (single/MFJ/HoH/MFS, verified against NY DTF IT-201-I 2024 page 40), `localityCode` field on client, NYC household credit (line 48) low-FAGI offset, `localTaxLiability` + `localTaxJurisdiction` persist on tax_returns. 15 hand-calced assertions. Frontend: locality dropdown on ClientForm (shown only when state=NY); "Local Tax (NYC)" line on tax-return display. **Not modeled (known limits):** NYC school tax credit (line 69/69b), NYC UBT, MCTMT. |
| BP3 | **AMT preferences detail** — ISO bargain element + state-tax addback (Form 6251 lines 2e + 2g/2h) | 2-3 days | ❌ Open |
| BP4 | **State EITC expansion** to CO + IL + MN + NJ + MA (~1 day each, ~5 days total) | 5 days | ❌ Open |

### Phase E — still reactive (do when a customer asks)

- NOL carryforward + 80% taxable income limit (post-TCJA)
- AMT credit carryforward
- Charitable carryforward (5-year)
- §179 expense election + bonus depreciation
- Foreign income exclusion (§911 FEIE), treaty positions
- HSA Form 8889 detail (testing period, employer contributions)
- 1099-R early-withdrawal 10% penalty + exception codes
- 1099-G (unemployment + state-refund taxability per state)
- Part-year residency in multi-state framework
- Other local income taxes (MD counties, OH cities, IN counties — NYC promoted above)
- State CTCs (varies widely by state)
- State AMTs (CA has its own, e.g.)
- Auto wash-sale detection across accounts (broker-reported is honored today)
- §1091(d) holding-period tack-on after wash sale

Tier D3 — entity returns — **out of scope for Option A**: Form 1041 (trust/estate), 1065 (partnership), 1120/1120-S (corporate / S-corp).

---

## Recommended sequencing (next 3 sessions)

1. **Session 1:** Phase A3 (Real IRS Form 1040 PDF layout) + Phase B9 (PDF multi-page support in the AI overlay). Both visual / demo-able wins; ~3–4 days combined.
2. **Session 2:** Phase B4 (Schedule D per-transaction). Highest engine-accuracy ROI; ~3–5 days.
3. **Session 3:** Phase C11–C13 (design partner + UltraTax validation + AI benchmark) — start the partner outreach in parallel with B5–B8 engine work.

Hold Phase D until a paid design partner is committed. Phase E is reactive.

---

## What I'd NOT do right now

- Build any of Phase E speculatively — each item is fast to ship on demand once a real customer asks.
- Start CPA-firm auth (D15) before validating the workflow with at least one design partner — risk of building the wrong access model.
- SOC 2 prep (D19) before there's a real paying customer requiring it — calendar + cash burn.
- Lacerte / ProConnect / Drake adapter work — `.gen` covers them universally; per-vendor adapters are last-mile polish, not blocking.
