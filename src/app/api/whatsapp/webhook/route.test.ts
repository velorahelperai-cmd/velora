import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));

const state = vi.hoisted(() => ({
  mode: "tenant_registry" as "tenant_registry" | "single_tenant",
  ready: true,
  admin: {} as object | null,
  config: { appSecret: "synthetic-hmac-secret", verifyToken: "synthetic-verify-token", companyId: "env-company", phoneNumberId: "env-phone", accessToken: "" },
}));
const mocks = vi.hoisted(() => ({
  saveInbound: vi.fn(), saveStatus: vi.fn(), resolve: vi.fn(), createAdminClient: vi.fn(), rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/whatsapp/config", () => ({
  whatsappConfig: () => state.config,
  whatsappRoutingMode: () => state.mode,
  webhookReady: () => state.ready,
}));
vi.mock("@/lib/whatsapp/store", () => ({ saveInbound: mocks.saveInbound, saveStatus: mocks.saveStatus }));
vi.mock("@/lib/whatsapp/tenant-resolve", () => ({ resolveWhatsappCompanyByMetaAsset: mocks.resolve }));

import { GET, POST } from "./route";

function envelope(phone = "synthetic-phone", id = "wamid.synthetic", body = "مرحبا") {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "synthetic-waba", changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp", metadata: { phone_number_id: phone },
        messages: [{ id, from: "synthetic-customer", timestamp: "1710000000", type: "text", text: { body } }],
      },
    }] }],
  };
}

function signedRequest(raw: string | Uint8Array, header?: string) {
  const bytes = typeof raw === "string" ? Buffer.from(raw, "utf8") : raw;
  const signature = header ?? `sha256=${createHmac("sha256", state.config.appSecret).update(bytes).digest("hex")}`;
  return new Request("http://localhost/api/whatsapp/webhook", {
    method: "POST", headers: { "x-hub-signature-256": signature, "content-type": "application/json" }, body: new Uint8Array(bytes).buffer,
  });
}

