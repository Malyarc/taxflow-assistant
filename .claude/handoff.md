# Handoff Note — 2026-05-26 (C11 packet shipped via research synthesis)

Session continuation point for the next Claude (or human) working on
TaxFlow Assistant.

## Headline

**C11 — CPA design-partner outreach packet is complete and
research-backed.** Instead of recruiting a live design partner first
(blocked on calendar time), this session synthesized ~20 industry
sources into a CPA persona research backbone, then refreshed all
outreach materials to lead with the now-complete Phase G planning
module rather than the original AI-extraction-only pitch.

Engine still at zero documented gaps. Phase G is fully complete
(G1+G2+G3+G4+G5). C11 packet is ready for live outreach pending
user availability.

## What landed (session commits)

| Commit | Title |
|---|---|
| (single) | C11 — research-backed outreach packet for Phase G |

Files in `docs/outreach/`:

| File | New / Refreshed | Purpose |
|---|---|---|
| **`cpa-persona-research.md`** | NEW (~700 lines) | Research backbone — 3 CPA personas (solo / small-mid / mid-size), software landscape, competitor analysis (Holistiplan / Corvee / Instead), 2026 trends, sourced from CPA Trendlines / Journal of Accountancy / Thomson Reuters / NATP / AICPA / IRS RPO. |
| **`positioning.md`** | NEW | The one-page mental model — who we sell to first (Persona 2 small/mid firm), what makes us different (deterministic + IRC-cited + AI extraction included), ROI math per persona. |
| **`gap-analysis.md`** | NEW | Honest "what we don't do" — 🟢 in-roadmap / 🟡 deliberate / 🔴 open-question per gap. |
| **`pricing.md`** | NEW | Standard $1k/mo, Pro $2.5k/mo, pilot $500/mo, benchmark comparisons (Drake / Lacerte / Holistiplan / Corvee), per-persona ROI math. |
| `cold-email.md` | REFRESHED | Now leads with $93k planning headline (was AI-extraction-led). Added persona-1 + persona-3 variants + A/B subject lines. |
| `one-pager.md` | REFRESHED | Adds 15-rule planning catalog, competitor comparison table, ZERO-gaps callout, $145k+ demo number. |
| `demo-script.md` | REFRESHED | 15-min walkthrough (was 12-min), planning-module-led, ends with $93k headline + validation packet + ROI math. |
| `partner-faq.md` | REFRESHED | Adds explicit Holistiplan / Corvee answers, refreshed pricing, expanded SOC 2 + S3 + multi-tenancy honesty. |
| `README.md` | REFRESHED | Tied all 8 docs together. |

## Research synthesis — key findings

(Full sourcing in `cpa-persona-research.md`.)

**Market structure:** 50,885 US CPA firms (Gitnux 2026), 89% of firms
file under 1,000 returns (IRS RPO), 48% of PTIN holders are solo
(IRS RPO), avg practice 11 employees / $2.9M revenue.

**Three personas:**
1. **Solo / 1-3 staff (~60-70% of market).** Drake $2k/yr user. Wants
   AI extraction (cuts 30-45 min/return) + simple way to ID 5-10
   upsell candidates. **Pricing problem:** TaxFlow Pro $30k/yr too
   expensive; needs Standard ($12k/yr) OR future Pro-Solo ($12k/yr
   capped at 100 clients).
2. **Small/mid firm 4-20 staff (~25% of market). ← DESIGN PARTNER TARGET.**
   Lacerte/ProConnect/UltraTax shop, $1-5M revenue, basic year-end
   planning today, advisory ambition. **ROI math works cleanly:**
   500 clients × 20% conversion × $4k avg = $80k incremental advisory
   vs. $30k Pro subscription.
3. **Mid-size 20-100 staff (~5% of market).** UltraTax / CCH Axcess.
   Needs D15 multi-tenancy + D17 S3 + D19 SOC 2 — not ready yet.
   Hold for post-D-phase.

**Direct competitors:**
- **Holistiplan ($160/mo, 30k users)** — OCR-driven returns analysis
  for financial advisors (CFP / RIA). Budget option.
- **Corvee / Instead ($15-30k/yr typical)** — 1,500+ heuristic
  strategies for CPAs. Comprehensive but no AI extraction layer.
- **TaxPlanIQ** — mid-tier, less visibility.

**TaxFlow's differentiators:**
1. **Deterministic math + IRC citation per rule** (Corvee's 1,500 are
   heuristic; TaxFlow's 15 are hand-calc'd against published rules)
2. **AI extraction + planning in one product** (competitors require
   you to key into THEIR system separately)
3. **Multi-year intelligence (G4)** — persistent NIIT/AMT, std-ded
   cliff repetition, PAL growth — competitors are largely single-year

