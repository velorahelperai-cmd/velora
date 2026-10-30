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

it('switches knowledge tabs immediately and keeps website, file and answer drafts',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const scope={expectedAccountId:'actor',companyId:'company',branchId:'branch'};
 const upload=vi.fn();
 const add=vi.fn();
 const props:PaidBranchKnowledgeProps={locale:'en',scope,boundaryFingerprint:'stable',isCurrent:()=>true,state:{scope,version:1,phase:'ready'},snapshot:{scope,version:1,branchLabel:'Main',websiteQuota:{limit:10,used:1},pages:[{id:'page',companyId:'company',branchId:'branch',version:2,url:'https://example.com/about',status:'ready',error:null,capabilities:{canRetry:false,canRetrain:true}}],files:[],faq:[],capabilities:{canAddWebsite:true,canUploadFiles:true,canSaveText:true}},onUploadFiles:upload,onAddWebsite:add};
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(true);
 const type=async(element:HTMLInputElement|HTMLTextAreaElement,value:string)=>{await act(async()=>{const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));});};
 const tab=(name:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(item=>item.textContent?.includes(name))!;
 try{
  await act(async()=>root.render(createElement(PaidBranchKnowledge,props)));
  expect(host.querySelector('[data-panel="website"]')!.hasAttribute('hidden')).toBe(false);
  expect(host.querySelector('[data-panel="files"]')!.hasAttribute('hidden')).toBe(true);
  const answer=host.querySelector<HTMLTextAreaElement>('textarea')!;
  await type(answer,'Draft answer');
  const url=host.querySelector<HTMLInputElement>('input[type="url"]')!;
  await type(url,'notaurl');
  expect(host.textContent).toContain('Enter a direct HTTPS address');
  await act(async()=>url.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(add).not.toHaveBeenCalled();
  await type(url,'https://example.com/about');
  expect(host.textContent).toContain('already linked to this branch');
  await act(async()=>tab('Files').click());
  const file=new File(['hello'],'menu.txt',{type:'text/plain'});
  const zone=host.querySelector<HTMLElement>('[data-file-drop]')!;
  const dropped=new Event('drop',{bubbles:true,cancelable:true});
  Object.defineProperty(dropped,'dataTransfer',{value:{files:[file]}});
  await act(async()=>{zone.dispatchEvent(dropped);});
  expect(host.textContent).toContain('menu.txt');
  expect(host.textContent).toContain('Waiting to upload');
  await act(async()=>tab('Questions and answers').click());
  expect(host.querySelector('textarea')).toBe(answer);expect(answer.value).toBe('Draft answer');
  expect(upload).not.toHaveBeenCalled();
  await act(async()=>tab('Files').click());
  expect(host.textContent).toContain('menu.txt');
  await act(async()=>zone.closest('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledTimes(1);
  expect(upload.mock.calls[0][0].files.map((item:File)=>item.name)).toEqual(['menu.txt']);
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
