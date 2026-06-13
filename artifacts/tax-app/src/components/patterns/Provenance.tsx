/**
 * UX 2.0 (T2.3 D4) — "why this number". Click any figure to see its source
 * chain: the form line, the engine identity that produced it, the signed input
 * components that tie out to it, and (when known) the source document.
 *
 * This surfaces the SAME tie-out machinery the workpaper builders use
 * (`checkLine` ✓/⚠): a chain whose components sum to the result within a cent
 * shows a green ✓; a mismatch shows an amber ⚠ — exactly the trust cue a CPA
 * cross-checking against their prep software is looking for. No competitor
 * exposes this.
 */
import { Check, TriangleAlert, FileText } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { money, signedMoney } from "@/lib/format";

/** A signed contribution to a computed figure. */
export interface ProvenanceComponent {
  label: string;
  value: number;
  /** Optional form-line ref this component itself traces to. */
  lineRef?: string;
  /** Optional source document label (e.g. "W-2 — Acme Corp, Box 1"). */
  source?: string;
}

export interface ProvenanceChain {
  /** Form/line reference, e.g. "Form 1040, line 11". */
  lineRef?: string;
  /** The engine identity in words, e.g. "AGI = Total income − Adjustments". */
  identity: string;
  /** The computed result. */
  result: number;
  /** Signed components. When `operator: "sum"`, they must tie out to result. */
  components: ProvenanceComponent[];
  /** "sum" enables the ✓/⚠ tie-out check (default). */
  operator?: "sum" | "custom";
  /** Optional plain-language note (a caveat, a citation). */
  note?: string;
}

/** Whether the components tie out to the result within a cent. */
export function tiesOut(chain: ProvenanceChain): boolean {
  if (chain.operator === "custom") return true;
  const sum = chain.components.reduce((a, c) => a + (Number.isFinite(c.value) ? c.value : 0), 0);
  return Math.abs(sum - chain.result) < 0.01;
}

/** The inner chain rendering — reused in the return-workspace provenance rail. */
export function ProvenanceList({ chain }: { chain: ProvenanceChain }) {
  const ok = tiesOut(chain);
  return (
    <div className="space-y-3">
      <div>
        {chain.lineRef && <div className="t-eyebrow text-brand-ink">{chain.lineRef}</div>}
        <div className="mt-0.5 font-mono text-xs text-muted-foreground">{chain.identity}</div>
      </div>

      <div className="space-y-1">
        {chain.components.map((c, i) => (
          <div key={i} className="flex items-baseline justify-between gap-3 text-sm">
            <div className="min-w-0">
              <span className="truncate">{c.label}</span>
              {c.source && (
                <span className="ml-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <FileText className="h-3 w-3" aria-hidden="true" />
                  {c.source}
                </span>
              )}
            </div>
            <span className="t-num shrink-0 tabular-nums text-muted-foreground">{signedMoney(c.value)}</span>
          </div>
        ))}
      </div>

      <div className={cn("flex items-center justify-between gap-3 border-t pt-2", ok ? "" : "text-destructive")}>
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {ok ? (
            <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
          ) : (
            <TriangleAlert className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
          )}
          {ok ? "Ties out" : "Does not tie out"}
        </span>
        <span className="t-num font-semibold tabular-nums">{money(chain.result)}</span>
      </div>

      {chain.note && <p className="text-xs text-muted-foreground">{chain.note}</p>}
    </div>
  );
}

/**
 * Wrap a figure to make it provenance-aware. The child becomes a button with a
 * dotted underline affordance; clicking opens the source chain.
 */
export function Provenance({
  chain,
  children,
  className,
}: {
  chain: ProvenanceChain;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:decoration-brand-ink focus-visible:decoration-brand-ink",
            className,
          )}
          aria-label={`Why this number: ${chain.identity}`}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <ProvenanceList chain={chain} />
      </PopoverContent>
    </Popover>
  );
}
