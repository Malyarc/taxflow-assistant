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
| C11 | **Find a CPA design partner** | ❌ Open | Calendar time. Required for C12 hand-off. |
| C12 | **UltraTax `.gen` validation** | ✅ Done (2026-05-23) | The audit (`docs/ultratax-audit.md`) found that no documented UltraTax CS file-based import format exists; `.gen` rebranded as a vendor-neutral CPA-review summary; wrong IRS line refs fixed (Sch A mortgage L10→L8a; dropped fictional 1040-L12A); 10-case validation packet of PDF + CSV + TXT now lives in `docs/validation-packet/` for a CPA partner to hand-key into UltraTax and compare. Also caught + fixed a BP3 OpenAPI schema gap (amt_iso_bargain_element + 2 others). |
| C13 | **AI extraction accuracy benchmark** | ✅ Done (2026-05-23) | Synthetic-corpus generator (25 W-2 + 75 1099 across 8 variants, seeded RNG), pdfkit renderer mimicking IRS box-grid layouts, LIVE + MOCK extractors (LIVE uses the same Gemini prompts as `documentExtractor.ts`), per-field TP/FP/FN/TN scorer, CPA-presentable markdown + CSV reports. Sample MOCK output shipped under `docs/ai-benchmark/`. Real numbers via `pnpm --filter @workspace/scripts exec tsx src/ai-benchmark/run.ts` on a host with `AI_API_KEY`. |
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
| BP3 | **AMT preferences detail** — ISO bargain element + state-tax addback (Form 6251 line 2g + 2k) | 2-3 days | ✅ Done. Engine auto-derives the line 2g SALT addback from the itemized SALT we already compute (only when itemizing); `amt_iso_bargain_element` adjustment feeds line 2k; `amt_state_tax_addback_override` adjustment can replace the auto value for unusual cases. Legacy `amt_preferences` catch-all continues. 16 hand-calced assertions covering SALT on/off (std vs itemized), override, ISO small + binding, combined, MFJ. No schema or UI changes (adjustment-based). |
| BP4 | **State EITC expansion** to CO + IL + MN + NJ + MA (~1 day each, ~5 days total) | 5 days | ✅ Done. CO 50% (HB24-1134 one-time TY2024 bump; TY2025=35%, TY2026=25%) — user's "25%" was the pre-2024 rate. IL 20% (PA 102-0700 since TY2023). NJ 40% (since TY2020). MA 40% (Ch. 50 Acts 2023). MN Working Family Credit via Schedule M1CWFC 2024: 4% × min(earned, $9,220) base + child add-ons (+$970 / +$2,210 / +$2,630 for 1/2/3+); phase-out 12% above $31,090 ($36,880 MFJ); $11,600 investment-income limit. 21 hand-calced assertions. **Known limits:** NJ 18+/65+ expansion to childless filers not auto-applied (CPA can enter as manual credit); MA part-year proration not modeled; MN "qualifying older children" approximated as federal-EITC qualifying-children count (close but not exact for mixed-age dependents); MN phase-out uses 12% (skips the 9% carve-out for older-children-only filers). |

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

## Phase 5 — Real UltraTax / CPA-software integration

**Don't build any of these speculatively.** Start *only* when a paid design
partner has explicitly asked for file-based ingestion as a blocker. The C12
audit (`docs/ultratax-audit.md`) confirmed UltraTax CS has no public
file-based import format for completed 1040 returns — every option is a
multi-month lift. Documented here so future sessions know the option space.

| # | Path | Effort | Notes |
|---|---|---|---|
| P5a | **License SurePrep's API** | 2-3 wks post-contract | SurePrep is the Thomson Reuters-owned ingestion partner for UltraTax. Cleanest commercial path; pricing for a pre-revenue tool will likely be the blocker. |
| P5b | **Reverse-engineer SDE XML schema** | 4-6 wks + ongoing | Inspect SDE local XML files on a partner CPA's workstation; build an emitter against the schema. Risky: undocumented; may require digital signature; may change per UltraTax release. |
| P5c | **UI-automation helper** (GruntWorx Agent style) | 6-10 wks + high maintenance | Desktop helper driving SDE GUI via AutoIt / pywinauto. Doesn't need Thomson Reuters cooperation but brittle. |
| P5d | **Per-vendor adapters** (Lacerte / ProConnect / Drake) | wks each | Same audit verdict applies — none of them have public 1040 import formats. Same three paths. |

The pragmatic recommendation is to ship **none of these** until a paying
customer specifically requires file-based ingestion. PDF + CSV +
hand-keyed validation (the path the C12 validation packet supports)
unblocks the first design partner.

---

## Recommended sequencing (next 3 sessions)

(As of 2026-05-23 — Phases A, B, B+, C12, C13 all complete.)

1. **Session 1 (now next):** C11 partner outreach (calendar time, not code). In parallel: C14 (side-by-side AI vs CPA diff view in the review modal — 1 day) for a more polished demo.
2. **Session 2:** Begin Phase D15 (CPA-firm multi-tenancy auth) once a paid design partner is committed. Don't start speculatively.
3. **Session 3:** Continue Phase D depending on what the partner asks for first (D16 audit-log hardening, D17 S3 + encryption, or D18 Stripe billing).

Hold Phase D until a paid design partner is committed. Phase E and Phase 5 are reactive.

---

## What I'd NOT do right now

- Build any of Phase E speculatively — each item is fast to ship on demand once a real customer asks.
- Start CPA-firm auth (D15) before validating the workflow with at least one design partner — risk of building the wrong access model.
- SOC 2 prep (D19) before there's a real paying customer requiring it — calendar + cash burn.
- Lacerte / ProConnect / Drake adapter work — `.gen` covers them universally; per-vendor adapters are last-mile polish, not blocking.
