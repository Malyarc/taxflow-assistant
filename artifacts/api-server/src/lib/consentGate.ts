import { and, eq, isNull } from "drizzle-orm";
import { authEnabled } from "../middlewares/auth";

// P0-2 — IRC §7216 consent gate. Sending a tax document to Google Gemini is a
// "disclosure of tax return information"; doing so without a statute-compliant,
// unexpired taxpayer consent is a criminal violation by the preparer (§7216).
// TaxFlow must make the non-compliant path impossible (fail-closed).

export const AI_EXTRACTION_SCOPE = "ai_extraction";

function parseBool(value: string | undefined, dflt: boolean): boolean {
  if (value == null) return dflt;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return dflt;
}

/**
 * Whether the consent gate enforces before AI extraction. Default tracks the
 * prod posture — ON whenever the API auth gate is enabled, OFF in pure demo.
 * Override explicitly with REQUIRE_7216_CONSENT=true/false.
 */
export function consentRequired(): boolean {
  return parseBool(process.env.REQUIRE_7216_CONSENT, authEnabled());
}

export interface ConsentRow {
  scope: string;
  signedAt: Date | string;
  expiresAt: Date | string;
  revokedAt: Date | string | null;
}

/**
 * Pure predicate — a consent authorizes `scope` at instant `now`: scope matches,
 * not revoked, signed at-or-before now, and not yet expired (strict). Exported
 * for unit testing without a DB.
 */
export function isConsentValid(c: ConsentRow, scope: string, now: Date): boolean {
  if (c.scope !== scope) return false;
  if (c.revokedAt != null) return false;
  const signed = new Date(c.signedAt).getTime();
  const expires = new Date(c.expiresAt).getTime();
  const t = now.getTime();
  return signed <= t && t < expires;
}

/** DB-backed: does the client currently hold a valid consent for `scope`? */
export async function hasValidConsent(
  clientId: number,
  scope: string,
  now: Date = new Date(),
): Promise<boolean> {
  // Dynamic import so this module (and its pure exports above) can be imported
  // in no-DB unit tests without instantiating the Postgres client.
  const { db, disclosureConsentsTable } = await import("@workspace/db");
  const rows = await db
    .select()
    .from(disclosureConsentsTable)
    .where(
      and(
        eq(disclosureConsentsTable.clientId, clientId),
        eq(disclosureConsentsTable.scope, scope),
        isNull(disclosureConsentsTable.revokedAt),
      ),
    );
  return rows.some((r) => isConsentValid(r, scope, now));
}
