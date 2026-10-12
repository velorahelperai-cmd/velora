import type { SignupAttempt } from "./browser";

export type PublicCoexistenceClientConfig = Readonly<{ appId: string; configId: string; graphVersion: string }>;
export type CoexistenceCompletionInput = Readonly<{
  attemptId: string; nonce: string; code: string; wabaId: string;
  phoneNumberId?: string; confirmedPhoneNumber: string;
}>;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const numericId = (value: unknown): value is string => typeof value === "string" && /^[1-9]\d{0,31}$/.test(value);

/** Public SDK configuration only; never accept an app secret or access token. */
export function parsePublicCoexistenceConfig(input: unknown): PublicCoexistenceClientConfig | null {
  if (!record(input) || Object.keys(input).some(key => !["appId", "configId", "graphVersion"].includes(key))
    || !numericId(input.appId) || !numericId(input.configId)
    || typeof input.graphVersion !== "string" || !/^v[1-9]\d{0,2}\.\d{1,2}$/.test(input.graphVersion)) return null;
  return Object.freeze({ appId: input.appId, configId: input.configId, graphVersion: input.graphVersion });
}

/** Country code must be explicit. This is a user selection, not ownership proof. */
export function normalizeConfirmedCompanyPhone(input: string, confirmed: boolean): string | null {
  if (confirmed !== true || typeof input !== "string" || input.length > 64) return null;
  const text = input.trim();
  if (!/^\+[\d() -]+$/.test(text)) return null;
  const normalized = text.replace(/[() -]/g, "");
  return /^\+[1-9]\d{6,14}$/.test(normalized) ? normalized : null;
}

export function coexistenceCodeFromResponse(input: unknown): string | null {
  if (!record(input) || !record(input.authResponse)) return null;
  const code = input.authResponse.code;
  return typeof code === "string" && code.length > 0 && code.length <= 8192 && code.trim() ? code : null;
}

/** Do not turn generic Cloud API FINISH or incomplete signals into Coexistence requests. */
export function coexistenceCompletionInput(
  metadata: { attemptId: string; nonce: string; confirmedPhoneNumber: string },
  state: SignupAttempt,
): CoexistenceCompletionInput | null {
  const session = state.session;
  if (state.attemptId !== metadata.attemptId || state.status !== "ready-for-server-validation"
    || !state.code || !session || session.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
    || !["coexistence", "coexistence-v3-compat"].includes(session.contract)
    || !metadata.nonce || normalizeConfirmedCompanyPhone(metadata.confirmedPhoneNumber, true) !== metadata.confirmedPhoneNumber
    || !numericId(session.data.waba_id)) return null;
  const phoneNumberId = session.data.phone_number_id;
  if (phoneNumberId !== undefined && !numericId(phoneNumberId)) return null;
  return Object.freeze({
    attemptId: metadata.attemptId, nonce: metadata.nonce, code: state.code,
    wabaId: session.data.waba_id, confirmedPhoneNumber: metadata.confirmedPhoneNumber,
    ...(phoneNumberId !== undefined ? { phoneNumberId } : {}),
  });
}

/** Meta documents 30 seconds for the code. Leave a five-second transport margin. */
export function signupSignalDeadline(expiresAt: string, codeReceivedAt?: number): number | null {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= 0) return null;
  if (codeReceivedAt === undefined) return expires;
  if (!Number.isFinite(codeReceivedAt) || codeReceivedAt <= 0) return null;
  return Math.min(expires, codeReceivedAt + 25_000);
}
