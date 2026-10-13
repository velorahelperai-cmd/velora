import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({catalog:vi.fn(),admin:vi.fn(),rpc:vi.fn(),config:vi.fn(),live:vi.fn(),site:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("./rpc",()=>({readPublicCatalogBackend:mocks.catalog}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mocks.admin}));
vi.mock("../wiring/test-checkout",()=>({readTestCheckoutConfig:mocks.config}));
vi.mock("@/lib/auth/site-url",()=>({siteUrl:mocks.site}));
vi.mock("../wiring/live-checkout",()=>({readLiveCheckoutConfig:mocks.live}));
import { readSubscriptionOffersView } from "./offer-readiness";
const id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",plan="22222222-2222-4222-8222-222222222222";
const row={code:"noor_basic",currency:"OMR",amount_baisa:45000,period_unit:"month",period_count:1,automated_outbound_per_month:500,feature_availability:{knowledge:"not_verified"},product_code:"velora_ai_staff",plan_id:plan,version_id:id,version:1,persona:"noor",variant:"basic",checkout_enabled:false};
const bound={id,plan_id:plan,status:"published",plan_status:"active",plan_code:"noor_basic",amount_baisa:45000,currency:"OMR",period_days:30,period_unit:"month",period_count:1,service_code:"noura",tier:"basic",capabilities:["noura.knowledge.read"],bound:true};
beforeEach(()=>{vi.clearAllMocks();mocks.live.mockReturnValue({ok:false,code:"live_disabled"});mocks.catalog.mockResolvedValue({ok:true,data:[row]});mocks.admin.mockReturnValue({rpc:mocks.rpc});mocks.config.mockReturnValue({ok:true});mocks.site.mockReturnValue("https://synthetic.velora.example");mocks.rpc.mockResolvedValue({data:{ok:true,data:bound},error:null});});
describe("read-only server Test readiness",()=>{
 it("qualifies Live Premium separately without calling the Test RPC",async()=>{
  mocks.live.mockReturnValue({ok:true,config:{integrationId:98765,merchantOwnerId:"1001"},unitsPerOmr:1000});
  mocks.catalog.mockResolvedValue({ok:true,data:[{...row,code:"noor_premium",variant:"premium",amount_baisa:90000}]});
  mocks.rpc.mockResolvedValue({data:{ok:true,data:{version_id:id,plan_id:plan,amount_baisa:90000,allowance_cap:500,tier:"premium",catalog_revision:7}},error:null});
  expect((await readSubscriptionOffersView()).offers[0]).toMatchObject({liveCheckoutReady:true,catalogRevision:7,testCheckoutReady:false});
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("billing_read_public_live_offer",{p_plan_version_id:id,p_integration_id:98765,p_merchant_owner_id:"1001",p_units_per_omr:1000});
 });
 it("missing Live schema never falls back into Test checkout",async()=>{
  mocks.live.mockReturnValue({ok:true,config:{integrationId:98765,merchantOwnerId:"1001"},unitsPerOmr:1000});
  mocks.rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});
  const view=await readSubscriptionOffersView();expect(view.offers[0].liveCheckoutReady).not.toBe(true);expect(view.offers[0].testCheckoutReady).toBe(false);
 });
 it("requires an actual qualified binding even with valid config",async()=>{
  mocks.rpc.mockResolvedValue({data:{ok:false,code:"PUBLIC_OFFER_UNSUPPORTED"},error:null});
  const view=await readSubscriptionOffersView();
  expect(view.offers[0].testCheckoutReady).toBe(false);expect(view.offers[0].amountBaisa).toBe(45000);
 });
 it("returns only a readiness boolean from qualified metadata without enabling Live",async()=>{
  const view=await readSubscriptionOffersView();
  expect(view.offers[0].testCheckoutReady).toBe(true);expect(view.offers[0].checkoutEnabled).toBe(false);
  expect(view.offers[0]).not.toHaveProperty("config");
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("billing_read_public_test_offer",{p_plan_version_id:id});
 });
 it("invalid or Live-enabled configuration keeps checkout unavailable without database qualification",async()=>{
  mocks.config.mockReturnValue({ok:false,code:"live_rejected"});
  expect((await readSubscriptionOffersView()).offers[0].testCheckoutReady).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("published Premium never invokes the Basic qualification RPC",async()=>{
  mocks.catalog.mockResolvedValue({ok:true,data:[{...row,code:"noor_premium",variant:"premium",amount_baisa:90000}]});
  expect((await readSubscriptionOffersView()).offers[0].testCheckoutReady).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it.each(["error","throw","foreign-plan","unbound"])("fails closed on %s qualification",async(kind)=>{
  if(kind==="error")mocks.rpc.mockResolvedValue({data:null,error:{code:"42501"}});
  if(kind==="throw")mocks.rpc.mockRejectedValue(new Error("synthetic transport failure"));
  if(kind==="foreign-plan")mocks.rpc.mockResolvedValue({data:{ok:true,data:{...bound,plan_id:id}},error:null});
  if(kind==="unbound")mocks.rpc.mockResolvedValue({data:{ok:true,data:{...bound,bound:false}},error:null});
  expect((await readSubscriptionOffersView()).offers[0].testCheckoutReady).toBe(false);
 });
 it("unconfigured callback and missing server reader keep checkout unavailable",async()=>{
  mocks.site.mockReturnValue("http://localhost:3000");expect((await readSubscriptionOffersView()).offers[0].testCheckoutReady).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.site.mockReturnValue("https://synthetic.velora.example");mocks.admin.mockReturnValue(null);expect((await readSubscriptionOffersView()).offers[0].testCheckoutReady).toBe(false);
 });
 it("preserves catalog read failures rather than projecting zero plans",async()=>{
  mocks.catalog.mockResolvedValue({ok:false,code:"unavailable"});expect(await readSubscriptionOffersView()).toEqual({status:"error",offers:[]});
 });
});
