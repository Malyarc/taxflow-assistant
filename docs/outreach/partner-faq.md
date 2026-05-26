# CPA Design-Partner FAQ

Anticipated questions and answers. Updated 2026-05-24.

## "What's your background?"

Engineer / quant. Built this because I watched a CPA friend spend 30
minutes per return just typing in numbers from W-2 PDFs. The
math-engine half I wrote and audited line-by-line against IRS
publications. The AI-extraction half uses Gemini Flash via the
OpenAI-compatible API. The CPA-review UX is the part I think makes it
work — the AI never writes to the client record without explicit CPA
approval, and the diff is shown per field.

## "What's your liability story?"

The engine has 1,584+ hand-calculated assertions backed by direct IRS
publication references (Pub 17, Pub 596, Pub 970, Pub 590-A, Pub 925,
Pub 915, Pub 523, Pub 535, Pub 550, Pub 946, Form 6251/8959/8960/
8812/8949 instructions). Where the engine doesn't model something, I
disclose it (the K-list). You're still the preparer — the engine is a
tool, not a tax advisor. We don't sign returns. We don't e-file.

For data handling: PII is currently stored in our database. The
"demo mode" banner on the live site says don't upload real client
documents. For a paid pilot, the very first thing we build is
encryption-at-rest with S3 + KMS — that's Phase D17 on the roadmap,
about 2 weeks of work once you commit.

## "Is this just a wrapper around ChatGPT?"

No. The AI piece is only the document-extraction step — Gemini Flash
extracts fields from W-2 / 1099 / K-1 PDFs into a structured JSON
schema. That JSON goes to a CPA-review modal where every field shows
the AI's value and you confirm/edit/add/clear. Only after you approve
does it touch the client record.

The tax math is entirely deterministic engine code I wrote and
audited. No LLM is involved in computing AGI, tax, credits, AMT, NIIT,
SE, state tax, etc. The AI cannot affect the tax computation — it can
only propose input values for you to approve.

## "Why should I trust the engine?"

Three things:

1. The audit. We did a triple-track audit on 2026-05-23 with three
independent research agents (code-quality, security, IRS edge cases).
Found 9 real bugs (5 security, 4 code-quality), all fixed. 108
deep-audit assertions added. The report is `docs/accuracy-audit/
deep-audit-2026-05-23.md` — you can read it.

2. The validation packet. 10 hand-keyable cases covering single,
MFJ, HoH, W-2 only, Sch C, LTCG, ISO bargain AMT, EITC, retiree with
SS taxability, multi-state. PDF + CSV + .gen per case. Hand-key into
your software, compare line by line. If you find a discrepancy, I
want to know.

3. The disclosed gaps. I tell you up front what the engine doesn't
model. Currently 6 federal-engine gaps:
- K4: NOL carryforward (post-TCJA 80% limit)
- K7: §1202 QSBS exclusion (founder liquidity events)
- K8: Kiddie tax (Form 8615)
- K9: FEIE §911 (expat earned income)
- K1 MFJ sub-gap: per-spouse SE attribution (corner case)
- State-level SS exclusion (engine includes taxable SS in state base
  for SS-exempt states)

Plus 4 state-engine gaps: NYC EITC sliding scale, MN $1,750/child
refundable CTC, WA 7% LTCG excise, CA AMT Schedule P 540. If you
hit one of these, I prioritize and ship inside two weeks.

## "What's recently changed in the engine?"

The week of 2026-05-24 closed six high-impact gaps end-to-end:
- **K1** — Sch SE Part I Line 9: combined W-2 + SE filers no longer
  over-pay the 12.4% SS portion when their wages + SE exceed the
  SS wage base. ~$10k+ saving per affected filer.
- **K2** — Form 8959 Additional Medicare Tax (0.9% on Medicare wages
  + SE net above filing-status threshold).
- **K3** — Form 6251 Part III AMT × LTCG preferential rates: high-LTCG
  + AMT-binding filers no longer over-pay AMT (LTCG now at 0/15/20%
  inside AMT, not 26/28%). ~$13k+ saving for high-LTCG cases.
- **K5** — SEHI deduction (Form 7206) for self-employed paying their
  own health insurance.
- **K6** — §121 home-sale exclusion ($250k single / $500k MFJ on
  primary residence sale).
- **K10** — SS taxability worksheet (Pub 915 0/50/85%) — engine now
  computes taxable SS from `socialSecurityBenefits` client field.

Plus security hardening (CSP, HSTS, X-Content-Type-Options nosniff,
header injection / MIME-sniff XSS protection on downloads, 8MB
upload cap, audit-log forensic-trail preservation on client delete).

