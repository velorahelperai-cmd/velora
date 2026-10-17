import "server-only";
import { validClientOperationKey } from "../operation-key";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { newOpaqueHandle } from "./crypto";
import { expireHandleCookie, type CookieWriter } from "./cookies";
import {
  createBrokerOperation,
  loadBrokerOperation,
  freezeLegacyCoverageOnOperation,
  freezeOperationSnapshot,
  listActiveSessionsForUser,
  markSessionStatus,
  operationRevocationComplete,
  probeBrokerCapability,
  reconcileNativeRevocation,
  completeRevocationOperation,
  setAdmissionBarrier,
  updateBrokerOperation,
  updateOperationTargetReceipts,
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

function isAmbiguousCredentialError(error: { name?: string; status?: number; message?: string } | null): boolean {
  if (!error) return true;
  const name = error.name ?? "";
  if (name === "AuthRetryableFetchError" || name.includes("Retryable") || name.includes("FetchError")) {
    return true;
  }
  if (error.status === 0 || error.status === 408 || error.status === 429 || (error.status != null && error.status >= 500)) {
    return true;
  }
  return false;
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
    if (isAmbiguousCredentialError(error)) return "unknown";
    return "rejected";
  } catch {
    return "unknown";
  }
}

export async function brokerUpdatePassword(input: {
  resolved: Resolved;
  password: string;
  writer: CookieWriter;
  expectedUserId?: string;
  expectedBoundaryFingerprint?: string;
  operationKey?: string;
}): Promise<{
  ok: boolean;
  code?: "INVALID_INPUT" | "UNAUTHENTICATED" | "UNAVAILABLE" | "AUTH_ERROR";
  message?: string;
  operationId: string;
  stages: BrokerStageReceipt;
}> {
  const stages = emptyStages();
  const operationId = input.operationKey ?? newOpaqueHandle();
  if (input.operationKey !== undefined && !validClientOperationKey(input.operationKey)) {
    return { ok: false, code: "INVALID_INPUT", operationId, stages };
  }
  if (typeof input.password !== "string" || input.password.length < 8) {
    return { ok: false, code: "INVALID_INPUT", operationId, stages };
  }
  const capability = await probeBrokerCapability();
  if (!capability.ok || capability.revokeAtOperation !== true) {
    return { ok: false, code: "UNAVAILABLE", operationId, stages };
  }
  if (input.expectedUserId && input.expectedUserId !== input.resolved.boundary.userId) {
    return { ok: false, code: "UNAUTHENTICATED", operationId, stages };
  }
  if (
    !input.expectedBoundaryFingerprint
    || input.expectedBoundaryFingerprint !== input.resolved.boundary.boundaryFingerprint
  ) {
    return { ok: false, code: "UNAUTHENTICATED", operationId, stages };
  }

  const reserved = await createBrokerOperation({
    operationKey: operationId,
    kind: "password_revoke",
    actorUserId: input.resolved.boundary.userId,
    targetNativeSessionId: input.resolved.boundary.nativeSessionId,
    targetSnapshot: [],
  });
  if (reserved !== true) {
    return { ok: false, code: "UNAVAILABLE", operationId, stages };
  }

  const lineageId = input.resolved.boundary.browserLineageId;
  if (!lineageId) {
    return { ok: false, code: "UNAUTHENTICATED", operationId, stages };
  }
  const barrier = await setAdmissionBarrier(input.resolved.boundary.userId, operationId, true, {
    handleHash: input.resolved.handleHash,
    browserLineageId: lineageId,
  });
  if (barrier !== true) {
    await updateBrokerOperation(operationId, { status: "failed", stages });
    return { ok: false, code: "UNAVAILABLE", operationId, stages };
  }

  const inventory = await listActiveSessionsForUser(input.resolved.boundary.userId);
  if (!inventory.ok) {
    stages.contextRead = "unknown";
    await setAdmissionBarrier(input.resolved.boundary.userId, operationId, false);
    await updateBrokerOperation(operationId, { status: "failed", stages });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGE_INVENTORY_PENDING",
      operationId,
      stages,
    };
  }
  stages.contextRead = "confirmed";

  // Encrypted credential refs only — never plaintext accessToken in snapshot (C2-R4/P11).
  const snapshot = inventory.sessions.map((t) => ({
    registryId: t.id,
    nativeSessionId: t.nativeSessionId,
    cookieName: t.cookieName,
    status: t.status,
    accessTokenEnc: t.accessTokenEnc,
    refreshTokenEnc: t.refreshTokenEnc,
    receipt: "pending",
  }));

  const frozen = await freezeOperationSnapshot(
    operationId,
    input.resolved.boundary.userId,
    snapshot,
  );
  if (frozen !== true) {
    await setAdmissionBarrier(input.resolved.boundary.userId, operationId, false);
    await updateBrokerOperation(operationId, { status: "failed", stages });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGE_SNAPSHOT_PENDING",
      operationId,
      stages,
    };
  }
  // Freeze legacy coverage BEFORE irreversible credential mutation (C4-03).
  const coverageFrozen = await freezeLegacyCoverageOnOperation(operationId, inventory.legacyCoverage);
  if (coverageFrozen !== true) {
    await setAdmissionBarrier(input.resolved.boundary.userId, operationId, false);
    await updateBrokerOperation(operationId, { status: "failed", stages });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGE_LEGACY_FREEZE_PENDING",
      operationId,
      stages,
    };
  }

  const userClient = createUserClientFromTokens(input.resolved.accessToken, input.resolved.refreshToken);
  if (!userClient) {
    await updateBrokerOperation(operationId, { status: "pending", stages });
    return { ok: false, code: "UNAVAILABLE", operationId, stages };
  }

  stages.credentialMutation = "pending";
  try {
    const { error } = await userClient.auth.updateUser({ password: input.password });
    if (error) {
      if (isAmbiguousCredentialError(error)) {
        stages.credentialMutation = "unknown";
        const persisted = await updateBrokerOperation(operationId, { status: "pending", stages });
        if (persisted !== true) {
          brokerLog("error", "auth.broker.password.stage_persist_failed", {
            error_code: "STAGE_PERSIST_FAILED",
            operation_id: operationId,
          });
        }
        // Barrier stays; never replay password (C2-R4/P12).
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "PASSWORD_CHANGE_OUTCOME_UNKNOWN",
          operationId,
          stages,
        };
      }
      stages.credentialMutation = "rejected";
      await setAdmissionBarrier(input.resolved.boundary.userId, operationId, false);
      await updateBrokerOperation(operationId, { status: "failed", stages });
      return { ok: false, code: "AUTH_ERROR", operationId, stages };
    }
    stages.credentialMutation = "confirmed";
    const mutationCutoff = new Date().toISOString();
    const persisted = await updateBrokerOperation(operationId, {
      credential_mutated_at: mutationCutoff,
      cutoff: mutationCutoff,
      stages,
      status: "pending",
    });
    if (persisted !== true) {
      // Mutation happened; must not replay — leave barrier, pending recovery.
      brokerLog("error", "auth.broker.password.mutation_persist_failed", {
        error_code: "MUTATION_PERSIST_FAILED",
        operation_id: operationId,
      });
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "PASSWORD_CHANGE_OUTCOME_UNKNOWN",
        operationId,
        stages,
      };
    }
  } catch {
    stages.credentialMutation = "unknown";
    await updateBrokerOperation(operationId, { status: "pending", stages });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGE_OUTCOME_UNKNOWN",
      operationId,
      stages,
    };
  }

  const opAfterMutation = await loadBrokerOperation(operationId);
  const cutoff = opAfterMutation?.cutoff;
  if (!cutoff) {
    stages.appRevocation = "unknown";
    await updateBrokerOperation(operationId, { status: "pending", stages });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGE_CUTOFF_MISSING",
      operationId,
      stages,
    };
  }
  stages.appRevocation = "pending";
  const admin = createAdminClient();
  if (!admin) {
    stages.appRevocation = "unknown";
    await updateBrokerOperation(operationId, { status: "pending", stages, cutoff });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
      operationId,
      stages,
    };
  }

  let revoked: unknown;
  let revokeError: unknown;
  try {
    const appReply = await admin.rpc(
    "vel_broker_revoke_sessions_at" as never,
    {
      p_expected_user_id: input.resolved.boundary.userId,
      p_operation_key: operationId,
      p_cutoff: cutoff,
    } as never,
  );
    revoked = appReply.data;
    revokeError = appReply.error;
  } catch {
    // Credentials already changed: retain original operation/cutoff for recovery.
    revoked = null;
    revokeError = { code: "APP_REVOKE_TRANSPORT_UNKNOWN" };
  }

  if (revokeError || revoked !== true) {
    stages.appRevocation = revokeError || revoked !== false ? "unknown" : "rejected";
    await updateBrokerOperation(operationId, { status: "pending", stages, cutoff });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
      operationId,
      stages,
    };
  }
  stages.appRevocation = "confirmed";
  const appRevokePersisted = await updateBrokerOperation(operationId, {
    status: "pending",
    stages,
    cutoff,
  });
  if (appRevokePersisted !== true) {
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
      operationId,
      stages,
    };
  }

  const receipts: Record<string, string> = {};
  let nativeConfirmed = 0;
  let nativePending = 0;
  for (const target of inventory.sessions) {
    const outcome = await adminLocalSignOut(target.accessToken);
    if (outcome === "confirmed") {
      nativeConfirmed += 1;
      receipts[target.id] = "native_confirmed";
      await markSessionStatus(target.id, "revoked");
      expireHandleCookie(input.writer, target.cookieName);
    } else {
      nativePending += 1;
      receipts[target.id] = outcome === "rejected" ? "native_rejected" : "native_unknown";
      await markSessionStatus(target.id, "quarantined");
    }
  }
  const receiptsPersisted = await updateOperationTargetReceipts(operationId, receipts);
  if (receiptsPersisted !== true) {
    await updateBrokerOperation(operationId, { status: "pending", stages });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
      operationId,
      stages,
    };
  }

  const nativeProof=await reconcileNativeRevocation(input.resolved.boundary.userId,operationId);
  if(nativeProof){Object.assign(receipts,nativeProof.targetReceipts);nativePending=0;nativeConfirmed=inventory.sessions.length;for(const target of inventory.sessions)expireHandleCookie(input.writer,target.cookieName);}
  const completeness = operationRevocationComplete({
    legacyCoverage: nativeProof?.legacyCoverage ?? inventory.legacyCoverage,
    targetSnapshot: snapshot,
    targetReceipts: receipts,
  });
  if (!completeness || nativePending > 0) {
    stages.nativeRevocation = "unknown";
    stages.cookieCommit = nativeConfirmed > 0 ? "confirmed" : "pending";
    stages.clientCleanup = "pending";
    await updateBrokerOperation(operationId, { status: "pending", stages });
    brokerLog("warn", "auth.broker.password.native_pending", {
      error_code: "NATIVE_REVOKE_PENDING",
      operation_id: operationId,
      user_id: input.resolved.boundary.userId,
      native_confirmed: nativeConfirmed,
      native_pending: nativePending,
      target_count: inventory.sessions.length,
    });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
      operationId,
      stages,
    };
  }

  stages.nativeRevocation = "confirmed";
  stages.cookieCommit = "confirmed";
  stages.clientCleanup = "pending";
  const readyPersisted = await updateBrokerOperation(operationId, {
    status: "pending",
    stages,
    cutoff,
  });
  if (readyPersisted !== true) {
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
      operationId,
      stages,
    };
  }
  // Atomic confirm + barrier release. Never downgrade confirmed on lost/false reply (C5-R4).
  const finished = await completeRevocationOperation(
    input.resolved.boundary.userId,
    operationId,
  );
  if (finished === true) {
    return { ok: true, operationId, stages };
  }
  const again = await loadBrokerOperation(operationId);
  if (again?.status === "confirmed") {
    return { ok: true, operationId, stages };
  }
  return {
    ok: false,
    code: "UNAVAILABLE",
    message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
    operationId,
    stages,
  };
}
