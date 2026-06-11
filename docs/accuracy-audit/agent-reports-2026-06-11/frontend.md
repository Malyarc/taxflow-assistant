# Frontend Audit — TaxFlow Assistant (`artifacts/tax-app/src/` + `lib/api-client-react/`)

Auditor: fresh independent pass, 2026-06-11. READ-ONLY. Build verified clean
(`pnpm --filter @workspace/tax-app run build` → ✓ built in 6.82s, no errors).

Severity rubric: CRITICAL = wrong dollar value/sign visible · HIGH = broken flow / data
loss in a form · MEDIUM = crash/edge/stale-data window · LOW = cosmetic/a11y/staleness.

---

## HIGH

### FE-A1 — ClientForm: editing the Email field permanently replaces the form with skeletons (formReady gate misfires)
- **File:** `artifacts/tax-app/src/pages/ClientForm.tsx:305-313` (gate), `:345` (editable email input)
- **Repro:** Open any client → Edit Client → type one character in the Email field.
- **Actual:** `formReady = !isEdit || (existing != null && form.email === (existing.email ?? ""))`.
  The moment `form.email` diverges from `existing.email`, `formReady` → false and the
  component returns the skeleton branch (`if (isEdit && (isLoading || !formReady)) return <Skeleton…>`),
  unmounting the entire form. There is no path back: the gate only re-passes if a
  background refetch fires the `useEffect([existing])` re-hydration, which then **wipes
  every unsaved edit** (form reset from server data). Until a refetch (window-focus +
  staleTime 30s), the page is stuck on skeletons.
- **Expected:** The gate should be a one-shot "hydrated" boolean (e.g. set a `hydrated`
  flag in the populate-`useEffect`), not a live comparison against an editable field.
- **Impact:** Editing a client's email is effectively impossible; any in-progress edits
  on other fields are lost. (The same flawed comparison pattern is enshrined in
  CLAUDE.md as the reference pattern — the docs should be corrected too.)
- Related: `ScheduleK1Form` (ClientDetail.tsx:4415) uses
  `formReady = !isEdit || entityName === existing.entityName` and renders the
  Entity-type / §469 / SSTB controls under `{formReady && …}` — renaming the entity in
  the edit dialog makes those three controls vanish (state survives; controls reappear
  only if the name is typed back). MEDIUM on its own; same root cause.

### FE-A2 — Raw-fetch dialogs report success and close on HTTP 4xx/5xx (silent data loss)
- **Files:** `artifacts/tax-app/src/pages/ClientDetail.tsx`
  - `CapitalTransactionForm.handleSubmit` :3357-3375 (POST/PATCH, no `res.ok` check)
  - `RentalPropertyForm.handleSubmit` :3615-3633
  - `ScheduleCAssetForm.handleSubmit` :3848-3864
  - `ScheduleK1Form.handleSubmit` :4453-4471
  - Raw deletes: `handleDelete` in CapitalTransactionsTab :3202-3207, RentalPropertiesTab :3495-3500, ScheduleCAssetsTab :3730-3735, ScheduleK1Tab :4301-4306 (DELETE, no `res.ok` check)
- **Repro:** Trigger any server-side validation rejection (e.g. Zod 400 on a malformed
  date in the 8949 dialog, or 401 when `API_AUTH_TOKEN` is enabled) — `fetch()` resolves
  on HTTP errors, so the code falls through to `toast({ title: "Transaction updated" })`,
  closes the dialog, and invalidates queries.
- **Actual:** Success toast + dialog close; the refetched list silently shows the row
  unchanged/absent. The CPA believes the K-1/8949/rental/asset data was saved.
- **Expected:** Check `res.ok` (or use the generated Orval mutations, whose
  `custom-fetch.ts` correctly throws `ApiError` on non-2xx — verified at
  `lib/api-client-react/src/custom-fetch.ts:365-368`) and show the destructive toast.
- Note: `AssetBalancesTab` does this correctly (`if (!r.ok) throw new Error(await r.text())`).

