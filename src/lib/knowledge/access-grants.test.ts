import {beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({role:"staff",suspended:false,cap:vi.fn(),client:vi.fn()}));
vi.mock("@/lib/tenancy/access",()=>({getCompanyAccess:async()=>({ok:true,context:{userId:"user",company:{id:"company-b",status:state.suspended?"suspended":"active"},membership:{role:state.role}}}),requirePlatformAdmin:vi.fn()}));
vi.mock("@/lib/access/actions",()=>({sessionHasCompanyCapability:state.cap}));
vi.mock("@/lib/supabase/server",()=>({createClient:state.client}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import {listKnowledgeSources,saveTextKnowledgeSource,deleteKnowledgeSource} from "./actions";
describe("knowledge grants are checked on the server",()=>{
 beforeEach(()=>{vi.clearAllMocks();state.role="staff";state.suspended=false;state.cap.mockResolvedValue(false);const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};state.client.mockResolvedValue({from:()=>q});});
 it("denies ungranted staff reads",async()=>{expect(await listKnowledgeSources()).toMatchObject({ok:false,code:"FORBIDDEN"});expect(state.cap).toHaveBeenCalledWith("company-b","knowledge.read");expect(state.client).not.toHaveBeenCalled();});
 it("allows explicit read grant only for the selected company",async()=>{state.cap.mockResolvedValue(true);expect(await listKnowledgeSources()).toMatchObject({ok:true});expect(state.cap).toHaveBeenCalledWith("company-b","knowledge.read");});
 it("rejects staff writes despite a readable company",async()=>{expect(await saveTextKnowledgeSource({title:"Valid title",content:"Valid content"})).toMatchObject({ok:false,code:"FORBIDDEN"});expect(state.cap).toHaveBeenCalledWith("company-b","knowledge.write");expect(state.client).not.toHaveBeenCalled();});
 it("checks delete independently of write",async()=>{state.cap.mockImplementation(async(_id:string,cap:string)=>cap==="knowledge.write");expect(await deleteKnowledgeSource("00000000-0000-0000-0000-000000000001")).toMatchObject({ok:false,code:"FORBIDDEN"});expect(state.cap).toHaveBeenCalledWith("company-b","knowledge.delete");expect(state.client).not.toHaveBeenCalled();});
 it("denies a suspended owner",async()=>{state.role="owner";state.suspended=true;expect(await listKnowledgeSources()).toMatchObject({ok:false,code:"FORBIDDEN"});expect(state.client).not.toHaveBeenCalled();});
 it("preserves owner access without inventing a staff grant",async()=>{state.role="owner";expect(await listKnowledgeSources()).toMatchObject({ok:true});expect(state.cap).not.toHaveBeenCalled();});
 it.each([null, undefined, 42, [], {title:42,content:"text"}, {title:"title",content:null}, {title:"title",content:42}, {id:42,title:"title",content:"text"}, {title:"title",content:"text",usageRole:42}])("returns INVALID_INPUT for malformed runtime input %j",async input=>{
  expect(await saveTextKnowledgeSource(input as unknown as Parameters<typeof saveTextKnowledgeSource>[0])).toEqual({ok:false,code:"INVALID_INPUT"});
  expect(state.client).not.toHaveBeenCalled();expect(state.cap).not.toHaveBeenCalled();
 });
});
