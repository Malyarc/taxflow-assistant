/**
 * Security hardening (T0.2 C4 + C2, 2026-06-22 audit) — pure unit tests.
 *
 *   1. resolveTrustProxy   — secure default (no proxy) + explicit opt-in.
 *   2. consent input bounds — durationDays clamp + field length caps.
 *   3. assertWhatIfInputBounds — mutations array size + numeric/string caps.
 *   4. extracted_text crypto round-trip — the AES-256-GCM transform the
 *      documents seam now applies to the PII-bearing extraction payload.
 *
 * No API/DB required (the consent module's DB lookup is a dynamic import; only
 * its pure helpers are exercised here).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/security-hardening-tests.ts
 */
import { resolveTrustProxy } from "../../artifacts/api-server/src/lib/trustProxy";
import {
  normalizeConsentDurationDays,
  clampConsentField,
  MAX_CONSENT_DURATION_DAYS,
  DEFAULT_CONSENT_DURATION_DAYS,
} from "../../artifacts/api-server/src/lib/consentGate";
import {
  assertWhatIfInputBounds,
  WHATIF_LIMITS,
} from "../../artifacts/api-server/src/lib/whatIfEngine";
import {
  encryptWithKey,
  decryptWithKey,
  isEncrypted,
} from "../../artifacts/api-server/src/lib/fieldCrypto";

const PASS: string[] = [];
const FAIL: string[] = [];

function eq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function truthy(label: string, cond: boolean): void {
  if (cond) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected true`);
}
function throws(label: string, fn: () => void): void {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  if (threw) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected a throw`);
}
function noThrow(label: string, fn: () => void): void {
  try {
    fn();
    PASS.push(`OK ${label}`);
  } catch (e) {
    FAIL.push(`FAIL ${label}: unexpected throw ${(e as Error).message}`);
  }
}

// ── 1. resolveTrustProxy — SECURE DEFAULT is false (directly-exposed box) ────
eq("trustProxy undefined → false", resolveTrustProxy(undefined), false);
eq("trustProxy '' → false", resolveTrustProxy(""), false);
eq("trustProxy 'false' → false", resolveTrustProxy("false"), false);
eq("trustProxy '0' → false", resolveTrustProxy("0"), false);
eq("trustProxy 'off' → false", resolveTrustProxy("off"), false);
eq("trustProxy 'no' → false", resolveTrustProxy("no"), false);
eq("trustProxy 'true' → true (escape hatch)", resolveTrustProxy("true"), true);
eq("trustProxy 'TRUE' (case) → true", resolveTrustProxy("TRUE"), true);
eq("trustProxy '1' → 1 hop", resolveTrustProxy("1"), 1);
eq("trustProxy '2' → 2 hops", resolveTrustProxy("2"), 2);
eq("trustProxy ' 1 ' (whitespace) → 1", resolveTrustProxy(" 1 "), 1);
eq("trustProxy '10' → 10", resolveTrustProxy("10"), 10);
eq("trustProxy '11' (>10) → false (fail-secure)", resolveTrustProxy("11"), false);
eq("trustProxy '-1' → false", resolveTrustProxy("-1"), false);
eq("trustProxy '1.5' → false", resolveTrustProxy("1.5"), false);
eq("trustProxy 'garbage' → false", resolveTrustProxy("garbage"), false);

// ── 2. consent input bounds ─────────────────────────────────────────────────
eq("duration undefined → default 365", normalizeConsentDurationDays(undefined), DEFAULT_CONSENT_DURATION_DAYS);
eq("duration '365' (string) → default 365", normalizeConsentDurationDays("365"), DEFAULT_CONSENT_DURATION_DAYS);
eq("duration 30 → 30", normalizeConsentDurationDays(30), 30);
eq("duration 0 → default", normalizeConsentDurationDays(0), DEFAULT_CONSENT_DURATION_DAYS);
eq("duration -5 → default", normalizeConsentDurationDays(-5), DEFAULT_CONSENT_DURATION_DAYS);
eq("duration 366 → 366 (cap)", normalizeConsentDurationDays(366), 366);
eq("duration 367 → clamped to MAX", normalizeConsentDurationDays(367), MAX_CONSENT_DURATION_DAYS);
eq("duration 1e15 (perpetual abuse) → clamped to MAX", normalizeConsentDurationDays(1e15), MAX_CONSENT_DURATION_DAYS);
eq("duration 1.9 → floor 1", normalizeConsentDurationDays(1.9), 1);
eq("duration NaN → default", normalizeConsentDurationDays(NaN), DEFAULT_CONSENT_DURATION_DAYS);
eq("duration Infinity → default", normalizeConsentDurationDays(Infinity), DEFAULT_CONSENT_DURATION_DAYS);

