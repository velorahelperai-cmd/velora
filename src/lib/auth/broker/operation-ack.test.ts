import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),single:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc,from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:mocks.single};return q;}})}));
import { updateBrokerOperation } from "./registry";
beforeEach(()=>{vi.resetAllMocks();mocks.single.mockResolvedValue({error:null,data:{operation_key:"synthetic-op",kind:"password_revoke",actor_user_id:"actor",status:"confirmed",revision:3,stages:{nativeRevocation:"confirmed",clientCleanup:"not_attempted"}}});mocks.rpc.mockResolvedValue({error:null,data:{ok:true}});});
it("confirmed client cleanup requires actual durable RPC success",async()=>{
 mocks.rpc.mockResolvedValue({error:{code:"SYNTHETIC_WRITE_FAILURE"},data:null});
 expect(await updateBrokerOperation("synthetic-op",{status:"confirmed",stages:{nativeRevocation:"confirmed",clientCleanup:"confirmed"}})).toBe(false);
 expect(mocks.rpc).toHaveBeenCalledOnce();
});
it("terminal operation rejects unrelated stage mutation",async()=>{
 expect(await updateBrokerOperation("synthetic-op",{status:"confirmed",stages:{nativeRevocation:"unknown",clientCleanup:"confirmed"}})).toBe(false);
 expect(mocks.rpc).not.toHaveBeenCalled();
});

it("confirmed cleanup acknowledgment forwards revision and reports persisted success",async()=>{
 const patch={status:"confirmed",stages:{nativeRevocation:"confirmed",clientCleanup:"confirmed"}};
 expect(await updateBrokerOperation("synthetic-op",patch)).toBe(true);
 expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("vel_broker_patch_operation",{p_operation_key:"synthetic-op",p_expected_revision:3,p_patch:patch});
});
