import type { IntegrationOutcome } from "./integration-worker";
import { classifyWorkerOutcomeCode } from "./worker-codes";

export {
  RPC_TO_WORKER_CODE_MAP,
  canonicalizeRpcWorkerCode,
  normalizeWorkerCode,
  isTransientWorkerCode,
  classifyWorkerOutcomeCode,
  BLOCKED_CODES,
  FAILED_CODES,
  RECONCILIATION_CODES,
  type RpcWorkerCode,
  type CanonicalWorkerCode,
  type ClassifiedOutcomeKind,
} from "./worker-codes";

/** Monitoring projection only. Never retries, settles, claims or sends a job. */
export function summarizeWorkerOutcomes(results: IntegrationOutcome[], repair: { repaired: number; pending: number }) {
  const summary = {
    processed: results.length,
    accepted: 0,
    completed: 0,
    delivered: 0,
    accountingPending: 0,
    persistencePending: 0,
    unknown: 0,
    failed: 0,
    blocked: 0,
    repair: { repaired: repair.repaired, pending: repair.pending },
    outcomes: {} as Record<string, number>,
    automaticRetry: false as const,
  };
  for (const result of results) {
    if (result.sendAccepted) summary.accepted++;
    if (result.jobCompleted) summary.completed++;
    const classified = classifyWorkerOutcomeCode(result.code, result.sendAccepted, result.ok);
    switch (classified.kind) {
      case "accepted":
        break;
      case "accounting_pending":
        summary.accountingPending++;
        break;
      case "persistence_pending":
        summary.persistencePending++;
        break;
      case "unknown":
        summary.unknown++;
        break;
      case "blocked":
        summary.blocked++;
        break;
      case "failed":
        summary.failed++;
        break;
    }
    summary.outcomes[classified.canonicalCode] = (summary.outcomes[classified.canonicalCode] ?? 0) + 1;
  }
  const pending = summary.accountingPending + summary.persistencePending + summary.unknown + repair.pending;
  const code = pending > 0 ? "RECONCILIATION_REQUIRED" : summary.failed > 0 ? "WORKER_BATCH_FAILED" : summary.blocked > 0 ? "WORKER_BATCH_BLOCKED" : "COMPLETE";
  // A known accepted send pending reconciliation is not a rejected send. 202
  // exposes pending work without suggesting a generic failure retry/resend.
  const httpStatus = pending > 0 ? 202 : summary.failed > 0 ? 503 : 200;
  return { httpStatus, body: { ...summary, code } };
}
