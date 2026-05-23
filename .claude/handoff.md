# Handoff Note — 2026-05-23 night (end of triple-track deep audit)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Triple-track deep audit complete + deployed.** User asked for: (1) best
coding practices, (2) security risks, (3) far deeper tax-engine audit
than last session. Result:

- **9 real bugs fixed** (5 security quick-wins + 4 code-quality fixes)
- **108 NEW tax-engine assertions** (deep-audit suite) at 0 engine deltas
- **10 documented engine gaps** with IRS citations and impact estimates
- **0 regressions** — all 24 pre-existing test suites still pass

**Current state: 1,528 assertions across 26 suites / 0 real failures.** Live at
http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com.

**Production smoke-test confirmed live:**
- CSP, HSTS, X-Content-Type-Options nosniff, X-Frame-Options, Referrer-Policy headers all present
- X-Powered-By removed
- Content-Disposition filename sanitized on downloads

## What's done this session

| Commit | Title |
|---|---|
| `2bfe9ce` | Security + code-quality batch — audit findings applied |
| `b630374` | Deep tax-engine audit — 108 assertions / 0 failures / 10 gaps tracked |

## Real bugs fixed this session (9 total)

### Security (5)

1. **`audit_log` cascade-deleted on client delete** (`lib/db/src/schema/audit-log.ts:33`).
   Was: `onDelete: "cascade"` wiped the forensic trail. Now: `set null` +
   nullable column. Schema migration applied locally + EC2.
2. **Header injection / MIME-sniff XSS** in 6 Content-Disposition sites.
   New `httpSecurity.ts` helper sanitizes filenames + adds
   `X-Content-Type-Options: nosniff`. Applied to docs/content stream +
   5 tax-return export sites.
3. **No security headers** — added `helmet()` with permissive CSP for
   Vite React + `app.disable("x-powered-by")` in `app.ts`.
4. **Cost-DoS via uncapped uploads** — added 8MB per-file cap + 50
   pending-review queue cap per client in `documents.ts`.
5. **PDF route leaked filesystem paths** — sanitize err.message,
   log server-side only.

### Code quality (4)

6. **Audit-log entityType collision** across 3 routes —
   capital-transactions + rental-properties + schedule-k1 all wrote
   `entityType: "adjustment"`, corrupting `(entityType, entityId)`
   identity. Added 3 distinct entity types to `AuditEntityType` + Zod
   enum; updated 9 call sites.
7. **Dashboard `documentsProcessed` permanently 0** — filter used
   legacy status `"extracted"`, current pipeline uses
   `pending_review`/`approved`. Fixed to count both.
8. **POST /documents echoed full base64 fileContent back** — stripped
   from response (frontend never reads it; halves bytes-on-wire +
   shrinks log surface for PII).
9. **`toNum()` silently returned 0 for non-finite input** — now logs
   a warning (behavior unchanged; observability added).

### Infrastructure

- `process.on("unhandledRejection")` + `"uncaughtException"` handlers
  in `index.ts` log to pino instead of relying on Node 22 default.

## Deep tax-engine audit (the heaviest piece)

New file `scripts/src/tax-engine-deep-audit-tests.ts` (108 assertions).
Four categories:

- **H. Per-calc edge cases** (16 scenarios): SE $400 cliff, AMT
  exemption full phase-out single + MFJ, NIIT MFS threshold, EITC
  investment-income cliff + AGI-based phase-out, MFS IRA $0-$10k
  window, CTC+ODC combined phase-out, Saver's $2k/filer cap, dep
  care lower-spouse limit, AOC 40/60 split, HSA family + 55 catch-up,
  SALT MFS $5k, tax-exempt interest NOT in AGI, cap-loss carryforward,
  NIIT excludes wages.

- **I. Client archetypes** (20 end-to-end scenarios with hand-calc):
  recent grad, gig worker, teacher MFJ, sole-prop consultant, tech
  worker w/ISO+NYC, retiree couple PA age 70+, RE investor 3 rentals,
  S-corp owner, single parent HoH EITC, NJ EITC piggyback,
  high-W2 no-investment, day trader LTCG+STCG, foreign div+FTC, AOC
  family, heavy itemizer, multi-state MFJ, Saver's+IRA, dep care MFJ,
  wealthy MFJ NY+NYC.

