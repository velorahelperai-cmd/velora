import { afterEach, describe, expect, it, vi } from "vitest";
import { whatsappConfig, whatsappRoutingMode } from "./config";
import { routeWebhookEvents, type InboundMessage } from "./webhook";

/** Pinned TAG CITY scope from Production branch ownership proof (not guessed). */
const TAG_CITY = {
  accountId: "177ef439-3fb0-4e3e-96b8-2a9e8661386d",
  companyId: "40d2d885-8b63-49c4-b3da-d2e9566f2750",
  branchId: "a268f9d8-fe5b-41b2-a337-97046a5eaa5c",
  staleDeletedCompanyId: "7c5e429d-2be3-4578-bf15-8db2fdb5647f",
  testPhoneNumberId: "1261345677073276",
  testWabaId: "2057350774985092",
} as const;

function inbound(partial: Partial<InboundMessage> = {}): InboundMessage {
  return {
    wabaId: TAG_CITY.testWabaId,
    phoneNumberId: TAG_CITY.testPhoneNumberId,
    customerWaId: "96876351423",
    customerName: "Synthetic",
    waMessageId: "wamid.tag-city-fixture",
    body: "synthetic inbound",
    messageType: "text",
    receivedAt: "2026-10-29T12:00:00.000Z",
    ...partial,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("TAG CITY Meta test routing contract", () => {
  it("binds meta_test config to TAG CITY company and Meta test phone, never the deleted company id", () => {
    vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "meta_test");
    vi.stubEnv("WHATSAPP_ROUTING_MODE", "tenant_registry");
    vi.stubEnv("WHATSAPP_TEST_COMPANY_ID", TAG_CITY.companyId);
    vi.stubEnv("WHATSAPP_TEST_PHONE_NUMBER_ID", TAG_CITY.testPhoneNumberId);
    vi.stubEnv("WHATSAPP_COMPANY_ID", TAG_CITY.staleDeletedCompanyId);
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "999999999999999");

    expect(whatsappRoutingMode()).toBe("single_tenant");
    expect(whatsappConfig()).toMatchObject({
      companyId: TAG_CITY.companyId,
      phoneNumberId: TAG_CITY.testPhoneNumberId,
    });
    expect(whatsappConfig().companyId).not.toBe(TAG_CITY.staleDeletedCompanyId);
  });

  it("persists matching phone events only to the env company and rejects foreign phone ids", async () => {
    const saved: Array<{ companyId: string; waMessageId: string }> = [];
    const result = await routeWebhookEvents({
      messages: [
        inbound({ waMessageId: "wamid.ok" }),
        inbound({ phoneNumberId: "000000000000000", waMessageId: "wamid.foreign-phone" }),
        inbound({ waMessageId: "wamid.ok-replay" }),
      ],
      statuses: [],
      mode: "single_tenant",
      envCompanyId: TAG_CITY.companyId,
      envPhoneNumberId: TAG_CITY.testPhoneNumberId,
      resolve: async () => {
        throw new Error("single_tenant must not resolve registry");
      },
      saveInbound: async (companyId, message) => {
        saved.push({ companyId, waMessageId: message.waMessageId });
      },
      saveStatus: async () => undefined,
    });

    expect(result.retry).toBe(false);
    expect(saved).toEqual([
      { companyId: TAG_CITY.companyId, waMessageId: "wamid.ok" },
      { companyId: TAG_CITY.companyId, waMessageId: "wamid.ok-replay" },
    ]);
    expect(result.dispositions).toEqual([
      expect.objectContaining({ result: "persisted", companyId: TAG_CITY.companyId, waMessageId: "wamid.ok" }),
      expect.objectContaining({ result: "rejected", code: "unknown_or_inactive", waMessageId: "wamid.foreign-phone" }),
      expect.objectContaining({ result: "persisted", companyId: TAG_CITY.companyId, waMessageId: "wamid.ok-replay" }),
    ]);
  });

  it("does not invent a second company when env still points at the stale deleted id", async () => {
    const saved: string[] = [];
    const result = await routeWebhookEvents({
      messages: [inbound()],
      statuses: [],
      mode: "single_tenant",
      envCompanyId: TAG_CITY.staleDeletedCompanyId,
      envPhoneNumberId: TAG_CITY.testPhoneNumberId,
      resolve: async () => ({ ok: true, companyId: TAG_CITY.companyId }),
      saveInbound: async (companyId) => {
        saved.push(companyId);
      },
      saveStatus: async () => undefined,
    });
    expect(saved).toEqual([TAG_CITY.staleDeletedCompanyId]);
    expect(result.dispositions[0]).toMatchObject({
      result: "persisted",
      companyId: TAG_CITY.staleDeletedCompanyId,
    });
  });
});
