import "server-only";
import { randomUUID } from "node:crypto";
import type { Session } from "@supabase/supabase-js";
import { type CookieReader, type CookieWriter } from "./cookies";
import { readBoundBrowserContinuity } from "./continuity";
import {
  admitBoundSessionAtomic,
  casUpdateTokens,
  claimProviderAttempt,
  claimRefreshLease,
  markRefreshUncertain,
  markSessionStatus,
  recordProviderSessionCapture,
  releaseRefreshLease,
  reserveBoundAuthIntent,
} from "./registry";
import { commitHandleCookie } from "./cookies";
// claimProviderAttempt used by reserveBoundMutationIntent only.
import { expiresAtFromSession, nativeSessionIdFromAccessToken } from "./session-id";
import { brokerLog } from "./log";
import type { BrokerResolveResult } from "./types";

type Resolved = Extract<BrokerResolveResult, { ok: true }>;

/**
 * Claim lease BEFORE provider mutation (C3-5). Caller must pass lease into sync/commit.
 * On crash leaving rotating/uncertain: do not blind-replay; reconcile from DB only.
 */
export async function beginAuthMutationFence(
  previous: Resolved,
): Promise<{ ok: true; leaseToken: string } | { ok: false; code: "UNAVAILABLE" }> {
  const lease = await claimRefreshLease(previous.registryId, previous.refreshRevision);
  if (!lease) {
    brokerLog("warn", "auth.broker.sync.lease_busy", {
      error_code: "REFRESH_LEASE_BUSY",
      boundary_fp: previous.boundary.boundaryFingerprint,
    });
    return { ok: false, code: "UNAVAILABLE" };
  }
  return { ok: true, leaseToken: lease };
}

export async function abandonAuthMutationFence(
  previous: Resolved,
  leaseToken: string,
  outcome: "release" | "uncertain",
): Promise<void> {
  if (outcome === "uncertain") {
    await markRefreshUncertain(previous.registryId, leaseToken);
    return;
  }
  await releaseRefreshLease(previous.registryId, leaseToken);
}

/**
 * Persist tokens after Auth mutation under a pre-claimed lease (C3-5).
 * New SID requires pre-reserved bound intent (C5-R4).
 */
