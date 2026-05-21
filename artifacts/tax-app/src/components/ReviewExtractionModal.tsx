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
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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
  { key: "stateWagesBox16", label: "Box 16 — State wages", type: "money" },
  { key: "stateTaxWithheldBox17", label: "Box 17 — State income tax", type: "money" },
  { key: "stateCode", label: "State", type: "stateCode" },
];

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
    { key: "shortTermGainLoss", label: "Short-term gain/loss", type: "money" },
    { key: "longTermGainLoss", label: "Long-term gain/loss", type: "money" },
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

// ─── Modal component ─────────────────────────────────────────────────────────

export function ReviewExtractionModal({ open, onClose, clientId, clientTaxYear, doc }: Props) {
  const qc = useQueryClient();
  const approve = useApproveExtraction();
  const reject = useRejectExtraction();

  const payload = React.useMemo(() => parseExtracted(doc?.extractedText), [doc?.extractedText]);
  const extracted = payload.data ?? {};
  const boxes = payload.boxes ?? {};
  const isW2 = doc?.documentType === "w2";
  const isForm1099 = doc?.documentType === "form_1099";

  const recordType: "w2" | "form1099" | null = isW2 ? "w2" : isForm1099 ? "form1099" : null;

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
      if (v != null) initial[k] = String(v);
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

  if (!doc || !recordType) return null;

  // ── Compute the visible field list based on recordType + showAll toggle ──
  function getVisibleFields(): FieldDef[] {
    if (recordType === "w2") return W2_FIELDS;
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
    if (!doc) return;
    const numericKeys = new Set([
      "wagesBox1","federalTaxWithheldBox2","socialSecurityWagesBox3","socialSecurityTaxBox4",
      "medicareWagesBox5","medicareTaxBox6","stateTaxWithheldBox17","stateWagesBox16",
      "federalTaxWithheld","stateTaxWithheld","nonemployeeCompensation","rents","royalties",
      "otherIncome","fishingBoatProceeds","medicalAndHealthcare","interestIncome",
      "earlyWithdrawalPenalty","usTreasuryInterest","taxExemptInterest","ordinaryDividends",
      "qualifiedDividends","totalCapitalGainDistribution","nondividendDistributions",
      "proceeds","costBasis","shortTermGainLoss","longTermGainLoss","grossDistribution",
      "taxableAmount","unemploymentCompensation","stateLocalRefund","grossPaymentAmount",
    ]);
    const body: Record<string, unknown> = {
      recordType,
      taxYear,
    };
    // W-2 carries all W-2 keys; 1099 carries all 1099 keys (the unrelated ones are NULL on the server).
    const allKeys = recordType === "w2"
      ? W2_FIELDS.map((f) => f.key)
      : ALL_1099_VALUE_KEYS;
    for (const key of allKeys) {
      const raw = values[key];
      if (raw == null || raw === "") {
        body[key] = null;
        continue;
      }
      if (numericKeys.has(key)) {
        const n = Number(raw);
        body[key] = Number.isFinite(n) ? n : null;
      } else {
        body[key] = raw;
      }
    }
    if (recordType === "form1099") {
      if (!formType) {
        toast({ title: "Form type required", description: "Pick the 1099 subtype before approving.", variant: "destructive" });
        return;
      }
      body.formType = formType;
    }
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
            </div>

            {/* Field list */}
            <div className="space-y-3">
              {visibleFields.map((f) => {
                const aiValue = extracted[f.key];
                const aiString = aiValue == null ? "" : String(aiValue);
                const currentValue = values[f.key] ?? "";
                const edited = currentValue !== aiString && (currentValue !== "" || aiString !== "");
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
}

function FieldRow({ field, value, onChange, onFocus, onBlur, edited, originalAiValue, inputRef }: FieldRowProps) {
  return (
    <div
      className={cn(
        "space-y-1 rounded-md transition-colors px-2 -mx-2 py-1",
        edited && "bg-amber-50 border-l-2 border-amber-500 pl-3",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs">{field.label}</Label>
        {edited && originalAiValue !== "" && (
          <span className="text-[10px] text-muted-foreground" title="Original AI value">
            AI: {field.type === "money" ? `$${Number(originalAiValue).toLocaleString()}` : originalAiValue}
          </span>
        )}
        {edited && originalAiValue === "" && (
          <span className="text-[10px] text-muted-foreground">added by CPA</span>
        )}
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
    </div>
  );
}
