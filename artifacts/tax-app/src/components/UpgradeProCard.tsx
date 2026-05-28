/**
 * Phase G5 — Pro-tier paywall placeholder. Rendered in place of the
 * Planning tab content / dashboard widget when PRO_TIER_ENABLED is false
 * on the api-server (the frontend reads /api/settings to find out).
 *
 * Intentionally non-functional: the CTA is a visual signal, not a
 * working checkout. Real billing flow is deferred to Phase D18 (Stripe).
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

interface UpgradeProCardProps {
  variant?: "widget" | "tab";
}

export function UpgradeProCard({ variant = "widget" }: UpgradeProCardProps) {
  const padding = variant === "tab" ? "py-12" : "py-8";
  return (
    <Card className="border-2 border-dashed border-brand/30 bg-brand/[0.04]">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand/10 text-brand-ink">
              <Sparkles className="h-4 w-4" strokeWidth={2} />
            </span>
            <CardTitle className="text-lg">
              Tax planning insights — available on the Pro tier
            </CardTitle>
          </div>
          <span className="inline-flex items-center rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-semibold text-gold-foreground">
            Pro
          </span>
        </div>
      </CardHeader>
      <CardContent className={`${padding} space-y-4`}>
        <p className="text-sm text-muted-foreground">
          The Pro tier turns TaxFlow into an advisory tool: 10 IRC-cited
          opportunity detectors per client (SEP-IRA, PTET, bunching, Roth
          conversion, AMT timing, NIIT cliff, §199A, charitable DAF,
          tax-loss harvesting, Foreign Tax Credit) plus 5 multi-year pattern
          detectors and AI-drafted client memos. Identify the top-10
          planning targets across your entire book in one screen.
        </p>
        <ul className="text-sm space-y-1 list-disc pl-5 text-muted-foreground">
          <li>Deterministic estimated-savings math (no LLM hallucination)</li>
          <li>Multi-year trend detection (persistent NIIT, growing PAL, etc.)</li>
          <li>AI-drafted CPA memo + client outreach email + missing-data list</li>
          <li>Firm-wide ranked hit list to prioritize engagements</li>
        </ul>
        <div className="flex items-center gap-3 pt-2">
          <Button disabled title="Pricing rollout — contact your firm administrator">
            Upgrade to Pro
          </Button>
          <span className="text-xs text-muted-foreground">
            Contact your firm administrator to enable.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