beforeEach(() => {
  vi.stubEnv('WHATSAPP_RECEIVE_ENABLED','true');
  vi.clearAllMocks();
  state.mode = "tenant_registry";
  state.ready = true;
  state.admin = { rpc: mocks.rpc };
  mocks.createAdminClient.mockImplementation(() => state.admin);
  mocks.resolve.mockResolvedValue({ ok: true, companyId: "synthetic-company" });
  mocks.saveInbound.mockResolvedValue({ inserted: true });
  mocks.saveStatus.mockResolvedValue({ inserted: true });
  mocks.rpc.mockResolvedValue({ data: { ok: true, revoked: 1 }, error: null });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("Network forbidden in reception tests"); });
});

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("P4 WhatsApp reception route", () => {
  it.each(['', 'sha1=invalid', 'sha256='+ 'z'.repeat(64)])('rejects malformed authentication before consuming the body (%s)',async signature=>{
    const request=signedRequest('{}',signature),read=vi.spyOn(request,'arrayBuffer');
    expect((await POST(request)).status).toBe(401);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it('preserves GET verification when event reception is closed',async()=>{
    vi.stubEnv('WHATSAPP_RECEIVE_ENABLED','false');
    const response=await GET(new Request('http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=check'));
    expect(response.status).toBe(200);expect(await response.text()).toBe('check');expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
  it.each([undefined,'false','TRUE'])('blocks every event before body or database when receive is not explicitly enabled (%s)',async flag=>{
    vi.stubEnv('WHATSAPP_RECEIVE_ENABLED',flag);
    const request=signedRequest(JSON.stringify(envelope()));
    const body=vi.spyOn(request,'arrayBuffer');
    expect((await POST(request)).status).toBe(503);
    expect(body).not.toHaveBeenCalled();expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.saveInbound).not.toHaveBeenCalled();expect(mocks.saveStatus).not.toHaveBeenCalled();
  });
  it("passes signed exact WABA partner removal to the scoped revocation RPC", async () => {
    const payload = { object: "whatsapp_business_account", entry: [{ id: "10000001", time: 1710000000, changes: [{
      field: "account_update", value: { event: "PARTNER_REMOVED", waba_info: { waba_id: "10000001" } },
    }] }] };
    expect((await POST(signedRequest(JSON.stringify(payload)))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("whatsapp_revoke_meta_waba_authorization", { p_waba_id: "10000001", p_reason: "PARTNER_REMOVED", p_occurred_at: "2024-03-09T16:00:00.000Z" });
    expect(mocks.saveInbound).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private provider detail" } });
    expect((await POST(signedRequest(JSON.stringify(payload)))).status).toBe(500);
  });

  it("acknowledges unsupported or contradictory account updates without revoking a tenant", async () => {
    const payload = { object: "whatsapp_business_account", entry: [{ id: "10000001", changes: [{
      field: "account_update", value: { event: "PARTNER_REMOVED", waba_info: { waba_id: "10000002" } },
    }] }] };
    expect((await POST(signedRequest(JSON.stringify(payload)))).status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("returns the Meta challenge only for the configured verification token", async () => {
    const verified = await GET(new Request("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=synthetic-challenge"));
    expect(verified.status).toBe(200);
    expect(await verified.text()).toBe("synthetic-challenge");
    expect((await GET(new Request("http://localhost/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=synthetic-challenge"))).status).toBe(403);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("verifies the exact signed UTF-8 bytes before parsing and persists with registry tenant only", async () => {
    const raw = ` ${JSON.stringify({ ...envelope(), company_id: "forged-tenant" })}\n`;
    const response = await POST(signedRequest(raw));
    expect(response.status).toBe(200);
    expect(mocks.saveInbound).toHaveBeenCalledWith(state.admin, "synthetic-company", expect.objectContaining({ body: "مرحبا", phoneNumberId: "synthetic-phone" }));
    expect(JSON.stringify(mocks.saveInbound.mock.calls)).not.toContain("forged-tenant");
  });

  it("rejects a signature for a different raw body before creating a database client", async () => {
    const raw = JSON.stringify(envelope());
    const different = `sha256=${createHmac("sha256", state.config.appSecret).update(`${raw} `).digest("hex")}`;
    expect((await POST(signedRequest(raw, different))).status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.saveInbound).not.toHaveBeenCalled();
  });

  it("rejects authentic but invalid JSON without database access", async () => {
    expect((await POST(signedRequest("{broken"))).status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("authenticates raw bytes then rejects invalid UTF-8 instead of rejecting a valid raw signature", async () => {
    const bytes = Buffer.concat([Buffer.from('{"object":"'), Buffer.from([0xff]), Buffer.from('"}')]);
    expect((await POST(signedRequest(bytes))).status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps unreadable request bodies retryable without routing or persistence", async () => {
    const request = signedRequest("{}");
    vi.spyOn(request, "text").mockRejectedValue(new Error("body stream interrupted"));
    vi.spyOn(request, "arrayBuffer").mockRejectedValue(new Error("body stream interrupted"));
    expect((await POST(request)).status).toBe(500);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.saveInbound).not.toHaveBeenCalled();
  });

  it("requests redelivery when configured reception cannot reach its database", async () => {
    state.admin = null;
    expect((await POST(signedRequest(JSON.stringify(envelope())))).status).toBe(503);
    expect(mocks.saveInbound).not.toHaveBeenCalled();
  });

  it("acknowledges foreign Graph events without treating their embedded messages as WhatsApp", async () => {
    const foreign = { ...envelope(), object: "page" };
    expect((await POST(signedRequest(JSON.stringify(foreign)))).status).toBe(200);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.saveInbound).not.toHaveBeenCalled();
  });

  it("does not send unknown business numbers to an environment default tenant", async () => {
    mocks.resolve.mockResolvedValue({ ok: false, code: "unknown_or_inactive" });
    expect((await POST(signedRequest(JSON.stringify(envelope("foreign-phone"))))).status).toBe(200);
    expect(mocks.saveInbound).not.toHaveBeenCalled();
  });

  it("isolates resolver exceptions while saving other tenants and returns retryable HTTP", async () => {
    mocks.resolve.mockImplementation(async (_admin, _waba: string, phone: string) => {
      if (phone === "synthetic-phone") throw new Error("unavailable");
      return { ok: true, companyId: "second-synthetic-company" };
    });
    const first = envelope();
    const combined = { ...first, entry: [...first.entry, ...envelope("second-synthetic-phone", "wamid.second").entry] };
    expect((await POST(signedRequest(JSON.stringify(combined)))).status).toBe(500);
    expect(mocks.saveInbound).toHaveBeenCalledTimes(1);
    expect(mocks.saveInbound).toHaveBeenCalledWith(state.admin, "second-synthetic-company", expect.objectContaining({ waMessageId: "wamid.second" }));
  });

  it("redelivers a partial batch safely using the durable store's existing per-message idempotency", async () => {
    const persisted = new Set<string>();
    let failSecond = true;
    mocks.saveInbound.mockImplementation(async (_admin, company: string, message: { waMessageId: string }) => {
      if (message.waMessageId === "wamid.second" && failSecond) {
        failSecond = false;
        throw new Error("temporary persist failure");
      }
      const key = `${company}:${message.waMessageId}`;
      const inserted = !persisted.has(key);
      persisted.add(key);
      return { inserted };
    });
    const first = envelope();
    const combined = { ...first, entry: [...first.entry, ...envelope("synthetic-phone", "wamid.second").entry] };
    const raw = JSON.stringify(combined);
    expect((await POST(signedRequest(raw))).status).toBe(500);
    expect(persisted.size).toBe(1);
    expect((await POST(signedRequest(raw))).status).toBe(200);
    expect(persisted.size).toBe(2);
    expect(mocks.saveInbound).toHaveBeenCalledTimes(4);
    // This verifies route redelivery; actual Postgres duplicate constraints remain a P1 integration requirement.
  });
});
