import "server-only";
import { validClientOperationKey } from "../operation-key";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { newOpaqueHandle } from "./crypto";
import { expireHandleCookie, type CookieWriter } from "./cookies";
import {
  createBrokerOperation,
  markSessionStatus,
  probeBrokerCapability,
  updateBrokerOperation,
} from "./registry";
import { createUserClientFromTokens } from "./resolve";
import { brokerLog } from "./log";
import type { BrokerResolveResult, BrokerStageReceipt } from "./types";

type Resolved = Extract<BrokerResolveResult, { ok: true }>;

function emptyStages(): BrokerStageReceipt {
  return {
    credentialMutation: "not_attempted",
    appRevocation: "not_attempted",
    nativeRevocation: "not_attempted",
    cookieCommit: "not_attempted",
    clientCleanup: "not_attempted",
    contextRead: "not_attempted",
  };
}

async function adminLocalSignOut(accessToken: string): Promise<"confirmed" | "unknown" | "rejected"> {
  const env = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!env.ok || !serviceKey) return "unknown";
  try {
    const admin = createClient(env.url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await admin.auth.admin.signOut(accessToken, "local");
    if (!error) return "confirmed";
    if (error.status === 401 || error.status === 403 || error.status === 404) return "unknown";
    return "rejected";
  } catch {
    return "unknown";
  }
}

