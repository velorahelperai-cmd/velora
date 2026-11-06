import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:f.rpc})}));
import {readInboxCapability} from './inbox-capability';
beforeEach(()=>{vi.resetAllMocks();vi.spyOn(console,'warn').mockImplementation(()=>{});});
afterEach(()=>vi.restoreAllMocks());
it.each([true,false])('requires a successful exact boolean: %s',async allowed=>{
 f.rpc.mockResolvedValue({data:allowed,error:null});
 expect(await readInboxCapability('company','wa.conversations.read')).toEqual({ok:true,allowed});
 expect(f.rpc).toHaveBeenCalledWith('has_company_capability',{p_company_id:'company',p_capability:'wa.conversations.read'});
});
it.each(['PGRST202','42883','OTHER'])('never grants or calls a fallback on RPC error %s',async code=>{
 f.rpc.mockResolvedValue({data:true,error:{code,message:'PRIVATE_ERROR'}});
 expect(await readInboxCapability('company','wa.conversations.read')).toEqual({ok:false,code:'UNAVAILABLE'});
 expect(f.rpc).toHaveBeenCalledOnce();expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('PRIVATE_ERROR');
});
it('retries one definite statement timeout and accepts only a fresh boolean grant',async()=>{
 f.rpc.mockResolvedValueOnce({data:null,error:{code:'57014',message:'PRIVATE_ERROR'}}).mockResolvedValueOnce({data:true,error:null});
 expect(await readInboxCapability('company','wa.conversations.read')).toEqual({ok:true,allowed:true});
 expect(f.rpc).toHaveBeenCalledTimes(2);expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('PRIVATE_ERROR');
});
it('fails closed when both capability attempts time out',async()=>{
 f.rpc.mockResolvedValue({data:null,error:{code:'57014',message:'PRIVATE_ERROR'}});
 expect(await readInboxCapability('company','wa.conversations.read')).toEqual({ok:false,code:'UNAVAILABLE'});
 expect(f.rpc).toHaveBeenCalledTimes(2);
});
it.each(['42501','PGRST301'])('explicit authorization failure %s cannot retain access',async code=>{
 f.rpc.mockResolvedValue({data:true,error:{code}});
 expect(await readInboxCapability('company','ig.conversations.read')).toEqual({ok:false,code:'FORBIDDEN'});
});
it.each([null,undefined,'true',{},[true]])('malformed data %j cannot grant access',async data=>{
 f.rpc.mockResolvedValue({data,error:null});
 expect(await readInboxCapability('company','ig.conversations.read')).toEqual({ok:false,code:'UNAVAILABLE'});
});
it('transport exception remains unavailable',async()=>{
 f.rpc.mockRejectedValue(new Error('PRIVATE_TRANSPORT'));
 expect(await readInboxCapability('company','wa.conversations.read')).toEqual({ok:false,code:'UNAVAILABLE'});
});
