import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), adminRpc: vi.fn(), open: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.adminRpc }) }));
vi.mock("./sandbox-checkout", () => ({ openAccountSandboxCheckout: mocks.open }));
import { beginAccountTestCheckout } from "./account-checkout";
import { resolveEs02Offer } from "./commercial-offer";

const accountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const selection = { term: "monthly" as const, slots: [{ persona: "level_1" as const, package: "basic" as const }] };
const input = { accountId, sessionId: "11111111-2222-4333-8444-555555555555", clientOpId: "12121212-3434-4656-8787-909090909090", selection, preparation: { name: "Test", type: "retail", country: "OM", city: "Muscat", phone: "+96890000000", branches: [{ name: "Main", city: "Muscat" }] } };
const resolved = resolveEs02Offer(selection);
if (!resolved.ok) throw new Error("fixture");
const order = { orderId: input.clientOpId, accountId, status: "open", offer: resolved.offer, specialReference: "ES02-fixture", paymentAttemptId: input.sessionId, environment: "test", settledAt: null, provisionedCompanyId: null, originalOrderGroupId: input.clientOpId };
describe("account payment initiation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    const env = { BILLING_ES02_PAYMOB_TEST_ENABLED: "true", PAYMOB_HOSTED_TEST_ACCOUNT_ID: accountId, BILLING_PAYMOB_CREATE_ENABLED: "true", BILLING_PAYMOB_WEBHOOK_ENABLED: "true", BILLING_PAYMOB_SETTLE_ENABLED: "true", PAYMOB_SECRET_KEY_TEST: "om_sk_test_fixture", PAYMOB_PUBLIC_KEY_TEST: "om_pk_test_fixture", PAYMOB_HMAC_SECRET: "fixture", PAYMOB_INTEGRATION_ID_TEST: "123", PAYMOB_MERCHANT_OWNER_ID: "456", PAYMOB_OMR_CONVERSION_VERIFIED: "true", PAYMOB_OMR_UNITS_PER_OMR: "1000", NEXT_PUBLIC_SITE_URL: "https://www.velorahelper.com", BILLING_PAYMOB_LIVE_ENABLED: "false", PAYMOB_LIVE_ENABLED: "false" };
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    mocks.rpc.mockResolvedValue({ data: { ok: true, action: "insert", data: order }, error: null });
    mocks.open.mockResolvedValue({ ok: true, url: "https://om.checkout.paymob.com/?publicKey=om_pk_test_fixture&clientSecret=pi_test_fixture" });
  });
  it("persists account, choice, consent and preparation before provider execution", async () => {
    const result = await beginAccountTestCheckout(input);
    expect(result).toMatchObject({ ok: true, data: { order: { orderId: order.orderId }, checkoutUrl: expect.stringContaining("https://om.checkout.paymob.com/") } });
    expect(mocks.rpc).toHaveBeenCalledWith("es02_begin_test_checkout", expect.objectContaining({ p_expected_account_id: accountId, p_client_op_id: input.clientOpId, p_term: "monthly", p_slots: selection.slots, p_preparation: input.preparation, p_consent_accepted: true }));
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.open.mock.invocationCallOrder[0]!);
  });
  it.each(["off", "foreign", "live", "missing_keys", "wrong_origin"])("blocks %s before any write", async (mode) => {
    if (mode === "off") vi.stubEnv("BILLING_ES02_PAYMOB_TEST_ENABLED", "false");
    if (mode === "foreign") vi.stubEnv("PAYMOB_HOSTED_TEST_ACCOUNT_ID", input.sessionId);
    if (mode === "live") vi.stubEnv("PAYMOB_LIVE_ENABLED", "true");
    if (mode === "missing_keys") vi.stubEnv("PAYMOB_SECRET_KEY_TEST", "");
    if (mode === "wrong_origin") vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://foreign.example");
    expect((await beginAccountTestCheckout(input)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("stores a canonical phone and excludes visit-only branch identity", async () => {
    const preparation = { ...input.preparation, name: " Test ", phone: "90000000", branches: [{ name: " Main ", city: " Muscat ", localId: "visit-only" }] };
    expect((await beginAccountTestCheckout({ ...input, preparation })).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("es02_begin_test_checkout", expect.objectContaining({ p_preparation: input.preparation }));
  });
  it.each([null, {}, { ...input.preparation, phone: "bad" }])("rejects malformed preparation without writes", async preparation => {
    expect((await beginAccountTestCheckout({ ...input, preparation: preparation as never })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: {} }, { data: {}, error: null }, { data: { ok: true, action: "insert", data: { ...order, accountId: input.sessionId } }, error: null }])("never contacts provider after uncertain or foreign acknowledgement", async reply => {
    mocks.rpc.mockResolvedValue(reply);
    expect(await beginAccountTestCheckout(input)).toEqual({ ok: false, code: "UNKNOWN" });
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("retains uncertainty after provider or persistence failure", async () => {
    mocks.open.mockResolvedValue({ ok: false, code: "checkout_persist_failed" });
    expect(await beginAccountTestCheckout(input)).toEqual({ ok: false, code: "UNKNOWN" });
  });
});
