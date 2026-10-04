import mammoth from "mammoth";
import { extractText } from "unpdf";

export type PrepareFailureCode = "no_text" | "corrupt" | "unsupported" | "extract_failed";

export type ExtractResult =
  | { ok: true; text: string }
  | { ok: false; code: PrepareFailureCode };

const MIN_TEXT_CHARS = 8;
const MAX_TEXT_CHARS = 200_000;

function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i < 0) return "";
  return fileName.slice(i + 1).toLowerCase();
}

export function prepareKind(
  fileName: string | null | undefined,
  contentType: string | null | undefined,
): "pdf" | "txt" | "docx" | null {
  const ext = extensionOf(fileName ?? "");
  const mime = (contentType ?? "").toLowerCase();
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (ext === "txt" || mime === "text/plain") return "txt";
  if (
    ext === "docx" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return null;
}

function usableText(value: string): string {
  return value.replace(/\u0000/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const result = await extractText(bytes, { mergePages: true });
  return Array.isArray(result.text) ? result.text.join("\n") : result.text;
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const parsed = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return parsed.value ?? "";
}

/** Turns a supported file into saved text. Empty or image-only PDFs are not ready. */
export async function extractKnowledgeText(input: {
  fileName: string | null;
  contentType: string | null;
  bytes: Uint8Array;
}): Promise<ExtractResult> {
  const kind = prepareKind(input.fileName, input.contentType);
  if (!kind) return { ok: false, code: "unsupported" };
  if (input.bytes.byteLength === 0) return { ok: false, code: "corrupt" };

  try {
    const raw =
      kind === "pdf"
        ? await pdfText(input.bytes)
        : kind === "docx"
          ? await docxText(input.bytes)
          : new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    const text = usableText(raw);
    if (text.length < MIN_TEXT_CHARS) return { ok: false, code: "no_text" };
    return { ok: true, text: text.slice(0, MAX_TEXT_CHARS) };
  } catch {
    return { ok: false, code: kind === "txt" ? "extract_failed" : "corrupt" };
  }
}
