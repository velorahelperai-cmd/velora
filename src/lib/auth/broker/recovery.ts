import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { decryptSecret } from "./crypto";
import { expireHandleCookie, type CookieWriter } from "./cookies";
import {
  reconcileNativeRevocation,
  completeRevocationOperation,
  loadBrokerOperation,
  markSessionStatus,
  operationRevocationComplete,
  updateBrokerOperation,
  updateOperationTargetReceipts,
} from "./registry";
import { brokerLog } from "./log";
import type { BrokerStageReceipt } from "./types";

type FrozenTarget = {
  registryId?: string;
  nativeSessionId?: string;
  cookieName?: string;
  accessTokenEnc?: string | null;
  receipt?: string;
};

function asStages(raw: Record<string, unknown>): BrokerStageReceipt {
  const pick = (k: keyof BrokerStageReceipt): BrokerStageReceipt[keyof BrokerStageReceipt] => {
    const v = raw[k];
    if (
      v === "not_attempted"
      || v === "pending"
      || v === "confirmed"
      || v === "rejected"
      || v === "unknown"
    ) {
      return v;
    }
    return "not_attempted";
  };
  return {
    credentialMutation: pick("credentialMutation"),
    appRevocation: pick("appRevocation"),
    nativeRevocation: pick("nativeRevocation"),
    cookieCommit: pick("cookieCommit"),
    clientCleanup: pick("clientCleanup"),
    contextRead: pick("contextRead"),
  };
}

