# CPA Design-Partner Outreach Packet

Materials for the **C11** outreach work. Refreshed 2026-05-26 to
reflect Phase G complete (10 G1 single-year + 5 G4 multi-year
detectors + AI memo + firm-wide hit list + Pro-tier flag) and an
**online-research-synthesis substitute for a live design partner**
(`cpa-persona-research.md`).

> **Why the research-synthesis approach.** The original C11 plan was
> to recruit a live design partner first. We're inverting that: do the
> research synthesis FIRST so every cold email, demo script, and pricing
> claim ties back to a documented industry source. Then approach
> real CPAs with research-backed messaging rather than blind cold
> outreach. Replace `cpa-persona-research.md` claims with real-partner
> feedback when it arrives.

---

## Files in this folder

| File | Use |
|---|---|
| **`cpa-persona-research.md`** | **The research backbone.** 3 CPA personas (solo, small/mid, mid-size), software landscape, competitor analysis (Holistiplan / Corvee / Instead), 2026 industry trends. Edit this first; everything else propagates. |
| **`positioning.md`** | The one-page mental model. Who we are, who we sell to, what makes us different, ROI math, target list logic. |
| **`gap-analysis.md`** | Honest accounting of what TaxFlow doesn't do vs. what CPAs want. 🟢 in roadmap / 🟡 deliberate / 🔴 open question per gap. |
| **`pricing.md`** | Pricing tiers, benchmark comparisons (vs Drake / Lacerte / Holistiplan / Corvee), per-persona ROI math, pilot terms. |
| `cold-email.md` | Cold-email templates (primary, short, persona-1, persona-3 variants) with A/B subject lines and personalization template. |
| `one-pager.md` | The leave-behind. Single-page summary; convert to PDF before sending. |
| `demo-script.md` | 15-minute live-demo walkthrough. Minute-by-minute, with the planning module leading (vs old AI-extraction-leading script). |
| `partner-faq.md` | Anticipated CPA questions with answers, including disclosed engine gaps + competitive comparisons. |

---

## What you're leading with (the proof points)

These are the artifacts a CPA can audit before committing:

1. **Phase G complete — 15 IRC-cited planning detectors.**
   `lib/planning-strategies/src/strategies-v1.json` is the catalog.
   `tax-engine-planning-tests.ts` (133 G1) + `tax-engine-planning-multi-year-tests.ts`
   (70 G4) are the hand-calc proofs.

2. **88-archetype demo surfacing $145k+ in advisory opportunities.**
   On `edge-big-ltcg`: $93,575 estSavings across 5 IRC-cited
   opportunities. On `high-amt-binding`: $17,107. On `high-tech-founder-iso`:
   $4,767. Run `pnpm --filter @workspace/scripts exec tsx
   src/seed-dummy-clients.ts` to populate.

3. **1,790+ hand-calc'd test assertions across 28 suites — 0 real
   failures.** `docs/accuracy-audit/deep-audit-2026-05-23.md` is the
   audit report; `docs/accuracy-audit/latest-run.json` is the
   most-recent run.

4. **Zero documented engine gaps** (down from 10 federal + 4 state
   at the start of the audit week). Closure log in `CLAUDE.md`.

5. **Validation packet (10 hand-keyable cases).**
   `docs/validation-packet/` — covers single + MFJ + HoH, W-2-only,
   1099-NEC, LTCG/QDIV mix, Schedule A heavy itemizer, EITC, retiree
   with SS, ISO bargain AMT-binder. PDF + CSV + .gen for each.

6. **AI extraction benchmark.**
   `docs/ai-benchmark/LIVE-RUN-NOTES.md` — Gemini Flash on real W-2s:
   precision 97.5% / recall 77.7% / F1 0.865 (n=25).

7. **C14 per-field diff review modal.**
   Four explicit states: ✓ kept, ✎ changed, + added, ⊘ cleared.

---

## What you're NOT leading with

These exist but are not the pitch:

- E-filing (Option A is the CPA-tool overlay — CPAs file through
  their existing software)
- File-based UltraTax import (no public format exists per
  `docs/ultratax-audit.md`; the validation packet covers this with
  hand-key compare)
- Multi-tenancy auth, billing, SOC 2 (Phase D — only built once a
  paid design partner is committed)

---

## The ask (paid pilot)

**$500-$1,000/month, capped at 10-25 clients during 60-day pilot.**
Weekly 30-minute Zoom check-ins. Bugs they find get fixed inside a
week. Public reference after 30 days if they confirm value.

Full pilot terms in `partner-faq.md` section "What does the paid
pilot look like?"

---

## How this packet got built (2026-05-26 — what changed)

The original packet (2026-05-24) was AI-extraction-led; the planning
module didn't exist yet. With Phase G shipped:

1. **`cpa-persona-research.md` is NEW.** ~20 sources synthesized into
   3 firm-size personas + software landscape + competitor analysis
   + trend data.
2. **`positioning.md` is NEW.** The mental model the cold email +
   demo + FAQ collapse to.
3. **`gap-analysis.md` is NEW.** Honest accounting of what we don't do.
4. **`pricing.md` is NEW.** Pricing tiers + ROI math per persona.
5. **`cold-email.md` rewritten.** Now leads with the $93k headline
   savings from the planning module, not AI extraction. New
   persona-1 (solo) variant, persona-3 (mid-size) variant.
6. **`one-pager.md` rewritten.** Adds the 15-rule planning catalog,
   the competitor comparison table, the ZERO-gaps callout.
7. **`demo-script.md` rewritten.** 15-minute walkthrough (was 12-min),
   leads with the dashboard widget → planning tab → multi-year
   trends → AI memo, THEN pivots to AI extraction.
8. **`partner-faq.md` rewritten.** Adds explicit Holistiplan / Corvee
   comparison answers, refreshed pricing answer, expanded SOC 2 +
   multi-tenancy + S3 disclosure honesty.

---

## Next steps to actually outreach (when ready)

1. **Build the target list (Week 1).** 30-50 Persona-2 firms in
   CA / NY / IL / NJ / MA. Use LinkedIn + state CPA society
   directories. Filter for 4-20 staff + advisory-focused.
2. **Send (Week 2).** Personalize each cold email with one
   sentence about the firm's advisory focus. Batches of 10/day.
   A/B test 2-3 subject lines.
3. **Demo (Weeks 3-4).** 5-10 of the responses. Use `demo-script.md`.
4. **Close 1 paid pilot (Weeks 4-6).** $500/mo for 30 days from a
   Persona-2 firm. Sign the pilot agreement; ship D15 multi-tenancy +
   D17 S3 + KMS during the pilot.

---

## When to update this packet

- **After every real CPA conversation** — overlay any actual feedback
  on top of the research synthesis in `cpa-persona-research.md`.
  Real data is more valuable than synthesized data.
- **When the engine changes** — bump the test-count and gap-list
  numbers in `one-pager.md`, `partner-faq.md`, and `positioning.md`.
- **When pricing changes** — single source of truth is `pricing.md`;
  cold email + one-pager + FAQ all reference it.
- **When a new G-list rule ships** — update the planning catalog
  table in `one-pager.md` and `partner-faq.md`.
