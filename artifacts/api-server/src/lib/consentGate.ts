import { and, eq, isNull } from "drizzle-orm";
import { logger } from "./logger";

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
 * Whether the gate enforces before any AI disclosure (extraction OR planning).
 * Fail-closed in any production deployment, keyed on NODE_ENV — NOT on the app
 * bearer token: the runbook's recommended posture is edge auth (Cloudflare
 * Access) with NO API_AUTH_TOKEN, which still handles real PII, so coupling to
 * the bearer token would silently leave the §7216 gate OFF in prod. Demo/dev
 * (NODE_ENV !== "production") defaults OFF so the synthetic-data demo flow works.
 * Override explicitly with REQUIRE_7216_CONSENT=true/false.
 */
export function consentRequired(): boolean {
  return parseBool(process.env.REQUIRE_7216_CONSENT, process.env.NODE_ENV === "production");
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
  try {
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
  } catch (err) {
    // Fail CLOSED. If the consent store is unreachable or the table is not yet
    // provisioned (needs `db push`/migrate), treat as "no consent" so we never
    // transmit PII to a third party on a DB error.
    logger.error({ err, clientId, scope }, "§7216 consent lookup failed — failing closed (treating as no consent)");
    return false;
  }
}
