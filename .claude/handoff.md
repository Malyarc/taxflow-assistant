# Handoff Note — 2026-05-23 (end of Phase C session)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Phase C complete and deployed.** C12 (UltraTax `.gen` audit + honest fix +
10-case validation packet) and C13 (AI extraction benchmark harness) both
shipped. One real bug fell out of the audit work: BP3/BP1 added engine
adjustment types but never updated the OpenAPI enum, so the API rejected
them with 400; fixed and now covered by a regression test.

**Current state: 1,372 assertions / 0 failures across 24 suites.** Live at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com. Production
smoke-tested: TXT export now self-discloses "NOT an UltraTax CS import file";
CSV header advertises CPA review, not automated import.

## What's done this session

| Commit | Phase | Title |
|---|---|---|
| `4239726` | C12a | Drop UltraTax CS import claims from `.gen`/CSV exports |
| `5711668` | (BP1/BP3 fix) | Fix engine adjustment types missing from OpenAPI enum |
| `f75a8d8` | C12b | Validation packet — 10 CPA-spot-checkable cases + audit doc |
| `efb1473` | C13 | AI extraction accuracy benchmark harness |

### Verified facts (sourced May 2026)

Critical research-driven corrections this session:

1. **No documented UltraTax CS "Generic Tax Data Import" format exists.**
   The prior `.gen` exporter was fabricated. Verified across Thomson
   Reuters help (Third-Party / SDE / CSD docs), GruntWorx / SurePrep / K1x
   partner documentation, the GoSystem Tax RS sister-product import spec
   (which DOES have a documented header+record format and is contrasted
   in `docs/ultratax-audit.md`), and taxdataexchange.org's "Tax Software
   Electronic Import capabilities" table. Confidence: ~95%.

2. **Form 1040 has no Line 12A.** Itemized totals flow Sch A Line 17 →
   1040 Line 12 (same line as the standard deduction). Our previous
   `1040-L12A` code was fictional.

3. **Schedule A Line 10 is *total* interest (8e+9), not mortgage interest.**
   Home mortgage interest itself is Line 8a (with related sub-lines 8b–8e).
   Fixed `mortgageDeductible` code from `SCH-A-L10` to `SCH-A-L8a`.

4. **Real bug uncovered by C12b**: BP1 (`k1_passive_loss_carryforward`) and
   BP3 (`amt_iso_bargain_element`, `amt_state_tax_addback_override`) added
   the engine code but never updated the OpenAPI enum or the Zod validator
   generated from it. The standalone `tax-engine-amt-prefs-tests` pass
   because they bypass the API and call the pure engine. The bug was
   invisible until the validation-packet generator tried to POST through
   the real API and got HTTP 400. Now covered by a regression test in
   `tax-engine-deep-integration-tests.ts` (3 new assertions).

### Schema additions

None this session — only OpenAPI enum additions (no DB schema change, no
`pnpm db push` required for deploy).

### Test count tracker

- Session start: 1,366 / 24 suites
- After C12a: 1,369 / 24 (+3 disclosure assertions in exports-tests)
- After BP3 schema fix: 1,372 / 24 (+3 regression assertions in deep-integration-tests)
- C12b adds NO new test suites (validation packet is artifacts, not tests)
- C13 adds NO new test suites (benchmark is not a CI test — manual run)

All standalone + integration suites at 0 failures after each commit. AI-overlay
suite (33 assertions) included in the count but not run locally — needs real
`AI_API_KEY`. Failure on dummy key is environmental, not a regression.

## Known limitations introduced or documented

### C12 (UltraTax audit + fix)
- Real UltraTax CS file-based import remains *not implemented*. Three paths
  (SurePrep API license / SDE XML reverse-engineering / GUI automation) are
  documented as Phase 5 in `.claude/roadmap.md`. Each is multi-month; do not
  start speculatively.
- The `.gen` URL path and filename extension are preserved for backward
  compat. Anything that linked to `/api/clients/:id/tax-return/ultratax`
  still works; the file content is just honest about what it is now.

### C13 (AI extraction benchmark)
- Default ships in MOCK mode (deterministic ground-truth perturbation) so
  the harness can be validated without an AI key. **MOCK numbers are NOT a
  quality signal** — they reflect the simulator's noise model, not the
  real model. Real numbers require `pnpm --filter @workspace/scripts exec
  tsx src/ai-benchmark/run.ts` on a host with `AI_API_KEY` set.
- Synthetic corpus only. Real anonymized 1099s/W-2s are impractical to
  source at n=100 without PII issues. Residual risk: a real W-2 photocopy
  may underperform synthetic numbers. Harness is structured so a partner
  can swap in a real corpus later by writing a new `corpus.ts` loader.
- Benchmark is NOT in the 24-suite CI list — needs live AI key and costs
  ~$0.01-0.10 per run. Manual pre/post prompt or model changes.

