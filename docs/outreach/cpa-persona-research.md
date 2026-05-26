# CPA Persona Research — what real CPAs want in 2026

Synthesized from public sources (Journal of Accountancy 2025 tax-software
survey, CPA Trendlines 2026 outlook, CPA Practice Advisor, Thomson Reuters
Tax Advisory 2026 report, AICPA practice data, NATP fee survey, IRS
preparer statistics, AccountingToday, software-vendor comparisons).
Compiled 2026-05-26 as a substitute for a live design-partner conversation.
Use as the empirical backbone for positioning, demo prep, and outreach
copy.

> **Why we did this:** The original C11 plan was to recruit a live CPA
> design partner. That's still the right end state, but this synthesis
> exists so we don't outreach blind — every cold email, demo script, and
> pricing claim ties back to a documented industry source rather than
> intuition. Replace this doc with real-partner feedback when we get it.

---

## Market structure (the addressable universe)

| Metric | Value | Source |
|---|---|---|
| Total US CPA firms | ~50,885 | gitnux 2026 |
| Total US tax-preparation firms (broader, NAICS 54121) | ~137,000 | anythingresearch 2026 |
| Industry employment | ~1.29M | NAICS 54121 |
| Industry revenue | ~$252B (tax-prep + bookkeeping + payroll) | NAICS 54121 |
| Avg CPA practice size | ~11 employees, $2.9M annual revenue | gitnux 2026 |
| % CPA/tax firms that are small businesses (<1,000 filings) | 89% | IRS RPO stats |
| % PTIN holders that are solo practitioners | 48% | IRS RPO stats |
| % firms operating with no employees | 60-70% | CPA Trendlines |
| % top-100 e-filers' share of all e-filings | 46% (just 325 firms) | IRS RPO stats |
| Female CPAs (2023) | 51% of licensees | AICPA |

**Strategic takeaway.** The market is dominated by small firms — 89% file
under 1,000 returns, 48% are solo. The two viable design-partner profiles
are (a) the **solo / 1-3 person firm** running on Drake or ProSeries, and
(b) the **small / mid firm 4-20 staff** running on Lacerte or
ProConnect. UltraTax firms exist but are larger and slower to switch.

---

## Persona 1 — The Solo CPA / Micro-firm (1-3 people)

**~60-70% of the market by firm count.** This is where most of the
pressure exists and where the biggest workflow improvements are
possible.

### Profile

- 50-300 1040 returns per year
- Annual firm revenue $80k-$500k
- Tax prep software: **Drake Tax (~$2,000/yr unlimited 1040s)** or
  ProSeries (~$1,500-$3,000/yr). A few use TaxAct Pro or TaxSlayer Pro.
- Practice management: usually **none** — paper folders, Outlook,
  shared Dropbox, or a basic CRM. A subset uses **TaxDome ($58/mo)**.
- Average per-return fee: $236-$500 for a basic 1040; $400-$800 with
  Schedule C (NATP 2026 survey)

### Top pain points

1. **Document keying-in eats the whole engagement margin.** A 1040 with
   2-3 W-2s, 1099-DIV/INT/B, and a Sch K-1 takes 30-45 minutes of
   straight typing. At $500/return, that's $11-15 of cost in keying
   alone — before the actual review/file work begins.
2. **"I know I'm missing planning opportunities."** Solo CPAs see
   high-income clients, watch them leave money on the table (no
   SEP-IRA, ignored PTET, never bunched), and don't have a systematic
   way to surface those opportunities at scale.
3. **No time for advisory upsell during tax season.** Mar-Apr is
   crunch. Advisory conversations would generate $3-8k/yr per client
   but require a relationship-building motion the solo doesn't have
   bandwidth for during prep.
4. **Software cost is significant.** Drake at $2k/yr is the bottom
   tier; anything more expensive feels like it has to pay for itself
   in advisory revenue, which is the chicken-and-egg problem.
5. **"AI is happening, I'm behind."** 62% of accounting pros use
   genAI daily already; the solo CPA who doesn't is anxious about
   competing.

