import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { KNOWLEDGE_BUCKET } from "@/lib/knowledge/constants";
import { extractKnowledgeText, prepareKind } from "@/lib/knowledge/extract";
import { buildWorkerObservation, type WorkerObservation } from "./observation";
import {
  classifyStuckAttempt,
  PROVIDER_OUTCOME_UNKNOWN_CODE,
  type ProviderDispatchEvidence,
} from "./recovery";
import { knowledgeFileWorkerProviderExtractEnabled } from "./gate";
import { runKnowledgeFileAttempt, type FileWorkerPorts } from "./run";

export type DueAttemptRow = {
  sourceId: string;
  attemptId: string;
  companyId: string;
  branchId: string;
  actorId: string;
  sessionId: string;
  expiresAt: string;
  providerDispatch: ProviderDispatchEvidence;
  contentVersion: number;
  storagePath: string;
  objectId: string;
  objectUpdatedAt: string;
};

export type BatchPorts = {
  listDue: (limit: number) => Promise<DueAttemptRow[]>;
  forAttempt: (row: DueAttemptRow) => FileWorkerPorts;
  nowMs: () => number;
};

/**
 * One worker tick: process up to `limit` running attempts.
 * Unknown provider outcomes are marked review-required (no blind retry).
 * Expired pre-provider leases are left for owner recovery (new attemptId).
 */
export async function processKnowledgeFileWorkerBatch(
  ports: BatchPorts,
  limit = 10,
): Promise<WorkerObservation> {
  const nowMs = ports.nowMs();
  let due: DueAttemptRow[] = [];
  try {
    due = await ports.listDue(limit);
  } catch {
    return buildWorkerObservation({
      nowMs,
      ok: false,
      code: "LIST_UNAVAILABLE",
      backlog: 0,
      processed: 0,
      extracted: 0,
      unknown: 0,
      failed: 0,
      reviewRequired: 0,
      oldestDueExpiresAtMs: null,
    });
  }

  let processed = 0;
  let extracted = 0;
  let unknown = 0;
  let failed = 0;
  let reviewRequired = 0;
  let oldestDueExpiresAtMs: number | null = null;

  for (const row of due) {
    const exp = Date.parse(row.expiresAt);
    if (Number.isFinite(exp)) {
      oldestDueExpiresAtMs =
        oldestDueExpiresAtMs == null ? exp : Math.min(oldestDueExpiresAtMs, exp);
    }

    const decision = classifyStuckAttempt(
      {
        attemptId: row.attemptId,
        state: "running",
        expiresAt: row.expiresAt,
        providerDispatch: row.providerDispatch,
        sourceStatus: "processing",
        failureCode: null,
      },
      nowMs,
    );

    if (decision.action === "review_required") {
      processed += 1;
      unknown += 1;
      reviewRequired += 1;
      const attemptPorts = ports.forAttempt(row);
      await attemptPorts.failAttempt({
        sourceId: row.sourceId,
        attemptId: row.attemptId,
        code: PROVIDER_OUTCOME_UNKNOWN_CODE,
      });
      continue;
    }

    if (decision.action === "recover_expired") {
      // Pre-provider expiry: do not extract; owner recovers with a new attemptId.
      processed += 1;
      failed += 1;
      continue;
    }

    const result = await runKnowledgeFileAttempt(
      { sourceId: row.sourceId, attemptId: row.attemptId },
      ports.forAttempt(row),
    );
    processed += 1;
    if (result.extracted) extracted += 1;
    if (result.code === "PROVIDER_OUTCOME_UNKNOWN") {
      unknown += 1;
      reviewRequired += 1;
      const attemptPorts = ports.forAttempt(row);
      await attemptPorts.failAttempt({
        sourceId: row.sourceId,
        attemptId: row.attemptId,
        code: PROVIDER_OUTCOME_UNKNOWN_CODE,
      });
    } else if (!result.ok) {
      failed += 1;
    }
  }

  return buildWorkerObservation({
    nowMs,
    ok: true,
    code: due.length === 0 ? "IDLE" : reviewRequired > 0 ? "RECONCILIATION_REQUIRED" : "COMPLETE",
    backlog: due.length,
    processed,
    extracted,
    unknown,
    failed,
    reviewRequired,
    oldestDueExpiresAtMs,
  });
}

