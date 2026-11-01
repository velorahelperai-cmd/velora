import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn(),stream:vi.fn(),recover:vi.fn()}));
vi.mock('@/lib/auth/server-identity',()=>({readSessionIdentity:m.identity}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:m.rpc})}));
vi.mock('@/lib/answers/provider',()=>({getAnswerProvider:()=>({streamTrial:m.stream})}));
vi.mock('@/lib/tenancy/paid-assistant-trial-actions',()=>({recoverOwnedBranchAssistantTrialAction:m.recover}));
import {GET,POST} from './route';
const scope={expectedAccountId:'11111111-1111-4111-8111-111111111111',companyId:'22222222-2222-4222-8222-222222222222',branchId:'33333333-3333-4333-8333-333333333333',operationId:'44444444-4444-4444-8444-444444444444'};
const handle={id:'private_provider_id',modelId:'gemini-3.5-flash-lite'};
const request=(boundary='boundary')=>new Request(`https://velora.test/api/setup/trial-stream?${new URLSearchParams(scope)}`,{headers:{'x-velora-boundary':boundary}});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('VELORA_LOCAL_CUSTOMER_MODE','');vi.stubEnv('VELORA_TRIAL_PINNED_BRANCH_ID','');m.identity.mockResolvedValue({ok:true,userId:scope.expectedAccountId,nativeSessionId:scope.operationId,boundaryFingerprint:'boundary'});m.rpc.mockResolvedValue({data:{ok:true,handle},error:null});m.stream.mockImplementation(async function*(){yield 'الأحد ';yield 'الأحد 10:00–14:00';});});
afterEach(()=>vi.unstubAllEnvs());
it('requires current native identity, boundary and database operation ownership before streaming',async()=>{
 expect((await GET(request('old'))).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();
 m.rpc.mockResolvedValue({data:{ok:false},error:null});expect((await GET(request())).status).toBe(403);expect(m.stream).not.toHaveBeenCalled();
 m.identity.mockResolvedValue({ok:false});expect((await GET(request())).status).toBe(401);
});
it('streams only text with no provider ID or financial writes and disables caching',async()=>{
 const response=await GET(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 const body=await response.text();expect(body).toContain('الأحد');expect(body).not.toContain('private_provider_id');
 expect(m.rpc).toHaveBeenCalledOnce();expect(m.rpc.mock.calls[0][0]).toBe('es02_read_trial_stream');
});
it('does not start a replacement when no saved handle exists',async()=>{
 m.rpc.mockResolvedValue({data:{ok:true,handle:null},error:null});expect((await GET(request())).status).toBe(204);expect(m.stream).not.toHaveBeenCalled();
});
it('retains the restricted local branch fence',async()=>{
 vi.stubEnv('VELORA_LOCAL_CUSTOMER_MODE','live');expect((await GET(request())).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();
});
it('closes a failed stream without exposing raw errors or retrying',async()=>{
 m.stream.mockImplementation(async function*(){yield 'جزء';throw Error('secret');});
 const response=await GET(request());expect(await response.text()).not.toContain('secret');expect(m.stream).toHaveBeenCalledOnce();
});

it('protects recovery POST against cross-origin, stale identity and invalid scope',async()=>{
 const post=(headers:Record<string,string>={},query=scope)=>new Request(`https://velora.test/api/setup/trial-stream?${new URLSearchParams(query)}`,{method:'POST',headers:{'x-velora-boundary':'boundary',...headers}});
 expect((await POST(post({origin:'https://evil.test'}))).status).toBe(403);
 expect((await POST(post({'x-velora-boundary':'old'}))).status).toBe(403);
 expect((await POST(post({}, {...scope,operationId:'bad'}))).status).toBe(400);
 expect(m.recover).not.toHaveBeenCalled();
 m.identity.mockResolvedValue({ok:false});expect((await POST(post())).status).toBe(401);
});
it('uses only guarded recovery for the existing operation and returns private uncached results',async()=>{
 m.recover.mockResolvedValue({ok:false,code:'TRIAL_PENDING'});
 const response=await POST(new Request(request(),{method:'POST',headers:{'x-velora-boundary':'boundary',origin:'https://velora.test'}}));
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(m.recover).toHaveBeenCalledExactlyOnceWith(scope);expect(m.stream).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
});

it('recovers through an HTTPS proxy with exact public Host and browser same-origin evidence',async()=>{
 m.recover.mockResolvedValue({ok:false,code:'TRIAL_PENDING'});
 const response=await POST(new Request(`http://localhost:3330/api/setup/trial-stream?${new URLSearchParams(scope)}`,{method:'POST',headers:{'x-velora-boundary':'boundary',host:'preview.example.test',origin:'https://preview.example.test','sec-fetch-site':'same-origin'}}));
 expect(response.status).toBe(200);expect(m.recover).toHaveBeenCalledExactlyOnceWith(scope);
});

it('rejects proxy origin mismatches, forged forwarded host and absent same-origin evidence',async()=>{
 for(const headers of [
  {host:'preview.example.test',origin:'https://evil.test','sec-fetch-site':'same-origin'},
  {host:'localhost:3330',origin:'https://evil.test','x-forwarded-host':'evil.test','sec-fetch-site':'same-origin'},
  {host:'preview.example.test',origin:'https://preview.example.test'},
  {host:'preview.example.test',origin:'https://preview.example.test','sec-fetch-site':'cross-site'},
 ]){
  const response=await POST(new Request(`http://localhost:3330/api/setup/trial-stream?${new URLSearchParams(scope)}`,{method:'POST',headers:{'x-velora-boundary':'boundary',...headers} as Record<string,string>}));
  expect(response.status).toBe(403);
 }
 expect(m.recover).not.toHaveBeenCalled();
});
