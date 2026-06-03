<!-- Commissioned 2026-06-02 by a 15-agent ground-truth audit (8 recon readers over real source + docs, 4 expert-persona verdicts [CTO + tax-prep CPA + tax-planning CPA + market], 2 adversarial critics, 1 synthesis). Claims re-verified against code. This is the candid counter-weight to the self-congratulatory phase docs. -->

# TaxFlow Assistant — Board-Grade Technical & Commercial Assessment

*Principal-Engineer / CTO lens + CPA tax-prep & tax-planning lens. Synthesized from 8 ground-truthed recon reports, 4 expert verdicts, 2 adversarial critiques, with key claims re-verified against source.*

*Date: 2026-06-02 · Subject: TaxFlow Assistant (github.com/Malyarc/taxflow-assistant), ~4 weeks old, single developer, 240 commits*

---

## 1. Bottom line up front

TaxFlow Assistant is a CPA-focused 1040 tax-prep + tax-planning web app pursuing "Option A" — an AI overlay on top of existing professional tax software (Lacerte / ProConnect / UltraTax CS / Drake / CCH Axcess). Underneath the marketing, there are genuinely **two products in one repo with opposite grades**: a legitimately strong, verifiably-pure 1040 calculation engine (`computeTaxReturnPure`) with OBBBA TY2026 conformance and 3,320 hand-calc'd assertions that I confirmed run green to the digit — Senior-to-Staff-level domain work — wrapped in a **demo-grade platform with no auth, no TLS, plaintext SSNs, two leaked-and-unrotated production credentials, and zero customers**. The self-congratulatory docs ("ZERO documented gaps," "97.5% accuracy," "independent triple-track audit," "TLS + encryption at rest") are, on verification, a reality-distortion field: the security claims are *affirmatively false* on a live wide-open HTTP box, the "independent audit" was three self-run Claude agents, and the "CPA validation" is a fictional persona the doc itself admits it invented.

The one-sentence verdict: **a brilliant tax-calculation library and a best-in-class "LLM-never-touches-the-math" planning architecture, trapped inside an unshippable trust layer the team has deliberately outsourced to a hypothetical future app — and the company has, in its own roadmap, renounced its own path to revenue.**

| Dimension | Grade | One-line justification |
|---|---|---|
| **Tax engine (calc correctness)** | **B+** | Verified-pure 1040 engine; AMT/QBI/NIIT/Sch-D done to professional standard; but a *confirmed silent wrong answer* on TY2026 SSTB QBI + no Form 2210. |
| **Planning engine** | **B−** | Best-in-class trust architecture (LLM never touches math, verified); but only 23% engine-verified, ranked on heuristics, no optimizer, annual-decay kill-switch. |
| **Backend / Infra** | **C** | Disciplined request layer (Zod everywhere, zero SQLi); everything above it — auth, TLS, IaC, CI, DR — is absent. |
| **Security / Compliance** | **D−** | No auth, no TLS, plaintext PII, leaked live creds, and an undiscovered §7216 criminal-statute exposure + missing legally-mandatory WISP. |
| **Frontend** | **B−** | Clean React Query + good design tokens; one 5,036-LOC god-file, zero tests, dead form-validation lib, primary output panel untyped. |
| **Testing / CI** | **C+** | Excellent hand-calc value discipline; but no CI, no FE tests, test files excluded from typecheck → green-on-wrong-shape is structurally guaranteed. |
| **AI / ML (extraction)** | **C+** | Sound human-in-the-loop gate + review UX; but 77.7% recall on 25 synthetic W-2s, no confidence scores, 1099s never measured live, no eval loop. |
| **Data model** | **C+** | Competent single-tenant schema, correct FK cascades; zero tenancy seams, plaintext PII, stale migration baseline, cross-year adjustment bug. |
| **Commercial readiness** | **D+** | Zero customers, zero real partners, mispriced, wedge being subsumed on both halves by funded incumbents and AI-natives. |

---

## 2. What you've actually built

**The product inventory is real and unusually deep for a 4-week solo build.** This is not vaporware.

