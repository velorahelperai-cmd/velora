/**
 * Owner/worker recovery decisions for stuck file attempts.
 * Pre-provider lease expiry → safe new attemptId naming the expired one.
 * Unknown provider outcome → review hold; never auto-dispatch paid extract.
 */

export type ProviderDispatchEvidence = "none" | "dispatched" | "unknown" | "verified";

export type StuckAttemptView = {
  attemptId: string;
  state: "running" | "published" | "failed";
  expiresAt: string;
  providerDispatch: ProviderDispatchEvidence;
  sourceStatus: string;
  failureCode: string | null;
};

export type RecoveryDecision =
  | { action: "none"; reason: "ACTIVE" | "RETIRED" | "NOT_PROCESSING" }
  | { action: "recover_expired"; reason: "LEASE_EXPIRED_BEFORE_PROVIDER"; recoverAttemptId: string }
  | { action: "review_required"; reason: "PROVIDER_OUTCOME_UNKNOWN" | "PROVIDER_DISPATCHED_UNKNOWN" }
  | { action: "wait"; reason: "LEASE_ACTIVE" };

export function classifyStuckAttempt(
  view: StuckAttemptView,
  nowMs: number,
): RecoveryDecision {
  if (view.sourceStatus !== "processing" && view.state === "failed") {
    if (
      view.failureCode === "provider_outcome_unknown"
      || view.providerDispatch === "unknown"
    ) {
      return { action: "review_required", reason: "PROVIDER_OUTCOME_UNKNOWN" };
    }
    return { action: "none", reason: "RETIRED" };
  }
  if (view.sourceStatus !== "processing" || view.state !== "running") {
    return { action: "none", reason: "NOT_PROCESSING" };
  }
  const expired = Date.parse(view.expiresAt) <= nowMs;
  if (!expired) return { action: "wait", reason: "LEASE_ACTIVE" };
  if (view.providerDispatch === "none") {
    return {
      action: "recover_expired",
      reason: "LEASE_EXPIRED_BEFORE_PROVIDER",
      recoverAttemptId: view.attemptId,
    };
  }
  // Dispatched / unknown after provider contact — never blind retry.
  return { action: "review_required", reason: "PROVIDER_DISPATCHED_UNKNOWN" };
}

export const PROVIDER_OUTCOME_UNKNOWN_CODE = "provider_outcome_unknown" as const;
export const LEASE_EXPIRED_CODE = "attempt_lease_expired" as const;
