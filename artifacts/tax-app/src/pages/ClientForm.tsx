import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import {
  useCreateClient,
  useGetClient,
  useUpdateClient,
  getListClientsQueryKey,
  getGetClientQueryKey,
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
      setForm({
        firstName: existing.firstName ?? "",
        lastName: existing.lastName ?? "",
        email: existing.email ?? "",
        phone: existing.phone ?? "",
        filingStatus: existing.filingStatus ?? "single",
        state: existing.state ?? "CA",
        taxYear: existing.taxYear ?? new Date().getFullYear() - 1,
        notes: existing.notes ?? "",
      });
    }
  }, [existing]);

  function set(k: keyof FormState, v: string | number) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email) {
      toast({ title: "Please fill in required fields", variant: "destructive" });
      return;
    }
    const payload = { ...form, taxYear: Number(form.taxYear) };
    if (isEdit) {
      updateClient.mutate(
        { id: editId, data: { ...payload, filingStatus: payload.filingStatus as UpdateClientBodyFilingStatus } },
        {
          onSuccess: (client) => {
            qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
            qc.invalidateQueries({ queryKey: getGetClientQueryKey(editId) });
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
            qc.invalidateQueries({ queryKey: getListClientsQueryKey() });
            toast({ title: "Client created" });
            navigate(`/clients/${client.id}`);
          },
          onError: () => toast({ title: "Failed to create client", variant: "destructive" }),
        }
      );
    }
  }

  if (isEdit && isLoading) {
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
                min={2020}
                max={2025}
              />
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
