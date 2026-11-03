// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>'/app'}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('./ui',()=>({LangSwitch:()=> <button>Language</button>,useAppCopy:()=>({brand:'Velora',app:{nav:{dashboard:'Dashboard'}}})}));
import {WorkspaceFrame} from './workspace-frame';
afterEach(()=>{document.body.innerHTML='';vi.unstubAllGlobals();});
it('contains mobile navigation focus and restores it on Escape',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(<WorkspaceFrame title="Dashboard" nav={[{href:'/app',label:'Dashboard',icon:'M0 0'}]}><button>Background action</button></WorkspaceFrame>));
 const open=host.querySelector<HTMLButtonElement>('[aria-label="Workspace menu"]')!;
 await act(async()=>open.click());
 const drawer=host.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');expect(drawer).not.toBeNull();
 expect(drawer?.contains(document.activeElement)).toBe(true);
 expect(Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Background action')?.closest('[inert]')).not.toBeNull();
 const focusable=Array.from(drawer!.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'));
 focusable.forEach(element=>vi.spyOn(element,'getClientRects').mockReturnValue({length:1} as DOMRectList));
 focusable[focusable.length-1].focus();
 await act(async()=>drawer!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
 expect(document.activeElement).toBe(focusable[0]);
 await act(async()=>drawer!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(document.activeElement).toBe(open);
 await act(async()=>root.unmount());
});
