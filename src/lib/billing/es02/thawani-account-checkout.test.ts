import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), admin: vi.fn(), create: vi.fn(), read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.admin }) }));
vi.mock("./thawani-test", async original => ({ ...await original<typeof import("./thawani-test")>(), createThawaniTestSession: mocks.create, readThawaniTestSession: mocks.read }));
import { beginThawaniTestCheckout, verifyOwnedThawaniTestPayment } from "./thawani-account-checkout";
import { resolveEs02Offer } from "./commercial-offer";
const accountId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const orderId = "11111111-2222-4333-8444-555555555555";
const selection = { term: "monthly" as const, slots: [{ persona: "level_1" as const, package: "basic" as const }] };
const resolved = resolveEs02Offer(selection); if (!resolved.ok) throw Error("fixture");
const order = { orderId, accountId, status: "open", offer: resolved.offer, specialReference: "ES02-fixture", paymentAttemptId: orderId, environment: "test", settledAt: null, provisionedCompanyId: null, originalOrderGroupId: orderId };
const input = { accountId, sessionId: orderId, clientOpId: orderId, selection, preparation: { name: "Test", type: "retail", country: "OM", city: "Muscat", phone: "+96890000000", branches: [{ name: "Main", city: "Muscat" }] } };
describe("owned Thawani UAT checkout", () => {
 beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllEnvs();
  for (const [key,value] of Object.entries({ BILLING_ES02_THAWANI_TEST_ENABLED: "true", THAWANI_ENVIRONMENT: "uat", THAWANI_TEST_ACCOUNT_ID: accountId, THAWANI_SECRET_KEY_TEST: "test-secret", THAWANI_PUBLIC_KEY_TEST: "test-public", NEXT_PUBLIC_SITE_URL: "https://www.velorahelper.com" })) vi.stubEnv(key,value);
  mocks.rpc.mockResolvedValue({ data: { ok: true, action: "insert", data: order }, error: null });
  mocks.admin.mockImplementation(async name => ({ data: name === "es02_claim_thawani_test_checkout" ? { kind: "claimed", token: orderId } : true, error: null }));
  mocks.create.mockResolvedValue({ sessionId: "checkout_fixture123", invoice: "1234", status: "unpaid" });
 });
 it("captures the order and preparation before claiming or contacting the provider", async () => {
  expect(await beginThawaniTestCheckout(input)).toMatchObject({ ok: true, data: { checkoutUrl: "https://uatcheckout.thawani.om/pay/checkout_fixture123?key=test-public" } });
  expect(mocks.rpc).toHaveBeenCalledWith("es02_begin_thawani_test_checkout", expect.objectContaining({ p_preparation: input.preparation, p_term: "monthly", p_slots: selection.slots }));
  expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]!);
  expect(mocks.admin).toHaveBeenCalledWith("es02_complete_thawani_test_checkout", expect.objectContaining({ p_session_id: "checkout_fixture123", p_claim_token: orderId }));
 });
 it.each(["foreign", "live", "disabled", "invalid_preparation"])("blocks %s before writes", async mode => {
  if (mode === "foreign") vi.stubEnv("THAWANI_TEST_ACCOUNT_ID", orderId);
  if (mode === "live") vi.stubEnv("THAWANI_ENVIRONMENT", "live");
  if (mode === "disabled") vi.stubEnv("BILLING_ES02_THAWANI_TEST_ENABLED", "false");
  expect((await beginThawaniTestCheckout({ ...input, ...(mode === "invalid_preparation" ? { preparation: undefined } : {}) })).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
 });
 it("reopens the persisted session without another create", async () => {
  mocks.admin.mockResolvedValue({ data: { kind: "ready", sessionId: "checkout_fixture123" }, error: null });
  expect((await beginThawaniTestCheckout(input)).ok).toBe(true); expect(mocks.create).not.toHaveBeenCalled();
 });
 it("does not recreate an uncertain claimed checkout", async () => {
  mocks.admin.mockResolvedValue({ data: { kind: "pending" }, error: null });
  expect(await beginThawaniTestCheckout(input)).toEqual({ ok: false, code: "UNKNOWN" }); expect(mocks.create).not.toHaveBeenCalled();
 });
 it("does not report success when persistence fails after create", async () => {
  mocks.admin.mockImplementation(async name => ({ data: name === "es02_claim_thawani_test_checkout" ? { kind: "claimed", token: orderId } : false, error: null }));
  expect(await beginThawaniTestCheckout(input)).toEqual({ ok: false, code: "UNKNOWN" }); expect(mocks.create).toHaveBeenCalledTimes(1);
 });
 it.each(["paid", "unpaid", "cancelled"])("reconciles %s only from a server query of the saved session", async status => {
  mocks.rpc.mockResolvedValue({ data: { ok: true, data: { order, state: "ready", sessionId: "checkout_fixture123", claimToken: orderId } }, error: null });
  mocks.read.mockResolvedValue({ sessionId: "checkout_fixture123", invoice: "1234", status });
  mocks.admin.mockResolvedValue({ data: { ok: true }, error: null });
  expect(await verifyOwnedThawaniTestPayment(accountId, orderId)).toEqual({ ok: true, paid: status === "paid" });
  expect(mocks.read).toHaveBeenCalledWith(expect.any(Object), "checkout_fixture123", { reference: order.specialReference, amountBaisa: order.offer.amountBaisa, token: orderId });
  expect(mocks.admin).toHaveBeenCalledTimes(status === "paid" ? 1 : 0);
 });
 it("rejects another owner before provider read or settlement", async () => {
  expect((await verifyOwnedThawaniTestPayment(orderId, orderId)).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
 });
});
