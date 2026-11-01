// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenancy/paid-team-actions",()=>({readOwnedBranchTeamAction:vi.fn(async()=>null),inviteOwnedBranchTeamAction:vi.fn()}));

vi.mock("@/lib/tenancy/branch-hours-actions", () => ({
  readOwnedBranchHoursAction: vi.fn(async () => ({ ok: false, code: "unavailable", snapshot: null })),
  saveOwnedBranchHoursAction: vi.fn(),
  copyOwnedBranchHoursAction: vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-branch-knowledge-actions", () => ({
  readOwnedBranchKnowledgeAction: vi.fn(async () => null),
  addOwnedBranchWebsiteAction: vi.fn(),
  pageActionOwnedBranchKnowledgeAction: vi.fn(),
  saveOwnedBranchKnowledgeTextAction:vi.fn(),
  uploadOwnedBranchKnowledgeFilesAction:vi.fn(),
  approveOwnedBranchKnowledgeSourceAction:vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-reply-language-actions", () => ({
  readOwnedBranchReplyLanguageAction: vi.fn(async () => null),
  confirmOwnedBranchReplyLanguageAction: vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-assistant-trial-actions", () => ({
  readOwnedBranchAssistantTrialAction: vi.fn(async () => null),
  askOwnedBranchAssistantTrialAction: vi.fn(),
  recoverOwnedBranchAssistantTrialAction: vi.fn(),
}));

vi.mock("@/lib/tenancy/paid-launch-actions", () => ({
  readOwnedBranchLaunchSummaryAction: vi.fn(async () => null),
  confirmOwnedBranchLaunchAction: vi.fn(),
}));

import { PaidSetupStepHost, type PaidSetupStepHostProps } from "./paid-setup-step-host";

import {readOwnedBranchLaunchSummaryAction,confirmOwnedBranchLaunchAction} from '@/lib/tenancy/paid-launch-actions';
import {readOwnedBranchAssistantTrialAction,askOwnedBranchAssistantTrialAction} from '@/lib/tenancy/paid-assistant-trial-actions';
import {recoverOwnedBranchAssistantTrialAction} from '@/lib/tenancy/paid-assistant-trial-actions';

const baseProps: PaidSetupStepHostProps = {
  locale: "en",
  scope: {
    expectedAccountId: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    branchId: "33333333-3333-4333-8333-333333333333",
    boundaryFingerprint: "boundary",
  },
  step: "hours",
  isCurrent: () => true,
  read: null,
};

describe("PaidSetupStepHost", () => {
  it('renders launch requirements while the initial read is pending',()=>{
    const html=renderToStaticMarkup(createElement(PaidSetupStepHost,{...baseProps,step:'launch'}));
    expect(html).toContain('Review and confirm launch');expect(html).toContain('<dl');
  });
  it('blocks stale launch consent throughout an unresolved status refresh',async()=>{
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
    const item={detail:'Verified',status:'verified' as const};
    const snapshot={scope,version:1,branchLabel:'Branch',setup:{companyId:scope.companyId,selectedBranchId:scope.branchId,sourceStatus:'ready' as const,selectedChannels:['whatsapp' as const],entitlement:{orderGroupId:'order',slotIndex:0,persona:'level_2' as const,package:'basic' as const,maxChannels:1 as const,employeesExcludingOwner:2 as const},launch:{canRequest:true,confirmationRequired:true as const,confirmed:false,blockedReasons:[]}},readiness:{status:'ready' as const,revision:'r1',blockers:[]},summary:{channels:[{channel:'whatsapp' as const,...item}],hours:item,knowledge:item,persona:item,team:{detail:'Optional',status:'skipped_optional' as const}},operationId:'44444444-4444-4444-8444-444444444444',activation:{status:'not_started' as const,receiptId:null,operationId:null}};
    let finish!:(value:typeof snapshot|null)=>void;
    vi.mocked(readOwnedBranchLaunchSummaryAction).mockResolvedValueOnce(snapshot).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const host=document.createElement('div'),root=createRoot(host);
    try{
      await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'launch'})));
      await act(async()=>host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
      await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Refresh operation status')!.click());
      expect(host.textContent).not.toContain('Loading the launch summary.');
      expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
      expect(confirmOwnedBranchLaunchAction).not.toHaveBeenCalled();
      await act(async()=>finish(snapshot));
      expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
  });
  it("renders hours step without customer loading copy in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "hours" }));
    expect(html).toContain("Working hours");
    expect(html).not.toContain("Loading branch hours");
    expect(html).toContain('aria-busy="true"');
  });

  it("renders knowledge step without customer loading copy in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "knowledge" }));
    expect(html).toContain("Branch knowledge");
    expect(html).not.toContain("Loading branch knowledge");
    expect(html).toContain('aria-busy="true"');
  });

  it("renders test assistant step without customer loading copy in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "test" }));
    expect(html).toContain("Try your assistant");
    expect(html).not.toContain("Loading the assistant trial");
    expect(html).toContain('aria-busy="true"');
  });

  it("renders launch step without customer loading copy in SSR", () => {
    const html = renderToStaticMarkup(createElement(PaidSetupStepHost, { ...baseProps, step: "launch" }));
    expect(html).toContain("Review and confirm launch");
    expect(html).not.toContain("Loading the launch summary");
    expect(html).toContain('aria-busy="true"');
  });
});

