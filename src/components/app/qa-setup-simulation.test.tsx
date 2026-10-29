// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
vi.mock('./account-chrome',()=>({useOptionalAccountSession:()=>({status:'ready',identity:{userId:'qa'}})}));
vi.mock('next/link',()=>({default:'a'}));
import {QaSetupSimulation} from './qa-setup-simulation';
it('lets the QA account traverse local setup without creating financial or provider operations',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host);
 try{
  await act(async()=>root.render(createElement(QaSetupSimulation,{accountId:'qa'})));
  expect(host.textContent).toContain('لا يوجد دفع أو شركة');
  for(let i=0;i<6;i++){
   const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='التالي في المحاكاة')!;
   await act(async()=>button.click());
  }
  expect(host.textContent).toContain('UNKNOWN');
  expect(host.querySelector('form')).toBeNull();
  await act(async()=>root.render(createElement(QaSetupSimulation,{accountId:'another'})));
  expect(host.querySelector('[data-qa-setup-simulation]')).toBeNull();
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
