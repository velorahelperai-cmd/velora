import {beforeEach,expect,it,vi} from 'vitest';
const read=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/tenancy/account-profile-read',()=>({readAttestedAccountProfile:read}));
import {GET} from './route';
const boundary={'x-velora-account':'actor','x-velora-boundary':'fingerprint','x-velora-generation':'generation'};
const request=(headers:Record<string,string>=boundary,suffix='')=>new Request('https://velora.test/api/account/profile'+suffix,{headers});
beforeEach(()=>{read.mockReset();});
it('returns unavailable without profile reads for an aborted request',async()=>{
 const controller=new AbortController();controller.abort();
 const response=await GET(new Request('https://velora.test/api/account/profile',{headers:boundary,signal:controller.signal}));
 expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,code:'UNAVAILABLE'});expect(read).not.toHaveBeenCalled();
});
it('passes expectations only to the authoritative reader and never caches private responses',async()=>{
 read.mockResolvedValue({ok:true,data:{userId:'actor'},attestation:{ok:true}});
 const response=await GET(request());expect(response.status).toBe(200);
 expect(read).toHaveBeenCalledWith({userId:'actor',boundaryFingerprint:'fingerprint',generation:'generation'},null);
 expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');
});
it.each<Record<string,string>>([{'sec-fetch-site':'cross-site'},{origin:'https://foreign.test'}])('rejects foreign-origin request before authority reads',async extra=>{
 expect((await GET(request({...boundary,...extra}))).status).toBe(403);expect(read).not.toHaveBeenCalled();
});
it.each([{}, {...boundary,'x-velora-account':'invalid actor'},{...boundary,'x-velora-generation':'a'.repeat(129)}])('rejects invalid expectations',async headers=>{
 expect((await GET(request(headers))).status).toBe(400);expect(read).not.toHaveBeenCalled();
});
it('rejects query strings rather than putting private expectations in URLs',async()=>{
 expect((await GET(request(boundary,'?account=actor'))).status).toBe(400);expect(read).not.toHaveBeenCalled();
});
it.each([['CONFLICT',409],['UNAUTHENTICATED',401],['UNAVAILABLE',503]] as const)('returns non-cacheable %s',async(code,status)=>{
 read.mockResolvedValue({ok:false,code});const response=await GET(request());
 expect(response.status).toBe(status);expect(await response.json()).toEqual({ok:false,code});expect(response.headers.get('cache-control')).toContain('no-store');
});
it('does not expose unexpected server errors',async()=>{
 read.mockRejectedValue(Error('sensitive detail'));const response=await GET(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,code:'UNAVAILABLE'});
});
