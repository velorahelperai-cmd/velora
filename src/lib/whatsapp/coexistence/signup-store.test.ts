import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./provider", () => ({ prepareCoexistenceSignup: vi.fn(), subscribeAndVerifyCoexistence: vi.fn() }));
import { createCoexistenceSignupPorts, readCoexistenceSignupReadiness, startCoexistenceSignupStore, readCoexistenceSignupStatus, disconnectCoexistenceSignupStore, cancelCoexistenceSignupStore } from "./signup-store";
const companyId = "10000000-0000-4000-8000-000000000001";
const identity = { companyId, userId: "10000000-0000-4000-8000-000000000002", sessionId: "10000000-0000-4000-8000-000000000003" };
const input = { attemptId: "10000000-0000-4000-8000-000000000004", nonce: "a".repeat(64), code: "exchange-only", confirmedPhoneNumber: "+96890000000" };
const config = { enabled: true, appId: "123", configId: "456", graphVersion: "v25.0", appSecret: "private", systemUserToken: "private" };
const claim = { ok: true as const, attempt_id: input.attemptId, company_id: companyId, user_id: identity.userId, session_id: identity.sessionId,
  app_id: config.appId, config_id: config.configId, graph_version: config.graphVersion, keep_on_phone: true as const, expected_phone_number: "+96890000000" };
const proof = { app_id: "123", waba_id: "789", phone_number_id: "987", display_phone_number: "968 9000 0000", scopes: ["whatsapp_business_management", "whatsapp_business_messaging"],
  granular_scopes: [{ scope: "whatsapp_business_management", target_ids: ["789"] }, { scope: "whatsapp_business_messaging", target_ids: ["789"] }],
  expires_at: 0, data_access_expires_at: 0, authorization_expires_at: null, platform_type: "CLOUD_API" as const, is_on_biz_app: true as const, subscribed: false as const, verified_at: "2026-10-12T00:00:00.000Z" };
const db = (data: unknown) => ({ rpc: vi.fn().mockResolvedValue({ data, error: null }) });
const ports = (session: ReturnType<typeof db>, admin = session) => createCoexistenceSignupPorts(identity, input, config, session, admin);

