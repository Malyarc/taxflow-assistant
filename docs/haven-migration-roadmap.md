# TaxFlow → Haven — Pre-Migration Roadmap (tax prep + tax planning)

**Created 2026-06-03. This is now the CANONICAL forward-looking to-do + roadmap.**
It supersedes the forward-looking parts of `docs/todo.md` (that file stays as the
historical log + the P0 record). Read this before picking up tax-calc / planning
work.

**Premise:** TaxFlow Assistant will be **migrated into the Haven app**
(`/Users/johntang/Documents/haven` — a multi-tenant tax-prep platform: NestJS API
+ Prisma + two Next.js portals + Expo mobile). So the question for every task is
not just "is it valuable?" but **"does the value survive the migration?"**

---

## 0. The migration filter (read this first)

Only **pure logic** ports from TaxFlow to Haven. Haven already has auth,
multi-tenancy, the client/staff portals, the mobile app, document upload, the
workflow state machine, field-level encryption, and observability. What it does
**not** have — and what its own roadmap explicitly plans — is the **computation,
extraction, and planning brain.** That brain is exactly TaxFlow's pure engine +
planning engine + their hand-calc test suite.

| Work on… | Ports to Haven? | Do it pre-migration? |
|---|---|---|
| `computeTaxReturnPure`, `taxCalculator.ts`, `stateTaxData.ts` + tests | **1:1 (pure)** | ✅ **highest leverage** |
| `planningEngine.ts`, catalog, `whatIfEngine.ts`, `multiYearEngine.ts` + tests | **1:1 (pure)** | ✅ **highest leverage** |
| Extraction *logic* (`documentExtractor.ts`) + W-2/1099 validation | logic ports (UI rebuilt) | ✅ worth it |
| §7216 consent gate + `fieldCrypto` *code* | ports (Haven needs §7216) | ✅ done this session |
| Auth/D15, the Vite/React SPA, EC2 TLS/S3/deploy infra | **replaced by Haven** | ❌ do NOT invest |

**Two meta-rules (non-negotiable while doing any of the below):**
1. **Keep `computeTaxReturnPure` PURE** — no new DB/framework/Date/random coupling.
   The migration is a drop-in only if it stays pure.
2. **Treat the I/O contract as the migration interface.** `TaxReturnInputs`
   (`W2Fact` / `Form1099Fact` / `ScheduleK1Fact` / `RentalPropertyFact` /
   `AssetBalanceFact` / `AdjustmentFact` / `ClientFacts`) and `ComputedTaxReturn`
   are the seam Haven's adapter will build against. Don't churn their shapes
   gratuitously; document additions.

**Where it lands in Haven:** the engine fills Haven's `REVIEW` workflow stage
(today "the CPA does calculations… no feature needed") and auto-populates Haven's
`TaxComputation` table (manual re-keying today). Planning lands on Haven's
existing `Workflow.type = TAX_PLANNING`. Extraction plugs into Haven's existing
upload → `Document` → checklist pipeline (gated by the §7216 consent gate).

---

## 1. TAX PREP (calculator) backlog — all pure, all port 1:1

Grounded in `docs/coverage-matrix.md` §4 + the federal sub-gap list + Haven's own
open roadmap items (`haven/ROADMAP.md`: estimated taxes `B#14`, amended 1040-X
`B#18`, Schedule C depreciation `B#19`).

### Quick wins (days each)
- [ ] **PREP-Q1 — Year-map sweep.** Find + route every remaining inline
  `taxYear === 2025 ? … : 2024` / two-year `Record` selector through the canonical
  year-indexed helpers (`getFederalStandardDeduction`, `getSaltCap`,
  `qbiPhaseInBand`, etc.). Two instances fixed already (QBI band, §163(j) ATI);
  this kills the whole fall-through class. **~½ day. Hardens the engine Haven
  inherits.**
- [ ] **PREP-Q2 — Form 2210 / §6654 underpayment penalty + 1040-ES quarterly
  vouchers + safe-harbor (100%/110%) target.** High-frequency on every SE /
  high-income return. **Maps to Haven `B#14` (estimated taxes). ~1–2 wks.**
- [ ] **PREP-Q3 — Coverage-matrix §4 bounded state gaps** (each hours–days):
  Yonkers PIT add-on (~16% of NY tax); IL dependent exemption ($2,775/dep);
  WI std-ded high-AGI phase-out; CT pension/SS phase-out (currently fully-taxing);
  NJ retirement-exemption cap refinement; AR bracket switching > $89,600; AL
  std-ded phase-out; VT dependent exemption + Sched IN-112 SS exclusion.

