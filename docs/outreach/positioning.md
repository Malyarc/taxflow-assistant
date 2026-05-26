# TaxFlow Positioning — derived from cpa-persona-research.md

This is the one-page mental model the cold email, demo script, and FAQ
all collapse back to. Edit this first; everything else follows.

> Read `cpa-persona-research.md` for the empirical backbone.

---

## Who we are (in one sentence)

**TaxFlow is an AI overlay that sits on top of a CPA's existing
tax-prep software (Drake / Lacerte / ProConnect / UltraTax) and adds
two things their prep software doesn't have: (1) AI extraction from
client documents, and (2) a deterministic tax-planning module that
surfaces upsellable advisory opportunities with IRC-cited estimated
savings.**

We do NOT replace the prep software. We do NOT do e-filing. We do
NOT manage client documents or e-sign or billing. Those stay with
Drake/Lacerte/UltraTax + TaxDome/Karbon. We add the AI layer above.

---

## What problem we solve

CPA firms are pivoting hard into **advisory revenue** — 88% of
revenue-growing firms say it's their fastest-growing segment, and
9 in 10 firms plan to expand it. But two friction points block them:

1. **Keying in the source documents eats the engagement margin.**
   A solo CPA spends 30-45 minutes per return just typing W-2 boxes.
   At $500/return that's $11-15 of cost before any review/file work.
   No bandwidth left for the advisory conversation.

2. **They can't identify WHICH clients to upsell.** "Top 10 clients
   to convert into planning engagements" is a question every managing
   partner has — none of them have a systematic, defensible answer.

TaxFlow attacks both:
- **AI extraction** (Phase A2) cuts keying time 30-50%, freeing
  staff time for advisory work.
- **Planning module** (Phase G) ranks every client by composite
  planning score; surfaces the top 10 with IRC-cited estimated
  savings per opportunity.

---

## Who we sell to (FIRST)

**Persona 2 — Small/Mid Firm, 4-20 staff.** ($1M-$5M firm revenue,
300-1,500 1040s/yr, Lacerte/ProConnect/UltraTax shop, basic
year-end planning today, wants to systematize advisory).

This is **~25% of the market by firm count** but the highest fit:
- They have the client mix (mix of W-2s, K-1s, multi-state, high-AGI)
- They have the budget ($30k/yr is 1-3% of firm revenue)
- They have the advisory ambition (the trend is pulling them in)
- They have the malpractice nervousness that prefers deterministic
  math over LLM hallucination

Solo CPAs (Persona 1) come later (lower budget per seat). Mid-size
firms (Persona 3) come post-D-phase (need multi-tenancy + SOC 2).

---

## What makes us different (vs the direct competitors)

We are NOT the first or only tax-planning software. Holistiplan and
Corvee/Instead exist. The cold email and FAQ must acknowledge them.

| Dimension | Holistiplan | Corvee / Instead | **TaxFlow** |
|---|---|---|---|
| Buyer | Financial advisors (CFP) | CPAs | CPAs |
| Pricing | $160/mo ($1.9k/yr) basic | $15-30k/yr typical | $2.5k/mo ($30k/yr) Pro |
| # strategies | OCR-driven analysis of returns | 1,500+ heuristics | **15 hand-calc'd, IRC-cited** |
| Math model | OCR + computation | Largely heuristic | **Deterministic; every $-amount cites IRC + Pub** |
| Multi-year intelligence | Limited | Limited | **5 G4 detectors (persistent NIIT/AMT, std-ded cliff, PAL growth, cap-loss stuck)** |
| AI extraction from source docs | No | No | **Yes — AI + bounded review on every field** |
| Open-source citation trail | No | No | **Every rule cites IRC section + IRS publication** |
| Audit-trail per recommendation | Limited | Limited | **Built in — `inputs` block per hit** |
| E-filing | No | No | No (we leave this to Drake/UltraTax) |
| Practice management | No | No | No (TaxDome/Karbon territory) |

**The three differentiators that matter:**

1. **Math is hand-calc'd, IRC-cited, and auditable.** Every
   recommendation has the formula visible. CPAs nervous about
   malpractice exposure on LLM-generated "advice" can trace each
   dollar back to the statute. (See `tax-engine-planning-tests.ts` —
   133 G1 + 70 G4 assertions hand-calc'd against IRC/Pub before
   asserting.)

2. **AI extraction + planning in one product.** Both Holistiplan and
   Corvee require the CPA to key everything into THEIR system first.
   TaxFlow ingests the source documents directly and runs both layers.
   Saves the duplicate-keying problem competitors create.

3. **Multi-year intelligence (G4).** Persistent NIIT exposure, std-ded
   cliff that repeats year-over-year, capital-loss carryforward
   stuck, PAL suspension growing. These are structural advisory
   opportunities competitors don't surface because they look at a
   single-year snapshot.

---

## What we DON'T claim (and why)

To stay credible, don't oversell. Specifically:

- ❌ **"First / only AI tax-planning tool"** — Holistiplan has 30k
  users. Don't pretend they don't exist.
- ❌ **"1,500+ strategies"** — we have 15. Compete on quality (every
  one IRC-cited) not quantity.
- ❌ **"Replaces UltraTax / Lacerte"** — we don't and we won't.
- ❌ **"Eliminates the need for a CPA"** — CPA reviews every AI
  extraction before it lands. We make CPAs more productive, not
  optional.
- ❌ **"SOC 2 compliant"** — we're not. Disclose this in the FAQ.

---

## What we DO claim (with evidence)

