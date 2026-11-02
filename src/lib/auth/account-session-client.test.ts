import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchAccountSession} from './account-session-client';
const request=vi.fn();
const success=()=>({ok:true,userId:'actor',boundaryFingerprint:'fingerprint',nativeSessionId:'sid',generation:'generation',contextGeneration:1});
beforeEach(()=>{request.mockReset();vi.stubGlobal('fetch',request);});
afterEach(()=>{vi.unstubAllGlobals();});
it('reads one uncached session independently of mutation actions',async()=>{
 request.mockResolvedValue(Response.json(success()));
 const correlation={request_id:'VEL-0123456789ABCDEF',trace_id:'1234567890abcdef1234567890abcdef',parent_span_id:'1234567890abcdef'};
 expect(await fetchAccountSession(correlation)).toEqual(success());
 expect(request).toHaveBeenCalledExactlyOnceWith('/api/account/session',expect.objectContaining({method:'GET',credentials:'same-origin',cache:'no-store',headers:expect.objectContaining({'x-velora-request-id':correlation.request_id})}));
});
it.each(['UNAUTHENTICATED','QUARANTINED','CONFLICT','UNAVAILABLE'])('preserves native failure %s without fallback',async code=>{
 request.mockResolvedValue(Response.json({ok:false,code},{status:503}));expect(await fetchAccountSession()).toEqual({ok:false,code});expect(request).toHaveBeenCalledTimes(1);
});
it.each(['userId','boundaryFingerprint','nativeSessionId','generation','contextGeneration'])('rejects incomplete session field %s',async field=>{
 const result=success();Object.assign(result,{[field]:null});request.mockResolvedValue(Response.json(result));expect(await fetchAccountSession()).toEqual({ok:false,code:'CONFLICT'});
});
it('does not treat transport failure as logout',async()=>{
 request.mockRejectedValue(Error('synthetic outage'));expect(await fetchAccountSession()).toEqual({ok:false,code:'UNAVAILABLE'});
});
it('marks only explicitly requested initial document activity',async()=>{
 request.mockResolvedValue(Response.json(success()));await fetchAccountSession(undefined,true);
 expect(request.mock.calls[0][1].headers['x-velora-document-activity']).toBe('setup');
 await fetchAccountSession();expect(request.mock.calls[1][1].headers['x-velora-document-activity']).toBeUndefined();
});
it('rejects non-JSON and never retries automatically',async()=>{
 request.mockResolvedValue(new Response('<html>error</html>'));expect(await fetchAccountSession()).toEqual({ok:false,code:'UNAVAILABLE'});expect(request).toHaveBeenCalledTimes(1);
});
