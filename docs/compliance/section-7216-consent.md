# IRC §7216 Disclosure-Consent Framework — AI-Assisted Document Extraction

**Status:** Working draft for counsel finalization. **Owner:** [QUALIFIED INDIVIDUAL / COMPLIANCE LEAD]. **Last updated:** 2026-06-03.
**Applies to:** The TaxFlow Assistant AI document-extraction feature, which transmits uploaded W-2 / 1099 / K-1 documents to Google Gemini for field extraction.
**Companion documents:** `docs/compliance/wisp.md` (FTC Safeguards Rule WISP — Google must be named there as a sub-processor), the executed Google Data Processing Addendum, and IRS Pub 4557 / Pub 5708.

> **[LEGAL REVIEW]** This document is a software-vendor working draft. Every block of consent language below, and the legal conclusions in §1, §2, and §6, must be reviewed and approved by qualified tax counsel before TaxFlow renders any consent instrument to a taxpayer or transmits any return information to Google Gemini under it. TaxFlow Assistant is software; the §7216 obligation runs to the **CPA preparer-firm** that uses it. Nothing here is legal advice to any firm.

---

## 0. Why this exists (executive summary)

TaxFlow's AI extraction sends the **full, unredacted** W-2 / 1099 / K-1 — including the taxpayer's name, SSN/TIN, employer/payer EIN, and dollar amounts — to a third party (Google) for processing. Under **IRC §7216** and **Treas. Reg. §301.7216-1 through -3**, a tax return preparer who sends return information to a third-party service provider has made a **"disclosure."** Making that disclosure without a statute-compliant taxpayer consent is a **federal crime** (§7216: up to **$1,000 and/or one year imprisonment per disclosure**) and a **civil penalty** (§6713: **$250 per disclosure, $10,000/year cap**).

The current production configuration makes this worse in three ways that must all be fixed before real client PII flows through the feature:

1. **No consent is captured today.** The extractor in `artifacts/api-server/src/lib/documentExtractor.ts` transmits to Gemini with no §7216 gate of any kind.
2. **Google's free Gemini tier permits Google to use submitted data to improve its products.** That defeats the contractor / "auxiliary services" path and is incompatible with even a properly drafted consent, because the disclosure is no longer limited to "assist in preparing the return."
3. **The data is sent in plaintext** (no zero-retention config, no DPA), which independently violates the FTC Safeguards Rule encryption and service-provider-oversight requirements (tracked in the WISP, cross-referenced here).

This document delivers: (§1) the plain-English legal frame; (§2) the exact format requirements; (§3) the **verbatim consent instrument** TaxFlow renders; (§4) the **product-enforcement spec** that makes the consent gate fail-closed; (§5) the **vendor/DPA checklist** to get off the free tier; and (§6) the "auxiliary services" analysis and why explicit consent is the safe path.

---

## 1. Plain-English explanation

### 1.1 Sending a document to Google Gemini is a "disclosure of tax return information"

"**Tax return information**" (Treas. Reg. §301.7216-1(b)(3)) is any information the preparer obtains in connection with preparing a return — the W-2/1099/K-1 itself, the SSN/TIN, wages, withholding, and the extracted values are all squarely within it.

A "**disclosure**" (Treas. Reg. §301.7216-1(b)(4)) is the act of making tax return information **known to any person in any manner whatever**. When TaxFlow base64-encodes the uploaded W-2 and POSTs it to Google's OpenAI-compatible Gemini endpoint, the firm has made the contents **known to Google** — a third person. That is a disclosure, full stop. It does not matter that the purpose is benign (data extraction); the regulation turns on whether information left the preparer's control, not on intent.

> Concretely, in TaxFlow the disclosure happens inside the fire-and-forget block in `artifacts/api-server/src/routes/documents.ts` (the `(async () => { … })()` that calls `extractW2DataFromFile` / `extract1099DataFromFile` / `extractW2DataFromText`), each of which calls `openai.chat.completions.create(...)` against the Gemini-compat endpoint with `image_url: data:${mimeType};base64,${base64Content}` — i.e., the entire document.

