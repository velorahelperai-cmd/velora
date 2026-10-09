import { createHash } from "node:crypto";
import { KNOWLEDGE_MAX_FILE_BYTES } from "@/lib/knowledge/constants";
import { ANSWER_MAX_SOURCES } from "@/lib/answers/constants";
import { objectGenerationMatches, type StorageObjectGeneration } from "@/lib/knowledge/invalidate";

export type ReviewFile = {
  id: string; company_id: string; storage_path: string; byte_size: number;
  prepared_file_sha256: string | null; prepared_content_version: number | null; content_version: number;
};
export type ReviewStorageReader = {
  generation(path: string, signal: AbortSignal): Promise<StorageObjectGeneration | null>;
  download(path: string, signal: AbortSignal): Promise<Uint8Array>;
};
export type FileObservation = {
  source_id: string; sha256: string; byte_size: number;
  object_id: string; object_updated_at: string; observed_at: string;
};
export type ReviewFileFailure = "FILE_REPREPARE_REQUIRED" | "FILE_CHANGED" | "FILE_UNAVAILABLE" | "FILE_LIMIT";
type Result = { ok: true; observations: FileObservation[] } | { ok: false; code: ReviewFileFailure };

export async function checkReviewFiles(
  companyId: string, files: ReviewFile[], reader: ReviewStorageReader,
  limits = { fileTimeoutMs: 10_000, totalTimeoutMs: 30_000 },
): Promise<Result> {
  if (files.length > ANSWER_MAX_SOURCES) return { ok: false, code: "FILE_LIMIT" };
  for (const file of files) {
    if (file.company_id !== companyId || !file.storage_path.startsWith(`${companyId}/${file.id}/`)
      || file.storage_path.includes("\\") || file.storage_path.split("/").some(part => part === "." || part === "..")) return { ok: false, code: "FILE_CHANGED" };
    if (!Number.isSafeInteger(file.byte_size) || file.byte_size < 1 || file.byte_size > KNOWLEDGE_MAX_FILE_BYTES) return { ok: false, code: "FILE_LIMIT" };
    if (!file.prepared_file_sha256 || !/^[a-f0-9]{64}$/.test(file.prepared_file_sha256)
      || file.prepared_content_version !== file.content_version) return { ok: false, code: "FILE_REPREPARE_REQUIRED" };
  }
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), Math.min(30_000, limits.totalTimeoutMs));
  let next = 0, failure: ReviewFileFailure | null = null;
  const observations: FileObservation[] = [];
  async function worker() {
    while (next < files.length && !failure) {
      const file = files[next++]!;
      const local = new AbortController();
      const abort = () => local.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      if (controller.signal.aborted) local.abort();
      const timer = setTimeout(abort, Math.min(10_000, limits.fileTimeoutMs));
      let rejectOnAbort: (() => void) | undefined;
      try {
        const aborted = new Promise<never>((_, reject) => {
          rejectOnAbort = () => reject(Error("READ_ABORTED"));
          local.signal.addEventListener("abort", rejectOnAbort, { once: true });
          if (local.signal.aborted) rejectOnAbort();
        });
        const read = async () => {
          const before = await reader.generation(file.storage_path, local.signal);
          if (!before) return { ok: false, code: "FILE_UNAVAILABLE" } as const;
          const bytes = await reader.download(file.storage_path, local.signal);
          if (bytes.byteLength > KNOWLEDGE_MAX_FILE_BYTES) return { ok: false, code: "FILE_LIMIT" } as const;
          const after = await reader.generation(file.storage_path, local.signal);
          const digest = createHash("sha256").update(bytes).digest("hex");
          if (!objectGenerationMatches(before, after) || bytes.byteLength !== file.byte_size || digest !== file.prepared_file_sha256) return { ok: false, code: "FILE_CHANGED" } as const;
          return { ok: true, observation: {
            source_id: file.id, sha256: digest, byte_size: bytes.byteLength,
            object_id: before.objectId, object_updated_at: before.updatedAt, observed_at: new Date().toISOString(),
          } } as const;
        };
        const result = await Promise.race([read(), aborted]);
        if (result.ok) observations.push(result.observation);
        else { failure = result.code; controller.abort(); }
      } catch (error) { failure ??= error instanceof Error && error.message === "FILE_LIMIT" ? "FILE_LIMIT" : "FILE_UNAVAILABLE"; controller.abort(); }
      finally {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", abort);
        if (rejectOnAbort) local.signal.removeEventListener("abort", rejectOnAbort);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(2, files.length) }, worker));
    return failure ? { ok: false, code: failure } : { ok: true, observations: observations.sort((a, b) => a.source_id.localeCompare(b.source_id)) };
  } finally { clearTimeout(totalTimer); }
}
