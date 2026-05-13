import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useCreateClient,
  useGetClient,
  useUpdateClient,
  getListClientsQueryKey,
  getGetClientQueryKey,
  getGetTaxReturnQueryKey,
  getGetDashboardSummaryQueryKey,
} from "@workspace/api-client-react";
import type {
  CreateClientBodyFilingStatus,
  UpdateClientBodyFilingStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CurrencyInput } from "@/components/ui/currency-input";
import { toast } from "@/hooks/use-toast";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  filingStatus: string;
  state: string;
  taxYear: number;
  dependentsUnder17: number;
  otherDependents: number;
  // Phase 1 — drive saver's, dep care, IRA/HSA limits, education credits
  dependentsForCareCredit: number;
  taxpayerAge: number | "";
  spouseAge: number | "";
  spouseEarnedIncome: string;
  hsaIsFamilyCoverage: boolean;
  iraCoveredByWorkplacePlan: boolean;
  // Phase 1.5 — educator count, ACA PTC inputs
  eligibleEducatorCount: number;
  acaAnnualPremium: string;
  acaAnnualSlcsp: string;
  acaAdvanceAptc: string;
  acaHouseholdSize: number | "";
  notes: string;
}

const defaultForm: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  filingStatus: "single",
  state: "CA",
  taxYear: new Date().getFullYear() - 1,
  dependentsUnder17: 0,
  otherDependents: 0,
  dependentsForCareCredit: 0,
  taxpayerAge: "",
  spouseAge: "",
  spouseEarnedIncome: "",
  hsaIsFamilyCoverage: false,
  iraCoveredByWorkplacePlan: false,
  eligibleEducatorCount: 0,
  acaAnnualPremium: "",
  acaAnnualSlcsp: "",
  acaAdvanceAptc: "",
  acaHouseholdSize: "",
  notes: "",
};

interface Props {
  editId?: number;
}

