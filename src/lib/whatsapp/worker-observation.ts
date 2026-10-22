import type { IntegrationOutcome } from "./integration-worker";

/** Monitoring projection only. Never retries, settles, claims or sends a job. */
const blockedCodes = new Set(["WORKER_DISABLED", "CLAIM_BINDING_REJECTED", "APPROVED_KNOWLEDGE_REQUIRED", "KNOWLEDGE_OR_AUTOMATION_CHANGED", "TENANT_SECRET_NOT_CONFIGURED", "ENTITLEMENT_OR_USAGE_DENIED", "STAGE_REJECTED", "SEND_BINDING_REJECTED", "AUTOMATION_CHANGED_BEFORE_SEND", "INVALID_INPUT", "UNSUPPORTED_MESSAGE", "ENTITLEMENT_NOT_CONFIGURED", "SEND_NOT_WIRED"]);
const reconciliationCodes = new Set(["AI_REQUIRES_RECONCILIATION", "SEND_IN_PROGRESS_REQUIRES_REVIEW", "SEND_REQUIRES_RECONCILIATION", "SEND_PERSIST_REQUIRES_RECONCILIATION", "SEND_CAPABILITY_MISSING"]);
export function summarizeWorkerOutcomes(results: IntegrationOutcome[], repair: { repaired: number; pending: number }) {
  const summary = { processed: results.length, accepted: 0, completed: 0, delivered: 0,
    accountingPending: 0, persistencePending: 0, unknown: 0, failed: 0, blocked: 0,
    repair: { repaired: repair.repaired, pending: repair.pending },
    outcomes: {} as Record<string, number>, automaticRetry: false as const };
  for (const result of results) {
    if (result.sendAccepted) summary.accepted++;
    if (result.jobCompleted) summary.completed++;
    let code: string;
    if (result.code === "ACCEPTED" && result.ok) code = "ACCEPTED";
    else if (result.code === "ACCEPTANCE_ACCOUNTING_PENDING" && result.sendAccepted) { summary.accountingPending++; code = result.code; }
    else if (result.code === "ACCEPTANCE_PERSIST_PENDING" && result.sendAccepted) { summary.persistencePending++; code = result.code; }
    else if (reconciliationCodes.has(result.code)) { summary.unknown++; code = result.code; }
    else if (blockedCodes.has(result.code)) { summary.blocked++; code = result.code; }
    else if (result.code === "SEND_REJECTED" || result.code === "WORKER_UNAVAILABLE") { summary.failed++; code = result.code; }
    else { summary.unknown++; code = "WORKER_OUTCOME_UNCLASSIFIED"; }
    summary.outcomes[code] = (summary.outcomes[code] ?? 0) + 1;
  }
  const pending = summary.accountingPending + summary.persistencePending + summary.unknown + repair.pending;
  const code = pending > 0 ? "RECONCILIATION_REQUIRED" : summary.failed > 0 ? "WORKER_BATCH_FAILED" : summary.blocked > 0 ? "WORKER_BATCH_BLOCKED" : "COMPLETE";
  // A known accepted send pending reconciliation is not a rejected send. 202
  // exposes pending work without suggesting a generic failure retry/resend.
  const httpStatus = pending > 0 ? 202 : summary.failed > 0 ? 503 : 200;
  return { httpStatus, body: { ...summary, code } };
}
