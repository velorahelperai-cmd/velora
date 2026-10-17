import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  client: vi.fn(),
  bound: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
  serverRpc: vi.fn(),
  user: vi.fn(),
  claims: vi.fn(),
  send: vi.fn(),
  update: vi.fn(),
  verify: vi.fn(),
  logout: vi.fn(),
  fence: vi.fn(),
  abandon: vi.fn(),
  reserveIntent: vi.fn(),
  sync: vi.fn(),
  expire: vi.fn(),
  inventory: vi.fn(),
  mark: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: f.client, createBrokerBoundClient: f.bound }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: f.admin }));
vi.mock("@/lib/auth/session-guard", () => ({ checkAppSession: async () => ({ ok: true }) }));
vi.mock("./personal-phone-hook-config", () => ({ personalPhoneSmsRuntimeConfigured: () => process.env.VELORA_PERSONAL_PHONE_SMS_APPROVED === "true" }));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseEnv: () => ({ ok: true, url: "http://127.0.0.1:3730" }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { admin: { signOut: vi.fn() } } }) }));
vi.mock("@/lib/auth/broker/registry", () => ({ listActiveSessionsForUser: f.inventory, markSessionStatus: f.mark }));
vi.mock("@/lib/auth/broker/cookies", () => ({ expireHandleCookie: vi.fn() }));
vi.mock("@/lib/auth/broker/log", () => ({ brokerLog: vi.fn() }));
vi.mock("@/lib/auth/broker", () => ({
  syncBrokerAfterAuthMutation: f.sync,
  beginAuthMutationFence: f.fence,
  abandonAuthMutationFence: f.abandon,
  reserveBoundMutationIntent: f.reserveIntent,
  brokerExpireCapturedHandle: f.expire,
}));
import { beginPersonalPhoneChangeAction, readPersonalPhoneChangeStatus, verifyPhoneChangeStepAction } from "./personal-phone-change-actions";
const uid = "b1000000-0000-4000-8000-000000000001",
  intent = "b1000000-0000-4000-8000-000000000002",
  lease = "b1000000-0000-4000-8000-000000000003",
  sid = "b1000000-0000-4000-8000-000000000004";
