import {beforeEach, expect, it, vi} from 'vitest';
const m=vi.hoisted(()=>({identity:vi.fn(),role:vi.fn(),directory:vi.fn()}));
vi.mock('@/lib/auth/server-identity',()=>({readSessionIdentity:m.identity}));
vi.mock('@/lib/tenancy/account-platform-identity',()=>({readAccountPlatformIdentity:m.role}));
vi.mock('@/lib/platform-teams/actions',()=>({readPlatformTeamDirectory:m.directory}));
vi.mock('./teams-page',()=>({TeamsPage:()=>null,TeamsFailure:()=>null}));
import {renderTeamsRoute} from './teams-route';
const actor='00000000-0000-4000-8000-000000000001';
beforeEach(()=>{vi.resetAllMocks();m.identity.mockResolvedValue({ok:true,userId:actor,emailConfirmed:true,boundaryFingerprint:'epoch-a'});m.role.mockResolvedValue({role:'owner',status:'active',unavailable:false});});
it.each([false,true])('renders only an authorized shell, with no discarded directory read (editor=%s)',async editor=>{
 const tree=await renderTeamsRoute(editor,Promise.resolve({}));
 expect(tree.props).toMatchObject({actorId:actor,editor});
 expect(tree.key).toContain('epoch-a');expect(m.directory).not.toHaveBeenCalled();
});
it('retains the platform owner gate before rendering the editor',async()=>{
 m.role.mockResolvedValue({role:'support',status:'active',unavailable:false});
 expect((await renderTeamsRoute(true,Promise.resolve({}))).props.code).toBe('FORBIDDEN');
 expect(m.directory).not.toHaveBeenCalled();
});
it('rejects duplicate query scope before rendering the shell',async()=>{
 expect((await renderTeamsRoute(false,Promise.resolve({team:['one','two']}))).props.code).toBe('INVALID_INPUT');
});
