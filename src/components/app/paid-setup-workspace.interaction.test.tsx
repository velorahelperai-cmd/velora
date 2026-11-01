// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PaidSetupWorkspace,navigateSetupStep,type PaidSetupWorkspaceProps} from './paid-setup-workspace';
import {projectTrustedBoundSelection,mergePaidBranchChannelProof} from '@/lib/tenancy/paid-setup-contracts';
import {PaidBranchHours,type PaidBranchHoursProps} from './paid-branch-hours';
import {emptyBranchHours} from '@/lib/tenancy/branch-hours-contracts';
import {PaidLaunchSummary,type LaunchSummarySnapshot} from './paid-launch-summary';
const scope={expectedAccountId:'actor',companyId:'company',branchId:'branch',boundaryFingerprint:'capture'};
const read=projectTrustedBoundSelection({companyId:'company',branchId:'branch',branchLabel:'Main',orderGroupId:'order',slotIndex:0,persona:'level_1',package:'basic',term:'monthly',maxChannels:1,employeesExcludingOwner:2,clockState:'waiting_readiness',asOf:'now'},{channels:['whatsapp']});
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const base:PaidSetupWorkspaceProps={locale:'en',scope,read,activeStepId:'whatsapp',availableStepIds:['whatsapp','hours','knowledge','test','launch'],isCurrent:()=>true,onSelectStep:()=>{}};
it('next step opens required hours without claiming completion',async()=>{const select=vi.fn();await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,activeStepId:'whatsapp',onSelectStep:select})));const next=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Next step'))!;expect(next.textContent).toContain('Business hours');expect(next.disabled).toBe(false);await act(async()=>next.click());expect(select).toHaveBeenCalledWith('hours');expect(host.querySelector('[role="status"]')?.textContent).toBe('0 of 6 complete');});
it('opens knowledge independently while keeping launch unverified',async()=>{await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,activeStepId:'knowledge'})));expect(read.launch.canRequest).toBe(false);});
it('next step on verified knowledge navigates toward test when open',async()=>{const select=vi.fn();const verifiedKnowledge={...read,steps:read.steps.map(s=>s.id==='hours'?{...s,status:'verified' as const,reasonCodes:[]}:s.id==='knowledge'?{...s,status:'verified' as const,actionId:'save_knowledge',reasonCodes:[]}:s.id==='assistant_test'?{...s,status:'pending' as const,actionId:'run_trial',reasonCodes:[]}:s),progress:{...read.progress,verified:2}};await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,read:verifiedKnowledge,activeStepId:'knowledge',onSelectStep:select})));const next=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Next step'))!;expect(next.textContent).toContain('Test assistant');expect(next.disabled).toBe(false);await act(async()=>next.click());expect(select).toHaveBeenCalledWith('test');});
it('previous step in header navigates backwards cleanly',async()=>{const select=vi.fn();await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,activeStepId:'knowledge',onSelectStep:select})));const prev=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Previous step'))!;expect(prev).not.toBeNull();await act(async()=>prev.click());expect(select).toHaveBeenCalledWith('hours');});
it('on launch step no next step button is rendered',async()=>{await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,activeStepId:'launch'})));const next=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Next step'));expect(next).toBeUndefined();});
it('cancelled local draft warning blocks step changes while removed controls stay absent',async()=>{const select=vi.fn(),refresh=vi.fn();const connected=mergePaidBranchChannelProof(read,[{...scope,channel:'whatsapp',verified:true,generation:1,revoked:false,stale:false}]);await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,read:{...connected,steps:connected.steps.map(step=>step.id==='knowledge'?{...step,status:'pending' as const,actionId:'save_knowledge'}:step)},activeStepId:'knowledge',onSelectStep:select,onRefresh:refresh,renderStep:()=>createElement('div',{'data-setup-unsaved':'true'},'Draft')})));const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Previous step')!.click());expect(confirm).toHaveBeenCalledTimes(1);expect(select).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();expect(host.textContent).toContain('Draft');expect(host.textContent).not.toContain('Refresh status');expect(host.querySelector('[aria-label="Branch assistant"]')).toBeNull();});
it('next advances immediately while flushable draft persists in the background',async()=>{
  const select=vi.fn();
  let release!:()=>void;
  const flush=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));
  const hoursOpen={...read,steps:read.steps.map(s=>s.id==='hours'?{...s,status:'pending' as const,actionId:'save_hours',reasonCodes:[]}:s)};
  type FlushNode=HTMLDivElement&{__veloraFlush?:()=>Promise<void>};
  await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,read:hoursOpen,activeStepId:'hours',onSelectStep:select,renderStep:step=>step==='hours'?createElement('div',{'data-setup-unsaved':'true','data-setup-flush':'',ref:(node:FlushNode|null)=>{if(node)node.__veloraFlush=flush;}},'Hours draft'):null})));
  const confirm=vi.spyOn(window,'confirm');
  const next=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Next step'))!;
  await act(async()=>next.click());
  expect(flush).toHaveBeenCalledTimes(1);
  expect(confirm).not.toHaveBeenCalled();
  expect(select).toHaveBeenCalledWith('knowledge');
  release();
});
it('does not select a next step after the identity is revoked',async()=>{const select=vi.fn();let current=true;await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,isCurrent:()=>current,onSelectStep:select})));const next=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Next step'))!;current=false;await act(async()=>next.click());expect(select).not.toHaveBeenCalled();});
it('retains an hours draft across an unavailable response without claiming saved state',async()=>{const p:PaidBranchHoursProps={locale:'en',scope,boundaryFingerprint:'capture',snapshot:{scope,version:1,branchLabel:'Main',timezone:'Asia/Muscat',schedule:emptyBranchHours()},state:{scope,version:1,phase:'ready'},copyTargets:[],isCurrent:()=>true,onSave:vi.fn()};await act(async()=>root.render(createElement(PaidBranchHours,p)));const closeAll=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Close all days'))!;expect(closeAll).not.toBeNull();await act(async()=>closeAll.click());expect(host.querySelector('[data-hours-day="monday"]')?.getAttribute('data-state')).toBe('closed');expect(host.querySelector('[data-setup-unsaved="true"]')).not.toBeNull();await act(async()=>root.render(createElement(PaidBranchHours,{...p,state:{...p.state,phase:'unavailable'}})));expect(host.querySelector('[data-hours-day="monday"]')?.getAttribute('data-state')).toBe('closed');expect(host.textContent).not.toContain('server confirmed');await act(async()=>root.render(createElement(PaidBranchHours,p)));expect(host.querySelector('[data-hours-day="monday"]')?.getAttribute('data-state')).toBe('closed');expect(host.querySelector('[data-setup-unsaved="true"]')).not.toBeNull();});

it('reopens saved hours in the existing workspace without writing or completing prerequisites',async()=>{
 const save=vi.fn(),schedule=emptyBranchHours();
 for(const day of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const)schedule[day]={state:'closed'};
 schedule.monday={state:'open',intervals:[{start:'10:00',end:'14:00',nextDay:false}]};
 const hours:PaidBranchHoursProps={locale:'en',scope,boundaryFingerprint:'capture',snapshot:{scope,version:7,branchLabel:'Main',timezone:'UTC',schedule},state:{scope,version:7,phase:'ready'},copyTargets:[],isCurrent:()=>true,onSave:save};
 await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,activeStepId:'hours',renderStep:step=>step==='hours'?createElement(PaidBranchHours,hours):null})));
 expect(host.querySelectorAll('[data-hours-studio]')).toHaveLength(1);
 // Grouped summary cards: consecutive days with identical hours share a card, in display order.
 const groups=[...host.querySelectorAll<HTMLElement>('[data-hours-group]')];
 expect(groups.map(g=>g.dataset.hoursDays)).toEqual(['sunday','monday','tuesday wednesday thursday friday saturday']);
 expect(groups.map(g=>g.dataset.state)).toEqual(['closed','open','closed']);
 expect(groups[1].querySelector('dt')?.textContent).toBe('Monday');
 expect(groups[1].textContent).toContain('10:00');expect(groups[1].textContent).toContain('14:00');
 expect(groups[2].querySelector('dt')?.textContent).toBe('Tuesday – Saturday');
 expect(groups[0].textContent).not.toContain('10:00');expect(groups[2].textContent).not.toContain('10:00');
 // Every day appears exactly once, inside its own group, with that day's own state and hours.
 const perDay=[...host.querySelectorAll<HTMLElement>('[data-hours-summary-day]')];
 expect(perDay.map(d=>d.dataset.hoursSummaryDay)).toEqual(['sunday','monday','tuesday','wednesday','thursday','friday','saturday']);
 for(const d of perDay){const group=d.closest<HTMLElement>('[data-hours-group]')!;expect(group.dataset.hoursDays!.split(' ')).toContain(d.dataset.hoursSummaryDay);
  expect(d.dataset.state).toBe(d.dataset.hoursSummaryDay==='monday'?'open':'closed');
  if(d.dataset.hoursSummaryDay==='monday'){expect(d.textContent).toContain('10:00');expect(d.textContent).toContain('14:00');}else expect(d.textContent).not.toContain('10:00');}
 expect(host.querySelector('[data-setup-unsaved="true"]')).toBeNull();
 expect(read.launch.canRequest).toBe(false);
 expect(host.querySelector('[role="status"]')?.textContent).toBe('0 of 6 complete');expect(save).not.toHaveBeenCalled();
});

