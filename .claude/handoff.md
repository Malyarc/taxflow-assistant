# Handoff Note — 2026-05-23 evening (end of Phase C wrap session)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Phase C wrap shipped.** This session completed C13 LIVE (partial — quota-limited)
and C14 (side-by-side AI vs CPA diff column). The C14 polish + the LIVE W-2
benchmark numbers + the C12 validation packet are the three artifacts that now
lead any CPA design-partner conversation.

**Current state: 1,372 assertions / 0 failures across 24 suites.** Live at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com. C14 confirmed live
in production bundle (`index-q_bkw-MJ.js` contains the new diff strings).

## What's done this session

| Commit | Phase | Title |
|---|---|---|
| `103bb7d` | C13 follow-up | Rate-limit handling for Gemini free tier (8s→60s exponential backoff + 6.5s default inter-request pacing) |
| `0053f0f` | C13 LIVE-partial | First real Gemini run; quota hit at request ~25; W-2 cohort cleanly completed at F1 0.865; partial artifacts + notes preserved |
| (in same push) | C14 | Side-by-side AI vs CPA diff column in review modal |

### C13 LIVE — what we learned

**Model:** `gemini-2.5-flash` (default in the production extractor).

**Quota:** the free tier exhausted at request ~25 (Gemini's
`generate_content_free_tier_requests` daily limit). The earlier botched
run before pacing fixes also burned through quota; combined, today's
quota is fully spent.

**W-2 cohort (n=25, 300 field cells, completed before quota cliff):**
- **Precision = 97.5%** — when the model emits a value it is almost always right
- **Recall = 77.7%** — roughly 20% of fields per W-2 are silently omitted
- **F1 = 0.865**
- Notable FPs: sibling-box confusion on Box 1 / Box 3 (Wages vs SS Wages)
  — possible prompt iteration to disambiguate "Box 1 ≠ Box 3 when employee
  contributed to a pre-tax retirement plan"

**1099 cohort:** not analyzable — all variants registered 100% failure
due to HTTP 429, not model behavior.

**Artifacts:**
- `docs/ai-benchmark/LIVE-RUN-NOTES.md` — top-line analysis + next steps
- `docs/ai-benchmark/live-partial-2026-05-23/{report-PARTIAL.md, raw.csv, aggregate.csv}` — full preserved partial run
- `docs/ai-benchmark/{report.md, raw.csv, aggregate.csv}` — MOCK methodology demo (unchanged, still the harness validation sample)

### C14 — what shipped

Promoted the original-AI-value display from a tiny "AI: X" badge (only on
edit, in a hover tooltip) to an always-visible per-field DiffIndicator with
four explicit states:

  - ✓ kept       (emerald)   `AI: Acme Logistics Inc`         — confirmation
  - ✎ changed    (amber)     `$75,000 → $80,000`              — strikethrough on AI val
  - + added by CPA (sky)     `added by CPA`                   — AI missed
  - ⊘ cleared    (amber)     `83-5584855 cleared`             — CPA blanked

The existing amber row-background highlight on edit continues to fire
(same `edited` flag drives both); so the row also visually pops when
the CPA changes anything.

Smoke-tested locally end-to-end:
1. Seeded a `pending_review` document on a test client with all 12 W-2
   fields populated from mock extracted JSON.
2. Confirmed all 12 fields rendered the "kept" indicator on initial load.
3. Edited Box 1 wages → "changed" indicator with strikethrough + arrow.
4. Cleared Employer EIN → "cleared" indicator with strikethrough + label.
5. Screenshot recorded; production bundle verified.

### Test count tracker

No change. Still 1,372 assertions / 24 suites / 0 failures. C13 LIVE-partial
and C14 are not CI tests — the bench is a manual run, and the modal isn't
covered by Vitest.

## Known limitations introduced or documented

### C13 LIVE
- Sample is W-2-only (n=25) until paid quota is available. The 1099 cohort
  needs a fair retry to get real precision/recall numbers.
- Re-run instructions in `docs/ai-benchmark/LIVE-RUN-NOTES.md` "What to do
  next" section. Default `--pace-ms=6500` (~9 RPM) is safe for free tier
  but yields an ~11-min run; bump down for paid quota.

### C14
- No new failure modes — purely additive UI. The diff indicator is a
  presentational component; no schema, route, or extractor changes.

