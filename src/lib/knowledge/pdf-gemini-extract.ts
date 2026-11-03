import "server-only";
import { createPartFromBase64, GoogleGenAI } from "@google/genai";
import { getSecureProviderKey } from "@/lib/answers/config/env";
import { reportPdfPreparationFailure, type PdfDiagnosticContext } from "./pdf-ocr";

/** Local-only scanned-PDF rescue. Never the assistant answer model. */
export const PDF_GEMINI_EXTRACT_MODEL = "gemini-3.5-flash-lite";

const MAX_OUTPUT_TOKENS = 16_384;
const REQUEST_TIMEOUT_MS = 180_000;
const SOURCE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TRANSCRIBE_PROMPT = `Transcribe all readable editorial text from this PDF.
Output exactly one section per page, in order, using this marker on its own line:

## PAGE N

Preserve Arabic and English faithfully. Do not invent text from photographs or unclear decorative lettering; write [UNCLEAR] for those fragments. Do not treat image descriptions as facts. Do not omit pages or merge pages.`;

export type PdfGeminiExtractClient = {
  models: {
    generateContent: (input: {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    }) => Promise<{
      text?: string | null;
      candidates?: Array<{ finishReason?: string | null } | null> | null;
    }>;
  };
};

/** Explicit local gate: off by default, never hosted production, allowlisted source IDs only. */
export function isPdfGeminiExtractAuthorized(sourceId?: string): boolean {
  if (process.env.VELORA_PDF_GEMINI_EXTRACT_ENABLED !== "true") return false;
  if (process.env.VERCEL_ENV === "production") return false;
  if (!sourceId || !SOURCE_ID.test(sourceId)) return false;
  const allow = (process.env.VELORA_PDF_GEMINI_EXTRACT_SOURCE_IDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => SOURCE_ID.test(value));
  if (allow.length === 0) return false;
  return allow.includes(sourceId.toLowerCase());
}

export function validateGeminiPdfPages(text: string, expectedPages: number): boolean {
  if (!Number.isSafeInteger(expectedPages) || expectedPages < 1 || expectedPages > 30) return false;
  const markers = [...text.matchAll(/^## PAGE (\d+)\s*$/gm)].map((match) => Number(match[1]));
  if (markers.length !== expectedPages) return false;
  for (let page = 1; page <= expectedPages; page += 1) {
    if (markers[page - 1] !== page) return false;
  }
  const bodies = text.split(/^## PAGE \d+\s*$/m).slice(1);
  if (bodies.length !== expectedPages) return false;
  return bodies.every((body) => body.replace(/\s+/g, "").length > 0);
}

function createDefaultClient(): PdfGeminiExtractClient | null {
  const apiKey = getSecureProviderKey("google");
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } },
  }) as unknown as PdfGeminiExtractClient;
}

/**
 * Sends the already-downloaded PDF bytes to Gemini. Does not re-upload to Storage
 * or Files API. Returns null on any incomplete/unauthorized/uncertain outcome.
 */
export async function extractPdfWithGemini(
  bytes: Uint8Array,
  expectedPages: number,
  context: PdfDiagnosticContext = {},
  client: PdfGeminiExtractClient | null = createDefaultClient(),
): Promise<string | null> {
  if (!isPdfGeminiExtractAuthorized(context.sourceId)) {
    reportPdfPreparationFailure("external_extract", "external_not_authorized", context);
    return null;
  }
  if (!client) {
    reportPdfPreparationFailure("external_extract", "external_provider_unavailable", context);
    return null;
  }
  if (!Number.isSafeInteger(expectedPages) || expectedPages < 1 || expectedPages > 30 || bytes.byteLength < 1) {
    reportPdfPreparationFailure("bounds", "page_limit", context);
    return null;
  }

  try {
    const response = await client.models.generateContent({
      model: PDF_GEMINI_EXTRACT_MODEL,
      contents: [
        createPartFromBase64(Buffer.from(bytes).toString("base64"), "application/pdf"),
        TRANSCRIBE_PROMPT,
      ],
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } },
      },
    });

    const finishReasons = (response.candidates ?? [])
      .map((candidate) => candidate?.finishReason ?? null)
      .filter((reason): reason is string => typeof reason === "string" && reason.length > 0);
    if (finishReasons.length === 0 || finishReasons.some((reason) => reason !== "STOP")) {
      reportPdfPreparationFailure("external_extract", "external_response_truncated", context);
      return null;
    }

    const text = typeof response.text === "string" ? response.text.trim() : "";
    if (!text) {
      reportPdfPreparationFailure("external_extract", "external_empty_response", context);
      return null;
    }
    if (!validateGeminiPdfPages(text, expectedPages)) {
      reportPdfPreparationFailure("external_extract", "external_page_coverage", context);
      return null;
    }
    return text;
  } catch {
    reportPdfPreparationFailure("external_extract", "external_request_failed", context);
    return null;
  }
}
