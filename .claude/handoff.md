# Handoff Note — 2026-06-02 (OBBBA: planning catalog v1.19.0 + CORE engine conformance)

Session continuation point for the next Claude (or human) on TaxFlow Assistant.

## ⚡ Read this first

Durable TODO: **`docs/todo.md`** (CURRENT FOCUS). Coverage map:
**`docs/coverage-matrix.md`**. Per-strategy planning source of truth:
**`docs/planning-strategy-audit.md`** (OBBBA section — Tier 1–4 APPLIED + core
conformance section). Branch: **`main`** (8 commits this session, all pushed;
api-server deployed to EC2).

## Headline (latest — core OBBBA conformance)

After the planning-catalog refresh (below), completed **all remaining CORE
`computeTaxReturnPure` OBBBA conformance** (commits `80928c3` + `f22c9c1`):
**SALT** $40k cap + §164(b)(7) >$500k phase-down (`getSaltCap`); **§199A** TY2026
thresholds + widened phase-in + the new **$400 minimum QBI deduction** + MFS-threshold
bug fix; **native TY2026** support (`SUPPORTED_TAX_YEARS` + 2026 added to all 20
year-indexed maps + `stateTaxData`, incl. the OBBBA AMT **50% exemption phase-out**);
and the **structural** changes that were also pre-OBBBA-stale for TY2025 — **CTC
$2,200**, **§179 $2.5M/$4M**, **bonus depreciation 100%** (TY2026). Every TY2026
value primary-source-verified (3 background research agents off Rev. Proc. 2025-32 /
Notice 2025-67 / HHS FPL PDFs). **39 no-API suites / 3,303 assertions / 0 failures;
clean typecheck; complex TY2026 return smoke-tested.** Remaining OBBBA gaps are
genuinely out of core-engine scope (see "What's left").

## 🔴 USER ACTION STILL PENDING (from the 2026-05-28 session)

Rotate the two leaked production credentials (Neon `neondb_owner` password +
Google Gemini API key). Only you can rotate them in the Neon console + Google AI
Studio.

## Headline

