# Pricing & ROI — what TaxFlow costs and what it returns

This is the spreadsheet-on-a-page that the design-partner conversation
collapses to when budget comes up. Numbers are based on the research
in `cpa-persona-research.md` (CPA Trendlines 2026 outlook, NATP 2026
fee survey, Thomson Reuters Tax Advisory 2026 report).

---

## Pricing tiers (current state)

| Tier | Monthly | Annual | Includes |
|---|---|---|---|
| **Standard** | $1,000 | $12,000 | AI extraction overlay + 1040 engine + multi-state + .gen / PDF / CSV / IRS-1040 PDF exports + 10-case validation packet + email support |
| **Pro** | $2,500 | $30,000 | Everything in Standard **+** Phase G planning module (10 G1 + 5 G4 detectors + AI memo + firm-wide hit list + multi-year trends) + priority support |

Pricing is per firm (single-tenancy today; per-firm seat pricing
follows D15 multi-tenancy).

Currently both tiers are exposed to all clients (default
`PRO_TIER_ENABLED=true`). Toggling `PRO_TIER_ENABLED=false` flips the
UI to the Pro-locked state for pricing-rollout testing.

---

## Where these prices come from

### Benchmark: tax-prep software (annual)

| Software | Annual | Notes |
|---|---|---|
| Drake Tax | ~$2,000 | Unlimited 1040s; budget option |
| ProSeries | ~$1,500-$3,000 | Intuit's entry tier |
| Lacerte | $5,000-$15,000 | Mid-market |
| ProConnect Tax | $5,000-$15,000 | Lacerte's cloud cousin |
| UltraTax CS | $10,000-$30,000+ | Premium |
| CCH Axcess | $15,000-$40,000+ | Cloud, mid-large |

**Insight.** TaxFlow Standard ($12k/yr) is comparable to Lacerte
mid-tier. TaxFlow Pro ($30k/yr) is comparable to UltraTax top tier.
We are NOT a budget product.

### Benchmark: tax planning software (annual)

| Software | Annual | Coverage |
|---|---|---|
| Holistiplan basic | ~$1,920 | OCR-driven returns analysis (advisor-focused) |
| TaxPlanIQ | TBD | Mid-tier |
| Corvee / Instead | $15,000-$30,000 | 1,500+ heuristics, CPA-tier |
| **TaxFlow Pro** | **$30,000** | 15 hand-calc'd IRC-cited rules + multi-year + AI extraction (unique combo) |

**Insight.** TaxFlow Pro sits at the top of the planning-software
range — Corvee territory. The differentiator that justifies parity-or-
premium pricing is the *AI extraction layer included*; Corvee makes
you key everything into THEIR system separately.

### Benchmark: practice management (annual)

| Software | Annual | Coverage |
|---|---|---|
| Financial Cents | $468 | Budget |
| TaxDome | $696 | All-in-one |
| Karbon | $708 | Workflow focus |
| Canopy | $1,800 | Modular |

**Insight.** Practice management is cheap and TaxFlow is NOT trying
to be one. CPAs already have TaxDome or Karbon for $58-$59/mo;
TaxFlow runs alongside.

### Benchmark: what CPAs charge clients (per Thomson Reuters + NATP 2026)

| Service | Range |
|---|---|
| 1040 standard deduction | $200-$300 |
| 1040 + Schedule C | $400-$800 |
| 1040 + Sch C + multi-state | $800-$1,500 |
| Comprehensive 1040 (1099s, K-1s, Sch D, advisory consult) | $1,500-$5,000 |
| Year-end tax planning (individual) | $3,000-$8,000/yr |
| Business-owner advisory | $5,000-$15,000/yr |
| Comprehensive advisory package | $15,000-$30,000/yr |
| Monthly advisory retainer | $1,000-$6,000/mo |

**Insight.** A single client converted into a comprehensive advisory
package ($15-30k/yr) pays for TaxFlow Pro on its own. The value
question is whether TaxFlow Pro lets the firm convert one such
client they would NOT have converted otherwise.

---

## ROI by persona (math the prospect can rerun)

### Persona 1 — Solo / 1-3 staff

| Assumption | Conservative | Realistic | Bull |
|---|---|---|---|
| # 1040 clients | 50 | 100 | 150 |
| % suitable for planning advisory | 10% | 15% | 20% |
| Conversion rate (CPA-led, with hit list) | 15% | 20% | 30% |
| Avg planning engagement fee | $2,500 | $3,500 | $4,500 |
| **Annual incremental advisory revenue** | **$1,875** | **$10,500** | **$40,500** |
| TaxFlow Pro cost | $30,000 | $30,000 | $30,000 |
| **Net** | **–$28,125** | **–$19,500** | **+$10,500** |
| AI extraction time savings (100 returns × 20 min × $150/hr) | – | $5,000 | – |
| Revised net | **–$23,125** | **–$14,500** | **+$15,500** |

