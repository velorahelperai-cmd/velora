import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { boundaryFingerprint } from "./crypto";
import { listHandleCookies, selectCandidateHandles, type CookieReader } from "./cookies";
import {
  casUpdateTokens,
  claimRefreshLease,
  findSessionByHandleAnyStatus,
  hashHex,
  markRefreshUncertain,
  probeBrokerCapability,
  releaseRefreshLease,
} from "./registry";
import { nativeSessionIdFromAccessToken } from "./session-id";
import { brokerLog } from "./log";
import type { BrokerResolveResult } from "./types";
import { decryptSecret } from "./crypto";

type MemoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function memoryStorage(seed?: { accessToken: string; refreshToken: string }): MemoryStorage {
  const map = new Map<string, string>();
  if (seed) {
    map.set(
      "sb-broker-auth-token",
      JSON.stringify({
        access_token: seed.accessToken,
        refresh_token: seed.refreshToken,
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
  }
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function decB64(value: string): string | null {
  try {
    return decryptSecret(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
}

export function createUserClientFromTokens(
  accessToken: string,
  refreshToken: string,
): SupabaseClient<Database> | null {
  const env = getSupabaseEnv();
  if (!env.ok) return null;
  const storage = memoryStorage({ accessToken, refreshToken });
  return createClient<Database>(env.url, env.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage,
      storageKey: "sb-broker-auth-token",
      flowType: "pkce",
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

/**
 * Authoritative selection by server auth_ordinal + browser lineage fence (C3-1).
 * Missing B cookie in same lineage → no A resurrection; other devices unaffected.
 */
export type BrokerResolveOptions = {
  browserLineageId?: string | null;
  admissionScope?: "app" | "recovery";
  /** C5-R4: bootstrap hash for exact current tip resolve. */
  bootstrapHash?: string | null;
};

export async function resolveBrokerSession(
  store: CookieReader,
  options?: BrokerResolveOptions,
): Promise<BrokerResolveResult> {
  const capability = await probeBrokerCapability();
  if (!capability.ok) {
    brokerLog("warn", "auth.broker.resolve.capability_blocked", {
      error_code: "CAPABILITY_FAIL_CLOSED",
      codes: capability.codes,
    });
    return { ok: false, code: "UNAVAILABLE" };
  }

  const selected = selectCandidateHandles(store);
  if ("failClosed" in selected) {
    brokerLog("warn", "auth.broker.resolve.cookie_quota", { error_code: "HANDLE_COOKIE_LIMIT" });
    return { ok: false, code: "UNAVAILABLE" };
  }
  if (selected.length === 0) {
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  const { readBoundBrowserContinuity } = await import("./continuity");
  const bound = options?.bootstrapHash
    ? { bootstrapHash: options.bootstrapHash }
    : await readBoundBrowserContinuity(store);
  if (!bound?.bootstrapHash) {
    brokerLog("warn", "auth.broker.resolve.continuity_required", {
      error_code: "CONTINUITY_REQUIRED",
    });
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  const handleHashes = selected.map((c) => hashHex(c.value));
  const byHash = new Map(selected.map((c) => [hashHex(c.value), c]));
  const { resolveBoundSession } = await import("./registry");
  const row = await resolveBoundSession({
    bootstrapHash: bound.bootstrapHash,
    handleHashes,
    admissionScope: options?.admissionScope ?? "app",
  });
  if (!row) {
    // Missing exact current handle (B) — never fall back to max(active)/A.
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  const cookie = byHash.get(row.handle_hash);
  if (!cookie || cookie.name !== row.cookie_name) {
    brokerLog("warn", "auth.broker.resolve.cookie_name_mismatch", {
      error_code: "COOKIE_NAME_MISMATCH",
    });
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  const accessToken = decB64(row.access_token_enc);
  const refreshToken = decB64(row.refresh_token_enc);
  if (!accessToken || !refreshToken) {
    return { ok: false, code: "UNAVAILABLE" };
  }
  const topOrdinal = Number(row.auth_ordinal ?? 0);

  return {
    ok: true,
    boundary: {
      boundaryFingerprint: boundaryFingerprint(cookie.value),
      userId: row.user_id,
      nativeSessionId: row.native_session_id,
      cookieName: row.cookie_name,
      generation: row.generation,
      authOrdinal: topOrdinal,
      contextGeneration: Number(row.lineage_generation ?? topOrdinal),
      browserLineageId: row.browser_lineage_id ?? null,
    },
    accessToken,
    refreshToken,
    expiresAt: row.token_expires_at,
    refreshRevision: row.refresh_revision,
    registryId: row.registry_id,
    authOrdinal: topOrdinal,
    handleHash: row.handle_hash,
  };
}

/**
 * Capture resolve for quarantine/recovery of a specific boundary.
 * NOT sufficient authority for password mutation (C3-4) — use resolveAuthoritativeForMutation.
 */
export async function resolveBrokerSessionByFingerprint(
  store: CookieReader,
  expectedFingerprint: string,
): Promise<BrokerResolveResult> {
  if (!expectedFingerprint || !/^[a-f0-9]{16}$/i.test(expectedFingerprint)) {
    return { ok: false, code: "UNAUTHENTICATED" };
  }
  const capability = await probeBrokerCapability();
  if (!capability.ok) return { ok: false, code: "UNAVAILABLE" };

  for (const candidate of listHandleCookies(store)) {
    if (boundaryFingerprint(candidate.value) !== expectedFingerprint) continue;
    const found = await findSessionByHandleAnyStatus(candidate.value);
    if (!found) return { ok: false, code: "UNAUTHENTICATED" };
    if (found.row.cookie_name !== candidate.name) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (!found.accessToken || !found.refreshToken) {
      return { ok: false, code: "UNAVAILABLE" };
    }
    return {
      ok: true,
      boundary: {
        boundaryFingerprint: expectedFingerprint,
        userId: found.row.user_id,
        nativeSessionId: found.row.native_session_id,
        cookieName: found.row.cookie_name,
        generation: found.row.generation,
        authOrdinal: Number(found.row.auth_ordinal ?? 0),
        contextGeneration: Number(found.row.auth_ordinal ?? 0),
        browserLineageId: found.row.browser_lineage_id ?? null,
      },
      accessToken: found.accessToken,
      refreshToken: found.refreshToken,
      expiresAt: found.row.token_expires_at,
      refreshRevision: found.row.refresh_revision,
      registryId: found.row.id,
      authOrdinal: Number(found.row.auth_ordinal ?? 0),
      handleHash: found.row.handle_hash,
    };
  }
  return { ok: false, code: "UNAUTHENTICATED" };
}

/**
 * Password / privileged mutation: must be current active tip of lineage matching capture (C3-4).
 */
export async function resolveAuthoritativeForMutation(
  store: CookieReader,
  expectedFingerprint: string,
): Promise<BrokerResolveResult> {
  if (!expectedFingerprint || !/^[a-f0-9]{16}$/i.test(expectedFingerprint)) {
    return { ok: false, code: "UNAUTHENTICATED" };
  }
  const current = await resolveBrokerSession(store);
  if (!current.ok) return current;
  if (current.boundary.boundaryFingerprint !== expectedFingerprint) {
    brokerLog("warn", "auth.broker.mutation.capture_not_tip", {
      error_code: "CAPTURE_NOT_AUTHORITATIVE",
      boundary_fp: expectedFingerprint,
    });
    return { ok: false, code: "UNAUTHENTICATED" };
  }
  return current;
}

/**
 * Lease (idle-only) → provider → SID check → CAS.
 * UNKNOWN marks uncertain and does NOT release lease for blind replay (C2-R3).
 */
export async function refreshBrokerTokens(resolved: Extract<BrokerResolveResult, { ok: true }>): Promise<
  | { ok: true; accessToken: string; refreshToken: string; expiresAt: string; refreshRevision: number }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" }
> {
  const lease = await claimRefreshLease(resolved.registryId, resolved.refreshRevision);
  if (!lease) {
    brokerLog("warn", "auth.broker.refresh.lease_busy", {
      error_code: "REFRESH_LEASE_BUSY",
      boundary_fp: resolved.boundary.boundaryFingerprint,
      user_id: resolved.boundary.userId,
    });
    return { ok: false, code: "UNAVAILABLE" };
  }

  const client = createUserClientFromTokens(resolved.accessToken, resolved.refreshToken);
  if (!client) {
    await markRefreshUncertain(resolved.registryId, lease);
    return { ok: false, code: "UNAVAILABLE" };
  }
  try {
    const { data, error } = await client.auth.refreshSession({
      refresh_token: resolved.refreshToken,
    });
    if (error || !data.session) {
      const name = error?.name ?? "";
      const ambiguous =
        name === "AuthRetryableFetchError"
        || name.includes("Retryable")
        || name.includes("FetchError")
        || !error;
      if (ambiguous || name !== "AuthSessionMissingError") {
        await markRefreshUncertain(resolved.registryId, lease);
        brokerLog("warn", "auth.broker.refresh.uncertain", {
          error_code: name || "REFRESH_UNKNOWN",
          boundary_fp: resolved.boundary.boundaryFingerprint,
          user_id: resolved.boundary.userId,
        });
        return { ok: false, code: "UNAVAILABLE" };
      }
      await releaseRefreshLease(resolved.registryId, lease);
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    const session = data.session;
    if (session.user.id !== resolved.boundary.userId) {
      await markRefreshUncertain(resolved.registryId, lease);
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    const sid = nativeSessionIdFromAccessToken(session.access_token);
    if (!sid || sid !== resolved.boundary.nativeSessionId) {
      await markRefreshUncertain(resolved.registryId, lease);
      brokerLog("error", "auth.broker.refresh.session_id_mismatch", {
        error_code: "NATIVE_SESSION_CHANGED",
        boundary_fp: resolved.boundary.boundaryFingerprint,
        user_id: resolved.boundary.userId,
      });
      return { ok: false, code: "UNAVAILABLE" };
    }
    const expiresAt = session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : new Date(Date.now() + (session.expires_in ?? 3600) * 1000).toISOString();
    const cas = await casUpdateTokens({
      registryId: resolved.registryId,
      expectedRevision: resolved.refreshRevision,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt,
      leaseToken: lease,
    });
    if (!cas) {
      await markRefreshUncertain(resolved.registryId, lease);
      brokerLog("warn", "auth.broker.refresh.cas_conflict", {
        error_code: "REFRESH_CAS_CONFLICT",
        boundary_fp: resolved.boundary.boundaryFingerprint,
        user_id: resolved.boundary.userId,
      });
      return { ok: false, code: "UNAVAILABLE" };
    }
    return {
      ok: true,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt,
      refreshRevision: resolved.refreshRevision + 1,
    };
  } catch {
    await markRefreshUncertain(resolved.registryId, lease);
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function createBrokerUserClient(
  store: CookieReader,
): Promise<
  | { ok: true; client: SupabaseClient<Database>; resolve: Extract<BrokerResolveResult, { ok: true }> }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" }
> {
  let resolved = await resolveBrokerSession(store);
  if (!resolved.ok) return { ok: false, code: resolved.code === "QUARANTINED" ? "UNAUTHENTICATED" : resolved.code };
  const expiresMs = Date.parse(resolved.expiresAt);
  if (Number.isFinite(expiresMs) && expiresMs < Date.now() + 60_000) {
    const refreshed = await refreshBrokerTokens(resolved);
    if (!refreshed.ok) return refreshed;
    resolved = {
      ...resolved,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
      refreshRevision: refreshed.refreshRevision,
    };
  }
  const client = createUserClientFromTokens(resolved.accessToken, resolved.refreshToken);
  if (!client) return { ok: false, code: "UNAVAILABLE" };
  return { ok: true, client, resolve: resolved };
}
