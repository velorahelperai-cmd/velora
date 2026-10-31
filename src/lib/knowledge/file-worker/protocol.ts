/**
 * Pure attempt-fence decisions for knowledge file prepare.
 * Mirrors private.g03_file_attempts semantics without requiring a live DB.
 */

export type AttemptState = "running" | "published" | "failed";

export type AttemptSnapshot = {
  attemptId: string;
  state: AttemptState;
  expiresAt: string;
  contentVersion: number;
  storagePath: string;
};

export type PublishGuardInput = {
  heldAttemptId: string;
  attempt: AttemptSnapshot | null;
  sourceStatus: string;
  sourceContentVersion: number;
  sourceStoragePath: string;
  nowMs: number;
};

/** Old or expired tokens must never publish. */
export function canPublishWithAttempt(input: PublishGuardInput):
  | { ok: true }
  | { ok: false; code: "ATTEMPT_CONFLICT" | "ATTEMPT_EXPIRED" | "INVALID_STATE" } {
  const { attempt, heldAttemptId } = input;
  if (!attempt) return { ok: false, code: "ATTEMPT_CONFLICT" };
  if (attempt.attemptId !== heldAttemptId) return { ok: false, code: "ATTEMPT_CONFLICT" };
  if (attempt.state !== "running") return { ok: false, code: "ATTEMPT_CONFLICT" };
  if (Date.parse(attempt.expiresAt) <= input.nowMs) return { ok: false, code: "ATTEMPT_EXPIRED" };
  if (input.sourceStatus !== "processing") return { ok: false, code: "INVALID_STATE" };
  if (attempt.contentVersion !== input.sourceContentVersion) return { ok: false, code: "ATTEMPT_CONFLICT" };
  if (attempt.storagePath !== input.sourceStoragePath) return { ok: false, code: "ATTEMPT_CONFLICT" };
  return { ok: true };
}

/**
 * Unknown provider outcomes must not trigger a second paid extract on a new attempt.
 * Reconcile the same attemptId; mint a new UUID only after explicit expired recovery.
 */
export function mayDispatchPaidExtract(input: {
  attemptState: AttemptState;
  providerEvidence: "none" | "unknown" | "verified_usage" | "safe_failure";
  sameAttemptId: boolean;
}): { ok: true } | { ok: false; code: "NO_BLIND_RETRY" | "ATTEMPT_RETIRED" } {
  if (input.attemptState === "published" || input.attemptState === "failed") {
    return { ok: false, code: "ATTEMPT_RETIRED" };
  }
  if (input.providerEvidence === "unknown" && !input.sameAttemptId) {
    return { ok: false, code: "NO_BLIND_RETRY" };
  }
  if (input.providerEvidence === "unknown" && input.sameAttemptId) {
    // Same attempt may resume only after lease recovery; never a second charge path here.
    return { ok: false, code: "NO_BLIND_RETRY" };
  }
  if (input.providerEvidence === "verified_usage") {
    return { ok: false, code: "NO_BLIND_RETRY" };
  }
  return { ok: true };
}

export type OwnerEnqueueResult =
  | { mode: "queued"; attemptId: string; status: "processing"; replayed: boolean }
  | {
    mode: "busy";
    code: "BUSY" | "LEGACY_PROCESSING_REVIEW_REQUIRED" | "CONFLICT" | "REVIEW_REQUIRED";
    attemptId?: string;
  }
  | { mode: "unavailable"; code: "WORKER_SCHEMA_REQUIRED" | "UNAVAILABLE" };

/** Map claim RPC codes to owner-facing enqueue outcomes (no extract). */
export function mapClaimToEnqueue(claim: {
  ok: boolean;
  code?: string;
  attemptId?: string;
  replayed?: boolean;
}): OwnerEnqueueResult {
  if (claim.ok === true && typeof claim.attemptId === "string" && claim.attemptId.length > 0) {
    return {
      mode: "queued",
      attemptId: claim.attemptId,
      status: "processing",
      replayed: claim.replayed === true,
    };
  }
  const code = claim.code ?? "UNAVAILABLE";
  if (
    code === "BUSY"
    || code === "LEGACY_PROCESSING_REVIEW_REQUIRED"
    || code === "CONFLICT"
    || code === "REVIEW_REQUIRED"
  ) {
    return {
      mode: "busy",
      code,
      ...(typeof claim.attemptId === "string" && claim.attemptId ? { attemptId: claim.attemptId } : {}),
    };
  }
  if (code === "WORKER_SCHEMA_REQUIRED") {
    return { mode: "unavailable", code: "WORKER_SCHEMA_REQUIRED" };
  }
  return { mode: "unavailable", code: "UNAVAILABLE" };
}
