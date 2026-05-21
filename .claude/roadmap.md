# TaxFlow Assistant — Strategic Roadmap (Phase A → E)

**Phase 4 committed: Option A — CPA-tool overlay.** Consumer DIY (Option B) is parked.

This document is the long-arc plan. Live state of the project — what just landed, current test count, which background processes are running — is in `.claude/handoff.md`. Cross-cutting invariants and conventions are in `CLAUDE.md`.

**Read order for any new session:** `.claude/handoff.md` → this file → `CLAUDE.md`.

---

## Phase A — Ship what's done + lay product foundation

| # | Item | Status | Notes |
|---|---|---|---|
| A1 | **Push to GitHub + deploy to EC2** | ✅ Done | Deployed at commit `17a03c2`. Schema push applied. |
| A2 | **AI overlay UX MVP** — upload PDF → AI extract → CPA reviews + approves diff → write to client record (audit-logged) → re-generate `.gen` | ✅ Done | Commit `c026154`. End-to-end CPA workflow live; first product-level Option A deliverable. |
| A3 | **Real IRS Form 1040 PDF layout** — overlay text on the IRS template via `pdf-lib` coordinate fills | ❌ Open | 2–3 days. CPAs + clients want the actual IRS form, not the current summary. |

---

## Phase B — High-leverage engine accuracy + product polish

| # | Item | Status | Effort |
|---|---|---|---|
| B4 | **Schedule D per-transaction detail + wash-sale tracking** | ❌ Open | 3–5 days. Highest-frequency D1 engine gap; active investors are a big CPA client segment. |
| B5 | **CA 540NR non-resident bracket calc** (CA-source / total × CA tax) | ❌ Open | 2–3 days. Currently uses resident brackets → overstates NR CA tax. |
| B6 | **Per-property rental table + per-property MACRS** | ❌ Open | 1–2 days. Real CPAs want per-property tracking, not aggregate Schedule E. |
| B7 | **Form 1116 engine integration** — add `foreign_source_taxable_income` adjustment type + wire the FTC calculator's Form 1116 path | ❌ Open | 1 day. Calculator path already in (commit `ff5c88a`); just needs the input plumbing. |
| B8 | **HI / NJ / NY partial retirement-income state exemptions** | ❌ Open | 2 days. Matches the PA / IL / MS work already done. |
| B9 | **PDF multi-page support in BoundedDocumentViewer** + thumbnail strip; route boxes to the correct page | ❌ Open | 1–2 days. AI overlay is single-page-only today. |
| B10 | **W-2 box-arithmetic verify flags** — flag values that violate Box 3 + 7 ≈ Box 1 (etc.) in the review modal | ❌ Open | 1 day. Free quality signal in lieu of real AI confidences. |

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

- K-1 detail (S-corp + partnership, passive-activity flags, basis tracking)
- AMT preferences detail (state-tax addback, ISO bargain element, depreciation difference)
- NOL carryforward + 80% taxable income limit (post-TCJA)
- AMT credit carryforward
- Charitable carryforward (5-year)
- §179 expense election + bonus depreciation
- Foreign income exclusion (§911 FEIE), treaty positions
- HSA Form 8889 detail (testing period, employer contributions)
- 1099-R early-withdrawal 10% penalty + exception codes
- 1099-G (unemployment + state-refund taxability per state)
- Part-year residency in multi-state framework
- Local income taxes (NYC, MD counties, OH cities, IN counties)
- State EITC expansion (CO, IL, MA, MN, NJ, etc. — CA + NY done)
- State CTCs (varies widely by state)

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
