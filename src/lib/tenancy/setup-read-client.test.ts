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

it('retains only hours preview, prefetches once, and clears it on invalidation or expiry',async()=>{
 const value={ok:true,snapshot:{version:1},copyTargets:[]};
 const fetcher=vi.fn(async()=>Response.json({data:value}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(scope,()=>true);reader.prefetchHours();await reader.read('hours');
 expect(fetcher).toHaveBeenCalledTimes(1);expect(reader.peekHours()).toEqual(value);
 reader.prefetchHours();expect(fetcher).toHaveBeenCalledTimes(1);
 await reader.read('hours');expect(fetcher).toHaveBeenCalledTimes(2); // preview never grants authority
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+31_000);expect(reader.peekHours()).toBeNull();clock.mockRestore();
 reader.invalidate();expect(reader.peekHours()).toBeNull();
});
