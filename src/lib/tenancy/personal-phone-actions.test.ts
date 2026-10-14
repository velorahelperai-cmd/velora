import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ client: vi.fn(), rpc: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), verifyOtp: vi.fn() }));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: f.client }));
vi.mock("@/lib/auth/session-guard", () => ({ checkAppSession: async () => ({ ok: true, expiresAt: "2030-01-01T00:00:00Z" }) }));
vi.mock("./personal-phone-hook-config",()=>({personalPhoneSmsRuntimeConfigured:()=>process.env.VELORA_PERSONAL_PHONE_SMS_APPROVED==="true"}));
import { sendPersonalPhoneCode, verifyPersonalPhoneCode, getPersonalPhoneStatus } from "./personal-phone-actions";
const actor = "f1000000-0000-4000-8000-000000000001", intent = "f2000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();vi.stubEnv("VELORA_PERSONAL_PHONE_SMS_APPROVED",undefined);vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED","true");
  f.client.mockResolvedValue({ rpc: f.rpc, auth: { getUser: f.getUser, updateUser: f.updateUser, verifyOtp: f.verifyOtp } });
  f.getUser.mockResolvedValue({ data: { user: { id: actor, email_confirmed_at: "confirmed" } }, error: null });
  f.updateUser.mockResolvedValue({ data: {}, error: null }); f.verifyOtp.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  f.rpc.mockImplementation(async name => ({ error: null, data: name === "master_reserve_personal_phone"
    ? { ok: true, data: { intentId: intent, phone: "+96891234567", executeProvider: true } }
    : name === "master_claim_personal_phone_verify" ? { ok: true, data: { intentId: intent, phone: "+96891234567", leaseId: actor } }
      : { ok: true, data: { verified: true } } }));
});
afterEach(()=>vi.unstubAllEnvs());
describe("actual Supabase phone adapter without provider execution", () => {
  it("default-off rollout prevents status or provider paths before client creation",async()=>{
    vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED",undefined);vi.stubEnv("VELORA_PERSONAL_PHONE_SMS_APPROVED","true");
    expect(await getPersonalPhoneStatus(actor)).toEqual({ok:false,code:"UNCONFIGURED"});
    expect(await sendPersonalPhoneCode({expectedUserId:actor,phone:"+96891234567",requestKey:intent})).toEqual({ok:false,code:"UNCONFIGURED"});
    expect(await verifyPersonalPhoneCode({expectedUserId:actor,intentId:intent,code:"123456"})).toEqual({ok:false,code:"UNCONFIGURED"});expect(f.client).not.toHaveBeenCalled();
  });
  it("approval absent stops before client creation", async () => {
    expect(await sendPersonalPhoneCode({ expectedUserId: actor, phone: "+96891234567", requestKey: intent })).toEqual({ ok: false, code: "UNCONFIGURED" });
    expect(await verifyPersonalPhoneCode({ expectedUserId: actor, intentId: intent, code: "123456" })).toEqual({ ok: false, code: "UNCONFIGURED" });
    expect(f.client).not.toHaveBeenCalled();
  });
  it("enrolls in the current Auth user and verifies only phone_change", async () => {
    vi.stubEnv("VELORA_PERSONAL_PHONE_SMS_APPROVED","true");
    await sendPersonalPhoneCode({ expectedUserId: actor, phone: "+96891234567", requestKey: intent });
    expect(f.updateUser).toHaveBeenCalledWith({ phone: "+96891234567" });
    await verifyPersonalPhoneCode({ expectedUserId: actor, intentId: intent, code: "123456" });
    expect(f.verifyOtp).toHaveBeenCalledWith({ phone: "+96891234567", token: "123456", type: "phone_change" });
  });
  it("rejects status responses for a different account and keeps disabled config explicit", async () => {
    f.rpc.mockResolvedValue({ error: null, data: { ok: true, data: { userId: "other", emailVerified: true, phoneVerified: true, phoneMasked: "••••4567", configuration: "CONFIGURED", intent: null } } });
    expect(await getPersonalPhoneStatus(actor)).toEqual({ ok: false, code: "UNAVAILABLE" });
    f.rpc.mockResolvedValue({ error: null, data: { ok: true, data: { userId: actor, emailVerified: true, phoneVerified: false, phoneMasked: null, configuration: "CONFIGURED", intent: null } } });
    expect(await getPersonalPhoneStatus(actor)).toMatchObject({ ok: true, data: { configuration: "UNCONFIGURED" } });
  });
  it("routes unconfirmed email safely without an identity-protected status RPC", async () => {
    f.getUser.mockResolvedValue({ data: { user: { id: actor, phone_confirmed_at: "confirmed", email_confirmed_at: null } }, error: null });
    expect(await getPersonalPhoneStatus(actor)).toEqual({ ok: false, code: "EMAIL_REQUIRED" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("finalizes using the fresh Auth cookies installed by phone_change verification", async () => {
    vi.stubEnv("VELORA_PERSONAL_PHONE_SMS_APPROVED","true");
    let cookieSession = "original-session";
    f.verifyOtp.mockImplementation(async () => { cookieSession = "fresh-native-session";return {data:{user:{id:actor},session:{user:{id:actor}}},error:null}; });
    f.rpc.mockImplementation(async name => ({error:null,data:name === "master_claim_personal_phone_verify"
      ? {ok:true,data:{intentId:intent,phone:"+96891234567",leaseId:actor}}
      : name === "master_finish_personal_phone_verify" && cookieSession === "fresh-native-session"
        ? {ok:true,data:{verified:true}} : {ok:false,code:"UNAUTHENTICATED"}}));
    expect(await verifyPersonalPhoneCode({expectedUserId:actor,intentId:intent,code:"123456"})).toMatchObject({ok:true,data:{verified:true}});
  });
});
