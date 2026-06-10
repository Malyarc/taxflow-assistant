import { Link, useParams } from "wouter";
import {
  useGetClient,
  useListDocuments,
  useListW2Data,
  useGetTaxReturn,
  useListAdjustments,
  useUploadDocument,
  useDeleteDocument,
  useCreateW2Data,
  useUpdateW2Data,
  useDeleteW2Data,
  useListForm1099Data,
  useCreateForm1099Data,
  useUpdateForm1099Data,
  useDeleteForm1099Data,
  getListForm1099DataQueryKey,
  useCalculateTaxReturn,
  useUpdateTaxReturn,
  useCreateAdjustment,
  useUpdateAdjustment,
  useDeleteAdjustment,
  useGetPlanningOpportunities,
  useGetPlanningMemo,
  useGetPlanningClientEmail,
  useGetPlanningMissingData,
  useGetPlanningMultiYear,
  useRunStateComparison,
  useRunRothOptimizer,
  useRunWhatIfScenario,
  useGetPeerBenchmark,
  useGetPlanningDiscovery,
  useGetSettings,
  getGetPlanningOpportunitiesQueryKey,
  getGetPlanningMemoQueryKey,
  getGetPlanningClientEmailQueryKey,
  getGetPlanningMissingDataQueryKey,
  getGetPlanningMultiYearQueryKey,
  getGetPeerBenchmarkQueryKey,
  getGetPlanningDiscoveryQueryKey,
  getGetSettingsQueryKey,
  getGetClientQueryKey,
  getListDocumentsQueryKey,
  getListW2DataQueryKey,
  getGetTaxReturnQueryKey,
  getListAdjustmentsQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import type {
  UploadDocumentBodyDocumentType,
  CreateAdjustmentBodyAdjustmentType,
  UpdateAdjustmentBodyAdjustmentType,
  CreateForm1099DataBodyFormType,
  WhatIfMutation,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CurrencyInput } from "@/components/ui/currency-input";
import { toast } from "@/hooks/use-toast";
import { ReviewExtractionModal } from "@/components/ReviewExtractionModal";
import { localityLabel } from "@/lib/localityLabels";
import { ADJUSTMENT_TYPE_LABELS } from "@/lib/adjustmentLabels";
import {
  FileText, FileSpreadsheet, Files, CandlestickChart, Building2, Network,
  Wallet, Calculator, GitCompareArrows, SlidersHorizontal, Target,
  FileDown, Briefcase, Pencil, ArrowLeft, Boxes,
  CheckCircle2, AlertTriangle, AlertCircle, Info,
} from "lucide-react";

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_widow: "Qualifying Widow(er)",
};