/** Admin ports against installed review RPCs; fail closed when schema missing. */
export function createAdminKnowledgeFileBatchPorts(): BatchPorts | null {
  const admin = createAdminClient();
  if (!admin || typeof admin.rpc !== "function") return null;

  return {
    nowMs: () => Date.now(),
    async listDue(limit) {
      const { data, error } = await admin.rpc("g03_list_running_file_attempts" as never, {
        p_limit: limit,
      } as never);
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as unknown[];
      return rows.flatMap((row) => {
        const r = row as Record<string, unknown>;
        if (
          typeof r.source_id !== "string"
          || typeof r.attempt_id !== "string"
          || typeof r.company_id !== "string"
          || typeof r.branch_id !== "string"
          || typeof r.actor_id !== "string"
          || typeof r.session_id !== "string"
          || typeof r.expires_at !== "string"
          || typeof r.content_version !== "number"
          || typeof r.storage_path !== "string"
          || typeof r.object_id !== "string"
          || typeof r.object_updated_at !== "string"
        ) {
          return [];
        }
        const dispatch = r.provider_dispatch;
        return [{
          sourceId: r.source_id,
          attemptId: r.attempt_id,
          companyId: r.company_id,
          branchId: r.branch_id,
          actorId: r.actor_id,
          sessionId: r.session_id,
          expiresAt: r.expires_at,
          contentVersion: r.content_version,
          storagePath: r.storage_path,
          objectId: r.object_id,
          objectUpdatedAt: r.object_updated_at,
          providerDispatch:
            dispatch === "dispatched" || dispatch === "unknown" || dispatch === "verified"
              ? dispatch
              : "none",
        }];
      });
    },
    forAttempt(row) {
      let cachedBytes: Uint8Array | null = null;
      return {
        nowMs: () => Date.now(),
        async loadAttempt() {
          const { data, error } = await admin.rpc("g03_read_file_attempt" as never, {
            p_source_id: row.sourceId,
          } as never);
          if (error || !data || typeof data !== "object") return null;
          const a = data as Record<string, unknown>;
          if (a.ok === false) return null;
          if (
            typeof a.attempt_id !== "string"
            || typeof a.state !== "string"
            || typeof a.expires_at !== "string"
            || typeof a.content_version !== "number"
            || typeof a.storage_path !== "string"
          ) {
            return null;
          }
          if (a.state !== "running" && a.state !== "published" && a.state !== "failed") return null;
          return {
            attemptId: a.attempt_id,
            state: a.state,
            expiresAt: a.expires_at,
            contentVersion: a.content_version,
            storagePath: a.storage_path,
          };
        },
        async loadSource() {
          const { data, error } = await admin
            .from("knowledge_sources")
            .select("status,content_version,storage_path")
            .eq("id", row.sourceId)
            .maybeSingle();
          if (error || !data) return null;
          const s = data as {
            status?: string;
            content_version?: number;
            storage_path?: string | null;
          };
          if (
            typeof s.status !== "string"
            || typeof s.content_version !== "number"
            || typeof s.storage_path !== "string"
          ) {
            return null;
          }
          return {
            status: s.status,
            contentVersion: s.content_version,
            storagePath: s.storage_path,
          };
        },
        async extract() {
          const { data: meta, error: metaError } = await admin
            .from("knowledge_sources")
            .select("file_name,content_type,storage_path")
            .eq("id", row.sourceId)
            .maybeSingle();
          if (metaError || !meta) {
            return { ok: false as const, evidence: "safe_failure" as const, code: "SOURCE_UNREADABLE" };
          }
          const fileName = typeof meta.file_name === "string" ? meta.file_name : null;
          const contentType = typeof meta.content_type === "string" ? meta.content_type : null;
          const storagePath =
            typeof meta.storage_path === "string" ? meta.storage_path : row.storagePath;
          const kind = prepareKind(fileName, contentType);
          if (!kind) {
            return { ok: false as const, evidence: "safe_failure" as const, code: "unsupported" };
          }
          // Local offline proof: text/plain only while paid provider gate stays off.
          // PDF/DOCX/Gemini paths require the separate provider extract gate.
          if (kind !== "txt" && !knowledgeFileWorkerProviderExtractEnabled()) {
            return {
              ok: false as const,
              evidence: "safe_failure" as const,
              code: "PROVIDER_EXTRACT_DISABLED",
            };
          }
          const { data: blob, error: downloadError } = await admin.storage
            .from(KNOWLEDGE_BUCKET)
            .download(storagePath);
          if (downloadError || !blob) {
            return { ok: false as const, evidence: "safe_failure" as const, code: "DOWNLOAD_FAILED" };
          }
          const bytes = new Uint8Array(await blob.arrayBuffer());
          cachedBytes = bytes;
          const extracted = await extractKnowledgeText({
            fileName,
            contentType,
            bytes,
          });
          if (!extracted.ok) {
            return {
              ok: false as const,
              evidence: "safe_failure" as const,
              code: extracted.code,
            };
          }
          return { ok: true as const, text: extracted.text, evidence: "none" as const };
        },
        async publish(input) {
          const bytes = cachedBytes;
          if (!bytes) {
            return { ok: false as const, code: "BYTES_REQUIRED_FOR_PUBLISH" };
          }
          const { data, error } = await admin.rpc("g03_publish_file_attempt" as never, {
            p_attempt_id: input.attemptId,
            p_actor_id: row.actorId,
            p_session_id: row.sessionId,
            p_source_id: input.sourceId,
            p_company_id: row.companyId,
            p_branch_id: row.branchId,
            p_expected_version: row.contentVersion,
            p_storage_path: row.storagePath,
            p_text: input.text,
            p_file_sha256: createHash("sha256").update(bytes).digest("hex"),
            p_byte_size: bytes.byteLength,
            p_object_id: row.objectId,
            p_object_updated_at: row.objectUpdatedAt,
          } as never);
          if (error) return { ok: false as const, code: "PUBLISH_RPC_ERROR" };
          const out = data as { ok?: boolean; code?: string } | null;
          if (out?.ok === true) return { ok: true as const };
          return { ok: false as const, code: typeof out?.code === "string" ? out.code : "PUBLISH_REJECTED" };
        },
        async failAttempt(input) {
          const { data, error } = await admin.rpc("g03_control_file_attempt" as never, {
            p_actor_id: row.actorId,
            p_session_id: row.sessionId,
            p_company_id: row.companyId,
            p_source_id: input.sourceId,
            p_attempt_id: input.attemptId,
            p_branch_id: row.branchId,
            p_action: "fail",
            p_expires_at: null,
            p_failure_code: input.code,
          } as never);
          if (error) return false;
          const out = data as { ok?: boolean } | null;
          return out?.ok === true;
        },
      };
    },
  };
}
