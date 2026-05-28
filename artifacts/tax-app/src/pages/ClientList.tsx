import { useState } from "react";
import { Link } from "wouter";
import { useListClients, useDeleteClient } from "@workspace/api-client-react";
import { getListClientsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Plus, Search } from "lucide-react";

const FILING_STATUS_LABELS: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "MFJ",
  married_filing_separately: "MFS",
  head_of_household: "HoH",
  qualifying_widow: "QW",
};

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
];

export default function ClientList() {
  const { data: clients, isLoading } = useListClients();
  const deleteClient = useDeleteClient();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = (clients ?? []).filter((c) => {
    const name = `${c.firstName} ${c.lastName}`.toLowerCase();
    const matchSearch = search === "" || name.includes(search.toLowerCase()) || c.email.includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || c.filingStatus === statusFilter;
    return matchSearch && matchStatus;
  });

  function handleDelete(id: number, name: string) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    deleteClient.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
          toast({ title: "Client deleted" });
        },
      }
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Clients</h2>
          <p className="text-muted-foreground mt-1">
            {isLoading ? "Loading..." : `${filtered.length} client${filtered.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Link href="/clients/new">
          <Button><Plus className="mr-1.5 h-4 w-4" strokeWidth={2.5} />New Client</Button>
        </Link>
      </div>

      <div className="flex gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filing status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="single">Single</SelectItem>
            <SelectItem value="married_filing_jointly">Married Filing Jointly</SelectItem>
            <SelectItem value="married_filing_separately">Married Filing Separately</SelectItem>
            <SelectItem value="head_of_household">Head of Household</SelectItem>
            <SelectItem value="qualifying_widow">Qualifying Widow(er)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {search || statusFilter !== "all" ? "No clients match your filters." : "No clients yet. Add your first client to get started."}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filing Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">State</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tax Year</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((client) => (
                <tr key={client.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-4">
                    <div className="font-semibold">{client.firstName} {client.lastName}</div>
                    <div className="text-sm text-muted-foreground">{client.email}</div>
                  </td>
                  <td className="px-4 py-4">
                    <Badge variant="outline">{FILING_STATUS_LABELS[client.filingStatus] ?? client.filingStatus}</Badge>
                  </td>
                  <td className="px-4 py-4 text-sm font-mono">{client.state ?? "—"}</td>
                  <td className="px-4 py-4 text-sm font-mono">{client.taxYear}</td>
                  <td className="px-4 py-4 text-right space-x-2">
                    <Link href={`/clients/${client.id}`}>
                      <Button variant="outline" size="sm">Open</Button>
                    </Link>
                    <Link href={`/clients/${client.id}/edit`}>
                      <Button variant="ghost" size="sm">Edit</Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(client.id, `${client.firstName} ${client.lastName}`)}
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
