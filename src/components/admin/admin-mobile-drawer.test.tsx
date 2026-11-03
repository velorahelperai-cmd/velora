// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('next/link',()=>({default:({children,...props}: React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('next/navigation',()=>({usePathname:()=>'/admin'}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'en'})}));
vi.mock('@/components/app/ui',()=>({LangSwitch:()=>null}));
vi.mock('@/components/app/account-chrome',()=>({AccountMenu:()=>null,useOptionalAccountSession:()=>null}));
import { AdminShell } from './admin-shell';

afterEach(()=>{document.body.innerHTML='';vi.unstubAllGlobals();});
it('contains mobile navigation focus and returns it to its opener on Escape',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>{f(0);return 1;});
 vi.stubGlobal('cancelAnimationFrame',()=>{});
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);
 await act(async()=>root.render(<AdminShell><button>Background action</button></AdminShell>));
 const open=container.querySelector<HTMLButtonElement>('[aria-label="Open navigation"]')!;
 await act(async()=>open.click());
 const drawer=container.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
 expect(drawer).not.toBeNull();
 expect(drawer?.contains(document.activeElement)).toBe(true);
 const focusable=Array.from(drawer!.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'));
 focusable.forEach(element=>vi.spyOn(element,'getClientRects').mockReturnValue({length:1} as DOMRectList));
 focusable[focusable.length-1].focus();
 await act(async()=>drawer!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})));
 expect(document.activeElement).toBe(focusable[0]);
 await act(async()=>drawer!.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true})));
 expect(document.activeElement).toBe(focusable[focusable.length-1]);
 expect(Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Background action')?.closest('[inert]')).not.toBeNull();
 await act(async()=>drawer!.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(document.activeElement).toBe(open);
 await act(async()=>root.unmount());
});
