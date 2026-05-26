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

export const aiEnabled = Boolean(apiKey);

// Fail fast in production if AI is expected but no key is configured —
// avoids hitting the OpenAI endpoint with literal "missing-key" and
// surfacing the failure inside an error path that might leak the
// invalid-key response. Test + dev paths still allow the disabled
// fallback (callers check `aiEnabled` before calling).
if (!aiEnabled && process.env.NODE_ENV === "production" && process.env.AI_DISABLED !== "true") {
  // eslint-disable-next-line no-console
  console.warn(
    "[ai-server] AI_API_KEY not set in production. AI extraction + planning memo will be disabled. " +
    "Set AI_DISABLED=true to silence this warning.",
  );
}

export const openai = new OpenAI({
  apiKey: apiKey || "missing-key",
  baseURL,
});

export const aiModel = process.env.AI_MODEL ?? "gemini-2.5-flash";
