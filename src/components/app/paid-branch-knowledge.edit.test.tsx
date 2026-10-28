// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {PaidBranchKnowledge,type PaidBranchKnowledgeProps} from './paid-branch-knowledge';
import type {KnowledgeSourceRecord} from '@/lib/knowledge/types';
it('retains failed or mismatched edits, closes only confirmed content and permits a fresh edit',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const scope={expectedAccountId:'actor',companyId:'company',branchId:'branch'};
 const source={id:'source',company_id:'company',kind:'text',title:'Original',content:'Original answer',status:'ready',content_version:1} as KnowledgeSourceRecord;
 const mutation=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined);
 const props:PaidBranchKnowledgeProps={locale:'en',scope,boundaryFingerprint:'stable',isCurrent:()=>true,state:{scope,version:1,phase:'ready'},snapshot:{scope,version:1,branchLabel:'Main',websiteQuota:{limit:10,used:0},pages:[],files:[],faq:[{branchId:'branch',source}],capabilities:{canAddWebsite:true,canUploadFiles:true,canSaveText:true}},onSourceMutation:mutation};
 const render=async(next=props)=>{await act(async()=>root.render(createElement(PaidBranchKnowledge,next)));};
 const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(item=>item.textContent===text)!;
 const editor=()=>Array.from(host.querySelectorAll('fieldset')).find(item=>item.querySelector('legend')?.textContent==='Edit saved text');
 const type=async(element:HTMLInputElement|HTMLTextAreaElement,value:string)=>{await act(async()=>{const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));});};
 try{
  await render();await act(async()=>button('Edit text').click());
  await type(editor()!.querySelector('input')!,'Changed');await type(editor()!.querySelector('textarea')!,'Changed answer');
  await act(async()=>editor()!.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(mutation).toHaveBeenLastCalledWith(expect.objectContaining({action:'edit',contentVersion:1,title:'Changed',content:'Changed answer'}));
  expect(editor()!.querySelector('textarea')!.value).toBe('Changed answer');expect(host.textContent).toContain('The request could not be submitted');
  const mismatched={...props,snapshot:{...props.snapshot!,faq:[{branchId:'branch',source:{...source,content_version:2,title:'Other',content:'Other answer'}}]}};
  await render(mismatched);expect(editor()!.querySelector('input')!.value).toBe('Changed');
  const confirmed={...props,state:{...props.state,phase:'saved' as const},snapshot:{...props.snapshot!,faq:[{branchId:'branch',source:{...source,content_version:2,title:'Changed',content:'Changed answer'}}]}};
  await render(confirmed);expect(editor()).toBeUndefined();expect(host.querySelector('[data-setup-unsaved]')).toBeNull();
  await act(async()=>button('Edit text').click());expect(editor()!.querySelector('input')!.value).toBe('Changed');
  await type(editor()!.querySelector('textarea')!,'Next answer');
  await act(async()=>editor()!.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(mutation).toHaveBeenLastCalledWith(expect.objectContaining({contentVersion:2,title:'Changed',content:'Next answer'}));
  expect(editor()!.querySelector('textarea')!.value).toBe('Next answer');
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