export async function brokerLogoutOriginal(input: {
  resolved: Resolved;
  writer: CookieWriter;
  expectedUserId?: string;
  expectedBoundaryFingerprint?: string;
  operationKey?: string;
}): Promise<{
  ok: boolean;
  code?: "UNAUTHENTICATED" | "UNAVAILABLE" | "AUTH_ERROR";
  message?: string;
  operationId: string;
  stages: BrokerStageReceipt;
  status: "confirmed" | "pending" | "unknown" | "failed";
  generation: string;
}> {
  const stages = emptyStages();
  const operationId = input.operationKey ?? newOpaqueHandle();
  const generation = input.resolved.boundary.generation;
  if (input.operationKey !== undefined && !validClientOperationKey(input.operationKey)) {
    return { ok: false, code: "UNAVAILABLE", operationId, stages, status: "failed", generation };
  }
  const capability = await probeBrokerCapability();
  if (!capability.ok) {
    brokerLog("error", "auth.broker.logout.capability_blocked", {
      error_code: "CAPABILITY_FAIL_CLOSED",
      operation_id: operationId,
      boundary_fp: input.resolved.boundary.boundaryFingerprint,
    });
    return { ok: false, code: "UNAVAILABLE", operationId, stages, status: "failed", generation };
  }
  if (input.expectedUserId && input.expectedUserId !== input.resolved.boundary.userId) {
    return { ok: false, code: "UNAUTHENTICATED", operationId, stages, status: "failed", generation };
  }
  if (
    input.expectedBoundaryFingerprint
    && input.expectedBoundaryFingerprint !== input.resolved.boundary.boundaryFingerprint
  ) {
    brokerLog("warn", "auth.broker.logout.boundary_mismatch", {
      error_code: "BOUNDARY_MISMATCH",
      operation_id: operationId,
      boundary_fp: input.expectedBoundaryFingerprint,
    });
    return { ok: false, code: "UNAUTHENTICATED", operationId, stages, status: "failed", generation };
  }

  const { encryptSecret } = await import("./crypto");
  const accessTokenEnc = encryptSecret(input.resolved.accessToken)?.toString("base64") ?? null;
  const opOk = await createBrokerOperation({
    operationKey: operationId,
    kind: "logout",
    actorUserId: input.resolved.boundary.userId,
    targetNativeSessionId: input.resolved.boundary.nativeSessionId,
    targetSnapshot: [
      {
        nativeSessionId: input.resolved.boundary.nativeSessionId,
        registryId: input.resolved.registryId,
        cookieName: input.resolved.boundary.cookieName,
        boundaryFingerprint: input.resolved.boundary.boundaryFingerprint,
        generation,
        accessTokenEnc,
        receipt: "pending",
      },
    ],
  });
  if (opOk !== true) {
    return { ok: false, code: "UNAVAILABLE", operationId, stages, status: "failed", generation };
  }
  const { freezeOperationSnapshot } = await import("./registry");
  const frozen = await freezeOperationSnapshot(operationId, input.resolved.boundary.userId, [
    {
      nativeSessionId: input.resolved.boundary.nativeSessionId,
      registryId: input.resolved.registryId,
      cookieName: input.resolved.boundary.cookieName,
      boundaryFingerprint: input.resolved.boundary.boundaryFingerprint,
      generation,
      accessTokenEnc,
      receipt: "pending",
    },
  ]);

  if (frozen !== true) {
    stages.contextRead = "unknown";
    await updateBrokerOperation(operationId, { status: "pending", stages });
    return { ok: false, code: "UNAVAILABLE", message: "LOGOUT_SNAPSHOT_PENDING", operationId, stages, status: "pending", generation };
  }
  stages.contextRead = "confirmed";
  stages.appRevocation = "pending";
  const tombstoned = await markSessionStatus(input.resolved.registryId, "tombstoned");
  if (!tombstoned) {
    stages.appRevocation = "unknown";
    await updateBrokerOperation(operationId, { status: "pending", stages });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "LOGOUT_REVOCATION_PENDING",
      operationId,
      stages,
      status: "pending",
      generation,
    };
  }
  stages.appRevocation = "confirmed";
  stages.clientCleanup = "pending";

  const native = await adminLocalSignOut(input.resolved.accessToken);
  stages.nativeRevocation = native === "confirmed" ? "confirmed" : native === "rejected" ? "rejected" : "unknown";

  try {
    const userClient = createUserClientFromTokens(input.resolved.accessToken, input.resolved.refreshToken);
    if (userClient) await userClient.auth.signOut({ scope: "local" });
  } catch {
    /* native stage already recorded */
  }

  expireHandleCookie(input.writer, input.resolved.boundary.cookieName);
  // Cookie expiry is local browser effect — do NOT claim server-confirmed clientCleanup alone.
  stages.cookieCommit = "confirmed";
  stages.clientCleanup = "pending";

  const status =
    stages.nativeRevocation === "confirmed"
      ? "confirmed"
      : stages.nativeRevocation === "unknown"
        ? "unknown"
        : "pending";

  // Server-confirmed stages only: native + tombstone. clientCleanup stays pending until UI ack.
  const persisted = await updateBrokerOperation(operationId, {
    status,
    stages: {
      ...stages,
      // Honest: browser cleanup is not server-proven.
      clientCleanup: "pending",
    },
  });
  if (!persisted) {
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "LOGOUT_REVOCATION_PENDING",
      operationId,
      stages,
      status: "pending",
      generation,
    };
  }

  brokerLog(status === "confirmed" ? "info" : "warn", "auth.broker.logout.finished", {
    user_id: input.resolved.boundary.userId,
    boundary_fp: input.resolved.boundary.boundaryFingerprint,
    operation_id: operationId,
    error_code: status === "confirmed" ? undefined : "LOGOUT_NATIVE_PENDING",
    stage: "nativeRevocation",
    status,
  });

  return {
    ok: status === "confirmed",
    code: status === "confirmed" ? undefined : "UNAVAILABLE",
    message: status === "confirmed" ? undefined : "LOGOUT_REVOCATION_PENDING",
    operationId,
    stages,
    status,
    generation,
  };
}

export async function brokerExpireCapturedHandle(
  resolved: Resolved,
  writer: CookieWriter,
  expectedBoundaryFingerprint?: string,
): Promise<boolean> {
  if (
    expectedBoundaryFingerprint
    && expectedBoundaryFingerprint !== resolved.boundary.boundaryFingerprint
  ) {
    return false;
  }
  const ok = await markSessionStatus(resolved.registryId, "quarantined");
  if (!ok) return false;
  expireHandleCookie(writer, resolved.boundary.cookieName);
  return true;
}
