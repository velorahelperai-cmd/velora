import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  created: {} as Record<string, unknown>,
  claimed: {} as Record<string, unknown>,
  finalized: { error: null, data: {} } as { error: unknown; data: unknown },
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  capability: true,
  throwFinalizeOnce: false,
}));

function intent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-offline-a", client_op_id: "offline-op-0001", company_id: "company-offline-a",
    conversation_id: "conversation-offline-a", phone_number_id: "100000000000001", recipient_wa_id: "10000000001",
    body: "Offline reply", sender_kind: "staff", outcome: "ready", wa_message_id: null, message_id: null,
    link_id: null, link_generation: null, expected_automation_generation: null, ...overrides,
  };
}

vi.mock("@/lib/tenancy/access", () => ({
  getCompanyAccess: async () => ({ ok: true, context: {
    company: { id: "company-offline-a", status: "active" }, membership: { role: "staff" }, userId: "user-offline-a",
  } }),
}));
vi.mock("@/lib/access/actions", () => ({ sessionHasCompanyCapability: async () => fixture.capability }));
vi.mock("@/lib/whatsapp/inbox", () => ({ loadWhatsappConversation: vi.fn(), loadWhatsappInbox: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (table: string) => {
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => table === "whatsapp_conversations" ? { error: null, data: {
        id: "conversation-offline-a", company_id: "company-offline-a", phone_number_id: "100000000000001", customer_wa_id: "10000000001",
      } } : { error: null, data: null },
    };
    return query;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    fixture.calls.push({ name, args });
    return { error: null, data: fixture.created };
  },
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    fixture.calls.push({ name, args });
    if (name === "claim_whatsapp_send_attempt") return { error: null, data: fixture.claimed };
    if (name === "finalize_whatsapp_send_attempt") {
      if (fixture.throwFinalizeOnce) {
        fixture.throwFinalizeOnce = false;
        throw new Error("Offline RPC transport exception");
      }
      return fixture.finalized;
    }
    if (name === "retry_whatsapp_send_persist") return { error: null, data: { ok: true } };
    throw new Error(`Unexpected offline RPC ${name}`);
  },
}) }));

describe("real staff reply action at persistence and Graph boundaries", () => {
  beforeEach(() => {
    fixture.capability = true;
    fixture.throwFinalizeOnce = false;
    fixture.calls = [];
    fixture.created = { ok: true, intent: intent() };
    fixture.claimed = { ok: true, claimed: true, attempt_token: "offline-claim-token", intent: intent({ outcome: "attempting" }) };
    fixture.finalized = { error: null, data: { ok: true, intent: intent({ outcome: "accepted", wa_message_id: "wamid.offline" }), message: {
      id: "message-offline-a", body: "Offline reply", received_at: "2026-10-08T00:00:00Z", delivery_state: "accepted",
    } } };
    vi.stubEnv("WHATSAPP_ROUTING_MODE", "single_tenant");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "offline-fixture-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "100000000000001");
    vi.stubEnv("WHATSAPP_COMPANY_ID", "company-offline-a");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.offline" }] })));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  const input = { conversationId: "conversation-offline-a", body: "Offline reply", clientOpId: "offline-op-0001" };

  it.each([
    { claimed: false },
    { claimed: undefined },
    { intent: null },
    { intent: intent({ outcome: "ready" }) },
    { attempt_token: "   " },
    { attempt_token: " offline-claim-token " },
  ])("requires an actual attempting claim before Graph: %j", async (override) => {
    fixture.claimed = { ...fixture.claimed, ...override };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, clientOpId: input.clientOpId });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    { company_id: "company-offline-b" },
    { recipient_wa_id: "10000000002" },
    { body: "Different reply" },
    { id: "intent-offline-b" },
    { client_op_id: "offline-op-0002" },
    { conversation_id: "conversation-offline-b" },
    { sender_kind: "assistant" },
  ])("rejects changed claimed operation binding before Graph: %j", async (override) => {
    fixture.claimed = { ...fixture.claimed, intent: intent({ outcome: "attempting", ...override }) };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, clientOpId: input.clientOpId });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not replay acceptance belonging to a different company", async () => {
    fixture.created = { ok: true, intent: intent({ company_id: "company-offline-b", outcome: "accepted", wa_message_id: "wamid.foreign" }) };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "CONTENT_MISMATCH" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(fixture.calls.map((call) => call.name)).toEqual(["create_whatsapp_send_intent"]);
  });

  it("retains the same operation after provider timeout instead of resending", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(Object.assign(new Error("Offline timeout"), { name: "TimeoutError" }));
    const { replyWhatsappConversation } = await import("./actions");
    const result = await replyWhatsappConversation(input);
    expect(result).toMatchObject({ ok: false, code: "UNKNOWN_OUTCOME", outcome: "unknown", clientOpId: input.clientOpId });
    expect(fixture.calls.at(-1)?.args).toMatchObject({ p_result: "unknown", p_error_code: "timeout" });
    fixture.created = { ok: true, intent: intent({ outcome: "unknown" }) };
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "UNKNOWN_OUTCOME", clientOpId: input.clientOpId });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries acceptance persistence without a second provider send", async () => {
    fixture.finalized = { error: { code: "OFFLINE_RPC_TIMEOUT" }, data: null };
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "UNKNOWN_OUTCOME", clientOpId: input.clientOpId });
    const finalizes = fixture.calls.filter((call) => call.name === "finalize_whatsapp_send_attempt");
    expect(finalizes).toHaveLength(2);
    expect(finalizes.map((call) => call.args.p_wa_message_id)).toEqual(["wamid.offline", "wamid.offline"]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("recovers a thrown finalizer without replacing accepted evidence with unknown", async () => {
    fixture.throwFinalizeOnce = true;
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: true, outcome: "accepted" });
    const finalizes = fixture.calls.filter((call) => call.name === "finalize_whatsapp_send_attempt");
    expect(finalizes.map((call) => [call.args.p_result, call.args.p_wa_message_id]))
      .toEqual([["accepted", "wamid.offline"], ["accepted", "wamid.offline"]]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("requires reply capability before creating an intent or contacting Graph", async () => {
    fixture.capability = false;
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(fixture.calls).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("preserves provider accepted state separately from delivered", async () => {
    const { replyWhatsappConversation } = await import("./actions");
    expect(await replyWhatsappConversation(input)).toMatchObject({ ok: true, outcome: "accepted", message: { deliveryState: "accepted" } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
