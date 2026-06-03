# CPA Design-Partner FAQ

Anticipated questions and answers. Refreshed 2026-05-26 to reflect
Phase G (planning module) + G5 (Pro-tier gate). Backed by research
in `cpa-persona-research.md` and `positioning.md`.

---

## "What's your background?"

Software engineer who built TaxFlow over the last several months
specifically to bridge the AI-extraction + tax-planning gap that
existing CPA tools don't fill. I'm not a CPA — I'm building a tool
FOR CPAs and explicitly want a paid design partner to tell me where
my engineering assumptions break.

The math behind the engine has been hand-calc'd against the IRS
published rules: 1,790+ test assertions across 28 suites, every
expected value verified before asserted. An independent triple-track
audit on 2026-05-23 (security + code quality + tax engine) found
and fixed 9 real bugs.

---

## "What's the product, in one sentence?"

> TaxFlow is an AI overlay that sits on top of your existing tax-prep
> software (Drake / Lacerte / ProConnect / UltraTax) and adds two
> things: AI extraction from source documents (W-2 / 1099 / K-1) with
> CPA review on every field, and a deterministic tax-planning module
> that ranks every client by upsellable advisory opportunity with
> IRC-cited estimated savings.

---

## "What does the planning module actually do?"

15 IRC-cited detectors split across two layers:

**Single-year (G1.1 – G1.10):**
- SEP-IRA / Solo 401(k) for SE filer (§408(k))
- PTET election for SALT cap bypass (§164(b)(6))
- Itemized-deduction bunching (§170, §63)
- Roth conversion window (§408A)
- AMT timing — ISO bargain element (§56(b)(3))
- NIIT cliff avoidance (§1411)
- §199A QBI wage/UBIA limit (§199A(b)(2))
- Charitable DAF bunching (§170, §4966)
- Tax-loss harvesting against $3k ordinary (§1211, §1212)
- Foreign Tax Credit claim vs deduction (§901)

**Multi-year (G4.1 – G4.5), requires ≥2 years of history:**
- Persistent NIIT exposure (§1411) — recurring structural advice
- Persistent AMT exposure (§55–§59) — preference review
- Permanent bunching strategy (§170) — std-ded cliff repeats
- Capital-loss carryforward unused (§1211, §1212)
- Passive activity loss suspension growing (§469)

Plus:
- Firm-wide planning hit list (Top 10 ranked by composite score)
- AI-drafted CPA-facing planning memo (markdown)
- AI-drafted client outreach email
- AI-inferred missing-data list (what to ask the client)

---

## "How is this different from Holistiplan?"

**Holistiplan ($160/mo)** is excellent at what it does — OCR-driven
return analysis aimed at financial advisors (CFP / RIA shops) helping
AUM clients with tax. 30,000+ users; it's the leader in that segment.

**Where they're stronger:**
- Lower price point
- Estate planning module
- Established brand among financial advisors

**Where TaxFlow is different:**
- Built for the CPA prep + advisory motion, not the advisor / AUM motion
- Deterministic math + IRC citation per rule (no LLM in the $-math)
- AI extraction from source documents (Holistiplan starts from a
  filed return PDF; TaxFlow ingests W-2 / 1099 / K-1 directly)
- Multi-year intelligence (5 G4 detectors); Holistiplan is largely
  single-year
- Vendor-neutral .gen export to Drake / UltraTax / Lacerte / ProConnect
- Integrated with the prep workflow rather than parallel to it

The honest answer: if you're a financial advisor doing tax-aware
investment management for AUM clients, Holistiplan is probably the
better fit. If you're a CPA doing 1040 prep + advisory, that's
where TaxFlow is designed for.

---

## "How is this different from Corvee / Instead?"

**Corvee (now part of Instead, $15-30k/yr typical)** has 1,500+
strategies and is a comprehensive CPA-focused planning system.

**Where they're stronger:**
- Sheer breadth of strategies (we have 15 vs their 1,500)
- Established sales motion + onboarding
- Integration with their broader Instead / accounting suite

**Where TaxFlow is different:**
- Our 15 rules are hand-calc'd against IRC + Pub. Their 1,500 are
  heuristic estimates by design. For the CPA worried about
  malpractice exposure on advisory advice, the audit trail matters.
- We include AI extraction from source documents; Corvee requires
  you to key into their system separately
- Multi-year intelligence (G4) — Corvee strategies are largely
  single-year
- Lower-friction: 1 product instead of an ecosystem

The honest answer: if you want maximum strategy breadth and are OK
trading audit-trail clarity for it, Corvee is the better fit. If you
want fewer rules with deeper math + the extraction layer included,
TaxFlow.

---

## "What if I find a bug in the tax engine?"

Email me with the scenario. During a paid pilot I commit to fixing
inside 1 week (clock starts when I can reproduce). Pre-pilot, I
typically fix within 2-3 days.

