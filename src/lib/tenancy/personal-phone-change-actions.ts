"use server";
import { createClient, createBrokerBoundClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkAppSession } from "@/lib/auth/session-guard";
import { masterJourneyEnabled } from "@/lib/master-journey/rollout";
import { personalPhoneSmsRuntimeConfigured } from "./personal-phone-hook-config";
import { personalPhoneReceipt, personalPhoneUuid, type PersonalPhoneResult } from "./personal-phone";
import {
  beginPersonalPhoneChange,
  resendCurrentPhone,
  sendReplacementPhone,
  verifyPhoneChangeStep,
  type PersonalPhoneChangePort,
  type PersonalPhoneChangeStatus,
} from "./personal-phone-change";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { listActiveSessionsForUser, markSessionStatus } from "@/lib/auth/broker/registry";
import { expireHandleCookie } from "@/lib/auth/broker/cookies";
import { syncBrokerAfterAuthMutation } from "@/lib/auth/broker";
import { brokerLog } from "@/lib/auth/broker/log";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;

function responseSessionId(token: unknown): string | undefined {
  if (typeof token !== "string" || token.length > 20000) return;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return personalPhoneUuid(payload.session_id) ? payload.session_id : undefined;
  } catch {
    return;
  }
}

async function revokeOtherBrokerSessions(
  userId: string,
  keepNativeSessionId: string,
  bound: Awaited<ReturnType<typeof createBrokerBoundClient>>,
): Promise<boolean> {
  const env = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!env.ok || !serviceKey) return false;
  const adminAuth = createPlainClient(env.url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const inventory = await listActiveSessionsForUser(userId);
  if (!inventory.ok) {
    brokerLog("warn", "auth.broker.phone.revoke_others", {
      user_id: userId,
      error_code: inventory.code,
    });
    return false;
  }
  let allOk = true;
  for (const target of inventory.sessions) {
    if (target.nativeSessionId === keepNativeSessionId) continue;
    try {
      const { error } = await adminAuth.auth.admin.signOut(target.accessToken, "local");
      if (error) {
        allOk = false;
        await markSessionStatus(target.id, "quarantined");
        continue;
      }
      await markSessionStatus(target.id, "revoked");
      if (bound.bound.ok) {
        expireHandleCookie(bound.writer, target.cookieName);
      }
    } catch {
      allOk = false;
    }
  }
  if (inventory.legacyCoverage === "pending") allOk = false;
  brokerLog(allOk ? "info" : "warn", "auth.broker.phone.revoke_others", {
    user_id: userId,
    error_code: allOk ? undefined : "PHONE_REVOKE_OTHERS_PARTIAL",
  });
  return allOk;
}