function decB64(value: string): string | null {
  try {
    return decryptSecret(Buffer.from(value, "base64"));
  } catch {
    return null;
  }
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

/**
 * Resume original operation with trusted actorUserId (from broker session — not client claim).
 * Per-target receipts; immutable cutoff; encrypted credential refs; no password replay (C2-R5).
 */
export async function resumeBrokerOperation(input: {
  operationKey: string;
  /** Must be derived from authenticated broker boundary, never bare client expectedUserId. */
  actorUserId: string;
  writer: CookieWriter;
}): Promise<{
  ok: boolean;
  code?: "UNAUTHENTICATED" | "UNAVAILABLE" | "FORBIDDEN";
  message?: string;
  stages: BrokerStageReceipt;
  status: string;
}> {
  const op = await loadBrokerOperation(input.operationKey);
  if (!op) {
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "OPERATION_NOT_FOUND",
      stages: asStages({}),
      status: "failed",
    };
  }
  if (op.actorUserId !== input.actorUserId) {
    brokerLog("warn", "auth.broker.recovery.foreign_denied", {
      error_code: "FOREIGN_OPERATION",
      operation_id: input.operationKey,
      user_id: input.actorUserId,
    });
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "FOREIGN_OPERATION",
      stages: asStages(op.stages),
      status: op.status,
    };
  }
  if (op.status === "confirmed") {
    return { ok: true, stages: asStages(op.stages), status: "confirmed" };
  }
  if (op.status === "failed") {
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "OPERATION_FAILED",
      stages: asStages(op.stages),
      status: "failed",
    };
  }

  const stages = asStages(op.stages);
  const priorReceipts = op.targetReceipts ?? {};

  if (op.kind === "password_revoke") {
    // Never re-mutate credentials. Reconcile UNKNOWN credential as pending only.
    if (stages.credentialMutation === "unknown" || stages.credentialMutation === "not_attempted") {
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "CREDENTIAL_UNKNOWN_NO_REPLAY",
        stages,
        status: "pending",
      };
    }
    if (stages.credentialMutation !== "confirmed") {
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "CREDENTIAL_NOT_CONFIRMED",
        stages,
        status: "pending",
      };
    }

    // Retry app revoke with immutable cutoff only (never advance).
    if (stages.appRevocation !== "confirmed") {
      if (!op.cutoff) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "CUTOFF_MISSING",
          stages,
          status: "pending",
        };
      }
      const admin = createAdminClient();
      if (!admin) {
        stages.appRevocation = "unknown";
        await updateBrokerOperation(input.operationKey, { status: "pending", stages });
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "APP_REVOKE_PENDING",
          stages,
          status: "pending",
        };
      }
      const { data: revoked, error } = await admin.rpc(
        "vel_broker_revoke_sessions_at" as never,
        {
          p_expected_user_id: input.actorUserId,
          p_operation_key: input.operationKey,
          p_cutoff: op.cutoff,
        } as never,
      );
      if (error || revoked !== true) {
        stages.appRevocation = "unknown";
        await updateBrokerOperation(input.operationKey, { status: "pending", stages });
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "APP_REVOKE_PENDING",
          stages,
          status: "pending",
        };
      }
      stages.appRevocation = "confirmed";
      await updateBrokerOperation(input.operationKey, { status: "pending", stages });
    }

    const frozen = op.targetSnapshot as FrozenTarget[];
    if (!Array.isArray(frozen)) {
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "FROZEN_TARGETS_INVALID",
        stages,
        status: "pending",
      };
    }

    const receipts: Record<string, string> = { ...(priorReceipts as Record<string, string>) };
    let pending = 0;
    let confirmed = 0;
    for (const target of frozen) {
      if (!target.registryId) {
        pending += 1;
        continue;
      }
      if (receipts[target.registryId] === "native_confirmed") {
        confirmed += 1;
        continue;
      }
      const token = target.accessTokenEnc ? decB64(target.accessTokenEnc) : null;
      if (token) {
        const outcome = await adminLocalSignOut(token);
        if (outcome === "confirmed") {
          await markSessionStatus(target.registryId, "revoked");
          if (target.cookieName) expireHandleCookie(input.writer, target.cookieName);
          receipts[target.registryId] = "native_confirmed";
          confirmed += 1;
        } else {
          await markSessionStatus(target.registryId, "quarantined");
          if (target.cookieName) expireHandleCookie(input.writer, target.cookieName);
          receipts[target.registryId] = "native_unknown";
          pending += 1;
        }
      } else {
        await markSessionStatus(target.registryId, "quarantined");
        if (target.cookieName) expireHandleCookie(input.writer, target.cookieName);
        receipts[target.registryId] = "credential_ref_missing";
        pending += 1;
      }
    }
    const receiptsSaved = await updateOperationTargetReceipts(input.operationKey, receipts);
    if (receiptsSaved !== true) {
      await updateBrokerOperation(input.operationKey, { status: "pending", stages });
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
        stages,
        status: "pending",
      };
    }

    stages.cookieCommit = confirmed > 0 || pending > 0 ? "confirmed" : "pending";
    stages.clientCleanup = "pending";
    const nativeProof=await reconcileNativeRevocation(input.actorUserId,input.operationKey);
    if(nativeProof){Object.assign(receipts,nativeProof.targetReceipts);pending=0;confirmed=frozen.length;for(const target of frozen)if(target.cookieName)expireHandleCookie(input.writer,target.cookieName);}
    const complete = operationRevocationComplete({
      legacyCoverage: nativeProof?.legacyCoverage ?? op.legacyCoverage,
      targetSnapshot: frozen,
      targetReceipts: receipts,
    });
    if (!complete || pending > 0) {
      stages.nativeRevocation = "unknown";
      await updateBrokerOperation(input.operationKey, { status: "pending", stages });
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
        stages,
        status: "pending",
      };
    }

    stages.nativeRevocation = "confirmed";
    const nativePersisted = await updateBrokerOperation(input.operationKey, {
      status: "pending",
      stages,
    });
    if (nativePersisted !== true) {
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "PASSWORD_CHANGED_SESSION_REVOCATION_PENDING",
        stages,
        status: "pending",
      };
    }
    const finished = await completeRevocationOperation(input.actorUserId, input.operationKey);
    if (finished === true) {
      return { ok: true, stages, status: "confirmed" };
    }
    const again = await loadBrokerOperation(input.operationKey);
    if (again?.status === "confirmed") {
      return { ok: true, stages: asStages(again.stages), status: "confirmed" };
    }
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "BARRIER_RELEASE_PENDING",
      stages,
      status: again?.status ?? "pending",
    };
  }

  if (op.kind === "logout") {
    const frozen = op.targetSnapshot as FrozenTarget[];
    const receipts: Record<string, string> = { ...(priorReceipts as Record<string, string>) };
    let pending = 0;
    for (const target of frozen) {
      const key = target.registryId ?? target.nativeSessionId ?? "unknown";
      if (receipts[key] === "native_confirmed") continue;
      const token = target.accessTokenEnc ? decB64(target.accessTokenEnc) : null;
      if (token) {
        const outcome = await adminLocalSignOut(token);
        if (outcome === "confirmed") {
          receipts[key] = "native_confirmed";
          if (target.registryId) await markSessionStatus(target.registryId, "tombstoned");
        } else {
          receipts[key] = "native_unknown";
          pending += 1;
        }
      } else {
        receipts[key] = "credential_ref_missing";
        pending += 1;
      }
      if (target.cookieName) expireHandleCookie(input.writer, target.cookieName);
      if (target.registryId) await markSessionStatus(target.registryId, "tombstoned");
    }
    await updateOperationTargetReceipts(input.operationKey, receipts);
    stages.cookieCommit = "confirmed";
    stages.clientCleanup = "pending";
    if (pending === 0 && stages.nativeRevocation === "confirmed") {
      await updateBrokerOperation(input.operationKey, { status: "confirmed", stages });
      return { ok: true, stages, status: "confirmed" };
    }
    if (pending === 0) {
      stages.nativeRevocation = "confirmed";
      await updateBrokerOperation(input.operationKey, { status: "confirmed", stages });
      return { ok: true, stages, status: "confirmed" };
    }
    stages.nativeRevocation = "unknown";
    await updateBrokerOperation(input.operationKey, { status: "pending", stages });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "LOGOUT_REVOCATION_PENDING",
      stages,
      status: "pending",
    };
  }

  return {
    ok: false,
    code: "UNAVAILABLE",
    message: "UNSUPPORTED_KIND",
    stages,
    status: op.status,
  };
}

/**
 * Client cleanup ack — requires authenticated broker actor matching operation owner.
 * Never marks operation confirmed from clientCleanup alone.
 */
export async function acknowledgeBrokerClientCleanup(input: {
  operationKey: string;
  actorUserId: string;
}): Promise<boolean> {
  const op = await loadBrokerOperation(input.operationKey);
  if (!op || op.actorUserId !== input.actorUserId) return false;
  // Cleanup acknowledgment cannot rewrite terminal status, unrelated stages,
  // or apply password-wide completeness rules to a single-session logout.
  const stages = { ...op.stages, clientCleanup: "confirmed" };
  return (await updateBrokerOperation(input.operationKey, { stages })) === true;
}
