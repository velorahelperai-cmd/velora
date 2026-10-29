import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn(),headers:vi.fn(),log:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:(...args:unknown[])=>({abortSignal:()=>m.rpc(...args)})})}));
vi.mock('next/headers',()=>({headers:m.headers}));
vi.mock('@/lib/logging/logger.mjs',()=>({logEvent:m.log}));
import {checkAuthRateLimit,checkRateLimit,rateDecision} from './rate-limit';
const receipt={allowed:true,mode:'monitor',exceeded:false,replayed:false,retryAfterSeconds:0};
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('VELORA_RATE_LIMIT_HASH_KEY','synthetic-local-only-key');vi.stubEnv('VELORA_RATE_LIMIT_ENFORCE','false');m.rpc.mockResolvedValue({data:receipt,error:null});});
afterEach(()=>vi.unstubAllEnvs());
it('hashes subject with a server key and sends only exact trusted replay context',async()=>{
 expect(await checkRateLimit('checkout','account:actor',{accountId:'actor',operationId:'operation'})).toEqual({allowed:true});
 expect(m.rpc.mock.calls[0][1]).toMatchObject({p_subject_hash:expect.stringMatching(/^[a-f0-9]{64}$/),p_account_id:'actor',p_operation_id:'operation'});
 expect(JSON.stringify(m.rpc.mock.calls)).not.toContain('account:actor');
});
it('observes thresholds until enforcement is explicitly enabled, then denies with retry metadata',async()=>{
 const data={...receipt,allowed:false,mode:'enforce',exceeded:true,retryAfterSeconds:20};m.rpc.mockResolvedValue({data,error:null});
 expect(await checkRateLimit('ai_trial','company:a')).toEqual({allowed:true});
 vi.stubEnv('VELORA_RATE_LIMIT_ENFORCE','true');
 expect(await checkRateLimit('ai_trial','company:a')).toEqual({allowed:false,code:'RATE_LIMITED',httpStatus:429,retryAfterSeconds:20});
});
it('store failure preserves observation rollout but fails closed after enforcement, and recovers',async()=>{
 m.rpc.mockRejectedValue(Error('internal database details'));
 expect(await checkRateLimit('otp_verify','ip:127.0.0.1')).toEqual({allowed:true});
 vi.stubEnv('VELORA_RATE_LIMIT_ENFORCE','true');
 expect(await checkRateLimit('otp_verify','ip:127.0.0.1')).toMatchObject({allowed:false,httpStatus:503});
 m.rpc.mockResolvedValue({data:receipt,error:null});expect(await checkRateLimit('otp_verify','ip:127.0.0.1')).toEqual({allowed:true});
 expect(JSON.stringify(m.log.mock.calls)).not.toContain('internal database details');
});
it('does not accept spoofed forwarded chains or non-Vercel headers',async()=>{
 vi.stubEnv('VELORA_RATE_LIMIT_ENFORCE','true');vi.stubEnv('VERCEL','1');
 m.headers.mockResolvedValue(new Headers({'x-forwarded-for':'1.2.3.4','x-vercel-forwarded-for':'1.2.3.4, 5.6.7.8'}));
 expect(await checkAuthRateLimit('auth_login')).toMatchObject({allowed:false,httpStatus:503});expect(m.rpc).not.toHaveBeenCalled();
 m.headers.mockResolvedValue(new Headers({'x-vercel-forwarded-for':'192.0.2.1'}));
 expect(await checkAuthRateLimit('auth_login')).toEqual({allowed:true});expect(JSON.stringify(m.rpc.mock.calls)).not.toContain('192.0.2.1');
});
it.each([null,{}, {...receipt,allowed:false},{...receipt,retryAfterSeconds:-1}])('rejects malformed store receipts',value=>expect(rateDecision(value,true)).toBeNull());
