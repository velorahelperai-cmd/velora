// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {PaidBranchKnowledge,type PaidBranchKnowledgeProps} from './paid-branch-knowledge';
import {PaidAssistantTrial,type PaidAssistantTrialProps} from './paid-assistant-trial';
it('shows the submitted question immediately and prevents a duplicate while awaiting the server',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const scope={expectedAccountId:'actor',companyId:'company',branchId:'branch'};
 let finish!:()=>void;const ask=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const props:PaidAssistantTrialProps={locale:'en',scope,boundaryFingerprint:'boundary',snapshot:{scope,version:1,knowledgeRevision:'k1',branchLabel:'Branch',businessType:'restaurant',canAsk:true,messages:[]},state:{scope,version:1,phase:'ready',requestId:null,failure:null,canRetry:false},isCurrent:()=>true,onAsk:ask};
 const host=document.createElement('div'),root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(PaidAssistantTrial,props)));
  const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
  const input=host.querySelector('textarea')!;
  await act(async()=>{set.call(input,'Hours today?');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  expect(ask).toHaveBeenCalledTimes(1);expect(host.querySelector('[role="log"]')!.textContent).toContain('Hours today?');
  expect(host.querySelector('[role="log"]')!.textContent).toMatch(/Generating a reply|Waiting/);
  await act(async()=>finish());
 } finally {await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
it('preserves local knowledge text through initial data, revision changes and read failure',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const scope={expectedAccountId:'actor',companyId:'company',branchId:'branch'};
 const props:PaidBranchKnowledgeProps={locale:'en',scope,boundaryFingerprint:'boundary',snapshot:null,state:{scope,version:null,phase:'loading'},isCurrent:()=>true};
 const host=document.createElement('div'),root=createRoot(host);
 try {
  await act(async()=>root.render(createElement(PaidBranchKnowledge,props)));
  const input=host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,'Local answer');input.dispatchEvent(new Event('input',{bubbles:true}));});
  const snapshot={scope,version:1,branchLabel:'Branch',websiteQuota:{limit:10 as const,used:0},pages:[],files:[],faq:[],capabilities:{canAddWebsite:true,canUploadFiles:true,canSaveText:true}};
  await act(async()=>root.render(createElement(PaidBranchKnowledge,{...props,snapshot,state:{scope,version:1,phase:'ready'}})));
  expect(host.querySelector('textarea')).toBe(input);expect(input.value).toBe('Local answer');
  await act(async()=>root.render(createElement(PaidBranchKnowledge,{...props,snapshot:{...snapshot,version:2},state:{scope,version:2,phase:'unavailable'}})));
  expect(host.querySelector('textarea')).toBe(input);expect(input.value).toBe('Local answer');
  expect(host.textContent).toContain('Saving is unconfirmed');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
 } finally {await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
