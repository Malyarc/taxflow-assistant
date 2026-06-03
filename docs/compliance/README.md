# TaxFlow — Compliance & Security Gate (P0)

This folder is the compliance backbone that must be **closed before any real
taxpayer PII touches TaxFlow**. It was created 2026-06-03 in response to the
2026-06-02 product audit (`../product-assessment-2026-06-02.md`), which found the
platform handling (or inviting) taxpayer data with no auth, no TLS, plaintext
PII, leaked credentials, and **zero §7216 / GLBA-WISP coverage**.

These documents are **engineering-prepared working drafts**. Every one carries
`[LEGAL REVIEW]` markers where qualified counsel (familiar with IRC §7216 and the
FTC Safeguards Rule) must sign off before the control is relied upon or
represented to a customer.

## Documents

| File | What it is | Status |
|---|---|---|
| [`WISP.md`](./WISP.md) | Written Information Security Plan (FTC Safeguards Rule, 16 CFR 314 / IRS Pub 5708). Names the Qualified Individual, the written risk register mapped to each P0 item, safeguards, service-provider inventory, and the incident-response + breach-notification plan. **Legally required for any tax preparer, regardless of revenue.** | DRAFT — needs a named Qualified Individual + counsel + ownership sign-off |
| [`section-7216-consent.md`](./section-7216-consent.md) | IRC §7216 disclosure-consent framework + the **verbatim taxpayer consent instrument** (`ai_extraction_v1`) gating transmission of any document to Google Gemini, plus the `disclosure_consents` table + fail-closed gate spec + the vendor/DPA checklist. | DRAFT — counsel MUST verify the mandatory Rev. Proc. 2013-14 language before enabling |
| [`runbook-tls-s3-secrets.md`](./runbook-tls-s3-secrets.md) | Copy-pasteable ops runbooks: (A) TLS termination (Cloudflare / ALB+ACM / nginx+certbot), (B) document storage → S3 + SSE-KMS, (C) secrets → AWS SSM/Secrets Manager + credential rotation. | Ready to execute (infra work, requires AWS/Cloudflare access) |

## P0 status (see `../todo.md` for the live tracker)

| Item | Control | Code shipped | Operator action still required |
|---|---|---|---|
| **P0-1** | Rotate leaked Neon + Gemini creds | — | **YOU** — rotate in the consoles (see the P0-1 runbook handed to you) |
| **P0-2** | §7216 consent gate before Gemini | ✅ `disclosure_consents` table + fail-closed extractor gate + consent endpoints | Wire the consent capture into the upload UX; execute the Google DPA; counsel-verify the instrument; set `REQUIRE_7216_CONSENT=true` |
| **P0-3** | GLBA WISP | ✅ this folder | Name the Qualified Individual; counsel + ownership sign-off; attest at PTIN renewal |
| **P0-4** | Auth + TLS | ✅ app-layer bearer gate (`API_AUTH_TOKEN`) | Stand up TLS + edge auth per Runbook A; set the token; lock the EC2 security group |
| **P0-5** | Encrypt PII at rest (**PARTIAL**) | ✅ AES-256-GCM field encryption for the SSN/TIN columns | **Field encryption does NOT cover the uploaded document blob** — it is still base64 plaintext in `tax_documents.file_content` and contains the same SSN/TIN, so a leaked DB credential still recovers it. PII-at-rest is **not complete** until the S3+KMS document migration (Runbook B). Set `PII_ENCRYPTION_KEY` + run the backfill; **treat the blob migration as P0-blocking before real PII** |
| **P0-6** | CI + test typecheck | ✅ `.github/workflows/ci.yml` | Make CI a required status check in branch protection |
| **P0-7** | Fix false claims + QBI bug | ✅ | — |

**The gate is not closed until the "operator action still required" column is
empty AND counsel has signed off.** Do not onboard real client PII before then.