async function port(expectedUserId: string): Promise<PersonalPhoneChangePort> {
  const bound = await createBrokerBoundClient();
  const client = bound.bound.ok ? bound.bound.client : await createClient();
  const rpc = client.rpc as unknown as Rpc;
  return {
    configured: personalPhoneSmsRuntimeConfigured(),
    currentUser: async () => {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return { ok: false, code: "UNAUTHENTICATED" };
      const valid = await checkAppSession(client);
      return valid.ok
        ? { ok: true, data: { userId: data.user.id, emailVerified: Boolean(data.user.email_confirmed_at) } }
        : { ok: false, code: valid.code };
    },
    rpc: async (name, args) => {
      const { data, error } = await rpc.call(client, name, args);
      return error ? { ok: false, code: "UNAVAILABLE" } : personalPhoneReceipt(data);
    },
    serviceRpc: async (name, args) => {
      const admin = createAdminClient();
      if (!admin) return { ok: false, code: "UNCONFIGURED" };
      const { data, error } = await (admin.rpc as unknown as Rpc).call(admin, name, args);
      return error ? { ok: false, code: "UNAVAILABLE" } : personalPhoneReceipt(data);
    },
    sendOld: async (phone) => ({
      ok: !(await client.auth.signInWithOtp({ phone, options: { shouldCreateUser: false, channel: "sms" } })).error,
    }),
    updatePhone: async (phone) => {
      // Fence before provider phone mutation (C4-04).
      let leaseToken: string | null = null;
      if (bound.bound.ok) {
        const { beginAuthMutationFence, abandonAuthMutationFence } = await import("@/lib/auth/broker");
        const fence = await beginAuthMutationFence(bound.bound.resolve);
        if (!fence.ok) return { ok: false };
        leaseToken = fence.leaseToken;
        try {
          const { error } = await client.auth.updateUser({ phone });
          if (error) {
            await abandonAuthMutationFence(bound.bound.resolve, leaseToken, "uncertain");
            return { ok: false };
          }
          await abandonAuthMutationFence(bound.bound.resolve, leaseToken, "release");
          return { ok: true };
        } catch {
          await abandonAuthMutationFence(bound.bound.resolve, leaseToken, "uncertain");
          return { ok: false };
        }
      }
      return { ok: !(await client.auth.updateUser({ phone })).error };
    },
    verify: async (phone, code, type) => {
      // Lease + bound intent BEFORE provider OTP effect (C3-5/C5-R4).
      let leaseToken: string | null = null;
      let boundIntentId: string | null = null;
      let bootstrapHash: string | null = null;
      if (bound.bound.ok) {
        const { beginAuthMutationFence, reserveBoundMutationIntent } = await import("@/lib/auth/broker");
        const fence = await beginAuthMutationFence(bound.bound.resolve);
        if (!fence.ok) return { ok: false };
        leaseToken = fence.leaseToken;
        const reserved = await reserveBoundMutationIntent({
          reader: bound.reader,
          purpose: "phone_change_verify",
        });
        if (!reserved.ok) {
          const { abandonAuthMutationFence } = await import("@/lib/auth/broker");
          await abandonAuthMutationFence(bound.bound.resolve, leaseToken, "release");
          return { ok: false };
        }
        boundIntentId = reserved.intentId;
        bootstrapHash = reserved.bootstrapHash;
      }
      type VerifySession = { access_token?: string; refresh_token?: string; user?: { id: string } } | null;
      let data: { user?: { id: string; phone?: string } | null; session?: VerifySession } | null = null;
      let error: unknown = null;
      try {
        const result = await client.auth.verifyOtp({ phone, token: code, type });
        data = result.data;
        error = result.error;
      } catch {
        if (bound.bound.ok && leaseToken) {
          const { abandonAuthMutationFence } = await import("@/lib/auth/broker");
          await abandonAuthMutationFence(bound.bound.resolve, leaseToken, "uncertain");
        }
        return { ok: false };
      }
      if (data?.user && data.user.id !== expectedUserId) {
        if (bound.bound.ok && leaseToken) {
          const { abandonAuthMutationFence, brokerExpireCapturedHandle } = await import("@/lib/auth/broker");
          await abandonAuthMutationFence(bound.bound.resolve, leaseToken, "release");
          await brokerExpireCapturedHandle(
            bound.bound.resolve,
            bound.writer,
            bound.bound.resolve.boundary.boundaryFingerprint,
          );
        }
        return { ok: true, userId: data.user.id };
      }
      const session = data?.session ?? null;
      if (bound.bound.ok && session?.access_token && session.refresh_token) {
        const synced = await syncBrokerAfterAuthMutation({
          previous: bound.bound.resolve,
          session: session as never,
          writer: bound.writer,
          reader: bound.reader,
          leaseToken,
          boundIntentId,
          bootstrapHash,
        });
        if (!synced.ok) {
          if (leaseToken) {
            const { abandonAuthMutationFence } = await import("@/lib/auth/broker");
            await abandonAuthMutationFence(bound.bound.resolve, leaseToken, "uncertain");
          }
          brokerLog("warn", "auth.broker.phone.sync_failed", {
            error_code: synced.code,
            user_id: expectedUserId,
          });
          return { ok: false };
        }
      } else if (bound.bound.ok && leaseToken) {
        const { abandonAuthMutationFence } = await import("@/lib/auth/broker");
        await abandonAuthMutationFence(bound.bound.resolve, leaseToken, error ? "uncertain" : "release");
      }
      // This session ID is parsed ONLY from the trusted native verifyOtp response,
      // never an action argument, browser token or generic OTP AMR assertion.
      const accessToken = session?.access_token;
      return {
        ok: !error && Boolean(data?.user && session),
        userId: data?.user?.id,
        phone: data?.user?.phone,
        sessionId: responseSessionId(accessToken),
      };
    },
    revokeOthers: async () => {
      if (!bound.bound.ok) return { ok: false };
      return {
        ok: await revokeOtherBrokerSessions(
          expectedUserId,
          bound.bound.resolve.boundary.nativeSessionId,
          bound,
        ),
      };
    },
    reconcileNativeNew: async () => {
      const { data, error } = await client.auth.getClaims();
      if (error || data?.claims.sub !== expectedUserId || !personalPhoneUuid(data?.claims.session_id)) {
        return { ok: false, code: "UNAUTHENTICATED" };
      }
      const admin = createAdminClient();
      if (!admin) return { ok: false, code: "UNCONFIGURED" };
      const result = await (admin.rpc as unknown as Rpc).call(admin, "master_reconcile_phone_change_native", {
        p_user_id: expectedUserId,
        p_verified_session_id: data.claims.session_id,
      });
      return result.error ? { ok: false, code: "UNAVAILABLE" } : personalPhoneReceipt(result.data);
    },
  };
}