| Claim | Evidence file |
|---|---|
| **15 IRC-cited planning detectors with hand-calc'd math** | `lib/planning-strategies/src/strategies-v1.json` + `scripts/src/tax-engine-planning-tests.ts` + `scripts/src/tax-engine-planning-multi-year-tests.ts` |
| **1,790+ test assertions across 28 suites, 0 real failures** | `docs/accuracy-audit/deep-audit-2026-05-23.md` |
| **Zero documented engine gaps** (down from 10 federal + 4 state) | `docs/accuracy-audit/deep-audit-latest.json` |
| **88-archetype demo surfacing $145k+ in advisory opportunities** | `scripts/src/seed-dummy-clients.ts` |
| **Multi-year intelligence on TY+1 history** | G4 module + Planning tab "Multi-year trends" section |
| **Engine accuracy independently audited 2026-05-23 → 9 real bugs found + fixed** | `docs/accuracy-audit/report.md` |
| **AI extraction: 97.5% precision, 77.7% recall on W-2 live run** | `docs/ai-benchmark/LIVE-RUN-NOTES.md` |
| **10-case validation packet (PDF + CSV + .gen)** | `docs/validation-packet/` |

---

## The pitch ladder (cold → demo → pilot)

### Cold email (60 seconds of attention)

**Lead with the planning module headline.** Example: "On a sample
high-AGI client in our demo, the planning engine surfaces $93k of
estimated annual federal-tax savings across 5 IRC-cited opportunities.
What would a similar list across your top 50 clients look like?"

### Demo (15 minutes)

1. Dashboard → "Top 10 planning targets" widget (G2 firm-wide ranking)
2. Click `edge-big-ltcg` (or similar high-value seed client) → Planning
   tab opens
3. Walk through 3-4 hits with the rationale + action + IRC citation
4. Click "Generate AI memo" → markdown memo + client email + missing-data
5. Show the Multi-year trends section (G4) on a 2-year client
6. Briefly show the AI extraction → CPA review flow (Phase A2)
7. End with: "What's the closest analog on your roster?"

### Paid pilot ($500-$1,000/mo, 10 clients)

- 10 of their real clients ingested (AI extraction → CPA review →
  approve → record)
- Weekly 30-min Zoom: what's tripping them up, what's missing
- Bugs they find we fix inside a week
- Public reference after 30 days if they confirm value

---

## ROI math the customer can rerun on themselves

| Firm characteristic | Persona 1 (Solo) | Persona 2 (Small/Mid) |
|---|---|---|
| # clients | 100 | 500 |
| % suitable for planning advisory | 15% | 25% |
| Conversion rate (with TaxFlow) | 20% | 30% |
| Avg planning engagement fee | $3,500 | $4,500 |
| Incremental advisory revenue | $10.5k/yr | $168k/yr |
| TaxFlow Pro cost | $30k/yr | $30k/yr |
| Net | **–$19.5k** | **+$138k** |
| ROI breakeven point | ~280 clients @ 20%/$3.5k | Already past |

**Persona 1 math says solo CPAs need ~280 clients before TaxFlow Pro
pays back at Pro pricing.** That's why solo is NOT the primary
design partner — pricing must adjust. Two paths: (a) lower Pro to
$1k/mo for Solos and gate fewer features, or (b) wait until D15 lets
us per-firm-flag tiers. We're parking solo outreach until D-phase.

**Persona 2 math has a clean +$138k/yr net** even at conservative
30% conversion. Lead with this firm.

---

## Outreach prioritization (the actual target list logic)

When researching firms to outreach:

**Strong fit signals (Persona 2 indicators):**
- 4-20 staff, $1-5M firm revenue
- Lacerte / ProConnect / UltraTax shop (not Drake)
- Mentions "tax planning" or "advisory" in their website / About
- Located in CA / NY / IL / NJ / MA (high SALT cap = PTET upsell;
  high marginal rate = bigger planning $-savings)
- Specializes in business owners, RIA clients, physicians, founders
  (high-AGI client mix)

**Weak fit signals (skip):**
- Solo H&R Block-style high-volume preparers
- Mostly 1040-EZ / W-2-only client base
- Audit-only firms (no 1040 prep)
- Big 4 (procurement timeline is years)

**Find them on:**
- AICPA member directory
- State CPA society directories (CalCPA, NYSSCPA, etc.)
- LinkedIn search: "Director of Tax" or "Tax Partner" at firms with
  5-25 employees
- CPA Trendlines IPA Top 500 list (smaller firms in the list)
- Local chamber of commerce CPA listings

**Pass on:**
- Big 4 firms (PWC, Deloitte, EY, KPMG)
- Top-25 firms (long sales cycle, RFP process)
- Pure financial-advisor / RIA shops (Holistiplan's territory)

---

## Updated October-style execution plan (for the user)

This is what the next 4-6 weeks of C11 actually look like:

1. **Week 1**: Build a target list of 30-50 Persona-2 firms in
   CA/NY/IL/NJ/MA using LinkedIn + state CPA society directories.
   Filter by 4-20 staff + advisory-mentioned-on-website.
2. **Week 2**: Send the refreshed cold email (`cold-email.md`)
   personalized with a one-sentence reference to each firm's
   advisory focus. Batches of 10/day, A/B testing 2-3 subject lines.
3. **Week 3-4**: Conduct 5-10 of the responses → 15-min demos using
   the new `demo-script.md`.
4. **Week 4-6**: Close 1 paid pilot at $500-$1k/mo for 10 clients
   from a Persona-2 firm.

The synthesis in `cpa-persona-research.md` is the source of truth
the cold email + demo script + FAQ + pricing doc all pull from.
Edit `cpa-persona-research.md` first when real-partner feedback
arrives; let the changes propagate.