it('retains selected trial through provisional readiness and explains settled unavailable without redirecting',async()=>{
 const select=vi.fn(),renderStep=vi.fn(()=>createElement('p',null,'Trial content'));
 await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,activeStepId:'test',provisional:true,onSelectStep:select,renderStep})));
 expect(select).not.toHaveBeenCalled();expect(host.querySelector('[data-setup-step-blocked="true"]')).not.toBeNull();
 const enriched={...read,steps:read.steps.map(s=>s.id==='hours'||s.id==='knowledge'?{...s,status:'verified' as const,reasonCodes:[]}:s.id==='assistant_test'?{...s,status:'pending' as const,reasonCodes:[]}:s)};
 await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,read:enriched,activeStepId:'test',provisional:false,onSelectStep:select,renderStep})));
 expect(select).not.toHaveBeenCalled();expect(host.textContent).toContain('Trial content');expect(host.querySelector('[data-setup-step-blocked="true"]')).toBeNull();
 await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,activeStepId:'test',provisional:false,onSelectStep:select,renderStep})));
 expect(select).not.toHaveBeenCalled();
 expect(host.textContent).toContain('Trial content');
 const blocked=host.querySelector('[data-setup-step-blocked="true"]');
 expect(blocked).not.toBeNull();
 expect(blocked?.textContent).toMatch(/Waiting for: Knowledge & languages|Waiting for: Business hours|Prerequisites required/);
});

