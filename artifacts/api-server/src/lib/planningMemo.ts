/**
 * AI synthesis layer (Phase G3) — produces a CPA-facing planning memo
 * from structured OpportunityHit[]. **Math never comes from the LLM** —
 * the deterministic detection engine (Layer 2) is the only source of
 * truth for dollar amounts, formulas, and rule applicability. The LLM
 * narrates what the math already says.
 *
 * Architecture: prompts include the structured hits as JSON + a strict
 * instruction that the LLM must NOT invent numbers. The output is a
 * single markdown memo string. CPA reviews + signs off before sending
 * to the client.
 *
 * Model: AI_PLANNING_MODEL env var overrides the default aiModel. The
 * Phase G plan calls for Gemini 2.5 Pro for memos (better narration);
 * the OAI-compat Gemini endpoint uses `gemini-2.5-pro` or `gemini-2.5-flash`.
 */

import { openai, aiEnabled, aiModel } from "@workspace/integrations-openai-ai-server";
import type { OpportunityHit } from "@workspace/planning-strategies";
import type { ComputedTaxReturn } from "./taxReturnEngine";

const PLANNING_MEMO_MODEL = process.env.AI_PLANNING_MODEL ?? aiModel;

const MEMO_SYSTEM_PROMPT = `You are a senior US tax-planning analyst assisting a CPA on a client memo.

You will receive (a) a STRUCTURED snapshot of the client's tax return and (b) a list of pre-computed
planning OPPORTUNITIES from a deterministic rule engine. Each opportunity already has its dollar
amount, confidence, action, and IRS citation computed by the engine.

YOUR JOB: write a one-page markdown planning memo addressed to the CPA. Sections:
  1. ## Executive summary  (2-3 sentences; total estimated annual savings; top 1-2 opportunities)
  2. ## Recommended actions (one bullet per opportunity, ordered by estSavings desc;
                             each bullet has name + dollar value + 1-sentence why + IRC cite)
  3. ## Data still needed   (consolidate the prerequisiteData lists; deduplicate)
  4. ## Caveats             (note that all numbers are deterministic engine output; CPA validates;
                             flag any opportunities with confidence < 0.7 as "review carefully")

PHASE H — H9 PERSONALIZATION:
  - The client snapshot MAY include riskTolerance, targetRetirementAge,
    estatePlanStage, and planningGoals. When present, weave them naturally
    into the Executive summary and Recommended actions:
      * riskTolerance "conservative" → de-emphasize aggressive moves (Roth-large,
        illiquid investments); favor steady contributions and credits.
      * riskTolerance "aggressive" → flag opportunities that lock in current
        rates / convert future tax-deferred to tax-free (Roth, NUA, bunching).
      * targetRetirementAge → assess runway for strategies needing years
        (Roth conversion ladder, RMD pre-planning, bunching cycles).
      * estatePlanStage "none" or "will_only" → mention establishing a trust
        if estate-planning opportunities exist.
      * planningGoals (free text) → reference the goal directly when it
        aligns with a recommendation (e.g. "supports your 529 funding goal").
  - When the snapshot OMITS these fields, do NOT mention them or invent them.

HARD CONSTRAINTS:
  - DO NOT invent, calculate, or modify any dollar amount, percentage, or threshold.
  - DO NOT add opportunities that aren't in the supplied list.
  - DO NOT speculate on tax law beyond the IRS citations provided.
  - Keep the memo under 400 words.
  - Output ONLY the markdown memo. No preamble, no JSON, no metadata.`;

const EMAIL_SYSTEM_PROMPT = `You are drafting a client outreach email FROM a CPA, ABOUT planning opportunities.

You will receive (a) a client snapshot and (b) a list of pre-computed planning OPPORTUNITIES.

YOUR JOB: write a short, friendly, jargon-free email body the CPA can send to the client TO PROPOSE a
planning engagement. The email should:
  - Open with a personal greeting (client's first name) and a one-sentence hook.
  - List 2-3 of the top opportunities in client-friendly language (no IRC sections, no acronyms).
  - Mention the rough estimated annual benefit (use the supplied dollar amount).
  - Close with a call-to-action: a 30-minute planning conversation.
  - Sign off as "Your CPA team" (the CPA will personalize later).

HARD CONSTRAINTS:
  - DO NOT invent, calculate, or modify dollar amounts.
  - Plain English. NO IRS jargon (no "§199A", "QBI", "AMT", "NIIT" etc.).
  - 200 words max.
  - Output ONLY the email body. No subject line in the body; subject is generated separately.`;

