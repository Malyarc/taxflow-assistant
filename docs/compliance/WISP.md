# TaxFlow Assistant — Written Information Security Plan (WISP)

> **Status: DRAFT — pending [LEGAL REVIEW] and ownership sign-off.** This is a working draft prepared by engineering to satisfy the FTC Safeguards Rule and the IRS data-security-plan attestation. It describes both the **current (deficient) state** and the **target state** so the remediation is auditable. It must be reviewed by qualified counsel before it is relied upon, attested to at PTIN renewal, or represented to any customer. Do not represent any control in this document as "implemented" in customer-facing material until the compliance-status table in §9 shows it `Implemented` **and verified**.

- **Document owner:** [NAME / role — proposed: the Designated Qualified Individual, see §2]
- **Version:** 0.1 (initial draft)
- **Effective date:** [DATE — on ownership sign-off]
- **Last reviewed:** 2026-06-03
- **Next scheduled review:** [DATE — annually, and after any material change; see §8]
- **Classification:** Internal — Confidential

---

## 1. Purpose, Scope, and Legal Basis

### 1.1 Purpose

This Written Information Security Plan ("WISP") documents the administrative, technical, and physical safeguards TaxFlow Assistant ("TaxFlow," "we," "the company") maintains to protect the confidentiality, integrity, and availability of **customer information** — in particular, federal tax return information and the personally identifiable information (PII) of taxpayers whose returns are prepared or analyzed using the TaxFlow platform.

This plan is the single source of truth for "what security controls TaxFlow operates and who is accountable for them." It is intended to be a living document, reviewed at least annually and updated whenever the system materially changes.

### 1.2 Scope

This WISP covers all systems, data, personnel, and service providers involved in handling customer information, including:

- **Application backend** — the Node 22 + Express 5 + Drizzle ORM API server, currently running under pm2 on a single AWS EC2 instance in `us-east-2` (host `ec2-18-188-192-154`), serving on port 8080.
- **Application frontend** — the React/Vite single-page app served as static assets by the same API server.
- **Primary datastore** — the PostgreSQL database hosted on **Neon** (serverless, internet-reachable), holding all client, return, W-2, 1099, K-1, and uploaded-document data across 13 tables.
- **Document content** — uploaded W-2 / 1099 / K-1 / other tax documents, currently stored as base64-encoded plaintext in the `tax_documents.file_content` column.
- **PII data elements** — including, at minimum, taxpayer and spouse SSNs (`w2_data.employee_ssn`), payer/recipient TINs (`form_1099_data.payer_tin`, `form_1099_data.recipient_tin`), names, addresses, email, and full income/return detail.
- **AI document-extraction pipeline** — the path that transmits uploaded document content to **Google Gemini** (model `gemini-2.5-flash`) via the OpenAI SDK pointed at Google's OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`).
- **Infrastructure providers** — AWS (EC2, and target-state S3/KMS/ALB), Neon (DB), Google (AI sub-processor).
- **Source control** — the `github.com/Malyarc/taxflow-assistant` repository and its CI/CD.
- **All personnel and contractors** with access to any of the above.

The scope explicitly includes the period during which TaxFlow operates as a pilot/design-partner product. **The Safeguards Rule applies regardless of revenue, customer count, or "demo" status.** A "demo" banner does not remove the obligation; if real taxpayer data is uploaded, every requirement below is live.

### 1.3 Legal Basis

TaxFlow is a provider of tax-preparation and tax-planning software that handles federal tax return information on behalf of, and as an extension of, professional tax-return preparers. The following authorities apply:

1. **FTC Safeguards Rule, 16 CFR Part 314**, promulgated under the Gramm-Leach-Bliley Act (GLBA), 15 U.S.C. §§ 6801–6809. Tax-return preparers are "financial institutions" under 16 CFR § 314.2 and Appendix B examples. The amended Rule (full-compliance deadline **June 9, 2023**) requires a written information security program that includes: a designated **Qualified Individual** (§ 314.4(a)); a **written risk assessment** (§ 314.4(b)); **safeguards** including access controls, encryption of customer information **in transit and at rest** (§ 314.4(c)(3)) or written compensating controls reviewed and approved by the Qualified Individual, **MFA** (§ 314.4(c)(5)), secure disposal (§ 314.4(c)(6)), change management (§ 314.4(c)(7)), and logging/monitoring of authorized-user activity (§ 314.4(c)(8)); **periodic testing** — continuous monitoring or annual penetration testing plus biannual vulnerability assessments (§ 314.4(d)); **personnel training** (§ 314.4(e)); **service-provider oversight** (§ 314.4(f)); a written **incident response plan** (§ 314.4(h)); a written **annual report** to ownership/board by the Qualified Individual (§ 314.4(i)); and **breach notification to the FTC** within 30 days of discovery of a security event involving the unencrypted information of **500 or more consumers** (§ 314.5, effective May 13, 2024).

