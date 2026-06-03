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
import { CATALOG_V1, type OpportunityHit, type PlanningStrategy } from "@workspace/planning-strategies";
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
  /** P0-2 — when true, force the deterministic (no-LLM) path even if aiEnabled,
   *  so no return information is disclosed to the AI provider without §7216
   *  consent on file. Set by the route from the consent gate. */
  forceDeterministic?: boolean;
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
  if (!aiEnabled || input.forceDeterministic) {
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
  if (!aiEnabled || input.forceDeterministic) {
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
  if (!aiEnabled || input.forceDeterministic || deterministic.length === 0) {
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

// ── Phase H — H8 LLM fact-pattern strategy discovery ─────────────────────

const DISCOVERY_SYSTEM_PROMPT = `You are a senior CPA reviewing a client's tax return for OVERLOOKED tax-planning opportunities.

You will receive:
  (a) A STRUCTURED snapshot of the client's tax return (AGI, taxable income, key line items).
  (b) The list of opportunities the DETERMINISTIC rule engine already detected (Layer 2 hits).
  (c) The FULL CATALOG of strategies the rule engine knows about (with IDs, names, trigger descriptions).

YOUR JOB: identify candidate strategies the rule engine MISSED. Two categories:

1. CATALOG strategies — strategies already in the catalog (c) that the rule
   engine's trigger logic did NOT detect, but which a sharp CPA might still
   consider applicable based on the client snapshot. Common reasons: client
   data is incomplete, the trigger uses a conservative threshold, or the
   strategy applies but needs additional information to confirm.

2. EXTRA strategies — well-established IRS-codified strategies NOT in the
   catalog (c) that you believe apply to this client. You may suggest these
   IF you can cite a specific IRC section + plausible reasoning.

HARD CONSTRAINTS:
  - DO NOT invent or compute dollar amounts. The deterministic engine owns
    all numbers. Your output is qualitative.
  - DO NOT recommend a strategy already in the engine's detected hits (b).
  - For each candidate, you MUST provide:
      * name (short label)
      * ircSection (the IRS Code section, e.g., "IRC §1031")
      * confidence (decimal 0.0-1.0, how sure you are this applies)
      * rationale (1-2 sentence "why I think this applies to THIS client")
      * prerequisiteData (string array — what the CPA needs to gather to confirm)
  - Cap output at 5 candidates total. Quality > quantity.
  - If you find nothing, return an empty array. Do NOT pad.

OUTPUT FORMAT: a JSON object with a single key "candidates" whose value is
an array of the candidate objects described above. Output ONLY valid JSON.
No preamble, no markdown fences, no explanation outside the JSON.

Example output:
{"candidates":[{"name":"Roth conversion via traditional IRA","ircSection":"IRC §408A","confidence":0.7,"rationale":"Client is in a low-marginal-rate year and has $50k of headroom in the 12% bracket — could convert at a much lower rate than future RMDs would face.","prerequisiteData":["Traditional IRA balance","Client's expected future income trajectory","Roth IRA already open?"]}]}`;

/**
 * Phase H — H8: Rule-engine verification of an LLM-proposed candidate.
 *
 * The LLM proposes strategies based on the client snapshot + catalog. We
 * post-process each candidate by cross-referencing the catalog:
 *
 *   - "catalog-overlap": candidate's IRC section matches a catalog
 *     strategy that the deterministic engine did NOT trigger for this
 *     client. CPA action: confirm whether the LLM is right (and the
 *     engine is missing input data) OR the LLM hallucinated.
 *   - "extra-strategy": candidate is not in the engine's catalog at all
 *     — only the LLM's qualitative judgment supports it. CPA evaluates
 *     from first principles.
 *
 * LLM responses that match an ALREADY-DETECTED strategy ID are filtered
 * out entirely (the prompt forbids these but the LLM occasionally
 * violates the rule).
 */
export interface PlanningDiscoveryVerification {
  status: "catalog-overlap" | "extra-strategy";
  /** Catalog strategy ID this candidate maps to (catalog-overlap only). */
  matchedCatalogId?: string;
  /** CPA-readable explanation of the verification status. */
  detail: string;
}

export interface PlanningDiscoveryCandidate {
  name: string;
  ircSection: string;
  confidence: number;
  rationale: string;
  prerequisiteData: string[];
  /** Phase H — H8 rule-engine verification. */
  verification: PlanningDiscoveryVerification;
}

export interface PlanningDiscoveryResult {
  candidates: PlanningDiscoveryCandidate[];
  aiUsed: boolean;
  model: string;
}

// ── H8 — verification helpers ────────────────────────────────────────────

/**
 * Normalize an IRC section string for matching (lowercase, collapse
 * whitespace, strip the "IRC §" prefix variants).
 */
function normalizeIrc(s: string): string {
  return s
    .toLowerCase()
    .replace(/[§i\.r\.c\.\s,]+/g, " ")
    .trim();
}

/**
 * H8 verifier — match an LLM candidate to a catalog strategy by IRC
 * section. Returns verification status + match metadata.
 *
 * Two outcomes:
 *   - catalog-overlap: IRC matches a catalog strategy not in detected hits
 *   - extra-strategy: no catalog match (LLM-only)
 *
 * Candidates whose matched catalog strategy is ALREADY DETECTED are
 * caught by the caller (`verifyAndDedupeCandidates`) before this runs.
 */
function verifyCandidate(
  candidate: Pick<PlanningDiscoveryCandidate, "ircSection">,
  alreadyDetectedIds: Set<string>,
): { status: PlanningDiscoveryVerification["status"]; matchedCatalogId?: string; detail: string } | "duplicate" {
  const candidateIrc = normalizeIrc(candidate.ircSection || "");
  if (!candidateIrc) {
    return {
      status: "extra-strategy",
      detail: "No IRC section provided — cannot mechanically verify against the catalog.",
    };
  }
  const matched = CATALOG_V1.strategies.find((s) => {
    const catIrc = normalizeIrc(s.ircSection);
    if (!catIrc) return false;
    // Best-effort match: either substring of the other (handles
    // "IRC §1031" matching "1031" alone, etc.). Multi-section catalog
    // entries like "IRC §164(b)(6); Notice 2020-75" still match a
    // single-section candidate via substring.
    return candidateIrc.includes(catIrc) || catIrc.includes(candidateIrc);
  });
  if (!matched) {
    return {
      status: "extra-strategy",
      detail: "Not in the deterministic engine's catalog — CPA evaluates qualitatively from first principles.",
    };
  }
  if (alreadyDetectedIds.has(matched.id)) return "duplicate";
  return {
    status: "catalog-overlap",
    matchedCatalogId: matched.id,
    detail: `Matches catalog strategy ${matched.id} (${matched.name}), but the deterministic engine did NOT fire it for this client. CPA: verify whether (a) the LLM is right and the engine is missing input data, OR (b) the trigger conditions truly aren't met.`,
  };
}

/**
 * Verify + de-duplicate LLM candidates. Returns the final candidate list
 * with each `verification` field populated; drops anything that matches
 * an already-detected catalog strategy (the LLM was told not to do this
 * but occasionally does anyway). Exported for unit tests.
 */
export function verifyAndDedupeCandidates(
  rawCandidates: Pick<PlanningDiscoveryCandidate, "name" | "ircSection" | "confidence" | "rationale" | "prerequisiteData">[],
  hits: OpportunityHit[],
): PlanningDiscoveryCandidate[] {
  const alreadyIds = new Set(hits.map((h) => h.strategyId));
  const out: PlanningDiscoveryCandidate[] = [];
  for (const c of rawCandidates) {
    const verification = verifyCandidate(c, alreadyIds);
    if (verification === "duplicate") continue;
    out.push({ ...c, verification });
  }
  return out;
}

/**
 * Phase H — H8: ask the LLM to propose tax-planning strategies the
 * deterministic rule engine may have missed. Returns structured candidate
 * list with confidence + rationale + prerequisite data. Engine math is
 * NEVER touched by the LLM — output is qualitative only.
 *
 * When AI is disabled (no API key), returns a deterministic stub
 * indicating the feature requires AI; no candidates surfaced.
 */
export async function discoverPlanningCandidates(input: PlanningMemoInput): Promise<PlanningDiscoveryResult> {
  if (!aiEnabled) {
    return {
      candidates: [],
      aiUsed: false,
      model: "stub",
    };
  }

  // Strip the catalog down to its public-facing fields (name + ID + trigger
  // description + IRC section). Don't send the full formula strings (they
  // contain implementation detail the LLM doesn't need).
  const catalogForLlm = CATALOG_V1.strategies.map((s: PlanningStrategy) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    ircSection: s.ircSection,
    trigger: s.trigger,
  }));

  const hitsForLlm = input.hits.map((h) => ({
    strategyId: h.strategyId,
    name: h.name,
  }));

  const payload = {
    client: clientSnapshotForLlm(input.client, input.computed),
    catalog: catalogForLlm,
    alreadyDetected: hitsForLlm,
  };

  try {
    const raw = await chat(DISCOVERY_SYSTEM_PROMPT, payload, 1500);
    // Strip any accidental markdown fences.
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    type RawCandidate = Partial<Omit<PlanningDiscoveryCandidate, "verification">>;
    const parsed = JSON.parse(cleaned) as { candidates?: RawCandidate[] };
    const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    // Filter out malformed entries + cap at 5 + normalize.
    const normalized = candidates
      .filter((c) => typeof c?.name === "string" && typeof c?.ircSection === "string")
      .slice(0, 5)
      .map((c) => ({
        name: String(c.name),
        ircSection: String(c.ircSection),
        confidence: typeof c.confidence === "number" ? Math.max(0, Math.min(1, c.confidence)) : 0.5,
        rationale: String(c.rationale ?? ""),
        prerequisiteData: Array.isArray(c.prerequisiteData)
          ? c.prerequisiteData.filter((p): p is string => typeof p === "string")
          : [],
      }));
    // H8 — rule-engine verification + dedupe of any candidate that matches
    // an already-detected catalog strategy (LLM occasionally violates the
    // dedupe instruction in the system prompt).
    const verified = verifyAndDedupeCandidates(normalized, input.hits);
    return {
      candidates: verified,
      aiUsed: true,
      model: PLANNING_MEMO_MODEL,
    };
  } catch {
    // LLM returned malformed JSON or service errored — return empty list.
    return { candidates: [], aiUsed: false, model: "error" };
  }
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
