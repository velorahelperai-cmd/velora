import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import {
  matchMetaTestInboundMessage,
  metaTestInboundAssetConfig,
  whatsappConfig,
  whatsappConfigurationMode,
  whatsappRoutingMode,
} from "./config";
import { saveInbound } from "./store";
import { routeWebhookEvents, type InboundMessage } from "./webhook";

/** Pinned TAG CITY scope from Production branch ownership proof (not guessed). */
const TAG_CITY = {
  accountId: "177ef439-3fb0-4e3e-96b8-2a9e8661386d",
  companyId: "40d2d885-8b63-49c4-b3da-d2e9566f2750",
  branchId: "a268f9d8-fe5b-41b2-a337-97046a5eaa5c",
  staleDeletedCompanyId: "7c5e429d-2be3-4578-bf15-8db2fdb5647f",
  testPhoneNumberId: "1261345677073276",
  testWabaId: "2057350774985092",
  authorizedSenderWaId: "96876351423",
} as const;

function inbound(partial: Partial<InboundMessage> = {}): InboundMessage {
  return {
    wabaId: TAG_CITY.testWabaId,
    phoneNumberId: TAG_CITY.testPhoneNumberId,
    customerWaId: TAG_CITY.authorizedSenderWaId,
    customerName: "Authorized Tester",
    waMessageId: "wamid.tag-city-fixture",
    body: "synthetic inbound",
    messageType: "text",
    receivedAt: "2026-10-29T12:00:00.000Z",
    ...partial,
  };
}

