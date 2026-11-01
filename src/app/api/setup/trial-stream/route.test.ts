import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn(),stream:vi.fn()}));
vi.mock('@/lib/auth/server-identity',()=>({readSessionIdentity:m.identity}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:m.rpc})}));
vi.mock('@/lib/answers/provider',()=>({getAnswerProvider:()=>({streamTrial:m.stream})}));
import {GET} from './route';
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
