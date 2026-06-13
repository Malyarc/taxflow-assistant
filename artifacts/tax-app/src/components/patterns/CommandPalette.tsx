/**
 * UX 2.0 (T2.3 D2) — ⌘K command palette. The firm-scale navigation primitive:
 * fuzzy-jump to any client (server search), run quick actions (new client,
 * navigate, toggle theme), and see recent clients when the box is empty.
 *
 * Controlled by the parent (App owns the open state + the global ⌘K listener)
 * so a topbar "Search" button and the keyboard shortcut share one instance.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { listClients, useGetRecentClients, getGetRecentClientsQueryKey } from "@workspace/api-client-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useTheme } from "@/design/theme";
import {
  LayoutDashboard, Users, Target, Building2, UserPlus, Moon, Sun, Monitor, FileText,
} from "lucide-react";

interface ClientLite {
  id: number; firstName: string; lastName: string; email?: string | null; state?: string | null; taxYear: number;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [, navigate] = useLocation();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 200);

  // Reset the query each time it opens, so it's never stale.
  useEffect(() => { if (open) setQuery(""); }, [open]);

  // Server-side client search (cmdk's own filtering is off; results are the truth).
  const { data: search } = useQuery({
    queryKey: ["cmdk-clients", debounced],
    queryFn: () => listClients({ limit: 8, q: debounced }),
    enabled: open && debounced.length > 0,
    staleTime: 30_000,
  });
  const { data: recent } = useGetRecentClients({ query: { enabled: open, queryKey: getGetRecentClientsQueryKey() } });

  const results = useMemo<ClientLite[]>(() => {
    if (debounced.length > 0) return (search?.items as ClientLite[] | undefined) ?? [];
    return ((recent as ClientLite[] | undefined) ?? []).slice(0, 6);
  }, [debounced, search, recent]);

  const go = (path: string) => { onOpenChange(false); navigate(path); };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput
        placeholder="Search clients or run a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading={debounced ? "Clients" : "Recent clients"}>
          {results.map((c) => (
            <CommandItem
              key={c.id}
              value={`client-${c.id}`}
              onSelect={() => go(`/clients/${c.id}`)}
            >
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{c.firstName} {c.lastName}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {c.state ?? "—"} · TY{c.taxYear}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Go to">
          <CommandItem value="nav today" onSelect={() => go("/")}>
            <LayoutDashboard className="h-4 w-4 text-muted-foreground" />Today
          </CommandItem>
          <CommandItem value="nav clients" onSelect={() => go("/clients")}>
            <Users className="h-4 w-4 text-muted-foreground" />Clients
          </CommandItem>
          <CommandItem value="nav planning" onSelect={() => go("/planning")}>
            <Target className="h-4 w-4 text-muted-foreground" />Planning
          </CommandItem>
          <CommandItem value="nav firm" onSelect={() => go("/firm")}>
            <Building2 className="h-4 w-4 text-muted-foreground" />Firm
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem value="new client" onSelect={() => go("/clients/new")}>
            <UserPlus className="h-4 w-4 text-muted-foreground" />New client
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem value="docs request" onSelect={() => go("/firm")}>
            <FileText className="h-4 w-4 text-muted-foreground" />Engagement board
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Theme">
          <CommandItem value="theme light" onSelect={() => { setTheme("light"); onOpenChange(false); }}>
            <Sun className="h-4 w-4 text-muted-foreground" />Light
          </CommandItem>
          <CommandItem value="theme dark" onSelect={() => { setTheme("dark"); onOpenChange(false); }}>
            <Moon className="h-4 w-4 text-muted-foreground" />Dark
          </CommandItem>
          <CommandItem value="theme system" onSelect={() => { setTheme("system"); onOpenChange(false); }}>
            <Monitor className="h-4 w-4 text-muted-foreground" />System
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
