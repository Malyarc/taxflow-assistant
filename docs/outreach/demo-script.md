# Demo Script — 15-minute walkthrough

Refreshed 2026-05-26 to lead with the **Phase G planning module**
(the strongest differentiator). Old script focused on AI extraction;
research showed advisory revenue is the better hook for Persona 2.

**Total time: 15 minutes.** Hard stop. If they want more, schedule a
follow-up. Their first session needs to end with them WANTING more,
not exhausted.

**Demo URL:** http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com

---

## Pre-demo prep (5 min the day before)

1. Confirm EC2 is up: `curl http://ec2.../api/healthz`
2. Confirm Pro tier is ON: `curl http://ec2.../api/settings` → `proTierEnabled: true`
3. Pick the demo client. **Default:** `edge-big-ltcg` (G4.1 fires with
   $93k headline). Backup: `high-tech-founder-iso` (G4.2 with $5k).
4. Pre-open two browser tabs:
   - Tab 1: Dashboard (`/`) — for the Top-10 widget
   - Tab 2: `/clients/<edge-big-ltcg-id>` — Planning tab pre-clicked
5. Have `positioning.md` open on a 2nd monitor for sanity reference.
6. Mute Slack / phone / email notifications.

---

## Minute-by-minute script

### 0:00-1:00 — Opening (60 sec)

> "Thanks for the time. Plan for this is 15 minutes. I'll walk you
> through the two things TaxFlow does that your existing software
> doesn't — the planning module, then the AI extraction. Stop me
> anywhere with questions; I'd rather have a conversation than a
> presentation."

> "Quick context: we're not trying to replace Lacerte / UltraTax /
> Drake. We sit on top of them. The pitch is twofold: identify
> advisory revenue opportunities across your book, AND save 20-30
> min/return of keying time. I'll show the advisory piece first
> because it's the bigger dollar conversation."

### 1:00-2:00 — Dashboard / Top-10 widget (60 sec)

Open Tab 1 (Dashboard). Point at the "Top 10 planning targets" widget.

> "This is the firm-wide ranked list. Every client is scored on a
> composite — estimated savings × confidence × marginal-rate weight
> × engagement complexity. You'd look at this Monday morning and
> know which 10 conversations to prioritize this week."

> "Each row clicks through to that client's planning tab. Real-world
> ranking, not theoretical."

### 2:00-3:30 — Click into `edge-big-ltcg` (90 sec)

Click the top entry (or specifically `edge-big-ltcg` if visible).

> "This is a single-year archetype — founder selling $5M of QSBS
> stock. Let me show you what the engine flags."

Scroll through the G1 hits. Highlight 2-3:

- G1.1 SEP-IRA (if SE income > $30k): "$13,646 contribution opportunity"
- G1.6 NIIT cliff: "Right at the threshold, $X recoverable"
- G1.9 Tax-loss harvesting: "$3k against ordinary income"

> "Total estimated annual federal savings: $93,575 across 5
> opportunities. Notice the citation footer on each — IRC §1411,
> §1211, §408(k). Every dollar is hand-calc'd against the published
> rule. There's no LLM in the math layer."

### 3:30-5:00 — Multi-year trends section (90 sec)

Scroll to the "Multi-year trends" section.

> "This is where most planning tools stop short. Single-year
> detectors catch one-off opportunities; this client has had NIIT
> in both 2024 and 2025 — that's not a timing problem, it's a
> structural one. The recommendation isn't 'defer income to next
> year', it's 'restructure entity / harvest losses systematically /
> evaluate moving income to retirement accounts'."

> "That's the difference between transactional and advisory work,
> and it's where the higher-fee engagements live."

### 5:00-6:30 — Generate AI memo (90 sec)

Click "Generate AI memo" button. Wait ~10 seconds for the response.

> "While we wait — under the hood, the AI gets the structured
> opportunity list as input. It generates the memo, the client
> outreach email, and the missing-data list. The LLM never touches
> the math; it only narrates what the deterministic engine produced.
> That's the malpractice defense — if a partner reviews and signs
> off, they're signing off on the math, not on AI guesses."

When the memo loads, scroll through it briefly. Don't read it
verbatim.

> "1-page CPA memo, formal language, structured by category. The
> client email is a different tone — warmer, less technical. The
> missing-data list is what you still need to ask the client before
> the engagement starts."

### 6:30-8:00 — Pivot to AI extraction (90 sec)

> "OK that's the planning layer. Let me show you the other half —
> the AI extraction overlay."

Navigate to a different client (or a fresh client). Open the
Documents tab.

> "Today's solo CPA spends 30-45 minutes typing W-2 boxes from a
> client's PDF into Drake. We cut that to under 5 minutes. Watch:"

Click "Upload Document", select a sample W-2 PDF, wait for
extraction.

> "AI extracts every field — box 1 wages, box 2 fed withholding,
> all the way through state info. Bounding boxes show where on the
> source PDF each value came from."

### 8:00-9:30 — Review modal (90 sec)

Click "Review" on the extracted document. Show the per-field diff
modal.

> "This is the part Holistiplan and Corvee don't have. CPA sees
> every extracted field next to the source. Four explicit states:"

Point at each:
- ✓ kept (emerald): "AI got it right, kept as-is"
- ✎ changed (amber): "AI had a value, you overrode it — both visible"
- + added (sky): "You added a value AI missed"
- ⊘ cleared (amber): "AI extracted a value you removed"

> "Nothing lands in the client record until you click 'Approve'.
> When you do, it's audit-logged. Every field you accepted or
> overrode is tracked, with a `before` and `after` for your review
> defense."

### 9:30-11:00 — Engine + exports (90 sec)

Approve the extraction. Navigate to the Tax Calculator tab.