### Carryover from prior sessions (still open)
Same as the 2026-05-23 morning handoff. No changes.

## EC2 deploy

Frontend-only deploy this time (no backend or schema changes).

```
# Local
pnpm --filter @workspace/tax-app run build
rsync ... ec2:~/taxflow-pro/artifacts/tax-app/dist/public/
```

api-server was not rebuilt or restarted. Schema unchanged. Verified prod
serves the new bundle (`index-q_bkw-MJ.js`) and that the bundle contains
the new diff-indicator strings (`CPA kept the AI-extracted`, `added by CPA`).

## Next session — recommended priorities

1. **`.claude/handoff.md`** — this file
2. **`.claude/roadmap.md`** — Phase A→C complete; D and Phase 5 next
3. **`CLAUDE.md`** — invariants

### Top candidates for next session

**Option A — Finish the real C13 benchmark:**
- Re-run with paid Gemini quota (or wait for the free-tier daily reset
  at midnight Pacific and re-run with `--pace-ms=6500` to fit within
  daily quota).
- Replace `docs/ai-benchmark/{report,raw,aggregate}` with the clean
  100-doc real numbers (currently they're MOCK).
- Iterate on prompts if W-2 recall stays at ~78% — the obvious win is
  asking the model to enumerate every filled box rather than only the
  ones it's confident about.

**Option B — CPA design-partner outreach (C11):**
- No code. Use the three artifacts as the conversation:
  1. PDF + CSV + TXT from `docs/validation-packet/` (hand-keyable cases)
  2. W-2 F1 0.865 from `docs/ai-benchmark/LIVE-RUN-NOTES.md`
  3. The new C14 review-modal UX (screenshot or live demo)

**Option C — Phase D (multi-tenancy / compliance):**
- Once a paid partner is committed and asks for it
- D15: CPA-firm multi-tenancy auth (orgs + users + RBAC) — 2-3 weeks
- D16: Soft-delete + append-only audit log
- D17: Real document storage in S3 + encryption at rest

**Option D — More engine items (Phase E, reactive):**
- §199A wage/UBIA limit, NYC school tax credit, Form 6251 line 2i,
  NOL carryforward + 80% TCJA cap, §179 + bonus depreciation.

### What I'd NOT do speculatively

- Real UltraTax / Phase 5 (SurePrep / SDE / GUI automation) — still
  multi-month, still useless without a partner asking for it.
- Phase D before a paid design partner is committed.

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these three files first, in order:
  1. .claude/handoff.md   — Phase C wrap complete; this session's marching orders below
  2. .claude/roadmap.md   — full Phase A→E + Phase 5 strategic plan
  3. CLAUDE.md            — invariants, conventions, test discipline

Where we left off: Phase A + B + B+ + C12 + C13 + C14 all complete and
deployed. 1,372 assertions across 24 suites, 0 failures. Live at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com. The review
modal now has a side-by-side AI-vs-CPA diff column (C14). The C13 LIVE
benchmark gave us W-2 precision 97.5% / recall 77.7% / F1 0.865 on
gemini-2.5-flash but hit Gemini's free-tier daily quota at request ~25;
the 1099 cohort is still unanalyzed.

This session's job, pick ONE:

  Option A — Finish C13 LIVE. Re-run the benchmark with paid quota or
  after the free-tier daily reset to get a clean 100-doc report. Replace
  the MOCK sample at docs/ai-benchmark/{report,raw,aggregate} with the
  real numbers. If W-2 recall stays at ~78%, iterate on the prompt
  (enumerate-every-box).

  Option B — CPA design-partner outreach (C11). No code. Use the
  validation packet + LIVE-RUN-NOTES + C14 demo as the conversation.

  Option C — Phase D (multi-tenancy auth, S3 storage, billing). Start
  only once a paid partner is committed and explicitly asks for it.

  Option D — Phase E engine items, reactively. §199A wage/UBIA, NYC
  school tax credit, Form 6251 line 2i, NOL carryforward.

Quality bar (same as prior sessions):
- Each item ships as its own commit
- All 24 existing suites must stay at 0 failures
- Update roadmap.md status, CLAUDE.md test list, handoff.md at session end
- Deploy to EC2 at the end (one cycle)
```
