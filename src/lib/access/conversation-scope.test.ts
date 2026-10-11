import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:state.rpc})}));
import {readSessionConversationScope} from "./conversation-scope";
beforeEach(()=>{vi.resetAllMocks();vi.spyOn(console,"warn").mockImplementation(()=>{});});
afterEach(()=>vi.restoreAllMocks());
describe("typed scope RPC result",()=>{
 it("recognizes exact successful null as no authorized scope, including missing or disabled grants",async()=>{
  state.rpc.mockResolvedValue({data:null,error:null});
  expect(await readSessionConversationScope("synthetic-company")).toEqual({ok:false,code:"FORBIDDEN"});
 });
 it.each(["all_company","assigned_only"])("accepts the scalar scope %s",async scope=>{
  state.rpc.mockResolvedValue({data:scope,error:null});
  expect(await readSessionConversationScope("synthetic-company")).toEqual({ok:true,scope});
 });
 it.each([undefined,false,0,"",[],{},["all_company"],{scope:"all_company"},"unknown"])("keeps malformed response %j unavailable",async data=>{
  state.rpc.mockResolvedValue({data,error:null});
  expect(await readSessionConversationScope("synthetic-company")).toEqual({ok:false,code:"UNAVAILABLE"});
 });
 it("gives RPC error precedence over null data, including expired JWT transport errors",async()=>{
  state.rpc.mockResolvedValue({data:null,error:{code:"PGRST301",message:"PRIVATE_EXPIRED_TOKEN"}});
  expect(await readSessionConversationScope("synthetic-company")).toEqual({ok:false,code:"UNAVAILABLE"});
 });
 it("keeps thrown transport failure unavailable",async()=>{
  state.rpc.mockRejectedValue(new Error("PRIVATE_TRANSPORT"));
  expect(await readSessionConversationScope("synthetic-company")).toEqual({ok:false,code:"UNAVAILABLE"});
 });
});
