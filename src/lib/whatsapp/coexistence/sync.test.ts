import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { requestCoexistenceSync, sendCoexistenceSyncRequest, createCoexistenceSyncPorts, readCoexistenceSyncStatus, type CoexistenceSyncPorts } from "./sync";

const companyId = "11111111-1111-4111-8111-111111111111", userId = "22222222-2222-4222-8222-222222222222", sessionId = "33333333-3333-4333-8333-333333333333", linkId = "44444444-4444-4444-8444-444444444444", requestId = "55555555-5555-4555-8555-555555555555";
const identity = { companyId, userId, sessionId };
const input = { requestId, linkId, linkGeneration: 2, syncType: "history" as const, consent: true as const };
const now = Date.parse("2026-10-12T02:00:00.000Z");
const config = { enabled: true, appId: "111", graphVersion: "v25.0" };
const claim = { ok: true as const, requestId, companyId, userId, sessionId, linkId, linkGeneration: 2, syncType: "history" as const, appId: "111", graphVersion: "v25.0", stage: "claimed" as const, onboardedAt: "2026-10-12T01:00:00.000Z", deadlineAt: "2026-10-13T01:00:00.000Z" };
const authorization = { ...claim, stage: "executing" as const, accessToken: "held-token", phoneNumberId: "12345", authorizationExpiresAt: "2026-10-12T03:00:00.000Z", authorizationNonExpiring: false };
function ports(options: { claimConsumed?: boolean; claimUnknown?: boolean; authorizeFailure?: boolean; writeUnknown?: boolean; finalizeFailure?: boolean; finalThrow?: boolean; failThrow?: boolean; wrongSession?: boolean } = {}) {
  const events: string[] = [];
  const adapter: CoexistenceSyncPorts = {
    claim: async () => { events.push("claim"); if (options.claimUnknown) throw Error("claim-secret"); return options.claimConsumed ? { ok: false, code: "CONSUMED" } : options.wrongSession ? { ...claim, sessionId: "other" } : claim; },
    authorize: async () => { events.push("authorize"); return options.authorizeFailure ? { ok: false, code: "UNAVAILABLE" } : { ok: true, authorization }; },
    provider: async () => { events.push("provider"); return options.writeUnknown ? { ok: false, code: "RECONCILIATION_REQUIRED" } : { ok: true, requestId: "provider-request" }; },
    finalize: async () => { events.push("finalize"); if (options.finalThrow) throw Error("local-secret"); return options.finalizeFailure ? { ok: false, code: "UNAVAILABLE" } : { ok: true }; },
    fail: async () => { events.push("fail"); if (options.failThrow) throw Error("local-secret"); },
  };
  return { adapter, events };
}
describe("one-time coexistence sync", () => {
  it("requires durable owner claim and one-use authorization before the provider request", async () => {
    const p = ports(); expect(await requestCoexistenceSync(identity, input, config, p.adapter, () => now)).toEqual({ ok: true, status: "pending" }); expect(p.events).toEqual(["claim", "authorize", "provider", "finalize"]);
  });
  it("keeps default-off policy from claiming or requesting sync", async () => {
    const p = ports(); expect(await requestCoexistenceSync(identity, input, { ...config, enabled: false }, p.adapter, () => now)).toEqual({ ok: false, code: "NEEDS_SETUP" }); expect(p.events).toEqual([]);
  });
  it("requires explicit owner consent before even claiming", async () => {
    const p = ports(); expect(await requestCoexistenceSync(identity, { ...input, consent: false } as unknown as typeof input, config, p.adapter, () => now)).toEqual({ ok: false, code: "INVALID_INPUT" }); expect(p.events).toEqual([]);
  });
  it("does not repeat a consumed sync type", async () => {
    const p = ports({ claimConsumed: true }); expect(await requestCoexistenceSync(identity, input, config, p.adapter, () => now)).toEqual({ ok: false, code: "CONSUMED" }); expect(p.events).toEqual(["claim"]);
  });
  it("rejects a claim from another native session", async () => {
    const p = ports({ wrongSession: true }); expect(await requestCoexistenceSync(identity, input, config, p.adapter, () => now)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(p.events).toEqual(["claim"]);
  });
  it.each([{ claimUnknown: true }, { authorizeFailure: true }, { writeUnknown: true }, { finalizeFailure: true }, { finalThrow: true }, { finalThrow: true, failThrow: true }])("returns reconciliation for unknown local or provider outcomes without retry or client token", async options => {
    const p = ports(options); expect(await requestCoexistenceSync(identity, input, config, p.adapter, () => now)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" }); expect(p.events.filter(event => event === "provider").length).toBeLessThanOrEqual(1); expect(p.events.at(-1)).toBe("fail");
  });
  it("rejects the 24-hour deadline before requesting sync", async () => {
    const p = ports(); expect(await requestCoexistenceSync(identity, input, config, p.adapter, () => Date.parse(claim.deadlineAt))).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" }); expect(p.events).toEqual(["claim", "fail"]);
  });
  it("posts the documented one-time sync body and returns only a request ID", async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const http = async (url: string, init?: RequestInit) => { requests.push({ url, init }); return Response.json({ messaging_product: "whatsapp", request_id: "provider-request" }); };
    expect(await sendCoexistenceSyncRequest(config, authorization, http, () => now)).toEqual({ ok: true, requestId: "provider-request" });
    expect(requests).toHaveLength(1); expect(requests[0].url).toBe("https://graph.facebook.com/v25.0/12345/smb_app_data"); expect(requests[0].init?.method).toBe("POST"); expect(JSON.parse(String(requests[0].init?.body))).toEqual({ messaging_product: "whatsapp", sync_type: "history" });
  });
  it.each(["history", "smb_app_state_sync"] as const)("never retries a lost %s write", async syncType => {
    let calls = 0; const http = async () => { calls++; throw Error("token leak held-token"); };
    expect(await sendCoexistenceSyncRequest(config, { ...authorization, syncType }, http, () => now)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" }); expect(calls).toBe(1);
  });
  it("rejects expired token authorization before HTTP", async () => {
    let calls = 0; const http = async () => { calls++; return Response.json({}); };
    expect(await sendCoexistenceSyncRequest(config, { ...authorization, authorizationExpiresAt: new Date(now).toISOString() }, http, () => now)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" }); expect(calls).toBe(0);
  });
  it("does not treat HTTP 200 without a valid request ID as success", async () => {
    expect(await sendCoexistenceSyncRequest(config, authorization, async () => Response.json({ success: true }), () => now)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" });
  });
  it("uses separate owner and service RPC clients and persists request ID before returning pending", async () => {
    const calls: string[] = [];
    const common = { request_id: requestId, company_id: companyId, user_id: userId, session_id: sessionId, link_id: linkId, link_generation: 2, sync_type: "history", app_id: "111", graph_version: "v25.0", onboarded_at: claim.onboardedAt, deadline_at: claim.deadlineAt };
    const session = { rpc: async (name: string) => { calls.push(`owner:${name}`); return { error: null, data: { ok: true, ...common, stage: "claimed" } }; } };
    const admin = { rpc: async (name: string) => { calls.push(`service:${name}`); return { error: null, data: name.endsWith("authorize_sync") ? { ok: true, ...common, stage: "executing", access_token: "held-token", phone_number_id: "12345", authorization_expires_at: authorization.authorizationExpiresAt, authorization_non_expiring: false } : { ok: true, ...common, stage: "requested", provider_request_id: "provider-request" } }; } };
    const p = createCoexistenceSyncPorts(identity, input, config, session, admin, async () => Response.json({ messaging_product: "whatsapp", request_id: "provider-request" }), () => now);
    expect(await requestCoexistenceSync(identity, input, config, p, () => now)).toEqual({ ok: true, status: "pending" }); expect(calls).toEqual(["owner:whatsapp_coexistence_claim_sync", "service:whatsapp_coexistence_authorize_sync", "service:whatsapp_coexistence_finalize_sync"]);
  });
  it("binds a reauthenticated owner's new sync request to the current session throughout owner and service RPCs", async () => {
    const currentSession = "66666666-6666-4666-8666-666666666666";
    const currentIdentity = { ...identity, sessionId: currentSession };
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const common = { request_id: requestId, company_id: companyId, user_id: userId, session_id: currentSession, link_id: linkId, link_generation: 2, sync_type: "history", app_id: "111", graph_version: "v25.0", onboarded_at: claim.onboardedAt, deadline_at: claim.deadlineAt };
    const session = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { error: null, data: { ok: true, ...common, stage: "claimed" } }; } };
    const admin = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { error: null, data: name.endsWith("authorize_sync") ? { ok: true, ...common, stage: "executing", access_token: "held-token", phone_number_id: "12345", authorization_expires_at: authorization.authorizationExpiresAt, authorization_non_expiring: false } : { ok: true, ...common, stage: "requested", provider_request_id: "provider-request" } }; } };
    const adapter = createCoexistenceSyncPorts(currentIdentity, input, config, session, admin, async () => Response.json({ messaging_product: "whatsapp", request_id: "provider-request" }), () => now);
    expect(await requestCoexistenceSync(currentIdentity, input, config, adapter, () => now)).toEqual({ ok: true, status: "pending" });
    expect(calls.filter(call => call.name !== "whatsapp_coexistence_claim_sync").map(call => call.args.p_session_id)).toEqual([currentSession, currentSession]);
  });
  it("reads requested/declined/error state without inferring completed from provider acceptance", async () => {
    const client = { rpc: async () => ({ error: null, data: { ok: true, company_id: companyId, link_id: linkId, link_generation: 2, ai_enabled: false, syncs: [{ sync_type: "history", state: "failed", requested: true, declined: true, error_code: 2593109, provider_request_id: "provider-request" }, { sync_type: "smb_app_state_sync", state: "not_requested", requested: false, declined: false, error_code: null, provider_request_id: null }] } }) };
    expect(await readCoexistenceSyncStatus(client, companyId)).toMatchObject({ ok: true, syncs: [{ syncType: "history", state: "failed", declined: true, errorCode: 2593109 }, { syncType: "smb_app_state_sync", state: "not_requested" }] });
  });
  it.each([{ state: "completed", declined: true }, { state: "failed", declined: false }])("rejects contradictory decline or completion claims from a malformed status response", async override => {
    const client = { rpc: async () => ({ error: null, data: { ok: true, company_id: companyId, link_id: linkId, link_generation: 2, ai_enabled: false, syncs: [{ sync_type: "history", requested: true, error_code: 2593109, provider_request_id: "provider-request", ...override }, { sync_type: "smb_app_state_sync", state: "not_requested", requested: false, declined: false, error_code: null, provider_request_id: null }] } }) };
    expect(await readCoexistenceSyncStatus(client, companyId)).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});
