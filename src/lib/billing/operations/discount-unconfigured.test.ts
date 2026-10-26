import {describe,it,expect,vi,afterEach} from "vitest";
const state=vi.hoisted(()=>({rpc:vi.fn(async()=>({data:null,error:{code:"PGRST202"}}))}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:async()=>({ok:true,context:{company:{id:"company",status:"active"},membership:{role:"owner",status:"active"},userId:"owner"}})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:state.rpc})}));
vi.mock("@/lib/billing/operations/db",()=>({operationRpc:vi.fn()}));
import {prepareDiscountedSubscriptionOrderAction} from "@/lib/billing/operations/actions";
afterEach(()=>vi.unstubAllEnvs());
describe("unconfigured exported discount action",()=>{
 it("refuses before missing RPC or provider work",async()=>{
  const result=await prepareDiscountedSubscriptionOrderAction({planVersionId:"version",purpose:"initial",clientOpId:"operation",offerId:null});
  expect.soft(result).toEqual({ok:false,code:"discount_not_configured"});
  expect(state.rpc).not.toHaveBeenCalled();
 });
});
