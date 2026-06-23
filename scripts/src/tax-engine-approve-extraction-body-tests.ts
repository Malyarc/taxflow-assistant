/**
 * AI-extraction approve-body regression (audit 2026-06-23, F1 — CRITICAL).
 *
 * The review-extraction modal's `handleApprove` body-builder had drifted out of
 * sync with the `ApproveExtractionBody` zod schema, so the server's
 * `safeParse` rejected the approve POST with HTTP 400:
 *   - `box12Codes` is `zod.array(...).optional()` but was always sent as a raw
 *     STRING (populated) or `null` (empty) → EVERY W-2 approval failed.
 *   - `retirementPlanBox13` is `zod.boolean().nullish()` but was sent as the
 *     select's "true"/"false" string.
 *   - 6 money fields (dependentCareBenefitsBox10, localWagesBox18, localTaxBox19,
 *     washSaleLossDisallowed, refundOfOverpaidInterest, voluntaryFederalWithholding)
 *     were missing from the numeric-key set → sent as strings (fail `.number()`).
 *
 * The builder is now the pure `buildApproveBody` (artifacts/tax-app/src/lib/
 * approveExtractionBody.ts). This test pipes its output through the REAL generated
 * `ApproveExtractionBody` schema — the exact server-side gate — for each case that
 * used to 400, with precise negative controls (one field mutated off a known-good
 * body) proving the old shapes are correctly rejected.
 */

import { buildApproveBody } from "../../artifacts/tax-app/src/lib/approveExtractionBody";
import { ApproveExtractionBody } from "../../lib/api-zod/src/generated/api";

const PASS: string[] = [];
const FAIL: string[] = [];
function checkExact(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function parses(label: string, body: Record<string, unknown>) {
  const r = ApproveExtractionBody.safeParse(body);
  if (r.success) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: ${JSON.stringify(r.error.issues?.[0])}`);
}
function rejects(label: string, body: Record<string, unknown>) {
  const r = ApproveExtractionBody.safeParse(body);
  if (!r.success) PASS.push(`OK ${label}`);
  else FAIL.push(`FAIL ${label}: expected the schema to REJECT this shape, but it parsed`);
}

const W2_KEYS = [
  "employerName", "employerEin", "employeeSSN", "wagesBox1", "federalTaxWithheldBox2",
  "socialSecurityWagesBox3", "socialSecurityTaxBox4", "medicareWagesBox5", "medicareTaxBox6",
  "dependentCareBenefitsBox10", "box12Codes", "retirementPlanBox13", "stateWagesBox16",
  "stateTaxWithheldBox17", "stateCode", "localWagesBox18", "localTaxBox19", "localityNameBox20",
];
const B_KEYS = [
  "payerName", "payerTin", "recipientTin", "federalTaxWithheld", "stateTaxWithheld", "stateCode",
  "proceeds", "costBasis", "shortTermGainLoss", "longTermGainLoss", "washSaleLossDisallowed",
];
const INFO_1098_KEYS = ["payerName", "payerTin", "stateCode", "mortgageInterestReceived", "refundOfOverpaidInterest", "realEstateTaxes"];
const INFO_SSA_KEYS = ["payerName", "payerTin", "stateCode", "netSocialSecurityBenefits", "voluntaryFederalWithholding"];

// ── W-2: box12 + box13 + box10/18/19 all populated (the case that ALWAYS 400'd) ──
const w2 = buildApproveBody({
  recordType: "w2", taxYear: 2024, allKeys: W2_KEYS,
  values: {
    employerName: "Acme", wagesBox1: "100000", box12Codes: "D=23000; W=4150",
    retirementPlanBox13: "true", dependentCareBenefitsBox10: "5000",
    localWagesBox18: "100000", localTaxBox19: "3000", localityNameBox20: "NYC",
  },
});
parses("W-2 (box12 + box13 + box10/18/19) approve body PARSES", w2);
checkExact("box12Codes coerced to an array", Array.isArray(w2.box12Codes), true);
checkExact("retirementPlanBox13 coerced to boolean true", w2.retirementPlanBox13, true);
checkExact("dependentCareBenefitsBox10 coerced to number", w2.dependentCareBenefitsBox10, 5000);
checkExact("localTaxBox19 coerced to number", w2.localTaxBox19, 3000);

// ── W-2 with EMPTY box12: must omit the key (schema is .optional(), rejects null) ──
const w2Empty = buildApproveBody({ recordType: "w2", taxYear: 2024, allKeys: W2_KEYS, values: { wagesBox1: "50000" } });
parses("W-2 (empty box12) approve body PARSES", w2Empty);
checkExact("empty box12Codes is OMITTED (not null)", "box12Codes" in w2Empty, false);

// ── 1099-B with a broker-reported wash sale (Box 1g) ──
const b = buildApproveBody({
  recordType: "form1099", taxYear: 2024, formType: "B", allKeys: B_KEYS,
  values: { proceeds: "10000", costBasis: "8000", shortTermGainLoss: "2000", washSaleLossDisallowed: "1500" },
});
parses("1099-B (wash sale Box 1g) approve body PARSES", b);
checkExact("washSaleLossDisallowed coerced to number", b.washSaleLossDisallowed, 1500);

// ── 1098 Box 4 (refund of overpaid interest) ──
const i1098 = buildApproveBody({
  recordType: "info_return", taxYear: 2024, infoType: "1098", allKeys: INFO_1098_KEYS,
  values: { mortgageInterestReceived: "12000", refundOfOverpaidInterest: "1200" },
});
parses("1098 (Box 4 refund) approve body PARSES", i1098);
checkExact("refundOfOverpaidInterest coerced to number", i1098.refundOfOverpaidInterest, 1200);

// ── SSA-1099 Box 6 (voluntary withholding) ──
const ssa = buildApproveBody({
  recordType: "info_return", taxYear: 2024, infoType: "ssa1099", allKeys: INFO_SSA_KEYS,
  values: { netSocialSecurityBenefits: "24000", voluntaryFederalWithholding: "3600" },
});
parses("SSA-1099 (Box 6 withholding) approve body PARSES", ssa);
checkExact("voluntaryFederalWithholding coerced to number", ssa.voluntaryFederalWithholding, 3600);

// ── Negative controls: the OLD buggy shapes (one field off a known-good body) ──
rejects("OLD box12Codes as STRING → schema rejects", { ...w2, box12Codes: "D=23000" });
rejects("OLD box12Codes as NULL → schema rejects (.optional)", { ...w2, box12Codes: null });
rejects("OLD washSaleLossDisallowed as STRING → schema rejects", { ...b, washSaleLossDisallowed: "1500" });
rejects("OLD voluntaryFederalWithholding as STRING → schema rejects", { ...ssa, voluntaryFederalWithholding: "3600" });

// ── summary ──
console.log(`\n${"═".repeat(70)}`);
for (const f of FAIL) console.log(f);
console.log(`APPROVE-EXTRACTION-BODY: ${PASS.length} passed, ${FAIL.length} failed`);
console.log(`RESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) process.exit(1);
