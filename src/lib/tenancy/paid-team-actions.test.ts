import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({identity:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/auth/server-identity',()=>({readSessionIdentity:m.identity}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:m.rpc})}));
vi.mock('@/lib/auth/site-url',()=>({siteUrl:()=> 'https://example.test'}));
import {readOwnedBranchTeamAction,inviteOwnedBranchTeamAction,revokeOwnedBranchTeamAction} from './paid-team-actions';
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scope={expectedAccountId:id(1),companyId:id(2),branchId:id(3)};
const snapshot={scope,version:1,branchLabel:'Primary',seats:{limit:2,available:1},allowedRoles:['staff'],canInvite:true,canReplace:true,canSkip:false,skip:'not_skipped',createOperationId:id(4),skipOperationId:null,invitations:[]};
const input={...scope,expectedVersion:1,operationId:id(5),name:' Staff ',email:'USER@example.test',role:'staff' as const,capabilities:['wa.conversations.read']};
beforeEach(()=>{vi.clearAllMocks();m.identity.mockResolvedValue({ok:true,userId:id(1)});m.rpc.mockResolvedValue({data:{ok:true,snapshot,tokenMatched:true,replayed:false},error:null});});
it('does not disclose unknown backend refusal text for invite or revoke',async()=>{
 m.rpc.mockResolvedValue({data:{ok:false,code:'private.schema token=synthetic-secret'},error:null});
 expect(await inviteOwnedBranchTeamAction(input)).toEqual({ok:false,code:'UNKNOWN'});
 expect(await revokeOwnedBranchTeamAction({...scope,invitationId:id(6),expectedRevision:2})).toEqual({ok:false,code:'UNKNOWN'});
});
it('passes exact branch and explicit permissions, returns link only and never raw token hash',async()=>{const r=await inviteOwnedBranchTeamAction(input);expect(r).toMatchObject({ok:true,data:{delivery:'link_only',snapshot}});if(r.ok)expect(r.data.inviteUrl).toMatch(/^https:\/\/example.test\/accept-invite\?token=/);expect(m.rpc).toHaveBeenCalledWith('es02_invite_owned_branch_team',expect.objectContaining({p_branch_id:id(3),p_capabilities:['wa.conversations.read'],p_email:'user@example.test',p_token_hash:expect.stringMatching(/^[a-f0-9]{64}$/)}));});
it('blocks wrong account, invalid recipient and unapproved permissions before RPC',async()=>{for(const patch of [{expectedAccountId:id(9)},{email:'bad'},{capabilities:[]},{capabilities:['wa.conversations.reply']},{capabilities:['staff.schedule.read']},{role:'owner'}]){expect((await inviteOwnedBranchTeamAction({...input,...patch} as never)).ok).toBe(false);}expect(m.rpc).not.toHaveBeenCalled();});
it('rejects foreign branch snapshot and preserves unknown mutation status',async()=>{m.rpc.mockResolvedValue({data:{ok:true,snapshot:{...snapshot,scope:{...scope,branchId:id(8)}}},error:null});expect(await readOwnedBranchTeamAction(scope)).toBeNull();expect(await inviteOwnedBranchTeamAction(input)).toEqual({ok:false,code:'UNKNOWN'});});
it('does not recreate a lost link on exact-operation replay',async()=>{m.rpc.mockResolvedValue({data:{ok:true,snapshot,tokenMatched:false,replayed:true},error:null});expect(await inviteOwnedBranchTeamAction(input)).toMatchObject({ok:true,data:{inviteUrl:null,delivery:'link_only'}});});
it('fails closed on transport or malformed seats',async()=>{m.rpc.mockRejectedValue(Error('transport'));expect(await inviteOwnedBranchTeamAction(input)).toEqual({ok:false,code:'UNKNOWN'});m.rpc.mockResolvedValue({data:{ok:true,snapshot:{...snapshot,seats:{limit:2,available:3}}}});expect(await readOwnedBranchTeamAction(scope)).toBeNull();});

const revoke={...scope,invitationId:id(6),expectedRevision:2};
it('revokes through the authenticated scoped RPC and returns authoritative snapshot',async()=>{
 const result=await revokeOwnedBranchTeamAction(revoke);
 expect(result).toMatchObject({ok:true,snapshot});
 expect(m.rpc).toHaveBeenCalledWith('es02_revoke_owned_branch_team',{p_expected_account_id:id(1),p_company_id:id(2),p_branch_id:id(3),p_invitation_id:id(6),p_expected_revision:2});
});
it('rejects invalid revoke input and account mismatch without calling RPC',async()=>{
 for(const patch of [{invitationId:'bad'},{branchId:'bad'},{expectedRevision:0},{expectedRevision:1.2},{expectedAccountId:id(9)}])expect((await revokeOwnedBranchTeamAction({...revoke,...patch})).ok).toBe(false);
 m.identity.mockResolvedValue({ok:false});expect(await revokeOwnedBranchTeamAction(revoke)).toEqual({ok:false,code:'UNAUTHENTICATED'});
 expect(m.rpc).not.toHaveBeenCalled();
});
it('fails closed on revoked foreign scope, server denial and transport uncertainty',async()=>{
 m.rpc.mockResolvedValue({data:{ok:true,snapshot:{...snapshot,scope:{...scope,branchId:id(9)}}},error:null});
 expect(await revokeOwnedBranchTeamAction(revoke)).toEqual({ok:false,code:'UNKNOWN'});
 m.rpc.mockResolvedValue({data:{ok:false,code:'REVISION_CONFLICT'},error:null});
 expect(await revokeOwnedBranchTeamAction(revoke)).toEqual({ok:false,code:'REVISION_CONFLICT'});
 m.rpc.mockRejectedValue(Error('transport'));
 expect(await revokeOwnedBranchTeamAction(revoke)).toEqual({ok:false,code:'UNKNOWN'});
});
