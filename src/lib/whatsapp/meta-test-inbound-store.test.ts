import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { saveInbound, SetupMetaTestInboundRejectError } from "./store";
import { routeWebhookEvents } from "./webhook";

const TAG = {
  companyId: "40d2d885-8b63-49c4-b3da-d2e9566f2750",
  accountId: "177ef439-3fb0-4e3e-96b8-2a9e8661386d",
  branchId: "a268f9d8-fe5b-41b2-a337-97046a5eaa5c",
  phoneNumberId: "1261345677073276",
  wabaId: "2057350774985092",
  recipientWaId: "96876351423",
} as const;

const message = {
  wabaId: TAG.wabaId,
  phoneNumberId: TAG.phoneNumberId,
  customerWaId: TAG.recipientWaId,
  customerName: "Synthetic",
  waMessageId: "wamid.meta-test-dup",
  body: "synthetic",
  messageType: "text",
  receivedAt: "2026-10-29T12:00:00.000Z",
};

function stubPinnedOpen() {
  vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "meta_test");
  vi.stubEnv("WHATSAPP_APP_SECRET", "synthetic-only-app-secret");
  vi.stubEnv("VELORA_SETUP_META_TEST_ENABLED", "true");
  vi.stubEnv("VELORA_SETUP_META_TEST_ACCOUNT_ID", TAG.accountId);
  vi.stubEnv("VELORA_SETUP_META_TEST_COMPANY_ID", TAG.companyId);
  vi.stubEnv("VELORA_SETUP_META_TEST_BRANCH_ID", TAG.branchId);
  vi.stubEnv("VELORA_SETUP_META_TEST_EXPIRES_AT", "2026-10-31T06:05:04.643Z");
  vi.stubEnv("VELORA_SETUP_META_TEST_RECIPIENT_WA_ID", TAG.recipientWaId);
  vi.stubEnv("WHATSAPP_TEST_COMPANY_ID", TAG.companyId);
  vi.stubEnv("WHATSAPP_TEST_PHONE_NUMBER_ID", TAG.phoneNumberId);
  vi.stubEnv("WHATSAPP_TEST_WABA_ID", TAG.wabaId);
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_APP_ID", "123456789012345");
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION", "v26.0");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("meta_test inbound store path", () => {
  it("uses atomic single-transaction save_whatsapp_inbound_receive_only for the pinned Setup company without post-save claim/complete RPCs", async () => {
    stubPinnedOpen();
    const names: string[] = [];
    const admin = {
      rpc: async (name: string) => {
        names.push(name);
        if (name === "save_whatsapp_inbound_receive_only") {
          return {
            data: {
              ok: true,
              inserted: false,
              message_id: "11111111-1111-4111-8111-111111111111",
              conversation_id: "22222222-2222-4222-8222-222222222222",
              job_id: "33333333-3333-4333-8333-333333333333",
              job_status: "completed",
              result_code: "SETUP_META_TEST_RECEIVE_ONLY",
            },
            error: null,
          };
        }
        throw new Error(`unexpected rpc ${name}`);
      },
    } as unknown as SupabaseClient<Database>;

    const saved = await saveInbound(admin, TAG.companyId, message);
    expect(names).toEqual(["save_whatsapp_inbound_receive_only"]);
    expect(names).not.toContain("review_store_whatsapp_inbound");
    expect(names).not.toContain("save_whatsapp_inbound");
    expect(names).not.toContain("claim_whatsapp_inbound_job");
    expect(names).not.toContain("complete_whatsapp_inbound_job");
    expect(saved).toMatchObject({ inserted: false, jobStatus: "completed" });
  });

  it("keeps review_store_whatsapp_inbound for non-pinned meta_test companies", async () => {
    vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "meta_test");
    vi.stubEnv("WHATSAPP_APP_SECRET", "synthetic-only-app-secret");
    vi.stubEnv("VELORA_SETUP_META_TEST_COMPANY_ID", TAG.companyId);
    const names: string[] = [];
    const admin = {
      rpc: async (name: string) => {
        names.push(name);
        return {
          data: {
            ok: true,
            inserted: true,
            message_id: "11111111-1111-4111-8111-111111111111",
            conversation_id: "22222222-2222-4222-8222-222222222222",
            job_id: "33333333-3333-4333-8333-333333333333",
            job_status: "pending",
          },
          error: null,
        };
      },
    } as unknown as SupabaseClient<Database>;
    await saveInbound(admin, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", message);
    expect(names).toEqual(["review_store_whatsapp_inbound"]);
  });

  it("rejects pinned-company mismatches as permanent router dispositions without retry", async () => {
    stubPinnedOpen();
    const result = await routeWebhookEvents({
      messages: [
        { ...message, customerWaId: "15550001111", waMessageId: "wamid.bad-recipient" },
        { ...message, wabaId: "0000000000000000", waMessageId: "wamid.bad-waba" },
        { ...message, phoneNumberId: "000000000000000", waMessageId: "wamid.foreign-phone" },
      ],
      statuses: [],
      mode: "single_tenant",
      envCompanyId: TAG.companyId,
      envPhoneNumberId: TAG.phoneNumberId,
      resolve: async () => {
        throw new Error("unused");
      },
      saveInbound: async (companyId, inbound) => {
        await saveInbound(
          {
            rpc: async () => {
              throw new Error("must not reach rpc for rejects");
            },
          } as unknown as SupabaseClient<Database>,
          companyId,
          inbound,
        );
      },
      saveStatus: async () => undefined,
    });
    expect(result.retry).toBe(false);
    expect(result.dispositions).toEqual([
      expect.objectContaining({ result: "rejected", code: "recipient_mismatch", waMessageId: "wamid.bad-recipient" }),
      expect.objectContaining({ result: "rejected", code: "waba_mismatch", waMessageId: "wamid.bad-waba" }),
      expect.objectContaining({ result: "rejected", code: "unknown_or_inactive", waMessageId: "wamid.foreign-phone" }),
    ]);
  });

  it("surfaces SetupMetaTestInboundRejectError as permanent", () => {
    const error = new SetupMetaTestInboundRejectError("setup_meta_test_gateway_closed");
    expect(error.permanent).toBe(true);
    expect(error.code).toBe("setup_meta_test_gateway_closed");
  });
});
