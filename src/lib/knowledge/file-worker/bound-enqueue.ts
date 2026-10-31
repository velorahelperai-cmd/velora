import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPreparableKnowledgeFile } from "@/lib/knowledge/constants";
import {
  readExactStorageGeneration,
  type ExactGenerationRpc,
} from "@/lib/knowledge/exact-generation";
import { enqueueKnowledgeFilePrepare } from "./enqueue";
import { knowledgeFileWorkerEnabled } from "./gate";
import type { OwnerEnqueueResult } from "./protocol";
import { classifyStuckAttempt, type ProviderDispatchEvidence } from "./recovery";

export type BoundEnqueueInput = {
  actorId: string;
  sessionId: string;
  companyId: string;
  branchId: string;
  sourceId: string;
  /** Stable id for lost-response replay; minted when omitted on a fresh claim. */
  attemptId?: string;
  /** Explicit recovery of a named expired pre-provider attempt. */
  recoverAttemptId?: string;
};

async function readAttemptView(sourceId: string): Promise<{
  attemptId: string;
  state: "running" | "published" | "failed";
  expiresAt: string;
  providerDispatch: ProviderDispatchEvidence;
  actorId: string;
  sessionId: string;
  failureCode: string | null;
  sourceStatus: string;
} | null> {
  const admin = createAdminClient();
  if (!admin || typeof admin.rpc !== "function") return null;
  const { data, error } = await admin.rpc("g03_read_file_attempt" as never, {
    p_source_id: sourceId,
  } as never);
  if (error || !data || typeof data !== "object") return null;
  const a = data as Record<string, unknown>;
  if (a.ok === false) return null;
  if (
    typeof a.attempt_id !== "string"
    || typeof a.state !== "string"
    || typeof a.expires_at !== "string"
    || typeof a.actor_id !== "string"
    || typeof a.session_id !== "string"
  ) {
    return null;
  }
  if (a.state !== "running" && a.state !== "published" && a.state !== "failed") return null;
  const dispatch = a.provider_dispatch;
  const providerDispatch: ProviderDispatchEvidence =
    dispatch === "dispatched" || dispatch === "unknown" || dispatch === "verified"
      ? dispatch
      : "none";

  let sourceStatus = "processing";
  let failureCode: string | null = null;
  const { data: source } = await admin
    .from("knowledge_sources")
    .select("status,failure_code")
    .eq("id", sourceId)
    .maybeSingle();
  if (source && typeof (source as { status?: string }).status === "string") {
    sourceStatus = (source as { status: string }).status;
    const fc = (source as { failure_code?: string | null }).failure_code;
    failureCode = typeof fc === "string" ? fc : null;
  }

  return {
    attemptId: a.attempt_id,
    state: a.state,
    expiresAt: a.expires_at,
    providerDispatch,
    actorId: a.actor_id,
    sessionId: a.session_id,
    failureCode,
    sourceStatus,
  };
}

/**
 * After branch bind: resolve source + exact object generation, then claim a
 * durable attempt. No download/extract/provider call.
 * Processing rows: same-attemptId replay, expired pre-provider recovery, or review hold.
 */