const MISSING_DATA_SYSTEM_PROMPT = `You are a CPA's planning analyst.

Given (a) a client snapshot and (b) a list of opportunities with their prerequisiteData lists,
produce a deduplicated, plain-English list of QUESTIONS the CPA still needs to ask the client
before delivering the planning engagement.

Format: one line per question, prefixed with "- ".
Aim for 3-8 questions. Combine related items. Use everyday phrasing the client would understand.

DO NOT invent questions outside the prerequisiteData lists.
DO NOT include IRS jargon.
Output ONLY the bulleted list. No preamble.`;

/**
 * Phase H — H9. Extended client snapshot that includes the planning-
 * context fields (risk tolerance, retirement age, estate plan stage,
 * planning goals). The AI memo uses these to personalize recommendations.
 * Fields are optional — absent when the CPA hasn't gathered them yet.
 */
type ClientForLlm = {
  firstName: string;
  lastName: string;
  filingStatus: string;
  state: string;
  taxpayerAge?: number | null;
  riskTolerance?: string | null;
  targetRetirementAge?: number | null;
  estatePlanStage?: string | null;
  planningGoals?: string | null;
};

function clientSnapshotForLlm(client: ClientForLlm, computed: ComputedTaxReturn): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    name: `${client.firstName} ${client.lastName}`,
    filingStatus: client.filingStatus,
    state: client.state,
    taxYear: computed.taxYear,
    agi: Math.round(computed.adjustedGrossIncome),
    taxableIncome: Math.round(computed.taxableIncome),
    federalTaxLiability: Math.round(computed.federalTaxLiability),
    stateTaxLiability: Math.round(computed.stateTaxLiability),
    amtTax: Math.round(computed.amtTax),
    niitTax: Math.round(computed.niitTax),
    selfEmploymentTax: Math.round(computed.selfEmploymentTax),
  };
  // H9 — only include client-context fields when populated. Keeps the
  // payload small and avoids prompting the LLM with "riskTolerance: null"
  // (which can lead to it mentioning unknown context).
  if (client.taxpayerAge != null) snapshot.taxpayerAge = client.taxpayerAge;
  if (client.riskTolerance) snapshot.riskTolerance = client.riskTolerance;
  if (client.targetRetirementAge != null) snapshot.targetRetirementAge = client.targetRetirementAge;
  if (client.estatePlanStage) snapshot.estatePlanStage = client.estatePlanStage;
  if (client.planningGoals && client.planningGoals.trim().length > 0) {
    snapshot.planningGoals = client.planningGoals;
  }
  return snapshot;
}

async function chat(systemPrompt: string, userPayload: object, maxTokens = 1200): Promise<string> {
  const response = await openai.chat.completions.create({
    model: PLANNING_MEMO_MODEL,
    max_completion_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  });
  return (response.choices[0]?.message?.content ?? "").trim();
}

export interface PlanningMemoInput {
  client: ClientForLlm;
  computed: ComputedTaxReturn;
  hits: OpportunityHit[];
}

export interface PlanningMemoResult {
  memo: string;
  /** Whether the AI synthesis ran (false = AI disabled, fell back to stub). */
  aiUsed: boolean;
  model: string;
}

/**
 * Generate a CPA-facing markdown memo from structured opportunities.
 *
 * When AI_API_KEY is not set (aiEnabled === false), returns a deterministic
 * stub memo built directly from the structured data — same content layout,
 * no LLM, so the UI flow stays unblocked in dev / CI.
 */
export async function generatePlanningMemo(input: PlanningMemoInput): Promise<PlanningMemoResult> {
  if (!aiEnabled) {
    return { memo: stubMemo(input), aiUsed: false, model: "stub" };
  }
  const payload = {
    client: clientSnapshotForLlm(input.client, input.computed),
    totalEstSavings: input.hits.reduce((s, h) => s + h.estSavings, 0),
    opportunities: input.hits,
  };
  const memo = await chat(MEMO_SYSTEM_PROMPT, payload, 1200);
  return { memo, aiUsed: true, model: PLANNING_MEMO_MODEL };
}

