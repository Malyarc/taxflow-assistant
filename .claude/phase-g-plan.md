# Phase G — Tax Planning Initiative — Full Session Plan

**Read this file in full before writing any code.** This is the
session-kickoff plan for Phase G. Take your time, use maximum
reasoning, and follow the architecture exactly.

## Required pre-read (do this first)

Read these four files in order, then return here:

1. `.claude/handoff.md` — current state (ALL engine gaps closed 2026-05-26)
2. `.claude/roadmap.md` — Phase G section is your high-level spec
3. `docs/accuracy-audit/deep-audit-2026-05-23.md` — engine quality bar
4. `CLAUDE.md` — invariants + commit conventions + user prefs

After reading those, confirm to yourself you understand:
1. The engine has zero documented gaps (deep-audit + accuracy-audit both report 0 docgaps).
2. The 5-layer architecture below (especially: **LLM never touches math**).
3. The 10 ship rules + their triggers.
4. What "good" looks like for a hand-calc test case.
5. The seed-data archetype taxonomy.

If any of those isn't clear, re-read the relevant file or ask the user before writing code.

## The mission

Build Phase G — Tax Planning Initiative — the upsell tier that flips
TaxFlow from "data-keying tool" to "revenue-generating advisory tool".

The engine is complete (zero documented gaps; 1,700+ hand-calc
assertions; 0 real failures). Phase G builds on top **without changing
engine math**.

**Revenue justification:** planning fees $750–$3,000 per engagement.
Top-20 clients × 40% conversion × $1,800 avg = ~$14k new annual revenue
per CPA. Justifies $2,500/mo Pro tier vs $1,000/mo Standard.

## Non-negotiable architecture (5 layers)

The whole point of this architecture is: **the LLM never touches the
math.** CPAs have malpractice exposure; we cannot ship hallucinated tax
strategies. Read this twice before coding.

### Layer 1 — Curated knowledge base (static, versioned)

- YAML/JSON catalog of strategies. Each entry has: `id`, `name`,
  `category`, `irc_section`, `irs_pub`, `trigger` (machine-readable),
  `formula` (deterministic math), `confidence` (0-1),
  `cpaEffortHours`, `validUntil`, `prerequisiteData`, `action`
  (template string).
- Store at `lib/planning-strategies/strategies-v1.yaml`.
- Version it. v1.0 ships with 10 strategies. Future updates = versioned
  files + migration.

### Layer 2 — Detection engine (deterministic, NO LLM)

- Reads engine output (`ComputedTaxReturn` + client + adjustments).
- Evaluates each strategy's trigger expression. If match, computes
  `estSavings` using strategy's formula. Returns `OpportunityHit[]`.
- New file: `artifacts/api-server/src/lib/planningEngine.ts`.
- Same testing discipline as `taxCalculator.ts` — hand-calced expected
  values, full coverage, IRS citation per assertion.

### Layer 3 — Scoring & ranking (deterministic)

- `PlanningScore` per client (formula below).
- Hit list = all clients ranked descending.
- Filterable by category, AGI band, state.

### Layer 4 — AI synthesis (LLM, narration only — NEVER math)

- Inputs: structured `OpportunityHit[]` + client snapshot.
- Outputs: 1-page CPA-facing memo + client outreach email + missing-data list.
- The LLM consumes the math; it does not produce numbers.
- Use Gemini 2.5 Pro (not Flash) for memos — better narration.
- If you ever find yourself letting the LLM choose a threshold or
  calculate a $-amount, **stop**. That goes in Layer 1 + 2.

### Layer 5 — Online intel refresh (semi-automated, quarterly)

- **Not built in this session.** Just leave a clean seam.
- Future: cron job pulls IRS / state DOR / Tax Foundation / AICPA
  updates. LLM summarizes diffs; a human reviews before catalog changes.

## The 10 ship rules (Phase G1) — detailed specs

Implement these **in order**. Each is a separate YAML entry + a
function in `planningEngine.ts` + 5+ hand-calced test cases.

### G1.1 — SEP-IRA / Solo 401(k) for SE filer

- **IRS:** IRC §408(k); Pub 560 (TY2024 max $69k).
- **Trigger:** `netSeIncome ≥ 30000` AND no existing SEP/Solo401k adjustment AND `filingStatus != "married_filing_separately"`.
- **Contribution:** `min((netSeIncome - halfSeDeduction) × 0.20, 69000)`.
- **estSavings:** `contribution × (federalMarginalRate + stateMarginalRate)`.
- **confidence:** 0.95.
- **cpaEffortHours:** 1.5.
- **category:** retirement.

### G1.2 — PTET election for SALT cap

