import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { logger } from "./logger";

// P0-5 — application-layer field encryption for PII at rest (SSN / TIN).
//
// AES-256-GCM with a per-value random 96-bit IV (authenticated encryption).
// Stored format:
//     enc:v1:<base64( iv(12) || authTag(16) || ciphertext )>
// The version-tagged prefix lets encrypted and legacy-plaintext values coexist
// in the same column (decrypt passes plaintext through) so a backfill can
// migrate in place with no schema change.
//
// The key is a base64-encoded 32-byte secret in PII_ENCRYPTION_KEY
// (generate: `openssl rand -base64 32`; store in AWS Secrets Manager / SSM, not
// in code — see docs/compliance/runbook-tls-s3-secrets.md). When the key is
// UNSET the field helpers pass plaintext through unchanged (demo mode) and log
// once. NEVER run with real taxpayer PII without the key set; Neon's storage
// encryption does NOT protect against a leaked DB credential — this does.

const PREFIX = "enc:v1:";
const IV_LEN = 12;
const TAG_LEN = 16;
export const DECRYPT_ERROR = "[ENCRYPTED — key unavailable]";

/** True if a value is the decrypt-failure sentinel (must never be persisted). */
export function isDecryptErrorSentinel(value: string | null | undefined): boolean {
  return value === DECRYPT_ERROR;
}

/** True when the value carries the versioned ciphertext prefix. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/** Pure AES-256-GCM encrypt (exported for tests). */
export function encryptWithKey(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Pure AES-256-GCM decrypt (exported for tests). Throws on auth-tag mismatch. */
export function decryptWithKey(stored: string, key: Buffer): string {
  if (!isEncrypted(stored)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

function loadKey(): Buffer | null {
  const raw = (process.env.PII_ENCRYPTION_KEY ?? "").trim();
  if (!raw) return null;
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "PII_ENCRYPTION_KEY must be a base64-encoded 32-byte key (AES-256). " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return buf;
}

let _key: Buffer | null | undefined;
function key(): Buffer | null {
  if (_key === undefined) _key = loadKey();
  return _key;
}

/** True when a PII encryption key is configured (i.e. the gate is enforcing). */
export function piiEncryptionEnabled(): boolean {
  return key() != null;
}

let warned = false;
function warnOnce(msg: string): void {
  if (warned) return;
  warned = true;
  logger.warn(msg);
}

/**
 * Encrypt a PII field for storage. Nullish/empty passes through; an
 * already-encrypted value is returned unchanged (idempotent — safe for
 * re-runs / double-wrapping). With no key configured, returns plaintext (demo).
 */
export function encryptField(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  if (isEncrypted(plain)) return plain;
  if (plain === DECRYPT_ERROR) {
    // The read path could not decrypt and surfaced the sentinel; a write that
    // round-trips it back must NOT overwrite intact ciphertext. Fail loud — the
    // stored value is preserved because the write is aborted.
    throw new Error(
      "Refusing to persist the decrypt-failure sentinel — fix PII_ENCRYPTION_KEY; the stored ciphertext is preserved.",
    );
  }
  const k = key();
  if (!k) {
    warnOnce(
      "SECURITY: PII_ENCRYPTION_KEY is not set — SSN/TIN are stored in PLAINTEXT (demo). " +
        "Set the key and run the backfill before any real PII (P0-5).",
    );
    return plain;
  }
  return encryptWithKey(plain, k);
}

/**
 * Decrypt a PII field for display. Plaintext (legacy/demo) passes through. On a
 * missing key or decrypt failure, returns a non-sensitive sentinel (never the
 * ciphertext) so a key misconfiguration is visible without leaking or 500-ing.
 */
export function decryptField(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!isEncrypted(stored)) return stored;
  const k = key();
  if (!k) {
    warnOnce("SECURITY: found an encrypted PII field but PII_ENCRYPTION_KEY is not set.");
    return DECRYPT_ERROR;
  }
  try {
    return decryptWithKey(stored, k);
  } catch (err) {
    logger.error({ err }, "PII field decryption failed — wrong PII_ENCRYPTION_KEY?");
    return DECRYPT_ERROR;
  }
}
