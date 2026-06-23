/**
 * ReviewExtractionModal
 *
 * The CPA-facing review step between AI extraction and committing data to a
 * client's income records. Renders a split-pane Dialog:
 *
 *   Left:  BoundedDocumentViewer (original W-2 / 1099 image or PDF with
 *          AI-detected bounding boxes overlaid).
 *   Right: Editable form pre-filled from the extracted JSON. Each input is
 *          interactive — focusing one highlights its box on the left.
 *
 * Footer actions: Approve (POST /documents/:id/approve, creates the income
 * record + audit log), Reject (status=rejected, no DB write to income tables),
 * Cancel (close without changes).
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/currency-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BoundedDocumentViewer, type FieldBoxes } from "./BoundedDocumentViewer";
import {
  useApproveExtraction,
  useRejectExtraction,
  getListDocumentsQueryKey,
  getListW2DataQueryKey,
  getListForm1099DataQueryKey,
  getGetTaxReturnQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import { validateW2, validateInfoReturn, type W2Flag } from "@workspace/validation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { buildApproveBody, parseBox12String } from "@/lib/approveExtractionBody";
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle, ArrowRight, Check, CircleSlash, Info, Pencil, Plus } from "lucide-react";

interface ExtractedPayload {
  text?: string;
  data?: Record<string, unknown>;
  boxes?: FieldBoxes;
}

interface DocLike {
  id: number;
  fileName: string;
  documentType: string;
  status: string;
  extractedText?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: number;
  clientTaxYear: number;
  /** Optional — used to flag W-2 state-code mismatches in the review modal. */
  clientState?: string;
  doc: DocLike | null;
}

function parseExtracted(text: string | null | undefined): ExtractedPayload {
  if (!text) return {};
  try {
    return JSON.parse(text) as ExtractedPayload;
  } catch {
    return {};
  }
}

// ─── Field definitions ───────────────────────────────────────────────────────

type FieldType = "money" | "string" | "ssn" | "ein" | "stateCode" | "formType" | "select";

interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  /** For type="select", the dropdown options. */
  options?: Array<{ value: string; label: string }>;
  /** True if this field is shown only when "Show all" is toggled on. */
  optional?: boolean;
  /** T1.0j — display-only: shown for verification (feeds the live validation
   *  flags) but NOT sent in the approve body and not editable. */
  readOnly?: boolean;
}

const W2_FIELDS: FieldDef[] = [
  { key: "employerName", label: "Employer name", type: "string" },
  { key: "employerEin", label: "Employer EIN", type: "ein" },
  { key: "employeeSSN", label: "Employee SSN", type: "ssn" },
  { key: "wagesBox1", label: "Box 1 — Wages, tips, other compensation", type: "money" },
  { key: "federalTaxWithheldBox2", label: "Box 2 — Federal income tax withheld", type: "money" },
  { key: "socialSecurityWagesBox3", label: "Box 3 — Social security wages", type: "money" },
  { key: "socialSecurityTaxBox4", label: "Box 4 — Social security tax withheld", type: "money" },
  { key: "medicareWagesBox5", label: "Box 5 — Medicare wages and tips", type: "money" },
  { key: "medicareTaxBox6", label: "Box 6 — Medicare tax withheld", type: "money" },
  // T1.0j (M-5) — W-2 extraction depth: Box 10 / 12 / 13 / 18-20.
  { key: "dependentCareBenefitsBox10", label: "Box 10 — Dependent care benefits", type: "money" },
  { key: "box12Codes", label: "Box 12 — Codes (format: D=23000; W=4150)", type: "string" },
  {
    key: "retirementPlanBox13",
    label: "Box 13 — Retirement plan",
    type: "select",
    options: [
      { value: "true", label: "Checked (suggests IRA workplace-plan flag)" },
      { value: "false", label: "Not checked" },
    ],
  },
  { key: "stateWagesBox16", label: "Box 16 — State wages", type: "money" },
  { key: "stateTaxWithheldBox17", label: "Box 17 — State income tax", type: "money" },
  { key: "stateCode", label: "State", type: "stateCode" },
  { key: "localWagesBox18", label: "Box 18 — Local wages", type: "money" },
  { key: "localTaxBox19", label: "Box 19 — Local income tax", type: "money" },
  { key: "localityNameBox20", label: "Box 20 — Locality name", type: "string" },
];

