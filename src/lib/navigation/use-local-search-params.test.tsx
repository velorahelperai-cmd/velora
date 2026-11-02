// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
const route=vi.hoisted(()=>({search:''}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(route.search)}));
import {useLocalSearchParams} from './use-local-search-params';

function View(){
 const [params,navigate]=useLocalSearchParams();
 return <><output>{params.get('channel')??'all'}</output><button onClick={()=>navigate('/app/conversations?channel=whatsapp')}>WhatsApp</button><button onClick={()=>navigate('/app/conversations?channel=instagram')}>Instagram</button></>;
}
afterEach(()=>{vi.unstubAllGlobals();route.search='';});
it('updates selection before router completion, rejects late router state, and follows history',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 window.history.replaceState(null,'','/app/conversations');
 const host=document.createElement('div');document.body.append(host);
 const root=createRoot(host);
 try{
  await act(async()=>root.render(<View/>));
  const selected=()=>host.querySelector('output')?.textContent;
  expect(selected()).toBe('all');
  await act(async()=>host.querySelectorAll('button')[0].click());
  expect(selected()).toBe('whatsapp');expect(route.search).toBe('');
  await act(async()=>host.querySelectorAll('button')[1].click());
  expect(selected()).toBe('instagram');
  // A delayed first navigation must not overwrite the more recent selection.
  route.search='channel=whatsapp';
  await act(async()=>root.render(<View/>));
  expect(selected()).toBe('instagram');
  await act(async()=>{
   window.history.replaceState(null,'','/app/conversations?channel=whatsapp');
   window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(selected()).toBe('whatsapp');
 }finally{await act(async()=>root.unmount());host.remove();}
});
