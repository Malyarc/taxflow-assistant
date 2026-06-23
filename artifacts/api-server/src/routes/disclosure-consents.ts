import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, disclosureConsentsTable, clientsTable } from "@workspace/db";
import { writeAudit } from "../lib/auditLog";
import {
  AI_EXTRACTION_SCOPE,
  clampConsentField,
  normalizeConsentDurationDays,
  MAX_CONSENT_SCOPE_LEN,
  MAX_CONSENT_DOC_VERSION_LEN,
  MAX_CONSENT_SIGNER_NAME_LEN,
  MAX_CONSENT_SIGNATURE_REF_LEN,
} from "../lib/consentGate";

// P0-2 — record / list / revoke a taxpayer's §7216 disclosure consent. These
// endpoints sit behind the API auth gate (mounted after requireApiAuth). The
// consent INSTRUMENT (verbatim text the taxpayer signs) is in
// docs/compliance/section-7216-consent.md (version "ai_extraction_v1"); the
// frontend capture UX + OpenAPI/Orval formalization are a fast-follow.

const router: IRouter = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/** Verify the client row exists. The disclosure_consents FK would otherwise
 *  turn a bad clientId into a 500 on insert; client-scoped routes elsewhere
 *  return a clean 404 — match that. */
async function clientExists(clientId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(eq(clientsTable.id, clientId));
  return !!row;
}

router.post("/clients/:clientId/disclosure-consents", async (req, res): Promise<void> => {
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId)) {
    res.status(400).json({ error: "invalid clientId" });
    return;
  }
  if (!(await clientExists(clientId))) {
    res.status(404).json({ error: "client not found" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Bound every client-supplied field (T0.2 C4): scope/version/name/signature
  // are length-capped; durationDays is clamped to a whole number of days in
  // [1, MAX] so it can't mint a perpetual / overflowed-expiresAt consent.
  const scope = clampConsentField(body.scope, MAX_CONSENT_SCOPE_LEN, AI_EXTRACTION_SCOPE) as string;
  const documentVersion = clampConsentField(
    body.documentVersion,
    MAX_CONSENT_DOC_VERSION_LEN,
    "ai_extraction_v1",
  ) as string;
  const signerName = clampConsentField(body.signerName, MAX_CONSENT_SIGNER_NAME_LEN, null);
  const signatureRef = clampConsentField(body.signatureRef, MAX_CONSENT_SIGNATURE_REF_LEN, null);
  const durationDays = normalizeConsentDurationDays(body.durationDays);
  const signedAt = new Date();
  const expiresAt = new Date(signedAt.getTime() + durationDays * DAY_MS);

  const [row] = await db
    .insert(disclosureConsentsTable)
    .values({ clientId, scope, documentVersion, signerName, signatureRef, signedAt, expiresAt })
    .returning();
  await writeAudit({
    clientId,
    action: "create",
    entityType: "disclosure_consent",
    entityId: row.id,
    after: { scope: row.scope, documentVersion: row.documentVersion, signedAt: row.signedAt, expiresAt: row.expiresAt },
  });
  res.status(201).json(row);
});

router.get("/clients/:clientId/disclosure-consents", async (req, res): Promise<void> => {
  const clientId = Number(req.params.clientId);
  if (!Number.isInteger(clientId)) {
    res.status(400).json({ error: "invalid clientId" });
    return;
  }
  if (!(await clientExists(clientId))) {
    res.status(404).json({ error: "client not found" });
    return;
  }
  const rows = await db
    .select()
    .from(disclosureConsentsTable)
    .where(eq(disclosureConsentsTable.clientId, clientId))
    .orderBy(desc(disclosureConsentsTable.signedAt));
  res.json(rows);
});

router.post("/clients/:clientId/disclosure-consents/:id/revoke", async (req, res): Promise<void> => {
  const clientId = Number(req.params.clientId);
  const id = Number(req.params.id);
  if (!Number.isInteger(clientId) || !Number.isInteger(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  if (!(await clientExists(clientId))) {
    res.status(404).json({ error: "client not found" });
    return;
  }
  const [row] = await db
    .update(disclosureConsentsTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(disclosureConsentsTable.id, id), eq(disclosureConsentsTable.clientId, clientId)))
    .returning();
  if (!row) {
    res.status(404).json({ error: "consent not found" });
    return;
  }
  await writeAudit({ clientId, action: "update", entityType: "disclosure_consent", entityId: row.id, after: { revokedAt: row.revokedAt } });
  res.json(row);
});

export default router;