- **A portable, pure 1040 calc engine** (`computeTaxReturnPure`, taxReturnEngine.ts:1179) covering Form 1040 + Schedules 1/2/3/A/B/C/D/E/SE, AMT (Form 6251), NIIT (Form 8960), QBI (§199A), 51 state jurisdictions, ~446 localities, K-1 ingestion (§704(d)/§465 basis + at-risk limits), and current OBBBA TY2026 conformance. I re-verified purity: an awk-scoped grep of the entire function body finds **zero** `Date`/`Math.random`/`process`/`db`/`await`/`fetch` references. The "Haven-portable" claim is **technically true**, and the Drizzle adapter (taxReturnPipeline.ts) cleanly isolates all I/O.
- **A 101-strategy IRC-cited planning catalog** (`strategies-v1.json`, v1.19.0, 182 KB) with a detector engine (planningEngine.ts) and a what-if harness (whatIfEngine.ts) that re-runs the real engine on mutated inputs and diffs field-by-field.
- **A demoable CPA workflow end-to-end:** create client → upload PDF → Gemini vision extract → per-field CPA review/diff modal (with bounding-box click-to-highlight + live W-2 box-arithmetic validation) → approve gate → compute → export PDF/CSV → planning memo/email.
- **3,320 hand-calc'd no-API assertions across 39 suites**, which I ran: the runner reports `3320 passed, 0 failed` — **honest to the digit.**

**What is genuinely strong (real credit where due):**

1. **The hard tax hotspots are implemented to a professional standard, not approximated.** AMT runs true Form 6251 Part III mechanics — the preferential-rate MIN on LTCG/QDIV, the MFS breakpoint halving, line-2e state-refund removal, the §56(d) ATNOLD 90% cap (taxCalculator.ts:5649-5727). The AGI/Line-9 pipeline correctly routes LTCG+QDIV+STCG *into* AGI then carves the preferential portion *back out* for federal tax. Capital losses net per Schedule D with the $3k/$1,500-MFS offset and character-preserving carryforward. Credit ordering caps each non-refundable credit against income-tax-only (never SE/NIIT). A working tax partner who verified these in code (not the marketing) came away respecting the engine.

2. **The "LLM never touches math" architecture is real and rare.** I verified it: planningMemo.ts hard-bans the model from inventing/calculating/modifying any dollar figure (lines 54-59); the LLM only narrates pre-computed structured hits; every dollar originates from the deterministic engine. For a malpractice-nervous CPA, "no AI-hallucinated savings number reaches a client memo" is a defensible, marketable trust edge that the funded AI-natives largely lack.

3. **The hand-calc test discipline is the project's single best engineering asset.** Every sampled assertion carries a line-by-line `Hand-calc:` block citing the specific IRC section / IRS worksheet, and many document the pre-fix-vs-post-fix value to lock a regression. This is exactly the right rigor for a money engine.

4. **OBBBA currency is ahead of where most incumbents were in mid-2026** — SALT $40k + §164(b)(7) phase-down, §199A made permanent with the widened TY2026 band, clean-energy credits correctly *expired*, the 4 new deductions (tips/overtime/car-loan/senior) modeled as real engine adjustments.

5. **`stateTaxData.ts` is unusually honest internally** — a 24-line header enumerates every approximation (AGI−stdDed proxy, no personal exemptions for most states, MFS-defaults-to-single). This candor is the *opposite* of the customer-facing tone, which is itself the core problem (see §6).

---

## 3. Technical assessment (CTO lens)

*Leading with the most important.*

### 3.1 Security & compliance is the dominant problem — the platform cannot hold one real CPA's clients

This is not a "harden it later" roadmap item; it is a stack of legal preconditions, several of them statutory floors that bind the *CPA customer* directly:

- **Zero authentication across all 79 endpoints** (verified: **0** markers for `req.user`/`firmId`/`tenantId`/`jwt`/`passport`; `middlewares/` is an empty `.gitkeep`). `clientId` is the only access boundary and it is fully attacker-controlled. `GET /clients` returns the entire roster; `GET /clients/:id/documents/:id/content` streams any tax document to anyone.
- **No TLS.** The box serves cleartext HTTP on :8080 (helmet HSTS is *deliberately disabled* because :443 is closed). SSNs, EINs, and full scanned documents cross the wire in the clear.
- **Plaintext PII at rest.** `employee_ssn`, `payer_tin`, `recipient_tin` are bare `text` columns; `tax_documents.file_content` is base64 plaintext in Postgres. No pgcrypto, no app-layer cipher (grep-confirmed empty).
- **Two leaked, unrotated production credentials** — the Neon `neondb_owner` DB password and the Gemini API key — documented as pending since 2026-05-28 and **still pending in today's (2026-06-02) handoff** (verified at handoff.md:38-39). Neon is internet-reachable, so this is a **live, ongoing breach of the production database independent of the EC2 box, right now.**

