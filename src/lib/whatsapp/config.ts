function env(name: string) {
  return process.env[name]?.trim() ?? "";
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
  return Boolean(config.appSecret && config.phoneNumberId && config.companyId);
}

export function sendReady(config: ReturnType<typeof whatsappConfig>) {
  return Boolean(config.accessToken && config.phoneNumberId);
}

/** Explicit host flag. Keep unset during local development so Graph is never called. */
export function externalSendAllowed() {
  return env("WHATSAPP_ALLOW_EXTERNAL_SEND") === "true";
}
