import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const s=vi.hoisted(()=>({resolve:vi.fn(),cookies:[{name:'opaque',value:'A'}]}));
vi.mock('react',()=>({cache:(fn:unknown)=>fn}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>s.cookies})}));
vi.mock('@/lib/auth/broker',()=>({createBrokerUserClient:s.resolve}));
vi.mock('@/lib/auth/broker/provider',()=>({createProviderAuthClient:()=>{throw Error('guest fallback forbidden');}}));
import {createClient,createBrokerBoundClient,runWithVerifiedReadClient} from './server';
const boundary={boundaryFingerprint:'fingerprint',userId:'actor',nativeSessionId:'sid',cookieName:'opaque',generation:'generation',authOrdinal:1,contextGeneration:1,browserLineageId:'lineage'};
const bound=(client={label:'client'},change={})=>({ok:true,client,resolve:{registryId:'registry',boundary:{...boundary,...change}}});
beforeEach(()=>{vi.resetAllMocks();s.cookies=[{name:'opaque',value:'A'}];s.resolve.mockImplementation(async()=>bound());});
it('reuses only the operation client and always resolves a fresh final boundary',async()=>{
 const clients:unknown[]=[];const result=await runWithVerifiedReadClient(async()=>{clients.push(await createClient());clients.push(await createClient());return 'rows';});
 expect(result).toEqual({value:'rows',actorId:'actor'});expect(clients[0]).toBe(clients[1]);expect(s.resolve).toHaveBeenCalledTimes(2);
 await createClient();expect(s.resolve).toHaveBeenCalledTimes(3);
});
it.each(['UNAUTHENTICATED','UNAVAILABLE'])('does not start a read when initial authority is %s',async code=>{
 s.resolve.mockResolvedValue({ok:false,code});const read=vi.fn();await expect(runWithVerifiedReadClient(read)).rejects.toThrow();expect(read).not.toHaveBeenCalled();
});
it.each(['UNAUTHENTICATED','UNAVAILABLE'])('discards loaded rows when final authority is %s',async code=>{
 s.resolve.mockResolvedValueOnce(bound()).mockResolvedValueOnce({ok:false,code});await expect(runWithVerifiedReadClient(async()=>{await createClient();return 'private rows';})).rejects.toThrow();
});
it.each(Object.keys(boundary))('discards loaded rows after boundary field %s changes',async field=>{
 s.resolve.mockResolvedValueOnce(bound()).mockResolvedValueOnce(bound(undefined,{[field]:'changed'}));await expect(runWithVerifiedReadClient(async()=>'private rows')).rejects.toThrow();
});
it('does not allow a swallowed cookie-switch error to publish rows',async()=>{
 await expect(runWithVerifiedReadClient(async()=>{s.cookies=[{name:'opaque',value:'B'}];try{await createClient();}catch{}s.cookies=[{name:'opaque',value:'A'}];return 'private rows';})).rejects.toThrow();
});
it('discards a registry replacement even when the public boundary fields match',async()=>{
 s.resolve.mockResolvedValueOnce(bound()).mockResolvedValueOnce({...bound(),resolve:{...bound().resolve,registryId:'replacement'}});
 await expect(runWithVerifiedReadClient(async()=>'private rows')).rejects.toThrow();
});
it('checks cookies again after final authority resolves',async()=>{
 s.resolve.mockResolvedValueOnce(bound()).mockImplementationOnce(async()=>{s.cookies=[{name:'opaque',value:'B'}];return bound();});
 await expect(runWithVerifiedReadClient(async()=>'private rows')).rejects.toThrow();
});
it('keeps explicit fresh writer fences outside the reused client',async()=>{
 await runWithVerifiedReadClient(async()=>{await createClient();await createBrokerBoundClient({fresh:true});await createClient();});expect(s.resolve).toHaveBeenCalledTimes(3);
});
it('isolates concurrent operations and does not retain a scope in detached work',async()=>{
 const clients:unknown[]=[];let release!:()=>void;let detached!:Promise<unknown>;
 await Promise.all([runWithVerifiedReadClient(async()=>{clients.push(await createClient());detached=(async()=>{await new Promise<void>(r=>{release=r;});return createClient();})();}),runWithVerifiedReadClient(async()=>{clients.push(await createClient());})]);
 expect(clients[0]).not.toBe(clients[1]);expect(s.resolve).toHaveBeenCalledTimes(4);release();await detached;expect(s.resolve).toHaveBeenCalledTimes(5);
});
