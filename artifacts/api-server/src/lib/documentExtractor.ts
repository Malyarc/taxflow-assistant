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
  /** Optional 1-indexed PDF page number. Defaults to 1 if absent. */
  page?: number;
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
  "wagesBox1": {"ymin": 230, "xmin": 120, "ymax": 280, "xmax": 800, "page": 1},
  "federalTaxWithheldBox2": {...},
  ...
}
Use 0 as the top-left of the image and 1000 as the bottom-right. Include "page" (1-indexed) when the document is multi-page. Only include boxes for fields you actually found a value for. If a field is null in "data", omit it from "boxes".

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
      // Optional page (1-indexed). Defaults handled downstream (UI assumes page 1).
      const pageRaw = Number(v.page ?? v.pageNumber ?? v.page_number);
      if ([ymin, xmin, ymax, xmax].every(Number.isFinite)) {
        const box: BoundingBox = { ymin, xmin, ymax, xmax };
        if (Number.isFinite(pageRaw) && pageRaw > 0) box.page = Math.floor(pageRaw);
        out[field as keyof ExtractedW2Data] = box;
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

// ── 1099 extraction ─────────────────────────────────────────────────────────
export type Form1099Type = "nec" | "misc" | "int" | "div" | "b" | "r" | "g" | "k";

export interface Extracted1099Data {
  formType?: Form1099Type;
  payerName?: string;
  payerTin?: string;
  recipientTin?: string;
  federalTaxWithheld?: number;
  stateTaxWithheld?: number;
  stateCode?: string;
  // 1099-NEC
  nonemployeeCompensation?: number;
  // 1099-MISC
  rents?: number;
  royalties?: number;
  otherIncome?: number;
  fishingBoatProceeds?: number;
  medicalAndHealthcare?: number;
  // 1099-INT
  interestIncome?: number;
  earlyWithdrawalPenalty?: number;
  usTreasuryInterest?: number;
  taxExemptInterest?: number;
  // 1099-DIV
  ordinaryDividends?: number;
  qualifiedDividends?: number;
  totalCapitalGainDistribution?: number;
  nondividendDistributions?: number;
  // 1099-B
  proceeds?: number;
  costBasis?: number;
  shortTermGainLoss?: number;
  longTermGainLoss?: number;
  // 1099-R
  grossDistribution?: number;
  taxableAmount?: number;
  distributionCode?: string;
  iraSepSimple?: string;
  // 1099-G
  unemploymentCompensation?: number;
  stateLocalRefund?: number;
  // 1099-K
  grossPaymentAmount?: number;
}

export interface Extraction1099Result {
  data: Extracted1099Data;
  boxes: Record<string, BoundingBox>;
}

const FORM_1099_PROMPT = `You are a tax document extraction specialist. The image is a 1099 form. First, IDENTIFY which 1099 type it is from the form's header (1099-NEC, 1099-MISC, 1099-INT, 1099-DIV, 1099-B, 1099-R, 1099-G, or 1099-K). Then extract the relevant fields.

Return ONLY a valid JSON object with two top-level keys: "data" and "boxes".

"data" must include "formType" (one of: "nec", "misc", "int", "div", "b", "r", "g", "k") and the relevant fields for that form type. Common fields across all forms:
{
  "formType": "nec" | "misc" | "int" | "div" | "b" | "r" | "g" | "k",
  "payerName": string or null,
  "payerTin": string or null (XX-XXXXXXX format),
  "recipientTin": string or null (last 4 only if partial),
  "federalTaxWithheld": number or null,
  "stateTaxWithheld": number or null,
  "stateCode": string or null (2-letter)
}

Per-form fields (only include the relevant ones based on formType):
  nec: { "nonemployeeCompensation": number }
  misc: { "rents", "royalties", "otherIncome", "fishingBoatProceeds", "medicalAndHealthcare" }
  int: { "interestIncome", "earlyWithdrawalPenalty", "usTreasuryInterest", "taxExemptInterest" }
  div: { "ordinaryDividends", "qualifiedDividends", "totalCapitalGainDistribution", "nondividendDistributions" }
  b: { "proceeds", "costBasis", "shortTermGainLoss", "longTermGainLoss" } — sum if there are multiple lots
  r: { "grossDistribution", "taxableAmount", "distributionCode", "iraSepSimple" }
  g: { "unemploymentCompensation", "stateLocalRefund" }
  k: { "grossPaymentAmount" }

"boxes" contains optional bounding boxes (0-1000 normalized) for each field that was found.
For multi-page PDFs (e.g. 1099-R can be multi-page), include "page" (1-indexed):
{
  "nonemployeeCompensation": {"ymin": 230, "xmin": 120, "ymax": 280, "xmax": 800, "page": 1},
  ...
}

Final response format:
{
  "data": { "formType": "...", ...fields },
  "boxes": { ... }
}`;

export async function extract1099DataFromFile(
  base64Content: string,
  mimeType: string,
): Promise<Extraction1099Result> {
  if (!aiEnabled) return { data: {}, boxes: {} };

  const response = await openai.chat.completions.create({
    model: aiModel,
    max_completion_tokens: 4096,
    messages: [
      { role: "system", content: FORM_1099_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Content}` } },
          { type: "text", text: "Identify the 1099 type and extract relevant fields with bounding boxes." },
        ],
      },
    ],
  });

  const parsed = extractJsonObject(response.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  const dataPart = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const boxesPart = parsed.boxes && typeof parsed.boxes === "object" ? parsed.boxes : {};

  return {
    data: normalize1099Data(dataPart),
    boxes: normalizeBoxes(boxesPart),
  };
}

function normalize1099Data(parsed: unknown): Extracted1099Data {
  if (!parsed || typeof parsed !== "object") return {};
  const obj = parsed as Record<string, unknown>;
  const out: Extracted1099Data = {};

  // formType
  if (typeof obj.formType === "string") {
    const t = obj.formType.toLowerCase().replace(/^1099-?/, "");
    if (["nec", "misc", "int", "div", "b", "r", "g", "k"].includes(t)) {
      out.formType = t as Form1099Type;
    }
  }

  const stringFields: Array<keyof Extracted1099Data> = [
    "payerName", "payerTin", "recipientTin", "stateCode", "distributionCode", "iraSepSimple",
  ];
  const numericFields: Array<keyof Extracted1099Data> = [
    "federalTaxWithheld", "stateTaxWithheld",
    "nonemployeeCompensation",
    "rents", "royalties", "otherIncome", "fishingBoatProceeds", "medicalAndHealthcare",
    "interestIncome", "earlyWithdrawalPenalty", "usTreasuryInterest", "taxExemptInterest",
    "ordinaryDividends", "qualifiedDividends", "totalCapitalGainDistribution", "nondividendDistributions",
    "proceeds", "costBasis", "shortTermGainLoss", "longTermGainLoss",
    "grossDistribution", "taxableAmount",
    "unemploymentCompensation", "stateLocalRefund",
    "grossPaymentAmount",
  ];
  for (const f of stringFields) {
    if (typeof obj[f] === "string" && (obj[f] as string).trim()) {
      (out as Record<string, string>)[f] = (obj[f] as string).trim();
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

/**
 * Deep-audit security finding: validate uploaded file MIME by content
 * (magic bytes) rather than filename extension alone. Catches malicious
 * uploads that pretend to be PDFs/images. Whitelist of accepted types
 * matches what the AI extraction supports.
 *
 * Returns the detected MIME type, or null when the bytes don't match any
 * accepted file type — caller rejects the upload.
 *
 * Detection by magic bytes (RFC 3552 examples + file(1) signatures):
 *   PDF: 25 50 44 46    ("%PDF")
 *   PNG: 89 50 4E 47 0D 0A 1A 0A
 *   JPEG: FF D8 FF
 *   WEBP: starts with "RIFF" then "WEBP" at offset 8
 *   Plain text: heuristic — printable ASCII / UTF-8 throughout the first 512 bytes
 */
export function detectMimeFromContent(base64Content: string): string | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64Content, "base64");
  } catch {
    return null;
  }
  if (buf.length < 4) return null;

  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // WEBP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  // Plain text heuristic: only printable + common whitespace in first 512 bytes.
  const sniff = buf.subarray(0, Math.min(buf.length, 512));
  let printable = 0;
  for (const byte of sniff) {
    // Tab, LF, CR, or printable ASCII range.
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e)) {
      printable += 1;
    } else if (byte >= 0x80) {
      // UTF-8 continuation/start byte; allow.
      printable += 1;
    }
  }
  if (printable === sniff.length) return "text/plain";
  return null;
}

/**
 * Cross-check the filename-detected MIME against the content-detected MIME.
 * Returns the effective MIME (preferring content), or throws when the
 * combination is unsafe. Throws when:
 *   - content type is unrecognized (returned null)
 *   - filename claims PDF but content is image (or vice-versa) — likely tampering
 */
export function validateAndResolveMimeType(
  base64Content: string,
  fileName: string,
): string {
  const declared = detectMimeType(fileName);
  const detected = detectMimeFromContent(base64Content);
  if (detected === null) {
    throw new Error(
      `Unsupported file content. Allowed: PDF, PNG, JPEG, WEBP, plain text. ` +
      `Filename declared "${declared}".`,
    );
  }
  // Compatibility matrix: declared/detected mismatch is fine for text/plain
  // (the extension might just be missing). For visual types, both must agree
  // — a .pdf upload with image content (or vice-versa) is rejected.
  if (declared !== "text/plain" && detected !== declared) {
    throw new Error(
      `File content (${detected}) does not match filename extension (${declared}).`,
    );
  }
  return detected;
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
