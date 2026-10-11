import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seam = vi.hoisted(() => ({
  access: vi.fn(), capability: vi.fn(), scope: vi.fn(), rpc: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: seam.access }));
vi.mock("@/lib/access/actions", () => ({
  sessionHasCompanyCapability: seam.capability, sessionConversationScope: seam.scope,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: seam.rpc, from: seam.from }),
}));

import { loadWhatsappConversation, loadWhatsappInbox } from "./inbox";
import * as contracts from "./inbox-contracts";

const companyId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const messageId = "30000000-0000-4000-8000-000000000001";
const conversation = { id: conversationId, inbox_sequence: "3", customer_name: "Synthetic", customer_wa_id: "synthetic",
  status: "open", automation_allowed: true, control_revision: 1, automation_generation: 0, assigned_to: null,
  unread_count: 1, latest_message: null, intervention: { reasons: [] } };
const fingerprint = "7a78f383d95b3f8842dfd95eb6efb4b5";

beforeEach(() => {
  vi.resetAllMocks();
  seam.access.mockResolvedValue({ ok: true, context: {
    company: { id: companyId }, membership: { role: "owner", status: "active" }, userId: "owner",
  } });
  seam.capability.mockResolvedValue(true);
  seam.scope.mockResolvedValue("all_company");
});