export async function generateClientOutreachEmail(input: PlanningMemoInput): Promise<PlanningMemoResult> {
  if (!aiEnabled) {
    return { memo: stubEmail(input), aiUsed: false, model: "stub" };
  }
  const payload = {
    client: clientSnapshotForLlm(input.client, input.computed),
    totalEstSavings: input.hits.reduce((s, h) => s + h.estSavings, 0),
    opportunities: input.hits.slice(0, 5),
  };
  const memo = await chat(EMAIL_SYSTEM_PROMPT, payload, 600);
  return { memo, aiUsed: true, model: PLANNING_MEMO_MODEL };
}

export async function inferMissingData(input: PlanningMemoInput): Promise<{ items: string[]; aiUsed: boolean; model: string }> {
  // Deterministic baseline: union of prerequisiteData across hits.
  const deterministic = Array.from(
    new Set(input.hits.flatMap((h) => h.prerequisiteData)),
  );
  if (!aiEnabled || deterministic.length === 0) {
    return { items: deterministic, aiUsed: false, model: "stub" };
  }
  const payload = {
    client: clientSnapshotForLlm(input.client, input.computed),
    opportunities: input.hits.map((h) => ({ name: h.name, prerequisiteData: h.prerequisiteData })),
  };
  const raw = await chat(MISSING_DATA_SYSTEM_PROMPT, payload, 400);
  // Parse "- foo" lines.
  const items = raw.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim());
  return { items: items.length > 0 ? items : deterministic, aiUsed: true, model: PLANNING_MEMO_MODEL };
}

// ── Deterministic fallback (no AI) ─────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function stubMemo(input: PlanningMemoInput): string {
  const total = input.hits.reduce((s, h) => s + h.estSavings, 0);
  const top = [...input.hits].sort((a, b) => b.estSavings - a.estSavings);
  const lines: string[] = [];
  lines.push(`## Executive summary`);
  lines.push("");
  lines.push(
    `Estimated annual savings of ${fmt(total)} across ${input.hits.length} ` +
    `planning opportunit${input.hits.length === 1 ? "y" : "ies"} for ${input.client.firstName} ${input.client.lastName} (TY${input.computed.taxYear}).`,
  );
  if (top[0]) lines.push("");
  lines.push("");
  lines.push(`## Recommended actions`);
  lines.push("");
  for (const h of top) {
    lines.push(`- **${h.name}** — ${fmt(h.estSavings)} estimated. ${h.rationale} *${h.citation}*`);
  }
  const prereqs = Array.from(new Set(input.hits.flatMap((h) => h.prerequisiteData)));
  if (prereqs.length > 0) {
    lines.push("");
    lines.push(`## Data still needed`);
    lines.push("");
    for (const p of prereqs) lines.push(`- ${p}`);
  }
  const lowConf = input.hits.filter((h) => h.confidence < 0.7).map((h) => h.name);
  lines.push("");
  lines.push(`## Caveats`);
  lines.push("");
  lines.push(
    `All dollar values are deterministic output of the planning engine ` +
    `(catalog deterministic-only mode; LLM disabled). CPA validates before client send.`,
  );
  if (lowConf.length > 0) {
    lines.push("");
    lines.push(`Lower-confidence (<70%) — review carefully: ${lowConf.join(", ")}.`);
  }
  return lines.join("\n");
}

function stubEmail(input: PlanningMemoInput): string {
  const total = input.hits.reduce((s, h) => s + h.estSavings, 0);
  const top = [...input.hits].sort((a, b) => b.estSavings - a.estSavings).slice(0, 3);
  const lines: string[] = [];
  lines.push(`Hi ${input.client.firstName},`);
  lines.push("");
  lines.push(
    `As we wrap up your ${input.computed.taxYear} return, we ran our planning review and found ` +
    `~${fmt(total)} in potential annual tax savings across ${input.hits.length} ` +
    `opportunit${input.hits.length === 1 ? "y" : "ies"}.`,
  );
  if (top.length > 0) {
    lines.push("");
    lines.push("Highlights:");
    for (const h of top) lines.push(`  - ${h.name}: ~${fmt(h.estSavings)}`);
  }
  lines.push("");
  lines.push(
    `Would you like to schedule a 30-minute planning conversation in the next few weeks to ` +
    `walk through these? We'll explain the trade-offs and tee up any decisions needed before year-end.`,
  );
  lines.push("");
  lines.push("Best,");
  lines.push("Your CPA team");
  return lines.join("\n");
}