// parseBox12String moved to lib/approveExtractionBody.ts (pure, unit-testable);
// re-exported so existing importers still resolve it from this module.
export { parseBox12String };
function box12ToString(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v
    .filter((e): e is { code: string; amount: number } =>
      !!e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" &&
      Number.isFinite(Number((e as { amount?: unknown }).amount)))
    .map((e) => `${e.code}=${Number(e.amount)}`)
    .join("; ");
}

const FORM_1099_COMMON: FieldDef[] = [
  { key: "payerName", label: "Payer name", type: "string" },
  { key: "payerTin", label: "Payer TIN", type: "ein" },
  { key: "recipientTin", label: "Recipient TIN", type: "ssn" },
  { key: "federalTaxWithheld", label: "Federal income tax withheld", type: "money" },
  { key: "stateTaxWithheld", label: "State income tax withheld", type: "money" },
  { key: "stateCode", label: "State", type: "stateCode" },
];

/** Per-subtype 1099 fields. */
const FORM_1099_BY_TYPE: Record<string, FieldDef[]> = {
  NEC: [
    { key: "nonemployeeCompensation", label: "Box 1 — Nonemployee compensation", type: "money" },
  ],
  MISC: [
    { key: "rents", label: "Box 1 — Rents", type: "money" },
    { key: "royalties", label: "Box 2 — Royalties", type: "money" },
    { key: "otherIncome", label: "Box 3 — Other income", type: "money" },
    { key: "fishingBoatProceeds", label: "Box 5 — Fishing boat proceeds", type: "money" },
    { key: "medicalAndHealthcare", label: "Box 6 — Medical & healthcare", type: "money" },
  ],
  INT: [
    { key: "interestIncome", label: "Box 1 — Interest income", type: "money" },
    { key: "earlyWithdrawalPenalty", label: "Box 2 — Early withdrawal penalty", type: "money" },
    { key: "usTreasuryInterest", label: "Box 3 — U.S. Treasury interest", type: "money" },
    { key: "taxExemptInterest", label: "Box 8 — Tax-exempt interest", type: "money" },
  ],
  DIV: [
    { key: "ordinaryDividends", label: "Box 1a — Total ordinary dividends", type: "money" },
    { key: "qualifiedDividends", label: "Box 1b — Qualified dividends", type: "money" },
    { key: "totalCapitalGainDistribution", label: "Box 2a — Total capital gain dist.", type: "money" },
    { key: "nondividendDistributions", label: "Box 3 — Nondividend distributions", type: "money" },
  ],
  B: [
    { key: "proceeds", label: "Box 1d — Proceeds", type: "money" },
    { key: "costBasis", label: "Box 1e — Cost or other basis", type: "money" },
    { key: "shortTermGainLoss", label: "Short-term gain/loss (pre-wash-sale)", type: "money" },
    { key: "longTermGainLoss", label: "Long-term gain/loss (pre-wash-sale)", type: "money" },
    // T1.0j (M-3) — added back into the stored ST gain/loss on approve (Form
    // 8949 code "W"); zero it if the ST/LT totals already include the adjustment.
    { key: "washSaleLossDisallowed", label: "Box 1g — Wash sale loss disallowed", type: "money" },
  ],
  R: [
    { key: "grossDistribution", label: "Box 1 — Gross distribution", type: "money" },
    { key: "taxableAmount", label: "Box 2a — Taxable amount", type: "money" },
    { key: "distributionCode", label: "Box 7 — Distribution code(s)", type: "string" },
    { key: "iraSepSimple", label: "IRA/SEP/SIMPLE check", type: "string" },
  ],
  G: [
    { key: "unemploymentCompensation", label: "Box 1 — Unemployment compensation", type: "money" },
    { key: "stateLocalRefund", label: "Box 2 — State or local refund", type: "money" },
  ],
  K: [
    { key: "grossPaymentAmount", label: "Box 1a — Gross payment amount", type: "money" },
  ],
};

const ALL_1099_VALUE_KEYS = Array.from(
  new Set(
    Object.values(FORM_1099_BY_TYPE)
      .flat()
      .map((f) => f.key)
      .concat(FORM_1099_COMMON.map((f) => f.key)),
  ),
);

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

