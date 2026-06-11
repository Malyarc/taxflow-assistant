# Independent audit — CPA-firm tools (T2.2), 2026-06-11

Scope: `artifacts/api-server/src/lib/{taxProjection,filingStatusOptimizer,entityChoice,yearOverYear,clientOrganizer,rollForward,engagement,returnQa,planningCampaigns,returnDiagnostics}.ts` + `routes/cpa-tools.ts` (+ the return-qa / planning-campaigns handlers in `routes/planning.ts`, and the consumed seams `form2210.ts`, `multiYearEngine.projectYearForward`, engine MFS credit bars).

Method: code read first; every HIGH/CRITICAL confirmed with a live repro through the real modules
(`/tmp/audit-cpa-tools-repro.ts`, `/tmp/audit-cpa-tools-repro2.ts`, `/tmp/audit-cpa-tools-repro3.ts`,
run via `cd scripts && npx tsx …`). No repo files modified.

---

## CRITICAL

### FS-1 — filingStatusOptimizer: the §63(c)(6)(A) both-itemize force is a NO-OP; the tool prices an ILLEGAL MFS pair and recommends phantom MFS savings
- `filingStatusOptimizer.ts:200-212` detects "exactly one spouse itemizes" and re-runs both returns with `overrides.useItemizedDeductions: true`.
- But the engine's override semantics are `fedDeduction = useItemizedDeductions ? Math.max(itemizedDeductions, fedStdDeduction) : fedStdDeduction` (`taxCalculator.ts:2597-2599`). A forced spouse whose Schedule A (< std) is ~$0 silently receives the FULL standard deduction anyway.
- Net effect: the "MFS" total the optimizer compares = taxpayer ITEMIZED + spouse STANDARD — barred by §63(c)(6)(A) (a married-separate filer's std deduction is $0 when the other spouse itemizes).
- **Repro (confirmed)**: MFJ, FL, W-2s $110k (untagged) + $70k (spouse-tagged), $16k `mortgage_interest`. TY2024.
  - Tool: MFJ net $23,282; "MFS combined" $22,974; **recommends MFS, savings $308** — exactly (16,000 − 14,600) × 22%, i.e. the disallowed spouse std deduction benefit.
  - Legal MFS alternatives: both-itemized = $26,186 (far worse than MFJ); both-standard = $23,282 (tie). The recommended $308 cannot be obtained on real returns.
- The response even reports `mfs.spouse.itemized = true` while the spouse's tax was computed with the standard deduction (`itemizedDeductions` echoes the forced flag, the math used `max()`), so the disclosure is internally inconsistent.
- Blast radius: systematic for the most common asymmetric profile (one spouse holds the mortgage/SALT/charitable). For near-symmetric W-2 couples the MFS-vs-MFJ bracket math is neutral, so this phantom benefit ALONE flips the recommendation to MFS.
- Fix shape: the engine override cannot express "itemize even when lower". Either add a true force path (e.g. `useItemizedDeductions: "force"` that skips the `max()`), or post-adjust the spouse's return (recompute with itemizedTotal applied even when < std), or model the §63(c)(6)(A) interaction by zeroing the spouse's std deduction. AND compare the two legal pairs (see FS-4).

### FS-2 — filingStatusOptimizer: household-level `existingItemizedFallback` (and `overrides`) leak into BOTH MFS returns → the same itemized total is deducted twice
- `splitJointToMfs` builds both MFS returns as `{ ...joint, … }` (`filingStatusOptimizer.ts:89-95, 119-132`). Neither return clears `existingItemizedFallback` or `overrides`.
- The route path auto-populates the fallback for every previously-computed client: `computeTaxReturn()` sets `existingItemizedFallback: existing?.itemizedDeductions` from the persisted tax_returns row (`taxReturnPipeline.ts:215`) — non-null for every itemizing client. Engine: `itemizedTotal = max(scheduleA + invInt, additionalDeductions/fallback)` (`taxReturnEngine.ts:2829`).
- So the SPOUSE return — whose real per-line Schedule A is ~$0 after the tag split — "itemizes" the FULL household total again.
- **Repro (confirmed)**: MFJ, FL, $150k + $150k W-2s, $30k real Schedule A (mortgage 22k + charitable 8k, untagged) + `existingItemizedFallback: 30_000` (exactly what the route supplies).
  - Tool: tp taxable $120,000 AND sp taxable $120,000 (both itemized $30k → **$60k of deduction across the pair vs $30k on MFJ**); **recommends MFS, claimed savings $7,200** — phantom.
  - Same construction without the fallback still recommends MFS at $3,504 (that residual is FS-1).
- Also confirmed: `overrides.additionalIncome` inherited by both halves **doubles** the override income across the MFS pair ($250k MFJ → $300k MFS pair). The cpa-tools route passes `overrides = {}` so this half is latent (module-level hazard for any caller that passes override-bearing inputs, e.g. what-if surfaces), but the fallback half is **live on `GET /clients/:id/mfj-vs-mfs` today**.
- Fix shape: the split must set `existingItemizedFallback: undefined` on both halves (per-line Schedule A adjustments already split by tag) and strip/zero `overrides.additionalIncome` / `additionalDeductions` (or split them explicitly).

---

## HIGH

### TP-1 — taxProjection: carryforwards are FROZEN at opening values in the projected year — a consumed NOL/cap-loss is re-deducted, understating the projection and undersizing the §6654 vouchers
- `computeTaxProjection` calls bare `projectYearForward(baseline, 1, …)` (`taxProjection.ts:134`). That helper deliberately holds carryforward adjustments unchanged (multiYearEngine MVP comment), and the projection does NOT use the engine's own depletion outputs (`nolCarryforwardRemaining`, `capitalLossCarryforward*`) or the existing `captureCarryforwards`/`applyCarryforwards` chaining that `runMultiYearTrajectory` offers opt-in.
- **Repro (confirmed)**: single FL, $400k W-2, `nol_carryforward` $150k fully consumed in baseline TY2025 (`nolCarryforwardRemaining = 0`):
  - Tool projected TY2026 federal tax **$57,052**; correct (NOL exhausted) **$109,242** → **projection understated by $52,190** — a headline number the CPA hands the client.
  - §6654: tool `requiredAnnualPayment` $51,347 ("90%_current" basis, computed on the understated projection); correct $59,205 (the 110% prior-year harbor would bind).
  - With $20k withholding the tool's vouchers total **$30,747**; total paid $51,347 satisfies NO §6654 harbor (prior-year 110% = $59,205; 90% of actual-current = $98,318) → **penalty on the ~$7.9k shortfall** for a client who followed the tool exactly.
  - Partially-consumed CFs too: $10k ST cap-loss CF, $3k used in baseline → projection re-carries $10,000 (should be $7,000). (Confirmed.)
- Fix shape: after the baseline compute, rewrite the projected year's carryforward adjustments from the baseline return's REMAINING outputs (the `captureCarryforwards` → `applyCarryforwards` pair already exists and is tested), or at minimum disclose "carryforwards held at opening values" in the response.

---

## MEDIUM

### TP-2 — `projectYearForward` scales 7 of the 15 carryforward adjustment types by the growth factor
- The exclusion set (`multiYearEngine.ts:98-107`) predates the newer types. **Confirmed scaled** (10,000 → 11,000 @ growth 1.10): `foreign_tax_credit_carryforward`, `amt_nol_carryforward`, `schedule_c_section179_carryforward`, `investment_interest_carryforward`, `adoption_credit_carryforward`, `rd_credit_carryforward`, `general_business_credit_carryforward`. (Controls `nol_carryforward` / `capital_loss_carryforward_long` held ✓.)
- Carryforwards are fixed dollars; scaling them inflates projected-year deductions/credits (3% default; up to 3× at the route's allowed growth bound). Compounds TP-1. Also affects every other consumer of `projectYearForward` (H3 detectors), but this audit's exposure is the tax-projection deliverable.

### TP-3 — 1040-ES voucher due dates ignore the §7503 weekend/holiday roll
- `voucherDueDates` emits raw 4/15, 6/15, 9/15, 1/15 (`taxProjection.ts:95-102`), labeled "Statutory installment due date".
- **Confirmed**: baseline TY2024 → projected TY2025 vouchers include **Q2 `2025-06-15`, a Sunday** (the actual due date was Mon 2025-06-16). Baseline TY2026 → Q4 `2028-01-15` is a Saturday (actual: Tue 2028-01-18 after the MLK holiday). Errors are in the early/safe direction but these are wrong statutory dates on a client deliverable; `engagement.ts` already has `rollToBusinessDay` — vouchers should use the same (holiday caveat documented like engagement's).

### TP-4 — projection assumptions undisclosed: withholding auto-grown; projected year computed under clamped LATEST-year law
- `projectedWithholding = baseline withholding × growth` (confirmed: $30,000 → $30,900) silently feeds `toCover = target − projectedWithholding`. A CPA who expects level withholding gets undersized vouchers with no flag. `TaxProjectionResult` has no assumptions list (only the OBBBA note).
- For baseline TY2026 the projected TY2027 runs on TY2026 law (`resolveTaxYear` clamp — documented in multiYearEngine, not surfaced in the response), and the dead locals `mfs`/`priorAgiThreshold` (`taxProjection.ts:143-144`) suggest the threshold logic was meant to be visible here. Add an `assumptions: string[]`.

### YOY-1 — IRMAA tiers hardcoded at 2024 values; used against 2025/2026 AGI; MFS uses the single table
- `irmaaTier` uses 2024 Part-B thresholds ($103k/$206k…) for BOTH years compared (`yearOverYear.ts:62-72`). 2025 tier 1 = $106k/$212k; 2026 = $109k/$218k.
- **Confirmed false positive**: 2025 AGI $100k → 2026 AGI $107k flags "IRMAA tier 0 → 1 (entered)" — in reality no surcharge either year. Advisory (info card) but it's a Medicare-premium warning CPAs relay to retirees; also contradicts the repo's 2026-06-05 freshness-hardening convention (should be a `Record<TaxYear>` keyed off each return's year). MFS filers additionally get the single table (real MFS IRMAA brackets differ).

### YOY-2 — "prior year" comparison silently reuses non-year-scoped data; `priorYearHasData` doesn't catch it
- Adjustments are not year-scoped in this schema (loaded for ALL years — `taxReturnPipeline.ts:115-116`), and client-level facts (SS benefits, ACA) aren't either. `GET /year-over-year` computes the prior year from the SAME adjustments/client facts, so for an adjustment-driven client (SE income, rentals via adjustments…) the "prior year" is the current data re-run under prior-year law. The route's `priorYearHasData: prior.result.totalIncome > 0` flag only catches the all-zero case — it reports `true` here, implying real prior data. Mislabeled deltas/crossings follow. Disclose ("prior year = year-scoped documents + shared adjustments") or flag when no prior-year W-2/1099/K-1 rows exist.

### FS-3 — community-property states not caveated
- The tag-based MFS split is legally wrong in the 9 community-property states (CA, TX, WA, AZ, ID, LA, NV, NM, WI): MFS there generally requires 50/50 community-income allocation regardless of whose W-2 it is. The assumptions notes (`filingStatusOptimizer.ts:219-234`) never mention it. Add a note (state is known — could be gated on `client.state`).

### FS-4 — coupling only prices BOTH-ITEMIZED; the legal BOTH-STANDARD pair is never modeled
- When the coupling fires the optimizer forces itemized on both and never tries the both-standard alternative (often cheaper when the forced spouse's Schedule A ≈ $0). Today this is masked by FS-1 (the force is a no-op); once FS-1 is fixed, the optimizer must compute both legal pairs — max(both-std, both-itemized is not enough: compare `min(cost(both-itemized), cost(both-standard))` — or it will overstate MFS and miss real MFS wins.

---

## LOW

- **TP-5** Dead locals `mfs` / `priorAgiThreshold` in `computeTaxProjection` (`taxProjection.ts:143-144`) — computed, never used (form2210 derives the threshold itself from the projected return's status). Tie-break `ninetyCurrent <= priorYearSafeHarbor → "90%_current"` is fine.
- **RD-1** `returnDiagnostics.ts:79` `last4()` is dead code. **RD-2** RF4 charitable-DIF flag fires off `scheduleA.charitableDeductible` even when the standard deduction was taken (no charitable actually claimed on the filed return) — info-level false positive.
- **ORG-1** `norm()` lower-cases + trims but does NOT collapse internal whitespace — "Acme␣␣Corp" ≠ "Acme Corp", so the "case/space-insensitive" claim is partial. **ORG-2** unnamed prior K-1s/rentals/accounts lack the W-2-style "matches any current row" fallback (inconsistent matching generosity; minor).
- **PC-1** planningCampaigns cohort of 1: `stats` = that single client's savings rounded to $100 — the docstring's "a single client's exact figure can't be inferred" overclaims for n=1. No identity accompanies the number (name/ID never sent), so the §7216-by-design posture holds, but consider suppressing min/median/max when `clientCount === 1`. Email-draft endpoint correctly re-rounds + clamps caller-supplied stats server-side.
- **RF-1** rollForward route: `recalculateAfterMutation` + the seed report run AFTER the commit, outside the try/catch — a failure there 500s via the global handler with rows already copied (and a retry then 409s); the in-try error message "no rows were copied" doesn't apply to that path. Data integrity is fine (the copy itself is transactional, client.taxYear advances inside the tx, prior-year tax_returns row untouched).
- **ENG-1** `/engagements` inner join on `clients.taxYear = tax_returns.taxYear` silently drops clients with NULL `taxYear` (no ?taxYear filter). `asOf` = UTC today (documented, conservative).
- **EC-1** entityChoice synthetic W-2 sets Box 3 = full wages even above the SS base (cosmetic — both FICA adders cap correctly; engine Line-9 use is inert with SE base 0 in the scenario).

---

## Verified CLEAN (read + where noted, repro'd)

- **form2210 / §6654 core** (consumed by taxProjection): required annual payment = min(90% current, 100%/110% prior); 110% trigger prior-AGI > $150k with **threshold/2 for MFS**; prior harbor gated on `priorYearAvailable`; §6654(e)(2) prior-year-zero and §6654(e)(1) under-$1,000 exceptions; Line 4 nets refundable credits (ACTC, refundable AOC, EITC, net PTC, OBBBA adoption refundable). Penalty $ clearly labeled an estimate; TY2026 rate intentionally null.
- **entityChoice** (heaviest-math module — clean): per-EMPLOYER 6.2% to the SS base with no credit + 1.45% uncapped; per-PERSON employee 6.2% capped at base net of the owner's other W-2 SS wages (explicit Box-3 = 0 honored; excess-SS credit rationale documented) + 1.45%; FUTA 0.6% × $7k; Additional Medicare left to the engine (no double count). K-1 Box 1 = profit − comp − employer FICA − FUTA − baseline-applied §179 (`section179Applied` exists on the engine output — no NaN). Profit P = engine `netScheduleCProfit` − mining; statutory-employee/clergy/church income confirmed NOT inside `netScheduleCProfit` (separate buckets at engine lines 2070-2087) so they genuinely cancel. `SE_INCOME_TYPES` removal set covers the SE-coupled adjustments incl. §179 election, the qbi_* Sch-C override family, §179 carryforward, and SEHI (Notice 2008-1 net-zero); QBI-regime preservation (explicit vs auto-default) honored; SSTB flag → K-1 `isSstb`; spouse-tagged owner routing + both-spouse decline; negative-Box-1 levels skipped; $10k floor; optional-method decline; sweep framed as a curve, not a comp opinion.
- **filingStatusOptimizer mechanics other than FS-1/FS-2**: the spouse tag split drops/doubles nothing (untagged → taxpayer; per-spouse SE attribution is MFJ-gated in the engine so spouse-tagged rows on the MFS return are fully counted); ClientFacts household fields (SS, ACA, dependents, EITC kids, ages/blind/IRA-coverage) correctly zeroed/remapped on the spouse return; per-property arrays (rentals, K-1, capital transactions, Sch C assets, 4797) kept on exactly one return and disclosed. `netTaxAfterCredits` is genuinely withholding-independent (refund identity). MFS credit bars are all ENGINE-enforced and verified present: EITC (§32(d)), education credits (Form 8863 MFS bar at `taxCalculator.ts:4348`), dependent care (§21(e)(2) lived-apart), adoption (MFS bar), §221 student-loan (MFS null), PTC (MFS ineligible + APTC repayment), IRA $0–10k MFS band, MFS Saver's column, $1,500 cap-loss limit, MFS AMT/SALT/§461(l) halvings.
- **engagement**: TY2024→4/15+10/15/2025 (Tue/Wed), TY2025→2026 (Wed/Thu), TY2026→2027 (Thu/Fri), TY2027→4/17/2028 (Sat roll) + 10/16/2028 (Sun roll), TY2028→4/16/2029 — §7503 weekend rolls correct; DC Emancipation/Patriots' Day non-modeling is documented and strictly conservative (computed date never later: true 2028 deadline 4/18, 2029 4/17). `daysUntilDeadline` has no off-by-one (same-day = 0). Status enum + zod enforcement; PATCH targets the same row the 3-tier GET resolution displays.
- **rollForward**: mappers drop id/createdAt/updatedAt, detach documentId+fieldBoxes, copy encrypted SSN ciphertext as-is, set `proforma: true` on every table; K-1 opens at prior ENDING basis with per-year facts reset; disposed rentals skipped + flag reset; per-property `suspendedLossCarryforward` NOT rolled (aggregate §469 auto-seed double-count guard); carryforwards correctly left to the pipeline synthesizer and reported with manual-override suppression; 409 duplicate guard (race documented); copy + client.taxYear advance in ONE transaction; prior-year tax_returns row untouched; unsupported target years fail loudly against SUPPORTED_TAX_YEARS.
- **clientOrganizer**: proforma rows never count as received (O7) and prior-year proforma rows still generate requests; HSA reminder requires explicit `hsaIsFamilyCoverage === true` or a prior HSA deduction (O8); per-(formType,payer) 1099 scoping case-insensitive; duplicate rows collapse; 1095-A request when APTC-relevant; questions never block.
- **returnQa**: grounding snapshot is first-name-only — keys scanned, no ssn/tin/lastName/email/phone/address; figures engine-computed + rounded here; question sanitized (control chars stripped keeping newlines, whitespace collapsed, 1,000-char cap, empty → 400) and treated as untrusted data inside a JSON payload with explicit anti-injection system-prompt rules; §7216 consent gate via `aiDisclosureBlocked` forces the deterministic fallback; empty LLM answer falls back too.
- **planningCampaigns**: aggregation deterministic; `headline = verifiedSavings ?? estSavings`; campaign `stats` computed once and FORWARDED to the email-draft endpoint (no second firm fan-out), which re-sanitizes server-side (non-negative, $100-rounded, ≤1e9, count ≤100k); LLM sees catalog text + anonymous stats only; merge-field contract ({{firstName}}/{{estSavings}}) enforced with deterministic fallback; fan-out bounded (limit ≤ 200) + per-client error isolation.
- **returnDiagnostics**: severity contract honored (criticals = genuinely unfileable: missing/invalid state, kiddie without parent rate, APTC without SLCSP); D10 balance-due sign correct; RF1 EITC-kids > dependents inconsistency; W-2/1099 box checks delegated to the shared validators with SSNs decrypted at the route seam (`routes/tax-returns.ts:432-435`); NH/TN wage false-positive guarded (`hasIncomeTax: false` confirmed); deterministic ordering; `readyToHandOff` = zero criticals.
- **routes/cpa-tools.ts**: zod param validation + 404s on every endpoint; growth bounds [0.5, 3.0]; reasonableComp (0, $10M]; priorYear bounds; organizer/engagement year validation; roll-forward source-empty 400; no unbounded loops (engagements is one join over the firm's returns; campaigns capped).

## Repro artifacts
- `/tmp/audit-cpa-tools-repro.ts` — R1 (NOL frozen, $52,190 understated), R1b (partial cap-loss CF), R2 (7 scaled CF types), R3 (withholding growth + Sunday voucher), R5 (IRMAA false positive).
- `/tmp/audit-cpa-tools-repro2.ts` — R1c (vouchers below every harbor → penalty), R4 (FS-1 illegal pair, phantom $308 MFS recommendation).
- `/tmp/audit-cpa-tools-repro3.ts` — R6 (FS-2 fallback double-count, phantom $7,200 MFS recommendation), R6b (override income doubling, latent).