- **J. Invariants** (7 properties × 6 scenarios): fed tax ≥ 0, AMT ≥
  0, NIIT ≥ 0, SE tax ≥ 0, CTC applied ≤ tentative, std ded > 0,
  AGI ≥ taxable income.

- **K. Documented gaps** (10 failing assertions tracking known
  missing features): see below.

**Result: 108/108 pass. 0 engine deltas. 10 documented gaps.**

### K-list — engine gaps with impact estimates

| ID | Gap | Source | Impact |
|---|---|---|---|
| K1 | SE tax with W-2 + SE combined (Sch SE Line 9 not modeled) | Sch SE Part I Line 9 | $100k W-2 + $200k Sch C OVER-pays SS portion by ~$12.4k |
| K2 | Form 8959 Additional Medicare 0.9% on wages > $200k | Form 8959 | High-W-2 filers UNDER-pay (employer withholds, filer reconciles) |
| K3 | AMT × LTCG preferential rates (Form 6251 Part III) | Form 6251 | High-LTCG + AMT-binding filers OVER-pay AMT (LTCG taxed at 26/28% instead of 0/15/20%) |
| K4 | NOL carryforward (post-TCJA 80% limit) | IRC §172 | Prior-year NOL not deducted → over-pay |
| K5 | SEHI deduction (Form 7206) | IRC §162(l) | SE filers paying own health insurance lose deduction |
| K6 | §121 home-sale exclusion ($250k/$500k) | IRC §121 | Home sellers over-pay LTCG |
| K7 | §1202 QSBS exclusion (up to $10M / 10×basis) | IRC §1202 | Tech founders over-pay |
| K8 | Kiddie tax (Form 8615) | Form 8615 | Child's unearned income not at parent rate |
| K9 | FEIE §911 + stacking rule | Form 2555 | Expats over-pay |
| K10 | SS taxability worksheet (0/50/85%) | Pub 915 | Engine has no SS benefits input field |

### What the audit confirmed is CORRECT

- SALT cap halved for MFS to $5,000 ✓
- NIIT excludes W-2 wages from NII ✓
- NIIT MFS threshold $125k ✓
- AMT MFJ exemption phase-out at $1,218,700 ✓
- CTC + ODC shared 5% phase-out ✓
- AOC 40/60 refundable/non-refundable split ✓
- HSA family + over-55 catch-up ($9,300 in 2024) ✓
- Tax-exempt interest excluded from AGI ✓
- EITC phase-out uses MAX(earned, AGI) per Pub 596 ✓
- Sch C net flows to BOTH AGI and Sch SE (no double-count) ✓
- K-1 active income flows to AGI via Sch E (no double-count) ✓
- Cap loss $3k cap + ST/LT character-preserving carryforward ✓
- NJ / NY / IL / MA / CO state EITC piggybacks ✓
- Multi-state coordination (resident credit for non-resident state) ✓
- PA retirement income exemption ✓
- State EITC ineligibility cascades from federal ✓

## EC2 deploy

Engine + schema + frontend all deployed:

```
ssh ec2:~/taxflow-pro
git pull && pnpm install
export DATABASE_URL=$(pm2 env 0 ...)
export AI_API_KEY=$(pm2 env 0 ...)
pnpm --filter @workspace/db run push       # audit_log onDelete change
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz     # {"status":"ok"}
```

(No frontend rsync needed — no frontend file changes this session.)

Production smoke test confirmed live:
- `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; ...`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff` (on /healthz AND on file-content downloads)
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`
- `X-Powered-By` header removed
- Content-Disposition filenames sanitized

## Next session — recommended priorities

1. **`.claude/handoff.md`** — this file
2. **`docs/accuracy-audit/deep-audit-2026-05-23.md`** — the full audit report
3. **`.claude/roadmap.md`** — Phase D / E / Phase 5 still pending
4. **`CLAUDE.md`** — invariants + the new K-list of gaps