it('shows a valid cached branch snapshot immediately when returning to knowledge',()=>{
 const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
 const snapshot={scope,version:1,branchLabel:'Branch',websiteQuota:{limit:10,used:3},pages:[],files:[],faq:[],capabilities:{canAddWebsite:true,canUploadFiles:true,canSaveText:true}};
 const reader={peek:(kind:string)=>kind==='knowledge'?snapshot:null,peekHours:()=>null} as unknown as NonNullable<PaidSetupStepHostProps['reader']>;
 const html=renderToStaticMarkup(createElement(PaidSetupStepHost,{...baseProps,step:'knowledge',reader}));
 expect(html).toContain('3 / 10');
});

it('resumes a known background request after mounting without generating another answer',async()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
 const snapshot={scope,version:1,knowledgeRevision:'k1',branchLabel:'Main',businessType:'restaurant',canAsk:false,messages:[],pendingOperation:{id:'55555555-5555-4555-8555-555555555555',status:'running',recoverable:false,pollable:true}};
 vi.mocked(readOwnedBranchAssistantTrialAction).mockResolvedValueOnce(snapshot);
 const recover=vi.mocked(recoverOwnedBranchAssistantTrialAction);recover.mockReset();recover.mockResolvedValue({ok:true,snapshot:{...snapshot,canAsk:true,pendingOperation:null,trialAllowance:{limit:10,used:1}}});
 const ask=vi.mocked(askOwnedBranchAssistantTrialAction);ask.mockClear();
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'test'})));
  await act(async()=>vi.advanceTimersByTimeAsync(0));
  expect(recover).toHaveBeenCalledOnce();expect(ask).not.toHaveBeenCalled();expect(host.textContent).toContain('1/10');
  await act(async()=>vi.advanceTimersByTimeAsync(60_000));expect(recover).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());ask.mockClear();recover.mockReset();vi.useRealTimers();vi.unstubAllGlobals();}
});

it('bounds pending retrievals without rebuilding snapshots or asking again',async()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const snapshot={scope:baseProps.scope,version:1,knowledgeRevision:'k1',branchLabel:'Main',businessType:'restaurant',canAsk:false,messages:[],pendingOperation:{id:'55555555-5555-4555-8555-555555555555',status:'running',recoverable:false,pollable:true}};
 vi.mocked(readOwnedBranchAssistantTrialAction).mockResolvedValueOnce(snapshot);
 const recover=vi.mocked(recoverOwnedBranchAssistantTrialAction);recover.mockReset();recover.mockResolvedValue({ok:false,code:'TRIAL_PENDING',message:'Still running'});
 const ask=vi.mocked(askOwnedBranchAssistantTrialAction);ask.mockClear();
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'test'})));
  await act(async()=>vi.advanceTimersByTimeAsync(0));expect(recover).toHaveBeenCalledOnce();
  await act(async()=>vi.advanceTimersByTimeAsync(600_000));
  expect(recover).toHaveBeenCalledTimes(60);expect(ask).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
 }finally{await act(async()=>root.unmount());ask.mockClear();recover.mockReset();vi.useRealTimers();vi.unstubAllGlobals();}
});

