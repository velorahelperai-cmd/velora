// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({router:{refresh:vi.fn()}}));
vi.mock('next/navigation',()=>({useRouter:()=>m.router}));
import {BranchInboxRealtime} from './branch-inbox-realtime';
class Source extends EventTarget{
 static CLOSED=2;
 static all:Source[]=[];
 readyState=0;
 close=vi.fn();onerror:(()=>void)|null=null;
 constructor(public url:string){super();Source.all.push(this);}
}
const props={companyId:'qa-company',branchId:'qa-main',channel:'whatsapp',ar:true};
let root:Root,container:HTMLDivElement;
function render(element:React.ReactNode){act(()=>root.render(element));return {rerender:(next:React.ReactNode)=>act(()=>root.render(next)),unmount:()=>act(()=>root.unmount())};}
const statusText=()=>container.querySelector('[role="status"]')?.textContent;
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();Source.all=[];vi.stubGlobal('EventSource',Source);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it('refreshes on ready and coalesces a burst of changes without rendering event payloads',async()=>{
 render(<BranchInboxRealtime {...props}/>);const source=Source.all[0];
 expect(source.url).toContain('company=qa-company&branch=qa-main&channel=whatsapp');
 act(()=>{source.dispatchEvent(new Event('ready'));for(let i=0;i<5;i++)source.dispatchEvent(new MessageEvent('change',{data:'PRIVATE_BODY'}));});
 await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
 expect(m.router.refresh).toHaveBeenCalledTimes(1);expect(statusText()).toBe('التحديثات المباشرة متصلة');expect(document.body.textContent).not.toContain('PRIVATE_BODY');
});
it('closes stale scope subscriptions and cancels pending refreshes on unmount',async()=>{
 const view=render(<BranchInboxRealtime key="main" {...props}/>),old=Source.all[0];
 act(()=>{old.dispatchEvent(new Event('change'));});
 view.rerender(<BranchInboxRealtime key="other" {...props} branchId="qa-branch-2"/>);
 expect(old.close).toHaveBeenCalledTimes(1);
 await act(async()=>{old.dispatchEvent(new Event('change'));await vi.advanceTimersByTimeAsync(250);});
 expect(m.router.refresh).not.toHaveBeenCalled();
 act(()=>{Source.all[1].dispatchEvent(new Event('change'));});view.unmount();
 await vi.advanceTimersByTimeAsync(250);expect(m.router.refresh).not.toHaveBeenCalled();expect(Source.all[1].close).toHaveBeenCalledTimes(1);
});
it('revalidates on revocation and reconnect failure without leaving the stream active',async()=>{
 render(<BranchInboxRealtime {...props}/>);const source=Source.all[0];
 act(()=>{source.dispatchEvent(new Event('ready'));source.dispatchEvent(new Event('revoked'));});
 await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
 expect(source.close).toHaveBeenCalledTimes(1);expect(m.router.refresh).toHaveBeenCalledTimes(1);expect(statusText()).toContain('جارٍ الاتصال');
 await act(async()=>{source.readyState=Source.CLOSED;source.onerror?.();await vi.advanceTimersByTimeAsync(5000);});expect(Source.all).toHaveLength(1);
});
it('recreates terminal transport failures after backoff and cancels retries when unmounted',async()=>{
 const view=render(<BranchInboxRealtime {...props}/>),source=Source.all[0];
 act(()=>{source.readyState=Source.CLOSED;source.onerror?.();});
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(Source.all).toHaveLength(2);expect(source.close).toHaveBeenCalledTimes(1);
 act(()=>{Source.all[1].dispatchEvent(new Event('ready'));});expect(statusText()).toBe('التحديثات المباشرة متصلة');
 act(()=>{Source.all[1].readyState=Source.CLOSED;Source.all[1].onerror?.();});view.unmount();
 await vi.advanceTimersByTimeAsync(5000);expect(Source.all).toHaveLength(2);
});
