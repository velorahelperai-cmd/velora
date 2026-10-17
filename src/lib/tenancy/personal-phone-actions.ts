"use server";
import { createClient } from "@/lib/supabase/server";
import { checkAppSession } from "@/lib/auth/session-guard";
import {masterJourneyEnabled} from "@/lib/master-journey/rollout";
import { personalPhoneSmsRuntimeConfigured } from "./personal-phone-hook-config";
import { enrollPersonalPhone, verifyPersonalPhone, personalPhoneReceipt, personalPhoneUuid, type PersonalPhonePort, type PersonalPhoneResult, type PersonalPhoneStatus } from "./personal-phone";

async function phonePort(): Promise<PersonalPhonePort> {
  const client = await createClient();
  const rpc = client.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  return {
    configured: personalPhoneSmsRuntimeConfigured(),
    currentUser: async () => {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return { ok: false, code: error && error.name !== "AuthSessionMissingError" ? "UNAVAILABLE" : "UNAUTHENTICATED" };
      const guard = await checkAppSession(client);
      return guard.ok ? { ok: true, data: { userId: data.user.id, emailVerified: Boolean(data.user.email_confirmed_at) } } : { ok: false, code: guard.code };
    },
    rpc: async (name, args) => {
      const { data, error } = await rpc.call(client, name, args);
      return error ? { ok: false, code: "UNAVAILABLE" } : personalPhoneReceipt(data);
    },
    // Fail closed: raw Auth phone mutation without bound broker fence is unavailable (C5-R4).
    // Use personal-phone-change-actions (lease + reserveBoundMutationIntent + sync).
    updatePhone: async (_phone) => ({ ok: false }),
    verifyPhone: async (_phone, _code) => ({ ok: false }),
  };
}

export async function getPersonalPhoneStatus(expectedUserId?: string): Promise<PersonalPhoneResult<PersonalPhoneStatus>> {
  if(!masterJourneyEnabled())return {ok:false,code:"UNCONFIGURED"};
  if (expectedUserId !== undefined && !personalPhoneUuid(expectedUserId)) return { ok: false, code: "INVALID_INPUT" };
  try {
    const port = await phonePort();
    const actor = await port.currentUser(); if (!actor.ok) return actor;
    if (expectedUserId !== undefined && actor.data.userId !== expectedUserId) return { ok: false, code: "UNAUTHENTICATED" };
    if (!actor.data.emailVerified) return { ok: false, code: "EMAIL_REQUIRED" };
    const receipt = await port.rpc("master_personal_phone_status", {}); if (!receipt.ok) return receipt;
    const row = receipt.data;
    if (row.userId !== actor.data.userId || typeof row.emailVerified !== "boolean" || typeof row.phoneVerified !== "boolean"
      || !(row.phoneMasked === null || typeof row.phoneMasked === "string") || !["CONFIGURED", "UNCONFIGURED"].includes(String(row.configuration))) return { ok: false, code: "UNAVAILABLE" };
    let intent: PersonalPhoneStatus["intent"] = null;
    if (row.intent !== null) {
      if (!row.intent || typeof row.intent !== "object") return { ok: false, code: "UNAVAILABLE" };
      const i = row.intent as Record<string, unknown>;
      if (!personalPhoneUuid(i.id) || typeof i.phoneMasked !== "string" || typeof i.expiresAt !== "string" || !Number.isFinite(Date.parse(i.expiresAt))
        || typeof i.resendAt !== "string" || !Number.isFinite(Date.parse(i.resendAt)) || !["reserved", "sent", "verifying", "verified", "failed", "expired"].includes(String(i.state))) return { ok: false, code: "UNAVAILABLE" };
      intent = { id: i.id, phoneMasked: i.phoneMasked, state: String(i.state), expiresAt: i.expiresAt, resendAt: i.resendAt };
    }
    return { ok: true, data: { userId: actor.data.userId, emailVerified: row.emailVerified, phoneVerified: row.phoneVerified,
      phoneMasked: row.phoneMasked, configuration: port.configured && row.configuration === "CONFIGURED" ? "CONFIGURED" : "UNCONFIGURED", intent } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

export async function sendPersonalPhoneCode(input: { expectedUserId: string; phone: string; requestKey: string }): Promise<PersonalPhoneResult> {
  if (!masterJourneyEnabled()||!personalPhoneSmsRuntimeConfigured()) return { ok: false, code: "UNCONFIGURED" };
  try { return await enrollPersonalPhone(await phonePort(), input); } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
export async function verifyPersonalPhoneCode(input: { expectedUserId: string; intentId: string; code: string }): Promise<PersonalPhoneResult> {
  if (!masterJourneyEnabled()||!personalPhoneSmsRuntimeConfigured()) return { ok: false, code: "UNCONFIGURED" };
  try { return await verifyPersonalPhone(await phonePort(), input); } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
