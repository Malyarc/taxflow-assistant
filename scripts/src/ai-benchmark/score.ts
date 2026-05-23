/**
 * Per-field scoring for AI extraction benchmark.
 *
 * For each (document, field):
 *   TP (true positive)  = truth has a value AND extracted matches within tol.
 *   FP (false positive) = extracted has a value but doesn't match truth, OR
 *                         truth has no value but extracted did.
 *   FN (false negative) = truth has a value but extraction is null/wrong.
 *   TN (true negative)  = both null.
 *
 * A mismatch counts as BOTH FP and FN — the extractor wrongly emitted *and*
 * failed to emit the right value.
 *
 * Aggregates: precision = TP / (TP + FP); recall = TP / (TP + FN);
 * F1 = 2PR/(P+R). When no positives, precision/recall default to 1.
 */

import type {
  CorpusEntry, ExtractedRecord, FieldResult, FieldAggregate, MatchKind,
} from "./types.js";

/** Treat values within this tolerance as equal for numeric fields. */
const MONEY_TOL = 1.0;

function isNumericField(field: string): boolean {
  return /(Box|Income|Tax|Compensation|Distribution|Refund|Penalty|Interest|Dividend|Proceed|Basis|Gain|Loss|Amount|Royalt|Rent)/i.test(field);
}

function equalScalar(field: string, a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (isNumericField(field) && typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= MONEY_TOL;
  }
  // String fields — case-insensitive, whitespace-collapsed compare for proper
  // nouns; exact for short codes (formType, distributionCode, stateCode).
  if (typeof a === "string" && typeof b === "string") {
    if (field === "formType" || field === "stateCode"
      || field === "distributionCode" || field === "iraSepSimple") {
      return a.trim().toUpperCase() === b.trim().toUpperCase();
    }
    return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
  }
  return a === b;
}

function classify(field: string, truth: unknown, extracted: unknown): MatchKind {
  const hasTruth = truth != null && truth !== "";
  const hasExtract = extracted != null && extracted !== "";
  if (!hasTruth && !hasExtract) return "TN";
  if (hasTruth && hasExtract) {
    return equalScalar(field, truth, extracted) ? "TP" : "FP"; // FP if value disagrees
    // Note: we treat a wrong value as FP. The matching FN is implicit when we
    // aggregate (any non-TP truth-present case counts toward FN below).
  }
  if (!hasTruth && hasExtract) return "FP"; // extractor hallucinated
  return "FN"; // truth present, extracted missing
}

/** Per-field results for a single document. */
export function scoreDocument(entry: CorpusEntry, ext: ExtractedRecord): FieldResult[] {
  const truth = entry.truth as Record<string, unknown>;
  const got = ext.extracted as Record<string, unknown>;
  // Union of keys so we catch extractor hallucinations
  const keys = new Set<string>([...Object.keys(truth), ...Object.keys(got)]);
  const results: FieldResult[] = [];
  for (const field of keys) {
    const tv = truth[field];
    const ev = got[field];
    results.push({
      id: entry.id, kind: entry.kind, field,
      truthValue: tv ?? null,
      extractedValue: ev ?? null,
      match: classify(field, tv, ev),
    });
  }
  return results;
}

/** Aggregate across all field rows, broken down by (form-kind, field). */
export function aggregate(rows: FieldResult[]): FieldAggregate[] {
  // Bucket key = `${kind}::${field}` and `all::${field}`
  const buckets = new Map<string, { tp: number; fp: number; fn: number; tn: number; kind: string; field: string }>();
  const bump = (key: string, kind: string, field: string, m: MatchKind): void => {
    let b = buckets.get(key);
    if (!b) {
      b = { tp: 0, fp: 0, fn: 0, tn: 0, kind, field };
      buckets.set(key, b);
    }
    if (m === "TP") b.tp++;
    else if (m === "FP") {
      b.fp++;
      // A wrong-value FP (where truth WAS present) also counts as FN
      // (the right value was missed). Detected by checking; we re-derive
      // from the row in the caller's loop below.
    } else if (m === "FN") b.fn++;
    else b.tn++;
  };

  for (const r of rows) {
    const wasWrongValue = (r.match === "FP" && r.truthValue != null && r.truthValue !== "");
    bump(`${r.kind}::${r.field}`, r.kind, r.field, r.match);
    bump(`all::${r.field}`, "all", r.field, r.match);
    if (wasWrongValue) {
      // Add the implicit FN
      const k1 = `${r.kind}::${r.field}`;
      const k2 = `all::${r.field}`;
      buckets.get(k1)!.fn++;
      buckets.get(k2)!.fn++;
    }
  }

  const out: FieldAggregate[] = [];
  for (const b of buckets.values()) {
    const denomP = b.tp + b.fp;
    const denomR = b.tp + b.fn;
    const precision = denomP > 0 ? b.tp / denomP : 1;
    const recall = denomR > 0 ? b.tp / denomR : 1;
    const f1 = (precision + recall > 0) ? (2 * precision * recall) / (precision + recall) : 0;
    out.push({ kind: b.kind as FieldAggregate["kind"], field: b.field, tp: b.tp, fp: b.fp, fn: b.fn, tn: b.tn, precision, recall, f1 });
  }
  // Stable sort: all-bucket first, then by kind alphabetically, then by field.
  out.sort((a, b) => {
    if (a.kind === "all" && b.kind !== "all") return -1;
    if (b.kind === "all" && a.kind !== "all") return 1;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.field.localeCompare(b.field);
  });
  return out;
}

/** Top-line numbers across the whole run. */
export function overall(rows: FieldResult[]): { tp: number; fp: number; fn: number; tn: number; precision: number; recall: number; f1: number; accuracy: number } {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const r of rows) {
    if (r.match === "TP") tp++;
    else if (r.match === "FP") {
      fp++;
      if (r.truthValue != null && r.truthValue !== "") fn++; // wrong value also missed the right one
    }
    else if (r.match === "FN") fn++;
    else tn++;
  }
  const total = tp + fp + fn + tn;
  const accuracy = total > 0 ? (tp + tn) / total : 0;
  const denomP = tp + fp, denomR = tp + fn;
  const precision = denomP > 0 ? tp / denomP : 1;
  const recall = denomR > 0 ? tp / denomR : 1;
  const f1 = (precision + recall > 0) ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, precision, recall, f1, accuracy };
}
