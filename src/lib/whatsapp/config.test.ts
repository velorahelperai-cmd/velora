import { afterEach, describe, expect, it, vi } from "vitest";
import { singleTenantReceptionStatus, webhookReady, whatsappConfig, whatsappRoutingMode } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("single_tenant reception config", () => {
  it("defaults to single_tenant and reports receiveConfigured from presence only", () => {
    vi.stubEnv("WHATSAPP_ROUTING_MODE", "");
    vi.stubEnv("WHATSAPP_APP_SECRET", "secret");
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "12345");
    vi.stubEnv("WHATSAPP_COMPANY_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "");

    expect(whatsappRoutingMode()).toBe("single_tenant");
    const status = singleTenantReceptionStatus();
    expect(status.mode).toBe("single_tenant");
    expect(status.receiveConfigured).toBe(true);
    expect(status.externalSendAllowed).toBe(false);
    expect(webhookReady(whatsappConfig())).toBe(true);
  });

  it("is not receiveConfigured without company or phone id", () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "secret");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "");
    vi.stubEnv("WHATSAPP_TEST_PHONE_NUMBER_ID", "");
    vi.stubEnv("WHATSAPP_COMPANY_ID", "");
    vi.stubEnv("WHATSAPP_TEST_COMPANY_ID", "");
    expect(singleTenantReceptionStatus().receiveConfigured).toBe(false);
  });
});
