# AI Document Extraction Subsystem — Independent Audit (2026-06-11)

Auditor: fresh independent pass, read-only. Scope: `artifacts/api-server/src/lib/documentExtractor.ts`,
`routes/documents.ts`, `lib/validation/` (@workspace/validation), `routes/form1099data.ts` /
`w2data.ts` (write/read seams), `lib/integrations-openai-ai-server/`, plus the engine read seam
(`summarize1099s`) and the review UI seam (`ReviewExtractionModal.tsx`) where the pipeline lands.
HIGH/CRITICAL logic findings confirmed by executing the pure functions (`/tmp/audit-repro-int.ts`,
run via `npx tsx` from `scripts/`). No repo files modified; no live AI calls; no servers/test
suites run.

---

## CRITICAL

### C-1. 1099-INT Box 3 (U.S. Treasury interest) is extracted, stored — and contributes $0 to income
- The extractor prompts for and normalizes `usTreasuryInterest` (Box 3) (`documentExtractor.ts:295,344,432`);
  the approve seam persists it (`routes/documents.ts:474`); the DB column and the review modal field
  ("Box 3 — U.S. Treasury interest") exist.
- But the engine's `Form1099Fact` (`taxReturnEngine.ts:242-277`) has **no `usTreasuryInterest` field**, and
  `summarize1099s` never reads it. `grep usTreasuryInterest` across `api-server/src/lib` matches only
  `documentExtractor.ts` — zero engine/pipeline read sites.
- Per the 2024 Form 1099-INT / Form 1040 instructions, **line 2b taxable interest = Box 1 + Box 3** (Box 3
  is fully federally taxable; it is *excluded from Box 1* on the form).
- **Repro (executed):** `summarize1099s([{formType:"int", usTreasuryInterest:10000}])` → `interestIncome = 0`;
  end-to-end `computeTaxReturnPure` (single, TX, 2024) → **AGI = 0, totalIncome = 0** (should be $10,000).
- This is the exact F1 class: AI-extracted → CPA-approved → persisted → silently dropped by the engine.
  A client whose broker 1099-INT reports Treasury interest in Box 3 (extremely common: T-bills, Treasury
  MMFs reporting in Box 3) has that income vanish. The manual-entry form (ClientDetail) doesn't even offer
  Box 3, so manual users likely shove it into Box 1 — the AI path is faithful to the form and is therefore
  the path that loses the money.

### C-2. 1099-INT Box 8 (tax-exempt interest) is subtracted from Box 1 — taxable interest understated
- `taxReturnEngine.ts:611-615`: taxable interest = `Σ max(0, interestIncome − taxExemptInterest)` per
  record, with the comment "Interest: total minus tax-exempt portion". The same subtraction is repeated in
  the Schedule B per-payer aggregation (`taxReturnEngine.ts:740`).
- On the IRS form, **Box 8 is not a subset of Box 1** — they are disjoint buckets (Box 1 → 1040 line 2b,
  Box 8 → line 2a). The app's own semantics agree: the review modal labels the fields "Box 1 — Interest
  income" / "Box 8 — Tax-exempt interest" (`ReviewExtractionModal.tsx:135,138`), the manual form does too
  (`ClientDetail.tsx:2400-2401`), the extraction prompt extracts per IRS boxes, and the validation package's
  `primaryIncome("int") = interestIncome + usTreasuryInterest` (additive — no Box 8 netting).
- **Repro (executed):** Box 1 = $5,000, Box 8 = $3,000 (a normal consolidated brokerage 1099-INT) →
  engine taxable interest **$2,000** instead of $5,000. Tax-exempt is still separately summed for
  Pub 915/EITC, so the $3,000 is *not* re-added anywhere — federal (and state, which keys off federal AGI)
  income is silently understated by min(Box 1, Box 8).
- Fires on any record that has both boxes populated; with AI extraction (which faithfully fills both),
  that is every muni-holding brokerage client.

---

## HIGH

### H-1. SSA-1099 Box 6 (voluntary federal withholding) is extracted, then silently dropped at approve
- The extractor prompts for `voluntaryFederalWithholding` (Box 6) and normalizes it
  (`documentExtractor.ts:495,543`). But:
  - `mapInfoReturnToInputs` has no case for it (ssa1099 maps only Box 5 → `clientPatch.socialSecurityBenefits`,
    `documentExtractor.ts:654-657`);
  - the approve handler doesn't even pass it into the mapper (`routes/documents.ts:536-551`);
  - the review modal neither displays nor sends it (ssa1099 group = Box 5 only,
    `ReviewExtractionModal.tsx:204-206`).
