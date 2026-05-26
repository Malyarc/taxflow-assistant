# Cold-Email Templates

Refreshed 2026-05-26 to lead with the **Phase G planning module**
(the strongest differentiator) rather than AI extraction alone.
Research backbone: `cpa-persona-research.md`, `positioning.md`.

The opening sentence is the most important sentence — it has to make
the prospect think "$93k of unrealized savings on a single client?
Show me." Don't bury that lede.

---

## Primary version (4 paragraphs, ~220 words) — lead with the planning hit

> Subject: 15-min demo — would $93k of unrealized planning savings on one client be worth a look?
>
> Hi [First name],
>
> I came across [firm name] via [referral / LinkedIn / your state CPA
> society listing / write-up in CPA Practice Advisor]. I'm John Tang
> and I built TaxFlow — an AI overlay that sits on top of your existing
> tax-prep software (Drake / Lacerte / ProConnect / UltraTax) and surfaces
> tax-planning opportunities your clients have missed.
>
> Quick concrete: in our demo, a sample client with a $5M LTCG year
> shows up with $93,575 of estimated annual federal-tax savings across
> 5 IRC-cited opportunities (SEP-IRA, PTET, charitable bunching, NIIT
> deferral, foreign tax credit). Across the 88-client demo roster,
> the engine surfaces $145k+ in total advisory opportunities you
> could convert into engagements. Every dollar is hand-calc'd against
> the IRC section — not LLM-generated — so the audit trail holds up.
>
> What separates TaxFlow from Holistiplan ($160/mo, financial-advisor
> focus) and Corvee/Instead (1,500 heuristics, $15-30k/yr) is that
> the math is deterministic and the AI extraction layer is INCLUDED —
> we ingest W-2 / 1099 / K-1 PDFs directly so you're not double-keying
> into a planning system. 1,790+ test assertions across 28 suites,
> zero documented engine gaps, and 9 real bugs we found and fixed in
> an independent triple-track audit last week.
>
> 15-minute Zoom demo with a 10-case validation packet you keep
> regardless. What's a good time this week or next?
>
> — John Tang
> [Email] · [Phone] · http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com

---

## Short version (3 paragraphs, ~120 words) — for quick outreach

> Subject: 12-min demo — surfaced $145k+ advisory opps across 88 demo clients
>
> Hi [First name],
>
> I built TaxFlow — an AI overlay for the 1040 prep workflow that
> identifies tax-planning opportunities across your client book and
> ranks them. The deterministic planning engine (15 IRC-cited rules,
> 1,790+ hand-calc test assertions, zero documented gaps) surfaces
> opportunities Drake / Lacerte / UltraTax don't — like persistent
> NIIT exposure year over year, PTET elections clients aren't taking,
> std-ded cliff bunching that compounds. On a sample high-AGI client
> in our demo: $93k of annual savings flagged. The AI extraction layer
> (W-2 / 1099 / K-1 → fields with CPA review) is included.
>
> Validation packet (10 hand-keyable cases) you keep regardless of demo
> outcome. 12-minute Zoom, no commitment.
>
> What's a good time this week or next?
>
> — John Tang

---

## Variant: solo CPA outreach (Persona 1 — emphasize extraction savings)

For solo / 1-3 person firms, lead with **time-savings**, not
advisory upsell (their pricing math is harder).

> Subject: 12-min demo — cut document-keying from 30 min to 5 min/return
>
> Hi [First name],
>
> Solo / small-firm CPAs spend 30-45 min keying source documents into
> Drake or ProSeries per 1040 — at $500/return, that's $11-15 of cost
> before review or filing. I built TaxFlow to cut that to 5 min.
>
> Client uploads W-2 / 1099 / K-1 / 1098 PDFs; the AI extracts every
> field with bounding boxes; you review on a per-field diff (✓ kept,
> ✎ changed, + added, ⊘ cleared) before anything touches the client
> record. The engine recomputes the return, then exports a vendor-
> neutral .gen summary + PDF + CSV + real IRS Form 1040 PDF for
> filing through Drake. 1,790+ hand-calc'd assertions, 0 real
> failures, 10-case validation packet you can audit line-by-line.
>
> 12-minute Zoom demo, no commitment, keep the validation packet
> regardless. What's a good time?
>
> — John Tang

---

## Variant: mid-size firm outreach (Persona 3 — flag the path)

For 20-100 staff firms, set the expectation that production usage
requires D-phase work.

