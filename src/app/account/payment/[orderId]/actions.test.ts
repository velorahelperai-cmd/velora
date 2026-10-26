import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ claims: vi.fn(), session: vi.fn(), rpc: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/billing/es02/thawani-account-checkout", () => ({ verifyOwnedThawaniTestPayment: mocks.verify }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.claims }, rpc: mocks.rpc }) }));
vi.mock("@/lib/auth/session-guard", () => ({ checkAppSession: mocks.session }));
import { finishTestCheckout, verifyThawaniPayment } from "./actions";
const account = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const order = "12121212-3434-4656-8787-909090909090";
describe("saved Test checkout provisioning", () => {
 beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllEnvs();
  vi.stubEnv("BILLING_ES02_PAYMOB_TEST_ENABLED", "true");
  vi.stubEnv("PAYMOB_HOSTED_TEST_ACCOUNT_ID", account);
  mocks.claims.mockResolvedValue({ data: { claims: { sub: account } }, error: null });
  mocks.session.mockResolvedValue({ ok: true });
  mocks.rpc.mockResolvedValue({ data: { ok: true, action: "provisioned", data: { orderId: order, companyId: account, orderGroupId: order } }, error: null });
 });
 it("uses only authenticated identity and the saved order, then enters setup", async () => {
  expect(await finishTestCheckout(order)).toEqual({ ok: true, next: "/setup" });
  expect(mocks.rpc).toHaveBeenCalledWith("es02_finish_test_checkout", { p_expected_account_id: account, p_order_id: order });
 });
 it("uses the Thawani Test provisioner for its allowlisted account", async () => {
  vi.stubEnv("BILLING_ES02_THAWANI_TEST_ENABLED", "true");
  vi.stubEnv("THAWANI_TEST_ACCOUNT_ID", account);
  vi.stubEnv("BILLING_ES02_PAYMOB_TEST_ENABLED", "false");
  expect(await finishTestCheckout(order)).toEqual({ ok: true, next: "/setup" });
  expect(mocks.rpc).toHaveBeenCalledWith("es02_finish_thawani_test_checkout", { p_expected_account_id: account, p_order_id: order });
 });
 it("checks active identity before verifying the saved Thawani payment", async () => {
  vi.stubEnv("BILLING_ES02_THAWANI_TEST_ENABLED", "true");
  vi.stubEnv("THAWANI_TEST_ACCOUNT_ID", account);
  mocks.verify.mockResolvedValue({ ok: true, paid: true });
  expect(await verifyThawaniPayment(order)).toEqual({ ok: true, paid: true });
  expect(mocks.verify).toHaveBeenCalledWith(account, order);
  mocks.verify.mockClear(); mocks.session.mockResolvedValue({ ok: false });
  expect(await verifyThawaniPayment(order)).toEqual({ ok: false });
  expect(mocks.verify).not.toHaveBeenCalled();
 });
 it.each(["foreign", "expired", "disabled"])("blocks %s before provisioning", async mode => {
  if(mode==="foreign") vi.stubEnv("PAYMOB_HOSTED_TEST_ACCOUNT_ID", order);
  if(mode==="expired") mocks.session.mockResolvedValue({ ok: false });
  if(mode==="disabled") vi.stubEnv("BILLING_ES02_PAYMOB_TEST_ENABLED", "false");
  expect(await finishTestCheckout(order)).toEqual({ ok: false }); expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each([{ ok: false, code: "NOT_SETTLED" }, { ok: true, action: "provisioned", data: { orderId: account, companyId: account } }, null])("never redirects on an unconfirmed or different order", async data => {
  mocks.rpc.mockResolvedValue({ data, error: null }); expect(await finishTestCheckout(order)).toEqual({ ok: false });
 });
});
