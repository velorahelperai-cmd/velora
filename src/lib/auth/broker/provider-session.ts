import "server-only";
import type { Session } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProviderAuthBundle } from "./provider";
import { brokerLog } from "./log";
import { nativeSessionIdFromAccessToken } from "./session-id";
import { encryptSecret, decryptSecret } from "./crypto";

export type ProviderCleanupOutcome = "confirmed" | "unknown" | "rejected";

export type ProviderCleanupJournal = {
  intentId?: string | null;
  operationKey: string;
};

export type CleanupResult = {
  outcome: ProviderCleanupOutcome;
  cleanupOperationId: string;
  durable: boolean;
};

async function persistCleanupState(
  journal: ProviderCleanupJournal | undefined,
  outcome: ProviderCleanupOutcome,
  session?: Session | null,
): Promise<{ cleanupOperationId: string; durable: boolean }> {
  const opId = journal?.operationKey ?? journal?.intentId ?? "unknown";
  if (!journal?.intentId) {
    return { cleanupOperationId: opId, durable: false };
  }
  const admin = createAdminClient();
  if (!admin) {
    return { cleanupOperationId: opId, durable: false };
  }
  const cleanupState = outcome === "confirmed" ? "confirmed" : outcome === "rejected" ? "rejected" : "unknown";
  const providerState = outcome === "confirmed" ? "rejected" : "unknown";
  const patch: Record<string, unknown> = {
    cleanup_state: cleanupState,
    provider_state: providerState,
    updated_at: new Date().toISOString(),
  };
  // Persist encrypted refs when capture may have failed (R4-F05).
  if (session?.access_token && session.refresh_token) {
    const accessEnc = encryptSecret(session.access_token)?.toString("base64");
    const refreshEnc = encryptSecret(session.refresh_token)?.toString("base64");
    const nativeId = nativeSessionIdFromAccessToken(session.access_token);
    if (accessEnc && refreshEnc && nativeId) {
      patch.provider_access_enc = accessEnc;
      patch.provider_refresh_enc = refreshEnc;
      patch.committed_native_session_id = nativeId;
      if (session.user?.id) patch.user_id = session.user.id;
    }
  }
  const { data, error } = await admin
    .from("vel_broker_auth_intents" as never)
    .update(patch as never)
    .eq("id", journal.intentId as never)
    .neq("status", "committed" as never)
    .neq("cleanup_state", "confirmed" as never)
    .select("id");
  if (error || !Array.isArray(data) || data.length !== 1) {
    brokerLog("warn", "auth.broker.provider.cleanup_journal_failed", {
      error_code: error?.code ?? "CLEANUP_JOURNAL_WRITE_FAILED",
      stage: "persist",
    });
    return { cleanupOperationId: opId, durable: false };
  }
  return { cleanupOperationId: opId, durable: true };
}

/**
 * Local provider sign-out after broker admit failed. Durable cleanup disposition (C5-R4 / R4-F05).
 * Never claims confirmed durability when journal write failed.
 */
export async function signOutProviderSessionAfterAdmitFailure(
  _bundle: ProviderAuthBundle,
  session: Session,
  journal?: ProviderCleanupJournal,
): Promise<CleanupResult> {
  if (!session.access_token || !session.refresh_token) {
    brokerLog("warn", "auth.broker.provider.cleanup_missing_tokens", {
      error_code: "PROVIDER_CLEANUP_NO_TOKENS",
      stage: "admit_failure",
    });
    const persisted = await persistCleanupState(journal, "unknown", session);
    return {
      outcome: "unknown",
      cleanupOperationId: persisted.cleanupOperationId,
      durable: persisted.durable,
    };
  }
  const operationId = journal?.operationKey ?? journal?.intentId ?? "unknown";
  const admin = createAdminClient();
  const nativeId = nativeSessionIdFromAccessToken(session.access_token);
  const accessEnc = encryptSecret(session.access_token)?.toString("base64");
  const refreshEnc = encryptSecret(session.refresh_token)?.toString("base64");
  if (!admin || !journal?.intentId || !nativeId || !session.user?.id || !accessEnc || !refreshEnc) {
    return { outcome: "unknown", cleanupOperationId: operationId, durable: false };
  }
  // Authoritative disposition precedes external effect. Adopted sessions are never revoked.
  type CleanupDecision = {ok?:boolean;allowed?:boolean;cleanup_state?:string};
  let decision: CleanupDecision | null = null;
  try {
    const {data,error} = await admin.rpc("vel_broker_begin_provider_cleanup" as never, {
      p_intent_id: journal.intentId, p_user_id: session.user.id, p_native_session_id: nativeId,
      p_access_token_enc: accessEnc, p_refresh_token_enc: refreshEnc,
    } as never);
    if (!error && data && typeof data === "object") decision = data as CleanupDecision;
  } catch { /* Lost disposition reply: no external effect; persisted unknown remains resumable. */ }
  if (!decision?.ok || decision.allowed !== true) {
    const confirmed = decision?.ok === true && decision.cleanup_state === "confirmed";
    return { outcome: confirmed ? "confirmed" : "unknown", cleanupOperationId: operationId, durable: confirmed };
  }
  let providerOutcome: ProviderCleanupOutcome = "unknown";
  try {
    // Revoke the captured session directly; setSession may refresh/rotate its tokens.
    if (admin) {
      const { error } = await admin.auth.admin.signOut(session.access_token, "local");
      if (!error) {
        providerOutcome = "confirmed";
      } else {
        const status = typeof error.status === "number" ? error.status : 0;
        providerOutcome = status === 0 || status === 401 || status === 403 || status === 404
          || status === 408 || status === 429 || status >= 500 ? "unknown" : "rejected";
      }
    }
  } catch {
    providerOutcome = "unknown";
  }
  const persisted = await persistCleanupState(journal, providerOutcome, session);
  // Durability failure: never report confirmed (P02).
  if (!persisted.durable) {
    return {
      outcome: "unknown",
      cleanupOperationId: persisted.cleanupOperationId,
      durable: false,
    };
  }
  return {
    outcome: providerOutcome,
    cleanupOperationId: persisted.cleanupOperationId,
    durable: true,
  };
}

/** Resume only captured cleanup owned by the authoritative bound intent; never re-run login/OTP/OAuth. */
export async function resumeProviderCleanup(intentId: string, browserLineageId: string): Promise<CleanupResult | null> {
  const admin = createAdminClient();
  if (!admin || !intentId || !browserLineageId) return null;
  const {data,error} = await admin.from("vel_broker_auth_intents" as never).select("*")
    .eq("id",intentId as never).eq("browser_lineage_id",browserLineageId as never).maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string,unknown>;
  if (row.status !== "rejected" || !["unknown","rejected","confirmed"].includes(String(row.cleanup_state))) return null;
  if (row.cleanup_state === "confirmed") return {outcome:"confirmed",durable:true,cleanupOperationId:intentId};
  if (typeof row.provider_access_enc !== "string" || typeof row.provider_refresh_enc !== "string" || typeof row.user_id !== "string") return null;
  const access = decryptSecret(Buffer.from(row.provider_access_enc,"base64"));
  const refresh = decryptSecret(Buffer.from(row.provider_refresh_enc,"base64"));
  if (!access || !refresh || nativeSessionIdFromAccessToken(access) !== row.committed_native_session_id) return null;
  return signOutProviderSessionAfterAdmitFailure({} as ProviderAuthBundle,
    {access_token:access,refresh_token:refresh,user:{id:row.user_id}} as Session,
    {intentId,operationKey:intentId});
}