const FORM_1099_TYPES = ["NEC", "MISC", "INT", "DIV", "B", "R", "G", "K"];

// ── Information returns (1098 / 1098-T / 1098-E / 1095-A / SSA-1099 / W-2G) ──
const INFO_RETURN_COMMON: FieldDef[] = [
  { key: "payerName", label: "Filer / payer name", type: "string" },
  { key: "payerTin", label: "Filer TIN", type: "ein" },
];
const INFO_RETURN_BY_TYPE: Record<string, { label: string; fields: FieldDef[] }> = {
  "1098": { label: "Form 1098 — Mortgage Interest", fields: [
    { key: "mortgageInterestReceived", label: "Box 1 — Mortgage interest received", type: "money" },
    // T1.0j (H-2) — the server has netted Box 1 − Box 4 since audit fix A1, but
    // the modal never carried Box 4 → the netting was unreachable. Editable now.
    { key: "refundOfOverpaidInterest", label: "Box 4 — Refund of overpaid interest (nets against Box 1)", type: "money" },
    { key: "realEstateTaxes", label: "Box 10 — Real estate taxes", type: "money" },
  ] },
  "1098t": { label: "Form 1098-T — Tuition", fields: [
    { key: "qualifiedTuition", label: "Box 1 — Payments for qualified tuition", type: "money" },
    { key: "priorYearTuitionAdjustments", label: "Box 4 — Prior-year tuition adjustments", type: "money", readOnly: true },
    { key: "scholarshipsGrants", label: "Box 5 — Scholarships or grants", type: "money" },
    { key: "priorYearScholarshipAdjustments", label: "Box 6 — Prior-year scholarship adjustments", type: "money", readOnly: true },
    { key: "atLeastHalfTime", label: "Box 8 — At least half-time student", type: "string", readOnly: true },
    { key: "graduateStudent", label: "Box 9 — Graduate student", type: "string", readOnly: true },
  ] },
  "1098e": { label: "Form 1098-E — Student Loan Interest", fields: [
    { key: "studentLoanInterest", label: "Box 1 — Student loan interest received", type: "money" },
  ] },
  "1095a": { label: "Form 1095-A — Marketplace", fields: [
    { key: "annualPremium", label: "Part III-A — Annual enrollment premium", type: "money" },
    { key: "annualSlcsp", label: "Part III-B — Annual SLCSP premium", type: "money" },
    { key: "annualAdvancePtc", label: "Part III-C — Annual advance PTC", type: "money" },
  ] },
  "ssa1099": { label: "SSA-1099 — Social Security", fields: [
    // Box 3/4 shown read-only so the CPA can verify the Box 5 = Box 3 − Box 4
    // identity (the live flag below checks it).
    { key: "socialSecurityBenefitsPaid", label: "Box 3 — Benefits paid (gross)", type: "money", readOnly: true },
    { key: "benefitsRepaid", label: "Box 4 — Benefits repaid to SSA", type: "money", readOnly: true },
    { key: "netSocialSecurityBenefits", label: "Box 5 — Net benefits", type: "money" },
    // T1.0j (H-1) — Box 6 → withholding_adjustment on approve (was dropped).
    { key: "voluntaryFederalWithholding", label: "Box 6 — Voluntary federal income tax withheld", type: "money" },
  ] },
  "w2g": { label: "W-2G — Gambling Winnings", fields: [
    { key: "gamblingWinnings", label: "Box 1 — Reportable winnings", type: "money" },
    { key: "gamblingFederalWithheld", label: "Box 4 — Federal income tax withheld", type: "money" },
    { key: "gamblingStateWinnings", label: "Box 14 — State winnings", type: "money", readOnly: true },
    { key: "gamblingStateWithheld", label: "Box 15 — State income tax withheld", type: "money", readOnly: true },
  ] },
};
const DOC_TYPE_TO_INFO: Record<string, string> = {
  form_1098: "1098", form_1098t: "1098t", form_1098e: "1098e",
  form_1095a: "1095a", form_ssa1099: "ssa1099", form_w2g: "w2g",
};
// Keys sent in the approve body — read-only display fields are EXCLUDED (they
// exist for verification/validation only; the server doesn't map them).
const INFO_RETURN_VALUE_KEYS = Array.from(
  new Set(Object.values(INFO_RETURN_BY_TYPE).flatMap((g) => g.fields).filter((f) => !f.readOnly).map((f) => f.key)
    .concat(INFO_RETURN_COMMON.map((f) => f.key))),
);

