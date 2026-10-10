import { beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({access:vi.fn(),settings:vi.fn(),order:vi.fn(),admin:vi.fn(),site:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:state.access}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:state.admin}));
vi.mock("./order-actions",()=>({createBillingOrderAction:state.order}));
vi.mock("./test-checkout",()=>({readTestCheckoutConfig:state.settings,openTestCheckout:vi.fn(),fetchPaymobHttp:{}}));
vi.mock("@/lib/auth/site-url",()=>({siteUrl:state.site}));
import { startTestCheckoutAction, resumeTestCheckoutAction } from "./test-checkout-actions";
const input={planVersionId:"version",clientOpId:"operation"};
describe("owner-only checkout action",()=>{
 beforeEach(()=>{vi.clearAllMocks();state.access.mockResolvedValue({ok:true,context:{company:{id:"company",status:"active",contact_phone:"+96890000000"},membership:{role:"owner"}}});state.settings.mockReturnValue({ok:true,unitsPerOmr:1000,config:{integrationId:123}});state.site.mockReturnValue("https://test.example.com");state.order.mockResolvedValue({ok:false,code:"plan_not_published"});});
 it("rejects staff before reading settings or creating orders",async()=>{state.access.mockResolvedValue({ok:true,context:{company:{id:"company",status:"active"},membership:{role:"staff"}}});expect(await startTestCheckoutAction(input)).toMatchObject({ok:false,code:"not_owner"});expect(state.settings).not.toHaveBeenCalled();expect(state.order).not.toHaveBeenCalled();});
 it("rejects a suspended owner",async()=>{state.access.mockResolvedValue({ok:true,context:{company:{id:"company",status:"suspended"},membership:{role:"owner"}}});expect(await startTestCheckoutAction(input)).toMatchObject({ok:false,code:"not_owner"});expect(state.order).not.toHaveBeenCalled();});
 it("does not create a dead order when Test is unconfigured",async()=>{state.settings.mockReturnValue({ok:false,code:"test_not_configured"});expect(await startTestCheckoutAction(input)).toMatchObject({ok:false,code:"test_not_configured"});expect(state.order).not.toHaveBeenCalled();});
 it("requires a public callback before creating an order",async()=>{state.site.mockReturnValue("http://localhost:3000");expect(await startTestCheckoutAction(input)).toMatchObject({ok:false,code:"callback_not_configured"});expect(state.order).not.toHaveBeenCalled();});
 it("requires the saved company phone",async()=>{state.access.mockResolvedValue({ok:true,context:{company:{id:"company",status:"active",contact_phone:null},membership:{role:"owner"}}});expect(await startTestCheckoutAction(input)).toMatchObject({ok:false,code:"billing_phone_missing"});expect(state.order).not.toHaveBeenCalled();});
 it("passes only the catalog version and operation to server-priced order creation",async()=>{expect(await startTestCheckoutAction({...input,amountBaisa:1} as typeof input)).toMatchObject({ok:false,code:"plan_not_published"});expect(state.order).toHaveBeenCalledWith({planVersionId:"version",clientOpId:"operation",purchasePurpose:"initial",expectedCompanyId:"company"});expect(state.admin).not.toHaveBeenCalled();});
});

describe("resume stored checkout",()=>{
 function configure(status="provider_submitted"){
  state.access.mockResolvedValue({ok:true,context:{company:{id:"company",status:"active"},membership:{role:"owner"}}});
  state.settings.mockReturnValue({ok:true,unitsPerOmr:1000,config:{integrationId:123}});
  const scoped=vi.fn();
  state.admin.mockReturnValue({from:(table:string)=>{const data=table==="billing_orders"?{id:"order",provider_account_ref:"123"}:table==="billing_test_checkouts"?{payment_attempt_id:"attempt",checkout_url:"https://om.checkout.paymob.com/?publicKey=om_pk_test_example&clientSecret=om_csk_test_example"}:{status};const query={select:()=>query,eq:(...args:unknown[])=>{scoped(table,...args);return query;},in:()=>query,order:()=>query,limit:()=>query,maybeSingle:async()=>({data,error:null})};return query;}});return scoped;
 }
 it("reopens a company-scoped saved checkout without creating an order",async()=>{vi.clearAllMocks();const scoped=configure();expect(await resumeTestCheckoutAction({orderId:"order"})).toMatchObject({ok:true,orderId:"order"});expect(scoped).toHaveBeenCalledWith("billing_orders","company_id","company");expect(scoped).toHaveBeenCalledWith("billing_payment_attempts","company_id","company");expect(state.order).not.toHaveBeenCalled();});
 it("does not reopen a terminal attempt",async()=>{vi.clearAllMocks();configure("paid");expect(await resumeTestCheckoutAction({orderId:"order"})).toMatchObject({ok:false,code:"payment_pending"});expect(state.order).not.toHaveBeenCalled();});
});