### 3.2 Correctness-as-a-system: the test discipline has a structural hole that produces the founder's stated worst fear

The hand-calc discipline is excellent **on values** and broken **on shapes**:
- There is **no CI of any kind** (verified: `.github/workflows` absent; 240 commits, zero CI-related). The 3,320 assertions protect nothing unless a human remembers to run them before a manual rsync deploy.
- **All ~58 test files are excluded from typecheck** (scripts/tsconfig.json), run only via `tsx` (which strips types without checking), and **the CLAUDE.md workflow rule mandates adding each new test file to that exclude list** — institutionalizing the blind spot. I confirmed the consequence: a fixture references `distributionCode` on `Form1099Fact`, a field that does not exist on that type, so `tsx` silently drops it at runtime while the suite reports green. The test asserts against data the engine never received. This is *exactly* "tests passing on wrong premises," made a structural guarantee rather than a hypothesis.
- No coverage measurement, no mutation testing, no property/fuzz testing on the cliff functions (NIIT $200k/$250k, §199A phase-in, AMT exemption phase-out, EITC plateaus). Green-on-correct is proven; **red-on-incorrect is assumed, never evidenced.**

### 3.3 Architecture & code health: a strong core wrapped in god-files

The federal core is clean (0 TODO/FIXME, 0 `as any` in the four core files). The liability is concentrated in three god-files: `planningEngine.ts` (8,115 LOC — 96 detectors hand-wired in a 240-line if-push sequence where a *missing push silently drops a strategy*; 4 catalog IDs are already missing, evidence of churn), `taxCalculator.ts` (5,825 LOC, a module-as-god-file mixing federal brackets + 50-state data + NYC PIT + locality registries + ~40 credit calculators), and the frontend `ClientDetail.tsx` (5,036 LOC, 90 useState, all 21 `as any`). A stale in-file comment at taxCalculator.ts:13 *flatly contradicts its own contents* ("Federal: no AMT, no QBI, no EITC, no CTC" — the file implements all four in depth). **Bus-factor risk is acute:** 28K+ LOC of tax logic in one person's head, no CI to enforce the hand-calc rituals tooling doesn't capture.

### 3.4 Year-table fragility produced a confirmed shipped wrong answer

The engine has 24 scattered year-indexed `Record<TaxYear,...>` maps plus inline per-year objects, all of which must be updated in lockstep each tax year with no compile-time guard. I verified the red-team's headline: the SSTB §199A phase-out selector at **taxReturnEngine.ts:2346 is literally `taxYear === 2025 ? QBI_PHASEIN_2025 : QBI_PHASEIN_2024`** — there is **no 2026 key**, so a TY2026 return falls through to the 2024 band ($191,950/$383,900) while the *same computation's* wage/UBIA limit correctly uses the OBBBA 2026 band. **One return computes two different §199A thresholds.** This lands squarely on the high-income pass-through book (doctors/lawyers/advisors) that is the stated ICP, with no warning. The celebrated "CORE OBBBA conformance SHIPPED" commit did not actually wire 2026 into this path.

### 3.5 Scalability, observability, data/tenancy, release engineering