**Industry trends to leverage:**
- **88% of revenue-growing firms: advisory growing faster than
  compliance** (Thomson Reuters 2026)
- **9 in 10 firms planning to expand advisory**
- **34% of tax firms deploying AI organizationally** (up from 21% YoY)
- **80% of firms plan to raise fees in 2026** (most by 5-10%)
- **Comprehensive advisory packages: $15-30k/yr** — TaxFlow Pro sits
  squarely in this range

## Open items (next session priorities)

**Option A (RECOMMENDED): LIVE CPA outreach campaign.** Packet is
ready; this requires user (John) to:
1. Build target list of 30-50 Persona-2 firms in CA/NY/IL/NJ/MA
   (LinkedIn search + state CPA society directories). Filter for
   4-20 staff + advisory-focused websites. ~1-2 hrs work.
2. Personalize the cold email per firm (1 sentence about their
   advisory focus) and send batches of 10/day. ~30 min/batch.
3. Run 5-10 15-min Zoom demos using `demo-script.md`. ~2 hrs each
   including prep.
4. Close 1 paid pilot at $500/mo from a Persona-2 firm.

Estimated calendar time: 4-6 weeks from start of outreach to signed
pilot.

**Option B — Phase D15 multi-tenancy auth (~2-3 weeks).**
Required before charging real money. Worth starting in parallel with
outreach if the user has bandwidth for both — D15 work would land
right around when the first pilot signs.

**Option C — Phase D18 Stripe billing (1-2 weeks, requires D15 first).**
The G5 Pro-tier gate is already in place; D18 migrates env-var to
per-firm column + plugs into Stripe subscription state.

**Option D — Phase E reactive items only when a customer asks.**

## What this packet does NOT include

- **No actual outreach.** That's the user's call (calendar +
  personalization).
- **No CRM/tracker for outreach contacts.** A spreadsheet is fine
  for 30-50 firms; don't build a Salesforce until volume justifies.
- **No video/screen-record of the demo.** Pre-recording a 5-min
  intro video is worth ~½ day of work and would improve cold-email
  reply rates 2-3x; recommend doing this before sending.
- **No A/B-tested subject-line data.** First batch should test the
  3 variants in `cold-email.md` "Subject lines to A/B test" section.

## Sub-gaps + known limits (C11 packet)

- **Research is synthesis, not primary.** Real CPA feedback will
  invalidate some assumptions. The doc structure is built so
  `cpa-persona-research.md` can be overlaid with real partner
  notes when they arrive.
- **No live partner reference yet.** The "Have you tried this on
  a real CPA?" FAQ answer addresses this directly and honestly.
- **Persona 1 (solo) pricing is broken.** $30k/yr Pro is ~2-3x
  what a solo CPA's incremental advisory revenue would cover.
  Solution noted in `positioning.md` + `pricing.md`: lower-priced
  Pro-Solo tier ($1k/mo, capped at 100 clients) after D15. Don't
  outreach to solos until that exists.
- **Competitor claims need verification.** Holistiplan + Corvee
  feature descriptions are based on public marketing copy + reviews,
  not hands-on use. A live partner who used those tools previously
  is the best source of competitive intel.

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these files first, in order:
  1. .claude/handoff.md           — C11 packet shipped (this session)
  2. .claude/roadmap.md           — D15 / D18 / Phase 5 / reactive E
  3. CLAUDE.md                    — invariants, closure log, planning architecture
  4. docs/outreach/README.md      — outreach packet index
  5. docs/outreach/cpa-persona-research.md  — research backbone (if doing outreach)

Where we left off (2026-05-26): C11 outreach packet is complete via
research synthesis (~20 sources → 3 personas + positioning + gap
analysis + pricing + refreshed cold email / one-pager / demo script /
FAQ). Phase G fully complete (G1+G2+G3+G4+G5). Engine still at zero
documented gaps. 1,790+ test assertions, 28 suites, all green.

This session, pick ONE:

  Option A — LIVE CPA outreach campaign (user-driven, no code).
  Use the packet to recruit a paid Persona-2 design partner. ~4-6
  weeks calendar. Step-by-step plan in `docs/outreach/positioning.md`
  "Updated October-style execution plan" section.

  Option B — Phase D15 CPA-firm multi-tenancy auth (~2-3 weeks).
  Required before charging real money. Worth starting in parallel
  with outreach so it's ready when the first pilot signs.

  Option C — Phase D18 Stripe billing (1-2 weeks, needs D15 first).

  Option D — Phase E reactive items only when a customer asks.

Quality bar (same as prior sessions):
- Each chunk ships as its own commit
- All existing tests must stay at 0 real failures
- Update roadmap.md / CLAUDE.md / handoff.md at session end
- Deploy to EC2 at the end (no deploy needed for outreach work)
```