2. **IRS data-security obligations.** The IRS requires paid preparers to have and maintain a written data-security plan and to **attest** to it at PTIN renewal. **IRS Publication 5708** is the WISP template this document is structured on; **IRS Publication 4557, "Safeguarding Taxpayer Data,"** is the companion guidance. The IRS Security Summit and "Taxes-Security-Together" framework apply.

3. **IRC § 7216 (criminal) and IRC § 6713 (civil), with Treas. Reg. §§ 301.7216-1/-2/-3.** A tax-return preparer who knowingly or recklessly discloses or uses tax return information other than as permitted is subject to **criminal penalties of up to $1,000 and/or one year imprisonment per disclosure** (§ 7216) and **civil penalties of $250 per disclosure, capped at $10,000 per year** (§ 6713). Transmitting return information to a third-party service provider (e.g., Google Gemini) is a **"disclosure."** For Form 1040-series returns, taxpayer consent to disclose must follow the **mandatory format in Rev. Proc. 2013-14**: a separate, signed-and-dated document executed **before** disclosure, identifying the recipient, the specific information, the purpose, and the duration, including the mandatory statutory statements. The § 301.7216-2(d) "auxiliary services" / contractor path does **not** cover a vendor using the data to improve its own products/models and requires the contractor to be contractually bound by § 7216 — directly implicating TaxFlow's current free-tier Gemini terms.

4. **State data-protection and breach-notification laws** of every state in which an affected taxpayer resides (all 50 states + D.C. have breach-notification statutes; several — e.g., MA 201 CMR 17.00, NY SHIELD Act, the CCPA/CPRA — impose affirmative safeguard duties).

**Conflict / non-representation note:** Where this WISP describes a target control that is not yet implemented, TaxFlow will not represent that control as operational in any contract, marketing, or customer attestation. Several current customer-facing documents in this repository assert "TLS in transit" and "DB-layer encryption at rest" — those statements are **false today** and must be corrected (P0-7) to avoid an FTC Act § 5 deception exposure layered on top of the underlying security gap.

---

## 2. Designated Qualified Individual

Per 16 CFR § 314.4(a), TaxFlow designates a single **Qualified Individual (QI)** responsible for overseeing, implementing, and enforcing this information security program.

- **Qualified Individual:** [NAME], [ROLE — proposed: Founder / Head of Engineering]
- **Contact:** [EMAIL] / [PHONE]
- **Reports to (ownership/board):** [NAME / role]
- **Appointed:** [DATE]

If any safeguard responsibility is delegated to a service provider, the QI retains accountability and must document the oversight (§ 5).

### 2.1 Responsibilities of the Qualified Individual

1. Own and maintain this WISP; review it at least annually and after any material change (§ 8).
2. Conduct and document the written risk assessment (§ 3) and keep it current.
3. Approve, in writing, any **compensating control** used in lieu of encryption in transit or at rest (16 CFR § 314.4(c)(3)). **No such written approval currently exists; the current plaintext-at-rest and HTTP-in-transit posture is therefore non-compliant, not a sanctioned compensating control.**
4. Oversee service-provider due diligence and contracts (§ 5), including the Google DPA + no-training terms and the § 7216 contractor binding.
5. Own the incident response plan (§ 6); serve as incident commander or name a deputy.
6. Ensure MFA, access controls, encryption, logging, change management, and disposal/retention controls are implemented and tested.
7. Ensure personnel training is delivered and recorded (§ 7).
8. Deliver a **written annual report** to ownership covering the program's status, risk-assessment results, testing results, incidents, and recommended changes (16 CFR § 314.4(i)).
9. Gate every transmission of return information to a third party behind a valid § 7216 consent and approved sub-processor terms.

---

## 3. Written Risk Assessment

Per 16 CFR § 314.4(b), this section identifies reasonably foreseeable internal and external risks to the confidentiality, integrity, and availability of customer information, assesses the sufficiency of existing safeguards, and maps each risk to the remediation that closes it.

**Methodology.** Risks are scored on **Likelihood** (Low / Medium / High / Certain) and **Impact** (Low / Moderate / High / Severe). Impact reflects the regulated nature of the data: any exposure of unencrypted SSN/TIN or full return information is a reportable breach and a potential § 7216 violation, so most impacts are High/Severe. The "P0 item" column references the company's prioritized remediation plan (`docs/product-assessment-2026-06-02.md`, §P0).

> **Assessment date:** 2026-06-03. **Assessor:** [Qualified Individual]. **Re-assessment cadence:** at least annually and on material change.

### 3.1 Risk Register