- **IRS:** IRC §164(b)(6); state-by-state PTET statute.
- **Trigger:** K-1 client (S-corp/partnership active income > 0) AND
  resident state in {AL, AZ, AR, CA, CO, CT, GA, HI, IL, IN, IA, KS,
  KY, LA, MD, MA, MI, MN, MS, MO, MT, NE, NJ, NM, NY, NC, OH, OK, OR,
  RI, SC, UT, VA, WV, WI} AND `saltDeductible == 10000` (cap binds).
- **estSavings:** `(actualSALT - 10000) × federalMarginalRate`.
  Where `actualSALT = saltDeductible` if itemizing, else
  `stateIncomeTaxAdj`.
- **confidence:** 0.85.
- **cpaEffortHours:** 3.0.
- **category:** state.

### G1.3 — Bunching itemized vs standard

- **IRS:** Pub 17; Sch A general.
- **Trigger:** `itemizedTotal` between `(stdDed × 0.85, stdDed × 1.15)` AND `charitableCash > 0`.
- **estSavings:** `stdDed × 0.5 × marginalRate × 0.5` (alternate years; half-effect on average).
- **confidence:** 0.80.
- **cpaEffortHours:** 1.0.
- **category:** charitable.

### G1.4 — Roth conversion window

- **IRS:** IRC §408A; Pub 590-A.
- **Trigger:** `federalMarginalRate < 0.24` AND `(taxpayerAge BETWEEN 30 AND 72 OR taxpayerAge IS NULL)`.
- **Conversion amount:** `fill_to_next_bracket(taxableIncome)`.
- **estSavings:** `estimatedConversion × (expectedFutureRate − currentRate)`.
  `expectedFutureRate = 0.32` (placeholder; flag for CPA input).
- **confidence:** 0.60 (depends on unknown IRA balance + future rate).
- **prerequisiteData:** `["Traditional IRA balance"]`.
- **cpaEffortHours:** 2.0.
- **category:** retirement.

### G1.5 — AMT timing (ISO bargain element)

- **IRS:** Form 6251; IRC §56(b)(3).
- **Trigger:** `amtTax > 0` AND `amt_iso_bargain_element > 0`.
- **estSavings:** `amtTax` (could be deferred entirely by spreading ISO exercises across years OR same-year disqualifying sale).
- **confidence:** 0.90.
- **cpaEffortHours:** 2.5.
- **category:** timing.

### G1.6 — NIIT cliff avoidance

- **IRS:** Form 8960; IRC §1411.
- **Trigger:** `AGI in [threshold − 10000, threshold + 10000]`
  where `threshold = 200000` (single/HoH) / `250000` (MFJ) / `125000` (MFS)
  AND `netInvestmentIncome > 0`.
- **estSavings:** `niitTax` (currently paid).
- **confidence:** 0.80.
- **cpaEffortHours:** 1.5.
- **category:** timing.

### G1.7 — §199A wage/UBIA limit (K-1)

- **IRS:** IRC §199A(b)(2); Pub 535.
- **Trigger:** K-1 client AND taxable income just above §199A threshold.
  Threshold (TY2024): 191950 single/MFS, 383900 MFJ.
  Within phase-out: up to 241950 single / 483900 MFJ.
- **estSavings:** `estimated_lost_qbi × 0.20 × federalMarginalRate`
  (lost_qbi proxy: 50% of QBI not modeled by simplified engine when in
  phase-out band).
- **confidence:** 0.70.
- **cpaEffortHours:** 3.0.
- **category:** business.

### G1.8 — Charitable DAF bunching

- **IRS:** IRC §170; Pub 526; DAF rules under §4966.
- **Trigger:** `charitableCash > 5000` AND `federalMarginalRate ≥ 0.32`.
- **estSavings:** `bunch_3_year_charitable × marginalRate × fraction_recoverable_from_std_ded_cliff`
  ≈ `(charitableCash × 2) × marginalRate × 0.2`.
- **confidence:** 0.85.
- **cpaEffortHours:** 2.0.
- **category:** charitable.

### G1.9 — Tax-loss harvesting

