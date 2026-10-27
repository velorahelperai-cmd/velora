import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
afterEach(()=>vi.unstubAllEnvs());
const mocks = vi.hoisted(() => ({ claims: vi.fn(), session: vi.fn(), rpc: vi.fn(), verify: vi.fn(),liveVerify:vi.fn(),select:vi.fn() }));
vi.mock('@/lib/billing/es02/thawani-live-account-checkout',()=>({verifyOwnedThawaniLocalLivePayment:mocks.liveVerify}));
vi.mock('@/lib/tenancy/actions',()=>({selectWorkspaceCompany:mocks.select}));
vi.mock("@/lib/billing/es02/thawani-account-checkout", () => ({ verifyOwnedThawaniTestPayment: mocks.verify }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.claims }, rpc: mocks.rpc }) }));
vi.mock("@/lib/auth/session-guard", () => ({ checkAppSession: mocks.session }));
import { finishTestCheckout, verifyThawaniPayment } from "./actions";
const account = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const order = "12121212-3434-4656-8787-909090909090";
describe("saved Test checkout provisioning", () => {
 beforeEach(() => {
  vi.resetAllMocks(); vi.unstubAllEnvs();
  vi.stubEnv("BILLING_ES02_THAWANI_TEST_ENABLED", "true");
  vi.stubEnv("THAWANI_TEST_ACCOUNT_ID", account);
  mocks.claims.mockResolvedValue({ data: { claims: { sub: account } }, error: null });
  mocks.session.mockResolvedValue({ ok: true });
  mocks.rpc.mockResolvedValue({ data: { ok: true, action: "provisioned", data: { orderId: order, companyId: account, orderGroupId: order } }, error: null });
 });
 it("uses only authenticated identity and the saved order, then enters setup", async () => {
  expect(await finishTestCheckout(order)).toEqual({ ok: true, next: "/setup" });
  expect(mocks.rpc).toHaveBeenCalledWith("es02_finish_thawani_test_checkout", { p_expected_account_id: account, p_order_id: order });
 });
 it("uses the Thawani Test provisioner for its allowlisted account", async () => {
  vi.stubEnv("BILLING_ES02_THAWANI_TEST_ENABLED", "true");
  vi.stubEnv("THAWANI_TEST_ACCOUNT_ID", account);

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
  if(mode==="foreign") vi.stubEnv("THAWANI_TEST_ACCOUNT_ID", order);
  if(mode==="expired") mocks.session.mockResolvedValue({ ok: false });
  if(mode==="disabled") vi.stubEnv("BILLING_ES02_THAWANI_TEST_ENABLED", "false");
  expect(await finishTestCheckout(order)).toEqual({ ok: false }); expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each([{ ok: false, code: "NOT_SETTLED" }, { ok: true, action: "provisioned", data: { orderId: account, companyId: account } }, null])("never redirects on an unconfirmed or different order", async data => {
  mocks.rpc.mockResolvedValue({ data, error: null }); expect(await finishTestCheckout(order)).toEqual({ ok: false });
 });
});
describe('local Live customer finish',()=>{
 beforeEach(()=>{
  vi.resetAllMocks();vi.unstubAllEnvs();
  const env={NODE_ENV:'development',VELORA_LOCAL_CUSTOMER_MODE:'live',NEXT_PUBLIC_SITE_URL:'http://127.0.0.1:3330',VELORA_LOCAL_LIVE_ACCOUNT_ID:account,VELORA_LOCAL_LIVE_GRANT_ID:order,VELORA_LOCAL_LIVE_APPROVED_BAISA:'100',THAWANI_SECRET_KEY_LIVE:'fixture-secret',THAWANI_PUBLIC_KEY_LIVE:'fixture-public',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'fixture-public',SUPABASE_SERVICE_ROLE_KEY:'fixture-private',VELORA_SESSION_BROKER_KEY:'fixture-broker'};
  for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
  mocks.claims.mockResolvedValue({data:{claims:{sub:account}},error:null});mocks.session.mockResolvedValue({ok:true});
  mocks.rpc.mockResolvedValue({data:{ok:true,action:'provisioned',data:{orderId:order,companyId:account,orderGroupId:order}},error:null});
  mocks.select.mockResolvedValue({ok:true,data:{companyId:account,next:'/setup'}});
 });
 it('selects the provisioned workspace so an existing Test business cannot capture the redirect',async()=>{expect(await finishTestCheckout(order)).toEqual({ok:true,next:'/setup'});expect(mocks.rpc).toHaveBeenCalledWith('es02_finish_thawani_live_checkout',{p_expected_account_id:account,p_order_id:order});expect(mocks.select).toHaveBeenCalledWith(account,{expectedUserId:account,next:'/setup'});});
 it('retains same-order recovery if workspace selection is not confirmed',async()=>{mocks.select.mockResolvedValue({ok:false,code:'UNAVAILABLE'});expect(await finishTestCheckout(order)).toEqual({ok:false});expect(mocks.rpc).toHaveBeenCalledTimes(1);});
 it('uses only Live verification and denies an expired session',async()=>{mocks.liveVerify.mockResolvedValue({ok:true,paid:true});expect(await verifyThawaniPayment(order)).toEqual({ok:true,paid:true});expect(mocks.verify).not.toHaveBeenCalled();mocks.liveVerify.mockClear();mocks.session.mockResolvedValue({ok:false});expect(await verifyThawaniPayment(order)).toEqual({ok:false});expect(mocks.liveVerify).not.toHaveBeenCalled();});
});