it('opens optional team and real launch review with blocked trial without granting launch authority',async()=>{
 const select=vi.fn(),launch=vi.fn(),available=[...base.availableStepIds.slice(0,-1),'team' as const,'launch' as const];
 await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,availableStepIds:available,onSelectStep:select})));
 const item={detail:'Not verified',status:'pending' as const};
 const snapshot:LaunchSummarySnapshot={scope,version:1,branchLabel:'Main',setup:read,readiness:{status:'blocked',revision:'a'.repeat(32),blockers:['trial_incomplete','channel_unverified:whatsapp']},summary:{channels:[{channel:'whatsapp',...item}],hours:item,knowledge:item,persona:item,team:{detail:'Optional',status:'skipped_optional'}},operationId:'11111111-1111-4111-8111-111111111111',activation:{status:'not_started',receiptId:null,operationId:null}};
 await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,activeStepId:'launch',availableStepIds:available,onSelectStep:select,renderStep:step=>step==='launch'?createElement(PaidLaunchSummary,{locale:'en',scope,boundaryFingerprint:'capture',snapshot,state:{scope,version:1,phase:'ready'},isCurrent:()=>true,onLaunch:launch}):null})));
 expect(host.textContent).toContain('Review and confirm launch');
 expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
 expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
 expect(host.querySelector('[role="status"]')?.textContent).toBe('0 of 6 complete');expect(launch).not.toHaveBeenCalled();
});

