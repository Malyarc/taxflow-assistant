/**
 * T2.2 D3 — Return Q&A grounding + sanitization tests.
 *
 * Pure (no API, no LLM — the LLM path needs a live key and is exercised the
 * same way the planning memo is). Verifies:
 *   - the grounding snapshot carries the full engine line set, whole-dollar
 *     rounded, with a hand-calc'd anchor return;
 *   - NO PII leaves through the snapshot (no last name / email / SSN / TIN);
 *   - question sanitization (control chars, length cap, empties);
 *   - the deterministic (no-consent / no-AI) fallback content.
 *
 * Anchor (single, FL, TY2024, $100,000 W-2, $20,000 withheld):
 *   std $14,600 → taxable $85,400 → tax 1,160 + 4,266 + (85,400−47,150)×22%
 *   = 5,426 + 8,415 = $13,841 → refund 20,000 − 13,841 = $6,159.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/tax-engine-return-qa-tests.ts
 */

import { computeTaxReturnPure, type TaxReturnInputs } from "../../artifacts/api-server/src/lib/taxReturnEngine";
import {
  sanitizeQuestion,
  buildReturnGrounding,
  deterministicAnswer,
  MAX_QUESTION_LENGTH,
} from "../../artifacts/api-server/src/lib/returnQa";

const PASS: string[] = [];
const FAIL: string[] = [];
function checkEq(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (cond) PASS.push(`✓ ${label}`);
  else FAIL.push(`✗ ${label}`);
}

// ── sanitizeQuestion ────────────────────────────────────────────────────────
checkEq("Q1 plain question passes", sanitizeQuestion("Why is my refund smaller?"), "Why is my refund smaller?");
checkEq("Q1 control chars stripped", sanitizeQuestion("why \u0007 is this?"), "why is this?");
checkEq("Q1 whitespace collapsed + trimmed", sanitizeQuestion("  what   about \t AMT  "), "what about AMT");
checkEq("Q1 empty → null", sanitizeQuestion("   "), null);
checkEq("Q1 non-string → null", sanitizeQuestion(42), null);
checkEq("Q1 undefined → null", sanitizeQuestion(undefined), null);
checkEq("Q1 capped at MAX_QUESTION_LENGTH", sanitizeQuestion("x".repeat(5000))?.length, MAX_QUESTION_LENGTH);
checkTrue("Q1 newlines survive", (sanitizeQuestion("line one\nline two") ?? "").includes("\n"));

// ── grounding snapshot ──────────────────────────────────────────────────────
const inputs: TaxReturnInputs = {
  client: { filingStatus: "single", state: "FL", taxYear: 2024 },
  w2s: [{ taxYear: 2024, wagesBox1: 100_000, federalTaxWithheldBox2: 20_000 }],
  form1099s: [],
  adjustments: [],
  taxYear: 2024,
};
const ret = computeTaxReturnPure(inputs);
const grounding = buildReturnGrounding(
  { firstName: "Pat", filingStatus: "single", state: "FL" },
  ret,
  [
    {
      strategyId: "G1.x", name: "Example strategy", category: "retirement", estSavings: 1234.56,
      confidence: 0.8, cpaEffortHours: 1, recurring: true, rationale: "r", action: "a",
      prerequisiteData: [], citation: "IRC §1", inputs: {},
    },
  ],
);

checkEq("G1 taxYear", grounding.taxYear, 2024);
checkEq("G1 totalIncome $100,000", grounding.totalIncome, 100_000);
checkEq("G1 AGI $100,000", grounding.adjustedGrossIncome, 100_000);
checkEq("G1 std ded $14,600", grounding.standardDeduction, 14_600);
checkEq("G1 taxable $85,400", grounding.taxableIncome, 85_400);
checkEq("G1 federal tax $13,841 (hand-calc)", grounding.federalTaxLiabilityPreCredits, 13_841);
checkEq("G1 withheld $20,000", grounding.federalTaxWithheld, 20_000);
checkEq("G1 refund $6,159", grounding.federalRefundOrOwed, 6_159);
checkEq("G1 state liability $0 (FL)", grounding.stateTaxLiability, 0);
checkEq("G1 first name only", grounding.clientFirstName, "Pat");
checkTrue("G1 effective rate is 4-dp number", typeof grounding.effectiveTaxRate === "number");
checkTrue("G1 carryforwards block present", typeof grounding.carryforwards === "object");
const opp = (grounding.planningOpportunities as Array<{ name: string; estSavings: number }>)[0];
checkEq("G1 planning hit name", opp.name, "Example strategy");
checkEq("G1 planning savings rounded to dollars", opp.estSavings, 1235);

// PII must never appear in the serialized snapshot — check every (nested) KEY
// against the PII field names (substring search would false-positive on
// "netOpera-tin-gLoss").
function deepKeys(v: unknown, out: string[] = []): string[] {
  if (v && typeof v === "object") {
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      out.push(k);
      deepKeys(child, out);
    }
  }
  return out;
}
const keys = deepKeys(grounding);
const piiKey = /(ssn|ein\b|lastname|email|phone|address|payertin|recipienttin)/i;
const leaked = keys.filter((k) => piiKey.test(k));
checkTrue(`G1 no PII keys in snapshot (leaked: ${leaked.join(",") || "none"})`, leaked.length === 0);

// Field-coverage floor: a question about any major area must have a number to
// cite. Count ≥ 40 scalar keys (incl. nested carryforwards).
const flatKeys = Object.keys(grounding).length + Object.keys(grounding.carryforwards as object).length;
checkTrue(`G1 snapshot breadth ≥ 45 keys (got ${flatKeys})`, flatKeys >= 45);

// ── deterministic fallback ──────────────────────────────────────────────────
const fallback = deterministicAnswer(grounding);
checkTrue("F1 fallback names the tax year", fallback.includes("TY2024"));
checkTrue("F1 fallback includes AGI", fallback.includes("$100,000"));
checkTrue("F1 fallback includes the refund", fallback.includes("$6,159"));
checkTrue("F1 fallback says refund (not balance due)", fallback.includes("refund"));
checkTrue("F1 fallback explains why it's deterministic", fallback.includes("§7216") || fallback.includes("AI disabled"));

console.log(`\nRESULTS: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length > 0) {
  for (const f of FAIL) console.error(f);
  process.exit(1);
}