**Verdict.** TaxFlow Pro at $30k/yr is **too expensive for solo CPAs
unless they're at the top of their bracket** (150+ high-AGI clients).
For solos in the conservative-to-realistic range, **TaxFlow Standard
at $12k/yr** is the right product — they get the AI extraction
($5-10k labor savings) without paying for planning they can't
monetize at scale.

**Future move (post-D15).** Introduce a Pro-Solo tier: $1,000/mo
($12k/yr) with the same Pro features but capped at 100 clients.
Math turns net-positive for the realistic case ($10,500 advisory −
$12,000 = –$1,500, plus $5,000 extraction savings = +$3,500 net).

### Persona 2 — Small/Mid Firm, 4-20 staff

| Assumption | Conservative | Realistic | Bull |
|---|---|---|---|
| # 1040 clients | 300 | 500 | 1,000 |
| % suitable for planning advisory | 20% | 25% | 35% |
| Conversion rate | 20% | 30% | 40% |
| Avg planning engagement fee | $3,500 | $4,500 | $6,000 |
| **Annual incremental advisory revenue** | **$42,000** | **$168,750** | **$840,000** |
| TaxFlow Pro cost | $30,000 | $30,000 | $30,000 |
| **Net** | **+$12,000** | **+$138,750** | **+$810,000** |
| AI extraction labor savings (avg $20/return × 500 × 0.5 hr saved × $40/hr) | $4,000 | $10,000 | $20,000 |
| **Net with extraction** | **+$16,000** | **+$148,750** | **+$830,000** |

**Verdict.** Persona 2 is a clean **5-30× ROI**. Even in the
conservative case (no advisory bump, just AI labor savings), they
break even on extraction alone. This is the design-partner target.

### Persona 3 — Mid-size Firm, 20-100 staff (post-D-phase)

Not pursuing today (requires D15 + D17 + D19). When pursued:

| Assumption | Realistic |
|---|---|
| # 1040 clients | 5,000 |
| % suitable + conversion + avg fee | Same as Persona 2 |
| Incremental advisory revenue | $1.5M-$5M/yr |
| **Enterprise pricing** | **$100,000-$300,000/yr** (firmwide deployment) |
| Net | **+$1M-$3M/yr** |
| SOC 2 + multi-tenancy + implementation premium | $50,000-$200,000 one-time |

---

## Pilot pricing (the design-partner ask)

For the FIRST paid design partner (still TBD, post-this-doc):

- **$500/mo for first 30 days** (10 client cap, full feature access)
- **$1,000/mo months 2-3** (scale to 20-25 clients)
- **Standard Pro ($2,500/mo) at month 4** if value is confirmed

This is intentionally cheap. The economics work because:
- We need 1 reference, not revenue
- The partner is doing us a favor by testing
- They have escape hatch — month-to-month, cancel anytime
- Their feedback shapes the roadmap we'd otherwise build wrong

**What the partner gets in exchange:**
- Weekly 30-min Zoom check-ins
- Bug fixes inside a week
- Roadmap influence (their pain points become our prioritization)
- Public reference after 30 days only if they confirm value
- 30-day money-back guarantee

---

## What we won't do on pricing

- **No per-return pricing.** That's the Drake/Lacerte model; doesn't
  match how TaxFlow's value works (advisory upsell is per-client-year,
  not per-return).
- **No usage-based AI extraction pricing.** We bundle it in to keep
  the math simple. Long-term we may meter beyond a fair-use ceiling.
- **No free tier.** Free tiers attract tire-kickers; the value
  conversation is harder when "free" is the anchor.
- **No 12-month annual contract for the pilot.** Month-to-month or
  walk away. Partner trust matters more than revenue lock.
- **No price discounts below pilot pricing for "we're not sure yet".**
  Pilot pricing IS the discount. Below that we'd erode the value
  signal.

---

## When to raise prices

After 3-5 paid customers, the realistic case is:
- Standard: $1,500/mo ($18k/yr) — 50% increase
- Pro: $3,500/mo ($42k/yr) — 40% increase

This puts Pro inside the Corvee comprehensive-package range with
the AI extraction differentiator still intact.

Raise prices for NEW customers only; grandfather existing pilot
partners at their original price for 12-24 months (referenceable
case studies are worth more than the price delta).

---

## Pricing in the cold email

**Don't mention pricing in the cold email.** Price comes up in the
demo or after, when the value picture is clear. The cold email's job
is to earn the demo, not to qualify on budget.

If a prospect ASKS for pricing in the email reply, the response is:

> "Standard is $1,000/mo for the AI extraction overlay (everything
> except the planning module); Pro is $2,500/mo and adds the
> planning detectors + AI memo + firm-wide hit list. Pilot price
> for the first 30 days is $500/mo regardless of tier. Math we'd
> walk through on the demo: for a 500-client firm with even a
> conservative 20% conversion at $3.5k avg, that's $35k incremental
> advisory in year one against the $30k subscription. The break-even
> is well below your client count."

(Customize the numbers to whatever you know about their firm size.)