> Subject: TaxFlow — design-partner pilot for a 20-100 staff firm in [their state]
>
> Hi [First name],
>
> [Firm name]'s focus on [business owners / RIAs / multi-state
> clients / from their site] is exactly the client mix where the
> TaxFlow planning module surfaces material advisory revenue. I'm
> at the stage of looking for one mid-size firm to pilot the AI
> extraction + planning module — to be transparent, you'd be using
> a single-tenant version while we build CPA-firm multi-tenancy
> (~3 weeks of work, scoped) and S3 encryption (~2 weeks) to
> production-grade your data flow. SOC 2 work begins post-pilot.
>
> What's in production today: 15 IRC-cited planning detectors, AI
> extraction with CPA review on every field, federal + state + NYC
> tax engine, 1,790+ test assertions across 28 suites, zero
> documented engine gaps, vendor-neutral export to your existing
> UltraTax / CCH Axcess workflow.
>
> Pilot is 6-8 weeks, scoped to 1-2 partners and ~10 clients. In
> exchange for being patient with the data-flow gaps, your firm
> becomes the public reference for the production rollout.
>
> 30-minute discovery call to walk through the scope. What's a good
> time this week or next?
>
> — John Tang

---

## Follow-up (7 days after no reply)

> Bumping this up. The 15-min demo turns into a usable artifact
> regardless of fit — you'd leave with the 10-case validation
> packet (PDF + CSV + .gen for each case) you can hand-key into
> your software at your own pace. Genuinely curious: how much of
> your firm's revenue is advisory vs. compliance right now? That's
> the conversation TaxFlow is trying to be on the right side of.
>
> What's a 12-min window this week or next look like?

---

## Decline gracefully (after live demo, no pilot)

> Thanks for the time today. To make sure you have what you need
> regardless: the 10-case validation packet is at [link]. Drop the
> cases into your software, compare line-by-line, let me know if
> anything is off.
>
> If TaxFlow isn't the right fit for [firm name] right now, I'd
> appreciate one sentence on why — the friction you saw in the demo
> is the most valuable feedback I can get. Was it the planning
> module's scope, the pricing, the multi-tenancy story, or
> something else?

---

## Subject lines to A/B test

Ranked by signal strength based on the research:

1. **"15-min demo — would $93k of unrealized planning savings on one client be worth a look?"** (best: specific $-headline)
2. **"12-min demo — surfaced $145k+ advisory opps across 88 demo clients"** (good: aggregate scale)
3. **"[Firm name] — 15-min demo of an AI tax-planning overlay?"** (good: personalized)
4. **"Cut document-keying from 30 min to 5 min/return"** (solo focus)
5. **"AI overlay for 1040 prep — validation packet included"** (extraction-led)
6. **"Saw [firm name] focuses on [X]. 12-min demo?"** (personalized, lower bar)

Skip:
- "Quick question" / "Just checking in" (looks like spam)
- "AI-powered tax software" (too generic)
- "Free demo" (cheapens the value perception)

---

## What to AVOID in cold copy

Per the research in `cpa-persona-research.md` + `positioning.md`:

- ❌ "First / only AI tax-planning tool" — Holistiplan has 30k users
- ❌ "1,500+ strategies" — we have 15 (compete on quality not quantity)
- ❌ "Replaces UltraTax / Lacerte" — we don't and we won't
- ❌ "Eliminates the need for a CPA" — we make them more productive
- ❌ "SOC 2 compliant" — we're not (D19)
- ❌ Vague "leverage AI to drive efficiency" copy — CPAs see 30 of
  these per week
- ❌ Mentioning pricing in the cold email — that's the demo's job

---

## Per-firm personalization template

Before sending, look up:

1. **Their tax-prep software** (Lacerte / ProConnect / UltraTax /
   Drake — usually inferable from job postings or testimonials)
2. **Their stated focus area** (business owners, real-estate
   investors, high-net-worth families, etc.)
3. **Whether they mention "tax planning" or "advisory" on their site**
4. **Their state** (CA/NY/IL/NJ/MA = strong PTET fit;
   FL/TX/NV/WA/WY = LTCG / residency-change conversation)
5. **One specific recent post / piece of content** they published

Drop one sentence referencing the personalization into the email's
opener:

> "I came across [firm name] via [LinkedIn / your post on bunching
> charitable deductions for high-AGI clients / your firm's listing
> in the CalCPA directory]."

This is the difference between 5% reply rate and 25%.