Engine bugs found in the independent audit 2026-05-23:
- Test scenario 8 EITC inclusion (calculation didn't include EITC in
  expected refund)
- 8 other bugs across security + code quality + engine

All 9 have regression tests in the suite now. Audit report:
`docs/accuracy-audit/report.md`.

---

## "Where's the engine documentation?"

- `CLAUDE.md` — project invariants + the critical 6 tax-domain rules
  (AGI = Line 9 includes LTCG/QDIV; credit ordering follows Sch 3;
  IRA deduction phase-out uses MAGI; state tax base; Sch A from
  per-line items; capital losses dropped not subtracted)
- `docs/accuracy-audit/deep-audit-2026-05-23.md` — the 210-test
  audit report
- `docs/accuracy-audit/report.md` — IRS-cited assertion list
- `lib/planning-strategies/src/strategies-v1.json` — the 15-rule
  catalog (every entry has IRC section + IRS pub + formula)
- `scripts/src/tax-engine-planning-tests.ts` — 133 G1 hand-calc'd
  assertions with IRC citations
- `scripts/src/tax-engine-planning-multi-year-tests.ts` — 70 G4
  hand-calc'd assertions

---

## "What's the pricing?"

(Full breakdown in `pricing.md`.)

- **Standard**: $1,000/mo ($12k/yr) — AI extraction overlay + 1040
  engine + multi-state + exports. No planning module.
- **Pro**: $2,500/mo ($30k/yr) — Standard + 15 planning detectors +
  AI memo + firm-wide hit list + multi-year trends.

**Pilot**: $500/mo for the first 30 days, $1,000/mo months 2-3,
month-to-month. Capped at 10-25 clients during the pilot.

This is intentionally below the Standard tier — we need a reference,
not revenue. After month 3 we'd move you to the regular tier or part
ways with no obligation either way.

---

## "What does the paid pilot look like?"

