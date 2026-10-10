import { beforeEach, describe, it, expect, vi } from "vitest";
const {rpc,createClient}=vi.hoisted(()=>({rpc:vi.fn(),createClient:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/server",()=>({createClient}));
import {readCatalogAdminAction,saveCatalogDraftAction,publishCatalogVersionAction,bindNouraBasicDraftAction} from "./actions";
import {readPublicCatalogBackend} from "./rpc";
const draft={code:"noor_basic",currency:"OMR",amount_baisa:45000,period_unit:"month",period_count:1,automated_outbound_per_month:1000,feature_availability:{faq:"target"}};
const id="22222222-2222-4222-8222-222222222222";
beforeEach(()=>{vi.clearAllMocks();createClient.mockResolvedValue({rpc});});
describe("catalog session RPC wiring",()=>{
 it("binds only through the current owner session RPC and preserves denial",async()=>{
  rpc.mockResolvedValue({data:{ok:false,code:"forbidden"},error:null});
  expect(await bindNouraBasicDraftAction(id,3)).toEqual({ok:false,code:"forbidden"});
  expect(rpc).toHaveBeenCalledWith("billing_bind_noura_basic_draft",{p_plan_version_id:id,p_expected_revision:3});
  expect(createClient).toHaveBeenCalledTimes(1);
 });
 it("rejects invalid binding identity and revision without a session call",async()=>{
  expect(await bindNouraBasicDraftAction("not-a-version",3)).toEqual({ok:false,code:"invalid_input"});
  expect(await bindNouraBasicDraftAction(id,0)).toEqual({ok:false,code:"invalid_input"});
  expect(createClient).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();
 });
 it("forwards owner denial without replacing it with an admin/service client",async()=>{
  rpc.mockResolvedValue({data:{ok:false,code:"forbidden"},error:null}); expect(await readCatalogAdminAction()).toEqual({ok:false,code:"forbidden"});
 });
 it("preserves revision conflict on save",async()=>{
  rpc.mockImplementation((name,args)=>Promise.resolve({data:{ok:false,code:name==="billing_catalog_admin_mutate"&&args.p_expected_revision===3?"conflict":"invalid_input"},error:null}));
  expect(await saveCatalogDraftAction(draft,3)).toEqual({ok:false,code:"conflict"});
 });
 it("returns immutable version and revision from publish",async()=>{
  rpc.mockImplementation((name,args)=>Promise.resolve({data:name==="billing_catalog_admin_mutate"&&args.p_operation==="publish"&&args.p_version_id===id?{ok:true,data:{revision:4,version_id:id}}:{ok:false,code:"invalid_input"},error:null}));
  expect(await publishCatalogVersionAction(id,3)).toEqual({ok:true,data:{revision:4,version_id:id}});
 });
 it("blocks invalid annual drafts before RPC",async()=>expect(await saveCatalogDraftAction({...draft,period_unit:"year"},3)).toEqual({ok:false,code:"invalid_input"}));
 it("fails closed on missing schema",async()=>{rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});expect(await readPublicCatalogBackend()).toEqual({ok:false,code:"unavailable"});});
 it("public reader rejects corrupted or enabled-checkout payloads",async()=>{rpc.mockResolvedValue({data:[{...draft,checkout_enabled:true}],error:null});expect(await readPublicCatalogBackend()).toEqual({ok:false,code:"unavailable"});});
 it("projects actual RPC price and strips private fields",async()=>{
  rpc.mockResolvedValue({data:[{...draft,product_code:"velora_ai_staff",plan_id:id,version_id:id,version:1,persona:"noor",variant:"basic",checkout_enabled:false,internal_cost:999}],error:null});
  const result=await readPublicCatalogBackend(); expect(result.ok).toBe(true); if(result.ok){expect(result.data[0].amount_baisa).toBe(45000);expect(result.data[0]).not.toHaveProperty("internal_cost");}
 });
});
