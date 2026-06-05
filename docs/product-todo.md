# Product TODO — prioritized (enhancements + fixes)

**As of 2026-06-05.** The single working to-do for TaxFlow Assistant, prioritizing
**enhancements to the current app** and **fixes**. Consolidates the 2026-06-02
product audit (`product-assessment-2026-06-02.md`), the Haven migration roadmap
(`haven-migration-roadmap.md`), `todo.md` (now a historical log), the engine
coverage / planning / extraction / UltraTax analyses, and the compliance gate
(`compliance/README.md`).

**How to read this:** items are `[ENH]` (new/expanded capability) or `[FIX]`
(wrong/stale/risky to correct), tagged with rough effort and whether the value
**ports to Haven** (the engine + planning brain migrate into the Haven app 1:1;
auth/frontend/EC2 infra do not). Check off as you go; keep `computeTaxReturnPure`
pure and don't churn the `TaxReturnInputs`/`ComputedTaxReturn` I/O contract.

Strategic frame: the engine + planning brain are strong and rare ("LLM never
touches the math"); the standalone shell is being wound down in favor of porting
the brain into Haven. So **prioritize enhancements that survive the migration**,
fix the correctness/credibility/time-bomb issues, and treat the revenue gate as
operator/legal work (P0) that's yours, not engineering.

---

## P0 — Fixes & gate-closers (do first)

### Quick fixes (hours — correctness / honesty / doc drift)
- [ ] `[FIX]` **Stale "UltraTax CS / Lacerte / ProConnect / Drake friendly" comment** at `routes/tax-returns.ts:647` (CSV route) — the exact framing the C12 audit deemed misleading; the export builders were corrected but this comment was missed. (~5 min)
- [ ] `[FIX]` **Refresh `docs/coverage-matrix.md`** — it's stale: says §199A wage/UBIA cap "not modeled" (it shipped, `taxCalculator.ts` `qbiPhaseInBand`/`wageUbiaLimit`); also doesn't reflect closed local items (NYC UBT, KY occupational, OH cross-city credit, IN per-dependent exemption). (~30 min)
- [ ] `[FIX]` **`ONBOARDING.md` referenced but absent** — CLAUDE.md ("Where to look first") points at a file that was never committed. Either create it (brief kickoff/vision) or drop the pointer. (~15 min)
- [ ] `[FIX]` **Verify §121-remainder → NIIT base** — `todo.md` lists it open; CLAUDE.md says the NIIT base was rebuilt to include the §121 remainder (2026-05-28 H-2/M-1). Confirm via a scenario; if covered, close the stale note. (~30 min)
- [ ] `[FIX]` **De-risk the planning detector registry** — `planningEngine.ts` hand-wires ~96 detectors in a long `if (hit) hits.push(hit)` sequence; the audit claims a missing push silently drops a strategy (alleged 4 catalog IDs unreachable). Add a no-API test asserting **every catalog strategyId is reachable by at least one detector** (or derive the push list from the catalog). Protects the Haven-bound engine. (~½ day)

### Revenue gate — operator/legal (NOT engineering; nothing real ships until closed)
> No real client PII may touch the app until ALL of these close (see `compliance/README.md`). All app-layer code controls (auth gate, §7216 consent gate, PII field-encryption, CI, WISP doc) already shipped 2026-06-03; what remains is operator/infra/legal.
- [ ] `[FIX]` **Rotate the leaked Neon + Gemini credentials** (P0-1, YOU) — runbook `compliance/runbook-p0-1-rotate-credentials.md`. The one red item. (~1 day)
- [ ] `[ENH]` **S3 + SSE-KMS for the document blob** (P0-5 blob gap / D2-D17) — `tax_documents.file_content` is still base64 **plaintext carrying the SSN**; field-encryption covers only the SSN/TIN columns. **P0-blocking.** Runbook B. (~2 wks; ports to Haven as the same "solve once on whichever side holds PII")
- [ ] `[ENH]` **TLS + edge auth + EC2 security-group lockdown** (P0-4 / D1) — Cloudflare Access or ALB+ACM; set `API_AUTH_TOKEN`; re-enable HSTS. Runbook A.
- [ ] Google no-training DPA + off the free Gemini tier · counsel sign-off on WISP + §7216 instrument · name the FTC-Safeguards Qualified Individual · make CI a required status check · wire the §7216 consent-capture UX + a login form (D6).

---

## P1 — Highest-leverage enhancements (all port to Haven)

- [ ] `[ENH]` **Wire & ship the multi-year Roth optimizer** ⭐ — `rothOptimizer.ts` (`optimizeRothConversionLadder`) is **already built + pure but dormant** (referenced by nothing). Add: an endpoint (`/clients/:id/tax-return/roth-optimizer`), the long-term value model (RMD avoidance + IRMAA tiers + SS-taxability interaction + fill-to-target-rate), and a live what-if UI. *The audit's "single biggest bet" — the one feature that moves TaxFlow from scanner to advisory tool, and what RightCapital/Corvee/Intuit Tax Advisor lead on.* Prereq: harden the H3 multi-year model first (income scaling, carryforward depletion, RMD/installment recognition — currently clamps every projection year to one bracket year + freezes carryforwards). (~1 qtr first solver; the core primitive exists)
- [ ] `[ENH]` **State "modifications" layer — next increments** (PREP-B1) — core shipped (muni-bond add-back, US-Treasury subtraction). Add: **configurable retirement/SS exclusions** + **per-line NY IT-203 / CA 540NR sourcing** (replace the day-proration approximation for part-year/NR). The #1 correctness gap — moves 40+ states from "approximation" to "signable." (multi-week)
- [ ] `[FIX]` **Planning-catalog refresh discipline** (PLAN-Q3) ⏳ — **time-bomb: 93/101 strategies have `validUntil ≤ end-2026` and PLAN-08 actively suppresses expired ones → the catalog collapses to ~8 hits on 2027-01-01.** Build an annual refresh process + name an owner; re-date/extend the still-valid strategies for TY2027. ~6 months runway. (~1 wk + ongoing)
- [ ] `[ENH]` **Quick state wins** (PREP-Q3) — **Yonkers PIT** (flat % of NY liability, ~16% add-on, trivial + high NY-metro frequency); IL dependent exemption ($2,775/dep); WI std-ded high-AGI phase-out; CT pension/SS phase-out (currently over-taxes); NJ retirement-exemption cap; VT dependent exemption + IN-112 SS exclusion. (hours–days each)

---

## P2 — Medium enhancements (bounded; port to Haven)

### Tax calculator engine
- [ ] `[ENH]` **Per-property Schedule E roll-up** — per-property MACRS/basis/suspended-PAL + Form 8582 per-activity (today aggregate-only; most CPA-visible federal gap).
- [ ] `[ENH]` **State AMT for NY (IT-220) / NJ / MN** — extend the CA Schedule-P pattern (only CA modeled today).
- [ ] `[ENH]` **FTC carryforward** (Form 1116 Schedule B, 10-yr) + SEHI carryforward.
- [ ] `[ENH]` **Form 8995-A per-business wage/UBIA limit** (aggregate today — matters for multi-entity K-1 filers above the §199A threshold).
- [ ] `[ENH]` **Schedule C per-line P&L + depreciation** (MACRS/§179/bonus on business assets; engine takes net SE as one number today) — PREP-B3 / Haven B#19.
- [ ] `[ENH]` **Federal sub-gap batch** (PREP-B5): §1202 pre-2010-09-27 sub-multipliers (75%/50%); K-1 basis reduced by distributions + separately-stated deductions; **bonus-depreciation acquisition-date field** → correct TY2025 40%/100% dual-rate; Schedule D HIFO/specific-ID lot selection; partial-wash leftover-replacement re-flow.
- [ ] `[ENH]` **1040-X amendment depth** (extend the C4 snapshot diff) — PREP-B6 / Haven B#18.

### AI extraction (the real half of "autofill")
- [ ] `[FIX]` **Run the full 100-doc benchmark on PAID Gemini quota** — current 97.5%P / 77.7%R is on **25 synthetic W-2s only**; the 100-doc/1099 headline numbers are a *mock simulator*. Harness is ready (~5 min on paid). Highest-leverage, lowest-cost truth check. (EXT)
- [ ] `[ENH]` **Per-field confidence scores + "review only low-confidence fields" filter** — extractor returns `{data, boxes}` with **no confidence**; today the only signal is presence/absence. Turns "re-read every box" into "review the 3 risky fields."
- [ ] `[ENH]` **Attack recall** — prompt the model to enumerate **every filled box** (not only confident ones) + add a Box 1 ≠ Box 3 disambiguation hint (the dominant false-positive class: pre-tax-deferral W-2s).
- [ ] `[ENH]` **Expand doc-type coverage** to where CPA time goes: **consolidated/multi-page brokerage 1099** (most common real doc) → **K-1** (highest value) → **1098/1098-T/E**, **1095-A** (unlocks Form 8962), **SSA-1099**, **W-2G**. (each: new extractor + prompt + corpus entry, on the W-2 template)
- [ ] `[ENH]` **1099 box-arithmetic validation** — extend the `validateW2` flag engine to 1099s (EXT-2).

### Planning engine
- [ ] `[ENH]` **Model the credit/election mechanics that block what-if wiring** — add `calculate*` support for §41 R&D, §45S FMLA, §51 WOTC, §23 adoption, §530 Coverdell, §36B ACA PTC reconciliation; **then promote** the corresponding heuristic detectors (G1.30/36/59/60/65/74/75/80/81) from heuristic → engine-verified. (NOTE: don't force-wire via the generic `credit` adjustment — it's refundable, would overstate for low-tax filers.)
- [ ] `[ENH]` **H2-wire the remaining *engine-modelable* heuristics** (PLAN-Q2) — e.g. §1244 ordinary loss (G1.40), §453 installment (G1.47), §163(d) investment-interest election (G1.93). Raises the "% engine-verified" Haven inherits. (The ~44 *qualitative* G1.46–G1.96 detectors stay heuristic — assessed twice, not-recommended, until their mechanic is modeled.)
- [ ] `[ENH]` **Replace fixed heuristic splits with data** — G1.17 S-corp reasonable comp (fixed 40/60 → RC Reports/BLS benchmarks); per-state PTET regime audit for G1.2 (AICPA list → state-by-state mechanics).

### Workflow
- [ ] `[ENH]` **Return-level diagnostics engine** (P1-5) — the critical/warning/informational checklist CPAs run before filing (missing dependent TIN/EIN, dependent-count vs CTC/EITC eligibility, missing/invalid state code, unbalanced return, W-2 box arithmetic) → a clearable "ready to hand off" panel. Build incrementally on `lib/w2Validation.ts`. (~1 qtr; ships value in the first session)

---

## P3 — The Haven migration (when ready to cut over)

- [ ] `[ENH]` **Build the bridge** (the real integration risk, not the math): Prisma tax-data models + the `TaxReturnInputs` adapter on the Haven side; map the Drizzle schema → Prisma (use the versioned migrations `0000`/`0001`/`0002` as the enumerable source).
- [ ] `[ENH]` **Repackage the engine** as a **compiled** `@haven/tax-engine` + `@haven/tax-planning` npm package (NestJS imports at runtime — a TS-source package won't work).
- [ ] `[FIX]` **Standing constraint:** keep `computeTaxReturnPure` pure (no DB/framework/`Date`/random); document any `TaxReturnInputs`/`ComputedTaxReturn` additions (the I/O contract IS the migration seam).

---

## Explicitly DON'T invest (Haven replaces it, or wait for demand)
- ClientDetail.tsx refactor / login UI / JS code-splitting / dark-mode toggle — Haven's Next.js portals + Expo mobile replace the SPA.
- Real UltraTax / SDE write-back ("autofill" as integration) — no tax tool imports a finished 1040 via file; SurePrep API (2–3 wks post-contract, pricing-blocked) / SDE reverse-eng (4–6 wks + per-release maintenance) / GruntWorx-style UI automation (6–10 wks + high maintenance) are all multi-month and **gated on a paying partner confirming it's their blocker**.
- Trust/estate (1041), partnership (1065), S-corp/C-corp (1120-S/1120), 706/709, e-filing — out of scope per the Option-A decision.
- Long-tail state credits (beyond top-10 states), PA EIT (~1,800 minor munis) / OH SDIT (~390 districts) long tail, MD per-dependent exemption, HSA last-month rule — only when a customer asks.

## Business (blocked on you, not engineering)
- [ ] Land **1 real, named CPA design partner** on real clients + a real side-by-side validation vs UltraTax CS; publish an honest case study. (A1/C3 — the biggest dollar gate.)
- [ ] **Reset pricing** toward per-return ($50–150) or a Holistiplan-adjacent tier (current $30k = Corvee ceiling with Holistiplan depth). Budget the annual catalog refresh.
- [ ] Decide the game (P1-1, founder-level): standalone planning product vs engine component for Haven — *already leaning "migrate the brain into Haven"; confirm and stop straddling.*
