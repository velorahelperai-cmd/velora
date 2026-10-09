import { KNOWLEDGE_BUCKET } from "@/lib/knowledge/constants";
import { generationFromListedObject } from "@/lib/knowledge/invalidate";
import { readBoundedKnowledgeStream } from "@/lib/knowledge/bounded-read";
import { checkReviewFiles, type ReviewFile, type ReviewStorageReader } from "./review-file-proof";

export type ReviewProofInput = {
  action: "submit" | "resubmit" | "approve";
  companyId: string; expectedRevision?: number | null; numberOwnership?: "own" | "new" | null;
  whatsappNumber?: string | null; ready?: boolean | null; ownerNote?: string | null;
};
type RpcResult = { data: unknown; error: { message?: string } | null };
export type ReviewRpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };
const failureCodes = new Set(["CONFLICT", "PROFILE_INCOMPLETE", "KNOWLEDGE_INCOMPLETE", "FILE_REPREPARE_REQUIRED", "FILE_CHANGED", "FILE_UNAVAILABLE", "FILE_LIMIT", "SOURCE_LIMIT", "PROOF_REQUIRED", "PROOF_EXPIRED"]);
type ProofResult = { ok: true } | { ok: false; code: string; request?: unknown };

export async function prepareReviewProof(
  authenticated: ReviewRpc, service: ReviewRpc | null, input: ReviewProofInput,
  reader?: ReviewStorageReader,
): Promise<ProofResult> {
  if (!service) return { ok: false, code: "UNAVAILABLE" };
  try {
    const { data, error } = await authenticated.rpc("g03_begin_review_check", {
      p_action: input.action, p_company_id: input.companyId, p_expected_revision: input.expectedRevision ?? null,
      p_number_ownership: input.numberOwnership ?? null, p_whatsapp_number: input.whatsappNumber ?? null,
      p_readiness_confirmed: input.ready ?? null, p_owner_note: input.ownerNote ?? null,
    });
    if (error || !data || typeof data !== "object") return { ok: false, code: "UNAVAILABLE" };
    const snapshot = data as Record<string, unknown>;
    if (snapshot.ok !== true) {
      const code = typeof snapshot.code === "string" && failureCodes.has(snapshot.code) ? snapshot.code : "UNAVAILABLE";
      return snapshot.request ? { ok: false, code, request: snapshot.request } : { ok: false, code };
    }
    if (typeof snapshot.check_id !== "string" || !Array.isArray(snapshot.files)) return { ok: false, code: "UNAVAILABLE" };
    const files = snapshot.files as ReviewFile[];
    if (files.length && !reader) return { ok: false, code: "UNAVAILABLE" };
    const observed = files.length ? await checkReviewFiles(input.companyId, files, reader!) : { ok: true as const, observations: [] };
    if (!observed.ok) return observed;
    const completed = await service.rpc("g03_complete_review_check", { p_check_id: snapshot.check_id, p_observations: observed.observations });
    if (completed.error || !completed.data || typeof completed.data !== "object") return { ok: false, code: "UNAVAILABLE" };
    const completion = completed.data as Record<string, unknown>;
    return completion.ok === true ? { ok: true } : { ok: false, code: typeof completion.code === "string" && failureCodes.has(completion.code) ? completion.code : "UNAVAILABLE" };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

// Uses actual installed Storage SDK list/download APIs, not hypothetical metadata APIs.
export function reviewStorageReader(bucket: {
  list(path: string, options: { search: string; limit: number }, parameters: { signal: AbortSignal }): PromiseLike<{ data: { name: string; id?: string | null; updated_at?: string | null }[] | null; error: unknown }>;
  download(path: string, options: Record<string, never>, parameters: { signal: AbortSignal; cache: "no-store" }): {
    asStream(): PromiseLike<{ data: ReadableStream<Uint8Array> | null; error: unknown }>;
  };
}): ReviewStorageReader {
  return {
    async generation(path, signal) {
      const slash = path.lastIndexOf("/");
      const name = path.slice(slash + 1);
      const result = await bucket.list(path.slice(0, slash), { search: name, limit: 50 }, { signal });
      if (result.error) throw Error("STORAGE_UNAVAILABLE");
      return generationFromListedObject(result.data?.find(object => object.name === name));
    },
    async download(path, signal) {
      const result = await bucket.download(path, {}, { signal, cache: "no-store" }).asStream();
      if (result.error || !result.data) throw Error("STORAGE_UNAVAILABLE");
      return readBoundedKnowledgeStream(result.data, signal);
    },
  };
}

export { KNOWLEDGE_BUCKET };
