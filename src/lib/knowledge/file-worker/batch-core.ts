import { buildWorkerObservation, type WorkerObservation } from "./observation.ts";
import {
  classifyStuckAttempt,
  LEASE_EXPIRED_CODE,
  PROVIDER_OUTCOME_UNKNOWN_CODE,
  type ProviderDispatchEvidence,
} from "./recovery.ts";
import { runKnowledgeFileAttempt, type FileWorkerPorts } from "./run.ts";

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
      // Pre-provider expiry: do not extract; transition expired attempt to prevent batch starvation.
      processed += 1;
      failed += 1;
      const attemptPorts = ports.forAttempt(row);
      await attemptPorts.failAttempt({
        sourceId: row.sourceId,
        attemptId: row.attemptId,
        code: LEASE_EXPIRED_CODE,
      });
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
