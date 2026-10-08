function env(name: string) {
  return process.env[name]?.trim() ?? "";
}

/**
 * Routing modes are explicit and never mixed.
 * - tenant_registry: company from the exact signed WABA + phone registry only.
 *   Resolver failure does not fall back to env company/phone.
 * - single_tenant (default): env WHATSAPP_COMPANY_ID + PHONE_NUMBER_ID only.
 * New live multi-tenant receive/send stays off until WHATSAPP_ROUTING_MODE=tenant_registry.
 */
export type WhatsappRoutingMode = "single_tenant" | "tenant_registry";

export function whatsappRoutingMode(): WhatsappRoutingMode {
  return env("WHATSAPP_ROUTING_MODE") === "tenant_registry" ? "tenant_registry" : "single_tenant";
}

/** Explicit server version shared with Embedded Signup. No automatic upgrades. */
export function metaGraphVersion(): string | null {
  const version = env("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION");
  return /^v[1-9]\d{0,2}\.0$/.test(version) ? version : null;
}

/** Prefer the real-number names; keep TEST_* as fallback for the current local file. */
export function whatsappConfig() {
  return {
    verifyToken: env("WHATSAPP_VERIFY_TOKEN"),
    appSecret: env("WHATSAPP_APP_SECRET"),
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID") || env("WHATSAPP_TEST_PHONE_NUMBER_ID"),
    companyId: env("WHATSAPP_COMPANY_ID") || env("WHATSAPP_TEST_COMPANY_ID"),
    accessToken: env("WHATSAPP_ACCESS_TOKEN"),
  };
}

export function webhookReady(config: ReturnType<typeof whatsappConfig>) {
  if (whatsappRoutingMode() === "tenant_registry") {
    return Boolean(config.appSecret);
  }
  return Boolean(config.appSecret && config.phoneNumberId && config.companyId);
}

/**
 * Honest single-tenant test reception status from server env only.
 * Presence flags — never values. Not Meta verification proof.
 */
export type SingleTenantReceptionStatus = {
  mode: WhatsappRoutingMode;
  receiveConfigured: boolean;
  hasAppSecret: boolean;
  hasVerifyToken: boolean;
  hasPhoneNumberId: boolean;
  hasCompanyId: boolean;
  externalSendAllowed: boolean;
};

export function singleTenantReceptionStatus(): SingleTenantReceptionStatus {
  const config = whatsappConfig();
  const mode = whatsappRoutingMode();
  return {
    mode,
    receiveConfigured: webhookReady(config),
    hasAppSecret: Boolean(config.appSecret),
    hasVerifyToken: Boolean(config.verifyToken),
    hasPhoneNumberId: Boolean(config.phoneNumberId),
    hasCompanyId: Boolean(config.companyId),
    externalSendAllowed: env("WHATSAPP_ALLOW_EXTERNAL_SEND") === "true",
  };
}

/**
 * Integration-ready, not live: Graph receive/send stays off until mode + secrets + apply.
 */
export function whatsappLiveOpsReady(): boolean {
  return false;
}

export function sendReady(config: ReturnType<typeof whatsappConfig>) {
  return Boolean(config.accessToken && config.phoneNumberId);
}

/** Explicit host flag. Keep unset during local development so Graph is never called. */
export function externalSendAllowed() {
  return env("WHATSAPP_ALLOW_EXTERNAL_SEND") === "true";
}
