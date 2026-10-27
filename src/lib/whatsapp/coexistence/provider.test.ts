import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { prepareCoexistenceSignup, subscribeAndVerifyCoexistence } from "./provider";

const now = 1_800_000_000;
const config = { enabled: true, appId: "111", appSecret: "app-secret", systemUserToken: "system-secret", graphVersion: "v25.0" };
const scopes = ["whatsapp_business_management", "whatsapp_business_messaging"];
const debug = { app_id: "111", is_valid: true, expires_at: now + 600, data_access_expires_at: now + 900, scopes, granular_scopes: scopes.map(scope => ({ scope, target_ids: ["222"] })) };
const phone = { id: "333", display_phone_number: "+968 9900 1122", is_on_biz_app: true, platform_type: "CLOUD_API" };
const input = { code: "ephemeral-code", wabaId: "222", confirmedPhoneNumber: "+96899001122" };
function fake(options: { invalidDebug?: boolean; debugReadFails?: boolean; secondPage?: boolean; paginationLoop?: boolean; phoneOverride?: Record<string, unknown>; finalPhoneOverride?: Record<string, unknown>; unknownWrite?: boolean; deniedWrite?: boolean; missingApp?: boolean; finalRevoked?: boolean; firstReadFails?: boolean } = {}) {
  const requests: { path: string; method: string; url: URL; init?: RequestInit }[] = [];
  let debugReads = 0;
  let phoneReads = 0;
  const http = async (url: string, init?: RequestInit) => {
    const parsed = new URL(url), path = parsed.pathname.replace(/^\/v\d+\.0\//, "");
    requests.push({ path, method: init?.method ?? "GET", url: parsed, init });
    if (options.firstReadFails) throw new Error("transport leak app-secret");
    if (init?.method === "POST") {
      if (path !== "222/subscribed_apps") throw new Error("forbidden provider write");
      if (options.unknownWrite) throw new Error("timeout leaked access-secret");
      return options.deniedWrite ? Response.json({ error: { message: "secret" } }, { status: 403 }) : Response.json({ success: true });
    }
    if (path === "oauth/access_token") return Response.json({ access_token: "access-secret" });
    if (path === "debug_token") { if (options.debugReadFails) throw Error("network leaked access-secret"); debugReads++; return Response.json({ data: { ...debug, is_valid: !(options.invalidDebug || (options.finalRevoked && debugReads > 1)) } }); }
    if (path === "222") return Response.json({ id: "222" });
    if (path === "222/phone_numbers") {
      if (options.paginationLoop) return Response.json({ data: [{ id: "444", display_phone_number: "+96899003344" }], paging: { next: "https://untrusted.invalid/do-not-follow", cursors: { after: "repeated" } } });
      if (options.secondPage && !parsed.searchParams.has("after")) return Response.json({ data: [{ id: "444", display_phone_number: "+96899003344" }], paging: { next: "https://untrusted.invalid/do-not-follow", cursors: { after: "page-2" } } });
      return Response.json({ data: [{ id: phone.id, display_phone_number: phone.display_phone_number, platform_type: phone.platform_type }] });
    }
    if (path === "333") { phoneReads++; return Response.json({ ...phone, ...options.phoneOverride, ...(phoneReads > 1 ? options.finalPhoneOverride : {}) }); }
    if (path === "222/subscribed_apps") return Response.json({ data: [{ whatsapp_business_api_data: { id: options.missingApp ? "999" : "111" } }] });
    throw new Error(`unexpected provider request ${path}`);
  };
  return { http, requests, writes: () => requests.filter(request => request.method === "POST") };
}

describe("coexistence provider", () => {
  it('derives app-only debug authorization without a system user token',async()=>{const f=fake();const {systemUserToken:_unused,...appConfig}=config;const result=await prepareCoexistenceSignup(appConfig,input,f.http,()=>now);expect(result.ok).toBe(true);const request=f.requests.find(r=>r.path==='debug_token')!;expect((request.init?.headers as Record<string,string>).Authorization).toBe('Bearer 111|app-secret');expect(JSON.stringify(result)).not.toContain('111|app-secret');});
  it("exchanges the code server-side and discovers the exact confirmed phone across complete pages", async () => {
    const f = fake({ secondPage: true });
    const result = await prepareCoexistenceSignup(config, input, f.http, () => now);
    expect(result).toMatchObject({ ok: true, accessToken: "access-secret", proof: { app_id: "111", waba_id: "222", phone_number_id: "333", display_phone_number: "+96899001122", is_on_biz_app: true, platform_type: "CLOUD_API", subscribed: false } });
    expect(f.writes()).toHaveLength(0);
    const exchange = f.requests.find(request => request.path === "oauth/access_token")!;
    expect(exchange.url.searchParams.get("client_secret")).toBe("app-secret");
    expect(exchange.url.searchParams.get("code")).toBe("ephemeral-code");
    expect(f.requests.every(request => request.url.origin === "https://graph.facebook.com")).toBe(true);
    expect(f.requests.filter(request => request.path === "222/phone_numbers")).toHaveLength(2);
  });
  it("supports the exact explicit phone ID while still enforcing the claimed confirmed number", async () => {
    const f = fake();
    expect(await prepareCoexistenceSignup(config, { ...input, phoneNumberId: "333" }, f.http, () => now)).toMatchObject({ ok: true });
    expect(await prepareCoexistenceSignup(config, { ...input, phoneNumberId: "333", confirmedPhoneNumber: "+96899003344" }, f.http, () => now)).toEqual({ ok: false, code: "META_ASSET_REJECTED" });
  });
  it("does not run any provider request when setup is gated", async () => {
    const f = fake();
    expect(await prepareCoexistenceSignup({ ...config, enabled: false }, input, f.http, () => now)).toEqual({ ok: false, code: "NEEDS_SETUP" });
    expect(f.requests).toHaveLength(0);
  });
  it("rejects malformed input before exchanging a code", async () => {
    const f = fake();
    expect(await prepareCoexistenceSignup(config, { ...input, confirmedPhoneNumber: "99001122" }, f.http, () => now)).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(f.requests).toHaveLength(0);
  });
  it("rejects invalid server token authorization before account reads or writes", async () => {
    const f = fake({ invalidDebug: true });
    expect(await prepareCoexistenceSignup(config, input, f.http, () => now)).toEqual({ ok: false, code: "META_AUTHORIZATION_REJECTED" });
    expect(f.requests.map(request => request.path)).toEqual(["oauth/access_token", "debug_token"]);
  });
  it.each([{ is_on_biz_app: false }, { platform_type: "ON_PREMISE" }, { id: "999" }])("rejects a direct phone read which does not prove the selected coexistence asset", async phoneOverride => {
    const f = fake({ phoneOverride });
    expect(await prepareCoexistenceSignup(config, input, f.http, () => now)).toEqual({ ok: false, code: "META_ASSET_REJECTED" });
    expect(f.writes()).toHaveLength(0);
  });
  it("rejects incomplete looping pagination without writes", async () => {
    const f = fake({ paginationLoop: true });
    expect(await prepareCoexistenceSignup(config, input, f.http, () => now)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" });
    expect(f.writes()).toHaveLength(0);
  });
  it("treats a lost code-exchange response as uncertain external authorization without retry or token exposure", async () => {
    const f = fake({ firstReadFails: true });
    expect(await prepareCoexistenceSignup(config, input, f.http, () => now)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" });
    expect(f.requests.map(request => request.path)).toEqual(["oauth/access_token"]);
    expect(f.writes()).toHaveLength(0);
  });
  it("requires reconciliation if authorization exchanged successfully but debug verification transport fails", async () => {
    const f = fake({ debugReadFails: true });
    expect(await prepareCoexistenceSignup(config, input, f.http, () => now)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" });
    expect(f.requests.map(request => request.path)).toEqual(["oauth/access_token", "debug_token"]);
    expect(f.writes()).toHaveLength(0);
  });
  it("subscribes once and reads back app, phone, and token authorization without registration", async () => {
    const f = fake();
    const prepared = await prepareCoexistenceSignup(config, input, f.http, () => now);
    expect(prepared.ok).toBe(true); if (!prepared.ok) return;
    expect(await subscribeAndVerifyCoexistence(config, prepared, f.http, () => now)).toMatchObject({ ok: true, proof: { subscribed: true, is_on_biz_app: true, phone_number_id: "333" } });
    expect(f.writes().map(request => request.path)).toEqual(["222/subscribed_apps"]);
    expect(f.requests.some(request => /register|deregister/.test(request.path))).toBe(false);
  });
  it.each([{ unknownWrite: true }, { deniedWrite: true }, { missingApp: true }, { finalRevoked: true }, { finalPhoneOverride: { is_on_biz_app: false } }, { finalPhoneOverride: { display_phone_number: "+96899003344" } }])("returns reconciliation on uncertain write or failed readback without retry", async options => {
    const f = fake(options);
    const prepared = await prepareCoexistenceSignup(config, input, f.http, () => now);
    expect(prepared.ok).toBe(true); if (!prepared.ok) return;
    expect(await subscribeAndVerifyCoexistence(config, prepared, f.http, () => now)).toEqual({ ok: false, code: "RECONCILIATION_REQUIRED" });
    expect(f.writes()).toHaveLength(1);
  });
});