## "What's the workflow when I disagree with the AI extraction?"

You override. Every field has the diff column — ✓ kept, ✎ changed
(with the AI's struck-through value next to your value), + added
(field AI didn't extract that you typed in), ⊘ cleared (field AI
guessed that you wiped). When you click Approve, the audit log
stamps both the AI value AND your final value AND the timestamp. If
a client questions a number, you can show what the AI proposed and
what you actually approved. Forensic trail.

## "What about state coverage?"

All 51 jurisdictions (50 states + DC), federal-confirming and
non-conforming. Multi-state coordination (resident credit for
non-resident state tax). NYC personal income tax including the
household credit. Specific things modeled:
- CA 540NR non-resident bracket calc
- State EITC piggybacks: CA, NY (30%), CO (50% for TY2024),
  IL (20%), NJ (40%), MA (40%)
- MN Working Family Credit (full Schedule M1CWFC)
- HI / NJ / NY / PA / IL / MS partial retirement-income exemptions

Gaps disclosed:
- NYC EITC sliding scale (we have NY state EITC at 30% but not the
  additional NYC sliding-scale 30/25/20/15/10%)
- MN $1,750/child refundable CTC (independent of WFC)
- WA 7% LTCG excise > $262k indexed
- CA AMT Schedule P (540)
- State-specific local taxes other than NYC (MD county, OH cities,
  IN counties — not modeled)
- State CTCs other than what's above

## "How does this fit with my existing UltraTax / Lacerte workflow?"

You keep using your existing software for the actual filing. TaxFlow
replaces the document-keying-in step at the front of your workflow:

1. Client uploads docs to TaxFlow → AI extracts → you review → values
   land on the client record (audit-logged)
2. You export from TaxFlow (PDF / CSV / .gen)
3. You hand-key the summary into UltraTax/Lacerte/etc — typically 5
   minutes from the .gen file vs. 30 minutes from the raw documents
4. You e-file from your existing software

We are NOT competing with UltraTax. We sit upstream — the data
janitor between client documents and your tax software.

There's no public file-based import format for UltraTax CS 1040s
(verified in `docs/ultratax-audit.md`). If a paid customer needs
real ingestion (SurePrep API / SDE XML reverse-engineering / UI
automation), that's a 6-12 week build I'll commit to.

## "What's the pricing?"

Design-partner pilot: $500–$1,000/month, capped at 10 clients for
the first 30 days. If after 30 days you confirm value, you can move
up to a standard tier (TBD; expect $1,500–$3,000/month for 50+
clients). I'll lock in the pilot rate for your first 12 months as
the design-partner reward.

Reference (your name + firm in marketing) optional, not required.

## "What's the support story?"

Direct line to me. Slack channel or email or whatever you prefer.
For pilot phase: weekly 30-minute Zoom check-ins. For engine bugs
you surface: typical fix within a week (sometimes same day for
small ones). For workflow gaps: prioritized into the roadmap, with
a public timeline.

## "Can I see the code?"

For paid pilot partners I can do a structured walk-through of the
engine, audit reports, validation packet, and security hardening
under NDA. The repo itself isn't open-source today; that's a
business decision I might revisit later.

## "What if you go out of business?"

Honest answer: you'd lose access to TaxFlow. But the engine is
designed to be portable — `computeTaxReturnPure` is a pure function
with no DB or I/O dependencies, runnable in any TypeScript runtime.
For paying customers I can commit to source-code escrow if that's a
blocker.

## "When's the next major release?"

Roadmap priorities (in order, post-2026-05-24):
1. K10 + the rest of K-list — close remaining 6 federal gaps over the
   next 2-3 months (NOL, kiddie tax, FEIE, QSBS, MFJ per-spouse SE)
2. State gaps — NYC EITC sliding scale, MN $1,750/child CTC, CA AMT,
   WA LTCG excise (couple weeks each)
3. Phase D — multi-tenancy + encryption-at-rest + Stripe billing
   (only after a paid design partner is committed)
4. AI accuracy benchmark with full 100-doc Gemini run

If you commit to a pilot, your specific blockers jump to the top of
this list.

## "What's the catch?"

You're a design partner of a pre-revenue tool. The catch is:
- It's a young tool with documented gaps
- I might pivot or shut down (low probability but real)
- The "demo mode" PII warning is real until Phase D17 ships
- You have to be okay being asked questions and giving honest
  feedback as the product evolves

In return: you get a tool that cuts your keying-in time by 80%, a
direct line to the builder for bug fixes, the design-partner pilot
rate locked for 12 months, and (if you want it) public reference
status as one of the first three CPAs to validate the workflow.
