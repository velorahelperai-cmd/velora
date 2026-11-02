import {beforeEach,expect,it,vi} from 'vitest';
const read=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/customer/service-inbox-actions',()=>({readServiceInbox:read}));
import {GET} from './route';
const companyId='11111111-1111-4111-8111-111111111111',actorId='22222222-2222-4222-8222-222222222222';
const request=()=>new Request(`https://velora.test/api/inbox/read?${new URLSearchParams({companyId,actorId})}`);
beforeEach(()=>{vi.resetAllMocks();read.mockResolvedValue({ok:true,companyId,actorId});});
it('uses the native reader and disables browser and shared caching',async()=>{
 const response=await GET(request());expect(read).toHaveBeenCalledOnce();expect(response.status).toBe(200);
 expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');
 expect(await response.json()).toEqual({ok:true,companyId,actorId});
});
it('never publishes a different actor or company snapshot',async()=>{
 for(const change of [{actorId:companyId},{companyId:actorId}]){
  read.mockResolvedValue({ok:true,companyId,actorId,...change,secret:'private'});
  const response=await GET(request());expect(response.status).toBe(409);expect(await response.json()).toEqual({ok:false,code:'SCOPE_CHANGED'});
 }
});
it('keeps native denial and exceptions fail closed without exception contents',async()=>{
 read.mockResolvedValue({ok:false,code:'FORBIDDEN'});expect(await (await GET(request())).json()).toEqual({ok:false,code:'FORBIDDEN'});
 read.mockRejectedValue(new Error('private detail'));const response=await GET(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,code:'UNAVAILABLE'});
});
it('rejects ambiguous or malformed scope before loading data',async()=>{
 for(const url of ['?companyId=bad','?'+new URLSearchParams({companyId,actorId})+'&companyId='+companyId])expect((await GET(new Request('https://velora.test/api/inbox/read'+url))).status).toBe(400);
 expect(read).not.toHaveBeenCalled();
});