- **Single-EC2 SPOF**, no IaC (no Terraform/Docker/ecosystem file), manual ssh+pnpm+rsync deploy, no Node engine pin.
- **Prod schema mutated via `drizzle-kit push`** — which the project's own config (drizzle.config.ts:11-14) warns reads a column rename as drop+add = **silent irreversible PII loss**. The safe `migrate` path is blocked: prod Neon was never baselined and the committed baseline is already ~4 commits stale. Every schema change is a potential data-loss event.
- **Observability is Pino logs only** — no metrics, tracing, error-tracking, or alerting; `/healthz` returns static `ok` without ever touching the DB (a liveness check mislabeled as health).
- **Zero multi-tenancy seams** — no users/firms table, not one nullable `firm_id` on any of 13 tables; `audit_log.actor_user_id` is a nullable orphan. The "defer auth to Haven" bet is not deferring a *feature*; it is **accumulating a multi-week backfill-and-ALTER migration that grows more expensive with every row.**
- **Two unauthenticated O(N) compute fan-outs** (`/planning-hit-list`, `/peer-benchmark`) load every client and loop the 270 KB engine per client — a cheap DoS amplifier, and `/peer-benchmark` is *also a latent cross-tenant PII leak* the moment tenancy lands and isn't rewritten.

**What is genuinely good at the request layer (real credit):** 79/79 endpoints validate with Zod `safeParse`; **zero** raw SQL / string-interpolated WHERE (SQL-injection surface is effectively nil); child resources are IDOR-scoped by `and(eq(id), eq(clientId))`; helmet + CORS allowlist + rate limiter installed; atomic transactions on the dangerous multi-write paths; `toNum` console-warns rather than silently zeroing non-finite money values. The team audits itself well *at the handler level* — the gap is everything above it.

---

## 4. Tax-PREP assessment (CPA lens)

**"ZERO documented gaps" is a bookkeeping artifact, and I can name the mechanism.** `deep-audit-latest.json` hard-codes `documentedGaps: 0` because the K-list/G-list audit *suite* stopped tracking, while CLAUDE.md's own "Known limitations" section enumerates ~15 live un-modeled items. The slogan means "0 gaps we still write down," not "0 gaps" — and it is propagated verbatim into 4 customer-facing outreach docs.

**What silently breaks on real returns:**
- **No Form 2210 / §6654 underpayment penalty anywhere** (verified: the only "2210" in the engine is the coincidental EITC bracket constant `[0, 970, 2210, 2630]`). CPAs need this number on nearly every SE or high-income return.
- **TY2026 SSTB QBI is silently wrong** (§3.4) — over-states tax for exactly the high-income pass-through clients targeted.
- **State engine is `federalAGI − stdDed` with no modifications layer** for 40+ states — no muni-bond interest add-back, no US-Treasury-interest subtraction, no true IT-203/540NR per-line sourcing. Any client with a muni portfolio (state tax understated) or a real multi-state year gets a return a CPA can't sign behind.
- **No non-resident-alien / international coverage at all** — 1040-NR is a single checkbox on the extension form; no substantial-presence test, no treaty handling, no FBAR/FATCA/Form 8938/8621/3520, no ITIN flow. A whole client class, with draconian non-filing penalties, silently excluded.
- **Bonus-depreciation TY2025 dual-rate gap** (40% pre-1/19/2025 vs 100% after) — the engine has no acquisition-date field and defaults to 40%, *under-stating* depreciation for any 2025 return with post-1/19 purchases. This is a **current-filing-season wrong number**, not a 2026 edge case.