describe("legacy fail closed", () => {
  it("does not read inbox when capability RPC is unknown", async () => {
    seam.capability.mockResolvedValue(null);
    expect(await loadWhatsappInbox()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(seam.from).not.toHaveBeenCalled();
  });
  it("does not read thread when capability RPC is unknown", async () => {
    seam.capability.mockResolvedValue(null);
    expect(await loadWhatsappConversation(conversationId)).toBeNull();
    expect(seam.from).not.toHaveBeenCalled();
  });
});

describe("bounded inbox contracts", () => {
  it("rejects malformed public action inputs before authentication or data reads", async () => {
    expect(await contracts.loadWhatsappInboxPage(null as never)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await contracts.loadWhatsappThreadPage(undefined as never)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await contracts.loadWhatsappControlAuditPage([] as never)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await contracts.markWhatsappThreadRead(null as never)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await contracts.loadWhatsappConnectionStatus("bad" as never)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(seam.access).not.toHaveBeenCalled();
    expect(seam.rpc).not.toHaveBeenCalled();
  });
  it("rejects a stale selected company without contacting data RPC", async () => {
    expect(await contracts.loadWhatsappInboxPage({ companyId: messageId })).toEqual({ ok: false, code: "SCOPE_CHANGED" });
    expect(seam.rpc).not.toHaveBeenCalled();
  });
  it("rejects unknown conversation scope", async () => {
    seam.scope.mockResolvedValue(null);
    expect(await contracts.loadWhatsappInboxPage({ companyId })).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(seam.rpc).not.toHaveBeenCalled();
  });
  it("never reports a bounded inbox as a full snapshot or returns provider secrets", async () => {
    seam.rpc.mockResolvedValue({ data: {
      ok: true, company_id: companyId, conversation_scope: "all_company", kind: "full",
      conversations: [{ id: conversationId, inbox_sequence: "3", customer_name: "Synthetic customer",
        customer_wa_id: "synthetic", status: "open", automation_allowed: true, control_revision: 1,
        automation_generation: 0, assigned_to: null, unread_count: 2, latest_message: null,
        intervention: { reasons: ["human_control"], claim_token: "secret" }, access_secret_id: "secret" }],
      next_cursor: "3", has_more: true, total: 2, unread_total: 2, intervention_total: 1, membership_fingerprint: fingerprint,
      access_secret_id: "secret",
    }, error: null });
    const result = await contracts.loadWhatsappInboxPage({ companyId, limit: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.kind).toBe("partial");
    expect(result.data.hasMore).toBe(true);
    expect(result.data.nextCursor).toBe("3");
    expect(result.data.conversations[0].unreadCount).toBe(2);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(seam.rpc).toHaveBeenCalledWith("whatsapp_inbox_page", { p_company_id: companyId, p_limit: 1, p_before: null });
  });
  it("fails closed on missing RPC and does not expose raw errors", async () => {
    seam.rpc.mockResolvedValue({ data: null, error: { message: "missing RPC sensitive database text" } });
    expect(await contracts.loadWhatsappInboxPage({ companyId })).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("rejects unsafe numeric cursors without rounded bigint conversion", async () => {
    expect(await contracts.loadWhatsappInboxPage({ companyId, before: "1e9" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await contracts.loadWhatsappInboxPage({ companyId, limit: 101 })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
  it("only forwards a displayed message identity when marking read", async () => {
    seam.rpc.mockResolvedValue({ data: { ok: true, company_id: companyId, conversation_id: conversationId,
      conversation,
      last_read_sequence: "9007199254740993", unread_count: 1 }, error: null });
    expect(await contracts.markWhatsappThreadRead({ companyId, conversationId, displayedInboundMessageId: messageId })).toEqual({
      ok: true, data: { companyId, conversationId, lastReadSequence: "9007199254740993", unreadCount: 1 },
    });
    expect(seam.rpc).toHaveBeenCalledWith("whatsapp_mark_thread_read", {
      p_company_id: companyId, p_conversation_id: conversationId, p_displayed_inbound_message_id: messageId,
    });
  });
  it("fails the legacy full inbox when membership pagination cannot be completed", async () => {
    seam.rpc.mockResolvedValue({ data: { ok: true, company_id: companyId, conversation_scope: "all_company",
      conversations: [], next_cursor: "3", has_more: true, total: 2, unread_total: 1, intervention_total: 0, membership_fingerprint: fingerprint }, error: null });
    expect(await loadWhatsappInbox()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(seam.rpc).toHaveBeenCalledTimes(2);
  });
  it("rejects full compatibility snapshots when authorized membership changes after traversal", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({ data: { timezone: "Asia/Muscat" }, error: null }) };
    seam.from.mockReturnValue(query);
    seam.capability.mockImplementation(async (_id, capability) => capability !== "wa.conversations.assign");
    let inboxLoads = 0;
    seam.rpc.mockImplementation(async name => ({ error: null, data: name === "whatsapp_thread_page"
      ? { ok: true, company_id: companyId, conversation_id: conversationId, conversation, messages: [],
        displayed_inbound_message_id: null, next_cursor: null, has_more: false, unread_count: 1 }
      : { ok: true, company_id: companyId, conversation_scope: "all_company", conversations: [conversation],
        next_cursor: null, has_more: false, total: 1, unread_total: 1, intervention_total: 0,
        membership_fingerprint: ++inboxLoads === 1 ? fingerprint : "abcdef0123456789abcdef0123456789" } }));
    expect(await loadWhatsappInbox()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(inboxLoads).toBe(2);
  });
  it("rejects a complete-list claim whose returned IDs do not match the authoritative membership", async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({ data: { timezone: "Asia/Muscat" }, error: null }) };
    seam.from.mockReturnValue(query);
    seam.capability.mockImplementation(async (_id, capability) => capability !== "wa.conversations.assign");
    seam.rpc.mockResolvedValue({ error: null, data: { ok: true, company_id: companyId, conversation_scope: "all_company",
      conversations: [], next_cursor: null, has_more: false, total: 1, unread_total: 1, intervention_total: 0,
      membership_fingerprint: fingerprint } });
    expect(await loadWhatsappInbox()).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("assembles complete legacy threads in immutable arrival order across pages", async () => {
    const freshId = "40000000-0000-4000-8000-000000000001";
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: async () => ({ data: { timezone: "Asia/Muscat" }, error: null }) };
    seam.from.mockReturnValue(query);
    seam.capability.mockImplementation(async (_id, capability) => capability !== "wa.conversations.assign");
    seam.rpc.mockImplementation(async (name, args) => ({ error: null, data: name === "whatsapp_thread_page"
      ? { ok: true, company_id: companyId, conversation_id: conversationId, conversation,
        messages: [{ id: args.p_before ? messageId : freshId, arrival_sequence: args.p_before ? "2" : "3",
          body: args.p_before ? "Older arrival, future provider time" : "Newest arrival", sender: "customer", direction: "inbound",
          received_at: args.p_before ? "2099-01-01T00:00:00Z" : "2026-10-08T00:00:00Z", delivery_state: null }],
        displayed_inbound_message_id: args.p_before ? null : freshId, next_cursor: args.p_before ? null : "3",
        has_more: !args.p_before, unread_count: 1 }
      : { ok: true, company_id: companyId, conversation_scope: "all_company", conversations: [conversation],
        next_cursor: null, has_more: false, total: 1, unread_total: 1, intervention_total: 0, membership_fingerprint: fingerprint } }));
    const result = await loadWhatsappInbox();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversations[0].messages.map(m => m.id)).toEqual([messageId, freshId]);
    expect(result.conversations[0].summary).toBe("Newest arrival");
    expect(result.meta.counts.all).toBe(1);
  });
  it("returns a conflict when an older displayed boundary was replaced", async () => {
    seam.rpc.mockResolvedValue({ data: { ok: false, code: "display_changed" }, error: null });
    expect(await contracts.markWhatsappThreadRead({ companyId, conversationId, displayedInboundMessageId: messageId })).toEqual({ ok: false, code: "CONFLICT" });
  });
  it("fails closed on a response from the wrong tenant", async () => {
    seam.rpc.mockResolvedValue({ data: { ok: true, company_id: messageId, conversation_scope: "all_company", conversations: [] }, error: null });
    expect(await contracts.loadWhatsappInboxPage({ companyId })).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("returns the server-stored inbound boundary for a thread page without marking it read", async () => {
    seam.rpc.mockResolvedValue({ data: { ok: true, company_id: companyId, conversation_id: conversationId,
      conversation,
      messages: [{ id: messageId, arrival_sequence: "8", body: "Synthetic inbound", sender: "customer",
        direction: "inbound", received_at: "2099-01-01T00:00:00Z", delivery_state: null, claim_token: "secret" }],
      displayed_inbound_message_id: messageId, next_cursor: null, has_more: false, unread_count: 1 }, error: null });
    const result = await contracts.loadWhatsappThreadPage({ companyId, conversationId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.displayedInboundMessageId).toBe(messageId);
    expect(result.data.messages[0].arrivalSequence).toBe("8");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(seam.rpc).toHaveBeenCalledTimes(1);
  });
  it("returns control audit entries without raw event detail", async () => {
    seam.rpc.mockResolvedValue({ data: { ok: true, company_id: companyId, conversation_id: conversationId,
      events: [{ id: messageId, event_sequence: "9", action: "take_over", actor_user_id: conversationId,
        revision: 3, automation_generation: 4, created_at: "2026-10-08T00:00:00Z", detail: { secret: "secret" } }],
      next_cursor: null, has_more: false }, error: null });
    const result = await contracts.loadWhatsappControlAuditPage({ companyId, conversationId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.events[0].action).toBe("take_over");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("returns honest separate connection evidence without credentials", async () => {
    seam.rpc.mockResolvedValue({ data: { ok: true, company_id: companyId, connection: {
      status: "verified", display_number: "+968 synthetic", authorization_status: "revoked",
      receive_ready: false, send_ready: false, inbound_tested_at: null, outbound_tested_at: null,
      access_secret_id: "secret", authorization_scopes: ["secret"] }, }, error: null });
    const result = await contracts.loadWhatsappConnectionStatus({ companyId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sendReady).toBe(false);
    expect(result.data.authorizationStatus).toBe("revoked");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("inbox denial provenance", () => {
 it("preserves an explicit RPC forbidden result", async () => {
  seam.rpc.mockResolvedValue({data:{ok:false,code:"forbidden"},error:null});
  expect(await contracts.loadWhatsappInboxPage({companyId})).toEqual({ok:false,code:"FORBIDDEN"});
 });
 it("keeps ambiguous helper false unavailable without reading inbox", async () => {
  seam.capability.mockResolvedValue(false);
  expect(await contracts.loadWhatsappInboxPage({companyId})).toEqual({ok:false,code:"UNAVAILABLE"});
  expect(seam.rpc).not.toHaveBeenCalled();
 });
});

afterEach(() => vi.restoreAllMocks());

describe("sanitized inbox RPC diagnostics", () => {
 it("records known transport code without raw error or tenant data", async () => {
  const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
  seam.rpc.mockResolvedValue({data:null,error:{code:"PGRST202",message:"PRIVATE_ERROR",details:companyId}});
  expect(await contracts.loadWhatsappInboxPage({companyId})).toEqual({ok:false,code:"UNAVAILABLE"});
  expect(log).toHaveBeenCalledWith("whatsapp.inbox_read_failed",{stage:"page_rpc",code:"RPC_ERROR",error_code:"PGRST202"});
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_ERROR|10000000/);
 });
 it("records malformed response validation without response contents", async () => {
  const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
  seam.rpc.mockResolvedValue({data:{ok:true,company_id:companyId,conversation_scope:"all_company",conversations:"PRIVATE_ROWS"},error:null});
  expect(await contracts.loadWhatsappInboxPage({companyId})).toEqual({ok:false,code:"UNAVAILABLE"});
  expect(log).toHaveBeenCalledWith("whatsapp.inbox_read_failed",{stage:"page_decode",code:"INVALID_RESPONSE"});
  expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_ROWS");
 });
});