it('waits through provider generation and settlement without losing a late answer or resending',async()=>{
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
 const snapshot={scope,version:1,knowledgeRevision:'k1',branchLabel:'Main',businessType:'restaurant',canAsk:true,messages:[]};
 vi.mocked(readOwnedBranchAssistantTrialAction).mockResolvedValueOnce(snapshot);
 const ask=vi.mocked(askOwnedBranchAssistantTrialAction);ask.mockClear();
 let finish!:(value:Awaited<ReturnType<typeof askOwnedBranchAssistantTrialAction>>)=>void;
 ask.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const host=document.createElement('div'),root=createRoot(host);const onRefresh=vi.fn();
 try{
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'test',onRefresh})));
  await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='What are the working hours?')!.click());
  await act(async()=>vi.advanceTimersByTimeAsync(65_000));
  expect(host.textContent).not.toContain('The request outcome needs review');
  await act(async()=>finish({ok:true,snapshot}));
  expect(onRefresh).toHaveBeenCalledOnce();expect(ask).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());ask.mockClear();vi.useRealTimers();vi.unstubAllGlobals();}
});

it('preserves the budget failure detail and retry denial from action through the real trial host',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
 vi.mocked(readOwnedBranchAssistantTrialAction).mockResolvedValueOnce({scope,version:1,knowledgeRevision:'k1',branchLabel:'Main',businessType:'restaurant',canAsk:true,messages:[]});
 vi.mocked(askOwnedBranchAssistantTrialAction).mockResolvedValueOnce({ok:false,code:'TRIAL_BUDGET_EXCEEDED',message:'Budget blocked',requestId:'budget-request',retrySafe:false});
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'test'})));
  const suggestion=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='What are the working hours?')!;
  expect(suggestion.disabled).toBe(false);
  await act(async()=>suggestion.click());
  expect(askOwnedBranchAssistantTrialAction).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('blocked by the trial budget limit');
  expect(Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Retry safely')!.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});


it('retains confirmed hours during same-branch refresh and clears them on denied access or branch change', async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const {SetupReadError}=await import('@/lib/tenancy/setup-read-client');
 const {emptyBranchHours}=await import('@/lib/tenancy/branch-hours-contracts');
 const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
 const snapshot={scope,version:7,branchLabel:'Confirmed branch',timezone:'Asia/Muscat',schedule:{...emptyBranchHours(),monday:{state:'open' as const,intervals:[{start:'09:15',end:'18:30',nextDay:false}]}}};
 const makeReader=(read:()=>Promise<unknown>)=>({read,peekHours:()=>null,peek:()=>null,invalidate:vi.fn()}) as unknown as NonNullable<PaidSetupStepHostProps['reader']>;
 const host=document.createElement('div'),root=createRoot(host);
 const times=()=>host.textContent;
 try{
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,reader:makeReader(async()=>({ok:true,snapshot,copyTargets:[]}))})));
  expect(times()).toContain('09:15');
  let reject!:(reason:unknown)=>void;
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,reader:makeReader(()=>new Promise((_,r)=>{reject=r;}))})));
  expect(times()).toContain('09:15');
  await act(async()=>reject(new SetupReadError('network','hours')));
  expect(times()).toContain('09:15');
  expect(host.textContent).not.toContain('Hours for this branch are unavailable');
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,reader:makeReader(async()=>{throw new SetupReadError('auth','hours');})})));
  expect(times()).not.toContain('09:15');
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,scope:{...baseProps.scope,branchId:'44444444-4444-4444-8444-444444444444'},reader:makeReader(()=>new Promise(()=>{}))})));
  expect(times()).not.toContain('09:15');
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});

it('retains confirmed knowledge during refresh failure but discards it on scope denial',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const {SetupReadError}=await import('@/lib/tenancy/setup-read-client');
 const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
 const snapshot={scope,version:1,branchLabel:'Branch',websiteQuota:{limit:10,used:3},pages:[],files:[],faq:[],capabilities:{canAddWebsite:true,canUploadFiles:true,canSaveText:true}};
 const makeReader=(read:(kind:string)=>Promise<unknown>)=>({read,peekHours:()=>null,peek:()=>null,invalidate:vi.fn()}) as unknown as NonNullable<PaidSetupStepHostProps['reader']>;
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'knowledge',reader:makeReader(async kind=>kind==='knowledge'?snapshot:null)})));
  expect(host.textContent).toContain('3 / 10');
  let reject!:(reason:unknown)=>void;
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'knowledge',reader:makeReader(kind=>kind==='knowledge'?new Promise((_,r)=>{reject=r;}):Promise.resolve(null))})));
  expect(host.textContent).toContain('3 / 10');
  await act(async()=>reject(new SetupReadError('network','knowledge')));
  expect(host.textContent).toContain('3 / 10');
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'knowledge',reader:makeReader(async()=>{throw new SetupReadError('scope','knowledge');})})));
  expect(host.textContent).not.toContain('3 / 10');
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});