| ID | Risk (current condition, verified in code/infra) | Likelihood | Impact | Residual rating | Remediation (target control) | Closes via |
|---|---|---|---|---|---|---|
| **R-1** | **No authentication on any endpoint.** All ~79 API routes are unauthenticated; `artifacts/api-server/src/middlewares/` contains only an empty `.gitkeep`. `clientId` is the only access boundary and is fully attacker-controlled. `GET /clients` returns the entire client roster; `GET /clients/:clientId/documents/:documentId/content` streams any uploaded tax document (base64) to anyone who reaches the box. Full read **and write**. | High | Severe | **Critical** | Gate the entire `/api` surface behind authentication: shared-secret bearer token + Cloudflare Access (or equivalent IdP) in the near term; per-firm/per-user auth with row-level tenancy scoping at GA. Deny-by-default; least privilege. | **P0-4** |
| **R-2** | **No TLS — cleartext HTTP.** The box serves HTTP on :8080; :443 is closed. Helmet HSTS is deliberately disabled (`hsts: false`, `artifacts/api-server/src/app.ts`) and `upgradeInsecureRequests` is overridden off because there is no TLS terminator. SSNs, EINs, and full scanned documents cross the wire in plaintext. | High | Severe | **Critical** | Terminate TLS via AWS ALB + ACM certificate (or nginx + certbot / Cloudflare). Re-enable HSTS (`maxAge` 1yr, `includeSubDomains`, `preload`) and remove the `upgradeInsecureRequests` override once :443 is live. Redirect 80→443. | **P0-4** |
| **R-3** | **Plaintext PII at rest in Postgres.** SSN (`w2_data.employee_ssn`), payer/recipient TINs (`form_1099_data.payer_tin` / `recipient_tin`), and all return detail are stored as plaintext `text` columns. No field-level encryption. | Certain (state, not event) | Severe | **Critical** | Field-level encryption of SSN/TIN and other high-sensitivity identifiers using **AES-256-GCM** with keys from **AWS KMS** (envelope encryption / pgcrypto with KMS-wrapped DEK). Application encrypts on write, decrypts on read for authorized callers only. | **P0-5** |
| **R-4** | **Plaintext tax documents in Postgres.** Entire uploaded W-2/1099/K-1 PDFs and images are stored base64 in `tax_documents.file_content`. A single DB read exfiltrates complete source documents. | Certain (state, not event) | Severe | **Critical** | Move document blobs **out of the DB** to **Amazon S3 with SSE-KMS**; store only an S3 object key + metadata in Postgres; serve via **short-lived signed URLs** behind auth. Encrypt any transitional DB-resident blob field with AES-256-GCM until migration completes. | **P0-5** |
| **R-5** | **Two leaked, unrotated production credentials.** The Neon `neondb_owner` DB password and the Google Gemini API key are leaked and **still pending rotation** as of the 2026-06-02 handoff. Neon is internet-reachable, so this is a **live, ongoing exposure of the production database independent of the EC2 box.** | High | Severe | **Critical — ACTIVE INCIDENT** | **Rotate both credentials immediately** (Neon console + Google AI Studio). Scrub history. Move all secrets to **AWS Secrets Manager / SSM Parameter Store**; remove from env/process baking and from any committed file. Treat as a potential reportable event under § 6 until scoped. | **P0-1** |
| **R-6** | **PII disclosure to Google Gemini without § 7216 consent or compliant terms.** The full, **unredacted** W-2/1099/K-1 document is transmitted to Gemini for extraction; the only "consent" is a one-line UI banner; `"7216"` appears nowhere in the repository. The Gemini free tier's terms permit Google to use submitted data to improve its products — incompatible with both § 7216 and the § 301.7216-2(d) contractor path. | High | Severe | **Critical** | (a) Implement a **§ 7216 consent gate** in **Rev. Proc. 2013-14 format** — a separate, signed, per-taxpayer, pre-disclosure consent, stored and versioned, that **blocks** any Gemini transmission until executed; (b) execute a **Google Cloud DPA** and move to **paid, no-training** terms (and ideally Vertex AI with data-governance commitments); (c) consider redaction/tokenization of SSN/TIN before transmission. | **P0-2** |
| **R-7** | **Single-box, no disaster recovery.** No IaC, no tested RTO/RPO, Neon PITR not configured, prod schema mutated via `drizzle-kit push` (which the project's own `drizzle.config.ts` warns reads a rename as drop+add = **silent irreversible PII loss**), no soft-delete despite 3-yr/7-yr retention norms. | Medium | High | **High** | Configure Neon PITR/backups with documented RTO/RPO; move prod schema changes to **versioned migrations** (`migrate`, not `push`) after a one-time baseline; add soft-delete/tombstoning for retention + right-to-erasure; capture infra as code. | **P0-5 / roadmap DR** |
| **R-8** | **No breach detection, scoping, or notification capability.** No per-record access log; no monitoring; no IRP runbook. If R-1/R-5 are exploited there is no way to know, scope who was exposed, or meet 30-day FTC / IRS / state notification duties. | Medium | Severe | **High** | Implement logging/monitoring of authorized-user and data-access activity (§ 314.4(c)(8)); centralize logs; build the **Incident Response Plan** in § 6 with a notification matrix; add per-record access audit trail (the `audit_log` table exists but `actor_user_id` is an orphan today). | **P0-4/6 + §6** |
| **R-9** | **No CI / merge protection; tests excluded from typecheck.** Schema/PII-handling changes can ship without typecheck or the no-API test suite running; the test files are excluded from the typecheck config ("green on wrong shape"). | Medium | Moderate | **Medium** | **CI on GitHub Actions** running typecheck + the no-API suite on every PR with branch protection; add a `tsconfig.tests.json` that **includes** test files. Protects the engine and prevents regressions in safeguard code. | **P0-6** |
| **R-10** | **False customer-facing security claims.** Partner/marketing docs assert "TLS in transit," "DB-layer encryption at rest," and "read-only demo credentials" that do not exist — an FTC Act § 5 deception exposure and a liability-transfer risk if a CPA relies on them for their own Safeguards compliance. | High | High | **High** | Correct all customer-facing docs to match reality; never advertise a control before §9 shows it `Implemented` and verified. | **P0-7** |
| **R-11** | **Unauthenticated O(N) compute fan-outs.** `/planning-hit-list` and `/peer-benchmark` load every client and run the engine per client — a cheap DoS amplifier; `/peer-benchmark` is also a latent cross-tenant PII leak once tenancy exists. | Medium | Moderate | **Medium** | Put behind auth (R-1); add rate limiting + pagination; rewrite `/peer-benchmark` to scope to the caller's tenant before tenancy lands. | **P0-4 + roadmap** |
| **R-12** | **Insider / credential-theft / device loss.** Developer laptop, GitHub account, or AWS/Neon/Google console compromise. No MFA enforcement documented across all consoles; broad personal access today. | Medium | High | **High** | Enforce MFA on GitHub, AWS, Neon, Google, and the application (§ 4); least-privilege IAM; secrets in Secrets Manager (R-5); full-disk encryption + screen lock on all devices; offboarding checklist. | **P0-1/4 + §4** |

### 3.2 Assessment Summary

The current residual risk posture is **Critical**. Six Critical risks (R-1 through R-6) reflect a system that, as of this assessment, is **not suitable for processing real taxpayer PII.** Until the P0 remediation closes R-1 through R-6, TaxFlow must operate in **demo-only** mode with synthetic data, and the "do not upload real tax documents" banner must remain enforced operationally (not merely displayed). The QI must not authorize real-client onboarding until §9 reflects closure of the Critical items.

---

## 4. Safeguards

Per 16 CFR § 314.4(c). Each subsection states the **current state**, the **target control**, and the closing P0 item.

### 4.1 Access Control (§ 314.4(c)(1), (c)(3)(i))

- **Current:** None. No authentication; `clientId` is attacker-controlled; full read/write to anyone reaching :8080. `audit_log.actor_user_id` is a nullable orphan; there is no user/firm model.
- **Target:**
  - **Deny-by-default** on the entire `/api` surface. Near-term: a **shared-secret bearer token** required on all requests, plus **Cloudflare Access** (or an IdP) in front of the box restricting who can reach it.
  - **Least privilege:** application DB role scoped to only the operations it needs; no use of the Neon owner role from the app at runtime; separate admin credentials held only by the QI in Secrets Manager.
  - **GA:** per-firm / per-user identities with **row-level tenancy scoping** so a user sees only their firm's clients; `audit_log.actor_user_id` populated on every mutating call.
  - Periodic access reviews (quarterly) by the QI.
- **Closes:** R-1, R-11, R-12 · **P0-4**

### 4.2 Encryption in Transit (§ 314.4(c)(3)(ii))

- **Current:** None. HTTP-only; HSTS disabled; PII and documents in cleartext on the wire.
- **Target:** **TLS 1.2+** for all external traffic, terminated at **AWS ALB + ACM** (or nginx + certbot / Cloudflare). HSTS re-enabled (`maxAge` ≥ 1 year, `includeSubDomains`, `preload`); 80→443 redirect; remove the `upgradeInsecureRequests` override in `app.ts`. TLS also enforced on the DB connection to Neon (`sslmode=require`/`verify-full`) and to the Google API endpoint (already HTTPS).
- **Closes:** R-2 · **P0-4**

### 4.3 Encryption at Rest (§ 314.4(c)(3)(iii))

- **Current:** None at the application/field layer. SSN/TIN are plaintext `text`; documents are plaintext base64 in Postgres. No QI-approved compensating control exists.
- **Target:**
  - **Field-level encryption** of SSN/TIN and other high-sensitivity identifiers using **AES-256-GCM** (authenticated encryption; unique IV per value; no ECB/CBC-without-MAC). Data-encryption keys are **wrapped by AWS KMS** (envelope encryption); the KMS CMK has rotation enabled and tightly scoped key policies. Decryption only for authenticated, authorized callers; never logged.
  - **Documents to S3 + SSE-KMS**, served via short-lived signed URLs behind auth; DB holds only the object key.
  - Neon storage-level encryption is provided by the platform but is **not sufficient by itself** for SSN/TIN under § 314.4(c)(3); field-level encryption is required so a DB-credential compromise (R-5) does not yield plaintext identifiers.
- **Closes:** R-3, R-4 · **P0-5**

### 4.4 Multi-Factor Authentication (§ 314.4(c)(5))

- **Current:** Not enforced in the application (no login at all). Console MFA status across GitHub/AWS/Neon/Google not documented.
- **Target:**
  - **MFA required** for any individual accessing customer information or the systems that process it — enforced in the application login (at GA) and on every administrative console (**GitHub, AWS, Neon, Google AI Studio / Google Cloud**) now.
  - The QI verifies MFA enrollment for all personnel as part of onboarding and the quarterly access review.
- **Closes:** R-1, R-12 · **P0-4 + §4.1**

### 4.5 Secure Disposal and Retention (§ 314.4(c)(6))

- **Retention schedule:**
  - **§ 7216 consents:** retain for the period required to substantiate the disclosure — **minimum 3 years** from the latest of the return's due date or filing date (align to the preparer record-retention norm); store the signed, versioned consent immutably.
  - **Tax workpapers / return data / extracted documents:** **7 years** (standard workpaper retention), unless a longer period is required by an engagement or law.
  - **Source documents in S3:** retained per the same 7-year schedule, then disposed of securely.
- **Disposal:**
  - Implement **soft-delete/tombstoning** plus a scheduled hard-purge job that runs after the retention period and on a verified **right-to-erasure** request (subject to legal-hold and § 7216/workpaper minimums).
  - Hard deletion = delete the S3 object (and crypto-shred by destroying the per-record/per-tenant KMS data key where envelope encryption permits) **and** the DB row; record the disposal in the audit log.
  - Securely wipe/encrypt any decommissioned EC2 volumes and backups.
- **Current gap:** no soft-delete, no purge job, no documented retention enforcement (R-7). · **P0-5 + roadmap DR**

### 4.6 Change Management (§ 314.4(c)(7))

- **Current:** Prod schema mutated via `drizzle-kit push` (data-loss-prone on renames); no CI gate; tests excluded from typecheck.
- **Target:**
  - **Versioned migrations** (`migrate`) only against prod, after a one-time baseline of the Neon prod DB; never `push` against prod.
  - **CI on GitHub Actions** running typecheck + the no-API test suite on every PR; **branch protection** requiring green CI and review before merge to `main`.
  - Code review required for any change touching auth, encryption, the § 7216 gate, secrets handling, or PII columns.
  - Infrastructure changes captured as code (IaC) where feasible.
- **Closes:** R-7 (schema), R-9 · **P0-6**

### 4.7 Logging and Monitoring (§ 314.4(c)(8))

- **Current:** Pino request logging exists; there is no per-record data-access audit trail and no centralized monitoring/alerting. `audit_log.actor_user_id` is unused.
- **Target:**
  - Log authorized-user activity and **access to customer information** (who read/exported which client's data), with `actor_user_id` populated once auth lands.
  - Centralize and retain logs (e.g., CloudWatch) with integrity protection; alert on anomalies (mass document downloads, repeated auth failures, fan-out endpoints).
  - Never log secrets, SSN/TIN plaintext, or full document content.
  - Logs feed the IRP detection step (§ 6).
- **Closes:** R-8, supports R-1/R-11 · **P0-4/6**

---

## 5. Service-Provider Oversight

Per 16 CFR § 314.4(f), TaxFlow must select and retain service providers capable of maintaining appropriate safeguards, require those safeguards by contract, and periodically assess them. The following is the current sub-processor inventory and due-diligence status.

| Provider | Service / data exposure | Contract / DPA status | Due-diligence requirement | Owner |
|---|---|---|---|---|
| **Google (Gemini / `gemini-2.5-flash`)** | **AI sub-processor.** Receives the **full unredacted** W-2/1099/K-1 document content for extraction. Currently on a **free tier whose terms permit Google to use submitted data to improve its products** — incompatible with § 7216 and § 301.7216-2(d). | **NON-COMPLIANT — must remediate before any real PII.** | Execute a **Google Cloud Data Processing Addendum**; move to **paid, no-training / no-human-review** terms (and preferably **Vertex AI** with enterprise data-governance and a documented data-retention/zero-retention setting); confirm the provider is contractually **bound to § 7216 confidentiality**; verify SOC 2 / ISO 27001 posture; gate all transmissions behind the § 7216 consent (R-6). Consider SSN/TIN redaction before send. | QI |
| **Neon** | **Primary database** (serverless Postgres), internet-reachable, holds **all** client/return/document data including plaintext SSN/TIN and base64 documents today. | DPA: **[CONFIRM/EXECUTE]**. Credentials currently **leaked + unrotated** (R-5). | Execute/confirm Neon DPA + security commitments (SOC 2 Type II, encryption, breach-notification SLA); **rotate `neondb_owner`**; enforce `sslmode=verify-full`; restrict network access / IP allowlist where supported; enable PITR/backups; scope app to a least-privilege role. | QI |
| **AWS (EC2; target S3 / KMS / ALB / ACM / Secrets Manager)** | Compute host today; target encryption, object storage, secrets, and TLS termination. | Covered by the AWS Customer Agreement + AWS GDPR DPA; **[CONFIRM acceptance]**. | Confirm DPA; enable CloudTrail; least-privilege IAM with MFA; KMS key policies scoped; Secrets Manager for all secrets; document the shared-responsibility boundary. | QI |
| **GitHub (Microsoft)** | Source control + CI/CD. Should hold **no** customer PII (verify history is clean of leaked secrets after rotation). | Covered by GitHub/Microsoft DPA; **[CONFIRM]**. | Enforce MFA + branch protection; secret-scanning + push protection enabled; verify no PII/secrets in history; least-privilege collaborator access. | QI |
| **Cloudflare (target — Access / TLS)** | Target IdP gate + TLS, if used for R-1/R-2. | **[EXECUTE DPA if adopted].** | DPA + security review before routing customer traffic. | QI |

**Process:** No new service provider that will touch customer information may be onboarded without QI approval, a signed DPA, a § 7216 assessment (for any provider receiving return information), and an entry in this table. Providers are re-assessed at least annually.

---

## 6. Incident Response Plan

Per 16 CFR § 314.4(h). This plan governs detection, containment, eradication, recovery, notification, and post-incident review for any **security event** (unauthorized access to, or disclosure/acquisition/use of, customer information or the systems holding it).

### 6.1 Roles

- **Incident Commander:** the **Qualified Individual** (or named deputy [NAME]). Owns the response, declares severity, authorizes containment, and signs the post-mortem.
- **Technical lead:** [NAME] — executes containment/forensics.
- **Legal / regulatory:** [LEGAL REVIEW — outside counsel] — owns notification-obligation determinations.
- **Communications:** [NAME] — customer/preparer and (if required) regulator/public communications.

### 6.2 Severity and Triggers

- **SEV-1 (confirmed/likely exposure of customer PII or return information):** e.g., exploited no-auth endpoint, confirmed DB access via leaked credential, document exfiltration, or impermissible § 7216 disclosure. → full IRP + notification analysis.
- **SEV-2 (security weakness or near-miss without confirmed data exposure):** e.g., leaked-but-unrotated credential with no evidence of use (the **current R-5 condition** is at least SEV-2 and must be treated as a potential SEV-1 until scoped).
- **SEV-3 (low-impact/informational).**

### 6.3 Response Steps

1. **Detection.** Sources: log/monitoring alerts (§ 4.7), provider notification (Neon/Google/AWS), secret-scanning, customer report, or staff discovery. Anyone who suspects an incident notifies the QI immediately at [EMAIL/PHONE].
2. **Triage & declare.** QI assigns severity and opens an incident record (timeline, scope, actions).
3. **Containment.** Immediate actions per scenario: **rotate/revoke** affected credentials (Secrets Manager); block offending access (Cloudflare Access / security group); disable affected endpoints; suspend Gemini transmissions if the AI path is implicated; isolate the EC2 instance / fail over.
4. **Eradication & recovery.** Remove the root cause (patch, close the auth/TLS gap, rotate keys, restore from clean PITR backup). Validate integrity before restoring service.
5. **Scoping.** Using access logs (§ 4.7) and DB/S3 records, determine **which taxpayers and how many** had unencrypted information accessed or acquired. **Note:** today the company **cannot reliably scope** an incident (R-8) — closing R-8 is a prerequisite to meeting notification duties.
6. **Notification** (see matrix below) — on counsel's direction.
7. **Post-mortem.** Within [10 business days] of closure, the QI produces a written post-mortem (timeline, root cause, blast radius, corrective actions, WISP/risk-assessment updates) and reports to ownership.

### 6.4 Breach-Notification Matrix

> All timelines run from **discovery**. Counsel ([LEGAL REVIEW]) confirms applicability for each incident; this matrix is operational guidance, not legal advice.

| Recipient | Trigger | Deadline | Authority / notes |
|---|---|---|---|
| **FTC** | Security event involving the **unencrypted** customer information of **≥ 500 consumers** | **No later than 30 days** after discovery | 16 CFR § 314.5; notify via the FTC's online reporting mechanism; include the nature/amount of information and other required details. |
| **IRS Stakeholder Liaison** | Data theft / breach affecting taxpayer data at a preparer | **As soon as possible** (same day where feasible) | IRS guidance for tax professionals; the IRS coordinates with states. Report client data theft so the IRS can flag affected accounts. |
| **State Attorney(s) General / state regulators** | Per each affected resident's state breach-notification statute | **Varies by state** (often "without unreasonable delay"; some impose ~30–60-day caps; some require AG notice at thresholds) | All 50 states + D.C. Track residency of affected taxpayers; counsel maps obligations (e.g., MA, NY SHIELD, CA, etc.). |
| **Affected taxpayers / consumers** | Per applicable state law (and contract) | Per state law (often "without unreasonable delay") | Content per state requirements; coordinate with the CPA/firm whose clients are affected. |
| **Affected CPA firm(s) / design partners** | Any incident touching their clients' data | **Promptly per contract** (recommend ≤ 72 hours) | Contractual breach-notification clause; the firm has its own Safeguards/§ 7216 duties. |
| **Cyber-insurer** | Per policy | Per policy (often prompt) | [CONFIRM coverage — recommend obtaining cyber/E&O coverage]. |
| **Service providers** | If the incident originates with or implicates a provider | Per DPA SLA | Neon/Google/AWS breach-notification clauses. |

### 6.5 Standing Note on the Current Leaked-Credential Condition (R-5)

The leaked-and-unrotated Neon and Gemini credentials constitute an **active, unresolved security event**. Until they are rotated and the DB/AI access is scoped for evidence of misuse, this condition is treated under this IRP as **at least SEV-2, presumptively SEV-1.** Rotation (P0-1) is the immediate containment step; the QI must then attempt scoping and document the determination.

---

## 7. Personnel / Employee Training

Per 16 CFR § 314.4(e). Because TaxFlow is small, "personnel" includes all founders, employees, and contractors with any access to customer information or its systems.

- **Onboarding:** every person with access reads and acknowledges this WISP, the § 7216 disclosure rules, IRS Pub 4557 basics, and the acceptable-use/secrets-handling policy **before** receiving access. MFA enrollment verified.
- **Annual refresher:** security-awareness training (phishing, social engineering, secrets hygiene, device security, incident reporting) at least annually, delivered and **recorded** by the QI.
- **Targeted training:** anyone touching auth, encryption, the § 7216 gate, or PII handling receives role-specific guidance.
- **Acknowledgement log:** the QI maintains a dated log of who completed which training. [Attach log / link.]
- **Offboarding:** revoke all access (app, GitHub, AWS, Neon, Google, Secrets Manager), rotate any shared secrets the person held, and record it.

---

## 8. Periodic Testing, Annual Review, and Sign-Off

### 8.1 Testing (§ 314.4(d))

- **Continuous monitoring** of authorized-user and data-access activity once logging (§ 4.7) is live; otherwise:
  - **Annual penetration test** of the application and infrastructure (external provider once handling real PII), **and**
  - **Vulnerability assessments at least every six months** and after any material change.
- **Dependency / SAST scanning** in CI (P0-6); **secret-scanning + push protection** on GitHub.
- Findings are logged, risk-rated, assigned to an owner, and tracked to closure by the QI; material findings update the risk assessment (§ 3).

### 8.2 Annual Review and Material-Change Review (§ 314.4(b)(1), (i))

- This WISP and the risk assessment are reviewed **at least annually** and whenever there is a **material change** (new sub-processor, new data type, architecture change such as adding auth/tenancy, a security incident, or a regulatory change).
- The QI delivers a **written annual report** to ownership covering: overall program status, risk-assessment results, testing outcomes, incidents and responses, service-provider assessments, and recommended changes (§ 314.4(i)).

### 8.3 Ownership Sign-Off

By signing, ownership acknowledges this WISP, the current **Critical** risk posture, and the commitment to the P0 remediation before real taxpayer PII is processed.

- **Qualified Individual:** ______________________________  Date: __________
  (Name / role: [NAME / ROLE])
- **Owner / Principal:** ________________________________  Date: __________
  (Name / role: [NAME / ROLE])
- **Reviewing counsel [LEGAL REVIEW]:** _________________  Date: __________

---

## 9. Compliance-Status Table (Required Element | Status Today | Target)

> Legend: 🔴 Not implemented · 🟡 Partial / in progress · 🟢 Implemented & verified. **No item may be advertised to customers as present until it is 🟢 here.**

| Required element (16 CFR § 314.4 / IRS) | Status today | Target state | Closes | P0 |
|---|---|---|---|---|
| **Designated Qualified Individual** (§ 314.4(a)) | 🔴 Not formally designated | Named QI in §2; accountable for the program | R-* | P0-3 |
| **Written risk assessment** (§ 314.4(b)) | 🟡 This document (§3) is the first written assessment | Reviewed, signed, kept current; annual + on change | R-* | P0-3 |
| **Access control / least privilege** (§ 314.4(c)(1)) | 🔴 No auth on ~79 endpoints; full read/write | Bearer + Cloudflare Access now; per-tenant RLS at GA | R-1, R-11, R-12 | P0-4 |
| **Encryption in transit** (§ 314.4(c)(3)) | 🔴 HTTP-only; HSTS disabled | TLS 1.2+ via ALB+ACM; HSTS on; DB `sslmode=verify-full` | R-2 | P0-4 |
| **Encryption at rest** (§ 314.4(c)(3)) | 🔴 Plaintext SSN/TIN + base64 docs in Postgres; no QI-approved compensating control | AES-256-GCM field encryption (KMS) + S3 SSE-KMS for docs | R-3, R-4 | P0-5 |
| **MFA** (§ 314.4(c)(5)) | 🔴 Not enforced (no login); console MFA undocumented | MFA on app (GA) + all admin consoles now | R-1, R-12 | P0-4 |
| **Secure disposal & retention** (§ 314.4(c)(6)) | 🔴 No soft-delete, no purge, no enforced schedule | 3-yr §7216-consent / 7-yr workpaper retention + secure purge/crypto-shred | R-7 | P0-5 |
| **Change management** (§ 314.4(c)(7)) | 🟡 `push`-based prod schema; no CI gate | Versioned `migrate`; CI + branch protection; review on PII/auth/crypto changes | R-7, R-9 | P0-6 |
| **Logging & monitoring** (§ 314.4(c)(8)) | 🟡 Pino request logs; no data-access trail/alerting | Authorized-user + data-access logging; centralized; alerting | R-8 | P0-4/6 |
| **Service-provider oversight** (§ 314.4(f)) | 🔴 No DPAs confirmed; Gemini on training-permitted free tier | Inventory (§5); DPAs; Google no-training + DPA; §7216 binding | R-6 | P0-2 |
| **§ 7216 consent for third-party disclosure** (Treas. Reg. §301.7216; Rev. Proc. 2013-14) | 🔴 None; only a UI banner; "7216" absent from repo | Signed, per-taxpayer, pre-disclosure consent gate blocking Gemini sends | R-6 | P0-2 |
| **Incident response plan** (§ 314.4(h)) | 🔴 None; cannot scope a breach | IRP in §6 + notification matrix; access-log scoping | R-8 | P0-6 + §6 |
| **Breach notification readiness** (§ 314.5 + IRS + state) | 🔴 No runbook; active leaked-cred event open | 30-day FTC / IRS Liaison / state-AG matrix operational | R-5, R-8 | P0-1/6 |
| **Employee training** (§ 314.4(e)) | 🔴 None recorded | Onboarding + annual; acknowledgement log | R-12 | §7 |
| **Periodic testing** (§ 314.4(d)) | 🔴 None | Annual pen test + biannual vuln scans + CI SAST/secret-scan | R-* | P0-6 + §8 |
| **Annual written report to ownership** (§ 314.4(i)) | 🔴 None | QI delivers annual report; ownership sign-off (§8.3) | — | §8 |
| **Secrets management / credential rotation** | 🔴 Two prod creds leaked + unrotated | Rotate now; AWS Secrets Manager/SSM; history scrubbed | R-5 | P0-1 |
| **Accurate customer-facing security representations** (FTC Act §5) | 🔴 Docs claim TLS/encryption/read-only creds that don't exist | Correct docs; advertise only 🟢 controls | R-10 | P0-7 |

---

## 10. Document Control

- **Owner:** Qualified Individual (§2).
- **Review cadence:** annually + on material change (§8).
- **Change log:**

  | Version | Date | Author | Summary |
  |---|---|---|---|
  | 0.1 | 2026-06-03 | [NAME] (engineering draft) | Initial draft structured on IRS Pub 5708; risk assessment mapped to P0 remediation; pending [LEGAL REVIEW] + ownership sign-off. |

- **Related documents:** `docs/product-assessment-2026-06-02.md` (P0 plan), IRS Pub 5708 (WISP template), IRS Pub 4557 (Safeguarding Taxpayer Data), Rev. Proc. 2013-14 (§7216 consent format), `CLAUDE.md` (security/data-handling notes).

---

*This WISP is a working draft prepared by engineering. It is not legal advice. Statutory citations and notification obligations must be confirmed by qualified counsel before reliance. Until §9 shows the Critical items 🟢, TaxFlow must not process real taxpayer PII.*