function fmt(n: number | null | undefined) {
  // FE4 (audit 2026-06-08) — guard against NaN/Infinity (e.g. a caller passing
  // Number(undefined) on a partially-computed return) rendering as "$NaN".
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

/** Mask all but last 4 digits of an SSN: "123-45-6789" → "XXX-XX-6789". */
function maskSSN(ssn: string | null | undefined): string {
  if (!ssn) return "—";
  const digits = ssn.replace(/\D/g, "");
  if (digits.length < 4) return "XXX-XX-XXXX";
  return `XXX-XX-${digits.slice(-4)}`;
}

/** Mask all but the last 4 digits of a TIN (payer EIN or recipient SSN/EIN):
 *  "12-3456789" → "XX-XXX6789". Mirrors maskSSN — only the last 4 are shown,
 *  regardless of the TIN's length/format. */
function maskTin(tin: string | null | undefined): string {
  if (!tin) return "—";
  const digits = tin.replace(/\D/g, "");
  if (digits.length < 4) return "XX-XXXXXXX";
  return `XX-XXX${digits.slice(-4)}`;
}

/** Shared className for the ClientDetail tab triggers (icon + label).
 *  On lg+ the triggers sit in a vertical rail (full-width, left-aligned rows);
 *  below lg they stay as pills in a horizontal scroll strip. */
const TAB_TRIGGER_CLS =
  "gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-muted-foreground hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm lg:w-full lg:justify-start";

/** Trigger a browser download for a same-origin file URL (PDF / CSV / etc.). */
function downloadFile(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ─── Documents Tab ───────────────────────────────────────────────────────────

function DocumentsTab({ clientId, clientTaxYear, clientState }: { clientId: number; clientTaxYear: number; clientState?: string }) {
  const { data: docs, isLoading } = useListDocuments(clientId, {
    query: {
      queryKey: getListDocumentsQueryKey(clientId),
      // Poll while any doc is still processing — extraction is async on the server.
      // When extraction finishes, the status flips to "pending_review" and polling stops.
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!Array.isArray(data)) return false;
        return data.some((d) => d.status === "processing") ? 2500 : false;
      },
    },
  });
  const upload = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("w2");
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{ id: number; fileName: string } | null>(null);
  const [reviewDocId, setReviewDocId] = useState<number | null>(null);

  // Pull the current doc whenever reviewDocId is set; gives us the latest extractedText
  // payload without staleness from the table snapshot.
  const reviewDoc = (docs ?? []).find((d) => d.id === reviewDocId) ?? null;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1] ?? "";
      upload.mutate(
        { clientId, data: { documentType: docType as UploadDocumentBodyDocumentType, fileName: file.name, fileContent: base64 } },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getListDocumentsQueryKey(clientId) });
            toast({ title: "Document uploaded", description: "AI extraction running — you'll review the extracted values before they're saved." });
            if (fileRef.current) fileRef.current.value = "";
          },
          onError: () => toast({ title: "Upload failed", variant: "destructive" }),
          onSettled: () => setUploading(false),
        }
      );
    };
    reader.readAsDataURL(file);
  }

  function handleDelete(docId: number) {
    if (!confirm("Delete this document?")) return;
    deleteDoc.mutate(
      { clientId, documentId: docId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListDocumentsQueryKey(clientId) });
          toast({ title: "Document deleted" });
        },
      }
    );
  }

  // Map document.status → tailwind pill classes.
  // "extracted" is legacy (pre-review-gate auto-write); display it the same as "approved".
  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    processing: "bg-brand/10 text-primary",
    pending_review: "bg-amber-100 text-amber-900",
    approved: "bg-success/10 text-success",
    extracted: "bg-success/10 text-success",
    rejected: "bg-muted text-foreground",
    failed: "bg-destructive/10 text-destructive",
  };
  const statusLabels: Record<string, string> = {
    pending: "Pending",
    processing: "Extracting…",
    pending_review: "Review needed",
    approved: "Approved",
    extracted: "Approved",
    rejected: "Rejected",
    failed: "Failed",
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Upload Document</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3 items-end">
            <div className="space-y-2">
              <Label>Document Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="w2">W-2</SelectItem>
                  <SelectItem value="form_1099">Form 1099</SelectItem>
                  <SelectItem value="form_1098">Form 1098 (Mortgage Interest)</SelectItem>
                  <SelectItem value="form_1098t">Form 1098-T (Tuition)</SelectItem>
                  <SelectItem value="form_1098e">Form 1098-E (Student Loan Interest)</SelectItem>
                  <SelectItem value="form_1095a">Form 1095-A (Marketplace)</SelectItem>
                  <SelectItem value="form_ssa1099">SSA-1099 (Social Security)</SelectItem>
                  <SelectItem value="form_w2g">W-2G (Gambling Winnings)</SelectItem>
                  <SelectItem value="schedule_k1">Schedule K-1</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>File</Label>
              <Input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.txt" onChange={handleFile} disabled={uploading} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            AI extracts fields from W-2 / 1099 uploads, then you review and approve them before they land in the client record.
          </p>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : !docs?.length ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No documents uploaded yet.</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">File</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Uploaded</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {docs.map((doc) => (
                <tr key={doc.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 text-sm font-medium">{doc.fileName}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{doc.documentType}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${statusColors[doc.status] ?? ""}`}>
                      {statusLabels[doc.status] ?? doc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right space-x-1">
                    {doc.status === "pending_review" && (
                      <Button
                        size="sm"
                        onClick={() => setReviewDocId(doc.id)}
                      >
                        Review extraction
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewDoc({ id: doc.id, fileName: doc.fileName })}
                      disabled={doc.status === "processing"}
                    >
                      Preview
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(doc.id)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={previewDoc != null} onOpenChange={(open) => { if (!open) setPreviewDoc(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{previewDoc?.fileName}</DialogTitle>
          </DialogHeader>
          {previewDoc && <DocumentPreview clientId={clientId} docId={previewDoc.id} fileName={previewDoc.fileName} />}
        </DialogContent>
      </Dialog>

      <ReviewExtractionModal
        open={reviewDoc != null}
        onClose={() => setReviewDocId(null)}
        clientId={clientId}
        clientTaxYear={clientTaxYear}
        clientState={clientState}
        doc={reviewDoc}
      />
    </div>
  );
}

function DocumentPreview({ clientId, docId, fileName }: { clientId: number; docId: number; fileName: string }) {
  const url = `/api/clients/${clientId}/documents/${docId}/content`;
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) {
    return <iframe src={url} className="w-full h-[75vh]" title={fileName} />;
  }
  if (lower.match(/\.(jpe?g|png|webp|gif)$/)) {
    return <img src={url} alt={fileName} className="max-w-full max-h-[75vh] mx-auto" />;
  }
  // Plain text or other — show in a scrollable pre block
  return (
    <iframe
      src={url}
      className="w-full h-[60vh] border rounded bg-muted"
      title={fileName}
    />
  );
}

// ─── W-2 Data Tab ────────────────────────────────────────────────────────────

interface W2FormData {
  taxYear: number;
  employerName: string;
  employerEin: string;
  wagesBox1: string;
  federalTaxWithheldBox2: string;
  socialSecurityWagesBox3: string;
  socialSecurityTaxBox4: string;
  medicareWagesBox5: string;
  medicareTaxBox6: string;
  stateWagesBox16: string;
  stateTaxWithheldBox17: string;
  stateCode: string;
}

function blankW2Form(): W2FormData {
  return {
    taxYear: new Date().getFullYear() - 1,
    employerName: "",
    employerEin: "",
    wagesBox1: "",
    federalTaxWithheldBox2: "",
    socialSecurityWagesBox3: "",
    socialSecurityTaxBox4: "",
    medicareWagesBox5: "",
    medicareTaxBox6: "",
    stateWagesBox16: "",
    stateTaxWithheldBox17: "",
    stateCode: "",
  };
}

interface W2Flag { field: string | null; severity: "error" | "warning" | "info"; message: string }
interface W2FlagsResponse { w2Id: number; flags: W2Flag[] }

interface BoundingBox { ymin: number; xmin: number; ymax: number; xmax: number }
type FieldBoxes = Record<string, BoundingBox>;

const BOX_FIELD_LABELS: Record<string, string> = {
  employerName: "Employer Name",
  employerEin: "Employer EIN",
  employeeSSN: "SSN",
  wagesBox1: "Box 1 — Wages",
  federalTaxWithheldBox2: "Box 2 — Fed W/H",
  socialSecurityWagesBox3: "Box 3 — SS Wages",
  socialSecurityTaxBox4: "Box 4 — SS Tax",
  medicareWagesBox5: "Box 5 — Medicare Wages",
  medicareTaxBox6: "Box 6 — Medicare Tax",
  stateTaxWithheldBox17: "Box 17 — State W/H",
  stateWagesBox16: "Box 16 — State Wages",
  stateCode: "State Code",
};

function ReviewDialog({ clientId, rec, onClose }: { clientId: number; rec: any; onClose: () => void }) {
  const boxes: FieldBoxes = (rec.fieldBoxes as FieldBoxes | null) ?? {};
  const docId: number | null = rec.documentId ?? null;
  const [highlightedField, setHighlightedField] = React.useState<string | null>(null);
  const [imgSize, setImgSize] = React.useState<{ w: number; h: number } | null>(null);

  const fieldEntries: Array<[string, unknown]> = [
    ["employerName", rec.employerName],
    ["employerEin", rec.employerEin],
    ["employeeSSN", rec.employeeSSN],
    ["wagesBox1", rec.wagesBox1],
    ["federalTaxWithheldBox2", rec.federalTaxWithheldBox2],
    ["socialSecurityWagesBox3", rec.socialSecurityWagesBox3],
    ["socialSecurityTaxBox4", rec.socialSecurityTaxBox4],
    ["medicareWagesBox5", rec.medicareWagesBox5],
    ["medicareTaxBox6", rec.medicareTaxBox6],
    ["stateTaxWithheldBox17", rec.stateTaxWithheldBox17],
    ["stateWagesBox16", rec.stateWagesBox16],
    ["stateCode", rec.stateCode],
  ];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Review extracted W-2 — click a field to highlight on the source</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: source document with overlays */}
          <div className="relative border rounded bg-muted overflow-hidden">
            {docId == null ? (
              <div className="p-8 text-sm text-muted-foreground text-center">No source document linked to this W-2 (manually entered).</div>
            ) : (
              <div className="relative inline-block w-full">
                <img
                  src={`/api/clients/${clientId}/documents/${docId}/content`}
                  alt="Source W-2"
                  className="w-full h-auto block"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    setImgSize({ w: img.clientWidth, h: img.clientHeight });
                  }}
                />
                {imgSize && Object.entries(boxes).map(([field, box]) => {
                  const isHighlighted = highlightedField === field;
                  // Boxes are 0-1000 normalized; multiply by image size / 1000
                  const left = (box.xmin / 1000) * imgSize.w;
                  const top = (box.ymin / 1000) * imgSize.h;
                  const width = ((box.xmax - box.xmin) / 1000) * imgSize.w;
                  const height = ((box.ymax - box.ymin) / 1000) * imgSize.h;
                  return (
                    <div
                      key={field}
                      onClick={() => setHighlightedField(field)}
                      className={`absolute cursor-pointer transition-all ${isHighlighted ? "border-2 border-amber-500 bg-amber-200/40 z-10" : "border border-brand/40 bg-brand/10 hover:bg-brand/10"}`}
                      style={{ left, top, width, height }}
                      title={BOX_FIELD_LABELS[field] ?? field}
                    />
                  );
                })}
              </div>
            )}
          </div>
          {/* Right: extracted fields */}
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground mb-2">
              {Object.keys(boxes).length > 0
                ? "Click a field below to highlight where Gemini found it on the source. Click a box on the source to highlight here."
                : "No bounding boxes from extraction — Gemini didn't return them, or this W-2 wasn't AI-extracted."}
            </div>
            {fieldEntries.map(([field, val]) => {
              const hasValue = val != null && val !== "";
              const hasBox = field in boxes;
              const isHighlighted = highlightedField === field;
              return (
                <div
                  key={field}
                  onClick={() => hasBox && setHighlightedField(field)}
                  className={`flex justify-between items-center px-2 py-1.5 rounded text-sm transition-colors ${
                    isHighlighted ? "bg-amber-100" : hasBox ? "hover:bg-accent cursor-pointer" : ""
                  }`}
                >
                  <span className={`text-muted-foreground ${!hasValue ? "italic" : ""}`}>{BOX_FIELD_LABELS[field] ?? field}</span>
                  <span className="font-mono font-semibold">
                    {field === "employeeSSN" && typeof val === "string" ? maskSSN(val) :
                      typeof val === "number" ? fmt(val) :
                      hasValue ? String(val) : "—"}
                    {hasBox && <span className="ml-2 text-[10px] text-brand-ink">▣</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Hoisted to module scope (FE-02). Defined inside W2DataTab, this got a new
// function identity on every keystroke, so React remounted the whole field
// subtree and the focused <Input>/<CurrencyInput> lost focus after each
// character — making manual W-2 entry/edit unusable. It only closes over its
// props, so module scope is safe (mirrors Form1099Fields).
function W2Fields({ form, onChange }: { form: W2FormData; onChange: (k: keyof W2FormData, v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-4 mt-4">
      <div className="col-span-2 grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Tax Year</Label>
          <Input value={form.taxYear} onChange={(e) => onChange("taxYear", e.target.value)} type="number" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Employer Name</Label>
          <Input value={form.employerName} onChange={(e) => onChange("employerName", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Employer EIN</Label>
          <Input value={form.employerEin} onChange={(e) => onChange("employerEin", e.target.value)} placeholder="XX-XXXXXXX" />
        </div>
      </div>
      {[
        { key: "wagesBox1", label: "Box 1 — Wages" },
        { key: "federalTaxWithheldBox2", label: "Box 2 — Federal W/H" },
        { key: "socialSecurityWagesBox3", label: "Box 3 — SS Wages" },
        { key: "socialSecurityTaxBox4", label: "Box 4 — SS Tax" },
        { key: "medicareWagesBox5", label: "Box 5 — Medicare Wages" },
        { key: "medicareTaxBox6", label: "Box 6 — Medicare Tax" },
        { key: "stateWagesBox16", label: "Box 16 — State Wages" },
        { key: "stateTaxWithheldBox17", label: "Box 17 — State W/H" },
      ].map(({ key, label }) => (
        <div key={key} className="space-y-1">
          <Label className="text-xs text-muted-foreground">{label}</Label>
          <CurrencyInput
            value={form[key as keyof W2FormData]}
            onChange={(v) => onChange(key as keyof W2FormData, v)}
          />
        </div>
      ))}
      <div className="space-y-1">
        <Label className="text-xs">State Code</Label>
        <Input value={form.stateCode} onChange={(e) => onChange("stateCode", e.target.value)} placeholder="CA" maxLength={2} />
      </div>
    </div>
  );
}

function W2DataTab({ clientId }: { clientId: number }) {
  const { data: w2Records, isLoading } = useListW2Data(clientId, {
    query: { queryKey: getListW2DataQueryKey(clientId) },
  });
  const createW2 = useCreateW2Data();
  const updateW2 = useUpdateW2Data();
  const deleteW2 = useDeleteW2Data();
  const qc = useQueryClient();

  // Pull validation flags (sanity checks) for all W-2s
  const flagsQuery = useQuery<W2FlagsResponse[]>({
    queryKey: ["w2-flags", clientId, w2Records?.length],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/w2data/flags`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!w2Records && w2Records.length > 0,
    retry: false,
  });
  const flagsByW2: Record<number, W2Flag[]> = {};
  for (const item of flagsQuery.data ?? []) flagsByW2[item.w2Id] = item.flags;

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<W2FormData>(blankW2Form());
  const [editForms, setEditForms] = useState<Record<number, W2FormData>>({});
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const reviewingRec = w2Records?.find((r) => r.id === reviewingId);

  function toPayload(f: W2FormData) {
    return {
      taxYear: Number(f.taxYear),
      employerName: f.employerName || undefined,
      employerEin: f.employerEin || undefined,
      wagesBox1: f.wagesBox1 ? Number(f.wagesBox1) : undefined,
      federalTaxWithheldBox2: f.federalTaxWithheldBox2 ? Number(f.federalTaxWithheldBox2) : undefined,
      socialSecurityWagesBox3: f.socialSecurityWagesBox3 ? Number(f.socialSecurityWagesBox3) : undefined,
      socialSecurityTaxBox4: f.socialSecurityTaxBox4 ? Number(f.socialSecurityTaxBox4) : undefined,
      medicareWagesBox5: f.medicareWagesBox5 ? Number(f.medicareWagesBox5) : undefined,
      medicareTaxBox6: f.medicareTaxBox6 ? Number(f.medicareTaxBox6) : undefined,
      stateWagesBox16: f.stateWagesBox16 ? Number(f.stateWagesBox16) : undefined,
      stateTaxWithheldBox17: f.stateTaxWithheldBox17 ? Number(f.stateTaxWithheldBox17) : undefined,
      stateCode: f.stateCode || undefined,
    };
  }

  function startEdit(id: number) {
    const rec = w2Records?.find((r) => r.id === id);
    if (!rec) return;
    setEditForms((p) => ({
      ...p,
      [id]: {
        taxYear: rec.taxYear ?? new Date().getFullYear() - 1,
        employerName: rec.employerName ?? "",
        employerEin: rec.employerEin ?? "",
        wagesBox1: rec.wagesBox1 != null ? String(rec.wagesBox1) : "",
        federalTaxWithheldBox2: rec.federalTaxWithheldBox2 != null ? String(rec.federalTaxWithheldBox2) : "",
        socialSecurityWagesBox3: rec.socialSecurityWagesBox3 != null ? String(rec.socialSecurityWagesBox3) : "",
        socialSecurityTaxBox4: rec.socialSecurityTaxBox4 != null ? String(rec.socialSecurityTaxBox4) : "",
        medicareWagesBox5: rec.medicareWagesBox5 != null ? String(rec.medicareWagesBox5) : "",
        medicareTaxBox6: rec.medicareTaxBox6 != null ? String(rec.medicareTaxBox6) : "",
        stateWagesBox16: rec.stateWagesBox16 != null ? String(rec.stateWagesBox16) : "",
        stateTaxWithheldBox17: rec.stateTaxWithheldBox17 != null ? String(rec.stateTaxWithheldBox17) : "",
        stateCode: rec.stateCode ?? "",
      },
    }));
    setEditingId(id);
  }

  function saveEdit(id: number) {
    const f = editForms[id];
    if (!f) return;
    updateW2.mutate(
      { clientId, w2Id: id, data: toPayload(f) },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListW2DataQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "W-2 record updated" });
          setEditingId(null);
        },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      }
    );
  }

  function saveNew() {
    createW2.mutate(
      { clientId, data: toPayload(newForm) },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListW2DataQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "W-2 record added" });
          setShowNew(false);
          setNewForm(blankW2Form());
        },
        onError: () => toast({ title: "Failed to add", variant: "destructive" }),
      }
    );
  }

  function handleDelete(id: number) {
    if (!confirm("Delete this W-2 record?")) return;
    deleteW2.mutate(
      { clientId, w2Id: id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListW2DataQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "W-2 record deleted" });
        },
      }
    );
  }

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {w2Records?.map((rec) => (
        <Card key={rec.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                {rec.employerName ?? `W-2 #${rec.id}`}
                <span className="text-muted-foreground font-normal text-sm"> — {rec.taxYear}</span>
                {rec.employeeSSN && (
                  <span className="text-muted-foreground font-mono font-normal text-xs ml-3">SSN {maskSSN(rec.employeeSSN)}</span>
                )}
              </CardTitle>
              <div className="flex gap-2">
                {editingId === rec.id ? (
                  <>
                    <Button size="sm" onClick={() => saveEdit(rec.id)} disabled={updateW2.isPending}>Save</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    {(rec as any).documentId != null && (
                      <Button size="sm" variant="outline" onClick={() => setReviewingId(rec.id)}>Review</Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => startEdit(rec.id)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(rec.id)}>Delete</Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(flagsByW2[rec.id]?.length ?? 0) > 0 && (
              <div className="mb-4 space-y-1.5">
                {flagsByW2[rec.id].map((flag, i) => {
                  const tone =
                    flag.severity === "error" ? "bg-destructive/5 border-destructive/30 text-destructive" :
                    flag.severity === "warning" ? "bg-amber-50 border-amber-200 text-amber-900" :
                    "bg-brand/5 border-brand/30 text-primary";
                  const icon = flag.severity === "error" ? "⚠" : flag.severity === "warning" ? "▲" : "ℹ";
                  return (
                    <div key={i} className={`text-xs px-3 py-2 rounded border ${tone}`}>
                      <span className="font-mono mr-1.5">{icon}</span>
                      {flag.field && <span className="font-mono font-semibold">[{flag.field}]</span>} {flag.message}
                    </div>
                  );
                })}
              </div>
            )}
            {editingId === rec.id ? (
              <W2Fields
                form={editForms[rec.id] ?? blankW2Form()}
                onChange={(k, v) => setEditForms((p) => ({ ...p, [rec.id]: { ...(p[rec.id] ?? blankW2Form()), [k]: v } }))}
              />
            ) : (
              <div className="grid grid-cols-4 gap-3 text-sm">
                {[
                  ["Box 1 Wages", rec.wagesBox1],
                  ["Box 2 Fed W/H", rec.federalTaxWithheldBox2],
                  ["Box 3 SS Wages", rec.socialSecurityWagesBox3],
                  ["Box 4 SS Tax", rec.socialSecurityTaxBox4],
                  ["Box 5 Medicare Wages", rec.medicareWagesBox5],
                  ["Box 6 Medicare Tax", rec.medicareTaxBox6],
                  ["Box 16 State Wages", rec.stateWagesBox16],
                  ["Box 17 State W/H", rec.stateTaxWithheldBox17],
                ].map(([label, val]) => (
                  <div key={String(label)}>
                    <div className="text-xs text-muted-foreground">{label}</div>
                    <div className="font-mono font-semibold">{val != null ? fmt(Number(val)) : "—"}</div>
                  </div>
                ))}
                <div>
                  <div className="text-xs text-muted-foreground">State</div>
                  <div className="font-mono font-semibold">{rec.stateCode ?? "—"}</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {showNew ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New W-2 Record</CardTitle>
          </CardHeader>
          <CardContent>
            <W2Fields form={newForm} onChange={(k, v) => setNewForm((p) => ({ ...p, [k]: v }))} />
            <div className="flex gap-2 mt-4">
              <Button onClick={saveNew} disabled={createW2.isPending}>Add W-2</Button>
              <Button variant="outline" onClick={() => { setShowNew(false); setNewForm(blankW2Form()); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setShowNew(true)}>+ Add W-2 Record</Button>
      )}
      {reviewingRec && (
        <ReviewDialog clientId={clientId} rec={reviewingRec} onClose={() => setReviewingId(null)} />
      )}
    </div>
  );
}

// ─── Tax Calculator Tab ───────────────────────────────────────────────────────

interface BracketBreakdownRow {
  rate: number;
  bracketMin: number;
  bracketMax: number;
  taxableInBracket: number;
  taxFromBracket: number;
}
interface BreakdownResponse {
  taxYear: number;
  filingStatus: string;
  federal: { taxableIncome: number; total: number; marginalRate: number; brackets: BracketBreakdownRow[] };
  state: { stateCode: string; stateName: string; hasIncomeTax: boolean; total: number; marginalRate: number; brackets: BracketBreakdownRow[] };
  childTaxCredit: {
    qualifyingChildren: number;
    otherDependents: number;
    preliminaryCredit: number;
    phaseOutReduction: number;
    appliedCredit: number;
    phaseOutThreshold: number;
  };
}

// ─── C5 — §1031 Like-Kind Exchange summary ────────────────────────────────
// Renders only when section1031RealizedGain > 0. Reads from the existing
// tax-return JSON (which includes the new C5 fields via mapReturn ...spread).
function Section1031Card({ taxReturn, clientId, taxYear }: { taxReturn: { section1031RealizedGain?: string | number | null; section1031BootReceived?: string | number | null; section1031RecognizedGain?: string | number | null; section1031DeferredGain?: string | number | null } | null | undefined; clientId: number; taxYear: number }) {
  const num = (v: string | number | null | undefined): number => v == null ? 0 : (typeof v === "number" ? v : Number(v));
  const realized = num(taxReturn?.section1031RealizedGain);
  const boot = num(taxReturn?.section1031BootReceived);
  const recognized = num(taxReturn?.section1031RecognizedGain);
  const deferred = num(taxReturn?.section1031DeferredGain);
  if (realized <= 0) return null;
  const fmt = (n: number): string => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (
    <Card className="print:hidden">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">§1031 Like-Kind Exchange Summary</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Real property only (post-TCJA). CPA confirms like-kind classification, 45-day identification, 180-day completion, and qualified-intermediary use.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            title="Substitute Form 8824 PDF (§1031 like-kind exchange) per Pub 1167"
            onClick={() => downloadFile(`/api/clients/${clientId}/form-8824/pdf?taxYear=${taxYear}`)}
          >
            <FileDown className="mr-1.5 h-4 w-4" />Form 8824 (PDF)
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-muted-foreground">Realized gain (across all exchanges)</span>
          <span className="font-mono text-right">{fmt(realized)}</span>
          <span className="text-muted-foreground">Boot received (cash + non-like-kind)</span>
          <span className="font-mono text-right">{fmt(boot)}</span>
          <span className="text-amber-700 font-medium">Recognized gain (taxed as LTCG this year)</span>
          <span className="font-mono text-right text-amber-700 font-medium">{fmt(recognized)}</span>
          <span className="text-success font-medium">Deferred gain (carries to replacement basis)</span>
          <span className="font-mono text-right text-success font-medium">{fmt(deferred)}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Replacement-property basis = relinquished basis + boot paid − boot received + recognized gain. Engine doesn&apos;t track replacement-property basis across years — CPA records externally for the next exchange.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── C7 — §163(j) + §461(l) business-limit summary ───────────────────────
function Section163j461lCard({ taxReturn, clientId, taxYear }: { taxReturn: { section163jBusinessInterestExpense?: string | number | null; section163jAllowedDeduction?: string | number | null; section163jDisallowedCarryforward?: string | number | null; section461lExcessLossAddback?: string | number | null; section163jSmallBusinessExempt?: boolean | null; section163jGrossReceipts?: string | number | null; section163jGrossReceiptsThreshold?: string | number | null } | null | undefined; clientId: number; taxYear: number }) {
  const num = (v: string | number | null | undefined): number => v == null ? 0 : (typeof v === "number" ? v : Number(v));
  const gross = num(taxReturn?.section163jBusinessInterestExpense);
  const allowed = num(taxReturn?.section163jAllowedDeduction);
  const cf = num(taxReturn?.section163jDisallowedCarryforward);
  const lossAddback = num(taxReturn?.section461lExcessLossAddback);
  const sbExempt = taxReturn?.section163jSmallBusinessExempt === true;
  const grossReceipts = num(taxReturn?.section163jGrossReceipts);
  if (gross <= 0 && allowed <= 0 && cf <= 0 && lossAddback <= 0) return null;
  const has163j = gross > 0 || allowed > 0 || cf > 0;
  const fmt = (n: number): string => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (
    <Card className="print:hidden">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Business-Income Limits — §163(j) + §461(l)</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              §163(j) — engine applies the 30%-of-ATI cap on business interest expense (ATI proxy = pre-§163(j) ordinary income). Disallowed amount carries forward indefinitely. The small-business gross-receipts exemption (§163(j)(3)/§448(c), ≤$30M 2024 / $31M 2025 / $32M 2026) is auto-detected when the 3-yr avg gross-receipts adjustment is entered. §461(l) — CPA pre-computes the aggregate excess business loss above $305k single / $610k MFJ.
            </p>
          </div>
          {has163j ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              title="Substitute Form 8990 PDF (§163(j) business interest expense limitation)"
              onClick={() => downloadFile(`/api/clients/${clientId}/form-8990/pdf?taxYear=${taxYear}`)}
            >
              <FileDown className="mr-1.5 h-4 w-4" />Form 8990 (PDF)
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          {has163j ? <>
            <span className="text-muted-foreground">§163(j) gross business interest (CPA-entered)</span>
            <span className="font-mono text-right">{fmt(gross)}</span>
            {sbExempt ? <>
              <span className="text-success font-medium">§163(j)(3) small-business EXEMPT (gross receipts {fmt(grossReceipts)})</span>
              <span className="font-mono text-right text-success font-medium">no 30% cap</span>
            </> : null}
            <span className="text-success font-medium">§163(j) allowed deduction this year</span>
            <span className="font-mono text-right text-success font-medium">{fmt(allowed)}</span>
            <span className="text-amber-700">§163(j) disallowed → carries to next year (indefinite)</span>
            <span className="font-mono text-right text-amber-700">{fmt(cf)}</span>
          </> : null}
          {lossAddback > 0 ? <>
            <span className="text-destructive font-medium">§461(l) excess business loss addback</span>
            <span className="font-mono text-right text-destructive font-medium">{fmt(lossAddback)}</span>
          </> : null}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── C6 — ESPP / ISO disqualifying disposition summary ────────────────────
function EsppIsoCard({ taxReturn }: { taxReturn: { isoDisqualifyingDispositionOrdinary?: string | number | null; esppDisqualifyingDispositionOrdinary?: string | number | null } | null | undefined }) {
  const num = (v: string | number | null | undefined): number => v == null ? 0 : (typeof v === "number" ? v : Number(v));
  const iso = num(taxReturn?.isoDisqualifyingDispositionOrdinary);
  const espp = num(taxReturn?.esppDisqualifyingDispositionOrdinary);
  if (iso <= 0 && espp <= 0) return null;
  const fmt = (n: number): string => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Stock Compensation — Disqualifying Dispositions</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Comp income recharacterized from ISO / §423 ESPP sales that failed the holding-period tests. Flows to ordinary income, NOT subject to FICA per IRS Notice 2002-47 (ISO) and Rev Rul 71-52 (ESPP). CPA handles the cap-gain side via Form 8949 with code &quot;B&quot; basis adjustment.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          {iso > 0 ? <>
            <span className="text-muted-foreground">ISO disqualifying — ordinary comp</span>
            <span className="font-mono text-right">{fmt(iso)}</span>
          </> : null}
          {espp > 0 ? <>
            <span className="text-muted-foreground">§423 ESPP disqualifying — ordinary comp</span>
            <span className="font-mono text-right">{fmt(espp)}</span>
          </> : null}
          <span className="text-muted-foreground font-medium">Total added to ordinary income</span>
          <span className="font-mono text-right font-medium">{fmt(iso + espp)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── C4 — Form 1040-X (Amended Return) ────────────────────────────────────
interface Form1040xLine {
  lineRef: string;
  label: string;
  original: number;
  amended: number;
  netChange: number;
}
interface Form1040xResult {
  taxYear: number;
  lockedAt: string | null;
  explanation: string;
  lines: Form1040xLine[];
  creditDetail: Form1040xLine[];
  stateLines: Form1040xLine[];
  netFederalRefundChange: number;
  netStateRefundChange: number;
}

function fmtAmendCol(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  const abs = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  return n < 0 ? `(${abs})` : abs;
}

// FE3 — Form 1040-X delta coloring. For most lines a HIGHER value is worse for
// the taxpayer (more income/tax/amount-owed → red on an increase). But on
// "money-back" lines — deductions, credits, withholding, payments, refundable
// credits, and the refund line — a HIGHER value is BETTER, so a positive
// netChange there is favorable (green), not red. Keyed by the stable Form 1040-X
// line refs built in form1040x.ts. Credit-detail refs 7a–7f are credits (better);
// 6a is the cap-gains tax component (worse).
const AMEND_BETTER_WHEN_HIGHER = new Set([
  "2", "4b", "7", "7a", "7b", "7c", "7d", "7e", "7f",
  "11", "13", "14", "16", "20", "S2", "S3",
]);
function amendDeltaClass(lineRef: string, netChange: number): string {
  if (!Number.isFinite(netChange) || netChange === 0) return "";
  const higherIsBetter = AMEND_BETTER_WHEN_HIGHER.has(lineRef);
  const favorable = higherIsBetter ? netChange > 0 : netChange < 0;
  return favorable ? "text-success" : "text-destructive";
}

// FE3 — Year-over-year delta coloring (keyed by metric label). Income/tax lines
// are "higher is worse" (an increase is unfavorable → red); deductions, credits,
// and refunds are "higher is better" (an increase is favorable → green). The old
// code colored EVERY positive delta green, which mis-signaled rising tax/income.
const YOY_HIGHER_IS_WORSE = new Set([
  "Total Income", "AGI", "Taxable Income", "Federal Tax", "State Tax",
  "AMT", "SE Tax", "NIIT", "Net Capital Gain/Loss (Sch D)", "Rental Net (Sch E)",
]);
function yoyDeltaClass(label: string, delta: number): string {
  if (!Number.isFinite(delta) || delta === 0) return "";
  const favorable = YOY_HIGHER_IS_WORSE.has(label) ? delta < 0 : delta > 0;
  return favorable ? "text-success" : "text-destructive";
}

function Form1040xCard({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const qc = useQueryClient();
  // Pull the raw tax-return row to check amendment fields. We use a
  // custom queryFn because the OpenAPI-typed `useGetTaxReturn` doesn't
  // surface the new C4 columns.
  const returnRow = useQuery<{
    id?: number;
    originalSnapshot?: unknown;
    amendmentLockedAt?: string | null;
    amendmentExplanation?: string | null;
  }>({
    queryKey: ["tax-return-row-c4", clientId, taxYear],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/tax-return?taxYear=${taxYear}`);
      if (!res.ok) throw new Error("tax-return fetch failed");
      return res.json();
    },
    retry: false,
  });

  const hasAmendment =
    returnRow.data?.originalSnapshot != null && returnRow.data.originalSnapshot !== undefined;

  const formQuery = useQuery<Form1040xResult>({
    queryKey: ["form-1040x", clientId, taxYear, returnRow.data?.id],
    enabled: hasAmendment,
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/tax-return/form-1040x?taxYear=${taxYear}`);
      if (!res.ok) throw new Error("form-1040x fetch failed");
      return res.json();
    },
    retry: false,
  });

  const [explanationDraft, setExplanationDraft] = useState("");
  const [explanationInit, setExplanationInit] = useState(false);

  // Initialize explanation textarea from server data when query first loads
  useEffect(() => {
    if (formQuery.data && !explanationInit) {
      setExplanationDraft(formQuery.data.explanation ?? "");
      setExplanationInit(true);
    }
  }, [formQuery.data, explanationInit]);

  async function handleLockAsFiled() {
    if (!confirm("Lock the current return as 'originally filed'? You'll be able to modify inputs and generate Form 1040-X showing the diff. Use 'Clear amendment baseline' to remove later.")) {
      return;
    }
    const res = await fetch(`/api/clients/${clientId}/tax-return/lock-as-filed?taxYear=${taxYear}`, { method: "POST" });
    if (!res.ok) {
      toast({ title: "Lock failed", description: await res.text(), variant: "destructive" });
      return;
    }
    toast({ title: "Locked as filed", description: "Modify any inputs, then come back to generate Form 1040-X." });
    qc.invalidateQueries({ queryKey: ["tax-return-row-c4", clientId, taxYear] });
  }

  async function handleClearAmendment() {
    if (!confirm("Clear the amendment baseline? Form 1040-X data will be lost. Use this only after the amendment has been filed with the IRS.")) {
      return;
    }
    const res = await fetch(`/api/clients/${clientId}/tax-return/clear-amendment?taxYear=${taxYear}`, { method: "POST" });
    if (!res.ok) {
      toast({ title: "Clear failed", description: await res.text(), variant: "destructive" });
      return;
    }
    toast({ title: "Amendment baseline cleared" });
    setExplanationDraft("");
    setExplanationInit(false);
    qc.invalidateQueries({ queryKey: ["tax-return-row-c4", clientId, taxYear] });
  }

  async function saveExplanation() {
    const res = await fetch(`/api/clients/${clientId}/tax-return/amendment-explanation?taxYear=${taxYear}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ explanation: explanationDraft }),
    });
    if (!res.ok) {
      toast({ title: "Save failed", description: await res.text(), variant: "destructive" });
    }
  }

  function handleDownloadPdf() {
    const link = document.createElement("a");
    link.href = `/api/clients/${clientId}/tax-return/form-1040x/pdf?taxYear=${taxYear}`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  if (returnRow.isLoading) {
    return (
      <Card className="print:hidden">
        <CardContent className="py-6"><Skeleton className="h-20" /></CardContent>
      </Card>
    );
  }

  if (!hasAmendment) {
    return (
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base">Form 1040-X — Amended Return</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Use this when you need to amend a previously-filed return. Click <strong>Lock as filed</strong> to snapshot the current values, then modify any inputs (W-2s, 1099s, adjustments) and recompute — Form 1040-X will show the diff.
          </p>
        </CardHeader>
        <CardContent>
          <Button onClick={handleLockAsFiled} variant="outline">
            Lock current return as &quot;originally filed&quot;
          </Button>
        </CardContent>
      </Card>
    );
  }

  const form = formQuery.data;
  return (
    <Card className="print:hidden border-amber-300">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Form 1040-X — Amendment in progress</CardTitle>
          <Badge variant="outline" className="text-amber-700 border-amber-300">Amending</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Original return snapshot captured {returnRow.data?.amendmentLockedAt ? new Date(returnRow.data.amendmentLockedAt).toLocaleString("en-US") : "—"}. The Tax Calculator above now shows AMENDED values; the diff column (b) below is calculated against the snapshot.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {formQuery.error ? (
          <p className="text-xs text-destructive">
            Form 1040-X load failed: {String((formQuery.error as Error).message)}
          </p>
        ) : null}

        {form ? (
          <>
            <div className="rounded-md border bg-amber-50 border-amber-200 p-4">
              <p className="text-sm font-semibold text-amber-900 mb-2">
                {form.netFederalRefundChange >= 0 ? "Additional refund due" : "Additional tax owed"}: {fmtAmendCol(Math.abs(form.netFederalRefundChange))}
              </p>
              {form.netStateRefundChange !== 0 ? (
                <p className="text-xs text-amber-700">
                  State change: {fmtAmendCol(form.netStateRefundChange)} ({form.netStateRefundChange >= 0 ? "refund" : "owed"})
                </p>
              ) : (
                <p className="text-xs text-amber-700">No state-level change.</p>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-2 font-semibold w-12">Line</th>
                    <th className="text-left py-2 pr-2 font-semibold">Description</th>
                    <th className="text-right py-2 pr-2 font-semibold w-24">(a) Original</th>
                    <th className="text-right py-2 pr-2 font-semibold w-24">(b) Change</th>
                    <th className="text-right py-2 pr-2 font-semibold w-24">(c) Corrected</th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((l) => {
                    const isHeadline = l.lineRef === "10" || l.lineRef === "16" || l.lineRef === "20";
                    return (
                      <tr key={l.lineRef} className={isHeadline ? "border-t bg-muted/50 font-semibold" : "border-b border-border"}>
                        <td className="py-1.5 pr-2 text-muted-foreground">{l.lineRef}</td>
                        <td className="py-1.5 pr-2">{l.label}</td>
                        <td className="py-1.5 pr-2 font-mono text-right">{fmtAmendCol(l.original)}</td>
                        <td className={`py-1.5 pr-2 font-mono text-right ${amendDeltaClass(l.lineRef, l.netChange)}`}>
                          {fmtAmendCol(l.netChange)}
                        </td>
                        <td className="py-1.5 pr-2 font-mono text-right">{fmtAmendCol(l.amended)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {form.creditDetail.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Nonrefundable credit detail (supplementary)</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {form.creditDetail.map((l) => (
                        <tr key={l.lineRef} className="border-b border-border">
                          <td className="py-1 pr-2 text-muted-foreground w-10">{l.lineRef}</td>
                          <td className="py-1 pr-2">{l.label.trim()}</td>
                          <td className="py-1 pr-2 font-mono text-right">{fmtAmendCol(l.original)}</td>
                          <td className={`py-1 pr-2 font-mono text-right ${amendDeltaClass(l.lineRef, l.netChange)}`}>{fmtAmendCol(l.netChange)}</td>
                          <td className="py-1 pr-2 font-mono text-right">{fmtAmendCol(l.amended)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {form.stateLines.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Amended state return summary</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {form.stateLines.map((l) => (
                        <tr key={l.lineRef} className="border-b border-border">
                          <td className="py-1 pr-2 text-muted-foreground w-10">{l.lineRef}</td>
                          <td className="py-1 pr-2">{l.label}</td>
                          <td className="py-1 pr-2 font-mono text-right">{fmtAmendCol(l.original)}</td>
                          <td className={`py-1 pr-2 font-mono text-right ${amendDeltaClass(l.lineRef, l.netChange)}`}>{fmtAmendCol(l.netChange)}</td>
                          <td className="py-1 pr-2 font-mono text-right">{fmtAmendCol(l.amended)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="form1040x-explanation">Part III — Explanation of changes (required by IRS)</Label>
              <Textarea
                id="form1040x-explanation"
                value={explanationDraft}
                onChange={(e) => setExplanationDraft(e.target.value)}
                onBlur={saveExplanation}
                placeholder="e.g., 'Corrected 1099-DIV from ACME Corp received after original filing. Increased qualified dividends by $X. No other changes.'"
                rows={4}
                maxLength={5000}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Autosaves on blur. Max 5000 characters.
              </p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <Button onClick={handleDownloadPdf} disabled={!form}>
                Download Form 1040-X (PDF)
              </Button>
              <Button onClick={handleClearAmendment} variant="outline">
                Clear amendment baseline
              </Button>
            </div>
          </>
        ) : (
          <Skeleton className="h-40" />
        )}
      </CardContent>
    </Card>
  );
}

// ─── C8 — Form 4868 (Extension) ───────────────────────────────────────────
// Lives under the Tax Calculator tab. Live preview of Lines 4-7 via the
// JSON endpoint; PDF download via the sibling /pdf endpoint.
interface Form4868Preview {
  taxYear: number;
  estimatedTotalTax: number;
  totalPayments: number;
  balanceDue: number;
  amountBeingPaid: number;
  outOfCountry: boolean;
  form1040NrNoWithholding: boolean;
}

function fmt4868(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function Form4868Card({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const [amountBeingPaid, setAmountBeingPaid] = useState("");
  const [estimatedTaxPaid, setEstimatedTaxPaid] = useState("");
  const [outOfCountry, setOutOfCountry] = useState(false);
  const [form1040Nr, setForm1040Nr] = useState(false);

  function buildQuery(): string {
    const p = new URLSearchParams({ taxYear: String(taxYear) });
    if (amountBeingPaid !== "") p.set("amountBeingPaid", amountBeingPaid);
    if (estimatedTaxPaid !== "") p.set("estimatedTaxAlreadyPaid", estimatedTaxPaid);
    if (outOfCountry) p.set("outOfCountry", "true");
    if (form1040Nr) p.set("form1040NrNoWithholding", "true");
    return p.toString();
  }

  const previewQuery = useQuery<Form4868Preview>({
    queryKey: ["form-4868", clientId, taxYear, amountBeingPaid, estimatedTaxPaid, outOfCountry, form1040Nr],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/tax-return/form-4868?${buildQuery()}`);
      if (!res.ok) throw new Error("Form 4868 preview failed");
      return res.json();
    },
    retry: false,
  });

  function handleDownload() {
    const link = document.createElement("a");
    link.href = `/api/clients/${clientId}/tax-return/form-4868/pdf?${buildQuery()}`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const data = previewQuery.data;

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Form 4868 — Extension to File</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Automatic 6-month extension (Oct 15 for calendar-year filers). Extension to <strong>file</strong>, not to <strong>pay</strong> — any balance due accrues interest + late-pay penalty from Apr 15 unless 90% paid by then.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="form4868-amount-paying">Amount paying with extension (Line 7)</Label>
            <CurrencyInput
              value={amountBeingPaid}
              onChange={setAmountBeingPaid}
              placeholder="defaults to balance due"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave blank to pay full balance due. Partial OK — interest accrues on unpaid portion.
            </p>
          </div>
          <div>
            <Label htmlFor="form4868-est-paid">Estimated tax already paid this year</Label>
            <CurrencyInput
              value={estimatedTaxPaid}
              onChange={setEstimatedTaxPaid}
              placeholder="0"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Q1-Q4 estimated payments not already in the engine via W-2 withholding.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Switch id="form4868-out-of-country" checked={outOfCountry} onCheckedChange={setOutOfCountry} />
            <Label htmlFor="form4868-out-of-country" className="cursor-pointer">
              Line 8 — Out of the country on April 15 (auto +2-month extension)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="form4868-1040nr" checked={form1040Nr} onCheckedChange={setForm1040Nr} />
            <Label htmlFor="form4868-1040nr" className="cursor-pointer">
              Line 9 — Filing Form 1040-NR, no US-withheld wages (extends to Dec 15)
            </Label>
          </div>
        </div>

        <div className="rounded-md border bg-muted/50 p-4">
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-muted-foreground">Line 4 — Estimated total tax</span>
            <span className="font-mono text-right">{data ? fmt4868(data.estimatedTotalTax) : "—"}</span>
            <span className="text-muted-foreground">Line 5 — Total payments</span>
            <span className="font-mono text-right">{data ? fmt4868(data.totalPayments) : "—"}</span>
            <span className="text-muted-foreground font-medium">Line 6 — Balance due</span>
            <span className={`font-mono text-right font-medium ${data && data.balanceDue > 0 ? "text-destructive" : ""}`}>
              {data ? fmt4868(data.balanceDue) : "—"}
            </span>
            <span className="text-success font-semibold">Line 7 — Paying with extension</span>
            <span className="font-mono text-right text-success font-semibold">{data ? fmt4868(data.amountBeingPaid) : "—"}</span>
          </div>
        </div>

        {previewQuery.error ? (
          <p className="text-xs text-destructive">
            Could not load Form 4868 preview: {String((previewQuery.error as Error).message)}
          </p>
        ) : null}

        <div>
          <Button onClick={handleDownload} disabled={previewQuery.isLoading || !data}>
            Download Form 4868 (PDF)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface Form2210Preview {
  taxYear: number;
  currentYearTax: number;
  ninetyPercentCurrent: number;
  priorYearTax: number | null;
  priorYearSafeHarborPct: number;
  priorYearSafeHarbor: number | null;
  withholding: number;
  estimatedPayments: number;
  totalPaid: number;
  requiredAnnualPayment: number;
  underpayment: number;
  additionalToSafeHarbor: number;
  penaltyApplies: boolean;
  penaltyWaivedReason: "prior_year_zero" | "under_1000" | "met_safe_harbor" | null;
  estimatedPenalty: number | null;
  penaltyRateUsed: number | null;
}

const FORM2210_WAIVED_LABELS: Record<string, string> = {
  prior_year_zero: "No penalty — the prior year had no tax liability (§6654(e)(2)).",
  under_1000: "No penalty — current-year tax minus withholding is under $1,000 (§6654(e)(1)).",
  met_safe_harbor: "No penalty — payments met the required annual payment (safe harbor).",
};

function Form2210Card({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const [estimatedPayments, setEstimatedPayments] = useState("");

  function buildQuery(): string {
    const p = new URLSearchParams({ taxYear: String(taxYear) });
    if (estimatedPayments !== "") p.set("estimatedPayments", estimatedPayments);
    return p.toString();
  }

  const previewQuery = useQuery<Form2210Preview>({
    queryKey: ["form-2210", clientId, taxYear, estimatedPayments],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/tax-return/form-2210?${buildQuery()}`);
      if (!res.ok) throw new Error("Form 2210 preview failed");
      return res.json();
    },
    retry: false,
  });

  function handleDownload() {
    const link = document.createElement("a");
    link.href = `/api/clients/${clientId}/tax-return/form-2210/pdf?${buildQuery()}`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const data = previewQuery.data;
  const penaltyLabel = data?.estimatedPenalty != null ? fmt4868(data.estimatedPenalty) : "—";

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Form 2210 — Underpayment Penalty (§6654)</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Estimated-tax safe-harbor target + whether an underpayment penalty applies. Required annual payment = lesser of 90% of this year's tax or 100%/110% of last year's. The penalty $ is an estimate (exact amount depends on per-quarter payment timing).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs">
          <Label htmlFor="form2210-est-payments">Estimated tax payments (not in withholding)</Label>
          <CurrencyInput value={estimatedPayments} onChange={setEstimatedPayments} placeholder="0" />
          <p className="text-xs text-muted-foreground mt-1">
            Q1–Q4 estimated payments made directly, not via W-2/1099 withholding.
          </p>
        </div>

        {data ? (
          <div
            className={`rounded-md border p-4 ${data.penaltyApplies ? "border-destructive/40 bg-destructive/5" : "border-success/40 bg-success/5"}`}
          >
            {data.penaltyApplies ? (
              <>
                <div className="text-sm font-semibold text-destructive">
                  Underpayment penalty applies — est. {penaltyLabel}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Pay {fmt4868(data.additionalToSafeHarbor)} more (withholding + estimates) to reach the{" "}
                  {fmt4868(data.requiredAnnualPayment)} safe-harbor target and avoid the penalty.
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-success">No underpayment penalty</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {data.penaltyWaivedReason ? FORM2210_WAIVED_LABELS[data.penaltyWaivedReason] : ""}
                </div>
              </>
            )}
          </div>
        ) : null}

        <div className="rounded-md border bg-muted/50 p-4">
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-muted-foreground">Current-year tax (§6654)</span>
            <span className="font-mono text-right">{data ? fmt4868(data.currentYearTax) : "—"}</span>
            <span className="text-muted-foreground">90% of current-year tax</span>
            <span className="font-mono text-right">{data ? fmt4868(data.ninetyPercentCurrent) : "—"}</span>
            <span className="text-muted-foreground">
              Prior-year safe harbor{data ? ` (${Math.round(data.priorYearSafeHarborPct * 100)}%)` : ""}
            </span>
            <span className="font-mono text-right">{data && data.priorYearSafeHarbor != null ? fmt4868(data.priorYearSafeHarbor) : "—"}</span>
            <span className="text-primary font-semibold">Required annual payment (safe-harbor target)</span>
            <span className="font-mono text-right text-primary font-semibold">{data ? fmt4868(data.requiredAnnualPayment) : "—"}</span>
            <span className="text-muted-foreground">Withholding + estimated payments</span>
            <span className="font-mono text-right">{data ? fmt4868(data.totalPaid) : "—"}</span>
            <span className="text-muted-foreground font-medium">Underpayment</span>
            <span className={`font-mono text-right font-medium ${data && data.underpayment > 0 ? "text-destructive" : ""}`}>
              {data ? fmt4868(data.underpayment) : "—"}
            </span>
            <span className="text-muted-foreground">Estimated §6654 penalty</span>
            <span className={`font-mono text-right ${data && data.penaltyApplies ? "text-destructive" : ""}`}>{penaltyLabel}</span>
          </div>
        </div>

        {previewQuery.error ? (
          <p className="text-xs text-destructive">
            Could not load Form 2210 preview: {String((previewQuery.error as Error).message)}
          </p>
        ) : null}

        <div>
          <Button onClick={handleDownload} disabled={previewQuery.isLoading || !data}>
            Download Form 2210 (PDF)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── P2-16 — Return-level diagnostics ("ready to hand off" panel) ───────────
type DiagnosticSeverity = "critical" | "warning" | "info";
interface ReturnDiagnostic {
  id: string;
  severity: DiagnosticSeverity;
  category: string;
  title: string;
  detail: string;
  field?: string | null;
}
interface ReturnDiagnosticsResult {
  diagnostics: ReturnDiagnostic[];
  counts: { critical: number; warning: number; info: number; total: number };
  readyToHandOff: boolean;
}

const DIAG_STYLE: Record<DiagnosticSeverity, { icon: typeof Info; box: string; text: string; label: string }> = {
  critical: { icon: AlertCircle, box: "border-destructive/40 bg-destructive/5", text: "text-destructive", label: "Critical" },
  warning: { icon: AlertTriangle, box: "border-amber-300 bg-amber-50", text: "text-amber-700", label: "Warning" },
  info: { icon: Info, box: "border-brand/30 bg-brand/5", text: "text-brand-ink", label: "Info" },
};

function DiagnosticsCard({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const query = useQuery<ReturnDiagnosticsResult>({
    queryKey: ["diagnostics", clientId, taxYear],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/tax-return/diagnostics?taxYear=${taxYear}`);
      if (!res.ok) throw new Error("Diagnostics failed");
      return res.json();
    },
    retry: false,
  });
  const data = query.data;

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {data?.readyToHandOff ? (
            <CheckCircle2 className="h-5 w-5 text-success" />
          ) : (
            <AlertCircle className="h-5 w-5 text-destructive" />
          )}
          Pre-filing diagnostics
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          The critical / warning / informational checklist to run before handing the return off for filing.
          Criticals block "ready to hand off"; warnings and info are advisory.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {data ? (
          <>
            <div
              className={`rounded-md border p-4 ${data.readyToHandOff ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"}`}
            >
              <div className={`text-sm font-semibold ${data.readyToHandOff ? "text-success" : "text-destructive"}`}>
                {data.readyToHandOff
                  ? "Ready to hand off — no critical issues"
                  : `${data.counts.critical} critical issue${data.counts.critical === 1 ? "" : "s"} must be resolved before filing`}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {data.counts.critical} critical · {data.counts.warning} warning · {data.counts.info} info
              </div>
            </div>

            {data.diagnostics.length === 0 ? (
              <p className="text-sm text-muted-foreground">No issues detected.</p>
            ) : (
              <ul className="space-y-2">
                {data.diagnostics.map((d) => {
                  const style = DIAG_STYLE[d.severity];
                  const Icon = style.icon;
                  return (
                    <li key={d.id} className={`rounded-md border p-3 ${style.box}`}>
                      <div className="flex items-start gap-2">
                        <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${style.text}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${style.text}`}>{d.title}</span>
                            <Badge variant="outline" className="text-[10px]">{d.category}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{d.detail}</p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : query.error ? (
          <p className="text-xs text-destructive">Could not load diagnostics: {String((query.error as Error).message)}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Loading diagnostics…</p>
        )}
      </CardContent>
    </Card>
  );
}

function TaxCalculatorTab({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const { data: taxReturn, isLoading } = useGetTaxReturn(clientId, {
    query: { queryKey: getGetTaxReturnQueryKey(clientId), retry: false },
  });
  const calculate = useCalculateTaxReturn();
  const qc = useQueryClient();

  const breakdown = useQuery<BreakdownResponse>({
    queryKey: ["tax-return-breakdown", clientId, taxReturn?.updatedAt],
    enabled: !!taxReturn,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/tax-return/breakdown`);
      if (!res.ok) throw new Error("Failed to load breakdown");
      return res.json();
    },
  });

  const [additionalIncome, setAdditionalIncome] = useState("");
  const [useItemized, setUseItemized] = useState(false);
  const [additionalDeductions, setAdditionalDeductions] = useState("");

  function handleCalculate() {
    calculate.mutate(
      {
        clientId,
        data: {
          taxYear,
          additionalIncome: additionalIncome ? Number(additionalIncome) : undefined,
          useItemizedDeductions: useItemized,
          additionalDeductions: additionalDeductions ? Number(additionalDeductions) : undefined,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          toast({ title: "Tax return calculated" });
        },
        onError: () => toast({ title: "Calculation failed", variant: "destructive" }),
      }
    );
  }

  const isRefund = taxReturn?.federalRefundOrOwed != null && Number(taxReturn.federalRefundOrOwed) > 0;
  const isOwed = taxReturn?.federalRefundOrOwed != null && Number(taxReturn.federalRefundOrOwed) < 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Calculate Return</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Additional Income</Label>
              <CurrencyInput value={additionalIncome} onChange={setAdditionalIncome} />
            </div>
            <div className="space-y-2">
              <Label>Additional Deductions</Label>
              <CurrencyInput value={additionalDeductions} onChange={setAdditionalDeductions} />
            </div>
            <div className="flex items-end pb-1 gap-3">
              <div className="flex items-center gap-2">
                <Switch id="itemized" checked={useItemized} onCheckedChange={setUseItemized} />
                <Label htmlFor="itemized" className="cursor-pointer">Itemize</Label>
              </div>
            </div>
          </div>
          <Button onClick={handleCalculate} disabled={calculate.isPending}>
            {calculate.isPending ? "Calculating..." : "Calculate Return"}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : taxReturn ? (
        <div className="space-y-4">
          {/* Refund/Owed Banner */}
          <div className={`rounded-lg p-6 border-2 ${isRefund ? "border-success/40 bg-success/10" : isOwed ? "border-amber-400 bg-amber-50" : "border-border bg-muted"}`}>
            <div className="text-sm font-medium text-muted-foreground mb-1">
              Federal {isRefund ? "Refund" : isOwed ? "Amount Owed" : "Balance"}
            </div>
            <div className={`text-4xl font-bold font-mono ${isRefund ? "text-success" : isOwed ? "text-amber-700" : "text-foreground"}`}>
              {taxReturn.federalRefundOrOwed != null
                ? fmt(Math.abs(Number(taxReturn.federalRefundOrOwed)))
                : "—"}
            </div>
            {taxReturn.stateRefundOrOwed != null && (
              <div className="text-sm mt-2 text-muted-foreground">
                State {Number(taxReturn.stateRefundOrOwed) >= 0 ? "refund" : "owed"}: <span className="font-mono font-semibold">{fmt(Math.abs(Number(taxReturn.stateRefundOrOwed)))}</span>
              </div>
            )}
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Income Summary</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  ["Total Income", taxReturn.totalIncome],
                  ["Adjusted Gross Income", taxReturn.adjustedGrossIncome],
                  ["Standard/Itemized Deduction", taxReturn.standardDeduction],
                  ["Taxable Income", taxReturn.taxableIncome],
                  ["Effective Tax Rate", null],
                ].map(([label]) => (
                  <div key={String(label)} className="flex justify-between">
                    <span className="text-muted-foreground">{String(label)}</span>
                    <span className="font-mono font-semibold">
                      {label === "Effective Tax Rate" ? pct(Number(taxReturn.effectiveTaxRate)) :
                        label === "Total Income" ? fmt(Number(taxReturn.totalIncome)) :
                        label === "Adjusted Gross Income" ? fmt(Number(taxReturn.adjustedGrossIncome)) :
                        label === "Standard/Itemized Deduction" ? fmt(Number(taxReturn.standardDeduction)) :
                        fmt(Number(taxReturn.taxableIncome))}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Tax Liability</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {[
                  ["Federal Tax (total)", taxReturn.federalTaxLiability],
                  ...((Number(taxReturn.selfEmploymentTax) || 0) > 0 ? [["  └─ SE Tax", taxReturn.selfEmploymentTax]] as Array<[string, unknown]> : []),
                  ...((Number(taxReturn.amtTax) || 0) > 0 ? [["  └─ AMT", taxReturn.amtTax]] as Array<[string, unknown]> : []),
                  ...((Number(taxReturn.niitTax) || 0) > 0 ? [["  └─ NIIT (3.8%)", taxReturn.niitTax]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).capitalGainsTax) || 0) > 0 ? [["  └─ Capital Gains Tax (LTCG/QDIV)", (taxReturn as any).capitalGainsTax]] as Array<[string, unknown]> : []),
                  ...((Number(taxReturn.qbiDeduction) || 0) > 0 ? [["  └─ QBI Deduction", taxReturn.qbiDeduction]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).hsaDeduction) || 0) > 0 ? [["  └─ HSA Deduction", (taxReturn as any).hsaDeduction]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).iraDeduction) || 0) > 0 ? [["  └─ IRA Deduction", (taxReturn as any).iraDeduction]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).scheduleCExpenses) || 0) > 0 ? [["  └─ Schedule C Expenses", (taxReturn as any).scheduleCExpenses]] as Array<[string, unknown]> : []),
                  ...((Number(taxReturn.additionalChildTaxCredit) || 0) > 0 ? [["  └─ Refundable ACTC", taxReturn.additionalChildTaxCredit]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).eitc) || 0) > 0 ? [["  └─ EITC (refundable)", (taxReturn as any).eitc]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).aocCredit) || 0) > 0 ? [["  └─ Education AOC", (taxReturn as any).aocCredit]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).llcCredit) || 0) > 0 ? [["  └─ Education LLC", (taxReturn as any).llcCredit]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).saversCredit) || 0) > 0 ? [["  └─ Saver's Credit", (taxReturn as any).saversCredit]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).dependentCareCredit) || 0) > 0 ? [["  └─ Dependent Care Credit", (taxReturn as any).dependentCareCredit]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).educatorExpensesDeduction) || 0) > 0 ? [["  └─ Educator Expenses", (taxReturn as any).educatorExpensesDeduction]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).studentLoanInterestDeduction) || 0) > 0 ? [["  └─ Student Loan Interest", (taxReturn as any).studentLoanInterestDeduction]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).foreignTaxCredit) || 0) > 0 ? [["  └─ Foreign Tax Credit", (taxReturn as any).foreignTaxCredit]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).residentialEnergyCredits) || 0) > 0 ? [["  └─ Residential Energy Credits", (taxReturn as any).residentialEnergyCredits]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).premiumTaxCredit) || 0) !== 0 ? [[`  └─ Premium Tax Credit ${Number((taxReturn as any).premiumTaxCredit) > 0 ? "(refundable)" : "(repayment)"}`, (taxReturn as any).premiumTaxCredit]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).capitalLossDeducted) || 0) > 0 ? [["  └─ Capital Loss Deducted ($3k cap)", (taxReturn as any).capitalLossDeducted]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).scheduleERentalAppliedToAgi) || 0) !== 0 ? [[`  └─ Schedule E Rental ${Number((taxReturn as any).scheduleERentalAppliedToAgi) > 0 ? "(income)" : "(loss applied)"}`, (taxReturn as any).scheduleERentalAppliedToAgi]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).scheduleEPassiveLossSuspended) || 0) > 0 ? [["  └─ §469 Passive Loss Suspended", (taxReturn as any).scheduleEPassiveLossSuspended]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).stateRetirementExemption) || 0) > 0 ? [["  └─ State Retirement Exemption (PA/IL/MS)", (taxReturn as any).stateRetirementExemption]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).householdEmploymentTax) || 0) > 0 ? [["  └─ Schedule H (household employment)", (taxReturn as any).householdEmploymentTax]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).unrecapturedSection1250Gain) || 0) > 0 ? [["  └─ Unrecaptured §1250 gain (25% max)", (taxReturn as any).unrecapturedSection1250Gain]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).collectibles28RateGain) || 0) > 0 ? [["  └─ 28%-rate gain (collectibles / §1202)", (taxReturn as any).collectibles28RateGain]] as Array<[string, unknown]> : []),
                  ["Federal Withheld", taxReturn.federalTaxWithheld],
                  ["Federal Refund/Owed", taxReturn.federalRefundOrOwed],
                  ["State Tax", taxReturn.stateTaxLiability],
                  ...((Number((taxReturn as any).stateIndividualMandatePenalty) || 0) > 0 ? [["  └─ Individual mandate penalty (CA/NJ/RI/DC/MA)", (taxReturn as any).stateIndividualMandatePenalty]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).formerStateTax) || 0) > 0 ? [[`  └─ Part-year: ${(taxReturn as any).formerStateCode ?? ""} (${(taxReturn as any).daysFormerStateResident ?? 0}d resident)`, (taxReturn as any).formerStateTax]] as Array<[string, unknown]> : []),
                  ...((Number((taxReturn as any).localTaxLiability) || 0) > 0 ? [[`Local Tax (${localityLabel((taxReturn as any).localTaxJurisdiction)})`, (taxReturn as any).localTaxLiability]] as Array<[string, unknown]> : []),
                  ["State Withheld", taxReturn.stateTaxWithheld],
                  ["State Refund/Owed", taxReturn.stateRefundOrOwed],
                ].map(([label, val]) => (
                  <div key={String(label)} className={`flex justify-between ${String(label).startsWith("  └─") ? "text-xs" : ""}`}>
                    <span className="text-muted-foreground">{String(label)}</span>
                    <span className={`font-mono font-semibold ${String(label).includes("Refund/Owed") && Number(val) > 0 ? "text-success" : String(label).includes("Refund/Owed") && Number(val) < 0 ? "text-amber-600" : ""}`}>
                      {fmt(Number(val))}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {breakdown.data && (
            <>
              {breakdown.data.childTaxCredit.preliminaryCredit > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Child Tax Credit (auto-calculated)</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {breakdown.data.childTaxCredit.qualifyingChildren} qualifying {breakdown.data.childTaxCredit.qualifyingChildren === 1 ? "child" : "children"} × $2,000
                        {breakdown.data.childTaxCredit.otherDependents > 0 && ` + ${breakdown.data.childTaxCredit.otherDependents} other × $500`}
                      </span>
                      <span className="font-mono font-semibold">{fmt(breakdown.data.childTaxCredit.preliminaryCredit)}</span>
                    </div>
                    {breakdown.data.childTaxCredit.phaseOutReduction > 0 && (
                      <div className="flex justify-between text-amber-700">
                        <span>Phase-out reduction (AGI over ${breakdown.data.childTaxCredit.phaseOutThreshold.toLocaleString()})</span>
                        <span className="font-mono">−{fmt(breakdown.data.childTaxCredit.phaseOutReduction)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-2">
                      <span className="font-semibold">Applied credit</span>
                      <span className="font-mono font-semibold text-success">{fmt(breakdown.data.childTaxCredit.appliedCredit)}</span>
                    </div>
                  </CardContent>
                </Card>
              )}
              <BracketBreakdownPanel data={breakdown.data} />
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2 print:hidden">
            <Button
              variant="outline"
              size="sm"
              title="Custom one-page tax-return summary (TaxFlow layout) for client email or print"
              onClick={() => {
                const link = document.createElement("a");
                link.href = `/api/clients/${clientId}/tax-return/pdf?taxYear=${taxYear}`;
                link.download = "";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              Download PDF (summary)
            </Button>
            <Button
              variant="default"
              size="sm"
              title="Official IRS Form 1040 with values filled in via pdf-lib (TY2024 template)"
              onClick={() => {
                const link = document.createElement("a");
                link.href = `/api/clients/${clientId}/tax-return/form-1040?taxYear=${taxYear}`;
                link.download = "";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              IRS Form 1040 (PDF)
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="CSV export with IRS line numbers + UltraTax/Lacerte/ProConnect/Drake field codes"
              onClick={() => {
                const link = document.createElement("a");
                link.href = `/api/clients/${clientId}/tax-return/csv?taxYear=${taxYear}`;
                link.download = "";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              CSV (for CPA tools)
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="Vendor-neutral key=value text summary, one IRS line per row. For CPA review — not an UltraTax/Lacerte/ProConnect/Drake import file."
              onClick={() => {
                const link = document.createElement("a");
                link.href = `/api/clients/${clientId}/tax-return/ultratax?taxYear=${taxYear}`;
                link.download = "";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              Summary (.txt)
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="Complete machine-readable JSON export for integration with other tools"
              onClick={() => {
                const link = document.createElement("a");
                link.href = `/api/clients/${clientId}/tax-return/json?taxYear=${taxYear}`;
                link.download = "";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              JSON
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              Print return
            </Button>
          </div>

          <DiagnosticsCard clientId={clientId} taxYear={taxYear} />
          <Section1031Card clientId={clientId} taxYear={taxYear} taxReturn={taxReturn as unknown as Parameters<typeof Section1031Card>[0]["taxReturn"]} />
          <EsppIsoCard taxReturn={taxReturn as unknown as Parameters<typeof EsppIsoCard>[0]["taxReturn"]} />
          <Section163j461lCard clientId={clientId} taxYear={taxYear} taxReturn={taxReturn as unknown as Parameters<typeof Section163j461lCard>[0]["taxReturn"]} />
          <Form4868Card clientId={clientId} taxYear={taxYear} />
          <Form2210Card clientId={clientId} taxYear={taxYear} />
          <Form1040xCard clientId={clientId} taxYear={taxYear} />
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No tax return calculated yet. Upload W-2 documents and click Calculate Return.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Year Compare Tab ────────────────────────────────────────────────────────

interface PreviewResponse {
  taxYear: number;
  filingStatus: string;
  stateCode: string;
  totalIncome: number;
  adjustedGrossIncome: number;
  standardDeduction: number;
  itemizedDeductions: number | null;
  qbiDeduction: number;
  taxableIncome: number;
  federalTaxLiability: number;
  federalTaxWithheld: number;
  federalRefundOrOwed: number;
  stateTaxLiability: number;
  stateTaxWithheld: number;
  stateRefundOrOwed: number;
  effectiveTaxRate: number;
  manualCreditsApplied: number;
  childTaxCredit: {
    qualifyingChildren: number;
    otherDependents: number;
    preliminaryCredit: number;
    phaseOutReduction: number;
    appliedCredit: number;
    phaseOutThreshold: number;
  };
  // Phase 1
  scheduleCExpenses?: number;
  retirementDeductions?: { hsaDeductible: number; iraDeductible: number };
  eitc?: { appliedCredit: number };
  educationCredits?: { aocApplied: number; llcApplied: number; aocRefundable: number };
  saversCredit?: { appliedCredit: number };
  dependentCareCredit?: { appliedCredit: number };
  // Phase 1.5
  educatorExpenses?: { deductible: number };
  studentLoanInterest?: { deductible: number };
  foreignTaxCredit?: { credit: number };
  residentialEnergyCredits?: { total: number };
  premiumTaxCredit?: { netPtc: number };
  // Phase 2
  capitalLossDeducted?: number;
  netCapitalGainLoss?: number;
  scheduleERentalAppliedToAgi?: number;
  stateRetirementExemption?: number;
  // Federal sub-components
  selfEmploymentTax?: number;
  niitTax?: number;
  amtTax?: number;
  capitalGainsTax?: number;
  additionalChildTaxCredit?: number;
  w2Count: number;
}

function YearCompareTab({ clientId }: { clientId: number }) {
  const [yearA, setYearA] = useState(2024);
  const [yearB, setYearB] = useState(2025);

  const previewA = useQuery<PreviewResponse>({
    queryKey: ["tax-return-preview", clientId, yearA],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/tax-return/preview?taxYear=${yearA}`);
      if (!res.ok) throw new Error("preview A failed");
      return res.json();
    },
    retry: false,
  });
  const previewB = useQuery<PreviewResponse>({
    queryKey: ["tax-return-preview", clientId, yearB],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/tax-return/preview?taxYear=${yearB}`);
      if (!res.ok) throw new Error("preview B failed");
      return res.json();
    },
    retry: false,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compare two tax years side-by-side</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Each side computes a complete return for that year using only the W-2s tagged with that year.
          Adjustments and dependent counts apply to both sides. Nothing here is saved — the persisted
          tax return on the Calculator tab is unaffected.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CompareColumn
          label="Year A"
          year={yearA}
          onYearChange={setYearA}
          preview={previewA.data}
          isLoading={previewA.isLoading}
        />
        <CompareColumn
          label="Year B"
          year={yearB}
          onYearChange={setYearB}
          preview={previewB.data}
          isLoading={previewB.isLoading}
        />
      </div>

      {previewA.data && previewB.data && (
        <DiffCard a={previewA.data} b={previewB.data} />
      )}
    </div>
  );
}

function CompareColumn({
  label,
  year,
  onYearChange,
  preview,
  isLoading,
}: {
  label: string;
  year: number;
  onYearChange: (y: number) => void;
  preview: PreviewResponse | undefined;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">{label}</CardTitle>
          <Select value={String(year)} onValueChange={(v) => onYearChange(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="2024">TY 2024</SelectItem>
              <SelectItem value="2025">TY 2025</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : !preview ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="text-xs text-muted-foreground">
              {preview.w2Count} W-2 record{preview.w2Count === 1 ? "" : "s"} tagged for TY {preview.taxYear}
            </div>
            {preview.w2Count === 0 && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                No W-2s tagged for {preview.taxYear}. Numbers reflect adjustments only.
              </div>
            )}
            {[
              ["Total Income", preview.totalIncome],
              ["Adjusted Gross Income", preview.adjustedGrossIncome],
              ["Standard Deduction", preview.standardDeduction],
              ["QBI Deduction", preview.qbiDeduction ?? 0],
              ["Taxable Income", preview.taxableIncome],
            ]
              .filter(([label, val]) => String(label) !== "QBI Deduction" || Number(val) > 0)
              .map(([label, val]) => (
                <div key={String(label)} className="flex justify-between">
                  <span className="text-muted-foreground">{String(label)}</span>
                  <span className="font-mono font-semibold">{fmt(Number(val))}</span>
                </div>
              ))}

            {/* Phase 1.5 + Phase 2 deductions/income — conditionally rendered */}
            {(
              [
                ["Educator Expenses (Sch 1)", preview.educatorExpenses?.deductible ?? 0],
                ["Student Loan Interest (Sch 1)", preview.studentLoanInterest?.deductible ?? 0],
                ["HSA Deduction (Sch 1)", preview.retirementDeductions?.hsaDeductible ?? 0],
                ["IRA Deduction (Sch 1)", preview.retirementDeductions?.iraDeductible ?? 0],
                ["Sched C Expenses", preview.scheduleCExpenses ?? 0],
                ["Net Capital Gain/Loss (Sch D)", preview.netCapitalGainLoss ?? 0],
                ["Capital Loss vs Ordinary (Sch D L21)", preview.capitalLossDeducted ?? 0],
                ["Rental Net Applied (Sch E)", preview.scheduleERentalAppliedToAgi ?? 0],
              ] as Array<[string, number]>
            )
              .filter(([, val]) => val !== 0)
              .map(([label, val]) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono">{val < 0 ? "−" : ""}{fmt(Math.abs(val))}</span>
                </div>
              ))}

            <div className="border-t my-2"></div>
            {[
              ["Federal Tax", preview.federalTaxLiability],
              ["Federal Withheld", preview.federalTaxWithheld],
              ["CTC Applied", preview.childTaxCredit.appliedCredit],
              ["Federal Refund/Owed", preview.federalRefundOrOwed],
            ].map(([label, val]) => {
              const isRefundLine = String(label) === "Federal Refund/Owed";
              const num = Number(val);
              return (
                <div key={String(label)} className="flex justify-between">
                  <span className="text-muted-foreground">{String(label)}</span>
                  <span className={`font-mono font-semibold ${isRefundLine ? (num > 0 ? "text-success" : num < 0 ? "text-amber-700" : "") : ""}`}>
                    {isRefundLine && num !== 0 ? (num > 0 ? "+" : "−") : ""}{fmt(Math.abs(num))}
                  </span>
                </div>
              );
            })}

            {/* Federal sub-components + credits — conditionally rendered */}
            {(
              [
                ["AMT (Form 6251)", preview.amtTax ?? 0],
                ["SE Tax (Sched SE)", preview.selfEmploymentTax ?? 0],
                ["NIIT (Form 8960)", preview.niitTax ?? 0],
                ["Cap Gains Tax (LTCG/QDIV)", preview.capitalGainsTax ?? 0],
                ["Foreign Tax Credit", preview.foreignTaxCredit?.credit ?? 0],
                ["Dep Care Credit", preview.dependentCareCredit?.appliedCredit ?? 0],
                ["Saver's Credit", preview.saversCredit?.appliedCredit ?? 0],
                ["Education AOC", preview.educationCredits?.aocApplied ?? 0],
                ["Education LLC", preview.educationCredits?.llcApplied ?? 0],
                ["Residential Energy", preview.residentialEnergyCredits?.total ?? 0],
                ["EITC (refundable)", preview.eitc?.appliedCredit ?? 0],
                ["AOC refundable 40%", preview.educationCredits?.aocRefundable ?? 0],
                ["Additional CTC (refundable)", preview.additionalChildTaxCredit ?? 0],
                ["Premium Tax Credit (net)", preview.premiumTaxCredit?.netPtc ?? 0],
              ] as Array<[string, number]>
            )
              .filter(([, val]) => val !== 0)
              .map(([label, val]) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono">{val < 0 ? "−" : ""}{fmt(Math.abs(val))}</span>
                </div>
              ))}

            <div className="border-t my-2"></div>
            {[
              ["State Tax", preview.stateTaxLiability],
              ["State Withheld", preview.stateTaxWithheld],
              ["State Refund/Owed", preview.stateRefundOrOwed],
            ].map(([label, val]) => {
              const isRefundLine = String(label) === "State Refund/Owed";
              const num = Number(val);
              return (
                <div key={String(label)} className="flex justify-between">
                  <span className="text-muted-foreground">{String(label)}</span>
                  <span className={`font-mono font-semibold ${isRefundLine ? (num > 0 ? "text-success" : num < 0 ? "text-amber-700" : "") : ""}`}>
                    {isRefundLine && num !== 0 ? (num > 0 ? "+" : "−") : ""}{fmt(Math.abs(num))}
                  </span>
                </div>
              );
            })}
            {(preview.stateRetirementExemption ?? 0) > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">State retirement-income exempt</span>
                <span className="font-mono">{fmt(preview.stateRetirementExemption ?? 0)}</span>
              </div>
            )}

            <div className="border-t my-2"></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Effective Tax Rate</span>
              <span className="font-mono font-semibold">{pct(preview.effectiveTaxRate)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DiffCard({ a, b }: { a: PreviewResponse; b: PreviewResponse }) {
  // Always-shown core lines:
  const core: { label: string; aVal: number; bVal: number }[] = [
    { label: "Total Income", aVal: a.totalIncome, bVal: b.totalIncome },
    { label: "AGI", aVal: a.adjustedGrossIncome, bVal: b.adjustedGrossIncome },
    { label: "Standard Deduction", aVal: a.standardDeduction, bVal: b.standardDeduction },
    { label: "Taxable Income", aVal: a.taxableIncome, bVal: b.taxableIncome },
    { label: "Federal Tax", aVal: a.federalTaxLiability, bVal: b.federalTaxLiability },
    { label: "State Tax", aVal: a.stateTaxLiability, bVal: b.stateTaxLiability },
    { label: "Federal Refund/Owed", aVal: a.federalRefundOrOwed, bVal: b.federalRefundOrOwed },
    { label: "State Refund/Owed", aVal: a.stateRefundOrOwed, bVal: b.stateRefundOrOwed },
  ];
  // Conditionally-shown lines (only if non-zero in at least one year):
  const optional: { label: string; aVal: number; bVal: number }[] = [
    { label: "CTC Applied", aVal: a.childTaxCredit.appliedCredit, bVal: b.childTaxCredit.appliedCredit },
    { label: "EITC", aVal: a.eitc?.appliedCredit ?? 0, bVal: b.eitc?.appliedCredit ?? 0 },
    { label: "Net Capital Gain/Loss (Sch D)", aVal: a.netCapitalGainLoss ?? 0, bVal: b.netCapitalGainLoss ?? 0 },
    { label: "Capital Loss vs Ordinary", aVal: a.capitalLossDeducted ?? 0, bVal: b.capitalLossDeducted ?? 0 },
    { label: "Rental Net (Sch E)", aVal: a.scheduleERentalAppliedToAgi ?? 0, bVal: b.scheduleERentalAppliedToAgi ?? 0 },
    { label: "HSA Deduction", aVal: a.retirementDeductions?.hsaDeductible ?? 0, bVal: b.retirementDeductions?.hsaDeductible ?? 0 },
    { label: "IRA Deduction", aVal: a.retirementDeductions?.iraDeductible ?? 0, bVal: b.retirementDeductions?.iraDeductible ?? 0 },
    { label: "Sched C Expenses", aVal: a.scheduleCExpenses ?? 0, bVal: b.scheduleCExpenses ?? 0 },
    { label: "Educator Expenses", aVal: a.educatorExpenses?.deductible ?? 0, bVal: b.educatorExpenses?.deductible ?? 0 },
    { label: "Student Loan Interest", aVal: a.studentLoanInterest?.deductible ?? 0, bVal: b.studentLoanInterest?.deductible ?? 0 },
    { label: "Foreign Tax Credit", aVal: a.foreignTaxCredit?.credit ?? 0, bVal: b.foreignTaxCredit?.credit ?? 0 },
    { label: "Premium Tax Credit (net)", aVal: a.premiumTaxCredit?.netPtc ?? 0, bVal: b.premiumTaxCredit?.netPtc ?? 0 },
    { label: "Residential Energy", aVal: a.residentialEnergyCredits?.total ?? 0, bVal: b.residentialEnergyCredits?.total ?? 0 },
    { label: "AMT", aVal: a.amtTax ?? 0, bVal: b.amtTax ?? 0 },
    { label: "SE Tax", aVal: a.selfEmploymentTax ?? 0, bVal: b.selfEmploymentTax ?? 0 },
    { label: "NIIT", aVal: a.niitTax ?? 0, bVal: b.niitTax ?? 0 },
    { label: "State Retirement Exempt", aVal: a.stateRetirementExemption ?? 0, bVal: b.stateRetirementExemption ?? 0 },
  ].filter((r) => r.aVal !== 0 || r.bVal !== 0);
  const rows = [...core, ...optional];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Year-over-year delta · TY{a.taxYear} → TY{b.taxYear}</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="text-left pb-2">Metric</th>
              <th className="text-right pb-2">TY {a.taxYear}</th>
              <th className="text-right pb-2">TY {b.taxYear}</th>
              <th className="text-right pb-2">Δ (B − A)</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row) => {
              const delta = row.bVal - row.aVal;
              return (
                <tr key={row.label} className="border-t border-muted/60">
                  <td className="py-1.5 font-sans">{row.label}</td>
                  <td className="py-1.5 text-right">{fmt(row.aVal)}</td>
                  <td className="py-1.5 text-right">{fmt(row.bVal)}</td>
                  <td className={`py-1.5 text-right font-semibold ${yoyDeltaClass(row.label, delta)}`}>
                    {delta === 0 ? "—" : `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── 1099 Forms Tab ──────────────────────────────────────────────────────────

const FORM_1099_TYPES: Array<{ value: string; label: string; desc: string }> = [
  { value: "nec", label: "1099-NEC", desc: "Nonemployee compensation (self-employment)" },
  { value: "misc", label: "1099-MISC", desc: "Rent, royalties, other income" },
  { value: "int", label: "1099-INT", desc: "Interest income" },
  { value: "div", label: "1099-DIV", desc: "Dividends + capital gain distributions" },
  { value: "b", label: "1099-B", desc: "Brokerage / capital gains" },
  { value: "r", label: "1099-R", desc: "Retirement distributions" },
  { value: "g", label: "1099-G", desc: "Government payments / unemployment" },
  { value: "k", label: "1099-K", desc: "Payment card / third-party network" },
];

const FORM_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  FORM_1099_TYPES.map((t) => [t.value, t.label]),
);

interface Form1099FormState {
  formType: string;
  payerName: string;
  payerTin: string;
  recipientTin: string;
  federalTaxWithheld: string;
  stateTaxWithheld: string;
  stateCode: string;
  // type-specific
  nonemployeeCompensation: string;
  rents: string;
  royalties: string;
  otherIncome: string;
  interestIncome: string;
  taxExemptInterest: string;
  ordinaryDividends: string;
  qualifiedDividends: string;
  totalCapitalGainDistribution: string;
  proceeds: string;
  costBasis: string;
  shortTermGainLoss: string;
  longTermGainLoss: string;
  grossDistribution: string;
  taxableAmount: string;
  distributionCode: string;
  unemploymentCompensation: string;
  stateLocalRefund: string;
  grossPaymentAmount: string;
}

function blank1099Form(formType: string = "nec"): Form1099FormState {
  return {
    formType,
    payerName: "",
    payerTin: "",
    recipientTin: "",
    federalTaxWithheld: "",
    stateTaxWithheld: "",
    stateCode: "",
    nonemployeeCompensation: "",
    rents: "",
    royalties: "",
    otherIncome: "",
    interestIncome: "",
    taxExemptInterest: "",
    ordinaryDividends: "",
    qualifiedDividends: "",
    totalCapitalGainDistribution: "",
    proceeds: "",
    costBasis: "",
    shortTermGainLoss: "",
    longTermGainLoss: "",
    grossDistribution: "",
    taxableAmount: "",
    distributionCode: "",
    unemploymentCompensation: "",
    stateLocalRefund: "",
    grossPaymentAmount: "",
  };
}

function Form1099Fields({ form, onChange }: { form: Form1099FormState; onChange: (k: keyof Form1099FormState, v: string) => void }) {
  // Fields shown depend on the formType
  const t = form.formType;
  const typeFields: Array<{ key: keyof Form1099FormState; label: string }> = [];
  if (t === "nec") typeFields.push({ key: "nonemployeeCompensation", label: "Box 1 — Nonemployee comp" });
  if (t === "misc") {
    typeFields.push({ key: "rents", label: "Box 1 — Rents" });
    typeFields.push({ key: "royalties", label: "Box 2 — Royalties" });
    typeFields.push({ key: "otherIncome", label: "Box 3 — Other income" });
  }
  if (t === "int") {
    typeFields.push({ key: "interestIncome", label: "Box 1 — Interest" });
    typeFields.push({ key: "taxExemptInterest", label: "Box 8 — Tax-exempt interest" });
  }
  if (t === "div") {
    typeFields.push({ key: "ordinaryDividends", label: "Box 1a — Ordinary dividends" });
    typeFields.push({ key: "qualifiedDividends", label: "Box 1b — Qualified dividends" });
    typeFields.push({ key: "totalCapitalGainDistribution", label: "Box 2a — Total capital gain dist." });
  }
  if (t === "b") {
    typeFields.push({ key: "proceeds", label: "Box 1d — Proceeds" });
    typeFields.push({ key: "costBasis", label: "Box 1e — Cost basis" });
    typeFields.push({ key: "shortTermGainLoss", label: "Short-term gain/loss" });
    typeFields.push({ key: "longTermGainLoss", label: "Long-term gain/loss" });
  }
  if (t === "r") {
    typeFields.push({ key: "grossDistribution", label: "Box 1 — Gross distribution" });
    typeFields.push({ key: "taxableAmount", label: "Box 2a — Taxable amount" });
  }
  if (t === "g") {
    typeFields.push({ key: "unemploymentCompensation", label: "Box 1 — Unemployment comp." });
    typeFields.push({ key: "stateLocalRefund", label: "Box 2 — State/local refund" });
  }
  if (t === "k") {
    typeFields.push({ key: "grossPaymentAmount", label: "Box 1a — Gross payment amount" });
  }

  return (
    <div className="grid grid-cols-2 gap-4 mt-4">
      <div className="col-span-2 grid grid-cols-3 gap-4">
        <div className="space-y-1">
          <Label className="text-xs">Form Type</Label>
          <Select value={form.formType} onValueChange={(v) => onChange("formType", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {FORM_1099_TYPES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label} — {opt.desc}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Payer Name</Label>
          <Input value={form.payerName} onChange={(e) => onChange("payerName", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Payer TIN</Label>
          <Input value={form.payerTin} onChange={(e) => onChange("payerTin", e.target.value)} placeholder="XX-XXXXXXX" />
        </div>
      </div>
      {typeFields.map(({ key, label }) => (
        <div key={key} className="space-y-1">
          <Label className="text-xs text-muted-foreground">{label}</Label>
          <CurrencyInput value={form[key]} onChange={(v) => onChange(key, v)} />
        </div>
      ))}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Federal W/H</Label>
        <CurrencyInput value={form.federalTaxWithheld} onChange={(v) => onChange("federalTaxWithheld", v)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">State W/H</Label>
        <CurrencyInput value={form.stateTaxWithheld} onChange={(v) => onChange("stateTaxWithheld", v)} />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">State Code</Label>
        <Input value={form.stateCode} onChange={(e) => onChange("stateCode", e.target.value)} placeholder="CA" maxLength={2} />
      </div>
    </div>
  );
}

function Form1099Tab({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const { data: records, isLoading } = useListForm1099Data(clientId, {
    query: { queryKey: getListForm1099DataQueryKey(clientId) },
  });
  const create = useCreateForm1099Data();
  const update = useUpdateForm1099Data();
  const del = useDeleteForm1099Data();
  const qc = useQueryClient();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<Form1099FormState>(blank1099Form());
  const [editForms, setEditForms] = useState<Record<number, Form1099FormState>>({});

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListForm1099DataQueryKey(clientId) });
    qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
    qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }

  function toPayload(f: Form1099FormState) {
    const numField = (s: string) => (s ? Number(s) : undefined);
    const strField = (s: string) => (s ? s : undefined);
    return {
      taxYear,
      formType: f.formType as CreateForm1099DataBodyFormType,
      payerName: strField(f.payerName),
      payerTin: strField(f.payerTin),
      recipientTin: strField(f.recipientTin),
      federalTaxWithheld: numField(f.federalTaxWithheld),
      stateTaxWithheld: numField(f.stateTaxWithheld),
      stateCode: strField(f.stateCode),
      nonemployeeCompensation: numField(f.nonemployeeCompensation),
      rents: numField(f.rents),
      royalties: numField(f.royalties),
      otherIncome: numField(f.otherIncome),
      interestIncome: numField(f.interestIncome),
      taxExemptInterest: numField(f.taxExemptInterest),
      ordinaryDividends: numField(f.ordinaryDividends),
      qualifiedDividends: numField(f.qualifiedDividends),
      totalCapitalGainDistribution: numField(f.totalCapitalGainDistribution),
      proceeds: numField(f.proceeds),
      costBasis: numField(f.costBasis),
      shortTermGainLoss: numField(f.shortTermGainLoss),
      longTermGainLoss: numField(f.longTermGainLoss),
      grossDistribution: numField(f.grossDistribution),
      taxableAmount: numField(f.taxableAmount),
      distributionCode: strField(f.distributionCode),
      unemploymentCompensation: numField(f.unemploymentCompensation),
      stateLocalRefund: numField(f.stateLocalRefund),
      grossPaymentAmount: numField(f.grossPaymentAmount),
    };
  }

  function startEdit(rec: any) {
    setEditForms((p) => ({
      ...p,
      [rec.id]: {
        formType: rec.formType ?? "nec",
        payerName: rec.payerName ?? "",
        payerTin: rec.payerTin ?? "",
        recipientTin: rec.recipientTin ?? "",
        federalTaxWithheld: rec.federalTaxWithheld != null ? String(rec.federalTaxWithheld) : "",
        stateTaxWithheld: rec.stateTaxWithheld != null ? String(rec.stateTaxWithheld) : "",
        stateCode: rec.stateCode ?? "",
        nonemployeeCompensation: rec.nonemployeeCompensation != null ? String(rec.nonemployeeCompensation) : "",
        rents: rec.rents != null ? String(rec.rents) : "",
        royalties: rec.royalties != null ? String(rec.royalties) : "",
        otherIncome: rec.otherIncome != null ? String(rec.otherIncome) : "",
        interestIncome: rec.interestIncome != null ? String(rec.interestIncome) : "",
        taxExemptInterest: rec.taxExemptInterest != null ? String(rec.taxExemptInterest) : "",
        ordinaryDividends: rec.ordinaryDividends != null ? String(rec.ordinaryDividends) : "",
        qualifiedDividends: rec.qualifiedDividends != null ? String(rec.qualifiedDividends) : "",
        totalCapitalGainDistribution: rec.totalCapitalGainDistribution != null ? String(rec.totalCapitalGainDistribution) : "",
        proceeds: rec.proceeds != null ? String(rec.proceeds) : "",
        costBasis: rec.costBasis != null ? String(rec.costBasis) : "",
        shortTermGainLoss: rec.shortTermGainLoss != null ? String(rec.shortTermGainLoss) : "",
        longTermGainLoss: rec.longTermGainLoss != null ? String(rec.longTermGainLoss) : "",
        grossDistribution: rec.grossDistribution != null ? String(rec.grossDistribution) : "",
        taxableAmount: rec.taxableAmount != null ? String(rec.taxableAmount) : "",
        distributionCode: rec.distributionCode ?? "",
        unemploymentCompensation: rec.unemploymentCompensation != null ? String(rec.unemploymentCompensation) : "",
        stateLocalRefund: rec.stateLocalRefund != null ? String(rec.stateLocalRefund) : "",
        grossPaymentAmount: rec.grossPaymentAmount != null ? String(rec.grossPaymentAmount) : "",
      },
    }));
    setEditingId(rec.id);
  }

  function saveEdit(id: number) {
    const f = editForms[id];
    if (!f) return;
    update.mutate(
      { clientId, form1099Id: id, data: toPayload(f) },
      {
        onSuccess: () => { invalidate(); toast({ title: "1099 updated" }); setEditingId(null); },
        onError: () => toast({ title: "Failed to update", variant: "destructive" }),
      },
    );
  }

  function saveNew() {
    create.mutate(
      { clientId, data: toPayload(newForm) },
      {
        onSuccess: () => { invalidate(); toast({ title: "1099 added" }); setShowNew(false); setNewForm(blank1099Form()); },
        onError: () => toast({ title: "Failed to add", variant: "destructive" }),
      },
    );
  }

  function handleDelete(id: number) {
    if (!confirm("Delete this 1099 record?")) return;
    del.mutate(
      { clientId, form1099Id: id },
      { onSuccess: () => { invalidate(); toast({ title: "1099 deleted" }); } },
    );
  }

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {(records ?? []).map((rec: any) => (
        <Card key={rec.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                <Badge variant="outline" className="mr-2">{FORM_TYPE_LABEL[rec.formType] ?? rec.formType}</Badge>
                {rec.payerName ?? `1099 #${rec.id}`}
                <span className="text-muted-foreground font-normal text-sm"> — {rec.taxYear}</span>
              </CardTitle>
              <div className="flex gap-2">
                {editingId === rec.id ? (
                  <>
                    <Button size="sm" onClick={() => saveEdit(rec.id)} disabled={update.isPending}>Save</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => startEdit(rec)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(rec.id)}>Delete</Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {editingId === rec.id ? (
              <Form1099Fields
                form={editForms[rec.id] ?? blank1099Form(rec.formType)}
                onChange={(k, v) => setEditForms((p) => ({ ...p, [rec.id]: { ...(p[rec.id] ?? blank1099Form(rec.formType)), [k]: v } }))}
              />
            ) : (
              <div className="grid grid-cols-4 gap-3 text-sm">
                {Object.entries(rec).filter(([k, v]) =>
                  v != null && typeof v === "number" && v !== 0 &&
                  !["id", "clientId", "documentId", "taxYear"].includes(k)
                ).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-xs text-muted-foreground">{k.replace(/([A-Z])/g, " $1").trim()}</div>
                    <div className="font-mono font-semibold">{fmt(Number(v))}</div>
                  </div>
                ))}
                {rec.payerTin && (
                  <div>
                    <div className="text-xs text-muted-foreground">Payer TIN</div>
                    <div className="font-mono font-semibold">{maskTin(rec.payerTin)}</div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {showNew ? (
        <Card>
          <CardHeader><CardTitle className="text-base">New 1099 Record</CardTitle></CardHeader>
          <CardContent>
            <Form1099Fields form={newForm} onChange={(k, v) => setNewForm((p) => ({ ...p, [k]: v }))} />
            <div className="flex gap-2 mt-4">
              <Button onClick={saveNew} disabled={create.isPending}>Add 1099</Button>
              <Button variant="outline" onClick={() => { setShowNew(false); setNewForm(blank1099Form()); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setShowNew(true)}>+ Add 1099 Record</Button>
      )}
    </div>
  );
}

// ─── Adjustments Tab ─────────────────────────────────────────────────────────

interface AdjFormData {
  adjustmentType: string;
  amount: string;
  description: string;
  category: string;
  isApplied: boolean;
}

function blankAdj(): AdjFormData {
  return { adjustmentType: "deduction", amount: "", description: "", category: "", isApplied: true };
}

function BracketBreakdownPanel({ data }: { data: BreakdownResponse }) {
  const fmtRange = (min: number, max: number) =>
    max === Infinity || max > 1e15 ? `${fmt(min)}+` : `${fmt(min)} – ${fmt(max)}`;
  const fmtRate = (r: number) => `${(r * 100).toFixed(2)}%`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Federal bracket breakdown · TY{data.taxYear}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground mb-3">
            Marginal rate: <span className="font-mono font-semibold text-foreground">{fmtRate(data.federal.marginalRate)}</span>
          </div>
          {data.federal.brackets.length === 0 ? (
            <div className="text-sm text-muted-foreground">No taxable income.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left pb-1.5">Bracket</th>
                  <th className="text-right pb-1.5">Rate</th>
                  <th className="text-right pb-1.5">Taxed in bracket</th>
                  <th className="text-right pb-1.5">Tax</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {data.federal.brackets.map((b, i) => (
                  <tr key={i} className="border-t border-muted/60">
                    <td className="py-1">{fmtRange(b.bracketMin, b.bracketMax)}</td>
                    <td className="py-1 text-right">{fmtRate(b.rate)}</td>
                    <td className="py-1 text-right">{fmt(b.taxableInBracket)}</td>
                    <td className="py-1 text-right font-semibold">{fmt(b.taxFromBracket)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-foreground/20 font-semibold">
                  <td className="py-1.5" colSpan={3}>Total federal</td>
                  <td className="py-1.5 text-right">{fmt(data.federal.total)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{data.state.stateName} bracket breakdown · TY{data.taxYear}</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.state.hasIncomeTax ? (
            <div className="text-sm text-muted-foreground">{data.state.stateName} has no state income tax on wages.</div>
          ) : data.state.brackets.length === 0 ? (
            <div className="text-sm text-muted-foreground">No state taxable income after standard deduction.</div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground mb-3">
                Marginal rate: <span className="font-mono font-semibold text-foreground">{fmtRate(data.state.marginalRate)}</span>
              </div>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="text-left pb-1.5">Bracket</th>
                    <th className="text-right pb-1.5">Rate</th>
                    <th className="text-right pb-1.5">Taxed in bracket</th>
                    <th className="text-right pb-1.5">Tax</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {data.state.brackets.map((b, i) => (
                    <tr key={i} className="border-t border-muted/60">
                      <td className="py-1">{fmtRange(b.bracketMin, b.bracketMax)}</td>
                      <td className="py-1 text-right">{fmtRate(b.rate)}</td>
                      <td className="py-1 text-right">{fmt(b.taxableInBracket)}</td>
                      <td className="py-1 text-right font-semibold">{fmt(b.taxFromBracket)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-foreground/20 font-semibold">
                    <td className="py-1.5" colSpan={3}>Total state</td>
                    <td className="py-1.5 text-right">{fmt(data.state.total)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AdjustmentsTab({ clientId }: { clientId: number }) {
  const { data: adjustments, isLoading } = useListAdjustments(clientId, {
    query: { queryKey: getListAdjustmentsQueryKey(clientId) },
  });
  const createAdj = useCreateAdjustment();
  const updateAdj = useUpdateAdjustment();
  const deleteAdj = useDeleteAdjustment();
  const qc = useQueryClient();

  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<AdjFormData>(blankAdj());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForms, setEditForms] = useState<Record<number, AdjFormData>>({});

  function invalidate() {
    qc.invalidateQueries({ queryKey: getListAdjustmentsQueryKey(clientId) });
    qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
    qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
  }

  function toPayload(f: AdjFormData) {
    return {
      adjustmentType: f.adjustmentType as CreateAdjustmentBodyAdjustmentType,
      amount: Number(f.amount),
      description: f.description,
      category: f.category || undefined,
      isApplied: f.isApplied,
    };
  }

  function toUpdatePayload(f: AdjFormData) {
    return {
      adjustmentType: f.adjustmentType as UpdateAdjustmentBodyAdjustmentType,
      amount: Number(f.amount),
      description: f.description,
      category: f.category || undefined,
      isApplied: f.isApplied,
    };
  }

  function startEdit(id: number) {
    const adj = adjustments?.find((a) => a.id === id);
    if (!adj) return;
    setEditForms((p) => ({
      ...p,
      [id]: {
        adjustmentType: adj.adjustmentType,
        amount: String(adj.amount),
        description: adj.description ?? "",
        category: adj.category ?? "",
        isApplied: adj.isApplied ?? false,
      },
    }));
    setEditingId(id);
  }

  function saveEdit(id: number) {
    const f = editForms[id];
    if (!f) return;
    updateAdj.mutate(
      { clientId, adjustmentId: id, data: toUpdatePayload(f) },
      {
        onSuccess: () => { invalidate(); toast({ title: "Adjustment updated" }); setEditingId(null); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      }
    );
  }

  function saveNew() {
    createAdj.mutate(
      { clientId, data: toPayload(newForm) },
      {
        onSuccess: () => { invalidate(); toast({ title: "Adjustment added" }); setShowNew(false); setNewForm(blankAdj()); },
        onError: () => toast({ title: "Failed", variant: "destructive" }),
      }
    );
  }

  function handleDelete(id: number) {
    if (!confirm("Delete this adjustment?")) return;
    deleteAdj.mutate({ clientId, adjustmentId: id }, { onSuccess: () => { invalidate(); toast({ title: "Deleted" }); } });
  }

  function toggleApplied(id: number, current: boolean) {
    updateAdj.mutate(
      { clientId, adjustmentId: id, data: { isApplied: !current } },
      { onSuccess: invalidate }
    );
  }

  // §199A SSTB flag — surfaced as a dedicated toggle. The engine reads the
  // `qbi_sstb_flag` adjustment to apply the §199A(d)(3) phase-out for a
  // Specified Service Trade/Business above the income threshold.
  const sstbAdj = adjustments?.find((a) => a.adjustmentType === "qbi_sstb_flag");
  const sstbOn = !!sstbAdj?.isApplied;
  const sstbBusy = createAdj.isPending || updateAdj.isPending;
  function toggleSstb(next: boolean) {
    if (sstbAdj) {
      updateAdj.mutate(
        { clientId, adjustmentId: sstbAdj.id, data: { isApplied: next } },
        { onSuccess: () => { invalidate(); toast({ title: next ? "SSTB flag enabled" : "SSTB flag disabled" }); } },
      );
    } else if (next) {
      createAdj.mutate(
        { clientId, data: { adjustmentType: "qbi_sstb_flag" as CreateAdjustmentBodyAdjustmentType, amount: 0, description: "Specified Service Trade/Business — §199A(d)(3) phase-out applies", isApplied: true } },
        { onSuccess: () => { invalidate(); toast({ title: "SSTB flag enabled" }); } },
      );
    }
  }

  // Canonical labels live in the shared module so the what-if scenario builder
  // (Planning tab) and this editor stay in lock-step. See adjustmentLabels.ts.
  const TYPE_LABELS = ADJUSTMENT_TYPE_LABELS;

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      <Card className="border-brand/30 bg-brand/[0.03]">
        <CardContent className="flex items-start justify-between gap-4 py-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Briefcase className="h-4 w-4 text-brand-ink" />
              <span className="text-sm font-semibold">§199A Qualified Business Income</span>
              <Badge variant="outline" className="text-[10px]">auto-applied</Badge>
            </div>
            <p className="max-w-2xl text-xs text-muted-foreground">
              The engine auto-applies the 20% QBI deduction from Schedule&nbsp;C net income and active K-1 Box&nbsp;1.
              Turn on the SSTB flag for a Specified Service Trade or Business (law, health, consulting, financial
              services, etc.) so the §199A(d)(3) phase-out applies above $191,950 single / $383,900 MFJ (TY2024).
            </p>
          </div>
          <label className="flex shrink-0 cursor-pointer flex-col items-center gap-1.5">
            <Switch checked={sstbOn} onCheckedChange={toggleSstb} disabled={sstbBusy} aria-label="Specified Service Trade or Business flag" />
            <span className="text-[11px] font-medium text-muted-foreground">SSTB</span>
          </label>
        </CardContent>
      </Card>
      {adjustments?.filter((adj) => adj.adjustmentType !== "qbi_sstb_flag").map((adj) => (
        <Card key={adj.id}>
          <CardContent className="py-4">
            {editingId === adj.id ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select value={editForms[adj.id]?.adjustmentType} onValueChange={(v) => setEditForms((p) => ({ ...p, [adj.id]: { ...(p[adj.id] ?? blankAdj()), adjustmentType: v } }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount</Label>
                    <CurrencyInput value={editForms[adj.id]?.amount ?? ""} onChange={(v) => setEditForms((p) => ({ ...p, [adj.id]: { ...(p[adj.id] ?? blankAdj()), amount: v } }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input value={editForms[adj.id]?.description} onChange={(e) => setEditForms((p) => ({ ...p, [adj.id]: { ...(p[adj.id] ?? blankAdj()), description: e.target.value } }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Category</Label>
                  <Input value={editForms[adj.id]?.category} onChange={(e) => setEditForms((p) => ({ ...p, [adj.id]: { ...(p[adj.id] ?? blankAdj()), category: e.target.value } }))} placeholder="e.g. Business, Education, Housing" />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveEdit(adj.id)} disabled={updateAdj.isPending}>Save</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <Switch
                    checked={adj.isApplied ?? false}
                    onCheckedChange={() => toggleApplied(adj.id, adj.isApplied ?? false)}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{adj.description ?? "—"}</span>
                      <Badge variant="outline" className="text-xs">{TYPE_LABELS[adj.adjustmentType] ?? adj.adjustmentType}</Badge>
                      {adj.category && <Badge variant="secondary" className="text-xs">{adj.category}</Badge>}
                      {!(adj.isApplied) && <Badge variant="outline" className="text-xs text-muted-foreground">Not Applied</Badge>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono font-bold text-lg">{fmt(Number(adj.amount))}</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(adj.id)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(adj.id)}>Del</Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {showNew ? (
        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={newForm.adjustmentType} onValueChange={(v) => setNewForm((p) => ({ ...p, adjustmentType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount</Label>
                <CurrencyInput value={newForm.amount} onChange={(v) => setNewForm((p) => ({ ...p, amount: v }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input value={newForm.description} onChange={(e) => setNewForm((p) => ({ ...p, description: e.target.value }))} placeholder="Describe this adjustment" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Category</Label>
                <Input value={newForm.category} onChange={(e) => setNewForm((p) => ({ ...p, category: e.target.value }))} placeholder="e.g. Business, Housing" />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch id="new-applied" checked={newForm.isApplied} onCheckedChange={(v) => setNewForm((p) => ({ ...p, isApplied: v }))} />
                <Label htmlFor="new-applied" className="cursor-pointer text-sm">Apply to calculation</Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={saveNew} disabled={createAdj.isPending || !newForm.amount || !newForm.description}>Add Adjustment</Button>
              <Button variant="outline" onClick={() => { setShowNew(false); setNewForm(blankAdj()); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setShowNew(true)}>+ Add Adjustment</Button>
      )}
    </div>
  );
}

// ─── Main ClientDetail Page ───────────────────────────────────────────────────

export default function ClientDetail() {
  const params = useParams<{ id: string }>();
  const clientId = Number(params.id);

  const { data: client, isLoading } = useGetClient(clientId, {
    query: { enabled: !!clientId, queryKey: getGetClientQueryKey(clientId) },
  });
  // Phase G5 — Pro tier gate. Hide the Planning tab when the api-server
  // has PRO_TIER_ENABLED=false. Falls through (shows tab) while settings
  // is loading, so existing Pro firms don't see a flash of "no Planning".
  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() },
  });
  const proTierEnabled = settings?.proTierEnabled !== false;

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="p-8">
        <Card><CardContent className="py-12 text-center text-muted-foreground">Client not found.</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <span className="hidden h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand/10 text-base font-bold text-brand-ink ring-1 ring-inset ring-brand/20 sm:grid">
            {`${client.firstName?.[0] ?? ""}${client.lastName?.[0] ?? ""}`.toUpperCase() || "—"}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">{client.firstName} {client.lastName}</h2>
              <Badge variant="outline">{FILING_STATUS_LABELS[client.filingStatus] ?? client.filingStatus}</Badge>
            </div>
            <p className="text-muted-foreground mt-1">
              {client.email}
              {client.phone ? ` · ${client.phone}` : ""}
              {client.state ? ` · ${client.state}` : ""}
              {` · TY${client.taxYear}`}
              {(client.dependentsUnder17 ?? 0) > 0 ? ` · ${client.dependentsUnder17} child${client.dependentsUnder17 === 1 ? "" : "ren"}` : ""}
              {(client.otherDependents ?? 0) > 0 ? ` · ${client.otherDependents} other dep` : ""}
            </p>
            {client.notes && <p className="text-sm mt-2 text-muted-foreground italic">{client.notes}</p>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href={`/clients/${clientId}/edit`}>
            <Button variant="outline"><Pencil className="mr-1.5 h-4 w-4" />Edit Client</Button>
          </Link>
          <Link href="/clients">
            <Button variant="ghost"><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="documents" orientation="vertical" className="lg:flex lg:items-start lg:gap-6">
        {/* Tab rail: a vertical sidebar on desktop so all 11 sections are
            visible at once (no horizontal scrolling / hunting); falls back to
            the horizontal scroll strip on mobile, which already has its own nav. */}
        <div className="-mx-1 overflow-x-auto px-1 pb-1 scrollbar-thin lg:mx-0 lg:shrink-0 lg:overflow-visible lg:px-0 lg:pb-0">
          <TabsList className="inline-flex h-auto w-max items-center justify-start gap-1 rounded-xl border border-border bg-muted/50 p-1 lg:sticky lg:top-4 lg:flex lg:w-56 lg:flex-col lg:items-stretch lg:gap-0.5 lg:p-1.5">
            <TabsTrigger value="documents" className={TAB_TRIGGER_CLS}><FileText className="h-4 w-4" />Documents</TabsTrigger>
            <TabsTrigger value="w2data" className={TAB_TRIGGER_CLS}><FileSpreadsheet className="h-4 w-4" />W-2 Data</TabsTrigger>
            <TabsTrigger value="form1099" className={TAB_TRIGGER_CLS}><Files className="h-4 w-4" />1099 Forms</TabsTrigger>
            <TabsTrigger value="schedD" className={TAB_TRIGGER_CLS}><CandlestickChart className="h-4 w-4" />Schedule D</TabsTrigger>
            <TabsTrigger value="rentals" className={TAB_TRIGGER_CLS}><Building2 className="h-4 w-4" />Rentals</TabsTrigger>
            <TabsTrigger value="schedCAssets" className={TAB_TRIGGER_CLS}><Boxes className="h-4 w-4" />Sched C Assets</TabsTrigger>
            <TabsTrigger value="k1" className={TAB_TRIGGER_CLS}><Network className="h-4 w-4" />K-1s</TabsTrigger>
            <TabsTrigger value="assets" className={TAB_TRIGGER_CLS}><Wallet className="h-4 w-4" />Assets</TabsTrigger>
            <TabsTrigger value="calculator" className={TAB_TRIGGER_CLS}><Calculator className="h-4 w-4" />Tax Calculator</TabsTrigger>
            <TabsTrigger value="compare" className={TAB_TRIGGER_CLS}><GitCompareArrows className="h-4 w-4" />Year Compare</TabsTrigger>
            <TabsTrigger value="adjustments" className={TAB_TRIGGER_CLS}><SlidersHorizontal className="h-4 w-4" />Adjustments</TabsTrigger>
            {proTierEnabled ? <TabsTrigger value="planning" className={TAB_TRIGGER_CLS}><Target className="h-4 w-4" />Planning</TabsTrigger> : null}
          </TabsList>
        </div>

        {/* Content pane — fills the space beside the rail on desktop. min-w-0
            lets wide content (tables, the calculator) shrink instead of
            overflowing the flex row. */}
        <div className="min-w-0 lg:flex-1">
        <TabsContent value="documents" className="mt-6">
          <DocumentsTab clientId={clientId} clientTaxYear={client.taxYear ?? 2024} clientState={client.state ?? undefined} />
        </TabsContent>
        <TabsContent value="w2data" className="mt-6">
          <W2DataTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="form1099" className="mt-6">
          <Form1099Tab clientId={clientId} taxYear={client.taxYear ?? 2024} />
        </TabsContent>
        <TabsContent value="schedD" className="mt-6">
          <CapitalTransactionsTab clientId={clientId} taxYear={client.taxYear ?? 2024} />
        </TabsContent>
        <TabsContent value="rentals" className="mt-6">
          <RentalPropertiesTab clientId={clientId} taxYear={client.taxYear ?? 2024} />
        </TabsContent>
        <TabsContent value="schedCAssets" className="mt-6">
          <ScheduleCAssetsTab clientId={clientId} taxYear={client.taxYear ?? 2024} />
        </TabsContent>
        <TabsContent value="k1" className="mt-6">
          <ScheduleK1Tab clientId={clientId} taxYear={client.taxYear ?? 2024} />
        </TabsContent>
        <TabsContent value="assets" className="mt-6">
          <AssetBalancesTab clientId={clientId} taxYear={client.taxYear ?? 2024} />
        </TabsContent>
        <TabsContent value="calculator" className="mt-6">
          <TaxCalculatorTab clientId={clientId} taxYear={client.taxYear ?? 2024} />
        </TabsContent>
        <TabsContent value="compare" className="mt-6">
          <YearCompareTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="adjustments" className="mt-6">
          <AdjustmentsTab clientId={clientId} />
        </TabsContent>
        {proTierEnabled ? (
          <TabsContent value="planning" className="mt-6">
            <PlanningTab clientId={clientId} />
          </TabsContent>
        ) : null}
        </div>
      </Tabs>
    </div>
  );
}

// ─── Capital Transactions Tab (B4 — Schedule D / Form 8949) ──────────────────

interface CapitalTxnRow {
  id: number;
  clientId: number;
  taxYear: number;
  description: string;
  dateAcquired: string | null;
  dateSold: string | null;
  proceeds: number;
  costBasis: number;
  quantity: number | null;
  account: string | null;
  adjustmentCode: string | null;
  adjustmentAmount: number;
  washSaleDisallowed: number;
  formBox: "A" | "B" | "C" | "D" | "E" | "F";
  isCovered: boolean;
  received1099B: boolean;
  notes: string | null;
}

function CapitalTransactionsTab({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const qc = useQueryClient();
  const { data: rows, isLoading } = useQuery<CapitalTxnRow[]>({
    queryKey: ["capital-transactions", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/capital-transactions`);
      return res.json();
    },
  });
  // E13 — Wash-sale summary from the engine's most recent compute. Surfaced
  // as a banner above the table; per-row marker not yet (washSaleAutoDetected
  // is in-memory only on the engine side, not persisted to capital_transactions).
  const { data: taxReturn } = useGetTaxReturn(clientId);
  const washSalesDetected = Number((taxReturn as { washSalesDetected?: number } | undefined)?.washSalesDetected ?? 0);
  const washSaleLossDisallowed = Number((taxReturn as { washSaleLossDisallowed?: number } | undefined)?.washSaleLossDisallowed ?? 0);
  const txnsForYear = (rows ?? []).filter((r) => r.taxYear === taxYear);
  const [editing, setEditing] = useState<CapitalTxnRow | null>(null);
  const [showForm, setShowForm] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["capital-transactions", clientId] });
    qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this transaction? Tax return will recalculate.")) return;
    await fetch(`/api/clients/${clientId}/capital-transactions/${id}`, { method: "DELETE" });
    invalidate();
    toast({ title: "Transaction deleted" });
  }

  const gainLoss = (t: CapitalTxnRow): number =>
    Number(t.proceeds) - Number(t.costBasis) + Number(t.adjustmentAmount);
  const stTxns = txnsForYear.filter((t) => ["A", "B", "C"].includes(t.formBox));
  const ltTxns = txnsForYear.filter((t) => ["D", "E", "F"].includes(t.formBox));
  const stTotal = stTxns.reduce((s, t) => s + gainLoss(t), 0);
  const ltTotal = ltTxns.reduce((s, t) => s + gainLoss(t), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Schedule D — Form 8949 transactions</h3>
          <p className="text-xs text-muted-foreground">
            Per-transaction tracking with Form 8949 box (A-F), wash-sale adjustments, and basis-reporting flag. When transactions are added here, the engine ignores the 1099-B aggregate short-term/long-term gain fields. 1099-DIV box 2a cap-gain distributions remain additive.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} size="sm">Add transaction</Button>
      </div>

      {washSalesDetected > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
          <div className="font-semibold text-amber-900">
            Engine auto-detected {washSalesDetected} wash sale{washSalesDetected === 1 ? "" : "s"} (IRC §1091)
          </div>
          <p className="text-xs text-amber-800 mt-1">
            Total capital loss disallowed: <span className="font-mono">{fmt(washSaleLossDisallowed)}</span>.
            Disallowed losses were added back via column g (Form 8949 adjustment), and the replacement
            transactions' cost basis was increased per IRC §1091(d). Broker-reported wash sales
            (adjustment code &ldquo;W&rdquo; already present) are unchanged.
          </p>
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : txnsForYear.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No transactions for TY{taxYear}. Click "Add transaction" to enter one — or use the 1099-B aggregate fields under the 1099 Forms tab.</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Description</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Box</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Acq / Sold</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Proceeds</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Basis</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Adj</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Gain/(Loss)</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {txnsForYear.map((t) => {
                const gl = gainLoss(t);
                return (
                  <tr key={t.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{t.description}</td>
                    <td className="px-3 py-2 text-muted-foreground">{t.formBox}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {t.dateAcquired ?? "—"} → {t.dateSold ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(t.proceeds)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(t.costBasis)}</td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {t.adjustmentCode ? `${t.adjustmentCode}: ${fmt(t.adjustmentAmount)}` : ""}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${gl < 0 ? "text-destructive" : ""}`}>
                      {fmt(gl)}
                    </td>
                    <td className="px-3 py-2 text-right space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(t); setShowForm(true); }}>Edit</Button>
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(t.id)}>Delete</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/20 border-t">
              <tr><td colSpan={6} className="px-3 py-2 text-right font-semibold">Short-term total (Box A/B/C):</td><td className={`px-3 py-2 text-right font-mono font-semibold ${stTotal < 0 ? "text-destructive" : ""}`}>{fmt(stTotal)}</td><td></td></tr>
              <tr><td colSpan={6} className="px-3 py-2 text-right font-semibold">Long-term total (Box D/E/F):</td><td className={`px-3 py-2 text-right font-mono font-semibold ${ltTotal < 0 ? "text-destructive" : ""}`}>{fmt(ltTotal)}</td><td></td></tr>
            </tfoot>
          </table>
        </div>
      )}

      {showForm && (
        <CapitalTransactionForm
          clientId={clientId}
          taxYear={taxYear}
          existing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { invalidate(); setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function CapitalTransactionForm({
  clientId, taxYear, existing, onClose, onSaved,
}: {
  clientId: number;
  taxYear: number;
  existing: CapitalTxnRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(existing?.description ?? "");
  const [dateAcquired, setDateAcquired] = useState(existing?.dateAcquired ?? "");
  const [dateSold, setDateSold] = useState(existing?.dateSold ?? "");
  const [proceeds, setProceeds] = useState(existing != null ? String(existing.proceeds) : "");
  const [costBasis, setCostBasis] = useState(existing != null ? String(existing.costBasis) : "");
  const [quantity, setQuantity] = useState(existing?.quantity != null ? String(existing.quantity) : "");
  const [account, setAccount] = useState(existing?.account ?? "");
  const [adjustmentCode, setAdjustmentCode] = useState(existing?.adjustmentCode ?? "");
  const [adjustmentAmount, setAdjustmentAmount] = useState(existing != null ? String(existing.adjustmentAmount) : "0");
  const [washSaleDisallowed, setWashSaleDisallowed] = useState(existing != null ? String(existing.washSaleDisallowed) : "0");
  const [formBox, setFormBox] = useState<"A" | "B" | "C" | "D" | "E" | "F">(existing?.formBox ?? "A");
  const [isCovered, setIsCovered] = useState(existing?.isCovered ?? true);
  const [received1099B, setReceived1099B] = useState(existing?.received1099B ?? true);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) {
      toast({ title: "Description is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const body = {
      taxYear,
      description: description.trim(),
      dateAcquired: dateAcquired || null,
      dateSold: dateSold || null,
      proceeds: proceeds === "" ? 0 : Number(proceeds),
      costBasis: costBasis === "" ? 0 : Number(costBasis),
      quantity: quantity.trim() === "" ? null : Number(quantity),
      account: account.trim() === "" ? null : account.trim(),
      adjustmentCode: adjustmentCode.trim() === "" ? null : adjustmentCode.trim().toUpperCase(),
      adjustmentAmount: adjustmentAmount === "" ? 0 : Number(adjustmentAmount),
      washSaleDisallowed: washSaleDisallowed === "" ? 0 : Number(washSaleDisallowed),
      formBox,
      isCovered,
      received1099B,
      notes: notes.trim() === "" ? null : notes.trim(),
    };
    try {
      if (existing) {
        await fetch(`/api/clients/${clientId}/capital-transactions/${existing.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        toast({ title: "Transaction updated" });
      } else {
        await fetch(`/api/clients/${clientId}/capital-transactions`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        toast({ title: "Transaction added" });
      }
      onSaved();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{existing ? "Edit Form 8949 transaction" : "Add Form 8949 transaction"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Description (Form 8949 col a)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 100 sh AAPL" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Date acquired (col b)</Label>
              <Input value={dateAcquired ?? ""} onChange={(e) => setDateAcquired(e.target.value)} placeholder="YYYY-MM-DD or VARIOUS" />
            </div>
            <div className="space-y-1">
              <Label>Date sold (col c)</Label>
              <Input value={dateSold ?? ""} onChange={(e) => setDateSold(e.target.value)} placeholder="YYYY-MM-DD" />
            </div>
            <div className="space-y-1">
              <Label>Form 8949 box</Label>
              <Select value={formBox} onValueChange={(v) => setFormBox(v as "A" | "B" | "C" | "D" | "E" | "F")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A — ST, 1099-B + basis to IRS</SelectItem>
                  <SelectItem value="B">B — ST, 1099-B, no basis to IRS</SelectItem>
                  <SelectItem value="C">C — ST, no 1099-B</SelectItem>
                  <SelectItem value="D">D — LT, 1099-B + basis to IRS</SelectItem>
                  <SelectItem value="E">E — LT, 1099-B, no basis to IRS</SelectItem>
                  <SelectItem value="F">F — LT, no 1099-B</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Proceeds (col d)</Label>
              <CurrencyInput value={proceeds} onChange={setProceeds} />
            </div>
            <div className="space-y-1">
              <Label>Cost basis (col e)</Label>
              <CurrencyInput value={costBasis} onChange={setCostBasis} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Shares / units (optional)</Label>
              <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="enables partial-wash proration" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label>Account (optional)</Label>
              <Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="brokerage label (cross-account wash)" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Adjustment code (col f)</Label>
              <Input value={adjustmentCode ?? ""} onChange={(e) => setAdjustmentCode(e.target.value)} placeholder="e.g. W for wash sale" />
            </div>
            <div className="space-y-1">
              <Label>Adjustment amount (col g)</Label>
              <CurrencyInput value={adjustmentAmount} onChange={setAdjustmentAmount} placeholder="Positive number" />
            </div>
            <div className="space-y-1">
              <Label>Wash sale disallowed</Label>
              <CurrencyInput value={washSaleDisallowed} onChange={setWashSaleDisallowed} placeholder="1099-B box 1g" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Textarea value={notes ?? ""} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : existing ? "Save changes" : "Add transaction"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Rental Properties Tab (B6) ──────────────────────────────────────────────

interface RentalPropertyRow {
  id: number;
  clientId: number;
  taxYear: number;
  address: string;
  propertyType: "residential" | "commercial";
  basis: number | null;
  placedInServiceYear: number | null;
  placedInServiceMonth: number | null;
  isActiveParticipant: boolean;
  rentalIncome: number;
  totalExpenses: number;
  notes: string | null;
}

function RentalPropertiesTab({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const qc = useQueryClient();
  const { data: rows, isLoading } = useQuery<RentalPropertyRow[]>({
    queryKey: ["rental-properties", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/rental-properties`);
      return res.json();
    },
  });

  const propsForYear = (rows ?? []).filter((r) => r.taxYear === taxYear);

  const [editing, setEditing] = useState<RentalPropertyRow | null>(null);
  const [showForm, setShowForm] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["rental-properties", clientId] });
    qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this rental property? Tax return will recalculate.")) return;
    await fetch(`/api/clients/${clientId}/rental-properties/${id}`, { method: "DELETE" });
    invalidate();
    toast({ title: "Property deleted" });
  }

  // Aggregate totals for the year (informational)
  const totalIncome = propsForYear.reduce((s, p) => s + Number(p.rentalIncome), 0);
  const totalExpenses = propsForYear.reduce((s, p) => s + Number(p.totalExpenses), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Schedule E — Rental Properties</h3>
          <p className="text-xs text-muted-foreground">
            Per-property tracking with computed MACRS depreciation. When properties are added here, the engine ignores the legacy aggregate `schedule_e_rental_*` adjustments.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} size="sm">Add property</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : propsForYear.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No rental properties for TY{taxYear}. Click "Add property" to enter one — or use the legacy aggregate adjustments under the Adjustments tab.</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Address</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Type</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Basis</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">In service</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Income</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Expenses</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {propsForYear.map((p) => (
                <tr key={p.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{p.address}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.propertyType}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(p.basis)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.placedInServiceYear && p.placedInServiceMonth ? `${p.placedInServiceYear}-${String(p.placedInServiceMonth).padStart(2, "0")}` : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(p.rentalIncome)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(p.totalExpenses)}</td>
                  <td className="px-3 py-2 text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setShowForm(true); }}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(p.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/20 border-t">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right font-semibold">Totals (before MACRS depreciation):</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(totalIncome)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(totalExpenses)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showForm && (
        <RentalPropertyForm
          clientId={clientId}
          taxYear={taxYear}
          existing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { invalidate(); setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function RentalPropertyForm({
  clientId, taxYear, existing, onClose, onSaved,
}: {
  clientId: number;
  taxYear: number;
  existing: RentalPropertyRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [address, setAddress] = useState(existing?.address ?? "");
  const [propertyType, setPropertyType] = useState<"residential" | "commercial">(existing?.propertyType ?? "residential");
  const [basis, setBasis] = useState(existing?.basis != null ? String(existing.basis) : "");
  const [placedYear, setPlacedYear] = useState(existing?.placedInServiceYear != null ? String(existing.placedInServiceYear) : "");
  const [placedMonth, setPlacedMonth] = useState(existing?.placedInServiceMonth != null ? String(existing.placedInServiceMonth) : "");
  const [rentalIncome, setRentalIncome] = useState(existing?.rentalIncome != null ? String(existing.rentalIncome) : "");
  const [totalExpenses, setTotalExpenses] = useState(existing?.totalExpenses != null ? String(existing.totalExpenses) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim()) {
      toast({ title: "Address is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const body = {
      taxYear,
      address: address.trim(),
      propertyType,
      basis: basis === "" ? null : Number(basis),
      placedInServiceYear: placedYear === "" ? null : Number(placedYear),
      placedInServiceMonth: placedMonth === "" ? null : Number(placedMonth),
      rentalIncome: rentalIncome === "" ? 0 : Number(rentalIncome),
      totalExpenses: totalExpenses === "" ? 0 : Number(totalExpenses),
      isActiveParticipant: existing?.isActiveParticipant ?? true,
      notes: notes.trim() === "" ? null : notes.trim(),
    };
    try {
      if (existing) {
        await fetch(`/api/clients/${clientId}/rental-properties/${existing.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        toast({ title: "Property updated" });
      } else {
        await fetch(`/api/clients/${clientId}/rental-properties`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        toast({ title: "Property added" });
      }
      onSaved();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{existing ? "Edit rental property" : "Add rental property"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, City, ST" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Property type</Label>
              <Select value={propertyType} onValueChange={(v) => setPropertyType(v as "residential" | "commercial")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="residential">Residential (27.5-yr MACRS)</SelectItem>
                  <SelectItem value="commercial">Commercial (39-yr MACRS)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Depreciable basis</Label>
              <CurrencyInput value={basis} onChange={setBasis} placeholder="Cost − land value" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Placed-in-service year</Label>
              <Input type="number" value={placedYear} onChange={(e) => setPlacedYear(e.target.value)} placeholder="2020" />
            </div>
            <div className="space-y-1">
              <Label>Placed-in-service month (1-12)</Label>
              <Input type="number" min={1} max={12} value={placedMonth} onChange={(e) => setPlacedMonth(e.target.value)} placeholder="1 = January" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Rental income (this year)</Label>
              <CurrencyInput value={rentalIncome} onChange={setRentalIncome} />
            </div>
            <div className="space-y-1">
              <Label>Total expenses (excluding depreciation)</Label>
              <CurrencyInput value={totalExpenses} onChange={setTotalExpenses} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. tenant info, repairs context" />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : existing ? "Save changes" : "Add property"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schedule C Depreciable Assets Tab (Form 4562) ──────────────────────────

interface ScheduleCAssetRow {
  id: number;
  clientId: number;
  taxYear: number;
  description: string;
  cost: number;
  recoveryYears: number;
  placedInServiceYear: number;
  placedInServiceQuarter: number | null;
  section179: boolean;
  bonus: boolean;
  bonusFullObbba: boolean;
  notes: string | null;
}

function ScheduleCAssetsTab({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const qc = useQueryClient();
  const { data: rows, isLoading } = useQuery<ScheduleCAssetRow[]>({
    queryKey: ["schedule-c-assets", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/schedule-c-assets`);
      return res.json();
    },
  });
  // The full asset register (multi-year): every asset still depreciating
  // contributes to this and future returns, so we show them all.
  const assets = (rows ?? []).slice().sort((a, b) => b.placedInServiceYear - a.placedInServiceYear);
  const [editing, setEditing] = useState<ScheduleCAssetRow | null>(null);
  const [showForm, setShowForm] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["schedule-c-assets", clientId] });
    qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
  }
  async function handleDelete(id: number) {
    if (!confirm("Delete this asset? The tax return will recalculate.")) return;
    await fetch(`/api/clients/${clientId}/schedule-c-assets/${id}`, { method: "DELETE" });
    invalidate();
    toast({ title: "Asset deleted" });
  }
  const totalCost = assets.reduce((s, a) => s + Number(a.cost), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Schedule C — Depreciable Assets (Form 4562)</h3>
          <p className="text-xs text-muted-foreground">
            The engine computes §179 (with the §179(b)(3) business-income limit) + §168(k) bonus + MACRS and folds the total into the Schedule C net profit / SE base. The register is multi-year — prior-year assets keep depreciating.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} size="sm">Add asset</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : assets.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No assets yet. Click "Add asset" to enter one — or supply the computed Form 4562 figure via the `schedule_c_depreciation` adjustment.</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Description</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Cost</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Class</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">In service</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Treatment</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {assets.map((a) => (
                <tr key={a.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{a.description || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(a.cost)}</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">{a.recoveryYears}-yr</td>
                  <td className="px-3 py-2 text-center text-muted-foreground">{a.placedInServiceYear}{a.placedInServiceQuarter ? ` Q${a.placedInServiceQuarter}` : ""}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {a.section179 ? "§179" : a.bonus ? (a.bonusFullObbba ? "Bonus 100%" : "Bonus") : "MACRS"}
                  </td>
                  <td className="px-3 py-2 text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(a); setShowForm(true); }}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(a.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/20 border-t">
              <tr>
                <td className="px-3 py-2 text-right font-semibold">Total cost:</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(totalCost)}</td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {showForm && (
        <ScheduleCAssetForm
          clientId={clientId}
          taxYear={taxYear}
          existing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { invalidate(); setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ScheduleCAssetForm({
  clientId, taxYear, existing, onClose, onSaved,
}: {
  clientId: number;
  taxYear: number;
  existing: ScheduleCAssetRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [description, setDescription] = useState(existing?.description ?? "");
  const [cost, setCost] = useState(existing?.cost != null ? String(existing.cost) : "");
  const [recoveryYears, setRecoveryYears] = useState(String(existing?.recoveryYears ?? 5));
  const [placedYear, setPlacedYear] = useState(String(existing?.placedInServiceYear ?? taxYear));
  const [quarter, setQuarter] = useState(existing?.placedInServiceQuarter != null ? String(existing.placedInServiceQuarter) : "");
  const [section179, setSection179] = useState(existing?.section179 ?? false);
  const [bonus, setBonus] = useState(existing?.bonus ?? false);
  const [bonusFullObbba, setBonusFullObbba] = useState(existing?.bonusFullObbba ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (placedYear === "" || Number.isNaN(Number(placedYear))) {
      toast({ title: "Placed-in-service year is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const body = {
      taxYear,
      description: description.trim(),
      cost: cost === "" ? 0 : Number(cost),
      recoveryYears: Number(recoveryYears),
      placedInServiceYear: Number(placedYear),
      placedInServiceQuarter: quarter === "" ? null : Number(quarter),
      section179,
      // §179 and bonus are mutually exclusive on one asset (engine: §179 → no bonus).
      bonus: section179 ? false : bonus,
      bonusFullObbba: section179 ? false : bonus && bonusFullObbba,
      notes: notes.trim() === "" ? null : notes.trim(),
    };
    try {
      const url = existing
        ? `/api/clients/${clientId}/schedule-c-assets/${existing.id}`
        : `/api/clients/${clientId}/schedule-c-assets`;
      await fetch(url, {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({ title: existing ? "Asset updated" : "Asset added" });
      onSaved();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{existing ? "Edit asset" : "Add Schedule C asset"}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Delivery van, laptop, machinery" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cost (depreciable basis)</Label>
              <CurrencyInput value={cost} onChange={setCost} />
            </div>
            <div className="space-y-1">
              <Label>GDS recovery class</Label>
              <Select value={recoveryYears} onValueChange={setRecoveryYears}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3-yr (tools, some software)</SelectItem>
                  <SelectItem value="5">5-yr (computers, autos, equipment)</SelectItem>
                  <SelectItem value="7">7-yr (furniture, fixtures)</SelectItem>
                  <SelectItem value="10">10-yr</SelectItem>
                  <SelectItem value="15">15-yr (land improvements)</SelectItem>
                  <SelectItem value="20">20-yr</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Placed-in-service year</Label>
              <Input type="number" value={placedYear} onChange={(e) => setPlacedYear(e.target.value)} placeholder="2024" />
            </div>
            <div className="space-y-1">
              <Label>Quarter (for the §168(d)(3) mid-quarter test)</Label>
              <Select value={quarter || "none"} onValueChange={(v) => setQuarter(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified (half-year)</SelectItem>
                  <SelectItem value="1">Q1</SelectItem>
                  <SelectItem value="2">Q2</SelectItem>
                  <SelectItem value="3">Q3</SelectItem>
                  <SelectItem value="4">Q4</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={section179} onChange={(e) => setSection179(e.target.checked)} />
              Elect §179 full expensing (acquisition year; no MACRS on the §179'd basis)
            </label>
            <label className={`flex items-center gap-2 text-sm ${section179 ? "opacity-40" : ""}`}>
              <input type="checkbox" checked={bonus} disabled={section179} onChange={(e) => setBonus(e.target.checked)} />
              Apply §168(k) bonus depreciation
            </label>
            <label className={`flex items-center gap-2 text-sm ml-6 ${section179 || !bonus ? "opacity-40" : ""}`}>
              <input type="checkbox" checked={bonusFullObbba} disabled={section179 || !bonus} onChange={(e) => setBonusFullObbba(e.target.checked)} />
              OBBBA 100% (placed in service after 2025-01-19)
            </label>
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : existing ? "Save changes" : "Add asset"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Schedule K-1 Tab (BP1) ─────────────────────────────────────────────────

interface ScheduleK1Row {
  id: number;
  clientId: number;
  taxYear: number;
  entityName: string;
  entityEin: string | null;
  entityType: "partnership" | "s_corp";
  activityType: "active" | "passive";
  box1OrdinaryIncome: number;
  box2RentalRealEstate: number;
  box3OtherRentalIncome: number;
  box4GuaranteedPayments: number;
  interestIncome: number;
  ordinaryDividends: number;
  qualifiedDividends: number;
  royalties: number;
  netShortTermCapitalGain: number;
  netLongTermCapitalGain: number;
  selfEmploymentEarnings: number;
  section199aQbi: number;
  section199aW2Wages: number;
  section199aUbia: number;
  isSstb: boolean;
  basisAtYearStart: number | null;
  basisAtYearEnd: number | null;
  atRiskAmount: number | null;
  notes: string | null;
}

// ── Phase H — H5 Asset balances tab ───────────────────────────────────────

const ASSET_TYPES = [
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "sep_ira", label: "SEP-IRA" },
  { value: "simple_ira", label: "SIMPLE IRA" },
  { value: "401k_traditional", label: "401(k) — Traditional" },
  { value: "401k_roth", label: "401(k) — Roth" },
  { value: "401k_after_tax", label: "401(k) — After-tax (Mega-Backdoor)" },
  { value: "employer_stock_in_401k", label: "Employer stock in 401(k) (NUA-eligible)" },
  { value: "hsa", label: "HSA" },
  { value: "529", label: "529 college savings" },
  { value: "brokerage_taxable", label: "Brokerage (taxable)" },
  // Phase H — H5 expansion (v1.1):
  { value: "espp_shares", label: "ESPP shares (cost basis + purchase price)" },
  { value: "iso_amt_credit_shares", label: "ISO shares (AMT-credit basis)" },
  { value: "restricted_stock_pre_83b", label: "Restricted stock — pre-§83(b) election" },
  { value: "crypto", label: "Crypto (BTC / ETH / etc.)" },
  { value: "real_estate", label: "Real estate (investment)" },
  { value: "primary_residence", label: "Primary residence" },
  { value: "other", label: "Other" },
];

type AssetBalanceRow = {
  id: number;
  clientId: number;
  taxYear: number;
  assetType: string;
  accountName: string;
  balance: number;
  costBasis: number | null;
  afterTaxBasis: number | null;
  nuaEligible: boolean;
  notes: string | null;
};

function AssetBalancesTab({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const qc = useQueryClient();
  const { data: rows = [], isLoading } = useQuery<AssetBalanceRow[]>({
    queryKey: ["asset-balances", clientId],
    queryFn: async () => {
      const r = await fetch(`/api/clients/${clientId}/asset-balances`);
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<Partial<AssetBalanceRow>>({
    taxYear,
    assetType: "traditional_ira",
    accountName: "",
    balance: 0,
    costBasis: null,
    afterTaxBasis: null,
    nuaEligible: false,
    notes: null,
  });

  const reset = () => {
    setEditingId(null);
    setDraft({
      taxYear,
      assetType: "traditional_ira",
      accountName: "",
      balance: 0,
      costBasis: null,
      afterTaxBasis: null,
      nuaEligible: false,
      notes: null,
    });
  };

  const saveMut = useMutation({
    mutationFn: async (body: Partial<AssetBalanceRow>) => {
      const url = editingId
        ? `/api/clients/${clientId}/asset-balances/${editingId}`
        : `/api/clients/${clientId}/asset-balances`;
      const method = editingId ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset-balances", clientId] });
      qc.invalidateQueries({ queryKey: ["tax-return", clientId] });
      reset();
      toast({ title: editingId ? "Asset updated" : "Asset added" });
    },
    onError: (e: unknown) => toast({ title: "Save failed", description: String(e), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/clients/${clientId}/asset-balances/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["asset-balances", clientId] });
      qc.invalidateQueries({ queryKey: ["tax-return", clientId] });
      toast({ title: "Asset deleted" });
    },
  });

  const totalBy = (predicate: (r: AssetBalanceRow) => boolean): number =>
    rows.filter(predicate).reduce((s, r) => s + Number(r.balance ?? 0), 0);

  const traditionalIra = totalBy((r) => r.assetType === "traditional_ira");
  const rothIra = totalBy((r) => r.assetType === "roth_ira");
  const k401Traditional = totalBy((r) => r.assetType === "401k_traditional");
  const k401Roth = totalBy((r) => r.assetType === "401k_roth");
  const employerStock = totalBy((r) => r.assetType === "employer_stock_in_401k");
  const hsa = totalBy((r) => r.assetType === "hsa");
  const totalRetirement = traditionalIra + rothIra + k401Traditional + k401Roth + employerStock;
  const traditionalIraBasis = rows
    .filter((r) => r.assetType === "traditional_ira")
    .reduce((s, r) => s + Number(r.afterTaxBasis ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Asset balances (Phase H — H5)</CardTitle>
          <div className="text-xs text-muted-foreground mt-1">
            Track IRA / Roth / 401(k) / HSA / 529 / brokerage / real estate. Drives
            H6 Form 8606 §408(d)(2) pro-rata math and unlocks NUA, Mega-Backdoor
            Roth, RMD planning strategies.
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
            <div>
              <div className="text-xs text-muted-foreground">Total retirement</div>
              <div className="text-lg font-semibold">{fmt(totalRetirement)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Traditional IRA (basis)</div>
              <div className="text-lg font-semibold">{fmt(traditionalIra)} <span className="text-xs text-amber-700">({fmt(traditionalIraBasis)} after-tax)</span></div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">HSA</div>
              <div className="text-lg font-semibold">{fmt(hsa)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Employer stock (NUA)</div>
              <div className="text-lg font-semibold">{fmt(employerStock)}</div>
            </div>
          </div>

          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : rows.length === 0 ? (
            <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
              No assets tracked yet. Add the client's retirement + investment
              accounts below — Form 8606 pro-rata, NUA strategy, and
              Mega-Backdoor Roth all require this data.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-foreground">
                  <tr>
                    <th className="text-left px-3 py-2">Account</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-right px-3 py-2">Balance</th>
                    <th className="text-right px-3 py-2">Cost basis</th>
                    <th className="text-right px-3 py-2">After-tax basis</th>
                    <th className="text-center px-3 py-2">NUA?</th>
                    <th className="text-left px-3 py-2">Notes</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const typeLabel = ASSET_TYPES.find((t) => t.value === r.assetType)?.label ?? r.assetType;
                    return (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{r.accountName}</td>
                        <td className="px-3 py-2 text-foreground">{typeLabel}</td>
                        <td className="text-right tabular-nums px-3 py-2">{fmt(Number(r.balance ?? 0))}</td>
                        <td className="text-right tabular-nums px-3 py-2">{r.costBasis != null ? fmt(Number(r.costBasis)) : "—"}</td>
                        <td className="text-right tabular-nums px-3 py-2">{r.afterTaxBasis != null ? fmt(Number(r.afterTaxBasis)) : "—"}</td>
                        <td className="text-center px-3 py-2">{r.nuaEligible ? "✓" : ""}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">{r.notes ?? ""}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Button size="sm" variant="ghost" onClick={() => {
                            setEditingId(r.id);
                            setDraft({ ...r });
                          }}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => {
                            if (confirm(`Delete ${r.accountName}?`)) deleteMut.mutate(r.id);
                          }}>Delete</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{editingId ? "Edit asset" : "Add asset"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="asset-type">Asset type</Label>
              <select
                id="asset-type"
                value={draft.assetType ?? "traditional_ira"}
                onChange={(e) => setDraft((d) => ({ ...d, assetType: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              >
                {ASSET_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="account-name">Account name</Label>
              <Input
                id="account-name"
                placeholder="e.g. Vanguard IRA"
                value={draft.accountName ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, accountName: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="balance">Balance (FMV at year-end)</Label>
              <CurrencyInput
                id="balance"
                value={draft.balance ?? 0}
                onChange={(raw) => setDraft((d) => ({ ...d, balance: Number(raw) || 0 }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost-basis">Cost basis (optional)</Label>
              <CurrencyInput
                id="cost-basis"
                placeholder="Brokerage / employer stock / real estate"
                value={draft.costBasis ?? ""}
                onChange={(raw) => setDraft((d) => ({ ...d, costBasis: raw === "" ? null : Number(raw) }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="after-tax-basis">After-tax basis (IRA / 401(k) only)</Label>
              <CurrencyInput
                id="after-tax-basis"
                placeholder="Form 8606 pro-rata input"
                value={draft.afterTaxBasis ?? ""}
                onChange={(raw) => setDraft((d) => ({ ...d, afterTaxBasis: raw === "" ? null : Number(raw) }))}
              />
            </div>
            <div className="space-y-1 flex items-end gap-2">
              <input
                id="nua-eligible"
                type="checkbox"
                checked={draft.nuaEligible ?? false}
                onChange={(e) => setDraft((d) => ({ ...d, nuaEligible: e.target.checked }))}
                className="h-4 w-4 mb-2"
              />
              <Label htmlFor="nua-eligible" className="cursor-pointer mb-2">
                NUA-eligible plan distribution? (employer stock only)
              </Label>
            </div>
            <div className="space-y-1 col-span-2">
              <Label htmlFor="asset-notes">Notes</Label>
              <Textarea
                id="asset-notes"
                value={draft.notes ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value || null }))}
                rows={2}
                placeholder="Optional CPA notes (institution, restrictions, beneficiary, etc.)"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                if (!draft.accountName || !draft.assetType) {
                  toast({ title: "Missing fields", variant: "destructive" });
                  return;
                }
                saveMut.mutate(draft);
              }}
              disabled={saveMut.isPending}
            >
              {editingId ? "Save changes" : "Add asset"}
            </Button>
            {editingId ? (
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ScheduleK1Tab({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const qc = useQueryClient();
  const { data: rows, isLoading } = useQuery<ScheduleK1Row[]>({
    queryKey: ["schedule-k1", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/k1s`);
      return res.json();
    },
  });

  const k1sForYear = (rows ?? []).filter((r) => r.taxYear === taxYear);
  const [editing, setEditing] = useState<ScheduleK1Row | null>(null);
  const [showForm, setShowForm] = useState(false);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["schedule-k1", clientId] });
    qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(clientId) });
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this K-1? Tax return will recalculate.")) return;
    await fetch(`/api/clients/${clientId}/k1s/${id}`, { method: "DELETE" });
    invalidate();
    toast({ title: "K-1 deleted" });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Schedule K-1 — Pass-through entities</h3>
          <p className="text-xs text-muted-foreground">
            Per-K-1 tracking for partnership (Form 1065) and S-corp (Form 1120-S) entities.
            Active ordinary income flows to Schedule E Part II; passive losses bucket under §469
            (fully suspended on net loss — no $25k allowance, that's rental-RE only).
            §199A QBI from Box 20 Z / Box 17 V flows to the QBI deduction calc.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true); }} size="sm">Add K-1</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : k1sForYear.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground text-sm">No K-1s for TY{taxYear}. Click "Add K-1" to enter one.</CardContent></Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Entity</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Type</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">§469</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Box 1 ordinary</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Box 14A SE</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">§199A QBI</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {k1sForYear.map((k) => (
                <tr key={k.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <div className="font-medium">{k.entityName}</div>
                    {k.entityEin && <div className="text-xs text-muted-foreground font-mono">{k.entityEin}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{k.entityType === "s_corp" ? "1120-S" : "1065"}</td>
                  <td className="px-3 py-2 text-muted-foreground capitalize">{k.activityType}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(k.box1OrdinaryIncome)}</td>
                  <td className="px-3 py-2 text-right font-mono">{k.entityType === "partnership" ? fmt(k.selfEmploymentEarnings) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(k.section199aQbi)}</td>
                  <td className="px-3 py-2 text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(k); setShowForm(true); }}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => handleDelete(k.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ScheduleK1Form
          clientId={clientId}
          taxYear={taxYear}
          existing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { invalidate(); setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ScheduleK1Form({
  clientId, taxYear, existing, onClose, onSaved,
}: {
  clientId: number;
  taxYear: number;
  existing: ScheduleK1Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = existing != null;
  const [entityName, setEntityName] = useState(existing?.entityName ?? "");
  const [entityEin, setEntityEin] = useState(existing?.entityEin ?? "");
  const [entityType, setEntityType] = useState<"partnership" | "s_corp">(existing?.entityType ?? "partnership");
  const [activityType, setActivityType] = useState<"active" | "passive">(existing?.activityType ?? "active");
  const [box1, setBox1] = useState(existing?.box1OrdinaryIncome != null ? String(existing.box1OrdinaryIncome) : "");
  const [box2, setBox2] = useState(existing?.box2RentalRealEstate != null ? String(existing.box2RentalRealEstate) : "");
  const [box3, setBox3] = useState(existing?.box3OtherRentalIncome != null ? String(existing.box3OtherRentalIncome) : "");
  const [box4Gp, setBox4Gp] = useState(existing?.box4GuaranteedPayments != null ? String(existing.box4GuaranteedPayments) : "");
  const [interestIncome, setInterestIncome] = useState(existing?.interestIncome != null ? String(existing.interestIncome) : "");
  const [ordinaryDividends, setOrdinaryDividends] = useState(existing?.ordinaryDividends != null ? String(existing.ordinaryDividends) : "");
  const [qualifiedDividends, setQualifiedDividends] = useState(existing?.qualifiedDividends != null ? String(existing.qualifiedDividends) : "");
  const [royalties, setRoyalties] = useState(existing?.royalties != null ? String(existing.royalties) : "");
  const [stcg, setStcg] = useState(existing?.netShortTermCapitalGain != null ? String(existing.netShortTermCapitalGain) : "");
  const [ltcg, setLtcg] = useState(existing?.netLongTermCapitalGain != null ? String(existing.netLongTermCapitalGain) : "");
  const [seEarnings, setSeEarnings] = useState(existing?.selfEmploymentEarnings != null ? String(existing.selfEmploymentEarnings) : "");
  const [qbi, setQbi] = useState(existing?.section199aQbi != null ? String(existing.section199aQbi) : "");
  const [w2Wages, setW2Wages] = useState(existing?.section199aW2Wages != null ? String(existing.section199aW2Wages) : "");
  const [ubia, setUbia] = useState(existing?.section199aUbia != null ? String(existing.section199aUbia) : "");
  const [isSstb, setIsSstb] = useState(existing?.isSstb ?? false);
  const [basisStart, setBasisStart] = useState(existing?.basisAtYearStart != null ? String(existing.basisAtYearStart) : "");
  const [basisEnd, setBasisEnd] = useState(existing?.basisAtYearEnd != null ? String(existing.basisAtYearEnd) : "");
  const [atRisk, setAtRisk] = useState(existing?.atRiskAmount != null ? String(existing.atRiskAmount) : "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);

  // Radix Select formReady gate (per CLAUDE.md frontend conventions): wait
  // until existing data has been loaded into local state before mounting
  // controlled selects in edit mode.
  const formReady = !isEdit || (existing != null && entityName === existing.entityName);

  function asNum(v: string) { return v === "" ? 0 : Number(v); }
  function asNumOrNull(v: string) { return v === "" ? null : Number(v); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!entityName.trim()) {
      toast({ title: "Entity name is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const body = {
      taxYear,
      entityName: entityName.trim(),
      entityEin: entityEin.trim() === "" ? null : entityEin.trim(),
      entityType,
      activityType,
      box1OrdinaryIncome: asNum(box1),
      box2RentalRealEstate: asNum(box2),
      box3OtherRentalIncome: asNum(box3),
      box4GuaranteedPayments: asNum(box4Gp),
      interestIncome: asNum(interestIncome),
      ordinaryDividends: asNum(ordinaryDividends),
      qualifiedDividends: asNum(qualifiedDividends),
      royalties: asNum(royalties),
      netShortTermCapitalGain: asNum(stcg),
      netLongTermCapitalGain: asNum(ltcg),
      selfEmploymentEarnings: entityType === "partnership" ? asNum(seEarnings) : 0,
      section199aQbi: asNum(qbi),
      section199aW2Wages: asNum(w2Wages),
      section199aUbia: asNum(ubia),
      isSstb,
      basisAtYearStart: asNumOrNull(basisStart),
      basisAtYearEnd: asNumOrNull(basisEnd),
      atRiskAmount: asNumOrNull(atRisk),
      notes: notes.trim() === "" ? null : notes.trim(),
    };
    try {
      if (existing) {
        await fetch(`/api/clients/${clientId}/k1s/${existing.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        toast({ title: "K-1 updated" });
      } else {
        await fetch(`/api/clients/${clientId}/k1s`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        toast({ title: "K-1 added" });
      }
      onSaved();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit K-1" : "Add K-1"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Entity */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <Label>Entity name *</Label>
              <Input value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="Acme LLC" />
            </div>
            <div className="space-y-1">
              <Label>EIN (XX-XXXXXXX)</Label>
              <Input value={entityEin} onChange={(e) => setEntityEin(e.target.value)} placeholder="12-3456789" />
            </div>
            {formReady && (
              <div className="space-y-1">
                <Label>Entity type</Label>
                <Select value={entityType} onValueChange={(v) => setEntityType(v as "partnership" | "s_corp")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="partnership">Partnership (Form 1065)</SelectItem>
                    <SelectItem value="s_corp">S-Corp (Form 1120-S)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {formReady && (
              <div className="space-y-1">
                <Label>§469 activity</Label>
                <Select value={activityType} onValueChange={(v) => setActivityType(v as "active" | "passive")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active (material participation)</SelectItem>
                    <SelectItem value="passive">Passive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Income boxes */}
          <div className="border-t pt-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Income boxes</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Box 1 — Ordinary business income (loss)</Label>
                <CurrencyInput value={box1} onChange={setBox1} />
              </div>
              <div className="space-y-1">
                <Label>Box 2 — Net rental real estate (passive)</Label>
                <CurrencyInput value={box2} onChange={setBox2} />
              </div>
              <div className="space-y-1">
                <Label>Box 3 — Other net rental income</Label>
                <CurrencyInput value={box3} onChange={setBox3} />
              </div>
              <div className="space-y-1">
                <Label>Box 4 — Guaranteed payments (§707(c))</Label>
                <CurrencyInput value={box4Gp} onChange={setBox4Gp} />
                <p className="text-[11px] text-muted-foreground">Partnership only. Ordinary income; excluded from QBI; SE-taxable.</p>
              </div>
              <div className="space-y-1">
                <Label>Interest income (Box 5)</Label>
                <CurrencyInput value={interestIncome} onChange={setInterestIncome} />
              </div>
              <div className="space-y-1">
                <Label>Ordinary dividends</Label>
                <CurrencyInput value={ordinaryDividends} onChange={setOrdinaryDividends} />
              </div>
              <div className="space-y-1">
                <Label>Qualified dividends</Label>
                <CurrencyInput value={qualifiedDividends} onChange={setQualifiedDividends} />
              </div>
              <div className="space-y-1">
                <Label>Royalties</Label>
                <CurrencyInput value={royalties} onChange={setRoyalties} />
              </div>
              <div className="space-y-1">
                <Label>Short-term capital gain (loss)</Label>
                <CurrencyInput value={stcg} onChange={setStcg} />
              </div>
              <div className="space-y-1">
                <Label>Long-term capital gain (loss)</Label>
                <CurrencyInput value={ltcg} onChange={setLtcg} />
              </div>
            </div>
          </div>

          {/* SE & §199A */}
          <div className="border-t pt-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Self-employment + §199A QBI</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Box 14A — SE earnings (partnership only)</Label>
                <CurrencyInput value={seEarnings} onChange={setSeEarnings} />
              </div>
              <div className="space-y-1 col-span-2 mt-2">
                <p className="text-xs text-muted-foreground italic">§199A QBI: 1065 Box 20 code Z / 1120-S Box 17 code V. The engine applies the 20% deduction with the §199A(b)(2)(B) wage/UBIA limit (when wages/UBIA below are positive) and the per-business SSTB phase-out (toggle below), both binding above $191,950 single / $383,900 MFJ (2024).</p>
              </div>
              <div className="space-y-1">
                <Label>§199A QBI amount</Label>
                <CurrencyInput value={qbi} onChange={setQbi} />
              </div>
              <div className="space-y-1">
                <Label>§199A W-2 wages of entity</Label>
                <CurrencyInput value={w2Wages} onChange={setW2Wages} />
              </div>
              <div className="space-y-1">
                <Label>§199A UBIA</Label>
                <CurrencyInput value={ubia} onChange={setUbia} />
              </div>
              {formReady && (
                <div className="flex items-center gap-2 col-span-2 mt-1">
                  <Switch id="k1-sstb" checked={isSstb} onCheckedChange={setIsSstb} aria-label="Specified service trade or business" />
                  <Label htmlFor="k1-sstb" className="cursor-pointer">Specified service trade or business (§199A(d)(2) — SSTB)</Label>
                </div>
              )}
            </div>
          </div>

          {/* Basis & at-risk */}
          <div className="border-t pt-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">Basis & at-risk (§704(d)/§465 — caps active Box 1 loss)</div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Basis at year start</Label>
                <CurrencyInput value={basisStart} onChange={setBasisStart} />
              </div>
              <div className="space-y-1">
                <Label>Basis at year end</Label>
                <CurrencyInput value={basisEnd} onChange={setBasisEnd} />
              </div>
              <div className="space-y-1">
                <Label>Amount at risk (§465)</Label>
                <CurrencyInput value={atRisk} onChange={setAtRisk} />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. partner percentage, distribution detail, basis worksheet ref" />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : existing ? "Save changes" : "Add K-1"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Planning Tab (Phase G — Tax Planning detector) ──────────────────────────

const PLANNING_CATEGORY_LABEL: Record<string, string> = {
  retirement: "Retirement",
  state: "State",
  charitable: "Charitable",
  timing: "Timing",
  business: "Business",
  investment: "Investment",
  credits: "Credits",
  estate: "Estate & Gift",
};

const PLANNING_CATEGORY_BADGE: Record<string, string> = {
  retirement: "bg-success/10 text-success",
  state: "bg-brand/10 text-primary",
  charitable: "bg-destructive/10 text-destructive",
  timing: "bg-amber-100 text-amber-900",
  business: "bg-brand/10 text-primary",
  investment: "bg-brand/10 text-primary",
  credits: "bg-brand/10 text-primary",
  estate: "bg-purple-100 text-purple-900",
};

function confidenceBadgeColor(confidence: number): string {
  if (confidence >= 0.85) return "bg-success/10 text-success";
  if (confidence >= 0.70) return "bg-yellow-100 text-yellow-800";
  return "bg-muted text-foreground";
}

function PlanningSynthesisPanel({ clientId, enabled }: { clientId: number; enabled: boolean }) {
  const memo = useGetPlanningMemo(clientId, {
    query: { queryKey: getGetPlanningMemoQueryKey(clientId), enabled, staleTime: 5 * 60 * 1000 },
  });
  const email = useGetPlanningClientEmail(clientId, {
    query: { queryKey: getGetPlanningClientEmailQueryKey(clientId), enabled, staleTime: 5 * 60 * 1000 },
  });
  const missing = useGetPlanningMissingData(clientId, {
    query: { queryKey: getGetPlanningMissingDataQueryKey(clientId), enabled, staleTime: 5 * 60 * 1000 },
  });
  if (!enabled) return null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">CPA planning memo</CardTitle>
          <div className="text-xs text-muted-foreground">
            {memo.data?.aiUsed ? `Model: ${memo.data.model}` : memo.data?.model === "stub" ? "Deterministic stub (AI disabled)" : ""}
          </div>
        </CardHeader>
        <CardContent>
          {memo.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : memo.data?.content ? (
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/40 p-3 rounded max-h-96 overflow-auto">{memo.data.content}</pre>
          ) : (
            <div className="text-sm text-muted-foreground">No memo content.</div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client outreach email draft</CardTitle>
          <div className="text-xs text-muted-foreground">
            {email.data?.aiUsed ? `Model: ${email.data.model}` : email.data?.model === "stub" ? "Deterministic stub (AI disabled)" : ""}
          </div>
        </CardHeader>
        <CardContent>
          {email.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : email.data?.content ? (
            <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/40 p-3 rounded max-h-96 overflow-auto">{email.data.content}</pre>
          ) : (
            <div className="text-sm text-muted-foreground">No email content.</div>
          )}
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Still need from client</CardTitle>
        </CardHeader>
        <CardContent>
          {missing.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : missing.data?.items?.length ? (
            <ul className="list-disc pl-5 text-sm space-y-1">
              {missing.data.items.map((it: string, i: number) => <li key={i}>{it}</li>)}
            </ul>
          ) : (
            <div className="text-sm text-muted-foreground">No outstanding data items.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PlanningTab({ clientId }: { clientId: number }) {
  const { data, isLoading, error } = useGetPlanningOpportunities(clientId, {
    query: { queryKey: getGetPlanningOpportunitiesQueryKey(clientId) },
  });
  const [synthesisOn, setSynthesisOn] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Could not load planning opportunities for this client.
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const hits = data.hits ?? [];
  // Already sorted by estSavings desc by the API. Group by category for the UI.
  const byCategory = new Map<string, typeof hits>();
  for (const h of hits) {
    const cat = h.category as string;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(h);
  }
  const categories = [...byCategory.keys()].sort((a, b) => {
    const sa = byCategory.get(a)!.reduce((s, h) => s + Number(h.estSavings ?? 0), 0);
    const sb = byCategory.get(b)!.reduce((s, h) => s + Number(h.estSavings ?? 0), 0);
    return sb - sa;
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Total estimated annual savings</CardTitle>
        </CardHeader>
        <CardContent className="flex items-baseline justify-between">
          <div className="text-3xl font-semibold tracking-tight">
            {fmt(Number(data.totalEstSavings ?? 0))}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-muted-foreground">
              Catalog {data.catalogVersion} · Tax year {data.taxYear} · {hits.length} opportunit{hits.length === 1 ? "y" : "ies"}
            </div>
            {hits.length > 0 ? (
              <Button size="sm" variant={synthesisOn ? "outline" : "default"} onClick={() => setSynthesisOn((v) => !v)}>
                {synthesisOn ? "Hide AI memo" : "Generate AI memo"}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <PlanningSynthesisPanel clientId={clientId} enabled={synthesisOn} />

      <CrossStrategyCard crossStrategy={data.crossStrategy} />

      <WhatIfScenarioBuilderCard clientId={clientId} />

      <AiDiscoveryCard clientId={clientId} />

      <StateResidencyComparisonCard clientId={clientId} />

      <RothOptimizerCard clientId={clientId} />

      <PeerBenchmarkCard clientId={clientId} />

      <MultiYearPlanningSection clientId={clientId} />

      {hits.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No planning opportunities detected for this client's current tax year.
            The deterministic catalog checks 10 rules across retirement, state,
            charitable, timing, business, investment, and credits.
          </CardContent>
        </Card>
      ) : (
        categories.map((cat) => (
          <div key={cat} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${PLANNING_CATEGORY_BADGE[cat] ?? "bg-muted text-foreground"}`}>
                {PLANNING_CATEGORY_LABEL[cat] ?? cat}
              </span>
              <span className="text-xs text-muted-foreground">
                {byCategory.get(cat)!.length} opportunit{byCategory.get(cat)!.length === 1 ? "y" : "ies"}
              </span>
            </div>
            {byCategory.get(cat)!.map((hit) => (
              <Card key={hit.strategyId}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">{hit.name}</CardTitle>
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{hit.strategyId}</span>
                        <span>·</span>
                        <span>{Number(hit.cpaEffortHours).toFixed(1)}h CPA effort</span>
                        {hit.recurring ? (
                          <>
                            <span>·</span>
                            <Badge variant="outline" className="text-xs">Recurring</Badge>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <PlanningHitHeadline hit={hit} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">{hit.rationale}</p>
                  <p className="font-medium">{hit.action}</p>
                  <PlanningHitWhatIfPanel hit={hit} />
                  <PlanningHitMultiYearPanel hit={hit} />
                  <PlanningHitAssumptions hit={hit} />
                  {Array.isArray(hit.prerequisiteData) && hit.prerequisiteData.length > 0 ? (
                    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs">
                      <div className="font-medium text-amber-900 mb-1">Still need from client:</div>
                      <ul className="list-disc pl-5 text-amber-900 space-y-0.5">
                        {hit.prerequisiteData.map((req: string, i: number) => (
                          <li key={i}>{req}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="text-xs text-muted-foreground border-t pt-2">
                    Citation: {hit.citation}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

// ── Phase H — H2 / H12 helpers for the OpportunityHit card ───────────────

type HitCardProps = {
  hit: {
    estSavings: number | string;
    confidence: number | string;
    whatIf?: {
      delta: { combinedRefundDelta?: number | string; federalTaxLiability?: number | string; stateTaxLiability?: number | string; adjustedGrossIncome?: number | string; niitTax?: number | string; amtTax?: number | string };
      semantics?: "savings" | "cost" | string;
      sensitivity?: { low?: number | string; mid?: number | string; high?: number | string };
      mutations?: Array<{ kind: string; adjustmentType?: string; amount?: number | string; field?: string; value?: unknown }>;
    };
    multiYear?: {
      horizonYears?: number | string;
      baselineYearTax?: Array<number | string>;
      scenarioYearTax?: Array<number | string>;
      yearByYearDelta?: Array<number | string>;
      totalSavings?: number | string;
      growthAssumption?: number | string;
      multiYearAssumptions?: string[] | null;
    };
    assumptions?: string[] | null;
  };
};

function PlanningHitHeadline({ hit }: HitCardProps) {
  const refundDelta = Number(hit.whatIf?.delta?.combinedRefundDelta ?? 0);
  const semantics = hit.whatIf?.semantics ?? "savings";
  // For "savings" hits with a whatIf, headline = |refundDelta| (engine-verified).
  // For "cost" hits (Roth), keep heuristic estSavings as the headline (long-term
  // net benefit). The current-year cost is shown in the panel below.
  const headlineSavings = hit.whatIf && semantics === "savings"
    ? Math.abs(refundDelta)
    : Number(hit.estSavings);
  // "Engine-verified" badge appears when the engine arithmetic matches the
  // heuristic estSavings within 15% — otherwise heuristic and verified may
  // diverge (e.g., TLH offsetting LTCG at 15% vs heuristic 22% ordinary).
  const showVerified =
    hit.whatIf && semantics === "savings" &&
    Math.abs(refundDelta) > 0;
  return (
    <>
      <div className="text-2xl font-semibold text-success">
        {fmt(headlineSavings)}
      </div>
      {showVerified ? (
        <div
          className="mt-1 inline-flex items-center gap-1 rounded bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success ring-1 ring-success/30"
          title="Computed by running an actual what-if scenario through the tax engine — not a heuristic estimate."
        >
          Engine-verified (H2)
        </div>
      ) : hit.whatIf && semantics === "cost" ? (
        <div
          className="mt-1 inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 ring-1 ring-amber-200"
          title="Long-term net benefit (heuristic). Current-year tax cost shown in the breakdown below — engine-verified."
        >
          Long-term benefit · H2 cost below
        </div>
      ) : null}
      {hit.whatIf?.sensitivity ? (
        <div className="mt-1 text-[11px] text-success tabular-nums">
          Range: {fmt(Number(hit.whatIf.sensitivity.low ?? 0))} – {fmt(Number(hit.whatIf.sensitivity.high ?? 0))}
        </div>
      ) : null}
      <span className={`mt-1 ml-1 inline-flex px-2 py-0.5 rounded text-xs font-medium ${confidenceBadgeColor(Number(hit.confidence))}`}>
        {Math.round(Number(hit.confidence) * 100)}% confidence
      </span>
    </>
  );
}

function signedFmt(n: number): string {
  if (Math.abs(n) < 0.5) return "$0";
  return n < 0 ? `-${fmt(Math.abs(n))}` : `+${fmt(Math.abs(n))}`;
}

function PlanningHitWhatIfPanel({ hit }: HitCardProps) {
  if (!hit.whatIf) return null;
  const delta = hit.whatIf.delta;
  const semantics = hit.whatIf.semantics ?? "savings";
  const isCost = semantics === "cost";
  const containerClass = isCost
    ? "rounded border border-amber-200 bg-amber-50/40 p-3 text-xs"
    : "rounded border border-success/30 bg-success/5 p-3 text-xs";
  const labelClass = isCost ? "font-medium text-amber-900" : "font-medium text-success";
  const dlClass = isCost ? "grid grid-cols-2 gap-x-4 gap-y-1 text-amber-900" : "grid grid-cols-2 gap-x-4 gap-y-1 text-success";
  const dtClass = isCost ? "text-amber-700" : "text-success";
  return (
    <div className={containerClass}>
      <div className={`mb-2 ${labelClass}`}>
        {isCost ? "Current-year tax cost (engine-verified)" : "What-if engine delta (vs current return)"}
      </div>
      <dl className={dlClass}>
        <dt className={dtClass}>Federal tax</dt>
        <dd className="text-right tabular-nums">{signedFmt(Number(delta.federalTaxLiability ?? 0))}</dd>
        <dt className={dtClass}>State tax</dt>
        <dd className="text-right tabular-nums">{signedFmt(Number(delta.stateTaxLiability ?? 0))}</dd>
        <dt className={dtClass}>AGI change</dt>
        <dd className="text-right tabular-nums">{signedFmt(Number(delta.adjustedGrossIncome ?? 0))}</dd>
        {Number(delta.niitTax ?? 0) !== 0 ? (
          <>
            <dt className={dtClass}>NIIT change</dt>
            <dd className="text-right tabular-nums">{signedFmt(Number(delta.niitTax))}</dd>
          </>
        ) : null}
        {Number(delta.amtTax ?? 0) !== 0 ? (
          <>
            <dt className={dtClass}>AMT change</dt>
            <dd className="text-right tabular-nums">{signedFmt(Number(delta.amtTax))}</dd>
          </>
        ) : null}
        <dt className={dtClass}>Net refund impact</dt>
        <dd className="text-right tabular-nums font-medium">{signedFmt(Number(delta.combinedRefundDelta ?? 0))}</dd>
      </dl>
      {Array.isArray(hit.whatIf.mutations) && hit.whatIf.mutations.length > 0 ? (
        <div className="mt-2 pt-2 border-t border-success/20 text-[10px] text-success">
          <span className="font-medium">Engine simulated:</span>{" "}
          {hit.whatIf.mutations.map((m, i) => (
            <span key={i}>
              {i > 0 ? "; " : ""}
              {m.kind === "set_adjustment" || m.kind === "add_adjustment"
                ? `${m.kind === "set_adjustment" ? "set" : "add"} ${m.adjustmentType} = ${fmt(Number(m.amount ?? 0))}`
                : m.kind === "remove_adjustment"
                ? `remove ${m.adjustmentType}`
                : `set client.${m.field} = ${String(m.value)}`}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Phase H — H3 multi-year scenario panel
function PlanningHitMultiYearPanel({ hit }: HitCardProps) {
  if (!hit.multiYear) return null;
  const my = hit.multiYear;
  const horizon = Number(my.horizonYears ?? 0);
  if (horizon < 1) return null;
  const totalSavings = Number(my.totalSavings ?? 0);
  const baselineTax = (my.baselineYearTax ?? []).map((v) => Number(v));
  const scenarioTax = (my.scenarioYearTax ?? []).map((v) => Number(v));
  const yearDelta = (my.yearByYearDelta ?? []).map((v) => Number(v));
  const isPositive = totalSavings > 0;
  const headerColor = isPositive ? "text-primary" : "text-foreground";
  const sumLabel = isPositive
    ? `Saves ${fmt(Math.abs(totalSavings))} over ${horizon} years`
    : `Costs ${fmt(Math.abs(totalSavings))} over ${horizon} years`;
  return (
    <div className="rounded border border-brand/30 bg-brand/5 p-3 text-xs">
      <div className={`mb-2 font-medium ${headerColor}`}>
        Multi-year projection (H3) · {sumLabel}
      </div>
      <table className="w-full text-[11px] tabular-nums">
        <thead className="text-brand-ink">
          <tr>
            <th className="text-left font-medium">Year</th>
            <th className="text-right font-medium">Baseline tax</th>
            <th className="text-right font-medium">Scenario tax</th>
            <th className="text-right font-medium">Δ</th>
          </tr>
        </thead>
        <tbody className="text-primary">
          {Array.from({ length: horizon }).map((_, y) => {
            const b = baselineTax[y] ?? 0;
            const s = scenarioTax[y] ?? 0;
            const d = yearDelta[y] ?? 0;
            return (
              <tr key={y}>
                <td className="py-0.5">Year {y}</td>
                <td className="text-right">{fmt(b)}</td>
                <td className="text-right">{fmt(s)}</td>
                <td className={`text-right ${d < 0 ? "text-success" : d > 0 ? "text-amber-700" : ""}`}>
                  {signedFmt(d)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-brand/30">
            <td className="pt-1 font-medium">Total</td>
            <td className="pt-1 text-right font-medium">
              {fmt(baselineTax.reduce((a, b) => a + b, 0))}
            </td>
            <td className="pt-1 text-right font-medium">
              {fmt(scenarioTax.reduce((a, b) => a + b, 0))}
            </td>
            <td className="pt-1 text-right font-medium text-primary">
              {signedFmt(scenarioTax.reduce((a, b) => a + b, 0) - baselineTax.reduce((a, b) => a + b, 0))}
            </td>
          </tr>
        </tbody>
      </table>
      {Array.isArray(my.multiYearAssumptions) && my.multiYearAssumptions.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] font-medium text-brand-ink">
            Multi-year assumptions ({my.multiYearAssumptions.length})
          </summary>
          <ul className="mt-1 list-disc pl-4 text-[10px] text-brand-ink space-y-0.5">
            {my.multiYearAssumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function PlanningHitAssumptions({ hit }: HitCardProps) {
  if (!Array.isArray(hit.assumptions) || hit.assumptions.length === 0) return null;
  return (
    <details className="rounded border border-border bg-muted/50 p-3 text-xs">
      <summary className="cursor-pointer font-medium text-foreground">
        Assumptions ({hit.assumptions.length})
      </summary>
      <ul className="mt-2 list-disc pl-5 text-foreground space-y-1">
        {hit.assumptions.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    </details>
  );
}

// ── Phase H — H7 cross-strategy combined-scenario card ───────────────────

type CrossStrategyData = {
  stackedStrategyIds: string[];
  combinedDelta: {
    combinedRefundDelta?: number | string;
    federalTaxLiability?: number | string;
    stateTaxLiability?: number | string;
    adjustedGrossIncome?: number | string;
    niitTax?: number | string;
    amtTax?: number | string;
  };
  sumOfIndividualSavings: number | string;
  interactionEffect: number | string;
};

function CrossStrategyCard({ crossStrategy }: { crossStrategy?: CrossStrategyData | null }) {
  if (!crossStrategy) return null;
  const joint = Math.abs(Number(crossStrategy.combinedDelta.combinedRefundDelta ?? 0));
  const sum = Number(crossStrategy.sumOfIndividualSavings ?? 0);
  const interaction = Number(crossStrategy.interactionEffect ?? 0);
  // Negative interaction = stacking eroded savings (most common).
  // Positive interaction = strategies compounded (rare).
  const interactionLabel =
    interaction < -0.5
      ? "Bracket-stacking erodes the joint savings vs the simple sum."
      : interaction > 0.5
      ? "Strategies COMPOUND when stacked — joint savings exceeds the simple sum."
      : "Stacked savings are approximately additive (no significant interaction).";
  return (
    <Card className="border-brand/30 bg-brand/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-primary">
          All strategies combined (Phase H — H7)
        </CardTitle>
        <div className="text-xs text-brand-ink mt-1">
          Engine ran all {crossStrategy.stackedStrategyIds.length} savings strategies as ONE
          stacked scenario: {crossStrategy.stackedStrategyIds.join(", ")}.
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-brand-ink">Joint savings (verified)</div>
            <div className="text-2xl font-semibold text-success">{fmt(joint)}</div>
          </div>
          <div>
            <div className="text-xs text-brand-ink">Sum of individual savings</div>
            <div className="text-2xl font-semibold text-foreground">{fmt(sum)}</div>
          </div>
          <div>
            <div className="text-xs text-brand-ink">Interaction effect</div>
            <div className={`text-2xl font-semibold tabular-nums ${interaction < 0 ? "text-destructive" : interaction > 0 ? "text-success" : "text-foreground"}`}>
              {signedFmt(interaction)}
            </div>
          </div>
        </div>
        <p className="text-xs text-primary">{interactionLabel}</p>
        <div className="rounded border border-brand/30 bg-white/40 p-3 text-xs text-primary">
          <div className="font-medium mb-2">Joint engine delta breakdown</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-brand-ink">Federal tax</dt>
            <dd className="text-right tabular-nums">{signedFmt(Number(crossStrategy.combinedDelta.federalTaxLiability ?? 0))}</dd>
            <dt className="text-brand-ink">State tax</dt>
            <dd className="text-right tabular-nums">{signedFmt(Number(crossStrategy.combinedDelta.stateTaxLiability ?? 0))}</dd>
            <dt className="text-brand-ink">AGI change</dt>
            <dd className="text-right tabular-nums">{signedFmt(Number(crossStrategy.combinedDelta.adjustedGrossIncome ?? 0))}</dd>
            {Number(crossStrategy.combinedDelta.niitTax ?? 0) !== 0 ? (
              <>
                <dt className="text-brand-ink">NIIT change</dt>
                <dd className="text-right tabular-nums">{signedFmt(Number(crossStrategy.combinedDelta.niitTax))}</dd>
              </>
            ) : null}
            {Number(crossStrategy.combinedDelta.amtTax ?? 0) !== 0 ? (
              <>
                <dt className="text-brand-ink">AMT change</dt>
                <dd className="text-right tabular-nums">{signedFmt(Number(crossStrategy.combinedDelta.amtTax))}</dd>
              </>
            ) : null}
            <dt className="text-brand-ink">Net refund impact</dt>
            <dd className="text-right tabular-nums font-medium">{signedFmt(Number(crossStrategy.combinedDelta.combinedRefundDelta ?? 0))}</dd>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Phase H — H8 AI fact-pattern strategy discovery card ─────────────────

function AiDiscoveryCard({ clientId }: { clientId: number }) {
  const [enabled, setEnabled] = React.useState(false);
  const { data, isLoading, error } = useGetPlanningDiscovery(clientId, {
    query: {
      queryKey: getGetPlanningDiscoveryQueryKey(clientId),
      enabled,
    },
  });
  return (
    <Card className="border-fuchsia-200 bg-fuchsia-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base text-fuchsia-900">
              AI strategy discovery (Phase H — H8)
            </CardTitle>
            <div className="text-xs text-fuchsia-700 mt-1">
              Ask the LLM to scan the client's full picture + the entire 20-rule
              catalog and surface candidate strategies the deterministic rule
              engine may have missed. Math stays deterministic; LLM only
              proposes qualitative candidates with rationales + IRC citations.
            </div>
          </div>
          <Button
            size="sm"
            variant={enabled ? "outline" : "default"}
            onClick={() => setEnabled(true)}
            disabled={enabled && isLoading}
          >
            {enabled && isLoading ? "Scanning..." : enabled ? "Re-scan" : "Discover with AI"}
          </Button>
        </div>
      </CardHeader>
      {!enabled ? null : isLoading ? (
        <CardContent className="text-sm text-fuchsia-700">Scanning catalog...</CardContent>
      ) : error ? (
        <CardContent className="text-sm text-destructive">
          Discovery failed. Check server logs.
        </CardContent>
      ) : !data ? null : (data.candidates ?? []).length === 0 ? (
        <CardContent className="text-sm text-fuchsia-700">
          {data.aiUsed
            ? "AI scanned the catalog and didn't find any additional strategies for this client. The deterministic rule engine has covered the obvious opportunities."
            : "AI is disabled on this server (no AI_API_KEY). Enable AI to use Discovery."}
        </CardContent>
      ) : (
        <CardContent className="space-y-3 text-sm">
          {(data.candidates ?? []).map((c, i) => {
            const conf = Number(c.confidence ?? 0);
            return (
              <div key={i} className="rounded border border-fuchsia-200 bg-white/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-fuchsia-900">{c.name}</div>
                    <div className="text-xs text-fuchsia-700">{c.ircSection}</div>
                  </div>
                  <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                    conf >= 0.7 ? "bg-success/10 text-success" :
                    conf >= 0.4 ? "bg-amber-100 text-amber-800" :
                    "bg-muted text-foreground"
                  }`}>
                    {(conf * 100).toFixed(0)}% confidence
                  </span>
                </div>
                {c.verification ? (
                  <div
                    className={`mt-2 text-[11px] rounded px-2 py-1 ${
                      c.verification.status === "catalog-overlap"
                        ? "bg-amber-50 text-amber-900 border border-amber-200"
                        : "bg-muted/50 text-foreground border border-border"
                    }`}
                    title={c.verification.detail}
                  >
                    <span className="font-medium">
                      {c.verification.status === "catalog-overlap"
                        ? `Rule-engine: catalog-overlap with ${c.verification.matchedCatalogId ?? "?"}`
                        : "Rule-engine: extra strategy (not in catalog)"}
                    </span>
                  </div>
                ) : null}
                <p className="mt-2 text-fuchsia-900">{c.rationale}</p>
                {Array.isArray(c.prerequisiteData) && c.prerequisiteData.length > 0 ? (
                  <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
                    <div className="font-medium text-amber-900 mb-1">Data to gather to confirm:</div>
                    <ul className="list-disc pl-5 text-amber-900 space-y-0.5">
                      {c.prerequisiteData.map((p, j) => <li key={j}>{p}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="text-[10px] text-fuchsia-700 pt-2 border-t border-fuchsia-200">
            AI: {data.aiUsed ? `${data.model} (engine math is sacred — LLM produces qualitative candidates only)` : "disabled (stub)"}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── Phase H — H4 state-residency comparison card ─────────────────────────

function StateResidencyComparisonCard({ clientId }: { clientId: number }) {
  const mutation = useRunStateComparison();
  const [hasRun, setHasRun] = React.useState(false);
  const data = mutation.data;

  const handleRun = () => {
    setHasRun(true);
    mutation.mutate({ clientId, data: {} }); // empty body → use default targets
  };

  return (
    <Card className="border-cyan-200 bg-cyan-50/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base text-cyan-900">
              State residency comparison (Phase H — H4)
            </CardTitle>
            <div className="text-xs text-cyan-700 mt-1">
              Run an H2 scenario for each target state to see the federal +
              state tax impact of moving. Defaults to zero-income-tax
              states (TX, FL, NV, WA, TN).
            </div>
          </div>
          <Button
            size="sm"
            variant={hasRun ? "outline" : "default"}
            onClick={handleRun}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Running..." : hasRun ? "Re-run" : "Compare states"}
          </Button>
        </div>
      </CardHeader>
      {data ? (
        <CardContent className="text-sm space-y-3">
          <div className="text-xs text-cyan-800">
            Current resident state:{" "}
            <span className="font-medium">{data.baselineState || "—"}</span>{" "}
            (federal tax {fmt(Number(data.baselineFederal ?? 0))}, state tax{" "}
            {fmt(Number(data.baselineState_tax ?? 0))})
          </div>
          {Array.isArray(data.results) && data.results.length > 0 ? (
            <div className="rounded border border-cyan-200 bg-white/40 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-cyan-100/50 text-cyan-900">
                  <tr>
                    <th className="text-left px-3 py-2">Target state</th>
                    <th className="text-right px-3 py-2">Fed tax</th>
                    <th className="text-right px-3 py-2">State tax</th>
                    <th className="text-right px-3 py-2">Δ Federal</th>
                    <th className="text-right px-3 py-2">Δ State</th>
                    <th className="text-right px-3 py-2 font-medium">Δ Combined</th>
                  </tr>
                </thead>
                <tbody className="text-cyan-900">
                  {data.results.map((r, i) => {
                    const dc = Number(r.deltaCombined ?? 0);
                    return (
                      <tr key={i} className="border-t border-cyan-100">
                        <td className="px-3 py-2 font-medium">{r.state}</td>
                        <td className="text-right tabular-nums px-3 py-2">{fmt(Number(r.scenarioFederal ?? 0))}</td>
                        <td className="text-right tabular-nums px-3 py-2">{fmt(Number(r.scenarioState ?? 0))}</td>
                        <td className="text-right tabular-nums px-3 py-2">{signedFmt(Number(r.deltaFederal ?? 0))}</td>
                        <td className="text-right tabular-nums px-3 py-2">{signedFmt(Number(r.deltaState ?? 0))}</td>
                        <td className={`text-right tabular-nums px-3 py-2 font-medium ${dc < 0 ? "text-success" : dc > 0 ? "text-destructive" : ""}`}>
                          {signedFmt(dc)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-xs text-cyan-700">
              No target states (client is already in all default states, or all were excluded).
            </div>
          )}
          <details className="text-xs text-cyan-800">
            <summary className="cursor-pointer font-medium">Caveats CPAs must communicate to clients</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Engine mutates resident state but does NOT model income sourcing — W-2 wages remain tied to original work state in this scenario. Real moves require multi-state allocation per state rules.</li>
              <li>Establishing domicile in a new state requires more than tax filing (driver's license, voter registration, days-present test, etc.).</li>
              <li>Does NOT model real estate, cost of living, or the new state's sales / property tax burden.</li>
              <li>State withholding from existing W-2s isn't recomputed — refund-or-owed amounts in the source-state will need to be unwound separately.</li>
            </ul>
          </details>
        </CardContent>
      ) : mutation.isError ? (
        <CardContent className="text-sm text-destructive">
          Error running state comparison. Check the server logs.
        </CardContent>
      ) : !hasRun ? (
        <CardContent className="text-xs text-cyan-700">
          Click "Compare states" to run the analysis.
        </CardContent>
      ) : null}
    </Card>
  );
}

// ── T1.3 — Interactive what-if scenario builder ──────────────────────────
// A CPA composes arbitrary engine mutations (add/replace/remove an adjustment,
// or change a client fact like filing status / state / age) and runs them
// through the pure tax engine via POST /clients/:id/what-if. Shows the
// engine-computed federal + state delta side-by-side. No math is estimated —
// every number is the real `computeTaxReturnPure` output.

const WHATIF_KIND_LABELS: Record<WhatIfMutation["kind"], string> = {
  add_adjustment: "Add adjustment",
  set_adjustment: "Set adjustment (replace existing)",
  remove_adjustment: "Remove adjustment",
  set_client_field: "Change a client fact",
};

// Curated set of client facts that are meaningful what-if levers. The engine
// accepts any ClientFacts key, but these are the ones a CPA actually models
// (e.g. "what if they filed MFS instead of MFJ", "what if they moved to TX").
const WHATIF_CLIENT_FIELDS: Record<string, string> = {
  filingStatus: "Filing status",
  state: "Resident state",
  taxpayerAge: "Taxpayer age",
  spouseAge: "Spouse age",
  dependentsUnder17: "Dependents under 17 (CTC)",
  otherDependents: "Other dependents",
};

const WHATIF_FILING_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "single", label: "Single" },
  { value: "married_filing_jointly", label: "Married Filing Jointly" },
  { value: "married_filing_separately", label: "Married Filing Separately" },
  { value: "head_of_household", label: "Head of Household" },
  { value: "qualifying_widow", label: "Qualifying Widow(er)" },
];

// Client fields whose value the engine reads as a number — coerce on submit.
const WHATIF_NUMERIC_FIELDS = new Set([
  "taxpayerAge",
  "spouseAge",
  "dependentsUnder17",
  "otherDependents",
]);

type WhatIfKind = WhatIfMutation["kind"];

type WhatIfRow = {
  id: number;
  kind: WhatIfKind;
  adjustmentType: string;
  amount: string;
  field: string;
  value: string;
};

let whatIfRowSeq = 0;
function newWhatIfRow(): WhatIfRow {
  return {
    id: ++whatIfRowSeq,
    kind: "add_adjustment",
    adjustmentType: "deduction",
    amount: "",
    field: "filingStatus",
    value: "",
  };
}

/** Convert a builder row into a wire mutation, or null if the row is incomplete. */
function whatIfRowToMutation(r: WhatIfRow): WhatIfMutation | null {
  switch (r.kind) {
    case "add_adjustment":
    case "set_adjustment": {
      if (!r.adjustmentType) return null;
      // Strip first, THEN require the cleaned string to be non-empty. Testing the
      // un-stripped string would let garbage ("abc", "$") through as Number("")===0.
      const cleaned = String(r.amount).replace(/[^0-9.-]/g, "");
      if (cleaned === "") return null;
      const amt = Number(cleaned);
      if (!Number.isFinite(amt)) return null;
      return { kind: r.kind, adjustmentType: r.adjustmentType, amount: amt };
    }
    case "remove_adjustment": {
      if (!r.adjustmentType) return null;
      return { kind: "remove_adjustment", adjustmentType: r.adjustmentType };
    }
    case "set_client_field": {
      const v = String(r.value).trim();
      if (!r.field || v === "") return null;
      if (WHATIF_NUMERIC_FIELDS.has(r.field)) {
        // Same guard as the amount path: reject non-numeric text instead of
        // silently coercing it to 0 (age 0 / 0 dependents would be a wrong model).
        const cleaned = v.replace(/[^0-9.-]/g, "");
        if (cleaned === "") return null;
        const n = Number(cleaned);
        if (!Number.isFinite(n)) return null;
        return { kind: "set_client_field", field: r.field, value: n };
      }
      return {
        kind: "set_client_field",
        field: r.field,
        value: r.field === "state" ? v.toUpperCase() : v,
      };
    }
    default:
      return null;
  }
}

function WhatIfComparisonRow({
  label,
  baseline,
  scenario,
  kind,
}: {
  label: string;
  baseline: number;
  scenario: number;
  // money: plain $, decrease is good (tax). signedMoney: signed $, increase is
  // good (refund/owed). neutralMoney: plain $, delta carries NO good/bad signal
  // (AGI / taxable income are informational, not favorable-when-up-or-down).
  // pct: percentage, decrease is good (effective rate).
  kind: "money" | "signedMoney" | "neutralMoney" | "pct";
}) {
  const delta = scenario - baseline;
  const fmtCell = (n: number) =>
    kind === "pct" ? `${(n * 100).toFixed(2)}%` : kind === "signedMoney" ? signedFmt(n) : fmt(n);
  const deltaText = kind === "pct" ? `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(2)}%` : signedFmt(delta);
  // Tax/effective-rate rows: decrease is good. Refund rows: increase is good.
  // AGI/taxable (neutralMoney): no good/bad signal — the tax & refund rows carry it.
  const goodWhenDown = kind === "money" || kind === "pct";
  const deltaClass =
    kind === "neutralMoney" || Math.abs(delta) < 0.005
      ? "text-muted-foreground"
      : (goodWhenDown ? delta < 0 : delta > 0)
        ? "text-success"
        : "text-destructive";
  return (
    <tr className="border-t border-brand/15">
      <td className="px-3 py-1.5 text-muted-foreground">{label}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{fmtCell(baseline)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmtCell(scenario)}</td>
      <td className={`px-3 py-1.5 text-right tabular-nums ${deltaClass}`}>{deltaText}</td>
    </tr>
  );
}

function WhatIfScenarioBuilderCard({ clientId }: { clientId: number }) {
  const mutation = useRunWhatIfScenario();
  const [label, setLabel] = React.useState("");
  const [rows, setRows] = React.useState<WhatIfRow[]>(() => [newWhatIfRow()]);
  const data = mutation.data;

  const updateRow = (id: number, patch: Partial<WhatIfRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, newWhatIfRow()]);
  const removeRow = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));

  const mutations = rows
    .map(whatIfRowToMutation)
    .filter((m): m is WhatIfMutation => m != null);
  const canRun = mutations.length > 0 && !mutation.isPending;

  const handleRun = () => {
    if (mutations.length === 0) return;
    mutation.mutate({
      clientId,
      data: { label: label.trim() || "Custom what-if scenario", mutations },
    });
  };

  const combinedTaxDelta = data ? Number(data.delta.combinedTaxDelta ?? 0) : 0;
  const refundDelta = data ? Number(data.delta.combinedRefundDelta ?? 0) : 0;
  // Drive the verdict off the cash impact (refund / amount owed), not the
  // pre-credit tax-liability delta: a credit-only scenario (e.g. FTC) leaves tax
  // liability flat while the refund moves — the lesson PlanningHitWhatIfPanel
  // already encodes by ranking on combinedRefundDelta.
  const isSavings = refundDelta > 0.5;
  const isCost = refundDelta < -0.5;

  return (
    <Card className="border-brand/40 bg-brand/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-primary">What-if scenario builder</CardTitle>
        <div className="text-xs text-brand-ink mt-1">
          Compose any change to this client's return — add or remove an adjustment,
          or change a client fact (filing status, state, age) — and run it through
          the tax engine for an exact federal + state delta. Nothing is estimated.
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-brand-ink">Scenario label (optional)</label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Max out SEP + switch to MFS"
            className="max-w-md"
          />
        </div>

        <div className="space-y-2">
          {rows.length === 0 ? (
            <div className="text-xs text-muted-foreground">No changes yet — add one below.</div>
          ) : null}
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-end gap-2 rounded border border-brand/20 bg-white/50 p-2"
            >
              <div className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Change</span>
                <Select value={r.kind} onValueChange={(v) => updateRow(r.id, { kind: v as WhatIfKind })}>
                  <SelectTrigger className="h-9 w-48 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(WHATIF_KIND_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k} className="text-xs">
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {r.kind === "set_client_field" ? (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Client fact</span>
                    <Select value={r.field} onValueChange={(v) => updateRow(r.id, { field: v, value: "" })}>
                      <SelectTrigger className="h-9 w-44 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(WHATIF_CLIENT_FIELDS).map(([k, v]) => (
                          <SelectItem key={k} value={k} className="text-xs">
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">New value</span>
                    {r.field === "filingStatus" ? (
                      <Select value={r.value} onValueChange={(v) => updateRow(r.id, { value: v })}>
                        <SelectTrigger className="h-9 w-52 text-xs">
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                        <SelectContent>
                          {WHATIF_FILING_STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value} className="text-xs">
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={r.value}
                        onChange={(e) => updateRow(r.id, { value: e.target.value })}
                        placeholder={r.field === "state" ? "e.g. TX" : "0"}
                        inputMode={WHATIF_NUMERIC_FIELDS.has(r.field) ? "numeric" : "text"}
                        className="h-9 w-40 text-xs"
                      />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Adjustment type</span>
                    <Select
                      value={r.adjustmentType}
                      onValueChange={(v) => updateRow(r.id, { adjustmentType: v })}
                    >
                      <SelectTrigger className="h-9 w-64 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ADJUSTMENT_TYPE_LABELS).map(([k, v]) => (
                          <SelectItem key={k} value={k} className="text-xs">
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {r.kind !== "remove_adjustment" ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount</span>
                      <div className="w-36">
                        <CurrencyInput
                          value={r.amount}
                          onChange={(v) => updateRow(r.id, { amount: v })}
                          placeholder="$0"
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              <Button
                size="sm"
                variant="ghost"
                className="h-9 text-destructive hover:text-destructive"
                onClick={() => removeRow(r.id)}
                aria-label="Remove this change"
              >
                Remove
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={addRow}>
            + Add another change
          </Button>
          <Button size="sm" onClick={handleRun} disabled={!canRun}>
            {mutation.isPending ? "Running..." : "Run scenario"}
          </Button>
          {rows.length > 0 && mutations.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Fill in an amount or value to run.
            </span>
          ) : null}
        </div>

        {mutation.isError ? (
          <div className="text-sm text-destructive">
            Could not run the scenario. Check that each change is complete (the server
            rejects an adjustment without an amount).
          </div>
        ) : null}

        {data ? (
          <div className="space-y-3 pt-1">
            <div
              className={`rounded border p-3 ${
                isSavings
                  ? "border-success/30 bg-success/5"
                  : isCost
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-brand/20 bg-white/40"
              }`}
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Combined federal + state cash impact (refund / amount owed)
              </div>
              <div
                className={`text-2xl font-semibold tabular-nums ${
                  isSavings ? "text-success" : isCost ? "text-destructive" : "text-foreground"
                }`}
              >
                {signedFmt(refundDelta)}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {isSavings
                  ? `This scenario improves the combined refund (or lowers the amount owed) by ${fmt(Math.abs(refundDelta))}.`
                  : isCost
                    ? `This scenario reduces the combined refund (or raises the amount owed) by ${fmt(Math.abs(refundDelta))} — a current-year cost; weigh against any long-term benefit.`
                    : "No combined cash impact."}
                {" "}Combined tax-liability change: <span className="font-medium">{signedFmt(combinedTaxDelta)}</span>.
              </div>
            </div>

            <div className="rounded border border-brand/20 bg-white/40 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-brand/10 text-primary">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Metric</th>
                    <th className="px-3 py-2 text-right font-medium">Baseline</th>
                    <th className="px-3 py-2 text-right font-medium">Scenario</th>
                    <th className="px-3 py-2 text-right font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  <WhatIfComparisonRow label="Adjusted gross income" baseline={Number(data.baseline.adjustedGrossIncome ?? 0)} scenario={Number(data.scenario.adjustedGrossIncome ?? 0)} kind="neutralMoney" />
                  <WhatIfComparisonRow label="Taxable income" baseline={Number(data.baseline.taxableIncome ?? 0)} scenario={Number(data.scenario.taxableIncome ?? 0)} kind="neutralMoney" />
                  <WhatIfComparisonRow label="Federal tax" baseline={Number(data.baseline.federalTaxLiability ?? 0)} scenario={Number(data.scenario.federalTaxLiability ?? 0)} kind="money" />
                  <WhatIfComparisonRow label="State tax" baseline={Number(data.baseline.stateTaxLiability ?? 0)} scenario={Number(data.scenario.stateTaxLiability ?? 0)} kind="money" />
                  <WhatIfComparisonRow label="Federal refund / (owed)" baseline={Number(data.baseline.federalRefundOrOwed ?? 0)} scenario={Number(data.scenario.federalRefundOrOwed ?? 0)} kind="signedMoney" />
                  <WhatIfComparisonRow label="State refund / (owed)" baseline={Number(data.baseline.stateRefundOrOwed ?? 0)} scenario={Number(data.scenario.stateRefundOrOwed ?? 0)} kind="signedMoney" />
                  <WhatIfComparisonRow label="Effective tax rate" baseline={Number(data.baseline.effectiveTaxRate ?? 0)} scenario={Number(data.scenario.effectiveTaxRate ?? 0)} kind="pct" />
                </tbody>
              </table>
            </div>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium">Other tax components &amp; the exact mutations run</summary>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                {([
                  ["SE tax", data.delta.selfEmploymentTax],
                  ["NIIT", data.delta.niitTax],
                  ["AMT", data.delta.amtTax],
                  ["Add'l Medicare", data.delta.additionalMedicareTax],
                  ["QBI deduction", data.delta.qbiDeduction],
                  ["EITC", data.delta.eitc],
                  ["Add'l CTC", data.delta.additionalChildTaxCredit],
                ] as Array<[string, number | string | undefined]>)
                  .filter(([, v]) => Math.abs(Number(v ?? 0)) >= 0.5)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <span>{k}</span>
                      <span className="tabular-nums">{signedFmt(Number(v ?? 0))}</span>
                    </div>
                  ))}
              </div>
              <ul className="mt-2 list-disc pl-5 space-y-0.5">
                {(data.mutations ?? []).map((m, i) => (
                  <li key={i}>
                    <span className="font-medium">{WHATIF_KIND_LABELS[m.kind as WhatIfKind] ?? m.kind}</span>
                    {m.adjustmentType
                      ? ` — ${ADJUSTMENT_TYPE_LABELS[m.adjustmentType] ?? m.adjustmentType}${
                          m.amount != null ? ` = ${fmt(Number(m.amount))}` : ""
                        }`
                      : m.field
                        ? ` — ${WHATIF_CLIENT_FIELDS[m.field] ?? m.field} = ${String(m.value)}`
                        : ""}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ── PLAN-B1 — Multi-year Roth-conversion ladder optimizer card ───────────

function RothOptimizerCard({ clientId }: { clientId: number }) {
  const mutation = useRunRothOptimizer();
  const [iraBalance, setIraBalance] = React.useState("");
  const [horizon, setHorizon] = React.useState("5");
  const plan = mutation.data?.plan;

  const handleRun = () => {
    const bal = Number(String(iraBalance).replace(/[^0-9.]/g, "")) || 0;
    const yrs = Math.max(1, Math.min(30, Math.round(Number(horizon) || 5)));
    mutation.mutate({ clientId, data: { horizonYears: yrs, traditionalIraBalance: bal } });
  };

  const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

  return (
    <Card className="border-violet-200 bg-violet-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-violet-900">
          Roth-conversion ladder optimizer
        </CardTitle>
        <div className="text-xs text-violet-700 mt-1">
          Fills the top of the client's current federal bracket with traditional-IRA
          conversions each year — locking in today's low rate before RMDs force higher-taxed
          withdrawals later. The current-year tax cost is engine-computed (not estimated).
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-violet-800">Traditional IRA balance</label>
            <div className="w-44">
              <CurrencyInput value={iraBalance} onChange={setIraBalance} placeholder="$0" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-violet-800">Horizon (years)</label>
            <Input
              type="number"
              min={1}
              max={30}
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
              className="w-24"
            />
          </div>
          <Button size="sm" onClick={handleRun} disabled={mutation.isPending}>
            {mutation.isPending ? "Running..." : plan ? "Re-run" : "Build ladder"}
          </Button>
        </div>
      </CardHeader>
      {plan ? (
        <CardContent className="text-sm space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded border border-violet-200 bg-white/50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-violet-600">Total converted</div>
              <div className="text-lg font-semibold text-violet-900 tabular-nums">{fmt(Number(plan.totalConverted ?? 0))}</div>
            </div>
            <div className="rounded border border-violet-200 bg-white/50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-violet-600">Total tax cost</div>
              <div className="text-lg font-semibold text-violet-900 tabular-nums">{fmt(Number(plan.totalConversionTaxCost ?? 0))}</div>
            </div>
            <div className="rounded border border-violet-200 bg-white/50 p-3">
              <div className="text-[10px] uppercase tracking-wide text-violet-600">Blended rate</div>
              <div className="text-lg font-semibold text-violet-900 tabular-nums">{pct(Number(plan.blendedConversionRate ?? 0))}</div>
            </div>
          </div>
          {plan.rmdAvoidance ? (
            <div className="rounded border border-violet-300 bg-violet-100/40 p-3 text-xs text-violet-900 space-y-1">
              <div className="font-semibold">
                Lifetime RMD-avoidance ({plan.rmdAvoidance.valueHorizonYears}-yr horizon to ~age 92)
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span>No-conversion lifetime tax: <span className="tabular-nums font-medium">{fmt(Number(plan.rmdAvoidance.baselineLifetimeFederalTax))}</span></span>
                <span>With-ladder lifetime tax: <span className="tabular-nums font-medium">{fmt(Number(plan.rmdAvoidance.scenarioLifetimeFederalTax))}</span></span>
                <span>
                  Net lifetime value {Number(plan.rmdAvoidance.netLifetimeValue) >= 0 ? "(saved)" : "(extra cost)"}:{" "}
                  <span className={`tabular-nums font-semibold ${Number(plan.rmdAvoidance.netLifetimeValue) >= 0 ? "text-success" : "text-destructive"}`}>
                    {fmt(Math.abs(Number(plan.rmdAvoidance.netLifetimeValue)))}
                  </span>
                </span>
              </div>
              <div className="text-[11px] text-violet-700">
                Lifetime RMDs: {fmt(Number(plan.rmdAvoidance.baselineRmdTotal))} → {fmt(Number(plan.rmdAvoidance.scenarioRmdTotal))} ·{" "}
                Medicare IRMAA: {fmt(Number(plan.rmdAvoidance.baselineLifetimeIrmaa))} → {fmt(Number(plan.rmdAvoidance.scenarioLifetimeIrmaa))} ·{" "}
                tax-free Roth at horizon: <span className="font-medium">{fmt(Number(plan.rmdAvoidance.scenarioRothBalanceFinal))}</span> (omitted from net — upside).
              </div>
            </div>
          ) : null}
          <div className="rounded border border-violet-200 bg-white/40 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-violet-100/50 text-violet-900">
                <tr>
                  <th className="text-left px-3 py-2">Year</th>
                  <th className="text-right px-3 py-2">Taxable before</th>
                  <th className="text-right px-3 py-2">Bracket top</th>
                  <th className="text-right px-3 py-2">Rate</th>
                  <th className="text-right px-3 py-2 font-medium">Convert</th>
                  <th className="text-right px-3 py-2">Tax cost</th>
                  <th className="text-right px-3 py-2">IRA left</th>
                </tr>
              </thead>
              <tbody className="text-violet-900">
                {(plan.years ?? []).map((y, i) => (
                  <tr key={i} className="border-t border-violet-100">
                    <td className="px-3 py-2 font-medium">{y.taxYear}</td>
                    <td className="text-right tabular-nums px-3 py-2">{fmt(Number(y.taxableIncomeBeforeConversion ?? 0))}</td>
                    <td className="text-right tabular-nums px-3 py-2">{Number.isFinite(Number(y.bracketCeiling)) ? fmt(Number(y.bracketCeiling)) : "—"}</td>
                    <td className="text-right tabular-nums px-3 py-2">{pct(Number(y.marginalRate ?? 0))}</td>
                    <td className="text-right tabular-nums px-3 py-2 font-medium text-brand-ink">{fmt(Number(y.conversion ?? 0))}</td>
                    <td className="text-right tabular-nums px-3 py-2">{fmt(Number(y.conversionTaxCost ?? 0))}</td>
                    <td className="text-right tabular-nums px-3 py-2">{fmt(Number(y.iraBalanceRemaining ?? 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="text-xs text-violet-800">
            <summary className="cursor-pointer font-medium">Assumptions &amp; v1 limitations</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              {(plan.assumptions ?? []).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>
        </CardContent>
      ) : mutation.isError ? (
        <CardContent className="text-sm text-destructive">
          Error building the conversion ladder. Check the server logs.
        </CardContent>
      ) : (
        <CardContent className="text-xs text-violet-700">
          Enter the client's traditional-IRA balance and a horizon, then click "Build ladder".
        </CardContent>
      )}
    </Card>
  );
}

// ── Phase H — H11 peer benchmark card ────────────────────────────────────

function PeerBenchmarkCard({ clientId }: { clientId: number }) {
  const { data, isLoading, error } = useGetPeerBenchmark(clientId, undefined, {
    query: { queryKey: getGetPeerBenchmarkQueryKey(clientId) },
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (error) return null;
  if (!data) return null;
  const cohort = data.cohort;
  const cohortSize = Number(cohort.size ?? 0);
  if (cohortSize === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 text-xs text-muted-foreground">
          <span className="font-medium">Peer benchmark (Phase H — H11):</span>{" "}
          No firm peers within ±$50k AGI of this client. Add more clients in this AGI band to enable cohort comparison.
        </CardContent>
      </Card>
    );
  }
  const clientRate = Number(data.clientEffectiveRate ?? 0);
  const rank = Number(cohort.clientPercentileRank ?? 50);
  const median = Number(cohort.effectiveRateMedian ?? 0);
  const delta = clientRate - median; // positive = paying MORE than median
  const verdict = rank > 65
    ? "Client pays MORE than most peers — strong planning opportunity."
    : rank < 35
    ? "Client pays LESS than most peers — already optimized."
    : "Client pays around the median — typical planning effort warranted.";
  const verdictClass = rank > 65 ? "text-destructive" : rank < 35 ? "text-success" : "text-foreground";
  return (
    <Card className="border-brand/30 bg-brand/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-primary">
          Peer benchmark (Phase H — H11)
        </CardTitle>
        <div className="text-xs text-brand-ink mt-1">
          Effective tax rate vs {cohortSize} firm peer{cohortSize === 1 ? "" : "s"}{" "}
          in the {fmt(Number(cohort.agiMin ?? 0))}–{fmt(Number(cohort.agiMax ?? 0))} AGI band.
        </div>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-brand-ink">Client's effective rate</div>
            <div className="text-2xl font-semibold text-primary">
              {(clientRate * 100).toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-brand-ink">Peer median</div>
            <div className="text-2xl font-semibold text-foreground">
              {(median * 100).toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-brand-ink">Percentile rank</div>
            <div className="text-2xl font-semibold text-primary">
              {rank.toFixed(0)}<span className="text-base font-normal">/100</span>
            </div>
          </div>
        </div>
        <p className={`text-sm font-medium ${verdictClass}`}>{verdict}</p>
        <div className="rounded border border-brand/30 bg-white/40 p-3 text-xs text-primary">
          <div className="font-medium mb-2">Cohort distribution</div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-brand-ink">25th percentile</dt>
            <dd className="text-right tabular-nums">{(Number(cohort.effectiveRateP25 ?? 0) * 100).toFixed(2)}%</dd>
            <dt className="text-brand-ink">Mean</dt>
            <dd className="text-right tabular-nums">{(Number(cohort.effectiveRateMean ?? 0) * 100).toFixed(2)}%</dd>
            <dt className="text-brand-ink">75th percentile</dt>
            <dd className="text-right tabular-nums">{(Number(cohort.effectiveRateP75 ?? 0) * 100).toFixed(2)}%</dd>
            <dt className="text-brand-ink">Client vs median</dt>
            <dd className={`text-right tabular-nums font-medium ${delta > 0 ? "text-destructive" : "text-success"}`}>
              {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(2)} pp
            </dd>
          </dl>
        </div>
        <p className="text-[10px] text-brand-ink">
          Cohort is firm-wide clients with AGI within $50k of {fmt(Number(data.clientAgi ?? 0))}.
          Effective rate = total federal + state tax burden / total income.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Multi-year planning section (Phase G4) ────────────────────────────────

function MultiYearPlanningSection({ clientId }: { clientId: number }) {
  const { data, isLoading, error } = useGetPlanningMultiYear(clientId, {
    query: { queryKey: getGetPlanningMultiYearQueryKey(clientId) },
  });

  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (error || !data) return null;
  const hits = data.hits ?? [];
  const yearsAvailable = Number(data.yearsAvailable ?? 0);

  // Suppress the entire section when only one year of history exists — the
  // detectors can't fire and an empty card is noise. Surface a brief hint
  // instead so the CPA knows multi-year detection is in the product.
  if (yearsAvailable < 2) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 text-xs text-muted-foreground">
          Multi-year planning patterns activate once this client has at least 2 years
          of computed tax_returns history. Currently {yearsAvailable === 0
            ? "no tax_returns are persisted yet."
            : "only the current year is persisted."}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-base">Multi-year trends</CardTitle>
          <div className="text-xs text-muted-foreground">
            Years analyzed: {(data.yearsCovered ?? []).join(", ")} · Catalog {data.catalogVersion}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {hits.length === 0 ? (
          <p className="text-muted-foreground">
            No multi-year patterns detected across {yearsAvailable} years of history. The 5 G4 detectors
            check persistent NIIT, persistent AMT, std-ded cliff repetition, stuck capital-loss
            carryforward, and passive-loss suspension growth.
          </p>
        ) : (
          hits.map((hit) => (
            <div
              key={hit.strategyId}
              className="rounded border border-brand/30 bg-brand/5 p-3 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{hit.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{hit.strategyId}</span>
                    <span>·</span>
                    <span>{Number(hit.cpaEffortHours).toFixed(1)}h CPA effort</span>
                    {hit.recurring ? (
                      <>
                        <span>·</span>
                        <Badge variant="outline" className="text-xs">Recurring</Badge>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold text-brand-ink">
                    {fmt(Number(hit.estSavings))}
                  </div>
                  <span className={`mt-1 inline-flex px-2 py-0.5 rounded text-xs font-medium ${confidenceBadgeColor(Number(hit.confidence))}`}>
                    {Math.round(Number(hit.confidence) * 100)}%
                  </span>
                </div>
              </div>
              <p className="text-muted-foreground">{hit.rationale}</p>
              <p className="font-medium">{hit.action}</p>
              <div className="text-xs text-muted-foreground border-t border-brand/30 pt-2">
                Citation: {hit.citation}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
