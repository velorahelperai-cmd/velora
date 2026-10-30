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
  expect(host.querySelector('[data-step-id="hours"]')).toBeNull();
  const knowledge=host.querySelector<HTMLButtonElement>('[data-step-id="knowledge"] button')!;
  expect(knowledge.disabled).toBe(false);expect(host.querySelector<HTMLButtonElement>('[data-step-id="launch"] button')?.disabled).toBe(true);
  await act(async()=>knowledge.click());const draft=host.querySelector('textarea')!;draft.value='unsaved changes';
  await act(async()=>finish({...shell,read:{...read,steps:read.steps.map(step=>step.id==='knowledge'?{...step,status:'verified',reasonCodes:[]}:step)}}));
  expect(host.querySelector('textarea')).toBe(draft);expect(draft.value).toBe('unsaved changes');
 }finally{await act(async()=>root.unmount());host.remove();}
});
