/**
 * UX 2.0 (T2.3 D6) — document-request tracker. Surfaces the per-client
 * organizer (T2.2 clientOrganizer) as a workflow checklist: every prior-year
 * source document becomes a request that flips to "received" when the matching
 * current-year record exists, plus prior-return deduction reminders and the
 * life-events questionnaire. One status vocabulary (StatusPill) shared with the
 * engagement board.
 */
import { useGetClientOrganizer } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { StatusPill, organizerStatusMeta } from "@/components/patterns/StatusPill";

interface OrganizerItem { id: string; category: string; title: string; detail?: string | null; status: string; source?: string }
interface OrganizerResult { items: OrganizerItem[]; counts: { missing: number; received: number; questions: number } }

const CATEGORY_LABEL: Record<string, string> = {
  income: "Income documents",
  business_rental: "Business & rental",
  deductions_credits: "Deductions & credits",
  life_events: "Life events",
};

export function DocRequestTracker({ clientId, compact = false }: { clientId: number; compact?: boolean }) {
  const { data, isLoading, isError } = useGetClientOrganizer(clientId);

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError || !data) return <div className="py-3 text-sm text-muted-foreground">Couldn't load the document organizer.</div>;

  const org = data as unknown as OrganizerResult;
  const items = org.items ?? [];
  const { missing, received, questions } = org.counts ?? { missing: 0, received: 0, questions: 0 };
  const trackable = missing + received;
  const pctReceived = trackable > 0 ? Math.round((received / trackable) * 100) : 0;

  const byCategory = items.reduce<Record<string, OrganizerItem[]>>((acc, it) => {
    (acc[it.category] ??= []).push(it);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusPill tone="success" label={`${received} received`} />
        <StatusPill tone="warn" label={`${missing} missing`} />
        {questions > 0 && <StatusPill tone="info" label={`${questions} questions`} />}
      </div>

      <div className="space-y-1">
        <Progress value={pctReceived} className="h-2" aria-label={`${pctReceived}% of requested documents received`} />
        <div className="text-xs text-muted-foreground">{pctReceived}% of requested documents received</div>
      </div>

      {!compact &&
        Object.entries(byCategory).map(([cat, list]) => (
          <div key={cat} className="space-y-1.5">
            <div className="t-eyebrow text-muted-foreground">{CATEGORY_LABEL[cat] ?? cat}</div>
            {list.map((it) => {
              const meta = organizerStatusMeta[it.status] ?? { tone: "neutral" as const, label: it.status };
              return (
                <div key={it.id} className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{it.title}</div>
                    {it.detail && <div className="truncate text-xs text-muted-foreground">{it.detail}</div>}
                  </div>
                  <StatusPill tone={meta.tone} label={meta.label} dot={false} className="mt-0.5 shrink-0" />
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