### FE-A3 — W-2 / 1099 edit: clearing a money box silently keeps the old value
- **Files:** `artifacts/tax-app/src/pages/ClientDetail.tsx:587-602` (`W2DataTab.toPayload` — `f.wagesBox1 ? Number(f.wagesBox1) : undefined`), `:2491-2523` (`Form1099Tab.toPayload` — `numField = (s) => (s ? Number(s) : undefined)`)
- **Repro:** Edit a W-2 that has Box 2 = $5,000 → blank the Box 2 field → Save.
- **Actual:** The cleared field is sent as `undefined` → dropped by `JSON.stringify` →
  the server PATCH (`routes/w2data.ts:147` `{...parsed.data}`) never sees the key and
  keeps the old value. The UI refetch shows $5,000 back; the engine keeps using it.
  The API *does* accept explicit `null` to clear (`UpdateW2DataBody` fields are
  `.nullish()` — verified in `lib/api-zod` :1055-1063), so this is a frontend mapping
  bug: cleared fields should map to `null`, not `undefined`.
- **Impact:** A CPA cannot remove an erroneous withholding/wage figure through the UI;
  the wrong dollar amount persists in the calculation. (Workaround: delete + re-create
  the record.)
- Sub-issue (LOW): garbage like `"1.2.3"` survives CurrencyInput's strip and
  `Number(...)` → `NaN` → `JSON.stringify` serializes it as `null` → silently clears a
  field the user meant to set.

### FE-A4 — ADJUSTMENT_TYPE_LABELS missing 5 engine-live enum values → unselectable in UI
- **File:** `artifacts/tax-app/src/lib/adjustmentLabels.ts` (122 keys) vs
  `lib/api-spec/openapi.yaml` adjustmentType enum (127 values).
- **Missing:** `statutory_employee_income`, `church_employee_income`,
  `se_optional_method_nonfarm`, `crypto_staking_income`, `crypto_mining_income`.
- All five are read by the engine (verified `taxReturnEngine.ts:2025-2095`), and the
  Adjustments editor dropdown (ClientDetail.tsx:2920/2980) **and** the what-if scenario
  builder dropdown (ClientDetail.tsx:5746) are built from `Object.entries(ADJUSTMENT_TYPE_LABELS)`,
  so these five types cannot be created or simulated from the UI at all (existing rows
  show the raw snake_case key as the badge fallback).
- **Expected per the file's own contract:** "every shipped type should have a label."
  No extra/stale keys found (0 extras).

### FE-A5 — Child Tax Credit card hardcodes "× $2,000" per child; engine is $2,200 for TY2025/TY2026
- **File:** `artifacts/tax-app/src/pages/ClientDetail.tsx:1829` —
  `{n} qualifying children × $2,000` (+ `ClientForm.tsx:472` help text "Drives Child Tax Credit ($2,000/child)").
- **Engine truth:** `CTC_PER_CHILD = { 2024: 2000, 2025: 2200, 2026: 2200 }`
  (`taxCalculator.ts:7259`, OBBBA conformance shipped 2026-06-02).
- **Repro:** TY2025 client, 2 kids under 17, AGI under phase-out → breakdown card reads
  "2 qualifying children × $2,000" directly beside the (correct) engine value $4,400.
- **Actual vs expected:** Label math contradicts the displayed credit; a CPA reconciling
  the worksheet will conclude either the count or the credit is wrong. Label should be
  year-indexed (the breakdown endpoint already carries `taxYear`; better: have the
  endpoint return the per-child amount).
- The ODC "× $500" part is correct (unchanged by OBBBA).

### FE-A6 — CPA Tools Year-over-year swing rows violate the delta-coloring convention (credits red-on-increase, income green-on-increase)
- **File:** `artifacts/tax-app/src/components/CpaToolsTab.tsx:307` —
  `taxLike = /tax|owed/i.test(d.label) && !/refund/i.test(d.label)`, used by
  `YoySwingRow` (:327-340) with `deltaClass(change, goodWhenUp)`.
- **Server labels** (verified `api-server/src/lib/yearOverYear.ts:82-95`):
  - "Child Tax Credit (applied)" and "Earned Income Tax Credit" both contain "Tax" →
    classified tax-like → **an INCREASED credit renders red/unfavorable**. Convention
    (FE3, and `yoyDeltaClass` in ClientDetail.tsx:999-1011): credits are
    green-on-increase.
  - "Total income", "Adjusted gross income", "Taxable income" → not tax-like →
    `goodWhenUp=true` → **rising income renders green**. Convention: income lines are
    red-on-increase (the exact mis-signal FE3 was shipped to fix in the sibling
    Year-Compare card).
- Correctly handled by the same heuristic: "Federal tax (pre-credit)", "State tax",
  "Self-employment tax", NIIT, Add'l Medicare, AMT, "Federal refund/(owed)",
  "QBI deduction (§199A)", "Effective tax rate".