/** Compute the visible field list for a record type + subtype + showAll toggle.
 *  Module-level + pure so both the render path and the unanchored-flags memo
 *  share one definition. */
function getVisibleFieldsFor(
  recordType: "w2" | "form1099" | "info_return" | null,
  infoType: string,
  formType: string,
  showAll: boolean,
  extracted: Record<string, unknown>,
): FieldDef[] {
  if (recordType == null) return [];
  if (recordType === "w2") return W2_FIELDS;
  if (recordType === "info_return") {
    const group = INFO_RETURN_BY_TYPE[infoType];
    return group ? [...INFO_RETURN_COMMON, ...group.fields] : INFO_RETURN_COMMON;
  }
  if (!formType) {
    // No formType yet — show only the common fields and the formType picker.
    return FORM_1099_COMMON;
  }
  const subtypeFields = FORM_1099_BY_TYPE[formType] ?? [];
  if (showAll) {
    // Merge subtype + common, then add any fields from OTHER subtypes the AI populated.
    const visible = [...FORM_1099_COMMON, ...subtypeFields];
    const visibleKeys = new Set(visible.map((f) => f.key));
    const otherSubtypeFields = Object.entries(FORM_1099_BY_TYPE)
      .filter(([k]) => k !== formType)
      .flatMap(([, fs]) => fs)
      .filter((f) => !visibleKeys.has(f.key));
    return [...visible, ...otherSubtypeFields];
  }
  // Default: common + this subtype's fields + any AI-extracted values from other subtypes.
  const visible = [...FORM_1099_COMMON, ...subtypeFields];
  const visibleKeys = new Set(visible.map((f) => f.key));
  const extraExtracted = Object.entries(FORM_1099_BY_TYPE)
    .filter(([k]) => k !== formType)
    .flatMap(([, fs]) => fs)
    .filter((f) => !visibleKeys.has(f.key) && extracted[f.key] != null);
  return [...visible, ...extraExtracted];
}

// ─── Modal component ─────────────────────────────────────────────────────────