export async function syncBrokerAfterAuthMutation(input: {
  previous: Resolved;
  session: Session | null | undefined;
  writer: CookieWriter;
  reader?: CookieReader;
  /** Required when same native session — must be claimed before provider effect. */
  leaseToken?: string | null;
  /** Pre-reserved bound intent for new-SID path (required when SID changes). */
  boundIntentId?: string | null;
  bootstrapHash?: string | null;
}): Promise<{ ok: true; kind: "refreshed" | "new_boundary" } | { ok: false; code: "UNAVAILABLE" }> {
  if (!input.session?.access_token || !input.session.refresh_token || !input.session.user) {
    return { ok: false, code: "UNAVAILABLE" };
  }
  if (input.session.user.id !== input.previous.boundary.userId) {
    brokerLog("warn", "auth.broker.sync.user_mismatch", {
      error_code: "USER_MISMATCH",
      user_id: input.previous.boundary.userId,
      boundary_fp: input.previous.boundary.boundaryFingerprint,
    });
    return { ok: false, code: "UNAVAILABLE" };
  }
  const nativeSessionId = nativeSessionIdFromAccessToken(input.session.access_token);
  if (!nativeSessionId) return { ok: false, code: "UNAVAILABLE" };

  if (nativeSessionId === input.previous.boundary.nativeSessionId) {
    if (!input.leaseToken || input.leaseToken.length < 16) {
      brokerLog("error", "auth.broker.sync.lease_required", {
        error_code: "LEASE_REQUIRED_BEFORE_PROVIDER",
        boundary_fp: input.previous.boundary.boundaryFingerprint,
      });
      return { ok: false, code: "UNAVAILABLE" };
    }
    const expiresAt = expiresAtFromSession(input.session.expires_at, input.session.expires_in);
    const cas = await casUpdateTokens({
      registryId: input.previous.registryId,
      expectedRevision: input.previous.refreshRevision,
      accessToken: input.session.access_token,
      refreshToken: input.session.refresh_token,
      expiresAt,
      leaseToken: input.leaseToken,
    });
    if (!cas) {
      await markRefreshUncertain(input.previous.registryId, input.leaseToken);
      return { ok: false, code: "UNAVAILABLE" };
    }
    // Pre-reserved new-SID intent unused — mark cleanup not needed / rejected (no second provider).
    if (input.boundIntentId) {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      await admin
        ?.from("vel_broker_auth_intents" as never)
        .update({
          provider_state: "rejected",
          cleanup_state: "not_needed",
          status: "rejected",
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", input.boundIntentId as never)
        .eq("status", "reserved" as never);
    }
    return { ok: true, kind: "refreshed" };
  }

  // New native boundary: bound intent required (C5-R4).
  if (!input.previous.boundary.browserLineageId) {
    if (input.leaseToken) {
      await markRefreshUncertain(input.previous.registryId, input.leaseToken);
    }
    return { ok: false, code: "UNAVAILABLE" };
  }

  // Continuity must still be enrolled for new-SID admit (C5-R4).
  let bootstrapHash = input.bootstrapHash ?? null;
  if (!bootstrapHash && input.reader) {
    const bound = await readBoundBrowserContinuity(input.reader);
    bootstrapHash = bound?.bootstrapHash ?? null;
  }
  if (!bootstrapHash) {
    if (input.leaseToken) {
      await markRefreshUncertain(input.previous.registryId, input.leaseToken);
    }
    return { ok: false, code: "UNAVAILABLE" };
  }

  // New SID must use intent reserved+claimed BEFORE provider (C5-R4).
  const intentId = input.boundIntentId ?? null;
  const browserLineageId = input.previous.boundary.browserLineageId;
  if (!intentId) {
    if (input.leaseToken) {
      await markRefreshUncertain(input.previous.registryId, input.leaseToken);
    }
    brokerLog("error", "auth.broker.sync.bound_intent_required", {
      error_code: "BOUND_INTENT_REQUIRED_BEFORE_PROVIDER",
      boundary_fp: input.previous.boundary.boundaryFingerprint,
    });
    return { ok: false, code: "UNAVAILABLE" };
  }

  const expiresAt = expiresAtFromSession(input.session.expires_at, input.session.expires_in);
  const captured = await recordProviderSessionCapture({
    intentId,
    userId: input.previous.boundary.userId,
    nativeSessionId,
    accessToken: input.session.access_token,
    refreshToken: input.session.refresh_token,
    expiresAt,
  });
  if (!captured) {
    if (input.leaseToken) {
      await markRefreshUncertain(input.previous.registryId, input.leaseToken);
    }
    return { ok: false, code: "UNAVAILABLE" };
  }

  const admitted = await admitBoundSessionAtomic({
    intentId,
    userId: input.previous.boundary.userId,
    nativeSessionId,
    accessToken: input.session.access_token,
    refreshToken: input.session.refresh_token,
    expiresAt,
    admissionScope: "app",
    browserLineageId,
  });
  if (!admitted) {
    if (input.leaseToken) {
      await markRefreshUncertain(input.previous.registryId, input.leaseToken);
    }
    // Durable cleanup obligation for captured new SID (R4-F05).
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    await admin
      ?.from("vel_broker_auth_intents" as never)
      .update({
        cleanup_state: "unknown",
        provider_state: "unknown",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", intentId as never)
      .neq("status", "committed" as never);
    brokerLog("error", "auth.broker.sync.new_boundary_admit_failed", {
      error_code: "NEW_SID_ADMIT_FAILED",
      boundary_fp: input.previous.boundary.boundaryFingerprint,
    });
    return { ok: false, code: "UNAVAILABLE" };
  }
  commitHandleCookie(input.writer, admitted.cookieName, admitted.handle);
  await markSessionStatus(input.previous.registryId, "tombstoned");
  if (input.leaseToken) {
    await releaseRefreshLease(input.previous.registryId, input.leaseToken);
  }
  brokerLog("info", "auth.broker.sync.new_boundary", {
    user_id: admitted.userId,
    boundary_fp: admitted.boundaryFingerprint,
  });
  return { ok: true, kind: "new_boundary" };
}

/**
 * Reserve bound intent + lease before a mutation that may mint a new native SID.
 */
export async function reserveBoundMutationIntent(input: {
  reader: CookieReader;
  purpose?: string;
  requestNonce?: string | null;
}): Promise<
  | { ok: true; intentId: string; bootstrapHash: string; browserLineageId: string }
  | { ok: false; code: "UNAVAILABLE" | "CONTINUITY_REQUIRED" }
> {
  const bound = await readBoundBrowserContinuity(input.reader);
  if (!bound || bound.state !== "active") {
    return { ok: false, code: "CONTINUITY_REQUIRED" };
  }
  const requestNonce =
    typeof input.requestNonce === "string" && input.requestNonce.length >= 16
      ? input.requestNonce
      : randomUUID();
  const reserved = await reserveBoundAuthIntent({
    bootstrapHash: bound.bootstrapHash,
    requestNonce,
    purpose: input.purpose ?? "auth_mutation",
  });
  if (!reserved) return { ok: false, code: "UNAVAILABLE" };
  const claim = await claimProviderAttempt(reserved.id);
  if (!claim.ok || claim.claimed !== true) return { ok: false, code: "UNAVAILABLE" };
  return {
    ok: true,
    intentId: reserved.id,
    bootstrapHash: bound.bootstrapHash,
    browserLineageId: reserved.browserLineageId,
  };
}

/**
 * Bounded recovery for rotating/uncertain after crash (C4-04).
 * Never steals lease by timeout; only re-reads DB state for operator/reattest paths.
 */
export async function reconcileUncertainRefresh(input: {
  registryId: string;
  expectedRevision: number;
}): Promise<{ ok: true; state: string } | { ok: false; code: "UNAVAILABLE" }> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) return { ok: false, code: "UNAVAILABLE" };
  const { data, error } = await admin
    .from("vel_broker_sessions" as never)
    .select("refresh_state,refresh_revision,status")
    .eq("id", input.registryId as never)
    .maybeSingle();
  if (error || !data) return { ok: false, code: "UNAVAILABLE" };
  const row = data as { refresh_state?: string; refresh_revision?: number; status?: string };
  if (Number(row.refresh_revision) !== input.expectedRevision) {
    return { ok: false, code: "UNAVAILABLE" };
  }
  const state = String(row.refresh_state ?? "unknown");
  if (state === "idle" && row.status === "active") {
    return { ok: true, state: "idle" };
  }
  brokerLog("warn", "auth.broker.sync.uncertain_needs_reauth", {
    error_code: "REFRESH_UNCERTAIN_REAUTH",
    stage: state,
  });
  return { ok: true, state };
}