### What this persona is willing to pay for

- **Document extraction that saves 20+ min/return.** At 100 returns/yr,
  that's 33 hours back — billable at $150/hr is $5,000.
- **A simple way to identify the top 5-10 clients to upsell into
  planning engagements.** Even one $3,500 engagement covers a $1k/mo
  tool for a quarter.
- **A defensible reason to RAISE prep fees.** "I now run an AI
  extraction + multi-year planning review on every client" is a
  10-15% price-increase justification — and 80% of firms plan to raise
  fees in 2026 anyway.

### What this persona is NOT willing to pay for (today)

- A second tax-prep engine to replace Drake. Drake works; the prep is
  already done. They want an OVERLAY, not a replacement.
- A practice-management system. TaxDome is $58/mo and they already
  have one (or don't want one).
- E-file infrastructure. They already file through Drake.

### TaxFlow fit (honest)

**Strong.** TaxFlow's two value props (AI extraction, planning module)
both map directly to the solo CPA's #1 and #2 pain points. The .gen
export keeps Drake in the workflow. Pricing must compete with Drake's
$2k/yr baseline though — TaxFlow Pro at $30k/yr is 15x the prep
software, which only works if it generates ~$30-60k of incremental
advisory revenue per year. With 100 clients and a 20% conversion at
$3.5k avg, that's $70k. Math works ONLY for firms with a high-AGI
client mix; doesn't work for low-AGI EITC-heavy firms.

---

## Persona 2 — The Small / Mid Firm (4-20 staff)

**~25% of the market.** This is the sweet spot for the planning module
specifically — they have the client mix, the bandwidth, and the budget.

### Profile

- 300-1,500 1040 returns per year (plus some 1065/1120-S/1041)
- Annual firm revenue $1M-$5M
- Tax prep software: **Lacerte (~$5-15k/yr)** or **ProConnect Tax
  (~$5-15k/yr)** or **UltraTax CS (~$10-30k/yr)**
- Practice management: **TaxDome ($58/mo)**, **Karbon ($59/mo)**, or
  **Canopy ($150/mo)**
- Average per-return fee: $500-$2,500 (1040 + state + Schedules)
- Often offers **basic year-end tax planning** but not systematically

### Top pain points

1. **Advisory revenue is the unlock but it's hard to systematize.**
   88% of growing firms say advisory is growing faster than compliance,
   but the typical small firm only converts 5-15% of clients into
   advisory engagements. They want to push that to 30%+.
2. **"Top 10 clients" isn't actually known.** Partners have a gut
   sense; nobody has a ranked list with $-savings estimates. Without
   one, the upsell conversation defaults to whoever asks first.
3. **Lacerte/UltraTax pricing keeps creeping.** Annual increases of
   5-10%; significant features sold as add-ons. Switching costs are
   high; firms feel locked in.
4. **Slow vendor support during tax season.** Lacerte support: 30-45
   minute wait times reported. Workflow updates push out mid-season.
5. **Multi-state returns are painful.** Engine accuracy varies by
   state; CA/NY/NJ residents with multi-state income require manual
   tweaks.
6. **The review queue is fundamentally manual.** Senior CPAs spend
   2-4 hours per high-complexity return reviewing keyed data before
   it goes to the client.

### What this persona is willing to pay for

- **A planning module that turns 10% of their book into $30k-$200k
  of new annual advisory revenue.** Firm with 500 clients × 20%
  conversion × $4k avg = $400k/yr. TaxFlow Pro at $30k/yr is 7-8%
  of incremental revenue.
- **Faster keying = lower staff cost.** 30-50% data-entry reduction
  on 1,000 returns/yr at $25-50/hr loaded labor = $30-100k of
  labor recovery.
- **A defensible audit trail for advisory recommendations.**
  Mid-firms worry about malpractice exposure — they need every
  planning recommendation cited to IRC + Pub.

### What this persona is NOT willing to pay for

- A second prep engine. Lacerte/ProConnect/UltraTax stay.
- A practice-management replacement (TaxDome/Karbon stay).
- A black-box AI that "suggests" planning strategies without showing
  the underlying math.

### TaxFlow fit (honest)

**Excellent.** This persona is exactly who TaxFlow Pro is designed for:
the 88-archetype demo surfacing $145k+ in opportunities maps closely
to what they see on their own roster. Pricing math works cleanly.
The deterministic, IRC-cited rule catalog answers the malpractice
concern directly.

---

## Persona 3 — The Mid-size Firm (20-100 staff)

**~5% of the market.** Important strategically because they're the
reference accounts the broader market follows.

### Profile

- 1,500-10,000 returns per year (1040 + entity returns)
- Annual firm revenue $5M-$25M
- Tax prep software: **UltraTax CS** (dominant), some **CCH Axcess**,
  rare Lacerte
- Practice management: Karbon, Canopy, or homegrown
- Often has a **dedicated advisory practice** ($15-30k/yr packages)
  per CPA Trendlines

### Top pain points

1. **Advisory is the strategic priority but hard to scale.** 9 in 10
   firms plan to expand advisory; few have a systematic playbook.
2. **AI tooling is everywhere but unmeasured.** 34% of firms deploy
   AI organizationally (up from 21% YoY); only 19% measure ROI. They
   want vendor-provided evidence of value.
3. **Junior associate dev / retention.** Tech-optimized firms hit
   $250-$350k revenue/associate; non-optimized firms struggle to
   justify hiring. Mid-size firms feel the pressure.
4. **Multi-tenancy / RBAC matters.** Multiple partners need scoped
   visibility into their clients only. Audit trail with `actorUserId`
   is non-negotiable.

### What this persona is willing to pay for

- **Enterprise pricing for firmwide deployment.** $30-100k/yr range
  is comfortable if the value story holds.
- **SOC 2 Type I/II compliance.** Below that bar, IT/security blocks
  procurement.
- **Implementation services.** Self-serve doesn't work at this size.

### TaxFlow fit (honest)

**Weak today, strong eventually.** Mid-size firms need D15
multi-tenancy, D17 S3 encryption, D19 SOC 2. TaxFlow targets them
post-D-phase. **Don't outreach this persona for the design partner
slot — outreach them once we have a paid Persona-2 reference.**

---

## Software landscape — competitive map

### Tax preparation (the actual filing software — TaxFlow does NOT replace)

| Software | Annual cost | Market share | Typical firm size |
|---|---|---|---|
| Drake Tax | ~$2,000 | High in solo / 1-3 staff | 1-5 staff |
| ProSeries (Intuit) | ~$1,500-3,000 | High in solo | 1-5 staff |
| Lacerte (Intuit) | ~$5-15k | Mid-market | 5-25 staff |
| ProConnect Tax (Intuit cloud) | ~$5-15k | Growing in cloud-first | 5-25 staff |
| UltraTax CS (Thomson Reuters) | ~$10-30k+ | Dominant in mid-size | 20-100+ staff |
| CCH Axcess (Wolters Kluwer) | ~$15-40k+ | Mid-large, cloud-native | 20+ staff |
| ATX, TaxAct Pro, TaxSlayer Pro | ~$1-3k | High-volume preparers | 1-10 staff |

**Top complaints by software** (from G2, Software Advice, Cloudvara reviews):

- **Lacerte**: aggressive annual price increases; significant features
  sold as add-ons; 30-45 minute support hold times; mid-season updates
  disrupting workflow.
- **UltraTax CS**: quote-only premium pricing; steep learning curve;
  built for CS Professional Suite integration rather than standalone.
- **Drake**: hard learning curve for newcomers; archaic user interface;
  Windows-only feel.

### Practice management (workflow / client portal — TaxFlow does NOT replace)

| Software | Monthly cost | Strengths |
|---|---|---|
| TaxDome | $58 | All-in-one: CRM, portal, e-sign, billing, KBA |
| Karbon | $59 | Workflow + team collaboration focus |
| Canopy | $150 | Modular, flexible add-ons |
| Financial Cents | $39 | Budget option |

### Tax planning (DIRECT competitors — TaxFlow's Pro tier overlaps here)

| Software | Annual cost | Strategies | Notes |
|---|---|---|---|
| **Holistiplan** | ~$160/mo ($1,920/yr) basic | OCR-driven returns analysis | 30,000+ users; financial-advisor focus; OCR struggles on scanned-then-OCR'd docs |
| **Corvee / Instead** | $15k-$30k/yr typical | 1,500+ tax planning strategies | Recently merged; comprehensive CPA-tier offering |
| **TaxPlanIQ** | Pricing on request | Mid-tier | Lower visibility |
| **TaxFlow Pro** | $2,500/mo ($30k/yr) | 10 G1 single-year + 5 G4 multi-year (15 total) | Deterministic math + IRC citation per rule; multi-year intelligence; AI extraction overlay (unique) |

**TaxFlow's positioning vs competitors:** Holistiplan is the budget
option ($1.9k/yr) for advisors; Corvee/Instead is the kitchen-sink
($15-30k/yr) for CPAs. TaxFlow Pro at $30k/yr is at the top of the
range and must justify it by combining the planning module WITH the
AI extraction overlay — neither competitor does both.

---

## Industry trends that matter for TaxFlow

### 1. Advisory revenue is the growth story (Thomson Reuters 2026)

- 88% of revenue-growing firms: **advisory growing faster than
  compliance**
- Advisory now **31% of total firm revenue** on average
- 9 in 10 firms **plan to expand advisory** in the next year
- Top-100 firms: **client accounting services** explosively growing
  for the third year running
- 60%+ of CPA firms prioritize advisory as a core growth driver

### 2. AI has hit the tipping point (CPA Trendlines 2026 Outlook)

- **34% of tax firms deploying AI organizationally** (up from 21% YoY)
- **62% of accounting pros use genAI daily**
- **30-50% data-entry reduction** on individual returns with extraction
  tools
- Tech-optimized firms: **$250-$350k revenue per associate** vs
  $150-$200k for non-optimized
- Only **19% measure ROI** on AI tools — vendors that can prove ROI
  with deterministic numbers win

### 3. Pricing is rising broadly (NATP 2026 survey)

- **80% of firms plan to raise fees in 2026** (most by 5-10%)
- Average 1040 base fee: $236 (NATP)
- 1040 + Sch C: $400-$800
- Comprehensive packages (advisory + prep): $15-30k/yr

### 4. Talent / labor pressure

- Hiring slowing at entry level — AI absorbing junior preparer tasks
- Tech investment outpacing headcount investment
- Solo and PE-backed mega-firms growing; the squeezed middle is the
  fastest-changing segment

### 5. CPA Pipeline + demographics

- 51% female CPAs (2023) — first time majority
- 22% ethnic minority representation
- AICPA pipeline crisis: fewer new CPAs entering each year

---

## Strategic implications for TaxFlow design-partner outreach

1. **Target Persona 2 (small/mid firm, 4-20 staff) FIRST.** They
   have the client mix, budget, and advisory ambition. Persona 1
   (solo) has the pain but not the budget; Persona 3 (mid-size) needs
   D-phase work we haven't done.

2. **Lead with the planning module, not AI extraction.** Advisory
   is the trending topic; the AI extraction is the supporting moat.
   Reversing this in the cold email cost responses last cycle.

3. **Acknowledge Holistiplan + Corvee in the FAQ.** Don't pretend
   to be first. Differentiate on:
   - Deterministic math + IRC citation per rule (Corvee's 1,500
     strategies are mostly heuristics; TaxFlow's 15 are hand-calc'd)
   - Multi-year intelligence (G4) — competitors detect single-year
     patterns
   - Combined AI extraction + planning (unique two-in-one)
   - Vendor-neutral .gen export (no Lacerte/UltraTax lock-in)

4. **Price defensibly.** Pro at $2,500/mo lands inside the
   comprehensive-advisory-package range ($15-30k/yr) per Thomson
   Reuters. Don't try to compete with Holistiplan's $160/mo bottom —
   that's a different buyer (financial advisor, not CPA).

5. **ROI math should be deterministic and per-firm.** "100 clients ×
   20% conversion × $4k avg = $80k incremental, minus our $30k
   subscription = $50k net" is the chart we lead with.

6. **The C11 ask should target FIRMS, not individuals.** Send to
   managing partner / director of tax, not staff accountants.

---

## Sources

- [Journal of Accountancy — 2025 tax software survey](https://www.journalofaccountancy.com/issues/2025/sep/2025-tax-software-survey/)
- [Thomson Reuters Institute — Tax firm advisory services 2026](https://www.thomsonreuters.com/en-us/posts/tax-and-accounting/tax-firm-advisory-services-report-2026/)
- [CPA Trendlines — Outlook 2026: Agentic AI tipping point](https://cpatrendlines.com/2026/01/10/outlook-2026-agentic-ai-reaches-the-tipping-point-in-tax-and-accounting-firms/)
- [CPA Trendlines — 2026 Outlook: solo / PE / middle](https://cpatrendlines.com/2025/12/15/2026-outlook-why-solo-firms-pe-giants-and-the-middle-are-headed-in-different-directions/)
- [CPA Trendlines — NATP fee survey](https://cpatrendlines.com/2026/01/06/outlook-2026-tax-prep-prices-surge-and-diverge/)
- [Acculink CPA Blog — Best tax software for CPA firms (2026)](https://acculinkcpa.com/blog/top-10-tax-software-platforms-for-cpa-firms-cch-vs-ultratax-vs-lacerte-vs-drake)
- [Cloudvara — Best software for tax professionals (2026)](https://cloudvara.com/best-software-for-tax-professionals/)
- [Software Advice — Lacerte reviews 2026](https://www.softwareadvice.com/accounting/lacerte-tax-profile/)
- [Practiq — TaxDome vs Karbon vs Canopy](https://practiq.dev/blog/taxdome-vs-karbon-vs-canopy-small-accounting-firms)
- [Income Laboratory — Best tax planning software for advisors 2026](https://incomelaboratory.com/tax-planning-software-advisors-2026/)
- [G2 — Holistiplan reviews 2026](https://www.g2.com/products/holistiplan/reviews)
- [Instead — Tax advisory pricing guide](https://www.instead.com/resources/blog/tax-advisory-pricing-guide--how-to-set-fees-clients-will-pay)
- [Uncle Kam — Turn tax compliance into $500k advisory revenue](https://unclekam.com/tax-strategy-blog/2026-budgeting-and-forecasting-services-guide/)
- [CPA Journal — How big is the typical tax firm?](https://www.cpajournal.com/2026/01/09/how-big-is-the-typical-tax-firm/)
- [Gitnux — CPA industry statistics 2026](https://gitnux.org/certified-public-accounting-industry-statistics/)
- [Toran Accounting — Average tax prep cost 2026](https://toranaccounting.com/blog/how-much-does-tax-preparation-cost/)
- [Finopartners — Tax preparer cost 2026](https://thefinopartners.com/blogs/tax-filing-fees-how-much-should-you-budget-for-a-professional-tax-preparer-this-year)
- [CPA Practice Advisor — Building a tax practice clients rely on all year](https://www.cpapracticeadvisor.com/2026/04/17/building-a-tax-practice-clients-rely-on-all-year/181829/)
- [Accounting Today — Adopt, test, monitor 2026 AI recommendations](https://www.accountingtoday.com/opinion/adopt-test-monitor-2026-ai-recommendations-for-cpas)
- [IRS — Return Preparer Office federal tax return preparer statistics](https://www.irs.gov/tax-professionals/return-preparer-office-federal-tax-return-preparer-statistics)
- [SDO CPA — Roth conversion strategies 2026](https://www.sdocpa.com/roth-conversion-strategies/)
- [SDO CPA — Partnership tax planning 2026](https://www.sdocpa.com/partnership-tax-law-changes/)
