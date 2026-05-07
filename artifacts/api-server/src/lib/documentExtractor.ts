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

/**
 * Per-field bounding box returned by the vision model.
 * Coordinates are normalized 0–1000 (Gemini's standard convention).
 * To overlay on a rendered image: multiply by image dimensions / 1000.
 */
export interface BoundingBox {
  /** [yMin, xMin, yMax, xMax] in 0-1000 normalized coordinates */
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}

export type FieldBoxes = Partial<Record<keyof ExtractedW2Data, BoundingBox>>;

export interface ExtractionResult {
  data: ExtractedW2Data;
  boxes: FieldBoxes;
}

const W2_TEXT_PROMPT = `You are a tax document extraction specialist. Extract W-2 form data from the provided document text or image.
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

const W2_VISION_PROMPT = `You are a tax document extraction specialist. Extract W-2 form data from the image.
Return ONLY a valid JSON object with two top-level keys: "data" and "boxes".

"data" contains the extracted values:
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
  "stateCode": string or null
}

"boxes" contains a bounding box for each field that was found, in normalized image coordinates (0-1000):
{
  "wagesBox1": {"ymin": 230, "xmin": 120, "ymax": 280, "xmax": 800},
  "federalTaxWithheldBox2": {...},
  ...
}
Use 0 as the top-left of the image and 1000 as the bottom-right. Only include boxes for fields you actually found a value for. If a field is null in "data", omit it from "boxes".

Final response format:
{
  "data": { ... },
  "boxes": { ... }
}`;

function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}

function normalizeData(parsed: unknown): ExtractedW2Data {
  if (!parsed || typeof parsed !== "object") return {};
  // Filter to known fields and reasonable types
  const out: ExtractedW2Data = {};
  const numericFields: (keyof ExtractedW2Data)[] = [
    "wagesBox1", "federalTaxWithheldBox2", "socialSecurityWagesBox3", "socialSecurityTaxBox4",
    "medicareWagesBox5", "medicareTaxBox6", "stateTaxWithheldBox17", "stateWagesBox16",
  ];
  const stringFields: (keyof ExtractedW2Data)[] = ["employerName", "employerEin", "employeeSSN", "stateCode"];
  const obj = parsed as Record<string, unknown>;
  for (const f of stringFields) {
    if (typeof obj[f] === "string" && (obj[f] as string).trim()) {
      out[f] = (obj[f] as string).trim() as never;
    }
  }
  for (const f of numericFields) {
    const v = obj[f];
    if (typeof v === "number" && Number.isFinite(v)) (out as Record<string, number>)[f] = v;
    else if (typeof v === "string") {
      const n = Number(v.replace(/[$,]/g, ""));
      if (Number.isFinite(n)) (out as Record<string, number>)[f] = n;
    }
  }
  return out;
}

function normalizeBoxes(parsed: unknown): FieldBoxes {
  if (!parsed || typeof parsed !== "object") return {};
  const out: FieldBoxes = {};
  const obj = parsed as Record<string, unknown>;
  for (const [field, val] of Object.entries(obj)) {
    if (val && typeof val === "object") {
      const v = val as Record<string, unknown>;
      const ymin = Number(v.ymin ?? v.y_min ?? v.top);
      const xmin = Number(v.xmin ?? v.x_min ?? v.left);
      const ymax = Number(v.ymax ?? v.y_max ?? v.bottom);
      const xmax = Number(v.xmax ?? v.x_max ?? v.right);
      if ([ymin, xmin, ymax, xmax].every(Number.isFinite)) {
        out[field as keyof ExtractedW2Data] = { ymin, xmin, ymax, xmax };
      }
    }
  }
  return out;
}

export async function extractW2DataFromText(content: string): Promise<ExtractedW2Data> {
  if (!aiEnabled) return {};

  const response = await openai.chat.completions.create({
    model: aiModel,
    max_completion_tokens: 2048,
    messages: [
      { role: "system", content: W2_TEXT_PROMPT },
      { role: "user", content: `Extract W-2 data from this document:\n\n${content}` },
    ],
  });

  return normalizeData(extractJsonObject(response.choices[0]?.message?.content ?? "{}"));
}

/**
 * Extract W-2 data from a base64-encoded image or PDF, plus per-field
 * bounding boxes for click-to-highlight UI.
 */
export async function extractW2DataFromFile(
  base64Content: string,
  mimeType: string,
): Promise<ExtractionResult> {
  if (!aiEnabled) return { data: {}, boxes: {} };

  const response = await openai.chat.completions.create({
    model: aiModel,
    max_completion_tokens: 4096,
    messages: [
      { role: "system", content: W2_VISION_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Content}` } },
          { type: "text", text: "Extract W-2 data + bounding boxes from this image." },
        ],
      },
    ],
  });

  const parsed = extractJsonObject(response.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  // Tolerate two response shapes: {data,boxes} or just the flat data object
  const dataPart = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const boxesPart = parsed.boxes && typeof parsed.boxes === "object" ? parsed.boxes : {};

  return {
    data: normalizeData(dataPart),
    boxes: normalizeBoxes(boxesPart),
  };
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
