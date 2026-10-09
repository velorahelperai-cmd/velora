/**
 * Embedded Signup v4 contract (Meta JS SDK + config_id + response_type=code).
 * Browser IDs are selectors; embedded-signup-actions verifies them server-side.
 * Actual readiness is checked by getEmbeddedSignupSetup against the durable RPC/Vault.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation
 */

export type EmbeddedSignupStatus =
  | "disabled"
  | "needs_setup"
  | "in_progress"
  | "cancelled"
  | "failed"
  | "code_received";

export type EmbeddedSignupAttempt = {
  id: string;
  companyId: string;
  userId: string;
  nonce: string;
  keepOnPhone: boolean;
  status: EmbeddedSignupStatus;
  createdAt: string;
  consumedAt: string | null;
  sessionId?: string;
  expiresAt?: string;
};

function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

/** Default off. Do not set in this package. */
export function embeddedSignupEnabled() {
  return env("WHATSAPP_EMBEDDED_SIGNUP") === "true"
    && Boolean(env("WHATSAPP_EMBEDDED_SIGNUP_APP_ID"))
    && Boolean(env("WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID"))
    && /^v\d+\.0$/.test(env("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION"))
    && Boolean(env("WHATSAPP_APP_SECRET"))
    && Boolean(env("WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN"));
}

export function embeddedSignupClientConfig() {
  if (!embeddedSignupEnabled()) {
    return { ok: false as const, code: "NEEDS_SETUP" as const };
  }
  return {
    ok: true as const,
    appId: env("WHATSAPP_EMBEDDED_SIGNUP_APP_ID"),
    configId: env("WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID"),
    graphVersion: env("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION"),
  };
}

export function createEmbeddedSignupAttempt(input: {
  companyId: string;
  userId: string;
  sessionId?: string;
  keepOnPhone: boolean;
  now?: string;
}): { ok: true; attempt: EmbeddedSignupAttempt } | { ok: false; code: "NEEDS_SETUP" | "INVALID_INPUT" } {
  if (!embeddedSignupEnabled()) return { ok: false, code: "NEEDS_SETUP" };
  const companyId = input.companyId.trim();
  const userId = input.userId.trim();
  if (!companyId || !userId || !input.sessionId) return { ok: false, code: "INVALID_INPUT" };
  const createdAt = input.now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) return { ok: false, code: "INVALID_INPUT" };
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2,"0")).join("");
  return {
    ok: true,
    attempt: {
      id: crypto.randomUUID(),
      companyId,
      userId,
      nonce,
      keepOnPhone: Boolean(input.keepOnPhone),
      status: "in_progress",
      createdAt,
      consumedAt: null,
      sessionId: input.sessionId,
      expiresAt: new Date(Date.parse(createdAt)+600_000).toISOString(),
    },
  };
}

export function applyEmbeddedSignupWindowEvent(input: {
  attempt: EmbeddedSignupAttempt;
  actorUserId: string;
  companyId: string;
  event: "CANCEL" | "FINISH" | "ERROR" | "CODE";
  phoneNumberId?: string;
  wabaId?: string;
  code?: string;
}):
  | { ok: false; code: "FORBIDDEN" | "CONSUMED" | "NEEDS_SETUP" | "CANCELLED" | "FAILED"; attempt?: EmbeddedSignupAttempt }
  | { ok: true; status: EmbeddedSignupStatus; verified: false; attempt: EmbeddedSignupAttempt } {
  if (input.attempt.consumedAt) return { ok: false, code: "CONSUMED" };
  if (input.attempt.userId !== input.actorUserId || input.attempt.companyId !== input.companyId) {
    return { ok: false, code: "FORBIDDEN" };
  }
  if (input.event === "CANCEL") {
    return { ok: false, code: "CANCELLED", attempt: { ...input.attempt, status: "cancelled", consumedAt: input.attempt.createdAt } };
  }
  if (input.event === "ERROR") {
    return { ok: false, code: "FAILED", attempt: { ...input.attempt, status: "failed", consumedAt: input.attempt.createdAt } };
  }
  // Browser phone/waba/code are evidence to resume — never mark the link verified here.
  void input.phoneNumberId;
  void input.wabaId;
  void input.code;
  const status: EmbeddedSignupStatus = input.event === "CODE" ? "code_received" : "in_progress";
  return {
    ok: true,
    status,
    verified: false,
    attempt: {
      ...input.attempt,
      status,
      consumedAt: input.event === "CODE" ? input.attempt.createdAt : null,
    },
  };
}
