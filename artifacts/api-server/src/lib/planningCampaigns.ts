/**
 * T2.2 D3 — Firm-wide planning campaign tool.
 *
 * Turns the firm-wide hit-list into ACTIONABLE outreach campaigns: "12 clients
 * qualify for PTET — $84k combined savings — here's the email to send all of
 * them." Aggregation is pure + deterministic (grouped engine output). The
 * optional LLM step drafts a REUSABLE TEMPLATE with {{firstName}} /
 * {{estSavings}} merge fields.
 *
 * §7216 BY DESIGN: the LLM is given ONLY the catalog strategy text + anonymous
 * cohort statistics (count, min/median/max savings rounded to $100). No client
 * name, identifier, or per-client figure is ever disclosed — so no per-client
 * consent is required for the draft. The mail merge that joins client names to
 * numbers happens locally (the response's `cohort` + `mergeFields`).
 */

import { openai, aiEnabled, aiModel } from "@workspace/integrations-openai-ai-server";
import type { OpportunityHit, PlanningStrategy } from "@workspace/planning-strategies";

const CAMPAIGN_MODEL = process.env.AI_PLANNING_MODEL ?? aiModel;

export interface CampaignClientHit {
  clientId: number;
  firstName: string;
  lastName: string;
  email: string | null;
  hits: OpportunityHit[];
}

export interface CampaignCohortMember {
  clientId: number;
  firstName: string;
  lastName: string;
  email: string | null;
  /** This client's engine savings for the campaign's strategy. */
  estSavings: number;
}

export interface PlanningCampaign {
  strategyId: string;
  name: string;
  category: string;
  ircSection: string;
  clientCount: number;
  totalEstSavings: number;
  medianEstSavings: number;
  clients: CampaignCohortMember[];
  /** Anonymous $100-rounded stats — what the email-draft endpoint forwards to
   *  the LLM (computed here so the draft never re-runs the firm fan-out). */
  stats: CampaignCohortStats;
}