- **Expected:** use an explicit label set (like `YOY_HIGHER_IS_WORSE` /
  `AMEND_BETTER_WHEN_HIGHER`) instead of the regex heuristic.

---

## MEDIUM

### FE-B1 — AssetBalancesTab invalidates the WRONG tax-return query key
- **File:** `artifacts/tax-app/src/pages/ClientDetail.tsx:4062` and `:4076` —
  `qc.invalidateQueries({ queryKey: ["tax-return", clientId] })`.
- The generated key is `[`/api/clients/${clientId}/tax-return`]`
  (`lib/api-client-react/src/generated/api.ts:1938-1940`); `["tax-return", clientId]`
  matches nothing. Asset balances feed the persisted return (H6 Form 8606 pro-rata:
  traditional-IRA year-end balances change the taxable portion of a
  `roth_conversion_amount`), so after an asset save/delete the Tax Calculator tab can
  serve a stale return for up to `staleTime: 30_000` (App.tsx:18). Every other tab uses
  `getGetTaxReturnQueryKey(clientId)` correctly.

### FE-B2 — Four tab queryFns don't check `res.ok` → whole-app white-screen on API error
- **Files:** `artifacts/tax-app/src/pages/ClientDetail.tsx`
  - capital-transactions :3180-3186, rental-properties :3477-3483,
    schedule-c-assets :3713-3719, k1s :4284-4290 — all `return res.json()` unconditionally.
- On 401 (auth gate enabled), 404, or 500, the parsed error object becomes the query
  data → `(rows ?? []).filter(...)` / `.slice().sort(...)` throws
  (`filter is not a function`) **during render**, and there is no React error boundary
  anywhere (App.tsx) → the entire SPA unmounts to a blank page. Deterministic on those
  four tabs when `API_AUTH_TOKEN` is set without a stored token. The `w2-flags` query
  (:567-576) and `AssetBalancesTab` show the correct pattern (return [] / throw).

### FE-B3 — Roll-forward invalidation predicate misses all raw-keyed per-client queries
- **File:** `artifacts/tax-app/src/components/CpaToolsTab.tsx:608-621`.
- The predicate only matches keys that are strings starting with `/api/clients/:id`,
  but ClientDetail keeps six-plus per-client caches under custom array keys:
  `["schedule-k1", id]`, `["rental-properties", id]`, `["asset-balances", id]`,
  `["capital-transactions", id]`, `["w2-flags", id, …]`, `["tax-return-breakdown", …]`,
  `["diagnostics", …]`, `["form-4868"/"form-2210", …]`, `["tax-return-preview", …]`.
  After a roll-forward creates proforma K-1/rental/asset rows and advances
  `client.taxYear`, those tabs can render pre-roll data for up to 30s (the comment in
  the code asserting "every per-client query key starts with /api/clients/:id" is false).

### FE-B4 — ClientList never refreshes after create/edit (key mismatch)
- **Files:** `pages/ClientList.tsx:26/58` (custom `["clients-list", q, status]` infinite
  key) vs `pages/ClientForm.tsx:273/290` (invalidates only the generated
  `getListClientsQueryKey()` = `["/api/clients"]`).
- Create or rename a client, navigate back to /clients within the 30s staleTime: the
  list serves the cached pages — new client missing / old name shown. Delete is fine
  (ClientList invalidates its own key). Also: deleting a client does not invalidate the
  dashboard summary (`totalClients` stale ≤30s).

### FE-B5 — Locality dropdown drifted from the engine (Yonkers / PA munis / OH school districts unreachable)
- **File:** `artifacts/tax-app/src/lib/localityLabels.ts` (mirror) vs engine
  `LOCAL_TAX_DATA` + Yonkers handling (`taxCalculator.ts:787-788, 866-990`).
- Engine supports: localityCode `"YONKERS"` (16.75% NY surcharge, shipped 2026-06-05e),
  11 inline PA munis (`PA-PHILADELPHIA` 3.75% wage tax, Pittsburgh, Scranton, …) plus
  the ~175-muni bulk EIT registry, and `OH-SD-*` school districts. None are offered in
  the ClientForm dropdown (PA has no entry at all, so the Local-jurisdiction select
  doesn't even render for PA clients) — those engine features are unreachable from the
  UI, and a record with such a code shows the raw code via the `localityLabel` fallback.
- Compounding staleness in the same form (ClientForm.tsx:398-401): help text claims
  "NYC UBT not modeled" (shipped 2026-06-01) and "OH cross-city employment credit not
  modeled" (shipped 2026-06-01); MD text says "flat rate" (Anne Arundel/Frederick are
  graduated since MD-08).

