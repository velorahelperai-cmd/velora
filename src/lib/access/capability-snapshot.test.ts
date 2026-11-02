import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const state=vi.hoisted(()=>({rpc:vi.fn(),client:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:state.client}));
import {readCompanyCapabilitySnapshot} from './capability-snapshot';
const company='11111111-1111-4111-8111-111111111111';
const caps=['wa.conversations.reply','wa.conversations.assign'] as const;
beforeEach(()=>{vi.resetAllMocks();state.client.mockResolvedValue({rpc:state.rpc});state.rpc.mockResolvedValue({data:{company_id:company,capabilities:{[caps[0]]:true,[caps[1]]:false}},error:null});});
it('reads several permissions in one native request without inventing grants',async()=>{
 expect(await readCompanyCapabilitySnapshot(company,caps)).toEqual({ok:true,capabilities:{[caps[0]]:true,[caps[1]]:false}});
 expect(state.client).toHaveBeenCalledTimes(1);
 expect(state.rpc).toHaveBeenCalledExactlyOnceWith('company_capability_snapshot',{p_company_id:company,p_capabilities:[...caps]});
});
it.each([null,{}, {company_id:'foreign',capabilities:{[caps[0]]:true,[caps[1]]:false}}, {company_id:company,capabilities:{[caps[0]]:true}}, {company_id:company,capabilities:{[caps[0]]:'true',[caps[1]]:false}}])('rejects incomplete or unbound response %#',async data=>{
 state.rpc.mockResolvedValue({data,error:null});expect(await readCompanyCapabilitySnapshot(company,caps)).toEqual({ok:false});
});
it('does not cache permissions across reads',async()=>{
 await readCompanyCapabilitySnapshot(company,caps);state.rpc.mockResolvedValue({data:{company_id:company,capabilities:{[caps[0]]:false,[caps[1]]:false}},error:null});
 expect(await readCompanyCapabilitySnapshot(company,caps)).toEqual({ok:true,capabilities:{[caps[0]]:false,[caps[1]]:false}});expect(state.rpc).toHaveBeenCalledTimes(2);
});
it('fails closed for RPC and broker errors without returning partial grants',async()=>{
 state.rpc.mockResolvedValue({data:{company_id:company,capabilities:{[caps[0]]:true,[caps[1]]:true}},error:{message:'private'}});
 expect(await readCompanyCapabilitySnapshot(company,caps)).toEqual({ok:false});state.client.mockRejectedValue(new Error('private'));
 expect(await readCompanyCapabilitySnapshot(company,caps)).toEqual({ok:false});
});
