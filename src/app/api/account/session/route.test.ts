import {beforeEach,expect,it,vi} from 'vitest';
const read=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/auth/account-session-read',()=>({readAccountSession:read}));
import {GET} from './route';
beforeEach(()=>{read.mockReset();});
it('returns unavailable without native reads for an aborted request',async()=>{
 const controller=new AbortController();controller.abort();
 const response=await GET(new Request('https://velora.test/api/account/session',{signal:controller.signal}));
 expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,code:'UNAVAILABLE'});expect(read).not.toHaveBeenCalled();
});
const request=(headers:Record<string,string>={},search='')=>new Request('https://velora.test/api/account/session'+search,{headers});
it('ignores caller identity claims and never caches native session metadata',async()=>{
 read.mockResolvedValue({ok:true,userId:'native'});
 const response=await GET(request({'x-velora-account':'forged','x-user-id':'forged'}));
 expect(response.status).toBe(200);expect(read).toHaveBeenCalledWith(null);expect(await response.json()).toEqual({ok:true,userId:'native'});
 expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');
});
it.each<Record<string,string>>([{'sec-fetch-site':'cross-site'},{origin:'https://foreign.test'}])('rejects foreign origin before native reads',async headers=>{
 expect((await GET(request(headers))).status).toBe(403);expect(read).not.toHaveBeenCalled();
});
it('rejects query parameters',async()=>{expect((await GET(request({},'?user=forged'))).status).toBe(400);expect(read).not.toHaveBeenCalled();});
it('passes initial same-origin setup activity to the native session check',async()=>{
 read.mockResolvedValue({ok:true,userId:'native'});
 expect((await GET(request({'x-velora-document-activity':'setup',referer:'https://velora.test/setup?next=%2Faccount'}))).status).toBe(200);
 expect(read).toHaveBeenCalledWith(null,true);
});
it.each(['','https://foreign.test/setup','https://velora.test/app'])('rejects setup activity with incompatible referrer %s',async referer=>{
 expect((await GET(request({'x-velora-document-activity':'setup',referer}))).status).toBe(403);expect(read).not.toHaveBeenCalled();
});
it.each([['UNAUTHENTICATED',401],['CONFLICT',409],['UNAVAILABLE',503]] as const)('preserves failure %s',async(code,status)=>{
 read.mockResolvedValue({ok:false,code});const response=await GET(request());expect(response.status).toBe(status);expect(await response.json()).toEqual({ok:false,code});expect(response.headers.get('cache-control')).toContain('no-store');
});
it('contains unexpected server errors',async()=>{read.mockRejectedValue(Error('private detail'));expect(await(await GET(request())).json()).toEqual({ok:false,code:'UNAVAILABLE'});});
