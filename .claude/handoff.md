# Handoff Note — 2026-05-21 (afternoon)

Session continuation point for the next Claude (or human) working on TaxFlow Assistant.

## Headline

**Phase 4 AI-overlay MVP shipped.** CPA workflow is end-to-end: upload W-2 / 1099 → AI extracts → CPA reviews in a split-pane modal with bounding-box overlays + inline edit → approves → row writes to w2_data / form_1099_data with an audit-log entry whose `source` says "AI extraction from {fileName}" → existing `.gen` export endpoint produces UltraTax-importable output. The first product-level deliverable of Option A.

**Test count: 1,122 assertions / 0 failures across 16 suites (was 1,092 across 15 at start of this turn).**

## What landed this session (afternoon turn)

One commit on `main` (already pushed to origin):

| Commit | What |
|---|---|
| `c026154` | Phase 4 MVP: AI overlay review UX (upload → extract → CPA review → approve) |

**Key behavior change:** the previous "extract → auto-insert w2_data / form_1099_data" flow is gone. Extraction now leaves the document in `pending_review`. The CPA must explicitly approve before any income row is written, and that write goes through `writeAudit({ source: "AI extraction from ..." })`. CPA firms get an explicit trail of who signed off on what.

### Schema additions
- `tax_documents.linked_record_id` (int, nullable)
- `tax_documents.linked_record_type` (text: "w2" | "form1099", nullable)
- `tax_documents.rejection_reason` (text, nullable)
- New status values: `pending_review`, `approved`, `rejected` (existing `extracted` is preserved as a legacy alias — the UI treats it as a synonym of `approved`)

### New endpoints
- `POST /api/clients/:clientId/documents/:documentId/approve` — body is the (possibly CPA-edited) extracted values; inserts the w2/1099 row + audit log + links the document
- `POST /api/clients/:clientId/documents/:documentId/reject` — optional reason; no DB write to income tables

### Frontend
- `BoundedDocumentViewer` (`artifacts/tax-app/src/components/BoundedDocumentViewer.tsx`) — pdfjs-dist for PDFs + `<img>` for images, with absolutely-positioned box overlays driven by AI-returned 0–1000 normalized coords. Focus an input → its box highlights. Click a box → its input focuses.
- `ReviewExtractionModal` (`artifacts/tax-app/src/components/ReviewExtractionModal.tsx`) — wide split-pane Dialog. Right pane is a CPA-editable form pre-filled from `extractedText.data`; edited fields get a yellow left-border + "AI: $X" tooltip showing the original AI value.
- `DocumentsTab` (`pages/ClientDetail.tsx`) — new status pills, "Review extraction" CTA on `pending_review` rows.

### New tests
- `scripts/src/tax-engine-ai-overlay-tests.ts` (30 assertions, needs API). Covers: gate keeps extraction out of income tables, approve as-is creates audited row, approve with edit uses CPA value (not extraction), reject leaves no row, 1099-INT approval, can't re-approve, can't reject after approve, 1099 without formType returns 400.

## Current state

**Live deploy:** Deployed to EC2 (commit `17a03c2` on `origin/main`). Verified end-to-end against `http://ec2-18-188-192-154.us-east-2.compute.amazonaws.com`: upload → pending_review → approve → w2_data row + audit-log entry with source="AI extraction from ...". Schema push applied (tax_documents.linked_record_id, linked_record_type, rejection_reason).

**Two EC2 gotchas surfaced during deploy** (now documented in CLAUDE.md):
1. **Project lives at `~/taxflow-pro` on the box**, not `taxflow-assistant` as previous handoff said.
2. **The instance has 908 MiB RAM and Vite OOMs (exit 137) on `tax-app` build.** Build the frontend locally and rsync `dist/public/` over. The api-server build is fine on the box.
3. **No `~/.env` exists.** Env vars (DATABASE_URL → Neon, AI_API_KEY) are baked into the pm2 process. Source them with `export DATABASE_URL=$(pm2 env 0 | awk -F": " '/^DATABASE_URL:/ {print $2; exit}')` before `db run push`.

**Tests: 1,122 / 0 across 16 suites**

| Suite | Count | Needs API |
|---|---:|---|
| `tax-engine-tests.ts` | 193 | no |
| `tax-engine-deep-tests.ts` | 37 | no |
| `tax-engine-phase1-unit-tests.ts` | 44 | no |
| `tax-engine-phase15-unit-tests.ts` | 90 | no |
| `tax-engine-pure-tests.ts` | 27 | no |
| `tax-engine-phase2-unit-tests.ts` | 104 | no |
| `tax-engine-50state-tests.ts` | 187 | no |
| `tax-engine-edge-cases-tests.ts` | 128 | no |
| `tax-engine-integration-tests.ts` | 22 | yes |
| `tax-engine-deep-integration-tests.ts` | 26 | yes |
| `tax-engine-new-features-tests.ts` | 28 | yes |
| `tax-engine-phase1-integration-tests.ts` | 55 | yes |
| `tax-engine-phase15-integration-tests.ts` | 33 | yes |
| `tax-engine-exports-tests.ts` | 25 | yes |
| `tax-engine-scenarios.ts` | 93 | yes |
| `tax-engine-ai-overlay-tests.ts` | 30 | yes (NEW) |

