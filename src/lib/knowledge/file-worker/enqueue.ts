import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { knowledgeFileWorkerEnabled } from "./gate";
import { mapClaimToEnqueue, type OwnerEnqueueResult } from "./protocol";

export type EnqueueKnowledgeFileInput = {
  actorId: string;
  sessionId: string;
  companyId: string;
  branchId: string;
  sourceId: string;
  expectedVersion: number;
  expectedUpdatedAt: string;
  storagePath: string;
  objectId: string;
  objectUpdatedAt: string;
  /** Stable attempt id for lost-response replay; minted when omitted. */
  attemptId?: string;
  /** When recovering an expired pre-provider lease, name the prior attempt. */
  recoverAttemptId?: string | null;
  leaseMs?: number;
};

/**
 * Owner path: claim a durable attempt and return queued/processing immediately.
 * Does not download, extract, or call a paid provider.
 * Requires installed g03_claim_file_attempt (review SQL package). Fail closed if missing.
 */
export async function enqueueKnowledgeFilePrepare(
  input: EnqueueKnowledgeFileInput,
): Promise<OwnerEnqueueResult> {
  if (!knowledgeFileWorkerEnabled()) {
    return { mode: "unavailable", code: "UNAVAILABLE" };
  }
  const admin = createAdminClient();
  if (!admin || typeof admin.rpc !== "function") {
    return { mode: "unavailable", code: "UNAVAILABLE" };
  }
  const attemptId = input.attemptId ?? randomUUID();
  const leaseMs = Number.isFinite(input.leaseMs) && (input.leaseMs as number) > 0
    ? Math.floor(input.leaseMs as number)
    : 15 * 60_000;
  const expiresAt = new Date(Date.now() + leaseMs).toISOString();
  try {
    const { data, error } = await admin.rpc("g03_claim_file_attempt" as never, {
      p_actor_id: input.actorId,
      p_session_id: input.sessionId,
      p_company_id: input.companyId,
      p_source_id: input.sourceId,
      p_attempt_id: attemptId,
      p_branch_id: input.branchId,
      p_expected_version: input.expectedVersion,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_storage_path: input.storagePath,
      p_object_id: input.objectId,
      p_object_updated_at: input.objectUpdatedAt,
      p_expires_at: expiresAt,
      p_recover_attempt_id: input.recoverAttemptId ?? null,
    } as never);
    if (error) {
      const message = String((error as { message?: string }).message ?? "");
      if (/g03_claim_file_attempt|function .* does not exist|42883/i.test(message)) {
        return { mode: "unavailable", code: "WORKER_SCHEMA_REQUIRED" };
      }
      return { mode: "unavailable", code: "UNAVAILABLE" };
    }
    const row = data as { ok?: boolean; code?: string; attemptId?: string; replayed?: boolean } | null;
    if (!row || typeof row !== "object") return { mode: "unavailable", code: "UNAVAILABLE" };
    return mapClaimToEnqueue({
      ok: row.ok === true,
      code: typeof row.code === "string" ? row.code : undefined,
      attemptId: typeof row.attemptId === "string" ? row.attemptId : attemptId,
      replayed: row.replayed === true,
    });
  } catch {
    return { mode: "unavailable", code: "UNAVAILABLE" };
  }
}
