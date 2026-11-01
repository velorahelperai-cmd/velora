import {afterEach,expect,it,vi} from 'vitest';
import {createSetupReader} from './setup-read-client';
const scope={expectedAccountId:'actor',companyId:'company',branchId:'branch',boundaryFingerprint:'boundary'};
afterEach(()=>vi.unstubAllGlobals());
it('shares only in-flight reads and rechecks on the next visit',async()=>{
 let finish!:(response:Response)=>void;
 const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(scope,()=>true),a=reader.read('hours'),b=reader.read('hours');
 expect(a).toBe(b);expect(fetcher).toHaveBeenCalledTimes(1);
 finish(Response.json({data:{ok:false}}));await a;
 const c=reader.read('hours');expect(fetcher).toHaveBeenCalledTimes(2);finish(Response.json({data:{ok:false}}));await c;
 expect(fetcher.mock.calls[0]).toEqual([expect.stringContaining('resource=hours'),expect.objectContaining({cache:'no-store',credentials:'same-origin',headers:{'x-velora-boundary':'boundary'}})]);
});
it('invalidates pending work on a write and rejects late replies even if abort is ignored',async()=>{
 const finish:Array<(response:Response)=>void>=[];
 vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>finish.push(resolve))));
 const reader=createSetupReader(scope,()=>true),old=reader.read('knowledge');
 const rejected=expect(old).rejects.toThrow('SCOPE_CHANGED');reader.invalidate();
 const fresh=reader.read('knowledge');finish[0](Response.json({data:'old'}));await rejected;
 expect(reader.read('knowledge')).toBe(fresh);finish[1](Response.json({data:'new'}));expect(await fresh).toBe('new');
});
it('isolates concurrent branches and refuses expired identity before and after reads',async()=>{
 const finish:Array<(response:Response)=>void>=[];
 const fetcher=vi.fn(()=>new Promise<Response>(resolve=>finish.push(resolve)));vi.stubGlobal('fetch',fetcher);
 let current=true;
 const a=createSetupReader(scope,()=>current),b=createSetupReader({...scope,branchId:'other'},()=>true);
 const first=a.read('shell'),second=b.read('shell');expect(fetcher).toHaveBeenCalledTimes(2);
 current=false;const rejected=expect(first).rejects.toThrow('SCOPE_CHANGED');
 finish[0](Response.json({data:'private'}));finish[1](Response.json({data:'other'}));await rejected;expect(await second).toBe('other');
 await expect(a.read('shell')).rejects.toThrow('SCOPE_CHANGED');expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not retry failures or retain rejected requests',async()=>{
 const fetcher=vi.fn(async()=>new Response(null,{status:503}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(scope,()=>true);await expect(reader.read('launch')).rejects.toThrow('503');expect(fetcher).toHaveBeenCalledTimes(1);
 await expect(reader.read('launch')).rejects.toThrow('503');expect(fetcher).toHaveBeenCalledTimes(2);
});

it('reuses confirmed hours on return, prefetches once, and expires the preview',async()=>{
 const value={ok:true,snapshot:{version:1},copyTargets:[]};
 const fetcher=vi.fn(async()=>Response.json({data:value}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(scope,()=>true);reader.prefetchHours();await reader.read('hours');
 expect(fetcher).toHaveBeenCalledTimes(1);expect(reader.peekHours()).toEqual(value);
 reader.prefetchHours();expect(fetcher).toHaveBeenCalledTimes(1);
 await reader.read('hours');expect(fetcher).toHaveBeenCalledTimes(1);
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+301_000);expect(reader.peekHours()).toBeNull();clock.mockRestore();
 reader.invalidate();expect(reader.peekHours()).toBeNull();
});

it('reuses successful bounded knowledge reads and selectively invalidates without exposing other branches',async()=>{
 const fetcher=vi.fn(async()=>Response.json({data:{revision:1}}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(scope,()=>true);
 await reader.read('knowledge');await reader.read('knowledge');
 expect(fetcher).toHaveBeenCalledTimes(1);
 reader.invalidate(['knowledge']);await reader.read('knowledge');expect(fetcher).toHaveBeenCalledTimes(2);
});
it('expires cached data, isolates branches and clears only affected resources',async()=>{
 let now=1000;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 const fetcher=vi.fn(async()=>Response.json({data:{revision:fetcher.mock.calls.length}}));vi.stubGlobal('fetch',fetcher);
 const a=createSetupReader(scope,()=>true),b=createSetupReader({...scope,branchId:'other'},()=>true);
 await a.read('knowledge');await a.read('language');await b.read('knowledge');
 a.invalidate(['knowledge']);await a.read('language');await a.read('knowledge');
 expect(fetcher).toHaveBeenCalledTimes(4);
 now+=30_001;await a.read('language');expect(fetcher).toHaveBeenCalledTimes(5);
 clock.mockRestore();
});
it('distinguishes identity, scope, unavailable and network failures without exposing response bodies',async()=>{
 const reader=createSetupReader(scope,()=>true);
 for(const [status,kind] of [[401,'auth'],[403,'scope'],[503,'unavailable']] as const){
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('private details',{status,headers:{'x-request-id':'c63f4722-94bc-4e68-84ba-85a729fed573','x-setup-stage':'identity'}})));
  await expect(reader.read('knowledge')).rejects.toMatchObject({kind,resource:'knowledge',stage:'identity',requestId:'c63f4722-94bc-4e68-84ba-85a729fed573'});
 }
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('private network details');}));
 await expect(reader.read('knowledge')).rejects.toMatchObject({kind:'network',resource:'knowledge'});
});
it('rejects a cached result invalidated before its consumer receives it',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({data:{revision:1}})));
 const reader=createSetupReader(scope,()=>true);await reader.read('knowledge');
 const old=reader.read('knowledge');reader.invalidate(['knowledge']);
 await expect(old).rejects.toThrow('SCOPE_CHANGED');
});
it('keeps a bounded read-only preview after reuse expires while fetching fresh data',async()=>{
 let now=1000;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 const fetcher=vi.fn(async()=>Response.json({data:{revision:fetcher.mock.calls.length}}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(scope,()=>true);await reader.read('knowledge');now+=31_000;
 expect(reader.peek('knowledge')).toEqual({revision:1});await reader.read('knowledge');expect(fetcher).toHaveBeenCalledTimes(2);
 now+=301_000;expect(reader.peek('knowledge')).toBeNull();clock.mockRestore();
});
it.each(['trial','team','launch'] as const)('retains %s presentation but always reloads action authority',async resource=>{
 const fetcher=vi.fn(async()=>Response.json({data:{version:1,canAsk:true}}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(scope,()=>true);await reader.read(resource);
 expect(reader.peek(resource)).toEqual({version:1,canAsk:true});
 await reader.read(resource);expect(fetcher).toHaveBeenCalledTimes(2);
 reader.invalidate([resource]);expect(reader.peek(resource)).toBeNull();
});
it('clears every retained preview after an authentication rejection',async()=>{
 const fetcher=vi.fn(async()=>Response.json({data:{ok:true,version:1}}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(scope,()=>true);
 for(const resource of ['hours','knowledge','language','trial','team','launch'] as const)await reader.read(resource);
 fetcher.mockImplementation(async()=>new Response(null,{status:401}));
 await expect(reader.read('trial')).rejects.toMatchObject({kind:'auth'});
 for(const resource of ['hours','knowledge','language','trial','team','launch'] as const)expect(reader.peek(resource)).toBeNull();
});