### 1.2 Who bears the obligation

- **The CPA preparer-firm bears the §7216 obligation.** §7216 applies to a "tax return preparer." The firm using TaxFlow is the preparer. The firm — through its **Qualified Individual** under the Safeguards Rule — is the party who can be fined or imprisoned, and who must obtain and retain the consent.
- **TaxFlow (the software) must not cause a non-compliant disclosure.** TaxFlow is not itself the §7216 preparer, but if the product transmits to Gemini without a valid consent on file, it **causes the firm to commit the violation**. That is both a contractual/liability exposure for TaxFlow and a betrayal of the product's core promise. **Therefore the product MUST be built to make the non-compliant path impossible** (fail-closed; see §4). The consent is the firm's legal act; the *enforcement* is TaxFlow's engineering obligation.

> **[LEGAL REVIEW]** Counsel should confirm TaxFlow's own status. If TaxFlow ever processes return information on the firm's behalf beyond pure software (e.g., TaxFlow operates the Gemini relationship as the contracting party rather than the firm), TaxFlow may itself be a preparer or a §301.7216-2(d) contractor and would need to be bound under §7216 in the firm's service agreement.

### 1.3 The penalties (state them to the firm, in the UI and the engagement docs)

| Statute | Type | Penalty |
|---|---|---|
| **IRC §7216** | **Criminal** | Up to **$1,000 fine and/or 1 year imprisonment**, **per disclosure**, plus costs of prosecution. |
| **IRC §6713** | **Civil** | **$250 per disclosure**, capped at **$10,000 per calendar year**. Applies **in addition** to §7216 and does not require willfulness. |

"Per disclosure" means **per taxpayer document transmitted**, not per firm — a single batch upload night could generate dozens of separate violations. The IRS also makes preparers **attest to a data-security plan at PTIN renewal**; a §7216 program is part of that attestation's credibility.

---

## 2. Format requirements (Rev. Proc. 2013-14 / Treas. Reg. §301.7216-3)

Because TaxFlow's clients file in the **Form 1040 series**, the consent must satisfy **Rev. Proc. 2013-14** (the mandatory format/content rules for 1040-series consents) in addition to **Treas. Reg. §301.7216-3**. The following are mandatory; **a defect in any one voids the consent and re-exposes the firm to §7216 liability.**

1. **Separate written document.** The consent to disclose must be its own document, not buried in an engagement letter, Terms of Service, or click-through EULA (Treas. Reg. §301.7216-3(a)(3)(i); Rev. Proc. 2013-14 §4). A consent to **disclose** and a consent to **use** must each be separate; this instrument covers a *disclosure* to Google.

2. **Signed and dated by the taxpayer BEFORE the disclosure.** Consent must be obtained — affirmatively signed and dated — **prior to** the disclosure (Treas. Reg. §301.7216-3(a)). A consent collected after the document has already been sent to Gemini is worthless. *(This is the single most important rule for the product gate in §4: no transmission may precede a recorded, unexpired signature.)*

3. **Identifies the recipient.** The consent must name the person/entity to whom the information will be disclosed. Here: **Google LLC** (and its relevant cloud entity — e.g., Google Cloud / Vertex AI under the executed DPA). Do not say "our software vendors" generically.

4. **Identifies the specific information disclosed.** The consent must describe what is disclosed. Here: the uploaded income document(s) and the data fields on them, including **name, SSN/TIN, employer/payer identification, and dollar amounts.** (Rev. Proc. 2013-14 §5.04(1)(b) requires identifying the particular return information.)

5. **States the specific purpose.** Here: AI-assisted optical extraction of the data fields from the uploaded document so the preparer can populate the return. Disclosure may not exceed that purpose (Treas. Reg. §301.7216-3(b)).

