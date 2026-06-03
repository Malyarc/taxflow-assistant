/**
 * One-time backfill — encrypt existing plaintext SSN / TIN in place (P0-5).
 *
 * Idempotent: rows whose value already carries the `enc:v1:` prefix are skipped,
 * so it is safe to re-run. Encrypts:
 *   - w2_data.employee_ssn
 *   - form_1099_data.payer_tin / recipient_tin
 *
 * Requires DATABASE_URL + PII_ENCRYPTION_KEY (base64 32 bytes) in the env.
 * Run:
 *   DATABASE_URL=… PII_ENCRYPTION_KEY=… \
 *     pnpm --filter @workspace/scripts exec tsx src/backfill-encrypt-pii.ts
 */
import { eq } from "drizzle-orm";
import { db, w2DataTable, form1099DataTable } from "@workspace/db";
import {
  encryptField,
  isEncrypted,
  piiEncryptionEnabled,
} from "../../artifacts/api-server/src/lib/fieldCrypto";

async function main(): Promise<void> {
  if (!piiEncryptionEnabled()) {
    console.error(
      "PII_ENCRYPTION_KEY is not set — refusing to run. Generate one with " +
        "`openssl rand -base64 32`, store it in your secrets manager, and re-run.",
    );
    process.exit(1);
  }

  let w2Count = 0;
  for (const r of await db.select().from(w2DataTable)) {
    if (r.employeeSSN && !isEncrypted(r.employeeSSN)) {
      await db
        .update(w2DataTable)
        .set({ employeeSSN: encryptField(r.employeeSSN) })
        .where(eq(w2DataTable.id, r.id));
      w2Count++;
    }
  }

  let f1099Count = 0;
  for (const r of await db.select().from(form1099DataTable)) {
    const patch: Partial<typeof form1099DataTable.$inferInsert> = {};
    if (r.payerTin && !isEncrypted(r.payerTin)) patch.payerTin = encryptField(r.payerTin);
    if (r.recipientTin && !isEncrypted(r.recipientTin)) patch.recipientTin = encryptField(r.recipientTin);
    if (Object.keys(patch).length > 0) {
      await db.update(form1099DataTable).set(patch).where(eq(form1099DataTable.id, r.id));
      f1099Count++;
    }
  }

  console.log(`Backfill complete. Encrypted SSN on ${w2Count} W-2 row(s), TIN on ${f1099Count} 1099 row(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
