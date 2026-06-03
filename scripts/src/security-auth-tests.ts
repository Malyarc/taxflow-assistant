/**
 * Security — P0-4 bearer-token gate (verifyBearer).
 *
 * Constant-time comparison + strict parsing. Exit code is non-zero on any
 * failure (CI). Picked up by run-no-api.ts via the `security-*tests.ts` glob.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/security-auth-tests.ts
 */
import { verifyBearer } from "../../artifacts/api-server/src/middlewares/auth";

let passed = 0;
let failed = 0;
function expect(label: string, actual: boolean, want: boolean) {
  if (actual === want) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}: expected ${want}, got ${actual}`); }
}

console.log("── verifyBearer ──");
expect("exact match → true", verifyBearer("Bearer s3cret-token", "s3cret-token"), true);
expect("case-insensitive scheme → true", verifyBearer("bearer s3cret-token", "s3cret-token"), true);
expect("leading/trailing space tolerated → true", verifyBearer("  Bearer s3cret-token  ", "s3cret-token"), true);
expect("wrong token → false", verifyBearer("Bearer nope", "s3cret-token"), false);
expect("different length → false", verifyBearer("Bearer s3cret-toke", "s3cret-token"), false);
expect("missing Bearer prefix → false", verifyBearer("s3cret-token", "s3cret-token"), false);
expect("empty token after scheme → false", verifyBearer("Bearer ", "s3cret-token"), false);
expect("undefined header → false", verifyBearer(undefined, "s3cret-token"), false);
expect("null header → false", verifyBearer(null, "s3cret-token"), false);
expect("empty expected (gate misconfigured) → false", verifyBearer("Bearer anything", ""), false);
expect("Basic scheme → false", verifyBearer("Basic czNjcmV0", "s3cret-token"), false);

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("ALL AUTH GATE CHECKS GREEN");
