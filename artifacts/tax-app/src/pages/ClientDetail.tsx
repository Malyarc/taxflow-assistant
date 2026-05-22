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
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
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

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
  qualifying_widow: "Qualifying Widow(er)",
};

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
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
    processing: "bg-blue-100 text-blue-800",
    pending_review: "bg-amber-100 text-amber-900",
    approved: "bg-green-100 text-green-800",
    extracted: "bg-green-100 text-green-800",
    rejected: "bg-gray-200 text-gray-700",
    failed: "bg-red-100 text-red-800",
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
                  <SelectItem value="form_1098">Form 1098</SelectItem>
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
                      className={`absolute cursor-pointer transition-all ${isHighlighted ? "border-2 border-amber-500 bg-amber-200/40 z-10" : "border border-blue-400 bg-blue-200/20 hover:bg-blue-200/30"}`}
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
                    isHighlighted ? "bg-amber-100" : hasBox ? "hover:bg-blue-50 cursor-pointer" : ""
                  }`}
                >
                  <span className={`text-muted-foreground ${!hasValue ? "italic" : ""}`}>{BOX_FIELD_LABELS[field] ?? field}</span>
                  <span className="font-mono font-semibold">
                    {field === "employeeSSN" && typeof val === "string" ? maskSSN(val) :
                      typeof val === "number" ? fmt(val) :
                      hasValue ? String(val) : "—"}
                    {hasBox && <span className="ml-2 text-[10px] text-blue-600">▣</span>}
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
                    flag.severity === "error" ? "bg-red-50 border-red-200 text-red-900" :
                    flag.severity === "warning" ? "bg-amber-50 border-amber-200 text-amber-900" :
                    "bg-blue-50 border-blue-200 text-blue-900";
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
          <div className={`rounded-lg p-6 border-2 ${isRefund ? "border-green-400 bg-green-50" : isOwed ? "border-amber-400 bg-amber-50" : "border-border bg-muted"}`}>
            <div className="text-sm font-medium text-muted-foreground mb-1">
              Federal {isRefund ? "Refund" : isOwed ? "Amount Owed" : "Balance"}
            </div>
            <div className={`text-4xl font-bold font-mono ${isRefund ? "text-green-700" : isOwed ? "text-amber-700" : "text-foreground"}`}>
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
                  ["Federal Withheld", taxReturn.federalTaxWithheld],
                  ["Federal Refund/Owed", taxReturn.federalRefundOrOwed],
                  ["State Tax", taxReturn.stateTaxLiability],
                  ["State Withheld", taxReturn.stateTaxWithheld],
                  ["State Refund/Owed", taxReturn.stateRefundOrOwed],
                ].map(([label, val]) => (
                  <div key={String(label)} className={`flex justify-between ${String(label).startsWith("  └─") ? "text-xs" : ""}`}>
                    <span className="text-muted-foreground">{String(label)}</span>
                    <span className={`font-mono font-semibold ${String(label).includes("Refund/Owed") && Number(val) > 0 ? "text-green-600" : String(label).includes("Refund/Owed") && Number(val) < 0 ? "text-amber-600" : ""}`}>
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
                      <span className="font-mono font-semibold text-green-700">{fmt(breakdown.data.childTaxCredit.appliedCredit)}</span>
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
              title="UltraTax CS .GEN format (1040 Generic Tax Data) — key=value text file"
              onClick={() => {
                const link = document.createElement("a");
                link.href = `/api/clients/${clientId}/tax-return/ultratax?taxYear=${taxYear}`;
                link.download = "";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
            >
              UltraTax (.gen)
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
                  <span className={`font-mono font-semibold ${isRefundLine ? (num > 0 ? "text-green-700" : num < 0 ? "text-amber-700" : "") : ""}`}>
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
                  <span className={`font-mono font-semibold ${isRefundLine ? (num > 0 ? "text-green-700" : num < 0 ? "text-amber-700" : "") : ""}`}>
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
                  <td className={`py-1.5 text-right font-semibold ${delta > 0 ? "text-green-700" : delta < 0 ? "text-amber-700" : ""}`}>
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
                    <div className="font-mono font-semibold">{rec.payerTin}</div>
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

  const TYPE_LABELS: Record<string, string> = {
    deduction: "Deduction (above-the-line)",
    credit: "Credit (non-refundable)",
    additional_income: "Additional Income",
    withholding_adjustment: "Withholding / Estimated Payment",
    self_employment_income: "Self-Employment Income",
    investment_income: "Investment Income (NIIT)",
    qbi_income: "Qualified Business Income (QBI)",
    amt_preferences: "AMT Preferences",
    // Schedule A line items (itemized deductions)
    medical_expenses: "Medical/Dental Expenses (Sched A)",
    state_income_tax: "State Income Tax (Sched A SALT)",
    state_property_tax: "State Property Tax (Sched A SALT)",
    state_sales_tax: "State Sales Tax (Sched A SALT alt)",
    mortgage_interest: "Mortgage Interest (Sched A)",
    charitable_cash: "Charitable Cash (Sched A)",
    charitable_property: "Charitable Property (Sched A)",
    // Above-the-line retirement / health
    hsa_contribution: "HSA Contribution",
    ira_contribution_traditional: "Traditional IRA Contribution",
    ira_contribution_roth: "Roth IRA Contribution",
    // Schedule C
    schedule_c_expenses: "Schedule C Business Expenses",
    // Credit-driving expenses
    dependent_care_expenses: "Dependent Care Expenses",
    qualified_education_expenses_aoc: "Education Expenses — AOC (per student)",
    qualified_education_expenses_llc: "Education Expenses — LLC",
    retirement_contributions_savers: "Retirement Contributions (Saver's Credit)",
    // Phase 1.5
    educator_expenses: "Educator Expenses (K-12, $300/educator)",
    student_loan_interest: "Student Loan Interest (1098-E)",
    foreign_tax_paid: "Foreign Tax Paid (1099-DIV Box 7)",
    residential_clean_energy: "Residential Clean Energy (§25D — solar/wind/geo, 30%)",
    energy_efficient_home: "Energy Efficient Home (§25C — windows/doors/insulation)",
    energy_efficient_heatpump: "Energy Efficient Heat Pump (§25C — heat pump/biomass)",
    ev_charger_property: "EV Charger Property (§30C — Form 8911)",
    // Phase 2
    capital_loss_carryforward_short: "Capital Loss Carryforward — Short-term (from prior year)",
    capital_loss_carryforward_long: "Capital Loss Carryforward — Long-term (from prior year)",
    schedule_e_rental_income: "Schedule E Rental Income (gross rents received)",
    schedule_e_rental_expenses: "Schedule E Rental Expenses (excl. depreciation)",
    schedule_e_macrs_depreciation: "Schedule E MACRS Depreciation",
    schedule_e_passive_loss_carryforward: "Schedule E Passive Loss Carryforward (prior year suspended)",
    other: "Other",
  };

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  return (
    <div className="space-y-4">
      {adjustments?.map((adj) => (
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
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold tracking-tight">{client.firstName} {client.lastName}</h2>
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
        <div className="flex gap-2">
          <Link href={`/clients/${clientId}/edit`}>
            <Button variant="outline">Edit Client</Button>
          </Link>
          <Link href="/clients">
            <Button variant="ghost">Back</Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="documents">
        <TabsList className="grid grid-cols-8 w-full max-w-5xl">
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="w2data">W-2 Data</TabsTrigger>
          <TabsTrigger value="form1099">1099 Forms</TabsTrigger>
          <TabsTrigger value="schedD">Schedule D</TabsTrigger>
          <TabsTrigger value="rentals">Rentals</TabsTrigger>
          <TabsTrigger value="calculator">Tax Calculator</TabsTrigger>
          <TabsTrigger value="compare">Year Compare</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
        </TabsList>

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
        <TabsContent value="calculator" className="mt-6">
          <TaxCalculatorTab clientId={clientId} taxYear={client.taxYear ?? 2024} />
        </TabsContent>
        <TabsContent value="compare" className="mt-6">
          <YearCompareTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="adjustments" className="mt-6">
          <AdjustmentsTab clientId={clientId} />
        </TabsContent>
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
