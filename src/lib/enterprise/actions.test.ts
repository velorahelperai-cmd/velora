import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({access:vi.fn(),client:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:state.access}));
vi.mock("@/lib/supabase/server",()=>({createClient:state.client}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import { readEnterpriseWorkspace, createEnterpriseBranch, inviteEnterpriseMember, heartbeatEnterprisePresence } from "./actions";
const user="10000000-0000-4000-8000-000000000001", company="20000000-0000-4000-8000-000000000001";
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv("VELORA_ENTERPRISE_LIFECYCLE_ENABLED","true");state.access.mockResolvedValue({ok:true,context:{userId:user,company:{id:company},membership:{role:"owner"}}});state.client.mockResolvedValue({rpc:state.rpc});});
afterEach(()=>vi.unstubAllEnvs());
describe("enterprise server entry points",()=>{
 it("rejects disabled release entry points before Auth or RPC",async()=>{
  vi.stubEnv("VELORA_ENTERPRISE_LIFECYCLE_ENABLED",undefined);
  expect(await readEnterpriseWorkspace(user,company)).toEqual({ok:false,code:"UNCONFIGURED"});
  expect(state.access).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();
 });
 it("does not read or refresh Auth from a disabled heartbeat",async()=>{
  vi.stubEnv("VELORA_ENTERPRISE_LIFECYCLE_ENABLED","false");
  expect(await heartbeatEnterprisePresence(user,company)).toEqual({ok:false,code:"UNCONFIGURED"});
  expect(state.access).not.toHaveBeenCalled();expect(state.rpc).not.toHaveBeenCalled();
 });
 it("rejects an old-account form before RPC",async()=>{
  expect(await createEnterpriseBranch({expectedUserId:"10000000-0000-4000-8000-000000000002",companyId:company,operationId:company,name:"Branch",timezone:"UTC"})).toMatchObject({ok:false,code:"UNAUTHENTICATED"});expect(state.rpc).not.toHaveBeenCalled();
 });
 it("rejects spoofed organization scope",async()=>{
  expect(await readEnterpriseWorkspace(user,"20000000-0000-4000-8000-000000000002")).toMatchObject({ok:false,code:"FORBIDDEN"});expect(state.rpc).not.toHaveBeenCalled();
 });
 it("never returns an unvalidated or mismatched workspace",async()=>{
  state.rpc.mockResolvedValue({data:{ok:true,companyId:"another",branches:[],accounts:[]},error:null});
  expect(await readEnterpriseWorkspace(user,company)).toMatchObject({ok:false,code:"UNAVAILABLE"});
 });
 it("uses native authority and exposes only bounded branch mutation data",async()=>{
  state.rpc.mockResolvedValue({data:{ok:true,branchId:company,secret:"not for browser"},error:null});
  expect(await createEnterpriseBranch({expectedUserId:user,companyId:company,operationId:company,name:"Branch",timezone:"UTC"})).toEqual({ok:true,data:{branchId:company}});
  expect(state.rpc).toHaveBeenCalledWith("enterprise_create_branch",{p_company_id:company,p_operation_id:company,p_name:"Branch",p_timezone:"UTC"});
 });
 it("does not issue a token or RPC for non-owner invitations",async()=>{
  state.access.mockResolvedValue({ok:true,context:{userId:user,company:{id:company},membership:{role:"staff"}}});
  expect(await inviteEnterpriseMember({expectedUserId:user,companyId:company,operationId:company,branchIds:[company],role:"manager",email:"x@example.test",name:"Staff",capabilities:[]})).toMatchObject({ok:false,code:"FORBIDDEN"});expect(state.rpc).not.toHaveBeenCalled();
 });
 it("does not fabricate a lost invitation link on replay",async()=>{
  state.rpc.mockResolvedValue({data:{ok:true,id:company,expiresAt:"2026-10-17T00:00:00Z",replayed:true,tokenMatched:false},error:null});
  expect(await inviteEnterpriseMember({expectedUserId:user,companyId:company,operationId:company,branchIds:[company],role:"employee",email:"x@example.test",name:"Staff",capabilities:[]})).toMatchObject({ok:true,data:{inviteUrl:null,replayed:true}});
 });
});