- Contrast: **W-2G Box 4 withholding IS mapped** to a `withholding_adjustment` (verified by repro:
  `[["additional_income",20000],["withholding_adjustment",4800]]`). The identical lever exists and is used
  by the sibling form — the SSA-1099 omission is an asymmetry, not a design boundary, and it is **not**
  listed in the "remaining tail" of `docs/doc-type-coverage.md`.
- Effect: a retiree with SS withholding (very common: ~7/10/12/22% W-4V elections) gets a refund understated
  / balance due overstated by the full Box 6 amount, silently, after the CPA "approved" a document on which
  the box was extracted. Repro (executed): Box 5 $24,000 + Box 6 $3,600 → mapping contains no withholding.

### H-2. 1098 Box 4 netting (audit fix "A1", 2026-06-08g) is unreachable from the product UI — dead in the real flow
- Server logic exists and works (repro: Box 1 $9,000 − Box 4 $1,200 → `mortgage_interest` $7,800), and
  `ApproveExtractionBody.refundOfOverpaidInterest` is in the zod schema (api.ts:861-866, with the A1
  description).
- But `ReviewExtractionModal` defines **no FieldDef for `refundOfOverpaidInterest`** — the 1098 group is
  Box 1 + Box 10 only (`ReviewExtractionModal.tsx:188-191`), the info-return path has no "extra extracted
  fields" merge (that exists only for 1099 subtypes, lines 304-331), and `INFO_RETURN_VALUE_KEYS` therefore
  excludes it → the approve body never carries it → `pos(undefined) = 0` → **no netting ever happens via the
  app**. The CPA cannot even see the extracted Box 4 value to act on it.
- Effect: mortgage-interest deduction overstated by Box 4 whenever a lender reports a refund of overpaid
  interest. (Secondary, documented-design note: netting Box 1 is itself an approximation — Pub 936 treats a
  *prior-year* refund as §111 recovery income, not a reduction of the current-year deduction; netting
  under-taxes a std-deduction-this-year filer. But the shipped A1 behavior being unreachable is the bug.)
- Same dead-wire pattern applies to every extracted-but-undisplayed info-return box: SSA Box 3/4
  (so the Box5=Box3−Box4 identity can never be checked at review), W-2G Box 14/15, 1098-T Box 4/6/8/9,
  1098 Box 2/3/5/6.

### H-3. Plaintext SSN/TIN persists in `tax_documents.extracted_text` and is returned by the documents LIST endpoint — even with PII encryption ON
- The extraction payload stored in `extracted_text` is `{text, data, boxes, confidence}` where `data`
  includes `employeeSSN` / `payerTin` / `recipientTin` exactly as extracted (`routes/documents.ts:214-230`).
  `fieldCrypto` covers only the three *record* columns (`w2_data.employee_ssn`, `form_1099_data.payer_tin`,
  `recipient_tin`) at the approve/CRUD seams — the extraction payload is never encrypted and **never cleared
  after approve/reject** (the approve handler updates only status/link fields).
- SEC-01 projected `fileContent` out of `GET /clients/:id/documents` — but the same projection **returns
  `extractedText`** (`routes/documents.ts:73`), so every list response ships the extracted SSN in cleartext
  JSON (needed today by the review modal, but it keeps flowing after approval, forever).
- The documented P0-5 gap covers `tax_documents.file_content` (the blob, S3+KMS runbook). `extracted_text`
  is an **undocumented sibling**: with `PII_ENCRYPTION_KEY` set and the backfill run, the SSN still sits in
  plaintext in this column and on the wire of a routine list call. Greppable in `docs/` — no mention.
- In the demo posture this is consistent with everything else; in the real-PII posture it partially defeats
  P0-5. Recommend: encrypt-or-strip `data.employeeSSN`/TINs inside the payload at write, and/or null the
  payload (or at least the PII keys) when the doc leaves `pending_review`, and project `extractedText` away
  from the list for non-pending docs.

---

## MEDIUM

