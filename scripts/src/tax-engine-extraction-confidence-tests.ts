/**
 * P2-9 — per-field extraction confidence (deterministic plumbing). NO API.
 *
 * Verifies the lowConfidenceFields filter + the no-API extraction shape. The
 * model-side confidence VALUES require a live paid Gemini run to validate; this
 * covers the deterministic plumbing the UI relies on.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-extraction-confidence-tests.ts
 */
import {
  lowConfidenceFields,
  extractW2DataFromFile,
  extract1099DataFromFile,
} from "../../artifacts/api-server/src/lib/documentExtractor";

const PASS: string[] = [];
const FAIL: string[] = [];
function checkBool(label: string, actual: boolean, expected: boolean): void {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`X ${label}: expected ${expected}, got ${actual}`);
}
function header(t: string) { console.log(`\n-- ${t} --`); }

// ── lowConfidenceFields filter ─────────────────────────────────────────────
header("lowConfidenceFields filter");
{
  const data = { wagesBox1: 50000, employeeSSN: "123-45-6789", stateCode: "CA", medicareWagesBox5: 51000 };
  const confidence = { wagesBox1: 0.98, employeeSSN: 0.6, stateCode: 0.8, medicareWagesBox5: 0.99, federalTaxWithheldBox2: 0.3 };
  const low = lowConfidenceFields(data, confidence); // default threshold 0.85

  const fields = low.map((x) => x.field);
  checkBool("flags employeeSSN (0.60 ≤ 0.85, present)", fields.includes("employeeSSN"), true);
  checkBool("flags stateCode (0.80 ≤ 0.85, present)", fields.includes("stateCode"), true);
  checkBool("does NOT flag wagesBox1 (0.98 > 0.85)", fields.includes("wagesBox1"), false);
  checkBool("does NOT flag medicareWagesBox5 (0.99 > 0.85)", fields.includes("medicareWagesBox5"), false);
  // federalTaxWithheldBox2 has low confidence (0.3) but is NOT present in data → excluded.
  checkBool("ignores not-present field (federalTaxWithheldBox2)", fields.includes("federalTaxWithheldBox2"), false);
  // Sorted least-confident first: employeeSSN (0.6) before stateCode (0.8).
  checkBool("sorted least-confident first", low[0].field === "employeeSSN", true);
}

header("lowConfidenceFields — custom threshold + non-numeric guard");
{
  const data = { wagesBox1: 50000, stateCode: "CA" };
  const confidence = { wagesBox1: 0.9, stateCode: "high" as unknown as number };
  // threshold 0.95 → wagesBox1 (0.9 ≤ 0.95) flagged; stateCode non-numeric → ignored.
  const low = lowConfidenceFields(data, confidence, 0.95);
  checkBool("flags wagesBox1 at threshold 0.95", low.some((x) => x.field === "wagesBox1"), true);
  checkBool("ignores non-numeric confidence", low.some((x) => x.field === "stateCode"), false);
}

// ── No-API extraction shape returns confidence: {} ─────────────────────────
header("Extraction returns confidence shape when AI disabled");
{
  // In the test env there is no AI_API_KEY → aiEnabled is false → the extractors
  // short-circuit to the empty shape (proves the field is always present).
  const w2 = await extractW2DataFromFile("", "image/png");
  checkBool("W-2 result has a confidence object", typeof w2.confidence === "object" && w2.confidence !== null, true);
  const f1099 = await extract1099DataFromFile("", "image/png");
  checkBool("1099 result has a confidence object", typeof f1099.confidence === "object" && f1099.confidence !== null, true);
}

console.log(`\n${"=".repeat(50)}`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) { for (const f of FAIL) console.log(f); process.exit(1); }
console.log("ALL EXTRACTION CONFIDENCE TESTS GREEN");