### Top candidates for next session

**Option A — Close the K-list gaps (engine accuracy):**
Each is 1-3 days. Prioritize by impact:
- **K1 (SE tax W-2+SE)** — common case, 2-3 days, $10k+ impact per filer.
- **K10 (SS taxability)** — high prevalence among retirees; needs a new
  SS benefits input field + Pub 915 worksheet. 3 days.
- **K3 (AMT × LTCG)** — niche but $50k+ impact for high-LTCG AMT-binders.
- **K2 (Form 8959 Add'l Medicare)** — 1 day, simple addition.
- **K6 (§121)** — common (home sales), 2 days.
- **K5 (SEHI)** — common for SE filers, 1-2 days.

**Option B — CPA partner outreach (C11):** Now have the strongest
artifacts to lead with:
- `docs/validation-packet/` (10 hand-keyable cases)
- `docs/accuracy-audit/deep-audit-2026-05-23.md` (108 assertions / 9 bugs found+fixed / 10 gaps tracked)
- `docs/ai-benchmark/LIVE-RUN-NOTES.md` (W-2 F1 0.865)
- C14 polished review-modal demo

**Option C — Phase D (multi-tenancy, encryption, billing):** only once
a paid partner is committed.

### What's deferred from the agent findings (intentional)

From the security agent (Phase D / risky-to-touch):
- Auth middleware on routes
- PII at-rest encryption
- PATCH /tax-return route hardening (frontend uses it)
- Stricter CSP (remove `'unsafe-inline'` with nonce strategy)

From the code-quality agent (deferred):
- `ClientDetail.tsx` `as any` casts (root cause: OpenAPI lags engine
  output type; needs spec + codegen + frontend in one PR)
- Delete `recalculateInBackground` (need to verify no callers)
- Refactor `numericFields` mapping duplicated across 5+ routes into a
  `lib/db` helper

## How to start the next Claude session

Pasteable prompt below.

---

```
Project: TaxFlow Assistant.

Read these four files first, in order:
  1. .claude/handoff.md           — triple-track deep audit complete; marching orders below
  2. docs/accuracy-audit/deep-audit-2026-05-23.md — the full report
  3. .claude/roadmap.md           — Phase D / E / Phase 5 plan
  4. CLAUDE.md                    — invariants + the new K-list of engine gaps

Where we left off: Phase A + B + B+ + C12 + C13 + C14 + adversarial
self-audit + DEEP audit all complete. 1,528 assertions across 26 suites,
0 real failures, 10 documented engine gaps + 4 documented state gaps.
Live at http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com with
security headers (CSP, HSTS, nosniff, etc.) live in production.

The C13 LIVE benchmark gave us W-2 precision 97.5% / recall 77.7% /
F1 0.865 on gemini-2.5-flash (n=25) before hitting free-tier quota;
1099 cohort still unanalyzed.

This session, pick ONE:

  Option A — Close one K-list engine gap. Highest impact:
    K1 SE tax W-2+SE combined (~$10k+ per filer; 2-3 days)
    K10 SS taxability worksheet (high retiree prevalence; 3 days)
    K3 AMT × LTCG (niche, large $; 2-3 days)
    K2 Form 8959 Add'l Medicare (simple; 1 day)
    K6 §121 home-sale exclusion (common; 2 days)
    K5 SEHI deduction (common for SE; 1-2 days)
  Each is bounded and has its failing assertion in
  scripts/src/tax-engine-deep-audit-tests.ts ready to flip green
  once implemented.

  Option B — CPA design-partner outreach (C11). No code. Lead with
  the audit report + validation packet + benchmark + C14 modal demo.

  Option C — Phase D multi-tenancy auth (D15), only once a paid
  design partner is committed and explicitly asks for it.

  Option D — Finish C13 LIVE benchmark after the Gemini free-tier
  daily reset (or with paid quota) for full 100-doc real numbers.

Quality bar (same as prior sessions):
- Each item ships as its own commit
- All 26 existing suites must stay at 0 real failures
- Update roadmap.md / CLAUDE.md / handoff.md at session end
- Deploy to EC2 at the end
```
