import { openai } from "@workspace/integrations-openai-ai-server";

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

export async function extractW2DataFromText(content: string): Promise<ExtractedW2Data> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    max_completion_tokens: 2048,
    messages: [
      {
        role: "system",
        content: `You are a tax document extraction specialist. Extract W-2 form data from the provided document text or description.
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
}`,
      },
      {
        role: "user",
        content: `Extract W-2 data from this document:\n\n${content}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? "{}") as ExtractedW2Data;
    return parsed;
  } catch {
    return {};
  }
}

export async function extractTextFromBase64(base64Content: string, fileName: string): Promise<string> {
  // For text-based documents, try to decode; for images/PDFs, describe what's there
  const mimeType = fileName.toLowerCase().endsWith(".pdf") ? "application/pdf" :
    fileName.toLowerCase().match(/\.(jpg|jpeg|png)$/) ? "image/jpeg" : "text/plain";

  if (mimeType === "text/plain") {
    try {
      return Buffer.from(base64Content, "base64").toString("utf-8");
    } catch {
      return base64Content;
    }
  }

  // For images, use vision to extract text
  if (mimeType === "image/jpeg") {
    const response = await openai.chat.completions.create({
      model: "gpt-5.4",
      max_completion_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Content}` },
            },
            {
              type: "text",
              text: "This is a tax document (W-2 or similar). Please transcribe all visible text and numbers exactly as they appear, noting box numbers and labels.",
            },
          ],
        },
      ],
    });
    return response.choices[0]?.message?.content ?? "";
  }

  // For PDFs and other formats, treat as text extraction hint
  return `File: ${fileName}\n[Document uploaded - please extract W-2 data based on filename and context]`;
}