### Big-value projects
- [ ] **PREP-B1 — State "modifications" layer. ⭐ highest-value engine work.**
  Today the state calc is `federalAGI − stdDed` with NO modifications for 40+
  states. Add: muni-bond interest **add-back**, US-Treasury-interest
  **subtraction**, configurable retirement/SS exclusions, and per-line
  IT-203 / 540NR **sourcing**. Moves the state side from "approximation" to
  "signable." Any muni-portfolio or real multi-state client needs this.
  **Multi-week. Biggest trust payoff.**
- [ ] **PREP-B2 — State AMT for NY / NJ / MN** (only CA modeled today). Bounded.
- [ ] **PREP-B3 — Schedule C per-line P&L + depreciation** (MACRS / §179 / bonus
  on business assets). Today the engine takes net SE as a single number.
  **Maps to Haven `B#19`.**
- [ ] **PREP-B4 — NRA / Form 1040-NR + international** (substantial-presence test,
  treaty positions, FBAR / FATCA / Form 8938 / 8621 / 3520 flags, ITIN flow). A
  whole client class currently excluded. Larger lift.
- [ ] **PREP-B5 — Federal sub-gap batch** (each bounded): K-1 per-business
  (Form 8995-A) wage/UBIA limit (aggregate today); §1202 pre-2010 sub-multipliers
  (75%/50%); basis reduced by distributions/separately-stated deductions; SEHI +
  FTC carryforwards; bonus-depreciation TY2025 dual-rate (needs an
  acquisition-date field); Schedule D per-lot HIFO / specific-ID lot selection;
  partial-wash leftover-replacement-share re-flow.
- [ ] **PREP-B6 — Amended 1040-X depth** (extend the C4 snapshot diff). Maps to
  Haven `B#18`.

---

## 2. TAX PLANNING engine backlog — all pure, all port 1:1

### The credibility fix (do first — cheap, highest ROI)
- [ ] **PLAN-Q1 — Make the engine-verified delta the headline number. ⭐**
  Only ~23% of detectors attach a real engine-computed `whatIf` delta, yet the
  hit-list **sorts on the *heuristic* `estSavings`.** For the verified detectors,
  set `estSavings = whatIf.delta`, sort/score on it, and add an "Engine-verified
  vs Estimate" provenance flag. **~1–2 wks. Converts the biggest credibility
  liability into the differentiator; Haven inherits a planning engine that's
  trustworthy by default.**
- [ ] **PLAN-Q2 — H2-wire more heuristic detectors.** Convert every
  current-year-engine-modelable heuristic to an engine-computed `runDetectorWhatIf`
  delta (the qualitative business-credit / multi-year ones stay heuristic until
  their underlying mechanic is modeled). Raises the "% verified" Haven inherits.
- [ ] **PLAN-Q3 — Catalog `validUntil` refresh discipline.** 93/101 strategies
  expire ≤ end-2026 (PLAN-08 actively suppresses expired ones) → the catalog
  self-destructs on Jan 1 2027 without a refresh. Establish the annual refresh +
  a named owner. Don't hand Haven a time-bomb.

### The flagship advisory features (the wedge)
- [ ] **PLAN-B1 — Multi-year Roth-conversion + distribution-sequencing
  optimizer. ⭐** Bracket-fill sweep, RMD / IRMAA / SS-taxability-aware
  conversion-ladder solver; account-withdrawal sequencing. The one feature that
  moves TaxFlow from "scanner" to "advisory tool." Builds on the H3 multi-year
  primitive (harden it first — PLAN-B3). **~1 qtr. Lands directly on Haven's
  `Workflow.type = TAX_PLANNING`.**
- [ ] **PLAN-B2 — Entity-structure optimizer.** Sole-prop vs S-corp vs
  partnership; reasonable-comp solver; PTET deep-modeling; §199A interaction.
  Contests Corvee/Instead's wedge. **Lands on Haven's existing `Entity` +
  `EntityOwnership` model.** Multi-qtr.
- [ ] **PLAN-B3 — Harden the H3 multi-year model** (defensible projection: income
  scaling, carryforward depletion, RMD/installment recognition) — prerequisite for
  a credible PLAN-B1.
- [ ] **PLAN-B4 — Cross-strategy interaction depth + `whatIfSensitivity` polish**
  (the stacking-erosion + ±10% bands already exist as primitives; deepen for the
  optimizer).

---

## 3. Also-ports (extraction logic + validation — the "scanner/autofill")