**Length**: 60 days (extendable to 90 by mutual agreement).
**Price**: $500/mo first 30 days, $1,000/mo days 31-60. Month-to-month.
**Scope**: 10 of your real clients during the first 30 days; up to
25 during days 31-60.
**Commitment**:
- Weekly 30-minute Zoom check-in
- Bugs you find I fix inside a week
- Roadmap influence — your top pain points become my prioritization
- Public reference (your name + firm) after 30 days only if you
  confirm value (you choose; I don't ask first)

**What I commit to**:
- Engine bug fixes in 1 week (clock starts on reproducible report)
- Workflow gaps prioritized into the next 2-week sprint
- No surprise feature deprecations during the pilot
- Honest disclosure of all open engine gaps (4 federal, 4 state,
  per current audit)

**What I'm asking from you**:
- 10 real clients ingested via the AI extraction → CPA review flow
- Use the planning module on each — surface what hits, what misses,
  what would have hit if X were modeled
- Honest feedback on which workflows break down
- Permission to fix what you surface and re-run

**Cancel anytime, no questions.** Pilot is structured so neither of
us is locked in past month-to-month.

---

## "Is the engine SOC 2 compliant?"

No, not yet. SOC 2 Type I prep is on the roadmap (Phase D19) but
it's a 3-6 month, $30-60k effort I haven't done speculatively. For
mid-size firms with procurement gating on SOC 2, we'd talk pilot
scope around that — e.g., dedicated single-tenant instance, no
real PII during pilot, full SOC 2 commitment with a defined start
date contingent on paid contract.

For small/mid firms (Persona 2, 4-20 staff) where procurement is
less formal: the pilot runs on a single-tenant instance with an
audit_log on every mutation. TLS in transit, application-layer
encryption of SSN/TIN at rest, and an access-gated API are being
stood up under our written information security plan (WISP) and are
**required before any real taxpayer PII is uploaded**. We do not
represent a control as live until it is verified — ask us for the
current status table.

---

## "Where do client documents live?"

**Today (demo)**: Base64-encoded in the application Postgres
database, single-tenant. This demo environment is **not yet hardened
for real taxpayer PII — do not upload real client documents to it.**

**Before any real PII (security-hardening gate, in progress)**:
application-layer (AES-256-GCM) encryption of SSN/TIN, document
blobs moved to an S3 bucket with KMS encryption at rest and
short-lived signed-URL download, TLS in transit, and an access-gated
API. Status is tracked in our WISP; we will not accept real PII
until these controls are live and verified.

---

## "What about multi-tenancy / user accounts?"

Honest answer: **single-tenant today (no user accounts, no RBAC)**.
You'd run on a dedicated instance during the pilot.

Multi-tenancy is Phase D15, scoped at 2-3 weeks. The `audit_log`
table already has a nullable `actorUserId` column ready for the
auth wiring. Per-firm + per-user + per-client RBAC follows the
typical Express + Passport pattern.

D15 work starts when a paid pilot is signed; it should be in
production by week 4 of a 60-day pilot.

---

## "What if I want to file through TaxFlow directly?"

We don't and won't. **E-filing requires IRS e-file approval, a
multi-year regulatory + compliance + infrastructure project.** Drake
/ Lacerte / ProConnect / UltraTax own that space; we don't compete.

What we DO is bridge: vendor-neutral .gen export + IRS Form 1040
PDF + CSV with line refs. Your prep tech keys these into your
existing software for the actual filing. The validation packet in
`docs/validation-packet/` covers this round-trip for 10 typical
1040 complexity cases.

---

## "What if I find I prefer Holistiplan / Corvee / Drake's built-in
planning?"

Genuine answer: that's a useful data point. Tell me what specifically
they do that we don't, and I'll evaluate building it. If the gap is
too large to close in 2 weeks, we'd cleanly part ways at the next
month-end.

I'm trying to find the firm where the AI extraction + planning
combination is the right fit. If it's not yours, no hard feelings.

---

## "Do you do entity returns (1041, 1065, 1120, 1120-S)?"

No. TaxFlow handles 1040 only.

K-1 ingestion FROM 1065 and 1120-S is supported (Schedule K-1 tab —
Box 1 ordinary income, Box 2 rental, Box 3 portfolio, Box 14A SE,
§199A QBI, passive bucket). Generating the underlying entity return
is not in scope (Tier D3 in the long-term roadmap; not on the
pursued path).

---

## "What about state-specific stuff?"

| Feature | Status |
|---|---|
| Federal Form 1040 + Schedules 1/2/3/A/B/C/D/E/SE | ✅ |
| All 50 states + DC (resident + non-resident with credit) | ✅ |
| CA 540NR non-resident bracket calc | ✅ |
| NYC personal income tax (4 brackets per filing status) | ✅ |
| State EITC piggybacks: CA, NY, CO, IL, NJ, MA, MN WFC | ✅ |
| Retirement-income exemptions: PA, IL, MS (full); HI/NJ/NY (partial) | ✅ |
| NYC EITC sliding scale | ✅ (G1 closure) |
| MN $1,750/child refundable CTC | ✅ (G2 closure) |
| WA 7% LTCG excise on >$262k | ✅ (G4 closure) |
| CA AMT (Schedule P 540) | ✅ (G5 closure) |
| Part-year residency in multi-state framework | ❌ open (Phase E reactive) |
| Other local income taxes (MD counties, OH cities, IN counties) | ❌ open (Phase E reactive) |
| State CTCs (CA/CO/NJ/IL/NM/VT) | ❌ open (Phase E reactive) |
| State EITC: CT/DC/DE/IN/IA/KS/LA/ME/MD/MI/MT/NE/NM/OH/OK/OR/RI/VT/VA/WA/WI | ❌ open (Phase E reactive) |

If your client mix is concentrated in a state we don't cover well
yet, tell me — I'll size and prioritize. State coverage is typically
2-5 days per state.

---

## "What about IRS / state notice response?"

Out of scope today. Notice response is downstream of the prep workflow
(comes from the prep software + audit defense product); TaxFlow's
focus is the prep + planning step.

The audit_log on every mutation is structured to support notice
response — every field change tracks before/after + who/when —
but we don't generate response letters today.

---

## "Have you tried this on a real CPA?"

No live design partner yet, which is why this packet exists. The
intent is for you to be the first paid partner — your feedback shapes
the next 90 days of roadmap and you get reference / pricing
preferential treatment in exchange.

What we have done: built a synthesized CPA-persona research doc
(`docs/outreach/cpa-persona-research.md`) sourced from CPA Trendlines
2026 outlook, Journal of Accountancy 2025 tax-software survey,
Thomson Reuters Tax Advisory 2026 report, NATP 2026 fee survey,
CPA Practice Advisor, AICPA pipeline data, and several
software-vendor comparisons. Every claim in the cold email + this
FAQ + the demo script ties back to a sourced statement in that doc.

---

## "What's the demo URL? Can I look at it now?"

http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com

It's a live single-tenant instance with 88 seeded demo clients
(NOT real PII). Login is open during pilot recruitment. Read the
"demo mode — do not upload real tax documents" banner at the top.

Most interesting starting points:
- Dashboard → Top 10 planning targets widget
- Click `edge-big-ltcg` → Planning tab → $93k headline
- Click `high-amt-binding` → Planning tab → $17k headline
- Documents tab on any client → upload a sample W-2 PDF → review

---

## "Who else are you talking to?"

I'll be honest: you're (likely) the first or second firm I've
reached out to. The intent is to find 1 paid design partner — not
3, not 10 — and learn from that pilot before scaling outreach.

If you want a reference from someone else who's used it, the
honest answer is "not yet — that's what this pilot would
generate." If that's a dealbreaker, no hard feelings; I'll come
back when I have one.
