/**
 * UX 2.0 (T2.3 D3/D4) — the return review workspace.
 *
 * A prep-software-grade 3-pane surface (a DEMO of the design system, not an SPA
 * rewrite — the source-entry tabs still live on ClientDetail):
 *   • left rail  — the form tree (1040 + schedules) with per-form tie-out status
 *   • center     — the dense, keyboard-navigable line-item grid; ↑/↓ move, Enter
 *                  opens "why this number" provenance (D4)
 *   • right rail — pre-filing diagnostics + the document-request tracker (D6)
 *
 * The grid + provenance are driven by lib/returnModel (pure), so every figure
 * traces to the engine identity that produced it and ties out by construction.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useGetClient, useGetTaxReturn, getGetTaxReturnQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProvenanceList } from "@/components/patterns/Provenance";
import { Money } from "@/components/patterns/Money";
import { StatusPill, engagementStatusMeta } from "@/components/patterns/StatusPill";
import { DocRequestTracker } from "@/components/patterns/DocRequestTracker";
import { buildReturnModel, type FormNode } from "@/lib/returnModel";
import { authHeaders } from "@/lib/apiAuth";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Check, TriangleAlert, Info, AlertCircle, CheckCircle2, FileSpreadsheet, Keyboard,
} from "lucide-react";

type Severity = "critical" | "warning" | "info";
interface ReturnDiagnostic { id: string; severity: Severity; category: string; title: string; detail: string }
interface DiagnosticsResult { diagnostics: ReturnDiagnostic[]; counts: { critical: number; warning: number; info: number; total: number }; readyToHandOff: boolean }

export default function ReturnReview({ params }: { params: { id: string } }) {
  const clientId = Number(params.id);
  const [, navigate] = useLocation();
  const { data: client } = useGetClient(clientId);
  const { data: taxReturn, isLoading } = useGetTaxReturn(clientId, {
    query: { queryKey: getGetTaxReturnQueryKey(clientId), retry: false },
  });
  const taxYear = client?.taxYear;

  const forms = useMemo<FormNode[]>(() => (taxReturn ? buildReturnModel(taxReturn as never) : []), [taxReturn]);
  const [activeForm, setActiveForm] = useState<string>("1040");
  const current = forms.find((f) => f.id === activeForm) ?? forms[0];

  // Keep the selected form valid as data loads.
  useEffect(() => {
    if (forms.length && !forms.some((f) => f.id === activeForm)) setActiveForm(forms[0].id);
  }, [forms, activeForm]);

  const diagnostics = useQuery<DiagnosticsResult>({
    queryKey: ["diagnostics", clientId, taxYear],
    enabled: taxYear != null,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/tax-return/diagnostics?taxYear=${taxYear}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Diagnostics failed");
      return res.json();
    },
  });

  const tiedCount = forms.filter((f) => f.tiesOut).length;

  return (
    <div className="flex h-full flex-col">
      {/* Header strip */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-5 py-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back to client" onClick={() => navigate(`/clients/${clientId}`)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <div className="t-eyebrow text-brand-ink">Return review workspace</div>
          <div className="truncate text-base font-semibold">
            {client ? `${client.firstName} ${client.lastName}` : "Loading…"}
            {client && <span className="ml-2 text-sm font-normal text-muted-foreground">{client.state ?? "—"} · TY{client.taxYear}</span>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {taxReturn?.engagementStatus && (
            <StatusPill {...(engagementStatusMeta[taxReturn.engagementStatus] ?? { tone: "neutral", label: taxReturn.engagementStatus })} />
          )}
          {forms.length > 0 && (
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", tiedCount === forms.length ? "bg-success/12 text-success" : "bg-gold/15 text-gold-foreground")}>
              {tiedCount === forms.length ? <Check className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
              {tiedCount}/{forms.length} forms tie out
            </span>
          )}
          <Link href={`/clients/${clientId}`}><Button variant="outline" size="sm">Edit inputs</Button></Link>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8"><Skeleton className="h-96 w-full" /></div>
      ) : !taxReturn ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-sm text-sm text-muted-foreground">
            No computed return yet. Open the client and run <span className="font-medium text-foreground">Calculate Return</span> to populate the workspace.
            <div className="mt-3"><Link href={`/clients/${clientId}`}><Button size="sm">Go to client</Button></Link></div>
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[224px_1fr_320px] lg:overflow-hidden">
          {/* Left rail — form tree */}
          <nav aria-label="Forms" className="border-b lg:border-b-0 lg:border-r lg:overflow-y-auto">
            <div className="p-3">
              <div className="t-eyebrow px-2 pb-2 text-muted-foreground">Forms & schedules</div>
              <ul className="space-y-0.5">
                {forms.map((f) => {
                  const active = f.id === current?.id;
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => setActiveForm(f.id)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                          active ? "bg-accent font-medium text-accent-foreground" : "hover:bg-accent/60",
                        )}
                      >
                        {f.tiesOut ? <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Ties out" /> : <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-gold-foreground" aria-label="Does not tie out" />}
                        <span className="min-w-0">
                          <span className="block truncate">{f.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{f.caption}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </nav>

          {/* Center — line-item grid */}
          <section aria-label="Line items" className="lg:overflow-y-auto">
            {current && <LineGrid form={current} />}
          </section>

          {/* Right rail — diagnostics + doc requests */}
          <aside aria-label="Diagnostics" className="border-t lg:border-t-0 lg:border-l lg:overflow-y-auto">
            <div className="space-y-5 p-4">
              <DiagnosticsPanel data={diagnostics.data} error={diagnostics.error as Error | null} />
              <div>
                <div className="t-eyebrow mb-2 text-brand-ink">Document requests</div>
                <DocRequestTracker clientId={clientId} compact />
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

/** The dense, keyboard-navigable line grid for one form. */
function LineGrid({ form }: { form: FormNode }) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);
  // Mirror the active index in a ref so the keydown handler reads a CURRENT
  // value (state is async/batched — rapid arrow presses would otherwise stall).
  const activeRef = useRef(0);
  const [openRow, setOpenRow] = useState<number | null>(null);

  // Reset selection when the form changes.
  useEffect(() => { setActive(0); activeRef.current = 0; setOpenRow(null); }, [form.id]);

  const focusRow = (i: number) => {
    const clamped = Math.max(0, Math.min(form.lines.length - 1, i));
    activeRef.current = clamped;
    setActive(clamped);
    rowRefs.current[clamped]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = activeRef.current;
    if (e.key === "ArrowDown") { e.preventDefault(); focusRow(cur + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusRow(cur - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusRow(0); }
    else if (e.key === "End") { e.preventDefault(); focusRow(form.lines.length - 1); }
    else if (e.key === "Enter" || e.key === " ") {
      if (form.lines[cur]?.chain) { e.preventDefault(); setOpenRow(cur); }
    }
  };

  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/10 text-brand-ink"><FileSpreadsheet className="h-4 w-4" /></span>
          <div>
            <div className="text-base font-semibold">{form.name}</div>
            <div className="text-xs text-muted-foreground">{form.caption}</div>
          </div>
        </div>
        <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:inline-flex">
          <Keyboard className="h-3.5 w-3.5" /> ↑↓ move · Enter explains
        </span>
      </div>

      <div role="grid" aria-label={`${form.name} line items`} className="overflow-hidden rounded-lg border" onKeyDown={onKeyDown}>
        {form.lines.map((line, i) => {
          const hasChain = !!line.chain;
          const row = (
            <div
              ref={(el) => { rowRefs.current[i] = el; }}
              role="row"
              tabIndex={i === active ? 0 : -1}
              onFocus={() => { activeRef.current = i; setActive(i); }}
              onClick={() => { if (hasChain) setOpenRow(i); }}
              className={cn(
                "grid grid-cols-[3rem_1fr_auto] items-center gap-3 border-b px-3 py-2 text-sm outline-none transition-colors last:border-b-0",
                i === active ? "bg-accent/70" : "hover:bg-accent/40",
                line.emphasis && "font-semibold",
                hasChain && "cursor-pointer",
              )}
            >
              <span className="t-num text-xs tabular-nums text-muted-foreground">{line.lineRef}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{line.label}</span>
                {hasChain && <Info className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-label="Has provenance" />}
              </span>
              <Money value={line.value} tone={line.tone} className={cn("text-right", line.emphasis && "font-semibold")} />
            </div>
          );
          if (!hasChain) return <div key={i}>{row}</div>;
          return (
            <Popover key={i} open={openRow === i} onOpenChange={(o) => setOpenRow(o ? i : null)}>
              <PopoverTrigger asChild>{row}</PopoverTrigger>
              <PopoverContent className="w-80" align="end" collisionPadding={16}>
                <ProvenanceList chain={line.chain!} />
              </PopoverContent>
            </Popover>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Rows with an <Info className="mb-0.5 inline h-3 w-3" /> trace to the engine identity that produced them — click or press Enter to see the source chain.
      </p>
    </div>
  );
}

function DiagnosticsPanel({ data, error }: { data?: DiagnosticsResult; error: Error | null }) {
  const STYLE: Record<Severity, { icon: typeof Info; cls: string }> = {
    critical: { icon: AlertCircle, cls: "border-destructive/40 bg-destructive/5 text-destructive" },
    warning: { icon: TriangleAlert, cls: "border-gold/40 bg-gold/10 text-gold-foreground" },
    info: { icon: Info, cls: "border-brand/30 bg-brand/5 text-brand-ink" },
  };
  return (
    <div>
      <div className="t-eyebrow mb-2 text-brand-ink">Pre-filing diagnostics</div>
      {error ? (
        <p className="text-xs text-destructive">Couldn't load diagnostics.</p>
      ) : !data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="space-y-2">
          <div className={cn("flex items-center gap-2 rounded-md border p-3", data.readyToHandOff ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5")}>
            {data.readyToHandOff ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4 text-destructive" />}
            <div className="text-sm font-medium">
              {data.readyToHandOff ? "Ready to hand off" : `${data.counts.critical} critical to resolve`}
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{data.counts.critical} critical · {data.counts.warning} warning · {data.counts.info} info</div>
          {data.diagnostics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No issues detected.</p>
          ) : (
            <ul className="space-y-1.5">
              {data.diagnostics.slice(0, 12).map((d) => {
                const s = STYLE[d.severity];
                const Icon = s.icon;
                return (
                  <li key={d.id} className={cn("rounded-md border p-2.5", s.cls)}>
                    <div className="flex items-start gap-2">
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{d.title}</div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{d.detail}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
