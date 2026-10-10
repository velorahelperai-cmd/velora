/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic boundary fixtures */
import {describe,it,expect,beforeEach,vi} from "vitest";
const A="11111111-1111-4111-8111-111111111111",U="22222222-2222-4222-8222-222222222222",V="33333333-3333-4333-8333-333333333333",P="44444444-4444-4444-8444-444444444444",S="55555555-5555-4555-8555-555555555555";
const state=vi.hoisted(()=>({plan:{} as any,access:{} as any,rpc:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:async()=>state.access}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getClaims:async()=>({data:{claims:{sub:"22222222-2222-4222-8222-222222222222",session_id:"55555555-5555-4555-8555-555555555555"}},error:null})},rpc:async()=>({data:{ok:true,expires_at:"2099-11-01T00:00:00Z"},error:null})})}));
vi.mock("@/lib/billing/wiring/flags",()=>({readBillingPaymobWiringFlags:()=>({createEnabled:true,liveEnabled:false}),readWiringSecretsPresence:()=>({}),blocksPaymobConnection:()=>"test_provider_blocked"}));
vi.mock("@/lib/billing/paymob/config",()=>({getPaymobOmrConversionState:()=>({status:"CONFIGURED",unitsPerOmr:1000})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:state.rpc,from:(table:string)=>{const q={select:()=>q,eq:()=>q,in:async()=>({data:[],error:null}),maybeSingle:async()=>({data:table==="billing_plan_versions"?state.plan:null,error:null})};return q;}})}));
import {createBillingOrderAction} from "@/lib/billing/wiring/order-actions";
const input={planVersionId:V,clientOpId:"synthetic-public-policy"};
const atomicCalls=()=>state.rpc.mock.calls.filter(([n])=>n!=="billing_read_public_test_offer");
beforeEach(()=>{state.rpc.mockReset();state.plan={id:V,plan_id:P,status:"published",plan_status:"active",plan_code:"noor_basic",amount_baisa:45000,currency:"OMR",period_days:30,period_unit:"month",period_count:1,service_code:"noura",tier:"basic",capabilities:["noura.knowledge.read"],bound:true};state.access={ok:true,context:{company:{id:A,status:"active"},membership:{role:"owner",status:"active"},userId:U}};state.rpc.mockImplementation(async(n:string)=>({data:n==="billing_read_public_test_offer"?{ok:true,data:state.plan}:{ok:true,action:"created",order_id:"order",special_reference:"synthetic-reference",payment_attempt_id:"attempt"},error:null}));});
describe("real public order action policy",()=>{
 it.each([
  ["premium",{plan_code:"noor_premium",tier:"premium"}],
  ["other-service",{plan_code:"lina_basic",service_code:"lina"}],
  ["daily",{period_unit:"day"}], ["annual",{period_unit:"year"}],
  ["multi-month",{period_count:2}], ["unbound",{bound:false}],
  ["changed inherited Test offer",{amount_baisa:45001}],
  ["wrong capabilities",{capabilities:["dana.reports.read"]}]
 ])("%s stops before atomic order/provider work",async(_,patch)=>{Object.assign(state.plan,patch);expect.soft(await createBillingOrderAction(input)).toMatchObject({ok:false,code:"PUBLIC_OFFER_UNSUPPORTED"});expect(atomicCalls()).toHaveLength(0);});
 it("valid bound inherited Basic monthly reaches only locked public wrapper",async()=>{expect(await createBillingOrderAction(input)).toMatchObject({ok:true,orderId:"order"});expect(atomicCalls()).toHaveLength(1);expect(atomicCalls()[0][0]).toBe("billing_create_public_test_subscription_order");expect(atomicCalls()[0][1]).toMatchObject({p_actor_session_id:S,p_units_per_omr:1000,p_input:{p_company_id:A,p_created_by:U,p_provider_environment:"test",p_amount_baisa:45000}});});
 it.each(["draft","retired"])("%s cannot persist",async status=>{state.plan.status=status;expect(await createBillingOrderAction(input)).toMatchObject({ok:false});expect(atomicCalls()).toHaveLength(0);});
 it("staff cannot persist",async()=>{state.access.context.membership.role="staff";expect(await createBillingOrderAction(input)).toMatchObject({ok:false});expect(state.rpc).not.toHaveBeenCalled();});
 it("a switched expected company cannot persist",async()=>{expect(await createBillingOrderAction({...input,expectedCompanyId:P} as any)).toMatchObject({ok:false,code:"FORBIDDEN"});expect(state.rpc).not.toHaveBeenCalled();});
 it("missing policy schema does not fall back to generic financial persistence",async()=>{state.rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});expect(await createBillingOrderAction(input)).toMatchObject({ok:false,code:"schema_unavailable"});expect(atomicCalls()).toHaveLength(0);});
});
