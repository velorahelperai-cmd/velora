export function whatsappConfig() {
  return {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() ?? "",
    phoneNumberId: process.env.WHATSAPP_TEST_PHONE_NUMBER_ID?.trim() ?? "",
    companyId: process.env.WHATSAPP_TEST_COMPANY_ID?.trim() ?? "",
  };
}

export function webhookReady(config: ReturnType<typeof whatsappConfig>) {
  return Boolean(config.appSecret && config.phoneNumberId && config.companyId);
}
