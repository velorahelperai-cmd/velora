import "server-only";
import { commitHandleCookie, commitIntentCookie, expireIntentCookie, type CookieReader, type CookieWriter } from "./cookies";
import { prepareBrokerAdmissionLineage } from "./lineage-auth";
import { brokerLog } from "./log";
import { createProviderAuthClient, readPkceVerifier, seedPkceVerifier } from "./provider";
import {
  admitBoundSessionAtomic,
  claimProviderAttempt,
  loadAuthIntentByNonce,
  loadBrokerOperation,
  materializeCommittedIntentAdmission,
  probeBrokerCapability,
  recordProviderSessionCapture,
  reserveBoundAuthIntent,
} from "./registry";
import { expiresAtFromSession, nativeSessionIdFromAccessToken } from "./session-id";
import { authCallbackUrl } from "@/lib/auth/site-url";
import { signOutProviderSessionAfterAdmitFailure, resumeProviderCleanup } from "./provider-session";

async function admitCapturedSession(input: {
  session: {
    user?: { id?: string } | null;
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    expires_in?: number;
  };
  writer: CookieWriter;
  intentId: string;
  browserLineageId: string;
  admissionScope: "app" | "recovery";
  recoveryOperationKey?: string | null;
}): Promise<
  | { ok: true; generation: string; userId: string; boundaryFingerprint: string }
  | { ok: false; code: "UNAVAILABLE" | "ADMISSION_BLOCKED" }
> {
  const userId = input.session.user?.id;
  if (!userId) return { ok: false, code: "UNAVAILABLE" };
  const nativeSessionId = nativeSessionIdFromAccessToken(input.session.access_token);
  if (!nativeSessionId) return { ok: false, code: "UNAVAILABLE" };
  const expiresAt = expiresAtFromSession(input.session.expires_at, input.session.expires_in);
  const captured = await recordProviderSessionCapture({
    intentId: input.intentId,
    userId,
    nativeSessionId,
    accessToken: input.session.access_token,
    refreshToken: input.session.refresh_token,
    expiresAt,
  });
  if (!captured) return { ok: false, code: "UNAVAILABLE" };

  const committed = await admitBoundSessionAtomic({
    intentId: input.intentId,
    userId,
    nativeSessionId,
    accessToken: input.session.access_token,
    refreshToken: input.session.refresh_token,
    expiresAt,
    admissionScope: input.admissionScope,
    recoveryOperationKey: input.recoveryOperationKey,
    browserLineageId: input.browserLineageId,
  });
  if (!committed) return { ok: false, code: "ADMISSION_BLOCKED" };
  commitHandleCookie(input.writer, committed.cookieName, committed.handle);
  return {
    ok: true,
    generation: committed.generation,
    userId: committed.userId,
    boundaryFingerprint: committed.boundaryFingerprint,
  };
}

