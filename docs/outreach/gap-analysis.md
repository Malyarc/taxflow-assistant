# Gap Analysis — what CPAs ask for that TaxFlow doesn't have

Honest assessment of what TaxFlow lacks vs. what the research in
`cpa-persona-research.md` says CPAs actually want. Each gap is
labeled with one of three statuses:

- **🟢 IN ROADMAP** — planned, sequenced, known when it ships
- **🟡 DELIBERATE** — out of scope per Option A (CPA-tool overlay)
- **🔴 OPEN QUESTION** — CPA feedback needed to decide

Use this doc when a prospect asks "do you do X?". The answer is
honest: "yes, today" / "yes, on the roadmap (timeline)" / "no, by
design (here's why)" / "we're still deciding".

---

## What we have today (no gap)

These are the items already shipped and visible in production. When a
prospect asks for them, demo them.

| Feature | Status | Notes |
|---|---|---|
| AI extraction from W-2 / 1099 / K-1 / 1098-E / SSA-1099 PDFs | ✅ Done (A2) | 97.5% precision live-tested |
| CPA review before any value lands in the client record | ✅ Done (A2 + C14) | Per-field diff: ✓ kept, ✎ changed, + added, ⊘ cleared |
| Federal tax engine (1040, Sch 1-3, A, B, C, D, E, SE) | ✅ Done | Zero documented gaps |
| Federal AMT (Form 6251 — incl. LTCG preferential rates) | ✅ Done | K3 closed |
| Federal NIIT (Form 8960) | ✅ Done | |
| Additional Medicare 0.9% (Form 8959) | ✅ Done | K2 closed |
| Self-Employed Health Insurance (Form 7206) | ✅ Done | K5 closed |
| §121 home-sale exclusion ($250k/$500k) | ✅ Done | K6 closed |
| §1202 QSBS exclusion ($10M/10× basis) | ✅ Done | K7 closed |
| Kiddie tax (Form 8615) | ✅ Done | K8 closed |
| FEIE §911 (Form 2555 — expat earned income exclusion) | ✅ Done | K9 closed |
| SS taxability worksheet (Pub 915 0/50/85%) | ✅ Done | K10 closed |
| NOL carryforward (post-TCJA 80% limit) | ✅ Done | K4 closed |
| Schedule D per-transaction + Form 8949 + wash sale | ✅ Done | B4 |
| Schedule E per-property + MACRS + §469 PAL | ✅ Done | B6 |
| Schedule K-1 (1065 + 1120-S, Box 1/2/3/14A + §199A QBI + passive bucket) | ✅ Done | BP1 |
| Form 1116 Foreign Tax Credit (binding + non-binding limit) | ✅ Done | B7 |
| ACA Premium Tax Credit (Form 8962) | ✅ Done | Phase 1.5 |
| Education credits (AOC refundable 40% + LLC) | ✅ Done | |
| CTC / ACTC / EITC / Saver's Credit / Dep Care | ✅ Done | |
| Multi-state — resident + non-resident with resident credit | ✅ Done | |
| CA 540NR non-resident bracket calc | ✅ Done | B5 |
| NYC personal income tax | ✅ Done | BP2 |
| State EITC piggybacks (CA/NY/CO/IL/NJ/MA + MN WFC) | ✅ Done | BP4 |
| HI/NJ/NY/PA/IL/MS retirement-income state exemptions | ✅ Done | B8 |
| Real IRS Form 1040 PDF output (pdf-lib overlay) | ✅ Done | A3 |
| 10 G1 single-year planning detectors (SEP-IRA, PTET, etc.) | ✅ Done | Phase G1 |
| Firm-wide planning hit list (Top 10) | ✅ Done | Phase G2 |
| AI-drafted CPA memo + client outreach email + missing-data list | ✅ Done | Phase G3 |
| 5 G4 multi-year detectors (persistent NIIT/AMT, std-ded cliff, etc.) | ✅ Done | Phase G4 |
| Pro tier feature flag (PRO_TIER_ENABLED env var) | ✅ Done | Phase G5 |
| Vendor-neutral CPA-review .gen export | ✅ Done | C12 |
| Independent triple-track audit (security, code, tax engine) | ✅ Done | 2026-05-23 |

---

## 🟢 IN ROADMAP — what's coming

### D15 — CPA-firm multi-tenancy auth (2-3 weeks)
**Why it matters.** Multi-partner firms (Persona 2 and up) need
per-user accounts, RBAC, and per-client visibility. Without this,
TaxFlow is single-tenant only. Required before charging real money.

**Status.** Open, held until paid design partner committed.

### D16 — Soft-delete + DB-level append-only audit_log (1 week)
**Why it matters.** Real CPA audit-defense expectation. Currently
`audit_log` cascades on client delete; CPAs need tamper-evident
audit trails.

### D17 — S3 storage + encryption at rest for PII (2 weeks)
**Why it matters.** Documents currently live as base64 in
`tax_documents.file_content`. Real customers can't ship PII through
that path. Removes the "demo mode" banner.

### D18 — Stripe billing + subscription metering (1-2 weeks, needs D15)
**Why it matters.** G5 already wires the Pro-tier gate; D18 migrates
the env-var flag to a per-firm column and plugs into Stripe.

### D19 — SOC 2 Type I prep (3-6 months calendar, $30-60k)
**Why it matters.** Mid-size firms (Persona 3) gate procurement on
this. Smaller firms don't always require it.

### Phase E — Reactive engine completeness (only when customer asks)
- AMT credit carryforward
- Charitable carryforward (5-year)
- §179 expense election + bonus depreciation
- HSA Form 8889 detail (testing period, employer contributions)
- 1099-R early-withdrawal 10% penalty + exception codes
- 1099-G (unemployment + state-refund taxability)
- Part-year residency in multi-state framework
- Other local income taxes (MD counties, OH cities, IN counties)
- State CTCs (CA, CO, NJ, IL, NM, VT not modeled)
- Most state EITC (~20 states not modeled)
- PA Schedule SP Tax Forgiveness; IL personal-exemption phase-out
- NYC school tax credit + UBT + MCTMT
- Auto wash-sale detection across accounts (broker-reported is honored)

### Phase G6+ — Reactive planning detectors (only when customer asks)
- §121 home-sale planning (engine done; detection rule deferred)
- §1202 QSBS holding-period tracking
- HSA optimization (high-income HDHP not maxing)
- State residency change analysis (CA/NY → FL/TX/WA)
- Kiddie-tax income shifting
- Estate planning (gift exclusion utilization)
- Education / 529 / dependent-care optimization
- Wash sale avoidance coaching
- Mega-backdoor Roth detection
- Saver's Credit + EITC missed-credit alerts
- §163(j) interest-expense limit (business clients)
- Cost-segregation studies for real estate
- §1031 like-kind exchange identification

---

## 🟡 DELIBERATE — out of scope by design (Option A overlay strategy)

These are things CPAs sometimes ask for, but we **deliberately don't
build** because the overlay strategy depends on them living in other
systems.

### E-filing
**CPAs e-file through their existing software (Drake / Lacerte /
ProConnect / UltraTax).** Re-implementing the IRS e-file approval
process is a multi-year regulatory project we will not undertake.
Our `.gen` export is the bridge: the CPA reviews TaxFlow's computed
return, hand-keys or imports into their existing software, files
through that.

If a prospect says "we want e-filing" — they're a wrong-fit
prospect. They want a tax-prep replacement, not an overlay.

### Practice management / client portal / e-sign / billing
**TaxDome / Karbon / Canopy own this space.** They start at $58/mo
and do it well. We don't compete.

The CPA already has a client portal for document collection,
e-sign, and billing. We sit alongside it: client uploads docs to
TaxDome, CPA pulls them into TaxFlow for AI extraction + planning.

### Tax-prep software replacement
**Drake/Lacerte/ProConnect/UltraTax own this space.** We don't
replicate their depth (every state form, every county return, every
schedule variant). We add an AI layer on top of them.

### File-based UltraTax import (`.gen` is rebranded as vendor-neutral)
Per the C12 audit (`docs/ultratax-audit.md`), **no public UltraTax
import format exists.** SurePrep API is the only commercial path
(P5a), 2-3 weeks post-contract pricing TBD. We will not build SurePrep
integration speculatively.

The 10-case validation packet (`docs/validation-packet/`) is the
substitute: CPA hand-keys 10 cases into UltraTax, compares numbers
line-by-line. Once a paid customer asks, P5a becomes feasible.

### Form 1041 (trust/estate), 1065 (partnership) prep, 1120/1120-S (corp) prep
**TaxFlow handles 1040 only.** K-1 ingestion from 1065/1120-S is
supported (Schedule K-1 tab); generating the underlying 1065/1120-S
return is not. This is Tier D3 in the roadmap — out of scope for
Option A.

If a prospect wants entity-return prep, they're not a fit. We're a
1040 advisory overlay.

---

## 🔴 OPEN QUESTIONS — need CPA feedback to decide

These are real gaps where we don't have enough information to
prioritize. The design partner conversation should resolve them.

### 1. How important is "per-client custom dashboards" for the planning module?
We have a firm-wide hit list (G2) and per-client tab (G1). Some CPAs
might want intermediate granularity — e.g., "all my CA business-owner
clients ranked by PTET savings".

**What we'd build if confirmed.** Saved filter views + custom KPI
columns. Maybe ½ week of work.

### 2. Do CPAs want a "client-facing" view of the planning memo?
Today the memo is CPA-facing markdown. Some CPAs might want a
branded, client-ready PDF they hand directly to the client.

**What we'd build if confirmed.** A `/clients/:id/planning-memo/pdf`
endpoint with the firm's logo + branded styling. ~1 week.

### 3. Is per-state planning rule customization needed?
G1.2 (PTET) only fires in the 35-state set. CPAs in TX/FL/NV/WA/WY
(no income tax) don't see PTET hits because those states don't have
PTET. But they might want state-specific rules of their own
(e.g., TX franchise tax planning).

**What we'd build if confirmed.** A "firm-custom rules" extension to
the catalog. ~2-3 weeks.

### 4. How critical is the AI memo's tone / persona customization?
Today the LLM produces a neutral-professional memo. Some firms might
want it tuned to their voice ("warm", "concise", "technical-detail
heavy").

**What we'd build if confirmed.** A firm-level "tone profile" passed
to the synthesis prompt. ~½ week.

### 5. Is there value in a "planning history" view per client?
Each year's planning hits are recomputed from current tax_returns
rows. We don't currently store snapshots of "what we recommended in
TY2024 vs TY2025". A history view would let CPAs say "we recommended
X last year, here's whether the client acted on it."

**What we'd build if confirmed.** Persisted `planning_snapshots`
table + UI for compare. ~1-2 weeks. (Already noted as a future
extension in the Phase G plan.)

### 6. How much do CPAs care about the `.gen` file vs. just the PDF + CSV?
The C12 audit concluded there's no UltraTax import format. We ship
`.gen` as a vendor-neutral text summary. If CPAs never use it (they
prefer PDF + manual keying), we should retire the `.gen` and reduce
maintenance surface.

**What we'd do if confirmed.** Either kill `.gen` or invest in
SurePrep API (P5a) if they DO want real import.

---

## How to use this doc in outreach

When a prospect asks **"do you do X?"**:

1. Check the "today" table — if listed, **demo it on the call**.
2. Check the IN ROADMAP section — if listed, say **"shipping in
   [phase], usually [N] weeks once a paid pilot is signed"**.
3. Check the DELIBERATE section — if listed, say **"by design — we
   sit on top of [Drake/TaxDome], not replace it"**.
4. Check the OPEN QUESTIONS — if listed, say **"good question, that's
   something we're sizing based on design-partner feedback. What's
   the workflow that would matter for you?"** — then capture the
   answer to inform the priority.

**Never bluff.** If the answer is "no, not today, not on the roadmap,
not in scope", say it. CPAs respect honesty and have malpractice
exposure that makes them allergic to over-promising vendors.
