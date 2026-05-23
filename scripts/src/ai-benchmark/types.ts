/**
 * Shared types for the AI extraction benchmark harness.
 *
 * The benchmark generates a labeled corpus of synthetic W-2 and 1099 PDFs
 * (deterministic, seeded RNG → reproducible), runs each through the same
 * extraction code path used in production (`extractW2DataFromFile` /
 * `extract1099DataFromFile`), and computes per-field precision / recall / F1.
 *
 * Synthetic vs. real: the deliverable the CPA design partner cares about is
 * "what fraction of fields does the AI get right, and which fields does it
 * miss?" Synthetic forms give us perfect ground truth and let us cover
 * 8 form variants × dozens of samples without sourcing real (PII-bearing)
 * taxpayer documents. Layouts mimic real IRS forms closely enough that vision
 * models extract from them roughly the same way as from real forms; partner
 * can swap in real anonymized samples later by writing a new corpus loader.
 */

export type FormKind =
  | "w2"
  | "1099-nec"
  | "1099-int"
  | "1099-div"
  | "1099-b"
  | "1099-misc"
  | "1099-r"
  | "1099-g"
  | "1099-k";

export interface CorpusEntry<TFields = Record<string, unknown>> {
  /** Stable id like "w2-001". Used as file name (.pdf) and as report key. */
  id: string;
  kind: FormKind;
  /** Ground-truth field values. Numeric fields are dollars (Number). */
  truth: TFields;
}

// ── W-2 ─────────────────────────────────────────────────────────────────────

export interface W2Fields {
  employerName: string;
  employerEin: string;
  employeeSSN: string;
  wagesBox1: number;
  federalTaxWithheldBox2: number;
  socialSecurityWagesBox3: number;
  socialSecurityTaxBox4: number;
  medicareWagesBox5: number;
  medicareTaxBox6: number;
  stateWagesBox16: number;
  stateTaxWithheldBox17: number;
  stateCode: string;
}

// ── 1099 (union; specific fields per type are set, others omitted) ──────────

export interface F1099Common {
  formType: "nec" | "misc" | "int" | "div" | "b" | "r" | "g" | "k";
  payerName: string;
  payerTin: string;
  recipientTin: string;
  federalTaxWithheld?: number;
  stateTaxWithheld?: number;
  stateCode?: string;
}

export interface F1099NEC extends F1099Common {
  formType: "nec";
  nonemployeeCompensation: number;
}

export interface F1099MISC extends F1099Common {
  formType: "misc";
  rents?: number;
  royalties?: number;
  otherIncome?: number;
  fishingBoatProceeds?: number;
  medicalAndHealthcare?: number;
}

export interface F1099INT extends F1099Common {
  formType: "int";
  interestIncome?: number;
  earlyWithdrawalPenalty?: number;
  usTreasuryInterest?: number;
  taxExemptInterest?: number;
}

export interface F1099DIV extends F1099Common {
  formType: "div";
  ordinaryDividends?: number;
  qualifiedDividends?: number;
  totalCapitalGainDistribution?: number;
  nondividendDistributions?: number;
}

export interface F1099B extends F1099Common {
  formType: "b";
  proceeds?: number;
  costBasis?: number;
  shortTermGainLoss?: number;
  longTermGainLoss?: number;
}

export interface F1099R extends F1099Common {
  formType: "r";
  grossDistribution?: number;
  taxableAmount?: number;
  distributionCode?: string;
  iraSepSimple?: string;
}

export interface F1099G extends F1099Common {
  formType: "g";
  unemploymentCompensation?: number;
  stateLocalRefund?: number;
}

export interface F1099K extends F1099Common {
  formType: "k";
  grossPaymentAmount?: number;
}

export type F1099Fields =
  | F1099NEC | F1099MISC | F1099INT | F1099DIV
  | F1099B | F1099R | F1099G | F1099K;

// ── Extraction + scoring ────────────────────────────────────────────────────

export interface ExtractedRecord {
  id: string;
  kind: FormKind;
  extracted: Record<string, unknown>;
  durationMs: number;
  error?: string;
}

export type MatchKind = "TP" | "FP" | "FN" | "TN";

export interface FieldResult {
  id: string;
  kind: FormKind;
  field: string;
  truthValue: unknown;
  extractedValue: unknown;
  match: MatchKind;
}

export interface FieldAggregate {
  kind: FormKind | "all";
  field: string;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number; // TP / (TP + FP); 1 if no positives
  recall: number;    // TP / (TP + FN); 1 if no actual positives
  f1: number;
}