### M-1. `validateInfoReturn` is dead code — none of its checks run anywhere in the product
- Grep shows the only caller is its own test file (`scripts/src/tax-engine-info-return-extraction-tests.ts`).
  The review modal's live flags are explicitly W-2-only (`if (recordType !== "w2") return []`,
  `ReviewExtractionModal.tsx:272-273`); `returnDiagnostics.ts` wires `validateW2` + `validate1099` but not
  `validateInfoReturn` — and since info-returns persist as adjustments/client-patches (no structured record),
  post-approve diagnostics can never reconstruct the boxes. Review time was the only possible seam.
- So the SSA Box5=Box3−Box4 error check, W-2G withholding≤winnings, 1095-A APTC≤premium / SLCSP=0,
  1098-E §221 note, negative-box errors — all unreachable. `docs/doc-type-coverage.md` ("the document-review
  flow") and the module docstring claim it's shared with the review flow; both are inaccurate.
- Compounding: validate1099 runs only *post-approve* (diagnostics), so 1099 box arithmetic (DIV 1b≤1a,
  R 2a≤1, B proceeds−basis≈gain) is also absent at the moment the CPA is staring at the extraction.

### M-2. Double-approve race (TOCTOU) — concurrent approves can double-insert income records
- `POST .../approve` checks `doc.status === "pending_review"` *outside* the transaction
  (`routes/documents.ts:354`), and the in-transaction `UPDATE tax_documents SET status='approved'` has **no
  status predicate** (`.where(eq(taxDocumentsTable.id, doc.id))` only, lines 403-411 / 494-502 / 584-587)
  and no `SELECT ... FOR UPDATE`. Two near-simultaneous approves (double-click, two tabs) can both pass the
  gate → two w2/1099 rows → doubled income. Sequential re-approve is correctly 400'd.
- Fix shape: `UPDATE ... WHERE id = $1 AND status = 'pending_review'` + assert rowcount inside the tx (same
  idempotency-key pattern as the BE-02 fix elsewhere).

### M-3. 1099-B: Box 1g (wash-sale disallowed) not extracted; partial extraction yields silent $0
- The 1099-B field set is proceeds / costBasis / ST / LT only (`documentExtractor.ts:303-306`); Box 1g is
  absent from prompt, schema, and DB write. If the model sums per-lot *realized* gain/loss columns (the
  prompt says "sum if there are multiple lots" with no add-back instruction), disallowed wash losses are
  deducted → tax understated. The precise path (per-lot `capital_transactions` with `washSaleDisallowed`,
  which overrides 1099-B aggregates per `taxReturnEngine.ts:301`) exists, but the quick path has no guard.
- Also: a 1099-B extraction that captures proceeds+basis but not the ST/LT split contributes **$0** to
  income (engine reads only `shortTermGainLoss`/`longTermGainLoss`), and `validate1099`'s cross-check only
  fires when *both* sides are present — no flag for "proceeds present, gain/loss missing".

### M-4. Info-return approve writes year-agnostic adjustments — cross-year double-count hazard
- `adjustments` has no `taxYear` column; the pipeline loads all-years and the engine filters by `isApplied`
  only (schema comment claiming "filters by … tax-year in code" is wrong for adjustments). Approving the
  TY2024 1098 and next year the TY2025 1098 stacks both `mortgage_interest` adjustments into every year's
  return; a W-2G `additional_income` likewise inflates other years.
- Documented as a sub-gap in `docs/doc-type-coverage.md` ("matches manual entry") — but the approve UX
  contradicts it: the body carries `taxYear` and the recalc is pinned to it, implying scoping that doesn't
  exist. With multi-year now first-class (roll-forward, G4, year-compare), this graduates from tail-note to
  real footgun. (W-2/1099 approvals are correctly year-scoped — the asymmetry is the trap.)

### M-5. W-2 extraction coverage stops at boxes 1-6/16/17 + one state row
- Not extracted: boxes 7/8 (SS tips/allocated tips), 10 (dependent-care benefits — feeds Form 2441),
  11, **12 codes** (401(k)/HSA W/GTL C…), **13 checkboxes** (the retirement-plan box drives the IRA
  deduction phase-out the engine models via client fields), 14, second state row, and locals 18-20 (the
  engine models MD/OH/IN/KY/NYC local taxes — the W-2 boxes that evidence them aren't captured).
  Mis-mapping: none found — what is extracted maps to the right boxes; this is a coverage gap that forces
  silent CPA hand-derivation on exactly the boxes that alter other parts of the return.
- Related engine note: W-2 Box 4 is extracted/validated but no excess-SS-tax credit (Schedule 3 line 11,
  multi-employer over-withholding) exists anywhere in the engine — over-withheld SS is simply lost.

---

## LOW

1. **W-2G "typeOfWager (Box 6)" mislabel** — on Form W-2G, Type of wager is **Box 3**; Box 6 is "Race"
   (`documentExtractor.ts:499,544`). String is display-only/unmapped; the model will extract the race
   number as the wager type.
2. **Bounding boxes unclamped/unwhitelisted** — `normalizeBoxes` accepts any field name and any finite
   coords (negative, >1000, page floor'd but unbounded). Values are Number-coerced (no string injection)
   and React escapes keys; UI may render off-canvas highlights. Confidence is clamped [0,1] (NaN dropped,
   >1 treated as percent — 1.5 → 0.015, harmless-conservative).
3. **`</DOCUMENT>` fence escape** — a text upload containing the closing tag can break the injection fence
   in `extractW2DataFromText`; backstopped by the field whitelist + CPA gate. Consider tag randomization.
4. **`SS_WAGE_BASE_BY_YEAR` in @workspace/validation** is a plain `Record<number, number>` (2023-2026
   present, incl. 2026 $184,500 ✓) — not the repo's `Record<TaxYear>` compile-time freshness pattern; an
   activated 2027 silently skips the Box 3 cap check. Same for the hardcoded $200k Additional-Medicare
   threshold (statutorily un-indexed — fine).
5. **validateW2 has no negative-amount guards** (validate1099 does); `ApproveExtractionBody` numerics are
   unbounded `zod.number()` (negative/1e308 accepted; engine `toNum` ±1e13 clamp is the backstop, DB
   numeric(12,2) will 500 on overflow).
6. **W-2 `employerEin` stored plaintext** while the equivalent 1099 `payerTin` is encrypted — documented
   P0-5 scope, but inconsistent treatment of 9-digit business TINs.
7. **Spec drift:** `linkedRecordType` enum in openapi/zod is `[w2, form1099, null]` but the server writes
   `"info_return"` (`routes/documents.ts:585`); `ApproveExtractionResponse` would reject the server's own
   response if ever runtime-parsed.
8. **SSA-1099 negative Box 5** (repayments > benefits, possible §1341/itemized treatment) maps to nothing →
   approve 400s "No applicable values" — acceptable (no wrong income), CPA handles manually; worth a hint.
9. **Pending-cap and upload races** — the 50-pending check is a non-transactional count; concurrent bursts
   can exceed it. Cosmetic: the 8MB cap's comment says "~6MB base64 ≈ 4.5MB raw" but 8e6 chars ≈ 6MB raw.
10. **Text-path 1099/info-returns aren't extracted at all** (only W-2 has a text-prompt path) — doc lands
    `pending_review` with empty data; CPA hand-keys. By design, but unannounced in the UI.
11. **No explicit AI timeout/retry tuning** — relies on OpenAI SDK defaults (2 retries, long default
    timeout); a hung provider holds the doc in `processing` until the SDK gives up; no stuck-doc reaper.

---

## Verified CLEAN (explicitly checked, no issue)

- **F1 formType case bug — fix holds at ALL read sites, including post-2026-06-08 modules.** Write seam
  lowercases (`documents.ts:450`); manual-path zod enum is lowercase-only; read-side normalization at:
  `summarize1099s` (`ft()` 599), engine DIV cap-gain (1539) and MFJ-SE NEC (2147), `form8949Spec:189`,
  `form5329Spec:57`, `scheduleDSpec:113,450`, `entityChoice.ts:101`, `clientOrganizer.ts norm()` (103-105,
  all uses), roll-forward copies verbatim (safe given normalized read sites). `returnDiagnostics.ts:267`
  uppercases for a display label only. Legacy uppercase rows confirmed handled (repro: `formType:"INT"`
  → counted).
- **1099 box mappings otherwise correct vs 2024 layouts:** NEC Box 1; MISC 1/2/3/5/6 (rents+royalties also
  split into the NIIT base); DIV 1a/1b/2a/3 — engine ordinary = 1a − 1b matches the 1040 convention,
  nondividend distributions correctly NOT income (repro C); R Box 1/2a/7 + IRA box — `2a = 0` honored
  (rollover → $0, repro J), 2a-missing → conservative full-gross fallback, §72(t) codes 1→10% / S→25%;
  G Box 1 always taxable (§85) + Box 2 gated on `priorYearItemized` (§111, with A3 auto-derivation);
  K Box 1a; B signed ST/LT flow into Schedule D netting, and per-lot capital transactions *override*
  1099-B aggregates (no double-count).
- **mapInfoReturnToInputs:** pure, whitelist-driven; 1098-T = max(0, Box 1 − Box 5) ✓; 1098-E → §221 lever
  (engine caps + the 2026-06-10 SLI-MAGI fix) ✓; 1095-A → 3 ACA fields ✓; SSA → Box 5 (correct net box) ✓;
  W-2G → income + withholding ✓; positive-only mapping prevents 0-overwrites ✓; all six emitted
  `adjustmentType` strings verified against real engine levers (`sumByType` sites). No prototype pollution
  (repro I).
- **Prompt-injection posture:** all four prompts fence the document as untrusted data; output passes
  through strict whitelists (`normalizeData` / `normalize1099Data` / `normalizeInfoReturnData`) that drop
  unknown keys and non-finite numbers; `extractJsonObject` failure degrades to `{}` →`pending_review` with
  empty fields (no crash, CPA sees blanks); a malicious doc cannot add DB fields — the approve body is
  zod-whitelisted and adjustments are built server-side from a fixed mapping. Residuals: box-key
  whitelist + fence-tag (LOW 2/3).
- **§7216 consent gate:** enforced at the upload handler AND re-checked inside the extraction IIFE
  immediately before transmission (`documents.ts:134-142,170-177`); `consentRequired()` defaults ON when
  `NODE_ENV=production`, decoupled from the bearer token; `hasValidConsent` fails CLOSED on DB errors;
  blocked extraction marks the doc `failed` without calling Gemini.
- **fieldCrypto at this seam:** approve encrypts `employeeSSN`/`payerTin`/`recipientTin`; `encryptField`
  throws on the decrypt-failure sentinel (TIN-destroying round-trip prevented), is idempotent on
  ciphertext; w2 flags route nulls the sentinel so it can't poison dup-SSN checks. (See H-3 for the
  extracted_text exception.)
- **Upload robustness:** 8MB base64 cap (413), 50-pending cap (429), magic-byte sniffing with
  extension cross-check (415 on mismatch; content-MIME wins for extractor routing); SVG/HTML not
  acceptable as visual types; `/content` serves with `Cache-Control: no-store`, `X-Content-Type-Options:
  nosniff`, sanitized `Content-Disposition` filename; list endpoint projects `fileContent` away; upload
  response strips it.
- **Failure path:** dummy/invalid AI key → `aiEnabled` true → SDK error → caught → doc `failed`; approve
  of non-`pending_review` (incl. `failed`) → 400; `aiEnabled` false → empty extraction, doc still reaches
  `pending_review` for hand-keying. Approve + record-insert + doc-flip are transactional (no orphan
  records), audit-logged with encrypted PII, and the recalc is pinned to the approved record's taxYear.
- **W-2 validation rules:** SS wage cap year-indexed incl. 2026 $184,500 (matches SSA), Box 3 > cap =
  error, Box 3 = Box 5 below cap / = cap above; Box 4 ≈ 6.2% (±0.5pp ratio); Box 6 = 1.45% + 0.9% over
  $200k (±max($5,5%)); EIN 9-digit; cross-W-2 SSN-mismatch error; fed/state withholding plausibility
  bands; year + state mismatch flags. Live in the review modal for W-2s.

## Suggested fix order
1. C-2 + C-1 (one function, `summarize1099s` + `Form1099Fact` + Schedule B payer loop; ~20 lines + tests;
   re-hand-calc any suite that asserted the netted behavior).
2. H-1 + H-2 (add SSA Box 6 → `withholding_adjustment` in mapper+handler+modal; add the Box 4 FieldDef and
   an info-return "extra extracted fields" merge in the modal).
3. H-3 (strip/encrypt PII keys in the extraction payload; clear or project after review).
4. M-1 (wire `validateInfoReturn` + `validate1099` into the modal's live flags), M-2 (status-guarded
   UPDATE), then M-3/M-4/M-5 as scoped backlog items.
