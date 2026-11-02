import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fetchAttestedAccountProfile} from './account-profile-client';
const expected={userId:'actor',boundaryFingerprint:'fingerprint',generation:'generation'};
const success=()=>({ok:true,data:{userId:'actor'},attestation:{...expected,ok:true,nativeSessionId:'sid',contextGeneration:1}});
const request=vi.fn();
beforeEach(()=>{request.mockReset();vi.stubGlobal('fetch',request);});
afterEach(()=>vi.unstubAllGlobals());
it('uses one private credentialed GET with boundary expectations and validated correlation',async()=>{
 request.mockResolvedValue(Response.json(success()));
 const correlation={request_id:'VEL-0123456789ABCDEF',trace_id:'1234567890abcdef1234567890abcdef',parent_span_id:'1234567890abcdef'};
 expect(await fetchAttestedAccountProfile(expected,correlation)).toEqual(success());
 expect(request).toHaveBeenCalledTimes(1);
 expect(request).toHaveBeenCalledWith('/api/account/profile',expect.objectContaining({method:'GET',credentials:'same-origin',cache:'no-store',headers:expect.objectContaining({'x-velora-account':'actor','x-velora-boundary':'fingerprint','x-velora-generation':'generation','x-velora-request-id':correlation.request_id})}));
});
it.each(['userId','boundaryFingerprint','generation','nativeSessionId','contextGeneration'])('rejects invalid attestation %s without retaining an old result',async field=>{
 const result=success();Object.assign(result.attestation,{[field]:field==='contextGeneration'?1.5:field==='nativeSessionId'?'':'other'});
 request.mockResolvedValue(Response.json(result));
 expect(await fetchAttestedAccountProfile(expected)).toEqual({ok:false,code:'CONFLICT'});
});
it('rejects another profile actor even with matching attestation',async()=>{
 const result=success();result.data.userId='other';request.mockResolvedValue(Response.json(result));
 expect(await fetchAttestedAccountProfile(expected)).toEqual({ok:false,code:'CONFLICT'});
});
it.each(['CONFLICT','UNAUTHENTICATED','UNAVAILABLE'])('preserves %s without fallback',async code=>{
 request.mockResolvedValue(Response.json({ok:false,code},{status:503}));
 expect(await fetchAttestedAccountProfile(expected)).toEqual({ok:false,code});expect(request).toHaveBeenCalledTimes(1);
});
it('preserves confirmed expiry',async()=>{
 request.mockResolvedValue(Response.json({ok:false,code:'UNAUTHENTICATED',sessionExpired:true},{status:401}));
 expect(await fetchAttestedAccountProfile(expected)).toEqual({ok:false,code:'UNAUTHENTICATED',sessionExpired:true});
});
it.each(['throw','html','shape'])('fails safely on %s',async mode=>{
 if(mode==='throw')request.mockRejectedValue(Error('private payload'));
 else request.mockResolvedValue(mode==='html'?new Response('<html>outage</html>'):Response.json({unexpected:true}));
 expect(await fetchAttestedAccountProfile(expected)).toEqual({ok:false,code:'UNAVAILABLE'});
});