eq("field 'hi' kept", clampConsentField("hello", 64, "fb"), "hello");
eq("field trimmed", clampConsentField("  hi  ", 64, "fb"), "hi");
eq("field '' → fallback", clampConsentField("", 64, "fb"), "fb");
eq("field whitespace → fallback", clampConsentField("   ", 64, "fb"), "fb");
eq("field non-string → fallback", clampConsentField(123, 64, "fb"), "fb");
eq("field null fallback", clampConsentField(undefined, 64, null), null);
eq("field over-long truncated to cap", clampConsentField("a".repeat(100), 64, "fb"), "a".repeat(64));

// ── 3. assertWhatIfInputBounds ──────────────────────────────────────────────
const okMut = { kind: "set_adjustment", adjustmentType: "sep_ira_contribution", amount: 5000 };
noThrow("empty mutations ok", () => assertWhatIfInputBounds([]));
noThrow("single normal mutation ok", () => assertWhatIfInputBounds([okMut]));
noThrow(
  "exactly maxMutations ok",
  () => assertWhatIfInputBounds(Array.from({ length: WHATIF_LIMITS.maxMutations }, () => okMut)),
);
throws(
  "over maxMutations throws",
  () => assertWhatIfInputBounds(Array.from({ length: WHATIF_LIMITS.maxMutations + 1 }, () => okMut)),
);
noThrow("amount at cap ok", () => assertWhatIfInputBounds([{ ...okMut, amount: WHATIF_LIMITS.maxAbsAmount }]));
throws("amount over cap throws", () => assertWhatIfInputBounds([{ ...okMut, amount: 1e13 }]));
throws("amount -over cap throws", () => assertWhatIfInputBounds([{ ...okMut, amount: -1e13 }]));
throws("amount NaN throws", () => assertWhatIfInputBounds([{ ...okMut, amount: NaN }]));
throws("amount Infinity throws", () => assertWhatIfInputBounds([{ ...okMut, amount: Infinity }]));
noThrow("adjustmentType at cap ok", () =>
  assertWhatIfInputBounds([{ ...okMut, adjustmentType: "a".repeat(WHATIF_LIMITS.maxStringLen) }]));
throws("adjustmentType over cap throws", () =>
  assertWhatIfInputBounds([{ ...okMut, adjustmentType: "a".repeat(WHATIF_LIMITS.maxStringLen + 1) }]));
throws("field over cap throws", () =>
  assertWhatIfInputBounds([{ kind: "set_client_field", field: "a".repeat(WHATIF_LIMITS.maxStringLen + 1) }]));
throws("string value over cap throws", () =>
  assertWhatIfInputBounds([{ kind: "set_client_field", field: "state", value: "a".repeat(WHATIF_LIMITS.maxStringLen + 1) }]));

// ── 4. extracted_text crypto round-trip (the documents-seam transform) ──────
// Fixed 32-byte key (deterministic test). The documents extraction seam encrypts
// JSON.stringify(payload) (which embeds the extracted SSN + a raw OCR snippet);
// the list/approve seams decrypt + JSON.parse it back.
const key = Buffer.from("0123456789abcdef0123456789abcdef", "utf8"); // 32 bytes
eq("test key is 32 bytes", key.length, 32);
const payload = JSON.stringify({
  text: "EMPLOYEE SSN 123-45-6789, WAGES 50000",
  data: { employeeSSN: "123-45-6789", wagesBox1: 50000 },
  boxes: { employeeSSN: { page: 1 } },
  confidence: { employeeSSN: 0.97 },
});
const enc = encryptWithKey(payload, key);
truthy("ciphertext carries the enc:v1: prefix", isEncrypted(enc));
truthy("ciphertext is not the plaintext", enc !== payload);
truthy("ciphertext does not leak the SSN", !enc.includes("123-45-6789"));
const dec = decryptWithKey(enc, key);
eq("decrypt restores the exact payload", dec, payload);
const reparsed = JSON.parse(dec) as { data: { employeeSSN: string } };
eq("round-tripped SSN parses back", reparsed.data.employeeSSN, "123-45-6789");
// Legacy/demo plaintext passes through decrypt unchanged (no key prefix).
eq("plaintext passthrough on decrypt", decryptWithKey(payload, key), payload);

console.log(`\nSecurity hardening tests:`);
console.log(`  Passed: ${PASS.length}`);
console.log(`  Failed: ${FAIL.length}`);
if (FAIL.length > 0) {
  FAIL.forEach((f) => console.log(`    ${f}`));
}
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
process.exit(FAIL.length > 0 ? 1 : 0);
