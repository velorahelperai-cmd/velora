/**
 * Canonical WhatsApp worker error and outcome codes.
 * Shared between execution (integration-worker, integration-store) and observation (worker-observation).
 */

export const RPC_TO_WORKER_CODE_MAP = {
  unsupported_message: "UNSUPPORTED_MESSAGE",
  service_window_closed: "SERVICE_WINDOW_CLOSED",
  link_unavailable: "LINK_UNAVAILABLE",
  service_window_authorization_unavailable: "SERVICE_WINDOW_AUTHORIZATION_UNAVAILABLE",
} as const;

export type RpcWorkerCode = keyof typeof RPC_TO_WORKER_CODE_MAP;

export type CanonicalWorkerCode =
  | (typeof RPC_TO_WORKER_CODE_MAP)[RpcWorkerCode]
  | "WORKER_DISABLED"
  | "CLAIM_BINDING_REJECTED"
  | "HUMAN_REVIEW_REQUIRED"
  | "HUMAN_CLAIMED"
  | "APPROVED_KNOWLEDGE_REQUIRED"
  | "KNOWLEDGE_OR_AUTOMATION_CHANGED"
  | "TENANT_SECRET_NOT_CONFIGURED"
  | "ENTITLEMENT_OR_USAGE_DENIED"
  | "STAGE_REJECTED"
  | "SEND_BINDING_REJECTED"
  | "AUTOMATION_CHANGED_BEFORE_SEND"
  | "INVALID_INPUT"
  | "ENTITLEMENT_NOT_CONFIGURED"
  | "SEND_NOT_WIRED"
  | "BUDGET_DISABLED"
  | "BUDGET_BINDING_CHANGED"
  | "BUDGET_EXCEEDED"
  | "SEND_REJECTED"
  | "WORKER_UNAVAILABLE"
  | "AI_REQUIRES_RECONCILIATION"
  | "SEND_IN_PROGRESS_REQUIRES_REVIEW"
  | "SEND_REQUIRES_RECONCILIATION"
  | "SEND_PERSIST_REQUIRES_RECONCILIATION"
  | "SEND_CAPABILITY_MISSING"
  | "ACCEPTED"
  | "ACCEPTANCE_ACCOUNTING_PENDING"
  | "ACCEPTANCE_PERSIST_PENDING";

export function canonicalizeRpcWorkerCode(raw: unknown): CanonicalWorkerCode | null {
  if (typeof raw !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(RPC_TO_WORKER_CODE_MAP, raw)) {
    return RPC_TO_WORKER_CODE_MAP[raw as RpcWorkerCode];
  }
  if (
    raw === "UNSUPPORTED_MESSAGE" ||
    raw === "SERVICE_WINDOW_CLOSED" ||
    raw === "LINK_UNAVAILABLE" ||
    raw === "SERVICE_WINDOW_AUTHORIZATION_UNAVAILABLE"
  ) {
    return raw;
  }
  return null;
}

export function normalizeWorkerCode(raw: unknown): string {
  if (typeof raw !== "string") return "WORKER_OUTCOME_UNCLASSIFIED";
  if (Object.prototype.hasOwnProperty.call(RPC_TO_WORKER_CODE_MAP, raw)) {
    return RPC_TO_WORKER_CODE_MAP[raw as RpcWorkerCode];
  }
  return raw;
}

/** Confirmed rejections before sending. These represent terminal/policy stops for the message. */
export const BLOCKED_CODES = new Set([
  "WORKER_DISABLED",
  "CLAIM_BINDING_REJECTED",
  "HUMAN_REVIEW_REQUIRED",
  "HUMAN_CLAIMED",
  "APPROVED_KNOWLEDGE_REQUIRED",
  "KNOWLEDGE_OR_AUTOMATION_CHANGED",
  "TENANT_SECRET_NOT_CONFIGURED",
  "ENTITLEMENT_OR_USAGE_DENIED",
  "STAGE_REJECTED",
  "SEND_BINDING_REJECTED",
  "AUTOMATION_CHANGED_BEFORE_SEND",
  "INVALID_INPUT",
  "UNSUPPORTED_MESSAGE",
  "SERVICE_WINDOW_CLOSED",
  "ENTITLEMENT_NOT_CONFIGURED",
  "SEND_NOT_WIRED",
]);

/** Verification unavailability or confirmed send rejection (failed batch, HTTP 503). */
export const FAILED_CODES = new Set([
  "SEND_REJECTED",
  "WORKER_UNAVAILABLE",
  "LINK_UNAVAILABLE",
  "SERVICE_WINDOW_AUTHORIZATION_UNAVAILABLE",
]);

/** Truly ambiguous send/reconciliation codes (unknown batch, HTTP 202). */
export const RECONCILIATION_CODES = new Set([
  "AI_REQUIRES_RECONCILIATION",
  "SEND_IN_PROGRESS_REQUIRES_REVIEW",
  "SEND_REQUIRES_RECONCILIATION",
  "SEND_PERSIST_REQUIRES_RECONCILIATION",
  "SEND_CAPABILITY_MISSING",
]);

/**
 * Distinguishes transient verification unavailability (retryable)
 * from confirmed permanent refusal.
 */
export function isTransientWorkerCode(code: string): boolean {
  const canonical = normalizeWorkerCode(code);
  return (
    canonical === "LINK_UNAVAILABLE" ||
    canonical === "SERVICE_WINDOW_AUTHORIZATION_UNAVAILABLE" ||
    canonical === "WORKER_UNAVAILABLE"
  );
}

export type ClassifiedOutcomeKind =
  | "accepted"
  | "accounting_pending"
  | "persistence_pending"
  | "blocked"
  | "failed"
  | "unknown";

export function classifyWorkerOutcomeCode(
  rawCode: string,
  sendAccepted = false,
  isOk = false
): { kind: ClassifiedOutcomeKind; canonicalCode: string } {
  const code = normalizeWorkerCode(rawCode);
  if (code === "ACCEPTED" && isOk) {
    return { kind: "accepted", canonicalCode: "ACCEPTED" };
  }
  if (code === "ACCEPTANCE_ACCOUNTING_PENDING" && sendAccepted) {
    return { kind: "accounting_pending", canonicalCode: code };
  }
  if (code === "ACCEPTANCE_PERSIST_PENDING" && sendAccepted) {
    return { kind: "persistence_pending", canonicalCode: code };
  }
  if (RECONCILIATION_CODES.has(code)) {
    return { kind: "unknown", canonicalCode: code };
  }
  if (
    (code === "BUDGET_DISABLED" || code === "BUDGET_BINDING_CHANGED" || code === "BUDGET_EXCEEDED") &&
    !sendAccepted
  ) {
    return { kind: "blocked", canonicalCode: code };
  }
  if (BLOCKED_CODES.has(code)) {
    return { kind: "blocked", canonicalCode: code };
  }
  if (FAILED_CODES.has(code)) {
    return { kind: "failed", canonicalCode: code };
  }
  // Sanitize: do not leak raw provider/database messages
  return { kind: "unknown", canonicalCode: "WORKER_OUTCOME_UNCLASSIFIED" };
}
