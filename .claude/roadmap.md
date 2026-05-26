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
| C11 | **CPA design-partner outreach packet — research-backed** | ✅ Done (2026-05-26) | Synthesized 20+ industry sources (Journal of Accountancy 2025 tax-software survey, CPA Trendlines 2026 outlook, Thomson Reuters Tax Advisory 2026, NATP fee survey, AICPA stats, IRS preparer data, vendor comparisons) into 3 CPA personas, software-landscape map, and competitor analysis (Holistiplan, Corvee/Instead). Refreshed all 5 existing outreach docs (cold-email / one-pager / demo-script / partner-faq) + added 3 new ones (cpa-persona-research / positioning / gap-analysis / pricing). Packet now leads with Phase G planning module ($93k headline savings on edge-big-ltcg) rather than AI extraction. **Live-partner recruitment is the next step but blocked on user availability, not on packet readiness.** |
| C12 | **UltraTax `.gen` validation** | ✅ Done (2026-05-23) | The audit (`docs/ultratax-audit.md`) found that no documented UltraTax CS file-based import format exists; `.gen` rebranded as a vendor-neutral CPA-review summary; wrong IRS line refs fixed (Sch A mortgage L10→L8a; dropped fictional 1040-L12A); 10-case validation packet of PDF + CSV + TXT now lives in `docs/validation-packet/` for a CPA partner to hand-key into UltraTax and compare. Also caught + fixed a BP3 OpenAPI schema gap (amt_iso_bargain_element + 2 others). |
| C13 | **AI extraction accuracy benchmark** | ✅ Done (2026-05-23); LIVE re-run pending paid quota | Synthetic-corpus generator (25 W-2 + 75 1099 across 8 variants, seeded RNG), pdfkit renderer mimicking IRS box-grid layouts, LIVE + MOCK extractors, per-field scorer, markdown + CSV reports. MOCK sample at `docs/ai-benchmark/`. First real LIVE run on 2026-05-23 hit Gemini Flash free-tier daily quota at request ~25 — W-2 cohort (25 docs) cleanly completed at **precision 97.5% / recall 77.7% / F1 0.865**; preserved under `docs/ai-benchmark/live-partial-2026-05-23/` with analysis in `LIVE-RUN-NOTES.md`. Re-run with paid quota (or after free-tier reset) for a clean 100-doc report. Harness now hardened against 429: 8s→60s exponential backoff per request + 6.5s default inter-request pacing. |
| C14 | **Side-by-side AI vs CPA diff column** in the review modal | ✅ Done (2026-05-23) | Promoted the AI value from a hover tooltip to an always-visible per-field DiffIndicator with four explicit states: ✓ kept (emerald), ✎ changed (amber, `<ai-strike> → <cpa>`), + added by CPA (sky blue), ⊘ cleared (amber, `<ai-strike> cleared`). CPA sees at a glance which fields the AI got right vs which they overrode. Smoke-tested locally; deployed. |

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

### Phase E — Engine completeness (ALL 14 SHIPPED 2026-05-26)

