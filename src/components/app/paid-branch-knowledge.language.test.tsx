// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {PaidBranchKnowledge,type PaidBranchKnowledgeProps} from './paid-branch-knowledge';
import type {ReplyLanguageSnapshot} from '@/lib/tenancy/reply-language-contract';

const scope={expectedAccountId:'actor',companyId:'company',branchId:'branch'};
const languageSnapshot=(replyLanguage:ReplyLanguageSnapshot['replyLanguage']='both'):ReplyLanguageSnapshot=>({
  scope,version:2,companyLabel:'Co',branchLabel:'Main',replyLanguage,confirmation:replyLanguage?'confirmed':'unconfirmed',canConfirm:true,
});
const base:PaidBranchKnowledgeProps={
  locale:'ar',scope,boundaryFingerprint:'stable',isCurrent:()=>true,
  state:{scope,version:1,phase:'ready'},
  snapshot:{scope,version:1,branchLabel:'TAG CITY',websiteQuota:{limit:10,used:0},pages:[],files:[],faq:[],capabilities:{canAddWebsite:true,canUploadFiles:true,canSaveText:true}},
  languageSnapshot:languageSnapshot('both'),
  languageState:{version:2,phase:'ready'},
};

let host:HTMLDivElement;
let root:ReturnType<typeof createRoot>;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

const choice=(value:string)=>host.querySelector<HTMLButtonElement>(`[data-language-choice="${value}"]`)!;

describe('assistant reply language choices',()=>{
 it('orders Automatic → Arabic → English without a save button',async()=>{
  await act(async()=>root.render(createElement(PaidBranchKnowledge,base)));
  const values=[...host.querySelectorAll('[data-language-choice]')].map(n=>n.getAttribute('data-language-choice'));
  expect(values).toEqual(['both','ar','en']);
  expect(choice('both').getAttribute('aria-checked')).toBe('true');
  expect(choice('both').textContent).toContain('تلقائي');
  expect(choice('both').textContent).toContain('✓');
  expect(host.textContent).not.toContain('حفظ التغيير');
  expect(host.textContent).not.toContain('Save change');
 });

 it('autosaves the chosen reply language and keeps the draft after failure',async()=>{
  const onConfirmLanguages=vi.fn().mockRejectedValue(Error('offline'));
  await act(async()=>root.render(createElement(PaidBranchKnowledge,{...base,locale:'en',onConfirmLanguages})));
  await act(async()=>choice('ar').click());
  expect(choice('ar').getAttribute('aria-checked')).toBe('true');
  expect(onConfirmLanguages).toHaveBeenCalledTimes(1);
  expect(onConfirmLanguages.mock.calls[0][0]).toMatchObject({replyLanguage:'ar',expectedVersion:2});
  expect(host.textContent).toContain('The request result could not be confirmed');
  expect(choice('ar').getAttribute('aria-checked')).toBe('true');
  expect(host.textContent).not.toContain('Save change');
 });

 it('does not repeat an in-flight language save',async()=>{
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const onConfirmLanguages=vi.fn(()=>gate);
  await act(async()=>root.render(createElement(PaidBranchKnowledge,{...base,locale:'en',onConfirmLanguages})));
  await act(async()=>{void choice('en').click();});
  expect(onConfirmLanguages).toHaveBeenCalledTimes(1);
  expect(choice('both').disabled).toBe(true);
  await act(async()=>{choice('ar').click();});
  expect(onConfirmLanguages).toHaveBeenCalledTimes(1);
  await act(async()=>release());
 });

 it('does not mark Automatic while languages are loading',async()=>{
  await act(async()=>root.render(createElement(PaidBranchKnowledge,{
    ...base,
    languageSnapshot:null,
    languageState:{version:null,phase:'loading'},
  })));
  expect(host.querySelector('[data-checked]')).toBeNull();
  expect(choice('both').disabled).toBe(true);
 });
});