describe("coexistence signup persistence contracts", () => {
  it("does not infer installed coexistence support from generic readiness", async () => {
    expect(await readCoexistenceSignupReadiness(db({ ok: true }), companyId)).toEqual({ ok: false, code: "NEEDS_SETUP" });
    const ready = { ok: true, version: "coexistence_signup_v1", connection_mode_contract: "coexistence_binding_v1", company_id: companyId, history_enabled: false, ai_enabled: false };
    expect(await readCoexistenceSignupReadiness(db(ready), companyId)).toEqual({ ok: true, installed: true, historyEnabled: false, aiEnabled: false });
    expect(await readCoexistenceSignupReadiness(db({ ...ready, connection_mode_contract: undefined }), companyId)).toEqual({ ok: false, code: "NEEDS_SETUP" });
  });
  it("returns only the exact claimed session/config/phone binding", async () => {
    expect(await ports(db({ ...claim, access_token: "private" })).claim()).toEqual(claim);
  });
  it.each([{ company_id: "other" }, { session_id: "other" }, { keep_on_phone: false }, { expected_phone_number: "96890000000" }, { config_id: "other" }])("rejects unbound claim %j", async patch => {
    expect(await ports(db({ ...claim, ...patch })).claim()).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("requires durable Vault checkpoint attestation before reporting success", async () => {
    const session = db(claim), admin = db({ ok: true, attempt_id: input.attemptId, company_id: companyId, user_id: identity.userId, session_id: identity.sessionId, status: "token_checkpointed", token_checkpointed: true });
    expect(await ports(session, admin).checkpoint(claim, "private-token", proof)).toEqual({ ok: true });
    expect(admin.rpc).toHaveBeenCalledExactlyOnceWith("whatsapp_coexistence_checkpoint_signup", { p_attempt_id: input.attemptId, p_user_id: identity.userId, p_session_id: identity.sessionId, p_access_token: "private-token", p_proof: proof });
    expect(await ports(session, db({ ok: true })).checkpoint(claim, "private-token", proof)).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("does not retry ambiguous checkpoint transport failure or expose private diagnostics", async () => {
    const admin = db(null); admin.rpc.mockRejectedValue(new Error("private token"));
    expect(await ports(db(claim), admin).checkpoint(claim, "private-token", proof)).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(admin.rpc).toHaveBeenCalledTimes(1);
  });
  it("requires completed exact binding with AI/history disabled from finalize", async () => {
    const final = { ok: true, attempt_id: input.attemptId, company_id: companyId, user_id: identity.userId, session_id: identity.sessionId, status: "completed", history_enabled: false, ai_enabled: false };
    expect(await ports(db(claim), db(final)).finalize(claim, { ...proof, subscribed: true })).toEqual({ ok: true });
    expect(await ports(db(claim), db({ ...final, ai_enabled: true })).finalize(claim, { ...proof, subscribed: true })).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("starts only a confirmed coexistence number and strips unrelated secrets", async () => {
    const start = { companyId, attemptId: input.attemptId, nonce: input.nonce, expectedPhoneNumber: "+96890000000", appId: "123", configId: "456", graphVersion: "v25.0", keepOnPhone: true as const };
    const server = db({ ok: true, company_id: companyId, attempt_id: input.attemptId, nonce: input.nonce, expected_phone_number: start.expectedPhoneNumber, expires_at: "2026-10-12T01:00:00.000Z", access_token: "private" });
    expect(await startCoexistenceSignupStore(server, start)).toEqual({ ok: true, attemptId: input.attemptId, nonce: input.nonce, expiresAt: "2026-10-12T01:00:00.000Z" });
    const invalid = db(null);
    expect(await startCoexistenceSignupStore(invalid, { ...start, keepOnPhone: false } as never)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(invalid.rpc).not.toHaveBeenCalled();
  });
  it("maps persisted reconciliation status without tokens or a synthetic resume", async () => {
    const server = db({ ok: true, company_id: companyId, attempt_id: input.attemptId, status: "reconcile_required", expected_phone_number: "+96890000000", expires_at: "2026-10-12T01:00:00.000Z", connection_status: "not_connected", link_id: null, link_generation: null, display_phone_number: null, live_verified: false, history_sync_status: "not_requested", history_status: "disabled", ai_enabled: false, last_error_code: "RECONCILIATION_REQUIRED", access_token: "private" });
    expect(await readCoexistenceSignupStatus(server, companyId)).toEqual({ ok: true, companyId, attemptId: input.attemptId, status: "reconcile_required", expectedPhoneNumber: "+96890000000", expiresAt: "2026-10-12T01:00:00.000Z", connectionStatus: "not_connected", linkId: null, linkGeneration: null, displayPhoneNumber: null, liveVerified: false, historySyncStatus: "not_requested", historyStatus: "disabled", aiEnabled: false, lastErrorCode: "RECONCILIATION_REQUIRED" });
  });
  it("cancel preserves the consumed-attempt reconciliation boundary", async () => {
    const server = db({ ok: false, code: "RECONCILIATION_REQUIRED", pending_secret_id: "private" });
    expect(await cancelCoexistenceSignupStore(server, companyId, input.attemptId, input.nonce)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" });
    expect(server.rpc).toHaveBeenCalledExactlyOnceWith("whatsapp_coexistence_cancel_signup", { p_company_id: companyId, p_attempt_id: input.attemptId, p_nonce: input.nonce });
    expect(await cancelCoexistenceSignupStore(db({ ok: true, company_id: companyId, attempt_id: input.attemptId, cancelled: true }), companyId, input.attemptId, input.nonce)).toEqual({ ok: true });
  });
  it("rejects unproven live or history status instead of showing a verified connection", async () => {
    const status = { ok: true, company_id: companyId, attempt_id: input.attemptId, status: "claimed", expected_phone_number: "+96890000000", expires_at: "2026-10-12T01:00:00.000Z", connection_status: "not_connected", link_id: null, link_generation: null, display_phone_number: null, live_verified: false, history_sync_status: "not_requested", history_status: "disabled", ai_enabled: false, last_error_code: null };
    for (const patch of [{ live_verified: true }, { display_phone_number: "+96890000000" }, { history_sync_status: "invented" }, { connection_status: "active", live_verified: true }]) {
      expect(await readCoexistenceSignupStatus(db({ ...status, ...patch }), companyId)).toEqual({ ok: false, code: "UNAVAILABLE" });
    }
  });
  it("requires bound local-disconnect acknowledgement without provider mutation", async () => {
    const server = db({ ok: true, company_id: companyId, disconnected: true, history_enabled: false, ai_enabled: false });
    expect(await disconnectCoexistenceSignupStore(server, companyId)).toEqual({ ok: true });
    expect(server.rpc).toHaveBeenCalledExactlyOnceWith("whatsapp_coexistence_disconnect", { p_company_id: companyId });
  });
  it("allowlists failures and never returns SQL diagnostics", async () => {
    expect(await ports(db({ ok: false, code: "CONSUMED", access_token: "private" })).claim()).toEqual({ ok: false, code: "CONSUMED" });
    expect(await ports(db({ ok: false, code: "private diagnostic" })).claim()).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});
