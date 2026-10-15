import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { KNOWLEDGE_BUCKET } from "@/lib/knowledge/constants";
import { readBoundedKnowledgeStream } from "@/lib/knowledge/bounded-read";
import { authorizeSetupFile, type SetupFileRpc } from "./setup-file";
import { runSetupFileDeletion, validSetupFileDeletionClaim, type SetupFileDeletionClaim } from "./setup-file-worker";

export async function downloadSetupFile(db: SetupFileRpc, userId: string, companyId: string, sourceId: string) {
  const before = await authorizeSetupFile(db, userId, companyId, sourceId); if (!before) return null;
  const admin = createAdminClient(); if (!admin) return null;
  const signal = AbortSignal.timeout(10_000);
  const { data, error } = await admin.storage.from(KNOWLEDGE_BUCKET).download(before.path, {}, { signal, cache: "no-store" }).asStream();
  if (error || !data) return null;
  const bytes = await readBoundedKnowledgeStream(data, signal);
  const after = await authorizeSetupFile(db, userId, companyId, sourceId);
  if (!after || after.objectId !== before.objectId || after.objectUpdatedAt !== before.objectUpdatedAt || bytes.byteLength !== before.byteSize) return null;
  return { bytes, binding: after };
}

export async function runConfiguredSetupFileDeletion(enabled: boolean) {
  if (!enabled) return { ok: false, code: "SETUP_FILE_WORKER_DISABLED" };
  const admin = createAdminClient(); if (!admin) return { ok: false, code: "UNAVAILABLE" };
  const db = admin as unknown as SetupFileRpc;
  return runSetupFileDeletion({
    claim: async () => {
      const { data, error } = await db.rpc("master_claim_setup_file_deletion", {});
      if (error || !data || typeof data !== "object") return { ok: false, code: "UNAVAILABLE" };
      const result = data as { ok?: boolean; code?: string; claim?: SetupFileDeletionClaim | null };
      if (!result.ok) return { ok: false, code: result.code ?? "UNAVAILABLE" };
      if (result.claim === null) return { ok: true, claim: null };
      const c = result.claim;
      if (!c || typeof c.path !== "string" || typeof c.jobId !== "string" || typeof c.claimToken !== "string" || !validSetupFileDeletionClaim(c)) return { ok: false, code: "UNAVAILABLE" };
      return { ok: true, claim: c };
    },
    finish: async (jobId, claimToken, outcome) => {
      const { data, error } = await db.rpc("master_finish_setup_file_deletion", { p_job_id: jobId, p_claim_token: claimToken, p_outcome: outcome }); return !error && data === true;
    },
  }, {
    inspect: async path => {
      const { data, error } = await db.rpc("master_inspect_setup_file_object", { p_path: path }); if (error) throw Error("OBJECT_INSPECTION_UNAVAILABLE");
      const exists = await admin.storage.from(KNOWLEDGE_BUCKET).exists(path); if (exists.error) throw Error("STORAGE_INSPECTION_UNAVAILABLE");
      if (!exists.data) return null;
      const o = data as { id?: string; updatedAt?: string } | null;
      if (!o?.id || !o.updatedAt) throw Error("OBJECT_GENERATION_UNAVAILABLE");
      return { id: o.id, updatedAt: o.updatedAt };
    },
    remove: async path => { const { error } = await admin.storage.from(KNOWLEDGE_BUCKET).remove([path]); if (error) throw Error("STORAGE_REMOVAL_UNCONFIRMED"); },
  });
}
