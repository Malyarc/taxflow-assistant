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
import { LOCALITY_OPTIONS } from "@/lib/localityLabels";

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
  /** T1.0f/M4 — children under 6 at year end (under-6 state CTCs). */
  childrenUnder6: number;
  otherDependents: number;
  // Phase 1 — drive saver's, dep care, IRA/HSA limits, education credits
  dependentsForCareCredit: number;
  taxpayerAge: number | "";
  spouseAge: number | "";
  taxpayerBlind: boolean;
  spouseBlind: boolean;
  spouseEarnedIncome: string;
  hsaIsFamilyCoverage: boolean;
  iraCoveredByWorkplacePlan: boolean;
  iraSpouseCoveredByWorkplacePlan: boolean;
  // Phase 1.5 — educator count, ACA PTC inputs
  eligibleEducatorCount: number;
  acaAnnualPremium: string;
  acaAnnualSlcsp: string;
  acaAdvanceAptc: string;
  acaHouseholdSize: number | "";
  // Phase 2e — Schedule E rental flags
  rentalActiveParticipant: boolean;
  rentalRealEstateProfessional: boolean;
  // BP2/E14 — local income tax jurisdiction code. "" = none.
  // Supported set: see LOCALITY_OPTIONS / engine LOCAL_TAX_DATA.
  localityCode: string;
  // K10 — Social Security benefits + MFS-lived-apart flag (Pub 915)
  socialSecurityBenefits: string;
  mfsLivedApartAllYear: boolean;
  // K8 — Kiddie tax (Form 8615)
  isKiddieTaxFiler: boolean;
  parentsTopMarginalRate: string;
  // E12 — Part-year residency
  residencyChangedInYear: boolean;
  formerState: string; // 2-letter state code, "" = none
  residencyChangeDate: string; // YYYY-MM-DD, "" = none
  // H9 — Client-context fields (planning personalization)
  riskTolerance: string; // "" | "conservative" | "moderate" | "aggressive"
  targetRetirementAge: string; // integer years as string; "" = unknown
  estatePlanStage: string; // "" | "none" | "will_only" | "trust_in_place" | "complex"
  planningGoals: string;
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
  childrenUnder6: 0,
  otherDependents: 0,
  dependentsForCareCredit: 0,
  taxpayerAge: "",
  spouseAge: "",
  taxpayerBlind: false,
  spouseBlind: false,
  spouseEarnedIncome: "",
  hsaIsFamilyCoverage: false,
  iraCoveredByWorkplacePlan: false,
  iraSpouseCoveredByWorkplacePlan: false,
  eligibleEducatorCount: 0,
  acaAnnualPremium: "",
  acaAnnualSlcsp: "",
  acaAdvanceAptc: "",
  acaHouseholdSize: "",
  rentalActiveParticipant: true,  // IRS default — most rental owners qualify
  rentalRealEstateProfessional: false,
  localityCode: "",
  socialSecurityBenefits: "",
  mfsLivedApartAllYear: false,
  isKiddieTaxFiler: false,
  parentsTopMarginalRate: "",
  residencyChangedInYear: false,
  formerState: "",
  residencyChangeDate: "",
  riskTolerance: "",
  targetRetirementAge: "",
  estatePlanStage: "",
  planningGoals: "",
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
  // Latches true once `existing` has hydrated `form` (edit mode). Gating the
  // Radix-Select mount on this — rather than on a live field comparison — keeps
  // the form mounted while the user edits (e.g. typing in Email).
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    if (existing) {
      const e = existing as typeof existing & {
        dependentsForCareCredit?: number;
        taxpayerAge?: number | null;
        spouseAge?: number | null;
        taxpayerBlind?: boolean | null;
        spouseBlind?: boolean | null;
        spouseEarnedIncome?: number | null;
        hsaIsFamilyCoverage?: boolean;
        iraCoveredByWorkplacePlan?: boolean;
        iraSpouseCoveredByWorkplacePlan?: boolean;
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
        childrenUnder6: existing.childrenUnder6 ?? 0,
        otherDependents: existing.otherDependents ?? 0,
        dependentsForCareCredit: e.dependentsForCareCredit ?? 0,
        taxpayerAge: e.taxpayerAge ?? "",
        spouseAge: e.spouseAge ?? "",
        taxpayerBlind: e.taxpayerBlind ?? false,
        spouseBlind: e.spouseBlind ?? false,
        spouseEarnedIncome: e.spouseEarnedIncome != null ? String(e.spouseEarnedIncome) : "",
        hsaIsFamilyCoverage: e.hsaIsFamilyCoverage ?? false,
        iraCoveredByWorkplacePlan: e.iraCoveredByWorkplacePlan ?? false,
        iraSpouseCoveredByWorkplacePlan: e.iraSpouseCoveredByWorkplacePlan ?? false,
        eligibleEducatorCount: e.eligibleEducatorCount ?? 0,
        acaAnnualPremium: e.acaAnnualPremium != null ? String(e.acaAnnualPremium) : "",
        acaAnnualSlcsp: e.acaAnnualSlcsp != null ? String(e.acaAnnualSlcsp) : "",
        acaAdvanceAptc: e.acaAdvanceAptc != null ? String(e.acaAdvanceAptc) : "",
        acaHouseholdSize: e.acaHouseholdSize ?? "",
        rentalActiveParticipant: e.rentalActiveParticipant ?? true,
        rentalRealEstateProfessional: e.rentalRealEstateProfessional ?? false,
        localityCode: (existing as { localityCode?: string | null }).localityCode ?? "",
        socialSecurityBenefits: (existing as { socialSecurityBenefits?: number | null }).socialSecurityBenefits != null
          ? String((existing as { socialSecurityBenefits?: number | null }).socialSecurityBenefits) : "",
        mfsLivedApartAllYear: (existing as { mfsLivedApartAllYear?: boolean }).mfsLivedApartAllYear ?? false,
        isKiddieTaxFiler: (existing as { isKiddieTaxFiler?: boolean }).isKiddieTaxFiler ?? false,
        parentsTopMarginalRate: (existing as { parentsTopMarginalRate?: number | null }).parentsTopMarginalRate != null
          ? String((existing as { parentsTopMarginalRate?: number | null }).parentsTopMarginalRate) : "",
        residencyChangedInYear: (existing as { residencyChangedInYear?: boolean }).residencyChangedInYear ?? false,
        formerState: (existing as { formerState?: string | null }).formerState ?? "",
        residencyChangeDate: (existing as { residencyChangeDate?: string | null }).residencyChangeDate ?? "",
        riskTolerance: (existing as { riskTolerance?: string | null }).riskTolerance ?? "",
        targetRetirementAge:
          (existing as { targetRetirementAge?: number | null }).targetRetirementAge != null
            ? String((existing as { targetRetirementAge?: number | null }).targetRetirementAge)
            : "",
        estatePlanStage: (existing as { estatePlanStage?: string | null }).estatePlanStage ?? "",
        planningGoals: (existing as { planningGoals?: string | null }).planningGoals ?? "",
        notes: existing.notes || "",
      });
      setHasHydrated(true);
    }
  }, [existing]);

  function set(k: keyof FormState, v: string | number | boolean) {
    // Radix Select can fire onValueChange with "" before SelectItems mount;
    // ignore that to prevent it from wiping a saved state value during initial render.
    if (k === "state" && v === "") return;
    setForm((f) => {
      const next = { ...f, [k]: v };
      // E14 — When state changes, clear localityCode if it's no longer valid
      // for the new state (prevents phantom local tax from stale code).
      if (k === "state" && typeof v === "string" && next.localityCode) {
        const options = LOCALITY_OPTIONS[v] ?? [];
        const stillValid = options.some((o) => o.code === next.localityCode);
        if (!stillValid) next.localityCode = "";
      }
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email) {
      toast({ title: "Please fill in required fields", variant: "destructive" });
      return;
    }
    // The email Input is type="email" but that's only enforced by native form
    // submission — guard the value so "abc" can't reach the API.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast({ title: "Please enter a valid email address", variant: "destructive" });
      return;
    }
    const payload = {
      ...form,
      taxYear: Number(form.taxYear),
      dependentsUnder17: Number(form.dependentsUnder17) || 0,
      childrenUnder6: Number(form.childrenUnder6) || 0,
      otherDependents: Number(form.otherDependents) || 0,
      dependentsForCareCredit: Number(form.dependentsForCareCredit) || 0,
      taxpayerAge: form.taxpayerAge === "" ? null : Number(form.taxpayerAge),
      spouseAge: form.spouseAge === "" ? null : Number(form.spouseAge),
      taxpayerBlind: Boolean(form.taxpayerBlind),
      spouseBlind: Boolean(form.spouseBlind),
      spouseEarnedIncome: form.spouseEarnedIncome === "" ? null : Number(form.spouseEarnedIncome),
      hsaIsFamilyCoverage: Boolean(form.hsaIsFamilyCoverage),
      iraCoveredByWorkplacePlan: Boolean(form.iraCoveredByWorkplacePlan),
      iraSpouseCoveredByWorkplacePlan: Boolean(form.iraSpouseCoveredByWorkplacePlan),
      eligibleEducatorCount: Number(form.eligibleEducatorCount) || 0,
      acaAnnualPremium: form.acaAnnualPremium === "" ? null : Number(form.acaAnnualPremium),
      acaAnnualSlcsp: form.acaAnnualSlcsp === "" ? null : Number(form.acaAnnualSlcsp),
      acaAdvanceAptc: form.acaAdvanceAptc === "" ? null : Number(form.acaAdvanceAptc),
      acaHouseholdSize: form.acaHouseholdSize === "" ? null : Number(form.acaHouseholdSize),
      rentalActiveParticipant: Boolean(form.rentalActiveParticipant),
      rentalRealEstateProfessional: Boolean(form.rentalRealEstateProfessional),
      localityCode: form.localityCode === "" ? null : form.localityCode,
      socialSecurityBenefits: form.socialSecurityBenefits === "" ? null : Number(form.socialSecurityBenefits),
      mfsLivedApartAllYear: Boolean(form.mfsLivedApartAllYear),
      isKiddieTaxFiler: Boolean(form.isKiddieTaxFiler),
      parentsTopMarginalRate: form.parentsTopMarginalRate === "" ? null : Number(form.parentsTopMarginalRate),
      residencyChangedInYear: Boolean(form.residencyChangedInYear),
      formerState: form.formerState === "" ? null : form.formerState,
      residencyChangeDate: form.residencyChangeDate === "" ? null : form.residencyChangeDate,
      riskTolerance: form.riskTolerance === "" ? null : form.riskTolerance,
      targetRetirementAge: form.targetRetirementAge === "" ? null : Number(form.targetRetirementAge),
      estatePlanStage: form.estatePlanStage === "" ? null : form.estatePlanStage,
      planningGoals: form.planningGoals === "" ? null : form.planningGoals,
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
  // Gate on the one-time hydration latch (NOT a live field comparison, which
  // would collapse the form back to a skeleton mid-edit — e.g. editing Email).
  const formReady = !isEdit || hasHydrated;
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

            {(LOCALITY_OPTIONS[form.state] ?? []).length > 0 && (
              <div className="space-y-2">
                <Label>Local income tax jurisdiction</Label>
                <Select value={form.localityCode || "none"} onValueChange={(v) => set("localityCode", v === "none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(LOCALITY_OPTIONS[form.state] ?? []).map((o) => (
                      <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {form.state === "NY" && "NYC residents owe NYC personal income tax on top of NY state tax (IT-201 brackets, household credit, EITC, school credit, MCTMT). NYC UBT not modeled."}
                  {form.state === "MD" && "All MD residents pay a county income tax (flat rate 2.25%–3.20%) computed on MD-taxable income. Verify the current-year rate against the Maryland Comptroller's published table before filing."}
                  {form.state === "OH" && "OH municipal income tax — rate × wages earned in the city of residence. Cross-city employment credit not modeled (sub-gap)."}
                  {form.state === "IN" && "IN county income tax (CAGIT/COIT) on Indiana-taxable income. Rates change annually — verify against Departmental Notice #1."}
                </p>
              </div>
            )}

            <div className="space-y-2 rounded-md border border-muted p-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="residencyChangedInYear"
                  checked={form.residencyChangedInYear}
                  onChange={(e) => set("residencyChangedInYear", e.target.checked)}
                  className="h-4 w-4"
                />
                <Label htmlFor="residencyChangedInYear" className="cursor-pointer">
                  Moved between states during the tax year (part-year resident)
                </Label>
              </div>
              {form.residencyChangedInYear && (
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-2">
                    <Label>Former state (before move)</Label>
                    <Select value={form.formerState || "none"} onValueChange={(v) => set("formerState", v === "none" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Select —</SelectItem>
                        {US_STATES.filter((s) => s !== form.state).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Residency change date</Label>
                    <Input
                      type="date"
                      value={form.residencyChangeDate}
                      onChange={(e) => set("residencyChangeDate", e.target.value)}
                      min={`${form.taxYear}-01-01`}
                      max={`${form.taxYear}-12-31`}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                E12 — Engine pro-rates AGI by days and computes resident-state tax for each period. Locality (NYC, MD/OH/IN local) is skipped on part-year returns.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Tax Year</Label>
              <Input
                type="number"
                value={form.taxYear}
                onChange={(e) => set("taxYear", Number(e.target.value))}
                min={2024}
                max={2026}
              />
              <p className="text-xs text-muted-foreground">Supported: 2024, 2025, and 2026.</p>
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
                <p className="text-xs text-muted-foreground">Drives Child Tax Credit ($2,000/child TY2024; $2,200/child TY2025+).</p>
              </div>
              <div className="space-y-2">
                <Label>Children &lt; 6</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.childrenUnder6}
                  onChange={(e) => set("childrenUnder6", Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Subset of &lt;17 — drives under-6 state CTCs (CA/NJ/VT/CO).</p>
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
                  id="taxpayer-blind"
                  type="checkbox"
                  className="mt-1"
                  checked={form.taxpayerBlind}
                  onChange={(e) => set("taxpayerBlind", e.target.checked)}
                />
                <Label htmlFor="taxpayer-blind" className="font-normal">
                  Taxpayer is legally blind
                  <p className="text-xs text-muted-foreground mt-1">Extra standard-deduction box (IRC §63(f)): +$1,950 single/HoH, +$1,550 MFJ/MFS (2024).</p>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <input
                  id="spouse-blind"
                  type="checkbox"
                  className="mt-1"
                  checked={form.spouseBlind}
                  onChange={(e) => set("spouseBlind", e.target.checked)}
                />
                <Label htmlFor="spouse-blind" className="font-normal">
                  Spouse is legally blind (MFJ/QSS)
                  <p className="text-xs text-muted-foreground mt-1">Counts only on a joint return — adds the spouse's blind box.</p>
                </Label>
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
              <div className="flex items-start gap-2">
                <input
                  id="ira-spouse-plan"
                  type="checkbox"
                  className="mt-1"
                  checked={form.iraSpouseCoveredByWorkplacePlan}
                  onChange={(e) => set("iraSpouseCoveredByWorkplacePlan", e.target.checked)}
                />
                <Label htmlFor="ira-spouse-plan" className="font-normal">
                  IRA: Spouse covered (you are not) — §219(g)(7)
                  <p className="text-xs text-muted-foreground mt-1">Higher MFJ/QSS phase-out band ($230k–$240k for 2024).</p>
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

            <div className="border-t pt-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Social Security Benefits (Pub 915)</h3>
                <p className="text-xs text-muted-foreground">For retirees / disability filers. Engine computes 0/50/85% taxable portion (Form 1040 Line 6a/6b).</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Social Security Benefits (SSA-1099 Box 5)</Label>
                  <CurrencyInput
                    value={form.socialSecurityBenefits}
                    onChange={(v) => set("socialSecurityBenefits", v)}
                    placeholder="0.00"
                  />
                  <p className="text-xs text-muted-foreground">Total SSA-1099 + RRB-1099 benefits received during the year.</p>
                </div>
                {form.filingStatus === "married_filing_separately" && (
                  <div className="flex items-start gap-2">
                    <input
                      id="mfs-lived-apart"
                      type="checkbox"
                      className="mt-1"
                      checked={form.mfsLivedApartAllYear}
                      onChange={(e) => set("mfsLivedApartAllYear", e.target.checked)}
                    />
                    <Label htmlFor="mfs-lived-apart" className="font-normal">
                      MFS lived apart from spouse ALL year
                      <p className="text-xs text-muted-foreground mt-1">If unchecked: $0 SS-taxability threshold (85% of SS taxable). If checked: uses single thresholds.</p>
                    </Label>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Kiddie Tax (Form 8615)</h3>
                <p className="text-xs text-muted-foreground">For child returns. Net unearned income above $2,600 (TY2024) is taxed at the parent's top marginal rate.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-start gap-2">
                  <input
                    id="kiddie-tax-filer"
                    type="checkbox"
                    className="mt-1"
                    checked={form.isKiddieTaxFiler}
                    onChange={(e) => set("isKiddieTaxFiler", e.target.checked)}
                  />
                  <Label htmlFor="kiddie-tax-filer" className="font-normal">
                    Child subject to kiddie tax
                    <p className="text-xs text-muted-foreground mt-1">Check when this return is for a child under 18 (or 18–23 if FT student) with unearned income.</p>
                  </Label>
                </div>
                {form.isKiddieTaxFiler && (
                  <div className="space-y-2">
                    <Label>Parent's top marginal rate</Label>
                    <Select value={form.parentsTopMarginalRate || ""} onValueChange={(v) => set("parentsTopMarginalRate", v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select rate" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.10">10%</SelectItem>
                        <SelectItem value="0.12">12%</SelectItem>
                        <SelectItem value="0.22">22%</SelectItem>
                        <SelectItem value="0.24">24%</SelectItem>
                        <SelectItem value="0.32">32%</SelectItem>
                        <SelectItem value="0.35">35%</SelectItem>
                        <SelectItem value="0.37">37%</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Used in the Form 8615 worksheet to tax kiddie-tax amount at parent rate.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">Phase 2: Schedule E Rental Real Estate</h3>
                <p className="text-xs text-muted-foreground">§469 participation flags (drives passive loss deductibility).</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-start gap-2">
                  <input
                    id="rental-active"
                    type="checkbox"
                    className="mt-1"
                    checked={form.rentalActiveParticipant}
                    onChange={(e) => set("rentalActiveParticipant", e.target.checked)}
                  />
                  <Label htmlFor="rental-active" className="font-normal">
                    Active participant in rental
                    <p className="text-xs text-muted-foreground mt-1">Enables $25k special allowance ($12.5k MFS) with MAGI $100k–$150k phase-out.</p>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <input
                    id="rental-pro"
                    type="checkbox"
                    className="mt-1"
                    checked={form.rentalRealEstateProfessional}
                    onChange={(e) => set("rentalRealEstateProfessional", e.target.checked)}
                  />
                  <Label htmlFor="rental-pro" className="font-normal">
                    Real estate professional (§469(c)(7))
                    <p className="text-xs text-muted-foreground mt-1">750+ hours/year AND &gt; 50% of total work time → no passive loss limit.</p>
                  </Label>
                </div>
              </div>
            </div>

            {/* Phase H — H9 client-context fields for planning personalization */}
            <div className="space-y-3 rounded border border-brand/30 bg-brand/5 p-4">
              <div className="text-sm font-medium text-primary">
                Planning context (Phase H — H9)
              </div>
              <p className="text-xs text-brand-ink">
                Optional fields that personalize the AI planning memo. Leave blank if not gathered yet.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="riskTolerance">Risk tolerance</Label>
                  <select
                    id="riskTolerance"
                    value={form.riskTolerance}
                    onChange={(e) => set("riskTolerance", e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    <option value="">— Unknown —</option>
                    <option value="conservative">Conservative</option>
                    <option value="moderate">Moderate</option>
                    <option value="aggressive">Aggressive</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="targetRetirementAge">Target retirement age</Label>
                  <Input
                    id="targetRetirementAge"
                    type="number"
                    min="40"
                    max="90"
                    placeholder="e.g. 65"
                    value={form.targetRetirementAge}
                    onChange={(e) => set("targetRetirementAge", e.target.value)}
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="estatePlanStage">Estate plan stage</Label>
                  <select
                    id="estatePlanStage"
                    value={form.estatePlanStage}
                    onChange={(e) => set("estatePlanStage", e.target.value)}
                    className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  >
                    <option value="">— Unknown —</option>
                    <option value="none">None</option>
                    <option value="will_only">Will only</option>
                    <option value="trust_in_place">Trust in place</option>
                    <option value="complex">Complex (multi-entity)</option>
                  </select>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="planningGoals">Planning goals (free text)</Label>
                  <Textarea
                    id="planningGoals"
                    value={form.planningGoals}
                    onChange={(e) => set("planningGoals", e.target.value)}
                    rows={3}
                    placeholder={`e.g. "Early retirement at 55", "Fund kid's college via 529", "Buy a house in 2 years"`}
                  />
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