export async function brokerPasswordLogin(input: {
  email: string;
  password: string;
  writer: CookieWriter;
  reader?: CookieReader;
  parentHandleHash?: string | null;
  recoveryOperationKey?: string | null;
  admissionScope?: "app" | "recovery";
  /** Client gesture nonce — required for reserve idempotency (R4-F04). */
  requestNonce?: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; code: "INVALID_INPUT" | "AUTH_ERROR" | "UNAVAILABLE" | "ADMISSION_BLOCKED" | "CONTINUITY_REQUIRED" }
> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) return { ok: false, code: "INVALID_INPUT" };
  const capability = await probeBrokerCapability();
  if (!capability.ok || !capability.boundAdmit) return { ok: false, code: "UNAVAILABLE" };
  if (!input.reader) return { ok: false, code: "UNAVAILABLE" };
  const requestNonce =
    typeof input.requestNonce === "string" && input.requestNonce.length >= 16
      ? input.requestNonce
      : null;
  if (!requestNonce) return { ok: false, code: "UNAVAILABLE" };

  const lineageCtx = await prepareBrokerAdmissionLineage(input.reader, input.writer);
  if (!lineageCtx.ok) {
    return { ok: false, code: lineageCtx.code === "CONTINUITY_REQUIRED" ? "CONTINUITY_REQUIRED" : "UNAVAILABLE" };
  }

  const intent = await reserveBoundAuthIntent({
    bootstrapHash: lineageCtx.bootstrapHash,
    requestNonce,
    purpose: input.recoveryOperationKey ? "recovery_reauth" : "password_login",
    recoveryOperationKey: input.recoveryOperationKey ?? null,
  });
  if (!intent) return { ok: false, code: "UNAVAILABLE" };

  const claim = await claimProviderAttempt(intent.id);
  if (!claim.ok || claim.claimed !== true) {
    await resumeProviderCleanup(intent.id, lineageCtx.browserLineageId);
    return { ok: false, code: "UNAVAILABLE" };
  }

  const bundle = createProviderAuthClient();
  if (!bundle) return { ok: false, code: "UNAVAILABLE" };
  const { data, error } = await bundle.client.auth.signInWithPassword({
    email,
    password: input.password,
  });
  if (error || !data.session) {
    const status = error?.status ?? 0;
    const unknown = !error || status === 0 || status === 408 || status === 429 || status >= 500
      || /Retryable|FetchError/.test(error.name ?? "");
    const {createAdminClient} = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const {error: journalError} = await (admin?.from("vel_broker_auth_intents" as never).update({
      provider_state: unknown ? "unknown" : "rejected", cleanup_state: unknown ? "unknown" : "not_needed",
      status: unknown ? "reserved" : "rejected", updated_at: new Date().toISOString(),
    } as never).eq("id",intent.id as never).eq("status","reserved" as never) ?? Promise.resolve({error:{code:"UNAVAILABLE"}}));
    brokerLog("warn", "auth.broker.login.rejected", { error_code: unknown || journalError ? "PROVIDER_UNKNOWN" : "AUTH_ERROR", stage: "provider" });
    return { ok: false, code: unknown || journalError ? "UNAVAILABLE" : "AUTH_ERROR" };
  }

  const scope = input.admissionScope ?? (input.recoveryOperationKey ? "recovery" : "app");
  try {
    if (input.recoveryOperationKey) {
      const original = await loadBrokerOperation(input.recoveryOperationKey);
      if (!original || original.actorUserId !== data.session.user?.id) {
        await signOutProviderSessionAfterAdmitFailure(bundle, data.session, {
          intentId: intent.id, operationKey: input.recoveryOperationKey,
        });
        return { ok: false, code: "AUTH_ERROR" };
      }
    }
    const admitted = await admitCapturedSession({
      session: data.session,
      writer: input.writer,
      intentId: intent.id,
      browserLineageId: intent.browserLineageId,
      admissionScope: scope,
      recoveryOperationKey: input.recoveryOperationKey,
    });
    if (!admitted.ok) {
      await signOutProviderSessionAfterAdmitFailure(bundle, data.session, {
        intentId: intent.id,
        operationKey: input.recoveryOperationKey ?? intent.id,
      });
      return { ok: false, code: admitted.code };
    }
    brokerLog("info", "auth.broker.login.committed", {
      user_id: admitted.userId,
      boundary_fp: admitted.boundaryFingerprint,
      admission_scope: scope,
    });
    return { ok: true };
  } catch {
    await signOutProviderSessionAfterAdmitFailure(bundle, data.session, {
      intentId: intent.id,
      operationKey: input.recoveryOperationKey ?? intent.id,
    });
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function brokerStartOAuth(input: {
  provider: "google";
  next: string;
  writer: CookieWriter;
  reader?: CookieReader;
  parentHandleHash?: string | null;
  requestNonce?: string | null;
}): Promise<{ ok: true; url: string } | { ok: false; code: "UNAVAILABLE" | "CONTINUITY_REQUIRED" | "OAUTH_NEW_INTENT_REQUIRED" }> {
  const capability = await probeBrokerCapability();
  if (!capability.ok) return { ok: false, code: "UNAVAILABLE" };
  const bundle = createProviderAuthClient();
  if (!bundle) return { ok: false, code: "UNAVAILABLE" };
  if (!input.reader) return { ok: false, code: "UNAVAILABLE" };
  const requestNonce =
    typeof input.requestNonce === "string" && input.requestNonce.length >= 16
      ? input.requestNonce
      : null;
  if (!requestNonce) return { ok: false, code: "UNAVAILABLE" };

  const lineageCtx = await prepareBrokerAdmissionLineage(input.reader, input.writer);
  if (!lineageCtx.ok) {
    return { ok: false, code: lineageCtx.code === "CONTINUITY_REQUIRED" ? "CONTINUITY_REQUIRED" : "UNAVAILABLE" };
  }

  const intent = await reserveBoundAuthIntent({
    bootstrapHash: lineageCtx.bootstrapHash,
    requestNonce,
    purpose: "oauth_google",
    ttlSeconds: 600,
  });
  if (!intent) return { ok: false, code: "UNAVAILABLE" };

  const saved = await loadAuthIntentByNonce(intent.stateNonce);
  if (!saved || saved.purpose !== "oauth_google" || saved.browserLineageId !== lineageCtx.browserLineageId
    || !Number.isFinite(Date.parse(saved.expiresAt))) return { ok: false, code: "UNAVAILABLE" };
  if (["committed", "rejected", "expired"].includes(saved.status)) {
    return { ok: false, code: "OAUTH_NEW_INTENT_REQUIRED" };
  }
  // A URL with an unclaimed exchange may be intentionally superseded (cancel,
  // previous successful navigation, lost start response). New reserve fences it.
  // Once exchange was claimed, UNKNOWN must retain its original gesture.
  if (saved.status !== "reserved" || intent.providerState !== "ready") return { ok: false, code: "UNAVAILABLE" };
  if (saved.pkceVerifier || Date.parse(saved.expiresAt) <= Date.now()) {
    return { ok: false, code: "OAUTH_NEW_INTENT_REQUIRED" };
  }

  const base = authCallbackUrl(input.next);
  const redirectTo = `${base}${base.includes("?") ? "&" : "?"}vel_intent=${encodeURIComponent(intent.stateNonce)}`;

  const { data, error } = await bundle.client.auth.signInWithOAuth({
    provider: input.provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) return { ok: false, code: "UNAVAILABLE" };
  const verifier = readPkceVerifier(bundle);
  if (!verifier) return { ok: false, code: "UNAVAILABLE" };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) return { ok: false, code: "UNAVAILABLE" };
  const { encryptSecret } = await import("./crypto");
  const pkceEnc = encryptSecret(verifier)?.toString("base64");
  if (!pkceEnc) return { ok: false, code: "UNAVAILABLE" };
  const { data: pkceRows, error: pkceError } = await admin
    .from("vel_broker_auth_intents" as never)
    .update({ pkce_verifier_enc: pkceEnc, updated_at: new Date().toISOString() } as never)
    .eq("id", intent.id as never)
    .eq("status", "reserved" as never)
    .is("pkce_verifier_enc", null)
    .select("id");
  // Zero-row "success" must not expose a provider URL without a durable verifier.
  if (pkceError || !Array.isArray(pkceRows) || pkceRows.length !== 1) {
    return { ok: false, code: "UNAVAILABLE" };
  }

  commitIntentCookie(input.writer, intent.stateNonce, 600);
  return { ok: true, url: data.url };
}

export async function brokerExchangeOAuthCode(input: {
  code: string;
  stateNonce: string | null;
  writer: CookieWriter;
  reader?: CookieReader;
  parentHandleHash?: string | null;
}): Promise<
  | { ok: true; generation: string }
  | { ok: false; code: "UNAVAILABLE" | "AUTH_ERROR" | "ADMISSION_BLOCKED"; detail?: string; expireIntent?: boolean }
> {
  if (!input.stateNonce || !input.reader) {
    const capability = await probeBrokerCapability();
    if (!capability.ok) return { ok: false, code: "UNAVAILABLE" };
    if (!input.stateNonce) return { ok: false, code: "AUTH_ERROR", detail: "missing_intent", expireIntent: false };
    return { ok: false, code: "UNAVAILABLE", detail: "continuity_required", expireIntent: false };
  }

  const [capability, lineageCtx, intent] = await Promise.all([
    probeBrokerCapability(),
    prepareBrokerAdmissionLineage(input.reader, input.writer),
    loadAuthIntentByNonce(input.stateNonce),
  ]);
  if (!capability.ok) return { ok: false, code: "UNAVAILABLE" };
  if (!lineageCtx.ok) {
    return { ok: false, code: "UNAVAILABLE", detail: "continuity_required", expireIntent: false };
  }
  if (!intent) {
    return { ok: false, code: "AUTH_ERROR", detail: "intent_invalid", expireIntent: true };
  }
  // Exact lineage match required — null legacy intent cannot promote (R4-F04).
  if (!intent.browserLineageId || intent.browserLineageId !== lineageCtx.browserLineageId) {
    return { ok: false, code: "AUTH_ERROR", detail: "continuity_mismatch", expireIntent: false };
  }

  if (intent.status === "committed" && intent.admissionReceipt?.ok === true) {
    const materialized = await materializeCommittedIntentAdmission(intent, lineageCtx.bootstrapHash);
    if (!materialized) {
      return { ok: false, code: "UNAVAILABLE", detail: "receipt_stale", expireIntent: false };
    }
    commitHandleCookie(input.writer, materialized.cookieName, materialized.handle);
    expireIntentCookie(input.writer, input.stateNonce);
    return { ok: true, generation: materialized.generation };
  }

  if (intent.status !== "reserved") {
    if (intent.status === "rejected") {
      await resumeProviderCleanup(intent.id, lineageCtx.browserLineageId);
      return { ok: false, code: "UNAVAILABLE", detail: "cleanup_recovery", expireIntent: false };
    }
    return { ok: false, code: "AUTH_ERROR", detail: "intent_invalid", expireIntent: true };
  }
  if (Date.parse(intent.expiresAt) < Date.now()) {
    return { ok: false, code: "AUTH_ERROR", detail: "intent_expired", expireIntent: true };
  }
  if (!intent.pkceVerifier) {
    return { ok: false, code: "AUTH_ERROR", detail: "pkce_missing", expireIntent: true };
  }

  const claim = await claimProviderAttempt(intent.id);
  if (!claim.ok || claim.claimed !== true) {
    return { ok: false, code: "UNAVAILABLE", detail: "claim_not_owned", expireIntent: false };
  }

  const bundle = createProviderAuthClient();
  if (!bundle) return { ok: false, code: "UNAVAILABLE", expireIntent: false };
  seedPkceVerifier(bundle, intent.pkceVerifier);

  let exchange: Awaited<ReturnType<typeof bundle.client.auth.exchangeCodeForSession>>;
  try {
    exchange = await bundle.client.auth.exchangeCodeForSession(input.code);
  } catch {
    // The provider may have consumed the code. Keep the claimed attempt/cookie.
    return { ok: false, code: "UNAVAILABLE", detail: "exchange_failed", expireIntent: false };
  }
  const { data, error } = exchange;
  if (error || !data.session) {
    const { classifyProviderAuthFailure } = await import("@/lib/auth/provider-transport");
    const status = error?.status ?? 0;
    const rejected = Boolean(error && !data.session
      && classifyProviderAuthFailure(error) === "confirmed_reject"
      && ((status >= 400 && status < 500) || error.code === "pkce_code_verifier_not_found"));
    // Authorize a new gesture only after a confirmed rejection is durable.
    // CAS excludes captures/cleanup or another lineage; zero rows are UNKNOWN.
    let journaled = false;
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin");
      const admin = createAdminClient();
      if (admin) {
        const { data: rows, error: journalError } = await admin.from("vel_broker_auth_intents" as never)
          .update({ status: rejected ? "rejected" : "reserved", provider_state: rejected ? "rejected" : "unknown",
            cleanup_state: rejected ? "not_needed" : "unknown", updated_at: new Date().toISOString() } as never)
          .eq("id", intent.id as never).eq("browser_lineage_id", lineageCtx.browserLineageId as never)
          .eq("status", "reserved" as never).eq("provider_state", "in_flight" as never).select("id");
        journaled = !journalError && Array.isArray(rows) && rows.length === 1;
      }
    } catch { /* An uncertain journal never authorizes provider replay. */ }
    if (!rejected || !journaled) return { ok: false, code: "UNAVAILABLE", detail: "exchange_failed", expireIntent: false };
    const detail =
      error?.code === "pkce_code_verifier_not_found" ? "verification_browser" : "exchange_failed";
    return { ok: false, code: "AUTH_ERROR", detail, expireIntent: true };
  }

  try {
    const admitted = await admitCapturedSession({
      session: data.session,
      writer: input.writer,
      intentId: intent.id,
      browserLineageId: intent.browserLineageId ?? lineageCtx.browserLineageId,
      admissionScope: "app",
    });
    expireIntentCookie(input.writer, input.stateNonce);
    if (!admitted.ok) {
      await signOutProviderSessionAfterAdmitFailure(bundle, data.session, {
        intentId: intent.id,
        operationKey: intent.id,
      });
      return {
        ok: false,
        code: admitted.code === "ADMISSION_BLOCKED" ? "ADMISSION_BLOCKED" : "UNAVAILABLE",
        expireIntent: false,
      };
    }
    return { ok: true, generation: admitted.generation };
  } catch {
    await signOutProviderSessionAfterAdmitFailure(bundle, data.session, {
      intentId: intent.id,
      operationKey: intent.id,
    });
    return { ok: false, code: "UNAVAILABLE", expireIntent: false };
  }
}
