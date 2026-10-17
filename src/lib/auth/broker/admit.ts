import "server-only";
import { randomUUID } from "node:crypto";
import type { Session } from "@supabase/supabase-js";
import {
  admitBoundSessionAtomic,
  claimProviderAttempt,
  probeBrokerCapability,
  recordProviderSessionCapture,
  reserveBoundAuthIntent,
} from "./registry";
import { commitHandleCookie, type CookieReader, type CookieWriter } from "./cookies";
import { readBoundBrowserContinuity } from "./continuity";
import { expiresAtFromSession, nativeSessionIdFromAccessToken } from "./session-id";
import { brokerLog } from "./log";
import type { CommittedBrokerSession } from "./registry";

/**
 * Admit a provider session under a bound continuity intent (C5-R4).
 * When authIntentId is omitted, reserves+claims a fresh bound intent (post-capture path).
 * Prefer reserve/claim before provider; this helper is for callers that already hold a session.
 */
export async function admitNativeSession(input: {
  session: Session;
  writer: CookieWriter;
  reader?: CookieReader;
  authIntentId?: string | null;
  browserLineageId?: string | null;
  bootstrapHash?: string | null;
  recoveryOperationKey?: string | null;
  admissionScope?: "app" | "recovery";
  purpose?: string;
}): Promise<
  | { ok: true; committed: CommittedBrokerSession }
  | { ok: false; code: "UNAVAILABLE" | "UNAUTHENTICATED" | "ADMISSION_BLOCKED" | "CONTINUITY_REQUIRED" }
> {
  const capability = await probeBrokerCapability();
  if (!capability.ok || capability.boundAdmit !== true) {
    brokerLog("error", "auth.broker.admit.capability_blocked", {
      error_code: "CAPABILITY_FAIL_CLOSED",
      codes: capability.codes,
    });
    return { ok: false, code: "UNAVAILABLE" };
  }
  const userId = input.session.user?.id;
  if (!userId || !input.session.access_token || !input.session.refresh_token) {
    return { ok: false, code: "UNAUTHENTICATED" };
  }
  const nativeSessionId = nativeSessionIdFromAccessToken(input.session.access_token);
  if (!nativeSessionId) {
    brokerLog("error", "auth.broker.admit.missing_session_id", {
      error_code: "NATIVE_SESSION_ID_MISSING",
      user_id: userId,
    });
    return { ok: false, code: "UNAVAILABLE" };
  }

  let bootstrapHash = input.bootstrapHash ?? null;
  let browserLineageId = input.browserLineageId ?? null;
  if ((!bootstrapHash || !browserLineageId) && input.reader) {
    const bound = await readBoundBrowserContinuity(input.reader);
    if (bound?.state === "active") {
      bootstrapHash = bootstrapHash ?? bound.bootstrapHash;
      browserLineageId = browserLineageId ?? bound.browserLineageId;
    }
  }
  if (!bootstrapHash || !browserLineageId) {
    return { ok: false, code: "CONTINUITY_REQUIRED" };
  }

  let intentId = input.authIntentId ?? null;
  if (!intentId) {
    const reserved = await reserveBoundAuthIntent({
      bootstrapHash,
      requestNonce: randomUUID(),
      purpose: input.purpose ?? (input.recoveryOperationKey ? "recovery_reauth" : "admit_native"),
      recoveryOperationKey: input.recoveryOperationKey ?? null,
    });
    if (!reserved) return { ok: false, code: "UNAVAILABLE" };
    intentId = reserved.id;
    browserLineageId = reserved.browserLineageId;
    const claim = await claimProviderAttempt(intentId);
    if (!claim.ok || claim.claimed !== true) return { ok: false, code: "UNAVAILABLE" };
  }

  const expiresAt = expiresAtFromSession(input.session.expires_at, input.session.expires_in);
  const captured = await recordProviderSessionCapture({
    intentId,
    userId,
    nativeSessionId,
    accessToken: input.session.access_token,
    refreshToken: input.session.refresh_token,
    expiresAt,
  });
  if (!captured) return { ok: false, code: "UNAVAILABLE" };

  const committed = await admitBoundSessionAtomic({
    intentId,
    userId,
    nativeSessionId,
    accessToken: input.session.access_token,
    refreshToken: input.session.refresh_token,
    expiresAt,
    admissionScope: input.admissionScope ?? (input.recoveryOperationKey ? "recovery" : "app"),
    recoveryOperationKey: input.recoveryOperationKey ?? null,
    browserLineageId,
  });
  if (!committed) {
    return { ok: false, code: "ADMISSION_BLOCKED" };
  }
  commitHandleCookie(input.writer, committed.cookieName, committed.handle);
  brokerLog("info", "auth.broker.admit.committed", {
    user_id: userId,
    boundary_fp: committed.boundaryFingerprint,
    stage: "cookieCommit",
    operation: "admit_bound",
    auth_ordinal: committed.authOrdinal,
  });
  return { ok: true, committed };
}
