// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
import {ConversationDetailsPanel} from './conversation-details-panel';

it('keeps the open details available on wide resize and closes with Escape',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div');document.body.append(host);
 const root=createRoot(host);const close=vi.fn();const originalWidth=window.innerWidth;
 try{
  await act(async()=>root.render(<ConversationDetailsPanel id="details" title="Details" open onClose={close}><p>Customer</p></ConversationDetailsPanel>));
  Object.defineProperty(window,'innerWidth',{configurable:true,value:1600});
  await act(async()=>window.dispatchEvent(new Event('resize')));
  expect(close).not.toHaveBeenCalled();
  await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
  expect(close).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());Object.defineProperty(window,'innerWidth',{configurable:true,value:originalWidth});host.remove();vi.unstubAllGlobals();}
});
