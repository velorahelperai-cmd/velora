// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({read:vi.fn(),invalidate:vi.fn()}));
vi.mock('@/lib/tenancy/setup-read-client',()=>({createSetupReader:()=>({read:m.read,invalidate:m.invalidate,prefetchHours:()=>{},peekHours:()=>null})}));
vi.mock('@/lib/tenancy/paid-setup-workspace-actions',()=>({readOwnedPaidSetupWorkspaceAction:vi.fn()}));
vi.mock('./paid-channel-view',()=>({PaidChannelView:()=>null}));
vi.mock('./paid-setup-step-host',()=>({PaidSetupStepHost:({step}:{step:string})=>createElement('section',{'data-setup-unsaved':'true'},createElement('textarea',{'aria-label':step,defaultValue:'local draft'}))}));
import {PaidSetupFlow} from './paid-assistant-checklist';
import {projectTrustedBoundSelection} from '@/lib/tenancy/paid-setup-contracts';
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();sessionStorage.clear();});
it('opens knowledge before slow Meta proof, and late progress cannot discard the active draft',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const scope={expectedAccountId:'actor',companyId:'company',boundaryFingerprint:'boundary'};
 const read=projectTrustedBoundSelection({companyId:'company',branchId:'branch',branchLabel:'Main',orderGroupId:'order',slotIndex:0,persona:'level_1',package:'basic',term:'monthly',maxChannels:1,employeesExcludingOwner:2,clockState:'waiting_readiness',asOf:'now'},{channels:['whatsapp']});
 const shell={scope:{...scope,branchId:'branch'},read,connectionReads:{},confirmedChannels:[]};
 let finish!:(value:unknown)=>void;
 m.read.mockImplementation((kind:string)=>kind==='shell'?Promise.resolve(shell):new Promise(resolve=>{finish=resolve;}));
 const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 try{
  await act(async()=>root.render(createElement(PaidSetupFlow,{locale:'en',scope,isCurrent:()=>true,readEntry:async()=>({schemaVersion:1 as const,companyId:'company',sourceStatus:'selection_required' as const,selectedBranchId:null,reasonCodes:[],branches:[{id:'branch',label:'Main',isPrimary:true}],asOf:'now'}),readBranch:async()=>read})));
  expect(host.querySelector('nav[aria-label="Setup steps"] button[aria-label^="Business hours"]')).not.toBeNull();
  // Segments show one entry per step; nothing is filled until a confirmed read arrives.
  expect(host.querySelector('nav[aria-label="Setup steps"]')?.getAttribute('aria-busy')).toBe('true');
  expect(host.querySelector('button[aria-label^="Knowledge & languages"]')?.getAttribute('aria-label')).not.toContain('Complete');
  // Knowledge stays independently reachable through the footer before Meta proof.
  vi.stubGlobal('confirm',()=>true);
  for(let i=0;i<6&&!host.querySelector('textarea[aria-label="knowledge"]');i++){const next=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Next step'));expect(next?.disabled).toBe(false);await act(async()=>next!.click());}
  expect(host.querySelector('textarea[aria-label="knowledge"]')).not.toBeNull();
  const draft=host.querySelector('textarea')!;draft.value='unsaved changes';
  await act(async()=>finish({...shell,read:{...read,steps:read.steps.map(step=>step.id==='knowledge'?{...step,status:'verified',reasonCodes:[]}:step)}}));
  expect(host.querySelector('textarea')).toBe(draft);expect(draft.value).toBe('unsaved changes');
  expect(host.querySelector('button[aria-label^="Knowledge & languages"]')?.getAttribute('aria-label')).toContain('Complete');
 }finally{await act(async()=>root.unmount());host.remove();}
});
it('keeps confirmed progress when isCurrent identity churns after enrichment',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const scope={expectedAccountId:'actor',companyId:'company',boundaryFingerprint:'boundary'};
 const read=projectTrustedBoundSelection({companyId:'company',branchId:'branch',branchLabel:'Main',orderGroupId:'order',slotIndex:0,persona:'level_1',package:'basic',term:'monthly',maxChannels:1,employeesExcludingOwner:2,clockState:'waiting_readiness',asOf:'now'},{channels:['whatsapp']});
 const verified={...read,steps:read.steps.map(step=>step.id==='hours'||step.id==='knowledge'?{...step,status:'verified' as const,reasonCodes:[]}:step),progress:{...read.progress,verified:2}};
 const shell={scope:{...scope,branchId:'branch'},read,connectionReads:{},confirmedChannels:[]};
 const workspace={...shell,read:verified};
 m.read.mockImplementation(async(kind:string)=>kind==='shell'?shell:workspace);
 const host=document.createElement('div'),root=createRoot(host);document.body.append(host);
 const entry=async()=>({schemaVersion:1 as const,companyId:'company',sourceStatus:'selection_required' as const,selectedBranchId:null,reasonCodes:[],branches:[{id:'branch',label:'Main',isPrimary:true}],asOf:'now'});
 try{
  await act(async()=>root.render(createElement(PaidSetupFlow,{locale:'en',scope,isCurrent:()=>true,readEntry:entry,readBranch:async()=>read})));
  await act(async()=>undefined);
  expect(host.textContent).toContain('2 of 6 complete');
  expect(host.querySelector('nav[aria-label="Setup steps"] li[data-complete="true"]')).not.toBeNull();
  const before=m.invalidate.mock.calls.length;
  await act(async()=>root.render(createElement(PaidSetupFlow,{locale:'en',scope,isCurrent:()=>true,readEntry:entry,readBranch:async()=>read})));
  expect(host.textContent).toContain('2 of 6 complete');
  expect(host.querySelector('nav[aria-label="Setup steps"] li[data-complete="true"]')).not.toBeNull();
  expect(host.textContent).not.toContain('Checking setup progress');
  // Soft same-branch re-entry must not wipe shell/workspace caches again.
  expect(m.invalidate.mock.calls.slice(before).some(call=>JSON.stringify(call).includes('shell'))).toBe(false);
 }finally{await act(async()=>root.unmount());host.remove();}
});
