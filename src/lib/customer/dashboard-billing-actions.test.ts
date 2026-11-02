vi.mock('server-only',()=>({}));
import {beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({access:vi.fn(),rpc:vi.fn(),channel:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:state.access}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:state.rpc})}));
vi.mock("@/lib/whatsapp/connection-actions",()=>({getWhatsappCompanyLink:state.channel}));
vi.mock("@/lib/whatsapp/config",()=>({whatsappLiveOpsReady:()=>false}));
import {readDashboardBilling} from "./dashboard-billing-actions";
const companyId="real-company";
const data={company_id:companyId,environment:"live",journey:{subscription:{company_id:companyId,status:"active",paid_through:null}},usage:{company_id:companyId,month_start:"2026-10-01",successful_automated_outbound:12,held_outbound_capacity:3,cap:20},billing_paid:false,operational_eligible:false,qualified_paid_through:null};
beforeEach(()=>{vi.clearAllMocks();state.access.mockResolvedValue({ok:true,context:{company:{id:companyId},membership:{role:"owner",status:"active"}}});state.rpc.mockResolvedValue({data:{ok:true,data},error:null});state.channel.mockResolvedValue({ok:true,data:{companyId,status:"not_connected"}});});
describe("dashboard authorized evidence read",()=>{
 it("staff never queries billing/channel",async()=>{state.access.mockResolvedValue({ok:true,context:{company:{id:companyId},membership:{role:"staff",status:"active"}}});expect(await readDashboardBilling()).toEqual({status:"forbidden"});expect(state.rpc).not.toHaveBeenCalled();expect(state.channel).not.toHaveBeenCalled();});
 it("disabled owner never queries evidence",async()=>{state.access.mockResolvedValue({ok:true,context:{company:{id:companyId},membership:{role:"owner",status:"disabled"}}});expect(await readDashboardBilling()).toEqual({status:"forbidden"});expect(state.rpc).not.toHaveBeenCalled();});
 it("missing schema does not reuse raw status or fabricate counts",async()=>{state.rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});expect(await readDashboardBilling()).toEqual({status:"unavailable"});});
 it("explicitly empty remains empty even with unavailable usage",async()=>{state.rpc.mockResolvedValue({data:{ok:true,data:{...data,journey:{subscription:null},usage:null}},error:null});expect(await readDashboardBilling()).toEqual({status:"empty",companyId});});
 it("rejects wrong envelope company before rendering",async()=>{state.rpc.mockResolvedValue({data:{ok:true,data:{...data,company_id:"other-company"}},error:null});expect(await readDashboardBilling()).toEqual({status:"unavailable"});});
 it("binds database request to session company and retains historic counts without eligibility",async()=>{expect(await readDashboardBilling()).toMatchObject({status:"ready",billingPaid:false,operationalEligible:false,channelReady:false,sent:12,held:3,remaining:null});expect(state.rpc).toHaveBeenCalledWith("billing_read_company_display_evidence",{p_company_id:companyId});});
 it("channel transport failure does not erase billing or usage",async()=>{state.channel.mockRejectedValue(Error("synthetic"));expect(await readDashboardBilling()).toMatchObject({status:"ready",channelReady:"unavailable",sent:12,remaining:null});});
 it("wrong channel company stays unavailable",async()=>{state.channel.mockResolvedValue({ok:true,data:{companyId:"other-company",status:"verified"}});expect(await readDashboardBilling()).toMatchObject({channelReady:"unavailable"});});
 it("shows the authorized native balance without inventing a payment proof or accepted-message count",async()=>{
  const native={company_id:companyId,granted:1000,remaining:999,held:0,paid_through:"2030-01-01T00:00:00Z"};
  state.rpc.mockImplementation(async(name:string)=>name==="es02_read_owner_reply_balance"?{data:{ok:true,data:native},error:null}:{data:{ok:true,data:{...data,journey:{subscription:{...data.journey.subscription,plan_version_id:null}}}},error:null});
  expect(await readDashboardBilling()).toMatchObject({status:"ready",billingPaid:false,operationalEligible:false,sent:null,held:0,cap:1000,remaining:999,monthStart:null});
 });
 it("does not show another company's native balance",async()=>{
  state.rpc.mockImplementation(async(name:string)=>name==="es02_read_owner_reply_balance"?{data:{ok:true,data:{company_id:"other",granted:1000,remaining:999,held:0,paid_through:"2030-01-01T00:00:00Z"}},error:null}:{data:{ok:true,data:{...data,journey:{subscription:{...data.journey.subscription,plan_version_id:null}}}},error:null});
  expect(await readDashboardBilling()).toMatchObject({status:"ready",remaining:null});
 });
 it("workspace change refuses before querying",async()=>{expect(await readDashboardBilling({expectedCompanyId:"other-company"})).toEqual({status:"forbidden"});expect(state.rpc).not.toHaveBeenCalled();});
});
