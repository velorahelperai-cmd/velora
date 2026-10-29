import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn(),rate:vi.fn()}));
vi.mock('@/lib/auth/server-identity',()=>({readSessionIdentity:m.identity}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:m.rpc})}));
vi.mock('@/lib/auth/site-url',()=>({siteUrl:()=> 'https://example.test'}));
vi.mock('./rate-limit',()=>({checkRateLimit:m.rate}));
import {inviteOwnedBranchTeamAction} from '@/lib/tenancy/paid-team-actions';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const input={expectedAccountId:id(1),companyId:id(2),branchId:id(3),expectedVersion:1,operationId:id(4),name:'Staff',email:'staff@example.test',role:'staff' as const,capabilities:['wa.conversations.read']};
beforeEach(()=>{vi.clearAllMocks();m.identity.mockResolvedValue({ok:true,userId:id(1)});});
it('stops an enforced invitation before mutation and exposes only safe retry metadata',async()=>{
 m.rate.mockResolvedValue({allowed:false,code:'RATE_LIMITED',httpStatus:429,retryAfterSeconds:20});
 expect(await inviteOwnedBranchTeamAction(input)).toEqual({ok:false,code:'RATE_LIMITED',httpStatus:429,retryAfterSeconds:20});
 expect(m.rpc).not.toHaveBeenCalled();expect(m.rate).toHaveBeenCalledWith('invitation',`account:${id(1)}`);
});
it('does not let an unverified account select another user rate bucket',async()=>{
 m.identity.mockResolvedValue({ok:true,userId:id(9)});
 expect(await inviteOwnedBranchTeamAction(input)).toEqual({ok:false,code:'UNAUTHENTICATED'});
 expect(m.rate).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
});
