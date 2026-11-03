// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
import {MotionBorder} from './motion-border';
afterEach(()=>{document.body.innerHTML='';vi.unstubAllGlobals();});
it('runs decoration only while visible and the document is active',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 let callback:IntersectionObserverCallback=()=>{};
 const disconnect=vi.fn();
 vi.stubGlobal('IntersectionObserver',class {constructor(cb:IntersectionObserverCallback){callback=cb;} observe(){} disconnect=disconnect;});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<MotionBorder><button>Action</button></MotionBorder>));
 const border=host.firstElementChild as HTMLElement;
 expect(border.dataset.animate).toBe('false');
 await act(async()=>callback([{isIntersecting:true} as IntersectionObserverEntry],{} as IntersectionObserver));
 expect(border.dataset.animate).toBe('true');
 Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
 await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(border.dataset.animate).toBe('false');
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
 await act(async()=>root.unmount());expect(disconnect).toHaveBeenCalled();
});