function stubLiveTenantRegistryWithMetaTestAsset() {
  vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "live");
  vi.stubEnv("WHATSAPP_ROUTING_MODE", "tenant_registry");
  vi.stubEnv("WHATSAPP_TEST_COMPANY_ID", TAG_CITY.companyId);
  vi.stubEnv("WHATSAPP_TEST_WABA_ID", TAG_CITY.testWabaId);
  vi.stubEnv("WHATSAPP_TEST_PHONE_NUMBER_ID", TAG_CITY.testPhoneNumberId);
  vi.stubEnv("WHATSAPP_TEST_RECIPIENTS", TAG_CITY.authorizedSenderWaId);
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

  it("keeps WHATSAPP_CONFIGURATION_MODE=live and WHATSAPP_ROUTING_MODE=tenant_registry while matching only the exact authorized Meta test asset and sender", () => {
    stubLiveTenantRegistryWithMetaTestAsset();

    expect(whatsappConfigurationMode()).toBe("live");
    expect(whatsappRoutingMode()).toBe("tenant_registry");
    expect(metaTestInboundAssetConfig()).toEqual({
      companyId: TAG_CITY.companyId,
      wabaId: TAG_CITY.testWabaId,
      phoneNumberId: TAG_CITY.testPhoneNumberId,
      allowedSenders: [TAG_CITY.authorizedSenderWaId],
    });

    expect(matchMetaTestInboundMessage(inbound())).toEqual({
      matched: true,
      allowed: true,
      companyId: TAG_CITY.companyId,
    });
    expect(matchMetaTestInboundMessage(inbound({ customerWaId: "96890000000" }))).toEqual({
      matched: true,
      allowed: false,
      code: "test_sender_not_allowed",
    });
    expect(matchMetaTestInboundMessage(inbound({ wabaId: "999999999999999" }))).toEqual({
      matched: true,
      allowed: false,
      code: "test_asset_waba_mismatch",
    });
    expect(matchMetaTestInboundMessage(inbound({ phoneNumberId: "999999999999999" }))).toEqual({
      matched: true,
      allowed: false,
      code: "test_asset_phone_mismatch",
    });
    expect(
      matchMetaTestInboundMessage(
        inbound({ wabaId: "111111111111111", phoneNumberId: "222222222222222", customerWaId: "96890000000" }),
      ),
    ).toEqual({ matched: false });
  });

  it("routes the authorized Meta test message to TAG CITY in tenant_registry mode without faking a commercial link, while keeping commercial tenant_registry routing intact", async () => {
    stubLiveTenantRegistryWithMetaTestAsset();

    const saved: Array<{ companyId: string; waMessageId: string }> = [];
    const resolved: string[] = [];

    const result = await routeWebhookEvents({
      messages: [
        inbound({ waMessageId: "wamid.meta-test-authorized" }),
        inbound({ waMessageId: "wamid.meta-test-unauthorized-sender", customerWaId: "96890000000" }),
        inbound({ waMessageId: "wamid.meta-test-wrong-waba", wabaId: "999999999999999" }),
        inbound({ waMessageId: "wamid.meta-test-wrong-phone", phoneNumberId: "888888888888888" }),
        inbound({
          waMessageId: "wamid.commercial-ok",
          wabaId: "333333333333333",
          phoneNumberId: "444444444444444",
          customerWaId: "96891111111",
        }),
      ],
      statuses: [],
      mode: "tenant_registry",
      envCompanyId: "",
      envPhoneNumberId: "",
      resolve: async (phoneNumberId, wabaId) => {
        resolved.push(`${wabaId}:${phoneNumberId}`);
        if (wabaId === "333333333333333" && phoneNumberId === "444444444444444") {
          return { ok: true, companyId: "commercial-company-uuid" };
        }
        return { ok: false, code: "unknown_or_inactive" };
      },
      saveInbound: async (companyId, message) => {
        saved.push({ companyId, waMessageId: message.waMessageId });
      },
      saveStatus: async () => undefined,
    });

    expect(result.retry).toBe(false);
    expect(resolved).toEqual(["333333333333333:444444444444444"]);
    expect(saved).toEqual([
      { companyId: TAG_CITY.companyId, waMessageId: "wamid.meta-test-authorized" },
      { companyId: "commercial-company-uuid", waMessageId: "wamid.commercial-ok" },
    ]);
    expect(result.dispositions).toEqual([
      expect.objectContaining({
        waMessageId: "wamid.meta-test-authorized",
        result: "persisted",
        companyId: TAG_CITY.companyId,
      }),
      expect.objectContaining({
        waMessageId: "wamid.meta-test-unauthorized-sender",
        result: "rejected",
        code: "test_sender_not_allowed",
      }),
      expect.objectContaining({
        waMessageId: "wamid.meta-test-wrong-waba",
        result: "rejected",
        code: "test_asset_waba_mismatch",
      }),
      expect.objectContaining({
        waMessageId: "wamid.meta-test-wrong-phone",
        result: "rejected",
        code: "test_asset_phone_mismatch",
      }),
      expect.objectContaining({
        waMessageId: "wamid.commercial-ok",
        result: "persisted",
        companyId: "commercial-company-uuid",
      }),
    ]);
  });

  it("saves the authorized Meta test message via atomic save_whatsapp_inbound_receive_only and keeps commercial messages on whatsapp_store_meta_inbound", async () => {
    stubLiveTenantRegistryWithMetaTestAsset();

    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const admin = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        if (name === "save_whatsapp_inbound_receive_only") {
          return {
            error: null,
            data: {
              ok: true,
              inserted: true,
              message_id: "msg-test-1",
              conversation_id: "conv-test-1",
              job_id: "job-test-1",
              job_status: "completed",
              result_code: "SETUP_META_TEST_RECEIVE_ONLY",
            },
          };
        }
        return {
          error: null,
          data: {
            ok: true,
            inserted: true,
            message_id: "msg-comm-1",
            conversation_id: "conv-comm-1",
            job_id: "job-comm-1",
            job_status: "pending",
          },
        };
      },
    } as unknown as SupabaseClient<Database>;

    const testSaved = await saveInbound(admin, TAG_CITY.companyId, inbound({ waMessageId: "wamid.test-atomic" }));
    expect(testSaved).toEqual({
      inserted: true,
      messageId: "msg-test-1",
      conversationId: "conv-test-1",
      jobId: "job-test-1",
      jobStatus: "completed",
    });

    const commercialSaved = await saveInbound(
      admin,
      "commercial-company-uuid",
      inbound({
        waMessageId: "wamid.comm-atomic",
        wabaId: "333333333333333",
        phoneNumberId: "444444444444444",
        customerWaId: "96891111111",
      }),
    );
    expect(commercialSaved.jobStatus).toBe("pending");

    expect(rpcCalls.map((c) => c.name)).toEqual([
      "save_whatsapp_inbound_receive_only",
      "whatsapp_store_meta_inbound",
    ]);

    await expect(
      saveInbound(admin, "wrong-company-id", inbound({ waMessageId: "wamid.wrong-company" })),
    ).rejects.toThrow("save_inbound_meta_test_scope_mismatch");
  });
});
