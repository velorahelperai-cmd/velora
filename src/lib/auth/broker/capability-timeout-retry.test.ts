import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:m.rpc})}));
vi.mock('./log',()=>({brokerLog:vi.fn()}));
vi.mock('./crypto',async original=>({...await original<object>(),brokerEncryptionConfigured:()=>true}));
import {probeBrokerCapability} from './registry';
const valid={ok:true,contract_version:2,revoke_boolean:true,idle_wrappers:true,broker_registry:true,revoke_at_operation:true,refresh_lease:true,admit_ordinal:true,admit_atomic:true,issue_seq_column:true,admission_scope_column:true,complete_revocation:true,browser_bootstrap_claim:true,complete_revocation_strict:true,bound_admit:true,bound_resolve:true,codes:[]};
beforeEach(()=>vi.resetAllMocks());
it('retries one definite statement timeout and accepts only the fresh verified contract',async()=>{
 m.rpc.mockResolvedValueOnce({data:null,error:{code:'57014'}}).mockResolvedValueOnce({data:valid,error:null});
 expect((await probeBrokerCapability()).ok).toBe(true);expect(m.rpc).toHaveBeenCalledTimes(2);
});
it('fails closed when both attempts time out',async()=>{
 m.rpc.mockResolvedValue({data:null,error:{code:'57014'}});
 expect((await probeBrokerCapability()).ok).toBe(false);expect(m.rpc).toHaveBeenCalledTimes(2);
});
it('does not retry other errors or accept an incomplete contract after retry',async()=>{
 m.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202'}});
 expect((await probeBrokerCapability()).ok).toBe(false);expect(m.rpc).toHaveBeenCalledTimes(1);
 m.rpc.mockReset().mockResolvedValueOnce({data:null,error:{code:'57014'}}).mockResolvedValueOnce({data:{...valid,bound_resolve:false},error:null});
 expect((await probeBrokerCapability()).ok).toBe(false);expect(m.rpc).toHaveBeenCalledTimes(2);
});