it('refreshes a pending trial without aborting workspace enrichment or resending the question',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const {createSetupReader}=await import('@/lib/tenancy/setup-read-client');
 const scope={expectedAccountId:baseProps.scope.expectedAccountId,companyId:baseProps.scope.companyId,branchId:baseProps.scope.branchId};
 const trial={scope,version:1,knowledgeRevision:'rev1',branchLabel:'Branch',businessType:'Services',canAsk:false,trialAllowance:{limit:10,used:0},pendingOperation:{id:'55555555-5555-4555-8555-555555555555',status:'uncertain',recoverable:false},messages:[]};
 let finishWorkspace!:(response:Response)=>void;
 let workspaceSignal:AbortSignal|undefined;
 const fetcher=vi.fn((url:string,options:RequestInit)=>{
  if(url.includes('resource=workspace')){workspaceSignal=options.signal as AbortSignal;return new Promise<Response>(resolve=>{finishWorkspace=resolve;});}
  return Promise.resolve(Response.json({data:trial}));
 });
 vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader({...scope,boundaryFingerprint:'boundary'},()=>true);
 const workspace=reader.read('workspace');
 // Observe rejection so the original invalidation bug does not produce an unhandled rejection.
 const outcome=workspace.then(value=>({value}),error=>({error}));
 const ask=vi.mocked(askOwnedBranchAssistantTrialAction);ask.mockClear();
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'test',reader})));
  const refresh=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Refresh status')!;
  expect(refresh).toBeDefined();
  await act(async()=>refresh.click());
  expect(workspaceSignal?.aborted).toBe(false);
  finishWorkspace(Response.json({data:{confirmed:'workspace'}}));
  expect(await outcome).toEqual({value:{confirmed:'workspace'}});
  expect(fetcher.mock.calls.filter(([url])=>url.includes('resource=trial'))).toHaveLength(2);
  expect(ask).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  expect(host.textContent).toContain('The request outcome needs review');
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});

it('returns to hours without another request and retains the schedule during later revalidation',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const {createSetupReader}=await import('@/lib/tenancy/setup-read-client');
 const {emptyBranchHours}=await import('@/lib/tenancy/branch-hours-contracts');
 let now=1000;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 const snapshot={scope:baseProps.scope,version:7,branchLabel:'Branch',timezone:'Asia/Muscat',schedule:{...emptyBranchHours(),monday:{state:'open',intervals:[{start:'09:15',end:'18:30',nextDay:false}]}}};
 const fetcher=vi.fn(async(url:string)=>Response.json({data:url.includes('resource=hours')?{ok:true,snapshot,copyTargets:[]}:null}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(baseProps.scope,()=>true),host=document.createElement('div'),root=createRoot(host);
 const visit=async(step:PaidSetupStepHostProps['step'])=>{await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step,reader})));};
 try{
  await visit('hours');expect(host.textContent).toContain('09:15');
  await visit('knowledge');await visit('hours');
  expect(host.textContent).toContain('09:15');
  expect(fetcher.mock.calls.filter(([url])=>url.includes('resource=hours'))).toHaveLength(1);
  await visit('knowledge');now+=31_000;
  fetcher.mockImplementation(()=>new Promise(()=>{}));await visit('hours');
  expect(host.textContent).toContain('09:15');expect(host.textContent).not.toContain('Checking');
  expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(fetcher.mock.calls.filter(([url])=>url.includes('resource=hours'))).toHaveLength(2);
 }finally{await act(async()=>root.unmount());clock.mockRestore();vi.unstubAllGlobals();}
});
it('shows the previous trial counter on return but cannot send until fresh authority arrives',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const {createSetupReader}=await import('@/lib/tenancy/setup-read-client');
 const snapshot={scope:baseProps.scope,version:1,knowledgeRevision:'k1',branchLabel:'Main',businessType:'restaurant',canAsk:true,trialAllowance:{limit:10,used:3},messages:[]};
 const fetcher=vi.fn(async()=>Response.json({data:snapshot}));vi.stubGlobal('fetch',fetcher);
 const reader=createSetupReader(baseProps.scope,()=>true);await reader.read('trial');
 fetcher.mockImplementation(()=>new Promise(()=>{}));
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(PaidSetupStepHost,{...baseProps,step:'test',reader})));
  expect(host.textContent).toContain('3/10');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