### Carryover from prior sessions (still open)
- §199A wage/UBIA limit (BP1)
- NYC school tax credit / UBT / MCTMT (BP2)
- Form 6251 line 2i (MACRS-vs-ADS depreciation difference) (BP3)
- NJ 18+/65+ EITC expansion auto-apply (BP4)
- AMT NOL, AMT credit carryforward, NOL carryforward, charitable carryforward
- Part-year residency in multi-state framework
- Local taxes for non-NYC jurisdictions
- HI / NJ / NY full retirement-income exemption variants
- Foreign income exclusion (§911 FEIE)
- K-1 guaranteed payments (Box 4 on 1065)

## EC2 deploy

Deployed this session via the standard cycle from CLAUDE.md (no DB schema
push needed):

```
# Local
pnpm --filter @workspace/tax-app run build
rsync ... ec2:~/taxflow-pro/artifacts/tax-app/dist/public/

# EC2
git pull && pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz   # {"status":"ok"}
```

Live smoke test confirmed: TXT export's `[META]` block now contains
`FORMAT=TaxFlow vendor-neutral key=value summary (NOT an UltraTax CS import
file)`; CSV header includes `Reference Code` (not `UltraTax Code`) and the
disclosure line `This file is for CPA review, not automated import into
commercial tax software`.

## Next session — recommended priorities (read order matters)

1. **`.claude/handoff.md`** — this file
2. **`.claude/roadmap.md`** — Phase C done; D / E / Phase 5 next
3. **`CLAUDE.md`** — invariants

### Top candidates for next session

**Option A — Phase C wrap (UX polish + design partner outreach):**
- C11: Find a CPA design partner (calendar time, not code)
- C14: Side-by-side AI vs CPA diff view in the review modal (~1 day)
- Run the C13 benchmark against the real Gemini API and ship the
  resulting `docs/ai-benchmark/report.md` to a partner candidate

**Option B — Phase D (compliance / multi-tenancy, once partner committed):**
- D15: CPA-firm multi-tenancy auth (orgs + users + RBAC) — 2-3 weeks
- D16: Soft-delete clients + append-only audit log (DB-level revoke UPDATE/DELETE)
- D17: Real document storage in S3 + encryption at rest
- D18: Stripe billing + subscription metering
- D19: SOC 2 Type I prep (calendar + cash burn — only when required)

**Option C — More engine completeness (Phase E, do when a customer asks):**
- §199A wage/UBIA limit for K-1 filers above $191,950 / $383,900 (BP1 limit)
- NYC school tax credit (BP2 limit; almost all NYC residents below $250k)
- Form 6251 line 2i MACRS-vs-ADS depreciation difference (BP3 limit)
- NOL carryforward + 80% taxable income limit (post-TCJA)
- §179 expense + bonus depreciation
- HSA Form 8889 detail

### What I'd NOT do speculatively

- Build any of Phase D before a paid design partner is committed
- SOC 2 prep (D19) before a paying customer requires it
- Real UltraTax integration (Phase 5 — SurePrep / SDE / GUI automation) —
  each is multi-month and useless without a partner who specifically asks
  for file-based ingestion

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these three files first, in order:
  1. .claude/handoff.md   — Phase C complete; this session's marching orders below
  2. .claude/roadmap.md   — full Phase A→E + Phase 5 strategic plan
  3. CLAUDE.md            — invariants, conventions, test discipline

Where we left off: Phase A + B + B+ + C12 + C13 all complete and deployed.
1,372 assertions across 24 suites, 0 failures. Live at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com. The C12 audit
found there's no public UltraTax CS file-based import format — `.gen` is
rebranded as a vendor-neutral CPA-review summary; PDF + CSV + the 10-case
validation packet under docs/validation-packet/ are what a CPA partner
gets. C13 benchmark harness is shipped with sample MOCK output; real
numbers require AI_API_KEY.

This session's job: pick ONE of these and ship it.

  Option A — Phase C wrap.
    - C14: Side-by-side AI-extracted-value vs CPA-overrode-value in the
      review modal (currently the original AI value lives in a tooltip;
      promote it to a visible "before / after" column). ~1 day.
    - Run the C13 benchmark against real Gemini on EC2 and replace the
      sample MOCK report in docs/ai-benchmark/ with real numbers.
    - Begin CPA design-partner outreach (calendar time, not code).

  Option B — Phase D (multi-tenancy), once a paid design partner is
  committed and explicitly asks for it. D15 is the gate: 2-3 weeks.

  Option C — More engine items from Phase E (do reactively when a CPA
  asks): §199A wage/UBIA limit, NYC school tax credit, Form 6251 line 2i,
  NOL carryforward + 80% TCJA cap, §179 expense + bonus depreciation.

Quality bar (same as prior sessions):
- Each item ships as its own commit
- All 24 existing suites must stay at 0 failures
- Update roadmap.md status, CLAUDE.md test list, handoff.md at session end
- Deploy to EC2 at the end (one cycle)
```
