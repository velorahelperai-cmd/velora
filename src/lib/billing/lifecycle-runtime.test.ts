import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>null}));
import {runSubscriptionLifecycle} from './lifecycle-runtime';
it('disabled worker performs no persistence or cleanup calls',async()=>{const rpc=vi.fn();expect(await runSubscriptionLifecycle(false,{rpc})).toMatchObject({ok:false,code:'LIFECYCLE_DISABLED'});expect(rpc).not.toHaveBeenCalled();});
it('malformed candidate scope cannot invoke a destructive company operation',async()=>{const rpc=vi.fn(async()=>({data:['other company'],error:null}));expect(await runSubscriptionLifecycle(true,{rpc})).toMatchObject({ok:false});expect(rpc).toHaveBeenCalledTimes(1);});
it('one bounded candidate is rechecked by native transactional worker',async()=>{const cid='11111111-1111-4111-8111-111111111111',rpc=vi.fn(async(name:string)=>({data:name==='billing_expiry_candidates'?[cid]:{ok:true,code:'ACTIVE'},error:null}));expect(await runSubscriptionLifecycle(true,{rpc})).toEqual({ok:true,processed:1});expect(rpc).toHaveBeenLastCalledWith('billing_run_expiry_company',{p_company_id:cid});});