**The AI-extraction recall problem is the core value-prop killer.** On the *only* real evidence (25 synthetic pdfkit-rendered W-2s; 1099s never measured because of a Gemini free-tier 429 quota wall at doc ~25), extraction is **97.5% precision but 77.7% recall with NO per-field confidence scores.** One in five true fields is silently dropped, presenting as a blank box on an otherwise-clean form. With no confidence signal, the CPA must re-read every box on every form — **that is re-keying with extra steps, not automation.** Coverage is W-2 + 8 single-page 1099 subtypes only: no 1098, no consolidated brokerage 1099 (the multi-page composite that *is* the investor client's intake), no K-1, no 1095-A, no SSA-1099 — most of a 1040 practice's mail.

**Missing the workflow CPAs actually run.** There is **no return-level diagnostics engine** — the critical/warning list (missing dependent TIN, missing EIN, unbalanced return, e-file rejects) that *is* the file-prep ritual in UltraTax/Lacerte. The W-2 validator is the only error-check and it only sees W-2s. The muscle memory of "prep → run diagnostics → clear criticals → file" has no home here.

**The Option-A overlay friction is fatal and self-admitted.** `docs/ultratax-audit.md` concedes the `.gen` "import" was *fabricated* — "the format and codes were invented... None of those tools import this format." So whatever TaxFlow computes gets **re-keyed into UltraTax/Lacerte anyway** — a parallel data-entry silo, the exact friction CPAs reject.

**vs Lacerte / UltraTax / Drake:** competitive on raw 1040 calc correctness for *in-scope* situations, but not a filing tool (no e-file, no diagnostics, no real import, no state modifications depth). **vs AI-natives (Black Ore, Filed, april):** ahead on a verifiable deterministic engine, behind on funding and live-proven extraction. **vs SurePrep/GruntWorx on intake:** far behind — those handle consolidated 1099s, K-1s, 1098s, multi-page, *with confidence and write-back*.

---

## 5. Tax-PLANNING assessment (CPA lens)

**The credibility crux: the trust pitch is structurally inverted.** The "every dollar traces to a statute" claim is true for the *narration* and **false for the prioritization.** I verified `liveHits.sort((a, b) => b.estSavings - a.estSavings)` at planningEngine.ts:8035 — the CPA-facing list ranks on the **heuristic** `estSavings`, and only **22 of 96 detectors (~23%)** attach a real engine-computed delta (the precise number is quarantined in a separate `whatIf` field nobody sorts or scores on). The other **74 emit hardcoded single-multiplier guesses** (state-residency = `stateTax × 0.5`; Augusta = 14 days × $1,500 × marginal; Coverdell = $2k × growth × marginal). A 0.95-confidence engine-checked SEP hit and a 0.3-confidence $238k QSBS guess render with *identical UI authority*. **A CPA who bills a $1,500–$5,000 engagement off a top-ranked heuristic that is materially wrong has the exact malpractice exposure the deterministic pitch was supposed to eliminate — the moat misfires.** Mean catalog confidence is 0.587 with 28 strategies below 0.5.

**No optimizer anywhere — the core of high-end advisory is absent.** The Roth detector only fills *current-year* bracket headroom; there is **no multi-year bracket-fill sweep, no RMD/IRMAA/SS-taxability-aware conversion-ladder solver** — the headline feature of RightCapital, Corvee/Instead, and Intuit Tax Advisor. The S-corp "optimizer" is a hardcoded 40/60 wage/distribution split (Corvee's entire wedge is *solving* reasonable comp). The ISO/AMT detector only flags that AMT exists; it doesn't model an exercise schedule across years. Retirement-distribution sequencing is hardcoded `$4,000/yr`. The multi-year engine clamps every projection year to one bracket year and freezes carryforwards, **systematically biasing absolute multi-year burdens for exactly the threshold-crossing strategies (NIIT/AMT/§199A/IRMAA) where multi-year planning earns its fee.**

**A hard annual-decay kill-switch nobody priced.** I verified the cliff: **93 of 101 strategies (3 + 90) carry `validUntil` ≤ end-2026**, and PLAN-08 (`isStrategyExpiredForYear`) now *actively suppresses* expired strategies. A firm buying the $2,500/mo Pro tier to do TY2027 planning watches the catalog **collapse to ~8 hits on Jan 1, 2027**, unless someone re-versions ~100 IRC-cited strategies every single year — work that appears in **zero roadmap line item.** This is the single most under-acknowledged business risk and it is *built into the code.*

**The deliverable is a first draft, not billable.** The memo architecture is right (no invented numbers, personalization rules) but the stub is a flat bulleted dump of rationale strings under a <400-word cap — no charts, no before/after scenario tables, no firm branding. It saves a CPA 30 minutes; it is not the document a partner hands a client and bills $1,500+ for. **Worse, the AI-drafted client-facing *email* promises the client a specific "~$X in savings" with ZERO disclaimer** (the "CPA validates" caveat lives only in the internal memo) — and when 77% of those figures are unverified heuristics, that is a direct E&O / Circular 230 due-diligence exposure.

**vs Holistiplan** (~$749–$1,499/yr, ~39% market share): competitive-to-ahead on engine-verified deltas and cross-strategy interaction modeling (which Holistiplan doesn't do), behind on scan-to-report polish. **vs Corvee/Instead** ($15–30k/yr): a **full tier behind** — they optimize across entities and years; TaxFlow flags single-year opportunities. The one place TaxFlow leads everyone: deterministic IRC-cited math with a per-hit audit trail — *if* the verified delta were the headline number.

---

## 6. The hard truths / biggest risks

Ordered by severity. The first is the single highest-severity finding in the entire audit and **no prior lens surfaced it.**

1. **§7216 is a buried criminal landmine that makes the CPA customer a federal lawbreaker on the first real upload.** IRC §7216 makes it a *crime* (up to $1,000 fine + 1 year imprisonment, *per disclosure*; +$250/disclosure under §6713) for a tax-return preparer to disclose return information to a third party without **prior, signed, per-taxpayer written consent** in the exact Treas. Reg. §301.7216-3 / Rev. Proc. 2013-14 format. Sending a W-2/1099 image to Google Gemini *is* such a disclosure. I verified: the full unredacted document goes to Gemini with zero redaction, the only "consent" is a one-line UI banner, and **"7216" appears nowhere in the entire repo** (grep count: 0). A static banner is categorically not §7216 consent — and `partner-faq.md` *actively invites* CPAs to "ship real PII through the pilot." The moment they do, the CPA commits a potential criminal violation. This is a legal precondition, not a roadmap item.

2. **The legally-mandatory FTC GLBA Safeguards-Rule WISP does not exist and isn't even on the roadmap.** Tax preparers are "financial institutions" under 16 CFR Part 314; the amended Rule *requires* a Written Information Security Plan with a named Qualified Individual, risk assessment, encryption in transit *and* at rest, MFA, and an incident-response plan — **regardless of revenue or customer count**, attested at PTIN renewal. The roadmap tracks SOC 2 (the *least* legally-required, sales-gating item) but omits the WISP (the binding legal floor), TLS-as-a-gate, MFA, and an IRP. The team conflated "nice-to-have attestation" with "federal law."

3. **The customer-facing security claims are affirmatively false — an FTC Section 5 deception exposure on top of the breach risk.** `partner-faq.md` and `one-pager.md` promise CPAs "TLS in transit, DB-layer encryption at rest" and "demo/demo (read-only) credentials." Verified reality: HTTP-only box, plaintext PII, and **no login route at all** (full read+*write* to anyone with the URL). If a CPA relies on "encryption at rest" to satisfy *their* Safeguards obligation and a breach occurs, that is a misrepresentation with direct liability transfer.

4. **No-auth blast radius + an active unremediated breach with no notification capability.** Anyone reaching :8080 enumerates every client and downloads every document. Two prod credentials are leaked-and-unrotated *as of today*. There is no breach detection, no notification runbook, and no per-record access log to even *scope* who was exposed — while FTC (30-day, 500+ consumers), IRS Stakeholder Liaison, and 50-state laws all impose notification duties.

5. **Heuristic-estimate malpractice risk** (§5) — 77% of planning dollar figures are unverified guesses with identical authority to verified ones, and the client-facing email forwards them with no disclaimer.

6. **Single-box DR is a null set.** No IaC, no tested RTO/RPO, Neon PITR never configured, prod schema via the data-loss-prone `push`, no soft-delete despite the 3-year (§7216 consent) / 7-year (workpaper) retention norms and right-to-erasure obligations.

7. **The Haven dependency = renounced revenue path.** D15 (auth/tenancy) — which the roadmap *itself* calls "the gate to a paid design partner" — is postponed indefinitely to an external app that may never ship, with zero schema seams reserved. **The company cannot legally onboard one paying multi-user firm on any timeline it controls.** The outreach campaign, the $30k pricing, and the demo-box invitations are therefore premature theater on top of an unshippable trust layer.

8. **Zero customers, zero real validation, wedge being subsumed in real time.** No paid customers, no real CPA design partner (C3 is a fictional persona). Both halves of the "overlay" wedge are already owned: **SurePrep** (Thomson Reuters — whose software you overlay) already scans-populates-and-*writes back* natively with a human-verify service; **Intuit ProConnect** ships native AI import + an AI review engine + Intuit Tax Advisor bundled in; **Holistiplan** owns the planning category 20x below your price. Meanwhile AI-natives out-fund you 100–1000x (Black Ore $71M, Filed $17M, Juno $12M). The stated differentiator "AI extraction included, unlike Corvee" is **false** against this field.

---

## 7. What to build next — prioritized roadmap

A single integrated, ranked plan. **P0 = mandatory before any real client PII or first revenue. P1 = the next 1–2 quarters, the wedge. P2 = the differentiators that "revolutionize."**

### P0 — Legal & security preconditions (do these before the first real return; weeks, not quarters)

| # | Item | Why | Effort |
|---|---|---|---|
| P0-1 | **Rotate the two leaked Neon + Gemini credentials TODAY**; scrub history; move to AWS Secrets Manager/SSM | Live, internet-reachable breach right now | <1 day |
| P0-2 | **§7216 consent flow + a Google DPA** — a prior, signed, per-taxpayer consent in Rev. Proc. 2013-14 format, stored and versioned, gating every Gemini transmission | Criminal statute; the customer commits the violation without it | 1–2 wks |
| P0-3 | **Write the FTC GLBA Safeguards-Rule WISP** (named Qualified Individual, risk assessment, IRP) + put it on the roadmap as a *legal floor*, not SOC 2 | Federally mandatory for any tax preparer, attested at PTIN renewal | 1–2 wks |
| P0-4 | **Auth + TLS** — gate the whole `/api` behind even a shared-secret bearer / Cloudflare Access; terminate TLS via ALB+ACM or nginx+certbot | No real client data can touch an unauthenticated cleartext box | 1–2 wks |
| P0-5 | **Encrypt PII at rest** — field-encrypt SSN/TIN (pgcrypto/KMS envelope); move document blobs to S3 + SSE-KMS + signed URLs | Plaintext SSNs are a reportable-breach posture | 2–3 wks |
| P0-6 | **CI on GitHub Actions** running typecheck + `run-no-api` on every PR with merge protection, **plus a `tsconfig.tests.json` that *includes* the test files** | The runner already exits non-zero correctly; closes the "green-on-wrong-shape" hole and protects the Haven-bound engine | 1–2 days |
| P0-7 | **Fix the customer-facing docs and the TY2026 SSTB QBI band** — stop claiming TLS/encryption/read-only-creds that don't exist; collapse the two QBI tables into one source of truth | Deception exposure + a confirmed shipped wrong answer on the ICP | 1–2 days |

### P1 — The wedge (next 1–2 quarters)

| # | Item | Why | Effort |
|---|---|---|---|
| P1-1 | **DECIDE THE GAME (founder-level, 1 week):** standalone planning product *or* engine component for Haven | Everything else depends on it; you cannot be both while pricing/selling as standalone | 1 wk |
| P1-2 | **Make the engine delta the headline number** — for the 22 verified detectors, set `estSavings = whatIf.delta`, sort/score on it, add an "Engine-verified vs Estimate" provenance badge | Cheapest, highest-trust win; converts the biggest credibility liability into the differentiator | 1–2 wks |
| P1-3 | **A true multi-year Roth-conversion + distribution-sequencing optimizer** (bracket-fill sweep, RMD/IRMAA/SS-taxability aware) on the existing what-if harness | The *one* feature that moves TaxFlow from "scanner" to "advisory tool"; the headline of every premium competitor | ~1 qtr (first solver) |
| P1-4 | **Reserve the tenancy seam now** — nullable `firm_id` on all 13 tables + a firms/users stub | Turns the eventual Haven fusion from a data-migration project into an enforcement step | ~1 wk |
| P1-5 | **A return-level diagnostics engine** (critical/warning/informational: missing TIN/EIN, dependent-age vs CTC/EITC, unbalanced state return, clearable "ready to hand off" checklist) | The workflow CPAs actually run; without it the tool can't join the file-prep ritual | ~1 qtr |
| P1-6 | **Form 2210 / §6654 penalty + estimated-tax safe-harbor target** on the Calculator tab | High-frequency, low-effort, removes a daily reason to leave the app | 1–2 wks |
| P1-7 | **Per-field confidence scores + "review only low-confidence fields" filter**; expand extraction to 1098, consolidated/multi-page 1099, K-1, 1095-A, SSA-1099, W-2G; run a clean 100-doc live benchmark on paid quota | Turns 77.7% recall from a liability into a real time-saver; covers actual CPA intake | ~1 qtr |
| P1-8 | **A standalone client-facing planning report (PDF)** that does *not* require write-back, + a disclaimer/Circular-230 notice on every client-facing deliverable | Sidesteps the unsolved integration problem (this is how Holistiplan wins); closes the E&O gap | 2–3 wks |
| P1-9 | **Reset pricing** toward per-return ($50–150/return) or a Holistiplan-adjacent tier; **budget the annual catalog-refresh** with a named owner | $30k = Corvee ceiling with Holistiplan depth; the expiry cliff kills recurring revenue otherwise | 1 wk + ongoing |
| P1-10 | **Land ONE real, named CPA design partner on real clients** and publish an honest case study | A single real proof point is worth more than the entire 101-strategy catalog | 1 qtr |

### P2 — The differentiators that "revolutionize"

| # | Item | Why | Effort |
|---|---|---|---|
| P2-1 | **Live what-if scenario UI** a CPA drives in a client meeting (sliders for Roth amount / ISO exercise / S-corp split, real engine delta updating instantly) | Turns planning into a *closing* tool; no competitor combines live-scenario UI with no-LLM-in-the-math | 1 qtr |
| P2-2 | **A true entity-structure optimizer** (sole-prop vs S-corp vs partnership, reasonable comp + PTET + §199A) with deterministic IRC-cited math | Directly contests Corvee/Instead's $15–30k wedge | multi-qtr |
| P2-3 | **Ongoing/quarterly monitoring + proactive planning-trigger alerts** when client facts cross a NIIT/IRMAA/§199A threshold | Converts one-time planning into recurring advisory revenue — the true Pro-tier justification | 1 qtr |
| P2-4 | **State "modifications" layer** (muni-bond add-back, US-obligation subtraction, configurable retirement/SS exclusions) | Makes 40+ approximated states signable | multi-qtr |
| P2-5 | **Productize the verified engine + IRC-citation trail as a SOC-2-grade "auditable tax-math API"** the AI-natives could license | Sell the natives the one thing they're worst at — provably-correct cited math; a higher-margin, more-defensible business than competing on overlay UX | multi-qtr |
| P2-6 | **Active-learning loop** — capture CPA edits in the review modal as labels to measure live recall and auto-tune the 74 heuristic multipliers toward observed engine deltas | A self-calibrating accuracy flywheel; shrinks the verified/unverified gap automatically | 1 qtr |
| P2-7 | **Real source-data round-trip** (SurePrep/SDE-grade W-2/1099/K-1/1098 into the CPA's actual software) — *only after* validating CPAs need it | The overlay promise made real; but validate the need before investing multi-quarter | multi-qtr |

---

## 8. The north star

**The single biggest bet that makes this category-defining is to become "the deterministic, auditable, IRC-cited planning brain for CPA firms" — and to win it on a true multi-year optimizer, not a flag-list.** The hardest part already exists and is genuinely rare: a verified-pure engine plus a what-if harness where the LLM provably never touches a number. That is a trust substrate every venture-funded AI-native lacks and that malpractice-averse CPAs viscerally want. The bet is to stop trying to be a generic "overlay that does extraction + prep + planning" (a feature the incumbents already own on both halves) and instead make the deterministic planning engine so deep — real Roth/distribution/entity optimization with every dollar engine-verified and statute-cited — that it is *the* advisory tool a firm reaches for, sold either standalone or licensed into a funded platform that brings the trust layer. The agentic end-to-end AI *preparer* (the Black Ore / Juno / TaxGPT race) is the only thing that truly "revolutionizes" tax prep, but it is a $50M+ contest you cannot win solo; the defensible move is to own the *calculation and planning truth* underneath it and let someone else fund the UX war.

**The one thing to do on Monday:** rotate the two leaked production credentials and take the §7216/PII exposure off the table — then *stop all outreach* until the P0 legal-and-security gate is closed. You are one real-client upload away from making your own first design partner a federal lawbreaker, and the gap between your (accurate) engineering docs and your (false) sales docs is a self-inflicted credibility bomb that will detonate the instant a real CPA probes it. Fix that, wire CI, ship the optimizer — and you have a real company instead of a brilliant library on a wide-open box.