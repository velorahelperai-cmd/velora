import {beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:mock.rpc})}));
import {settleHmacVerifiedViaRpc} from "./store";
beforeEach(()=>{vi.clearAllMocks();mock.rpc.mockResolvedValue({data:{ok:true,outcome:"granted"},error:null});});
it("routes Live HMAC evidence through the guarded Live service contract",async()=>{await settleHmacVerifiedViaRpc({provider_environment:"live"});expect(mock.rpc).toHaveBeenCalledWith("billing_settle_live_paymob_hmac_verified",{p_evidence:{provider_environment:"live"}});});
it("keeps Test HMAC settlement on its unchanged RPC",async()=>{await settleHmacVerifiedViaRpc({provider_environment:"test"});expect(mock.rpc).toHaveBeenCalledWith("billing_settle_paymob_hmac_verified",{p_evidence:{provider_environment:"test"}});});
