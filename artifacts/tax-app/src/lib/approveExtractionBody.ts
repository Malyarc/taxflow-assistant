/**
 * Pure builder for the ReviewExtractionModal approve body.
 *
 * Lives apart from the modal (NO React/JSX imports) so it can be unit-tested in
 * isolation — the body it produces must match the server's `ApproveExtractionBody`
 * zod schema exactly, and that contract is easy to break by hand.
 *
 * Key shape rules (the ones that previously mismatched and 400'd):
 *  - box12Codes        — zod.array({code,amount}).optional(): parse the
 *                        "D=23000; W=4150" string; OMIT the key when empty
 *                        (`.optional()` rejects both null AND a raw string).
 *  - retirementPlanBox13 — zod.boolean().nullish(): emit true/false, omit when empty.
 *  - numeric boxes     — zod.number().nullish(): Number()|null.
 */

/** T1.0j — "D=23000; W=4150" ⇄ [{code:"D",amount:23000},{code:"W",amount:4150}].
 *  Tolerates comma separators, spaces, ":" instead of "=", and $/commas in amounts.
 *  Invalid segments are dropped (the CPA sees exactly what will be stored via the
 *  diff indicator). */
export function parseBox12String(s: string): Array<{ code: string; amount: number }> {
  const out: Array<{ code: string; amount: number }> = [];
  for (const seg of s.split(/[;,]/)) {
    const m = seg.trim().match(/^([A-Za-z]{1,2})\s*[=:]?\s*\$?([\d,]+(?:\.\d+)?)$/);
    if (!m) continue;
    const amount = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    out.push({ code: m[1].toUpperCase(), amount });
  }
  return out;
}

/** Every key the server expects as `zod.number().nullish()` — across W-2, 1099,
 *  and information-return bodies. Sent as Number()|null; everything else (when
 *  populated) is sent as a string. */
export const APPROVE_NUMERIC_KEYS: ReadonlySet<string> = new Set([
  "wagesBox1","federalTaxWithheldBox2","socialSecurityWagesBox3","socialSecurityTaxBox4",
  "medicareWagesBox5","medicareTaxBox6","stateTaxWithheldBox17","stateWagesBox16",
  // T1.0j (M-5) — W-2 Box 10 / 18 / 19.
  "dependentCareBenefitsBox10","localWagesBox18","localTaxBox19",
  "federalTaxWithheld","stateTaxWithheld","nonemployeeCompensation","rents","royalties",
  "otherIncome","fishingBoatProceeds","medicalAndHealthcare","interestIncome",
  "earlyWithdrawalPenalty","usTreasuryInterest","taxExemptInterest","ordinaryDividends",
  "qualifiedDividends","totalCapitalGainDistribution","nondividendDistributions",
  "proceeds","costBasis","shortTermGainLoss","longTermGainLoss","grossDistribution",
  "taxableAmount","unemploymentCompensation","stateLocalRefund","grossPaymentAmount",
  // T1.0j (M-3) — Form 1099-B Box 1g.
  "washSaleLossDisallowed",
  // info-return numeric boxes
  "mortgageInterestReceived","realEstateTaxes","qualifiedTuition","scholarshipsGrants",
  "studentLoanInterest","annualPremium","annualSlcsp","annualAdvancePtc",
  "netSocialSecurityBenefits","gamblingWinnings","gamblingFederalWithheld",
  // T1.0j (H-2) — Form 1098 Box 4; (H-1) SSA-1099 Box 6.
  "refundOfOverpaidInterest","voluntaryFederalWithholding",
]);

interface BuildApproveBodyArgs {
  recordType: "w2" | "form1099" | "info_return";
  taxYear: number;
  /** The full key set to read from `values` (W-2 keys, 1099 value keys, or
   *  info-return value keys — the caller decides which set). */
  allKeys: string[];
  /** Current form values, always strings (currency editing); "" / undefined = empty. */
  values: Record<string, string | undefined>;
  formType?: string | null;
  infoType?: string | null;
}

/** Build the approve body so each field matches its server zod shape. Empty
 *  values become null (numbers/strings) or are OMITTED (box12Codes /
 *  retirementPlanBox13, whose schemas reject null). */
export function buildApproveBody(args: BuildApproveBodyArgs): Record<string, unknown> {
  const { recordType, taxYear, allKeys, values, formType, infoType } = args;
  const body: Record<string, unknown> = { recordType, taxYear };
  for (const key of allKeys) {
    const raw = values[key];
    const empty = raw == null || raw === "";
    if (key === "box12Codes") {
      // zod.array(...).optional() — OMIT when empty (never send null/string).
      const parsed = empty ? [] : parseBox12String(raw);
      if (parsed.length > 0) body[key] = parsed;
      continue;
    }
    if (key === "retirementPlanBox13") {
      // zod.boolean().nullish() — emit true/false; omit when empty.
      if (!empty) body[key] = raw === "true";
      continue;
    }
    if (empty) {
      body[key] = null;
      continue;
    }
    if (APPROVE_NUMERIC_KEYS.has(key)) {
      const n = Number(raw);
      body[key] = Number.isFinite(n) ? n : null;
    } else {
      body[key] = raw;
    }
  }
  if (formType != null) body.formType = formType;
  if (infoType != null) body.infoType = infoType;
  return body;
}