- **IRS:** IRC §1211, §1212; Pub 550.
- **Trigger:** `capitalLossDeducted < 3000` (haven't maxed loss this year) AND `netLTCG > 0` OR has 1099-B activity.
- **estSavings:** `$3000 × ordinaryMarginalRate` (the $3k ordinary offset; rest is carryforward upside).
- **confidence:** 0.60 (depends on unrealized loss inventory).
- **prerequisiteData:** `["Unrealized loss inventory in brokerage account(s)"]`.
- **cpaEffortHours:** 1.5.
- **category:** investment.

### G1.10 — Foreign Tax Credit unclaimed

- **IRS:** Form 1116; IRC §901.
- **Trigger:** `foreign_tax_paid` adjustment > 0 AND `foreignTaxCredit.credit < foreign_tax_paid × 0.95`.
- **estSavings:** `foreign_tax_paid - foreignTaxCredit.credit` (direct $-for-$ vs deducting as itemized).
- **confidence:** 0.95.
- **cpaEffortHours:** 0.5.
- **category:** credits.

## Scoring formula (Layer 3)

```
PlanningScore(client) = Σ over hits (
    hit.estSavings
    × hit.confidence
    × marginalRateWeight(client.federalMarginalRate)
    × engagementComplexityWeight(numHits)
    × stickinessWeight(hit.recurring)
)

marginalRateWeight = 1 + max(0, marginalRate − 0.22) × 5
engagementComplexityWeight = 1 + log(1 + numHits) × 0.3
stickinessWeight = 1.5 if recurring else 1.0
```

Hit list orders all clients by this score, descending. Filterable by
category and AGI band.

## Seed data — 85 client archetypes (Phase G1-seed)

Build a seed script at `scripts/src/seed-dummy-clients.ts`. Run via
`pnpm --filter @workspace/scripts exec tsx ./src/seed-dummy-clients.ts`.
Idempotent — checks if archetype already exists by email before insert.

### Categories

**Simple W-2 only (20 clients):** basic variations across states + filing statuses + dependent counts. AGI range $30k–$120k.

**Moderate complexity (30 clients):** mix of sole-prop + Sch E rental + retiree + tech worker + single mom EITC + ACA marketplace + multi-W-2 MFJ + side 1099-NEC + student loan interest + HSA + IRA.

**High complexity (25 clients):**
- Tech founder + ISO bargain + AMT bind
- RE investor MFJ 5 rentals + §469 PAL suspended
- S-corp owner W-2 + K-1 + §199A QBI + SEP-IRA
- Day trader + STCG + LTCG + wash sales
- Multi-state K-1 owner (NY resident, CA/TX/FL sources)
- Doctor $400k + Roth conversion + AMT + 401k catch-up + DAF
- Expat with $150k FEIE + foreign tax credit
- Founder selling $5M QSBS (§1202 100% exclusion)
- Recently widowed (QSS year-of transition)
- NY+NYC high SALT + mortgage > $750k limit
- CA PTET candidate
- MFJ with both spouses self-employed
- MFS-with-spouse (rare edge)
- ... 12 more variations

**Edge cases (10 clients):**
- WA $1M LTCG (G4 excise binding)
- Kiddie tax filer $30k unearned
- MN MFJ 3 kids low-income (G2 WFC + CTC interaction)
- NOL $80k + $100k W-2 (K4 80% limit binds)
- NIIT cliff at $245k AGI
- Multi-state half-year resident
- Big $5M LTCG (top bracket stacking)
- CT retiree below SS exemption phase-out
- Kiddie tax + parent K-1 mix
- Just over §199A threshold (G1.7 trigger)

Each archetype should include 3 years of `tax_returns` history so
Phase G4 multi-year intelligence can fire. Use realistic numbers:
hand-calc verify the engine produces plausible federal + state tax
before committing.

## Sequence of work (commit boundaries)

**Do not batch unrelated changes.** Each commit must be testable on its own.

### Commit 1: Knowledge base scaffolding
- New dir: `lib/planning-strategies/`
- `strategies-v1.yaml` with all 10 rules in YAML
- `types.ts` with TypeScript types matching YAML shape
- Validator script that parses the YAML at startup; fails fast on malformed entries

### Commit 2: planningEngine.ts framework + G1.1 SEP-IRA rule end-to-end
- `OpportunityHit` type
- `evaluatePlanningOpportunities(client, computed, adjustments)` function — returns `OpportunityHit[]`
- Implement G1.1 SEP-IRA detector
- New file `scripts/src/tax-engine-planning-tests.ts` with 5+ hand-calced cases for G1.1 alone
- Confirm all 25 existing testable suites still 0 failures

### Commits 3–7: G1.2 through G1.10 — batched 2 rules per commit (5 commits)
- Each commit adds 2 rules + their tests
- Run full deep-audit + accuracy-audit + planning-tests after each
- If any existing suite regresses, **stop and diagnose** before continuing

### Commit 8: API + DB
- New endpoint: `GET /api/clients/:id/planning-opportunities`
- New DB table `planning_opportunities_snapshot` (optional cache; cached per `(client_id, tax_year, strategies_version_hash)`)
- Wire into OpenAPI spec; regen `api-zod` + `api-client-react`
- Integration test: `tax-engine-planning-integration-tests.ts`

### Commit 9: Frontend Planning tab
- New tab in `ClientDetail` showing `OpportunityHit[]`
- Card per opportunity: title, estSavings (formatted), confidence badge, action text, CPA effort hours, IRS citation footer
- Sort by estSavings desc; group by category
- Total estimated savings displayed at top

### Commit 10: Seed data
- `scripts/src/seed-dummy-clients.ts` with 85 archetypes
- Run it; verify all archetypes ingest cleanly
- Verify the Planning tab shows expected opportunities for ≥ 10 spot-check archetypes

### Commit 11: Composite scoring + hit list (Phase G2)
- `PlanningScore` added to OpportunityHit summary
- New endpoint: `GET /api/planning-hit-list` (returns all clients ranked desc by PlanningScore)
- New dashboard widget: "Top 10 planning targets"
- Filterable by category, AGI band, state

### Commit 12: AI synthesis (Phase G3) — first half (memo only)
- New file: `artifacts/api-server/src/lib/planningMemo.ts`
- Uses `@workspace/integrations-openai-ai-server`
- Function `generatePlanningMemo(client, hits)` → markdown memo
- LLM gets: structured hits + client snapshot
- LLM produces: prose memo. **Never asks LLM to compute or invent $**
- Model: `aiModel` default but allow override for Pro tier (Gemini 2.5 Pro / Claude Opus). Document the override env var
- New endpoint: `GET /api/clients/:id/planning-memo`
- Smoke-test against a real client archetype with real AI key (if available in env). Mock if not

### Commit 13: AI synthesis — second half (client email + missing data)
- `generateClientOutreachEmail(client, hits, cpa)` → email body
- `inferMissingData(client)` → `string[]` of questions to ask client
- Both available as separate endpoints

### Commit 14: Multi-year intelligence (Phase G4)
- For clients with multi-year `tax_returns` history:
  - opportunityRealizedVsDetected diff
  - trend rules (e.g., NIIT 3 years running)
  - carryforward expiry alerts
- Surface in Planning tab under "Multi-year trends"

### Commit 15: Pro tier feature flag (Phase G5 — minimal)
- Boolean feature flag in env or in clients table (`proTierEnabled`)
- Planning module behind the flag (clean 404 / hide UI when off)
- Don't ship Stripe yet — that's part of D18. Just the flag and a placeholder "Upgrade to Pro" CTA

### Commit 16: Documentation + handoff
- Update CLAUDE.md (mention Phase G capabilities)
- Update `.claude/roadmap.md` (mark G1–G5 done; surface remaining G6+ rules)
- Update `.claude/handoff.md` (this session's record + pasteable next-session prompt)
- Commit + push

### Commit 17: Deploy to EC2
- ssh + git pull + pnpm install + db push + api-server build + pm2 restart + frontend rsync
- Smoke test:
  ```
  curl http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com/api/healthz
  curl ... /api/clients/<seed-id>/planning-opportunities
  ```
- Verify Planning tab renders in production

## Quality bar (non-negotiable)

- Hand-calc every test expected value against IRS published rules **before** asserting. Tests passing on wrong expectations is worse than no tests.
- All 25 existing testable suites must stay at 0 real failures after each commit. Run them before committing.
- Each new rule must have ≥ 3 positive test cases (trigger fires) + ≥ 2 negative test cases (trigger doesn't fire) + at least one edge-case verification (boundary, MFS, etc.).
- When the AI generates anything (memos, emails), test the prompt + output shape; mock the LLM for the integration test.
- No emojis in code or commit messages.
- Commit messages: 1–2 sentence summary + bullet list of substantive changes + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer.
- Never push --force, never amend commits, never skip pre-commit hooks.

## Deploy details

EC2: `ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com`
Project: `~/taxflow-pro`

```bash
ssh ec2:~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
pnpm --filter @workspace/db run push          # if schema changed
pnpm --filter @workspace/api-server run build
pm2 restart taxflow

# Frontend (Planning tab is new):
# LOCAL:
pnpm --filter @workspace/tax-app run build
rsync -e "ssh -i ~/Downloads/taxflow-key.pem" -avz --delete \
  artifacts/tax-app/dist/public/ \
  ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com:~/taxflow-pro/artifacts/tax-app/dist/public/
```

## If interrupted or out of session time

Stop at the next commit boundary. Don't ship half-implemented rules.
Update `.claude/handoff.md` with:
- Which commits you completed
- Which rules are done vs pending
- A pasteable prompt for the next session to continue from where you stopped
- All tests must be passing at the commit boundary you stop at

Phase G1 alone (commits 1–10) is enough to demo to a design partner.
Phase G2+G3 (commits 11–13) make it a complete product.
Phase G4+G5 (commits 14–15) are polish.

## When you're done

Report:
- What landed (commit list with sha + title)
- What's left to do (prioritized — most important first)
- What you recommend next (one specific item, with justification)
- Exact text to paste into a new session to continue

Format the summary directly in the response, not in a file.

## User communication preferences

- Direct, pragmatic. No flattery. No hand-holding.
- Hand-calc every expected value before asserting.
- Fix bugs you find as part of the work; add regression tests.
- Push to GitHub after each meaningful commit.
- Tell the user how to deploy at the end.
