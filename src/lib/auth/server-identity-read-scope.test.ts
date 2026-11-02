import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const state=vi.hoisted(()=>({broker:vi.fn(),user:vi.fn(),guard:vi.fn(),cookies:[{name:'opaque',value:'A'}]}));
vi.mock('react',()=>({cache:(fn:unknown)=>fn}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>state.cookies})}));
vi.mock('@/lib/auth/broker',()=>({createBrokerUserClient:state.broker}));
vi.mock('@/lib/auth/broker/provider',()=>({createProviderAuthClient:()=>{throw Error('no guest fallback');}}));
vi.mock('./session-guard',()=>({checkAppSession:state.guard}));
import {runWithVerifiedReadClient} from '@/lib/supabase/server';
import {readSessionIdentity} from './server-identity';

const boundary={boundaryFingerprint:'fingerprint',userId:'actor',nativeSessionId:'sid',cookieName:'opaque',generation:'generation',authOrdinal:1,contextGeneration:1,browserLineageId:'lineage'};
const bound=()=>({ok:true,client:{auth:{getUser:state.user}},resolve:{registryId:'registry',boundary:{...boundary}}});
beforeEach(()=>{
 vi.resetAllMocks();state.cookies=[{name:'opaque',value:'A'}];
 state.broker.mockImplementation(async()=>bound());
 state.user.mockResolvedValue({data:{user:{id:'actor',email_confirmed_at:'2026-01-01'}},error:null});
 state.guard.mockResolvedValue({ok:true,expiresAt:'2026-12-01'});
});

it('shares only scoped broker transport while checking identity and session on every read',async()=>{
 const result=await runWithVerifiedReadClient(async()=>{
  const first=await readSessionIdentity({readOnly:true});
  const second=await readSessionIdentity({readOnly:true});
  expect(first).not.toHaveProperty('contextGeneration');
  expect(second).toMatchObject({ok:true,userId:'actor'});
  expect(state.broker).toHaveBeenCalledTimes(1);
  return second;
 });
 expect(result.actorId).toBe('actor');
 expect(state.broker).toHaveBeenCalledTimes(2);
 expect(state.user).toHaveBeenCalledTimes(2);expect(state.guard).toHaveBeenCalledTimes(2);
});

it('retains ordinary action resolution even inside a read scope',async()=>{
 await runWithVerifiedReadClient(async()=>readSessionIdentity());
 expect(state.broker).toHaveBeenCalledTimes(3);
});

it('does not reuse completed identities outside a verified operation',async()=>{
 await readSessionIdentity({readOnly:true});await readSessionIdentity({readOnly:true});
 expect(state.broker).toHaveBeenCalledTimes(2);expect(state.guard).toHaveBeenCalledTimes(2);
});

it('observes native session revocation between scoped identity reads',async()=>{
 state.guard.mockResolvedValueOnce({ok:true}).mockResolvedValueOnce({ok:false,code:'UNAUTHENTICATED'});
 const result=await runWithVerifiedReadClient(async()=>{
  expect(await readSessionIdentity({readOnly:true})).toMatchObject({ok:true});
  return readSessionIdentity({readOnly:true});
 });
 expect(result.value).toEqual({ok:false,code:'UNAUTHENTICATED'});
});

it('rejects changed native identity despite unchanged broker transport',async()=>{
 state.user.mockResolvedValue({data:{user:{id:'other'}},error:null});
 const result=await runWithVerifiedReadClient(()=>readSessionIdentity({readOnly:true}));
 expect(result.value).toEqual({ok:false,code:'UNAUTHENTICATED'});
});

it('withholds successful identity results if the final broker fence fails',async()=>{
 state.broker.mockResolvedValueOnce(bound()).mockResolvedValueOnce({ok:false,code:'UNAUTHENTICATED'});
 await expect(runWithVerifiedReadClient(()=>readSessionIdentity({readOnly:true}))).rejects.toThrow();
});

it('invalidates the operation even when an identity reader catches cookie drift',async()=>{
 await expect(runWithVerifiedReadClient(async()=>{
  state.cookies=[{name:'opaque',value:'B'}];
  expect(await readSessionIdentity({readOnly:true})).toEqual({ok:false,code:'UNAVAILABLE'});
  state.cookies=[{name:'opaque',value:'A'}];return 'private data';
 })).rejects.toThrow();
});
