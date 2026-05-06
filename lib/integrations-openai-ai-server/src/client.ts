import OpenAI from "openai";

// Defaults to Google Gemini's OpenAI-compatible endpoint if no base URL is set,
// so a vanilla `AI_API_KEY` (a Google AI Studio key) is enough to enable AI extraction.
const baseURL =
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??
  "https://generativelanguage.googleapis.com/v1beta/openai/";

const apiKey =
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY ??
  process.env.AI_API_KEY ??
  "";

export const openai = new OpenAI({
  apiKey: apiKey || "missing-key",
  baseURL,
});

export const aiEnabled = Boolean(apiKey);

export const aiModel = process.env.AI_MODEL ?? "gemini-2.5-flash";