> "Engine recomputes the federal + state tax return — that's
> 1040, Sch 1-3, A, B, C, D, E, SE, AMT, NIIT, additional Medicare,
> kiddie tax, FEIE, all of it. Multi-state with resident credit
> for non-resident state tax."

> "Exports: a real IRS Form 1040 PDF that's pre-filled with the
> computed values, a full-detail PDF, a CSV with IRS line refs,
> and a vendor-neutral .gen summary you'd hand to your prep tech
> to key into UltraTax or Lacerte."

### 11:00-12:30 — The honest gap-disclosure (90 sec)

This is the most important 90 seconds. CPAs respect honesty.

> "Three things I want to be upfront about:"

> "**One:** we don't do e-filing. You file through your existing
> software. Our exports bridge the gap; the actual filing happens
> in your stack."

> "**Two:** we're not SOC 2 compliant yet. That's on the roadmap
> after we have a paid customer requiring it — it's 3-6 months
> and $30-60k of work I won't burn on speculation. For mid-size
> firms with procurement gating on SOC 2, we'd talk about pilot
> scope around that."

> "**Three:** Holistiplan and Corvee exist. Holistiplan is the
> $160/mo budget option for financial advisors; Corvee is the
> $15-30k/yr kitchen-sink for CPAs. What we do that they don't:
> our 15 rules are hand-calc'd and IRC-cited (Corvee's 1,500 are
> heuristics), we have multi-year intelligence they don't, and we
> include the AI extraction layer they make you key into separately.
> 1,790+ test assertions, zero documented engine gaps, independent
> audit last week."

### 12:30-14:00 — Validation packet + ROI (90 sec)

Open `docs/validation-packet/` in a file browser or describe it.

> "Last piece: this is the 10-case validation packet. PDF + CSV +
> .gen for each case. They cover single, MFJ, HoH, Sch C, K-1,
> LTCG/QDIV mix, EITC, ISO bargain, retiree with SS — the spread
> of typical 1040 complexity. You'd take these, hand-key them into
> Lacerte or UltraTax at your pace, and compare line-by-line. If
> the numbers diverge anywhere, we want to know — I fix bugs
> inside a week during a pilot."

> "ROI math for [your firm size estimate]: at ~500 clients with
> even a 20% conversion on planning, $4k avg engagement, that's
> $80k of incremental advisory revenue against our $30k Pro
> subscription. Break-even is well below your client count."

### 14:00-15:00 — Close (60 sec)

> "What I'm looking for is one paid design partner — $500/mo for
> the first 30 days, $1,000/mo months 2-3, capped at 10 clients.
> Weekly 30-min Zoom check-ins where you tell me what trips you up.
> Bugs you find get fixed inside a week. Public reference (your
> name + firm) only after 30 days if you confirm value."

> "Three questions for you, then I want to hear what's on your mind:"

> "1. What does your current planning conversation look like —
>    is it built into the prep engagement, or a separate session?"

> "2. How are you ID'ing which clients to talk to about advisory
>    today? Gut, partner judgment, or something more systematic?"

> "3. What would make this a 'yes' for a 30-day pilot — and what's
>    the dealbreaker that would make it a 'no'?"

### After they answer

- **Listen.** Take notes, don't rebut.
- **Promise nothing concrete on roadmap items unless certain.**
- **If they say yes**: send the pilot terms (in `partner-faq.md`
  section "What does the paid pilot look like?") within 24 hours.
- **If they say no**: ask for one sentence on why. That's the most
  valuable data point we can get.

---

## Anticipated questions during the demo

(Detailed answers in `partner-faq.md`. Quick fielding here:)

| Question | 1-sentence response |
|---|---|
| "What about Holistiplan?" | "Holistiplan is great for the financial-advisor / AUM workflow; we're built for the CPA prep + advisory motion specifically — and we don't separate the planning UI from the source-document keying." |
| "Why should I trust your math?" | "1,790+ hand-calc'd test assertions, zero documented gaps, independent audit found and fixed 9 bugs last week — happy to share the audit report." |
| "What if your AI extraction is wrong?" | "CPA reviews every field before it lands in the record. The AI is a productivity layer, not a decision-maker." |
| "Can I export to UltraTax / Lacerte?" | "Vendor-neutral .gen file + PDF + CSV. No public UltraTax import format exists; SurePrep API is the only commercial path and we'd take that on for a paid customer." |
| "Pricing?" | "$1,000/mo for the extraction overlay (Standard); $2,500/mo with the planning module (Pro). Pilot is $500/mo for 30 days." |
| "How long does setup take?" | "About 30 minutes — we'd import your top 10-20 clients during the pilot kickoff. We can demo the import on the next call." |
| "Where are the client docs stored?" | "Right now in the application database (single-tenant). Production-grade S3 + KMS encryption is on the roadmap for D17, ~2 weeks of work once a pilot is signed." |
| "Multi-tenancy / user accounts?" | "Honest answer: single-tenant today, multi-tenancy is on the roadmap (D15, 2-3 weeks). For the pilot we'd run you on a dedicated instance." |
| "Is the data encrypted?" | "In transit yes (TLS). At rest, the DB layer encrypts on disk; full S3 + KMS for documents is D17 (~2 weeks)." |

---

## After the demo (within 24 hours)

Send a follow-up email with:

1. **Link to the validation packet** they keep regardless of pilot
2. **The 3 specific takeaways** from THEIR firm context (what
   their planning conversation looks like, what their ID method is,
   what the pilot would unlock)
3. **Pilot terms (1 page)** — pricing, scope, timeline, expectations
4. **One specific ask** — yes/no on a 30-day pilot, NOT "any
   questions?"

Example template in `partner-faq.md` "Pilot offer" section.
