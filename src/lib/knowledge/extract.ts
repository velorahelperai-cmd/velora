import mammoth from "mammoth";
import { extractText, getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { extractPdfWithGemini, isPdfGeminiExtractAuthorized } from "./pdf-gemini-extract";
import type { PdfDiagnosticContext } from "./pdf-ocr";

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

async function pdfText(bytes: Uint8Array, context:PdfDiagnosticContext): Promise<string> {
  // PDF.js may transfer/detach its input. Keep the original downloaded buffer
  // intact so G03 hashes exactly the bytes used for this extraction.
  const pdf = await getDocumentProxy(bytes.slice());
  const result = await extractText(pdf);
  const { OPS } = await getResolvedPDFJS();
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup, OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat]);
  let hasImage = false;
  for (let page = 1; page <= pdf.numPages && !hasImage; page++) {
    const operators = await (await pdf.getPage(page)).getOperatorList();
    hasImage = operators.fnArray.some(op => imageOps.has(op));
  }
  if (hasImage || result.text.some(page => usableText(page).length < MIN_TEXT_CHARS)) {
    // Explicit local Gemini allowlist only. Never fall through to weak OCR for an
    // authorized external attempt — incomplete provider output must fail closed.
    if (isPdfGeminiExtractAuthorized(context.sourceId)) {
      const gemini = await extractPdfWithGemini(bytes, pdf.numPages, context);
      if (gemini === null) throw new Error("pdf_ocr_unavailable");
      if (gemini.length > MAX_TEXT_CHARS) {
        const { reportPdfPreparationFailure } = await import("./pdf-ocr");
        reportPdfPreparationFailure("bounds", "text_limit", context);
        throw new Error("pdf_ocr_unavailable");
      }
      return gemini;
    }
    const { readScannedPdf, reportPdfPreparationFailure } = await import("./pdf-ocr");
    const ocr = await readScannedPdf(bytes, result.text, context);
    if (ocr === null) throw new Error("pdf_ocr_unavailable");
    if (ocr.length > MAX_TEXT_CHARS) {reportPdfPreparationFailure("bounds","text_limit",context);throw new Error("pdf_ocr_unavailable");}
    return ocr;
  }
  return result.text.join("\n");
}

async function docxText(bytes: Uint8Array): Promise<string> {
  const parsed = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return parsed.value ?? "";
}

/** Turns a supported file into saved text; OCR does not approve a source. */
export async function extractKnowledgeText(input: {
  sourceId?: string;
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
        ? await pdfText(input.bytes,{sourceId:input.sourceId})
        : kind === "docx"
          ? await docxText(input.bytes)
          : new TextDecoder("utf-8", { fatal: false }).decode(input.bytes);
    const text = usableText(raw);
    if (text.length < MIN_TEXT_CHARS) return { ok: false, code: "no_text" };
    return { ok: true, text: text.slice(0, MAX_TEXT_CHARS) };
  } catch (error) {
    if(kind==="pdf"&&!(error instanceof Error&&error.message==="pdf_ocr_unavailable")) {
      const { reportPdfPreparationFailure } = await import("./pdf-ocr");
      reportPdfPreparationFailure("native_extraction","native_extraction_failed",{sourceId:input.sourceId});
    }
    return { ok: false, code: kind === "txt" || (error instanceof Error && error.message === "pdf_ocr_unavailable") ? "extract_failed" : "corrupt" };
  }
}
