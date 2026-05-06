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
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
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
import { toast } from "@/hooks/use-toast";

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

// ─── Documents Tab ───────────────────────────────────────────────────────────

function DocumentsTab({ clientId }: { clientId: number }) {
  const { data: docs, isLoading } = useListDocuments(clientId, {
    query: { queryKey: getListDocumentsQueryKey(clientId) },
  });
  const upload = useUploadDocument();
  const deleteDoc = useDeleteDocument();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("w2");
  const [uploading, setUploading] = useState(false);

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
            qc.invalidateQueries({ queryKey: getListW2DataQueryKey(clientId) });
            toast({ title: "Document uploaded", description: "AI extraction running in background." });
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

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    processing: "bg-blue-100 text-blue-800",
    extracted: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
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
            For W-2 documents, AI extraction will auto-populate the W-2 Data tab.
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
                      {doc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
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
    </div>
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

function W2DataTab({ clientId }: { clientId: number }) {
  const { data: w2Records, isLoading } = useListW2Data(clientId, {
    query: { queryKey: getListW2DataQueryKey(clientId) },
  });
  const createW2 = useCreateW2Data();
  const updateW2 = useUpdateW2Data();
  const deleteW2 = useDeleteW2Data();
  const qc = useQueryClient();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<W2FormData>(blankW2Form());
  const [editForms, setEditForms] = useState<Record<number, W2FormData>>({});

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
            <Input
              value={form[key as keyof W2FormData]}
              onChange={(e) => onChange(key as keyof W2FormData, e.target.value)}
              type="number"
              step="0.01"
              placeholder="0.00"
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
              <CardTitle className="text-base">{rec.employerName ?? `W-2 #${rec.id}`} <span className="text-muted-foreground font-normal text-sm">— {rec.taxYear}</span></CardTitle>
              <div className="flex gap-2">
                {editingId === rec.id ? (
                  <>
                    <Button size="sm" onClick={() => saveEdit(rec.id)} disabled={updateW2.isPending}>Save</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={() => startEdit(rec.id)}>Edit</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDelete(rec.id)}>Delete</Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
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
    </div>
  );
}

// ─── Tax Calculator Tab ───────────────────────────────────────────────────────

function TaxCalculatorTab({ clientId, taxYear }: { clientId: number; taxYear: number }) {
  const { data: taxReturn, isLoading } = useGetTaxReturn(clientId, {
    query: { queryKey: getGetTaxReturnQueryKey(clientId), retry: false },
  });
  const calculate = useCalculateTaxReturn();
  const qc = useQueryClient();

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
              <Input value={additionalIncome} onChange={(e) => setAdditionalIncome(e.target.value)} type="number" step="0.01" placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Additional Deductions</Label>
              <Input value={additionalDeductions} onChange={(e) => setAdditionalDeductions(e.target.value)} type="number" step="0.01" placeholder="0.00" />
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
                  ["Federal Tax", taxReturn.federalTaxLiability],
                  ["Federal Withheld", taxReturn.federalTaxWithheld],
                  ["Federal Refund/Owed", taxReturn.federalRefundOrOwed],
                  ["State Tax", taxReturn.stateTaxLiability],
                  ["State Withheld", taxReturn.stateTaxWithheld],
                  ["State Refund/Owed", taxReturn.stateRefundOrOwed],
                ].map(([label, val]) => (
                  <div key={String(label)} className="flex justify-between">
                    <span className="text-muted-foreground">{String(label)}</span>
                    <span className={`font-mono font-semibold ${String(label).includes("Refund") && Number(val) > 0 ? "text-green-600" : String(label).includes("Refund") && Number(val) < 0 ? "text-amber-600" : ""}`}>
                      {fmt(Number(val))}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
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
    deduction: "Deduction",
    credit: "Credit",
    additional_income: "Additional Income",
    withholding_adjustment: "Withholding Adj.",
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
                    <Input type="number" step="0.01" value={editForms[adj.id]?.amount} onChange={(e) => setEditForms((p) => ({ ...p, [adj.id]: { ...(p[adj.id] ?? blankAdj()), amount: e.target.value } }))} />
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
                <Input type="number" step="0.01" value={newForm.amount} onChange={(e) => setNewForm((p) => ({ ...p, amount: e.target.value }))} placeholder="0.00" />
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
          <p className="text-muted-foreground mt-1">{client.email} {client.phone ? `· ${client.phone}` : ""} {client.state ? `· ${client.state}` : ""} · TY{client.taxYear}</p>
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
        <TabsList className="grid grid-cols-4 w-full max-w-xl">
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="w2data">W-2 Data</TabsTrigger>
          <TabsTrigger value="calculator">Tax Calculator</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-6">
          <DocumentsTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="w2data" className="mt-6">
          <W2DataTab clientId={clientId} />
        </TabsContent>
        <TabsContent value="calculator" className="mt-6">
          <TaxCalculatorTab clientId={clientId} taxYear={client.taxYear ?? 2024} />
        </TabsContent>
        <TabsContent value="adjustments" className="mt-6">
          <AdjustmentsTab clientId={clientId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
