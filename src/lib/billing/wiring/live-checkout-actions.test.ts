import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({access:vi.fn(),session:vi.fn(),admin:vi.fn(),rpc:vi.fn(),open:vi.fn(),site:vi.fn(),config:vi.fn(),ready:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:mocks.access}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.admin}));
vi.mock("@/lib/auth/site-url",()=>({siteUrl:mocks.site}));
vi.mock("./public-purchase-persist",()=>({readBillingActorSession:mocks.session}));
vi.mock("./live-checkout",()=>({readLiveCheckoutConfig:mocks.config,openLiveCheckout:mocks.open,readyLiveCheckoutUrl:mocks.ready}));
const company="11111111-1111-4111-8111-111111111111",version="44444444-4444-4444-8444-444444444444";
const input={planVersionId:version,clientOpId:"synthetic-client-operation",expectedCompanyId:company,expectedCatalogRevision:7};
const payload={ok:true,order_id:"22222222-2222-4222-8222-222222222222",payment_attempt_id:"33333333-3333-4333-8333-333333333333",special_reference:"synthetic-reference",locked:{amount_baisa:45000,currency:"OMR",provider_amount:45000,provider_amount_unit:"paymob_amount",provider_account_ref:"98765",provider_environment:"live",plan_version_id:version},service:{service_code:"noura",tier:"premium",allowance_cap:1500,monthly_limit_baisa:15000}};
async function load(){const p="./live-checkout-actions" as const;try{return await import(p);}catch{return null;}}
beforeEach(()=>{vi.clearAllMocks();mocks.config.mockReturnValue({ok:true,config:{integrationId:98765,merchantOwnerId:"1001",verifiedOmrUnitsPerOmr:1000},unitsPerOmr:1000});mocks.ready.mockReturnValue(true);mocks.access.mockResolvedValue({ok:true,context:{userId:"synthetic-user",company:{id:company,status:"active",contact_phone:"+96890000000"},membership:{role:"owner",status:"active"}}});mocks.session.mockResolvedValue("55555555-5555-4555-8555-555555555555");mocks.site.mockReturnValue("https://example.test");mocks.admin.mockReturnValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({data:payload,error:null});mocks.open.mockResolvedValue({ok:true,url:"https://om.checkout.paymob.com/"});});
describe("Live checkout action never trusts browser financial/service data",()=>{
 it("disabled server configuration rejects creation and resume before database/provider execution",async()=>{
  mocks.config.mockReturnValue({ok:false,code:"live_disabled"});const m=await load();
  expect(await m?.startLiveCheckoutAction(input)).toEqual({ok:false,code:"live_disabled"});expect(await m?.resumeLiveCheckoutAction({orderId:payload.order_id})).toEqual({ok:false,code:"live_disabled"});expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.open).not.toHaveBeenCalled();
 });
 it("resumes only an existing company scoped Live ready checkout without provider execution",async()=>{
  const eq=vi.fn();const rows=[{id:payload.order_id,status:"submitted",provider_account_ref:"98765"},{id:payload.payment_attempt_id}];
  const from=vi.fn(()=>{const query={select:()=>query,eq:(...args:unknown[])=>{eq(...args);return query;},order:()=>query,limit:()=>query,maybeSingle:async()=>({data:rows.shift(),error:null})};return query;});
  mocks.admin.mockReturnValue({rpc:mocks.rpc,from});mocks.rpc.mockResolvedValue({data:{kind:"ready",url:"https://om.checkout.paymob.com/synthetic"},error:null});
  const m=await load();expect(await m?.resumeLiveCheckoutAction({orderId:payload.order_id})).toEqual({ok:true,url:"https://om.checkout.paymob.com/synthetic"});
  expect(eq).toHaveBeenCalledWith("company_id",company);expect(eq).toHaveBeenCalledWith("provider_environment","live");expect(eq).toHaveBeenCalledWith("status","provider_submitted");expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("billing_claim_live_checkout",expect.objectContaining({p_company_id:company,p_order_id:payload.order_id,p_attempt_id:payload.payment_attempt_id}));expect(mocks.open).not.toHaveBeenCalled();
 });
 it("foreign or unresolved order cannot allocate a checkout on resume",async()=>{
  const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:null,error:null})};mocks.admin.mockReturnValue({rpc:mocks.rpc,from:()=>query});
  const m=await load();expect(await m?.resumeLiveCheckoutAction({orderId:payload.order_id})).toEqual({ok:false,code:"payment_pending"});expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.open).not.toHaveBeenCalled();
 });
 it("creates through the authoritative Live SQL contract with verified server actor/session",async()=>{const m=await load();expect(m).not.toBeNull();expect(await m?.startLiveCheckoutAction(input)).toMatchObject({ok:true,orderId:payload.order_id});expect(mocks.rpc).toHaveBeenCalledWith("billing_create_live_checkout_order",expect.objectContaining({p_company_id:company,p_plan_version_id:version,p_actor_id:"synthetic-user",p_expected_revision:7,p_integration_id:98765}));expect(mocks.open.mock.calls[0][0].locked).toMatchObject({amountBaisa:45000,providerEnvironment:"live",planVersionId:version});});
 it.each([{amountBaisa:1},{currency:"USD"},{tier:"premium"},{providerEnvironment:"test"},{actorSessionId:"browser-session"}])("rejects extra browser authority %j",async extra=>{const m=await load();expect(m).not.toBeNull();expect((await m?.startLiveCheckoutAction({...input,...extra}))?.ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("rejects another selected company before mutations",async()=>{const m=await load();expect(m).not.toBeNull();expect((await m?.startLiveCheckoutAction({...input,expectedCompanyId:version}))?.ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("requires a verified active owner session",async()=>{const m=await load();expect(m).not.toBeNull();mocks.session.mockResolvedValue(null);expect((await m?.startLiveCheckoutAction(input))?.ok).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();});
 it("does not collect after SQL stale version/revision denial",async()=>{const m=await load();expect(m).not.toBeNull();mocks.rpc.mockResolvedValue({data:{ok:false,code:"CATALOG_REVISION_CONFLICT"},error:null});expect(await m?.startLiveCheckoutAction(input)).toMatchObject({ok:false,code:"CATALOG_REVISION_CONFLICT"});expect(mocks.open).not.toHaveBeenCalled();});
 it.each([{plan_version_id:company},{provider_environment:"test"},{provider_amount:44999}])("rejects corrupted locked SQL result %j",async change=>{const m=await load();expect(m).not.toBeNull();mocks.rpc.mockResolvedValue({data:{...payload,locked:{...payload.locked,...change}},error:null});expect((await m?.startLiveCheckoutAction(input))?.ok).toBe(false);expect(mocks.open).not.toHaveBeenCalled();});
 it("does not claim or call provider after an unsettled Live collection blocks creation",async()=>{mocks.rpc.mockResolvedValue({data:{ok:false,code:"LIVE_COLLECTION_REQUIRES_RECONCILIATION",block_new_collection:true},error:null});const m=await load();expect(await m?.startLiveCheckoutAction(input)).toEqual({ok:false,code:"LIVE_COLLECTION_REQUIRES_RECONCILIATION"});expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.open).not.toHaveBeenCalled();});
});
