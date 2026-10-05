import {
  isAuthError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
} from "@supabase/supabase-js";

/**
 * Safe internal failure stages for account identity recovery.
 * Never log tokens/cookies/PII; never surface these codes to visitors.
 */
export type IdentityFailureStage =
  | "browser_auth"
  | "server_auth"
  | "profile"
  | "membership"
  | "company";

/**
 * Confirmed absence of a browser session (SDK AuthSessionMissingError).
 * This is a normal guest state — not an identity outage.
 */
export function isConfirmedMissingSession(error: unknown): boolean {
  return isAuthSessionMissingError(error);
}

/** Network / retryable auth transport failure — keep as error, never guest. */
export function isRetryableAuthTransportError(error: unknown): boolean {
  return isAuthRetryableFetchError(error);
}

export function classifyGetUserFailure(error: unknown): {
  kind: "guest" | "error";
  stage: IdentityFailureStage;
} {
  if (isConfirmedMissingSession(error)) {
    return { kind: "guest", stage: "browser_auth" };
  }
  if (isRetryableAuthTransportError(error) || isAuthError(error)) {
    return { kind: "error", stage: "browser_auth" };
  }
  return { kind: "error", stage: "browser_auth" };
}

export function classifyProfileFailure(code: string): IdentityFailureStage {
  if (code === "UNAUTHENTICATED") return "server_auth";
  if (code === "UNVERIFIED") return "server_auth";
  if (code === "FORBIDDEN") return "membership";
  if (code === "NO_COMPANY") return "company";
  if (code === "UNAVAILABLE" || code === "AUTH_ERROR") return "profile";
  return "profile";
}
