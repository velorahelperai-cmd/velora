import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorker, OEM } from "tesseract.js";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { logEvent } from "@/lib/logging/logger.mjs";

export type PdfDiagnosticContext = { sourceId?: string; page?: number };
export type PdfFailureStage = "native_extraction" | "render" | "local_worker" | "timeout" | "busy" | "bounds" | "external_extract";
export type PdfFailureReason = "native_extraction_failed" | "pdf_open_failed" | "page_count_mismatch" | "page_limit" | "text_limit" | "language_data_unavailable" | "worker_initialization_failed" | "page_read_failed" | "invalid_page_geometry" | "render_failed" | "recognition_failed" | "ocr_timeout" | "worker_busy" | "external_not_authorized" | "external_provider_unavailable" | "external_request_failed" | "external_response_truncated" | "external_empty_response" | "external_page_coverage";
/** Fixed categories and bounded identifiers only: never log document text or raw exceptions. */
export function reportPdfPreparationFailure(stage:PdfFailureStage,reason:PdfFailureReason,context:PdfDiagnosticContext={}) {
  const sourceId=typeof context.sourceId==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.sourceId)?context.sourceId:null;
  const page=Number.isSafeInteger(context.page)&&context.page!>0?context.page:null;
  const retryPolicy=stage==="busy"||stage==="timeout"?"after_worker_idle":stage==="bounds"?"input_change_required":stage==="external_extract"?"after_explicit_local_authorization":"after_local_diagnosis";
  logEvent("warn","knowledge.pdf.preparation_failed",{stage,failure_code:reason,source_id:sourceId,page,retry_policy:retryPolicy});
}

// Bounds apply before rendering: uploaded PDFs are untrusted and may contain
// enormous pages or decompression bombs. Fail closed, never save partial OCR.
const MAX_PAGES = 30;
const MAX_PIXELS = 4_000_000;
const MAX_SECONDS = 120_000;
let active = false;

export async function readScannedPdf(bytes: Uint8Array, nativePages: string[], context:PdfDiagnosticContext={}): Promise<string | null> {
  if (active) {reportPdfPreparationFailure("busy","worker_busy",context);return null;}
  if (nativePages.length < 1 || nativePages.length > MAX_PAGES) {reportPdfPreparationFailure("bounds","page_limit",context);return null;}
  active = true;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  let langDir: string | undefined;
  let running: Promise<string> | undefined;
  let stage:PdfFailureStage="local_worker";
  let reason:PdfFailureReason="language_data_unavailable";
  let pageNumber:number|undefined;
  try {
    langDir = await mkdtemp(path.join(os.tmpdir(), "velora-ocr-"));
    const languages = [
      { code: "ara", root: path.dirname(require.resolve("@tesseract.js-data/ara")) },
      { code: "eng", root: path.dirname(require.resolve("@tesseract.js-data/eng")) },
    ];
    await Promise.all(languages.map(({code, root}) =>
      copyFile(path.join(root, "4.0.0_best_int", `${code}.traineddata.gz`), path.join(langDir!, `${code}.traineddata.gz`))));
    stage="native_extraction";reason="pdf_open_failed";
    const pdf = await getDocumentProxy(bytes.slice());
    if (pdf.numPages !== nativePages.length) {reportPdfPreparationFailure("native_extraction","page_count_mismatch",context);return null;}
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; if (worker) void worker.terminate().catch(() => {}); reject(new Error("ocr_timeout")); }, MAX_SECONDS);
    });
    running = (async () => {
      stage="local_worker";reason="worker_initialization_failed";
      worker = await createWorker("ara+eng", OEM.LSTM_ONLY, { cacheMethod: "none", langPath: langDir });
      if (expired) { await worker.terminate(); throw new Error("ocr_timeout"); }
      const pages: string[] = [];
      for (let i = 0; i < nativePages.length; i++) {
        if (expired) throw new Error("ocr_timeout");
        pageNumber=i+1;stage="render";reason="page_read_failed";
        const page = await pdf.getPage(i + 1);
        reason="invalid_page_geometry";
        const view = page.getViewport({ scale: 1 });
        if (!Number.isFinite(view.width * view.height) || view.width <= 0 || view.height <= 0) throw new Error("invalid_page");
        const scale = Math.min(1.5, Math.sqrt(MAX_PIXELS / (view.width * view.height)));
        reason="render_failed";
        const image = await renderPageAsImage(pdf, i + 1, { scale, canvasImport: () => import("@napi-rs/canvas") });
        if (expired) throw new Error("ocr_timeout");
        stage="local_worker";reason="recognition_failed";
        const result = await worker.recognize(Buffer.from(image));
        const text = result.data.text.trim();
        pages.push([nativePages[i]?.trim(), text].filter(Boolean).join("\n"));
      }
      return pages.join("\n\n");
    })();
    return await Promise.race([running, deadline]);
  } catch { reportPdfPreparationFailure(expired?"timeout":stage,expired?"ocr_timeout":reason,{...context,page:pageNumber});return null; }
  finally {
    if (timer) clearTimeout(timer);
    const clean = async () => {
      if (worker && !expired) await worker.terminate().catch(() => {});
      if (langDir) await rm(langDir, { recursive: true, force: true }).catch(() => {});
      active = false;
    };
    if (expired && running) void running.catch(() => {}).then(clean);
    else await clean();
  }
}