export async function beginPersonalPhoneChangeAction(input: {
  expectedUserId: string;
  newPhone: string;
  requestKey: string;
}): Promise<PersonalPhoneResult> {
  if (!masterJourneyEnabled() || !personalPhoneSmsRuntimeConfigured()) return { ok: false, code: "UNCONFIGURED" };
  try {
    return await beginPersonalPhoneChange(await port(input.expectedUserId), input);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function sendReplacementPhoneAction(input: {
  expectedUserId: string;
  changeId: string;
  requestKey: string;
}): Promise<PersonalPhoneResult> {
  if (!masterJourneyEnabled() || !personalPhoneSmsRuntimeConfigured()) return { ok: false, code: "UNCONFIGURED" };
  try {
    return await sendReplacementPhone(await port(input.expectedUserId), input);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function resendCurrentPhoneAction(input: {
  expectedUserId: string;
  changeId: string;
  requestKey: string;
}): Promise<PersonalPhoneResult> {
  if (!masterJourneyEnabled() || !personalPhoneSmsRuntimeConfigured()) return { ok: false, code: "UNCONFIGURED" };
  try {
    return await resendCurrentPhone(await port(input.expectedUserId), input);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function verifyPhoneChangeStepAction(input: {
  expectedUserId: string;
  intentId: string;
  code: string;
}): Promise<PersonalPhoneResult> {
  if (!masterJourneyEnabled() || !personalPhoneSmsRuntimeConfigured()) return { ok: false, code: "UNCONFIGURED" };
  try {
    return await verifyPhoneChangeStep(await port(input.expectedUserId), input);
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function readPersonalPhoneChangeStatus(
  expectedUserId: string,
): Promise<PersonalPhoneResult<PersonalPhoneChangeStatus>> {
  if (!masterJourneyEnabled()) return { ok: false, code: "UNCONFIGURED" };
  if (!personalPhoneUuid(expectedUserId)) return { ok: false, code: "INVALID_INPUT" };
  try {
    const p = await port(expectedUserId);
    const who = await p.currentUser();
    if (!who.ok) return who;
    if (who.data.userId !== expectedUserId) return { ok: false, code: "UNAUTHENTICATED" };
    // Status read may reconcile; revokeOthers remains broker-targeted (not SDK others).
    if (p.configured && p.reconcileNativeNew) {
      const finished = await p.reconcileNativeNew();
      if (!finished.ok) return finished;
      if (finished.data.step === "complete") await p.revokeOthers();
    }
    const r = await p.rpc("master_phone_change_status", {});
    if (!r.ok) return r;
    const d = r.data as unknown as PersonalPhoneChangeStatus;
    if (d.userId !== expectedUserId || !["CONFIGURED", "UNCONFIGURED"].includes(d.configuration)) {
      return { ok: false, code: "UNAVAILABLE" };
    }
    if (d.change !== null) {
      const c = d.change;
      if (
        !c
        || !personalPhoneUuid(c.id)
        || !["old_pending", "old_verified", "new_pending", "complete", "expired"].includes(c.step)
        || typeof c.oldPhoneMasked !== "string"
        || typeof c.newPhoneMasked !== "string"
        || !Number.isFinite(Date.parse(c.expiresAt))
        || (c.intent !== null
          && (!c.intent
            || !personalPhoneUuid(c.intent.id)
            || !["reserved", "sent", "verifying", "verified", "failed", "expired"].includes(c.intent.state)
            || !Number.isFinite(Date.parse(c.intent.expiresAt))
            || !Number.isFinite(Date.parse(c.intent.resendAt))))
      ) {
        return { ok: false, code: "UNAVAILABLE" };
      }
    }
    return {
      ok: true,
      data: {
        ...d,
        configuration: p.configured && d.configuration === "CONFIGURED" ? "CONFIGURED" : "UNCONFIGURED",
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
