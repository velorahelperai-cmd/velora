import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { finishCoexistenceSignup } from "./flow";
import type { CoexistenceSignupPorts } from "./flow";

const identity = { companyId: "company", userId: "owner", sessionId: "session" };
const input = { attemptId: "attempt", nonce: "nonce", code: "ephemeral-code", wabaId: "222", confirmedPhoneNumber: "+96899001122" };
const config = { enabled: true, appId: "111", appSecret: "app-secret", systemUserToken: "system-secret", graphVersion: "v25.0", configId: "config" };
const claim = { ok: true as const, attempt_id: "attempt", company_id: "company", user_id: "owner", session_id: "session", app_id: "111", config_id: "config", graph_version: "v25.0", keep_on_phone: true as const, expected_phone_number: "+96899001122" };
const proof = { app_id: "111", waba_id: "222", phone_number_id: "333", display_phone_number: "+96899001122", scopes: ["whatsapp_business_management", "whatsapp_business_messaging"], granular_scopes: [], expires_at: 0, data_access_expires_at: 0, authorization_expires_at: null, is_on_biz_app: true as const, platform_type: "CLOUD_API" as const, subscribed: false as const, verified_at: "2027-01-15T00:00:00.000Z" };
function ports(options: { wrongClaim?: boolean; prepareFail?: boolean; prepareUnknown?: boolean; prepareThrow?: boolean; checkpointFail?: boolean; checkpointThrow?: boolean; subscribeFail?: boolean; subscribeThrow?: boolean; finalizeFail?: boolean; finalizeThrow?: boolean; failThrow?: boolean } = {}) {
  const events: string[] = [];
  let receivedInput: unknown;
  const adapter: CoexistenceSignupPorts = {
    claim: async () => { events.push("claim"); return options.wrongClaim ? { ...claim, company_id: "other" } : claim; },
    prepare: async supplied => { events.push("prepare"); receivedInput = supplied; if (options.prepareThrow) throw Error("exchange lost held-secret"); if (options.prepareUnknown) return { ok: false, code: "RECONCILIATION_REQUIRED" }; return options.prepareFail ? { ok: false, code: "META_ASSET_REJECTED" } : { ok: true, accessToken: "held-secret", proof }; },
    checkpoint: async (_claim, token, receivedProof) => { events.push("checkpoint"); expect(token).toBe("held-secret"); expect(receivedProof.subscribed).toBe(false); if (options.checkpointThrow) throw Error("local-secret"); return options.checkpointFail ? { ok: false, code: "UNAVAILABLE" } : { ok: true }; },
    subscribe: async () => { events.push("subscribe"); if (options.subscribeThrow) throw Error("provider-secret"); return options.subscribeFail ? { ok: false, code: "RECONCILIATION_REQUIRED" } : { ok: true, proof: { ...proof, subscribed: true } }; },
    finalize: async (_claim, receivedProof) => { events.push("finalize"); expect(receivedProof.subscribed).toBe(true); if (options.finalizeThrow) throw Error("database-secret"); return options.finalizeFail ? { ok: false, code: "UNAVAILABLE" } : { ok: true }; },
    fail: async code => { events.push(`fail:${code}`); if (options.failThrow) throw Error("record-secret"); },
  };
  return { adapter, events, receivedInput: () => receivedInput };
}
describe("durable coexistence signup orchestration", () => {
  it("checkpoints the token and proof before subscription and returns no secret", async () => {
    const p = ports();
    expect(await finishCoexistenceSignup(identity, input, config, p.adapter)).toEqual({ ok: true });
    expect(p.events).toEqual(["claim", "prepare", "checkpoint", "subscribe", "finalize"]);
    expect(p.receivedInput()).toEqual({ code: "ephemeral-code", wabaId: "222", confirmedPhoneNumber: "+96899001122" });
  });
  it("keeps disabled setup from even claiming an attempt", async () => {
    const p = ports(); expect(await finishCoexistenceSignup(identity, input, { ...config, enabled: false }, p.adapter)).toEqual({ ok: false, code: "NEEDS_SETUP" }); expect(p.events).toEqual([]);
  });
  it("rejects a claim from another tenant before provider calls", async () => {
    const p = ports({ wrongClaim: true }); expect(await finishCoexistenceSignup(identity, input, config, p.adapter)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(p.events).toEqual(["claim"]);
  });
  it.each(["+96899003344", "99001122", "", "+96899001122 ext 1"])("rejects a completion whose confirmed phone does not match the bound attempt", async confirmedPhoneNumber => {
    const p = ports(); expect(await finishCoexistenceSignup(identity, { ...input, confirmedPhoneNumber }, config, p.adapter)).toEqual({ ok: false, code: "FORBIDDEN" }); expect(p.events).toEqual(["claim"]);
  });
  it("normalizes formatting while passing only the attempt's server-held expected number", async () => {
    const p = ports(); expect(await finishCoexistenceSignup(identity, { ...input, confirmedPhoneNumber: "+968 (9900)-1122" }, config, p.adapter)).toEqual({ ok: true }); expect(p.receivedInput()).toMatchObject({ confirmedPhoneNumber: "+96899001122" });
  });
  it("records a verification failure without checkpoint or write", async () => {
    const p = ports({ prepareFail: true }); expect(await finishCoexistenceSignup(identity, input, config, p.adapter)).toEqual({ ok: false, code: "META_ASSET_REJECTED" }); expect(p.events).toEqual(["claim", "prepare", "fail:META_ASSET_REJECTED"]);
  });
  it.each([{ prepareUnknown: true }, { prepareThrow: true }, { prepareThrow: true, failThrow: true }])("persists reconciliation for uncertain code exchange without checkpoint, subscription or client token", async options => {
    const p = ports(options); expect(await finishCoexistenceSignup(identity, input, config, p.adapter)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" }); expect(p.events).toEqual(["claim", "prepare", "fail:RECONCILIATION_REQUIRED"]);
  });
  it.each([{ checkpointFail: true }, { checkpointThrow: true }])("never subscribes if durable checkpoint fails or is unknown", async options => {
    const p = ports(options); expect(await finishCoexistenceSignup(identity, input, config, p.adapter)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" }); expect(p.events).toEqual(["claim", "prepare", "checkpoint", "fail:RECONCILIATION_REQUIRED"]);
  });
  it.each([{ subscribeFail: true }, { subscribeThrow: true }, { finalizeFail: true }, { finalizeThrow: true }])("marks reconciliation after an unknown write or failed local finalization without retry", async options => {
    const p = ports(options); expect(await finishCoexistenceSignup(identity, input, config, p.adapter)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" }); expect(p.events.filter(event => event === "subscribe")).toHaveLength(1); expect(p.events.at(-1)).toBe("fail:RECONCILIATION_REQUIRED");
  });
  it("does not leak an error when reconciliation persistence also fails", async () => {
    const p = ports({ finalizeThrow: true, failThrow: true }); expect(await finishCoexistenceSignup(identity, input, config, p.adapter)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" }); expect(p.events.filter(event => event === "subscribe")).toHaveLength(1);
  });
});