Completed the **planning catalog Tier-2/3/4 OBBBA refresh** (the #9 follow-up).
Every TY2025/2026 dollar value was **independently re-verified against the primary
IRS source** (3 research sub-agents + a targeted web search; no guessing) before
encoding, and every test expectation is hand-calc'd. One scope decision was put to
the user (the std-ded — see below) and they chose to also fix the core. **39 no-API
suites / 3,287 assertions / 0 failures; clean typecheck.** api-server deployed to
EC2 + verified live.

### What landed (6 commits on `main`, all pushed)

1. **`55c1182` fix(engine): TY2025 std-ded → OBBBA** — core `FEDERAL_STANDARD_DEDUCTIONS[2025]`
   corrected $15,000/$30,000/$22,500 → **$15,750/$31,500/$23,625** (the bunching
   detectors consume it). Re-hand-calc'd 11 affected TY2025 assertions across 5
   suites (std-ded, blind, a $100k fed-tax case, G4.3 bunching estSavings).
2. **`edadfbc` feat(planning): Tier-2 dollar bumps** — TY2026 year-map entries:
   SEP/§415(c) **$72k**, §402(g) **$24.5k**, HSA **$4,400/$8,750**, QCD **$111k**,
   §401(a)(17) **$360k**; adoption year-indexed ($17,280/$17,670) + MAGI phase-out +
   **OBBBA refundable ($5,000/$5,120 — detector no longer caps below the refundable
   floor)**; §448(c) catalog text. +18 TY2026 lock-ins.
3. **`ae60109` feat(planning): §199A** — QBI_THRESHOLDS TY2026 **$201,750/$403,500**
   + widened phase-in **$75k/$150k**; G1.88/G1.89 refactored off TY2024-hard-codes to
   the year-indexed map; **$400 min-deduction note**; G1.7/G1.88/G1.89 validUntil →
   **2099 (PERMANENT)**. +4 PLAN-08 permanence lock-ins.
4. **`2ca787d` feat(planning): Tier-3 PTET** — new `obbbaSaltCap()` (year-indexed +
   MAGI phase-down); detector fires off `saltUncapped` vs the OBBBA cap (**$40k**,
   phasing to a **$10k floor** above $500k MAGI) — recoded §164(b)(6)+(7). G1.85
   mortgage permanence already documented; estate strategies carry no stale urgency.
   +5 lock-ins.
5. **`fc3bf11` feat(planning): Tier-4 — 4 NEW deductions G1.97–G1.100** — tips §224
   ($25k), overtime §225 ($12.5k/$25k), car-loan §163(h)(4) ($10k, $200/$1k DOUBLE
   phase-out), senior $6k/65+ (6% phase-out). validUntil 2028. Catalog v1.18→**v1.19.0**
   (now **101 strategies**). +26 lock-ins (caps, both phase-out rates, negatives).
6. **`<docs>` docs** — planning-strategy-audit (Tier 1–4 APPLIED table + caveats),
   coverage-matrix, todo, CLAUDE.md, this handoff.

### Key decisions / gotchas confirmed this session

- **TY2026 engine clamp:** `computeTaxReturnPure` clamps tax MATH **and** its output
  `taxYear` to the latest supported year (2025) — there is NO native TY2026 bracket/
  std-ded set, and `SUPPORTED_TAX_YEARS = [2024, 2025]`. So the planning detectors'
  TY2026 dollar maps are **forward-staged**: reached only when the planning layer is
  handed `taxYear=2026` (the lock-in tests stamp `{...computed, taxYear: 2026}`, the
  same pattern the #9 energy test uses). In production today a TY2026 client's planning
  runs on the (verified-correct) TY2025 values.
- **Core engine intentionally NOT touched beyond the TY2025 std-ded** (user's scope
  call): the federal SALT cap is still $10k (PTET works around it off `saltUncapped`);
  core §199A SSTB thresholds + the $400 min QBI deduction not applied; the 4 new
  deductions are planning-only. All tracked in `docs/planning-strategy-audit.md`
  ("Discovered core-engine follow-ups") + `coverage-matrix.md` + CLAUDE.md limitations.
- `adjustment_type` is FREE-FORM text; the core engine **ignores** unknown markers
  (verified: a `qualified_tips` adjustment leaves AGI unchanged — no double-count,
  since tips are already in W-2 wages). The tips/overtime/car-loan markers therefore
  need an openapi-enum + ClientForm UI to be CPA-enterable in prod.
- Catalog (`strategies-v1.json`) is imported directly + `validateCatalog` runs on
  import (a green planning endpoint = valid catalog). `category` must be one of the 7
  `StrategyCategory` enum values — the 4 new deductions use `credits`.

### Verification

- `pnpm run typecheck` — clean (full workspace).
- `pnpm --filter @workspace/scripts run test:no-api` — **39 suites, 3,287
  assertions, 0 failures** (baseline at session start: 3,234). Planning suite 474→527.
- Live EC2 after deploy: `GET /api/healthz` ok; planning endpoint returns catalog
  v1.19.0 hits. (See deploy section.)

## Deploy — api-server only (no schema change, no frontend change)

This refresh touched only `planningEngine.ts` + `strategies-v1.json` + tests — **no
DB ALTER, no openapi/codegen, no frontend rebuild** needed. Standard api-server cycle:

```bash
ssh -i ~/Downloads/taxflow-key.pem ubuntu@ec2-18-188-192-154.us-east-2.compute.amazonaws.com
cd ~/taxflow-pro
git checkout -- pnpm-lock.yaml
git pull origin main
pnpm install
export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')
export AI_API_KEY=$(pm2 env 0 | awk -F": " '/^AI_API_KEY:/ {print $2; exit}')
pnpm --filter @workspace/api-server run build
pm2 restart taxflow
curl http://localhost:8080/api/healthz
```

(The frontend renders catalog text it fetches from the API, so no rebuild is needed
to surface the refreshed strategy descriptions; rebuild+rsync only if you later wire
the tips/overtime/car-loan ClientForm fields.)

## What's left — prioritized (next session)

Core OBBBA conformance is DONE (this session). Remaining:

1. **Model the 4 new OBBBA deductions as REAL engine adjustments** (currently
   planning-only, G1.97–G1.100): add `qualified_tips` / `qualified_overtime` /
   `qualified_car_loan_interest` to the openapi enum + codegen + ClientForm fields,
   then apply them as above-the-line deductions in `computeTaxReturnPure` (with the
   MAGI phase-outs + caps the planning detectors already encode) and H2-wire the
   detectors to engine-verified deltas. G1.100 senior ($6k, age-based + 6% phase-out)
   could also be modeled in the core. Each needs hand-calc'd tests.
2. **Bonus-depreciation TY2025 dual-rate** — the engine keeps the conservative 40%
   default for TY2025 (OBBBA restored 100% for property acquired after 2025-01-19, but
   there's no acquisition-date field). Add an acquisition-date or a per-asset
   `bonus_rate_override` if a customer needs precise early-2025 modeling.
3. **Remaining niche tax-calc sub-gaps** (`coverage-matrix.md` §4): MD per-dependent
   (needs MD state tax modeled first); exact NY IT-203 / CA 540NR per-line sourcing;
   K-1 per-business (Form 8995-A) wage/UBIA; wash leftover-share re-flow. Also: state
   2026 brackets are held at 2025 (most states unpublished) — refresh when available.
4. **H3 multi-year wiring (#8)** — still deferred (needs a defensible RMD/installment model).
5. **Haven fusion prep** — keep `computeTaxReturnPure` pure/portable. D15 auth POSTPONED.

D15 (auth + multi-tenancy) is POSTPONED to the Haven fusion — the EC2 box stays a
demo with no real PII.

## How to start the next Claude session

```
Project: TaxFlow Assistant (CPA tax-prep + planning; portable engine
computeTaxReturnPure fuses into "Haven", which brings its own auth/tenancy — so
D15 auth is POSTPONED, don't build it).

Read first: .claude/handoff.md, CLAUDE.md, docs/todo.md (CURRENT FOCUS),
docs/coverage-matrix.md, docs/planning-strategy-audit.md (OBBBA section).

Where we left off (2026-06-02): shipped the planning catalog v1.19.0 OBBBA refresh
(101 strategies; TY2026 values, §199A permanence, PTET §164(b)(7) $40k, 4 NEW
deductions G1.97-G1.100) AND completed ALL core-engine OBBBA conformance: SALT $40k
+ §164(b)(7) phase-down, §199A TY2026 thresholds + $400 min QBI deduction + MFS-fix,
native TY2026 support (SUPPORTED_TAX_YEARS + all 20 year-maps + AMT 50% phase-out),
CTC $2,200, §179 $2.5M, bonus 100% TY2026. 39 no-API suites / 3,303 assertions green;
api-server deployed + live-verified. Every TY2026 value primary-source-verified.

Recommended next task: **model the 4 new OBBBA deductions (tips/overtime/car-loan/
senior) as REAL computeTaxReturnPure adjustments** — they're planning-only today
(G1.97-G1.100). Add `qualified_tips`/`qualified_overtime`/`qualified_car_loan_interest`
to the openapi enum + codegen + ClientForm UI, apply them as above-the-line deductions
in the engine with the MAGI phase-outs/caps the planning detectors already encode, and
H2-wire the detectors. Hand-calc every value vs the IRS rule (§224/§225/§163(h)(4) +
the §151(d) senior add-on), commit per chunk, push to main, deploy + verify live. Keep
computeTaxReturnPure pure. (Other options in handoff "What's left": bonus-depr TY2025
dual-rate; niche state/K-1 sub-gaps; H3 multi-year.)
```