export async function enqueueBoundBranchKnowledgeFilePrepare(
  input: BoundEnqueueInput,
): Promise<OwnerEnqueueResult> {
  if (!knowledgeFileWorkerEnabled()) {
    return { mode: "unavailable", code: "UNAVAILABLE" };
  }
  try {
    const client = await createClient();
    if (!client || typeof client.from !== "function") {
      return { mode: "unavailable", code: "UNAVAILABLE" };
    }
    const loaded = await client
      .from("knowledge_sources")
      .select("id,company_id,kind,status,file_name,storage_path,content_version,updated_at,failure_code")
      .eq("id", input.sourceId)
      .eq("company_id", input.companyId)
      .eq("kind", "file")
      .maybeSingle();
    if (loaded.error || !loaded.data) {
      return { mode: "unavailable", code: "UNAVAILABLE" };
    }
    const source = loaded.data as {
      id: string;
      status: string;
      file_name: string | null;
      storage_path: string | null;
      content_version: number | null;
      updated_at: string;
      failure_code: string | null;
    };
    if (
      !source.storage_path
      || !isPreparableKnowledgeFile(source.file_name)
      || !Number.isSafeInteger(source.content_version)
      || (source.content_version as number) < 1
      || typeof source.updated_at !== "string"
      || !source.updated_at
    ) {
      return { mode: "unavailable", code: "UNAVAILABLE" };
    }

    let attemptId = input.attemptId;
    let recoverAttemptId: string | null = input.recoverAttemptId ?? null;

    if (source.status === "processing" || source.failure_code === "provider_outcome_unknown") {
      const view = await readAttemptView(source.id);
      if (!view) {
        return { mode: "busy", code: "LEGACY_PROCESSING_REVIEW_REQUIRED" };
      }
      const decision = classifyStuckAttempt(
        {
          attemptId: view.attemptId,
          state: view.state,
          expiresAt: view.expiresAt,
          providerDispatch: view.providerDispatch,
          sourceStatus: view.sourceStatus,
          failureCode: view.failureCode ?? source.failure_code,
        },
        Date.now(),
      );
      if (decision.action === "review_required") {
        // Surface a durable review hold so the owner UI is not stuck on bare processing.
        const admin = createAdminClient();
        if (admin && typeof admin.rpc === "function" && view.state === "running") {
          await admin.rpc("g03_control_file_attempt" as never, {
            p_actor_id: view.actorId,
            p_session_id: view.sessionId,
            p_company_id: input.companyId,
            p_source_id: input.sourceId,
            p_attempt_id: view.attemptId,
            p_branch_id: input.branchId,
            p_action: "fail",
            p_expires_at: null,
            p_failure_code: "provider_outcome_unknown",
          } as never);
        }
        return {
          mode: "busy",
          code: "REVIEW_REQUIRED",
          attemptId: view.attemptId,
        };
      }
      if (decision.action === "wait") {
        // Lost-response replay: same attemptId, same actor/session, no new claim row.
        if (
          view.actorId === input.actorId
          && view.sessionId === input.sessionId
          && view.state === "running"
        ) {
          attemptId = view.attemptId;
          recoverAttemptId = null;
        } else {
          return { mode: "busy", code: "BUSY", attemptId: view.attemptId };
        }
      } else if (decision.action === "recover_expired") {
        attemptId = randomUUID();
        recoverAttemptId = decision.recoverAttemptId;
      } else if (decision.action === "none" && view.state === "failed") {
        // Fall through to a fresh claim from failed (non-review) status.
        attemptId = input.attemptId ?? randomUUID();
        recoverAttemptId = null;
      } else {
        return { mode: "busy", code: "BUSY", attemptId: view.attemptId };
      }
    } else if (!["draft", "stored", "ready", "failed"].includes(source.status)) {
      return { mode: "unavailable", code: "UNAVAILABLE" };
    } else {
      attemptId = input.attemptId ?? randomUUID();
    }

    const generation = await readExactStorageGeneration(client as unknown as ExactGenerationRpc, {
      sourceId: source.id,
      companyId: input.companyId,
      storagePath: source.storage_path,
      action: "resubmit",
    });
    if (generation.status !== "ok") {
      return { mode: "unavailable", code: "UNAVAILABLE" };
    }

    return enqueueKnowledgeFilePrepare({
      actorId: input.actorId,
      sessionId: input.sessionId,
      companyId: input.companyId,
      branchId: input.branchId,
      sourceId: input.sourceId,
      expectedVersion: source.content_version as number,
      expectedUpdatedAt: source.updated_at,
      storagePath: source.storage_path,
      objectId: generation.generation.objectId,
      objectUpdatedAt: generation.generation.updatedAt,
      attemptId,
      recoverAttemptId,
    });
  } catch {
    return { mode: "unavailable", code: "UNAVAILABLE" };
  }
}