## What this means for Option A

The product loop now exists end-to-end:
1. CPA logs in (auth not built yet — local dev only)
2. Creates a client
3. Uploads W-2 / 1099 PDF or image
4. AI extracts (Gemini via OpenAI-compat); document moves to `pending_review`
5. CPA opens "Review extraction" → sees source doc with box overlays on the left, editable form on the right; edits anything that looks wrong
6. Clicks Approve → w2/1099 row written with audit-log entry, tax return recalculated
7. Goes to Tax Calculator tab → clicks "Download UltraTax (.gen)" → imports into UltraTax CS

This is the smallest viable demo for a CPA design partner. The remaining gaps before pitching are auth + multi-tenancy and validating the `.gen` file against a real UltraTax install.

## What I did NOT do this session

- **AI extraction confidence scores per field** — Gemini doesn't emit them, would need a separate scoring pass
- **Multi-page PDF support in the overlay** — page 1 only for now (W-2 / 1099 are typically single-page)
- **Schedule K-1 extraction** — backend doesn't extract K-1 yet; modal will gracefully render empty if you upload one
- **CPA-firm multi-tenancy auth** — still a multi-week project, deferred
- **UltraTax `.gen` validation against a real install** — needs a design partner
- **EC2 deploy** — code pushed, not yet deployed (no schema-affecting changes since last EC2 deploy *except* this one)

## Where to pick up next session — ranked by value

### Tier 1 (Option-A specific, ship-blocking for a design-partner demo)
1. **Deploy to EC2** — ~10 min, includes `pnpm --filter @workspace/db run push` for the tax_documents column adds
2. **Validate UltraTax `.gen` export with a real CPA design partner.** The export is built but never tested against an actual UltraTax CS install. Highest-confidence way to de-risk Option A
3. **CPA-firm multi-tenancy auth model** — organizations + users + role-based access + per-client visibility. This is the gate to a paid design partner

### Tier 2 (UX polish on the AI overlay)
4. **PDF multi-page support in BoundedDocumentViewer** — render a pager / thumbnail strip, route boxes to the correct page
5. **Real document upload + secure S3 storage**, remove the demo banner — file content currently sits in `tax_documents.file_content` as base64
6. **Side-by-side diff view in the review modal** — when AI extracted a value AND the CPA edited it, show both side-by-side rather than just a tooltip
7. **Confidence-score-style highlight** — even without real confidences from the model, we could flag values that don't match the W-2 box-arithmetic invariants (Box 3 + Box 7 ≈ Box 1, etc.) and visually mark them in the review modal as "verify"

### Tier 3 (engine accuracy improvements, parked from prior session)
8. **CA 540NR non-resident bracket calc**
9. **Schedule D per-transaction detail** + wash-sale tracking
10. **Per-property rental table** + per-property MACRS
11. **HI / NJ / NY partial retirement-income state exemptions**
12. **Real IRS Form 1040 PDF layout** via pdf-lib coordinate fills
13. **Form 1116 engine integration** — add `foreign_source_taxable_income` adjustment type

### Tier 4 (compliance / infra)
14. **DB-level append-only enforcement** on `audit_log` (revoke UPDATE/DELETE for app role)
15. **Soft-delete clients** so audit_log persists past client deletion
16. **Audit-log UI** — `GET /api/clients/:id/audit-log` endpoint exists but no frontend view

## Codebase reminders (still load-bearing)

- AGI must include LTCG + QDIV + STCG per Form 1040 Line 9
- `<CurrencyInput>` for money fields, never `<Input type="number">`
- Radix `<Select>` needs `formReady` gate before mount in edit mode
- Adding a new test file requires adding it to `scripts/tsconfig.json`'s `exclude` array
- When api-server typecheck stalls after schema change: delete `lib/db/dist/` + `lib/db/tsconfig.tsbuildinfo`, then `pnpm --filter @workspace/db exec tsc -b --force`
- Status `extracted` on `tax_documents` is legacy — pre-MVP rows that already auto-wrote. The UI displays it the same as `approved`. New uploads never land in `extracted`

## Open background processes

- API server on `:8080`
- Frontend preview on `:3010`
- Docker `haven-postgres` container

## How to start the next Claude session

Just say: **"Read .claude/handoff.md and CLAUDE.md. What should we work on next?"**

Or pick a specific direction:
- **"Deploy to EC2."** (~10 min, includes db push for the tax_documents column adds)
- **"Build the CPA-firm multi-tenancy auth model — organizations, users, roles, per-client RLS."**
- **"Validate the .gen export against a sample UltraTax import file [path]."**
- **"Add a side-by-side diff view in the ReviewExtractionModal."**
- **"Add PDF multi-page support in BoundedDocumentViewer."**
