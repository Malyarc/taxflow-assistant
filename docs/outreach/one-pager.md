# TaxFlow Assistant — One-Pager

**A CPA-tool overlay for 1040 prep. Upload client docs → AI extract →
CPA reviews + overrides on a per-field diff → approved values write to
the client record (audit-logged) → export to your existing tax
software via PDF / CSV / vendor-neutral .gen summary.**

## The pitch in one line

Cut the document-keying time on a 1040 from 30 minutes to 5 minutes,
without trusting the AI: every value is shown to you for confirmation
before it touches the client record.

## What it does today (live)

- Upload PDFs (W-2, 1099-NEC, 1099-INT/DIV/B/R/G/K/MISC, 1098-E, 1098,
  K-1, SSA-1099)
- AI extracts every field with bounding boxes
- CPA reviews each extracted field next to a snippet of the source PDF
- Approve, edit, add, or clear any value — diff is shown explicitly
- Engine recomputes the return (federal + state, including NYC PIT)
- Export: real IRS Form 1040 PDF (filled with computed values), full-
  detail PDF summary, CSV with IRS line references, vendor-neutral
  .gen summary

## Why the engine is worth trusting

| Coverage | Status |
|---|---|
| Federal Form 1040, Schedules 1/2/3, A, B, C, D, E, SE | ✅ |
| Federal AMT (Form 6251) — with Form 6251 Part III LTCG preferential rates (closed K3) | ✅ |
| Federal NIIT (Form 8960) | ✅ |
| Federal Additional Medicare 0.9% (Form 8959 — closed K2) | ✅ |
| SS taxability worksheet 0/50/85% (Pub 915 — closed K10) | ✅ |
| Self-Employed Health Insurance (Form 7206 — closed K5) | ✅ |
| §121 home-sale exclusion $250k/$500k (closed K6) | ✅ |
| Sch SE Line 9 W-2 + SE shared SS wage base (closed K1) | ✅ |
| Schedule D per-transaction + Form 8949 + wash-sale | ✅ |
| Schedule E per-property + MACRS depreciation + §469 PAL | ✅ |
| Schedule K-1 (1065 + 1120-S) — Box 1/2/3/14A SE/§199A QBI/passive bucket | ✅ |
| §199A QBI (simplified — wage/UBIA limits not enforced above threshold) | ⚠ |
| Form 1116 Foreign Tax Credit (binding + non-binding limit) | ✅ |
| ACA Premium Tax Credit (Form 8962) | ✅ |
| Education credits (AOC + LLC) with phase-out | ✅ |
| CTC / ACTC / EITC / Saver's Credit / Dep Care | ✅ |
| Multi-state — resident credit for non-resident state tax | ✅ |
| CA 540NR non-resident bracket calc | ✅ |
| NYC personal income tax (4 brackets per filing status) | ✅ |
| State EITC piggybacks (CA, NY, CO, IL, NJ, MA + MN WFC) | ✅ |
| HI / NJ / NY / PA / IL / MS retirement-income state exemptions | ✅ |
| **Test coverage** | **1,584+ hand-calc assertions across 26 test suites, 0 real failures** |
| **Independent audit** | 9 real bugs found + fixed in the 2026-05-23 triple-track audit (security, code quality, tax engine) |

## What it doesn't model (disclosed)

Federal engine gaps still open (6):
- K4 NOL carryforward (post-TCJA 80% limit)
- K7 §1202 QSBS exclusion (tech founder liquidity)
- K8 Kiddie tax (Form 8615)
- K9 FEIE §911 (expat earned income)
- K1 MFJ sub-gap (per-spouse SE attribution — uncommon corner case)
- State-level SS exclusion for non-SS-taxing states

State engine gaps (4):
- NYC EITC sliding scale; MN $1,750/child refundable CTC; WA 7%
  LTCG excise > $262k; CA AMT (Schedule P 540)

Out of scope (will not build until you ask):
- E-filing (you e-file through your existing software)
- File-based UltraTax / Lacerte / ProConnect / Drake import (no
  public format exists; we ship PDF/CSV/.gen instead)

## The deal

We're looking for one paid design partner. $500–$1,000/month, capped
at 10 clients during the pilot. In return: weekly 30-minute Zoom
check-ins where you tell us what trips you up. Engine bugs you find
get fixed inside a week. Workflow gaps get prioritized into the
roadmap. Reference (with your name + firm) after 30 days if you
confirm value.

Live demo: 12 minutes, screen-shared. Pre-loaded with 10 hand-keyable
validation cases so you can audit the engine against your existing
software in real-time.

**Contact:** [Your name] · [Your email] · [Your phone]
**Demo URL:** http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com
