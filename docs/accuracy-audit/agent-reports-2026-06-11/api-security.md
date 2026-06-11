# API surface + security audit — TaxFlow Assistant

Scope: `artifacts/api-server/src/{app.ts,index.ts,middlewares/,routes/ (19),lib/httpSecurity.ts,
consentGate.ts,fieldCrypto.ts,auditLog.ts,config.ts,logger.ts}` + `lib/api-zod` usage + the
LLM/CSV/extractor seams those routes call. Read-only. Date 2026-06-11.

Live verification: localhost:8080 (demo mode — `API_AUTH_TOKEN`/`PII_ENCRYPTION_KEY` unset,
`NODE_ENV` non-prod, synthetic data). Behaviors below are reasoned for BOTH demo and
controls-enabled postures.

Bottom line: **no CRITICAL findings.** The core controls (auth gate, §7216 consent fail-closed,
field crypto, child-record scoping, SQL parameterization, transactions, prototype-pollution guard)
are implemented correctly. One HIGH PII-at-rest gap (must close before real PII) + a handful of
MEDIUM hardening gaps (rate-limit XFF spoof, unbounded what-if array, missing no-store on PII JSON).

---

## HIGH

### H1 — AI-extracted SSN/TIN persisted + echoed in PLAINTEXT (documents list), uncovered by field crypto
`routes/documents.ts:66-81` (list projection includes `extractedText`), `:214-230` (writes the
extraction payload), `lib/documentExtractor.ts` (extractor returns `employeeSSN`/`payerTin`/`recipientTin`).

The W-2 extractor (`ExtractedW2Data.employeeSSN`) and the 1099/info extractors
(`payerTin`/`recipientTin`) return the taxpayer SSN/TIN. On extraction success the handler stores
`extractedText = JSON.stringify({ text, data: extractedData, boxes, confidence })` into
`tax_documents.extractedText` — **in cleartext, never run through `fieldCrypto`** (only the
`w2_data.employee_ssn` / `form_1099_data.payer_tin` / `recipient_tin` columns are encrypted). The
list endpoint `GET /clients/:clientId/documents` then projects `extractedText` back to the caller,
with **no `Cache-Control: no-store`**.

Consequence in a real-PII deployment (`PII_ENCRYPTION_KEY` set): the SSN/TIN sit in plaintext at
rest in `tax_documents.extractedText` (and the raw doc in `file_content`) — exactly the surface
the field crypto was meant to remove — and are returned in cleartext in every documents-list
response (cacheable). `CLAUDE.md` already flags the `file_content` blob as the documented P0-5
PARTIAL gap; this adds the concrete **list-endpoint echo of the extracted SSN** as a second leak
path on the same uncovered data.

Not exploitable in demo (synthetic data; with the dummy AI key extraction fails → no payload, and
`GET /documents` returned `[]` for the seeded client). Becomes a real PII-at-rest + over-the-wire
leak the moment real documents are uploaded with the key set — i.e. on the critical path the P0
gate must close first.

Fix: encrypt the SSN/TIN inside the extraction payload (or strip them from `extractedText` and keep
only non-PII boxes/confidence), drop `extractedText` from the list projection (it's only needed by
the review screen via a per-doc fetch), and migrate `tax_documents.file_content` to S3+KMS (Runbook B).

---

## MEDIUM

### M1 — `trust proxy: 1` → X-Forwarded-For spoofing defeats the per-IP rate limiter
`app.ts:17` (`app.set("trust proxy", 1)`) + `:120-129` (per-IP `express-rate-limit`).

The deploy (per `CLAUDE.md`: api-server serves directly on EC2, "no nginx") is **directly
internet-exposed with no proxy in front**. With `trust proxy: 1`, Express derives `req.ip` from the
client-supplied `X-Forwarded-For` header (it trusts one hop and takes the rightmost untrusted
entry). An attacker sends `X-Forwarded-For: <random>` per request → `req.ip` rotates → the
200-req/min/IP limiter never trips. That re-opens the unauthenticated cost/queue DoS the upload caps
(8 MB/doc, 50 pending/client) + limiter were built to bound (extraction → Gemini = real $ per call).

The setting is only correct once **exactly one trusted proxy** (CloudFront/ALB) actually fronts the
box. For the current direct topology it should be `trust proxy: false` (use the socket IP) or pinned
to the real proxy subnet, or the limiter should use a `keyGenerator` that doesn't trust XFF.
Severity is MEDIUM (DoS control, not data exposure).

### M2 — Unbounded `what-if` mutations array → per-request CPU/memory DoS
`lib/api-zod/.../api.ts:2807` (`mutations: zod.array(...)` — **no `.max()`**; inner `adjustmentType`
/`field` `zod.string()` with no `.max()`, `amount` `zod.number()` with no `.finite()`), consumed by
`routes/planning.ts:867-904` (`coerceWhatIfMutations`) → `lib/whatIfEngine.ts:108-184`
(`applyWhatIfMutations`).

