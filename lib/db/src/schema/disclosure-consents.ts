import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";

// P0-2 — IRC §7216 disclosure consents. A row proves that, before TaxFlow
// transmitted a taxpayer's return information to a third party (Google Gemini)
// for a given purpose ("scope"), the taxpayer signed a statute-compliant
// consent (Treas. Reg. §301.7216-3 / Rev. Proc. 2013-14). The extraction path
// is fail-closed against this table (see lib/consentGate.ts).
export const disclosureConsentsTable = pgTable(
  "disclosure_consents",
  {
    id: serial("id").primaryKey(),
    // FK to clients. NOTE: `cascade` matches the rest of the schema and keeps
    // client deletion working. The §7216 retention requirement (keep the consent
    // proof ~7 years, outliving the client row) argues for `restrict` +
    // soft-delete — a hardening follow-up tracked in
    // docs/compliance/section-7216-consent.md (§4.5).
    clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    // The disclosure this consent authorizes, e.g. "ai_extraction".
    scope: text("scope").notNull(),
    // The exact consent-instrument version the taxpayer signed, e.g.
    // "ai_extraction_v1", so the firm can prove WHICH text was agreed to.
    documentVersion: text("document_version").notNull(),
    // Who signed + a reference to the signed artifact (e-sig id, stored PDF key,
    // or an IP+timestamp capture). Both nullable for a minimal record.
    signerName: text("signer_name"),
    signatureRef: text("signature_ref"),
    // Signed BEFORE disclosure (§301.7216-3(a)); expiry defaults to +1yr.
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lookupIdx: index("disclosure_consents_lookup_idx").on(table.clientId, table.scope),
  }),
);

export type DisclosureConsent = typeof disclosureConsentsTable.$inferSelect;