6. **States the duration.** Must state how long the consent is effective. If the taxpayer does not specify a duration, **the consent is valid for one year from the date of signature** — TaxFlow defaults to and records a one-year expiry (Rev. Proc. 2013-14; the verbatim duration sentence appears in §3 below).

7. **Mandatory statements, in the required sequence (Rev. Proc. 2013-14 §5.04).** The consent must contain:
   - the **voluntariness statement** (the taxpayer is not required to sign; if signed, may set a duration);
   - the **"if you believe … improper disclosure"** statement directing the taxpayer to the **Treasury Inspector General for Tax Administration (TIGTA)**, with TIGTA's telephone number and email;
   - the IRS-mandated language for the specific consent type.
   The exact wording is reproduced in §3 and is marked **[LEGAL REVIEW]**.

8. **Type-size / legibility.**
   - **Electronic consents** (TaxFlow's case): the consent text must be in a type **at least as large as the normal or standard text used by the website/software**, and the mandated statements must be in **at least 8-point type** (Treas. Reg. §301.7216-3(a)(3)(iii); Rev. Proc. 2013-14). TaxFlow renders the consent in the app's standard body type (≥ the surrounding UI, never smaller than 8-point), with sufficient contrast, printable.
   - **Paper consents** (if a firm prints/wet-signs): at least the size of the preparer's normal text, with adequate contrast and printable. *(Some practitioners standardize on 12-point; counsel to confirm the firm's house standard.)*

9. **No pre-checked boxes; affirmative, opt-in only.** Consent must be **affirmative**. **Opt-out consents are prohibited.** The taxpayer must affirmatively select/sign. The consent checkbox and signature field MUST default to unchecked/empty (enforced in §4). The taxpayer must be able to decline and still have their return prepared (the AI feature is simply unavailable for that client).

10. **Signature.** A handwritten signature on paper, or a valid electronic signature on an electronic consent. TaxFlow captures an e-signature plus the metadata in §4 (`signatureRef`).

> **Outside-the-U.S. note.** If TaxFlow ever routes extraction to a sub-processor or model endpoint **located outside the United States**, an **additional mandatory statement is required** and, for 1040 filers, the **SSN must generally be masked/not disclosed** to an offshore preparer absent the specific adequate-data-protection consent (Treas. Reg. §301.7216-3(b)(4)). **[LEGAL REVIEW]** Confirm the Google processing region; if Vertex AI processing is pinned to a U.S. region (see §5), this clause does not apply, but the consent should still recite the region.

---

## 3. The verbatim consent instrument (production draft)