function headline(h: OpportunityHit): number {
  return Math.round(h.verifiedSavings ?? h.estSavings);
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Group per-client hits into campaigns, one per strategy, largest combined
 * savings first (members sorted by savings within each).
 */
export function aggregateCampaigns(clientHits: CampaignClientHit[]): PlanningCampaign[] {
  const byStrategy = new Map<string, PlanningCampaign>();
  for (const c of clientHits) {
    for (const h of c.hits) {
      let camp = byStrategy.get(h.strategyId);
      if (!camp) {
        camp = {
          strategyId: h.strategyId,
          name: h.name,
          category: h.category,
          ircSection: h.citation,
          clientCount: 0,
          totalEstSavings: 0,
          medianEstSavings: 0,
          clients: [],
          stats: { clientCount: 0, minSavings: 0, medianSavings: 0, maxSavings: 0 },
        };
        byStrategy.set(h.strategyId, camp);
      }
      camp.clients.push({
        clientId: c.clientId,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        estSavings: headline(h),
      });
    }
  }
  const campaigns = [...byStrategy.values()];
  for (const camp of campaigns) {
    camp.clients.sort((a, b) => b.estSavings - a.estSavings);
    camp.clientCount = camp.clients.length;
    camp.totalEstSavings = camp.clients.reduce((s, m) => s + m.estSavings, 0);
    camp.medianEstSavings = Math.round(median(camp.clients.map((m) => m.estSavings).sort((a, b) => a - b)));
    camp.stats = cohortStats(camp.clients);
  }
  campaigns.sort((a, b) => b.totalEstSavings - a.totalEstSavings);
  return campaigns;
}

/** Anonymous stats — the ONLY cohort information the LLM ever sees. */
export interface CampaignCohortStats {
  clientCount: number;
  /** Rounded to $100 so a single client's exact figure can't be inferred. */
  minSavings: number;
  medianSavings: number;
  maxSavings: number;
}

export function cohortStats(members: Array<{ estSavings: number }>): CampaignCohortStats {
  const r100 = (n: number) => Math.round(n / 100) * 100;
  const sorted = members.map((m) => m.estSavings).sort((a, b) => a - b);
  return {
    clientCount: sorted.length,
    minSavings: r100(sorted[0] ?? 0),
    medianSavings: r100(median(sorted)),
    maxSavings: r100(sorted[sorted.length - 1] ?? 0),
  };
}

const TEMPLATE_SYSTEM_PROMPT = `You are drafting a REUSABLE client-outreach email template for a CPA firm's planning campaign.

You will receive ONE tax-planning strategy (name, plain-meaning trigger, action text, IRC citation)
and ANONYMOUS cohort statistics (how many clients qualify; rounded min/median/max estimated savings).
You will NOT receive any client identity or per-client figure — do not invent any.

YOUR JOB: a short, friendly email template the firm can mail-merge to every qualifying client.
  - Use the literal merge fields {{firstName}} and {{estSavings}} exactly once each —
    {{firstName}} in the greeting, {{estSavings}} where the client's personal estimate goes.
  - Translate the strategy into plain English (no IRC sections, no acronyms).
  - Close with a call-to-action for a 30-minute planning conversation; sign "Your CPA team".

HARD CONSTRAINTS:
  - DO NOT write any specific dollar amount other than the literal {{estSavings}} merge field.
  - DO NOT address any specific person other than the literal {{firstName}} merge field.
  - 170 words max. Output ONLY the email body (no subject line, no preamble).`;

export interface CampaignEmailDraft {
  template: string;
  /** Merge fields the local mail-merge substitutes per client. */
  mergeFields: string[];
  aiUsed: boolean;
  model: string;
}

/** Deterministic fallback template built from the catalog strategy text. */
export function stubCampaignTemplate(strategy: PlanningStrategy): string {
  return [
    "Hi {{firstName}},",
    "",
    `While reviewing returns this season, we flagged an opportunity that applies to you: ${strategy.name.toLowerCase()}. ` +
      `Based on your most recent return, we estimate it could save you roughly {{estSavings}} per year.`,
    "",
    "There are details to confirm before acting on it, and that's exactly what a short planning conversation is for. " +
      "Would you like to schedule 30 minutes in the next few weeks? We'll walk through how it works, what it's worth in your situation, and what (if anything) needs to happen before year-end.",
    "",
    "Best,",
    "Your CPA team",
  ].join("\n");
}

export async function draftCampaignEmail(args: {
  strategy: PlanningStrategy;
  stats: CampaignCohortStats;
  forceDeterministic?: boolean;
}): Promise<CampaignEmailDraft> {
  const mergeFields = ["{{firstName}}", "{{estSavings}}"];
  if (!aiEnabled || args.forceDeterministic) {
    return { template: stubCampaignTemplate(args.strategy), mergeFields, aiUsed: false, model: "stub" };
  }
  const payload = {
    strategy: {
      name: args.strategy.name,
      trigger: args.strategy.trigger,
      action: args.strategy.action,
      ircSection: args.strategy.ircSection,
    },
    cohort: args.stats,
  };
  // T1.0l sibling of the returnQa fix: a THROWN LLM call (invalid key,
  // provider outage, 429) must degrade to the deterministic template, not a
  // 500 — the empty-answer path below already does.
  let template = "";
  try {
    const response = await openai.chat.completions.create({
      model: CAMPAIGN_MODEL,
      max_completion_tokens: 500,
      messages: [
        { role: "system", content: TEMPLATE_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
    });
    template = (response.choices[0]?.message?.content ?? "").trim();
  } catch {
    return { template: stubCampaignTemplate(args.strategy), mergeFields, aiUsed: false, model: "error" };
  }
  // The merge fields are the contract — a draft that lost them is unusable
  // for the local mail-merge, so fall back to the deterministic template.
  if (!template || !mergeFields.every((f) => template.includes(f))) {
    return { template: stubCampaignTemplate(args.strategy), mergeFields, aiUsed: false, model: "fallback" };
  }
  return { template, mergeFields, aiUsed: true, model: CAMPAIGN_MODEL };
}
