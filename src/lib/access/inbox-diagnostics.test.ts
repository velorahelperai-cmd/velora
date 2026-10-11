import {afterEach,beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:state.rpc})}));
vi.mock("@/lib/tenancy/access",()=>({requirePlatformAdmin:vi.fn()}));
import {sessionConversationScope,sessionHasCompanyCapability} from "./actions";
beforeEach(()=>vi.resetAllMocks());
afterEach(()=>vi.restoreAllMocks());
it("distinguishes scope RPC error from legitimate null without exposing provider text",async()=>{
 const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
 state.rpc.mockResolvedValueOnce({data:null,error:{code:"42883",message:"PRIVATE_PROVIDER_TEXT"}}).mockResolvedValueOnce({data:null,error:null});
 expect(await sessionConversationScope("PRIVATE_COMPANY")).toBeNull();
 expect(await sessionConversationScope("PRIVATE_COMPANY")).toBeNull();
 expect(log.mock.calls).toEqual([
  ["whatsapp.inbox_read_failed",{stage:"scope_rpc",code:"RPC_ERROR",error_code:"42883"}],
  ["whatsapp.inbox_read_failed",{stage:"scope_rpc",code:"NULL_RESULT"}],
 ]);
});
it("distinguishes read capability RPC error from authoritative false while retaining false",async()=>{
 const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
 state.rpc.mockResolvedValueOnce({data:null,error:{code:"PRIVATE_TOKEN",message:"PRIVATE_PROVIDER_TEXT"}}).mockResolvedValueOnce({data:false,error:null});
 expect(await sessionHasCompanyCapability("PRIVATE_COMPANY","wa.conversations.read")).toBe(false);
 expect(await sessionHasCompanyCapability("PRIVATE_COMPANY","wa.conversations.read")).toBe(false);
 expect(log.mock.calls).toEqual([
  ["whatsapp.inbox_read_failed",{stage:"read_capability_rpc",code:"RPC_ERROR",error_code:"OTHER"}],
  ["whatsapp.inbox_read_failed",{stage:"read_capability_rpc",code:"FALSE_RESULT"}],
 ]);
});
it("successful scope and read checks emit no diagnostic",async()=>{
 const log=vi.spyOn(console,"warn").mockImplementation(()=>{});
 state.rpc.mockResolvedValueOnce({data:"assigned_only",error:null}).mockResolvedValueOnce({data:true,error:null});
 expect(await sessionConversationScope("PRIVATE_COMPANY")).toBe("assigned_only");
 expect(await sessionHasCompanyCapability("PRIVATE_COMPANY","wa.conversations.read")).toBe(true);
 expect(log).not.toHaveBeenCalled();
});
it("logger failure cannot change a fail-closed helper result",async()=>{
 vi.spyOn(console,"warn").mockImplementation(()=>{throw new Error("PRIVATE_LOGGER_FAILURE");});
 state.rpc.mockResolvedValue({data:null,error:{code:"42501",message:"PRIVATE_PROVIDER_TEXT"}});
 expect(await sessionConversationScope("PRIVATE_COMPANY")).toBeNull();
 expect(await sessionHasCompanyCapability("PRIVATE_COMPANY","wa.conversations.read")).toBe(false);
});
