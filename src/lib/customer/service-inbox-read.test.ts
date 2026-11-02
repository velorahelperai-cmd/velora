import {afterEach,expect,it,vi} from 'vitest';
import {fetchServiceInbox} from './service-inbox-read';
const scope={companyId:'company',actorId:'actor'};
afterEach(()=>vi.unstubAllGlobals());
it('reads without the Server Action queue, with same-origin credentials and no cache',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({ok:true,...scope}));vi.stubGlobal('fetch',fetcher);
 expect(await fetchServiceInbox(scope)).toEqual({ok:true,...scope});
 expect(fetcher).toHaveBeenCalledWith('/api/inbox/read?companyId=company&actorId=actor',expect.objectContaining({method:'GET',credentials:'same-origin',cache:'no-store'}));
});
it('rejects stale scope, transport failure and invalid data',async()=>{
 for(const response of [Response.json({ok:true,companyId:'other',actorId:'actor'}),new Response('',{status:503}),Response.json(null)]){
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));expect((await fetchServiceInbox(scope)).ok).toBe(false);
 }
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));expect(await fetchServiceInbox(scope)).toEqual({ok:false,code:'UNAVAILABLE'});
});
