import {afterEach,describe,expect,it,vi} from "vitest";
const fixture=vi.hoisted(()=>({rpc:vi.fn(),lookupError:false}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:async()=>({ok:true,context:{company:{id:"selected-a",status:"active"},membership:{role:"owner"},userId:"synthetic-owner"}})}));
vi.mock("@/lib/access/actions",()=>({sessionHasCompanyCapability:async()=>true}));
vi.mock("@/lib/whatsapp/inbox",()=>({loadWhatsappConversation:vi.fn(),loadWhatsappInbox:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:fixture.rpc,from:()=>{
 let selected:string|null=null;
 const query={select:()=>query,eq:(key:string,value:string)=>{if(key==="company_id")selected=value;return query;},
 maybeSingle:async()=>({error:fixture.lookupError?{message:"synthetic lookup failure"}:null,data:selected===null||selected==="other-b"?{id:"conversation-b",company_id:"other-b"}:null})};
 return query;
}})}));
import {controlWhatsappConversation,upsertConversationLeadState} from "./actions";
afterEach(()=>{fixture.rpc.mockReset();fixture.lookupError=false;});
describe("human control binds to the selected company",()=>{
 const request={conversationId:"conversation-b",action:"take_over" as const,expectedRevision:1};
 it("cannot mutate another authorized company's stale conversation through the selected workspace",async()=>{
  fixture.rpc.mockResolvedValue({data:{ok:true,conversation:{id:"conversation-b",status:"handed_over",automation_allowed:false,automation_generation:1,control_revision:2}},error:null});
  expect(await controlWhatsappConversation(request)).toMatchObject({ok:false,code:"NOT_FOUND"});expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it("denies the mutation if selected-company binding cannot be read",async()=>{
  fixture.lookupError=true;expect(await controlWhatsappConversation(request)).toMatchObject({ok:false,code:"UNAVAILABLE"});expect(fixture.rpc).not.toHaveBeenCalled();
 });
 it("cannot update lead state for a stale conversation from another selected workspace",async()=>{
  fixture.rpc.mockResolvedValue({error:null,data:{ok:true}});
  expect(await upsertConversationLeadState({conversationId:"conversation-b",expectedLeadRevision:1,leadStage:"contacted",leadStageReason:"Synthetic",internalNote:"Synthetic",followUpStatus:"none",followUpAt:null})).toMatchObject({ok:false,code:"NOT_FOUND"});
  expect(fixture.rpc).not.toHaveBeenCalled();
 });
});
