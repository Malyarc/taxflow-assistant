# TaxFlow Assistant — One-Pager

**An AI overlay for the CPA's 1040 workflow. Two layers Drake / Lacerte /
ProConnect / UltraTax don't have: (1) AI extraction from client documents,
and (2) a deterministic tax-planning module that ranks every client by
upsellable advisory opportunity with IRC-cited estimated savings.**

We don't replace tax-prep software. We don't do e-filing. We don't manage
client documents or e-sign or billing. Those stay with your existing
stack. We add the AI layer above.

## The pitch in one line

> On a sample high-AGI client in our demo, the planning engine surfaces
> $93,575 of estimated annual federal-tax savings across 5 IRC-cited
> opportunities. Across 88 demo clients, $145k+ in total advisory
> revenue waiting to be converted. Hand-calc'd math, not LLM guesses.

## What it does today (live)

**AI extraction layer (Phase A2):**
- Upload PDFs: W-2, 1099 (NEC/INT/DIV/B/R/G/K/MISC), 1098-E, 1098, K-1, SSA-1099
- AI extracts every field with bounding boxes
- CPA reviews each extracted field next to a snippet of the source PDF
- Approve, edit, add, or clear any value — per-field diff is explicit
- Engine recomputes the return (federal + state, including NYC PIT)
- Export: real IRS Form 1040 PDF, detailed PDF summary, CSV with IRS
  line refs, vendor-neutral .gen summary

**Tax-planning module (Phase G — 15 detector rules):**

*Single-year detectors (G1.1 – G1.10):*
- G1.1 SEP-IRA / Solo 401(k) opportunity (IRC §408(k))
- G1.2 PTET election (IRC §164(b)(6))
- G1.3 Bunch itemized deductions (IRC §170, §63)
- G1.4 Roth conversion window (IRC §408A)
- G1.5 AMT timing — ISO bargain element (IRC §56(b)(3))
- G1.6 NIIT cliff avoidance (IRC §1411)
- G1.7 §199A QBI wage/UBIA limit (IRC §199A(b)(2))
- G1.8 Charitable DAF bunching (IRC §170, §4966)
- G1.9 Tax-loss harvesting (IRC §1211, §1212)
- G1.10 Foreign Tax Credit claim (IRC §901)

*Multi-year detectors (G4.1 – G4.5, requires ≥2 years of history):*
- G4.1 Persistent NIIT exposure (IRC §1411)
- G4.2 Persistent AMT exposure (IRC §55-§59)
- G4.3 Permanent bunching strategy (IRC §170)
- G4.4 Capital loss carryforward unused (IRC §1211)
- G4.5 Passive activity loss suspension growing (IRC §469)

*Plus firm-wide ranking, AI-drafted memo, client outreach email,
missing-data list.*

## Why the engine is worth trusting

| Coverage area | Status |
|---|---|
| Federal Form 1040, Schedules 1/2/3, A, B, C, D, E, SE | ✅ |
| Federal AMT (Form 6251, incl. Part III LTCG preferential rates) | ✅ K3 |
| Federal NIIT (Form 8960) | ✅ |
| Additional Medicare 0.9% (Form 8959) | ✅ K2 |
| Sch SE Line 9 W-2 + SE shared SS wage base | ✅ K1 |
| SS taxability worksheet (Pub 915, 0/50/85%) | ✅ K10 |
| Self-Employed Health Insurance deduction (Form 7206) | ✅ K5 |
| §121 home-sale exclusion ($250k/$500k) | ✅ K6 |
| §1202 QSBS exclusion ($10M/10× basis) | ✅ K7 |
| Kiddie tax (Form 8615) | ✅ K8 |
| FEIE §911 (Form 2555 expat earned income) | ✅ K9 |
| NOL carryforward (post-TCJA 80% limit) | ✅ K4 |
| Schedule D per-transaction + Form 8949 + wash sale | ✅ |
| Schedule E per-property + MACRS depreciation + §469 PAL | ✅ |
| Schedule K-1 (1065 + 1120-S, Box 1/2/3/14A + §199A QBI + passive bucket) | ✅ |
| Form 1116 Foreign Tax Credit (binding + non-binding limit) | ✅ |
| ACA Premium Tax Credit (Form 8962) | ✅ |
| Multi-state — resident + non-resident with resident credit | ✅ |
| CA 540NR non-resident bracket calc | ✅ |
| NYC personal income tax (4 brackets per filing status) | ✅ |
| State EITC piggybacks (CA, NY, CO, IL, NJ, MA + MN WFC) | ✅ |
| HI / NJ / NY / PA / IL / MS retirement-income state exemptions | ✅ |
| CA AMT (Schedule P 540) | ✅ G5-state |
| **Test coverage** | **1,790+ hand-calc'd assertions across 28 suites, 0 real failures** |
| **Documented engine gaps** | **ZERO** (down from 10 federal + 4 state at start of audit week) |
| **Independent audit** | 9 real bugs found + fixed in 2026-05-23 triple-track audit |

## How we're different from Holistiplan / Corvee / Instead

| Dimension | Holistiplan | Corvee/Instead | **TaxFlow** |
|---|---|---|---|
| Buyer | Financial advisors | CPAs | CPAs |
| Pricing | $160/mo | $15-30k/yr | $2.5k/mo |
| # strategies | OCR analysis | 1,500+ heuristics | **15 hand-calc'd, IRC-cited** |
| Math model | OCR + computation | Heuristics | **Deterministic, every $-amount cites IRC + Pub** |
| Multi-year intelligence | Limited | Limited | **5 G4 detectors** |
| AI extraction from source docs | No | No | **Yes** |
| E-filing | No | No | No (we leave this to Drake / UltraTax) |
| Practice management | No | No | No (TaxDome / Karbon territory) |

## What we don't do (by design)

- ❌ E-filing — you file through your existing software
- ❌ Practice management — TaxDome / Karbon / Canopy own this
- ❌ Tax-prep replacement — Drake / Lacerte / ProConnect / UltraTax own this
- ❌ Entity returns (1041 / 1065 / 1120 / 1120-S) — 1040 only
- ❌ File-based UltraTax import — no public format exists; we ship
      vendor-neutral .gen + 10-case validation packet instead

## The deal

We're looking for **one paid design partner** (small-mid firm, 4-20 staff).
$500-$1,000/month for 30-60 days, capped at 10-25 clients. In return:

- Weekly 30-min Zoom check-ins where you tell us what trips you up
- Bug fixes inside a week
- Roadmap influence (your pain points become our prioritization)
- Reference (with your name + firm) after 30 days if you confirm value

**Live demo: 15 minutes, screen-shared.** Pre-loaded with a real
high-AGI client showing the $93k headline + 10-case validation packet
so you can audit the engine against your existing software in
real-time.

**Contact:** [Your name] · [Your email] · [Your phone]
**Demo URL:** http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com
**Demo access:** open demo environment, **synthetic data only** — do not upload real taxpayer documents (production security controls are still being stood up).
