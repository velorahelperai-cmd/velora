// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const actor='00000000-0000-4000-8000-000000000001';
const m=vi.hoisted(()=>({read:vi.fn(),push:vi.fn(),query:'',boundary:'epoch-a',allowed:true}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:m.push,refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams(m.query)}));
vi.mock('next/link',()=>({default:'a'}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('@/components/app/account-chrome',()=>({AppTopBar:()=>null,useOptionalAccountSession:()=>({status:'ready',boundaryFingerprint:m.boundary,identity:{userId:actor,platformIdentity:{role:null,status:null,unavailable:false}},isCurrentUser:()=>m.allowed,liveSnapshot:()=>({boundaryFingerprint:m.boundary})})}));
vi.mock('@/lib/platform-teams/actions',()=>({readPlatformTeamDirectory:m.read,previewPlatformTeamTransfer:vi.fn(),mutatePlatformTeam:vi.fn()}));
vi.mock('./team-owner-editor',()=>({TeamOwnerEditor:()=>null}));
import {TeamsPage} from './teams-page';
const page={ok:true,data:{kind:'teams',rows:[],total:0,team:null,nextCursor:null}};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);m.query='';m.boundary='epoch-a';m.allowed=true;m.read.mockResolvedValue(page);sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=()=>act(async()=>root.render(createElement(TeamsPage,{actorId:actor,editor:false})));
it('reads once on mount and once when URL scope changes',async()=>{
 await render();expect(m.read).toHaveBeenCalledTimes(1);
 m.query='search=sample';await render();expect(m.read).toHaveBeenCalledTimes(2);
 expect(m.read.mock.calls[1][0]).toMatchObject({expectedUserId:actor,search:'sample'});
});
it('does not issue an old-context read before router navigation',async()=>{
 m.query='search=sample';await render();expect(m.read).toHaveBeenCalledTimes(1);
 const reset=[...host.querySelectorAll('button')].find(b=>b.textContent==='New search')!;
 expect(reset).toBeTruthy();await act(async()=>reset.click());
 expect(m.push).toHaveBeenCalledWith('/account/teams');expect(m.read).toHaveBeenCalledTimes(1);
 m.query='';await render();expect(m.read).toHaveBeenCalledTimes(2);
});
it('rejects a late response when the same actor crosses a session boundary',async()=>{
 let old!:(v:unknown)=>void;m.read.mockImplementationOnce(()=>new Promise(r=>{old=r;}));
 await render();m.boundary='epoch-b';await render();expect(m.read).toHaveBeenCalledTimes(2);
 await act(async()=>old({ok:true,data:{...page.data,total:1,rows:[{id:'00000000-0000-4000-8000-000000000010',name:'OLD PRIVATE TEAM',status:'active',managerUserId:null,revision:1,memberCount:0}]}}));
 expect(host.textContent).not.toContain('OLD PRIVATE TEAM');
});
it('shows no rows after a native directory denial',async()=>{
 m.read.mockResolvedValue({ok:false,code:'FORBIDDEN'});await render();
 expect(host.textContent).toContain('You cannot access this team or perform this change.');
 expect(host.querySelector('ul')).toBeNull();expect(m.read).toHaveBeenCalledTimes(1);
});
