/**
 * AI extraction wrapper for the benchmark.
 *
 * Calls the same Gemini-via-OpenAI-compat endpoint that the production
 * documentExtractor uses, with the same prompts. Inline (rather than
 * importing from artifacts/api-server) so the benchmark stays runnable
 * even when the server is down or has diverged.
 *
 * Modes:
 *   - LIVE: AI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) is set →
 *     calls the real model.
 *   - MOCK: no key → returns a deterministic "mostly correct with realistic
 *     noise" extraction by perturbing the truth. Useful to validate the
 *     harness end-to-end and generate sample reports locally.
 */

import { openai, aiEnabled, aiModel } from "@workspace/integrations-openai-ai-server";
import type { ExtractedRecord, FormKind, W2Fields, F1099Fields } from "./types.js";
import { SeededRng } from "./rng.js";

// ── Prompts ─────────────────────────────────────────────────────────────────
// Kept in sync with artifacts/api-server/src/lib/documentExtractor.ts. If you
// change one, change the other (or build a shared package — left as a
// follow-up since the cycle here is "run benchmark before/after change").

const W2_VISION_PROMPT = `You are a tax document extraction specialist. Extract W-2 form data from the image.
Return ONLY a valid JSON object with two top-level keys: "data" and "boxes".

"data" contains the extracted values:
{
  "employerName": string or null,
  "employerEin": string or null (format: XX-XXXXXXX),
  "employeeSSN": string or null (format: XXX-XX-XXXX, last 4 only if partial),
  "wagesBox1": number or null,
  "federalTaxWithheldBox2": number or null,
  "socialSecurityWagesBox3": number or null,
  "socialSecurityTaxBox4": number or null,
  "medicareWagesBox5": number or null,
  "medicareTaxBox6": number or null,
  "stateTaxWithheldBox17": number or null,
  "stateWagesBox16": number or null,
  "stateCode": string or null
}

"boxes" can be omitted for this benchmark. Final response format:
{ "data": { ... } }`;

const FORM_1099_PROMPT = `You are a tax document extraction specialist. The image is a 1099 form. First, IDENTIFY which 1099 type it is from the form's header (1099-NEC, 1099-MISC, 1099-INT, 1099-DIV, 1099-B, 1099-R, 1099-G, or 1099-K). Then extract the relevant fields.

Return ONLY a valid JSON object with one top-level key: "data".

"data" must include "formType" (one of: "nec", "misc", "int", "div", "b", "r", "g", "k") and the relevant fields for that form type. Common fields across all forms:
{
  "formType": "nec" | "misc" | "int" | "div" | "b" | "r" | "g" | "k",
  "payerName": string or null,
  "payerTin": string or null (XX-XXXXXXX format),
  "recipientTin": string or null (last 4 only if partial),
  "federalTaxWithheld": number or null,
  "stateTaxWithheld": number or null,
  "stateCode": string or null (2-letter)
}

Per-form fields (only include the relevant ones based on formType):
  nec:  { "nonemployeeCompensation": number }
  misc: { "rents", "royalties", "otherIncome", "fishingBoatProceeds", "medicalAndHealthcare" }
  int:  { "interestIncome", "earlyWithdrawalPenalty", "usTreasuryInterest", "taxExemptInterest" }
  div:  { "ordinaryDividends", "qualifiedDividends", "totalCapitalGainDistribution", "nondividendDistributions" }
  b:    { "proceeds", "costBasis", "shortTermGainLoss", "longTermGainLoss" }
  r:    { "grossDistribution", "taxableAmount", "distributionCode", "iraSepSimple" }
  g:    { "unemploymentCompensation", "stateLocalRefund" }
  k:    { "grossPaymentAmount" }

Final response format: { "data": { "formType": "...", ...fields } }`;

// ── Parsing helpers ─────────────────────────────────────────────────────────

function extractJsonObject(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function coerceNumeric(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function normalizeData(parsed: Record<string, unknown>): Record<string, unknown> {
  // Tolerate either {data: {...}} or flat data.
  const inner = (parsed.data && typeof parsed.data === "object")
    ? parsed.data as Record<string, unknown>
    : parsed;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inner)) {
    if (v == null) continue;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed) out[k] = trimmed;
      continue;
    }
    if (typeof v === "number") {
      if (Number.isFinite(v)) out[k] = v;
      continue;
    }
    // Try string → number coercion for currency-looking strings
    const num = coerceNumeric(v);
    if (num !== undefined) out[k] = num;
  }
  // formType normalization
  if (typeof out.formType === "string") {
    const t = out.formType.toLowerCase().replace(/^1099-?/, "");
    if (["nec", "misc", "int", "div", "b", "r", "g", "k"].includes(t)) out.formType = t;
  }
  return out;
}

