/**
 * Security — P0-2 §7216 consent gate predicate (isConsentValid + consentRequired).
 *
 * Pure logic, no DB. Exit code is non-zero on any failure (CI). Picked up by
 * run-no-api.ts via the `security-*tests.ts` glob.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/security-consent-tests.ts
 */
import {
  isConsentValid,
  consentRequired,
  type ConsentRow,
} from "../../artifacts/api-server/src/lib/consentGate";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}`); }
}

const now = new Date("2026-06-03T12:00:00Z");
const base: ConsentRow = {
  scope: "ai_extraction",
  signedAt: new Date("2026-06-01T00:00:00Z"),
  expiresAt: new Date("2027-06-01T00:00:00Z"),
  revokedAt: null,
};

console.log("── isConsentValid ──");
ok("valid consent authorizes the scope", isConsentValid(base, "ai_extraction", now) === true);
ok("wrong scope rejected", isConsentValid(base, "marketing", now) === false);
ok("revoked consent rejected", isConsentValid({ ...base, revokedAt: new Date("2026-06-02") }, "ai_extraction", now) === false);
ok("expired consent rejected", isConsentValid({ ...base, expiresAt: new Date("2026-06-02") }, "ai_extraction", now) === false);
ok("not-yet-signed (future) rejected", isConsentValid({ ...base, signedAt: new Date("2026-06-04") }, "ai_extraction", now) === false);
ok("boundary: now == expiresAt is EXPIRED (strict <)", isConsentValid({ ...base, expiresAt: now }, "ai_extraction", now) === false);
ok("boundary: now == signedAt is VALID (<=)", isConsentValid({ ...base, signedAt: now }, "ai_extraction", now) === true);
ok("string timestamps (DB form) work", isConsentValid(
  { scope: "ai_extraction", signedAt: "2026-06-01T00:00:00Z", expiresAt: "2027-06-01T00:00:00Z", revokedAt: null },
  "ai_extraction", now) === true);

console.log("── consentRequired() env logic (no API_AUTH_TOKEN in test → demo default OFF) ──");
delete process.env.REQUIRE_7216_CONSENT;
ok("default OFF in demo (no auth token)", consentRequired() === false);
process.env.REQUIRE_7216_CONSENT = "true";
ok("explicit REQUIRE_7216_CONSENT=true → ON", consentRequired() === true);
process.env.REQUIRE_7216_CONSENT = "false";
ok("explicit REQUIRE_7216_CONSENT=false → OFF", consentRequired() === false);
delete process.env.REQUIRE_7216_CONSENT;

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL §7216 CONSENT-GATE CHECKS GREEN");