A single `POST /clients/:id/what-if` can carry ~100k+ mutations (only bounded by the 20 MB body
limit). `set_adjustment` / `remove_adjustment` each rebuild the adjustments array via
`adjustments.filter(...)`, so N such mutations is **O(N²)** before the (single) engine run — seconds
of CPU per request, amplified by M1's defeated limiter. Verified live: a 50-element mutations array
is accepted (200) with no length validation. (Totality holds — `amount: 1e15` returned 200 with no
NaN/Infinity escaping; the engine's ±1e13 clamp absorbs it — so this is a CPU/DoS issue, not a
correctness one.)

Fix: `.max(100)` (or similar) on the array, `.max()` on the `adjustmentType`/`field` strings, and
`.finite()` on `amount`; mirror the cap in `coerceWhatIfMutations`.

### M3 — Decrypted SSN/TIN returned by JSON endpoints without `Cache-Control: no-store`
`routes/w2data.ts:72-97` + `:120-131` + `:169-180` (GET/POST/PATCH return `employeeSSN:
decryptField(...)`), `routes/tax-returns.ts:432-442` (diagnostics decrypts), 1099 list likewise.

The `/documents/:id/content` stream correctly sets `Cache-Control: no-store` (documents.ts:283), but
the W-2 (and 1099) JSON CRUD responses return the **decrypted cleartext SSN/TIN with no cache
directive**. In a real-PII deployment these responses carry the live SSN and can be written to
intermediary/shared-machine proxy caches. Add `Cache-Control: no-store` (and `Pragma: no-cache`) to
every response that returns decrypted PII. (At-rest these columns *are* encrypted when the key is
set — this is purely the over-the-wire/cache surface, hence MEDIUM not HIGH.)

---

## LOW

### L1 — `disclosure-consents` POST: unbounded `durationDays`, unvalidated fields (no zod)
`routes/disclosure-consents.ts:28-65`. Body is hand-parsed (not the generated zod). `durationDays`
is only floored at `>0` with **no upper bound** → a §7216 consent can be recorded with an
effectively unbounded (multi-century) expiry, or a huge value overflows `new Date(... * DAY_MS)` to
Invalid Date (→ insert error/500). `scope` / `signerName` / `signatureRef` are accepted as arbitrary
strings with no length cap. Add a sane max (e.g. ≤ 2 years) + length caps; prefer a zod body.

### L2 — Prototype-pollution attempt returns 500 instead of 400 (guard still holds)
`lib/whatIfEngine.ts:160-166` blocks `field ∈ {__proto__, constructor, prototype}` — verified live:
`field=__proto__` did NOT pollute `Object.prototype` (settings stayed clean). But the check lives in
`applyWhatIfMutations` (engine), not in the route's `coerceWhatIfMutations`, so it throws past the
per-kind validation and surfaces as **HTTP 500** (verified). The security control is fine; move the
key check into the route coercion for a clean 400 and to avoid logging it as an unhandled engine error.

### L3 — pino `redact` doesn't cover nested error objects (AI-key-in-logs defense-in-depth)
`lib/logger.ts:7-11` redacts `req/res` auth/cookie headers but not `err.config.headers.authorization`
/ `err.response.*`. Route catches log `{ err }` for failed LLM calls. The OpenAI SDK normally does
NOT embed the request auth header in error objects, so risk is low — but add `*.authorization` /
`*.headers.authorization` redact paths (or an error serializer) for defense in depth, since the AI
key is the live secret on these paths.

### L4 — CORS `credentials: true` always set; `CORS_ALLOW_ALL=true` reflects any origin WITH credentials
`app.ts:98-115`. Default posture is secure (origin locked unless an explicit `ALLOWED_ORIGINS`
allowlist is configured), so no live finding. But `credentials: true` is unconditional, so the
`CORS_ALLOW_ALL=true` dev opt-in produces the classic dangerous "reflect-any-origin + credentials"
combo. Document loudly that `CORS_ALLOW_ALL` must never be set on any internet-reachable host (the
code comment says "local dev only" — make it an enforced/asserted invariant).

### L5 — TXT/`.gen` and JSON exports don't neutralize CSV-formula-leading client names
`lib/taxReturnExports.ts`. The CSV export correctly neutralizes formula-leading cells
(`csvEscape`, OWASP defense — verified). The TXT (`buildTaxReturnSummaryText`,
`CLIENT_FIRST_NAME=${client.firstName}`) and JSON exports do not. Not a spreadsheet-import vector for
`.txt`/`.json`, so informational — but a CPA who opens the historical `.gen`/`.txt` in Excel could
execute a `=`-leading client name. Apply the same neutralization for consistency.

---

## Reviewed CLEAN (verified)

- **Auth gate (1):** `requireApiAuth` mounted ONCE at the top of the `/api` router
  (`routes/index.ts:24-27`) AFTER `healthRouter` and BEFORE every data router. No data route mounts
  before it. `verifyBearer` uses `timingSafeEqual` with a length pre-check (length is not the
  secret); token captured at module load; 401 + stable `AUTH_REQUIRED` code; `/healthz` exempt.
  Live: demo is open (200 with no token AND with a wrong token), as designed.