// ── Live extraction ─────────────────────────────────────────────────────────

async function liveExtract(
  kind: FormKind,
  base64Pdf: string,
): Promise<Record<string, unknown>> {
  const prompt = kind === "w2" ? W2_VISION_PROMPT : FORM_1099_PROMPT;
  const userText = kind === "w2"
    ? "Extract W-2 data from this image."
    : "Identify the 1099 type and extract relevant fields.";

  const response = await openai.chat.completions.create({
    model: aiModel,
    max_completion_tokens: 4096,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  return normalizeData(extractJsonObject(response.choices[0]?.message?.content ?? "{}"));
}

// ── Mock extraction ─────────────────────────────────────────────────────────
// Simulates a vision model with ~85% per-field accuracy, occasional OCR
// digit swaps on numerics, occasional missed fields, and occasional
// formType confusion. Deterministic given the id.

const NUMERIC_FIELDS = new Set([
  "wagesBox1", "federalTaxWithheldBox2", "socialSecurityWagesBox3", "socialSecurityTaxBox4",
  "medicareWagesBox5", "medicareTaxBox6", "stateWagesBox16", "stateTaxWithheldBox17",
  "federalTaxWithheld", "stateTaxWithheld",
  "nonemployeeCompensation",
  "rents", "royalties", "otherIncome", "fishingBoatProceeds", "medicalAndHealthcare",
  "interestIncome", "earlyWithdrawalPenalty", "usTreasuryInterest", "taxExemptInterest",
  "ordinaryDividends", "qualifiedDividends", "totalCapitalGainDistribution", "nondividendDistributions",
  "proceeds", "costBasis", "shortTermGainLoss", "longTermGainLoss",
  "grossDistribution", "taxableAmount",
  "unemploymentCompensation", "stateLocalRefund",
  "grossPaymentAmount",
]);

function perturbNumber(rng: SeededRng, n: number): number {
  // Simulate OCR: occasional digit-swap, occasional dropped trailing decimal,
  // occasional 5-vs-S type confusion (small magnitude).
  const choice = rng.next();
  if (choice < 0.55) return n; // exact
  if (choice < 0.70) return Math.round(n * 100) / 100; // round to cents (no change for ints)
  if (choice < 0.80) return n + rng.int(-3, 3); // small numeric drift
  if (choice < 0.90) return Math.round(n * 10) / 10; // truncate to 1 decimal
  // Off-by-10x error (a famous OCR failure mode)
  return rng.next() < 0.5 ? n / 10 : n * 10;
}

function mockExtract(
  kind: FormKind,
  truth: W2Fields | F1099Fields,
  seed: number,
): Record<string, unknown> {
  const rng = new SeededRng(seed);
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(truth)) {
    // ~10% drop rate — simulate "field not detected"
    if (rng.next() < 0.10) continue;
    if (v == null) continue;

    if (typeof v === "number" && NUMERIC_FIELDS.has(k)) {
      out[k] = perturbNumber(rng, v);
    } else if (typeof v === "string") {
      // ~5% form-type confusion for 1099s
      if (k === "formType" && rng.next() < 0.05) {
        const types: Array<F1099Fields["formType"]> = ["nec", "misc", "int", "div", "b", "r", "g", "k"];
        const alt = types[rng.int(0, types.length - 1)];
        out[k] = alt;
      } else {
        out[k] = v;
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface ExtractOptions {
  /** Forces mock mode even when an API key is configured. */
  forceMock?: boolean;
}

export async function runExtraction(
  id: string,
  kind: FormKind,
  truth: W2Fields | F1099Fields,
  base64Pdf: string | null,
  opts: ExtractOptions = {},
): Promise<ExtractedRecord> {
  const start = Date.now();
  const useMock = opts.forceMock || !aiEnabled;
  try {
    if (useMock) {
      // Deterministic mock seed from the id
      const seed = Array.from(id).reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 1);
      const extracted = mockExtract(kind, truth, seed);
      return { id, kind, extracted, durationMs: Date.now() - start };
    }
    if (!base64Pdf) throw new Error("LIVE mode requires base64Pdf");
    const extracted = await liveExtract(kind, base64Pdf);
    return { id, kind, extracted, durationMs: Date.now() - start };
  } catch (err) {
    return {
      id, kind, extracted: {}, durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function modeDescription(forceMock = false): "MOCK" | "LIVE" {
  return (forceMock || !aiEnabled) ? "MOCK" : "LIVE";
}
