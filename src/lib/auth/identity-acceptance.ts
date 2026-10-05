/**
 * Deferred acceptance cases for VEL-AUTH-IDENTITY-02.
 * Descriptors only — not executed; do not treat as PASS or as a production fix claim.
 */

export type IdentityAcceptanceCase = {
  id: string;
  title: string;
  expect: string;
};

export const IDENTITY_ACCEPTANCE_CASES: IdentityAcceptanceCase[] = [
  {
    id: "guest-no-session",
    title: "Visitor with no session",
    expect: "getUser returns AuthSessionMissingError → status guest + login/signup links; not identityError.",
  },
  {
    id: "sign-in-success",
    title: "Successful sign-in",
    expect: "SIGNED_IN / refresh loads getAccountProfile → status ready with menu identity.",
  },
  {
    id: "network-outage",
    title: "Network / retryable auth outage",
    expect: "Retryable or unknown getUser failure → status error + retry; never guest.",
  },
  {
    id: "session-expired",
    title: "Session ended",
    expect: "UNAUTHENTICATED from profile or SIGNED_OUT → guest; stale in-flight refresh discarded.",
  },
  {
    id: "logout-during-refresh",
    title: "Sign-out while refresh in flight",
    expect: "clear() bumps requestGen so late profile response cannot restore prior identity.",
  },
  {
    id: "account-switch",
    title: "Switch accounts",
    expect: "Different user id clears prior identity before applying the new profile.",
  },
  {
    id: "profile-userid-match",
    title: "Profile userId must match getUser for the same request",
    expect: "Before accepting getAccountProfile ok, require result.data.userId === getUser.id; on mismatch clear identity and reject (error, not guest).",
  },
];

export const IDENTITY_ACCEPTANCE_STATUS = "deferred" as const;
