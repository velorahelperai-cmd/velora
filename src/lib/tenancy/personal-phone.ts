export type PersonalPhoneCode = "UNAUTHENTICATED" | "EMAIL_REQUIRED" | "UNCONFIGURED" | "INVALID_INPUT" | "PHONE_IN_USE" | "REVIEW_REQUIRED" | "COOLDOWN" | "RATE_LIMITED" | "EXPIRED" | "BUSY" | "ATTEMPTS_EXHAUSTED" | "CODE_INVALID" | "VERIFICATION_INCOMPLETE" | "UNAVAILABLE";
export type PersonalPhoneResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; code: PersonalPhoneCode };
export type PersonalPhonePort = {
  configured: boolean;
  currentUser: () => Promise<PersonalPhoneResult<{ userId: string; emailVerified: boolean }>>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<PersonalPhoneResult>;
  updatePhone: (phone: string) => Promise<{ ok: boolean }>;
  verifyPhone: (phone: string, code: string) => Promise<{ ok: boolean; userId?: string }>;
};
export type PersonalPhoneStatus = {
  userId: string; emailVerified: boolean; phoneVerified: boolean; phoneMasked: string | null;
  configuration: "UNCONFIGURED" | "CONFIGURED";
  intent: { id: string; phoneMasked: string; state: string; expiresAt: string; resendAt: string } | null;
};
export const personalPhoneUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function normalizePersonalPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const phone = value.replace(/[ -]/g, "");
  return /^\+[1-9][0-9]{6,14}$/.test(phone) ? phone : null;
}
const codes: PersonalPhoneCode[] = ["UNAUTHENTICATED", "EMAIL_REQUIRED", "UNCONFIGURED", "INVALID_INPUT", "PHONE_IN_USE", "REVIEW_REQUIRED", "COOLDOWN", "RATE_LIMITED", "EXPIRED", "BUSY", "ATTEMPTS_EXHAUSTED", "CODE_INVALID", "VERIFICATION_INCOMPLETE", "UNAVAILABLE"];
/** Only application codes cross this boundary; provider errors, OTPs and tokens never do. */
export function personalPhoneReceipt(value: unknown): PersonalPhoneResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "UNAVAILABLE" };
  const row = value as { ok?: unknown; data?: unknown; code?: unknown };
  if (row.ok === true && row.data && typeof row.data === "object" && !Array.isArray(row.data)) return { ok: true, data: row.data as Record<string, unknown> };
  return { ok: false, code: codes.includes(row.code as PersonalPhoneCode) ? row.code as PersonalPhoneCode : "UNAVAILABLE" };
}
async function bound(port: PersonalPhonePort, userId: string) {
  const actor = await port.currentUser();
  if (!actor.ok) return actor;
  if (actor.data.userId !== userId) return { ok: false as const, code: "UNAUTHENTICATED" as const };
  if (!actor.data.emailVerified) return { ok: false as const, code: "EMAIL_REQUIRED" as const };
  return actor;
}
export async function enrollPersonalPhone(port: PersonalPhonePort, input: { expectedUserId: string; phone: string; requestKey: string }): Promise<PersonalPhoneResult> {
  const phone = normalizePersonalPhone(input?.phone);
  if (!phone || !personalPhoneUuid(input?.expectedUserId) || !personalPhoneUuid(input?.requestKey)) return { ok: false, code: "INVALID_INPUT" };
  if (!port.configured) return { ok: false, code: "UNCONFIGURED" };
  try {
    const actor = await bound(port, input.expectedUserId); if (!actor.ok) return actor;
    const reserved = await port.rpc("master_reserve_personal_phone", { p_expected_user_id: input.expectedUserId, p_phone: phone, p_request_key: input.requestKey });
    if (!reserved.ok || reserved.data.executeProvider === false) return reserved;
    if (reserved.data.executeProvider !== true || !personalPhoneUuid(reserved.data.intentId) || reserved.data.phone !== phone) return { ok: false, code: "UNAVAILABLE" };
    const current = await bound(port, input.expectedUserId); if (!current.ok) return current;
    let sent = false;
    try { sent = (await port.updatePhone(phone)).ok; } catch { /* Unknown send: never automatically replay. */ }
    const receipt = await port.rpc("master_personal_phone_send_result", { p_expected_user_id: input.expectedUserId, p_intent_id: reserved.data.intentId, p_sent: sent });
    return sent ? receipt : { ok: false, code: "UNAVAILABLE" };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
export async function verifyPersonalPhone(port: PersonalPhonePort, input: { expectedUserId: string; intentId: string; code: string }): Promise<PersonalPhoneResult> {
  if (!personalPhoneUuid(input?.expectedUserId) || !personalPhoneUuid(input?.intentId) || typeof input?.code !== "string" || !/^[0-9]{6}$/.test(input.code)) return { ok: false, code: "INVALID_INPUT" };
  if (!port.configured) return { ok: false, code: "UNCONFIGURED" };
  try {
    const actor = await bound(port, input.expectedUserId); if (!actor.ok) return actor;
    const claimed = await port.rpc("master_claim_personal_phone_verify", { p_expected_user_id: input.expectedUserId, p_intent_id: input.intentId });
    if (!claimed.ok || claimed.data.verified === true) return claimed;
    const phone = normalizePersonalPhone(claimed.data.phone);
    if (!phone || !personalPhoneUuid(claimed.data.leaseId) || claimed.data.intentId !== input.intentId) return { ok: false, code: "UNAVAILABLE" };
    const current = await bound(port, input.expectedUserId); if (!current.ok) return current;
    let verified = false;
    try {
      const proof = await port.verifyPhone(phone, input.code);
      if (proof.ok && proof.userId !== input.expectedUserId) return { ok: false, code: "UNAUTHENTICATED" };
      verified = proof.ok;
    } catch { /* Finalization may recover a committed Auth response; it never retries OTP. */ }
    return await port.rpc("master_finish_personal_phone_verify", { p_expected_user_id: input.expectedUserId, p_intent_id: input.intentId, p_lease_id: claimed.data.leaseId, p_verified: verified });
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
