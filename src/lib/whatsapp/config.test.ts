import { afterEach, describe, expect, it, vi } from "vitest";
import { externalSendAllowed, singleTenantReceptionStatus, webhookReady, whatsappConfig, whatsappRoutingMode } from "./config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("single_tenant reception config", () => {
  it("uses only official test-scoped IDs when explicit Meta test mode is selected", () => {
    vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "meta_test");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "live-phone-id");
    vi.stubEnv("WHATSAPP_TEST_PHONE_NUMBER_ID", "test-phone-id");
    vi.stubEnv("WHATSAPP_COMPANY_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("WHATSAPP_TEST_COMPANY_ID", "22222222-2222-4222-8222-222222222222");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "live-token");
    vi.stubEnv("WHATSAPP_TEST_ACCESS_TOKEN", "test-token");

    expect(whatsappConfig()).toMatchObject({
      phoneNumberId: "test-phone-id",
      companyId: "22222222-2222-4222-8222-222222222222",
      accessToken: "test-token",
    });
  });

  it("fails closed in Meta test mode when test IDs are absent instead of falling back to live IDs", () => {
    vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "meta_test");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "live-phone-id");
    vi.stubEnv("WHATSAPP_TEST_PHONE_NUMBER_ID", "");
    vi.stubEnv("WHATSAPP_COMPANY_ID", "11111111-1111-4111-8111-111111111111");
    vi.stubEnv("WHATSAPP_TEST_COMPANY_ID", "");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "live-token");
    vi.stubEnv("WHATSAPP_TEST_ACCESS_TOKEN", "");

    expect(whatsappConfig()).toMatchObject({ phoneNumberId: "", companyId: "", accessToken: "" });
    expect(singleTenantReceptionStatus().receiveConfigured).toBe(false);
  });

  it("keeps Meta test routing isolated and ignores the live send switch", () => {
    vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "meta_test");
    vi.stubEnv("WHATSAPP_ROUTING_MODE", "tenant_registry");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_TEST_ALLOW_EXTERNAL_SEND", "");

    expect(whatsappRoutingMode()).toBe("single_tenant");
    expect(externalSendAllowed()).toBe(false);
  });

  it("defaults to single_tenant and reports receiveConfigured from presence only", () => {
    vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "");
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