- **§7216 consent (2):** `consentRequired()` defaults ON when `NODE_ENV=production` (keyed on
  NODE_ENV, not the bearer token — correct for the edge-auth posture); fail-closed. Enforced at
  upload (`documents.ts:134`) AND at the transmission point inside the extraction IIFE (`:173`) AND
  on every client-specific LLM endpoint — planning-memo/email/missing-data/discovery/return-qa via
  `aiDisclosureBlocked` (`planning.ts:311`, returnQa `forceDeterministic`). The `planning-campaigns`
  email-draft is the one LLM call NOT consent-gated, by design: it discloses ONLY catalog text +
  anonymous $100-rounded firm-cohort stats (no client identity/per-client figure) and re-sanitizes
  server-side (`planningCampaigns.ts`, `planning.ts:1135-1147`) — not a taxpayer disclosure. The
  consent DB lookup itself fails closed on any error (`consentGate.ts:74-80`).
- **Pro-tier gate (3):** scoped pathless `router.use` INSIDE `planningRouter`
  (`planning.ts:128-139`), so it cannot leak to other routers; `cpaToolsRouter` is mounted BEFORE
  `planningRouter` (`index.ts:43-49`) so prep-workflow endpoints are correctly NOT gated. 402 +
  stable `PRO_TIER_REQUIRED`. No mount-order swallow bug.
- **fieldCrypto (11):** AES-256-GCM, per-value random 96-bit IV (`randomBytes`), auth-tag verified
  (`decipher.final()` throws on tamper), versioned `enc:v1:` prefix, idempotent double-encrypt guard
  (`isEncrypted`), refuses to persist the decrypt-failure sentinel (throws), 32-byte key validation,
  plaintext passthrough only when key unset (demo). Sound.
- **Child-record authZ (7):** w2data / form1099data / capital-transactions / documents /
  disclosure-consents all scope GET-by-id + PATCH/DELETE with `and(eq(<id>), eq(clientId))` — no
  cross-client object access via a mismatched `/clients/:clientId/.../:childId` path. (The
  single-tenant shared-token model — any authed caller can reach any client — is the documented D15
  multi-tenancy deferral, not a per-record bug.)
- **SQL injection (6):** all Drizzle `sql` fragments are parameterized; the keyset cursor timestamp
  is regex-shape-validated (`CURSOR_TS_RE`) AND parameterized (`clients.ts:42-101`);
  `upper(${clientsTable.state})` compared via `eq` to a parameter. No string concatenation into SQL.
- **Transactions/races (8):** document-approve, client-delete, w2-delete, roll-forward wrapped in
  `db.transaction`; tax_returns recalc is an atomic `onConflictDoUpdate` on (clientId, taxYear) —
  no SELECT-then-write race. roll-forward's 409 duplicate guard is best-effort (documented; a
  concurrent double-roll second-attempt 409s on retry).
- **Audit log (5):** `redactPii` masks SSN/TIN/EIN/account by key pattern, recursing into nested
  objects AND array elements, at WRITE time — so even demo-mode audit rows store
  `***-**-6789`, never the full number; append-only; client-scoped read. (W-2 SSN reaches
  `writeAudit` already ciphertext when the key is set.)
- **Content-type confusion (4/6):** `validateAndResolveMimeType` (documentExtractor.ts) checks magic
  bytes (PDF/PNG/JPEG/WEBP/text) and rejects a content/extension mismatch on visual types.
- **CSV injection (6):** neutralized in the CSV export (`csvEscape`, leading `=+-@\t\r` → `'`).
- **Download headers (6/10):** `safeFileName` strips path/meta chars + clamps to 100; `nosniff` on
  all downloads; `no-store` on the raw document-content stream.
- **DoS clamps (9):** monte-carlo (trials ≤ 5000, horizon ≤ 40, portfolio ≤ 1e13 — verified live:
  `horizonYears=99999` → 40), bracket-fill (horizon ≤ 40), roth-optimizer (horizon ≤ 75 via zod);
  upload 8 MB/doc + 20 MB body + 50 pending/client; campaigns/hit-list fan-outs are bounded top-N.
- **Engine totality:** arbitrary what-if `value`/huge `amount` don't crash or emit NaN/Infinity
  (±1e13 money clamp) — verified live (object value + `amount=1e15` both 200).
- **Headers/transport (10):** helmet CSP (documented `'unsafe-inline'` tradeoff for the Vite bundle),
  HSTS intentionally disabled for the HTTP-only box (documented re-enable path), `x-powered-by` off,
  CORS locked by default, global JSON error handler returns a generic 500 (no stack leaked).
- **Secrets (12):** no `.env` tracked except `.env.example`; no hardcoded keys in api-server src;
  AI key read from env only (`integrations-openai-ai-server/src/client.ts`), defaults to
  `"missing-key"` when unset.
- **DB schema:** the `clients` and `tax_returns` tables carry NO SSN/TIN column (only
  `social_security_benefits` = a dollar amount), so the client/return audit + JSON responses don't
  leak an SSN.
