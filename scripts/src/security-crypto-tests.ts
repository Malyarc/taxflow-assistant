/**
 * Security — P0-5 PII field encryption (AES-256-GCM).
 *
 * Exit code is non-zero on any failure (CI). Picked up by run-no-api.ts via the
 * `security-*tests.ts` glob. PII_ENCRYPTION_KEY is intentionally UNSET here, so
 * the env field helpers exercise their demo passthrough path.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/security-crypto-tests.ts
 */
import { randomBytes } from "node:crypto";
import {
  encryptWithKey,
  decryptWithKey,
  isEncrypted,
  isDecryptErrorSentinel,
  DECRYPT_ERROR,
  encryptField,
  decryptField,
} from "../../artifacts/api-server/src/lib/fieldCrypto";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
}

const key = randomBytes(32);
const otherKey = randomBytes(32);
const ssn = "123-45-6789";

console.log("── AES-256-GCM round trip ──");
const enc = encryptWithKey(ssn, key);
ok("ciphertext carries the enc:v1 prefix", isEncrypted(enc));
ok("ciphertext != plaintext", enc !== ssn);
ok("round-trips back to plaintext", decryptWithKey(enc, key) === ssn);
ok("plaintext is not flagged encrypted", !isEncrypted(ssn));
ok("two encryptions of the same value differ (random IV)", encryptWithKey(ssn, key) !== encryptWithKey(ssn, key));

console.log("── tamper / wrong key are rejected (authenticated encryption) ──");
let wrongKeyThrew = false;
try { decryptWithKey(enc, otherKey); } catch { wrongKeyThrew = true; }
ok("decrypt with wrong key throws (auth-tag mismatch)", wrongKeyThrew);
const mid = Math.floor(enc.length / 2);
const tampered = enc.slice(0, mid) + (enc[mid] === "A" ? "B" : "A") + enc.slice(mid + 1);
let tamperThrew = false;
try { decryptWithKey(tampered, key); } catch { tamperThrew = true; }
ok("decrypt of tampered ciphertext throws", tamperThrew);

console.log("── env field helpers — passthrough when PII_ENCRYPTION_KEY is unset (demo) ──");
ok("encryptField passes plaintext through (no key)", encryptField(ssn) === ssn);
ok("decryptField passes plaintext through", decryptField(ssn) === ssn);
ok("encryptField(null) === null", encryptField(null) === null);
ok("decryptField(null) === null", decryptField(null) === null);
ok("encryptField(undefined) === null", encryptField(undefined) === null);
ok("encryptField is idempotent on already-encrypted input", encryptField(enc) === enc);
ok("decryptField never returns raw ciphertext when the key is unavailable (no leak, no crash)",
  decryptField(enc) !== enc);

console.log("── decrypt-failure sentinel is never persisted (TIN data-loss guard) ──");
ok("isDecryptErrorSentinel(sentinel) === true", isDecryptErrorSentinel(DECRYPT_ERROR) === true);
ok("isDecryptErrorSentinel(real value) === false", isDecryptErrorSentinel(ssn) === false);
let sentinelThrew = false;
try { encryptField(DECRYPT_ERROR); } catch { sentinelThrew = true; }
ok("encryptField REFUSES to encrypt the sentinel (throws → ciphertext preserved on round-trip)", sentinelThrew);

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL FIELD-CRYPTO CHECKS GREEN");