These are the features the user explicitly wants in Haven. The **logic** ports as
a Haven API service; the **UI** (review/diff modal) gets rebuilt in Haven's staff
portal. Keep the logic clean + framework-free.
- [ ] **EXT-1 — Per-field extraction confidence + broader doc types.** Add
  per-field confidence scores + a "review only low-confidence fields" filter;
  expand coverage to 1098, consolidated/multi-page 1099 (the investor intake),
  K-1, 1095-A, SSA-1099, W-2G. Run a clean 100-doc benchmark on a paid Gemini
  quota (current 97.5% precision / 77.7% recall is on 25 synthetic W-2s only).
- [ ] **EXT-2 — 1099 box-arithmetic validation** (extend the `validateW2` flag
  engine to 1099s) — catches data-entry errors at the staff review step.
- [ ] **EXT-3 — Active-learning loop** — capture CPA edits in the review step as
  labels → measure live recall → auto-tune the 74 heuristic planning multipliers
  toward observed engine deltas. A self-calibrating accuracy flywheel.

---

## 4. Do NOT invest here (Haven replaces it)
- ❌ **D15 auth + multi-tenancy** — Haven has it (`firmId` everywhere,
  `assertReturnAccess`, staff/client/admin roles).
- ❌ **Frontend** — the 5,036-line `ClientDetail.tsx` refactor, a login UI, design
  polish, code-splitting. Haven's Next.js portals + Expo mobile replace the Vite
  SPA. Only keep the extraction *logic* portable.
- ❌ **EC2 infra** — TLS termination, S3+KMS doc storage, the deploy cycle. Haven
  has its own infra (and the same plaintext-doc-blob gap to solve once, on Haven's
  side). The §7216 + `fieldCrypto` *code* already ported-ready.
- ❌ **.gen / UltraTax export polish** — low value until a real round-trip
  (SurePrep/SDE), which is a multi-month Phase-5 project stuck for both apps.
- ⚠️ **Test-typecheck quarantine ratchet** — low pre-migration priority, EXCEPT:
  fixing the genuine wrong-shape fixtures (`stateWagesBox16`, `interestIncomeBox1`,
  `description`) IS worth it — they reveal real engine↔data mismatches, and those
  tests port with the engine.

---

## 5. Recommended sequence (front-loads trust + value into what migrates)
1. **PLAN-Q1 + PREP-Q1** (~1 wk) — the two cheapest trust wins. Haven inherits a
   credible planning engine + a hardened calc engine.
2. **PREP-B1** (state modifications layer) — the biggest correctness gap; makes
   the engine genuinely signable across states.
3. **PLAN-B1** (multi-year optimizer) — the flagship advisory feature, landing on
   Haven's `TAX_PLANNING` workflow.
4. Fill in **PREP-Q2/Q3, PREP-B2…B6, PLAN-Q2/Q3, PLAN-B2/B3/B4, EXT-1…3** as
   bandwidth allows.

---

## 6. Already shipped this session (context, 2026-06-03)
- ✅ P0 legal/security gate (auth gate, AES-256-GCM PII field encryption,
  fail-closed §7216 consent gate, GLBA WISP + §7216 instrument + runbooks, CI +
  test-typecheck). Engine fix P0-7b (TY2026 §199A SSTB band fall-through).
- ✅ §163(j) ATI proxy TY2026 std-ded fall-through + year-indexed SALT cap
  (`984702c`). All deployed; main = live on EC2; 43 suites / 3,375 assertions green.
- 🔴 P0-1 (USER) — rotate the leaked Neon + Gemini creds (runbook:
  `docs/compliance/runbook-p0-1-rotate-credentials.md`).

## 7. The Haven target (so future sessions know the destination)
- Haven repo: `/Users/johntang/Documents/haven` — NestJS API (`apps/api`, :4000) +
  staff portal (`apps/web`, :3000) + client portal (`apps/client-web`, :3001) +
  Expo mobile. **Prisma** ORM, Postgres + Redis, multi-tenant (`firmId`).
- The engine becomes a **compiled** `@haven/tax-engine` package (NOT a TS-source
  package — NestJS must import it at runtime), planning a `@haven/tax-planning`
  package consuming it. The real integration work is the **Prisma tax-data models
  + the `TaxReturnInputs` adapter** (the bridge), not the math.
- Full integration analysis lives in this session's transcript; condensed pointer:
  Haven's `REVIEW` stage + `TaxComputation` table is the seam;
  `Workflow.type = TAX_PLANNING` + `Entity`/`EntityOwnership` are the planning
  targets; §7216 consent gate is required before the Gemini extraction path.

---

*Source docs: `docs/coverage-matrix.md` (engine coverage), `docs/product-assessment-2026-06-02.md` (the audit + P1/P2), `docs/planning-strategy-audit.md` (planning), `haven/ROADMAP.md` + `haven/PRODUCT.md` + `haven/SCHEMA_DESIGN.md` (the target).*