### FE-B6 — CPA Tools cards vanish silently on any error (incl. 401/auth)
- **File:** `components/CpaToolsTab.tsx` — ProjectionCard :126, MfjVsMfsCard :212,
  YearOverYearCard :267, EntityChoiceCard :371, OrganizerCard :545 all
  `if (error || !data) return null;`.
- On 401/500 the entire CPA Tools tab renders as just the Engagement card (or nothing
  but the roll-forward button) with no error message or retry. Planning tab and the
  Dashboard hit-list handle errors with visible messages; these don't. (No 402 gate
  exists on cpa-tools endpoints — Pro-gating applies to `/planning-*` only, where the
  402 is handled by hiding the tab via `/api/settings` + an explicit error card.)

### FE-B7 — PDF/CSV download flows have zero error/content-type handling
- **Files:** `lib/download.ts` (`downloadFile`) + ~10 inline anchor-click copies in
  ClientDetail.tsx (workpapers :1856-1863, summary PDF :1871-1878, IRS 1040 :1886-1893,
  CSV :1901-1908, ultratax :1916-1923, JSON :1931-1938, 1040-X PDF :1097-1104,
  4868 :1319-1326, 2210 :1454-1461) and CpaToolsTab (organizer :562, planning report
  ClientDetail :4846).
- An anchor-click download saves whatever the server returns; on 4xx/5xx the user gets
  a `.pdf`-named file containing a JSON error body (the "42-byte-html-as-pdf" class),
  with no toast. The 4868/2210/1040-X buttons are at least gated on a successful JSON
  preview; the workpacket/summary/CSV/organizer/planning-report buttons are not gated on
  anything. No content-type check anywhere.