export function ReviewExtractionModal({ open, onClose, clientId, clientTaxYear, clientState, doc }: Props) {
  const qc = useQueryClient();
  const approve = useApproveExtraction();
  const reject = useRejectExtraction();

  const payload = React.useMemo(() => parseExtracted(doc?.extractedText), [doc?.extractedText]);
  const extracted = payload.data ?? {};
  const boxes = payload.boxes ?? {};
  const isW2 = doc?.documentType === "w2";
  const isForm1099 = doc?.documentType === "form_1099";
  const isInfoReturn = doc != null && doc.documentType in DOC_TYPE_TO_INFO;
  // The infoType is the model's identification when present + valid, else the
  // upload documentType the CPA selected (authoritative fallback).
  const infoType: string =
    (typeof extracted.infoType === "string" && INFO_RETURN_BY_TYPE[extracted.infoType] ? extracted.infoType : "") ||
    (doc ? DOC_TYPE_TO_INFO[doc.documentType] ?? "" : "");

  const recordType: "w2" | "form1099" | "info_return" | null =
    isW2 ? "w2" : isForm1099 ? "form1099" : isInfoReturn ? "info_return" : null;

  // Form state — always strings (for currency editing); converted to numbers on submit.
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [taxYear, setTaxYear] = React.useState<number>(clientTaxYear);
  const [formType, setFormType] = React.useState<string>("");
  const [showAll, setShowAll] = React.useState(false);
  const [focusedField, setFocusedField] = React.useState<string | null>(null);
  const [rejectMode, setRejectMode] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");
  const inputRefs = React.useRef<Record<string, HTMLInputElement | HTMLTextAreaElement | null>>({});

  // Reset state whenever a new doc opens.
  React.useEffect(() => {
    if (!open || !doc) return;
    const initial: Record<string, string> = {};
    for (const [k, v] of Object.entries(extracted)) {
      if (v == null) continue;
      // T1.0j — non-scalar/boolean extracted fields need explicit serialization
      // (String([{…}]) === "[object Object]").
      if (k === "box12Codes") initial[k] = box12ToString(v);
      else if (typeof v === "boolean") initial[k] = v ? "true" : "false";
      else initial[k] = String(v);
    }
    setValues(initial);
    setTaxYear(clientTaxYear);
    setFormType(typeof extracted.formType === "string" ? extracted.formType : "");
    setShowAll(false);
    setFocusedField(null);
    setRejectMode(false);
    setRejectReason("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.id]);

  // ── Live W-2 / info-return sanity flags ──
  // Recompute every render — fast, no async state. For 1099 docs returns [].
  // T1.0j (M-1) — validateInfoReturn was DEAD CODE (its only caller was its own
  // test file); mirroring the W-2 live-flag pattern here makes the SSA
  // Box5=Box3−Box4 identity, W-2G withholding≤winnings, 1095-A APTC≤premium /
  // SLCSP=0, 1098-E §221 note, and negative-box checks reachable at the only
  // seam where the boxes exist (info-returns persist as adjustments, so
  // post-approve diagnostics can never reconstruct them).
  const liveFlags: W2Flag[] = React.useMemo(() => {
    const toNum = (v: string | undefined): number | null => {
      if (v == null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    if (recordType === "w2") {
      return validateW2(
        {
          taxYear,
          employerName: values.employerName,
          employerEin: values.employerEin,
          employeeSSN: values.employeeSSN,
          wagesBox1: toNum(values.wagesBox1),
          federalTaxWithheldBox2: toNum(values.federalTaxWithheldBox2),
          socialSecurityWagesBox3: toNum(values.socialSecurityWagesBox3),
          socialSecurityTaxBox4: toNum(values.socialSecurityTaxBox4),
          medicareWagesBox5: toNum(values.medicareWagesBox5),
          medicareTaxBox6: toNum(values.medicareTaxBox6),
          stateTaxWithheldBox17: toNum(values.stateTaxWithheldBox17),
          stateWagesBox16: toNum(values.stateWagesBox16),
          stateCode: values.stateCode,
        },
        { clientTaxYear, clientState },
      );
    }
    if (recordType === "info_return" && infoType) {
      // Editable fields read from `values`; read-only display fields were also
      // seeded into `values` from the extraction, so one source feeds both the
      // UI and the validator.
      return validateInfoReturn(
        {
          taxYear,
          infoType,
          payerName: values.payerName,
          payerTin: values.payerTin,
          stateCode: values.stateCode,
          mortgageInterestReceived: toNum(values.mortgageInterestReceived),
          refundOfOverpaidInterest: toNum(values.refundOfOverpaidInterest),
          realEstateTaxes: toNum(values.realEstateTaxes),
          qualifiedTuition: toNum(values.qualifiedTuition),
          scholarshipsGrants: toNum(values.scholarshipsGrants),
          studentLoanInterest: toNum(values.studentLoanInterest),
          annualPremium: toNum(values.annualPremium),
          annualSlcsp: toNum(values.annualSlcsp),
          annualAdvancePtc: toNum(values.annualAdvancePtc),
          socialSecurityBenefitsPaid: toNum(values.socialSecurityBenefitsPaid),
          benefitsRepaid: toNum(values.benefitsRepaid),
          netSocialSecurityBenefits: toNum(values.netSocialSecurityBenefits),
          voluntaryFederalWithholding: toNum(values.voluntaryFederalWithholding),
          gamblingWinnings: toNum(values.gamblingWinnings),
          gamblingFederalWithheld: toNum(values.gamblingFederalWithheld),
          gamblingStateWinnings: toNum(values.gamblingStateWinnings),
          gamblingStateWithheld: toNum(values.gamblingStateWithheld),
        },
        { clientTaxYear, clientState },
      );
    }
    return [];
  }, [recordType, infoType, taxYear, values, clientTaxYear, clientState]);

  // Flags that don't belong to a rendered field (record-level, or a field the
  // current form group doesn't show) — surfaced in a banner above the fields.
  const visibleFieldKeys = React.useMemo(
    () => new Set(getVisibleFieldsFor(recordType, infoType, formType, showAll, extracted).map((f) => f.key)),
    [recordType, infoType, formType, showAll, extracted],
  );
  const unanchoredFlags = liveFlags.filter((f) => f.field == null || !visibleFieldKeys.has(f.field));

  if (!doc || !recordType) return null;

  // ── Compute the visible field list based on recordType + showAll toggle ──
  function getVisibleFields(): FieldDef[] {
    if (recordType === "w2") return W2_FIELDS;
    if (recordType === "info_return") {
      const group = INFO_RETURN_BY_TYPE[infoType];
      return group ? [...INFO_RETURN_COMMON, ...group.fields] : INFO_RETURN_COMMON;
    }
    if (!formType) {
      // No formType yet — show only the common fields and the formType picker.
      return FORM_1099_COMMON;
    }
    const subtypeFields = FORM_1099_BY_TYPE[formType] ?? [];
    if (showAll) {
      // Merge subtype + common, then add any fields from OTHER subtypes the AI populated.
      const visible = [...FORM_1099_COMMON, ...subtypeFields];
      const visibleKeys = new Set(visible.map((f) => f.key));
      const otherSubtypeFields = Object.entries(FORM_1099_BY_TYPE)
        .filter(([k]) => k !== formType)
        .flatMap(([, fs]) => fs)
        .filter((f) => !visibleKeys.has(f.key));
      return [...visible, ...otherSubtypeFields];
    }
    // Default: common + this subtype's fields + any AI-extracted values from other subtypes.
    const visible = [...FORM_1099_COMMON, ...subtypeFields];
    const visibleKeys = new Set(visible.map((f) => f.key));
    const extraExtracted = Object.entries(FORM_1099_BY_TYPE)
      .filter(([k]) => k !== formType)
      .flatMap(([, fs]) => fs)
      .filter((f) => !visibleKeys.has(f.key) && extracted[f.key] != null);
    return [...visible, ...extraExtracted];
  }

  function handleApprove() {
    if (!doc || !recordType) return;
    if (recordType === "form1099" && !formType) {
      toast({ title: "Form type required", description: "Pick the 1099 subtype before approving.", variant: "destructive" });
      return;
    }
    if (recordType === "info_return" && !infoType) {
      toast({ title: "Form type required", description: "Could not determine the information-return type.", variant: "destructive" });
      return;
    }
    // W-2 carries all W-2 keys; 1099 carries all 1099 keys; info-return carries its
    // value keys (the unrelated ones are NULL on the server).
    const allKeys = recordType === "w2"
      ? W2_FIELDS.map((f) => f.key)
      : recordType === "info_return"
        ? INFO_RETURN_VALUE_KEYS
        : ALL_1099_VALUE_KEYS;
    const body = buildApproveBody({
      recordType,
      taxYear,
      allKeys,
      values,
      formType: recordType === "form1099" ? formType : undefined,
      infoType: recordType === "info_return" ? infoType : undefined,
    });
    approve.mutate(
      { clientId, documentId: doc.id, data: body as never },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListDocumentsQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getListW2DataQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getListForm1099DataQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Approved", description: "Record created and tax return recalculated." });
          onClose();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Unknown error";
          toast({ title: "Approve failed", description: msg, variant: "destructive" });
        },
      },
    );
  }

  function handleReject() {
    if (!doc) return;
    reject.mutate(
      { clientId, documentId: doc.id, data: { reason: rejectReason || null } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListDocumentsQueryKey(clientId) });
          toast({ title: "Rejected", description: "Document marked as rejected. No record created." });
          onClose();
        },
        onError: () => toast({ title: "Reject failed", variant: "destructive" }),
      },
    );
  }

  const visibleFields = getVisibleFields();
  const previewUrl = `/api/clients/${clientId}/documents/${doc.id}/content`;
  const submitting = approve.isPending || reject.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-6xl max-h-[92vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b">
          <DialogTitle className="text-base">
            Review extraction · <span className="font-mono text-sm">{doc.fileName}</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Verify the AI-extracted values against the source document. Edits are flagged with a yellow border and show the original AI value. Click "Approve & create record" to commit.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-0 overflow-hidden flex-1 min-h-0">
          {/* ── Left pane: document with box overlay ── */}
          <div className="border-r overflow-auto bg-muted/30 p-4">
            <BoundedDocumentViewer
              src={previewUrl}
              fileName={doc.fileName}
              boxes={boxes}
              highlightField={focusedField}
              onBoxClick={(field) => {
                setFocusedField(field);
                const el = inputRefs.current[field];
                if (el) el.focus();
              }}
            />
          </div>

          {/* ── Right pane: editable form ── */}
          <div className="overflow-auto p-6 space-y-4">
            {/* Tax year + (1099) formType */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="reviewTaxYear">Tax year</Label>
                <Input
                  id="reviewTaxYear"
                  type="number"
                  value={taxYear}
                  onChange={(e) => setTaxYear(Number(e.target.value) || clientTaxYear)}
                  min={2018}
                  max={new Date().getFullYear()}
                />
              </div>
              {recordType === "form1099" && (
                <div className="space-y-1.5">
                  <Label>1099 subtype</Label>
                  <Select value={formType} onValueChange={setFormType}>
                    <SelectTrigger><SelectValue placeholder="Select subtype" /></SelectTrigger>
                    <SelectContent>
                      {FORM_1099_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>1099-{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {recordType === "info_return" && (
                <div className="space-y-1.5">
                  <Label>Form</Label>
                  <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                    {INFO_RETURN_BY_TYPE[infoType]?.label ?? "Information return"}
                  </div>
                </div>
              )}
            </div>
            {recordType === "info_return" && (
              <p className="text-xs text-muted-foreground">
                On approve, these values are applied to the return as adjustments / client fields
                (e.g. 1098 → mortgage interest, SSA-1099 → Social Security benefits, 1095-A → Form 8962 inputs).
              </p>
            )}

            {/* Field list */}
            <div className="space-y-3">
              {visibleFields.map((f) => {
                const aiValue = extracted[f.key];
                const aiString = aiValue == null ? "" : String(aiValue);
                const currentValue = values[f.key] ?? "";
                const edited = currentValue !== aiString && (currentValue !== "" || aiString !== "");
                const fieldFlags = liveFlags.filter((flag) => flag.field === f.key);
                return (
                  <FieldRow
                    key={f.key}
                    field={f}
                    value={currentValue}
                    onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
                    onFocus={() => setFocusedField(f.key)}
                    onBlur={() => setFocusedField((prev) => (prev === f.key ? null : prev))}
                    edited={edited}
                    originalAiValue={aiString}
                    inputRef={(el) => { inputRefs.current[f.key] = el; }}
                    flags={fieldFlags}
                  />
                );
              })}
            </div>

            {recordType === "form1099" && formType && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowAll((s) => !s)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  {showAll ? "Show only this subtype's fields" : `Show all 1099 fields`}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="border-t px-6 py-3 flex items-center justify-between gap-3 bg-background">
          {rejectMode ? (
            <div className="flex items-center gap-2 flex-1">
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (optional)"
                rows={1}
                className="resize-none flex-1 h-9 min-h-9 py-1.5"
              />
              <Button variant="outline" size="sm" onClick={() => setRejectMode(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleReject} disabled={submitting}>
                Confirm reject
              </Button>
            </div>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setRejectMode(true)} disabled={submitting} className="text-destructive hover:text-destructive">
                Reject
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
                <Button onClick={handleApprove} disabled={submitting}>
                  {approve.isPending ? "Approving…" : "Approve & create record"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Field row ───────────────────────────────────────────────────────────────

interface FieldRowProps {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  edited: boolean;
  originalAiValue: string;
  inputRef: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  flags?: W2Flag[];
}

function FieldRow({ field, value, onChange, onFocus, onBlur, edited, originalAiValue, inputRef, flags }: FieldRowProps) {
  // Pick the most-severe flag (error > warning > info) to choose the highlight color.
  const flagList = flags ?? [];
  const hasError = flagList.some((f) => f.severity === "error");
  const hasWarning = flagList.some((f) => f.severity === "warning");

  // C14 diff state — what is the relationship between the AI value and the
  // CPA's current value? Drives an always-on small "AI: X → Y" diff indicator
  // so the CPA sees at a glance which fields they kept, changed, added, or
  // cleared (rather than having to hover a tooltip).
  const hasAi = originalAiValue !== "";
  const hasCpa = value !== "";
  let diffState: "kept" | "changed" | "added" | "cleared" | "absent";
  if (!hasAi && !hasCpa) diffState = "absent";
  else if (hasAi && !hasCpa) diffState = "cleared";
  else if (!hasAi && hasCpa) diffState = "added";
  else if (!edited) diffState = "kept";
  else diffState = "changed";

  return (
    <div
      className={cn(
        "space-y-1 rounded-md transition-colors px-2 -mx-2 py-1",
        edited && !hasError && !hasWarning && "bg-amber-50 border-l-2 border-amber-500 pl-3",
        hasError && "bg-destructive/5 border-l-2 border-destructive pl-3",
        hasWarning && !hasError && "bg-amber-50 border-l-2 border-amber-500 pl-3",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs">{field.label}</Label>
        <DiffIndicator state={diffState} field={field} aiValue={originalAiValue} cpaValue={value} />
      </div>
      {field.type === "money" ? (
        <CurrencyInput
          ref={inputRef as React.Ref<HTMLInputElement>}
          value={value}
          onChange={onChange}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      ) : field.type === "stateCode" ? (
        <Select value={value} onValueChange={(v) => onChange(v)}>
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {US_STATES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          ref={inputRef as React.Ref<HTMLInputElement>}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
        />
      )}
      {flagList.length > 0 && (
        <ul className="space-y-1 mt-1">
          {flagList.map((flag, idx) => (
            <li
              key={idx}
              className={cn(
                "flex gap-1.5 items-start text-[11px] leading-snug",
                flag.severity === "error" && "text-destructive",
                flag.severity === "warning" && "text-amber-800",
                flag.severity === "info" && "text-brand-ink",
              )}
            >
              {flag.severity === "error" ? (
                <AlertCircle className="size-3 shrink-0 mt-0.5" />
              ) : flag.severity === "warning" ? (
                <AlertTriangle className="size-3 shrink-0 mt-0.5" />
              ) : (
                <Info className="size-3 shrink-0 mt-0.5" />
              )}
              <span>{flag.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Diff indicator (C14) ────────────────────────────────────────────────────
// Renders the small "what did the AI say vs what does the CPA have" badge on
// the right side of each field label. Always visible (when there is anything
// to say) — the CPA sees a ✓ on AI-correct fields, a "$X → $Y" diff on
// edited ones, and explicit markers when they added or cleared a value.

function fmtFieldValue(v: string, type: FieldDef["type"]): string {
  if (v === "") return "";
  if (type === "money") {
    const n = Number(v);
    if (!Number.isFinite(n)) return v;
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  return v;
}

interface DiffIndicatorProps {
  state: "kept" | "changed" | "added" | "cleared" | "absent";
  field: FieldDef;
  aiValue: string;
  cpaValue: string;
}

function DiffIndicator({ state, field, aiValue, cpaValue }: DiffIndicatorProps): React.ReactElement | null {
  if (state === "absent") return null;
  const aiFmt = fmtFieldValue(aiValue, field.type);
  const cpaFmt = fmtFieldValue(cpaValue, field.type);

  if (state === "kept") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] text-success/80"
        title="CPA kept the AI-extracted value"
      >
        <Check className="size-3 shrink-0" />
        <span>AI: {aiFmt}</span>
      </span>
    );
  }

  if (state === "changed") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] text-amber-700"
        title={`AI extracted "${aiFmt}"; CPA changed to "${cpaFmt}"`}
      >
        <Pencil className="size-3 shrink-0" />
        <span className="line-through text-muted-foreground">{aiFmt}</span>
        <ArrowRight className="size-3 shrink-0" />
        <span className="font-medium">{cpaFmt}</span>
      </span>
    );
  }

  if (state === "added") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] text-brand-ink"
        title="AI did not extract this field; CPA filled it in"
      >
        <Plus className="size-3 shrink-0" />
        <span>added by CPA</span>
      </span>
    );
  }

  // cleared: AI had a value, CPA blanked it
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-amber-700"
      title={`AI extracted "${aiFmt}"; CPA cleared the value`}
    >
      <CircleSlash className="size-3 shrink-0" />
      <span className="line-through text-muted-foreground">{aiFmt}</span>
      <span>cleared</span>
    </span>
  );
}