This is the document TaxFlow renders to the taxpayer (or to the CPA on the taxpayer's behalf for wet-signature) **before** any AI extraction. It is written to satisfy §2. `[BRACKETS]` are runtime fill-ins; **[LEGAL REVIEW]** marks language counsel must approve.

The product renders this as **document version `ai_extraction_v1`** and stamps that version into the `disclosure_consents` record (§4) so the firm can prove which text the taxpayer actually signed.

---

> ### CONSENT TO DISCLOSE TAX RETURN INFORMATION
> #### (AI-Assisted Document Extraction)
>
> **Taxpayer:** [TAXPAYER_FULL_NAME]  **Tax year:** [TAX_YEAR]
> **Prepared by (your tax return preparer):** [FIRM_LEGAL_NAME], [FIRM_ADDRESS]
> **Consent version:** ai_extraction_v1  **Date presented:** [PRESENTED_DATE]
>
> ---
>
> **Federal law requires this consent form be provided to you.** Unless authorized by law, we cannot disclose your tax return information to third parties for purposes other than the preparation and filing of your tax return without your consent. If you consent to the disclosure of your tax return information, Federal law may not protect your tax return information from further use or distribution.
>
> **You are not required to complete this form to engage our tax return preparation services.** If we obtain your signature on this form by conditioning our tax return preparation services on your consent, your consent will not be valid. **Your consent is valid for the amount of time that you specify. If you do not specify the duration of your consent, your consent is valid for one year from the date of signature.**
>
> **What you are consenting to.** To prepare your tax return, we use a software feature that performs automated ("artificial intelligence") extraction of the information from the income documents you upload. To do this, we will **disclose the income documents you upload — and the information shown on them — to our technology service provider, Google LLC (processed through Google's Gemini / Google Cloud Vertex AI service)**, solely so that it can read and return the data fields on those documents to us.
>
> **The specific information that will be disclosed** is the content of the W-2, 1099, K-1, and similar income documents you upload for the [TAX_YEAR] tax year, **including your name, your Social Security number or taxpayer identification number, the employer or payer name and identification number, and the dollar amounts reported on those documents.**
>
> **The purpose of the disclosure** is limited to automated extraction of those data fields so that we can accurately prepare and file your [TAX_YEAR] federal (and, where applicable, state) income tax return. The information will not be disclosed for any other purpose.
>
> **Recipient and data handling.** The recipient is **Google LLC** under a written data processing agreement that prohibits the recipient from using your information to train or improve its own products and that is configured for zero data retention. [LEGAL REVIEW — confirm this sentence matches the executed Google DPA and zero-retention configuration before enabling.] The information will be processed within the United States. [LEGAL REVIEW — confirm processing region; if any processing occurs outside the United States, the additional offshore-disclosure statement and SSN-masking rules under Treas. Reg. §301.7216-3(b)(4) must be added.]
>
> **Duration.** Unless you specify a shorter period below, this consent is effective from the date you sign it until **[EXPIRES_DATE]** (one year from signature).
> &nbsp;&nbsp;&nbsp;&nbsp;☐ I want this consent to expire earlier, on: ________________ (date).
>
> **If you believe your tax return information has been disclosed or used improperly** in a manner unauthorized by law or without your permission, you may contact the Treasury Inspector General for Tax Administration (TIGTA) by telephone at **1-800-366-4484**, or by email at **complaints@tigta.treas.gov**.
>
> ---
>
> **Affirmative consent (you must check the box AND sign).**
>
> ☐ **I, [TAXPAYER_FULL_NAME], consent** to the disclosure of my [TAX_YEAR] tax return information to Google LLC for the AI-assisted document extraction purpose described above.
>
> Taxpayer signature: ______________________________  Date: ______________
>
> [IF MFJ] Spouse signature: ______________________________  Date: ______________
>
> ---
>
> *If you do not wish to consent, do not check the box or sign. We will still prepare your return; we will simply enter your document information manually instead of using the automated extraction feature.*

---

> **[LEGAL REVIEW] — Mandatory-language fidelity.** The first two paragraphs (voluntariness + duration) and the TIGTA paragraph track the mandatory statements of **Rev. Proc. 2013-14 §5.04** and **Treas. Reg. §301.7216-3**. Counsel MUST verify each mandated sentence verbatim against the current text of Rev. Proc. 2013-14 (the authoritative copy at the IRS drop site) **before** `ai_extraction_v1` is enabled, including (a) exact wording and **sequence** of the mandatory statements, (b) the TIGTA phone/email (1-800-366-4484 / complaints@tigta.treas.gov), and (c) whether the firm's house standard requires 12-point rather than the 8-point floor. Any edit to this language requires a **version bump** (`ai_extraction_v2`) so prior signatures remain attributable to the exact text signed.

---

## 4. Product-enforcement spec (fail-closed consent gate)

The legal instrument is worthless if the product can transmit without it. This section specifies the engineering that makes the non-compliant path **impossible**, tailored to TaxFlow's actual code paths.

### 4.1 New table: `disclosure_consents`

Add `lib/db/src/schema/disclosure-consents.ts` (mirrors the existing Drizzle/Zod conventions used in `clients.ts` and `audit-log.ts`):

```ts
import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { clientsTable } from "./clients";

/**
 * IRC §7216 disclosure-consent ledger. A row here is the firm's PROOF that a
 * statute-compliant consent (Rev. Proc. 2013-14 / Treas. Reg. §301.7216-3) was
 * obtained BEFORE any tax return information was disclosed to a third party
 * (currently: Google Gemini, scope="ai_extraction"). Append-only; superseding a
 * consent inserts a new row and sets `revokedAt` on the old one — never UPDATE
 * the legal facts of a signed consent.
 */
export const disclosureConsentsTable = pgTable("disclosure_consents", {
  id: serial("id").primaryKey(),
  // taxpayer == the client whose data is disclosed.
  taxpayerId: integer("taxpayer_id").notNull()
    .references(() => clientsTable.id, { onDelete: "restrict" }), // do NOT cascade — keep the proof
  // firmId: the preparer-firm that bears the §7216 obligation. Nullable until
  // multi-tenancy (D15) lands; backfill on tenancy cutover.
  firmId: integer("firm_id"),
  // Scope of the disclosure this consent authorizes. Only "ai_extraction" today.
  scope: text("scope").notNull(), // e.g. "ai_extraction"
  // Exact consent text version the taxpayer signed (e.g. "ai_extraction_v1").
  documentVersion: text("document_version").notNull(),
  // When the taxpayer signed. MUST be <= the first transmission.
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
  // Opaque pointer to the captured signature evidence (e-sign envelope id,
  // hash of signed PDF in object storage, or wet-sign upload doc id).
  signatureRef: text("signature_ref").notNull(),
  // Consent expiry. Default = signedAt + 1 year (Rev. Proc. 2013-14). The gate
  // treats now() > expiresAt as no-consent.
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Set when the taxpayer revokes or a newer version supersedes. NULL = active.
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // Hot path: "does this taxpayer have an active ai_extraction consent right now?"
  lookupIdx: index("disclosure_consents_lookup_idx")
    .on(table.taxpayerId, table.scope, table.expiresAt),
}));

export const insertDisclosureConsentSchema = createInsertSchema(disclosureConsentsTable, {
  scope: z.enum(["ai_extraction"]),
}).omit({ id: true, createdAt: true });
export type DisclosureConsent = typeof disclosureConsentsTable.$inferSelect;
export type NewDisclosureConsent = typeof disclosureConsentsTable.$inferInsert;
```

Then export it from `lib/db/src/schema/index.ts`, run codegen for `openapi.yaml` if the consent CRUD is exposed, and `pnpm --filter @workspace/db run push` (per the project's schema workflow).

### 4.2 The gate predicate

A single, shared helper — the **only** thing any code may call before disclosing to Gemini:

```ts
// artifacts/api-server/src/lib/disclosureConsent.ts
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, disclosureConsentsTable } from "@workspace/db";

/** Returns the active, unexpired, unrevoked consent row, or null. */
export async function getActiveConsent(taxpayerId: number, scope: "ai_extraction") {
  const [row] = await db.select().from(disclosureConsentsTable).where(and(
    eq(disclosureConsentsTable.taxpayerId, taxpayerId),
    eq(disclosureConsentsTable.scope, scope),
    isNull(disclosureConsentsTable.revokedAt),
    gt(disclosureConsentsTable.expiresAt, new Date()),
  )).limit(1);
  return row ?? null;
}

export async function hasActiveConsent(taxpayerId: number, scope: "ai_extraction") {
  return (await getActiveConsent(taxpayerId, scope)) !== null;
}
```

### 4.3 Fail-closed wiring at the transmission point

The disclosure to Google happens in **`artifacts/api-server/src/routes/documents.ts`**, in the upload handler's fire-and-forget extraction block. The gate goes in **two** places (defense in depth):

1. **Reject the upload up front** if no active consent — before the row is even inserted in `processing` state. This gives the CPA an immediate, actionable 403 in the UI rather than a silently-`failed` document:

```ts
// In POST /clients/:clientId/documents, AFTER size/mime/queue checks,
// BEFORE the `db.insert(taxDocumentsTable)...status:"processing"`:
if (!(await hasActiveConsent(params.data.clientId, "ai_extraction"))) {
  res.status(403).json({
    code: "CONSENT_REQUIRED",
    error: "IRC §7216 disclosure consent for AI extraction is missing or expired for this client. " +
           "Capture the signed consent before uploading documents for AI extraction.",
  });
  return;
}
```

2. **Re-check immediately before the Gemini call** inside the async extraction block — because consent could expire/revoke between insert and the actual network call, and because future call sites must not be able to skip the gate. If it fails here, mark the document `failed` (or a new `blocked_no_consent` status) and write an audit row; **never** call `extractW2DataFromFile` / `extract1099DataFromFile` / `extractW2DataFromText` without it:

```ts
// At the very top of the (async () => { ... })() block, before any extractor call:
if (!(await hasActiveConsent(params.data.clientId, "ai_extraction"))) {
  await db.update(taxDocumentsTable)
    .set({ status: "failed" }) // or a dedicated "blocked_no_consent"
    .where(eq(taxDocumentsTable.id, doc.id));
  await writeAudit({
    clientId: params.data.clientId, action: "update", entityType: "tax_document",
    entityId: doc.id, source: "§7216 gate: consent missing/expired — extraction blocked",
  });
  return; // <-- hard stop: no transmission to Google
}
```

> **Belt-and-suspenders option:** put the gate inside the extractor functions themselves (pass `clientId` into `extractW2DataFromFile` etc. and assert consent there), so the AI client **physically cannot** be invoked without a consent check. This is the strongest design and is recommended once the call signatures are refactored.

### 4.4 Required test coverage (matches the project's hand-calc/no-API discipline)

Add a no-API suite `tax-engine-consent-gate-tests.ts` (and register it in `scripts/tsconfig.json`'s `exclude`):

- Upload with **no** consent row → 403 `CONSENT_REQUIRED`; **no** Gemini call made; document never reaches `pending_review`.
- Upload with an **expired** consent (`expiresAt < now`) → 403; blocked.
- Upload with a **revoked** consent (`revokedAt` set) → 403; blocked.
- Upload with a **valid** consent → extraction proceeds; document reaches `pending_review`.
- `signedAt` after first transmission attempt is impossible by construction (gate runs before transmit) — assert the ordering invariant.
- Scope isolation: a consent with `scope` other than `ai_extraction` does **not** authorize extraction.

### 4.5 Storage, retention, and audit

- **Retention.** Keep `disclosure_consents` rows and the underlying signed artifact (`signatureRef` target) for **at least the firm's records-retention period** — recommend **7 years** to align with IRS examination windows. **[LEGAL REVIEW]** confirm the firm's retention policy. Do **not** cascade-delete consents when a client is deleted (`onDelete: "restrict"`); the proof must outlive the client row, exactly as the `audit_log` table deliberately survives client deletion.
- **Audit.** Every consent capture, expiry, and revocation writes an `audit_log` row (reuse `writeAudit`). Every blocked extraction writes an audit row (§4.3). This gives the firm a defensible "we never disclosed without consent" trail for a §7216 inquiry.
- **Revocation UX.** A taxpayer (via the CPA) can revoke: set `revokedAt = now()`. The next upload is gated immediately. Already-extracted data stays (the disclosure already lawfully occurred under the then-valid consent); only future disclosures stop.
- **Signature evidence.** `signatureRef` should point at immutable evidence: an e-signature provider envelope ID, or a hash + object-storage key of the countersigned consent PDF. Store the **rendered consent text** (not just the version string) alongside it so the firm can produce exactly what the taxpayer saw. **Do not** store the signed consent as base64 plaintext in a text column the way `tax_documents.file_content` does today — that is a known PII-at-rest defect being remediated in the same P0 batch.

---

## 5. Vendor / DPA checklist (get OFF the free Gemini tier)

A perfect consent does not cure the **free-tier training-terms problem.** If Google may use the submitted W-2/1099 data to improve its products, the disclosure exceeds the "prepare the return" purpose and cannot be saved by consent or by the contractor path (§6). **All of the following must be true before AI extraction is enabled for any real taxpayer PII:**

- [ ] **Move off the free Gemini tier** onto terms that **contractually prohibit training on, and retention of, submitted data.** The two acceptable targets:
  - **Google Cloud Vertex AI** (Gemini models) under the **Google Cloud Platform Terms + Data Processing Addendum**, which by default do **not** use customer data to train Google's models; or
  - The **paid Gemini API** under Google's enterprise/paid data-governance terms (not the free "AI Studio"/free-tier terms that permit product-improvement use).
  **[LEGAL REVIEW]** Counsel to confirm the chosen product's current terms actually carry the no-training / processor commitments.
- [ ] **Execute a Data Processing Agreement (DPA)** / Cloud Data Processing Addendum with Google that names the firm (or TaxFlow as processor on the firm's behalf — clarify the chain) as controller and Google as **processor/sub-processor**, with use limited to providing the service.
- [ ] **Configure zero / minimal data retention** (e.g., Vertex AI data-retention controls; disable prompt logging / "prompt caching" persistence of customer content; opt out of human review). Capture the configuration as evidence.
- [ ] **Pin the processing region to the United States** (or accept the offshore consequences in §2 and the consent's offshore clause). Record the region in the consent text.
- [ ] **Name Google as a sub-processor in the WISP** (`docs/compliance/wisp.md`) under the FTC Safeguards Rule's **service-provider oversight** requirement (16 CFR §314.4(f)): written contract, security-requirement flow-down, and periodic reassessment.
- [ ] **Bind the contractor to §7216.** Under the auxiliary-services path (§6), any contractor receiving return information must be **bound to the same §7216 use/redisclosure limits** as the preparer; the DPA must reflect that. The free tier cannot satisfy this.
- [ ] **Encrypt in transit (already HTTPS to Google) and confirm no plaintext logging** of document content on TaxFlow's side (the extractor currently embeds the full base64 in the request; ensure request bodies are not logged — see Pino config).
- [ ] **Record the vendor decision and DPA execution date** in the WISP's service-provider register, and re-review annually.

Until every box is checked, the AI-extraction feature stays **disabled in production** (the §4 gate plus an environment flag — extend the existing settings/feature-flag pattern, e.g., an `AI_EXTRACTION_ENABLED` gate analogous to `PRO_TIER_ENABLED`).

---

## 6. "Auxiliary services" §301.7216-2(d) analysis — and why explicit consent is the safe choice

**The question.** Treas. Reg. §301.7216-2(d) permits a preparer to disclose return information **without the taxpayer's consent** to another person who provides **"auxiliary services in connection with the preparation of tax returns"** — i.e., a contractor doing back-office work to help prepare *this taxpayer's* return. One could argue Google Gemini, doing OCR/extraction, is such an auxiliary-services contractor and that no §7216 consent is needed.

**Why TaxFlow should NOT rely on it.**

1. **The free-tier training use breaks the path entirely.** The auxiliary-services exception covers disclosure to a contractor **for the purpose of preparing the return**. The moment Google may **use the data to improve its own products**, the disclosure is no longer solely for preparing this taxpayer's return — it is a separate, prohibited use. The §301.7216-2(d) safe harbor does **not** authorize the vendor to repurpose the data. So on the *current free tier*, the auxiliary-services path is unavailable regardless. (This is the same fact pattern that forces §5.)

2. **The contractor must be bound under §7216.** The auxiliary-services path requires the contractor to be subject to the §7216 use/redisclosure restrictions (the contractor is itself treated as bound). A free-tier click-through with product-improvement rights is the opposite of a §7216-bound processor. Only a paid, DPA-backed, no-training arrangement (§5) could even *begin* to qualify.

3. **Even with a clean DPA, the safe-harbor scope is contested for generative-AI vendors.** The "auxiliary services" concept was written for traditional outsourcing (typing, software hosting, administrative support). Whether sending full unredacted SSNs to a large-language-model provider falls inside it — particularly given evolving IRS scrutiny of AI and offshore processing — is **not settled.** Relying on an aggressive reading exposes the firm to criminal §7216 liability if the IRS disagrees.

4. **Consent costs almost nothing and is unimpeachable.** A statute-compliant, affirmatively-signed consent (§3) authorizes the disclosure **on its own terms**, independent of whether the auxiliary-services argument would have worked. It is the belt; the DPA/no-training posture is the suspenders.

**Conclusion (product policy).** TaxFlow obtains **explicit, written, signed §7216 consent (§3) for every taxpayer** before any AI extraction, **and** independently puts the vendor on §5-compliant terms. The product does **not** rely on the §301.7216-2(d) auxiliary-services exception as its legal basis. **[LEGAL REVIEW]** Counsel may conclude the auxiliary-services path adds a useful secondary argument once the DPA/no-training posture is in place; if so, document that as a fallback — but the primary, enforced basis is consent.

---

## 7. Go-live checklist (the gate before real PII)

1. [ ] `disclosure_consents` table created, migrated, exported (§4.1).
2. [ ] Consent gate wired fail-closed at both the upload handler and the pre-Gemini call site; 403 `CONSENT_REQUIRED` on absence (§4.3).
3. [ ] No-API consent-gate test suite green and registered in `scripts/tsconfig.json` (§4.4).
4. [ ] Verbatim consent text (`ai_extraction_v1`) **legal-reviewed** and frozen (§3).
5. [ ] Off the free Gemini tier; DPA executed; zero-retention + no-training confirmed; US region pinned (§5).
6. [ ] Google named as sub-processor in the WISP; service-provider register updated (§5).
7. [ ] Retention policy (≥7 yrs) and revocation flow implemented; consents survive client deletion (§4.5).
8. [ ] Production feature flag for AI extraction defaults **off** until 1–7 are signed off by the Qualified Individual.

> **[LEGAL REVIEW]** Items 4, 5, and 6 require counsel and the Qualified Individual sign-off in writing before flipping the feature flag.

---

## Sources

- [Rev. Proc. 2013-14 (IRS drop file, PDF)](https://www.irs.gov/pub/irs-drop/rp-13-14.pdf)
- [IRS — Section 7216 Information Center](https://www.irs.gov/tax-professionals/section-7216-information-center)
- [26 CFR §301.7216-3 — Disclosure or use permitted only with the taxpayer's consent (Cornell LII)](https://www.law.cornell.edu/cfr/text/26/301.7216-3)
- [26 CFR §301.7216-2 — Permissible disclosures or uses without consent of the taxpayer (Cornell LII)](https://www.law.cornell.edu/cfr/text/26/301.7216-2)
- [The CPA Journal — Getting Taxpayers' Consent to Disclose or Use Tax Return Information under IRC Section 7216](https://www.cpajournal.com/2019/12/03/getting-taxpayers-consent-to-disclose-or-use-tax-return-information-under-irc-section-7216/)
- [The Tax Adviser — The many implications of Sec. 7216](https://www.thetaxadviser.com/issues/2024/jan/the-many-implications-of-sec-7216/)
- [Baker Newman Noyes — Disclosure Consent Forms (Sec. 7216) Explained — Q&A](https://www.bnncpa.com/resources/disclosure-consent-forms-sec-7216-explained-qa/)
- [U.S. Treasury Inspector General for Tax Administration (TIGTA) — Submit a Complaint](https://www.tigta.gov/reportcrime-misconduct)
- IRS Pub 4557 (*Safeguarding Taxpayer Data*) and IRS Pub 5708 (tax-pro WISP template) — companion guidance referenced in `docs/compliance/wisp.md`.
