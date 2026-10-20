import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ finish: vi.fn(), ports: vi.fn(), complete: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/whatsapp/coexistence/flow", () => ({ finishCoexistenceSignup: (...args: unknown[]) => state.finish(...args) }));
vi.mock("@/lib/whatsapp/coexistence/signup-store", () => ({ createCoexistenceSignupPorts: (...args: unknown[]) => state.ports(...args) }));
vi.mock("@/lib/instagram/connection-flow", () => ({ completeInstagramConnection: (...args: unknown[]) => state.complete(...args) }));
vi.mock("@/lib/instagram/oauth-meta", () => ({
  readInstagramOAuthConfig: () => ({ appId: "123456", contractId: "contract", redirectUri: "https://example.test/callback" }),
  exchangeInstagramCode: async () => ({ ok: false, code: "source_failed" }),
}));

import { exchangeOwnedBranchConnection } from "./paid-branch-connection-adapters";

const scope = {
  expectedAccountId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
};
const attemptId = "55555555-5555-4555-8555-555555555555";
const sessionId = "44444444-4444-4444-8444-444444444444";
const rpc = { rpc: async () => ({ data: null, error: null }) };

function enabledConfig() {
  Object.assign(process.env, {
    WHATSAPP_COEXISTENCE: "true",
    WHATSAPP_ROUTING_MODE: "tenant_registry",
    WHATSAPP_EMBEDDED_SIGNUP_APP_ID: "123456",
    WHATSAPP_COEXISTENCE_CONFIG_ID: "654321",
    WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: "111111",
    WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION: "v25.0",
    WHATSAPP_APP_SECRET: "unit-test-secret",
    WHATSAPP_EMBEDDED_SIGNUP_SYSTEM_USER_TOKEN: "unit-test-token",
  });
}

describe("coexistence exchange and instagram generation pin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", state.fetch);
    state.finish.mockResolvedValue({ ok: false });
    state.complete.mockResolvedValue({ ok: true });
  });

  it.each([
    ["flag disabled", { WHATSAPP_COEXISTENCE: "false" }],
    ["routing wrong", { WHATSAPP_ROUTING_MODE: "company" }],
    ["equal config id", { WHATSAPP_COEXISTENCE_CONFIG_ID: "111111" }],
  ])("does not claim or call the provider when %s", async (_label, overrides) => {
    enabledConfig();
    Object.assign(process.env, overrides);
    const result = await exchangeOwnedBranchConnection({
      request: { ...scope, channel: "whatsapp", flow: "wa_coexistence", attemptId, generation: 2 },
      completion: { attemptId, confirmed: true, confirmedPhoneNumber: "+96891234567", nonce: "a".repeat(64), code: "unit-code" },
      slot: { sessionId },
      legacy: {
        attempt_id: attemptId,
        company_id: scope.companyId,
        user_id: scope.expectedAccountId,
        session_id: sessionId,
        app_id: "123456",
        config_id: "654321",
        graph_version: "v25.0",
        keep_on_phone: true,
        expected_phone_number: "+96891234567",
      },
      session: rpc,
      admin: rpc,
      finalize: async () => ({ ok: true }),
      stage: async () => ({ ok: true, stageReceipt: attemptId }),
    });
    expect(result).toEqual({ ok: false, code: "setup_required" });
    expect(state.ports).not.toHaveBeenCalled();
    expect(state.finish).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("accepts the pinned oauth generation when it differs from the branch generation", async () => {
    const result = await exchangeOwnedBranchConnection({
      request: { ...scope, channel: "instagram", flow: "instagram_direct", attemptId, generation: 4 },
      completion: { attemptId, state: "c".repeat(64), code: "unit-code" },
      slot: { sessionId },
      legacy: { binding: { companyId: scope.companyId, userId: scope.expectedAccountId, sessionId, attemptId, generation: 9, appId: "123456", contractId: "contract" } },
      session: rpc,
      admin: rpc,
      finalize: async () => ({ ok: true, linkId: attemptId }),
      stage: async () => ({ ok: true, stageReceipt: attemptId }),
    });
    expect(result.ok).toBe(true);
    expect(state.complete).toHaveBeenCalledOnce();
    expect(state.complete.mock.calls[0][2]).toMatchObject({ generation: 9, attemptId });
  });
});