### FE-B8 — Top federal/state bracket renders "$731,201 – —" (Infinity lost in JSON)
- **Files:** frontend `ClientDetail.tsx:2680-2682` (`fmtRange` checks
  `max === Infinity || max > 1e15`); server `taxCalculator.ts:324-330`
  (`bracketMax: cap` where the top bracket's `upTo` is `Infinity`) +
  `routes/tax-returns.ts:888-906` (`res.json`).
- `JSON.stringify(Infinity)` → `null`, so `bracketMax` arrives as `null`; both frontend
  guards miss and the row renders `fmt(min) – fmt(null)` = "$731,201 – —" instead of
  "$731,201+". Only visible for filers whose taxable income reaches the top bracket.

---

## LOW

### FE-C1 — `pct()` lacks the NaN guard `fmt()` got in FE4
- `ClientDetail.tsx:100-103`: `pct(n)` only checks `n == null`. Call site :1758 wraps in
  `Number(...)`: `effectiveTaxRate` null → `Number(null)`=0 → renders "0.00%" instead of
  "—"; an undefined field → "NaN%". Mirror the `Number.isFinite` guard.

### FE-C2 — Stale year references across chrome/forms
- `App.tsx:96-98`: sidebar footer hardcodes "Tax Year 2024".
- `ClientForm.tsx:453-459`: taxYear capped `min 2024 max 2025` + text "Supported: 2024
  and 2025" — the engine natively supports TY2026 (shipped 2026-06-02); also HTML
  min/max don't block typed values, so 2026 actually submits fine despite the text.
- `YearCompareTab` (ClientDetail.tsx:2099-2105): year selects offer only 2024/2025.

### FE-C3 — a11y: `Label htmlFor` pointing at CurrencyInputs with no `id`
- `ClientDetail.tsx:1341/1352` (`form4868-amount-paying`, `form4868-est-paid`),
  :1476 (`form2210-est-payments`): the `CurrencyInput`s never receive those ids, so the
  labels associate with nothing. (CurrencyInput forwards `...rest`, so passing `id`
  fixes it — `AssetBalancesTab` does this correctly.)

### FE-C4 — Hardcoded Tailwind palette classes on the newer Planning cards
- `ClientDetail.tsx`: AI Discovery card (fuchsia-50/200/700/900, :5272-5357), State
  residency card (cyan-*, :5377-5462), Roth optimizer (violet-*, :5915-6030), estate
  badge (purple-100/900, :4652). Violates the semantic-token convention (amber/yellow is
  allowed for warnings only). Cosmetic/branding drift.

### FE-C5 — Misc edge cases
- `DocumentsTab.handleFile` (ClientDetail.tsx:158-180): `FileReader.onerror` unhandled →
  `uploading` stuck true (upload input disabled) if the read fails.
- `W2DataTab` legacy `ReviewDialog` (:444-452) renders `<img>` for the source doc even
  when it's a PDF → broken image, no boxes (the newer `BoundedDocumentViewer` handles
  PDFs; this older dialog wasn't migrated).
- `ReviewExtractionModal` taxYear input (:464): `Number(e.target.value) || clientTaxYear`
  — typing "2" momentarily commits year 2 (no clamp until blur; server-side validation
  is the only guard).
- Tax-Liability card nests deductions/credits (QBI, HSA, IRA, EITC…) under
  "Federal Tax (total)" with `└─` tree glyphs (:1772-1798) — visually implies they are
  components of the tax amount; values/labels themselves are correct.
- `ClientForm` planning-opportunities queries are not invalidated on client edits
  (filing status/state changes affect planning); self-heals via 30s staleTime +
  tab-remount refetch.

---

## Verified CLEAN (explicitly checked, no issue)

- **CurrencyInput convention:** every money field in every form/dialog uses
  `<CurrencyInput>`; all 15 `type="number"` inputs are years/ages/counts/months/quarters.
- **Refund/owed sign conventions:** banner (positive=refund green, negative=owed
  amber), CompareColumn, DiffCard, what-if builder (`signedMoney` rows), 4868/2210
  cards — consistent, `Math.abs` + direction labels correct.
- **`amendDeltaClass` (1040-X):** the `AMEND_BETTER_WHEN_HIGHER` set was diffed against
  every server lineRef (`form1040x.ts:324-379`: lines 1–20, S1–S3, credit detail
  7a–7f) — every line colors correctly, including "19 Amount you owe" (red-on-up) vs
  "20 Refund" (green-on-up).
- **`yoyDeltaClass` (Year-Compare DiffCard):** all 26 row labels checked against
  `YOY_HIGHER_IS_WORSE` — consistent (income/tax red-on-up; deductions/credits/refunds
  green-on-up). The violation is only in CpaToolsTab's separate heuristic (FE-A6).
- **fmt() NaN guard (FE4)** present and used for all $ rendering; W-2/1099 display
  values wrapped `val != null ? fmt(Number(val)) : "—"`.
- **What-if scenario builder:** mutation construction guards the `Number("")`/garbage
  footgun explicitly (strip-then-require-non-empty, `Number.isFinite` checks, numeric
  client-field coercion with rejection, state uppercased) — `whatIfRowToMutation`
  (ClientDetail.tsx:5534-5572) is the best-practice implementation in the file. Verdict
  driven off `combinedRefundDelta` (credit-safe), divide-by-zero-free.
- **XSS surface:** zero `dangerouslySetInnerHTML` (outside the unused stock shadcn
  chart.tsx), zero `window.open`/`target="_blank"`, no URL construction from user
  strings (all URLs are id/year-parameterized same-origin paths). LLM-generated content
  (memo, email, QA answer, discovery rationale, campaign template) is rendered
  exclusively as text nodes (`<pre>{content}</pre>` / `{text}`), never HTML.
- **Generated client:** `custom-fetch.ts` throws typed `ApiError` on every non-2xx and
  attaches the bearer token; orval mutations therefore surface errors properly wherever
  they're used.
- **Pro-tier 402 handling:** Dashboard + ClientDetail gate on
  `settings.proTierEnabled === false` (no paywall flash during load), planning hit-list
  shows an explicit error+retry; the Planning tab/page hides cleanly.
- **PII masking:** SSN/TIN masked in all list/review views (`maskSSN`/`maskTin`); the
  extraction-review modal intentionally shows the editable SSN for verification.
- **Charts/aggregates:** no division by zero found (peer benchmark guards
  `cohortSize === 0`; planning category sort uses summed savings; dashboard avg-refund
  is server-computed and null-guarded); `planningScore`/`federalMarginalRate` are
  required schema fields, server always emits numbers.
- **`baselineState_tax`** odd-looking key in StateResidencyComparisonCard matches the
  server response exactly (planning.ts:750, openapi :4820).
- **TYPE_LABELS extras:** none (no dead labels).
- **Scroll container:** `<main className="flex-1 overflow-auto">` per convention.
- **Documents polling** stops correctly when no doc is `processing`; review modal state
  resets per doc id; pending guard on the QA ask button prevents double-fire.
