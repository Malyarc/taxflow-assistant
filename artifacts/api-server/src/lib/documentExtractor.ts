import { openai, aiEnabled, aiModel } from "@workspace/integrations-openai-ai-server";

export interface ExtractedW2Data {
  employerName?: string;
  employerEin?: string;
  employeeSSN?: string;
  wagesBox1?: number;
  federalTaxWithheldBox2?: number;
  socialSecurityWagesBox3?: number;
  socialSecurityTaxBox4?: number;
  medicareWagesBox5?: number;
  medicareTaxBox6?: number;
  stateTaxWithheldBox17?: number;
  stateWagesBox16?: number;
  stateCode?: string;
}

const W2_SYSTEM_PROMPT = `You are a tax document extraction specialist. Extract W-2 form data from the provided document text or image.
Return ONLY a valid JSON object with these fields (use null for missing values):
{
  "employerName": string or null,
  "employerEin": string or null (format: XX-XXXXXXX),
  "employeeSSN": string or null (format: XXX-XX-XXXX, last 4 only if partial),
  "wagesBox1": number or null,
  "federalTaxWithheldBox2": number or null,
  "socialSecurityWagesBox3": number or null,
  "socialSecurityTaxBox4": number or null,
  "medicareWagesBox5": number or null,
  "medicareTaxBox6": number or null,
  "stateTaxWithheldBox17": number or null,
  "stateWagesBox16": number or null,
  "stateCode": string or null (2-letter state code)
}`;

function parseJsonResponse(text: string): ExtractedW2Data {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(jsonMatch?.[0] ?? "{}") as ExtractedW2Data;
  } catch {
    return {};
  }
}

export async function extractW2DataFromText(content: string): Promise<ExtractedW2Data> {
  if (!aiEnabled) return {};

  const response = await openai.chat.completions.create({
    model: aiModel,
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: W2_SYSTEM_PROMPT },
      { role: "user", content: `Extract W-2 data from this document:\n\n${content}` },
    ],
  });

  return parseJsonResponse(response.choices[0]?.message?.content ?? "{}");
}

/**
 * Extract W-2 data from a base64-encoded image or PDF (preferred path for visual uploads).
 * Skips OCR — the vision model parses the form in one call.
 *
 * For PDFs, we send the data URL through the same `image_url` content-part used by
 * Gemini's OpenAI-compat layer, which accepts PDF MIME types natively.
 */
export async function extractW2DataFromFile(
  base64Content: string,
  mimeType: string,
): Promise<ExtractedW2Data> {
  if (!aiEnabled) return {};

  const response = await openai.chat.completions.create({
    model: aiModel,
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: W2_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Content}` } },
          { type: "text", text: "Extract W-2 data from this file." },
        ],
      },
    ],
  });

  return parseJsonResponse(response.choices[0]?.message?.content ?? "{}");
}

export function detectMimeType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.match(/\.(jpg|jpeg)$/)) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "text/plain";
}

export function isVisualMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/") || mimeType === "application/pdf";
}

export async function extractTextFromBase64(base64Content: string, fileName: string): Promise<string> {
  const mimeType = detectMimeType(fileName);

  if (mimeType === "text/plain") {
    try {
      return Buffer.from(base64Content, "base64").toString("utf-8");
    } catch {
      return base64Content;
    }
  }

  return `[Image/PDF document: ${fileName}]`;
}
