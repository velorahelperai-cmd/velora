import {afterEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>({rpc:vi.fn(),rollout:false}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:state.rpc})}));
vi.mock("@/lib/whatsapp/integration-store",()=>({workerRolloutEnabled:()=>state.rollout,createIntegrationPorts:vi.fn()}));
import {POST} from "./route";
afterEach(()=>{vi.unstubAllEnvs();state.rpc.mockReset();state.rollout=false;});
const secret="synthetic-worker-secret-for-offline-tests-only";
describe("protected bounded WhatsApp consumer",()=>{
 const authorized=()=>{vi.stubEnv("WHATSAPP_WORKER_SECRET",secret);vi.stubEnv("WHATSAPP_WORKER_ENABLED","true");return new Request("http://localhost.invalid/worker",{method:"POST",headers:{authorization:`Bearer ${secret}`}});};
 it("does not treat HTTP/database transport success as receipt repair success",async()=>{
 state.rollout=true;state.rpc.mockResolvedValue({data:{ok:false,code:"server_role_required"},error:null});
 const r=await POST(authorized());expect(r.status).toBe(503);expect(await r.json()).toEqual({code:"REPAIR_UNAVAILABLE"});expect(state.rpc).toHaveBeenCalledTimes(1);
 });
 it("returns a bounded operational failure when the database transport throws",async()=>{
 state.rpc.mockRejectedValue(Error("synthetic database credential must stay server-side"));
 const r=await POST(authorized());expect(r.status).toBe(503);expect(await r.json()).toEqual({code:"WORKER_UNAVAILABLE"});
 });
 it("rejects malformed repair counters before claiming new work",async()=>{
 state.rollout=true;state.rpc.mockResolvedValue({data:{ok:true,repaired:-1,pending:0},error:null});
 const r=await POST(authorized());expect(r.status).toBe(503);expect(state.rpc).toHaveBeenCalledTimes(1);
 });
 it("rejects unauthorized invocation before database/provider work",async()=>{vi.stubEnv("WHATSAPP_WORKER_SECRET",secret);
 const r=await POST(new Request("http://localhost.invalid/api/internal/whatsapp/worker",{method:"POST",headers:{authorization:"Bearer wrong"}}));
 expect(r.status).toBe(401);expect(state.rpc).not.toHaveBeenCalled();});
 it("stays disabled without explicit host activation",async()=>{vi.stubEnv("WHATSAPP_WORKER_SECRET",secret);vi.stubEnv("WHATSAPP_WORKER_ENABLED","");
 const r=await POST(new Request("http://localhost.invalid/worker",{method:"POST",headers:{authorization:`Bearer ${secret}`}}));expect(r.status).toBe(503);expect(state.rpc).not.toHaveBeenCalled();});
 it("allows only receipt repair when customer AI/send rollout remains disabled",async()=>{vi.stubEnv("WHATSAPP_WORKER_SECRET",secret);vi.stubEnv("WHATSAPP_WORKER_ENABLED","true");
 state.rpc.mockResolvedValue({data:{ok:true,repaired:1,pending:0},error:null});
 const r=await POST(new Request("http://localhost.invalid/worker",{method:"POST",headers:{authorization:`Bearer ${secret}`}}));
 expect(await r.json()).toEqual({code:"CUSTOMER_ANSWERING_DISABLED",repairOnly:true});expect(state.rpc).toHaveBeenCalledTimes(1);
 expect(state.rpc).toHaveBeenCalledWith("whatsapp_repair_accepted_jobs",{p_limit:10});});
});
