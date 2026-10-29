import {beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({rpc:vi.fn(),gate:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:mock.rpc})}));
vi.mock('@/lib/tenancy/access',()=>({requirePlatformAdmin:mock.gate}));
import {accessGetUserSnapshot} from './actions';
beforeEach(()=>{vi.resetAllMocks();mock.gate.mockResolvedValue({ok:true});});
it('does not expose provider errors or unknown RPC result codes',async()=>{
 for(const response of [{data:null,error:{message:'private.internal_secret'}},{data:{ok:false,code:'private.internal_secret'},error:null}]){
  mock.rpc.mockResolvedValue(response);
  const result=await accessGetUserSnapshot('11111111-1111-4111-8111-111111111111');
  expect(result).toMatchObject({ok:false,code:'UNAVAILABLE'});
  expect(JSON.stringify(result)).not.toContain('private.internal_secret');
 }
});
it('requires admin authority before requesting another user snapshot',async()=>{
 mock.gate.mockResolvedValue({ok:false,code:'UNAUTHENTICATED'});
 expect(await accessGetUserSnapshot('11111111-1111-4111-8111-111111111111')).toEqual({ok:false,code:'UNAUTHENTICATED'});
 expect(mock.rpc).not.toHaveBeenCalled();
});