// Mirrors the CSS rule; jsdom caches :has() results across re-renders, so evaluate the hooks directly.
const hidden=(b:Element)=>!!b.closest('section')?.querySelector('[data-wa-screen="choice"][data-route-selected="false"]')&&b.hasAttribute('data-next-step')&&!b.hasAttribute('data-step-complete');
it('hides the WhatsApp footer Next until a route is chosen, and keeps it when the step is already complete',async()=>{
 const {readFileSync}=await import('node:fs');
 expect(readFileSync(process.cwd()+'/src/components/app/paid-setup-workspace.module.css','utf8')).toContain('.workspace:has([data-wa-screen=choice][data-route-selected=false]) [data-next-step]:not([data-step-complete]){visibility:hidden;pointer-events:none}');
 expect(readFileSync(process.cwd()+'/src/components/app/paid-setup-workspace.module.css','utf8')).toContain('.workspace:has([data-channel-back]) [data-previous-step]{visibility:hidden;pointer-events:none}');
 const next=()=>Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent?.includes('Next step'))!;
 await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,activeStepId:'whatsapp'})));
 expect(hidden(next())).toBe(true);
 const coexist=host.querySelector<HTMLInputElement>('input[value="coexistence"]')!;expect(coexist.disabled).toBe(false);
 await act(async()=>coexist.click());
 // Coexistence now behaves like new-number: choosing it opens the requirements/guide screen.
   expect(host.querySelector('[data-wa-screen="requirements"]')).not.toBeNull();
 expect(hidden(next())).toBe(false);
 const connected=mergePaidBranchChannelProof(read,[{...scope,channel:'whatsapp',verified:true,generation:1,revoked:false,stale:false}]);
 await act(async()=>root.render(createElement(PaidSetupWorkspace,{...base,read:connected,activeStepId:'whatsapp'})));
 expect(next().hasAttribute('data-step-complete')).toBe(true);
 expect(hidden(next())).toBe(false);
});

it('navigateSetupStep invokes document.startViewTransition with document as receiver and applies update', () => {
  const apply = vi.fn();
  const mockStartViewTransition = vi.fn(function(this: unknown, cb: () => void) {
    cb();
    return { finished: Promise.resolve() };
  });
  Object.defineProperty(document, "startViewTransition", {configurable:true, value:mockStartViewTransition});
  try {
    navigateSetupStep('forward', apply);
    expect(mockStartViewTransition).toHaveBeenCalledTimes(1);
    expect(mockStartViewTransition.mock.contexts[0]).toBe(document);
    expect(apply).toHaveBeenCalledTimes(1);
  } finally {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});

it('navigateSetupStep catches Illegal invocation and safely executes apply as fallback', () => {
  const apply = vi.fn();
  const mockStartViewTransition = vi.fn(function(this: unknown) {
    if (this !== document) {
      throw new TypeError('Illegal invocation');
    }
    throw new TypeError('Illegal invocation');
  });
  Object.defineProperty(document, "startViewTransition", {configurable:true, value:mockStartViewTransition});
  try {
    expect(() => navigateSetupStep('forward', apply)).not.toThrow();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.setupSlide).toBeUndefined();
  } finally {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});

it('navigateSetupStep suppresses transition.finished rejections without unhandled error', async () => {
  const apply = vi.fn();
  let rejectFinished!: (reason: unknown) => void;
  const finishedPromise = new Promise<void>((_, reject) => {
    rejectFinished = reject;
  });
  const mockStartViewTransition = vi.fn(function(this: unknown, cb: () => void) {
    cb();
    return { finished: finishedPromise };
  });
  Object.defineProperty(document, "startViewTransition", {configurable:true, value:mockStartViewTransition});
  try {
    navigateSetupStep('back', apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.setupSlide).toBe('back');
    rejectFinished(new DOMException('Transition was aborted', 'AbortError'));
    await finishedPromise.catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(document.documentElement.dataset.setupSlide).toBeUndefined();
  } finally {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});
