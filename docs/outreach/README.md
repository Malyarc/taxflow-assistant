# CPA Design-Partner Outreach Packet

Materials to lead with when contacting prospective CPA design partners
for TaxFlow Assistant. Updated 2026-05-24 (after K1, K2, K3, K5, K6, K10
engine-gap closures — 6 federal-engine gaps remaining vs. 10 at start of
the deep-audit week).

## Files in this folder

| File | Use |
|---|---|
| `one-pager.md` | The leave-behind. Single-page summary of what TaxFlow is, what it does, and the case for being a design partner. Convert to PDF before sending. |
| `cold-email.md` | Cold-email templates — short (3 paragraphs) and detailed (4 paragraphs) versions. |
| `demo-script.md` | A 12-minute live demo walkthrough — upload → AI extract → CPA review → approve → export. Use this when you get on a Zoom. |
| `partner-faq.md` | Anticipated CPA questions with answers, including the disclosed engine gaps (K3 closed → AMT × LTCG correct; K10 closed → SS taxability correct; remaining 6 gaps documented). |

## What you're leading with (the proof points)

These are the artifacts the CPA can audit before committing:

1. **1,584+ hand-calc assertions across 26 test suites — 0 real failures.**
   `docs/accuracy-audit/deep-audit-2026-05-23.md` is the audit report.

2. **Validation packet (10 hand-keyable cases).**
   `docs/validation-packet/` — covers single + MFJ + HoH, W-2 only,
   1099-NEC, LTCG/QDIV mix, Schedule A heavy itemizer, EITC, retiree
   with SS, ISO bargain AMT-binder, etc. Each is PDF + CSV + .gen
   so the CPA can hand-key into UltraTax / Lacerte / ProConnect / Drake
   and compare results line-by-line.

3. **AI extraction benchmark.**
   `docs/ai-benchmark/LIVE-RUN-NOTES.md` — Gemini Flash on real W-2s:
   precision 97.5% / recall 77.7% / F1 0.865 (n=25). 1099 cohort still
   needs paid Gemini quota; design-partner pilot doesn't block on it.

4. **The C14 polished review-modal demo.**
   AI value visible per field with four explicit states: ✓ kept, ✎
   changed, + added, ⊘ cleared. CPA sees at a glance what they
   accepted vs. overrode.

5. **Disclosed engine gaps (transparency over comprehensiveness).**
   `docs/accuracy-audit/deep-audit-2026-05-23.md` K-list + state-gap
   list. 6 federal-engine gaps remaining after the 2026-05-24 batch:
   - K4: NOL carryforward (post-TCJA 80% limit)
   - K7: §1202 QSBS exclusion (founders' liquidity events)
   - K8: Kiddie tax (Form 8615)
   - K9: FEIE §911 (expat earned-income exclusion)
   - K1 sub-gap: per-spouse SE attribution (MFJ corner case)
   - State-level SS exclusion for non-SS-taxing states (engine
     includes taxable SS in state base for all states)

   Plus 4 state-engine gaps (NYC EITC sliding scale, MN $1,750/child
   refundable CTC, WA 7% LTCG excise, CA AMT Sched P 540).

## What you're NOT leading with

These exist but are not the pitch:

- E-filing (Option A is the CPA-tool overlay path — CPAs e-file
  through their own software)
- File-based UltraTax import (no public format exists per the audit
  in `docs/ultratax-audit.md`; the validation packet covers this with
  hand-key compare)
- Multi-tenancy auth, billing, SOC 2 (Phase D — only built once a paid
  design partner is committed)

## The ask

For an unpaid pilot:
- 3–5 of their typical returns hand-keyed into TaxFlow
- 30-minute Zoom debrief comparing the engine output to what they got
  out of their existing software
- Honest feedback on which fields / flows trip them up
- Permission to fix gaps they surface and re-run

For a paid pilot ($500–$1,000/month, capped at 10 clients during
pilot):
- 10–15 returns through the full AI-extract → review → approve →
  export workflow
- Weekly 30-minute check-ins
- Public-name reference once they confirm value (after 30 days)