export default function ClientForm({ editId }: Props) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const isEdit = editId != null;

  const { data: existing, isLoading } = useGetClient(editId!, {
    query: { enabled: isEdit, queryKey: getGetClientQueryKey(editId!) },
  });

  const createClient = useCreateClient();
  const updateClient = useUpdateClient();

  const [form, setForm] = useState<FormState>(defaultForm);

  useEffect(() => {
    if (existing) {
      const e = existing as typeof existing & {
        dependentsForCareCredit?: number;
        taxpayerAge?: number | null;
        spouseAge?: number | null;
        spouseEarnedIncome?: number | null;
        hsaIsFamilyCoverage?: boolean;
        iraCoveredByWorkplacePlan?: boolean;
      };
      setForm({
        firstName: existing.firstName || "",
        lastName: existing.lastName || "",
        email: existing.email || "",
        phone: existing.phone || "",
        filingStatus: existing.filingStatus || "single",
        // Use || (not ??) so empty strings fall back to default — Select component
        // doesn't display anything for empty value.
        state: existing.state || "CA",
        taxYear: existing.taxYear || new Date().getFullYear() - 1,
        dependentsUnder17: existing.dependentsUnder17 ?? 0,
        otherDependents: existing.otherDependents ?? 0,
        dependentsForCareCredit: e.dependentsForCareCredit ?? 0,
        taxpayerAge: e.taxpayerAge ?? "",
        spouseAge: e.spouseAge ?? "",
        spouseEarnedIncome: e.spouseEarnedIncome != null ? String(e.spouseEarnedIncome) : "",
        hsaIsFamilyCoverage: e.hsaIsFamilyCoverage ?? false,
        iraCoveredByWorkplacePlan: e.iraCoveredByWorkplacePlan ?? false,
        eligibleEducatorCount: e.eligibleEducatorCount ?? 0,
        acaAnnualPremium: e.acaAnnualPremium != null ? String(e.acaAnnualPremium) : "",
        acaAnnualSlcsp: e.acaAnnualSlcsp != null ? String(e.acaAnnualSlcsp) : "",
        acaAdvanceAptc: e.acaAdvanceAptc != null ? String(e.acaAdvanceAptc) : "",
        acaHouseholdSize: e.acaHouseholdSize ?? "",
        notes: existing.notes || "",
      });
    }
  }, [existing]);

  function set(k: keyof FormState, v: string | number | boolean) {
    // Radix Select can fire onValueChange with "" before SelectItems mount;
    // ignore that to prevent it from wiping a saved state value during initial render.
    if (k === "state" && v === "") return;
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email) {
      toast({ title: "Please fill in required fields", variant: "destructive" });
      return;
    }
    const payload = {
      ...form,
      taxYear: Number(form.taxYear),
      dependentsUnder17: Number(form.dependentsUnder17) || 0,
      otherDependents: Number(form.otherDependents) || 0,
      dependentsForCareCredit: Number(form.dependentsForCareCredit) || 0,
      taxpayerAge: form.taxpayerAge === "" ? null : Number(form.taxpayerAge),
      spouseAge: form.spouseAge === "" ? null : Number(form.spouseAge),
      spouseEarnedIncome: form.spouseEarnedIncome === "" ? null : Number(form.spouseEarnedIncome),
      hsaIsFamilyCoverage: Boolean(form.hsaIsFamilyCoverage),
      iraCoveredByWorkplacePlan: Boolean(form.iraCoveredByWorkplacePlan),
      eligibleEducatorCount: Number(form.eligibleEducatorCount) || 0,
      acaAnnualPremium: form.acaAnnualPremium === "" ? null : Number(form.acaAnnualPremium),
      acaAnnualSlcsp: form.acaAnnualSlcsp === "" ? null : Number(form.acaAnnualSlcsp),
      acaAdvanceAptc: form.acaAdvanceAptc === "" ? null : Number(form.acaAdvanceAptc),
      acaHouseholdSize: form.acaHouseholdSize === "" ? null : Number(form.acaHouseholdSize),
    };
    if (isEdit) {
      updateClient.mutate(
        { id: editId, data: { ...payload, filingStatus: payload.filingStatus as UpdateClientBodyFilingStatus } },
        {
          onSuccess: (client) => {
            // Set the cache to the response data immediately so navigation doesn't show stale data
            qc.setQueryData(getGetClientQueryKey(editId), client);
            // Invalidate so any other consumer refetches
            qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
            qc.invalidateQueries({ queryKey: getGetClientQueryKey(editId) });
            // Filing status / state / tax year changes affect the calculation — refresh tax return + dashboard
            qc.invalidateQueries({ queryKey: getGetTaxReturnQueryKey(editId) });
            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            toast({ title: "Client updated" });
            navigate(`/clients/${client.id}`);
          },
          onError: () => toast({ title: "Failed to update client", variant: "destructive" }),
        }
      );
    } else {
      createClient.mutate(
        { data: { ...payload, filingStatus: payload.filingStatus as CreateClientBodyFilingStatus } },
        {
          onSuccess: (client) => {
            qc.setQueryData(getGetClientQueryKey(client.id), client);
            qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            toast({ title: "Client created" });
            navigate(`/clients/${client.id}`);
          },
          onError: () => toast({ title: "Failed to create client", variant: "destructive" }),
        }
      );
    }
  }

  // Wait until existing has loaded AND useEffect has populated form, so the
  // Radix Select for state/filingStatus mounts with the correct controlled value.
  // Without this gate, Radix can fire onValueChange("") on initial render when
  // the value prop is set before SelectItem children are registered.
  const formReady = !isEdit || (existing != null && form.email === (existing.email ?? ""));
  if (isEdit && (isLoading || !formReady)) {
    return (
      <div className="p-8 max-w-2xl mx-auto space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  const isPending = createClient.isPending || updateClient.isPending;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-3xl font-bold tracking-tight">{isEdit ? "Edit Client" : "New Client"}</h2>
        <p className="text-muted-foreground mt-1">
          {isEdit ? "Update client information." : "Add a new client to your roster."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client Information</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name <span className="text-destructive">*</span></Label>
                <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="Sarah" />
              </div>
              <div className="space-y-2">
                <Label>Last Name <span className="text-destructive">*</span></Label>
                <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Johnson" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Email <span className="text-destructive">*</span></Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="sarah@example.com" />
            </div>

            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="555-234-5678" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Filing Status</Label>
                <Select value={form.filingStatus} onValueChange={(v) => set("filingStatus", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single</SelectItem>
                    <SelectItem value="married_filing_jointly">Married Filing Jointly</SelectItem>
                    <SelectItem value="married_filing_separately">Married Filing Separately</SelectItem>
                    <SelectItem value="head_of_household">Head of Household</SelectItem>
                    <SelectItem value="qualifying_widow">Qualifying Widow(er)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>State</Label>
                <Select value={form.state} onValueChange={(v) => set("state", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tax Year</Label>
              <Input
                type="number"
                value={form.taxYear}
                onChange={(e) => set("taxYear", Number(e.target.value))}
                min={2024}
                max={2025}
              />
              <p className="text-xs text-muted-foreground">Supported: 2024 and 2025.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Qualifying Children &lt; 17</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.dependentsUnder17}
                  onChange={(e) => set("dependentsUnder17", Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Drives Child Tax Credit ($2,000/child).</p>
              </div>
              <div className="space-y-2">
                <Label>Other Dependents</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.otherDependents}
                  onChange={(e) => set("otherDependents", Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Drives $500 Credit for Other Dependents.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Children for Dep Care Credit (≤ 12)</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.dependentsForCareCredit}
                  onChange={(e) => set("dependentsForCareCredit", Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Drives Dependent Care Credit (Form 2441).</p>
              </div>
              <div className="space-y-2">
                <Label>Spouse Earned Income</Label>
                <CurrencyInput
                  value={form.spouseEarnedIncome}
                  onChange={(v) => set("spouseEarnedIncome", v)}
                  placeholder="0.00"
                />
                <p className="text-xs text-muted-foreground">MFJ: spouse's portion of household wages. Used for Dep Care Credit earned-income split.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Taxpayer Age</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.taxpayerAge}
                  onChange={(e) => set("taxpayerAge", e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="e.g. 35"
                />
                <p className="text-xs text-muted-foreground">≥ 50 enables IRA catch-up; ≥ 55 enables HSA catch-up.</p>
              </div>
              <div className="space-y-2">
                <Label>Spouse Age</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.spouseAge}
                  onChange={(e) => set("spouseAge", e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="e.g. 33"
                />
                <p className="text-xs text-muted-foreground">For joint catch-up contribution limits.</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-2">
                <input
                  id="hsa-family"
                  type="checkbox"
                  className="mt-1"
                  checked={form.hsaIsFamilyCoverage}
                  onChange={(e) => set("hsaIsFamilyCoverage", e.target.checked)}
                />
                <Label htmlFor="hsa-family" className="font-normal">
                  HSA: Family coverage (vs self-only)
                  <p className="text-xs text-muted-foreground mt-1">Family limit $8,300 (2024) vs self-only $4,150.</p>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="ira-plan"
                  type="checkbox"
                  className="mt-1"
                  checked={form.iraCoveredByWorkplacePlan}
                  onChange={(e) => set("iraCoveredByWorkplacePlan", e.target.checked)}
                />
                <Label htmlFor="ira-plan" className="font-normal">
                  IRA: Covered by workplace retirement plan
                  <p className="text-xs text-muted-foreground mt-1">Triggers IRA deduction phase-out by AGI.</p>
                </Label>
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Phase 1.5: Educator + ACA PTC</h3>
                <p className="text-xs text-muted-foreground">Optional fields for educator expenses and ACA Premium Tax Credit reconciliation.</p>
              </div>

              <div className="space-y-2">
                <Label>Eligible Educator Count (0, 1, or 2)</Label>
                <Input
                  type="number"
                  min={0}
                  max={2}
                  step={1}
                  value={form.eligibleEducatorCount}
                  onChange={(e) => set("eligibleEducatorCount", Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">K-12 teacher/counselor/aide. Each eligible educator gets $300 above-the-line.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ACA: Annual Premium (Form 1095-A)</Label>
                  <CurrencyInput
                    value={form.acaAnnualPremium}
                    onChange={(v) => set("acaAnnualPremium", v)}
                    placeholder="0.00"
                  />
                  <p className="text-xs text-muted-foreground">Total annual Marketplace plan premium.</p>
                </div>
                <div className="space-y-2">
                  <Label>ACA: Annual SLCSP (Form 1095-A)</Label>
                  <CurrencyInput
                    value={form.acaAnnualSlcsp}
                    onChange={(v) => set("acaAnnualSlcsp", v)}
                    placeholder="0.00"
                  />
                  <p className="text-xs text-muted-foreground">Second Lowest Cost Silver Plan benchmark.</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>ACA: Advance APTC Received</Label>
                  <CurrencyInput
                    value={form.acaAdvanceAptc}
                    onChange={(v) => set("acaAdvanceAptc", v)}
                    placeholder="0.00"
                  />
                  <p className="text-xs text-muted-foreground">Advance Premium Tax Credit paid during year.</p>
                </div>
                <div className="space-y-2">
                  <Label>ACA: Household Size</Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={form.acaHouseholdSize}
                    onChange={(e) => set("acaHouseholdSize", e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="auto"
                  />
                  <p className="text-xs text-muted-foreground">For FPL%. Auto = filer + spouse (MFJ) + dependents.</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} placeholder="Any special circumstances or notes..." />
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving..." : isEdit ? "Save Changes" : "Create Client"}
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate(isEdit ? `/clients/${editId}` : "/clients")}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
