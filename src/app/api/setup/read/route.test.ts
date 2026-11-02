import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const m=vi.hoisted(()=>({verified:vi.fn(),entry:vi.fn(),identity:vi.fn(),shell:vi.fn(),workspace:vi.fn(),hours:vi.fn(),knowledge:vi.fn(),language:vi.fn(),trial:vi.fn(),launch:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({runWithVerifiedReadClient:m.verified}));
vi.mock('@/lib/tenancy/paid-setup-actions',()=>({readOwnedPaidBranchSetupEntryAction:m.entry}));
vi.mock('@/lib/auth/server-identity',()=>({readSessionIdentity:m.identity}));
vi.mock('@/lib/tenancy/paid-setup-workspace-actions',()=>({readOwnedPaidSetupShellAction:m.shell,readOwnedPaidSetupWorkspaceAction:m.workspace}));
vi.mock('@/lib/tenancy/branch-hours-actions',()=>({readOwnedBranchHoursAction:m.hours}));
vi.mock('@/lib/tenancy/paid-branch-knowledge-actions',()=>({readOwnedBranchKnowledgeAction:m.knowledge}));
vi.mock('@/lib/tenancy/paid-reply-language-actions',()=>({readOwnedBranchReplyLanguageAction:m.language}));
vi.mock('@/lib/tenancy/paid-assistant-trial-actions',()=>({readOwnedBranchAssistantTrialAction:m.trial}));
vi.mock('@/lib/tenancy/paid-launch-actions',()=>({readOwnedBranchLaunchSummaryAction:m.launch}));
import {GET} from './route';

it('dispatches inventory only through the native entry reader after identity and boundary checks',async()=>{
 const input={expectedAccountId:scope.expectedAccountId,companyId:scope.companyId};
 const url=`https://velora.test/api/setup/read?${new URLSearchParams({...input,resource:'entry'})}`;
 m.entry.mockResolvedValue({companyId:scope.companyId,branches:[]});
 const response=await GET(new Request(url,{headers:{'x-velora-boundary':'boundary'}}));
 expect(response.status).toBe(200);expect(m.entry).toHaveBeenCalledWith(input);
 expect(response.headers.get('cache-control')).toContain('no-store');
 m.entry.mockClear();
 const rejectedHeaders:HeadersInit[]=[{'x-velora-boundary':'old'},{'x-velora-boundary':'boundary','sec-fetch-site':'cross-site'}];
 for(const headers of rejectedHeaders){
  expect((await GET(new Request(url,{headers}))).status).toBe(403);
 }
 expect((await GET(request('entry'))).status).toBe(400);
 expect((await GET(new Request(url+'&companyId='+scope.companyId))).status).toBe(400);
 m.identity.mockResolvedValue({ok:true,userId:'foreign',boundaryFingerprint:'boundary'});
 expect((await GET(new Request(url,{headers:{'x-velora-boundary':'boundary'}}))).status).toBe(403);
 expect(m.entry).not.toHaveBeenCalled();
});
const scope={expectedAccountId:'11111111-1111-4111-8111-111111111111',companyId:'22222222-2222-4222-8222-222222222222',branchId:'33333333-3333-4333-8333-333333333333'};
function request(resource='shell',boundary='boundary'){return new Request(`https://velora.test/api/setup/read?${new URLSearchParams({...scope,resource})}`,{headers:{'x-velora-boundary':boundary}});}
beforeEach(()=>{vi.resetAllMocks();m.verified.mockImplementation(async(work:()=>Promise<Response>)=>({value:await work(),actorId:scope.expectedAccountId}));m.identity.mockResolvedValue({ok:true,userId:scope.expectedAccountId,boundaryFingerprint:'boundary'});m.shell.mockResolvedValue(null);});

it('withholds entry data until the final fence and discards it on fence failure or actor change',async()=>{
 const url=`https://velora.test/api/setup/read?${new URLSearchParams({resource:'entry',expectedAccountId:scope.expectedAccountId,companyId:scope.companyId})}`;
 const send=()=>GET(new Request(url,{headers:{'x-velora-boundary':'boundary'}}));
 m.entry.mockResolvedValue({companyId:scope.companyId,branches:['private']});
 let finish!:()=>void;const gate=new Promise<void>(resolve=>{finish=resolve;});let loaded!:()=>void;const didRead=new Promise<void>(resolve=>{loaded=resolve;});
 m.verified.mockImplementation(async(work:()=>Promise<Response>)=>{await work();loaded();await gate;throw Error('boundary changed');});
 let settled=false;const pending=send().then(value=>{settled=true;return value;});await didRead;expect(settled).toBe(false);finish();
 const rejected=await pending;expect(rejected.status).toBe(503);expect(await rejected.text()).not.toContain('private');
 expect(m.identity).toHaveBeenCalledWith({readOnly:true});
 m.verified.mockImplementation(async(work:()=>Promise<Response>)=>({value:await work(),actorId:'foreign'}));
 const foreign=await send();expect(foreign.status).toBe(403);expect(await foreign.text()).not.toContain('private');
});
it('requires native identity and boundary before dispatch, with no-store even on errors',async()=>{
 for(const identity of [{ok:false,code:'UNAUTHENTICATED'},{ok:true,userId:'foreign',boundaryFingerprint:'boundary'}]){
  m.identity.mockResolvedValue(identity);const response=await GET(request());expect([401,403]).toContain(response.status);expect(response.headers.get('cache-control')).toContain('no-store');
 }
 expect(m.shell).not.toHaveBeenCalled();
});
it('rejects an obsolete same-account boundary and all mutation names',async()=>{
 expect((await GET(request('shell','old'))).status).toBe(403);
 for(const key of ['launch-confirm','save','__proto__','constructor'])expect((await GET(request(key))).status).toBe(400);
 expect(m.shell).not.toHaveBeenCalled();expect(m.launch).not.toHaveBeenCalled();
});
it('dispatches exact scope, disables shared HTTP caching and reports elapsed server time',async()=>{
 const response=await GET(request());expect(response.status).toBe(200);expect(m.shell).toHaveBeenCalledWith(scope);
 expect(response.headers.get('vary')).toBe('Cookie');expect(response.headers.get('server-timing')).toMatch(/^setup-read;dur=/);
 expect(await response.json()).toEqual({data:null});
});
it('does not serialize a slow workspace read ahead of an independent hours read',async()=>{
 let finish!:(value:null)=>void;m.workspace.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));m.hours.mockResolvedValue({ok:false});
 const slow=GET(request('workspace'));const hours=await GET(request('hours'));expect(hours.status).toBe(200);expect(m.hours).toHaveBeenCalledOnce();finish(null);await slow;
});

it('reports safe failure stage and correlation without serializing exceptions',async()=>{
 m.shell.mockRejectedValue(new Error('sensitive database detail'));
 const response=await GET(request());
 expect(response.status).toBe(503);expect(response.headers.get('x-setup-stage')).toBe('reader');
 expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
 expect(await response.json()).toEqual({error:'UNAVAILABLE'});
});