const writer = { set: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED", "true");
  vi.stubEnv("VELORA_PERSONAL_PHONE_SMS_APPROVED", "true");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-only");
  const client = {
    rpc: f.rpc,
    auth: {
      getUser: f.user,
      getClaims: f.claims,
      signInWithOtp: f.send,
      updateUser: f.update,
      verifyOtp: f.verify,
      signOut: f.logout,
    },
  };
  f.bound.mockResolvedValue({
    bound: {
      ok: true,
      client,
      resolve: {
        boundary: {
          userId: uid,
          nativeSessionId: sid,
          boundaryFingerprint: "abcd1234efgh5678",
          generation: "generation-a",
        },
      },
    },
    writer,
    reader: { getAll: () => [] },
  });
  f.client.mockResolvedValue(client);
  f.admin.mockReturnValue({ rpc: f.serverRpc });
  f.user.mockResolvedValue({ data: { user: { id: uid, email_confirmed_at: "native" } }, error: null });
  f.send.mockResolvedValue({ error: null });
  f.logout.mockResolvedValue({ error: null });
  f.fence.mockResolvedValue({ ok: true, leaseToken: "synthetic-lease" });
  f.abandon.mockResolvedValue({ ok: true });
  f.reserveIntent.mockResolvedValue({
    ok: true,
    intentId: "b1000000-0000-4000-8000-000000000005",
    bootstrapHash: "synthetic-root",
  });
  f.sync.mockResolvedValue({ ok: true });
  f.expire.mockResolvedValue({ ok: true });
  f.inventory.mockResolvedValue({ ok: true, sessions: [], legacyCoverage: "complete" });
  f.rpc.mockImplementation(async (name) => ({
    error: null,
    data: {
      ok: true,
      data:
        name === "master_claim_phone_change_verify"
          ? { intentId: intent, leaseId: lease, phone: "+96891234567", step: "old" }
          : { intentId: intent, changeId: lease, phone: "+96891234567", executeProvider: true },
    },
  }));
  f.verify.mockResolvedValue({
    error: null,
    data: {
      user: { id: uid, phone: "96891234567" },
      session: {
        access_token: `e30.${Buffer.from(JSON.stringify({ session_id: sid })).toString("base64url")}.offline`,
        refresh_token: "synthetic-refresh",
        user: { id: uid },
      },
    },
  });
  f.serverRpc.mockResolvedValue({ error: null, data: { ok: true, data: { step: "old_verified" } } });
});
afterEach(() => vi.unstubAllEnvs());
it("default-off rollout is inert before Auth or service access", async () => {
  vi.stubEnv("VELORA_MASTER_JOURNEY_ENABLED", undefined);
  expect(
    await beginPersonalPhoneChangeAction({ expectedUserId: uid, newPhone: "+96892345678", requestKey: lease }),
  ).toMatchObject({ ok: false, code: "UNCONFIGURED" });
  expect(f.client).not.toHaveBeenCalled();
  expect(f.bound).not.toHaveBeenCalled();
  expect(f.admin).not.toHaveBeenCalled();
});
it("old-phone sends disable account creation and use SMS only", async () => {
  await beginPersonalPhoneChangeAction({ expectedUserId: uid, newPhone: "+96892345678", requestKey: lease });
  expect(f.send).toHaveBeenCalledWith({
    phone: "+96891234567",
    options: { shouldCreateUser: false, channel: "sms" },
  });
  expect(f.update).not.toHaveBeenCalled();
});
it("native sms response and fresh cookies finalize only through the server service port", async () => {
  await verifyPhoneChangeStepAction({ expectedUserId: uid, intentId: intent, code: "123456" });
  expect(f.fence).toHaveBeenCalled();
  expect(f.reserveIntent).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: "phone_change_verify" }),
  );
  expect(f.verify).toHaveBeenCalledWith({ phone: "+96891234567", token: "123456", type: "sms" });
  expect(f.sync).toHaveBeenCalled();
  expect(f.serverRpc).toHaveBeenCalledWith("master_finish_phone_change_verify", {
    p_user_id: uid,
    p_intent_id: intent,
    p_lease_id: lease,
    p_verified_session_id: sid,
  });
  expect(f.verify.mock.invocationCallOrder[0]).toBeLessThan(f.serverRpc.mock.invocationCallOrder[0]);
});
it("an unexpected native account session expires the capture without attesting old proof", async () => {
  f.verify.mockResolvedValue({
    error: null,
    data: { user: { id: lease, phone: "96891234567" }, session: { access_token: "opaque" } },
  });
  expect(await verifyPhoneChangeStepAction({ expectedUserId: uid, intentId: intent, code: "123456" })).toMatchObject({
    ok: false,
    code: "UNAUTHENTICATED",
  });
  expect(f.expire).toHaveBeenCalled();
  expect(f.logout).not.toHaveBeenCalled();
  expect(f.admin).not.toHaveBeenCalled();
  expect(f.serverRpc).not.toHaveBeenCalled();
});
it("saved new-phone confirmation can reconcile only from verified current native claims through service authority", async () => {
  f.claims.mockResolvedValue({ error: null, data: { claims: { sub: uid, session_id: sid } } });
  f.rpc.mockResolvedValue({
    error: null,
    data: { ok: true, data: { userId: uid, configuration: "CONFIGURED", change: null } },
  });
  await readPersonalPhoneChangeStatus(uid);
  expect(f.serverRpc).toHaveBeenCalledWith("master_reconcile_phone_change_native", {
    p_user_id: uid,
    p_verified_session_id: sid,
  });
  expect(f.verify).not.toHaveBeenCalled();
});
it("unverified or foreign claims cannot reconcile a native transition", async () => {
  f.claims.mockResolvedValue({ error: null, data: { claims: { sub: lease, session_id: sid } } });
  await readPersonalPhoneChangeStatus(uid);
  expect(f.serverRpc).not.toHaveBeenCalled();
});