**Shipped (235 hand-calc'd assertions across E1-E14):**
- ✅ **E1** — IL personal exemption AGI cliff ($250k single / $500k MFJ)
- ✅ **E2** — AMT credit carryforward (Form 8801, IRC §53)
- ✅ **E3** — Charitable cash carryforward (IRC §170(d)(1), 5-year)
- ✅ **E4** — HSA Form 8889 detail (employer contrib + §4973(g) excise)
- ✅ **E5** — 1099-R early-withdrawal 10% / 25% penalty (IRC §72(t))
- ✅ **E6** — 1099-G state-refund tax-benefit rule (Pub 525 / IRC §111) + unemployment §85
- ✅ **E7** — §179 expense election + §168(k) bonus depreciation
- ✅ **E8** — NYC School Tax Credit (IT-201 L69) + MCTMT tiered SE tax
- ✅ **E9** — State CTCs for CA / CO / NJ / IL / NM / VT
- ✅ **E10** — State EITC piggybacks for 20 new states (CT/DE/IN/IA/KS/LA/MT/NE/NM/OH/OK/OR/RI/VT/VA/DC/ME/MD/MI + WI tiered)
- ✅ **E11** — PA Schedule SP Tax Forgiveness (61 Pa. Code §111)
- ✅ **E12** — Part-year residency in multi-state framework (pro-rata day-count + both-state resident tax)
- ✅ **E13** — Auto wash-sale detection + §1091(d) basis adjustment (IRC §1091)
- ✅ **E14** — Other local income taxes — 44 jurisdictions (24 MD counties + 10 OH cities + 10 IN counties)

See `docs/phase-e-deferred.md` for the closed-out implementation
notes (kept as historical record).

**Also shipped earlier in K-list / state work (already done before Phase E batch):**
- ✅ NOL carryforward (K4, 80% TCJA limit)
- ✅ FEIE §911 (K9)
- ✅ §121 home-sale exclusion (K6)
- ✅ §1202 QSBS exclusion (K7)
- ✅ Kiddie tax Form 8615 (K8)
- ✅ Additional Medicare 0.9% Form 8959 (K2)
- ✅ Sch SE Line 9 W-2 + SE shared SS wage base (K1)
- ✅ SS taxability worksheet (K10)
- ✅ State AMT (G5 CA Schedule P 540)

**Reactive — only ship when a customer asks:**
- HSA Form 8889 last-month rule (testing period)
- Auto wash-sale detection (broker-reported is honored today)
- §1091(d) holding-period tack-on after wash sale
- State-specific AMT for states other than CA
- IL personal-exemption dependent allowance (engine modeled flat $2,775/filer)

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

## Phase G — Tax Planning Initiative (the upsell tier)

**Strategic context:** With ZERO documented engine gaps as of 2026-05-26,
the engine itself is a strong product. The natural next move is to flip
TaxFlow from "data-keying tool" to "revenue-generating advisory tool"
by surfacing tax-planning opportunities per client and producing a
CPA-facing hit list of best clients to upsell into planning engagements.

Rough revenue math justifying the build: planning fees are $750–$3,000
per engagement. For a CPA with 80 clients, top 20 × 40% conversion ×
$1,800 average = ~$14,400 of new annual revenue from this feature. We
charge a Pro tier ($2,500/month vs Standard $1,000/month); pays for
itself on 2 engagements. This is a high-margin, high-stickiness module.

**Two-layer architecture:**

1. **Deterministic opportunity detector** (no LLM; rule-based on
   already-modeled engine data). Each rule: applies/estimated-savings/
   confidence/action-summary/cpa-effort-hours.
2. **AI synthesis** (Gemini): consume the structured opportunity list +
   client context → write planning memo + outreach email + flag missing
   data. Math stays deterministic; LLM only narrates and ranks.

### Phase G1 — Deterministic opportunity detector ✅ **DONE (2026-05-26)**

All 10 rules shipped (G1.1 through G1.10). New endpoint
`/api/clients/:id/planning-opportunities`. New "Planning" tab in
ClientDetail (10th tab). 121 hand-calced tests + 18 integration
tests against live API. Architecture: deterministic detector engine
at `artifacts/api-server/src/lib/planningEngine.ts`, versioned catalog
at `lib/planning-strategies/strategies-v1.json` with fail-fast
validator at module load. Seed script `scripts/src/seed-dummy-clients.ts`
ingests 85 archetypes for demos.

The 10 ship rules (in priority order — highest avg savings × highest
client prevalence × lowest implementation complexity):

| # | Rule | Trigger | Avg savings |
|---|---|---|---|
| G1.1 | SEP-IRA / Solo 401(k) for SE filer | `netSeIncome > 30k && no retirement adjustment` | $3k–$15k |
| G1.2 | PTET election for SALT cap | S-corp/K-1 client in NY/CA/NJ/CT/MA + SALT capped | $5k–$50k |
| G1.3 | Bunching itemized | `itemized within ±15% of std-ded threshold` | $1k–$3k/cycle |
| G1.4 | Roth conversion window | Marginal rate < 24% + traditional IRA balance > 0 | $5k–$30k |
| G1.5 | AMT timing (ISO) | `amtTax > 0 && amt_iso_bargain_element > 0` | $5k–$50k |
| G1.6 | NIIT cliff avoidance | AGI band $190k–$210k single / $240k–$260k MFJ | $500–$2k |
| G1.7 | §199A wage/UBIA limit (K-1) | K-1 client just above QBI threshold | $2k–$20k |
| G1.8 | Charitable DAF bunching | `charitableCash > 5k && marginal rate ≥ 32%` | $1k–$10k |
| G1.9 | Tax-loss harvesting | Unrealized losses + capital-loss carryforward < $3k | Variable |
| G1.10 | Foreign Tax Credit unclaimed | `foreign_tax_paid > 0 && no FTC adjustment` | Variable |

### Phase G2 — Composite scoring + CPA hit list ✅ **DONE (2026-05-26)**

PlanningScore implemented per spec:
```
score = (Σ hits of estSavings × confidence × stickinessWeight)
      × marginalRateWeight × engagementComplexityWeight
```
where marginalRateWeight = 1 + max(0, marginal − 0.22) × 5,
engagementComplexityWeight = 1 + log(1 + numHits) × 0.3,
stickinessWeight = 1.5 if recurring else 1.0.

New endpoint `GET /api/planning-hit-list` with optional ?category /
?state / ?minAgi / ?maxAgi / ?limit filters. Dashboard now shows a
"Top 10 planning targets" widget (each row links to that client's
Planning tab). 12 new unit tests cover scoring helpers + composite
formula.

### Phase G3 — AI synthesis ✅ **DONE (2026-05-26)**

`generatePlanningMemo`, `generateClientOutreachEmail`, and
`inferMissingData` in `artifacts/api-server/src/lib/planningMemo.ts`.
Strict system prompts forbid LLM number invention / speculation /
adding opportunities not in the supplied list. Three GET endpoints:
`/planning-memo`, `/planning-email`, `/planning-missing-data`. Frontend
"Generate AI memo" button on the Planning tab lazy-loads all three.
**Deterministic stub fallback** when aiEnabled === false (no AI key) —
identical section structure, no LLM dependency. `AI_PLANNING_MODEL`
env var overrides default model (set to `gemini-2.5-pro` for higher-
quality narration on the Pro tier).

### Phase G4 — Multi-year intelligence ✅ **DONE (2026-05-26)**

5 multi-year detectors shipped in `planningEngineMultiYear.ts`:
- **G4.1 — Persistent NIIT exposure** (IRC §1411): fires when NIIT > 0
  in current AND ≥1 prior year. estSavings = avg NIIT × 0.5
- **G4.2 — Persistent AMT exposure** (IRC §55-§59): fires when AMT > 0
  in current AND ≥1 prior year. estSavings = avg AMT × 0.4
- **G4.3 — Permanent bunching strategy** (IRC §170): fires when Sched A
  line items sum within ±15% of std-ded for current AND ≥1 prior year,
  with charity > 0 currently. estSavings = stdDed × 0.25 × marginal
  (multi-year confidence 0.90 vs G1.3's 0.80). Uses sum of per-line
  Sched A columns rather than the persisted itemizedDeductions (which
  is null when std-ded chosen — the exact pattern G4.3 needs to detect).
- **G4.4 — Capital loss carryforward unused** (IRC §1211/§1212): fires
  when total cap-loss cf > $20k AND not materially declining YoY
  ($3,500 tolerance covers the IRC §1211 auto-$3k/yr offset).
  estSavings = min(cf, $20k) × marginal
- **G4.5 — Passive activity loss suspension growing** (IRC §469): fires
  when total suspended PAL (Sched E + K-1) > $5k AND grew YoY.
  estSavings = growth × marginal × 0.5

New endpoint `GET /api/clients/:id/planning-multi-year` loads
tax_returns history (most-recent first), runs the evaluator, returns
`{ hits, totalEstSavings, yearsAvailable, yearsCovered, catalogVersion,
taxYear }`. Returns empty hits with a UI hint when only 1 year of
history is persisted.

Frontend: new "Multi-year trends" section on the Planning tab below the
G1 cards. Indigo-bordered cards (visually distinct from G1's emerald).
Collapses to a short dashed-border hint when history is insufficient.

Seed extension: `seed-dummy-clients.ts` now ingests 2 years per
archetype (existing data as TY2024 prior, scaled 1.05× as TY2025
current) and POSTs /tax-return for both years. Idempotent. Pass
`--no-multi-year` to skip. 3 dedicated G4 demo archetypes added
(g4-bunching-mfj, g4-cap-loss-cf, g4-pal-growth-mfj) — one per
detector whose pattern doesn't naturally appear in the other 85
archetypes.

Tests: 70 hand-calc'd unit assertions + 11 new integration assertions
(persistent NIIT firing through API, single-year empty hits, 404).
All 133 G1 unit + 29 planning integration + 210 deep audit still pass.

### Phase G5 — Pro tier feature flag ✅ **DONE (2026-05-26)**

Env-var gate on every planning surface. Default `PRO_TIER_ENABLED=true`
preserves existing demo behavior; set to `false` to gate ahead of
pricing rollout.

- New endpoint `GET /api/settings` returns `{ proTierEnabled }`.
- New module `artifacts/api-server/src/lib/config.ts` parses the env
  var once at startup. `parseBoolEnv()` accepts true/1/yes/false/0/no
  (case-insensitive), falls back to a passed default for anything else.
- Planning router middleware returns HTTP 402 Payment Required with
  `{ code: "PRO_TIER_REQUIRED" }` body on all 6 planning endpoints
  (planning-opportunities, planning-multi-year, planning-memo,
  planning-email, planning-missing-data, planning-hit-list) when off.
- Frontend gating via `useGetSettings`:
  - Dashboard: Top-10 widget swaps to `<UpgradeProCard variant="widget" />`
  - ClientDetail: Planning tab + content hidden, grid drops from
    `grid-cols-10` to `grid-cols-9`
  - Gates only when `proTierEnabled === false` (not on loading state)
    so existing Pro firms don't see a flash of "no Planning" while
    the settings request is in flight.
- New `<UpgradeProCard>` component renders the upsell card with the
  feature list (10 G1 rules, 5 G4 multi-year, AI memo, hit list).
  CTA button is a disabled visual placeholder; real billing is D18.
- 21 new dual-state integration assertions in
  `scripts/src/tax-engine-pro-tier-tests.ts`. Adapts to whichever
  state the server is in: 5 on-state OR 16 off-state. Run twice
  (once per state) for full coverage.

Stripe billing flow (D18) is still deferred. Phase G is now fully
complete (G1+G2+G3+G4+G5).

### Phase G — additional rule set (deferred to G6+ as customer-driven)

These rules are valuable but ship later as customers ask:

- §121 home-sale planning (large appreciation → time the sale)
- §1202 QSBS holding-period tracking
- HSA optimization (high-income HDHP not maxing)
- State residency change analysis (CA/NY → FL/TX/WA)
- Kiddie-tax income shifting (Roth IRA for child's earned income, etc.)
- Estate planning (gift tax exclusion utilization)
- Education / 529 / dependent-care optimization
- Wash sale avoidance coaching
- §1091(d) holding-period after wash sale
- Mega-backdoor Roth detection
- Saver's Credit + EITC missed-credit alerts
- §163(j) interest-expense limit (business clients)
- Cost-segregation studies for real estate
- §1031 like-kind exchange identification

**Total ship effort for G1+G2+G3+G4+G5: ~6 weeks.** Phase G1 alone is
enough to demo to a design partner as the "planning superpower" pitch.

---

## Recommended sequencing (next 3 sessions)

(As of 2026-05-26 — Phases A, B, B+, C12, C13, C14 + adversarial
accuracy audit + DEEP audit + security & code-quality batch + Phase G
(G1+G2+G3+G4+G5) all complete. **ZERO documented federal or state
engine gaps remain** (all 10 K-list + all 4 G-list closed end-to-end
during 2026-05-23 → 2026-05-26). CPA design-partner outreach packet
(C11) drafted in `docs/outreach/`.)

1. **Session N (now next) — recommended: LIVE CPA outreach campaign.**
   The C11 outreach packet is complete (research-synthesized, refreshed
   for Phase G). Next move requires user (John) availability: build
   target list of 30-50 Persona-2 firms in CA/NY/IL/NJ/MA, send the
   refreshed cold email, run 5-10 demos using the new demo script, close
   1 paid pilot at $500/mo for 30 days. See `docs/outreach/positioning.md`
   "Outreach prioritization" section for target-firm selection criteria
   and `docs/outreach/cpa-persona-research.md` for empirical backing.

2. **Session N+1 — Phase D15 multi-tenancy auth (~2-3 weeks).**
   Required before charging real money. Wires `actorUserId` into
   audit_log (column already exists, nullable). Per-firm tables,
   RBAC, per-client visibility. Hold until a paid partner is
   committed; this is the gate to billing.

3. **Session N+2 — Phase D18 Stripe billing (1-2 weeks).** The G5
   Pro-tier feature gate is already in place; D18 plugs the per-firm
   `proTierEnabled` column (added in D15) into a Stripe subscription
   state. Migrate the env-var flag to a per-firm column when the first
   paid customer signs.

4. **Session N+3+ — Phase E reactive items + Phase D16/D17/D19 on a
   real customer's schedule.** (Charitable carryforward, AMT credit
   carryforward, §179, 1099-R penalty, part-year residency, other
   local taxes; soft-delete, S3 encryption, SOC 2 Type I.)

Hold Phase D until a paid design partner is committed. Phase E and
Phase 5 are reactive. Phase G is now complete (G1+G2+G3+G4); only G5
Pro-tier flag remains as a "before pricing rollout" gate.

---

## What I'd NOT do right now

- Build any of Phase E speculatively — each item is fast to ship on demand once a real customer asks.
- Start CPA-firm auth (D15) before validating the workflow with at least one design partner — risk of building the wrong access model.
- SOC 2 prep (D19) before there's a real paying customer requiring it — calendar + cash burn.
- Lacerte / ProConnect / Drake adapter work — `.gen` covers them universally; per-vendor adapters are last-mile polish, not blocking.
